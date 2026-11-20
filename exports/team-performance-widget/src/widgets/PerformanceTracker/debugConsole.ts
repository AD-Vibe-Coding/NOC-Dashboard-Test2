/**
 * Developer console helpers for the Performance Tracker.
 *
 * Exposes a `window.perf` namespace that lets the user inspect their
 * imported data directly from the browser DevTools console without
 * having to know the schema or write SQL. Examples:
 *
 *   await perf.help()                      // list available commands
 *   await perf.all()                       // every row in the DB
 *   await perf.tickets("Hamza Rahmani")    // dump 5 sample ticket rows
 *   await perf.calls("Hamza Rahmani")      // dump 5 sample call rows
 *   await perf.tasks("Hamza Rahmani")      // dump 5 sample task rows
 *   await perf.summary("Hamza Rahmani")    // counts per source/month
 *   await perf.columns("calls")            // unique column names across rows
 *   await perf.values("tasks", "month")    // distinct values in one column
 *   await perf.raw(42)                     // full raw_json for row id 42
 *   await perf.rederive()                  // re-run the extractor over all rows
 *
 * All functions return plain JS objects/arrays so console.table works
 * directly on the result.
 */
import { db, dbReady } from "../../db";
import { rederivePeriodsForAllRows } from "./data";

type AnyRecord = Record<string, unknown>;

async function getAllMetrics() {
  await dbReady;
  return db.performance_metrics.list();
}

function parseRaw(rawJson: string): AnyRecord {
  try {
    return JSON.parse(rawJson) as AnyRecord;
  } catch {
    return {};
  }
}

/** Return every row in performance_metrics (all source types). */
async function all() {
  const rows = await getAllMetrics();
  console.log(`[perf] ${rows.length} total rows across all source types`);
  return rows;
}

/** Return the full parsed raw_json for one row by id. */
async function raw(rowId: number) {
  const rows = await getAllMetrics();
  const row = rows.find((r) => r.id === rowId);
  if (!row) {
    console.warn(`[perf] no row with id ${rowId}`);
    return null;
  }
  return {
    id: row.id,
    member_name: row.member_name,
    source_type: row.source_type,
    period_month: row.period_month,
    period_quarter: row.period_quarter,
    queue: row.queue,
    success_count: row.success_count,
    total_count: row.total_count,
    raw_json_parsed: parseRaw(row.raw_json),
  };
}

/** Print N sample rows of a given source type, optionally filtered by member. */
async function sample(
  sourceType: "tickets" | "calls" | "tasks" | "queue" | "audit",
  memberName?: string,
  n = 5,
) {
  const allRows = await getAllMetrics();
  let rows = allRows.filter((r) => r.source_type === sourceType);
  if (memberName) {
    rows = rows.filter((r) =>
      r.member_name.toLowerCase().includes(memberName.toLowerCase()),
    );
  }
  console.log(
    `[perf] ${sourceType}${memberName ? ` for ${memberName}` : ""}: ${rows.length} total rows. Showing ${Math.min(n, rows.length)} samples.`,
  );
  const samples = rows.slice(0, n).map((r) => ({
    id: r.id,
    member_name: r.member_name,
    period_month: r.period_month,
    period_quarter: r.period_quarter,
    queue: r.queue,
    success_count: r.success_count,
    raw_json_parsed: parseRaw(r.raw_json),
  }));
  return samples;
}

/** Summarise counts for a member: rows per source/period. */
async function summary(memberName: string) {
  const allRows = await getAllMetrics();
  const rows = allRows.filter((r) =>
    r.member_name.toLowerCase().includes(memberName.toLowerCase()),
  );
  if (rows.length === 0) {
    console.warn(`[perf] no rows for ${memberName}`);
    return null;
  }
  const bySource = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const bySourceMonth = new Map<string, number>();
  for (const r of rows) {
    const sourceKey = r.source_type ?? "(null)";
    bySource.set(sourceKey, (bySource.get(sourceKey) ?? 0) + 1);
    const monthKey = r.period_month ?? "(null)";
    byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + 1);
    const composite = `${sourceKey} / ${monthKey}`;
    bySourceMonth.set(composite, (bySourceMonth.get(composite) ?? 0) + 1);
  }
  return {
    member: rows[0].member_name,
    totalRows: rows.length,
    bySource: Object.fromEntries(bySource),
    byMonth: Object.fromEntries(byMonth),
    bySourceMonth: Object.fromEntries(bySourceMonth),
  };
}

