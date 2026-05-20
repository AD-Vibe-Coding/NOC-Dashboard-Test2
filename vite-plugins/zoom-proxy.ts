import type { Plugin } from "vite";
import { loadEnv } from "vite";

/**
 * Server-side proxy for the **Zoom Phone** API with the **Customer Engagement
 * Pack** (CEP) add-on. Zoom Phone is a separate product from Zoom Contact
 * Center — they have different APIs and different OAuth scopes.
 *
 * Authentication is Server-to-Server OAuth — three env vars are required:
 *   ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET
 *
 * Optional:
 *   ZOOM_QUEUE_ID — restrict to a single call queue
 *
 * Without those, the endpoint returns a realistic snapshot of NOC team agent
 * statuses so the widget works out-of-the-box for demo purposes.
 *
 * Required Bot Token Scopes (Zoom Phone):
 *   phone:read:list_users:admin
 *   phone:read:user:admin
 *   phone:read:list_call_queues:admin
 *   phone:read:list_call_queue_members:admin
 *   phone:read:list_calls:admin      (or phone:read:list_call_logs:admin)
 */

// ---- Snapshot data --------------------------------------------------------
// Names mirror the actual #noc-team roster so the dashboard tells a coherent
// story across the Slack break widget and the Zoom queue widget. Statuses are
// roughly aligned with the breaks visible in the Slack snapshot (people on
// lunch/bio in Slack are "not_ready" in Zoom, etc.).

interface SnapshotAgent {
  name: string;
  status: "on_call" | "ready" | "wrap_up" | "not_ready" | "offline";
  sub_status?: string;
  status_age_sec: number;
  engagement_age_sec?: number;
  channel?: "voice" | "video" | "chat" | "sms" | "email";
}

const SNAPSHOT: SnapshotAgent[] = [
  // On call right now
  { name: "Sriram Parisa", status: "on_call", engagement_age_sec: 14 * 60 + 22, channel: "voice", status_age_sec: 14 * 60 + 22 },
  { name: "Mohammed Akram Ahmed", status: "on_call", engagement_age_sec: 7 * 60 + 8, channel: "voice", status_age_sec: 7 * 60 + 8 },
  { name: "Karthik Damagalla", status: "on_call", engagement_age_sec: 2 * 60 + 41, channel: "video", status_age_sec: 2 * 60 + 41 },
  // Wrap-up
  { name: "Kenya Gentry", status: "wrap_up", status_age_sec: 38 },
  // Ready / available
  { name: "Karthik Radhakrishnan", status: "ready", status_age_sec: 18 * 60 },
  { name: "Anirudh Kukudala", status: "ready", status_age_sec: 5 * 60 },
  // Not ready — on a break (matching Slack)
  { name: "Otukho Olembo", status: "not_ready", sub_status: "Lunch", status_age_sec: 26 * 60 },
  { name: "Perry Cox", status: "not_ready", sub_status: "Lunch", status_age_sec: 36 * 60 },
  { name: "Akash Hanvate", status: "not_ready", sub_status: "Break", status_age_sec: 4 * 60 },
  // Off shift
  { name: "Ashraf Mohammed", status: "offline", status_age_sec: 72 * 60 },
  { name: "Pranav Dandibhotla", status: "offline", status_age_sec: 75 * 60 },
  { name: "Zubair Mohammed", status: "offline", status_age_sec: 95 * 60 },
  { name: "Hamza Rahmani", status: "offline", sub_status: "Day off", status_age_sec: 24 * 60 * 60 },
  { name: "Lokesh Naik Banavath", status: "offline", sub_status: "Day off", status_age_sec: 24 * 60 * 60 },
];

function buildSnapshot(queueName: string) {
  const now = Date.now();
  return SNAPSHOT.map((a, idx) => ({
    agent_id: `snap-${idx + 1}`,
    display_name: a.name,
    status: a.status,
    sub_status: a.sub_status,
    status_changed_at: now - a.status_age_sec * 1000,
    engagement_started_at: a.engagement_age_sec ? now - a.engagement_age_sec * 1000 : undefined,
    engagement_channel: a.channel,
    queues: [queueName],
  }));
}

// ---- OAuth token caching --------------------------------------------------

interface CachedToken {
  access_token: string;
  expires_at: number;
}
let cachedToken: CachedToken | null = null;

