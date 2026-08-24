import { supabaseAdmin } from "./supabase-admin.js";
import { postSlackMessage } from "./slack.js";
import {
  SHIFT_DEFINITIONS,
  WORK_ALLOTMENT_CONFIG,
  planWorkAllotmentsForDay,
} from "./google-sheets-work-allotment.js";

const DAILY_SHIFT_ORDER = ["S1", "S2", "S3", "S4", "S4.1", "S4.2", "S5", "S6"];

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

async function getLatestAutomationRun() {
  try {
    const { data, error } = await supabaseAdmin
      .from("work_allotment_automation_runs")
      .select("*")
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    return null;
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

export async function ensureDailyWorkAllotmentJobs({ now = new Date(), force = false } = {}) {
  const operationalDate = localDateKey(now);
  const existing = await listJobsForOperationalDate(operationalDate);
  const hasFullPlan = DAILY_SHIFT_ORDER.every((slot) => existing.some((job) => job.shift === slot));
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

  return {
    ok: true,
    skipped: false,
    operationalDate,
    generatedCount: jobs.length,
    jobs: uniqueJobs(data ?? []),
    plan,
  };
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Slack post failed.";
      await supabaseAdmin
        .from("work_allotment_jobs")
        .update({ last_error: message })
        .eq("id", job.id);
      failures.push({ id: job.id, shift: job.shift, error: message });
    }
  }

  return { ok: true, dueCount: pending.length, postedCount: posted.length, posted, failures };
}

export async function runWorkAllotmentAutomation({ now = new Date() } = {}) {
  const existingJobs = await listJobsForOperationalDate(localDateKey(now));
  let generation = { ok: true, skipped: true, reason: "outside_generation_window", jobs: existingJobs };
  if (isGenerationWindow(now) || isGenerationDue(now, existingJobs)) {
    generation = await ensureDailyWorkAllotmentJobs({ now });
  }
  const posting = await postDueScheduledWorkAllotments({ now });
  return {
    ok: true,
    ranAt: now.toISOString(),
    generationWindow: isGenerationWindow(now),
    generation,
    posting,
  };
}

export async function getWorkAllotmentAutomationStatus({ now = new Date() } = {}) {
  const operationalDate = localDateKey(now);
  const jobs = await listJobsForOperationalDate(operationalDate);
  const recent = await listRecentJobs(24);
  const latestRun = await getLatestAutomationRun();
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
  };
}

export { recordAutomationRun };
