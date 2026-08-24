/**
 * GET  /api/app-usage — Returns per-user usage stats (manager only).
 * POST /api/app-usage — Records a usage event (any authenticated user).
 *
 * GET response shape:
 *   {
 *     summary: { dau, wau, mau, total_events },
 *     users: UserStat[],
 *     top_widgets: { widget_id, widget_title, count }[],
 *     daily_active: { date, count }[],   // last 14 days
 *   }
 *
 * POST body: { event_type, widget_id?, widget_title? }
 */
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { getSession, requireManager } from "./_lib/auth-middleware.js";

// Static roster for filling in users who haven't opened the app yet
const EXCLUDED_WIDGET_IDS = new Set(["zoom-queue", "shift-checklist"]);
const EXCLUDED_WIDGET_TITLES = new Set(["team availability", "shift handover checklist"]);

function isExcludedAppUsageEvent(event: any) {
  const widgetId = String(event?.widget_id ?? "").trim().toLowerCase();
  const widgetTitle = String(event?.widget_title ?? "").trim().toLowerCase();
  return EXCLUDED_WIDGET_IDS.has(widgetId) || EXCLUDED_WIDGET_TITLES.has(widgetTitle);
}

const STATIC_ROSTER = [
  { name: "Anirudh Kukudala",      role: "manager" },
  { name: "Perry Cox",             role: "manager" },
  { name: "Matt Marquez",          role: "manager" },
  { name: "Otukho Olembo",         role: "tier3"   },
  { name: "Mohammed Zubairuddin",  role: "tier2"   },
  { name: "Karthik Radhakrishnan", role: "tier2"   },
  { name: "Abhishek Benarji",      role: "tier2"   },
  { name: "Pranav Dandibhotla",    role: "tier1"   },
  { name: "Mohammed Ashraf",       role: "tier1"   },
  { name: "Akram Ahmed",           role: "tier1"   },
  { name: "Kenya Gentry",          role: "tier1"   },
  { name: "Hamza Rahmani",         role: "tier1"   },
  { name: "Sriram Parisa",         role: "tier1"   },
  { name: "Karthik Damagalla",     role: "tier1"   },
  { name: "Lokesh Naik Banavath",  role: "tier1"   },
  { name: "Mahalakshmi Samiti",    role: "tier1"   },
  { name: "Akash Hanvate",         role: "tier1"   },
];

