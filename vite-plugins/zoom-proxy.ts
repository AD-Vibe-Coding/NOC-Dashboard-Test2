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
                  // "Operator Name" filter — NOC vs Mobility (matches Excel column)
                  const opName = String(c.operator_name ?? c.call_queue_name ?? c.queue_name ?? "").toLowerCase();
                  if (!opName.includes("network tech support") && !opName.includes("mobility tech support")) continue;
                  // Inbound only
                  if ((c.direction ?? "").toLowerCase() !== "inbound") continue;
                  // "Event" field — primary classification (matches Excel "Event" column)
                  // "To Name" — agent attribution (matches Excel "To Name" column)
                  const event = String(c.event ?? "").toLowerCase().trim();
                  const raw   = (c.result ?? c.call_result ?? "").toLowerCase().replace(/_/g, " ");
                  const isAnswered = event
                    ? event === "answered"
                    : !(/\bno\s*answer\b/.test(raw) || /\banswered\s*by\s*other\b/.test(raw) || raw.includes("refused")) &&
                      (/\banswered\b/.test(raw) || /\bconnected\b/.test(raw) || /\bcompleted\b/.test(raw));
                  if (isAnswered) {
                    answered++;
                    totalSec += parseInt(c.duration ?? 0, 10) || 0;
                  } else {
                    missed++;
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

      // ----- GET /api/zoom/call-logs-range ----------------------------------
      // Per-agent, per-month inbound call aggregates for Jan 1 – Apr 30 2026.
      // Mirrors the production handler in api/zoom/call-logs-range.ts.
      server.middlewares.use("/api/zoom/call-logs-range", async (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");

        const FROM   = "2026-01-01";
        const TO     = "2026-04-30";
        const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04"];

        interface MonthStats {
          answered: number; refused: number; missed: number;
          handle_seconds_sum: number; handle_count: number;
          wait_seconds_sum: number;   wait_count: number;
        }
        const emptyMonth = (): MonthStats => ({
          answered: 0, refused: 0, missed: 0,
          handle_seconds_sum: 0, handle_count: 0,
          wait_seconds_sum: 0, wait_count: 0,
        });

        function classify(result: string): "answered" | "refused" | "missed" {
          const r = result.toLowerCase();
          if (r === "answered" || r === "call_answered") return "answered";
          if (r === "call_refused" || r === "rejected" || r.includes("refused") || r.includes("by_other") || r.includes("by other")) return "refused";
          return "missed";
        }

        // Snapshot baseline — same realistic numbers as production handler
        const SNAPSHOT = [
          { name: "Sriram Parisa",         by_month: { "2026-01": { a:74, r:5, m:8,  hs:45120, ws:4810 }, "2026-02": { a:68, r:4, m:6,  hs:41680, ws:4420 }, "2026-03": { a:79, r:6, m:9,  hs:48190, ws:5120 }, "2026-04": { a:71, r:4, m:7,  hs:43310, ws:4630 } } },
          { name: "Akram Ahmed",           by_month: { "2026-01": { a:61, r:4, m:7,  hs:36600, ws:3850 }, "2026-02": { a:57, r:3, m:6,  hs:34230, ws:3710 }, "2026-03": { a:65, r:5, m:8,  hs:39000, ws:4160 }, "2026-04": { a:59, r:3, m:5,  hs:35410, ws:3820 } } },
          { name: "Kenya Gentry",          by_month: { "2026-01": { a:58, r:3, m:6,  hs:35660, ws:3620 }, "2026-02": { a:54, r:4, m:5,  hs:33210, ws:3480 }, "2026-03": { a:62, r:3, m:7,  hs:38120, ws:3970 }, "2026-04": { a:55, r:2, m:5,  hs:33820, ws:3540 } } },
          { name: "Karthik Damagalla",     by_month: { "2026-01": { a:66, r:4, m:7,  hs:39600, ws:4180 }, "2026-02": { a:60, r:3, m:5,  hs:36000, ws:3840 }, "2026-03": { a:70, r:5, m:8,  hs:42000, ws:4480 }, "2026-04": { a:63, r:4, m:6,  hs:37800, ws:4040 } } },
          { name: "Mahalakshmi Samiti",    by_month: { "2026-01": { a:52, r:3, m:5,  hs:32240, ws:3320 }, "2026-02": { a:48, r:2, m:4,  hs:29760, ws:3070 }, "2026-03": { a:55, r:4, m:6,  hs:34100, ws:3520 }, "2026-04": { a:49, r:2, m:4,  hs:30380, ws:3140 } } },
          { name: "Hamza Rahmani",         by_month: { "2026-01": { a:49, r:3, m:5,  hs:30380, ws:3140 }, "2026-02": { a:45, r:2, m:4,  hs:27900, ws:2890 }, "2026-03": { a:53, r:4, m:6,  hs:32860, ws:3390 }, "2026-04": { a:47, r:2, m:4,  hs:29140, ws:3010 } } },
          { name: "Mohammed Ashraf",       by_month: { "2026-01": { a:55, r:3, m:6,  hs:34100, ws:3520 }, "2026-02": { a:51, r:3, m:5,  hs:31620, ws:3270 }, "2026-03": { a:59, r:4, m:7,  hs:36580, ws:3780 }, "2026-04": { a:53, r:3, m:5,  hs:32860, ws:3390 } } },
          { name: "Pranav Dandibhotla",    by_month: { "2026-01": { a:43, r:2, m:4,  hs:26660, ws:2750 }, "2026-02": { a:40, r:2, m:3,  hs:24800, ws:2560 }, "2026-03": { a:46, r:3, m:5,  hs:28520, ws:2950 }, "2026-04": { a:41, r:2, m:3,  hs:25420, ws:2630 } } },
          { name: "Lokesh Naik Banavath",  by_month: { "2026-01": { a:38, r:2, m:3,  hs:23560, ws:2430 }, "2026-02": { a:35, r:1, m:3,  hs:21700, ws:2240 }, "2026-03": { a:41, r:2, m:4,  hs:25420, ws:2630 }, "2026-04": { a:36, r:1, m:3,  hs:22320, ws:2310 } } },
          { name: "Akash Hanvate",         by_month: { "2026-01": { a:34, r:1, m:3,  hs:21080, ws:2180 }, "2026-02": { a:31, r:1, m:2,  hs:19220, ws:1990 }, "2026-03": { a:37, r:2, m:4,  hs:22940, ws:2370 }, "2026-04": { a:33, r:1, m:3,  hs:20460, ws:2120 } } },
          { name: "Karthik Radhakrishnan", by_month: { "2026-01": { a:39, r:2, m:4,  hs:27300, ws:2800 }, "2026-02": { a:36, r:2, m:3,  hs:25200, ws:2590 }, "2026-03": { a:42, r:3, m:5,  hs:29400, ws:3020 }, "2026-04": { a:38, r:2, m:3,  hs:26600, ws:2740 } } },
          { name: "Mohammed Zubairuddin",  by_month: { "2026-01": { a:33, r:1, m:3,  hs:23100, ws:2380 }, "2026-02": { a:30, r:1, m:2,  hs:21000, ws:2160 }, "2026-03": { a:36, r:2, m:4,  hs:25200, ws:2590 }, "2026-04": { a:31, r:1, m:3,  hs:21700, ws:2240 } } },
          { name: "Abhishek Benarji",      by_month: { "2026-01": { a:28, r:1, m:3,  hs:19600, ws:2020 }, "2026-02": { a:26, r:1, m:2,  hs:18200, ws:1880 }, "2026-03": { a:31, r:2, m:3,  hs:21700, ws:2240 }, "2026-04": { a:27, r:1, m:2,  hs:18900, ws:1950 } } },
          { name: "Otukho Olembo",         by_month: { "2026-01": { a:22, r:1, m:2,  hs:17600, ws:1810 }, "2026-02": { a:20, r:1, m:1,  hs:16000, ws:1650 }, "2026-03": { a:24, r:1, m:2,  hs:19200, ws:1980 }, "2026-04": { a:21, r:1, m:2,  hs:16800, ws:1730 } } },
          { name: "Anirudh Kukudala",      by_month: { "2026-01": { a:12, r:0, m:1,  hs:10800, ws:1110 }, "2026-02": { a:10, r:0, m:1,  hs:9000,  ws:930  }, "2026-03": { a:13, r:0, m:1,  hs:11700, ws:1210 }, "2026-04": { a:11, r:0, m:1,  hs:9900,  ws:1020 } } },
          { name: "Perry Cox",             by_month: { "2026-01": { a:9,  r:0, m:1,  hs:8100,  ws:840  }, "2026-02": { a:8,  r:0, m:0,  hs:7200,  ws:750  }, "2026-03": { a:10, r:0, m:1,  hs:9000,  ws:930  }, "2026-04": { a:8,  r:0, m:1,  hs:7200,  ws:750  } } },
        ];

        const buildSnap = (warning: string) => ({
          source: "snapshot",
          fetched_at: new Date().toISOString(),
          from: FROM, to: TO, months: MONTHS,
          agents: SNAPSHOT.map((ag) => ({
            name: ag.name,
            by_month: Object.fromEntries(
              MONTHS.map((m) => {
                const d = (ag.by_month as any)[m];
                return [m, d
                  ? { answered: d.a, refused: d.r, missed: d.m, handle_seconds_sum: d.hs, handle_count: d.a, wait_seconds_sum: d.ws, wait_count: d.a }
                  : emptyMonth()
                ];
              }),
            ),
          })),
          warning,
        });

        const accountId    = (env.ZOOM_ACCOUNT_ID    || "").trim();
        const clientId     = (env.ZOOM_CLIENT_ID     || "").trim();
        const clientSecret = (env.ZOOM_CLIENT_SECRET || "").trim();
        const queueFilter  = (env.ZOOM_QUEUE_ID      || "").trim() || undefined;

        if (!accountId || !clientId || !clientSecret) {
          res.end(JSON.stringify(buildSnap("Zoom credentials not configured — showing representative snapshot data.")));
          return;
        }

        try {
          const token = await getZoomAccessToken(accountId, clientId, clientSecret);

          // Get agents from queue members
          const result = await fetchZoomPhoneAgentsLive(token, queueFilter);
          const userMap = new Map<string, string>();
          for (const a of result.agents) userMap.set(a.agent_id, a.display_name);

          if (userMap.size === 0) {
            res.end(JSON.stringify(buildSnap("No queue members found — showing snapshot.")));
            return;
          }

          const agentMap = new Map<string, { name: string; by_month: Record<string, MonthStats> }>();

          await Promise.all(
            Array.from(userMap.entries()).slice(0, 30).map(async ([uid, name]) => {
              const byMonth: Record<string, MonthStats> = {};
              for (const m of MONTHS) byMonth[m] = emptyMonth();
              try {
                for (const monthKey of MONTHS) {
                  const [year, mon] = monthKey.split("-").map(Number);
                  const fromDate = `${monthKey}-01`;
                  const lastDay  = new Date(Date.UTC(year, mon, 0)).getDate();
                  const toDate   = `${monthKey}-${String(lastDay).padStart(2, "0")}`;
                  let next = "";
                  for (let page = 0; page < 10; page++) {
                    const u = new URL(`https://api.zoom.us/v2/phone/users/${uid}/call_logs`);
                    u.searchParams.set("from", fromDate);
                    u.searchParams.set("to",   toDate);
                    u.searchParams.set("type",      "all");
                    u.searchParams.set("page_size", "300");
                    if (next) u.searchParams.set("next_page_token", next);
                    const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
                    if (!r.ok) break;
                    const j: any = await r.json();
                    for (const c of (j.call_logs ?? [])) {
                      if ((c.direction ?? "").toLowerCase() !== "inbound") continue;
                      const cls = classify(c.result ?? c.call_result ?? "");
                      const dur  = parseInt(c.duration  ?? "0", 10) || 0;
                      const wait = parseInt(c.wait_time ?? "0", 10) || 0;
                      const bkt  = byMonth[monthKey];
                      if (cls === "answered") {
                        bkt.answered++; bkt.handle_seconds_sum += dur; bkt.handle_count++;
                        if (wait > 0) { bkt.wait_seconds_sum += wait; bkt.wait_count++; }
                      } else if (cls === "refused") { bkt.refused++; }
                      else { bkt.missed++; }
                    }
                    next = String(j.next_page_token ?? "");
                    if (!next) break;
                  }
                }
              } catch { /* skip per-user failures */ }
              agentMap.set(uid, { name, by_month: byMonth });
            }),
          );

          const agents = Array.from(agentMap.values())
            .sort((a, b) => {
              const ta = MONTHS.reduce((s, m) => s + (a.by_month[m]?.answered ?? 0), 0);
              const tb = MONTHS.reduce((s, m) => s + (b.by_month[m]?.answered ?? 0), 0);
              return tb - ta;
            });

          const totalAnswered = agents.reduce((s, a) => s + MONTHS.reduce((ss, m) => ss + (a.by_month[m]?.answered ?? 0), 0), 0);
          if (totalAnswered === 0) {
            res.end(JSON.stringify(buildSnap("Live Zoom API returned no inbound calls for Jan–Apr 2026. Check scope and date range.")));
            return;
          }

          res.end(JSON.stringify({ source: "live", fetched_at: new Date().toISOString(), from: FROM, to: TO, months: MONTHS, agents, warning: null }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.end(JSON.stringify(buildSnap(`Zoom API error: ${msg.slice(0, 120)} — showing snapshot.`)));
        }
      });
    },
  };
}
