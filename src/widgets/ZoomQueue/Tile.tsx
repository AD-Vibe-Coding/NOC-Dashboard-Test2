import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Badge, Button, Card, Group, Modal, Select, SimpleGrid, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconCoffee, IconHeadset, IconPlayerStop, IconSettings, IconUser } from "@tabler/icons-react";
import { db } from "../../db";
import { useIdentity } from "../../lib/identity";
import { BREAK_TYPE_COLORS, emojiForBreak, formatBreakStartMessage, postSlackMessage } from "../../lib/slack";
import { useBreakData } from "../BreakTracker/data";
import { WidgetTile } from "../WidgetTile";
import { useZoomQueue } from "./data";
import { useRosterShift } from "../../lib/use-roster-shift";

const TOTAL_BREAK_MINUTES = 90;
const BREAK_ONLY_TYPES = new Set(["Coffee", "Lunch", "Restroom", "Personal", "Other"]);

function isSameLocalDay(iso: string, now = new Date()) {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

interface Props {
  onExpand: () => void;
}

const QUICK_STATUS_TYPES = [
  { value: "Coffee", label: "Coffee" },
  { value: "Lunch", label: "Lunch" },
  { value: "Restroom", label: "Restroom" },
  { value: "Personal", label: "Personal" },
  { value: "Other", label: "Other" },
  { value: "Urgent Task", label: "Urgent Task" },
  { value: "Meeting - Internal", label: "Meeting - Internal" },
  { value: "Meeting - External", label: "Meeting - External" },
];

export function ZoomQueueTile({ onExpand }: Props) {
  const { data } = useZoomQueue();
  const { active, history, refresh } = useBreakData();
  const { data: rosterData } = useRosterShift();
  const { identity } = useIdentity();
  const [statusType, setStatusType] = useState<string | null>("Lunch");
  const [posting, setPosting] = useState<"status" | "punch_in" | "punch_out" | null>(null);
  const [lastPunchAction, setLastPunchAction] = useState<"punch_in" | "punch_out" | null>(null);
  const [punchInMessage, setPunchInMessage] = useState("Hello Team");
  const [punchOutMessage, setPunchOutMessage] = useState("Signing off for now");
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [draftPunchIn, setDraftPunchIn] = useState("Hello Team");
  const [draftPunchOut, setDraftPunchOut] = useState("Signing off for now");

  const inQueue = data?.totals.in_queue ?? 0;
  const notInQueue = data?.totals.not_in_queue ?? 0;
  const total = inQueue + notInQueue;
  const inShift = rosterData?.inShiftNow?.length ?? total;
  const outOfQueueInShift = Math.max(inShift - inQueue, 0);

  const youOnBreak = identity?.name
    ? active.find((b) => b.employee_name === identity.name) ?? null
    : null;
  const canQuickControl = identity?.role !== "manager" && !!identity?.name;

  const myBreakRows = useMemo(() => {
    if (!identity?.name) return [] as typeof active;
    const rows = [...active, ...history].filter(
      (row) => row.employee_name === identity.name && BREAK_ONLY_TYPES.has(row.break_type) && isSameLocalDay(row.start_time),
    );
    const deduped = new Map<number, (typeof rows)[number]>();
    for (const row of rows) deduped.set(row.id, row);
    return [...deduped.values()];
  }, [active, history, identity?.name]);

  const myBreakTakenCount = myBreakRows.length;
  const myBreakTakenMinutes = useMemo(() => {
    return myBreakRows.reduce((sum, row) => {
      const endMs = row.is_active ? Date.now() : row.end_time ? new Date(row.end_time).getTime() : Date.now();
      const startMs = new Date(row.start_time).getTime();
      const duration = row.duration_minutes ?? Math.max(1, Math.round((endMs - startMs) / 60000));
      return sum + duration;
    }, 0);
  }, [myBreakRows]);
  const breakUsed = Math.min(myBreakTakenMinutes, TOTAL_BREAK_MINUTES);

  useEffect(() => {
    if (!identity?.name) return;

    try {
      const inMsg = localStorage.getItem(`zoom-queue:tile:punch-in:${identity.name.toLowerCase().trim()}`);
      const outMsg = localStorage.getItem(`zoom-queue:tile:punch-out:${identity.name.toLowerCase().trim()}`);
      if (inMsg) setPunchInMessage(inMsg);
      if (outMsg) setPunchOutMessage(outMsg);
    } catch {
      // ignore storage failures
    }

    let cancelled = false;
    db.punch_events
      .list({
        filter: { employee_name: identity.name },
        orderBy: { column: "punched_at", ascending: false },
        limit: 1,
      })
      .then((rows) => {
        if (cancelled) return;
        const action = rows[0]?.action;
        setLastPunchAction(action === "punch_in" || action === "punch_out" ? action : null);
      })
      .catch(() => {
        if (cancelled) return;
        setLastPunchAction(null);
      });

    return () => {
      cancelled = true;
    };
  }, [identity?.name]);

  function stopTileExpand(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function configurePunchMessages(event: MouseEvent<HTMLElement>) {
    stopTileExpand(event);
    if (!identity?.name) return;
    setDraftPunchIn(punchInMessage);
    setDraftPunchOut(punchOutMessage);
    setMessagesOpen(true);
  }

  function savePunchMessages() {
    if (!identity?.name) return;

    const inMsg = draftPunchIn.trim() || "Hello Team";
    const outMsg = draftPunchOut.trim() || "Signing off for now";

    setPunchInMessage(inMsg);
    setPunchOutMessage(outMsg);

    try {
      localStorage.setItem(`zoom-queue:tile:punch-in:${identity.name.toLowerCase().trim()}`, inMsg);
      localStorage.setItem(`zoom-queue:tile:punch-out:${identity.name.toLowerCase().trim()}`, outMsg);
    } catch {
      // ignore storage failures
    }

    setMessagesOpen(false);
  }

  async function startStatusQuick() {
    if (!identity?.name || !statusType) return;
    setPosting("status");
    let slackTs: string | null = null;
    let slackPosted = false;
    try {
      const result = await postSlackMessage(formatBreakStartMessage(statusType), {
        username: identity.name,
        icon_emoji: emojiForBreak(statusType),
      });
      slackTs = result.ts ?? null;
      slackPosted = !!result.posted;
    } catch {
      // non-fatal; still record locally
    }

    try {
      await db.breaks.insert({
        employee_name: identity.name,
        break_type: statusType,
        start_time: new Date().toISOString(),
        is_active: true,
        slack_message_ts: slackTs,
        slack_posted: slackPosted,
      });
      await refresh();
    } finally {
      setPosting(null);
    }
  }

  async function endStatusQuick() {
    if (!youOnBreak) return;
    setPosting("status");
    const end = new Date();
    const duration = Math.max(1, Math.round((end.getTime() - new Date(youOnBreak.start_time).getTime()) / 60000));
    const threadTs =
      youOnBreak.slack_message_ts && !youOnBreak.slack_message_ts.startsWith("demo-")
        ? youOnBreak.slack_message_ts
        : null;

    try {
      await postSlackMessage("Back", {
        thread_ts: threadTs,
        username: youOnBreak.employee_name,
        icon_emoji: ":arrow_backward:",
      });
    } catch {
      // non-fatal; still clear local status even if Slack post fails
    }

    try {
      await db.breaks.updateById(youOnBreak.id, {
        end_time: end.toISOString(),
        duration_minutes: duration,
        is_active: false,
      });
      await refresh();
    } finally {
      setPosting(null);
    }
  }

  async function quickPunch(action: "punch_in" | "punch_out") {
    if (!identity?.name || posting) return;
    setPosting(action);

    const storedIn = identity?.name ? localStorage.getItem(`zoom-queue:tile:punch-in:${identity.name.toLowerCase().trim()}`) : null;
    const storedOut = identity?.name ? localStorage.getItem(`zoom-queue:tile:punch-out:${identity.name.toLowerCase().trim()}`) : null;
    const text = action === "punch_in"
      ? ((storedIn ?? punchInMessage).trim() || "Hello Team")
      : ((storedOut ?? punchOutMessage).trim() || "Signing off for now");
    let slackPosted = false;
    let slackTs: string | null = null;
    let slackChannel: string | null = null;

    try {
      try {
        const slack = await postSlackMessage(text, {
          username: identity.name,
          ...(action === "punch_in" ? { icon_emoji: ":large_green_circle:" } : { icon_emoji: ":white_circle:" }),
        });
        slackPosted = !!slack.posted;
        slackTs = slack.ts ?? null;
        slackChannel = slack.channel ?? null;
      } catch {
        // non-fatal; keep local logging even if Slack fails
      }

      await db.punch_events.insert({
        employee_name: identity.name,
        action,
        message: text,
        slack_posted: slackPosted,
        slack_channel: slackChannel,
        slack_ts: slackTs,
        punched_at: new Date().toISOString(),
      });
      setLastPunchAction(action);
    } finally {
      setPosting(null);
    }
  }

  return (
    <WidgetTile
      title="Team Availability"
      description="Queue availability + break / meeting status"
      icon={IconHeadset}
      iconColor="blue"
      status={
        data
          ? {
              label: data.source,
              color: data.source === "live" ? "green" : "yellow",
              tooltip:
                data.source === "live"
                  ? "Live data from Zoom Phone API"
                  : "Snapshot — set ZOOM_* in .env for live data",
            }
          : undefined
      }
      headerActions={canQuickControl && youOnBreak ? (
        <Button
          size="xs"
          px="sm"
          miw={78}
          variant="light"
          color="orange"
          leftSection={<IconPlayerStop size={12} />}
          loading={posting === "status"}
          onClick={(event) => {
            stopTileExpand(event);
            void endStatusQuick();
          }}
        >
          End
        </Button>
      ) : undefined}
      onExpand={onExpand}
    >
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: canQuickControl && identity?.name ? 2 : 1 }} spacing="sm">
          <Card withBorder radius="md" p="sm" style={{ background: "color-mix(in srgb, var(--mantine-color-green-9) 8%, var(--mantine-color-body))" }}>
            <Stack gap={2}>
              <Text size="10px" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: "0.04em" }}>
                In Queue
              </Text>
              <Title order={1} c="green" style={{ lineHeight: 1 }}>
                {inQueue}
                <Text component="span" size="sm" c="dimmed" fw={500}>
                  {" "}/ {inShift}
                </Text>
              </Title>
              <Text size="xs" c="dimmed">
                {outOfQueueInShift} out of queue (in shift)
              </Text>
            </Stack>
          </Card>

          {canQuickControl && identity?.name && (
            <Card
              withBorder
              radius="md"
              p="sm"
              style={{
                background: `color-mix(in srgb, var(--mantine-color-${breakUsed >= TOTAL_BREAK_MINUTES ? "red" : "blue"}-9) 10%, var(--mantine-color-body))`,
              }}
            >
              <Text size="10px" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: "0.04em" }}>Break Summary</Text>
              <Group justify="space-between" align="flex-end" wrap="wrap" mt={4}>
                <Stack gap={0}>
                  <Text size="xs" c="dimmed">Taken</Text>
                  <Text fw={800} size="xl" style={{ lineHeight: 1 }}>{myBreakTakenCount}</Text>
                </Stack>
                <Stack gap={0} align="flex-end" style={{ minWidth: 0 }}>
                  <Text size="xs" c="dimmed">Used</Text>
                  <Text fw={800} size="lg" style={{ lineHeight: 1, wordBreak: "break-word" }}>{breakUsed}/{TOTAL_BREAK_MINUTES} min</Text>
                </Stack>
              </Group>
            </Card>
          )}
        </SimpleGrid>

        {canQuickControl && (
          <Card withBorder radius="md" p="sm" onClick={stopTileExpand}>
            <Stack gap="xs">
              <Group justify="space-between" wrap="wrap" gap="xs">
                <Badge
                  variant="light"
                  color={youOnBreak ? (BREAK_TYPE_COLORS[youOnBreak.break_type] ?? "orange") : "gray"}
                  leftSection={<IconUser size={10} />}
                  size="sm"
                  style={{ textTransform: "none" }}
                >
                  {identity?.name?.split(" ")[0] ?? "Agent"}
                  {youOnBreak ? ` · ${youOnBreak.break_type}` : " · available"}
                </Badge>
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconSettings size={14} />}
                  onClick={configurePunchMessages}
                >
                  Set messages
                </Button>
              </Group>

              {!youOnBreak && (
                <Group gap="xs" wrap="wrap" align="stretch">
                  <Select
                    size="xs"
                    style={{ flex: 1, minWidth: 180 }}
                    data={QUICK_STATUS_TYPES}
                    value={statusType}
                    onChange={setStatusType}
                    allowDeselect={false}
                  />
                  <Button
                    size="xs"
                    variant="light"
                    color="orange"
                    leftSection={<IconCoffee size={14} />}
                    loading={posting === "status"}
                    onClick={() => void startStatusQuick()}
                  >
                    Start
                  </Button>
                </Group>
              )}

              <Group gap={6} justify="flex-end" wrap="wrap">
                <Button
                  size="compact-xs"
                  px="sm"
                  variant="light"
                  color="green"
                  loading={posting === "punch_in"}
                  disabled={lastPunchAction === "punch_in"}
                  onClick={() => void quickPunch("punch_in")}
                >
                  Punch In
                </Button>
                <Button
                  size="compact-xs"
                  px="sm"
                  variant="light"
                  color="red"
                  loading={posting === "punch_out"}
                  disabled={lastPunchAction === "punch_out"}
                  onClick={() => void quickPunch("punch_out")}
                >
                  Punch Out
                </Button>
              </Group>
            </Stack>
          </Card>
        )}

        <Modal
          opened={messagesOpen}
          onClose={() => setMessagesOpen(false)}
          title="Set default punch messages"
          centered
          onClick={stopTileExpand}
        >
          <Stack gap="sm">
            <TextInput
              label="Punch In message"
              value={draftPunchIn}
              onChange={(event) => setDraftPunchIn(event.currentTarget.value)}
              placeholder="Hello Team"
            />
            <TextInput
              label="Punch Out message"
              value={draftPunchOut}
              onChange={(event) => setDraftPunchOut(event.currentTarget.value)}
              placeholder="Signing off for now"
            />
            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={() => setMessagesOpen(false)}>Cancel</Button>
              <Button color="appdirect" onClick={savePunchMessages}>Save</Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </WidgetTile>
  );
}
