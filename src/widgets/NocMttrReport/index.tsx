import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  FileInput,
  Group,
  Modal,
  MultiSelect,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconChartBar,
  IconChartLine,
  IconClock,
  IconDatabase,
  IconEye,
  IconFilter,
  IconPresentation,
  IconUpload,
} from "@tabler/icons-react";
import { db, schema } from "../../db";
import { useIdentity } from "../../lib/identity";
import { WidgetFrame } from "../WidgetFrame";
import { WidgetTile } from "../WidgetTile";
import { exportNocMttrPowerPoint } from "./powerpoint";

export interface MttrRow {
  customer: string;
  monthKey: string;
  mttrMinutes: number;
  raw: Record<string, unknown>;
}

interface ParsedWorkbook {
  fileName: string;
  fileSizeBytes?: number;
  truncated?: boolean;
  truncationNotice?: string | null;
  sheets: Array<{
    name: string;
    headers: string[];
    rows: Record<string, unknown>[];
    totalRows: number;
    truncated: boolean;
    detectedCustomerColumn: string | null;
    detectedMonthColumn: string | null;
    detectedMttrColumn: string | null;
  }>;
}

type SavedMttrReportRecord = typeof schema.noc_mttr_reports.$inferSelect;

type MatrixSection = {
  title: string;
  rows: Array<{
    label: string;
    values: Record<string, string>;
  }>;
};

type WorkbookTrendSection = MatrixSection & {
  sheetName: string;
  displayColumns: string[];
  truncated: boolean;
  source?: "calculated" | "detected";
  monthKeyByDisplayColumn?: Record<string, string>;
};

type TicketVolumeChartSeries = {
  key: string;
  label: string;
  color: string;
  aliases?: readonly string[];
};

type TicketVolumeChartSegment = {
  key: string;
  label: string;
  color: string;
  value: number;
};

type TicketVolumeChartMonth = {
  monthLabel: string;
  total: number;
  segments: TicketVolumeChartSegment[];
};

type TicketVolumeChartSummary = {
  monthLabel: string;
  monthKey: string;
  customerOpenedPercent: string;
  vcomOpenedPercent: string;
  over8HourTicketCount: number;
};

type ChronicCircuitTableRow = {
  account: string;
  circuitId: string;
  carrier: string;
  monthlyCounts: Record<string, number>;
  grandTotal: number;
  latestMonthCount: number;
  isLatestMonthPriority: boolean;
};

type ChronicCircuitTableData = {
  monthKeys: string[];
  monthLabels: string[];
  rows: ChronicCircuitTableRow[];
};

type ExtendedMttrTicket = {
  ticketId: string;
  carrier: string;
  resolution?: string;
  issueType?: string;
  mttr: number;
};

type IssueTypeOpenPercentages = {
  customerOpenedPercent: string;
  vcomOpenedPercent: string;
};

type ResolutionBucketPercentages = {
  carrierNetworkIssuePercent: string;
  customerIssuePercent: string;
  noTroubleFoundPercent: string;
  othersPercent: string;
};

type ResolutionSummaryRow = {
  label: string;
  value: string;
};

type MonthDetailModalState = {
  sectionSheetName: string;
  sectionTitle: string;
  monthKey: string;
  monthLabel: string;
  detailType?: "tickets" | "resolution-summary";
};

type ReportedViaFilter = "both" | "noc" | "mobility";
type MaintenanceFilter = "include" | "exclude";
type ChannelFilter = "both" | "buyers_club" | "msp";

type OperationalFilters = {
  reportedVia: ReportedViaFilter;
  maintenance: MaintenanceFilter;
  channel: ChannelFilter;
  customers: string[];
};

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_SHEETS_TO_PARSE = 8;
const MAX_RENDER_ROWS_PER_SECTION = 150;
const CHART_PANEL_BACKGROUND = [
  "linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.08) 38%, rgba(34,197,94,0.04) 100%)",
  "linear-gradient(180deg, #6c7aa8 0%, #88c9df 72%, #aee5f2 100%)",
].join(", ");
const CHART_PANEL_OVERLAY = [
  "linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.03) 55%, rgba(0,0,0,0) 55%)",
  "linear-gradient(45deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 52%, rgba(0,0,0,0) 52%)",
  "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)",
].join(", ");
const CHART_LOGO_SRC = "/vcom-logo.png";
const CHART_TEXT_PRIMARY = "#17324d";
const CHART_TEXT_SECONDARY = "#2f4a63";
const CHART_TEXT_MUTED = "#5a738d";
const CHART_BORDER_SOFT = "rgba(23, 50, 77, 0.14)";
const PREFERRED_TREND_SECTION_ORDER = [
  "Ticket Volume",
  "First Touch Distribution",
  "Time to Carrier Ticket",
  "Top Issue Types",
  "Ticket Resolutions",
  "Top 15 Carriers",
  "Avg MTTR",
] as const;

const SECTION_CONTENT_PATTERNS: Record<(typeof PREFERRED_TREND_SECTION_ORDER)[number], RegExp[]> = {
  "Ticket Volume": [/total tickets/i, /noc tickets/i, /mobility tickets/i, /avg mttr/i, /closed\s*<\s*24\s*hrs/i, /%\s*closed\s*<\s*24\s*hrs/i],
  "First Touch Distribution": [/0\s*[-–]\s*5\s*minutes/i, /5\s*[-–]\s*10\s*minutes/i, /10\s*[-–]\s*30\s*minutes/i, /30\+\s*minutes/i, /%\s*within\s*5\s*min/i, /avg ack time/i],
  "Time to Carrier Ticket": [/under\s*15\s*minutes/i, /15\s*[-–]\s*25\s*minutes/i, /25\s*[-–]\s*35\s*minutes/i, /35\s*[-–]\s*60\s*minutes/i, /60\+\s*minutes/i, /%\s*under\s*15\s*min/i],
  "Top Issue Types": [/maintenance notification/i, /no connectivity/i, /intermittent connectivity/i, /latency\/packet loss/i, /proactive outage notification/i, /activation assistance/i],
  "Ticket Resolutions": [/carrier maintenance/i, /customer equipment issue/i, /carrier network issue/i, /customer power/i, /no trouble found/i, /order needed/i],
  "Top 15 Carriers": [/comcast/i, /spectrum business/i, /lumen/i, /velocloud/i, /meraki/i, /verizon/i, /t-mobile/i],
  "Avg MTTR": [/comcast/i, /spectrum business/i, /lumen/i, /velocloud/i, /meraki/i, /verizon/i, /t-mobile/i, /avg mttr/i],
};

const CUSTOMER_COLUMN_PATTERNS = [/customer/i, /customer\s*name/i, /account/i, /client/i, /company/i, /organization/i];
const MONTH_COLUMN_PATTERNS = [/^month$/i, /month/i, /date/i, /opened/i, /closed/i, /created/i, /period/i, /reporting/i];
const MTTR_COLUMN_PATTERNS = [/^mttr$/i, /mean\s*time\s*to\s*resolve/i, /time\s*to\s*resolve/i, /resolve\s*time/i, /resolution\s*time/i, /mttr\s*\(.*\)/i];
const NETWORK_VOLUME_CHART_SERIES: readonly TicketVolumeChartSeries[] = [
  { key: "mns", label: "MNS / SD-WAN Alert", color: "#355C8A", aliases: ["mns / sd-wan alert"] },
  { key: "maintenance", label: "Maintenance Notification", color: "#8D7AA8", aliases: ["maintenance notification"] },
  { key: "no-connectivity", label: "No Connectivity", color: "#A6C557", aliases: ["no connectivity"] },
  { key: "intermittent", label: "Intermittent Connectivity", color: "#6F89A8", aliases: ["intermittent connectivity"] },
  { key: "proactive", label: "Proactive Outage Notification", color: "#4DB7D8", aliases: ["proactive outage notification"] },
  { key: "others", label: "Others", color: "#F0A14A", aliases: ["others"] },
  { key: "latency", label: "Latency/Packet Loss", color: "#244A74", aliases: ["latency/packet loss", "latency / packet loss"] },
] as const;

const NETWORK_RESOLUTION_CHART_SERIES: readonly TicketVolumeChartSeries[] = [
  { key: "carrier-network-issue", label: "Carrier Network Issue", color: "#355C8A", aliases: ["carrier network issue"] },
  { key: "customer-issue", label: "Customer CPE / Power / Maintenance", color: "#8D7AA8", aliases: ["customer equipment issue", "customer power", "customer maintenance"] },
  { key: "no-trouble-found", label: "No Trouble Found", color: "#A6C557", aliases: ["no trouble found"] },
  { key: "others", label: "Others", color: "#F0A14A", aliases: ["others"] },
] as const;

const MOBILITY_RESOLUTION_CHART_SERIES: readonly TicketVolumeChartSeries[] = [
  { key: "activation-assistance", label: "Activation Assistance", color: "#355C8A", aliases: ["activation assistance"] },
  { key: "esim-reprovisioned", label: "eSIM Re-Provisioned", color: "#8D7AA8", aliases: ["esim re-provisioned", "e-sim re-provisioned", "esim reprovisioned"] },
  {
    key: "voicemail-data-calls",
    label: "Voicemail / Data / Calls Issue",
    color: "#A6C557",
    aliases: [
      "voicemail / visual voicemail issue",
      "voicemail/visual voicemail issue",
      "data issue",
      "calls inbound/ outbound issue",
      "calls inbound / outbound issue",
      "calls inbound/outbound issue",
    ],
  },
  { key: "others", label: "Others", color: "#F0A14A", aliases: ["order needed", "others", "no trouble found"] },
] as const;

const TIME_TO_CARRIER_CHART_SERIES: readonly TicketVolumeChartSeries[] = [
  { key: "under-15", label: "Under 15 Minutes", color: "#355C8A", aliases: ["under 15 minutes"] },
  { key: "over-15", label: "Over 15 Minutes", color: "#A6C557", aliases: ["over 15 minutes"] },
] as const;

const FIRST_TOUCH_CHART_SERIES: readonly TicketVolumeChartSeries[] = [
  { key: "within-5", label: "% within 5 min", color: "#355C8A", aliases: ["% within 5 min"] },
  { key: "over-5", label: "% over 5 min", color: "#A6C557", aliases: ["% over 5 min"] },
] as const;

const TICKET_VOLUME_DYNAMIC_PALETTE = [
  "#355C8A",
  "#8D7AA8",
  "#A6C557",
  "#6F89A8",
  "#4DB7D8",
  "#F0A14A",
  "#244A74",
  "#C97C5D",
  "#5A8F7B",
  "#B07AA1",
] as const;

const PREFERRED_TREND_SHEET_NAME = "NOC MTTR Report";
const FIXED_TREND_CUSTOMER_COLUMN_INDEX = 2;

function detectHeader(headers: string[], patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = headers.find((header) => pattern.test(String(header).trim()));
    if (match) return match;
  }
  return null;
}

function normalizeSheetName(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function findPreferredSheet(parsed: ParsedWorkbook | null, preferredName: string) {
  if (!parsed) return null;
  const normalizedPreferred = normalizeSheetName(preferredName);
  return parsed.sheets.find((sheet) => normalizeSheetName(sheet.name) === normalizedPreferred)
    ?? parsed.sheets.find((sheet) => normalizeSheetName(sheet.name).includes(normalizedPreferred))
    ?? null;
}

function normalizeHeaderValue(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function parseExcelDate(value: number): Date | null {
  const parsed = XLSX.SSF.parse_date_code(value);
  if (!parsed) return null;
  return new Date(parsed.y, parsed.m - 1, parsed.d);
}

function toMonthKey(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const excelDate = parseExcelDate(value);
    if (excelDate) {
      return `${excelDate.getFullYear()}-${String(excelDate.getMonth() + 1).padStart(2, "0")}`;
    }
  }

  const text = String(value).trim();
  if (!text) return null;

  const normalized = text.replace(/\./g, "/").replace(/,/g, " ").replace(/\s+/g, " ");
  if (/^\d{4}-\d{2}$/.test(normalized)) return normalized;
  if (/^\d{4}\/\d{1,2}$/.test(normalized)) {
    const [year, month] = normalized.split("/");
    return `${year}-${month.padStart(2, "0")}`;
  }
  if (/^\d{1,2}\/\d{4}$/.test(normalized)) {
    const [month, year] = normalized.split("/");
    return `${year}-${month.padStart(2, "0")}`;
  }

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
  }

  const monthMatch = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i.exec(normalized);
  const yearMatch = /(20\d{2}|19\d{2})/.exec(normalized);
  if (monthMatch && yearMatch) {
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const month = monthNames.indexOf(monthMatch[1].slice(0, 3).toLowerCase()) + 1;
    if (month > 0) return `${yearMatch[1]}-${String(month).padStart(2, "0")}`;
  }

  return null;
}

function toMinutes(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 24 ? Math.round(value * 60) : Math.round(value);
  }

  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{1,3}(:\d{1,2}){1,2}(\.\d+)?$/.test(text)) {
    const parts = text.split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return null;
    let seconds = 0;
    if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
    else seconds = parts[0] * 60;
    return Math.round(seconds / 60);
  }

  const normalized = text.toLowerCase();
  const hoursMatch = /(\d+(?:\.\d+)?)\s*h/.exec(normalized);
  const minutesMatch = /(\d+(?:\.\d+)?)\s*m/.exec(normalized);
  if (hoursMatch || minutesMatch) {
    const hours = hoursMatch ? Number(hoursMatch[1]) : 0;
    const minutes = minutesMatch ? Number(minutesMatch[1]) : 0;
    return Math.round(hours * 60 + minutes);
  }

  const numeric = Number(normalized.replace(/[^\d.-]/g, ""));
  if (Number.isFinite(numeric)) return numeric < 24 ? Math.round(numeric * 60) : Math.round(numeric);
  return null;
}

function makeUniqueHeaders(headers: string[]) {
  const counts = new Map<string, number>();
  return headers.map((header) => {
    const base = header.trim() || "Column";
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    return seen === 0 ? base : `${base} (${seen + 1})`;
  });
}

function parseSheetToStructuredRows(worksheet: XLSX.WorkSheet) {
  const ref = worksheet["!ref"];
  if (!ref) return { headers: [] as string[], rows: [] as Record<string, unknown>[] };

  const range = XLSX.utils.decode_range(ref);
  const rowCount = range.e.r + 1;
  const columnCount = range.e.c + 1;

  const normalizedRows: Array<Array<string | null>> = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row: Array<string | null> = [];
    for (let colIndex = 0; colIndex < columnCount; colIndex += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = worksheet[cellAddress];
      row.push(normalizeHeaderValue(cell?.w ?? cell?.v ?? null) ?? null);
    }
    normalizedRows.push(row);
  }

  const headerRow = normalizedRows[0] ?? [];

  if (headerRow.every((cell) => !cell)) {
    const fallbackRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: null, raw: false });
    const fallbackHeaders = fallbackRows.length > 0 ? makeUniqueHeaders(Object.keys(fallbackRows[0])) : [];
    return {
      headers: fallbackHeaders,
      rows: fallbackRows.map((row) => {
        const record: Record<string, unknown> = {};
        fallbackHeaders.forEach((header, index) => {
          const originalKey = Object.keys(row)[index];
          record[header] = originalKey ? row[originalKey] : null;
        });
        return record;
      }),
    };
  }

  const headers = makeUniqueHeaders(headerRow.map((cell, index) => cell ?? `Column ${index + 1}`));
  const dataRows = normalizedRows.slice(1)
    .filter((row) => row.some((cell) => cell != null && cell !== ""))
    .map((row) => {
      const record: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        record[header] = row[index] ?? null;
      });
      return record;
    });

  return { headers, rows: dataRows };
}

function parseWorkbook(file: File): Promise<ParsedWorkbook> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return Promise.reject(new Error(`This workbook is too large to process in the browser (${(file.size / (1024 * 1024)).toFixed(1)} MB). Please keep uploads under ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`));
  }

  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true, dense: true });
    const limitedSheetNames = workbook.SheetNames.slice(0, MAX_SHEETS_TO_PARSE);
    const workbookWasTruncated = workbook.SheetNames.length > limitedSheetNames.length;

    const sheets = limitedSheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const structured = parseSheetToStructuredRows(worksheet);
      const allRows = structured.rows;
      const headers = structured.headers;

      return {
        name: sheetName,
        headers,
        rows: allRows,
        totalRows: allRows.length,
        truncated: false,
        detectedCustomerColumn: detectHeader(headers, CUSTOMER_COLUMN_PATTERNS),
        detectedMonthColumn: detectHeader(headers, MONTH_COLUMN_PATTERNS),
        detectedMttrColumn: detectHeader(headers, MTTR_COLUMN_PATTERNS),
      };
    });

    const notices: string[] = [];
    if (workbook.SheetNames.length > limitedSheetNames.length) {
      notices.push(`Only the first ${MAX_SHEETS_TO_PARSE} sheets were loaded.`);
    }

    return {
      fileName: file.name,
      fileSizeBytes: file.size,
      truncated: workbookWasTruncated,
      truncationNotice: notices.length > 0 ? notices.join(" ") : null,
      sheets,
    };
  });
}

function parseSavedWorkbook(value: string): ParsedWorkbook | null {
  try {
    const parsed = JSON.parse(value) as ParsedWorkbook;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.sheets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildRows(parsed: ParsedWorkbook | null, sheetName: string | null, customerColumn: string | null, monthColumn: string | null, mttrColumn: string | null): MttrRow[] {
  if (!parsed || !sheetName || !customerColumn || !monthColumn || !mttrColumn) return [];
  const sheet = parsed.sheets.find((entry) => entry.name === sheetName);
  if (!sheet) return [];

  return sheet.rows.flatMap((row) => {
    const customer = normalizeHeaderValue(row[customerColumn]);
    const monthKey = toMonthKey(row[monthColumn]);
    const mttrMinutes = toMinutes(row[mttrColumn]);
    if (!customer || !monthKey || mttrMinutes == null) return [];
    return [{ customer, monthKey, mttrMinutes, raw: row }];
  });
}

function monthSort(a: string, b: string) {
  return a.localeCompare(b);
}

function isDisplayColumn(header: string) {
  const normalized = header.trim();
  return Boolean(normalized) && (normalized.toLowerCase() === "total" || /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s*\d{2,4}$/i.test(normalized));
}

function rowIsBlank(row: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => {
    const value = normalizeHeaderValue(row[key]);
    return !value;
  });
}

function isSectionHeaderRow(row: Record<string, unknown>, labelColumn: string, valueColumns: string[]) {
  const label = normalizeHeaderValue(row[labelColumn]);
  if (!label) return false;
  return valueColumns.every((column) => !normalizeHeaderValue(row[column]));
}

function buildMatrixSections(sheet: ParsedWorkbook["sheets"][number] | null): { labelColumn: string | null; displayColumns: string[]; sections: MatrixSection[] } {
  if (!sheet || sheet.headers.length === 0) return { labelColumn: null, displayColumns: [], sections: [] };

  const labelColumn = sheet.headers[0] ?? null;
  const displayColumns = sheet.headers.slice(1).filter(isDisplayColumn);
  const fallbackColumns = displayColumns.length > 0 ? displayColumns : sheet.headers.slice(1);
  if (!labelColumn || fallbackColumns.length === 0) return { labelColumn, displayColumns: fallbackColumns, sections: [] };

  const sections: MatrixSection[] = [];
  let currentSection: MatrixSection | null = null;

  for (const row of sheet.rows) {
    const allKeys = [labelColumn, ...fallbackColumns];
    if (rowIsBlank(row, allKeys)) continue;

    if (isSectionHeaderRow(row, labelColumn, fallbackColumns)) {
      if (currentSection && currentSection.rows.length > 0) sections.push(currentSection);
      currentSection = { title: normalizeHeaderValue(row[labelColumn]) ?? "Section", rows: [] };
      continue;
    }

    const label = normalizeHeaderValue(row[labelColumn]);
    if (!label) continue;

    if (!currentSection) currentSection = { title: sheet.name, rows: [] };
    if (currentSection.rows.length >= MAX_RENDER_ROWS_PER_SECTION) continue;
    currentSection.rows.push({
      label,
      values: Object.fromEntries(fallbackColumns.map((column) => [column, normalizeHeaderValue(row[column]) ?? "—"])),
    });
  }

  if (currentSection && currentSection.rows.length > 0) sections.push(currentSection);
  return { labelColumn, displayColumns: fallbackColumns, sections };
}

function normalizeSectionTitle(title: string) {
  return title.replace(/[📊📈📉📋🧾⏱️⏱🎯🔥🧠📌]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function matchesPreferredSection(title: string, preferredTitle: string) {
  const normalized = normalizeSectionTitle(title);
  const preferred = normalizeSectionTitle(preferredTitle);
  return normalized === preferred || normalized.includes(preferred) || preferred.includes(normalized);
}

function detectSectionByContent(sheet: ParsedWorkbook["sheets"][number], labelColumn: string | null): (typeof PREFERRED_TREND_SECTION_ORDER)[number] | null {
  if (!labelColumn) return null;

  const labels = sheet.rows
    .map((row) => normalizeHeaderValue(row[labelColumn]))
    .filter((value): value is string => Boolean(value))
    .slice(0, 80);

  let bestMatch: { section: (typeof PREFERRED_TREND_SECTION_ORDER)[number]; score: number } | null = null;

  for (const section of PREFERRED_TREND_SECTION_ORDER) {
    const patterns = SECTION_CONTENT_PATTERNS[section] ?? [];
    const score = patterns.reduce((count, pattern) => count + (labels.some((label) => pattern.test(label)) ? 1 : 0), 0);
    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { section, score };
    }
  }

  return bestMatch?.section ?? null;
}

function formatMonthColumnLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, 1);
  return `${date.toLocaleString(undefined, { month: "short" })} ${String(year).slice(-2)}`;
}

function parseMetricNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{1,3}(:\d{1,2}){1,2}(\.\d+)?$/.test(text)) {
    const parts = text.split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return null;
    let seconds = 0;
    if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
    else seconds = parts[0] * 60;
    return Math.round((seconds / 60) * 10) / 10;
  }

  const normalized = text.toLowerCase();
  const hoursMatch = /(\d+(?:\.\d+)?)\s*h/.exec(normalized);
  const minutesMatch = /(\d+(?:\.\d+)?)\s*m/.exec(normalized);
  if (hoursMatch || minutesMatch) {
    const hours = hoursMatch ? Number(hoursMatch[1]) : 0;
    const minutes = minutesMatch ? Number(minutesMatch[1]) : 0;
    return Math.round((hours * 60 + minutes) * 10) / 10;
  }

  const numeric = Number(normalized.replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function getFixedColumnName(sheet: ParsedWorkbook["sheets"][number] | null, index: number) {
  return sheet?.headers[index] ?? null;
}

function getLockedTrendCustomerColumn(
  sheet: ParsedWorkbook["sheets"][number] | null,
  fallback?: string | null,
) {
  if (!sheet) return fallback ?? null;
  if (normalizeSheetName(sheet.name) === normalizeSheetName(PREFERRED_TREND_SHEET_NAME)) {
    return getFixedColumnName(sheet, FIXED_TREND_CUSTOMER_COLUMN_INDEX)
      ?? fallback
      ?? detectHeader(sheet.headers, CUSTOMER_COLUMN_PATTERNS)
      ?? null;
  }
  return fallback ?? detectHeader(sheet.headers, CUSTOMER_COLUMN_PATTERNS) ?? null;
}

function matchesReportedViaFilter(value: unknown, filter: ReportedViaFilter) {
  if (filter === "both") return true;
  const normalized = normalizeHeaderValue(value)?.toLowerCase() ?? "";
  if (filter === "noc") return normalized === "noc";
  if (filter === "mobility") return normalized === "mobility";
  return true;
}

function matchesMaintenanceFilter(value: unknown, filter: MaintenanceFilter) {
  if (filter === "include") return true;
  const normalized = normalizeHeaderValue(value)?.toLowerCase() ?? "";
  return normalized !== "maintenance notification";
}

function matchesChannelFilter(value: unknown, filter: ChannelFilter) {
  if (filter === "both") return true;
  const normalized = normalizeHeaderValue(value)?.toLowerCase() ?? "";
  if (filter === "buyers_club") return normalized === "buyers' club" || normalized === "buyers club";
  if (filter === "msp") return normalized === "msp";
  return true;
}

function matchesCustomerFilter(value: unknown, filters: string[]) {
  if (filters.length === 0) return true;
  const normalizedValue = normalizeHeaderValue(value)?.toLowerCase() ?? "";
  return filters.some((filter) => normalizedValue === filter.toLowerCase());
}

function rowMatchesOperationalFilters(
  row: Record<string, unknown>,
  sheet: ParsedWorkbook["sheets"][number] | null,
  filters: OperationalFilters,
) {
  const customerColumn = getFixedColumnName(sheet, 2);
  const reportedViaColumn = getFixedColumnName(sheet, 21);
  const channelColumn = getFixedColumnName(sheet, 22);
  const issueTypeColumn = getFixedColumnName(sheet, 37);
  return matchesCustomerFilter(customerColumn ? row[customerColumn] : null, filters.customers)
    && matchesReportedViaFilter(reportedViaColumn ? row[reportedViaColumn] : null, filters.reportedVia)
    && matchesChannelFilter(channelColumn ? row[channelColumn] : null, filters.channel)
    && matchesMaintenanceFilter(issueTypeColumn ? row[issueTypeColumn] : null, filters.maintenance);
}

function filterSheetRowsByOperationalFilters(
  sheet: ParsedWorkbook["sheets"][number] | null,
  filters: OperationalFilters,
): ParsedWorkbook["sheets"][number] | null {
  if (!sheet) return null;
  return {
    ...sheet,
    rows: sheet.rows.filter((row) => rowMatchesOperationalFilters(row, sheet, filters)),
  };
}

function buildChronicCircuitTableData(
  parsed: ParsedWorkbook | null,
  selectedSheetName: string | null | undefined,
  filters: OperationalFilters,
): ChronicCircuitTableData {
  if (!parsed) {
    return { monthKeys: [], monthLabels: [], rows: [] };
  }

  const preferredSheet = findPreferredSheet(parsed, PREFERRED_TREND_SHEET_NAME)
    ?? parsed.sheets.find((sheet) => sheet.name === selectedSheetName)
    ?? parsed.sheets[0]
    ?? null;
  const filteredSheet = filterSheetRowsByOperationalFilters(preferredSheet, filters);
  if (!filteredSheet) {
    return { monthKeys: [], monthLabels: [], rows: [] };
  }

  const accountColumn = getFixedColumnName(filteredSheet, 3);
  const circuitIdColumn = getFixedColumnName(filteredSheet, 4);
  const carrierColumn = getFixedColumnName(filteredSheet, 5);
  const monthColumn = getFixedColumnName(filteredSheet, 1);

  if (!accountColumn || !circuitIdColumn || !carrierColumn || !monthColumn) {
    return { monthKeys: [], monthLabels: [], rows: [] };
  }

  const availableMonthKeys = Array.from(new Set(filteredSheet.rows
    .map((row) => toMonthKey(row[monthColumn]))
    .filter((value): value is string => Boolean(value))))
    .sort(monthSort);
  const monthKeys = availableMonthKeys.slice(-6);
  const monthKeySet = new Set(monthKeys);

  if (monthKeys.length === 0) {
    return { monthKeys: [], monthLabels: [], rows: [] };
  }

  const latestMonthKey = monthKeys[monthKeys.length - 1] ?? "";
  const byCombo = new Map<string, {
    account: string;
    circuitId: string;
    carrier: string;
    monthlyCounts: Record<string, number>;
  }>();

  for (const row of filteredSheet.rows) {
    const account = normalizeHeaderValue(row[accountColumn]) ?? "—";
    const circuitId = normalizeHeaderValue(row[circuitIdColumn]);
    const carrier = normalizeHeaderValue(row[carrierColumn]) ?? "—";
    const monthKey = toMonthKey(row[monthColumn]);

    if (!circuitId || !monthKey || !monthKeySet.has(monthKey)) continue;

    const compositeKey = `${account}__${circuitId}__${carrier}`;
    if (!byCombo.has(compositeKey)) {
      byCombo.set(compositeKey, {
        account,
        circuitId,
        carrier,
        monthlyCounts: Object.fromEntries(monthKeys.map((key) => [key, 0])),
      });
    }

    const entry = byCombo.get(compositeKey);
    if (!entry) continue;
    entry.monthlyCounts[monthKey] = (entry.monthlyCounts[monthKey] ?? 0) + 1;
  }

  const allRows = Array.from(byCombo.values())
    .map((entry) => {
      const grandTotal = monthKeys.reduce((sum, monthKey) => sum + (entry.monthlyCounts[monthKey] ?? 0), 0);
      const latestMonthCount = entry.monthlyCounts[latestMonthKey] ?? 0;
      return {
        account: entry.account,
        circuitId: entry.circuitId,
        carrier: entry.carrier,
        monthlyCounts: entry.monthlyCounts,
        grandTotal,
        latestMonthCount,
        isLatestMonthPriority: latestMonthCount >= 2,
      } satisfies ChronicCircuitTableRow;
    })
    .filter((row) => row.grandTotal > 0);

  const prioritySort = (a: ChronicCircuitTableRow, b: ChronicCircuitTableRow) => (
    b.latestMonthCount - a.latestMonthCount
    || b.grandTotal - a.grandTotal
    || a.account.localeCompare(b.account)
    || a.circuitId.localeCompare(b.circuitId)
    || a.carrier.localeCompare(b.carrier)
  );

  const fillSort = (a: ChronicCircuitTableRow, b: ChronicCircuitTableRow) => (
    b.grandTotal - a.grandTotal
    || b.latestMonthCount - a.latestMonthCount
    || a.account.localeCompare(b.account)
    || a.circuitId.localeCompare(b.circuitId)
    || a.carrier.localeCompare(b.carrier)
  );

  const priorityRows = allRows.filter((row) => row.isLatestMonthPriority).sort(prioritySort);
  const remainingRows = allRows.filter((row) => !row.isLatestMonthPriority).sort(fillSort);
  const selectedRows = priorityRows.length >= 10
    ? priorityRows.slice(0, 10)
    : [...priorityRows, ...remainingRows.slice(0, 10 - priorityRows.length)];
  const rows = selectedRows.sort((a, b) => (
    b.grandTotal - a.grandTotal
    || b.latestMonthCount - a.latestMonthCount
    || a.account.localeCompare(b.account)
    || a.circuitId.localeCompare(b.circuitId)
    || a.carrier.localeCompare(b.carrier)
  ));

  return {
    monthKeys,
    monthLabels: monthKeys.map(formatMonthColumnLabel),
    rows,
  };
}

function getTopCarrierNames(sheet: ParsedWorkbook["sheets"][number] | null, limit = 15) {
  if (!sheet || sheet.headers.length < 6) return [];

  const ticketIdColumn = sheet.headers[0] ?? null;
  const carrierColumn = sheet.headers[5] ?? null;
  if (!ticketIdColumn || !carrierColumn) return [];

  const countsByCarrier = new Map<string, number>();
  for (const row of sheet.rows) {
    const ticketId = normalizeHeaderValue(row[ticketIdColumn]);
    const carrier = normalizeHeaderValue(row[carrierColumn]);
    if (!ticketId || !carrier) continue;
    countsByCarrier.set(carrier, (countsByCarrier.get(carrier) ?? 0) + 1);
  }

  return Array.from(countsByCarrier.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([carrier]) => carrier);
}

function buildCalculatedTicketVolumeSection(sheet: ParsedWorkbook["sheets"][number] | null): WorkbookTrendSection | null {
  if (!sheet || sheet.headers.length < 2) return null;

  const ticketIdColumn = sheet.headers[0] ?? null;
  const monthSourceColumn = sheet.headers[1] ?? null;
  const reportedViaColumn = sheet.headers[21] ?? null;
  if (!ticketIdColumn || !monthSourceColumn) return null;

  const totalByMonth = new Map<string, number>();
  const networkByMonth = new Map<string, number>();
  const mobilityByMonth = new Map<string, number>();

  for (const row of sheet.rows) {
    const ticketId = normalizeHeaderValue(row[ticketIdColumn]);
    const monthKey = toMonthKey(row[monthSourceColumn]);
    if (!ticketId || !monthKey) continue;

    totalByMonth.set(monthKey, (totalByMonth.get(monthKey) ?? 0) + 1);

    const reportedVia = reportedViaColumn ? normalizeHeaderValue(row[reportedViaColumn]) : null;
    if (!reportedVia) continue;

    if (/^noc$/i.test(reportedVia)) {
      networkByMonth.set(monthKey, (networkByMonth.get(monthKey) ?? 0) + 1);
    }

    if (/^mobility$/i.test(reportedVia)) {
      mobilityByMonth.set(monthKey, (mobilityByMonth.get(monthKey) ?? 0) + 1);
    }
  }

  const monthKeys = Array.from(totalByMonth.keys()).sort(monthSort);
  if (monthKeys.length === 0) return null;

  const displayColumns = monthKeys.map(formatMonthColumnLabel);
  const monthLabelMap = new Map(monthKeys.map((monthKey) => [monthKey, formatMonthColumnLabel(monthKey)]));
  const monthKeyByDisplayColumn = Object.fromEntries(monthKeys.map((monthKey) => [formatMonthColumnLabel(monthKey), monthKey]));
  const formatVolumeWithChange = (count: number, previousCount: number | null) => {
    if (previousCount == null) return `${count}||—`;
    if (previousCount === 0) {
      return `${count}||${count === 0 ? "0%" : "↑ 100%"}`;
    }
    const changePercent = Math.round(((count - previousCount) / previousCount) * 100);
    const prefix = changePercent > 0 ? "↑ " : changePercent < 0 ? "↓ " : "";
    return `${count}||${prefix}${Math.abs(changePercent)}%`;
  };

  const rows = [
    {
      label: "Total Tickets",
      values: Object.fromEntries(monthKeys.map((monthKey, index) => {
        const count = totalByMonth.get(monthKey) ?? 0;
        const previousMonthKey = index > 0 ? monthKeys[index - 1] : null;
        const previousCount = previousMonthKey ? (totalByMonth.get(previousMonthKey) ?? 0) : null;
        return [monthLabelMap.get(monthKey) ?? monthKey, formatVolumeWithChange(count, previousCount)];
      })),
    },
    {
      label: "Network Tickets",
      values: Object.fromEntries(monthKeys.map((monthKey, index) => {
        const count = networkByMonth.get(monthKey) ?? 0;
        const previousMonthKey = index > 0 ? monthKeys[index - 1] : null;
        const previousCount = previousMonthKey ? (networkByMonth.get(previousMonthKey) ?? 0) : null;
        return [monthLabelMap.get(monthKey) ?? monthKey, formatVolumeWithChange(count, previousCount)];
      })),
    },
    {
      label: "Mobility Tickets",
      values: Object.fromEntries(monthKeys.map((monthKey, index) => {
        const count = mobilityByMonth.get(monthKey) ?? 0;
        const previousMonthKey = index > 0 ? monthKeys[index - 1] : null;
        const previousCount = previousMonthKey ? (mobilityByMonth.get(previousMonthKey) ?? 0) : null;
        return [monthLabelMap.get(monthKey) ?? monthKey, formatVolumeWithChange(count, previousCount)];
      })),
    },
  ];

  return {
    title: "Ticket Volume",
    rows,
    sheetName: sheet.name,
    displayColumns,
    truncated: false,
    source: "calculated",
    monthKeyByDisplayColumn,
  };
}

function buildCalculatedFirstTouchDistributionSection(sheet: ParsedWorkbook["sheets"][number] | null): WorkbookTrendSection | null {
  if (!sheet || sheet.headers.length < 34) return null;

  const ticketIdColumn = sheet.headers[0] ?? null;
  const monthSourceColumn = sheet.headers[1] ?? null;
  const avgAckColumn = sheet.headers[18] ?? null;
  const bucketColumn = sheet.headers[33] ?? null;
  if (!ticketIdColumn || !monthSourceColumn || !bucketColumn) return null;

  const totalByMonth = new Map<string, number>();
  const bucket0to5ByMonth = new Map<string, number>();
  const bucket5to10ByMonth = new Map<string, number>();
  const bucket10to30ByMonth = new Map<string, number>();
  const bucket30PlusByMonth = new Map<string, number>();
  const ackTotalsByMonth = new Map<string, number>();
  const ackCountsByMonth = new Map<string, number>();

  for (const row of sheet.rows) {
    const ticketId = normalizeHeaderValue(row[ticketIdColumn]);
    const monthKey = toMonthKey(row[monthSourceColumn]);
    if (!ticketId || !monthKey) continue;

    totalByMonth.set(monthKey, (totalByMonth.get(monthKey) ?? 0) + 1);

    const bucket = normalizeHeaderValue(row[bucketColumn])?.toLowerCase() ?? "";
    let isRecognizedBucket = false;
    if (/^0\s*-\s*5\s*min/.test(bucket)) {
      bucket0to5ByMonth.set(monthKey, (bucket0to5ByMonth.get(monthKey) ?? 0) + 1);
      isRecognizedBucket = true;
    } else if (/^5\s*-\s*10\s*min/.test(bucket)) {
      bucket5to10ByMonth.set(monthKey, (bucket5to10ByMonth.get(monthKey) ?? 0) + 1);
      isRecognizedBucket = true;
    } else if (/^10\s*-\s*30\s*min/.test(bucket)) {
      bucket10to30ByMonth.set(monthKey, (bucket10to30ByMonth.get(monthKey) ?? 0) + 1);
      isRecognizedBucket = true;
    } else if (/30\+\s*min|30\s*plus\s*min/.test(bucket)) {
      bucket30PlusByMonth.set(monthKey, (bucket30PlusByMonth.get(monthKey) ?? 0) + 1);
      isRecognizedBucket = true;
    }

    if (isRecognizedBucket) {
      const rawAckValue = avgAckColumn ? row[avgAckColumn] : null;
      const ackValue = rawAckValue == null || String(rawAckValue).trim() === "" ? 0 : parseMetricNumber(rawAckValue);
      if (ackValue != null) {
        ackTotalsByMonth.set(monthKey, (ackTotalsByMonth.get(monthKey) ?? 0) + ackValue);
        ackCountsByMonth.set(monthKey, (ackCountsByMonth.get(monthKey) ?? 0) + 1);
      }
    }
  }

  const monthKeys = Array.from(totalByMonth.keys()).sort(monthSort);
  if (monthKeys.length === 0) return null;

  const displayColumns = monthKeys.map(formatMonthColumnLabel);
  const monthLabelMap = new Map(monthKeys.map((monthKey) => [monthKey, formatMonthColumnLabel(monthKey)]));
  const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
  const formatAverage = (value: number | null) => (value == null ? "—" : value.toFixed(1));

  const rows = [
    {
      label: "0 - 5 Minutes",
      values: Object.fromEntries(monthKeys.map((monthKey) => [monthLabelMap.get(monthKey) ?? monthKey, String(bucket0to5ByMonth.get(monthKey) ?? 0)])),
    },
    {
      label: "5 - 10 Minutes",
      values: Object.fromEntries(monthKeys.map((monthKey) => [monthLabelMap.get(monthKey) ?? monthKey, String(bucket5to10ByMonth.get(monthKey) ?? 0)])),
    },
    {
      label: "10 - 30 Minutes",
      values: Object.fromEntries(monthKeys.map((monthKey) => [monthLabelMap.get(monthKey) ?? monthKey, String(bucket10to30ByMonth.get(monthKey) ?? 0)])),
    },
    {
      label: "30+ Minutes",
      values: Object.fromEntries(monthKeys.map((monthKey) => [monthLabelMap.get(monthKey) ?? monthKey, String(bucket30PlusByMonth.get(monthKey) ?? 0)])),
    },
    {
      label: "% within 5 min",
      values: Object.fromEntries(monthKeys.map((monthKey) => {
        const bucket0to5 = bucket0to5ByMonth.get(monthKey) ?? 0;
        const bucket5to10 = bucket5to10ByMonth.get(monthKey) ?? 0;
        const bucket10to30 = bucket10to30ByMonth.get(monthKey) ?? 0;
        const bucket30Plus = bucket30PlusByMonth.get(monthKey) ?? 0;
        const totalBucketCount = bucket0to5 + bucket5to10 + bucket10to30 + bucket30Plus;
        return [monthLabelMap.get(monthKey) ?? monthKey, totalBucketCount > 0 ? formatPercent(bucket0to5 / totalBucketCount) : "0%"];
      })),
    },
    {
      label: "% within 10 min",
      values: Object.fromEntries(monthKeys.map((monthKey) => {
        const bucket0to5 = bucket0to5ByMonth.get(monthKey) ?? 0;
        const bucket5to10 = bucket5to10ByMonth.get(monthKey) ?? 0;
        const bucket10to30 = bucket10to30ByMonth.get(monthKey) ?? 0;
        const bucket30Plus = bucket30PlusByMonth.get(monthKey) ?? 0;
        const total = bucket0to5 + bucket5to10 + bucket10to30 + bucket30Plus;
        const within10 = bucket0to5 + bucket5to10;
        return [monthLabelMap.get(monthKey) ?? monthKey, total > 0 ? formatPercent(within10 / total) : "0%"];
      })),
    },
    {
      label: "Avg Ack Time",
      values: Object.fromEntries(monthKeys.map((monthKey) => {
        const total = ackTotalsByMonth.get(monthKey) ?? 0;
        const count = ackCountsByMonth.get(monthKey) ?? 0;
        return [monthLabelMap.get(monthKey) ?? monthKey, formatAverage(count > 0 ? total / count : null)];
      })),
    },
  ];

  return {
    title: "First Touch Distribution",
    rows,
    sheetName: sheet.name,
    displayColumns,
    truncated: false,
    source: "calculated",
  };
}

function buildCalculatedTimeToCarrierTicketSection(sheet: ParsedWorkbook["sheets"][number] | null): WorkbookTrendSection | null {
  if (!sheet || sheet.headers.length < 35) return null;

  const ticketIdColumn = sheet.headers[0] ?? null;
  const monthSourceColumn = sheet.headers[1] ?? null;
  const bucketColumn = sheet.headers[34] ?? null;
  if (!ticketIdColumn || !monthSourceColumn || !bucketColumn) return null;

  const under15ByMonth = new Map<string, number>();
  const bucket15to25ByMonth = new Map<string, number>();
  const bucket25to35ByMonth = new Map<string, number>();
  const bucket35to60ByMonth = new Map<string, number>();
  const bucket60PlusByMonth = new Map<string, number>();

  for (const row of sheet.rows) {
    const ticketId = normalizeHeaderValue(row[ticketIdColumn]);
    const monthKey = toMonthKey(row[monthSourceColumn]);
    if (!ticketId || !monthKey) continue;

    const bucket = normalizeHeaderValue(row[bucketColumn])?.toLowerCase() ?? "";
    if (/^under\s*15\s*min/.test(bucket)) {
      under15ByMonth.set(monthKey, (under15ByMonth.get(monthKey) ?? 0) + 1);
    } else if (/^15\s*-\s*25\s*min/.test(bucket)) {
      bucket15to25ByMonth.set(monthKey, (bucket15to25ByMonth.get(monthKey) ?? 0) + 1);
    } else if (/^25\s*-\s*35\s*min/.test(bucket)) {
      bucket25to35ByMonth.set(monthKey, (bucket25to35ByMonth.get(monthKey) ?? 0) + 1);
    } else if (/^35\s*-\s*60\s*min/.test(bucket)) {
      bucket35to60ByMonth.set(monthKey, (bucket35to60ByMonth.get(monthKey) ?? 0) + 1);
    } else if (/^60\+\s*min|^60\s*\+\s*min/.test(bucket)) {
      bucket60PlusByMonth.set(monthKey, (bucket60PlusByMonth.get(monthKey) ?? 0) + 1);
    }
  }

  const monthKeySet = new Set<string>([
    ...under15ByMonth.keys(),
    ...bucket15to25ByMonth.keys(),
    ...bucket25to35ByMonth.keys(),
    ...bucket35to60ByMonth.keys(),
    ...bucket60PlusByMonth.keys(),
  ]);
  const monthKeys = Array.from(monthKeySet).sort(monthSort);
  if (monthKeys.length === 0) return null;

  const displayColumns = monthKeys.map(formatMonthColumnLabel);
  const monthLabelMap = new Map(monthKeys.map((monthKey) => [monthKey, formatMonthColumnLabel(monthKey)]));

  const rows = [
    {
      label: "Under 15 Minutes",
      values: Object.fromEntries(monthKeys.map((monthKey) => [monthLabelMap.get(monthKey) ?? monthKey, String(under15ByMonth.get(monthKey) ?? 0)])),
    },
    {
      label: "15 - 25 Minutes",
      values: Object.fromEntries(monthKeys.map((monthKey) => [monthLabelMap.get(monthKey) ?? monthKey, String(bucket15to25ByMonth.get(monthKey) ?? 0)])),
    },
    {
      label: "25 - 35 Minutes",
      values: Object.fromEntries(monthKeys.map((monthKey) => [monthLabelMap.get(monthKey) ?? monthKey, String(bucket25to35ByMonth.get(monthKey) ?? 0)])),
    },
    {
      label: "35 - 60 Minutes",
      values: Object.fromEntries(monthKeys.map((monthKey) => [monthLabelMap.get(monthKey) ?? monthKey, String(bucket35to60ByMonth.get(monthKey) ?? 0)])),
    },
    {
      label: "60+ Minutes",
      values: Object.fromEntries(monthKeys.map((monthKey) => [monthLabelMap.get(monthKey) ?? monthKey, String(bucket60PlusByMonth.get(monthKey) ?? 0)])),
    },
  ];

  return {
    title: "Time to Carrier Ticket",
    rows,
    sheetName: sheet.name,
    displayColumns,
    truncated: false,
    source: "calculated",
  };
}

function buildCalculatedTicketResolutionsSection(sheet: ParsedWorkbook["sheets"][number] | null): WorkbookTrendSection | null {
  if (!sheet || sheet.headers.length < 36) return null;

  const ticketIdColumn = sheet.headers[0] ?? null;
  const monthSourceColumn = sheet.headers[1] ?? null;
  const resolutionColumn = sheet.headers[35] ?? null;
  if (!ticketIdColumn || !monthSourceColumn || !resolutionColumn) return null;

  const countsByResolution = new Map<string, Map<string, number>>();
  const monthKeySet = new Set<string>();
  const totalByMonth = new Map<string, number>();

  for (const row of sheet.rows) {
    const ticketId = normalizeHeaderValue(row[ticketIdColumn]);
    const monthKey = toMonthKey(row[monthSourceColumn]);
    const resolution = normalizeHeaderValue(row[resolutionColumn]);
    if (!ticketId || !monthKey || !resolution) continue;

    monthKeySet.add(monthKey);
    totalByMonth.set(monthKey, (totalByMonth.get(monthKey) ?? 0) + 1);
    const monthCounts = countsByResolution.get(resolution) ?? new Map<string, number>();
    monthCounts.set(monthKey, (monthCounts.get(monthKey) ?? 0) + 1);
    countsByResolution.set(resolution, monthCounts);
  }

  const monthKeys = Array.from(monthKeySet).sort(monthSort);
  if (monthKeys.length === 0 || countsByResolution.size === 0) return null;

  const displayColumns = monthKeys.map(formatMonthColumnLabel);
  const monthLabelMap = new Map(monthKeys.map((monthKey) => [monthKey, formatMonthColumnLabel(monthKey)]));
  const monthKeyByDisplayColumn = Object.fromEntries(monthKeys.map((monthKey) => [formatMonthColumnLabel(monthKey), monthKey]));
  const formatCountWithPercent = (count: number, total: number) => {
    if (total <= 0) return `${count} (0%)`;
    const percent = Math.round((count / total) * 100);
    return `${count} (${percent}%)`;
  };

  const rows = Array.from(countsByResolution.entries())
    .map(([resolution, monthCounts]) => ({
      label: resolution,
      total: Array.from(monthCounts.values()).reduce((sum, count) => sum + count, 0),
      values: Object.fromEntries(monthKeys.map((monthKey) => {
        const count = monthCounts.get(monthKey) ?? 0;
        const total = totalByMonth.get(monthKey) ?? 0;
        return [monthLabelMap.get(monthKey) ?? monthKey, formatCountWithPercent(count, total)];
      })),
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .map(({ label, values }) => ({ label, values }));

  return {
    title: "Ticket Resolutions",
    rows,
    sheetName: sheet.name,
    displayColumns,
    truncated: false,
    source: "calculated",
    monthKeyByDisplayColumn,
  };
}

function buildCalculatedTopIssueTypesSection(sheet: ParsedWorkbook["sheets"][number] | null): WorkbookTrendSection | null {
  if (!sheet || sheet.headers.length < 38) return null;

  const ticketIdColumn = sheet.headers[0] ?? null;
  const monthSourceColumn = sheet.headers[1] ?? null;
  const issueTypeColumn = sheet.headers[37] ?? null;
  if (!ticketIdColumn || !monthSourceColumn || !issueTypeColumn) return null;

  const countsByIssueType = new Map<string, Map<string, number>>();
  const monthKeySet = new Set<string>();
  const totalByMonth = new Map<string, number>();
  const vcomByMonth = new Map<string, number>();

  for (const row of sheet.rows) {
    const ticketId = normalizeHeaderValue(row[ticketIdColumn]);
    const monthKey = toMonthKey(row[monthSourceColumn]);
    const issueType = normalizeHeaderValue(row[issueTypeColumn]);
    if (!ticketId || !monthKey || !issueType) continue;

    monthKeySet.add(monthKey);
    totalByMonth.set(monthKey, (totalByMonth.get(monthKey) ?? 0) + 1);

    const normalizedIssueType = issueType.trim().toLowerCase();
    if (normalizedIssueType === "mns / sd-wan alert" || normalizedIssueType === "maintenance notification") {
      vcomByMonth.set(monthKey, (vcomByMonth.get(monthKey) ?? 0) + 1);
    }

    const monthCounts = countsByIssueType.get(issueType) ?? new Map<string, number>();
    monthCounts.set(monthKey, (monthCounts.get(monthKey) ?? 0) + 1);
    countsByIssueType.set(issueType, monthCounts);
  }

  const monthKeys = Array.from(monthKeySet).sort(monthSort);
  if (monthKeys.length === 0 || countsByIssueType.size === 0) return null;

  const displayColumns = monthKeys.map(formatMonthColumnLabel);
  const monthLabelMap = new Map(monthKeys.map((monthKey) => [monthKey, formatMonthColumnLabel(monthKey)]));
  const monthKeyByDisplayColumn = Object.fromEntries(monthKeys.map((monthKey) => [formatMonthColumnLabel(monthKey), monthKey]));
  const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

  const issueRows = Array.from(countsByIssueType.entries())
    .map(([issueType, monthCounts]) => ({
      label: issueType,
      total: Array.from(monthCounts.values()).reduce((sum, count) => sum + count, 0),
      values: Object.fromEntries(monthKeys.map((monthKey) => [monthLabelMap.get(monthKey) ?? monthKey, String(monthCounts.get(monthKey) ?? 0)])),
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .map(({ label, values }) => ({ label, values }));

  const rows = [
    ...issueRows,
    {
      label: "% opened by vCom Solutions",
      values: Object.fromEntries(monthKeys.map((monthKey) => {
        const total = totalByMonth.get(monthKey) ?? 0;
        const vcom = vcomByMonth.get(monthKey) ?? 0;
        return [monthLabelMap.get(monthKey) ?? monthKey, total > 0 ? formatPercent(vcom / total) : "0%"];
      })),
    },
    {
      label: "% opened by customer",
      values: Object.fromEntries(monthKeys.map((monthKey) => {
        const total = totalByMonth.get(monthKey) ?? 0;
        const vcom = vcomByMonth.get(monthKey) ?? 0;
        const customerRaised = Math.max(total - vcom, 0);
        return [monthLabelMap.get(monthKey) ?? monthKey, total > 0 ? formatPercent(customerRaised / total) : "0%"];
      })),
    },
  ];

  return {
    title: "Top Issue Types",
    rows,
    sheetName: sheet.name,
    displayColumns,
    truncated: false,
    source: "calculated",
    monthKeyByDisplayColumn,
  };
}

function buildCalculatedTopCarriersSection(sheet: ParsedWorkbook["sheets"][number] | null): WorkbookTrendSection | null {
  if (!sheet || sheet.headers.length < 6) return null;

  const ticketIdColumn = sheet.headers[0] ?? null;
  const monthSourceColumn = sheet.headers[1] ?? null;
  const carrierColumn = sheet.headers[5] ?? null;
  if (!ticketIdColumn || !monthSourceColumn || !carrierColumn) return null;

  const countsByCarrier = new Map<string, Map<string, number>>();
  const monthKeySet = new Set<string>();
  const topCarrierNames = new Set(getTopCarrierNames(sheet, 15));
  if (topCarrierNames.size === 0) return null;

  for (const row of sheet.rows) {
    const ticketId = normalizeHeaderValue(row[ticketIdColumn]);
    const monthKey = toMonthKey(row[monthSourceColumn]);
    const carrier = normalizeHeaderValue(row[carrierColumn]);
    if (!ticketId || !monthKey || !carrier || !topCarrierNames.has(carrier)) continue;

    monthKeySet.add(monthKey);
    const monthCounts = countsByCarrier.get(carrier) ?? new Map<string, number>();
    monthCounts.set(monthKey, (monthCounts.get(monthKey) ?? 0) + 1);
    countsByCarrier.set(carrier, monthCounts);
  }

  const monthKeys = Array.from(monthKeySet).sort(monthSort);
  if (monthKeys.length === 0 || countsByCarrier.size === 0) return null;

  const displayColumns = monthKeys.map(formatMonthColumnLabel);
  const monthLabelMap = new Map(monthKeys.map((monthKey) => [monthKey, formatMonthColumnLabel(monthKey)]));

  const rows = getTopCarrierNames(sheet, 15)
    .filter((carrier) => countsByCarrier.has(carrier))
    .map((carrier) => {
      const monthCounts = countsByCarrier.get(carrier) ?? new Map<string, number>();
      return {
        label: carrier,
        values: Object.fromEntries(monthKeys.map((monthKey) => [monthLabelMap.get(monthKey) ?? monthKey, String(monthCounts.get(monthKey) ?? 0)])),
      };
    });

  return {
    title: "Top 15 Carriers",
    rows,
    sheetName: sheet.name,
    displayColumns,
    truncated: false,
    source: "calculated",
  };
}

function buildCalculatedAvgMttrSection(sheet: ParsedWorkbook["sheets"][number] | null): WorkbookTrendSection | null {
  if (!sheet || sheet.headers.length < 16) return null;

  const ticketIdColumn = sheet.headers[0] ?? null;
  const monthSourceColumn = sheet.headers[1] ?? null;
  const carrierColumn = sheet.headers[5] ?? null;
  const mttrColumn = sheet.headers[15] ?? null;
  if (!ticketIdColumn || !monthSourceColumn || !carrierColumn || !mttrColumn) return null;

  const topCarrierNames = getTopCarrierNames(sheet, 15);
  if (topCarrierNames.length === 0) return null;

  const topCarrierSet = new Set(topCarrierNames);
  const mttrByCarrier = new Map<string, Map<string, { total: number; count: number }>>();
  const monthKeySet = new Set<string>();

  for (const row of sheet.rows) {
    const ticketId = normalizeHeaderValue(row[ticketIdColumn]);
    const monthKey = toMonthKey(row[monthSourceColumn]);
    const carrier = normalizeHeaderValue(row[carrierColumn]);
    const mttrValue = parseMetricNumber(row[mttrColumn]);
    if (!ticketId || !monthKey || !carrier || !topCarrierSet.has(carrier) || mttrValue == null) continue;

    monthKeySet.add(monthKey);
    const carrierMonths = mttrByCarrier.get(carrier) ?? new Map<string, { total: number; count: number }>();
    const existing = carrierMonths.get(monthKey) ?? { total: 0, count: 0 };
    carrierMonths.set(monthKey, { total: existing.total + mttrValue, count: existing.count + 1 });
    mttrByCarrier.set(carrier, carrierMonths);
  }

  const monthKeys = Array.from(monthKeySet).sort(monthSort);
  if (monthKeys.length === 0 || mttrByCarrier.size === 0) return null;

  const displayColumns = monthKeys.map(formatMonthColumnLabel);
  const monthLabelMap = new Map(monthKeys.map((monthKey) => [monthKey, formatMonthColumnLabel(monthKey)]));

  const rows = topCarrierNames
    .filter((carrier) => mttrByCarrier.has(carrier))
    .map((carrier) => {
      const carrierMonths = mttrByCarrier.get(carrier) ?? new Map<string, { total: number; count: number }>();
      return {
        label: carrier,
        values: Object.fromEntries(monthKeys.map((monthKey) => {
          const stats = carrierMonths.get(monthKey);
          const average = stats && stats.count > 0 ? stats.total / stats.count : null;
          return [monthLabelMap.get(monthKey) ?? monthKey, average == null ? "—" : average.toFixed(2)];
        })),
      };
    });

  return {
    title: "Avg MTTR",
    rows,
    sheetName: sheet.name,
    displayColumns,
    truncated: false,
    source: "calculated",
  };
}

function getCalculatedSheetCandidates(parsed: ParsedWorkbook, selectedSheetName?: string | null) {
  const selectedSheet = parsed.sheets.find((entry) => entry.name === selectedSheetName) ?? null;
  return selectedSheet ? [selectedSheet] : parsed.sheets;
}

function pickCalculatedSection(
  sheets: ParsedWorkbook["sheets"],
  builder: (sheet: ParsedWorkbook["sheets"][number] | null) => WorkbookTrendSection | null,
  filters: OperationalFilters,
): WorkbookTrendSection | null {
  for (const sheet of sheets) {
    const filteredSheet = filterSheetRowsByOperationalFilters(sheet, filters);
    const section = builder(filteredSheet);
    if (section) return section;
  }
  return null;
}

function formatMttrValue(value: number) {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function getTopMttrTicketsForMonth(
  parsed: ParsedWorkbook | null,
  sheetName: string,
  monthKey: string,
  filters: OperationalFilters,
  sectionTitle: string,
  limit = 10,
  minimumMttrHours = 8,
): ExtendedMttrTicket[] {
  const sheet = parsed?.sheets.find((entry) => entry.name === sheetName) ?? null;
  if (!sheet || sheet.headers.length < 38) return [];

  const ticketIdColumn = sheet.headers[0] ?? null;
  const monthSourceColumn = sheet.headers[1] ?? null;
  const carrierColumn = sheet.headers[5] ?? null;
  const mttrColumn = sheet.headers[15] ?? null;
  const resolutionColumn = sheet.headers[35] ?? null;
  const issueTypeColumn = sheet.headers[37] ?? null;
  if (!ticketIdColumn || !monthSourceColumn || !carrierColumn || !mttrColumn) return [];

  return sheet.rows
    .filter((row) => rowMatchesOperationalFilters(row, sheet, filters))
    .flatMap((row) => {
      const ticketId = normalizeHeaderValue(row[ticketIdColumn]);
      const rowMonthKey = toMonthKey(row[monthSourceColumn]);
      const carrier = normalizeHeaderValue(row[carrierColumn]);
      const resolution = resolutionColumn ? normalizeHeaderValue(row[resolutionColumn]) : null;
      const issueType = issueTypeColumn ? normalizeHeaderValue(row[issueTypeColumn]) : null;
      const mttr = parseMetricNumber(row[mttrColumn]);
      if (!ticketId || rowMonthKey !== monthKey || !carrier || mttr == null) return [];
      if (mttr <= minimumMttrHours) return [];
      if (sectionTitle === "Ticket Volume" && !resolution) return [];
      if (sectionTitle === "Top Issue Types" && !issueType) return [];
      return [{ ticketId, carrier, resolution: resolution ?? undefined, issueType: issueType ?? undefined, mttr }];
    })
    .sort((a, b) => b.mttr - a.mttr || a.ticketId.localeCompare(b.ticketId))
    .slice(0, limit);
}

function getMttrTicketCountForMonth(
  parsed: ParsedWorkbook | null,
  sheetName: string,
  monthKey: string,
  filters: OperationalFilters,
  minimumMttrHours = 8,
): number {
  const sheet = parsed?.sheets.find((entry) => entry.name === sheetName) ?? null;
  if (!sheet || sheet.headers.length < 16) return 0;

  const ticketIdColumn = sheet.headers[0] ?? null;
  const monthSourceColumn = sheet.headers[1] ?? null;
  const mttrColumn = sheet.headers[15] ?? null;
  if (!ticketIdColumn || !monthSourceColumn || !mttrColumn) return 0;

  let count = 0;

  for (const row of sheet.rows) {
    if (!rowMatchesOperationalFilters(row, sheet, filters)) continue;

    const ticketId = normalizeHeaderValue(row[ticketIdColumn]);
    const rowMonthKey = toMonthKey(row[monthSourceColumn]);
    const mttr = parseMetricNumber(row[mttrColumn]);
    if (!ticketId || rowMonthKey !== monthKey || mttr == null || mttr <= minimumMttrHours) continue;

    count += 1;
  }

  return count;
}

function getIssueTypeOpenPercentagesForMonth(
  parsed: ParsedWorkbook | null,
  sheetName: string,
  monthKey: string,
  filters: OperationalFilters,
): IssueTypeOpenPercentages {
  const sheet = parsed?.sheets.find((entry) => entry.name === sheetName) ?? null;
  if (!sheet) {
    return { customerOpenedPercent: "0%", vcomOpenedPercent: "0%" };
  }

  const ticketIdColumn = sheet.headers[0] ?? null;
  const monthSourceColumn = sheet.headers[1] ?? null;
  if (!ticketIdColumn || !monthSourceColumn) {
    return { customerOpenedPercent: "0%", vcomOpenedPercent: "0%" };
  }

  const mobilityOpenedByColumn = sheet.headers[12] ?? null;
  const issueTypeColumn = sheet.headers[37] ?? null;
  const isMobility = filters.reportedVia === "mobility";
  const mobilityVcomOpenedByNames = new Set([
    "karthik radhakrishnan",
    "sriram parisa",
    "lokesh naik banavath",
    "pranav dandibhotla",
    "hamza rahmani",
    "mohammed zubairuddin",
    "kenya gentry",
    "akram ahmed",
    "mohammed ashraf",
    "otukho olembo",
    "mahalakshmi samiti",
    "abhishek benarji",
    "akash hanvate",
    "kartik damagalla",
    "perry cox",
    "anirudh kukudala",
  ]);

  let total = 0;
  let vcom = 0;

  for (const row of sheet.rows) {
    if (!rowMatchesOperationalFilters(row, sheet, filters)) continue;

    const ticketId = normalizeHeaderValue(row[ticketIdColumn]);
    const rowMonthKey = toMonthKey(row[monthSourceColumn]);
    if (!ticketId || rowMonthKey !== monthKey) continue;

    if (isMobility) {
      const openedBy = normalizeHeaderValue(row[mobilityOpenedByColumn ?? ""]);
      if (!openedBy) continue;

      total += 1;
      if (mobilityVcomOpenedByNames.has(openedBy.trim().toLowerCase())) {
        vcom += 1;
      }
      continue;
    }

    const issueType = issueTypeColumn ? normalizeHeaderValue(row[issueTypeColumn]) : null;
    if (!issueType) continue;

    total += 1;
    const normalizedIssueType = issueType.trim().toLowerCase();
    if (normalizedIssueType === "mns / sd-wan alert" || normalizedIssueType === "maintenance notification") {
      vcom += 1;
    }
  }

  if (total === 0) {
    return { customerOpenedPercent: "0%", vcomOpenedPercent: "0%" };
  }

  const vcomPercent = `${Math.round((vcom / total) * 100)}%`;
  const customerPercent = `${Math.round(((total - vcom) / total) * 100)}%`;

  return {
    customerOpenedPercent: customerPercent,
    vcomOpenedPercent: vcomPercent,
  };
}

function normalizeResolutionBucket(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getResolutionBucketPercentagesForMonth(
  parsed: ParsedWorkbook | null,
  sheetName: string,
  monthKey: string,
  filters: OperationalFilters,
): ResolutionBucketPercentages {
  const sheet = parsed?.sheets.find((entry) => entry.name === sheetName) ?? null;
  if (!sheet || sheet.headers.length < 36) {
    return {
      carrierNetworkIssuePercent: "0%",
      customerIssuePercent: "0%",
      noTroubleFoundPercent: "0%",
      othersPercent: "0%",
    };
  }

  const ticketIdColumn = sheet.headers[0] ?? null;
  const monthSourceColumn = sheet.headers[1] ?? null;
  const resolutionColumn = sheet.headers[35] ?? null;
  if (!ticketIdColumn || !monthSourceColumn || !resolutionColumn) {
    return {
      carrierNetworkIssuePercent: "0%",
      customerIssuePercent: "0%",
      noTroubleFoundPercent: "0%",
      othersPercent: "0%",
    };
  }

  let total = 0;
  let carrierNetworkIssue = 0;
  let customerIssue = 0;
  let noTroubleFound = 0;
  let others = 0;

  for (const row of sheet.rows) {
    if (!rowMatchesOperationalFilters(row, sheet, filters)) continue;

    const ticketId = normalizeHeaderValue(row[ticketIdColumn]);
    const rowMonthKey = toMonthKey(row[monthSourceColumn]);
    const resolution = normalizeHeaderValue(row[resolutionColumn]);
    if (!ticketId || rowMonthKey !== monthKey || !resolution) continue;

    total += 1;
    const normalizedResolution = normalizeResolutionBucket(resolution);
    if (normalizedResolution === "carrier network issue") {
      carrierNetworkIssue += 1;
    } else if (
      normalizedResolution === "customer equipment issue"
      || normalizedResolution === "customer power"
      || normalizedResolution === "customer maintenance"
    ) {
      customerIssue += 1;
    } else if (normalizedResolution === "no trouble found") {
      noTroubleFound += 1;
    } else {
      others += 1;
    }
  }

  const formatPercent = (count: number) => `${total > 0 ? Math.round((count / total) * 100) : 0}%`;

  return {
    carrierNetworkIssuePercent: formatPercent(carrierNetworkIssue),
    customerIssuePercent: formatPercent(customerIssue),
    noTroubleFoundPercent: formatPercent(noTroubleFound),
    othersPercent: formatPercent(others),
  };
}

function getResolutionSummaryRowsForMonth(
  parsed: ParsedWorkbook | null,
  sheetName: string,
  monthKey: string,
  filters: OperationalFilters,
): ResolutionSummaryRow[] {
  if (filters.reportedVia === "mobility") {
    const sheet = parsed?.sheets.find((entry) => entry.name === sheetName) ?? null;
    if (!sheet || sheet.headers.length < 36) {
      return [
        { label: "Activation Assistance", value: "0%" },
        { label: "eSIM Re-Provisioned", value: "0%" },
        { label: "Voicemail / Data / Calls Issue", value: "0%" },
        { label: "Others", value: "0%" },
      ];
    }

    const ticketIdColumn = sheet.headers[0] ?? null;
    const monthSourceColumn = sheet.headers[1] ?? null;
    const resolutionColumn = sheet.headers[35] ?? null;
    if (!ticketIdColumn || !monthSourceColumn || !resolutionColumn) {
      return [
        { label: "Activation Assistance", value: "0%" },
        { label: "eSIM Re-Provisioned", value: "0%" },
        { label: "Voicemail / Data / Calls Issue", value: "0%" },
        { label: "Others", value: "0%" },
      ];
    }

    let total = 0;
    let activationAssistance = 0;
    let esimReProvisioned = 0;
    let voicemailDataCalls = 0;
    let orderNeededOthersNoTroubleFound = 0;

    for (const row of sheet.rows) {
      if (!rowMatchesOperationalFilters(row, sheet, filters)) continue;

      const ticketId = normalizeHeaderValue(row[ticketIdColumn]);
      const rowMonthKey = toMonthKey(row[monthSourceColumn]);
      const resolution = normalizeHeaderValue(row[resolutionColumn]);
      if (!ticketId || rowMonthKey !== monthKey || !resolution) continue;

      total += 1;
      const normalizedResolution = normalizeResolutionBucket(resolution);
      if (normalizedResolution === "activation assistance") {
        activationAssistance += 1;
      } else if (
        normalizedResolution === "esim re-provisioned"
        || normalizedResolution === "e-sim re-provisioned"
        || normalizedResolution === "esim reprovisioned"
      ) {
        esimReProvisioned += 1;
      } else if (
        normalizedResolution === "voicemail / visual voicemail issue"
        || normalizedResolution === "voicemail/visual voicemail issue"
        || normalizedResolution === "data issue"
        || normalizedResolution === "calls inbound/ outbound issue"
        || normalizedResolution === "calls inbound / outbound issue"
        || normalizedResolution === "calls inbound/outbound issue"
      ) {
        voicemailDataCalls += 1;
      } else if (
        normalizedResolution === "order needed"
        || normalizedResolution === "others"
        || normalizedResolution === "no trouble found"
      ) {
        orderNeededOthersNoTroubleFound += 1;
      } else {
        orderNeededOthersNoTroubleFound += 1;
      }
    }

    const formatPercent = (count: number) => `${total > 0 ? Math.round((count / total) * 100) : 0}%`;

    return [
      { label: "Activation Assistance", value: formatPercent(activationAssistance) },
      { label: "eSIM Re-Provisioned", value: formatPercent(esimReProvisioned) },
      { label: "Voicemail / Data / Calls Issue", value: formatPercent(voicemailDataCalls) },
      { label: "Others", value: formatPercent(orderNeededOthersNoTroubleFound) },
    ];
  }

  const percentages = getResolutionBucketPercentagesForMonth(parsed, sheetName, monthKey, filters);
  return [
    { label: "Carrier Network Issue", value: percentages.carrierNetworkIssuePercent },
    { label: "Customer CPE / Power / Maintenance", value: percentages.customerIssuePercent },
    { label: "No Trouble Found", value: percentages.noTroubleFoundPercent },
    { label: "Others", value: percentages.othersPercent },
  ];
}

function buildTicketVolumeSeriesFromSection(section: WorkbookTrendSection | null): TicketVolumeChartSeries[] {
  if (!section || section.title !== "Top Issue Types") return [];

  const issueRows = section.rows.filter((row) => !row.label.startsWith("% "));
  if (issueRows.length === 0) return [];

  return issueRows.map((row, index) => ({
    key: `issue-${index}-${row.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "other"}`,
    label: row.label.trim(),
    color: TICKET_VOLUME_DYNAMIC_PALETTE[index % TICKET_VOLUME_DYNAMIC_PALETTE.length],
    aliases: [row.label.trim().toLowerCase()],
  }));
}

function buildTicketVolumeChartDataset(
  section: WorkbookTrendSection | null,
  seriesDefinitions: readonly TicketVolumeChartSeries[],
): TicketVolumeChartMonth[] {
  if (!section || section.title !== "Top Issue Types") return [];

  const issueRows = section.rows.filter((row) => !row.label.startsWith("% "));
  if (issueRows.length === 0 || seriesDefinitions.length === 0) return [];

  return section.displayColumns.map((monthLabel) => {
    const countsBySeries = new Map<string, number>(seriesDefinitions.map((series) => [series.key, 0]));

    for (const row of issueRows) {
      const rawValue = parseMetricNumber(row.values[monthLabel]);
      const value = rawValue != null ? Math.max(Math.round(rawValue), 0) : 0;
      if (value <= 0) continue;

      const normalizedLabel = row.label.trim().toLowerCase();
      const matchedSeries = seriesDefinitions.find((series) => (series.aliases ?? [series.label.toLowerCase()]).includes(normalizedLabel));
      if (!matchedSeries) continue;
      countsBySeries.set(matchedSeries.key, (countsBySeries.get(matchedSeries.key) ?? 0) + value);
    }

    const segments = seriesDefinitions.map((series) => ({
      key: series.key,
      label: series.label,
      color: series.color,
      value: countsBySeries.get(series.key) ?? 0,
    }));

    return {
      monthLabel,
      total: segments.reduce((sum, segment) => sum + segment.value, 0),
      segments,
    };
  }).filter((month) => month.total > 0);
}

function buildResolutionChartDataset(
  section: WorkbookTrendSection | null,
  seriesDefinitions: readonly TicketVolumeChartSeries[],
): TicketVolumeChartMonth[] {
  if (!section || section.title !== "Ticket Resolutions") return [];
  if (section.rows.length === 0 || seriesDefinitions.length === 0) return [];

  return section.displayColumns.map((monthLabel) => {
    const countsBySeries = new Map<string, number>(seriesDefinitions.map((series) => [series.key, 0]));

    for (const row of section.rows) {
      const rawValue = row.values[monthLabel] ?? "0";
      const match = String(rawValue).match(/^\s*(\d+)/);
      const value = match ? Number(match[1]) : 0;
      if (value <= 0) continue;

      const normalizedLabel = row.label.trim().toLowerCase();
      const matchedSeries = seriesDefinitions.find((series) => (series.aliases ?? [series.label.toLowerCase()]).includes(normalizedLabel));
      const targetSeries = matchedSeries ?? seriesDefinitions.find((series) => series.key === "others");
      if (!targetSeries) continue;

      countsBySeries.set(targetSeries.key, (countsBySeries.get(targetSeries.key) ?? 0) + value);
    }

    const segments = seriesDefinitions.map((series) => ({
      key: series.key,
      label: series.label,
      color: series.color,
      value: countsBySeries.get(series.key) ?? 0,
    }));

    return {
      monthLabel,
      total: segments.reduce((sum, segment) => sum + segment.value, 0),
      segments,
    };
  }).filter((month) => month.total > 0);
}

function buildTimeToCarrierPercentageDataset(section: WorkbookTrendSection | null): TicketVolumeChartMonth[] {
  if (!section || section.title !== "Time to Carrier Ticket") return [];

  return section.displayColumns.map((monthLabel) => {
    let under15Count = 0;
    let over15Count = 0;

    for (const row of section.rows) {
      const rawValue = parseMetricNumber(row.values[monthLabel]);
      const value = rawValue != null ? Math.max(Math.round(rawValue), 0) : 0;
      if (value <= 0) continue;

      const normalizedLabel = row.label.trim().toLowerCase();
      if (normalizedLabel === "under 15 minutes") {
        under15Count += value;
      } else {
        over15Count += value;
      }
    }

    const total = under15Count + over15Count;
    if (total <= 0) return null;

    const under15Percent = Number(((under15Count / total) * 100).toFixed(1));
    const over15Percent = Number((100 - under15Percent).toFixed(1));

    return {
      monthLabel,
      total: 100,
      segments: [
        {
          key: "under-15",
          label: "Under 15 Minutes",
          color: TIME_TO_CARRIER_CHART_SERIES[0].color,
          value: under15Percent,
        },
        {
          key: "over-15",
          label: "Over 15 Minutes",
          color: TIME_TO_CARRIER_CHART_SERIES[1].color,
          value: over15Percent,
        },
      ],
    };
  }).filter((month): month is TicketVolumeChartMonth => month != null);
}

function buildFirstTouchPercentageDataset(section: WorkbookTrendSection | null): TicketVolumeChartMonth[] {
  if (!section || section.title !== "First Touch Distribution") return [];

  return section.displayColumns.map((monthLabel) => {
    const within5 = Number((parseMetricNumber(section.rows.find((row) => row.label.trim().toLowerCase() === "% within 5 min")?.values[monthLabel]) ?? 0).toFixed(1));
    const boundedWithin5 = Math.min(Math.max(within5, 0), 100);
    const over5 = Number((100 - boundedWithin5).toFixed(1));

    if (boundedWithin5 <= 0 && over5 <= 0) return null;

    return {
      monthLabel,
      total: 100,
      segments: [
        {
          key: "within-5",
          label: "% within 5 min",
          color: FIRST_TOUCH_CHART_SERIES[0].color,
          value: boundedWithin5,
        },
        {
          key: "over-5",
          label: "% over 5 min",
          color: FIRST_TOUCH_CHART_SERIES[1].color,
          value: over5,
        },
      ],
    };
  }).filter((month): month is TicketVolumeChartMonth => month != null);
}

function ChartLogoStamp() {
  return (
    <div
      style={{
        position: "absolute",
        right: 14,
        bottom: 10,
        zIndex: 2,
        pointerEvents: "none",
        borderRadius: "8px",
        overflow: "hidden",
      }}
    >
      <img
        src={CHART_LOGO_SRC}
        alt="vCom logo"
        style={{
          display: "block",
          width: 96,
          height: "auto",
        }}
      />
    </div>
  );
}

function TicketVolumesChart({
  title,
  ariaLabel,
  data,
  summary,
  highMttrTickets,
  seriesDefinitions,
  legendBottom = "48px",
}: {
  title: string;
  ariaLabel: string;
  data: TicketVolumeChartMonth[];
  summary: TicketVolumeChartSummary | null;
  highMttrTickets: ExtendedMttrTicket[];
  seriesDefinitions: readonly TicketVolumeChartSeries[];
  legendBottom?: string;
}) {
  const chartHeight = 540;
  const chartWidth = 1280;
  const topPadding = 56;
  const rightPadding = 22;
  const bottomAxisHeight = 44;
  const leftPadding = 20;
  const maxTotal = Math.max(...data.map((entry) => entry.total), 0);
  const yAxisMax = maxTotal <= 0 ? 10 : Math.ceil(maxTotal / 10) * 10 + (maxTotal % 10 === 0 ? 10 : 0);
  const tickStep = yAxisMax <= 20 ? 5 : 10;
  const yTicks = Array.from({ length: Math.floor(yAxisMax / tickStep) + 1 }, (_, index) => index * tickStep);
  const plotHeight = chartHeight - bottomAxisHeight - topPadding;
  const plotWidth = chartWidth - leftPadding - rightPadding;
  const slotWidth = plotWidth / Math.max(data.length, 1);
  const barWidth = Math.min(46, Math.max(24, slotWidth * 0.5));
  const displayedHighMttrTickets = highMttrTickets.slice(0, 5);
  const latestMonth = data.length > 0 ? data[data.length - 1] : null;
  const latestChangeX = data.length > 1
    ? leftPadding + slotWidth * (data.length - 1)
    : data.length > 0
      ? leftPadding + slotWidth / 2
      : 0;
  const previousMonth = data.length > 1 ? data[data.length - 2] : null;
  const monthOverMonthChange = latestMonth && previousMonth && previousMonth.total > 0
    ? ((latestMonth.total - previousMonth.total) / previousMonth.total) * 100
    : null;
  const monthOverMonthDirection = monthOverMonthChange == null
    ? null
    : monthOverMonthChange > 0
      ? "up"
      : monthOverMonthChange < 0
        ? "down"
        : "flat";

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "1360px",
        margin: "0 auto",
        background: CHART_PANEL_BACKGROUND,
        padding: "10px 14px 44px",
        position: "relative",
      }}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          minHeight: "650px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 3.45fr) minmax(292px, 0.9fr)",
          gap: "36px",
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            minWidth: 0,
            display: "grid",
            gridTemplateRows: "88px minmax(0, 1fr) 88px",
            gap: 0,
          }}
        >
          <div />

          <div
            style={{
              minWidth: 0,
              minHeight: 0,
              padding: "0 0 54px",
              background: CHART_PANEL_OVERLAY,
              borderBottom: "1px solid rgba(37, 99, 235, 0.16)",
              position: "relative",
            }}
          >
            <svg
              width="100%"
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label={ariaLabel}
              style={{ display: "block", width: "100%", height: "100%" }}
            >
              <text
                x={chartWidth / 2}
                y={-12}
                textAnchor="middle"
                fontSize="34"
                fontWeight="800"
                fill={CHART_TEXT_PRIMARY}
                letterSpacing="-0.03em"
              >
                {title}
              </text>

              {yTicks.map((tick) => {
                const y = topPadding + plotHeight - (tick / yAxisMax) * plotHeight;
                return (
                  <g key={tick}>
                    <line
                      x1={leftPadding}
                      x2={chartWidth - rightPadding}
                      y1={y}
                      y2={y}
                      stroke="rgba(226, 232, 240, 0.95)"
                      strokeWidth="1"
                    />
                  </g>
                );
              })}

              <line
                x1={leftPadding}
                x2={chartWidth - rightPadding}
                y1={topPadding + plotHeight}
                y2={topPadding + plotHeight}
                stroke="rgba(148, 163, 184, 0.9)"
                strokeWidth="1.15"
              />

              {data.map((month, monthIndex) => {
                const slotCenter = leftPadding + slotWidth * monthIndex + slotWidth / 2;
                const x = slotCenter - barWidth / 2;
                let currentTop = topPadding + plotHeight;

                return (
                  <g key={month.monthLabel}>
                    {month.segments.map((segment, segmentIndex) => {
                      if (segment.value <= 0) return null;
                      const segmentHeight = (segment.value / yAxisMax) * plotHeight;
                      const y = currentTop - segmentHeight;
                      currentTop = y;
                      const isTopSegment = month.segments.slice(segmentIndex + 1).every((nextSegment) => nextSegment.value <= 0);
                      const isBottomSegment = month.segments.slice(0, segmentIndex).every((previousSegment) => previousSegment.value <= 0);

                      return (
                        <g key={`${month.monthLabel}-${segment.key}`}>
                          <rect
                            x={x}
                            y={y}
                            width={barWidth}
                            height={segmentHeight}
                            rx={isTopSegment || isBottomSegment ? 7 : 0}
                            fill={segment.color}
                          />
                          {segmentHeight >= 22 ? (
                            <text
                              x={slotCenter}
                              y={y + segmentHeight / 2 + 4}
                              textAnchor="middle"
                              fontSize="12"
                              fontWeight="800"
                              fill={segment.color === "#A6C557" || segment.color === "#F0A14A" ? "#1f2937" : "white"}
                            >
                              {segment.value}
                            </text>
                          ) : null}
                        </g>
                      );
                    })}

                    <text
                      x={slotCenter}
                      y={topPadding - 18}
                      textAnchor="middle"
                      fontSize="14"
                      fontWeight="800"
                      fill={CHART_TEXT_SECONDARY}
                    >
                      {month.total.toLocaleString()}
                    </text>
                    {monthIndex === data.length - 1 && monthOverMonthChange != null ? (
                      <text
                        x={latestChangeX}
                        y={topPadding - 37}
                        textAnchor="middle"
                        fontSize="13"
                        fontWeight="800"
                        fill={monthOverMonthDirection === "up" ? "#16a34a" : monthOverMonthDirection === "down" ? "#dc2626" : "#64748b"}
                      >
                        {monthOverMonthDirection === "up" ? "↑" : monthOverMonthDirection === "down" ? "↓" : "→"} {Math.abs(monthOverMonthChange).toFixed(1)}%
                      </text>
                    ) : null}
                    <text
                      x={slotCenter}
                      y={chartHeight - 12}
                      textAnchor="middle"
                      fontSize="12"
                      fontWeight="700"
                      fill={CHART_TEXT_SECONDARY}
                    >
                      {month.monthLabel}
                    </text>
                  </g>
                );
              })}
            </svg>

            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: legendBottom,
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: "12px",
                alignItems: "start",
                pointerEvents: "none",
              }}
            >
              <Text
                size="10px"
                tt="uppercase"
                fw={800}
                c={CHART_TEXT_MUTED}
                style={{ letterSpacing: "0.18em", whiteSpace: "nowrap", paddingTop: "2px" }}
              >
                Issue Type
              </Text>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: "8px 20px",
                }}
              >
                {seriesDefinitions.map((series) => (
                  <div
                    key={series.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 999,
                        background: series.color,
                        flexShrink: 0,
                      }}
                    />
                    <Text size="10px" fw={700} c={CHART_TEXT_SECONDARY} style={{ lineHeight: 1.2 }}>
                      {series.label}
                    </Text>
                  </div>
                ))}
              </div>
              <Text
                size="10px"
                fw={800}
                c={CHART_TEXT_MUTED}
                style={{ letterSpacing: "0.14em", textTransform: "uppercase", whiteSpace: "nowrap", paddingTop: "2px" }}
              >
                {seriesDefinitions.length} Categories
              </Text>
            </div>
          </div>

          <div />
        </div>

        <div
          style={{
            minWidth: 0,
            height: "100%",
            display: "grid",
            gridTemplateRows: "88px minmax(0, 1fr) 88px",
            gap: 0,
            alignContent: "stretch",
          }}
        >
          <div />

          <div
            style={{
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-start",
              gap: "8px",
              paddingTop: "36px",
              paddingBottom: "10px",
            }}
          >
            <div
              style={{
                padding: "0 0 10px",
                borderBottom: `1px solid ${CHART_BORDER_SOFT}`,
              }}
            >
              <Group justify="space-between" align="end" gap={10} wrap="nowrap" style={{ marginTop: "64px", marginBottom: "10px" }}>
                <Text
                  c={CHART_TEXT_MUTED}
                  tt="uppercase"
                  fw={800}
                  style={{ fontSize: "0.72rem", lineHeight: 1.1, letterSpacing: "0.24em" }}
                >
                  {summary ? `Latest Month · ${summary.monthLabel}` : "Latest Month"}
                </Text>
              </Group>
              <Stack gap={8}>
                <Group justify="space-between" gap={12} wrap="nowrap">
                  <Text c={CHART_TEXT_MUTED} style={{ fontSize: "0.84rem", lineHeight: 1.15 }}>Customer Opened</Text>
                  <Text fw={800} c={CHART_TEXT_PRIMARY} style={{ fontSize: "1.05rem", lineHeight: 1 }}>{summary?.customerOpenedPercent ?? "—"}</Text>
                </Group>
                <Group justify="space-between" gap={12} wrap="nowrap">
                  <Text c={CHART_TEXT_MUTED} style={{ fontSize: "0.84rem", lineHeight: 1.15 }}>vCom Opened</Text>
                  <Text fw={800} c={CHART_TEXT_PRIMARY} style={{ fontSize: "1.05rem", lineHeight: 1 }}>{summary?.vcomOpenedPercent ?? "—"}</Text>
                </Group>
                <Group justify="space-between" gap={12} wrap="nowrap">
                  <Text c={CHART_TEXT_MUTED} style={{ fontSize: "0.84rem", lineHeight: 1.15 }}>MTTR &gt; 8h</Text>
                  <Text fw={800} c={CHART_TEXT_PRIMARY} style={{ fontSize: "1.05rem", lineHeight: 1 }}>{summary ? summary.over8HourTicketCount.toLocaleString() : "—"}</Text>
                </Group>
              </Stack>
            </div>

            <div style={{ minWidth: 0, display: "grid", gridTemplateRows: "1fr", gap: "0", minHeight: 0, paddingTop: "0" }}>
              {displayedHighMttrTickets.length > 0 ? (
                <Table
                  style={{
                    fontSize: "0.76rem",
                    lineHeight: 1.14,
                    tableLayout: "fixed",
                    borderCollapse: "separate",
                    borderSpacing: 0,
                    color: "#334155",
                    alignSelf: "start",
                    marginTop: 0,
                  }}
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={{ padding: "0 8px 9px", width: "22%", borderBottom: `1px solid ${CHART_BORDER_SOFT}`, fontWeight: 800, color: "#64748b" }}>Ticket</Table.Th>
                      <Table.Th style={{ padding: "0 8px 9px", width: "24%", borderBottom: `1px solid ${CHART_BORDER_SOFT}`, fontWeight: 800, color: "#64748b" }}>Carrier</Table.Th>
                      <Table.Th style={{ padding: "0 8px 9px", width: "36%", borderBottom: `1px solid ${CHART_BORDER_SOFT}`, fontWeight: 800, color: "#64748b" }}>Resolution</Table.Th>
                      <Table.Th style={{ padding: "0 8px 9px", width: "18%", textAlign: "right", borderBottom: `1px solid ${CHART_BORDER_SOFT}`, fontWeight: 800, color: "#64748b" }}>MTTR</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {displayedHighMttrTickets.map((ticket) => (
                      <Table.Tr key={`${ticket.ticketId}-${ticket.carrier}-${ticket.mttr}`}>
                        <Table.Td style={{ padding: "10px 8px 11px", fontWeight: 700, verticalAlign: "top", borderBottom: `1px solid ${CHART_BORDER_SOFT}` }}>{ticket.ticketId}</Table.Td>
                        <Table.Td style={{ padding: "10px 8px 11px", verticalAlign: "top", overflowWrap: "anywhere", wordBreak: "break-word", borderBottom: `1px solid ${CHART_BORDER_SOFT}` }}>{ticket.carrier}</Table.Td>
                        <Table.Td style={{ padding: "10px 8px 11px", verticalAlign: "top", overflowWrap: "anywhere", wordBreak: "break-word", whiteSpace: "normal", borderBottom: `1px solid ${CHART_BORDER_SOFT}` }}>
                          {ticket.resolution ?? "—"}
                        </Table.Td>
                        <Table.Td style={{ padding: "10px 8px 11px", textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top", borderBottom: `1px solid ${CHART_BORDER_SOFT}`, fontWeight: 700 }}>{formatMttrValue(ticket.mttr)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : (
                <Alert color="blue" variant="light" p="sm">
                  No MTTR &gt; 8h tickets for the latest chart month.
                </Alert>
              )}
            </div>
          </div>
        </div>
      </div>
      <ChartLogoStamp />
    </div>
  );
}

function TimeToCarrierPercentageChart({
  title,
  ariaLabel,
  data,
}: {
  title: string;
  ariaLabel: string;
  data: TicketVolumeChartMonth[];
}) {
  const chartHeight = 540;
  const chartWidth = 1280;
  const topPadding = 56;
  const rightPadding = 22;
  const bottomAxisHeight = 44;
  const leftPadding = 20;
  const yAxisMax = 100;
  const yTicks = [0, 25, 50, 75, 100];
  const plotHeight = chartHeight - bottomAxisHeight - topPadding;
  const plotWidth = chartWidth - leftPadding - rightPadding;
  const slotWidth = plotWidth / Math.max(data.length, 1);
  const barWidth = Math.min(54, Math.max(28, slotWidth * 0.54));
  const latestMonth = data.length > 0 ? data[data.length - 1] : null;
  const under15Latest = latestMonth?.segments.find((segment) => segment.key === "under-15")?.value ?? 0;
  const over15Latest = latestMonth?.segments.find((segment) => segment.key === "over-15")?.value ?? 0;

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "1360px",
        margin: "0 auto",
        background: CHART_PANEL_BACKGROUND,
        padding: "10px 14px 44px",
        position: "relative",
      }}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          minHeight: "650px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 3.45fr) minmax(292px, 0.9fr)",
          gap: "36px",
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            minWidth: 0,
            display: "grid",
            gridTemplateRows: "88px minmax(0, 1fr) 88px",
            gap: 0,
          }}
        >
          <div />

          <div
            style={{
              minWidth: 0,
              minHeight: 0,
              padding: "0 0 54px",
              background: CHART_PANEL_OVERLAY,
              borderBottom: "1px solid rgba(37, 99, 235, 0.16)",
              position: "relative",
            }}
          >
            <svg
              width="100%"
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label={ariaLabel}
              style={{ display: "block", width: "100%", height: "100%" }}
            >
              <text
                x={chartWidth / 2}
                y={-12}
                textAnchor="middle"
                fontSize="34"
                fontWeight="800"
                fill={CHART_TEXT_PRIMARY}
                letterSpacing="-0.03em"
              >
                {title}
              </text>

              {yTicks.map((tick) => {
                const y = topPadding + plotHeight - (tick / yAxisMax) * plotHeight;
                return (
                  <g key={tick}>
                    <line
                      x1={leftPadding}
                      x2={chartWidth - rightPadding}
                      y1={y}
                      y2={y}
                      stroke="rgba(226, 232, 240, 0.95)"
                      strokeWidth="1"
                    />
                    <text
                      x={leftPadding - 8}
                      y={y + 4}
                      textAnchor="end"
                      fontSize="11"
                      fontWeight="700"
                      fill={CHART_TEXT_MUTED}
                    >
                      {tick}%
                    </text>
                  </g>
                );
              })}

              <line
                x1={leftPadding}
                x2={chartWidth - rightPadding}
                y1={topPadding + plotHeight}
                y2={topPadding + plotHeight}
                stroke="rgba(148, 163, 184, 0.9)"
                strokeWidth="1.15"
              />

              {data.map((month, monthIndex) => {
                const slotCenter = leftPadding + slotWidth * monthIndex + slotWidth / 2;
                const x = slotCenter - barWidth / 2;
                let currentTop = topPadding + plotHeight;

                return (
                  <g key={month.monthLabel}>
                    {month.segments.map((segment, segmentIndex) => {
                      if (segment.value <= 0) return null;
                      const segmentHeight = (segment.value / yAxisMax) * plotHeight;
                      const y = currentTop - segmentHeight;
                      currentTop = y;
                      const isTopSegment = month.segments.slice(segmentIndex + 1).every((nextSegment) => nextSegment.value <= 0);
                      const isBottomSegment = month.segments.slice(0, segmentIndex).every((previousSegment) => previousSegment.value <= 0);

                      return (
                        <g key={`${month.monthLabel}-${segment.key}`}>
                          <rect
                            x={x}
                            y={y}
                            width={barWidth}
                            height={segmentHeight}
                            rx={isTopSegment || isBottomSegment ? 7 : 0}
                            fill={segment.color}
                          />
                          {segmentHeight >= 28 ? (
                            <text
                              x={slotCenter}
                              y={y + segmentHeight / 2 + 4}
                              textAnchor="middle"
                              fontSize="12"
                              fontWeight="800"
                              fill={segment.key === "over-15" ? "#1f2937" : "white"}
                            >
                              {segment.value.toFixed(1)}%
                            </text>
                          ) : null}
                        </g>
                      );
                    })}

                    <text
                      x={slotCenter}
                      y={topPadding - 18}
                      textAnchor="middle"
                      fontSize="14"
                      fontWeight="800"
                      fill={CHART_TEXT_SECONDARY}
                    >
                      100%
                    </text>
                    <text
                      x={slotCenter}
                      y={chartHeight - 12}
                      textAnchor="middle"
                      fontSize="12"
                      fontWeight="700"
                      fill={CHART_TEXT_SECONDARY}
                    >
                      {month.monthLabel}
                    </text>
                  </g>
                );
              })}
            </svg>

            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "48px",
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: "12px",
                alignItems: "start",
                pointerEvents: "none",
              }}
            >
              <Text
                size="10px"
                tt="uppercase"
                fw={800}
                c={CHART_TEXT_MUTED}
                style={{ letterSpacing: "0.18em", whiteSpace: "nowrap", paddingTop: "2px" }}
              >
                Bucket
              </Text>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "8px 20px",
                }}
              >
                {TIME_TO_CARRIER_CHART_SERIES.map((series) => (
                  <div
                    key={series.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 999,
                        background: series.color,
                        flexShrink: 0,
                      }}
                    />
                    <Text size="10px" fw={700} c={CHART_TEXT_SECONDARY} style={{ lineHeight: 1.2 }}>
                      {series.label}
                    </Text>
                  </div>
                ))}
              </div>
              <Text
                size="10px"
                fw={800}
                c={CHART_TEXT_MUTED}
                style={{ letterSpacing: "0.14em", textTransform: "uppercase", whiteSpace: "nowrap", paddingTop: "2px" }}
              >
                2 Series
              </Text>
            </div>
          </div>

          <div />
        </div>

        <div
          style={{
            minWidth: 0,
            height: "100%",
            display: "grid",
            gridTemplateRows: "88px minmax(0, 1fr) 88px",
            gap: 0,
            alignContent: "stretch",
          }}
        >
          <div />

          <div
            style={{
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-start",
              gap: "8px",
              paddingTop: "36px",
              paddingBottom: "10px",
            }}
          >
            <div
              style={{
                padding: "0 0 10px",
                borderBottom: `1px solid ${CHART_BORDER_SOFT}`,
              }}
            >
              <Group justify="space-between" align="end" gap={10} wrap="nowrap" style={{ marginTop: "64px", marginBottom: "10px" }}>
                <Text
                  c={CHART_TEXT_MUTED}
                  tt="uppercase"
                  fw={800}
                  style={{ fontSize: "0.72rem", lineHeight: 1.1, letterSpacing: "0.24em" }}
                >
                  {latestMonth ? `Latest Month · ${latestMonth.monthLabel}` : "Latest Month"}
                </Text>
              </Group>
              <Stack gap={8}>
                <Group justify="space-between" gap={12} wrap="nowrap">
                  <Text c={CHART_TEXT_MUTED} style={{ fontSize: "0.84rem", lineHeight: 1.15 }}>Under 15 Minutes</Text>
                  <Text fw={800} c={CHART_TEXT_PRIMARY} style={{ fontSize: "1.05rem", lineHeight: 1 }}>{under15Latest.toFixed(1)}%</Text>
                </Group>
                <Group justify="space-between" gap={12} wrap="nowrap">
                  <Text c={CHART_TEXT_MUTED} style={{ fontSize: "0.84rem", lineHeight: 1.15 }}>Over 15 Minutes</Text>
                  <Text fw={800} c={CHART_TEXT_PRIMARY} style={{ fontSize: "1.05rem", lineHeight: 1 }}>{over15Latest.toFixed(1)}%</Text>
                </Group>
              </Stack>
            </div>

            <Alert color="blue" variant="light" p="sm">
              Percentages are calculated per month from the existing Time to Carrier Ticket buckets, with 15–25, 25–35, 35–60, and 60+ all rolled into Over 15 Minutes.
            </Alert>
          </div>
        </div>
      </div>
      <ChartLogoStamp />
    </div>
  );
}

