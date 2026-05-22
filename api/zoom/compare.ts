/**
 * GET /api/zoom/compare
 *
 * Returns a side-by-side comparison of inbound call data from:
 *   A) Zoom Phone API  (live, filtered to Network/Mobility Tech Support queues)
 *   B) Supabase         (Excel-imported performance_metrics where source_type='calls')
 *
 * Aggregated per agent per month for Jan–Apr 2026.
 *
 * Response:
 * {
 *   source_api: "live" | "snapshot",
 *   months: string[],
 *   rows: CompareRow[],
 *   totals: { api: MonthTotals, excel: MonthTotals }
 * }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04"];
const TARGET_QUEUES = ["network tech support", "mobility tech support"];

// ── Auth (same as other zoom endpoints) ───────────────────────────────────────
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
    const url = `${path}${sep}page_size=100${next ? `&next_page_token=${encodeURIComponent(next)}` : ""}`;
    const r = await fetch(`https://api.zoom.us/v2${url}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) break;
    const j: any = await r.json();
    all.push(...(Array.isArray(j?.[key]) ? j[key] : []));
    next = String(j?.next_page_token ?? "");
    if (!next) break;
  }
  return all;
}

function classifyResult(raw: string): "answered" | "refused" | "missed" {
  const s = raw.toLowerCase().replace(/_/g, " ");
  if (/\bno\s*answer\b/.test(s) || /\banswered\s*by\s*other\b/.test(s) || s.includes("refused")) return "refused";
  if (/\banswered\b/.test(s) || /\bconnected\b/.test(s) || /\bcompleted\b/.test(s) || /\bpicked\s*up\b/.test(s)) return "answered";
  return "missed";
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface MonthStat { answered: number; refused: number; missed: number; }

interface CompareRow {
  agent: string;
  by_month: Record<string, {
    api:   MonthStat | null;
    excel: MonthStat | null;
    delta_answered: number | null;   // api.answered - excel.answered
  }>;
  total: {
    api_answered:   number;
    excel_answered: number;
    delta:          number;
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── 1. Fetch Excel (Supabase) data ────────────────────────────────────────
  // Get all performance_metrics rows with source_type='calls' for Jan-Apr 2026
  type DBRow = { member_name: string; period_month: string | null; success_count: number | null; raw_json?: string; };
  let dbRows: DBRow[] = [];
  try {
    const { data, error } = await supabaseAdmin
      .from("performance_metrics")
      .select("member_name, period_month, success_count")
      .eq("source_type", "calls")
      .in("period_month", MONTHS);
    if (!error) dbRows = (data as DBRow[]) ?? [];
  } catch { /* non-fatal */ }

  // Aggregate Excel data: excelMap[agentName][month] = { answered, refused, missed }
  const excelMap = new Map<string, Record<string, MonthStat>>();
  for (const row of dbRows) {
    const agent = row.member_name ?? "";
    const month = row.period_month ?? "";
    if (!agent || !MONTHS.includes(month)) continue;
    if (!excelMap.has(agent)) excelMap.set(agent, {});
    const byMonth = excelMap.get(agent)!;
    if (!byMonth[month]) byMonth[month] = { answered: 0, refused: 0, missed: 0 };
    // success_count=1 means answered, success_count=0 means not answered
    if (row.success_count === 1) byMonth[month].answered++;
    else if (row.success_count === 0) byMonth[month].missed++; // simplified — refused not separated in DB
  }

  // ── 2. Fetch Zoom API data ────────────────────────────────────────────────
  const accountId    = String(process.env.ZOOM_ACCOUNT_ID    ?? "").trim();
  const clientId     = String(process.env.ZOOM_CLIENT_ID     ?? "").trim();
  const clientSecret = String(process.env.ZOOM_CLIENT_SECRET ?? "").trim();

  // apiMap[agentName][month] = MonthStat
  const apiMap = new Map<string, Record<string, MonthStat>>();
  let apiSource: "live" | "unavailable" = "unavailable";
  let apiWarning: string | null = null;

  if (accountId && clientId && clientSecret) {
    try {
      const token = await getToken(accountId, clientId, clientSecret);
      const queues: any[] = await paginate(token, "/phone/call_queues", "call_queues");
      const userMap = new Map<string, string>();
      for (const q of queues.slice(0, 5)) {
        const members: any[] = await paginate(token, `/phone/call_queues/${q.id}/members`, "call_queue_members");
        for (const m of members) {
          if (m.id) userMap.set(m.id, m.display_name ?? m.name ?? m.id);
        }
      }

      await Promise.all(
        Array.from(userMap.entries()).slice(0, 30).map(async ([uid, agentName]) => {
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
              const logs: any[] = j.call_logs ?? [];

              if (!apiMap.has(agentName)) apiMap.set(agentName, {});
              const byMonth = apiMap.get(agentName)!;
              if (!byMonth[monthKey]) byMonth[monthKey] = { answered: 0, refused: 0, missed: 0 };

              for (const c of logs) {
                if ((c.direction ?? "").toLowerCase() !== "inbound") continue;
                const queueName = String(c.call_queue_name ?? c.queue_name ?? c.operator_name ?? "").toLowerCase();
                if (!TARGET_QUEUES.some((q) => queueName.includes(q))) continue;
                const result = classifyResult(String(c.result ?? c.call_result ?? ""));
                byMonth[monthKey][result]++;
              }

              next = String(j.next_page_token ?? "");
              if (!next) break;
            }
          }
        }),
      );

      apiSource = "live";
    } catch (err) {
      apiWarning = err instanceof Error ? err.message.slice(0, 200) : String(err);
    }
  } else {
    apiWarning = "Zoom credentials not configured.";
  }

  // ── 3. Build comparison rows ──────────────────────────────────────────────
  // Union of all agent names from both sources
  const allAgents = new Set([...excelMap.keys(), ...apiMap.keys()]);

  const rows: CompareRow[] = Array.from(allAgents).map((agent) => {
    const apiByMonth   = apiMap.get(agent)   ?? {};
    const excelByMonth = excelMap.get(agent) ?? {};

    const byMonth: CompareRow["by_month"] = {};
    let totalApiAnswered = 0;
    let totalExcelAnswered = 0;

    for (const m of MONTHS) {
      const api   = apiByMonth[m]   ?? null;
      const excel = excelByMonth[m] ?? null;
      const delta = (api && excel)
        ? api.answered - excel.answered
        : api   ? api.answered
        : excel ? -excel.answered
        : null;
      byMonth[m] = { api, excel, delta_answered: delta };
      totalApiAnswered   += api?.answered   ?? 0;
      totalExcelAnswered += excel?.answered ?? 0;
    }

    return {
      agent,
      by_month: byMonth,
      total: {
        api_answered:   totalApiAnswered,
        excel_answered: totalExcelAnswered,
        delta:          totalApiAnswered - totalExcelAnswered,
      },
    };
  });

  // Sort by total API answered descending
  rows.sort((a, b) => b.total.api_answered - a.total.api_answered);

  // Grand totals
  const grandApiAnswered   = rows.reduce((s, r) => s + r.total.api_answered,   0);
  const grandExcelAnswered = rows.reduce((s, r) => s + r.total.excel_answered, 0);

  return res.status(200).json({
    source_api: apiSource,
    api_warning: apiWarning,
    months: MONTHS,
    excel_rows_loaded: dbRows.length,
    rows,
    grand_total: {
      api_answered:   grandApiAnswered,
      excel_answered: grandExcelAnswered,
      delta:          grandApiAnswered - grandExcelAnswered,
    },
  });
}
