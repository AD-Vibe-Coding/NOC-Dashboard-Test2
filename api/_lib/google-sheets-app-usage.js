import { google } from "googleapis";
import { supabaseAdmin } from "./supabase-admin.js";
import { ROSTER_BY_EMAIL } from "./roles.js";

const SPREADSHEET_ID = "1gCue6XyP40Zk7KTgGG92wvaSBAbrGLygLImD54RTvuk";
const SHEET_TAB_NAME = "App_Usage";
const SHEET_RANGE = `${SHEET_TAB_NAME}!A:G`;
const APP_USAGE_SOURCE = "AppDirect";
const APP_USAGE_DEPARTMENT = "NOC";
const EXCLUDED_WIDGET_IDS = new Set(["zoom-queue", "shift-checklist"]);
const EXCLUDED_WIDGET_TITLES = new Set(["team availability", "shift handover checklist"]);

function parseServiceAccountJson() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON. Add the Google service account JSON secret, then share the sheet with that service account as an Editor.");
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
}

function getSheetsClient() {
  const credentials = parseServiceAccountJson();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcWeek(date) {
  const day = date.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  const monday = startOfUtcDay(date);
  monday.setUTCDate(monday.getUTCDate() - diffToMonday);
  return monday;
}

export function getPreviousWeekWindow(now = new Date()) {
  const currentWeekStart = startOfUtcWeek(now);
  const currentDayStart = startOfUtcDay(now);
  const currentDayEndExclusive = new Date(currentDayStart);
  currentDayEndExclusive.setUTCDate(currentDayEndExclusive.getUTCDate() + 1);

  return {
    start: currentWeekStart,
    endExclusive: currentDayEndExclusive,
    endInclusive: currentDayStart,
    startDate: isoDate(currentWeekStart),
    endDate: isoDate(currentDayStart),
  };
}

function formatUtcTimestamp(iso) {
  const date = new Date(iso);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
}

function rowKey(row) {
  return row.map((value) => String(value ?? "").trim()).join("\u241F");
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function companyFromEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return APP_USAGE_SOURCE;
  const domain = normalized.split("@")[1] ?? "";
  if (domain === "appdirect.com") return "AppDirect";
  if (!domain) return APP_USAGE_SOURCE;
  return domain.replace(/\.[^.]+$/, "").replace(/(^|[-_.])(\w)/g, (_, prefix, ch) => `${prefix === undefined ? "" : ""}${ch.toUpperCase()}`);
}

async function loadEmailMap() {
  const emailByName = new Map();

  for (const [email, identity] of Object.entries(ROSTER_BY_EMAIL)) {
    if (identity?.name) emailByName.set(identity.name, email);
  }

  const { data, error } = await supabaseAdmin
    .from("user_sessions")
    .select("name, email, last_sign_in")
    .order("last_sign_in", { ascending: false })
    .limit(500);

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const name = String(row.name ?? "").trim();
    const email = normalizeEmail(row.email);
    if (name && email && !emailByName.has(name)) {
      emailByName.set(name, email);
    }
  }

  return emailByName;
}

async function loadWeeklyWidgetEvents(window) {
  const { data, error } = await supabaseAdmin
    .from("app_events")
    .select("user_name, widget_id, widget_title, event_type, created_at")
    .eq("event_type", "widget_open")
    .gte("created_at", window.start.toISOString())
    .lt("created_at", window.endExclusive.toISOString())
    .order("created_at", { ascending: true })
    .limit(10000);

  if (error) throw new Error(error.message);
  return data ?? [];
}

function isExcludedAppUsageEvent(event) {
  const widgetId = String(event?.widget_id ?? "").trim().toLowerCase();
  const widgetTitle = String(event?.widget_title ?? "").trim().toLowerCase();
  return EXCLUDED_WIDGET_IDS.has(widgetId) || EXCLUDED_WIDGET_TITLES.has(widgetTitle);
}

function buildUsageRows(events, emailByName) {
  return events.flatMap((event) => {
    if (isExcludedAppUsageEvent(event)) return [];

    const memberName = String(event.user_name ?? "").trim();
    const memberEmail = normalizeEmail(emailByName.get(memberName));
    const workItemName = String(event.widget_title ?? event.widget_id ?? "").trim();
    const createdAt = String(event.created_at ?? "").trim();

    if (!memberEmail || !workItemName || !createdAt) return [];

    return [[
      memberEmail,
      createdAt.slice(0, 10),
      APP_USAGE_DEPARTMENT,
      workItemName,
      "app",
      "",
      `Auto-tracked dashboard use at ${formatUtcTimestamp(createdAt)} (${String(event.widget_id ?? "widget").trim() || "widget"})`,
    ]];
  });
}

async function loadExistingSheetRows(sheets) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: SHEET_RANGE,
  });

  const values = response.data.values ?? [];
  const populatedRows = values.filter(
    (row) => Array.isArray(row) && row.some((cell) => String(cell ?? "").trim().length > 0),
  );

  return {
    existingKeys: new Set(
      populatedRows
        .filter((row) => String(row[0] ?? "").trim().toLowerCase() !== "member_email")
        .map((row) => rowKey([
          row[0] ?? "",
          row[1] ?? "",
          row[2] ?? "",
          row[3] ?? "",
          row[4] ?? "",
          row[5] ?? "",
          row[6] ?? "",
        ])),
    ),
    nextEmptyRow: Math.max(1, populatedRows.length) + 1,
  };
}

export async function syncWeeklyAppUsageToGoogleSheet(now = new Date()) {
  const window = getPreviousWeekWindow(now);
  const sheets = getSheetsClient();
  const [events, emailByName, sheetState] = await Promise.all([
    loadWeeklyWidgetEvents(window),
    loadEmailMap(),
    loadExistingSheetRows(sheets),
  ]);

  const preparedRows = buildUsageRows(events, emailByName);
  const rowsToAppend = preparedRows.filter((row) => !sheetState.existingKeys.has(rowKey(row)));

  if (rowsToAppend.length > 0) {
    const startRow = sheetState.nextEmptyRow;
    const endRow = startRow + rowsToAppend.length - 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_TAB_NAME}!A${startRow}:G${endRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: rowsToAppend,
      },
    });
  }

  return {
    spreadsheetId: SPREADSHEET_ID,
    tabName: SHEET_TAB_NAME,
    weekStart: window.startDate,
    weekEnd: window.endDate,
    totalWidgetEvents: events.length,
    preparedRows: preparedRows.length,
    appendedRows: rowsToAppend.length,
    skippedExistingRows: preparedRows.length - rowsToAppend.length,
    unmappedUsers: Array.from(new Set(events
      .map((event) => String(event.user_name ?? "").trim())
      .filter((name) => name && !emailByName.get(name)))),
  };
}

export function getAppUsageSheetConfig() {
  return {
    spreadsheetId: SPREADSHEET_ID,
    tabName: SHEET_TAB_NAME,
    schedule: "Every Friday · 5:00 AM PT",
    source: "widget_open events from app_events",
    exactColumns: [
      "member_email",
      "entry_date_yyyy-mm-dd",
      "source_mine_department_company",
      "work_item_name",
      "work_item_type_app_or_agent",
      "hours_saved",
      "notes",
    ],
  };
}
