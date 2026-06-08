import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { requireManager } from "./_lib/auth-middleware.js";

const TABLES = [
  "breaks",
  "break_schedules",
  "reminder_events",
  "one_on_one_notes",
  "notebook_section_preferences",
  "personal_action_items",
  "ticket_summaries",
  "escalation_drafts",
  "shift_handovers",
  "polished_emails",
  "performance_imports",
  "performance_metrics",
  "team_members",
  "manager_updates",
  "kudos",
  "shift_checklist_items",
  "kb_gaps",
  "training_completions",
  "upcoming_trainings",
  "training_requests",
  "wfh_requests",
  "user_roles",
  "user_sessions",
  "ticket_audits",
  "metric_disputes",
  "app_events",
  "zoom_queue_snapshots",
  "google_account_tokens",
] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireManager(req, res)) return;

  try {
    const results: Array<{ table: string; count: number; ok: boolean; error?: string }> = [];

    for (const table of TABLES) {
      const { count, error } = await supabaseAdmin
        .from(table)
        .select("id", { count: "exact", head: true });

      if (error) {
        results.push({ table, count: 0, ok: false, error: error.message });
      } else {
        results.push({ table, count: count ?? 0, ok: true });
      }
    }

    const totalRows = results.reduce((sum, row) => sum + (row.ok ? row.count : 0), 0);
    const nonEmptyTables = results.filter((row) => row.ok && row.count > 0).length;
    const erroredTables = results.filter((row) => !row.ok).length;

    return res.status(200).json({
      checked_at: new Date().toISOString(),
      totals: {
        total_tables: results.length,
        non_empty_tables: nonEmptyTables,
        empty_tables: results.length - nonEmptyTables,
        errored_tables: erroredTables,
        total_rows: totalRows,
      },
      tables: results,
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
