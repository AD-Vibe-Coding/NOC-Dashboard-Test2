import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_lib/supabase-admin.js";
import { invalidateMetricsCache } from "../../_lib/crud.js";

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

    // 3. If approved, overwrite the performance_metrics field
    if (action === "approve") {
      const field = dispute.field_name; // "ack_minutes" | "carrier_ticket_minutes"
      const { error: metricErr } = await supabaseAdmin
        .from("performance_metrics")
        .update({ [field]: dispute.proposed_value })
        .eq("id", dispute.metric_id);

      if (metricErr) {
        // Roll back the dispute status if the metric update fails
        await supabaseAdmin
          .from("metric_disputes")
          .update({ status: "pending", reviewed_by: null, review_note: null, reviewed_at: null })
          .eq("id", id);
        return res.status(500).json({
          error: `Dispute approved but metric update failed: ${metricErr.message}`,
        });
      }

      // Invalidate the hydrated metrics cache so dashboards reflect the correction
      invalidateMetricsCache();
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
