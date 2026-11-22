import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_lib/supabase-admin.js";
import { invalidateMetricsCache } from "../../_lib/crud.js";
import { requireManager } from "../../_lib/auth-middleware.js";
import { loadSession } from "../../auth/_lib/session.js";
import { lookupByEmail } from "../../_lib/roles.js";

const TICKET_REFERENCE_HEADERS = new Set([
  "troubleid",
  "troubleticketid",
  "troubleticketnumber",
  "ticketid",
  "ticketnumber",
  "referencenumber",
  "refnumber",
]);

type LegacyRawRowLookup =
  | { status: "matched"; rawRowId: number }
  | { status: "missing" }
  | { status: "ambiguous" }
  | { status: "error"; message: string };

/** Recover an old missing raw_row_id only when ticket + technician resolve uniquely. */
async function findLegacyRawRow(dispute: {
  ticket_ref: string | null;
  submitted_by: string;
  created_at: string;
}): Promise<LegacyRawRowLookup> {
  const ticketRef = String(dispute.ticket_ref ?? "").trim();
  const memberName = String(dispute.submitted_by ?? "").trim();
  if (!ticketRef || !memberName) return { status: "missing" };

  const { data: uploads, error: uploadsError } = await supabaseAdmin
    .from("team_performance_uploads")
    .select("id,parsed_data")
    .eq("kind", "tickets")
    .lte("created_at", dispute.created_at)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (uploadsError) return { status: "error", message: uploadsError.message };
  if ((uploads ?? []).length >= 1000) {
    return { status: "ambiguous" };
  }

  const matches: number[] = [];
  for (const upload of uploads ?? []) {
    const parsed = upload.parsed_data && typeof upload.parsed_data === "object"
      ? upload.parsed_data as Record<string, unknown>
      : {};
    const rawHeaders = Array.isArray(parsed.rawHeaders)
      ? parsed.rawHeaders.map((header) => String(header ?? ""))
      : [];
    const headerIndex = rawHeaders.findIndex((header) =>
      TICKET_REFERENCE_HEADERS.has(header.toLowerCase().replace(/[^a-z0-9]/g, ""))
    );
    // The raw-reference UI uses column A when the workbook has no recognized ID header.
    const ticketColumn = headerIndex >= 0 ? headerIndex : 0;
    const { data: rows, error: rowsError } = await supabaseAdmin
      .from("team_performance_raw_rows")
      .select("id")
      .eq("upload_id", upload.id)
      .eq("member_name", memberName)
      .filter(`cells->>${ticketColumn}`, "eq", ticketRef)
      .limit(2);
    if (rowsError) return { status: "error", message: rowsError.message };
    for (const row of rows ?? []) matches.push(Number(row.id));
    if (matches.length > 1) return { status: "ambiguous" };
  }

  return matches.length === 1
    ? { status: "matched", rawRowId: matches[0] }
    : { status: "missing" };
}

