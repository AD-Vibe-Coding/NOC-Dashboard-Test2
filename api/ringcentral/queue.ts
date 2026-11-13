import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildRingCentralSnapshot, fetchRingCentralQueueData } from "../_lib/ringcentral.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const data = await fetchRingCentralQueueData(req, res);
    return res.status(200).json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(200).json(
      buildRingCentralSnapshot("RingCentral Presence", `RingCentral API error — showing snapshot: ${message.slice(0, 200)}`),
    );
  }
}
