/**
 * ZoomCallMetrics — TEST widget
 *
 * Three tabs:
 *   1. Overview    — team KPI cards + per-agent bar chart
 *   2. Raw Records — every individual call record with full field visibility
 *   3. Compare vs Excel — side-by-side API vs Excel import per agent per month
 */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Card,
  Code,
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
  IconSearch,
  IconTable,
  IconX,
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
  source: "live" | "snapshot";
  fetched_at: string;
  from: string; to: string;
  months: string[];
  agents: AgentData[];
  warning: string | null;
}

interface RawRecord {
  idx: number;
  start_time: string;
  agent_name: string;
  direction: string;
  call_queue_name: string;
  call_result_raw: string;
  classified_as: "answered" | "refused" | "missed" | "excluded_queue" | "excluded_direction";
  included: boolean;
  duration_seconds: number;
  wait_seconds: number;
}

interface RawResponse {
  source: string;
  month: string;
  records: RawRecord[];
  totals: {
    fetched: number;
    answered: number; refused: number; missed: number;
    excluded_queue: number; excluded_direction: number;
  };
  queue_names_seen: string[];
  capped?: boolean;
  warning?: string;
}

interface CompareMonthCell {
  api: { answered: number; refused: number; missed: number } | null;
  excel: { answered: number; refused: number; missed: number } | null;
  delta_answered: number | null;
}

interface CompareRow {
  agent: string;
  by_month: Record<string, CompareMonthCell>;
  total: { api_answered: number; excel_answered: number; delta: number };
}

