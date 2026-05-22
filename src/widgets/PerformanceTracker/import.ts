import * as XLSX from "xlsx";
import { resolveTeamMember } from "./team";

// =============================================================================
// Excel import pipeline for the Performance Tracker.
//
// FLOW:
//   1. parseWorkbook(file) → SheetInfo[]  (preview-only, no DB writes)
//      - User reviews each sheet, optionally adjusts source type / name col.
//   2. executeImport(file, plan) → ImportResult
//      - Re-reads the workbook, applies the plan, returns matched + skipped.
//   3. (caller) persistImport(...) writes ImportResult into Supabase via API routes.
//
// The two-step design lets the UI show a confirmation dialog with row counts
// and previews BEFORE anything hits the DB.
// =============================================================================

export type SourceType = "tickets" | "calls" | "tasks" | "queue" | "audit";

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  tickets: "Tickets",
  calls: "Inbound Calls",
  tasks: "Tasks",
  queue: "Queue Availability",
  audit: "Audit",
};

export const SOURCE_TYPE_DESCRIPTIONS: Record<SourceType, string> = {
  tickets: "Ticket creation / closure activity per agent",
  calls: "Inbound call volume + answered/missed counts",
  tasks: "Tasks completed / pending per agent",
  queue: "Queue login + availability percentage",
  audit: "QA audit scores per agent",
};

// =============================================================================
// Source-specific column dictionaries
//
// Each source type (tickets, calls, ...) has a known column schema with a
// permanent ignore list AND a hard-pinned agent column that always wins
// over the heuristic detector. Centralized here so the import pipeline,
// the dashboard drill-down, and the column-label tooltips share one
// source of truth.
// =============================================================================

/** The agent-attribution column for ticket sheets. */
export const TICKET_OWNER_COLUMN = "first_contact_name";

/** The agent-attribution column for inbound call sheets (Zoom Phone export). */
export const CALL_AGENT_COLUMN = "To Name";

/**
 * The agent-attribution column for task sheets. Per the user mapping,
 * the task export attributes each row to the agent via the "Closed By"
 * column (NOT "owner", which on this sheet refers to the requester).
 * Tolerant lookup means any of `closed by` / `Closed By` / `CLOSED BY` /
 * `closed_by` / `closed-by` / `Closed  By` resolves via the same column
 * at runtime (whitespace, case, and `-`/`_` separators are all
 * normalized away in `detectNameColumn`).
 */
export const TASK_AGENT_COLUMN = "closed by";

/**
 * Permanent ignore list for ticket sheet columns. These are dropped during
 * import (not stored in raw_json) so the DB stays compact and the UI never
 * surfaces them.
 */
export const IGNORED_TICKET_COLUMNS: ReadonlySet<string> = new Set([
  "tier",
  "inventory_id",
  "carrier_desc",
  "category",
  "severity",
  "stage",
  "status",
  "owner",
  "owner_initials",
  "owner_role",
  "last_update",
  "due_dtm",
  "opened_by_role",
  "closed_by_name",
  "closed_by_role",
  "add_dtm",
  "closed_dtm",
  "time_spent",
  "is_after_hours_note",
  "count_after_hours_notes",
  "is_chronic_customer",
  "contact_names",
  "channel",
  "opened_by_2",
  "week_opened",
  "mobility",
  "buyers_club_msp_2",
]);

/**
 * Permanent ignore list for inbound call sheets. Most columns in the Zoom
 * Phone export are routing metadata (call IDs, ext numbers, caller email)
 * that we never need for per-agent performance reporting.
 *
 * Kept columns: To Name (agent), To Email (agent email), Operator Name
 * (network/mobility queue), Start Time, Call Result, Duration, Wait Time,
 * Year/Month/Quarter/Day/Hour for slicing.
 */
export const IGNORED_CALL_COLUMNS: ReadonlySet<string> = new Set([
  "NO.",
  "Direction",
  "Call ID",
  "From Name",
  "From Email",
  "From Ext.",
  "From Phone Number",
  "To Ext.",
  "To Phone Number",
  "Operator Ext.",
  "Event",
  "Waiting Time",
  "Avg Handle Time",
]);

/**
 * Friendly display labels for the inbound call columns that ARE kept.
 */
export const CALL_COLUMN_LABELS: Record<string, string> = {
  "To Name": "Agent",
  "To Email": "Agent Email",
  "Operator Name": "Queue",
  "Start Time": "Call Time",
  "Call Result": "Call Result",
  Duration: "Duration",
  "Wait Time": "Speed of Answer",
  Year: "Year",
  Month: "Month",
  Quarter: "Quarter",
  "Day of Week": "Day of Week",
  "Weekend/Weekday": "Weekend vs Weekday",
  "Hour of Day": "Hour of Day",
};

/**
 * Friendly display labels for the ticket columns that ARE kept. Used by
 * the drill-down UI; falls back to the raw column name for anything not
 * listed here (so unknown columns still render, just less polished).
 */
export const TICKET_COLUMN_LABELS: Record<string, string> = {
  trouble_id: "Trouble Ticket Number",
  month: "Month",
  customer: "Customer Name",
  account: "Customer Account",
  regarding: "Circuit ID",
  carrier_summary: "Carrier Name",
  subject: "Ticket Subject",
  type: "Service Type",
  issue: "Issue Type",
  priority: "Ticket Priority",
  next_step: "Next Step",
  resolution: "Resolution",
  opened_by_name: "Opened By",
  carrier_ticket_created: "Carrier Ticket Opened Time",
  time_to_carrier_ticket: "Time to Open Carrier Ticket",
  age: "Ticket Age",
  mttr: "MTTR",
  is_chronic_inventory: "Chronic Circuit",
  first_touch: "Acknowledgement Time",
  first_contact_name: "Ticket Owner",
  reported_via: "NOC vs Mobility",
  buyers_club_msp: "Channel (Wholesale vs MSP)",
  year_opened: "Opened Year",
  day_opened: "Day Opened",
  hour_opened: "Hour Opened",
  weekday_weekend: "Weekend vs Weekday",
  quarter: "Quarter",
  ticket_time_count: "Validity Check",
  time_taken_to_close_tickets: "Closed Within 24h",
  opened_shift: "Opened Shift",
  opened_date: "Opened Date",
  closed_shift: "Closed Shift",
  closed_date: "Closed Date",
  first_touch_bucket: "Acknowledgement Bucket",
  time_interval_bucket: "Time-to-Carrier Bucket",
  consolidate_resolution: "Consolidated Resolution",
  month_label: "Month (Label)",
  consolidated_issue: "Consolidated Issue",
};

export interface SheetInfo {
  /** Original sheet name as it appears in the workbook. */
  name: string;
  /** Best-guess data type based on sheet name + headers. */
  detectedType: SourceType | "unknown";
  /** Best-guess agent-name column header. */
  detectedNameColumn: string | null;
  /** All column headers in order. */
  headers: string[];
  /** First few rows for the preview UI. */
  preview: Record<string, unknown>[];
  /** Total non-empty rows in the sheet. */
  totalRows: number;
  /** Projected match count if imported as-is with the detected name column. */
  projectedMatches: number;
}

