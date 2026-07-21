// Shared CRUD handler used by every api/<table>.ts and api/<table>/[id].ts.
// Each route file is a one-liner that delegates here with its table name.
//
// Contract (matches the client-side `db.<table>` shim in src/db/index.ts):
//
//   GET    /api/<table>                 -- list, with ?filter.col=val, ?orderBy, ?orderDir, ?limit
//   POST   /api/<table>                 -- insert; body = { values: row | row[] }, returns inserted rows
//   DELETE /api/<table>?filter.col=val  -- bulk delete by filter (or ?all=true to wipe)
//   GET    /api/<table>/<id>            -- read one
//   PATCH  /api/<table>/<id>            -- update (body = column patch)
//   DELETE /api/<table>/<id>            -- delete one
//
// All access is via the service-role client. The frontend never reaches
// Supabase directly; it talks to these routes through src/lib/api.ts.

import { supabaseAdmin } from "./supabase-admin.js";

// Allow-list of tables the routes are allowed to touch. Anything not on
// this list returns 404 even if a route file exists — defensive guard
// against a typo causing a wide-open table query.
const ALLOWED_TABLES = new Set([
  "breaks",
  "break_schedules",
  "reminder_events",
  "punch_events",
  "one_on_one_notes",
  "notebook_section_preferences",
  "personal_action_items",
  "ticket_summaries",
  "escalation_drafts",
  "shift_handovers",
  "polished_emails",
  "performance_imports",
  "performance_metrics",
  "team_members",
  "manager_updates",
  "performance_discussions",
  "kudos",
  "celebrations",
  "metric_disputes",
  "noc_mttr_reports",
]);

// Strip auto-managed columns from POST/PATCH payloads so callers can't
// override id / created_at by accident.
function stripAuto(row) {
  if (row == null || typeof row !== "object") return row;
  const { id: _i, created_at: _c, ...rest } = row;
  return rest;
}

// Check if a Supabase error means the table hasn't been pushed yet.
// PostgREST "schema cache" errors come in two flavors:
//   - Table missing:  "Could not find the 'public.foo' in the schema cache"
//   - Column missing: "Could not find the 'bar' column of 'foo' in the schema cache"
function isTableMissing(error) {
  if (!error?.message?.includes("schema cache")) return false;
  // Column-missing errors have "column of" — table-missing errors don't.
  return !error.message.includes("column of");
}

// Extract the missing column name from a PostgREST/Postgres error.
// Returns null if this isn't a column-missing error.
// Handles two error formats:
//   1. PostgREST schema cache: "Could not find the 'foo' column of 'bar' in the schema cache"
//   2. PostgreSQL direct:      "column bar.foo does not exist"
function getMissingColumn(error) {
  if (!error?.message) return null;
  // PostgREST schema cache format
  const schemaMatch = error.message.match(/Could not find the '([^']+)' column of/);
  if (schemaMatch) return schemaMatch[1];
  // PostgreSQL "does not exist" format
  const pgMatch = error.message.match(/column \S+\.(\S+) does not exist/);
  if (pgMatch) return pgMatch[1];
  return null;
}

// Check if the error is specifically about a missing column (not a missing table).
function isColumnMissing(error) {
  return getMissingColumn(error) !== null;
}

