import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Grid,
  Group,
  Loader,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCalendar,
  IconChecks,
  IconExternalLink,
  IconMapPin,
  IconPhone,
  IconPhoneCall,
  IconRefresh,
  IconRosetteDiscountCheck,
  IconTicket,
  IconTrash,
  IconUnlink,
} from "@tabler/icons-react";
import { useIdentity } from "../../lib/identity";
import { db } from "../../db";

type Priority = "high" | "medium" | "low";
type Category = "1-on-1s" | "audits" | "reports" | "team" | "admin" | "other";
type MeetingTaskStatus = "open" | "in_progress" | "blocked" | "done";

interface Task {
  id: string;
  text: string;
  priority: Priority;
  category: Category;
  done: boolean;
  createdAt: number;
}

interface DayState {
  focus: string;
  tasks: Task[];
}

type MeetingTask = Awaited<ReturnType<typeof db.personal_action_items.list>>[number];

interface CalendarEvent {
  id: string;
  summary?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
  status?: string;
  htmlLink?: string;
  joinLink?: string | null;
  colorId?: string;
}

interface CalendarResult {
  connected: boolean;
  events: CalendarEvent[];
  error?: string;
}

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string }> = {
  high: { label: "High", color: "red" },
  medium: { label: "Medium", color: "orange" },
  low: { label: "Low", color: "gray" },
};

const CATEGORY_CONFIG: Record<Category, { label: string; color: string }> = {
  "1-on-1s": { label: "1-on-1s", color: "violet" },
  audits: { label: "Audits", color: "pink" },
  reports: { label: "Reports", color: "blue" },
  team: { label: "Team", color: "cyan" },
  admin: { label: "Admin", color: "gray" },
  other: { label: "Other", color: "dark" },
};

const CATEGORIES: Category[] = ["1-on-1s", "audits", "reports", "team", "admin", "other"];
const PRIORITIES: Priority[] = ["high", "medium", "low"];
const EVENT_COLORS: Record<string, string> = {
  "1": "blue", "2": "teal", "3": "gray", "4": "red",
  "5": "yellow", "6": "orange", "7": "cyan", "8": "dark",
  "9": "blue", "10": "green", "11": "violet",
};

