import { ROLE_BY_NAME, ROSTER_BY_EMAIL } from "../../lib/roles";

export interface FairnessEntry {
  name: string;
  dateKey: string;
  hours: number;
}

export interface ScheduledPostRow {
  date: string;
  shift: string;
  primary: string;
  backup: string;
  slackTs?: string;
  status: string;
  lastChecked: string;
}

export interface FairnessTrackerStore {
  fairnessEntries: FairnessEntry[];
  scheduledPosts: ScheduledPostRow[];
}

const STORAGE_KEY = "devsai-work-allotment-fairness-tracker-v1";

export const DEFAULT_MEMBER_NAMES = Array.from(
  new Set([
    ...Object.values(ROSTER_BY_EMAIL).map((entry) => entry.name),
    ...Object.entries(ROLE_BY_NAME)
      .filter(([, role]) => role !== "manager")
      .map(([name]) => name),
  ]),
);

export function getCurrentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function getDateKeyForMonthDay(monthKey: string, day: number) {
  return `${monthKey}-${String(day).padStart(2, "0")}`;
}

export function getDaysInMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return 31;
  return new Date(year, month, 0).getDate();
}

export function getMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

export function sanitizeTrackerStore(input: Partial<FairnessTrackerStore> | null | undefined): FairnessTrackerStore {
  const fairnessEntries = Array.isArray(input?.fairnessEntries)
    ? input.fairnessEntries
        .map((entry) => ({
          name: String(entry?.name ?? "").trim(),
          dateKey: String(entry?.dateKey ?? "").trim(),
          hours: Number(entry?.hours ?? 0),
        }))
        .filter((entry) => entry.name && /^\d{4}-\d{2}-\d{2}$/.test(entry.dateKey) && Number.isFinite(entry.hours) && entry.hours >= 0)
    : [];

  const scheduledPosts = Array.isArray(input?.scheduledPosts)
    ? input.scheduledPosts
        .map((row) => ({
          date: String(row?.date ?? "").trim(),
          shift: String(row?.shift ?? "").trim(),
          primary: String(row?.primary ?? "").trim(),
          backup: String(row?.backup ?? "").trim(),
          slackTs: String(row?.slackTs ?? "").trim(),
          status: String(row?.status ?? "").trim() || "planned",
          lastChecked: String(row?.lastChecked ?? "").trim(),
        }))
        .filter((row) => row.date && row.shift)
    : [];

  return { fairnessEntries, scheduledPosts };
}

export function loadTrackerStore(): FairnessTrackerStore {
  if (typeof window === "undefined") return { fairnessEntries: [], scheduledPosts: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { fairnessEntries: [], scheduledPosts: [] };
    return sanitizeTrackerStore(JSON.parse(raw));
  } catch {
    return { fairnessEntries: [], scheduledPosts: [] };
  }
}

export function saveTrackerStore(store: FairnessTrackerStore) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeTrackerStore(store)));
}

export function upsertFairnessEntry(entries: FairnessEntry[], nextEntry: FairnessEntry) {
  const normalized = {
    name: nextEntry.name.trim(),
    dateKey: nextEntry.dateKey.trim(),
    hours: Math.max(0, Number(nextEntry.hours) || 0),
  };

  const remaining = entries.filter((entry) => !(entry.name === normalized.name && entry.dateKey === normalized.dateKey));
  if (normalized.hours <= 0) return remaining;
  return [...remaining, normalized].sort((a, b) => `${a.dateKey}-${a.name}`.localeCompare(`${b.dateKey}-${b.name}`));
}

export function getHoursForEntry(entries: FairnessEntry[], name: string, dateKey: string) {
  return entries.find((entry) => entry.name === name && entry.dateKey === dateKey)?.hours ?? 0;
}

export function getMonthlyTotals(entries: FairnessEntry[], memberNames: string[], monthKey: string) {
  const totals = new Map(memberNames.map((name) => [name, 0]));
  for (const entry of entries) {
    if (!entry.dateKey.startsWith(`${monthKey}-`)) continue;
    totals.set(entry.name, (totals.get(entry.name) ?? 0) + Number(entry.hours ?? 0));
  }
  return totals;
}
