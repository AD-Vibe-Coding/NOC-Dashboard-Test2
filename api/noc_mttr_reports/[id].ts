import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleItem } from "../_lib/crud.js";
import { requireManager } from "../_lib/auth-middleware.js";

/**
 * Saved NOC MTTR report record.
 * Managers can update saved column mappings for a report.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireManager(req, res)) return;
  const { id } = req.query;
  const idRaw = Array.isArray(id) ? id[0] : id;
  return handleItem("noc_mttr_reports", idRaw, req, res);
}
