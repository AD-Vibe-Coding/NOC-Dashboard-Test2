/**
 * Server-side auth helpers shared across all api/* route files.
 *
 * Reads the `noc_session` HTTP-only cookie that is set by /api/auth/login
 * (Google SSO) or /api/auth/dev-login (name picker). The cookie contains
 * a signed JWT with { name, email, role, ... }.
 *
 * Usage:
 *   import { getSession, requireManager } from "./_lib/auth-middleware.js";
 *
 *   const session = getSession(req);          // { name, email, role } | null
 *   if (!requireManager(req, res)) return;    // auto-sends 403 and returns false
 */

import "dotenv/config";
import { verifyJwt } from "./jwt.js";

/**
 * Parse the session cookie and return the verified JWT payload.
 * Returns null if the cookie is missing, expired, or tampered.
 */
export function getSession(req) {
  // Parse cookies from the Cookie header (req.cookies is set by the
  // appbuilder-api-dev-server shim in dev; in production Vercel populates it).
  let token = req.cookies?.noc_session;

  if (!token) {
    // Fallback: parse Cookie header manually (for Vite dev-server middleware
    // which may not pre-parse cookies into req.cookies).
    const cookieHeader = req.headers?.cookie ?? "";
    const match = cookieHeader.match(/(?:^|;\s*)noc_session=([^;]+)/);
    if (match) token = decodeURIComponent(match[1]);
  }

  if (!token) return null;
  return verifyJwt(token); // { name, email, role, iat, exp } | null
}

/**
 * Check that the request has a valid manager session.
 * Sends a 403 JSON error response and returns false if not.
 * Returns true (and does NOT send any response) if the check passes.
 *
 * Usage:
 *   if (!requireManager(req, res)) return;
 */
export function requireManager(req, res) {
  const session = getSession(req);
  if (!session || session.role !== "manager") {
    const send = typeof res.status === "function"
      ? (code, body) => res.status(code).json(body)   // Vercel-style
      : (code, body) => {                               // raw Node http
          res.statusCode = code;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
    send(403, {
      error: "Manager access required.",
      hint: "Sign in with a manager account to use this feature.",
    });
    return false;
  }
  return true;
}

/**
 * Get the current user's role from the session. Returns "anonymous" if not
 * authenticated.
 */
export function getRole(req) {
  return getSession(req)?.role ?? "anonymous";
}

/**
 * Get the current user's canonical name from the session. Returns null if not
 * authenticated.
 */
export function getSessionName(req) {
  return getSession(req)?.name ?? null;
}
