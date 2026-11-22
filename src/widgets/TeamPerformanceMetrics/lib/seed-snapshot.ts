import { ROSTER, TIERS } from "./roster";
import type { KpiKey } from "./kpis";
import type { VolumeKey } from "./volumes";

const STAFF = ROSTER.filter((p) => p.role === "staff");

export type ComparePeriod = "month" | "quarter";
export type PeriodGrain = "month" | "quarter";

type KpiMap = Partial<Record<KpiKey, number>>;
type VolumeMap = Record<VolumeKey, number>;

/** Current snapshot (this month). */
const SNAPSHOT: Record<string, KpiMap> = {
  "Priya Shah": {
    avg_ack_seconds: 95,
    ack_under_5_pct: 94.2,
    carrier_open_sla_pct: 96.1,
    refused_calls: 0,
    asa_seconds: 5.2,
    mobility_sla_pct: 97.4,
    closed_under_24h_pct: 93.6,
    avg_mttr_seconds: 11840,
  },
  "Marcus Chen": {
    avg_ack_seconds: 142,
    ack_under_5_pct: 88.5,
    carrier_open_sla_pct: 91.3,
    refused_calls: 1,
    asa_seconds: 6.8,
    mobility_sla_pct: 92.1,
  },
  "Sam Okonkwo": {
    avg_ack_seconds: 168,
    ack_under_5_pct: 86.0,
    carrier_open_sla_pct: 89.4,
    refused_calls: 2,
    asa_seconds: 7.4,
    mobility_sla_pct: 90.8,
  },
  "Avery Kim": {
    avg_ack_seconds: 118,
    ack_under_5_pct: 91.7,
    carrier_open_sla_pct: 93.8,
    refused_calls: 0,
    asa_seconds: 4.9,
    mobility_sla_pct: 95.2,
    closed_under_24h_pct: 91.8,
    avg_mttr_seconds: 12460,
  },
};

const VOLUMES: Record<string, VolumeMap> = {
  "Priya Shah": { tickets_received: 412, inbound_calls: 286, outbound_calls: 94, mobility_tasks: 61 },
  "Marcus Chen": { tickets_received: 338, inbound_calls: 241, outbound_calls: 118, mobility_tasks: 47 },
  "Sam Okonkwo": { tickets_received: 305, inbound_calls: 198, outbound_calls: 132, mobility_tasks: 39 },
  "Avery Kim": { tickets_received: 274, inbound_calls: 167, outbound_calls: 88, mobility_tasks: 72 },
};

/** Previous calendar month — slightly softer volumes, mixed SLA. */
const SNAPSHOT_MONTH: Record<string, KpiMap> = {
  "Priya Shah": {
    avg_ack_seconds: 108,
    ack_under_5_pct: 92.1,
    carrier_open_sla_pct: 94.8,
    refused_calls: 0,
    asa_seconds: 5.6,
    mobility_sla_pct: 96.0,
  },
  "Marcus Chen": {
    avg_ack_seconds: 151,
    ack_under_5_pct: 86.4,
    carrier_open_sla_pct: 90.1,
    refused_calls: 2,
    asa_seconds: 7.1,
    mobility_sla_pct: 90.4,
  },
  "Sam Okonkwo": {
    avg_ack_seconds: 174,
    ack_under_5_pct: 84.2,
    carrier_open_sla_pct: 88.0,
    refused_calls: 1,
    asa_seconds: 7.8,
    mobility_sla_pct: 89.6,
  },
  "Avery Kim": {
    avg_ack_seconds: 126,
    ack_under_5_pct: 90.3,
    carrier_open_sla_pct: 92.5,
    refused_calls: 1,
    asa_seconds: 5.3,
    mobility_sla_pct: 93.8,
  },
};

