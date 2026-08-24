import { readRosterDailyEntries, readRosterMonthEntries } from "../roster-shift.js";
import { postSlackMessage } from "./slack.js";

export const WORK_ALLOTMENT_CONFIG = {
  rosterSpreadsheetId: "14t85Jg97RXmjDg3cwBQOnYGVYoBZUPuTrHGz-SKtZA4",
  rosterSpreadsheetUrl: "https://docs.google.com/spreadsheets/d/14t85Jg97RXmjDg3cwBQOnYGVYoBZUPuTrHGz-SKtZA4/edit?gid=1728888175#gid=1728888175",
  rosterTabGid: "1728888175",
  fairnessSpreadsheetId: "1nxL4kM6Q7YG44j2_wjdiEK511KMgIphCdLVvm7Nnji4",
  fairnessSpreadsheetUrl: "https://docs.google.com/spreadsheets/d/1nxL4kM6Q7YG44j2_wjdiEK511KMgIphCdLVvm7Nnji4/edit?gid=1765807502#gid=1765807502",
  fairnessTabGid: "1765807502",
  fairnessTabName: "Fairness Tracker - Aug'26",
  fairnessTrackerMode: "google-sheet",
  fairnessTrackerName: "Fairness Tracker - Aug'26",
  slackChannelId: process.env.SLACK_CHANNEL_ID || "C09Q89PHN8M",
  slackChannelName: process.env.SLACK_CHANNEL_NAME || "noc-team",
  timeZone: "America/Los_Angeles",
};

const MANAGERS = new Set([
  "Anirudh Kukudala",
  "Perry Cox",
  "Matt Marquez",
]);

const RESTRICTED_ASRH = new Set([
  "Akash Hanvate",
  "Otukho Olembo",
]);

const OFF_STATUSES = new Set([
  "WO",
  "PTO",
  "SICK LEAVE",
  "HOLIDAY",
  "EMERGENCY LEAVE",
]);

export const EXCLUDED_FAIRNESS_MEMBERS = new Set([
  "Akash Hanvate",
  "Otukho Olembo",
  "Anirudh Kukudala",
  "Perry Cox",
  "Matt Marquez",
  "Mahalakshmi Samiti",
]);

export const ALL_MEMBERS = [
  "Abhishek Benarji",
  "Akram Ahmed",
  "Mohammed Ashraf",
  "Karthik Damagalla",
  "Kenya Gentry",
  "Hamza Rahmani",
  "Karthik Radhakrishnan",
  "Pranav Dandibhotla",
  "Lokesh Naik Banavath",
  "Mohammed Zubairuddin",
  "Sriram Parisa",
];

export const SHIFT_DEFINITIONS = {
  S1: { label: "Shift 1", rosterCode: "S1", postHour: 3, postMinute: 25, handoffHour: 3, handoffMinute: 45, start: "3:00 AM", end: "12:00 PM", next: "S2" },
  S2: { label: "Shift 2", rosterCode: "S2", postHour: 6, postMinute: 25, handoffHour: 6, handoffMinute: 45, start: "6:00 AM", end: "3:00 PM", next: "S3" },
  S3: { label: "Shift 3", rosterCode: "S3", postHour: 8, postMinute: 25, handoffHour: 8, handoffMinute: 45, start: "8:00 AM", end: "5:00 PM", next: "S4" },
  S4: { label: "Shift 4", rosterCode: "S4", postHour: 11, postMinute: 25, handoffHour: 11, handoffMinute: 45, start: "11:00 AM", end: "8:00 PM", next: "S5" },
  "S4.1": { label: "Shift 4.1", rosterCode: "S4.1", postHour: 14, postMinute: 25, handoffHour: 14, handoffMinute: 45, start: "2:25 PM", end: "8:00 PM", next: "S4.2" },
  "S4.2": { label: "Shift 4.2", rosterCode: "S4.2", postHour: 16, postMinute: 25, handoffHour: 16, handoffMinute: 45, start: "4:25 PM", end: "8:00 PM", next: "S5" },
  S5: { label: "Shift 5", rosterCode: "S5", postHour: 19, postMinute: 25, handoffHour: 19, handoffMinute: 45, start: "7:00 PM", end: "4:00 AM", next: "S6" },
  S6: { label: "Shift 6", rosterCode: "S6", postHour: 0, postMinute: 25, handoffHour: 0, handoffMinute: 45, start: "11:30 PM", end: "8:30 AM", next: "S1" },
};

const SHIFT_MATCHERS = [
  { code: "S1", patterns: [/^3:?00\s*am\s*-\s*12:?00\s*pm$/i, /^s1$/i] },
  { code: "S2", patterns: [/^6:?00\s*am\s*-\s*3:?00\s*pm$/i, /^s2$/i] },
  { code: "S3", patterns: [/^8:?00\s*am\s*-\s*5:?00\s*pm$/i, /^s3$/i] },
  { code: "S4", patterns: [/^11:?00\s*am\s*-\s*8:?00\s*pm$/i, /^s4$/i] },
  { code: "S5", patterns: [/^7:?00\s*pm\s*-\s*4:?00\s*am$/i, /^s5$/i] },
  { code: "S6", patterns: [/^(11:?30\s*pm|12:?00\s*am)\s*-\s*(8:?30\s*am|9:?00\s*am)$/i, /^s6$/i] },
];

export const FAIRNESS_SHIFT_GROUPS = [
  {
    key: "late-evening",
    label: "7:00 PM – 4:00 AM fairness",
    shiftCodes: ["S5"],
    shiftLabels: ["7:00 PM – 4:00 AM"],
  },
  {
    key: "overnight-early",
    label: "12:00 AM / 3:00 AM / 6:00 AM fairness",
    shiftCodes: ["S6", "S1", "S2"],
    shiftLabels: ["12:00 AM – 9:00 AM", "3:00 AM – 12:00 PM", "6:00 AM – 3:00 PM"],
  },
  {
    key: "day-swing",
    label: "8:00 AM / 11:00 AM fairness",
    shiftCodes: ["S3", "S4", "S4.1", "S4.2"],
    shiftLabels: ["8:00 AM – 5:00 PM", "11:00 AM – 8:00 PM"],
  },
];

