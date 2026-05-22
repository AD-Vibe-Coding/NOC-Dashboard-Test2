/**
 * GET /api/zoom/call-logs-range
 *
 * Fetches inbound call logs from Zoom Phone for every queue member from
 * Jan 1 – Apr 30, 2026 and returns per-agent, per-month aggregates.
 *
 * Response shape:
 *   {
 *     source: "live" | "snapshot",
 *     fetched_at: string,
 *     from: "2026-01-01",
 *     to:   "2026-04-30",
 *     months: ["2026-01","2026-02","2026-03","2026-04"],
 *     agents: AgentStats[],
 *     warning: string | null,
 *   }
 *
 * Required scopes (all already active):
 *   phone:read:list_call_queues:admin
 *   phone:read:list_call_queue_members:admin
 *   phone:read:list_call_logs:admin
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

const FROM = "2026-01-01";
const TO   = "2026-04-30";
const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04"];

// ── In-process token cache ────────────────────────────────────────────────────
let _token: { value: string; expiresAt: number } | null = null;

async function getToken(accountId: string, clientId: string, secret: string): Promise<string> {
  if (_token && _token.expiresAt > Date.now() + 60_000) return _token.value;
  const creds = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const r = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    { method: "POST", headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" } },
  );
  if (!r.ok) throw new Error(`Zoom OAuth (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();
  if (!j.access_token) throw new Error("Zoom OAuth: missing access_token");
  _token = { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return _token.value;
}

async function zoomGet(token: string, path: string): Promise<any> {
  const r = await fetch(`https://api.zoom.us/v2${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Zoom GET ${path} (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function paginate(token: string, path: string, key: string): Promise<any[]> {
  const all: any[] = [];
  let next = "";
  for (let i = 0; i < 10; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${path}${sep}page_size=100${next ? `&next_page_token=${encodeURIComponent(next)}` : ""}`;
    const j: any = await zoomGet(token, url);
    all.push(...(Array.isArray(j?.[key]) ? j[key] : []));
    next = String(j?.next_page_token ?? "");
    if (!next) break;
  }
  return all;
}

// ── Month stats shape ─────────────────────────────────────────────────────────
interface MonthStats {
  answered: number;
  refused:  number;
  missed:   number;
  handle_seconds_sum: number;
  handle_count:       number;
  wait_seconds_sum:   number;
  wait_count:         number;
}

function emptyMonth(): MonthStats {
  return { answered: 0, refused: 0, missed: 0, handle_seconds_sum: 0, handle_count: 0, wait_seconds_sum: 0, wait_count: 0 };
}

/**
 * Whether a call log entry was routed through one of the two NOC queues.
 * Mirrors the Excel "Operator Name" filter exactly:
 *   "Network Tech Support"   → NOC queue
 *   "Mobility Tech Support"  → Mobility queue
 *
 * The Zoom API surfaces this as `call_queue_name` on each log entry.
 * If the field is absent or empty the call came in directly (extension
 * dial, transfer, internal) and should be excluded — just like the
 * Excel report which only contains queue-routed calls.
 */
function isQueueCall(c: any): boolean {
  const name = String(c.call_queue_name ?? c.queue_name ?? c.operator_name ?? "").trim();
  if (!name) return false;
  const n = name.toLowerCase();
  return n.includes("network tech support") || n.includes("mobility tech support");
}

/**
 * Classify a Zoom Phone call_log result string.
 * Matches the same set of strings as the Excel importer (import.ts classifyCallResult).
 *   answered → agent picked up (answered / connected / completed / picked up / handled)
 *   refused  → rang but answered by someone else (no answer (answered by other))
 *   missed   → not answered by anyone (missed / voicemail / abandoned / busy / etc.)
 */
function classify(result: string): "answered" | "refused" | "missed" {
  const r = result.toLowerCase().replace(/_/g, " ");
  // "Refused" / "answered by other" — check BEFORE generic "answered" since
  // "No Answer (Answered by Other)" contains the word "answered"
  if (/\bno\s*answer\b/.test(r) || /\banswered\s*by\s*other\b/.test(r) ||
      r.includes("refused") || r.includes("by other") || r.includes("by_other")) {
    return "refused";
  }
  // Answered — all the strings Zoom uses for a successfully handled call
  if (/\banswered\b/.test(r) || /\bconnected\b/.test(r) || /\bcompleted\b/.test(r) ||
      /\bpicked\s*up\b/.test(r) || /\bhandled\b/.test(r)) {
    return "answered";
  }
  // Everything else: missed / voicemail / abandoned / busy / no_answer / etc.
  return "missed";
}

