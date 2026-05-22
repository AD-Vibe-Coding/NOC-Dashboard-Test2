import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleItem } from "../_lib/crud.js";
import { requireManager } from "../_lib/auth-middleware.js";

/**
 * Manager Updates item.
 * PATCH/DELETE — manager only; GET — all roles.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "PATCH" || req.method === "DELETE") {
    if (!requireManager(req, res)) return;
  }
  return handleItem("manager_updates", req.query.id, req, res);
}