// Remove a set of keys from each row in an array of objects.
function stripColumns(rows, columns) {
  const colSet = columns instanceof Set ? columns : new Set(columns);
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (!colSet.has(k)) out[k] = v;
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Column discovery via Supabase OpenAPI spec
// ---------------------------------------------------------------------------
// Instead of trial-and-error inserts (which cause 11+ sequential Supabase
// round-trips and edge-proxy timeouts), we query the PostgREST OpenAPI
// spec ONCE to discover all table columns. This single request gives us
// every column for every table. We cache the result in memory so subsequent
// inserts are instant.
// ---------------------------------------------------------------------------

let _allTableColumns = null; // Map<table, Set<columnName>> — populated lazily

async function discoverAllColumns() {
  if (_allTableColumns) return _allTableColumns;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("[crud] SUPABASE_URL or key not set — column discovery skipped");
    return null;
  }
  try {
    const resp = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!resp.ok) {
      console.warn(`[crud] OpenAPI spec fetch failed: HTTP ${resp.status}`);
      return null;
    }
    const spec = await resp.json();
    const defs = spec.definitions ?? {};
    const map = new Map();
    for (const [table, def] of Object.entries(defs)) {
      map.set(table, new Set(Object.keys(def.properties ?? {})));
    }
    _allTableColumns = map;
    console.log("[crud] Column discovery complete:", [...map.entries()].map(([t, cols]) => `${t}(${cols.size})`).join(", "));
    return map;
  } catch (err) {
    console.warn("[crud] Column discovery failed:", err?.message ?? err);
    return null;
  }
}

function getKnownColumns(table) {
  return _allTableColumns?.get(table) ?? null;
}

// Strip columns from rows that aren't in the known column set.
function stripUnknownColumns(rows, knownColumns) {
  if (!knownColumns) return { rows, stripped: [] };
  const stripped = [];
  const filtered = rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (knownColumns.has(k)) {
        out[k] = v;
      } else if (!stripped.includes(k)) {
        stripped.push(k);
      }
    }
    return out;
  });
  return { rows: filtered, stripped };
}

// ---------------------------------------------------------------------------
// Server-side hydration for performance_metrics
// ---------------------------------------------------------------------------
// When the Supabase table is missing derived columns (source_type,
// period_month, queue, etc.), the raw values are still stored in raw_json.
// Rather than sending 11MB of raw_json to the browser for client-side
// hydration, we extract the derived fields HERE and strip raw_json from
// the response — reducing it from ~11MB to ~1.4MB.
// ---------------------------------------------------------------------------

/** Parse "3/1/26 0:00" or "2026-03" etc. into "YYYY-MM". */
function parseMonthFromDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  // Try ISO: 2026-03 or 2026-03-01
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  // Try US date: M/D/YY or M/D/YYYY
  const us = s.match(/^(\d{1,2})\/\d{1,2}\/(\d{2,4})/);
  if (us) {
    let yr = Number(us[2]);
    if (yr < 100) yr += 2000;
    return `${yr}-${String(Number(us[1])).padStart(2, "0")}`;
  }
  // Try Date constructor as fallback
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return null;
}

/** Derive quarter from period_month: "2026-03" → "2026-Q1" */
function quarterFromMonth(pm) {
  if (!pm) return null;
  const m = pm.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const q = Math.ceil(Number(m[2]) / 3);
  return `${m[1]}-Q${q}`;
}

/** Parse queue from "reported_via" or "Operator Name" */
function parseQueue(val) {
  if (!val) return null;
  const s = String(val).toLowerCase();
  if (s.includes("noc")) return "noc";
  if (s.includes("mobility")) return "mobility";
  return null;
}

/**
 * Hydrate a performance_metrics row: if derived columns are null,
 * fill them from raw_json. Then strip raw_json from the output.
 */
