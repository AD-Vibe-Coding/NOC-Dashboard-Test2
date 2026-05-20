import { useEffect, useState } from "react";
import { desc, eq } from "drizzle-orm";
import { db, dbReady, schema } from "../../db";

type Break = typeof schema.breaks.$inferSelect;

/**
 * Data hook for the Break Tracker widget. The widget tracks breaks entirely
 * in the local PGlite DB — there is no longer a Slack read path. Slack is
 * still used as a notification target (the widget posts break-start and
 * break-end messages to #noc-team), but the list of who's on break and the
 * history both live in the local DB.
 */
export function useBreakData() {
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<Break[]>([]);
  const [history, setHistory] = useState<Break[]>([]);
  const [tick, setTick] = useState(0);

  async function refresh() {
    const activeRows = await db
      .select()
      .from(schema.breaks)
      .where(eq(schema.breaks.is_active, true))
      .orderBy(desc(schema.breaks.start_time));
    const historyRows = await db
      .select()
      .from(schema.breaks)
      .where(eq(schema.breaks.is_active, false))
      .orderBy(desc(schema.breaks.start_time))
      .limit(50);
    setActive(activeRows);
    setHistory(historyRows);
  }

  useEffect(() => {
    dbReady.then(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    refresh();
  }, [ready]);

  // 1-second tick for live duration counters on active breaks.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return { ready, active, history, tick, refresh };
}
