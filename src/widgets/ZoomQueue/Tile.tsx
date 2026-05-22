import { Stack, Group, Text, Title, Box, Badge, Divider } from "@mantine/core";
import { IconHeadset, IconPhone } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useZoomQueue } from "./data";
import { ZOOM_STATUS_COLORS, ZOOM_STATUS_LABELS } from "../../lib/zoom";
import { formatElapsed } from "../../lib/format";

interface Props {
  onExpand: () => void;
}

export function ZoomQueueTile({ onExpand }: Props) {
  const { data, tick } = useZoomQueue();
  const totals = data?.totals;
  const onCall = (data?.agents ?? []).filter((a) => a.status === "on_call");
  const longest = [...onCall]
    .filter((a) => a.engagement_started_at != null)
    .sort((a, b) => (a.engagement_started_at ?? 0) - (b.engagement_started_at ?? 0))
    .slice(0, 2);

  return (
    <WidgetTile
      title="Zoom Queue"
      description="Who's on a call right now"
      icon={IconHeadset}
      iconColor="blue"
      status={
        data
          ? {
              label: data.source,
              color: data.source === "live" ? "green" : "yellow",
              tooltip:
                data.source === "live"
                  ? "Live Zoom Contact Center data"
                  : "Snapshot fallback — set ZOOM_* in .env to go live",
            }
          : undefined
      }
      onExpand={onExpand}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group align="flex-end" justify="space-between" wrap="nowrap">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              On call
            </Text>
            <Title order={1} c="red" style={{ lineHeight: 1 }} mt={2}>
              {totals?.on_call ?? 0}
            </Title>
          </Box>
          <Group gap={4} wrap="nowrap">
            <Mini label="Wrap" value={totals?.wrap_up ?? 0} color="orange" />
            <Mini label="Ready" value={totals?.ready ?? 0} color="green" />
            <Mini label="N/R" value={totals?.not_ready ?? 0} color="yellow" />
            <Mini label="Off" value={totals?.offline ?? 0} color="gray" />
          </Group>
        </Group>

        {longest.length > 0 && (
          <>
            <Divider variant="dashed" />
            <Stack gap={4}>
              {longest.map((a, idx) => {
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                tick;
                const minutes = a.engagement_started_at
                  ? (Date.now() - a.engagement_started_at) / 60000
                  : 0;
                return (
                  <Group key={`zoom-longest-${a.agent_id}-${a.display_name}-${idx}`} justify="space-between" wrap="nowrap" gap={6}>
                    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                      <IconPhone size={12} color="var(--mantine-color-red-5)" />
                      <Text size="sm" truncate fw={500}>
                        {a.display_name}
                      </Text>
                    </Group>
                    <Text
                      size="xs"
                      ff="monospace"
                      fw={600}
                      c={minutes > 15 ? "red" : "dimmed"}
                    >
                      {a.engagement_started_at
                        ? formatElapsed(a.engagement_started_at)
                        : "—"}
                    </Text>
                  </Group>
                );
              })}
            </Stack>
          </>
        )}

        {onCall.length === 0 && (
          <Box style={{ flex: 1 }}>
            <Text size="xs" c="dimmed" ta="center" mt="md">
              Nobody is on a call right now
            </Text>
          </Box>
        )}
      </Stack>
    </WidgetTile>
  );
}

function Mini({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Badge
      variant="light"
      color={color}
      size="md"
      radius="sm"
      style={{ paddingLeft: 6, paddingRight: 6 }}
    >
      <Text size="xs" component="span" inherit>
        {label} {value}
      </Text>
    </Badge>
  );
}

// Keep ZOOM_STATUS_* references "used" so TS tree-shaking doesn't whine when
// this tile is the only consumer in some import graphs.
void ZOOM_STATUS_COLORS;
void ZOOM_STATUS_LABELS;
