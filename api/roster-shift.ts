/**
 * GET /api/roster-shift
 *
 * Reads the NOC roster Google Sheet and returns who is currently in their shift.
 *
 * Spreadsheet: https://docs.google.com/spreadsheets/d/14t85Jg97RXmjDg3cwBQOnYGVYoBZUPuTrHGz-SKtZA4
 * Target tab GID: 1411338244
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL       — service account client_email
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY — RSA private key (PEM, \\n escaped OK)
 *
 * The service account must have Viewer access to the spreadsheet.
 * Enable Google Sheets API in the same GCP project.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";

const SPREADSHEET_ID = "14t85Jg97RXmjDg3cwBQOnYGVYoBZUPuTrHGz-SKtZA4";

/**
 * Auto-derive the current month's tab name in Pacific time.
 * e.g. "Jun'26", "Jul'26", "Aug'26" — no hardcoding, no GID needed.
 */
function currentMonthTabName(): string {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const month = now.toLocaleString("en-US", { month: "short" });
  const year2 = String(now.getFullYear()).slice(2);
  return `${month}'${year2}`;
}

function monthTabNameFromMonthKey(monthKey = ""): string {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return currentMonthTabName();
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || !month) return currentMonthTabName();
  const date = new Date(year, month - 1, 1);
  const shortMonth = date.toLocaleString("en-US", { month: "short" });
  const year2 = String(year).slice(2);
  return `${shortMonth}'${year2}`;
}

function monthKeyFromIsoDate(isoDate = "") {
  const match = isoDate.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${match[1]}-${match[2]}`;
}

const PUBLISHED_CSV_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTtUVf4cK8WTdKH47k61nmsDWmPq2Gxdw4J_j9WHxGoDEXqthtTdQ2zbKYJXa0zY8Q9blbaGm4lZH2c/pub?output=csv&single=true";

// ── Service-account OAuth2 ────────────────────────────────────────────────────

let _tokenCache: { value: string; expiresAt: number } | null = null;

function normalizeServiceAccountKey(rawKey: string): string {
  // 1. Strip surrounding quotes
  let key = rawKey.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }

  // 2. Normalise all newline representations → real newlines
  //    Order matters: handle \\n (double-escaped) before \n (single-escaped)
  key = key.replace(/\\\\n/g, "\n"); // \\n  →  \n
  key = key.replace(/\\n/g,   "\n"); // \n   →  real newline
  key = key.replace(/\r\n/g,  "\n"); // CRLF → LF

  // 3. Validate header presence
  if (!key.includes("BEGIN PRIVATE KEY") && !key.includes("BEGIN RSA PRIVATE KEY")) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY must be a PEM key. Copy the entire 'private_key' value from the service-account JSON, including the BEGIN/END header lines.",
    );
  }

  // 4. Reconstruct PEM with strict 64-char line wrapping.
  //    This fixes any corruption introduced by storage or copy-paste.
  const match = key.match(/-----BEGIN ([^-]+)-----\s*([\s\S]+?)\s*-----END [^-]+-----/);
  if (match) {
    const keyType = match[1]; // e.g. "PRIVATE KEY"
    const body    = match[2].replace(/\s+/g, ""); // strip ALL whitespace
    const wrapped = (body.match(/.{1,64}/g) ?? [body]).join("\n");
    return `-----BEGIN ${keyType}-----\n${wrapped}\n-----END ${keyType}-----\n`;
  }

  return key;
}

async function getAccessToken(): Promise<string> {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60_000) {
    return _tokenCache.value;
  }

  const email  = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "";
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "";
  if (!email || !rawKey) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY not set");

  const privateKey = normalizeServiceAccountKey(rawKey);
  const now = Math.floor(Date.now() / 1000);

  const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");

  const input = `${header}.${payload}`;
  let signature: string;
  try {
    const keyObject = crypto.createPrivateKey({ key: privateKey, format: "pem" });
    signature = crypto.sign("RSA-SHA256", Buffer.from(input), keyObject).toString("base64url");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid Google service account private key format. Re-save GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY as the full PEM from the service-account JSON. OpenSSL said: ${message}`,
    );
  }
  const jwt = `${input}.${signature}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Service account token error (${r.status}): ${t.slice(0, 300)}`);
  }

  const j: any = await r.json();
  if (!j.access_token) throw new Error("No access_token returned from Google OAuth");

  _tokenCache = { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return _tokenCache.value;
}

