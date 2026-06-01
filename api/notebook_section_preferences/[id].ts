import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleItem } from "../_lib/crud.js";

export default (req: VercelRequest, res: VercelResponse) =>
  handleItem("notebook_section_preferences", req.query.id, req, res);
