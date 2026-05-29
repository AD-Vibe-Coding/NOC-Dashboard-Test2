import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Grid,
  Group,
  Select,
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
  IconBrandSlack,
  IconCoffee,
  IconHistory,
  IconLock,
  IconPlayerPlay,
  IconPlayerStop,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { db, schema } from "../../db";
import {
  BREAK_TYPE_COLORS,
  emojiForBreak,
  formatBreakStartMessage,
  postSlackMessage,
} from "../../lib/slack";
import { useIdentity } from "../../lib/identity";
import {
  formatDateTime,
  formatElapsedIso,
  formatTime,
} from "../../lib/format";
import { WidgetFrame } from "../WidgetFrame";
import { LOCKED_TEAM_NAMES } from "../PerformanceTracker/team";
import { useBreakData } from "./data";

export { BreakTrackerTile } from "./Tile";

type Break = typeof schema.breaks.$inferSelect;

type Toast = {
  id: number;
  color: "green" | "yellow" | "red" | "blue";
  title: string;
  body?: string;
};

const BREAK_TYPES = [
  { value: "Coffee", label: "☕ Coffee" },
  { value: "Lunch", label: "🍽️ Lunch" },
  { value: "Restroom", label: "🚻 Restroom" },
  { value: "Personal", label: "👤 Personal" },
  { value: "Other", label: "⏸️ Other" },
];

