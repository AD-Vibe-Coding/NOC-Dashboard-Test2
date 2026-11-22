import * as XLSX from "xlsx";
import type { KpiKey } from "./kpis";
import type { VolumeKey } from "./volumes";
import { matchTeamMember } from "./team-members";

export type UploadKind = "tickets" | "mobility" | "calls";

export type MonthSlice = {
  monthKey: string;
  monthLabel: string;
  volumes: Partial<Record<VolumeKey, number>>;
  kpis: Partial<Record<KpiKey, number>>;
  carriers: { name: string; tickets: number }[];
  mix?: {
    maintenance: number;
    outage: number;
    comcast: number;
    comcastMaintenance: number;
    comcastOutage: number;
  };
  patterns?: MonthPatterns;
  automation?: AutomationSlice;
  used: number;
};

export type AutomationSlice = {
  tickets: number;
  ackSum: number;
  ackN: number;
  carrierSum: number;
  carrierN: number;
  carrierOk: number;
  carrierIntervalN: number;
  closed24: number;
  closedN: number;
  mttrSum: number;
  mttrN: number;
};

export type NameCount = { name: string; tickets: number };

export type MonthPatterns = {
  issueTypes: NameCount[];
  resolutions: NameCount[];
  source: { techSupport: number; manual: number };
  avgCarrierOpenMinutes: number | null;
  carrierOpenByCarrier: { name: string; avgMinutes: number; n: number }[];
  days: NameCount[];
  hours: NameCount[];
};

export type UploadResult = {
  kind: UploadKind;
  filename: string;
  rows: number;
  used: number;
  errors: string[];
  volumes: Partial<Record<VolumeKey, number>>;
  kpis: Partial<Record<KpiKey, number>>;
  carriers: { name: string; tickets: number }[];
  months: MonthSlice[];
  /** Per-roster-member month slices (tickets attributed via Acked By / agent). */
  members?: Record<string, MonthSlice[]>;
};

const MONTH_NAMES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function parseMonthKey(raw: unknown): { key: string; label: string } | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = raw.getMonth() + 1;
    return { key: `${y}-${pad2(m)}`, label: monthLabel(y, m) };
  }
  const t = String(raw).trim();
  if (!t) return null;
  const excelSerial = Number(t);
  if (Number.isFinite(excelSerial) && excelSerial > 30000 && excelSerial < 60000) {
    const d = new Date(Math.round((excelSerial - 25569) * 86400 * 1000));
    if (!Number.isNaN(d.getTime())) {
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      return { key: `${y}-${pad2(m)}`, label: monthLabel(y, m) };
    }
  }
  const iso = t.match(/^(\d{4})[-/](\d{1,2})/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    if (m >= 1 && m <= 12) return { key: `${y}-${pad2(m)}`, label: monthLabel(y, m) };
  }
  const us = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (us) {
    let y = Number(us[3]);
    if (y < 100) y += 2000;
    const m = Number(us[1]) > 12 ? Number(us[2]) : Number(us[1]);
    if (m >= 1 && m <= 12) return { key: `${y}-${pad2(m)}`, label: monthLabel(y, m) };
  }
  const named = t.match(/([A-Za-z]{3,9})\s*[,-]?\s*(\d{2,4})/);
  if (named) {
    const mi = MONTH_NAMES.findIndex((n) => named[1].toLowerCase().startsWith(n));
    if (mi >= 0) {
      let y = Number(named[2]);
      if (y < 100) y += 2000;
      return { key: `${y}-${pad2(mi + 1)}`, label: monthLabel(y, mi + 1) };
    }
  }
  const dash = t.match(/^(\d{4})(\d{2})$/);
  if (dash) {
    const y = Number(dash[1]);
    const m = Number(dash[2]);
    if (m >= 1 && m <= 12) return { key: `${y}-${pad2(m)}`, label: monthLabel(y, m) };
  }
  return null;
}

function monthLabel(year: number, month: number) {
  const short = MONTH_NAMES[month - 1];
  const yy = String(year).slice(-2);
  const pretty = short ? short[0].toUpperCase() + short.slice(1) : String(month);
  return `${pretty} ${yy}`;
}