function buildFairnessCsvUrl() {
  return `https://docs.google.com/spreadsheets/d/${WORK_ALLOTMENT_CONFIG.fairnessSpreadsheetId}/export?format=csv&gid=${WORK_ALLOTMENT_CONFIG.fairnessTabGid}`;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseFairnessHeaderToDateKey(header, targetMonthKey) {
  const value = normalizeCell(header);
  const match = value.match(/^([A-Za-z]{3,})\s+(\d{1,2})$/);
  if (!match) return null;
  const monthMap = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const month = monthMap[match[1].slice(0, 3).toLowerCase()];
  const day = String(Number(match[2])).padStart(2, "0");
  const year = String(targetMonthKey || "").slice(0, 4);
  if (!year || !month) return null;
  return `${year}-${month}-${day}`;
}

async function readFairnessTrackerEntries(targetMonthKey) {
  const response = await fetch(buildFairnessCsvUrl());
  if (!response.ok) {
    throw new Error(`Fairness tracker CSV error: ${response.status}`);
  }

  const csv = await response.text();
  const rows = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);

  const headerRow = rows[1] ?? [];
  const dateColumns = headerRow
    .map((header, index) => ({ index, dateKey: parseFairnessHeaderToDateKey(header, targetMonthKey) }))
    .filter((entry) => entry.index > 0 && entry.dateKey);

  const entries = [];
  for (const row of rows.slice(2)) {
    const name = normalizeName(row[0]);
    if (!name || EXCLUDED_FAIRNESS_MEMBERS.has(name)) continue;

    for (const { index, dateKey } of dateColumns) {
      const hours = Number(String(row[index] ?? "").trim());
      if (!Number.isFinite(hours) || hours <= 0) continue;
      entries.push({ name, dateKey, hours });
    }
  }

  const totalsByName = new Map();
  const totalsHeaderIndex = rows.findIndex((row) => {
    const first = normalizeCell(row[0]).toUpperCase();
    const second = normalizeCell(row[1]).toUpperCase();
    return first === "MEMBER NAME" && second.includes("TOTAL HOURS");
  });

  if (totalsHeaderIndex >= 0) {
    for (const row of rows.slice(totalsHeaderIndex + 1)) {
      const name = normalizeName(row[0]);
      const hoursCell = normalizeCell(row[1]);
      if (!name) continue;
      if (name.toUpperCase() === "FAIRNESS SCORE CALCULATION") continue;
      if (!hoursCell) break;
      const hours = Number(hoursCell);
      if (EXCLUDED_FAIRNESS_MEMBERS.has(name) || !Number.isFinite(hours) || hours < 0) continue;
      totalsByName.set(name, hours);
    }
  }

  return {
    sheetTitle: WORK_ALLOTMENT_CONFIG.fairnessTabName,
    spreadsheetUrl: WORK_ALLOTMENT_CONFIG.fairnessSpreadsheetUrl,
    entries,
    totalsByName,
  };
}

function formatInZone(date, opts) {
  return new Intl.DateTimeFormat("en-US", { timeZone: WORK_ALLOTMENT_CONFIG.timeZone, ...opts }).format(date);
}

function zonedParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: WORK_ALLOTMENT_CONFIG.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long",
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
  };
}

function localDateKey(date) {
  const p = zonedParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function monthKey(date) {
  const p = zonedParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

function normalizeCell(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return normalizeCell(value).replace(/\s+/g, " ");
}

function normalizeStatus(value) {
  return normalizeCell(value).replace(/\s+/g, " ").toUpperCase();
}

function isOffStatus(value) {
  return OFF_STATUSES.has(normalizeStatus(value));
}

function parseShiftCode(value) {
  const text = normalizeCell(value);
  if (!text) return null;
  for (const matcher of SHIFT_MATCHERS) {
    if (matcher.patterns.some((pattern) => pattern.test(text))) return matcher.code;
  }
  return null;
}

function shiftCodeFromWindow(shift) {
  if (!shift) return null;
  const start = Number(shift.start);
  const end = Number(shift.end);
  const windows = {
    S1: [[180, 720]],
    S2: [[360, 900]],
    S3: [[480, 1020]],
    S4: [[660, 1200]],
    S5: [[1140, 240]],
    S6: [[1410, 510], [0, 540]],
  };
  return Object.entries(windows).find(([, ranges]) =>
    ranges.some((values) => values[0] === start && values[1] === end)
  )?.[0] ?? null;
}

/** Uses the same roster endpoint reader as Team Availability and Ticket Rebalancer. */
export async function readRosterForDate(date) {
  const targetDate = localDateKey(date);
  const sharedRoster = await readRosterDailyEntries(targetDate);
  const members = (sharedRoster.dailyEntries ?? []).map((entry) => {
    const name = normalizeName(entry.name);
    const rawValue = normalizeCell(entry.cell);
    const offReason = entry.available ? null : (isOffStatus(rawValue) ? rawValue : (entry.status === "Other" || entry.status === "Blank" ? null : entry.status));
    return {
      name,
      rawValue,
      shiftCode: shiftCodeFromWindow(entry.shift) ?? parseShiftCode(rawValue),
      offReason,
      isManager: MANAGERS.has(name),
      asrhRestricted: RESTRICTED_ASRH.has(name),
      shiftWindow: entry.shift ?? null,
    };
  }).filter((member) => member.name);

  if (members.length === 0) {
    throw new Error(sharedRoster.error || "The shared roster reader returned no roster members.");
  }

  return {
    sheetName: sharedRoster.sheetTitle,
    dayColumn: null,
    strategy: sharedRoster.strategy,
    members,
  };
}

function dedupeMembers(names) {
  return Array.from(
    new Set(names.map((name) => normalizeName(name)).filter((name) => name && !EXCLUDED_FAIRNESS_MEMBERS.has(name)))
  );
}

function sanitizeFairnessEntries(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      name: normalizeName(entry?.name),
      dateKey: normalizeCell(entry?.dateKey),
      hours: Number(entry?.hours ?? 0),
    }))
    .filter((entry) => entry.name && /^\d{4}-\d{2}-\d{2}$/.test(entry.dateKey) && Number.isFinite(entry.hours) && entry.hours >= 0);
}

function buildFairnessHoursByGroup(monthRoster, fairnessEntries = [], targetDateKey = null) {
  const byGroup = new Map();

  for (const entry of sanitizeFairnessEntries(fairnessEntries)) {
    const name = normalizeName(entry?.name);
    const dateKey = normalizeCell(entry?.dateKey);
    const hours = Number(entry?.hours ?? 0);
    if (targetDateKey && dateKey > targetDateKey) continue;

    const member = (monthRoster?.members ?? []).find((item) => normalizeName(item?.name) === name);
    const assignment = member?.assignments?.find((item) => normalizeCell(item?.dateKey) === dateKey);
    if (!assignment?.available) continue;

    const shiftCode = shiftCodeFromWindow(assignment.shift) ?? parseShiftCode(assignment.cell);
    const groupKey = getFairnessGroupForShiftCode(shiftCode)?.key ?? null;
    if (!groupKey || !Number.isFinite(hours) || hours <= 0 || EXCLUDED_FAIRNESS_MEMBERS.has(name)) continue;

    if (!byGroup.has(groupKey)) byGroup.set(groupKey, new Map());
    const groupMap = byGroup.get(groupKey);
    if (!groupMap.has(name)) groupMap.set(name, []);
    groupMap.get(name).push({ dateKey, hours });
  }

  return byGroup;
}

function sanitizeScheduledPosts(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => ({
      rowNumber: Number(row?.rowNumber ?? index + 2),
      date: normalizeCell(row?.date),
      shift: normalizeCell(row?.shift),
      primary: normalizeName(row?.primary),
      backup: normalizeName(row?.backup),
      slackTs: normalizeCell(row?.slackTs),
      status: normalizeCell(row?.status) || "planned",
      lastChecked: normalizeCell(row?.lastChecked),
    }))
    .filter((row) => row.date && row.shift);
}

function getFairnessGroupForShiftCode(shiftCode) {
  return FAIRNESS_SHIFT_GROUPS.find((group) => group.shiftCodes.includes(shiftCode)) ?? null;
}

const FAIRNESS_GROUP_TIMING_ORDER = new Map([
  ["overnight-early", 0],
  ["day-swing", 1],
  ["late-evening", 2],
]);

