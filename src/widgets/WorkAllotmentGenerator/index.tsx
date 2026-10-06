import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  NumberInput,
  ScrollArea,
  Stack,
  Table,
  Tabs,
  Text,
} from "@mantine/core";
import {
  IconClipboardList,
  IconScale,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { WorkAllotmentGeneratorTile } from "./Tile";
import { useIdentity } from "../../lib/identity";
import { ROLE_BY_NAME, ROSTER_BY_EMAIL, defaultRoleFor } from "../../lib/roles";
import { db } from "../../db";
import {
  DEFAULT_MEMBER_NAMES,
  getCurrentMonthKey,
  getDateKeyForMonthDay,
  getDaysInMonth,
  getMonthLabel,
  isExcludedFairnessMember,
  loadTrackerStore,
  saveTrackerStore,
  type ScheduledPostRow,
} from "./tracker";

export { WorkAllotmentGeneratorTile };

function canonicalWorkAllotmentMemberName(name: string) {
  const normalized = String(name ?? "").trim();
  if (normalized === "Abishek Benarji") return "Abhishek Benarji";
  if (normalized === "Hamza Umme") return "Hamza Rahmani";
  if (normalized === "Lokesh Banavath") return "Lokesh Naik Banavath";
  if (normalized === "Zubair Mohammed") return "Mohammed Zubairuddin";
  if (normalized === "Ashraf Mohammed") return "Mohammed Ashraf";
  if (normalized === "Mohammed Akram Ahmed") return "Akram Ahmed";
  return normalized;
}

function isVisibleWorkAllotmentMember(name: string) {
  const normalized = canonicalWorkAllotmentMemberName(name);
  if (!normalized || isExcludedFairnessMember(normalized)) return false;
  const role = defaultRoleFor(normalized);
  return role === "tier1" || role === "tier2" || role === "tier3";
}

interface ShiftPlanResult {
  status: "ok" | "no_post";
  slot: string;
  message: string;
  primary?: string | null;
  backup?: string | null;
  nextPrimary?: string | null;
  nextPostTime?: string | null;
  primaryShiftCode?: string | null;
  dateKey?: string;
  continuingFrom?: string | null;
  carryPathUsed?: string | null;
  carryPathRule?: string | null;
  fairnessBefore?: number;
  fairnessAfter?: number;
  fairnessDelta?: number;
  availableMembers?: Array<{ name: string; shiftCode?: string | null }>;
}

interface FairnessUpdate {
  name: string;
  before: number;
  after: number;
  delta: number;
  row: number | null;
  column: number | null;
  sheetName: string;
  dateKey: string;
}

interface FairnessGroupMember {
  name: string;
  workedDays: number;
  rosterFairnessCount: number;
  rosterFairnessHours: number;
  trackerHours: number;
  fairnessUnits: number;
  fairnessScore: number;
  shiftBreakdown: Array<{ code: string; count: number }>;
}

interface FairnessGroupSummary {
  key: string;
  label: string;
  shiftLabels: string[];
  shiftCodes: string[];
  highestCount: number;
  members: FairnessGroupMember[];
}

interface CombinedFairnessMember extends FairnessGroupMember {
  groupKey: string;
  groupLabel: string;
  groupShiftLabels: string[];
}

interface FairnessSummary {
  monthKey: string;
  sheetTitle: string;
  groups: FairnessGroupSummary[];
  combinedMembers: CombinedFairnessMember[];
}

interface DayPlanResult {
  status: "ok";
  dateKey: string;
  rosterSheet: string;
  fairnessSheet: string;
  fairnessWarning?: string | null;
  fairnessSummary?: FairnessSummary;
  shifts: ShiftPlanResult[];
  fairnessUpdates: FairnessUpdate[];
  appliedFairnessUpdates?: FairnessUpdate[];
  tracker?: {
    scheduledPosts: ScheduledPostRow[];
    memberNames: string[];
    monthKey: string;
    rosterMonthSheet?: string;
    fairnessSheetTitle?: string;
    fairnessSpreadsheetUrl?: string;
  };
}

interface GeneratorResponse {
  ok: boolean;
  config: {
    rosterSpreadsheetId: string;
    slackChannelId: string;
    slackChannelName: string;
    timeZone: string;
    fairnessTrackerMode: string;
    fairnessTrackerName: string;
    memberNames: string[];
  };
  result: DayPlanResult;
}

interface WorkAllotmentJobStatus {
  id: number;
  operational_date: string;
  post_date: string;
  shift: string;
  primary?: string | null;
  backup?: string | null;
  status: string;
  slack_ts?: string | null;
  last_error?: string | null;
  post_time_label?: string | null;
  posted_at?: string | null;
  generated_at?: string | null;
  message?: string | null;
  continuing_from?: string | null;
  carry_path_used?: string | null;
  carry_path_rule?: string | null;
}

interface WorkAllotmentAutomationRun {
  id?: number;
  action: string;
  ran_at: string;
  generation_triggered?: boolean | null;
  generation_skipped?: boolean | null;
  due_count?: number | null;
  posted_count?: number | null;
  failure_count?: number | null;
  note?: string | null;
}

interface OwnershipTask {
  id: number | string;
  operational_date: string;
  assignee_name: string;
  title: string;
  details?: string | null;
  source_shift?: string | null;
  status: string;
  completed_at?: string | null;
  last_reminded_at?: string | null;
  reminder_count?: number | null;
}

interface WorkAllotmentStatusResult {
  ok: true;
  operationalDate: string;
  generationWindow: boolean;
  jobCount: number;
  postedCount: number;
  plannedCount: number;
  jobs: WorkAllotmentJobStatus[];
  recent: WorkAllotmentJobStatus[];
  latestRun?: WorkAllotmentAutomationRun | null;
  latestCronRun?: WorkAllotmentAutomationRun | null;
  latestManualRun?: WorkAllotmentAutomationRun | null;
  fairnessSummary?: FairnessSummary | null;
  fairnessTracker?: {
    monthKey: string;
    rosterMonthSheet?: string;
    fairnessSheetTitle?: string;
    fairnessSpreadsheetUrl?: string;
  } | null;
  fairnessWarning?: string | null;
}

type WorkAllotmentAsrhHoursRow = Awaited<ReturnType<typeof db.work_allotment_asrh_hours.list>>[number];

function formatTimestamp(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  }).format(parsed);
}