export interface SheetPlan {
  sheetName: string;
  sourceType: SourceType | "skip";
  nameColumn: string;
  /** Optional period override (text label) */
  periodLabel?: string;
}

export interface ImportPlan {
  sheets: SheetPlan[];
}

export interface ImportedRow {
  memberName: string;           // canonical
  raw: Record<string, unknown>; // ignored columns already stripped
  summary: SummaryMetrics;
}

export interface SummaryMetrics {
  total_count?: number;
  success_count?: number;
  duration_minutes?: number;
  score?: string;
  period_start?: string;
  period_end?: string;
  // ---- NOC vs Mobility split ----
  queue?: "noc" | "mobility";
  // ---- Normalized period for filtering ----
  period_month?: string;     // "YYYY-MM"
  period_quarter?: string;   // "YYYY-Qn"
  // ---- Source-specific KPI fields ----
  // Tickets
  ack_minutes?: number;            // first_touch in minutes
  carrier_ticket_minutes?: number; // time_to_carrier_ticket in minutes
  // Calls
  handle_seconds?: number;         // Duration in seconds
  wait_seconds?: number;           // Wait Time in seconds
}

export interface ImportSheetResult {
  sheetName: string;
  sourceType: SourceType;
  totalRows: number;
  matchedRows: number;
  skippedRows: number;
  /** Unique skipped agent names (for the warning UI) */
  skippedNames: string[];
  rows: ImportedRow[];
}

export interface ImportResult {
  fileName: string;
  bySheet: ImportSheetResult[];
}

// =============================================================================
// Heuristic detection — sheet name + header inspection
// =============================================================================

const TYPE_PATTERNS: Array<[SourceType, RegExp]> = [
  // Order matters — more-specific patterns first.
  ["audit", /\b(audit|qa|quality|review)\b/i],
  ["queue", /\b(queue|availability|login(?:\s*time)?|status|available)\b/i],
  // Calls: match the standard term OR distinctive Zoom Phone headers
  ["calls", /\b(call|phone|inbound|outbound|talk|ring)\b|call\s*id|from\s*ext|to\s*ext|wait\s*time/i],
  ["tasks", /\btask/i],
  ["tickets", /\bticket|trouble[_ ]?id\b/i],
];

const NAME_COLUMN_PATTERNS: Array<[RegExp, number]> = [
  // [pattern, priority — higher wins]
  // Ticket-specific (highest — these are the canonical NOC fields)
  [/^first[_\s]contact[_\s]name$/i, 200],
  [/^ticket\s*owner$/i, 195],
  // Generic agent identification
  [/^agent\s*name$/i, 100],
  [/^agent$/i, 90],
  [/^assigned\s*to$/i, 90],
  [/^full\s*name$/i, 85],
  [/^user\s*name$/i, 80],
  [/^user$/i, 75],
  [/^assignee$/i, 75],
  [/^owner$/i, 70],
  [/^name$/i, 65],
  [/^operator$/i, 60],
  [/^technician$/i, 60],
  [/^tech$/i, 55],
  [/^representative$/i, 55],
  [/^resource$/i, 50],
  [/^member$/i, 50],
  [/^employee$/i, 50],
  [/^staff$/i, 45],
  [/^caller$/i, 30],
];

export function detectSourceType(
  sheetName: string,
  headers: string[],
): SourceType | "unknown" {
  // Try the sheet name first
  for (const [t, re] of TYPE_PATTERNS) {
    if (re.test(sheetName)) return t;
  }
  // Fallback: scan combined header text
  const headerText = headers.join(" ");
  for (const [t, re] of TYPE_PATTERNS) {
    if (re.test(headerText)) return t;
  }
  return "unknown";
}

/**
 * Pick the best agent column. Hard-pinned columns (Tickets:
 * first_contact_name, Calls: "To Name") always win over the heuristic
 * detector. This is intentional — those columns are guaranteed by the
 * source export and override any user mis-selection.
 */
export function detectNameColumn(
  headers: string[],
  sourceTypeHint?: SourceType | "unknown",
): string | null {
  // Hard pin: ticket sheets ALWAYS use first_contact_name.
  if (headers.includes(TICKET_OWNER_COLUMN)) return TICKET_OWNER_COLUMN;
  // Hard pin: inbound call sheets ALWAYS use "To Name". The header is
  // distinctive enough that we can pin even without the type hint —
  // but require the partner header "From Name" or "Call ID" to be present
  // to avoid false positives on unrelated sheets that happen to have a
  // "To Name" column.
  if (
    headers.includes(CALL_AGENT_COLUMN) &&
    (sourceTypeHint === "calls" ||
      headers.includes("From Name") ||
      headers.includes("Call ID"))
  ) {
    return CALL_AGENT_COLUMN;
  }
  // Hard pin: task sheets attribute each row to the agent via the
  // "Closed By" column. Only applied when the source type is
  // explicitly "tasks" — for ticket sheets, `closed_by_name` is
  // intentionally ignored in favour of first_contact_name (which
  // represents who actually worked the ticket, not who pressed the
  // close button).
  if (sourceTypeHint === "tasks") {
    // Case- and whitespace-tolerant lookup: "closed by" / "Closed By" /
    // "Closed_By" / "closed-by" / "  Closed  By  " all normalize to
    // "closedby" and match.
    const norm = (s: string) =>
      s.toLowerCase().replace(/[\s_-]+/g, "");
    const target = norm(TASK_AGENT_COLUMN);
    for (const h of headers) {
      if (h && norm(String(h)) === target) return h;
    }
  }

  let best: { col: string; pri: number } | null = null;
  for (const h of headers) {
    if (!h) continue;
    for (const [re, pri] of NAME_COLUMN_PATTERNS) {
      if (re.test(String(h).trim())) {
        if (!best || pri > best.pri) best = { col: h, pri };
      }
    }
  }
  return best?.col ?? null;
}

// =============================================================================
// Summary-field extraction (best-effort)
// =============================================================================

function asNumber(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") return isFinite(v) ? v : undefined;
  const s = String(v).replace(/[,\s%]/g, "");
  const n = Number(s);
  return isFinite(n) ? n : undefined;
}

function findValue(row: Record<string, unknown>, patterns: RegExp[]): unknown {
  for (const k of Object.keys(row)) {
    for (const re of patterns) {
      if (re.test(k)) return row[k];
    }
  }
  return undefined;
}

/**
 * Parse the SLA-met flag for task rows (column W on the standard task
 * export). Per the user mapping:
 *   "Y" / "y" / "Yes" / "true" / "1"  →  1  (SLA met)
 *   "N" / "n" / "No"  / "false" / "0" →  0  (SLA missed)
 *   blank / anything else              →  undefined  (excluded from KPI)
 *
 * Returning undefined for blanks means the aggregation excludes those
 * rows from BOTH the numerator and denominator of "SLA-Met %" — the
 * same approach used for the within-24h ticket KPI.
 */
