import { useEffect, useState } from "react";
import { db, dbReady, schema } from "../../db";

type Break = typeof schema.breaks.$inferSelect;

/**
 * Data hook for the Break Tracker widget. Persists to Supabase via the
 * server-mediated /api/breaks route. The widget still posts notifications
 * to Slack on start/end, but the source of truth for who's on a break
 * (and the history) is the `breaks` table.
 */
export function useBreakData() {
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<Break[]>([]);
  const [history, setHistory] = useState<Break[]>([]);
  const [tick, setTick] = useState(0);

  async function refresh() {
    try {
      const [activeRows, historyRows] = await Promise.all([
        db.breaks.list({
          filter: { is_active: true },
          orderBy: { column: "start_time", ascending: false },
        }),
        db.breaks.list({
          filter: { is_active: false },
          orderBy: { column: "start_time", ascending: false },
          limit: 50,
        }),
      ]);
      setActive(activeRows);
      setHistory(historyRows);
    } catch (e) {
      console.warn("[useBreakData] refresh failed:", e);
      // Do not retain potentially stale "active" rows after a failed refresh.
      // Reminder logic must prefer missing data over false escalations.
      setActive([]);
    }
  }

  useEffect(() => {
    dbReady.then(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    refresh();
    // Poll every 30 s so the manager's dashboard always sees fresh break state
    // from other team members' sessions. Without this, the reminder tick reads
    // stale data and fires queue reminders while someone is still on a break.
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [ready]);

  // 1-second tick for live duration counters on active breaks.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return { ready, active, history, tick, refresh };
}
