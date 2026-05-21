import { Stack, Group, Text, Title, Box, Badge, Divider } from "@mantine/core";
import { IconClipboardText, IconTicket } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useShiftHandovers } from "./data";
import { formatElapsedIso } from "../../lib/format";

interface Props {
  onExpand: () => void;
}

export function ShiftHandoverTile({ onExpand }: Props) {
  const { handovers } = useShiftHandovers();
  const latest = handovers[0];
  const total = handovers.length;

  return (
    <WidgetTile
      title="Shift Handover"
      description="Structured handover from your notes"
      icon={IconClipboardText}
      iconColor="blue"
      onExpand={onExpand}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group align="flex-end" justify="space-between" wrap="nowrap">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Handovers saved
            </Text>
            <Title order={1} c="blue" style={{ lineHeight: 1 }} mt={2}>
              {total}
            </Title>
            <Text size="xs" c="dimmed" mt={2}>
              {total === 0
                ? "No handovers yet"
                : `${total} saved this device`}
            </Text>
          </Box>
        </Group>

        {latest ? (
          <>
            <Divider variant="dashed" />
            <Box>
              <Text size="xs" c="dimmed" mb={2}>
                Latest
              </Text>
              <Group gap={6} wrap="nowrap" align="center">
                <Badge size="xs" variant="light" color="blue">
                  {latest.shift_name}
                </Badge>
                <Text size="xs" c="dimmed">
                  {latest.shift_date}
                </Text>
                {!!latest.ticket_count && (
                  <Badge size="xs" variant="default" leftSection={<IconTicket size={9} />}>
                    {latest.ticket_count}
                  </Badge>
                )}
              </Group>
              <Text size="xs" truncate mt={4}>
                {latest.subject ?? "Shift handover"}
              </Text>
              <Text size="xs" c="dimmed" mt={2}>
                Generated {formatElapsedIso(latest.created_at.toString())} ago
              </Text>
            </Box>
          </>
        ) : (
          <Box style={{ flex: 1 }}>
            <Text size="xs" c="dimmed" ta="center" mt="md">
              Click to generate your first handover
            </Text>
          </Box>
        )}
      </Stack>
    </WidgetTile>
  );
}
