import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";

/**
 * GET /api/auth/login — Redirect to Google OAuth consent screen.
 * If GOOGLE_CLIENT_ID isn't configured, returns 501.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(501).json({
      error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.",
    });
  }

  // Build redirect URI — APP_BASE_URL wins so the sandbox preview
  // always generates the correct public URL rather than localhost:5173.
  const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost:5173";
  const origin = base || `${proto}://${host}`;
  const redirectUri = `${origin}/api/auth/callback`;

  // CSRF state token
  const state = crypto.randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    state,
    prompt: "select_account",
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  res.setHeader(
    "Set-Cookie",
    `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
  );
  res.statusCode = 302;
  res.setHeader("Location", url);
  res.end();
}
