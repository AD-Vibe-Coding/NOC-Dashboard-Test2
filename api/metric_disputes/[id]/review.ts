import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_lib/supabase-admin.js";
import { invalidateMetricsCache } from "../../_lib/crud.js";
import { requireManager } from "../../_lib/auth-middleware.js";
import { loadSession } from "../../auth/_lib/session.js";
import { lookupByEmail } from "../../_lib/roles.js";

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

    // 2. Update the dispute record
    const { error: updateErr } = await supabaseAdmin
      .from("metric_disputes")
      .update({
        status: action === "approve" ? "approved" : "rejected",
        reviewed_by,
        review_note: review_note ?? null,
        reviewed_at: now,
      })
      .eq("id", id);

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message });
    }

    // 3. If approved, overwrite the legacy metric or the source workbook cell.
    if (action === "approve") {
      let overwriteError: string | null = null;
      if (dispute.raw_row_id != null) {
        const columnIndex = dispute.field_name === "carrier_ticket_minutes"
          ? 32
          : dispute.field_name === "ack_minutes"
            ? 39
            : null;
        const proposed = Number(dispute.proposed_value);
        if (columnIndex == null || !Number.isFinite(proposed) || proposed < 0) {
          overwriteError = "Raw-row disputes require a valid ticket-time field and proposed value.";
        } else {
          const { data: rawRow, error: rawRowError } = await supabaseAdmin
            .from("team_performance_raw_rows")
            .select("cells")
            .eq("id", dispute.raw_row_id)
            .maybeSingle();
          if (rawRowError || !rawRow) {
            overwriteError = rawRowError?.message ?? "The source workbook row no longer exists.";
          } else {
            // The source parser treats numeric values below one as Excel day fractions.
            // Store sub-minute corrections as mm:ss strings to preserve their meaning.
            const totalSeconds = Math.round(proposed * 60);
            const valueToStore = proposed > 0 && proposed < 1
              ? `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`
              : proposed;
            const cells = rawRow.cells && typeof rawRow.cells === "object" && !Array.isArray(rawRow.cells)
              ? rawRow.cells as Record<string, unknown>
              : {};
            const { error: rawUpdateError } = await supabaseAdmin
              .from("team_performance_raw_rows")
              .update({ cells: { ...cells, [String(columnIndex)]: valueToStore } })
              .eq("id", dispute.raw_row_id);
            if (rawUpdateError) overwriteError = rawUpdateError.message;
          }
        }
      } else if (dispute.metric_id != null) {
        const field = dispute.field_name;
        if (field !== "ack_minutes" && field !== "carrier_ticket_minutes") {
          overwriteError = "Unsupported metric dispute field.";
        } else {
          const { error: metricErr } = await supabaseAdmin
            .from("performance_metrics")
            .update({ [field]: dispute.proposed_value })
            .eq("id", dispute.metric_id);
          if (metricErr) overwriteError = metricErr.message;
          else invalidateMetricsCache();
        }
      } else {
        overwriteError = "This dispute has no linked metric or raw source row.";
      }

      if (overwriteError) {
        await supabaseAdmin
          .from("metric_disputes")
          .update({ status: "pending", reviewed_by: null, review_note: null, reviewed_at: null })
          .eq("id", id);
        return res.status(500).json({ error: `Dispute approved but source update failed: ${overwriteError}` });
      }
    }

    return res.status(200).json({
      ok: true,
      status: action === "approve" ? "approved" : "rejected",
      dispute_id: id,
      metric_id: dispute.metric_id,
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Server error",
    });
  }
}
