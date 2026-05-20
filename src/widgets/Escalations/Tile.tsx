import { Stack, Group, Text, Title, Box, Badge } from "@mantine/core";
import { IconAddressBook } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useEscalations } from "./data";

interface Props {
  onExpand: () => void;
}

export function EscalationsTile({ onExpand }: Props) {
  const { data } = useEscalations();
  const carriers = data?.carriers ?? [];
  const preview = carriers.slice(0, 6);

  return (
    <WidgetTile
      title="QS Escalation Contacts"
      description="Carrier escalation lists from Confluence"
      icon={IconAddressBook}
      iconColor="grape"
      status={
        data
          ? {
              label: data.source,
              color: data.source === "live" ? "green" : "yellow",
              tooltip:
                data.source === "live"
                  ? "Live data from Confluence REST API"
                  : "Snapshot from MCP — set CONFLUENCE_* in .env to go live",
            }
          : undefined
      }
      onExpand={onExpand}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group align="flex-end" justify="space-between" wrap="nowrap">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Carriers
            </Text>
            <Title order={1} c="grape" style={{ lineHeight: 1 }} mt={2}>
              {carriers.length}
            </Title>
          </Box>
        </Group>

        <Box style={{ minHeight: 0, flex: 1 }}>
          <Group gap={6} mt={4}>
            {preview.map((c) => (
              <Badge
                key={c.id}
                variant="light"
                color="grape"
                size="sm"
                style={{ textTransform: "none" }}
              >
                {c.carrier}
              </Badge>
            ))}
            {carriers.length > preview.length && (
              <Badge variant="outline" color="gray" size="sm">
                +{carriers.length - preview.length} more
              </Badge>
            )}
          </Group>
        </Box>
      </Stack>
    </WidgetTile>
  );
}
