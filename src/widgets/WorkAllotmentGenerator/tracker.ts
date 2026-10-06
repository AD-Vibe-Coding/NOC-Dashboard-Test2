import { ROLE_BY_NAME, ROSTER_BY_EMAIL } from "../../lib/roles";

export type FairnessEntry = { name: string; dateKey: string; hours: number };

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
  monthKey?: string;
  fairnessEntries: Array<{ name: string; dateKey: string; hours: number }>;
  scheduledPosts: ScheduledPostRow[];
}

const STORAGE_KEY = "devsai-work-allotment-fairness-tracker-v1";

export const EXCLUDED_FAIRNESS_MEMBERS = new Set([
  "Akash Hanvate",
  "Otukho Olembo",
  "Anirudh Kukudala",
  "Perry Cox",
  "Matt Marquez",
  "Mahalakshmi Samiti",
]);

export function isExcludedFairnessMember(name: string) {
  return EXCLUDED_FAIRNESS_MEMBERS.has(String(name ?? "").trim());
}

const PREFERRED_MEMBER_NAME: Record<string, string> = {
  "Abishek Benarji": "Abhishek Benarji",
  "Hamza Umme": "Hamza Rahmani",
  "Lokesh Banavath": "Lokesh Naik Banavath",
  "Zubair Mohammed": "Mohammed Zubairuddin",
  "Ashraf Mohammed": "Mohammed Ashraf",
  "Mohammed Akram Ahmed": "Akram Ahmed",
  "Samiti Mahalakshmi": "Mahalakshmi Samiti",
};

function preferredMemberName(name: string) {
  return PREFERRED_MEMBER_NAME[String(name ?? "").trim()] ?? String(name ?? "").trim();
}

export const DEFAULT_MEMBER_NAMES = Array.from(
  new Set([
    ...Object.values(ROSTER_BY_EMAIL)
      .filter((entry) => entry.role !== "manager" && entry.role !== "customer_service_manager")
      .map((entry) => preferredMemberName(entry.name)),
    ...Object.entries(ROLE_BY_NAME)
      .filter(([, role]) => role !== "manager" && role !== "customer_service_manager")
      .map(([name]) => preferredMemberName(name)),
  ])
).filter((name) => !EXCLUDED_FAIRNESS_MEMBERS.has(name));

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
  const monthKey = String(input?.monthKey ?? "").trim();
  const fairnessEntries = Array.isArray(input?.fairnessEntries)
    ? input.fairnessEntries
        .map((entry) => ({
          name: String(entry?.name ?? "").trim(),
          dateKey: String(entry?.dateKey ?? "").trim(),
          hours: Number(entry?.hours ?? 0),
        }))
        .filter(
          (entry) =>
            entry.name &&
            !EXCLUDED_FAIRNESS_MEMBERS.has(entry.name) &&
            /^\d{4}-\d{2}-\d{2}$/.test(entry.dateKey) &&
            Number.isFinite(entry.hours) &&
            entry.hours >= 0,
        )
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
        .filter(
          (row) =>
            row.date &&
            row.shift &&
            !EXCLUDED_FAIRNESS_MEMBERS.has(row.primary) &&
            !EXCLUDED_FAIRNESS_MEMBERS.has(row.backup),
        )
    : [];

  return { monthKey, fairnessEntries, scheduledPosts };
}

export function loadTrackerStore(currentMonthKey = getCurrentMonthKey()): FairnessTrackerStore {
  if (typeof window === "undefined") return { monthKey: currentMonthKey, fairnessEntries: [], scheduledPosts: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { monthKey: currentMonthKey, fairnessEntries: [], scheduledPosts: [] };
    const parsed = sanitizeTrackerStore(JSON.parse(raw));
    if (parsed.monthKey && parsed.monthKey !== currentMonthKey) {
      return { monthKey: currentMonthKey, fairnessEntries: [], scheduledPosts: [] };
    }
    return { ...parsed, monthKey: currentMonthKey };
  } catch {
    return { monthKey: currentMonthKey, fairnessEntries: [], scheduledPosts: [] };
  }
}

export function saveTrackerStore(store: FairnessTrackerStore) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeTrackerStore({
    ...store,
    monthKey: store.monthKey || getCurrentMonthKey(),
  })));
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
