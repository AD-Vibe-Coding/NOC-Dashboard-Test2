export interface RingCentralQueueMetric {
  queue_name: string;
  total: number;
  answered: number;
  abandoned: number;
  missed: number;
  system_handled: number;
  ringing_calls: number;
  avg_handle_seconds: number;
  avg_wait_seconds: number;
}

export interface RingCentralPeriodMetric extends RingCentralQueueMetric {
  interval_type: "week" | "month";
  period_start: string;
}

export interface RingCentralAnalyticsResponse {
  source: "ringcentral";
  period: "last_30_days";
  from_date: string;
  to_date: string;
  records: RingCentralQueueMetric[];
  history?: {
    weekly: RingCentralPeriodMetric[];
    monthly: RingCentralPeriodMetric[];
  };
  queues_found: string[];
  warning: string | null;
}

export interface RingCentralAnalyticsError {
  code?: string;
  error?: string;
}

export async function fetchRingCentralAnalytics(): Promise<RingCentralAnalyticsResponse> {
  const response = await fetch("/api/ringcentral/call-analytics", {
    cache: "no-store",
  });
  const raw = await response.text();
  let body: (RingCentralAnalyticsResponse & RingCentralAnalyticsError) | null = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const error = new Error(body?.error ?? `RingCentral call analytics failed (HTTP ${response.status})${raw ? `: ${raw.slice(0, 180)}` : "."}`);
    (error as Error & { code?: string }).code = body?.code;
    throw error;
  }
  if (!body || !Array.isArray(body.records)) {
    throw new Error("RingCentral returned an unexpected call-analytics response. Check the server endpoint and try refreshing.");
  }
  return body;
}
