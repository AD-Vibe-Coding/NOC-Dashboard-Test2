import dayjs, { type Dayjs } from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import Papa from "papaparse";
import { TEAM, MANAGERS, findTeamMember, isManager, normalizeName } from "./team-config";
import type { AvailabilityStatus, RosterEntry } from "./types";
import { detectShift } from "./shifts";

dayjs.extend(customParseFormat);

// Public Google Sheet → CSV. Two URL forms exist; we try gviz first
// (more reliable CORS), then fall back to the export endpoint.
export function buildSheetCsvUrl(sheetId: string, gid: string | number): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
}
export function buildSheetCsvUrlExport(sheetId: string, gid: string | number): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

// Detect when Google returned an HTML sign-in page instead of CSV.
// This happens when the sheet is NOT shared publicly — the fetch succeeds
// (HTTP 200) but the body is HTML, not CSV.
function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 500).toLowerCase();
  return (
    head.includes("<html") ||
    head.includes("<!doctype") ||
    head.includes("accounts.google.com") ||
    head.includes("sign in") ||
    head.includes("signin")
  );
}

export async function fetchRosterCsv(
  sheetId: string,
  gid: string | number,
): Promise<string> {
  if (!sheetId || !gid && gid !== 0) {
    throw new Error("Sheet ID and Tab GID are both required.");
  }

  const tryUrl = async (url: string): Promise<string> => {
    let res: Response;
    try {
      res = await fetch(url, { method: "GET", redirect: "follow" });
    } catch (e) {
      // Browser CORS or network failure — fetch throws TypeError before status.
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Network error fetching the sheet: ${msg}. This usually means the sheet is private and Google is redirecting to a sign-in page that the browser blocks.`,
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `The sheet is private (HTTP ${res.status}). Open the sheet in Google Sheets, click Share → "General access" → set to "Anyone with the link" → "Viewer", then try again. Or use the "Upload CSV/XLSX" tab instead.`,
      );
    }
    if (res.status === 404) {
      throw new Error(
        `Sheet not found (HTTP 404). Double-check the Sheet ID and Tab GID — both should come from the sheet's URL.`,
      );
    }
    if (!res.ok) {
      throw new Error(
        `Failed to fetch roster sheet (HTTP ${res.status} ${res.statusText}).`,
      );
    }

    const text = await res.text();
    if (looksLikeHtml(text)) {
      throw new Error(
        `The sheet returned a sign-in page instead of CSV — it is not publicly shared. Open the sheet in Google Sheets, click Share → "General access" → set to "Anyone with the link" → "Viewer", then try again. Or use the "Upload CSV/XLSX" tab to upload a downloaded CSV instead.`,
      );
    }
    if (!text.trim()) {
      throw new Error("The sheet returned an empty response. The Tab GID may be wrong.");
    }
    return text;
  };

  // Try gviz first (best CORS support); if it fails with a *server* error,
  // fall back to the export endpoint. We deliberately do NOT fall back on
  // private-sheet errors — same root cause, no point retrying.
  try {
    return await tryUrl(buildSheetCsvUrl(sheetId, gid));
  } catch (gvizErr) {
    const msg = gvizErr instanceof Error ? gvizErr.message : String(gvizErr);
    // Don't retry the export endpoint if the failure is permission-related —
    // it'll fail the same way and just confuse the error message.
    if (
      msg.includes("private") ||
      msg.includes("sign-in") ||
      msg.includes("404") ||
      msg.includes("Sheet ID")
    ) {
      throw gvizErr;
    }
    // Otherwise try the export URL as a last resort.
    try {
      return await tryUrl(buildSheetCsvUrlExport(sheetId, gid));
    } catch {
      throw gvizErr; // surface the original (more informative) error
    }
  }
}

// Parse CSV into a 2D array of strings.
export function csvToGrid(csv: string): string[][] {
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: false });
  return parsed.data as string[][];
}

// Time-range detection (e.g. "08:00 AM to 05:00 PM", "8am to 5pm").
const TIME_RANGE_RE =
  /\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)\s*(to|–|-|—)\s*\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)\b/i;

const STATUS_KEYWORDS: { match: RegExp; status: AvailabilityStatus }[] = [
  { match: /\bsick\s*leave\s*-\s*tentative\b/i, status: "Sick Leave - Tentative" },
  { match: /\bsick\s*leave\b/i, status: "Sick Leave" },
  { match: /\bemergency\s*leave\b/i, status: "Emergency Leave" },
  { match: /\bholiday\b/i, status: "Holiday" },
  { match: /\bpto\b/i, status: "PTO" },
  { match: /\bwo\b|week\s*off|weekoff/i, status: "WO" },
];

