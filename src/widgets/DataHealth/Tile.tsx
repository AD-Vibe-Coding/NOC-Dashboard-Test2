import { Card, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconDatabase, IconShieldCheck } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import type { TileProps } from "../types";

export function DataHealthTile({ onExpand }: TileProps) {
  return (
    <WidgetTile
      title="Data Health"
      description="Read-only table counts"
      icon={IconDatabase}
      iconColor="orange"
      onExpand={onExpand}
      status={{ label: "Manager", color: "orange", tooltip: "Manager-only visibility" }}
    >
      <Card withBorder radius="md" p="sm">
        <Stack gap={6}>
          <Group justify="space-between" align="center">
            <Text size="xs" c="dimmed">Safety</Text>
            <ThemeIcon size="sm" variant="light" color="green">
              <IconShieldCheck size={14} />
            </ThemeIcon>
          </Group>
          <Text size="sm" fw={600}>Read-only data check</Text>
          <Text size="xs" c="dimmed">No delete/reset actions in this widget.</Text>
        </Stack>
      </Card>
    </WidgetTile>
  );
}
