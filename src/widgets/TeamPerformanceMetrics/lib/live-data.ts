import { MONTH_LABELS, QUARTER_LABELS, type PeriodGrain } from "./seed-snapshot";
import {
  monthKeyFromLabel,
  quarterKeyFromLabel,
  type MonthPatterns,
  type MonthSlice,
  type NameCount,
  type UploadResult,
} from "./parse-excel";
import type { KpiKey } from "./kpis";
import type { VolumeKey } from "./volumes";

export type LiveKpi = { value: number; n: number };
export type LiveMix = {
  maintenance: number;
  outage: number;
  comcast: number;
  comcastMaintenance: number;
  comcastOutage: number;
};
export type LiveAutomation = {
  tickets: number;
  sharePct: number | null;
  avgAckSeconds: number | null;
  avgCarrierOpenMinutes: number | null;
  carrierOpenSlaPct: number | null;
  closedUnder24Pct: number | null;
  avgMttrSeconds: number | null;
};

export type LiveOverview = {
  volumes: Record<VolumeKey, number>;
  kpis: Record<string, LiveKpi>;
  mix: LiveMix;
  automation: LiveAutomation;
};

const VOLUME_KEYS: VolumeKey[] = [
  "tickets_received",
  "inbound_calls",
  "outbound_calls",
  "mobility_tasks",
];

export function emptyVolumes(): Record<VolumeKey, number> {
  return {
    tickets_received: 0,
    inbound_calls: 0,
    outbound_calls: 0,
    mobility_tasks: 0,
  };
}

export function periodLabelsLive(grain: PeriodGrain) {
  return grain === "quarter" ? QUARTER_LABELS : MONTH_LABELS;
}

function keysForLabel(grain: PeriodGrain, label: string): string[] {
  return grain === "month"
    ? [monthKeyFromLabel(label)].filter((k): k is string => Boolean(k))
    : quarterKeyFromLabel(label);
}

function slicesFor(uploads: UploadResult[], keys: string[]): MonthSlice[] {
  const set = new Set(keys);
  return uploads.flatMap((u) => u.months.filter((m) => set.has(m.monthKey)));
}

function emptyMix(): LiveMix {
  return { maintenance: 0, outage: 0, comcast: 0, comcastMaintenance: 0, comcastOutage: 0 };
}

function mergeSlices(slices: MonthSlice[]): LiveOverview {
  const volumes = emptyVolumes();
  const mix = emptyMix();
  const kpiSum: Record<string, number> = {};
  const kpiN: Record<string, number> = {};
  let autoTickets = 0;
  let autoAckSum = 0;
  let autoAckN = 0;
  let autoCarrierSum = 0;
  let autoCarrierN = 0;
  let autoCarrierOk = 0;
  let autoCarrierIntervalN = 0;
  let autoClosed24 = 0;
  let autoClosedN = 0;
  let autoMttrSum = 0;
  let autoMttrN = 0;
  for (const s of slices) {
    for (const k of VOLUME_KEYS) {
      volumes[k] += s.volumes[k] ?? 0;
    }
    if (s.mix) {
      mix.maintenance += s.mix.maintenance;
      mix.outage += s.mix.outage;
      mix.comcast += s.mix.comcast;
      mix.comcastMaintenance += s.mix.comcastMaintenance;
      mix.comcastOutage += s.mix.comcastOutage;
    }
    for (const [k, v] of Object.entries(s.kpis)) {
      const w = k === "avg_ack_seconds" ? Math.max(1, s.used) : s.used || 1;
      kpiSum[k] = (kpiSum[k] ?? 0) + (v as number) * w;
      kpiN[k] = (kpiN[k] ?? 0) + w;
    }
    const a = s.automation;
    if (a) {
      autoTickets += a.tickets;
      autoAckSum += a.ackSum;
      autoAckN += a.ackN;
      autoCarrierSum += a.carrierSum;
      autoCarrierN += a.carrierN;
      autoCarrierOk += a.carrierOk ?? 0;
      autoCarrierIntervalN += a.carrierIntervalN ?? 0;
      autoClosed24 += a.closed24;
      autoClosedN += a.closedN;
      autoMttrSum += a.mttrSum;
      autoMttrN += a.mttrN;
    }
  }
  const kpis: Record<string, LiveKpi> = {};
  for (const [k, v] of Object.entries(kpiSum)) {
    kpis[k] = { value: v / (kpiN[k] || 1), n: kpiN[k] || 1 };
  }
  const ticketTotal = volumes.tickets_received;
  const automation: LiveAutomation = {
    tickets: autoTickets,
    sharePct: ticketTotal ? (autoTickets / ticketTotal) * 100 : null,
    avgAckSeconds: autoAckN ? autoAckSum / autoAckN : null,
    avgCarrierOpenMinutes: autoCarrierN ? autoCarrierSum / autoCarrierN / 60 : null,
    carrierOpenSlaPct: autoCarrierIntervalN
      ? (autoCarrierOk / autoCarrierIntervalN) * 100
      : null,
    closedUnder24Pct: autoClosedN ? (autoClosed24 / autoClosedN) * 100 : null,
    avgMttrSeconds: autoMttrN ? autoMttrSum / autoMttrN : null,
  };
  return { volumes, kpis, mix, automation };
}

