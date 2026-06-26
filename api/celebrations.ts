import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCollection } from "./_lib/crud.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  return handleCollection("celebrations", req, res);
}
