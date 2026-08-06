import { readRosterDailyEntries } from "../roster-shift.js";
import { postSlackMessage } from "./slack.js";

export const WORK_ALLOTMENT_CONFIG = {
  rosterSpreadsheetId: "14t85Jg97RXmjDg3cwBQOnYGVYoBZUPuTrHGz-SKtZA4",
  rosterSpreadsheetUrl: "https://docs.google.com/spreadsheets/d/14t85Jg97RXmjDg3cwBQOnYGVYoBZUPuTrHGz-SKtZA4/edit?gid=1728888175#gid=1728888175",
  rosterTabGid: "1728888175",
  fairnessTrackerMode: "embedded-widget",
  fairnessTrackerName: "In-app fairness tracker",
  slackChannelId: "C0AT7KXCA3W",
  slackChannelName: "test-ani",
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
  "Mahalakshmi Samiti",
  "Sriram Parisa",
  "Akash Hanvate",
  "Otukho Olembo",
];

export const SHIFT_DEFINITIONS = {
  S1: { label: "Shift 1", rosterCode: "S1", postHour: 3, postMinute: 25, start: "3:00 AM", end: "12:00 PM", next: "S2" },
  S2: { label: "Shift 2", rosterCode: "S2", postHour: 6, postMinute: 25, start: "6:00 AM", end: "3:00 PM", next: "S3" },
  S3: { label: "Shift 3", rosterCode: "S3", postHour: 8, postMinute: 25, start: "8:00 AM", end: "5:00 PM", next: "S4" },
  S4: { label: "Shift 4", rosterCode: "S4", postHour: 11, postMinute: 25, start: "11:00 AM", end: "8:00 PM", next: "S5" },
  "S4.1": { label: "Shift 4.1", rosterCode: "S4.1", postHour: 14, postMinute: 25, start: "2:25 PM", end: "8:00 PM", next: "S4.2" },
  "S4.2": { label: "Shift 4.2", rosterCode: "S4.2", postHour: 16, postMinute: 25, start: "4:25 PM", end: "8:00 PM", next: "S5" },
  S5: { label: "Shift 5", rosterCode: "S5", postHour: 19, postMinute: 25, start: "7:00 PM", end: "4:00 AM", next: "S6" },
  S6: { label: "Shift 6", rosterCode: "S6", postHour: 23, postMinute: 55, start: "11:30 PM", end: "8:30 AM", next: "S1" },
};

const SHIFT_MATCHERS = [
  { code: "S1", patterns: [/^3:?00\s*am\s*-\s*12:?00\s*pm$/i, /^s1$/i] },
  { code: "S2", patterns: [/^6:?00\s*am\s*-\s*3:?00\s*pm$/i, /^s2$/i] },
  { code: "S3", patterns: [/^8:?00\s*am\s*-\s*5:?00\s*pm$/i, /^s3$/i] },
  { code: "S4", patterns: [/^11:?00\s*am\s*-\s*8:?00\s*pm$/i, /^s4$/i] },
  { code: "S5", patterns: [/^7:?00\s*pm\s*-\s*4:?00\s*am$/i, /^s5$/i] },
  { code: "S6", patterns: [/^11:?30\s*pm\s*-\s*8:?30\s*am$/i, /^s6$/i] },
];

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
    S1: [180, 720], S2: [360, 900], S3: [480, 1020],
    S4: [660, 1200], S5: [1140, 240], S6: [1410, 510],
  };
  return Object.entries(windows).find(([, values]) => values[0] === start && values[1] === end)?.[0] ?? null;
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
  return Array.from(new Set(names.map((name) => normalizeName(name)).filter(Boolean)));
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

