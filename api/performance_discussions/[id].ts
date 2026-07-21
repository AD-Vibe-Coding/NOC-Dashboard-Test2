import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleItem } from "../_lib/crud.js";
import { requireManager } from "../_lib/auth-middleware.js";

/** Half-yearly performance discussion item — manager only. */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireManager(req, res)) return;
  return handleItem("performance_discussions", req.query.id as string, req, res);
}
