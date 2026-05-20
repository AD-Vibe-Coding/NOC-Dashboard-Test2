import { useCallback, useEffect, useState } from "react";
import { desc, eq } from "drizzle-orm";
import { db, dbReady, schema } from "../../db";
import { extractSummary, type ImportResult, type SourceType } from "./import";

export type PerformanceMetric = typeof schema.performance_metrics.$inferSelect;
export type PerformanceImport = typeof schema.performance_imports.$inferSelect;

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
        const [m, i] = await Promise.all([
          db
            .select()
            .from(schema.performance_metrics)
            .orderBy(desc(schema.performance_metrics.created_at)),
          db
            .select()
            .from(schema.performance_imports)
            .orderBy(desc(schema.performance_imports.created_at)),
        ]);
        if (!cancelled) {
          setMetrics(m);
          setImports(i);
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
 * PGlite (like Postgres) caps a single statement at 65,535 bind parameters
 * (the wire protocol uses a uint16 for the parameter count). With 17
 * columns per row, that's a hard upper bound of ~3,855 rows per INSERT —
 * but pglite's internal allocator throws "Invalid array length" before
 * we get anywhere near that, because some implementations reserve more.
 *
 * 500 rows × 17 cols = 8,500 params per batch, well under any limit, and
 * keeps each transaction small enough to remain responsive in IndexedDB.
 */
const INSERT_BATCH_SIZE = 500;

/**
 * Persist an ImportResult to the DB. Each sheet becomes one row in
 * `performance_imports`, plus N rows in `performance_metrics` (chunked
 * into INSERT_BATCH_SIZE-sized batches to stay under the PGlite parameter
 * limit). Idempotent in the sense that calling it twice creates two
 * distinct imports (the user can roll back via the History tab).
 */
export async function persistImport(
  result: ImportResult,
  importedBy: string | null,
): Promise<{ inserts: number; sheets: number }> {
  await dbReady;
  let totalInserts = 0;
  for (const sheet of result.bySheet) {
    const [imp] = await db
      .insert(schema.performance_imports)
      .values({
        file_name: result.fileName,
        imported_by: importedBy ?? null,
        source_type: sheet.sourceType,
        sheet_name: sheet.sheetName,
        row_count: sheet.totalRows,
        matched_count: sheet.matchedRows,
        skipped_count: sheet.skippedRows,
      })
      .returning({ id: schema.performance_imports.id });

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

    // Chunked inserts — one await per batch. Per-batch try/catch surfaces
    // any failure with a clear message instead of dropping it on the floor
    // as an unhandled promise rejection.
    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
      try {
        await db.insert(schema.performance_metrics).values(batch);
        totalInserts += batch.length;
      } catch (err) {
        console.error(
          `[performance-tracker] Insert batch failed for sheet "${sheet.sheetName}" rows ${i}–${i + batch.length}:`,
          err,
        );
        throw new Error(
          `Failed to import sheet "${sheet.sheetName}" (${batch.length} rows starting at row ${i}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  return { inserts: totalInserts, sheets: result.bySheet.length };
}

/** Delete a single import + all its metric rows. */
export async function deleteImport(importId: number): Promise<void> {
  await dbReady;
  await db
    .delete(schema.performance_metrics)
    .where(eq(schema.performance_metrics.import_id, importId));
  await db
    .delete(schema.performance_imports)
    .where(eq(schema.performance_imports.id, importId));
}

/** Wipe all performance data — used by the "Reset" button. */
export async function clearAllPerformanceData(): Promise<void> {
  await dbReady;
  await db.delete(schema.performance_metrics);
  await db.delete(schema.performance_imports);
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
  const all = await db.select().from(schema.performance_metrics);
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
      await db
        .update(schema.performance_metrics)
        .set({
          period_month: summary.period_month ?? null,
          period_quarter: summary.period_quarter ?? null,
          queue: summary.queue ?? null,
          success_count: newSuccess,
        })
        .where(eq(schema.performance_metrics.id, row.id));
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
  const all = await db
    .select()
    .from(schema.performance_metrics)
    .where(eq(schema.performance_metrics.member_name, memberName));
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

export interface AggregateOptions {
  queue?: Queue | "all";
  period?:
    | { type: "all" }
    | { type: "month"; value: string }
    | { type: "quarter"; value: string };
  excludeMaintenance?: boolean;
}

const maintenanceCache = new WeakMap<PerformanceMetric, boolean>();
export function isMaintenanceTicket(m: PerformanceMetric): boolean {
  if (m.source_type !== "tickets") return false;
  const cached = maintenanceCache.get(m);
  if (cached !== undefined) return cached;
  let result = false;
  if (m.raw_json) {
    try {
      const raw = JSON.parse(m.raw_json) as Record<string, unknown>;
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const targets = new Set([norm("issue"), norm("issue_type"), norm("Issue Type")]);
      let value: unknown;
      for (const k of Object.keys(raw)) {
        if (targets.has(norm(k))) {
          value = raw[k];
          break;
        }
      }
      if (value != null && value !== "") {
        const v = String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
        if (v.includes("maintenancenotification")) result = true;
      }
    } catch {
      /* corrupt raw_json — treat as non-maintenance, don't crash */
    }
  }
  maintenanceCache.set(m, result);
  return result;
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
