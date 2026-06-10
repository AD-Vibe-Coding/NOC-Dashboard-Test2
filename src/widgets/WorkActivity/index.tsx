import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Anchor,
  Autocomplete,
  Badge,
  Box,
  Button,
  Card,
  Grid,
  Group,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconActivity,
  IconBolt,
  IconCalendarEvent,
  IconCheck,
  IconChecklist,
  IconCopy,
  IconPhone,
  IconPhoneCall,
  IconUser,
} from "@tabler/icons-react";
import { useIdentity } from "../../lib/identity";
import { db } from "../../db";
import { NOC_ROSTER } from "../../lib/roster";
import {
  buildMyDayMetrics,
  findUserActivity,
  type MyDayMetrics,
} from "../../lib/work-activity";
import { WidgetFrame } from "../WidgetFrame";
import { useWorkActivity } from "./data";
import { postSlackMessage } from "../../lib/slack";

type PersonalActionItem = Awaited<ReturnType<typeof db.personal_action_items.list>>[number];

const TASK_STATUS_OPTIONS = [
  { value: "open", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
];

const TASK_PROGRESS_OPTIONS = [
  { value: "0", label: "0%" },
  { value: "25", label: "25%" },
  { value: "50", label: "50%" },
  { value: "75", label: "75%" },
  { value: "100", label: "100%" },
];

const MEETING_REMINDER_STORAGE_KEY = "my-day-meeting-reminders-v1";
const MEETING_REMINDER_STEPS_MINUTES = [30, 15, 5] as const;
const SLACK_USER_BY_CANONICAL_MEMBER: Record<string, string> = {
  "abhishek benarji": "U09PWVD4BU6",
  "akash hanvate": "U09PVHEKRGV",
  "anirudh kukudala": "U09Q2HK9HJQ",
  "mohammed ashraf": "U09PX02N8MU",
  "hamza rahmani": "U09PZ1RCZGS",
  "karthik damagalla": "U09PSJVFJF5",
  "karthik radhakrishnan": "U09QBTS7F8R",
  "kenya gentry": "U09J2RJUBMF",
  "lokesh naik banavath": "U09PVHC696H",
  "akram ahmed": "U09PVH91ESZ",
  "otukho olembo": "U09J2RFJBUZ",
  "perry cox": "U09J2RL9X1P",
  "pranav dandibhotla": "U09PX009L22",
  "mahalakshmi samiti": "U09QBU1R4KB",
  "sriram parisa": "U09QT9ZS5EC",
  "mohammed zubairuddin": "U09PZ1M7QM8",
};

const SLACK_NAME_ALIASES: Record<string, string> = {
  "abishek benarji": "abhishek benarji",
  "abhishek benarji - ab": "abhishek benarji",
  "ashraf mohammed": "mohammed ashraf",
  "hamza rahmani umme": "hamza rahmani",
  "lokesh banavath": "lokesh naik banavath",
  "mohammed akram ahmed": "akram ahmed",
  "samiti mahalakshmi": "mahalakshmi samiti",
  "zubair mohammed": "mohammed zubairuddin",
};

function normalizeMemberName(name: string) {
  return name
    .toLowerCase()
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\s*[-|:]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slackUserIdFor(name: string) {
  const normalized = normalizeMemberName(name);
  const aliased = SLACK_NAME_ALIASES[normalized] ?? normalized;
  return SLACK_USER_BY_CANONICAL_MEMBER[aliased] ?? null;
}

function readMeetingReminderState(): Record<string, { sentSteps: number[] }> {
  try {
    return JSON.parse(window.localStorage.getItem(MEETING_REMINDER_STORAGE_KEY) ?? "{}") as Record<string, { sentSteps: number[] }>;
  } catch {
    return {};
  }
}

function writeMeetingReminderState(state: Record<string, { sentSteps: number[] }>) {
  window.localStorage.setItem(MEETING_REMINDER_STORAGE_KEY, JSON.stringify(state));
}

type CalendarEvent = {
  id: string;
  summary?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
  status?: string;
  htmlLink?: string;
  hangoutLink?: string;
  description?: string;
  conferenceData?: {
    conferenceSolution?: { name?: string };
    entryPoints?: Array<{
      entryPointType?: string;
      uri?: string;
      label?: string;
    }>;
  };
  colorId?: string;
};

function extractMeetingLinks(event: CalendarEvent) {
  const conferenceUris = (event.conferenceData?.entryPoints ?? [])
    .map((entry: { uri?: string }) => entry.uri)
    .filter((value: string | undefined): value is string => Boolean(value));

  const text = [
    event.hangoutLink,
    ...conferenceUris,
    event.location,
    event.description,
    event.htmlLink,
  ].filter(Boolean).join("\n");

  const rawMatches = text.match(/(?:https?:\/\/)?(?:meet\.google\.com\/[\w-]+|[\w.-]+\.zoom(?:gov)?\.com\/\S+|teams\.microsoft\.com\/\S+|teams\.live\.com\/\S+|https?:\/\/\S+)/gi) ?? [];
  const cleaned = Array.from(
    new Set(
      rawMatches
        .map((value) => value.trim().replace(/[)>.,]+$/g, ""))
        .map((value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`))
        .filter((url) => !/google\.com\/calendar\/event|calendar\.google\.com/i.test(url)),
    ),
  );

  const meetLinks = cleaned.filter((url) => /meet\.google\.com/i.test(url));
  const zoomLinks = cleaned.filter((url) => /zoom\.us|zoomgov\.com/i.test(url));
  const teamsLinks = cleaned.filter((url) => /teams\.microsoft\.com|teams\.live\.com/i.test(url));
  const otherLinks = cleaned.filter((url) => !/zoom\.us|zoomgov\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com/i.test(url));

  const ranked = [...meetLinks, ...zoomLinks, ...teamsLinks, ...otherLinks];
  const primary = ranked[0] ?? null;
  const provider = primary
    ? /meet\.google\.com/i.test(primary)
      ? "Google Meet"
      : /zoom\.us|zoomgov\.com/i.test(primary)
        ? "Zoom"
        : /teams\.microsoft\.com|teams\.live\.com/i.test(primary)
          ? "Teams"
          : event.conferenceData?.conferenceSolution?.name || "Meeting link"
    : null;

  return { primary, provider };
}

function getMeetingTimingState(event: CalendarEvent) {
  if (!event.start?.dateTime || !event.end?.dateTime) {
    return {
      canJoin: false,
      tone: "gray" as const,
      statusLabel: "scheduled",
      timingText: "Time unavailable",
    };
  }

  const start = new Date(event.start.dateTime).getTime();
  const end = new Date(event.end.dateTime).getTime();
  const now = Date.now();
  const earlyWindowMs = 10 * 60 * 1000;
  const lateWindowMs = 15 * 60 * 1000;
  const canJoin = now >= start - earlyWindowMs && now <= end + lateWindowMs;

  if (now > end) {
    return {
      canJoin: false,
      tone: "green" as const,
      statusLabel: "attended",
      timingText: "Completed",
    };
  }

  const minutesUntilStart = Math.max(0, Math.round((start - now) / 60000));

  if (canJoin) {
    return {
      canJoin: true,
      tone: "green" as const,
      statusLabel: "active",
      timingText: now < start ? `Starting in ${minutesUntilStart} min` : "In progress",
    };
  }

  if (minutesUntilStart <= 30) {
    return {
      canJoin: false,
      tone: "yellow" as const,
      statusLabel: "soon",
      timingText: `Starting in ${minutesUntilStart} min`,
    };
  }

  return {
    canJoin: false,
    tone: "blue" as const,
    statusLabel: "later",
    timingText: `Starting in ${minutesUntilStart} min`,
  };
}

function openCalendarPopup(): Promise<boolean> {
  return new Promise((resolve) => {
    const w = 520;
    const h = 640;
    const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
    const top = Math.round(window.screenY + (window.outerHeight - h) / 2);
    const popup = window.open(
      "/api/calendar/start",
      "gcal_oauth",
      `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no`,
    );
    if (!popup) {
      resolve(false);
      return;
    }
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "gcal-oauth-success") {
        cleanup();
        resolve(true);
      } else if (e.data?.type === "gcal-oauth-error") {
        cleanup();
        resolve(false);
      }
    }
    function cleanup() {
      window.removeEventListener("message", onMessage);
      clearInterval(poll);
    }
    window.addEventListener("message", onMessage);
    const poll = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        resolve(false);
      }
    }, 500);
  });
}

export { WorkActivityTile } from "./Tile";

export function WorkActivityWidget() {
  const { slack, calls, loading, refresh } = useWorkActivity();
  const { identity } = useIdentity();

  const [selected, setSelected] = useState<string>("");
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarConnecting, setCalendarConnecting] = useState(false);
  const [actionItems, setActionItems] = useState<PersonalActionItem[]>([]);
  const [actionItemsLoading, setActionItemsLoading] = useState(false);
  // Effective user = explicit selection > stored identity > first ranked user
  const effectiveUser = useMemo(() => {
    if (selected) return selected;
    if (identity?.name) return identity.name;
    return "";
  }, [selected, identity]);

  // Fuzzy-resolve to the actual key in the slack response (handles casing)
  const resolved = useMemo(() => {
    if (!effectiveUser) return null;
    return findUserActivity(effectiveUser, slack).matched ?? effectiveUser;
  }, [effectiveUser, slack]);

  const myMetrics: MyDayMetrics | null = useMemo(() => {
    if (!resolved) return null;
    return buildMyDayMetrics(resolved, slack, calls);
  }, [resolved, slack, calls]);

  useEffect(() => {
    let cancelled = false;
    const loadCalendar = async () => {
      try {
        const response = await fetch("/api/calendar/events", { credentials: "include" });
        const payload = await response.json();
        if (cancelled) return;
        setCalendarConnected(Boolean(payload?.connected));
        setCalendarEvents(Array.isArray(payload?.events) ? (payload.events as CalendarEvent[]) : []);
        setCalendarError(payload?.error ? String(payload.error) : null);
      } catch (err) {
        if (cancelled) return;
        setCalendarConnected(false);
        setCalendarEvents([]);
        setCalendarError(err instanceof Error ? err.message : String(err));
      }
    };
    void loadCalendar();
    return () => {
      cancelled = true;
    };
  }, []);

  const connectCalendar = async () => {
    setCalendarConnecting(true);
    try {
      const ok = await openCalendarPopup();
      if (!ok) return;
      const response = await fetch("/api/calendar/events", { credentials: "include" });
      const payload = await response.json();
      setCalendarConnected(Boolean(payload?.connected));
      setCalendarEvents(Array.isArray(payload?.events) ? (payload.events as CalendarEvent[]) : []);
      setCalendarError(payload?.error ? String(payload.error) : null);
    } catch {
      setCalendarError("Could not connect Google Calendar.");
    } finally {
      setCalendarConnecting(false);
    }
  };

  useEffect(() => {
    if (!identity?.name || !calendarConnected || calendarEvents.length === 0) return;

    let cancelled = false;

    const runReminderCheck = async () => {
      if (cancelled) return;

      const targetUserId = slackUserIdFor(identity.name);
      if (!targetUserId) return;

      const todayKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

      const nextState = readMeetingReminderState();
      const trackedKeys = new Set<string>();

      let reminderRows: Array<{ dedupe_key: string; sent_at: string }> = [];
      try {
        reminderRows = await db.reminder_events.list({
          orderBy: { column: "created_at", ascending: false },
          limit: 200,
        }) as Array<{ dedupe_key: string; sent_at: string }>;
      } catch {
        reminderRows = [];
      }

      const sentReminderKeys = new Set(
        reminderRows
          .filter((row) => {
            const pacificDate = new Intl.DateTimeFormat("en-CA", {
              timeZone: "America/Los_Angeles",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date(row.sent_at));
            return pacificDate === todayKey;
          })
          .map((row) => row.dedupe_key),
      );

      for (const event of calendarEvents) {
        if (!event.start?.dateTime || event.status === "cancelled") continue;
        const eventKey = `${normalizeMemberName(identity.name)}:${event.id}:${event.start.dateTime}`;
        trackedKeys.add(eventKey);
        const entry = nextState[eventKey] ?? { sentSteps: [] };
        const startMs = new Date(event.start.dateTime).getTime();
        const diffMinutes = Math.round((startMs - Date.now()) / 60000);
        const { primary: joinHref } = extractMeetingLinks(event);
        const timeLabel = new Date(startMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

        for (const step of MEETING_REMINDER_STEPS_MINUTES) {
          const dedupeKey = `meeting:${todayKey}:${normalizeMemberName(identity.name)}:${event.id}:${step}`;
          if (entry.sentSteps.includes(step) || sentReminderKeys.has(dedupeKey)) continue;
          if (diffMinutes < step - 1 || diffMinutes > step + 1) continue;

          const reminderLabel = step === 5 ? "Join now" : `${step}-minute reminder`;
          const text = `${step === 5 ? ":rotating_light:" : ":spiral_calendar_pad:"} ${reminderLabel} for *${event.summary || "Upcoming meeting"}* at ${timeLabel}.${joinHref ? ` Join: ${joinHref}` : ""}`;

          try {
            await postSlackMessage(text, {
              target_user_id: targetUserId,
              username: "Meeting Reminder",
              icon_emoji: step === 5 ? ":rotating_light:" : ":spiral_calendar_pad:",
            });
            await db.reminder_events.insert({
              employee_name: identity.name,
              reminder_type: "meeting",
              dedupe_key: dedupeKey,
              sent_at: new Date().toISOString(),
            });
            sentReminderKeys.add(dedupeKey);
            entry.sentSteps.push(step);
          } catch {
            // ignore reminder send failures in the widget
          }
        }

        nextState[eventKey] = entry;
      }

      for (const key of Object.keys(nextState)) {
        if (!trackedKeys.has(key)) delete nextState[key];
      }
      writeMeetingReminderState(nextState);
    };

    void runReminderCheck();
    const timer = window.setInterval(() => {
      void runReminderCheck();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [identity?.name, calendarConnected, calendarEvents]);

  useEffect(() => {
    let cancelled = false;
    const loadActionItems = async () => {
      if (!effectiveUser) {
        setActionItems([]);
        return;
      }
      setActionItemsLoading(true);
      try {
        const rows = await db.personal_action_items.list({ orderBy: { column: "created_at", ascending: false } });
        if (cancelled) return;
        const target = String(effectiveUser).trim().toLowerCase();
        setActionItems(rows.filter((task) => String(task.owner_name ?? task.employee_name ?? "").trim().toLowerCase() === target && task.status !== "done"));
      } catch {
        if (!cancelled) setActionItems([]);
      } finally {
        if (!cancelled) setActionItemsLoading(false);
      }
    };
    void loadActionItems();
    return () => {
      cancelled = true;
    };
  }, [effectiveUser]);

  const updateActionItem = async (taskId: number, patch: Partial<PersonalActionItem>) => {
    setActionItems((prev) => prev
      .map((task) => (task.id === taskId ? { ...task, ...patch } : task))
      .filter((task) => task.status !== "done"),
    );
    try {
      await db.personal_action_items.updateById(taskId, patch);
    } catch {
      const rows = await db.personal_action_items.list({ orderBy: { column: "created_at", ascending: false } });
      const target = String(effectiveUser).trim().toLowerCase();
      setActionItems(rows.filter((task) => String(task.owner_name ?? task.employee_name ?? "").trim().toLowerCase() === target && task.status !== "done"));
    }
  };

  // Build the team leaderboard — every unique user from either source.
  const leaderboard: MyDayMetrics[] = useMemo(() => {
    const names = new Set<string>([
      ...Object.keys(slack?.by_user ?? {}),
      ...Object.keys(calls?.by_user ?? {}),
      ...NOC_ROSTER, // include offline users so the team picker is comprehensive
    ]);
    const all = Array.from(names).map((u) => buildMyDayMetrics(u, slack, calls));
    // Sort by total activity score (worked + updated + acked + calls)
    all.sort((a, b) => {
      const scoreA = a.worked * 2 + a.updated + a.acked + a.calls_answered;
      const scoreB = b.worked * 2 + b.updated + b.acked + b.calls_answered;
      return scoreB - scoreA;
    });
    return all;
  }, [slack, calls]);

  // Header status: live if both sources are live, mixed if one, snapshot if neither
  const headerStatus = useMemo(() => {
    if (!slack && !calls) return { label: "loading", color: "gray" };
    const slackLive = slack?.source === "live";
    const callsLive = calls?.source === "live";
    if (slackLive && callsLive) {
      return { label: "live", color: "green", tooltip: "Live data from Slack + Zoom" };
    }
    if (slackLive || callsLive) {
      return {
        label: "partial",
        color: "yellow",
        tooltip: `Slack: ${slack?.source ?? "?"} · Zoom: ${calls?.source ?? "?"}`,
      };
    }
    return {
      label: "snapshot",
      color: "yellow",
      tooltip: "Both Slack and Zoom credentials are using fallback data",
    };
  }, [slack, calls]);

  const dayLabel = slack?.day_start
    ? new Date(slack.day_start).toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    : "Today";

  const meetingsAttended = useMemo(
    () => calendarEvents.filter((event) => event.end?.dateTime && new Date(event.end.dateTime).getTime() <= Date.now()).length,
    [calendarEvents],
  );
  const callsMade = 0;

  return (
    <WidgetFrame
      title="My Day"
      subtitle={`Today's activity from #${slack?.channel ?? "noc-team"} + Zoom Phone — ${dayLabel}`}
      icon={IconActivity}
      iconColor="indigo"
      loading={loading}
      onRefresh={refresh}
      status={headerStatus}
    >
      <Stack gap="lg">
        {/* User picker */}
        <Group gap="xs" align="flex-end">
          <Autocomplete
            label="Showing activity for"
            value={effectiveUser}
            onChange={setSelected}
            data={NOC_ROSTER}
            placeholder="Pick a teammate"
            leftSection={<IconUser size={14} />}
            style={{ flex: 1, maxWidth: 320 }}
            size="sm"
            limit={20}
          />
          {identity?.name && effectiveUser !== identity.name && (
            <Anchor
              component="button"
              size="xs"
              onClick={() => setSelected(identity.name!)}
              c="dimmed"
            >
              Reset to me ({identity.name})
            </Anchor>
          )}
        </Group>

        {/* Snapshot layout */}
        {myMetrics ? (
          <Grid gutter="md" align="stretch">
            <Grid.Col span={{ base: 12, lg: 6 }}>
              <Stack gap="md" h="100%">
                <Card withBorder radius="lg" p="md">
                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <Group gap="xs">
                        <ThemeIcon size="sm" radius="md" variant="light" color="grape">
                          <IconCalendarEvent size={14} />
                        </ThemeIcon>
                        <Text fw={700} size="sm">Today's meetings</Text>
                      </Group>
                      <Badge variant="light" color="grape">{calendarEvents.length}</Badge>
                    </Group>
                    {calendarConnected ? (
                      calendarEvents.length > 0 ? (
                        <Stack gap="xs">
                          {calendarEvents.slice(0, 6).map((event) => {
                            const { primary: joinHref, provider } = extractMeetingLinks(event);
                            const timing = getMeetingTimingState(event);
                            return (
                              <Card
                                key={event.id}
                                withBorder
                                radius="md"
                                p="xs"
                                style={{
                                  borderLeft: `3px solid var(--mantine-color-${timing.tone}-6)`,
                                  background: `color-mix(in srgb, var(--mantine-color-${timing.tone}-9) 16%, var(--mantine-color-body))`,
                                }}
                              >
                                <Group justify="space-between" align="flex-start" wrap="nowrap">
                                  <Box style={{ minWidth: 0, flex: 1 }}>
                                    <Text size="sm" fw={600} lineClamp={2}>{event.summary || "Untitled meeting"}</Text>
                                    <Text size="xs" c="dimmed" mt={2}>
                                      {event.start?.dateTime ? new Date(event.start.dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}
                                      {event.end?.dateTime ? ` – ${new Date(event.end.dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
                                    </Text>
                                    <Text size="xs" c={`${timing.tone}.3`} fw={600} mt={4}>{timing.timingText}</Text>
                                    {event.location && <Text size="xs" c="dimmed" lineClamp={1}>{event.location}</Text>}
                                    <Group gap={6} mt={6} wrap="wrap">
                                      {provider && <Badge size="xs" variant="outline" color="grape">{provider}</Badge>}
                                      <Badge size="xs" variant="light" color={timing.tone}>{timing.statusLabel}</Badge>
                                    </Group>
                                  </Box>
                                  <Stack gap={6} align="flex-end">
                                    {joinHref ? (
                                      <Group gap={6}>
                                        <Button
                                          component="a"
                                          href={joinHref}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          size="compact-xs"
                                          variant={timing.canJoin ? "filled" : "light"}
                                          color={timing.canJoin ? "green" : timing.tone}
                                          disabled={!timing.canJoin}
                                        >
                                          {timing.canJoin ? "Join" : "Join soon"}
                                        </Button>
                                        <Button
                                          size="compact-xs"
                                          variant="subtle"
                                          color="gray"
                                          leftSection={<IconCopy size={12} />}
                                          onClick={() => void navigator.clipboard.writeText(joinHref)}
                                        >
                                          Copy
                                        </Button>
                                      </Group>
                                    ) : null}
                                  </Stack>
                                </Group>
                              </Card>
                            );
                          })}
                        </Stack>
                      ) : (
                        <Text size="sm" c="dimmed">No meetings scheduled for today.</Text>
                      )
                    ) : (
                      <Stack gap="xs" align="flex-start">
                        <Text size="sm" c="dimmed">Connect Google Calendar to show today's meetings here.</Text>
                        <Button size="xs" variant="light" color="grape" onClick={() => void connectCalendar()} loading={calendarConnecting}>
                          Connect Google Calendar
                        </Button>
                      </Stack>
                    )}
                    {calendarError && <Text size="xs" c="dimmed">{calendarError}</Text>}
                  </Stack>
                </Card>

                <Card withBorder radius="lg" p="md" style={{ flex: 1 }}>
                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <Group gap="xs">
                        <ThemeIcon size="sm" radius="md" variant="light" color="orange">
                          <IconChecklist size={14} />
                        </ThemeIcon>
                        <Text fw={700} size="sm">Action items</Text>
                      </Group>
                      <Badge variant="light" color="orange">{actionItems.length}</Badge>
                    </Group>
                    {actionItemsLoading ? (
                      <Text size="sm" c="dimmed">Loading action items…</Text>
                    ) : actionItems.length > 0 ? (
                      <Stack gap="xs">
                        {actionItems.slice(0, 6).map((task) => {
                          const progressValue = typeof task.progress_percent === "number" ? task.progress_percent : 0;
                          const statusColor = task.status === "blocked" ? "red" : task.status === "in_progress" ? "blue" : "yellow";
                          return (
                            <Card key={task.id} withBorder radius="md" p="xs">
                              <Stack gap="xs">
                                <Group justify="space-between" align="flex-start" wrap="nowrap">
                                  <Box style={{ minWidth: 0, flex: 1 }}>
                                    <Text size="sm" fw={600} lineClamp={2}>{task.title}</Text>
                                    {task.details && <Text size="xs" c="dimmed" lineClamp={2}>{task.details}</Text>}
                                  </Box>
                                  <Badge size="xs" variant="light" color={statusColor}>
                                    {task.status.replace("_", " ")}
                                  </Badge>
                                </Group>

                                <Group gap="xs" wrap="wrap">
                                  {task.note_id ? <Badge size="xs" variant="outline" color="grape">From meeting notes</Badge> : null}
                                  {task.due_date && <Badge size="xs" variant="outline" color="gray">Due {task.due_date}</Badge>}
                                  <Badge size="xs" variant="light" color="teal">{progressValue}% complete</Badge>
                                </Group>

                                <Progress value={progressValue} color={task.status === "blocked" ? "red" : "teal"} radius="xl" size="sm" />

                                <Group gap="xs" align="end" wrap="wrap">
                                  {task.status === "open" ? (
                                    <Button size="compact-xs" variant="light" color="blue" onClick={() => void updateActionItem(task.id, { status: "in_progress" })}>
                                      Start
                                    </Button>
                                  ) : null}
                                  <Select
                                    size="xs"
                                    w={130}
                                    label="Status"
                                    data={TASK_STATUS_OPTIONS}
                                    value={task.status}
                                    onChange={(value: string | null) => {
                                      if (!value) return;
                                      void updateActionItem(task.id, {
                                        status: value,
                                        progress_percent: value === "done" ? 100 : value === "open" ? 0 : progressValue,
                                      });
                                    }}
                                  />
                                  <Select
                                    size="xs"
                                    w={110}
                                    label="Progress"
                                    data={TASK_PROGRESS_OPTIONS}
                                    value={String(progressValue)}
                                    onChange={(value: string | null) => {
                                      if (!value) return;
                                      const nextProgress = Number(value);
                                      void updateActionItem(task.id, {
                                        progress_percent: nextProgress,
                                        status: nextProgress >= 100 ? "done" : nextProgress > 0 && task.status === "open" ? "in_progress" : task.status,
                                      });
                                    }}
                                  />
                                </Group>
                              </Stack>
                            </Card>
                          );
                        })}
                      </Stack>
                    ) : (
                      <Text size="sm" c="dimmed">No open action items for today.</Text>
                    )}
                  </Stack>
                </Card>
              </Stack>
            </Grid.Col>

            <Grid.Col span={{ base: 12, lg: 6 }}>
              <Card withBorder radius="lg" p="md" h="100%">
                <Stack gap="md">
                  <Group justify="space-between" align="center">
                    <Box>
                      <Text fw={700} size="sm">Daily summary</Text>
                      <Text size="xs" c="dimmed">Core activity signals for {resolved ?? effectiveUser}</Text>
                    </Box>
                    <Badge variant="light" color="indigo">{dayLabel}</Badge>
                  </Group>
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                    <MetricCard
                      label="Tickets acknowledged"
                      value={myMetrics.acked + myMetrics.assignments_received}
                      icon={IconBolt}
                      color="yellow"
                      hint={myMetrics.acked + myMetrics.assignments_received > 0 ? `${myMetrics.acked} ack'd · ${myMetrics.assignments_received} assigned` : "No acks yet today"}
                    />
                    <MetricCard
                      label="Tickets updated"
                      value={myMetrics.updated}
                      icon={IconCheck}
                      color="teal"
                      hint={myMetrics.updated > 0 ? `${myMetrics.updated_tickets.slice(0, 2).join(", ")}${myMetrics.updated_tickets.length > 2 ? ` +${myMetrics.updated_tickets.length - 2}` : ""}` : "No updated / done posts yet"}
                    />
                    <MetricCard
                      label="Calls answered"
                      value={myMetrics.calls_answered}
                      icon={IconPhone}
                      color="blue"
                      hint={myMetrics.calls_answered > 0 ? `${myMetrics.call_minutes} min talk time` : "No answered calls yet"}
                    />
                    <MetricCard
                      label="Calls made"
                      value={callsMade}
                      icon={IconPhoneCall}
                      color="cyan"
                      hint="Outbound calls are not available in the current Zoom feed yet"
                    />
                    <MetricCard
                      label="Meetings attended"
                      value={meetingsAttended}
                      icon={IconCalendarEvent}
                      color="grape"
                      hint={calendarConnected ? `${calendarEvents.length} scheduled today` : "Connect calendar to track this"}
                    />
                  </SimpleGrid>

                  <Card withBorder radius="md" p="sm">
                    <Stack gap="xs">
                      <Text size="xs" tt="uppercase" fw={700} c="dimmed">Team leaderboard</Text>
                      <Leaderboard rows={leaderboard.slice(0, 8)} highlightUser={resolved} />
                    </Stack>
                  </Card>
                </Stack>
              </Card>
            </Grid.Col>
          </Grid>
        ) : (
          <Alert icon={<IconUser size={14} />} color="indigo" variant="light" radius="md">
            <Text size="sm">
              Pick your name above (or set an identity in any widget) to see your activity for today.
            </Text>
          </Alert>
        )}

        {slack && (
          <Text size="xs" c="dimmed" ta="right">
            {slack.message_count} messages parsed · {slack.ticket_event_count} ticket events ·{" "}
            {slack.user_count} contributors · last refreshed{" "}
            {new Date(slack.fetched_at).toLocaleTimeString()}
          </Text>
        )}
      </Stack>
    </WidgetFrame>
  );
}

// =============================================================================
// MetricCard
// =============================================================================

function MetricCard({
  label,
  value,
  icon: Icon,
  color,
  hint,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ size?: number }>;
  color: string;
  hint?: string;
}) {
  return (
    <Card radius="lg" withBorder p="md" h="100%">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {label}
          </Text>
          <ThemeIcon size="sm" radius="md" variant="light" color={color}>
            <Icon size={14} />
          </ThemeIcon>
        </Group>
        <Title order={1} c={color} style={{ lineHeight: 1 }}>
          {value}
        </Title>
        {hint && (
          <Text size="xs" c="dimmed" lineClamp={2} style={{ minHeight: 28 }}>
            {hint}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

// =============================================================================
// DetailedView — chip lists of every ticket + assignment for the selected user
// =============================================================================

// =============================================================================
// Leaderboard — full team table sorted by activity
// =============================================================================

function Leaderboard({
  rows,
  highlightUser,
}: {
  rows: MyDayMetrics[];
  highlightUser?: string | null;
}) {
  return (
    <ScrollArea.Autosize mah={420}>
      <Table striped highlightOnHover withTableBorder withColumnBorders fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Teammate</Table.Th>
            <Table.Th ta="right">
              <Tooltip label="Tickets they posted 'W' / 'working' for">
                <span>Worked</span>
              </Tooltip>
            </Table.Th>
            <Table.Th ta="right">
              <Tooltip label="Tickets they posted 'updated' / 'done' for">
                <span>Updated</span>
              </Tooltip>
            </Table.Th>
            <Table.Th ta="right">
              <Tooltip label="Tickets they posted 'ack' for + tickets assigned to them">
                <span>Ack'd</span>
              </Tooltip>
            </Table.Th>
            <Table.Th ta="right">
              <Tooltip label="Inbound Zoom Phone calls they answered">
                <span>Calls</span>
              </Tooltip>
            </Table.Th>
            <Table.Th ta="right">
              <Tooltip label="Slack messages posted to #noc-team today">
                <span>Msgs</span>
              </Tooltip>
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => {
            const isMe = highlightUser && r.user === highlightUser;
            const isInactive =
              r.worked + r.updated + r.acked + r.calls_answered + r.message_count === 0;
            return (
              <Table.Tr
                key={r.user}
                style={
                  isMe
                    ? {
                        background: "var(--mantine-color-indigo-9)",
                        outline: "1px solid var(--mantine-color-indigo-5)",
                      }
                    : isInactive
                      ? { opacity: 0.5 }
                      : undefined
                }
              >
                <Table.Td>
                  <Group gap={4}>
                    {isMe && (
                      <Badge size="xs" variant="filled" color="indigo">
                        you
                      </Badge>
                    )}
                    <Text size="xs" fw={isMe ? 600 : 400}>
                      {r.user}
                    </Text>
                  </Group>
                </Table.Td>
                <Table.Td ta="right" ff="monospace">
                  {r.worked || ""}
                </Table.Td>
                <Table.Td ta="right" ff="monospace">
                  {r.updated || ""}
                </Table.Td>
                <Table.Td ta="right" ff="monospace">
                  {r.acked + r.assignments_received || ""}
                </Table.Td>
                <Table.Td ta="right" ff="monospace">
                  {r.calls_answered || ""}
                </Table.Td>
                <Table.Td ta="right" ff="monospace" c="dimmed">
                  {r.message_count || ""}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  );
}