function getDominantFairnessGroup(groupRows = []) {
  return [...groupRows]
    .sort((a, b) => {
      if (b.workedDays !== a.workedDays) return b.workedDays - a.workedDays;
      if (b.trackerHours !== a.trackerHours) return b.trackerHours - a.trackerHours;
      if (b.rosterFairnessHours !== a.rosterFairnessHours) return b.rosterFairnessHours - a.rosterFairnessHours;
      return (FAIRNESS_GROUP_TIMING_ORDER.get(a.key) ?? 999) - (FAIRNESS_GROUP_TIMING_ORDER.get(b.key) ?? 999);
    })[0] ?? null;
}

function buildRosterFairnessSummary({ monthRoster, memberNames = [], targetDateKey = null, fairnessEntries = [], fairnessTotalsByName = new Map(), fairnessSheetTitle = "Fairness tracker" }) {
  const fairnessHoursByGroup = buildFairnessHoursByGroup(monthRoster, fairnessEntries, targetDateKey);
  const fairnessNames = sanitizeFairnessEntries(fairnessEntries).map((entry) => entry.name);
  const fairnessTotalNames = Array.from(fairnessTotalsByName.keys());
  const allNames = dedupeMembers([...ALL_MEMBERS, ...memberNames, ...fairnessNames, ...fairnessTotalNames, ...(monthRoster?.members ?? []).map((member) => member.name)]);

  const rows = allNames.map((name) => ({
    name,
    totalWorkedDays: 0,
    shifts: { S1: 0, S2: 0, S3: 0, S4: 0, "S4.1": 0, "S4.2": 0, S5: 0, S6: 0 },
    groups: Object.fromEntries(FAIRNESS_SHIFT_GROUPS.map((group) => [group.key, 0])),
  }));

  const byName = new Map(rows.map((row) => [row.name, row]));

  for (const member of monthRoster?.members ?? []) {
    const name = normalizeName(member.name);
    if (!name || MANAGERS.has(name) || EXCLUDED_FAIRNESS_MEMBERS.has(name)) continue;
    const row = byName.get(name) ?? {
      name,
      totalWorkedDays: 0,
      shifts: { S1: 0, S2: 0, S3: 0, S4: 0, "S4.1": 0, "S4.2": 0, S5: 0, S6: 0 },
      groups: Object.fromEntries(FAIRNESS_SHIFT_GROUPS.map((group) => [group.key, 0])),
    };

    for (const assignment of member.assignments ?? []) {
      if (!assignment?.available) continue;
      const assignmentDateKey = normalizeCell(assignment?.dateKey);
      if (targetDateKey && assignmentDateKey && assignmentDateKey > targetDateKey) continue;
      const shiftCode = shiftCodeFromWindow(assignment.shift) ?? parseShiftCode(assignment.cell);
      if (!shiftCode) continue;
      row.totalWorkedDays += 1;
      row.shifts[shiftCode] = Number(row.shifts[shiftCode] ?? 0) + 1;
      const group = getFairnessGroupForShiftCode(shiftCode);
      if (group) {
        row.groups[group.key] = Number(row.groups[group.key] ?? 0) + 1;
      }
    }

    byName.set(name, row);
  }

  const memberGroupRows = Array.from(byName.values()).flatMap((row) => (
    FAIRNESS_SHIFT_GROUPS.map((group) => {
      const trackedMembers = fairnessHoursByGroup.get(group.key) ?? new Map();
      const shiftBreakdown = group.shiftCodes.map((code) => ({ code, count: Number(row.shifts[code] ?? 0) }));
      const workedDays = shiftBreakdown.reduce((sum, shift) => sum + Number(shift.count ?? 0), 0);
      const rosterFairnessCount = Number(row.groups[group.key] ?? 0);
      const rosterFairnessHours = rosterFairnessCount * 8;
      const trackerHours = fairnessTotalsByName.has(row.name)
        ? Number(fairnessTotalsByName.get(row.name) ?? 0)
        : 0;
      const fairnessUnits = workedDays + trackerHours;
      return {
        key: group.key,
        label: group.label,
        shiftLabels: group.shiftLabels,
        shiftCodes: group.shiftCodes,
        name: row.name,
        workedDays,
        rosterFairnessCount,
        rosterFairnessHours,
        trackerHours,
        fairnessUnits,
        shiftBreakdown,
      };
    })
  ));

  const dominantGroupByMember = new Map();
  for (const name of allNames) {
    const candidateGroups = memberGroupRows.filter((row) => row.name === name && (row.workedDays > 0 || row.trackerHours > 0));
    const dominant = getDominantFairnessGroup(candidateGroups);
    if (dominant) dominantGroupByMember.set(name, dominant.key);
  }

  const groupSummaries = FAIRNESS_SHIFT_GROUPS.map((group) => {
    const memberRows = memberGroupRows
      .filter((row) => row.key === group.key && dominantGroupByMember.get(row.name) === group.key)
      .sort((a, b) => a.fairnessUnits - b.fairnessUnits || a.name.localeCompare(b.name));

    const highestUnits = Math.max(0, ...memberRows.map((row) => row.fairnessUnits));

    return {
      key: group.key,
      label: group.label,
      shiftLabels: group.shiftLabels,
      shiftCodes: group.shiftCodes,
      highestCount: highestUnits,
      members: memberRows.map((row) => ({
        ...row,
        fairnessScore: highestUnits > 0 ? (row.fairnessUnits / highestUnits) * 100 : 0,
      })),
    };
  });

  return {
    monthKey: monthRoster?.monthKey ?? "",
    sheetTitle: fairnessSheetTitle,
    groups: groupSummaries,
    combinedMembers: groupSummaries
      .flatMap((group) => group.members.map((member) => ({ ...member, groupKey: group.key, groupLabel: group.label, groupShiftLabels: group.shiftLabels })))
      .sort((a, b) => {
        const groupOrder = (FAIRNESS_GROUP_TIMING_ORDER.get(a.groupKey) ?? 999) - (FAIRNESS_GROUP_TIMING_ORDER.get(b.groupKey) ?? 999);
        if (groupOrder !== 0) return groupOrder;
        return a.name.localeCompare(b.name);
      }),
    members: Array.from(byName.values())
      .map((row) => ({
        name: row.name,
        totalWorkedDays: row.totalWorkedDays,
        shifts: row.shifts,
        groups: row.groups,
      }))
      .filter((row) => row.totalWorkedDays > 0),
  };
}

function buildFairnessSnapshot({ monthRoster, memberNames = [], targetMonthKey, targetDateKey = null, fairnessEntries = [], fairnessTotalsByName = new Map(), fairnessSheetTitle = "Fairness tracker" }) {
  const summary = buildRosterFairnessSummary({ monthRoster, memberNames, targetDateKey, targetMonthKey, fairnessEntries, fairnessTotalsByName, fairnessSheetTitle });
  const byName = new Map();

  for (const member of summary.members) {
    const groupScores = new Map(
      FAIRNESS_SHIFT_GROUPS.map((group) => {
        const groupSummary = summary.groups.find((item) => item.key === group.key);
        const summaryMember = groupSummary?.members.find((item) => item.name === member.name);
        return [group.key, Number(summaryMember?.fairnessUnits ?? 0)];
      })
    );
    const totalScore = Array.from(groupScores.values()).reduce((sum, score) => sum + Number(score ?? 0), 0);
    byName.set(member.name, { score: totalScore, hours: totalScore, groupScores, row: null, column: null, sheetName: summary.sheetTitle });
  }

  for (const name of dedupeMembers([...ALL_MEMBERS, ...memberNames, ...sanitizeFairnessEntries(fairnessEntries).map((entry) => entry.name)])) {
    if (!byName.has(name)) {
      byName.set(name, { score: 0, hours: 0, groupScores: new Map(), row: null, column: null, sheetName: summary.sheetTitle });
    }
  }

  return { sheetName: summary.sheetTitle, byName, fallback: false, summary };
}

