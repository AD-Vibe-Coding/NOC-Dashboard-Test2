import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCollection } from "./_lib/crud.js";
import { requireManagerAppBuilder } from "./_lib/appbuilder-auth.js";

/**
 * Performance Imports collection.
 * POST/DELETE — manager only (only managers can upload team imports).
 * GET — manager only (import history is team-wide management data).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const managerSession = await requireManagerAppBuilder(req, res);
  if (!managerSession) return;
  return handleCollection("performance_imports", req, res);
}
