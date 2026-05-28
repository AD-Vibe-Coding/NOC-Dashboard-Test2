// Client-side helpers for the Zoom Queue widget.
// All Zoom API calls happen server-side — credentials never reach the browser.

export type ZoomAgentStatus = "in_queue" | "not_in_queue";

export interface ZoomAgent {
  agent_id: string;
  display_name: string;
  status: ZoomAgentStatus;
  queues: string[];
  queue_opt_in?: Record<string, boolean>;
}

export interface ZoomQueueData {
  source: "live" | "snapshot";
  fetched_at: string;
  queue_name?: string;
  agents: ZoomAgent[];
  totals: {
    in_queue: number;
    not_in_queue: number;
  };
  warning: string | null;
}

import { fetchJson } from "./fetch-resilient";

export async function fetchZoomQueue(): Promise<ZoomQueueData> {
  return fetchJson<ZoomQueueData>("/api/zoom/queue");
}

export const ZOOM_STATUS_COLORS: Record<ZoomAgentStatus, string> = {
  in_queue:     "green",
  not_in_queue: "gray",
};

export const ZOOM_STATUS_LABELS: Record<ZoomAgentStatus, string> = {
  in_queue:     "In Queue",
  not_in_queue: "Not in Queue",
};