function todayKey(name: string) {
  return `manager-day:${name}:${new Date().toISOString().slice(0, 10)}`;
}
function loadDay(name: string): DayState {
  try {
    const raw = localStorage.getItem(todayKey(name));
    if (raw) return JSON.parse(raw) as DayState;
  } catch {}
  return { focus: "", tasks: [] };
}
function saveDay(name: string, state: DayState) {
  try { localStorage.setItem(todayKey(name), JSON.stringify(state)); } catch {}
}
function meetingPlanKey(name: string) {
  return `manager-day:meeting-plan:${name}:${new Date().toISOString().slice(0, 10)}`;
}
function loadMeetingPlan(name: string): number[] {
  try {
    const raw = localStorage.getItem(meetingPlanKey(name));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}
function saveMeetingPlan(name: string, taskIds: number[]) {
  try { localStorage.setItem(meetingPlanKey(name), JSON.stringify(taskIds)); } catch {}
}
function samePerson(a: string | null | undefined, b: string | null | undefined) {
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}
function formatDueDate(value?: string | null) {
  if (!value) return "No due date";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function meetingTaskSource(task: MeetingTask) {
  return task.details || task.section_name || task.notebook_group || "Meeting notes";
}
function openCalendarPopup(): Promise<boolean> {
  return new Promise((resolve) => {
    const w = 520, h = 640;
    const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
    const top = Math.round(window.screenY + (window.outerHeight - h) / 2);
    const popup = window.open(
      "/api/calendar/start",
      "gcal_oauth",
      `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no`,
    );
    if (!popup) { resolve(false); return; }
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "gcal-oauth-success") { cleanup(); resolve(true); }
      else if (e.data?.type === "gcal-oauth-error") { cleanup(); resolve(false); }
    }
    function cleanup() {
      window.removeEventListener("message", onMessage);
      clearInterval(poll);
    }
    window.addEventListener("message", onMessage);
    const poll = setInterval(() => { if (popup.closed) { cleanup(); resolve(false); } }, 500);
  });
}
function useCalendar() {
  const [result, setResult] = useState<CalendarResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/calendar/events", { credentials: "include" });
      setResult(await r.json() as CalendarResult);
    } catch {
      setResult({ connected: false, events: [] });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void fetchEvents(); }, [fetchEvents]);
  async function connect() {
    setConnecting(true);
    const ok = await openCalendarPopup();
    if (ok) await fetchEvents();
    setConnecting(false);
  }
  async function disconnect() {
    await fetch("/api/calendar/disconnect", { method: "POST", credentials: "include" });
    setResult({ connected: false, events: [] });
  }
  return { result, loading, connecting, connect, disconnect, refresh: fetchEvents };
}
function formatTime(event: CalendarEvent): string {
  if (event.start.date && !event.start.dateTime) return "All day";
  if (!event.start.dateTime) return "";
  const s = new Date(event.start.dateTime);
  const e = event.end.dateTime ? new Date(event.end.dateTime) : null;
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return e ? `${fmt(s)} – ${fmt(e)}` : fmt(s);
}
function isNow(event: CalendarEvent): boolean {
  if (!event.start.dateTime || !event.end.dateTime) return false;
  const now = Date.now();
  return now >= new Date(event.start.dateTime).getTime() && now <= new Date(event.end.dateTime).getTime();
}
function isPast(event: CalendarEvent): boolean {
  if (event.start.date && !event.start.dateTime) return false;
  if (!event.end.dateTime) return false;
  return new Date(event.end.dateTime).getTime() < Date.now();
}
function isSoon(event: CalendarEvent): boolean {
  if (!event.start.dateTime) return false;
  const diff = new Date(event.start.dateTime).getTime() - Date.now();
  return diff > 0 && diff <= 30 * 60 * 1000;
}
function isTodayLocal(event: CalendarEvent): boolean {
  if (!event.start.dateTime) return false;
  return new Date(event.start.dateTime).toDateString() === new Date().toDateString();
}