/** Get the unique column names present across raw_json of all rows of one type. */
async function columns(
  sourceType: "tickets" | "calls" | "tasks" | "queue" | "audit",
) {
  const allRows = await getAllMetrics();
  const rows = allRows.filter((r) => r.source_type === sourceType);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const raw = parseRaw(r.raw_json);
    for (const k of Object.keys(raw)) {
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const sorted = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
  console.log(
    `[perf] ${rows.length} ${sourceType} rows have ${sorted.length} unique columns.`,
  );
  return sorted;
}

/** Show the distinct values + counts in one specific column across rows of a type. */
async function values(
  sourceType: "tickets" | "calls" | "tasks" | "queue" | "audit",
  columnName: string,
  limit = 30,
) {
  const allRows = await getAllMetrics();
  const rows = allRows.filter((r) => r.source_type === sourceType);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const raw = parseRaw(r.raw_json);
    // Tolerant: match the column name case-insensitively and ignore
    // non-alphanum differences.
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const target = norm(columnName);
    let val: unknown = undefined;
    for (const k of Object.keys(raw)) {
      if (norm(k) === target) {
        val = raw[k];
        break;
      }
    }
    const key =
      val == null
        ? "(null)"
        : val === ""
          ? "(empty)"
          : typeof val === "object"
            ? JSON.stringify(val)
            : String(val);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
  console.log(
    `[perf] column "${columnName}" across ${rows.length} ${sourceType} rows. Top ${sorted.length} distinct values:`,
  );
  return sorted;
}

/** Trigger the same Re-derive Periods action the UI button performs. */
async function rederive() {
  const r = await rederivePeriodsForAllRows();
  console.log(`[perf] re-derive: scanned ${r.scanned}, updated ${r.updated}`);
  return r;
}

function help() {
  console.log(
    `%c[perf] Performance Tracker debug helpers
%c
%cQuick reference
  perf.help()                                show this message
  perf.all()                                 every row in the DB
  perf.raw(42)                               full raw_json for row id 42
  perf.tickets("Hamza Rahmani")              5 sample ticket rows
  perf.calls("Hamza Rahmani")                5 sample call rows
  perf.tasks("Hamza Rahmani")                5 sample task rows
  perf.sample("tickets", "Hamza", 10)        N sample rows (any source)
  perf.summary("Hamza Rahmani")              counts per source + month
  perf.columns("tasks")                      unique column names + counts
  perf.values("tasks", "month")              distinct values in one column
  perf.rederive()                            re-run the parser over all rows

%cAll commands return plain JS values — wrap in console.table(await ...) to render as a table.

Example:
  console.table(await perf.values("tasks", "month_label"))
  console.table(await perf.columns("tasks"))
`,
    "color:#5e9bff;font-weight:bold",
    "",
    "color:#aaa",
    "color:#aaa;font-style:italic",
  );
}

export interface PerfConsole {
  help: () => void;
  all: typeof all;
  raw: typeof raw;
  sample: typeof sample;
  tickets: (memberName?: string, n?: number) => ReturnType<typeof sample>;
  calls: (memberName?: string, n?: number) => ReturnType<typeof sample>;
  tasks: (memberName?: string, n?: number) => ReturnType<typeof sample>;
  summary: typeof summary;
  columns: typeof columns;
  values: typeof values;
  rederive: typeof rederive;
}

export function installPerformanceDebugConsole() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { perf?: PerfConsole };
  if (w.perf) return; // already installed
  const cmds: PerfConsole = {
    help,
    all,
    raw,
    sample,
    tickets: (m, n) => sample("tickets", m, n),
    calls: (m, n) => sample("calls", m, n),
    tasks: (m, n) => sample("tasks", m, n),
    summary,
    columns,
    values,
    rederive,
  };
  w.perf = cmds;
  console.log(
    "%c[perf] Performance Tracker console helpers loaded. Type %cperf.help()%c to list commands.",
    "color:#5e9bff;font-weight:bold",
    "color:#fff;background:#222;padding:1px 4px;border-radius:3px",
    "color:#5e9bff",
  );
}
