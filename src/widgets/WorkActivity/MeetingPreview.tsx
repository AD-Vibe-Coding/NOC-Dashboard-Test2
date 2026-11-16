import { useEffect, useState } from "react";
import { Badge, Box, Button, Card, Group, ScrollArea, SimpleGrid, Skeleton, Stack, Text } from "@mantine/core";
import { IconExternalLink } from "@tabler/icons-react";
import { db } from "../../db";
import { useIdentity } from "../../lib/identity";

type Meeting = {
  id: string;
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  joinLink?: string | null;
  htmlLink?: string;
  colorId?: string;
};

type CalendarResponse = {
  connected: boolean;
  events: Meeting[];
  error?: string;
};

const EVENT_COLORS: Record<string, string> = {
  "1": "blue", "2": "teal", "3": "gray", "4": "red", "5": "yellow", "6": "orange",
  "7": "cyan", "8": "dark", "9": "blue", "10": "green", "11": "violet",
};

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isToday(meeting: Meeting) {
  if (meeting.start?.date && !meeting.start.dateTime) return meeting.start.date === localDateKey(new Date());
  return !!meeting.start?.dateTime && new Date(meeting.start.dateTime).toDateString() === new Date().toDateString();
}

function meetingTime(meeting: Meeting) {
  if (!meeting.start?.dateTime) return "All day";
  const start = new Date(meeting.start.dateTime);
  const end = meeting.end?.dateTime ? new Date(meeting.end.dateTime) : null;
  const format = (date: Date) => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return end ? `${format(start)} – ${format(end)}` : format(start);
}

function hasEnded(meeting: Meeting) {
  if (meeting.start?.date && !meeting.start.dateTime) return false;
  return !!meeting.end?.dateTime && new Date(meeting.end.dateTime).getTime() < Date.now();
}

function getState(meeting: Meeting) {
  const now = Date.now();
  const start = meeting.start?.dateTime ? new Date(meeting.start.dateTime).getTime() : null;
  const end = meeting.end?.dateTime ? new Date(meeting.end.dateTime).getTime() : null;
  if (start !== null && end !== null && now >= start && now <= end) return { label: "NOW", color: "green" };
  if (start !== null && start > now && start - now <= 30 * 60 * 1000) return { label: "SOON", color: "yellow" };
  return { label: "LATER", color: "blue" };
}

type ActionItem = Awaited<ReturnType<typeof db.personal_action_items.list>>[number];
type OwnershipTask = {
  id: string | number;
  title: string;
  status?: string;
  details?: string | null;
  operational_date?: string;
};
type MyDayTask = {
  key: string;
  title: string;
  status: string;
  kind: "Action item" | "Ownership";
  dueDate?: string | null;
  priority?: string | null;
};

function normalizeName(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isOpenStatus(status: string | null | undefined) {
  return String(status ?? "open").toLowerCase() !== "done" && String(status ?? "open").toLowerCase() !== "completed";
}

function taskStatusColor(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "blocked") return "red";
  if (normalized === "in_progress") return "blue";
  return "gray";
}

function formatDueDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function MyDayPanel() {
  const { identity } = useIdentity();
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [tasks, setTasks] = useState<MyDayTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/calendar/events", { credentials: "include" });
        if (!response.ok) throw new Error(`Calendar request failed (${response.status})`);
        const result = await response.json() as CalendarResponse;
        if (active) setCalendar(result);
      } catch {
        if (active) setCalendar({ connected: false, events: [], error: "Calendar unavailable" });
      } finally {
        if (active) setCalendarLoading(false);
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadTasks = async () => {
      if (!identity?.name) {
        setTasks([]);
        setTasksLoading(false);
        setTasksError(null);
        return;
      }
      setTasksLoading(true);
      setTasksError(null);
      const [actionResult, ownershipResult] = await Promise.allSettled([
        db.personal_action_items.list({ orderBy: { column: "created_at", ascending: false } }),
        fetch("/api/my/ownership-tasks", { credentials: "include" }),
      ]);
      if (!active) return;

      let sourceAvailable = false;
      const nextTasks: MyDayTask[] = [];
      if (actionResult.status === "fulfilled") {
        sourceAvailable = true;
        const assigned = actionResult.value.filter((task: ActionItem) =>
          isOpenStatus(task.status) && (
            normalizeName(task.employee_name) === normalizeName(identity.name) ||
            normalizeName(task.owner_name) === normalizeName(identity.name)
          ),
        );
        for (const task of assigned) {
          nextTasks.push({
            key: `action-${task.id}`,
            title: task.title,
            status: task.status,
            kind: "Action item",
            dueDate: task.due_date,
            priority: task.priority,
          });
        }
      }

      if (ownershipResult.status === "fulfilled" && ownershipResult.value.ok) {
        sourceAvailable = true;
        const ownershipRows = await ownershipResult.value.json() as OwnershipTask[];
        for (const task of ownershipRows) {
          if (!isOpenStatus(task.status)) continue;
          nextTasks.push({
            key: `ownership-${task.id}`,
            title: task.title,
            status: "open",
            kind: "Ownership",
          });
        }
      }

      const priorityRank = (priority?: string | null) => {
        const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        return rank[String(priority ?? "").toLowerCase()] ?? 4;
      };
      nextTasks.sort((a, b) => {
        const dueA = a.dueDate ? a.dueDate.slice(0, 10) : "9999-12-31";
        const dueB = b.dueDate ? b.dueDate.slice(0, 10) : "9999-12-31";
        return dueA.localeCompare(dueB) || priorityRank(a.priority) - priorityRank(b.priority) || a.title.localeCompare(b.title);
      });
      setTasks(nextTasks);
      setTasksError(sourceAvailable ? null : "Unable to load open tasks.");
      setTasksLoading(false);
    };

    void loadTasks();
    const interval = window.setInterval(() => void loadTasks(), 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [identity?.name]);

  const meetings = (calendar?.events ?? [])
    .filter((meeting) => meeting.status !== "cancelled" && isToday(meeting) && !hasEnded(meeting))
    .sort((a, b) => new Date(a.start?.dateTime ?? a.start?.date ?? 0).getTime() - new Date(b.start?.dateTime ?? b.start?.date ?? 0).getTime());

  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" mt="sm" verticalSpacing="sm">
      <Stack gap={4} miw={0} aria-label="Today's meetings">
        <Group justify="space-between" align="center" gap={4}>
          <Text size="xs" fw={700} style={{ lineHeight: 1.05 }}>Today’s meetings</Text>
          {calendar?.connected && !calendarLoading && <Badge size="xs" variant="light" color="appdirect">{meetings.length}</Badge>}
        </Group>
        {calendarLoading ? (
          <Stack gap={5}>
            <Skeleton height={38} radius="md" />
            <Skeleton height={38} radius="md" />
          </Stack>
        ) : !calendar?.connected ? (
          <Text size="xs" c="dimmed">{calendar?.error ?? "Connect Google Calendar to see meetings"}</Text>
        ) : meetings.length === 0 ? (
          <Text size="xs" c="dimmed">No meetings scheduled for today.</Text>
        ) : (
          <ScrollArea.Autosize mah={356} offsetScrollbars type="auto">
            <Stack gap={4} pr={4}>
              {meetings.map((meeting) => {
                const state = getState(meeting);
                const eventColor = EVENT_COLORS[meeting.colorId ?? ""] ?? "appdirect";
                const borderColor = state.label === "NOW" || state.label === "SOON" ? state.color : eventColor;
                const joinUrl = meeting.joinLink ?? meeting.htmlLink;
                return (
                  <Card key={meeting.id} withBorder radius="md" p={6} style={{ borderLeft: `3px solid var(--mantine-color-${borderColor}-6)` }}>
                    <Group justify="space-between" wrap="nowrap" gap={6} align="flex-start">
                      <Box style={{ minWidth: 0, flex: 1 }}>
                        <Group gap={4} wrap="nowrap" align="flex-start">
                          <Badge size="xs" px={5} color={state.color} variant={state.label === "NOW" ? "filled" : "light"}>{state.label}</Badge>
                          <Text size="xs" fw={state.label === "NOW" ? 700 : 500} lineClamp={2} style={{ lineHeight: 1.1 }}>{meeting.summary || "Untitled meeting"}</Text>
                        </Group>
                        <Text size="10px" c="dimmed" ff="monospace" mt={2} style={{ lineHeight: 1.05 }}>{meetingTime(meeting)}</Text>
                      </Box>
                      {joinUrl && (
                        <Button component="a" href={joinUrl} target="_blank" rel="noopener noreferrer" size="compact-xs" px={8} variant="light" color={state.label === "NOW" ? "green" : "appdirect"} rightSection={<IconExternalLink size={11} />} style={{ flexShrink: 0, marginTop: 1 }} aria-label={`Join ${meeting.summary || "meeting"}`}>
                          Join
                        </Button>
                      )}
                    </Group>
                  </Card>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Stack>

      <Stack gap={4} miw={0} aria-label="Open tasks">
        <Group justify="space-between" align="center" gap={4}>
          <Text size="xs" fw={700} style={{ lineHeight: 1.05 }}>Open tasks</Text>
          {!tasksLoading && !tasksError && <Badge size="xs" variant="light" color={tasks.length ? "yellow" : "green"}>{tasks.length}</Badge>}
        </Group>
        {tasksLoading ? (
          <Stack gap={5}>
            <Skeleton height={38} radius="md" />
            <Skeleton height={38} radius="md" />
            <Skeleton height={38} radius="md" />
          </Stack>
        ) : !identity?.name ? (
          <Text size="xs" c="dimmed">Set your identity to see assigned tasks.</Text>
        ) : tasksError ? (
          <Text size="xs" c="red">{tasksError}</Text>
        ) : tasks.length === 0 ? (
          <Text size="xs" c="dimmed">You’re all caught up.</Text>
        ) : (
          <ScrollArea.Autosize mah={356} offsetScrollbars type="auto" aria-label="Scrollable open task list">
            <Stack gap={4} pr={4}>
              {tasks.map((task) => {
                const due = formatDueDate(task.dueDate);
                return (
                  <Card key={task.key} withBorder radius="md" p={6}>
                    <Group justify="space-between" wrap="nowrap" gap={6} align="flex-start">
                      <Box style={{ minWidth: 0, flex: 1 }}>
                        <Group gap={4} wrap="nowrap" align="flex-start">
                          <Badge size="xs" px={5} color={taskStatusColor(task.status)} variant="light">{task.status.replace(/_/g, " ")}</Badge>
                          <Text size="xs" fw={500} lineClamp={2} style={{ lineHeight: 1.15 }} title={task.title}>{task.title}</Text>
                        </Group>
                        <Group gap={6} mt={2} wrap="wrap">
                          <Text size="10px" c="dimmed">{task.kind}</Text>
                          {task.priority && <Text size="10px" c="dimmed">· {task.priority} priority</Text>}
                          {due && <Text size="10px" c="dimmed">· Due {due}</Text>}
                        </Group>
                      </Box>
                    </Group>
                  </Card>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Stack>
    </SimpleGrid>
  );
}
