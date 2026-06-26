import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleItem } from "../_lib/crud.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  return handleItem("celebrations", req.query.id, req, res);
}
