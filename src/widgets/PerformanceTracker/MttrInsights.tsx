import { useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Card,
  Grid,
  Group,
  MultiSelect,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconChartHistogram,
  IconClock,
  IconEye,
  IconFilter,
  IconRoute,
  IconTicket,
  IconTopologyStar3,
  IconX,
} from "@tabler/icons-react";
import type { PerformanceMetric, Queue } from "./data";
import { filterMetrics, isMaintenanceTicket, listAvailablePeriods } from "./data";

interface Props {
  metrics: PerformanceMetric[];
  scopedMember: string | null;
  mode: "trends" | "charts";
}

type TicketRow = {
  id: number;
  memberName: string;
  month: string;
  quarter: string | null;
  queue: Queue | null;
  customer: string;
  carrier: string;
  issueType: string;
  resolution: string;
  channel: "buyers_club" | "msp" | "unknown";
  maintenance: boolean;
  mttrMinutes: number | null;
  ackMinutes: number | null;
  carrierTicketMinutes: number | null;
  within24: boolean | null;
};

type ReportedViaFilter = "both" | "noc" | "mobility";
type ChannelFilter = "both" | "buyers_club" | "msp";
type MaintenanceFilter = "include" | "exclude";
type TimeGrouping = "monthly" | "quarterly";

function normalizeText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeKey(value: unknown) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseRaw(metric: PerformanceMetric) {
  try {
    return JSON.parse(metric.raw_json ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function pickField(raw: Record<string, unknown>, ...aliases: string[]) {
  const wanted = new Set(aliases.map((alias) => normalizeKey(alias)));
  for (const [key, value] of Object.entries(raw)) {
    if (wanted.has(normalizeKey(key))) return value;
  }
  return undefined;
}

function formatMonthLabel(month: string) {
  const [year, monthNum] = month.split("-");
  const date = new Date(Number(year), Number(monthNum) - 1, 1);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function formatPeriodLabel(value: string, grouping: TimeGrouping) {
  return grouping === "monthly" ? formatMonthLabel(value) : value.replace("-", " ");
}

function formatMinutes(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 60) {
    const hours = value / 60;
    return `${hours.toFixed(hours >= 10 ? 1 : 2)}h`;
  }
  return `${Math.round(value)}m`;
}

function percent(num: number, den: number) {
  if (!den) return "0%";
  return `${Math.round((num / den) * 100)}%`;
}

function toChannel(value: unknown): TicketRow["channel"] {
  const key = normalizeKey(value);
  if (!key) return "unknown";
  if (key.includes("buyersclub") || key.includes("buyers'club") || key === "wholesale") return "buyers_club";
  if (key.includes("msp")) return "msp";
  return "unknown";
}

function toQueue(value: unknown): Queue | null {
  const key = normalizeKey(value);
  if (key === "noc") return "noc";
  if (key === "mobility") return "mobility";
  return null;
}

const darkSelectStyles = {
  label: { color: "#f4f7fb", fontWeight: 600, marginBottom: 6 },
  input: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#f4f7fb",
  },
  dropdown: {
    background: "#172237",
    border: "1px solid rgba(255,255,255,0.12)",
  },
  option: {
    color: "#e8edf7",
  },
  pillsList: {
    color: "#f4f7fb",
  },
} as const;

function metaBadgeStyles(background: string, color: string) {
  return {
    background,
    color,
    letterSpacing: "0.05em",
  } as const;
}

function toIssueType(raw: Record<string, unknown>) {
  return normalizeText(
    pickField(raw, "consolidated_issue", "issue", "issue_type", "Issue Type", "type") ?? "Unknown issue",
  ) || "Unknown issue";
}

function toResolution(raw: Record<string, unknown>) {
  return normalizeText(
    pickField(raw, "consolidate_resolution", "consolidated_resolution", "resolution", "Resolution") ?? "Other",
  ) || "Other";
}

function buildTicketRows(metrics: PerformanceMetric[], scopedMember: string | null) {
  const base = scopedMember ? metrics.filter((metric) => metric.member_name === scopedMember) : metrics;
  const tickets = filterMetrics(base, { period: { type: "all" } }).filter((metric) => metric.source_type === "tickets");

  return tickets.map((metric) => {
    const raw = parseRaw(metric);
    const within24Value = pickField(raw, "time_taken_to_close_tickets", "Time Taken to Close Tickets");
    const within24Text = normalizeText(within24Value).toLowerCase();

    return {
      id: metric.id,
      memberName: metric.member_name,
      month: metric.period_month ?? "Unknown",
      quarter: metric.period_quarter ?? null,
      queue: toQueue(metric.queue),
      customer: normalizeText(pickField(raw, "customer", "customer_name", "Customer Name")) || "Unknown customer",
      carrier: normalizeText(pickField(raw, "carrier_summary", "carrier", "Carrier Name")) || "Unknown carrier",
      issueType: toIssueType(raw),
      resolution: toResolution(raw),
      channel: toChannel(pickField(raw, "buyers_club_msp", "buyers club msp", "channel")),
      maintenance: isMaintenanceTicket(metric),
      mttrMinutes: metric.duration_minutes ?? null,
      ackMinutes: metric.ack_minutes ?? null,
      carrierTicketMinutes: metric.carrier_ticket_minutes ?? null,
      within24:
        within24Text.includes("less than 24") || within24Text.includes("within")
          ? true
          : within24Text.includes("more than 24") || within24Text.includes("greater than 24") || within24Text.includes("over 24")
            ? false
            : metric.success_count == null
              ? null
              : metric.success_count === 1,
    } satisfies TicketRow;
  }).filter((row) => row.month !== "Unknown");
}

type AggregatedPeriod = {
  periodKey: string;
  ticketCount: number;
  avgMttr: number | null;
  avgAck: number | null;
  under15CarrierPct: string;
  within24Pct: string;
  customerOpenedPct: string;
  vcomOpenedPct: string;
  topIssue: string;
  topResolution: string;
  topCarrier: string;
  highMttrCount: number;
};

function topLabel(map: Map<string, number>, fallback: string) {
  const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries[0]?.[0] ?? fallback;
}

function aggregatePeriods(rows: TicketRow[], grouping: TimeGrouping) {
  const byPeriod = new Map<string, TicketRow[]>();
  for (const row of rows) {
    const key = grouping === "monthly" ? row.month : (row.quarter ?? row.month);
    if (!byPeriod.has(key)) byPeriod.set(key, []);
    byPeriod.get(key)?.push(row);
  }

  return Array.from(byPeriod.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([periodKey, periodRows]) => {
      const mttrRows = periodRows.filter((row) => row.mttrMinutes != null);
      const ackRows = periodRows.filter((row) => row.ackMinutes != null);
      const carrierRows = periodRows.filter((row) => row.carrierTicketMinutes != null);
      const within24Rows = periodRows.filter((row) => row.within24 != null);
      const issues = new Map<string, number>();
      const resolutions = new Map<string, number>();
      const carriers = new Map<string, number>();
      let vcomOpened = 0;

      for (const row of periodRows) {
        issues.set(row.issueType, (issues.get(row.issueType) ?? 0) + 1);
        resolutions.set(row.resolution, (resolutions.get(row.resolution) ?? 0) + 1);
        carriers.set(row.carrier, (carriers.get(row.carrier) ?? 0) + 1);
        if (row.maintenance) vcomOpened += 1;
      }

      const avgMttr = mttrRows.length
        ? mttrRows.reduce((sum, row) => sum + (row.mttrMinutes ?? 0), 0) / mttrRows.length
        : null;
      const avgAck = ackRows.length
        ? ackRows.reduce((sum, row) => sum + (row.ackMinutes ?? 0), 0) / ackRows.length
        : null;
      const under15 = carrierRows.filter((row) => (row.carrierTicketMinutes ?? 99999) <= 15).length;
      const within24 = within24Rows.filter((row) => row.within24).length;
      const highMttrCount = mttrRows.filter((row) => (row.mttrMinutes ?? 0) > 480).length;

      return {
        periodKey,
        ticketCount: periodRows.length,
        avgMttr,
        avgAck,
        under15CarrierPct: percent(under15, carrierRows.length),
        within24Pct: percent(within24, within24Rows.length),
        customerOpenedPct: percent(periodRows.length - vcomOpened, periodRows.length),
        vcomOpenedPct: percent(vcomOpened, periodRows.length),
        topIssue: topLabel(issues, "Unknown issue"),
        topResolution: topLabel(resolutions, "Other"),
        topCarrier: topLabel(carriers, "Unknown carrier"),
        highMttrCount,
      } satisfies AggregatedPeriod;
    });
}

function aggregateChartData(rows: TicketRow[]) {
  const byQueue = new Map<"noc" | "mobility", TicketRow[]>();
  byQueue.set("noc", rows.filter((row) => row.queue === "noc"));
  byQueue.set("mobility", rows.filter((row) => row.queue === "mobility"));

  return (["noc", "mobility"] as const).map((queue) => {
    const queueRows = byQueue.get(queue) ?? [];
    const issues = new Map<string, number>();
    const resolutions = new Map<string, number>();
    const carriers = new Map<string, number>();
    const customers = new Map<string, number>();

    for (const row of queueRows) {
      issues.set(row.issueType, (issues.get(row.issueType) ?? 0) + 1);
      resolutions.set(row.resolution, (resolutions.get(row.resolution) ?? 0) + 1);
      carriers.set(row.carrier, (carriers.get(row.carrier) ?? 0) + 1);
      customers.set(row.customer, (customers.get(row.customer) ?? 0) + 1);
    }

    const toRows = (map: Map<string, number>) =>
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([label, count]) => ({ label, count, pct: percent(count, queueRows.length) }));

    const avgMttrRows = queueRows.filter((row) => row.mttrMinutes != null);
    const avgMttr = avgMttrRows.length
      ? avgMttrRows.reduce((sum, row) => sum + (row.mttrMinutes ?? 0), 0) / avgMttrRows.length
      : null;

    return {
      queue,
      count: queueRows.length,
      avgMttr,
      highMttr: avgMttrRows.filter((row) => (row.mttrMinutes ?? 0) > 480).length,
      topIssues: toRows(issues),
      topResolutions: toRows(resolutions),
      topCarriers: toRows(carriers),
      topCustomers: toRows(customers),
    };
  });
}

export function MttrInsights({ metrics, scopedMember, mode }: Props) {
  const periods = useMemo(() => listAvailablePeriods(metrics), [metrics]);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [reportedViaFilter, setReportedViaFilter] = useState<ReportedViaFilter>("both");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("both");
  const [maintenanceFilter, setMaintenanceFilter] = useState<MaintenanceFilter>("include");
  const [timeGrouping, setTimeGrouping] = useState<TimeGrouping>("monthly");
  const [periodValue, setPeriodValue] = useState<string | null>(null);

  const resetFilters = () => {
    setSelectedCustomers([]);
    setReportedViaFilter("both");
    setChannelFilter("both");
    setMaintenanceFilter("include");
    setTimeGrouping("monthly");
    setPeriodValue(null);
  };

  const ticketRows = useMemo(() => buildTicketRows(metrics, scopedMember), [metrics, scopedMember]);

  const customerOptions = useMemo(
    () => Array.from(new Set(ticketRows.map((row) => row.customer))).sort().map((value) => ({ value, label: value })),
    [ticketRows],
  );

  const availablePeriods = useMemo(
    () => (timeGrouping === "monthly" ? periods.months : periods.quarters),
    [periods, timeGrouping],
  );

  const filteredRows = useMemo(() => {
    return ticketRows.filter((row) => {
      if (selectedCustomers.length > 0 && !selectedCustomers.includes(row.customer)) return false;
      if (reportedViaFilter !== "both" && row.queue !== reportedViaFilter) return false;
      if (channelFilter !== "both" && row.channel !== channelFilter) return false;
      if (maintenanceFilter === "exclude" && row.maintenance) return false;
      if (periodValue) {
        const value = timeGrouping === "monthly" ? row.month : (row.quarter ?? row.month);
        if (value !== periodValue) return false;
      }
      return true;
    });
  }, [ticketRows, selectedCustomers, reportedViaFilter, channelFilter, maintenanceFilter, periodValue, timeGrouping]);

  const trendRows = useMemo(() => aggregatePeriods(filteredRows, timeGrouping), [filteredRows, timeGrouping]);
  const chartData = useMemo(() => aggregateChartData(filteredRows), [filteredRows]);

  if (ticketRows.length === 0) {
    return (
      <Card withBorder radius="md" p="xl">
        <Stack align="center" gap="sm">
          <ThemeIcon size={56} radius="xl" variant="light" color="orange">
            <IconAlertCircle size={28} />
          </ThemeIcon>
          <Title order={4}>No ticket data available yet</Title>
          <Text c="dimmed" ta="center" maw={620}>
            Import ticket data in Team Performance first. The moved MTTR tabs now read directly from Team Performance ticket rows instead of MTTR workbook uploads.
          </Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Stack gap="md">
      <Card
        withBorder
        radius="lg"
        p="lg"
        style={{
          background: "linear-gradient(180deg, #182338 0%, #162133 100%)",
          borderColor: "rgba(120, 148, 185, 0.24)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
        }}
      >
        <Stack gap="md">
          <Group justify="space-between" align="start" wrap="wrap">
            <Stack gap={2}>
              <Title order={4} c="#f4f7fb">
                {mode === "trends" ? "Trend filters" : "MTTR chart filters"}
              </Title>
              <Text size="sm" c="rgba(214, 223, 238, 0.72)">
                These filters now use Team Performance ticket imports. MTTR workbook Trends and Charts have been consolidated here.
              </Text>
            </Stack>

            <Group gap="xs">
              <ActionIcon
                variant="light"
                color="gray"
                radius="md"
                size="lg"
                onClick={resetFilters}
                title="Clear all filters"
                styles={{
                  root: {
                    background: "rgba(255,255,255,0.08)",
                    color: "#d7deea",
                    border: "1px solid rgba(255,255,255,0.08)",
                  },
                }}
              >
                <IconX size={16} />
              </ActionIcon>
              <ThemeIcon
                variant="light"
                radius="md"
                size="lg"
                styles={{
                  root: {
                    background: "rgba(255,255,255,0.08)",
                    color: "#d7deea",
                    border: "1px solid rgba(255,255,255,0.08)",
                  },
                }}
              >
                <IconFilter size={18} />
              </ThemeIcon>
            </Group>
          </Group>

          <SimpleGrid cols={{ base: 1, md: 2, xl: 5 }} spacing="md" verticalSpacing="md">
            <MultiSelect
              label="Customer"
              placeholder="Start typing a customer name"
              value={selectedCustomers}
              onChange={setSelectedCustomers}
              searchable
              clearable
              hidePickedOptions
              maxDropdownHeight={280}
              data={customerOptions}
              nothingFoundMessage="No matching customer"
              styles={darkSelectStyles}
            />
            <Select
              label="Reported via"
              value={reportedViaFilter}
              onChange={(value) => setReportedViaFilter((value as ReportedViaFilter) ?? "both")}
              data={[
                { value: "both", label: "NOC + Mobility" },
                { value: "noc", label: "NOC only" },
                { value: "mobility", label: "Mobility only" },
              ]}
              styles={darkSelectStyles}
            />
            <Select
              label="Channel"
              value={channelFilter}
              onChange={(value) => setChannelFilter((value as ChannelFilter) ?? "both")}
              data={[
                { value: "both", label: "Buyers' Club + MSP" },
                { value: "buyers_club", label: "Buyers' Club only" },
                { value: "msp", label: "MSP only" },
              ]}
              styles={darkSelectStyles}
            />
            <Select
              label="Maintenance"
              value={maintenanceFilter}
              onChange={(value) => setMaintenanceFilter((value as MaintenanceFilter) ?? "include")}
              data={[
                { value: "include", label: "Include maintenance" },
                { value: "exclude", label: "Exclude maintenance" },
              ]}
              styles={darkSelectStyles}
            />
            <Select
              label="Period"
              value={timeGrouping}
              onChange={(value) => {
                setTimeGrouping((value as TimeGrouping) ?? "monthly");
                setPeriodValue(null);
              }}
              data={[
                { value: "monthly", label: `Monthly · reports ${periods.months.length} months` },
                { value: "quarterly", label: `Quarterly · reports ${periods.quarters.length} quarters` },
              ]}
              styles={darkSelectStyles}
            />
          </SimpleGrid>

          <Group align="end" justify="space-between" wrap="wrap">
            <Select
              style={{ flex: 1, minWidth: 240 }}
              label={timeGrouping === "monthly" ? "Specific month" : "Specific quarter"}
              placeholder={`All ${timeGrouping === "monthly" ? "months" : "quarters"}`}
              value={periodValue}
              onChange={setPeriodValue}
              clearable
              data={availablePeriods.map((value) => ({ value, label: formatPeriodLabel(value, timeGrouping) }))}
              styles={darkSelectStyles}
            />
            <Badge
              radius="sm"
              variant="filled"
              style={{
                background: "rgba(109, 96, 84, 0.88)",
                color: "#f3e9dc",
                letterSpacing: "0.05em",
              }}
            >
              {filteredRows.length} rows shown
            </Badge>
          </Group>
        </Stack>
      </Card>

      {mode === "trends" ? (
        <Card
          withBorder
          radius="lg"
          p="md"
          style={{
            background: "linear-gradient(180deg, #182338 0%, #162133 100%)",
            borderColor: "rgba(120, 148, 185, 0.24)",
          }}
        >
          <Stack gap="md">
            <Group justify="space-between" align="end" wrap="wrap">
              <Stack gap={2}>
                <Title order={4} c="#f4f7fb">Workbook trend sections</Title>
                <Text size="sm" c="rgba(214, 223, 238, 0.72)">
                  Monthly matrix view for MTTR trends, styled to match the workbook section pattern.
                </Text>
              </Stack>
              <Badge
                radius="sm"
                variant="filled"
                style={{
                  background: "rgba(109, 96, 84, 0.88)",
                  color: "#f3e9dc",
                  letterSpacing: "0.05em",
                }}
              >
                1 section
              </Badge>
            </Group>

            {trendRows.length === 0 ? (
              <Alert color="yellow" variant="light">No MTTR trend rows matched the current Team Performance ticket filters.</Alert>
            ) : (
              <Card
                radius="md"
                p={0}
                withBorder
                style={{
                  overflow: "hidden",
                  background: "#182338",
                  borderColor: "rgba(120, 148, 185, 0.24)",
                }}
              >
                <Group
                  justify="space-between"
                  px="md"
                  py="sm"
                  style={{
                    background: "#f3f4f6",
                    borderBottom: "1px solid rgba(15, 23, 42, 0.12)",
                  }}
                >
                  <Title order={4} c="#d0d3d9" fw={700}>MTTR - Trends</Title>
                  <Group gap="xs">
                    <Badge radius="sm" variant="filled" style={metaBadgeStyles("#dff5ef", "#7db8a4")}>CALCULATED</Badge>
                    <Badge radius="sm" variant="filled" style={metaBadgeStyles("#dcecff", "#7fa6d9")}>TEAM DATA</Badge>
                    <Badge radius="sm" variant="filled" style={metaBadgeStyles("#eceff4", "#a7b0bd")}>{filteredRows.length} rows shown</Badge>
                  </Group>
                </Group>

                <ScrollArea>
                  <Table
                    withColumnBorders
                    horizontalSpacing="sm"
                    verticalSpacing="sm"
                    styles={{
                      table: {
                        minWidth: 1320,
                        background: "#172237",
                      },
                      thead: {
                        background: "#172237",
                      },
                      th: {
                        background: "#172237",
                        color: "#f4f7fb",
                        fontSize: 13,
                        fontWeight: 700,
                        borderColor: "rgba(255,255,255,0.12)",
                        whiteSpace: "nowrap",
                      },
                      td: {
                        color: "#e8edf7",
                        borderColor: "rgba(255,255,255,0.12)",
                        verticalAlign: "top",
                      },
                      tr: {
                        borderColor: "rgba(255,255,255,0.12)",
                      },
                    }}
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th miw={170}>Metric</Table.Th>
                        <Table.Th miw={120}>
                          <Group gap={6} wrap="nowrap">
                            <Text inherit>{timeGrouping === "monthly" ? "Period" : "Quarter"}</Text>
                            <ThemeIcon size={18} radius="xl" variant="filled" style={{ background: "rgba(125, 109, 95, 0.9)", color: "#f6efe7" }}>
                              <IconEye size={11} />
                            </ThemeIcon>
                          </Group>
                        </Table.Th>
                        <Table.Th miw={95}>Tickets</Table.Th>
                        <Table.Th miw={110}>Avg MTTR</Table.Th>
                        <Table.Th miw={110}>Avg Ack</Table.Th>
                        <Table.Th miw={125}>Carrier ≤ 15m</Table.Th>
                        <Table.Th miw={105}>Within 24h</Table.Th>
                        <Table.Th miw={130}>Customer Opened</Table.Th>
                        <Table.Th miw={115}>vCom Opened</Table.Th>
                        <Table.Th miw={180}>Top Issue</Table.Th>
                        <Table.Th miw={180}>Top Resolution</Table.Th>
                        <Table.Th miw={160}>Top Carrier</Table.Th>
                        <Table.Th miw={105}>MTTR &gt; 8h</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {trendRows.map((row, index) => (
                        <Table.Tr
                          key={row.periodKey}
                          style={{
                            background: index % 2 === 0 ? "rgba(62, 59, 59, 0.96)" : "#172237",
                          }}
                        >
                          <Table.Td fw={600}>Avg MTTR</Table.Td>
                          <Table.Td>{formatPeriodLabel(row.periodKey, timeGrouping)}</Table.Td>
                          <Table.Td>{row.ticketCount}</Table.Td>
                          <Table.Td>{formatMinutes(row.avgMttr)}</Table.Td>
                          <Table.Td>{formatMinutes(row.avgAck)}</Table.Td>
                          <Table.Td>{row.under15CarrierPct}</Table.Td>
                          <Table.Td>{row.within24Pct}</Table.Td>
                          <Table.Td>{row.customerOpenedPct}</Table.Td>
                          <Table.Td>{row.vcomOpenedPct}</Table.Td>
                          <Table.Td>{row.topIssue}</Table.Td>
                          <Table.Td>{row.topResolution}</Table.Td>
                          <Table.Td>{row.topCarrier}</Table.Td>
                          <Table.Td>{row.highMttrCount}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </Card>
            )}
          </Stack>
        </Card>
      ) : (
        <Grid>
          {chartData.map((section) => (
            <Grid.Col key={section.queue} span={{ base: 12, xl: 6 }}>
              <Card withBorder radius="md" p="md" h="100%">
                <Stack gap="md">
                  <Group justify="space-between">
                    <Group gap="sm">
                      <ThemeIcon variant="light" color={section.queue === "noc" ? "orange" : "blue"}>
                        {section.queue === "noc" ? <IconRoute size={16} /> : <IconTopologyStar3 size={16} />}
                      </ThemeIcon>
                      <div>
                        <Title order={5}>{section.queue === "noc" ? "Network" : "Mobility"} MTTR charts</Title>
                        <Text size="sm" c="dimmed">Derived from Team Performance ticket imports</Text>
                      </div>
                    </Group>
                    <Badge color={section.queue === "noc" ? "orange" : "blue"} variant="light">{section.count} tickets</Badge>
                  </Group>

                  <SimpleGrid cols={3}>
                    <MetricCard label="Avg MTTR" value={formatMinutes(section.avgMttr)} icon={IconClock} />
                    <MetricCard label="High MTTR" value={String(section.highMttr)} icon={IconChartHistogram} />
                    <MetricCard label="Top issues" value={String(section.topIssues.length)} icon={IconTicket} />
                  </SimpleGrid>

                  <ChartTable title="Top issue types" rows={section.topIssues} />
                  <ChartTable title="Top resolutions" rows={section.topResolutions} />
                  <ChartTable title="Top carriers" rows={section.topCarriers} />
                  <ChartTable title="Top customers" rows={section.topCustomers} />
                </Stack>
              </Card>
            </Grid.Col>
          ))}
        </Grid>
      )}
    </Stack>
  );
}

function MetricCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof IconClock }) {
  return (
    <Card withBorder radius="md" p="sm">
      <Group justify="space-between" align="start">
        <Stack gap={2}>
          <Text size="xs" c="dimmed">{label}</Text>
          <Text fw={700}>{value}</Text>
        </Stack>
        <ThemeIcon variant="light" color="orange"><Icon size={16} /></ThemeIcon>
      </Group>
    </Card>
  );
}

function ChartTable({ title, rows }: { title: string; rows: Array<{ label: string; count: number; pct: string }> }) {
  return (
    <Card withBorder radius="md" p="sm">
      <Stack gap="xs">
        <Title order={6}>{title}</Title>
        {rows.length === 0 ? (
          <Text size="sm" c="dimmed">No data under the current filters.</Text>
        ) : (
          <Table withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Label</Table.Th>
                <Table.Th w={80}>Count</Table.Th>
                <Table.Th w={90}>Share</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={`${title}-${row.label}`}>
                  <Table.Td>{row.label}</Table.Td>
                  <Table.Td>{row.count}</Table.Td>
                  <Table.Td>{row.pct}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Card>
  );
}