// ── Sheets API helpers ────────────────────────────────────────────────────────

async function fetchRows(token: string, sheetTitle: string): Promise<string[][]> {
  const range = encodeURIComponent(sheetTitle);
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?majorDimension=ROWS`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Sheet values error: ${r.status} — ${body.slice(0, 200)}`);
  }
  const j: any = await r.json();
  return (j.values ?? []) as string[][];
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function buildPublishedCsvUrl(baseUrl: string, gid: number): string {
  const url = new URL(baseUrl);
  url.searchParams.set("output", "csv");
  url.searchParams.set("gid", String(gid));
  url.searchParams.set("single", "true");
  return url.toString();
}

async function fetchPublishedCsvRows(csvUrl: string): Promise<{ rows: string[][]; sheetTitle: string }> {
  const response = await fetch(csvUrl);
  if (!response.ok) {
    throw new Error(`Published roster CSV error: ${response.status}`);
  }

  const csv = await response.text();
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  const rows = lines.map(parseCsvLine);
  return {
    rows,
    sheetTitle: `Published roster CSV · ${currentMonthTabName()}`,
  };
}

// ── Shift detection ───────────────────────────────────────────────────────────

/** Parse a time string → minutes since midnight (Pacific). Returns null on failure. */
function parseTime(str: string): number | null {
  const s = str.trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return null;

  // HH:MM or HH:MM AM/PM
  let m = s.match(/^(\d{1,2}):(\d{2})(AM|PM)?$/);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (m[3] === "PM" && h < 12) h += 12;
    if (m[3] === "AM" && h === 12) h = 0;
    return h * 60 + min;
  }

  // Ham/Hpm e.g. "8AM", "5PM"
  m = s.match(/^(\d{1,2})(AM|PM)$/);
  if (m) {
    let h = parseInt(m[1], 10);
    if (m[2] === "PM" && h < 12) h += 12;
    if (m[2] === "AM" && h === 12) h = 0;
    return h * 60;
  }

  // HHMM e.g. "0800", "1700"
  m = s.match(/^(\d{4})$/);
  if (m) {
    return parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(2), 10);
  }

  return null;
}

/** Parse a cell like "8AM-5PM", "08:00-17:00", "OFF", "X" → shift window or OFF */
function parseShiftCell(cell: string): { start: number; end: number } | "OFF" | null {
  const s = cell.trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return "OFF";

  const offMarkers = [
    "OFF",
    "WO",
    "W/O",
    "PTO",
    "VACATION",
    "HOLIDAY",
    "SICK LEAVE",
    "EMERGENCY LEAVE",
    "BEREAVEMENT",
    "LEAVE",
    "LOA",
    "X",
    "-",
    "NO",
  ];
  if (offMarkers.some((marker) => s === marker || s.includes(marker))) return "OFF";

  const cleaned = s
    .replace(/\(.*?\)/g, "")
    .replace(/HALF DAY/gi, "")
    .replace(/\bTO\b/g, "-")
    .replace(/\s*[-–—]\s*/g, "-")
    .trim();

  // Range with hyphen/dash/to e.g. "8AM-5PM", "08:00 AM to 05:00 PM"
  const parts = cleaned.split("-").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const start = parseTime(parts[0]);
    const end = parseTime(parts[1]);
    if (start !== null && end !== null) return { start, end };
  }

  // Single time means scheduled (assume 8h shift)
  const t = parseTime(cleaned);
  if (t !== null) return { start: t, end: t + 8 * 60 };

  return "OFF";
}