function startOf(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  const session = getSession(req);

  // ── POST — record an event ─────────────────────────────────────────────────
  if (req.method === "POST") {
    if (!session) return res.status(401).json({ error: "Authentication required." });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const event_type = String(body.event_type ?? "widget_open").trim();
    const widget_id = body.widget_id ? String(body.widget_id).trim() : null;
    const widget_title = body.widget_title ? String(body.widget_title).trim() : null;

    const validTypes = ["widget_open", "sign_in", "page_view"];
    if (!validTypes.includes(event_type)) {
      return res.status(400).json({ error: `event_type must be one of: ${validTypes.join(", ")}` });
    }

    try {
      const { error } = await supabaseAdmin.from("app_events").insert({
        user_name: session.name,
        user_role: session.role,
        event_type,
        widget_id,
        widget_title,
      });
      if (error && !error.message?.includes("does not exist")) {
        return res.status(500).json({ error: error.message });
      }
    } catch { /* non-fatal if table not yet created */ }

    return res.status(201).json({ ok: true });
  }

  // ── GET — aggregated usage stats (manager only) ────────────────────────────
  if (!req.method || req.method === "GET") {
    if (!requireManager(req, res)) return;

    let events: any[] = [];
    let sessions: any[] = [];

    try {
      // Last 30 days of events
      const { data: evData } = await supabaseAdmin
        .from("app_events")
        .select("user_name, user_role, event_type, widget_id, widget_title, created_at")
        .gte("created_at", startOf(30))
        .order("created_at", { ascending: false })
        .limit(5000);
      events = (evData ?? []).filter((event: any) => !isExcludedAppUsageEvent(event));

      // Sign-in sessions
      const { data: sesData } = await supabaseAdmin
        .from("user_sessions")
        .select("name, sign_in_method, picture, last_sign_in");
      sessions = sesData ?? [];
    } catch { /* tables may not exist yet */ }

    const now = new Date();
    const todayStart = startOf(0);
    const weekStart  = startOf(7);

    // ── Per-user stats ──────────────────────────────────────────────────────
    const sessionMap = new Map<string, any>();
    for (const s of sessions) sessionMap.set(s.name, s);

    const userMap = new Map<string, {
      name: string;
      role: string;
      totalEvents: number;
      todayEvents: number;
      weekEvents: number;
      activeDays: Set<string>;
      widgetCounts: Map<string, { title: string; count: number }>;
      lastActive: string | null;
    }>();

    // Seed from static roster so every member appears even if they've never used the app
    for (const m of STATIC_ROSTER) {
      userMap.set(m.name, {
        name: m.name,
        role: m.role,
        totalEvents: 0,
        todayEvents: 0,
        weekEvents: 0,
        activeDays: new Set(),
        widgetCounts: new Map(),
        lastActive: sessionMap.get(m.name)?.last_sign_in ?? null,
      });
    }

    for (const ev of events) {
      const name = String(ev.user_name ?? "");
      if (!name) continue;
      let u = userMap.get(name);
      if (!u) {
        u = {
          name,
          role: ev.user_role ?? "tier1",
          totalEvents: 0,
          todayEvents: 0,
          weekEvents: 0,
          activeDays: new Set(),
          widgetCounts: new Map(),
          lastActive: null,
        };
        userMap.set(name, u);
      }
      u.totalEvents++;
      const evDay = ev.created_at?.slice(0, 10) ?? "";
      u.activeDays.add(evDay);
      if (!u.lastActive || ev.created_at > u.lastActive) u.lastActive = ev.created_at;
      if (ev.created_at >= todayStart) u.todayEvents++;
      if (ev.created_at >= weekStart) u.weekEvents++;
      if (ev.widget_id) {
        const wk = ev.widget_id;
        const existing = u.widgetCounts.get(wk);
        if (existing) existing.count++;
        else u.widgetCounts.set(wk, { title: ev.widget_title ?? wk, count: 1 });
      }
    }

    const users = Array.from(userMap.values()).map((u) => {
      // Top widget
      let topWidget: { id: string; title: string; count: number } | null = null;
      for (const [id, { title, count }] of u.widgetCounts) {
        if (!topWidget || count > topWidget.count) topWidget = { id, title, count };
      }
      const ses = sessionMap.get(u.name);
      return {
        name: u.name,
        role: u.role,
        picture: ses?.picture ?? null,
        sign_in_method: ses?.sign_in_method ?? null,
        last_active: u.lastActive ?? ses?.last_sign_in ?? null,
        total_events: u.totalEvents,
        today_events: u.todayEvents,
        week_events: u.weekEvents,
        active_days_30: u.activeDays.size,
        top_widget: topWidget,
      };
    });

    // Sort: most active this week first, then alphabetically
    users.sort((a, b) => b.week_events - a.week_events || a.name.localeCompare(b.name));

    // ── Summary ─────────────────────────────────────────────────────────────
    const dau = new Set(events.filter(e => e.created_at >= todayStart).map(e => e.user_name)).size;
    const wau = new Set(events.filter(e => e.created_at >= weekStart).map(e => e.user_name)).size;
    const mau = new Set(events.map(e => e.user_name)).size;

    // ── Top widgets ──────────────────────────────────────────────────────────
    const widgetTotals = new Map<string, { title: string; count: number }>();
    for (const ev of events) {
      if (!ev.widget_id) continue;
      const existing = widgetTotals.get(ev.widget_id);
      if (existing) existing.count++;
      else widgetTotals.set(ev.widget_id, { title: ev.widget_title ?? ev.widget_id, count: 1 });
    }
    const top_widgets = Array.from(widgetTotals.entries())
      .map(([widget_id, { title, count }]) => ({ widget_id, widget_title: title, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // ── Daily active users (last 14 days) ────────────────────────────────────
    const dailyMap = new Map<string, Set<string>>();
    for (let i = 0; i < 14; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dailyMap.set(d.toISOString().slice(0, 10), new Set());
    }
    for (const ev of events) {
      const day = ev.created_at?.slice(0, 10);
      if (dailyMap.has(day)) dailyMap.get(day)!.add(ev.user_name);
    }
    const daily_active = Array.from(dailyMap.entries())
      .map(([date, users]) => ({ date, count: users.size }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return res.status(200).json({
      summary: { dau, wau, mau, total_events: events.length },
      users,
      top_widgets,
      daily_active,
    });
  }

  // ── DELETE — wipe today's events (manager only) ───────────────────────────
  if (req.method === "DELETE") {
    if (!requireManager(req, res)) return;
    try {
      const { error } = await supabaseAdmin
        .from("app_events")
        .delete()
        .gte("created_at", startOf(0));
      if (error) return res.status(500).json({ error: error.message });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
    }
    return res.status(200).json({ ok: true, message: "Today's usage data cleared." });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ error: "Method not allowed." });
}