export function monthKeyFromLabel(label: string): string | null {
  const named = label.match(/([A-Za-z]{3})\s+(\d{2})/);
  if (!named) return null;
  const mi = MONTH_NAMES.findIndex((n) => named[1].toLowerCase().startsWith(n));
  if (mi < 0) return null;
  const y = 2000 + Number(named[2]);
  return `${y}-${pad2(mi + 1)}`;
}

export function quarterKeyFromLabel(label: string): string[] {
  const m = label.match(/Q(\d)\s+(\d{2})/);
  if (!m) return [];
  const q = Number(m[1]);
  const y = 2000 + Number(m[2]);
  const start = (q - 1) * 3 + 1;
  return [0, 1, 2].map((i) => `${y}-${pad2(start + i)}`);
}

function cell(row: Record<string, unknown>, ...names: string[]) {
  const keys = Object.keys(row);
  for (const name of names) {
    const want = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const hit = keys.find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, "") === want);
    if (hit != null && row[hit] != null && String(row[hit]).trim() !== "") return String(row[hit]).trim();
  }
  for (const name of names) {
    const want = name.toLowerCase();
    const hit = keys.find((k) => k.toLowerCase().includes(want));
    if (hit != null && row[hit] != null && String(row[hit]).trim() !== "") return String(row[hit]).trim();
  }
  return "";
}

function toSeconds(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.getUTCHours() * 3600 + raw.getUTCMinutes() * 60 + raw.getUTCSeconds();
  }
  const t = String(raw).trim();
  if (!t) return null;
  if (/^\d{1,2}:\d{2}:\d{2}/.test(t)) {
    const [h, m, s] = t.split(":").map(Number);
    return h * 3600 + m * 60 + s;
  }
  if (/^\d{1,3}:\d{2}/.test(t)) {
    const [m, s] = t.split(":").map(Number);
    return m * 60 + s;
  }
  const n = Number(t.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  if (n > 0 && n < 1) return n * 86400;
  if (n > 24 && n < 86400) return n;
  return n * 60;
}

/** Column AN "Ticket Acknowledge Time" is minutes (1, 8, 13…) or Excel time. */
function ackMinutesToSeconds(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.getUTCHours() * 3600 + raw.getUTCMinutes() * 60 + raw.getUTCSeconds();
  }
  const t = String(raw).trim();
  if (!t) return null;
  if (/^\d{1,2}:\d{2}:\d{2}/.test(t)) {
    const [h, m, s] = t.split(":").map(Number);
    return h * 3600 + m * 60 + s;
  }
  if (/^\d{1,3}:\d{2}/.test(t)) {
    const [m, s] = t.split(":").map(Number);
    return m * 60 + s;
  }
  const n = Number(t.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  if (n > 0 && n < 1) return n * 86400;
  return n * 60;
}

function yesNo(raw: string): boolean | null {
  const t = raw.toLowerCase();
  if (!t) return null;
  if (["y", "yes", "true", "1", "met", "on time", "ontime", "pass"].includes(t)) return true;
  if (["n", "no", "false", "0", "missed", "fail", "late"].includes(t)) return false;
  return null;
}

function direction(raw: string): "inbound" | "outbound" | null {
  const t = raw.toLowerCase();
  if (t.includes("in")) return "inbound";
  if (t.includes("out")) return "outbound";
  return null;
}

type Acc = {
  used: number;
  ack: number[];
  ackUnder5: number;
  carrierOk: number;
  carrierN: number;
  closed24: number;
  closedN: number;
  mttr: number[];
  mobilityOk: number;
  mobilityN: number;
  inbound: number;
  outbound: number;
  asa: number[];
  refused: number;
  carriers: Map<string, number>;
  maintenance: number;
  outage: number;
  comcast: number;
  comcastMaintenance: number;
  comcastOutage: number;
  issueTypes: Map<string, number>;
  resolutions: Map<string, number>;
  techSupport: number;
  manual: number;
  carrierOpenMinutes: number[];
  carrierOpenByCarrier: Map<string, { sum: number; n: number }>;
  days: Map<string, number>;
  hours: Map<string, number>;
  intervalOk: number;
  intervalN: number;
  autoTickets: number;
  autoAck: number[];
  autoCarrier: number[];
  autoIntervalOk: number;
  autoIntervalN: number;
  autoClosed24: number;
  autoClosedN: number;
  autoMttr: number[];
};