export function detectDueShiftSlot(now = new Date()) {
  const p = zonedParts(now);
  const entries = Object.entries(SHIFT_DEFINITIONS);
  const match = entries.find(([, def]) => def.postHour === p.hour && def.postMinute === p.minute);
  return match?.[0] ?? null;
}

function memberMapByShift(roster) {
  const byShift = new Map();
  const offMembers = [];
  for (const member of roster.members) {
    if (member.isManager) continue;
    if (member.offReason) {
      offMembers.push(member);
      continue;
    }
    if (!member.shiftCode) continue;
    if (!byShift.has(member.shiftCode)) byShift.set(member.shiftCode, []);
    byShift.get(member.shiftCode).push(member);
  }
  return { byShift, offMembers };
}

function eligibleShiftCodesForSlot(slot) {
  if (slot === "S1") return ["S1", "S6"];
  if (slot === "S2") return ["S6", "S1", "S2"];
  if (slot === "S3") return ["S1", "S2", "S3"];
  if (slot === "S4") return ["S2", "S3", "S4"];
  if (slot === "S4.1") return ["S3", "S4"];
  if (slot === "S4.2") return ["S4"];
  if (slot === "S5") return ["S5"];
  if (slot === "S6") return ["S5", "S6"];
  return [slot];
}

function asrhShiftCodesForSlot(slot) {
  if (slot === "S1") return ["S1", "S6"];
  if (slot === "S2") return ["S2", "S1", "S6"];
  if (slot === "S3") return ["S3"];
  if (slot === "S4") return ["S4"];
  if (slot === "S4.1") return ["S4"];
  if (slot === "S4.2") return ["S4"];
  if (slot === "S5") return ["S5"];
  if (slot === "S6") return ["S6"];
  return [slot];
}

function minutesSinceMidnightForSlotPost(slot) {
  const def = SHIFT_DEFINITIONS[slot];
  if (!def) return null;
  return (Number(def.postHour) * 60) + Number(def.postMinute);
}

function remainingMinutesAfterPost(member, slot) {
  const postMinutes = minutesSinceMidnightForSlotPost(slot);
  const shiftEnd = Number(member?.shiftWindow?.end);
  if (!Number.isFinite(postMinutes) || !Number.isFinite(shiftEnd)) return Number.POSITIVE_INFINITY;
  if (shiftEnd >= postMinutes) return shiftEnd - postMinutes;
  return (24 * 60 - postMinutes) + shiftEnd;
}

function isAvailableLongEnoughForSlot(member, slot, minimumMinutes = 45) {
  return remainingMinutesAfterPost(member, slot) >= minimumMinutes;
}

function minutesSinceShiftStartAtSlot(member, slot) {
  const postMinutes = minutesSinceMidnightForSlotPost(slot);
  const shiftStart = Number(member?.shiftWindow?.start);
  if (!Number.isFinite(postMinutes) || !Number.isFinite(shiftStart)) return Number.POSITIVE_INFINITY;
  if (postMinutes >= shiftStart) return postMinutes - shiftStart;
  return (24 * 60 - shiftStart) + postMinutes;
}

function canReceiveAsrhWithinFirstHour(member, slot) {
  if (!member) return false;
  if (!["S1", "S2", "S3"].includes(member.shiftCode)) return true;
  return minutesSinceShiftStartAtSlot(member, slot) <= 60;
}

function getFairnessGroupKeyForSlot(slot) {
  return getFairnessGroupForShiftCode(slot)?.key
    ?? (slot === "S4.1" || slot === "S4.2" ? "day-swing" : null);
}

function fairnessScoreFor(name, fairness, slot = null) {
  const member = fairness.byName.get(name);
  if (!member) return 0;
  const groupKey = slot ? getFairnessGroupKeyForSlot(slot) : null;
  if (groupKey) return Number(member.groupScores?.get(groupKey) ?? 0);
  return Number(member.score ?? 0);
}

function sortByFairness(members, fairness, slot = null) {
  return [...members].sort((a, b) => {
    const ah = fairnessScoreFor(a.name, fairness, slot);
    const bh = fairnessScoreFor(b.name, fairness, slot);
    return ah - bh || a.name.localeCompare(b.name);
  });
}

function allowedRollingSourcesForSlot(slot) {
  const allowedTransitions = {
    S2: ["S1", "S6"],
    S3: ["S1", "S2"],
    S4: ["S1", "S2", "S3"],
    "S4.1": ["S2"],
    "S4.2": ["S3"],
    S5: ["S4", "S4.1", "S4.2"],
    S6: ["S5"],
  };

  return allowedTransitions[slot] ?? [];
}

function isAllowedRollingHandoff(previousSlot, nextSlot) {
  return Boolean(previousSlot && allowedRollingSourcesForSlot(nextSlot).includes(previousSlot));
}

function formatCarryPath(slot, previousSlot = null) {
  if (previousSlot && isAllowedRollingHandoff(previousSlot, slot)) {
    return `${displayShiftLabel(previousSlot)} → ${displayShiftLabel(slot)}`;
  }

  const sources = allowedRollingSourcesForSlot(slot);
  if (sources.length === 0) return null;
  return `${sources.map((source) => displayShiftLabel(source)).join(" / ")} → ${displayShiftLabel(slot)}`;
}

function preferredPrimaryPoolForSlot(slot, eligible) {
  if (slot === "S1") {
    const s1Pool = eligible.filter((member) => member.shiftCode === "S1");
    return s1Pool.length > 0 ? s1Pool : eligible.filter((member) => member.shiftCode === "S6");
  }
  if (slot === "S2") {
    const s2Pool = eligible.filter((member) => member.shiftCode === "S2");
    if (s2Pool.length > 0) return s2Pool;
    const s1Pool = eligible.filter((member) => member.shiftCode === "S1");
    if (s1Pool.length > 0) return s1Pool;
    return eligible.filter((member) => member.shiftCode === "S6");
  }
  if (slot === "S4.1") return eligible.filter((member) => member.shiftCode === "S4");
  if (slot === "S4.2") return eligible.filter((member) => member.shiftCode === "S4");
  return eligible;
}

function chooseBackupForSlot(slot, eligible, primaryName) {
  if (!primaryName) return [];

  if (slot === "S1") {
    return eligible
      .filter((member) => member.name !== primaryName && (member.shiftCode === "S1" || member.shiftCode === "S6"))
      .map((member) => member.name);
  }

  if (slot === "S2") {
    return eligible
      .filter((member) => member.name !== primaryName && (member.shiftCode === "S1" || member.shiftCode === "S2" || member.shiftCode === "S6"))
      .map((member) => member.name);
  }

  const backup = eligible.find((member) => member.name !== primaryName)?.name ?? null;
  return backup ? [backup] : [];
}

