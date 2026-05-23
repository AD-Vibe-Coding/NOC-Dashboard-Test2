// Client-side helpers for the Zoom Contact Center queue widget. All real
// Zoom API calls happen server-side (Vite middleware in vite-plugins/zoom-proxy.ts)
// so the OAuth credentials never reach the browser.

export type ZoomAgentStatus =
  | "on_call"     // actively in an engagement (voice/video/chat)
  | "ready"       // logged in and available to take calls
  | "wrap_up"     // post-call wrap up (after call work)
  | "not_ready"   // logged in but unavailable (break, training, etc.)
  | "offline";    // logged out

export interface ZoomAgent {
  agent_id: string;
  display_name: string;
  status: ZoomAgentStatus;
  // Sub-reason for not_ready (e.g. "Lunch", "Training") — optional.
  sub_status?: string;
  // When the current status started. ms epoch.
  status_changed_at: number;
  // If on_call: when this engagement started. ms epoch.
  engagement_started_at?: number;
  // If on_call: channel (voice / video / chat / sms / email)
  engagement_channel?: "voice" | "video" | "chat" | "sms" | "email";
  // Queue names this agent is opted into.
  queues: string[];
  // Per-queue receive_call status: { "Network Tech Support": true, "Mobility Tech Support": false }
  queue_opt_in?: Record<string, boolean>;
}

export interface ZoomQueueData {
  source: "live" | "snapshot";
  fetched_at: string;
  // Optional queue context if a single queue is being filtered
  queue_name?: string;
  agents: ZoomAgent[];
  // Summary counts
  totals: {
    on_call: number;
    ready: number;
    wrap_up: number;
    not_ready: number;
    offline: number;
  };
  warning: string | null;
}

import { fetchJson } from "./fetch-resilient";

export async function fetchZoomQueue(): Promise<ZoomQueueData> {
  return fetchJson<ZoomQueueData>("/api/zoom/queue");
}

export const ZOOM_STATUS_COLORS: Record<ZoomAgentStatus, string> = {
  on_call: "red",
  ready: "green",
  wrap_up: "orange",
  not_ready: "yellow",
  offline: "gray",
};

export const ZOOM_STATUS_LABELS: Record<ZoomAgentStatus, string> = {
  on_call: "On call",
  ready: "Ready",
  wrap_up: "Wrap-up",
  not_ready: "Not ready",
  offline: "Offline",
};

export const ZOOM_CHANNEL_LABELS: Record<
  NonNullable<ZoomAgent["engagement_channel"]>,
  string
> = {
  voice: "Voice",
  video: "Video",
  chat: "Chat",
  sms: "SMS",
  email: "Email",
};
