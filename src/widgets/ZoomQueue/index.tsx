import {
  Alert,
  Badge,
  Box,
  Card,
  Grid,
  Group,
  ScrollArea,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCalendarStats,
  IconCircleDot,
  IconHeadset,
  IconClockHour4,
  IconMail,
  IconMessage,
  IconPhone,
  IconPhoneOff,
  IconToggleLeft,
  IconUser,
  IconUserCheck,
  IconUserOff,
  IconVideo,
} from "@tabler/icons-react";
import {
  ZOOM_CHANNEL_LABELS,
  ZOOM_STATUS_COLORS,
  ZOOM_STATUS_LABELS,
  type ZoomAgent,
} from "../../lib/zoom";
import { formatElapsed, formatTime } from "../../lib/format";
import { WidgetFrame } from "../WidgetFrame";
import { useZoomQueue, type AvailabilityData } from "./data";

export { ZoomQueueTile } from "./Tile";

const CHANNEL_ICONS: Record<
  NonNullable<ZoomAgent["engagement_channel"]>,
  React.ComponentType<{ size?: number }>
> = {
  voice: IconPhone,
  video: IconVideo,
  chat: IconMessage,
  sms: IconMessage,
  email: IconMail,
};

// ── Queue names displayed in the opt-in table ─────────────────────────────────
const TRACKED_QUEUES = ["Network Tech Support", "Mobility Tech Support"];
const QUEUE_SHORT: Record<string, string> = {
  "Network Tech Support": "NOC",
  "Mobility Tech Support": "Mobility",
};

