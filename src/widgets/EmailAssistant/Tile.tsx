import { Badge, Box, Divider, Group, Stack, Text, Title } from "@mantine/core";
import { IconMail, IconSparkles, IconWand } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useEscalationDrafts, usePolishedEmails } from "./data";

interface Props {
  onExpand: () => void;
}

export function EmailAssistantTile({ onExpand }: Props) {
  const { drafts, ready: draftsReady } = useEscalationDrafts();
  const { emails, ready: emailsReady } = usePolishedEmails();
  const latestDraft = drafts[0];
  const latestPolish = emails[0];

  return (
    <WidgetTile
      title="NOC Email Assistant"
      description="Draft escalation variants or polish an existing message"
      icon={IconMail}
      iconColor="teal"
      status={{
        label: "AI",
        color: "teal",
        tooltip: "Generate escalation variants, polish drafts, and run email QA in one place",
      }}
      onExpand={onExpand}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group align="flex-end" justify="space-between" wrap="nowrap">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Saved emails
            </Text>
            <Title order={1} c="teal" style={{ lineHeight: 1 }} mt={2}>
              {drafts.length + emails.length}
            </Title>
            <Text size="xs" c="dimmed" mt={2}>
              {draftsReady && emailsReady ? "Drafts + polished emails" : "Loading…"}
            </Text>
          </Box>
          <Group gap={6}>
            <Badge variant="light" color="teal" leftSection={<IconSparkles size={10} />} size="sm">
              Escalation
            </Badge>
            <Badge variant="light" color="lime" leftSection={<IconWand size={10} />} size="sm">
              Polish
            </Badge>
          </Group>
        </Group>

        <Divider variant="dashed" />

        <Stack gap={6}>
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Latest escalation draft
            </Text>
            <Text size="sm" fw={500} truncate>
              {latestDraft?.subject ?? "No escalation drafts yet"}
            </Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Latest polished email
            </Text>
            <Text size="sm" fw={500} truncate>
              {latestPolish?.subject ?? "No polished emails yet"}
            </Text>
          </Box>
        </Stack>
      </Stack>
    </WidgetTile>
  );
}
