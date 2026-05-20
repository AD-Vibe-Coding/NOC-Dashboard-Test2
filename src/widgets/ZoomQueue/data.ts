import { useEffect, useState } from "react";
import { fetchZoomQueue, type ZoomQueueData } from "../../lib/zoom";

/**
 * Shared data hook for the Zoom Queue widget — used by both the Tile (compact)
 * and Full views. Polls every 15s and ticks every second for live durations.
 */
export function useZoomQueue() {
  const [data, setData] = useState<ZoomQueueData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchZoomQueue();
      setData(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return { data, loading, error, tick, refresh };
}
