import { useEffect, useState } from "react";
import {
  fetchLmAlerts,
  fetchLmDevices,
  type LmAlertsResponse,
  type LmDevicesResponse,
  type LmFilters,
} from "../../lib/logicmonitor";

/**
 * Hook for the LogicMonitor widget. Polls /api/lm/alerts every 30 s for the
 * active alert feed and /api/lm/devices every 2 min for the device summary
 * (which is heavier to compute on the server).
 *
 * Filters change → an immediate refetch fires.
 */
export function useLogicMonitor(filters: LmFilters) {
  const [alerts, setAlerts] = useState<LmAlertsResponse | null>(null);
  const [devices, setDevices] = useState<LmDevicesResponse | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Serialize filters for the dependency array — the object identity changes
  // every render but the contents rarely do.
  const filterKey = JSON.stringify(filters);

  async function refreshAlerts() {
    setAlertsError(null);
    try {
      const r = await fetchLmAlerts(filters);
      setAlerts(r);
    } catch (err) {
      setAlertsError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshDevices() {
    setDevicesError(null);
    try {
      const r = await fetchLmDevices();
      setDevices(r);
    } catch (err) {
      setDevicesError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refresh() {
    setLoading(true);
    await Promise.all([refreshAlerts(), refreshDevices()]);
    setLoading(false);
  }

  // Initial load + filter changes → refetch alerts immediately (devices not
  // affected by filters, so we don't re-pull them).
  useEffect(() => {
    setLoading(true);
    Promise.all([refreshAlerts(), devices ? Promise.resolve() : refreshDevices()]).finally(
      () => setLoading(false),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // Polling
  useEffect(() => {
    const a = setInterval(refreshAlerts, 30_000);
    const d = setInterval(refreshDevices, 120_000);
    return () => {
      clearInterval(a);
      clearInterval(d);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  return { alerts, devices, loading, alertsError, devicesError, refresh };
}
