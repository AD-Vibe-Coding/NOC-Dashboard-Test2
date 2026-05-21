import { Stack, Group, Text, Title, Box, Badge } from "@mantine/core";
import { IconFileText, IconSparkles } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useTicketSummaries } from "./data";

interface Props {
  onExpand: () => void;
}

export function TicketSummaryTile({ onExpand }: Props) {
  const { summaries, ready } = useTicketSummaries();
  const latest = summaries[0];

  return (
    <WidgetTile
      title="Ticket Summary"
      description="Upload an .mhtml — AI summarizes the ticket"
      icon={IconFileText}
      iconColor="indigo"
      status={{
        label: "AI",
        color: "indigo",
        tooltip: "Powered by Devs.ai",
      }}
      onExpand={onExpand}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group align="flex-end" justify="space-between" wrap="nowrap">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Summaries
            </Text>
            <Title order={1} c="indigo" style={{ lineHeight: 1 }} mt={2}>
              {summaries.length}
            </Title>
            <Text size="xs" c="dimmed" mt={2}>
              {ready ? "Stored locally" : "Loading…"}
            </Text>
          </Box>
          <Badge
            variant="light"
            color="indigo"
            leftSection={<IconSparkles size={10} />}
            size="sm"
          >
            AI summarize
          </Badge>
        </Group>
        {latest ? (
          <Box
            p="xs"
            style={{
              border: "1px dashed var(--mantine-color-dark-4)",
              borderRadius: 6,
              minWidth: 0,
            }}
          >
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Last
            </Text>
            <Text size="sm" fw={500} truncate>
              {latest.ticket_subject ?? latest.file_name}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {latest.ticket_number ?? `${(latest.file_size_bytes / 1024).toFixed(1)} KB`}
            </Text>
          </Box>
        ) : (
          <Box style={{ flex: 1 }}>
            <Text size="xs" c="dimmed" ta="center" mt="md">
              No summaries yet — click to upload your first .mhtml
            </Text>
          </Box>
        )}
      </Stack>
    </WidgetTile>
  );
}