function emptyAcc(): Acc {
  return {
    used: 0,
    ack: [],
    ackUnder5: 0,
    carrierOk: 0,
    carrierN: 0,
    closed24: 0,
    closedN: 0,
    mttr: [],
    mobilityOk: 0,
    mobilityN: 0,
    inbound: 0,
    outbound: 0,
    asa: [],
    refused: 0,
    carriers: new Map(),
    maintenance: 0,
    outage: 0,
    comcast: 0,
    comcastMaintenance: 0,
    comcastOutage: 0,
    issueTypes: new Map(),
    resolutions: new Map(),
    techSupport: 0,
    manual: 0,
    carrierOpenMinutes: [],
    carrierOpenByCarrier: new Map(),
    days: new Map(),
    hours: new Map(),
    intervalOk: 0,
    intervalN: 0,
    autoTickets: 0,
    autoAck: [],
    autoCarrier: [],
    autoIntervalOk: 0,
    autoIntervalN: 0,
    autoClosed24: 0,
    autoClosedN: 0,
    autoMttr: [],
  };
}

function isAutomationAck(agent: string): boolean {
  return /^\s*automation\s*$/i.test(agent.trim());
}

function categorizeIssueType(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const n = t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (/\bmns\s*alert\b/.test(n)) return "MNS Alert";
  if (/\bmaintenance\s*notification\b/.test(n) || /\bmaint(enance)?\s*notif/.test(n)) {
    return "Maintenance Notification";
  }
  return "Other";
}

function bumpMap(map: Map<string, number>, key: string) {
  const k = key.trim();
  if (!k) return;
  map.set(k, (map.get(k) ?? 0) + 1);
}

function topMap(map: Map<string, number>, limit = 12): NameCount[] {
  return [...map.entries()]
    .map(([name, tickets]) => ({ name, tickets }))
    .sort((a, b) => b.tickets - a.tickets)
    .slice(0, limit);
}

function parseHourLabel(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return String(raw.getUTCHours()).padStart(2, "0");
  }
  const t = String(raw).trim();
  if (!t) return null;
  const hm = t.match(/^(\d{1,2})(?::\d{2})?/);
  if (hm) {
    const h = Number(hm[1]);
    if (h >= 0 && h <= 23) return String(h).padStart(2, "0");
  }
  const n = Number(t);
  if (Number.isFinite(n) && n >= 0 && n < 1) {
    return String(Math.floor(n * 24)).padStart(2, "0");
  }
  if (Number.isFinite(n) && n >= 0 && n <= 23) return String(Math.floor(n)).padStart(2, "0");
  return t.slice(0, 16);
}

function parseDayLabel(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][raw.getUTCDay()] ?? null;
  }
  const t = String(raw).trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  const days: [string, string][] = [
    ["sunday", "Sun"],
    ["monday", "Mon"],
    ["tuesday", "Tue"],
    ["wednesday", "Wed"],
    ["thursday", "Thu"],
    ["friday", "Fri"],
    ["saturday", "Sat"],
  ];
  for (const [full, short] of days) {
    if (lower.startsWith(full.slice(0, 3))) return short;
  }
  return t.slice(0, 24);
}

