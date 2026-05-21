import { Stack, Group, Text, Title, Box, Badge } from "@mantine/core";
import { IconMail, IconSparkles } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useEscalationDrafts } from "./data";

interface Props {
  onExpand: () => void;
}

export function EscalationEmailTile({ onExpand }: Props) {
  const { drafts, ready } = useEscalationDrafts();
  const latest = drafts[0];

  return (
    <WidgetTile
      title="Escalation Email"
      description="Paste notes — AI drafts the escalation email"
      icon={IconMail}
      iconColor="teal"
      status={{
        label: "AI",
        color: "teal",
        tooltip: "Powered by Devs.ai",
      }}
      onExpand={onExpand}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group align="flex-end" justify="space-between" wrap="nowrap">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Drafts
            </Text>
            <Title order={1} c="teal" style={{ lineHeight: 1 }} mt={2}>
              {drafts.length}
            </Title>
            <Text size="xs" c="dimmed" mt={2}>
              {ready ? "Stored locally" : "Loading…"}
            </Text>
          </Box>
          <Badge
            variant="light"
            color="teal"
            leftSection={<IconSparkles size={10} />}
            size="sm"
          >
            ESC-MGR template
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
              Last draft
            </Text>
            <Text size="sm" fw={500} truncate>
              {latest.subject ?? "(no subject)"}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {[latest.ticket_number, latest.customer_name, latest.service_provider]
                .filter(Boolean)
                .join(" · ") || "—"}
            </Text>
          </Box>
        ) : (
          <Box style={{ flex: 1 }}>
            <Text size="xs" c="dimmed" ta="center" mt="md">
              No drafts yet — click to paste your first set of notes
            </Text>
          </Box>
        )}
      </Stack>
    </WidgetTile>
  );
}
