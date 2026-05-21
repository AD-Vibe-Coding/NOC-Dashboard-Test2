import { useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Grid,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Table,
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
  IconExternalLink,
  IconRefresh,
  IconSearch,
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
      title="LogicMonitor Alerts"
      subtitle="Real-time alert feed from LogicMonitor"
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
                    .map((a) => (
                      <Table.Tr key={a.id}>
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
