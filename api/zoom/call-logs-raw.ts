/**
 * GET /api/zoom/call-logs-raw
 *
 * Returns individual raw call records directly from the Zoom Phone QUEUE endpoint
 * for a single month. Uses /phone/call_queues/{id}/call_logs so ALL agents' calls
 * are visible — not just the admin's own calls.
 *
 * Query params:
 *   month    = YYYY-MM (required, defaults to 2026-01)
 *   agent    = partial answered_by name filter, case-insensitive (optional)
 *
 * Each record:
 *   start_time, queue_name, call_result_raw, classified_as,
 *   answered_by_name, duration_seconds, wait_seconds
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

const TARGET_QUEUES = ["network tech support", "mobility tech support"];

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

async function paginate(token: string, path: string, key: string): Promise<any[]> {
  const all: any[] = [];
  let next = "";
  for (let i = 0; i < 10; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `https://api.zoom.us/v2${path}${sep}page_size=100${next ? `&next_page_token=${encodeURIComponent(next)}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) break;
    const j: any = await r.json();
    all.push(...(Array.isArray(j?.[key]) ? j[key] : []));
    next = String(j?.next_page_token ?? "");
    if (!next) break;
  }
  return all;
}

/**
 * Zoom Phone field mapping — matches Excel export column names exactly:
 *   "Operator Name" → operator_name  (NOC vs Mobility queue filter)
 *   "To Name"       → to_name        (agent who received the call)
 *   "Event"         → event          (primary answered classification)
 */
function isTargetOperator(name: string): boolean {
  const n = name.toLowerCase();
  return TARGET_QUEUES.some((q) => n.includes(q));
}

function getOperatorName(c: any): string {
  return String(c.operator_name ?? c.call_queue_name ?? c.queue_name ?? "");
}

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

