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
      let criteriaObj: Record<string, number> = {};
      try {
        if (audit.criteria_json) criteriaObj = JSON.parse(audit.criteria_json);
      } catch { /* ignore */ }

      // Map the 6 exact criteria to their column names
      const CRITERIA_KEYS: Record<string, string> = {
        "Response & Timeliness":        "response_timeliness",
        "Data Quality & Completeness":  "data_quality",
        "Communication Quality":        "communication_quality",
        "Process & Workflow Compliance":"process_compliance",
        "Technical Handling":           "technical_handling",
        "Closure & Documentation":      "closure_documentation",
      };

      const criteriaScores: Record<string, number | null> = {};
      for (const [label, key] of Object.entries(CRITERIA_KEYS)) {
        criteriaScores[key] = criteriaObj[label] ?? null;
      }

      const { data: metricRow, error: metricErr } = await supabaseAdmin
        .from("performance_metrics")
        .insert({
          import_id: importRow.id,
          member_name: audit.agent_name,
          source_type: "audit",
          total_count: 1,
          success_count: (audit.overall_score ?? 0) >= 70 ? 1 : 0,
          score: String(audit.overall_score),
          period_start: audit.ticket_date ?? (audit.audit_month ? `${audit.audit_month}-01` : null),
          period_end:   audit.ticket_date ?? (audit.audit_month ? `${audit.audit_month}-01` : null),
          period_month: audit.audit_month ?? null,
          queue: audit.queue ?? null,
          raw_json: JSON.stringify({
            // ── Exact columns the user specified ──────────────────────
            date:                   audit.ticket_date ?? audit.audit_month ?? null,
            ticket_owner:           audit.agent_name,
            ticket_number:          audit.ticket_number ?? null,
            response_timeliness:    criteriaScores.response_timeliness,
            data_quality:           criteriaScores.data_quality,
            communication_quality:  criteriaScores.communication_quality,
            process_compliance:     criteriaScores.process_compliance,
            technical_handling:     criteriaScores.technical_handling,
            closure_documentation:  criteriaScores.closure_documentation,
            total_score:            audit.overall_score,
            what_did_well:          audit.what_did_well ?? null,
            what_missed:            audit.what_missed ?? null,
            // ── Additional context ─────────────────────────────────────
            ticket_subject:         audit.ticket_subject ?? null,
            grade:                  audit.grade ?? null,
            file_name:              audit.file_name,
            audit_id:               audit.id,
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
