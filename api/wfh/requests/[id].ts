/**
 * PATCH /api/wfh/requests/:id — approve or deny a WFH request (manager only)
 *
 * Body: { decision: "approved" | "denied", note?: string }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_lib/supabase-admin.js";
import { getSession, requireManager } from "../../_lib/auth-middleware.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "PATCH") {
      res.setHeader("Allow", "PATCH");
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Only managers can approve/deny
    if (!requireManager(req, res)) return;
    const session = getSession(req)!;

    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: "Missing request id" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const decision = String(body.decision ?? "").trim();
    const note     = String(body.note ?? "").trim() || null;

    if (decision !== "approved" && decision !== "denied") {
      return res.status(400).json({ error: "decision must be 'approved' or 'denied'" });
    }

    // Fetch the existing request
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("wfh_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return res.status(404).json({ error: "Request not found" });
    }
    if (existing.status !== "pending") {
      return res.status(409).json({
        error: `Request already ${existing.status} — cannot review again`,
      });
    }

    const now = new Date().toISOString();

    // Update status in Supabase
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("wfh_requests")
      .update({
        status:        decision,
        reviewed_by:   session.name,
        reviewed_at:   now,
        decision_note: note,
      })
      .eq("id", id)
      .select()
      .single();

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    return res.status(200).json({
      request:        updated,
      email_sent:     false,
      email_error:    null,
      employee_email: existing.employee_email ?? null,
    });
  } catch (err) {
    console.error("[wfh/requests/[id]]", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}


function formatRange(start: string, end: string): string {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return start === end ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "PATCH") {
      res.setHeader("Allow", "PATCH");
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Only managers can approve/deny
    if (!requireManager(req, res)) return;
    const session = getSession(req)!;

    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: "Missing request id" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const decision = String(body.decision ?? "").trim();
    const note     = String(body.note ?? "").trim() || null;

    if (decision !== "approved" && decision !== "denied") {
      return res.status(400).json({ error: "decision must be 'approved' or 'denied'" });
    }

    // Fetch the existing request
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("wfh_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return res.status(404).json({ error: "Request not found" });
    }
    if (existing.status !== "pending") {
      return res.status(409).json({
        error: `Request already ${existing.status} — cannot review again`,
      });
    }

    const now = new Date().toISOString();

    // Update status in Supabase
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("wfh_requests")
      .update({
        status:        decision,
        reviewed_by:   session.name,
        reviewed_at:   now,
        decision_note: note,
      })
      .eq("id", id)
      .select()
      .single();

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    // Post decision to Slack (reply in thread if we have a ts)
    const emoji = decision === "approved" ? "✅" : "❌";
    const verb  = decision === "approved" ? "Approved" : "Denied";
    const range = formatRange(existing.start_date, existing.end_date);
    const slackText =
      `${emoji} *${verb}* — ${existing.employee_name}'s WFH request for ${range} has been *${verb.toLowerCase()}* by ${session.name}.` +
      (note ? `\n_Note: ${note}_` : "");

    await postSlackMessage(slackText, {
      thread_ts: existing.slack_message_ts ?? undefined,
    });

    return res.status(200).json({
      request:        updated,
      email_sent:     false,
      email_error:    null,
      employee_email: existing.employee_email ?? null,
    });
  } catch (err) {
    console.error("[wfh/requests/[id]]", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
