import { supabaseAdmin } from "./supabase-admin.js";

const SLACK_USER_BY_CANONICAL_MEMBER = {
  "abhishek benarji": "U09PWVD4BU6",
  "akash hanvate": "U09PVHEKRGV",
  "anirudh kukudala": "U09Q2HK9HJQ",
  "mohammed ashraf": "U09PX02N8MU",
  "hamza rahmani": "U09PZ1RCZGS",
  "karthik damagalla": "U09PSJVFJF5",
  "karthik radhakrishnan": "U09QBTS7F8R",
  "kenya gentry": "U09J2RJUBMF",
  "lokesh naik banavath": "U09PVHC696H",
  "akram ahmed": "U09PVH91ESZ",
  "otukho olembo": "U09J2RFJBUZ",
  "perry cox": "U09J2RL9X1P",
  "pranav dandibhotla": "U09PX009L22",
  "mahalakshmi samiti": "U09QBU1R4KB",
  "sriram parisa": "U09QT9ZS5EC",
  "mohammed zubairuddin": "U09PZ1M7QM8",
};

const SLACK_NAME_ALIASES = {
  "abishek benarji": "abhishek benarji",
  "abhishek benarji - ab": "abhishek benarji",
  "ashraf mohammed": "mohammed ashraf",
  "hamza rahmani umme": "hamza rahmani",
  "lokesh banavath": "lokesh naik banavath",
  "mohammed akram ahmed": "akram ahmed",
  "samiti mahalakshmi": "mahalakshmi samiti",
  "zubair mohammed": "mohammed zubairuddin",
};

export const REMINDER_STEPS = [30, 15, 5];
export const DEFAULT_TIMEZONE = "America/Los_Angeles";

export function normalizeMemberName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\s*[-|:]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function defaultSlackUserIdFor(name) {
  const normalized = normalizeMemberName(name);
  const aliased = SLACK_NAME_ALIASES[normalized] ?? normalized;
  return SLACK_USER_BY_CANONICAL_MEMBER[aliased] ?? null;
}

