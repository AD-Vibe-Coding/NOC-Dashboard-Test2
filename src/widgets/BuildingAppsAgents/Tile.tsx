import { Badge, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconBulb, IconCpu, IconRocket, IconUsers } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";

export function BuildingAppsAgentsTile({ onExpand }: { onExpand: () => void }) {
  return (
    <WidgetTile
      title="Building Apps / Agents"
      description="Starter workspace for shaping new ideas before build"
      icon={IconCpu}
      iconColor="blue"
      onExpand={onExpand}
      status={{ label: "Idea canvas", color: "blue" }}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon radius="md" variant="light" color="blue"><IconBulb size={16} /></ThemeIcon>
          <div style={{ flex: 1 }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Helpful starting point</Text>
            <Text fw={700}>Problem → solution → quick value</Text>
          </div>
          <Badge variant="light" color="blue">Canvas</Badge>
        </Group>
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon radius="md" variant="light" color="teal"><IconRocket size={16} /></ThemeIcon>
          <div style={{ flex: 1 }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>For requestors</Text>
            <Text fw={700}>Shape an idea without writing a formal intake</Text>
          </div>
        </Group>
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon radius="md" variant="light" color="grape"><IconUsers size={16} /></ThemeIcon>
          <Text size="sm" c="dimmed">
            Gives managers a quick overview of the problem, likely value, feasibility, and next step.
          </Text>
        </Group>
      </Stack>
    </WidgetTile>
  );
}