export function liveAt(uploads: UploadResult[], grain: PeriodGrain, index: number) {
  const labels = periodLabelsLive(grain);
  const i = Math.max(0, Math.min(index, labels.length - 1));
  const label = labels[i];
  const overview = mergeSlices(slicesFor(uploads, keysForLabel(grain, label)));
  let previous: LiveOverview | null = null;
  let previousLabel: string | null = null;
  if (i > 0) {
    previousLabel = labels[i - 1];
    previous = mergeSlices(slicesFor(uploads, keysForLabel(grain, previousLabel)));
  }
  return { overview, label, previous, previousLabel, labels };
}

export function liveTrends(uploads: UploadResult[], grain: PeriodGrain) {
  const labels = periodLabelsLive(grain);
  return labels.map((label) => {
    const { volumes, kpis } = mergeSlices(slicesFor(uploads, keysForLabel(grain, label)));
    const flat: Record<string, number> = {};
    for (const [k, cell] of Object.entries(kpis)) flat[k] = cell.value;
    return { label, volumes, kpis: flat };
  });
}

export function liveCarriers(uploads: UploadResult[], grain: PeriodGrain, limit = 5) {
  const labels = periodLabelsLive(grain);
  const keys = labels.flatMap((l) => keysForLabel(grain, l));
  const map = new Map<string, number>();
  for (const s of slicesFor(uploads, keys)) {
    for (const c of s.carriers) map.set(c.name, (map.get(c.name) ?? 0) + c.tickets);
  }
  const total = [...map.values()].reduce((a, b) => a + b, 0) || 1;
  return [...map.entries()]
    .map(([name, tickets]) => ({ name, tickets, share: tickets / total }))
    .sort((a, b) => b.tickets - a.tickets)
    .slice(0, limit);
}

export function hasLiveData(uploads: UploadResult[]) {
  return uploads.some((u) => u.used > 0);
}

function memberSlicesFor(uploads: UploadResult[], member: string, keys: string[]): MonthSlice[] {
  const set = new Set(keys);
  return uploads.flatMap((u) => (u.members?.[member] ?? []).filter((m) => set.has(m.monthKey)));
}

/** Same series as liveTrends, but only tickets attributed to `member`. */
export function liveMemberTrends(uploads: UploadResult[], grain: PeriodGrain, member: string) {
  const labels = periodLabelsLive(grain);
  return labels.map((label) => {
    const { volumes, kpis } = mergeSlices(memberSlicesFor(uploads, member, keysForLabel(grain, label)));
    const flat: Record<string, number> = {};
    for (const [k, cell] of Object.entries(kpis)) flat[k] = cell.value;
    return { label, volumes, kpis: flat };
  });
}

export type LeaderboardRow = {
  name: string;
  tickets: number;
  overview: LiveOverview;
};