function buildFairnessSnapshot({ fairnessEntries = [], memberNames = [], targetMonthKey }) {
  const allNames = dedupeMembers([...ALL_MEMBERS, ...memberNames, ...fairnessEntries.map((entry) => entry.name)]);
  const byName = new Map();

  for (const name of allNames) {
    byName.set(name, { hours: 0, row: null, column: null, sheetName: "widget-tracker" });
  }

  for (const entry of fairnessEntries) {
    if (!entry.dateKey.startsWith(`${targetMonthKey}-`)) continue;
    const current = byName.get(entry.name) ?? { hours: 0, row: null, column: null, sheetName: "widget-tracker" };
    byName.set(entry.name, { ...current, hours: Number(current.hours ?? 0) + Number(entry.hours ?? 0) });
  }

  return { sheetName: "widget-tracker", byName, fallback: false };
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
  if (slot === "S2") return ["S1", "S2"];
  if (slot === "S3") return ["S1", "S2", "S3"];
  if (slot === "S4") return ["S2", "S3", "S4"];
  if (slot === "S4.1") return ["S2", "S3", "S4"];
  if (slot === "S4.2") return ["S3", "S4"];
  if (slot === "S5") return ["S4", "S5"];
  if (slot === "S6") return ["S5", "S6"];
  return [slot];
}

function fairnessHoursFor(name, fairness) {
  return Number(fairness.byName.get(name)?.hours ?? 0);
}

function sortByFairness(members, fairness) {
  return [...members].sort((a, b) => {
    const ah = fairnessHoursFor(a.name, fairness);
    const bh = fairnessHoursFor(b.name, fairness);
    return ah - bh || a.name.localeCompare(b.name);
  });
}

