import type { VercelRequest, VercelResponse } from "@vercel/node";

type EdgeRow = {
  edge_id: string;
  edge_name: string;
  serial_number: string;
  model: string;
  status: string;
};

function collectObjects(node: any, out: any[]) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectObjects(item, out);
    return;
  }
  if (typeof node !== "object") return;
  out.push(node);
  for (const value of Object.values(node)) {
    if (typeof value === "object" && value) collectObjects(value, out);
  }
}

function mapEdges(payload: any): EdgeRow[] {
  const all: any[] = [];
  collectObjects(payload, all);

  const out: EdgeRow[] = [];
  const seen = new Set<string>();

  for (const row of all) {
    const edge = row?.edge ?? {};
    const edgeId = String(row?.id ?? row?.edgeId ?? row?.edgeLogicalId ?? edge?.id ?? edge?.edgeId ?? edge?.edgeLogicalId ?? "").trim();
    const name = String(row?.name ?? row?.edgeName ?? edge?.name ?? edge?.edgeName ?? "").trim();
    const serial = String(row?.serialNumber ?? row?.serial ?? edge?.serialNumber ?? edge?.serial ?? "").trim();
    const model = String(row?.modelNumber ?? row?.model ?? edge?.modelNumber ?? edge?.model ?? "").trim();
    const status = String(row?.status ?? row?.edgeState ?? edge?.status ?? "").trim().toLowerCase();

    if (!edgeId && !serial) continue;

    const key = edgeId || serial;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      edge_id: edgeId,
      edge_name: name || `Edge ${edgeId || serial}`,
      serial_number: serial,
      model,
      status,
    });
  }

  return out;
}

async function fetchEdges(baseUrl: string, apiKey: string) {
  const base = baseUrl.replace(/\/$/, "");
  const attempts: string[] = [];

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

  const endpoints = [
    `${base}/portal/rest/edge/getEnterpriseEdges`,
    `${base}/portal/rest/edge/getEnterpriseEdgeList`,
    `${base}/portal/rest/edge/getEnterpriseEdgeLinks`,
  ];

  for (const auth of authVariants) {
    for (const url of endpoints) {
      const res = await fetch(url, {
        method: "POST",
        headers: auth.headers,
        body: JSON.stringify({}),
      });

      attempts.push(`${url.split("/portal/rest/")[1]}/${auth.name}:${res.status}`);
      if (!res.ok) continue;

      const json = await res.json();
      const mapped = mapEdges(json);
      if (mapped.length === 0) continue;

      return {
        edges: mapped.sort((a, b) => a.edge_name.localeCompare(b.edge_name)),
        matched: `portal-rest/${auth.name}`,
        attempts,
      };
    }
  }

  throw new Error(`Unable to pull edges from VeloCloud. Attempts: ${attempts.join(" | ")}`);
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const apiKey = String(process.env.VELOCLOUD_API_KEY ?? "").trim();
    const baseUrl = String(process.env.VELOCLOUD_API_URL ?? "https://vco18-usvi1.velocloud.net").trim();

    if (!apiKey) {
      return res.status(400).json({ error: "VELOCLOUD_API_KEY is not configured." });
    }

    const live = await fetchEdges(baseUrl, apiKey);

    return res.status(200).json({
      source: "live",
      fetched_at: new Date().toISOString(),
      warning: `Connected via ${live.matched}`,
      total: live.edges.length,
      edges: live.edges,
      attempts: live.attempts,
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
