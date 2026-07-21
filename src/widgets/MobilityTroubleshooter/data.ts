import { useCallback, useEffect, useRef, useState } from "react";
import type { MobilityResponse } from "../../lib/mobility-confluence";

// No localStorage. A prior cache of "bundled · 51 issues" was sticky and
// kept winning over the live OPUS response from /api/confluence/mobility.

const BUILD = "mobility-live-3";

function wipeAllMobilityKeys() {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /mobility|opus|buyers.?club/i.test(k)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

async function fetchLive(signal?: AbortSignal): Promise<MobilityResponse> {
  const url = `/api/confluence/mobility?build=${BUILD}&ts=${Date.now()}&n=${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
    },
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Mobility API HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`,
    );
  }

  const json = (await res.json()) as MobilityResponse;
  if (!json || !Array.isArray(json.issues)) {
    throw new Error("Mobility API returned an invalid payload");
  }
  return json;
}

export function useMobilityGuides() {
  const [data, setData] = useState<MobilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [debug, setDebug] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (force = false) => {
    wipeAllMobilityKeys();

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const requestId = ++requestIdRef.current;

    if (force) {
      setData(null);
      setCachedAt(null);
    }

    setLoading(true);
    setError(null);
    setDebug(null);

    try {
      // Up to 3 attempts — covers Vite plugin restarts mid-request.
      let lastErr: unknown = null;
      let r: MobilityResponse | null = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        if (abort.signal.aborted) return;
        try {
          r = await fetchLive(abort.signal);
          // If we got pure offline matrix, wait and try again — live may
          // still be warming after a server restart.
          if (
            r.source === "bundled" &&
            (r.issues?.length ?? 0) >= 40 &&
            !r.page_version &&
            attempt < 2
          ) {
            setDebug(
              `Attempt ${attempt + 1}: got bundled (${r.issues.length}) — retrying live…`,
            );
            await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
            continue;
          }
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
            continue;
          }
        }
      }

      if (requestId !== requestIdRef.current || abort.signal.aborted) return;

      if (!r) {
        throw lastErr instanceof Error
          ? lastErr
          : new Error("Failed to load Mobility guides");
      }

      setData(r);
      setCachedAt(Date.now());
      setDebug(
        `${BUILD} · source=${r.source} · issues=${r.issues.length}` +
          (r.page_version ? ` · v${r.page_version}` : "") +
          (r.warning ? ` · ${r.warning}` : ""),
      );
    } catch (err) {
      if (abort.signal.aborted || requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setDebug(`${BUILD} · fetch error`);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    wipeAllMobilityKeys();
    void refresh(true);
    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  return { data, loading, error, refresh, cachedAt, debug, build: BUILD };
}
