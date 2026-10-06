/**
 * Trends Dashboard — month-over-month comparison of all performance KPIs.
 *
 * Layout: rows = KPIs (Tickets Acked, Avg Ack, Within 24h, Carrier ≤15,
 * Inbound Calls, Refused, Avg Handle Time, Avg Speed of Answer, MTTR).
 * Columns = months in chronological order (oldest → newest). Cell shows
 * the value plus the delta vs the previous month with a colored arrow.
 *
 * The Queue segmented control (All / NOC / Mobility) re-aggregates every
 * column with that queue filter, so users can compare team performance
 * by queue across months in a single glance.
 */

import { useMemo, useState } from "react";
import {
  Badge,
  Box,
  Card,
  Group,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconCalendarStats,
  IconChevronDown,
  IconChevronUp,
  IconClipboardList,
  IconCalendar,
  IconClock,
  IconFilter,
  IconMinus,
  IconPhoneCall,
  IconTicket,
  IconTool,
} from "@tabler/icons-react";
import {
  aggregateMetrics,
  isMaintenanceTicket,
  listAvailablePeriods,
  SHIFT_LABELS,
  type DayFilter,
  type PerformanceMetric,
  type Queue,
  type ShiftFilter,
} from "./data";
import { LOCKED_TEAM_NAMES } from "./team";

// =============================================================================
// KPI definitions — each row in the table is one KPI computed across all
// summaries for one month. Returns:
//   - `value`     : the displayed value (formatted string)
//   - `numeric`   : the numeric backing used for delta arithmetic
//   - `hint`      : optional sub-line (e.g. "162 / 168") under the value
//   - `goodWhen`  : "up" if higher numbers are better, "down" if lower
//                   (controls the color of the trend arrow)
//
// Splitting compute + format keeps the delta math clean — we delta the
// raw number, then format the result. Reordering or extending the table
// is just one entry here.
// =============================================================================

type SummaryArray = ReturnType<typeof aggregateMetrics>;

interface KpiDef {
  key: string;
  label: string;
  /** Short tooltip text shown on hover of the row label. */
  hint?: string;
  group: "tickets" | "calls" | "tasks";
  /** Higher is better → green ↑ ; lower is better → green ↓. */
  goodWhen: "up" | "down";
  /** Compute (numeric, formatted value, optional sub-hint) from summaries. */
  compute: (summaries: SummaryArray) => {
    numeric: number | null;
    value: string;
    subHint?: string;
  };
}

