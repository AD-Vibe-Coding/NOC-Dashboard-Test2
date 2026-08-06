import { useState } from "react";
import { Badge, Button, Group, Stack, Text } from "@mantine/core";
import { IconClipboardList } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";

export function WorkAllotmentGeneratorTile({ onExpand }: { onExpand: () => void }) {
  const [loading, setLoading] = useState(false);

  return (
    <WidgetTile
      title="Work Allotment Generator"
      description="Generate the Slack-ready NOC shift allotment message"
      icon={IconClipboardList}
      iconColor="indigo"
      onExpand={onExpand}
    >
      <Stack gap="xs">
        <Group gap={6} wrap="wrap">
          <Badge color="indigo" variant="light">Roster + widget tracker</Badge>
          <Badge color="teal" variant="light">Slack-ready</Badge>
        </Group>
        <Text size="xs" c="dimmed">
          Uses the live Google roster plus an embedded fairness-hours tracker stored inside the widget.
        </Text>
        <Button
          size="xs"
          variant="light"
          color="indigo"
          loading={loading}
          onClick={() => {
            setLoading(true);
            onExpand();
            window.setTimeout(() => setLoading(false), 200);
          }}
        >
          Open generator
        </Button>
      </Stack>
    </WidgetTile>
  );
}
