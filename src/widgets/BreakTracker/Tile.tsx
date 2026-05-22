import { Stack, Group, Text, Title, Box, Badge, Divider } from "@mantine/core";
import { IconCoffee, IconUser } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useBreakData } from "./data";
import { BREAK_TYPE_COLORS } from "../../lib/slack";
import { useIdentity } from "../../lib/identity";
import { formatElapsedIso } from "../../lib/format";

interface Props {
  onExpand: () => void;
}

export function BreakTrackerTile({ onExpand }: Props) {
  const { active, tick } = useBreakData();
  const { identity } = useIdentity();

  // Highlight "you" on the tile if the current user is on a break right now.
  const youOnBreak = identity?.name
    ? active.find((b) => b.employee_name === identity.name) ?? null
    : null;

  // Show up to 3 active break-takers in the tile preview.
  const preview = active.slice(0, 3);

  return (
    <WidgetTile
      title="Break Tracker"
      description="Posts to Slack · tracks locally"
      icon={IconCoffee}
      iconColor="orange"
      onExpand={onExpand}
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
              {active.length === 0
                ? "Nobody on a break"
                : `${active.length} currently away`}
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

        {active.length > 0 ? (
          <>
            <Divider variant="dashed" />
            <Stack gap={4}>
              {preview.map((b, idx) => {
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                tick;
                return (
                  <Group
                    key={`break-preview-${b.id}-${idx}`}
                    justify="space-between"
                    wrap="nowrap"
                    gap={6}
                  >
                    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                      <IconCoffee
                        size={12}
                        color="var(--mantine-color-yellow-5)"
                      />
                      <Text size="sm" truncate fw={500}>
                        {b.employee_name}
                      </Text>
                      <Badge
                        size="xs"
                        variant="light"
                        color={BREAK_TYPE_COLORS[b.break_type] ?? "gray"}
                      >
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
