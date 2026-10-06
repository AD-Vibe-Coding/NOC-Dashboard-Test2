import { supabaseAdmin } from "./supabase-admin.js";
import { defaultSlackUserIdFor } from "./reminder-service.js";
import { postSlackMessage } from "./slack.js";
import {
  SHIFT_DEFINITIONS,
  WORK_ALLOTMENT_CONFIG,
  getDailyShiftOrderForDate,
  getReadOnlyFairnessSnapshot,
  isTempHandoffExcludedByName,
  planWorkAllotmentsForDay,
  syncFairnessSheetForOperationalDate,
} from "./google-sheets-work-allotment.js";

function zonedParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: WORK_ALLOTMENT_CONFIG.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
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
  };
}

function localDateKey(date) {
  const p = zonedParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function addDaysToDateKey(dateKey, deltaDays) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const dt = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  dt.setUTCDate(dt.getUTCDate() + Number(deltaDays || 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function weekdayForDateKey(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: WORK_ALLOTMENT_CONFIG.timeZone,
    weekday: "long",
  }).format(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)));
}

function isWeekendOwnershipBlocked(operationalDate) {
  const weekday = weekdayForDateKey(operationalDate);
  return weekday === "Saturday" || weekday === "Sunday";
}

function shiftPostDateKey(operationalDate, shift) {
  return shift === "S6" ? addDaysToDateKey(operationalDate, 1) : operationalDate;
}

function statusPriority(status) {
  if (status === "posted") return 2;
  if (status === "planned") return 1;
  return 0;
}

