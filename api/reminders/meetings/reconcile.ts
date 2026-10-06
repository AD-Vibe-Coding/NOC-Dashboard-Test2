import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_lib/supabase-admin.js";
import { cronAuthorized } from "../../_lib/reminder-service.js";
import { requireManager } from "../../_lib/auth-middleware.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const authorized = cronAuthorized(req);
  if (!authorized) {
    if (req.method !== "POST") {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!requireManager(req, res)) return;
  }

  try {
    const now = Date.now();
    const retryNowIso = new Date(now).toISOString();
    const endedIso = new Date(now - 15 * 60 * 1000).toISOString();

    await supabaseAdmin
      .from("meeting_reminder_jobs")
      .update({ status: "failed", last_error: "Recovered interrupted send attempt", scheduled_for: retryNowIso })
      .eq("status", "sending");

    await supabaseAdmin
      .from("meeting_reminder_jobs")
      .update({ status: "cancelled", last_error: "Meeting already ended before send" })
      .in("status", ["pending", "failed", "sending"])
      .lte("meeting_start_at", endedIso);

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
