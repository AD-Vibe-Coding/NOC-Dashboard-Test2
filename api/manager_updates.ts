import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCollection } from "./_lib/crud.js";
import { requireManager } from "./_lib/auth-middleware.js";

/**
 * Manager Updates collection.
 *
 * GET  — all roles (everyone can read the news ticker)
 * POST — manager only (create updates)
 * DELETE (bulk) — manager only
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST" || req.method === "DELETE") {
    if (!requireManager(req, res)) return;
  }
  return handleCollection("manager_updates", req, res);
}
