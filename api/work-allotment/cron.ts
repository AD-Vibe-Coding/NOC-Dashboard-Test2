import type { VercelRequest, VercelResponse } from "@vercel/node";
import { postDueWorkAllotment, WORK_ALLOTMENT_CONFIG } from "../_lib/google-sheets-work-allotment.js";

function cronAuthorized(req: VercelRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = String(req.headers.authorization ?? "");
  return Boolean(secret) && auth === `Bearer ${secret}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!cronAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized cron request." });
  }

  try {
    const result = await postDueWorkAllotment({ now: new Date() });
    return res.status(200).json({ ok: true, config: WORK_ALLOTMENT_CONFIG, result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to run work allotment cron.",
    });
  }
}
