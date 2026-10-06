import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCollection } from "./_lib/crud.js";

export default (req: VercelRequest, res: VercelResponse) =>
  handleCollection("work_allotment_asrh_hours", req, res);