interface CompareResponse {
  source_api: "live" | "unavailable";
  api_warning: string | null;
  months: string[];
  excel_rows_loaded: number;
  rows: CompareRow[];
  grand_total: { api_answered: number; excel_answered: number; delta: number };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04"];
const MONTH_LABELS: Record<string, string> = {
  "2026-01": "January", "2026-02": "February",
  "2026-03": "March",   "2026-04": "April",
};
const MONTH_SHORT: Record<string, string> = {
  "2026-01": "Jan", "2026-02": "Feb",
  "2026-03": "Mar", "2026-04": "Apr",
};

const CLASS_COLORS: Record<string, string> = {
  answered:            "green",
  refused:             "red",
  missed:              "orange",
  excluded_queue:      "gray",
  excluded_direction:  "gray",
};
const CLASS_LABELS: Record<string, string> = {
  answered:            "Answered",
  refused:             "Refused",
  missed:              "Missed",
  excluded_queue:      "Excl. Queue",
  excluded_direction:  "Excl. Direction",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

function emptyStats(): MonthStats {
  return { answered: 0, refused: 0, missed: 0, handle_seconds_sum: 0, handle_count: 0, wait_seconds_sum: 0, wait_count: 0 };
}
function addStats(a: MonthStats, b: MonthStats): MonthStats {
  return {
    answered: a.answered + b.answered, refused: a.refused + b.refused, missed: a.missed + b.missed,
    handle_seconds_sum: a.handle_seconds_sum + b.handle_seconds_sum, handle_count: a.handle_count + b.handle_count,
    wait_seconds_sum: a.wait_seconds_sum + b.wait_seconds_sum, wait_count: a.wait_count + b.wait_count,
  };
}
function avgHandle(s: MonthStats) { return s.handle_count > 0 ? s.handle_seconds_sum / s.handle_count : null; }
function avgWait(s: MonthStats)   { return s.wait_count   > 0 ? s.wait_seconds_sum   / s.wait_count   : null; }

function deltaColor(d: number): string {
  const abs = Math.abs(d);
  if (abs === 0) return "green";
  if (abs <= 5)  return "teal";
  if (abs <= 20) return "yellow";
  return "red";
}

function formatDateTime(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso.slice(0, 16); }
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

function AgentMonthTable({ agent, months }: { agent: AgentData; months: string[] }) {
  return (
    <Box style={{ background: "var(--mantine-color-dark-7)", borderRadius: 8, padding: "10px 12px", margin: "4px 0 8px 22px" }}>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb="xs">Monthly Breakdown</Text>
      <ScrollArea>
        <Table fz="xs" horizontalSpacing="sm" verticalSpacing={3}>
          <Table.Thead>
            <Table.Tr>
              {["Month","Answered","Refused","Missed","Avg Handle","Avg Wait"].map((h) => (
                <Table.Th key={h} style={{ color: "var(--mantine-color-dimmed)" }}>{h}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {months.map((m) => {
              const s = agent.by_month[m] ?? emptyStats();
              const ah = avgHandle(s), aw = avgWait(s);
              return (
                <Table.Tr key={m}>
                  <Table.Td fw={600}>{MONTH_LABELS[m] ?? m}</Table.Td>
                  <Table.Td><Text size="xs" fw={700} ff="monospace" c={s.answered > 0 ? "green.4" : "dimmed"}>{s.answered}</Text></Table.Td>
                  <Table.Td><Text size="xs" ff="monospace" c={s.refused  > 0 ? "red.4"   : "dimmed"}>{s.refused}</Text></Table.Td>
                  <Table.Td><Text size="xs" ff="monospace" c={s.missed   > 0 ? "orange.4": "dimmed"}>{s.missed}</Text></Table.Td>
                  <Table.Td><Text size="xs" ff="monospace">{ah != null ? fmt(ah) : "—"}</Text></Table.Td>
                  <Table.Td><Text size="xs" ff="monospace">{aw != null ? fmt(aw) : "—"}</Text></Table.Td>
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
  const [period, setPeriod] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const segData = [
    { value: "all", label: "All" },
    ...data.months.map((m) => ({ value: m, label: MONTH_SHORT[m] ?? m })),
  ];

  const agentRows = useMemo(() => {
    const months = period === "all" ? data.months : [period];
    return data.agents
      .map((ag) => ({
        name: ag.name,
        total: months.reduce((acc, m) => addStats(acc, ag.by_month[m] ?? emptyStats()), emptyStats()),
        by_month: ag.by_month,
      }))
      .filter((r) => r.total.answered + r.total.refused + r.total.missed > 0)
      .sort((a, b) => b.total.answered - a.total.answered);
  }, [data, period]);

  const teamTotal = useMemo(() => agentRows.reduce((a, r) => addStats(a, r.total), emptyStats()), [agentRows]);
  const teamAvgHandle = avgHandle(teamTotal);
  const teamAvgWait   = avgWait(teamTotal);
  const maxAnswered   = agentRows.length > 0 ? Math.max(...agentRows.map((r) => r.total.answered)) : 0;

  return (
    <Stack gap="md" pt="md">
      <SegmentedControl
        value={period}
        onChange={(v) => { setPeriod(v); setExpanded(null); }}
        data={segData}
        size="xs"
        radius="md"
      />

      {/* KPI summary */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <KpiCard label="Answered" value={teamTotal.answered.toLocaleString()} sub="queue calls picked up" color="green" icon={<IconPhoneIncoming size={12} />} />
        <KpiCard label="Refused"  value={teamTotal.refused.toLocaleString()}  sub="no answer / by other"  color="red"   icon={<IconPhoneX size={12} />} />
        <KpiCard label="Missed"   value={teamTotal.missed.toLocaleString()}    sub="voicemail / abandoned" color="orange" />
        <KpiCard label="Avg Handle Time" value={teamAvgHandle != null ? fmt(teamAvgHandle) : "—"} sub="from Duration" color="teal" />
      </SimpleGrid>

      {teamAvgWait != null && (
        <Card withBorder radius="md" p="md" style={{ borderTop: "2px solid var(--mantine-color-cyan-6)" }}>
          <Group gap="md">
            <ThemeIcon radius="md" variant="light" color="cyan" size="lg"><IconPhone size={18} /></ThemeIcon>
            <Box>
              <Text size="xl" fw={700} ff="monospace" c="cyan.4">{fmt(teamAvgWait)}</Text>
              <Text size="xs" fw={600}>Avg Speed of Answer</Text>
              <Text size="xs" c="dimmed">from Wait Time · Zoom Phone Premium</Text>
            </Box>
          </Group>
        </Card>
      )}

      {/* Per-agent bar chart */}
      <Card withBorder radius="md" p="md" style={{ borderTop: "2px solid var(--mantine-color-green-6)" }}>
        <Group gap="sm" wrap="nowrap" mb="md">
          <ThemeIcon radius="md" variant="light" color="green" size="lg"><IconPhoneIncoming size={20} /></ThemeIcon>
          <Box style={{ flex: 1 }}>
            <Title order={5} style={{ lineHeight: 1.2 }}>Inbound Calls — Per Agent</Title>
            <Text size="xs" c="dimmed">{agentRows.length} contributors · click a row to expand months</Text>
          </Box>
          <Group gap="xl" visibleFrom="sm">
            {[["Answered", teamTotal.answered.toLocaleString(), "green"], ["Refused", teamTotal.refused.toLocaleString(), "red"]].map(([l, v, c]) => (
              <Box key={l}><Text size="xs" c="dimmed" tt="uppercase" fw={600}>{l}</Text><Text size="md" fw={700} ff="monospace" c={`${c}.4`}>{v}</Text></Box>
            ))}
          </Group>
        </Group>
        <Stack gap={2}>
          {agentRows.map((row) => {
            const tier = tierFor(row.name);
            const bar  = maxAnswered > 0 ? (row.total.answered / maxAnswered) * 100 : 0;
            const pct  = teamTotal.answered > 0 ? Math.round((row.total.answered / teamTotal.answered) * 100) : 0;
            const isExpanded = expanded === row.name;
            const ah = avgHandle(row.total);
            const aw = avgWait(row.total);
            return (
              <Box key={row.name}>
                <Group gap="sm" wrap="nowrap" py={4} px={6}
                  style={{ cursor: "pointer", borderRadius: 6, background: isExpanded ? "var(--mantine-color-dark-6)" : "transparent" }}
                  onClick={() => setExpanded(isExpanded ? null : row.name)}
                >
                  <Box style={{ width: 14, flexShrink: 0 }}>
                    {isExpanded ? <IconChevronDown size={12} color="var(--mantine-color-dimmed)" /> : <IconChevronRight size={12} color="var(--mantine-color-dimmed)" />}
                  </Box>
                  <Box style={{ width: 148, flexShrink: 0 }}>
                    <Group gap={4} wrap="nowrap">
                      <Text size="xs" truncate fw={500}>{row.name}</Text>
                      {tier && <Badge size="xs" variant="light" color={TIER_COLORS[tier]} style={{ flexShrink: 0 }}>{TIER_SHORT_LABELS[tier]}</Badge>}
                    </Group>
                  </Box>
                  <Tooltip withinPortal label={<><div>Answered: {row.total.answered.toLocaleString()} ({pct}% of team)</div><div>Refused: {row.total.refused}</div><div>Missed: {row.total.missed}</div><div>Avg Handle: {ah != null ? fmt(ah) : "—"}</div>{aw != null && <div>Avg Wait: {fmt(aw)}</div>}</>}>
                    <Box style={{ flex: 1 }}><Progress value={bar} color="green" size="md" radius="sm" /></Box>
                  </Tooltip>
                  <Box style={{ width: 36, textAlign: "right", flexShrink: 0 }}>
                    <Text size="xs" ff="monospace" fw={600} c="dimmed">{pct}%</Text>
                  </Box>
                  <Box style={{ width: 80, textAlign: "right", flexShrink: 0 }}>
                    <Text size="xs" ff="monospace" fw={700} c="green.4">{row.total.answered.toLocaleString()}</Text>
                    <Text size="xs" ff="monospace" c={row.total.refused > 0 ? "red.4" : "dimmed"}>{row.total.refused} refused</Text>
                  </Box>
                </Group>
                {isExpanded && <AgentMonthTable agent={{ name: row.name, by_month: row.by_month }} months={data.months} />}
              </Box>
            );
          })}
        </Stack>
      </Card>
    </Stack>
  );
}

// ── Raw Records tab ───────────────────────────────────────────────────────────

function RawRecordsTab() {
  const [month, setMonth] = useState("2026-01");
  const [agentFilter, setAgentFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [classFilter, setClassFilter] = useState<string>("all");
  const [rawData, setRawData] = useState<RawResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchRaw() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ month });
      if (agentFilter.trim()) params.set("agent", agentFilter.trim());
      if (showAll) params.set("show_all", "true");
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
            size="sm"
            style={{ width: 160 }}
          />
          <TextInput
            label="Agent name filter"
            placeholder="e.g. Sriram"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.currentTarget.value)}
            leftSection={<IconSearch size={14} />}
            size="sm"
            style={{ flex: 1, minWidth: 140 }}
          />
          <Box>
            <Text size="xs" c="dimmed" mb={4}>Include excluded calls</Text>
            <SegmentedControl
              value={showAll ? "yes" : "no"}
              onChange={(v) => setShowAll(v === "yes")}
              data={[{ value: "no", label: "Queue only" }, { value: "yes", label: "All calls" }]}
              size="xs"
            />
          </Box>
          <Box pt={18}>
            <button
              onClick={fetchRaw}
              disabled={loading}
              style={{
                padding: "6px 16px", borderRadius: 6, border: "1px solid var(--mantine-color-green-6)",
                background: "var(--mantine-color-green-9)", color: "var(--mantine-color-green-2)",
                cursor: loading ? "wait" : "pointer", fontSize: 13, fontWeight: 600,
              }}
            >
              {loading ? "Loading…" : "Fetch Records"}
            </button>
          </Box>
        </Group>
      </Card>

      {error && (
        <Alert icon={<IconAlertTriangle size={16} />} color="red" radius="md">
          {error}
        </Alert>
      )}

      {loading && (
        <Group justify="center" py="xl"><Loader size="md" color="green" /></Group>
      )}

      {rawData && !loading && (
        <>
          {/* Stats summary */}
          <SimpleGrid cols={{ base: 3, sm: 6 }} spacing="xs">
            {[
              { label: "Fetched",     value: rawData.totals.fetched,            color: "dimmed" },
              { label: "Answered",    value: rawData.totals.answered,           color: "green"  },
              { label: "Refused",     value: rawData.totals.refused,            color: "red"    },
              { label: "Missed",      value: rawData.totals.missed,             color: "orange" },
              { label: "Excl. Queue", value: rawData.totals.excluded_queue,     color: "gray"   },
              { label: "Excl. Dir.",  value: rawData.totals.excluded_direction, color: "gray"   },
            ].map(({ label, value, color }) => (
              <Card key={label} withBorder radius="md" p="xs">
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
                <Text size="lg" fw={700} ff="monospace" c={color !== "dimmed" && color !== "gray" ? `${color}.4` : "dimmed"}>{value}</Text>
              </Card>
            ))}
          </SimpleGrid>

          {/* Queue names seen */}
          {rawData.queue_names_seen.length > 0 && (
            <Card withBorder radius="md" p="sm">
              <Text size="xs" fw={600} c="dimmed" mb={6}>Queue names seen in API response ({rawData.queue_names_seen.length}):</Text>
              <Group gap="xs" wrap="wrap">
                {rawData.queue_names_seen.map((q) => {
                  const isTarget = q.toLowerCase().includes("network tech support") || q.toLowerCase().includes("mobility tech support");
                  return (
                    <Badge key={q} size="sm" variant="light" color={isTarget ? "green" : "gray"}
                      leftSection={isTarget ? <IconCheck size={10} /> : <IconX size={10} />}>
                      {q}
                    </Badge>
                  );
                })}
              </Group>
              <Text size="xs" c="dimmed" mt={6}>
                ✅ Green = counted &nbsp;|&nbsp; ⬜ Gray = excluded by queue filter
              </Text>
            </Card>
          )}

          {rawData.capped && (
            <Alert icon={<IconAlertTriangle size={14} />} color="yellow" p="sm">
              Results capped at 3,000 records. Use the agent filter to narrow down.
            </Alert>
          )}

          {/* Classification filter */}
          <SegmentedControl
            value={classFilter}
            onChange={setClassFilter}
            size="xs"
            data={[
              { value: "all",                 label: `All (${rawData.records.length})` },
              { value: "answered",            label: `✅ Answered (${rawData.totals.answered})` },
              { value: "refused",             label: `🔴 Refused (${rawData.totals.refused})` },
              { value: "missed",              label: `🟠 Missed (${rawData.totals.missed})` },
              { value: "excluded_queue",      label: `⬜ Excl. Queue (${rawData.totals.excluded_queue})` },
              { value: "excluded_direction",  label: `⬜ Excl. Dir. (${rawData.totals.excluded_direction})` },
            ]}
          />

          {/* Records table */}
          <Card withBorder radius="md" p={0}>
            <ScrollArea h={500}>
              <Table fz="xs" verticalSpacing={4} horizontalSpacing="sm" highlightOnHover withColumnBorders={false}>
                <Table.Thead style={{ position: "sticky", top: 0, background: "var(--mantine-color-dark-7)", zIndex: 1 }}>
                  <Table.Tr>
                    <Table.Th style={{ color: "var(--mantine-color-dimmed)" }}>#</Table.Th>
                    <Table.Th style={{ color: "var(--mantine-color-dimmed)" }}>Time</Table.Th>
                    <Table.Th style={{ color: "var(--mantine-color-dimmed)" }}>Agent</Table.Th>
                    <Table.Th style={{ color: "var(--mantine-color-dimmed)" }}>Queue Name (raw)</Table.Th>
                    <Table.Th style={{ color: "var(--mantine-color-dimmed)" }}>Call Result (raw)</Table.Th>
                    <Table.Th style={{ color: "var(--mantine-color-dimmed)" }}>Classified As</Table.Th>
                    <Table.Th style={{ color: "var(--mantine-color-dimmed)" }}>Duration</Table.Th>
                    <Table.Th style={{ color: "var(--mantine-color-dimmed)" }}>Wait</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filtered.length === 0 ? (
                    <Table.Tr>
                      <Table.Td colSpan={8}>
                        <Text size="xs" c="dimmed" ta="center" py="md">No records match the current filter.</Text>
                      </Table.Td>
                    </Table.Tr>
                  ) : filtered.map((rec) => {
                    const rowBg =
                      rec.classified_as === "answered"           ? "rgba(74,222,128,0.04)" :
                      rec.classified_as === "refused"            ? "rgba(248,113,113,0.05)" :
                      rec.classified_as === "missed"             ? "rgba(251,146,60,0.05)"  :
                      "transparent";
                    return (
                      <Table.Tr key={rec.idx} style={{ background: rowBg }}>
                        <Table.Td><Text size="xs" c="dimmed" ff="monospace">{rec.idx}</Text></Table.Td>
                        <Table.Td>
                          <Text size="xs" ff="monospace" style={{ whiteSpace: "nowrap" }}>
                            {formatDateTime(rec.start_time)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" fw={500} style={{ whiteSpace: "nowrap" }}>{rec.agent_name}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Tooltip label={rec.call_queue_name} withinPortal>
                            <Text size="xs" truncate style={{ maxWidth: 200 }}
                              c={rec.classified_as === "excluded_queue" ? "dimmed" : "inherit"}>
                              {rec.call_queue_name || <Text component="span" c="red" size="xs">(blank)</Text>}
                            </Text>
                          </Tooltip>
                        </Table.Td>
                        <Table.Td>
                          <Code style={{ fontSize: 11 }}>{rec.call_result_raw}</Code>
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" variant="light" color={CLASS_COLORS[rec.classified_as] ?? "gray"}>
                            {CLASS_LABELS[rec.classified_as] ?? rec.classified_as}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" ff="monospace">{rec.duration_seconds > 0 ? fmt(rec.duration_seconds) : "—"}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" ff="monospace">{rec.wait_seconds > 0 ? fmt(rec.wait_seconds) : "—"}</Text>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Card>
          <Text size="xs" c="dimmed" ta="right">Showing {filtered.length.toLocaleString()} of {rawData.records.length.toLocaleString()} records</Text>
        </>
      )}

      {!rawData && !loading && (
        <Card withBorder radius="md" p="xl">
          <Stack align="center" gap="sm">
            <IconTable size={36} color="var(--mantine-color-dimmed)" />
            <Text size="sm" c="dimmed" ta="center">
              Pick a month and click <b>Fetch Records</b> to load raw call data from Zoom API.
              <br />Each row shows the exact field values returned by Zoom before any processing.
            </Text>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

// ── Compare vs Excel tab ──────────────────────────────────────────────────────

function CompareTab() {
  const [compareData, setCompareData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"total" | "monthly">("total");

  async function fetchCompare() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/zoom/compare");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setCompareData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap="md" pt="md">
      <Group justify="space-between" wrap="wrap">
        <Box>
          <Text size="sm" fw={600}>API vs Excel Import — Answered Calls</Text>
          <Text size="xs" c="dimmed">Jan – Apr 2026 · Network Tech Support + Mobility Tech Support</Text>
        </Box>
        <Group gap="sm">
          <SegmentedControl
            value={viewMode}
            onChange={(v) => setViewMode(v as any)}
            data={[{ value: "total", label: "Totals" }, { value: "monthly", label: "By Month" }]}
            size="xs"
          />
          <button
            onClick={fetchCompare}
            disabled={loading}
            style={{
              padding: "6px 16px", borderRadius: 6, border: "1px solid var(--mantine-color-blue-6)",
              background: "var(--mantine-color-blue-9)", color: "var(--mantine-color-blue-2)",
              cursor: loading ? "wait" : "pointer", fontSize: 13, fontWeight: 600,
            }}
          >
            {loading ? "Loading…" : compareData ? "Refresh" : "Load Comparison"}
          </button>
        </Group>
      </Group>

      {error && <Alert icon={<IconAlertTriangle size={16} />} color="red" radius="md">{error}</Alert>}
      {loading && <Group justify="center" py="xl"><Loader size="md" color="blue" /></Group>}

      {!compareData && !loading && (
        <Card withBorder radius="md" p="xl">
          <Stack align="center" gap="sm">
            <IconDatabase size={36} color="var(--mantine-color-dimmed)" />
            <Text size="sm" c="dimmed" ta="center">
              Click <b>Load Comparison</b> to fetch both Zoom API data and the Excel-imported data from Supabase side by side.
            </Text>
          </Stack>
        </Card>
      )}

      {compareData && !loading && (
        <>
          {/* Legend */}
          <Group gap="md" wrap="wrap">
            <Group gap={6}><Box style={{ width: 12, height: 12, borderRadius: 2, background: "var(--mantine-color-green-6)" }} /><Text size="xs">API (Zoom)</Text></Group>
            <Group gap={6}><Box style={{ width: 12, height: 12, borderRadius: 2, background: "var(--mantine-color-blue-6)" }} /><Text size="xs">Excel (imported)</Text></Group>
            <Group gap={6}><Box style={{ width: 12, height: 12, borderRadius: 2, background: "var(--mantine-color-red-8)" }} /><Text size="xs">Delta &gt; 20</Text></Group>
            <Group gap={6}><Box style={{ width: 12, height: 12, borderRadius: 2, background: "var(--mantine-color-yellow-8)" }} /><Text size="xs">Delta 6–20</Text></Group>
            <Group gap={6}><Box style={{ width: 12, height: 12, borderRadius: 2, background: "var(--mantine-color-teal-8)" }} /><Text size="xs">Delta 1–5</Text></Group>
            <Group gap={6}><Box style={{ width: 12, height: 12, borderRadius: 2, background: "var(--mantine-color-green-8)" }} /><Text size="xs">Match</Text></Group>
          </Group>

          {compareData.api_warning && (
            <Alert icon={<IconAlertTriangle size={14} />} color="yellow" p="sm">
              Zoom API: {compareData.api_warning}
            </Alert>
          )}

          {/* Grand total */}
          <SimpleGrid cols={{ base: 3 }} spacing="sm">
            <Card withBorder radius="md" p="md" style={{ borderTop: "2px solid var(--mantine-color-green-6)" }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Total — API</Text>
              <Text size="xl" fw={700} ff="monospace" c="green.4">{compareData.grand_total.api_answered.toLocaleString()}</Text>
            </Card>
            <Card withBorder radius="md" p="md" style={{ borderTop: "2px solid var(--mantine-color-blue-6)" }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Total — Excel</Text>
              <Text size="xl" fw={700} ff="monospace" c="blue.4">{compareData.grand_total.excel_answered.toLocaleString()}</Text>
            </Card>
            <Card withBorder radius="md" p="md" style={{ borderTop: `2px solid var(--mantine-color-${deltaColor(compareData.grand_total.delta)}-6)` }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Δ Difference</Text>
              <Text size="xl" fw={700} ff="monospace" c={`${deltaColor(compareData.grand_total.delta)}.4`}>
                {compareData.grand_total.delta > 0 ? "+" : ""}{compareData.grand_total.delta.toLocaleString()}
              </Text>
              <Text size="xs" c="dimmed">{compareData.excel_rows_loaded.toLocaleString()} Excel rows loaded</Text>
            </Card>
          </SimpleGrid>

          {/* Per-agent table */}
          <Card withBorder radius="md" p={0}>
            <ScrollArea>
              <Table fz="xs" verticalSpacing={5} horizontalSpacing="sm" highlightOnHover>
                <Table.Thead style={{ background: "var(--mantine-color-dark-7)" }}>
                  <Table.Tr>
                    <Table.Th>Agent</Table.Th>
                    {viewMode === "monthly"
                      ? MONTHS.flatMap((m) => [
                          <Table.Th key={`${m}-api`} ta="right" style={{ color: "var(--mantine-color-green-5)" }}>{MONTH_SHORT[m]} API</Table.Th>,
                          <Table.Th key={`${m}-xl`}  ta="right" style={{ color: "var(--mantine-color-blue-5)"  }}>{MONTH_SHORT[m]} Excel</Table.Th>,
                          <Table.Th key={`${m}-d`}   ta="right">Δ</Table.Th>,
                        ])
                      : [
                          <Table.Th key="api-tot"   ta="right" style={{ color: "var(--mantine-color-green-5)" }}>API</Table.Th>,
                          <Table.Th key="excel-tot" ta="right" style={{ color: "var(--mantine-color-blue-5)"  }}>Excel</Table.Th>,
                          <Table.Th key="delta-tot" ta="right">Δ</Table.Th>,
                        ]
                    }
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {compareData.rows.map((row) => {
                    const tier = tierFor(row.agent);
                    return (
                      <Table.Tr key={row.agent}>
                        <Table.Td>
                          <Group gap={4} wrap="nowrap">
                            <Text size="xs" fw={500} style={{ whiteSpace: "nowrap" }}>{row.agent}</Text>
                            {tier && <Badge size="xs" variant="light" color={TIER_COLORS[tier]}>{TIER_SHORT_LABELS[tier]}</Badge>}
                          </Group>
                        </Table.Td>
                        {viewMode === "monthly"
                          ? MONTHS.flatMap((m) => {
                              const cell = row.by_month[m];
                              const d = cell?.delta_answered ?? null;
                              return [
                                <Table.Td key={`${m}-api`} ta="right"><Text size="xs" ff="monospace" c="green.4">{cell?.api?.answered ?? "—"}</Text></Table.Td>,
                                <Table.Td key={`${m}-xl`}  ta="right"><Text size="xs" ff="monospace" c="blue.4">{cell?.excel?.answered ?? "—"}</Text></Table.Td>,
                                <Table.Td key={`${m}-d`}   ta="right">
                                  {d !== null
                                    ? <Badge size="xs" variant="light" color={deltaColor(d)}>{d > 0 ? "+" : ""}{d}</Badge>
                                    : <Text size="xs" c="dimmed">—</Text>
                                  }
                                </Table.Td>,
                              ];
                            })
                          : [
                              <Table.Td key="api"   ta="right"><Text size="xs" ff="monospace" fw={700} c="green.4">{row.total.api_answered.toLocaleString()}</Text></Table.Td>,
                              <Table.Td key="excel" ta="right"><Text size="xs" ff="monospace" fw={700} c="blue.4">{row.total.excel_answered.toLocaleString()}</Text></Table.Td>,
                              <Table.Td key="delta" ta="right">
                                <Badge size="sm" variant="light" color={deltaColor(row.total.delta)}>
                                  {row.total.delta > 0 ? "+" : ""}{row.total.delta.toLocaleString()}
                                </Badge>
                              </Table.Td>,
                            ]
                        }
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Card>
          <Text size="xs" c="dimmed">
            Δ = API answered − Excel answered. Positive = API counted more. Negative = Excel counted more.
            Excel data from performance_metrics where source_type='calls'.
          </Text>
        </>
      )}
    </Stack>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function ZoomCallMetricsWidget() {
  const [data, setData]       = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>("overview");

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
      status={data ? {
        label: data.source === "live" ? "Live — Zoom API" : "Snapshot",
        color: data.source === "live" ? "green" : "yellow",
        tooltip: data.source === "live" ? "Live data from Zoom Phone API" : "Showing demo snapshot data",
      } : undefined}
    >
      <Stack gap="md">
        {/* Always-visible: source badge + warnings */}
        {data && (
          <Group gap="xs" wrap="wrap">
            <Badge color={data.source === "live" ? "green" : "yellow"} variant="dot" size="sm">
              {data.source === "live" ? "Live — Zoom Phone API" : "Snapshot mode"}
            </Badge>
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
          <Card withBorder radius="md" p="md" style={{ borderColor: "var(--mantine-color-red-6)" }}>
            <Text c="red" size="sm">{error}</Text>
          </Card>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onChange={setActiveTab} variant="default" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="overview" leftSection={<IconChartBar size={14} />}>Overview</Tabs.Tab>
            <Tabs.Tab value="raw"      leftSection={<IconTable size={14} />}>Raw Records</Tabs.Tab>
            <Tabs.Tab value="compare"  leftSection={<IconDatabase size={14} />}>Compare vs Excel</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="overview">
            {data
              ? <OverviewTab data={data} />
              : !loading && <Card withBorder radius="md" p="xl"><Stack align="center"><IconPhoneOff size={36} color="var(--mantine-color-dimmed)" /><Text size="sm" c="dimmed">No data loaded yet.</Text></Stack></Card>
            }
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
