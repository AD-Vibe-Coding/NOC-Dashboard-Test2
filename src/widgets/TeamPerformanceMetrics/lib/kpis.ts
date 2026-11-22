export type KpiKey =
  | "avg_ack_seconds"
  | "ack_under_5_pct"
  | "carrier_open_sla_pct"
  | "refused_calls"
  | "asa_seconds"
  | "mobility_sla_pct"
  | "closed_under_24h_pct"
  | "avg_mttr_seconds";

export type KpiUnit = "number" | "percent" | "seconds";

export type SlaRule =
  | { kind: "under"; value: number; label: string }
  | { kind: "at_least"; value: number; label: string }
  | { kind: "at_most"; value: number; label: string }
  | { kind: "display"; label: string };

export type KpiDef = {
  key: KpiKey;
  label: string;
  short: string;
  unit: KpiUnit;
  higherIsBetter: boolean;
  description: string;
  formula: string;
  memberSla: SlaRule;
  overallSla: SlaRule | null;
  showOnTeam: boolean;
  /** When set, Overview overall card uses this companion metric instead of averaging this key. */
  overallKey?: KpiKey;
};

export const KPI_DEFS: KpiDef[] = [
  {
    key: "avg_ack_seconds",
    label: "Average acknowledgement time",
    short: "Avg ack",
    unit: "seconds",
    higherIsBetter: false,
    description:
      "Mean of Excel column AN (Average acknowledgement time) for tickets in the selected month.",
    formula: "Average of column AN. Target: under 3 minutes.",
    memberSla: { kind: "under", value: 180, label: "under 3 minutes" },
    overallSla: { kind: "under", value: 180, label: "under 3 minutes" },
    showOnTeam: true,
  },
  {
    key: "carrier_open_sla_pct",
    label: "Time to open ticket with the carrier",
    short: "Carrier open",
    unit: "percent",
    higherIsBetter: true,
    description:
      'Share of tickets with column BJ (time_interval_buc) equal to "Under 15 Minutes". Blank BJ cells and Automation-acked tickets are excluded.',
    formula:
      'Count of "Under 15 Minutes" in BJ ÷ non-blank BJ cells in the month × 100, excluding Automation. Target: more than 90%.',
    memberSla: { kind: "at_least", value: 90, label: "more than 90% opened under 15 minutes" },
    overallSla: { kind: "at_least", value: 90, label: "more than 90% opened under 15 minutes" },
    showOnTeam: true,
  },
  {
    key: "refused_calls",
    label: "Refused calls",
    short: "Refused",
    unit: "number",
    higherIsBetter: false,
    description: "Calls refused by the agent. Tracked per person only — not rolled up as a team KPI.",
    formula: "Count of refused calls in the period. Member SLA: count ≤ 1.",
    memberSla: { kind: "at_most", value: 1, label: "≤ 1" },
    overallSla: null,
    showOnTeam: false,
  },
  {
    key: "asa_seconds",
    label: "Average speed of answer",
    short: "ASA",
    unit: "seconds",
    higherIsBetter: false,
    description: "Mean time for a call to be answered.",
    formula: "Sum of answer seconds ÷ calls answered. Member and team SLA: under 8 seconds.",
    memberSla: { kind: "under", value: 8, label: "under 8 seconds" },
    overallSla: { kind: "under", value: 8, label: "under 8 seconds" },
    showOnTeam: true,
  },
  {
    key: "mobility_sla_pct",
    label: "Mobility tasks SLA",
    short: "Mobility",
    unit: "percent",
    higherIsBetter: true,
    description: "Share of mobility tasks finished inside 60 minutes.",
    formula: "Tasks completed in under 60 minutes ÷ mobility tasks × 100. Member and team SLA: over 90%.",
    memberSla: { kind: "at_least", value: 90, label: "over 90% under 60 minutes" },
    overallSla: { kind: "at_least", value: 90, label: "over 90% under 60 minutes" },
    showOnTeam: true,
  },
  {
    key: "closed_under_24h_pct",
    label: "% of tickets closed under 24 hours",
    short: "Closed <24h",
    unit: "percent",
    higherIsBetter: true,
    description:
      'Share of tickets whose column BD says "Less than 24 hours". Blank BD cells are excluded.',
    formula:
      'Count of "Less than 24 hours" in BD ÷ non-blank BD cells in the month × 100. Example: 4 less + 4 more = 50%. Target: more than 90%.',
    memberSla: { kind: "at_least", value: 90, label: "more than 90%" },
    overallSla: { kind: "at_least", value: 90, label: "more than 90%" },
    showOnTeam: true,
  },
  {
    key: "avg_mttr_seconds",
    label: "Avg MTTR",
    short: "MTTR",
    unit: "seconds",
    higherIsBetter: false,
    description:
      "Mean time to restore or resolve a ticket, from open to close. Automation-acked tickets are excluded.",
    formula:
      "Sum of restore seconds ÷ tickets resolved, excluding Automation. Member and team SLA: under 4 hours.",
    memberSla: { kind: "under", value: 14400, label: "under 4 hours" },
    overallSla: { kind: "under", value: 14400, label: "under 4 hours" },
    showOnTeam: true,
  },
];

/** Import-only companion used for overall Avg Ack. Hidden from member tables as a primary KPI. */
export const ACK_UNDER_5: KpiDef = {
  key: "ack_under_5_pct",
  label: "Acked under 5 minutes",
  short: "Ack <5m",
  unit: "percent",
  higherIsBetter: true,
  description: "Share of tickets acknowledged in under 5 minutes (overall Avg Ack SLA).",
  formula: "Tickets acked in under 5 minutes ÷ tickets × 100.",
  memberSla: { kind: "display", label: "feeds overall Avg Ack" },
  overallSla: { kind: "at_least", value: 95, label: "more than 95% of tickets acked under 5 minutes" },
  showOnTeam: true,
};

export const KPI_BY_KEY = Object.fromEntries([...KPI_DEFS, ACK_UNDER_5].map((k) => [k.key, k])) as Record<
  KpiKey,
  KpiDef
>;

export const TEAM_KPI_DEFS = KPI_DEFS.filter((k) => k.showOnTeam);

export function formatKpi(value: number, unit: KpiUnit) {
  if (!Number.isFinite(value)) return "—";
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "seconds") {
    if (value >= 3600) {
      const h = Math.floor(value / 3600);
      const m = Math.round((value % 3600) / 60);
      return `${h}h ${m}m`;
    }
    if (value < 60) return `${value.toFixed(value % 1 === 0 ? 0 : 1)}s`;
    const m = Math.floor(value / 60);
    const s = Math.round(value % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

export function slaMet(rule: SlaRule | null, value: number): boolean | null {
  if (!rule || !Number.isFinite(value)) return null;
  if (rule.kind === "under") return value < rule.value;
  if (rule.kind === "at_least") return value >= rule.value;
  if (rule.kind === "at_most") return value <= rule.value;
  return null;
}

export function slaLabel(rule: SlaRule | null) {
  return rule?.label ?? "not scored at team level";
}