/** Rank members by tickets in the selected period (Acked By). */
export function liveLeaderboard(
  uploads: UploadResult[],
  grain: PeriodGrain,
  index: number,
  names: readonly string[],
): LeaderboardRow[] {
  const labels = periodLabelsLive(grain);
  const i = Math.max(0, Math.min(index, labels.length - 1));
  const keys = keysForLabel(grain, labels[i]);
  return names
    .map((name) => {
      const overview = mergeSlices(memberSlicesFor(uploads, name, keys));
      return { name, tickets: overview.volumes.tickets_received, overview };
    })
    .filter((r) => r.tickets > 0)
    .sort((a, b) => b.tickets - a.tickets);
}

export type KpiLeaderRow = {
  name: string;
  value: number;
  tickets: number;
};

/** Rank members by one KPI for the selected period. Missing values are omitted. */
export function liveKpiLeaderboard(
  uploads: UploadResult[],
  grain: PeriodGrain,
  index: number,
  names: readonly string[],
  kpiKey: string,
  higherIsBetter: boolean,
): KpiLeaderRow[] {
  const labels = periodLabelsLive(grain);
  const i = Math.max(0, Math.min(index, labels.length - 1));
  const keys = keysForLabel(grain, labels[i]);
  const rows: KpiLeaderRow[] = [];
  for (const name of names) {
    const overview = mergeSlices(memberSlicesFor(uploads, name, keys));
    const cell = overview.kpis[kpiKey];
    if (!cell || !Number.isFinite(cell.value)) continue;
    rows.push({ name, value: cell.value, tickets: overview.volumes.tickets_received });
  }
  rows.sort((a, b) => (higherIsBetter ? b.value - a.value : a.value - b.value));
  return rows;
}

export type InsightPeriod = {
  label: string;
  tickets: number;
  mix: LiveMix;
  topCarriers: { name: string; tickets: number }[];
  patterns?: MonthPatterns;
};

export type PatternMonth = {
  label: string;
  tickets: number;
  mix: LiveMix;
  issueTypes: NameCount[];
  resolutions: NameCount[];
  techSupport: number;
  manual: number;
  avgCarrierOpenMinutes: number | null;
  carrierOpenByCarrier: { name: string; avgMinutes: number; n: number }[];
  days: NameCount[];
  hours: NameCount[];
};

export type InsightsPayload = {
  window: string;
  current: InsightPeriod;
  previous: InsightPeriod | null;
  months: PatternMonth[];
  deltas: {
    tickets: number;
    maintenance: number;
    outage: number;
    comcast: number;
    comcastMaintenance: number;
    comcastOutage: number;
  };
};

function carriersFor(uploads: UploadResult[], keys: string[], limit = 8) {
  const map = new Map<string, number>();
  for (const s of slicesFor(uploads, keys)) {
    for (const c of s.carriers) map.set(c.name, (map.get(c.name) ?? 0) + c.tickets);
  }
  return [...map.entries()]
    .map(([name, tickets]) => ({ name, tickets }))
    .sort((a, b) => b.tickets - a.tickets)
    .slice(0, limit);
}

function mergeNameCounts(list: NameCount[][]): NameCount[] {
  const map = new Map<string, number>();
  for (const arr of list) {
    for (const c of arr) map.set(c.name, (map.get(c.name) ?? 0) + c.tickets);
  }
  return [...map.entries()]
    .map(([name, tickets]) => ({ name, tickets }))
    .sort((a, b) => b.tickets - a.tickets)
    .slice(0, 12);
}

