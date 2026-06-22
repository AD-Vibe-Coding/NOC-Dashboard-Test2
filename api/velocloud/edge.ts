import type { VercelRequest, VercelResponse } from "@vercel/node";

type VcSeverity = "critical" | "major" | "minor" | "info";
type EdgeState = "up" | "degraded" | "down";

type VcAlert = {
  id: string;
  severity: VcSeverity;
  title: string;
  edge_name: string;
  link_name: string;
  status: "open" | "cleared";
  started_at: string;
};

type VcLink = {
  edge_name: string;
  link_name: string;
  state: EdgeState;
  jitter_ms: number;
  latency_ms: number;
  loss_pct: number;
  updated_at: string;
};

type EdgeMetricPoint = {
  ts: string;
  latency_ms: number;
  jitter_ms: number;
  loss_pct: number;
};

type EdgeMetricsSummary = {
  current_latency_ms: number;
  avg_latency_ms: number;
  max_latency_ms: number;
  current_jitter_ms: number;
  avg_jitter_ms: number;
  max_jitter_ms: number;
  current_loss_pct: number;
  avg_loss_pct: number;
  max_loss_pct: number;
  sample_count: number;
};

type EdgeCandidate = {
  label: string;
  value: string;
};

type RangeKey = "1h" | "24h" | "7d";

function asSeverity(v: string): VcSeverity {
  const s = v.toLowerCase();
  if (s.includes("crit")) return "critical";
  if (s.includes("major") || s.includes("error")) return "major";
  if (s.includes("minor") || s.includes("warn")) return "minor";
  return "info";
}

function asState(v: string): EdgeState {
  const s = v.toLowerCase();
  if (s.includes("down")) return "down";
  if (s.includes("degrad") || s.includes("warn") || s.includes("impair")) return "degraded";
  return "up";
}

function includesNeedle(value: unknown, needle: string) {
  if (value == null) return false;
  return String(value).toUpperCase().includes(needle);
}

function edgeMatches(raw: any, serialUpper: string) {
  const edge = raw?.edge ?? {};
  const candidates = [
    raw?.serial,
    raw?.serialNumber,
    raw?.edgeSerial,
    raw?.edgeName,
    raw?.edgeNameOrId,
    raw?.edgeLogicalId,
    raw?.name,
    raw?.id,
    edge?.serial,
    edge?.serialNumber,
    edge?.edgeSerial,
    edge?.edgeName,
    edge?.edgeNameOrId,
    edge?.name,
    edge?.id,
  ];
  return candidates.some((c) => includesNeedle(c, serialUpper));
}

function mapAlerts(payload: any, serialUpper: string): VcAlert[] {
  const list = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload)
        ? payload
        : [];

  return list
    .filter((a: any) => edgeMatches(a, serialUpper))
    .slice(0, 200)
    .map((a: any) => ({
      id: String(a.id ?? a.alertId ?? a.eventId ?? Math.random()),
      severity: asSeverity(String(a.severity ?? a.level ?? "info")),
      title: String(a.title ?? a.message ?? a.text ?? "Alert"),
      edge_name: String(a.edgeName ?? a.edge?.name ?? a.edge?.edgeName ?? "Unknown Edge"),
      link_name: String(a.linkName ?? a.link ?? a.pathName ?? "Unknown Link"),
      status: String(a.status ?? "open").toLowerCase() === "cleared" ? "cleared" : "open",
      started_at: String(a.startedAt ?? a.startTime ?? a.time ?? new Date().toISOString()),
    }));
}

function extractEdgeCandidates(payload: any, queryUpper: string): EdgeCandidate[] {
  const list = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload)
        ? payload
        : [];

  const seen = new Set<string>();
  const out: EdgeCandidate[] = [];

  for (const row of list) {
    const edge = row?.edge ?? {};
    const labels = [
      row?.edgeName,
      row?.name,
      edge?.name,
      edge?.edgeName,
      row?.serial,
      row?.serialNumber,
      edge?.serial,
      edge?.serialNumber,
      row?.edgeLogicalId,
      row?.id,
      edge?.id,
    ].filter(Boolean).map((v) => String(v));

    for (const label of labels) {
      const upper = label.toUpperCase();
      if (queryUpper && !(upper.includes(queryUpper) || queryUpper.includes(upper))) continue;
      if (seen.has(label)) continue;
      seen.add(label);
      out.push({ label, value: label });
      break;
    }

    if (out.length >= 12) break;
  }

  return out;
}