function hydrateMetricRow(row, importSourceMap) {
  const { raw_json, ...rest } = row;

  const sourceType = rest.source_type || importSourceMap?.get(rest.import_id) || "tickets";

  // Audit rows must keep raw_json attached — the frontend RawDataModal reads
  // criteria scores (response_timeliness, data_quality, etc.) directly from
  // raw_json via auditRaw(). Stripping it would blank the entire Audits tab.
  if (sourceType === "audit") {
    return { ...rest, raw_json };
  }

  // For non-audit rows: if ALL derived fields already present, strip raw_json and return.
  // IMPORTANT: must check ALL hydrated fields — when we add new ones the
  // cache must be forced to re-parse. Check the newest fields last.
  if (rest.source_type && rest.period_month && rest.ack_minutes !== undefined
      && rest.hour !== undefined && rest.is_maintenance !== undefined
      && rest.is_weekend !== undefined && rest.ref_number !== undefined) {
    return rest;
  }

  let raw;
  try { raw = JSON.parse(raw_json); } catch { return rest; }
  const periodMonth = rest.period_month || parseMonthFromDate(raw.month || raw.Month || raw.start_time || raw["Start Time"]);
  const periodQuarter = rest.period_quarter || quarterFromMonth(periodMonth);
  const queue = rest.queue || parseQueue(raw.reported_via || raw["Operator Name"]);

  // Detect maintenance-notification tickets from the issue/issue_type column.
  // The frontend uses this flag to filter them out of KPI calculations.
  let isMaintenance = false;
  if (sourceType === "tickets") {
    const issueVal = raw.issue ?? raw.Issue ?? raw.issue_type ?? raw["Issue Type"] ?? "";
    if (issueVal) {
      const norm = String(issueVal).toLowerCase().replace(/[^a-z0-9]/g, "");
      isMaintenance = norm.includes("maintenancenotification");
    }
  }

  // Detect weekday vs weekend from the raw data.
  // Tickets: `weekday_weekend` ("Weekday" / "Weekend")
  // Calls:   `Weekend/Weekday` ("Weekday" / "Weekend")
  // Tasks:   `Day Opened` ("Monday" ... "Sunday") — derive from day name
  let isWeekend = null; // null = unknown
  if (sourceType === "tickets") {
    const ww = raw.weekday_weekend ?? raw["Weekday/Weekend"] ?? "";
    if (ww) isWeekend = String(ww).toLowerCase().trim() === "weekend";
  } else if (sourceType === "calls") {
    const ww = raw["Weekend/Weekday"] ?? raw.weekend_weekday ?? "";
    if (ww) {
      isWeekend = String(ww).toLowerCase().trim() === "weekend";
    } else {
      // Fallback: derive from Day of Week
      const dow = raw["Day of Week"] ?? raw.day_of_week ?? "";
      if (dow) {
        const d = String(dow).toLowerCase().trim();
        isWeekend = d === "saturday" || d === "sunday";
      }
    }
  } else if (sourceType === "tasks") {
    const dow = raw["Day Opened"] ?? raw.day_opened ?? "";
    if (dow) {
      const d = String(dow).toLowerCase().trim();
      isWeekend = d === "saturday" || d === "sunday";
    }
  }

  // Extract the hour (0-23) for shift-based filtering.
  // Tickets: `hour_opened`, Calls: `Hour of Day`, Tasks: `Hour Opened`
  let hour = null;
  {
    const hRaw =
      raw.hour_opened ?? raw["Hour Opened"] ?? raw["Hour of Day"] ?? raw.hour_of_day;
    if (hRaw != null && hRaw !== "") {
      const n = parseInt(String(hRaw), 10);
      if (isFinite(n) && n >= 0 && n <= 23) hour = n;
    }
  }

  const out = {
    ...rest,
    source_type: sourceType,
    period_month: periodMonth,
    period_quarter: periodQuarter,
    queue: queue,
    total_count: rest.total_count ?? 1,
    is_maintenance: isMaintenance,
    is_weekend: isWeekend,
    hour: hour,
    // Identifier / context fields extracted from raw_json so the
    // frontend can show them in the Raw Data table without needing
    // to transmit the full raw_json blob.
    ref_number: null,
    customer_name: null,
    subject_text: null,
    caller_info: null,
    raw_json: "", // keep field present but empty
  };

  // Source-specific KPI extraction — mirrors import.ts extractSummary()
  if (sourceType === "tickets") {
    // Identifier fields
    out.ref_number = raw.trouble_id ?? raw.Trouble_ID ?? null;
    out.customer_name = raw.customer ?? raw.Customer ?? null;
    out.subject_text = raw.subject ?? raw.Subject ?? null;

    if (out.ack_minutes == null) {
      out.ack_minutes = parseAsMinutes(raw.first_touch) ?? null;
    }
    if (out.carrier_ticket_minutes == null) {
      out.carrier_ticket_minutes = parseAsMinutes(raw.time_to_carrier_ticket) ?? null;
    }
    if (out.success_count == null) {
      out.success_count = parseWithin24h(raw.time_taken_to_close_tickets) ?? null;
    }
    if (out.duration_minutes == null) {
      out.duration_minutes = parseMttrMinutes(raw.mttr) ?? null;
    }
    if (out.score == null && raw.priority != null && raw.priority !== "") {
      out.score = String(raw.priority);
    }
    if (out.period_start == null && raw.opened_date) {
      out.period_start = String(raw.opened_date);
    }
    if (out.period_end == null && raw.closed_date) {
      out.period_end = String(raw.closed_date);
    }
  } else if (sourceType === "calls") {
    // Identifier fields — calls don't have a "from number" column;
    // closest identifiers are To Name / To Email / Operator Name.
    out.caller_info = raw["To Name"] || raw.to_name || null;
    const email = raw["To Email"] || raw.to_email || null;
    if (email && out.caller_info) out.caller_info += ` (${email})`;
    else if (email) out.caller_info = email;
    out.customer_name = raw["Operator Name"] || raw.operator_name || null;

    if (out.handle_seconds == null) {
      out.handle_seconds = parseDurationSeconds(raw.Duration || raw.duration) ?? null;
    }
    if (out.wait_seconds == null) {
      const ws = parseDurationSeconds(raw["Wait Time"] || raw.wait_time) ?? null;
      out.wait_seconds = ws;
      if (out.duration_minutes == null && ws != null) {
        out.duration_minutes = Math.round((ws / 60) * 100) / 100;
      }
    }
    if (out.success_count == null) {
      const outcome = classifyCallResult(raw["Call Result"] || raw.call_result);
      out.success_count = outcome === "answered" ? 1 : 0;
    }
    if (out.score == null) {
      const cr = raw["Call Result"] || raw.call_result;
      if (cr != null && cr !== "") out.score = String(cr);
    }
    if (out.period_start == null && raw["Start Time"]) {
      out.period_start = String(raw["Start Time"]);
    }
  } else if (sourceType === "tasks") {
    // Identifier fields
    out.ref_number = raw.Task ?? raw.task ?? null;
    out.customer_name = raw.Customer ?? raw.customer ?? null;
    out.subject_text = raw.Subject ?? raw.subject ?? null;

    if (out.success_count == null) out.success_count = 1;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Parser helpers — replicate import.ts logic server-side for hydration
// ---------------------------------------------------------------------------

function asNumber(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const n = Number(String(v).trim());
  return isFinite(n) ? n : null;
}

function parseAsMinutes(v) {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") return isFinite(v) && v >= 0 ? v : undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (/^\d{1,3}(:\d{1,2}){1,2}(\.\d+)?$/.test(s)) {
    const parts = s.split(":").map(p => parseFloat(p));
    if (parts.some(p => !isFinite(p))) return undefined;
    let secs = 0;
    if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) secs = parts[0] * 60 + parts[1];
    else secs = parts[0] * 60;
    return Math.round((secs / 60) * 100) / 100;
  }
  const n = Number(s);
  return isFinite(n) && n >= 0 ? n : undefined;
}