function FirstTouchPercentageChart({
  title,
  ariaLabel,
  data,
}: {
  title: string;
  ariaLabel: string;
  data: TicketVolumeChartMonth[];
}) {
  const chartHeight = 540;
  const chartWidth = 1280;
  const topPadding = 56;
  const rightPadding = 22;
  const bottomAxisHeight = 44;
  const leftPadding = 28;
  const yAxisMax = 100;
  const yTicks = [0, 25, 50, 75, 100];
  const plotHeight = chartHeight - bottomAxisHeight - topPadding;
  const plotWidth = chartWidth - leftPadding - rightPadding;
  const slotWidth = plotWidth / Math.max(data.length, 1);
  const barWidth = Math.min(54, Math.max(28, slotWidth * 0.54));
  const latestMonth = data.length > 0 ? data[data.length - 1] : null;
  const within5Latest = latestMonth?.segments.find((segment) => segment.key === "within-5")?.value ?? 0;
  const over5Latest = latestMonth?.segments.find((segment) => segment.key === "over-5")?.value ?? 0;

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "1360px",
        margin: "0 auto",
        background: CHART_PANEL_BACKGROUND,
        padding: "10px 14px 44px",
        position: "relative",
      }}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          minHeight: "650px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 3.45fr) minmax(292px, 0.9fr)",
          gap: "36px",
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            minWidth: 0,
            display: "grid",
            gridTemplateRows: "88px minmax(0, 1fr) 88px",
            gap: 0,
          }}
        >
          <div />

          <div
            style={{
              minWidth: 0,
              minHeight: 0,
              padding: "0 0 54px",
              background: CHART_PANEL_OVERLAY,
              borderBottom: "1px solid rgba(37, 99, 235, 0.16)",
              position: "relative",
            }}
          >
            <svg
              width="100%"
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label={ariaLabel}
              style={{ display: "block", width: "100%", height: "100%" }}
            >
              <text
                x={chartWidth / 2}
                y={-12}
                textAnchor="middle"
                fontSize="34"
                fontWeight="800"
                fill={CHART_TEXT_PRIMARY}
                letterSpacing="-0.03em"
              >
                {title}
              </text>

              {yTicks.map((tick) => {
                const y = topPadding + plotHeight - (tick / yAxisMax) * plotHeight;
                return (
                  <g key={tick}>
                    <line
                      x1={leftPadding}
                      x2={chartWidth - rightPadding}
                      y1={y}
                      y2={y}
                      stroke="rgba(226, 232, 240, 0.95)"
                      strokeWidth="1"
                    />
                    <text
                      x={leftPadding - 8}
                      y={y + 4}
                      textAnchor="end"
                      fontSize="11"
                      fontWeight="700"
                      fill={CHART_TEXT_MUTED}
                    >
                      {tick}%
                    </text>
                  </g>
                );
              })}

              <line
                x1={leftPadding}
                x2={chartWidth - rightPadding}
                y1={topPadding + plotHeight}
                y2={topPadding + plotHeight}
                stroke="rgba(148, 163, 184, 0.9)"
                strokeWidth="1.15"
              />

              {data.map((month, monthIndex) => {
                const slotCenter = leftPadding + slotWidth * monthIndex + slotWidth / 2;
                const x = slotCenter - barWidth / 2;
                let currentTop = topPadding + plotHeight;

                return (
                  <g key={month.monthLabel}>
                    {month.segments.map((segment, segmentIndex) => {
                      if (segment.value <= 0) return null;
                      const barHeight = (segment.value / yAxisMax) * plotHeight;
                      const y = currentTop - barHeight;
                      currentTop = y;
                      const isTopSegment = month.segments.slice(segmentIndex + 1).every((nextSegment) => nextSegment.value <= 0);
                      const isBottomSegment = month.segments.slice(0, segmentIndex).every((previousSegment) => previousSegment.value <= 0);

                      return (
                        <g key={`${month.monthLabel}-${segment.key}`}>
                          <rect
                            x={x}
                            y={y}
                            width={barWidth}
                            height={barHeight}
                            rx={isTopSegment || isBottomSegment ? 7 : 0}
                            fill={segment.color}
                          />
                          {barHeight >= 28 ? (
                            <text
                              x={slotCenter}
                              y={y + barHeight / 2 + 4}
                              textAnchor="middle"
                              fontSize="12"
                              fontWeight="800"
                              fill="white"
                            >
                              {segment.value.toFixed(1)}%
                            </text>
                          ) : null}
                        </g>
                      );
                    })}

                    <text
                      x={slotCenter}
                      y={chartHeight - 12}
                      textAnchor="middle"
                      fontSize="12"
                      fontWeight="700"
                      fill={CHART_TEXT_SECONDARY}
                    >
                      {month.monthLabel}
                    </text>
                  </g>
                );
              })}
            </svg>

            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "48px",
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: "12px",
                alignItems: "start",
                pointerEvents: "none",
              }}
            >
              <Text
                size="10px"
                tt="uppercase"
                fw={800}
                c={CHART_TEXT_MUTED}
                style={{ letterSpacing: "0.18em", whiteSpace: "nowrap", paddingTop: "2px" }}
              >
                Metric
              </Text>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "8px 20px",
                }}
              >
                {FIRST_TOUCH_CHART_SERIES.map((series) => (
                  <div
                    key={series.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 999,
                        background: series.color,
                        flexShrink: 0,
                      }}
                    />
                    <Text size="10px" fw={700} c={CHART_TEXT_SECONDARY} style={{ lineHeight: 1.2 }}>
                      {series.label}
                    </Text>
                  </div>
                ))}
              </div>
              <Text
                size="10px"
                fw={800}
                c={CHART_TEXT_MUTED}
                style={{ letterSpacing: "0.14em", textTransform: "uppercase", whiteSpace: "nowrap", paddingTop: "2px" }}
              >
                2 Series
              </Text>
            </div>
          </div>

          <div />
        </div>

        <div
          style={{
            minWidth: 0,
            height: "100%",
            display: "grid",
            gridTemplateRows: "88px minmax(0, 1fr) 88px",
            gap: 0,
            alignContent: "stretch",
          }}
        >
          <div />

          <div
            style={{
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-start",
              gap: "8px",
              paddingTop: "36px",
              paddingBottom: "10px",
            }}
          >
            <div
              style={{
                padding: "0 0 10px",
                borderBottom: `1px solid ${CHART_BORDER_SOFT}`,
              }}
            >
              <Group justify="space-between" align="end" gap={10} wrap="nowrap" style={{ marginTop: "64px", marginBottom: "10px" }}>
                <Text
                  c={CHART_TEXT_MUTED}
                  tt="uppercase"
                  fw={800}
                  style={{ fontSize: "0.72rem", lineHeight: 1.1, letterSpacing: "0.24em" }}
                >
                  {latestMonth ? `Latest Month · ${latestMonth.monthLabel}` : "Latest Month"}
                </Text>
              </Group>
              <Stack gap={8}>
                <Group justify="space-between" gap={12} wrap="nowrap">
                  <Text c={CHART_TEXT_MUTED} style={{ fontSize: "0.84rem", lineHeight: 1.15 }}>% within 5 min</Text>
                  <Text fw={800} c={CHART_TEXT_PRIMARY} style={{ fontSize: "1.05rem", lineHeight: 1 }}>{within5Latest.toFixed(1)}%</Text>
                </Group>
                <Group justify="space-between" gap={12} wrap="nowrap">
                  <Text c={CHART_TEXT_MUTED} style={{ fontSize: "0.84rem", lineHeight: 1.15 }}>% over 5 min</Text>
                  <Text fw={800} c={CHART_TEXT_PRIMARY} style={{ fontSize: "1.05rem", lineHeight: 1 }}>{over5Latest.toFixed(1)}%</Text>
                </Group>
              </Stack>
            </div>
          </div>
        </div>
      </div>
      <ChartLogoStamp />
    </div>
  );
}

