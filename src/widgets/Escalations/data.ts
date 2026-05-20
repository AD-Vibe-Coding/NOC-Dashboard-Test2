import { useEffect, useState } from "react";
import { fetchEscalations, type EscalationsResponse } from "../../lib/confluence";

// QS Escalation Contacts on Confluence change rarely — typically a few times
// per quarter when carriers update their NOC rosters. Hitting the Confluence
// API + AI vision extraction on every page load wastes time (cold load ≈
// 8 sec) and burns AI tokens. So we cache the whole response in localStorage
// with a 24-hour TTL. Manual refresh via the widget header still force-
// refreshes (bypasses the cache).
const CACHE_KEY = "qs_escalation_contacts_v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedEntry {
  data: EscalationsResponse;
  cached_at: number; // ms since epoch
}

function readCache(): CachedEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (!parsed?.cached_at || !parsed?.data) return null;
    if (Date.now() - parsed.cached_at > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(data: EscalationsResponse) {
  try {
    const entry: CachedEntry = { data, cached_at: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* quota exceeded or storage unavailable — ignore */
  }
}

function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function useEscalations() {
  const [data, setData] = useState<EscalationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);

  /**
   * Refresh the data.
   *   - force=false (default): use the 24-hour cache when available
   *   - force=true (manual button click): bypass cache, fetch fresh
   */
  async function refresh(force = false) {
    if (!force) {
      const cached = readCache();
      if (cached) {
        setData(cached.data);
        setCachedAt(cached.cached_at);
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetchEscalations();
      setData(r);
      writeCache(r);
      setCachedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function forceRefresh() {
    clearCache();
    return refresh(true);
  }

  useEffect(() => {
    refresh(false);
    // No polling interval — Confluence content is refreshed at most once per
    // day via the 24-hour localStorage cache. The user can force-refresh from
    // the widget header.
  }, []);

  return {
    data,
    loading,
    error,
    refresh: forceRefresh, // header refresh button always force-refreshes
    cachedAt,
  };
}
