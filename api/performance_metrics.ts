import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCollection } from "./_lib/crud.js";
import { getSession } from "./_lib/auth-middleware.js";

/**
 * Performance Metrics collection.
 *
 * Managers: full access — all team members' metrics.
 * Techs: automatically scoped to their own metrics only.
 *   - Any filter.member_name they pass is IGNORED and replaced with their
 *     session name, so they can only ever see their own data.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  const session = getSession(req);
  const isManager = session?.role === "manager";

  if (!isManager && session?.name) {
    // Inject the tech's own name as a hard filter regardless of what the
    // client requested. Mutate req.query in-place so the CRUD handler picks
    // it up transparently.
    const q = req.query as Record<string, string | string[]>;
    // Remove any client-supplied member_name filter
    delete q["filter.member_name"];
    // Inject the server-enforced filter
    q["filter.member_name"] = session.name;
  }

  return handleCollection("performance_metrics", req, res);
}
