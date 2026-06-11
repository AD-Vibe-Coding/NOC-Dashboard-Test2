/**
 * GET /api/calendar/events
 * Returns today's Google Calendar events for the authenticated user.
 * Reads access token from the __gcal_access HttpOnly cookie.
 * Auto-refreshes using __gcal_refresh if the access token is expired.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

const ACCESS_COOKIE  = "__gcal_access";
const REFRESH_COOKIE = "__gcal_refresh";

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
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token: refreshToken,
        client_id:     clientId,
        client_secret: clientSecret,
      }),
    });
    if (!r.ok) return null;
    return await r.json() as { access_token: string; expires_in: number };
  } catch {
    return null;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  const cookies      = parseCookies(req.headers.cookie ?? "");
  let   accessToken  = cookies[ACCESS_COOKIE];
  const refreshToken = cookies[REFRESH_COOKIE];

  if (!accessToken && !refreshToken) {
    return res.end(JSON.stringify({ connected: false, events: [] }));
  }

  // Try to refresh if no access token
  if (!accessToken && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (!refreshed) {
      return res.end(JSON.stringify({ connected: false, events: [], error: "Token expired — reconnect calendar" }));
    }
    accessToken = refreshed.access_token;
    const expiresIn  = refreshed.expires_in;
    const accessOpts = `; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${expiresIn}`;
    res.setHeader("Set-Cookie", `${ACCESS_COOKIE}=${encodeURIComponent(accessToken)}${accessOpts}`);
  }

  // Fetch today's events from Google Calendar primary calendar
  const now       = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
  const endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

  const calUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  calUrl.searchParams.set("timeMin",      startOfDay);
  calUrl.searchParams.set("timeMax",      endOfDay);
  calUrl.searchParams.set("singleEvents", "true");
  calUrl.searchParams.set("orderBy",      "startTime");
  calUrl.searchParams.set("maxResults",   "20");
  calUrl.searchParams.set("fields",       "items(id,summary,description,start,end,location,status,htmlLink,hangoutLink,conferenceData(entryPoints(entryPointType,uri,label),conferenceSolution(name)),colorId)");

  try {
    const r = await fetch(calUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (r.status === 401) {
      // Access token expired — try refresh
      if (refreshToken) {
        const refreshed = await refreshAccessToken(refreshToken);
        if (refreshed) {
          const r2 = await fetch(calUrl.toString(), {
            headers: { Authorization: `Bearer ${refreshed.access_token}` },
          });
          if (r2.ok) {
            const data = await r2.json() as { items?: CalendarEvent[] };
            const expiresIn  = refreshed.expires_in;
            const accessOpts = `; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${expiresIn}`;
            res.setHeader("Set-Cookie", `${ACCESS_COOKIE}=${encodeURIComponent(refreshed.access_token)}${accessOpts}`);
            // Filter out all-day events (they have start.date but no start.dateTime)
            const timedEvents = normalizeEvents((data.items ?? []).filter((e) => !!e.start.dateTime));
            return res.end(JSON.stringify({ connected: true, events: timedEvents }));
          }
        }
      }
      return res.end(JSON.stringify({ connected: false, events: [], error: "Token expired — reconnect calendar" }));
    }

    if (!r.ok) {
      const text = await r.text();
      return res.end(JSON.stringify({ connected: true, events: [], error: `Calendar API error: ${r.status} ${text.slice(0, 200)}` }));
    }

    const data = await r.json() as { items?: CalendarEvent[] };
    // Filter out all-day events (they have start.date but no start.dateTime)
    const timedEvents = normalizeEvents((data.items ?? []).filter((e) => !!e.start.dateTime));
    res.end(JSON.stringify({ connected: true, events: timedEvents }));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ connected: true, events: [], error: (e as Error).message }));
  }
}

interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end:   { dateTime?: string; date?: string };
  location?: string;
  status?: string;
  htmlLink?: string;
  hangoutLink?: string;
  joinLink?: string | null;
  conferenceData?: {
    conferenceSolution?: { name?: string };
    entryPoints?: Array<{
      entryPointType?: string;
      uri?: string;
      label?: string;
    }>;
  };
  colorId?: string;
}

function firstUrl(text?: string | null): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s<>")]+/i);
  return match?.[0] ?? null;
}

function isDirectMeetingUrl(url?: string | null): boolean {
  if (!url) return false;
  return /meet\.google\.com|zoom\.us\/(j|my|wc)|teams\.microsoft\.com|webex\.com|gotomeeting\.com|ringcentral\.com|bluejeans\.com/i.test(url);
}

function extractJoinLink(event: CalendarEvent): string | null {
  const conferenceEntryPoint = event.conferenceData?.entryPoints?.find((entry) => {
    const uri = entry.uri ?? "";
    return entry.entryPointType === "video" || entry.entryPointType === "more" || isDirectMeetingUrl(uri);
  })?.uri;

  const candidates = [
    event.hangoutLink,
    conferenceEntryPoint,
    firstUrl(event.location),
    firstUrl(event.description),
  ];

  for (const candidate of candidates) {
    if (isDirectMeetingUrl(candidate)) return candidate!;
  }

  return null;
}

function normalizeEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.map((event) => ({
    ...event,
    joinLink: extractJoinLink(event),
  }));
}
