import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleItem } from "../_lib/crud.js";
import { requireManager } from "../_lib/auth-middleware.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireManager(req, res)) return;
  return handleItem("work_allotment_jobs", req, res);
}