function parseDurationSeconds(v) {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") return isFinite(v) && v >= 0 ? Math.round(v) : undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (/^\d{1,3}(:\d{1,2}){1,2}(\.\d+)?$/.test(s)) {
    const parts = s.split(":").map(p => parseFloat(p));
    if (parts.some(p => !isFinite(p))) return undefined;
    let total = 0;
    if (parts.length === 3) total = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) total = parts[0] * 60 + parts[1];
    else total = parts[0];
    return Math.round(total);
  }
  const n = Number(s);
  return isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

function parseMttrMinutes(v) {
  const n = asNumber(v);
  if (n == null) return undefined;
  return n < 24 ? Math.round(n * 60) : Math.round(n);
}

function parseWithin24h(v) {
  if (v == null || v === "") return undefined;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v ? 1 : 0;
  const s = String(v).trim().toLowerCase();
  if (!s) return undefined;
  if (/\b(less\s*than|under|below)\b.*\b24\b/.test(s)) return 1;
  if (/\b(more\s*than|greater\s*than|over|above|>=?|exceed)\b.*\b24\b/.test(s)) return 0;
  if (s === "yes" || s === "y" || s === "true" || s === "1" || s === "closed" || /\bwithin\b/.test(s)) return 1;
  if (s === "no" || s === "n" || s === "false" || s === "0" || /\bover\b/.test(s) || /\bnot\s+closed\b/.test(s)) return 0;
  return undefined;
}