function parseSlaMet(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v ? 1 : 0;
  const s = String(v).trim().toLowerCase();
  if (!s) return undefined;
  if (s === "y" || s === "yes" || s === "true" || s === "1" || s === "met") {
    return 1;
  }
  if (
    s === "n" ||
    s === "no" ||
    s === "false" ||
    s === "0" ||
    s === "not met" ||
    s === "missed"
  ) {
    return 0;
  }
  return undefined;
}

/**
 * Parse the `time_taken_to_close_tickets` column (column BD on the
 * standard ticket export) into a within-24h flag.
 *
 * Per user mapping: the column contains text buckets like:
 *   "less than 24 hours"   → 1  (closed within 24h, counted as success)
 *   "more than 24 hours"   → 0  (took longer than a day, counted as miss)
 *   "greater than 24 hours" → 0
 *   "over 24 hours"        → 0
 *
 * We also keep tolerant fallbacks for the other common shapes seen in
 * the wild (Yes/No, 1/0, booleans, "Within 24h", etc.) so that legacy
 * sheets and one-off variations still resolve correctly.
 *
 * Returns 1 / 0, or undefined when the cell is blank / unrecognised so
 * the aggregation skips that row rather than guessing.
 */
function parseWithin24h(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v ? 1 : 0;
  const s = String(v).trim().toLowerCase();
  if (!s) return undefined;

  // ---- Primary mapping: "less than" / "more than" / "greater than" 24h ----
  // Checked FIRST so the longer phrases win over shorter substrings
  // (e.g. "less than 24 hours" must not be mistaken for "less" alone).
  if (/\b(less\s*than|under|below)\b.*\b24\b/.test(s)) return 1;
  if (/\b(more\s*than|greater\s*than|over|above|>=?|exceed)\b.*\b24\b/.test(s)) return 0;

  // ---- Generic Yes/No-style fallbacks ----
  if (
    s === "yes" ||
    s === "y" ||
    s === "true" ||
    s === "1" ||
    s === "closed" ||
    /\bwithin\b/.test(s)
  ) {
    return 1;
  }
  if (
    s === "no" ||
    s === "n" ||
    s === "false" ||
    s === "0" ||
    /\bover\b/.test(s) ||
    /\bnot\s+closed\b/.test(s)
  ) {
    return 0;
  }
  return undefined;
}

/**
 * MTTR may be stored as hours (small numbers, typical NOC range) OR
 * minutes (large numbers). Heuristic: < 24 → hours, otherwise minutes.
 * We normalize to minutes for storage so it sums consistently.
 */
function parseMttrMinutes(v: unknown): number | undefined {
  const n = asNumber(v);
  if (n == null) return undefined;
  return n < 24 ? Math.round(n * 60) : Math.round(n);
}

/**
 * Parse a Zoom Phone duration / wait-time value into seconds.
 *
 * Zoom Phone exports values in two formats:
 *   - HH:MM:SS or MM:SS string  → "00:02:15", "1:42"
 *   - seconds number            → 135
 *
 * Returns total seconds, or undefined if unparseable / zero.
 */
function parseDurationSeconds(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") {
    if (!isFinite(v) || v < 0) return undefined;
    return Math.round(v);
  }
  const s = String(v).trim();
  if (!s) return undefined;
  // HH:MM:SS or MM:SS
  if (/^\d{1,3}(:\d{1,2}){1,2}(\.\d+)?$/.test(s)) {
    const parts = s.split(":").map((p) => parseFloat(p));
    if (parts.some((p) => !isFinite(p))) return undefined;
    let total = 0;
    if (parts.length === 3) total = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) total = parts[0] * 60 + parts[1];
    else total = parts[0];
    return Math.round(total);
  }
  // Plain number fallback
  const n = Number(s);
  if (isFinite(n) && n >= 0) return Math.round(n);
  return undefined;
}

/**
 * Classify a Zoom Phone Call Result string into one of three outcomes:
 *
 *   "Answered" / "Connected" / "Picked up" / "Completed" → "answered"
 *     The agent picked up and handled the call.
 *
 *   "No Answer (Answered by Other)"                       → "refused"
 *     The call rang to this agent but they didn't pick up — another
 *     agent or overflow queue handled it. The user calls these
 *     "Refused Calls" in the dashboard.
 *
 *   "Missed" / "Voicemail" / "Abandoned" / "Hangup" / etc → "missed"
 *     Not answered by anyone (caller abandoned, went to VM, etc.).
 *
 *   Anything else / blank                                 → null
 */
export type CallOutcome = "answered" | "refused" | "missed";

function classifyCallResult(v: unknown): CallOutcome | null {
  if (v == null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  // "No Answer (Answered by Other)" — match the distinctive phrasing FIRST
  // (before the generic "answered" pattern), since the literal string
  // contains the word "answered" too.
  if (/\bno\s*answer\b/.test(s) || /\banswered\s*by\s*other\b/.test(s)) {
    return "refused";
  }
  if (
    /\bconnected\b/.test(s) ||
    /\banswered\b/.test(s) ||
    /\bpicked\s*up\b/.test(s) ||
    /\bcompleted\b/.test(s) ||
    /\bhandled\b/.test(s)
  ) {
    return "answered";
  }
  if (
    /\bmiss/.test(s) ||
    /\babandon/.test(s) ||
    /\bvoicemail\b/.test(s) ||
    /\bvm\b/.test(s) ||
    /\bhangup\b/.test(s) ||
    /\bhung\s*up\b/.test(s) ||
    /\bcancel/.test(s) ||
    /\brejected\b/.test(s)
  ) {
    return "missed";
  }
  return null;
}

/**
 * Parse a duration field as MINUTES.
 *
 * Accepts:
 *   - HH:MM:SS or MM:SS strings → converted to minutes
 *   - Plain numbers              → assumed to already be in minutes
 *   - Decimal strings ("5.5")    → minutes
 *
 * Returns undefined if the value is blank or unparseable. CRITICAL: blank
 * cells must return undefined (not 0) — the dashboard relies on this to
 * exclude them from the denominator of avg/percentage calculations.
 */
function parseAsMinutes(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") {
    return isFinite(v) && v >= 0 ? v : undefined;
  }
  const s = String(v).trim();
  if (!s) return undefined;
  // HH:MM:SS or MM:SS → convert to minutes
  if (/^\d{1,3}(:\d{1,2}){1,2}(\.\d+)?$/.test(s)) {
    const parts = s.split(":").map((p) => parseFloat(p));
    if (parts.some((p) => !isFinite(p))) return undefined;
    let secs = 0;
    if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) secs = parts[0] * 60 + parts[1];
    else secs = parts[0] * 60; // single number — treat as minutes already
    return Math.round((secs / 60) * 100) / 100; // 2-decimal minutes
  }
  // Plain decimal
  const n = Number(s);
  if (isFinite(n) && n >= 0) return n;
  return undefined;
}

