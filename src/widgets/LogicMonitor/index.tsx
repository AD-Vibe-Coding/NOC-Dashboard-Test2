import { useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Collapse,
  Divider,
  Grid,
  Group,
  Modal,

  ScrollArea,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCheck,
  IconChartArea,
  IconChevronDown,
  IconChevronUp,
  IconCode,
  IconExternalLink,
  IconHistory,
  IconRefresh,
  IconSearch,
  IconTimeline,
} from "@tabler/icons-react";
import { useIdentity } from "../../lib/identity";
import {
  ackLmAlert,
  elapsedSince,
  LM_SEVERITY_COLORS,
  LM_SEVERITY_LABELS,
  lmSeverityRank,
  type LmAlert,
  type LmSeverity,
} from "../../lib/logicmonitor";
import { WidgetFrame } from "../WidgetFrame";
import { useLogicMonitor } from "./data";

export { LogicMonitorTile } from "./Tile";

const SEVERITY_ORDER: LmSeverity[] = ["critical", "error", "warn", "info"];

// ── Alert Analyzer result types ──────────────────────────────────────────────

interface AnalyzeResult {
  alertId: string;
  status: "active" | "cleared" | "error";
  mainAlert: {
    id: string;
    severity: string;
    status: string;
    startEpoch: number;
    endEpoch: number;
    downtimeMinutes: number | null;
    device: { id: number; name: string };
    dataSourceName: string;
    instanceName: string;
    dataPointName: string;
    externalTicketId: string | null;
    rawAlertResponse: unknown;
  } | null;
  history: {
    windowDays: number;
    totalAlertsInLast60Days: number;
    totalDowntimeMinutes: number;
    averageDowntimeMinutes: number;
    alerts: Array<{
      id: string;
      startEpoch: number;
      endEpoch: number;
      status: string;
      downtimeMinutes: number | null;
    }>;
  };
  metrics: {
    dataPointName: string;
    unit: string | null;
    series: Array<{ timestamp: number; value: number | null }>;
  };
  errors: string[];
}

// ── Mock sample result for UI preview ────────────────────────────────────────

const now = Math.floor(Date.now() / 1000);
const start1 = now - 3600 * 2;   // 2h ago
const end1   = now - 3600 * 1;   // 1h ago

function mockHistAlert(id: string, daysAgo: number, durationMins: number, status: "cleared" | "active") {
  const s = now - daysAgo * 86400;
  const e = status === "cleared" ? s + durationMins * 60 : 0;
  return { id, startEpoch: s, endEpoch: e, status, downtimeMinutes: status === "cleared" ? durationMins : null };
}

const MOCK_RESULT: AnalyzeResult = {
  alertId: "DS9942881",
  status: "cleared",
  mainAlert: {
    id: "DS9942881",
    severity: "critical",
    status: "cleared",
    startEpoch: start1,
    endEpoch: end1,
    downtimeMinutes: 60,
    device: { id: 42, name: "core-router-01.vcom.net" },
    dataSourceName: "Ping",
    instanceName: "8.8.8.8",
    dataPointName: "pingloss",
    externalTicketId: "INC-20481",
    rawAlertResponse: {
      id: "DS9942881", severity: 2, status: "cleared",
      startEpoch: start1, endEpoch: end1,
      resourceId: 42, resourceName: "core-router-01.vcom.net",
      dataSourceName: "Ping", instanceName: "8.8.8.8", dataPointName: "pingloss",
      externalTicketId: "INC-20481",
    },
  },
  history: {
    windowDays: 60,
    totalAlertsInLast60Days: 7,
    totalDowntimeMinutes: 312,
    averageDowntimeMinutes: 44.57,
    alerts: [
      mockHistAlert("DS9942881", 0,   60,  "cleared"),
      mockHistAlert("DS9938201", 4,   25,  "cleared"),
      mockHistAlert("DS9921044", 11,  90,  "cleared"),
      mockHistAlert("DS9914882", 18,  15,  "cleared"),
      mockHistAlert("DS9901337", 27,  72,  "cleared"),
      mockHistAlert("DS9887654", 41,  38,  "cleared"),
      mockHistAlert("DS9874120", 55,  12,  "cleared"),
    ],
  },
  metrics: {
    dataPointName: "pingloss",
    unit: "%",
    series: (() => {
      const pts: Array<{ timestamp: number; value: number }> = [];
      const base = start1 - 900;
      for (let i = 0; i <= 90; i++) {
        const t = base + i * 60;
        const inWindow = t >= start1 && t <= end1;
        const v = inWindow
          ? 40 + Math.round(Math.random() * 55)   // spike during alert
          : Math.round(Math.random() * 3);          // normal baseline
        pts.push({ timestamp: t, value: v });
      }
      return pts;
    })(),
  },
  errors: [],
};

