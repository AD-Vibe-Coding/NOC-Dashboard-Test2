import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../../_lib/supabase-admin.js";
import { getSession } from "../../../_lib/auth-middleware.js";
import { getAppBuilderSession } from "../../../_lib/appbuilder-auth.js";
import { lookupByEmail } from "../../../_lib/roles.js";

const MAX_BATCH_ROWS = 500;
const MAX_BATCH_BYTES = 1_500_000;

type RawRowInput = {
  memberName: string;
  monthKey: string;
  monthLabel: string;
  sourceRow: number;
  cells: Record<string, string | number | boolean>;
};

function bodyOf(req: VercelRequest): Record<string, unknown> {
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return (req.body ?? {}) as Record<string, unknown>;
}

async function managerName(req: VercelRequest): Promise<string | null> {
  const session = await getAppBuilderSession(req);
  const legacySession = session ? null : getSession(req);
  const email = session?.email ?? legacySession?.email;
  const member = email ? lookupByEmail(String(email).toLowerCase()) : null;
  const role = member?.role ?? session?.role ?? legacySession?.role;
  if ((!session && !legacySession) || String(role ?? "").toLowerCase() !== "manager") return null;
  return member?.name ?? "Manager";
}

function uploadIdFrom(req: VercelRequest): number | null {
  const raw = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseRows(value: unknown): RawRowInput[] | null {
  if (!Array.isArray(value) || value.length > MAX_BATCH_ROWS) return null;
  const rows: RawRowInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const memberName = String(row.memberName ?? "").trim();
    const monthKey = String(row.monthKey ?? "").trim();
    const monthLabel = String(row.monthLabel ?? "").trim();
    const sourceRow = Number(row.sourceRow);
    const cells = row.cells;
    if (!memberName || !/^\d{4}-\d{2}$/.test(monthKey) || !monthLabel || !Number.isSafeInteger(sourceRow) || sourceRow < 1) return null;
    if (!cells || typeof cells !== "object" || Array.isArray(cells)) return null;
    rows.push({ memberName, monthKey, monthLabel, sourceRow, cells: cells as RawRowInput["cells"] });
  }
  return rows;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const manager = await managerName(req);
    if (!manager) return res.status(403).json({ error: "Manager access required." });

    const uploadId = uploadIdFrom(req);
    if (!uploadId) return res.status(400).json({ error: "A valid upload id is required." });

    if (req.method === "GET") {
      const member = String(req.query.member ?? "").trim();
      const monthsRaw = String(req.query.months ?? "");
      const months = monthsRaw.split(",").map((month) => month.trim()).filter((month) => /^\d{4}-\d{2}$/.test(month));
      const page = Math.max(0, Math.floor(Number(req.query.page) || 0));
      const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit) || 100)));
      const direction = req.query.direction === "desc" ? false : true;
      const requestedSort = String(req.query.sortBy ?? "month");
      const sortColumn = requestedSort === "excelRow"
        ? "source_row"
        : requestedSort === "month"
          ? "month_key"
          : /^cell:\d{1,4}$/.test(requestedSort)
            ? `cells->>${requestedSort.slice(5)}`
            : "month_key";
      if (!member || months.length === 0 || months.length > 24) {
        return res.status(400).json({ error: "A member and one or more valid months are required." });
      }

      const from = page * limit;
      const { data, count, error } = await supabaseAdmin
        .from("team_performance_raw_rows")
        .select("id,member_name,month_key,month_label,source_row,cells", { count: "exact" })
        .eq("upload_id", uploadId)
        .eq("member_name", member)
        .in("month_key", months)
        .order(sortColumn, { ascending: direction })
        .order("month_key", { ascending: true })
        .order("source_row", { ascending: true })
        .range(from, from + limit - 1);
      if (error) return res.status(500).json({ error: error.message });

      const rawRowIds = (data ?? []).map((row) => row.id);
      const disputesByRawRow = new Map<number, { id: number; field_name: string; status: string; review_note: string | null }[]>();
      if (rawRowIds.length) {
        const { data: disputes, error: disputesError } = await supabaseAdmin
          .from("metric_disputes")
          .select("id,raw_row_id,field_name,status,review_note,created_at")
          .in("raw_row_id", rawRowIds)
          .order("created_at", { ascending: false });
        if (!disputesError) {
          for (const dispute of disputes ?? []) {
            if (dispute.raw_row_id == null) continue;
            const forRow = disputesByRawRow.get(dispute.raw_row_id) ?? [];
            if (forRow.some((existing) => existing.field_name === dispute.field_name)) continue;
            forRow.push({
              id: dispute.id,
              field_name: dispute.field_name,
              status: dispute.status,
              review_note: dispute.review_note,
            });
            disputesByRawRow.set(dispute.raw_row_id, forRow);
          }
        }
      }

      return res.status(200).json({
        rows: (data ?? []).map((row) => ({
          id: row.id,
          disputes: disputesByRawRow.get(row.id) ?? [],
          memberName: row.member_name,
          monthKey: row.month_key,
          monthLabel: row.month_label,
          sourceRow: row.source_row,
          cells: row.cells,
        })),
        total: count ?? 0,
        page,
        limit,
      });
    }

    if (req.method === "POST") {
      const body = bodyOf(req);
      const rows = parseRows(body.rows);
      if (!rows) return res.status(400).json({ error: `A batch of up to ${MAX_BATCH_ROWS} valid rows is required.` });
      if (Buffer.byteLength(JSON.stringify(rows), "utf8") > MAX_BATCH_BYTES) {
        return res.status(413).json({ error: "Raw-row batch exceeds the 1.5 MiB limit; send smaller batches." });
      }

      const { data: upload, error: uploadError } = await supabaseAdmin
        .from("team_performance_uploads")
        .select("id")
        .eq("id", uploadId)
        .maybeSingle();
      if (uploadError) return res.status(500).json({ error: uploadError.message });
      if (!upload) return res.status(404).json({ error: "Upload not found." });

      if (rows.length) {
        const records = rows.map((row) => ({
          upload_id: uploadId,
          member_name: row.memberName,
          month_key: row.monthKey,
          month_label: row.monthLabel,
          source_row: row.sourceRow,
          cells: row.cells,
        }));
        const { error } = await supabaseAdmin.from("team_performance_raw_rows").insert(records);
        if (error) return res.status(500).json({ error: error.message });
      }
      return res.status(201).json({ inserted: rows.length });
    }

    if (req.method === "DELETE") {
      const { error: rowsError } = await supabaseAdmin.from("team_performance_raw_rows").delete().eq("upload_id", uploadId);
      if (rowsError) return res.status(500).json({ error: rowsError.message });
      const { error } = await supabaseAdmin.from("team_performance_uploads").delete().eq("id", uploadId);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Server error." });
  }
}
