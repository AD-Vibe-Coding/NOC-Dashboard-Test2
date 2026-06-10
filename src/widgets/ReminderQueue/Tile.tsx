import { useEffect, useMemo, useState } from "react";
import { Badge, Box, Group, Stack, Text } from "@mantine/core";
import { IconBellRinging } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { db } from "../../db";

interface Props {
  onExpand: () => void;
}

type JobRow = Awaited<ReturnType<typeof db.meeting_reminder_jobs.list>>[number];

export function ReminderQueueTile({ onExpand }: Props) {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    db.meeting_reminder_jobs
      .list({ orderBy: { column: "created_at", ascending: false }, limit: 100 })
      .then((rows: JobRow[]) => {
        if (!cancelled) {
          setJobs(rows);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => ({
    pending: jobs.filter((job) => job.status === "pending").length,
    failed: jobs.filter((job) => job.status === "failed" || job.status === "dead_letter").length,
    sent: jobs.filter((job) => job.status === "sent").length,
  }), [jobs]);

  return (
    <WidgetTile
      title="Reminder Queue"
      description="Server-side meeting reminder delivery"
      icon={IconBellRinging}
      iconColor="orange"
      onExpand={onExpand}
      status={error ? { label: "Needs push", color: "yellow", tooltip: error } : undefined}
    >
      <Stack gap="xs">
        <Group gap={6} wrap="wrap">
          <Badge size="xs" variant="light" color="orange">{counts.pending} pending</Badge>
          <Badge size="xs" variant="light" color="green">{counts.sent} sent</Badge>
          <Badge size="xs" variant="light" color={counts.failed > 0 ? "red" : "gray"}>{counts.failed} failed</Badge>
        </Group>
        {jobs.length > 0 ? (
          <Box>
            <Text size="xs" c="dimmed">Next due</Text>
            <Text size="sm" fw={600} lineClamp={1}>{jobs.find((job) => job.status === "pending")?.employee_name ?? "Queue loaded"}</Text>
          </Box>
        ) : (
          <Text size="xs" c="dimmed">{error ? "Push schema to Supabase to activate the queue." : "No reminder jobs yet."}</Text>
        )}
      </Stack>
    </WidgetTile>
  );
}
