import { useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Group,
  Popover,
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
  IconAlertTriangle,
  IconCalendar,
  IconCalendarStats,
  IconClock,
  IconFilter,
  IconMinus,
  IconPhoneCall,
  IconTargetArrow,
  IconTicket,
  IconTool,
  IconClipboardList,
} from "@tabler/icons-react";
import {
  aggregateMetrics,
  buildWorkloadContext,
  isMaintenanceTicket,
  listAvailablePeriods,
  type AggregateOptions,
  type DayFilter,
  type PerformanceMetric,
  type Queue,
  type ShiftFilter,
  SHIFT_LABELS,
} from "./data";
import { KPI_BY_KEY, KPI_DEFS, getKpiAnomaly, getKpiRanking, meetsTarget, type KpiDefinition, type KpiGroup, type KpiKey } from "./kpiConfig";
import { LOCKED_TEAM_NAMES, NON_PERSON_NAMES } from "./team";
import { ActiveFilterChips } from "./FilterChips";
import { RawDataModal } from "./RawDataModal";

type SummaryArray = ReturnType<typeof aggregateMetrics>;

interface Props {
  metrics: PerformanceMetric[];
  scopedMember: string | null;
  isManager?: boolean;
}

const PERFORMANCE_MEMBER_NAMES = LOCKED_TEAM_NAMES.filter((name) => !NON_PERSON_NAMES.has(name));

