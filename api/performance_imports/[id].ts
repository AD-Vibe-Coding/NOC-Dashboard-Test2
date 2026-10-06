import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleItem } from "../_lib/crud.js";
import { requireManagerAppBuilder } from "../_lib/appbuilder-auth.js";

/** Performance Imports item — manager only. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const managerSession = await requireManagerAppBuilder(req, res);
  if (!managerSession) return;
  return handleItem("performance_imports", req.query.id as string, req, res);
}
