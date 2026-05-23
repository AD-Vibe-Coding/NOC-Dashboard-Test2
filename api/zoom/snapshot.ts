/**
 * POST /api/zoom/snapshot
 *
 * Saves a periodic queue opt-in snapshot to Supabase for the daily
 * availability timeline. Called by the ZoomQueue widget every 5 minutes.
 *
 * Body: { agents: { id, name, queues: { name, receive_call }[] }[] }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

function getPstDateHour(): { date: string; hour: number } {
  const now = new Date();
  const pstDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const pstHourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric", hour12: false,
  }).format(now);
  return { date: pstDate, hour: parseInt(pstHourStr, 10) || 0 };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { agents } = req.body ?? {};
  if (!Array.isArray(agents)) {
    return res.status(400).json({ error: "agents array required" });
  }

  const { date, hour } = getPstDateHour();
  const now = new Date().toISOString();

  const rows: any[] = [];
  for (const agent of agents) {
    for (const queue of agent.queues ?? []) {
      if (!agent.id || !agent.name || !queue.name) continue;
      rows.push({
        agent_id:      agent.id,
        agent_name:    agent.name,
        queue_name:    queue.name,
        receive_call:  !!queue.receive_call,
        snapshot_date: date,
        snapshot_hour: hour,
        snapshot_time: now,
      });
    }
  }

  if (rows.length === 0) {
    return res.status(200).json({ saved: 0 });
  }

  const { error } = await supabaseAdmin
    .from("zoom_queue_snapshots")
    .insert(rows);

  if (error) {
    console.error("[zoom/snapshot]", error.message);
    return res.status(500).json({ error: error.message });
  }

  return res.status(201).json({ saved: rows.length, date, hour });
}
