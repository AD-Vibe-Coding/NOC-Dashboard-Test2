import { Box, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconSearch, IconSparkles } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";

interface Props {
  onExpand: () => void;
}

export function SmartSearchTile({ onExpand }: Props) {
  return (
    <WidgetTile
      title="Smart Search"
      description="AI-powered natural language search"
      icon={IconSearch}
      iconColor="indigo"
      onExpand={onExpand}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group align="flex-end" justify="space-between" wrap="nowrap">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              AI Search
            </Text>
            <Title order={2} c="indigo" style={{ lineHeight: 1 }} mt={2}>
              <Group gap={6}>
                <IconSparkles size={20} />
                Auto
              </Group>
            </Title>
            <Text size="xs" c="dimmed" mt={4}>
              Ask in plain English — get instant answers
            </Text>
          </Box>
          <ThemeIcon size="lg" radius="xl" variant="light" color="indigo">
            <IconSearch size={18} />
          </ThemeIcon>
        </Group>
        <Box style={{ flex: 1 }} />
        <Text size="xs" c="dimmed" ta="center">
          Carrier contacts · Troubleshooting · Ticket help · Dashboard navigation
        </Text>
      </Stack>
    </WidgetTile>
  );
}