const VOLUMES_MONTH: Record<string, VolumeMap> = {
  "Priya Shah": { tickets_received: 388, inbound_calls: 271, outbound_calls: 101, mobility_tasks: 55 },
  "Marcus Chen": { tickets_received: 351, inbound_calls: 229, outbound_calls: 109, mobility_tasks: 51 },
  "Sam Okonkwo": { tickets_received: 292, inbound_calls: 210, outbound_calls: 121, mobility_tasks: 42 },
  "Avery Kim": { tickets_received: 261, inbound_calls: 174, outbound_calls: 79, mobility_tasks: 68 },
};

/** Previous quarter monthly-equivalent averages (so volumes stay comparable to this month). */
const SNAPSHOT_QUARTER: Record<string, KpiMap> = {
  "Priya Shah": {
    avg_ack_seconds: 121,
    ack_under_5_pct: 90.4,
    carrier_open_sla_pct: 93.2,
    refused_calls: 1,
    asa_seconds: 6.1,
    mobility_sla_pct: 94.1,
    closed_under_24h_pct: 90.1,
  },
  "Marcus Chen": {
    avg_ack_seconds: 159,
    ack_under_5_pct: 84.8,
    carrier_open_sla_pct: 88.7,
    refused_calls: 2,
    asa_seconds: 7.5,
    mobility_sla_pct: 88.9,
    closed_under_24h_pct: 85.2,
  },
  "Sam Okonkwo": {
    avg_ack_seconds: 181,
    ack_under_5_pct: 82.6,
    carrier_open_sla_pct: 86.9,
    refused_calls: 3,
    asa_seconds: 8.2,
    mobility_sla_pct: 87.4,
    closed_under_24h_pct: 83.0,
  },
  "Avery Kim": {
    avg_ack_seconds: 134,
    ack_under_5_pct: 88.9,
    carrier_open_sla_pct: 91.0,
    refused_calls: 1,
    asa_seconds: 5.8,
    mobility_sla_pct: 92.0,
    closed_under_24h_pct: 88.7,
    avg_mttr_seconds: 13620,
  },
};

const VOLUMES_QUARTER: Record<string, VolumeMap> = {
  "Priya Shah": { tickets_received: 369, inbound_calls: 258, outbound_calls: 108, mobility_tasks: 52 },
  "Marcus Chen": { tickets_received: 320, inbound_calls: 218, outbound_calls: 97, mobility_tasks: 44 },
  "Sam Okonkwo": { tickets_received: 278, inbound_calls: 189, outbound_calls: 140, mobility_tasks: 36 },
  "Avery Kim": { tickets_received: 249, inbound_calls: 155, outbound_calls: 71, mobility_tasks: 64 },
};

export type LeaderboardRow = {
  agent: string;
  team: string;
  value: number;
};

export type VolumeTotals = Record<VolumeKey, number>;

const EMPTY_VOLUMES: VolumeTotals = {
  tickets_received: 0,
  inbound_calls: 0,
  outbound_calls: 0,
  mobility_tasks: 0,
};

function addVolumes(a: VolumeTotals, b: VolumeTotals): VolumeTotals {
  return {
    tickets_received: a.tickets_received + b.tickets_received,
    inbound_calls: a.inbound_calls + b.inbound_calls,
    outbound_calls: a.outbound_calls + b.outbound_calls,
    mobility_tasks: a.mobility_tasks + b.mobility_tasks,
  };
}

function boardsFrom(source: Record<string, KpiMap>): Record<string, LeaderboardRow[]> {
  const boards: Record<string, LeaderboardRow[]> = {};
  for (const person of STAFF) {
    const base = source[person.name];
    if (!base) continue;
    for (const [key, value] of Object.entries(base)) {
      (boards[key] ??= []).push({
        agent: person.name,
        team: person.tier,
        value: value as number,
      });
    }
  }
  return boards;
}