/**
 * Map an "Operator Name" value (calls) or "reported_via" value (tickets)
 * to a canonical queue identifier. Returns null for blank / unknown so
 * the dashboard can decide whether to count those rows.
 */
function parseQueue(v: unknown): "noc" | "mobility" | undefined {
  if (v == null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (!s) return undefined;
  // Mobility match first — "Mobility Tech Support" contains the same
  // "Tech Support" suffix that Network Tech Support uses, so we need to
  // be specific.
  if (/\bmobility\b/.test(s)) return "mobility";
  if (/\bnetwork\b/.test(s) || /^noc\b/.test(s) || /\bnoc\b/.test(s)) {
    return "noc";
  }
  return undefined;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Extract YYYY-MM from a JS Date object directly. cellDates:true on the
 * SheetJS read means many "date" columns arrive as real Date objects
 * (not strings), so we MUST handle them natively before any text parsing
 * — otherwise `String(dateObj)` produces "Thu Jan 01 2026..." which
 * doesn't match the ISO regex and falls through.
 */
function ymFromDate(v: unknown): string | undefined {
  if (!(v instanceof Date)) return undefined;
  if (isNaN(v.getTime())) return undefined;
  const y = v.getFullYear();
  const m = v.getMonth() + 1; // getMonth() is 0-indexed
  if (y < 1900 || y > 2200 || m < 1 || m > 12) return undefined;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/**
 * Parse a month "number" from a cell value. Accepts:
 *   - Date object → extract month
 *   - Plain number 1..12
 *   - String "1".."12" or "01".."12"
 *   - Month name "January" / "Jan" / "Jul" / "Sept"
 *
 * Returns undefined for anything else (so we don't silently misinterpret
 * a date string like "8/15/2025" as month 8 — that string would `Number()`
 * to NaN and slice(0,3)="8/1" which isn't in MONTH_NAMES).
 */
function parseMonthNumber(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return undefined;
    return v.getMonth() + 1;
  }
  if (typeof v === "number" && v >= 1 && v <= 12) return Math.round(v);
  const s = String(v).trim();
  if (!s) return undefined;
  const n = Number(s);
  if (isFinite(n) && n >= 1 && n <= 12) return Math.round(n);
  // "September", "Sep", "Sept" — but only if the first 3 letters spell a
  // valid month name. This rejects "8/1" / "01-" / similar garbage.
  const first3 = s.slice(0, 3).toLowerCase();
  if (/^[a-z]{3}$/.test(first3) && MONTH_NAMES[first3]) {
    return MONTH_NAMES[first3];
  }
  return undefined;
}

/** Parse a 4-digit year from a cell. Handles Date objects and number/string. */
function parseYearNumber(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return undefined;
    return v.getFullYear();
  }
  const n = asNumber(v);
  if (n != null && n >= 1900 && n <= 2200) return Math.round(n);
  // String like "2025" or "FY2025"
  const m = /\b(\d{4})\b/.exec(String(v));
  if (m) {
    const y = Number(m[1]);
    if (y >= 1900 && y <= 2200) return y;
  }
  return undefined;
}

/**
 * Match unambiguous month-label strings:
 *   "2025-09", "2025-09-15..."        (ISO — only safe format)
 *   "Sep 2025", "September 2025"      (month name + year)
 *
 * Deliberately does NOT match "8/1/2025" style strings — those are
 * locale-ambiguous (could be M/D or D/M) and would cause exactly the
 * "Aug 2025 instead of Jan 2026" bug we just fixed.
 */
function matchYearMonth(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  // Date objects: handle FIRST so `String(dateObj)` formatting can't
  // accidentally match any of the patterns below.
  const fromDate = ymFromDate(v);
  if (fromDate) return fromDate;
  const s = String(v).trim();
  if (!s) return undefined;
  // "2025-09" or "2025-09-15..." — strictly ISO-prefixed
  const isoM = /^(\d{4})-(\d{2})\b/.exec(s);
  if (isoM) {
    const y = Number(isoM[1]);
    const m = Number(isoM[2]);
    if (y >= 1900 && y <= 2200 && m >= 1 && m <= 12) {
      return `${isoM[1]}-${isoM[2]}`;
    }
  }
  // "Sep 2025" / "September 2025" / "Jan-2026"
  const nameM = /^([A-Za-z]+)[\s\-/]+(\d{4})$/.exec(s);
  if (nameM) {
    const mn = MONTH_NAMES[nameM[1].slice(0, 3).toLowerCase()];
    if (mn) return `${nameM[2]}-${String(mn).padStart(2, "0")}`;
  }
  // "2025-Sep" / "2025/Jan"
  const yNameM = /^(\d{4})[\s\-/]+([A-Za-z]+)$/.exec(s);
  if (yNameM) {
    const mn = MONTH_NAMES[yNameM[2].slice(0, 3).toLowerCase()];
    if (mn) return `${yNameM[1]}-${String(mn).padStart(2, "0")}`;
  }
  return undefined;
}

/**
 * Tolerant key lookup. Excel files vary wildly in header conventions:
 *   "month_label" / "Month Label" / "Month_Label" / "MONTH_LABEL" /
 *   "  month_label  " / "monthLabel" — all common in the wild.
 *
 * Normalizes both the search keys AND the row keys to a comparison form
 * (lowercase, strip non-alphanumerics) and returns the first matching
 * value. Returns undefined if no key matches.
 */
function lookupTolerant(
  row: Record<string, unknown>,
  ...searchKeys: string[]
): unknown {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const targets = new Set(searchKeys.map(norm));
  for (const k of Object.keys(row)) {
    if (targets.has(norm(k))) {
      const v = row[k];
      if (v != null && v !== "") return v;
    }
  }
  return undefined;
}

/**
 * Excel stores dates as days-since-1900 (with the 1900 leap-year bug).
 * Serial 1 = 1900-01-01, serial 60 = 1900-02-29 (the fake leap day),
 * serial 25569 = 1970-01-01 (Unix epoch).
 *
 * Range filter (25000 – 60000) covers years 1968 → 2064. Below that
 * could be a real number, above could be a count/duration. This is the
 * sweet spot for "this is almost certainly a date".
 */
function parseExcelSerialDate(v: unknown): Date | undefined {
  if (typeof v !== "number" || !isFinite(v)) return undefined;
  if (v < 25000 || v > 60000) return undefined;
  // Excel's epoch is 1899-12-30 (accounting for the leap-year bug)
  const ms = (v - 25569) * 86400 * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return undefined;
  return d;
}

/**
 * Tolerant parser for ticket month cells. Used for both the primary
 * `month` column (column B) and the legacy `month_label` (column AC)
 * fallback. Tries every realistic format and, when only a month is
 * given, uses the provided yearHint (from year_opened / Year / year
 * columns ONLY — opened_date is deliberately NOT consulted, per user
 * requirement that month selection comes from the explicit month
 * columns, not from any inferred date).
 *
 * Formats accepted:
 *   - Date object                                  → ymFromDate
 *   - "2026-04", "2026-04-01..."                   → ISO
 *   - "Apr 2026", "April 2026", "Apr-2026"         → name + 4-digit year
 *   - "Apr 26", "Apr-26", "Apr/26"                 → name + 2-digit year (pivot at 70)
 *   - "2026-Apr", "26-Apr"                         → year-first
 *   - "April", "Apr"                               → name only + yearHint
 *   - "4", 4                                        → bare month + yearHint
 *   - "04-2026", "4/2026"                          → MM-YYYY (must have 4-digit year)
 */
function parseLabelLoose(
  v: unknown,
  yearHint: number | undefined,
): string | undefined {
  if (v == null || v === "") return undefined;
  // Date objects → safe via getFullYear/getMonth
  const fromDate = ymFromDate(v);
  if (fromDate) return fromDate;

  // Excel serial date numbers (e.g. 45748 = 2025-04-13)
  if (typeof v === "number") {
    const d = parseExcelSerialDate(v);
    if (d) return ymFromDate(d);
    // Bare month number 1..12 with year hint
    if (v >= 1 && v <= 12 && yearHint != null) {
      return `${yearHint}-${String(Math.floor(v)).padStart(2, "0")}`;
    }
    return undefined;
  }

  const s = String(v).trim();
  if (!s) return undefined;

  // ISO datetime: "2026-04-15T00:00:00.000Z"
  const isoDateTimeM = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s);
  if (isoDateTimeM) {
    const y = Number(isoDateTimeM[1]);
    const m = Number(isoDateTimeM[2]);
    if (y >= 1900 && y <= 2200 && m >= 1 && m <= 12) {
      return `${isoDateTimeM[1]}-${isoDateTimeM[2]}`;
    }
  }

  // Strict matchers (existing behaviour, won't misfire)
  const strict = matchYearMonth(s);
  if (strict) return strict;

  // ---- 2-digit-year formats: "Apr 25", "Apr-25", "Apr/26", "25-Apr" ----
  const expandYear = (yy: number) => (yy >= 70 ? 1900 + yy : 2000 + yy);
  let m = /^([A-Za-z]+)[\s\-/.]+(\d{2})$/.exec(s);
  if (m) {
    const mn = MONTH_NAMES[m[1].slice(0, 3).toLowerCase()];
    const yy = Number(m[2]);
    if (mn && yy >= 0 && yy <= 99) {
      const y = expandYear(yy);
      return `${y}-${String(mn).padStart(2, "0")}`;
    }
  }
  m = /^(\d{2})[\s\-/.]+([A-Za-z]+)$/.exec(s);
  if (m) {
    const mn = MONTH_NAMES[m[2].slice(0, 3).toLowerCase()];
    const yy = Number(m[1]);
    if (mn && yy >= 0 && yy <= 99) {
      const y = expandYear(yy);
      return `${y}-${String(mn).padStart(2, "0")}`;
    }
  }

  // ---- 4-digit year formats with various separators ----
  // "Apr-2026", "Apr.2026", "Apr/2026" — handled by matchYearMonth, but
  // matchYearMonth doesn't allow "." separator. Add explicit support here.
  m = /^([A-Za-z]+)[\s\-/.]+(\d{4})$/.exec(s);
  if (m) {
    const mn = MONTH_NAMES[m[1].slice(0, 3).toLowerCase()];
    const y = Number(m[2]);
    if (mn && y >= 1900 && y <= 2200) {
      return `${y}-${String(mn).padStart(2, "0")}`;
    }
  }
  m = /^(\d{4})[\s\-/.]+([A-Za-z]+)$/.exec(s);
  if (m) {
    const mn = MONTH_NAMES[m[2].slice(0, 3).toLowerCase()];
    const y = Number(m[1]);
    if (mn && y >= 1900 && y <= 2200) {
      return `${y}-${String(mn).padStart(2, "0")}`;
    }
  }

  // ---- Numeric MM-YYYY / M/YYYY / MM.YYYY ----
  m = /^(\d{1,2})[\s\-/.](\d{4})$/.exec(s);
  if (m) {
    const mm = Number(m[1]);
    const y = Number(m[2]);
    if (mm >= 1 && mm <= 12 && y >= 1900 && y <= 2200) {
      return `${y}-${String(mm).padStart(2, "0")}`;
    }
  }
  // ---- YYYY-MM where MM is 1-digit: "2026-4", "2026.4" ----
  m = /^(\d{4})[\s\-/.](\d{1,2})$/.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mm = Number(m[2]);
    if (mm >= 1 && mm <= 12 && y >= 1900 && y <= 2200) {
      return `${y}-${String(mm).padStart(2, "0")}`;
    }
  }

  // ---- DMY format: "DD-MM-YYYY" — only when D > 12 (unambiguous) ----
  m = /^(\d{1,2})[\s\-/.](\d{1,2})[\s\-/.](\d{4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    if (y >= 1900 && y <= 2200) {
      // If first number > 12, it must be the day → second is month (DMY)
      if (a > 12 && b >= 1 && b <= 12) {
        return `${y}-${String(b).padStart(2, "0")}`;
      }
      // If second > 12, first is month (MDY)
      if (b > 12 && a >= 1 && a <= 12) {
        return `${y}-${String(a).padStart(2, "0")}`;
      }
      // Ambiguous (both ≤ 12) — assume MDY (US default in Excel)
      if (a >= 1 && a <= 12) {
        return `${y}-${String(a).padStart(2, "0")}`;
      }
    }
  }

  // ---- 2-digit-year MDY/DMY: "1/1/26", "12/31/26", "1-1-26" ----
  // Excel often stores M/D/YYYY-formatted cells with a 2-digit year
  // value internally even when the display shows "1/1/2026". Mirror
  // the same disambiguation logic as the 4-digit branch:
  //   - first > 12 → DMY  (day is the first number)
  //   - second > 12 → MDY (day is the second number)
  //   - both ≤ 12 → assume MDY (US default in Excel)
  // 2-digit years: 70..99 → 1970..1999, 00..69 → 2000..2069.
  m = /^(\d{1,2})[\s\-/.](\d{1,2})[\s\-/.](\d{2})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const yy = Number(m[3]);
    const y = expandYear(yy);
    if (a > 12 && b >= 1 && b <= 12) {
      return `${y}-${String(b).padStart(2, "0")}`;
    }
    if (b > 12 && a >= 1 && a <= 12) {
      return `${y}-${String(a).padStart(2, "0")}`;
    }
    if (a >= 1 && a <= 12) {
      return `${y}-${String(a).padStart(2, "0")}`;
    }
  }

  // ---- Month-name only ("April", "Apr") — needs yearHint ----
  if (/^[A-Za-z]+$/.test(s)) {
    const mn = MONTH_NAMES[s.slice(0, 3).toLowerCase()];
    if (mn && yearHint != null) {
      return `${yearHint}-${String(mn).padStart(2, "0")}`;
    }
  }

  // ---- Bare month number 1..12 — needs yearHint ----
  if (/^\d{1,2}$/.test(s)) {
    const mm = Number(s);
    if (mm >= 1 && mm <= 12 && yearHint != null) {
      return `${yearHint}-${String(mm).padStart(2, "0")}`;
    }
  }

  return undefined;
}

