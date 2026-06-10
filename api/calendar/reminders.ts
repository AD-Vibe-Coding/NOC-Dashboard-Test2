import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadSession } from "../auth/_lib/session.js";

const ACCESS_COOKIE = "__gcal_access";
const REFRESH_COOKIE = "__gcal_refresh";
const REMINDER_WINDOWS = [30, 15, 5] as const;
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID ?? "C09Q89PHN8M";

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(/;\s*/)) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1));
  }
  return out;
}

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!r.ok) return null;
    return await r.json() as { access_token: string; expires_in: number };
  } catch {
    return null;
  }
}

function extractMeetingLinks(event: any) {
  const conferenceUris = (event.conferenceData?.entryPoints ?? [])
    .map((entry: { uri?: string }) => entry.uri)
    .filter((value: string | undefined): value is string => Boolean(value));

  const text = [event.hangoutLink, ...conferenceUris, event.location, event.description, event.htmlLink]
    .filter(Boolean)
    .join("\n");

  const rawMatches = text.match(/(?:https?:\/\/)?(?:meet\.google\.com\/[\w-]+|[\w.-]+\.zoom(?:gov)?\.com\/\S+|teams\.microsoft\.com\/\S+|teams\.live\.com\/\S+|https?:\/\/\S+)/gi) ?? [];
  const cleaned = Array.from(new Set(rawMatches
    .map((value) => value.trim().replace(/[)>.,]+$/g, ""))
    .map((value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`))
    .filter((url) => !/google\.com\/calendar\/event|calendar\.google\.com/i.test(url))));

  const meetLinks = cleaned.filter((url) => /meet\.google\.com/i.test(url));
  const zoomLinks = cleaned.filter((url) => /zoom\.us|zoomgov\.com/i.test(url));
  const teamsLinks = cleaned.filter((url) => /teams\.microsoft\.com|teams\.live\.com/i.test(url));
  const otherLinks = cleaned.filter((url) => !/zoom\.us|zoomgov\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com/i.test(url));
  return [...meetLinks, ...zoomLinks, ...teamsLinks, ...otherLinks][0] ?? null;
}

async function lookupSlackUserIdByEmail(email: string): Promise<string | null> {
  const token = String(process.env.SLACK_BOT_TOKEN ?? "").trim();
  if (!token || !email) return null;
  try {
    const r = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json() as { ok?: boolean; user?: { id?: string } };
    return j.ok && j.user?.id ? j.user.id : null;
  } catch {
    return null;
  }
}

async function postSlackReminder(text: string, targetUserId: string | null) {
  const origin = process.env.APP_URL || process.env.VERCEL_URL;
  const base = origin ? (origin.startsWith("http") ? origin : `https://${origin}`) : "http://127.0.0.1:3000";
  const response = await fetch(`${base}/api/slack/post`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...(targetUserId ? { target_user_id: targetUserId } : {}) }),
  });
  return response.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await loadSession(req);
  if (!session?.email || !session?.name) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const cookies = parseCookies(req.headers.cookie ?? "");
  let accessToken = cookies[ACCESS_COOKIE];
  const refreshToken = cookies[REFRESH_COOKIE];

  if (!accessToken && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (refreshed) {
      accessToken = refreshed.access_token;
      const accessOpts = `; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${refreshed.expires_in}`;
      res.setHeader("Set-Cookie", `${ACCESS_COOKIE}=${encodeURIComponent(accessToken)}${accessOpts}`);
    }
  }
  if (!accessToken) return res.status(200).json({ checked: 0, sent: 0, reason: "calendar_not_connected" });

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
  const calUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  calUrl.searchParams.set("timeMin", startOfDay);
  calUrl.searchParams.set("timeMax", endOfDay);
  calUrl.searchParams.set("singleEvents", "true");
  calUrl.searchParams.set("orderBy", "startTime");
  calUrl.searchParams.set("maxResults", "50");
  calUrl.searchParams.set("fields", "items(id,summary,description,start,end,location,status,htmlLink,hangoutLink,conferenceData(entryPoints(entryPointType,uri,label),conferenceSolution(name)))");

  const gcal = await fetch(calUrl.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!gcal.ok) return res.status(200).json({ checked: 0, sent: 0, reason: "calendar_fetch_failed" });
  const payload = await gcal.json() as { items?: any[] };
  const events = (payload.items ?? []).filter((e) => e?.start?.dateTime && e?.status !== "cancelled");

  const remindersResponse = await fetch(`${req.headers.origin || "http://127.0.0.1:3000"}/api/reminder_events`);
  const existingPayload = remindersResponse.ok ? await remindersResponse.json() as any[] : [];
  const existing = Array.isArray(existingPayload) ? existingPayload : Array.isArray(existingPayload?.rows) ? existingPayload.rows : [];

  const slackUserId = await lookupSlackUserIdByEmail(session.email);
  let sent = 0;
  const triggered: string[] = [];

  for (const event of events) {
    const startMs = new Date(event.start.dateTime).getTime();
    const endMs = event.end?.dateTime ? new Date(event.end.dateTime).getTime() : startMs + 30 * 60 * 1000;
    const link = extractMeetingLinks(event);
    for (const minutes of REMINDER_WINDOWS) {
      const diffMinutes = Math.round((startMs - Date.now()) / 60000);
      if (diffMinutes < minutes - 1 || diffMinutes > minutes + 1) continue;
      const dedupeKey = `meeting:${event.id}:${minutes}`;
      if (existing.some((row: any) => row.employee_name === session.name && row.dedupe_key === dedupeKey)) continue;
      const label = minutes === 5 ? "Join now" : `${minutes}-minute reminder`;
      const timeLabel = new Date(startMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const mention = slackUserId ? `<@${slackUserId}> ` : "";
      const text = `${mention}${minutes === 5 ? ":rotating_light:" : ":spiral_calendar_pad:"} ${label} for *${event.summary || "Upcoming meeting"}* at ${timeLabel}.${link ? ` Join: ${link}` : ""}`;
      await postSlackReminder(text, slackUserId);
      await fetch(`${req.headers.origin || "http://127.0.0.1:3000"}/api/reminder_events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_name: session.name, reminder_type: `meeting_${minutes}`, dedupe_key: dedupeKey, sent_at: new Date().toISOString() }),
      });
      sent += 1;
      triggered.push(dedupeKey);
    }
    void endMs;
  }

  return res.status(200).json({ checked: events.length, sent, triggered, slackTarget: slackUserId ? "dm" : `channel:${CHANNEL_ID}` });
}
