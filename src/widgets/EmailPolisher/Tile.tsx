import { Stack, Group, Text, Title, Box, Badge, Divider } from "@mantine/core";
import {
  IconMailForward,
  IconUser,
  IconUsers,
  IconBuildingBroadcastTower,
} from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { usePolishedEmails } from "./data";
import { formatElapsedIso } from "../../lib/format";

interface Props {
  onExpand: () => void;
}

const AUDIENCE_META: Record<
  string,
  { color: string; label: string; icon: React.ComponentType<{ size?: number }> }
> = {
  customer: { color: "cyan", label: "Customer", icon: IconUser },
  internal: { color: "violet", label: "Internal", icon: IconUsers },
  carrier: { color: "orange", label: "Carrier", icon: IconBuildingBroadcastTower },
};

export function EmailPolisherTile({ onExpand }: Props) {
  const { emails, ready } = usePolishedEmails();
  const latest = emails[0];

  return (
    <WidgetTile
      title="Email Polisher"
      description="Polish drafts for customer, internal, or carrier"
      icon={IconMailForward}
      iconColor="lime"
      status={{ label: "AI", color: "lime", tooltip: "Powered by Devs.ai" }}
      onExpand={onExpand}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group align="flex-end" justify="space-between" wrap="nowrap">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Emails polished
            </Text>
            <Title order={1} c="lime" style={{ lineHeight: 1 }} mt={2}>
              {emails.length}
            </Title>
            <Text size="xs" c="dimmed" mt={2}>
              {ready ? "Stored locally" : "Loading…"}
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
                {(() => {
                  const meta = AUDIENCE_META[latest.audience] ?? AUDIENCE_META.internal;
                  const Icon = meta.icon;
                  return (
                    <Badge
                      size="xs"
                      variant="light"
                      color={meta.color}
                      leftSection={<Icon size={9} />}
                    >
                      {meta.label}
                    </Badge>
                  );
                })()}
                {latest.ticket_number && (
                  <Badge size="xs" variant="default">
                    #{latest.ticket_number}
                  </Badge>
                )}
              </Group>
              <Text size="xs" truncate mt={4} fw={500}>
                {latest.subject ?? "(no subject)"}
              </Text>
              <Text size="xs" c="dimmed" mt={2}>
                {formatElapsedIso(latest.created_at.toString())} ago
              </Text>
            </Box>
          </>
        ) : (
          <Box style={{ flex: 1 }}>
            <Text size="xs" c="dimmed" ta="center" mt="md">
              Click to polish your first draft
            </Text>
          </Box>
        )}
      </Stack>
    </WidgetTile>
  );
}