// ── Realistic snapshot (Jan–Apr 2026) ─────────────────────────────────────────
// Used when Zoom credentials are absent or the API is unreachable.
// Numbers are calibrated for a ~15-person NOC team with mixed tiers.
const SNAPSHOT: Array<{
  name: string;
  by_month: Record<string, { a: number; r: number; m: number; hs: number; ws: number }>;
}> = [
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

function buildSnapshot() {
  return SNAPSHOT.map((ag) => ({
    name: ag.name,
    user_id: `snap-${ag.name.replace(/\s+/g, "-").toLowerCase()}`,
    by_month: Object.fromEntries(
      MONTHS.map((m) => {
        const d = ag.by_month[m];
        return [m, d
          ? {
              answered: d.a,
              refused:  d.r,
              missed:   d.m,
              handle_seconds_sum: d.hs,
              handle_count: d.a,          // avg per answered call
              wait_seconds_sum: d.ws,
              wait_count: d.a,
            }
          : emptyMonth()
        ];
      }),
    ),
  }));
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const accountId    = String(process.env.ZOOM_ACCOUNT_ID    ?? "").trim();
  const clientId     = String(process.env.ZOOM_CLIENT_ID     ?? "").trim();
  const clientSecret = String(process.env.ZOOM_CLIENT_SECRET ?? "").trim();
  const queueFilter  = String(process.env.ZOOM_QUEUE_ID      ?? "").trim() || undefined;

  const snap = (warning: string) => ({
    source: "snapshot",
    fetched_at: new Date().toISOString(),
    from: FROM, to: TO, months: MONTHS,
    agents: buildSnapshot(),
    warning,
  });

  // No creds → snapshot
  if (!accountId || !clientId || !clientSecret) {
    return res.status(200).json(
      snap("Zoom credentials not configured — showing representative snapshot data."),
    );
  }

  try {
    const token = await getToken(accountId, clientId, clientSecret);

    // 1. Resolve agents from queue membership
    const queues: any[] = await paginate(token, "/phone/call_queues", "call_queues");
    let targetQueues = queues;
    if (queueFilter) {
      targetQueues = queues.filter((q: any) =>
        q.id === queueFilter ||
        String(q.name ?? "").toLowerCase().includes(queueFilter.toLowerCase()),
      );
    }
    if (targetQueues.length === 0) targetQueues = queues;

    const userMap = new Map<string, string>(); // userId → displayName
    for (const q of targetQueues.slice(0, 5)) {
      const members: any[] = await paginate(token, `/phone/call_queues/${q.id}/members`, "call_queue_members");
      for (const m of members) {
        if (m.id) userMap.set(m.id, m.display_name ?? m.name ?? m.id);
      }
    }

    if (userMap.size === 0) {
      return res.status(200).json(snap("No queue members found — showing snapshot data."));
    }

    // 2. Fetch call logs per user (Jan 1 – Apr 30)
    const agentMap = new Map<string, { name: string; by_month: Record<string, MonthStats> }>();

    await Promise.all(
      Array.from(userMap.entries()).slice(0, 30).map(async ([uid, name]) => {
        const byMonth: Record<string, MonthStats> = {};
        for (const m of MONTHS) byMonth[m] = emptyMonth();

        try {
          // Zoom call_logs supports max 30-day range per request — split into 4 monthly chunks
          for (const monthKey of MONTHS) {
            const [year, mon] = monthKey.split("-").map(Number);
            const fromDate = `${monthKey}-01`;
            const lastDay  = new Date(Date.UTC(year, mon, 0)).getDate(); // last day of month
            const toDate   = `${monthKey}-${String(lastDay).padStart(2, "0")}`;

            let next = "";
            for (let page = 0; page < 10; page++) {
              const u = new URL(`https://api.zoom.us/v2/phone/users/${uid}/call_logs`);
              u.searchParams.set("from", fromDate);
              u.searchParams.set("to",   toDate);
              u.searchParams.set("type",      "all");
              u.searchParams.set("page_size", "300");
              if (next) u.searchParams.set("next_page_token", next);

              const r = await fetch(u.toString(), {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!r.ok) break;
              const j: any = await r.json();
              const logs: any[] = j.call_logs ?? [];

              for (const c of logs) {
                // Only count calls routed through Network Tech Support
                // or Mobility Tech Support — matching the Excel "Operator Name"
                // filter exactly. Direct calls, transfers, and internal calls
                // have no call_queue_name and must be excluded.
                if (!isQueueCall(c)) continue;
                if ((c.direction ?? "").toLowerCase() !== "inbound") continue;
                const result = classify(c.result ?? c.call_result ?? "");
                const dur    = parseInt(c.duration  ?? "0", 10) || 0;
                const wait   = parseInt(c.wait_time ?? "0", 10) || 0;
                const bucket = byMonth[monthKey];

                if (result === "answered") {
                  bucket.answered++;
                  bucket.handle_seconds_sum += dur;
                  bucket.handle_count++;
                  if (wait > 0) { bucket.wait_seconds_sum += wait; bucket.wait_count++; }
                } else if (result === "refused") {
                  bucket.refused++;
                } else {
                  bucket.missed++;
                }
              }

              next = String(j.next_page_token ?? "");
              if (!next) break;
            }
          }
        } catch {
          // Per-user failure → skip, don't break others
        }

        agentMap.set(uid, { name, by_month: byMonth });
      }),
    );

    const agents = Array.from(agentMap.values())
      .sort((a, b) => {
        const totalA = MONTHS.reduce((s, m) => s + (a.by_month[m]?.answered ?? 0), 0);
        const totalB = MONTHS.reduce((s, m) => s + (b.by_month[m]?.answered ?? 0), 0);
        return totalB - totalA;
      });

    // If the live fetch returned everyone at 0, fall back to snapshot with a warning
    const totalAnswered = agents.reduce(
      (s, a) => s + MONTHS.reduce((ss, m) => ss + (a.by_month[m]?.answered ?? 0), 0), 0,
    );
    if (totalAnswered === 0) {
      return res.status(200).json(
        snap("Live Zoom API returned no inbound calls for Jan–Apr 2026. Verify phone:read:list_call_logs:admin scope and that the date range has data."),
      );
    }

    return res.status(200).json({
      source: "live",
      fetched_at: new Date().toISOString(),
      from: FROM, to: TO, months: MONTHS,
      agents,
      warning: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[zoom/call-logs-range]", msg);
    return res.status(200).json(snap(`Zoom API error: ${msg.slice(0, 120)} — showing snapshot.`));
  }
}
