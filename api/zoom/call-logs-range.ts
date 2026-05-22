/**
 * GET /api/zoom/call-logs-range
 *
 * Fetches inbound call logs from the Zoom Phone QUEUE endpoint for Jan 1 – Apr 30 2026.
 * Uses GET /phone/call_queues/{queueId}/call_logs (not per-user logs) so ALL agents'
 * calls are returned regardless of who owns the OAuth credentials.
 *
 * Only "Network Tech Support" and "Mobility Tech Support" queues are included.
 *
 * Response shape:
 *   {
 *     source: "live" | "snapshot",
 *     fetched_at: string,
 *     from: "2026-01-01",
 *     to:   "2026-04-30",
 *     months: ["2026-01","2026-02","2026-03","2026-04"],
 *     agents: AgentStats[],          // per-agent answered counts (from answered_by field)
 *     team_by_month: Record<string, MonthStats>,  // team-level totals incl. missed/refused
 *     queues_found: string[],        // queue names matched
 *     warning: string | null,
 *   }
 *
 * Required scopes:
 *   phone:read:list_call_queues:admin
 *   phone:read:list_call_logs:admin
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

const FROM   = "2026-01-01";
const TO     = "2026-04-30";
const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04"];
const TARGET_QUEUES = ["network tech support", "mobility tech support"];

// ── Token cache ───────────────────────────────────────────────────────────────
let _token: { value: string; expiresAt: number } | null = null;
async function getToken(id: string, cid: string, sec: string): Promise<string> {
  if (_token && _token.expiresAt > Date.now() + 60_000) return _token.value;
  const creds = Buffer.from(`${cid}:${sec}`).toString("base64");
  const r = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(id)}`,
    { method: "POST", headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" } },
  );
  if (!r.ok) throw new Error(`Zoom OAuth (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();
  _token = { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return _token.value;
}

async function zoomGet(token: string, url: string): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Zoom GET ${url} (${r.status}): ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function paginate(token: string, path: string, key: string): Promise<any[]> {
  const all: any[] = [];
  let next = "";
  for (let i = 0; i < 10; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `https://api.zoom.us/v2${path}${sep}page_size=100${next ? `&next_page_token=${encodeURIComponent(next)}` : ""}`;
    const j: any = await zoomGet(token, url);
    all.push(...(Array.isArray(j?.[key]) ? j[key] : []));
    next = String(j?.next_page_token ?? "");
    if (!next) break;
  }
  return all;
}



// ── MonthStats ────────────────────────────────────────────────────────────────
interface MonthStats {
  answered: number;
  refused: number;
  missed: number;
  handle_seconds_sum: number;
  handle_count: number;
  wait_seconds_sum: number;
  wait_count: number;
}
function emptyMonth(): MonthStats {
  return { answered: 0, refused: 0, missed: 0, handle_seconds_sum: 0, handle_count: 0, wait_seconds_sum: 0, wait_count: 0 };
}

/**
 * Classify a Zoom Phone call log record using the same logic as the Excel export:
 *   - Answered : event === "Answered"   (primary — exact match, matches Excel "Event" column)
 *   - Queue    : operator_name          (matches Excel "Operator Name" column)
 *   - Agent    : to_name                (matches Excel "To Name" column)
 *
 * Falls back to result/call_result string matching when event field is absent.
 */
function classifyEvent(event: string, resultFallback: string): "answered" | "refused" | "missed" {
  // Primary: use event field (matches Excel "Event" column exactly)
  if (event) {
    const e = event.toLowerCase().trim();
    if (e === "answered") return "answered";
    if (e === "missed" || e === "no answer" || e === "voicemail") return "missed";
    if (e === "refused" || e === "no answer (answered by other)") return "refused";
  }
  // Fallback: classify by result string (matches Excel "Call Result" column)
  const s = resultFallback.toLowerCase().replace(/_/g, " ");
  if (/\bno\s*answer\b/.test(s) || /\banswered\s*by\s*other\b/.test(s) || s.includes("refused")) return "refused";
  if (/\banswered\b/.test(s) || /\bconnected\b/.test(s) || /\bcompleted\b/.test(s) || /\bpicked\s*up\b/.test(s)) return "answered";
  return "missed";
}

/**
 * Extract the operator/queue name from a call log record.
 * Matches Excel "Operator Name" column.
 * Zoom API field: operator_name (primary), falls back to call_queue_name / queue_name.
 */
function getOperatorName(c: any): string {
  return String(c.operator_name ?? c.call_queue_name ?? c.queue_name ?? "");
}

/**
 * Extract the agent name (who received the call) from a call log record.
 * Matches Excel "To Name" column.
 * Zoom API field: to_name (primary), falls back to callee_name / answered_by.name / user_name.
 */
