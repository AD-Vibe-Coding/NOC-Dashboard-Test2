import { useCallback, useEffect, useState } from "react";
import { db, dbReady, schema } from "../../db";
import { extractSummary, type ImportResult, type SourceType } from "./import";

export type PerformanceMetric = typeof schema.performance_metrics.$inferSelect;
export type PerformanceImport = typeof schema.performance_imports.$inferSelect;

// Hydration is now done server-side in api/_lib/crud.js — the GET
// handler for performance_metrics fills derived fields from raw_json
// and strips raw_json from the response (~11MB → ~1.4MB).

/**
 * Hook for the Performance Tracker. Loads all imports + metrics from PGlite
 * and re-fetches whenever `refreshKey` increments.
 */
export function usePerformanceData() {
  const [metrics, setMetrics] = useState<PerformanceMetric[]>([]);
  const [imports, setImports] = useState<PerformanceImport[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await dbReady;
        // Use Promise.allSettled so one table failing doesn't block the other.
        const [mResult, iResult] = await Promise.allSettled([
          db.performance_metrics.list({
            orderBy: { column: "id", ascending: false },
          }),
          db.performance_imports.list({
            orderBy: { column: "created_at", ascending: false },
          }),
        ]);
        if (!cancelled) {
          setMetrics(mResult.status === "fulfilled" ? mResult.value : []);
          setImports(iResult.status === "fulfilled" ? iResult.value : []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { metrics, imports, loading, refresh };
}

/**
 * Postgres caps a single statement at 65,535 bind parameters (the wire
 * protocol uses a uint16 for the parameter count). With 7 effective columns
 * (after missing-column stripping), 100 rows keeps each request small and
 * avoids overwhelming the Supabase connection pool / Vite dev-server proxy.
 */
const INSERT_BATCH_SIZE = 100;

/** Max retries per batch before giving up. */
const BATCH_MAX_RETRIES = 6;

/** Delay between batches (ms) to avoid connection pool / proxy exhaustion. */
const BATCH_DELAY_MS = 200;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Persist an ImportResult to Supabase. Each sheet becomes one row in
 * `performance_imports`, plus N rows in `performance_metrics` (chunked
 * into INSERT_BATCH_SIZE-sized batches to keep each /api/* request
 * payload reasonable). Idempotent in the sense that calling it twice
 * creates two distinct imports (the user can roll back via History).
 */
export async function persistImport(
  result: ImportResult,
  importedBy: string | null,
): Promise<{ inserts: number; sheets: number }> {
  await dbReady;
  let totalInserts = 0;
  for (const sheet of result.bySheet) {
    const inserted = await db.performance_imports.insert({
      file_name: result.fileName,
      imported_by: importedBy ?? null,
      source_type: sheet.sourceType,
      sheet_name: sheet.sheetName,
      row_count: sheet.totalRows,
      matched_count: sheet.matchedRows,
      skipped_count: sheet.skippedRows,
    });
    const imp = inserted[0];
    if (!imp) {
      throw new Error(
        `Insert for sheet "${sheet.sheetName}" returned no row (was the table provisioned via Push to Supabase?)`,
      );
    }

    if (sheet.rows.length === 0) continue;

    const rows = sheet.rows.map((r) => ({
      import_id: imp.id,
      member_name: r.memberName,
      source_type: sheet.sourceType,
      total_count: r.summary.total_count ?? null,
      success_count: r.summary.success_count ?? null,
      duration_minutes: r.summary.duration_minutes ?? null,
      score: r.summary.score ?? null,
      period_start: r.summary.period_start ?? null,
      period_end: r.summary.period_end ?? null,
      queue: r.summary.queue ?? null,
      period_month: r.summary.period_month ?? null,
      period_quarter: r.summary.period_quarter ?? null,
      ack_minutes: r.summary.ack_minutes ?? null,
      carrier_ticket_minutes: r.summary.carrier_ticket_minutes ?? null,
      handle_seconds: r.summary.handle_seconds ?? null,
      wait_seconds: r.summary.wait_seconds ?? null,
      raw_json: JSON.stringify(r.raw),
    }));

    // Chunked inserts with per-batch retry + throttle. The retry handles
    // transient Supabase connection pool exhaustion; the delay between
    // batches prevents overwhelming the free-tier pool (max 15 connections).
    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= BATCH_MAX_RETRIES; attempt++) {
        try {
          await db.performance_metrics.insertBulk(batch);
          totalInserts += batch.length;
          lastErr = null;
          break; // success
        } catch (err) {
          lastErr = err;
          console.warn(
            `[performance-tracker] Batch ${Math.floor(i / INSERT_BATCH_SIZE) + 1} attempt ${attempt}/${BATCH_MAX_RETRIES} failed:`,
            err instanceof Error ? err.message : err,
          );
          if (attempt < BATCH_MAX_RETRIES) {
            // Exponential backoff: 1s, 2s, 4s, 8s, 16s
            // The sandbox edge proxy returns 502 under sustained load;
            // giving it progressively more time to recover is key.
            await sleep(1000 * Math.pow(2, attempt - 1));
          }
        }
      }
      if (lastErr) {
        console.error(
          `[performance-tracker] Insert batch failed for sheet "${sheet.sheetName}" rows ${i}–${i + batch.length} after ${BATCH_MAX_RETRIES} attempts`,
        );
        throw new Error(
          `Failed to import sheet "${sheet.sheetName}" (${batch.length} rows starting at row ${i}): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
        );
      }
      // Small delay between batches to avoid connection pool saturation
      if (i + INSERT_BATCH_SIZE < rows.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }
  }
  return { inserts: totalInserts, sheets: result.bySheet.length };
}

/** Delete a single import + all its metric rows. */
export async function deleteImport(importId: number): Promise<void> {
  await dbReady;
  await db.performance_metrics.deleteWhere({ import_id: importId });
  await db.performance_imports.deleteById(importId);
}

/** Wipe all performance data — used by the "Reset" button. */
export async function clearAllPerformanceData(): Promise<void> {
  await dbReady;
  await db.performance_metrics.deleteAll();
  await db.performance_imports.deleteAll();
}

/**
 * Walk every performance_metrics row, re-derive period_month / period_quarter
 * / queue from its raw_json using the CURRENT extractor logic, and write back
 * only when the value changed. Used to retroactively fix rows imported with
 * an older (buggy) extractor.
 *
 * Returns the count of rows that were actually updated. Imports the
 * extractor lazily to avoid circular module init.
 */
export async function rederivePeriodsForAllRows(): Promise<{
  scanned: number;
  updated: number;
}> {
  await dbReady;
  const { extractSummary } = await import("./import");
  const all = await db.performance_metrics.list();
  let updated = 0;
  for (const row of all) {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(row.raw_json) as Record<string, unknown>;
    } catch {
      // Corrupt raw_json — skip this row but don't fail the whole pass.
      continue;
    }
    const summary = extractSummary(raw, row.source_type as SourceType);
    // Compare every field the re-derive touches. Important: success_count
    // is now nullable (was previously coerced to 0 for blanks). Comparing
    // with `!==` correctly catches the null↔0 transition.
    const newSuccess = summary.success_count ?? null;
    const changed =
      summary.period_month !== row.period_month ||
      summary.period_quarter !== row.period_quarter ||
      summary.queue !== row.queue ||
      newSuccess !== row.success_count;
    if (!changed) continue;
    try {
      await db.performance_metrics.updateById(row.id, {
        period_month: summary.period_month ?? null,
        period_quarter: summary.period_quarter ?? null,
        queue: summary.queue ?? null,
        success_count: newSuccess,
      });
      updated++;
    } catch (err) {
      console.warn(
        `[performance-tracker] re-derive failed for row ${row.id}:`,
        err,
      );
    }
  }
  return { scanned: all.length, updated };
}

// =============================================================================
// Diagnostics — used by the UI debug modal to inspect why a count is "off"
// =============================================================================

export interface MemberTicketDiagnostic {
  memberName: string;
  totalRows: number;
  byPeriod: Array<{ period_month: string | null; count: number }>;
  samples: Array<{
    id: number;
    period_month: string | null;
    period_quarter: string | null;
    queue: string | null;
    rawSnapshot: Record<string, unknown>;
  }>;
}

/**
 * Diagnostic snapshot for a single member's tickets.
 */
export async function diagnoseMemberTickets(
  memberName: string,
  options?: { samplePeriod?: string | null; sampleSize?: number },
): Promise<MemberTicketDiagnostic> {
  await dbReady;
  const sampleSize = options?.sampleSize ?? 8;
  const all = await db.performance_metrics.list({
    filter: { member_name: memberName },
  });
  const ticketRows = all.filter((r) => r.source_type === "tickets");

  const periodCounts = new Map<string | null, number>();
  for (const r of ticketRows) {
    periodCounts.set(r.period_month, (periodCounts.get(r.period_month) ?? 0) + 1);
  }
  const byPeriod = Array.from(periodCounts.entries())
    .map(([period_month, count]) => ({ period_month, count }))
    .sort((a, b) => {
      if (a.period_month == null) return 1;
      if (b.period_month == null) return -1;
      return b.period_month.localeCompare(a.period_month);
    });

  const filterFor = options?.samplePeriod;
  const sourceForSamples = filterFor
    ? ticketRows.filter((r) => r.period_month === filterFor)
    : ticketRows;

  const samples = pickEvenly(sourceForSamples, sampleSize).map((r) => {
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(r.raw_json) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    const rawSnapshot: Record<string, unknown> = {};
    const keys = [
      "month",
      "Month",
      "month_label",
      "Month Label",
      "year_opened",
      "Year",
      "year",
      "quarter",
      "Quarter",
      "time_taken_to_close_tickets",
      "Time Taken to Close Tickets",
      "first_touch",
      "time_to_carrier_ticket",
      "mttr",
      "agent",
      "agent_name",
      "Agent Name",
      "To Name",
      "owner",
    ];
    for (const k of keys) {
      if (k in raw) {
        const v = raw[k];
        if (v instanceof Date) {
          rawSnapshot[k] = `[Date ${v.toISOString().slice(0, 10)}]`;
        } else {
          rawSnapshot[k] = v;
        }
      }
    }
    for (const k of Object.keys(raw)) {
      if (k in rawSnapshot) continue;
      const lk = k.toLowerCase();
      if (
        (lk.includes("close") && (lk.includes("24") || lk.includes("time"))) ||
        (lk.includes("taken") && lk.includes("close"))
      ) {
        const v = raw[k];
        if (v instanceof Date) {
          rawSnapshot[k] = `[Date ${v.toISOString().slice(0, 10)}]`;
        } else {
          rawSnapshot[k] = v;
        }
      }
    }
    return {
      id: r.id,
      period_month: r.period_month,
      period_quarter: r.period_quarter,
      queue: r.queue,
      rawSnapshot,
    };
  });

  return {
    memberName,
    totalRows: ticketRows.length,
    byPeriod,
    samples,
  };
}

function pickEvenly<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr.slice();
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor((i / n) * arr.length);
    out.push(arr[idx]);
  }
  return out;
}

// =============================================================================
// In-memory aggregations (computed in JS — small dataset, no need for SQL)
// =============================================================================

export type Queue = "noc" | "mobility";

export type DayFilter = "all" | "weekday" | "weekend";
export type ShiftFilter = "all" | "early" | "mid" | "late";

/** Human-readable labels for the shift dropdown. */
export const SHIFT_LABELS: Record<ShiftFilter, string> = {
  all: "All shifts",
  early: "Early (3 AM – 12 PM)",
  mid: "Mid (11 AM – 8 PM)",
  late: "Late (7 PM – 4 AM)",
};

// Shift hour ranges (inclusive). Overlap hours belong to both shifts.
//   Early: 3–11   (hour 11 shared with Mid, hour 3 shared with Late)
//   Mid:   11–19   (hour 11 shared with Early, hour 19 shared with Late)
//   Late:  19–3    (hour 19 shared with Mid, hour 3 shared with Early)
const SHIFT_HOURS: Record<Exclude<ShiftFilter, "all">, Set<number>> = {
  early: new Set([3, 4, 5, 6, 7, 8, 9, 10, 11]),
  mid: new Set([11, 12, 13, 14, 15, 16, 17, 18, 19]),
  late: new Set([19, 20, 21, 22, 23, 0, 1, 2, 3]),
};

/** Check if a given hour (0-23) matches the selected shift. */
export function hourMatchesShift(
  hour: number | null | undefined,
  shift: ShiftFilter,
): boolean {
  if (shift === "all") return true;
  if (hour === null || hour === undefined) return true; // unknown → include
  return SHIFT_HOURS[shift].has(hour);
}

export interface AggregateOptions {
  queue?: Queue | "all";
  period?:
    | { type: "all" }
    | { type: "month"; value: string }
    | { type: "quarter"; value: string };
  excludeMaintenance?: boolean;
  /** Filter by weekday/weekend. "all" = no filter (default). */
  dayFilter?: DayFilter;
  /** Filter by shift. "all" = no filter (default). */
  shiftFilter?: ShiftFilter;
}

/**
 * Check if a metric row is a "Maintenance Notification" ticket.
 *
 * The server-side hydration sets `is_maintenance` on every performance_metrics
 * row (derived from raw_json's issue/issue_type column). We use that flag
 * here. Falls back to parsing raw_json directly if the flag isn't present
 * (e.g. during a race between schema push and hydration).
 */
export function isMaintenanceTicket(m: PerformanceMetric): boolean {
  if (m.source_type !== "tickets") return false;
  // Use the server-hydrated flag if available
  if ((m as Record<string, unknown>).is_maintenance !== undefined) {
    return !!(m as Record<string, unknown>).is_maintenance;
  }
  // Fallback: parse raw_json (only needed if server didn't hydrate)
  if (!m.raw_json) return false;
  try {
    const raw = JSON.parse(m.raw_json) as Record<string, unknown>;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const targets = new Set([norm("issue"), norm("issue_type"), norm("Issue Type")]);
    let value: unknown;
    for (const k of Object.keys(raw)) {
      if (targets.has(norm(k))) { value = raw[k]; break; }
    }
    if (value != null && value !== "") {
      const v = String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
      return v.includes("maintenancenotification");
    }
  } catch { /* treat as non-maintenance */ }
  return false;
}

export interface SourceBucket {
  rowCount: number;
  totalSum: number;
  successSum: number;
  durationSum: number;
  latestScore: number | null;
  latestScoreText: string | null;
  ackMinutesSum: number;
  ackMinutesSamples: number;
  mttrMinutesSum: number;
  mttrMinutesSamples: number;
  carrierUnder15Count: number;
  carrierTotalCount: number;
  within24Count: number;
  within24TotalCount: number;
  answeredCount: number;
  refusedCount: number;
  missedCount: number;
  handleSecondsSum: number;
  handleSecondsSamples: number;
  waitSecondsSum: number;
  waitSecondsSamples: number;
  slaMetCount: number;
  slaMetTotalCount: number;
}

export interface MemberSummary {
  memberName: string;
  byType: Partial<Record<SourceType, SourceBucket>>;
}

function emptyBucket(): SourceBucket {
  return {
    rowCount: 0,
    totalSum: 0,
    successSum: 0,
    durationSum: 0,
    latestScore: null,
    latestScoreText: null,
    ackMinutesSum: 0,
    ackMinutesSamples: 0,
    mttrMinutesSum: 0,
    mttrMinutesSamples: 0,
    carrierUnder15Count: 0,
    carrierTotalCount: 0,
    within24Count: 0,
    within24TotalCount: 0,
    answeredCount: 0,
    refusedCount: 0,
    missedCount: 0,
    handleSecondsSum: 0,
    handleSecondsSamples: 0,
    waitSecondsSum: 0,
    waitSecondsSamples: 0,
    slaMetCount: 0,
    slaMetTotalCount: 0,
  };
}

function within24FromRaw(rawJson: string | null): number | null {
  if (!rawJson) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    return null;
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const targetA = norm("time_taken_to_close_tickets");
  const targetB = norm("Time Taken to Close Tickets");
  let value: unknown = undefined;
  for (const k of Object.keys(parsed)) {
    const n = norm(k);
    if (n === targetA || n === targetB) {
      const v = parsed[k];
      if (v != null && v !== "") {
        value = v;
        break;
      }
    }
  }
  if (value == null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value ? 1 : 0;
  const s = String(value).trim().toLowerCase();
  if (!s) return null;
  if (/\b(less\s*than|under|below)\b.*\b24\b/.test(s)) return 1;
  if (/\b(more\s*than|greater\s*than|over|above|>=?|exceed)\b.*\b24\b/.test(s)) return 0;
  if (s === "yes" || s === "y" || s === "true" || s === "1" || s === "closed" || /\bwithin\b/.test(s)) return 1;
  if (s === "no" || s === "n" || s === "false" || s === "0" || /\bover\b/.test(s) || /\bnot\s+closed\b/.test(s)) return 0;
  return null;
}

export function filterMetrics(
  metrics: PerformanceMetric[],
  options?: AggregateOptions,
): PerformanceMetric[] {
  if (!options) return metrics;
  return metrics.filter((m) => {
    if (options.queue && options.queue !== "all") {
      const queue = m.queue ?? livePeriodFromRaw(m).queue;
      if (queue !== options.queue) return false;
    }
    const p = options.period;
    if (p && p.type !== "all") {
      if (p.type === "month") {
        const month = m.period_month ?? livePeriodFromRaw(m).period_month;
        if (month !== p.value) return false;
      }
      if (p.type === "quarter") {
        const quarter =
          m.period_quarter ?? livePeriodFromRaw(m).period_quarter;
        if (quarter !== p.value) return false;
      }
    }
    if (options.excludeMaintenance && isMaintenanceTicket(m)) {
      return false;
    }
    // Weekday / weekend filter — uses server-hydrated `is_weekend` flag
    if (options.dayFilter && options.dayFilter !== "all") {
      const isWeekend = (m as Record<string, unknown>).is_weekend;
      if (isWeekend === null || isWeekend === undefined) return true; // unknown → include
      if (options.dayFilter === "weekday" && isWeekend === true) return false;
      if (options.dayFilter === "weekend" && isWeekend === false) return false;
    }
    // Shift filter — uses server-hydrated `hour` field (0-23)
    if (options.shiftFilter && options.shiftFilter !== "all") {
      const hour = (m as Record<string, unknown>).hour as number | null | undefined;
      if (!hourMatchesShift(hour, options.shiftFilter)) return false;
    }
    return true;
  });
}

const livePeriodCache = new WeakMap<
  PerformanceMetric,
  {
    period_month: string | null;
    period_quarter: string | null;
    queue: string | null;
  }
>();
function livePeriodFromRaw(m: PerformanceMetric) {
  const cached = livePeriodCache.get(m);
  if (cached) return cached;
  const empty = {
    period_month: null,
    period_quarter: null,
    queue: null,
  };
  if (!m.raw_json) {
    livePeriodCache.set(m, empty);
    return empty;
  }
  try {
    const raw = JSON.parse(m.raw_json) as Record<string, unknown>;
    const s = extractSummary(raw, m.source_type as SourceType);
    const result = {
      period_month: s.period_month ?? null,
      period_quarter: s.period_quarter ?? null,
      queue: s.queue ?? null,
    };
    livePeriodCache.set(m, result);
    return result;
  } catch {
    livePeriodCache.set(m, empty);
    return empty;
  }
}

export function aggregateMetrics(
  metrics: PerformanceMetric[],
  members: string[],
  options?: AggregateOptions,
): MemberSummary[] {
  const filtered = filterMetrics(metrics, options);
  const out: MemberSummary[] = members.map((name) => ({
    memberName: name,
    byType: {},
  }));
  const byName = new Map<string, MemberSummary>();
  for (const s of out) byName.set(s.memberName, s);

  for (const m of filtered) {
    const summary = byName.get(m.member_name);
    if (!summary) continue;
    const type = m.source_type as SourceType;
    const bucket = (summary.byType[type] ??= emptyBucket());

    bucket.rowCount++;
    if (m.total_count != null) bucket.totalSum += m.total_count;
    if (m.success_count != null) bucket.successSum += m.success_count;
    if (m.duration_minutes != null) bucket.durationSum += m.duration_minutes;
    if (m.score != null) {
      bucket.latestScoreText = m.score;
      const parsed = parseFloat(String(m.score).replace(/[%\s]/g, ""));
      if (isFinite(parsed)) bucket.latestScore = parsed;
    }

    if (type === "tickets") {
      if (m.ack_minutes != null) {
        bucket.ackMinutesSum += m.ack_minutes;
        bucket.ackMinutesSamples++;
      }
      if (m.duration_minutes != null) {
        bucket.mttrMinutesSum += m.duration_minutes;
        bucket.mttrMinutesSamples++;
      }
      if (m.carrier_ticket_minutes != null) {
        bucket.carrierTotalCount++;
        if (m.carrier_ticket_minutes >= 0 && m.carrier_ticket_minutes <= 15) {
          bucket.carrierUnder15Count++;
        }
      }
      const within24Live = within24FromRaw(m.raw_json);
      const within24 = within24Live ?? m.success_count;
      if (within24 != null) {
        bucket.within24TotalCount++;
        if (within24 === 1) bucket.within24Count++;
      }
    }

    if (type === "calls") {
      if (m.success_count === 1) bucket.answeredCount++;
      const result = (m.score ?? "").toString().toLowerCase();
      if (m.success_count !== 1) {
        if (
          /\bno\s*answer\b/.test(result) ||
          /\banswered\s*by\s*other\b/.test(result)
        ) {
          bucket.refusedCount++;
        } else if (result !== "") {
          bucket.missedCount++;
        }
      }
      if (m.handle_seconds != null) {
        bucket.handleSecondsSum += m.handle_seconds;
        bucket.handleSecondsSamples++;
      }
      if (m.wait_seconds != null) {
        bucket.waitSecondsSum += m.wait_seconds;
        bucket.waitSecondsSamples++;
      }
    }

    if (type === "tasks") {
      if (m.success_count != null) {
        bucket.slaMetTotalCount++;
        if (m.success_count === 1) bucket.slaMetCount++;
      }
    }
  }
  return out;
}

export function listAvailablePeriods(metrics: PerformanceMetric[]) {
  const months = new Set<string>();
  const quarters = new Set<string>();
  for (const m of metrics) {
    const month = m.period_month ?? livePeriodFromRaw(m).period_month;
    const quarter = m.period_quarter ?? livePeriodFromRaw(m).period_quarter;
    if (month) months.add(month);
    if (quarter) quarters.add(quarter);
  }
  return {
    months: Array.from(months).sort().reverse(),
    quarters: Array.from(quarters).sort().reverse(),
  };
}

export function totalForType(
  metrics: PerformanceMetric[],
  type: SourceType,
  field: "total_count" | "success_count" | "duration_minutes",
): number {
  let sum = 0;
  for (const m of metrics) {
    if (m.source_type !== type) continue;
    const v = m[field];
    if (v != null) sum += v;
  }
  return sum;
}
