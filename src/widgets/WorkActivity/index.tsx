import { useMemo, useState } from "react";
import {
  Alert,
  Anchor,
  Autocomplete,
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
  IconActivity,
  IconAlertCircle,
  IconBolt,
  IconCheck,
  IconPhone,
  IconPhoneOff,
  IconTicket,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { useIdentity } from "../../lib/identity";
import { NOC_ROSTER } from "../../lib/roster";
import {
  buildMyDayMetrics,
  findUserActivity,
  type MyDayMetrics,
} from "../../lib/work-activity";
import { WidgetFrame } from "../WidgetFrame";
import { useWorkActivity } from "./data";

export { WorkActivityTile } from "./Tile";

export function WorkActivityWidget() {
  const { slack, calls, loading, slackError, callsError, refresh } = useWorkActivity();
  const { identity } = useIdentity();

  const [selected, setSelected] = useState<string>("");
  // Effective user = explicit selection > stored identity > first ranked user
  const effectiveUser = useMemo(() => {
    if (selected) return selected;
    if (identity?.name) return identity.name;
    return "";
  }, [selected, identity]);

  // Fuzzy-resolve to the actual key in the slack response (handles casing)
  const resolved = useMemo(() => {
    if (!effectiveUser) return null;
    return findUserActivity(effectiveUser, slack).matched ?? effectiveUser;
  }, [effectiveUser, slack]);

  const myMetrics: MyDayMetrics | null = useMemo(() => {
    if (!resolved) return null;
    return buildMyDayMetrics(resolved, slack, calls);
  }, [resolved, slack, calls]);

  // Build the team leaderboard — every unique user from either source.
  const leaderboard: MyDayMetrics[] = useMemo(() => {
    const names = new Set<string>([
      ...Object.keys(slack?.by_user ?? {}),
      ...Object.keys(calls?.by_user ?? {}),
      ...NOC_ROSTER, // include offline users so the team picker is comprehensive
    ]);
    const all = Array.from(names).map((u) => buildMyDayMetrics(u, slack, calls));
    // Sort by total activity score (worked + updated + acked + calls)
    all.sort((a, b) => {
      const scoreA = a.worked * 2 + a.updated + a.acked + a.calls_answered;
      const scoreB = b.worked * 2 + b.updated + b.acked + b.calls_answered;
      return scoreB - scoreA;
    });
    return all;
  }, [slack, calls]);

  // Header status: live if both sources are live, mixed if one, snapshot if neither
  const headerStatus = useMemo(() => {
    if (!slack && !calls) return { label: "loading", color: "gray" };
    const slackLive = slack?.source === "live";
    const callsLive = calls?.source === "live";
    if (slackLive && callsLive) {
      return { label: "live", color: "green", tooltip: "Live data from Slack + Zoom" };
    }
    if (slackLive || callsLive) {
      return {
        label: "partial",
        color: "yellow",
        tooltip: `Slack: ${slack?.source ?? "?"} · Zoom: ${calls?.source ?? "?"}`,
      };
    }
    return {
      label: "snapshot",
      color: "yellow",
      tooltip: "Both Slack and Zoom credentials are using fallback data",
    };
  }, [slack, calls]);

  const dayLabel = slack?.day_start
    ? new Date(slack.day_start).toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    : "Today";

  return (
    <WidgetFrame
      title="My Day"
      subtitle={`Today's activity from #${slack?.channel ?? "noc-team"} + Zoom Phone — ${dayLabel}`}
      icon={IconActivity}
      iconColor="indigo"
      loading={loading}
      onRefresh={refresh}
      status={headerStatus}
    >
      <Stack gap="lg">
        {/* Warnings & errors */}
        {(slack?.warning || calls?.warning || slackError || callsError) && (
          <Stack gap={6}>
            {slack?.warning && (
              <Alert
                icon={<IconAlertCircle size={14} />}
                color="yellow"
                variant="light"
                radius="md"
                p="xs"
              >
                <Text size="xs">Slack: {slack.warning}</Text>
              </Alert>
            )}
            {calls?.warning && (
              <Alert
                icon={<IconAlertCircle size={14} />}
                color="yellow"
                variant="light"
                radius="md"
                p="xs"
              >
                <Text size="xs">Zoom: {calls.warning}</Text>
              </Alert>
            )}
            {slackError && (
              <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light" radius="md" p="xs">
                <Text size="xs">Slack request failed: {slackError}</Text>
              </Alert>
            )}
            {callsError && (
              <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light" radius="md" p="xs">
                <Text size="xs">Zoom request failed: {callsError}</Text>
              </Alert>
            )}
          </Stack>
        )}

        {/* User picker */}
        <Group gap="xs" align="flex-end">
          <Autocomplete
            label="Showing activity for"
            value={effectiveUser}
            onChange={setSelected}
            data={NOC_ROSTER}
            placeholder="Pick a teammate"
            leftSection={<IconUser size={14} />}
            style={{ flex: 1, maxWidth: 320 }}
            size="sm"
            limit={20}
          />
          {identity?.name && effectiveUser !== identity.name && (
            <Anchor
              component="button"
              size="xs"
              onClick={() => setSelected(identity.name!)}
              c="dimmed"
            >
              Reset to me ({identity.name})
            </Anchor>
          )}
        </Group>

        {/* Metric cards (per-user) */}
        {myMetrics ? (
          <>
            <Grid gutter="md">
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <MetricCard
                  label="Tickets worked"
                  value={myMetrics.worked}
                  icon={IconTicket}
                  color="indigo"
                  hint={
                    myMetrics.worked_tickets.length > 0
                      ? myMetrics.worked_tickets.slice(0, 3).join(", ") +
                        (myMetrics.worked_tickets.length > 3
                          ? ` +${myMetrics.worked_tickets.length - 3}`
                          : "")
                      : "No 'W' or 'working' posts yet today"
                  }
                />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <MetricCard
                  label="Tickets updated"
                  value={myMetrics.updated}
                  icon={IconCheck}
                  color="teal"
                  hint={
                    myMetrics.updated_tickets.length > 0
                      ? myMetrics.updated_tickets.slice(0, 3).join(", ") +
                        (myMetrics.updated_tickets.length > 3
                          ? ` +${myMetrics.updated_tickets.length - 3}`
                          : "")
                      : "No 'updated' / 'done' posts yet"
                  }
                />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <MetricCard
                  label="Tickets acknowledged"
                  value={myMetrics.acked + myMetrics.assignments_received}
                  icon={IconBolt}
                  color="yellow"
                  hint={
                    myMetrics.acked + myMetrics.assignments_received > 0
                      ? `${myMetrics.acked} ack'd · ${myMetrics.assignments_received} assigned to you`
                      : "No acks or assignments yet"
                  }
                />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <MetricCard
                  label="Calls answered"
                  value={myMetrics.calls_answered}
                  icon={IconPhone}
                  color="blue"
                  hint={
                    myMetrics.calls_answered > 0
                      ? `${myMetrics.call_minutes} min talk time` +
                        (myMetrics.calls_missed > 0 ? ` · ${myMetrics.calls_missed} missed` : "")
                      : myMetrics.calls_missed > 0
                        ? `${myMetrics.calls_missed} missed today`
                        : "No calls answered yet"
                  }
                />
              </Grid.Col>
            </Grid>

            <Tabs defaultValue="my-details" variant="outline" radius="md">
              <Tabs.List>
                <Tabs.Tab value="my-details" leftSection={<IconUser size={12} />}>
                  My activity
                </Tabs.Tab>
                <Tabs.Tab value="team" leftSection={<IconUsers size={12} />}>
                  Team leaderboard
                </Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="my-details" pt="md">
                <DetailedView metrics={myMetrics} resolved={resolved ?? effectiveUser} />
              </Tabs.Panel>

              <Tabs.Panel value="team" pt="md">
                <Leaderboard rows={leaderboard} highlightUser={resolved} />
              </Tabs.Panel>
            </Tabs>
          </>
        ) : (
          <Alert icon={<IconUser size={14} />} color="indigo" variant="light" radius="md">
            <Text size="sm">
              Pick your name above (or set an identity in any widget) to see your activity for today.
            </Text>
          </Alert>
        )}

        {slack && (
          <Text size="xs" c="dimmed" ta="right">
            {slack.message_count} messages parsed · {slack.ticket_event_count} ticket events ·{" "}
            {slack.user_count} contributors · last refreshed{" "}
            {new Date(slack.fetched_at).toLocaleTimeString()}
          </Text>
        )}
      </Stack>
    </WidgetFrame>
  );
}

// =============================================================================
// MetricCard
// =============================================================================

function MetricCard({
  label,
  value,
  icon: Icon,
  color,
  hint,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ size?: number }>;
  color: string;
  hint?: string;
}) {
  return (
    <Card radius="lg" withBorder p="md" h="100%">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {label}
          </Text>
          <ThemeIcon size="sm" radius="md" variant="light" color={color}>
            <Icon size={14} />
          </ThemeIcon>
        </Group>
        <Title order={1} c={color} style={{ lineHeight: 1 }}>
          {value}
        </Title>
        {hint && (
          <Text size="xs" c="dimmed" lineClamp={2} style={{ minHeight: 28 }}>
            {hint}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

// =============================================================================
// DetailedView — chip lists of every ticket + assignment for the selected user
// =============================================================================

function DetailedView({
  metrics,
  resolved,
}: {
  metrics: MyDayMetrics;
  resolved: string;
}) {
  const empty =
    metrics.worked === 0 &&
    metrics.updated === 0 &&
    metrics.acked === 0 &&
    metrics.assignments_received === 0 &&
    metrics.calls_answered === 0;

  if (empty) {
    return (
      <Box p="md" ta="center">
        <Text c="dimmed" size="sm">
          No activity yet today for <strong>{resolved}</strong>. Activity is parsed from{" "}
          <strong>#noc-team</strong> posts like "654604 W", "654477 ack", "654604 updated", and from
          Zoom Phone call logs.
        </Text>
      </Box>
    );
  }

  return (
    <Stack gap="md">
      {metrics.worked_tickets.length > 0 && (
        <Box>
          <Text size="xs" tt="uppercase" fw={600} c="dimmed" mb={4}>
            Worked ({metrics.worked})
          </Text>
          <Group gap={6}>
            {metrics.worked_tickets.map((t) => (
              <Badge
                key={t}
                size="md"
                variant="light"
                color="indigo"
                leftSection={<IconTicket size={10} />}
              >
                {t}
              </Badge>
            ))}
          </Group>
        </Box>
      )}
      {metrics.updated_tickets.length > 0 && (
        <Box>
          <Text size="xs" tt="uppercase" fw={600} c="dimmed" mb={4}>
            Updated ({metrics.updated})
          </Text>
          <Group gap={6}>
            {metrics.updated_tickets.map((t) => (
              <Badge
                key={t}
                size="md"
                variant="light"
                color="teal"
                leftSection={<IconCheck size={10} />}
              >
                {t}
              </Badge>
            ))}
          </Group>
        </Box>
      )}
      {metrics.acked_tickets.length > 0 && (
        <Box>
          <Text size="xs" tt="uppercase" fw={600} c="dimmed" mb={4}>
            Acknowledged ({metrics.acked})
          </Text>
          <Group gap={6}>
            {metrics.acked_tickets.map((t) => (
              <Badge
                key={t}
                size="md"
                variant="light"
                color="yellow"
                leftSection={<IconBolt size={10} />}
              >
                {t}
              </Badge>
            ))}
          </Group>
        </Box>
      )}
      {metrics.assignments_received_list.length > 0 && (
        <Box>
          <Text size="xs" tt="uppercase" fw={600} c="dimmed" mb={4}>
            Assigned to you ({metrics.assignments_received_list.length})
          </Text>
          <Stack gap={4}>
            {metrics.assignments_received_list.map((a, i) => (
              <Group key={`${a.ticket}-${i}`} gap={6} wrap="nowrap">
                {a.priority && (
                  <Badge
                    size="xs"
                    variant="filled"
                    color={
                      a.priority === "P1" ? "red" : a.priority === "P2" ? "orange" : "yellow"
                    }
                  >
                    {a.priority}
                  </Badge>
                )}
                <Badge size="sm" variant="light" color="grape">
                  {a.ticket}
                </Badge>
                <Text size="xs" c="dimmed">
                  from {a.from}
                </Text>
              </Group>
            ))}
          </Stack>
        </Box>
      )}
      {metrics.calls_answered > 0 && (
        <Box>
          <Text size="xs" tt="uppercase" fw={600} c="dimmed" mb={4}>
            Zoom calls
          </Text>
          <Group gap={6}>
            <Badge size="md" variant="light" color="blue" leftSection={<IconPhone size={10} />}>
              {metrics.calls_answered} answered
            </Badge>
            {metrics.calls_missed > 0 && (
              <Badge size="md" variant="light" color="gray" leftSection={<IconPhoneOff size={10} />}>
                {metrics.calls_missed} missed
              </Badge>
            )}
            <Badge size="md" variant="default">
              {metrics.call_minutes} min talk time
            </Badge>
          </Group>
        </Box>
      )}
    </Stack>
  );
}

// =============================================================================
// Leaderboard — full team table sorted by activity
// =============================================================================

function Leaderboard({
  rows,
  highlightUser,
}: {
  rows: MyDayMetrics[];
  highlightUser?: string | null;
}) {
  return (
    <ScrollArea.Autosize mah={420}>
      <Table striped highlightOnHover withTableBorder withColumnBorders fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Teammate</Table.Th>
            <Table.Th ta="right">
              <Tooltip label="Tickets they posted 'W' / 'working' for">
                <span>Worked</span>
              </Tooltip>
            </Table.Th>
            <Table.Th ta="right">
              <Tooltip label="Tickets they posted 'updated' / 'done' for">
                <span>Updated</span>
              </Tooltip>
            </Table.Th>
            <Table.Th ta="right">
              <Tooltip label="Tickets they posted 'ack' for + tickets assigned to them">
                <span>Ack'd</span>
              </Tooltip>
            </Table.Th>
            <Table.Th ta="right">
              <Tooltip label="Inbound Zoom Phone calls they answered">
                <span>Calls</span>
              </Tooltip>
            </Table.Th>
            <Table.Th ta="right">
              <Tooltip label="Slack messages posted to #noc-team today">
                <span>Msgs</span>
              </Tooltip>
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => {
            const isMe = highlightUser && r.user === highlightUser;
            const isInactive =
              r.worked + r.updated + r.acked + r.calls_answered + r.message_count === 0;
            return (
              <Table.Tr
                key={r.user}
                style={
                  isMe
                    ? {
                        background: "var(--mantine-color-indigo-9)",
                        outline: "1px solid var(--mantine-color-indigo-5)",
                      }
                    : isInactive
                      ? { opacity: 0.5 }
                      : undefined
                }
              >
                <Table.Td>
                  <Group gap={4}>
                    {isMe && (
                      <Badge size="xs" variant="filled" color="indigo">
                        you
                      </Badge>
                    )}
                    <Text size="xs" fw={isMe ? 600 : 400}>
                      {r.user}
                    </Text>
                  </Group>
                </Table.Td>
                <Table.Td ta="right" ff="monospace">
                  {r.worked || ""}
                </Table.Td>
                <Table.Td ta="right" ff="monospace">
                  {r.updated || ""}
                </Table.Td>
                <Table.Td ta="right" ff="monospace">
                  {r.acked + r.assignments_received || ""}
                </Table.Td>
                <Table.Td ta="right" ff="monospace">
                  {r.calls_answered || ""}
                </Table.Td>
                <Table.Td ta="right" ff="monospace" c="dimmed">
                  {r.message_count || ""}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  );
}
