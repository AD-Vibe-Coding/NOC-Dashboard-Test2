import { useEffect, useState } from "react";
import { fetchVelocloudOverview, type VcOverviewResponse } from "../../lib/velocloud";

export function useVelocloud() {
  const [data, setData] = useState<VcOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchVelocloudOverview();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const i = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(i);
  }, []);

  return { data, loading, error, refresh };
}
