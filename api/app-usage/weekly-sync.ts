import type { VercelRequest, VercelResponse } from "@vercel/node";
import { syncWeeklyAppUsageToGoogleSheet } from "../_lib/google-sheets-app-usage.js";

function isAuthorizedCron(req: VercelRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const header = String(req.headers.authorization ?? "");
  return header === `Bearer ${cronSecret}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!isAuthorizedCron(req)) {
    return res.status(401).json({
      error: "Unauthorized cron request.",
      hint: "Set CRON_SECRET in project secrets so the Monday Vercel cron can call this route securely.",
    });
  }

  try {
    const result = await syncWeeklyAppUsageToGoogleSheet();
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Weekly app-usage sync failed.",
    });
  }
}