/** Current time of day in minutes, Pacific time */
function classifyDailyCell(cell: string): DailyRosterEntry["status"] {
  const value = cell.trim();
  if (!value) return "Blank";
  const upper = value.toUpperCase();
  if (upper.includes("SICK LEAVE") && upper.includes("TENTATIVE")) return "Sick Leave - Tentative";
  if (upper.includes("SICK LEAVE")) return "Sick Leave";
  if (upper.includes("EMERGENCY LEAVE")) return "Emergency Leave";
  if (upper.includes("HOLIDAY")) return "Holiday";
  if (upper.includes("PTO") || upper.includes("VACATION")) return "PTO";
  if (upper.includes("WO") || upper.includes("W/O") || upper.includes("WEEK OFF") || upper.includes("WEEKOFF")) return "WO";
  const shift = parseShiftCell(value);
  if (shift && shift !== "OFF") return "Available";
  return "Other";
}

function isRealRosterName(name: string): boolean {
  const value = name.trim();
  if (!value) return false;
  if (/required|status|count|pst time zone/i.test(value)) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  return /\s/.test(value);
}

function nowMinutesPST(): number {
  const pst = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  return pst.getHours() * 60 + pst.getMinutes();
}

function isWithinShift(nowMin: number, shift: { start: number; end: number }): boolean {
  const { start, end } = shift;

  if (start === end) return true;
  if (end > start) return nowMin >= start && nowMin <= end;

  // Overnight shift in PST, e.g. 10PM → 6AM.
  return nowMin >= start || nowMin <= end;
}

function isWithinShiftForColumn(
  nowMin: number,
  shift: { start: number; end: number },
  columnContext: "today" | "previous",
): boolean {
  const { start, end } = shift;

  if (start === end) return true;

  // Same-day shifts belong to their own day column only.
  if (end > start) {
    return columnContext === "today" && nowMin >= start && nowMin <= end;
  }

  // Overnight shifts are split across two roster dates:
  // - today's column applies only before midnight (e.g. Sun 7 PM → 11:59 PM)
  // - previous day's column applies only after midnight (e.g. Sat 7 PM → Sun 4 AM)
  if (columnContext === "today") {
    return nowMin >= start;
  }

  return nowMin <= end;
}

/** Today metadata in Pacific time */
function dayMetaPST(offsetDays = 0) {
  const pst = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  pst.setDate(pst.getDate() + offsetDays);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return {
    dayName: days[pst.getDay()],
    dayShort: days[pst.getDay()].slice(0, 3),
    monthDay: `${pst.getMonth() + 1}/${pst.getDate()}`,
    monthName: `${months[pst.getMonth()]} ${pst.getDate()}`,
    isoDate: pst.toISOString().slice(0, 10),
  };
}

function todayPST() {
  return dayMetaPST(0);
}

function dayMetaFromIso(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const local = new Date(year, (month ?? 1) - 1, day ?? 1);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return {
    dayName: days[local.getDay()],
    dayShort: days[local.getDay()].slice(0, 3),
    monthDay: `${local.getMonth() + 1}/${local.getDate()}`,
    monthName: `${months[local.getMonth()]} ${local.getDate()}`,
    isoDate: `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`,
  };
}

export interface DailyRosterEntry {
  name: string;
  cell: string;
  status: "Available" | "WO" | "PTO" | "Sick Leave" | "Sick Leave - Tentative" | "Emergency Leave" | "Holiday" | "Blank" | "Other";
  available: boolean;
  shift?: { start: number; end: number };
}

export interface MonthlyRosterAssignment {
  dateKey: string;
  cell: string;
  status: DailyRosterEntry["status"];
  available: boolean;
  shift?: { start: number; end: number };
}

export interface MonthlyRosterMember {
  name: string;
  assignments: MonthlyRosterAssignment[];
}

export interface MonthlyRosterResult {
  sheetTitle: string;
  strategy: string;
  fetchedAt: string;
  rowCount: number;
  monthKey: string;
  members: MonthlyRosterMember[];
  error?: string;
}

