// Client helpers for the WFH (Work From Home) approval widget. Real storage
// lives server-side in vite-plugins/wfh-proxy.ts so all team members see the
// same shared state when the app is deployed.

export type WfhStatus = "pending" | "approved" | "denied";

export interface WfhRequest {
  id: string;
  employee_name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  reason: string;
  status: WfhStatus;
  submitted_at: string; // ISO timestamp
  reviewed_by: string | null;
  reviewed_at: string | null; // ISO timestamp
  decision_note: string | null;
  slack_message_ts: string | null;
}

export interface WfhListResponse {
  requests: WfhRequest[];
  approver_name: string;
  is_approver: boolean;
  viewer: string | null;
}

import { fetchJson } from "./fetch-resilient";

export async function fetchWfhRequests(viewer?: string): Promise<WfhListResponse> {
  const url = viewer
    ? `/api/wfh/requests?as=${encodeURIComponent(viewer)}`
    : "/api/wfh/requests";
  return fetchJson<WfhListResponse>(url);
}

export interface WfhSubmitInput {
  employee_name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  reason: string;
}

export interface WfhSubmitResult {
  request: WfhRequest;
  slack_posted: boolean;
  email_sent: boolean;
  email_error: string | null;
  approver_email: string;
}

export async function submitWfhRequest(input: WfhSubmitInput): Promise<WfhSubmitResult> {
  const r = await fetch("/api/wfh/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `Submit failed: ${r.status}`);
  return j as WfhSubmitResult;
}

export interface WfhDecideInput {
  reviewer: string;
  decision: "approved" | "denied";
  note?: string;
}

export interface WfhDecideResult {
  request: WfhRequest;
  email_sent: boolean;
  email_error: string | null;
  employee_email: string | null;
}

export async function decideWfhRequest(
  id: string,
  input: WfhDecideInput,
): Promise<WfhDecideResult> {
  const r = await fetch(`/api/wfh/requests/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `Decision failed: ${r.status}`);
  return j as WfhDecideResult;
}

// Helper — compute number of (calendar) days inclusive between two YYYY-MM-DD strings
export function dayCount(startISO: string, endISO: string): number {
  const start = new Date(`${startISO}T00:00:00Z`).getTime();
  const end = new Date(`${endISO}T00:00:00Z`).getTime();
  if (!isFinite(start) || !isFinite(end) || end < start) return 0;
  return Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
}

export function formatDateRange(startISO: string, endISO: string): string {
  const start = new Date(`${startISO}T00:00:00`);
  const end = new Date(`${endISO}T00:00:00`);
  const sameDay = startISO === endISO;
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameDay) {
    return start.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: start.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    });
  }
  if (sameMonth) {
    return `${start.toLocaleDateString([], { month: "short", day: "numeric" })} → ${end.toLocaleDateString([], { day: "numeric" })}`;
  }
  return `${start.toLocaleDateString([], { month: "short", day: "numeric" })} → ${end.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

export const WFH_STATUS_COLORS: Record<WfhStatus, string> = {
  pending: "yellow",
  approved: "green",
  denied: "red",
};

export const WFH_STATUS_LABELS: Record<WfhStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  denied: "Denied",
};
