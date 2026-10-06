import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCollection } from "./_lib/crud.js";
import { requireManager } from "./_lib/auth-middleware.js";

/**
 * Finance cases collection.
 * Manager-only: monthly log of finance case number + comment.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireManager(req, res)) return;
  return handleCollection("finance_cases", req, res);
}
