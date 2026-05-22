/**
 * ZoomCallMetrics — TEST widget (queue-based)
 *
 * Uses /phone/call_queues/{id}/call_logs so ALL agents' calls are returned,
 * not just the admin account's calls.
 *
 * Three tabs:
 *   1. Overview    — team KPI cards (from team_by_month) + per-agent answered bar chart
 *   2. Raw Records — every individual queue call record with full field visibility
 *   3. Compare vs Excel — side-by-side API answered vs Excel answered per agent
 */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconChartBar,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconPhone,
  IconPhoneIncoming,
  IconPhoneOff,
  IconPhoneX,
  IconRefresh,
  IconSearch,
  IconTable,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { TIER_COLORS, TIER_SHORT_LABELS, tierFor } from "../PerformanceTracker/team";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonthStats {
  answered: number; refused: number; missed: number;
  handle_seconds_sum: number; handle_count: number;
  wait_seconds_sum: number;   wait_count: number;
}

interface AgentData {
  name: string;
  by_month: Record<string, MonthStats>;
}

interface ApiResponse {
  source:        "live" | "snapshot";
  fetched_at:    string;
  from:          string;
  to:            string;
  months:        string[];
  agents:        AgentData[];
  team_by_month: Record<string, MonthStats>;
  queues_found:  string[];
  warning:       string | null;
}

interface RawRecord {
  idx:              number;
  start_time:       string;
  queue_name:       string;
  call_result_raw:  string;
  classified_as:    "answered" | "refused" | "missed";
  answered_by_name: string;
  duration_seconds: number;
  wait_seconds:     number;
}

interface RawResponse {
  source:       string;
  month:        string;
  from_date:    string;
  to_date:      string;
  records:      RawRecord[];
  totals:       { fetched: number; answered: number; refused: number; missed: number };
  queues_found: string[];
  capped?:      boolean;
  warning?:     string;
}

interface CompareRow {
  agent:        string;
  by_month:     Record<string, { api: number; excel: number; delta: number }>;
  total_api:    number;
  total_excel:  number;
  total_delta:  number;
}

interface CompareResponse {
  source_api:   "live" | "snapshot";
  months:       string[];
  rows:         CompareRow[];
  grand_totals: Record<string, { api: number; excel: number; delta: number }>;
  queues_found: string[];
  zoom_warning:  string | null;
  excel_warning: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04"];

const MONTH_LABELS: Record<string, string> = {
  "2026-01": "January", "2026-02": "February", "2026-03": "March", "2026-04": "April",
};
const MONTH_SHORT: Record<string, string> = {
  "2026-01": "Jan", "2026-02": "Feb", "2026-03": "Mar", "2026-04": "Apr",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

function emptyStats(): MonthStats {
  return { answered: 0, refused: 0, missed: 0, handle_seconds_sum: 0, handle_count: 0, wait_seconds_sum: 0, wait_count: 0 };
}

function addStats(a: MonthStats, b: MonthStats): MonthStats {
  return {
    answered:           a.answered + b.answered,
    refused:            a.refused + b.refused,
    missed:             a.missed + b.missed,
    handle_seconds_sum: a.handle_seconds_sum + b.handle_seconds_sum,
    handle_count:       a.handle_count + b.handle_count,
    wait_seconds_sum:   a.wait_seconds_sum + b.wait_seconds_sum,
    wait_count:         a.wait_count + b.wait_count,
  };
}

function avgHandle(s: MonthStats): number | null {
  return s.handle_count > 0 ? s.handle_seconds_sum / s.handle_count : null;
}

function avgWait(s: MonthStats): number | null {
  return s.wait_count > 0 ? s.wait_seconds_sum / s.wait_count : null;
}

function deltaColor(d: number): string {
  if (d === 0) return "green";
  if (Math.abs(d) <= 5) return "yellow";
  if (Math.abs(d) <= 20) return "orange";
  return "red";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, icon }: {
  label: string; value: string; sub?: string; color: string; icon?: React.ReactNode;
}) {
  return (
    <Card withBorder radius="md" p="md" style={{ borderTop: `2px solid var(--mantine-color-${color}-6)` }}>
      <Group gap={6} mb={4}>
        {icon && <ThemeIcon size="xs" variant="transparent" color={color}>{icon}</ThemeIcon>}
        <Text size="xs" fw={600} tt="uppercase" c="dimmed">{label}</Text>
      </Group>
      <Text size="xl" fw={700} ff="monospace" c={`${color}.4`}>{value}</Text>
      {sub && <Text size="xs" c="dimmed" mt={2}>{sub}</Text>}
    </Card>
  );
}

function MiniKpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={1}>{label}</Text>
      <Text size="md" fw={700} ff="monospace" c={color ? `${color}.4` : undefined}>{value}</Text>
    </Box>
  );
}

