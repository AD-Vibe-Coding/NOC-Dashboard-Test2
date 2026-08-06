import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireManager } from "../_lib/auth-middleware.js";
import { getAppUsageSheetConfig, getPreviousWeekWindow, syncWeeklyAppUsageToGoogleSheet } from "../_lib/google-sheets-app-usage.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (!requireManager(req, res)) return;

  if (req.method === "GET") {
    const window = getPreviousWeekWindow();
    return res.status(200).json({
      ok: true,
      config: getAppUsageSheetConfig(),
      next_manual_sync_window: {
        weekStart: window.startDate,
        weekEnd: window.endDate,
      },
    });
  }

  if (req.method === "POST") {
    try {
      const result = await syncWeeklyAppUsageToGoogleSheet();
      return res.status(200).json({ ok: true, result });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to sync app usage to Google Sheet.",
      });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed." });
}
