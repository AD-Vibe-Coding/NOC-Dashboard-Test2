import { Badge, Group, Stack, Text, Title } from "@mantine/core";
import { IconClockRecord } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useAttendanceSummary } from "./data";

export function AttendanceTrackerTile({ onExpand }: { onExpand: () => void }) {
  const { data } = useAttendanceSummary();

  return (
    <WidgetTile
      title="Attendance & Reminders"
      description="Punch in/out and reminder counts"
      icon={IconClockRecord}
      iconColor="orange"
      onExpand={onExpand}
    >
      <Stack gap="xs" style={{ height: "100%" }}>
        <Group justify="space-between" align="flex-end">
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Tracked staff</Text>
            <Title order={2}>{data?.summary.total_people ?? 0}</Title>
          </div>
          <Badge variant="light" color="orange">
            {data?.summary.total_queue_reminders ?? 0} queue reminders
          </Badge>
        </Group>
        <Text size="xs" c="dimmed">
          {data ? `${data.summary.total_punch_ins} punch-ins · ${data.summary.total_break_reminders} break reminders` : "Loading attendance activity..."}
        </Text>
      </Stack>
    </WidgetTile>
  );
}
