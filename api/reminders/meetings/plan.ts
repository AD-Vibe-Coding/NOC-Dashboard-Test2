import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_lib/supabase-admin.js";
import {
  buildDedupeKey,
  cronAuthorized,
  getNotificationTarget,
  getReminderPolicy,
  reminderOffsetsFromPolicy,
} from "../../_lib/reminder-service.js";

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
    const now = Date.now();
    const horizonIso = new Date(now + 36 * 60 * 60 * 1000).toISOString();
    const nowIso = new Date(now).toISOString();

    const { data: meetings, error: meetingError } = await supabaseAdmin
      .from("calendar_meetings")
      .select("*")
      .gte("start_at", nowIso)
      .lte("start_at", horizonIso)
      .neq("status", "cancelled")
      .order("start_at", { ascending: true });
    if (meetingError) throw meetingError;

    const { data: existingJobs } = await supabaseAdmin
      .from("meeting_reminder_jobs")
      .select("dedupe_key")
      .gte("meeting_start_at", nowIso)
      .lte("meeting_start_at", horizonIso);
    const { data: sentRows } = await supabaseAdmin
      .from("reminder_events")
      .select("dedupe_key")
      .gte("sent_at", new Date(now - 24 * 60 * 60 * 1000).toISOString());

    const existing = new Set([...(existingJobs ?? []).map((row: any) => row.dedupe_key), ...(sentRows ?? []).map((row: any) => row.dedupe_key)]);
    const jobsToInsert: any[] = [];

    for (const meeting of meetings ?? []) {
      const policy = await getReminderPolicy(meeting.employee_name, meeting.employee_email);
      if (!policy?.meeting_enabled) continue;
      if (policy.only_with_join_link && !meeting.join_link) continue;

      const target = await getNotificationTarget(meeting.employee_name, meeting.employee_email);
      if (!target) continue;

      const offsets = reminderOffsetsFromPolicy(policy);
      const startMs = new Date(meeting.start_at).getTime();
      const endMs = new Date(meeting.end_at).getTime();
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= now) continue;

      for (const offset of offsets) {
        const scheduledFor = new Date(startMs - offset * 60 * 1000).toISOString();
        const dedupeKey = buildDedupeKey({
          employeeName: meeting.employee_name,
          calendarEventId: meeting.calendar_event_id,
          meetingStartAt: meeting.start_at,
          offsetMinutes: offset,
        });
        if (existing.has(dedupeKey)) continue;
        existing.add(dedupeKey);

        jobsToInsert.push({
          employee_name: meeting.employee_name,
          employee_email: meeting.employee_email,
          calendar_event_id: meeting.calendar_event_id,
          meeting_start_at: meeting.start_at,
          reminder_offset_minutes: offset,
          scheduled_for: scheduledFor,
          status: "pending",
          dedupe_key: dedupeKey,
          slack_target_type: target.channel_type,
          slack_target_id: target.slack_user_id || target.slack_channel_id || null,
          join_link: meeting.join_link,
          payload_json: JSON.stringify({
            title: meeting.title,
            provider: meeting.provider,
            timeLabel: new Date(meeting.start_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
            htmlLink: meeting.html_link,
          }),
          attempt_count: 0,
          next_attempt_at: scheduledFor,
        });
      }
    }

    if (jobsToInsert.length > 0) {
      const { error } = await supabaseAdmin.from("meeting_reminder_jobs").insert(jobsToInsert);
      if (error) throw error;
    }

    return res.status(200).json({ ok: true, planned: jobsToInsert.length });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