export interface ShiftResult {
  inShiftNow:    string[];
  allNames:      string[];
  shiftWindows?: { name: string; start: number; end: number; cell: string }[];
  dailyEntries?: DailyRosterEntry[];
  strategy:      string;
  sheetTitle:    string;
  fetchedAt:     string;
  rowCount:      number;
  targetDate?:   string;
  error?:        string;
  diagnostics?: {
    currentTimePST: string;     // e.g. "14:32 PST"
    currentMinPST:  number;     // minutes since midnight
    todayLabel:     string;     // what date we searched for
    matchedCol:     number;     // -1 = not found
    headersPreview: string[];   // first 8 headers for debugging
  };
}

function findDateColumnIndex(headers: string[], day: ReturnType<typeof dayMetaPST>) {
  const dayNumber    = String(Number(day.monthDay.split("/")[1] ?? ""));
  const dayNumberPad = dayNumber.padStart(2, "0");                // "02"
  const monthNum     = day.monthDay.split("/")[0];                // "6"
  const monthNumPad  = monthNum.padStart(2, "0");                 // "06"
  const monthShort   = day.monthName.split(" ")[0].toLowerCase(); // "jun"
  const normalizedMonthName = day.monthName.toLowerCase();        // "jun 2"
  const compactMonthName    = normalizedMonthName.replace(/\s+/g, ""); // "jun2"

  return headers.findIndex((h, idx) => {
    if (idx === 0 || !h) return false;
    const normalized = h.toLowerCase().trim();
    const compact    = normalized.replace(/\s+/g, "");

    return (
      // ISO: "2026-06-02"
      normalized === day.isoDate.toLowerCase()
      // "Jun 2" / "jun 2"
      || normalized === normalizedMonthName
      // "Jun2"
      || compact === compactMonthName
      // "Tue 6/2"
      || normalized === `${day.dayShort.toLowerCase()} ${day.monthDay.toLowerCase()}`
      // "2-Jun"  ← most common format in this roster
      || normalized === `${dayNumber}-${monthShort}`
      // "02-Jun"  (zero-padded)
      || normalized === `${dayNumberPad}-${monthShort}`
      // "Jun-2"
      || normalized === `${monthShort}-${dayNumber}`
      // "Jun-02"
      || normalized === `${monthShort}-${dayNumberPad}`
      // "June 2"
      || normalized === `june ${dayNumber}`
      // "6/2" or "6/02"
      || normalized === `${monthNum}/${dayNumber}`
      || normalized === `${monthNum}/${dayNumberPad}`
      // "06/02"
      || normalized === `${monthNumPad}/${dayNumberPad}`
      // "2/6" (day/month EU style)
      || normalized === `${dayNumber}/${monthNum}`
    );
  });
}

/** Returns true if a header cell looks like a calendar date (e.g. "2-Jun", "29-Jan", "Jun 2", "6/2") */
function looksLikeDateHeader(h: string): boolean {
  if (!h) return false;
  const s = h.trim().toLowerCase();
  // "2-jun", "29-jan", "01-dec"
  if (/^\d{1,2}-[a-z]{3}$/.test(s)) return true;
  // "jun 2", "jan 29"
  if (/^[a-z]{3}\s+\d{1,2}$/.test(s)) return true;
  // "6/2", "12/31", "6/2/2026"
  if (/^\d{1,2}\/\d{1,2}/.test(s)) return true;
  // "2026-06-02"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  return false;
}

function getRosterTableContext(rows: string[][]) {
  const headers = rows[0]?.map((h) => (h ?? "").trim()) ?? [];
  const secondRow = rows[1]?.map((h) => (h ?? "").trim()) ?? [];
  const combinedHeaders = headers.map((header, idx) => {
    const top = header.trim();
    const bottom = (secondRow[idx] ?? "").trim();
    return [top, bottom].filter(Boolean).join(" ").trim();
  });
  const dateLikeCount = headers.slice(1).filter(looksLikeDateHeader).length;
  const hasPublishedCalendarHeader =
    (/time zone/i.test(headers[0] ?? "") || dateLikeCount >= 2) && secondRow.length > 0;
  const dataRows = hasPublishedCalendarHeader ? rows.slice(2) : rows.slice(1);
  const nameColIdx = (() => {
    const idx = headers.findIndex((h) => /^(name|agent|employee|tech|engineer)/i.test(h));
    return idx >= 0 ? idx : 0;
  })();
  const rosterRows = dataRows.filter((r) => isRealRosterName((r[nameColIdx] ?? "").trim()));

  return { headers, secondRow, combinedHeaders, hasPublishedCalendarHeader, dataRows, nameColIdx, rosterRows };
}

