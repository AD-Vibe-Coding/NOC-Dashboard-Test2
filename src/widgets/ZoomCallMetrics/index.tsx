/**
 * ZoomCallMetrics — TEST widget
 *
 * Pulls inbound call data directly from the Zoom Phone API for Jan 1 – Apr 30
 * 2026. Mirrors the Performance Tracker's CallsKpiCard + MemberCallCard design.
 *
 * Falls back to a realistic snapshot when credentials are absent.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Card,
  Grid,
  Group,
  Progress,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconPhone,
  IconPhoneIncoming,
  IconPhoneOff,
  IconPhoneX,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import {
  TIER_COLORS,
  TIER_SHORT_LABELS,
  tierFor,
} from "../PerformanceTracker/team";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonthStats {
  answered: number;
  refused:  number;
  missed:   number;
  handle_seconds_sum: number;
  handle_count:       number;
  wait_seconds_sum:   number;
  wait_count:         number;
}

interface AgentData {
  name: string;
  by_month: Record<string, MonthStats>;
}

interface ApiResponse {
  source:     "live" | "snapshot";
  fetched_at: string;
  from:       string;
  to:         string;
  months:     string[];
  agents:     AgentData[];
  warning:    string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_LABELS: Record<string, string> = {
  "2026-01": "January",
  "2026-02": "February",
  "2026-03": "March",
  "2026-04": "April",
};

const MONTH_SHORT: Record<string, string> = {
  "2026-01": "Jan",
  "2026-02": "Feb",
  "2026-03": "Mar",
  "2026-04": "Apr",
};

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
    answered:           a.answered           + b.answered,
    refused:            a.refused            + b.refused,
    missed:             a.missed             + b.missed,
    handle_seconds_sum: a.handle_seconds_sum + b.handle_seconds_sum,
    handle_count:       a.handle_count       + b.handle_count,
    wait_seconds_sum:   a.wait_seconds_sum   + b.wait_seconds_sum,
    wait_count:         a.wait_count         + b.wait_count,
  };
}

function avgHandle(s: MonthStats): number | null {
  return s.handle_count > 0 ? s.handle_seconds_sum / s.handle_count : null;
}

function avgWait(s: MonthStats): number | null {
  return s.wait_count > 0 ? s.wait_seconds_sum / s.wait_count : null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  color,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  icon?: React.ReactNode;
}) {
  return (
    <Card
      withBorder
      radius="md"
      p="md"
      style={{ borderTop: `2px solid var(--mantine-color-${color}-6)` }}
    >
      <Group gap={6} mb={4}>
        {icon && (
          <ThemeIcon size="xs" variant="transparent" color={color}>
            {icon}
          </ThemeIcon>
        )}
        <Text size="xs" fw={600} tt="uppercase" c="dimmed">
          {label}
        </Text>
      </Group>
      <Text size="xl" fw={700} ff="monospace" c={`${color}.4`}>
        {value}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed" mt={2}>
          {sub}
        </Text>
      )}
    </Card>
  );
}

function MiniKpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={1}>
        {label}
      </Text>
      <Text size="md" fw={700} ff="monospace" c={color ? `${color}.4` : undefined}>
        {value}
      </Text>
    </Box>
  );
}

// Monthly breakdown table shown when an agent row is expanded
function AgentMonthTable({
  agent,
  months,
}: {
  agent: AgentData;
  months: string[];
}) {
  return (
    <Box
      style={{
        background: "var(--mantine-color-dark-7)",
        borderRadius: 8,
        padding: "10px 12px",
        marginTop: 4,
        marginBottom: 8,
        marginLeft: 168,
      }}
    >
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb="xs">
        Monthly Breakdown
      </Text>
      <ScrollArea>
        <Table fz="xs" horizontalSpacing="sm" verticalSpacing={3} withColumnBorders={false}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ color: "var(--mantine-color-dimmed)" }}>Month</Table.Th>
              <Table.Th style={{ color: "var(--mantine-color-dimmed)" }}>Answered</Table.Th>
              <Table.Th style={{ color: "var(--mantine-color-dimmed)" }}>Refused</Table.Th>
              <Table.Th style={{ color: "var(--mantine-color-dimmed)" }}>Missed</Table.Th>
              <Table.Th style={{ color: "var(--mantine-color-dimmed)" }}>Avg Handle</Table.Th>
              <Table.Th style={{ color: "var(--mantine-color-dimmed)" }}>Avg Wait</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {months.map((m) => {
              const s   = agent.by_month[m] ?? emptyStats();
              const ah  = avgHandle(s);
              const aw  = avgWait(s);
              const tot = s.answered + s.refused + s.missed;
              return (
                <Table.Tr key={m}>
                  <Table.Td fw={600}>{MONTH_LABELS[m] ?? m}</Table.Td>
                  <Table.Td>
                    <Text
                      size="xs"
                      fw={700}
                      ff="monospace"
                      c={s.answered > 0 ? "green.4" : "dimmed"}
                    >
                      {s.answered}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text
                      size="xs"
                      ff="monospace"
                      c={s.refused > 0 ? "red.4" : "dimmed"}
                    >
                      {s.refused}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text
                      size="xs"
                      ff="monospace"
                      c={s.missed > 0 ? "orange.4" : "dimmed"}
                    >
                      {s.missed}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {ah != null ? formatSeconds(ah) : tot === 0 ? "—" : "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {aw != null ? formatSeconds(aw) : "—"}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Box>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function ZoomCallMetricsWidget() {
  const [data, setData]       = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [period, setPeriod]   = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

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

  // Aggregate stats for the selected period
  const agentRows = useMemo(() => {
    if (!data) return [];
    const months = period === "all" ? data.months : [period];
    return data.agents
      .map((ag) => ({
        name:    ag.name,
        total:   months.reduce((acc, m) => addStats(acc, ag.by_month[m] ?? emptyStats()), emptyStats()),
        by_month: ag.by_month,
      }))
      .filter((r) => r.total.answered + r.total.refused + r.total.missed > 0)
      .sort((a, b) => b.total.answered - a.total.answered);
  }, [data, period]);

  const teamTotal = useMemo(
    () => agentRows.reduce((acc, r) => addStats(acc, r.total), emptyStats()),
    [agentRows],
  );

  const teamAvgHandle = avgHandle(teamTotal);
  const teamAvgWait   = avgWait(teamTotal);
  const maxAnswered   = agentRows.length > 0 ? Math.max(...agentRows.map((r) => r.total.answered)) : 0;

  const periodLabel =
    period === "all"
      ? "Jan – Apr 2026"
      : MONTH_LABELS[period] ?? period;

  const segData = [
    { value: "all", label: "All" },
    ...(data?.months ?? []).map((m) => ({ value: m, label: MONTH_SHORT[m] ?? m })),
  ];

  return (
    <WidgetFrame
      title="Zoom Inbound Call Metrics"
      subtitle={`Jan – Apr 2026 · ${data?.source === "live" ? "Live Zoom Phone API" : "Snapshot (demo)"}`}
      icon={IconPhone}
      iconColor="green"
      loading={loading}
      onRefresh={load}
    >
      <Stack gap="lg">

        {/* Source badge + warning */}
        {data && (
          <Group gap="xs" wrap="wrap">
            <Badge
              color={data.source === "live" ? "green" : "yellow"}
              variant="dot"
              size="sm"
            >
              {data.source === "live" ? "Live — Zoom Phone API" : "Snapshot mode"}
            </Badge>
            {data.source === "live" && (
              <Text size="xs" c="dimmed">
                Fetched {new Date(data.fetched_at).toLocaleString()}
              </Text>
            )}
          </Group>
        )}

        {data?.warning && (
          <Alert
            icon={<IconAlertTriangle size={16} />}
            color="yellow"
            radius="md"
            p="sm"
          >
            <Text size="xs">{data.warning}</Text>
          </Alert>
        )}

        {error && (
          <Card
            withBorder
            radius="md"
            p="md"
            style={{ borderColor: "var(--mantine-color-red-6)" }}
          >
            <Text c="red" size="sm">{error}</Text>
          </Card>
        )}

        {/* Period selector */}
        {data && (
          <SegmentedControl
            value={period}
            onChange={(v) => {
              setPeriod(v);
              setExpanded(null);
            }}
            data={segData}
            size="xs"
            radius="md"
          />
        )}

        {/* ── Team KPI summary ──────────────────────────────────────────── */}
        {data && agentRows.length > 0 && (
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
            <KpiCard
              label="Answered"
              value={teamTotal.answered.toLocaleString()}
              sub="inbound calls picked up"
              color="green"
              icon={<IconPhoneIncoming size={12} />}
            />
            <KpiCard
              label="Refused"
              value={teamTotal.refused.toLocaleString()}
              sub="no answer / by other"
              color="red"
              icon={<IconPhoneX size={12} />}
            />
            <KpiCard
              label="Other Missed"
              value={teamTotal.missed.toLocaleString()}
              sub="voicemail / abandoned"
              color="orange"
            />
            <KpiCard
              label="Avg Handle Time"
              value={teamAvgHandle != null ? formatSeconds(teamAvgHandle) : "—"}
              sub="from Duration field"
              color="teal"
            />
          </SimpleGrid>
        )}

        {/* Avg Speed of Answer — only shown when wait data is present */}
        {data && teamAvgWait != null && (
          <Card
            withBorder
            radius="md"
            p="md"
            style={{ borderTop: "2px solid var(--mantine-color-cyan-6)" }}
          >
            <Group gap="md">
              <ThemeIcon radius="md" variant="light" color="cyan" size="lg">
                <IconPhone size={18} />
              </ThemeIcon>
              <Box>
                <Text size="xl" fw={700} ff="monospace" c="cyan.4">
                  {formatSeconds(teamAvgWait)}
                </Text>
                <Text size="xs" fw={600}>Avg Speed of Answer</Text>
                <Text size="xs" c="dimmed">from Wait Time field · Zoom Phone Premium</Text>
              </Box>
            </Group>
          </Card>
        )}

        {/* ── Per-agent bar chart ───────────────────────────────────────── */}
        {data && agentRows.length > 0 && (
          <Card
            withBorder
            radius="md"
            p="md"
            style={{ borderTop: "2px solid var(--mantine-color-green-6)" }}
          >
            <Stack gap="md">
              {/* Card header */}
              <Group gap="sm" wrap="nowrap">
                <ThemeIcon radius="md" variant="light" color="green" size="lg">
                  <IconPhoneIncoming size={20} />
                </ThemeIcon>
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Title order={5} style={{ lineHeight: 1.2 }}>
                    Inbound Calls — Per Agent
                  </Title>
                  <Text size="xs" c="dimmed">
                    {agentRows.length} contributor{agentRows.length === 1 ? "" : "s"} ·{" "}
                    {periodLabel} · click a row to expand monthly breakdown
                  </Text>
                </Box>
                <Group gap="xl" wrap="wrap" justify="flex-end" visibleFrom="sm">
                  <MiniKpi
                    label="Answered"
                    value={teamTotal.answered.toLocaleString()}
                    color="green"
                  />
                  <MiniKpi
                    label="Refused"
                    value={teamTotal.refused.toLocaleString()}
                    color="red"
                  />
                  <MiniKpi
                    label="Avg Handle"
                    value={teamAvgHandle != null ? formatSeconds(teamAvgHandle) : "—"}
                  />
                  {teamAvgWait != null && (
                    <MiniKpi
                      label="Avg Wait"
                      value={formatSeconds(teamAvgWait)}
                      color="teal"
                    />
                  )}
                </Group>
              </Group>

              {/* Per-agent rows */}
              <Stack gap={2}>
                {agentRows.map((row) => {
                  const tier = tierFor(row.name);
                  const bar  = maxAnswered > 0 ? (row.total.answered / maxAnswered) * 100 : 0;
                  const ah   = avgHandle(row.total);
                  const aw   = avgWait(row.total);
                  const isExpanded = expanded === row.name;
                  const pct  =
                    teamTotal.answered > 0
                      ? Math.round((row.total.answered / teamTotal.answered) * 100)
                      : 0;

                  return (
                    <Box key={row.name}>
                      {/* Agent bar row */}
                      <Group
                        gap="sm"
                        wrap="nowrap"
                        py={4}
                        px={6}
                        style={{
                          cursor: "pointer",
                          borderRadius: 6,
                          background: isExpanded
                            ? "var(--mantine-color-dark-6)"
                            : "transparent",
                        }}
                        onClick={() =>
                          setExpanded(isExpanded ? null : row.name)
                        }
                      >
                        {/* Expand indicator */}
                        <Box style={{ width: 14, flexShrink: 0 }}>
                          {isExpanded
                            ? <IconChevronDown size={12} color="var(--mantine-color-dimmed)" />
                            : <IconChevronRight size={12} color="var(--mantine-color-dimmed)" />
                          }
                        </Box>

                        {/* Name + tier badge */}
                        <Box style={{ width: 148, flexShrink: 0 }}>
                          <Group gap={4} wrap="nowrap">
                            <Text size="xs" truncate fw={500}>
                              {row.name}
                            </Text>
                            {tier && (
                              <Badge
                                size="xs"
                                variant="light"
                                color={TIER_COLORS[tier]}
                                style={{ flexShrink: 0 }}
                              >
                                {TIER_SHORT_LABELS[tier]}
                              </Badge>
                            )}
                          </Group>
                        </Box>

                        {/* Progress bar */}
                        <Tooltip
                          withinPortal
                          label={
                            <>
                              <div>Answered: {row.total.answered.toLocaleString()} ({pct}% of team)</div>
                              <div>Refused: {row.total.refused}</div>
                              <div>Missed: {row.total.missed}</div>
                              {ah != null && <div>Avg handle: {formatSeconds(ah)}</div>}
                              {aw != null && <div>Avg wait: {formatSeconds(aw)}</div>}
                            </>
                          }
                        >
                          <Progress
                            value={bar}
                            color="green"
                            size="md"
                            radius="xl"
                            style={{ flex: 1 }}
                          />
                        </Tooltip>

                        {/* Stats */}
                        <Group
                          gap={6}
                          style={{ width: 160, flexShrink: 0 }}
                          justify="flex-end"
                          wrap="nowrap"
                        >
                          <Text
                            size="xs"
                            fw={700}
                            ff="monospace"
                            c="green.4"
                            style={{ minWidth: 28, textAlign: "right" }}
                          >
                            {row.total.answered.toLocaleString()}
                          </Text>
                          {row.total.refused > 0 && (
                            <Text size="xs" c="red.4" ff="monospace">
                              {row.total.refused}✗
                            </Text>
                          )}
                          {ah != null && (
                            <Text size="xs" c="dimmed" ff="monospace">
                              {formatSeconds(ah)}
                            </Text>
                          )}
                        </Group>
                      </Group>

                      {/* Expanded monthly breakdown */}
                      {isExpanded && data && (
                        <AgentMonthTable agent={{ name: row.name, by_month: row.by_month }} months={data.months} />
                      )}
                    </Box>
                  );
                })}
              </Stack>
            </Stack>
          </Card>
        )}

        {/* ── Monthly overview grid ─────────────────────────────────────── */}
        {data && period === "all" && agentRows.length > 0 && (
          <Card withBorder radius="md" p="md">
            <Title order={6} mb="sm" c="dimmed" tt="uppercase" style={{ letterSpacing: "0.04em", fontSize: 11 }}>
              Month-by-Month Team Totals
            </Title>
            <Grid gutter="sm">
              {data.months.map((m) => {
                const mTotal = agentRows.reduce(
                  (acc, r) => addStats(acc, r.by_month[m] ?? emptyStats()),
                  emptyStats(),
                );
                const mHandle = avgHandle(mTotal);
                const mWait   = avgWait(mTotal);
                return (
                  <Grid.Col key={m} span={{ base: 6, sm: 3 }}>
                    <Card
                      withBorder
                      radius="md"
                      p="sm"
                      style={{ borderTop: "2px solid var(--mantine-color-green-7)" }}
                    >
                      <Text size="xs" fw={700} c="green.4" mb={6}>
                        {MONTH_LABELS[m]}
                      </Text>
                      <Stack gap={4}>
                        <Group justify="space-between">
                          <Text size="xs" c="dimmed">Answered</Text>
                          <Text size="xs" fw={700} ff="monospace" c="green.4">
                            {mTotal.answered.toLocaleString()}
                          </Text>
                        </Group>
                        <Group justify="space-between">
                          <Text size="xs" c="dimmed">Refused</Text>
                          <Text
                            size="xs"
                            ff="monospace"
                            c={mTotal.refused > 0 ? "red.4" : "dimmed"}
                          >
                            {mTotal.refused}
                          </Text>
                        </Group>
                        <Group justify="space-between">
                          <Text size="xs" c="dimmed">Missed</Text>
                          <Text
                            size="xs"
                            ff="monospace"
                            c={mTotal.missed > 0 ? "orange.4" : "dimmed"}
                          >
                            {mTotal.missed}
                          </Text>
                        </Group>
                        <Group justify="space-between">
                          <Text size="xs" c="dimmed">Avg Handle</Text>
                          <Text size="xs" ff="monospace">
                            {mHandle != null ? formatSeconds(mHandle) : "—"}
                          </Text>
                        </Group>
                        {mWait != null && (
                          <Group justify="space-between">
                            <Text size="xs" c="dimmed">Avg Wait</Text>
                            <Text size="xs" ff="monospace" c="cyan.4">
                              {formatSeconds(mWait)}
                            </Text>
                          </Group>
                        )}
                      </Stack>
                    </Card>
                  </Grid.Col>
                );
              })}
            </Grid>
          </Card>
        )}

        {/* Empty state */}
        {data && agentRows.length === 0 && !loading && (
          <Card withBorder radius="md" p="xl">
            <Stack align="center" gap="sm">
              <IconPhoneOff size={40} color="var(--mantine-color-dimmed)" />
              <Text size="sm" c="dimmed" ta="center">
                No inbound call data found for {periodLabel}.
              </Text>
            </Stack>
          </Card>
        )}
      </Stack>
    </WidgetFrame>
  );
}

export { ZoomCallMetricsTile } from "./Tile";
