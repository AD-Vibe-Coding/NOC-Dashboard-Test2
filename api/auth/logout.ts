import type { VercelRequest, VercelResponse } from "@vercel/node";

/** POST /api/auth/logout — Clear the session cookie. */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Set-Cookie", "noc_session=; Path=/; HttpOnly; Max-Age=0");
  return res.status(200).json({ ok: true });
}
