/**
 * GET /api/notifications
 * Returns pending WFH requests + pending metric disputes for the manager.
 * Manager-only — regular team members get 401.
 *
 * Response: { notifications: Notification[] }
 * Notification: { id, type, title, body, created_at, widget_id }
 */
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { getSession, requireManager } from "./_lib/auth-middleware.js";

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireManager(req, res)) return;

  const notifications: Array<{
    id: string;
    type: "wfh" | "dispute";
    title: string;
    body: string;
    created_at: string;
    widget_id: string;
  }> = [];

  try {
    // ── Pending WFH requests ───────────────────────────────────────────────
    const { data: wfhRows } = await supabaseAdmin
      .from("wfh_requests")
      .select("id, employee_name, start_date, end_date, reason, submitted_at")
      .eq("status", "pending")
      .order("submitted_at", { ascending: false })
      .limit(50);

    for (const r of wfhRows ?? []) {
      const start = new Date(`${r.start_date}T00:00:00`);
      const end   = new Date(`${r.end_date}T00:00:00`);
      const sameDay = r.start_date === r.end_date;
      const dateLabel = sameDay
        ? start.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

      notifications.push({
        id: `wfh-${r.id}`,
        type: "wfh",
        title: `WFH request — ${r.employee_name}`,
        body: `${dateLabel} · "${r.reason}"`,
        created_at: r.submitted_at,
        widget_id: "wfh",
      });
    }

    // ── Pending metric disputes ────────────────────────────────────────────
    const { data: disputeRows } = await supabaseAdmin
      .from("metric_disputes")
      .select("id, submitted_by, field_name, reason, ticket_ref, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50);

    for (const d of disputeRows ?? []) {
      const fieldLabel =
        d.field_name === "ack_minutes"             ? "ACK time"
        : d.field_name === "carrier_ticket_minutes" ? "Carrier ticket time"
        : d.field_name;
      const ticketRef = d.ticket_ref ? ` · #${d.ticket_ref}` : "";

      notifications.push({
        id: `dispute-${d.id}`,
        type: "dispute",
        title: `Metric dispute — ${d.submitted_by}`,
        body: `${fieldLabel}${ticketRef} · "${d.reason}"`,
        created_at: d.created_at,
        widget_id: "performance-tracker",
      });
    }
  } catch {
    // Tables may not exist yet — return empty gracefully
  }

  // Sort newest first across both types
  notifications.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return res.status(200).json({ notifications });
}
