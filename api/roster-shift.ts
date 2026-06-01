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
const TARGET_GID     = 1411338244;
const TARGET_SHEET_TITLE = "May'26";
const PUBLISHED_CSV_URL = buildPublishedCsvUrl(
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTtUVf4cK8WTdKH47k61nmsDWmPq2Gxdw4J_j9WHxGoDEXqthtTdQ2zbKYJXa0zY8Q9blbaGm4lZH2c/pub?output=csv",
  TARGET_GID,
);

// ── Service-account OAuth2 ────────────────────────────────────────────────────

let _tokenCache: { value: string; expiresAt: number } | null = null;

function normalizeServiceAccountKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;

  const withRealNewlines = unquoted.replace(/\\n/g, "\n").trim();

  if (withRealNewlines.includes("BEGIN PRIVATE KEY") || withRealNewlines.includes("BEGIN RSA PRIVATE KEY")) {
    return withRealNewlines;
  }

  throw new Error(
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not a valid PEM private key. Save the full key including BEGIN/END lines, and keep newline escapes as \\n in the secret dialog.",
  );
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

let _sheetTitle: string | null = null;

async function getSheetTitle(token: string): Promise<string> {
  if (_sheetTitle) return _sheetTitle;

  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) throw new Error(`Spreadsheet metadata error: ${r.status}`);
  const j: any = await r.json();
  const sheet = (j.sheets ?? []).find((s: any) => s.properties?.sheetId === TARGET_GID);
  if (!sheet) throw new Error(`Sheet with GID ${TARGET_GID} not found in spreadsheet`);
  _sheetTitle = sheet.properties.title as string;
  return _sheetTitle;
}

