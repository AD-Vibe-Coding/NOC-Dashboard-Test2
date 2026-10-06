import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_lib/supabase-admin.js";
import {
  cronAuthorized,
  extractMeetingLinks,
  fetchCalendarEventsForUser,
  listTrackedGoogleAccounts,
} from "../../_lib/reminder-service.js";
import { lookupByEmail } from "../../_lib/roles.js";
import { requireManager } from "../../_lib/auth-middleware.js";

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
        const canonical = email ? lookupByEmail(email) : null;
        const name = String(canonical?.name ?? account.name ?? email).trim();
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
            description: event.description || null,
            location: event.location || null,
            start_at: String(event.start?.dateTime),
            end_at: String(event.end?.dateTime || event.start?.dateTime),
            join_link: primary,
            provider,
            status: String(event.status || "confirmed"),
            raw_json: JSON.stringify({
              ...event,
              htmlLink: event.htmlLink || null,
              timeZone: event.start?.timeZone || event.end?.timeZone || null,
            }),
            synced_at: nowIso,
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
