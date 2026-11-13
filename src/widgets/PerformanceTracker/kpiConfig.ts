import type { MemberSummary, PerformanceMetric, SourceBucket } from "./data";

export type KpiGroup = "tickets" | "calls" | "tasks";
export type KpiKey =
  | "tickets_acked"
  | "avg_ack_time"
  | "within_24h"
  | "carrier_under_15"
  | "avg_mttr"
  | "inbound_calls"
  | "refused_calls"
  | "avg_handle_time"
  | "avg_speed_of_answer"
  | "tasks_worked"
  | "sla_met";

export interface KpiResult {
  numeric: number | null;
  value: string;
  subHint?: string;
}

export interface KpiTarget {
  kind: "max" | "min";
  value: number;
  label: string;
}

export interface KpiDefinition {
  key: KpiKey;
  label: string;
  shortLabel: string;
  group: KpiGroup;
  sourceType: "tickets" | "calls" | "tasks";
  goodWhen: "up" | "down";
  description: string;
  formula: string;
  inclusions: string[];
  exclusions: string[];
  target?: KpiTarget;
  compute: (summaries: MemberSummary[]) => KpiResult;
  rowMatches: (metric: PerformanceMetric) => boolean;
}

function formatMinutes(mins: number): string {
  if (!isFinite(mins)) return "—";
  if (mins < 1) return `${Math.round(mins * 60)}s`;
  if (mins < 60) return `${mins.toFixed(mins < 10 ? 1 : 0)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatSeconds(sec: number): string {
  if (!isFinite(sec)) return "—";
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function ticketBucket(summary: MemberSummary): SourceBucket | undefined {
  return summary.byType.tickets;
}

function callBucket(summary: MemberSummary): SourceBucket | undefined {
  return summary.byType.calls;
}

function taskBucket(summary: MemberSummary): SourceBucket | undefined {
  return summary.byType.tasks;
}

function callResult(metric: PerformanceMetric): string {
  return (metric.score ?? "").toString().toLowerCase();
}

function isRefusedCall(metric: PerformanceMetric): boolean {
  if (metric.source_type !== "calls" || metric.success_count === 1) return false;
  const result = callResult(metric);
  return /\bno\s*answer\b/.test(result) || /\banswered\s*by\s*other\b/.test(result);
}

function computeRanking(values: number[], targetValue: number, goodWhen: "up" | "down") {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length || !Number.isFinite(targetValue)) {
    return null;
  }
  const sorted = [...clean].sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
  const quartileIndex = Math.max(0, Math.floor(sorted.length * 0.75) - 1);
  const topQuartileCutoff = goodWhen === "up"
    ? sorted[quartileIndex] ?? null
    : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.25))] ?? null;
  const betterOrEqual = clean.filter((value) => {
    return goodWhen === "up" ? value <= targetValue : value >= targetValue;
  }).length;
  const percentile = Math.round((betterOrEqual / clean.length) * 100);
  return { percentile, median, topQuartileCutoff, sampleSize: clean.length };
}

export function meetsTarget(target: KpiTarget | undefined, numeric: number | null): boolean | null {
  if (!target || numeric == null) return null;
  return target.kind === "max" ? numeric <= target.value : numeric >= target.value;
}

export function getKpiRanking(def: KpiDefinition, memberName: string, summaries: MemberSummary[]) {
  const memberSummary = summaries.find((summary) => summary.memberName === memberName);
  if (!memberSummary) return null;
  const memberValue = def.compute([memberSummary]).numeric;
  if (memberValue == null) return null;
  const peerValues = summaries
    .map((summary) => def.compute([summary]).numeric)
    .filter((value): value is number => value != null);
  return computeRanking(peerValues, memberValue, def.goodWhen);
}

export function getKpiAnomaly(
  def: KpiDefinition,
  current: number | null,
  previous: number | null,
): { kind: "spike" | "drop" | "target"; label: string; color: string } | null {
  if (current != null) {
    const targetPass = meetsTarget(def.target, current);
    if (targetPass === false) {
      return { kind: "target", label: `Missed target (${def.target?.label})`, color: "red" };
    }
  }
  if (current == null || previous == null || previous === 0) return null;
  const pctChange = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pctChange) < 30) return null;
  const worsened = def.goodWhen === "up" ? pctChange < 0 : pctChange > 0;
  if (!worsened) return null;
  return {
    kind: pctChange > 0 ? "spike" : "drop",
    label: `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(Math.abs(pctChange) < 10 ? 1 : 0)}% vs prior month`,
    color: "red",
  };
}

export const KPI_DEFS: KpiDefinition[] = [
  {
    key: "tickets_acked",
    label: "Tickets Acked",
    shortLabel: "Acked",
    group: "tickets",
    sourceType: "tickets",
    goodWhen: "up",
    description: "Total ticket rows that match the active scope and filters.",
    formula: "Count of ticket rows after scope + queue + maintenance + day + shift + month filters.",
    inclusions: ["All ticket rows in scope", "Selected queue and date range", "Selected weekday/weekend and shift filters"],
    exclusions: ["Rows outside the active filters", "Maintenance tickets when Exclude maintenance is ON"],
    compute: (summaries) => {
      const total = summaries.reduce((sum, summary) => sum + (ticketBucket(summary)?.rowCount ?? 0), 0);
      return { numeric: total, value: total.toLocaleString() };
    },
    rowMatches: (metric) => metric.source_type === "tickets",
  },
  {
    key: "avg_ack_time",
    label: "Avg Ack Time",
    shortLabel: "Ack",
    group: "tickets",
    sourceType: "tickets",
    goodWhen: "down",
    description: "Average first-touch time across ticket rows with a valid ack value.",
    formula: "Sum(first_touch minutes) ÷ number of ticket rows with first_touch.",
    inclusions: ["Tickets with a parsed first_touch / ack value"],
    exclusions: ["Tickets with blank or invalid first_touch", "Maintenance tickets when excluded"],
    target: { kind: "max", value: 2, label: "< 2 min" },
    compute: (summaries) => {
      let sum = 0;
      let samples = 0;
      for (const summary of summaries) {
        const bucket = ticketBucket(summary);
        if (!bucket) continue;
        sum += bucket.ackMinutesSum;
        samples += bucket.ackMinutesSamples;
      }
      if (!samples) return { numeric: null, value: "—" };
      const avg = sum / samples;
      return { numeric: avg, value: formatMinutes(avg), subHint: `${samples} sample${samples === 1 ? "" : "s"}` };
    },
    rowMatches: (metric) => metric.source_type === "tickets" && metric.ack_minutes != null,
  },
  {
    key: "within_24h",
    label: "Within 24h",
    shortLabel: "24h",
    group: "tickets",
    sourceType: "tickets",
    goodWhen: "up",
    description: "Percent of tickets closed within 24 hours among rows with a usable close-time label.",
    formula: "within24Count ÷ within24TotalCount.",
    inclusions: ["Tickets whose close-time column clearly says under/over 24 hours"],
    exclusions: ["Open tickets or blanks with no usable close-time value", "Maintenance tickets when excluded"],
    compute: (summaries) => {
      let num = 0;
      let den = 0;
      for (const summary of summaries) {
        const bucket = ticketBucket(summary);
        if (!bucket) continue;
        num += bucket.within24Count;
        den += bucket.within24TotalCount;
      }
      if (!den) return { numeric: null, value: "—" };
      const pct = (num / den) * 100;
      return { numeric: pct, value: `${Math.round(pct)}%`, subHint: `${num} / ${den}` };
    },
    rowMatches: (metric) => metric.source_type === "tickets" && metric.success_count != null,
  },
  {
    key: "carrier_under_15",
    label: "Carrier ≤ 15 min",
    shortLabel: "Carrier",
    group: "tickets",
    sourceType: "tickets",
    goodWhen: "up",
    description: "Percent of tickets with a carrier-ticket open time of 15 minutes or less.",
    formula: "carrierUnder15Count ÷ carrierTotalCount.",
    inclusions: ["Tickets with a parsed time_to_carrier_ticket value"],
    exclusions: ["Blank carrier-ticket values", "Maintenance tickets when excluded"],
    target: { kind: "min", value: 95, label: "≥ 95%" },
    compute: (summaries) => {
      let num = 0;
      let den = 0;
      for (const summary of summaries) {
        const bucket = ticketBucket(summary);
        if (!bucket) continue;
        num += bucket.carrierUnder15Count;
        den += bucket.carrierTotalCount;
      }
      if (!den) return { numeric: null, value: "—" };
      const pct = (num / den) * 100;
      return { numeric: pct, value: `${Math.round(pct)}%`, subHint: `${num} / ${den}` };
    },
    rowMatches: (metric) => metric.source_type === "tickets" && metric.carrier_ticket_minutes != null,
  },
  {
    key: "avg_mttr",
    label: "Avg MTTR",
    shortLabel: "MTTR",
    group: "tickets",
    sourceType: "tickets",
    goodWhen: "down",
    description: "Average mean time to resolve across ticket rows with MTTR values.",
    formula: "Sum(MTTR minutes) ÷ number of ticket rows with MTTR.",
    inclusions: ["Tickets with parsed MTTR / duration values"],
    exclusions: ["Blank duration values", "Maintenance tickets when excluded"],
    compute: (summaries) => {
      let sum = 0;
      let samples = 0;
      for (const summary of summaries) {
        const bucket = ticketBucket(summary);
        if (!bucket) continue;
        sum += bucket.mttrMinutesSum;
        samples += bucket.mttrMinutesSamples;
      }
      if (!samples) return { numeric: null, value: "—" };
      const avg = sum / samples;
      return { numeric: avg, value: formatMinutes(avg), subHint: `${samples} sample${samples === 1 ? "" : "s"}` };
    },
    rowMatches: (metric) => metric.source_type === "tickets" && metric.duration_minutes != null,
  },
  {
    key: "inbound_calls",
    label: "Inbound Calls (Answered)",
    shortLabel: "Answered",
    group: "calls",
    sourceType: "calls",
    goodWhen: "up",
    description: "Count of inbound call rows marked as answered/connected.",
    formula: "Count of call rows where success_count = 1.",
    inclusions: ["Calls marked answered or connected"],
    exclusions: ["Refused, missed, voicemail, or blank outcomes"],
    compute: (summaries) => {
      const total = summaries.reduce((sum, summary) => sum + (callBucket(summary)?.answeredCount ?? 0), 0);
      return { numeric: total, value: total.toLocaleString() };
    },
    rowMatches: (metric) => metric.source_type === "calls" && metric.success_count === 1,
  },
  {
    key: "refused_calls",
    label: "Refused Calls",
    shortLabel: "Refused",
    group: "calls",
    sourceType: "calls",
    goodWhen: "down",
    description: 'Calls with outcomes like "No Answer" or "Answered by Other".',
    formula: 'Count of non-answered call rows whose score/result matches "No Answer" or "Answered by Other".',
    inclusions: ["Call rows with refused-style outcomes"],
    exclusions: ["Answered calls", "Other missed outcomes like voicemail or abandoned"],
    target: { kind: "max", value: 1, label: "≤ 1" },
    compute: (summaries) => {
      const total = summaries.reduce((sum, summary) => sum + (callBucket(summary)?.refusedCount ?? 0), 0);
      return { numeric: total, value: total.toLocaleString() };
    },
    rowMatches: isRefusedCall,
  },
  {
    key: "avg_handle_time",
    label: "Avg Handle Time",
    shortLabel: "Handle",
    group: "calls",
    sourceType: "calls",
    goodWhen: "down",
    description: "Average call duration across call rows with a handle-time value.",
    formula: "Sum(Duration seconds) ÷ number of call rows with Duration.",
    inclusions: ["Calls with parsed Duration values"],
    exclusions: ["Calls with blank Duration"],
    compute: (summaries) => {
      let sum = 0;
      let samples = 0;
      for (const summary of summaries) {
        const bucket = callBucket(summary);
        if (!bucket) continue;
        sum += bucket.handleSecondsSum;
        samples += bucket.handleSecondsSamples;
      }
      if (!samples) return { numeric: null, value: "—" };
      const avg = sum / samples;
      return { numeric: avg, value: formatSeconds(avg), subHint: `${samples} sample${samples === 1 ? "" : "s"}` };
    },
    rowMatches: (metric) => metric.source_type === "calls" && metric.handle_seconds != null,
  },
  {
    key: "avg_speed_of_answer",
    label: "Avg Speed of Answer",
    shortLabel: "Speed",
    group: "calls",
    sourceType: "calls",
    goodWhen: "down",
    description: "Average wait time before answer across calls with a wait-time value.",
    formula: "Sum(Wait Time seconds) ÷ number of call rows with Wait Time.",
    inclusions: ["Calls with parsed Wait Time values"],
    exclusions: ["Calls with blank Wait Time"],
    target: { kind: "max", value: 8, label: "≤ 8 sec" },
    compute: (summaries) => {
      let sum = 0;
      let samples = 0;
      for (const summary of summaries) {
        const bucket = callBucket(summary);
        if (!bucket) continue;
        sum += bucket.waitSecondsSum;
        samples += bucket.waitSecondsSamples;
      }
      if (!samples) return { numeric: null, value: "—" };
      const avg = sum / samples;
      return { numeric: avg, value: formatSeconds(avg), subHint: `${samples} sample${samples === 1 ? "" : "s"}` };
    },
    rowMatches: (metric) => metric.source_type === "calls" && metric.wait_seconds != null,
  },
  {
    key: "tasks_worked",
    label: "Total Tasks Worked",
    shortLabel: "Tasks",
    group: "tasks",
    sourceType: "tasks",
    goodWhen: "up",
    description: "Count of task rows matching the active scope and filters.",
    formula: "Count of task rows after all active filters.",
    inclusions: ["All task rows in scope", "Selected month/day/shift filters"],
    exclusions: ["Rows outside the active filters"],
    compute: (summaries) => {
      const total = summaries.reduce((sum, summary) => sum + (taskBucket(summary)?.rowCount ?? 0), 0);
      return { numeric: total, value: total.toLocaleString() };
    },
    rowMatches: (metric) => metric.source_type === "tasks",
  },
  {
    key: "sla_met",
    label: "SLA-Met %",
    shortLabel: "SLA",
    group: "tasks",
    sourceType: "tasks",
    goodWhen: "up",
    description: "Percent of tasks marked SLA-met among rows with a usable Y/N SLA value.",
    formula: "slaMetCount ÷ slaMetTotalCount.",
    inclusions: ["Task rows with Y/N SLA values"],
    exclusions: ["Blank SLA cells"],
    target: { kind: "min", value: 90, label: "≥ 90%" },
    compute: (summaries) => {
      let num = 0;
      let den = 0;
      for (const summary of summaries) {
        const bucket = taskBucket(summary);
        if (!bucket) continue;
        num += bucket.slaMetCount;
        den += bucket.slaMetTotalCount;
      }
      if (!den) return { numeric: null, value: "—" };
      const pct = (num / den) * 100;
      return { numeric: pct, value: `${Math.round(pct)}%`, subHint: `${num} / ${den}` };
    },
    rowMatches: (metric) => metric.source_type === "tasks" && metric.success_count != null,
  },
];

export const KPI_BY_KEY: Record<KpiKey, KpiDefinition> = Object.fromEntries(
  KPI_DEFS.map((def) => [def.key, def]),
) as Record<KpiKey, KpiDefinition>;

export function getKpisByGroup(group: KpiGroup) {
  return KPI_DEFS.filter((def) => def.group === group);
}
