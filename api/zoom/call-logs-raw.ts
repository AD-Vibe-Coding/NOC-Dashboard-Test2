/**
 * GET /api/zoom/call-logs-raw
 *
 * Returns individual raw call log records from Zoom Phone API for ONE month,
 * with full field transparency for debugging the queue filter and classification.
 *
 * Query params:
 *   month      = YYYY-MM  (required, defaults to 2026-01)
 *   agent      = partial name filter, case-insensitive (optional)
 *   show_all   = "true" to include calls excluded by the queue / direction filter
 *
 * Response:
 *   { source, month, records: RawRecord[], totals, queue_names_seen: string[] }
 *
 * Each RawRecord has:
 *   start_time, agent_name, direction (raw), call_queue_name (raw),
 *   call_result_raw (raw), classified_as, included, duration_seconds, wait_seconds
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

const TARGET_QUEUES = ["network tech support", "mobility tech support"];

// ── Auth ──────────────────────────────────────────────────────────────────────
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

async function zoomGet(token: string, path: string): Promise<any> {
  const r = await fetch(`https://api.zoom.us/v2${path}`, { headers: { Authorization: `Bearer ${token}` } });
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

// ── Classification ────────────────────────────────────────────────────────────
type ClassifiedAs = "answered" | "refused" | "missed" | "excluded_queue" | "excluded_direction";

function classifyResult(raw: string): "answered" | "refused" | "missed" {
  const s = raw.toLowerCase().replace(/_/g, " ");
  if (/\bno\s*answer\b/.test(s) || /\banswered\s*by\s*other\b/.test(s) || s.includes("refused")) return "refused";
  if (/\banswered\b/.test(s) || /\bconnected\b/.test(s) || /\bcompleted\b/.test(s) || /\bpicked\s*up\b/.test(s)) return "answered";
  return "missed";
}

function isTargetQueue(name: string): boolean {
  const n = name.toLowerCase();
  return TARGET_QUEUES.some((q) => n.includes(q));
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const monthParam = String(req.query.month ?? "2026-01").trim();
  const agentFilter = String(req.query.agent ?? "").trim().toLowerCase();
  const showAll = req.query.show_all === "true";
  const CAP = 3000;

  // Validate month
  if (!/^\d{4}-\d{2}$/.test(monthParam)) {
    return res.status(400).json({ error: "month must be YYYY-MM" });
  }

  const accountId    = String(process.env.ZOOM_ACCOUNT_ID    ?? "").trim();
  const clientId     = String(process.env.ZOOM_CLIENT_ID     ?? "").trim();
  const clientSecret = String(process.env.ZOOM_CLIENT_SECRET ?? "").trim();

  if (!accountId || !clientId || !clientSecret) {
    return res.status(200).json({
      source: "no_credentials",
      month: monthParam,
      records: [],
      totals: { fetched: 0, answered: 0, refused: 0, missed: 0, excluded_queue: 0, excluded_direction: 0 },
      queue_names_seen: [],
      warning: "Zoom credentials not configured. Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET to .env",
    });
  }

  try {
    const token = await getToken(accountId, clientId, clientSecret);

    // Get queue members
    const queues: any[] = await paginate(token, "/phone/call_queues", "call_queues");
    const userMap = new Map<string, string>(); // userId → displayName
    for (const q of queues.slice(0, 5)) {
      const members: any[] = await paginate(token, `/phone/call_queues/${q.id}/members`, "members");
      for (const m of members) {
        if (m.id) userMap.set(m.id, m.display_name ?? m.name ?? m.id);
      }
    }

    if (userMap.size === 0) {
      return res.status(200).json({
        source: "live",
        month: monthParam,
        records: [],
        totals: { fetched: 0, answered: 0, refused: 0, missed: 0, excluded_queue: 0, excluded_direction: 0 },
        queue_names_seen: [],
        warning: "No queue members found.",
      });
    }

    // Build date range for the month
    const [year, mon] = monthParam.split("-").map(Number);
    const fromDate = `${monthParam}-01`;
    const lastDay  = new Date(Date.UTC(year, mon, 0)).getDate();
    const toDate   = `${monthParam}-${String(lastDay).padStart(2, "0")}`;

    const records: Array<{
      idx: number;
      start_time: string;
      agent_name: string;
      direction: string;
      call_queue_name: string;
      call_result_raw: string;
      classified_as: ClassifiedAs;
      included: boolean;
      duration_seconds: number;
      wait_seconds: number;
    }> = [];

    const queueNamesSeen = new Set<string>();

    // Fetch per agent
    const entries = Array.from(userMap.entries()).filter(([, name]) =>
      !agentFilter || name.toLowerCase().includes(agentFilter),
    );

    await Promise.all(
      entries.slice(0, 30).map(async ([uid, agentName]) => {
        try {
          let next = "";
          for (let page = 0; page < 15; page++) {
            if (records.length >= CAP * 2) break; // rough cap before filtering
            const u = new URL(`https://api.zoom.us/v2/phone/users/${uid}/call_logs`);
            u.searchParams.set("from", fromDate);
            u.searchParams.set("to",   toDate);
            u.searchParams.set("type",      "all");
            u.searchParams.set("page_size", "300");
            if (next) u.searchParams.set("next_page_token", next);

            const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
            if (!r.ok) break;
            const j: any = await r.json();
            const logs: any[] = j.call_logs ?? [];

            for (const c of logs) {
              const direction      = String(c.direction ?? "").toLowerCase();
              const queueName      = String(c.call_queue_name ?? c.queue_name ?? c.operator_name ?? "");
              const callResultRaw  = String(c.result ?? c.call_result ?? "");
              const durSec         = parseInt(c.duration  ?? "0", 10) || 0;
              const waitSec        = parseInt(c.wait_time ?? "0", 10) || 0;
              const startTime      = String(c.start_time ?? c.date_time ?? "");

              if (queueName) queueNamesSeen.add(queueName);

              let classifiedAs: ClassifiedAs;
              let included = false;

              if (direction !== "inbound") {
                classifiedAs = "excluded_direction";
              } else if (!isTargetQueue(queueName)) {
                classifiedAs = "excluded_queue";
              } else {
                classifiedAs = classifyResult(callResultRaw);
                included = true;
              }

              // Only store if included OR if show_all is requested
              if (included || showAll) {
                records.push({
                  idx:            0, // set after sorting
                  start_time:     startTime,
                  agent_name:     agentName,
                  direction:      direction || "(blank)",
                  call_queue_name: queueName || "(blank — direct call)",
                  call_result_raw: callResultRaw || "(blank)",
                  classified_as:  classifiedAs,
                  included,
                  duration_seconds: durSec,
                  wait_seconds:    waitSec,
                });
              }

              if (records.length >= CAP) break;
            }

            next = String(j.next_page_token ?? "");
            if (!next) break;
          }
        } catch {
          /* per-user failures are silent */
        }
      }),
    );

    // Sort by start_time descending, then assign idx
    records.sort((a, b) => b.start_time.localeCompare(a.start_time));
    records.forEach((r, i) => { r.idx = i + 1; });

    // Compute totals
    const totals = {
      fetched:             records.length,
      answered:            records.filter((r) => r.classified_as === "answered").length,
      refused:             records.filter((r) => r.classified_as === "refused").length,
      missed:              records.filter((r) => r.classified_as === "missed").length,
      excluded_queue:      records.filter((r) => r.classified_as === "excluded_queue").length,
      excluded_direction:  records.filter((r) => r.classified_as === "excluded_direction").length,
    };

    return res.status(200).json({
      source:           "live",
      month:            monthParam,
      from_date:        fromDate,
      to_date:          toDate,
      agent_filter:     agentFilter || null,
      show_all:         showAll,
      records:          records.slice(0, CAP),
      totals,
      queue_names_seen: Array.from(queueNamesSeen).sort(),
      capped:           records.length >= CAP,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[zoom/call-logs-raw]", msg);
    return res.status(500).json({ error: msg.slice(0, 300) });
  }
}