/**
 * Normalize a month value to "YYYY-MM". The source-type matters:
 *
 *   TICKETS:  PRIMARY source is the `month` column (column B in the
 *             standard ticket sheet layout). `month_label` (column AC)
 *             is kept as a fallback for older imports that may not have
 *             a parseable column B value. Any date column on the row
 *             (opened_date / closed_date / add_dtm) is IGNORED for the
 *             purpose of month selection. If neither column B nor
 *             month_label resolves, the row is excluded from period
 *             aggregations (returns undefined).
 *
 *   CALLS:    no month_label column exists in Zoom Phone exports; use
 *             the explicit numeric Year + Month columns.
 *
 * PRIORITY ORDER (TICKETS):
 *   1. `month` column (column B) — handles "3/1/2026", bare month
 *      numbers, Date objects, Excel serial dates, etc. via
 *      parseLabelLoose + parseMonthNumber, combined with year_opened.
 *   2. `month_label` (column AC) — fallback for legacy/edge data.
 *   3. (nothing — opened_date is intentionally NEVER consulted)
 *
 * PRIORITY ORDER (CALLS):
 *   1. Explicit numeric Year + Month combo
 *   2. Text formats in Month / Month Label
 *   3. Date object from Start Time (calls only, not tickets)
 *
 * Year-hint for tickets: used to complete a partial month value (just
 * a month name "Apr" or a bare number "4"). Drawn from explicit Year /
 * year_opened / year columns only. opened_date.getFullYear() is
 * intentionally NOT used here.
 */
