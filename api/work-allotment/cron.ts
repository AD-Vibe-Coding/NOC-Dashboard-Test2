import type { VercelRequest, VercelResponse } from "@vercel/node";
import { WORK_ALLOTMENT_CONFIG } from "../_lib/google-sheets-work-allotment.js";
import { dispatchDueOwnershipTaskReminders, ensureDailyWorkAllotmentJobs, postDueScheduledWorkAllotments, recordAutomationRun, runWorkAllotmentAutomation, syncWeekendFairnessIfDue } from "../_lib/work-allotment-automation.js";

function cronAuthorized(req: VercelRequest) {
  const vercelCronHeader = req.headers["x-vercel-cron"];
  if (vercelCronHeader) return true;

  const secret = process.env.CRON_SECRET;
  const auth = String(req.headers.authorization ?? "");
  if (secret) return auth === `Bearer ${secret}`;

  const devTest = String(req.query.dev_test ?? "") === "1";
  return devTest;
}

function parseNow(value: unknown) {
  if (!value) return new Date();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
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
    const now = parseNow(req.query.at);
    const action = String(req.query.action ?? "run");

    if (action === "generate") {
      const result = await ensureDailyWorkAllotmentJobs({ now, force: true });
      await recordAutomationRun({
        action,
        ran_at: now.toISOString(),
        generation_triggered: !result.skipped,
        generation_skipped: Boolean(result.skipped),
        due_count: 0,
        posted_count: 0,
        failure_count: 0,
        note: result.reason ?? "manual_generate",
      });
      return res.status(200).json({ ok: true, config: WORK_ALLOTMENT_CONFIG, action, result });
    }

    if (action === "post-due") {
      const result = await postDueScheduledWorkAllotments({ now });
      const ownershipReminders = await dispatchDueOwnershipTaskReminders({ now });
      const weekendFairness = await syncWeekendFairnessIfDue({ now });
      await recordAutomationRun({
        action,
        ran_at: now.toISOString(),
        generation_triggered: false,
        generation_skipped: true,
        due_count: (result.dueCount ?? 0) + (ownershipReminders.processed ?? 0),
        posted_count: (result.postedCount ?? 0) + (ownershipReminders.reminded ?? 0),
        failure_count: (Array.isArray(result.failures) ? result.failures.length : 0) + (ownershipReminders.failed ?? 0),
        note: `cron_post_due:${weekendFairness.reason ?? "weekend_sync"}`,
      });
      return res.status(200).json({ ok: true, config: WORK_ALLOTMENT_CONFIG, action, result: { ...result, ownershipReminders, weekendFairness } });
    }

    const result = await runWorkAllotmentAutomation({ now });
    await recordAutomationRun({
      action,
      ran_at: now.toISOString(),
      generation_triggered: !result.generation?.skipped,
      generation_skipped: Boolean(result.generation?.skipped),
      due_count: result.posting?.dueCount ?? 0,
      posted_count: result.posting?.postedCount ?? 0,
      failure_count: Array.isArray(result.posting?.failures) ? result.posting.failures.length : 0,
      note: result.generation?.reason ?? "cron_run",
    });
    return res.status(200).json({ ok: true, config: WORK_ALLOTMENT_CONFIG, action, result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to run work allotment cron.",
    });
  }
}
