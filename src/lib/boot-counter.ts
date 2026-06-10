/**
 * boot-counter.ts — always-visible reload diagnostics for the deployed build.
 *
 * Purpose: the app has been doing real document reloads (Boot badge increments,
 * `nav=reload`, `unload=pagehide`) only when signed in, even on rolled-back code.
 * This module captures the *cadence* of those reloads so the platform team has
 * hard data for a runtime/preview-layer bug report.
 *
 * Design notes:
 *   - Pure DOM (no React). It mounts a fixed banner directly on <body> so it
 *     survives even if the React tree crashes, unmounts, or the iframe swaps.
 *   - Persists boot timestamps in localStorage so the count + inter-boot gaps
 *     survive across full document reloads (that's the whole point).
 *   - Records the browser navigation type + the unload reason of the PREVIOUS
 *     page lifecycle so we can distinguish reload / navigate / bfcache restore.
 */

const STORAGE_KEY = "noc:boot-counter:v1";
const MAX_HISTORY = 50;

type BootRecord = {
  /** 1-based boot number for this browser/localStorage profile. */
  n: number;
  /** ISO timestamp of this boot. */
  at: string;
  /** Performance navigation type at boot: navigate | reload | back_forward | prerender. */
  nav: string;
  /** How the PREVIOUS page went away, captured on the prior lifecycle. */
  prevUnload: string | null;
  /** ms since the previous boot (the cadence), null for first boot. */
  gapMs: number | null;
};

type BootState = {
  history: BootRecord[];
  /** Set by the pagehide/beforeunload handler of the CURRENT page so the NEXT
   *  boot can read why this page went away. */
  pendingUnload: string | null;
};

function read(): BootState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { history: [], pendingUnload: null };
    const parsed = JSON.parse(raw) as BootState;
    if (!parsed || !Array.isArray(parsed.history)) return { history: [], pendingUnload: null };
    return { history: parsed.history, pendingUnload: parsed.pendingUnload ?? null };
  } catch {
    return { history: [], pendingUnload: null };
  }
}

function write(state: BootState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full / blocked — non-fatal */
  }
}

function navType(): string {
  try {
    const entries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (entries.length > 0 && entries[0].type) return entries[0].type;
  } catch {
    /* ignore */
  }
  // Legacy fallback
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy = (performance as any).navigation;
    if (legacy) {
      switch (legacy.type) {
        case 1: return "reload";
        case 2: return "back_forward";
        default: return "navigate";
      }
    }
  } catch {
    /* ignore */
  }
  return "unknown";
}

function fmtGap(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

let bannerEl: HTMLDivElement | null = null;
let detailEl: HTMLDivElement | null = null;
let expanded = false;
let currentRecord: BootRecord | null = null;

function renderBanner(history: BootRecord[]) {
  if (!bannerEl) return;
  const rec = currentRecord!;
  const recent = history.slice(-8).reverse();

  bannerEl.textContent = "";

  const summary = document.createElement("div");
  summary.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:8px",
    "cursor:pointer",
    "font-weight:600",
  ].join(";");
  summary.textContent = `⟳ Boot ${rec.n} · nav:${rec.nav} · gap:${fmtGap(rec.gapMs)} · prev-unload:${rec.prevUnload ?? "—"}`;
  summary.title = "Click to expand boot history (reload cadence diagnostics)";
  summary.addEventListener("click", () => {
    expanded = !expanded;
    if (detailEl) detailEl.style.display = expanded ? "block" : "none";
  });
  bannerEl.appendChild(summary);

  detailEl = document.createElement("div");
  detailEl.style.cssText = [
    "display:" + (expanded ? "block" : "none"),
    "margin-top:6px",
    "max-height:160px",
    "overflow:auto",
    "font-weight:400",
    "line-height:1.5",
    "opacity:0.9",
  ].join(";");

  const header = document.createElement("div");
  header.style.cssText = "opacity:0.7;margin-bottom:2px";
  header.textContent = `session id ${getSessionId()} · last ${recent.length} boots:`;
  detailEl.appendChild(header);

  for (const h of recent) {
    const row = document.createElement("div");
    row.textContent = `#${h.n}  ${new Date(h.at).toLocaleTimeString()}  nav:${h.nav}  gap:${fmtGap(h.gapMs)}  prev-unload:${h.prevUnload ?? "—"}`;
    detailEl.appendChild(row);
  }

  bannerEl.appendChild(detailEl);
}

let sessionId = "";
function getSessionId(): string {
  if (sessionId) return sessionId;
  try {
    const existing = sessionStorage.getItem("noc:boot-session-id");
    if (existing) {
      sessionId = existing;
      return sessionId;
    }
  } catch {
    /* ignore */
  }
  sessionId = Math.random().toString(36).slice(2, 8);
  try {
    sessionStorage.setItem("noc:boot-session-id", sessionId);
  } catch {
    /* ignore */
  }
  return sessionId;
}

/**
 * Call once, as early as possible (top of main.tsx). Idempotent within a
 * single document lifecycle.
 */
export function initBootCounter() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if ((window as unknown as { __bootCounterInit?: boolean }).__bootCounterInit) return;
  (window as unknown as { __bootCounterInit?: boolean }).__bootCounterInit = true;

  const state = read();
  const prev = state.history.length > 0 ? state.history[state.history.length - 1] : null;
  const now = Date.now();
  const gapMs = prev ? now - new Date(prev.at).getTime() : null;

  currentRecord = {
    n: (prev?.n ?? 0) + 1,
    at: new Date(now).toISOString(),
    nav: navType(),
    prevUnload: state.pendingUnload,
    gapMs,
  };

  const history = [...state.history, currentRecord].slice(-MAX_HISTORY);
  // Clear pendingUnload now that we've consumed it; it gets re-set on this
  // page's own unload below.
  write({ history, pendingUnload: null });

  // Record how THIS page goes away so the next boot can attribute it.
  const markUnload = (reason: string) => {
    const s = read();
    write({ history: s.history, pendingUnload: reason });
  };
  window.addEventListener("pagehide", () => markUnload("pagehide"), { capture: true });
  window.addEventListener("beforeunload", () => markUnload("beforeunload"), { capture: true });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "hidden") markUnload("visibility:hidden");
    },
    { capture: true },
  );

  // Build the always-visible banner element and attach to <body>.
  const mount = () => {
    if (bannerEl) return;
    bannerEl = document.createElement("div");
    bannerEl.id = "noc-boot-counter";
    bannerEl.style.cssText = [
      "position:fixed",
      "bottom:8px",
      "right:8px",
      "z-index:2147483647",
      "max-width:min(92vw,460px)",
      "padding:6px 10px",
      "border-radius:8px",
      "background:rgba(15,22,36,0.92)",
      "color:#e6f3f7",
      "font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
      "box-shadow:0 4px 16px rgba(0,0,0,0.35)",
      "border:1px solid rgba(0,128,166,0.5)",
      "pointer-events:auto",
      "user-select:text",
    ].join(";");
    document.body.appendChild(bannerEl);
    renderBanner(history);
  };

  if (document.body) {
    mount();
  } else {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  }
}

/** Clear all recorded boot history (exposed for manual reset via console). */
export function resetBootCounter() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
