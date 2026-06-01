import { useEffect, useMemo, useState } from "react";
import { Badge, Card, Group, Skeleton, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconPhone, IconPhoneIncoming } from "@tabler/icons-react";

type Classified = "answered" | "refused" | "missed";

interface RawRecord {
  queue_name: string;
  classified_as: Classified;
}

interface RawResponse {
  source: string;
  records: RawRecord[];
  warning?: string;
}

const MAY_2026 = "2026-05";
const TARGET_QUEUE_MATCHERS = ["mobility tech support", "network tech support"];

function isTargetQueue(name: string) {
  const lower = name.toLowerCase();
  return TARGET_QUEUE_MATCHERS.some((q) => lower.includes(q));
}

export function ZoomCallMetricsTile() {
  const [data, setData] = useState<RawResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/zoom/call-logs-raw?month=${MAY_2026}`)
      .then((r) => r.json())
      .then((json) => setData(json))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const records = (data?.records ?? []).filter((record) => isTargetQueue(record.queue_name));
    return records.reduce(
      (acc, record) => {
        acc.total += 1;
        acc[record.classified_as] += 1;
        return acc;
      },
      { total: 0, answered: 0, refused: 0, missed: 0 },
    );
  }, [data]);

  return (
    <Card withBorder radius="lg" p="md" h="100%">
      <Stack gap="sm" h="100%">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon radius="md" variant="light" color="green" size="md">
            <IconPhone size={16} />
          </ThemeIcon>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text fw={600} size="sm" truncate>Zoom Call Metrics</Text>
            <Group gap={6}>
              <Text size="xs" c="dimmed">May 2026</Text>
              {data && (
                <Badge size="xs" color={data.source === "live" ? "green" : "yellow"} variant="dot">
                  {data.source === "live" ? "live" : "snapshot"}
                </Badge>
              )}
            </Group>
          </div>
        </Group>

        {loading ? (
          <>
            <Skeleton height={20} radius="sm" />
            <Skeleton height={20} radius="sm" />
            <Skeleton height={20} radius="sm" />
          </>
        ) : (
          <Stack gap={8} style={{ flex: 1 }}>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Mobility + Network queues</Text>
              <Text size="lg" fw={700} ff="monospace">{totals.total.toLocaleString()}</Text>
            </Group>
            <Group justify="space-between">
              <Group gap={6}><IconPhoneIncoming size={14} color="var(--mantine-color-green-4)" /><Text size="sm">Answered</Text></Group>
              <Text size="sm" fw={700} ff="monospace" c="green.4">{totals.answered.toLocaleString()}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm">Refused</Text>
              <Text size="sm" fw={700} ff="monospace" c="red.4">{totals.refused.toLocaleString()}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm">Missed</Text>
              <Text size="sm" fw={700} ff="monospace" c="orange.4">{totals.missed.toLocaleString()}</Text>
            </Group>
            {data?.warning && <Text size="xs" c="dimmed" lineClamp={2}>{data.warning}</Text>}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
