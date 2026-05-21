import { Stack, Group, Text, Title, Box, Badge, Divider } from "@mantine/core";
import {
  IconActivity,
  IconBolt,
  IconCheck,
  IconPhone,
  IconTicket,
  IconUser,
} from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useWorkActivity } from "./data";
import { useIdentity } from "../../lib/identity";
import { buildMyDayMetrics, findUserActivity } from "../../lib/work-activity";

interface Props {
  onExpand: () => void;
}

export function WorkActivityTile({ onExpand }: Props) {
  const { slack, calls, loading } = useWorkActivity();
  const { identity } = useIdentity();

  const resolved = identity?.name
    ? findUserActivity(identity.name, slack).matched ?? identity.name
    : null;
  const me = resolved ? buildMyDayMetrics(resolved, slack, calls) : null;

  const source = !slack && !calls
    ? null
    : slack?.source === "live" && calls?.source === "live"
      ? { label: "live", color: "green" }
      : { label: slack?.source === "live" ? "Slack live" : "snapshot", color: "yellow" };

  return (
    <WidgetTile
      title="My Day"
      description="Today's tickets + calls"
      icon={IconActivity}
      iconColor="indigo"
      status={source ?? undefined}
      onExpand={onExpand}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        {!identity?.name ? (
          <Box style={{ flex: 1 }}>
            <Text size="xs" c="dimmed" ta="center" mt="md">
              Set your identity to see your day's activity
            </Text>
          </Box>
        ) : me ? (
          <>
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Box>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Today
                </Text>
                <Title order={1} c="indigo" style={{ lineHeight: 1 }} mt={2}>
                  {me.worked + me.updated + me.acked + me.calls_answered}
                </Title>
                <Text size="xs" c="dimmed" mt={2}>
                  total actions
                </Text>
              </Box>
              <Badge
                variant="light"
                color="indigo"
                leftSection={<IconUser size={10} />}
                size="sm"
                style={{ textTransform: "none" }}
              >
                {identity.name.split(" ")[0]}
              </Badge>
            </Group>
            <Divider variant="dashed" />
            <Stack gap={6}>
              <MetricRow icon={IconTicket} color="indigo" label="Worked" value={me.worked} />
              <MetricRow icon={IconCheck} color="teal" label="Updated" value={me.updated} />
              <MetricRow
                icon={IconBolt}
                color="yellow"
                label="Ack'd"
                value={me.acked + me.assignments_received}
              />
              <MetricRow icon={IconPhone} color="blue" label="Calls" value={me.calls_answered} />
            </Stack>
          </>
        ) : (
          <Text size="xs" c="dimmed" ta="center" mt="md">
            {loading ? "Loading…" : "No activity today"}
          </Text>
        )}
      </Stack>
    </WidgetTile>
  );
}

function MetricRow({
  icon: Icon,
  color,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  color: string;
  label: string;
  value: number;
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap={6}>
      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
        <Icon size={12} color={`var(--mantine-color-${color}-5)`} />
        <Text size="xs" c="dimmed">
          {label}
        </Text>
      </Group>
      <Text size="sm" fw={600} ff="monospace" c={value > 0 ? `${color}.4` : "dimmed"}>
        {value || "—"}
      </Text>
    </Group>
  );
}
