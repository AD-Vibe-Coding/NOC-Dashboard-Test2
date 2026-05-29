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
  const s = cell.trim().toUpperCase();
  if (!s || ["OFF", "X", "-", "NO"].includes(s)) return "OFF";

  // Range with hyphen/dash e.g. "8AM-5PM", "8:00-17:00"
  const parts = s.split(/\s*[-–—]\s*/);
  if (parts.length === 2) {
    const start = parseTime(parts[0]);
    const end   = parseTime(parts[1]);
    if (start !== null && end !== null) return { start, end };
  }

  // Single time means scheduled (assume 8h shift)
  const t = parseTime(s);
  if (t !== null) return { start: t, end: t + 8 * 60 };

  // Non-empty non-OFF cell = assumed scheduled (whole day)
  return { start: 0, end: 23 * 60 + 59 };
}

/** Current time of day in minutes, Pacific time */
function nowMinutesPST(): number {
  const pst = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  return pst.getHours() * 60 + pst.getMinutes();
}

/** Today metadata in Pacific time */
function todayPST() {
  const pst    = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const days   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return {
    dayName:  days[pst.getDay()],                                  // "Wednesday"
    dayShort: days[pst.getDay()].slice(0, 3),                      // "Wed"
    monthDay: `${pst.getMonth() + 1}/${pst.getDate()}`,            // "5/28"
    monthName:`${months[pst.getMonth()]} ${pst.getDate()}`,        // "May 28"
    isoDate:  pst.toISOString().slice(0, 10),                      // "2025-05-28"
  };
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

function detectShift(rows: string[][], sheetTitle: string): Omit<ShiftResult, "fetchedAt"> {
  const base = { sheetTitle, rowCount: rows.length };

  if (rows.length === 0) {
    return { ...base, inShiftNow: [], allNames: [], strategy: "empty" };
  }

  const headers  = rows[0].map((h) => (h ?? "").trim());
  const dataRows = rows.slice(1);
  const nowMin   = nowMinutesPST();
  const today    = todayPST();

  // Detect "Name" column
  const nameColIdx = (() => {
    const idx = headers.findIndex((h) => /^(name|agent|employee|tech|engineer)/i.test(h));
    return idx >= 0 ? idx : 0;
  })();

  const allNames = dataRows
    .map((r) => (r[nameColIdx] ?? "").trim())
    .filter(Boolean);

  // ── Strategy A: today's date appears in a header column ─────────────────
  const todayColIdx = headers.findIndex((h) => {
    if (!h) return false;
    return (
      h.includes(today.monthDay) ||
      h.includes(today.isoDate) ||
      h.toLowerCase().includes(today.monthName.toLowerCase()) ||
      // "Wed 5/28", "Wednesday", etc.
      h.toLowerCase().startsWith(today.dayShort.toLowerCase())
    );
  });

  if (todayColIdx > 0) {
    const inShiftNow: string[] = [];
    for (const row of dataRows) {
      const name = (row[nameColIdx] ?? "").trim();
      if (!name) continue;
      const cell  = (row[todayColIdx] ?? "").trim();
      const shift = parseShiftCell(cell);
      if (shift && shift !== "OFF") {
        if (nowMin >= shift.start && nowMin <= shift.end) inShiftNow.push(name);
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

      if (dayOk && nowMin >= start && nowMin <= end) inShiftNow.push(name);
    }
    return { ...base, inShiftNow, allNames, strategy: "start-end-columns" };
  }

  // ── Strategy C: day-of-week header (Mon / Tue / Wed …) ──────────────────
  const dowIdx = headers.findIndex((h) =>
    h.toLowerCase().startsWith(today.dayShort.toLowerCase()),
  );

  if (dowIdx >= 0) {
    const inShiftNow: string[] = [];
    for (const row of dataRows) {
      const name  = (row[nameColIdx] ?? "").trim();
      if (!name) continue;
      const cell  = (row[dowIdx] ?? "").trim();
      const shift = parseShiftCell(cell);
      if (shift && shift !== "OFF") {
        if (nowMin >= shift.start && nowMin <= shift.end) inShiftNow.push(name);
      }
    }
    return { ...base, inShiftNow, allNames, strategy: "day-of-week-column" };
  }

  // ── Fallback: return everyone listed ────────────────────────────────────
  return { ...base, inShiftNow: allNames, allNames, strategy: "fallback-all-listed" };
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
      error: "GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY not configured — " +
             "add them via the Add Secret dialog and share the spreadsheet with the service account email.",
    };
    return res.end(JSON.stringify(fallback));
  }

  try {
    const token      = await getAccessToken();
    const sheetTitle = await getSheetTitle(token);
    const rows       = await fetchRows(token, sheetTitle);
    const detected   = detectShift(rows, sheetTitle);

    const data: ShiftResult = { ...detected, fetchedAt: new Date().toISOString() };
    _cache = { data, at: Date.now() };
    res.end(JSON.stringify(data));
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
