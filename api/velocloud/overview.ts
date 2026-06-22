import type { VercelRequest, VercelResponse } from "@vercel/node";

type VcSeverity = "critical" | "major" | "minor" | "info";

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
  state: "up" | "degraded" | "down";
  jitter_ms: number;
  latency_ms: number;
  loss_pct: number;
  updated_at: string;
};

function snapshot() {
  const now = new Date().toISOString();
  const alerts: VcAlert[] = [
    { id: "vc-a1", severity: "critical", title: "Branch tunnel down", edge_name: "NYC-Edge-01", link_name: "MPLS", status: "open", started_at: now },
    { id: "vc-a2", severity: "major", title: "High packet loss", edge_name: "DAL-Edge-02", link_name: "Broadband", status: "open", started_at: now },
  ];
  const links: VcLink[] = [
    { edge_name: "NYC-Edge-01", link_name: "MPLS", state: "down", latency_ms: 0, jitter_ms: 0, loss_pct: 100, updated_at: now },
    { edge_name: "NYC-Edge-01", link_name: "Broadband", state: "up", latency_ms: 24, jitter_ms: 3, loss_pct: 0.1, updated_at: now },
    { edge_name: "DAL-Edge-02", link_name: "Broadband", state: "degraded", latency_ms: 78, jitter_ms: 18, loss_pct: 2.4, updated_at: now },
  ];
  return { alerts, links };
}

async function tryLive(baseUrl: string, apiKey: string) {
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
    {
      name: "x-api-key-only",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
    },
  ];

  const attempts: string[] = [];

  function mapAlerts(payload: any): VcAlert[] {
    const list = Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload)
      ? payload
      : [];

    return list.slice(0, 200).map((a: any) => ({
      id: String(a.id ?? a.alertId ?? a.eventId ?? Math.random()),
      severity: (String(a.severity ?? a.level ?? "info").toLowerCase() as VcSeverity),
      title: String(a.title ?? a.message ?? a.text ?? "Alert"),
      edge_name: String(a.edgeName ?? a.edge ?? a.edgeNameOrId ?? "Unknown Edge"),
      link_name: String(a.linkName ?? a.link ?? a.pathName ?? "Unknown Link"),
      status: String(a.status ?? "open").toLowerCase() === "cleared" ? "cleared" : "open",
      started_at: String(a.startedAt ?? a.startTime ?? a.time ?? new Date().toISOString()),
    }));
  }

  function mapLinks(payload: any): VcLink[] {
    const list = Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload)
      ? payload
      : [];

    return list.slice(0, 400).map((l: any) => ({
      edge_name: String(l.edgeName ?? l.edge ?? l.edgeNameOrId ?? "Unknown Edge"),
      link_name: String(l.linkName ?? l.name ?? l.pathName ?? "Unknown Link"),
      state:
        String(l.state ?? l.linkState ?? "up").toLowerCase() === "down"
          ? "down"
          : String(l.state ?? l.linkState ?? "up").toLowerCase() === "degraded"
          ? "degraded"
          : "up",
      jitter_ms: Number(l.jitterMs ?? l.jitter ?? 0),
      latency_ms: Number(l.latencyMs ?? l.latency ?? 0),
      loss_pct: Number(l.lossPct ?? l.loss ?? 0),
      updated_at: String(l.updatedAt ?? l.time ?? new Date().toISOString()),
    }));
  }

  // Modern SD-WAN API variants (GET)
  for (const auth of authVariants) {
    for (const ep of [
      { name: "sdwan-v2", alertsUrl: `${base}/api/sdwan/v2/alerts`, linksUrl: `${base}/api/sdwan/v2/links` },
      { name: "sdwan-v1", alertsUrl: `${base}/api/sdwan/v1/alerts`, linksUrl: `${base}/api/sdwan/v1/links` },
    ]) {
      const [alertsRes, linksRes] = await Promise.all([
        fetch(ep.alertsUrl, { headers: auth.headers }),
        fetch(ep.linksUrl, { headers: auth.headers }),
      ]);

      attempts.push(`${ep.name}/${auth.name} => alerts:${alertsRes.status} links:${linksRes.status}`);

      if (!alertsRes.ok || !linksRes.ok) continue;

      const alertsJson = await alertsRes.json();
      const linksJson = await linksRes.json();
      return { alerts: mapAlerts(alertsJson), links: mapLinks(linksJson), attempts, matched: `${ep.name}/${auth.name}` };
    }
  }

  // Legacy VCO portal REST variants (POST)
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
    return { alerts: mapAlerts(alertsJson), links: mapLinks(linksJson), attempts, matched: `portal-rest/${auth.name}` };
  }

  throw new Error(
    `VeloCloud auth failed. Attempts: ${attempts.join(" | ")}. Verify that VELOCLOUD_API_KEY is an API token (not UI password/session) and has read permissions for enterprise events/links.`,
  );
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const apiKey = String(process.env.VELOCLOUD_API_KEY ?? "").trim();
    const baseUrl = String(process.env.VELOCLOUD_API_URL ?? "https://vco18-usvi1.velocloud.net").trim();

    let source: "live" | "snapshot" = "snapshot";
    let warning: string | null = null;
    let data = snapshot();

    if (!apiKey) {
      warning = "VELOCLOUD_API_KEY is not configured. Showing snapshot data.";
    } else {
      try {
        const live = await tryLive(baseUrl, apiKey);
        data = { alerts: live.alerts, links: live.links };
        source = "live";
        warning = `Connected via ${live.matched}`;
      } catch (e) {
        warning = e instanceof Error ? `${e.message}. Showing snapshot data.` : "Live API failed. Showing snapshot data.";
      }
    }

    const summary = {
      total_alerts: data.alerts.filter((a) => a.status === "open").length,
      links_up: data.links.filter((l) => l.state === "up").length,
      links_degraded: data.links.filter((l) => l.state === "degraded").length,
      links_down: data.links.filter((l) => l.state === "down").length,
    };

    return res.status(200).json({
      source,
      fetched_at: new Date().toISOString(),
      warning,
      alerts: data.alerts,
      links: data.links,
      summary,
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
