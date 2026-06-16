import { Badge, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconSchool, IconTargetArrow } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useEffect, useMemo, useState } from "react";
import { useIdentity } from "../../lib/identity";

type UpcomingTraining = { id: number; title: string; audience: string };
type TrainingCompletion = { id: number; training_id: number; agent_name: string; status: "not_started" | "in_progress" | "completed" };

export function TrainingUpdatesTile({ onExpand }: { onExpand: () => void }) {
  const { identity } = useIdentity();
  const [trainings, setTrainings] = useState<UpcomingTraining[]>([]);
  const [completions, setCompletions] = useState<TrainingCompletion[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/upcoming_trainings").then((r) => r.json()).catch(() => ({ trainings: [] })),
      fetch("/api/training_completions").then((r) => r.json()).catch(() => ({ completions: [] })),
    ]).then(([a, b]) => {
      setTrainings(a.trainings ?? []);
      setCompletions(b.completions ?? []);
    });
  }, []);

  const myRows = useMemo(() => {
    if (!identity?.name) return [] as TrainingCompletion[];
    return completions.filter((c) => c.agent_name === identity.name);
  }, [completions, identity?.name]);

  const completed = myRows.filter((r) => r.status === "completed").length;
  const inProgress = myRows.filter((r) => r.status === "in_progress").length;

  return (
    <WidgetTile
      title="Training Hub"
      description="Certifications assigned, completion tracking, target dates"
      icon={IconSchool}
      iconColor="blue"
      onExpand={onExpand}
      status={{ label: `${trainings.length} active`, color: "blue" }}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon radius="md" variant="light" color="blue"><IconTargetArrow size={16} /></ThemeIcon>
          <div style={{ flex: 1 }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Progress snapshot</Text>
            <Title order={3} c="blue.4" style={{ lineHeight: 1.1 }}>{completed}</Title>
            <Text size="xs" c="dimmed">completed · {inProgress} in progress</Text>
          </div>
          <Badge variant="light" color={completed > 0 ? "green" : "gray"}>{completed} done</Badge>
        </Group>
      </Stack>
    </WidgetTile>
  );
}