function CalendarSection({ result, loading, connecting, connect, disconnect, refresh }: ReturnType<typeof useCalendar>) {
  if (loading) {
    return <Group gap="xs"><Loader size="xs" /><Text size="xs" c="dimmed">Loading calendar…</Text></Group>;
  }
  if (!result?.connected) {
    return (
      <Card withBorder radius="md" p="sm" style={{ borderStyle: "dashed" }}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon size="sm" variant="light" color="appdirect"><IconCalendar size={14} /></ThemeIcon>
            <Box>
              <Text size="sm" fw={600}>Google Calendar</Text>
              <Text size="xs" c="dimmed">Connect to show today’s meetings</Text>
            </Box>
          </Group>
          <Button size="xs" variant="light" color="appdirect" loading={connecting} onClick={connect}>Connect</Button>
        </Group>
        {result?.error && <Alert mt="sm" p="xs" radius="md" color="yellow" icon={<IconAlertCircle size={14} />}><Text size="xs">{result.error}</Text></Alert>}
      </Card>
    );
  }
  const events = result.events.filter((e) => e.status !== "cancelled" && !isPast(e));
  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text size="sm" fw={700}>Today’s meetings</Text>
        <Group gap={4}>
          <Tooltip label="Connect / reconnect Google Calendar">
            <ActionIcon size="xs" variant="subtle" color="appdirect" loading={connecting} onClick={() => void connect()}>
              <IconCalendar size={12} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Refresh"><ActionIcon size="xs" variant="subtle" color="gray" onClick={() => void refresh()}><IconRefresh size={12} /></ActionIcon></Tooltip>
          <Tooltip label="Disconnect"><ActionIcon size="xs" variant="subtle" color="red" onClick={() => void disconnect()}><IconUnlink size={12} /></ActionIcon></Tooltip>
        </Group>
      </Group>
      {events.length === 0 ? <Text size="sm" c="dimmed">No meetings scheduled for today.</Text> : (
        <ScrollArea.Autosize mah={440} offsetScrollbars>
          <Stack gap="xs">
            {events.map((event) => {
              const current = isNow(event);
              const past = isPast(event);
              const state = current ? { label: "now", color: "green" } : isSoon(event) ? { label: "soon", color: "yellow" } : past ? { label: "done", color: "gray" } : { label: "later", color: "blue" };
              const color = EVENT_COLORS[event.colorId ?? ""] ?? "appdirect";
              return (
                <Card key={event.id} withBorder radius="md" p="sm" style={{ opacity: past ? 0.55 : 1, borderLeft: `3px solid var(--mantine-color-${current ? "green" : color}-${current ? "5" : "7"})` }}>
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Group gap={6} wrap="nowrap">
                        <Badge size="xs" color={state.color} variant={current ? "filled" : "light"}>{state.label}</Badge>
                        <Text size="sm" fw={current ? 700 : 500} lineClamp={2}>{event.summary ?? "Untitled event"}</Text>
                      </Group>
                      <Group gap="xs" mt={3} wrap="wrap">
                        <Text size="xs" c="dimmed" ff="monospace">{formatTime(event)}</Text>
                        {event.location ? <Group gap={3} wrap="nowrap" align="flex-start"><IconMapPin size={10} style={{ flexShrink: 0, marginTop: 2 }} /><Text size="xs" c="dimmed" style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{event.location}</Text></Group> : null}
                      </Group>
                    </Box>
                    {(event.joinLink ?? event.htmlLink) ? (
                      <Button
                        component="a"
                        href={event.joinLink ?? event.htmlLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        size="compact-xs"
                        variant="light"
                        color={current ? "green" : "appdirect"}
                        rightSection={<IconExternalLink size={12} />}
                        style={{ flexShrink: 0 }}
                      >
                        Join
                      </Button>
                    ) : null}
                  </Group>
                </Card>
              );
            })}
          </Stack>
        </ScrollArea.Autosize>
      )}
    </Stack>
  );
}

