import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCollection } from "./_lib/crud.js";
import { requireManager } from "./_lib/auth-middleware.js";

/** Half-yearly performance discussions collection — manager only. */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireManager(req, res)) return;
  return handleCollection("performance_discussions", req, res);
}