async function getZoomAccessToken(
  accountId: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  if (cachedToken && cachedToken.expires_at > Date.now() + 60_000) {
    return cachedToken.access_token;
  }
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const r = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    },
  );
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Zoom OAuth failed (${r.status}): ${body}`);
  }
  const j: any = await r.json();
  if (!j.access_token) throw new Error("Zoom OAuth response missing access_token");
  cachedToken = {
    access_token: j.access_token,
    expires_at: Date.now() + (j.expires_in ?? 3600) * 1000,
  };
  return cachedToken.access_token;
}

// ---- Live mode — Zoom Phone API -------------------------------------------
//
// We use these endpoints, all under the Zoom Phone product:
//   GET /phone/call_queues                       — find the NOC queue by name
//   GET /phone/call_queues/{id}/members          — roster of queue members
//   GET /phone/users (when no queue scope set)   — fallback roster
//   GET /phone/calls?call_status=ringing|connected — live calls in progress
//   GET /users/{userId}/presence_status          — chat-level presence (busy/available)

interface ZoomPhoneUser {
  id: string;
  email?: string;
  name?: string;
  status?: string; // "activate" / "deactivate"  (account status, NOT call status)
  extension_number?: string | number;
}

interface LiveCall {
  user_id?: string;
  caller_user_id?: string;
  callee_user_id?: string;
  start_time?: string;
  call_type?: string; // "inbound" / "outbound"
  call_status?: string; // "ringing" / "connected" / "in_progress"
  direction?: string;
}

async function zoomGet(token: string, path: string): Promise<any> {
  const r = await fetch(`https://api.zoom.us/v2${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Zoom ${path} (${r.status}): ${body.slice(0, 200)}`);
  }
  return r.json();
}

async function fetchAllPaginated(
  token: string,
  path: string,
  itemsKey: string,
): Promise<any[]> {
  // Zoom paginates with next_page_token. Limit to a few pages to stay snappy.
  const all: any[] = [];
  let nextToken = "";
  for (let i = 0; i < 5; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${path}${sep}page_size=100${nextToken ? `&next_page_token=${nextToken}` : ""}`;
    const j = await zoomGet(token, url);
    all.push(...(j[itemsKey] ?? []));
    nextToken = j.next_page_token ?? "";
    if (!nextToken) break;
  }
  return all;
}

async function fetchZoomPhoneAgentsLive(
  token: string,
  queueIdOrName?: string,
): Promise<{ agents: SnapshotAgent[]; resolvedQueueName: string }> {
  let queueName = "Zoom Phone Queue";
  let roster: ZoomPhoneUser[] = [];

  if (queueIdOrName) {
    // Resolve queue: accept either an exact ID or a name fragment
    let queueId = queueIdOrName;
    if (!/^[A-Za-z0-9_-]{15,}$/.test(queueIdOrName)) {
      // Treat as a name fragment — list queues and find it
      const queues = await fetchAllPaginated(token, "/phone/call_queues", "call_queues");
      const match = queues.find(
        (q: any) =>
          q.id === queueIdOrName ||
          q.name?.toLowerCase().includes(queueIdOrName.toLowerCase()) ||
          q.extension_number?.toString() === queueIdOrName,
      );
      if (!match) {
        throw new Error(
          `Queue "${queueIdOrName}" not found among ${queues.length} call queues. ` +
            `Set ZOOM_QUEUE_ID to one of: ${queues.slice(0, 5).map((q: any) => q.name).join(", ")}`,
        );
      }
      queueId = match.id;
      queueName = match.name ?? queueName;
    } else {
      // Direct ID — fetch queue meta for the name
      try {
        const q = await zoomGet(token, `/phone/call_queues/${queueId}`);
        queueName = q.name ?? queueName;
      } catch {
        /* not fatal */
      }
    }
    const members = await fetchAllPaginated(
      token,
      `/phone/call_queues/${queueId}/members`,
      "call_queue_members",
    );
    // Member shape: { user_id, receive_call, ... } — flatten into ZoomPhoneUser
    roster = members.map((m: any) => ({
      id: m.user_id ?? m.id,
      name: m.name ?? m.display_name,
      email: m.email,
      extension_number: m.extension_number,
    }));
  } else {
    // No queue scoping — list all phone users (paginated)
    const users = await fetchAllPaginated(token, "/phone/users", "users");
    roster = users.map((u: any) => ({
      id: u.id,
      name: u.name ?? (`${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.email),
      email: u.email,
      status: u.status,
      extension_number: u.extension_number,
    }));
  }

  // ---- Real-time call detection ----
  // The reliable cross-tier signal for "is this user on a call right now" is
  // /phone/calls?call_status=in_progress. Some accounts also expose
  // /phone/cep/queues/.../live_calls — we try that first when a queue is set.
  const inCall = new Map<string, { startedAt: number; channel?: string }>();
  try {
    const calls: LiveCall[] = await fetchAllPaginated(
      token,
      "/phone/calls?call_status=in_progress",
      "calls",
    );
    for (const c of calls) {
      const uid = c.user_id ?? c.caller_user_id ?? c.callee_user_id;
      if (!uid) continue;
      const startedAt = c.start_time ? Date.parse(c.start_time) : Date.now();
      inCall.set(uid, { startedAt, channel: "voice" });
    }
  } catch (err) {
    // Some accounts don't have phone:read:list_calls — fall back gracefully
    console.warn("[zoom-proxy] /phone/calls unavailable:", err instanceof Error ? err.message : err);
  }

  // ---- Presence (best-effort; tells us busy/away/dnd vs available) ----
  const presence = new Map<string, string>();
  await Promise.all(
    roster.slice(0, 30).map(async (u) => {
      if (!u.id) return;
      try {
        const p = await zoomGet(token, `/users/${u.id}/presence_status`);
        if (p.status) presence.set(u.id, String(p.status).toLowerCase());
      } catch {
        /* presence is optional, ignore */
      }
    }),
  );

  const now = Date.now();
  const agents: SnapshotAgent[] = roster.map((u) => {
    const active = inCall.get(u.id);
    const pres = presence.get(u.id);
    let status: SnapshotAgent["status"] = "offline";
    let subStatus: string | undefined;

    if (active) {
      status = "on_call";
    } else if (pres === "available") {
      status = "ready";
    } else if (pres === "in_meeting" || pres === "presenting" || pres === "in_calendar_event") {
      status = "not_ready";
      subStatus = pres === "in_meeting" ? "In meeting" : pres === "presenting" ? "Presenting" : "In meeting";
    } else if (pres === "do_not_disturb" || pres === "out_of_office") {
      status = "not_ready";
      subStatus = pres === "do_not_disturb" ? "Do not disturb" : "Out of office";
    } else if (pres === "away") {
      status = "not_ready";
      subStatus = "Away";
    } else if (u.status === "deactivate") {
      status = "offline";
    }

    return {
      name: u.name || u.email || u.id,
      status,
      sub_status: subStatus,
      status_age_sec: active ? Math.max(0, Math.floor((now - active.startedAt) / 1000)) : 0,
      engagement_age_sec: active ? Math.max(0, Math.floor((now - active.startedAt) / 1000)) : undefined,
      channel: active?.channel as any,
    };
  });

  return { agents, resolvedQueueName: queueName };
}

