import type { VercelRequest, VercelResponse } from "@vercel/node";
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
  avg_handle_seconds: number;
  avg_wait_seconds: number;
};

const TIME_ZONE = "America/Los_Angeles";
const MAX_HISTORY_DAYS = 184;
const TARGET_QUEUE_TERMS = ["mobility", "network"];

function currentPacificMonth() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${year}-${month}`;
}

function zonedMidnightUtc(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const targetWallTime = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = targetWallTime;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatter.formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const representedWallTime = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    const correction = targetWallTime - representedWallTime;
    if (correction === 0) break;
    guess += correction;
  }

  return new Date(guess).toISOString();
}

function monthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const fromDate = `${month}-01`;
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1));
  const toExclusiveDate = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    fromDate,
    toDate: `${month}-${String(lastDay).padStart(2, "0")}`,
    timeFrom: zonedMidnightUtc(fromDate),
    timeTo: zonedMidnightUtc(toExclusiveDate),
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
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  if (Array.isArray(value)) return value.reduce((total, item) => total + metricValue(item), 0);
  const record = asRecord(value);
  for (const key of ["value", "sum", "total", "count", "aggregationValue", "values"]) {
    if (record[key] !== undefined) return metricValue(record[key]);
  }
  return 0;
}

function metricByName(row: any, name: string) {
  const containers = [row?.counters, row?.data?.counters, row?.data, row?.metrics, row];
  for (const container of containers) {
    const record = asRecord(container);
    if (record[name] !== undefined) return record[name];
    const key = Object.keys(record).find((entry) => entry.toLowerCase() === name.toLowerCase());
    if (key) return record[key];
  }
  return undefined;
}

function categoryValue(metric: any, categoryNames: string[]) {
  if (metric == null) return 0;
  const normalized = new Set(categoryNames.map((name) => name.toLowerCase().replace(/[^a-z]/g, "")));
  const root = asRecord(metric);
  const values = asRecord(root.values ?? root.value ?? root.results ?? root);
  for (const key of Object.keys(values)) {
    if (normalized.has(key.toLowerCase().replace(/[^a-z]/g, ""))) {
      return metricValue(values[key]);
    }
  }
  if (Array.isArray(root.values ?? root.results)) {
    const item = (root.values ?? root.results).find((entry: any) => {
      const label = String(entry?.name ?? entry?.key ?? entry?.type ?? entry?.result ?? "")
        .toLowerCase().replace(/[^a-z]/g, "");
      return normalized.has(label);
    });
    return item ? metricValue(item) : 0;
  }
  return 0;
}

function getRows(payload: any): any[] {
  const candidates = [payload?.records, payload?.data?.records, payload?.data, payload?.results];
  return candidates.find(Array.isArray) ?? [];
}

function rowQueueId(row: any) {
  const dimensions = row?.grouping ?? row?.key ?? row?.dimensions ?? row?.queue ?? {};
  return String(
    dimensions?.id ?? dimensions?.queueId ?? dimensions?.Queues?.id ?? dimensions?.queues?.id ?? row?.queueId ?? row?.id ?? "",
  ).trim();
}

function rowQueueName(row: any) {
  const dimensions = row?.grouping ?? row?.key ?? row?.dimensions ?? row?.queue ?? {};
  return String(
    dimensions?.name ?? dimensions?.queueName ?? dimensions?.Queues?.name ?? dimensions?.queues?.name ?? row?.queueName ?? row?.name ?? "",
  ).trim();
}

function buildQueueMetrics(row: any, queueName: string): QueueMetrics {
  const callsByResponse = metricByName(row, "callsByResponse");
  const callsByResult = metricByName(row, "callsByResult");
  const allCalls = metricValue(metricByName(row, "allCalls"));
  const answered = categoryValue(callsByResponse, ["answered"]);
  const abandoned = categoryValue(callsByResult, ["abandoned", "abandonedbycaller"]);
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
  const talkSeconds = categoryValue(callDuration, ["liveTalk", "livetalk", "talk"]);
  const holdSeconds = categoryValue(callDuration, ["hold", "holds"]);
  const normalizedTotal = allCalls || resultTotal;

  return {
    queue_name: queueName,
    total: normalizedTotal,
    answered,
    abandoned,
    missed,
    system_handled: systemHandled,
    avg_handle_seconds: answered > 0 ? (talkSeconds + holdSeconds) / answered : 0,
    avg_wait_seconds: ringingCalls > 0 ? ringingSeconds / ringingCalls : 0,
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const month = String(req.query.month ?? currentPacificMonth()).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ error: "month must be YYYY-MM" });
  }
  if (!hasRingCentralConfig(req)) {
    return res.status(503).json({
      code: "RINGCENTRAL_NOT_CONFIGURED",
      error: "RingCentral OAuth is not fully configured for this app.",
    });
  }
  if (!isRingCentralConnected(req)) {
    return res.status(401).json({
      code: "RINGCENTRAL_NOT_CONNECTED",
      error: "Connect RingCentral to load call analytics.",
    });
  }

  const range = monthRange(month);
  const earliestAllowed = Date.now() - MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000;
  if (new Date(range.timeFrom).getTime() < earliestAllowed) {
    return res.status(400).json({
      code: "RINGCENTRAL_DATE_RANGE_TOO_OLD",
      error: `RingCentral Business Analytics supports a limited recent-history window. Choose a month starting within the last ${MAX_HISTORY_DAYS} days.`,
    });
  }

  try {
    const config = getRingCentralConfig(req);
    const allQueues = await listCallQueues(req, res);
    const configuredNames = config.queueNames.map((name) => name.toLowerCase());
    const matchingQueues = allQueues.filter((queue) => getQueueId(queue) && isTargetQueue(getQueueName(queue)));
    const configuredMatches = matchingQueues.filter((queue) => {
      const name = getQueueName(queue).toLowerCase();
      return configuredNames.some((configuredName) => name.includes(configuredName) || configuredName.includes(name));
    });
    // Prefer explicitly configured queue names when they match; otherwise use
    // the Mobility/Network queues returned by RingCentral (queue names can vary
    // slightly between accounts, e.g. "Mobility Support" vs "Mobility Queue").
    const targetQueues = configuredMatches.length > 0 ? configuredMatches : matchingQueues;

    if (targetQueues.length === 0) {
      return res.status(200).json({
        source: "ringcentral",
        month,
        from_date: range.fromDate,
        to_date: range.toDate,
        records: [],
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
          callsByResult: { aggregationType: "Sum" },
          callsSegments: { aggregationType: "Sum" },
        },
        timers: {
          callsSegmentsDuration: { aggregationType: "Sum" },
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
    const records = responseRows.map((row: any) => {
      const id = rowQueueId(row);
      const name = rowQueueName(row) || queueById.get(id) || (targetQueues.length === 1 ? getQueueName(targetQueues[0]) : "");
      return name ? buildQueueMetrics(row, name) : null;
    }).filter((row: QueueMetrics | null): row is QueueMetrics => Boolean(row));

    return res.status(200).json({
      source: "ringcentral",
      month,
      from_date: range.fromDate,
      to_date: range.toDate,
      records,
      queues_found: targetQueues.map(getQueueName),
      warning: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ code: "RINGCENTRAL_ANALYTICS_ERROR", error: message.slice(0, 400) });
  }
}