function TicketResolutionsChart({
  title,
  ariaLabel,
  data,
  summaryMonthLabel,
  summaryRows,
  seriesDefinitions,
}: {
  title: string;
  ariaLabel: string;
  data: TicketVolumeChartMonth[];
  summaryMonthLabel: string | null;
  summaryRows: ResolutionSummaryRow[];
  seriesDefinitions: readonly TicketVolumeChartSeries[];
}) {
  const chartHeight = 540;
  const chartWidth = 1280;
  const topPadding = 56;
  const rightPadding = 22;
  const bottomAxisHeight = 44;
  const leftPadding = 20;
  const maxTotal = Math.max(...data.map((entry) => entry.total), 0);
  const yAxisMax = maxTotal <= 0 ? 10 : Math.ceil(maxTotal / 10) * 10 + (maxTotal % 10 === 0 ? 10 : 0);
  const tickStep = yAxisMax <= 20 ? 5 : 10;
  const yTicks = Array.from({ length: Math.floor(yAxisMax / tickStep) + 1 }, (_, index) => index * tickStep);
  const plotHeight = chartHeight - bottomAxisHeight - topPadding;
  const plotWidth = chartWidth - leftPadding - rightPadding;
  const slotWidth = plotWidth / Math.max(data.length, 1);
  const barWidth = Math.min(46, Math.max(24, slotWidth * 0.5));
  const latestMonth = data.length > 0 ? data[data.length - 1] : null;
  const latestChangeX = data.length > 1
    ? leftPadding + slotWidth * (data.length - 1)
    : data.length > 0
      ? leftPadding + slotWidth / 2
      : 0;
  const previousMonth = data.length > 1 ? data[data.length - 2] : null;
  const monthOverMonthChange = latestMonth && previousMonth && previousMonth.total > 0
    ? ((latestMonth.total - previousMonth.total) / previousMonth.total) * 100
    : null;
  const monthOverMonthDirection = monthOverMonthChange == null
    ? null
    : monthOverMonthChange > 0
      ? "up"
      : monthOverMonthChange < 0
        ? "down"
        : "flat";

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "1360px",
        margin: "0 auto",
        background: CHART_PANEL_BACKGROUND,
        padding: "10px 14px 44px",
        position: "relative",
      }}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          minHeight: "650px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 3.45fr) minmax(292px, 0.9fr)",
          gap: "36px",
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            minWidth: 0,
            display: "grid",
            gridTemplateRows: "88px minmax(0, 1fr) 88px",
            gap: 0,
          }}
        >
          <div />

          <div
            style={{
              minWidth: 0,
              minHeight: 0,
              padding: "0 0 54px",
              background: CHART_PANEL_OVERLAY,
              borderBottom: "1px solid rgba(37, 99, 235, 0.16)",
              position: "relative",
            }}
          >
            <svg
              width="100%"
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label={ariaLabel}
              style={{ display: "block", width: "100%", height: "100%" }}
            >
              <text
                x={chartWidth / 2}
                y={-12}
                textAnchor="middle"
                fontSize="34"
                fontWeight="800"
                fill={CHART_TEXT_PRIMARY}
                letterSpacing="-0.03em"
              >
                {title}
              </text>

              {yTicks.map((tick) => {
                const y = topPadding + plotHeight - (tick / yAxisMax) * plotHeight;
                return (
                  <g key={tick}>
                    <line
                      x1={leftPadding}
                      x2={chartWidth - rightPadding}
                      y1={y}
                      y2={y}
                      stroke="rgba(226, 232, 240, 0.95)"
                      strokeWidth="1"
                    />
                  </g>
                );
              })}

              <line
                x1={leftPadding}
                x2={chartWidth - rightPadding}
                y1={topPadding + plotHeight}
                y2={topPadding + plotHeight}
                stroke="rgba(148, 163, 184, 0.9)"
                strokeWidth="1.15"
              />

              {data.map((month, monthIndex) => {
                const slotCenter = leftPadding + slotWidth * monthIndex + slotWidth / 2;
                const x = slotCenter - barWidth / 2;
                let currentTop = topPadding + plotHeight;

                return (
                  <g key={month.monthLabel}>
                    {month.segments.map((segment, segmentIndex) => {
                      if (segment.value <= 0) return null;
                      const segmentHeight = (segment.value / yAxisMax) * plotHeight;
                      const y = currentTop - segmentHeight;
                      currentTop = y;
                      const isTopSegment = month.segments.slice(segmentIndex + 1).every((nextSegment) => nextSegment.value <= 0);
                      const isBottomSegment = month.segments.slice(0, segmentIndex).every((previousSegment) => previousSegment.value <= 0);

                      return (
                        <g key={`${month.monthLabel}-${segment.key}`}>
                          <rect
                            x={x}
                            y={y}
                            width={barWidth}
                            height={segmentHeight}
                            rx={isTopSegment || isBottomSegment ? 7 : 0}
                            fill={segment.color}
                          />
                          {segmentHeight >= 22 ? (
                            <text
                              x={slotCenter}
                              y={y + segmentHeight / 2 + 4}
                              textAnchor="middle"
                              fontSize="12"
                              fontWeight="800"
                              fill={segment.color === "#A6C557" || segment.color === "#F0A14A" ? "#1f2937" : "white"}
                            >
                              {segment.value}
                            </text>
                          ) : null}
                        </g>
                      );
                    })}

                    <text
                      x={slotCenter}
                      y={topPadding - 18}
                      textAnchor="middle"
                      fontSize="14"
                      fontWeight="800"
                      fill={CHART_TEXT_SECONDARY}
                    >
                      {month.total.toLocaleString()}
                    </text>
                    {monthIndex === data.length - 1 && monthOverMonthChange != null ? (
                      <text
                        x={latestChangeX}
                        y={topPadding - 37}
                        textAnchor="middle"
                        fontSize="13"
                        fontWeight="800"
                        fill={monthOverMonthDirection === "up" ? "#16a34a" : monthOverMonthDirection === "down" ? "#dc2626" : "#64748b"}
                      >
                        {monthOverMonthDirection === "up" ? "↑" : monthOverMonthDirection === "down" ? "↓" : "→"} {Math.abs(monthOverMonthChange).toFixed(1)}%
                      </text>
                    ) : null}
                    <text
                      x={slotCenter}
                      y={chartHeight - 12}
                      textAnchor="middle"
                      fontSize="12"
                      fontWeight="700"
                      fill={CHART_TEXT_SECONDARY}
                    >
                      {month.monthLabel}
                    </text>
                  </g>
                );
              })}
            </svg>

            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "48px",
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: "12px",
                alignItems: "start",
                pointerEvents: "none",
              }}
            >
              <Text
                size="10px"
                tt="uppercase"
                fw={800}
                c={CHART_TEXT_MUTED}
                style={{ letterSpacing: "0.18em", whiteSpace: "nowrap", paddingTop: "2px" }}
              >
                Resolution
              </Text>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "8px 20px",
                }}
              >
                {seriesDefinitions.map((series) => (
                  <div
                    key={series.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 999,
                        background: series.color,
                        flexShrink: 0,
                      }}
                    />
                    <Text size="10px" fw={700} c={CHART_TEXT_SECONDARY} style={{ lineHeight: 1.2 }}>
                      {series.label}
                    </Text>
                  </div>
                ))}
              </div>
              <Text
                size="10px"
                fw={800}
                c={CHART_TEXT_MUTED}
                style={{ letterSpacing: "0.14em", textTransform: "uppercase", whiteSpace: "nowrap", paddingTop: "2px" }}
              >
                {seriesDefinitions.length} Categories
              </Text>
            </div>
          </div>

          <div />
        </div>

        <div
          style={{
            minWidth: 0,
            height: "100%",
            display: "grid",
            gridTemplateRows: "88px minmax(0, 1fr) 88px",
            gap: 0,
            alignContent: "stretch",
          }}
        >
          <div />

          <div
            style={{
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-start",
              gap: "8px",
              paddingTop: "36px",
              paddingBottom: "10px",
            }}
          >
            <div
              style={{
                padding: "0 0 10px",
                borderBottom: `1px solid ${CHART_BORDER_SOFT}`,
              }}
            >
              <Group justify="space-between" align="end" gap={10} wrap="nowrap" style={{ marginTop: "64px", marginBottom: "10px" }}>
                <Text
                  c={CHART_TEXT_MUTED}
                  tt="uppercase"
                  fw={800}
                  style={{ fontSize: "0.72rem", lineHeight: 1.1, letterSpacing: "0.24em" }}
                >
                  {summaryMonthLabel ? `Latest Month · ${summaryMonthLabel}` : "Latest Month"}
                </Text>
              </Group>
              <Stack gap={8}>
                {summaryRows.map((row) => (
                  <Group key={row.label} justify="space-between" gap={12} wrap="nowrap" align="start">
                    <Text c={CHART_TEXT_MUTED} style={{ fontSize: "0.84rem", lineHeight: 1.15, maxWidth: "70%" }}>{row.label}</Text>
                    <Text fw={800} c={CHART_TEXT_PRIMARY} style={{ fontSize: "1.05rem", lineHeight: 1 }}>{row.value}</Text>
                  </Group>
                ))}
              </Stack>
            </div>
          </div>
        </div>
      </div>
      <ChartLogoStamp />
    </div>
  );
}

