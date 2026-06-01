import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  Progress,
  RingProgress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBrandSlack,
  IconClockEdit,
  IconCoffee,
  IconHeadset,
  IconLock,
  IconPlayerPlay,
  IconPlayerStop,
  IconUser,
  IconUserCheck,
  IconUserOff,
} from "@tabler/icons-react";
import { ZOOM_STATUS_COLORS, ZOOM_STATUS_LABELS, type ZoomAgent } from "../../lib/zoom";
import { WidgetFrame } from "../WidgetFrame";
import { useZoomQueue } from "./data";
import { useBreakData } from "../BreakTracker/data";
import { useRosterShift, type ShiftWindow } from "../../lib/use-roster-shift";
import { LOCKED_TEAM_NAMES, resolveTeamMember, SECTION_LABELS, teamFor, TIER_COLORS, TIER_SHORT_LABELS, tierFor } from "../PerformanceTracker/team";
import { useIdentity } from "../../lib/identity";
import { db } from "../../db";
import { emojiForBreak, formatBreakStartMessage, postSlackMessage } from "../../lib/slack";
import { formatElapsedIso } from "../../lib/format";
import { BreakScheduleModal } from "./BreakScheduleModal";

export { ZoomQueueTile } from "./Tile";

type ActiveStatusRow = Awaited<ReturnType<typeof db.breaks.list>>[number];

const TRACKED_QUEUES = ["Network Tech Support", "Mobility Tech Support"];
const QUEUE_SHORT: Record<string, string> = {
  "Network Tech Support": "NOC",
  "Mobility Tech Support": "Mobility",
};

const BREAK_EMOJI: Record<string, string> = {
  Coffee: "☕",
  Lunch: "🍽️",
  Restroom: "🚻",
  Personal: "👤",
  Other: "⏸️",
  "Urgent Task": "🚨",
  "Meeting - Internal": "🗓️",
  "Meeting - External": "🤝",
};

const STATUS_TYPES = [
  { value: "Coffee", label: "☕ Coffee" },
  { value: "Lunch", label: "🍽️ Lunch" },
  { value: "Restroom", label: "🚻 Restroom" },
  { value: "Personal", label: "👤 Personal" },
  { value: "Other", label: "⏸️ Other" },
  { value: "Urgent Task", label: "🚨 Urgent Task" },
  { value: "Meeting - Internal", label: "🗓️ Meeting - Internal" },
  { value: "Meeting - External", label: "🤝 Meeting - External" },
];

type Toast = {
  id: number;
  color: "green" | "yellow" | "red" | "blue";
  title: string;
  body?: string;
};

const REMINDER_DELAY_MS = 5 * 60_000;
const SHIFT_GRACE_MINUTES = 15;
const REMINDER_STORAGE_KEY = "team-availability-queue-reminders-v1";
const MEETING_REMINDER_STORAGE_KEY = "team-availability-meeting-reminders-v1";
const BREAK_REMINDER_STORAGE_KEY = "team-availability-break-reminders-v1";
const TOTAL_BREAK_MINUTES = 90;
const BREAK_ONLY_TYPES = new Set(["Coffee", "Lunch", "Restroom", "Personal", "Other"]);
const MEETING_TYPES = new Set(["Meeting - Internal", "Meeting - External"]);
const MEETING_REMINDER_STEPS_MS = [45 * 60_000, 75 * 60_000, 120 * 60_000];
const LUNCH_REMINDER_MS = 65 * 60_000;
const OTHER_BREAK_REMINDER_MS = 30 * 60_000;
const BREAK_START_QUEUE_COOLDOWN_MS = 2 * 60_000;

// Normalise names for fuzzy matching between Zoom display names and Break Tracker employee names
function normName(n: string) {
  return n.toLowerCase().replace(/\s+/g, " ").trim();
}

function nowMinutesPacific(): number {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  return now.getHours() * 60 + now.getMinutes();
}

function getReminderWindow(shift: ShiftWindow) {
  return {
    reminderStart: shift.start + SHIFT_GRACE_MINUTES,
    reminderEnd: shift.end - SHIFT_GRACE_MINUTES,
  };
}

function isWithinReminderWindow(nowMin: number, shift: ShiftWindow): boolean {
  const { reminderStart, reminderEnd } = getReminderWindow(shift);
  if (shift.end > shift.start) {
    return reminderEnd > reminderStart && nowMin >= reminderStart && nowMin <= reminderEnd;
  }
  return false;
}

function readReminderState(): Record<string, { eligibleSince: number; reminded: boolean }> {
  try {
    return JSON.parse(window.localStorage.getItem(REMINDER_STORAGE_KEY) ?? "{}") as Record<string, { eligibleSince: number; reminded: boolean }>;
  } catch {
    return {};
  }
}

function writeReminderState(state: Record<string, { eligibleSince: number; reminded: boolean }>) {
  window.localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(state));
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

