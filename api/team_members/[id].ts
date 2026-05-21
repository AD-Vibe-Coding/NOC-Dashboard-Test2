import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleItem } from "../_lib/crud.js";
export default (req: VercelRequest, res: VercelResponse) =>
  handleItem("team_members", req.query.id as string, req, res);