function buildWorkbookTrendSections(
  parsed: ParsedWorkbook | null,
  selectedSheetName?: string | null,
  filters: OperationalFilters = { reportedVia: "both", maintenance: "include", channel: "both", customers: [] },
): WorkbookTrendSection[] {
  if (!parsed) return [];

  const discovered: WorkbookTrendSection[] = [];
  const sheetsToScan = selectedSheetName
    ? parsed.sheets.filter((sheet) => sheet.name === selectedSheetName)
    : parsed.sheets;

  for (const sheet of sheetsToScan) {
    const matrix = buildMatrixSections(sheet);
    const preferredFromSheetName = PREFERRED_TREND_SECTION_ORDER.find((preferred) => matchesPreferredSection(sheet.name, preferred)) ?? null;
    const preferredFromContent = detectSectionByContent(sheet, matrix.labelColumn);
    const preferredSection = preferredFromSheetName ?? preferredFromContent;

    let addedFromSheet = false;
    for (const section of matrix.sections) {
      const normalizedTitle = normalizeSectionTitle(section.title);
      const normalizedSheetName = normalizeSectionTitle(sheet.name);
      if (!normalizedTitle) continue;

      const inferredTitle = normalizedTitle === normalizedSheetName && preferredSection
        ? preferredSection
        : section.title;

      const matchedPreferred = PREFERRED_TREND_SECTION_ORDER.find((preferred) => matchesPreferredSection(inferredTitle, preferred))
        ?? (preferredSection && section.rows.length > 0 ? preferredSection : null);

      if (!matchedPreferred) continue;

      discovered.push({
        ...section,
        title: matchedPreferred,
        sheetName: sheet.name,
        displayColumns: matrix.displayColumns,
        truncated: sheet.truncated,
      });
      addedFromSheet = true;
    }

    if (!addedFromSheet && preferredSection && matrix.displayColumns.length > 0 && sheet.rows.length > 0) {
      const labelColumn = matrix.labelColumn ?? sheet.headers[0] ?? "Metric";
      const rows = sheet.rows
        .filter((row) => !rowIsBlank(row, [labelColumn, ...matrix.displayColumns]))
        .slice(0, MAX_RENDER_ROWS_PER_SECTION)
        .map((row) => ({
          label: normalizeHeaderValue(row[labelColumn]) ?? "—",
          values: Object.fromEntries(matrix.displayColumns.map((column) => [column, normalizeHeaderValue(row[column]) ?? "—"])),
        }))
        .filter((row) => row.label !== "—");

      if (rows.length > 0) {
        discovered.push({
          title: preferredSection,
          rows,
          sheetName: sheet.name,
          displayColumns: matrix.displayColumns,
          truncated: sheet.truncated,
        });
      }
    }
  }

  const calculatedSheetCandidates = getCalculatedSheetCandidates(parsed, selectedSheetName);
  const calculatedSections = [
    pickCalculatedSection(calculatedSheetCandidates, buildCalculatedTicketVolumeSection, filters),
    pickCalculatedSection(calculatedSheetCandidates, buildCalculatedFirstTouchDistributionSection, filters),
    pickCalculatedSection(calculatedSheetCandidates, buildCalculatedTimeToCarrierTicketSection, filters),
    pickCalculatedSection(calculatedSheetCandidates, buildCalculatedTopIssueTypesSection, filters),
    pickCalculatedSection(calculatedSheetCandidates, buildCalculatedTicketResolutionsSection, filters),
    pickCalculatedSection(calculatedSheetCandidates, buildCalculatedTopCarriersSection, filters),
    pickCalculatedSection(calculatedSheetCandidates, buildCalculatedAvgMttrSection, filters),
  ].filter((section): section is WorkbookTrendSection => Boolean(section));

  const calculatedTitles = new Set(calculatedSections.map((section) => section.title));
  const merged = [...calculatedSections, ...discovered.filter((section) => !calculatedTitles.has(section.title))];

  const ordered: WorkbookTrendSection[] = [];
  const used = new Set<number>();

  for (const preferred of PREFERRED_TREND_SECTION_ORDER) {
    const matchIndex = merged.findIndex((section, index) => !used.has(index) && section.title === preferred);
    if (matchIndex >= 0) {
      ordered.push(merged[matchIndex]);
      used.add(matchIndex);
    }
  }

  return ordered;
}

