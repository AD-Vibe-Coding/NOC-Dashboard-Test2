export interface RingCentralQueueMetric {
  queue_name: string;
  total: number;
  answered: number;
  abandoned: number;
  missed: number;
  system_handled: number;
  avg_handle_seconds: number;
  avg_wait_seconds: number;
}

export interface RingCentralAnalyticsResponse {
  source: "ringcentral";
  month: string;
  from_date: string;
  to_date: string;
  records: RingCentralQueueMetric[];
  queues_found: string[];
  warning: string | null;
}

export interface RingCentralAnalyticsError {
  code?: string;
  error?: string;
}

export async function fetchRingCentralAnalytics(month: string): Promise<RingCentralAnalyticsResponse> {
  const response = await fetch(`/api/ringcentral/call-analytics?month=${encodeURIComponent(month)}`, {
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