function parsePeriodMonth(
  row: Record<string, unknown>,
  type: SourceType,
): string | undefined {
  if (type === "tickets") {
    // Year hint for any partial source — explicit year columns only.
    // opened_date is NEVER consulted (per user requirement).
    const yearHint = parseYearNumber(
      lookupTolerant(row, "year_opened", "Year", "year"),
    );

    // ---- Strategy 1 (PRIMARY): `month` column (column B) ----
    // Per the user's mapping, column B is the `month` column and is
    // the authoritative source going forward. Tolerant lookup so any
    // header variant works (Month, MONTH, " month ").
    const monthB = lookupTolerant(row, "month", "Month");
    if (monthB != null && String(monthB).trim() !== "") {
      // First, try parsing the value standalone (handles "3/1/2026",
      // "Apr 2026", "2026-04", Date objects, Excel serial dates, etc.)
      const monthBLabel = parseLabelLoose(monthB, yearHint);
      if (monthBLabel) return monthBLabel;
      // Otherwise treat it as a bare month number / name and combine
      // with the year hint from year_opened.
      const monthN = parseMonthNumber(monthB);
      if (monthN != null && yearHint != null) {
        return `${yearHint}-${String(monthN).padStart(2, "0")}`;
      }
    }

    // ---- Strategy 2 (FALLBACK): month_label (column AC) ----
    // Kept for backwards compatibility with older imports / edge cases
    // where column B is blank or has an unparseable value.
    const labelRaw = lookupTolerant(row, "month_label", "Month Label");
    if (labelRaw != null && String(labelRaw).trim() !== "") {
      const fromLabel = parseLabelLoose(labelRaw, yearHint);
      if (fromLabel) return fromLabel;
    }

    return undefined;
  }

  // ---- Calls / Tasks / generic ----
  // Task sheets use the same Zoom-style format as the inbound call
  // export (per the user) — explicit numeric Year + Month columns,
  // plus a Month text column and a Start Time/Date column. Falling
  // through to the same strategy chain handles every variant
  // automatically: Strategy 1 catches "Year=2026, Month=4", Strategy 2
  // catches "3/1/2026" / "Apr 2026" / Date objects in Month, and
  // Strategy 3 catches Date objects in Start Time / opened_date.
  // The Month column (column T in the Zoom Phone export) contains a
  // surprisingly wide variety of formats in the wild:
  //   - Full M/D/YYYY date strings like "3/1/2026"      (most common!)
  //   - Date objects when cellDates:true expands them
  //   - Bare month names like "March" / "Mar"
  //   - Bare numbers 1..12
  //   - ISO "2026-03" / "2026-03-15..."
  //
  // To handle ALL of these uniformly, we feed the value through
  // parseLabelLoose first — it knows MDY format and Date objects. Only
  // if that fails do we fall back to parseMonthNumber (which expects a
  // bare month number or name) combined with a Year hint.

  // Year hint — used by the bare-number fallback. Drawn from explicit
  // Year columns first, then derived from Start Time if needed.
  const yearHintCalls = (() => {
    const explicit = parseYearNumber(
      lookupTolerant(row, "Year", "year", "year_opened"),
    );
    if (explicit != null) return explicit;
    const startTime = lookupTolerant(row, "Start Time");
    if (startTime instanceof Date && !isNaN(startTime.getTime())) {
      return startTime.getFullYear();
    }
    if (startTime != null) {
      const m = /^(\d{4})-/.exec(String(startTime));
      if (m) return Number(m[1]);
    }
    return undefined;
  })();

  // Strategy 1: try every plausible month column through parseLabelLoose,
  // which knows MM/DD/YYYY, "Apr 2026", Date objects, ISO, Excel serial
  // dates, etc. We check `Month`/`month` first (column T on call sheets,
  // primary on tickets), then `Month Label`/`month_label` (column AD on
  // task sheets — per the user, MM/DD/YYYY format lives here).
  for (const monthRaw of [
    lookupTolerant(row, "Month", "month"),
    lookupTolerant(row, "Month Label", "month_label"),
  ]) {
    if (monthRaw == null || String(monthRaw).trim() === "") continue;
    const fromLoose = parseLabelLoose(monthRaw, yearHintCalls);
    if (fromLoose) return fromLoose;
    const monthN = parseMonthNumber(monthRaw);
    if (monthN != null && yearHintCalls != null) {
      return `${yearHintCalls}-${String(monthN).padStart(2, "0")}`;
    }
  }
  // Strategy 2: strict YYYY-MM substring match as a last text-format
  // fallback (matchYearMonth is more conservative than parseLabelLoose).
  for (const c of [
    lookupTolerant(row, "Month", "month"),
    lookupTolerant(row, "Month Label", "month_label"),
  ]) {
    const m = matchYearMonth(c);
    if (m) return m;
  }
  // Strategy 3: Date object from Start Time / opened_date
  for (const k of ["Start Time", "opened_date", "add_dtm", "closed_date"]) {
    const v = lookupTolerant(row, k);
    if (v == null || v === "") continue;
    const fromDate = ymFromDate(v);
    if (fromDate) return fromDate;
    const m = /^(\d{4})-(\d{2})\b/.exec(String(v));
    if (m) {
      const y = Number(m[1]);
      const mm = Number(m[2]);
      if (y >= 1900 && y <= 2200 && mm >= 1 && mm <= 12) {
        return `${m[1]}-${m[2]}`;
      }
    }
  }

  return undefined;
}

