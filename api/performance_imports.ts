import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCollection } from "./_lib/crud.js";
export default (req: VercelRequest, res: VercelResponse) =>
  handleCollection("performance_imports", req, res);