export function NocMttrReportWidget() {
  const { identity } = useIdentity();
  const [activeTab, setActiveTab] = useState<string>("saved");
  const [mttrFile, setMttrFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSavedReports, setLoadingSavedReports] = useState(true);
  const [savingReport, setSavingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [savedReports, setSavedReports] = useState<SavedMttrReportRecord[]>([]);
  const [activeReportId, setActiveReportId] = useState<number | null>(null);
  const [deletingReportId, setDeletingReportId] = useState<number | null>(null);
  const [deletingAllReports, setDeletingAllReports] = useState(false);
  const [pendingDeleteReport, setPendingDeleteReport] = useState<SavedMttrReportRecord | null>(null);
  const [pendingDeleteAll, setPendingDeleteAll] = useState(false);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [customerColumn, setCustomerColumn] = useState<string | null>(null);
  const [monthColumn, setMonthColumn] = useState<string | null>(null);
  const [mttrColumn, setMttrColumn] = useState<string | null>(null);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [reportedViaFilter, setReportedViaFilter] = useState<ReportedViaFilter>("both");
  const [maintenanceFilter, setMaintenanceFilter] = useState<MaintenanceFilter>("include");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("both");
  const [monthDetailModal, setMonthDetailModal] = useState<MonthDetailModalState | null>(null);
  const [exportingPowerPoint, setExportingPowerPoint] = useState(false);
  const networkVolumeChartRef = useRef<HTMLDivElement | null>(null);
  const networkFirstTouchChartRef = useRef<HTMLDivElement | null>(null);
  const networkTimeToCarrierChartRef = useRef<HTMLDivElement | null>(null);
  const networkResolutionChartRef = useRef<HTMLDivElement | null>(null);
  const mobilityVolumeChartRef = useRef<HTMLDivElement | null>(null);
  const mobilityFirstTouchChartRef = useRef<HTMLDivElement | null>(null);
  const mobilityTimeToCarrierChartRef = useRef<HTMLDivElement | null>(null);
  const mobilityResolutionChartRef = useRef<HTMLDivElement | null>(null);
  const chronicCircuitsRef = useRef<HTMLDivElement | null>(null);

  function applySavedReport(report: SavedMttrReportRecord) {
    const savedParsed = parseSavedWorkbook(report.parsed_json);
    if (!savedParsed) {
      setError(`Saved report \"${report.file_name}\" could not be loaded.`);
      return;
    }

    const preferredTrendSheet = findPreferredSheet(savedParsed, PREFERRED_TREND_SHEET_NAME) ?? savedParsed.sheets[0] ?? null;

    setMttrFile(null);
    setParsed(savedParsed);
    setActiveReportId(report.id);
    setSheetName(preferredTrendSheet?.name ?? report.selected_sheet_name ?? null);
    setCustomerColumn(getLockedTrendCustomerColumn(preferredTrendSheet, report.selected_customer_column ?? preferredTrendSheet?.detectedCustomerColumn ?? preferredTrendSheet?.headers[0] ?? null));
    setMonthColumn(report.selected_month_column ?? preferredTrendSheet?.detectedMonthColumn ?? preferredTrendSheet?.headers[1] ?? null);
    setMttrColumn(report.selected_mttr_column ?? preferredTrendSheet?.detectedMttrColumn ?? preferredTrendSheet?.headers[2] ?? null);
    setSelectedCustomers([]);
    setReportedViaFilter("both");
    setMaintenanceFilter("include");
    setChannelFilter("both");
    setSaveNotice(`Loaded saved report: ${report.file_name}`);
    setActiveTab("trends");
  }

  async function loadSavedReports(reportIdToOpen?: number | null) {
    setLoadingSavedReports(true);
    try {
      const reports = await db.noc_mttr_reports.list({ orderBy: { column: "created_at", ascending: false }, limit: 25 });
      setSavedReports(reports);

      const targetReport = reportIdToOpen != null ? reports.find((report) => report.id === reportIdToOpen) ?? reports[0] ?? null : reports[0] ?? null;
      if (targetReport) applySavedReport(targetReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load saved MTTR reports.");
    } finally {
      setLoadingSavedReports(false);
    }
  }

  useEffect(() => {
    void loadSavedReports();
  }, []);

  async function handleFileUpload(nextFile: File | null) {
    setError(null);
    setSaveNotice(null);
    setMttrFile(nextFile);
    setSelectedCustomers([]);

    if (!nextFile) {
      setParsed(null);
      setActiveReportId(null);
      setSheetName(null);
      setCustomerColumn(null);
      setMonthColumn(null);
      setMttrColumn(null);
      setReportedViaFilter("both");
      setMaintenanceFilter("include");
      setChannelFilter("both");
      return;
    }

    setLoading(true);
    try {
      const nextParsed = await parseWorkbook(nextFile);
      const preferredTrendSheet = findPreferredSheet(nextParsed, PREFERRED_TREND_SHEET_NAME) ?? nextParsed.sheets[0] ?? null;
      const nextSheetName = preferredTrendSheet?.name ?? null;
      const nextCustomerColumn = getLockedTrendCustomerColumn(preferredTrendSheet, preferredTrendSheet?.detectedCustomerColumn ?? preferredTrendSheet?.headers[0] ?? null);
      const nextMonthColumn = preferredTrendSheet?.detectedMonthColumn ?? preferredTrendSheet?.headers[1] ?? null;
      const nextMttrColumn = preferredTrendSheet?.detectedMttrColumn ?? preferredTrendSheet?.headers[2] ?? null;
      const nextRows = buildRows(nextParsed, nextSheetName, nextCustomerColumn, nextMonthColumn, nextMttrColumn);

      setParsed(nextParsed);
      setActiveReportId(null);
      setSheetName(nextSheetName);
      setCustomerColumn(nextCustomerColumn);
      setMonthColumn(nextMonthColumn);
      setMttrColumn(nextMttrColumn);

      if (!preferredTrendSheet || preferredTrendSheet.rows.length === 0) setError("The uploaded MTTR workbook did not contain any readable rows.");
      if (nextParsed.truncationNotice) setSaveNotice(nextParsed.truncationNotice);

      setSavingReport(true);
      const inserted = await db.noc_mttr_reports.insert({
        file_name: nextFile.name,
        file_size_bytes: nextFile.size,
        uploaded_by: identity?.name ?? "Unknown",
        selected_sheet_name: nextSheetName,
        selected_customer_column: nextCustomerColumn,
        selected_month_column: nextMonthColumn,
        selected_mttr_column: nextMttrColumn,
        parsed_json: JSON.stringify(nextParsed),
        row_count: nextRows.length,
      });

      const saved = inserted[0] ?? null;
      if (saved) {
        setActiveReportId(saved.id);
        setSaveNotice(nextParsed.truncationNotice ? `Saved MTTR report ${nextFile.name} to the database. ${nextParsed.truncationNotice}` : `Saved MTTR report ${nextFile.name} to the database.`);
        await loadSavedReports(saved.id);
        setActiveTab("trends");
      }
    } catch (err) {
      setParsed(null);
      setError(err instanceof Error ? err.message : "Failed to read MTTR workbook.");
    } finally {
      setSavingReport(false);
      setLoading(false);
    }
  }

  function clearActiveReportState() {
    setMttrFile(null);
    setParsed(null);
    setActiveReportId(null);
    setSheetName(null);
    setCustomerColumn(null);
    setMonthColumn(null);
    setMttrColumn(null);
    setSelectedCustomers([]);
    setReportedViaFilter("both");
    setMaintenanceFilter("include");
    setChannelFilter("both");
    setActiveTab("saved");
  }

  async function handleDeleteReport(report: SavedMttrReportRecord) {
    setDeletingReportId(report.id);
    setError(null);
    setSaveNotice(null);

    try {
      await db.noc_mttr_reports.deleteById(report.id);
      const remainingReports = savedReports.filter((entry) => entry.id !== report.id);
      setSavedReports(remainingReports);

      if (activeReportId === report.id) {
        const nextReport = remainingReports[0] ?? null;
        if (nextReport) {
          applySavedReport(nextReport);
        } else {
          clearActiveReportState();
        }
      }

      setSaveNotice(`Deleted saved report: ${report.file_name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete saved report.");
    } finally {
      setDeletingReportId(null);
      setPendingDeleteReport(null);
    }
  }

  async function handleDeleteAllReports() {
    if (savedReports.length === 0) return;

    setDeletingAllReports(true);
    setError(null);
    setSaveNotice(null);

    try {
      await db.noc_mttr_reports.deleteAll();
      setSavedReports([]);
      clearActiveReportState();
      setSaveNotice("Deleted all saved MTTR reports.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete all saved reports.");
    } finally {
      setDeletingAllReports(false);
      setPendingDeleteAll(false);
    }
  }

  useEffect(() => {
    if (!activeReportId || !parsed) return;
    const timeout = window.setTimeout(() => {
      void db.noc_mttr_reports.updateById(activeReportId, {
        selected_sheet_name: sheetName,
        selected_customer_column: customerColumn,
        selected_month_column: monthColumn,
        selected_mttr_column: mttrColumn,
        row_count: buildRows(parsed, sheetName, customerColumn, monthColumn, mttrColumn).length,
      }).catch(() => {
        // Keep the current analysis view usable even if the mapping update fails.
      });
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [activeReportId, parsed, sheetName, customerColumn, monthColumn, mttrColumn]);

  const activeSheet = useMemo(() => parsed?.sheets.find((entry) => entry.name === sheetName) ?? null, [parsed, sheetName]);

  function clearAllFilters() {
    setSelectedCustomers([]);
    setReportedViaFilter("both");
    setMaintenanceFilter("include");
    setChannelFilter("both");
  }

  const hasActiveFilters = selectedCustomers.length > 0
    || reportedViaFilter !== "both"
    || maintenanceFilter !== "include"
    || channelFilter !== "both";

  const customerOptions = useMemo(() => {
    const customerColumnName = getLockedTrendCustomerColumn(activeSheet, customerColumn);
    if (!activeSheet || !customerColumnName || !activeSheet.headers.includes(customerColumnName)) {
      return [] as Array<{ value: string; label: string }>;
    }

    return Array.from(new Set(activeSheet.rows
      .map((row) => normalizeHeaderValue(row[customerColumnName]))
      .filter((value): value is string => Boolean(value))))
      .sort((a, b) => a.localeCompare(b))
      .map((customer) => ({ value: customer, label: customer }));
  }, [activeSheet, customerColumn]);

  const operationalFilters = useMemo<OperationalFilters>(
    () => ({ reportedVia: reportedViaFilter, maintenance: maintenanceFilter, channel: channelFilter, customers: selectedCustomers }),
    [reportedViaFilter, maintenanceFilter, channelFilter, selectedCustomers],
  );
  const workbookTrendSections = useMemo(
    () => buildWorkbookTrendSections(parsed, sheetName, operationalFilters),
    [parsed, sheetName, operationalFilters],
  );
  const networkChartFilters = useMemo<OperationalFilters>(
    () => ({ ...operationalFilters, reportedVia: "noc" }),
    [operationalFilters],
  );
  const networkChartSections = useMemo(
    () => buildWorkbookTrendSections(parsed, sheetName, networkChartFilters),
    [parsed, sheetName, networkChartFilters],
  );
  const networkTopIssueTypesSection = useMemo(
    () => networkChartSections.find((entry) => entry.title === "Top Issue Types") ?? null,
    [networkChartSections],
  );
  const networkChartSeries = useMemo(
    () => NETWORK_VOLUME_CHART_SERIES,
    [],
  );
  const networkTicketVolumeChartData = useMemo(
    () => buildTicketVolumeChartDataset(networkTopIssueTypesSection, networkChartSeries),
    [networkTopIssueTypesSection, networkChartSeries],
  );
  const mobilityChartFilters = useMemo<OperationalFilters>(
    () => ({ ...operationalFilters, reportedVia: "mobility" }),
    [operationalFilters],
  );
  const mobilityChartSections = useMemo(
    () => buildWorkbookTrendSections(parsed, sheetName, mobilityChartFilters),
    [parsed, sheetName, mobilityChartFilters],
  );
  const mobilityTopIssueTypesSection = useMemo(
    () => mobilityChartSections.find((entry) => entry.title === "Top Issue Types") ?? null,
    [mobilityChartSections],
  );
  const mobilityChartSeries = useMemo(
    () => buildTicketVolumeSeriesFromSection(mobilityTopIssueTypesSection),
    [mobilityTopIssueTypesSection],
  );
  const mobilityTicketVolumeChartData = useMemo(
    () => buildTicketVolumeChartDataset(mobilityTopIssueTypesSection, mobilityChartSeries),
    [mobilityTopIssueTypesSection, mobilityChartSeries],
  );
  const networkFirstTouchSection = useMemo(
    () => networkChartSections.find((entry) => entry.title === "First Touch Distribution") ?? null,
    [networkChartSections],
  );
  const networkTimeToCarrierSection = useMemo(
    () => networkChartSections.find((entry) => entry.title === "Time to Carrier Ticket") ?? null,
    [networkChartSections],
  );
  const mobilityFirstTouchSection = useMemo(
    () => mobilityChartSections.find((entry) => entry.title === "First Touch Distribution") ?? null,
    [mobilityChartSections],
  );
  const mobilityTimeToCarrierSection = useMemo(
    () => mobilityChartSections.find((entry) => entry.title === "Time to Carrier Ticket") ?? null,
    [mobilityChartSections],
  );
  const networkFirstTouchChartData = useMemo(
    () => buildFirstTouchPercentageDataset(networkFirstTouchSection),
    [networkFirstTouchSection],
  );
  const networkTimeToCarrierChartData = useMemo(
    () => buildTimeToCarrierPercentageDataset(networkTimeToCarrierSection),
    [networkTimeToCarrierSection],
  );
  const mobilityFirstTouchChartData = useMemo(
    () => buildFirstTouchPercentageDataset(mobilityFirstTouchSection),
    [mobilityFirstTouchSection],
  );
  const mobilityTimeToCarrierChartData = useMemo(
    () => buildTimeToCarrierPercentageDataset(mobilityTimeToCarrierSection),
    [mobilityTimeToCarrierSection],
  );
  const networkResolutionSection = useMemo(
    () => networkChartSections.find((entry) => entry.title === "Ticket Resolutions") ?? null,
    [networkChartSections],
  );
  const mobilityResolutionSection = useMemo(
    () => mobilityChartSections.find((entry) => entry.title === "Ticket Resolutions") ?? null,
    [mobilityChartSections],
  );
  const networkResolutionChartData = useMemo(
    () => buildResolutionChartDataset(networkResolutionSection, NETWORK_RESOLUTION_CHART_SERIES),
    [networkResolutionSection],
  );
  const mobilityResolutionChartData = useMemo(
    () => buildResolutionChartDataset(mobilityResolutionSection, MOBILITY_RESOLUTION_CHART_SERIES),
    [mobilityResolutionSection],
  );
  const networkTicketVolumeChartSummary = useMemo<TicketVolumeChartSummary | null>(() => {
    if (!networkTopIssueTypesSection || networkTicketVolumeChartData.length === 0) return null;

    const latestMonth = networkTicketVolumeChartData[networkTicketVolumeChartData.length - 1] ?? null;
    const monthKey = latestMonth ? networkTopIssueTypesSection.monthKeyByDisplayColumn?.[latestMonth.monthLabel] ?? null : null;
    if (!latestMonth || !monthKey) return null;

    const percentages = getIssueTypeOpenPercentagesForMonth(
      parsed,
      networkTopIssueTypesSection.sheetName,
      monthKey,
      networkChartFilters,
    );
    const over8HourTicketCount = getMttrTicketCountForMonth(
      parsed,
      networkTopIssueTypesSection.sheetName,
      monthKey,
      networkChartFilters,
      8,
    );

    return {
      monthLabel: latestMonth.monthLabel,
      monthKey,
      customerOpenedPercent: percentages.customerOpenedPercent,
      vcomOpenedPercent: percentages.vcomOpenedPercent,
      over8HourTicketCount,
    };
  }, [networkTopIssueTypesSection, networkTicketVolumeChartData, parsed, networkChartFilters]);
  const networkHighMttrTickets = useMemo(() => {
    if (!networkTopIssueTypesSection || !networkTicketVolumeChartSummary) return [];

    return getTopMttrTicketsForMonth(
      parsed,
      networkTopIssueTypesSection.sheetName,
      networkTicketVolumeChartSummary.monthKey,
      networkChartFilters,
      "Ticket Volume",
      5,
      8,
    );
  }, [networkTopIssueTypesSection, networkTicketVolumeChartSummary, parsed, networkChartFilters]);
  const networkResolutionChartSummaryMonthLabel = useMemo(() => {
    if (!networkResolutionSection || networkResolutionChartData.length === 0) return null;
    return networkResolutionChartData[networkResolutionChartData.length - 1]?.monthLabel ?? null;
  }, [networkResolutionSection, networkResolutionChartData]);
  const networkResolutionChartSummaryRows = useMemo(() => {
    if (!networkResolutionSection || networkResolutionChartData.length === 0) return [] as ResolutionSummaryRow[];

    const latestMonth = networkResolutionChartData[networkResolutionChartData.length - 1] ?? null;
    const monthKey = latestMonth ? networkResolutionSection.monthKeyByDisplayColumn?.[latestMonth.monthLabel] ?? null : null;
    if (!latestMonth || !monthKey) return [] as ResolutionSummaryRow[];

    return getResolutionSummaryRowsForMonth(
      parsed,
      networkResolutionSection.sheetName,
      monthKey,
      networkChartFilters,
    );
  }, [networkResolutionSection, networkResolutionChartData, parsed, networkChartFilters]);
  const mobilityResolutionChartSummaryMonthLabel = useMemo(() => {
    if (!mobilityResolutionSection || mobilityResolutionChartData.length === 0) return null;
    return mobilityResolutionChartData[mobilityResolutionChartData.length - 1]?.monthLabel ?? null;
  }, [mobilityResolutionSection, mobilityResolutionChartData]);
  const mobilityResolutionChartSummaryRows = useMemo(() => {
    if (!mobilityResolutionSection || mobilityResolutionChartData.length === 0) return [] as ResolutionSummaryRow[];

    const latestMonth = mobilityResolutionChartData[mobilityResolutionChartData.length - 1] ?? null;
    const monthKey = latestMonth ? mobilityResolutionSection.monthKeyByDisplayColumn?.[latestMonth.monthLabel] ?? null : null;
    if (!latestMonth || !monthKey) return [] as ResolutionSummaryRow[];

    return getResolutionSummaryRowsForMonth(
      parsed,
      mobilityResolutionSection.sheetName,
      monthKey,
      mobilityChartFilters,
    );
  }, [mobilityResolutionSection, mobilityResolutionChartData, parsed, mobilityChartFilters]);
  const mobilityTicketVolumeChartSummary = useMemo<TicketVolumeChartSummary | null>(() => {
    if (!mobilityTopIssueTypesSection || mobilityTicketVolumeChartData.length === 0) return null;

    const latestMonth = mobilityTicketVolumeChartData[mobilityTicketVolumeChartData.length - 1] ?? null;
    const monthKey = latestMonth ? mobilityTopIssueTypesSection.monthKeyByDisplayColumn?.[latestMonth.monthLabel] ?? null : null;
    if (!latestMonth || !monthKey) return null;

    const percentages = getIssueTypeOpenPercentagesForMonth(
      parsed,
      mobilityTopIssueTypesSection.sheetName,
      monthKey,
      mobilityChartFilters,
    );
    const over8HourTicketCount = getMttrTicketCountForMonth(
      parsed,
      mobilityTopIssueTypesSection.sheetName,
      monthKey,
      mobilityChartFilters,
      8,
    );

    return {
      monthLabel: latestMonth.monthLabel,
      monthKey,
      customerOpenedPercent: percentages.customerOpenedPercent,
      vcomOpenedPercent: percentages.vcomOpenedPercent,
      over8HourTicketCount,
    };
  }, [mobilityTopIssueTypesSection, mobilityTicketVolumeChartData, parsed, mobilityChartFilters]);
  const mobilityHighMttrTickets = useMemo(() => {
    if (!mobilityTopIssueTypesSection || !mobilityTicketVolumeChartSummary) return [];

    return getTopMttrTicketsForMonth(
      parsed,
      mobilityTopIssueTypesSection.sheetName,
      mobilityTicketVolumeChartSummary.monthKey,
      mobilityChartFilters,
      "Ticket Volume",
      5,
      8,
    );
  }, [mobilityTopIssueTypesSection, mobilityTicketVolumeChartSummary, parsed, mobilityChartFilters]);
  const chronicCircuitTableData = useMemo(
    () => buildChronicCircuitTableData(parsed, sheetName, operationalFilters),
    [parsed, sheetName, operationalFilters],
  );
  const exportCustomerName = useMemo(() => {
    if (selectedCustomers.length === 1) return selectedCustomers[0];
    if (selectedCustomers.length > 1) return `${selectedCustomers.length} selected customers`;
    return customerOptions[0]?.label ?? "All Customers";
  }, [selectedCustomers, customerOptions]);
  const exportFilterSummary = useMemo(() => {
    const customerLabel = selectedCustomers.length === 0
      ? "Customer: all"
      : selectedCustomers.length === 1
        ? `Customer: ${selectedCustomers[0]}`
        : `Customers: ${selectedCustomers.slice(0, 3).join(", ")}${selectedCustomers.length > 3 ? ` +${selectedCustomers.length - 3} more` : ""}`;
    return [
      customerLabel,
      `Reported via: ${reportedViaFilter === "both" ? "NOC + Mobility" : reportedViaFilter === "noc" ? "NOC only" : "Mobility only"}`,
      `Channel: ${channelFilter === "both" ? "Buyers' Club + MSP" : channelFilter === "buyers_club" ? "Buyers' Club only" : "MSP only"}`,
      `Maintenance: ${maintenanceFilter === "include" ? "Included" : "Excluded"}`,
    ];
  }, [selectedCustomers, reportedViaFilter, channelFilter, maintenanceFilter]);
  async function handleExportPowerPoint() {
    if (!parsed) return;
    setExportingPowerPoint(true);
    setError(null);
    setSaveNotice(null);
    try {
      await exportNocMttrPowerPoint({
        reportName: parsed.fileName,
        customerName: exportCustomerName,
        generatedBy: identity?.name ?? "Unknown",
        generatedAt: new Date(),
        selectedSheetName: sheetName,
        filtersSummary: exportFilterSummary,
        thankYouLine: `Questions on ${exportCustomerName}'s MTTR trends or chronic circuits?`,
        charts: [
          {
            title: "Ticket Volumes - Network",
            subtitle: "Top Issue Types · NOC only",
            element: networkVolumeChartRef.current,
          },
          {
            title: "Ticket Acknowledgement Time - Network",
            subtitle: "First Touch Distribution · NOC only",
            element: networkFirstTouchChartRef.current,
          },
          {
            title: "Time to Carrier Ticket - Network",
            subtitle: "Carrier ticket timing · NOC only",
            element: networkTimeToCarrierChartRef.current,
          },
          {
            title: "Ticket Resolutions - Network",
            subtitle: "Resolution mix · NOC only",
            element: networkResolutionChartRef.current,
          },
          {
            title: "Ticket Volumes - Mobility",
            subtitle: "Top Issue Types · Mobility only",
            element: mobilityVolumeChartRef.current,
          },
          {
            title: "Ticket Acknowledgement Time - Mobility",
            subtitle: "First Touch Distribution · Mobility only",
            element: mobilityFirstTouchChartRef.current,
          },
          {
            title: "Time to Carrier Ticket - Mobility",
            subtitle: "Carrier ticket timing · Mobility only",
            element: mobilityTimeToCarrierChartRef.current,
          },
          {
            title: "Ticket Resolutions - Mobility",
            subtitle: "Resolution mix · Mobility only",
            element: mobilityResolutionChartRef.current,
          },
          {
            title: "Top 10 Chronic Circuits",
            subtitle: "Current workbook and active trend filters",
            element: chronicCircuitsRef.current,
          },
        ],
      });
      setSaveNotice("PowerPoint exported successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate the PowerPoint export.");
    } finally {
      setExportingPowerPoint(false);
    }
  }
  const monthDetailTickets = useMemo(() => {
    if (!monthDetailModal || monthDetailModal.sectionTitle === "Top Issue Types" || monthDetailModal.detailType === "resolution-summary") {
      return [] as ExtendedMttrTicket[];
    }
    return getTopMttrTicketsForMonth(
      parsed,
      monthDetailModal.sectionSheetName,
      monthDetailModal.monthKey,
      operationalFilters,
      monthDetailModal.sectionTitle,
      10,
      8,
    );
  }, [monthDetailModal, parsed, operationalFilters]);

  const monthDetailIssueTypePercentages = useMemo(() => {
    if (!monthDetailModal || monthDetailModal.sectionTitle !== "Top Issue Types") return null;
    return getIssueTypeOpenPercentagesForMonth(
      parsed,
      monthDetailModal.sectionSheetName,
      monthDetailModal.monthKey,
      operationalFilters,
    );
  }, [monthDetailModal, parsed, operationalFilters]);

  const monthDetailResolutionSummaryRows = useMemo(() => {
    if (!monthDetailModal || monthDetailModal.sectionTitle !== "Ticket Resolutions" || monthDetailModal.detailType !== "resolution-summary") {
      return null;
    }
    return getResolutionSummaryRowsForMonth(
      parsed,
      monthDetailModal.sectionSheetName,
      monthDetailModal.monthKey,
      operationalFilters,
    );
  }, [monthDetailModal, parsed, operationalFilters]);

  return (
    <WidgetFrame
      title="NOC MTTR Report"
      subtitle="Upload files as saved reports, then review them in a month-by-month dashboard layout"
      icon={IconClock}
      iconColor="orange"
      loading={loading || loadingSavedReports || savingReport}
      onRefresh={() => {
        void loadSavedReports(activeReportId);
      }}
    >
      <Modal
        opened={monthDetailModal != null}
        onClose={() => setMonthDetailModal(null)}
        title={monthDetailModal ? `${monthDetailModal.sectionTitle} details — ${monthDetailModal.monthLabel}` : "Month details"}
        size={monthDetailModal?.sectionTitle === "Ticket Resolutions" && monthDetailModal.detailType === "resolution-summary" ? "md" : "xl"}
        centered
      >
        <Stack gap={monthDetailModal?.sectionTitle === "Ticket Resolutions" && monthDetailModal.detailType === "resolution-summary" ? 6 : "sm"}>
          {monthDetailModal?.sectionTitle === "Top Issue Types" ? (
            <>
              <Text size="sm" c="dimmed">Issue-type ownership breakdown for the selected month, using the current trend filters.</Text>
              <Table withTableBorder withColumnBorders striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th miw={220}>Metric</Table.Th>
                    <Table.Th miw={140}>Value</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td>Customer Opened %</Table.Td>
                    <Table.Td>{monthDetailIssueTypePercentages?.customerOpenedPercent ?? "0%"}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>vCom Opened %</Table.Td>
                    <Table.Td>{monthDetailIssueTypePercentages?.vcomOpenedPercent ?? "0%"}</Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
            </>
          ) : monthDetailModal?.sectionTitle === "Ticket Resolutions" && monthDetailModal.detailType === "resolution-summary" ? (
            <>
              <Text size="xs" c="dimmed">Resolution mix for the selected month under current filters.</Text>
              <Table withTableBorder withColumnBorders striped highlightOnHover horizontalSpacing="sm" verticalSpacing={6} fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th miw={240}>Metric</Table.Th>
                    <Table.Th miw={88}>Value</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(monthDetailResolutionSummaryRows ?? []).map((row) => (
                    <Table.Tr key={row.label}>
                      <Table.Td>{row.label}</Table.Td>
                      <Table.Td>{row.value}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          ) : (
            <>
              <Text size="sm" c="dimmed">Top 10 tickets with MTTR over 8 hours for the selected month, using the current trend filters.</Text>
              {monthDetailTickets.length === 0 ? (
                <Alert color="yellow" variant="light">No tickets with MTTR over 8 hours were found for this month under the current filters.</Alert>
              ) : (
                <ScrollArea>
                  <Table withTableBorder withColumnBorders striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th miw={120}>Ticket Number</Table.Th>
                        <Table.Th miw={180}>Carrier</Table.Th>
                        <Table.Th miw={260}>Ticket Resolution</Table.Th>
                        <Table.Th miw={90}>MTTR</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {monthDetailTickets.map((ticket) => (
                        <Table.Tr key={`${ticket.ticketId}-${ticket.carrier}-${ticket.mttr}`}>
                          <Table.Td>{ticket.ticketId}</Table.Td>
                          <Table.Td>{ticket.carrier}</Table.Td>
                          <Table.Td>{ticket.resolution ?? "—"}</Table.Td>
                          <Table.Td>{formatMttrValue(ticket.mttr)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              )}
            </>
          )}
        </Stack>
      </Modal>
      <Stack gap="md">
        {error ? (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">{error}</Alert>
        ) : null}

        {saveNotice ? (
          <Alert color="teal" variant="light">{saveNotice}</Alert>
        ) : null}

        {parsed?.truncationNotice ? (
          <Alert color="yellow" variant="light">{parsed.truncationNotice}</Alert>
        ) : null}

        <Tabs value={activeTab} onChange={(value) => setActiveTab(value ?? "trends")}>
          <Tabs.List grow>
            <Tabs.Tab value="trends" leftSection={<IconChartLine size={16} />}>Trends</Tabs.Tab>
            <Tabs.Tab value="charts" leftSection={<IconChartBar size={16} />}>Charts</Tabs.Tab>
            <Tabs.Tab value="saved" leftSection={<IconDatabase size={16} />}>Saved Reports</Tabs.Tab>
            <Tabs.Tab value="upload" leftSection={<IconUpload size={16} />}>Upload File</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="saved" pt="md">
            <Card withBorder radius="md" p="md">
              <Stack gap="md">
                <Group justify="space-between" align="end">
                  <Stack gap={2}>
                    <Title order={5}>Saved MTTR reports</Title>
                    <Text size="sm" c="dimmed">Every uploaded workbook is stored in the database so you can reopen and analyse it later.</Text>
                  </Stack>
                  <Group gap="sm" align="center">
                    <Badge color="blue" variant="light">{savedReports.length} saved</Badge>
                    <Button
                      color="red"
                      variant="outline"
                      disabled={savedReports.length === 0}
                      loading={deletingAllReports}
                      onClick={() => {
                        setPendingDeleteAll(true);
                        setPendingDeleteReport(null);
                      }}
                    >
                      Delete all
                    </Button>
                  </Group>
                </Group>

                {(pendingDeleteAll || pendingDeleteReport) ? (
                  <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                    <Stack gap="sm">
                      <Text size="sm">
                        {pendingDeleteAll
                          ? `Delete all ${savedReports.length} saved MTTR reports? This cannot be undone.`
                          : `Delete the saved report "${pendingDeleteReport?.file_name ?? ""}"? This cannot be undone.`}
                      </Text>
                      <Group justify="flex-end">
                        <Button
                          variant="default"
                          disabled={deletingReportId != null || deletingAllReports}
                          onClick={() => {
                            setPendingDeleteReport(null);
                            setPendingDeleteAll(false);
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          color="red"
                          loading={deletingAllReports || deletingReportId != null}
                          onClick={() => {
                            if (pendingDeleteAll) {
                              void handleDeleteAllReports();
                              return;
                            }
                            if (pendingDeleteReport) {
                              void handleDeleteReport(pendingDeleteReport);
                            }
                          }}
                        >
                          Confirm delete
                        </Button>
                      </Group>
                    </Stack>
                  </Alert>
                ) : null}

                <Group align="end" wrap="wrap">
                  <Select
                    style={{ flex: 1 }}
                    label="Open saved report"
                    placeholder={loadingSavedReports ? "Loading saved reports..." : "Select a saved workbook"}
                    value={activeReportId != null ? String(activeReportId) : null}
                    onChange={(value) => {
                      const report = savedReports.find((entry) => String(entry.id) === value);
                      if (report) {
                        setError(null);
                        applySavedReport(report);
                      }
                    }}
                    searchable
                    data={savedReports.map((report) => ({
                      value: String(report.id),
                      label: `${report.file_name} • ${report.row_count ?? 0} rows • ${new Date(report.created_at).toLocaleDateString()}`,
                    }))}
                    nothingFoundMessage="No saved MTTR reports yet"
                  />
                  <Button
                    color="red"
                    variant="light"
                    disabled={activeReportId == null || deletingAllReports}
                    loading={!deletingAllReports && deletingReportId != null && deletingReportId === activeReportId}
                    onClick={() => {
                      const report = savedReports.find((entry) => entry.id === activeReportId);
                      if (report) {
                        setPendingDeleteReport(report);
                        setPendingDeleteAll(false);
                      }
                    }}
                  >
                    Delete report
                  </Button>
                </Group>

                {savedReports.length > 0 ? (
                  <SimpleGrid cols={{ base: 1, md: 3 }}>
                    {savedReports.slice(0, 3).map((report) => (
                      <Card key={report.id} withBorder radius="md" p="md">
                        <Stack gap="sm">
                          <Stack gap={4}>
                            <Text fw={600} lineClamp={1}>{report.file_name}</Text>
                            <Text size="sm" c="dimmed">{report.row_count ?? 0} parsed rows</Text>
                            <Text size="xs" c="dimmed">Uploaded by {report.uploaded_by ?? "Unknown"}</Text>
                          </Stack>
                          <Group justify="space-between" align="center">
                            <Button variant="subtle" disabled={deletingAllReports} onClick={() => applySavedReport(report)}>Open</Button>
                            <Button
                              color="red"
                              variant="light"
                              disabled={deletingAllReports}
                              loading={!deletingAllReports && deletingReportId === report.id}
                              onClick={() => {
                                setPendingDeleteReport(report);
                                setPendingDeleteAll(false);
                              }}
                            >
                              Delete
                            </Button>
                          </Group>
                        </Stack>
                      </Card>
                    ))}
                  </SimpleGrid>
                ) : (
                  <Alert color="yellow" variant="light">No MTTR workbook has been saved yet. Use the Upload File tab to create the first saved report.</Alert>
                )}
              </Stack>
            </Card>
          </Tabs.Panel>

          <Tabs.Panel value="upload" pt="md">
            <Card withBorder radius="md" p="md">
              <Stack gap="md">
                <Group justify="space-between" align="end">
                  <Stack gap={2}>
                    <Title order={5}>Upload workbook</Title>
                    <Text size="sm" c="dimmed">Upload an Excel file, store it in the database, and keep the selected mappings for later analysis.</Text>
                  </Stack>
                  <Badge color="orange" variant="light">Database-backed</Badge>
                </Group>

                <Text size="xs" c="dimmed">
                  Large workbook protection: uploads are limited to 8 MB and only the first 8 sheets are loaded. Uploaded MTTR workbooks feed Trends and Charts and are saved to the database.
                </Text>

                <FileInput
                  label="MTTR Excel file"
                  placeholder="Upload the MTTR workbook"
                  value={mttrFile}
                  onChange={handleFileUpload}
                  accept=".xlsx,.xls,.csv"
                  clearable
                />

                {parsed ? (
                  <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }}>
                    <Select
                      label="Sheet"
                      value={sheetName}
                      onChange={(value) => {
                        setSheetName(value);
                        const nextSheet = parsed.sheets.find((entry) => entry.name === value) ?? null;
                        setCustomerColumn(getLockedTrendCustomerColumn(nextSheet, nextSheet?.detectedCustomerColumn ?? nextSheet?.headers[0] ?? null));
                        setMonthColumn(nextSheet?.detectedMonthColumn ?? nextSheet?.headers[1] ?? null);
                        setMttrColumn(nextSheet?.detectedMttrColumn ?? nextSheet?.headers[2] ?? null);
                      }}
                      data={parsed.sheets.map((sheet) => ({ value: sheet.name, label: `${sheet.name} (${sheet.rows.length} rows)` }))}
                    />
                    <Select
                      label="Customer column"
                      description={normalizeSheetName(activeSheet?.name) === normalizeSheetName(PREFERRED_TREND_SHEET_NAME)
                        ? "Locked to the fixed Customer column for NOC MTTR Report."
                        : undefined}
                      value={getLockedTrendCustomerColumn(activeSheet, customerColumn)}
                      onChange={setCustomerColumn}
                      disabled={normalizeSheetName(activeSheet?.name) === normalizeSheetName(PREFERRED_TREND_SHEET_NAME)}
                      data={(activeSheet?.headers ?? []).map((header) => ({ value: header, label: header }))}
                    />
                    <Select label="Month/date column" value={monthColumn} onChange={setMonthColumn} data={(activeSheet?.headers ?? []).map((header) => ({ value: header, label: header }))} />
                    <Select label="MTTR column" value={mttrColumn} onChange={setMttrColumn} data={(activeSheet?.headers ?? []).map((header) => ({ value: header, label: header }))} />
                  </SimpleGrid>
                ) : (
                  <Alert color="blue" variant="light">Upload an MTTR workbook to configure the sheet and customer/month/MTTR columns used by Trends and Charts.</Alert>
                )}
              </Stack>
            </Card>
          </Tabs.Panel>

          <Tabs.Panel value="charts" pt="md">
            {parsed ? (
              <Stack gap="md">
                <Card withBorder radius="md" p="md">
                  <Stack gap="xs">
                    <Group justify="space-between" align="start">
                      <Stack gap={2}>
                        <Title order={5}>Visual charts</Title>
                        <Text size="sm" c="dimmed">This charts tab now includes stacked monthly ticket-volume slides for both Network (NOC) and Mobility, each based on the workbook's Top Issue Types section. Both charts respect the current customer, channel, and maintenance filters while forcing their own reported-via scope.</Text>
                      </Stack>
                      <Group gap="xs" align="center">
                        <Badge color="orange" variant="light">NOC only</Badge>
                        <Badge color="blue" variant="light">Mobility only</Badge>
                        <Button
                          color="orange"
                          leftSection={<IconPresentation size={16} />}
                          onClick={() => {
                            void handleExportPowerPoint();
                          }}
                          loading={exportingPowerPoint}
                          disabled={!parsed}
                        >
                          Generate PowerPoint
                        </Button>
                      </Group>
                    </Group>
                  </Stack>
                </Card>

                <Stack gap="xl" style={{ width: "100%" }}>
                  <div ref={networkVolumeChartRef} style={{ width: "100%" }}>
                    {networkTicketVolumeChartData.length > 0 ? (
                      <TicketVolumesChart
                        title="Ticket Volumes - Network"
                        ariaLabel="Stacked monthly Network ticket volumes by issue type"
                        data={networkTicketVolumeChartData}
                        summary={networkTicketVolumeChartSummary}
                        highMttrTickets={networkHighMttrTickets}
                        seriesDefinitions={networkChartSeries}
                      />
                    ) : (
                      <Card withBorder radius="md" p={{ base: "sm", md: "md" }}>
                        <Stack align="center" gap="sm" py="xl">
                          <ThemeIcon size={56} radius="xl" variant="light" color="orange">
                            <IconChartBar size={28} />
                          </ThemeIcon>
                          <Title order={4}>No Network ticket volume chart data yet</Title>
                          <Text c="dimmed" ta="center" maw={680}>Upload or open a workbook with issue-type trend data to populate the Network ticket volume chart. If a report is already loaded, check whether your current filters removed all NOC rows.</Text>
                        </Stack>
                      </Card>
                    )}
                  </div>

                  <div ref={networkFirstTouchChartRef} style={{ width: "100%" }}>
                    {networkFirstTouchChartData.length > 0 ? (
                      <FirstTouchPercentageChart
                        title="Ticket Acknowledgement Time - Network"
                        ariaLabel="Monthly Network first touch distribution percentages for within 5 minutes and within 10 minutes"
                        data={networkFirstTouchChartData}
                      />
                    ) : (
                      <Card withBorder radius="md" p={{ base: "sm", md: "md" }}>
                        <Stack align="center" gap="sm" py="xl">
                          <ThemeIcon size={56} radius="xl" variant="light" color="orange">
                            <IconChartBar size={28} />
                          </ThemeIcon>
                          <Title order={4}>No Network first-touch chart data yet</Title>
                          <Text c="dimmed" ta="center" maw={680}>Upload or open a workbook with First Touch Distribution data to populate the Network percentage chart. If a report is already loaded, check whether your current filters removed all NOC rows.</Text>
                        </Stack>
                      </Card>
                    )}
                  </div>

                  <div ref={networkTimeToCarrierChartRef} style={{ width: "100%" }}>
                    {networkTimeToCarrierChartData.length > 0 ? (
                      <TimeToCarrierPercentageChart
                        title="Time to Carrier Ticket - Network"
                        ariaLabel="Monthly Network time to carrier ticket percentages for under 15 minutes and over 15 minutes"
                        data={networkTimeToCarrierChartData}
                      />
                    ) : (
                      <Card withBorder radius="md" p={{ base: "sm", md: "md" }}>
                        <Stack align="center" gap="sm" py="xl">
                          <ThemeIcon size={56} radius="xl" variant="light" color="orange">
                            <IconChartBar size={28} />
                          </ThemeIcon>
                          <Title order={4}>No Network time-to-carrier chart data yet</Title>
                          <Text c="dimmed" ta="center" maw={680}>Upload or open a workbook with Time to Carrier Ticket data to populate the Network percentage chart. If a report is already loaded, check whether your current filters removed all NOC rows.</Text>
                        </Stack>
                      </Card>
                    )}
                  </div>

                  <div ref={networkResolutionChartRef} style={{ width: "100%" }}>
                    {networkResolutionChartData.length > 0 ? (
                      <TicketResolutionsChart
                        title="Ticket Resolutions - Network"
                        ariaLabel="Stacked monthly Network ticket resolutions by category"
                        data={networkResolutionChartData}
                        summaryMonthLabel={networkResolutionChartSummaryMonthLabel}
                        summaryRows={networkResolutionChartSummaryRows}
                        seriesDefinitions={NETWORK_RESOLUTION_CHART_SERIES}
                      />
                    ) : (
                      <Card withBorder radius="md" p={{ base: "sm", md: "md" }}>
                        <Stack align="center" gap="sm" py="xl">
                          <ThemeIcon size={56} radius="xl" variant="light" color="orange">
                            <IconChartBar size={28} />
                          </ThemeIcon>
                          <Title order={4}>No Network ticket resolution chart data yet</Title>
                          <Text c="dimmed" ta="center" maw={680}>Upload or open a workbook with resolution trend data to populate the Network ticket resolution chart. If a report is already loaded, check whether your current filters removed all NOC rows.</Text>
                        </Stack>
                      </Card>
                    )}
                  </div>

                  <div ref={mobilityVolumeChartRef} style={{ width: "100%" }}>
                    {mobilityTicketVolumeChartData.length > 0 ? (
                      <TicketVolumesChart
                        title="Ticket Volumes - Mobility"
                        ariaLabel="Stacked monthly Mobility ticket volumes by issue type"
                        data={mobilityTicketVolumeChartData}
                        summary={mobilityTicketVolumeChartSummary}
                        highMttrTickets={mobilityHighMttrTickets}
                        seriesDefinitions={mobilityChartSeries}
                        legendBottom="29px"
                      />
                    ) : (
                      <Card withBorder radius="md" p={{ base: "sm", md: "md" }}>
                        <Stack align="center" gap="sm" py="xl">
                          <ThemeIcon size={56} radius="xl" variant="light" color="blue">
                            <IconChartBar size={28} />
                          </ThemeIcon>
                          <Title order={4}>No Mobility ticket volume chart data yet</Title>
                          <Text c="dimmed" ta="center" maw={680}>Upload or open a workbook with issue-type trend data to populate the Mobility ticket volume chart. If a report is already loaded, check whether your current filters removed all Mobility rows.</Text>
                        </Stack>
                      </Card>
                    )}
                  </div>

                  <div ref={mobilityFirstTouchChartRef} style={{ width: "100%" }}>
                    {mobilityFirstTouchChartData.length > 0 ? (
                      <FirstTouchPercentageChart
                        title="Ticket Acknowledgement Time - Mobility"
                        ariaLabel="Monthly Mobility first touch distribution percentages for within 5 minutes and within 10 minutes"
                        data={mobilityFirstTouchChartData}
                      />
                    ) : (
                      <Card withBorder radius="md" p={{ base: "sm", md: "md" }}>
                        <Stack align="center" gap="sm" py="xl">
                          <ThemeIcon size={56} radius="xl" variant="light" color="blue">
                            <IconChartBar size={28} />
                          </ThemeIcon>
                          <Title order={4}>No Mobility first-touch chart data yet</Title>
                          <Text c="dimmed" ta="center" maw={680}>Upload or open a workbook with First Touch Distribution data to populate the Mobility percentage chart. If a report is already loaded, check whether your current filters removed all Mobility rows.</Text>
                        </Stack>
                      </Card>
                    )}
                  </div>

                  <div ref={mobilityTimeToCarrierChartRef} style={{ width: "100%" }}>
                    {mobilityTimeToCarrierChartData.length > 0 ? (
                      <TimeToCarrierPercentageChart
                        title="Time to Carrier Ticket - Mobility"
                        ariaLabel="Monthly Mobility time to carrier ticket percentages for under 15 minutes and over 15 minutes"
                        data={mobilityTimeToCarrierChartData}
                      />
                    ) : (
                      <Card withBorder radius="md" p={{ base: "sm", md: "md" }}>
                        <Stack align="center" gap="sm" py="xl">
                          <ThemeIcon size={56} radius="xl" variant="light" color="blue">
                            <IconChartBar size={28} />
                          </ThemeIcon>
                          <Title order={4}>No Mobility time-to-carrier chart data yet</Title>
                          <Text c="dimmed" ta="center" maw={680}>Upload or open a workbook with Time to Carrier Ticket data to populate the Mobility percentage chart. If a report is already loaded, check whether your current filters removed all Mobility rows.</Text>
                        </Stack>
                      </Card>
                    )}
                  </div>

                  <div ref={mobilityResolutionChartRef} style={{ width: "100%" }}>
                    {mobilityResolutionChartData.length > 0 ? (
                      <TicketResolutionsChart
                        title="Ticket Resolutions - Mobility"
                        ariaLabel="Stacked monthly Mobility ticket resolutions by category"
                        data={mobilityResolutionChartData}
                        summaryMonthLabel={mobilityResolutionChartSummaryMonthLabel}
                        summaryRows={mobilityResolutionChartSummaryRows}
                        seriesDefinitions={MOBILITY_RESOLUTION_CHART_SERIES}
                      />
                    ) : (
                      <Card withBorder radius="md" p={{ base: "sm", md: "md" }}>
                        <Stack align="center" gap="sm" py="xl">
                          <ThemeIcon size={56} radius="xl" variant="light" color="blue">
                            <IconChartBar size={28} />
                          </ThemeIcon>
                          <Title order={4}>No Mobility ticket resolution chart data yet</Title>
                          <Text c="dimmed" ta="center" maw={680}>Upload or open a workbook with resolution trend data to populate the Mobility ticket resolution chart. If a report is already loaded, check whether your current filters removed all Mobility rows.</Text>
                        </Stack>
                      </Card>
                    )}
                  </div>

                  <div
                    ref={chronicCircuitsRef}
                    style={{
                      width: "100%",
                      maxWidth: "1360px",
                      margin: "0 auto",
                      background: CHART_PANEL_BACKGROUND,
                      padding: "10px 14px 44px",
                      minHeight: "650px",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        aspectRatio: "16 / 9",
                        minHeight: "650px",
                        display: "grid",
                        gridTemplateRows: "88px minmax(0, 1fr) 48px",
                      }}
                    >
                      <div />
                      <div style={{ minWidth: 0, minHeight: 0, padding: "0 18px" }}>
                        <Title
                          order={3}
                          ta="center"
                          c="black"
                          style={{ marginBottom: "18px", fontSize: "34px", fontWeight: 800, letterSpacing: "-0.03em" }}
                        >
                          Top 10 Chronic Circuits
                        </Title>

                        {chronicCircuitTableData.monthLabels.length === 0 ? (
                          <Alert color="gray" variant="light">No monthly chronic ticket data available.</Alert>
                        ) : chronicCircuitTableData.rows.length === 0 ? (
                          <Alert color="gray" variant="light">No chronic circuits found for the selected report.</Alert>
                        ) : (
                          <Table
                            withTableBorder
                            withColumnBorders
                            highlightOnHover={false}
                            fz="xs"
                            c="black"
                            style={{
                              tableLayout: "fixed",
                              width: "100%",
                              background: "transparent",
                              borderColor: "#000000",
                            }}
                          >
                            <Table.Thead>
                              <Table.Tr>
                                <Table.Th w="20%" px={8} py={6} c="black" style={{ background: "transparent", borderColor: "#000000" }}>Account</Table.Th>
                                <Table.Th w="20%" px={8} py={6} c="black" style={{ background: "transparent", borderColor: "#000000" }}>Circuit ID</Table.Th>
                                <Table.Th w="16%" px={8} py={6} c="black" style={{ background: "transparent", borderColor: "#000000" }}>Carrier Name</Table.Th>
                                {chronicCircuitTableData.monthLabels.map((monthLabel) => (
                                  <Table.Th key={monthLabel} w="7%" px={6} py={6} ta="center" c="black" style={{ background: "transparent", borderColor: "#000000" }}>{monthLabel}</Table.Th>
                                ))}
                                <Table.Th w="9%" px={6} py={6} ta="center" c="black" style={{ background: "transparent", borderColor: "#000000" }}>Grand Total</Table.Th>
                              </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                              {chronicCircuitTableData.rows.map((row) => (
                                <Table.Tr key={`${row.account}-${row.circuitId}-${row.carrier}`} style={{ background: "transparent" }}>
                                  <Table.Td px={8} py={6} c="black" style={{ background: "transparent", borderColor: "#000000" }}>
                                    <Text size="xs" c="black" style={{ lineHeight: 1.25 }}>{row.account}</Text>
                                  </Table.Td>
                                  <Table.Td px={8} py={6} c="black" style={{ background: "transparent", borderColor: "#000000" }}>
                                    <Stack gap={4}>
                                      <Text fw={600} size="xs" c="black" style={{ lineHeight: 1.2 }}>{row.circuitId}</Text>
                                      {row.isLatestMonthPriority ? (
                                        <Badge
                                          size="xs"
                                          variant="filled"
                                          styles={{
                                            root: {
                                              alignSelf: "flex-start",
                                              backgroundColor: "white",
                                              color: "#dc2626",
                                              border: "1px solid #fecaca",
                                            },
                                            label: {
                                              fontSize: "9px",
                                              lineHeight: 1,
                                              padding: 0,
                                              color: "#dc2626",
                                            },
                                          }}
                                        >
                                          Latest month ≥ 2
                                        </Badge>
                                      ) : null}
                                    </Stack>
                                  </Table.Td>
                                  <Table.Td px={8} py={6} c="black" style={{ background: "transparent", borderColor: "#000000" }}>
                                    <Text size="xs" c="black" style={{ lineHeight: 1.25 }}>{row.carrier}</Text>
                                  </Table.Td>
                                  {chronicCircuitTableData.monthKeys.map((monthKey) => (
                                    <Table.Td key={`${row.account}-${row.circuitId}-${row.carrier}-${monthKey}`} px={6} py={6} ta="center" c="black" style={{ background: "transparent", borderColor: "#000000" }}>
                                      <Text size="xs" c="black">{row.monthlyCounts[monthKey] ?? 0}</Text>
                                    </Table.Td>
                                  ))}
                                  <Table.Td px={6} py={6} ta="center" fw={700} c="black" style={{ background: "transparent", borderColor: "#000000" }}>
                                    <Text size="xs" fw={700} c="black">{row.grandTotal}</Text>
                                  </Table.Td>
                                </Table.Tr>
                              ))}
                            </Table.Tbody>
                          </Table>
                        )}
                      </div>
                      <div />
                    </div>
                  </div>
                </Stack>
              </Stack>
            ) : (
              <Card withBorder radius="md" p="xl">
                <Stack align="center" gap="sm">
                  <ThemeIcon size={56} radius="xl" variant="light" color="orange">
                    <IconChartBar size={28} />
                  </ThemeIcon>
                  <Title order={4}>Upload and save an MTTR workbook to view charts</Title>
                  <Text c="dimmed" ta="center" maw={620}>The Charts tab now includes stacked Ticket Volumes visuals for both Network and Mobility, matching the report style you shared.</Text>
                </Stack>
              </Card>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="trends" pt="md">
            {parsed ? (
              <Stack gap="md">
                <Card withBorder radius="md" p="md">
                  <Stack gap="md">
                    <Group justify="space-between" align="end">
                      <Stack gap={2}>
                        <Title order={5}>Trend filters</Title>
                        <Text size="sm" c="dimmed">These filters apply to the calculated trend sections below.</Text>
                      </Stack>
                      <Group gap="sm" align="center">
                        <Button variant="light" color="gray" onClick={clearAllFilters} disabled={!hasActiveFilters}>Clear all filters</Button>
                        <ThemeIcon variant="light" color="orange" size="lg">
                          <IconFilter size={18} />
                        </ThemeIcon>
                      </Group>
                    </Group>
                    <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }}>
                      <MultiSelect
                        label="Customer"
                        placeholder="Start typing a customer name"
                        value={selectedCustomers}
                        onChange={setSelectedCustomers}
                        searchable
                        clearable
                        hidePickedOptions
                        maxDropdownHeight={280}
                        limit={25}
                        data={customerOptions}
                        nothingFoundMessage="No matching customer"
                      />
                      <Select
                        label="Reported via"
                        value={reportedViaFilter}
                        onChange={(value) => setReportedViaFilter((value as ReportedViaFilter) ?? "both")}
                        data={[
                          { value: "both", label: "NOC + Mobility" },
                          { value: "noc", label: "NOC only" },
                          { value: "mobility", label: "Mobility only" },
                        ]}
                      />
                      <Select
                        label="Channel"
                        value={channelFilter}
                        onChange={(value) => setChannelFilter((value as ChannelFilter) ?? "both")}
                        data={[
                          { value: "both", label: "Buyers' Club + MSP" },
                          { value: "buyers_club", label: "Buyers' Club only" },
                          { value: "msp", label: "MSP only" },
                        ]}
                      />
                      <Select
                        label="Maintenance"
                        value={maintenanceFilter}
                        onChange={(value) => setMaintenanceFilter((value as MaintenanceFilter) ?? "include")}
                        data={[
                          { value: "include", label: "Include maintenance" },
                          { value: "exclude", label: "Exclude maintenance" },
                        ]}
                      />
                    </SimpleGrid>

                  </Stack>
                </Card>

                <Card withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Group justify="space-between" align="start">
                    <Stack gap={2}>
                      <Title order={5}>Workbook trend sections</Title>
                      <Text size="sm" c="dimmed">Monthly matrix sections discovered from the workbook, ordered as requested: Ticket Volume, First Touch Distribution, Time to Carrier Ticket, Top Issue Types, Ticket Resolutions, Top 15 Carriers, and Avg MTTR.</Text>
                    </Stack>
                    <Badge color="orange" variant="light">{workbookTrendSections.length} sections</Badge>
                  </Group>

                  {workbookTrendSections.length === 0 ? (
                    <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light">I could not detect the Trends sections yet. Expected sections are: Ticket Volume, First Touch Distribution, Time to Carrier Ticket, Top Issue Types, Ticket Resolutions, Top 15 Carriers, and Avg MTTR.</Alert>
                  ) : (
                    <Stack gap="md">
                      {PREFERRED_TREND_SECTION_ORDER.map((sectionTitle) => {
                        const section = workbookTrendSections.find((entry) => entry.title === sectionTitle) ?? null;

                        if (!section) {
                          return (
                            <Card key={sectionTitle} withBorder radius="md" p="md">
                              <Stack gap={6}>
                                <Group justify="space-between" align="center">
                                  <Text fw={700}>{sectionTitle}</Text>
                                  <Badge color="gray" variant="light">Not detected</Badge>
                                </Group>
                                <Text size="sm" c="dimmed">This section has been reserved in the Trends tab, but it was not detected in the current workbook.</Text>
                              </Stack>
                            </Card>
                          );
                        }

                        return (
                          <Card key={`${section.sheetName}-${section.title}`} withBorder radius="md" p="0" style={{ overflow: "hidden" }}>
                            <Stack gap={0}>
                              <Group justify="space-between" px="md" py="sm" bg="var(--mantine-color-gray-0)">
                                <Text fw={700}>{section.title}</Text>
                                <Group gap="xs">
                                  {section.source === "calculated" ? <Badge color="teal" variant="light">Calculated</Badge> : null}
                                  {section.truncated ? <Badge color="yellow" variant="light">trimmed for stability</Badge> : null}
                                  <Badge color="blue" variant="light">{section.sheetName}</Badge>
                                  <Badge color="gray" variant="light">{section.rows.length} rows shown</Badge>
                                </Group>
                              </Group>
                              <ScrollArea>
                                <Table withTableBorder withColumnBorders striped highlightOnHover>
                                  <Table.Thead>
                                    <Table.Tr>
                                      <Table.Th miw={220}>Metric</Table.Th>
                                      {section.displayColumns.map((column) => {
                                        const monthKey = section.monthKeyByDisplayColumn?.[column] ?? null;
                                        const canOpenTicketMonthDetail = (section.title === "Ticket Volume" || section.title === "Top Issue Types") && Boolean(monthKey);
                                        const canOpenResolutionSummary = section.title === "Ticket Resolutions" && Boolean(monthKey) && (reportedViaFilter === "noc" || reportedViaFilter === "mobility");

                                        return (
                                          <Table.Th key={`${section.sheetName}-${section.title}-${column}`} miw={82}>
                                            <Group gap={6} wrap="nowrap" align="center">
                                              <Text size="sm" fw={600}>{column}</Text>
                                              {canOpenTicketMonthDetail ? (
                                                <Button
                                                  size="compact-xs"
                                                  variant="light"
                                                  color="orange"
                                                  px={6}
                                                  onClick={() => setMonthDetailModal({
                                                    sectionSheetName: section.sheetName,
                                                    sectionTitle: section.title,
                                                    monthKey: monthKey ?? column,
                                                    monthLabel: column,
                                                    detailType: "tickets",
                                                  })}
                                                  aria-label={`Show ${section.title} ticket details for ${column}`}
                                                >
                                                  <IconEye size={14} />
                                                </Button>
                                              ) : null}
                                              {canOpenResolutionSummary ? (
                                                <Button
                                                  size="compact-xs"
                                                  variant="light"
                                                  color="grape"
                                                  px={6}
                                                  onClick={() => setMonthDetailModal({
                                                    sectionSheetName: section.sheetName,
                                                    sectionTitle: section.title,
                                                    monthKey: monthKey ?? column,
                                                    monthLabel: column,
                                                    detailType: "resolution-summary",
                                                  })}
                                                  aria-label={`Show ${section.title} resolution summary for ${column}`}
                                                >
                                                  <IconEye size={14} />
                                                </Button>
                                              ) : null}
                                            </Group>
                                          </Table.Th>
                                        );
                                      })}
                                    </Table.Tr>
                                  </Table.Thead>
                                  <Table.Tbody>
                                    {section.rows.map((row) => (
                                      <Table.Tr key={`${section.sheetName}-${section.title}-${row.label}`}>
                                        <Table.Td>
                                          <Text fw={500}>{row.label}</Text>
                                        </Table.Td>
                                        {section.displayColumns.map((column) => {
                                          const value = row.values[column] ?? "—";
                                          const resolutionMatch = section.title === "Ticket Resolutions"
                                            ? /^(.*)\s\(([^)]+)\)$/.exec(value)
                                            : null;
                                          const volumeParts = section.title === "Ticket Volume" ? value.split("||") : null;

                                          return (
                                            <Table.Td key={`${section.sheetName}-${section.title}-${row.label}-${column}`}>
                                              {resolutionMatch ? (
                                                <Text size="sm">
                                                  {resolutionMatch[1]} <Text component="span" size="xs" c="dimmed">({resolutionMatch[2]})</Text>
                                                </Text>
                                              ) : volumeParts && volumeParts.length === 2 ? (
                                                <Group gap={6} wrap="nowrap" align="baseline">
                                                  <Text size="sm" fw={500}>{volumeParts[0]}</Text>
                                                  <Text size="xs" c="dimmed">{volumeParts[1]}</Text>
                                                </Group>
                                              ) : (
                                                <Text size="sm">{value}</Text>
                                              )}
                                            </Table.Td>
                                          );
                                        })}
                                      </Table.Tr>
                                    ))}
                                  </Table.Tbody>
                                </Table>
                              </ScrollArea>
                            </Stack>
                          </Card>
                        );
                      })}
                    </Stack>
                  )}
                  </Stack>
                </Card>
              </Stack>
            ) : (
              <Card withBorder radius="md" p="xl">
                <Stack align="center" gap="sm">
                  <ThemeIcon size={56} radius="xl" variant="light" color="orange">
                    <IconChartLine size={28} />
                  </ThemeIcon>
                  <Title order={4}>Upload and save an MTTR workbook to view Trends</Title>
                  <Text c="dimmed" ta="center" maw={620}>The Trends tab contains the requested sections: Ticket Volume, First Touch Distribution, Time to Carrier Ticket, Top Issue Types, Ticket Resolutions, Top 15 Carriers, and Avg MTTR.</Text>
                </Stack>
              </Card>
            )}
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </WidgetFrame>
  );
}

export function NocMttrReportTile({ onExpand }: { onExpand: () => void }) {
  return (
    <WidgetTile
      title="NOC MTTR Report"
      description="Upload MTTR Excel data, save it to the database, and view it in a monthly matrix layout"
      icon={IconClock}
      iconColor="orange"
      onExpand={onExpand}
    >
      <Stack gap={6}>
        <Group gap="xs">
          <Badge color="orange" variant="light">Tab workflow</Badge>
          <Badge color="blue" variant="light">Saved reports</Badge>
        </Group>
        <Text size="sm" c="dimmed">Open saved reports, upload new workbooks, and analyse the same month-column layout from the source file.</Text>
      </Stack>
    </WidgetTile>
  );
}
