import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCollection } from "./_lib/crud.js";

export default (req: VercelRequest, res: VercelResponse) =>
  handleCollection("break_schedules", req, res);