const KPIS: KpiDef[] = [
  // ---- Tickets ----
  {
    key: "tickets_acked",
    label: "Tickets Acked",
    hint: "Total ticket rows the team acknowledged this month.",
    group: "tickets",
    goodWhen: "up",
    compute: (sums) => {
      const total = sums.reduce(
        (s, x) => s + (x.byType.tickets?.rowCount ?? 0),
        0,
      );
      return { numeric: total, value: total.toLocaleString() };
    },
  },
  {
    key: "avg_ack_time",
    label: "Avg Ack Time",
    hint: "Mean first_touch minutes across all ack'd tickets.",
    group: "tickets",
    goodWhen: "down",
    compute: (sums) => {
      let sum = 0;
      let n = 0;
      for (const s of sums) {
        const b = s.byType.tickets;
        if (!b) continue;
        sum += b.ackMinutesSum;
        n += b.ackMinutesSamples;
      }
      if (n === 0) return { numeric: null, value: "—" };
      const avg = sum / n;
      return { numeric: avg, value: formatMinutes(avg) };
    },
  },
  {
    key: "within_24h",
    label: "Within 24h",
    hint: "% of tickets where time_taken_to_close_tickets = less than 24 hours.",
    group: "tickets",
    goodWhen: "up",
    compute: (sums) => {
      let num = 0;
      let den = 0;
      for (const s of sums) {
        const b = s.byType.tickets;
        if (!b) continue;
        num += b.within24Count;
        den += b.within24TotalCount;
      }
      if (den === 0) return { numeric: null, value: "—" };
      const pct = (num / den) * 100;
      return {
        numeric: pct,
        value: `${Math.round(pct)}%`,
        subHint: `${num} / ${den}`,
      };
    },
  },
  {
    key: "carrier_under_15",
    label: "Carrier ≤ 15 min",
    hint: "% of tickets with carrier ticket opened within 15 minutes.",
    group: "tickets",
    goodWhen: "up",
    compute: (sums) => {
      let num = 0;
      let den = 0;
      for (const s of sums) {
        const b = s.byType.tickets;
        if (!b) continue;
        num += b.carrierUnder15Count;
        den += b.carrierTotalCount;
      }
      if (den === 0) return { numeric: null, value: "—" };
      const pct = (num / den) * 100;
      return {
        numeric: pct,
        value: `${Math.round(pct)}%`,
        subHint: `${num} / ${den}`,
      };
    },
  },
  {
    key: "avg_mttr",
    label: "Avg MTTR",
    hint: "Mean time to resolve across closed tickets (minutes).",
    group: "tickets",
    goodWhen: "down",
    compute: (sums) => {
      let sum = 0;
      let n = 0;
      for (const s of sums) {
        const b = s.byType.tickets;
        if (!b) continue;
        sum += b.mttrMinutesSum;
        n += b.mttrMinutesSamples;
      }
      if (n === 0) return { numeric: null, value: "—" };
      const avg = sum / n;
      return { numeric: avg, value: formatMinutes(avg) };
    },
  },
  // ---- Calls ----
  {
    key: "inbound_calls",
    label: "Inbound Calls (Answered)",
    hint: "Count of calls with outcome = Answered/Connected.",
    group: "calls",
    goodWhen: "up",
    compute: (sums) => {
      const total = sums.reduce(
        (s, x) => s + (x.byType.calls?.answeredCount ?? 0),
        0,
      );
      return { numeric: total, value: total.toLocaleString() };
    },
  },
  {
    key: "refused_calls",
    label: "Refused Calls",
    hint: "Calls with No Answer (Answered by Other).",
    group: "calls",
    goodWhen: "down",
    compute: (sums) => {
      const total = sums.reduce(
        (s, x) => s + (x.byType.calls?.refusedCount ?? 0),
        0,
      );
      return { numeric: total, value: total.toLocaleString() };
    },
  },
  {
    key: "missed_calls",
    label: "Other Missed",
    hint: "Calls with other unsuccessful outcomes (voicemail, abandoned, etc.).",
    group: "calls",
    goodWhen: "down",
    compute: (sums) => {
      const total = sums.reduce(
        (s, x) => s + (x.byType.calls?.missedCount ?? 0),
        0,
      );
      return { numeric: total, value: total.toLocaleString() };
    },
  },
  {
    key: "avg_handle_time",
    label: "Avg Handle Time",
    hint: "Mean call duration (seconds, from Duration column).",
    group: "calls",
    goodWhen: "down",
    compute: (sums) => {
      let sum = 0;
      let n = 0;
      for (const s of sums) {
        const b = s.byType.calls;
        if (!b) continue;
        sum += b.handleSecondsSum;
        n += b.handleSecondsSamples;
      }
      if (n === 0) return { numeric: null, value: "—" };
      const avg = sum / n;
      return { numeric: avg, value: formatSeconds(avg) };
    },
  },
  {
    key: "avg_speed_of_answer",
    label: "Avg Speed of Answer",
    hint: "Mean wait time before answer (seconds, from Wait Time column).",
    group: "calls",
    goodWhen: "down",
    compute: (sums) => {
      let sum = 0;
      let n = 0;
      for (const s of sums) {
        const b = s.byType.calls;
        if (!b) continue;
        sum += b.waitSecondsSum;
        n += b.waitSecondsSamples;
      }
      if (n === 0) return { numeric: null, value: "—" };
      const avg = sum / n;
      return { numeric: avg, value: formatSeconds(avg) };
    },
  },
  // ---- Tasks ----
  {
    key: "tasks_worked",
    label: "Total Tasks Worked",
    hint: "Count of task rows in this month (one row = one task).",
    group: "tasks",
    goodWhen: "up",
    compute: (sums) => {
      const total = sums.reduce(
        (s, x) => s + (x.byType.tasks?.rowCount ?? 0),
        0,
      );
      return { numeric: total, value: total.toLocaleString() };
    },
  },
  {
    key: "sla_met",
    label: "SLA-Met %",
    hint: "Of tasks with a Y/N value in the SLA column (column W), the % that were marked Y. Blank rows are excluded from both numerator and denominator.",
    group: "tasks",
    goodWhen: "up",
    compute: (sums) => {
      let num = 0;
      let den = 0;
      for (const s of sums) {
        const b = s.byType.tasks;
        if (!b) continue;
        num += b.slaMetCount;
        den += b.slaMetTotalCount;
      }
      if (den === 0) return { numeric: null, value: "—" };
      const pct = (num / den) * 100;
      return {
        numeric: pct,
        value: `${Math.round(pct)}%`,
        subHint: `${num} / ${den}`,
      };
    },
  },
];

