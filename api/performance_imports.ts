import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCollection } from "./_lib/crud.js";
import { requireManager } from "./_lib/auth-middleware.js";

/**
 * Performance Imports collection.
 * POST/DELETE — manager only (only managers can upload team imports).
 * GET — manager only (import history is team-wide management data).
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireManager(req, res)) return;
  return handleCollection("performance_imports", req, res);
}
