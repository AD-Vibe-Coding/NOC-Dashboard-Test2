import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCollection } from "./_lib/crud.js";

/**
 * Kudos collection.
 *
 * GET    — all roles
 * POST   — any signed-in user can post kudos
 * DELETE — not allowed in bulk from the client
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "DELETE") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  return handleCollection("kudos", req, res);
}
