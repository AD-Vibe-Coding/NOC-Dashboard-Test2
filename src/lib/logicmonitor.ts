/**
 * Client-side helpers for the LogicMonitor widget. All real LM API calls
 * happen server-side (Vite middleware in vite-plugins/logicmonitor-proxy.ts)
 * so the LMv1 access key / bearer token never reaches the browser.
 */

import { fetchJson, resilientFetch } from "./fetch-resilient";

export type LmSeverity = "critical" | "error" | "warn" | "info";

export interface LmAlert {
  id: string;
  severity: LmSeverity;
  type: "dataSourceAlert" | "websiteAlert" | "eventAlert" | "logAlert" | "other";
  monitor_object_name: string;
  monitor_object_group: string;
  resource_template_name: string;
  instance_name: string;
  data_point: string;
  threshold: string;
  alert_value: string;
  start_epoch: number;
  acked: boolean;
  acked_by?: string;
  acked_on_epoch?: number;
  ack_comment?: string;
  sdted: boolean;
  cleared: boolean;
  rule: string;
  chain: string;
}

export interface LmAlertsResponse {
  source: "live" | "snapshot";
  fetched_at: string;
  alerts: LmAlert[];
  count: number;
  warning: string | null;
}

export interface LmDeviceSummary {
  total_devices: number;
  by_alert_state: { critical: number; error: number; warn: number; ok: number };
  top_offenders: Array<{
    device_name: string;
    group: string;
    critical: number;
    error: number;
    warn: number;
  }>;
}

export interface LmDevicesResponse {
  source: "live" | "snapshot";
  fetched_at: string;
  summary: LmDeviceSummary;
  warning: string | null;
}

export interface LmFilters {
  severity?: LmSeverity[];
  includeCleared?: boolean;
  includeAcked?: boolean;
  size?: number;
}

export async function fetchLmAlerts(filters: LmFilters = {}): Promise<LmAlertsResponse> {
  const qs = new URLSearchParams();
  if (filters.severity && filters.severity.length > 0) {
    qs.set("severity", filters.severity.join(","));
  }
  if (filters.includeCleared) qs.set("cleared", "true");
  if (filters.includeAcked === false) qs.set("acked", "false");
  if (filters.size) qs.set("size", String(filters.size));
  return fetchJson<LmAlertsResponse>(`/api/lm/alerts?${qs.toString()}`);
}

export async function fetchLmDevices(): Promise<LmDevicesResponse> {
  return fetchJson<LmDevicesResponse>("/api/lm/devices");
}

export async function ackLmAlert(alertId: string, comment: string): Promise<void> {
  const r = await resilientFetch("/api/lm/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alert_id: alertId, ack_comment: comment }),
  });
  const j = await r.json();
  if (!r.ok || j.error) {
    throw new Error(j.error ?? `Ack failed: HTTP ${r.status}`);
  }
}

// ---- Display helpers -----------------------------------------------------

export const LM_SEVERITY_COLORS: Record<LmSeverity, string> = {
  critical: "red",
  error: "orange",
  warn: "yellow",
  info: "blue",
};

export const LM_SEVERITY_LABELS: Record<LmSeverity, string> = {
  critical: "Critical",
  error: "Error",
  warn: "Warning",
  info: "Info",
};

export function lmSeverityRank(s: LmSeverity): number {
  return s === "critical" ? 0 : s === "error" ? 1 : s === "warn" ? 2 : 3;
}

/** Human-friendly elapsed time, e.g. "47m", "2h 12m", "3d". */
export function elapsedSince(epochMs: number): string {
  const sec = Math.max(1, Math.round((Date.now() - epochMs) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
  const days = Math.floor(hr / 24);
  return `${days}d`;
}