function choosePrimaryForSlot({
  availableMembers,
  fairness,
  previousPrimary = null,
  previousPrimaryStillAvailable = false,
  slotIndex = 0,
}) {
  const eligible = sortByFairness(
    availableMembers.filter((member) => !member.asrhRestricted),
    fairness,
  );

  if (eligible.length === 0) return { primary: null, backup: null };

  const backup = eligible[1]?.name ?? null;
  const previousHours = previousPrimary ? fairnessHoursFor(previousPrimary, fairness) : null;
  const minHours = fairnessHoursFor(eligible[0].name, fairness);
  const handoffThreshold = slotIndex < 2 ? 16 : 8;

  if (previousPrimaryStillAvailable && previousPrimary && previousHours !== null) {
    const shouldKeepPrimary = (previousHours - minHours) <= handoffThreshold;
    if (shouldKeepPrimary) {
      return {
        primary: previousPrimary,
        backup: eligible.find((member) => member.name !== previousPrimary)?.name ?? backup,
      };
    }
  }

  return { primary: eligible[0]?.name ?? null, backup };
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

function nextSlotInfo(date, slot) {
  const order = ["S1", "S2", "S3", "S4", "S4.1", "S4.2", "S5", "S6"];
  const idx = order.indexOf(slot);
  const nextSlot = order[(idx + 1) % order.length] ?? "S1";
  const nextDate = new Date(date);
  if (slot === "S6") nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return { slot: nextSlot, date: nextDate };
}

function formatPostTime(slot) {
  const def = SHIFT_DEFINITIONS[slot];
  if (!def) return "TBD";
  return `${def.postHour > 12 ? def.postHour - 12 : def.postHour}:${String(def.postMinute).padStart(2, "0")} ${def.postHour >= 12 ? "PM" : "AM"} PT`;
}

function roundRobinAssignments(offMembers, assignees) {
  if (!offMembers.length || !assignees.length) return [];
  return offMembers.map((member, index) => `• ${member.name} (${member.offReason}) → ${assignees[index % assignees.length]}`);
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

function formatMessage({ slot, date, primary, backup, ntPrimary, offAssignments, offGroups, nextPrimary, nextPostTime, continuingFrom, onePersonShift = false }) {
  const dateLabel = formatInZone(date, { month: "short", day: "numeric", year: "numeric" });
  const dayName = formatInZone(date, { weekday: "long" });
  const handingClause = nextPrimary && nextPostTime
    ? ` (handing to ${nextPrimary} at ${nextPostTime})`
    : "";
  const continuingClause = continuingFrom ? ` (continuing from ${continuingFrom})` : "";

  if (onePersonShift) {
    return `**NOC Work Allotment — Shift ${slot}**\n${dateLabel} (${dayName})\n\nOnly 1 person in the shift, ${primary} handles all the responsibilities and logs the AS&RH hours under their name until handoff.${handingClause ? ` Next handoff: ${nextPrimary} at ${nextPostTime}.` : ""}`;
  }

  return [
    `**NOC Work Allotment — Shift ${slot}**`,
    `${dateLabel} (${dayName})`,
    "",
    "**🧑 Active Service & Rolling Handoff:**",
    `• **Primary:** ${primary}${continuingClause}${handingClause}`,
    `• **Backup:** ${backup}`,
    nextPrimary && nextPostTime ? `• **Next handoff:** ${nextPrimary} at ${nextPostTime}` : null,
    "",
    "**📋 New Tickets / Tasks:**",
    `• **Primary:** ${ntPrimary.join(", ")}`,
    `• **Backup:** ${primary}`,
    "",
    "**📌 Ticket Ownership - Off Members:**",
    offAssignments.join("\n"),
    "",
    "**Off Today:**",
    offGroups.join("\n"),
    "",
    nextPrimary && nextPostTime ? `**⏩ Next shift posting / handoff:** ${nextPrimary} at ${nextPostTime}` : `**⏩ Next shift posting:** ${nextPostTime}`,
  ].filter(Boolean).join("\n");
}

export function generateWorkAllotmentFromData({ now = new Date(), slotOverride = null, roster, fairness, scheduledPosts = [], preferredPrimary = null, slotIndex = 0 }) {
  const slot = slotOverride ?? detectDueShiftSlot(now);
  if (!slot) return { status: "no_post", message: "NO_POST_REQUIRED" };

  const dateKey = localDateKey(now);
  if (!lateS4CarryAllowed({ slot, roster, scheduledPosts, dateKey })) {
    return { status: "no_post", slot, message: "NO_POST_REQUIRED", dateKey };
  }

  const { byShift, offMembers } = memberMapByShift(roster);
  const shiftPool = eligibleShiftCodesForSlot(slot).flatMap((code) => byShift.get(code) ?? []);
  const availableMembers = shiftPool.filter((member, index, all) => all.findIndex((entry) => entry.name === member.name) === index);
  if (availableMembers.length === 0) {
    throw new Error(`No active members found for ${slot} on ${dateKey}.`);
  }

  const soleMember = availableMembers.length === 1 ? availableMembers[0] : null;
  const previous = previousPostedPrimary(scheduledPosts, dateKey, slot);
  const carryPrimary = preferredPrimary ?? previous?.primary ?? null;
  const previousPrimaryStillAvailable = Boolean(carryPrimary && availableMembers.some((member) => member.name === carryPrimary && !member.asrhRestricted));

  const selection = choosePrimaryForSlot({
    availableMembers,
    fairness,
    previousPrimary: carryPrimary,
    previousPrimaryStillAvailable,
    slotIndex,
  });

  const primary = selection.primary ?? soleMember?.name ?? null;
  const backup = soleMember ? null : selection.backup;

  if (!primary) {
    throw new Error(`No eligible AS&RH Primary available for ${slot}.`);
  }

  const next = nextSlotInfo(now, slot);
  const nextPool = eligibleShiftCodesForSlot(next.slot).flatMap((code) => byShift.get(code) ?? []);
  const nextCandidates = sortByFairness(nextPool.filter((member) => !member.asrhRestricted), fairness);
  const nextPrimary = nextCandidates[0]?.name ?? carryPrimary ?? "next shift lead";
  const nextPostTime = formatPostTime(next.slot);

  const ntPrimary = availableMembers.filter((member) => member.name !== primary).map((member) => member.name);
  if (backup && !ntPrimary.includes(backup)) ntPrimary.push(backup);
  const effectiveNtPrimary = ntPrimary.length > 0 ? ntPrimary : [primary];
  const offAssignments = roundRobinAssignments(offMembers, effectiveNtPrimary);
  const offGroups = buildOffGroups(offMembers);
  const continuingFrom = (previous?.primary === primary || preferredPrimary === primary) ? (previous?.shift ?? null) : null;

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
    onePersonShift: availableMembers.length === 1,
  });

  const primaryShiftCode = shiftCodeForMember(roster, primary);

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
    dateKey,
    primaryShiftCode,
    availableMembers: availableMembers.map((member) => ({ name: member.name, shiftCode: member.shiftCode })),
  };
}

