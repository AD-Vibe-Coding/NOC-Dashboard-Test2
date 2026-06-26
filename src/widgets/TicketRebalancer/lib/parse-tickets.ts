import * as XLSX from "xlsx";
import Papa from "papaparse";
import type { RawTicket, ScoredTicket } from "./types";
import {
  classifyPriority,
  classifyService,
  classifyStage,
  lookupWeight,
} from "./weight-matrix";

// Header normalization — iPath exports have inconsistent header casing/spacing.
// Map any of these synonyms to a canonical key.
const HEADER_SYNONYMS: Record<string, string> = {
  ticket: "ticket",
  "ticket id": "ticket",
  "ticket #": "ticket",
  "ticket number": "ticket",
  "ticket no": "ticket",
  id: "ticket",
  owner: "owner",
  "owner name": "owner",
  assignee: "owner",
  "assigned to": "owner",
  "assigned owner": "owner",
  stage: "stage",
  status: "stage",
  "ticket stage": "stage",
  priority: "priority",
  "priority level": "priority",
  service: "service",
  "service type": "service",
  "service name": "service",
  issue: "issue",
  "issue type": "issue",
  type: "type",
  "ticket type": "type",
  age: "age",
  "age (days)": "age",
  "age days": "age",
  "last updated": "last_updated_on",
  "last updated on": "last_updated_on",
  last_updated_on: "last_updated_on",
  "last update": "last_updated_on",
  // Due date — column F in iPath exports. Lots of label variants seen in
  // the wild; we accept all of them and also fall back to column F at
  // index 5 if none match.
  due: "due_date",
  "due date": "due_date",
  "due at": "due_date",
  due_date: "due_date",
  "target date": "due_date",
  "action by": "due_date",
  "follow up": "due_date",
  "next action": "due_date",
  scheduled: "due_date",
};

// If no header in the file matches any due-date synonym, fall back to
// column F (zero-indexed = 5). User confirmed this is where iPath puts it.
const DUE_DATE_FALLBACK_COL = 5;

