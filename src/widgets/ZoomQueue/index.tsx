import {
  Alert,
  Badge,
  Box,
  Grid,
  Group,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconHeadset,
  IconPhone,
  IconPhoneOff,
  IconVideo,
  IconMessage,
  IconMail,
  IconCircleDot,
  IconUser,
  IconUserCheck,
  IconUserOff,
  IconClockHour4,
} from "@tabler/icons-react";
import {
  ZOOM_CHANNEL_LABELS,
  ZOOM_STATUS_COLORS,
  ZOOM_STATUS_LABELS,
  type ZoomAgent,
} from "../../lib/zoom";
import { formatElapsed, formatTime } from "../../lib/format";
import { WidgetFrame } from "../WidgetFrame";
import { useZoomQueue } from "./data";

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

export function ZoomQueueWidget() {
  const { data, loading, error, tick, refresh } = useZoomQueue();

  const totals = data?.totals;
  const onCall = (data?.agents ?? []).filter((a) => a.status === "on_call");
  const ready = (data?.agents ?? []).filter((a) => a.status === "ready");
  const wrapUp = (data?.agents ?? []).filter((a) => a.status === "wrap_up");
  const notReady = (data?.agents ?? []).filter((a) => a.status === "not_ready");
  const offline = (data?.agents ?? []).filter((a) => a.status === "offline");

  return (
    <WidgetFrame
      title="Zoom Queue Call Availability"
      subtitle={data ? `Queue: ${data.queue_name ?? "—"}` : "Loading…"}
      icon={IconHeadset}
      iconColor="blue"
      loading={loading}
      onRefresh={refresh}
      status={
        data
          ? {
              label: `Zoom: ${data.source}`,
              color: data.source === "live" ? "green" : "yellow",
              tooltip:
                data.source === "live"
                  ? "Live data from Zoom Phone API"
                  : "Zoom credentials not set — showing snapshot. See docs/ZOOM_SETUP.md for the 7 OAuth scopes required.",
            }
          : undefined
      }
    >
      <Stack gap="lg">
        {data?.warning && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="yellow"
            variant="light"
            radius="md"
          >
            {data.warning}
          </Alert>
        )}
        {error && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="red"
            variant="light"
            radius="md"
          >
            Failed to load Zoom data: {error}
          </Alert>
        )}

        {/* Status totals row */}
        <Grid gutter="sm">
          <Grid.Col span={{ base: 6, sm: 4, md: 2.4 }}>
            <TotalCard
              label="On call"
              value={totals?.on_call ?? 0}
              color="red"
              icon={IconPhone}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, sm: 4, md: 2.4 }}>
            <TotalCard
              label="Wrap-up"
              value={totals?.wrap_up ?? 0}
              color="orange"
              icon={IconClockHour4}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, sm: 4, md: 2.4 }}>
            <TotalCard
              label="Ready"
              value={totals?.ready ?? 0}
              color="green"
              icon={IconUserCheck}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, sm: 4, md: 2.4 }}>
            <TotalCard
              label="Not ready"
              value={totals?.not_ready ?? 0}
              color="yellow"
              icon={IconUser}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, sm: 4, md: 2.4 }}>
            <TotalCard
              label="Offline"
              value={totals?.offline ?? 0}
              color="gray"
              icon={IconUserOff}
            />
          </Grid.Col>
        </Grid>

        <Tabs defaultValue="on_call" variant="default" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab
              value="on_call"
              leftSection={<IconPhone size={14} />}
              rightSection={
                onCall.length > 0 ? (
                  <Badge size="sm" circle color="red">
                    {onCall.length}
                  </Badge>
                ) : null
              }
            >
              On call
            </Tabs.Tab>
            <Tabs.Tab value="ready" leftSection={<IconUserCheck size={14} />}>
              Ready ({ready.length})
            </Tabs.Tab>
            <Tabs.Tab value="not_ready" leftSection={<IconUser size={14} />}>
              Not ready ({notReady.length + wrapUp.length})
            </Tabs.Tab>
            <Tabs.Tab value="offline" leftSection={<IconPhoneOff size={14} />}>
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
    </WidgetFrame>
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