function isManagerIdentity(identity: ReturnType<typeof useIdentity>["identity"]) {
  if (!identity) return false;
  if (identity.role === "manager") return true;
  const canonicalByName = identity.name ? ROLE_BY_NAME[identity.name.trim()] : undefined;
  if (canonicalByName === "manager") return true;
  const canonicalByEmail = identity.email
    ? ROSTER_BY_EMAIL[identity.email.trim().toLowerCase()]?.role
    : undefined;
  return canonicalByEmail === "manager";
}

function formatAvailableMembers(members: Array<{ name: string; shiftCode?: string | null }> = []) {
  return members
    .map((member) => (member.shiftCode ? `${member.name} (${normalizeVisibleShiftCode(member.shiftCode)})` : member.name))
    .join(", ");
}

function formatMonthLabel(monthKey?: string | null) {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return "Current month";
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function normalizeVisibleShiftCode(slot?: string | null) {
  if (!slot) return "—";
  return slot === "S5.1" ? "S6" : slot;
}

function formatVisibleShiftLabel(slot?: string | null) {
  return normalizeVisibleShiftCode(slot);
}

function formatVisibleShiftList(value?: string | null) {
  if (!value) return "—";
  return value
    .split(",")
    .map((part) => normalizeVisibleShiftCode(part.trim()))
    .filter(Boolean)
    .join(", ");
}

const FAIRNESS_GROUP_DISPLAY_ORDER: Record<string, number> = {
  "overnight-early": 0,
  "day-swing": 1,
  "late-evening": 2,
};

export function WorkAllotmentGeneratorWidget() {
  const { identity } = useIdentity();
  const isManager = isManagerIdentity(identity);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<GeneratorResponse | null>(null);
  const [automationStatus, setAutomationStatus] = useState<WorkAllotmentStatusResult | null>(null);
  const [managerOwnershipTasks, setManagerOwnershipTasks] = useState<OwnershipTask[]>([]);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPostRow[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>("allotments");
  const [asrhRows, setAsrhRows] = useState<WorkAllotmentAsrhHoursRow[]>([]);
  const [asrhDraftRows, setAsrhDraftRows] = useState<WorkAllotmentAsrhHoursRow[]>([]);
  const asrhDraftRowsRef = useRef<WorkAllotmentAsrhHoursRow[]>([]);
  const [asrhLoading, setAsrhLoading] = useState(false);
  const [asrhSaving, setAsrhSaving] = useState(false);
  const [asrhSaveNotice, setAsrhSaveNotice] = useState<string | null>(null);

  const currentMonthKey = getCurrentMonthKey();
  const memberNames = useMemo(() => {
    const fromApi = data?.config.memberNames ?? [];
    return Array.from(new Set([...DEFAULT_MEMBER_NAMES, ...fromApi].map((name) => canonicalWorkAllotmentMemberName(name))))
      .filter((name) => isVisibleWorkAllotmentMember(name))
      .sort((a, b) => a.localeCompare(b));
  }, [data?.config.memberNames]);

  useEffect(() => {
    const stored = loadTrackerStore(currentMonthKey);
    setScheduledPosts(stored.scheduledPosts);
  }, [currentMonthKey]);

  function persistScheduledPosts(nextPosts: ScheduledPostRow[]) {
    saveTrackerStore({ monthKey: currentMonthKey, fairnessEntries: [], scheduledPosts: nextPosts });
    setScheduledPosts(nextPosts);
  }

  function setAsrhDraftRowsSynced(nextRows: WorkAllotmentAsrhHoursRow[] | ((current: WorkAllotmentAsrhHoursRow[]) => WorkAllotmentAsrhHoursRow[])) {
    setAsrhDraftRows((current) => {
      const resolved = typeof nextRows === "function"
        ? (nextRows as (current: WorkAllotmentAsrhHoursRow[]) => WorkAllotmentAsrhHoursRow[])(current)
        : nextRows;
      asrhDraftRowsRef.current = resolved;
      return resolved;
    });
  }

  async function loadAsrhHoursTable(monthKeyToLoad = currentMonthKey) {
    if (!identity) return;
    setAsrhLoading(true);
    try {
      const rows = (await db.work_allotment_asrh_hours.list({
        filter: { month_key: monthKeyToLoad },
        orderBy: { column: "created_at", ascending: true },
      })).map((row) => ({
        ...row,
        member_name: canonicalWorkAllotmentMemberName(row.member_name),
      }));
      setAsrhRows(rows);
      asrhDraftRowsRef.current = rows;
      setAsrhDraftRows(rows);
    } finally {
      setAsrhLoading(false);
    }
  }

  async function saveAsrhHoursTable(nextRows: WorkAllotmentAsrhHoursRow[]) {
    if (!identity) return;
    setAsrhSaving(true);
    setAsrhSaveNotice(null);
    try {
      const normalizedExistingRows = asrhRows.map((row) => ({
        ...row,
        member_name: canonicalWorkAllotmentMemberName(row.member_name),
      }));
      const normalizedNextRows = nextRows
        .map((row) => ({
          ...row,
          member_name: canonicalWorkAllotmentMemberName(row.member_name),
          hours: Number(row.hours ?? 0),
        }))
        .filter((row) => Number.isFinite(row.hours) && row.hours > 0);

      const existingGroups = new Map<string, WorkAllotmentAsrhHoursRow[]>();
      for (const row of normalizedExistingRows) {
        const key = `${row.member_name}|${row.date_key}`;
        const group = existingGroups.get(key) ?? [];
        group.push(row);
        existingGroups.set(key, group);
      }

      const nextByKey = new Map<string, WorkAllotmentAsrhHoursRow>();
      for (const row of normalizedNextRows) {
        nextByKey.set(`${row.member_name}|${row.date_key}`, row);
      }

      for (const [key, existingGroup] of existingGroups.entries()) {
        const next = nextByKey.get(key);
        const sortedExisting = [...existingGroup].sort((a, b) => Number(a.id) - Number(b.id));
        if (!next) {
          for (const existing of sortedExisting) {
            await db.work_allotment_asrh_hours.deleteById(Number(existing.id));
          }
          continue;
        }

        const [keeper, ...duplicates] = sortedExisting;
        if (Number(keeper.hours ?? 0) !== Number(next.hours ?? 0)
          || String(keeper.notes ?? "") !== String(next.notes ?? "")
          || String(keeper.source ?? "") !== String(next.source ?? "")) {
          await db.work_allotment_asrh_hours.updateById(Number(keeper.id), {
            hours: Number(next.hours ?? 0),
            notes: next.notes ?? null,
            source: next.source ?? "manual",
            updated_by: identity.name,
          });
        }
        for (const duplicate of duplicates) {
          await db.work_allotment_asrh_hours.deleteById(Number(duplicate.id));
        }
      }

      const inserts = normalizedNextRows
        .filter((row) => !existingGroups.has(`${row.member_name}|${row.date_key}`))
        .map((row) => ({
          month_key: row.month_key,
          date_key: row.date_key,
          member_name: row.member_name,
          hours: Number(row.hours ?? 0),
          source: row.source ?? "manual",
          notes: row.notes ?? null,
          updated_by: identity.name,
        }));

      if (inserts.length > 0) {
        await db.work_allotment_asrh_hours.insertBulk(inserts);
      }

      await loadAsrhHoursTable(activeAsrhMonthKey);
      const refreshedStatus = await loadStatus();
      if (refreshedStatus) {
        setData((current) => current ? ({
          ...current,
          result: {
            ...current.result,
            fairnessSummary: refreshedStatus.fairnessSummary ?? undefined,
            fairnessWarning: refreshedStatus.fairnessWarning ?? current.result.fairnessWarning ?? null,
            tracker: {
              ...(current.result.tracker ?? {
                scheduledPosts,
                memberNames,
                monthKey: refreshedStatus.fairnessTracker?.monthKey ?? activeAsrhMonthKey,
              }),
              monthKey: refreshedStatus.fairnessTracker?.monthKey ?? current.result.tracker?.monthKey ?? activeAsrhMonthKey,
              rosterMonthSheet: refreshedStatus.fairnessTracker?.rosterMonthSheet ?? current.result.tracker?.rosterMonthSheet,
              fairnessSheetTitle: refreshedStatus.fairnessTracker?.fairnessSheetTitle ?? current.result.tracker?.fairnessSheetTitle,
              fairnessSpreadsheetUrl: refreshedStatus.fairnessTracker?.fairnessSpreadsheetUrl ?? current.result.tracker?.fairnessSpreadsheetUrl,
            },
          },
        }) : current);
      }
      setAsrhSaveNotice(`Saved AS&RH hours table for ${getMonthLabel(activeAsrhMonthKey)} and refreshed the fairness tracker.`);
    } finally {
      setAsrhSaving(false);
    }
  }

  async function loadStatus() {
    if (!identity) return null;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const [statusResponse, handoffResponse] = await Promise.all([
        fetch(`/api/work-allotment/status`),
        isManager ? fetch(`/api/manager/ownership-tasks`, { credentials: "include" }) : Promise.resolve(null),
      ]);
      const statusJson = await statusResponse.json();
      if (!statusResponse.ok) throw new Error(statusJson.error ?? "Failed to load automation status.");
      const statusResult = (statusJson as { ok: boolean; result: WorkAllotmentStatusResult }).result;
      setAutomationStatus(statusResult);

      if (isManager && handoffResponse) {
        const handoffJson = await handoffResponse.json();
        if (!handoffResponse.ok) {
          throw new Error(handoffJson.error ?? "Failed to load handoff tasks.");
        }
        setManagerOwnershipTasks(handoffJson as OwnershipTask[]);
      } else {
        setManagerOwnershipTasks([]);
      }

      return statusResult;
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to load automation status.");
      return null;
    } finally {
      setStatusLoading(false);
    }
  }

  async function load() {
    if (!identity || !isManager) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/work-allotment/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledPosts, memberNames }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Failed to generate work allotment.");
      setData(json as GeneratorResponse);
      if ((json as GeneratorResponse).result?.tracker?.scheduledPosts) {
        persistScheduledPosts((json as GeneratorResponse).result.tracker?.scheduledPosts ?? []);
      }
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate work allotment.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshAutomation() {
    if (!identity) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const automationResponse = await fetch(`/api/work-allotment/automation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      });
      const automationJson = await automationResponse.json();
      if (!automationResponse.ok) {
        throw new Error(automationJson.error ?? "Failed to refresh work allotment automation.");
      }
      if (isManager) {
        await load();
      } else {
        await loadStatus();
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh work allotment automation.");
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!identity) return;
    if (isManager) {
      void load();
      return;
    }
    void loadStatus();
  }, [identity, isManager]);

  if (!identity) {
    return (
      <WidgetFrame title="Work Allotment Generator" subtitle="Sign in required" icon={IconClipboardList} iconColor="indigo">
        <Alert color="gray">Sign in with a manager account to generate or post the work allotment.</Alert>
      </WidgetFrame>
    );
  }

  const result = data?.result ?? null;
  const previewJobs = (result?.shifts ?? [])
    .filter((shift) => shift.status === "ok")
    .map((shift, index) => ({
      id: `preview-${shift.slot}-${index}`,
      operational_date: result?.dateKey ?? "",
      post_date: result?.dateKey ?? "",
      shift: shift.slot,
      primary: shift.primary ?? null,
      backup: shift.backup ?? null,
      status: "planned",
      slack_ts: null,
      last_error: null,
      post_time_label: shift.nextPostTime ?? null,
      posted_at: null,
      generated_at: null,
      message: shift.message ?? null,
      continuing_from: shift.continuingFrom ?? null,
      carry_path_used: shift.carryPathUsed ?? null,
      carry_path_rule: shift.carryPathRule ?? null,
    }));
  const displayJobs = previewJobs.length > 0 ? previewJobs : (automationStatus?.jobs ?? []);
  const readyShiftCount = result?.shifts?.filter((shift) => shift.status === "ok").length
    ?? automationStatus?.jobs?.length
    ?? 0;
  const fairnessSummary = result?.fairnessSummary ?? automationStatus?.fairnessSummary ?? null;
  const fairnessGroups = fairnessSummary?.groups ?? [];
  const activeAsrhMonthKey = automationStatus?.fairnessTracker?.monthKey
    ?? result?.tracker?.monthKey
    ?? fairnessSummary?.monthKey
    ?? currentMonthKey;
  const fairnessSourceTitle = result?.tracker?.fairnessSheetTitle
    ?? automationStatus?.fairnessTracker?.fairnessSheetTitle
    ?? fairnessSummary?.sheetTitle
    ?? result?.fairnessSheet
    ?? "—";
  const activeFairnessWarning = result?.fairnessWarning ?? automationStatus?.fairnessWarning ?? null;
  const latestCronActivity = automationStatus?.latestCronRun?.ran_at
    ?? ([...(automationStatus?.recent ?? [])]
      .map((job) => job.posted_at || job.generated_at || null)
      .find((value) => Boolean(value)) ?? null);
  const latestManualActivity = automationStatus?.latestManualRun?.ran_at ?? null;
  const s6Job = displayJobs.find((job) => String(job.shift ?? "") === "S6") ?? null;
  const fairnessSyncMessage = s6Job?.last_error || "";
  const fairnessSyncState = fairnessSyncMessage.toLowerCase().includes("failed")
    ? { label: "Fairness sync failed", color: "red" }
    : fairnessSyncMessage.toLowerCase().includes("skipped")
      ? { label: "Fairness sync skipped", color: "yellow" }
      : fairnessSyncMessage.toLowerCase().includes("synced")
        ? { label: "Fairness sync success", color: "green" }
        : { label: "Fairness sync pending", color: "gray" };
  const openHandoffTasks = managerOwnershipTasks.filter((task) => String(task.status ?? "") !== "completed");
  const completedHandoffTasks = managerOwnershipTasks.filter((task) => String(task.status ?? "") === "completed");
  const totalHandoffReminders = managerOwnershipTasks.reduce((sum, task) => sum + Number(task.reminder_count ?? 0), 0);
  const combinedFairnessMembers = [...(fairnessSummary?.combinedMembers ?? [])]
    .map((member) => ({ ...member, name: canonicalWorkAllotmentMemberName(member.name) }))
    .filter((member) => isVisibleWorkAllotmentMember(member.name))
    .sort((a, b) => {
      const orderDiff = (FAIRNESS_GROUP_DISPLAY_ORDER[a.groupKey] ?? 999) - (FAIRNESS_GROUP_DISPLAY_ORDER[b.groupKey] ?? 999);
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name);
    });
  const asrhDaysInMonth = getDaysInMonth(activeAsrhMonthKey);
  const asrhDayNumbers = Array.from({ length: asrhDaysInMonth }, (_, index) => index + 1);
  const asrhMemberNames = Array.from(new Set([
    ...combinedFairnessMembers.map((member) => canonicalWorkAllotmentMemberName(member.name)),
    ...memberNames.map((name) => canonicalWorkAllotmentMemberName(name)),
    ...asrhDraftRows.map((row) => canonicalWorkAllotmentMemberName(row.member_name)),
  ].filter((name) => isVisibleWorkAllotmentMember(String(name))))).sort((a, b) => a.localeCompare(b));
  const asrhCellMap = new Map(
    asrhDraftRows.map((row) => [`${canonicalWorkAllotmentMemberName(row.member_name)}|${row.date_key}`, { ...row, member_name: canonicalWorkAllotmentMemberName(row.member_name) }] as const),
  );

  useEffect(() => {
    if (!identity) return;
    void loadAsrhHoursTable(activeAsrhMonthKey);
  }, [identity, activeAsrhMonthKey]);

  function updateAsrhDraftCell(memberName: string, dateKey: string, hours: number) {
    const canonicalMemberName = canonicalWorkAllotmentMemberName(memberName);
    setAsrhDraftRowsSynced((current) => {
      const next = [...current];
      const index = next.findIndex((row) => canonicalWorkAllotmentMemberName(row.member_name) === canonicalMemberName && row.date_key === dateKey);
      const normalizedHours = Number.isFinite(hours) && hours > 0 ? Number(hours) : 0;
      if (index >= 0) {
        if (normalizedHours <= 0) {
          next.splice(index, 1);
        } else {
          next[index] = { ...next[index], hours: normalizedHours, month_key: activeAsrhMonthKey, source: next[index].source ?? "manual" };
        }
        return next;
      }
      if (normalizedHours <= 0) return next;
      next.push({
        id: `draft-${canonicalMemberName}-${dateKey}` as unknown as number,
        month_key: activeAsrhMonthKey,
        date_key: dateKey,
        member_name: canonicalMemberName,
        hours: normalizedHours,
        source: "manual",
        notes: null,
        updated_by: identity?.name ?? null,
        created_at: new Date().toISOString() as unknown as Date,
      });
      return next;
    });
  }

  const asrhDraftChanged = JSON.stringify(
    asrhDraftRows
      .map((row) => ({ member_name: row.member_name, date_key: row.date_key, hours: Number(row.hours ?? 0), notes: row.notes ?? null, source: row.source ?? null }))
      .sort((a, b) => `${a.member_name}|${a.date_key}`.localeCompare(`${b.member_name}|${b.date_key}`)),
  ) !== JSON.stringify(
    asrhRows
      .map((row) => ({ member_name: row.member_name, date_key: row.date_key, hours: Number(row.hours ?? 0), notes: row.notes ?? null, source: row.source ?? null }))
      .sort((a, b) => `${a.member_name}|${a.date_key}`.localeCompare(`${b.member_name}|${b.date_key}`)),
  );

  return (
    <WidgetFrame
      title="Work Allotment Generator"
      subtitle={result
        ? `${readyShiftCount} shifts prepared for ${result.dateKey}`
        : automationStatus?.operationalDate
          ? `${readyShiftCount} saved shifts available for ${automationStatus.operationalDate}`
          : "Read roster, plan all shifts, and review monthly fairness by shift group"}
      icon={IconClipboardList}
      iconColor="indigo"
      loading={loading}
      onRefresh={() => void refreshAutomation()}
      status={{
        label: result || automationStatus ? `${readyShiftCount} shifts planned` : "Loading",
        color: result || automationStatus ? "green" : "gray",
      }}
      headerActions={<Badge variant="light" color="indigo">PDT / America/Los_Angeles</Badge>}
    >
      <Stack gap="lg">
        {(error || notice) && <Alert color={error ? "red" : "green"}>{error || notice}</Alert>}

        {activeFairnessWarning ? <Alert color="yellow">{activeFairnessWarning}</Alert> : null}

        <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="allotments" leftSection={<IconClipboardList size={16} />}>
              Shift allotments
            </Tabs.Tab>
            {isManager ? (
              <Tabs.Tab value="handoffs" leftSection={<IconClipboardList size={16} />}>
                Handoff tasks
              </Tabs.Tab>
            ) : null}
            <Tabs.Tab value="fairness" leftSection={<IconScale size={16} />}>
              Fairness tracker
            </Tabs.Tab>
            <Tabs.Tab value="asrh-hours" leftSection={<IconScale size={16} />}>
              AS&RH hours table
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="allotments" pt="md">
            <Stack gap="md">
              <Card withBorder radius="md" p="md">
                <Stack gap="md">
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={4}>
                      <Text fw={700}>Automation status</Text>
                      <Text size="sm" c="dimmed">
                        Server-side schedule for today&apos;s generated work allotments and Slack posting state.
                      </Text>
                      <Text size="xs" c="dimmed">
                        Cron schedule: generates the full day at 3:10 AM PT, then checks for due shifts every 5 minutes and posts anything whose scheduled time has passed.
                      </Text>
                      <Text size="xs" c="dimmed">
                        Last cron activity: {formatTimestamp(latestCronActivity)}
                      </Text>
                      {latestManualActivity ? (
                        <Text size="xs" c="dimmed">
                          Last manual refresh: {formatTimestamp(latestManualActivity)}
                        </Text>
                      ) : null}
                      <Text size="xs" c="dimmed">
                        Note: automatic 5-minute cron runs happen only on the deployed Vercel app. The App Builder/dev preview does not execute Vercel cron jobs.
                      </Text>
                    </Stack>
                    <Group gap="xs">
                      <Badge color="indigo" variant="light">Date: {automationStatus?.operationalDate ?? result?.dateKey ?? "—"}</Badge>
                      <Badge color="green" variant="light">Posted: {automationStatus?.postedCount ?? 0}</Badge>
                      <Badge color="yellow" variant="light">Planned: {automationStatus?.plannedCount ?? 0}</Badge>
                      <Badge color={fairnessSyncState.color} variant="light">{fairnessSyncState.label}</Badge>
                    </Group>
                  </Group>

                  <Alert color={fairnessSyncState.color === "green" ? "green" : fairnessSyncState.color === "yellow" ? "yellow" : fairnessSyncState.color === "red" ? "red" : "gray"} variant="light">
                    <Text fw={700} size="sm">Fairness sheet sync</Text>
                    <Text size="sm">
                      {fairnessSyncMessage || "Waiting for S6 to post before running the end-of-day fairness sheet update."}
                    </Text>
                  </Alert>

                  {statusLoading ? (
                    <Text size="sm" c="dimmed">Loading automation status…</Text>
                  ) : statusError ? (
                    <Alert color="red">{statusError}</Alert>
                  ) : displayJobs.length === 0 ? (
                    <Text size="sm" c="dimmed">No generated shift jobs have been saved for today yet.</Text>
                  ) : (
                    <Stack gap="xs">
                      {previewJobs.length > 0 ? (
                        <Text size="xs" c="dimmed">
                          Showing the freshly generated plan below. Saved automation jobs will update after the next automation reconcile/post run.
                        </Text>
                      ) : null}
                      <ScrollArea>
                        <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: 860 }}>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Shift</Table.Th>
                              <Table.Th>Status</Table.Th>
                              <Table.Th>Primary</Table.Th>
                              <Table.Th>Backup</Table.Th>
                              <Table.Th>Slack TS</Table.Th>
                              <Table.Th>Last error</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {displayJobs.map((job) => (
                              <Table.Tr key={job.id}>
                                <Table.Td>{formatVisibleShiftLabel(job.shift)}</Table.Td>
                                <Table.Td>
                                  <Badge color={job.status === "posted" ? "green" : "yellow"} variant="light">
                                    {job.status}
                                  </Badge>
                                </Table.Td>
                                <Table.Td>{job.primary || "—"}</Table.Td>
                                <Table.Td>{job.backup || "—"}</Table.Td>
                                <Table.Td>{job.slack_ts || "—"}</Table.Td>
                                <Table.Td>
                                  <Text size="sm" c={job.last_error ? "red" : "dimmed"}>
                                    {job.last_error || "—"}
                                  </Text>
                                </Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      </ScrollArea>
                    </Stack>
                  )}
                </Stack>
              </Card>

              <Card withBorder radius="md" p="md">
                <Stack gap="md">
                  <Text fw={700}>Shift allotments for the day</Text>
                  {(result?.shifts ?? []).length > 0 ? (
                    (result?.shifts ?? []).map((shift) => (
                      <Card key={shift.slot} withBorder radius="md" p="md">
                        <Stack gap="sm">
                          <Group justify="space-between" align="center">
                            <Group gap={8}>
                              <Badge color={shift.status === "ok" ? "green" : "gray"} variant="light">{formatVisibleShiftLabel(shift.slot)}</Badge>
                              {shift.primary ? <Badge color="indigo" variant="light">Primary: {shift.primary}</Badge> : null}
                              {shift.backup ? <Badge color="blue" variant="light">Backup: {shift.backup}</Badge> : null}
                              {shift.continuingFrom ? <Badge color="violet" variant="light">Continuing from {formatVisibleShiftLabel(shift.continuingFrom)}</Badge> : null}
                              {shift.carryPathUsed ? <Badge color="teal" variant="light">Carry path used: {shift.carryPathUsed}</Badge> : null}
                            </Group>
                            {typeof shift.fairnessAfter === "number" ? (
                              <Badge color="grape" variant="light">{shift.fairnessBefore} → {shift.fairnessAfter}</Badge>
                            ) : null}
                          </Group>
                          <Text size="xs" c="dimmed">
                            Available during {formatVisibleShiftLabel(shift.slot)}: {formatAvailableMembers(shift.availableMembers)}
                          </Text>
                          {shift.carryPathRule ? (
                            <Text size="xs" c="dimmed">
                              Carry rule for {formatVisibleShiftLabel(shift.slot)}: {shift.carryPathRule}
                            </Text>
                          ) : null}
                          <Text component="pre" size="sm" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                            {shift.message}
                          </Text>
                        </Stack>
                      </Card>
                    ))
                  ) : (automationStatus?.jobs ?? []).length > 0 ? (
                    (automationStatus?.jobs ?? []).map((job) => (
                      <Card key={job.id} withBorder radius="md" p="md">
                        <Stack gap="sm">
                          <Group justify="space-between" align="center">
                            <Group gap={8}>
                              <Badge color={job.status === "posted" ? "green" : "yellow"} variant="light">{formatVisibleShiftLabel(job.shift)}</Badge>
                              {job.primary ? <Badge color="indigo" variant="light">Primary: {job.primary}</Badge> : null}
                              {job.backup ? <Badge color="blue" variant="light">Backup: {job.backup}</Badge> : null}
                              {job.continuing_from ? <Badge color="violet" variant="light">Continuing from {formatVisibleShiftLabel(job.continuing_from)}</Badge> : null}
                              {job.carry_path_used ? <Badge color="teal" variant="light">Carry path used: {job.carry_path_used}</Badge> : null}
                            </Group>
                            <Badge color={job.status === "posted" ? "green" : "yellow"} variant="light">{job.status}</Badge>
                          </Group>
                          {job.carry_path_rule ? (
                            <Text size="xs" c="dimmed">
                              Carry rule for {formatVisibleShiftLabel(job.shift)}: {job.carry_path_rule}
                            </Text>
                          ) : null}
                          <Text component="pre" size="sm" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                            {job.message || "Saved work allotment message unavailable."}
                          </Text>
                        </Stack>
                      </Card>
                    ))
                  ) : (
                    <Text size="sm" c="dimmed">No shifts were generated for today.</Text>
                  )}
                </Stack>
              </Card>
            </Stack>
          </Tabs.Panel>

          {isManager ? (
            <Tabs.Panel value="handoffs" pt="md">
              <Stack gap="md">
                <Card withBorder radius="md" p="md">
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={4}>
                      <Text fw={700}>Today’s handoff tasks</Text>
                      <Text size="sm" c="dimmed">
                        Manager audit view for generated ownership tasks, their current status, and bot reminder activity.
                      </Text>
                    </Stack>
                    <Group gap="xs">
                      <Badge color="orange" variant="light">Open: {openHandoffTasks.length}</Badge>
                      <Badge color="green" variant="light">Completed: {completedHandoffTasks.length}</Badge>
                      <Badge color="red" variant="light">Reminders: {totalHandoffReminders}</Badge>
                    </Group>
                  </Group>
                </Card>

                <Card withBorder radius="md" p="md">
                  {statusLoading ? (
                    <Text size="sm" c="dimmed">Loading handoff tasks…</Text>
                  ) : managerOwnershipTasks.length === 0 ? (
                    <Text size="sm" c="dimmed">No ownership handoff tasks were generated for today.</Text>
                  ) : (
                    <ScrollArea>
                      <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: 920 }}>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Assignee</Table.Th>
                            <Table.Th>Task</Table.Th>
                            <Table.Th>Shift</Table.Th>
                            <Table.Th>Status</Table.Th>
                            <Table.Th ta="right">Reminders sent</Table.Th>
                            <Table.Th>Last reminded</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {managerOwnershipTasks.map((task) => (
                            <Table.Tr key={task.id}>
                              <Table.Td>{task.assignee_name || "—"}</Table.Td>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text size="sm" fw={600}>{task.title}</Text>
                                  <Text size="xs" c="dimmed">{task.details || "Work allotment handoff"}</Text>
                                </Stack>
                              </Table.Td>
                              <Table.Td>{task.source_shift ? formatVisibleShiftList(task.source_shift) : "—"}</Table.Td>
                              <Table.Td>
                                <Badge color={String(task.status ?? "") === "completed" ? "green" : "yellow"} variant="light">
                                  {String(task.status ?? "open")}
                                </Badge>
                              </Table.Td>
                              <Table.Td ta="right">{Number(task.reminder_count ?? 0)}</Table.Td>
                              <Table.Td>
                                <Text size="sm" c="dimmed">
                                  {task.last_reminded_at ? formatTimestamp(task.last_reminded_at) : (task.completed_at ? `Completed ${formatTimestamp(task.completed_at)}` : "—")}
                                </Text>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                  )}
                </Card>
              </Stack>
            </Tabs.Panel>
          ) : null}

          <Tabs.Panel value="fairness" pt="md">
            <Stack gap="md">
              <Card withBorder radius="md" p="md">
                <Stack gap="xs">
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={4}>
                      <Text fw={700}>Monthly fairness tracker</Text>
                      <Text size="sm" c="dimmed">
                        This tracker is sourced from <strong>{fairnessSourceTitle}</strong> for {formatMonthLabel(fairnessSummary?.monthKey)}. It shows member name, worked days till date, and AS&amp;RH hours from the in-app AS&amp;RH hours table.
                      </Text>
                    </Stack>
                  </Group>
                </Stack>
              </Card>

              {combinedFairnessMembers.length === 0 ? (
                <Card withBorder radius="md" p="md">
                  <Text size="sm" c="dimmed">No monthly fairness data is available yet for this month.</Text>
                </Card>
              ) : (
                <>
                  <Card withBorder radius="md" p="md">
                    <Stack gap="md">
                      <Group justify="space-between" align="flex-start">
                        <Stack gap={4}>
                          <Text fw={700}>Combined fairness table</Text>
                          <Text size="sm" c="dimmed">Each member appears once under the shift family where they accumulated the most activity. Only the in-app AS&amp;RH hours table values are shown.</Text>
                        </Stack>
                        <Badge color="grape" variant="light">{fairnessGroups.length} shift families</Badge>
                      </Group>

                      <ScrollArea>
                        <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: 720 }}>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Member</Table.Th>
                              <Table.Th ta="right">Worked days</Table.Th>
                              <Table.Th ta="right">Roster AS&amp;RH hrs</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {combinedFairnessMembers.map((member) => (
                              <Table.Tr key={`${member.groupKey}-${member.name}`}>
                                <Table.Td>{member.name}</Table.Td>
                                <Table.Td ta="right">{member.workedDays}</Table.Td>
                                <Table.Td ta="right">{member.trackerHours}</Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      </ScrollArea>
                    </Stack>
                  </Card>

                  {fairnessGroups.map((group) => {
                    const visibleMembers = group.members.filter((member) => !isExcludedFairnessMember(member.name));
                    return (
                    <Card key={group.key} withBorder radius="md" p="md">
                      <Stack gap="md">
                        <Group justify="space-between" align="flex-start">
                          <Stack gap={4}>
                            <Text fw={700}>{group.label}</Text>
                            <Text size="sm" c="dimmed">
                              Members are listed with only days worked till date and AS&amp;RH hours taken from the in-app AS&amp;RH hours table.
                            </Text>
                          </Stack>
                          <Badge color="indigo" variant="light">Highest: {group.highestCount}</Badge>
                        </Group>

                        <ScrollArea>
                          <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: 720 }}>
                            <Table.Thead>
                              <Table.Tr>
                                <Table.Th>Member</Table.Th>
                                <Table.Th ta="right">Worked days</Table.Th>
                                <Table.Th ta="right">Roster AS&amp;RH hrs</Table.Th>
                              </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                              {visibleMembers.map((member) => (
                                <Table.Tr key={`${group.key}-${member.name}`}>
                                  <Table.Td>{member.name}</Table.Td>
                                  <Table.Td ta="right">{member.workedDays}</Table.Td>
                                  <Table.Td ta="right">{member.trackerHours}</Table.Td>
                                </Table.Tr>
                              ))}
                            </Table.Tbody>
                          </Table>
                        </ScrollArea>
                      </Stack>
                    </Card>
                  );
                  })}
                </>
              )}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="asrh-hours" pt="md">
            <Stack gap="md">
              <Card withBorder radius="md" p="md">
                <Group justify="space-between" align="flex-start">
                  <Stack gap={4}>
                    <Text fw={700}>AS&amp;RH hours table</Text>
                    <Text size="sm" c="dimmed">
                      This in-app table replaces the old Google Sheet push for roster AS&amp;RH hours. Update hours here and save them directly to the dashboard database for {formatMonthLabel(activeAsrhMonthKey)}.
                    </Text>
                  </Stack>
                  <Group gap="xs">
                    <Badge color="grape" variant="light">{formatMonthLabel(activeAsrhMonthKey)}</Badge>
                    <Button variant="light" color="gray" size="xs" onClick={() => void loadAsrhHoursTable(activeAsrhMonthKey)} loading={asrhLoading}>
                      Reload
                    </Button>
                    {isManager ? (
                      <Button color="indigo" size="xs" onClick={() => void saveAsrhHoursTable(asrhDraftRowsRef.current)} loading={asrhSaving} disabled={!asrhDraftChanged}>
                        Save table
                      </Button>
                    ) : null}
                  </Group>
                </Group>
              </Card>

              {asrhSaveNotice ? <Alert color="green">{asrhSaveNotice}</Alert> : null}

              <Card withBorder radius="md" p="md">
                {asrhLoading ? (
                  <Group justify="center" py="lg">
                    <Loader size="sm" color="indigo" />
                    <Text size="sm" c="dimmed">Loading AS&amp;RH hours table…</Text>
                  </Group>
                ) : (
                  <ScrollArea>
                    <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: Math.max(980, 200 + asrhDayNumbers.length * 76) }}>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th miw={220}>Member</Table.Th>
                          {asrhDayNumbers.map((day) => (
                            <Table.Th key={`day-${day}`} ta="center" miw={76}>{day}</Table.Th>
                          ))}
                          <Table.Th ta="right" miw={96}>Total</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {asrhMemberNames.map((memberName) => {
                          const total = asrhDayNumbers.reduce((sum, day) => {
                            const dateKey = getDateKeyForMonthDay(activeAsrhMonthKey, day);
                            const cell = asrhCellMap.get(`${memberName}|${dateKey}`);
                            return sum + Number(cell?.hours ?? 0);
                          }, 0);
                          return (
                            <Table.Tr key={memberName}>
                              <Table.Td>{memberName}</Table.Td>
                              {asrhDayNumbers.map((day) => {
                                const dateKey = getDateKeyForMonthDay(activeAsrhMonthKey, day);
                                const cell = asrhCellMap.get(`${memberName}|${dateKey}`);
                                const hours = Number(cell?.hours ?? 0);
                                const hasHours = hours > 0;
                                return (
                                  <Table.Td key={`${memberName}-${dateKey}`}>
                                    <NumberInput
                                      value={hours}
                                      onChange={(value) => updateAsrhDraftCell(memberName, dateKey, Number(value ?? 0))}
                                      min={0}
                                      step={0.5}
                                      decimalScale={1}
                                      hideControls
                                      disabled={!isManager}
                                      styles={{
                                        input: {
                                          minWidth: 64,
                                          textAlign: "center",
                                          paddingLeft: 8,
                                          paddingRight: 8,
                                          fontWeight: hasHours ? 700 : 500,
                                          color: hasHours ? "var(--mantine-color-yellow-2)" : undefined,
                                          backgroundColor: hasHours ? "rgba(250, 176, 5, 0.18)" : undefined,
                                          borderColor: hasHours ? "rgba(250, 176, 5, 0.5)" : undefined,
                                          boxShadow: hasHours ? "inset 0 0 0 1px rgba(250, 176, 5, 0.22)" : undefined,
                                        },
                                      }}
                                    />
                                  </Table.Td>
                                );
                              })}
                              <Table.Td ta="right" fw={700}>{Number(total.toFixed(1))}</Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                )}
              </Card>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </WidgetFrame>
  );
}