function cloneFairnessSnapshot(fairness) {
  const byName = new Map();
  for (const [name, row] of fairness.byName.entries()) {
    byName.set(name, { ...row });
  }
  return {
    ...fairness,
    byName,
  };
}

const DAILY_SHIFT_ORDER = ["S1", "S2", "S3", "S4", "S4.1", "S4.2", "S5", "S6"];

async function loadPlanningInputs(now = new Date(), tracker = {}) {
  const roster = await readRosterForDate(now);
  const fairnessEntries = sanitizeFairnessEntries(tracker.fairnessEntries);
  const scheduledPosts = sanitizeScheduledPosts(tracker.scheduledPosts);
  const memberNames = dedupeMembers([...ALL_MEMBERS, ...roster.members.map((member) => member.name), ...(tracker.memberNames ?? [])]);
  const fairness = buildFairnessSnapshot({ fairnessEntries, memberNames, targetMonthKey: monthKey(now) });

  return {
    roster,
    fairness,
    scheduledPosts,
    fairnessEntries,
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
    fairnessSheet: "Widget fairness tracker",
    fairnessWarning,
  };
}

export async function planWorkAllotmentsForDay({ now = new Date(), tracker = {} } = {}) {
  const { roster, fairness, scheduledPosts, fairnessEntries, memberNames, fairnessWarning } = await loadPlanningInputs(now, tracker);
  const planningFairness = cloneFairnessSnapshot(fairness);
  const planningScheduledPosts = [...scheduledPosts];
  const shifts = [];
  let currentPrimary = null;

  for (const [slotIndex, slot] of DAILY_SHIFT_ORDER.entries()) {
    const result = generateWorkAllotmentFromData({
      now,
      slotOverride: slot,
      roster,
      fairness: planningFairness,
      scheduledPosts: planningScheduledPosts,
      preferredPrimary: currentPrimary,
      slotIndex,
    });

    if (result.status === "ok") {
      const current = planningFairness.byName.get(result.primary) ?? { hours: 0, row: null, column: null, sheetName: planningFairness.sheetName };
      const fairnessBefore = Number(current.hours ?? 0);
      const fairnessDelta = slot === "S4.1" || slot === "S4.2" ? 5 : 8;
      const fairnessAfter = fairnessBefore + fairnessDelta;
      planningFairness.byName.set(result.primary, { ...current, hours: fairnessAfter });
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
      shifts.push({ ...result, fairnessBefore, fairnessAfter, fairnessDelta });
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
    const actualNextPostTime = nextShift ? formatPostTime(nextShift.slot) : null;

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
        sheetName: "widget-tracker",
        dateKey: localDateKey(now),
      };
    })
    .filter((row) => row.delta !== 0);

  return {
    status: "ok",
    dateKey: localDateKey(now),
    rosterSheet: roster.sheetName,
    fairnessSheet: "Widget fairness tracker",
    fairnessWarning,
    shifts,
    fairnessUpdates,
    tracker: {
      fairnessEntries,
      scheduledPosts,
      memberNames,
      monthKey: monthKey(now),
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