async function fetchRows(token: string, sheetTitle: string): Promise<string[][]> {
  const range = encodeURIComponent(sheetTitle);
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?majorDimension=ROWS`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) throw new Error(`Sheet values error: ${r.status}`);
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
    sheetTitle: `Published roster CSV · ${TARGET_SHEET_TITLE}`,
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

export interface ShiftResult {
  inShiftNow:  string[];
  allNames:    string[];
  strategy:    string;
  sheetTitle:  string;
  fetchedAt:   string;
  rowCount:    number;
  error?:      string;
}

function findDateColumnIndex(headers: string[], day: ReturnType<typeof dayMetaPST>) {
  const dayNumber = String(Number(day.monthDay.split("/")[1] ?? ""));
  let colIdx = headers.findIndex((h, idx) => {
    if (idx === 0 || !h) return false;
    const normalized = h.toLowerCase();
    return normalized === day.isoDate.toLowerCase()
      || normalized.includes(day.monthName.toLowerCase())
      || normalized === `${day.dayShort.toLowerCase()} ${day.monthDay.toLowerCase()}`;
  });

  if (colIdx < 0) {
    colIdx = headers.findIndex((h, idx) => idx > 0 && h.trim().startsWith(`${dayNumber}-`));
  }

  return colIdx;
}

function detectShift(rows: string[][], sheetTitle: string): Omit<ShiftResult, "fetchedAt"> {
  const base = { sheetTitle, rowCount: rows.length };

  if (rows.length === 0) {
    return { ...base, inShiftNow: [], allNames: [], strategy: "empty" };
  }

  const headers = rows[0].map((h) => (h ?? "").trim());
  const secondRow = rows[1]?.map((h) => (h ?? "").trim()) ?? [];
  const nowMin = nowMinutesPST();
  const today = todayPST();
  const previousDay = dayMetaPST(-1);

  // Published roster CSV shape:
  // row 0 => date columns like 29-Jan
  // row 1 => weekday labels
  // row 2+ => names + shift cells
  const hasPublishedCalendarHeader = /time zone/i.test(headers[0] ?? "") && secondRow.length > 0;
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
    const todayColIdx = findDateColumnIndex(headers, today);
    const previousColIdx = findDateColumnIndex(headers, previousDay);

    if (todayColIdx > 0 || previousColIdx > 0) {
      const inShiftNow: string[] = [];
      const shiftWindows: ShiftWindow[] = [];
      for (const row of rosterRows) {
        const name = (row[nameColIdx] ?? "").trim();

        const todayCell = todayColIdx > 0 ? (row[todayColIdx] ?? "").trim() : "";
        const todayShift = parseShiftCell(todayCell);
        if (todayShift && todayShift !== "OFF") {
          shiftWindows.push({ name, start: todayShift.start, end: todayShift.end, cell: todayCell });
          if (todayShift.end > todayShift.start && isWithinShift(nowMin, todayShift)) {
            inShiftNow.push(name);
            continue;
          }
        }

        const previousCell = previousColIdx > 0 ? (row[previousColIdx] ?? "").trim() : "";
        const previousShift = parseShiftCell(previousCell);
        if (previousShift && previousShift !== "OFF" && previousShift.end < previousShift.start && nowMin <= previousShift.end) {
          inShiftNow.push(name);
          shiftWindows.push({ name, start: previousShift.start, end: previousShift.end, cell: previousCell });
        }
      }
      return { ...base, inShiftNow, allNames, shiftWindows, strategy: "published-calendar-date-column" };
    }
  }

  // ── Strategy A: today's date appears in a header column ─────────────────
  const todayColIdx = headers.findIndex((h) => {
    if (!h) return false;
    return (
      h.includes(today.monthDay) ||
      h.includes(today.isoDate) ||
      h.toLowerCase().includes(today.monthName.toLowerCase()) ||
      h.toLowerCase().startsWith(today.dayShort.toLowerCase())
    );
  });

  if (todayColIdx > 0) {
    const inShiftNow: string[] = [];
    for (const row of rosterRows) {
      const name = (row[nameColIdx] ?? "").trim();
      const cell = (row[todayColIdx] ?? "").trim();
      const shift = parseShiftCell(cell);
      if (shift && shift !== "OFF" && isWithinShift(nowMin, shift)) {
        inShiftNow.push(name);
      }
    }
    return { ...base, inShiftNow, allNames, strategy: "date-column" };
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
      if (shift && shift !== "OFF" && isWithinShift(nowMin, shift)) {
        inShiftNow.push(name);
      }
    }
    return { ...base, inShiftNow, allNames, strategy: "day-of-week-column" };
  }

  return { ...base, inShiftNow: [], allNames, strategy: "published-csv-unmatched" };
}

// ── Response cache (5 min) ────────────────────────────────────────────────────

let _cache: { data: ShiftResult; at: number } | null = null;
const CACHE_TTL = 5 * 60_000;

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(_req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  // Serve from cache
  if (_cache && Date.now() - _cache.at < CACHE_TTL) {
    return res.end(JSON.stringify(_cache.data));
  }

  const csvUrl = process.env.ROSTER_PUBLISHED_CSV_URL?.trim() || PUBLISHED_CSV_URL;

  try {
    if (csvUrl) {
      const { rows, sheetTitle } = await fetchPublishedCsvRows(csvUrl);
      const detected = detectShift(rows, sheetTitle);
      const data: ShiftResult = {
        ...detected,
        strategy: `${detected.strategy}-published-csv`,
        fetchedAt: new Date().toISOString(),
      };
      _cache = { data, at: Date.now() };
      return res.end(JSON.stringify(data));
    }

    const email      = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

    if (!email || !privateKey) {
      const fallback: ShiftResult = {
        inShiftNow: [],
        allNames:   [],
        strategy:   "unconfigured",
        sheetTitle: "(not loaded)",
        fetchedAt:  new Date().toISOString(),
        rowCount:   0,
        error: "Roster source is not configured. Set a published Google Sheet CSV URL or provide Google service account secrets.",
      };
      return res.end(JSON.stringify(fallback));
    }

    const token      = await getAccessToken();
    const sheetTitle = await getSheetTitle(token);
    const rows       = await fetchRows(token, sheetTitle);
    const detected   = detectShift(rows, sheetTitle);

    const data: ShiftResult = { ...detected, fetchedAt: new Date().toISOString() };
    _cache = { data, at: Date.now() };
    return res.end(JSON.stringify(data));
  } catch (err: any) {
    const data: ShiftResult = {
      inShiftNow: [],
      allNames:   [],
      strategy:   "error",
      sheetTitle: "(error)",
      fetchedAt:  new Date().toISOString(),
      rowCount:   0,
      error: String(err?.message ?? err),
    };
    res.end(JSON.stringify(data));
  }
}