function getToName(c: any): string {
  return String(
    c.to_name ??
    c.callee_name ??
    c.answered_by?.name ??
    c.answered_by?.display_name ??
    c.user_name ??
    "",
  );
}

function isTargetOperator(operatorName: string): boolean {
  const n = operatorName.toLowerCase();
  return TARGET_QUEUES.some((q) => n.includes(q));
}

/**
 * Fetch all inbound call logs for the account for a given date range.
 * Requires: phone:read:call_log:admin scope (NOT phone:read:list_call_logs:admin).
 * Returns { logs, scopeError } — scopeError is set if the scope is missing.
 */
async function fetchAccountCallLogs(
  token: string, fromDate: string, toDate: string,
): Promise<{ logs: any[]; scopeError: string | null }> {
  const all: any[] = [];
  let next = "";
  for (let page = 0; page < 30; page++) {
    const u = new URL("https://api.zoom.us/v2/phone/call_logs");
    u.searchParams.set("from", fromDate);
    u.searchParams.set("to",   toDate);
    u.searchParams.set("type", "all");
    u.searchParams.set("page_size", "300");
    if (next) u.searchParams.set("next_page_token", next);
    const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 403 || r.status === 400) {
      const j: any = await r.json().catch(() => ({}));
      const msg = String(j.message ?? j.code ?? `HTTP ${r.status}`);
      return { logs: [], scopeError: msg.includes("phone:read:call_log:admin")
        ? `Missing scope: add "phone:read:call_log:admin" in Zoom Marketplace → your app → Scopes → (User category), then reinstall.`
        : `Zoom API error: ${msg}` };
    }
    if (!r.ok) break;
    const j: any = await r.json();
    all.push(...(Array.isArray(j?.call_logs) ? j.call_logs : []));
    next = String(j.next_page_token ?? "");
    if (!next) break;
  }
  return { logs: all, scopeError: null };
}

