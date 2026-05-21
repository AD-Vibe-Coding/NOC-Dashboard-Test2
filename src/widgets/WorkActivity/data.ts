import { useEffect, useState } from "react";
import {
  fetchCallsToday,
  fetchWorkActivity,
  type CallsTodayResponse,
  type WorkActivityResponse,
} from "../../lib/work-activity";

/**
 * Hook for the Work Activity widget. Pulls both the Slack activity feed and
 * Zoom call-log summary in parallel, refreshes every 60s. Returns separate
 * loading / error states so partial failure is surfaced clearly (e.g. live
 * Slack but snapshot Zoom).
 */
export function useWorkActivity() {
  const [slack, setSlack] = useState<WorkActivityResponse | null>(null);
  const [calls, setCalls] = useState<CallsTodayResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [slackError, setSlackError] = useState<string | null>(null);
  const [callsError, setCallsError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setSlackError(null);
    setCallsError(null);
    await Promise.all([
      fetchWorkActivity()
        .then(setSlack)
        .catch((err) => setSlackError(err instanceof Error ? err.message : String(err))),
      fetchCallsToday()
        .then(setCalls)
        .catch((err) => setCallsError(err instanceof Error ? err.message : String(err))),
    ]);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, []);

  return { slack, calls, loading, slackError, callsError, refresh };
}
