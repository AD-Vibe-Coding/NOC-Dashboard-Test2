import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_lib/supabase-admin.js";
import {
  cronAuthorized,
  extractMeetingLinks,
  fetchCalendarEventsForUser,
  listTrackedGoogleAccounts,
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
    const accounts = await listTrackedGoogleAccounts();
    let users = 0;
    let meetings = 0;
    const errors: Array<{ email: string; error: string }> = [];

    for (const account of accounts) {
      try {
        const events = await fetchCalendarEventsForUser(account, 36);
        const email = String(account.email ?? "").trim().toLowerCase();
        const name = String(account.name ?? email).trim();
        const nowIso = new Date().toISOString();

        await supabaseAdmin
          .from("calendar_meetings")
          .delete()
          .eq("employee_email", email);

        const rows = events.map((event: any) => {
          const { primary, provider } = extractMeetingLinks(event);
          return {
            employee_name: name,
            employee_email: email,
            calendar_event_id: String(event.id),
            title: String(event.summary || "Untitled event"),
            start_at: String(event.start?.dateTime),
            end_at: String(event.end?.dateTime || event.start?.dateTime),
            timezone: event.start?.timeZone || event.end?.timeZone || null,
            status: String(event.status || "confirmed"),
            html_link: event.htmlLink || null,
            join_link: primary,
            provider,
            location: event.location || null,
            source_hash: JSON.stringify({
              title: event.summary || "",
              start: event.start?.dateTime || null,
              end: event.end?.dateTime || null,
              status: event.status || null,
              join: primary,
            }),
            last_synced_at: nowIso,
          };
        });

        if (rows.length > 0) {
          const { error } = await supabaseAdmin.from("calendar_meetings").insert(rows);
          if (error) throw error;
        }

        users += 1;
        meetings += rows.length;
      } catch (error) {
        errors.push({ email: String(account.email ?? "unknown"), error: error instanceof Error ? error.message : String(error) });
      }
    }

    return res.status(200).json({ ok: true, users, meetings, errors });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
