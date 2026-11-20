import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleItem } from "../_lib/crud.js";
export default (req: VercelRequest, res: VercelResponse) =>
  handleItem("metric_disputes", req.query.id, req, res);
