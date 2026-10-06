import { supabaseAdmin } from "./supabase-admin.js";

const GMAIL_LABEL_ROOT = "Gemini Notes";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const APPROVED_TEAM_MEMBER_NAMES = [
  "Karthik Radhakrishnan",
  "Pranav Dandibhotla",
  "Sriram Parisa",
  "Lokesh Naik Banavath",
  "Kenya Gentry",
  "Mohammed Ashraf",
  "Hamza Rahmani",
  "Akash Hanvate",
  "Otukho Olembo",
  "Mohammed Zubairuddin",
  "Karthik Damagalla",
  "Abhishek Benarji",
  "Akram Ahmed",
  "Mahalakshmi Samiti",
];
const APPROVED_MY_NOTEBOOK_NAMES = [
  "C3 & NOC Monthly Sync",
  "Monthly Review - NOC",
  "NOC & MOM Monthly Sync",
  "NOC Management Meetings",
  "Team Meetings",
  "Matt - One on One",
];

function normalizeLabelName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function isApprovedGeminiLabelName(name) {
  const normalized = normalizeLabelName(name);
  const leaf = normalized.split("/").pop()?.trim() ?? normalized;
  const allowed = new Set([
    ...APPROVED_TEAM_MEMBER_NAMES.map(normalizeLabelName),
    ...APPROVED_MY_NOTEBOOK_NAMES.map(normalizeLabelName),
  ]);
  return allowed.has(leaf);
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function decodeBase64Url(input) {
  const normalized = String(input ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice(0, (4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function stripHtml(html) {
  return String(html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractBodies(part, acc = { plain: [], html: [] }) {
  if (!part) return acc;
  const mime = String(part.mimeType ?? "").toLowerCase();
  const data = part.body?.data ? decodeBase64Url(part.body.data) : "";
  if (mime === "text/plain" && data) acc.plain.push(data);
  if (mime === "text/html" && data) acc.html.push(data);
  for (const child of part.parts ?? []) extractBodies(child, acc);
  return acc;
}

function headerValue(message, name) {
  return message.payload?.headers?.find((h) => String(h.name).toLowerCase() === name.toLowerCase())?.value ?? null;
}

function extractBody(message) {
  const bodies = extractBodies(message.payload);
  if (bodies.plain.length > 0) return bodies.plain.join("\n\n").trim();
  if (bodies.html.length > 0) return stripHtml(bodies.html.join("\n\n"));
  if (message.payload?.body?.data) return decodeBase64Url(message.payload.body.data);
  return String(message.snippet ?? "").trim();
}

function normalizeSupabaseTableError(error, tableName) {
  const message = String(error?.message ?? error ?? "Unknown database error");
  const details = String(error?.details ?? "");
  const hint = String(error?.hint ?? "");
  const combined = `${message} ${details} ${hint}`.toLowerCase();

  if (
    combined.includes("schema cache") ||
    combined.includes("could not find the table") ||
    combined.includes("does not exist") ||
    combined.includes("42p01")
  ) {
    return `The Supabase table \"${tableName}\" is not live yet. Open the database panel and click Push to Supabase, then sign out and sign back in with Google.`;
  }

  return message;
}

async function saveTokenRow(row) {
  await supabaseAdmin.from("google_account_tokens").delete().eq("email", row.email);
  const { error } = await supabaseAdmin.from("google_account_tokens").insert(row);
  if (error) throw new Error(error.message);
}

export async function saveGoogleAccountTokens({ googleSub, email, name, tokens }) {
  if (!email) throw new Error("Google did not return an email address for this account.");
  const expiresAt = tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString() : null;
  await saveTokenRow({
    google_sub: googleSub,
    email,
    name: name ?? null,
    access_token: tokens.access_token ?? null,
    refresh_token: tokens.refresh_token ?? null,
    token_type: tokens.token_type ?? null,
    granted_scopes: tokens.scope ?? null,
    expires_at: expiresAt,
    updated_at: nowIso(),
  });
}

export async function upsertGoogleSessionRow({ name, email, picture }) {
  if (!name) return;
  const normalizedEmail = normalizeEmail(email);
  const deleteResult = await supabaseAdmin.from("user_sessions").delete().eq("name", name);
  if (deleteResult.error) throw new Error(normalizeSupabaseTableError(deleteResult.error, "user_sessions"));
  const { error } = await supabaseAdmin.from("user_sessions").insert({
    name,
    email: normalizedEmail || null,
    sign_in_method: "google",
    picture: picture ?? null,
    last_sign_in: nowIso(),
  });
  if (error) throw new Error(normalizeSupabaseTableError(error, "user_sessions"));
}

async function refreshAccessToken(row) {
  if (!row?.refresh_token) throw new Error("No Google refresh token saved. Please sign out and sign in again to grant Gmail access.");
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth client credentials are missing on the server.");

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

  const updated = {
    ...row,
    access_token: payload.access_token,
    token_type: payload.token_type ?? row.token_type ?? null,
    granted_scopes: payload.scope ?? row.granted_scopes ?? null,
    expires_at: payload.expires_in ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString() : row.expires_at,
    updated_at: nowIso(),
  };
  await saveTokenRow(updated);
  return updated.access_token;
}

function hasRequiredGoogleScope(scopeText, requiredScope) {
  if (!requiredScope) return true;
  const normalized = String(scopeText ?? "").toLowerCase();
  const required = String(requiredScope ?? "").trim().toLowerCase();
  if (!required) return true;
  return normalized.includes(required);
}

export async function getValidGoogleAccessToken(email, options = {}) {
  const normalizedEmail = normalizeEmail(email);
  const requiredScope = String(options.requiredScope ?? "gmail.readonly").trim();

  const { data, error } = await supabaseAdmin
    .from("google_account_tokens")
    .select("*")
    .eq("email", normalizedEmail)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(normalizeSupabaseTableError(error, "google_account_tokens"));
  if (!data) {
    if (requiredScope.toLowerCase().includes("calendar")) {
      throw new Error("No Google Calendar connection found for this user. Please sign out and sign in again to grant Calendar access.");
    }
    throw new Error("No Gmail connection found for this user. Please sign out and sign in again after adding the Gmail scope.");
  }

  const scopeText = String(data.granted_scopes ?? "");
  if (!hasRequiredGoogleScope(scopeText, requiredScope)) {
    if (requiredScope.toLowerCase().includes("calendar")) {
      throw new Error("This Google sign-in does not include Calendar access yet. Please sign out and sign in again.");
    }
    throw new Error("This Google sign-in does not include Gmail access yet. Please sign out and sign in again.");
  }

  if (data.access_token && data.expires_at && new Date(data.expires_at).getTime() > Date.now() + 60_000) {
    return data.access_token;
  }

  return refreshAccessToken(data);
}

export async function listGmailLabels(email) {
  const accessToken = await getValidGoogleAccessToken(email);
  const response = await fetch(`${GMAIL_BASE}/labels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "Failed to load Gmail labels.");
  return Array.isArray(payload.labels)
    ? payload.labels.map((label) => ({
        id: String(label.id ?? "").trim(),
        name: String(label.name ?? "").trim(),
        type: String(label.type ?? "user"),
      })).filter((label) => label.id && label.name)
    : [];
}

export async function listGeminiNoteMessages(email, maxResults = 5, startDate = null, endDate = null) {
  const accessToken = await getValidGoogleAccessToken(email);

  const afterPart = startDate ? ` after:${String(startDate).replaceAll("-", "/")}` : "";
  const beforeDate = endDate ? new Date(`${endDate}T00:00:00`) : null;
  if (beforeDate && !Number.isNaN(beforeDate.getTime())) {
    beforeDate.setDate(beforeDate.getDate() + 1);
  }
  const beforePart = beforeDate
    ? ` before:${beforeDate.toISOString().slice(0, 10).replaceAll("-", "/")}`
    : "";
  const dateQuery = `${afterPart}${beforePart}`.trim();

  const safeMaxResults = Math.max(1, Math.min(Number(maxResults) || 50, 500));
  const ids = [];
  const seenIds = new Set();

  const labels = await listGmailLabels(email);
  const geminiLabels = labels.filter((label) => {
    const name = String(label?.name ?? "").trim();
    return (name === GMAIL_LABEL_ROOT || name.startsWith(`${GMAIL_LABEL_ROOT}/`)) && isApprovedGeminiLabelName(name);
  });

  for (const label of geminiLabels) {
    let pageToken = null;
    do {
      const pageParams = new URLSearchParams({
        maxResults: String(Math.min(100, safeMaxResults)),
      });
      if (dateQuery) pageParams.set("q", dateQuery);
      pageParams.append("labelIds", String(label.id));
      if (pageToken) pageParams.set("pageToken", pageToken);

      const listResponse = await fetch(`${GMAIL_BASE}/messages?${pageParams.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const listPayload = await listResponse.json().catch(() => ({}));
      if (!listResponse.ok) throw new Error(listPayload.error?.message || "Failed to query Gmail.");

      for (const message of listPayload.messages ?? []) {
        if (!message?.id || seenIds.has(message.id)) continue;
        seenIds.add(message.id);
        ids.push(message.id);
        if (ids.length >= safeMaxResults) break;
      }
      pageToken = ids.length >= safeMaxResults ? null : (listPayload.nextPageToken ?? null);
    } while (pageToken && ids.length < safeMaxResults);

    if (ids.length >= safeMaxResults) break;
  }

  if (ids.length === 0) return [];

  const importedLookup = new Set();
  const labelLookup = new Map(labels.map((label) => [label.id, label.name]));
  const { data: existingRows } = await supabaseAdmin
    .from("one_on_one_notes")
    .select("source_message_id")
    .in("source_message_id", ids);
  for (const row of existingRows ?? []) {
    if (row.source_message_id) importedLookup.add(row.source_message_id);
  }

  const messages = [];
  const batchSize = 8;

  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize);
    const batchMessages = await Promise.all(batch.map(async (id) => {
      const detailResponse = await fetch(`${GMAIL_BASE}/messages/${id}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const detail = await detailResponse.json().catch(() => ({}));
      if (!detailResponse.ok) throw new Error(detail.error?.message || `Failed to fetch Gmail message ${id}.`);

      const subject = headerValue(detail, "Subject") ?? "Gemini notes";
      const from = headerValue(detail, "From");
      const date = headerValue(detail, "Date");
      const body = extractBody(detail);

      const labelIds = Array.isArray(detail.labelIds) ? detail.labelIds.map(String).filter(Boolean) : [];
      const labelNames = labelIds.map((labelId) => labelLookup.get(labelId)).filter(Boolean);

      return {
        id,
        threadId: detail.threadId ?? null,
        subject,
        from,
        date,
        snippet: String(detail.snippet ?? ""),
        body,
        imported: importedLookup.has(id),
        internalDate: detail.internalDate ? new Date(Number(detail.internalDate)).toISOString() : null,
        labelQuery: `${GMAIL_LABEL_ROOT}${dateQuery ? ` (${dateQuery})` : ""}`,
        labelIds,
        labelNames,
      };
    }));

    messages.push(...batchMessages);
  }

  return messages.sort((a, b) => {
    const aTime = a.internalDate ? new Date(a.internalDate).getTime() : 0;
    const bTime = b.internalDate ? new Date(b.internalDate).getTime() : 0;
    return bTime - aTime;
  });
}
