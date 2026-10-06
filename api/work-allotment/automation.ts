import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAppBuilderSession } from "../_lib/appbuilder-auth.js";
import { dispatchDueOwnershipTaskReminders, ensureDailyWorkAllotmentJobs, postDueScheduledWorkAllotments, recordAutomationRun, reconcilePlannedWorkAllotmentJobs, syncWeekendFairnessIfDue } from "../_lib/work-allotment-automation.js";

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

  const session = await getAppBuilderSession(req);
  if (!session) {
    return res.status(401).json({ error: "Sign in required." });
  }

  try {
    const now = parseNow(req.body?.at);
    const action = String(req.body?.action ?? "run");

    if (action === "generate") {
      const result = await ensureDailyWorkAllotmentJobs({ now, force: true });
      await recordAutomationRun({
        action: "manual-generate",
        ran_at: now.toISOString(),
        generation_triggered: !result.skipped,
        generation_skipped: Boolean(result.skipped),
        due_count: 0,
        posted_count: 0,
        failure_count: 0,
        note: result.reason ?? "manual_generate",
      });
      return res.status(200).json({ ok: true, result });
    }

    if (action === "post-due") {
      const result = await postDueScheduledWorkAllotments({ now });
      const ownershipReminders = await dispatchDueOwnershipTaskReminders({ now });
      const weekendFairness = await syncWeekendFairnessIfDue({ now });
      await recordAutomationRun({
        action: "manual-post-due",
        ran_at: now.toISOString(),
        generation_triggered: false,
        generation_skipped: true,
        due_count: (result.dueCount ?? 0) + (ownershipReminders.processed ?? 0),
        posted_count: (result.postedCount ?? 0) + (ownershipReminders.reminded ?? 0),
        failure_count: (Array.isArray(result.failures) ? result.failures.length : 0) + (ownershipReminders.failed ?? 0),
        note: `manual_post_due:${weekendFairness.reason ?? "weekend_sync"}`,
      });
      return res.status(200).json({ ok: true, result: { ...result, ownershipReminders, weekendFairness } });
    }

    const generation = await reconcilePlannedWorkAllotmentJobs({ now });
    const posting = await postDueScheduledWorkAllotments({ now });
    const ownershipReminders = await dispatchDueOwnershipTaskReminders({ now });
    const weekendFairness = await syncWeekendFairnessIfDue({ now });
    const result = {
      ok: true,
      ranAt: now.toISOString(),
      generationWindow: false,
      generation,
      posting,
      ownershipReminders,
      weekendFairness,
    };
    await recordAutomationRun({
      action: "manual-run",
      ran_at: now.toISOString(),
      generation_triggered: true,
      generation_skipped: false,
      due_count: posting?.dueCount ?? 0,
      posted_count: posting?.postedCount ?? 0,
      failure_count: Array.isArray(posting?.failures) ? posting.failures.length : 0,
      note: `manual_reconcile:${generation.updatedCount ?? 0}_updated:${generation.insertedCount ?? 0}_inserted:${weekendFairness.reason ?? "weekend_sync"}`,
    });
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to run work allotment automation.",
    });
  }
}