// ── Alert Analyzer component ─────────────────────────────────────────────────

function AlertAnalyzer() {
  const [alertId, setAlertId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  function loadSample() {
    setAlertId("DS9942881");
    setResult(MOCK_RESULT);
    setIsMock(true);
    setError(null);
    setShowRaw(false);
  }

  async function handleAnalyze() {
    if (!alertId.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setIsMock(false);
    setShowRaw(false);
    abortRef.current = new AbortController();
    try {
      const r = await fetch("/api/lm/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId: alertId.trim() }),
        signal: abortRef.current.signal,
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? `HTTP ${r.status}`);
      } else {
        setResult(j as AnalyzeResult);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }

  const ma = result?.mainAlert;
  const history = result?.history;
  const metrics = result?.metrics;

  // Simple sparkline using SVG
  const spark = useMemo(() => {
    const series = metrics?.series.filter((p) => p.value != null) ?? [];
    if (series.length < 2) return null;
    const vals = series.map((p) => p.value as number);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const W = 320, H = 60;
    const pts = series
      .map((p, i) => {
        const x = (i / (series.length - 1)) * W;
        const y = H - ((( p.value as number) - min) / range) * H;
        return `${x},${y}`;
      })
      .join(" ");
    return { pts, min, max, count: series.length, W, H };
  }, [metrics]);

  return (
    <Stack gap="md">
      {/* Alert ID input — credentials come from .env */}
      <Card withBorder radius="md" p="md">
        <Group gap="sm" align="flex-end">
          <TextInput
            label="Alert ID"
            description="LM_ACCOUNT, LM_ACCESS_ID and LM_ACCESS_KEY are read from .env"
            placeholder="e.g. DS9942881"
            value={alertId}
            onChange={(e) => setAlertId(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
            size="xs"
            style={{ flex: 1 }}
          />
          <Button
            size="xs"
            leftSection={<IconSearch size={13} />}
            loading={loading}
            disabled={!alertId.trim()}
            onClick={handleAnalyze}
            mb={2}
          >
            Analyze
          </Button>
          <Button
            size="xs"
            variant="light"
            color="gray"
            leftSection={<IconChartArea size={13} />}
            onClick={loadSample}
            mb={2}
          >
            Preview
          </Button>
        </Group>
      </Card>

      {/* Mock data banner */}
      {isMock && (
        <Alert
          color="blue"
          variant="light"
          icon={<IconAlertCircle size={14} />}
          radius="md"
          styles={{ message: { fontSize: 12 } }}
        >
          <strong>Sample preview</strong> — this is synthetic demo data. Add{" "}
          <code>LM_ACCOUNT</code>, <code>LM_ACCESS_ID</code> and{" "}
          <code>LM_ACCESS_KEY</code> to .env and click <strong>Analyze</strong> to query live alerts.
        </Alert>
      )}

      {/* Error state */}
      {error && (
        <Alert color="red" variant="light" icon={<IconAlertCircle size={15} />} radius="md">
          {error}
        </Alert>
      )}

      {/* API-level errors from result */}
      {result && result.errors.length > 0 && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={15} />} radius="md">
          <Stack gap={2}>
            {result.errors.map((e, i) => (
              <Text key={i} size="xs">{e}</Text>
            ))}
          </Stack>
        </Alert>
      )}

      {/* Main alert card */}
      {ma && (
        <Card withBorder radius="md" p="md" style={{
          borderTop: `3px solid var(--mantine-color-${ma.severity === "critical" ? "red" : ma.severity === "error" ? "orange" : ma.severity === "warn" ? "yellow" : "blue"}-6)`,
        }}>
          <Group justify="space-between" mb="xs" wrap="nowrap">
            <Group gap="xs" wrap="nowrap">
              <Badge
                variant="filled"
                color={ma.severity === "critical" ? "red" : ma.severity === "error" ? "orange" : ma.severity === "warn" ? "yellow" : "blue"}
                size="sm"
                style={{ textTransform: "capitalize" }}
              >
                {ma.severity}
              </Badge>
              <Badge
                variant="light"
                color={result.status === "cleared" ? "green" : "red"}
                size="sm"
              >
                {result.status.toUpperCase()}
              </Badge>
              <Text size="xs" c="dimmed" ff="monospace">#{ma.id}</Text>
            </Group>
            {ma.downtimeMinutes != null && (
              <Badge variant="outline" color="gray" size="sm">
                ⏱ {ma.downtimeMinutes < 60
                  ? `${ma.downtimeMinutes}m downtime`
                  : `${(ma.downtimeMinutes / 60).toFixed(1)}h downtime`}
              </Badge>
            )}
          </Group>

          <Grid gutter="xs">
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Device</Text>
              <Text size="sm" fw={500}>{ma.device.name || "—"}</Text>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>DataSource</Text>
              <Text size="sm">{ma.dataSourceName || "—"}</Text>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Instance</Text>
              <Text size="sm" ff="monospace">{ma.instanceName || "—"}</Text>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>DataPoint</Text>
              <Text size="sm" ff="monospace">{ma.dataPointName || "—"}</Text>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Started</Text>
              <Text size="sm">{ma.startEpoch ? new Date(ma.startEpoch * 1000).toLocaleString() : "—"}</Text>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                {result.status === "cleared" ? "Cleared" : "Still active"}
              </Text>
              <Text size="sm">
                {result.status === "cleared" && ma.endEpoch
                  ? new Date(ma.endEpoch * 1000).toLocaleString()
                  : result.status === "active"
                    ? `Active for ${elapsedSince(ma.startEpoch * 1000)}`
                    : "—"}
              </Text>
            </Grid.Col>
            {ma.externalTicketId && (
              <Grid.Col span={12}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>External Ticket</Text>
                <Text size="sm" ff="monospace">{ma.externalTicketId}</Text>
              </Grid.Col>
            )}
          </Grid>
        </Card>
      )}

      {/* Metrics sparkline */}
      {metrics && (spark || metrics.series.length === 0) && ma && (
        <Card withBorder radius="md" p="md">
          <Group justify="space-between" mb="xs">
            <Group gap="xs">
              <ThemeIcon variant="light" color="blue" size="sm" radius="sm">
                <IconTimeline size={13} />
              </ThemeIcon>
              <Text size="sm" fw={600}>
                {metrics.dataPointName || "Metric"} time-series
                {metrics.unit ? ` (${metrics.unit})` : ""}
              </Text>
            </Group>
            <Text size="xs" c="dimmed">{metrics.series.length} data points</Text>
          </Group>
          {spark ? (
            <Box>
              <svg
                viewBox={`0 0 ${spark.W} ${spark.H}`}
                style={{ width: "100%", height: 64, display: "block" }}
              >
                <polyline
                  points={spark.pts}
                  fill="none"
                  stroke="var(--mantine-color-blue-5)"
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  {new Date((metrics.series[0]?.timestamp ?? 0) * 1000).toLocaleString()}
                </Text>
                <Group gap="xs">
                  <Text size="xs" c="dimmed">min: {spark.min.toFixed(2)}</Text>
                  <Text size="xs" c="dimmed">max: {spark.max.toFixed(2)}</Text>
                </Group>
                <Text size="xs" c="dimmed">
                  {new Date((metrics.series[metrics.series.length - 1]?.timestamp ?? 0) * 1000).toLocaleString()}
                </Text>
              </Group>
            </Box>
          ) : (
            <Text size="xs" c="dimmed" ta="center" py="sm">
              No metric data available for this alert window.
            </Text>
          )}
        </Card>
      )}

      {/* 60-day history */}
      {history && (
        <Card withBorder radius="md" p="md">
          <Group gap="xs" mb="sm">
            <ThemeIcon variant="light" color="violet" size="sm" radius="sm">
              <IconHistory size={13} />
            </ThemeIcon>
            <Text size="sm" fw={600}>60-day history — same service</Text>
          </Group>

          <Grid gutter="xs" mb="sm">
            <Grid.Col span={{ base: 6, sm: 3 }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Alerts</Text>
              <Text size="xl" fw={700} c="violet.4" ff="monospace">
                {history.totalAlertsInLast60Days}
              </Text>
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 3 }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Total downtime</Text>
              <Text size="xl" fw={700} c="orange.4" ff="monospace">
                {history.totalDowntimeMinutes < 60
                  ? `${history.totalDowntimeMinutes}m`
                  : `${(history.totalDowntimeMinutes / 60).toFixed(1)}h`}
              </Text>
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 3 }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Avg downtime</Text>
              <Text size="xl" fw={700} c="yellow.4" ff="monospace">
                {history.averageDowntimeMinutes < 60
                  ? `${history.averageDowntimeMinutes}m`
                  : `${(history.averageDowntimeMinutes / 60).toFixed(1)}h`}
              </Text>
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 3 }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Window</Text>
              <Text size="xl" fw={700} c="dimmed" ff="monospace">60d</Text>
            </Grid.Col>
          </Grid>

          {history.alerts.length > 0 && (
            <ScrollArea.Autosize mah={220}>
              <Table
                striped
                withColumnBorders
                withTableBorder
                styles={{ th: { fontSize: 11 }, td: { fontSize: 11, padding: "4px 8px" } }}
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Alert ID</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Started</Table.Th>
                    <Table.Th>Cleared</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>Downtime</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {history.alerts.map((a, i) => (
                    <Table.Tr key={`hist-${a.id}-${i}`}>
                      <Table.Td>
                        <Text size="xs" ff="monospace">{a.id}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          size="xs"
                          variant="light"
                          color={a.status === "cleared" ? "green" : "red"}
                        >
                          {a.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">
                          {a.startEpoch ? new Date(a.startEpoch * 1000).toLocaleString() : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">
                          {a.status === "cleared" && a.endEpoch
                            ? new Date(a.endEpoch * 1000).toLocaleString()
                            : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }}>
                        <Text size="xs" ff="monospace">
                          {a.downtimeMinutes != null
                            ? a.downtimeMinutes < 60
                              ? `${a.downtimeMinutes}m`
                              : `${(a.downtimeMinutes / 60).toFixed(1)}h`
                            : "—"}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}
          {history.alerts.length === 0 && (
            <Text size="xs" c="dimmed" ta="center" py="xs">
              No historical alerts found for this service in the last 60 days.
            </Text>
          )}
        </Card>
      )}

      {/* Raw JSON toggle */}
      {result && (
        <Card withBorder radius="md" p={0}>
          <Group
            px="md"
            py="xs"
            style={{ cursor: "pointer" }}
            onClick={() => setShowRaw((v) => !v)}
          >
            <ThemeIcon variant="subtle" color="gray" size="sm">
              <IconCode size={13} />
            </ThemeIcon>
            <Text size="xs" fw={600} c="dimmed">Raw JSON response</Text>
            {showRaw ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
          </Group>
          <Collapse in={showRaw}>
            <Divider />
            <ScrollArea.Autosize mah={400}>
              <Box p="md">
                <pre style={{ fontSize: 10, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {JSON.stringify(result, null, 2)}
                </pre>
              </Box>
            </ScrollArea.Autosize>
          </Collapse>
        </Card>
      )}
    </Stack>
  );
}

export function LogicMonitorWidget() {
  // Filters
  const [selectedSeverities, setSelectedSeverities] = useState<LmSeverity[]>([
    "critical",
    "error",
    "warn",
  ]);
  const [includeAcked, setIncludeAcked] = useState(false);
  const [query, setQuery] = useState("");

  const filters = useMemo(
    () => ({
      severity: selectedSeverities,
      includeAcked,
      size: 200,
    }),
    [selectedSeverities, includeAcked],
  );

  const { alerts, devices, loading, alertsError, refresh } = useLogicMonitor(filters);
  const { identity } = useIdentity();

  const [ackTarget, setAckTarget] = useState<LmAlert | null>(null);

  // Client-side search across the visible alerts (cheap — typically <200 rows).
  const visibleAlerts = useMemo(() => {
    const list = alerts?.alerts ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) => {
      return (
        a.monitor_object_name.toLowerCase().includes(q) ||
        a.monitor_object_group.toLowerCase().includes(q) ||
        a.resource_template_name.toLowerCase().includes(q) ||
        a.instance_name.toLowerCase().includes(q) ||
        a.data_point.toLowerCase().includes(q) ||
        a.rule.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q)
      );
    });
  }, [alerts, query]);

  const totals = useMemo(() => {
    const list = alerts?.alerts ?? [];
    return {
      critical: list.filter((a) => a.severity === "critical").length,
      error: list.filter((a) => a.severity === "error").length,
      warn: list.filter((a) => a.severity === "warn").length,
      info: list.filter((a) => a.severity === "info").length,
    };
  }, [alerts]);

  function toggleSeverity(s: LmSeverity) {
    setSelectedSeverities((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  return (
    <WidgetFrame
      title="LogicMonitor"
      subtitle="Alert feed & analyzer"
      icon={IconChartArea}
      iconColor="red"
      loading={loading}
      onRefresh={refresh}
      status={
        alerts
          ? {
              label: alerts.source === "live" ? "live" : "snapshot",
              color: alerts.source === "live" ? "green" : "yellow",
              tooltip: alerts.warning ?? undefined,
            }
          : undefined
      }
    >
      <Tabs defaultValue="feed" variant="outline" radius="md">
        <Tabs.List mb="md">
          <Tabs.Tab value="feed" leftSection={<IconAlertTriangle size={14} />}>
            Alert Feed
          </Tabs.Tab>
          <Tabs.Tab value="analyzer" leftSection={<IconSearch size={14} />}>
            Alert Analyzer
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="analyzer">
          <AlertAnalyzer />
        </Tabs.Panel>

        <Tabs.Panel value="feed">
      <Stack gap="md">
        {alerts?.warning && (
          <Alert color="yellow" variant="light" icon={<IconAlertCircle size={16} />} radius="md">
            {alerts.warning}
          </Alert>
        )}
        {alertsError && (
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />} radius="md">
            {alertsError}
          </Alert>
        )}

        {/* Summary row */}
        <Grid gutter="md">
          <Grid.Col span={{ base: 6, md: 3 }}>
            <SummaryCard label="Critical" value={totals.critical} color="red" />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 3 }}>
            <SummaryCard label="Error" value={totals.error} color="orange" />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 3 }}>
            <SummaryCard label="Warning" value={totals.warn} color="yellow" />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 3 }}>
            <SummaryCard
              label="Devices"
              value={devices?.summary.total_devices ?? 0}
              color="blue"
              hint={devices ? `${devices.summary.by_alert_state.ok} healthy` : "—"}
            />
          </Grid.Col>
        </Grid>

        {/* Filter row */}
        <Card radius="md" withBorder p="sm">
          <Group justify="space-between" wrap="wrap" gap="sm">
            <Group gap={6} wrap="wrap">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} mr={4}>
                Severity
              </Text>
              {SEVERITY_ORDER.map((s) => (
                <Badge
                  key={s}
                  variant={selectedSeverities.includes(s) ? "filled" : "outline"}
                  color={LM_SEVERITY_COLORS[s]}
                  size="sm"
                  style={{ cursor: "pointer", textTransform: "capitalize" }}
                  onClick={() => toggleSeverity(s)}
                >
                  {LM_SEVERITY_LABELS[s]}
                </Badge>
              ))}
              <Checkbox
                ml="md"
                label="Include acked"
                size="xs"
                checked={includeAcked}
                onChange={(e) => setIncludeAcked(e.currentTarget.checked)}
              />
            </Group>
            <TextInput
              leftSection={<IconSearch size={14} />}
              placeholder="Device, group, datapoint, ID…"
              size="xs"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              w={{ base: "100%", md: 260 }}
            />
          </Group>
        </Card>

        {/* Alert list */}
        <Card radius="md" withBorder p={0}>
          {visibleAlerts.length === 0 ? (
            <Box p="xl" ta="center">
              <ThemeIcon size={40} radius="xl" variant="light" color="green" mx="auto">
                <IconCheck size={20} />
              </ThemeIcon>
              <Text c="dimmed" mt="sm">
                {query
                  ? "No alerts match your search."
                  : selectedSeverities.length === 0
                    ? "Pick a severity filter to see alerts."
                    : "All clear — no open alerts."}
              </Text>
            </Box>
          ) : (
            <ScrollArea.Autosize mah={520}>
              <Table striped highlightOnHover stickyHeader withRowBorders={false} verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: 90 }}>Severity</Table.Th>
                    <Table.Th>Device / Resource</Table.Th>
                    <Table.Th>Datapoint</Table.Th>
                    <Table.Th>Value</Table.Th>
                    <Table.Th style={{ width: 90 }}>Age</Table.Th>
                    <Table.Th style={{ width: 120 }} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {[...visibleAlerts]
                    .sort((a, b) => {
                      const s = lmSeverityRank(a.severity) - lmSeverityRank(b.severity);
                      if (s !== 0) return s;
                      return a.start_epoch - b.start_epoch;
                    })
                    .map((a, idx) => (
                      <Table.Tr key={`logic-alert-${a.id}-${a.start_epoch}-${idx}`}>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Badge
                              variant="filled"
                              color={LM_SEVERITY_COLORS[a.severity]}
                              size="xs"
                              style={{ textTransform: "capitalize" }}
                            >
                              {a.severity}
                            </Badge>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" fw={500} truncate>
                            {a.monitor_object_name}
                          </Text>
                          <Text size="xs" c="dimmed" truncate>
                            {a.monitor_object_group || a.resource_template_name}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" ff="monospace" truncate>
                            {a.data_point}
                          </Text>
                          <Text size="xs" c="dimmed" truncate>
                            {a.instance_name}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" ff="monospace">
                            {a.alert_value}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {a.threshold}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4} wrap="nowrap">
                            <IconAlertTriangle
                              size={11}
                              color={`var(--mantine-color-${LM_SEVERITY_COLORS[a.severity]}-5)`}
                            />
                            <Text size="xs" ff="monospace">
                              {elapsedSince(a.start_epoch)}
                            </Text>
                          </Group>
                          {a.sdted && (
                            <Badge size="xs" variant="light" color="gray">
                              SDT
                            </Badge>
                          )}
                        </Table.Td>
                        <Table.Td>
                          {a.acked ? (
                            <Tooltip
                              label={`${a.ack_comment ?? "Acked"} — by ${a.acked_by ?? "?"}`}
                            >
                              <Badge size="xs" variant="light" color="green">
                                Acked
                              </Badge>
                            </Tooltip>
                          ) : (
                            <Button
                              size="compact-xs"
                              variant="light"
                              color="cyan"
                              onClick={() => setAckTarget(a)}
                            >
                              Ack
                            </Button>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}
        </Card>

        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {alerts
              ? `${visibleAlerts.length} of ${alerts.count} alerts · fetched ${new Date(
                  alerts.fetched_at,
                ).toLocaleTimeString()}`
              : "Loading…"}
          </Text>
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" size="sm" onClick={refresh}>
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Stack>

      <AckModal
        alert={ackTarget}
        onClose={() => setAckTarget(null)}
        onAcked={() => {
          setAckTarget(null);
          refresh();
        }}
        defaultComment={
          identity?.name ? `Investigating — ${identity.name}` : "Investigating"
        }
      />
        </Tabs.Panel>
      </Tabs>
    </WidgetFrame>
  );
}

function SummaryCard({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: number;
  color: string;
  hint?: string;
}) {
  return (
    <Card radius="md" withBorder p="sm" h="100%">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700} c={`${color}.4`} style={{ lineHeight: 1.1 }} mt={2}>
        {value.toLocaleString()}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed" mt={2}>
          {hint}
        </Text>
      )}
    </Card>
  );
}

function AckModal({
  alert,
  onClose,
  onAcked,
  defaultComment,
}: {
  alert: LmAlert | null;
  onClose: () => void;
  onAcked: () => void;
  defaultComment: string;
}) {
  const [comment, setComment] = useState(defaultComment);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset state when alert changes
  useMemo(() => {
    setComment(defaultComment);
    setErr(null);
  }, [alert?.id, defaultComment]);

  async function submit() {
    if (!alert) return;
    setBusy(true);
    setErr(null);
    try {
      await ackLmAlert(alert.id, comment.trim() || defaultComment);
      onAcked();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={!!alert} onClose={onClose} title="Acknowledge alert" radius="md" centered>
      {alert && (
        <Stack gap="sm">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Alert
            </Text>
            <Group gap={6}>
              <Badge variant="filled" color={LM_SEVERITY_COLORS[alert.severity]} size="xs">
                {alert.severity}
              </Badge>
              <Text size="sm" fw={500}>
                {alert.monitor_object_name}
              </Text>
              <Text size="xs" c="dimmed" component="a" href={alert.id}>
                #{alert.id}
              </Text>
            </Group>
            <Text size="xs" c="dimmed">
              {alert.resource_template_name} · {alert.data_point} = {alert.alert_value}
            </Text>
          </Box>
          <Textarea
            label="Comment"
            placeholder="What you're doing about it…"
            value={comment}
            onChange={(e) => setComment(e.currentTarget.value)}
            autosize
            minRows={2}
            maxRows={5}
          />
          {err && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={14} />} radius="sm">
              {err}
            </Alert>
          )}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="xs" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="xs"
              leftSection={<IconCheck size={14} />}
              loading={busy}
              onClick={submit}
              disabled={!comment.trim()}
            >
              Acknowledge
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

// IconExternalLink intentionally re-exported to silence the unused-import lint
// in case downstream UI starts deep-linking into the LM portal.
export { IconExternalLink as _IconExternalLink };