export function ManagerDayWidget() {
  const { identity } = useIdentity();
  const managerName = identity?.name ?? "manager";
  const calendar = useCalendar();
  const [state, setState] = useState<DayState>(() => loadDay(managerName));
  const [newText, setNewText] = useState("");
  const [newPriority, setNewPriority] = useState<Priority>("medium");
  const [newCategory, setNewCategory] = useState<Category>("other");
  const [meetingTasks, setMeetingTasks] = useState<MeetingTask[]>([]);
  const [plannedMeetingTaskIds, setPlannedMeetingTaskIds] = useState<number[]>(() => loadMeetingPlan(managerName));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { saveDay(managerName, state); }, [managerName, state]);
  useEffect(() => { saveMeetingPlan(managerName, plannedMeetingTaskIds); }, [managerName, plannedMeetingTaskIds]);
  useEffect(() => { setPlannedMeetingTaskIds(loadMeetingPlan(managerName)); }, [managerName]);
  useEffect(() => {
    function syncFromStorage(event: StorageEvent) {
      if (!identity?.name) return;
      if (event.key === meetingPlanKey(identity.name)) setPlannedMeetingTaskIds(loadMeetingPlan(identity.name));
    }
    window.addEventListener("storage", syncFromStorage);
    return () => window.removeEventListener("storage", syncFromStorage);
  }, [identity?.name]);

  const loadMeetingTasks = useCallback(async () => {
    if (!identity?.name) {
      setMeetingTasks([]);
      return;
    }
    try {
      const rows = await db.personal_action_items.list({ orderBy: { column: "created_at", ascending: false } });
      setMeetingTasks(rows.filter((task) => !!task.note_id && (samePerson(task.owner_name, identity.name) || samePerson(task.employee_name, identity.name))));
    } catch {
      setMeetingTasks([]);
    }
  }, [identity?.name]);
  useEffect(() => { void loadMeetingTasks(); }, [loadMeetingTasks]);

  async function updateMeetingTaskStatus(task: MeetingTask, status: MeetingTaskStatus) {
    const nextProgress = status === "done" ? 100 : status === "open" ? 0 : (task.progress_percent ?? 0);
    setMeetingTasks((prev) => prev.map((item) => (item.id === task.id ? { ...item, status, progress_percent: nextProgress } : item)));
    try {
      await db.personal_action_items.updateById(task.id, { status, progress_percent: nextProgress });
    } finally {
      await loadMeetingTasks();
    }
  }
  function addMeetingTaskToPlan(task: MeetingTask) {
    setPlannedMeetingTaskIds((prev) => (prev.includes(task.id) ? prev : [task.id, ...prev]));
  }
  function removeMeetingTaskFromPlan(taskId: number) {
    setPlannedMeetingTaskIds((prev) => prev.filter((id) => id !== taskId));
  }
  function addTask() {
    const text = newText.trim();
    if (!text) return;
    const task: Task = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, text, priority: newPriority, category: newCategory, done: false, createdAt: Date.now() };
    setState((s) => ({ ...s, tasks: [...s.tasks, task] }));
    setNewText("");
    inputRef.current?.focus();
  }
  function toggleTask(id: string) {
    setState((s) => ({ ...s, tasks: s.tasks.map((t) => t.id === id ? { ...t, done: !t.done } : t) }));
  }
  function deleteTask(id: string) {
    setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
  }

  const personalTasks = useMemo(() => [...state.tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const pr = (p: Priority) => p === "high" ? 0 : p === "medium" ? 1 : 2;
    return pr(a.priority) - pr(b.priority);
  }), [state.tasks]);
  const meetingOpenTasks = useMemo(() => meetingTasks.filter((task) => task.status === "open"), [meetingTasks]);
  const meetingDoingTasks = useMemo(() => meetingTasks.filter((task) => task.status === "in_progress"), [meetingTasks]);
  const meetingBlockedTasks = useMemo(() => meetingTasks.filter((task) => task.status === "blocked"), [meetingTasks]);
  const pinnedToday = useMemo(() => meetingTasks.filter((task) => plannedMeetingTaskIds.includes(task.id) && task.status !== "done"), [meetingTasks, plannedMeetingTaskIds]);
  const isManager = identity?.role === "manager";
  const todayMeetings = (calendar.result?.events ?? []).filter((event) => event.status !== "cancelled" && isTodayLocal(event));
  const openPersonalTasks = personalTasks.filter((task) => !task.done);
  const activeMeetingFollowUps = [...meetingDoingTasks, ...meetingOpenTasks];
  const totalActionCount = openPersonalTasks.length + meetingOpenTasks.length + meetingDoingTasks.length + meetingBlockedTasks.length;
  const snapshotMetrics = [
    {
      key: "tickets_ack",
      label: isManager ? "Team tickets ack" : "Tickets acknowledged",
      value: isManager ? 86 : 12,
      detail: isManager ? "Overall team snapshot until ticket API is connected" : "Snapshot until ticket API is connected",
      color: "blue",
      icon: IconTicket,
      source: "Snapshot",
    },
    {
      key: "tickets_updated",
      label: isManager ? "Team tickets upd" : "Tickets updated",
      value: isManager ? 214 : 27,
      detail: isManager ? "Overall team snapshot until ticket API is connected" : "Snapshot until ticket API is connected",
      color: "cyan",
      icon: IconChecks,
      source: "Snapshot",
    },
    {
      key: "calls_answered",
      label: isManager ? "Team calls ans" : "Calls answered",
      value: isManager ? 133 : 18,
      detail: isManager ? "Overall team snapshot until RingCentral API is connected" : "Snapshot until RingCentral API is connected",
      color: "green",
      icon: IconPhoneCall,
      source: "Snapshot",
    },
    {
      key: "mobility_done",
      label: isManager ? "Team mobility" : "Mobility done",
      value: isManager ? 41 : 6,
      detail: isManager ? "Overall team snapshot until mobility API is connected" : "Snapshot until mobility API is connected",
      color: "violet",
      icon: IconRosetteDiscountCheck,
      source: "Snapshot",
    },
    {
      key: "calls_made",
      label: isManager ? "Team calls made" : "Calls made",
      value: isManager ? 78 : 9,
      detail: isManager ? "Overall team snapshot until RingCentral API is connected" : "Snapshot until RingCentral API is connected",
      color: "orange",
      icon: IconPhone,
      source: "Snapshot",
    },
    {
      key: "meetings_attended",
      label: isManager ? "Team mtgs att" : "Meetings attended",
      value: isManager ? Math.max(0, todayMeetings.filter((event) => isPast(event)).length * 6) : todayMeetings.filter((event) => isPast(event)).length,
      detail: isManager ? "Overall team snapshot; calendar-based placeholder" : `${todayMeetings.length} meetings on calendar today`,
      color: "teal",
      icon: IconCalendar,
      source: calendar.result?.connected ? "Calendar" : "No calendar",
    },
  ] as const;

  return (
    <Stack gap="md">
      <Card withBorder radius="lg" p="md">
        <Stack gap="md">
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <Box>
              <Text size="xs" fw={700} tt="uppercase" c="appdirect.5" style={{ letterSpacing: "0.08em" }}>My Day</Text>
              <Text size="xl" fw={700}>Plan the day, then work the list.</Text>
              <Text size="sm" c="dimmed">{new Date().toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</Text>
            </Box>
            <Badge variant="light" color="appdirect" size="lg">{totalActionCount} active items</Badge>
          </Group>

          <Group gap="sm" align="flex-start" wrap="wrap">
            <TextInput
              ref={inputRef}
              placeholder="Quick add a task…"
              value={newText}
              onChange={(e) => setNewText(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              size="md"
              style={{ flex: 1, minWidth: 260 }}
            />
            <Button size="md" onClick={addTask} disabled={!newText.trim()} color="appdirect">Add task</Button>
            {isManager && (
              <>
                <Select size="sm" w={120} value={newPriority} onChange={(v) => v && setNewPriority(v as Priority)} data={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_CONFIG[p].label }))} />
                <Select size="sm" w={140} value={newCategory} onChange={(v) => v && setNewCategory(v as Category)} data={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_CONFIG[c].label }))} />
              </>
            )}
          </Group>
        </Stack>
      </Card>

      <SimpleGrid cols={{ base: 2, sm: 3, md: 3, xl: 6 }} spacing="xs">
        {snapshotMetrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card
              key={metric.key}
              withBorder
              radius="md"
              p="sm"
              style={{
                minHeight: 118,
                borderLeft: `3px solid var(--mantine-color-${metric.color}-6)`,
                background: `color-mix(in srgb, var(--mantine-color-${metric.color}-9) 8%, var(--mantine-color-body))`,
              }}
            >
              <Stack gap={6}>
                <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                  <Group gap="xs" wrap="nowrap" align="center" style={{ minWidth: 0, flex: 1 }}>
                    <ThemeIcon size={30} radius="md" variant="light" color={metric.color}>
                      <Icon size={16} />
                    </ThemeIcon>
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Text size="10px" tt="uppercase" fw={700} c="dimmed" style={{ lineHeight: 1.2 }}>
                        {metric.label}
                      </Text>
                      <Text size="10px" c="dimmed">Today</Text>
                    </Box>
                  </Group>
                  {isManager ? (
                    <Badge
                      size="xs"
                      variant="light"
                      color={metric.source === "Calendar" ? "teal" : metric.source === "No calendar" ? "gray" : metric.color}
                    >
                      {metric.source}
                    </Badge>
                  ) : null}
                </Group>
                <Text size={isManager ? "1.7rem" : "1.35rem"} fw={800} style={{ lineHeight: 1 }}>
                  {metric.value}
                </Text>
                {isManager ? (
                  <Text size="xs" c="dimmed" style={{ lineHeight: 1.35 }}>
                    {metric.detail}
                  </Text>
                ) : null}
              </Stack>
            </Card>
          );
        })}
      </SimpleGrid>

      <Grid gutter={isManager ? "md" : "sm"} align="flex-start">
        <Grid.Col span={{ base: 12, xl: isManager ? 7 : 8 }}>
          <Stack gap="md">
            <Card withBorder radius="lg" p="md">
              <Stack gap="sm">
                <Group justify="space-between" align="center" wrap="wrap">
                  <Box>
                    <Text size="lg" fw={700}>{isManager ? "Action list" : "My tasks"}</Text>
                    <Text size="sm" c="dimmed">{isManager ? "Personal tasks and meeting follow-ups in one working queue." : "A simple list of your tasks and meeting follow-ups."}</Text>
                  </Box>
                  <Group gap="xs" wrap="wrap">
                    {isManager && pinnedToday.length > 0 && <Badge size="sm" color="appdirect" variant="light">Pinned {pinnedToday.length}</Badge>}
                    {isManager && meetingBlockedTasks.length > 0 && <Badge size="sm" color="red" variant="light">Blocked {meetingBlockedTasks.length}</Badge>}
                    {meetingDoingTasks.length > 0 && <Badge size="sm" color="blue" variant="light">Doing {meetingDoingTasks.length}</Badge>}
                  </Group>
                </Group>

                <ScrollArea.Autosize mah={isManager ? 560 : 320} offsetScrollbars>
                  <Stack gap="sm">
                    {pinnedToday.length > 0 && (
                      <Stack gap="xs">
                        <Text size="xs" fw={700} tt="uppercase" c="dimmed">Pinned today</Text>
                        {pinnedToday.slice(0, 3).map((task) => (
                          <Card key={`pinned-${task.id}`} withBorder radius="md" p="sm">
                            <Group justify="space-between" wrap="nowrap" gap="sm">
                              <Box style={{ minWidth: 0, flex: 1 }}>
                                <Text size="sm" fw={600} style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{task.title}</Text>
                                <Text size="xs" c="dimmed">{meetingTaskSource(task)} · {formatDueDate(task.due_date)}</Text>
                              </Box>
                              <ActionIcon size="sm" variant="subtle" color="red" onClick={() => removeMeetingTaskFromPlan(task.id)}><IconTrash size={13} /></ActionIcon>
                            </Group>
                          </Card>
                        ))}
                      </Stack>
                    )}

                    {meetingBlockedTasks.length > 0 && (
                      <Stack gap="xs">
                        <Text size="xs" fw={700} tt="uppercase" c="red.4">Needs attention</Text>
                        {meetingBlockedTasks.map((task) => (
                          <Card key={`blocked-${task.id}`} withBorder radius="md" p="sm">
                            <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
                              <Box style={{ minWidth: 0, flex: 1 }}>
                                <Text size="sm" fw={600} style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{task.title}</Text>
                                <Text size="xs" c="dimmed">Meeting · {meetingTaskSource(task)} · {formatDueDate(task.due_date)}</Text>
                              </Box>
                              <Group gap={6} wrap="nowrap">
                                <Button size="compact-xs" variant="light" color="blue" onClick={() => void updateMeetingTaskStatus(task, "in_progress")}>Start</Button>
                                <Button size="compact-xs" variant="light" color="green" onClick={() => void updateMeetingTaskStatus(task, "done")}>Done</Button>
                              </Group>
                            </Group>
                          </Card>
                        ))}
                      </Stack>
                    )}

                    {isManager ? (
                      <>
                        {meetingDoingTasks.length > 0 && (
                          <Stack gap="xs">
                            <Text size="xs" fw={700} tt="uppercase" c="blue.4">In progress</Text>
                            {meetingDoingTasks.map((task) => (
                              <Card key={`doing-${task.id}`} withBorder radius="md" p="sm">
                                <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
                                  <Box style={{ minWidth: 0, flex: 1 }}>
                                    <Text size="sm" fw={600} style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{task.title}</Text>
                                    <Text size="xs" c="dimmed">Meeting · {meetingTaskSource(task)} · {formatDueDate(task.due_date)}</Text>
                                  </Box>
                                  <Button size="compact-xs" variant="light" color="green" onClick={() => void updateMeetingTaskStatus(task, "done")}>Done</Button>
                                </Group>
                              </Card>
                            ))}
                          </Stack>
                        )}

                        {meetingOpenTasks.length > 0 && (
                          <Stack gap="xs">
                            <Text size="xs" fw={700} tt="uppercase" c="dimmed">Meeting tasks</Text>
                            {meetingOpenTasks.slice(0, 6).map((task) => (
                              <Card key={`meeting-${task.id}`} withBorder radius="md" p="sm">
                                <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
                                  <Box style={{ minWidth: 0, flex: 1 }}>
                                    <Text size="sm" fw={600} style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{task.title}</Text>
                                    <Text size="xs" c="dimmed">Meeting · {meetingTaskSource(task)} · {formatDueDate(task.due_date)}</Text>
                                  </Box>
                                  <Group gap={6} wrap="nowrap">
                                    <Button size="compact-xs" variant="subtle" color="appdirect" onClick={() => addMeetingTaskToPlan(task)} disabled={plannedMeetingTaskIds.includes(task.id)}>{plannedMeetingTaskIds.includes(task.id) ? "Pinned" : "Pin"}</Button>
                                    <Button size="compact-xs" variant="light" color="blue" onClick={() => void updateMeetingTaskStatus(task, "in_progress")}>Start</Button>
                                  </Group>
                                </Group>
                              </Card>
                            ))}
                          </Stack>
                        )}
                      </>
                    ) : (
                      <Stack gap="xs">
                        <Text size="xs" fw={700} tt="uppercase" c="dimmed">Meeting follow-ups</Text>
                        {activeMeetingFollowUps.length === 0 ? <Text size="sm" c="dimmed">No meeting follow-ups right now.</Text> : activeMeetingFollowUps.slice(0, 4).map((task) => (
                          <Card key={`follow-up-${task.id}`} withBorder radius="md" p="sm">
                            <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
                              <Box style={{ minWidth: 0, flex: 1 }}>
                                <Text size="sm" fw={600} style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{task.title}</Text>
                                <Text size="xs" c="dimmed">{meetingTaskSource(task)} · {formatDueDate(task.due_date)}</Text>
                              </Box>
                              <Group gap={6} wrap="nowrap">
                                {task.status !== "in_progress" && <Button size="compact-xs" variant="light" color="blue" onClick={() => void updateMeetingTaskStatus(task, "in_progress")}>Start</Button>}
                                <Button size="compact-xs" variant="light" color="green" onClick={() => void updateMeetingTaskStatus(task, "done")}>Done</Button>
                              </Group>
                            </Group>
                          </Card>
                        ))}
                      </Stack>
                    )}

                    <Stack gap="xs">
                      <Text size="xs" fw={700} tt="uppercase" c="dimmed">Personal tasks</Text>
                      {openPersonalTasks.length === 0 ? <Text size="sm" c="dimmed">No personal tasks yet.</Text> : (isManager ? openPersonalTasks : openPersonalTasks.slice(0, 4)).map((task) => (
                        <Card key={`personal-${task.id}`} withBorder radius="md" p="sm">
                          <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
                            <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                              <Checkbox checked={task.done} onChange={() => toggleTask(task.id)} size="xs" color="appdirect" radius="sm" />
                              <Box style={{ minWidth: 0, flex: 1 }}>
                                <Text size="sm" fw={500} style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{task.text}</Text>
                                <Text size="xs" c="dimmed">Personal · {PRIORITY_CONFIG[task.priority].label} · {CATEGORY_CONFIG[task.category].label}</Text>
                              </Box>
                            </Group>
                            <ActionIcon size="xs" variant="subtle" color="red" onClick={() => deleteTask(task.id)}><IconTrash size={12} /></ActionIcon>
                          </Group>
                        </Card>
                      ))}
                    </Stack>
                  </Stack>
                </ScrollArea.Autosize>
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, xl: isManager ? 5 : 4 }}>
          <Stack gap={isManager ? "md" : "sm"} style={{ position: "sticky", top: 0 }}>
            <Card withBorder radius="lg" p="md">
              <CalendarSection {...calendar} />
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
