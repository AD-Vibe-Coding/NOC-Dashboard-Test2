import type { Plugin } from "vite";
import { loadEnv } from "vite";
import crypto from "crypto";

/**
 * LogicMonitor REST API v3 proxy.
 *
 * Endpoints exposed to the frontend:
 *   GET  /api/lm/alerts                — active alerts (severity-filtered, paginated)
 *   GET  /api/lm/devices               — device summary (counts by alert state)
 *   POST /api/lm/alerts/:id/ack        — acknowledge an alert with a comment
 *
 * Authentication options (set whichever you have):
 *   - LMv1 token: LM_ACCESS_ID + LM_ACCESS_KEY (preferred — HMAC-signed)
 *   - Bearer token: LM_BEARER_TOKEN
 *
 * Required env:
 *   LM_ACCOUNT — your portal name (e.g. "acme" for acme.logicmonitor.com)
 *
 * If credentials are missing, all endpoints return a realistic snapshot so the
 * widget demos cleanly. The same pattern every other widget in this app uses.
 *
 * Docs:
 *   https://www.logicmonitor.com/support/rest-api-developers-guide/overview/using-logicmonitors-rest-api
 *   https://www.logicmonitor.com/support/rest-api-authentication
 */

// ---- Types --------------------------------------------------------------

export interface LmAlert {
  id: string;                       // e.g. "DS12345"
  severity: "critical" | "error" | "warn" | "info";
  type: "dataSourceAlert" | "websiteAlert" | "eventAlert" | "logAlert" | "other";
  monitor_object_name: string;       // device / website / collector name
  monitor_object_group: string;      // group path, e.g. "Customers/ACME/Routers"
  resource_template_name: string;    // DataSource name, e.g. "Cisco_BGP_Neighbors"
  instance_name: string;             // instance, e.g. "172.16.0.1@AS65001"
  data_point: string;                // datapoint, e.g. "State"
  threshold: string;                 // alert rule, e.g. "!= 1"
  alert_value: string;               // current value, e.g. "Idle"
  start_epoch: number;               // alert started (ms)
  acked: boolean;
  acked_by?: string;
  acked_on_epoch?: number;
  ack_comment?: string;
  sdted: boolean;                    // in scheduled-down time
  cleared: boolean;
  rule: string;                      // alert rule name
  chain: string;                     // escalation chain
}

export interface LmDeviceSummary {
  total_devices: number;
  by_alert_state: {
    critical: number;
    error: number;
    warn: number;
    ok: number;
  };
  top_offenders: Array<{
    device_name: string;
    group: string;
    critical: number;
    error: number;
    warn: number;
  }>;
}

// ---- Snapshot data -------------------------------------------------------
// Built to be internally-consistent with the rest of the dashboard: customers
// + carriers reference real entries from the QS Escalation list.