function classifyCallResult(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (/\bno\s*answer\b/.test(s) || /\banswered\s*by\s*other\b/.test(s)) return "refused";
  if (/\bconnected\b/.test(s) || /\banswered\b/.test(s) || /\bpicked\s*up\b/.test(s) || /\bcompleted\b/.test(s) || /\bhandled\b/.test(s)) return "answered";
  if (/\bmiss/.test(s) || /\babandon/.test(s) || /\bvoicemail\b/.test(s) || /\bhangup\b/.test(s) || /\bcancel/.test(s) || /\brejected\b/.test(s)) return "missed";
  return null;
}

// ---------------------------------------------------------------------------
// In-memory hydration cache for performance_metrics
// ---------------------------------------------------------------------------
// The hydration step (9320 JSON.parse calls + 10 Supabase pagination
// requests) takes ~5–10 seconds. While it runs, the single-threaded Vite
// event loop is blocked, causing concurrent requests (manager_updates,
// auth/dev-login) to stall and the edge proxy to return 502.
//
// We cache the fully-hydrated response in memory. On GET performance_metrics
// (no filters), we return the cache instantly. The cache is invalidated
// whenever a POST or DELETE hits performance_metrics or performance_imports.
// ---------------------------------------------------------------------------

let _metricsCache = null;    // { data: hydrated rows array, ts: Date.now() }
const METRICS_CACHE_TTL = 60_000; // 60 seconds

function getMetricsCache(reqQuery) {
  // Only serve cache for unfiltered, un-limited GETs (the main dashboard load)
  if (!_metricsCache) return null;
  const hasFilter = Object.keys(reqQuery || {}).some(
    (k) => k.startsWith("filter.") || k === "limit"
  );
  if (hasFilter) return null;
  if (Date.now() - _metricsCache.ts > METRICS_CACHE_TTL) {
    _metricsCache = null;
    return null;
  }
  return _metricsCache.data;
}

function setMetricsCache(data) {
  _metricsCache = { data, ts: Date.now() };
}

export function invalidateMetricsCache() {
  _metricsCache = null;
}

// Coerce a query-string filter value (always a string) into the right
// JS type before sending it to Supabase. Without this, eq("is_active", "true")
// returns nothing because PostgREST treats the value as a string literal.
function coerceFilterValue(raw) {
  if (Array.isArray(raw)) raw = raw[0];
  if (raw === "null") return { kind: "null" };
  if (raw === "true") return { kind: "value", value: true };
  if (raw === "false") return { kind: "value", value: false };
  // Plain integer (no decimal, no leading zero on multi-digit)
  if (/^-?\d+$/.test(raw)) return { kind: "value", value: Number(raw) };
  // Float
  if (/^-?\d+\.\d+$/.test(raw)) return { kind: "value", value: Number(raw) };
  return { kind: "value", value: raw };
}

function applyFilters(query, reqQuery) {
  let hasFilter = false;
  for (const [key, rawValue] of Object.entries(reqQuery)) {
    if (typeof key !== "string" || !key.startsWith("filter.")) continue;
    const column = key.slice("filter.".length);
    const coerced = coerceFilterValue(rawValue);
    hasFilter = true;
    if (coerced.kind === "null") {
      query = query.is(column, null);
    } else {
      query = query.eq(column, coerced.value);
    }
  }
  return { query, hasFilter };
}