/**
 * Derive "YYYY-Qn" from row data. Prefers an explicit quarter column;
 * falls back to computing from period_month.
 */
function parsePeriodQuarter(
  row: Record<string, unknown>,
  periodMonth: string | undefined,
): string | undefined {
  const explicit = row["quarter"] ?? row["Quarter"];
  if (explicit != null && explicit !== "") {
    const s = String(explicit).trim();
    // "2025-Q3" → keep
    if (/^\d{4}-Q[1-4]$/i.test(s)) return s.toUpperCase();
    // "Q3" or "3" with the year coming from period_month or Year column
    const qM = /^Q?([1-4])$/i.exec(s);
    if (qM) {
      const year =
        (periodMonth ? periodMonth.slice(0, 4) : null) ??
        (asNumber(row["year_opened"]) ?? asNumber(row["Year"]))?.toString();
      if (year) return `${year}-Q${qM[1]}`;
    }
  }
  // Compute from period_month
  if (periodMonth) {
    const m = /^(\d{4})-(\d{2})$/.exec(periodMonth);
    if (m) {
      const monthN = parseInt(m[2], 10);
      const q = Math.ceil(monthN / 3);
      return `${m[1]}-Q${q}`;
    }
  }
  return undefined;
}

export function extractSummary(
  row: Record<string, unknown>,
  type: SourceType,
): SummaryMetrics {
  const out: SummaryMetrics = {};

  // Common period detection
  const periodStart = findValue(row, [
    /^period\s*start$/i,
    /^start\s*date$/i,
    /^from$/i,
    /^date\s*from$/i,
  ]);
  const periodEnd = findValue(row, [
    /^period\s*end$/i,
    /^end\s*date$/i,
    /^to$/i,
    /^date\s*to$/i,
  ]);
  if (periodStart) out.period_start = String(periodStart);
  if (periodEnd) out.period_end = String(periodEnd);

  if (type === "tickets") {
    // For tickets, each row IS one ticket acknowledged by the Ticket Owner
    // (first_contact_name). The user-defined KPIs are:
    //   • Tickets Acked    = count of rows per agent/month (= sum of total_count)
    //   • Avg Ack Time     = mean of ack_minutes (parsed from first_touch)
    //   • Time to open w/ carrier (% under 15) = (count of carrier_ticket_minutes
    //                          in [0,15]) / (count of NON-NULL carrier_ticket_minutes)
    //   • Within 24h       = sum of success_count
    //   • MTTR             = mean of duration_minutes (kept as MTTR in minutes)
    out.total_count = 1;

    // Within-24h flag. CRITICAL: leave undefined (not 0) when the source
    // cell is blank, so the aggregation excludes that row from BOTH the
    // numerator AND denominator of the "% within 24h" KPI. Counting
    // blanks as 0 would inflate the denominator (still-open tickets
    // incorrectly drag the % down).
    //
    // Use tolerant lookup so header variations don't silently miss:
    //   "time_taken_to_close_tickets" / "Time Taken to Close Tickets" /
    //   "TIME_TAKEN_TO_CLOSE_TICKETS" / etc.
    const within24 = parseWithin24h(
      lookupTolerant(
        row,
        "time_taken_to_close_tickets",
        "Time Taken to Close Tickets",
      ),
    );
    if (within24 != null) out.success_count = within24;

    const mttr = parseMttrMinutes(row["mttr"]);
    if (mttr != null) out.duration_minutes = mttr;

    // first_touch — acknowledgement time. Could be HH:MM:SS or minutes.
    const ack = parseAsMinutes(row["first_touch"]);
    if (ack != null) out.ack_minutes = ack;

    // time_to_carrier_ticket — minutes. CRITICAL: stays undefined for
    // blank cells so the "% under 15" denominator excludes them.
    const carrier = parseAsMinutes(row["time_to_carrier_ticket"]);
    if (carrier != null) out.carrier_ticket_minutes = carrier;

    // Queue split — reported_via column
    const queue = parseQueue(row["reported_via"]);
    if (queue) out.queue = queue;

    // Priority shown on the recent-tickets table
    const priority = row["priority"];
    if (priority != null && priority !== "") out.score = String(priority);

    if (row["opened_date"]) out.period_start = String(row["opened_date"]);
    if (row["closed_date"]) out.period_end = String(row["closed_date"]);

    out.period_month = parsePeriodMonth(row, "tickets");
    out.period_quarter = parsePeriodQuarter(row, out.period_month);
  } else if (type === "calls") {
    // Inbound call log row (Zoom Phone export). One row = one call.
    //
    // User-defined KPIs:
    //   • Inbound Calls (Answered)  = count of "Answered"/"Connected" calls
    //   • Refused Calls             = count of "No Answer (Answered by Other)"
    //   • Avg Handle Time           = mean of handle_seconds (from Duration)
    //   • Avg Speed of Answer       = mean of wait_seconds (from Wait Time)
    //
    // total_count stays at 1 per row so summing equals total calls received,
    // independent of outcome. success_count is the answered count for
    // backward compat with the generic dashboard cards.
    out.total_count = 1;

    const outcome = classifyCallResult(row["Call Result"]);
    out.success_count = outcome === "answered" ? 1 : 0;

    const handleSec = parseDurationSeconds(row["Duration"]);
    if (handleSec != null) out.handle_seconds = handleSec;

    const waitSec = parseDurationSeconds(row["Wait Time"]);
    if (waitSec != null) {
      out.wait_seconds = waitSec;
      // Keep duration_minutes filled too (in fractional minutes) so legacy
      // generic-card UI still has something to display.
      out.duration_minutes = Math.round((waitSec / 60) * 100) / 100;
    }

    // Queue split — Operator Name column
    const queue = parseQueue(row["Operator Name"]);
    if (queue) out.queue = queue;

    const callResult = row["Call Result"];
    if (callResult != null && callResult !== "") {
      out.score = String(callResult);
    }
    if (row["Start Time"]) out.period_start = String(row["Start Time"]);

    out.period_month = parsePeriodMonth(row, "calls");
    out.period_quarter = parsePeriodQuarter(row, out.period_month);
  } else if (type === "tasks") {
    // Per the user mapping, one task sheet row IS one task. The two
    // KPIs they care about are:
    //   • Total Tasks Worked per Month  = count of rows per agent/month
    //   • SLA-Met %                     = (rows where col W = "Y") /
    //                                     (rows where col W = "Y" or "N")
    //                                     × 100
    //
    // total_count stays at 1 per row so summing rowCount in the bucket
    // gives the task volume directly. success_count is left undefined
    // when col W is blank, so the aggregator excludes those rows from
    // the SLA denominator (same pattern as the within-24h ticket KPI).
    out.total_count = 1;

    // SLA-Met column — column W on the standard task export. Per the
    // user, this column contains "Y" or "N". We first try the strict
    // tolerant lookup for common explicit names, then fall back to a
    // BROAD scan that picks up any column header containing "sla"
    // (e.g. "SLA Met", "SLA Status", "Met SLA", "Within SLA", "SLA?",
    // "MetSLA", "sla_indicator", etc.) — but only if the value in that
    // column actually parses as a Y/N flag. This avoids accidentally
    // matching SLA-duration columns (which would carry minutes/hours,
    // not Y/N).
    let slaRaw: unknown = lookupTolerant(
      row,
      "sla_met",
      "SLA Met",
      "SLA",
      "sla",
      "sla met",
      "met_sla",
      "Met SLA",
      "within_sla",
      "Within SLA",
      "sla_indicator",
    );
    if (parseSlaMet(slaRaw) == null) {
      // Broad fallback: ANY column with "sla" in the header whose
      // value parses cleanly as Y/N.
      for (const k of Object.keys(row)) {
        if (!/sla/i.test(k)) continue;
        const v = row[k];
        if (parseSlaMet(v) != null) {
          slaRaw = v;
          break;
        }
      }
    }
    const sla = parseSlaMet(slaRaw);
    if (sla != null) out.success_count = sla;

    // Queue split — task sheets follow the same Zoom-style format as
    // the inbound call export, so `Operator Name` carries the NOC /
    // Mobility queue. Tolerant lookup catches case + whitespace
    // variants. If the column isn't present the task still imports,
    // just without a queue tag (filters that select a specific queue
    // will exclude it).
    const queue = parseQueue(
      lookupTolerant(row, "Operator Name", "operator_name", "operator name"),
    );
    if (queue) out.queue = queue;

    // Preserve Start Time as the row's period_start so the recent-rows
    // table can display it.
    const startTime = lookupTolerant(row, "Start Time", "start_time");
    if (startTime != null && startTime !== "") {
      out.period_start = String(startTime);
    }

    out.period_month = parsePeriodMonth(row, "tasks");
    out.period_quarter = parsePeriodQuarter(row, out.period_month);
  } else if (type === "queue") {
    out.duration_minutes = asNumber(
      findValue(row, [
        /login\s*time/i,
        /available\s*time/i,
        /online\s*minutes/i,
        /^minutes$/i,
      ]),
    );
    const avail = findValue(row, [
      /^availability$/i,
      /available\s*%/i,
      /^avail$/i,
      /available\s*pct/i,
      /^utilization$/i,
    ]);
    if (avail != null) out.score = String(avail);
  } else if (type === "audit") {
    out.total_count = asNumber(
      findValue(row, [
        /^audits$/i,
        /audit\s*count/i,
        /^reviewed$/i,
        /^count$/i,
      ]),
    );
    out.success_count = asNumber(
      findValue(row, [
        /^passed$/i,
        /^pass$/i,
        /^passing$/i,
      ]),
    );
    const score = findValue(row, [
      /audit\s*score/i,
      /qa\s*score/i,
      /^score$/i,
      /^quality$/i,
    ]);
    if (score != null) out.score = String(score);
  }
  return out;
}