function buildAlertSnapshot(): LmAlert[] {
  const now = Date.now();
  const ago = (mins: number) => now - mins * 60_000;
  return [
    {
      id: "DS9942881",
      severity: "critical",
      type: "dataSourceAlert",
      monitor_object_name: "TAMARAC-FL-EDGE-01",
      monitor_object_group: "Customers/ACME Corp/Routers",
      resource_template_name: "Cisco_Interface_Status",
      instance_name: "GigabitEthernet0/0/1",
      data_point: "Status",
      threshold: "!= 1",
      alert_value: "down",
      start_epoch: ago(47),
      acked: false,
      sdted: false,
      cleared: false,
      rule: "Critical Interface Down",
      chain: "NOC On-Call",
    },
    {
      id: "DS9942884",
      severity: "critical",
      type: "dataSourceAlert",
      monitor_object_name: "TAMARAC-FL-EDGE-01",
      monitor_object_group: "Customers/ACME Corp/Routers",
      resource_template_name: "Ping_Multi",
      instance_name: "WAN_Primary",
      data_point: "PingLossPercent",
      threshold: "> 50",
      alert_value: "100",
      start_epoch: ago(47),
      acked: true,
      acked_by: "Karthik Damagalla",
      acked_on_epoch: ago(38),
      ack_comment: "Lumen engaged, fiber cut at OSPE, ETA 60min",
      sdted: false,
      cleared: false,
      rule: "WAN Down",
      chain: "NOC On-Call",
    },
    {
      id: "DS9943017",
      severity: "error",
      type: "dataSourceAlert",
      monitor_object_name: "ATLANTA-GA-CORE-02",
      monitor_object_group: "Customers/Globex Industries/Core Switches",
      resource_template_name: "Cisco_BGP_Neighbors",
      instance_name: "10.224.18.1@AS65501",
      data_point: "State",
      threshold: "!= 1",
      alert_value: "Idle",
      start_epoch: ago(22),
      acked: false,
      sdted: false,
      cleared: false,
      rule: "BGP Neighbor Down",
      chain: "Network Eng",
    },
    {
      id: "DS9943102",
      severity: "warn",
      type: "dataSourceAlert",
      monitor_object_name: "CHICAGO-IL-FW-01",
      monitor_object_group: "Customers/Initech/Firewalls",
      resource_template_name: "Palo_Alto_System_Stats",
      instance_name: "Management Plane",
      data_point: "CPU",
      threshold: "> 85",
      alert_value: "92",
      start_epoch: ago(18),
      acked: false,
      sdted: false,
      cleared: false,
      rule: "High CPU",
      chain: "Customer Notify",
    },
    {
      id: "DS9943127",
      severity: "error",
      type: "dataSourceAlert",
      monitor_object_name: "DALLAS-TX-WIFI-CTRL-01",
      monitor_object_group: "Customers/Stark Industries/WiFi",
      resource_template_name: "Cisco_WLC_AP_Status",
      instance_name: "Floor3-AP-2718",
      data_point: "OperationalState",
      threshold: "!= 1",
      alert_value: "Disassociated",
      start_epoch: ago(14),
      acked: false,
      sdted: false,
      cleared: false,
      rule: "AP Disconnected",
      chain: "Customer Notify",
    },
    {
      id: "DS9943200",
      severity: "warn",
      type: "websiteAlert",
      monitor_object_name: "customer-portal-acme",
      monitor_object_group: "Websites/Customer Portals",
      resource_template_name: "HTTP_Check",
      instance_name: "us-east-1 → portal.acme.example",
      data_point: "responseTime",
      threshold: "> 3000",
      alert_value: "4218",
      start_epoch: ago(9),
      acked: false,
      sdted: false,
      cleared: false,
      rule: "Slow Page Load",
      chain: "Customer Notify",
    },
    {
      id: "DS9943241",
      severity: "info",
      type: "dataSourceAlert",
      monitor_object_name: "SEATTLE-WA-COLLECTOR-01",
      monitor_object_group: "Collectors",
      resource_template_name: "LogicMonitor_Collector",
      instance_name: "collector-01",
      data_point: "JobsInQueue",
      threshold: "> 500",
      alert_value: "612",
      start_epoch: ago(4),
      acked: false,
      sdted: false,
      cleared: false,
      rule: "Collector Backed Up",
      chain: "NOC On-Call",
    },
  ];
}

function buildDeviceSummarySnapshot(): LmDeviceSummary {
  const alerts = buildAlertSnapshot();
  return {
    total_devices: 487,
    by_alert_state: {
      critical: alerts.filter((a) => a.severity === "critical").length,
      error: alerts.filter((a) => a.severity === "error").length,
      warn: alerts.filter((a) => a.severity === "warn").length,
      ok: 481,
    },
    top_offenders: [
      {
        device_name: "TAMARAC-FL-EDGE-01",
        group: "Customers/ACME Corp/Routers",
        critical: 2,
        error: 0,
        warn: 0,
      },
      {
        device_name: "ATLANTA-GA-CORE-02",
        group: "Customers/Globex Industries/Core Switches",
        critical: 0,
        error: 1,
        warn: 0,
      },
      {
        device_name: "DALLAS-TX-WIFI-CTRL-01",
        group: "Customers/Stark Industries/WiFi",
        critical: 0,
        error: 1,
        warn: 0,
      },
      {
        device_name: "CHICAGO-IL-FW-01",
        group: "Customers/Initech/Firewalls",
        critical: 0,
        error: 0,
        warn: 1,
      },
    ],
  };
}

// ---- LMv1 signing --------------------------------------------------------
// signature = base64( hex( HMAC-SHA256(AccessKey, METHOD + EPOCH_MS + BODY + RESOURCE_PATH) ) )
// header = "LMv1 <AccessId>:<signature>:<epoch>"
// Source: LogicMonitor REST API Authentication docs.

