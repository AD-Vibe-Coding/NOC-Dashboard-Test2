/**
 * ManagerDay — personal daily planner for managers.
 * - Tasks stored in localStorage keyed by manager name + date
 * - Google Calendar integration via /api/calendar/* OAuth flow
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Loader,
  Progress,
  Select,
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
  IconCalendarEvent,
  IconCheck,
  IconClipboardList,
  IconExternalLink,
  IconFlag,
  IconFocus2,
  IconMapPin,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUnlink,
} from "@tabler/icons-react";
import { useIdentity } from "../../lib/identity";

// ── Types ────────────────────────────────────────────────────────────────────

type Priority = "high" | "medium" | "low";
type Category = "1-on-1s" | "audits" | "reports" | "team" | "admin" | "other";

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

// ── Constants ─────────────────────────────────────────────────────────────────

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

// ── Storage helpers ───────────────────────────────────────────────────────────

function todayKey(name: string) {
  return `manager-day:${name}:${new Date().toISOString().slice(0, 10)}`;
}
function loadDay(name: string): DayState {
  try {
    const raw = localStorage.getItem(todayKey(name));
    if (raw) return JSON.parse(raw) as DayState;
  } catch { /* ignore */ }
  return { focus: "", tasks: [] };
}
function saveDay(name: string, state: DayState) {
  try { localStorage.setItem(todayKey(name), JSON.stringify(state)); } catch { /* ignore */ }
}

// ── Google Calendar popup ─────────────────────────────────────────────────────

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

// ── Calendar hook ─────────────────────────────────────────────────────────────

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

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

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

// ── Calendar event helpers ────────────────────────────────────────────────────

const EVENT_COLORS: Record<string, string> = {
  "1": "blue", "2": "teal", "3": "gray", "4": "red",
  "5": "yellow", "6": "orange", "7": "cyan", "8": "dark",
  "9": "blue", "10": "green", "11": "violet",
};

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

// ── CalendarSection component ─────────────────────────────────────────────────