function classifyEvent(event: string, resultFallback: string): "answered" | "refused" | "missed" {
  // Primary: event field (matches Excel "Event" column)
  if (event) {
    const e = event.toLowerCase().trim();
    if (e === "answered") return "answered";
    if (e === "missed" || e === "no answer" || e === "voicemail") return "missed";
    if (e === "refused" || e === "no answer (answered by other)") return "refused";
  }
  // Fallback: result string classification
  const s = resultFallback.toLowerCase().replace(/_/g, " ");
  if (/\bno\s*answer\b/.test(s) || /\banswered\s*by\s*other\b/.test(s) || s.includes("refused")) return "refused";
  if (/\banswered\b/.test(s) || /\bconnected\b/.test(s) || /\bcompleted\b/.test(s) || /\bpicked\s*up\b/.test(s)) return "answered";
  return "missed";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }

  const monthParam  = String(req.query.month ?? "2026-01").trim();
  const agentFilter = String(req.query.agent ?? "").trim().toLowerCase();

  if (!/^\d{4}-\d{2}$/.test(monthParam)) return res.status(400).json({ error: "month must be YYYY-MM" });

  const accountId    = String(process.env.ZOOM_ACCOUNT_ID    ?? "").trim();
  const clientId     = String(process.env.ZOOM_CLIENT_ID     ?? "").trim();
  const clientSecret = String(process.env.ZOOM_CLIENT_SECRET ?? "").trim();

  if (!accountId || !clientId || !clientSecret) {
    return res.status(200).json({
      source: "no_credentials", month: monthParam, records: [],
      totals: { fetched: 0, answered: 0, refused: 0, missed: 0 },
      queues_found: [],
      warning: "Zoom credentials not configured.",
    });
  }

  try {
    const token = await getToken(accountId, clientId, clientSecret);

    // Get matching queues
    const allQueues: any[] = await paginate(token, "/phone/call_queues", "call_queues");
    const targetQueues = allQueues.filter((q) => isTargetOperator(String(q.name ?? "")));

    if (targetQueues.length === 0) {
      return res.status(200).json({
        source: "live", month: monthParam, records: [],
        totals: { fetched: 0, answered: 0, refused: 0, missed: 0 },
        queues_found: [],
        warning: `No target queues found. Available: ${allQueues.map((q) => q.name).join(", ") || "(none)"}`,
      });
    }

    const [year, mon] = monthParam.split("-").map(Number);
    const fromDate = `${monthParam}-01`;
    const lastDay  = new Date(Date.UTC(year, mon, 0)).getDate();
    const toDate   = `${monthParam}-${String(lastDay).padStart(2, "0")}`;

    interface RawRecord {
      idx: number;
      start_time: string;
      queue_name: string;
      call_result_raw: string;
      classified_as: "answered" | "refused" | "missed";
      answered_by_name: string;
      duration_seconds: number;
      wait_seconds: number;
    }

    const records: RawRecord[] = [];
    const seenCallIds = new Set<string>();

    // Use account-level call logs endpoint — requires phone:read:call_log:admin scope
    // This returns ALL calls across all agents, then we filter by queue name client-side
    {
      let next = "";
      for (let page = 0; page < 30; page++) {
        if (records.length >= 5000) break;
        const u = new URL(`https://api.zoom.us/v2/phone/call_logs`);
        u.searchParams.set("from", fromDate);
        u.searchParams.set("to",   toDate);
        u.searchParams.set("type",      "all");
        u.searchParams.set("page_size", "300");
        if (next) u.searchParams.set("next_page_token", next);

        const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) {
          const errBody = await r.text().catch(() => "");
          let errJson: any = {};
          try { errJson = JSON.parse(errBody); } catch {}
          return res.status(200).json({
            source: "error", month: monthParam, records: [],
            totals: { fetched: 0, answered: 0, refused: 0, missed: 0 },
            queues_found: targetQueues.map((q) => q.name),
            warning: r.status === 403
              ? `PLAN_RESTRICTION: The Zoom Phone plan on this account does not allow API access to call logs. The scope "phone:read:call_log:admin" is present in the token but the API still returns 403. This typically requires a Zoom Phone Pro or higher plan, or enabling call log API access in Zoom Admin → Account Management → Account Settings → Phone. (HTTP 403: ${errJson.message ?? "You do not have permission."})`
              : `Zoom API error ${r.status}: ${errJson.message ?? errBody.slice(0, 100)}`,
          });
        }
        const j: any = await r.json();
        const logs: any[] = j.call_logs ?? j.calls ?? [];
        const allQueues = targetQueues; // just for reference in loop below

        for (const c of logs) {
          // ── "Operator Name" filter — NOC vs Mobility (matches Excel column)
          const operatorName = getOperatorName(c);
          if (!isTargetOperator(operatorName)) continue;

          // Only inbound calls
          if ((c.direction ?? "").toLowerCase() !== "inbound") continue;

          // Deduplicate
          const callId = String(c.call_id ?? c.id ?? "");
          if (callId && seenCallIds.has(callId)) continue;
          if (callId) seenCallIds.add(callId);

          // ── "Event" + "To Name" (matches Excel columns)
          const event         = String(c.event ?? "");
          const resultRaw     = String(c.result ?? c.call_result ?? "");
          const classified_as = classifyEvent(event, resultRaw);

          // ── "To Name" — agent who received the call (matches Excel column)
          const toName = getToName(c);

          // Apply agent filter on To Name
          if (agentFilter && !toName.toLowerCase().includes(agentFilter)) continue;

          records.push({
            idx:              0,
            start_time:       String(c.start_time ?? c.date_time ?? ""),
            queue_name:       operatorName,
            call_result_raw:  event ? `${event}${resultRaw ? ` / ${resultRaw}` : ""}` : resultRaw || "(blank)",
            classified_as,
            answered_by_name: toName || "— not answered",
            duration_seconds: parseInt(String(c.duration ?? "0"), 10) || 0,
            wait_seconds:     parseInt(String(c.wait_time ?? c.waiting_time ?? "0"), 10) || 0,
          });
        }

        next = String(j.next_page_token ?? "");
        if (!next) break;
      }
    }

    // Sort newest first, assign idx
    records.sort((a, b) => b.start_time.localeCompare(a.start_time));
    records.forEach((r, i) => { r.idx = i + 1; });

    const totals = {
      fetched:   records.length,
      answered:  records.filter((r) => r.classified_as === "answered").length,
      refused:   records.filter((r) => r.classified_as === "refused").length,
      missed:    records.filter((r) => r.classified_as === "missed").length,
    };

    return res.status(200).json({
      source: "live",
      month: monthParam,
      from_date: fromDate,
      to_date: toDate,
      agent_filter: agentFilter || null,
      records: records.slice(0, 5000),
      totals,
      queues_found: targetQueues.map((q) => q.name),
      capped: records.length >= 5000,

    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[zoom/call-logs-raw]", msg);
    return res.status(500).json({ error: msg.slice(0, 300) });
  }
}