export async function handleCollection(table, req, res) {
  if (!ALLOWED_TABLES.has(table)) {
    return res.status(404).json({ error: `Unknown table: ${table}` });
  }
  try {
    if (req.method === "GET") {
      // Fast path: return cached hydrated performance_metrics if available
      if (table === "performance_metrics") {
        const cached = getMetricsCache(req.query);
        if (cached) {
          return res.status(200).json(cached);
        }
      }

      // Discover columns so we can skip invalid orderBy without error.
      await discoverAllColumns();
      const knownCols = getKnownColumns(table);

      let orderBy = req.query.orderBy;
      // If the orderBy column doesn't exist in Supabase, skip it entirely
      // to avoid "column does not exist" errors.
      if (orderBy && typeof orderBy === "string" && knownCols && !knownCols.has(orderBy)) {
        orderBy = null;
      }
      const orderDir = req.query.orderDir;
      const limitRaw = req.query.limit;
      const explicitLimit =
        limitRaw && typeof limitRaw === "string" && /^\d+$/.test(limitRaw)
          ? Number(limitRaw)
          : null;

      // PostgREST defaults to 1000 rows. When the caller doesn't set a
      // limit we auto-paginate to return ALL rows (performance_metrics
      // can easily exceed 10k rows).
      if (explicitLimit !== null) {
        // Caller asked for a specific limit — single fetch.
        let q = supabaseAdmin.from(table).select("*");
        ({ query: q } = applyFilters(q, req.query));
        if (orderBy && typeof orderBy === "string") {
          q = q.order(orderBy, { ascending: orderDir !== "desc" });
        }
        q = q.limit(explicitLimit);
        const { data, error } = await q;
        if (error) {
          if (isTableMissing(error) || getMissingColumn(error)) {
            return res.status(200).json([]);
          }
          return res.status(500).json({ error: error.message });
        }
        return res.status(200).json(data ?? []);
      }

      // No limit — auto-paginate to fetch ALL rows.
      const PAGE = 1000;
      let allRows = [];
      let offset = 0;
      while (true) {
        let q = supabaseAdmin.from(table).select("*");
        ({ query: q } = applyFilters(q, req.query));
        if (orderBy && typeof orderBy === "string") {
          q = q.order(orderBy, { ascending: orderDir !== "desc" });
        }
        q = q.range(offset, offset + PAGE - 1);
        const { data, error } = await q;
        if (error) {
          if (isTableMissing(error) || getMissingColumn(error)) {
            return res.status(200).json(allRows);
          }
          return res.status(500).json({ error: error.message });
        }
        if (!data || data.length === 0) break;
        allRows = allRows.concat(data);
        if (data.length < PAGE) break; // last page
        offset += PAGE;
      }

      // Server-side hydration for performance_metrics: fill derived fields
      // from raw_json and strip it from the response (11MB → 1.4MB).
      // ALWAYS run for performance_metrics — the old guard (!allRows[0].source_type)
      // caused the entire block to be skipped whenever the first row happened to
      // be an audit row (which already has source_type set). Ticket/call/task rows
      // imported before the column was reliably written would then stay null.
      // hydrateMetricRow() has its own early-return when all fields are present,
      // so running it unconditionally is cheap for already-hydrated rows.
      if (table === "performance_metrics" && allRows.length > 0) {
        // Build import_id → source_type map
        const importSourceMap = new Map();
        try {
          const { data: imports } = await supabaseAdmin
            .from("performance_imports")
            .select("id,source_type");
          if (imports) {
            for (const imp of imports) importSourceMap.set(imp.id, imp.source_type);
          }
        } catch { /* ignore */ }
        allRows = allRows.map((r) => hydrateMetricRow(r, importSourceMap));
      }

      // Cache the hydrated result for future requests
      if (table === "performance_metrics" && allRows.length > 0) {
        setMetricsCache(allRows);
      }

      return res.status(200).json(allRows);
    }

    if (req.method === "POST") {
      // Invalidate metrics cache when data changes
      if (table === "performance_metrics" || table === "performance_imports") {
        invalidateMetricsCache();
      }
      const body = req.body ?? {};
      const raw = body.values !== undefined ? body.values : body;
      if (raw == null) {
        return res.status(400).json({ error: "Missing values in request body" });
      }
      let rows = (Array.isArray(raw) ? raw : [raw]).map(stripAuto);
      if (rows.length === 0) {
        return res.status(400).json({ error: "Empty values array" });
      }

      // Discover table columns (one-time, cached) and pre-strip unknown
      // columns BEFORE sending to Supabase. This is a single request to
      // the OpenAPI spec — no trial-and-error retry loop needed.
      await discoverAllColumns();
      const knownCols = getKnownColumns(table);
      let strippedNames = [];
      if (knownCols) {
        const result = stripUnknownColumns(rows, knownCols);
        rows = result.rows;
        strippedNames = result.stripped;
      }

      // When ?minimal=true the caller doesn't need the inserted rows back.
      const minimal = req.query.minimal === "true";

      const q = supabaseAdmin.from(table).insert(rows);
      const { data, error } = minimal ? await q : await q.select();
      if (error) {
        if (isTableMissing(error)) {
          return res.status(503).json({
            error: `Table "${table}" not found — push the schema to Supabase first.`,
          });
        }
        return res.status(500).json({ error: error.message });
      }
      if (strippedNames.length > 0) {
        res.setHeader(
          "X-Schema-Warning",
          `Columns not in Supabase (re-push schema): ${strippedNames.join(", ")}`,
        );
      }
      if (minimal) {
        return res.status(201).json({ count: rows.length });
      }
      return res.status(201).json(data ?? []);
    }

    if (req.method === "DELETE") {
      // Invalidate metrics cache when data changes
      if (table === "performance_metrics" || table === "performance_imports") {
        invalidateMetricsCache();
      }
      let q = supabaseAdmin.from(table).delete();
      const { query: filtered, hasFilter } = applyFilters(q, req.query);
      q = filtered;
      if (!hasFilter) {
        if (req.query.all !== "true") {
          return res.status(400).json({
            error:
              "Refusing bulk delete without filter. Pass ?all=true to wipe the table.",
          });
        }
        // PostgREST requires every DELETE to have a filter. Use a clause
        // that matches every row (id is a serial PK starting at 1).
        q = q.gte("id", 0);
      }
      const { error } = await q;
      if (error) {
        if (isTableMissing(error)) return res.status(200).json({ ok: true });
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Server error",
    });
  }
}

