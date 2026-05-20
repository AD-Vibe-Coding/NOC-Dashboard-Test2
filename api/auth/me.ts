import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyJwt } from "../_lib/jwt.js";

/**
 * GET /api/auth/me — Return the current user from the session cookie.
 * Returns 401 if not authenticated or session expired.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = req.cookies?.noc_session;
  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const payload = verifyJwt(token);
  if (!payload) {
    res.setHeader("Set-Cookie", "noc_session=; Path=/; HttpOnly; Max-Age=0");
    return res.status(401).json({ error: "Session expired or invalid" });
  }

  return res.status(200).json({
    name: payload.name,
    email: payload.email,
    role: payload.role,
    picture: payload.picture || null,
  });
}