function mergePatterns(slices: MonthSlice[]): MonthPatterns {
  const issueTypes = mergeNameCounts(slices.map((s) => s.patterns?.issueTypes ?? []));
  const resolutions = mergeNameCounts(slices.map((s) => s.patterns?.resolutions ?? []));
  const days = mergeNameCounts(slices.map((s) => s.patterns?.days ?? []));
  const hours = mergeNameCounts(slices.map((s) => s.patterns?.hours ?? []));
  let techSupport = 0;
  let manual = 0;
  let openSum = 0;
  let openN = 0;
  const byCarrier = new Map<string, { sum: number; n: number }>();
  for (const s of slices) {
    const p = s.patterns;
    if (!p) continue;
    techSupport += p.source.techSupport;
    manual += p.source.manual;
    if (p.avgCarrierOpenMinutes != null && s.used) {
      openSum += p.avgCarrierOpenMinutes * s.used;
      openN += s.used;
    }
    for (const c of p.carrierOpenByCarrier) {
      const slot = byCarrier.get(c.name) ?? { sum: 0, n: 0 };
      slot.sum += c.avgMinutes * c.n;
      slot.n += c.n;
      byCarrier.set(c.name, slot);
    }
  }
  return {
    issueTypes,
    resolutions,
    source: { techSupport, manual },
    avgCarrierOpenMinutes: openN ? openSum / openN : null,
    carrierOpenByCarrier: [...byCarrier.entries()]
      .map(([name, v]) => ({ name, avgMinutes: v.sum / v.n, n: v.n }))
      .sort((a, b) => b.avgMinutes - a.avgMinutes)
      .slice(0, 10),
    days,
    hours,
  };
}

function patternMonthFrom(uploads: UploadResult[], grain: PeriodGrain, label: string): PatternMonth {
  const keys = keysForLabel(grain, label);
  const slices = slicesFor(uploads, keys);
  const merged = mergeSlices(slices);
  const patterns = mergePatterns(slices);
  return {
    label,
    tickets: merged.volumes.tickets_received,
    mix: merged.mix,
    issueTypes: patterns.issueTypes,
    resolutions: patterns.resolutions,
    techSupport: patterns.source.techSupport,
    manual: patterns.source.manual,
    avgCarrierOpenMinutes: patterns.avgCarrierOpenMinutes,
    carrierOpenByCarrier: patterns.carrierOpenByCarrier,
    days: patterns.days,
    hours: patterns.hours,
  };
}

export function liveInsights(uploads: UploadResult[], grain: PeriodGrain, index: number): InsightsPayload {
  const labels = periodLabelsLive(grain);
  const i = Math.max(0, Math.min(index, labels.length - 1));
  const start = Math.max(0, i - 12);
  const windowLabels = labels.slice(start, i + 1);
  const months = windowLabels.map((label) => patternMonthFrom(uploads, grain, label));
  const curKeys = keysForLabel(grain, labels[i]);
  const cur = mergeSlices(slicesFor(uploads, curKeys));
  const current: InsightPeriod = {
    label: labels[i],
    tickets: cur.volumes.tickets_received,
    mix: cur.mix,
    topCarriers: carriersFor(uploads, curKeys),
    patterns: mergePatterns(slicesFor(uploads, curKeys)),
  };
  let previous: InsightPeriod | null = null;
  if (i > 0) {
    const prevKeys = keysForLabel(grain, labels[i - 1]);
    const prev = mergeSlices(slicesFor(uploads, prevKeys));
    previous = {
      label: labels[i - 1],
      tickets: prev.volumes.tickets_received,
      mix: prev.mix,
      topCarriers: carriersFor(uploads, prevKeys),
      patterns: mergePatterns(slicesFor(uploads, prevKeys)),
    };
  }
  const p = previous?.mix;
  return {
    window: `${windowLabels[0] ?? current.label} through ${current.label} (${months.length} months)`,
    current,
    previous,
    months,
    deltas: {
      tickets: current.tickets - (previous?.tickets ?? 0),
      maintenance: current.mix.maintenance - (p?.maintenance ?? 0),
      outage: current.mix.outage - (p?.outage ?? 0),
      comcast: current.mix.comcast - (p?.comcast ?? 0),
      comcastMaintenance: current.mix.comcastMaintenance - (p?.comcastMaintenance ?? 0),
      comcastOutage: current.mix.comcastOutage - (p?.comcastOutage ?? 0),
    },
  };
}

export type { KpiKey };