export async function handleItem(table, idRaw, req, res) {
  if (!ALLOWED_TABLES.has(table)) {
    return res.status(404).json({ error: `Unknown table: ${table}` });
  }
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: `Invalid id: ${idRaw}` });
  }
  try {
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select("*")
        .eq("id", id)
        .single();
      if (error) {
        if (isTableMissing(error)) return res.status(404).json({ error: "Not found" });
        return res.status(404).json({ error: error.message });
      }
      return res.status(200).json(data);
    }
    if (req.method === "PATCH") {
      if (table === "performance_metrics" || table === "performance_imports") {
        invalidateMetricsCache();
      }
      let patch = stripAuto(req.body ?? {});
      // Pre-strip unknown columns via schema discovery.
      await discoverAllColumns();
      const knownCols = getKnownColumns(table);
      if (knownCols) {
        patch = Object.fromEntries(
          Object.entries(patch).filter(([k]) => knownCols.has(k)),
        );
      }
      const { data, error } = await supabaseAdmin
        .from(table)
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) {
        if (isTableMissing(error)) {
          return res.status(503).json({
            error: `Table "${table}" not found — push the schema to Supabase first.`,
          });
        }
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json(data);
    }
    if (req.method === "DELETE") {
      if (table === "performance_metrics" || table === "performance_imports") {
        invalidateMetricsCache();
      }
      const { error } = await supabaseAdmin.from(table).delete().eq("id", id);
      if (error) {
        if (isTableMissing(error)) return res.status(200).json({ ok: true });
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json({ ok: true });
    }
    res.setHeader("Allow", "GET, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Server error",
    });
  }
}
