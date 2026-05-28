/**
 * POST /api/lm/analyze
 *
 * Performs a full LogicMonitor alert analysis:
 *   1. Fetches main alert by ID
 *   2. Fetches 60-day history for the same service (resourceId + dataSource + instance + dataPoint)
 *   3. Fetches metric time-series around the alert window
 *
 * Body: { alertId, accessId, accessKey, baseUrl }
 * Returns: structured JSON as described by the LogicMonitor analyzer prompt
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

// ── LMv1 HMAC signature ──────────────────────────────────────────────────────

function lmv1Auth(
  accessId: string,
  accessKey: string,
  method: string,
  body: string,
  path: string,
): Record<string, string> {
  const epoch = Date.now();
  const message = `${method}${epoch}${body}${path}`;
  const sig = crypto
    .createHmac("sha256", accessKey)
    .update(message)
    .digest("base64");
  return {
    Authorization: `LMv1 ${accessId}:${sig}:${epoch}`,
    "X-Version": "3",
    "Content-Type": "application/json",
    "x-lm-date": String(epoch),
  };
}

// ── LM REST call helper ──────────────────────────────────────────────────────

async function lmGet(
  baseUrl: string,
  accessId: string,
  accessKey: string,
  path: string, // must start with /santaba/rest/...
): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  try {
    const headers = lmv1Auth(accessId, accessKey, "GET", "", path);
    const url = `${baseUrl}${path.replace(/^\/santaba\/rest/, "")}`;
    const fullUrl = baseUrl.endsWith("/santaba/rest")
      ? `${baseUrl}${path.replace(/^\/santaba\/rest/, "")}`
      : url;

    const res = await fetch(fullUrl, { headers, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    let data: unknown = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, data, text };
  } catch (e) {
    return { ok: false, status: 0, data: null, text: (e as Error).message };
  }
}

// ── Severity mapper ───────────────────────────────────────────────────────────

function mapSeverity(v: unknown): string {
  const n = Number(v);
  if (n === 4) return "critical";
  if (n === 3) return "error";
  if (n === 2) return "warn";
  if (n === 1) return "info";
  if (typeof v === "string") return v.toLowerCase();
  return String(v ?? "unknown");
}

// ── Status mapper ─────────────────────────────────────────────────────────────

function isCleared(raw: Record<string, unknown>): boolean {
  if (raw.cleared === true) return true;
  if (typeof raw.endEpoch === "number" && raw.endEpoch > 0) return true;
  if (raw.status === "cleared") return true;
  return false;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
  const { alertId } = body as { alertId?: string };

  // Credentials come from .env — never from the client request.
  const accessId  = process.env.LM_ACCESS_ID  ?? "";
  const accessKey = process.env.LM_ACCESS_KEY ?? "";
  const account   = process.env.LM_ACCOUNT    ?? "";
  const baseUrl   = account
    ? `https://${account}.logicmonitor.com/santaba/rest`
    : (process.env.LM_BASE_URL ?? "");

  if (!alertId) {
    return res.status(400).json({ error: "alertId is required" });
  }

  if (!accessId || !accessKey || !baseUrl) {
    return res.status(500).json({
      error:
        "LogicMonitor credentials not configured. Set LM_ACCOUNT, LM_ACCESS_ID, and LM_ACCESS_KEY in .env",
    });
  }

  const errors: string[] = [];
  const nowEpoch = Math.floor(Date.now() / 1000);
  const startWindow = nowEpoch - 60 * 24 * 3600; // 60 days

  // ── 1. Fetch main alert ───────────────────────────────────────────────────

  const alertPath = `/alerts/${alertId}`;
  const alertResp = await lmGet(baseUrl, accessId, accessKey, alertPath);

  if (!alertResp.ok) {
    return res.status(200).json({
      alertId,
      status: "error",
      mainAlert: null,
      history: { windowDays: 60, totalAlertsInLast60Days: 0, totalDowntimeMinutes: 0, averageDowntimeMinutes: 0, alerts: [] },
      metrics: { dataPointName: null, unit: null, series: [] },
      errors: [`Alert ${alertId} not found or API error: HTTP ${alertResp.status} — ${alertResp.text.slice(0, 200)}`],
    });
  }

  const raw = alertResp.data as Record<string, unknown>;

  // LMv3 wraps responses in { data: { ... } }
  const alertData: Record<string, unknown> = (raw?.data ?? raw) as Record<string, unknown>;

  const cleared = isCleared(alertData);
  const startEpoch = Number(alertData.startEpoch ?? alertData.starttime ?? 0);
  const endEpoch = Number(alertData.endEpoch ?? alertData.endtime ?? 0);
  const downtimeMinutes =
    cleared && startEpoch > 0 && endEpoch > 0
      ? Math.round(((endEpoch - startEpoch) / 60) * 100) / 100
      : null;

  const resourceId: number =
    Number(alertData.resourceId ?? alertData.monitorObjectId ?? alertData.deviceId ?? 0);
  const resourceName: string =
    String(alertData.resourceName ?? alertData.monitorObjectName ?? alertData.deviceName ?? "");
  const dataSourceName: string =
    String(alertData.resourceTemplateName ?? alertData.dataSourceName ?? alertData.datasourceName ?? "");
  const instanceName: string =
    String(alertData.instanceName ?? alertData.insName ?? "");
  const dataPointName: string =
    String(alertData.dataPointName ?? alertData.dpName ?? alertData.datapoint ?? "");

  const mainAlert = {
    id: String(alertData.id ?? alertId),
    severity: mapSeverity(alertData.severity),
    status: cleared ? "cleared" : "active",
    startEpoch,
    endEpoch: cleared ? endEpoch : 0,
    downtimeMinutes,
    device: { id: resourceId, name: resourceName },
    dataSourceName,
    instanceName,
    dataPointName,
    externalTicketId: (alertData.externalTicketId ?? alertData.ticketId ?? null) as string | null,
    rawAlertResponse: alertData,
  };

  // ── 2. Fetch 60-day history ────────────────────────────────────────────────

  let historyAlerts: Array<{
    id: string;
    startEpoch: number;
    endEpoch: number;
    status: string;
    downtimeMinutes: number | null;
  }> = [];

  try {
    // Build filter — LM API filter syntax: field:value,field:value
    // Use the four grouping fields. Escape special chars in string values.
    const escape = (s: string) => s.replace(/[",\\]/g, "\\$&");
    const filterParts: string[] = [];
    if (resourceId) filterParts.push(`resourceId:${resourceId}`);
    if (dataSourceName) filterParts.push(`dataSourceName:"${escape(dataSourceName)}"`);
    if (instanceName) filterParts.push(`instanceName:"${escape(instanceName)}"`);
    if (dataPointName) filterParts.push(`dataPointName:"${escape(dataPointName)}"`);
    filterParts.push(`startEpoch>:${startWindow}`);

    const histPath = `/alerts?filter=${encodeURIComponent(filterParts.join(","))}&size=250&fields=id,startEpoch,endEpoch,cleared,status,severity`;
    const histResp = await lmGet(baseUrl, accessId, accessKey, histPath);

    if (histResp.ok) {
      const histData = histResp.data as Record<string, unknown>;
      const items = (histData?.data?.items ?? histData?.items ?? []) as Record<string, unknown>[];

      historyAlerts = items.map((item) => {
        const iCleared = isCleared(item);
        const s = Number(item.startEpoch ?? 0);
        const e = Number(item.endEpoch ?? 0);
        const dt =
          iCleared && s > 0 && e > 0
            ? Math.round(((e - s) / 60) * 100) / 100
            : iCleared
              ? null
              : Math.round(((nowEpoch - s) / 60) * 100) / 100; // still active: compute to now
        return {
          id: String(item.id ?? ""),
          startEpoch: s,
          endEpoch: iCleared ? e : 0,
          status: iCleared ? "cleared" : "active",
          downtimeMinutes: dt,
        };
      });
    } else {
      errors.push(`History fetch failed: HTTP ${histResp.status} — ${histResp.text.slice(0, 200)}`);
    }
  } catch (e) {
    errors.push(`History fetch error: ${(e as Error).message}`);
  }

  const totalDowntime = historyAlerts.reduce(
    (s, a) => s + (a.downtimeMinutes ?? 0),
    0,
  );
  const avgDowntime =
    historyAlerts.length > 0
      ? Math.round((totalDowntime / historyAlerts.length) * 100) / 100
      : 0;

  const history = {
    windowDays: 60,
    totalAlertsInLast60Days: historyAlerts.length,
    totalDowntimeMinutes: Math.round(totalDowntime * 100) / 100,
    averageDowntimeMinutes: avgDowntime,
    alerts: historyAlerts,
  };

  // ── 3. Fetch metrics / time-series ────────────────────────────────────────

  let metricSeries: Array<{ timestamp: number; value: number | null }> = [];
  let metricUnit: string | null = null;

  try {
    // Define window: alert start - 15 min → (alert end or now) + 15 min
    const graphStart = Math.max(0, startEpoch - 15 * 60);
    const graphEnd =
      cleared && endEpoch > 0 ? endEpoch + 15 * 60 : nowEpoch + 15 * 60;

    if (resourceId && dataSourceName && instanceName && dataPointName) {
      // Step A: resolve instanceId
      const dsPath = `/device/devices/${resourceId}/devicedatasources?filter=dataSourceName:"${encodeURIComponent(dataSourceName)}"&fields=id,dataSourceName`;
      const dsResp = await lmGet(baseUrl, accessId, accessKey, dsPath);

      let deviceDataSourceId: number | null = null;
      if (dsResp.ok) {
        const dsData = dsResp.data as Record<string, unknown>;
        const dsItems = (dsData?.data?.items ?? dsData?.items ?? []) as Record<string, unknown>[];
        if (dsItems.length > 0) deviceDataSourceId = Number(dsItems[0].id);
      }

      let instanceId: number | null = null;
      if (deviceDataSourceId) {
        const instPath = `/device/devices/${resourceId}/devicedatasources/${deviceDataSourceId}/instances?filter=name:"${encodeURIComponent(instanceName)}"&fields=id,name`;
        const instResp = await lmGet(baseUrl, accessId, accessKey, instPath);
        if (instResp.ok) {
          const instData = instResp.data as Record<string, unknown>;
          const instItems = (instData?.data?.items ?? instData?.items ?? []) as Record<string, unknown>[];
          if (instItems.length > 0) instanceId = Number(instItems[0].id);
        }
      }

      if (instanceId) {
        const metricsPath =
          `/device/devices/${resourceId}/devicedatasources/${deviceDataSourceId}/instances/${instanceId}/data?` +
          `datapoints=${encodeURIComponent(dataPointName)}&start=${graphStart}&end=${graphEnd}`;
        const metResp = await lmGet(baseUrl, accessId, accessKey, metricsPath);

        if (metResp.ok) {
          const metData = metResp.data as Record<string, unknown>;
          const d = (metData?.data ?? metData) as Record<string, unknown>;
          const timestamps = (d?.time ?? d?.timestamps ?? []) as number[];
          const values = (d?.values ?? []) as unknown[];

          // values may be { [dpName]: number[] } or a flat number[][]
          let dpValues: (number | null)[] = [];
          if (Array.isArray(values) && values.length > 0) {
            if (Array.isArray(values[0])) {
              dpValues = (values as number[][]).map((row) => row[0] ?? null);
            } else {
              dpValues = values as number[];
            }
          } else if (d?.dataValues && typeof d.dataValues === "object") {
            const dv = d.dataValues as Record<string, (number | null)[]>;
            const dpKey =
              Object.keys(dv).find((k) =>
                k.toLowerCase() === dataPointName.toLowerCase(),
              ) ?? Object.keys(dv)[0];
            if (dpKey) dpValues = dv[dpKey];
          }

          metricSeries = timestamps.map((ts, i) => ({
            timestamp: ts,
            value: dpValues[i] ?? null,
          }));

          // Try to extract unit
          const dpDefs = (d?.dataPoints ?? d?.datapointNames ?? []) as unknown[];
          if (dpDefs.length > 0 && typeof dpDefs[0] === "object") {
            metricUnit = ((dpDefs[0] as Record<string, unknown>).unit as string) ?? null;
          }
        } else {
          errors.push(
            `Metrics fetch failed: HTTP ${metResp.status} — ${metResp.text.slice(0, 200)}`,
          );
        }
      } else {
        errors.push(
          `Could not resolve instanceId for instance "${instanceName}" — metric series unavailable`,
        );
      }
    } else {
      errors.push(
        "Missing resourceId/dataSourceName/instanceName/dataPointName — metric series unavailable",
      );
    }
  } catch (e) {
    errors.push(`Metrics fetch error: ${(e as Error).message}`);
  }

  const result = {
    alertId,
    status: cleared ? "cleared" : "active",
    mainAlert,
    history,
    metrics: {
      dataPointName,
      unit: metricUnit,
      series: metricSeries,
    },
    errors,
  };

  return res.status(200).json(result);
}
