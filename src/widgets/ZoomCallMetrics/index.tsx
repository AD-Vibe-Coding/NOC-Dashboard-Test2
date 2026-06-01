import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
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
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";

type Classified = "answered" | "refused" | "missed";

interface RawRecord {
  idx: number;
  start_time: string;
  queue_name: string;
  call_result_raw: string;
  classified_as: Classified;
  answered_by_name: string;
  duration_seconds: number;
  wait_seconds: number;
}

interface RawResponse {
  source: string;
  month: string;
  from_date: string;
  to_date: string;
  records: RawRecord[];
  totals: { fetched: number; answered: number; refused: number; missed: number };
  queues_found: string[];
  capped?: boolean;
  warning?: string;
}

const MAY_2026 = "2026-05";
const TARGET_QUEUE_MATCHERS = ["mobility tech support", "network tech support"];

function isTargetQueue(name: string) {
  const lower = name.toLowerCase();
  return TARGET_QUEUE_MATCHERS.some((q) => lower.includes(q));
}

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
  const [data, setData] = useState<RawResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/zoom/call-logs-raw?month=${MAY_2026}`);
      const json = (await response.json()) as RawResponse;
      if (!response.ok) throw new Error((json as { error?: string }).error ?? "Failed to load May queue call data.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const queueRows = useMemo(() => {
    const records = (data?.records ?? []).filter((record) => isTargetQueue(record.queue_name));
    const map = new Map<string, {
      queue_name: string;
      fetched: number;
      answered: number;
      refused: number;
      missed: number;
      duration_seconds: number;
      wait_seconds: number;
    }>();

    for (const record of records) {
      const key = queueLabel(record.queue_name);
      const current = map.get(key) ?? {
        queue_name: key,
        fetched: 0,
        answered: 0,
        refused: 0,
        missed: 0,
        duration_seconds: 0,
        wait_seconds: 0,
      };
      current.fetched += 1;
      current.duration_seconds += record.duration_seconds;
      current.wait_seconds += record.wait_seconds;
      current[record.classified_as] += 1;
      map.set(key, current);
    }

    return [...map.values()].sort((a, b) => a.queue_name.localeCompare(b.queue_name));
  }, [data]);

  const totals = useMemo(() => {
    return queueRows.reduce(
      (acc, row) => ({
        fetched: acc.fetched + row.fetched,
        answered: acc.answered + row.answered,
        refused: acc.refused + row.refused,
        missed: acc.missed + row.missed,
        duration_seconds: acc.duration_seconds + row.duration_seconds,
        wait_seconds: acc.wait_seconds + row.wait_seconds,
      }),
      { fetched: 0, answered: 0, refused: 0, missed: 0, duration_seconds: 0, wait_seconds: 0 },
    );
  }, [queueRows]);

  const avgHandle = totals.answered > 0 ? totals.duration_seconds / totals.answered : 0;
  const avgWait = totals.answered > 0 ? totals.wait_seconds / totals.answered : 0;

  return (
    <WidgetFrame
      title="Zoom Call Metrics"
      subtitle="May 2026 queue call data"
      icon={IconPhone}
      iconColor="green"
      loading={loading}
      onRefresh={refresh}
      status={data ? { label: MAY_2026, color: "green", tooltip: "Showing May 2026 for Mobility + Network queues" } : undefined}
    >
      <Stack gap="lg">
        {data?.warning && (
          <Alert icon={<IconAlertTriangle size={16} />} color="yellow" variant="light" radius="md">
            <Text size="sm">{data.warning}</Text>
          </Alert>
        )}
        {error && (
          <Alert icon={<IconAlertTriangle size={16} />} color="red" variant="light" radius="md">
            <Text size="sm">{error}</Text>
          </Alert>
        )}

        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          <MetricCard label="Total Calls" value={totals.fetched.toLocaleString()} color="blue" icon={<IconPhoneCall size={14} />} />
          <MetricCard label="Answered" value={totals.answered.toLocaleString()} color="green" icon={<IconPhoneIncoming size={14} />} />
          <MetricCard label="Refused" value={totals.refused.toLocaleString()} color="red" icon={<IconPhoneX size={14} />} />
          <MetricCard label="Missed" value={totals.missed.toLocaleString()} color="orange" icon={<IconPhoneOff size={14} />} />
        </SimpleGrid>

        <Group gap="xl" wrap="wrap">
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
              {(data?.queues_found ?? []).filter(isTargetQueue).map((queue) => (
                <Badge key={queue} variant="light" color="green">{queueLabel(queue)}</Badge>
              ))}
            </Group>
          </div>
        </Group>

        <Card withBorder radius="md" p={0}>
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
                    <Table.Th>Refused</Table.Th>
                    <Table.Th>Missed</Table.Th>
                    <Table.Th>Avg Handle</Table.Th>
                    <Table.Th>Avg Wait</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {queueRows.map((row) => {
                    const answeredBase = row.answered || 1;
                    return (
                      <Table.Tr key={row.queue_name}>
                        <Table.Td fw={600}>{row.queue_name}</Table.Td>
                        <Table.Td>{row.fetched.toLocaleString()}</Table.Td>
                        <Table.Td>{row.answered.toLocaleString()}</Table.Td>
                        <Table.Td>{row.refused.toLocaleString()}</Table.Td>
                        <Table.Td>{row.missed.toLocaleString()}</Table.Td>
                        <Table.Td>{formatSeconds(row.duration_seconds / answeredBase)}</Table.Td>
                        <Table.Td>{formatSeconds(row.wait_seconds / answeredBase)}</Table.Td>
                      </Table.Tr>
                    );
                  })}
                  {queueRows.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={7}>
                        <Text size="sm" c="dimmed" ta="center" py="lg">
                          No May 2026 records found for the Mobility or Network queues.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            )}
          </ScrollArea.Autosize>
        </Card>
      </Stack>
    </WidgetFrame>
  );
}

export { ZoomCallMetricsTile } from "./Tile";
