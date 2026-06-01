import { supabaseAdmin } from "./supabase-admin.js";

const GMAIL_QUERY = "label:gemini-notes";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

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
  await supabaseAdmin.from("user_sessions").delete().eq("name", name);
  const { error } = await supabaseAdmin.from("user_sessions").insert({
    name,
    email: email ?? null,
    sign_in_method: "google",
    picture: picture ?? null,
    last_sign_in: nowIso(),
  });
  if (error) throw new Error(error.message);
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

export async function getValidGoogleAccessToken(email) {
  const { data, error } = await supabaseAdmin
    .from("google_account_tokens")
    .select("*")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(normalizeSupabaseTableError(error, "google_account_tokens"));
  if (!data) throw new Error("No Gmail connection found for this manager. Please sign out and sign in again after adding the Gmail scope.");

  const scopeText = String(data.granted_scopes ?? "");
  if (!scopeText.includes("gmail.readonly")) {
    throw new Error("This Google session does not include Gmail read access yet. Please sign out and sign in again.");
  }

  if (data.access_token && data.expires_at && new Date(data.expires_at).getTime() > Date.now() + 60_000) {
    return data.access_token;
  }

  return refreshAccessToken(data);
}

export async function listGeminiNoteMessages(email, maxResults = 5) {
  const accessToken = await getValidGoogleAccessToken(email);

  const listResponse = await fetch(`${GMAIL_BASE}/messages?maxResults=${Math.max(1, Math.min(maxResults, 10))}&q=${encodeURIComponent(GMAIL_QUERY)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listPayload = await listResponse.json().catch(() => ({}));
  if (!listResponse.ok) throw new Error(listPayload.error?.message || "Failed to query Gmail.");

  const ids = (listPayload.messages ?? []).map((m) => m.id).filter(Boolean);
  if (ids.length === 0) return [];

  const importedLookup = new Set();
  const { data: existingRows } = await supabaseAdmin
    .from("one_on_one_notes")
    .select("source_message_id")
    .in("source_message_id", ids);
  for (const row of existingRows ?? []) {
    if (row.source_message_id) importedLookup.add(row.source_message_id);
  }

  const messages = await Promise.all(ids.map(async (id) => {
    const detailResponse = await fetch(`${GMAIL_BASE}/messages/${id}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const detail = await detailResponse.json().catch(() => ({}));
    if (!detailResponse.ok) throw new Error(detail.error?.message || `Failed to fetch Gmail message ${id}.`);

    const subject = headerValue(detail, "Subject") ?? "Gemini notes";
    const from = headerValue(detail, "From");
    const date = headerValue(detail, "Date");
    const body = extractBody(detail);

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
      labelQuery: GMAIL_QUERY,
    };
  }));

  return messages;
}
