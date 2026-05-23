/**
 * GET /api/zoom/availability?date=YYYY-MM-DD
 *
 * Returns today's queue opt-in snapshots grouped by agent → queue → hour.
 * Used by the ZoomQueue widget's "Today's Availability" timeline tab.
 *
 * Response:
 * {
 *   date: "2026-05-23",
 *   agents: {
 *     "Sriram Parisa": {
 *       "Network Tech Support": { 8: true, 9: true, 10: false, ... },
 *       "Mobility Tech Support": { 8: true, ... }
 *     },
 *     ...
 *   }
 * }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

function todayPst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const date = String(req.query.date ?? todayPst()).trim();

  const { data, error } = await supabaseAdmin
    .from("zoom_queue_snapshots")
    .select("agent_name, queue_name, receive_call, snapshot_hour, snapshot_time")
    .eq("snapshot_date", date)
    .order("snapshot_time", { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Count snapshots_in per agent × queue
  // Each snapshot = 5 minutes → hours = snapshots_in * 5 / 60
  const counts: Record<string, Record<string, { in: number; total: number }>> = {};

  for (const row of data ?? []) {
    if (!counts[row.agent_name]) counts[row.agent_name] = {};
    if (!counts[row.agent_name][row.queue_name])
      counts[row.agent_name][row.queue_name] = { in: 0, total: 0 };
    counts[row.agent_name][row.queue_name].total++;
    if (row.receive_call) counts[row.agent_name][row.queue_name].in++;
  }

  // Convert to hours: snapshots_in × 5 min / 60
  const agents: Record<string, Record<string, number>> = {};
  for (const [agentName, queues] of Object.entries(counts)) {
    agents[agentName] = {};
    for (const [queueName, c] of Object.entries(queues)) {
      agents[agentName][queueName] = Math.round((c.in * 5 / 60) * 100) / 100;
    }
  }

  return res.status(200).json({ date, snapshot_interval_min: 5, agents });
}
