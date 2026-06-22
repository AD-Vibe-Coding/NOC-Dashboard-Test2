import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleItem } from "../_lib/crud.js";
import { requireManager } from "../_lib/auth-middleware.js";

/**
 * Kudos item.
 * GET    — all roles
 * PATCH  — manager only (pin / unpin)
 * DELETE — manager only
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "PATCH" || req.method === "DELETE") {
    if (!requireManager(req, res)) return;
  }

  return handleItem("kudos", req.query.id, req, res);
}
