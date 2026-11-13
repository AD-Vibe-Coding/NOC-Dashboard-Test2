import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  ScrollArea,
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const queueRows = data?.records ?? [];
  const totals = useMemo(() => queueRows.reduce(
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
  ), [queueRows]);

  const avgHandle = totals.answered > 0 ? totals.handle_seconds / totals.answered : 0;
  const avgWait = totals.ringing_calls > 0 ? totals.wait_seconds / totals.ringing_calls : 0;
  const dateRange = data ? `${data.from_date} – ${data.to_date}` : "";

  return (
    <WidgetFrame
      title="RingCentral Call Metrics"
      subtitle={dateRange ? `Last 30 days · ${dateRange} (Pacific time)` : "Rolling last 30 days of queue call analytics"}
      icon={IconPhone}
      iconColor="green"
      loading={loading}
      onRefresh={refresh}
      status={data ? { label: "CONNECTED", color: "green", tooltip: `RingCentral analytics responded successfully. Showing last 30 days (${dateRange}) for Mobility + Network queues` } : undefined}
    >
      <Stack gap="lg">
        <Group justify="space-between" align="center" wrap="wrap">
          <Group gap="xs">
            <Badge variant="light" color="green">Last 30 days</Badge>
            {dateRange && <Text size="sm" c="dimmed">{dateRange} · Pacific time</Text>}
          </Group>
          <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={() => void refresh()} loading={loading}>
            Refresh analytics
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
            title={data.queues_found.length ? "No call records in this period" : "No support queues found"}
          >
            {data.queues_found.length
              ? `RingCentral is connected and returned no inbound call aggregates for ${dateRange}.`
              : data.warning ?? "RingCentral is connected, but no Mobility or Network support queues were found."}
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
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Queues Found</Text>
            <Group gap="xs" mt={4}>
              {(data?.queues_found ?? []).map((queue) => (
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
                    <Table.Tr key={row.queue_name}>
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
                      <Table.Td colSpan={8}>
                        <Text size="sm" c="dimmed" ta="center" py="lg">
                          No queue call analytics were returned for the last 30 days.
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