function MemberSelectionControl({
  selectedMembers,
  onChange,
}: {
  selectedMembers: string[];
  onChange: (members: string[]) => void;
}) {
  const allSelected = selectedMembers.length === PERFORMANCE_MEMBER_NAMES.length;
  const buttonLabel = allSelected
    ? `Whole team · ${PERFORMANCE_MEMBER_NAMES.length}`
    : `${selectedMembers.length} of ${PERFORMANCE_MEMBER_NAMES.length} members`;

  return (
    <Popover position="bottom-end" shadow="md" width={290} withinPortal>
      <Popover.Target>
        <Button size="xs" variant="light" leftSection={<IconFilter size={13} />}>
          {buttonLabel}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Text size="sm" fw={600}>Included members</Text>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => onChange([...PERFORMANCE_MEMBER_NAMES])}
            >
              Whole team
            </Button>
          </Group>
          <Text size="xs" c="dimmed">Checked people contribute to each monthly trend.</Text>
          <ScrollArea h={240} type="auto">
            <Stack gap={6} py={4}>
              {PERFORMANCE_MEMBER_NAMES.map((name) => {
                const checked = selectedMembers.includes(name);
                return (
                  <Checkbox
                    key={name}
                    size="xs"
                    label={name}
                    checked={checked}
                    disabled={checked && selectedMembers.length === 1}
                    onChange={(event) => {
                      const next = event.currentTarget.checked
                        ? [...selectedMembers, name]
                        : selectedMembers.filter((member) => member !== name);
                      onChange(next);
                    }}
                  />
                );
              })}
            </Stack>
          </ScrollArea>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

export function PerformanceTrends({ metrics, scopedMember, isManager = false }: Props) {
  const [selectedTrendMembers, setSelectedTrendMembers] = useState<string[]>(PERFORMANCE_MEMBER_NAMES);
  const [queueFilter, setQueueFilter] = useState<Queue | "all">("all");
  const [excludeMaintenance, setExcludeMaintenance] = useState(true);
  const [dayFilter, setDayFilter] = useState<DayFilter>("all");
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>("all");
  const [rawModalOpen, setRawModalOpen] = useState(false);
  const [rawMetricKey, setRawMetricKey] = useState<KpiKey | null>(null);
  const [rawMonth, setRawMonth] = useState<string | null>(null);

  const isWholeTeamSelection = !scopedMember && selectedTrendMembers.length === PERFORMANCE_MEMBER_NAMES.length;
  const trendMemberNames = useMemo(() => {
    if (scopedMember) return [scopedMember];
    // Preserve existing team totals (including group/automation records) when
    // every person is selected; subsets intentionally contain people only.
    return isWholeTeamSelection ? LOCKED_TEAM_NAMES : selectedTrendMembers;
  }, [scopedMember, isWholeTeamSelection, selectedTrendMembers]);

  const scopedMetrics = useMemo(
    () => metrics.filter((metric) => trendMemberNames.includes(metric.member_name)),
    [metrics, trendMemberNames],
  );

  const aggregateNames = trendMemberNames;
  const scopeLabel = scopedMember
    ?? (isWholeTeamSelection ? "Whole team" : `${selectedTrendMembers.length} selected members`);
  const memberSelection = isManager && !scopedMember ? (
    <MemberSelectionControl selectedMembers={selectedTrendMembers} onChange={setSelectedTrendMembers} />
  ) : null;

  const months = useMemo(() => {
    const periods = listAvailablePeriods(scopedMetrics);
    return [...periods.months].sort();
  }, [scopedMetrics]);

  const baseOptions: AggregateOptions = useMemo(
    () => ({
      queue: queueFilter,
      period: { type: "all" },
      excludeMaintenance,
      dayFilter,
      shiftFilter,
    }),
    [queueFilter, excludeMaintenance, dayFilter, shiftFilter],
  );

  const summariesByMonth = useMemo(() => {
    const out: Record<string, SummaryArray> = {};
    for (const month of months) {
      out[month] = aggregateMetrics(scopedMetrics, aggregateNames, {
        ...baseOptions,
        period: { type: "month", value: month },
      });
    }
    return out;
  }, [scopedMetrics, aggregateNames, months, baseOptions]);

  const cells = useMemo(() => {
    const out: Record<string, Record<string, ReturnType<KpiDefinition["compute"]>>> = {};
    for (const kpi of KPI_DEFS) {
      out[kpi.key] = {};
      for (const month of months) {
        out[kpi.key][month] = kpi.compute(summariesByMonth[month]);
      }
    }
    return out;
  }, [months, summariesByMonth]);

  const workload = useMemo(() => buildWorkloadContext(scopedMetrics), [scopedMetrics]);

  const paritySummary = useMemo(() => {
    if (!isManager || !scopedMember) return null;
    const managerScoped = aggregateMetrics(metrics, [scopedMember], baseOptions)[0] ?? null;
    const simulatedSelf = aggregateMetrics(metrics.filter((m) => m.member_name === scopedMember), [scopedMember], baseOptions)[0] ?? null;
    if (!managerScoped || !simulatedSelf) return null;
    const checks = [
      { key: "tickets_acked" as KpiKey, label: "Tickets Acked" },
      { key: "avg_ack_time" as KpiKey, label: "Avg Ack Time" },
      { key: "carrier_under_15" as KpiKey, label: "Carrier ≤ 15 min" },
      { key: "refused_calls" as KpiKey, label: "Refused Calls" },
      { key: "sla_met" as KpiKey, label: "SLA-Met %" },
    ].map((item) => {
      const def = KPI_BY_KEY[item.key];
      const managerValue = def.compute([managerScoped]).numeric;
      const selfValue = def.compute([simulatedSelf]).numeric;
      const matches = managerValue === selfValue || (managerValue != null && selfValue != null && Math.abs(managerValue - selfValue) < 0.0001);
      return { ...item, managerValue, selfValue, matches };
    });
    return {
      allMatch: checks.every((check) => check.matches),
      checks,
      rowCount: aggregateMetrics(metrics, [scopedMember], baseOptions)[0]?.byType.tickets?.rowCount ?? 0,
    };
  }, [isManager, scopedMember, metrics, baseOptions]);

  if (metrics.length === 0) {
    return (
      <Stack gap="md">
        {memberSelection}
        <EmptyState text="No data yet — import a workbook on the Import tab to see trends." />
      </Stack>
    );
  }
  if (scopedMetrics.length === 0) {
    return (
      <Stack gap="md">
        {memberSelection}
        <EmptyState text={scopedMember ? `No imported rows are attributed to ${scopedMember} yet.` : `No imported rows are attributed to the selected members yet.`} />
      </Stack>
    );
  }
  if (months.length === 0) {
    return (
      <Stack gap="md">
        {memberSelection}
        <EmptyState text={scopedMember ? `${scopedMember}'s rows have no extractable month yet.` : "No month data extracted from the selected members' rows yet."} />
      </Stack>
    );
  }

  const showGroup = (group: KpiGroup) => KPI_DEFS.some((def) => def.group === group && months.some((month) => cells[def.key][month]?.numeric != null));

  return (
    <Stack gap="md">
      <Card withBorder radius="md" p="sm">
        <Stack gap="sm">
          <Group justify="space-between" wrap="wrap" align="flex-start">
            <Group gap="xs" align="flex-start">
              <ThemeIcon variant="light" color="violet" radius="md" size="md">
                <IconCalendarStats size={16} />
              </ThemeIcon>
              <Box>
                <Title order={5} style={{ lineHeight: 1.2 }}>
                  Month-over-Month Trends
                  {(scopedMember || !isWholeTeamSelection) && (
                    <Text component="span" size="sm" c="blue.4" fw={500} ml={6}>
                      · {scopeLabel}
                    </Text>
                  )}
                </Title>
                <Text size="xs" c="dimmed">
                  {months.length} month{months.length === 1 ? "" : "s"} of data · {scopedMember ? "individual metrics" : isWholeTeamSelection ? "team-wide aggregates" : "selected-member aggregate"}
                </Text>
              </Box>
            </Group>
            <Group gap="md" wrap="wrap">
              <Group gap={6} wrap="nowrap">
                <ThemeIcon variant="light" color="gray" radius="md" size="sm"><IconFilter size={12} /></ThemeIcon>
                <Text size="xs" c="dimmed" fw={600}>Queue</Text>
                <SegmentedControl size="xs" value={queueFilter} onChange={(v) => setQueueFilter(v as Queue | "all")} data={[{ value: "all", label: "All" }, { value: "noc", label: "NOC" }, { value: "mobility", label: "Mobility" }]} />
              </Group>
              <Group gap={6} wrap="nowrap">
                <ThemeIcon variant="light" color="gray" radius="md" size="sm"><IconTool size={12} /></ThemeIcon>
                <Tooltip label="When ON, maintenance notification tickets are excluded from ticket KPIs." withinPortal multiline w={280}>
                  <Switch size="xs" checked={excludeMaintenance} onChange={(e) => setExcludeMaintenance(e.currentTarget.checked)} label={`Exclude maintenance${(() => {
                    const n = scopedMetrics.filter(isMaintenanceTicket).length;
                    return n > 0 ? ` (${n})` : "";
                  })()}`} styles={{ label: { fontSize: 11, fontWeight: 600 } }} />
                </Tooltip>
              </Group>
              <Group gap={6} wrap="nowrap">
                <ThemeIcon variant="light" color="gray" radius="md" size="sm"><IconCalendar size={12} /></ThemeIcon>
                <SegmentedControl size="xs" value={dayFilter} onChange={(v) => setDayFilter(v as DayFilter)} data={[{ label: "All days", value: "all" }, { label: "Weekday", value: "weekday" }, { label: "Weekend", value: "weekend" }]} styles={{ label: { fontSize: 11, fontWeight: 600, padding: "2px 8px" } }} />
              </Group>
              <Group gap={6} wrap="nowrap">
                <ThemeIcon variant="light" color="gray" radius="md" size="sm"><IconClock size={12} /></ThemeIcon>
                <Select size="xs" w={190} value={shiftFilter} onChange={(v) => setShiftFilter((v ?? "all") as ShiftFilter)} data={[{ value: "all", label: SHIFT_LABELS.all }, { value: "early", label: SHIFT_LABELS.early }, { value: "mid", label: SHIFT_LABELS.mid }, { value: "late", label: SHIFT_LABELS.late }]} allowDeselect={false} comboboxProps={{ withinPortal: true }} styles={{ input: { fontSize: 11, fontWeight: 600 } }} />
              </Group>
              {memberSelection}
            </Group>
          </Group>
          <ActiveFilterChips options={baseOptions} rowCount={scopedMetrics.length} scopeLabel={scopeLabel} />
          <Group gap="xs" wrap="wrap">
            <Badge variant="outline" color="grape">Scope source: {scopedMember ? (isManager ? "Manager drill-down" : "Self view") : isWholeTeamSelection ? "Team aggregate" : "Selected-member aggregate"}</Badge>
            <Badge variant="light" color="gray">Active days: {workload.activeDays}</Badge>
            <Badge variant="light" color="gray">Weekend load: {workload.weekendDays}</Badge>
            <Badge variant="light" color="gray">Shifts covered: {workload.shiftsCovered.length || 0}</Badge>
          </Group>
          {scopedMember && !isManager && (
            <Text size="xs" c="dimmed">
              Debug: your self view is locked to <b>{scopedMember}</b>. If a manager drills into the same member and the numbers differ, compare the scope badge and active filter chips first.
            </Text>
          )}
          {paritySummary && (
            <Card withBorder radius="md" p="sm" bg={paritySummary.allMatch ? "teal.0" : "red.0"}>
              <Stack gap="xs">
                <Group justify="space-between" wrap="wrap">
                  <Group gap="xs">
                    <Badge variant="light" color={paritySummary.allMatch ? "teal" : "red"}>
                      {paritySummary.allMatch ? "Parity check passed" : "Parity mismatch detected"}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      Manager drill-down vs simulated self-view for {scopedMember} under the same filters.
                    </Text>
                  </Group>
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => {
                      setRawMetricKey("tickets_acked");
                      setRawMonth(months[months.length - 1] ?? null);
                      setRawModalOpen(true);
                    }}
                  >
                    Open raw rows
                  </Button>
                </Group>
                <Group gap="xs" wrap="wrap">
                  {paritySummary.checks.map((check) => (
                    <Badge key={check.key} variant="outline" color={check.matches ? "teal" : "red"}>
                      {check.label}: {check.matches ? "match" : `manager ${check.managerValue ?? "—"} / self ${check.selfValue ?? "—"}`}
                    </Badge>
                  ))}
                </Group>
              </Stack>
            </Card>
          )}
        </Stack>
      </Card>

      <Group grow>
        <StatCard label="Ticket/day" value={workload.ticketsPerDay != null ? workload.ticketsPerDay.toFixed(1) : "—"} />
        <StatCard label="Calls/day" value={workload.callsPerDay != null ? workload.callsPerDay.toFixed(1) : "—"} />
        <StatCard label="Tasks/day" value={workload.tasksPerDay != null ? workload.tasksPerDay.toFixed(1) : "—"} />
      </Group>

      {showGroup("tickets") && (
        <KpiSection
          title="Tickets"
          icon={<IconTicket size={16} />}
          color="blue"
          kpis={KPI_DEFS.filter((def) => def.group === "tickets")}
          months={months}
          cells={cells}
          scopedMember={scopedMember}
          summariesByMonth={summariesByMonth}
          onOpenRaw={(metricKey, month) => {
            setRawMetricKey(metricKey);
            setRawMonth(month);
            setRawModalOpen(true);
          }}
        />
      )}
      {showGroup("calls") && (
        <KpiSection
          title="Inbound Calls"
          icon={<IconPhoneCall size={16} />}
          color="green"
          kpis={KPI_DEFS.filter((def) => def.group === "calls")}
          months={months}
          cells={cells}
          scopedMember={scopedMember}
          summariesByMonth={summariesByMonth}
          onOpenRaw={(metricKey, month) => {
            setRawMetricKey(metricKey);
            setRawMonth(month);
            setRawModalOpen(true);
          }}
        />
      )}
      {showGroup("tasks") && (
        <KpiSection
          title="Tasks"
          icon={<IconClipboardList size={16} />}
          color="orange"
          kpis={KPI_DEFS.filter((def) => def.group === "tasks")}
          months={months}
          cells={cells}
          scopedMember={scopedMember}
          summariesByMonth={summariesByMonth}
          onOpenRaw={(metricKey, month) => {
            setRawMetricKey(metricKey);
            setRawMonth(month);
            setRawModalOpen(true);
          }}
        />
      )}

      <RawDataModal
        opened={rawModalOpen}
        memberName={scopedMember}
        metrics={metrics}
        filterOptions={rawMonth ? { ...baseOptions, period: { type: "month", value: rawMonth } } : baseOptions}
        drillContext={rawMetricKey ? {
          metricKey: rawMetricKey,
          month: rawMonth,
          sourceTab: KPI_BY_KEY[rawMetricKey].sourceType,
          title: `${KPI_BY_KEY[rawMetricKey].label}${rawMonth ? ` · ${formatMonthLabel(rawMonth)}` : ""}`,
          description: KPI_BY_KEY[rawMetricKey].formula,
        } : undefined}
        onClose={() => setRawModalOpen(false)}
      />
    </Stack>
  );
}

