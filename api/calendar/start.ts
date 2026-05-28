/**
 * GET /api/calendar/start
 * Starts the Google OAuth flow scoped to Google Calendar (read-only).
 * Independent of the main app auth — calendar tokens are stored separately.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "crypto";

const STATE_COOKIE  = "gcal_oauth_state";
const PKCE_COOKIE   = "gcal_oauth_verifier";
const COOKIE_TTL    = 600; // 10 min

function base64url(bytes: Buffer | Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function sha256(input: string): Promise<string> {
  const data = Buffer.from(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(digest));
}

function getOrigin(req: IncomingMessage): string {
  // APP_BASE_URL always wins — avoids localhost:5173 behind the Vite dev proxy
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host  = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost:5173";
  return `${proto}://${host}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain");
    res.end("GOOGLE_CLIENT_ID not configured");
    return;
  }

  const verifier  = base64url(crypto.randomBytes(32));
  const challenge = await sha256(verifier);
  const state     = base64url(crypto.randomBytes(16));
  const origin    = getOrigin(req);
  const redirectUri = `${origin}/api/calendar/callback`;

  const scopes = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "openid",
    "email",
    "profile",
  ].join(" ");

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id",             clientId);
  authUrl.searchParams.set("redirect_uri",           redirectUri);
  authUrl.searchParams.set("response_type",          "code");
  authUrl.searchParams.set("scope",                  scopes);
  authUrl.searchParams.set("state",                  state);
  authUrl.searchParams.set("code_challenge",         challenge);
  authUrl.searchParams.set("code_challenge_method",  "S256");
  authUrl.searchParams.set("access_type",            "offline");
  authUrl.searchParams.set("prompt",                 "consent");

  const cookieOpts = `; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_TTL}`;
  res.setHeader("Set-Cookie", [
    `${STATE_COOKIE}=${state}${cookieOpts}`,
    `${PKCE_COOKIE}=${verifier}${cookieOpts}`,
  ]);
  res.statusCode = 302;
  res.setHeader("Location", authUrl.toString());
  res.end();
}