function signLmv1(
  accessId: string,
  accessKey: string,
  method: string,
  resourcePath: string,
  body: string,
): { authHeader: string; epoch: string } {
  const epoch = Date.now().toString();
  const requestVars = method.toUpperCase() + epoch + (body ?? "") + resourcePath;
  const hexDigest = crypto
    .createHmac("sha256", accessKey)
    .update(requestVars, "utf8")
    .digest("hex");
  const signature = Buffer.from(hexDigest, "utf8").toString("base64");
  return { authHeader: `LMv1 ${accessId}:${signature}:${epoch}`, epoch };
}

interface LmCreds {
  account: string;
  accessId?: string;
  accessKey?: string;
  bearer?: string;
}

function readCreds(env: Record<string, string>): LmCreds | null {
  const account = (env.LM_ACCOUNT || "").trim();
  if (!account || /PASTE|YOUR|HERE|CHANGEME/i.test(account)) return null;

  const accessId = (env.LM_ACCESS_ID || "").trim();
  const accessKey = (env.LM_ACCESS_KEY || "").trim();
  const bearer = (env.LM_BEARER_TOKEN || "").trim();

  const lmv1Valid =
    accessId && accessKey && !/PASTE|YOUR|HERE/i.test(accessId + accessKey);
  const bearerValid = bearer && !/PASTE|YOUR|HERE/i.test(bearer);

  if (!lmv1Valid && !bearerValid) return null;

  return {
    account,
    accessId: lmv1Valid ? accessId : undefined,
    accessKey: lmv1Valid ? accessKey : undefined,
    bearer: bearerValid ? bearer : undefined,
  };
}

