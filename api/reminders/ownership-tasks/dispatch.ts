import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cronAuthorized } from "../../_lib/reminder-service.js";
import { dispatchDueOwnershipTaskReminders } from "../../_lib/work-allotment-automation.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (req.method === "GET" && !cronAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await dispatchDueOwnershipTaskReminders();
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