function AgentMonthTable({ agent, months }: { agent: AgentData; months: string[] }) {
  return (
    <Box style={{ background: "var(--mantine-color-dark-7)", borderRadius: 8, padding: "10px 12px", marginTop: 4, marginBottom: 8, marginLeft: 168 }}>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb="xs">Monthly Breakdown</Text>
      <ScrollArea>
        <Table fz="xs" horizontalSpacing="sm" verticalSpacing={3}>
          <Table.Thead>
            <Table.Tr>
              {["Month","Answered","Avg Handle","Avg Wait"].map((h) => (
                <Table.Th key={h} style={{ color: "var(--mantine-color-dimmed)" }}>{h}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {months.map((m) => {
              const s  = agent.by_month[m] ?? emptyStats();
              const ah = avgHandle(s);
              const aw = avgWait(s);
              return (
                <Table.Tr key={m}>
                  <Table.Td fw={600}>{MONTH_LABELS[m] ?? m}</Table.Td>
                  <Table.Td>
                    <Text size="xs" fw={700} ff="monospace" c={s.answered > 0 ? "green.4" : "dimmed"}>{s.answered}</Text>
                  </Table.Td>
                  <Table.Td><Text size="xs" ff="monospace">{ah != null ? formatSeconds(ah) : "—"}</Text></Table.Td>
                  <Table.Td><Text size="xs" ff="monospace">{aw != null ? formatSeconds(aw) : "—"}</Text></Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Box>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: ApiResponse }) {
  const [period, setPeriod]     = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const selectedMonths = period === "all" ? data.months : [period];

  // Team KPI from team_by_month (accurate incl. missed/refused)
  const teamTotal = useMemo(() => {
    return selectedMonths.reduce((acc, m) => addStats(acc, data.team_by_month[m] ?? emptyStats()), emptyStats());
  }, [data, selectedMonths]);

  // Per-agent bars from agents array (answered only — from answered_by field)
  const agentRows = useMemo(() => {
    return data.agents
      .map((ag) => ({
        name:     ag.name,
        total:    selectedMonths.reduce((acc, m) => addStats(acc, ag.by_month[m] ?? emptyStats()), emptyStats()),
        by_month: ag.by_month,
      }))
      .filter((r) => r.total.answered > 0)
      .sort((a, b) => b.total.answered - a.total.answered);
  }, [data, selectedMonths]);

  const teamAvgHandle = avgHandle(teamTotal);
  const teamAvgWait   = avgWait(teamTotal);
  const maxAnswered   = agentRows.length > 0 ? Math.max(...agentRows.map((r) => r.total.answered)) : 0;

  const segData = [
    { value: "all", label: "All" },
    ...data.months.map((m) => ({ value: m, label: MONTH_SHORT[m] ?? m })),
  ];

  return (
    <Stack gap="lg" pt="md">
      <SegmentedControl
        value={period}
        onChange={(v) => { setPeriod(v); setExpanded(null); }}
        data={segData}
        size="xs"
        radius="md"
      />

      {/* Team KPI cards — from team_by_month (accurate total incl. all outcomes) */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <KpiCard label="Answered" value={teamTotal.answered.toLocaleString()} sub="queue calls picked up" color="green" icon={<IconPhoneIncoming size={12} />} />
        <KpiCard label="Refused" value={teamTotal.refused.toLocaleString()} sub="no answer / by other" color="red" icon={<IconPhoneX size={12} />} />
        <KpiCard label="Missed" value={teamTotal.missed.toLocaleString()} sub="voicemail / abandoned" color="orange" icon={<IconPhoneOff size={12} />} />
        <KpiCard
          label="Avg Handle Time"
          value={teamAvgHandle != null ? formatSeconds(teamAvgHandle) : "—"}
          sub="from Duration field"
          color="teal"
        />
      </SimpleGrid>

      {teamAvgWait != null && (
        <Card withBorder radius="md" p="md" style={{ borderTop: "2px solid var(--mantine-color-cyan-6)" }}>
          <Group gap="md">
            <ThemeIcon radius="md" variant="light" color="cyan" size="lg"><IconPhone size={18} /></ThemeIcon>
            <Box>
              <Text size="xl" fw={700} ff="monospace" c="cyan.4">{formatSeconds(teamAvgWait)}</Text>
              <Text size="xs" fw={600}>Avg Speed of Answer</Text>
              <Text size="xs" c="dimmed">from Wait Time field</Text>
            </Box>
          </Group>
        </Card>
      )}

      {/* Per-agent bar chart — answered calls attributed via answered_by field */}
      <Card withBorder radius="md" p="md" style={{ borderTop: "2px solid var(--mantine-color-green-6)" }}>
        <Stack gap="md">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon radius="md" variant="light" color="green" size="lg"><IconPhoneIncoming size={20} /></ThemeIcon>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Title order={5} style={{ lineHeight: 1.2 }}>Answered Calls — Per Agent</Title>
              <Text size="xs" c="dimmed">
                {agentRows.length} agent{agentRows.length === 1 ? "" : "s"} · attributed via <Text component="span" ff="monospace" size="xs">answered_by</Text> field · click to expand monthly
              </Text>
            </Box>
            <Group gap="xl" wrap="wrap" justify="flex-end" visibleFrom="sm">
              <MiniKpi label="Answered" value={teamTotal.answered.toLocaleString()} color="green" />
              <MiniKpi label="Refused" value={teamTotal.refused.toLocaleString()} color="red" />
              <MiniKpi label="Missed" value={teamTotal.missed.toLocaleString()} color="orange" />
              {teamAvgHandle != null && <MiniKpi label="Avg Handle" value={formatSeconds(teamAvgHandle)} />}
            </Group>
          </Group>

          <Stack gap={2}>
            {agentRows.map((row) => {
              const tier  = tierFor(row.name);
              const bar   = maxAnswered > 0 ? (row.total.answered / maxAnswered) * 100 : 0;
              const pct   = teamTotal.answered > 0 ? Math.round((row.total.answered / teamTotal.answered) * 100) : 0;
              const isExp = expanded === row.name;
              const ah    = avgHandle(row.total);
              const aw    = avgWait(row.total);

              return (
                <Box key={row.name}>
                  <Group
                    gap="sm" wrap="nowrap" py={4} px={6}
                    style={{ cursor: "pointer", borderRadius: 6, background: isExp ? "var(--mantine-color-dark-6)" : "transparent" }}
                    onClick={() => setExpanded(isExp ? null : row.name)}
                  >
                    <Box style={{ width: 14, flexShrink: 0 }}>
                      {isExp ? <IconChevronDown size={12} color="var(--mantine-color-dimmed)" /> : <IconChevronRight size={12} color="var(--mantine-color-dimmed)" />}
                    </Box>
                    <Box style={{ width: 148, flexShrink: 0 }}>
                      <Group gap={4} wrap="nowrap">
                        <Text size="xs" truncate fw={500}>{row.name}</Text>
                        {tier && <Badge size="xs" variant="light" color={TIER_COLORS[tier]} style={{ flexShrink: 0 }}>{TIER_SHORT_LABELS[tier]}</Badge>}
                      </Group>
                    </Box>
                    <Tooltip withinPortal label={
                      <Box>
                        <div>Answered: {row.total.answered.toLocaleString()} ({pct}% of team)</div>
                        {ah != null && <div>Avg Handle: {formatSeconds(ah)}</div>}
                        {aw != null && <div>Avg Wait: {formatSeconds(aw)}</div>}
                      </Box>
                    }>
                      <Box style={{ flex: 1 }}>
                        <Progress value={bar} color="green" size="sm" radius="sm" />
                      </Box>
                    </Tooltip>
                    <Text size="xs" fw={700} ff="monospace" c="green.4" style={{ width: 38, textAlign: "right", flexShrink: 0 }}>
                      {row.total.answered.toLocaleString()}
                    </Text>
                    <Text size="xs" c="dimmed" style={{ width: 40, flexShrink: 0 }}>{pct}%</Text>
                    {ah != null && (
                      <Text size="xs" c="dimmed" style={{ width: 56, flexShrink: 0 }} visibleFrom="sm">
                        {formatSeconds(ah)}
                      </Text>
                    )}
                  </Group>
                  {isExp && <AgentMonthTable agent={{ name: row.name, by_month: row.by_month }} months={data.months} />}
                </Box>
              );
            })}
          </Stack>

          {agentRows.length === 0 && (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              No answered calls found for this period.
            </Text>
          )}

          <Text size="xs" c="dimmed" pt="xs" style={{ borderTop: "1px solid var(--mantine-color-dark-5)" }}>
            ℹ️ Per-agent bars show <b>answered</b> calls only (attributed via Zoom's <Text component="span" ff="monospace" size="xs">answered_by</Text> field). Refused &amp; missed totals above are team-level from queue logs since non-answered calls aren't attributed to a specific agent.
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}

// ── Raw Records tab ───────────────────────────────────────────────────────────

function RawRecordsTab() {
  const [month, setMonth]           = useState("2026-01");
  const [agentFilter, setAgentFilter] = useState("");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [rawData, setRawData]       = useState<RawResponse | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);

  async function fetchRaw() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ month });
      if (agentFilter.trim()) params.set("agent", agentFilter.trim());
      const r = await fetch(`/api/zoom/call-logs-raw?${params}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setRawData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!rawData) return [];
    if (classFilter === "all") return rawData.records;
    return rawData.records.filter((r) => r.classified_as === classFilter);
  }, [rawData, classFilter]);

  const monthOptions = MONTHS.map((m) => ({ value: m, label: MONTH_LABELS[m] }));

  const classFilterData = [
    { value: "all",      label: `All (${rawData?.totals.fetched ?? 0})` },
    { value: "answered", label: `✅ Answered (${rawData?.totals.answered ?? 0})` },
    { value: "refused",  label: `🔴 Refused (${rawData?.totals.refused ?? 0})` },
    { value: "missed",   label: `🟠 Missed (${rawData?.totals.missed ?? 0})` },
  ];

  return (
    <Stack gap="md" pt="md">
      {/* Filters */}
      <Card withBorder radius="md" p="md">
        <Group gap="sm" wrap="wrap" align="flex-end">
          <Select
            label="Month"
            data={monthOptions}
            value={month}
            onChange={(v) => v && setMonth(v)}
            style={{ width: 140 }}
            size="sm"
          />
          <TextInput
            label="Filter by answered by"
            placeholder="e.g. Sriram"
            leftSection={<IconSearch size={14} />}
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 180 }}
            size="sm"
          />
          <Button
            leftSection={loading ? <Loader size={14} color="white" /> : <IconRefresh size={14} />}
            onClick={fetchRaw}
            disabled={loading}
            color="green"
            size="sm"
          >
            {loading ? "Loading…" : "Fetch Records"}
          </Button>
        </Group>
      </Card>

      {error && (
        <Alert icon={<IconAlertTriangle size={16} />} color="red" radius="md">
          <Text size="xs">{error}</Text>
        </Alert>
      )}

      {rawData && (
        <>
          {/* Summary stats */}
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
            {[
              { label: "FETCHED",  value: rawData.totals.fetched,   color: "blue"   },
              { label: "ANSWERED", value: rawData.totals.answered,   color: "green"  },
              { label: "REFUSED",  value: rawData.totals.refused,    color: "red"    },
              { label: "MISSED",   value: rawData.totals.missed,     color: "orange" },
            ].map(({ label, value, color }) => (
              <Card key={label} withBorder radius="md" p="sm">
                <Text size="xs" fw={600} tt="uppercase" c="dimmed">{label}</Text>
                <Text size="lg" fw={700} ff="monospace" c={`${color}.4`}>{value.toLocaleString()}</Text>
              </Card>
            ))}
          </SimpleGrid>

          {/* Queues found */}
          {rawData.queues_found.length > 0 && (
            <Group gap="xs">
              <Text size="xs" c="dimmed">Queues:</Text>
              {rawData.queues_found.map((q) => (
                <Badge key={q} size="xs" variant="light" color="green" leftSection={<IconCheck size={10} />}>{q}</Badge>
              ))}
            </Group>
          )}

          {rawData.capped && (
            <Alert icon={<IconAlertTriangle size={14} />} color="yellow" radius="md" p="sm">
              <Text size="xs">Results capped at 5,000 records. Use the "Filter by answered by" field to narrow down.</Text>
            </Alert>
          )}

          {/* Class filter tabs */}
          <SegmentedControl
            value={classFilter}
            onChange={setClassFilter}
            data={classFilterData}
            size="xs"
            radius="md"
            fullWidth
          />

          {/* Records table */}
          <Card withBorder radius="md" p={0}>
            <ScrollArea h={520}>
              <Table fz="xs" horizontalSpacing="md" verticalSpacing="sm" striped highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: 40 }}>#</Table.Th>
                    <Table.Th>Start Time</Table.Th>
                    <Table.Th>Queue</Table.Th>
                    <Table.Th>Call Result (raw)</Table.Th>
                    <Table.Th>Classified As</Table.Th>
                    <Table.Th>Answered By</Table.Th>
                    <Table.Th>Duration</Table.Th>
                    <Table.Th>Wait</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filtered.length === 0 ? (
                    <Table.Tr>
                      <Table.Td colSpan={8}>
                        <Text ta="center" c="dimmed" size="sm" py="xl">
                          {rawData.totals.fetched === 0 ? "No records found. Click Fetch Records." : "No records match the current filter."}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ) : (
                    filtered.map((rec) => (
                      <Table.Tr key={rec.idx}>
                        <Table.Td>
                          <Text size="xs" c="dimmed" ff="monospace">{rec.idx}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" ff="monospace">
                            {rec.start_time ? new Date(rec.start_time).toLocaleString() : "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" variant="light" color={rec.queue_name.toLowerCase().includes("mobility") ? "violet" : "blue"}>
                            {rec.queue_name.toLowerCase().includes("mobility") ? "Mobility" : "NOC"}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" ff="monospace" c="dimmed">{rec.call_result_raw}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            size="xs"
                            color={rec.classified_as === "answered" ? "green" : rec.classified_as === "refused" ? "red" : "orange"}
                            variant="light"
                          >
                            {rec.classified_as}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" fw={rec.answered_by_name.startsWith("—") ? 400 : 500} c={rec.answered_by_name.startsWith("—") ? "dimmed" : undefined}>
                            {rec.answered_by_name}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" ff="monospace">
                            {rec.duration_seconds > 0 ? formatSeconds(rec.duration_seconds) : "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" ff="monospace">
                            {rec.wait_seconds > 0 ? formatSeconds(rec.wait_seconds) : "—"}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))
                  )}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Card>
        </>
      )}

      {!rawData && !loading && !error && (
        <Card withBorder radius="md" p="xl">
          <Stack align="center" gap="sm">
            <IconTable size={32} color="var(--mantine-color-dimmed)" />
            <Text size="sm" c="dimmed" ta="center">
              Pick a month and click <b>Fetch Records</b> to load raw queue call data from Zoom API.
            </Text>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

// ── Compare tab ───────────────────────────────────────────────────────────────

function CompareTab() {
  const [data, setData]     = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [view, setView]     = useState<"total" | "monthly">("total");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/zoom/compare");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap="md" pt="md">
      <Group gap="sm">
        <Button
          leftSection={loading ? <Loader size={14} color="white" /> : <IconChartBar size={14} />}
          onClick={load}
          disabled={loading}
          color="green"
          size="sm"
        >
          {loading ? "Loading…" : data ? "Reload Comparison" : "Load Comparison"}
        </Button>
        {data && (
          <SegmentedControl
            value={view}
            onChange={(v) => setView(v as "total" | "monthly")}
            data={[{ value: "total", label: "Totals" }, { value: "monthly", label: "By Month" }]}
            size="xs"
            radius="md"
          />
        )}
      </Group>

      {error && (
        <Alert icon={<IconAlertTriangle size={16} />} color="red" radius="md">
          <Text size="xs">{error}</Text>
        </Alert>
      )}

      {data && (
        <>
          {/* Status badges */}
          <Group gap="xs" wrap="wrap">
            <Badge color={data.source_api === "live" ? "green" : "yellow"} variant="dot" size="sm">
              API: {data.source_api === "live" ? "Live Zoom Queue Logs" : "Snapshot"}
            </Badge>
            <Badge color="blue" variant="dot" size="sm">Excel: Supabase performance_metrics</Badge>
            {data.queues_found.map((q) => (
              <Badge key={q} size="xs" variant="outline" color="green">{q}</Badge>
            ))}
          </Group>

          {(data.zoom_warning || data.excel_warning) && (
            <Stack gap="xs">
              {data.zoom_warning  && <Alert icon={<IconAlertTriangle size={14} />} color="yellow" radius="md" p="sm"><Text size="xs">Zoom: {data.zoom_warning}</Text></Alert>}
              {data.excel_warning && <Alert icon={<IconAlertTriangle size={14} />} color="orange" radius="md" p="sm"><Text size="xs">Excel: {data.excel_warning}</Text></Alert>}
            </Stack>
          )}

          {/* Legend */}
          <Group gap="xl">
            <Group gap="xs"><Box style={{ width: 10, height: 10, borderRadius: 2, background: "var(--mantine-color-green-6)" }} /><Text size="xs" c="dimmed">Δ = 0</Text></Group>
            <Group gap="xs"><Box style={{ width: 10, height: 10, borderRadius: 2, background: "var(--mantine-color-yellow-6)" }} /><Text size="xs" c="dimmed">|Δ| ≤ 5</Text></Group>
            <Group gap="xs"><Box style={{ width: 10, height: 10, borderRadius: 2, background: "var(--mantine-color-orange-6)" }} /><Text size="xs" c="dimmed">|Δ| ≤ 20</Text></Group>
            <Group gap="xs"><Box style={{ width: 10, height: 10, borderRadius: 2, background: "var(--mantine-color-red-6)" }} /><Text size="xs" c="dimmed">|Δ| &gt; 20</Text></Group>
          </Group>

          <Card withBorder radius="md" p={0}>
            <ScrollArea>
              <Table fz="xs" horizontalSpacing="md" verticalSpacing="sm" striped highlightOnHover stickyHeader>
                <Table.Thead>
                  {view === "total" ? (
                    <Table.Tr>
                      <Table.Th>Agent</Table.Th>
                      <Table.Th ta="right">API (Zoom)</Table.Th>
                      <Table.Th ta="right">Excel</Table.Th>
                      <Table.Th ta="right">Δ (API − Excel)</Table.Th>
                    </Table.Tr>
                  ) : (
                    <Table.Tr>
                      <Table.Th>Agent</Table.Th>
                      {MONTHS.map((m) => (
                        <Table.Th key={m} ta="right" colSpan={3}>
                          <Text size="xs" fw={700}>{MONTH_SHORT[m]}</Text>
                        </Table.Th>
                      ))}
                    </Table.Tr>
                  )}
                  {view === "monthly" && (
                    <Table.Tr style={{ background: "var(--mantine-color-dark-7)" }}>
                      <Table.Th />
                      {MONTHS.map((m) => (
                        <>
                          <Table.Th key={`${m}-api`}   ta="right" style={{ color: "var(--mantine-color-green-4)", fontSize: 10 }}>API</Table.Th>
                          <Table.Th key={`${m}-excel`} ta="right" style={{ color: "var(--mantine-color-blue-4)",  fontSize: 10 }}>XL</Table.Th>
                          <Table.Th key={`${m}-delta`} ta="right" style={{ color: "var(--mantine-color-dimmed)", fontSize: 10 }}>Δ</Table.Th>
                        </>
                      ))}
                    </Table.Tr>
                  )}
                </Table.Thead>
                <Table.Tbody>
                  {/* Grand totals row */}
                  {view === "total" && (() => {
                    const grandApi   = Object.values(data.grand_totals).reduce((s, t) => s + t.api,   0);
                    const grandExcel = Object.values(data.grand_totals).reduce((s, t) => s + t.excel, 0);
                    const grandDelta = grandApi - grandExcel;
                    return (
                      <Table.Tr style={{ background: "var(--mantine-color-dark-6)", fontWeight: 700 }}>
                        <Table.Td><Text size="xs" fw={700}>TEAM TOTAL</Text></Table.Td>
                        <Table.Td ta="right"><Text size="xs" fw={700} ff="monospace" c="green.4">{grandApi.toLocaleString()}</Text></Table.Td>
                        <Table.Td ta="right"><Text size="xs" fw={700} ff="monospace" c="blue.4">{grandExcel.toLocaleString()}</Text></Table.Td>
                        <Table.Td ta="right">
                          <Badge size="sm" color={deltaColor(grandDelta)} variant="filled">
                            {grandDelta > 0 ? "+" : ""}{grandDelta}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })()}

                  {data.rows.map((row) => (
                    <Table.Tr key={row.agent}>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          <Text size="xs" fw={500}>{row.agent}</Text>
                          {tierFor(row.agent) && (
                            <Badge size="xs" variant="light" color={TIER_COLORS[tierFor(row.agent)!]} style={{ flexShrink: 0 }}>
                              {TIER_SHORT_LABELS[tierFor(row.agent)!]}
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                      {view === "total" ? (
                        <>
                          <Table.Td ta="right"><Text size="xs" fw={700} ff="monospace" c="green.4">{row.total_api}</Text></Table.Td>
                          <Table.Td ta="right"><Text size="xs" ff="monospace" c="blue.4">{row.total_excel}</Text></Table.Td>
                          <Table.Td ta="right">
                            <Badge size="xs" color={deltaColor(row.total_delta)} variant={row.total_delta === 0 ? "light" : "filled"}>
                              {row.total_delta > 0 ? "+" : ""}{row.total_delta}
                            </Badge>
                          </Table.Td>
                        </>
                      ) : (
                        MONTHS.map((m) => {
                          const cell = row.by_month[m] ?? { api: 0, excel: 0, delta: 0 };
                          return (
                            <>
                              <Table.Td key={`${m}-api`}   ta="right"><Text size="xs" ff="monospace" c="green.4">{cell.api   || "—"}</Text></Table.Td>
                              <Table.Td key={`${m}-excel`} ta="right"><Text size="xs" ff="monospace" c="blue.4" >{cell.excel || "—"}</Text></Table.Td>
                              <Table.Td key={`${m}-delta`} ta="right">
                                {cell.api === 0 && cell.excel === 0 ? (
                                  <Text size="xs" c="dimmed">—</Text>
                                ) : (
                                  <Text size="xs" ff="monospace" fw={600}
                                    c={cell.delta === 0 ? "green.4" : Math.abs(cell.delta) <= 5 ? "yellow.4" : Math.abs(cell.delta) <= 20 ? "orange.4" : "red.4"}>
                                    {cell.delta > 0 ? "+" : ""}{cell.delta}
                                  </Text>
                                )}
                              </Table.Td>
                            </>
                          );
                        })
                      )}
                    </Table.Tr>
                  ))}

                  {/* Monthly grand totals row */}
                  {view === "monthly" && (
                    <Table.Tr style={{ background: "var(--mantine-color-dark-6)" }}>
                      <Table.Td><Text size="xs" fw={700}>TOTAL</Text></Table.Td>
                      {MONTHS.map((m) => {
                        const t = data.grand_totals[m] ?? { api: 0, excel: 0, delta: 0 };
                        return (
                          <>
                            <Table.Td key={`${m}-api`}   ta="right"><Text size="xs" fw={700} ff="monospace" c="green.4">{t.api}</Text></Table.Td>
                            <Table.Td key={`${m}-excel`} ta="right"><Text size="xs" fw={700} ff="monospace" c="blue.4">{t.excel}</Text></Table.Td>
                            <Table.Td key={`${m}-delta`} ta="right">
                              <Badge size="xs" color={deltaColor(t.delta)} variant="filled">
                                {t.delta > 0 ? "+" : ""}{t.delta}
                              </Badge>
                            </Table.Td>
                          </>
                        );
                      })}
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Card>
        </>
      )}

      {!data && !loading && !error && (
        <Card withBorder radius="md" p="xl">
          <Stack align="center" gap="sm">
            <IconDatabase size={32} color="var(--mantine-color-dimmed)" />
            <Text size="sm" c="dimmed" ta="center">
              Click <b>Load Comparison</b> to fetch both Zoom API and Excel data side by side.
            </Text>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function ZoomCallMetricsWidget() {
  const [data, setData]       = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/zoom/call-logs-range");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <WidgetFrame
      title="Zoom Inbound Call Metrics"
      subtitle="Jan – Apr 2026 · Network & Mobility Tech Support"
      icon={IconPhone}
      iconColor="green"
      loading={loading}
      onRefresh={load}
    >
      <Stack gap="md">
        {/* Source badge */}
        {data && (
          <Group gap="xs" wrap="wrap">
            <Badge color={data.source === "live" ? "green" : "yellow"} variant="dot" size="sm">
              {data.source === "live" ? "LIVE — Zoom Queue Call Logs" : "SNAPSHOT MODE"}
            </Badge>
            {data.source === "live" && data.queues_found.length > 0 && (
              <Text size="xs" c="dimmed">Queues: {data.queues_found.join(", ")}</Text>
            )}
            {data.source === "live" && (
              <Text size="xs" c="dimmed">Fetched {new Date(data.fetched_at).toLocaleString()}</Text>
            )}
          </Group>
        )}

        {data?.warning && (
          <Alert icon={<IconAlertTriangle size={16} />} color="yellow" radius="md" p="sm">
            <Text size="xs">{data.warning}</Text>
          </Alert>
        )}

        {error && (
          <Alert icon={<IconAlertTriangle size={16} />} color="red" radius="md" p="sm">
            <Text size="xs">{error}</Text>
          </Alert>
        )}

        {/* Tabs */}
        <Tabs defaultValue="overview" variant="default" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="overview"    leftSection={<IconPhone size={14} />}>Overview</Tabs.Tab>
            <Tabs.Tab value="raw"         leftSection={<IconTable size={14} />}>Raw Records</Tabs.Tab>
            <Tabs.Tab value="compare"     leftSection={<IconChartBar size={14} />}>Compare vs Excel</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="overview">
            {data ? (
              <OverviewTab data={data} />
            ) : !loading && !error ? (
              <Text size="sm" c="dimmed" ta="center" pt="xl">Loading overview data…</Text>
            ) : null}
          </Tabs.Panel>

          <Tabs.Panel value="raw">
            <RawRecordsTab />
          </Tabs.Panel>

          <Tabs.Panel value="compare">
            <CompareTab />
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </WidgetFrame>
  );
}

export { ZoomCallMetricsTile } from "./Tile";
