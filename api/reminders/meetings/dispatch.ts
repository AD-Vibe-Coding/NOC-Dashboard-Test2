import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_lib/supabase-admin.js";
import { postSlackMessage } from "../../_lib/slack.js";
import { buildDedupeKey, cronAuthorized, reminderMessageForJob } from "../../_lib/reminder-service.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const authorized = cronAuthorized(req);
  if (!authorized) {
    if (req.method !== "POST") {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!requireManager(req, res)) return;
  }

  try {
    const nowIso = new Date().toISOString();
    const workerId = `vercel-${Date.now()}`;
    const { data: jobs, error } = await supabaseAdmin
      .from("meeting_reminder_jobs")
      .select("*")
      .in("status", ["pending", "failed"])
      .lte("next_attempt_at", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(25);
    if (error) throw error;

    let sent = 0;
    let failed = 0;

    for (const job of jobs ?? []) {
      await supabaseAdmin
        .from("meeting_reminder_jobs")
        .update({ status: "sending", locked_at: nowIso, locked_by: workerId })
        .eq("id", job.id)
        .in("status", ["pending", "failed"]);

      try {
        const text = reminderMessageForJob(job);
        const result = await postSlackMessage(text, {
          target_user_id: job.slack_target_type === "slack_dm" ? job.slack_target_id : undefined,
          username: "Meeting Reminder",
          icon_emoji: Number(job.reminder_offset_minutes) === 5 ? ":rotating_light:" : ":spiral_calendar_pad:",
        });

        if (!result?.posted && !result?.demo) {
          throw new Error(result?.error || "Slack send failed");
        }

        await supabaseAdmin.from("meeting_reminder_jobs").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          last_error: null,
          locked_at: null,
          locked_by: null,
          attempt_count: Number(job.attempt_count ?? 0) + 1,
        }).eq("id", job.id);

        const dedupeKey = job.dedupe_key || buildDedupeKey({
          employeeName: job.employee_name,
          calendarEventId: job.calendar_event_id,
          meetingStartAt: job.meeting_start_at,
          offsetMinutes: job.reminder_offset_minutes,
        });
        await supabaseAdmin.from("reminder_events").insert({
          employee_name: job.employee_name,
          reminder_type: "meeting",
          dedupe_key: dedupeKey,
          sent_at: new Date().toISOString(),
        });
        sent += 1;
      } catch (sendError) {
        const nextAttemptCount = Number(job.attempt_count ?? 0) + 1;
        const retryMinutes = Math.min(10, Math.max(1, nextAttemptCount * 2));
        const nextAttemptAt = new Date(Date.now() + retryMinutes * 60 * 1000).toISOString();
        await supabaseAdmin.from("meeting_reminder_jobs").update({
          status: nextAttemptCount >= 5 ? "dead_letter" : "failed",
          last_error: sendError instanceof Error ? sendError.message : String(sendError),
          attempt_count: nextAttemptCount,
          next_attempt_at: nextAttemptCount >= 5 ? null : nextAttemptAt,
          locked_at: null,
          locked_by: null,
        }).eq("id", job.id);
        failed += 1;
      }
    }

    return res.status(200).json({ ok: true, processed: (jobs ?? []).length, sent, failed });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
