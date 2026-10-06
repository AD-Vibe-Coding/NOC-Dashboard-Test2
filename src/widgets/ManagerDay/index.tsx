import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  ScrollArea,
  Select,
  Stack,
  Tabs,
  Text,
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
type OwnershipTask = Awaited<ReturnType<typeof db.ownership_tasks.list>>[number];

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
function normalizePersonName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}
function samePerson(a: string | null | undefined, b: string | null | undefined) {
  return normalizePersonName(a) === normalizePersonName(b);
}
function formatDueDate(value?: string | null) {
  if (!value) return "No due date";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function meetingTaskSource(task: MeetingTask) {
  return task.details || task.section_name || task.notebook_group || "Meeting notes";
}
function ownershipTaskSource(task: OwnershipTask) {
  return task.details || task.source_shift || "Work allotment";
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
  const { identity } = useIdentity();

  if (loading) {
    return <Group gap="xs"><Loader size="xs" /><Text size="xs" c="dimmed">Loading calendar…</Text></Group>;
  }
  if (!result?.connected) {
    const requiresReauth = String(result?.error ?? "").toLowerCase().includes("sign out and sign in again");
    const description = identity
      ? (requiresReauth
        ? "Your existing Google sign-in needs one re-auth to include Calendar access."
        : "Your Google sign-in will be used to show today’s meetings.")
      : "Sign in with Google to show today’s meetings.";
    const buttonLabel = requiresReauth ? "Re-authorize" : "Connect";

    return (
      <Card withBorder radius="md" p="sm" style={{ borderStyle: "dashed" }}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon size="sm" variant="light" color="appdirect"><IconCalendar size={14} /></ThemeIcon>
            <Box>
              <Text size="sm" fw={600}>Google Calendar</Text>
              <Text size="xs" c="dimmed">{description}</Text>
            </Box>
          </Group>
          <Button size="xs" variant="light" color="appdirect" loading={connecting} onClick={connect}>{buttonLabel}</Button>
        </Group>
        {result?.error && <Alert mt="sm" p="xs" radius="md" color="yellow" icon={<IconAlertCircle size={14} />}><Text size="xs">{result.error}</Text></Alert>}
      </Card>
    );
  }
  const events = result.events.filter((e) => e.status !== "cancelled" && !isPast(e));
  return (
    <Stack gap={4}>
      <Group justify="space-between" align="center" gap={4}>
        <Text size="xs" fw={700} style={{ lineHeight: 1.05 }}>Today’s meetings</Text>
        <Group gap={1}>
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
        <ScrollArea.Autosize mah={356} offsetScrollbars>
          <Stack gap={4}>
            {events.map((event) => {
              const current = isNow(event);
              const past = isPast(event);
              const state = current ? { label: "now", color: "green" } : isSoon(event) ? { label: "soon", color: "yellow" } : past ? { label: "done", color: "gray" } : { label: "later", color: "blue" };
              const color = EVENT_COLORS[event.colorId ?? ""] ?? "appdirect";
              return (
                <Card key={event.id} withBorder radius="md" p={6} style={{ opacity: past ? 0.55 : 1, borderLeft: `3px solid var(--mantine-color-${current ? "green" : color}-${current ? "5" : "7"})` }}>
                  <Group justify="space-between" wrap="nowrap" gap={6} align="flex-start">
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Group gap={4} wrap="nowrap" align="flex-start">
                        <Badge size="xs" px={5} color={state.color} variant={current ? "filled" : "light"}>{state.label}</Badge>
                        <Text size="xs" fw={current ? 700 : 500} lineClamp={2} style={{ lineHeight: 1.1 }}>{event.summary ?? "Untitled event"}</Text>
                      </Group>
                      <Group gap={6} mt={2} wrap="wrap">
                        <Text size="10px" c="dimmed" ff="monospace" style={{ lineHeight: 1.05 }}>{formatTime(event)}</Text>
                        {event.location ? <Group gap={3} wrap="nowrap" align="flex-start"><IconMapPin size={9} style={{ flexShrink: 0, marginTop: 1 }} /><Text size="10px" c="dimmed" lineClamp={1} style={{ whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.05 }}>{event.location}</Text></Group> : null}
                      </Group>
                    </Box>
                    {(event.joinLink ?? event.htmlLink) ? (
                      <Button
                        component="a"
                        href={event.joinLink ?? event.htmlLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        size="compact-xs"
                        px={8}
                        variant="light"
                        color={current ? "green" : "appdirect"}
                        rightSection={<IconExternalLink size={11} />}
                        style={{ flexShrink: 0, marginTop: 1 }}
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
  const [ownershipTasks, setOwnershipTasks] = useState<OwnershipTask[]>([]);
  const [managerOwnershipTasks, setManagerOwnershipTasks] = useState<OwnershipTask[]>([]);
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
      setOwnershipTasks([]);
      setManagerOwnershipTasks([]);
      return;
    }
    try {
      const requests = [
        db.personal_action_items.list({ orderBy: { column: "created_at", ascending: false } }),
        fetch("/api/my/ownership-tasks", { credentials: "include" }),
        identity.role === "manager"
          ? fetch("/api/manager/ownership-tasks", { credentials: "include" })
          : Promise.resolve(null),
      ] as const;
      const [meetingRows, ownershipResponse, managerOwnershipResponse] = await Promise.all(requests);
      const ownershipRows = ownershipResponse.ok
        ? (await ownershipResponse.json() as OwnershipTask[])
        : [];
      const managerOwnershipRows = managerOwnershipResponse && managerOwnershipResponse.ok
        ? (await managerOwnershipResponse.json() as OwnershipTask[])
        : [];
      setMeetingTasks(meetingRows.filter((task) => !!task.note_id && (samePerson(task.owner_name, identity.name) || samePerson(task.employee_name, identity.name))));
      setOwnershipTasks(ownershipRows);
      setManagerOwnershipTasks(managerOwnershipRows);
    } catch {
      setMeetingTasks([]);
      setOwnershipTasks([]);
      setManagerOwnershipTasks([]);
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
  async function completeOwnershipTask(task: OwnershipTask) {
    setOwnershipTasks((prev) => prev.filter((item) => item.id !== task.id));
    try {
      await db.ownership_tasks.updateById(task.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
        next_reminder_at: null,
        last_error: "",
      });
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
  const openOwnershipTasks = useMemo(() => ownershipTasks.filter((task) => String(task.status ?? "") !== "completed"), [ownershipTasks]);
  const completedOwnershipTasks = useMemo(() => ownershipTasks.filter((task) => String(task.status ?? "") === "completed"), [ownershipTasks]);
  const managerOpenOwnershipTasks = useMemo(() => managerOwnershipTasks.filter((task) => String(task.status ?? "") !== "completed"), [managerOwnershipTasks]);
  const managerCompletedOwnershipTasks = useMemo(() => managerOwnershipTasks.filter((task) => String(task.status ?? "") === "completed"), [managerOwnershipTasks]);
  const managerReminderTotal = useMemo(() => managerOwnershipTasks.reduce((sum, task) => sum + (Number(task.reminder_count) || 0), 0), [managerOwnershipTasks]);
  const pinnedToday = useMemo(() => meetingTasks.filter((task) => plannedMeetingTaskIds.includes(task.id) && task.status !== "done"), [meetingTasks, plannedMeetingTaskIds]);
  const isManager = identity?.role === "manager";
  const todayMeetings = (calendar.result?.events ?? []).filter((event) => event.status !== "cancelled" && isTodayLocal(event));
  const openPersonalTasks = personalTasks.filter((task) => !task.done);
  const totalActionCount = openPersonalTasks.length + openOwnershipTasks.length + meetingOpenTasks.length + meetingDoingTasks.length + meetingBlockedTasks.length;

  return (
    <Stack gap="sm">
      <Card
        withBorder
        radius="xl"
        p="sm"
        style={{
          background: "linear-gradient(180deg, color-mix(in srgb, var(--mantine-color-appdirect-9) 10%, var(--mantine-color-body)) 0%, var(--mantine-color-body) 100%)",
          borderColor: "color-mix(in srgb, var(--mantine-color-appdirect-6) 22%, transparent)",
          boxShadow: "0 10px 24px rgba(0,0,0,0.12)",
        }}
      >
        <Stack gap={8}>
          <Group justify="space-between" align="flex-start" wrap="wrap" gap={8}>
            <Box>
              <Text size="10px" fw={800} tt="uppercase" c="appdirect.4" style={{ letterSpacing: "0.12em", lineHeight: 1.1 }}>
                Daily command center
              </Text>
              <Text size="lg" fw={800} style={{ letterSpacing: "-0.02em", lineHeight: 1 }}>
                My Day
              </Text>
              <Text size="xs" c="dimmed" style={{ lineHeight: 1.1 }}>
                {new Date().toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
              </Text>
            </Box>
            <Group gap={6} wrap="wrap">
              <Badge size="sm" variant="light" color="appdirect">{totalActionCount} active</Badge>
              {meetingBlockedTasks.length > 0 ? <Badge size="sm" variant="light" color="red">{meetingBlockedTasks.length} blocked</Badge> : null}
              {todayMeetings.length > 0 ? <Badge size="sm" variant="light" color="teal">{todayMeetings.length} meetings</Badge> : null}
            </Group>
          </Group>

          <Group gap={6} align="flex-start" wrap="nowrap">
            <TextInput
              ref={inputRef}
              placeholder="Quick add a task..."
              value={newText}
              onChange={(e) => setNewText(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              size="xs"
              radius="md"
              style={{ flex: 1, minWidth: 0 }}
            />
            {isManager && (
              <>
                <Select size="xs" radius="md" w={98} value={newPriority} onChange={(v) => v && setNewPriority(v as Priority)} data={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_CONFIG[p].label }))} />
                <Select size="xs" radius="md" w={112} value={newCategory} onChange={(v) => v && setNewCategory(v as Category)} data={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_CONFIG[c].label }))} />
              </>
            )}
            <Button size="xs" radius="md" px="sm" onClick={addTask} disabled={!newText.trim()} color="appdirect">Add</Button>
          </Group>
        </Stack>
      </Card>

      <Card withBorder radius="xl" p={10} style={{ boxShadow: "0 10px 24px rgba(0,0,0,0.08)" }}>
        <Tabs defaultValue="tasks" variant="pills" radius="md">
          <Tabs.List grow mb="sm">
            <Tabs.Tab value="tasks">
              <Group gap={6} wrap="nowrap" justify="center">
                <Text size="sm" fw={700}>{isManager ? "Action list" : "My tasks"}</Text>
                <Badge size="xs" variant="light" color="appdirect">{totalActionCount}</Badge>
              </Group>
            </Tabs.Tab>
            <Tabs.Tab value="meetings">
              <Group gap={6} wrap="nowrap" justify="center">
                <Text size="sm" fw={700}>Meetings</Text>
                <Badge size="xs" variant="light" color="teal">{todayMeetings.length}</Badge>
              </Group>
            </Tabs.Tab>
            {isManager ? (
              <Tabs.Tab value="handoffs">
                <Group gap={6} wrap="nowrap" justify="center">
                  <Text size="sm" fw={700}>Handoffs</Text>
                  <Badge size="xs" variant="light" color="orange">{managerOwnershipTasks.length}</Badge>
                </Group>
              </Tabs.Tab>
            ) : null}
          </Tabs.List>

          <Tabs.Panel value="tasks">
            <Stack gap={8}>
              <Group justify="space-between" align="center" wrap="wrap" gap={6}>
                <Box>
                  <Text size="10px" fw={800} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.12em", lineHeight: 1.1 }}>
                    To do
                  </Text>
                  <Text size="md" fw={800} style={{ letterSpacing: "-0.02em", lineHeight: 1 }}>
                    {isManager ? "Action list" : "My tasks"}
                  </Text>
                </Box>
                <Group gap={6} wrap="wrap">
                  {openOwnershipTasks.length > 0 && <Badge size="xs" color="orange" variant="light">Ownership {openOwnershipTasks.length}</Badge>}
                  {completedOwnershipTasks.length > 0 && <Badge size="xs" color="green" variant="light">Completed ownership {completedOwnershipTasks.length}</Badge>}
                  {isManager && pinnedToday.length > 0 && <Badge size="xs" color="appdirect" variant="light">Pinned {pinnedToday.length}</Badge>}
                  {meetingDoingTasks.length > 0 && <Badge size="xs" color="blue" variant="light">Doing {meetingDoingTasks.length}</Badge>}
                </Group>
              </Group>

              <ScrollArea.Autosize mah={420} offsetScrollbars>
                <Stack gap={6}>
                  {openOwnershipTasks.map((task) => (
                    <Card key={`ownership-${task.id}`} withBorder radius="lg" p={8} style={{ borderColor: "color-mix(in srgb, var(--mantine-color-orange-6) 24%, transparent)" }}>
                      <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
                        <Box style={{ minWidth: 0, flex: 1 }}>
                          <Group gap={6} mb={4} wrap="wrap">
                            <Badge size="xs" variant="light" color="orange">Ownership</Badge>
                            {task.source_shift ? <Badge size="xs" variant="dot" color="indigo">{task.source_shift}</Badge> : null}
                            {task.reminder_count ? <Badge size="xs" variant="light" color="red">Reminders {task.reminder_count}</Badge> : null}
                          </Group>
                          <Text size="sm" fw={700} style={{ whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.25 }}>{task.title}</Text>
                          <Text size="11px" c="dimmed" style={{ lineHeight: 1.15 }}>{ownershipTaskSource(task)} · {task.last_reminded_at ? `Last reminded ${formatDueDate(task.last_reminded_at)}` : "Reminder active until completed"}</Text>
                        </Box>
                        <Button size="compact-xs" radius="md" variant="light" color="green" onClick={() => void completeOwnershipTask(task)}>Completed</Button>
                      </Group>
                    </Card>
                  ))}

                  {completedOwnershipTasks.map((task) => (
                    <Card key={`ownership-completed-${task.id}`} withBorder radius="lg" p={8} style={{ opacity: 0.78, borderColor: "color-mix(in srgb, var(--mantine-color-green-6) 20%, transparent)" }}>
                      <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
                        <Box style={{ minWidth: 0, flex: 1 }}>
                          <Group gap={6} mb={4} wrap="wrap">
                            <Badge size="xs" variant="light" color="green">Ownership</Badge>
                            <Badge size="xs" variant="light" color="teal">Completed</Badge>
                            {task.source_shift ? <Badge size="xs" variant="dot" color="indigo">{task.source_shift}</Badge> : null}
                          </Group>
                          <Text size="sm" fw={700} style={{ whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.25 }}>{task.title}</Text>
                          <Text size="11px" c="dimmed" style={{ lineHeight: 1.15 }}>{ownershipTaskSource(task)} · {task.completed_at ? `Completed ${formatDueDate(task.completed_at)}` : "Completed today"}</Text>
                        </Box>
                      </Group>
                    </Card>
                  ))}

                  {pinnedToday.slice(0, 3).map((task) => (
                    <Card key={`pinned-${task.id}`} withBorder radius="lg" p={8} style={{ background: "color-mix(in srgb, var(--mantine-color-appdirect-9) 8%, var(--mantine-color-body))" }}>
                      <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
                        <Box style={{ minWidth: 0, flex: 1 }}>
                          <Group gap={6} mb={4} wrap="wrap">
                            <Badge size="xs" variant="light" color="appdirect">Pinned</Badge>
                            <Badge size="xs" variant="dot" color="grape">Meeting</Badge>
                          </Group>
                          <Text size="sm" fw={700} style={{ whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.25 }}>{task.title}</Text>
                          <Text size="11px" c="dimmed" style={{ lineHeight: 1.15 }}>{meetingTaskSource(task)} · {formatDueDate(task.due_date)}</Text>
                        </Box>
                        <Group gap={6} wrap="nowrap">
                          <ActionIcon size="sm" radius="md" variant="subtle" color="red" onClick={() => removeMeetingTaskFromPlan(task.id)}><IconTrash size={13} /></ActionIcon>
                          <Button size="compact-xs" radius="md" variant="light" color="green" onClick={() => void updateMeetingTaskStatus(task, "done")}>Done</Button>
                        </Group>
                      </Group>
                    </Card>
                  ))}

                  {meetingBlockedTasks.map((task) => (
                    <Card key={`blocked-${task.id}`} withBorder radius="lg" p={8} style={{ borderColor: "color-mix(in srgb, var(--mantine-color-red-6) 24%, transparent)" }}>
                      <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
                        <Box style={{ minWidth: 0, flex: 1 }}>
                          <Group gap={6} mb={4} wrap="wrap">
                            <Badge size="xs" variant="light" color="red">Blocked</Badge>
                            <Badge size="xs" variant="dot" color="grape">Meeting</Badge>
                          </Group>
                          <Text size="sm" fw={700} style={{ whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.25 }}>{task.title}</Text>
                          <Text size="11px" c="dimmed" style={{ lineHeight: 1.15 }}>{meetingTaskSource(task)} · {formatDueDate(task.due_date)}</Text>
                        </Box>
                        <Group gap={6} wrap="nowrap">
                          <Button size="compact-xs" radius="md" variant="light" color="blue" onClick={() => void updateMeetingTaskStatus(task, "in_progress")}>Start</Button>
                          <Button size="compact-xs" radius="md" variant="light" color="green" onClick={() => void updateMeetingTaskStatus(task, "done")}>Done</Button>
                        </Group>
                      </Group>
                    </Card>
                  ))}

                  {(isManager ? meetingDoingTasks : [...meetingDoingTasks, ...meetingOpenTasks].filter((task, index, arr) => arr.findIndex((item) => item.id === task.id) === index)).map((task) => (
                    <Card key={`doing-${task.id}`} withBorder radius="lg" p={8}>
                      <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
                        <Box style={{ minWidth: 0, flex: 1 }}>
                          <Group gap={6} mb={4} wrap="wrap">
                            <Badge size="xs" variant="light" color="blue">In progress</Badge>
                            <Badge size="xs" variant="dot" color="grape">Meeting</Badge>
                          </Group>
                          <Text size="sm" fw={700} style={{ whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.25 }}>{task.title}</Text>
                          <Text size="11px" c="dimmed" style={{ lineHeight: 1.15 }}>{meetingTaskSource(task)} · {formatDueDate(task.due_date)}</Text>
                        </Box>
                        <Button size="compact-xs" radius="md" variant="light" color="green" onClick={() => void updateMeetingTaskStatus(task, "done")}>Done</Button>
                      </Group>
                    </Card>
                  ))}

                  {(isManager ? meetingOpenTasks.slice(0, 6) : []).map((task) => (
                    <Card key={`meeting-${task.id}`} withBorder radius="lg" p={8}>
                      <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
                        <Box style={{ minWidth: 0, flex: 1 }}>
                          <Group gap={6} mb={4} wrap="wrap">
                            <Badge size="xs" variant="light" color="gray">Open</Badge>
                            <Badge size="xs" variant="dot" color="grape">Meeting</Badge>
                          </Group>
                          <Text size="sm" fw={700} style={{ whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.25 }}>{task.title}</Text>
                          <Text size="11px" c="dimmed" style={{ lineHeight: 1.15 }}>{meetingTaskSource(task)} · {formatDueDate(task.due_date)}</Text>
                        </Box>
                        <Group gap={6} wrap="nowrap">
                          <Button size="compact-xs" radius="md" variant="subtle" color="appdirect" onClick={() => addMeetingTaskToPlan(task)} disabled={plannedMeetingTaskIds.includes(task.id)}>{plannedMeetingTaskIds.includes(task.id) ? "Pinned" : "Pin"}</Button>
                          <Button size="compact-xs" radius="md" variant="light" color="blue" onClick={() => void updateMeetingTaskStatus(task, "in_progress")}>Start</Button>
                        </Group>
                      </Group>
                    </Card>
                  ))}

                  {(isManager ? openPersonalTasks : openPersonalTasks.slice(0, 4)).map((task) => (
                    <Card key={`personal-${task.id}`} withBorder radius="lg" p={8}>
                      <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
                        <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                          <Checkbox checked={task.done} onChange={() => toggleTask(task.id)} size="xs" color="appdirect" radius="sm" />
                          <Box style={{ minWidth: 0, flex: 1 }}>
                            <Group gap={6} mb={4} wrap="wrap">
                              <Badge size="xs" variant="light" color={PRIORITY_CONFIG[task.priority].color}>{PRIORITY_CONFIG[task.priority].label}</Badge>
                              <Badge size="xs" variant="dot" color={CATEGORY_CONFIG[task.category].color}>{CATEGORY_CONFIG[task.category].label}</Badge>
                            </Group>
                            <Text size="sm" fw={600} style={{ whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.25 }}>{task.text}</Text>
                          </Box>
                        </Group>
                        <ActionIcon size="xs" radius="md" variant="subtle" color="red" onClick={() => deleteTask(task.id)}><IconTrash size={12} /></ActionIcon>
                      </Group>
                    </Card>
                  ))}

                  {openOwnershipTasks.length === 0 && pinnedToday.length === 0 && meetingBlockedTasks.length === 0 && meetingDoingTasks.length === 0 && meetingOpenTasks.length === 0 && openPersonalTasks.length === 0 ? (
                    <Text size="sm" c="dimmed">No action items right now.</Text>
                  ) : null}
                </Stack>
              </ScrollArea.Autosize>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="meetings">
            <Stack gap={8}>
              <Box>
                <Text size="10px" fw={800} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.12em", lineHeight: 1.1 }}>Meetings</Text>
                <Text size="md" fw={800} style={{ letterSpacing: "-0.02em", lineHeight: 1 }}>Today’s meetings</Text>
              </Box>
              <CalendarSection {...calendar} />
            </Stack>
          </Tabs.Panel>

          {isManager ? (
            <Tabs.Panel value="handoffs">
              <Stack gap={8}>
                <Group justify="space-between" align="center" wrap="wrap" gap={6}>
                  <Box>
                    <Text size="10px" fw={800} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.12em", lineHeight: 1.1 }}>Ownership audit</Text>
                    <Text size="md" fw={800} style={{ letterSpacing: "-0.02em", lineHeight: 1 }}>Today’s handoff tasks</Text>
                  </Box>
                  <Group gap={6} wrap="wrap">
                    <Badge size="xs" color="orange" variant="light">Open {managerOpenOwnershipTasks.length}</Badge>
                    <Badge size="xs" color="green" variant="light">Completed {managerCompletedOwnershipTasks.length}</Badge>
                    <Badge size="xs" color="red" variant="light">Bot reminders {managerReminderTotal}</Badge>
                  </Group>
                </Group>

                {managerOwnershipTasks.length === 0 ? (
                  <Card withBorder radius="lg" p="md" style={{ borderStyle: "dashed" }}>
                    <Text size="sm" fw={700}>No handoff tasks for today</Text>
                    <Text size="xs" c="dimmed">Once work allotment ownership tasks are generated, they’ll appear here with assignee, status, shift coverage, and reminder totals.</Text>
                  </Card>
                ) : (
                  <ScrollArea.Autosize mah={420} offsetScrollbars>
                    <Stack gap={6}>
                      {managerOwnershipTasks.map((task) => {
                        const completed = String(task.status ?? "") === "completed";
                        const reminderCount = Number(task.reminder_count) || 0;
                        return (
                          <Card
                            key={`manager-handoff-${task.id}`}
                            withBorder
                            radius="lg"
                            p={8}
                            style={{
                              opacity: completed ? 0.78 : 1,
                              borderColor: completed
                                ? "color-mix(in srgb, var(--mantine-color-green-6) 20%, transparent)"
                                : "color-mix(in srgb, var(--mantine-color-orange-6) 24%, transparent)",
                            }}
                          >
                            <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                              <Box style={{ minWidth: 0, flex: 1 }}>
                                <Group gap={6} mb={4} wrap="wrap">
                                  <Badge size="xs" variant="light" color={completed ? "green" : "orange"}>{completed ? "Completed" : "Open"}</Badge>
                                  <Badge size="xs" variant="light" color="blue">{task.assignee_name}</Badge>
                                  {task.source_shift ? <Badge size="xs" variant="dot" color="indigo">{task.source_shift}</Badge> : null}
                                  <Badge size="xs" variant="light" color={reminderCount > 0 ? "red" : "gray"}>Reminders {reminderCount}</Badge>
                                </Group>
                                <Text size="sm" fw={700} style={{ whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.25 }}>{task.title}</Text>
                                <Text size="11px" c="dimmed" style={{ lineHeight: 1.15 }}>
                                  {ownershipTaskSource(task)} · {completed
                                    ? (task.completed_at ? `Completed ${formatDueDate(task.completed_at)}` : "Completed today")
                                    : (task.last_reminded_at ? `Last reminded ${formatDueDate(task.last_reminded_at)}` : "No reminders sent yet")}
                                </Text>
                              </Box>
                            </Group>
                          </Card>
                        );
                      })}
                    </Stack>
                  </ScrollArea.Autosize>
                )}
              </Stack>
            </Tabs.Panel>
          ) : null}
        </Tabs>
      </Card>
    </Stack>
  );
}