function mapLinks(payload: any, serialUpper: string): VcLink[] {
  const list = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload)
        ? payload
        : [];

  return list
    .filter((l: any) => edgeMatches(l, serialUpper))
    .slice(0, 200)
    .map((l: any) => ({
      edge_name: String(l.edgeName ?? l.edge?.name ?? l.edge?.edgeName ?? "Unknown Edge"),
      link_name: String(l.linkName ?? l.name ?? l.pathName ?? "Unknown Link"),
      state: asState(String(l.state ?? l.linkState ?? "up")),
      jitter_ms: Number(l.jitterMs ?? l.jitter ?? 0),
      latency_ms: Number(l.latencyMs ?? l.latency ?? 0),
      loss_pct: Number(l.lossPct ?? l.loss ?? 0),
      updated_at: String(l.updatedAt ?? l.time ?? new Date().toISOString()),
    }));
}

function buildDerivedSeries(links: VcLink[], alerts: VcAlert[]): EdgeMetricPoint[] {
  const avgLatency = links.length ? links.reduce((s, l) => s + l.latency_ms, 0) / links.length : 30;
  const avgJitter = links.length ? links.reduce((s, l) => s + l.jitter_ms, 0) / links.length : 5;
  const avgLoss = links.length ? links.reduce((s, l) => s + l.loss_pct, 0) / links.length : 0.2;
  const alertBoost = Math.min(1.8, 1 + alerts.filter((a) => a.status === "open").length * 0.12);

  const points: EdgeMetricPoint[] = [];
  for (let i = 23; i >= 0; i -= 1) {
    const ts = new Date(Date.now() - i * 60 * 60 * 1000).toISOString();
    const wave = Math.sin(i / 3);
    const trend = Math.cos(i / 5) * 0.6;
    points.push({
      ts,
      latency_ms: Math.max(1, Number(((avgLatency + (wave * 6 + trend * 3)) * alertBoost).toFixed(1))),
      jitter_ms: Math.max(0, Number(((avgJitter + (wave * 2 + trend)) * alertBoost).toFixed(1))),
      loss_pct: Math.max(0, Number(((avgLoss + (wave * 0.35 + trend * 0.15)) * alertBoost).toFixed(2))),
    });
  }
  return points;
}

function extractTimeseriesFromPayload(payload: any, serialUpper: string): EdgeMetricPoint[] {
  const out: EdgeMetricPoint[] = [];
  const seen = new Set<string>();

  function walk(node: any, depth: number) {
    if (!node || depth > 7) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;

    const hasEdge = edgeMatches(node, serialUpper) || edgeMatches(node?.edge, serialUpper);
    const latency = Number(node.latency_ms ?? node.latencyMs ?? node.latency ?? node.rtt ?? NaN);
    const jitter = Number(node.jitter_ms ?? node.jitterMs ?? node.jitter ?? NaN);
    const loss = Number(node.loss_pct ?? node.lossPct ?? node.loss ?? node.packetLoss ?? NaN);
    const ts = String(node.ts ?? node.time ?? node.timestamp ?? node.sampleTime ?? "");

    if (hasEdge && ts && Number.isFinite(latency) && Number.isFinite(jitter) && Number.isFinite(loss)) {
      const iso = new Date(ts).toISOString();
      if (!seen.has(iso)) {
        seen.add(iso);
        out.push({ ts: iso, latency_ms: latency, jitter_ms: jitter, loss_pct: loss });
      }
    }

    for (const v of Object.values(node)) {
      if (typeof v === "object") walk(v, depth + 1);
    }
  }

  walk(payload, 0);

  return out
    .filter((p) => Number.isFinite(new Date(p.ts).getTime()))
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .slice(-96);
}

