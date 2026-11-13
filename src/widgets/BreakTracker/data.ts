import { useEffect, useState } from "react";
import { db, dbReady, schema } from "../../db";
import { resolveTeamMember } from "../PerformanceTracker/team";

type Break = typeof schema.breaks.$inferSelect;

function canonicalBreakKey(name: string) {
  return (resolveTeamMember(name) ?? name).trim().toLowerCase();
}

function dedupeActiveBreaks(rows: Break[]) {
  const latestByPerson = new Map<string, Break>();
  for (const row of rows) {
    const key = canonicalBreakKey(row.employee_name);
    const current = latestByPerson.get(key);
    if (!current) {
      latestByPerson.set(key, row);
      continue;
    }
    const currentStarted = new Date(current.start_time).getTime();
    const nextStarted = new Date(row.start_time).getTime();
    if (nextStarted >= currentStarted) {
      latestByPerson.set(key, row);
    }
  }
  return [...latestByPerson.values()].sort(
    (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
  );
}

async function reconcileActiveBreakRows(activeRows: Break[], historyRows: Break[]) {
  const latestEndedAtByPerson = new Map<string, number>();
  for (const row of historyRows) {
    if (!row.end_time) continue;
    const key = canonicalBreakKey(row.employee_name);
    const endedAt = new Date(row.end_time).getTime();
    const current = latestEndedAtByPerson.get(key) ?? 0;
    if (endedAt > current) latestEndedAtByPerson.set(key, endedAt);
  }

  const rowsByPerson = new Map<string, Break[]>();
  for (const row of activeRows) {
    const key = canonicalBreakKey(row.employee_name);
    const group = rowsByPerson.get(key) ?? [];
    group.push(row);
    rowsByPerson.set(key, group);
  }

  let repaired = false;
  const now = new Date();

  for (const group of rowsByPerson.values()) {
    group.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
    const keep = group[0];
    const latestEndedAt = latestEndedAtByPerson.get(canonicalBreakKey(keep.employee_name)) ?? 0;

    // If an ended row exists after this active row started, the active row is stale.
    if (latestEndedAt > new Date(keep.start_time).getTime()) {
      const duration = Math.max(1, Math.round((now.getTime() - new Date(keep.start_time).getTime()) / 60000));
      await db.breaks.updateById(keep.id, {
        end_time: now.toISOString(),
        duration_minutes: duration,
        is_active: false,
      });
      repaired = true;
    }

    for (const duplicate of group.slice(1)) {
      const duration = Math.max(1, Math.round((now.getTime() - new Date(duplicate.start_time).getTime()) / 60000));
      await db.breaks.updateById(duplicate.id, {
        end_time: now.toISOString(),
        duration_minutes: duration,
        is_active: false,
      });
      repaired = true;
    }
  }

  return repaired;
}

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
      let [activeRows, historyRows] = await Promise.all([
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

      const repaired = await reconcileActiveBreakRows(activeRows, historyRows);
      if (repaired) {
        [activeRows, historyRows] = await Promise.all([
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
      }

      setActive(dedupeActiveBreaks(activeRows));
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
