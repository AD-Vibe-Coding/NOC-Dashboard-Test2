import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Legacy callback disabled.
 * Legacy /api/auth/login now redirects into /api/auth/google/start instead.
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Set-Cookie", [
    "oauth_state=; Path=/; HttpOnly; Max-Age=0",
    "noc_session=; Path=/; HttpOnly; Max-Age=0",
  ]);
  res.statusCode = 302;
  res.setHeader("Location", "/?auth_error=legacy_auth_disabled");
  res.end();
}