export function classifyRosterCell(cellRaw: string): {
  status: AvailabilityStatus;
  available: boolean;
  shift?: string;
} {
  const cell = (cellRaw ?? "").toString().trim();
  if (!cell) return { status: "Blank", available: false };
  if (TIME_RANGE_RE.test(cell)) {
    return { status: "Available", available: true, shift: cell };
  }
  for (const { match, status } of STATUS_KEYWORDS) {
    if (match.test(cell)) return { status, available: false };
  }
  return { status: "Other", available: false };
}

// Find the column index whose row-1 header matches the target date.
// Headers are formats like "1-May", "May 1", "5/1", "5/1/2025".
export function findDateColumn(grid: string[][], target: Dayjs): number | null {
  if (grid.length === 0) return null;
  const headerRow = grid[0];
  const candidates = [
    target.format("D-MMM"),
    target.format("DD-MMM"),
    target.format("D-MMMM"),
    target.format("MMM D"),
    target.format("MMMM D"),
    target.format("M/D"),
    target.format("M/D/YYYY"),
    target.format("MM/DD/YYYY"),
    target.format("YYYY-MM-DD"),
  ].map((s) => s.toLowerCase());

  for (let i = 0; i < headerRow.length; i++) {
    const cell = (headerRow[i] ?? "").toString().trim().toLowerCase();
    if (!cell) continue;
    if (candidates.includes(cell)) return i;
    // Loose match: parse with dayjs across formats
    const parseFormats = [
      "D-MMM",
      "DD-MMM",
      "D-MMMM",
      "MMM D",
      "MMMM D",
      "M/D",
      "M/D/YYYY",
      "MM/DD/YYYY",
      "YYYY-MM-DD",
      "M/D/YY",
    ];
    for (const f of parseFormats) {
      const parsed = dayjs(cell, f, true);
      if (parsed.isValid() && parsed.month() === target.month() && parsed.date() === target.date()) {
        return i;
      }
    }
  }
  return null;
}

// Build the per-agent roster for a given date.
// Strategy: walk every row from row 3 down (rows 0 and 1 are headers, row 2 is
// often a section header or day-name row), pull column-A name and the
// target-date column's cell, and classify.
export function buildRosterForDate(
  grid: string[][],
  target: Dayjs,
): { entries: RosterEntry[]; columnIndex: number | null; warnings: string[] } {
  const warnings: string[] = [];
  if (grid.length === 0) {
    return { entries: [], columnIndex: null, warnings: ["Roster sheet is empty."] };
  }
  const colIdx = findDateColumn(grid, target);
  if (colIdx === null) {
    warnings.push(
      `Could not find a column for ${target.format("D-MMM")} in the roster header row. Check that the date exists in row 1.`,
    );
  }

  const seen = new Set<string>();
  const entries: RosterEntry[] = [];

  // Iterate rows; skip the header rows (0 = dates, 1 = day names).
  for (let r = 2; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const nameCell = (row[0] ?? "").toString().trim();
    if (!nameCell) continue;
    // Skip any row that looks like a section/day-name header
    if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(nameCell))
      continue;

    const norm = normalizeName(nameCell);
    if (seen.has(norm)) continue;
    seen.add(norm);

    const member = findTeamMember(nameCell);
    const manager = isManager(nameCell);
    const cellRaw = colIdx !== null ? (row[colIdx] ?? "").toString() : "";
    const { status, available, shift } = classifyRosterCell(cellRaw);
    const shiftId = available ? detectShift(cellRaw) ?? undefined : undefined;

    entries.push({
      name: member?.name ?? nameCell, // prefer canonical capitalization
      tier: member?.tier,
      isManager: manager,
      cellRaw,
      status,
      shift,
      shiftId,
      available: available && !manager,
    });
  }

  // If a configured team member never appeared in the sheet, surface it.
  for (const m of TEAM) {
    if (!seen.has(normalizeName(m.name))) {
      warnings.push(`Team member not found in roster sheet: ${m.name}`);
      entries.push({
        name: m.name,
        tier: m.tier,
        isManager: false,
        cellRaw: "",
        status: "Other",
        available: false,
      });
    }
  }
  for (const mgr of MANAGERS) {
    if (!seen.has(normalizeName(mgr))) {
      // Managers absent from the sheet is fine — they're excluded anyway.
    }
  }

  return { entries, columnIndex: colIdx, warnings };
}
