import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import {
  getRingCentralConfig,
  hasRingCentralConfig,
  isRingCentralConnected,
  listCallQueues,
  ringCentralFetch,
} from "../_lib/ringcentral.js";

type QueueMetrics = {
  queue_name: string;
  total: number;
  answered: number;
  abandoned: number;
  missed: number;
  system_handled: number;
  ringing_calls: number;
  avg_handle_seconds: number;
  avg_wait_seconds: number;
};

const TIME_ZONE = "America/Los_Angeles";
const REPORTING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const TARGET_QUEUE_TERMS = ["mobility", "network"];

function pacificDateString(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function last30DayRange(now = new Date()) {
  const from = new Date(now.getTime() - REPORTING_WINDOW_MS);
  return {
    fromDate: pacificDateString(from),
    toDate: pacificDateString(now),
    timeFrom: from.toISOString(),
    timeTo: now.toISOString(),
  };
}

function isTargetQueue(name: string) {
  const normalized = name.toLowerCase();
  return TARGET_QUEUE_TERMS.some((term) => normalized.includes(term));
}

function getQueueId(queue: any) {
  return String(queue?.id ?? queue?.queueId ?? "").trim();
}

function getQueueName(queue: any) {
  return String(queue?.name ?? queue?.queueName ?? "").trim();
}

function asRecord(value: any): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

function metricContainer(row: any) {
  return asRecord(row?.counters ?? row?.data?.counters ?? row?.data ?? row?.metrics ?? row);
}

function metricValue(value: any): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    // Some analytics views serialize durations as H:MM:SS or M:SS instead of seconds.
    if (/^\d+(?::\d{1,2}){1,2}(?:\.\d+)?$/.test(value.trim())) {
      const parts = value.trim().split(":").map(Number);
      return parts.length === 3
        ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : parts[0] * 60 + parts[1];
    }
    return 0;
  }
  if (Array.isArray(value)) return value.reduce((total, item) => total + metricValue(item), 0);
  const record = asRecord(value);
  for (const key of ["value", "sum", "total", "count", "aggregationValue", "aggregateValue", "average", "avg", "mean", "averageValue", "avgValue", "duration", "seconds", "values", "data", "results", "items"]) {
    if (record[key] !== undefined) return metricValue(record[key]);
  }
  return 0;
}

