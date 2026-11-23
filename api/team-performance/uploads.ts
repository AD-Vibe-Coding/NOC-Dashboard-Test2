import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { getTeamPerformanceViewer } from "../_lib/team-performance-access.js";

const MAX_PARSED_BYTES = 4 * 1024 * 1024;
const KINDS = new Set(["tickets", "mobility", "calls"]);
const SELECT_FIELDS = "id,kind,filename,mime_type,file_size_bytes,data_url,parsed_data,uploaded_by,created_at";

function bodyOf(req: VercelRequest): Record<string, unknown> {
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return (req.body ?? {}) as Record<string, unknown>;
}

function scopeUploadToMember(upload: Record<string, unknown>, memberName: string) {
  let parsed: Record<string, unknown> | null = null;
  try {
    const value = upload.parsed_data;
    parsed = typeof value === "string"
      ? JSON.parse(value) as Record<string, unknown>
      : value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
  } catch {
    parsed = null;
  }

  if (parsed) {
    const safeParsed = { ...parsed };
    delete safeParsed.rawRows;
    const allMembers = safeParsed.members;
    const ownData = allMembers && typeof allMembers === "object" && !Array.isArray(allMembers)
      ? (allMembers as Record<string, unknown>)[memberName]
      : undefined;
    return {
      ...upload,
      data_url: null,
      parsed_data: {
        ...safeParsed,
        members: ownData ? { [memberName]: ownData } : {},
      },
    };
  }
  return { ...upload, data_url: null, parsed_data: null };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const viewer = await getTeamPerformanceViewer(req);
    if (!viewer) {
      return res.status(403).json({ error: "Team Performance access requires an approved team account." });
    }
    const isManager = viewer.role === "manager";
    if (req.method !== "GET" && !isManager) {
      return res.status(403).json({ error: "Manager access required to modify workbook uploads." });
    }

    if (req.method === "GET") {
      const kind = typeof req.query.kind === "string" ? req.query.kind : "";
      if (!KINDS.has(kind)) return res.status(400).json({ error: "A valid upload kind is required." });

      const { data, error } = await supabaseAdmin
        .from("team_performance_uploads")
        .select(SELECT_FIELDS)
        .eq("kind", kind)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      const upload = data && !isManager
        ? scopeUploadToMember(data as unknown as Record<string, unknown>, viewer.name)
        : data;
      return res.status(200).json({ upload: upload ?? null });
    }

    if (req.method === "POST") {
      const body = bodyOf(req);
      const kind = String(body.kind ?? "");
      const filename = String(body.filename ?? "").trim().replace(/[\\/]/g, "_").slice(0, 255);
      const sourceFileBytes = Number(body.file_size_bytes);
      const parsed = body.parsed_data;
      if (!KINDS.has(kind)) return res.status(400).json({ error: "A valid upload kind is required." });
      if (!filename) return res.status(400).json({ error: "A filename is required." });
      if (!Number.isSafeInteger(sourceFileBytes) || sourceFileBytes < 0) {
        return res.status(400).json({ error: "A valid source file size is required." });
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return res.status(400).json({ error: "Parsed dashboard data is required." });
      }
      const snapshot = parsed as Record<string, unknown>;
      if (snapshot.kind !== kind || snapshot.filename !== filename || !Array.isArray(snapshot.months)) {
        return res.status(400).json({ error: "Parsed data does not match the selected workbook." });
      }

      // Defensive strip: raw source rows are stored in the dedicated table, never
      // in parsed_data (which remains capped at 4 MiB for dashboard summaries).
      const { rawRows: _rawRows, ...compactSnapshot } = snapshot;
      const parsedData = JSON.stringify(compactSnapshot);
      const parsedBytes = Buffer.byteLength(parsedData, "utf8");
      if (parsedBytes > MAX_PARSED_BYTES) {
        return res.status(413).json({ error: "The compact dashboard summary is too large to save (maximum 4 MiB)." });
      }

      // Fail before creating a visible snapshot if the separate raw-row table
      // has not yet been installed through the Supabase schema push flow.
      const { error: rawTableError } = await supabaseAdmin
        .from("team_performance_raw_rows")
        .select("id")
        .limit(0);
      if (rawTableError) {
        return res.status(503).json({ error: "Raw-row storage is not ready. Push the Supabase schema, then retry the upload." });
      }

      const { data, error } = await supabaseAdmin
        .from("team_performance_uploads")
        .insert({
          kind,
          filename,
          file_size_bytes: sourceFileBytes,
          parsed_data: compactSnapshot,
          uploaded_by: member.name,
        })
        .select("id,kind,filename,file_size_bytes,uploaded_by,created_at")
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ upload: data });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Server error." });
  }
}
