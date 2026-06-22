import { useEffect, useState } from "react";

function isoDateDaysAgo(daysAgo: number) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface AttendanceMemberRow {
  employee_name: string;
  first_punch_in: string | null;
  last_punch_out: string | null;
  total_punch_ins: number;
  total_punch_outs: number;
  queue_reminders: number;
  break_reminders: number;
  days_present: number;
  daily: Record<string, { punch_in: string | null; punch_out: string | null; queue_reminders: number; break_reminders: number }>;
}

export interface AttendanceSummaryResponse {
  summary: {
    total_people: number;
    total_punch_ins: number;
    total_punch_outs: number;
    total_queue_reminders: number;
    total_break_reminders: number;
    range_label: string;
  };
  members: AttendanceMemberRow[];
  date_from: string;
  date_to: string;
}

export function useAttendanceSummary() {
  const [data, setData] = useState<AttendanceSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(options?: { dateFrom?: string; dateTo?: string }) {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        date_from: options?.dateFrom ?? isoDateDaysAgo(13),
        date_to: options?.dateTo ?? new Date().toISOString().slice(0, 10),
      });
      const res = await fetch(`/api/attendance_summary?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load attendance summary");
      setData(json as AttendanceSummaryResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return { data, loading, error, refresh };
}