function shouldCarryPrimaryForSlot({ slot, previousPrimary, previousSlot, eligible, fairness, slotIndex }) {
  if (!previousPrimary || !previousSlot || !isAllowedRollingHandoff(previousSlot, slot)) return false;
  const carriedMember = eligible.find((member) => member.name === previousPrimary);
  if (!carriedMember) return false;

  if (slot === "S2") {
    if (carriedMember.shiftCode === "S6") {
      const directHandoffPool = eligible.filter((member) => member.name !== previousPrimary && (member.shiftCode === "S1" || member.shiftCode === "S2"));
      return directHandoffPool.length === 0;
    }
    return true;
  }
  if (slot === "S3") return eligible.every((member) => member.shiftCode !== "S3");
  if (slot === "S4") return previousSlot === "S2" || previousSlot === "S3";

  const primaryPool = preferredPrimaryPoolForSlot(slot, eligible);
  const comparisonPool = primaryPool.length > 0 ? primaryPool : eligible;
  const referencePrimary = comparisonPool[0]?.name ?? null;
  if (!referencePrimary) return true;

  const previousScore = fairnessScoreFor(previousPrimary, fairness, slot);
  const minScore = fairnessScoreFor(referencePrimary, fairness, slot);
  const handoffThreshold = slotIndex < 2 ? 16 : 8;
  return (previousScore - minScore) <= handoffThreshold;
}

function choosePrimaryForSlot({
  slot,
  availableMembers,
  fairness,
  previousPrimary = null,
  previousSlot = null,
  slotIndex = 0,
}) {
  const eligible = sortByFairness(
    availableMembers.filter((member) => !member.asrhRestricted),
    fairness,
    slot,
  );

  if (eligible.length === 0) return { primary: null, backup: null, carried: false };

  if (shouldCarryPrimaryForSlot({ slot, previousPrimary, previousSlot, eligible, fairness, slotIndex })) {
    return {
      primary: previousPrimary,
      backup: chooseBackupForSlot(slot, eligible, previousPrimary),
      carried: true,
    };
  }

  const slotPrimaryEligible = preferredPrimaryPoolForSlot(slot, eligible);
  const primaryPool = slotPrimaryEligible.length > 0 ? slotPrimaryEligible : eligible;
  const primary = primaryPool[0]?.name ?? null;
  const backup = chooseBackupForSlot(slot, eligible, primary);
  return { primary, backup, carried: false };
}

function buildOffGroups(offMembers) {
  const groups = new Map();
  for (const member of offMembers) {
    const reason = member.offReason ?? "Off";
    if (!groups.has(reason)) groups.set(reason, []);
    groups.get(reason).push(member.name);
  }
  return Array.from(groups.entries()).map(([reason, names]) => `${reason}: ${names.join(", ")}`);
}

function displayShiftLabel(slot) {
  return slot === "S6" ? "S5.1" : slot;
}

function nextSlotInfo(date, slot) {
  const order = ["S1", "S2", "S3", "S4", "S4.1", "S4.2", "S5", "S6"];
  const idx = order.indexOf(slot);
  const nextSlot = order[(idx + 1) % order.length] ?? "S1";
  const nextDate = new Date(date);
  if (slot === "S6") nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return { slot: nextSlot, date: nextDate };
}

function formatClockTime(hour = 0, minute = 0) {
  const normalizedHour = Number(hour) || 0;
  const normalizedMinute = Number(minute) || 0;
  const displayHour = normalizedHour === 0 ? 12 : normalizedHour > 12 ? normalizedHour - 12 : normalizedHour;
  const meridiem = normalizedHour >= 12 ? "PM" : "AM";
  return `${displayHour}:${String(normalizedMinute).padStart(2, "0")} ${meridiem} PT`;
}

function formatPostTime(slot) {
  const def = SHIFT_DEFINITIONS[slot];
  if (!def) return "TBD";
  return formatClockTime(def.postHour, def.postMinute);
}

function formatHandoffTime(slot) {
  const def = SHIFT_DEFINITIONS[slot];
  if (!def) return "TBD";
  return formatClockTime(def.handoffHour ?? def.postHour, def.handoffMinute ?? def.postMinute);
}

function roundRobinAssignments(offMembers, assignees) {
  if (!offMembers.length || !assignees.length) return [];
  return offMembers.map((member, index) => `• ${member.name} (${member.offReason}) → ${assignees[index % assignees.length]}`);
}

function getOffOwnershipAssignees(byShift, primary, fallbackAssignees = []) {
  const coverageShiftCodes = ["S1", "S2", "S3", "S4"];
  const pool = coverageShiftCodes
    .flatMap((code) => byShift.get(code) ?? [])
    .filter((member, index, all) => all.findIndex((entry) => entry.name === member.name) === index)
    .filter((member) => !member.asrhRestricted)
    .map((member) => member.name)
    .filter((name) => name !== primary);

  const fallbackPool = fallbackAssignees.filter((name) => name !== primary);
  return pool.length > 0 ? pool : fallbackPool;
}

function previousPostedPrimary(scheduledPosts, dateKey, slot) {
  const order = ["S1", "S2", "S3", "S4", "S4.1", "S4.2", "S5", "S6"];
  const currentRank = order.indexOf(slot);
  const prior = scheduledPosts
    .filter((row) => ["posted", "planned", "applied"].includes(row.status.toLowerCase()))
    .sort((a, b) => {
      const aKey = `${a.date}|${String(order.indexOf(a.shift)).padStart(2, "0")}`;
      const bKey = `${b.date}|${String(order.indexOf(b.shift)).padStart(2, "0")}`;
      return aKey.localeCompare(bKey);
    })
    .filter((row) => row.date < dateKey || (row.date === dateKey && order.indexOf(row.shift) < currentRank));
  return prior[prior.length - 1] ?? null;
}

function shiftCodeForMember(roster, name) {
  return roster.members.find((member) => member.name === name)?.shiftCode ?? null;
}

function lateS4CarryAllowed({ slot, roster, scheduledPosts, dateKey }) {
  if (slot !== "S4.1" && slot !== "S4.2") return true;
  const s4Row = scheduledPosts.find((row) => row.date === dateKey && row.shift === "S4" && ["posted", "planned", "applied"].includes(row.status.toLowerCase())) ?? null;
  if (!s4Row?.primary) return false;
  const sourceShift = shiftCodeForMember(roster, s4Row.primary);
  if (slot === "S4.1") return sourceShift === "S2";
  if (slot === "S4.2") return sourceShift === "S3";
  return false;
}

function formatMessage({ slot, date, primary, backup, ntPrimary, offAssignments, offGroups, nextPrimary, nextPostTime, continuingFrom, onePersonShift = false, asrhUnassigned = false }) {
  const dateLabel = formatInZone(date, { month: "short", day: "numeric", year: "numeric" });
  const dayName = formatInZone(date, { weekday: "long" });
  const visibleSlot = displayShiftLabel(slot);
  const visibleContinuingFrom = continuingFrom ? displayShiftLabel(continuingFrom) : null;
  const nextAssignmentLabel = nextPrimary && nextPostTime
    ? `${nextPrimary} at ${nextPostTime}`
    : null;
  const handingClause = nextAssignmentLabel
    ? ` (handing to ${nextAssignmentLabel})`
    : "";
  const continuingClause = visibleContinuingFrom ? ` (continuing from ${visibleContinuingFrom})` : "";
  const primaryLabel = primary ?? "Unassigned";
  const backupNames = Array.isArray(backup) ? backup : (backup ? [backup] : []);
  const backupLabel = backupNames.length > 0 ? backupNames.join(", ") : "—";
  const offTodayLabel = offGroups
    .flatMap((group) => {
      const text = String(group ?? "");
      const parts = text.split(": ");
      return parts[1] ? parts[1].split(", ") : [text];
    })
    .filter(Boolean)
    .join(", ");

  if (onePersonShift && primary) {
    return [
      `NOC Work Allotment — Shift ${visibleSlot}`,
      `${dateLabel} (${dayName})`,
      "",
      "Active Service & Rolling Handoff:",
      `• Primary: ${primary}${handingClause}`,
      `• Backup: —`,
      "",
      "📋 New Tickets / Tasks:",
      `• Primary: ${primary}`,
      `• Backup: ${primary}`,
      "",
      "📌 Ticket Ownership - Off Members:",
      ...offAssignments,
      "",
      `Off Today: ${offTodayLabel}`,
      "",
      nextPostTime ? `⏩ Next shift posting: ${nextPostTime}` : null,
    ].join("\n");
  }

  return [
    `NOC Work Allotment — Shift ${visibleSlot}`,
    `${dateLabel} (${dayName})`,
    "",
    "Active Service & Rolling Handoff:",
    `• Primary: ${primaryLabel}${primary ? `${continuingClause}${handingClause}` : ""}`,
    `• Backup: ${backupLabel}`,
    "",
    "📋 New Tickets / Tasks:",
    `• Primary: ${ntPrimary.join(", ")}`,
    `• Backup: ${primary ?? "—"}`,
    "",
    "📌 Ticket Ownership - Off Members:",
    ...offAssignments,
    "",
    `Off Today: ${offTodayLabel}`,
    "",
    nextPostTime ? `⏩ Next shift posting: ${nextPostTime}` : null,
  ].join("\n");
}