function readBreakReminderState(): Record<string, { reminded: boolean }> {
  try {
    return JSON.parse(window.localStorage.getItem(BREAK_REMINDER_STORAGE_KEY) ?? "{}") as Record<string, { reminded: boolean }>;
  } catch {
    return {};
  }
}

function writeBreakReminderState(state: Record<string, { reminded: boolean }>) {
  window.localStorage.setItem(BREAK_REMINDER_STORAGE_KEY, JSON.stringify(state));
}

function samePerson(a: string, b: string) {
  return normName(a) === normName(b);
}

function isSameLocalDay(iso: string, now = new Date()) {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function todayPacificIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function ZoomQueueWidget() {
  const { data, loading, error, refresh } = useZoomQueue();
  const { ready, active: activeBreaks, history: breakHistory, refresh: refreshBreaks } = useBreakData();
  const { data: rosterData, isInShift, isRosterListed } = useRosterShift();
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<string | null>("Coffee");
  const [posting, setPosting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [breakScheduleOpen, setBreakScheduleOpen] = useState(false);

  const effectiveName = (isManager ? (selectedName ?? identity?.name ?? "") : (identity?.name ?? "")).trim();

  function showToast(t: Omit<Toast, "id">) {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 5000);
  }

  async function startStatus() {
    const trimmed = effectiveName;
    if (!trimmed || !statusType || posting || !ready) return;

    setPosting(true);
    const slackText = formatBreakStartMessage(statusType);

    let slackTs: string | null = null;
    let slackPosted = false;
    try {
      const result = await postSlackMessage(slackText, {
        username: trimmed,
        icon_emoji: emojiForBreak(statusType),
      });
      slackTs = result.ts ?? null;
      slackPosted = !!result.posted;
      showToast({
        color: result.posted ? "green" : result.demo ? "yellow" : "red",
        title: result.posted
          ? `Posted to #${result.channel ?? "noc-team"} as ${trimmed}`
          : result.demo
            ? "Demo mode — Slack post simulated"
            : "Slack post failed",
        body: result.posted ? `"${slackText}"` : result.warning ?? result.error ?? "Unknown error",
      });
    } catch (err) {
      showToast({
        color: "red",
        title: "Slack post failed",
        body: err instanceof Error ? err.message : String(err),
      });
    }

    await db.breaks.insert({
      employee_name: trimmed,
      break_type: statusType,
      start_time: new Date().toISOString(),
      is_active: true,
      slack_message_ts: slackTs,
      slack_posted: slackPosted,
    });

    setPosting(false);
    refreshBreaks();
  }

  async function endStatus(activeStatus: ActiveStatusRow) {
    const viewerName = identity?.name?.trim();
    const statusOwner = activeStatus.employee_name.trim();
    if (!isManager && (!viewerName || viewerName !== statusOwner)) {
      showToast({
        color: "red",
        title: "You can only end your own status",
        body: "Only managers can end another user's active status.",
      });
      return;
    }

    const end = new Date();
    const duration = Math.max(1, Math.round((end.getTime() - new Date(activeStatus.start_time).getTime()) / 60000));
    const threadTs = activeStatus.slack_message_ts && !activeStatus.slack_message_ts.startsWith("demo-")
      ? activeStatus.slack_message_ts
      : null;

    setPosting(true);
    try {
      try {
        const result = await postSlackMessage("Back", {
          thread_ts: threadTs,
          username: activeStatus.employee_name,
          icon_emoji: ":arrow_backward:",
        });
        showToast({
          color: result.posted ? "blue" : result.demo ? "yellow" : "red",
          title: result.posted
            ? `Posted "Back" to #${result.channel ?? "noc-team"} as ${activeStatus.employee_name}`
            : result.demo
              ? "Demo mode — Slack post simulated"
              : "Slack post failed",
          body: result.posted
            ? threadTs
              ? "Replied in thread on the original status message."
              : '"Back"'
            : result.warning ?? result.error ?? "Unknown error",
        });
      } catch (err) {
        showToast({
          color: "red",
          title: "Slack post failed",
          body: err instanceof Error ? err.message : String(err),
        });
      }

      await db.breaks.updateById(activeStatus.id, {
        end_time: end.toISOString(),
        duration_minutes: duration,
        is_active: false,
      });
      refreshBreaks();
    } finally {
      setPosting(false);
    }
  }

  const activeStatusMap = new Map(
    activeBreaks.flatMap((b) => {
      const canonical = resolveTeamMember(b.employee_name) ?? b.employee_name;
      const keys = new Set<string>([normName(canonical), normName(b.employee_name)]);
      return [...keys].map((key) => [key, b] as const);
    }),
  );
  const shiftWindowMap = useMemo(() => {
    const map = new Map<string, ShiftWindow>();
    for (const window of rosterData?.shiftWindows ?? []) {
      map.set(normName(window.name), window);
    }
    return map;
  }, [rosterData]);

  const inShiftNowSet = useMemo(() => {
    const set = new Set<string>();
    for (const name of rosterData?.inShiftNow ?? []) {
      set.add(normName(name));
    }
    return set;
  }, [rosterData]);

  // Build a map: canonical/normalised name → break_type for anyone currently on break
  const breakMap = new Map<string, string>(
    activeBreaks.map((b) => [normName(resolveTeamMember(b.employee_name) ?? b.employee_name), b.break_type]),
  );

  // All Zoom agents, enriched with roster identity and filtered to current shift
  const allAgents: Array<ZoomAgent & { rosterName?: string | null }> = (data?.agents ?? [])
    .filter((a) => !a.display_name.toLowerCase().includes("overflow"))
    .map((a) => ({
      ...a,
      rosterName: resolveTeamMember(a.display_name),
    }));

  const agents = allAgents.filter((a) => {
    const name = a.rosterName ?? a.display_name;
    return isInShift(name) || a.status === "in_queue" || breakMap.has(normName(name)) || isRosterListed(name);
  });
  const onBreak = agents.filter((a) => breakMap.has(normName(a.rosterName ?? a.display_name)));
  const inShiftAndInQueue = agents.filter((a) => {
    const name = a.rosterName ?? a.display_name;
    return a.status === "in_queue" && (isInShift(name) || isRosterListed(name));
  });
  const inShiftNotInQueue = agents.filter((a) => {
    const name = a.rosterName ?? a.display_name;
    const normalizedName = normName(name);
    const displayNormalized = normName(a.display_name);
    const hasBreak = breakMap.has(normalizedName) || breakMap.has(displayNormalized);
    const isInShiftNow = inShiftNowSet.has(normalizedName) || inShiftNowSet.has(displayNormalized);
    return a.status !== "in_queue" && isInShiftNow && !hasBreak;
  });
  const currentShiftAgents = agents.filter((a) => {
    const name = a.rosterName ?? a.display_name;
    const normalizedName = normName(name);
    const displayNormalized = normName(a.display_name);
    return inShiftNowSet.has(normalizedName) || inShiftNowSet.has(displayNormalized);
  });
  const currentShiftCount = currentShiftAgents.length;
  const pct = currentShiftCount > 0 ? Math.round((inShiftAndInQueue.length / currentShiftCount) * 100) : 0;

  // Per-queue counts
  const allQueues = TRACKED_QUEUES.filter((q) =>
    agents.some((a) => a.queue_opt_in && q in a.queue_opt_in),
  );
  const queueCounts = Object.fromEntries(
    allQueues.map((q) => [q, agents.filter((a) => a.queue_opt_in?.[q] === true).length]),
  );

  const onBreakCount = onBreak.length;

  const myBreakRows = useMemo(() => {
    if (!identity?.name) return [] as ActiveStatusRow[];

    const rows = [...activeBreaks, ...breakHistory].filter(
      (row) =>
        samePerson(row.employee_name, identity.name) &&
        BREAK_ONLY_TYPES.has(row.break_type) &&
        isSameLocalDay(row.start_time),
    );

    const deduped = new Map<number, ActiveStatusRow>();
    for (const row of rows) {
      deduped.set(row.id, row);
    }
    return [...deduped.values()];
  }, [activeBreaks, breakHistory, identity?.name]);

  const myBreakTakenMinutes = useMemo(() => {
    return myBreakRows.reduce((sum, row) => {
      const endMs = row.is_active ? Date.now() : row.end_time ? new Date(row.end_time).getTime() : Date.now();
      const startMs = new Date(row.start_time).getTime();
      const duration = row.duration_minutes ?? Math.max(1, Math.round((endMs - startMs) / 60000));
      return sum + duration;
    }, 0);
  }, [myBreakRows]);

  const myBreakLeftMinutes = Math.max(TOTAL_BREAK_MINUTES - myBreakTakenMinutes, 0);
  const myBreakPct = Math.min(Math.round((myBreakTakenMinutes / TOTAL_BREAK_MINUTES) * 100), 100);

  useEffect(() => {
    if (!data || !rosterData) return;

    const tick = async () => {
      const now = Date.now();
      const nowMin = nowMinutesPacific();
      const todayKey = todayPacificIso();
      const nextQueueState = readReminderState();
      const nextMeetingState = readMeetingReminderState();
      const nextBreakState = readBreakReminderState();
      const trackedQueueKeys = new Set<string>();
      const trackedMeetingKeys = new Set<string>();
      const trackedBreakKeys = new Set<string>();
      const recentReminderRows = await db.reminder_events.list({ orderBy: { column: "created_at", ascending: false }, limit: 200 });
      const sentReminderKeys = new Set(
        recentReminderRows
          .filter((row) => row.sent_at.startsWith(todayKey))
          .map((row) => row.dedupe_key),
      );

      for (const agent of allAgents) {
        const name = agent.rosterName ?? agent.display_name;
        const normalized = normName(name);
        const shiftWindow = shiftWindowMap.get(normalized);
        const activeStatus = activeStatusMap.get(normalized);

        const queueReminderKey = shiftWindow
          ? `${normalized}:${shiftWindow.start}:${shiftWindow.end}`
          : `${normalized}:no-shift`;
        const queueReminderDedupeKey = `queue:${todayKey}:${normalized}:${shiftWindow?.start ?? "none"}:${shiftWindow?.end ?? "none"}`;
        trackedQueueKeys.add(queueReminderKey);

        const activeBreakAgeMs = activeStatus
          ? now - new Date(activeStatus.start_time).getTime()
          : null;
        const inBreakStartCooldown = activeBreakAgeMs !== null && activeBreakAgeMs < BREAK_START_QUEUE_COOLDOWN_MS;

        const isQueueEligible = !!shiftWindow
          && isWithinReminderWindow(nowMin, shiftWindow)
          && agent.status !== "in_queue"
          && !activeStatus
          && !inBreakStartCooldown;

        if (!isQueueEligible) {
          delete nextQueueState[queueReminderKey];
        } else {
          const existing = nextQueueState[queueReminderKey];
          if (!existing) {
            nextQueueState[queueReminderKey] = { eligibleSince: now, reminded: false };
          } else if (!existing.reminded && now - existing.eligibleSince >= REMINDER_DELAY_MS && !sentReminderKeys.has(queueReminderDedupeKey)) {
            try {
              await postSlackMessage(`${name} - Please turn on the call queue.`, {
                username: "Queue Reminder",
                icon_emoji: ":rotating_light:",
              });
              await db.reminder_events.insert({
                employee_name: name,
                reminder_type: "queue",
                dedupe_key: queueReminderDedupeKey,
                sent_at: new Date().toISOString(),
              });
              sentReminderKeys.add(queueReminderDedupeKey);
              nextQueueState[queueReminderKey] = { ...existing, reminded: true };
            } catch {
              // leave state as-is so the next cycle can retry
            }
          }
        }

        if (activeStatus && agent.status !== "in_queue" && !Object.values(agent.queue_opt_in ?? {}).some(Boolean)) {
          if (MEETING_TYPES.has(activeStatus.break_type)) {
            const meetingReminderKey = `${normalized}:${activeStatus.id}:${activeStatus.start_time}`;
            trackedMeetingKeys.add(meetingReminderKey);
            const entry = nextMeetingState[meetingReminderKey] ?? { sentSteps: [] };
            const startedAt = new Date(activeStatus.start_time).getTime();
            const elapsed = now - startedAt;

            for (const step of MEETING_REMINDER_STEPS_MS) {
              const meetingDedupeKey = `meeting:${todayKey}:${normalized}:${activeStatus.id}:${step}`;
              if (elapsed >= step && !entry.sentSteps.includes(step) && !sentReminderKeys.has(meetingDedupeKey)) {
                try {
                  await postSlackMessage("If you are done with the meeting, please turn on the queue.", {
                    username: "Queue Reminder",
                    icon_emoji: ":spiral_calendar_pad:",
                  });
                  await db.reminder_events.insert({
                    employee_name: name,
                    reminder_type: "meeting",
                    dedupe_key: meetingDedupeKey,
                    sent_at: new Date().toISOString(),
                  });
                  sentReminderKeys.add(meetingDedupeKey);
                  entry.sentSteps.push(step);
                } catch {
                  // leave state as-is so the next cycle can retry
                }
              }
            }

            nextMeetingState[meetingReminderKey] = entry;
          }

          if (BREAK_ONLY_TYPES.has(activeStatus.break_type)) {
            const breakReminderKey = `${normalized}:${activeStatus.id}:${activeStatus.start_time}`;
            trackedBreakKeys.add(breakReminderKey);
            const entry = nextBreakState[breakReminderKey] ?? { reminded: false };
            const startedAt = new Date(activeStatus.start_time).getTime();
            const elapsed = now - startedAt;
            const threshold = activeStatus.break_type === "Lunch" ? LUNCH_REMINDER_MS : OTHER_BREAK_REMINDER_MS;
            const breakDedupeKey = `break:${todayKey}:${normalized}:${activeStatus.id}`;

            if (!entry.reminded && elapsed >= threshold && !sentReminderKeys.has(breakDedupeKey)) {
              try {
                await postSlackMessage(`${name} - If you are still on break, please update your status. If not, please turn on the call queue.`, {
                  username: "Queue Reminder",
                  icon_emoji: ":coffee:",
                });
                await db.reminder_events.insert({
                  employee_name: name,
                  reminder_type: "break",
                  dedupe_key: breakDedupeKey,
                  sent_at: new Date().toISOString(),
                });
                sentReminderKeys.add(breakDedupeKey);
                entry.reminded = true;
              } catch {
                // leave state as-is so the next cycle can retry
              }
            }

            nextBreakState[breakReminderKey] = entry;
          }
        }
      }

      for (const key of Object.keys(nextQueueState)) {
        if (!trackedQueueKeys.has(key)) delete nextQueueState[key];
      }
      for (const key of Object.keys(nextMeetingState)) {
        if (!trackedMeetingKeys.has(key)) delete nextMeetingState[key];
      }
      for (const key of Object.keys(nextBreakState)) {
        if (!trackedBreakKeys.has(key)) delete nextBreakState[key];
      }

      writeReminderState(nextQueueState);
      writeMeetingReminderState(nextMeetingState);
      writeBreakReminderState(nextBreakState);
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 60_000);

    return () => window.clearInterval(id);
  }, [activeStatusMap, allAgents, data, rosterData, shiftWindowMap]);

  return (
    <WidgetFrame
      title="Team Availability"
      subtitle={undefined}
      icon={IconHeadset}
      iconColor="blue"
      loading={loading}
      onRefresh={refresh}
      headerActions={
        <Tooltip label="Add manual break timing">
          <Button
            size="xs"
            variant="light"
            color="blue"
            leftSection={<IconClockEdit size={14} />}
            onClick={() => setBreakScheduleOpen(true)}
          >
            Break timing
          </Button>
        </Tooltip>
      }
      status={
        data
          ? {
              label: data.source,
              color: data.source === "live" ? "green" : "yellow",
              tooltip: data.source === "live"
                ? "Live data from Zoom Phone API"
                : "Snapshot — set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET in .env",
            }
          : undefined
      }
    >
      <>
        <BreakScheduleModal
          opened={breakScheduleOpen}
          onClose={() => setBreakScheduleOpen(false)}
          identityName={identity?.name}
          isManager={isManager}
        />
        <Stack gap="md">
        {data?.warning && (
          <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light" radius="md">
            {data.warning}
          </Alert>
        )}
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" radius="md">
            Failed to load: {error}
          </Alert>
        )}

        <Box
          style={{
            position: "fixed",
            top: 76,
            right: 16,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            maxWidth: 380,
          }}
        >
          {toasts.map((t) => (
            <Alert
              key={t.id}
              color={t.color}
              icon={t.color === "red" ? <IconAlertCircle size={16} /> : <IconBrandSlack size={16} />}
              title={t.title}
              variant="filled"
              radius="md"
              withCloseButton
              onClose={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            >
              {t.body}
            </Alert>
          ))}
        </Box>

        <Card withBorder radius="lg" p="md">
          <Stack gap="md">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Stack gap={2}>
                <Text fw={600} size="sm">My status</Text>
                <Text size="xs" c="dimmed">
                  Quickly set a break or meeting status while keeping queue visibility below.
                </Text>
              </Stack>
              {!isManager && (
                <Badge variant="light" color="gray" leftSection={<IconLock size={10} />}>
                  {effectiveName || "Not signed in"}
                </Badge>
              )}
            </Group>
            <Grid gutter="sm" align="end">
              <Grid.Col span={{ base: 12, md: isManager ? 4 : 8 }}>
                {isManager ? (
                  <Select
                    label="Person"
                    data={LOCKED_TEAM_NAMES.map((name) => ({ value: name, label: name }))}
                    value={selectedName ?? identity?.name ?? null}
                    onChange={setSelectedName}
                    searchable
                    allowDeselect={false}
                    size="sm"
                    leftSection={<IconUser size={14} />}
                  />
                ) : (
                  <Box>
                    <Text size="xs" fw={500} c="dimmed" mb={4}>Person</Text>
                    <Group gap="xs" p="sm" style={{ border: "1px solid var(--mantine-color-dark-4)", borderRadius: 10 }}>
                      <ThemeIcon size="sm" color="orange" variant="light" radius="xl">
                        <IconUser size={12} />
                      </ThemeIcon>
                      <Text size="sm" fw={600}>{effectiveName || "Sign in first"}</Text>
                    </Group>
                  </Box>
                )}
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: isManager ? 5 : 8 }}>
                <Select
                  label="Status"
                  data={STATUS_TYPES}
                  value={statusType}
                  onChange={setStatusType}
                  allowDeselect={false}
                  size="sm"
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 3 }}>
                <Button
                  fullWidth
                  leftSection={<IconPlayerPlay size={14} />}
                  onClick={startStatus}
                  loading={posting}
                  disabled={!effectiveName || !statusType || !ready || posting}
                  size="sm"
                >
                  Update status
                </Button>
              </Grid.Col>
            </Grid>
            <Group gap="xs" wrap="wrap">
              <Badge variant="light" color="orange">Breaks</Badge>
              <Badge variant="light" color="cyan">Meeting - Internal</Badge>
              <Badge variant="light" color="teal">Meeting - External</Badge>
              <Text size="xs" c="dimmed">External = customer / partner meeting.</Text>
            </Group>
          </Stack>
        </Card>

        {/* ── Availability summary ── */}
        {isManager ? (
          <SimpleGrid cols={{ base: 1, sm: allQueues.length > 0 ? 3 : 2 }} spacing="md">
            <Card withBorder radius="md" p="md">
              <Group justify="space-between" align="center" wrap="nowrap">
                <Stack gap={2}>
                  <Text size="xs" c="dimmed" fw={600} tt="uppercase">Queue Availability</Text>
                  <Group gap={4} align="baseline">
                    <Text size="2rem" fw={800} c="green" ff="monospace" style={{ lineHeight: 1 }}>
                      {inShiftAndInQueue.length}
                    </Text>
                    <Text size="sm" c="dimmed">/ {currentShiftCount} in shift</Text>
                  </Group>
                  <Group gap={6}>
                    <Text size="xs" c="dimmed">{pct}% availability</Text>
                    <Text size="xs" c="dimmed">· {inShiftNotInQueue.length} not in queue</Text>
                    {onBreakCount > 0 && (
                      <Badge size="xs" color="orange" variant="light" leftSection={<IconCoffee size={10} />}>
                        {onBreakCount} on break
                      </Badge>
                    )}
                  </Group>
                </Stack>
                <RingProgress
                  size={80}
                  thickness={8}
                  roundCaps
                  sections={[{ value: pct, color: pct >= 60 ? "green" : pct >= 30 ? "yellow" : "red" }]}
                  label={
                    <Box ta="center">
                      <Text size="xs" fw={700} ff="monospace">{pct}%</Text>
                    </Box>
                  }
                />
              </Group>
            </Card>

            {allQueues.map((q) => {
              const count = queueCounts[q] ?? 0;
              const qPct  = currentShiftCount > 0 ? Math.round((count / currentShiftCount) * 100) : 0;
              const notOptedIn = Math.max(currentShiftCount - count, 0);
              return (
                <Card key={q} withBorder radius="md" p="md">
                  <Group justify="space-between" align="center" wrap="nowrap">
                    <Stack gap={2}>
                      <Text size="xs" c="dimmed" fw={600} tt="uppercase">{QUEUE_SHORT[q] ?? q}</Text>
                      <Group gap={4} align="baseline">
                        <Text size="2rem" fw={800} c="teal" ff="monospace" style={{ lineHeight: 1 }}>
                          {count}
                        </Text>
                        <Text size="sm" c="dimmed">/ {currentShiftCount} in shift</Text>
                      </Group>
                      <Text size="xs" c="dimmed">{notOptedIn} not opted in</Text>
                    </Stack>
                    <RingProgress
                      size={80}
                      thickness={8}
                      roundCaps
                      sections={[{ value: qPct, color: "teal" }]}
                      label={
                        <Box ta="center">
                          <Text size="xs" fw={700} ff="monospace">{qPct}%</Text>
                        </Box>
                      }
                    />
                  </Group>
                </Card>
              );
            })}
          </SimpleGrid>
        ) : (
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            <Card withBorder radius="md" p="md">
              <Stack gap="sm">
                <Group justify="space-between" align="flex-start">
                  <Box>
                    <Text size="xs" c="dimmed" fw={600} tt="uppercase">My break time</Text>
                    <Group gap={4} align="baseline">
                      <Text size="2rem" fw={800} c={myBreakLeftMinutes > 0 ? "green" : "red"} ff="monospace" style={{ lineHeight: 1 }}>
                        {myBreakTakenMinutes}
                      </Text>
                      <Text size="sm" c="dimmed">/ {TOTAL_BREAK_MINUTES} min used</Text>
                    </Group>
                  </Box>
                  <Badge color={myBreakLeftMinutes > 0 ? "green" : "red"} variant="light">
                    {myBreakLeftMinutes} min left
                  </Badge>
                </Group>
                <Progress value={myBreakPct} color={myBreakPct >= 100 ? "red" : myBreakPct >= 80 ? "yellow" : "green"} radius="xl" size="lg" />
                <Group justify="space-between" gap="xs">
                  <Text size="xs" c="dimmed">1 long break + 2 short breaks</Text>
                  <Text size="xs" c="dimmed">{Math.min(myBreakPct, 100)}% used</Text>
                </Group>
              </Stack>
            </Card>

            <Card withBorder radius="md" p="md">
              <Group justify="space-between" align="center" wrap="nowrap">
                <Stack gap={2}>
                  <Text size="xs" c="dimmed" fw={600} tt="uppercase">Queue Availability</Text>
                  <Group gap={4} align="baseline">
                    <Text size="2rem" fw={800} c="green" ff="monospace" style={{ lineHeight: 1 }}>
                      {inShiftAndInQueue.length}
                    </Text>
                    <Text size="sm" c="dimmed">/ {currentShiftCount} in shift</Text>
                  </Group>
                  <Group gap={6}>
                    <Text size="xs" c="dimmed">{pct}% availability</Text>
                    <Text size="xs" c="dimmed">· {inShiftNotInQueue.length} not in queue</Text>
                  </Group>
                </Stack>
                <RingProgress
                  size={80}
                  thickness={8}
                  roundCaps
                  sections={[{ value: pct, color: pct >= 60 ? "green" : pct >= 30 ? "yellow" : "red" }]}
                  label={
                    <Box ta="center">
                      <Text size="xs" fw={700} ff="monospace">{pct}%</Text>
                    </Box>
                  }
                />
              </Group>
            </Card>
          </SimpleGrid>
        )}

        {/* ── Agent lists ── */}
        <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
          {/* In Queue */}
          <Card withBorder radius="md" p={0}
            style={{ borderTop: "3px solid var(--mantine-color-green-6)" }}>
            <Group px="md" py="sm" gap="xs">
              <ThemeIcon size="sm" variant="light" color="green" radius="xl">
                <IconUserCheck size={13} />
              </ThemeIcon>
              <Text fw={600} size="sm">In shift + in queue</Text>
              <Badge size="sm" color="green" variant="filled" circle>{inShiftAndInQueue.length}</Badge>
            </Group>
            <Divider />
            {inShiftAndInQueue.length === 0 ? (
              <Text size="xs" c="dimmed" ta="center" py="lg">No visible agents currently in queue</Text>
            ) : (
              <ScrollArea.Autosize mah={360}>
                <Table striped highlightOnHover withRowBorders={false} verticalSpacing="xs" horizontalSpacing="md">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Agent</Table.Th>
                      {allQueues.map((q) => (
                        <Table.Th key={q} style={{ textAlign: "center" }}>{QUEUE_SHORT[q] ?? q}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {inShiftAndInQueue.map((a) => (
                      <AgentRow key={a.agent_id} agent={a} queues={allQueues} breakType={undefined} showReason={false} />
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}
          </Card>

          {/* Not in Queue */}
          <Card withBorder radius="md" p={0}
            style={{ borderTop: "3px solid var(--mantine-color-gray-6)" }}>
            <Group px="md" py="sm" gap="xs">
              <ThemeIcon size="sm" variant="light" color="gray" radius="xl">
                <IconUserOff size={13} />
              </ThemeIcon>
              <Text fw={600} size="sm">In shift + not in queue</Text>
              <Badge size="sm" color="gray" variant="filled" circle>{inShiftNotInQueue.length}</Badge>
              {onBreakCount > 0 && (
                <Badge size="xs" color="orange" variant="light">
                  {onBreakCount} on break
                </Badge>
              )}
            </Group>
            <Divider />
            {inShiftNotInQueue.length === 0 ? (
              <Text size="xs" c="dimmed" ta="center" py="lg">No in-shift agents are currently out of queue</Text>
            ) : (
              <ScrollArea.Autosize mah={360}>
                <Table striped highlightOnHover withRowBorders={false} verticalSpacing="xs" horizontalSpacing="md">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Agent</Table.Th>
                      <Table.Th>Reason</Table.Th>
                      <Table.Th>Active</Table.Th>
                      <Table.Th>Action</Table.Th>
                      {allQueues.map((q) => (
                        <Table.Th key={q} style={{ textAlign: "center" }}>{QUEUE_SHORT[q] ?? q}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {inShiftNotInQueue.map((a) => (
                      <AgentRow
                        key={a.agent_id}
                        agent={a}
                        queues={allQueues}
                        breakType={breakMap.get(normName(a.rosterName ?? a.display_name))}
                        activeStatus={activeStatusMap.get(normName(a.rosterName ?? a.display_name))}
                        onEndStatus={endStatus}
                        endDisabled={posting}
                        canEndStatus={isManager || identity?.name?.trim() === (a.rosterName ?? a.display_name).trim()}
                        showReason
                      />
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}
          </Card>
        </SimpleGrid>

        <Card withBorder radius="md" p={0} style={{ borderTop: "3px solid var(--mantine-color-orange-6)" }}>
          <Group px="md" py="sm" gap="xs">
            <ThemeIcon size="sm" variant="light" color="orange" radius="xl">
              <IconCoffee size={13} />
            </ThemeIcon>
            <Text fw={600} size="sm">On break</Text>
            <Badge size="sm" color="orange" variant="filled" circle>{onBreak.length}</Badge>
          </Group>
          <Divider />
          {onBreak.length === 0 ? (
            <Text size="xs" c="dimmed" ta="center" py="lg">No visible agents are currently on break</Text>
          ) : (
            <ScrollArea.Autosize mah={300}>
              <Table striped highlightOnHover withRowBorders={false} verticalSpacing="xs" horizontalSpacing="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Agent</Table.Th>
                    <Table.Th>Reason</Table.Th>
                    {allQueues.map((q) => (
                      <Table.Th key={q} style={{ textAlign: "center" }}>{QUEUE_SHORT[q] ?? q}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {onBreak.map((a) => (
                    <AgentRow
                      key={a.agent_id}
                      agent={a}
                      queues={allQueues}
                      breakType={breakMap.get(normName(a.rosterName ?? a.display_name))}
                      activeStatus={activeStatusMap.get(normName(a.rosterName ?? a.display_name))}
                      onEndStatus={endStatus}
                      endDisabled={posting}
                      canEndStatus={isManager || identity?.name?.trim() === (a.rosterName ?? a.display_name).trim()}
                      showReason
                    />
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}
        </Card>

        {data && (
          <Text size="xs" c="dimmed" ta="right">
            {currentShiftCount} currently in shift · refreshed {new Date(data.fetched_at).toLocaleTimeString()} · queue presence overrides missing roster shift times
          </Text>
        )}
      </Stack>
      </>
    </WidgetFrame>
  );
}

type AgentRowProps = {
  agent: ZoomAgent & { rosterName?: string | null };
  queues: string[];
  breakType?: string;
  activeStatus?: ActiveStatusRow;
  onEndStatus?: (activeStatus: ActiveStatusRow) => void | Promise<void>;
  endDisabled?: boolean;
  canEndStatus?: boolean;
  showReason: boolean;
};

function AgentRow({
  agent,
  queues,
  breakType,
  activeStatus,
  onEndStatus,
  endDisabled,
  canEndStatus,
  showReason,
}: AgentRowProps) {
  const isOnBreak = !!breakType;
  const canonicalName = agent.rosterName ?? resolveTeamMember(agent.display_name);
  const team = canonicalName ? teamFor(canonicalName) : null;
  const tier = canonicalName ? tierFor(canonicalName) : null;

  return (
    <Table.Tr>
      <Table.Td>
        <Stack gap={4}>
          <Group gap="xs" wrap="nowrap">
            <Badge size="xs" variant="dot" color={ZOOM_STATUS_COLORS[agent.status]} />
            <Text size="sm" fw={500}>{canonicalName ?? agent.display_name}</Text>
          </Group>
          <Group gap={6}>
            {team && (
              <Badge size="xs" variant="light" color="gray">
                {SECTION_LABELS[team]}
              </Badge>
            )}
            {tier && (
              <Badge size="xs" variant="light" color={TIER_COLORS[tier]}>
                {TIER_SHORT_LABELS[tier]}
              </Badge>
            )}
            {canonicalName && canonicalName !== agent.display_name && (
              <Text size="xs" c="dimmed">
                Zoom: {agent.display_name}
              </Text>
            )}
          </Group>
        </Stack>
      </Table.Td>

      {showReason && (
        <Table.Td>
          {isOnBreak ? (
            <Tooltip label={`Active status: ${breakType}`} withArrow withinPortal>
              <Badge size="sm" color="orange" variant="light" leftSection={<IconCoffee size={11} />}>
                {BREAK_EMOJI[breakType ?? ""] ?? "⏸️"} {breakType}
              </Badge>
            </Tooltip>
          ) : (
            <Badge size="sm" color="gray" variant="subtle">Not in queue</Badge>
          )}
        </Table.Td>
      )}

      {showReason && (
        <Table.Td>
          {activeStatus ? (
            <Text size="xs" ff="monospace" c="dimmed">{formatElapsedIso(activeStatus.start_time)}</Text>
          ) : (
            <Text size="xs" c="dimmed">—</Text>
          )}
        </Table.Td>
      )}

      {showReason && (
        <Table.Td>
          {activeStatus ? (
            canEndStatus ? (
              <Button
                size="xs"
                variant="light"
                color="orange"
                leftSection={<IconPlayerStop size={12} />}
                onClick={() => onEndStatus?.(activeStatus)}
                disabled={endDisabled}
              >
                End status
              </Button>
            ) : (
              <Text size="xs" c="dimmed">Only owner or manager</Text>
            )
          ) : (
            <Text size="xs" c="dimmed">—</Text>
          )}
        </Table.Td>
      )}

      {queues.map((q) => {
        const isIn  = agent.queue_opt_in?.[q] === true;
        const known = agent.queue_opt_in && q in agent.queue_opt_in;
        return (
          <Table.Td key={q} style={{ textAlign: "center" }}>
            {!known ? (
              <Text size="xs" c="dimmed">—</Text>
            ) : isIn ? (
              <Badge size="xs" color="green" variant="light">In</Badge>
            ) : (
              <Badge size="xs" color="gray" variant="light">Out</Badge>
            )}
          </Table.Td>
        );
      })}
    </Table.Tr>
  );
}

// Suppress unused import warnings
void ZOOM_STATUS_LABELS;
