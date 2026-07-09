import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCollection } from "./_lib/crud.js";
import { requireManager } from "./_lib/auth-middleware.js";

/**
 * Saved NOC MTTR report uploads.
 * Managers can list history and create new saved imports.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireManager(req, res)) return;
  return handleCollection("noc_mttr_reports", req, res);
}
