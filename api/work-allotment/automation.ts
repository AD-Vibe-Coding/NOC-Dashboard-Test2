import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireManager } from "../_lib/auth-middleware.js";
import { ensureDailyWorkAllotmentJobs, postDueScheduledWorkAllotments, runWorkAllotmentAutomation } from "../_lib/work-allotment-automation.js";

function parseNow(value: unknown) {
  if (!value) return new Date();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!requireManager(req, res)) return;

  try {
    const now = parseNow(req.body?.at);
    const action = String(req.body?.action ?? "run");

    if (action === "generate") {
      const result = await ensureDailyWorkAllotmentJobs({ now, force: true });
      return res.status(200).json({ ok: true, result });
    }

    if (action === "post-due") {
      const result = await postDueScheduledWorkAllotments({ now });
      return res.status(200).json({ ok: true, result });
    }

    const result = await runWorkAllotmentAutomation({ now });
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to run work allotment automation.",
    });
  }
}