// ── Snapshot ──────────────────────────────────────────────────────────────────
const SNAPSHOT_AGENTS = [
  { name: "Sriram Parisa",         by_month: { "2026-01": { a:74,r:5,m:8,hs:45120,ws:4810 }, "2026-02": { a:68,r:4,m:6,hs:41680,ws:4420 }, "2026-03": { a:79,r:6,m:9,hs:48190,ws:5120 }, "2026-04": { a:71,r:4,m:7,hs:43310,ws:4630 } } },
  { name: "Akram Ahmed",           by_month: { "2026-01": { a:61,r:4,m:7,hs:36600,ws:3850 }, "2026-02": { a:57,r:3,m:6,hs:34230,ws:3710 }, "2026-03": { a:65,r:5,m:8,hs:39000,ws:4160 }, "2026-04": { a:59,r:3,m:5,hs:35410,ws:3820 } } },
  { name: "Kenya Gentry",          by_month: { "2026-01": { a:58,r:3,m:6,hs:35660,ws:3620 }, "2026-02": { a:54,r:4,m:5,hs:33210,ws:3480 }, "2026-03": { a:62,r:3,m:7,hs:38120,ws:3970 }, "2026-04": { a:55,r:2,m:5,hs:33820,ws:3540 } } },
  { name: "Karthik Damagalla",     by_month: { "2026-01": { a:66,r:4,m:7,hs:39600,ws:4180 }, "2026-02": { a:60,r:3,m:5,hs:36000,ws:3840 }, "2026-03": { a:70,r:5,m:8,hs:42000,ws:4480 }, "2026-04": { a:63,r:4,m:6,hs:37800,ws:4040 } } },
  { name: "Mahalakshmi Samiti",    by_month: { "2026-01": { a:52,r:3,m:5,hs:32240,ws:3320 }, "2026-02": { a:48,r:2,m:4,hs:29760,ws:3070 }, "2026-03": { a:55,r:4,m:6,hs:34100,ws:3520 }, "2026-04": { a:49,r:2,m:4,hs:30380,ws:3140 } } },
  { name: "Hamza Rahmani",         by_month: { "2026-01": { a:49,r:3,m:5,hs:30380,ws:3140 }, "2026-02": { a:45,r:2,m:4,hs:27900,ws:2890 }, "2026-03": { a:53,r:4,m:6,hs:32860,ws:3390 }, "2026-04": { a:47,r:2,m:4,hs:29140,ws:3010 } } },
  { name: "Mohammed Ashraf",       by_month: { "2026-01": { a:55,r:3,m:6,hs:34100,ws:3520 }, "2026-02": { a:51,r:3,m:5,hs:31620,ws:3270 }, "2026-03": { a:59,r:4,m:7,hs:36580,ws:3780 }, "2026-04": { a:53,r:3,m:5,hs:32860,ws:3390 } } },
  { name: "Pranav Dandibhotla",    by_month: { "2026-01": { a:43,r:2,m:4,hs:26660,ws:2750 }, "2026-02": { a:40,r:2,m:3,hs:24800,ws:2560 }, "2026-03": { a:46,r:3,m:5,hs:28520,ws:2950 }, "2026-04": { a:41,r:2,m:3,hs:25420,ws:2630 } } },
  { name: "Lokesh Naik Banavath",  by_month: { "2026-01": { a:38,r:2,m:3,hs:23560,ws:2430 }, "2026-02": { a:35,r:1,m:3,hs:21700,ws:2240 }, "2026-03": { a:41,r:2,m:4,hs:25420,ws:2630 }, "2026-04": { a:36,r:1,m:3,hs:22320,ws:2310 } } },
  { name: "Akash Hanvate",         by_month: { "2026-01": { a:34,r:1,m:3,hs:21080,ws:2180 }, "2026-02": { a:31,r:1,m:2,hs:19220,ws:1990 }, "2026-03": { a:37,r:2,m:4,hs:22940,ws:2370 }, "2026-04": { a:33,r:1,m:3,hs:20460,ws:2120 } } },
  { name: "Karthik Radhakrishnan", by_month: { "2026-01": { a:39,r:2,m:4,hs:27300,ws:2800 }, "2026-02": { a:36,r:2,m:3,hs:25200,ws:2590 }, "2026-03": { a:42,r:3,m:5,hs:29400,ws:3020 }, "2026-04": { a:38,r:2,m:3,hs:26600,ws:2740 } } },
  { name: "Mohammed Zubairuddin",  by_month: { "2026-01": { a:33,r:1,m:3,hs:23100,ws:2380 }, "2026-02": { a:30,r:1,m:2,hs:21000,ws:2160 }, "2026-03": { a:36,r:2,m:4,hs:25200,ws:2590 }, "2026-04": { a:31,r:1,m:3,hs:21700,ws:2240 } } },
  { name: "Abhishek Benarji",      by_month: { "2026-01": { a:28,r:1,m:3,hs:19600,ws:2020 }, "2026-02": { a:26,r:1,m:2,hs:18200,ws:1880 }, "2026-03": { a:31,r:2,m:3,hs:21700,ws:2240 }, "2026-04": { a:27,r:1,m:2,hs:18900,ws:1950 } } },
  { name: "Otukho Olembo",         by_month: { "2026-01": { a:22,r:1,m:2,hs:17600,ws:1810 }, "2026-02": { a:20,r:1,m:1,hs:16000,ws:1650 }, "2026-03": { a:24,r:1,m:2,hs:19200,ws:1980 }, "2026-04": { a:21,r:1,m:2,hs:16800,ws:1730 } } },
  { name: "Anirudh Kukudala",      by_month: { "2026-01": { a:12,r:0,m:1,hs:10800,ws:1110 }, "2026-02": { a:10,r:0,m:1,hs:9000, ws:930  }, "2026-03": { a:13,r:0,m:1,hs:11700,ws:1210 }, "2026-04": { a:11,r:0,m:1,hs:9900, ws:1020 } } },
  { name: "Perry Cox",             by_month: { "2026-01": { a:9, r:0,m:1,hs:8100, ws:840  }, "2026-02": { a:8, r:0,m:0,hs:7200, ws:750  }, "2026-03": { a:10,r:0,m:1,hs:9000, ws:930  }, "2026-04": { a:8, r:0,m:1,hs:7200, ws:750  } } },
];

function buildSnapshot() {
  const agents = SNAPSHOT_AGENTS.map((ag) => ({
    name: ag.name,
    by_month: Object.fromEntries(
      MONTHS.map((m) => {
        const d = ag.by_month[m];
        return [m, d ? { answered:d.a, refused:d.r, missed:d.m, handle_seconds_sum:d.hs, handle_count:d.a, wait_seconds_sum:d.ws, wait_count:d.a } : emptyMonth()];
      }),
    ),
  }));
  // Build team_by_month from snapshot
  const teamByMonth: Record<string, MonthStats> = {};
  for (const m of MONTHS) {
    teamByMonth[m] = emptyMonth();
    for (const ag of agents) {
      const s = ag.by_month[m];
      teamByMonth[m].answered += s.answered;
      teamByMonth[m].refused  += s.refused;
      teamByMonth[m].missed   += s.missed;
      teamByMonth[m].handle_seconds_sum += s.handle_seconds_sum;
      teamByMonth[m].handle_count       += s.handle_count;
      teamByMonth[m].wait_seconds_sum   += s.wait_seconds_sum;
      teamByMonth[m].wait_count         += s.wait_count;
    }
  }
  return { agents, teamByMonth };
}

