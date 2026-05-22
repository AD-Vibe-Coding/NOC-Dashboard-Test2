/**
 * Lightweight usage event tracker.
 *
 * Fires a best-effort POST to /api/app-usage. Never throws — if the call
 * fails (table not yet created, offline, unauthenticated) it fails silently
 * so it can never break the UI.
 *
 * Usage:
 *   import { trackWidgetOpen } from "../lib/track";
 *   trackWidgetOpen("zoom-queue", "Zoom Queue");
 */

let _pendingFlush: ReturnType<typeof setTimeout> | null = null;
const _queue: Array<{ event_type: string; widget_id?: string; widget_title?: string }> = [];

function flush() {
  if (_queue.length === 0) return;
  const batch = _queue.splice(0, _queue.length);
  // Fire each event individually so the API stays simple
  for (const ev of batch) {
    fetch("/api/app-usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ev),
      keepalive: true,
    }).catch(() => { /* silent */ });
  }
}

function enqueue(ev: { event_type: string; widget_id?: string; widget_title?: string }) {
  _queue.push(ev);
  if (_pendingFlush) clearTimeout(_pendingFlush);
  // Debounce 800ms so rapid widget switches only fire once
  _pendingFlush = setTimeout(flush, 800);
}

/** Track when a user opens / expands a widget. */
export function trackWidgetOpen(widgetId: string, widgetTitle: string) {
  enqueue({ event_type: "widget_open", widget_id: widgetId, widget_title: widgetTitle });
}

/** Track a page-level view (e.g. sign-in, dashboard load). */
export function trackPageView(page: string) {
  enqueue({ event_type: "page_view", widget_id: page });
}
