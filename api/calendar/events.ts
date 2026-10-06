/**
 * GET /api/calendar/events
 * Returns today's Google Calendar events for the authenticated user.
 * Primary path: use the signed-in user's persisted Google token row.
 * Fallback path: legacy calendar cookies from the older manual connect flow.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadSession } from "../auth/_lib/session.js";
import { getValidGoogleAccessToken } from "../_lib/google-gmail.js";
import { lookupByEmail } from "../_lib/roles.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

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

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number; token_type?: string; scope?: string } | null> {
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
    return await r.json() as { access_token: string; expires_in: number; token_type?: string; scope?: string };
  } catch {
    return null;
  }
}

async function fetchGoogleProfile(accessToken: string) {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.sub || !payload?.email) {
    throw new Error("Failed to load Google profile for reminder tracking.");
  }
  const email = String(payload.email).trim().toLowerCase();
  const canonical = email ? lookupByEmail(email) : null;
  return {
    google_sub: String(payload.sub),
    email,
    name: canonical?.name ?? (typeof payload.name === "string" ? payload.name.trim() : ""),
  };
}

async function persistGoogleAccountTokens(params: {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType?: string;
  scope?: string;
}) {
  const profile = await fetchGoogleProfile(params.accessToken);
  const expiresAt = new Date(Date.now() + Number(params.expiresIn || 3600) * 1000).toISOString();
  const nowIso = new Date().toISOString();

  const { data: existingRows, error: lookupError } = await supabaseAdmin
    .from("google_account_tokens")
    .select("id, refresh_token")
    .eq("email", profile.email)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (lookupError) throw new Error(lookupError.message);

  const existing = existingRows?.[0] ?? null;
  const refreshToken = params.refreshToken || existing?.refresh_token || null;

  if (existing?.id) {
    const { error } = await supabaseAdmin
      .from("google_account_tokens")
      .update({
        google_sub: profile.google_sub,
        email: profile.email,
        name: profile.name || profile.email,
        access_token: params.accessToken,
        refresh_token: refreshToken,
        token_type: params.tokenType || null,
        granted_scopes: params.scope || null,
        expires_at: expiresAt,
        updated_at: nowIso,
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabaseAdmin
    .from("google_account_tokens")
    .insert({
      google_sub: profile.google_sub,
      email: profile.email,
      name: profile.name || profile.email,
      access_token: params.accessToken,
      refresh_token: refreshToken,
      token_type: params.tokenType || null,
      granted_scopes: params.scope || null,
      expires_at: expiresAt,
      updated_at: nowIso,
    });
  if (error) throw new Error(error.message);
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  const session = await loadSession(req);
  const sessionEmail = String(session?.email ?? "").trim().toLowerCase();
  const cookies = parseCookies(req.headers.cookie ?? "");
  let accessToken = "";
  const refreshToken = cookies[REFRESH_COOKIE];
  let usingLegacyCookieFlow = false;
  let refreshedTokenMeta: { expires_in: number; token_type?: string; scope?: string } | null = null;

  if (sessionEmail) {
    try {
      accessToken = await getValidGoogleAccessToken(sessionEmail, { requiredScope: "calendar.readonly" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const hasLegacyCookies = Boolean(cookies[ACCESS_COOKIE] || refreshToken);
      if (!hasLegacyCookies) {
        return res.end(JSON.stringify({ connected: false, events: [], error: message }));
      }
    }
  }

  if (!accessToken) {
    accessToken = cookies[ACCESS_COOKIE] || "";
    usingLegacyCookieFlow = Boolean(accessToken || refreshToken);
  }

  if (!accessToken && !refreshToken) {
    return res.end(JSON.stringify({ connected: false, events: [] }));
  }

  // Legacy fallback: try to refresh if no access token
  if (!accessToken && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (!refreshed) {
      return res.end(JSON.stringify({ connected: false, events: [], error: "Your Google Calendar access has expired. Please sign out and sign in again." }));
    }
    accessToken = refreshed.access_token;
    refreshedTokenMeta = {
      expires_in: refreshed.expires_in,
      token_type: refreshed.token_type,
      scope: refreshed.scope,
    };
    const expiresIn  = refreshed.expires_in;
    const accessOpts = `; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${expiresIn}`;
    res.setHeader("Set-Cookie", `${ACCESS_COOKIE}=${encodeURIComponent(accessToken)}${accessOpts}`);
  }

  if (sessionEmail && usingLegacyCookieFlow && accessToken) {
    try {
      await persistGoogleAccountTokens({
        accessToken,
        refreshToken: refreshToken || undefined,
        expiresIn: refreshedTokenMeta?.expires_in ?? 3600,
        tokenType: refreshedTokenMeta?.token_type,
        scope: refreshedTokenMeta?.scope,
      });
    } catch {
      // Non-fatal: the personal calendar view can still work even if reminder tracking backfill fails.
    }
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
      // Persisted sign-in tokens are refreshed server-side by getValidGoogleAccessToken().
      // Only the legacy cookie flow needs an explicit refresh retry here.
      if (usingLegacyCookieFlow && refreshToken) {
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
      return res.end(JSON.stringify({ connected: false, events: [], error: "Your Google Calendar access has expired. Please sign out and sign in again." }));
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