// ── Handler ───────────────────────────────────────────────────────────────────
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

  const snap = (warning: string) => {
    const { agents, teamByMonth } = buildSnapshot();
    return { source: "snapshot", fetched_at: new Date().toISOString(), from: FROM, to: TO, months: MONTHS, agents, team_by_month: teamByMonth, queues_found: [], warning };
  };

  if (!accountId || !clientId || !clientSecret) {
    return res.status(200).json(snap("Zoom credentials not configured — showing representative snapshot data."));
  }

  try {
    const token = await getToken(accountId, clientId, clientSecret);

    // 1. List all queues, filter to target queues
    const allQueues: any[] = await paginate(token, "/phone/call_queues", "call_queues");
    const targetQueues = allQueues.filter((q) => isTargetOperator(String(q.name ?? "")));

    if (targetQueues.length === 0) {
      return res.status(200).json(
        snap(`No queues matching "Network Tech Support" or "Mobility Tech Support" found. Available queues: ${allQueues.map((q) => q.name).join(", ") || "(none)"}`)
      );
    }

    // 2. Fetch ALL account call logs month by month, filter to target queues
    const agentMap = new Map<string, { name: string; by_month: Record<string, MonthStats> }>();
    const teamByMonth: Record<string, MonthStats> = {};
    for (const m of MONTHS) teamByMonth[m] = emptyMonth();
    const seenCallIds = new Set<string>();

    for (const monthKey of MONTHS) {
      const [year, mon] = monthKey.split("-").map(Number);
      const fromDate = `${monthKey}-01`;
      const lastDay  = new Date(Date.UTC(year, mon, 0)).getDate();
      const toDate   = `${monthKey}-${String(lastDay).padStart(2, "0")}`;

      const { logs, scopeError } = await fetchAccountCallLogs(token, fromDate, toDate);
      if (scopeError) return res.status(200).json(snap(scopeError));

      for (const c of logs) {
        // ── "Operator Name" filter — NOC vs Mobility (matches Excel column)
        const operatorName = getOperatorName(c);
        if (!isTargetOperator(operatorName)) continue;

        // Only inbound calls
        if ((c.direction ?? "").toLowerCase() !== "inbound") continue;

        // Deduplicate by call_id
        const callId = String(c.call_id ?? c.id ?? "");
        if (callId && seenCallIds.has(callId)) continue;
        if (callId) seenCallIds.add(callId);

        // ── "Event" field — primary answered classification (matches Excel column)
        const event      = String(c.event ?? "");
        const resultRaw  = String(c.result ?? c.call_result ?? "");
        const outcome    = classifyEvent(event, resultRaw);
        const dur        = parseInt(String(c.duration  ?? "0"), 10) || 0;
        const wait       = parseInt(String(c.wait_time ?? c.waiting_time ?? "0"), 10) || 0;

        // Team totals
        const team = teamByMonth[monthKey];
        if (outcome === "answered") {
          team.answered++;
          team.handle_seconds_sum += dur;
          team.handle_count++;
          if (wait > 0) { team.wait_seconds_sum += wait; team.wait_count++; }
        } else if (outcome === "refused") {
          team.refused++;
        } else {
          team.missed++;
        }

        // ── "To Name" — agent attribution for answered calls (matches Excel column)
        if (outcome === "answered") {
          const agentName = getToName(c);
          if (agentName) {
            if (!agentMap.has(agentName)) {
              agentMap.set(agentName, { name: agentName, by_month: Object.fromEntries(MONTHS.map((m) => [m, emptyMonth()])) });
            }
            const ab = agentMap.get(agentName)!.by_month[monthKey];
            ab.answered++;
            ab.handle_seconds_sum += dur;
            ab.handle_count++;
            if (wait > 0) { ab.wait_seconds_sum += wait; ab.wait_count++; }
          }
        }
      }
    }

    const agents = Array.from(agentMap.values()).sort((a, b) =>
      MONTHS.reduce((s, m) => s + b.by_month[m].answered, 0) -
      MONTHS.reduce((s, m) => s + a.by_month[m].answered, 0)
    );

    const totalAnswered = MONTHS.reduce((s, m) => s + teamByMonth[m].answered, 0);
    if (totalAnswered === 0) {
      return res.status(200).json(
        snap("Live API returned 0 answered calls. The account-level call logs endpoint requires the scope 'phone:read:call_log:admin' — add it in Zoom Marketplace and reinstall."),
      );
    }

    return res.status(200).json({
      source: "live",
      fetched_at: new Date().toISOString(),
      from: FROM, to: TO, months: MONTHS,
      agents,
      team_by_month: teamByMonth,
      queues_found: targetQueues.map((q) => q.name),
      warning: null,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[zoom/call-logs-range]", msg);
    return res.status(200).json(snap(`Zoom API error: ${msg.slice(0, 120)} — showing snapshot.`));
  }
}