function overviewFrom(kpiSource: Record<string, KpiMap>, volumeSource: Record<string, VolumeMap>) {
  const boards = boardsFrom(kpiSource);
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const kpis = Object.fromEntries(
    Object.entries(boards).map(([k, rows]) => [k, { value: avg(rows.map((r) => r.value)), n: rows.length }]),
  );
  const byTeam: Record<string, Record<string, number[]>> = {};
  for (const [key, rows] of Object.entries(boards)) {
    for (const r of rows) {
      byTeam[r.team] ??= {};
      (byTeam[r.team][key] ??= []).push(r.value);
    }
  }

  const volumesByTier: Record<string, VolumeTotals> = {};
  let volumes: VolumeTotals = { ...EMPTY_VOLUMES };
  for (const person of STAFF) {
    const v = volumeSource[person.name];
    if (!v) continue;
    volumes = addVolumes(volumes, v);
    volumesByTier[person.tier] = addVolumes(volumesByTier[person.tier] ?? EMPTY_VOLUMES, v);
  }

  const order = TIERS.map((t) => t.slug);
  const teams = Object.entries(byTeam)
    .map(([slug, metrics]) => ({
      slug,
      metrics: Object.fromEntries(Object.entries(metrics).map(([k, vals]) => [k, avg(vals)])),
      n: Object.values(metrics)[0]?.length ?? 0,
      volumes: volumesByTier[slug] ?? { ...EMPTY_VOLUMES },
    }))
    .sort(
      (a, b) =>
        order.indexOf(a.slug as (typeof order)[number]) - order.indexOf(b.slug as (typeof order)[number]),
    );
  const rowCount = Object.values(boards).reduce((n, rows) => n + rows.length, 0);
  return { kpis, teams, rowCount, volumes };
}

export function snapshotLeaderboards(): Record<string, LeaderboardRow[]> {
  return boardsFrom(SNAPSHOT);
}

export function snapshotOverview() {
  return overviewFrom(SNAPSHOT, VOLUMES);
}

export function snapshotCompare(period: ComparePeriod) {
  if (period === "quarter") return overviewFrom(SNAPSHOT_QUARTER, VOLUMES_QUARTER);
  return overviewFrom(SNAPSHOT_MONTH, VOLUMES_MONTH);
}

export type TrendGrain = "month" | "quarter";

export type TrendPoint = {
  label: string;
  volumes: VolumeTotals;
  kpis: Record<string, number>;
};

export const MONTH_LABELS = [
  "Oct 25",
  "Nov 25",
  "Dec 25",
  "Jan 26",
  "Feb 26",
  "Mar 26",
  "Apr 26",
  "May 26",
  "Jun 26",
  "Jul 26",
  "Aug 26",
  "Sep 26",
  "Oct 26",
];

export const QUARTER_LABELS = ["Q4 25", "Q1 26", "Q2 26", "Q3 26", "Q4 26"];

const CURRENT_VOLUMES = overviewFrom(SNAPSHOT, VOLUMES).volumes;
const CURRENT_KPIS = overviewFrom(SNAPSHOT, VOLUMES).kpis;

function scaleVolumes(base: VolumeTotals, factor: number): VolumeTotals {
  return {
    tickets_received: Math.round(base.tickets_received * factor),
    inbound_calls: Math.round(base.inbound_calls * factor),
    outbound_calls: Math.round(base.outbound_calls * factor),
    mobility_tasks: Math.round(base.mobility_tasks * factor),
  };
}

function wobbleKpi(key: string, value: number, i: number, n: number) {
  const t = (i + 1) / n;
  const wave = Math.sin(i * 0.9) * 0.6;
  if (key.includes("pct")) return Number(Math.min(99.5, Math.max(82, value - 2.4 + t * 2.2 + wave)).toFixed(1));
  if (key.includes("seconds") || key === "asa_seconds" || key === "avg_ack_seconds") {
    return Number(Math.max(3, value + 1.8 - t * 1.6 + wave * 0.4).toFixed(1));
  }
  return Number(Math.max(0, value + (i % 3 === 0 ? 1 : 0) - (i % 5 === 0 ? 1 : 0)).toFixed(0));
}