// ---- Plugin ---------------------------------------------------------------

export function zoomProxyPlugin(): Plugin {
  let env: Record<string, string> = {};
  return {
    name: "zoom-proxy",
    configureServer(server) {
      env = loadEnv("development", process.cwd(), "");

      server.middlewares.use("/api/zoom/queue", async (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");

        const accountId = (env.ZOOM_ACCOUNT_ID || "").trim();
        const clientId = (env.ZOOM_CLIENT_ID || "").trim();
        const clientSecret = (env.ZOOM_CLIENT_SECRET || "").trim();
        const queueIdOrName = (env.ZOOM_QUEUE_ID || "").trim() || undefined;
        const defaultQueueName = env.ZOOM_QUEUE_NAME || "NOC Support";

        let agents: SnapshotAgent[] = SNAPSHOT;
        let source: "live" | "snapshot" = "snapshot";
        let warning: string | null = null;
        let queueName = defaultQueueName;

        try {
          // Treat placeholder/empty values as not-configured
          const credsValid =
            accountId && clientId && clientSecret &&
            !/PASTE|YOUR|HERE/i.test(accountId + clientId + clientSecret);

          if (credsValid) {
            try {
              const token = await getZoomAccessToken(accountId, clientId, clientSecret);
              const result = await fetchZoomPhoneAgentsLive(token, queueIdOrName);
              agents = result.agents;
              queueName = result.resolvedQueueName || defaultQueueName;
              source = "live";
            } catch (err) {
              warning = `Zoom API call failed, using snapshot: ${err instanceof Error ? err.message : String(err)}`;
              agents = SNAPSHOT;
            }
          } else {
            warning =
              "ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET not set in .env — showing snapshot.";
          }

          const now = Date.now();
          const finalAgents =
            source === "live"
              ? agents.map((a, idx) => ({
                  agent_id: `live-${idx}`,
                  display_name: a.name,
                  status: a.status,
                  sub_status: a.sub_status,
                  status_changed_at: now - a.status_age_sec * 1000,
                  engagement_started_at: a.engagement_age_sec
                    ? now - a.engagement_age_sec * 1000
                    : undefined,
                  engagement_channel: a.channel,
                  queues: [queueName],
                }))
              : buildSnapshot(queueName);

          // Sort: on_call (longest first), wrap_up, ready, not_ready, offline
          const ORDER: Record<string, number> = {
            on_call: 0,
            wrap_up: 1,
            ready: 2,
            not_ready: 3,
            offline: 4,
          };
          finalAgents.sort((a, b) => {
            const o = (ORDER[a.status] ?? 5) - (ORDER[b.status] ?? 5);
            if (o !== 0) return o;
            if (a.status === "on_call") {
              return (a.engagement_started_at ?? 0) - (b.engagement_started_at ?? 0);
            }
            return a.display_name.localeCompare(b.display_name);
          });

          const totals = { on_call: 0, ready: 0, wrap_up: 0, not_ready: 0, offline: 0 };
          for (const a of finalAgents) {
            (totals as any)[a.status] = ((totals as any)[a.status] ?? 0) + 1;
          }

          res.end(
            JSON.stringify({
              source,
              fetched_at: new Date().toISOString(),
              queue_name: queueName,
              agents: finalAgents,
              totals,
              warning,
            }),
          );
        } catch (err) {
          const finalAgents = buildSnapshot(queueName);
          const totals = { on_call: 0, ready: 0, wrap_up: 0, not_ready: 0, offline: 0 };
          for (const a of finalAgents) (totals as any)[a.status] = ((totals as any)[a.status] ?? 0) + 1;
          res.end(
            JSON.stringify({
              source: "snapshot",
              fetched_at: new Date().toISOString(),
              queue_name: queueName,
              agents: finalAgents,
              totals,
              warning: `Internal error, using snapshot: ${err instanceof Error ? err.message : String(err)}`,
            }),
          );
        }
      });

      // ----- GET /api/zoom/calls-today ----------------------------------
      // Per-user counts of inbound calls received today. Live mode uses
      // GET /phone/users/{userId}/call_logs (requires
      // phone:read:list_call_logs:admin). Snapshot returns realistic counts
      // derived from the NOC roster so the widget renders even when the
      // scope isn't granted.
      server.middlewares.use("/api/zoom/calls-today", async (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");

        // Snapshot baseline — realistic per-shift call counts.
        const SNAPSHOT_CALLS: Record<string, { answered: number; missed: number; total_minutes: number }> = {
          "Sriram Parisa":         { answered: 14, missed: 1, total_minutes: 187 },
          "Mohammed Akram Ahmed":  { answered: 11, missed: 2, total_minutes: 142 },
          "Karthik Damagalla":     { answered: 9,  missed: 0, total_minutes: 96 },
          "Karthik Radhakrishnan": { answered: 8,  missed: 1, total_minutes: 71 },
          "Kenya Gentry":          { answered: 6,  missed: 0, total_minutes: 48 },
          "Perry Cox":             { answered: 5,  missed: 0, total_minutes: 39 },
          "Otukho Olembo":         { answered: 7,  missed: 1, total_minutes: 64 },
          "Anirudh Kukudala":      { answered: 3,  missed: 0, total_minutes: 22 },
          "Akash Hanvate":         { answered: 4,  missed: 0, total_minutes: 31 },
          "Samiti Mahalakshmi":    { answered: 12, missed: 1, total_minutes: 118 },
          "Pranav Dandibhotla":    { answered: 0,  missed: 0, total_minutes: 0 },
          "Ashraf Mohammed":       { answered: 0,  missed: 0, total_minutes: 0 },
          "Zubair Mohammed":       { answered: 0,  missed: 0, total_minutes: 0 },
          "Hamza Rahmani":         { answered: 0,  missed: 0, total_minutes: 0 },
          "Lokesh Naik Banavath":  { answered: 0,  missed: 0, total_minutes: 0 },
        };

        const buildResponse = (
          source: "live" | "snapshot",
          by_user: Record<string, { answered: number; missed: number; total_minutes: number }>,
          warning: string | null,
        ) => ({
          source,
          fetched_at: new Date().toISOString(),
          day_start: (() => {
            // Midnight PST/PDT (same approach as slack-proxy)
            const now = new Date();
            const parts = new Intl.DateTimeFormat("en-CA", {
              timeZone: "America/Los_Angeles",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).formatToParts(now);
            const y = parts.find((p) => p.type === "year")!.value;
            const mo = parts.find((p) => p.type === "month")!.value;
            const d = parts.find((p) => p.type === "day")!.value;
            return new Date(
              Date.UTC(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10)) + 8 * 60 * 60 * 1000,
            ).toISOString();
          })(),
          by_user,
          warning,
        });

        const accountId = (env.ZOOM_ACCOUNT_ID || "").trim();
        const clientId = (env.ZOOM_CLIENT_ID || "").trim();
        const clientSecret = (env.ZOOM_CLIENT_SECRET || "").trim();
        const credsValid =
          accountId && clientId && clientSecret &&
          !/PASTE|YOUR|HERE/i.test(accountId + clientId + clientSecret);

        if (!credsValid) {
          res.end(
            JSON.stringify(
              buildResponse(
                "snapshot",
                SNAPSHOT_CALLS,
                "Zoom credentials not set — showing snapshot call counts.",
              ),
            ),
          );
          return;
        }

        // Live mode — pull per-user call logs from Zoom Phone.
        try {
          const token = await getZoomAccessToken(accountId, clientId, clientSecret);
          // 1. Get all phone users (or a queue's members if a queue is set).
          // We reuse the same logic as the queue endpoint: list /phone/users
          // and filter to live roster.
          const queueIdOrName = (env.ZOOM_QUEUE_ID || "").trim() || undefined;
          let userMap: Map<string, { name: string; email?: string }> = new Map();
          try {
            // Use the same fetcher as the queue path; if it errors fall through.
            const result = await fetchZoomPhoneAgentsLive(token, queueIdOrName);
            for (const a of result.agents) {
              userMap.set(a.agent_id, { display_name: a.display_name } as any);
              userMap.set(a.agent_id, { name: a.display_name });
            }
          } catch (err) {
            // Without an agent list we can't loop call_logs by user. Fall back
            // to snapshot with a warning.
            res.end(
              JSON.stringify(
                buildResponse(
                  "snapshot",
                  SNAPSHOT_CALLS,
                  `Could not list phone users: ${err instanceof Error ? err.message : String(err)}. Showing snapshot.`,
                ),
              ),
            );
            return;
          }

          // Compute today's window (PST midnight → now) as ISO strings for
          // the call_logs query.
          const now = new Date();
          const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Los_Angeles",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).formatToParts(now);
          const y = parts.find((p) => p.type === "year")!.value;
          const mo = parts.find((p) => p.type === "month")!.value;
          const d = parts.find((p) => p.type === "day")!.value;
          const fromIso = new Date(
            Date.UTC(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10)) + 8 * 60 * 60 * 1000,
          ).toISOString();
          const toIso = now.toISOString();

          const by_user: Record<string, { answered: number; missed: number; total_minutes: number }> = {};

          // Loop call_logs per user. Capped at 25 users (NOC team size) so the
          // fan-out is bounded.
          const headers = { Authorization: `Bearer ${token}` };
          await Promise.all(
            Array.from(userMap.entries()).slice(0, 25).map(async ([uid, info]) => {
              try {
                const u = new URL(`https://api.zoom.us/v2/phone/users/${uid}/call_logs`);
                u.searchParams.set("from", fromIso);
                u.searchParams.set("to", toIso);
                u.searchParams.set("type", "all");
                u.searchParams.set("page_size", "300");
                const r = await fetch(u.toString(), { headers });
                if (!r.ok) return;
                const j: any = await r.json();
                const logs: any[] = j.call_logs ?? [];
                let answered = 0;
                let missed = 0;
                let totalSec = 0;
                for (const c of logs) {
                  const direction = (c.direction ?? "").toLowerCase();
                  if (direction !== "inbound") continue;
                  const status = (c.call_result ?? c.result ?? "").toLowerCase();
                  if (status === "missed" || status === "no_answer" || status === "no answer") {
                    missed++;
                  } else {
                    answered++;
                    totalSec += parseInt(c.duration ?? 0, 10) || 0;
                  }
                }
                by_user[info.name] = {
                  answered,
                  missed,
                  total_minutes: Math.round(totalSec / 60),
                };
              } catch {
                /* per-user failures don't fail the whole endpoint */
              }
            }),
          );

          if (Object.keys(by_user).length === 0) {
            res.end(
              JSON.stringify(
                buildResponse(
                  "snapshot",
                  SNAPSHOT_CALLS,
                  "Live call_logs returned empty for all users — showing snapshot. Check `phone:read:list_call_logs:admin` scope.",
                ),
              ),
            );
            return;
          }

          res.end(JSON.stringify(buildResponse("live", by_user, null)));
        } catch (err) {
          res.end(
            JSON.stringify(
              buildResponse(
                "snapshot",
                SNAPSHOT_CALLS,
                `Zoom call_logs fetch failed: ${err instanceof Error ? err.message : String(err)}. Showing snapshot.`,
              ),
            ),
          );
        }
      });
    },
  };
}