// =============================================================================
// Component
// =============================================================================

interface Props {
  metrics: PerformanceMetric[];
  /**
   * When set, the trends table is scoped to ONLY this member's rows
   * (their tickets + their calls trended over months). When null, the
   * table aggregates across the whole locked roster.
   *
   * Driven by the same "View" picker that controls the Overview tab,
   * so picking an individual on Overview also narrows the Trends view —
   * which is exactly the behaviour managers want when drilling in on
   * one person.
   */
  scopedMember: string | null;
}

export function PerformanceTrends({ metrics, scopedMember }: Props) {
  const [queueFilter, setQueueFilter] = useState<Queue | "all">("all");
  // Maintenance-notification toggle — same default as Overview (ON).
  // Tickets-only; call KPIs are never affected by this flag.
  const [excludeMaintenance, setExcludeMaintenance] = useState(true);
  const [dayFilter, setDayFilter] = useState<DayFilter>("all");
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>("all");

  // Pre-filter the metric stream to just the scoped member's rows if
  // one is selected. Doing this BEFORE the per-month aggregation means
  // every downstream calculation (months list, KPI cells) reflects only
  // that person's data — total counts, averages, %, deltas, all of it.
  //
  // Important: we keep the full roster as the names array passed to
  // aggregateMetrics, then filter the metric rows ourselves. This way
  // the aggregator never sees rows for other members and so can't
  // accidentally roll them up.
  const scopedMetrics = useMemo(() => {
    if (!scopedMember) return metrics;
    return metrics.filter((m) => m.member_name === scopedMember);
  }, [metrics, scopedMember]);

  // The list of names passed to aggregateMetrics. When scoped to a
  // single member, only that name is included so the aggregator
  // doesn't allocate empty summaries for everyone else.
  const aggregateNames = useMemo(
    () => (scopedMember ? [scopedMember] : LOCKED_TEAM_NAMES),
    [scopedMember],
  );

  // Months present in the (scoped) data, oldest → newest (left-to-right
  // in the table reads like a timeline). When scoped to one person,
  // only months where they actually have data appear as columns.
  const months = useMemo(() => {
    const periods = listAvailablePeriods(scopedMetrics);
    return [...periods.months].sort(); // ascending: 2026-01, 2026-02, ...
  }, [scopedMetrics]);

  // For each month, run the aggregator with that queue+month filter.
  // Done in a useMemo so we don't re-aggregate on every render.
  const summariesByMonth = useMemo(() => {
    const out: Record<string, SummaryArray> = {};
    for (const month of months) {
      out[month] = aggregateMetrics(scopedMetrics, aggregateNames, {
        queue: queueFilter,
        period: { type: "month", value: month },
        excludeMaintenance,
        dayFilter,
        shiftFilter,
      });
    }
    return out;
  }, [scopedMetrics, aggregateNames, months, queueFilter, excludeMaintenance, dayFilter, shiftFilter]);

  // Pre-compute every KPI for every month so the render loop is just
  // table cells. Keeps the JSX tidy and the math centralised.
  const cells = useMemo(() => {
    const out: Record<string, Record<string, ReturnType<KpiDef["compute"]>>> = {};
    for (const kpi of KPIS) {
      out[kpi.key] = {};
      for (const month of months) {
        out[kpi.key][month] = kpi.compute(summariesByMonth[month]);
      }
    }
    return out;
  }, [months, summariesByMonth]);

  if (metrics.length === 0) {
    return (
      <Card withBorder radius="md" p="xl">
        <Stack align="center" gap="xs">
          <IconCalendarStats size={36} color="var(--mantine-color-dimmed)" />
          <Text size="sm" c="dimmed">
            No data yet — import a workbook on the Import tab to see trends.
          </Text>
        </Stack>
      </Card>
    );
  }

  if (scopedMetrics.length === 0) {
    // The dataset has rows, but none belong to the scoped member.
    return (
      <Card withBorder radius="md" p="xl">
        <Stack align="center" gap="xs">
          <IconCalendarStats size={36} color="var(--mantine-color-dimmed)" />
          <Text size="sm" c="dimmed" ta="center" maw={420}>
            {scopedMember
              ? `No imported rows are attributed to ${scopedMember} yet. Once their tickets or calls are imported, their month-over-month trends will appear here.`
              : "No data yet."}
          </Text>
        </Stack>
      </Card>
    );
  }

  if (months.length === 0) {
    return (
      <Card withBorder radius="md" p="xl">
        <Stack align="center" gap="xs">
          <IconCalendarStats size={36} color="var(--mantine-color-dimmed)" />
          <Text size="sm" c="dimmed" ta="center" maw={420}>
            {scopedMember
              ? `${scopedMember}'s rows have no extractable month yet. Ask a manager to click the cyan calendar icon at the top of the widget to re-derive periods.`
              : "No month data extracted from the imported rows yet. Click the cyan calendar icon at the top of the widget to re-derive periods, or check the source columns via the inspect button on the Overview tab."}
          </Text>
        </Stack>
      </Card>
    );
  }

  const ticketKpis = KPIS.filter((k) => k.group === "tickets");
  const callKpis = KPIS.filter((k) => k.group === "calls");
  const taskKpis = KPIS.filter((k) => k.group === "tasks");

  // Only render a section if any of its KPIs have at least one
  // non-null numeric value across the months. Avoids showing an
  // empty Tasks section when the user has only imported tickets+calls.
  const hasAnyValue = (kpis: KpiDef[]) =>
    kpis.some((kpi) =>
      months.some((m) => cells[kpi.key]?.[m]?.numeric != null),
    );
  const showTickets = hasAnyValue(ticketKpis);
  const showCalls = hasAnyValue(callKpis);
  const showTasks = hasAnyValue(taskKpis);

  return (
    <Stack gap="md">
      {/* Header + queue filter */}
      <Card withBorder radius="md" p="sm">
        <Group justify="space-between" wrap="wrap">
          <Group gap="xs">
            <ThemeIcon variant="light" color="violet" radius="md" size="md">
              <IconCalendarStats size={16} />
            </ThemeIcon>
            <Box>
              <Title order={5} style={{ lineHeight: 1.2 }}>
                Month-over-Month Trends
                {scopedMember && (
                  <Text
                    component="span"
                    size="sm"
                    c="blue.4"
                    fw={500}
                    ml={6}
                  >
                    · {scopedMember}
                  </Text>
                )}
              </Title>
              <Text size="xs" c="dimmed">
                {months.length} month{months.length === 1 ? "" : "s"} of data ·{" "}
                {scopedMember
                  ? "individual metrics"
                  : "team-wide aggregates"}{" "}
                · deltas vs. previous month
              </Text>
            </Box>
          </Group>
          <Group gap="md" wrap="wrap">
          <Group gap={6} wrap="nowrap">
            <ThemeIcon variant="light" color="gray" radius="md" size="sm">
              <IconFilter size={12} />
            </ThemeIcon>
            <Text size="xs" c="dimmed" fw={600}>
              Queue
            </Text>
            <SegmentedControl
              size="xs"
              value={queueFilter}
              onChange={(v) => setQueueFilter(v as Queue | "all")}
              data={[
                { value: "all", label: "All" },
                { value: "noc", label: "NOC" },
                { value: "mobility", label: "Mobility" },
              ]}
            />
          </Group>
          <Group gap={6} wrap="nowrap">
            <ThemeIcon variant="light" color="gray" radius="md" size="sm">
              <IconTool size={12} />
            </ThemeIcon>
            <Tooltip
              label="When ON, ticket rows whose Issue Type is 'Maintenance Notification' are excluded from the ticket trend rows. Call rows are not affected."
              withinPortal
              multiline
              w={280}
            >
              <Switch
                size="xs"
                checked={excludeMaintenance}
                onChange={(e) =>
                  setExcludeMaintenance(e.currentTarget.checked)
                }
                label={`Exclude maintenance${(() => {
                  const n = scopedMetrics.filter(isMaintenanceTicket).length;
                  return n > 0 ? ` (${n})` : "";
                })()}`}
                styles={{ label: { fontSize: 11, fontWeight: 600 } }}
              />
            </Tooltip>
          </Group>

          {/* Weekday / Weekend toggle */}
          <Group gap={6} wrap="nowrap">
            <ThemeIcon variant="light" color="gray" radius="md" size="sm">
              <IconCalendar size={12} />
            </ThemeIcon>
            <Tooltip
              label="Filter all trend KPIs (tickets, calls, tasks) to show only weekday or weekend data."
              withinPortal
              multiline
              w={260}
            >
              <SegmentedControl
                size="xs"
                value={dayFilter}
                onChange={(v) => setDayFilter(v as DayFilter)}
                data={[
                  { label: "All days", value: "all" },
                  { label: "Weekday", value: "weekday" },
                  { label: "Weekend", value: "weekend" },
                ]}
                styles={{
                  label: { fontSize: 11, fontWeight: 600, padding: "2px 8px" },
                }}
              />
            </Tooltip>
          </Group>

          {/* Shift filter — Early / Mid / Late */}
          <Group gap={6} wrap="nowrap">
            <ThemeIcon variant="light" color="gray" radius="md" size="sm">
              <IconClock size={12} />
            </ThemeIcon>
            <Tooltip
              label="Filter all trend KPIs by shift. Overlap hours (11 AM, 7 PM, 3 AM) are included in both adjacent shifts."
              withinPortal
              multiline
              w={260}
            >
              <Select
                size="xs"
                w={190}
                value={shiftFilter}
                onChange={(v) => setShiftFilter((v ?? "all") as ShiftFilter)}
                data={[
                  { value: "all", label: SHIFT_LABELS.all },
                  { value: "early", label: SHIFT_LABELS.early },
                  { value: "mid", label: SHIFT_LABELS.mid },
                  { value: "late", label: SHIFT_LABELS.late },
                ]}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
                styles={{
                  input: { fontSize: 11, fontWeight: 600 },
                }}
              />
            </Tooltip>
          </Group>
          </Group>
        </Group>
      </Card>

      {/* Tickets section */}
      {showTickets && (
        <KpiSection
          title="Tickets"
          icon={<IconTicket size={16} />}
          color="blue"
          kpis={ticketKpis}
          months={months}
          cells={cells}
        />
      )}

      {/* Calls section */}
      {showCalls && (
        <KpiSection
          title="Inbound Calls"
          icon={<IconPhoneCall size={16} />}
          color="green"
          kpis={callKpis}
          months={months}
          cells={cells}
        />
      )}

      {/* Tasks section */}
      {showTasks && (
        <KpiSection
          title="Tasks"
          icon={<IconClipboardList size={16} />}
          color="orange"
          kpis={taskKpis}
          months={months}
          cells={cells}
        />
      )}
    </Stack>
  );
}