function volFactorsFor(grain: PeriodGrain) {
  return grain === "quarter"
    ? [0.86, 0.93, 0.89, 0.97, 1]
    : [0.78, 0.84, 0.81, 0.9, 0.88, 0.94, 0.91, 0.97, 0.93, 1.02, 0.96, 0.99, 1];
}

function labelsFor(grain: PeriodGrain) {
  return grain === "quarter" ? QUARTER_LABELS : MONTH_LABELS;
}

function scaleKpiMap(source: KpiMap, i: number, n: number): KpiMap {
  const out: KpiMap = {};
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;
    out[key as KpiKey] = wobbleKpi(key, value, i, n);
  }
  return out;
}

function scaleVolumeMap(source: VolumeMap, factor: number): VolumeMap {
  return {
    tickets_received: Math.round(source.tickets_received * factor),
    inbound_calls: Math.round(source.inbound_calls * factor),
    outbound_calls: Math.round(source.outbound_calls * factor),
    mobility_tasks: Math.round(source.mobility_tasks * factor),
  };
}

function mapsAt(grain: PeriodGrain, index: number) {
  const labels = labelsFor(grain);
  const n = labels.length;
  const i = Math.max(0, Math.min(index, n - 1));
  const factor = volFactorsFor(grain)[i] ?? 1;
  const kpis: Record<string, KpiMap> = {};
  const volumes: Record<string, VolumeMap> = {};
  for (const person of STAFF) {
    const k = SNAPSHOT[person.name];
    const v = VOLUMES[person.name];
    if (k) kpis[person.name] = scaleKpiMap(k, i, n);
    if (v) volumes[person.name] = scaleVolumeMap(v, factor);
  }
  return { kpis, volumes, label: labels[i], index: i, n };
}

export function periodLabels(grain: PeriodGrain) {
  return labelsFor(grain);
}

export function snapshotAt(grain: PeriodGrain, index: number) {
  const { kpis, volumes, label, index: i } = mapsAt(grain, index);
  const overview = overviewFrom(kpis, volumes);
  const boards = boardsFrom(kpis);
  let previous: ReturnType<typeof overviewFrom> | null = null;
  let previousLabel: string | null = null;
  if (i > 0) {
    const prior = mapsAt(grain, i - 1);
    previous = overviewFrom(prior.kpis, prior.volumes);
    previousLabel = prior.label;
  }
  return { overview, boards, label, previous, previousLabel };
}

export type CarrierRank = {
  name: string;
  tickets: number;
  share: number;
};

const CARRIER_WEIGHTS = [
  { name: "Verizon", weight: 28 },
  { name: "AT&T", weight: 22 },
  { name: "T-Mobile", weight: 18 },
  { name: "Lumen", weight: 12 },
  { name: "Comcast Business", weight: 9 },
  { name: "Spectrum", weight: 7 },
  { name: "Cogent", weight: 4 },
];

export function topCarriers(grain: TrendGrain, limit = 5): CarrierRank[] {
  const series = snapshotTrends(grain);
  const totalTickets = series.reduce((sum, p) => sum + p.volumes.tickets_received, 0);
  const totalWeight = CARRIER_WEIGHTS.reduce((sum, c) => sum + c.weight, 0);
  return CARRIER_WEIGHTS.map((c) => {
    const tickets = Math.round(totalTickets * (c.weight / totalWeight));
    return { name: c.name, tickets, share: totalTickets ? tickets / totalTickets : 0 };
  })
    .sort((a, b) => b.tickets - a.tickets)
    .slice(0, limit);
}

export function snapshotTrends(grain: TrendGrain): TrendPoint[] {
  const labels = labelsFor(grain);
  const n = labels.length;
  const volFactors = volFactorsFor(grain);

  return labels.map((label, i) => {
    const volumes = scaleVolumes(CURRENT_VOLUMES, volFactors[i] ?? 1);
    const kpis: Record<string, number> = {};
    for (const [key, cell] of Object.entries(CURRENT_KPIS)) {
      kpis[key] = wobbleKpi(key, cell.value, i, n);
    }
    return { label, volumes, kpis };
  });
}
