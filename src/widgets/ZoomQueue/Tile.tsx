import { Stack, Group, Text, Title, Box, RingProgress } from "@mantine/core";
import { IconHeadset } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useZoomQueue } from "./data";

interface Props {
  onExpand: () => void;
}

export function ZoomQueueTile({ onExpand }: Props) {
  const { data } = useZoomQueue();
  const inQueue     = data?.totals.in_queue     ?? 0;
  const notInQueue  = data?.totals.not_in_queue ?? 0;
  const total       = inQueue + notInQueue;
  const pct         = total > 0 ? Math.round((inQueue / total) * 100) : 0;

  return (
    <WidgetTile
      title="Zoom Queue"
      description="Live queue availability"
      icon={IconHeadset}
      iconColor="blue"
      status={
        data
          ? {
              label: data.source,
              color: data.source === "live" ? "green" : "yellow",
              tooltip: data.source === "live"
                ? "Live data from Zoom Phone API"
                : "Snapshot — set ZOOM_* in .env for live data",
            }
          : undefined
      }
      onExpand={onExpand}
    >
      <Group justify="space-between" align="center" wrap="nowrap">
        <Stack gap={2}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>In Queue</Text>
          <Title order={1} c="green" style={{ lineHeight: 1 }}>
            {inQueue}
            <Text component="span" size="sm" c="dimmed" fw={400}> / {total}</Text>
          </Title>
          <Text size="xs" c="dimmed">{notInQueue} out of queue</Text>
        </Stack>
        <RingProgress
          size={72}
          thickness={7}
          roundCaps
          sections={[{ value: pct, color: "green" }]}
          label={
            <Box ta="center">
              <Text size="xs" fw={700} ff="monospace">{pct}%</Text>
            </Box>
          }
        />
      </Group>
    </WidgetTile>
  );
}