// =============================================================================
// One section per group (Tickets / Calls)
// =============================================================================

function KpiSection({
  title,
  icon,
  color,
  kpis,
  months,
  cells,
}: {
  title: string;
  icon: React.ReactNode;
  color: string;
  kpis: KpiDef[];
  months: string[];
  cells: Record<string, Record<string, ReturnType<KpiDef["compute"]>>>;
}) {
  // Hide whole section if every cell across every month is null — keeps
  // the trends view clean when the user only imported one source type.
  const hasAnyData = kpis.some((k) =>
    months.some((m) => cells[k.key][m].numeric != null),
  );
  if (!hasAnyData) return null;

  return (
    <Card
      withBorder
      radius="md"
      p="md"
      style={{ borderTop: `2px solid var(--mantine-color-${color}-6)` }}
    >
      <Group gap="xs" mb="md">
        <ThemeIcon variant="light" color={color} radius="md" size="md">
          {icon}
        </ThemeIcon>
        <Title order={6}>{title}</Title>
        <Badge variant="default" size="xs">
          {kpis.length} metric{kpis.length === 1 ? "" : "s"}
        </Badge>
      </Group>
      <ScrollArea
        // Allow horizontal scroll when many months are present; sticky
        // first column means the KPI label is always visible.
        type="auto"
        offsetScrollbars
      >
        <Table
          striped
          highlightOnHover
          withColumnBorders
          stickyHeader
          fz="xs"
          style={{ minWidth: Math.max(640, 220 + months.length * 130) }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th
                style={{
                  position: "sticky",
                  left: 0,
                  zIndex: 2,
                  background: "var(--mantine-color-body)",
                  minWidth: 200,
                }}
              >
                Metric
              </Table.Th>
              {months.map((m) => (
                <Table.Th key={m} style={{ textAlign: "right", minWidth: 120 }}>
                  {formatMonthLabel(m)}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {kpis.map((kpi) => {
              const row = cells[kpi.key];
              return (
                <Table.Tr key={kpi.key}>
                  <Table.Td
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 1,
                      background: "var(--mantine-color-body)",
                      fontWeight: 500,
                    }}
                  >
                    {kpi.hint ? (
                      <Tooltip
                        label={kpi.hint}
                        withinPortal
                        multiline
                        w={280}
                      >
                        <Text size="xs" style={{ cursor: "help" }}>
                          {kpi.label}
                        </Text>
                      </Tooltip>
                    ) : (
                      <Text size="xs">{kpi.label}</Text>
                    )}
                  </Table.Td>
                  {months.map((m, idx) => {
                    const cur = row[m];
                    const prev = idx > 0 ? row[months[idx - 1]] : null;
                    return (
                      <Table.Td
                        key={m}
                        style={{ textAlign: "right", verticalAlign: "top" }}
                      >
                        <Stack gap={0} align="flex-end">
                          <Text
                            size="sm"
                            fw={600}
                            ff="monospace"
                            c={cur.numeric == null ? "dimmed" : undefined}
                          >
                            {cur.value}
                          </Text>
                          {cur.subHint && (
                            <Text size="10px" c="dimmed" ff="monospace">
                              {cur.subHint}
                            </Text>
                          )}
                          {prev && (
                            <DeltaPill
                              current={cur.numeric}
                              previous={prev.numeric}
                              goodWhen={kpi.goodWhen}
                            />
                          )}
                        </Stack>
                      </Table.Td>
                    );
                  })}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Card>
  );
}

// =============================================================================
// Delta pill — small colored arrow + percentage change vs previous month
// =============================================================================

function DeltaPill({
  current,
  previous,
  goodWhen,
}: {
  current: number | null;
  previous: number | null;
  goodWhen: "up" | "down";
}) {
  // Can't compute a delta when either side is missing or previous is 0
  // (would be infinite). Show a neutral "—" instead.
  if (current == null || previous == null) {
    return (
      <Group gap={2} wrap="nowrap">
        <IconMinus size={10} color="var(--mantine-color-dimmed)" />
        <Text size="10px" c="dimmed">
          —
        </Text>
      </Group>
    );
  }
  const diff = current - previous;
  // Round to one decimal of percentage. When previous is 0 we show the
  // absolute number rather than a misleading ∞%.
  if (previous === 0) {
    if (diff === 0) {
      return (
        <Group gap={2} wrap="nowrap">
          <IconMinus size={10} color="var(--mantine-color-dimmed)" />
          <Text size="10px" c="dimmed">
            no change
          </Text>
        </Group>
      );
    }
    const goingUp = diff > 0;
    const good =
      (goingUp && goodWhen === "up") || (!goingUp && goodWhen === "down");
    const color = good ? "teal" : "red";
    return (
      <Group gap={2} wrap="nowrap">
        {goingUp ? (
          <IconChevronUp
            size={10}
            color={`var(--mantine-color-${color}-5)`}
          />
        ) : (
          <IconChevronDown
            size={10}
            color={`var(--mantine-color-${color}-5)`}
          />
        )}
        <Text size="10px" c={color} fw={500}>
          {diff > 0 ? "+" : ""}
          {Math.round(diff).toLocaleString()}
        </Text>
      </Group>
    );
  }
  const pctChange = (diff / Math.abs(previous)) * 100;
  if (Math.abs(pctChange) < 0.5) {
    return (
      <Group gap={2} wrap="nowrap">
        <IconMinus size={10} color="var(--mantine-color-dimmed)" />
        <Text size="10px" c="dimmed">
          ≈ flat
        </Text>
      </Group>
    );
  }
  const goingUp = diff > 0;
  const good =
    (goingUp && goodWhen === "up") || (!goingUp && goodWhen === "down");
  const color = good ? "teal" : "red";
  return (
    <Group gap={2} wrap="nowrap">
      {goingUp ? (
        <IconChevronUp size={10} color={`var(--mantine-color-${color}-5)`} />
      ) : (
        <IconChevronDown size={10} color={`var(--mantine-color-${color}-5)`} />
      )}
      <Text size="10px" c={color} fw={500}>
        {pctChange > 0 ? "+" : ""}
        {pctChange.toFixed(Math.abs(pctChange) < 10 ? 1 : 0)}%
      </Text>
    </Group>
  );
}

// =============================================================================
// Formatting helpers — duplicated from Dashboard.tsx rather than imported
// to keep this file self-contained (the Dashboard ones aren't exported).
// =============================================================================

function formatMonthLabel(yyyyMm: string): string {
  const m = yyyyMm.match(/^(\d{4})-(\d{2})$/);
  if (!m) return yyyyMm;
  const date = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1);
  return date.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
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
