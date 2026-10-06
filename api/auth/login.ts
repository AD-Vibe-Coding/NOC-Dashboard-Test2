import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Legacy auth entrypoint.
 * Keep the route alive only as a redirect into the approved-roster OAuth flow.
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.statusCode = 302;
  res.setHeader("Location", "/api/auth/google/start");
  res.end();
}
