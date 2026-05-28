/**
 * GET /api/auth/redirect-uri
 *
 * Returns the exact redirect URIs this server will send to OAuth providers.
 * Use this to copy/paste the correct URI into Google Cloud Console.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRedirectUri } from "./_lib/redirect-uri.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const google = getRedirectUri(req as any, "google");
  const calendar = getRedirectUri(req as any, "calendar");
  return res.status(200).json({ google, calendar });
}
