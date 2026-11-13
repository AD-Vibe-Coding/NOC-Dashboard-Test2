import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearRingCentralSession } from "../_lib/ringcentral.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  clearRingCentralSession(res);

  if (req.method === "GET") {
    res.statusCode = 302;
    res.setHeader("Location", "/");
    return res.end();
  }

  return res.status(200).json({ ok: true });
}
