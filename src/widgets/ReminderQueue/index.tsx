import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBellRinging,
  IconCalendarClock,
  IconPlayerPlay,
  IconRefresh,
  IconTargetArrow,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { db } from "../../db";

export { ReminderQueueTile } from "./Tile";

type JobRow = Awaited<ReturnType<typeof db.meeting_reminder_jobs.list>>[number];
type TargetRow = Awaited<ReturnType<typeof db.notification_targets.list>>[number];
type PolicyRow = Awaited<ReturnType<typeof db.reminder_policies.list>>[number];
type MeetingRow = Awaited<ReturnType<typeof db.calendar_meetings.list>>[number];
type EventRow = Awaited<ReturnType<typeof db.reminder_events.list>>[number];

type CronAction = "run" | "sync" | "plan" | "dispatch" | "reconcile";

const EMPTY_TARGET = { employee_name: "", employee_email: "", slack_user_id: "", enabled: true };

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ReminderQueueWidget() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<CronAction | null>(null);
  const [savingTarget, setSavingTarget] = useState(false);
  const [targetForm, setTargetForm] = useState(EMPTY_TARGET);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [jobRows, targetRows, policyRows, meetingRows, eventRows] = await Promise.all([
        db.meeting_reminder_jobs.list({ orderBy: { column: "scheduled_for", ascending: true }, limit: 200 }),
        db.notification_targets.list({ orderBy: { column: "employee_name", ascending: true }, limit: 100 }),
        db.reminder_policies.list({ orderBy: { column: "employee_name", ascending: true }, limit: 100 }),
        db.calendar_meetings.list({ orderBy: { column: "start_at", ascending: true }, limit: 100 }),
        db.reminder_events.list({ orderBy: { column: "sent_at", ascending: false }, limit: 100 }),
      ]);
      setJobs(jobRows);
      setTargets(targetRows);
      setPolicies(policyRows);
      setMeetings(meetingRows);
      setEvents(eventRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function runAction(action: CronAction) {
    setRunning(action);
    setError(null);
    try {
      const endpoint = action === "run" ? "/api/reminders/meetings/automation" : `/api/reminders/meetings/${action}`;
      const body = action === "run" ? JSON.stringify({ action: "run" }) : undefined;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? `Failed to run ${action}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
    }
  }

  async function saveTarget() {
    if (!targetForm.employee_name.trim()) return;
    setSavingTarget(true);
    setError(null);
    try {
      await db.notification_targets.insert({
        employee_name: targetForm.employee_name.trim(),
        employee_email: targetForm.employee_email.trim() || null,
        channel_type: "slack_dm",
        slack_user_id: targetForm.slack_user_id.trim() || null,
        enabled: targetForm.enabled,
      });
      setTargetForm(EMPTY_TARGET);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTarget(false);
    }
  }

  async function togglePolicy(policy: PolicyRow, key: "meeting_enabled" | "offset_30_enabled" | "offset_15_enabled" | "offset_5_enabled" | "only_with_join_link") {
    try {
      await db.reminder_policies.updateById(Number(policy.id), { [key]: !policy[key] } as Partial<PolicyRow>);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const counts = useMemo(() => ({
    pending: jobs.filter((job) => job.status === "pending").length,
    sending: jobs.filter((job) => job.status === "sending").length,
    failed: jobs.filter((job) => job.status === "failed" || job.status === "dead_letter").length,
    sent: jobs.filter((job) => job.status === "sent").length,
  }), [jobs]);

  return (
    <WidgetFrame
      title="Reminder Queue"
      subtitle={`${counts.pending} pending · ${counts.sent} sent · ${counts.failed} failed`}
      icon={IconBellRinging}
      iconColor="orange"
      loading={loading}
      onRefresh={() => void runAction("run")}
      status={{
        label: counts.failed > 0 ? "Attention needed" : "Cron ready",
        color: counts.failed > 0 ? "red" : "green",
        tooltip: "Vercel Cron + Supabase-backed meeting reminders",
      }}
    >
      <Stack gap="lg">
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light">
            {error}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          <MetricCard label="Tracked meetings" value={String(meetings.length)} color="blue" icon={<IconCalendarClock size={18} />} />
          <MetricCard label="Pending jobs" value={String(counts.pending)} color="orange" icon={<IconBellRinging size={18} />} />
          <MetricCard label="Sent today" value={String(events.length)} color="green" icon={<IconTargetArrow size={18} />} />
          <MetricCard label="Failures" value={String(counts.failed)} color="red" icon={<IconAlertCircle size={18} />} />
        </SimpleGrid>

        <Card withBorder radius="lg" p="lg">
          <Stack gap="md">
            <Alert icon={<IconAlertCircle size={16} />} color="blue" variant="light">
              Use <strong>Refresh</strong> or <strong>Run automation</strong> to execute the full reminder pipeline in preview/dev, just like Work Allotment. Production Vercel Cron can still run the same steps automatically on a deployed URL.
            </Alert>
            <Group justify="space-between" align="center">
              <div>
                <Text fw={700}>Manual server actions</Text>
                <Text size="sm" c="dimmed">Run the same server-side steps that Vercel Cron runs in production.</Text>
              </div>
              <Group gap="xs">
                <Button
                  variant="filled"
                  color="orange"
                  leftSection={<IconPlayerPlay size={16} />}
                  loading={running === "run"}
                  onClick={() => void runAction("run")}
                >
                  Run automation
                </Button>
                {(["sync", "plan", "dispatch", "reconcile"] as Exclude<CronAction, "run">[]).map((action) => (
                  <Button
                    key={action}
                    variant="light"
                    color="gray"
                    leftSection={<IconRefresh size={16} />}
                    loading={running === action}
                    onClick={() => void runAction(action)}
                  >
                    {action}
                  </Button>
                ))}
              </Group>
            </Group>
          </Stack>
        </Card>

        <SimpleGrid cols={{ base: 1, xl: 2 }}>
          <Card withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Text fw={700}>Notification targets</Text>
              <Group grow>
                <TextInput label="Employee name" value={targetForm.employee_name} onChange={(event) => setTargetForm((prev) => ({ ...prev, employee_name: event.currentTarget.value }))} />
                <TextInput label="Email" value={targetForm.employee_email} onChange={(event) => setTargetForm((prev) => ({ ...prev, employee_email: event.currentTarget.value }))} />
              </Group>
              <Group grow align="end">
                <TextInput label="Slack user ID" placeholder="U12345678" value={targetForm.slack_user_id} onChange={(event) => setTargetForm((prev) => ({ ...prev, slack_user_id: event.currentTarget.value }))} />
                <Checkbox label="Enabled" checked={targetForm.enabled} onChange={(event) => setTargetForm((prev) => ({ ...prev, enabled: event.currentTarget.checked }))} />
                <Button onClick={() => void saveTarget()} loading={savingTarget}>Save target</Button>
              </Group>
              <ScrollArea h={240}>
                <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Slack</Table.Th>
                      <Table.Th>Status</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {targets.map((target) => (
                      <Table.Tr key={target.id}>
                        <Table.Td>
                          <Text fw={600}>{target.employee_name}</Text>
                          <Text size="xs" c="dimmed">{target.employee_email || "—"}</Text>
                        </Table.Td>
                        <Table.Td>{target.slack_user_id || target.slack_channel_id || "fallback mapping"}</Table.Td>
                        <Table.Td><Badge color={target.enabled ? "green" : "gray"} variant="light">{target.enabled ? "Enabled" : "Disabled"}</Badge></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Stack>
          </Card>

          <Card withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Text fw={700}>Reminder policies</Text>
              <ScrollArea h={360}>
                <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>30</Table.Th>
                      <Table.Th>15</Table.Th>
                      <Table.Th>5</Table.Th>
                      <Table.Th>Join link only</Table.Th>
                      <Table.Th>Enabled</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {policies.map((policy) => (
                      <Table.Tr key={policy.id}>
                        <Table.Td>
                          <Text fw={600}>{policy.employee_name}</Text>
                          <Text size="xs" c="dimmed">{policy.employee_email || policy.timezone || "—"}</Text>
                        </Table.Td>
                        <Table.Td><Checkbox checked={Boolean(policy.offset_30_enabled)} onChange={() => void togglePolicy(policy, "offset_30_enabled")} /></Table.Td>
                        <Table.Td><Checkbox checked={Boolean(policy.offset_15_enabled)} onChange={() => void togglePolicy(policy, "offset_15_enabled")} /></Table.Td>
                        <Table.Td><Checkbox checked={Boolean(policy.offset_5_enabled)} onChange={() => void togglePolicy(policy, "offset_5_enabled")} /></Table.Td>
                        <Table.Td><Checkbox checked={Boolean(policy.only_with_join_link)} onChange={() => void togglePolicy(policy, "only_with_join_link")} /></Table.Td>
                        <Table.Td><Checkbox checked={Boolean(policy.meeting_enabled)} onChange={() => void togglePolicy(policy, "meeting_enabled")} /></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Stack>
          </Card>
        </SimpleGrid>

        <Card withBorder radius="lg" p="lg">
          <Stack gap="md">
            <Group justify="space-between">
              <Text fw={700}>Reminder jobs</Text>
              <Group gap="xs">
                <Badge variant="light" color="orange">{counts.pending} pending</Badge>
                <Badge variant="light" color="blue">{counts.sending} sending</Badge>
                <Badge variant="light" color="green">{counts.sent} sent</Badge>
                <Badge variant="light" color={counts.failed > 0 ? "red" : "gray"}>{counts.failed} failed</Badge>
              </Group>
            </Group>
            <Divider />
            <ScrollArea h={320}>
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Employee</Table.Th>
                    <Table.Th>Meeting</Table.Th>
                    <Table.Th>Offset</Table.Th>
                    <Table.Th>Scheduled</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Attempts</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {jobs.map((job) => {
                    const payload = typeof job.payload_json === "string" ? JSON.parse(job.payload_json || "{}") : {};
                    return (
                      <Table.Tr key={job.id}>
                        <Table.Td>
                          <Text fw={600}>{job.employee_name}</Text>
                          <Text size="xs" c="dimmed">{job.employee_email}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text lineClamp={1}>{String(payload?.title || job.calendar_event_id)}</Text>
                          <Text size="xs" c="dimmed">{formatDateTime(job.meeting_start_at)}</Text>
                        </Table.Td>
                        <Table.Td>{job.reminder_offset_minutes} min</Table.Td>
                        <Table.Td>{formatDateTime(job.scheduled_for)}</Table.Td>
                        <Table.Td>
                          <Badge color={job.status === "sent" ? "green" : job.status === "pending" ? "orange" : job.status === "sending" ? "blue" : job.status === "cancelled" ? "gray" : "red"} variant="light">
                            {job.status}
                          </Badge>
                          {job.last_error ? <Text size="xs" c="red" lineClamp={2}>{job.last_error}</Text> : null}
                        </Table.Td>
                        <Table.Td>{job.attempt_count ?? 0}</Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Stack>
        </Card>
      </Stack>
    </WidgetFrame>
  );
}

function MetricCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: ReactNode }) {
  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap="xs">
        <Group justify="space-between">
          <Badge color={color} variant="light">{label}</Badge>
          <ActionIcon variant="light" color={color} radius="md">{icon}</ActionIcon>
        </Group>
        <Text size="xl" fw={800}>{value}</Text>
      </Stack>
    </Card>
  );
}