function finish(kind: UploadKind, acc: Acc): {
  volumes: MonthSlice["volumes"];
  kpis: MonthSlice["kpis"];
  carriers: MonthSlice["carriers"];
  mix: MonthSlice["mix"];
  patterns: MonthSlice["patterns"];
  automation: MonthSlice["automation"];
} {
  const volumes: MonthSlice["volumes"] = {};
  const kpis: MonthSlice["kpis"] = {};
  if (kind === "tickets") {
    volumes.tickets_received = acc.used;
    if (acc.ack.length) {
      kpis.avg_ack_seconds = acc.ack.reduce((a, b) => a + b, 0) / acc.ack.length;
      kpis.ack_under_5_pct = (acc.ackUnder5 / acc.ack.length) * 100;
    }
    if (acc.intervalN) kpis.carrier_open_sla_pct = (acc.intervalOk / acc.intervalN) * 100;
    else if (acc.carrierN) kpis.carrier_open_sla_pct = (acc.carrierOk / acc.carrierN) * 100;
    if (acc.closedN) kpis.closed_under_24h_pct = (acc.closed24 / acc.closedN) * 100;
    if (acc.mttr.length) kpis.avg_mttr_seconds = acc.mttr.reduce((a, b) => a + b, 0) / acc.mttr.length;
  }
  if (kind === "mobility") {
    volumes.mobility_tasks = acc.used;
    if (acc.used) kpis.mobility_sla_pct = (acc.mobilityOk / acc.used) * 100;
  }
  if (kind === "calls") {
    volumes.inbound_calls = acc.inbound;
    volumes.outbound_calls = acc.outbound;
    if (acc.asa.length) kpis.asa_seconds = acc.asa.reduce((a, b) => a + b, 0) / acc.asa.length;
    kpis.refused_calls = acc.refused;
  }
  return {
    volumes,
    kpis,
    carriers: [...acc.carriers.entries()].map(([name, tickets]) => ({ name, tickets })),
    mix:
      kind === "tickets"
        ? {
            maintenance: acc.maintenance,
            outage: acc.outage,
            comcast: acc.comcast,
            comcastMaintenance: acc.comcastMaintenance,
            comcastOutage: acc.comcastOutage,
          }
        : undefined,
    patterns:
      kind === "tickets"
        ? {
            issueTypes: topMap(acc.issueTypes),
            resolutions: topMap(acc.resolutions),
            source: { techSupport: acc.techSupport, manual: acc.manual },
            avgCarrierOpenMinutes: acc.carrierOpenMinutes.length
              ? acc.carrierOpenMinutes.reduce((a, b) => a + b, 0) / acc.carrierOpenMinutes.length
              : null,
            carrierOpenByCarrier: [...acc.carrierOpenByCarrier.entries()]
              .map(([name, v]) => ({ name, avgMinutes: v.sum / v.n, n: v.n }))
              .sort((a, b) => b.avgMinutes - a.avgMinutes)
              .slice(0, 10),
            days: topMap(acc.days, 8),
            hours: topMap(acc.hours, 24),
          }
        : undefined,
    automation:
      kind === "tickets"
        ? {
            tickets: acc.autoTickets,
            ackSum: acc.autoAck.reduce((a, b) => a + b, 0),
            ackN: acc.autoAck.length,
            carrierSum: acc.autoCarrier.reduce((a, b) => a + b, 0),
            carrierN: acc.autoCarrier.length,
            carrierOk: acc.autoIntervalOk,
            carrierIntervalN: acc.autoIntervalN,
            closed24: acc.autoClosed24,
            closedN: acc.autoClosedN,
            mttrSum: acc.autoMttr.reduce((a, b) => a + b, 0),
            mttrN: acc.autoMttr.length,
          }
        : undefined,
  };
}

function bumpMix(a: Acc, isMaint: boolean, isOutage: boolean, isComcast: boolean) {
  if (isMaint) a.maintenance += 1;
  if (isOutage) a.outage += 1;
  if (isComcast) {
    a.comcast += 1;
    if (isMaint) a.comcastMaintenance += 1;
    if (isOutage) a.comcastOutage += 1;
  }
}

function headerIndex(headers: string[], ...names: string[]): number {
  for (const name of names) {
    const want = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const i = headers.findIndex((h) => h.toLowerCase().replace(/[^a-z0-9]/g, "") === want);
    if (i >= 0) return i;
  }
  for (const name of names) {
    const want = name.toLowerCase();
    const i = headers.findIndex((h) => h.toLowerCase().includes(want));
    if (i >= 0) return i;
  }
  return -1;
}