function determineNextHandoffCandidates({ slot, primaryShiftCode, byShift, fairness }) {
  if (slot === "S1") {
    const targetSlot = primaryShiftCode === "S6" ? "S3" : "S2";
    let pool = (byShift.get(targetSlot) ?? []).filter((member) => !member.asrhRestricted);
    if (primaryShiftCode === "S6" && pool.length === 0) {
      pool = (byShift.get("S2") ?? []).filter((member) => !member.asrhRestricted);
    }
    return { pool, targetSlot: pool.length > 0 ? targetSlot : (primaryShiftCode === "S6" ? "S2" : targetSlot) };
  }

  if (slot === "S6") {
    const s2Pool = (byShift.get("S2") ?? []).filter((member) => !member.asrhRestricted);
    const s3Pool = (byShift.get("S3") ?? []).filter((member) => !member.asrhRestricted);
    if (s2Pool.length > 0) return { pool: s2Pool, targetSlot: "S2" };
    if (s3Pool.length > 0) return { pool: s3Pool, targetSlot: "S3" };
    const s1Pool = (byShift.get("S1") ?? []).filter((member) => !member.asrhRestricted);
    return { pool: s1Pool, targetSlot: "S1" };
  }

  const next = nextSlotInfo(new Date(), slot);
  const pool = asrhShiftCodesForSlot(next.slot)
    .flatMap((code) => byShift.get(code) ?? [])
    .filter((member, index, all) => all.findIndex((entry) => entry.name === member.name) === index)
    .filter((member) => !member.asrhRestricted);
  return { pool, targetSlot: next.slot };
}

export function generateWorkAllotmentFromData({ now = new Date(), slotOverride = null, roster, fairness, scheduledPosts = [], preferredPrimary = null, slotIndex = 0, fixedOffAssignments = null, fixedOffGroups = null }) {
  const slot = slotOverride ?? detectDueShiftSlot(now);
  if (!slot) return { status: "no_post", message: "NO_POST_REQUIRED" };

  const dateKey = localDateKey(now);
  if (!lateS4CarryAllowed({ slot, roster, scheduledPosts, dateKey })) {
    return { status: "no_post", slot, message: "NO_POST_REQUIRED", dateKey };
  }

  const { byShift, offMembers } = memberMapByShift(roster);
  const previous = previousPostedPrimary(scheduledPosts, dateKey, slot);
  const carryPrimary = preferredPrimary ?? previous?.primary ?? null;
  const carrySourceSlot = previous?.shift ?? null;

  const shiftPool = eligibleShiftCodesForSlot(slot).flatMap((code) => byShift.get(code) ?? []);
  const availableMembers = shiftPool
    .filter((member, index, all) => all.findIndex((entry) => entry.name === member.name) === index)
    .filter((member) => isAvailableLongEnoughForSlot(member, slot, 45));

  const fallbackCarryMember = carryPrimary
    ? roster.members.find((member) => (
      member.name === carryPrimary
      && !member.asrhRestricted
      && isAvailableLongEnoughForSlot(member, slot, 45)
    )) ?? null
    : null;

  if (availableMembers.length === 0 && !fallbackCarryMember) {
    throw new Error(`No active members found for ${slot} on ${dateKey}.`);
  }

  const effectiveAvailableMembers = availableMembers.length > 0
    ? availableMembers
    : [fallbackCarryMember];

  const asrhMembers = asrhShiftCodesForSlot(slot)
    .flatMap((code) => byShift.get(code) ?? [])
    .filter((member, index, all) => all.findIndex((entry) => entry.name === member.name) === index)
    .filter((member) => isAvailableLongEnoughForSlot(member, slot, 45))
    .filter((member) => canReceiveAsrhWithinFirstHour(member, slot));

  const carryCandidate = carryPrimary
    ? effectiveAvailableMembers.find((member) => member.name === carryPrimary && !member.asrhRestricted)
    : null;
  const canInjectCarryCandidate = Boolean(
    carryCandidate
    && carrySourceSlot
    && isAllowedRollingHandoff(carrySourceSlot, slot)
  );
  const selectionMembers = canInjectCarryCandidate && !asrhMembers.some((member) => member.name === carryCandidate.name)
    ? [...asrhMembers, carryCandidate]
    : asrhMembers;

  const selection = choosePrimaryForSlot({
    slot,
    availableMembers: selectionMembers,
    fairness,
    previousPrimary: carryPrimary,
    previousSlot: carrySourceSlot,
    slotIndex,
  });

  const fallbackRollingPool = sortByFairness(
    effectiveAvailableMembers.filter((member) => (
      !member.asrhRestricted
      && allowedRollingSourcesForSlot(slot).includes(member.shiftCode)
      && canReceiveAsrhWithinFirstHour(member, slot)
    )),
    fairness,
    slot,
  );
  const forcedCarrySelection = !selection.primary && canInjectCarryCandidate
    ? {
      primary: carryCandidate.name,
      backup: chooseBackupForSlot(slot, selectionMembers.length > 0 ? selectionMembers : effectiveAvailableMembers, carryCandidate.name),
      carried: true,
    }
    : !selection.primary && (slot === "S3" || slot === "S4") && fallbackRollingPool.length > 0
      ? {
        primary: fallbackRollingPool[0].name,
        backup: chooseBackupForSlot(slot, selectionMembers.length > 0 ? selectionMembers : effectiveAvailableMembers, fallbackRollingPool[0].name),
        carried: true,
      }
      : selection;

  const primary = forcedCarrySelection.primary ?? null;
  const s3BackupPool = slot === "S3"
    ? effectiveAvailableMembers.filter((member) => !member.asrhRestricted)
    : null;
  const resolvedBackupNames = slot === "S3" && primary
    ? chooseBackupForSlot(slot, s3BackupPool ?? [], primary)
    : forcedCarrySelection.backup;
  const backupNames = Array.isArray(resolvedBackupNames)
    ? resolvedBackupNames
    : (resolvedBackupNames ? [resolvedBackupNames] : []);
  const backup = backupNames.length > 0 ? backupNames.join(", ") : null;
  const asrhUnassigned = !primary;
  const primaryShiftCode = primary ? shiftCodeForMember(roster, primary) : null;

  const { pool: nextPool, targetSlot: nextTargetSlot } = determineNextHandoffCandidates({
    slot,
    primaryShiftCode,
    byShift,
    fairness,
  });
  const nextCandidates = sortByFairness(
    nextPool.filter((member) => isAvailableLongEnoughForSlot(member, nextTargetSlot, 45)),
    fairness,
    nextTargetSlot,
  );
  const nextPrimary = nextCandidates[0]?.name ?? carryPrimary ?? "next shift lead";
  const nextPostTime = formatPostTime(nextTargetSlot);

  const continuingFrom = (
    primary
    && forcedCarrySelection.carried
    && previous?.primary === primary
    && isAllowedRollingHandoff(previous?.shift ?? null, slot)
  ) ? (previous?.shift ?? null) : null;
  const carryPathUsed = continuingFrom ? formatCarryPath(slot, continuingFrom) : null;
  const carryPathRule = formatCarryPath(slot);

  const isTwoMemberShift = availableMembers.length === 2;
  const carriedWithoutHandoff = Boolean(forcedCarrySelection.carried && (slot === "S3" || slot === "S4"));
  let ntPrimary = isTwoMemberShift && primary && backupNames.length > 0
    ? [...backupNames]
    : effectiveAvailableMembers.filter((member) => member.name !== primary).map((member) => member.name);
  if (carriedWithoutHandoff) {
    ntPrimary = effectiveAvailableMembers
      .filter((member) => member.name !== primary)
      .map((member) => member.name);
  }
  if (!isTwoMemberShift) {
    for (const backupName of backupNames) {
      if (!ntPrimary.includes(backupName)) ntPrimary.push(backupName);
    }
  }
  const effectiveNtPrimary = ntPrimary.length > 0 ? ntPrimary : (primary ? [primary] : effectiveAvailableMembers.map((member) => member.name));
  const offOwnershipAssignees = getOffOwnershipAssignees(byShift, primary, effectiveNtPrimary);
  const offAssignments = fixedOffAssignments ?? roundRobinAssignments(offMembers, offOwnershipAssignees);
  const offGroups = fixedOffGroups ?? buildOffGroups(offMembers);

  const message = formatMessage({
    slot,
    date: now,
    primary,
    backup,
    ntPrimary: effectiveNtPrimary,
    offAssignments,
    offGroups,
    nextPrimary,
    nextPostTime,
    continuingFrom,
    onePersonShift: effectiveAvailableMembers.length === 1 && Boolean(primary),
    asrhUnassigned,
  });

  return {
    status: "ok",
    slot,
    primary,
    backup,
    ntPrimary: effectiveNtPrimary,
    message,
    offAssignments,
    offGroups,
    nextPrimary,
    nextPostTime,
    continuingFrom,
    carryPathUsed,
    carryPathRule,
    dateKey,
    primaryShiftCode,
    availableMembers: effectiveAvailableMembers.map((member) => ({ name: member.name, shiftCode: member.shiftCode })),
  };
}