export function BreakTrackerWidget() {
  const { ready, active, history, tick, refresh } = useBreakData();

  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const effectiveName = (
    isManager ? (selectedName ?? identity?.name ?? "") : (identity?.name ?? "")
  ).trim();

  const [breakType, setBreakType] = useState<string | null>("Coffee");
  const [posting, setPosting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function showToast(t: Omit<Toast, "id">) {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((x) => x.id !== id)),
      5000,
    );
  }

  async function startBreak() {
    const trimmed = effectiveName;
    if (!trimmed || !breakType) return;

    setPosting(true);

    // Bot posts with username override (chat:write.customize) so Slack
    // already shows the person's name as the sender — keep message clean.
    const slackText = formatBreakStartMessage(breakType);

    let slackTs: string | null = null;
    let slackPosted = false;
    try {
      const result = await postSlackMessage(slackText, {
        username: trimmed,
        icon_emoji: emojiForBreak(breakType),
      });
      slackTs = result.ts ?? null;
      slackPosted = !!result.posted;
      if (result.posted) {
        showToast({
          color: "green",
          title: `Posted to #${result.channel ?? "noc-team"} as ${trimmed}`,
          body: result.warning
            ? `${slackText}\n${result.warning}`
            : `"${slackText}"`,
        });
      } else if (result.demo) {
        showToast({
          color: "yellow",
          title: "Demo mode — Slack post simulated",
          body:
            result.warning ?? "Set SLACK_BOT_TOKEN in .env to post for real.",
        });
      } else {
        showToast({
          color: "red",
          title: "Slack post failed",
          body: result.error ?? "Unknown error",
        });
      }
    } catch (err) {
      showToast({
        color: "red",
        title: "Slack post failed",
        body: err instanceof Error ? err.message : String(err),
      });
    }

    await db.breaks.insert({
      employee_name: trimmed,
      break_type: breakType,
      start_time: new Date().toISOString(),
      is_active: true,
      slack_message_ts: slackTs,
      slack_posted: slackPosted,
    });
    setPosting(false);
    refresh();
  }

  async function endBreak(b: Break) {
    const viewerName = identity?.name?.trim();
    const breakOwner = b.employee_name.trim();
    if (!isManager && (!viewerName || viewerName !== breakOwner)) {
      showToast({
        color: "red",
        title: "You can only end your own break",
        body: "Only managers can end another user's break.",
      });
      return;
    }

    const end = new Date();
    const start = new Date(b.start_time);
    const duration = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 60000),
    );
    setPosting(true);

    const threadTs =
      b.slack_message_ts && !b.slack_message_ts.startsWith("demo-")
        ? b.slack_message_ts
        : null;
    const slackText = "Back";
    try {
      const result = await postSlackMessage(slackText, {
        thread_ts: threadTs,
        username: b.employee_name,
        icon_emoji: ":arrow_backward:",
      });
      if (result.posted) {
        showToast({
          color: "blue",
          title: `Posted "Back" to #${result.channel ?? "noc-team"} as ${b.employee_name}`,
          body: threadTs
            ? "Replied in thread on the original break message."
            : `"${slackText}"`,
        });
      } else if (result.demo) {
        showToast({
          color: "yellow",
          title: "Demo mode — Slack post simulated",
          body:
            result.warning ?? "Set SLACK_BOT_TOKEN in .env to post for real.",
        });
      } else {
        showToast({
          color: "red",
          title: "Slack post failed",
          body: result.error ?? "Unknown error",
        });
      }
    } catch (err) {
      showToast({
        color: "red",
        title: "Slack post failed",
        body: err instanceof Error ? err.message : String(err),
      });
    }

    await db.breaks.updateById(b.id, {
      end_time: end.toISOString(),
      duration_minutes: duration,
      is_active: false,
    });
    setPosting(false);
    refresh();
  }

  const avgDuration =
    history.length > 0
      ? Math.round(
          history.reduce((sum, h) => sum + (h.duration_minutes ?? 0), 0) /
            history.length,
        )
      : 0;

  const todayCount = useMemo(() => {
    const now = new Date();
    return history.filter((h) => {
      const d = new Date(h.start_time);
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      );
    }).length;
  }, [history]);

  return (
    <WidgetFrame
      title="Break Tracker"
      subtitle="Posts to Slack #noc-team · tracks locally"
      icon={IconCoffee}
      iconColor="orange"
      onRefresh={refresh}
    >
      {/* Toast stack */}
      <Box
        style={{
          position: "fixed",
          top: 76,
          right: 16,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 380,
        }}
      >
        {toasts.map((t) => (
          <Alert
            key={t.id}
            color={t.color}
            icon={
              t.color === "red" ? (
                <IconAlertCircle size={16} />
              ) : (
                <IconBrandSlack size={16} />
              )
            }
            title={t.title}
            variant="filled"
            radius="md"
            withCloseButton
            onClose={() =>
              setToasts((prev) => prev.filter((x) => x.id !== t.id))
            }
            styles={{ root: { boxShadow: "0 8px 24px rgba(0,0,0,0.3)" } }}
          >
            {t.body}
          </Alert>
        ))}
      </Box>

      <Stack gap="lg">
        {/* Inline stats row */}
        <Grid gutter="md">
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <StatCard
              label="On Break Now"
              value={active.length}
              hint={
                active.length === 0
                  ? "Nobody on a break"
                  : `${active.length} currently away`
              }
              color="green"
              icon={IconUsers}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <StatCard
              label="Breaks Today"
              value={todayCount}
              hint="Completed today"
              color="blue"
              icon={IconHistory}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <StatCard
              label="Avg Duration"
              value={`${avgDuration} min`}
              hint="Across completed breaks"
              color="violet"
              icon={IconCoffee}
            />
          </Grid.Col>
        </Grid>

        {/* Identity prompt — shown only on first visit until the user signs in
            via the header. */}
        {!identity?.name && (
          <Box
            p="md"
            style={{
              border: "1px dashed var(--mantine-color-orange-7)",
              borderRadius: 12,
              background: "var(--mantine-color-dark-7)",
            }}
          >
            <Stack gap="sm">
              <Group gap="xs">
                <ThemeIcon variant="light" radius="md" color="orange" size="sm">
                  <IconUser size={12} />
                </ThemeIcon>
                <Text fw={600} size="sm">
                  Sign in to track breaks
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                Click the <b>Sign in</b> button at the top right to sign in
                with your username and password (or create an account on
                first use). Your name is then used everywhere on the
                dashboard.
              </Text>
            </Stack>
          </Box>
        )}

        {/* Start break form */}
        <Box
          p="md"
          style={{
            border: "1px solid var(--mantine-color-dark-4)",
            borderRadius: 12,
            background: "var(--mantine-color-dark-6)",
          }}
        >
          <Stack gap="sm">
            <Group gap="xs">
              <ThemeIcon variant="light" radius="md" color="orange" size="sm">
                <IconPlayerPlay size={12} />
              </ThemeIcon>
              <Text fw={600} size="sm">
                Start a Break
              </Text>
            </Group>
            <Grid gutter="sm" align="flex-end">
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Box>
                  <Text size="xs" fw={500} c="dimmed" mb={4}>Posting as</Text>
                  {isManager ? (
                    <Select
                      data={LOCKED_TEAM_NAMES.map((name) => ({ value: name, label: name }))}
                      value={selectedName ?? identity?.name ?? null}
                      onChange={(v) => setSelectedName(v)}
                      searchable
                      allowDeselect={false}
                      size="sm"
                      leftSection={<IconUser size={14} />}
                    />
                  ) : (
                    <Group
                      gap="xs"
                      p="xs"
                      style={{
                        border: "1px solid var(--mantine-color-dark-4)",
                        borderRadius: 8,
                        background: "var(--mantine-color-dark-7)",
                      }}
                    >
                      <ThemeIcon size="xs" color="orange" variant="light" radius="xl">
                        <IconUser size={10} />
                      </ThemeIcon>
                      <Text size="sm" fw={600} style={{ flex: 1 }}>
                        {effectiveName || "Sign in first"}
                      </Text>
                      <Tooltip label="Locked — breaks are always posted as you" withArrow>
                        <ThemeIcon size="xs" color="gray" variant="transparent">
                          <IconLock size={11} />
                        </ThemeIcon>
                      </Tooltip>
                    </Group>
                  )}
                </Box>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <Select
                  label="Break type"
                  data={BREAK_TYPES}
                  value={breakType}
                  onChange={setBreakType}
                  allowDeselect={false}
                  size="sm"
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 2 }}>
                <Button
                  fullWidth
                  leftSection={<IconPlayerPlay size={14} />}
                  onClick={startBreak}
                  loading={posting}
                  disabled={!effectiveName || !breakType || !ready || posting}
                  size="sm"
                >
                  Start
                </Button>
              </Grid.Col>
            </Grid>
            <Group gap={6} wrap="nowrap" align="center">
              <IconBrandSlack
                size={12}
                style={{
                  color: "var(--mantine-color-dimmed)",
                  flexShrink: 0,
                }}
              />
              <Text size="xs" c="dimmed">
                Posts as{" "}
                <Text component="span" fw={600} c="bright" inherit>
                  {effectiveName || "you"}
                </Text>{" "}
                ({emojiForBreak(breakType ?? "Coffee")}):{" "}
                <Text component="span" fw={600} c="bright" inherit>
                  "{formatBreakStartMessage(breakType ?? "Coffee")}"
                </Text>{" "}
                to #noc-team. Ending replies{" "}
                <Text component="span" fw={600} c="bright" inherit>
                  "Back"
                </Text>{" "}
                in thread.
              </Text>
            </Group>
          </Stack>
        </Box>

        {/* Tabs — Active + History only. The Slack-reader tab is gone. */}
        <Tabs defaultValue="active" variant="default" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab
              value="active"
              leftSection={<IconUsers size={14} />}
              rightSection={
                active.length > 0 ? (
                  <Badge size="sm" circle color="green">
                    {active.length}
                  </Badge>
                ) : null
              }
            >
              Currently on Break
            </Tabs.Tab>
            <Tabs.Tab value="history" leftSection={<IconHistory size={14} />}>
              History
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="active" pt="md">
            {active.length === 0 ? (
              <EmptyState
                icon={IconCoffee}
                label="Nobody is on a break right now."
                hint="Start a break above to see it here."
              />
            ) : (
              <Table verticalSpacing="sm" horizontalSpacing="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Employee</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Started</Table.Th>
                    <Table.Th>Elapsed</Table.Th>
                    <Table.Th ta="right">Action</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {active.map((b, idx) => {
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    tick;
                    return (
                      <Table.Tr key={`active-break-${b.id}-${b.employee_name}-${idx}`}>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Text fw={500}>{b.employee_name}</Text>
                            {b.slack_posted ? (
                              <Tooltip
                                label={
                                  b.slack_message_ts?.startsWith("demo-")
                                    ? "Slack post simulated (demo mode)"
                                    : `Posted to Slack (ts ${b.slack_message_ts})`
                                }
                              >
                                <ThemeIcon
                                  size="xs"
                                  radius="xl"
                                  variant="light"
                                  color="green"
                                >
                                  <IconBrandSlack size={10} />
                                </ThemeIcon>
                              </Tooltip>
                            ) : b.slack_message_ts?.startsWith("demo-") ? (
                              <Tooltip label="Slack post simulated (demo mode)">
                                <ThemeIcon
                                  size="xs"
                                  radius="xl"
                                  variant="light"
                                  color="yellow"
                                >
                                  <IconBrandSlack size={10} />
                                </ThemeIcon>
                              </Tooltip>
                            ) : null}
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            variant="light"
                            color={BREAK_TYPE_COLORS[b.break_type] ?? "gray"}
                          >
                            {b.break_type}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">
                            {formatTime(new Date(b.start_time))}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" fw={500} ff="monospace">
                            {formatElapsedIso(b.start_time)}
                          </Text>
                        </Table.Td>
                        <Table.Td ta="right">
                          <Button
                            size="xs"
                            variant="light"
                            color="red"
                            leftSection={<IconPlayerStop size={14} />}
                            onClick={() => endBreak(b)}
                            loading={posting}
                            disabled={posting}
                          >
                            End break
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="history" pt="md">
            {history.length === 0 ? (
              <EmptyState
                icon={IconHistory}
                label="No completed breaks yet."
              />
            ) : (
              <Table verticalSpacing="sm" horizontalSpacing="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Employee</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Started</Table.Th>
                    <Table.Th>Ended</Table.Th>
                    <Table.Th ta="right">Duration</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {history.map((b, idx) => (
                    <Table.Tr key={`break-history-${b.id}-${b.employee_name}-${idx}`}>
                      <Table.Td>
                        <Text fw={500}>{b.employee_name}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          variant="light"
                          color={BREAK_TYPE_COLORS[b.break_type] ?? "gray"}
                        >
                          {b.break_type}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {formatDateTime(new Date(b.start_time))}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {b.end_time
                            ? formatDateTime(new Date(b.end_time))
                            : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" fw={500} ff="monospace">
                          {b.duration_minutes ?? 0} min
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </WidgetFrame>
  );
}

// ----- Small internal components ------------------------------------------

function StatCard({
  label,
  value,
  hint,
  color,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  color: string;
  icon: React.ComponentType<{ size?: number }>;
}) {
  return (
    <Box
      p="md"
      style={{
        border: "1px solid var(--mantine-color-dark-4)",
        borderRadius: 12,
        height: "100%",
      }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Box style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {label}
          </Text>
          <Title order={3} mt={2}>
            {value}
          </Title>
          {hint && (
            <Text size="xs" c="dimmed" mt={2} truncate>
              {hint}
            </Text>
          )}
        </Box>
        <ThemeIcon size="lg" radius="md" variant="light" color={color}>
          <Icon size={18} />
        </ThemeIcon>
      </Group>
    </Box>
  );
}

function EmptyState({
  icon: Icon,
  label,
  hint,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  hint?: string;
}) {
  return (
    <Box p="xl" ta="center">
      <ThemeIcon size={40} radius="xl" variant="light" color="gray" mx="auto">
        <Icon size={20} />
      </ThemeIcon>
      <Text mt="sm" c="dimmed">
        {label}
      </Text>
      {hint && (
        <Text size="sm" c="dimmed">
          {hint}
        </Text>
      )}
    </Box>
  );
}
