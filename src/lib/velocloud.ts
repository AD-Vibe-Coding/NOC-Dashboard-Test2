import { fetchJson } from "./fetch-resilient";

export type VcSeverity = "critical" | "major" | "minor" | "info";

export interface VcAlert {
  id: string;
  severity: VcSeverity;
  title: string;
  edge_name: string;
  link_name: string;
  status: "open" | "cleared";
  started_at: string;
}

export interface VcLinkStatus {
  edge_name: string;
  link_name: string;
  state: "up" | "degraded" | "down";
  jitter_ms: number;
  latency_ms: number;
  loss_pct: number;
  updated_at: string;
}

export interface VcOverviewResponse {
  source: "live" | "snapshot";
  fetched_at: string;
  warning: string | null;
  alerts: VcAlert[];
  links: VcLinkStatus[];
  summary: {
    total_alerts: number;
    links_up: number;
    links_degraded: number;
    links_down: number;
  };
}

export interface VcEdgeMetricPoint {
  ts: string;
  latency_ms: number;
  jitter_ms: number;
  loss_pct: number;
}

export interface VcEdgeMetricsSummary {
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
}

export interface VcEdgeResponse {
  source: "live" | "snapshot";
  fetched_at: string;
  warning: string | null;
  serial: string;
  edge_name: string;
  alerts: VcAlert[];
  active_alerts: VcAlert[];
  historical_alerts: VcAlert[];
  links: VcLinkStatus[];
  timeseries: VcEdgeMetricPoint[];
  timeseries_source: "live-metrics" | "derived-from-links" | "snapshot";
  metrics_summary: VcEdgeMetricsSummary;
  candidate_edges?: Array<{ label: string; value: string }>;
  range: VcRange;
  summary: {
    total_alerts: number;
    links_up: number;
    links_degraded: number;
    links_down: number;
  };
}

export async function fetchVelocloudOverview(): Promise<VcOverviewResponse> {
  return fetchJson<VcOverviewResponse>("/api/velocloud/overview");
}

export type VcRange = "1h" | "24h" | "7d";

export async function fetchVelocloudEdge(
  serial: string,
  options?: { range?: VcRange; includePast?: boolean },
): Promise<VcEdgeResponse> {
  const qs = new URLSearchParams({ serial: serial.trim() });
  if (options?.range) qs.set("range", options.range);
  if (options?.includePast) qs.set("includePast", "true");
  return fetchJson<VcEdgeResponse>(`/api/velocloud/edge?${qs.toString()}`);
}
