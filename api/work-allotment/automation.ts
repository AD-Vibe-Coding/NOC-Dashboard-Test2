import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireManager } from "../_lib/auth-middleware.js";
import { ensureDailyWorkAllotmentJobs, postDueScheduledWorkAllotments, recordAutomationRun, runWorkAllotmentAutomation } from "../_lib/work-allotment-automation.js";

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
      await recordAutomationRun({
        action: "manual-post-due",
        ran_at: now.toISOString(),
        generation_triggered: false,
        generation_skipped: true,
        due_count: result.dueCount ?? 0,
        posted_count: result.postedCount ?? 0,
        failure_count: Array.isArray(result.failures) ? result.failures.length : 0,
        note: "manual_post_due",
      });
      return res.status(200).json({ ok: true, result });
    }

    const result = await runWorkAllotmentAutomation({ now });
    await recordAutomationRun({
      action: "manual-run",
      ran_at: now.toISOString(),
      generation_triggered: !result.generation?.skipped,
      generation_skipped: Boolean(result.generation?.skipped),
      due_count: result.posting?.dueCount ?? 0,
      posted_count: result.posting?.postedCount ?? 0,
      failure_count: Array.isArray(result.posting?.failures) ? result.posting.failures.length : 0,
      note: result.generation?.reason ?? "manual_run",
    });
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to run work allotment automation.",
    });
  }
}