function uniqueJobs(rows = []) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.operational_date}|${row.shift}`;
    const existing = byKey.get(key);
    if (!existing || statusPriority(row.status) >= statusPriority(existing.status) || Number(row.id ?? 0) > Number(existing.id ?? 0)) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => `${a.operational_date}-${a.shift}`.localeCompare(`${b.operational_date}-${b.shift}`));
}

function isGenerationWindow(now) {
  const p = zonedParts(now);
  return p.hour === 3 && p.minute === 10;
}

function isGenerationDue(now, existingJobs = []) {
  const p = zonedParts(now);
  const currentMinutes = p.hour * 60 + p.minute;
  const triggerMinutes = 3 * 60 + 10;
  const hasAnyJobs = Array.isArray(existingJobs) && existingJobs.length > 0;
  return !hasAnyJobs && currentMinutes >= triggerMinutes;
}

function isJobDue(job, now = new Date()) {
  if (!job || job.status === "posted") return false;
  const def = SHIFT_DEFINITIONS[job.shift];
  if (!def) return false;
  const nowKey = localDateKey(now);
  const p = zonedParts(now);
  const currentMinutes = p.hour * 60 + p.minute;
  const jobDate = String(job.post_date || "");
  if (!jobDate) return false;
  if (jobDate < nowKey) return true;
  if (jobDate > nowKey) return false;
  const postMinutes = Number(def.postHour) * 60 + Number(def.postMinute);
  return currentMinutes >= postMinutes;
}

function shouldRunWeekendFairnessSync(now = new Date()) {
  const p = zonedParts(now);
  const weekday = String(p.weekday ?? "");
  const currentMinutes = p.hour * 60 + p.minute;
  const cutoffMinutes = (Number(SHIFT_DEFINITIONS.S5.handoffHour) * 60) + Number(SHIFT_DEFINITIONS.S5.handoffMinute);
  return ["Friday", "Saturday", "Sunday"].includes(weekday) && currentMinutes >= cutoffMinutes;
}

async function listJobsForOperationalDate(operationalDate) {
  const { data, error } = await supabaseAdmin
    .from("work_allotment_jobs")
    .select("*")
    .eq("operational_date", operationalDate)
    .order("shift", { ascending: true });
  if (error) throw new Error(error.message);
  return uniqueJobs(data ?? []);
}

async function listRecentJobs(limit = 24) {
  const { data, error } = await supabaseAdmin
    .from("work_allotment_jobs")
    .select("*")
    .order("generated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return uniqueJobs(data ?? []);
}

function isMissingTableError(error) {
  return String(error?.message ?? "").includes("schema cache") || String(error?.message ?? "").includes("does not exist");
}

async function recordAutomationRun(run) {
  try {
    const { error } = await supabaseAdmin
      .from("work_allotment_automation_runs")
      .insert({
        action: run.action,
        ran_at: run.ran_at,
        generation_triggered: run.generation_triggered ?? null,
        generation_skipped: run.generation_skipped ?? null,
        due_count: run.due_count ?? null,
        posted_count: run.posted_count ?? null,
        failure_count: run.failure_count ?? null,
        note: run.note ?? "",
      });
    if (error) throw error;
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
  }
}

async function listRecentAutomationRuns(limit = 20) {
  try {
    const { data, error } = await supabaseAdmin
      .from("work_allotment_automation_runs")
      .select("*")
      .order("ran_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    return [];
  }
}

function serializeShiftJob(shift, operationalDate, generatedAt) {
  const postDate = shiftPostDateKey(operationalDate, shift.slot);
  const nextPostTime = shift.nextPostTime ?? null;
  return {
    operational_date: operationalDate,
    post_date: postDate,
    shift: shift.slot,
    primary: shift.primary ?? "",
    backup: shift.backup ?? "",
    nt_primary: JSON.stringify(shift.ntPrimary ?? []),
    message: shift.message,
    next_primary: shift.nextPrimary ?? "",
    next_post_time: nextPostTime,
    continuing_from: shift.continuingFrom ?? "",
    carry_path_used: shift.carryPathUsed ?? "",
    carry_path_rule: shift.carryPathRule ?? "",
    available_members_json: JSON.stringify(shift.availableMembers ?? []),
    post_time_label: `${String(SHIFT_DEFINITIONS[shift.slot]?.postHour ?? 0).padStart(2, "0")}:${String(SHIFT_DEFINITIONS[shift.slot]?.postMinute ?? 0).padStart(2, "0")} PT`,
    post_at: `${postDate}T${String(SHIFT_DEFINITIONS[shift.slot]?.postHour ?? 0).padStart(2, "0")}:${String(SHIFT_DEFINITIONS[shift.slot]?.postMinute ?? 0).padStart(2, "0")}:00 ${WORK_ALLOTMENT_CONFIG.timeZone}`,
    status: "planned",
    slack_ts: "",
    last_error: "",
    generated_at: generatedAt,
    posted_at: "",
  };
}

function parseOwnershipTaskAssignments(value) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function filterExcludedOwnershipAssignments(assignments = [], operationalDate) {
  return assignments.filter((assignment) => !isTempHandoffExcludedByName(assignment?.offMemberName, operationalDate));
}

function normalizeOwnershipKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function timeZoneOffsetMinutes(timeZone, date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date);
  const label = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = label.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

function zonedDateTimeToIso(dateKey, hour = 0, minute = 0, second = 0, timeZone = WORK_ALLOTMENT_CONFIG.timeZone) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  if (!year || !month || !day) return null;
  const utcGuess = new Date(Date.UTC(year, month - 1, day, Number(hour) || 0, Number(minute) || 0, Number(second) || 0));
  const offsetMinutes = timeZoneOffsetMinutes(timeZone, utcGuess);
  return new Date(utcGuess.getTime() - offsetMinutes * 60 * 1000).toISOString();
}

function parseClockTimeLabel(rawValue) {
  const raw = String(rawValue ?? "").trim();
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = String(match[3] ?? "").toUpperCase();

  if (meridiem === "AM") {
    if (hour === 12) hour = 0;
  } else if (hour !== 12) {
    hour += 12;
  }

  return { hour, minute };
}

function parseShiftStartTime(def) {
  return parseClockTimeLabel(def?.start);
}

function parseShiftEndTime(def) {
  return parseClockTimeLabel(def?.end);
}

function reminderStartAtForAssignment(assignment, operationalDate, generatedAt) {
  const shiftCode = String(assignment?.assigneeShiftCode ?? "").trim();
  const def = shiftCode ? SHIFT_DEFINITIONS[shiftCode] : null;
  if (!def) return generatedAt;

  const shiftStart = parseShiftStartTime(def);
  if (!shiftStart) return generatedAt;

  return zonedDateTimeToIso(operationalDate, shiftStart.hour, shiftStart.minute, 0) ?? generatedAt;
}

function laterIsoTimestamp(left, right) {
  if (!left) return right || null;
  if (!right) return left || null;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function shiftReminderCutoffAt(shiftCode, operationalDate) {
  const def = SHIFT_DEFINITIONS[String(shiftCode ?? "").trim()];
  if (!def) return null;
  const shiftEnd = parseShiftEndTime(def);
  if (!shiftEnd) return null;

  const shiftStart = parseShiftStartTime(def) ?? { hour: 0, minute: 0 };
  const endDateKey = (shiftEnd.hour * 60 + shiftEnd.minute) < (shiftStart.hour * 60 + shiftStart.minute)
    ? addDaysToDateKey(operationalDate, 1)
    : operationalDate;

  return zonedDateTimeToIso(endDateKey, shiftEnd.hour, shiftEnd.minute, 0);
}

function reminderCutoffAtForAssignment(assignment, operationalDate) {
  const sourceShifts = Array.from(new Set((assignment?.sourceShifts ?? []).map((shift) => String(shift ?? "").trim()).filter(Boolean)));
  if (sourceShifts.length === 0) {
    const assigneeShiftCode = String(assignment?.assigneeShiftCode ?? "").trim();
    return assigneeShiftCode ? shiftReminderCutoffAt(assigneeShiftCode, operationalDate) : null;
  }

  return sourceShifts.reduce((latest, shiftCode) => laterIsoTimestamp(latest, shiftReminderCutoffAt(shiftCode, operationalDate)), null);
}

function ownershipTaskReminderPolicy(task, now = new Date()) {
  const taskDate = String(task?.operational_date ?? localDateKey(now)).trim() || localDateKey(now);
  const maxReminders = 8;
  const intervalMinutes = Math.max(Number(task?.reminder_interval_minutes ?? 60) || 60, 60);
  const reminderCount = Number(task?.reminder_count ?? 0) || 0;
  const sourceShifts = String(task?.source_shift ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const reminderCutoffAt = sourceShifts.reduce(
    (latest, shiftCode) => laterIsoTimestamp(latest, shiftReminderCutoffAt(shiftCode, taskDate)),
    null,
  );

  return {
    intervalMinutes,
    maxReminders,
    reminderCount,
    reminderCutoffAt,
    reachedMaxReminders: reminderCount >= maxReminders,
    pastShiftCutoff: Boolean(reminderCutoffAt && new Date(reminderCutoffAt).getTime() <= now.getTime()),
  };
}

function buildOwnershipTaskRowForOffMember(assignment, operationalDate, generatedAt) {
  const assigneeName = String(assignment?.assigneeName ?? "").trim();
  const offMemberName = String(assignment?.offMemberName ?? "").trim();
  const offReason = String(assignment?.offReason ?? "Off").trim();
  const sourceShifts = Array.from(new Set((assignment?.sourceShifts ?? []).map((shift) => String(shift ?? "").trim()).filter(Boolean)));
  if (!assigneeName || !offMemberName) return null;

  const shiftLabel = sourceShifts.length > 0 ? sourceShifts.join(", ") : "No shift coverage";
  const reminderStartAt = reminderStartAtForAssignment(assignment, operationalDate, generatedAt);
  const reminderCutoffAt = reminderCutoffAtForAssignment({ ...assignment, sourceShifts }, operationalDate);
  const initialNextReminderAt = reminderCutoffAt && new Date(reminderStartAt).getTime() >= new Date(reminderCutoffAt).getTime()
    ? null
    : reminderStartAt;

  return {
    task_type: "work_allotment_off_members",
    dedupe_key: `work-allotment-off-member:${operationalDate}:${normalizeOwnershipKey(offMemberName)}`,
    operational_date: operationalDate,
    assignee_name: assigneeName,
    title: `Review ${offMemberName} tickets`,
    details: `Review tickets for: ${offMemberName} (WO · ${shiftLabel}). Mark this complete in My Tasks once ownership is fully handled.`,
    source_shift: sourceShifts.join(", ") || null,
    off_members_json: JSON.stringify([{ offMemberName, offReason, sourceShifts }]),
    status: "open",
    completed_at: null,
    start_at: reminderStartAt,
    next_reminder_at: initialNextReminderAt,
    last_reminded_at: null,
    reminder_interval_minutes: 60,
    reminder_count: 0,
    slack_user_id: defaultSlackUserIdFor(assigneeName),
    last_error: "",
    created_by: "work_allotment_automation",
  };
}

export function buildOwnershipTaskRows(plan, operationalDate, generatedAt) {
  if (isWeekendOwnershipBlocked(operationalDate)) return [];

  const plannedShifts = (plan?.shifts ?? []).filter(
    (shift) => shift.status === "ok" && Array.isArray(shift.offOwnershipAssignments) && shift.offOwnershipAssignments.length > 0,
  );
  if (plannedShifts.length === 0) return [];

  const assignmentsByOffMember = new Map();
  for (const shift of plannedShifts) {
    for (const assignment of shift.offOwnershipAssignments ?? []) {
      const assigneeName = String(assignment?.assigneeName ?? "").trim();
      const offMemberName = String(assignment?.offMemberName ?? "").trim();
      const offReason = String(assignment?.offReason ?? "Off").trim();
      const sourceShift = String(shift?.slot ?? "").trim();
      if (!assigneeName || !offMemberName) continue;
      if (isTempHandoffExcludedByName(offMemberName, operationalDate)) continue;

      const key = normalizeOwnershipKey(offMemberName);
      const existing = assignmentsByOffMember.get(key) ?? {
        assigneeName,
        assigneeShiftCode: assignment?.assigneeShiftCode ?? null,
        offMemberName,
        offReason,
        sourceShifts: new Set(),
      };
      if (sourceShift) existing.sourceShifts.add(sourceShift);
      assignmentsByOffMember.set(key, existing);
    }
  }

  return Array.from(assignmentsByOffMember.values())
    .map((assignment) => buildOwnershipTaskRowForOffMember({
      ...assignment,
      sourceShifts: Array.from(assignment.sourceShifts),
    }, operationalDate, generatedAt))
    .filter(Boolean);
}

async function syncOwnershipTasksForPlan(plan, operationalDate, generatedAt) {
  const taskRows = buildOwnershipTaskRows(plan, operationalDate, generatedAt);
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("ownership_tasks")
    .select("*")
    .eq("operational_date", operationalDate)
    .eq("task_type", "work_allotment_off_members");
  if (existingError) throw new Error(existingError.message);

  if (isWeekendOwnershipBlocked(operationalDate)) {
    let cleaned = 0;
    for (const existing of existingRows ?? []) {
      const { error } = await supabaseAdmin.from("ownership_tasks").delete().eq("id", existing.id);
      if (error) throw new Error(error.message);
      cleaned += 1;
    }
    return { created: 0, updated: 0, cleaned, tasks: [] };
  }

  let cleaned = 0;
  for (const existing of existingRows ?? []) {
    if (String(existing.status ?? "") === "completed") continue;
    const currentAssignments = parseOwnershipTaskAssignments(existing.off_members_json);
    const keptAssignments = filterExcludedOwnershipAssignments(currentAssignments, operationalDate);
    if (keptAssignments.length === currentAssignments.length) continue;

    if (keptAssignments.length === 0) {
      const { error } = await supabaseAdmin.from("ownership_tasks").delete().eq("id", existing.id);
      if (error) throw new Error(error.message);
      cleaned += 1;
      continue;
    }

    const offMember = keptAssignments[0] ?? null;
    const nextRow = offMember
      ? buildOwnershipTaskRowForOffMember({
        assigneeName: existing.assignee_name,
        offMemberName: offMember.offMemberName,
        offReason: offMember.offReason,
        sourceShifts: offMember.sourceShifts ?? [],
      }, operationalDate, generatedAt)
      : null;
    if (!nextRow) {
      const { error } = await supabaseAdmin.from("ownership_tasks").delete().eq("id", existing.id);
      if (error) throw new Error(error.message);
      cleaned += 1;
      continue;
    }

    const { error } = await supabaseAdmin
      .from("ownership_tasks")
      .update({
        dedupe_key: nextRow.dedupe_key,
        assignee_name: nextRow.assignee_name,
        title: nextRow.title,
        details: nextRow.details,
        source_shift: nextRow.source_shift,
        off_members_json: nextRow.off_members_json,
        slack_user_id: nextRow.slack_user_id,
        last_error: "",
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    cleaned += 1;
  }

  const existingByDedupe = new Map((existingRows ?? []).map((row) => [row.dedupe_key, row]));
  const nextDedupeKeys = new Set(taskRows.map((row) => row.dedupe_key));
  let created = 0;
  let updated = 0;

  for (const existing of existingRows ?? []) {
    if (nextDedupeKeys.has(existing.dedupe_key)) continue;
    const { error } = await supabaseAdmin.from("ownership_tasks").delete().eq("id", existing.id);
    if (error) throw new Error(error.message);
    cleaned += 1;
  }

  for (const row of taskRows) {
    const existing = existingByDedupe.get(row.dedupe_key);
    if (!existing) {
      const { error } = await supabaseAdmin.from("ownership_tasks").insert(row);
      if (error) throw new Error(error.message);
      created += 1;
      continue;
    }

    if (String(existing.status ?? "") === "completed") continue;

    const existingAssignee = String(existing.assignee_name ?? "").trim();
    const nextAssignee = String(row.assignee_name ?? "").trim();
    const assigneeChanged = Boolean(existingAssignee && nextAssignee && existingAssignee !== nextAssignee);

    if (assigneeChanged) {
      const reassignedNote = `Ownership handoff reassigned from ${existingAssignee} to ${nextAssignee}. Previous reminders stopped automatically.`;
      const { error: closeError } = await supabaseAdmin
        .from("ownership_tasks")
        .update({
          status: "completed",
          completed_at: generatedAt,
          next_reminder_at: null,
          last_error: reassignedNote,
        })
        .eq("id", existing.id)
        .eq("status", "open");
      if (closeError) throw new Error(closeError.message);

      const { error: insertError } = await supabaseAdmin.from("ownership_tasks").insert(row);
      if (insertError) throw new Error(insertError.message);
      cleaned += 1;
      created += 1;
      continue;
    }

    const existingReminderCount = Number(existing.reminder_count ?? 0) || 0;
    const hasReminderHistory = Boolean(existing.last_reminded_at);
    const nextReminderIntervalMinutes = Math.max(Number(existing.reminder_interval_minutes ?? row.reminder_interval_minutes ?? 60) || 60, 60);
    const policy = ownershipTaskReminderPolicy({
      ...existing,
      operational_date: row.operational_date,
      source_shift: row.source_shift,
      reminder_interval_minutes: nextReminderIntervalMinutes,
      reminder_count: existingReminderCount,
    }, new Date(generatedAt));
    const nextReminderAt = (policy.reachedMaxReminders || policy.pastShiftCutoff)
      ? null
      : (hasReminderHistory ? (existing.next_reminder_at || row.next_reminder_at) : row.next_reminder_at);

    const { error } = await supabaseAdmin
      .from("ownership_tasks")
      .update({
        title: row.title,
        details: row.details,
        source_shift: row.source_shift,
        off_members_json: row.off_members_json,
        slack_user_id: row.slack_user_id,
        start_at: row.start_at,
        next_reminder_at: nextReminderAt,
        reminder_interval_minutes: nextReminderIntervalMinutes,
        reminder_count: Math.min(existingReminderCount, policy.maxReminders),
        last_error: policy.reachedMaxReminders
          ? `Reminder cap reached (${policy.maxReminders}). No further reminders will be sent.`
          : (policy.pastShiftCutoff
            ? `Reminder window ended at ${policy.reminderCutoffAt}. No further reminders will be sent.`
            : ""),
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    updated += 1;
  }

  return { created, updated, cleaned, tasks: taskRows };
}

export async function reconcilePlannedWorkAllotmentJobs({ now = new Date() } = {}) {
  const operationalDate = localDateKey(now);
  const existingJobs = await listJobsForOperationalDate(operationalDate);
  const existingByShift = new Map(existingJobs.map((job) => [job.shift, job]));
  const plan = await planWorkAllotmentsForDay({ now });
  const okShifts = (plan.shifts ?? []).filter((shift) => shift.status === "ok");
  const generatedAt = new Date().toISOString();

  let inserted = 0;
  let updated = 0;
  const jobs = [];

  for (const shift of okShifts) {
    const nextJob = serializeShiftJob(shift, operationalDate, generatedAt);
    const existing = existingByShift.get(shift.slot);

    if (!existing) {
      const { data, error } = await supabaseAdmin
        .from("work_allotment_jobs")
        .insert(nextJob)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      inserted += 1;
      jobs.push(data);
      continue;
    }

    if (String(existing.status ?? "") === "posted") {
      jobs.push(existing);
      continue;
    }

    const { data, error } = await supabaseAdmin
      .from("work_allotment_jobs")
      .update({
        ...nextJob,
        status: existing.status ?? "planned",
        slack_ts: existing.slack_ts ?? "",
        posted_at: existing.posted_at ?? "",
        last_error: existing.last_error ?? "",
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    updated += 1;
    jobs.push(data);
  }

  const ownershipTasks = await syncOwnershipTasksForPlan(plan, operationalDate, generatedAt);

  return {
    ok: true,
    skipped: false,
    operationalDate,
    insertedCount: inserted,
    updatedCount: updated,
    generatedCount: okShifts.length,
    jobs: uniqueJobs(jobs),
    plan,
    ownershipTasks,
  };
}

export async function ensureDailyWorkAllotmentJobs({ now = new Date(), force = false } = {}) {
  const operationalDate = localDateKey(now);
  const existing = await listJobsForOperationalDate(operationalDate);
  const expectedSlots = getDailyShiftOrderForDate(now);
  const hasFullPlan = expectedSlots.every((slot) => existing.some((job) => job.shift === slot));
  if (hasFullPlan && !force) {
    return { ok: true, skipped: true, operationalDate, jobs: existing, reason: "already_generated" };
  }
  if (!force && !isGenerationDue(now, existing) && !isGenerationWindow(now)) {
    return { ok: true, skipped: true, operationalDate, jobs: existing, reason: "before_generation_window" };
  }

  const plan = await planWorkAllotmentsForDay({ now });
  const okShifts = (plan.shifts ?? []).filter((shift) => shift.status === "ok");
  const generatedAt = new Date().toISOString();
  const jobs = okShifts.map((shift) => serializeShiftJob(shift, operationalDate, generatedAt));

  await supabaseAdmin.from("work_allotment_jobs").delete().eq("operational_date", operationalDate);
  const { data, error } = await supabaseAdmin
    .from("work_allotment_jobs")
    .insert(jobs)
    .select("*");
  if (error) throw new Error(error.message);

  const ownershipTasks = await syncOwnershipTasksForPlan(plan, operationalDate, generatedAt);

  return {
    ok: true,
    skipped: false,
    operationalDate,
    generatedCount: jobs.length,
    jobs: uniqueJobs(data ?? []),
    plan,
    ownershipTasks,
  };
}

async function autoCloseStaleOwnershipTasks({ now = new Date() } = {}) {
  const today = localDateKey(now);
  const nowIso = now.toISOString();
  const { data: staleTasks, error } = await supabaseAdmin
    .from("ownership_tasks")
    .select("id, operational_date, assignee_name, title, status")
    .eq("task_type", "work_allotment_off_members")
    .eq("status", "open")
    .lt("operational_date", today);
  if (error) throw new Error(error.message);

  let autoClosed = 0;
  for (const task of staleTasks ?? []) {
    const taskDate = String(task.operational_date ?? "").trim();
    const note = taskDate
      ? `Auto-closed unfinished ownership task from ${taskDate} at day rollover.`
      : "Auto-closed unfinished ownership task at day rollover.";
    const { error: updateError } = await supabaseAdmin
      .from("ownership_tasks")
      .update({
        status: "auto_closed",
        completed_at: nowIso,
        next_reminder_at: null,
        last_error: note,
      })
      .eq("id", task.id)
      .eq("status", "open");
    if (updateError) throw new Error(updateError.message);
    autoClosed += 1;
  }

  return { autoClosed, today };
}

export async function dispatchDueOwnershipTaskReminders({ now = new Date() } = {}) {
  const { today, autoClosed } = await autoCloseStaleOwnershipTasks({ now });
  const nowIso = now.toISOString();
  const { data, error } = await supabaseAdmin
    .from("ownership_tasks")
    .select("*")
    .eq("task_type", "work_allotment_off_members")
    .eq("status", "open")
    .eq("operational_date", today)
    .lte("next_reminder_at", nowIso)
    .order("next_reminder_at", { ascending: true })
    .limit(25);
  if (error) throw new Error(error.message);

  let reminded = 0;
  let failed = 0;

  for (const task of data ?? []) {
    try {
      const taskDate = String(task.operational_date ?? localDateKey(now));
      const offMembers = parseOwnershipTaskAssignments(task.off_members_json);
      const activeOffMembers = filterExcludedOwnershipAssignments(offMembers, taskDate);

      if (activeOffMembers.length === 0) {
        const { error: closeError } = await supabaseAdmin
          .from("ownership_tasks")
          .update({
            status: "completed",
            completed_at: nowIso,
            next_reminder_at: null,
            last_error: "Auto-closed: all off-members on this task are temporarily excluded from handoff reminders.",
          })
          .eq("id", task.id);
        if (closeError) throw new Error(closeError.message);
        continue;
      }

      const policy = ownershipTaskReminderPolicy(task, now);
      if (policy.reachedMaxReminders) {
        const { error: cappedError } = await supabaseAdmin
          .from("ownership_tasks")
          .update({
            next_reminder_at: null,
            reminder_interval_minutes: policy.intervalMinutes,
            reminder_count: policy.maxReminders,
            last_error: `Reminder cap reached (${policy.maxReminders}). No further reminders will be sent.`,
          })
          .eq("id", task.id)
          .eq("status", "open");
        if (cappedError) throw new Error(cappedError.message);
        continue;
      }

      if (policy.pastShiftCutoff) {
        const { error: cutoffError } = await supabaseAdmin
          .from("ownership_tasks")
          .update({
            next_reminder_at: null,
            reminder_interval_minutes: policy.intervalMinutes,
            last_error: `Reminder window ended at ${policy.reminderCutoffAt}. No further reminders will be sent.`,
          })
          .eq("id", task.id)
          .eq("status", "open");
        if (cutoffError) throw new Error(cutoffError.message);
        continue;
      }

      const intervalMinutes = policy.intervalMinutes;
      const rawNextReminderAt = new Date(now.getTime() + intervalMinutes * 60 * 1000).toISOString();
      const claimedNextReminderAt = policy.reminderCutoffAt && new Date(rawNextReminderAt).getTime() >= new Date(policy.reminderCutoffAt).getTime()
        ? null
        : rawNextReminderAt;
      const { data: claimedTask, error: claimError } = await supabaseAdmin
        .from("ownership_tasks")
        .update({
          next_reminder_at: claimedNextReminderAt,
          reminder_interval_minutes: intervalMinutes,
          last_error: "",
        })
        .eq("id", task.id)
        .eq("status", "open")
        .lte("next_reminder_at", nowIso)
        .lt("reminder_count", policy.maxReminders)
        .select("id, reminder_count")
        .maybeSingle();
      if (claimError) throw new Error(claimError.message);
      if (!claimedTask) {
        continue;
      }

      const memberList = activeOffMembers.map((item) => `${item.offMemberName} (${item.offReason})`).join(", ") || "the listed off members";
      const text = `NOC Bot reminder: Please complete your off-member ticket ownership task for ${memberList}. Open My Tasks and click Completed once ownership is fully handled.`;
      const result = await postSlackMessage(text, {
        target_user_id: task.slack_user_id || undefined,
        username: "NOC Bot",
        icon_emoji: ":rotating_light:",
      });
      if (!result?.posted && !result?.demo) {
        throw new Error(result?.error || "Slack send failed");
      }

      const nextReminderCount = Number(claimedTask.reminder_count ?? task.reminder_count ?? 0) + 1;
      const finalNextReminderAt = nextReminderCount >= policy.maxReminders
        ? null
        : claimedNextReminderAt;
      const finalLastError = nextReminderCount >= policy.maxReminders
        ? `Reminder cap reached (${policy.maxReminders}). No further reminders will be sent.`
        : (finalNextReminderAt ? "" : `Reminder window ended at ${policy.reminderCutoffAt}. No further reminders will be sent.`);

      const { error: updateError } = await supabaseAdmin
        .from("ownership_tasks")
        .update({
          last_reminded_at: nowIso,
          next_reminder_at: finalNextReminderAt,
          reminder_interval_minutes: intervalMinutes,
          reminder_count: nextReminderCount,
          last_error: finalLastError,
        })
        .eq("id", task.id)
        .eq("status", "open");
      if (updateError) throw new Error(updateError.message);
      reminded += 1;
    } catch (reminderError) {
      const { error: updateError } = await supabaseAdmin
        .from("ownership_tasks")
        .update({
          last_error: reminderError instanceof Error ? reminderError.message : String(reminderError),
          next_reminder_at: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
        })
        .eq("id", task.id)
        .eq("status", "open");
      if (updateError) throw new Error(updateError.message);
      failed += 1;
    }
  }

  return { processed: (data ?? []).length, reminded, failed, autoClosed };
}

export async function postDueScheduledWorkAllotments({ now = new Date() } = {}) {
  const today = localDateKey(now);
  const yesterday = addDaysToDateKey(today, -1);
  const { data, error } = await supabaseAdmin
    .from("work_allotment_jobs")
    .select("*")
    .in("operational_date", [yesterday, today])
    .eq("status", "planned")
    .order("operational_date", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);

  const pending = uniqueJobs(data ?? []).filter((job) => isJobDue(job, now));
  const posted = [];
  const failures = [];
  const fairnessSyncs = [];

  for (const job of pending) {
    try {
      const slack = await postSlackMessage(job.message, {
        channel: WORK_ALLOTMENT_CONFIG.slackChannelId,
        username: "NOC Work Allotment Generator",
        icon_emoji: ":clipboard:",
      });
      if (!slack.posted) {
        throw new Error("Slack post failed. Check SLACK_BOT_TOKEN and channel access.");
      }
      const slackTs = slack.ts ?? "";
      const postedAt = new Date().toISOString();
      const { error: updateError } = await supabaseAdmin
        .from("work_allotment_jobs")
        .update({ status: "posted", slack_ts: slackTs, posted_at: postedAt, last_error: "" })
        .eq("id", job.id);
      if (updateError) throw new Error(updateError.message);
      posted.push({ id: job.id, shift: job.shift, slackTs });

      if (String(job.shift ?? "") === "S6") {
        try {
          const finalDayJobs = await listJobsForOperationalDate(String(job.operational_date ?? ""));
          const allPostedForDay = finalDayJobs.length > 0 && finalDayJobs.every((row) => String(row.status ?? "") === "posted");
          if (allPostedForDay) {
            const fairnessSync = await syncFairnessSheetForOperationalDate({
              operationalDate: String(job.operational_date ?? ""),
              jobs: finalDayJobs,
            });
            fairnessSyncs.push(fairnessSync);

            const syncMessage = fairnessSync.skipped
              ? `Fairness sheet sync skipped for ${fairnessSync.operationalDate}: ${fairnessSync.reason ?? "no changes"}.`
              : `Fairness sheet synced for ${fairnessSync.operationalDate}: ${fairnessSync.updatedCells} cells updated.`;

            await supabaseAdmin
              .from("work_allotment_jobs")
              .update({ last_error: syncMessage })
              .eq("id", job.id)
              .eq("status", "posted");
          }
        } catch (fairnessError) {
          const message = fairnessError instanceof Error ? fairnessError.message : String(fairnessError);
          fairnessSyncs.push({ ok: false, skipped: false, operationalDate: String(job.operational_date ?? ""), error: message });
          await supabaseAdmin
            .from("work_allotment_jobs")
            .update({ last_error: `Fairness sheet sync failed: ${message}` })
            .eq("id", job.id)
            .eq("status", "posted");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Slack post failed.";
      await supabaseAdmin
        .from("work_allotment_jobs")
        .update({ last_error: message })
        .eq("id", job.id);
      failures.push({ id: job.id, shift: job.shift, error: message });
    }
  }

  return { ok: true, dueCount: pending.length, postedCount: posted.length, posted, failures, fairnessSyncs };
}

export async function syncWeekendFairnessIfDue({ now = new Date() } = {}) {
  if (!shouldRunWeekendFairnessSync(now)) {
    return {
      ok: true,
      skipped: true,
      reason: "before_weekend_fairness_cutoff",
      operationalDate: localDateKey(now),
    };
  }

  const operationalDate = localDateKey(now);
  try {
    const jobs = await listJobsForOperationalDate(operationalDate);
    return await syncFairnessSheetForOperationalDate({ operationalDate, jobs });
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      reason: "weekend_fairness_sync_failed",
      operationalDate,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runWorkAllotmentAutomation({ now = new Date() } = {}) {
  const existingJobs = await listJobsForOperationalDate(localDateKey(now));
  let generation = { ok: true, skipped: true, reason: "outside_generation_window", jobs: existingJobs };
  if (isGenerationWindow(now) || isGenerationDue(now, existingJobs)) {
    generation = await ensureDailyWorkAllotmentJobs({ now });
  }
  const posting = await postDueScheduledWorkAllotments({ now });
  const ownershipReminders = await dispatchDueOwnershipTaskReminders({ now });
  const weekendFairness = await syncWeekendFairnessIfDue({ now });
  return {
    ok: true,
    ranAt: now.toISOString(),
    generationWindow: isGenerationWindow(now),
    generation,
    posting,
    ownershipReminders,
    weekendFairness,
  };
}

export async function getWorkAllotmentAutomationStatus({ now = new Date() } = {}) {
  const operationalDate = localDateKey(now);
  const jobs = await listJobsForOperationalDate(operationalDate);
  const recent = await listRecentJobs(24);
  const automationRuns = await listRecentAutomationRuns(20);
  const latestRun = automationRuns[0] ?? null;
  const latestManualRun = automationRuns.find((run) => String(run?.action ?? "").startsWith("manual-")) ?? null;
  const latestCronRun = automationRuns.find((run) => !String(run?.action ?? "").startsWith("manual-")) ?? null;
  let fairnessSummary = null;
  let fairnessTracker = null;
  let fairnessWarning = null;

  try {
    const fairnessSnapshot = await getReadOnlyFairnessSnapshot({ now });
    fairnessSummary = fairnessSnapshot.fairnessSummary ?? null;
    fairnessTracker = fairnessSnapshot.tracker ?? null;
    fairnessWarning = fairnessSnapshot.fairnessWarning ?? null;
  } catch (error) {
    fairnessWarning = error instanceof Error ? error.message : "Failed to load fairness data.";
  }

  return {
    ok: true,
    operationalDate,
    generationWindow: isGenerationWindow(now),
    jobCount: jobs.length,
    postedCount: jobs.filter((job) => job.status === "posted").length,
    plannedCount: jobs.filter((job) => job.status === "planned").length,
    jobs,
    recent,
    latestRun,
    latestCronRun,
    latestManualRun,
    fairnessSummary,
    fairnessTracker,
    fairnessWarning,
  };
}

export { recordAutomationRun };