/**
 * Strip ignored columns from a row before it gets persisted. Ticket sheets
 * use IGNORED_TICKET_COLUMNS, inbound call sheets use IGNORED_CALL_COLUMNS.
 * Other source types pass through unchanged (their schemas are user-defined
 * and don't have a fixed ignore list yet).
 */
function stripIgnored(
  row: Record<string, unknown>,
  type: SourceType,
): Record<string, unknown> {
  const ignored =
    type === "tickets"
      ? IGNORED_TICKET_COLUMNS
      : type === "calls"
        ? IGNORED_CALL_COLUMNS
        : null;
  if (!ignored) return row;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    if (ignored.has(k)) continue;
    out[k] = row[k];
  }
  return out;
}

// =============================================================================
// Public API
// =============================================================================

export async function parseWorkbook(file: File): Promise<SheetInfo[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });

  const out: SheetInfo[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: null,
      raw: false,    // ensures dates become strings, percentages stay readable
    });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const detectedType = detectSourceType(sheetName, headers);
    const detectedNameColumn = detectNameColumn(headers, detectedType);

    // Project how many rows would actually match the locked roster
    let projectedMatches = 0;
    if (detectedNameColumn) {
      for (const r of rows) {
        const v = r[detectedNameColumn];
        if (v && resolveTeamMember(String(v))) projectedMatches++;
      }
    }

    out.push({
      name: sheetName,
      detectedType,
      detectedNameColumn,
      headers,
      preview: rows.slice(0, 5),
      totalRows: rows.length,
      projectedMatches,
    });
  }
  return out;
}

export async function executeImport(
  file: File,
  plan: ImportPlan,
): Promise<ImportResult> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });

  const result: ImportResult = { fileName: file.name, bySheet: [] };

  for (const entry of plan.sheets) {
    if (entry.sourceType === "skip") continue;
    const ws = wb.Sheets[entry.sheetName];
    if (!ws) continue;

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: null,
      raw: false,
    });

    // Hard-pinned agent columns override the user's selection. Ticket
    // sheets always use `first_contact_name`; inbound call sheets always
    // use `To Name`. This protects against mis-selection in the UI.
    let effectiveNameCol = entry.nameColumn;
    if (
      entry.sourceType === "tickets" &&
      rows.length > 0 &&
      Object.prototype.hasOwnProperty.call(rows[0], TICKET_OWNER_COLUMN)
    ) {
      effectiveNameCol = TICKET_OWNER_COLUMN;
    } else if (
      entry.sourceType === "calls" &&
      rows.length > 0 &&
      Object.prototype.hasOwnProperty.call(rows[0], CALL_AGENT_COLUMN)
    ) {
      effectiveNameCol = CALL_AGENT_COLUMN;
    }

    const processed: ImportedRow[] = [];
    const skippedNamesSet = new Set<string>();
    let skipped = 0;

    for (const row of rows) {
      const rawName = row[effectiveNameCol];
      if (rawName == null || rawName === "") {
        skipped++;
        continue;
      }
      const canonical = resolveTeamMember(String(rawName));
      if (!canonical) {
        skipped++;
        skippedNamesSet.add(String(rawName).trim());
        continue;
      }
      const summary = extractSummary(row, entry.sourceType);
      processed.push({
        memberName: canonical,
        // Strip ignored columns BEFORE persisting so they never reach DB
        raw: stripIgnored(row, entry.sourceType),
        summary,
      });
    }

    result.bySheet.push({
      sheetName: entry.sheetName,
      sourceType: entry.sourceType,
      totalRows: rows.length,
      matchedRows: processed.length,
      skippedRows: skipped,
      skippedNames: Array.from(skippedNamesSet).slice(0, 30),
      rows: processed,
    });
  }
  return result;
}
