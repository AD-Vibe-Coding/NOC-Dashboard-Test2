import { useCallback, useEffect, useState } from "react";
import { fetchWfhRequests, type WfhListResponse } from "../../lib/wfh";
import { useIdentity } from "../../lib/identity";

export function useWfhData() {
  const { identity } = useIdentity();
  const [data, setData] = useState<WfhListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchWfhRequests(identity?.name);
      setData(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [identity?.name]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000); // poll every 30s for fresh decisions
    return () => clearInterval(id);
  }, [refresh]);

  return { data, loading, error, refresh, identity };
}