function rangeMs(range: RangeKey) {
  if (range === "1h") return 60 * 60 * 1000;
  if (range === "7d") return 7 * 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

function filterSeriesByRange(timeseries: EdgeMetricPoint[], range: RangeKey) {
  const cutoff = Date.now() - rangeMs(range);
  return timeseries.filter((p) => new Date(p.ts).getTime() >= cutoff);
}

function filterAlertsByRange(alerts: VcAlert[], range: RangeKey) {
  const cutoff = Date.now() - rangeMs(range);
  return alerts.filter((a) => {
    const t = new Date(a.started_at).getTime();
    return Number.isFinite(t) ? t >= cutoff : true;
  });
}

function summarizeMetrics(timeseries: EdgeMetricPoint[]): EdgeMetricsSummary {
  const series = timeseries.length > 0 ? timeseries : [{ ts: new Date().toISOString(), latency_ms: 0, jitter_ms: 0, loss_pct: 0 }];
  const latency = series.map((p) => p.latency_ms);
  const jitter = series.map((p) => p.jitter_ms);
  const loss = series.map((p) => p.loss_pct);
  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;

  return {
    current_latency_ms: latency[latency.length - 1] ?? 0,
    avg_latency_ms: Number(avg(latency).toFixed(1)),
    max_latency_ms: Number(Math.max(...latency).toFixed(1)),
    current_jitter_ms: jitter[jitter.length - 1] ?? 0,
    avg_jitter_ms: Number(avg(jitter).toFixed(1)),
    max_jitter_ms: Number(Math.max(...jitter).toFixed(1)),
    current_loss_pct: loss[loss.length - 1] ?? 0,
    avg_loss_pct: Number(avg(loss).toFixed(2)),
    max_loss_pct: Number(Math.max(...loss).toFixed(2)),
    sample_count: series.length,
  };
}
async function fetchLive(baseUrl: string, apiKey: string, serialUpper: string) {
  const base = baseUrl.replace(/\/$/, "");

  const authVariants: Array<{ name: string; headers: Record<string, string> }> = [
    {
      name: "bearer+x-api-key",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "x-api-key": apiKey,
      },
    },
    {
      name: "token+x-api-key",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${apiKey}`,
        "x-api-key": apiKey,
      },
    },
  ];

  const attempts: string[] = [];

  for (const auth of authVariants) {
    const alertsUrl = `${base}/portal/rest/event/getEnterpriseEvents`;
    const linksUrl = `${base}/portal/rest/edge/getEnterpriseEdgeLinks`;

    const [alertsRes, linksRes] = await Promise.all([
      fetch(alertsUrl, { method: "POST", headers: auth.headers, body: JSON.stringify({}) }),
      fetch(linksUrl, { method: "POST", headers: auth.headers, body: JSON.stringify({}) }),
    ]);

    attempts.push(`portal-rest/${auth.name} => alerts:${alertsRes.status} links:${linksRes.status}`);

    if (!alertsRes.ok || !linksRes.ok) continue;

    const alertsJson = await alertsRes.json();
    const linksJson = await linksRes.json();

    const alerts = mapAlerts(alertsJson, serialUpper);
    const links = mapLinks(linksJson, serialUpper);
    const candidates = [
      ...extractEdgeCandidates(linksJson, serialUpper),
      ...extractEdgeCandidates(alertsJson, serialUpper),
    ].slice(0, 12);

    // Try to pull historical metric samples for this edge from common portal endpoints.
    const metricEndpoints = [
      `${base}/portal/rest/metrics/getEdgeLinkMetrics`,
      `${base}/portal/rest/metrics/getEdgeMetrics`,
      `${base}/portal/rest/link/getEdgeLinkStats`,
    ];

    const metricBodies = [
      { serialNumber: serialUpper },
      { edgeSerialNumber: serialUpper },
      { edgeSerial: serialUpper },
      { edgeName: serialUpper },
      { query: serialUpper },
      {},
    ];

    const metricPayloads: any[] = [];
    for (const url of metricEndpoints) {
      for (const body of metricBodies) {
        const metricRes = await fetch(url, { method: "POST", headers: auth.headers, body: JSON.stringify(body) });
        attempts.push(`${url.split("/portal/rest/")[1]}/${auth.name} => ${metricRes.status}`);
        if (!metricRes.ok) continue;
        try {
          metricPayloads.push(await metricRes.json());
        } catch {
          // ignore parse errors
        }
      }
    }

    const extracted = metricPayloads.flatMap((p) => extractTimeseriesFromPayload(p, serialUpper));
    const timeseries = extracted.length >= 6 ? extracted : buildDerivedSeries(links, alerts);

    return {
      matched: `portal-rest/${auth.name}`,
      alerts,
      links,
      candidates,
      timeseries,
      timeseries_source: extracted.length >= 6 ? "live-metrics" : "derived-from-links",
      attempts,
    };
  }

  throw new Error(`Edge lookup auth failed. Attempts: ${attempts.join(" | ")}`);
}

function snapshot(serial: string) {
  const now = new Date().toISOString();
  const edgeName = `Edge ${serial}`;
  const links: VcLink[] = [
    { edge_name: edgeName, link_name: "MPLS", state: "up", latency_ms: 26, jitter_ms: 3, loss_pct: 0.1, updated_at: now },
    { edge_name: edgeName, link_name: "Broadband", state: "degraded", latency_ms: 78, jitter_ms: 15, loss_pct: 2.1, updated_at: now },
  ];

  return {
    edge_name: edgeName,
    alerts: [
      {
        id: `snap-${serial}-1`,
        severity: "major" as const,
        title: "Derived sample alert (snapshot mode)",
        edge_name: edgeName,
        link_name: "Broadband",
        status: "open" as const,
        started_at: now,
      },
    ],
    links,
    timeseries: buildDerivedSeries(links),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const query = String(req.query.serial ?? req.query.edgeId ?? req.query.q ?? "").trim();
    if (!query) return res.status(400).json({ error: "serial or edgeId is required" });

    const requestedRange = String(req.query.range ?? "24h").trim() as RangeKey;
    const range: RangeKey = requestedRange === "1h" || requestedRange === "7d" ? requestedRange : "24h";
    const includePast = String(req.query.includePast ?? "false").toLowerCase() === "true";

    const serialUpper = query.toUpperCase();
    const apiKey = String(process.env.VELOCLOUD_API_KEY ?? "").trim();
    const baseUrl = String(process.env.VELOCLOUD_API_URL ?? "https://vco18-usvi1.velocloud.net").trim();

    let source: "live" | "snapshot" = "snapshot";
    let warning: string | null = null;

    let edge_name = `Edge ${serialUpper}`;
    let alerts: VcAlert[] = [];
    let links: VcLink[] = [];
    let timeseries: EdgeMetricPoint[] = [];
    let candidate_edges: EdgeCandidate[] = [];
    let timeseries_source: "live-metrics" | "derived-from-links" | "snapshot" = "snapshot";

    if (!apiKey) {
      warning = "VELOCLOUD_API_KEY is not configured. Showing snapshot edge data.";
      const snap = snapshot(serialUpper);
      edge_name = snap.edge_name;
      alerts = snap.alerts;
      links = snap.links;
      timeseries = snap.timeseries;
      timeseries_source = "snapshot";
    } else {
      try {
        const live = await fetchLive(baseUrl, apiKey, serialUpper);
        source = "live";
        alerts = live.alerts;
        links = live.links;
        edge_name = links[0]?.edge_name ?? alerts[0]?.edge_name ?? `Edge ${serialUpper}`;
        timeseries = live.timeseries;
        candidate_edges = live.candidates ?? [];
        timeseries_source = live.timeseries_source;
        warning = `Connected via ${live.matched} · ${live.timeseries_source}`;

        if (alerts.length === 0 && links.length === 0) {
          const hint = candidate_edges.length > 0
            ? ` Try: ${candidate_edges.map((c) => c.value).slice(0, 5).join(", ")}`
            : "";
          warning = `${warning} · No edge matched serial '${serialUpper}'.${hint}`;
        }
      } catch (e) {
        warning = e instanceof Error ? `${e.message}. Showing snapshot edge data.` : "Edge lookup failed. Showing snapshot edge data.";
        const snap = snapshot(serialUpper);
        edge_name = snap.edge_name;
        alerts = snap.alerts;
        links = snap.links;
        timeseries = snap.timeseries;
      timeseries_source = "snapshot";
      }
    }

    const rangedAlerts = filterAlertsByRange(alerts, range);
    const active_alerts = rangedAlerts.filter((a) => a.status === "open");
    const historical_alerts = rangedAlerts.filter((a) => a.status !== "open");
    const filteredTimeseries = filterSeriesByRange(timeseries, range);

    const summary = {
      total_alerts: active_alerts.length,
      links_up: links.filter((l) => l.state === "up").length,
      links_degraded: links.filter((l) => l.state === "degraded").length,
      links_down: links.filter((l) => l.state === "down").length,
    };

    const metrics_summary = summarizeMetrics(filteredTimeseries.length ? filteredTimeseries : timeseries);

    return res.status(200).json({
      source,
      fetched_at: new Date().toISOString(),
      warning,
      serial: serialUpper,
      edge_name,
      alerts: includePast ? [...active_alerts, ...historical_alerts] : active_alerts,
      active_alerts,
      historical_alerts,
      links,
      timeseries: filteredTimeseries,
      timeseries_source,
      metrics_summary,
      candidate_edges,
      range,
      summary,
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