export function cronAuthorized(req) {
  const cronHeader = req.headers["x-vercel-cron"];
  if (cronHeader) return true;
  const auth = String(req.headers.authorization ?? "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const expected = process.env.REMINDER_CRON_SECRET ?? "";
  if (!expected) return process.env.NODE_ENV !== "production";
  return token === expected;
}

export function extractMeetingLinks(event) {
  const conferenceUris = (event.conferenceData?.entryPoints ?? [])
    .map((entry) => entry.uri)
    .filter(Boolean);

  const text = [
    event.hangoutLink,
    ...conferenceUris,
    event.location,
    event.description,
    event.htmlLink,
  ].filter(Boolean).join("\n");

  const rawMatches = text.match(/(?:https?:\/\/)?(?:meet\.google\.com\/[\w-]+|[\w.-]+\.zoom(?:gov)?\.com\/\S+|teams\.microsoft\.com\/\S+|teams\.live\.com\/\S+|https?:\/\/\S+)/gi) ?? [];
  const cleaned = Array.from(new Set(rawMatches
    .map((value) => value.trim().replace(/[)>.,]+$/g, ""))
    .map((value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`))
    .filter((url) => !/google\.com\/calendar\/event|calendar\.google\.com/i.test(url))));

  const meetLinks = cleaned.filter((url) => /meet\.google\.com/i.test(url));
  const zoomLinks = cleaned.filter((url) => /zoom\.us|zoomgov\.com/i.test(url));
  const teamsLinks = cleaned.filter((url) => /teams\.microsoft\.com|teams\.live\.com/i.test(url));
  const otherLinks = cleaned.filter((url) => !/zoom\.us|zoomgov\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com/i.test(url));
  const ranked = [...meetLinks, ...zoomLinks, ...teamsLinks, ...otherLinks];
  const primary = ranked[0] ?? null;
  const provider = primary
    ? /meet\.google\.com/i.test(primary)
      ? "Google Meet"
      : /zoom\.us|zoomgov\.com/i.test(primary)
        ? "Zoom"
        : /teams\.microsoft\.com|teams\.live\.com/i.test(primary)
          ? "Teams"
          : event.conferenceData?.conferenceSolution?.name || "Meeting link"
    : null;
  return { primary, provider };
}

export async function refreshGoogleAccessToken(row) {
  if (!row?.refresh_token) throw new Error(`No refresh token for ${row?.email ?? "unknown user"}`);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth credentials missing on server.");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Google token refresh failed.");
  }

  const expiresAt = payload.expires_in ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString() : row.expires_at;
  await supabaseAdmin
    .from("google_account_tokens")
    .update({
      access_token: payload.access_token,
      token_type: payload.token_type ?? row.token_type ?? null,
      granted_scopes: payload.scope ?? row.granted_scopes ?? null,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  return payload.access_token;
}

export async function getValidGoogleAccessToken(row) {
  if (row.access_token && row.expires_at && new Date(row.expires_at).getTime() > Date.now() + 60_000) {
    return row.access_token;
  }
  return refreshGoogleAccessToken(row);
}

export async function fetchCalendarEventsForUser(tokenRow, windowHours = 24) {
  const accessToken = await getValidGoogleAccessToken(tokenRow);
  const now = new Date();
  const start = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const end = new Date(now.getTime() + windowHours * 60 * 60 * 1000).toISOString();
  const calUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  calUrl.searchParams.set("timeMin", start);
  calUrl.searchParams.set("timeMax", end);
  calUrl.searchParams.set("singleEvents", "true");
  calUrl.searchParams.set("orderBy", "startTime");
  calUrl.searchParams.set("maxResults", "100");
  calUrl.searchParams.set("fields", "items(id,summary,description,start,end,location,status,htmlLink,hangoutLink,conferenceData(entryPoints(entryPointType,uri,label),conferenceSolution(name)),organizer(email),colorId)");

  const response = await fetch(calUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `Google Calendar API error ${response.status}`);
  }
  return (payload.items ?? []).filter((event) => !!event?.start?.dateTime);
}

export async function listTrackedGoogleAccounts() {
  const { data, error } = await supabaseAdmin
    .from("google_account_tokens")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  const latestByEmail = new Map();
  for (const row of data ?? []) {
    const email = String(row.email ?? "").trim().toLowerCase();
    if (!email || latestByEmail.has(email)) continue;
    latestByEmail.set(email, row);
  }
  return [...latestByEmail.values()];
}

export async function getNotificationTarget(name, email) {
  const employeeName = String(name ?? "").trim();
  const employeeEmail = String(email ?? "").trim().toLowerCase();
  const { data } = await supabaseAdmin
    .from("notification_targets")
    .select("*")
    .or(`employee_name.eq.${employeeName},employee_email.eq.${employeeEmail}`)
    .eq("enabled", true)
    .order("created_at", { ascending: false })
    .limit(5);

  const exact = (data ?? []).find((row) => String(row.employee_email ?? "").trim().toLowerCase() === employeeEmail)
    ?? (data ?? []).find((row) => String(row.employee_name ?? "").trim() === employeeName)
    ?? null;

  if (exact) return exact;

  const fallbackSlack = defaultSlackUserIdFor(employeeName);
  return fallbackSlack
    ? { channel_type: "slack_dm", slack_user_id: fallbackSlack, enabled: true }
    : null;
}

export async function getReminderPolicy(name, email) {
  const employeeName = String(name ?? "").trim();
  const employeeEmail = String(email ?? "").trim().toLowerCase();
  const { data } = await supabaseAdmin
    .from("reminder_policies")
    .select("*")
    .or(`employee_name.eq.${employeeName},employee_email.eq.${employeeEmail}`)
    .order("created_at", { ascending: false })
    .limit(5);

  const exact = (data ?? []).find((row) => String(row.employee_email ?? "").trim().toLowerCase() === employeeEmail)
    ?? (data ?? []).find((row) => String(row.employee_name ?? "").trim() === employeeName)
    ?? null;

  return exact ?? {
    meeting_enabled: true,
    offset_30_enabled: true,
    offset_15_enabled: true,
    offset_5_enabled: true,
    only_with_join_link: false,
    timezone: DEFAULT_TIMEZONE,
  };
}

export function reminderOffsetsFromPolicy(policy) {
  const offsets = [];
  if (policy?.offset_30_enabled) offsets.push(30);
  if (policy?.offset_15_enabled) offsets.push(15);
  if (policy?.offset_5_enabled) offsets.push(5);
  return offsets.length > 0 ? offsets : REMINDER_STEPS;
}

export function buildDedupeKey({ employeeName, calendarEventId, meetingStartAt, offsetMinutes }) {
  const dayKey = String(meetingStartAt).slice(0, 10);
  return `meeting:${dayKey}:${normalizeMemberName(employeeName)}:${calendarEventId}:${offsetMinutes}`;
}

export function reminderMessageForJob(job) {
  const payload = typeof job.payload_json === "string" ? JSON.parse(job.payload_json) : (job.payload_json ?? {});
  const title = payload.title || "Upcoming meeting";
  const timeLabel = payload.timeLabel || new Date(job.meeting_start_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const joinText = job.join_link ? ` Join: ${job.join_link}` : "";
  const label = Number(job.reminder_offset_minutes) === 5 ? "Join now" : `${job.reminder_offset_minutes}-minute reminder`;
  const icon = Number(job.reminder_offset_minutes) === 5 ? ":rotating_light:" : ":spiral_calendar_pad:";
  return `${icon} ${label} for *${title}* at ${timeLabel}.${joinText}`;
}