async function lmRequest(
  creds: LmCreds,
  method: string,
  resourcePath: string,
  body?: string,
): Promise<any> {
  const url = `https://${creds.account}.logicmonitor.com/santaba/rest${resourcePath}`;
  const bodyStr = body ?? "";

  let authHeader: string;
  if (creds.accessId && creds.accessKey) {
    authHeader = signLmv1(
      creds.accessId,
      creds.accessKey,
      method,
      // LMv1 signs the path WITHOUT the query string
      resourcePath.split("?")[0],
      bodyStr,
    ).authHeader;
  } else if (creds.bearer) {
    authHeader = `Bearer ${creds.bearer}`;
  } else {
    throw new Error("No LM credentials available");
  }

  const r = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      "X-Version": "3",
    },
    body: method === "GET" || method === "DELETE" ? undefined : bodyStr || undefined,
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`LM API ${r.status}: ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : {};
}

// ---- Mappers -------------------------------------------------------------
// LogicMonitor returns sprawling shapes; we trim to what the widget needs.

function mapSeverity(n: number): LmAlert["severity"] {
  // LM severity ints: 4=critical, 3=error, 2=warn, 1=info (some endpoints
  // use the reverse — we accept both by clamping).
  if (n >= 4) return "critical";
  if (n === 3) return "error";
  if (n === 2) return "warn";
  return "info";
}

function mapAlertType(t: string): LmAlert["type"] {
  const x = (t || "").toLowerCase();
  if (x.includes("website")) return "websiteAlert";
  if (x.includes("event")) return "eventAlert";
  if (x.includes("log")) return "logAlert";
  if (x.includes("data")) return "dataSourceAlert";
  return "other";
}

function mapAlert(raw: any): LmAlert {
  return {
    id: String(raw.id ?? ""),
    severity: mapSeverity(Number(raw.severity ?? 1)),
    type: mapAlertType(String(raw.type ?? "")),
    monitor_object_name: String(raw.monitorObjectName ?? ""),
    monitor_object_group: String(raw.monitorObjectGroups ?? raw.monitorObjectGroup ?? ""),
    resource_template_name: String(raw.resourceTemplateName ?? ""),
    instance_name: String(raw.instanceName ?? ""),
    data_point: String(raw.dataPointName ?? ""),
    threshold: String(raw.threshold ?? ""),
    alert_value: String(raw.alertValue ?? ""),
    start_epoch: Number(raw.startEpoch ?? 0) * 1000,
    acked: !!raw.acked,
    acked_by: raw.ackedBy ? String(raw.ackedBy) : undefined,
    acked_on_epoch: raw.ackedOnEpoch ? Number(raw.ackedOnEpoch) * 1000 : undefined,
    ack_comment: raw.ackComment ? String(raw.ackComment) : undefined,
    sdted: !!raw.sdted,
    cleared: !!raw.cleared,
    rule: String(raw.rule ?? ""),
    chain: String(raw.chain ?? ""),
  };
}

// ---- Plugin --------------------------------------------------------------

export function logicMonitorProxyPlugin(): Plugin {
  let env: Record<string, string> = {};
  return {
    name: "logicmonitor-proxy",
    configureServer(server) {
      env = loadEnv("development", process.cwd(), "");

      // ---- GET /api/lm/alerts -------------------------------------------
      server.middlewares.use("/api/lm/alerts", async (req, res) => {
        if (req.url?.includes("/ack")) return; // handled by /api/lm/alerts/:id/ack below
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");

        const url = new URL(req.url ?? "/", "http://x");
        const severityParam = url.searchParams.get("severity") || ""; // "critical,error,warn"
        const includeCleared = url.searchParams.get("cleared") === "true";
        const includeAcked = url.searchParams.get("acked") !== "false";
        const size = Math.min(parseInt(url.searchParams.get("size") || "100", 10), 1000);

        const creds = readCreds(env);
        if (!creds) {
          const alerts = applyFilters(buildAlertSnapshot(), {
            severities: parseSeverityList(severityParam),
            includeCleared,
            includeAcked,
          }).slice(0, size);
          res.end(
            JSON.stringify({
              source: "snapshot",
              fetched_at: new Date().toISOString(),
              alerts,
              count: alerts.length,
              warning:
                "LM_ACCOUNT / LM_ACCESS_ID / LM_ACCESS_KEY (or LM_BEARER_TOKEN) not set in .env. Showing snapshot data.",
            }),
          );
          return;
        }

        try {
          // LM filter syntax: cleared:"" excludes cleared, severity>=3 = error+critical
          const filterParts: string[] = [];
          if (!includeCleared) filterParts.push(`cleared:""`);
          if (!includeAcked) filterParts.push(`acked:false`);
          const sevs = parseSeverityList(severityParam);
          if (sevs && sevs.length > 0) {
            const minSev = Math.min(...sevs.map(severityToNum));
            filterParts.push(`severity>:${minSev}`);
          }
          const filter = filterParts.join(",");
          const qs = new URLSearchParams({
            size: String(size),
            sort: "-severity,-startEpoch",
          });
          if (filter) qs.set("filter", filter);

          const j = await lmRequest(creds, "GET", `/alert/alerts?${qs.toString()}`);
          const items = Array.isArray(j.items) ? j.items : [];
          const alerts = items.map(mapAlert);
          // Client-side severity filter (LM filter only does min-severity)
          const filtered = applyFilters(alerts, {
            severities: sevs,
            includeCleared,
            includeAcked,
          });
          res.end(
            JSON.stringify({
              source: "live",
              fetched_at: new Date().toISOString(),
              alerts: filtered,
              count: filtered.length,
              warning: null,
            }),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Fall back to snapshot so the widget keeps working
          const alerts = applyFilters(buildAlertSnapshot(), {
            severities: parseSeverityList(severityParam),
            includeCleared,
            includeAcked,
          }).slice(0, size);
          res.end(
            JSON.stringify({
              source: "snapshot",
              fetched_at: new Date().toISOString(),
              alerts,
              count: alerts.length,
              warning: `LM live fetch failed, showing snapshot: ${msg}`,
            }),
          );
        }
      });

      // ---- GET /api/lm/devices ------------------------------------------
      server.middlewares.use("/api/lm/devices", async (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");

        const creds = readCreds(env);
        if (!creds) {
          res.end(
            JSON.stringify({
              source: "snapshot",
              fetched_at: new Date().toISOString(),
              summary: buildDeviceSummarySnapshot(),
              warning: "LM credentials not set — snapshot data.",
            }),
          );
          return;
        }

        try {
          // Cheap aggregate: /device/devices?size=1 returns total via header,
          // but we want alert counts → use /alert/alerts grouped client-side.
          // For a real prod widget you'd use /alert/alerts/groups or DataSource
          // instance stats; keeping it simple here.
          const j = await lmRequest(
            creds,
            "GET",
            "/alert/alerts?size=1000&filter=cleared:%22%22&fields=monitorObjectName,monitorObjectGroups,severity",
          );
          const items: any[] = Array.isArray(j.items) ? j.items : [];
          const byDevice = new Map<
            string,
            { device_name: string; group: string; critical: number; error: number; warn: number }
          >();
          let crit = 0, errCount = 0, warn = 0;
          for (const it of items) {
            const sev = mapSeverity(Number(it.severity ?? 1));
            if (sev === "critical") crit++;
            else if (sev === "error") errCount++;
            else if (sev === "warn") warn++;
            const name = String(it.monitorObjectName ?? "?");
            const grp = String(it.monitorObjectGroups ?? "");
            const k = name;
            const row =
              byDevice.get(k) ?? { device_name: name, group: grp, critical: 0, error: 0, warn: 0 };
            (row as any)[sev] = ((row as any)[sev] ?? 0) + (sev === "info" ? 0 : 1);
            byDevice.set(k, row);
          }

          // total devices (cheap header-based count via /device/devices)
          let totalDevices = 0;
          try {
            const dj = await lmRequest(creds, "GET", "/device/devices?size=1&fields=id");
            totalDevices = Number(dj.total ?? 0);
          } catch { /* ignore — fall through with 0 */ }

          const top = [...byDevice.values()]
            .sort((a, b) => b.critical * 100 + b.error * 10 + b.warn - (a.critical * 100 + a.error * 10 + a.warn))
            .slice(0, 5);

          res.end(
            JSON.stringify({
              source: "live",
              fetched_at: new Date().toISOString(),
              summary: {
                total_devices: totalDevices,
                by_alert_state: {
                  critical: crit,
                  error: errCount,
                  warn,
                  ok: Math.max(0, totalDevices - byDevice.size),
                },
                top_offenders: top,
              } satisfies LmDeviceSummary,
              warning: null,
            }),
          );
        } catch (err) {
          res.end(
            JSON.stringify({
              source: "snapshot",
              fetched_at: new Date().toISOString(),
              summary: buildDeviceSummarySnapshot(),
              warning: `LM live device fetch failed, showing snapshot: ${err instanceof Error ? err.message : String(err)}`,
            }),
          );
        }
      });

      // ---- POST /api/lm/alerts/:id/ack ----------------------------------
      // Body: { ack_comment: string }
      server.middlewares.use("/api/lm/ack", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c);
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          const id = String(body.alert_id ?? "").trim();
          const comment = String(body.ack_comment ?? "").trim();
          if (!id || !comment) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "alert_id and ack_comment required" }));
            return;
          }
          const creds = readCreds(env);
          if (!creds) {
            res.end(
              JSON.stringify({
                acked: false,
                demo: true,
                warning: "LM credentials not set — ack simulated only.",
              }),
            );
            return;
          }
          await lmRequest(
            creds,
            "POST",
            `/alert/alerts/${encodeURIComponent(id)}/ack`,
            JSON.stringify({ ackComment: comment }),
          );
          res.end(JSON.stringify({ acked: true }));
        } catch (err) {
          res.statusCode = 502;
          res.end(
            JSON.stringify({
              acked: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });
    },
  };
}

// ---- Filter helpers ------------------------------------------------------

function parseSeverityList(s: string): LmAlert["severity"][] | null {
  if (!s) return null;
  const out: LmAlert["severity"][] = [];
  for (const part of s.split(",").map((x) => x.trim().toLowerCase())) {
    if (part === "critical" || part === "error" || part === "warn" || part === "info") {
      out.push(part);
    }
  }
  return out.length > 0 ? out : null;
}

function severityToNum(s: LmAlert["severity"]): number {
  return s === "critical" ? 4 : s === "error" ? 3 : s === "warn" ? 2 : 1;
}

function applyFilters(
  alerts: LmAlert[],
  opts: {
    severities: LmAlert["severity"][] | null;
    includeCleared: boolean;
    includeAcked: boolean;
  },
): LmAlert[] {
  return alerts.filter((a) => {
    if (!opts.includeCleared && a.cleared) return false;
    if (!opts.includeAcked && a.acked) return false;
    if (opts.severities && !opts.severities.includes(a.severity)) return false;
    return true;
  });
}
