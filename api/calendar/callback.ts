/**
 * GET /api/calendar/callback
 * Receives the Google OAuth redirect, exchanges the code for tokens,
 * stores the access + refresh tokens in HttpOnly cookies, then
 * postMessages success back to the opener and closes the popup.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { lookupByEmail } from "../_lib/roles.js";

const STATE_COOKIE   = "gcal_oauth_state";
const PKCE_COOKIE    = "gcal_oauth_verifier";
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

function getOrigin(req: IncomingMessage): string {
  // APP_BASE_URL always wins — avoids localhost:5173 behind the Vite dev proxy
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host  = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost:5173";
  return `${proto}://${host}`;
}

function renderClose(res: ServerResponse, targetOrigin: string, success: boolean, error?: string) {
  const payload = success
    ? `{ type: "gcal-oauth-success" }`
    : `{ type: "gcal-oauth-error", error: ${JSON.stringify(error ?? "unknown")} }`;
  const originLiteral = JSON.stringify(targetOrigin).replace(/</g, "\\u003c");
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><meta charset="utf-8"><title>Calendar connected</title>
<body style="font-family:system-ui;padding:2rem;color:#374151">
<p>${success ? "Google Calendar connected ✓" : `Error: ${error}`}</p>
<script>
  try { if(window.opener) window.opener.postMessage(${payload}, ${originLiteral}); } catch(e){}
  setTimeout(function(){ window.close(); }, 300);
</script>
</body>`);
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
  const targetOrigin = getOrigin(req);
  const url   = new URL(`http://x${req.url ?? ""}`);
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return renderClose(res, targetOrigin, false, error);
  if (!code || !state) return renderClose(res, targetOrigin, false, "missing code or state");

  const cookies  = parseCookies(req.headers.cookie ?? "");
  const expected = cookies[STATE_COOKIE];
  const verifier = cookies[PKCE_COOKIE];

  if (!expected || expected !== state) return renderClose(res, targetOrigin, false, "state mismatch");
  if (!verifier)                        return renderClose(res, targetOrigin, false, "missing PKCE verifier");

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return renderClose(res, targetOrigin, false, "Google credentials not configured");

  const redirectUri = `${targetOrigin}/api/calendar/callback`;

  let tokens: { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string };
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "authorization_code",
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        code_verifier: verifier,
      }),
    });
    tokens = await r.json() as typeof tokens;
    if (!r.ok || !tokens.access_token) throw new Error("token exchange failed");
  } catch (e) {
    return renderClose(res, targetOrigin, false, (e as Error).message);
  }

  const expiresIn    = Number(tokens.expires_in ?? 3600);
  const accessMaxAge = expiresIn;

  try {
    await persistGoogleAccountTokens({
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token,
      expiresIn,
      tokenType: tokens.token_type,
      scope: tokens.scope,
    });
  } catch (e) {
    return renderClose(res, targetOrigin, false, (e as Error).message);
  }
  // Refresh tokens are long-lived (keep 30 days)
  const clearOpts  = "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
  const accessOpts = `; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${accessMaxAge}`;
  const refreshOpts= `; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${60 * 60 * 24 * 30}`;

  const setCookies = [
    `${STATE_COOKIE}=${clearOpts}`,
    `${PKCE_COOKIE}=${clearOpts}`,
    `${ACCESS_COOKIE}=${encodeURIComponent(tokens.access_token!)}${accessOpts}`,
  ];
  if (tokens.refresh_token) {
    setCookies.push(`${REFRESH_COOKIE}=${encodeURIComponent(tokens.refresh_token)}${refreshOpts}`);
  }
  res.setHeader("Set-Cookie", setCookies);
  renderClose(res, targetOrigin, true);
}
