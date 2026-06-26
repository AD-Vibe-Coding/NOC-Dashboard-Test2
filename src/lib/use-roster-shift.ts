/**
 * useRosterShift — fetches and caches who is currently in their shift
 * from the NOC roster Google Sheet via /api/roster-shift.
 *
 * Polls every 5 minutes. Gracefully falls back to showing everyone
 * if the roster endpoint is unconfigured or returns an error.
 */

import { useEffect, useState, useCallback } from "react";

export interface ShiftWindow {
  name: string;
  start: number;
  end: number;
  cell: string;
}

export interface RosterShiftData {
  inShiftNow:   string[];
  allNames:     string[];
  shiftWindows: ShiftWindow[];
  dailyEntries?: Array<{
    name: string;
    cell: string;
    status: "Available" | "WO" | "PTO" | "Sick Leave" | "Sick Leave - Tentative" | "Emergency Leave" | "Holiday" | "Blank" | "Other";
    available: boolean;
    shift?: { start: number; end: number };
  }>;
  strategy:     string;
  sheetTitle:   string;
  fetchedAt:    string;
  rowCount:     number;
  targetDate?:  string;
  error?:       string;
  diagnostics?: {
    currentTimePST: string;
    currentMinPST:  number;
    todayLabel:     string;
    matchedCol:     number;
    headersPreview: string[];
  };
}

const POLL_MS = 5 * 60_000; // 5 minutes

/** Normalise a name for fuzzy matching: lowercase, collapse spaces */
function norm(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Check whether two names refer to the same person (handles "First Last" vs "Last, First" etc.) */
function nameMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  // One contains the other (handles partial names)
  if (na.includes(nb) || nb.includes(na)) return true;
  // Token overlap: if all tokens of the shorter appear in the longer
  const ta = new Set(na.split(" "));
  const tb = nb.split(" ");
  const overlap = tb.filter((t) => ta.has(t));
  if (overlap.length >= Math.min(ta.size, tb.length) && overlap.length >= 2) return true;
  return false;
}

export function useRosterShift() {
  const [data, setData]       = useState<RosterShiftData | null>(null);
  const [loading, setLoading] = useState(true);

  function isRosterListed(name: string): boolean {
    if (!data) return true;
    return data.allNames.some((s) => nameMatch(name, s));
  }

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/roster-shift");
      if (r.ok) {
        const j = await r.json() as RosterShiftData;
        setData(j);
      }
    } catch {
      // silent — keep previous data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  /**
   * Returns true if `name` is currently in shift.
   *
   * Graceful fallback rules:
   *   - Still loading → show all
   *   - Roster not configured / hard error → show all
   *   - "no-column-match" (roster read OK but date column not found) → show all
   *   - Strategy worked → only show people in inShiftNow
   */
  function isInShift(name: string): boolean {
    if (!data) return true; // still loading → show all
    const unconstrained =
      !data.strategy ||
      data.strategy === "unconfigured" ||
      data.strategy === "error" ||
      data.strategy === "fallback-all-listed" ||
      data.strategy === "no-column-match" ||
      data.strategy === "published-calendar-no-column" ||
      data.strategy === "published-csv-unmatched" ||
      data.strategy === "empty";
    if (unconstrained) return true;
    return data.inShiftNow.some((s) => nameMatch(name, s));
  }

  const configured = !!(data && data.strategy !== "unconfigured");

  return { data, loading, refresh, isInShift, isRosterListed, configured };
}