function parseHeaderToIsoDate(header: string, fallbackMonthKey: string): string | null {
  const value = header.trim().toLowerCase();
  if (!value) return null;

  const [fallbackYear, fallbackMonth] = fallbackMonthKey.split("-").map(Number);
  const monthMap: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  let match = value.match(/^(\d{1,2})-([a-z]{3})$/);
  if (match) {
    const day = Number(match[1]);
    const month = monthMap[match[2]];
    if (fallbackYear && month && day) {
      return `${fallbackYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  match = value.match(/^([a-z]{3})\s+(\d{1,2})$/);
  if (match) {
    const month = monthMap[match[1]];
    const day = Number(match[2]);
    if (fallbackYear && month && day) {
      return `${fallbackYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  match = value.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (match) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    const explicitYear = match[3]
      ? Number(match[3].length === 2 ? `20${match[3]}` : match[3])
      : fallbackYear;
    if (explicitYear && month && day) {
      return `${explicitYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  if (/^\d{1,2}$/.test(value) && fallbackYear && fallbackMonth) {
    return `${fallbackYear}-${String(fallbackMonth).padStart(2, "0")}-${String(Number(value)).padStart(2, "0")}`;
  }

  return null;
}

function buildDailyEntries(rows: string[][], day: ReturnType<typeof dayMetaPST>): DailyRosterEntry[] {
  if (rows.length === 0) return [];

  const { headers, combinedHeaders, hasPublishedCalendarHeader, nameColIdx, rosterRows } = getRosterTableContext(rows);
  const dateColIdx = hasPublishedCalendarHeader
    ? Math.max(findDateColumnIndex(headers, day), findDateColumnIndex(combinedHeaders, day))
    : findDateColumnIndex(headers, day);

  if (dateColIdx <= 0) return [];

  return rosterRows.map((row) => {
    const name = (row[nameColIdx] ?? "").trim();
    const cell = (row[dateColIdx] ?? "").trim();
    const parsedShift = parseShiftCell(cell);
    const shift = parsedShift && parsedShift !== "OFF" ? parsedShift : undefined;
    const status = classifyDailyCell(cell);
    return {
      name,
      cell,
      status,
      available: status === "Available",
      shift,
    };
  });
}

function buildMonthlyEntries(rows: string[][], targetMonthKey: string): MonthlyRosterMember[] {
  if (rows.length === 0) return [];

  const { headers, combinedHeaders, nameColIdx, rosterRows } = getRosterTableContext(rows);
  const dateColumns = headers.map((header, idx) => {
    if (idx === nameColIdx) return null;
    const dateKey = parseHeaderToIsoDate(combinedHeaders[idx] || header, targetMonthKey) ?? parseHeaderToIsoDate(header, targetMonthKey);
    if (!dateKey || !dateKey.startsWith(`${targetMonthKey}-`)) return null;
    return { idx, dateKey };
  }).filter((value): value is { idx: number; dateKey: string } => Boolean(value));

  return rosterRows.map((row) => {
    const name = (row[nameColIdx] ?? "").trim();
    const assignments = dateColumns.map(({ idx, dateKey }) => {
      const cell = (row[idx] ?? "").trim();
      const parsedShift = parseShiftCell(cell);
      const shift = parsedShift && parsedShift !== "OFF" ? parsedShift : undefined;
      const status = classifyDailyCell(cell);
      return {
        dateKey,
        cell,
        status,
        available: status === "Available",
        shift,
      };
    });
    return { name, assignments };
  }).filter((row) => row.name);
}

function detectShift(rows: string[][], sheetTitle: string): Omit<ShiftResult, "fetchedAt"> {
  const base = { sheetTitle, rowCount: rows.length };

  if (rows.length === 0) {
    return { ...base, inShiftNow: [], allNames: [], strategy: "empty" };
  }

  const headers = rows[0].map((h) => (h ?? "").trim());
  const secondRow = rows[1]?.map((h) => (h ?? "").trim()) ?? [];
  const combinedHeaders = headers.map((header, idx) => {
    const top = header.trim();
    const bottom = (secondRow[idx] ?? "").trim();
    return [top, bottom].filter(Boolean).join(" ").trim();
  });
  const nowMin = nowMinutesPST();
  const today = todayPST();
  const previousDay = dayMetaPST(-1);

  // Build diagnostics
  const nowPST = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const diagTimePST = `${String(nowPST.getHours()).padStart(2, "0")}:${String(nowPST.getMinutes()).padStart(2, "0")} PST`;

  // Published roster CSV shape:
  // row 0 => date columns like 29-Jan
  // row 1 => weekday labels
  // row 2+ => names + shift cells
  //
  // Detect calendar-style header: either has "time zone" in first cell OR
  // the majority of non-first cells look like date headers.
  const dateLikeCount = headers.slice(1).filter(looksLikeDateHeader).length;
  const hasPublishedCalendarHeader =
    (/time zone/i.test(headers[0] ?? "") || dateLikeCount >= 2) && secondRow.length > 0;
  const dataRows = hasPublishedCalendarHeader ? rows.slice(2) : rows.slice(1);

  // Detect "Name" column
  const nameColIdx = (() => {
    const idx = headers.findIndex((h) => /^(name|agent|employee|tech|engineer)/i.test(h));
    return idx >= 0 ? idx : 0;
  })();

  const rosterRows = dataRows.filter((r) => isRealRosterName((r[nameColIdx] ?? "").trim()));
  const allNames = rosterRows
    .map((r) => (r[nameColIdx] ?? "").trim())
    .filter(Boolean);

  if (hasPublishedCalendarHeader) {
    const todayColIdx    = Math.max(findDateColumnIndex(headers, today), findDateColumnIndex(combinedHeaders, today));
    const previousColIdx = Math.max(findDateColumnIndex(headers, previousDay), findDateColumnIndex(combinedHeaders, previousDay));

    const diag = {
      currentTimePST: diagTimePST,
      currentMinPST:  nowMin,
      todayLabel:     `${today.monthName} (${today.isoDate})`,
      matchedCol:     todayColIdx,
      headersPreview: combinedHeaders.slice(0, 10).map((h, idx) => `${idx}:${h}`),
    };

    if (todayColIdx > 0 || previousColIdx > 0) {
      const inShiftNow: string[] = [];
      const shiftWindows: ShiftWindow[] = [];
      for (const row of rosterRows) {
        const name = (row[nameColIdx] ?? "").trim();
        if (!name) continue;

        const todayCell  = todayColIdx > 0 ? (row[todayColIdx] ?? "").trim() : "";
        const todayShift = parseShiftCell(todayCell);
        if (todayShift && todayShift !== "OFF") {
          shiftWindows.push({ name, start: todayShift.start, end: todayShift.end, cell: todayCell });
          if (isWithinShiftForColumn(nowMin, todayShift, "today")) {
            inShiftNow.push(name);
            continue;
          }
        }

        const previousCell  = previousColIdx > 0 ? (row[previousColIdx] ?? "").trim() : "";
        const previousShift = parseShiftCell(previousCell);
        if (previousShift && previousShift !== "OFF" && isWithinShiftForColumn(nowMin, previousShift, "previous")) {
          inShiftNow.push(name);
          shiftWindows.push({ name, start: previousShift.start, end: previousShift.end, cell: previousCell });
        }
      }
      return { ...base, inShiftNow, allNames, shiftWindows, strategy: "published-calendar-date-column", diagnostics: diag };
    }

    // Calendar header detected but date column not found for today
    return {
      ...base,
      inShiftNow: [],
      allNames,
      strategy: "published-calendar-no-column",
      diagnostics: diag,
    };
  }

  // ── Strategy A: today's date appears in a header column ─────────────────
  // Use the same comprehensive findDateColumnIndex used for published CSV
  const todayColIdx = findDateColumnIndex(headers, today);

  const diagA = {
    currentTimePST: diagTimePST,
    currentMinPST:  nowMin,
    todayLabel:     `${today.monthName} (${today.isoDate})`,
    matchedCol:     todayColIdx,
    headersPreview: headers.slice(0, 10),
  };

  if (todayColIdx > 0) {
    const inShiftNow: string[] = [];
    for (const row of rosterRows) {
      const name = (row[nameColIdx] ?? "").trim();
      if (!name) continue;
      const cell  = (row[todayColIdx] ?? "").trim();
      const shift = parseShiftCell(cell);
      if (shift && shift !== "OFF" && isWithinShiftForColumn(nowMin, shift, "today")) {
        inShiftNow.push(name);
      }
    }
    return { ...base, inShiftNow, allNames, strategy: "date-column", diagnostics: diagA };
  }

  // ── Strategy B: "Shift Start" + "Shift End" columns ─────────────────────
  const startIdx = headers.findIndex((h) => /start|begin|from/i.test(h));
  const endIdx   = headers.findIndex((h) => /\bend\b|until|to\b|finish/i.test(h));
  const dayIdx   = headers.findIndex((h) => /\bday|schedule|days/i.test(h));

  if (startIdx >= 0 && endIdx >= 0) {
    const inShiftNow: string[] = [];
    for (const row of dataRows) {
      const name  = (row[nameColIdx] ?? "").trim();
      if (!name) continue;
      const start = parseTime((row[startIdx] ?? "").trim());
      const end   = parseTime((row[endIdx]   ?? "").trim());
      if (start === null || end === null) continue;

      // If there's a "Days" column, check if today is included
      let dayOk = true;
      if (dayIdx >= 0) {
        const daysStr = (row[dayIdx] ?? "").toLowerCase();
        dayOk = daysStr.includes(today.dayShort.toLowerCase()) ||
                daysStr.includes("daily") ||
                daysStr.includes("weekday") ||
                daysStr === "" ||
                daysStr === "-";
      }

      if (dayOk && isWithinShift(nowMin, { start, end })) inShiftNow.push(name);
    }
    return { ...base, inShiftNow, allNames, strategy: "start-end-columns" };
  }

  // ── Strategy C: day-of-week header (Mon / Tue / Wed …) ──────────────────
  const dowIdx = headers.findIndex((h) =>
    h.toLowerCase().startsWith(today.dayShort.toLowerCase()),
  );

  if (dowIdx >= 0) {
    const inShiftNow: string[] = [];
    for (const row of rosterRows) {
      const name = (row[nameColIdx] ?? "").trim();
      if (!name) continue;
      const cell = (row[dowIdx] ?? "").trim();
      const shift = parseShiftCell(cell);
      if (shift && shift !== "OFF" && isWithinShiftForColumn(nowMin, shift, "today")) {
        inShiftNow.push(name);
      }
    }
    return { ...base, inShiftNow, allNames, strategy: "day-of-week-column" };
  }

  return {
    ...base,
    inShiftNow: [],
    allNames,
    strategy: "no-column-match",
    diagnostics: {
      currentTimePST: diagTimePST,
      currentMinPST:  nowMin,
      todayLabel:     `${today.monthName} (${today.isoDate})`,
      matchedCol:     -1,
      headersPreview: headers.slice(0, 10),
    },
  };
}

// ── Response cache (5 min, month-aware) ──────────────────────────────────────

let _cache: { data: ShiftResult; at: number; month: string; targetDate: string } | null = null;
let _monthCache: { data: MonthlyRosterResult; at: number; month: string } | null = null;
const CACHE_TTL = 5 * 60_000;

// ── Shared reader + handler ──────────────────────────────────────────────────

/**
 * Shared daily roster reader used by Team Availability, Ticket Rebalancer, and
 * Work Allotment Generator. It preserves the working credential and published
 * CSV fallback used by the existing /api/roster-shift endpoint.
 */
export async function readRosterDailyEntries(requestedDate = ""): Promise<ShiftResult> {
  const targetDay = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? dayMetaFromIso(requestedDate) : todayPST();
  const tabName = monthTabNameFromMonthKey(monthKeyFromIsoDate(targetDay.isoDate));

  if (_cache && _cache.month === tabName && _cache.targetDate === targetDay.isoDate && Date.now() - _cache.at < CACHE_TTL) {
    return _cache.data;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  const csvUrl = process.env.ROSTER_PUBLISHED_CSV_URL?.trim();

  if (email && privateKey) {
    const token = await getAccessToken();
    const rows = await fetchRows(token, tabName);
    const detected = detectShift(rows, tabName);
    const data: ShiftResult = {
      ...detected,
      dailyEntries: buildDailyEntries(rows, targetDay),
      targetDate: targetDay.isoDate,
      fetchedAt: new Date().toISOString(),
    };
    _cache = { data, at: Date.now(), month: tabName, targetDate: targetDay.isoDate };
    return data;
  }

  if (csvUrl) {
    const { rows, sheetTitle } = await fetchPublishedCsvRows(csvUrl);
    const detected = detectShift(rows, sheetTitle);
    const data: ShiftResult = {
      ...detected,
      dailyEntries: buildDailyEntries(rows, targetDay),
      targetDate: targetDay.isoDate,
      strategy: `${detected.strategy}-published-csv`,
      fetchedAt: new Date().toISOString(),
    };
    _cache = { data, at: Date.now(), month: tabName, targetDate: targetDay.isoDate };
    return data;
  }

  throw new Error("Roster reader is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, or ROSTER_PUBLISHED_CSV_URL.");
}

export async function readRosterMonthEntries(requestedMonthKey = ""): Promise<MonthlyRosterResult> {
  const targetMonthKey = /^\d{4}-\d{2}$/.test(requestedMonthKey)
    ? requestedMonthKey
    : monthKeyFromIsoDate(todayPST().isoDate);
  const tabName = monthTabNameFromMonthKey(targetMonthKey);

  if (_monthCache && _monthCache.month === targetMonthKey && Date.now() - _monthCache.at < CACHE_TTL) {
    return _monthCache.data;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  const csvUrl = process.env.ROSTER_PUBLISHED_CSV_URL?.trim();

  if (email && privateKey) {
    const token = await getAccessToken();
    const rows = await fetchRows(token, tabName);
    const data: MonthlyRosterResult = {
      sheetTitle: tabName,
      strategy: "month-sheet-api",
      fetchedAt: new Date().toISOString(),
      rowCount: rows.length,
      monthKey: targetMonthKey,
      members: buildMonthlyEntries(rows, targetMonthKey),
    };
    _monthCache = { data, at: Date.now(), month: targetMonthKey };
    return data;
  }

  if (csvUrl) {
    const { rows, sheetTitle } = await fetchPublishedCsvRows(csvUrl);
    const data: MonthlyRosterResult = {
      sheetTitle,
      strategy: "month-sheet-published-csv",
      fetchedAt: new Date().toISOString(),
      rowCount: rows.length,
      monthKey: targetMonthKey,
      members: buildMonthlyEntries(rows, targetMonthKey),
    };
    _monthCache = { data, at: Date.now(), month: targetMonthKey };
    return data;
  }

  throw new Error("Roster reader is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, or ROSTER_PUBLISHED_CSV_URL.");
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  const requestUrl = new URL(req.url ?? "/api/roster-shift", "http://localhost");
  const requestedDate = requestUrl.searchParams.get("date")?.trim() ?? "";

  try {
    const data = await readRosterDailyEntries(requestedDate);
    return res.end(JSON.stringify(data));
  } catch (err: any) {
    const data: ShiftResult = {
      inShiftNow: [],
      allNames: [],
      dailyEntries: [],
      strategy: "error",
      sheetTitle: currentMonthTabName(),
      targetDate: requestedDate || todayPST().isoDate,
      fetchedAt: new Date().toISOString(),
      rowCount: 0,
      error: String(err?.message ?? err),
    };
    return res.end(JSON.stringify(data));
  }
}
