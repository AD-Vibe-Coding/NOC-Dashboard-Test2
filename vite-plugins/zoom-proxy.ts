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
 *   phone:read:list_call_logs:admin
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
// Strategy: enumerate all call queues → collect members from each queue →
// de-duplicate by user ID → use receive_call as ready/not-ready signal.
//
// Endpoints used (all confirmed working with current scopes):
//   GET /phone/call_queues                       — list all queues ✅
//   GET /phone/call_queues/{id}/members          — queue member roster ✅
//
// Endpoints that need additional scopes (gracefully skipped if 403):
//   GET /users/{userId}/presence_status          — requires user:read:presence_status:admin
//
// Status mapping from available data:
//   receive_call: true  → "ready"   (opted in, available to receive queue calls)
//   receive_call: false → "not_ready" (opted out / on break / DND)
//   presence "available" → upgrades to "ready"
//   presence "in_meeting" / "busy" → "not_ready"
//   presence "phone" → "on_call" (best signal for active call without call logs scope)

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

interface QueueMember {
  id: string;
  name: string;
  email?: string;
  receive_call: boolean;
  queues: string[];
}

async function fetchZoomPhoneAgentsLive(
  token: string,
  queueIdFilter?: string,
): Promise<{ agents: SnapshotAgent[]; resolvedQueueName: string; warning?: string }> {

  // 1. Get all call queues
  const allQueues = await fetchAllPaginated(token, "/phone/call_queues", "call_queues");
  if (allQueues.length === 0) {
    throw new Error("No Zoom Phone call queues found in this account.");
  }

  // 2. Filter to a specific queue if ZOOM_QUEUE_ID is set, otherwise use all
  let targetQueues = allQueues;
  if (queueIdFilter) {
    const match = allQueues.find(
      (q: any) =>
        q.id === queueIdFilter ||
        q.name?.toLowerCase().includes(queueIdFilter.toLowerCase()),
    );
    if (match) {
      targetQueues = [match];
    }
    // If no match, fall through and use all queues
  }

  const resolvedQueueName = targetQueues.length === 1
    ? targetQueues[0].name
    : "All Queues (" + targetQueues.map((q: any) => q.name).join(", ") + ")";

  // 3. Fetch members from each queue; de-duplicate by user ID
  const memberMap = new Map<string, QueueMember>();
  await Promise.all(
    targetQueues.map(async (q: any) => {
      const members = await fetchAllPaginated(
        token,
        `/phone/call_queues/${q.id}/members`,
        "call_queue_members",
      );
      for (const m of members) {
        const uid = String(m.id ?? m.user_id ?? "");
        if (!uid) continue;
        if (memberMap.has(uid)) {
          // Already seen — merge queue list
          memberMap.get(uid)!.queues.push(q.name);
        } else {
          memberMap.set(uid, {
            id: uid,
            name: String(m.name ?? m.display_name ?? m.email ?? "Unknown"),
            email: m.email ? String(m.email) : undefined,
            receive_call: !!m.receive_call,
            queues: [q.name],
          });
        }
      }
    }),
  );

  const roster = Array.from(memberMap.values());

  // 4. Try to enrich with Zoom presence (requires user:read:presence_status:admin).
  //    Silently skip per-user if 403 — the scope is optional.
  const presence = new Map<string, string>();
  let presenceAvailable = false;
  await Promise.all(
    roster.slice(0, 30).map(async (u) => {
      try {
        const p = await zoomGet(token, `/users/${u.id}/presence_status`);
        if (p.status && !p.code) {
          presence.set(u.id, String(p.status).toLowerCase());
          presenceAvailable = true;
        }
      } catch {
        /* optional — skip */
      }
    }),
  );

  // 5. Build agent list
  const agents: SnapshotAgent[] = roster.map((u) => {
    const pres = presence.get(u.id);
    let status: SnapshotAgent["status"];
    let subStatus: string | undefined;

    if (pres === "phone") {
      // Zoom presence "Phone" = actively on a phone call
      status = "on_call";
    } else if (pres === "in_meeting" || pres === "busy") {
      status = "not_ready";
      subStatus = "In meeting";
    } else if (pres === "do_not_disturb") {
      status = "not_ready";
      subStatus = "Do not disturb";
    } else if (pres === "out_of_office") {
      status = "not_ready";
      subStatus = "Out of office";
    } else if (pres === "away") {
      status = "not_ready";
      subStatus = "Away";
    } else if (pres === "available" || u.receive_call) {
      status = "ready";
    } else {
      // receive_call=false and no presence: opted out of queue — treat as not_ready
      status = "not_ready";
    }

    return {
      name: u.name,
      status,
      sub_status: subStatus,
      status_age_sec: 0,
      engagement_age_sec: undefined,
      channel: status === "on_call" ? "voice" : undefined,
    };
  });

  const warning = presenceAvailable
    ? null
    : "Add scope user:read:presence_status:admin in Zoom Marketplace for on-call detection. Currently showing queue availability only.";

  return { agents, resolvedQueueName, warning };
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
              warning = result.warning ?? null;
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
