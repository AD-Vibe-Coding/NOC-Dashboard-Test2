/**
 * GET /api/zoom/compare
 *
 * Side-by-side comparison: Zoom Phone queue call logs vs Excel-imported performance_metrics.
 * Uses queue call logs (not per-user) so all agents' data is returned.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04"];
const TARGET_QUEUES = ["network tech support", "mobility tech support"];

let _token: { value: string; expiresAt: number } | null = null;
async function getToken(id: string, cid: string, sec: string): Promise<string> {
  if (_token && _token.expiresAt > Date.now() + 60_000) return _token.value;
  const creds = Buffer.from(`${cid}:${sec}`).toString("base64");
  const r = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(id)}`,
    { method: "POST", headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" } },
  );
  if (!r.ok) throw new Error(`Zoom OAuth (${r.status})`);
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

function isTargetQueue(name: string): boolean {
  const n = name.toLowerCase();
  return TARGET_QUEUES.some((q) => n.includes(q));
}

function classifyResult(raw: string): "answered" | "other" {
  const s = raw.toLowerCase().replace(/_/g, " ");
  if (/\banswered\b/.test(s) || /\bconnected\b/.test(s) || /\bcompleted\b/.test(s) || /\bpicked\s*up\b/.test(s)) return "answered";
  return "other";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }

  const accountId    = String(process.env.ZOOM_ACCOUNT_ID    ?? "").trim();
  const clientId     = String(process.env.ZOOM_CLIENT_ID     ?? "").trim();
  const clientSecret = String(process.env.ZOOM_CLIENT_SECRET ?? "").trim();

  // ── Excel side (Supabase) ────────────────────────────────────────────────────
  const excelByAgentMonth: Record<string, Record<string, number>> = {};
  let excelWarning: string | null = null;
  try {
    const { data, error } = await supabaseAdmin
      .from("performance_metrics")
      .select("member_name, period_month, success_count")
      .eq("source_type", "calls")
      .in("period_month", MONTHS)
      .gte("period_start", "2026-01-01")
      .lte("period_start", "2026-04-30");

    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const name  = String(row.member_name ?? "");
      const month = String(row.period_month ?? "");
      const isAns = Number(row.success_count) === 1;
      if (!name || !month || !isAns) continue;
      if (!excelByAgentMonth[name]) excelByAgentMonth[name] = {};
      excelByAgentMonth[name][month] = (excelByAgentMonth[name][month] ?? 0) + 1;
    }
  } catch (e) {
    excelWarning = `Excel data unavailable: ${e instanceof Error ? e.message : String(e)}`;
  }

  // ── Zoom API side (queue call logs) ─────────────────────────────────────────
  const zoomByAgentMonth: Record<string, Record<string, number>> = {};
  let zoomSource: "live" | "snapshot" = "snapshot";
  let zoomWarning: string | null = null;
  let queuesFound: string[] = [];

  if (accountId && clientId && clientSecret) {
    try {
      const token = await getToken(accountId, clientId, clientSecret);
      const allQueues: any[] = await paginate(token, "/phone/call_queues", "call_queues");
      const targetQueues = allQueues.filter((q) => isTargetQueue(String(q.name ?? "")));
      queuesFound = targetQueues.map((q) => q.name);

      if (targetQueues.length > 0) {
        const seenCallIds = new Set<string>();
        for (const queue of targetQueues) {
          for (const monthKey of MONTHS) {
            const [year, mon] = monthKey.split("-").map(Number);
            const fromDate = `${monthKey}-01`;
            const lastDay  = new Date(Date.UTC(year, mon, 0)).getDate();
            const toDate   = `${monthKey}-${String(lastDay).padStart(2, "0")}`;

            let next = "";
            for (let page = 0; page < 20; page++) {
              const u = new URL(`https://api.zoom.us/v2/phone/call_queues/${queue.id}/call_logs`);
              u.searchParams.set("from", fromDate);
              u.searchParams.set("to",   toDate);
              u.searchParams.set("page_size", "300");
              if (next) u.searchParams.set("next_page_token", next);
              const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
              if (!r.ok) break;
              const j: any = await r.json();
              const logs: any[] = j.call_logs ?? j.calls ?? [];

              for (const c of logs) {
                const callId = String(c.call_id ?? c.id ?? "");
                if (callId && seenCallIds.has(callId)) continue;
                if (callId) seenCallIds.add(callId);

                if (classifyResult(String(c.result ?? c.call_result ?? "")) !== "answered") continue;
                const agentName = c.answered_by?.name ?? c.answered_by?.display_name ?? c.callee_name ?? null;
                if (!agentName) continue;

                // Derive month from start_time
                const st = String(c.start_time ?? "");
                const mKey = st.slice(0, 7); // "2026-01"
                if (!MONTHS.includes(mKey)) continue;

                if (!zoomByAgentMonth[agentName]) zoomByAgentMonth[agentName] = {};
                zoomByAgentMonth[agentName][mKey] = (zoomByAgentMonth[agentName][mKey] ?? 0) + 1;
              }

              next = String(j.next_page_token ?? "");
              if (!next) break;
            }
          }
        }
        zoomSource = "live";
      } else {
        zoomWarning = `No matching queues found. Available: ${allQueues.map((q) => q.name).join(", ") || "(none)"}`;
      }
    } catch (e) {
      zoomWarning = `Zoom API error: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`;
    }
  } else {
    zoomWarning = "Zoom credentials not configured.";
  }

  // ── Build comparison rows ────────────────────────────────────────────────────
  const allAgents = new Set([...Object.keys(zoomByAgentMonth), ...Object.keys(excelByAgentMonth)]);

  const rows = Array.from(allAgents).map((agent) => {
    const byMonth: Record<string, { api: number; excel: number; delta: number }> = {};
    let totalApi = 0, totalExcel = 0;
    for (const m of MONTHS) {
      const api   = zoomByAgentMonth[agent]?.[m] ?? 0;
      const excel = excelByAgentMonth[agent]?.[m] ?? 0;
      byMonth[m] = { api, excel, delta: api - excel };
      totalApi   += api;
      totalExcel += excel;
    }
    return { agent, by_month: byMonth, total_api: totalApi, total_excel: totalExcel, total_delta: totalApi - totalExcel };
  }).sort((a, b) => b.total_excel - a.total_excel || b.total_api - a.total_api);

  // Grand totals
  const grandTotals = MONTHS.reduce((acc, m) => {
    acc[m] = {
      api:   rows.reduce((s, r) => s + r.by_month[m].api,   0),
      excel: rows.reduce((s, r) => s + r.by_month[m].excel, 0),
      delta: 0,
    };
    acc[m].delta = acc[m].api - acc[m].excel;
    return acc;
  }, {} as Record<string, { api: number; excel: number; delta: number }>);

  return res.status(200).json({
    source_api: zoomSource,
    months: MONTHS,
    rows,
    grand_totals: grandTotals,
    queues_found: queuesFound,
    zoom_warning: zoomWarning,
    excel_warning: excelWarning,
  });
}
