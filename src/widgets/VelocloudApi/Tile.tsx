import { Badge, Group, Stack, Text, Title } from "@mantine/core";
import { IconWorldPin } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useVelocloud } from "./data";

export function VelocloudApiTile({ onExpand }: { onExpand: () => void }) {
  const { data } = useVelocloud();
  const summary = data?.summary;

  return (
    <WidgetTile
      title="VeloCloud API"
      description="SD-WAN alerts and link health"
      icon={IconWorldPin}
      iconColor="cyan"
      onExpand={onExpand}
      status={data ? { label: data.source === "live" ? "live" : "snapshot", color: data.source === "live" ? "green" : "yellow" } : undefined}
    >
      <Stack gap="xs" style={{ height: "100%" }}>
        <Group justify="space-between" align="flex-end">
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Open Alerts</Text>
            <Title order={2}>{summary?.total_alerts ?? 0}</Title>
          </div>
          <Badge variant="light" color="red">{summary?.links_down ?? 0} links down</Badge>
        </Group>
        <Text size="xs" c="dimmed">
          {summary ? `${summary.links_up} up · ${summary.links_degraded} degraded · ${summary.links_down} down` : "Loading link health..."}
        </Text>
      </Stack>
    </WidgetTile>
  );
}