function CalendarSection() {
  const { result, loading, connecting, connect, disconnect, refresh } = useCalendar();

  if (loading) {
    return (
      <Group gap="xs" py="xs">
        <Loader size="xs" color="appdirect" />
        <Text size="xs" c="dimmed">Loading calendar…</Text>
      </Group>
    );
  }

  if (!result?.connected) {
    return (
      <Card withBorder radius="md" p="sm"
        style={{ borderStyle: "dashed", borderColor: "var(--mantine-color-appdirect-7)" }}>
        <Group justify="space-between" wrap="nowrap" align="center">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon size="sm" variant="light" color="appdirect" radius="sm">
              <IconCalendar size={14} />
            </ThemeIcon>
            <Box>
              <Text size="sm" fw={600}>Google Calendar</Text>
              <Text size="xs" c="dimmed">See today's meetings alongside your tasks</Text>
            </Box>
          </Group>
          <Button size="xs" variant="light" color="appdirect"
            leftSection={<IconCalendar size={13} />}
            loading={connecting} onClick={connect}>
            Connect
          </Button>
        </Group>
        {result?.error && (
          <Alert color="yellow" variant="light" icon={<IconAlertCircle size={13} />}
            radius="md" mt="xs" p="xs">
            <Text size="xs">{result.error}</Text>
          </Alert>
        )}
      </Card>
    );
  }

  const events = result.events.filter((e) => e.status !== "cancelled");

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <ThemeIcon size="sm" variant="light" color="appdirect" radius="sm">
            <IconCalendarEvent size={14} />
          </ThemeIcon>
          <Text size="sm" fw={600}>Today's Calendar</Text>
          {events.length > 0 && <Badge size="xs" variant="light" color="appdirect">{events.length}</Badge>}
        </Group>
        <Group gap={4}>
          <Tooltip label="Refresh" withArrow>
            <ActionIcon size="xs" variant="subtle" color="gray" onClick={refresh}>
              <IconRefresh size={12} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Disconnect calendar" withArrow>
            <ActionIcon size="xs" variant="subtle" color="red" onClick={disconnect}>
              <IconUnlink size={12} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {result.error && (
        <Alert color="yellow" variant="light" icon={<IconAlertCircle size={13} />} radius="md" p="xs">
          <Text size="xs">{result.error}</Text>
        </Alert>
      )}

      {events.length === 0 ? (
        <Text size="xs" c="dimmed" ta="center" py="xs">No events scheduled for today 🎉</Text>
      ) : (
        <Stack gap={6}>
          {events.map((event) => {
            const current = isNow(event);
            const past = isPast(event);
            const color = EVENT_COLORS[event.colorId ?? ""] ?? "appdirect";
            const time = formatTime(event);
            return (
              <Card key={event.id} withBorder radius="md" p="xs"
                style={{
                  opacity: past ? 0.5 : 1,
                  borderLeft: `3px solid var(--mantine-color-${current ? "green" : color}-${current ? "5" : "7"})`,
                  background: current
                    ? "color-mix(in srgb, var(--mantine-color-green-9) 15%, var(--mantine-color-body))"
                    : undefined,
                  transition: "opacity 200ms",
                }}>
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Group gap={6} wrap="nowrap">
                      {current && <Badge size="xs" color="green" variant="filled" style={{ flexShrink: 0 }}>NOW</Badge>}
                      <Text size="sm" fw={current ? 700 : 500} c={past ? "dimmed" : "bright"}
                        style={{ wordBreak: "break-word" }} lineClamp={2}>
                        {event.summary ?? "Untitled event"}
                      </Text>
                    </Group>
                    <Group gap="xs" mt={2} wrap="wrap">
                      {time && <Text size="xs" c="dimmed" ff="monospace">{time}</Text>}
                      {event.location && (
                        <Group gap={3} wrap="nowrap">
                          <IconMapPin size={10} style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }} />
                          <Text size="xs" c="dimmed" lineClamp={1}>{event.location}</Text>
                        </Group>
                      )}
                    </Group>
                  </Box>
                  {event.htmlLink && (
                    <Tooltip label="Open in Google Calendar" withArrow>
                      <ActionIcon component="a" href={event.htmlLink} target="_blank"
                        rel="noopener noreferrer" size="xs" variant="subtle" color="gray"
                        style={{ flexShrink: 0 }}>
                        <IconExternalLink size={12} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function ManagerDayWidget() {
  const { identity } = useIdentity();
  const managerName = identity?.name ?? "manager";

  const [state, setState] = useState<DayState>(() => loadDay(managerName));
  const [newText, setNewText] = useState("");
  const [newPriority, setNewPriority] = useState<Priority>("medium");
  const [newCategory, setNewCategory] = useState<Category>("other");
  const [catFilter, setCatFilter] = useState<Category | "all">("all");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { saveDay(managerName, state); }, [managerName, state]);

  function addTask() {
    const text = newText.trim();
    if (!text) return;
    const task: Task = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text, priority: newPriority, category: newCategory, done: false, createdAt: Date.now(),
    };
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

  const visibleTasks = useMemo(() => {
    const tasks = catFilter === "all" ? state.tasks : state.tasks.filter((t) => t.category === catFilter);
    return [...tasks].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const pr = (p: Priority) => p === "high" ? 0 : p === "medium" ? 1 : 2;
      return pr(a.priority) - pr(b.priority);
    });
  }, [state.tasks, catFilter]);

  const total = state.tasks.length;
  const done = state.tasks.filter((t) => t.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = identity?.name?.split(" ")[0] ?? "Manager";

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between" align="center" wrap="nowrap">
        <Box>
          <Text size="xs" c="dimmed" fw={500}>{greeting},</Text>
          <Text size="xl" fw={700} c="bright" style={{ letterSpacing: "-0.02em", lineHeight: 1.2 }}>
            {firstName}
          </Text>
          <Text size="xs" c="dimmed">
            {new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </Text>
        </Box>
        {total > 0 && (
          <Box ta="right">
            <Text size="sm" fw={700} c={pct === 100 ? "green" : "bright"}>{done}/{total} done</Text>
            <Progress value={pct} color={pct === 100 ? "green" : pct > 60 ? "teal" : "appdirect"}
              size="sm" radius="xl" w={120} mt={4} />
            {pct === 100 && <Text size="xs" c="green" fw={600} mt={2}>All done! 🎉</Text>}
          </Box>
        )}
      </Group>

      {/* Focus */}
      <Card withBorder radius="md" p="sm"
        style={{ borderLeft: "3px solid var(--mantine-color-appdirect-6)" }}>
        <Group gap="xs" mb={4}>
          <ThemeIcon size="xs" variant="transparent" color="appdirect">
            <IconFocus2 size={13} />
          </ThemeIcon>
          <Text size="xs" fw={700} tt="uppercase" c="appdirect.5" style={{ letterSpacing: "0.06em" }}>
            Today's focus
          </Text>
        </Group>
        <Textarea
          placeholder="What's your main priority for today?"
          value={state.focus}
          onChange={(e) => setState((s) => ({ ...s, focus: e.currentTarget.value }))}
          size="xs" autosize minRows={1} maxRows={3} variant="unstyled"
          styles={{ input: { fontWeight: 500, fontSize: 13 } }}
        />
      </Card>

      {/* Google Calendar */}
      <CalendarSection />

      <Divider label="Tasks" labelPosition="left" />

      {/* Add task */}
      <Card withBorder radius="md" p="sm">
        <Stack gap="xs">
          <Group gap="xs" wrap="nowrap">
            <TextInput
              ref={inputRef}
              placeholder="Add a task…"
              value={newText}
              onChange={(e) => setNewText(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              size="xs" style={{ flex: 1 }}
            />
            <Button size="xs" leftSection={<IconPlus size={13} />}
              onClick={addTask} disabled={!newText.trim()} color="appdirect">
              Add
            </Button>
          </Group>
          <Group gap="xs">
            <Select size="xs" w={110} value={newPriority}
              onChange={(v) => v && setNewPriority(v as Priority)}
              data={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_CONFIG[p].label }))}
              leftSection={<IconFlag size={12} color={`var(--mantine-color-${PRIORITY_CONFIG[newPriority].color}-5)`} />}
            />
            <Select size="xs" w={130} value={newCategory}
              onChange={(v) => v && setNewCategory(v as Category)}
              data={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_CONFIG[c].label }))}
            />
          </Group>
        </Stack>
      </Card>

      {/* Category filter */}
      {state.tasks.length > 0 && (
        <Group gap={6} wrap="wrap">
          <Badge size="xs" variant={catFilter === "all" ? "filled" : "outline"} color="appdirect"
            style={{ cursor: "pointer" }} onClick={() => setCatFilter("all")}>
            All ({state.tasks.length})
          </Badge>
          {CATEGORIES.filter((c) => state.tasks.some((t) => t.category === c)).map((c) => (
            <Badge key={c} size="xs"
              variant={catFilter === c ? "filled" : "light"}
              color={CATEGORY_CONFIG[c].color}
              style={{ cursor: "pointer" }}
              onClick={() => setCatFilter(catFilter === c ? "all" : c)}>
              {CATEGORY_CONFIG[c].label} ({state.tasks.filter((t) => t.category === c).length})
            </Badge>
          ))}
        </Group>
      )}

      {/* Task list */}
      {visibleTasks.length === 0 ? (
        <Box ta="center" py="lg">
          <ThemeIcon size={40} radius="xl" variant="light" color="gray" mx="auto">
            <IconClipboardList size={20} />
          </ThemeIcon>
          <Text size="sm" c="dimmed" mt="sm">
            {state.tasks.length === 0 ? "No tasks yet — add your first task above" : "No tasks in this category"}
          </Text>
        </Box>
      ) : (
        <Stack gap="xs">
          {visibleTasks.map((task) => (
            <Card key={task.id} withBorder radius="md" p="xs"
              style={{
                opacity: task.done ? 0.55 : 1,
                borderLeft: `3px solid var(--mantine-color-${PRIORITY_CONFIG[task.priority].color}-${task.done ? "9" : "6"})`,
                transition: "opacity 200ms",
              }}>
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                  <Checkbox checked={task.done} onChange={() => toggleTask(task.id)}
                    size="xs" color="appdirect" radius="sm" />
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Text size="sm" fw={500} c={task.done ? "dimmed" : "bright"}
                      style={{ textDecoration: task.done ? "line-through" : undefined, wordBreak: "break-word" }}>
                      {task.text}
                    </Text>
                    <Group gap={4} mt={2}>
                      <Badge size="xs" variant="dot" color={PRIORITY_CONFIG[task.priority].color}>
                        {PRIORITY_CONFIG[task.priority].label}
                      </Badge>
                      <Badge size="xs" variant="light" color={CATEGORY_CONFIG[task.category].color}>
                        {CATEGORY_CONFIG[task.category].label}
                      </Badge>
                    </Group>
                  </Box>
                </Group>
                <Group gap={4} wrap="nowrap">
                  {task.done && (
                    <ThemeIcon size="xs" variant="light" color="green" radius="sm">
                      <IconCheck size={10} />
                    </ThemeIcon>
                  )}
                  <Tooltip label="Remove task" withArrow>
                    <ActionIcon size="xs" variant="subtle" color="red" onClick={() => deleteTask(task.id)}>
                      <IconTrash size={12} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
