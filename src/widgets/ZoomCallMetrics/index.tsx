import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  MultiSelect,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconPhone,
  IconPhoneCall,
  IconPhoneIncoming,
  IconPhoneOff,
  IconPhoneX,
  IconRefresh,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import {
  fetchRingCentralAnalytics,
  syncRingCentralAnalytics,
  type RingCentralAnalyticsResponse,
} from "../../lib/ringcentral-analytics";

type AnalyticsResponse = RingCentralAnalyticsResponse;

function formatSeconds(seconds: number) {
  if (seconds <= 0) return "0s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs ? `${mins}m ${secs}s` : `${mins}m`;
}

function queueLabel(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("mobility")) return "Mobility Queue";
  if (lower.includes("network")) return "Network Queue";
  return name;
}

function formatPeriod(value: string, interval: "month" | "week") {
  const date = new Date(`${value}T12:00:00`);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: interval === "month" ? "long" : "short",
    ...(interval === "week" ? { day: "numeric" as const } : {}),
  }).format(date);
  return interval === "week" ? `Week of ${label}` : label;
}

const FIRST_AVAILABLE_MONTH = "2026-10";

function monthOptionsFromOctober() {
  const [startYear, startMonth] = FIRST_AVAILABLE_MONTH.split("-").map(Number);
  const cursor = new Date(startYear, startMonth - 1, 1);
  const current = new Date();
  const options: Array<{ value: string; label: string }> = [];

  while (cursor.getFullYear() < current.getFullYear()
    || (cursor.getFullYear() === current.getFullYear() && cursor.getMonth() <= current.getMonth())) {
    const value = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    options.push({
      value,
      label: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(cursor),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return options;
}

function periodOverlapsMonth(periodStart: string, interval: "month" | "week", month: string) {
  if (interval === "month") return periodStart.slice(0, 7) === month;

  const [year, monthNumber] = month.split("-").map(Number);
  const monthStart = Date.UTC(year, monthNumber - 1, 1);
  const monthEnd = Date.UTC(year, monthNumber, 0);
  const weekStart = Date.parse(`${periodStart}T00:00:00Z`);
  const weekEnd = weekStart + 6 * 24 * 60 * 60 * 1000;
  return weekStart <= monthEnd && weekEnd >= monthStart;
}

function MetricCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: React.ReactNode }) {
  return (
    <Card withBorder radius="md" p="md" style={{ borderTop: `2px solid var(--mantine-color-${color}-6)` }}>
      <Group gap="xs" mb={6}>
        <ThemeIcon size="sm" radius="xl" variant="light" color={color}>{icon}</ThemeIcon>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">{label}</Text>
      </Group>
      <Text size="xl" fw={700} ff="monospace">{value}</Text>
    </Card>
  );
}

export function ZoomCallMetricsWidget() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [interval, setInterval] = useState<"month" | "week">("month");
  const [selectedMonth, setSelectedMonth] = useState(FIRST_AVAILABLE_MONTH);
  const [selectedQueues, setSelectedQueues] = useState<string[] | null>(null);
  const monthOptions = useMemo(() => monthOptionsFromOctober(), []);
  const availableQueues = data?.queues_found ?? [];
  const selectedMonthLabel = monthOptions.find((option) => option.value === selectedMonth)?.label ?? selectedMonth;
  const queueOptions = useMemo(
    () => availableQueues.map((queue) => ({ value: queue, label: queue })),
    [availableQueues],
  );
  const activeQueues = selectedQueues === null
    ? availableQueues
    : selectedQueues.filter((queue) => availableQueues.includes(queue));

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const response = await fetchRingCentralAnalytics();
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setErrorCode(err instanceof Error ? (err as Error & { code?: string }).code ?? null : null);
    } finally {
      setLoading(false);
    }
  }, []);

  const syncLatest = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const response = await syncRingCentralAnalytics();
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setErrorCode(err instanceof Error ? (err as Error & { code?: string }).code ?? null : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const historyRows = data?.history?.[interval === "month" ? "monthly" : "weekly"] ?? [];
  const periodRows = historyRows
    .filter((row) => periodOverlapsMonth(row.period_start, interval, selectedMonth))
    .filter((row) => activeQueues.includes(row.queue_name))
    .sort((a, b) => a.period_start.localeCompare(b.period_start));
  const queueRows = periodRows;
  const totals = useMemo(() => periodRows.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      answered: acc.answered + row.answered,
      abandoned: acc.abandoned + row.abandoned,
      missed: acc.missed + row.missed,
      system_handled: acc.system_handled + row.system_handled,
      ringing_calls: acc.ringing_calls + row.ringing_calls,
      handle_seconds: acc.handle_seconds + row.avg_handle_seconds * row.answered,
      wait_seconds: acc.wait_seconds + row.avg_wait_seconds * row.ringing_calls,
    }),
    { total: 0, answered: 0, abandoned: 0, missed: 0, system_handled: 0, ringing_calls: 0, handle_seconds: 0, wait_seconds: 0 },
  ), [periodRows]);

  const avgHandle = totals.answered > 0 ? totals.handle_seconds / totals.answered : 0;
  const avgWait = totals.ringing_calls > 0 ? totals.wait_seconds / totals.ringing_calls : 0;
  const dateRange = periodRows.length
    ? `${formatPeriod(periodRows[0].period_start, interval)} – ${formatPeriod(periodRows[periodRows.length - 1].period_start, interval)}`
    : "";
  const intervalLabel = interval === "month" ? "Monthly" : "Weekly";

  return (
    <WidgetFrame
      title="RingCentral Call Metrics"
      subtitle={dateRange ? `${intervalLabel} history · ${selectedMonthLabel} · ${dateRange} (Pacific time)` : `${intervalLabel} RingCentral queue call history · ${selectedMonthLabel}`}
      icon={IconPhone}
      iconColor="green"
      loading={loading}
      onRefresh={refresh}
      status={data ? {
        label: data.source === "database" ? "SAVED" : "SYNCED",
        color: data.source === "database" ? "blue" : "green",
        tooltip: `Showing ${data.source === "database" ? "saved database" : "latest RingCentral sync"} ${intervalLabel.toLowerCase()} history (${dateRange || "no saved periods yet"}) for ${activeQueues.length ? activeQueues.join(", ") : "no selected queues"}`,
      } : undefined}
    >
      <Stack gap="lg">
        <Group justify="space-between" align="center" wrap="wrap">
          <Group gap="sm">
            <SegmentedControl
              size="xs"
              value={interval}
              onChange={(value) => setInterval(value as "month" | "week")}
              data={[{ label: "Monthly", value: "month" }, { label: "Weekly", value: "week" }]}
              aria-label="Call history interval"
            />
            <Select
              size="xs"
              w={180}
              value={selectedMonth}
              onChange={(value) => value && setSelectedMonth(value)}
              data={monthOptions}
              aria-label="Select reporting month"
            />
            <MultiSelect
              size="xs"
              w={260}
              value={activeQueues}
              onChange={setSelectedQueues}
              data={queueOptions}
              searchable
              clearable
              disabled={!queueOptions.length}
              placeholder="Choose call queues"
              aria-label="Filter call queues"
            />
            {dateRange && <Text size="sm" c="dimmed">{dateRange} · Pacific time</Text>}
          </Group>
          <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={() => void syncLatest()} loading={loading}>
            Sync latest data
          </Button>
        </Group>
        {data?.warning && queueRows.length > 0 && (
          <Alert icon={<IconAlertTriangle size={16} />} color="yellow" variant="light" radius="md">
            <Text size="sm">{data.warning}</Text>
          </Alert>
        )}
        {error && (
          <Alert icon={<IconAlertTriangle size={16} />} color="red" variant="light" radius="md">
            <Stack gap="xs">
              <Text size="sm">{error}</Text>
              {["RINGCENTRAL_NOT_CONNECTED", "RINGCENTRAL_ANALYTICS_SCOPE_REQUIRED"].includes(errorCode ?? "") && (
                <Button component="a" href="/api/ringcentral/auth-start" size="xs" w="fit-content">
                  {errorCode === "RINGCENTRAL_ANALYTICS_SCOPE_REQUIRED" ? "Reconnect RingCentral" : "Connect RingCentral"}
                </Button>
              )}
            </Stack>
          </Alert>
        )}
        {data && queueRows.length === 0 && !error && (
          <Alert
            icon={<IconAlertTriangle size={16} />}
            color="gray"
            variant="light"
            radius="md"
            title={!availableQueues.length
              ? "No support queues found"
              : !activeQueues.length
                ? "Select at least one call queue"
                : `No ${intervalLabel.toLowerCase()} history for the selected queues`}
          >
            {!availableQueues.length
              ? data.warning ?? "RingCentral is connected, but no Mobility or Network support queues were found."
              : !activeQueues.length
                ? "Choose one or more call queues from the selector to view their history."
                : `No saved ${intervalLabel.toLowerCase()} call records are available for the selected queues in ${selectedMonthLabel}. Use Sync latest data to fetch and store available history from RingCentral.`}
          </Alert>
        )}

        {queueRows.length > 0 && <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="sm">
          <MetricCard label="Total Calls" value={totals.total.toLocaleString()} color="blue" icon={<IconPhoneCall size={14} />} />
          <MetricCard label="Answered" value={totals.answered.toLocaleString()} color="green" icon={<IconPhoneIncoming size={14} />} />
          <MetricCard label="Abandoned" value={totals.abandoned.toLocaleString()} color="red" icon={<IconPhoneX size={14} />} />
          <MetricCard label="Missed" value={totals.missed.toLocaleString()} color="orange" icon={<IconPhoneOff size={14} />} />
          <MetricCard label="Voicemail / Auto" value={totals.system_handled.toLocaleString()} color="gray" icon={<IconPhone size={14} />} />
        </SimpleGrid>}

        {queueRows.length > 0 && <Group gap="xl" wrap="wrap">
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Average Handle</Text>
            <Text size="lg" fw={700} ff="monospace">{formatSeconds(avgHandle)}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Average Wait</Text>
            <Text size="lg" fw={700} ff="monospace">{formatSeconds(avgWait)}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Selected Queues</Text>
            <Group gap="xs" mt={4}>
              {activeQueues.map((queue) => (
                <Badge key={queue} variant="light" color="green">{queueLabel(queue)}</Badge>
              ))}
            </Group>
          </div>
        </Group>}

        {queueRows.length > 0 && <Card withBorder radius="md" p={0}>
          <ScrollArea.Autosize mah={420}>
            {loading && !data ? (
              <Group justify="center" p="xl"><Loader size="sm" /></Group>
            ) : (
              <Table horizontalSpacing="md" verticalSpacing="sm" striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{interval === "month" ? "Month" : "Week"}</Table.Th>
                    <Table.Th>Queue</Table.Th>
                    <Table.Th>Total</Table.Th>
                    <Table.Th>Answered</Table.Th>
                    <Table.Th>Abandoned</Table.Th>
                    <Table.Th>Missed</Table.Th>
                    <Table.Th>Voicemail / Auto</Table.Th>
                    <Table.Th>Avg Handle</Table.Th>
                    <Table.Th>Avg Wait</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {queueRows.map((row) => (
                    <Table.Tr key={`${row.period_start}-${row.queue_name}`}>
                      <Table.Td>{formatPeriod(row.period_start, interval)}</Table.Td>
                      <Table.Td fw={600}>{queueLabel(row.queue_name)}</Table.Td>
                      <Table.Td>{row.total.toLocaleString()}</Table.Td>
                      <Table.Td>{row.answered.toLocaleString()}</Table.Td>
                      <Table.Td>{row.abandoned.toLocaleString()}</Table.Td>
                      <Table.Td>{row.missed.toLocaleString()}</Table.Td>
                      <Table.Td>{row.system_handled.toLocaleString()}</Table.Td>
                      <Table.Td>{formatSeconds(row.avg_handle_seconds)}</Table.Td>
                      <Table.Td>{formatSeconds(row.avg_wait_seconds)}</Table.Td>
                    </Table.Tr>
                  ))}
                  {queueRows.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={9}>
                        <Text size="sm" c="dimmed" ta="center" py="lg">
                          No saved {intervalLabel.toLowerCase()} call history is available yet.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            )}
          </ScrollArea.Autosize>
        </Card>}
      </Stack>
    </WidgetFrame>
  );
}

export { ZoomCallMetricsTile } from "./Tile";
