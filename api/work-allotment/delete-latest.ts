import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireManagerAppBuilder } from "../_lib/appbuilder-auth.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { deleteSlackMessage } from "../_lib/slack.js";

function sanitizeCount(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(5, Math.floor(numeric)));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const managerSession = await requireManagerAppBuilder(req, res);
  if (!managerSession) return;

  try {
    const count = sanitizeCount(req.body?.count);
    const actor = managerSession.name ?? "Unknown manager";

    const { data: jobs, error: jobsError } = await supabaseAdmin
      .from("work_allotment_jobs")
      .select("id, operational_date, post_date, shift, slack_ts, posted_at, last_error")
      .eq("status", "posted")
      .not("slack_ts", "is", null)
      .order("posted_at", { ascending: false })
      .limit(count);

    if (jobsError) {
      return res.status(500).json({ ok: false, error: jobsError.message });
    }

    if (!jobs || jobs.length === 0) {
      return res.status(404).json({ ok: false, error: "No posted work allotment messages with Slack timestamps were found." });
    }

    const deleted = [] as Array<{ id: number; shift: string; slack_ts: string; posted_at: string | null }>;
    const failed = [] as Array<{ id: number; shift: string; slack_ts: string; error: string }>;

    for (const job of jobs) {
      const result = await deleteSlackMessage(job.slack_ts, {});
      const note = result.ok
        ? `Deleted from Slack by ${actor} on ${new Date().toISOString()}.`
        : `Slack delete failed for ${job.slack_ts} on ${new Date().toISOString()}: ${result.error}`;

      const { error: updateError } = await supabaseAdmin
        .from("work_allotment_jobs")
        .update({ last_error: note })
        .eq("id", job.id);

      if (updateError) {
        return res.status(500).json({ ok: false, error: updateError.message });
      }

      if (result.ok) {
        deleted.push({ id: job.id, shift: job.shift, slack_ts: job.slack_ts, posted_at: job.posted_at ?? null });
      } else {
        failed.push({ id: job.id, shift: job.shift, slack_ts: job.slack_ts, error: result.error ?? "slack_delete_failed" });
      }
    }

    return res.status(failed.length > 0 ? 207 : 200).json({
      ok: failed.length === 0,
      deleted,
      failed,
      requestedCount: count,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to delete the latest work allotment post(s).",
    });
  }
}