function KpiSection({
  title,
  icon,
  color,
  kpis,
  months,
  cells,
  scopedMember,
  summariesByMonth,
  onOpenRaw,
}: {
  title: string;
  icon: React.ReactNode;
  color: string;
  kpis: KpiDefinition[];
  months: string[];
  cells: Record<string, Record<string, ReturnType<KpiDefinition["compute"]>>>;
  scopedMember: string | null;
  summariesByMonth: Record<string, SummaryArray>;
  onOpenRaw: (metricKey: KpiKey, month: string) => void;
}) {
  const hasAnyData = kpis.some((kpi) => months.some((month) => cells[kpi.key][month].numeric != null));
  if (!hasAnyData) return null;

  return (
    <Card withBorder radius="md" p="md" style={{ borderTop: `2px solid var(--mantine-color-${color}-6)` }}>
      <Group gap="xs" mb="md">
        <ThemeIcon variant="light" color={color} radius="md" size="md">{icon}</ThemeIcon>
        <Title order={6}>{title}</Title>
        <Badge variant="default" size="xs">{kpis.length} metric{kpis.length === 1 ? "" : "s"}</Badge>
      </Group>
      <ScrollArea type="auto" offsetScrollbars>
        <Table striped highlightOnHover withColumnBorders stickyHeader fz="xs" style={{ minWidth: Math.max(760, 260 + months.length * 165) }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ position: "sticky", left: 0, zIndex: 2, background: "var(--mantine-color-body)", minWidth: 220 }}>Metric</Table.Th>
              {months.map((month) => (
                <Table.Th key={month} style={{ textAlign: "right", minWidth: 150 }}>{formatMonthLabel(month)}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {kpis.map((kpi) => (
              <Table.Tr key={kpi.key}>
                <Table.Td style={{ position: "sticky", left: 0, zIndex: 1, background: "var(--mantine-color-body)", fontWeight: 500 }}>
                  <Stack gap={2}>
                    <Tooltip label={kpi.description} withinPortal multiline w={320}>
                      <Text size="xs" style={{ cursor: "help" }}>{kpi.label}</Text>
                    </Tooltip>
                    <Text size="10px" c="dimmed">{kpi.target ? `Target ${kpi.target.label}` : kpi.shortLabel}</Text>
                  </Stack>
                </Table.Td>
                {months.map((month, idx) => {
                  const cur = cells[kpi.key][month];
                  const prev = idx > 0 ? cells[kpi.key][months[idx - 1]] : null;
                  const anomaly = getKpiAnomaly(kpi, cur.numeric, prev?.numeric ?? null);
                  const ranking = scopedMember ? getKpiRanking(kpi, scopedMember, summariesByMonth[month]) : null;
                  const targetState = meetsTarget(kpi.target, cur.numeric);
                  return (
                    <Table.Td key={month} style={{ textAlign: "right", verticalAlign: "top" }}>
                      <Stack gap={4} align="flex-end">
                        <Button
                          variant="subtle"
                          color={targetState === false ? "red" : color}
                          size="compact-xs"
                          onClick={() => onOpenRaw(kpi.key, month)}
                          disabled={cur.numeric == null}
                          styles={{ root: { paddingInline: 0, height: "auto" } }}
                        >
                          <Text size="sm" fw={700} ff="monospace" c={cur.numeric == null ? "dimmed" : undefined}>{cur.value}</Text>
                        </Button>
                        {cur.subHint && <Text size="10px" c="dimmed" ff="monospace">{cur.subHint}</Text>}
                        {kpi.target && (
                          <Badge size="xs" color={targetState === true ? "teal" : targetState === false ? "red" : "gray"} variant="light" leftSection={<IconTargetArrow size={10} />}>
                            {kpi.target.label}
                          </Badge>
                        )}
                        {ranking && (
                          <Group gap={4} wrap="wrap" justify="flex-end">
                            <Badge size="xs" variant="light" color="blue">{ranking.percentile}th pct</Badge>
                            {ranking.median != null && <Badge size="xs" variant="outline" color="gray">Median {Number.isInteger(ranking.median) ? ranking.median : ranking.median.toFixed(1)}</Badge>}
                          </Group>
                        )}
                        {anomaly && <Badge size="xs" color={anomaly.color} variant="light" leftSection={<IconAlertTriangle size={10} />}>{anomaly.label}</Badge>}
                        {prev && <DeltaPill current={cur.numeric} previous={prev.numeric} goodWhen={kpi.goodWhen} />}
                      </Stack>
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Card>
  );
}

function DeltaPill({ current, previous, goodWhen }: { current: number | null; previous: number | null; goodWhen: "up" | "down"; }) {
  if (current == null || previous == null) {
    return <Group gap={2} wrap="nowrap"><IconMinus size={10} color="var(--mantine-color-dimmed)" /><Text size="10px" c="dimmed">—</Text></Group>;
  }
  const diff = current - previous;
  if (previous === 0) {
    if (diff === 0) return <Group gap={2} wrap="nowrap"><IconMinus size={10} color="var(--mantine-color-dimmed)" /><Text size="10px" c="dimmed">no change</Text></Group>;
    const up = diff > 0;
    const good = (up && goodWhen === "up") || (!up && goodWhen === "down");
    return <Text size="10px" c={good ? "teal" : "red"} fw={500}>{diff > 0 ? "+" : ""}{Math.round(diff).toLocaleString()}</Text>;
  }
  const pct = (diff / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 0.5) return <Group gap={2} wrap="nowrap"><IconMinus size={10} color="var(--mantine-color-dimmed)" /><Text size="10px" c="dimmed">≈ flat</Text></Group>;
  const up = diff > 0;
  const good = (up && goodWhen === "up") || (!up && goodWhen === "down");
  return <Text size="10px" c={good ? "teal" : "red"} fw={500}>{pct > 0 ? "+" : ""}{pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%</Text>;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card withBorder radius="md" p="sm">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text size="lg" fw={700} ff="monospace">{value}</Text>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card withBorder radius="md" p="xl">
      <Stack align="center" gap="xs">
        <IconCalendarStats size={36} color="var(--mantine-color-dimmed)" />
        <Text size="sm" c="dimmed" ta="center" maw={420}>{text}</Text>
      </Stack>
    </Card>
  );
}

function formatMonthLabel(yyyyMm: string): string {
  const m = yyyyMm.match(/^(\d{4})-(\d{2})$/);
  if (!m) return yyyyMm;
  const date = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
