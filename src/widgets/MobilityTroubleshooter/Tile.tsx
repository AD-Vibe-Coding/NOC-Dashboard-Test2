import { Badge, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import {
  IconDeviceMobile,
  IconDeviceMobileMessage,
  IconListCheck,
  IconRouter,
} from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";

interface Props {
  onExpand: () => void;
}

export function MobilityTroubleshooterTile({ onExpand }: Props) {
  return (
    <WidgetTile
      title="Mobility Troubleshooter"
      description="Guided ATT Buyers' Club runbooks"
      icon={IconDeviceMobileMessage}
      iconColor="violet"
      status={{
        label: "OPUS live",
        color: "violet",
        tooltip: "Live AT&T OPUS Troubleshooting Workflow from Confluence, with offline fallback",
      }}
      onExpand={onExpand}
    >
      <Stack gap={8} p={4}>
        <Group gap={8} wrap="nowrap">
          <ThemeIcon size={22} radius="sm" color="violet" variant="light">
            <IconRouter size={12} />
          </ThemeIcon>
          <Text size="xs" c="dimmed" lineClamp={1}>
            1. Select carrier
          </Text>
        </Group>
        <Group gap={8} wrap="nowrap">
          <ThemeIcon size={22} radius="sm" color="violet" variant="light">
            <IconListCheck size={12} />
          </ThemeIcon>
          <Text size="xs" c="dimmed" lineClamp={1}>
            2. Pick issue type
          </Text>
        </Group>
        <Group gap={8} wrap="nowrap">
          <ThemeIcon size={22} radius="sm" color="violet" variant="light">
            <IconDeviceMobile size={12} />
          </ThemeIcon>
          <Text size="xs" c="dimmed" lineClamp={1}>
            3. Device → step-by-step guide
          </Text>
        </Group>
        <Badge size="xs" variant="light" color="violet" w="fit-content">
          ATT Buyers&apos; Club · OPUS
        </Badge>
      </Stack>
    </WidgetTile>
  );
}
