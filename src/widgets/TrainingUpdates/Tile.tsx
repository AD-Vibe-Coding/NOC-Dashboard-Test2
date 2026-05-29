import { Badge, Box, Group, Stack, Text, Title } from "@mantine/core";
import { IconSchool } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useEffect, useState } from "react";
import { useTrainingNotifications } from "../../lib/training-notifications";

type TrainingRequest = { id: number; status: string };
type UpcomingTraining = { id: number };

export function TrainingUpdatesTile({ onExpand }: { onExpand: () => void }) {
  const [requests, setRequests] = useState<TrainingRequest[]>([]);
  const [trainings, setTrainings] = useState<UpcomingTraining[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/training_requests").then((r) => r.json()).catch(() => ({ requests: [] })),
      fetch("/api/upcoming_trainings").then((r) => r.json()).catch(() => ({ trainings: [] })),
    ]).then(([a, b]) => {
      setRequests(a.requests ?? []);
      setTrainings(b.trainings ?? []);
    });
  }, []);

  const requested = requests.filter((r) => r.status === "requested").length;
  const submitted = requests.filter((r) => r.status === "submitted").length;
  const { pendingCount: notificationCount } = useTrainingNotifications();

  return (
    <WidgetTile
      title="Training Updates"
      description="Requests, reviews, and upcoming trainings"
      icon={IconSchool}
      iconColor="blue"
      onExpand={onExpand}
      status={{ label: notificationCount > 0 ? `${notificationCount} new` : `${requested} pending`, color: notificationCount > 0 ? "red" : requested > 0 ? "yellow" : "green" }}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group justify="space-between" align="flex-end" wrap="nowrap">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Training requests</Text>
            <Title order={1} c="blue" style={{ lineHeight: 1 }} mt={2}>{requests.length}</Title>
            <Text size="xs" c="dimmed" mt={2}>{trainings.length} upcoming sessions</Text>
          </Box>
          <Badge size="sm" variant="light" color="blue">{submitted} submitted</Badge>
        </Group>
      </Stack>
    </WidgetTile>
  );
}