function cloneFairnessSnapshot(fairness) {
  const byName = new Map();
  for (const [name, row] of fairness.byName.entries()) {
    byName.set(name, { ...row, groupScores: new Map(row.groupScores ?? []) });
  }
  return {
    ...fairness,
    byName,
  };
}

function applyFairnessDelta(fairnessSnapshot, name, slot, delta = 0) {
  const current = fairnessSnapshot.byName.get(name) ?? { score: 0, hours: 0, groupScores: new Map(), row: null, column: null, sheetName: fairnessSnapshot.sheetName };
  const groupKey = getFairnessGroupKeyForSlot(slot);
  const nextGroupScores = new Map(current.groupScores ?? []);
  if (groupKey) {
    nextGroupScores.set(groupKey, Number(nextGroupScores.get(groupKey) ?? 0) + Number(delta ?? 0));
  }
  const nextScore = Number(current.score ?? 0) + Number(delta ?? 0);
  fairnessSnapshot.byName.set(name, {
    ...current,
    score: nextScore,
    hours: nextScore,
    groupScores: nextGroupScores,
  });
  return { before: Number(current.score ?? 0), after: nextScore };
}

const DAILY_SHIFT_ORDER = ["S1", "S2", "S3", "S4", "S4.1", "S4.2", "S5", "S6"];

async function loadPlanningInputs(now = new Date(), tracker = {}) {
  const roster = await readRosterForDate(now);
  const targetMonthKey = monthKey(now);
  const monthRoster = await readRosterMonthEntries(targetMonthKey);
  const fairnessTracker = await readFairnessTrackerEntries(targetMonthKey);
  const fairnessEntries = sanitizeFairnessEntries(fairnessTracker.entries);
  const fairnessTotalsByName = fairnessTracker.totalsByName ?? new Map();
  const scheduledPosts = sanitizeScheduledPosts(tracker.scheduledPosts);
  const memberNames = dedupeMembers([...ALL_MEMBERS, ...roster.members.map((member) => member.name), ...(tracker.memberNames ?? [])]);
  const fairness = buildFairnessSnapshot({
    monthRoster,
    memberNames,
    targetMonthKey,
    targetDateKey: localDateKey(now),
    fairnessEntries,
    fairnessTotalsByName,
    fairnessSheetTitle: fairnessTracker.sheetTitle,
  });

  return {
    roster,
    monthRoster,
    fairness,
    scheduledPosts,
    fairnessEntries,
    fairnessSheetTitle: fairnessTracker.sheetTitle,
    fairnessSpreadsheetUrl: fairnessTracker.spreadsheetUrl,
    memberNames,
    fairnessWarning: null,
  };
}

export async function generateDueWorkAllotment({ now = new Date(), slotOverride = null, tracker = {} } = {}) {
  const { roster, fairness, scheduledPosts, fairnessWarning } = await loadPlanningInputs(now, tracker);
  const result = generateWorkAllotmentFromData({ now, slotOverride, roster, fairness, scheduledPosts });
  return {
    ...result,
    rosterSheet: roster.sheetName,
    fairnessSheet: fairness.sheetName,
    fairnessWarning,
    fairnessSummary: fairness.summary,
  };
}