export function parseWorkbook(kind: UploadKind, filename: string, buffer: ArrayBuffer): UploadResult {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<(string | number | Date)[]>(sheet, { header: 1, defval: "", raw: true });
  const headerRow = (matrix[0] ?? []).map((h) => String(h || "").trim());
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const errors: string[] = [];
  const byMonth = new Map<string, { label: string; acc: Acc }>();
  const byMemberMonth = new Map<string, Map<string, { label: string; acc: Acc }>>();
  const total = emptyAcc();
  let used = 0;

  const ackCol = (() => {
    const named = headerIndex(headerRow, "ticket acknowledge time", "acknowledge time", "acked time");
    return named >= 0 ? named : 39;
  })();
  // Column AG (A=0 … AG=32): time to open ticket with the carrier, in minutes.
  const carrierCol = (() => {
    const named = headerIndex(
      headerRow,
      "time to open ticket with the carrier",
      "carrier open",
      "open ticket with the carrier",
    );
    return named >= 0 ? named : 32;
  })();
  // Column AO (A=0 … AO=40): Tickets Acked By.
  const ackedByCol = (() => {
    const named = headerIndex(headerRow, "tickets acked by", "ticket acked by", "acked by");
    return named >= 0 ? named : 40;
  })();
  // Column BD (A=0 … BD=55): hours to close. Under 24 hours = on time. Blanks excluded.
  const closedCol = (() => {
    const named = headerIndex(
      headerRow,
      "closed under 24",
      "tickets closed under 24",
      "time to close",
      "closed in 24",
    );
    return named >= 0 ? named : 55;
  })();
  // M=12 issue, X=23 resolution, Y=24 Ticket Opened By, AW=48 day_opened, AX=49 hour_opened
  const issueCol = (() => {
    const named = headerIndex(headerRow, "issue", "issue type", "ticket type", "category");
    return named >= 0 ? named : 12;
  })();
  const resolutionCol = (() => {
    const named = headerIndex(headerRow, "resolution");
    return named >= 0 ? named : 23;
  })();
  const openedByCol = (() => {
    const named = headerIndex(headerRow, "ticket opened by", "opened by");
    return named >= 0 ? named : 24;
  })();
  const dayCol = (() => {
    const named = headerIndex(headerRow, "day_opened", "day opened", "day of week");
    return named >= 0 ? named : 48;
  })();
  const hourCol = (() => {
    const named = headerIndex(headerRow, "hour_opened", "hour opened", "hour of day");
    return named >= 0 ? named : 49;
  })();
  // Column BJ (A=0 … BJ=61): time_interval_buc — "Under 15 Minutes". Blanks excluded.
  const intervalCol = (() => {
    const named = headerIndex(headerRow, "time_interval_buc", "time interval buc", "time_interval");
    return named >= 0 ? named : 61;
  })();

  const dataRows = matrix.slice(1);

  dataRows.forEach((grid, i) => {
    const monthRaw = grid[1];
    const parsedMonth = parseMonthKey(monthRaw);
    if (!parsedMonth) {
      if (i < 8) errors.push(`Row ${i + 2}: column B is not a recognizable month (${String(monthRaw)})`);
      return;
    }

    const acc = byMonth.get(parsedMonth.key)?.acc ?? emptyAcc();
    if (!byMonth.has(parsedMonth.key)) byMonth.set(parsedMonth.key, { label: parsedMonth.label, acc });

    const row = rows[i] ?? {};

    if (kind === "tickets") {
      const agentFromGrid = String(grid[ackedByCol] ?? "").trim();
      const agent = agentFromGrid || cell(row, "tickets acked by", "ticket acked by", "acked by", "agent", "owner", "assignee");
      const ackSec = ackMinutesToSeconds(grid[ackCol]);
      const carrierCell = grid[carrierCol];
      const carrierBlank =
        carrierCell == null || String(carrierCell).trim() === "";
      const carrierSec = carrierBlank ? null : ackMinutesToSeconds(carrierCell);
      const carrierName = cell(row, "carrier", "vendor", "provider");
      const typeBlob = [
        cell(row, "ticket type", "type", "category", "issue type", "classification"),
        cell(row, "subject", "title", "summary", "description"),
        carrierName,
      ]
        .join(" ")
        .toLowerCase();
      const isMaint = /\bmaint(enance)?\b|\bplanned work\b|\bscheduled\b/.test(typeBlob);
      const isOutage = /\boutage\b|\bdown\b|\bservice affect/.test(typeBlob);
      const isComcast = /\bcomcast\b|\bxfinity\b/.test(typeBlob);
      const closedRaw = String(grid[closedCol] ?? "").trim();
      const intervalRaw = String(grid[intervalCol] ?? "").trim();
      const mttrSec = toSeconds(cell(row, "mttr", "restore time", "time to restore"));
      if (!agent && ackSec == null && carrierSec == null && !carrierName && mttrSec == null) {
        if (i < 5) errors.push(`Row ${i + 2}: no ticket fields recognized`);
        return;
      }
      used += 1;
      acc.used += 1;
      total.used += 1;
      const memberName = matchTeamMember(agent);
      let mAcc: Acc | null = null;
      if (memberName) {
        let mmap = byMemberMonth.get(memberName);
        if (!mmap) {
          mmap = new Map();
          byMemberMonth.set(memberName, mmap);
        }
        const slot = mmap.get(parsedMonth.key) ?? { label: parsedMonth.label, acc: emptyAcc() };
        if (!mmap.has(parsedMonth.key)) mmap.set(parsedMonth.key, slot);
        mAcc = slot.acc;
        mAcc.used += 1;
      }
      const automationAck = isAutomationAck(agent);
      // Team SLAs exclude Automation-acked tickets (those feed the Automation cards only).
      if (!automationAck) {
        if (ackSec != null) {
          acc.ack.push(ackSec);
          total.ack.push(ackSec);
          mAcc?.ack.push(ackSec);
          if (ackSec < 300) {
            acc.ackUnder5 += 1;
            total.ackUnder5 += 1;
            if (mAcc) mAcc.ackUnder5 += 1;
          }
        }
        // AG: minutes to open with carrier (averages). Blank cells excluded.
        if (carrierSec != null) {
          acc.carrierN += 1;
          total.carrierN += 1;
          if (mAcc) mAcc.carrierN += 1;
          if (carrierSec < 15 * 60) {
            acc.carrierOk += 1;
            total.carrierOk += 1;
            if (mAcc) mAcc.carrierOk += 1;
          }
        }
        // BJ: time_interval_buc. "% under 15 minutes" = "Under 15 Minutes" ÷ non-blank BJ.
        if (intervalRaw) {
          const under15 = /under\s*15/i.test(intervalRaw);
          acc.intervalN += 1;
          total.intervalN += 1;
          if (mAcc) mAcc.intervalN += 1;
          if (under15) {
            acc.intervalOk += 1;
            total.intervalOk += 1;
            if (mAcc) mAcc.intervalOk += 1;
          }
        }
      }
      if (carrierName) {
        acc.carriers.set(carrierName, (acc.carriers.get(carrierName) ?? 0) + 1);
        total.carriers.set(carrierName, (total.carriers.get(carrierName) ?? 0) + 1);
        if (mAcc) mAcc.carriers.set(carrierName, (mAcc.carriers.get(carrierName) ?? 0) + 1);
      }
      bumpMix(acc, isMaint, isOutage, isComcast);
      bumpMix(total, isMaint, isOutage, isComcast);
      if (mAcc) bumpMix(mAcc, isMaint, isOutage, isComcast);

      const issueType =
        String(grid[issueCol] ?? "").trim() || cell(row, "issue", "issue type", "ticket type");
      const resolution = String(grid[resolutionCol] ?? "").trim() || cell(row, "resolution");
      const openedBy =
        String(grid[openedByCol] ?? "").trim() || cell(row, "ticket opened by", "opened by");
      const dayLabel = parseDayLabel(grid[dayCol] ?? cell(row, "day_opened", "day opened"));
      const hourLabel = parseHourLabel(grid[hourCol] ?? cell(row, "hour_opened", "hour opened"));
      const carrierMin = carrierSec != null ? carrierSec / 60 : null;

      const applyPatterns = (a: Acc) => {
        if (issueType) bumpMap(a.issueTypes, categorizeIssueType(issueType));
        if (resolution) bumpMap(a.resolutions, resolution);
        if (openedBy) {
          if (/tech\s*support/i.test(openedBy)) a.techSupport += 1;
          else a.manual += 1;
        }
        if (carrierMin != null && Number.isFinite(carrierMin)) {
          a.carrierOpenMinutes.push(carrierMin);
          if (carrierName) {
            const slot = a.carrierOpenByCarrier.get(carrierName) ?? { sum: 0, n: 0 };
            slot.sum += carrierMin;
            slot.n += 1;
            a.carrierOpenByCarrier.set(carrierName, slot);
          }
        }
        if (dayLabel) bumpMap(a.days, dayLabel);
        if (hourLabel) bumpMap(a.hours, hourLabel);
      };
      applyPatterns(acc);
      applyPatterns(total);
      if (mAcc) applyPatterns(mAcc);
      if (!automationAck) {
        // BD: "Less than 24 hours" vs other non-blank labels. Blanks excluded.
        if (closedRaw) {
          acc.closedN += 1;
          total.closedN += 1;
          if (mAcc) mAcc.closedN += 1;
          const closedLabel = closedRaw.toLowerCase();
          if (closedLabel.includes("less than 24")) {
            acc.closed24 += 1;
            total.closed24 += 1;
            if (mAcc) mAcc.closed24 += 1;
          }
        }
        if (mttrSec != null) {
          acc.mttr.push(mttrSec);
          total.mttr.push(mttrSec);
          mAcc?.mttr.push(mttrSec);
        }
      }

      if (automationAck) {
        const bumpAuto = (a: Acc) => {
          a.autoTickets += 1;
          if (ackSec != null) a.autoAck.push(ackSec);
          if (carrierSec != null) a.autoCarrier.push(carrierSec);
          if (intervalRaw) {
            a.autoIntervalN += 1;
            if (/under\s*15/i.test(intervalRaw)) a.autoIntervalOk += 1;
          }
          if (closedRaw) {
            a.autoClosedN += 1;
            if (closedRaw.toLowerCase().includes("less than 24")) a.autoClosed24 += 1;
          }
          if (mttrSec != null) a.autoMttr.push(mttrSec);
        };
        bumpAuto(acc);
        bumpAuto(total);
        if (mAcc) bumpAuto(mAcc);
      }
    }

    if (kind === "mobility") {
      const dur = toSeconds(cell(row, "duration", "handle time", "minutes", "elapsed"));
      const sla = yesNo(cell(row, "sla", "met", "under 60"));
      if (dur == null && sla == null) {
        if (i < 5) errors.push(`Row ${i + 2}: no mobility fields recognized`);
        return;
      }
      used += 1;
      acc.used += 1;
      if (sla != null) {
        if (sla) acc.mobilityOk += 1;
      } else if (dur != null && dur <= 3600) acc.mobilityOk += 1;
    }

    if (kind === "calls") {
      const dir = direction(cell(row, "direction", "type", "call type"));
      const asaSec = toSeconds(cell(row, "asa", "speed of answer", "answer time"));
      const refusedFlag = yesNo(cell(row, "refused", "abandoned"));
      if (!dir && asaSec == null && refusedFlag == null) {
        if (i < 5) errors.push(`Row ${i + 2}: no call fields recognized`);
        return;
      }
      used += 1;
      acc.used += 1;
      total.used += 1;
      if (dir === "inbound") {
        acc.inbound += 1;
        total.inbound += 1;
      } else if (dir === "outbound") {
        acc.outbound += 1;
        total.outbound += 1;
      } else {
        acc.inbound += 1;
        total.inbound += 1;
      }
      if (asaSec != null) {
        acc.asa.push(asaSec);
        total.asa.push(asaSec);
      }
      if (refusedFlag) {
        acc.refused += 1;
        total.refused += 1;
      }
    }
  });

  const months: MonthSlice[] = [...byMonth.entries()].map(([monthKey, { label, acc }]) => {
    const done = finish(kind, acc);
    return { monthKey, monthLabel: label, used: acc.used, ...done };
  });

  const totals = finish(kind, total);

  const members: Record<string, MonthSlice[]> = {};
  for (const [name, mmap] of byMemberMonth.entries()) {
    members[name] = [...mmap.entries()].map(([monthKey, { label, acc }]) => {
      const done = finish(kind, acc);
      return { monthKey, monthLabel: label, used: acc.used, ...done };
    });
  }

  return {
    kind,
    filename,
    rows: rows.length,
    used,
    errors: errors.slice(0, 12),
    volumes: totals.volumes,
    kpis: totals.kpis,
    carriers: totals.carriers,
    months,
    members,
  };
}
