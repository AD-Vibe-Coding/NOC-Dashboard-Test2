import { useEffect, useRef, useState } from "react";
import { fetchZoomQueue, type ZoomQueueData } from "../../lib/zoom";

export interface AvailabilityData {
  date: string;
  // agent_name → queue_name → hour → receive_call
  agents: Record<string, Record<string, Record<number, boolean>>>;
}

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // save snapshot every 5 min

/**
 * Shared data hook for the Zoom Queue widget — used by both the Tile (compact)
 * and Full views. Polls every 15s and ticks every second for live durations.
 * Also saves periodic opt-in snapshots to Supabase for the daily timeline.
 */
export function useZoomQueue() {
  const [data, setData]               = useState<ZoomQueueData | null>(null);
  const [availability, setAvailability] = useState<AvailabilityData | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [tick, setTick]               = useState(0);
  const lastSnapshotRef               = useRef<number>(0);

  function todayPst(): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  }

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

  async function refreshAvailability() {
    try {
      const r = await fetch(`/api/zoom/availability?date=${todayPst()}`);
      if (r.ok) {
        const j: AvailabilityData = await r.json();
        setAvailability(j);
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
      // Save snapshot (debounced to every 5 min)
      saveSnapshot(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const queueId = setInterval(refresh, 15_000);
    return () => clearInterval(queueId);
  }, []);

  // Load availability on mount and refresh every 5 min
  useEffect(() => {
    refreshAvailability();
    const availId = setInterval(refreshAvailability, SNAPSHOT_INTERVAL_MS);
    return () => clearInterval(availId);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return { data, availability, loading, error, tick, refresh };
}
