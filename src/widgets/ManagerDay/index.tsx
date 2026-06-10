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
  Textarea,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCalendar,
  IconExternalLink,
  IconMapPin,
  IconRefresh,
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
function getNextMeeting(events: CalendarEvent[]) {
  const now = Date.now();
  return [...events]
    .filter((event) => event.status !== "cancelled" && event.start.dateTime && new Date(event.start.dateTime).getTime() >= now)
    .sort((a, b) => new Date(a.start.dateTime!).getTime() - new Date(b.start.dateTime!).getTime())[0] ?? null;
}
function formatRelativeMeetingStart(event: CalendarEvent | null) {
  if (!event?.start.dateTime) return "No upcoming meetings";
  const diffMs = new Date(event.start.dateTime).getTime() - Date.now();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "Starting now";
  if (minutes < 60) return `Starts in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `Starts in ${hours}h` : `Starts in ${hours}h ${remainder}m`;
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
  const events = result.events.filter((e) => e.status !== "cancelled");
  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text size="sm" fw={700}>Today’s meetings</Text>
        <Group gap={4}>
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
                        {event.location ? <Group gap={3} wrap="nowrap"><IconMapPin size={10} /><Text size="xs" c="dimmed" lineClamp={1}>{event.location}</Text></Group> : null}
                      </Group>
                    </Box>
                    {event.htmlLink ? <ActionIcon component="a" href={event.htmlLink} target="_blank" rel="noopener noreferrer" size="xs" variant="subtle" color="gray"><IconExternalLink size={12} /></ActionIcon> : null}
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
  const nextMeeting = getNextMeeting((calendar.result?.events ?? []).filter((event) => event.status !== "cancelled"));
  const openPersonalTasks = personalTasks.filter((task) => !task.done);
  const totalActionCount = openPersonalTasks.length + meetingOpenTasks.length + meetingDoingTasks.length + meetingBlockedTasks.length;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="nowrap">
        <Box>
          <Text size="xs" fw={700} tt="uppercase" c="appdirect.5" style={{ letterSpacing: "0.08em" }}>My Day</Text>
          <Text size="sm" c="dimmed">{new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</Text>
        </Box>
        <Box style={{ flex: 1, maxWidth: 420 }}>
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <TextInput ref={inputRef} placeholder="Quick add a task…" value={newText} onChange={(e) => setNewText(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && addTask()} size="sm" style={{ flex: 1 }} />
            <Button size="sm" onClick={addTask} disabled={!newText.trim()} color="appdirect">Add</Button>
          </Group>
          <Group gap="xs" mt={8} wrap="wrap" justify="flex-end">
            <Select size="xs" w={110} value={newPriority} onChange={(v) => v && setNewPriority(v as Priority)} data={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_CONFIG[p].label }))} />
            <Select size="xs" w={130} value={newCategory} onChange={(v) => v && setNewCategory(v as Category)} data={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_CONFIG[c].label }))} />
          </Group>
        </Box>
      </Group>

      <Card withBorder radius="lg" p="sm">
        <SimpleGrid cols={{ base: 2, xl: 4 }} spacing="sm">
          <Box>
            <Text size="xs" tt="uppercase" fw={700} c="dimmed">Next</Text>
            <Text size="sm" fw={700} lineClamp={1}>{nextMeeting?.summary ?? "No upcoming meetings"}</Text>
            <Text size="xs" c="dimmed">{nextMeeting ? formatRelativeMeetingStart(nextMeeting) : "Calendar clear"}</Text>
          </Box>
          <Box>
            <Text size="xs" tt="uppercase" fw={700} c="dimmed">Open</Text>
            <Text size="lg" fw={700}>{totalActionCount}</Text>
            <Text size="xs" c="dimmed">{openPersonalTasks.length} personal · {meetingOpenTasks.length + meetingDoingTasks.length + meetingBlockedTasks.length} meeting</Text>
          </Box>
          <Box>
            <Text size="xs" tt="uppercase" fw={700} c="dimmed">Doing</Text>
            <Text size="lg" fw={700}>{meetingDoingTasks.length}</Text>
            <Text size="xs" c="dimmed">Active follow-ups in progress</Text>
          </Box>
          <Box>
            <Text size="xs" tt="uppercase" fw={700} c="dimmed">Blocked</Text>
            <Text size="lg" fw={700} c={meetingBlockedTasks.length > 0 ? "red.4" : undefined}>{meetingBlockedTasks.length}</Text>
            <Text size="xs" c="dimmed">Needs follow-up or escalation</Text>
          </Box>
        </SimpleGrid>
      </Card>

      <Grid gutter="md" align="flex-start">
        <Grid.Col span={{ base: 12, xl: 8 }}>
          <Stack gap="md">
            <Card withBorder radius="lg" p="md" style={{ borderLeft: "3px solid var(--mantine-color-appdirect-6)" }}>
              <Text size="xs" fw={700} tt="uppercase" c="appdirect.5" mb={6} style={{ letterSpacing: "0.06em" }}>Focus</Text>
              <Textarea placeholder="What matters most today?" value={state.focus} onChange={(e) => setState((s) => ({ ...s, focus: e.currentTarget.value }))} size="sm" autosize minRows={2} maxRows={3} variant="unstyled" styles={{ input: { fontWeight: 500, fontSize: 14, padding: 0 } }} />
            </Card>

            <Card withBorder radius="lg" p="md">
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Text size="sm" fw={700}>Tasks</Text>
                  <Group gap="xs" wrap="wrap">
                    {pinnedToday.length > 0 && <Badge size="xs" color="appdirect" variant="light">Pinned {pinnedToday.length}</Badge>}
                    {meetingBlockedTasks.length > 0 && <Badge size="xs" color="red" variant="light">Needs attention {meetingBlockedTasks.length}</Badge>}
                    {meetingDoingTasks.length > 0 && <Badge size="xs" color="blue" variant="light">Doing {meetingDoingTasks.length}</Badge>}
                  </Group>
                </Group>

                <ScrollArea.Autosize mah={520} offsetScrollbars>
                  <Stack gap="sm">
                    {pinnedToday.length > 0 && (
                      <Stack gap="xs">
                        <Text size="xs" fw={700} tt="uppercase" c="dimmed">Pinned today</Text>
                        {pinnedToday.slice(0, 3).map((task) => (
                          <Card key={`pinned-${task.id}`} withBorder radius="md" p="sm">
                            <Group justify="space-between" wrap="nowrap" gap="sm">
                              <Box style={{ minWidth: 0, flex: 1 }}>
                                <Text size="sm" fw={600} lineClamp={1}>{task.title}</Text>
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
                            <Group justify="space-between" wrap="nowrap" gap="sm">
                              <Box style={{ minWidth: 0, flex: 1 }}>
                                <Text size="sm" fw={600} lineClamp={2}>{task.title}</Text>
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

                    {meetingDoingTasks.length > 0 && (
                      <Stack gap="xs">
                        <Text size="xs" fw={700} tt="uppercase" c="blue.4">In progress</Text>
                        {meetingDoingTasks.map((task) => (
                          <Card key={`doing-${task.id}`} withBorder radius="md" p="sm">
                            <Group justify="space-between" wrap="nowrap" gap="sm">
                              <Box style={{ minWidth: 0, flex: 1 }}>
                                <Text size="sm" fw={600} lineClamp={2}>{task.title}</Text>
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
                            <Group justify="space-between" wrap="nowrap" gap="sm">
                              <Box style={{ minWidth: 0, flex: 1 }}>
                                <Text size="sm" fw={600} lineClamp={2}>{task.title}</Text>
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

                    <Stack gap="xs">
                      <Text size="xs" fw={700} tt="uppercase" c="dimmed">Personal tasks</Text>
                      {openPersonalTasks.length === 0 ? <Text size="sm" c="dimmed">No personal tasks yet.</Text> : openPersonalTasks.map((task) => (
                        <Card key={`personal-${task.id}`} withBorder radius="md" p="sm">
                          <Group justify="space-between" wrap="nowrap" gap="sm">
                            <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                              <Checkbox checked={task.done} onChange={() => toggleTask(task.id)} size="xs" color="appdirect" radius="sm" />
                              <Box style={{ minWidth: 0, flex: 1 }}>
                                <Text size="sm" fw={500} lineClamp={2}>{task.text}</Text>
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

        <Grid.Col span={{ base: 12, xl: 4 }}>
          <Card withBorder radius="lg" p="md" style={{ position: "sticky", top: 0 }}>
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text size="sm" fw={700}>Meetings</Text>
                <Badge size="xs" variant="light" color="appdirect">{(calendar.result?.events ?? []).filter((event) => event.status !== "cancelled").length}</Badge>
              </Group>
              <Text size="xs" c="dimmed">{nextMeeting ? `${nextMeeting.summary ?? "Next meeting"} · ${formatRelativeMeetingStart(nextMeeting)}` : "No upcoming meetings today."}</Text>
              <CalendarSection {...calendar} />
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