/**
 * POST /api/metric_disputes/:id/review
 *
 * Body: { action: "approve" | "reject", reviewed_by: string, review_note?: string }
 *
 * On approve:  updates metric_disputes status → "approved",
 *              THEN overwrites the performance_metrics row's field with proposed_value.
 * On reject:   updates metric_disputes status → "rejected", original value untouched.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Google OAuth uses the encrypted __appbuilder_session cookie; development
  // login still uses the legacy noc_session JWT. Authorize from the verified
  // server session and current roster mapping, never from client-supplied role.
  const oauthSession = await loadSession(req);
  if (oauthSession) {
    const verifiedRole = oauthSession.email
      ? lookupByEmail(oauthSession.email.toLowerCase())?.role
      : null;
    if (verifiedRole !== "manager") {
      return res.status(403).json({
        error: "Manager access required.",
        hint: "Sign in with a manager account to use this feature.",
      });
    }
  } else if (!requireManager(req, res)) {
    return;
  }

  const id = Number(req.query.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid dispute ID" });
  }

  const { action, reviewed_by, review_note } = req.body ?? {};
  if (action !== "approve" && action !== "reject") {
    return res.status(400).json({ error: 'action must be "approve" or "reject"' });
  }
  if (!reviewed_by || typeof reviewed_by !== "string") {
    return res.status(400).json({ error: "reviewed_by is required" });
  }

  try {
    // 1. Fetch the dispute
    const { data: dispute, error: fetchErr } = await supabaseAdmin
      .from("metric_disputes")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !dispute) {
      return res.status(404).json({ error: "Dispute not found" });
    }

    if (dispute.status !== "pending") {
      return res.status(409).json({
        error: `Dispute already ${dispute.status} — cannot review again`,
      });
    }

    const now = new Date().toISOString();

    // Rejection does not mutate a source row, so it can be recorded directly.
    if (action === "reject") {
      const { data: rejected, error: rejectErr } = await supabaseAdmin
        .from("metric_disputes")
        .update({ status: "rejected", reviewed_by, review_note: review_note ?? null, reviewed_at: now })
        .eq("id", id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (rejectErr) return res.status(500).json({ error: rejectErr.message });
      if (!rejected) return res.status(409).json({ error: "This dispute was reviewed by someone else." });
      return res.status(200).json({ ok: true, status: "rejected", dispute_id: id, metric_id: dispute.metric_id });
    }

    // Approvals require an unambiguous source. Older raw-row disputes may
    // lack raw_row_id but still have the exact upload/member/month/Excel-row
    // tuple saved in source_context; only accept a single exact match.
    let rawRowId: number | null = dispute.raw_row_id == null ? null : Number(dispute.raw_row_id);
    if (rawRowId == null && dispute.metric_id == null && dispute.source_context) {
      try {
        const context = JSON.parse(dispute.source_context) as Record<string, unknown>;
        const uploadId = Number(context.uploadId);
        const sourceRow = Number(context.sourceRow);
        const memberName = typeof context.memberName === "string" ? context.memberName.trim() : "";
        const monthKey = typeof context.monthKey === "string" ? context.monthKey : "";
        if (
          context.source === "team_performance_raw_rows" &&
          Number.isSafeInteger(uploadId) && uploadId > 0 &&
          Number.isSafeInteger(sourceRow) && sourceRow > 0 &&
          memberName && /^\d{4}-\d{2}$/.test(monthKey)
        ) {
          const { data: matches, error: matchErr } = await supabaseAdmin
            .from("team_performance_raw_rows")
            .select("id")
            .eq("upload_id", uploadId)
            .eq("member_name", memberName)
            .eq("month_key", monthKey)
            .eq("source_row", sourceRow)
            .limit(2);
          if (matchErr) return res.status(500).json({ error: `Could not resolve dispute source: ${matchErr.message}` });
          if ((matches ?? []).length > 1) {
            return res.status(409).json({ error: "More than one source row matches this dispute. It remains pending for manual review." });
          }
          if (matches?.length === 1) rawRowId = Number(matches[0].id);
        }
      } catch {
        // Invalid or legacy context is not sufficient to identify a source.
      }
    }

    if (rawRowId == null && dispute.metric_id == null) {
      const lookup = await findLegacyRawRow(dispute);
      if (lookup.status === "matched") {
        rawRowId = lookup.rawRowId;
      } else if (lookup.status === "ambiguous") {
        return res.status(409).json({
          error: `Ticket #${dispute.ticket_ref ?? "(unknown)"} matches multiple possible source rows. The dispute remains pending; no row was changed.`,
        });
      } else if (lookup.status === "error") {
        return res.status(500).json({ error: `Could not search for the legacy dispute source: ${lookup.message}` });
      } else {
        return res.status(409).json({
          error: `No unique source row was found for ticket #${dispute.ticket_ref ?? "(unknown)"} and ${dispute.submitted_by}. The dispute remains pending; no row was changed. Re-upload the original ticket workbook if its raw rows are not available.`,
        });
      }
    }

    let rollbackSource: (() => Promise<string | null>) | null = null;
    let sourceKind: "raw" | "metric" | null = null;
    if (rawRowId != null) {
      const columnIndex = dispute.field_name === "carrier_ticket_minutes"
        ? 32
        : dispute.field_name === "ack_minutes"
          ? 39
          : null;
      const proposed = Number(dispute.proposed_value);
      if (columnIndex == null || !Number.isFinite(proposed) || proposed < 0) {
        return res.status(400).json({ error: "Raw-row disputes require a valid ticket-time field and proposed value. The dispute remains pending." });
      }
      const { data: rawRow, error: rawRowError } = await supabaseAdmin
        .from("team_performance_raw_rows")
        .select("id,cells")
        .eq("id", rawRowId)
        .maybeSingle();
      if (rawRowError || !rawRow) {
        return res.status(409).json({ error: rawRowError?.message ?? "The linked source workbook row no longer exists. The dispute remains pending." });
      }

      // Store sub-minute corrections as mm:ss to avoid Excel day-fraction parsing.
      const totalSeconds = Math.round(proposed * 60);
      const valueToStore: string | number = proposed > 0 && proposed < 1
        ? `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`
        : proposed;
      const key = String(columnIndex);
      const priorCells = rawRow.cells && typeof rawRow.cells === "object" && !Array.isArray(rawRow.cells)
        ? rawRow.cells as Record<string, unknown>
        : {};
      const hadPriorValue = Object.prototype.hasOwnProperty.call(priorCells, key);
      const priorValue = priorCells[key];
      const { data: sourceUpdated, error: rawUpdateError } = await supabaseAdmin
        .from("team_performance_raw_rows")
        .update({ cells: { ...priorCells, [key]: valueToStore } })
        .eq("id", rawRowId)
        .select("id")
        .maybeSingle();
      if (rawUpdateError || !sourceUpdated) {
        return res.status(500).json({ error: `Source row was not updated; the dispute remains pending. ${rawUpdateError?.message ?? "Source row not found."}` });
      }
      sourceKind = "raw";
      rollbackSource = async () => {
        const { data: current, error: readErr } = await supabaseAdmin
          .from("team_performance_raw_rows").select("cells").eq("id", rawRowId).maybeSingle();
        if (readErr || !current) return readErr?.message ?? "Source row disappeared during rollback.";
        const currentCells = current.cells && typeof current.cells === "object" && !Array.isArray(current.cells)
          ? current.cells as Record<string, unknown>
          : {};
        if (JSON.stringify(currentCells[key]) !== JSON.stringify(valueToStore)) return "Source cell changed again; automatic rollback was skipped.";
        const restoredCells = { ...currentCells };
        if (hadPriorValue) restoredCells[key] = priorValue;
        else delete restoredCells[key];
        const { error } = await supabaseAdmin.from("team_performance_raw_rows").update({ cells: restoredCells }).eq("id", rawRowId);
        return error?.message ?? null;
      };
    } else if (dispute.metric_id != null) {
      const field = dispute.field_name;
      if (field !== "ack_minutes" && field !== "carrier_ticket_minutes") {
        return res.status(400).json({ error: "Unsupported metric dispute field. The dispute remains pending." });
      }
      const { data: metric, error: metricReadError } = await supabaseAdmin
        .from("performance_metrics")
        .select(`id,${field}`)
        .eq("id", dispute.metric_id)
        .maybeSingle();
      if (metricReadError || !metric) {
        return res.status(409).json({ error: metricReadError?.message ?? "The linked metric no longer exists. The dispute remains pending." });
      }
      const priorValue = metric[field];
      const { data: sourceUpdated, error: metricErr } = await supabaseAdmin
        .from("performance_metrics")
        .update({ [field]: dispute.proposed_value })
        .eq("id", dispute.metric_id)
        .select("id")
        .maybeSingle();
      if (metricErr || !sourceUpdated) {
        return res.status(500).json({ error: `Source metric was not updated; the dispute remains pending. ${metricErr?.message ?? "Metric not found."}` });
      }
      sourceKind = "metric";
      rollbackSource = async () => {
        const { data: current, error: readErr } = await supabaseAdmin
          .from("performance_metrics").select(`id,${field}`).eq("id", dispute.metric_id).maybeSingle();
        if (readErr || !current) return readErr?.message ?? "Source metric disappeared during rollback.";
        if (Number(current[field]) !== Number(dispute.proposed_value)) return "Source metric changed again; automatic rollback was skipped.";
        const { error } = await supabaseAdmin.from("performance_metrics").update({ [field]: priorValue }).eq("id", dispute.metric_id);
        return error?.message ?? null;
      };
    } else {
      return res.status(409).json({
        error: "This legacy dispute has no linked source row and no unique source context. It remains pending; submit a new dispute from the source row to link it safely.",
      });
    }

    // Mark approved only after the source write succeeds. If finalizing the
    // dispute fails, compensate by restoring the source value where safe.
    const { data: approved, error: approveErr } = await supabaseAdmin
      .from("metric_disputes")
      .update({ status: "approved", reviewed_by, review_note: review_note ?? null, reviewed_at: now })
      .eq("id", id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (approveErr || !approved) {
      const { data: latest } = await supabaseAdmin.from("metric_disputes").select("status").eq("id", id).maybeSingle();
      const alreadyApproved = latest?.status === "approved";
      const rollbackError = !alreadyApproved && rollbackSource ? await rollbackSource() : null;
      if (sourceKind === "metric" && !rollbackError) invalidateMetricsCache();
      const detail = approveErr?.message ?? (alreadyApproved ? "Another manager already approved this dispute." : "The dispute was reviewed by someone else.");
      return res.status(409).json({
        error: rollbackError
          ? `Could not finalize the dispute (${detail}); source rollback also failed: ${rollbackError}`
          : `${detail} Source update was rolled back where safe.`,
      });
    }

    if (sourceKind === "metric") invalidateMetricsCache();
    return res.status(200).json({ ok: true, status: "approved", dispute_id: id, metric_id: dispute.metric_id });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Server error",
    });
  }
}
