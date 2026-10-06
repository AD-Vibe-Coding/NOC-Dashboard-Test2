import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleItem } from "../_lib/crud.js";
import { requireManager } from "../_lib/auth-middleware.js";

/**
 * Finance case item.
 * Manager-only access for view/update/delete.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireManager(req, res)) return;
  return handleItem("finance_cases", req.query.id, req, res);
}
