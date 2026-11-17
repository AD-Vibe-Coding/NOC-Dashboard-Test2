import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Group, Skeleton, Stack, Text, ThemeIcon, ActionIcon } from "@mantine/core";
import { IconAlertTriangle, IconPhone, IconPhoneIncoming, IconRefresh } from "@tabler/icons-react";
import { fetchRingCentralAnalytics, type RingCentralAnalyticsResponse } from "../../lib/ringcentral-analytics";

type AnalyticsError = { message: string; code?: string };

export function ZoomCallMetricsTile() {
  const [data, setData] = useState<RingCentralAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AnalyticsError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchRingCentralAnalytics());
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : String(err),
        code: err instanceof Error ? (err as Error & { code?: string }).code : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => (data?.records ?? []).reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      answered: acc.answered + row.answered,
      abandoned: acc.abandoned + row.abandoned,
      missed: acc.missed + row.missed,
      system_handled: acc.system_handled + row.system_handled,
    }),
    { total: 0, answered: 0, abandoned: 0, missed: 0, system_handled: 0 },
  ), [data]);

  const notConnected = error?.code === "RINGCENTRAL_NOT_CONNECTED";
  const permissionIssue = error?.code === "RINGCENTRAL_ANALYTICS_SCOPE_REQUIRED";

  return (
    <Card withBorder radius="lg" p="md" h="100%">
      <Stack gap="sm" h="100%">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon radius="md" variant="light" color="green" size="md">
            <IconPhone size={16} />
          </ThemeIcon>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text fw={600} size="sm" truncate>RingCentral Call Metrics</Text>
            <Group gap={6}>
              {data && <Badge size="xs" color="green" variant="dot">Connected</Badge>}
              <Badge size="xs" variant="light">{data?.records.length ? "Latest stored month" : "Saved history"}</Badge>
              {data && <Text size="xs" c="dimmed">{data.from_date} – {data.to_date}</Text>}
            </Group>
          </div>
          <ActionIcon aria-label="Reload saved RingCentral call history" variant="subtle" onClick={() => void load()} loading={loading}>
            <IconRefresh size={16} />
          </ActionIcon>
        </Group>

        {error && (
          <Alert color={permissionIssue ? "yellow" : "red"} icon={<IconAlertTriangle size={16} />} title={permissionIssue ? "Analytics permission required" : "RingCentral analytics unavailable"}>
            <Stack gap={6}>
              <Text size="xs">{error.message}</Text>
              {(notConnected || permissionIssue) && (
                <Button component="a" href="/api/ringcentral/auth-start" size="compact-xs" variant="light" color={permissionIssue ? "yellow" : "red"} w="fit-content">
                  {permissionIssue ? "Reconnect RingCentral" : "Connect RingCentral"}
                </Button>
              )}
            </Stack>
          </Alert>
        )}

        {loading && !data ? (
          <>
            <Skeleton height={20} radius="sm" />
            <Skeleton height={20} radius="sm" />
            <Skeleton height={20} radius="sm" />
          </>
        ) : data && data.records.length === 0 ? (
          <Alert color="gray" icon={<IconAlertTriangle size={16} />} title={data.queues_found.length ? "No call records in this period" : "No support queues found"}>
            <Text size="xs">{data.queues_found.length
              ? `RingCentral is connected and returned no inbound call records for ${data.from_date} – ${data.to_date}.`
              : data.warning ?? "RingCentral is connected, but no Mobility or Network support queues were found."}</Text>
          </Alert>
        ) : data ? (
          <Stack gap={8} style={{ flex: 1 }}>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">{data.queues_found.length ? data.queues_found.join(" + ") : "Mobility + Network queues"}</Text>
              <Text size="lg" fw={700} ff="monospace">{totals.total.toLocaleString()}</Text>
            </Group>
            <Group justify="space-between">
              <Group gap={6}><IconPhoneIncoming size={14} color="var(--mantine-color-green-4)" /><Text size="sm">Answered</Text></Group>
              <Text size="sm" fw={700} ff="monospace" c="green.4">{totals.answered.toLocaleString()}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm">Abandoned</Text>
              <Text size="sm" fw={700} ff="monospace" c="red.4">{totals.abandoned.toLocaleString()}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm">Missed</Text>
              <Text size="sm" fw={700} ff="monospace" c="orange.4">{totals.missed.toLocaleString()}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm">Voicemail / auto-response</Text>
              <Text size="sm" fw={700} ff="monospace" c="dimmed">{totals.system_handled.toLocaleString()}</Text>
            </Group>
            {data.warning && <Text size="xs" c="dimmed" lineClamp={2}>{data.warning}</Text>}
          </Stack>
        ) : !loading ? (
          <Text size="sm" c="dimmed">Connect RingCentral to load call analytics for the last 30 days.</Text>
        ) : null}
      </Stack>
    </Card>
  );
}
