import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleItem } from "../_lib/crud.js";

export default (req: VercelRequest, res: VercelResponse) =>
  handleItem("personal_action_items", req.query.id, req, res);
