/**
 * POST /api/audit/push
 *
 * Pushes selected ticket audits into performance_imports + performance_metrics
 * server-side, so no client-side auth middleware is needed.
 *
 * Body: { audit_ids: number[] }
 * Response: { pushed: number, failed: number, errors: string[] }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
  const { audit_ids } = body;

  if (!Array.isArray(audit_ids) || audit_ids.length === 0) {
    return res.status(400).json({ error: "audit_ids array is required" });
  }

  // Fetch the audits
  const { data: audits, error: fetchErr } = await supabaseAdmin
    .from("ticket_audits")
    .select("*")
    .in("id", audit_ids);

  if (fetchErr) {
    return res.status(500).json({ error: fetchErr.message });
  }

  let pushed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const audit of audits ?? []) {
    try {
      if (!audit.agent_name) {
        throw new Error(`Audit #${audit.id} has no agent name — set agent before pushing`);
      }
      if (audit.overall_score === null || audit.overall_score === undefined) {
        throw new Error(`Audit #${audit.id} has no score`);
      }

      // 1. Create performance_imports row
      const { data: importRow, error: importErr } = await supabaseAdmin
        .from("performance_imports")
        .insert({
          file_name: audit.file_name,
          imported_by: "Ticket Audit Widget",
          source_type: "audit",
          sheet_name: "AI Audit",
          row_count: 1,
          matched_count: 1,
          skipped_count: 0,
          period_label: audit.audit_month ?? null,
          period_start: audit.audit_month ? `${audit.audit_month}-01` : null,
          period_end: audit.audit_month ? `${audit.audit_month}-01` : null,
          notes: `Ticket ${audit.ticket_number ?? ""} · Score: ${audit.overall_score} · ${audit.grade ?? ""}`,
        })
        .select()
        .single();

      if (importErr) throw new Error(`Import row failed: ${importErr.message}`);

      // 2. Create performance_metrics row
      let criteriaObj: Record<string, unknown> = {};
      try {
        if (audit.criteria_json) criteriaObj = JSON.parse(audit.criteria_json);
      } catch { /* ignore */ }

      const { data: metricRow, error: metricErr } = await supabaseAdmin
        .from("performance_metrics")
        .insert({
          import_id: importRow.id,
          member_name: audit.agent_name,
          source_type: "audit",
          total_count: 1,
          success_count: (audit.overall_score ?? 0) >= 70 ? 1 : 0,
          score: String(audit.overall_score),
          period_start: audit.audit_month ? `${audit.audit_month}-01` : null,
          period_end: audit.audit_month ? `${audit.audit_month}-01` : null,
          period_month: audit.audit_month ?? null,
          queue: audit.queue ?? null,
          raw_json: JSON.stringify({
            ticket_number: audit.ticket_number,
            ticket_subject: audit.ticket_subject,
            overall_score: audit.overall_score,
            grade: audit.grade,
            criteria: criteriaObj,
            file_name: audit.file_name,
            audit_id: audit.id,
          }),
        })
        .select()
        .single();

      if (metricErr) throw new Error(`Metric row failed: ${metricErr.message}`);

      // 3. Mark audit as pushed
      await supabaseAdmin
        .from("ticket_audits")
        .update({ metrics_id: metricRow.id })
        .eq("id", audit.id);

      pushed++;
    } catch (e) {
      failed++;
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return res.status(200).json({ pushed, failed, errors });
}