function normalizeHeader(h: string): string {
  return (h ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Scan an array-of-arrays sheet for the row that looks most like a header row.
 * iPath exports often have title/metadata rows above the real headers, so we
 * can't trust row 0. We score each candidate row by how many of its non-empty
 * cells map to a known canonical field via HEADER_SYNONYMS, and pick the best.
 *
 * Returns the row index, or -1 if no plausible header row is found.
 */
function detectHeaderRow(rows: unknown[][]): number {
  const scanLimit = Math.min(rows.length, 15);
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i] ?? [];
    let score = 0;
    let nonEmpty = 0;
    for (const cell of row) {
      const s = (cell ?? "").toString().trim();
      if (!s) continue;
      nonEmpty++;
      const norm = normalizeHeader(s);
      if (HEADER_SYNONYMS[norm]) score++;
    }
    // Need at least 2 recognizable headers in the row for it to count, and
    // the row must have multiple non-empty cells (not a one-cell title).
    if (score >= 2 && nonEmpty >= 2 && score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Build a column-index → canonical-field map for the chosen header row.
 * Cells that don't match any synonym are simply ignored. We never overwrite
 * an existing mapping (first-wins) so the leftmost matching column for each
 * canonical field is the one we read from.
 */
function buildColumnMap(headerRow: unknown[]): Map<number, string> {
  const map = new Map<number, string>();
  const claimed = new Set<string>();
  headerRow.forEach((raw, idx) => {
    const norm = normalizeHeader((raw ?? "").toString());
    const canonical = HEADER_SYNONYMS[norm];
    if (canonical && !claimed.has(canonical)) {
      map.set(idx, canonical);
      claimed.add(canonical);
    }
  });
  // Column F (index 5) fallback for due_date when no header recognized it.
  // User confirmed iPath always puts the due date there. We OVERRIDE whatever
  // else was at column F because the user is the source of truth about which
  // column actually holds due date — header autodetection is just a guess.
  if (!claimed.has("due_date")) {
    // If column F was claimed by another field via header detection, only
    // override if the previous claim was for something low-priority (i.e.
    // we can lose it without breaking ticket math). Issue / type / age /
    // last_updated_on are safe to drop. Ticket / owner / stage / priority /
    // service are NOT safe — log a warning and skip the fallback.
    const prevField = map.get(DUE_DATE_FALLBACK_COL);
    const safeToOverride = !prevField || ["issue", "type", "age", "last_updated_on"].includes(prevField);
    if (safeToOverride) {
      map.set(DUE_DATE_FALLBACK_COL, "due_date");
    }
  }
  return map;
}

function rowsToTickets(
  rows: unknown[][],
  headerIdx: number,
  colMap: Map<number, string>,
): RawTicket[] {
  // Fallback: if no "ticket" column was identified, treat column B (index 1)
  // as the ticket ID. iPath exports commonly put the ticket # in column B with
  // column A being a leading "S.No" / blank / merged-title cell.
  const hasTicketCol = Array.from(colMap.values()).includes("ticket");
  const ticketColIdx = hasTicketCol
    ? [...colMap.entries()].find(([, v]) => v === "ticket")?.[0] ?? 1
    : 1;

  const tickets: RawTicket[] = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const out: Record<string, unknown> = {};
    for (const [colIdx, canonical] of colMap.entries()) {
      out[canonical] = row[colIdx];
    }
    if (!hasTicketCol) {
      out.ticket = row[ticketColIdx];
    }
    const ticket = (out.ticket ?? "").toString().trim();
    if (!ticket) continue;
    // Skip obvious footer rows ("Total", "Grand Total", etc.)
    if (/^(grand\s+)?total\b/i.test(ticket)) continue;

    tickets.push({
      ticket,
      owner: ((out.owner as string) ?? "").toString().trim(),
      stage: ((out.stage as string) ?? "").toString().trim(),
      priority: ((out.priority as string) ?? "").toString().trim(),
      service: ((out.service as string) ?? "").toString().trim(),
      issue: ((out.issue as string) ?? "").toString().trim(),
      type: ((out.type as string) ?? "").toString().trim(),
      age: out.age as number | string | undefined,
      last_updated_on: ((out.last_updated_on as string) ?? "").toString().trim(),
      // Pass through whatever shape XLSX/CSV gave us — string, Date, or
      // serial number. The rebalancer's parseTicketDueDate handles all three.
      due_date: out.due_date ?? undefined,
      _raw: Object.fromEntries(
        row.map((v, i) => [String.fromCharCode(65 + i), v]),
      ),
    });
  }
  return tickets;
}

// Console-log a one-time diagnostic about which columns we used for which
// fields. Helps the user (or me) see if column F was actually mapped to
// due_date or if header detection picked something else.
function logColumnMapDiagnostic(
  colMap: Map<number, string>,
  sampleRows: unknown[][],
): void {
  const lines: string[] = [];
  for (const [idx, field] of [...colMap.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const colLetter = String.fromCharCode(65 + idx);
    const samples: string[] = [];
    for (const row of sampleRows) {
      const v = row[idx];
      if (v != null && v !== "") {
        samples.push(
          v instanceof Date ? v.toISOString() : String(v).slice(0, 40),
        );
        if (samples.length >= 3) break;
      }
    }
    lines.push(
      `  col ${colLetter} (${idx}) → ${field}${samples.length ? `   e.g. ${samples.join(" | ")}` : ""}`,
    );
  }
  // eslint-disable-next-line no-console
  console.info(
    "[parseTicketFile] column mapping:\n" + lines.join("\n"),
  );
}

export async function parseTicketFile(file: File): Promise<RawTicket[]> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";

  // Always parse as array-of-arrays so we can detect the real header row
  // ourselves — iPath exports often have title/metadata rows above the
  // headers, and the ticket ID typically lives in column B.
  let rows: unknown[][];

  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    const text = await file.text();
    const parsed = Papa.parse<unknown[]>(text, {
      header: false,
      skipEmptyLines: true,
    });
    rows = parsed.data;
  } else if (ext === "xlsx" || ext === "xls" || ext === "xlsm") {
    const buf = await file.arrayBuffer();
    // cellDates: true → date-typed cells come back as JS Date objects
    // (instead of formatted strings that depend on cell format). Critical
    // for the due_date column — different iPath users may have different
    // display formats but the underlying serial is the same.
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      raw: false,
      // Even with raw:false, cellDates:true above keeps Date objects as Dates
      // in the output array (text-formatted cells still come through as
      // strings).
    });
  } else {
    throw new Error(`Unsupported file type: .${ext}`);
  }

  // Strip rows that are entirely empty (Excel often pads with these).
  rows = rows.filter((r) =>
    (r ?? []).some((c) => (c ?? "").toString().trim() !== ""),
  );
  if (rows.length === 0) return [];

  const headerIdx = detectHeaderRow(rows);
  if (headerIdx === -1) {
    // No header detected at all. As a last resort, assume row 0 is data and
    // column B is the ticket ID. This keeps "headerless" exports working.
    const synthetic = new Map<number, string>([[1, "ticket"]]);
    return rowsToTickets(rows, -1, synthetic);
  }

  const colMap = buildColumnMap(rows[headerIdx] as unknown[]);
  // Log diagnostic with first 3 data rows so user can verify column mapping
  // in DevTools console (especially due_date → column F).
  logColumnMapDiagnostic(colMap, rows.slice(headerIdx + 1, headerIdx + 4));
  return rowsToTickets(rows, headerIdx, colMap);
}

export function scoreTickets(tickets: RawTicket[]): ScoredTicket[] {
  return tickets.map((t) => {
    const sla = classifyService(t.service);
    const priorityBand = classifyPriority(t.priority);
    const stageNorm = classifyStage(t.stage);
    const weight = lookupWeight(sla, priorityBand, stageNorm);
    return { ...t, sla, priorityBand, stageNorm, weight };
  });
}
