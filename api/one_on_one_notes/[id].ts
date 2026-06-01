import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleItem } from "../_lib/crud.js";

export default (req: VercelRequest, res: VercelResponse) =>
  handleItem("one_on_one_notes", req.query.id, req, res);
