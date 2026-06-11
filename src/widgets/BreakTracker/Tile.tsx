import { useState, type MouseEvent } from "react";
import { Stack, Group, Text, Title, Box, Badge, Divider, Button, Select } from "@mantine/core";
import { IconCoffee, IconPlayerStop, IconUser } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useBreakData } from "./data";
import { BREAK_TYPE_COLORS, emojiForBreak, formatBreakStartMessage, postSlackMessage } from "../../lib/slack";
import { useIdentity } from "../../lib/identity";
import { formatElapsedIso } from "../../lib/format";
import { db } from "../../db";

interface Props {
  onExpand: () => void;
}

const QUICK_BREAK_TYPES = [
  { value: "Coffee", label: "Coffee" },
  { value: "Lunch", label: "Lunch" },
  { value: "Restroom", label: "Restroom" },
  { value: "Personal", label: "Personal" },
  { value: "Other", label: "Other" },
];

export function BreakTrackerTile({ onExpand }: Props) {
  const { active, tick, refresh } = useBreakData();
  const { identity } = useIdentity();
  const [breakType, setBreakType] = useState<string | null>("Coffee");
  const [posting, setPosting] = useState(false);

  const youOnBreak = identity?.name
    ? active.find((b) => b.employee_name === identity.name) ?? null
    : null;

  const preview = active.slice(0, 3);
  const canQuickControl = identity?.role !== "manager" && !!identity?.name;

  async function startBreakQuick() {
    if (!identity?.name || !breakType) return;
    setPosting(true);
    let slackTs: string | null = null;
    let slackPosted = false;
    try {
      const result = await postSlackMessage(formatBreakStartMessage(breakType), {
        username: identity.name,
        icon_emoji: emojiForBreak(breakType),
      });
      slackTs = result.ts ?? null;
      slackPosted = !!result.posted;
    } catch {
      // non-fatal; still record the break locally
    }
    try {
      await db.breaks.insert({
        employee_name: identity.name,
        break_type: breakType,
        start_time: new Date().toISOString(),
        is_active: true,
        slack_message_ts: slackTs,
        slack_posted: slackPosted,
      });
      await refresh();
    } finally {
      setPosting(false);
    }
  }

  async function endBreakQuick() {
    if (!youOnBreak) return;
    setPosting(true);
    try {
      await db.breaks.updateById(youOnBreak.id, {
        end_time: new Date().toISOString(),
        duration_minutes: Math.max(1, Math.round((Date.now() - new Date(youOnBreak.start_time).getTime()) / 60000)),
        is_active: false,
      });
      await refresh();
    } finally {
      setPosting(false);
    }
  }

  function stopTileExpand(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  return (
    <WidgetTile
      title="Break Tracker"
      description="Posts to Slack · tracks locally"
      icon={IconCoffee}
      iconColor="orange"
      onExpand={onExpand}
      headerActions={canQuickControl && youOnBreak ? (
        <Button
          size="compact-xs"
          variant="light"
          color="orange"
          leftSection={<IconPlayerStop size={12} />}
          loading={posting}
          onClick={(event) => {
            stopTileExpand(event);
            void endBreakQuick();
          }}
        >
          End break
        </Button>
      ) : undefined}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group align="flex-end" justify="space-between" wrap="nowrap">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              On break now
            </Text>
            <Title order={1} c="orange" style={{ lineHeight: 1 }} mt={2}>
              {active.length}
            </Title>
            <Text size="xs" c="dimmed" mt={2}>
              {active.length === 0 ? "Nobody on a break" : `${active.length} currently away`}
            </Text>
          </Box>
          {identity?.name && (
            <Badge
              variant="light"
              color={youOnBreak ? "orange" : "gray"}
              leftSection={<IconUser size={10} />}
              size="sm"
              style={{ textTransform: "none" }}
            >
              {identity.name.split(" ")[0]}
              {youOnBreak ? " · on break" : ""}
            </Badge>
          )}
        </Group>

        {canQuickControl && !youOnBreak && (
          <Group gap="xs" wrap="nowrap" onClick={stopTileExpand}>
            <Select
              size="xs"
              flex={1}
              data={QUICK_BREAK_TYPES}
              value={breakType}
              onChange={setBreakType}
              allowDeselect={false}
            />
            <Button
              size="xs"
              variant="light"
              color="orange"
              loading={posting}
              onClick={() => void startBreakQuick()}
            >
              Start break
            </Button>
          </Group>
        )}

        {active.length > 0 ? (
          <>
            <Divider variant="dashed" />
            <Stack gap={4}>
              {preview.map((b, idx) => {
                tick;
                return (
                  <Group
                    key={`break-preview-${b.id}-${idx}`}
                    justify="space-between"
                    wrap="nowrap"
                    gap={6}
                  >
                    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                      <IconCoffee size={12} color="var(--mantine-color-yellow-5)" />
                      <Text size="sm" truncate fw={500}>
                        {b.employee_name}
                      </Text>
                      <Badge size="xs" variant="light" color={BREAK_TYPE_COLORS[b.break_type] ?? "gray"}>
                        {b.break_type}
                      </Badge>
                    </Group>
                    <Text size="xs" ff="monospace" c="dimmed">
                      {formatElapsedIso(b.start_time)}
                    </Text>
                  </Group>
                );
              })}
              {active.length > preview.length && (
                <Text size="xs" c="dimmed" mt={4}>
                  +{active.length - preview.length} more
                </Text>
              )}
            </Stack>
          </>
        ) : (
          <Box style={{ flex: 1 }}>
            <Text size="xs" c="dimmed" ta="center" mt="md">
              Nobody is on a break right now
            </Text>
          </Box>
        )}
      </Stack>
    </WidgetTile>
  );
}