export async function planWorkAllotmentsForDay({ now = new Date(), tracker = {} } = {}) {
  const { roster, fairness, scheduledPosts, fairnessEntries, fairnessSheetTitle, fairnessSpreadsheetUrl, memberNames, fairnessWarning, monthRoster } = await loadPlanningInputs(now, tracker);
  const planningFairness = cloneFairnessSnapshot(fairness);
  const planningScheduledPosts = [...scheduledPosts];
  const shifts = [];
  let currentPrimary = null;
  let sharedOffAssignments = null;
  let sharedOffGroups = null;

  for (const [slotIndex, slot] of DAILY_SHIFT_ORDER.entries()) {
    const result = generateWorkAllotmentFromData({
      now,
      slotOverride: slot,
      roster,
      fairness: planningFairness,
      scheduledPosts: planningScheduledPosts,
      preferredPrimary: currentPrimary,
      slotIndex,
      fixedOffAssignments: sharedOffAssignments,
      fixedOffGroups: sharedOffGroups,
    });

    if (result.status === "ok") {
      if (!sharedOffAssignments) sharedOffAssignments = [...result.offAssignments];
      if (!sharedOffGroups) sharedOffGroups = [...result.offGroups];
      const current = planningFairness.byName.get(result.primary) ?? { score: 0, hours: 0, groupScores: new Map(), row: null, column: null, sheetName: planningFairness.sheetName };
      const fairnessBefore = fairnessScoreFor(result.primary, planningFairness, result.slot);
      const fairnessDelta = slot === "S4.1" || slot === "S4.2" ? 5 : 8;
      const fairnessChange = applyFairnessDelta(planningFairness, result.primary, result.slot, fairnessDelta);
      const fairnessAfter = fairnessScoreFor(result.primary, planningFairness, result.slot);
      planningScheduledPosts.push({
        rowNumber: null,
        date: result.dateKey,
        shift: result.slot,
        primary: result.primary,
        backup: result.backup ?? "",
        slackTs: "",
        status: "planned",
        lastChecked: new Date().toISOString(),
      });
      shifts.push({ ...result, fairnessBefore, fairnessAfter, fairnessDelta, fairnessChange });
      currentPrimary = result.primary ?? currentPrimary;
    } else {
      shifts.push({ slot, status: result.status, message: result.message, dateKey: result.dateKey ?? localDateKey(now) });
      currentPrimary = null;
    }
  }

  for (let index = 0; index < shifts.length; index += 1) {
    const shift = shifts[index];
    if (shift.status !== "ok") continue;

    const nextShift = shifts.slice(index + 1).find((candidate) => candidate.status === "ok") ?? null;
    const actualNextPrimary = nextShift?.primary ?? null;
    const actualNextPostTime = nextShift ? formatHandoffTime(nextShift.slot) : null;

    shift.nextPrimary = actualNextPrimary;
    shift.nextPostTime = actualNextPostTime;

    if (actualNextPrimary && actualNextPrimary !== shift.primary) {
      shift.message = formatMessage({
        slot: shift.slot,
        date: now,
        primary: shift.primary,
        backup: shift.backup,
        ntPrimary: shift.ntPrimary,
        offAssignments: shift.offAssignments,
        offGroups: shift.offGroups,
        nextPrimary: actualNextPrimary,
        nextPostTime: actualNextPostTime,
        continuingFrom: shift.continuingFrom,
        onePersonShift: (shift.availableMembers?.length ?? 0) === 1,
      });
    } else {
      shift.message = formatMessage({
        slot: shift.slot,
        date: now,
        primary: shift.primary,
        backup: shift.backup,
        ntPrimary: shift.ntPrimary,
        offAssignments: shift.offAssignments,
        offGroups: shift.offGroups,
        nextPrimary: null,
        nextPostTime: actualNextPostTime,
        continuingFrom: shift.continuingFrom,
        onePersonShift: (shift.availableMembers?.length ?? 0) === 1,
      });
    }
  }

  const fairnessUpdates = Array.from(planningFairness.byName.entries())
    .map(([name, row]) => {
      const original = fairness.byName.get(name);
      const before = Number(original?.hours ?? 0);
      const after = Number(row?.hours ?? 0);
      return {
        name,
        before,
        after,
        delta: after - before,
        row: null,
        column: null,
        sheetName: fairnessSheetTitle,
        dateKey: localDateKey(now),
      };
    })
    .filter((row) => row.delta !== 0);

  return {
    status: "ok",
    dateKey: localDateKey(now),
    rosterSheet: roster.sheetName,
    fairnessSheet: fairness.sheetName,
    fairnessWarning,
    shifts,
    fairnessUpdates,
    fairnessSummary: fairness.summary,
    tracker: {
      fairnessEntries,
      scheduledPosts,
      memberNames,
      monthKey: monthKey(now),
      rosterMonthSheet: monthRoster.sheetTitle,
      fairnessSheetTitle,
      fairnessSpreadsheetUrl,
    },
  };
}

function mergeFairnessUpdatesIntoEntries(entries, updates) {
  const next = sanitizeFairnessEntries(entries);
  const byKey = new Map(next.map((entry) => [`${entry.name}__${entry.dateKey}`, { ...entry }]));

  for (const update of updates) {
    const key = `${update.name}__${update.dateKey}`;
    const existing = byKey.get(key);
    const currentHours = Number(existing?.hours ?? 0);
    const nextHours = currentHours + Number(update.delta ?? 0);

    if (nextHours > 0) {
      byKey.set(key, { name: update.name, dateKey: update.dateKey, hours: nextHours });
    } else {
      byKey.delete(key);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => `${a.dateKey}-${a.name}`.localeCompare(`${b.dateKey}-${b.name}`));
}

function upsertScheduledPosts(existingRows, plan, now = new Date()) {
  const nextRows = sanitizeScheduledPosts(existingRows).filter(
    (row) => !plan.shifts.some((shift) => shift.status === "ok" && shift.dateKey === row.date && shift.slot === row.shift),
  );

  for (const shift of plan.shifts) {
    if (shift.status !== "ok") continue;
    nextRows.push({
      rowNumber: null,
      date: shift.dateKey,
      shift: shift.slot,
      primary: shift.primary ?? "",
      backup: shift.backup ?? "",
      slackTs: "",
      status: "applied",
      lastChecked: now.toISOString(),
    });
  }

  return nextRows.sort((a, b) => `${a.date}-${a.shift}`.localeCompare(`${b.date}-${b.shift}`));
}

export async function applyWorkAllotmentsForDay({ now = new Date(), tracker = {} } = {}) {
  const plan = await planWorkAllotmentsForDay({ now, tracker });
  const fairnessEntries = mergeFairnessUpdatesIntoEntries(tracker.fairnessEntries, plan.fairnessUpdates);
  const scheduledPosts = upsertScheduledPosts(tracker.scheduledPosts, plan, now);

  return {
    ...plan,
    appliedFairnessUpdates: plan.fairnessUpdates,
    tracker: {
      fairnessEntries,
      scheduledPosts,
      memberNames: plan.tracker.memberNames,
      monthKey: plan.tracker.monthKey,
      fairnessSheetTitle: plan.tracker.fairnessSheetTitle,
      fairnessSpreadsheetUrl: plan.tracker.fairnessSpreadsheetUrl,
    },
  };
}

export async function upsertScheduledPostRecord({ dateKey, slot, primary, backup, slackTs = "", status = "posted", now = new Date(), scheduledPosts = [] }) {
  const nextRows = sanitizeScheduledPosts(scheduledPosts).filter((row) => !(row.date === dateKey && row.shift === slot));
  nextRows.push({
    rowNumber: null,
    date: dateKey,
    shift: slot,
    primary: normalizeName(primary),
    backup: normalizeName(backup),
    slackTs,
    status,
    lastChecked: now.toISOString(),
  });
  return {
    updated: true,
    rowNumber: null,
    scheduledPosts: nextRows,
  };
}

export async function postDueWorkAllotment({ now = new Date(), slotOverride = null, tracker = {} } = {}) {
  const generated = await generateDueWorkAllotment({ now, slotOverride, tracker });
  if (generated.status !== "ok") return generated;

  const slack = await postSlackMessage(generated.message, {
    channel: WORK_ALLOTMENT_CONFIG.slackChannelId,
    username: "Work Allotment Generator",
    icon_emoji: ":clipboard:",
  });
  if (!slack.posted) {
    throw new Error("Slack post failed. Check SLACK_BOT_TOKEN and channel access.");
  }

  return {
    ...generated,
    slackTs: slack.ts ?? null,
  };
}