// ── Main widget ───────────────────────────────────────────────────────────────
export function ZoomQueueWidget() {
  const { data, availability, loading, error, tick, refresh } = useZoomQueue();

  const totals = data?.totals;
  const onCall   = (data?.agents ?? []).filter((a) => a.status === "on_call");
  const ready    = (data?.agents ?? []).filter((a) => a.status === "ready");
  const wrapUp   = (data?.agents ?? []).filter((a) => a.status === "wrap_up");
  const notReady = (data?.agents ?? []).filter((a) => a.status === "not_ready");
  const offline  = (data?.agents ?? []).filter((a) => a.status === "offline");

  return (
    <WidgetFrame
      title="Zoom Queue"
      subtitle={data ? `${data.queue_name ?? "NOC + Mobility"} · ${data.agents.length} agents` : "Loading…"}
      icon={IconHeadset}
      iconColor="blue"
      loading={loading}
      onRefresh={refresh}
      status={
        data
          ? {
              label: `Zoom: ${data.source}`,
              color: data.source === "live" ? "green" : "yellow",
              tooltip: data.source === "live"
                ? "Live data from Zoom Phone API"
                : "Zoom credentials not set — showing snapshot.",
            }
          : undefined
      }
    >
      <Stack gap="md">
        {data?.warning && (
          <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light" radius="md">
            {data.warning}
          </Alert>
        )}
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" radius="md">
            Failed to load Zoom data: {error}
          </Alert>
        )}

        <Tabs defaultValue="live" variant="default" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="live" leftSection={<IconPhone size={14} />}>Live Status</Tabs.Tab>
            <Tabs.Tab value="optin" leftSection={<IconToggleLeft size={14} />}>Queue Opt-In</Tabs.Tab>
            <Tabs.Tab value="timeline" leftSection={<IconCalendarStats size={14} />}>Today's Availability</Tabs.Tab>
          </Tabs.List>

          {/* ── Live Status tab ─────────────────────────────── */}
          <Tabs.Panel value="live" pt="md">
            <Stack gap="md">
              {/* KPI cards */}
              <Grid gutter="sm">
                {[
                  { label: "On call",   value: totals?.on_call   ?? 0, color: "red",    icon: IconPhone      },
                  { label: "Wrap-up",   value: totals?.wrap_up   ?? 0, color: "orange", icon: IconClockHour4 },
                  { label: "Ready",     value: totals?.ready     ?? 0, color: "green",  icon: IconUserCheck  },
                  { label: "Not ready", value: totals?.not_ready ?? 0, color: "yellow", icon: IconUser       },
                  { label: "Offline",   value: totals?.offline   ?? 0, color: "gray",   icon: IconUserOff    },
                ].map(({ label, value, color, icon }) => (
                  <Grid.Col key={label} span={{ base: 6, sm: 4, md: 2.4 }}>
                    <TotalCard label={label} value={value} color={color} icon={icon} />
                  </Grid.Col>
                ))}
              </Grid>

              <Tabs defaultValue="on_call" variant="pills" keepMounted={false}>
                <Tabs.List>
                  <Tabs.Tab value="on_call" leftSection={<IconPhone size={13} />}
                    rightSection={onCall.length > 0 ? <Badge size="xs" circle color="red">{onCall.length}</Badge> : null}>
                    On call
                  </Tabs.Tab>
                  <Tabs.Tab value="ready" leftSection={<IconUserCheck size={13} />}>
                    Ready ({ready.length})
                  </Tabs.Tab>
                  <Tabs.Tab value="not_ready" leftSection={<IconUser size={13} />}>
                    Not ready ({notReady.length + wrapUp.length})
                  </Tabs.Tab>
                  <Tabs.Tab value="offline" leftSection={<IconPhoneOff size={13} />}>
                    Offline ({offline.length})
                  </Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="on_call" pt="md">
            {onCall.length === 0 ? (
              <Empty
                icon={IconPhoneOff}
                label="Nobody is on a call right now."
              />
            ) : (
              <Table verticalSpacing="sm" horizontalSpacing="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Agent</Table.Th>
                    <Table.Th>Channel</Table.Th>
                    <Table.Th>Call started</Table.Th>
                    <Table.Th>Talking for</Table.Th>
                    <Table.Th>Status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {onCall.map((a, idx) => {
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    tick;
                    const ChannelIcon = a.engagement_channel
                      ? CHANNEL_ICONS[a.engagement_channel]
                      : IconPhone;
                    return (
                      <Table.Tr key={`on-call-${a.agent_id}-${a.display_name}-${idx}`}>
                        <Table.Td>
                          <Text fw={500}>{a.display_name}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <ThemeIcon
                              size="xs"
                              variant="light"
                              color="red"
                              radius="xl"
                            >
                              <ChannelIcon size={10} />
                            </ThemeIcon>
                            <Text size="sm" c="dimmed">
                              {a.engagement_channel
                                ? ZOOM_CHANNEL_LABELS[a.engagement_channel]
                                : "Voice"}
                            </Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">
                            {a.engagement_started_at
                              ? formatTime(new Date(a.engagement_started_at))
                              : "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text
                            size="sm"
                            fw={600}
                            ff="monospace"
                            c={
                              a.engagement_started_at &&
                              Date.now() - a.engagement_started_at > 15 * 60 * 1000
                                ? "red"
                                : undefined
                            }
                          >
                            {a.engagement_started_at
                              ? formatElapsed(a.engagement_started_at)
                              : "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            variant="filled"
                            color="red"
                            leftSection={<IconCircleDot size={10} />}
                          >
                            {ZOOM_STATUS_LABELS[a.status]}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="ready" pt="md">
            {ready.length === 0 ? (
              <Empty
                icon={IconUserOff}
                label="No agents are currently ready."
              />
            ) : (
              <AgentTable agents={ready} tick={tick} />
            )}
          </Tabs.Panel>

          <Tabs.Panel value="not_ready" pt="md">
            {wrapUp.length + notReady.length === 0 ? (
              <Empty
                icon={IconUserCheck}
                label="No agents are in wrap-up or not-ready."
              />
            ) : (
              <AgentTable
                agents={[...wrapUp, ...notReady]}
                tick={tick}
                showSubStatus
              />
            )}
          </Tabs.Panel>

                <Tabs.Panel value="offline" pt="md">
                  {offline.length === 0 ? (
                    <Empty icon={IconUserCheck} label="Everyone is logged in." />
                  ) : (
                    <AgentTable agents={offline} tick={tick} showSubStatus />
                  )}
                </Tabs.Panel>
              </Tabs>

              {data && (
                <Text size="xs" c="dimmed" ta="right">
                  {data.agents.length} agents · last refreshed{" "}
                  {new Date(data.fetched_at).toLocaleTimeString()}
                </Text>
              )}
            </Stack>
          </Tabs.Panel>

          {/* ── Queue Opt-In tab ────────────────────────────── */}
          <Tabs.Panel value="optin" pt="md">
            <QueueOptInTab agents={data?.agents ?? []} />
          </Tabs.Panel>

          {/* ── Today's Availability tab ─────────────────────── */}
          <Tabs.Panel value="timeline" pt="md">
            <TodayTimelineTab agents={data?.agents ?? []} availability={availability} />
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </WidgetFrame>
  );
}

// ── Queue Opt-In tab ──────────────────────────────────────────────────────────

function QueueOptInTab({ agents }: { agents: ZoomAgent[] }) {
  // Filter out "NOC Call Que Overflow" and similar non-person entries
  const realAgents = agents.filter((a) => !a.display_name.toLowerCase().includes("overflow"));

  // Build set of all queue names seen
  const allQueues = TRACKED_QUEUES.filter((q) =>
    realAgents.some((a) => a.queue_opt_in && q in a.queue_opt_in),
  );

  // Per-queue opted-in counts
  const queueCounts = Object.fromEntries(
    allQueues.map((q) => [
      q,
      realAgents.filter((a) => a.queue_opt_in?.[q] === true).length,
    ]),
  );

  // Sort: opted-in to any queue first, then alpha
  const sorted = [...realAgents].sort((a, b) => {
    const aIn = allQueues.some((q) => a.queue_opt_in?.[q] === true);
    const bIn = allQueues.some((q) => b.queue_opt_in?.[q] === true);
    if (aIn !== bIn) return aIn ? -1 : 1;
    return a.display_name.localeCompare(b.display_name);
  });

  if (realAgents.length === 0) {
    return <Empty icon={IconUserOff} label="No agent data available." />;
  }

  return (
    <Stack gap="md">
      {/* Summary pills */}
      <Group gap="md" wrap="wrap">
        {allQueues.map((q) => (
          <Card key={q} withBorder radius="md" p="sm" style={{ minWidth: 160 }}>
            <Text size="xs" c="dimmed" fw={600} tt="uppercase">{QUEUE_SHORT[q] ?? q}</Text>
            <Group gap={6} mt={4} align="baseline">
              <Text size="xl" fw={700} c="green.4" ff="monospace">{queueCounts[q]}</Text>
              <Text size="xs" c="dimmed">/ {realAgents.length} opted in</Text>
            </Group>
          </Card>
        ))}
      </Group>

      {/* Agent table */}
      <Card withBorder radius="md" p={0}>
        <ScrollArea>
          <Table fz="sm" horizontalSpacing="md" verticalSpacing="sm" striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Agent</Table.Th>
                {allQueues.map((q) => (
                  <Table.Th key={q}>{QUEUE_SHORT[q] ?? q} Queue</Table.Th>
                ))}
                <Table.Th>Live Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sorted.map((a) => (
                <Table.Tr key={a.agent_id}>
                  <Table.Td>
                    <Text fw={500} size="sm">{a.display_name}</Text>
                  </Table.Td>
                  {allQueues.map((q) => {
                    const isIn = a.queue_opt_in?.[q] === true;
                    const notInQueue = !(q in (a.queue_opt_in ?? {}));
                    return (
                      <Table.Td key={q}>
                        {notInQueue ? (
                          <Text size="xs" c="dimmed">—</Text>
                        ) : isIn ? (
                          <Badge size="sm" color="green" variant="light">✅ Opted In</Badge>
                        ) : (
                          <Badge size="sm" color="gray" variant="light">⏸ Out</Badge>
                        )}
                      </Table.Td>
                    );
                  })}
                  <Table.Td>
                    <Badge size="sm" variant="light" color={ZOOM_STATUS_COLORS[a.status]}>
                      {ZOOM_STATUS_LABELS[a.status]}
                      {a.sub_status ? ` · ${a.sub_status}` : ""}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Card>

      <Text size="xs" c="dimmed">
        ℹ️ Opt-in status reflects each agent's <Text component="span" ff="monospace" size="xs">receive_call</Text> flag in Zoom Phone. Agents can toggle this themselves from their Zoom Phone client.
      </Text>
    </Stack>
  );
}

// ── Today's Availability tab ──────────────────────────────────────────────────

function TodayTimelineTab({
  agents,
  availability,
}: {
  agents: ZoomAgent[];
  availability: AvailabilityData | null;
}) {
  const now = new Date();

  // Current PST hour
  const currentHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric", hour12: false,
    }).format(now),
    10,
  );

  // Show hours from 6am to current hour (or at least 8am)
  const startHour = 6;
  const endHour   = Math.max(currentHour, 14);
  const hours     = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);

  function fmtHour(h: number): string {
    if (h === 0 || h === 24) return "12am";
    if (h === 12) return "12pm";
    return h < 12 ? `${h}am` : `${h - 12}pm`;
  }

  // Real agents only
  const realAgents = agents.filter((a) => !a.display_name.toLowerCase().includes("overflow"));

  // Merge: for current hour use live data; for past hours use DB snapshots
  // agent_name → queue_name → hour → boolean
  const merged: Record<string, Record<string, Record<number, boolean | null>>> = {};

  // Seed from availability DB data
  if (availability?.agents) {
    for (const [agentName, queues] of Object.entries(availability.agents)) {
      merged[agentName] = {};
      for (const [queueName, byHour] of Object.entries(queues)) {
        merged[agentName][queueName] = {};
        for (const [hourStr, val] of Object.entries(byHour)) {
          merged[agentName][queueName][parseInt(hourStr, 10)] = val;
        }
      }
    }
  }

  // Override current hour with live queue_opt_in data
  for (const agent of realAgents) {
    if (!agent.queue_opt_in) continue;
    if (!merged[agent.display_name]) merged[agent.display_name] = {};
    for (const [queueName, rcv] of Object.entries(agent.queue_opt_in)) {
      if (!merged[agent.display_name][queueName]) merged[agent.display_name][queueName] = {};
      merged[agent.display_name][queueName][currentHour] = rcv;
    }
  }

  // Sort agents: those with any data first, then alpha
  const sortedAgents = [...realAgents].sort((a, b) =>
    a.display_name.localeCompare(b.display_name),
  );

  const allQueues = TRACKED_QUEUES.filter((q) =>
    realAgents.some((a) => a.queue_opt_in && q in a.queue_opt_in),
  );

  if (sortedAgents.length === 0) {
    return <Empty icon={IconCalendarStats} label="No agent data available." />;
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Today's queue opt-in history per agent · PST timezone
          {availability ? ` · data from ${availability.date}` : " · polling every 5 min"}
        </Text>
        <Group gap={12}>
          <Group gap={4}>
            <Box w={12} h={12} style={{ borderRadius: 3, background: "var(--mantine-color-green-6)" }} />
            <Text size="xs" c="dimmed">Opted in</Text>
          </Group>
          <Group gap={4}>
            <Box w={12} h={12} style={{ borderRadius: 3, background: "var(--mantine-color-dark-5)" }} />
            <Text size="xs" c="dimmed">Out</Text>
          </Group>
          <Group gap={4}>
            <Box w={12} h={12} style={{ borderRadius: 3, background: "var(--mantine-color-dark-7)", border: "1px dashed var(--mantine-color-dark-4)" }} />
            <Text size="xs" c="dimmed">No data</Text>
          </Group>
        </Group>
      </Group>

      {allQueues.map((queueName) => (
        <Card key={queueName} withBorder radius="md" p="sm">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="xs">
            {QUEUE_SHORT[queueName] ?? queueName} Queue
          </Text>
          <ScrollArea>
            <Box style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "4px 8px", minWidth: 160, fontSize: 12, color: "var(--mantine-color-dimmed)" }}>
                      Agent
                    </th>
                    {hours.map((h) => (
                      <th key={h} style={{
                        padding: "4px 4px",
                        fontSize: 11,
                        color: h === currentHour ? "var(--mantine-color-blue-4)" : "var(--mantine-color-dimmed)",
                        fontWeight: h === currentHour ? 700 : 400,
                        minWidth: 38,
                        textAlign: "center",
                      }}>
                        {fmtHour(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedAgents
                    .filter((a) => a.queue_opt_in && queueName in a.queue_opt_in)
                    .map((agent) => {
                      const agentData = merged[agent.display_name]?.[queueName] ?? {};
                      return (
                        <tr key={agent.agent_id}>
                          <td style={{ padding: "3px 8px", fontSize: 13, fontWeight: 500 }}>
                            {agent.display_name}
                          </td>
                          {hours.map((h) => {
                            const val = agentData[h] ?? null;
                            const isNow = h === currentHour;
                            let bg = "var(--mantine-color-dark-7)";
                            let border = "1px dashed var(--mantine-color-dark-4)";
                            if (val === true) { bg = "var(--mantine-color-green-9)"; border = "1px solid var(--mantine-color-green-7)"; }
                            if (val === false) { bg = "var(--mantine-color-dark-5)"; border = "1px solid var(--mantine-color-dark-4)"; }
                            return (
                              <td key={h} style={{ padding: "3px 4px", textAlign: "center" }}>
                                <Tooltip
                                  withinPortal
                                  label={`${agent.display_name} · ${fmtHour(h)} · ${val === null ? "no data" : val ? "Opted in" : "Out of queue"}`}
                                >
                                  <Box
                                    style={{
                                      width: 28, height: 20, borderRadius: 4,
                                      background: bg, border,
                                      margin: "0 auto",
                                      outline: isNow ? "2px solid var(--mantine-color-blue-6)" : undefined,
                                    }}
                                  />
                                </Tooltip>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </Box>
          </ScrollArea>
        </Card>
      ))}

      {!availability && (
        <Text size="xs" c="dimmed" ta="center">
          Timeline data builds up as the widget polls the queue every 5 minutes. Come back later to see the full day's history.
        </Text>
      )}
    </Stack>
  );
}

// --- helpers ---------------------------------------------------------------

function TotalCard({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ComponentType<{ size?: number }>;
}) {
  return (
    <Box
      p="sm"
      style={{
        border: "1px solid var(--mantine-color-dark-4)",
        borderRadius: 10,
      }}
    >
      <Group justify="space-between" wrap="nowrap" gap={8}>
        <Box style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} truncate>
            {label}
          </Text>
          <Title order={3} mt={0}>
            {value}
          </Title>
        </Box>
        <ThemeIcon size="md" radius="md" variant="light" color={color}>
          <Icon size={16} />
        </ThemeIcon>
      </Group>
    </Box>
  );
}

function AgentTable({
  agents,
  tick,
  showSubStatus,
}: {
  agents: ZoomAgent[];
  tick: number;
  showSubStatus?: boolean;
}) {
  return (
    <Table verticalSpacing="sm" horizontalSpacing="md">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Agent</Table.Th>
          <Table.Th>Status</Table.Th>
          {showSubStatus && <Table.Th>Reason</Table.Th>}
          <Table.Th>Since</Table.Th>
          <Table.Th>Duration</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {agents.map((a, idx) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          tick;
          return (
            <Table.Tr key={`zoom-agent-${a.agent_id}-${a.display_name}-${idx}`}>
              <Table.Td>
                <Text fw={500}>{a.display_name}</Text>
              </Table.Td>
              <Table.Td>
                <Badge variant="light" color={ZOOM_STATUS_COLORS[a.status]}>
                  {ZOOM_STATUS_LABELS[a.status]}
                </Badge>
              </Table.Td>
              {showSubStatus && (
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {a.sub_status ?? "—"}
                  </Text>
                </Table.Td>
              )}
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {formatTime(new Date(a.status_changed_at))}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" fw={500} ff="monospace">
                  {formatElapsed(a.status_changed_at)}
                </Text>
              </Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

function Empty({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
}) {
  return (
    <Box p="xl" ta="center">
      <ThemeIcon size={40} radius="xl" variant="light" color="gray" mx="auto">
        <Icon size={20} />
      </ThemeIcon>
      <Text mt="sm" c="dimmed">
        {label}
      </Text>
    </Box>
  );
}
