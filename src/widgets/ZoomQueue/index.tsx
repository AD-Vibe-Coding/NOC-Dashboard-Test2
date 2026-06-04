import { useEffect, useMemo, useRef, useState } from "react";
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
  IconCalendarClock,
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
import { defaultRoleFor } from "../../lib/roles";

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

const REMINDER_DELAY_MS = 5 * 60_000; // 5 min timer; combined with 10 min grace = 15 min total before first queue reminder
const SHIFT_GRACE_MINUTES = 10; // Don't remind in first/last 10 min of shift; combined with 5-min timer = 15 min total before first reminder
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

function isWithinShiftWindow(nowMin: number, shift: ShiftWindow): boolean {
  if (shift.end === shift.start) return true;
  if (shift.end > shift.start) return nowMin >= shift.start && nowMin <= shift.end;
  return nowMin >= shift.start || nowMin <= shift.end;
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

    // Block if the person already has an active break/status
    const alreadyActive = activeBreaks.find((b) => samePerson(b.employee_name, trimmed));
    if (alreadyActive) {
      showToast({
        color: "red",
        title: "Break already active",
        body: `${trimmed} already has an active "${alreadyActive.break_type}" status. End it first before starting a new one.`,
      });
      return;
    }

    // Lunch break limit — max 2 non-managers on Lunch at a time
    if (statusType === "Lunch") {
      const lunchCount = activeBreaks.filter((b) => b.break_type === "Lunch" && defaultRoleFor(b.employee_name) !== "manager").length;
      if (lunchCount >= 2) {
        showToast({
          color: "red",
          title: "Lunch limit reached",
          body: `${lunchCount} people are already on Lunch. Max 2 allowed at a time. Please wait for someone to return before going on Lunch.`,
        });
        return;
      }
    }

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
  const nowMinPacific = nowMinutesPacific();

  function isActuallyInShift(name: string, displayName?: string) {
    if (!rosterData) return true; // still loading
    const unconstrained =
      !rosterData.strategy ||
      rosterData.strategy === "unconfigured" ||
      rosterData.strategy === "error" ||
      rosterData.strategy === "fallback-all-listed" ||
      rosterData.strategy === "no-column-match" ||
      rosterData.strategy === "published-calendar-no-column" ||
      rosterData.strategy === "published-csv-unmatched" ||
      rosterData.strategy === "empty";
    if (unconstrained) return true;

    const normalizedName = normName(name);
    const normalizedDisplay = normName(displayName ?? name);
    const shiftWindow = shiftWindowMap.get(normalizedName) ?? shiftWindowMap.get(normalizedDisplay);
    if (shiftWindow) return isWithinShiftWindow(nowMinPacific, shiftWindow);
    // Also try the fuzzy nameMatch used by useRosterShift for consistency
    return inShiftNowSet.has(normalizedName) || inShiftNowSet.has(normalizedDisplay)
      || (rosterData.inShiftNow ?? []).some((s) => {
        const ns = normName(s);
        return ns.includes(normalizedName) || normalizedName.includes(ns);
      });
  }

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
    // isRosterListed intentionally NOT used here — being on the team ≠ being in shift.
    // We only show agents who are in shift, actively in queue, or on an active break.
    return isInShift(name) || a.status === "in_queue" || breakMap.has(normName(name));
  });
  // All people on break — used for DISPLAY only (includes managers so they show in the break section)
  const onBreakFromZoom = agents.filter((a) => breakMap.has(normName(a.rosterName ?? a.display_name)));
  // Break Tracker entries not in Zoom — for display only (includes managers)
  const onBreakExtraNames = activeBreaks
    .filter((b) => {
      const resolved = normName(resolveTeamMember(b.employee_name) ?? b.employee_name);
      return !onBreakFromZoom.some((a) => normName(a.rosterName ?? a.display_name) === resolved);
    })
    .map((b) => b.employee_name);
  const onBreak = onBreakFromZoom;

  // Non-manager break lists — used for ALL logic (lunch limit, break count badge, reminders)
  const onBreakNonManager = onBreakFromZoom.filter((a) => {
    const name = a.rosterName ?? a.display_name;
    return defaultRoleFor(name) !== "manager";
  });
  const onBreakExtraNonManager = activeBreaks
    .filter((b) => {
      const resolved = normName(resolveTeamMember(b.employee_name) ?? b.employee_name);
      if (defaultRoleFor(resolveTeamMember(b.employee_name) ?? b.employee_name) === "manager") return false;
      return !onBreakFromZoom.some((a) => normName(a.rosterName ?? a.display_name) === resolved);
    })
    .map((b) => b.employee_name);
  const inShiftAndInQueue = agents.filter((a) => {
    const name = a.rosterName ?? a.display_name;
    return a.status === "in_queue" && (isInShift(name) || isRosterListed(name));
  });
  const inShiftNotInQueue = agents.filter((a) => {
    const name = a.rosterName ?? a.display_name;
    const normalizedName = normName(name);
    const displayNormalized = normName(a.display_name);
    const hasBreak = breakMap.has(normalizedName) || breakMap.has(displayNormalized);
    return a.status !== "in_queue" && isActuallyInShift(name, a.display_name) && !hasBreak;
  });

  // Group labels added to LOCKED_TEAM_NAMES for dropdowns — exclude from queue view
  const GROUP_LABELS = new Set(["Team", "NOC Seniors"]);

  // Synthetic entries: roster members who are in shift but not in Zoom data at all
  // (e.g. not logged in to the Zoom Phone client)
  // Exclude anyone who already has an active break — they belong in "On break" only.
  const syntheticNotInQueue: Array<ZoomAgent & { rosterName?: string | null }> = LOCKED_TEAM_NAMES
    .filter((canonicalName) => {
      if (GROUP_LABELS.has(canonicalName)) return false; // skip group labels
      if (!isInShift(canonicalName)) return false; // not in shift
      if (breakMap.has(normName(canonicalName))) return false; // already on break → show in "On break" only
      // Skip if already present in allAgents (matched by resolved name)
      return !allAgents.some((a) => {
        const resolved = a.rosterName ?? a.display_name;
        return normName(resolved) === normName(canonicalName);
      });
    })
    .map((canonicalName) => ({
      agent_id: `synthetic:${canonicalName}`,
      display_name: canonicalName,
      status: "not_in_queue" as const,
      queues: [],
      queue_opt_in: {},
      rosterName: canonicalName,
    }));

  const inShiftNotInQueueAll = [...inShiftNotInQueue, ...syntheticNotInQueue];

  const currentShiftAgents = agents.filter((a) => {
    const name = a.rosterName ?? a.display_name;
    return isActuallyInShift(name, a.display_name);
  });
  const currentShiftCount = currentShiftAgents.length + syntheticNotInQueue.length;
  const pct = currentShiftCount > 0 ? Math.round((inShiftAndInQueue.length / currentShiftCount) * 100) : 0;

  // Per-queue counts
  const allQueues = TRACKED_QUEUES.filter((q) =>
    agents.some((a) => a.queue_opt_in && q in a.queue_opt_in),
  );
  const queueCounts = Object.fromEntries(
    allQueues.map((q) => [q, agents.filter((a) => a.queue_opt_in?.[q] === true).length]),
  );

  // Break count for badges/logic uses non-manager list only
  const onBreakCount = onBreakNonManager.length + onBreakExtraNonManager.length;

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

  // ── Stable refs ──────────────────────────────────────────────────────────────
  // The reminder tick must run on a STABLE interval (not re-mount on every Zoom
  // poll). We achieve this by keeping all frequently-changing values in refs and
  // having the useEffect depend on nothing ([] deps = mounts once).
  const tickRunningRef         = useRef(false);
  const dataRef                = useRef(data);
  const rosterDataRef          = useRef(rosterData);
  const allAgentsRef           = useRef(allAgents);
  const syntheticRef           = useRef(syntheticNotInQueue);
  const shiftWindowMapRef      = useRef(shiftWindowMap);
  const activeStatusMapRef     = useRef(activeStatusMap);
  const inShiftNowSetRef       = useRef(inShiftNowSet);
  const breakHistoryRef        = useRef(breakHistory);

  // Keep refs in sync on every render (no interval restart needed)
  dataRef.current           = data;
  rosterDataRef.current     = rosterData;
  allAgentsRef.current      = allAgents;
  syntheticRef.current      = syntheticNotInQueue;
  shiftWindowMapRef.current = shiftWindowMap;
  activeStatusMapRef.current = activeStatusMap;
  inShiftNowSetRef.current  = inShiftNowSet;
  breakHistoryRef.current   = breakHistory;

  useEffect(() => {
    const tick = async () => {
      // Read latest values from refs — never stale, never causes re-mount
      const data         = dataRef.current;
      const rosterData   = rosterDataRef.current;
      const allAgents    = allAgentsRef.current;
      const synthetic    = syntheticRef.current;
      const shiftWinMap  = shiftWindowMapRef.current;
      const activeStatMap = activeStatusMapRef.current;
      const inShiftSet   = inShiftNowSetRef.current;
      const brkHistory   = breakHistoryRef.current;

      if (!data || !rosterData) return;

      // If a previous tick is still running, skip this one entirely
      if (tickRunningRef.current) return;
      tickRunningRef.current = true;

      try {
        const now = Date.now();
        const nowMin = nowMinutesPacific();
        const todayKey = todayPacificIso();
        const nextQueueState = readReminderState();
        const nextMeetingState = readMeetingReminderState();
        const nextBreakState = readBreakReminderState();
        const trackedQueueKeys = new Set<string>();
        const trackedMeetingKeys = new Set<string>();
        const trackedBreakKeys = new Set<string>();

        const recentReminderRows = await db.reminder_events.list({
          orderBy: { column: "created_at", ascending: false },
          limit: 200,
        });

        // Convert UTC sent_at → Pacific date for correct deduplication
        // (avoids double-firing near midnight when UTC ≠ Pacific date)
        const sentReminderKeys = new Set(
          recentReminderRows
            .filter((row) => {
              const pacificDate = new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/Los_Angeles",
                year: "numeric", month: "2-digit", day: "2-digit",
              }).format(new Date(row.sent_at));
              return pacificDate === todayKey;
            })
            .map((row) => row.dedupe_key),
        );

        // Deduplicate agents by normalized name — a person in both NOC and Mobility
        // queues would otherwise trigger one reminder per queue membership.
        // Synthetic agents (in roster but not in Zoom) are included so they also
        // get queue reminders.
        const seenAgentNames = new Set<string>();
        const uniqueAgents = [...allAgents, ...synthetic].filter((a) => {
          const key = normName(a.rosterName ?? a.display_name);
          if (seenAgentNames.has(key)) return false;
          seenAgentNames.add(key);
          return true;
        });

        console.debug(`[ReminderTick] ${new Date().toLocaleTimeString()} — checking ${uniqueAgents.length} agents | nowMin=${nowMin} | today=${todayKey}`);

        for (const agent of uniqueAgents) {
          const name = agent.rosterName ?? agent.display_name;
          const normalized = normName(name);

          // Managers are NEVER reminded about the call queue or break status
          if (defaultRoleFor(name) === "manager") continue;

          const shiftWindow  = shiftWinMap.get(normalized);
          const activeStatus = activeStatMap.get(normalized);

          console.debug(
            `[ReminderTick] ${name} | norm="${normalized}" | status=${agent.status}` +
            ` | shift=${shiftWindow ? `${shiftWindow.start}-${shiftWindow.end}` : "NOT FOUND"}` +
            ` | inShiftSet=${inShiftSet.has(normalized)}` +
            ` | activeStatus=${activeStatus?.break_type ?? "none"}` +
            ` | inShiftForReminder=${shiftWindow ? isWithinReminderWindow(nowMin, shiftWindow) : inShiftSet.has(normalized)}`
          );

          const queueReminderKey      = shiftWindow
            ? `${normalized}:${shiftWindow.start}:${shiftWindow.end}`
            : `${normalized}:no-shift`;
          const queueReminderDedupeKey = `queue:${todayKey}:${normalized}:${shiftWindow?.start ?? "none"}:${shiftWindow?.end ?? "none"}`;
          trackedQueueKeys.add(queueReminderKey);

          const activeBreakAgeMs    = activeStatus
            ? now - new Date(activeStatus.start_time).getTime()
            : null;
          const inBreakStartCooldown = activeBreakAgeMs !== null && activeBreakAgeMs < BREAK_START_QUEUE_COOLDOWN_MS;

          // Post-break cooldown: only count breaks that ended TODAY and within the last 5 min.
          // Without the today-filter, a break from a previous day at the same clock time
          // would silently suppress reminders every morning.
          const POST_BREAK_COOLDOWN_MS = 5 * 60_000;
          const lastEndedBreakToday = brkHistory
            .filter((b) => {
              if (!b.end_time) return false;
              const bName = normName(resolveTeamMember(b.employee_name) ?? b.employee_name);
              if (bName !== normalized) return false;
              // Must be today (Pacific)
              const endPacific = new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/Los_Angeles",
                year: "numeric", month: "2-digit", day: "2-digit",
              }).format(new Date(b.end_time));
              return endPacific === todayKey;
            })
            .sort((a, b) => new Date(b.end_time!).getTime() - new Date(a.end_time!).getTime())[0];
          const inPostBreakCooldown = lastEndedBreakToday
            ? (now - new Date(lastEndedBreakToday.end_time!).getTime()) < POST_BREAK_COOLDOWN_MS
            : false;

          // Determine if the person is currently "in shift":
          //   - If we have a precise shift window, use the 15-min grace-period check
          //   - Fallback: use the roster inShiftNow set (matched by name)
          const inShiftForReminder = shiftWindow
            ? isWithinReminderWindow(nowMin, shiftWindow)
            : inShiftSet.has(normalized);

          // Queue reminder fires if:
          // - currently within shift (with grace period)
          // - not already in queue
          // - no active break/meeting status
          // - not within 2-min cooldown after starting a break
          // - not within 5-min cooldown after a break just ended
          const isQueueEligible = inShiftForReminder
            && agent.status !== "in_queue"
            && !activeStatus
            && !inBreakStartCooldown
            && !inPostBreakCooldown;

          console.debug(
            `[ReminderTick] ${name} | isQueueEligible=${isQueueEligible}` +
            ` | inBreakCooldown=${inBreakStartCooldown} | inPostBreakCooldown=${inPostBreakCooldown}`
          );

          if (!isQueueEligible) {
            delete nextQueueState[queueReminderKey];
          } else {
            const existing = nextQueueState[queueReminderKey];
            if (!existing) {
              console.debug(`[ReminderTick] ${name} — started eligibility timer (will fire in ${REMINDER_DELAY_MS/60000} min)`);
              nextQueueState[queueReminderKey] = { eligibleSince: now, reminded: false };
            } else if (
              !existing.reminded &&
              now - existing.eligibleSince >= REMINDER_DELAY_MS &&
              !sentReminderKeys.has(queueReminderDedupeKey)
            ) {
              console.debug(`[ReminderTick] ${name} — firing QUEUE reminder`);
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
              } catch (err) {
                console.warn(`[ReminderTick] queue reminder failed for ${name}:`, err);
              }
            }
          }

          if (activeStatus && !Object.values(agent.queue_opt_in ?? {}).some(Boolean)) {
            if (MEETING_TYPES.has(activeStatus.break_type)) {
              const meetingReminderKey = `${normalized}:${activeStatus.id}:${activeStatus.start_time}`;
              trackedMeetingKeys.add(meetingReminderKey);
              const entry = nextMeetingState[meetingReminderKey] ?? { sentSteps: [] };
              const startedAt = new Date(activeStatus.start_time).getTime();
              const elapsed   = now - startedAt;

              for (const step of MEETING_REMINDER_STEPS_MS) {
                const meetingDedupeKey = `meeting:${todayKey}:${normalized}:${activeStatus.id}:${step}`;
                if (elapsed >= step && !entry.sentSteps.includes(step) && !sentReminderKeys.has(meetingDedupeKey)) {
                  console.debug(`[ReminderTick] ${name} — firing MEETING reminder (step ${step / 60000}min)`);
                  try {
                    await postSlackMessage(
                      `${name} - If you are done with the meeting, please turn on the call queue.`,
                      { username: "Queue Reminder", icon_emoji: ":spiral_calendar_pad:" },
                    );
                    await db.reminder_events.insert({
                      employee_name: name,
                      reminder_type: "meeting",
                      dedupe_key: meetingDedupeKey,
                      sent_at: new Date().toISOString(),
                    });
                    sentReminderKeys.add(meetingDedupeKey);
                    entry.sentSteps.push(step);
                  } catch (err) {
                    console.warn(`[ReminderTick] meeting reminder failed for ${name}:`, err);
                  }
                }
              }
              nextMeetingState[meetingReminderKey] = entry;
            }

            if (BREAK_ONLY_TYPES.has(activeStatus.break_type)) {
              const breakReminderKey  = `${normalized}:${activeStatus.id}:${activeStatus.start_time}`;
              trackedBreakKeys.add(breakReminderKey);
              const entry      = nextBreakState[breakReminderKey] ?? { reminded: false };
              const startedAt  = new Date(activeStatus.start_time).getTime();
              const elapsed    = now - startedAt;
              const threshold  = activeStatus.break_type === "Lunch" ? LUNCH_REMINDER_MS : OTHER_BREAK_REMINDER_MS;
              const breakDedupeKey = `break:${todayKey}:${normalized}:${activeStatus.id}`;

              if (!entry.reminded && elapsed >= threshold && !sentReminderKeys.has(breakDedupeKey)) {
                console.debug(`[ReminderTick] ${name} — firing BREAK reminder`);
                try {
                  await postSlackMessage(
                    `${name} - If you are still on break, please update your status. If not, please turn on the call queue.`,
                    { username: "Queue Reminder", icon_emoji: ":coffee:" },
                  );
                  await db.reminder_events.insert({
                    employee_name: name,
                    reminder_type: "break",
                    dedupe_key: breakDedupeKey,
                    sent_at: new Date().toISOString(),
                  });
                  sentReminderKeys.add(breakDedupeKey);
                  entry.reminded = true;
                } catch (err) {
                  console.warn(`[ReminderTick] break reminder failed for ${name}:`, err);
                }
              }
              nextBreakState[breakReminderKey] = entry;
            }
          }
        }

        // Prune stale keys
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
      } finally {
        tickRunningRef.current = false;
      }
    };

    // Fire once immediately, then every 60 seconds
    // The interval is STABLE — it never re-mounts when Zoom data refreshes (every 15s)
    // because this effect has no dependencies. Latest values are read from refs inside tick().
    void tick();
    const id = window.setInterval(() => { void tick(); }, 60_000);
    return () => window.clearInterval(id);
  }, []); // ← intentionally empty: stable interval, reads latest state via refs

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
                {(() => {
                  const alreadyActive = effectiveName ? activeBreaks.find((b) => samePerson(b.employee_name, effectiveName)) : null;
                  return (
                    <Tooltip label={alreadyActive ? `End current "${alreadyActive.break_type}" status first` : ""} disabled={!alreadyActive} withArrow>
                      <Button
                        fullWidth
                        leftSection={<IconPlayerPlay size={14} />}
                        onClick={startStatus}
                        loading={posting}
                        disabled={!effectiveName || !statusType || !ready || posting || !!alreadyActive}
                        size="sm"
                        color={alreadyActive ? "gray" : undefined}
                      >
                        Update status
                      </Button>
                    </Tooltip>
                  );
                })()}
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
                    <Text size="xs" c="dimmed">· {inShiftNotInQueueAll.length} not in queue</Text>
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
                    <Text size="xs" c="dimmed">· {inShiftNotInQueueAll.length} not in queue</Text>
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
              <Badge size="sm" color="gray" variant="filled" circle>{inShiftNotInQueueAll.length}</Badge>
              {onBreakCount > 0 && (
                <Badge size="xs" color="orange" variant="light">
                  {onBreakCount} on break
                </Badge>
              )}
            </Group>
            <Divider />
            {inShiftNotInQueueAll.length === 0 ? (
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
                    {inShiftNotInQueueAll.map((a) => (
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
            <Badge size="sm" color="orange" variant="filled" circle>{onBreak.length + onBreakExtraNames.length}</Badge>
          </Group>
          <Divider />
          {onBreak.length === 0 && onBreakExtraNames.length === 0 ? (
            <Text size="xs" c="dimmed" ta="center" py="lg">No team members are currently on break</Text>
          ) : (
            <ScrollArea.Autosize mah={300}>
              <Table striped highlightOnHover withRowBorders={false} verticalSpacing="xs" horizontalSpacing="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Agent</Table.Th>
                    <Table.Th>Reason</Table.Th>
                    <Table.Th>Duration</Table.Th>
                    <Table.Th>Action</Table.Th>
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
                  {/* Break Tracker members not matched to a Zoom agent — show them here too */}
                  {onBreakExtraNames.map((employeeName) => {
                    const breakRow = activeBreaks.find((b) => b.employee_name === employeeName);
                    if (!breakRow) return null;
                    const startedMs = new Date(breakRow.start_time).getTime();
                    const elapsedMin = Math.round((Date.now() - startedMs) / 60000);
                    return (
                      <Table.Tr key={`extra-${employeeName}`}>
                        <Table.Td>
                          <Group gap="xs" wrap="nowrap">
                            <ThemeIcon size="sm" color="orange" variant="light" radius="xl">
                              <IconCoffee size={12} />
                            </ThemeIcon>
                            <Text size="sm" fw={600}>{employeeName}</Text>
                            <Badge size="xs" variant="dot" color="gray">tracker only</Badge>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Badge size="sm" color="orange" variant="light">
                            {BREAK_EMOJI[breakRow.break_type] ?? "⏸️"} {breakRow.break_type}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">{elapsedMin}m</Text>
                        </Table.Td>
                        <Table.Td>
                          {(isManager || identity?.name?.trim() === employeeName.trim()) && (
                            <Button size="compact-xs" variant="light" color="orange" leftSection={<IconPlayerStop size={12} />}
                              onClick={() => void endStatus(breakRow)} disabled={posting}>
                              End
                            </Button>
                          )}
                        </Table.Td>
                        {allQueues.map((q) => (
                          <Table.Td key={q} style={{ textAlign: "center" }}>—</Table.Td>
                        ))}
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}
        </Card>

        {/* ── Roster: who is currently on shift ── */}
        {isManager && (() => {
          const rd = rosterData;
          const rosterOk = rd && !["unconfigured","error","no-column-match","published-calendar-no-column","no-data","empty"].includes(rd.strategy ?? "");
          const inShiftList = rd?.inShiftNow ?? [];
          const diag = rd?.diagnostics;

          return (
            <Card withBorder radius="md" p={0} style={{ borderTop: "3px solid var(--mantine-color-teal-6)" }}>
              <Group px="md" py="sm" gap="xs">
                <ThemeIcon size="sm" variant="light" color="teal" radius="xl">
                  <IconCalendarClock size={13} />
                </ThemeIcon>
                <Text fw={600} size="sm">Roster — on shift now</Text>
                {rosterOk
                  ? <Badge size="sm" color="teal" variant="filled" circle>{inShiftList.length}</Badge>
                  : <Badge size="sm" color="yellow" variant="light">roster not resolving</Badge>
                }
                {diag && (
                  <Text size="xs" c="dimmed" ml="auto">{diag.currentTimePST} · col {diag.matchedCol > 0 ? diag.matchedCol : "not found"}</Text>
                )}
              </Group>
              <Divider />
              {!rosterOk ? (
                <Stack gap="xs" p="md">
                  {rd?.strategy === "unconfigured" ? (
                    <Text size="xs" c="dimmed">
                      Service account not configured. Set <code>GOOGLE_SERVICE_ACCOUNT_EMAIL</code> and <code>GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY</code> to enable live roster data.
                    </Text>
                  ) : rd?.strategy === "error" ? (
                    <Text size="xs" c="red">{rd.error}</Text>
                  ) : (
                    <>
                      <Text size="xs" c="yellow">
                        Roster fetched but today&apos;s date column not found in the sheet.
                        {rd?.strategy === "published-calendar-no-column"
                          ? " The published CSV is pointing to the wrong tab (May). Set up the Google service account to auto-detect Jun'26."
                          : ""}
                      </Text>
                      {diag && (
                        <Text size="xs" c="dimmed" ff="monospace">
                          Looking for: <strong>{diag.todayLabel}</strong> · Headers seen: [{diag.headersPreview.slice(0, 8).filter(Boolean).join(", ")}]
                        </Text>
                      )}
                    </>
                  )}
                </Stack>
              ) : inShiftList.length === 0 ? (
                <Text size="xs" c="dimmed" ta="center" py="md">No one is currently scheduled in the roster for this time</Text>
              ) : (
                <ScrollArea.Autosize mah={200}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 16px" }}>
                    {inShiftList.map((name) => {
                      const sw = rosterData?.shiftWindows?.find((w) => normName(w.name) === normName(name));
                      return (
                        <Badge key={name} size="sm" variant="light" color="teal" title={sw ? `${sw.cell}` : undefined}>
                          {name}{sw ? ` · ${sw.cell}` : ""}
                        </Badge>
                      );
                    })}
                  </div>
                </ScrollArea.Autosize>
              )}
            </Card>
          );
        })()}

        {data && (
          <Text size="xs" c="dimmed" ta="right">
            {currentShiftCount} in shift (Zoom) · roster: {rosterData?.inShiftNow.length ?? "?"} · refreshed {new Date(data.fetched_at).toLocaleTimeString()}
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
  const isSynthetic = agent.agent_id.startsWith("synthetic:");

  return (
    <Table.Tr>
      <Table.Td>
        <Stack gap={4}>
          <Group gap="xs" wrap="nowrap">
            <Badge size="xs" variant="dot" color={isSynthetic ? "orange" : ZOOM_STATUS_COLORS[agent.status]} />
            <Text size="sm" fw={500}>{canonicalName ?? agent.display_name}</Text>
            {isSynthetic && <Badge size="xs" color="orange" variant="light">Not in Zoom</Badge>}
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