function findMetricByName(value: any, name: string, depth = 0): any {
  if (!value || typeof value !== "object" || depth > 8) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMetricByName(item, name, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = asRecord(value);
  const key = Object.keys(record).find((entry) => entry.toLowerCase() === name.toLowerCase());
  if (key) return record[key];
  for (const child of Object.values(record)) {
    const found = findMetricByName(child, name, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function metricByName(row: any, name: string) {
  const containers = [
    row?.counters,
    row?.timers,
    row?.data?.counters,
    row?.data?.timers,
    row?.data?.duration,
    row?.data,
    row?.metrics,
    row,
  ];
  for (const container of containers) {
    const found = findMetricByName(container, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

function categoryValue(metric: any, categoryNames: string[]) {
  if (metric == null) return 0;
  const normalized = new Set(categoryNames.map((name) => name.toLowerCase().replace(/[^a-z]/g, "")));
  const findCategory = (value: any, depth = 0): number | undefined => {
    if (!value || typeof value !== "object" || depth > 8) return undefined;
    if (Array.isArray(value)) {
      for (const item of value) {
        const rawLabel = item?.name ?? item?.key ?? item?.type ?? item?.result ?? item?.segment
          ?? item?.response ?? item?.callResponse ?? item?.responseType
          ?? item?.segmentName ?? item?.segmentType ?? item?.callSegment ?? item?.category ?? item?.label ?? "";
        const labelValue = rawLabel && typeof rawLabel === "object"
          ? rawLabel.name ?? rawLabel.value ?? rawLabel.key ?? rawLabel.label ?? ""
          : rawLabel;
        const label = String(labelValue).toLowerCase().replace(/[^a-z]/g, "");
        if (normalized.has(label)) return metricValue(item);
        const nested = findCategory(item, depth + 1);
        if (nested !== undefined) return nested;
      }
      return undefined;
    }
    const record = asRecord(value);
    for (const [key, child] of Object.entries(record)) {
      if (normalized.has(key.toLowerCase().replace(/[^a-z]/g, ""))) return metricValue(child);
    }
    for (const child of Object.values(record)) {
      const nested = findCategory(child, depth + 1);
      if (nested !== undefined) return nested;
    }
    return undefined;
  };
  return findCategory(metric) ?? 0;
}

function getRows(payload: any): any[] {
  const candidates = [payload?.records, payload?.data?.records, payload?.data, payload?.results];
  return candidates.find(Array.isArray) ?? [];
}

function queueGroupingValue(row: any) {
  const dimensions = row?.grouping ?? row?.key ?? row?.dimensions ?? row?.queue ?? {};
  if (Array.isArray(dimensions)) {
    return dimensions.find((item) => /queues?/i.test(String(item?.name ?? item?.key ?? item?.type ?? ""))) ?? {};
  }
  return dimensions?.Queues ?? dimensions?.queues ?? dimensions?.Queue ?? dimensions?.queue ?? dimensions;
}

function rowQueueId(row: any) {
  const value = queueGroupingValue(row);
  const record = asRecord(value);
  const id = record.id ?? record.queueId ?? record.key ?? record.value ?? row?.queueId ?? row?.groupId ?? row?.id;
  return String(id ?? (typeof value === "string" || typeof value === "number" ? value : "")).trim();
}

function rowQueueName(row: any) {
  const value = queueGroupingValue(row);
  const record = asRecord(value);
  return String(record.name ?? record.queueName ?? record.label ?? row?.queueName ?? row?.groupName ?? row?.name ?? "").trim();
}

function buildQueueMetrics(row: any, queueName: string): QueueMetrics {
  const callsByResponse = metricByName(row, "callsByResponse");
  const callsByType = metricByName(row, "callsByType");
  const callsByResult = metricByName(row, "callsByResult");
  const allCalls = metricValue(metricByName(row, "allCalls"));
  const responseAnswered = categoryValue(callsByResponse, ["answered"]);
  const queueAnswered = categoryValue(callsByType, ["fromQueue", "from queue"]);
  const answered = queueAnswered || responseAnswered;
  const notAnswered = categoryValue(callsByResponse, ["notanswered", "not answered"]);
  const rawAbandoned = categoryValue(callsByResult, ["abandoned", "abandonedbycaller"]);
  const missed = categoryValue(callsByResult, ["missed", "noanswer"]);
  const systemHandled = categoryValue(callsByResult, ["voicemail"])
    + categoryValue(callsByResult, ["accepted"]);
  const callsBySegment = metricByName(row, "callsSegments");
  const ringingCalls = categoryValue(callsBySegment, ["ringing"]);
  const resultTotal = ["completed", "abandoned", "voicemail", "missed", "accepted", "unknown"]
    .reduce((sum, category) => sum + categoryValue(callsByResult, [category]), 0);
  const timers = asRecord(row?.timers ?? row?.data?.timers ?? row?.data?.duration ?? {});
  const callDuration = metricByName({ ...row, data: { ...asRecord(row?.data), ...timers } }, "callsSegmentsDuration");
  const ringingSeconds = categoryValue(callDuration, ["ringing"]);
  const talkSeconds = categoryValue(callDuration, ["liveTalk", "livetalk", "talk", "talkTime"]);
  const holdSeconds = categoryValue(callDuration, ["hold", "holds", "holdTime", "onHold"]);
  const answeredDurationSeconds = categoryValue(
    metricByName(row, "callsDurationByResponse"),
    ["answered", "answer", "connected"],
  );
  const queueDurationSeconds = categoryValue(metricByName(row, "callsDurationByType"), ["fromQueue", "from queue"]);
  // The RingCentral Queue Report defines handle time as talk + hold.
  // Use queue-call duration before the broader answered-call timer when segment data is absent.
  const handleDurationSeconds = talkSeconds + holdSeconds || queueDurationSeconds || answeredDurationSeconds;
  // Queue grouping can omit calls from allCalls that are represented by queue-specific response metrics.
  const queueTotal = queueAnswered > 0 && notAnswered > 0 ? queueAnswered + notAnswered : 0;
  const normalizedTotal = queueTotal || allCalls || resultTotal;
  // Queue Report "Abandoned" includes every inbound call not answered by a user,
  // including voicemail/auto outcomes. Keep the narrower API result only as a
  // fallback when the response does not provide usable total/answered counts.
  const abandoned = normalizedTotal > 0
    ? Math.max(0, normalizedTotal - answered)
    : rawAbandoned;

  return {
    queue_name: queueName,
    total: normalizedTotal,
    answered,
    abandoned,
    missed,
    system_handled: systemHandled,
    ringing_calls: ringingCalls,
    avg_handle_seconds: answered > 0 ? handleDurationSeconds / answered : 0,
    avg_wait_seconds: ringingCalls > 0 ? ringingSeconds / ringingCalls : 0,
  };
}

function periodDateFrom(value: any): string {
  if (typeof value === "string" || typeof value === "number") {
    const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
    return match?.[0] ?? "";
  }
  if (value && typeof value === "object") {
    for (const key of ["timeFrom", "startTime", "start", "date", "timestamp", "time", "periodStart", "key"]) {
      const result = periodDateFrom(value[key]);
      if (result) return result;
    }
  }
  return "";
}

function metricRow(value: any) {
  return ["allCalls", "callsByResponse", "callsByType", "callsByResult", "callsSegments"].some((key) => metricByName(value, key) !== undefined);
}

function timelineMetrics(payload: any, interval: "week" | "month", queueById: Map<string, string>, requestedQueues: any[]) {
  const output: Array<QueueMetrics & { interval_type: string; period_start: string }> = [];
  const roots = [payload?.records, payload?.data?.records, payload?.data, payload?.results].filter(Boolean);
  const visited = new Set<any>();

  const visit = (value: any, inheritedQueue = "", inheritedPeriod = "") => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, inheritedQueue, inheritedPeriod));
      return;
    }

    const queueId = rowQueueId(value);
    const queueName = rowQueueName(value) || inheritedQueue || queueById.get(queueId) || "";
    const periodStart = periodDateFrom(value) || inheritedPeriod;
    if (metricRow(value) && queueName && periodStart) {
      output.push({ ...buildQueueMetrics(value, queueName), interval_type: interval, period_start: periodStart });
    }

    // Timeline responses nest period values beneath queue groups in several
    // shapes; carry the queue and period dimensions down to each metric row.
    for (const [key, child] of Object.entries(value)) {
      if (["counters", "timers", "metrics", "callsByResponse", "callsByType", "callsByResult", "callsSegments"].includes(key)) continue;
      const childPeriod = periodDateFrom(key) || periodStart;
      visit(child, queueName, childPeriod);
    }
  };
  roots.forEach((root) => visit(root));

  // A single-queue response may omit the queue dimension entirely.
  if (requestedQueues.length === 1) {
    const unnamed: any[] = [];
    const collect = (value: any, period = "") => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) return value.forEach((item) => collect(item, period));
      const ownPeriod = periodDateFrom(value) || period;
      if (metricRow(value) && ownPeriod && !rowQueueName(value)) unnamed.push({ value, period: ownPeriod });
      Object.entries(value).forEach(([key, child]) => {
        if (!["counters", "timers", "metrics", "callsByResponse", "callsByType", "callsByResult", "callsSegments"].includes(key)) collect(child, periodDateFrom(key) || ownPeriod);
      });
    };
    roots.forEach((root) => collect(root));
    const known = new Set(output.map((row) => `${row.period_start}|${row.queue_name}`));
    for (const item of unnamed) {
      const name = getQueueName(requestedQueues[0]);
      if (!known.has(`${item.period}|${name}`)) output.push({ ...buildQueueMetrics(item.value, name), interval_type: interval, period_start: item.period });
    }
  }
  return [...new Map(output.map((row) => [`${row.period_start}|${row.queue_name}`, row])).values()];
}

async function fetchTimeline(req: VercelRequest, res: VercelResponse, interval: "Week" | "Month", targetQueues: any[]) {
  const now = new Date();
  // RingCentral call history is available from October 2026 onward.
  const from = new Date("2026-10-01T00:00:00-07:00");
  const requestBody = {
    grouping: { groupBy: "Queues", keys: targetQueues.map(getQueueId) },
    timeSettings: { timeZone: TIME_ZONE, timeRange: { timeFrom: from.toISOString(), timeTo: now.toISOString() } },
    callFilters: { directions: ["Inbound"] },
    responseOptions: {
      counters: {
        allCalls: true,
        callsByResponse: true,
        callsByType: true,
        callsByResult: true,
        callsSegments: true,
      },
      timers: {
        callsSegmentsDuration: true,
        callsDurationByResponse: true,
        callsDurationByType: true,
      },
    },
  };
  const response = await ringCentralFetch(req, res, `/analytics/calls/v1/accounts/~/timeline/fetch?interval=${interval}&page=1&perPage=20`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(errorMessage(response.status, raw));
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new Error("RingCentral returned an unreadable analytics timeline response."); }
}

async function loadStoredHistory() {
  const all: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseAdmin.from("ringcentral_call_metrics")
      .select("interval_type,period_start,queue_name,total,answered,abandoned,missed,system_handled,ringing_calls,avg_handle_seconds,avg_wait_seconds")
      .order("period_start", { ascending: true }).range(offset, offset + 999);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return {
    weekly: all.filter((row) => row.interval_type === "week"),
    monthly: all.filter((row) => row.interval_type === "month"),
  };
}

function errorMessage(status: number, raw: string) {
  let detail = raw.slice(0, 240);
  try {
    const parsed = JSON.parse(raw);
    detail = String(parsed?.message ?? parsed?.error_description ?? detail);
  } catch { /* keep the response text */ }

  if (status === 403 || status === 404) {
    return `RingCentral Business Analytics is not available to this app/account (HTTP ${status}). Enable the Analytics permission for the RingCentral app and the Business Analytics service for the account, then reconnect RingCentral. ${detail}`;
  }
  return `RingCentral call analytics failed (HTTP ${status}): ${detail}`;
}

async function getStoredAnalyticsResponse() {
  const history = await loadStoredHistory();
  const allRows = [...history.monthly, ...history.weekly];
  const queues_found = [...new Set(allRows.map((row) => row.queue_name))].sort();
  const latestMonth = [...history.monthly]
    .map((row) => row.period_start.slice(0, 7))
    .sort()
    .at(-1);
  const records = latestMonth
    ? history.monthly.filter((row) => row.period_start.slice(0, 7) === latestMonth)
    : [];
  const from_date = latestMonth ? `${latestMonth}-01` : "";
  const to_date = latestMonth
    ? new Date(Date.UTC(Number(latestMonth.slice(0, 4)), Number(latestMonth.slice(5, 7)), 0)).toISOString().slice(0, 10)
    : "";

  return {
    source: "database" as const,
    period: "stored_history" as const,
    from_date,
    to_date,
    records,
    history,
    queues_found,
    warning: records.length ? null : "No saved monthly call history yet. Use Sync latest data to fetch and store RingCentral history.",
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    try {
      return res.status(200).json(await getStoredAnalyticsResponse());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ code: "RINGCENTRAL_HISTORY_READ_ERROR", error: message.slice(0, 400) });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!hasRingCentralConfig(req)) {
    return res.status(503).json({
      code: "RINGCENTRAL_NOT_CONFIGURED",
      error: "RingCentral OAuth is not fully configured for this app.",
    });
  }
  if (!(await isRingCentralConnected(req))) {
    return res.status(401).json({
      code: "RINGCENTRAL_NOT_CONNECTED",
      error: "Connect RingCentral to load call analytics.",
    });
  }

  const range = last30DayRange();

  try {
    const config = getRingCentralConfig(req);
    const allQueues = await listCallQueues(req, res);
    const configuredNames = config.queueNames.map((name) => name.toLowerCase());
    const matchingQueues = [...new Map(
      allQueues
        .filter((queue) => getQueueId(queue) && isTargetQueue(getQueueName(queue)))
        .map((queue) => [getQueueId(queue), queue]),
    ).values()];
    const configuredMatches = matchingQueues.filter((queue) => {
      const name = getQueueName(queue).toLowerCase();
      return configuredNames.some((configuredName) => name.includes(configuredName) || configuredName.includes(name));
    });
    // Prefer explicitly configured queue names when they match; otherwise use
    // the Mobility/Network queues returned by RingCentral (queue names can vary
    // slightly between accounts, e.g. "Mobility Support" vs "Mobility Queue").
    const targetQueues = configuredMatches.length > 0 ? configuredMatches : matchingQueues;

    if (targetQueues.length === 0) {
      const history = await loadStoredHistory();
      return res.status(200).json({
        source: "ringcentral",
        period: "last_30_days",
        from_date: range.fromDate,
        to_date: range.toDate,
        records: [],
        history,
        queues_found: [],
        warning: "No configured Mobility or Network support call queues were found in RingCentral.",
      });
    }

    const requestBody = {
      grouping: {
        groupBy: "Queues",
        keys: targetQueues.map(getQueueId),
      },
      timeSettings: {
        timeZone: TIME_ZONE,
        timeRange: { timeFrom: range.timeFrom, timeTo: range.timeTo },
      },
      callFilters: { directions: ["Inbound"] },
      responseOptions: {
        counters: {
          allCalls: { aggregationType: "Sum" },
          callsByResponse: { aggregationType: "Sum" },
          callsByType: { aggregationType: "Sum" },
          callsByResult: { aggregationType: "Sum" },
          callsSegments: { aggregationType: "Sum" },
        },
        timers: {
          callsSegmentsDuration: { aggregationType: "Sum" },
          callsDurationByResponse: { aggregationType: "Sum" },
          callsDurationByType: { aggregationType: "Sum" },
        },
      },
    };

    const response = await ringCentralFetch(
      req,
      res,
      "/analytics/calls/v1/accounts/~/aggregation/fetch",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      },
    );
    const raw = await response.text();
    if (!response.ok) {
      const message = errorMessage(response.status, raw);
      return res.status(response.status === 401 ? 401 : response.status === 403 ? 403 : response.status === 429 ? 429 : 502).json({
        code: response.status === 403 || response.status === 404 ? "RINGCENTRAL_ANALYTICS_SCOPE_REQUIRED" : "RINGCENTRAL_ANALYTICS_ERROR",
        error: message,
      });
    }

    let payload: any;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      return res.status(502).json({ error: "RingCentral returned an unreadable analytics response." });
    }

    const queueById = new Map(targetQueues.map((queue) => [getQueueId(queue), getQueueName(queue)]));
    const responseRows = getRows(payload);
    const records = responseRows.map((row: any, index: number) => {
      const id = rowQueueId(row);
      const name = rowQueueName(row)
        || queueById.get(id)
        || (targetQueues.length === 1 ? getQueueName(targetQueues[0]) : "")
        // The request groups only by the ordered queue keys. Some RingCentral
        // responses omit the dimension label, so retain the corresponding key
        // when the API returns exactly one aggregate row per requested queue.
        || (responseRows.length === targetQueues.length ? getQueueName(targetQueues[index]) : "");
      return name ? buildQueueMetrics(row, name) : null;
    }).filter((row: QueueMetrics | null): row is QueueMetrics => Boolean(row));

    const [weeklyTimeline, monthlyTimeline] = await Promise.all([
      fetchTimeline(req, res, "Week", targetQueues),
      fetchTimeline(req, res, "Month", targetQueues),
    ]);
    const queueNamesById = new Map(targetQueues.map((queue) => [getQueueId(queue), getQueueName(queue)]));
    const syncedAt = new Date().toISOString();
    const newHistory = [
      ...timelineMetrics(weeklyTimeline, "week", queueNamesById, targetQueues),
      ...timelineMetrics(monthlyTimeline, "month", queueNamesById, targetQueues),
    ].map((row) => ({ ...row, synced_at: syncedAt }));

    if (newHistory.length) {
      // Replace the saved snapshot only after RingCentral has returned a fresh,
      // non-empty timeline. This removes stale/incorrect metrics while keeping
      // old data intact if the upstream pull fails or returns no history.
      const { error: deleteError } = await supabaseAdmin.from("ringcentral_call_metrics")
        .delete()
        .not("id", "is", null);
      if (deleteError) throw deleteError;

      const { error: insertError } = await supabaseAdmin.from("ringcentral_call_metrics")
        .insert(newHistory);
      if (insertError) throw insertError;
    }
    const history = await loadStoredHistory();

    return res.status(200).json({
      source: "ringcentral",
      period: "last_30_days",
      from_date: range.fromDate,
      to_date: range.toDate,
      records,
      history,
      queues_found: targetQueues.map(getQueueName),
      warning: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ code: "RINGCENTRAL_ANALYTICS_ERROR", error: message.slice(0, 400) });
  }
}
