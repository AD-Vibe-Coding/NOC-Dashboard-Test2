import type { VercelRequest, VercelResponse } from "@vercel/node";
import { signJwt } from "../_lib/jwt.js";
import { defaultRoleFor, lookupByEmail } from "../_lib/roles.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { encryptAndSign, buildSessionSetCookie } from "./_lib/session.js";

/**
 * GET /api/auth/callback?code=XXX&state=YYY
 * Google redirects here after the user consents. We exchange the code for
 * tokens, fetch the user's profile, verify the email domain, create a
 * session JWT, and redirect back to the app.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code = req.query.code as string;
  const state = req.query.state as string;
  const error = req.query.error as string;

  // If the user denied consent
  if (error) {
    res.statusCode = 302;
    res.setHeader("Location", "/?auth_error=consent_denied");
    res.end();
    return;
  }

  if (!code) {
    return res.status(400).json({ error: "Missing authorization code" });
  }

  // CSRF check
  const cookieState = req.cookies?.oauth_state;
  if (!cookieState || state !== cookieState) {
    return res.status(403).json({ error: "Invalid state parameter — possible CSRF" });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: "Google OAuth not configured on server" });
  }

  // Must exactly match what login.ts sent — both use APP_BASE_URL first.
  const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost:5173";
  const origin = base || `${proto}://${host}`;
  const redirectUri = `${origin}/api/auth/callback`;

  // Exchange authorization code for tokens
  let tokenData: Record<string, unknown>;
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    tokenData = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("[auth/callback] token exchange failed:", tokenData);
      res.statusCode = 302;
      res.setHeader("Location", "/?auth_error=token_exchange_failed");
      res.end();
      return;
    }
  } catch (err) {
    console.error("[auth/callback] token exchange error:", err);
    res.statusCode = 302;
    res.setHeader("Location", "/?auth_error=network_error");
    res.end();
    return;
  }

  // Fetch user profile from Google
  let userInfo: Record<string, unknown>;
  try {
    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    userInfo = (await userRes.json()) as Record<string, unknown>;
  } catch {
    res.statusCode = 302;
    res.setHeader("Location", "/?auth_error=profile_fetch_failed");
    res.end();
    return;
  }

  const email = String(userInfo.email ?? "").toLowerCase();
  if (!email) {
    res.statusCode = 302;
    res.setHeader("Location", "/?auth_error=no_email");
    res.end();
    return;
  }

  // Domain restriction
  const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS || "appdirect.com")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const emailDomain = email.split("@")[1];

  if (allowedDomains.length > 0 && !allowedDomains.includes(emailDomain)) {
    res.setHeader("Set-Cookie", [
      "oauth_state=; Path=/; HttpOnly; Max-Age=0",
      "noc_session=; Path=/; HttpOnly; Max-Age=0",
    ]);
    res.statusCode = 302;
    res.setHeader("Location", `/?auth_error=domain_not_allowed&domain=${emailDomain}`);
    res.end();
    return;
  }

  // Map email → roster identity (preferred), fall back to Google profile name
  const emailLookup = lookupByEmail(email);
  const name = emailLookup?.name ?? String(userInfo.name ?? email.split("@")[0]);
  let role: string = emailLookup?.role ?? defaultRoleFor(name);
  const picture = String(userInfo.picture ?? "");

  // Check for a DB role override set by a manager in the Access Control widget
  try {
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("name", name)
      .limit(1)
      .maybeSingle();
    if (data?.role) role = data.role;
  } catch { /* non-fatal — use static role */ }

  // Create session JWT (24h)
  const sessionToken = signJwt({ email, name, role, picture }, 86400);

  // Record sign-in for Access Control widget (best-effort — non-blocking)
  try {
    await supabaseAdmin.from("user_sessions").delete().eq("name", name);
    await supabaseAdmin.from("user_sessions").insert({
      name,
      email,
      sign_in_method: "google",
      picture: picture || null,
      last_sign_in: new Date().toISOString(),
    });
  } catch { /* non-fatal — user_sessions table may not exist yet */ }

  // Write the new AES-GCM encrypted session cookie so the scaffold's
  // /api/auth/me endpoint (which reads __appbuilder_session) can resolve
  // the identity. Include role in the payload so me.ts doesn't need a
  // second lookup.
  const now = Math.floor(Date.now() / 1000);
  let newSessionCookie = "";
  try {
    const newPayload = { sub: email, email, name, role, picture, provider: "google", iat: now, exp: now + 86400 };
    const encrypted = await encryptAndSign(newPayload, process.env.SESSION_SECRET ?? "");
    newSessionCookie = buildSessionSetCookie(encrypted);
  } catch {
    // Non-fatal — noc_session JWT is still set as fallback
  }

  // Set session cookie, clear state cookie, redirect home
  const cookies = [
    `noc_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
    "oauth_state=; Path=/; HttpOnly; Max-Age=0",
  ];
  if (newSessionCookie) cookies.push(newSessionCookie);
  res.setHeader("Set-Cookie", cookies);
  res.statusCode = 302;
  res.setHeader("Location", "/");
  res.end();
}
