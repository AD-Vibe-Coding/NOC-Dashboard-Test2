import { useEffect, useRef, useState } from "react";
import { fetchZoomQueue, type ZoomQueueData } from "../../lib/zoom";

/**
 * Hours in queue per agent per queue for today.
 * agent_name → queue_name → hours (decimal, e.g. 3.25)
 * Combines Supabase snapshot history + live session accumulation.
 */
export type QueueHours = Record<string, Record<string, number>>;

const POLL_INTERVAL_MS    = 15_000;       // 15 s between data refreshes
const SNAPSHOT_INTERVAL_MS = 5 * 60_000; // save to Supabase every 5 min

export function useZoomQueue() {
  const [data, setData]         = useState<ZoomQueueData | null>(null);
  const [queueHours, setQueueHours] = useState<QueueHours>({});
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [tick, setTick]         = useState(0);

  // Tracks how many 15-second polls each agent×queue has been opted-in
  // during this session (resets on page load — Supabase fills historical gaps)
  const sessionCountRef = useRef<Record<string, Record<string, number>>>({});
  const lastSnapshotRef = useRef<number>(0);
  // Hours loaded from Supabase (base)
  const supabaseHoursRef = useRef<QueueHours>({});

  function todayPst(): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  }

  /** Merge Supabase base hours + live session accumulation into queueHours state */
  function recalcHours() {
    const base = supabaseHoursRef.current;
    const counts = sessionCountRef.current;
    const merged: QueueHours = {};

    // Start with Supabase base
    for (const [agent, queues] of Object.entries(base)) {
      merged[agent] = { ...queues };
    }

    // Add session hours (pollCount × 15s / 3600) on top
    for (const [agent, queues] of Object.entries(counts)) {
      if (!merged[agent]) merged[agent] = {};
      for (const [queue, count] of Object.entries(queues)) {
        const sessionHrs = Math.round((count * POLL_INTERVAL_MS / 1000 / 3600) * 100) / 100;
        merged[agent][queue] = Math.round(((merged[agent][queue] ?? 0) + sessionHrs) * 100) / 100;
      }
    }

    setQueueHours(merged);
  }

  /** Accumulate session time from a fresh data poll */
  function accumulateSession(queueData: ZoomQueueData) {
    const counts = sessionCountRef.current;
    for (const agent of queueData.agents) {
      if (!agent.queue_opt_in) continue;
      if (!counts[agent.display_name]) counts[agent.display_name] = {};
      for (const [queue, receive_call] of Object.entries(agent.queue_opt_in)) {
        if (receive_call) {
          counts[agent.display_name][queue] = (counts[agent.display_name][queue] ?? 0) + 1;
        }
      }
    }
    sessionCountRef.current = counts;
    recalcHours();
  }

  /** Save a Supabase snapshot (debounced to every 5 min) */
  async function saveSnapshot(queueData: ZoomQueueData) {
    const now = Date.now();
    if (now - lastSnapshotRef.current < SNAPSHOT_INTERVAL_MS) return;
    lastSnapshotRef.current = now;

    const agents = queueData.agents
      .filter((a) => a.queue_opt_in && Object.keys(a.queue_opt_in).length > 0)
      .map((a) => ({
        id: a.agent_id,
        name: a.display_name,
        queues: Object.entries(a.queue_opt_in!).map(([name, receive_call]) => ({ name, receive_call })),
      }));

    if (agents.length === 0) return;
    try {
      await fetch("/api/zoom/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agents }),
      });
    } catch (e) {
      console.warn("[ZoomQueue] snapshot save failed:", e);
    }
  }

  /** Load historical hours from Supabase and merge with session counts */
  async function refreshAvailability() {
    try {
      const r = await fetch(`/api/zoom/availability?date=${todayPst()}`);
      if (!r.ok) return;
      const j = await r.json();
      if (j.agents) {
        supabaseHoursRef.current = j.agents as QueueHours;
        recalcHours();
      }
    } catch (e) {
      console.warn("[ZoomQueue] availability fetch failed:", e);
    }
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchZoomQueue();
      setData(r);
      accumulateSession(r);
      saveSnapshot(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    refreshAvailability();
    const id = setInterval(refreshAvailability, SNAPSHOT_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return { data, queueHours, loading, error, tick, refresh };
}
