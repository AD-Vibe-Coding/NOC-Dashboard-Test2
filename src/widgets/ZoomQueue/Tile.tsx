import { useState, type MouseEvent } from "react";
import { Badge, Box, Button, Group, RingProgress, Select, Stack, Text, Title } from "@mantine/core";
import { IconCoffee, IconHeadset, IconPlayerStop, IconUser } from "@tabler/icons-react";
import { db } from "../../db";
import { useIdentity } from "../../lib/identity";
import { BREAK_TYPE_COLORS, emojiForBreak, formatBreakStartMessage, postSlackMessage } from "../../lib/slack";
import { useBreakData } from "../BreakTracker/data";
import { WidgetTile } from "../WidgetTile";
import { useZoomQueue } from "./data";

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
  const { active, refresh } = useBreakData();
  const { identity } = useIdentity();
  const [statusType, setStatusType] = useState<string | null>("Lunch");
  const [posting, setPosting] = useState<"status" | "punch_in" | "punch_out" | null>(null);

  const inQueue = data?.totals.in_queue ?? 0;
  const notInQueue = data?.totals.not_in_queue ?? 0;
  const total = inQueue + notInQueue;
  const pct = total > 0 ? Math.round((inQueue / total) * 100) : 0;

  const youOnBreak = identity?.name
    ? active.find((b) => b.employee_name === identity.name) ?? null
    : null;
  const canQuickControl = identity?.role !== "manager" && !!identity?.name;

  function stopTileExpand(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
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
    try {
      await db.punch_events.insert({
        employee_name: identity.name,
        action,
        message: action === "punch_in" ? "Punched in" : "Punched out",
        slack_posted: false,
        punched_at: new Date().toISOString(),
      });
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
        <Group justify="space-between" align="center" wrap="nowrap">
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              In Queue
            </Text>
            <Title order={1} c="green" style={{ lineHeight: 1 }}>
              {inQueue}
              <Text component="span" size="sm" c="dimmed" fw={400}>
                {" "}/ {total}
              </Text>
            </Title>
            <Text size="xs" c="dimmed">
              {notInQueue} out of queue
            </Text>
          </Stack>
          <RingProgress
            size={72}
            thickness={7}
            roundCaps
            sections={[{ value: pct, color: "green" }]}
            label={
              <Box ta="center">
                <Text size="xs" fw={700} ff="monospace">
                  {pct}%
                </Text>
              </Box>
            }
          />
        </Group>

        {canQuickControl && !youOnBreak && (
          <Group gap="xs" wrap="nowrap" onClick={stopTileExpand}>
            <Select
              size="xs"
              flex={1}
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

        {canQuickControl && identity?.name && (
          <Stack gap="xs">
            <Group justify="flex-start" wrap="nowrap">
              <Badge
                variant="light"
                color={youOnBreak ? (BREAK_TYPE_COLORS[youOnBreak.break_type] ?? "orange") : "gray"}
                leftSection={<IconUser size={10} />}
                size="sm"
                style={{ textTransform: "none" }}
              >
                {identity.name.split(" ")[0]}
                {youOnBreak ? ` · ${youOnBreak.break_type}` : " · available"}
              </Badge>
            </Group>
            <Group justify="flex-end" gap="xs" wrap="nowrap" onClick={stopTileExpand}>
              <Button
                size="xs"
                variant="light"
                color="green"
                loading={posting === "punch_in"}
                onClick={() => void quickPunch("punch_in")}
              >
                Punch In
              </Button>
              <Button
                size="xs"
                variant="light"
                color="red"
                loading={posting === "punch_out"}
                onClick={() => void quickPunch("punch_out")}
              >
                Punch Out
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </WidgetTile>
  );
}
