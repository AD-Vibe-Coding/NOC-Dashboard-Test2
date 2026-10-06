import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Menu,
  Modal,
  Progress,

  ScrollArea,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowsRight,
  IconBook,
  IconBrandSlack,
  IconCalendar,
  IconChecklist,
  IconClipboardText,
  IconDotsVertical,
  IconEdit,
  IconExternalLink,
  IconFolders,
  IconLayoutList,
  IconMailSpark,
  IconNotes,
  IconPlus,
  IconSearch,
  IconSend,
  IconSparkles,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { LOCKED_TEAM_NAMES, PERSON_TEAM_NAMES, resolveTeamMember } from "../PerformanceTracker/team";
import { useIdentity } from "../../lib/identity";
import { useCompletion } from "../../lib/devs-ai/use-completion";
import { getDefaultAgentId } from "../../lib/devs-ai/agents";
import { postSlackMessage } from "../../lib/slack";
import { db } from "../../db";
import { defaultRoleFor } from "../../lib/roles";

export { MeetingNotesTile } from "./Tile";

type OneOnOneNote = Awaited<ReturnType<typeof db.one_on_one_notes.list>>[number];
type NotebookSectionPreference = Awaited<ReturnType<typeof db.notebook_section_preferences.list>>[number];
type PersonalActionItem = Awaited<ReturnType<typeof db.personal_action_items.list>>[number];

type StructuredSummary = {
  title: string;
  summary: string;
  discussionPoints: string[];
  managerActionItems: string[];
  employeeActionItems: string[];
};

type GmailLabelRecord = {
  id: string;
  name: string;
  type?: string;
};

type GmailNoteMessage = {
  id: string;
  threadId: string | null;
  subject: string;
  from: string | null;
  date: string | null;
  snippet: string;
  body: string;
  imported: boolean;
  internalDate: string | null;
  labelQuery: string;
  labelIds?: string[];
  labelNames?: string[];
};

type NotebookMode = "individual" | "management" | "other";
type WorkspaceView = "team_members" | "my_notebook";

type GmailFolderMapping = {
  notebookGroup: NotebookMode;
  sectionName: string;
  employeeName: string;
  titleHint?: string;
};

type GmailSyncStats = {
  start: string;
  end: string;
  fetched: number;
  approvedFolderMatches: number;
  pending: number;
  extractedNotes: number;
  aiStructured: number;
  fallbackStructured: number;
  createdPages: number;
  skippedExisting: number;
  skippedUnclassified: number;
  skippedNoExtractedNotes: number;
  skippedNoStructuredContent: number;
  statusMessage?: string;
};

type AnnualSummary = {
  summary: string;
  achievements: string[];
  recognition: string[];
  feedback: string[];
  improvements: string[];
};

type NormalizedNote = OneOnOneNote & {
  notebook_group: NotebookMode;
  section_name: string;
  parent_note_id: number | null;
  is_archived: boolean;
  is_favorite: boolean;
  updated_at: string | null;
  sort_order: number;
};

type SectionRecord = {
  key: string;
  label: string;
  notebook_group: NotebookMode;
  notes: NormalizedNote[];
  favorite: boolean;
};

type SectionTreeNode = {
  key: string;
  label: string;
  fullLabel: string;
  notebook_group: NotebookMode;
  notes: NormalizedNote[];
  favorite: boolean;
  children: SectionTreeNode[];
};

type DuplicateTaskReview = {
  summary: string;
  groups: Array<{
    canonicalTitle: string;
    reason: string;
    taskIds: number[];
  }>;
};

type MeetingNotesCache = {
  ownerName: string | null;
  notes: OneOnOneNote[];
  preferences: NotebookSectionPreference[];
  tasks: PersonalActionItem[];
};

let meetingNotesCache: MeetingNotesCache = {
  ownerName: null,
  notes: [],
  preferences: [],
  tasks: [],
};

const MY_DAY_TAG = "[My Day]";

const SOURCE_OPTIONS = [
  { value: "gmail_gemini", label: "Gemini notes from Gmail" },
  { value: "pasted", label: "Paste meeting notes" },
  { value: "manual", label: "Manual summary" },
];

const NOTEBOOK_OPTIONS = [
  { value: "individual", label: "Individual 1:1 notebook" },
  { value: "management", label: "Management meeting notebook" },
  { value: "other", label: "Other notebook" },
];

const MEMBER_OPTIONS = PERSON_TEAM_NAMES.map(n => ({ value: n, label: n }));

const TASK_STATUS_OPTIONS = [
  { value: "open", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
  { value: "duplicate", label: "Duplicate" },
];

const WEEK_FROM_NOW = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
})();

const TASK_PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const DEFAULT_MANAGEMENT_SECTIONS = [
  "Leadership sync",
  "Manager standup",
  "Operations review",
  "Hiring and staffing",
  "Coaching themes",
  "NOC Team Meetings",
];

const MANAGEMENT_PREFIX = "Management · ";
const OTHER_PREFIX = "Other · ";
const DEFAULT_OTHER_SECTION = "Others";
const SECTION_PATH_SEPARATOR = " / ";
const TEAM_MEMBERS_ROOT = "Team Members";
const MY_NOTEBOOK_ROOT = "My Notebook";
const GMAIL_GEMINI_ROOT = "Gemini Notes";
const GMAIL_TEAM_ONE_ON_ONE_ROOT = "Team One on One Notes";
const APPROVED_TEAM_MEMBER_NAMES = [
  "Karthik Radhakrishnan",
  "Pranav Dandibhotla",
  "Sriram Parisa",
  "Lokesh Naik Banavath",
  "Kenya Gentry",
  "Mohammed Ashraf",
  "Hamza Rahmani",
  "Akash Hanvate",
  "Otukho Olembo",
  "Mohammed Zubairuddin",
  "Karthik Damagalla",
  "Abhishek Benarji",
  "Akram Ahmed",
  "Mahalakshmi Samiti",
] as const;
const ALLOWED_TEAM_MEMBER_GEMINI_LABELS = new Set(APPROVED_TEAM_MEMBER_NAMES.map(normalizeLabelValue));
const APPROVED_MY_NOTEBOOK_NAMES = [
  "C3 & NOC Monthly Sync",
  "Monthly Review - NOC",
  "NOC & MOM Monthly Sync",
  "NOC Management Meetings",
  "Team Meetings",
  "Matt - One on One",
] as const;
const ALLOWED_MY_NOTEBOOK_GEMINI_LABELS = new Set(APPROVED_MY_NOTEBOOK_NAMES.map(normalizeLabelValue));
const BLOCKED_GEMINI_FOLDER_PREFIXES = [
  normalizeLabelValue("Not Important"),
  normalizeLabelValue("Inbox / RCO Order Requests"),
];

/** Case/space-insensitive name comparison — handles trimming and casing variants */
function samePerson(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function safeJsonArray(text: string | null | undefined): string[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseJsonSummary(input: string): StructuredSummary | null {
  try {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    if (start < 0 || end < 0 || end <= start) return null;
    const parsed = JSON.parse(input.slice(start, end + 1)) as Partial<StructuredSummary>;
    return {
      title: String(parsed.title ?? "Meeting summary").trim() || "Meeting summary",
      summary: String(parsed.summary ?? "").trim(),
      discussionPoints: Array.isArray(parsed.discussionPoints) ? parsed.discussionPoints.map(String).filter(Boolean) : [],
      managerActionItems: Array.isArray(parsed.managerActionItems) ? parsed.managerActionItems.map(String).filter(Boolean) : [],
      employeeActionItems: Array.isArray(parsed.employeeActionItems) ? parsed.employeeActionItems.map(String).filter(Boolean) : [],
    };
  } catch {
    return null;
  }
}

function hasStructuredSummaryContent(parsed: StructuredSummary | null) {
  if (!parsed) return false;
  return Boolean(
    parsed.summary.trim()
    || parsed.discussionPoints.length > 0
    || parsed.managerActionItems.length > 0
    || parsed.employeeActionItems.length > 0,
  );
}

function parseGeminiSectionsToStructuredSummary(noteText: string, fallbackTitle: string): StructuredSummary | null {
  const lines = String(noteText ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  let currentSection: "summary" | "discussion" | "actions" | null = null;
  const summaryLines: string[] = [];
  const discussionPoints: string[] = [];
  const actionItems: string[] = [];

  const cleanBullet = (value: string) => value.replace(/^[-*•\d.)\s]+/, "").trim();
  const normalizeHeading = (value: string) => normalizeLabelValue(value).replace(/:$/, "").trim();
  const headingType = (value: string): "summary" | "discussion" | "actions" | null => {
    const normalized = normalizeHeading(value);
    if (
      normalized === "summary"
      || normalized === "meeting summary"
      || normalized === "overview"
      || normalized === "recap"
    ) return "summary";
    if (
      normalized === "discussion points"
      || normalized === "key discussion points"
      || normalized === "discussion"
      || normalized === "key takeaways"
      || normalized === "highlights"
      || normalized === "notes"
      || normalized === "quick notes"
    ) return "discussion";
    if (
      normalized === "plan of action"
      || normalized === "action items"
      || normalized === "next steps"
      || normalized === "follow ups"
      || normalized === "follow-up actions"
      || normalized === "follow up actions"
      || normalized === "follow ups and owners"
    ) return "actions";
    return null;
  };

  const looksLikeTopicHeading = (value: string) => {
    const cleaned = cleanBullet(value).replace(/:$/, "").trim();
    if (!cleaned) return false;
    if (cleaned.length > 90) return false;
    if (/[.!?]$/.test(cleaned)) return false;
    const words = cleaned.split(/\s+/).filter(Boolean);
    return words.length >= 2 && words.length <= 10;
  };

  const looksLikeActionItem = (value: string) => {
    const normalized = normalizeLabelValue(value);
    return /\b(will|follow up|follow-up|to do|todo|action|owner|send|share|review|update|check|confirm|schedule|create|escalate)\b/.test(normalized);
  };

  for (const line of lines) {
    const inlineMatch = line.match(/^([^:]{2,60}):\s*(.+)$/);
    if (inlineMatch) {
      const [, heading, content] = inlineMatch;
      const matchedSection = headingType(heading);
      if (matchedSection) {
        currentSection = matchedSection;
        const cleaned = cleanBullet(content);
        if (cleaned) {
          if (matchedSection === "summary") summaryLines.push(cleaned);
          if (matchedSection === "discussion") discussionPoints.push(cleaned);
          if (matchedSection === "actions") actionItems.push(cleaned);
        }
        continue;
      }
    }

    const matchedSection = headingType(line);
    if (matchedSection) {
      currentSection = matchedSection;
      continue;
    }

    if (currentSection === "summary") {
      summaryLines.push(cleanBullet(line));
    } else if (currentSection === "discussion") {
      const cleaned = cleanBullet(line);
      if (cleaned) {
        if (looksLikeTopicHeading(cleaned)) {
          discussionPoints.push(cleaned);
        } else if (looksLikeActionItem(cleaned)) {
          actionItems.push(cleaned);
        } else {
          discussionPoints.push(cleaned);
        }
      }
    } else if (currentSection === "actions") {
      const cleaned = cleanBullet(line);
      if (cleaned) actionItems.push(cleaned);
    }
  }

  if (summaryLines.length === 0 && discussionPoints.length === 0 && actionItems.length === 0) {
    const cleanedLines = lines
      .map(cleanBullet)
      .filter((line) => line && !/^notes from\b/i.test(line));

    if (cleanedLines.length > 0) {
      const contentLines = cleanedLines.filter((line) => !looksLikeTopicHeading(line) || /\s/.test(line));
      const firstSentence = contentLines.slice(0, 2).join(" ").trim();
      if (firstSentence) summaryLines.push(firstSentence);

      cleanedLines.slice(summaryLines.length > 0 ? 2 : 0).forEach((line) => {
        if (looksLikeActionItem(line)) actionItems.push(line);
        else discussionPoints.push(line);
      });
    }
  }

  if (summaryLines.length === 0 && discussionPoints.length > 0) {
    summaryLines.push(discussionPoints.slice(0, 2).join(" "));
  }

  const summary = summaryLines.join(" ").trim();
  const title = String(fallbackTitle || "Meeting summary").trim() || "Meeting summary";

  const parsed: StructuredSummary = {
    title,
    summary,
    discussionPoints,
    managerActionItems: actionItems,
    employeeActionItems: [],
  };

  return hasStructuredSummaryContent(parsed) ? parsed : null;
}

function buildRawTextStructuredSummary(noteText: string, fallbackTitle: string): StructuredSummary | null {
  const lines = String(noteText ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  const discussionPoints = lines.slice(0, 12);
  const summary = lines.slice(0, Math.min(6, lines.length)).join("\n").trim();

  const parsed: StructuredSummary = {
    title: String(fallbackTitle || "Meeting summary").trim() || "Meeting summary",
    summary,
    discussionPoints,
    managerActionItems: [],
    employeeActionItems: [],
  };

  return hasStructuredSummaryContent(parsed) ? parsed : null;
}

function extractGeminiNoteText(message: GmailNoteMessage) {
  const raw = String(message.body || message.snippet || "").replace(/\r/g, "").trim();
  if (!raw) return "";

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const filteredLines = lines.filter((line) => {
    const lower = line.toLowerCase();
    return !(
      lower.startsWith("from:")
      || lower.startsWith("to:")
      || lower.startsWith("cc:")
      || lower.startsWith("bcc:")
      || lower.startsWith("subject:")
      || lower.startsWith("sent:")
      || lower.startsWith("date:")
      || lower.startsWith("gmail")
      || lower === "view summary"
      || lower === "open in gmail"
      || lower === "open meeting notes"
      || lower.startsWith("these notes have been sent")
      || lower.startsWith("the content was auto-generated")
      || /^notes from\s+[“\"].+[”\"]$/i.test(line)
    );
  });

  const sectionAnchors = [
    "summary",
    "meeting summary",
    "discussion points",
    "key discussion points",
    "discussion",
    "key takeaways",
    "highlights",
    "plan of action",
    "action items",
    "next steps",
    "follow ups",
    "follow-up actions",
    "follow up actions",
    "notes",
  ];

  const anchorIndex = filteredLines.findIndex((line) => sectionAnchors.some((anchor) => normalizeLabelValue(line).startsWith(anchor)));
  const extracted = anchorIndex >= 0 ? filteredLines.slice(anchorIndex).join("\n") : filteredLines.join("\n");

  return extracted
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseAnnualSummary(input: string): AnnualSummary | null {
  try {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    if (start < 0 || end < 0 || end <= start) return null;
    const parsed = JSON.parse(input.slice(start, end + 1)) as Partial<AnnualSummary>;
    return {
      summary: String(parsed.summary ?? "").trim(),
      achievements: Array.isArray(parsed.achievements) ? parsed.achievements.map(String).filter(Boolean) : [],
      recognition: Array.isArray(parsed.recognition) ? parsed.recognition.map(String).filter(Boolean) : [],
      feedback: Array.isArray(parsed.feedback) ? parsed.feedback.map(String).filter(Boolean) : [],
      improvements: Array.isArray(parsed.improvements) ? parsed.improvements.map(String).filter(Boolean) : [],
    };
  } catch {
    return null;
  }
}

const PACIFIC_TIME_ZONE = "America/Los_Angeles";

function parseCalendarDate(value?: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const rawValue = String(value).trim();
  const calendarMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (calendarMatch) {
    const [, year, month, day] = calendarMatch;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day), 12);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value?: string | Date | null) {
  if (!value) return "—";
  const rawValue = value instanceof Date ? value.toISOString() : value;
  const d = parseCalendarDate(value);
  return d
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: PACIFIC_TIME_ZONE })
    : String(rawValue);
}

function isManagementEmployeeValue(value: string | null | undefined) {
  return String(value ?? "").startsWith(MANAGEMENT_PREFIX);
}

function isOtherEmployeeValue(value: string | null | undefined) {
  return String(value ?? "").startsWith(OTHER_PREFIX);
}

function formatMeetingTitleDate(value?: string | null) {
  if (!value) return "";
  const d = parseCalendarDate(value);
  return d
    ? d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: PACIFIC_TIME_ZONE })
    : String(value);
}

function defaultMeetingTitle(mode: NotebookMode, meetingDate?: string | null) {
  if (mode === "management" || mode === "other") {
    const formattedDate = formatMeetingTitleDate(meetingDate);
    return formattedDate ? `Team Meeting - ${formattedDate}` : "Team Meeting";
  }

  if (meetingDate) {
    const formattedDate = formatMeetingTitleDate(meetingDate);
    return formattedDate ? `One on One Notes - ${formattedDate}` : `One on One Notes - ${meetingDate}`;
  }

  return "One on One Notes";
}

function deriveNotebookGroup(note: OneOnOneNote): NotebookMode {
  if (note.notebook_group === "management" || note.notebook_group === "individual" || note.notebook_group === "other") return note.notebook_group;
  if (isManagementEmployeeValue(note.employee_name)) return "management";
  if (isOtherEmployeeValue(note.employee_name)) return "other";
  return "individual";
}

function deriveSectionName(note: OneOnOneNote): string {
  if (note.section_name) return note.section_name;
  const group = deriveNotebookGroup(note);
  if (group === "management") {
    return String(note.employee_name ?? "").replace(MANAGEMENT_PREFIX, "") || DEFAULT_MANAGEMENT_SECTIONS[0];
  }
  if (group === "other") {
    return String(note.employee_name ?? "").replace(OTHER_PREFIX, "") || DEFAULT_OTHER_SECTION;
  }
  return String(note.employee_name ?? "");
}

function normalizeNote(note: OneOnOneNote): NormalizedNote {
  return {
    ...note,
    notebook_group: deriveNotebookGroup(note),
    section_name: deriveSectionName(note),
    parent_note_id: note.parent_note_id ?? null,
    is_archived: Boolean(note.is_archived || note.status === "archived"),
    is_favorite: Boolean(note.is_favorite),
    updated_at: note.updated_at ?? note.shared_at ?? null,
    sort_order: note.sort_order ?? 0,
  };
}

function noteMatchesSearch(note: NormalizedNote, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    note.title,
    note.section_name,
    note.manager_name,
    note.employee_name,
    note.summary_markdown,
    note.source_subject,
    note.source_excerpt,
    note.source_body,
    ...safeJsonArray(note.discussion_points_json),
    ...safeJsonArray(note.manager_action_items_json),
    ...safeJsonArray(note.employee_action_items_json),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return haystack.includes(q);
}

function splitSectionPath(label: string) {
  return String(label)
    .split(SECTION_PATH_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeLabelValue(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function splitGmailLabelPath(value: string) {
  return String(value ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function looksLikeOneOnOneLabel(value: string) {
  const normalized = normalizeLabelValue(value);
  return normalized.includes("1:1") || normalized.includes("one on one") || normalized.includes("one-on-one") || normalized.includes("bi weekly one on one");
}

function cleanOneOnOneFolderName(value: string) {
  return String(value ?? "")
    .replace(/\bbi[-\s]*weekly\s+one\s+on\s+one\b/gi, "")
    .replace(/\bone\s+on\s+one\b/gi, "")
    .replace(/\b1\s*:\s*1\b/gi, "")
    .replace(/\bmeeting\b/gi, "")
    .replace(/\bnotes?\b/gi, "")
    .replace(/\s*[-–—|:]\s*$/g, "")
    .replace(/^\s*[-–—|:]\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function resolveApprovedTeamMemberName(parts: string[]) {
  const candidates = parts
    .flatMap((part) => {
      const raw = String(part ?? "").trim();
      const cleaned = cleanOneOnOneFolderName(raw);
      return [raw, cleaned].filter(Boolean);
    })
    .map(normalizeLabelValue);

  for (const approvedName of APPROVED_TEAM_MEMBER_NAMES) {
    const normalizedApproved = normalizeLabelValue(approvedName);
    if (candidates.some((candidate) => candidate === normalizedApproved || candidate.includes(normalizedApproved) || normalizedApproved.includes(candidate))) {
      return approvedName;
    }
  }
  return null;
}

function resolveApprovedNotebookName(parts: string[]) {
  const candidates = parts
    .flatMap((part) => {
      const raw = String(part ?? "").trim();
      const cleaned = raw
        .replace(/\bmeeting\s*notes?\b/gi, "meeting")
        .replace(/\bnotes?\b/gi, "")
        .replace(/\bup\s*call\b/gi, "")
        .replace(/\band\b/gi, "&")
        .replace(/\s{2,}/g, " ")
        .trim();
      return [raw, cleaned].filter(Boolean);
    })
    .map(normalizeLabelValue);

  const hasWords = (candidate: string, words: string[]) => words.every((word) => candidate.includes(word));

  for (const candidate of candidates) {
    if (hasWords(candidate, ["c3", "noc", "monthly", "sync"])) {
      return "C3 & NOC Monthly Sync";
    }
    if (hasWords(candidate, ["noc", "mom", "monthly", "sync"])) {
      return "NOC & MOM Monthly Sync";
    }
    if (hasWords(candidate, ["monthly", "review", "noc"])) {
      return "Monthly Review - NOC";
    }
    if (hasWords(candidate, ["team", "meeting"])) {
      return "Team Meetings";
    }
    if (hasWords(candidate, ["noc", "management", "meeting"])) {
      return "NOC Management Meetings";
    }
  }

  for (const approvedName of APPROVED_MY_NOTEBOOK_NAMES) {
    const normalizedApproved = normalizeLabelValue(approvedName);
    if (candidates.some((candidate) => candidate === normalizedApproved || candidate.includes(normalizedApproved) || normalizedApproved.includes(candidate))) {
      return approvedName;
    }
  }
  return null;
}

function parseFolderNameFromGmailLabel(labelName: string): GmailFolderMapping | null {
  const path = splitGmailLabelPath(labelName);
  if (path.length === 0) return null;

  const geminiIndex = path.findIndex((part) => normalizeLabelValue(part) === normalizeLabelValue(GMAIL_GEMINI_ROOT));
  const relevantPath = geminiIndex >= 0 ? path.slice(geminiIndex + 1) : path;
  if (relevantPath.length === 0) return null;

  const [first, ...rest] = relevantPath;
  const normalizedFirst = normalizeLabelValue(first);

  const approvedNotebookName = resolveApprovedNotebookName(relevantPath);
   if (approvedNotebookName) {
    const titleHint = relevantPath[relevantPath.length - 1]?.trim() ?? approvedNotebookName;
    return {
      notebookGroup: "other" as const,
      sectionName: approvedNotebookName,
      employeeName: `${OTHER_PREFIX}${approvedNotebookName}`,
      titleHint,
    } satisfies GmailFolderMapping;
  }

  const teamMemberParts = normalizedFirst === normalizeLabelValue(GMAIL_TEAM_ONE_ON_ONE_ROOT)
    ? rest
    : relevantPath;
  const approvedMemberName = resolveApprovedTeamMemberName(teamMemberParts);
  if (approvedMemberName) {
    return {
      notebookGroup: "individual" as const,
      sectionName: approvedMemberName,
      employeeName: approvedMemberName,
      titleHint: teamMemberParts[teamMemberParts.length - 1] ?? first,
    } satisfies GmailFolderMapping;
  }

  const leafLabel = relevantPath.length > 0 ? relevantPath[relevantPath.length - 1]?.trim() ?? "" : "";
  if (!leafLabel) return null;

  return {
    notebookGroup: "other" as const,
    sectionName: leafLabel,
    employeeName: `${OTHER_PREFIX}${leafLabel}`,
    titleHint: leafLabel,
  } satisfies GmailFolderMapping;
}

function isBlockedGeminiFolderName(value: string) {
  const normalized = normalizeLabelValue(value);
  return BLOCKED_GEMINI_FOLDER_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} /`) || normalized.startsWith(`${prefix}/`));
}

function folderNameFromGmailLabel(labelName: string): GmailFolderMapping | null {
  const mapping = parseFolderNameFromGmailLabel(labelName);
  if (!mapping) return null;
  const labelToCheck = normalizeLabelValue(mapping.titleHint || mapping.sectionName);
  if (isBlockedGeminiFolderName(labelToCheck) || isBlockedGeminiFolderName(mapping.sectionName)) return null;
  if (mapping.notebookGroup === "individual") {
    return ALLOWED_TEAM_MEMBER_GEMINI_LABELS.has(normalizeLabelValue(mapping.sectionName)) ? mapping : null;
  }
  if (mapping.notebookGroup === "other") {
    return ALLOWED_MY_NOTEBOOK_GEMINI_LABELS.has(normalizeLabelValue(mapping.sectionName)) ? mapping : null;
  }
  return null;
}

function findTeamMemberFromLabels(labelNames: string[]) {
  const folderHit = labelNames
    .map(folderNameFromGmailLabel)
    .find((mapping) => mapping?.notebookGroup === "individual");
  return folderHit?.sectionName ?? undefined;
}

function deriveSelfNotebookBucket(labelNames: string[], _subject: string) {
  const mappedFolder = labelNames
    .map(folderNameFromGmailLabel)
    .find((mapping) => mapping?.notebookGroup === "other");
  return mappedFolder?.sectionName ?? null;
}

function noteSortValue(note: NormalizedNote) {
  return new Date(note.updated_at ?? note.meeting_date ?? note.created_at ?? 0).getTime();
}

function sortNotes(a: NormalizedNote, b: NormalizedNote) {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return noteSortValue(b) - noteSortValue(a);
}

function dedupeById<T extends { id: number }>(rows: T[]) {
  return Array.from(new Map(rows.map((row) => [row.id, row])).values());
}

function getNoteDisplayTitle(note: Pick<NormalizedNote, "notebook_group" | "source_type" | "meeting_date" | "title">) {
  if (note.notebook_group === "individual" && note.source_type === "gmail_gemini") {
    return defaultMeetingTitle("individual", note.meeting_date);
  }
  return note.title;
}

function getPersistedNoteTitle(note: Pick<OneOnOneNote, "notebook_group" | "source_type" | "meeting_date" | "title">) {
  if (note.notebook_group === "individual" && note.source_type === "gmail_gemini") {
    return defaultMeetingTitle("individual", note.meeting_date);
  }
  return String(note.title ?? "").trim();
}

function MarkdownBlock({ text }: { text: string }) {
  return <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{text}</Text>;
}

function DetailCard({ note, managerView }: { note: NormalizedNote; managerView: boolean }) {
  const discussion = safeJsonArray(note.discussion_points_json);
  const managerItems = safeJsonArray(note.manager_action_items_json);
  const employeeItems = safeJsonArray(note.employee_action_items_json);
  const management = note.notebook_group === "management";
  const plainNotebookPage = note.notebook_group === "other";

  if (plainNotebookPage) {
    const showTitle = note.title.trim() && note.title.trim().toLowerCase() !== "quick note";

    return (
      <Card withBorder radius="lg" p="xl">
        <Stack gap="sm">
          {showTitle && <Text fw={700} size="xl">{note.title}</Text>}
          {managerView && <Text size="sm" c="dimmed">{note.section_name}</Text>}
          <MarkdownBlock text={note.summary_markdown || note.source_body || ""} />
        </Stack>
      </Card>
    );
  }

  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Group gap="xs">
              <Text fw={700} size="lg">{getNoteDisplayTitle(note)}</Text>
              <Badge variant="light" color={management ? "blue" : "grape"}>{management ? "Management" : "1:1"}</Badge>
              {note.is_archived && <Badge variant="light" color="gray">Archived</Badge>}
            </Group>
            <Text size="sm" c="dimmed">
              {managerView
                ? `${management ? `Section: ${note.section_name}` : `Employee: ${note.section_name}`} · ${formatDate(note.meeting_date)}`
                : `Shared by ${note.manager_name} · ${formatDate(note.meeting_date)}`}
            </Text>
          </Stack>
          <Badge color={note.status === "shared" ? "green" : note.status === "archived" ? "gray" : "yellow"} variant="light">{note.status}</Badge>
        </Group>

        <MarkdownBlock text={note.summary_markdown} />

        {discussion.length > 0 && (
          <Stack gap={4}>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed">Discussion points</Text>
            {discussion.map((item, index) => <Text key={`${note.id}-discussion-${index}`} size="sm">• {item}</Text>)}
          </Stack>
        )}

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Card withBorder radius="md" p="sm">
            <Stack gap={4}>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">Manager action items</Text>
              {managerItems.length > 0 ? managerItems.map((item, index) => <Text key={`${note.id}-manager-${index}`} size="sm">• {item}</Text>) : <Text size="sm" c="dimmed">No manager action items.</Text>}
            </Stack>
          </Card>
          <Card withBorder radius="md" p="sm">
            <Stack gap={4}>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">{management ? "Team follow-ups" : "Employee action items"}</Text>
              {employeeItems.length > 0 ? employeeItems.map((item, index) => <Text key={`${note.id}-employee-${index}`} size="sm">• {item}</Text>) : <Text size="sm" c="dimmed">No action items.</Text>}
            </Stack>
          </Card>
        </SimpleGrid>

      </Stack>
    </Card>
  );
}

function DeleteConfirmModal({ section, affectedPageCount, saving, onCancel, onConfirm }: {
  section: SectionRecord;
  affectedPageCount: number;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (section: SectionRecord) => void;
}) {
  return (
    <Modal opened onClose={onCancel} title="Delete folder" centered size="sm" zIndex={10100}>
      <Stack gap="md">
        <Text size="sm">
          Are you sure you want to delete <strong>{section.label}</strong>?
        </Text>
        {affectedPageCount > 0 && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" radius="md">
            This will permanently delete <strong>{affectedPageCount} page{affectedPageCount === 1 ? "" : "s"}</strong> inside this folder. This cannot be undone.
          </Alert>
        )}
        {affectedPageCount === 0 && (
          <Text size="sm" c="dimmed">This folder has no pages. It will be removed from the sidebar.</Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>Cancel</Button>
          <Button
            color="red"
            leftSection={<IconTrash size={14} />}
            loading={saving}
            onClick={() => onConfirm(section)}
          >
            Delete folder
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── Helpers & memoized sub-components (defined outside MeetingNotesWidget
//     so they are never recreated on parent re-renders) ──────────────────────

function resolveTaskOwner(task: { title?: string | null; owner_name?: string | null; employee_name?: string | null; created_by?: string | null }): string {
  const match = (task.title ?? "").match(/^\[([^\]]+)\]/);
  if (match) return match[1].trim();
  return task.owner_name ?? task.employee_name ?? task.created_by ?? "";
}

type PAI = Awaited<ReturnType<typeof db.personal_action_items.list>>[number];

const TODAY = new Date().toISOString().slice(0, 10);

// Lightweight native select styles — renders ~100x faster than Mantine Select
const nativeSelectStyle: React.CSSProperties = {
  background: "var(--mantine-color-dark-6)",
  border: "1px solid var(--mantine-color-dark-4)",
  borderRadius: 4,
  color: "var(--mantine-color-text)",
  padding: "2px 6px",
  fontSize: 12,
  cursor: "pointer",
  outline: "none",
};

const TaskRow = memo(function TaskRow({
  task,
  isSelected,
  importance,
  hasNote,
  showOwnerCol = true,
  onUpdate,
  onDelete,
  onToggleSelect,
  onJumpToNote,
}: {
  task: PAI;
  isSelected: boolean;
  importance?: { importance: string; reason: string };
  hasNote: boolean;
  showOwnerCol?: boolean;
  onUpdate: (id: number, patch: Partial<PAI>) => void;
  onDelete: (id: number) => void;
  onToggleSelect: (id: number, checked: boolean) => void;
  onJumpToNote: (noteId: number) => void;
}) {
  const od = !!task.due_date && task.status !== "done" && task.due_date < TODAY;
  const stale = task.status !== "done" && !!task.created_at &&
    Math.floor((Date.now() - new Date(task.created_at).getTime()) / 86400000) >= 21;
  const resolvedOwner = resolveTaskOwner(task);
  const impColor = importance?.importance === "critical" ? "red" : importance?.importance === "important" ? "yellow" : "gray";

  // Inline title editing
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.title ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setEditValue(task.title ?? "");
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== task.title) onUpdate(task.id, { title: trimmed });
    setIsEditing(false);
  };
  const cancelEdit = () => {
    setEditValue(task.title ?? "");
    setIsEditing(false);
  };

  return (
    <Table.Tr style={od ? { background: "rgba(250,82,82,0.07)" } : importance?.importance === "critical" ? { background: "rgba(124,58,237,0.05)" } : undefined}>
      <Table.Td>
        <input type="checkbox" checked={isSelected} onChange={e => onToggleSelect(task.id, e.currentTarget.checked)} style={{ cursor: "pointer", accentColor: "var(--mantine-color-grape-5)" }} />
      </Table.Td>
      <Table.Td style={{ maxWidth: 320 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
          {od && <span title="Overdue" style={{ color: "var(--mantine-color-red-5)", fontSize: 13, lineHeight: 1.6 }}>⚠</span>}
          {stale && !od && <span style={{ fontSize: 10, background: "var(--mantine-color-orange-9)", color: "var(--mantine-color-orange-3)", borderRadius: 3, padding: "1px 4px" }}>stale</span>}
          {importance && <span title={importance.reason} style={{ fontSize: 11, background: `var(--mantine-color-${impColor}-9)`, color: `var(--mantine-color-${impColor}-3)`, borderRadius: 3, padding: "1px 4px", cursor: "help", flexShrink: 0 }}>{importance.importance === "critical" ? "🔴" : importance.importance === "important" ? "🟡" : "⚪"}</span>}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {isEditing ? (
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={e => setEditValue(e.currentTarget.value)}
                  onBlur={commitEdit}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitEdit(); } if (e.key === "Escape") cancelEdit(); }}
                  style={{ flex: 1, fontWeight: 600, fontSize: 13, background: "var(--mantine-color-dark-6)", border: "1px solid var(--mantine-color-grape-5)", borderRadius: 4, color: "var(--mantine-color-text)", padding: "2px 6px", outline: "none", minWidth: 0, width: "100%" }}
                />
              ) : (
                <>
                  <span
                    style={{ fontWeight: 600, fontSize: 13, textDecoration: (task.status === "done" || task.status === "duplicate") ? "line-through" : undefined, opacity: (task.status === "done" || task.status === "duplicate") ? 0.5 : 1, wordBreak: "break-word", cursor: "text" }}
                    onDoubleClick={startEdit}
                  >{task.title}</span>
                  <button onClick={startEdit} title="Edit title" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--mantine-color-dimmed)", opacity: 0.5, flexShrink: 0, lineHeight: 1 }}
                    onMouseOver={e => (e.currentTarget.style.opacity = "1")} onMouseOut={e => (e.currentTarget.style.opacity = "0.5")}>
                    <IconEdit size={11} />
                  </button>
                  {hasNote && task.note_id != null && (
                    <button onClick={() => onJumpToNote(task.note_id!)} title="Jump to source note" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--mantine-color-grape-4)", flexShrink: 0 }}>
                      <IconExternalLink size={11} />
                    </button>
                  )}
                </>
              )}
            </div>
            {task.details && <div style={{ fontSize: 11, color: "var(--mantine-color-dimmed)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>{task.details}</div>}
          </div>
        </div>
      </Table.Td>
      {showOwnerCol && (
        <Table.Td>
          <select value={resolvedOwner} onChange={e => onUpdate(task.id, { owner_name: e.currentTarget.value, employee_name: e.currentTarget.value })} style={{ ...nativeSelectStyle, width: 150 }}>
            {MEMBER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Table.Td>
      )}
      <Table.Td>
        <select value={task.priority ?? "medium"} onChange={e => onUpdate(task.id, { priority: e.currentTarget.value })} style={{ ...nativeSelectStyle, width: 100 }}>
          {TASK_PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Table.Td>
      <Table.Td>
        <select value={task.status} onChange={e => onUpdate(task.id, { status: e.currentTarget.value })} style={{ ...nativeSelectStyle, width: 115 }}>
          {TASK_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Table.Td>
      <Table.Td>
        <input type="date" value={task.due_date ?? ""} onChange={e => onUpdate(task.id, { due_date: e.currentTarget.value || null })} style={{ ...nativeSelectStyle, width: 130 }} />
      </Table.Td>
      <Table.Td>
        <button onClick={() => onDelete(task.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--mantine-color-red-5)", padding: 2, borderRadius: 4 }} title="Delete task">
          <IconTrash size={14} />
        </button>
      </Table.Td>
    </Table.Tr>
  );
});

export function MeetingNotesWidget() {
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";
  const [selectedAgentId] = useState<string>(getDefaultAgentId());
  const { complete, result: aiResult, isLoading: aiLoading, error: aiError } = useCompletion({ model: selectedAgentId });
  const { complete: completePattern } = useCompletion({ model: selectedAgentId });
  const { complete: completeWeekly } = useCompletion({ model: selectedAgentId });
  const { complete: completePrep } = useCompletion({ model: selectedAgentId });
  const { complete: completeImportance } = useCompletion({ model: selectedAgentId });
  const { complete: completeDuplicateReview } = useCompletion({ model: selectedAgentId });

  const hasWarmCache = meetingNotesCache.ownerName === (identity?.name ?? null) && (
    meetingNotesCache.notes.length > 0 ||
    meetingNotesCache.preferences.length > 0 ||
    meetingNotesCache.tasks.length > 0
  );

  const [loading, setLoading] = useState(!hasWarmCache);
  const [saving, setSaving] = useState(false);
  const [extractDebug, setExtractDebug] = useState<string | null>(null);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gmailSyncStats, setGmailSyncStats] = useState<GmailSyncStats | null>(null);

  const [rawNotes, setRawNotes] = useState<OneOnOneNote[]>([]);
  const [preferences, setPreferences] = useState<NotebookSectionPreference[]>([]);
  const [tasks, setTasks] = useState<PersonalActionItem[]>([]);
  const [gmailMessages, setGmailMessages] = useState<GmailNoteMessage[]>([]);
  const [gmailAvailableLabels, setGmailAvailableLabels] = useState<string[]>([]);
  const [gmailStartDate, setGmailStartDate] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    const currentYear = new Date().getFullYear();
    const backfillDone = typeof window !== "undefined" ? window.localStorage.getItem(`meeting-notes-gmail-backfill-done:${currentYear}`) : null;
    return backfillDone ? today : `${currentYear}-02-01`;
  });
  const [gmailEndDate, setGmailEndDate] = useState(new Date().toISOString().slice(0, 10));

  const [search, setSearch] = useState("");
  const [showArchived] = useState(false);
  const [deleteConfirmSection, setDeleteConfirmSection] = useState<SectionRecord | null>(null);
  const [renameAreaOpen, setRenameAreaOpen] = useState(false);
  const [renameAreaTarget, setRenameAreaTarget] = useState<string>("");
  const [renameAreaValue, setRenameAreaValue] = useState<string>("");
  const [activeSectionKey, setActiveSectionKey] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<number | null>(null);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("team_members");
  const setAccordionValues = (_updater: (prev: string[]) => string[]) => {};
  const [managerView, setManagerView] = useState<"notebook" | "actions">("notebook");
  const [allNotesModalOpen, setAllNotesModalOpen] = useState(false);
  const [noteGroupFilter, setNoteGroupFilter] = useState<string>("all");
  const [taskStatusFilter, setTaskStatusFilter] = useState<string>(() => localStorage.getItem("ac_filter_status") ?? "active");
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<string>(() => localStorage.getItem("ac_filter_priority") ?? "all");
  const [_taskSectionFilter] = useState<string>("all");
  const [dueThisWeek, setDueThisWeek] = useState(false);
  const [bulkAssignOwner, setBulkAssignOwner] = useState<string | null>(null);
  const [groupByPerson] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [actionSubView, setActionSubView] = useState<"tasks" | "scorecard" | "insights">("tasks");
  const [patternResult, setPatternResult] = useState<string>("");
  const [patternLoading, setPatternLoading] = useState(false);
  const [weeklyResult, setWeeklyResult] = useState<string>("");
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [prepResult, setPrepResult] = useState<string>("");
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepPerson, setPrepPerson] = useState<string | null>(null);
  const [digestSending, setDigestSending] = useState(false);

  // ── AI importance analysis state ─────────────────────────────────────────
  type ImportanceLevel = "critical" | "important" | "low";
  type TaskImportanceResult = {
    summary: string;
    classifications: Array<{ title: string; importance: ImportanceLevel; reason: string }>;
  };
  const [importanceAnalysis, setImportanceAnalysis] = useState<TaskImportanceResult | null>(null);
  const [showImportancePanel, setShowImportancePanel] = useState(false);
  const [duplicateReviewLoading, setDuplicateReviewLoading] = useState(false);
  const [duplicateReview, setDuplicateReview] = useState<DuplicateTaskReview | null>(null);
  const [duplicateReviewOpen, setDuplicateReviewOpen] = useState(false);
  const [annualSummaryCache, setAnnualSummaryCache] = useState<Record<string, AnnualSummary>>({});
  const [annualSummaryLoading, setAnnualSummaryLoading] = useState(false);
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [lastAutoSyncStamp, setLastAutoSyncStamp] = useState<string | null>(null);

  const [openComposer, setOpenComposer] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [parentNoteId, setParentNoteId] = useState<number | null>(null);
  const [draggedNoteId, setDraggedNoteId] = useState<number | null>(null);
  const [draggedSectionKey, setDraggedSectionKey] = useState<string | null>(null);
  const [moveDialogNoteId, setMoveDialogNoteId] = useState<number | null>(null);
  const [moveTargetSectionKey, setMoveTargetSectionKey] = useState<string | null>(null);
  const [createSectionOpen, setCreateSectionOpen] = useState(false);
  const [createSectionGroup, setCreateSectionGroup] = useState<NotebookMode>("individual");
  const [createSectionName, setCreateSectionName] = useState("");
  const [createSectionParent, setCreateSectionParent] = useState<string | null>(null);
  const [createAreaOpen, setCreateAreaOpen] = useState(false);
  const [createAreaName, setCreateAreaName] = useState("");
  const [manageSectionKey, setManageSectionKey] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    type: "section" | "area";
    x: number;
    y: number;
    sectionKey?: string;
    areaName?: string;
  } | null>(null);
  const [renameSectionOpen, setRenameSectionOpen] = useState(false);
  const [renameSectionKey, setRenameSectionKey] = useState<string | null>(null);
  const [renameSectionName, setRenameSectionName] = useState("");
  const [moveSectionOpen, setMoveSectionOpen] = useState(false);
  const [moveSectionKey, setMoveSectionKey] = useState<string | null>(null);
  const [moveSectionTargetParent, setMoveSectionTargetParent] = useState<string | null>(null);
  const [notebookMode, setNotebookMode] = useState<NotebookMode>("individual");
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [managementSection, setManagementSection] = useState(DEFAULT_MANAGEMENT_SECTIONS[0]);
  const [customSectionName, setCustomSectionName] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [sourceType, setSourceType] = useState<string | null>("gmail_gemini");
  const [title, setTitle] = useState("1:1 Meeting Summary");
  const [sourceNotes, setSourceNotes] = useState("");
  const [importedMessageId, setImportedMessageId] = useState<string | null>(null);
  const [importedMessageSubject, setImportedMessageSubject] = useState<string | null>(null);
  const [summaryMarkdown, setSummaryMarkdown] = useState("");
  const [discussionPoints, setDiscussionPoints] = useState("");
  const [managerActionItems, setManagerActionItems] = useState("");
  const [employeeActionItems, setEmployeeActionItems] = useState("");
  const composerBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const gmailRequestInFlightRef = useRef(false);
  const lastGmailLoadRef = useRef<{ key: string; at: number; messages: GmailNoteMessage[] } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDetails, setTaskDetails] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");

  function openCreateSectionModal(group: NotebookMode, parent: string | null = null) {
    setCreateSectionGroup(group);
    setCreateSectionParent(parent);
    setCreateSectionName("");
    setCreateSectionOpen(true);
  }

  function openSectionContextMenu(event: React.MouseEvent, section: SectionRecord) {
    event.preventDefault();
    event.stopPropagation();
    setActiveSectionKey(section.key);
    setContextMenu({ type: "section", x: event.clientX, y: event.clientY, sectionKey: section.key });
  }

  
  const notes = useMemo(() => rawNotes.map(normalizeNote), [rawNotes]);

  async function load() {
    if (!identity?.name) return;
    const usingWarmCache = meetingNotesCache.ownerName === identity.name && (
      meetingNotesCache.notes.length > 0 ||
      meetingNotesCache.preferences.length > 0 ||
      meetingNotesCache.tasks.length > 0
    );
    if (!usingWarmCache) setLoading(true);
    setError(null);
    try {
      const prefPromise = db.notebook_section_preferences.list({ filter: { owner_name: identity.name } }).catch(() => [] as NotebookSectionPreference[]);

      const notePromise = isManager
        ? db.one_on_one_notes.list({ orderBy: { column: "created_at", ascending: false } })
        : Promise.all([
            db.one_on_one_notes.list({ filter: { manager_name: identity.name }, orderBy: { column: "created_at", ascending: false } }).catch(() => [] as OneOnOneNote[]),
            db.one_on_one_notes.list({ filter: { employee_name: identity.name }, orderBy: { column: "created_at", ascending: false } }).catch(() => [] as OneOnOneNote[]),
          ]).then(([ownedRows, receivedRows]) => dedupeById([...ownedRows, ...receivedRows]));

      const taskPromise = isManager
        ? db.personal_action_items.list({ orderBy: { column: "created_at", ascending: false } })
        : Promise.all([
            db.personal_action_items.list({ filter: { owner_name: identity.name }, orderBy: { column: "created_at", ascending: false } }).catch(() => [] as PersonalActionItem[]),
            db.personal_action_items.list({ filter: { employee_name: identity.name }, orderBy: { column: "created_at", ascending: false } }).catch(() => [] as PersonalActionItem[]),
            db.personal_action_items.list({ filter: { created_by: identity.name }, orderBy: { column: "created_at", ascending: false } }).catch(() => [] as PersonalActionItem[]),
          ]).then(([ownerRows, employeeRows, createdRows]) => dedupeById([...ownerRows, ...employeeRows, ...createdRows]));

      const [noteRows, prefRows] = await Promise.all([notePromise, prefPromise]);
      const migratedNoteRows = noteRows.map((note) => {
        const migratedTitle = getPersistedNoteTitle(note);
        return migratedTitle && migratedTitle !== note.title
          ? { ...note, title: migratedTitle }
          : note;
      });
      const notesNeedingMigration = noteRows.filter((note) => {
        const migratedTitle = getPersistedNoteTitle(note);
        return migratedTitle && migratedTitle !== note.title;
      });

      setRawNotes(migratedNoteRows);
      setPreferences(prefRows);
      meetingNotesCache = {
        ownerName: identity.name,
        notes: migratedNoteRows,
        preferences: prefRows,
        tasks: meetingNotesCache.ownerName === identity.name ? meetingNotesCache.tasks : [],
      };
      setLoading(false);

      if (notesNeedingMigration.length > 0) {
        void Promise.allSettled(
          notesNeedingMigration.map((note) => db.one_on_one_notes.updateById(note.id, {
            title: getPersistedNoteTitle(note),
          })),
        );
      }

      const taskRows = await taskPromise;
      setTasks(taskRows);
      meetingNotesCache = {
        ownerName: identity.name,
        notes: migratedNoteRows,
        preferences: prefRows,
        tasks: taskRows,
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [identity?.name, isManager]);

  useEffect(() => {
    // Gmail sync is manual-only to avoid burning through Gmail API quota
    // on widget mount, tab switches, or incidental re-renders.
    return;
  }, [identity?.name, isManager, loading, lastAutoSyncStamp, rawNotes.length]);

  // Persist filter selections to localStorage
  useEffect(() => { localStorage.setItem("ac_filter_status", taskStatusFilter); }, [taskStatusFilter]);
  useEffect(() => { localStorage.setItem("ac_filter_priority", taskPriorityFilter); }, [taskPriorityFilter]);

  // One-time cleanup: remove tasks extracted from specific unwanted meetings
  useEffect(() => {
    const CLEANUP_KEY = "tasks_cleanup_v5_unwanted_meetings";
    if (localStorage.getItem(CLEANUP_KEY)) return;
    const BLOCKED = [
      "office hours",
      "lunch and learn",
      "ai lunch",
      "lunch & learn",
      "j2 efax portal",
      "wcp solutions",
      "marquez/ashraf one on one",
      "marquez/ashraf 1:1",
      "team performance & work from home",
      "team performance and work from home",
      "remote work policies & operational",
      "remote work policies and operational",
      "team meeting – remote work",
      "team meeting - remote work",
      "april 16, 2026",
      "marquez/lokesh one on one",
      "marquez/lokesh 1:1",
      "anirudh / giri",
      "anirudh/giri",
      "ai agents",
      "software development cases migration to jira",
      "cases migration to jira",
      "marquez/hamza one on one",
      "marquez/hamza 1:1",
      "viki migration",
      "divide and conquer",
      "susser bank",
      "matlock troubleshooting",
      "mobility cross training",
      "hyderabad office it equipment",
      "it equipment review",
    ];
    const run = async () => {
      try {
        const all = await db.personal_action_items.list();
        const toDelete = all.filter(t => {
          const haystack = [t.details, t.title, t.section_name].map(s => (s ?? "").toLowerCase()).join(" ");
          return BLOCKED.some(keyword => haystack.includes(keyword));
        });
        for (const t of toDelete) {
          await db.personal_action_items.deleteById(t.id);
        }
        localStorage.setItem(CLEANUP_KEY, "done");
        if (toDelete.length > 0) {
          setTasks(prev => prev.filter(t => !toDelete.some(d => d.id === t.id)));
        }
      } catch { /* ignore */ }
    };
    void run();
  }, []);

  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (event: PointerEvent | MouseEvent) => {
      const target = event.target;
      if (contextMenuRef.current && target instanceof Node && !contextMenuRef.current.contains(target)) {
        setContextMenu(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [contextMenu]);

  const managerOwnedNotes = useMemo(() => {
    if (!identity?.name) return [] as NormalizedNote[];
    return notes.filter((note) => note.manager_name === identity.name);
  }, [identity?.name, notes]);

  const receivedNotes = useMemo(() => {
    if (!identity?.name) return [] as NormalizedNote[];
    return notes.filter((note) => note.notebook_group === "individual" && samePerson(note.employee_name ?? "", identity.name) && note.status === "shared" && !note.is_archived);
  }, [identity?.name, notes]);

  const managerNotesVisible = useMemo(() => managerOwnedNotes.filter((note) => showArchived || !note.is_archived), [managerOwnedNotes, showArchived]);

  const filteredManagerNotes = useMemo(() => managerNotesVisible.filter((note) => noteMatchesSearch(note, search)), [managerNotesVisible, search]);

  const sectionRecords = useMemo(() => {
    const sectionMap = new Map<string, SectionRecord>();

    // Build a set of explicitly hidden/deleted section keys.
    // A tombstone row has section_key starting with "hidden:" and is inserted
    // by confirmDeleteSectionFolder so locked built-in sections stay gone.
    const hiddenKeys = new Set(
      preferences
        .filter((pref) => pref.owner_name === identity?.name && pref.section_key.startsWith("hidden:"))
        .map((pref) => pref.section_key.slice("hidden:".length))
        // Never hide locked employee folders — they should always be visible.
        .filter((key) => !key.startsWith("individual:")),
    );

    const ensureSection = (notebook_group: NotebookMode, label: string) => {
      const cleanLabel = String(label ?? "").trim();
      if (!cleanLabel) return;
      const key = `${notebook_group}:${cleanLabel}`;
      // Skip sections the user has explicitly deleted
      if (hiddenKeys.has(key)) return;
      if (!sectionMap.has(key)) {
        const pref = preferences.find((row) => row.section_key === key && row.owner_name === identity?.name);
        sectionMap.set(key, {
          key,
          label: cleanLabel,
          notebook_group,
          notes: [],
          favorite: Boolean(pref?.is_favorite),
        });
      }
    };

    preferences
      .filter((pref) => pref.owner_name === identity?.name && !pref.section_key.startsWith("hidden:") && !pref.section_key.startsWith("area:"))
      .forEach((pref) => {
        const prefGroup = pref.notebook_group as NotebookMode;
        const prefLabel = pref.section_label || pref.section_key.split(":").slice(1).join(":");
        ensureSection(prefGroup, prefLabel);
      });

    filteredManagerNotes.forEach((note) => {
      // Don't recreate sections the user deleted, even if notes still exist
      const key = `${note.notebook_group}:${note.section_name}`;
      if (hiddenKeys.has(key)) return;
      ensureSection(note.notebook_group, note.section_name);
      sectionMap.get(key)?.notes.push(note);
    });

    return Array.from(sectionMap.values())
      .map((section) => ({ ...section, notes: [...section.notes].sort(sortNotes) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredManagerNotes, preferences, identity?.name]);

  const favoriteSections = useMemo(() => sectionRecords.filter((section) => section.favorite), [sectionRecords]);
  const individualSections = useMemo(() => sectionRecords.filter((section) => section.notebook_group === "individual"), [sectionRecords]);
  const managementSections = useMemo(() => sectionRecords.filter((section) => section.notebook_group === "management"), [sectionRecords]);
  const otherSections = useMemo(() => sectionRecords.filter((section) => section.notebook_group === "other"), [sectionRecords]);
  const customAreaNames = useMemo(
    () => preferences
      .filter((pref) => pref.owner_name === identity?.name && pref.section_key.startsWith("area:"))
      .map((pref) => pref.section_label || pref.section_key.replace(/^area:/, ""))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    [preferences, identity?.name],
  );
  useEffect(() => {
    const firstKey = isManager
      ? (workspaceView === "team_members"
          ? (individualSections[0]?.key ?? favoriteSections[0]?.key ?? managementSections[0]?.key ?? otherSections[0]?.key ?? null)
          : (otherSections[0]?.key ?? managementSections[0]?.key ?? favoriteSections[0]?.key ?? individualSections[0]?.key ?? null))
      : (sectionRecords.find((s) => s.notebook_group === "other")?.key ?? null);
    if (!activeSectionKey) {
      setActiveSectionKey(firstKey);
      return;
    }
    const valid = sectionRecords.some((section) => section.key === activeSectionKey);
    if (!valid) setActiveSectionKey(firstKey);
  }, [isManager, workspaceView, activeSectionKey, favoriteSections, individualSections, managementSections, otherSections, sectionRecords]);

  const activeSection = useMemo(() => sectionRecords.find((section) => section.key === activeSectionKey) ?? null, [sectionRecords, activeSectionKey]);
  const gmailMessagesByMemberLabel = useMemo(() => {
    const groups = new Map<string, { label: string; sectionName: string; messages: GmailNoteMessage[] }>();

    for (const rawLabel of gmailAvailableLabels) {
      const mapping = folderNameFromGmailLabel(rawLabel);
      if (!mapping || mapping.notebookGroup !== "individual") continue;
      groups.set(mapping.sectionName, {
        label: rawLabel,
        sectionName: mapping.sectionName,
        messages: [],
      });
    }

    for (const message of gmailMessages) {
      const matchedLabel = (message.labelNames ?? [])
        .map((label) => ({ rawLabel: label, mapping: folderNameFromGmailLabel(label) }))
        .find((entry) => entry.mapping?.notebookGroup === "individual");

      if (!matchedLabel?.mapping) continue;
      const key = matchedLabel.mapping.sectionName;
      if (!groups.has(key)) {
        groups.set(key, {
          label: matchedLabel.rawLabel,
          sectionName: matchedLabel.mapping.sectionName,
          messages: [],
        });
      }
      groups.get(key)?.messages.push(message);
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        messages: [...group.messages].sort((a, b) => {
          const aTime = a.internalDate ? new Date(a.internalDate).getTime() : 0;
          const bTime = b.internalDate ? new Date(b.internalDate).getTime() : 0;
          return bTime - aTime;
        }),
      }))
      .sort((a, b) => a.sectionName.localeCompare(b.sectionName));
  }, [gmailAvailableLabels, gmailMessages]);
  const managedSection = useMemo(() => sectionRecords.find((section) => section.key === manageSectionKey) ?? null, [sectionRecords, manageSectionKey]);
  const renamingSection = useMemo(() => sectionRecords.find((section) => section.key === renameSectionKey) ?? null, [sectionRecords, renameSectionKey]);
  const movingSection = useMemo(() => sectionRecords.find((section) => section.key === moveSectionKey) ?? null, [sectionRecords, moveSectionKey]);
  const contextMenuSection = useMemo(() => sectionRecords.find((section) => section.key === contextMenu?.sectionKey) ?? null, [sectionRecords, contextMenu]);
  const pageList = useMemo(() => activeSection?.notes ?? [], [activeSection]);

  useEffect(() => {
    const firstPageId = pageList[0]?.id ?? null;
    if (!selectedPageId) {
      setSelectedPageId(firstPageId);
      return;
    }
    if (selectedPageId && !pageList.some((note) => note.id === selectedPageId)) {
      setSelectedPageId(firstPageId);
    }
  }, [pageList, selectedPageId]);

  const selectedNote = useMemo(() => pageList.find((note) => note.id === selectedPageId) ?? null, [pageList, selectedPageId]);

  const visiblePageList = useMemo(() => [...pageList].sort(sortNotes).slice(0, 250), [pageList]);
  const activeTeamMember = useMemo(() => {
    if (workspaceView !== "team_members") return null;
    if (!activeSection || activeSection.notebook_group !== "individual") return null;
    return activeSection.label;
  }, [workspaceView, activeSection]);
  const memberNotes = useMemo(() => activeTeamMember
    ? managerOwnedNotes.filter((note) => note.notebook_group === "individual" && note.section_name === activeTeamMember).sort(sortNotes)
    : [], [activeTeamMember, managerOwnedNotes]);
  const memberTasks = useMemo(() => activeTeamMember
    ? tasks.filter((task) => samePerson(storedOwner(task), activeTeamMember) || samePerson(task.section_name ?? "", activeTeamMember)).sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
    : [], [activeTeamMember, tasks]);
  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    memberNotes.forEach((note) => {
      const raw = note.meeting_date ?? note.created_at;
      const d = new Date(raw ?? 0);
      if (!Number.isNaN(d.getTime())) years.add(d.getFullYear());
    });
    if (years.size === 0) years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a).map((year) => ({ value: String(year), label: String(year) }));
  }, [memberNotes]);
  const memberNotesForYear = useMemo(() => memberNotes.filter((note) => {
    const raw = note.meeting_date ?? note.created_at;
    const d = new Date(raw ?? 0);
    return !Number.isNaN(d.getTime()) && String(d.getFullYear()) === selectedYear;
  }), [memberNotes, selectedYear]);
  const annualSummaryKey = activeTeamMember ? `${activeTeamMember}:${selectedYear}` : null;
  const annualSummary = annualSummaryKey ? annualSummaryCache[annualSummaryKey] ?? null : null;

  useEffect(() => {
    if (!yearOptions.some((option) => option.value === selectedYear)) {
      setSelectedYear(yearOptions[0]?.value ?? String(new Date().getFullYear()));
    }
  }, [yearOptions, selectedYear]);

  useEffect(() => {
    if (!activeTeamMember || memberNotesForYear.length === 0 || !annualSummaryKey || annualSummaryCache[annualSummaryKey]) return;

    let cancelled = false;
    (async () => {
      setAnnualSummaryLoading(true);
      try {
        const compiledNotes = memberNotesForYear.map((note) => {
          const discussion = safeJsonArray(note.discussion_points_json).join("; ");
          const managerItems = safeJsonArray(note.manager_action_items_json).join("; ");
          const employeeItems = safeJsonArray(note.employee_action_items_json).join("; ");
          return `[${note.meeting_date ?? formatDate(note.created_at)}] ${note.title}\nSummary: ${note.summary_markdown}\nDiscussion: ${discussion}\nManager actions: ${managerItems}\nEmployee actions: ${employeeItems}`;
        }).join("\n\n");

        const prompt = `You are preparing an annual performance summary for ${activeTeamMember} based on 1:1 summaries.
Return ONLY valid JSON in this exact shape:
{"summary":"...","achievements":["..."],"recognition":["..."],"feedback":["..."],"improvements":["..."]}

Rules:
- achievements: concrete wins, successful outcomes, impact, ownership.
- recognition: appreciations, praise, positive feedback, standout contributions.
- feedback: coaching themes, concerns, or performance feedback mentioned in notes.
- improvements: growth opportunities, recurring blockers, skills/processes to improve.
- Be concise and evidence-based. Do not invent facts.

Notes for ${selectedYear}:
${compiledNotes}`;
        const raw = await complete(prompt);
        const parsed = parseAnnualSummary(raw);
        if (!cancelled && parsed) {
          setAnnualSummaryCache((prev) => ({ ...prev, [annualSummaryKey]: parsed }));
        }
      } finally {
        if (!cancelled) setAnnualSummaryLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTeamMember, memberNotesForYear, annualSummaryKey, annualSummaryCache, complete, selectedYear]);

  const moveDialogNote = useMemo(() => managerOwnedNotes.find((note) => note.id === moveDialogNoteId) ?? null, [managerOwnedNotes, moveDialogNoteId]);
  const allSectionOptions = useMemo(() => sectionRecords.map((section) => ({ value: section.key, label: `${section.notebook_group === "management" ? "Management" : section.notebook_group === "other" ? "Others" : "Individual"} · ${section.label}` })), [sectionRecords]);
  const moveSectionParentOptions = useMemo(() => {
    if (!movingSection) return [] as { value: string; label: string }[];
    return sectionRecords
      .filter((section) => section.notebook_group === movingSection.notebook_group)
      .filter((section) => section.key !== movingSection.key)
      .filter((section) => !section.label.startsWith(`${movingSection.label}${SECTION_PATH_SEPARATOR}`))
      .map((section) => ({ value: section.label, label: section.label }));
  }, [movingSection, sectionRecords]);

  // Tasks assigned TO me by a manager (extracted from their meeting notes)
  // Uses samePerson() for fuzzy name matching — handles case/spacing variants
  // e.g. "Hamza Rahmani" vs "hamza rahmani", trimmed section names, etc.
  // A task is "assigned to me" if owner/employee matches me AND it has a note_id
  // (i.e. it was extracted from a meeting note, not self-created)
  const tasksAssignedToMe = useMemo(() => {
    if (!identity?.name) return [] as PersonalActionItem[];
    return tasks.filter((task) =>
      (samePerson(task.owner_name ?? "", identity.name) || samePerson(task.employee_name ?? "", identity.name)) &&
      !!task.note_id,
    );
  }, [identity?.name, tasks]);

  // My own tasks = assigned to me but WITHOUT a note_id (self-created)
  const myOwnTasks = useMemo(() => {
    if (!identity?.name) return [] as PersonalActionItem[];
    return tasks.filter((task) =>
      (samePerson(task.owner_name ?? "", identity.name) || samePerson(task.employee_name ?? "", identity.name)) &&
      !task.note_id,
    );
  }, [identity?.name, tasks]);



  // Manager's own tasks = tasks where the OWNER is the manager (not just created_by).
  // This excludes tasks extracted for employees (e.g. Hamza's items assigned to Hamza).
  const managerTaskRows = useMemo(() => tasks.filter((task) =>
    samePerson(task.owner_name ?? "", identity?.name ?? "") ||
    samePerson(task.employee_name ?? "", identity?.name ?? ""),
  ), [tasks, identity?.name]);

  const notebookOpenActionCount = useMemo(() => {
    const managerOwnedNoteIds = new Set(managerOwnedNotes.map((note) => note.id));
    return tasks.filter((task) => task.status !== "done" && task.note_id != null && managerOwnedNoteIds.has(task.note_id)).length;
  }, [managerOwnedNotes, tasks]);

  // Use the explicitly stored owner field for the My/Team split.
  // resolveTaskOwner() uses the title prefix heuristic which is a legacy
  // extraction artefact — it doesn't reflect what the user explicitly set
  // via the Owner dropdown. Trust the stored owner_name / employee_name first.
  function storedOwner(task: PersonalActionItem): string {
    // If the title has a [Name] bracket prefix AND that name is a real roster
    // member, treat that as the authoritative owner. This correctly handles
    // tasks like "[Karthik Radhakrishnan] List Data Sources..." which were
    // extracted with owner_name=manager but the bracket encodes the real assignee.
    const match = (task.title ?? "").match(/^\[([^\]]+)\]/);
    if (match) {
      const prefixName = match[1].trim();
      const resolved = resolveTeamMember(prefixName) ?? (LOCKED_TEAM_NAMES.includes(prefixName) ? prefixName : null);
      if (resolved) return resolved;
    }
    return task.owner_name ?? task.employee_name ?? task.created_by ?? "";
  }

  // Manager's OWN tasks: stored owner is the manager
  const myManagerTasksClean = useMemo(() => {
    if (!identity?.name) return [] as PersonalActionItem[];
    return managerTaskRows.filter((task) => samePerson(storedOwner(task), identity.name));
  }, [managerTaskRows, identity?.name]);

  // Team tasks: stored owner is someone OTHER than the manager
  const allTeamTasks = useMemo(() => {
    if (!identity?.name) return [] as PersonalActionItem[];
    return managerTaskRows.filter((task) => storedOwner(task) !== identity.name);
  }, [managerTaskRows, identity?.name]);
  const importanceMap = useMemo(() => {
    if (!importanceAnalysis) return new Map<string, { importance: "critical" | "important" | "low"; reason: string }>();
    return new Map(importanceAnalysis.classifications.map(c => [c.title.toLowerCase().trim(), { importance: c.importance as "critical" | "important" | "low", reason: c.reason }]));
  }, [importanceAnalysis]);
  const allNotesRows = useMemo(() => [...managerOwnedNotes].sort(sortNotes), [managerOwnedNotes]);
  const filteredAllNotes = useMemo(() => allNotesRows.filter((note) => noteMatchesSearch(note, search) && (noteGroupFilter === "all" || note.notebook_group === noteGroupFilter)), [allNotesRows, search, noteGroupFilter]);




  function resetComposer(mode: NotebookMode = isManager ? "individual" : "other") {
    const effectiveMode = isManager ? mode : "other";
    setEditingNoteId(null);
    setParentNoteId(null);
    setNotebookMode(effectiveMode);
    setSelectedEmployee(effectiveMode === "individual" ? PERSON_TEAM_NAMES[0] ?? null : null);
    setManagementSection(DEFAULT_MANAGEMENT_SECTIONS[0]);
    setMeetingDate("");
    setSourceType("manual");
    setTitle(isManager ? defaultMeetingTitle(effectiveMode) : "Quick note");
    setSourceNotes("");
    setImportedMessageId(null);
    setImportedMessageSubject(null);
    setSummaryMarkdown("");
    setDiscussionPoints("");
    setManagerActionItems("");
    setEmployeeActionItems("");
    setGmailMessages([]);
    const today = new Date().toISOString().slice(0, 10);
    setGmailStartDate(today);
    setGmailEndDate(today);
  }

  function populateComposer(note: NormalizedNote, asSubpage = false) {
    setEditingNoteId(asSubpage ? null : note.id);
    setParentNoteId(asSubpage ? note.id : note.parent_note_id ?? null);
    setNotebookMode(note.notebook_group);
    setSelectedEmployee(note.notebook_group === "individual" ? note.section_name : null);
    setManagementSection(note.notebook_group === "management" ? note.section_name : DEFAULT_MANAGEMENT_SECTIONS[0]);
    setMeetingDate(note.meeting_date ?? "");
    setSourceType(note.source_type ?? "manual");
    setTitle(asSubpage ? `Subpage · ${note.title}` : note.title ?? "");
    setSourceNotes(note.source_body ?? "");
    setImportedMessageId(note.source_message_id ?? null);
    setImportedMessageSubject(note.source_subject ?? null);
    setSummaryMarkdown(note.summary_markdown ?? "");
    setDiscussionPoints(safeJsonArray(note.discussion_points_json).join("\n"));
    setManagerActionItems(safeJsonArray(note.manager_action_items_json).join("\n"));
    setEmployeeActionItems(safeJsonArray(note.employee_action_items_json).join("\n"));
  }

  async function syncSectionsFromGmailLabels(labels: GmailLabelRecord[], messages: GmailNoteMessage[] = []) {
    if (!identity?.name) return 0;

    const mappedSections: GmailFolderMapping[] = [];
    const legacyMappedSections: GmailFolderMapping[] = [];
    const discoveredLabelNames = [
      ...labels.map((label) => label.name),
      ...messages.flatMap((message) => Array.isArray(message.labelNames) ? message.labelNames : []),
    ];

    for (const labelName of discoveredLabelNames) {
      const allowedMapping = folderNameFromGmailLabel(labelName);
      if (allowedMapping?.sectionName) mappedSections.push(allowedMapping);

      const legacyMapping = parseFolderNameFromGmailLabel(labelName);
      if (legacyMapping?.sectionName) legacyMappedSections.push(legacyMapping);
    }

    const desiredSections = Array.from(new Map(
      mappedSections.map((mapping) => [`${mapping.notebookGroup}:${mapping.sectionName}`, mapping]),
    ).values());

    const desiredKeys = new Set(desiredSections.map((mapping) => `${mapping.notebookGroup}:${mapping.sectionName}`));
    const legacyKeys = new Set(legacyMappedSections.map((mapping) => `${mapping.notebookGroup}:${mapping.sectionName}`));

    const hiddenPrefs = preferences.filter(
      (pref) => pref.owner_name === identity.name && pref.section_key.startsWith("hidden:"),
    );
    const hiddenKeys = new Set(hiddenPrefs.map((pref) => pref.section_key.slice("hidden:".length)));

    const staleKeys = Array.from(legacyKeys).filter((sectionKey) => !desiredKeys.has(sectionKey));
    const blockedSectionKeys = preferences
      .filter((pref) => {
        if (pref.owner_name !== identity.name) return false;
        if (pref.section_key.startsWith("hidden:") || pref.section_key.startsWith("area:")) return false;
        return isBlockedGeminiFolderName(pref.section_label) || isBlockedGeminiFolderName(pref.section_key.replace(/^[^:]+:/, ""));
      })
      .map((pref) => pref.section_key);
    const nonApprovedNotebookKeys = preferences
      .filter((pref) => {
        if (pref.owner_name !== identity.name) return false;
        if (pref.section_key.startsWith("hidden:") || pref.section_key.startsWith("area:")) return false;
        if (pref.notebook_group !== "other") return false;
        const sectionName = pref.section_key.replace(/^[^:]+:/, "");
        return !ALLOWED_MY_NOTEBOOK_GEMINI_LABELS.has(normalizeLabelValue(sectionName));
      })
      .map((pref) => pref.section_key);
    const nonApprovedTeamMemberKeys = preferences
      .filter((pref) => {
        if (pref.owner_name !== identity.name) return false;
        if (pref.section_key.startsWith("hidden:") || pref.section_key.startsWith("area:")) return false;
        if (pref.notebook_group !== "individual") return false;
        const sectionName = pref.section_key.replace(/^[^:]+:/, "");
        return !ALLOWED_TEAM_MEMBER_GEMINI_LABELS.has(normalizeLabelValue(sectionName));
      })
      .map((pref) => pref.section_key);
    const keysToRemove = Array.from(new Set([...staleKeys, ...blockedSectionKeys, ...nonApprovedNotebookKeys, ...nonApprovedTeamMemberKeys]));
    const stalePrefs = preferences.filter(
      (pref) => pref.owner_name === identity.name && keysToRemove.includes(pref.section_key),
    );
    const missingHiddenKeys = keysToRemove.filter((sectionKey) => !hiddenKeys.has(sectionKey));

    if (stalePrefs.length > 0) {
      await Promise.all(stalePrefs.map((pref) => db.notebook_section_preferences.deleteById(pref.id)));
    }

    if (missingHiddenKeys.length > 0) {
      await Promise.all(missingHiddenKeys.map((sectionKey) => db.notebook_section_preferences.insert({
        owner_name: identity.name,
        notebook_group: "other",
        section_key: `hidden:${sectionKey}`,
        section_label: sectionKey,
        is_favorite: false,
      })));
    }

    const approvedHiddenPrefs = hiddenPrefs.filter((pref) => desiredKeys.has(pref.section_key.slice("hidden:".length)));
    if (approvedHiddenPrefs.length > 0) {
      await Promise.all(approvedHiddenPrefs.map((pref) => db.notebook_section_preferences.deleteById(pref.id)));
    }

    const missing = desiredSections.filter((mapping) => {
      const sectionKey = `${mapping.notebookGroup}:${mapping.sectionName}`;
      return !preferences.some((pref) => pref.owner_name === identity.name && pref.section_key === sectionKey);
    });

    if (missing.length > 0) {
      await Promise.all(missing.map((mapping) => db.notebook_section_preferences.insert({
        owner_name: identity.name,
        notebook_group: mapping.notebookGroup,
        section_key: `${mapping.notebookGroup}:${mapping.sectionName}`,
        section_label: mapping.sectionName,
        is_favorite: false,
      })));
    }

    return stalePrefs.length + missingHiddenKeys.length + approvedHiddenPrefs.length + missing.length;
  }

  async function loadGmailNotes(options?: { start?: string; end?: string; silent?: boolean }): Promise<GmailNoteMessage[]> {
    if (!isManager) return [] as GmailNoteMessage[];
    const start = options?.start ?? gmailStartDate;
    const end = options?.end ?? gmailEndDate;
    const silent = Boolean(options?.silent);
    if (!start || !end) {
      if (!silent) setError("Choose both a start date and end date for the Gmail import range.");
      return [] as GmailNoteMessage[];
    }
    if (start > end) {
      if (!silent) setError("The Gmail start date must be on or before the end date.");
      return [] as GmailNoteMessage[];
    }

    const requestKey = `${identity?.name ?? "manager"}:${start}:${end}`;
    const recentLoad = lastGmailLoadRef.current;
    if (gmailRequestInFlightRef.current) {
      return recentLoad?.key === requestKey ? recentLoad.messages : gmailMessages;
    }
    if (recentLoad?.key === requestKey && Date.now() - recentLoad.at < 60_000) {
      setGmailMessages(recentLoad.messages);
      setGmailSyncStats((prev) => prev ? {
        ...prev,
        start,
        end,
        fetched: recentLoad.messages.length,
        approvedFolderMatches: recentLoad.messages.filter((message) => classifyImportedMessage(message)).length,
        pending: recentLoad.messages.filter((message) => !message.imported).length,
        statusMessage: `Using recent Gmail results from the last minute for ${recentLoad.messages.length} emails.`,
      } : prev);
      return recentLoad.messages;
    }

    gmailRequestInFlightRef.current = true;
    setGmailLoading(true);
    if (!silent) setError(null);
    try {
      const params = new URLSearchParams({
        start,
        end,
        max: "100",
      });
      const response = await fetch(`/api/gmail/meeting-notes?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      const labels = Array.isArray(payload.labels) ? (payload.labels as GmailLabelRecord[]) : [];
      const messages = Array.isArray(payload.messages) ? (payload.messages as GmailNoteMessage[]) : [];
      const approvedLabels = Array.isArray(payload.approvedLabels) ? payload.approvedLabels.map(String).filter(Boolean) : [];
      const approvedFolderMatches = messages.filter((message) => classifyImportedMessage(message)).length;
      setGmailMessages(messages);
      setGmailAvailableLabels(approvedLabels);
      lastGmailLoadRef.current = {
        key: requestKey,
        at: Date.now(),
        messages,
      };
      setGmailSyncStats((prev) => ({
        start,
        end,
        fetched: messages.length,
        approvedFolderMatches,
        pending: messages.filter((message) => !message.imported).length,
        extractedNotes: prev?.extractedNotes ?? 0,
        aiStructured: prev?.aiStructured ?? 0,
        fallbackStructured: prev?.fallbackStructured ?? 0,
        createdPages: prev?.createdPages ?? 0,
        skippedExisting: prev?.skippedExisting ?? 0,
        skippedUnclassified: prev?.skippedUnclassified ?? 0,
        skippedNoExtractedNotes: prev?.skippedNoExtractedNotes ?? 0,
        skippedNoStructuredContent: prev?.skippedNoStructuredContent ?? 0,
        statusMessage: messages.length === 0
          ? `No Gmail notes were found between ${start} and ${end}.`
          : `Loaded ${messages.length} Gmail notes across approved labels. Running automatic import next.`,
      }));
      const createdCount = await syncSectionsFromGmailLabels(labels, messages);
      if (createdCount > 0) {
        await load();
      }
      if (!silent && messages.length === 0) {
        setError(`No Gemini notes were found in Gmail between ${start} and ${end}.`);
      }
      return messages;
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : String(err));
      return [];
    } finally {
      gmailRequestInFlightRef.current = false;
      setGmailLoading(false);
    }
  }

  async function runManualGmailSync() {
    if (!identity?.name || !isManager) return;
    const messages = await loadGmailNotes({ start: gmailStartDate, end: gmailEndDate, silent: false });
    if (messages.length === 0) return;
    const pending = messages.filter((message) => !message.imported);
    if (pending.length === 0) {
      setGmailSyncStats((prev) => prev ? {
        ...prev,
        pending: 0,
        statusMessage: "All matching Gmail notes in this date range were already imported into their mapped folders.",
      } : prev);
      setError("Approved Gmail labels were loaded, but every email in this date range has already been synced.");
      return;
    }
    await autoOrganizeLoadedNotes(pending);
    setLastAutoSyncStamp(`${identity.name}:${gmailStartDate}:${gmailEndDate}`);
  }

  async function generateFromNotes() {
    if (!sourceNotes.trim()) {
      setError("Import or paste the meeting notes first.");
      return;
    }
    setError(null);
    const managerName = identity?.name ?? "the manager";
    const employeeName = selectedEmployee ?? "the employee";
    const prompt = notebookMode === "management"
      ? `Turn these management meeting notes into JSON with this exact shape: {"title":"...","summary":"...","discussionPoints":["..."],"managerActionItems":["..."],"employeeActionItems":["..."]}. Focus on leadership decisions, risks, owners, and follow-ups. Notes:\n\n${sourceNotes}`
      : `Turn these 1:1 meeting notes into JSON with this exact shape: {"title":"...","summary":"...","discussionPoints":["..."],"managerActionItems":["..."],"employeeActionItems":["..."]}.

CRITICAL RULES for action item assignment:
- The MANAGER in this meeting is: ${managerName}
- The EMPLOYEE in this meeting is: ${employeeName}
- "managerActionItems" must contain ONLY action items owned by the MANAGER (${managerName}) — things the manager will do. This includes any action items assigned to other managers (${managerName}, Perry Cox, Anirudh Kukudala, Matt Marquez).
- "employeeActionItems" must contain ONLY action items owned by the EMPLOYEE (${employeeName}) — things the employee will do.
- If an action item mentions ${managerName} or another manager's name as the owner, it belongs in managerActionItems, NOT employeeActionItems.
- If an action item mentions ${employeeName} as the owner, it belongs in employeeActionItems.
- Do NOT mix up who owns what. The employee cannot own the manager's tasks.

Keep each bullet concise and factual. Notes:\n\n${sourceNotes}`;
    const raw = await complete(prompt);
    const parsed = parseJsonSummary(raw);
    if (!parsed) {
      setError("The notes were generated, but the structured format could not be parsed. You can still edit the fields manually.");
      return;
    }
    setTitle(parsed.title);
    setSummaryMarkdown(parsed.summary);
    setDiscussionPoints(parsed.discussionPoints.join("\n"));
    setManagerActionItems(parsed.managerActionItems.join("\n"));
    setEmployeeActionItems(parsed.employeeActionItems.join("\n"));
  }

  function classifyImportedMessage(message: GmailNoteMessage): { mode: NotebookMode; sectionName: string; title: string; employeeName: string } | null {
    const subject = String(message.subject ?? "").trim();
    const labelNames = Array.isArray(message.labelNames) ? message.labelNames : [];
    const mappedFolder = labelNames.map(folderNameFromGmailLabel).find(Boolean) ?? null;

    if (mappedFolder?.notebookGroup === "individual") {
      return {
        mode: "individual",
        sectionName: mappedFolder.sectionName,
        employeeName: mappedFolder.employeeName,
        title: subject || `1:1 Meeting Summary - ${mappedFolder.sectionName}`,
      };
    }

    if (mappedFolder?.notebookGroup === "other") {
      const cleanedSubject = subject || `${mappedFolder.sectionName} Notes`;
      return {
        mode: "other",
        sectionName: mappedFolder.sectionName,
        employeeName: mappedFolder.employeeName,
        title: cleanedSubject,
      };
    }

    const teamMember = findTeamMemberFromLabels(labelNames);
    const oneOnOneMatch = subject.match(/^Bi-Weekly One on One\s*-\s*(.+)$/i);
    const subjectMember = oneOnOneMatch?.[1]?.trim() || null;
    const resolvedMember = teamMember || subjectMember || null;
    const isOneOnOne = labelNames.some(looksLikeOneOnOneLabel) || Boolean(oneOnOneMatch) || Boolean(teamMember);

    if (isOneOnOne && resolvedMember) {
      return {
        mode: "individual",
        sectionName: resolvedMember,
        employeeName: resolvedMember,
        title: subject || `1:1 Meeting Summary - ${resolvedMember}`,
      };
    }

    const bucket = deriveSelfNotebookBucket(labelNames, subject);
    if (!bucket) return null;
    const cleanedSubject = subject || `${bucket} Notes`;
    return {
      mode: "other",
      sectionName: bucket,
      employeeName: `${OTHER_PREFIX}${bucket}`,
      title: cleanedSubject,
    };
  }

  function buildAutoOrganizePrompt(message: GmailNoteMessage, mode: NotebookMode) {
    const noteText = extractGeminiNoteText(message);
    const managerName = identity?.name ?? "the manager";
    const MANAGER_NAMES = ["Anirudh Kukudala", "Perry Cox", "Matt Marquez"];

    if (mode === "management") {
      return `Turn these management meeting notes into JSON with this exact shape: {"title":"...","summary":"...","discussionPoints":["..."],"managerActionItems":["..."],"employeeActionItems":["..."]}. Focus on leadership decisions, risks, owners, and follow-ups. Notes:\n\n${noteText}`;
    }
    if (mode === "other") {
      return `Turn these meeting notes into JSON with this exact shape: {"title":"...","summary":"...","discussionPoints":["..."],"managerActionItems":["..."],"employeeActionItems":["..."]}. These notes belong in the manager's own notebook (team meetings, other managers, or customer meetings). Focus on the key summary, recognitions, owners, decisions, blockers, and follow-ups. Notes:\n\n${noteText}`;
    }

    // For individual 1:1 notes — extract the employee name from the message subject
    const subject = String(message.subject ?? "");
    const oneOnOneMatch = subject.match(/^Bi-Weekly One on One\s*-\s*(.+)$/i);
    const employeeName = oneOnOneMatch ? oneOnOneMatch[1].trim() : "the employee";

    return `Turn these 1:1 meeting notes into JSON with this exact shape: {"title":"...","summary":"...","discussionPoints":["..."],"managerActionItems":["..."],"employeeActionItems":["..."]}.

CRITICAL RULES for action item assignment:
- The MANAGER in this meeting is: ${managerName} (also consider these as managers: ${MANAGER_NAMES.join(", ")})
- The EMPLOYEE in this meeting is: ${employeeName}
- "managerActionItems" must contain ONLY action items owned by the MANAGER — things ${managerName} or any other manager (${MANAGER_NAMES.join(", ")}) will do.
- "employeeActionItems" must contain ONLY action items owned by the EMPLOYEE (${employeeName}) — things ${employeeName} will do.
- If an action item mentions ${managerName} or another manager name as the owner/assignee, it MUST go in managerActionItems.
- If an action item mentions ${employeeName} as the owner/assignee, it MUST go in employeeActionItems.
- Do NOT put manager-owned tasks in employeeActionItems.

Keep each bullet concise and factual. Notes:\n\n${noteText}`;
  }

  async function upsertSyncedNoteActionItems(input: {
    noteId: number;
    noteTitle: string;
    sectionName: string;
    notebookGroup: NotebookMode;
    managerItems: string[];
    employeeItems: string[];
  }) {
    if (!identity?.name) return;

    const existing = await db.personal_action_items.list({
      filter: { note_id: input.noteId },
      orderBy: { column: "created_at", ascending: false },
    });

    const signatures = new Set(
      existing.map((row) => `${String(row.title ?? "").trim().toLowerCase()}::${String(row.owner_name ?? row.employee_name ?? "").trim().toLowerCase()}`),
    );

    const rows: any[] = [];
    const pushIfMissing = (title: string, owner: string) => {
      const t = title.trim();
      if (!t) return;
      const key = `${t.toLowerCase()}::${owner.trim().toLowerCase()}`;
      if (signatures.has(key)) return;
      signatures.add(key);
      rows.push({
        employee_name: owner,
        owner_name: owner,
        note_id: input.noteId,
        title: t,
        details: `Auto-created from synced meeting note: ${input.noteTitle}`,
        status: "open",
        priority: "medium",
        progress_percent: 0,
        due_date: null,
        section_name: input.sectionName,
        notebook_group: input.notebookGroup,
        created_by: identity.name,
      });
    };

    input.managerItems.forEach((item) => pushIfMissing(item, identity.name));
    const employeeOwner = input.notebookGroup === "individual" ? input.sectionName : identity.name;
    input.employeeItems.forEach((item) => pushIfMissing(item, employeeOwner));

    if (rows.length) await db.personal_action_items.insert(rows);
  }

  async function autoOrganizeLoadedNotes(messagesToProcess?: GmailNoteMessage[]) {
    if (!identity?.name) return;
    const pendingMessages = (messagesToProcess ?? gmailMessages).filter((message) => !message.imported);
    if (pendingMessages.length === 0) {
      setError("There are no new Gmail notes to auto-organize in this date range.");
      setGmailSyncStats((prev) => prev ? { ...prev, pending: 0, statusMessage: "No new Gmail notes needed importing." } : prev);
      return;
    }

    const stats = {
      extractedNotes: 0,
      aiStructured: 0,
      fallbackStructured: 0,
      createdPages: 0,
      skippedExisting: 0,
      skippedUnclassified: 0,
      skippedNoExtractedNotes: 0,
      skippedNoStructuredContent: 0,
    };

    const importedIds = new Set<string>();
    setSaving(true);
    setError(null);
    try {
      for (const message of pendingMessages) {
        const existingRows = await db.one_on_one_notes.list({ filter: { source_message_id: message.id } }).catch(() => [] as OneOnOneNote[]);
        if (existingRows.length > 0) {
          stats.skippedExisting += 1;
          importedIds.add(message.id);
          continue;
        }

        const classification = classifyImportedMessage(message);
        if (!classification) {
          stats.skippedUnclassified += 1;
          continue;
        }

        const extractedNoteText = extractGeminiNoteText(message);
        const rawFallbackText = String(message.body || message.snippet || "").replace(/\r/g, "").trim();
        const noteText = extractedNoteText || rawFallbackText;
        if (!noteText) {
          stats.skippedNoExtractedNotes += 1;
          continue;
        }
        stats.extractedNotes += 1;

        let parsed: StructuredSummary | null = null;
        try {
          const raw = await complete(buildAutoOrganizePrompt({ ...message, body: noteText }, classification.mode));
          parsed = parseJsonSummary(raw);
        } catch {
          parsed = null;
        }

        const fallbackTitle = String(message.subject || classification.title || "Meeting summary");
        const fallbackStructured = parseGeminiSectionsToStructuredSummary(noteText, fallbackTitle);
        const rawTextStructured = buildRawTextStructuredSummary(noteText, fallbackTitle);
        if (hasStructuredSummaryContent(parsed)) {
          stats.aiStructured += 1;
        } else if (fallbackStructured || rawTextStructured) {
          stats.fallbackStructured += 1;
        }
        const finalParsed = hasStructuredSummaryContent(parsed)
          ? parsed
          : fallbackStructured ?? rawTextStructured;
        if (!finalParsed) {
          stats.skippedNoStructuredContent += 1;
          continue;
        }

        const normalizedSummary = finalParsed.summary.trim();
        const importedMeetingDate = message.internalDate ? message.internalDate.slice(0, 10) : null;
        const normalizedTitle = classification.mode === "individual"
          ? defaultMeetingTitle("individual", importedMeetingDate)
          : finalParsed.title.trim()
            || String(message.subject || classification.title || "Meeting summary").trim()
            || "Meeting summary";
        const managerItems = finalParsed.managerActionItems;
        const employeeItems = finalParsed.employeeActionItems;
        const discussionPoints = finalParsed.discussionPoints;

        const employeeValue = classification.mode === "management"
          ? `${MANAGEMENT_PREFIX}${classification.sectionName}`
          : classification.mode === "other"
            ? `${OTHER_PREFIX}${classification.sectionName}`
            : classification.employeeName;

        const inserted = await db.one_on_one_notes.insert({
          manager_name: identity.name,
          employee_name: employeeValue,
          title: normalizedTitle,
          meeting_date: message.internalDate ? message.internalDate.slice(0, 10) : null,
          source_type: "gmail_gemini",
          source_message_id: message.id,
          source_subject: message.subject,
          source_excerpt: (message.snippet || "").slice(0, 280) || null,
          source_body: message.body || null,
          summary_markdown: normalizedSummary,
          discussion_points_json: JSON.stringify(discussionPoints),
          manager_action_items_json: JSON.stringify(managerItems),
          employee_action_items_json: JSON.stringify(employeeItems),
          status: "shared",
          notebook_group: classification.mode,
          section_name: classification.sectionName,
          parent_note_id: null,
          sort_order: 0,
          is_archived: false,
          archived_at: null,
          updated_at: new Date().toISOString(),
          shared_at: new Date().toISOString(),
        });

        const sectionKey = `${classification.mode}:${classification.sectionName}`;
        const existingPref = preferences.find((pref) => pref.owner_name === identity.name && pref.section_key === sectionKey);
        if (!existingPref) {
          await db.notebook_section_preferences.insert({
            owner_name: identity.name,
            notebook_group: classification.mode,
            section_key: sectionKey,
            section_label: classification.sectionName,
            is_favorite: false,
          });
        }

        const created = inserted[0];
        if (created?.id) {
          stats.createdPages += 1;
          importedIds.add(message.id);
          await upsertSyncedNoteActionItems({
            noteId: created.id,
            noteTitle: created.title ?? classification.title,
            sectionName: classification.sectionName,
            notebookGroup: classification.mode,
            managerItems,
            employeeItems,
          });
        }
      }

      await load();
      setGmailMessages((prev) => prev.map((message) => (
        importedIds.has(message.id)
          ? { ...message, imported: true }
          : message
      )));
      const remainingPending = gmailMessages.filter((message) => !message.imported && !importedIds.has(message.id)).length;
      setGmailSyncStats((prev) => prev ? {
        ...prev,
        pending: remainingPending,
        extractedNotes: stats.extractedNotes,
        aiStructured: stats.aiStructured,
        fallbackStructured: stats.fallbackStructured,
        createdPages: stats.createdPages,
        skippedExisting: stats.skippedExisting,
        skippedUnclassified: stats.skippedUnclassified,
        skippedNoExtractedNotes: stats.skippedNoExtractedNotes,
        skippedNoStructuredContent: stats.skippedNoStructuredContent,
        statusMessage: stats.createdPages > 0
          ? `Imported ${stats.createdPages} Gmail note${stats.createdPages === 1 ? "" : "s"} into mapped folders automatically.`
          : `No new pages were created. Existing: ${stats.skippedExisting}, unclassified: ${stats.skippedUnclassified}, parse skips: ${stats.skippedNoExtractedNotes + stats.skippedNoStructuredContent}.`,
      } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveNote(status: "draft" | "shared") {
    if (!identity?.name) return;
    const effectiveNotebookMode: NotebookMode = isManager ? notebookMode : "other";
    if (effectiveNotebookMode === "individual" && !selectedEmployee) {
      setError("Choose the employee section for this 1:1 note.");
      return;
    }
    if (effectiveNotebookMode === "management" && !managementSection.trim()) {
      setError("Add a management section name.");
      return;
    }

    const effectiveSummary = (summaryMarkdown.trim() || (!isManager ? sourceNotes.trim() : "")).trim();
    if (!effectiveSummary) {
      setError(isManager ? "Add or generate the meeting summary first." : "Add some note content before saving.");
      return;
    }

    const sectionName = effectiveNotebookMode === "individual"
      ? String(customSectionName.trim() || selectedEmployee || "").trim()
      : effectiveNotebookMode === "management"
        ? customSectionName.trim() || managementSection.trim()
        : customSectionName.trim() || activeSection?.label || DEFAULT_OTHER_SECTION;
    const employeeValue = effectiveNotebookMode === "management"
      ? `${MANAGEMENT_PREFIX}${sectionName}`
      : effectiveNotebookMode === "other"
        ? `${OTHER_PREFIX}${sectionName}`
        : sectionName;
    const effectiveStatus = effectiveNotebookMode === "management" || effectiveNotebookMode === "other" ? "shared" : status;
    const payload = {
      manager_name: identity.name,
      employee_name: employeeValue,
      title: title.trim() || (!isManager ? "Quick note" : effectiveNotebookMode === "management" ? "Management Meeting Notes" : "1:1 Meeting Summary"),
      meeting_date: meetingDate || null,
      source_type: sourceType || "manual",
      source_message_id: importedMessageId,
      source_subject: importedMessageSubject,
      source_excerpt: sourceNotes.slice(0, 280) || null,
      source_body: sourceNotes || null,
      summary_markdown: effectiveSummary,
      discussion_points_json: JSON.stringify(discussionPoints.split("\n").map((x) => x.trim()).filter(Boolean)),
      manager_action_items_json: JSON.stringify(managerActionItems.split("\n").map((x) => x.trim()).filter(Boolean)),
      employee_action_items_json: JSON.stringify(employeeActionItems.split("\n").map((x) => x.trim()).filter(Boolean)),
      status: effectiveStatus,
      notebook_group: effectiveNotebookMode,
      section_name: sectionName,
      parent_note_id: parentNoteId,
      sort_order: 0,
      is_archived: false,
      archived_at: null,
      updated_at: new Date().toISOString(),
      shared_at: effectiveStatus === "shared" ? new Date().toISOString() : null,
    };

    setSaving(true);
    setError(null);
    try {
      if (editingNoteId) {
        const updated = await db.one_on_one_notes.updateById(editingNoteId, payload);
        setSelectedPageId(updated.id);
        setActiveSectionKey(`${effectiveNotebookMode}:${sectionName}`);
      } else {
        const inserted = await db.one_on_one_notes.insert(payload);
        const created = inserted[0];
        if (created?.id) setSelectedPageId(created.id);
        setActiveSectionKey(`${effectiveNotebookMode}:${sectionName}`);
      }
      setOpenComposer(false);
      resetComposer();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleFavoriteSection(section: SectionRecord) {
    if (!identity?.name) return;
    const existing = preferences.find((pref) => pref.owner_name === identity.name && pref.section_key === section.key);
    try {
      if (existing) {
        await db.notebook_section_preferences.updateById(existing.id, { is_favorite: !existing.is_favorite });
      } else {
        await db.notebook_section_preferences.insert({
          owner_name: identity.name,
          notebook_group: section.notebook_group,
          section_key: section.key,
          section_label: section.label,
          is_favorite: true,
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function archiveNote(note: NormalizedNote, archived: boolean) {
    try {
      await db.one_on_one_notes.updateById(note.id, {
        is_archived: archived,
        archived_at: archived ? new Date().toISOString() : null,
        status: archived ? "archived" : (note.notebook_group === "management" ? "shared" : note.status === "archived" ? "draft" : note.status),
        updated_at: new Date().toISOString(),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteNote(note: NormalizedNote) {
    if (!window.confirm(`Delete "${note.title}" permanently?`)) return;
    try {
      await db.one_on_one_notes.deleteById(note.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function addTask() {
    if (!identity?.name || !taskTitle.trim()) return;
    setSaving(true);
    try {
      await db.personal_action_items.insert({
        employee_name: identity.name,
        owner_name: identity.name,
        note_id: selectedNote?.id ?? null,
        title: taskTitle.trim(),
        details: taskDetails.trim() || null,
        status: "open",
        priority: "medium",
        progress_percent: 0,
        due_date: taskDueDate || null,
        section_name: selectedNote?.section_name ?? activeSection?.label ?? null,
        notebook_group: selectedNote?.notebook_group ?? activeSection?.notebook_group ?? null,
        created_by: identity.name,
      });
      setTaskTitle("");
      setTaskDetails("");
      setTaskDueDate("");
      // Reload tasks after insert to get the server-assigned id
      const taskRows = await db.personal_action_items.list({ orderBy: { column: "created_at", ascending: false } });
      setTasks(taskRows);
    } finally {
      setSaving(false);
    }
  }

  // ── Stable useCallback handlers for TaskRow (no loadTasks — pure optimistic) ─
  const onTaskUpdate = useCallback((id: number, patch: Partial<PersonalActionItem>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
    void db.personal_action_items.updateById(id, patch); // fire-and-forget
  }, []);

  const onTaskDelete = useCallback((id: number) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    void db.personal_action_items.deleteById(id); // fire-and-forget
  }, []);

  const onTaskToggle = useCallback((id: number, checked: boolean) => {
    setSelectedTaskIds(prev => {
      const n = new Set(prev);
      checked ? n.add(id) : n.delete(id);
      return n;
    });
  }, []);

  // noteMap for stable jumpToNote
  const noteMap = useMemo(() => new Map(managerOwnedNotes.map(n => [n.id, n])), [managerOwnedNotes]);

  const onJumpToNote = useCallback((noteId: number) => {
    const note = noteMap.get(noteId);
    if (!note) return;
    setManagerView("notebook");
    setActiveSectionKey(`${note.notebook_group}:${note.section_name}`);
    setSelectedPageId(note.id);
  }, [noteMap]);

  // Legacy wrappers (used by non-row code: extract, markSelectedDone, etc.)
  function updateTaskStatus(task: PersonalActionItem, status: string) {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t));
    void db.personal_action_items.updateById(task.id, { status });
  }

  function updateTask(task: PersonalActionItem, patch: Partial<PersonalActionItem>) {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...patch } : t));
    void db.personal_action_items.updateById(task.id, patch);
  }

  function deleteTask(task: PersonalActionItem) {
    setTasks(prev => prev.filter(t => t.id !== task.id));
    void db.personal_action_items.deleteById(task.id);
  }

  async function addTaskToMyDay(task: PersonalActionItem) {
    if (!identity?.name) return;
    const myDayTitle = task.title.startsWith(MY_DAY_TAG) ? task.title : `${MY_DAY_TAG} ${task.title}`;
    const existing = myOwnTasks.find((candidate) =>
      candidate.title.trim().toLowerCase() === myDayTitle.trim().toLowerCase() &&
      (candidate.details ?? "").trim().toLowerCase() === (task.details ?? "").trim().toLowerCase(),
    );
    if (existing) {
      setError("This task is already in your My Day list.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await db.personal_action_items.insert({
        employee_name: identity.name,
        owner_name: identity.name,
        note_id: task.note_id ?? null,
        title: myDayTitle,
        details: task.details ? `${task.details} · Added from Assigned to me` : "Added from Assigned to me", // kept for backward compatibility
        status: task.status === "done" ? "open" : task.status,
        priority: task.priority ?? "medium",
        progress_percent: task.status === "done" ? 0 : task.progress_percent ?? 0,
        due_date: task.due_date || null,
        section_name: "My Day",
        notebook_group: "other",
        created_by: identity.name,
      });
      const taskRows = await db.personal_action_items.list({ orderBy: { column: "created_at", ascending: false } });
      setTasks(taskRows);
      setError("✅ Added to My Day");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function isOverdue(task: PersonalActionItem) {
    if (!task.due_date || task.status === "done" || task.status === "duplicate") return false;
    return task.due_date < TODAY;
  }

  const jumpToNote = (task: PersonalActionItem) => {
    if (!task.note_id) return;
    onJumpToNote(task.note_id);
  };
  void jumpToNote; // retained for future inline rows

  async function markSelectedDone() {
    if (selectedTaskIds.size === 0) return;
    setTasks(prev => prev.map(t => selectedTaskIds.has(t.id) ? { ...t, status: "done" } : t));
    setSaving(true);
    try {
      for (const id of selectedTaskIds) {
        void db.personal_action_items.updateById(id, { status: "done" });
      }
      setSelectedTaskIds(new Set());
    } finally {
      setSaving(false);
    }
  }

  function deleteSelectedTasks() {
    if (selectedTaskIds.size === 0) return;
    // Optimistic removal
    setTasks(prev => prev.filter(t => !selectedTaskIds.has(t.id)));
    for (const id of selectedTaskIds) {
      void db.personal_action_items.deleteById(id);
    }
    setSelectedTaskIds(new Set());
  }

  async function sendSlackDigest() {
    if (!identity?.name) return;
    const openTasks = managerTaskRows.filter((t) => t.status !== "done");
    if (openTasks.length === 0) {
      setError("No open tasks to send — all done! 🎉");
      return;
    }
    setDigestSending(true);
    try {
      // Group by owner
      const byOwner = new Map<string, PersonalActionItem[]>();
      for (const task of openTasks) {
        const owner = task.owner_name ?? task.employee_name;
        if (!byOwner.has(owner)) byOwner.set(owner, []);
        byOwner.get(owner)!.push(task);
      }
      const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      const lines: string[] = [`*📋 Action Item Digest — ${today}*`, ""];
      for (const [owner, ownerTasks] of byOwner) {
        lines.push(`*${owner}*`);
        for (const task of ownerTasks) {
          const overdue = isOverdue(task);
          const due = task.due_date ? ` _(due ${task.due_date}${overdue ? " ⚠️ OVERDUE" : ""})_` : "";
          const status = task.status === "in_progress" ? " 🔄" : "";
          lines.push(`• ${task.title}${status}${due}`);
        }
        lines.push("");
      }
      lines.push(`_${openTasks.length} open tasks · sent from Meeting Notes_`);
      await postSlackMessage(lines.join("\n"), {
        username: "Action Digest",
        icon_emoji: ":clipboard:",
      });
      setError("✅ Slack digest sent successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send Slack digest");
    } finally {
      setDigestSending(false);
    }
  }

  // ── AI: Pattern detector ────────────────────────────────────────────────
  async function detectPatterns() {
    const allItems = managerTaskRows.map((t) => `[${t.status}] ${t.owner_name ?? t.employee_name}: ${t.title}`).join("\n");
    if (!allItems) { setPatternResult("No tasks to analyze."); return; }
    setPatternLoading(true);
    setPatternResult("");
    try {
      const prompt = `You are a management assistant. Analyze the following action items from 1:1 meeting notes and identify:\n1. Recurring themes or patterns (tasks that keep appearing)\n2. People with the most carry-over items\n3. Risk signals (overdue, blocked, or repeatedly assigned with no completion)\n4. Recommendations for the manager\n\nAction items:\n${allItems}\n\nFormat your response as clear sections with bullet points. Be concise and actionable.`;
      const res = await completePattern(prompt);
      setPatternResult(res ?? "");
    } finally {
      setPatternLoading(false);
    }
  }

  // ── AI: Weekly summary ───────────────────────────────────────────────────
  async function generateWeeklySummary() {
    const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    const done = managerTaskRows.filter(t => t.status === "done");
    const open = managerTaskRows.filter(t => t.status !== "done");
    const overdue = open.filter(t => isOverdue(t));
    const summary = `Week of ${today}\nCompleted: ${done.length} tasks\nOpen: ${open.length} tasks\nOverdue: ${overdue.length} tasks\n\nCompleted:\n${done.slice(0,15).map(t=>`- ${t.owner_name??t.employee_name}: ${t.title}`).join("\n")}\n\nStill open:\n${open.slice(0,20).map(t=>`- [${t.priority??"medium"}] ${t.owner_name??t.employee_name}: ${t.title}${isOverdue(t)?" (OVERDUE)":""}`).join("\n")}`;
    setWeeklyLoading(true);
    setWeeklyResult("");
    try {
      const prompt = [
        "Generate a professional weekly action-item summary for a team manager. Write 2-3 paragraphs: what was accomplished this week, what's still in flight, and any risks or recommendations. Keep it concise and suitable for a manager update.\n\n",
        summary,
      ].join("");
      const res = await completeWeekly(prompt);
      setWeeklyResult(res ?? "");
    } finally {
      setWeeklyLoading(false);
    }
  }

  // ── AI: Pre-1:1 digest ───────────────────────────────────────────────────
  async function generatePrep(person: string) {
    setPrepPerson(person);
    setPrepResult("");
    setPrepLoading(true);
    const personNotes = managerOwnedNotes
      .filter(n => n.section_name === person || n.employee_name === person)
      .sort((a, b) => new Date(b.meeting_date ?? b.created_at).getTime() - new Date(a.meeting_date ?? a.created_at).getTime())
      .slice(0, 5);
    const personTasks = managerTaskRows.filter(t => (t.owner_name ?? t.employee_name) === person && t.status !== "done");
    const noteSummaries = personNotes.map(n => `[${n.meeting_date ?? "no date"}] ${n.title}:\n${n.summary_markdown ?? ""}`).join("\n\n");
    const taskList = personTasks.map(t => `- [${t.priority??"medium"}${isOverdue(t)?" OVERDUE":""}] ${t.title}`).join("\n");
    const prompt = `You are a management coach. Generate a pre-meeting preparation brief for a 1:1 meeting with ${person}.\n\nRecent meeting summaries:\n${noteSummaries || "None"}\n\nOpen action items:\n${taskList || "None"}\n\nGenerate:\n1. A 2-sentence context recap (what's been discussed recently)\n2. 3-5 suggested talking points for this meeting\n3. Any items that need follow-up based on open tasks\n4. One coaching or recognition opportunity if visible in the data\n\nBe specific and actionable. Format with clear headers.`;
    try {
      const res = await completePrep(prompt);
      setPrepResult(res ?? "");
    } finally {
      setPrepLoading(false);
    }
  }



  async function analyseTaskImportance() { // retained — can be re-exposed via AI Insights tab
    if (!identity?.name) return;
    const taskList = managerTaskRows.filter(t => t.status !== "done");
    if (taskList.length === 0) {
      setError("No open tasks to analyse.");
      return;
    }

    const taskLines = taskList.map((t, i) => {
      const overdue = t.due_date && new Date(t.due_date) < new Date() ? " [OVERDUE]" : "";
      const days = t.created_at ? Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000) : 0;
      return `${i + 1}. "${t.title}" — owner: ${t.owner_name ?? t.employee_name}, priority: ${t.priority ?? "medium"}, section: ${t.section_name ?? "general"}, open ${days} days${overdue}`;
    }).join("\n");

    const prompt = `You are a manager productivity assistant. Analyse the following list of open action items and classify each as "critical", "important", or "low" based on:
- Urgency signals (overdue, many days open, ASAP language)
- Business impact (customer-facing, blockers, cross-team dependencies)  
- Strategic weight (performance-related, escalations, deadlines)
- Routine vs. high-stakes tasks

Task list:
${taskLines}

Respond with ONLY a valid JSON object in this exact shape (no markdown, no explanation):
{
  "summary": "2-3 sentence executive summary of the task landscape and where to focus first",
  "classifications": [
    { "title": "exact task title", "importance": "critical|important|low", "reason": "one concise sentence explaining why" }
  ]
}`;

    try {
      const raw = await completeImportance(prompt);
      if (!raw) return;
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");
      const parsed: TaskImportanceResult = JSON.parse(jsonMatch[0]);
      setImportanceAnalysis(parsed);
      setShowImportancePanel(true);
    } catch (err) {
      setError("AI analysis failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function reviewDuplicateTasks() {
    if (!identity?.name) return;
    const candidateTasks = managerTaskRows.filter((task) => task.status !== "done" && task.status !== "duplicate");
    if (candidateTasks.length < 2) {
      setError("Need at least two active tasks to review duplicates.");
      return;
    }

    setDuplicateReviewLoading(true);
    setError(null);
    try {
      const taskLines = candidateTasks.map((task) => {
        const owner = storedOwner(task) || "Unassigned";
        return JSON.stringify({
          id: task.id,
          title: task.title,
          details: task.details ?? "",
          owner,
          status: task.status,
          due_date: task.due_date ?? null,
          section_name: task.section_name ?? null,
        });
      }).join("\n");

      const prompt = `You are reviewing a task list for duplicates. Identify only true duplicates or near-duplicates that clearly refer to the same action item. Be conservative: if unsure, do not mark as duplicate.

Return ONLY valid JSON with this exact shape:
{"summary":"short summary","groups":[{"canonicalTitle":"title for the duplicate set","reason":"why these are duplicates","taskIds":[1,2]}]}

Rules:
- taskIds must reference the provided IDs exactly.
- Only include groups with 2 or more IDs.
- Do not include completed tasks.
- Prefer duplicates with very similar wording, same owner, same source/details, or obvious phrasing variants.
- Do not merge related-but-different tasks.

Tasks:\n${taskLines}`;

      const raw = await completeDuplicateReview(prompt);
      const match = raw?.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("AI did not return valid JSON.");
      const parsed = JSON.parse(match[0]) as DuplicateTaskReview;
      const validGroups = Array.isArray(parsed.groups)
        ? parsed.groups
            .map((group: { canonicalTitle?: unknown; reason?: unknown; taskIds?: unknown }) => ({
              canonicalTitle: String(group.canonicalTitle ?? "Potential duplicate set").trim() || "Potential duplicate set",
              reason: String(group.reason ?? "").trim(),
              taskIds: Array.from(new Set((Array.isArray(group.taskIds) ? group.taskIds : []).map((id: unknown) => Number(id)).filter((id: number) => Number.isFinite(id)))),
            }))
            .filter((group: { taskIds: number[] }) => group.taskIds.length > 1)
        : [];

      setDuplicateReview({
        summary: String(parsed.summary ?? "").trim() || (validGroups.length > 0 ? "Potential duplicate tasks found." : "No obvious duplicate tasks found."),
        groups: validGroups,
      });
      setDuplicateReviewOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review duplicate tasks.");
    } finally {
      setDuplicateReviewLoading(false);
    }
  }

  async function deleteDuplicateGroup(taskIds: number[]) {
    const duplicatesToDelete = taskIds.slice(1);
    if (duplicatesToDelete.length === 0) return;
    setTasks((prev) => prev.filter((task) => !duplicatesToDelete.includes(task.id)));
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      duplicatesToDelete.forEach((id) => next.delete(id));
      return next;
    });
    for (const id of duplicatesToDelete) {
      void db.personal_action_items.deleteById(id);
    }
    setDuplicateReview((prev: DuplicateTaskReview | null) => prev ? ({ ...prev, groups: prev.groups.filter((group) => group.taskIds.join(",") !== taskIds.join(",")) }) : prev);
  }

  async function extractAllTasks() {
    if (!identity?.name) return;
    const notesWithActions = managerOwnedNotes.filter((note) => {
      const items = [...safeJsonArray(note.manager_action_items_json), ...safeJsonArray(note.employee_action_items_json)].map((i) => i.trim()).filter(Boolean);
      return items.length > 0;
    });
    if (notesWithActions.length === 0) {
      setError("No action items found across any meeting notes. Generate summaries first using AI.");
      return;
    }
    setSaving(true);
    let inserted = 0;

    const MANAGER_NAMES = ["Anirudh Kukudala", "Perry Cox", "Matt Marquez"];

    // Only match a name prefix if the candidate IS a known manager.
    // Never parses "Update Meeting Status:" as a name.
    function parseManagerName(raw: string): { managerName: string; title: string } | null {
      const colonMatch = raw.match(/^([A-Z][a-z]+(?: [A-Z][a-z]+)+):\s*(.+)$/);
      if (colonMatch) {
        const found = MANAGER_NAMES.find((m) => samePerson(m, colonMatch[1].trim()));
        if (found) return { managerName: found, title: colonMatch[2].trim() };
      }
      const bracketMatch = raw.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (bracketMatch) {
        const found = MANAGER_NAMES.find((m) => samePerson(m, bracketMatch[1].trim()));
        if (found) return { managerName: found, title: bracketMatch[2].trim() };
      }
      return null;
    }

    try {
      // Fetch ALL tasks fresh from DB — never rely on stale React state for deletions.
      const freshTasks = await db.personal_action_items.list({ orderBy: { column: "created_at", ascending: false } });

      // Build set of all note IDs we're processing (as strings for safe comparison)
      const noteIds = new Set(notesWithActions.map((n) => String(n.id)));
      const noteTitleToNote = new Map(notesWithActions.map((n) => [n.title?.trim().toLowerCase(), n]));
      const noteSectionToNote = new Map(notesWithActions.map((n) => [n.section_name?.trim().toLowerCase(), n]));

      // Delete ALL old extracted tasks — match by note_id OR by (details=note.title) for legacy tasks without note_id
      const toDelete = freshTasks.filter((t) => {
        if (t.note_id != null && noteIds.has(String(t.note_id))) return true;
        if (t.note_id == null && t.details && noteTitleToNote.has(t.details.trim().toLowerCase())) return true;
        if (t.note_id == null && t.section_name && noteSectionToNote.has(t.section_name.trim().toLowerCase())) return true;
        return false;
      });
      console.log([
        "[Extract] Deleting ",
        toDelete.length,
        " old tasks (",
        toDelete.filter(t => t.note_id != null).length,
        " by note_id, ",
        toDelete.filter(t => t.note_id == null).length,
        " legacy)",
      ].join(""));
      for (const t of toDelete) {
        await db.personal_action_items.deleteById(t.id);
      }

      for (const note of notesWithActions) {
        const isIndividual = note.notebook_group === "individual";
        // teamMember = the employee's name for 1:1 notes (e.g. "Hamza Rahmani")
        const teamMember = isIndividual ? note.section_name : identity.name;

        const managerItems = safeJsonArray(note.manager_action_items_json).map((i) => i.trim()).filter(Boolean);
        const employeeItems = safeJsonArray(note.employee_action_items_json).map((i) => i.trim()).filter(Boolean);

        console.log(`[Extract] note "${note.title}" | group="${note.notebook_group}" | section="${note.section_name}" | teamMember="${teamMember}" | mgr=${managerItems.length} emp=${employeeItems.length}`);

        if (isIndividual) {
          // Combine BOTH AI buckets — old AI runs may have misclassified items.
          // Rule: manager-prefixed items → that manager. Everything else → teamMember.
          const allItems = [...managerItems, ...employeeItems];
          console.log(`[Extract] individual note — ${allItems.length} items, teamMember="${teamMember}"`);
          for (const item of allItems) {
            const parsed = parseManagerName(item);
            const owner = parsed?.managerName ?? teamMember;
            const title = parsed?.title ?? item;
            console.log(`[Extract]   "${title}" → owner="${owner}"`);
            await db.personal_action_items.insert({
              employee_name: owner,
              owner_name: owner,
              note_id: note.id,
              title,
              details: note.title,
              status: "open",
              priority: "medium",
              progress_percent: 0,
              due_date: null,
              section_name: note.section_name,
              notebook_group: note.notebook_group,
              created_by: identity.name,
            });
            inserted++;
          }
        } else {
          // For management / other notes: use buckets as-is.
          // Manager items → the named manager (or logged-in manager as fallback).
          for (const item of managerItems.filter(Boolean)) {
            const parsed = parseManagerName(item);
            const managerOwner = parsed?.managerName ?? identity.name;
            const title = parsed?.title ?? item;
            await db.personal_action_items.insert({
              employee_name: managerOwner,
              owner_name: managerOwner,
              note_id: note.id,
              title,
              details: note.title,
              status: "open",
              priority: "medium",
              progress_percent: 0,
              due_date: null,
              section_name: note.section_name,
              notebook_group: note.notebook_group,
              created_by: identity.name,
            });
            inserted++;
          }
          // Employee items → teamMember (section name or logged-in manager).
          for (const item of employeeItems.filter(Boolean)) {
            await db.personal_action_items.insert({
              employee_name: teamMember,
              owner_name: teamMember,
              note_id: note.id,
              title: item,
              details: note.title,
              status: "open",
              priority: "medium",
              progress_percent: 0,
              due_date: null,
              section_name: note.section_name,
              notebook_group: note.notebook_group,
              created_by: identity.name,
            });
            inserted++;
          }
        }
      }
      await load();
      // Show a visible debug summary so we can verify ownership without DevTools
      const freshAfter = await db.personal_action_items.list({ orderBy: { column: "created_at", ascending: false } });
      const debugLines = notesWithActions.map((n) => {
        const noteTasks = freshAfter.filter((t) => t.note_id != null && String(t.note_id) === String(n.id));
        return `"${n.section_name}" (${n.notebook_group}): ${noteTasks.map(t => `${t.owner_name}`).join(", ") || "no tasks"}`;
      });
      setExtractDebug(`Inserted ${inserted} tasks.\n${debugLines.join("\n")}`);
      if (inserted === 0) setError("All action items are already in the action center — nothing new to extract.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function createTasksFromNote(note: NormalizedNote) {
    if (!identity?.name) return;
    const sourceItems = [...safeJsonArray(note.manager_action_items_json), ...safeJsonArray(note.employee_action_items_json)].map((item) => item.trim()).filter(Boolean);
    if (sourceItems.length === 0) {
      setError("This note does not have any extracted action items yet.");
      return;
    }
    const existing = tasks.filter((task) => task.note_id === note.id).map((task) => task.title.trim().toLowerCase());
    const values = sourceItems.filter((item) => !existing.includes(item.toLowerCase())).map((item) => ({
      employee_name: identity.name,
      owner_name: identity.name,
      note_id: note.id,
      title: item,
      details: note.title,
      status: "open",
      priority: "medium",
      progress_percent: 0,
      due_date: null,
      section_name: note.section_name,
      notebook_group: note.notebook_group,
      created_by: identity.name,
    }));
    if (values.length === 0) {
      setError("Action items from this note are already in the action center.");
      return;
    }
    setSaving(true);
    try {
      await db.personal_action_items.insert(values);
      await load();
    } finally {
      setSaving(false);
    }
  }

  function employeeValueForSection(notebookGroup: NotebookMode, sectionName: string) {
    if (notebookGroup === "management") return `${MANAGEMENT_PREFIX}${sectionName}`;
    if (notebookGroup === "other") return `${OTHER_PREFIX}${sectionName}`;
    return sectionName;
  }

  async function moveNoteToSection(note: NormalizedNote, sectionKey: string) {
    const separatorIndex = sectionKey.indexOf(":");
    if (separatorIndex < 0) return;
    const notebookGroup = sectionKey.slice(0, separatorIndex) as NotebookMode;
    const sectionName = sectionKey.slice(separatorIndex + 1).trim();
    if (!sectionName) return;

    try {
      await db.one_on_one_notes.updateById(note.id, {
        notebook_group: notebookGroup,
        section_name: sectionName,
        employee_name: employeeValueForSection(notebookGroup, sectionName),
        updated_at: new Date().toISOString(),
        status: note.is_archived ? "archived" : (notebookGroup === "individual" ? (note.status === "archived" ? "draft" : note.status) : "shared"),
      });
      setActiveSectionKey(sectionKey);
      setSelectedPageId(note.id);
      setDraggedNoteId(null);
      setMoveDialogNoteId(null);
      setMoveTargetSectionKey(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function createSectionFolder() {
    if (!identity?.name) return;
    const leafLabel = createSectionName.trim();
    if (!leafLabel) {
      setError("Enter a section name.");
      return;
    }

    const fullLabel = createSectionParent
      ? `${createSectionParent}${SECTION_PATH_SEPARATOR}${leafLabel}`
      : leafLabel;
    const sectionKey = `${createSectionGroup}:${fullLabel}`;
    const existing = preferences.find((pref) => pref.owner_name === identity.name && pref.section_key === sectionKey);

    try {
      setSaving(true);
      setError(null);
      if (!existing) {
        await db.notebook_section_preferences.insert({
          owner_name: identity.name,
          notebook_group: createSectionGroup,
          section_key: sectionKey,
          section_label: fullLabel,
          is_favorite: false,
        });
      }
      setCreateSectionOpen(false);
      setCreateSectionName("");
      setCreateSectionParent(null);
      setActiveSectionKey(sectionKey);
      setAccordionValues((prev) => Array.from(new Set([...prev, createSectionGroup, ...(createSectionParent ? [createSectionParent] : [])])));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function createNotebookArea() {
    if (!identity?.name) return;
    const label = createAreaName.trim();
    if (!label) {
      setError("Enter a notebook area name.");
      return;
    }

    const existing = preferences.find(
      (pref) => pref.owner_name === identity.name && pref.section_key === `area:${label}`,
    );
    if (existing) {
      setError("A notebook area with this name already exists.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await db.notebook_section_preferences.insert({
        owner_name: identity.name,
        notebook_group: "other",
        section_key: `area:${label}`,
        section_label: label,
        is_favorite: false,
      });
      setCreateAreaOpen(false);
      setCreateAreaName("");
      setAccordionValues((prev) => Array.from(new Set([...prev, label])));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function moveSectionFolder(section: SectionRecord, targetParentLabel: string | null, targetNotebookGroup?: NotebookMode) {
    if (!identity?.name) return;

    const destinationGroup = targetNotebookGroup ?? section.notebook_group;
    const baseName = splitSectionPath(section.label).slice(-1)[0] ?? section.label;
    const nextLabel = targetParentLabel ? `${targetParentLabel}${SECTION_PATH_SEPARATOR}${baseName}` : baseName;
    if (nextLabel === section.label) {
      setMoveSectionOpen(false);
      setMoveSectionKey(null);
      setMoveSectionTargetParent(null);
      return;
    }

    const affectedSections = sectionRecords.filter(
      (candidate) => candidate.notebook_group === section.notebook_group && (candidate.label === section.label || candidate.label.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)),
    );
    const affectedNotes = managerOwnedNotes.filter(
      (note) => note.notebook_group === section.notebook_group && (note.section_name === section.label || note.section_name.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)),
    );

    try {
      setSaving(true);
      setError(null);

      for (const pref of preferences.filter((row) => row.owner_name === identity.name && row.notebook_group === section.notebook_group && (row.section_label === section.label || row.section_label?.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`) || row.section_key === section.key || row.section_key.startsWith(`${section.notebook_group}:${section.label}${SECTION_PATH_SEPARATOR}`)))) {
        const currentLabel = pref.section_label || pref.section_key.split(":").slice(1).join(":");
        const movedLabel = currentLabel === section.label
          ? nextLabel
          : `${nextLabel}${currentLabel.slice(section.label.length)}`;
        await db.notebook_section_preferences.updateById(pref.id, {
          section_key: `${section.notebook_group}:${movedLabel}`,
          section_label: movedLabel,
        });
      }

      for (const childSection of affectedSections) {
        if (!preferences.some((pref) => pref.owner_name === identity.name && pref.section_key === childSection.key)) {
          const movedLabel = childSection.label === section.label
            ? nextLabel
            : `${nextLabel}${childSection.label.slice(section.label.length)}`;
          await db.notebook_section_preferences.insert({
            owner_name: identity.name,
            notebook_group: section.notebook_group,
            section_key: `${section.notebook_group}:${movedLabel}`,
            section_label: movedLabel,
            is_favorite: childSection.favorite,
          });
        }
      }

      for (const note of affectedNotes) {
        const movedLabel = note.section_name === section.label
          ? nextLabel
          : `${nextLabel}${note.section_name.slice(section.label.length)}`;
        await db.one_on_one_notes.updateById(note.id, {
          notebook_group: destinationGroup,
          section_name: movedLabel,
          employee_name: employeeValueForSection(destinationGroup, movedLabel),
          status: note.is_archived ? "archived" : (destinationGroup === "individual" ? (note.status === "archived" ? "draft" : note.status) : "shared"),
          updated_at: new Date().toISOString(),
        });
      }

      if (activeSectionKey === section.key || activeSectionKey?.startsWith(`${section.notebook_group}:${section.label}${SECTION_PATH_SEPARATOR}`)) {
        const suffix = activeSectionKey === section.key ? "" : activeSectionKey?.slice(`${section.notebook_group}:${section.label}`.length) ?? "";
        setActiveSectionKey(`${section.notebook_group}:${nextLabel}${suffix}`);
      }

      setMoveSectionOpen(false);
      setMoveSectionKey(null);
      setMoveSectionTargetParent(null);
      setManageSectionKey(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function renameSectionFolder(section: SectionRecord, nextLeafName: string) {
    if (!identity?.name) return;
    const trimmed = nextLeafName.trim();
    if (!trimmed) {
      setError("Enter a folder name.");
      return;
    }

    const parentPath = splitSectionPath(section.label).slice(0, -1).join(SECTION_PATH_SEPARATOR);
    const nextLabel = parentPath ? `${parentPath}${SECTION_PATH_SEPARATOR}${trimmed}` : trimmed;
    if (nextLabel === section.label) {
      setRenameSectionOpen(false);
      setRenameSectionKey(null);
      setRenameSectionName("");
      return;
    }

    const collision = sectionRecords.some(
      (candidate) => candidate.notebook_group === section.notebook_group && candidate.label === nextLabel && candidate.key !== section.key,
    );
    if (collision) {
      setError("A folder with this name already exists in that location.");
      return;
    }

    const affectedSections = sectionRecords.filter(
      (candidate) => candidate.notebook_group === section.notebook_group && (candidate.label === section.label || candidate.label.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)),
    );
    const affectedNotes = managerOwnedNotes.filter(
      (note) => note.notebook_group === section.notebook_group && (note.section_name === section.label || note.section_name.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)),
    );

    try {
      setSaving(true);
      setError(null);

      for (const pref of preferences.filter((row) => row.owner_name === identity.name && row.notebook_group === section.notebook_group && ((row.section_label || row.section_key.split(":").slice(1).join(":")) === section.label || (row.section_label || row.section_key.split(":").slice(1).join(":")).startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)))) {
        const currentLabel = pref.section_label || pref.section_key.split(":").slice(1).join(":");
        const renamedLabel = currentLabel === section.label
          ? nextLabel
          : `${nextLabel}${currentLabel.slice(section.label.length)}`;
        await db.notebook_section_preferences.updateById(pref.id, {
          section_key: `${section.notebook_group}:${renamedLabel}`,
          section_label: renamedLabel,
        });
      }

      for (const childSection of affectedSections) {
        if (!preferences.some((pref) => pref.owner_name === identity.name && pref.section_key === childSection.key)) {
          const renamedLabel = childSection.label === section.label
            ? nextLabel
            : `${nextLabel}${childSection.label.slice(section.label.length)}`;
          await db.notebook_section_preferences.insert({
            owner_name: identity.name,
            notebook_group: section.notebook_group,
            section_key: `${section.notebook_group}:${renamedLabel}`,
            section_label: renamedLabel,
            is_favorite: childSection.favorite,
          });
        }
      }

      for (const note of affectedNotes) {
        const renamedLabel = note.section_name === section.label
          ? nextLabel
          : `${nextLabel}${note.section_name.slice(section.label.length)}`;
        await db.one_on_one_notes.updateById(note.id, {
          section_name: renamedLabel,
          employee_name: employeeValueForSection(section.notebook_group, renamedLabel),
          updated_at: new Date().toISOString(),
        });
      }

      if (activeSectionKey === section.key || activeSectionKey?.startsWith(`${section.notebook_group}:${section.label}${SECTION_PATH_SEPARATOR}`)) {
        const suffix = activeSectionKey === section.key ? "" : activeSectionKey?.slice(`${section.notebook_group}:${section.label}`.length) ?? "";
        setActiveSectionKey(`${section.notebook_group}:${nextLabel}${suffix}`);
      }

      setRenameSectionOpen(false);
      setRenameSectionKey(null);
      setRenameSectionName("");
      setManageSectionKey(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function duplicateSectionFolder(section: SectionRecord) {
    if (!identity?.name) return;

    const parentPath = splitSectionPath(section.label).slice(0, -1).join(SECTION_PATH_SEPARATOR);
    const leaf = splitSectionPath(section.label).slice(-1)[0] ?? section.label;
    let nextLeaf = `${leaf} Copy`;
    let nextLabel = parentPath ? `${parentPath}${SECTION_PATH_SEPARATOR}${nextLeaf}` : nextLeaf;
    let index = 2;
    while (sectionRecords.some((candidate) => candidate.notebook_group === section.notebook_group && candidate.label === nextLabel)) {
      nextLeaf = `${leaf} Copy ${index}`;
      nextLabel = parentPath ? `${parentPath}${SECTION_PATH_SEPARATOR}${nextLeaf}` : nextLeaf;
      index += 1;
    }

    const affectedSections = sectionRecords.filter(
      (candidate) => candidate.notebook_group === section.notebook_group && (candidate.label === section.label || candidate.label.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)),
    );
    const affectedNotes = managerOwnedNotes.filter(
      (note) => note.notebook_group === section.notebook_group && (note.section_name === section.label || note.section_name.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)),
    );

    try {
      setSaving(true);
      setError(null);
      await db.notebook_section_preferences.insert({
        owner_name: identity.name,
        notebook_group: section.notebook_group,
        section_key: `${section.notebook_group}:${nextLabel}`,
        section_label: nextLabel,
        is_favorite: false,
      });

      for (const childSection of affectedSections.filter((candidate) => candidate.label !== section.label)) {
        const copiedLabel = `${nextLabel}${childSection.label.slice(section.label.length)}`;
        await db.notebook_section_preferences.insert({
          owner_name: identity.name,
          notebook_group: section.notebook_group,
          section_key: `${section.notebook_group}:${copiedLabel}`,
          section_label: copiedLabel,
          is_favorite: false,
        });
      }

      for (const note of affectedNotes) {
        const copiedLabel = note.section_name === section.label ? nextLabel : `${nextLabel}${note.section_name.slice(section.label.length)}`;
        await db.one_on_one_notes.insert({
          manager_name: note.manager_name,
          employee_name: employeeValueForSection(section.notebook_group, copiedLabel),
          title: note.title,
          meeting_date: note.meeting_date ?? null,
          source_type: note.source_type ?? "manual",
          source_message_id: note.source_message_id ?? null,
          source_subject: note.source_subject ?? null,
          source_excerpt: note.source_excerpt ?? null,
          source_body: note.source_body ?? null,
          summary_markdown: note.summary_markdown ?? "",
          discussion_points_json: note.discussion_points_json ?? "[]",
          manager_action_items_json: note.manager_action_items_json ?? "[]",
          employee_action_items_json: note.employee_action_items_json ?? "[]",
          status: section.notebook_group === "individual" ? note.status : "shared",
          notebook_group: section.notebook_group,
          section_name: copiedLabel,
          parent_note_id: null,
          sort_order: note.sort_order ?? 0,
          is_archived: Boolean(note.is_archived),
          archived_at: note.archived_at ?? null,
          updated_at: new Date().toISOString(),
          shared_at: note.shared_at ?? null,
        });
      }

      setContextMenu(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function renameArea(areaName: string, nextAreaName: string) {
    if (!identity?.name) return;
    const trimmed = nextAreaName.trim();
    if (!trimmed || trimmed === areaName) return;
    if (customAreaNames.includes(trimmed)) {
      setError("A notebook area with this name already exists.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const areaPref = preferences.find((pref) => pref.owner_name === identity.name && pref.section_key === `area:${areaName}`);
      if (areaPref) {
        await db.notebook_section_preferences.updateById(areaPref.id, {
          section_key: `area:${trimmed}`,
          section_label: trimmed,
        });
      }
      for (const pref of preferences.filter((row) => row.owner_name === identity.name && row.notebook_group === "other" && row.section_label?.startsWith(`${areaName}${SECTION_PATH_SEPARATOR}`))) {
        const suffix = pref.section_label.slice(areaName.length + SECTION_PATH_SEPARATOR.length);
        const nextLabel = `${trimmed}${SECTION_PATH_SEPARATOR}${suffix}`;
        await db.notebook_section_preferences.updateById(pref.id, {
          section_key: `other:${nextLabel}`,
          section_label: nextLabel,
        });
      }
      for (const note of managerOwnedNotes.filter((row) => row.notebook_group === "other" && row.section_name.startsWith(`${areaName}${SECTION_PATH_SEPARATOR}`))) {
        const suffix = note.section_name.slice(areaName.length + SECTION_PATH_SEPARATOR.length);
        const nextLabel = `${trimmed}${SECTION_PATH_SEPARATOR}${suffix}`;
        await db.one_on_one_notes.updateById(note.id, {
          section_name: nextLabel,
          employee_name: employeeValueForSection("other", nextLabel),
          updated_at: new Date().toISOString(),
        });
      }
      setContextMenu(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function moveArea(areaName: string, targetAreaName: string | null) {
    if (!identity?.name) return;
    const trimmedTarget = targetAreaName?.trim() || null;
    if (trimmedTarget === areaName) return;

    try {
      setSaving(true);
      setError(null);
      const areaPref = preferences.find((pref) => pref.owner_name === identity.name && pref.section_key === `area:${areaName}`);
      if (areaPref) await db.notebook_section_preferences.deleteById(areaPref.id);
      for (const pref of preferences.filter((row) => row.owner_name === identity.name && row.notebook_group === "other" && row.section_label?.startsWith(`${areaName}${SECTION_PATH_SEPARATOR}`))) {
        const suffix = pref.section_label.slice(areaName.length + SECTION_PATH_SEPARATOR.length);
        const nextLabel = trimmedTarget ? `${trimmedTarget}${SECTION_PATH_SEPARATOR}${suffix}` : suffix;
        await db.notebook_section_preferences.updateById(pref.id, {
          section_key: `other:${nextLabel}`,
          section_label: nextLabel,
        });
      }
      for (const note of managerOwnedNotes.filter((row) => row.notebook_group === "other" && row.section_name.startsWith(`${areaName}${SECTION_PATH_SEPARATOR}`))) {
        const suffix = note.section_name.slice(areaName.length + SECTION_PATH_SEPARATOR.length);
        const nextLabel = trimmedTarget ? `${trimmedTarget}${SECTION_PATH_SEPARATOR}${suffix}` : suffix;
        await db.one_on_one_notes.updateById(note.id, {
          section_name: nextLabel,
          employee_name: employeeValueForSection("other", nextLabel),
          updated_at: new Date().toISOString(),
        });
      }
      setContextMenu(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function copyArea(areaName: string) {
    if (!identity?.name) return;
    let nextArea = `${areaName} Copy`;
    let index = 2;
    while (customAreaNames.includes(nextArea)) {
      nextArea = `${areaName} Copy ${index}`;
      index += 1;
    }

    try {
      setSaving(true);
      setError(null);
      await db.notebook_section_preferences.insert({
        owner_name: identity.name,
        notebook_group: "other",
        section_key: `area:${nextArea}`,
        section_label: nextArea,
        is_favorite: false,
      });
      for (const section of otherSections.filter((row) => row.label.startsWith(`${areaName}${SECTION_PATH_SEPARATOR}`))) {
        const nextLabel = `${nextArea}${section.label.slice(areaName.length)}`;
        await db.notebook_section_preferences.insert({
          owner_name: identity.name,
          notebook_group: "other",
          section_key: `other:${nextLabel}`,
          section_label: nextLabel,
          is_favorite: false,
        });
      }
      for (const note of managerOwnedNotes.filter((row) => row.notebook_group === "other" && row.section_name.startsWith(`${areaName}${SECTION_PATH_SEPARATOR}`))) {
        const nextLabel = `${nextArea}${note.section_name.slice(areaName.length)}`;
        await db.one_on_one_notes.insert({
          manager_name: note.manager_name,
          employee_name: employeeValueForSection("other", nextLabel),
          title: note.title,
          meeting_date: note.meeting_date ?? null,
          source_type: note.source_type ?? "manual",
          source_message_id: note.source_message_id ?? null,
          source_subject: note.source_subject ?? null,
          source_excerpt: note.source_excerpt ?? null,
          source_body: note.source_body ?? null,
          summary_markdown: note.summary_markdown ?? "",
          discussion_points_json: note.discussion_points_json ?? "[]",
          manager_action_items_json: note.manager_action_items_json ?? "[]",
          employee_action_items_json: note.employee_action_items_json ?? "[]",
          status: "shared",
          notebook_group: "other",
          section_name: nextLabel,
          parent_note_id: null,
          sort_order: note.sort_order ?? 0,
          is_archived: Boolean(note.is_archived),
          archived_at: note.archived_at ?? null,
          updated_at: new Date().toISOString(),
          shared_at: note.shared_at ?? null,
        });
      }
      setContextMenu(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function deleteSectionFolder(section: SectionRecord) {
    // Close any open overlays, then show the confirmation modal
    setContextMenu(null);
    setManageSectionKey(null);
    setDeleteConfirmSection(section);
  }

  async function confirmDeleteSectionFolder(section: SectionRecord) {
    if (!identity?.name) return;
    setDeleteConfirmSection(null);

    // Collect all affected sub-sections and notes
    const affectedSectionKeys = sectionRecords
      .filter((s) => s.notebook_group === section.notebook_group &&
        (s.label === section.label || s.label.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)))
      .map((s) => s.key);

    const affectedNotes = managerOwnedNotes.filter(
      (note) => note.notebook_group === section.notebook_group &&
        (note.section_name === section.label || note.section_name.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)),
    );

    try {
      setSaving(true);
      setError(null);

      // 1. Delete all notes inside the folder tree
      for (const note of affectedNotes) {
        await db.one_on_one_notes.deleteById(note.id);
      }

      // 2. Delete all preference rows for this folder tree
      const prefsToDelete = preferences.filter((row) => {
        if (row.owner_name !== identity.name) return false;
        const label = row.section_label || row.section_key.split(":").slice(1).join(":");
        return row.notebook_group === section.notebook_group &&
          (label === section.label || label.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`));
      });
      for (const pref of prefsToDelete) {
        await db.notebook_section_preferences.deleteById(pref.id);
      }

      // 3. Insert tombstone rows for every affected section key so that
      //    locked built-in sections (LOCKED_TEAM_NAMES / DEFAULT_MANAGEMENT_SECTIONS)
      //    are not re-seeded by sectionRecords on the next render.
      for (const key of affectedSectionKeys) {
        const alreadyHidden = preferences.some(
          (pref) => pref.owner_name === identity.name && pref.section_key === `hidden:${key}`,
        );
        if (!alreadyHidden) {
          await db.notebook_section_preferences.insert({
            owner_name: identity.name,
            notebook_group: section.notebook_group,
            section_key: `hidden:${key}`,
            section_label: "__deleted__",
            is_favorite: false,
          });
        }
      }

      if (activeSectionKey === section.key ||
        activeSectionKey?.startsWith(`${section.notebook_group}:${section.label}${SECTION_PATH_SEPARATOR}`)) {
        setActiveSectionKey(null);
        setSelectedPageId(null);
      }
      setManageSectionKey(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function renderSectionTree(nodes: SectionTreeNode[], depth = 0): React.ReactNode {
    return nodes.map((node) => {
      const sectionLike: SectionRecord = {
        key: node.key,
        label: node.fullLabel,
        notebook_group: node.notebook_group,
        notes: node.notes,
        favorite: node.favorite,
      };
      const isActive = activeSectionKey === node.key;
      const isInlineRenaming = renameSectionKey === node.key;
      const isDraggedSection = draggedSectionKey === node.key;

      return (
        <Stack key={node.key} gap={4}>
          <Card
            withBorder
            radius="lg"
            p="sm"
            style={{
              marginLeft: depth * 12,
              cursor: "pointer",
              background: isActive ? "rgba(0, 96, 128, 0.12)" : isDraggedSection ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.01)",
              borderColor: isActive ? "rgba(0, 128, 166, 0.42)" : isDraggedSection ? "rgba(148, 163, 184, 0.26)" : undefined,
              boxShadow: isActive ? "inset 0 0 0 1px rgba(0, 128, 166, 0.12)" : undefined,
            }}
            onClick={() => setActiveSectionKey(node.key)}
            onContextMenu={(event) => openSectionContextMenu(event, sectionLike)}
            draggable
            onDragStart={(event) => {
              setDraggedSectionKey(node.key);
              event.dataTransfer.setData("application/x-folder-key", node.key);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => setDraggedSectionKey(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const folderKey = event.dataTransfer.getData("application/x-folder-key");
              if (folderKey) {
                const draggedSection = sectionRecords.find((section) => section.key === folderKey);
                if (
                  draggedSection &&
                  draggedSection.key !== node.key &&
                  !node.fullLabel.startsWith(`${draggedSection.label}${SECTION_PATH_SEPARATOR}`)
                ) {
                  void moveSectionFolder(draggedSection, node.fullLabel, node.notebook_group);
                }
                setDraggedSectionKey(null);
                return;
              }

              const noteId = Number(event.dataTransfer.getData("text/plain") || draggedNoteId || 0);
              const note = managerOwnedNotes.find((item) => item.id === noteId);
              if (note) void moveNoteToSection(note, node.key);
            }}
          >
            <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
              <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                <ThemeIcon size={34} radius="md" variant={isActive ? "filled" : "light"} color={node.notebook_group === "management" ? "blue" : node.notebook_group === "other" ? "orange" : "grape"}>
                  <IconFolders size={16} />
                </ThemeIcon>
                <div style={{ minWidth: 0, flex: 1 }}>
                  {isInlineRenaming ? (
                    <TextInput
                      value={renameSectionName}
                      onChange={(e) => setRenameSectionName(e.currentTarget.value)}
                      size="xs"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          void renameSectionFolder(sectionLike, renameSectionName);
                        }
                        if (e.key === "Escape") {
                          setRenameSectionKey(null);
                          setRenameSectionName("");
                        }
                      }}
                      onBlur={() => {
                        if (renameSectionName.trim()) {
                          void renameSectionFolder(sectionLike, renameSectionName);
                        } else {
                          setRenameSectionKey(null);
                          setRenameSectionName("");
                        }
                      }}
                    />
                  ) : (
                    <>
                      <Text fw={600} size="sm" truncate>{node.label}</Text>
                      <Group gap={6}>
                        <Text size="xs" c="dimmed">{node.notes.length} {node.notes.length === 1 ? "page" : "pages"}</Text>
                        {node.notes.length > 0 && (() => {
                          const openActions = tasks.filter(t => t.created_by === identity?.name && t.status !== "done" && (t.section_name === node.fullLabel || t.section_name === node.label));
                          if (openActions.length === 0) return null;
                          return <Badge size="xs" variant="light" color="yellow">{openActions.length} open</Badge>;
                        })()}
                      </Group>
                    </>
                  )}
                </div>
              </Group>

              <Group gap={2} wrap="nowrap">
                <ActionIcon
                  variant="subtle"
                  color={sectionLike.favorite ? "yellow" : "gray"}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleFavoriteSection(sectionLike);
                  }}
                >
                  {sectionLike.favorite ? <IconStarFilled size={15} /> : <IconStar size={15} />}
                </ActionIcon>
                <Menu withinPortal position="bottom-end" shadow="md">
                  <Menu.Target>
                    <ActionIcon variant="subtle" color="gray" onClick={(e) => e.stopPropagation()}>
                      <IconDotsVertical size={16} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                    <Menu.Item
                      leftSection={<IconPlus size={14} />}
                      onClick={() => {
                        setCreateSectionGroup(node.notebook_group);
                        setCreateSectionParent(node.fullLabel);
                        setCreateSectionName("");
                        setCreateSectionOpen(true);
                      }}
                    >
                      New subfolder
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconEdit size={14} />}
                      onClick={() => {
                        setRenameSectionKey(node.key);
                        setRenameSectionName(node.label);
                      }}
                    >
                      Rename inline
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconArrowsRight size={14} />}
                      onClick={() => {
                        setMoveSectionKey(node.key);
                        setMoveSectionTargetParent(null);
                        setMoveSectionOpen(true);
                      }}
                    >
                      Move folder
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      onClick={() => void deleteSectionFolder(sectionLike)}
                    >
                      Delete folder
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </Group>
          </Card>
          {node.children.length > 0 ? renderSectionTree(node.children, depth + 1) : null}
        </Stack>
      );
    });
  }

  function renderPageNode(note: NormalizedNote) {
    const active = selectedPageId === note.id;
    const notebookColor = note.notebook_group === "management" ? "blue" : note.notebook_group === "other" ? "orange" : "grape";
    const discussionCount = safeJsonArray(note.discussion_points_json).length;
    const actionCount = safeJsonArray(note.manager_action_items_json).length + safeJsonArray(note.employee_action_items_json).length;

    return (
      <Card
        key={note.id}
        withBorder
        radius="lg"
        p="sm"
        draggable
        onDragStart={(event) => {
          setDraggedNoteId(note.id);
          event.dataTransfer.setData("text/plain", String(note.id));
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => setDraggedNoteId(null)}
        onClick={() => setSelectedPageId(note.id)}
        style={{
          cursor: "pointer",
          background: active ? "rgba(0, 96, 128, 0.10)" : "rgba(255,255,255,0.015)",
          borderColor: active ? "rgba(0, 128, 166, 0.42)" : undefined,
          boxShadow: active ? "inset 0 0 0 1px rgba(0, 128, 166, 0.1)" : undefined,
        }}
      >
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <ThemeIcon size={30} radius="md" variant={active ? "filled" : "light"} color={notebookColor} style={{ flexShrink: 0, marginTop: 2 }}>
            <IconClipboardText size={14} />
          </ThemeIcon>
          <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Text fw={600} size="sm" truncate style={{ flex: 1 }}>{getNoteDisplayTitle(note)}</Text>
              <Text size="xs" c="dimmed" style={{ flexShrink: 0, whiteSpace: "nowrap" }}>{formatDate(note.meeting_date)}</Text>
            </Group>
            <Text size="xs" c="dimmed" lineClamp={1}>{note.summary_markdown || "No summary yet."}</Text>
            <Group gap={6} mt={2}>
              {note.is_archived && <Badge size="xs" variant="light" color="gray">Archived</Badge>}
              {note.parent_note_id && <Badge size="xs" variant="dot" color={notebookColor}>Subpage</Badge>}
              {discussionCount > 0 && <Text size="xs" c="dimmed">{discussionCount} topics</Text>}
              {actionCount > 0 && <Badge size="xs" variant="light" color="yellow">{actionCount} actions</Badge>}
            </Group>
          </Stack>
        </Group>
      </Card>
    );
  }

  const pagePanelTitle = search.trim()
    ? `Search results (${filteredManagerNotes.length})`
    : activeSection
      ? `${workspaceView === "team_members" ? TEAM_MEMBERS_ROOT : MY_NOTEBOOK_ROOT} · ${activeSection.label}`
      : ["Select a section in ", workspaceView === "team_members" ? TEAM_MEMBERS_ROOT : MY_NOTEBOOK_ROOT].join("");

  const workspaceSections: SectionRecord[] = sectionRecords
    .filter((section) => workspaceView === "team_members" ? section.notebook_group === "individual" : section.notebook_group !== "individual")
    .slice()
    .sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      const aRecent = a.notes.map((n) => new Date(n.updated_at ?? n.meeting_date ?? n.created_at ?? 0).getTime()).sort((x, y) => y - x)[0] ?? 0;
      const bRecent = b.notes.map((n) => new Date(n.updated_at ?? n.meeting_date ?? n.created_at ?? 0).getTime()).sort((x, y) => y - x)[0] ?? 0;
      if (aRecent !== bRecent) return bRecent - aRecent;
      return a.label.localeCompare(b.label);
    });

  void renderSectionTree;

  return (
    <WidgetFrame
      title="Notebook"
      subtitle={isManager ? `${managerOwnedNotes.length} pages · ${notebookOpenActionCount} open actions` : `${managerOwnedNotes.length} personal notes · ${myOwnTasks.length} self-created tasks`}
      icon={IconNotes}
      iconColor="grape"
      loading={loading}
      onRefresh={load}
      headerActions={isManager ? (
        <Group gap="xs">
          <Button size="xs" variant="light" color="blue" leftSection={<IconMailSpark size={14} />} loading={gmailLoading || saving} onClick={() => { void runManualGmailSync(); }}>Gmail sync</Button>
          <Button size="xs" variant="filled" color="grape" leftSection={<IconPlus size={14} />} onClick={() => { resetComposer(workspaceView === "team_members" ? "individual" : "other"); setOpenComposer(true); }}>New page</Button>
        </Group>
      ) : undefined}
    >
      <Stack gap="md">
        {error && <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">{error}</Alert>}
        {aiError && <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light">AI assistant: {aiError}</Alert>}

        {isManager ? (
          <>
            <Group gap="xs" align="center">
              <SegmentedControl
                value={managerView}
                onChange={(value) => setManagerView(value as "notebook" | "actions")}
                data={[
                  { value: "notebook", label: "Notebook" },
                  { value: "actions", label: "Action center" },
                ]}
              />
              <Tooltip label="Browse all notes">
                <ActionIcon variant="light" color="gray" size="lg" radius="md" onClick={() => setAllNotesModalOpen(true)}>
                  <IconLayoutList size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>


            {managerView === "notebook" ? (
            <Stack gap="md">
              <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 320px) minmax(300px, 360px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
                <Card withBorder radius="xl" p="md">
                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <Text fw={700} size="sm">Sections</Text>
                      <Button
                        size="xs"
                        radius="md"
                        variant="light"
                        leftSection={<IconPlus size={12} />}
                        onClick={() => { setCreateSectionGroup(workspaceView === "team_members" ? "individual" : "other"); setCreateSectionParent(null); setCreateSectionName(""); setCreateSectionOpen(true); }}
                      >
                        New
                      </Button>
                    </Group>

                    <TextInput
                      value={search}
                      onChange={(e) => setSearch(e.currentTarget.value)}
                      placeholder="Search sections or pages…"
                      leftSection={<IconSearch size={14} />}
                      radius="md"
                      size="sm"
                    />

                    <SegmentedControl
                      value={workspaceView}
                      onChange={(value) => setWorkspaceView(value as WorkspaceView)}
                      data={[
                        { value: "team_members", label: `${TEAM_MEMBERS_ROOT} (${individualSections.length})` },
                        { value: "my_notebook", label: `${MY_NOTEBOOK_ROOT} (${managementSections.length + otherSections.length})` },
                      ]}
                      fullWidth
                      size="xs"
                    />

                    <Card withBorder radius="md" p="xs" bg="rgba(255,255,255,0.01)">
                      <Stack gap="xs">
                        <Group justify="space-between" align="center">
                          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{workspaceView === "team_members" ? TEAM_MEMBERS_ROOT : MY_NOTEBOOK_ROOT}</Text>
                          <Badge size="xs" variant="light">{workspaceSections.length}</Badge>
                        </Group>
                        <ScrollArea.Autosize mah={420} offsetScrollbars>
                          <Stack gap="xs">
                            {workspaceSections.length === 0 ? (
                              <Text size="xs" c="dimmed" ta="center" py="sm">No folders yet in this workspace.</Text>
                            ) : workspaceSections.map((section) => {
                              const latestTs = section.notes
                                .map((n) => new Date(n.updated_at ?? n.meeting_date ?? n.created_at ?? 0).getTime())
                                .sort((a, b) => b - a)[0];
                              const latestLabel = latestTs ? new Date(latestTs).toLocaleDateString([], { month: "short", day: "numeric" }) : "No updates";
                              const active = activeSectionKey === section.key;
                              return (
                                <Card
                                  key={section.key}
                                  withBorder
                                  radius="md"
                                  p="xs"
                                  onClick={() => setActiveSectionKey(section.key)}
                                  style={{
                                    cursor: "pointer",
                                    background: active ? "rgba(0, 96, 128, 0.12)" : undefined,
                                    borderColor: active ? "rgba(0, 128, 166, 0.45)" : undefined,
                                  }}
                                >
                                  <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                                    <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                                      <ThemeIcon size={22} radius="sm" variant="light" color={section.notebook_group === "management" ? "blue" : section.notebook_group === "other" ? "orange" : "grape"}>
                                        <IconFolders size={12} />
                                      </ThemeIcon>
                                      <Stack gap={1} style={{ minWidth: 0 }}>
                                        <Text fw={600} size="xs" truncate>{section.label}</Text>
                                        <Group gap={6}>
                                          <Text size="xs" c="dimmed">{section.notes.length} pages</Text>
                                          <Text size="xs" c="dimmed">• Updated {latestLabel}</Text>
                                        </Group>
                                      </Stack>
                                    </Group>
                                    <ActionIcon size="xs" variant="subtle" color={section.favorite ? "yellow" : "gray"} onClick={(e) => { e.stopPropagation(); void toggleFavoriteSection(section); }}>
                                      {section.favorite ? <IconStarFilled size={12} /> : <IconStar size={12} />}
                                    </ActionIcon>
                                  </Group>
                                </Card>
                              );
                            })}
                          </Stack>
                        </ScrollArea.Autosize>
                        <Button size="xs" radius="md" variant="subtle" leftSection={<IconPlus size={11} />} onClick={() => { setCreateSectionGroup(workspaceView === "team_members" ? "individual" : "other"); setCreateSectionParent(null); setCreateSectionName(""); setCreateSectionOpen(true); }}>
                          Add folder
                        </Button>
                      </Stack>
                    </Card>
                  </Stack>
                </Card>

                <Card withBorder radius="xl" p="md">
                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <Text fw={700} size="sm" truncate style={{ maxWidth: 220 }}>{pagePanelTitle}</Text>
                      {pageList.length > 0 && <Badge variant="light" size="sm">{pageList.length}</Badge>}
                    </Group>
                    <ScrollArea.Autosize mah={660} offsetScrollbars>
                      <Stack gap="xs">
                        {!activeSection && !search.trim() ? (
                          <Stack gap="xs">
                            <Text size="xs" c="dimmed" tt="uppercase" fw={600} px={2}>Recent pages</Text>
                            {[...managerOwnedNotes]
                              .filter(n => !n.is_archived)
                              .sort((a, b) => new Date(b.meeting_date ?? b.created_at ?? 0).getTime() - new Date(a.meeting_date ?? a.created_at ?? 0).getTime())
                              .slice(0, 7)
                              .map((note) => renderPageNode(note))}
                          </Stack>
                        ) : visiblePageList.length === 0 ? (
                          <Card withBorder radius="lg" p="lg" bg="transparent">
                            <Stack align="center" gap="xs" py="sm">
                              <ThemeIcon size={32} radius="md" variant="light" color="gray"><IconNotes size={16} /></ThemeIcon>
                              <Text size="sm" c="dimmed" ta="center">{workspaceView === "team_members" ? "No summarized 1:1 pages for this team member yet." : "No pages in this section yet."}</Text>
                              <Text size="xs" c="dimmed" ta="center">{workspaceView === "team_members" ? "Pages will be created automatically from Gmail labels and note summaries." : "Pages will appear here automatically from Gmail labels or you can add one manually."}</Text>
                              <Button size="xs" variant="light" color="grape" leftSection={<IconPlus size={12} />} onClick={() => { resetComposer(workspaceView === "team_members" ? "individual" : "other"); setOpenComposer(true); }}>Add a page</Button>
                            </Stack>
                          </Card>
                        ) : visiblePageList.map((note) => renderPageNode(note))}
                        {pageList.length > visiblePageList.length && <Text size="xs" c="dimmed" ta="center">Showing {visiblePageList.length} of {pageList.length}</Text>}
                      </Stack>
                    </ScrollArea.Autosize>
                  </Stack>
                </Card>

                <Stack gap="sm">
                  {activeTeamMember && workspaceView === "team_members" && (
                    <Card withBorder radius="xl" p="md">
                      <Stack gap="md">
                        <Group justify="space-between" align="flex-start" wrap="wrap">
                          <Stack gap={2}>
                            <Text fw={700} size="sm">{activeTeamMember}</Text>
                            <Text size="xs" c="dimmed">All 1:1 summaries, action items, yearly review, recognition, achievements, and growth areas.</Text>
                          </Stack>
                          <Group gap="xs" wrap="wrap">
                            <Badge variant="light" color="grape">{memberNotes.length} summaries</Badge>
                            <Badge variant="light" color="blue">{memberTasks.filter((task) => task.status !== "done").length} open actions</Badge>
                            <Select
                              size="xs"
                              data={yearOptions}
                              value={selectedYear}
                              onChange={(value) => value && setSelectedYear(value)}
                              allowDeselect={false}
                              w={100}
                            />
                          </Group>
                        </Group>

                        {memberNotesForYear.length === 0 ? (
                          <Card withBorder radius="lg" p="md" bg="transparent">
                            <Text size="sm" c="dimmed" ta="center">No meeting history found for {activeTeamMember} in {selectedYear} yet.</Text>
                          </Card>
                        ) : (
                          <>
                            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                              <Card withBorder radius="lg" p="sm">
                                <Stack gap={4}>
                                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Overall yearly summary</Text>
                                  {annualSummaryLoading && !annualSummary ? (
                                    <Text size="sm" c="dimmed">Generating yearly review…</Text>
                                  ) : (
                                    <Text size="sm">{annualSummary?.summary || "Review will appear automatically once enough summarized notes are available."}</Text>
                                  )}
                                </Stack>
                              </Card>
                              <Card withBorder radius="lg" p="sm">
                                <Stack gap={4}>
                                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Recognition & achievements</Text>
                                  {[...(annualSummary?.recognition ?? []), ...(annualSummary?.achievements ?? [])].slice(0, 6).map((item, index) => (
                                    <Text key={`recognition-${index}`} size="sm">• {item}</Text>
                                  ))}
                                  {!(annualSummary?.recognition?.length || annualSummary?.achievements?.length) && <Text size="sm" c="dimmed">No clear recognition themes yet.</Text>}
                                </Stack>
                              </Card>
                              <Card withBorder radius="lg" p="sm">
                                <Stack gap={4}>
                                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Feedback</Text>
                                  {(annualSummary?.feedback ?? []).slice(0, 6).map((item, index) => (
                                    <Text key={`feedback-${index}`} size="sm">• {item}</Text>
                                  ))}
                                  {!annualSummary?.feedback?.length && <Text size="sm" c="dimmed">No repeated feedback themes detected yet.</Text>}
                                </Stack>
                              </Card>
                              <Card withBorder radius="lg" p="sm">
                                <Stack gap={4}>
                                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Areas of improvement</Text>
                                  {(annualSummary?.improvements ?? []).slice(0, 6).map((item, index) => (
                                    <Text key={`improvement-${index}`} size="sm">• {item}</Text>
                                  ))}
                                  {!annualSummary?.improvements?.length && <Text size="sm" c="dimmed">No recurring improvement themes detected yet.</Text>}
                                </Stack>
                              </Card>
                            </SimpleGrid>

                            <Card withBorder radius="lg" p="sm">
                              <Stack gap={4}>
                                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Action items</Text>
                                {memberTasks.length > 0 ? memberTasks.slice(0, 8).map((task) => (
                                  <Group key={task.id} justify="space-between" gap="xs" wrap="nowrap">
                                    <Text size="sm" style={{ flex: 1 }}>• {task.title}</Text>
                                    <Badge size="xs" variant="light" color={task.status === "done" ? "green" : task.status === "blocked" ? "red" : task.status === "in_progress" ? "blue" : "yellow"}>{task.status}</Badge>
                                  </Group>
                                )) : <Text size="sm" c="dimmed">No action items extracted for this team member yet.</Text>}
                              </Stack>
                            </Card>
                          </>
                        )}
                      </Stack>
                    </Card>
                  )}

                  {selectedNote ? (
                    <>
                      <Card withBorder radius="xl" p="sm">
                        <Group justify="space-between" align="center" gap="sm" wrap="nowrap">
                          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                            {!(selectedNote.notebook_group === "other" && selectedNote.title.trim().toLowerCase() === "quick note") && (
                              <Text fw={700} size="sm" truncate>{getNoteDisplayTitle(selectedNote)}</Text>
                            )}
                            {(isManager || selectedNote.notebook_group !== "other") && (
                              <Group gap={6}>
                                <Badge size="xs" variant="light" color={selectedNote.notebook_group === "management" ? "blue" : selectedNote.notebook_group === "other" ? "orange" : "grape"}>{selectedNote.section_name}</Badge>
                                {selectedNote.is_archived && <Badge size="xs" variant="light" color="gray">Archived</Badge>}
                                {selectedNote.meeting_date && <Text size="xs" c="dimmed">{formatDate(selectedNote.meeting_date)}</Text>}
                              </Group>
                            )}
                          </Stack>
                          <Group gap={4} wrap="nowrap">
                            <Button size="xs" radius="md" variant="light" onClick={() => { populateComposer(selectedNote); setOpenComposer(true); }}>Edit</Button>
                            {isManager && <Button size="xs" radius="md" variant="subtle" onClick={() => { populateComposer(selectedNote, true); setOpenComposer(true); }}>+ Subpage</Button>}
                            {isManager && <Button size="xs" radius="md" variant="subtle" color="gray" onClick={() => void archiveNote(selectedNote, !selectedNote.is_archived)}>{selectedNote.is_archived ? "Restore" : "Archive"}</Button>}
                            <ActionIcon size="sm" color="red" variant="subtle" onClick={() => void deleteNote(selectedNote)}><IconTrash size={14} /></ActionIcon>
                          </Group>
                        </Group>
                      </Card>
                      <DetailCard note={selectedNote} managerView />
                    </>
                  ) : (
                    <Card withBorder radius="xl" p="xl" style={{ background: "transparent" }}>
                      <Stack gap="xs" align="center" py="lg">
                        <ThemeIcon size={40} radius="xl" variant="light" color="grape">
                          <IconNotes size={20} />
                        </ThemeIcon>
                        <Text fw={600} size="sm">Pick a page to view</Text>
                        <Text size="xs" c="dimmed" ta="center">Select a section, then click any page card to see its summary and actions here.</Text>
                      </Stack>
                    </Card>
                  )}
                </Stack>
              </div>
            </Stack>
            ) : (
              <Stack gap="md">
                {/* ── Action Center nav ── */}
                {(() => {
                  const total = managerTaskRows.length;
                  const done = managerTaskRows.filter(t => t.status === "done").length;
                  const inProgress = managerTaskRows.filter(t => t.status === "in_progress").length;
                  const open = managerTaskRows.filter(t => t.status === "open").length;
                  const overdue = managerTaskRows.filter(t => isOverdue(t)).length;
                  const pctDone = total > 0 ? Math.round((done / total) * 100) : 0;

                  // ── Scorecard data ──────────────────────────────────────
                  const peopleNames = PERSON_TEAM_NAMES.filter(name => defaultRoleFor(name) !== "manager");
                  const scorecardRows = peopleNames.map(person => {
                    const personNotes = managerOwnedNotes.filter(n => n.section_name === person || n.employee_name === person);
                    const personTasks = managerTaskRows.filter(t => (t.owner_name ?? t.employee_name) === person);
                    const personDone = personTasks.filter(t => t.status === "done").length;
                    const personOpen = personTasks.filter(t => t.status !== "done").length;
                    const personOverdue = personTasks.filter(t => isOverdue(t)).length;
                    const lastNote = personNotes.sort((a, b) => new Date(b.meeting_date ?? b.created_at).getTime() - new Date(a.meeting_date ?? a.created_at).getTime())[0];
                    const lastMet = lastNote?.meeting_date ?? null;
                    const daysSinceMeeting = lastMet ? Math.floor((Date.now() - new Date(lastMet).getTime()) / 86400000) : null;
                    const completionRate = personTasks.length > 0 ? Math.round((personDone / personTasks.length) * 100) : null;
                    const stale = personTasks.filter(t => t.status !== "done" && t.created_at && Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000) >= 21).length;
                    return { person, personNotes, personTasks, personDone, personOpen, personOverdue, lastMet, daysSinceMeeting, completionRate, stale };
                  }).filter(r => r.personNotes.length > 0 || r.personTasks.length > 0);



                  return (
                    <>
                      {/* Stats bar */}
                      <Card withBorder radius="lg" p="sm">
                        <Group gap="lg" align="center" wrap="wrap">
                          <Group gap="lg" wrap="wrap" style={{ flex: 1 }}>
                            <Group gap={6}><Text size="sm" fw={700} c="dimmed" ff="monospace">{open}</Text><Text size="xs" c="dimmed">Open</Text></Group>
                            <Group gap={6}><Text size="sm" fw={700} c="blue" ff="monospace">{inProgress}</Text><Text size="xs" c="dimmed">In Progress</Text></Group>
                            <Group gap={6}><Text size="sm" fw={700} c="green" ff="monospace">{done}</Text><Text size="xs" c="dimmed">Done</Text></Group>
                            {overdue > 0 && <Group gap={6}><Text size="sm" fw={700} c="red" ff="monospace">{overdue}</Text><Text size="xs" c="red">Overdue</Text></Group>}
                          </Group>
                          <Text size="xs" c="dimmed" fw={600}>{pctDone}% complete</Text>
                        </Group>
                        <Progress.Root size="xs" radius="xl" mt={8}>
                          <Progress.Section value={total > 0 ? (done / total) * 100 : 0} color="green" />
                          <Progress.Section value={total > 0 ? (inProgress / total) * 100 : 0} color="blue" />
                          <Progress.Section value={total > 0 ? (open / total) * 100 : 0} color="gray.6" />
                        </Progress.Root>
                      </Card>

                      {/* Sub-view nav */}
                      <SegmentedControl
                        value={actionSubView}
                        onChange={(v) => setActionSubView(v as typeof actionSubView)}
                        data={[
                          { value: "tasks", label: "📋 Tasks" },
                          { value: "scorecard", label: "📊 Scorecard" },
                          { value: "insights", label: "🤖 AI Insights" },
                        ]}
                      />

                      {/* ── TASKS view ─────────────────────────────────── */}
                      {actionSubView === "tasks" && (
                        <Stack gap="xl">
                          {/* ── Toolbar ── */}
                          {extractDebug && (
                            <Alert color="teal" variant="light" radius="md" withCloseButton onClose={() => setExtractDebug(null)}>
                              <Text size="xs" style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>{extractDebug}</Text>
                            </Alert>
                          )}
                          <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                            <Group gap="xs" wrap="wrap">
                              <Button size="sm" variant="light" color="grape" leftSection={<IconSparkles size={14} />} onClick={() => void extractAllTasks()} loading={saving}>Extract all</Button>
                              <Button size="sm" variant="light" color="teal" leftSection={<IconBrandSlack size={14} />} onClick={() => void sendSlackDigest()} loading={digestSending}>Send digest</Button>
                              <Button size="sm" variant="light" color="violet" leftSection={<IconSparkles size={14} />} onClick={() => void reviewDuplicateTasks()} loading={duplicateReviewLoading}>Review duplicates</Button>
                              <Button size="sm" variant={dueThisWeek ? "filled" : "light"} color="orange" leftSection={<IconCalendar size={14} />} onClick={() => setDueThisWeek(v => !v)}>
                                Due this week
                              </Button>
                              {selectedTaskIds.size > 0 && (
                                <>
                                  <Select
                                    size="sm"
                                    placeholder="Reassign to…"
                                    data={Array.from(new Set(managerTaskRows.map(t => storedOwner(t)).filter(n => n && PERSON_TEAM_NAMES.includes(n)))).sort().map(n => ({ value: n, label: n }))}
                                    value={bulkAssignOwner}
                                    onChange={v => {
                                      if (!v) return;
                                      setBulkAssignOwner(null);
                                      setTasks(prev => prev.map(t => selectedTaskIds.has(t.id) ? { ...t, owner_name: v, employee_name: v } : t));
                                      for (const id of selectedTaskIds) void db.personal_action_items.updateById(id, { owner_name: v, employee_name: v });
                                      setSelectedTaskIds(new Set());
                                    }}
                                    searchable
                                    allowDeselect={false}
                                    style={{ width: 180 }}
                                  />
                                  <Button size="sm" variant="filled" color="green" leftSection={<IconChecklist size={14} />} onClick={() => void markSelectedDone()} loading={saving}>
                                    Mark {selectedTaskIds.size} done
                                  </Button>
                                  <Button size="sm" variant="filled" color="red" leftSection={<IconTrash size={14} />} onClick={() => deleteSelectedTasks()}>
                                    Delete {selectedTaskIds.size}
                                  </Button>
                                </>
                              )}
                            </Group>
                          </Group>

                          {/* ── Filters ── */}
                          <Group gap="sm" wrap="wrap">
                            <Select size="sm" placeholder="All statuses" data={[{ value: "all", label: "All statuses" }, { value: "active", label: "Active (not done)" }, { value: "stale", label: "Stale (21+ days)" }, ...TASK_STATUS_OPTIONS]} value={taskStatusFilter} onChange={v => setTaskStatusFilter(v || "active")} allowDeselect={false} style={{ width: 185 }} />
                            <Select size="sm" placeholder="All priorities" data={[{ value: "all", label: "All priorities" }, ...TASK_PRIORITY_OPTIONS]} value={taskPriorityFilter} onChange={v => setTaskPriorityFilter(v || "all")} allowDeselect={false} style={{ width: 150 }} />
                            <TextInput size="sm" value={search} onChange={e => setSearch(e.currentTarget.value)} placeholder="Search tasks…" leftSection={<IconSearch size={14} />} style={{ flex: 1, minWidth: 160 }} />
                          </Group>

                          {/* ── MY tasks section ── */}
                          {(() => {
                            const myFiltered = myManagerTasksClean.filter(task => {
                              const statusOk = taskStatusFilter === "all" || (taskStatusFilter === "active" ? (task.status !== "done" && task.status !== "duplicate") : taskStatusFilter === "stale" ? (task.status !== "done" && !!task.created_at && Math.floor((Date.now() - new Date(task.created_at).getTime()) / 86400000) >= 21) : task.status === taskStatusFilter);
                              const priorityOk = taskPriorityFilter === "all" || (task.priority ?? "medium") === taskPriorityFilter;
                              const textOk = !search.trim() || `${task.title} ${task.details ?? ""}`.toLowerCase().includes(search.trim().toLowerCase());
                              const dueOk = !dueThisWeek || (!!task.due_date && task.due_date <= WEEK_FROM_NOW);
                              return statusOk && priorityOk && textOk && dueOk;
                            });
                            return (
                              <Stack gap="sm">
                                <Group justify="space-between" align="center">
                                  <Stack gap={2}>
                                    <Text fw={700} size="sm">My tasks</Text>
                                    <Text size="xs" c="dimmed">Action items from management &amp; other notes that you own</Text>
                                  </Stack>
                                  <Group gap="xs">
                                    {myFiltered.filter(t => isOverdue(t)).length > 0 && <Badge color="red" variant="light" size="sm">{myFiltered.filter(t => isOverdue(t)).length} overdue</Badge>}
                                    <Badge variant="light" size="sm">{myFiltered.length}</Badge>
                                  </Group>
                                </Group>
                                <Card withBorder radius="lg" p={0}>
                                  <Table highlightOnHover horizontalSpacing="md" verticalSpacing="xs" withRowBorders={false}>
                                    <Table.Thead>
                                      <Table.Tr>
                                        <Table.Th style={{ width: 32 }}><Checkbox size="xs" checked={myFiltered.length > 0 && myFiltered.every(t => selectedTaskIds.has(t.id))} onChange={e => { const n = new Set(selectedTaskIds); myFiltered.forEach(t => e.currentTarget.checked ? n.add(t.id) : n.delete(t.id)); setSelectedTaskIds(n); }} /></Table.Th>
                                        <Table.Th>Task</Table.Th>
                                        <Table.Th>Owner</Table.Th>
                                        <Table.Th>Priority</Table.Th>
                                        <Table.Th>Status</Table.Th>
                                        <Table.Th>Due</Table.Th>
                                        <Table.Th />
                                      </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                      {myFiltered.length === 0 ? (
                                        <Table.Tr><Table.Td colSpan={7}><Text size="sm" c="dimmed" ta="center" py="sm">No tasks match your filters.</Text></Table.Td></Table.Tr>
                                      ) : myFiltered.map(task => (
                                        <TaskRow key={task.id}
                                          task={task}
                                          isSelected={selectedTaskIds.has(task.id)}
                                          importance={importanceMap.get(task.title.toLowerCase().trim())}
                                          hasNote={!!task.note_id && noteMap.has(task.note_id)}
                                          showOwnerCol={true}
                                          onUpdate={onTaskUpdate}
                                          onDelete={onTaskDelete}
                                          onToggleSelect={onTaskToggle}
                                          onJumpToNote={onJumpToNote}
                                        />
                                      ))}
                                    </Table.Tbody>
                                  </Table>
                                </Card>
                              </Stack>
                            );
                          })()}

                          {/* ── TEAM action items ── */}
                          {(() => {
                            const teamFiltered = allTeamTasks.filter(task => {
                              const statusOk = taskStatusFilter === "all" || (taskStatusFilter === "active" ? (task.status !== "done" && task.status !== "duplicate") : taskStatusFilter === "stale" ? (task.status !== "done" && !!task.created_at && Math.floor((Date.now() - new Date(task.created_at).getTime()) / 86400000) >= 21) : task.status === taskStatusFilter);
                              const priorityOk = taskPriorityFilter === "all" || (task.priority ?? "medium") === taskPriorityFilter;
                              const textOk = !search.trim() || `${task.title} ${task.details ?? ""}`.toLowerCase().includes(search.trim().toLowerCase());
                              const dueOk = !dueThisWeek || (!!task.due_date && task.due_date <= WEEK_FROM_NOW);
                              return statusOk && priorityOk && textOk && dueOk;
                            });
                            const groupedByOwner = groupByPerson
                              ? Array.from(new Set(teamFiltered.map(t => t.owner_name ?? t.section_name ?? t.employee_name))).sort()
                              : null;
                            return (
                              <Stack gap="sm">
                                <Group justify="space-between" align="center">
                                  <Stack gap={2}>
                                    <Text fw={700} size="sm">Team action items</Text>
                                    <Text size="xs" c="dimmed">Action items extracted from 1:1 meeting notes, assigned to team members</Text>
                                  </Stack>
                                  <Group gap="xs">
                                    {teamFiltered.filter(t => isOverdue(t)).length > 0 && <Badge color="red" variant="light" size="sm">{teamFiltered.filter(t => isOverdue(t)).length} overdue</Badge>}
                                    <Badge variant="light" color="blue" size="sm">{teamFiltered.length}</Badge>
                                  </Group>
                                </Group>
                                {groupedByOwner ? (
                                  <Stack gap="md">
                                    {groupedByOwner.map(owner => {
                                      const ownerTasks = teamFiltered.filter(t => (t.owner_name ?? t.section_name ?? t.employee_name) === owner);
                                      const ownerOverdue = ownerTasks.filter(t => isOverdue(t)).length;
                                      return (
                                        <Card key={owner} withBorder radius="lg" p={0}>
                                          <Group px="md" py="sm" gap="xs">
                                            <ThemeIcon size="sm" variant="light" color="blue" radius="xl"><IconUser size={12} /></ThemeIcon>
                                            <Text fw={700} size="sm">{owner}</Text>
                                            <Badge size="sm" variant="light" color="gray">{ownerTasks.length}</Badge>
                                            {ownerOverdue > 0 && <Badge size="sm" variant="light" color="red" leftSection={<IconAlertTriangle size={10} />}>{ownerOverdue} overdue</Badge>}
                                            <Button size="xs" variant="subtle" color="grape" leftSection={<IconSparkles size={11} />} ml="auto" onClick={() => void generatePrep(owner)}>Prep 1:1</Button>
                                          </Group>
                                          <Divider />
                                          <Table highlightOnHover horizontalSpacing="md" verticalSpacing="xs" withRowBorders={false}>
                                            <Table.Thead>
                                              <Table.Tr>
                                                <Table.Th style={{ width: 32 }} />
                                                <Table.Th>Task</Table.Th>
                                                <Table.Th>Owner</Table.Th>
                                                <Table.Th>Priority</Table.Th>
                                                <Table.Th>Status</Table.Th>
                                                <Table.Th>Due</Table.Th>
                                                <Table.Th />
                                              </Table.Tr>
                                            </Table.Thead>
                                            <Table.Tbody>
                                              {ownerTasks.map(task => (
                                                <TaskRow key={task.id}
                                                  task={task}
                                                  isSelected={selectedTaskIds.has(task.id)}
                                                  importance={importanceMap.get(task.title.toLowerCase().trim())}
                                                  hasNote={!!task.note_id && noteMap.has(task.note_id)}
                                                  showOwnerCol={true}
                                                  onUpdate={onTaskUpdate}
                                                  onDelete={onTaskDelete}
                                                  onToggleSelect={onTaskToggle}
                                                  onJumpToNote={onJumpToNote}
                                                />
                                              ))}
                                            </Table.Tbody>
                                          </Table>
                                        </Card>
                                      );
                                    })}
                                  </Stack>
                                ) : (
                                  <Card withBorder radius="lg" p={0}>
                                    <Table highlightOnHover horizontalSpacing="md" verticalSpacing="xs" withRowBorders={false}>
                                      <Table.Thead>
                                        <Table.Tr>
                                          <Table.Th style={{ width: 32 }}><Checkbox size="xs" checked={teamFiltered.length > 0 && teamFiltered.every(t => selectedTaskIds.has(t.id))} onChange={e => { const n = new Set(selectedTaskIds); teamFiltered.forEach(t => e.currentTarget.checked ? n.add(t.id) : n.delete(t.id)); setSelectedTaskIds(n); }} /></Table.Th>
                                          <Table.Th>Task</Table.Th>
                                          <Table.Th>Owner</Table.Th>
                                          <Table.Th>Priority</Table.Th>
                                          <Table.Th>Status</Table.Th>
                                          <Table.Th>Due</Table.Th>
                                          <Table.Th />
                                        </Table.Tr>
                                      </Table.Thead>
                                      <Table.Tbody>
                                        {teamFiltered.length === 0 ? (
                                          <Table.Tr><Table.Td colSpan={7}><Text size="sm" c="dimmed" ta="center" py="sm">No team tasks match your filters.</Text></Table.Td></Table.Tr>
                                        ) : teamFiltered.map(task => (
                                          <TaskRow key={task.id}
                                            task={task}
                                            isSelected={selectedTaskIds.has(task.id)}
                                            importance={importanceMap.get(task.title.toLowerCase().trim())}
                                            hasNote={!!task.note_id && noteMap.has(task.note_id)}
                                            showOwnerCol={true}
                                            onUpdate={onTaskUpdate}
                                            onDelete={onTaskDelete}
                                            onToggleSelect={onTaskToggle}
                                            onJumpToNote={onJumpToNote}
                                          />
                                        ))}
                                      </Table.Tbody>
                                    </Table>
                                  </Card>
                                )}
                              </Stack>
                            );
                          })()}

                          {/* ── AI Importance Analysis Panel ── */}
                          {importanceAnalysis && showImportancePanel && (() => {
                            const critical = importanceAnalysis.classifications.filter(c => c.importance === "critical");
                            const important = importanceAnalysis.classifications.filter(c => c.importance === "important");
                            const low = importanceAnalysis.classifications.filter(c => c.importance === "low");
                            return (
                              <Card withBorder radius="lg" p="md" style={{ borderLeft: "3px solid var(--mantine-color-violet-5)", background: "rgba(124,58,237,0.04)" }}>
                                <Stack gap="md">
                                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                                    <Group gap="sm" align="center">
                                      <ThemeIcon size="md" radius="md" variant="filled" color="violet"><IconSparkles size={14} /></ThemeIcon>
                                      <Stack gap={2}>
                                        <Text fw={700} size="sm">AI Importance Analysis</Text>
                                        <Text size="xs" c="dimmed">{managerTaskRows.filter(t => t.status !== "done").length} open tasks analysed</Text>
                                      </Stack>
                                    </Group>
                                    <Group gap="xs">
                                      <Badge color="red" variant="filled" size="sm">{critical.length} critical</Badge>
                                      <Badge color="yellow" variant="filled" size="sm">{important.length} important</Badge>
                                      <Badge color="gray" variant="light" size="sm">{low.length} low</Badge>
                                    </Group>
                                  </Group>

                                  <Text size="sm" style={{ lineHeight: 1.6 }}>{importanceAnalysis.summary}</Text>

                                  {critical.length > 0 && (
                                    <Stack gap="xs">
                                      <Group gap="xs">
                                        <Badge color="red" variant="filled" size="xs" leftSection="🔴">Critical — act now</Badge>
                                      </Group>
                                      {critical.map((c, i) => (
                                        <Card key={i} withBorder radius="md" p="sm" style={{ borderLeft: "3px solid var(--mantine-color-red-5)", background: "rgba(250,82,82,0.06)" }}>
                                          <Group gap="sm" align="flex-start" wrap="nowrap">
                                            <Text size="sm" fw={700} style={{ flex: 1 }}>{c.title}</Text>
                                            <Text size="xs" c="dimmed" style={{ flexShrink: 0, maxWidth: 300 }}>{c.reason}</Text>
                                          </Group>
                                        </Card>
                                      ))}
                                    </Stack>
                                  )}

                                  {important.length > 0 && (
                                    <Stack gap="xs">
                                      <Badge color="yellow" variant="filled" size="xs" leftSection="🟡">Important — schedule soon</Badge>
                                      {important.map((c, i) => (
                                        <Card key={i} withBorder radius="md" p="sm" style={{ borderLeft: "3px solid var(--mantine-color-yellow-5)", background: "rgba(250,176,5,0.06)" }}>
                                          <Group gap="sm" align="flex-start" wrap="nowrap">
                                            <Text size="sm" fw={700} style={{ flex: 1 }}>{c.title}</Text>
                                            <Text size="xs" c="dimmed" style={{ flexShrink: 0, maxWidth: 300 }}>{c.reason}</Text>
                                          </Group>
                                        </Card>
                                      ))}
                                    </Stack>
                                  )}

                                  {low.length > 0 && (
                                    <Stack gap="xs">
                                      <Badge color="gray" variant="light" size="xs" leftSection="⚪">Low priority — can defer</Badge>
                                      {low.map((c, i) => (
                                        <Card key={i} withBorder radius="md" p="sm" style={{ background: "rgba(255,255,255,0.02)" }}>
                                          <Group gap="sm" align="flex-start" wrap="nowrap">
                                            <Text size="sm" c="dimmed" style={{ flex: 1 }}>{c.title}</Text>
                                            <Text size="xs" c="dimmed" style={{ flexShrink: 0, maxWidth: 300 }}>{c.reason}</Text>
                                          </Group>
                                        </Card>
                                      ))}
                                    </Stack>
                                  )}
                                </Stack>
                              </Card>
                            );
                          })()}


                        </Stack>
                      )}

                      {/* ── KANBAN view ────────────────────────────────── */}
                      {/* ── SCORECARD view ─────────────────────────────── */}
                      {actionSubView === "scorecard" && (
                        <Stack gap="md">
                          <Group justify="space-between" align="center">
                            <Text size="sm" c="dimmed">Showing {scorecardRows.length} team members with meeting history or tasks</Text>
                            <Button size="sm" variant="light" color="teal" leftSection={<IconBrandSlack size={14} />} onClick={() => void sendSlackDigest()} loading={digestSending}>Send digest</Button>
                          </Group>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
                            {scorecardRows.map(({ person, personNotes, personDone, personOpen, personOverdue, daysSinceMeeting, completionRate, stale }) => {
                              const healthColor = personOverdue > 1 || stale > 2 ? "red" : personOverdue > 0 || stale > 0 ? "yellow" : "green";
                              const healthLabel = healthColor === "red" ? "At risk" : healthColor === "yellow" ? "Watch" : "Healthy";
                              return (
                                <Card key={person} withBorder radius="lg" p="md">
                                  <Stack gap="sm">
                                    <Group justify="space-between" align="flex-start">
                                      <Group gap="sm">
                                        <ThemeIcon size={36} radius="xl" variant="light" color="grape"><IconUser size={18} /></ThemeIcon>
                                        <Stack gap={2}>
                                          <Text fw={700} size="sm">{person}</Text>
                                          <Text size="xs" c="dimmed">{personNotes.length} note{personNotes.length === 1 ? "" : "s"}</Text>
                                        </Stack>
                                      </Group>
                                      <Badge color={healthColor} variant="light" size="sm">{healthLabel}</Badge>
                                    </Group>

                                    <SimpleGrid cols={3} spacing="xs">
                                      <Card withBorder radius="md" p="xs" style={{ textAlign: "center" }}>
                                        <Text fw={800} size="lg" c="gray" ff="monospace">{personOpen}</Text>
                                        <Text size="xs" c="dimmed">Open</Text>
                                      </Card>
                                      <Card withBorder radius="md" p="xs" style={{ textAlign: "center" }}>
                                        <Text fw={800} size="lg" c="green" ff="monospace">{personDone}</Text>
                                        <Text size="xs" c="dimmed">Done</Text>
                                      </Card>
                                      <Card withBorder radius="md" p="xs" style={{ textAlign: "center" }}>
                                        <Text fw={800} size="lg" c={personOverdue > 0 ? "red" : "dimmed"} ff="monospace">{personOverdue}</Text>
                                        <Text size="xs" c="dimmed">Overdue</Text>
                                      </Card>
                                    </SimpleGrid>

                                    <Stack gap={4}>
                                      {completionRate !== null && (
                                        <Group justify="space-between"><Text size="xs" c="dimmed">Completion rate</Text><Text size="xs" fw={600}>{completionRate}%</Text></Group>
                                      )}
                                      {stale > 0 && (
                                        <Group justify="space-between"><Text size="xs" c="orange">Carry-forward tasks</Text><Badge size="xs" color="orange" variant="light">{stale}</Badge></Group>
                                      )}
                                      {daysSinceMeeting !== null && (
                                        <Group justify="space-between">
                                          <Text size="xs" c="dimmed">Last 1:1</Text>
                                          <Badge size="xs" color={daysSinceMeeting > 21 ? "red" : daysSinceMeeting > 14 ? "yellow" : "green"} variant="light">{daysSinceMeeting === 0 ? "Today" : `${daysSinceMeeting}d ago`}</Badge>
                                        </Group>
                                      )}
                                    </Stack>

                                    {completionRate !== null && (
                                      <Progress value={completionRate} color={completionRate >= 70 ? "green" : completionRate >= 40 ? "yellow" : "red"} size="sm" radius="xl" />
                                    )}

                                    <Button size="xs" variant="light" color="grape" leftSection={<IconSparkles size={12} />} onClick={() => void generatePrep(person)} loading={prepLoading && prepPerson === person} fullWidth>
                                      Prep 1:1 with {person.split(" ")[0]}
                                    </Button>
                                  </Stack>
                                </Card>
                              );
                            })}
                            {scorecardRows.length === 0 && (
                              <Card withBorder radius="lg" p="xl">
                                <Text size="sm" c="dimmed" ta="center">No team members with notes yet. Start by creating 1:1 notes from the Notebook tab.</Text>
                              </Card>
                            )}
                          </div>
                        </Stack>
                      )}

                      {/* ── AI INSIGHTS view ───────────────────────────── */}
                      {actionSubView === "insights" && (
                        <Stack gap="md">
                          {/* Importance analysis button lives here */}
                          <Group gap="xs">
                            <Button size="sm" variant={importanceAnalysis ? "filled" : "light"} color="violet" leftSection={<IconSparkles size={14} />} onClick={() => void analyseTaskImportance()}>
                              {importanceAnalysis ? "Re-analyse importance" : "Analyse task importance"}
                            </Button>
                            {importanceAnalysis && (
                              <Button size="sm" variant="subtle" color="gray" onClick={() => setShowImportancePanel(v => !v)}>
                                {showImportancePanel ? "Hide analysis" : "Show analysis"}
                              </Button>
                            )}
                          </Group>
                          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                            {/* Pattern detector */}
                            <Card withBorder radius="lg" p="md">
                              <Stack gap="sm">
                                <Group justify="space-between" align="flex-start">
                                  <Stack gap={2}>
                                    <Text fw={700} size="sm">🔍 Pattern Detector</Text>
                                    <Text size="xs" c="dimmed">AI scans all tasks for recurring themes, carry-over risks, and bottlenecks</Text>
                                  </Stack>
                                  <Button size="xs" variant="light" color="grape" leftSection={<IconSparkles size={12} />} onClick={() => void detectPatterns()} loading={patternLoading}>
                                    Analyze
                                  </Button>
                                </Group>
                                {patternResult ? (
                                  <ScrollArea.Autosize mah={320}>
                                    <Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{patternResult}</Text>
                                  </ScrollArea.Autosize>
                                ) : (
                                  <Card withBorder radius="md" p="md" bg="transparent">
                                    <Text size="xs" c="dimmed" ta="center">Click Analyze to scan {managerTaskRows.length} tasks for patterns and risk signals</Text>
                                  </Card>
                                )}
                              </Stack>
                            </Card>

                            {/* Weekly summary */}
                            <Card withBorder radius="lg" p="md">
                              <Stack gap="sm">
                                <Group justify="space-between" align="flex-start">
                                  <Stack gap={2}>
                                    <Text fw={700} size="sm">📝 Weekly Summary</Text>
                                    <Text size="xs" c="dimmed">AI drafts a manager update paragraph — paste into Slack or email</Text>
                                  </Stack>
                                  <Button size="xs" variant="light" color="blue" leftSection={<IconSparkles size={12} />} onClick={() => void generateWeeklySummary()} loading={weeklyLoading}>
                                    Generate
                                  </Button>
                                </Group>
                                {weeklyResult ? (
                                  <Stack gap="xs">
                                    <ScrollArea.Autosize mah={280}>
                                      <Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{weeklyResult}</Text>
                                    </ScrollArea.Autosize>
                                    <Button size="xs" variant="subtle" color="teal" leftSection={<IconBrandSlack size={12} />} onClick={() => void postSlackMessage(weeklyResult, { username: "Weekly Summary", icon_emoji: ":memo:" })}>Post to Slack</Button>
                                  </Stack>
                                ) : (
                                  <Card withBorder radius="md" p="md" bg="transparent">
                                    <Text size="xs" c="dimmed" ta="center">Summarizes this week's completed and open tasks into a shareable update</Text>
                                  </Card>
                                )}
                              </Stack>
                            </Card>
                          </SimpleGrid>

                          {/* Pre-1:1 Prep picker */}
                          <Card withBorder radius="lg" p="md">
                            <Stack gap="sm">
                              <Group justify="space-between" align="flex-start">
                                <Stack gap={2}>
                                  <Text fw={700} size="sm">🎯 Pre-1:1 Meeting Prep</Text>
                                  <Text size="xs" c="dimmed">AI reads the last 5 notes + open tasks for a person and generates a focused meeting brief</Text>
                                </Stack>
                              </Group>
                              <Group gap="sm" wrap="wrap">
                                {PERSON_TEAM_NAMES.filter(n => defaultRoleFor(n) !== "manager").map(name => (
                                  <Button key={name} size="xs" variant={prepPerson === name ? "filled" : "light"} color="grape" onClick={() => void generatePrep(name)} loading={prepLoading && prepPerson === name}>
                                    {name.split(" ")[0]}
                                  </Button>
                                ))}
                              </Group>
                              {prepResult && prepPerson && (
                                <Card withBorder radius="md" p="md" style={{ background: "rgba(132,94,194,0.06)" }}>
                                  <Stack gap="xs">
                                    <Group justify="space-between">
                                      <Text fw={700} size="sm">Brief for {prepPerson}</Text>
                                      <Button size="xs" variant="subtle" color="teal" leftSection={<IconBrandSlack size={12} />} onClick={() => void postSlackMessage(`*Pre-1:1 Brief — ${prepPerson}*\n\n${prepResult}`, { username: "Meeting Prep", icon_emoji: ":dart:" })}>Post to Slack</Button>
                                    </Group>
                                    <ScrollArea.Autosize mah={360}>
                                      <Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{prepResult}</Text>
                                    </ScrollArea.Autosize>
                                  </Stack>
                                </Card>
                              )}
                              {prepLoading && !prepResult && (
                                <Card withBorder radius="md" p="md" bg="transparent">
                                  <Text size="xs" c="dimmed" ta="center">Generating meeting brief for {prepPerson}…</Text>
                                </Card>
                              )}
                            </Stack>
                          </Card>

                          {/* Carry-forward escalation list */}
                          {(() => {
                            const staleTasks = managerTaskRows.filter(t => t.status !== "done" && t.created_at && Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000) >= 21).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                            if (staleTasks.length === 0) return null;
                            return (
                              <Card withBorder radius="lg" p="md" style={{ borderColor: "var(--mantine-color-orange-6)" }}>
                                <Stack gap="sm">
                                  <Group gap="xs">
                                    <IconAlertTriangle size={16} color="var(--mantine-color-orange-5)" />
                                    <Text fw={700} size="sm" c="orange">Carry-forward escalation — {staleTasks.length} tasks open 21+ days</Text>
                                    <Badge color="orange" variant="light" size="sm">{staleTasks.length}</Badge>
                                  </Group>
                                  <Table horizontalSpacing="md" verticalSpacing="xs" withRowBorders={false}>
                                    <Table.Thead><Table.Tr><Table.Th>Task</Table.Th><Table.Th>Owner</Table.Th><Table.Th>Days open</Table.Th><Table.Th>Priority</Table.Th><Table.Th /></Table.Tr></Table.Thead>
                                    <Table.Tbody>
                                      {staleTasks.slice(0, 10).map((task: PersonalActionItem) => {
                                        const daysOpen = Math.floor((Date.now() - new Date(task.created_at).getTime()) / 86400000);
                                        return (
                                          <Table.Tr key={task.id}>
                                            <Table.Td><Text fw={600} size="sm">{task.title}</Text></Table.Td>
                                            <Table.Td><Text size="sm">{task.owner_name ?? task.employee_name}</Text></Table.Td>
                                            <Table.Td><Badge color={daysOpen >= 42 ? "red" : "orange"} variant="light" size="sm">{daysOpen}d</Badge></Table.Td>
                                            <Table.Td><Badge color={task.priority === "high" ? "red" : task.priority === "low" ? "gray" : "yellow"} variant="light" size="sm">{task.priority ?? "medium"}</Badge></Table.Td>
                                            <Table.Td><Group gap={4}><Button size="compact-xs" variant="subtle" color="green" onClick={() => void updateTask(task, { status: "done" })}>Done</Button><ActionIcon size="sm" color="red" variant="subtle" onClick={() => void deleteTask(task)}><IconTrash size={12} /></ActionIcon></Group></Table.Td>
                                          </Table.Tr>
                                        );
                                      })}
                                    </Table.Tbody>
                                  </Table>
                                </Stack>
                              </Card>
                            );
                          })()}
                        </Stack>
                      )}
                    </>
                  );
                })()}
              </Stack>
            )}
          </>
        ) : (
          <Tabs defaultValue="notebook">
            <Tabs.List>
              <Tabs.Tab value="notebook" leftSection={<IconNotes size={14} />}>My notebook</Tabs.Tab>
              <Tabs.Tab value="received" leftSection={<IconMailSpark size={14} />}>
                Received
                {receivedNotes.length > 0 && <Badge size="xs" variant="filled" color="grape" ml={6}>{receivedNotes.length}</Badge>}
              </Tabs.Tab>
              <Tabs.Tab value="tasks" leftSection={<IconChecklist size={14} />}>My action items</Tabs.Tab>
            </Tabs.List>

            {/* ── Personal Notebook ── */}
            <Tabs.Panel value="notebook" pt="md">
              <Stack gap="md">
                <Alert color="orange" variant="light" radius="lg" icon={<IconNotes size={16} />}>
                  <Text size="sm">
                    <strong>My notebook is your personal notepad.</strong> Use it like sticky notes to save reminders, handoff notes, links, drafts, meeting prep, and any personal reference info you want to keep for yourself.
                  </Text>
                </Alert>
                <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16, alignItems: "start" }}>
                  {/* Sidebar */}
                  <Card withBorder radius="xl" p="md">
                    <Stack gap="sm">
                      <Group justify="space-between" align="center">
                        <Text fw={700} size="sm">My sections</Text>
                        <Button size="xs" radius="md" variant="light" leftSection={<IconPlus size={12} />}
                          onClick={() => { setCreateSectionGroup("other"); setCreateSectionParent(null); setCreateSectionName(""); setCreateSectionOpen(true); }}>
                          New
                        </Button>
                      </Group>
                      <TextInput value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="Search…" leftSection={<IconSearch size={14} />} radius="md" size="xs" />
                      <ScrollArea.Autosize mah={400} offsetScrollbars>
                        <Stack gap={4}>
                          {otherSections.length === 0 ? (
                            <Text size="xs" c="dimmed" ta="center" py="sm">No sections yet — create one above</Text>
                          ) : otherSections.map((section) => (
                            <Card key={section.key} withBorder radius="md" p="xs"
                              style={{ cursor: "pointer", background: activeSectionKey === section.key ? "rgba(255,140,0,0.12)" : undefined, borderColor: activeSectionKey === section.key ? "rgba(255,140,0,0.45)" : undefined }}
                              onClick={() => setActiveSectionKey(section.key)}
                              onContextMenu={(event) => openSectionContextMenu(event, section)}>
                              <Group gap="xs" wrap="nowrap">
                                <ThemeIcon size={22} radius="sm" variant="light" color="orange"><IconNotes size={11} /></ThemeIcon>
                                <div style={{ minWidth: 0 }}>
                                  <Text fw={600} size="xs" truncate>{section.label}</Text>
                                  <Text size="xs" c="dimmed">{section.notes.length} pages</Text>
                                </div>
                              </Group>
                            </Card>
                          ))}
                        </Stack>
                      </ScrollArea.Autosize>
                    </Stack>
                  </Card>

                  {/* Main content */}
                  {activeSection ? (
                    <Stack gap="md">
                      <Group justify="space-between" align="center">
                        <Text fw={700} size="sm">{activeSection.label}</Text>
                        <Button size="xs" variant="filled" color="orange" leftSection={<IconPlus size={12} />}
                          onClick={() => { resetComposer("other"); setCustomSectionName(activeSection.label); setManagementSection(activeSection.label); setOpenComposer(true); }}>
                          New page
                        </Button>
                      </Group>
                      {activeSection.notes.filter((n) => noteMatchesSearch(n, search)).length === 0 ? (
                        <Text size="sm" c="dimmed" ta="center" py="xl">No notes in this section yet. Click "New page" to start writing.</Text>
                      ) : (
                        <Stack gap="sm">
                          {activeSection.notes.filter((n) => noteMatchesSearch(n, search)).map((note) => (
                            <Card key={note.id} withBorder radius="lg" p="md">
                              <Stack gap="sm">
                                <Group justify="space-between" align="center" wrap="nowrap">
                                  <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                                    <Text fw={700} size="sm" truncate>{getNoteDisplayTitle(note)}</Text>
                                    <Text size="xs" c="dimmed">Updated {formatDate(note.updated_at ?? note.meeting_date ?? note.created_at)}</Text>
                                  </Stack>
                                  <Group gap="xs" wrap="nowrap">
                                    <Button size="xs" variant="light" color="orange" onClick={() => { populateComposer(note); setOpenComposer(true); }}>Edit</Button>
                                    <ActionIcon size="sm" color="red" variant="subtle" onClick={() => void deleteNote(note)}><IconTrash size={14} /></ActionIcon>
                                  </Group>
                                </Group>
                                <DetailCard note={note} managerView={false} />
                              </Stack>
                            </Card>
                          ))}
                        </Stack>
                      )}
                    </Stack>
                  ) : (
                    <Card withBorder radius="xl" p="xl">
                      <Stack align="center" gap="sm" py="xl">
                        <ThemeIcon size={48} radius="xl" variant="light" color="orange"><IconNotes size={24} /></ThemeIcon>
                        <Text fw={600}>Your personal notebook</Text>
                        <Text size="sm" c="dimmed" ta="center">Use this like sticky notes or a notepad to store reminders, handoff notes, links, drafts, passwords references, meeting prep, and any other personal work notes.</Text>
                        <Button variant="filled" color="orange" leftSection={<IconPlus size={14} />}
                          onClick={() => { setCreateSectionGroup("other"); setCreateSectionParent(null); setCreateSectionName(""); setCreateSectionOpen(true); }}>
                          Create first section
                        </Button>
                      </Stack>
                    </Card>
                  )}
                </div>
              </Stack>
            </Tabs.Panel>

            {/* ── Notes shared by manager ── */}
            <Tabs.Panel value="received" pt="md">
              <Stack gap="md">
                <TextInput leftSection={<IconSearch size={14} />} placeholder="Search my notes" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
                {receivedNotes.filter((note) => noteMatchesSearch(note, search)).length === 0
                  ? <Text size="sm" c="dimmed">No meeting summaries have been shared with you yet.</Text>
                  : receivedNotes.filter((note) => noteMatchesSearch(note, search)).map((note) => <DetailCard key={note.id} note={note} managerView={false} />)}
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="tasks" pt="md">
              <Stack gap="lg">
                {/* ── My own tasks ── */}
                <Stack gap="sm">
                  <Group justify="space-between" align="center">
                    <Stack gap={2}>
                      <Text fw={700} size="sm">My tasks</Text>
                      <Text size="xs" c="dimmed">Personal follow-ups you created for yourself</Text>
                    </Stack>
                    <Badge variant="light" color="grape">{myOwnTasks.length}</Badge>
                    <Badge variant="light" color="gray">{tasks.length} total meeting tasks</Badge>
                  </Group>
                  <Card withBorder radius="lg" p="md">
                    <Stack gap="sm">
                      <TextInput label="Task title" value={taskTitle} onChange={(e) => setTaskTitle(e.currentTarget.value)} placeholder="e.g. Follow up on feedback" />
                      <Textarea label="Details" value={taskDetails} onChange={(e) => setTaskDetails(e.currentTarget.value)} minRows={2} placeholder="Add context or next steps" />
                      <Group justify="space-between" align="flex-end">
                        <TextInput label="Due date" type="date" value={taskDueDate} onChange={(e) => setTaskDueDate(e.currentTarget.value)} />
                        <Button onClick={() => void addTask()} loading={saving} leftSection={<IconPlus size={14} />}>Add task</Button>
                      </Group>
                    </Stack>
                  </Card>
                  <Card withBorder radius="lg" p={0}>
                    <Table highlightOnHover horizontalSpacing="md" verticalSpacing="sm">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Task</Table.Th>
                          <Table.Th>Status</Table.Th>
                          <Table.Th>Due</Table.Th>
                          <Table.Th>Actions</Table.Th>
                          <Table.Th />
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {myOwnTasks.length === 0 ? (
                          <Table.Tr><Table.Td colSpan={5}><Text size="sm" c="dimmed" ta="center" py="sm">No personal tasks yet — add one above.</Text></Table.Td></Table.Tr>
                        ) : myOwnTasks.map((task) => {
                          const od = isOverdue(task);
                          return (
                            <Table.Tr key={task.id} style={od ? { background: "rgba(250,82,82,0.07)" } : undefined}>
                              <Table.Td>
                                <Group gap={6} wrap="nowrap">
                                  {od && <Tooltip label="Overdue"><IconAlertTriangle size={13} color="var(--mantine-color-red-5)" /></Tooltip>}
                                  <Box>
                                    <Text fw={600} size="sm">{task.title}</Text>
                                    {task.details && <Text size="xs" c="dimmed" lineClamp={1}>{task.details}</Text>}
                                  </Box>
                                </Group>
                              </Table.Td>
                              <Table.Td><Badge variant="light" color={task.status === "done" ? "green" : task.status === "duplicate" ? "gray" : task.status === "in_progress" ? "blue" : "yellow"}>{task.status}</Badge></Table.Td>
                              <Table.Td><Text size="sm" c={od ? "red" : undefined}>{task.due_date || "—"}</Text></Table.Td>
                              <Table.Td>
                                <Group gap="xs">
                                  {task.status !== "in_progress" && task.status !== "done" && <Button size="xs" variant="light" onClick={() => void updateTaskStatus(task, "in_progress")}>Start</Button>}
                                  {task.status !== "blocked" && task.status !== "done" && <Button size="xs" variant="light" color="red" onClick={() => void updateTaskStatus(task, "blocked")}>Block</Button>}
                                  {task.status !== "done" && <Button size="xs" variant="light" color="green" onClick={() => void updateTaskStatus(task, "done")}>Done</Button>}
                                </Group>
                              </Table.Td>
                              <Table.Td><ActionIcon size="sm" color="red" variant="subtle" onClick={() => void deleteTask(task)}><IconTrash size={14} /></ActionIcon></Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </Card>
                </Stack>

                {/* ── Action items assigned to me by manager ── */}
                {(true) && (
                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <Stack gap={2}>
                        <Text fw={700} size="sm">Assigned to me</Text>
                        <Text size="xs" c="dimmed">Action items your manager extracted from 1:1 meeting notes</Text>
                      </Stack>
                      <Badge variant="light" color="blue">{tasksAssignedToMe.length}</Badge>
                    </Group>
                    <Card withBorder radius="lg" p={0}>
                      <Table highlightOnHover horizontalSpacing="md" verticalSpacing="sm">
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Task</Table.Th>
                            <Table.Th>Status</Table.Th>
                            <Table.Th>Due</Table.Th>
                            <Table.Th>Source</Table.Th>
                            <Table.Th>Actions</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {tasksAssignedToMe.length === 0 && (
                            <Table.Tr>
                              <Table.Td colSpan={5}>
                                <Text size="sm" c="dimmed" ta="center" py="sm">No action items assigned to you yet — your manager will push them after your next 1:1.</Text>
                              </Table.Td>
                            </Table.Tr>
                          )}
                          {tasksAssignedToMe.map((task) => {
                            const od = isOverdue(task);
                            const sourceNote = task.note_id ? [...managerOwnedNotes, ...notes].find(n => n.id === task.note_id) : null;
                            return (
                              <Table.Tr key={task.id} style={od ? { background: "rgba(250,82,82,0.07)" } : undefined}>
                                <Table.Td>
                                  <Group gap={6} wrap="nowrap">
                                    {od && <Tooltip label="Overdue"><IconAlertTriangle size={13} color="var(--mantine-color-red-5)" /></Tooltip>}
                                    <Text fw={600} size="sm">{task.title}</Text>
                                  </Group>
                                </Table.Td>
                                <Table.Td>
                                  <Stack gap={6}>
                                    <Badge variant="light" color={task.status === "done" ? "green" : task.status === "duplicate" ? "gray" : task.status === "in_progress" ? "blue" : task.status === "blocked" ? "red" : "yellow"}>{task.status}</Badge>
                                    <Select
                                      size="xs"
                                      w={92}
                                      data={[{ value: "0", label: "0%" }, { value: "25", label: "25%" }, { value: "50", label: "50%" }, { value: "75", label: "75%" }, { value: "100", label: "100%" }]}
                                      value={String(Math.max(0, Math.min(100, task.progress_percent ?? 0)))}
                                      allowDeselect={false}
                                      onChange={(value) => value && void updateTask(task, { progress_percent: Number(value), status: Number(value) >= 100 ? "done" : Number(value) > 0 ? (task.status === "blocked" ? "blocked" : "in_progress") : "open" })}
                                    />
                                    <Progress value={Math.max(0, Math.min(100, task.progress_percent ?? 0))} color={task.status === "blocked" ? "red" : (task.progress_percent ?? 0) >= 100 ? "green" : task.status === "in_progress" ? "blue" : "gray"} size="sm" radius="xl" />
                                  </Stack>
                                </Table.Td>
                                <Table.Td><Text size="sm" c={od ? "red" : undefined}>{task.due_date || "—"}</Text></Table.Td>
                                <Table.Td>
                                  {sourceNote
                                    ? <Text size="xs" c="dimmed" lineClamp={1}>{sourceNote.title}</Text>
                                    : <Text size="xs" c="dimmed">—</Text>}
                                </Table.Td>
                                <Table.Td>
                                  <Group gap="xs">
                                    {task.status !== "in_progress" && task.status !== "done" && <Button size="xs" variant="light" onClick={() => void updateTask(task, { status: "in_progress", progress_percent: Math.max(task.progress_percent ?? 0, 25) })}>Start</Button>}
                                    {task.status !== "blocked" && task.status !== "done" && <Button size="xs" variant="light" color="red" onClick={() => void updateTask(task, { status: "blocked" })}>Block</Button>}
                                    {task.status !== "done" && <Button size="xs" variant="light" color="green" onClick={() => void updateTask(task, { status: "done", progress_percent: 100 })}>Done</Button>}
                                  </Group>
                                </Table.Td>
                                <Table.Td><Button size="xs" variant="subtle" color="grape" onClick={() => void addTaskToMyDay(task)}>Add</Button></Table.Td>
                              </Table.Tr>
                            );
                          })}
                        </Table.Tbody>
                      </Table>
                    </Card>
                  </Stack>
                )}
              </Stack>
            </Tabs.Panel>
          </Tabs>
        )}
      </Stack>

      {/* ── All Notes Modal ── */}
      <Modal
        opened={allNotesModalOpen}
        onClose={() => setAllNotesModalOpen(false)}
        title={<Group gap="xs"><IconLayoutList size={16} /><Text fw={700}>All notes</Text></Group>}
        size="90%"
        radius="lg"
        zIndex={9999}
      >
        <Stack gap="md">
          <Group gap="sm">
            <Select
              size="sm"
              placeholder="All notebooks"
              data={[{ value: "all", label: "All notebooks" }, { value: "individual", label: "1:1 notes" }, { value: "management", label: "Management" }, { value: "other", label: "Other" }]}
              value={noteGroupFilter}
              onChange={(value) => setNoteGroupFilter(value || "all")}
              allowDeselect={false}
              style={{ width: 180 }}
            />
            <TextInput
              size="sm"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              placeholder="Search notes…"
              leftSection={<IconSearch size={14} />}
              style={{ flex: 1 }}
            />
          </Group>
          <Card withBorder radius="lg" p={0}>
            <ScrollArea.Autosize mah="70vh">
              <Table highlightOnHover horizontalSpacing="md" verticalSpacing="sm">
                <Table.Thead><Table.Tr><Table.Th>Note</Table.Th><Table.Th>Section</Table.Th><Table.Th>Date</Table.Th><Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {filteredAllNotes.length === 0
                    ? <Table.Tr><Table.Td colSpan={4}><Text size="sm" c="dimmed" ta="center" py="md">No notes matched your filters.</Text></Table.Td></Table.Tr>
                    : filteredAllNotes.map((note) => (
                      <Table.Tr key={note.id}>
                        <Table.Td><Text fw={600} size="sm">{getNoteDisplayTitle(note)}</Text><Text size="xs" c="dimmed" lineClamp={1}>{note.summary_markdown}</Text></Table.Td>
                        <Table.Td><Badge variant="light" size="sm" color={note.notebook_group === "management" ? "blue" : note.notebook_group === "other" ? "orange" : "grape"}>{note.section_name}</Badge></Table.Td>
                        <Table.Td><Text size="sm" style={{ whiteSpace: "nowrap" }}>{formatDate(note.meeting_date)}</Text></Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            <Button size="xs" variant="light" onClick={() => { setAllNotesModalOpen(false); setManagerView("notebook"); setActiveSectionKey(`${note.notebook_group}:${note.section_name}`); setSelectedPageId(note.id); }}>Open</Button>
                            <Button size="xs" variant="subtle" color="grape" onClick={() => void createTasksFromNote(note)}>Extract tasks</Button>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          </Card>
        </Stack>
      </Modal>

      {contextMenu && (
        <Card
          ref={contextMenuRef}
          withBorder
          radius="lg"
          p="xs"
          style={{
            position: "fixed",
            left: Math.min(contextMenu.x, window.innerWidth - 240),
            top: Math.min(contextMenu.y, window.innerHeight - 220),
            width: 220,
            zIndex: 10050,
            boxShadow: "0 18px 48px rgba(0,0,0,0.35)",
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <Stack gap={4}>
            {contextMenu.type === "section" && contextMenuSection ? (
              <>
                <Button
                  variant="subtle"
                  justify="flex-start"
                  leftSection={<IconEdit size={14} />}
                  onClick={() => {
                    setRenameSectionKey(contextMenuSection.key);
                    setRenameSectionName(splitSectionPath(contextMenuSection.label).slice(-1)[0] ?? contextMenuSection.label);
                    setRenameSectionOpen(true);
                    setContextMenu(null);
                  }}
                >
                  Rename
                </Button>
                {(isManager || contextMenuSection.notebook_group !== "other") && (
                  <>
                    <Button variant="subtle" justify="flex-start" leftSection={<IconArrowsRight size={14} />} onClick={() => { setMoveSectionKey(contextMenuSection.key); setMoveSectionTargetParent(null); setMoveSectionOpen(true); setContextMenu(null); }}>Move</Button>
                    <Button variant="subtle" justify="flex-start" leftSection={<IconClipboardText size={14} />} onClick={() => void duplicateSectionFolder(contextMenuSection)}>Copy</Button>
                  </>
                )}
                <Button variant="subtle" justify="flex-start" color="red" leftSection={<IconTrash size={14} />} onClick={() => void deleteSectionFolder(contextMenuSection)}>Delete</Button>
              </>
            ) : contextMenu.type === "area" && contextMenu.areaName ? (
              <>
                <Button variant="subtle" justify="flex-start" leftSection={<IconEdit size={14} />} onClick={() => { setRenameAreaTarget(contextMenu.areaName ?? ""); setRenameAreaValue(contextMenu.areaName ?? ""); setRenameAreaOpen(true); setContextMenu(null); }}>Rename</Button>
                <Button variant="subtle" justify="flex-start" leftSection={<IconArrowsRight size={14} />} onClick={() => { const next = window.prompt("Move area into another area (leave blank for Other sections)", ""); void moveArea(contextMenu.areaName!, next || null); setContextMenu(null); }}>Move</Button>
                <Button variant="subtle" justify="flex-start" leftSection={<IconClipboardText size={14} />} onClick={() => void copyArea(contextMenu.areaName!)}>Copy</Button>
              </>
            ) : null}
          </Stack>
        </Card>
      )}

      {/* ── Rename area modal (replaces blocked window.prompt) ── */}
      <Modal
        opened={renameAreaOpen}
        onClose={() => setRenameAreaOpen(false)}
        title={`Rename area · ${renameAreaTarget}`}
        centered
        size="sm"
      >
        <Stack gap="md">
          <TextInput
            label="New area name"
            value={renameAreaValue}
            onChange={(e) => setRenameAreaValue(e.currentTarget.value)}
            placeholder="Enter a new name"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") { void renameArea(renameAreaTarget, renameAreaValue); setRenameAreaOpen(false); } }}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRenameAreaOpen(false)}>Cancel</Button>
            <Button
              leftSection={<IconEdit size={14} />}
              disabled={!renameAreaValue.trim() || renameAreaValue.trim() === renameAreaTarget}
              loading={saving}
              onClick={() => { void renameArea(renameAreaTarget, renameAreaValue); setRenameAreaOpen(false); }}
            >
              Rename
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ── Delete confirmation modal ── */}
      {deleteConfirmSection && (
        <DeleteConfirmModal
          section={deleteConfirmSection}
          affectedPageCount={managerOwnedNotes.filter(
            (note) => note.notebook_group === deleteConfirmSection.notebook_group &&
              (note.section_name === deleteConfirmSection.label || note.section_name.startsWith(`${deleteConfirmSection.label}${SECTION_PATH_SEPARATOR}`)),
          ).length}
          saving={saving}
          onCancel={() => setDeleteConfirmSection(null)}
          onConfirm={(section) => void confirmDeleteSectionFolder(section)}
        />
      )}

      <Modal opened={duplicateReviewOpen} onClose={() => setDuplicateReviewOpen(false)} title="AI duplicate task review" size="xl" centered>
        <Stack gap="md">
          <Alert color="violet" variant="light" icon={<IconSparkles size={16} />}>
            {duplicateReview?.summary || "Review potential duplicate task groups below. Deleting a group keeps the first task and removes the rest in that group."}
          </Alert>
          {duplicateReview && duplicateReview.groups.length > 0 ? duplicateReview.groups.map((group, index) => {
            const matchedTasks = group.taskIds
              .map((id) => managerTaskRows.find((task) => task.id === id) ?? tasks.find((task) => task.id === id))
              .filter(Boolean) as PersonalActionItem[];
            return (
              <Card key={`${group.canonicalTitle}-${index}`} withBorder radius="lg" p="md">
                <Stack gap="sm">
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={2}>
                      <Text fw={700} size="sm">{group.canonicalTitle}</Text>
                      <Text size="xs" c="dimmed">{group.reason || "Potential duplicate wording detected."}</Text>
                    </Stack>
                    <Button color="red" size="xs" leftSection={<IconTrash size={12} />} onClick={() => void deleteDuplicateGroup(group.taskIds)}>
                      Delete duplicates
                    </Button>
                  </Group>
                  <Stack gap="xs">
                    {matchedTasks.map((task, taskIndex) => (
                      <Card key={task.id} withBorder radius="md" p="sm" style={taskIndex === 0 ? { borderColor: "var(--mantine-color-green-6)" } : undefined}>
                        <Stack gap={2}>
                          <Group gap="xs">
                            <Badge size="xs" color={taskIndex === 0 ? "green" : "gray"} variant="light">{taskIndex === 0 ? "Keep" : "Delete"}</Badge>
                            <Text size="sm" fw={600}>{task.title}</Text>
                          </Group>
                          <Text size="xs" c="dimmed">Owner: {storedOwner(task) || "Unassigned"} · Status: {task.status} · Due: {task.due_date || "—"}</Text>
                          {task.details && <Text size="xs" c="dimmed">Source: {task.details}</Text>}
                        </Stack>
                      </Card>
                    ))}
                  </Stack>
                </Stack>
              </Card>
            );
          }) : (
            <Card withBorder radius="lg" p="lg">
              <Text size="sm" c="dimmed" ta="center">No obvious duplicate tasks were found.</Text>
            </Card>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(managedSection)}
        onClose={() => setManageSectionKey(null)}
        title={managedSection ? `Manage folder · ${managedSection.label}` : "Manage folder"}
        centered
      >
        <Stack gap="md">
          {managedSection && (
            <>
              <Card withBorder radius="lg" p="md">
                <Stack gap={4}>
                  <Text fw={700}>{managedSection.label}</Text>
                  <Text size="sm" c="dimmed">
                    {managedSection.notes.length} page{managedSection.notes.length === 1 ? "" : "s"} in this folder.
                  </Text>
                </Stack>
              </Card>
              <Button
                variant="light"
                leftSection={<IconPlus size={14} />}
                onClick={() => {
                  openCreateSectionModal(managedSection.notebook_group, managedSection.label);
                  setManageSectionKey(null);
                }}
              >
                Create section
              </Button>
              <Button
                variant="light"
                color="blue"
                leftSection={<IconArrowsRight size={14} />}
                onClick={() => {
                  setMoveSectionKey(managedSection.key);
                  setMoveSectionTargetParent(null);
                  setMoveSectionOpen(true);
                  setManageSectionKey(null);
                }}
              >
                Move folder
              </Button>
              <Button
                variant="light"
                color="red"
                leftSection={<IconTrash size={14} />}
                onClick={() => void deleteSectionFolder(managedSection)}
                loading={saving}
              >
                Delete folder
              </Button>
            </>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={renameSectionOpen}
        onClose={() => {
          setRenameSectionOpen(false);
          setRenameSectionKey(null);
          setRenameSectionName("");
        }}
        title={renamingSection ? `Rename folder · ${renamingSection.label}` : "Rename folder"}
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Rename this folder without changing its parent location. Nested subfolders and pages will keep their structure.
          </Text>
          <TextInput
            label="Folder name"
            value={renameSectionName}
            onChange={(e) => setRenameSectionName(e.currentTarget.value)}
            placeholder="Type the new folder name"
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setRenameSectionOpen(false);
                setRenameSectionKey(null);
                setRenameSectionName("");
              }}
            >
              Cancel
            </Button>
            <Button
              leftSection={<IconEdit size={14} />}
              onClick={() => {
                if (renamingSection) void renameSectionFolder(renamingSection, renameSectionName);
              }}
              loading={saving}
              disabled={!renamingSection || !renameSectionName.trim()}
            >
              Rename folder
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={moveSectionOpen}
        onClose={() => {
          setMoveSectionOpen(false);
          setMoveSectionKey(null);
          setMoveSectionTargetParent(null);
        }}
        title={movingSection ? `Move folder · ${movingSection.label}` : "Move folder"}
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Choose a new parent folder in the same notebook group. Selecting top level will move this folder out to the root.
          </Text>
          <Select
            label="New parent folder"
            data={[{ value: "", label: "Top level" }, ...moveSectionParentOptions]}
            value={moveSectionTargetParent ?? ""}
            onChange={(value) => setMoveSectionTargetParent(value || null)}
            searchable
            allowDeselect={false}
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setMoveSectionOpen(false);
                setMoveSectionKey(null);
                setMoveSectionTargetParent(null);
              }}
            >
              Cancel
            </Button>
            <Button
              leftSection={<IconArrowsRight size={14} />}
              onClick={() => {
                if (movingSection) void moveSectionFolder(movingSection, moveSectionTargetParent);
              }}
              loading={saving}
              disabled={!movingSection}
            >
              Move folder
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={createAreaOpen}
        onClose={() => setCreateAreaOpen(false)}
        title="Create notebook area"
        centered
      >
        <Stack gap="md">
          <TextInput
            label="Area name"
            value={createAreaName}
            onChange={(e) => setCreateAreaName(e.currentTarget.value)}
            placeholder="Type the notebook area name"
            description="Creates a new top-level notebook area like the ones shown in the sidebar."
            autoFocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateAreaOpen(false)}>Cancel</Button>
            <Button onClick={() => void createNotebookArea()} loading={saving}>Create area</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={createSectionOpen}
        onClose={() => setCreateSectionOpen(false)}
        title="Create notebook section"
        centered
      >
        <Stack gap="md">
          <Card withBorder radius="lg" p="sm">
            <Stack gap={4}>
              <Text size="xs" tt="uppercase" fw={700} c="dimmed">Section type</Text>
              <Group gap="xs">
                <Badge
                  variant="light"
                  color={createSectionGroup === "management" ? "blue" : createSectionGroup === "other" ? "orange" : "grape"}
                >
                  {createSectionGroup === "management"
                    ? "Management"
                    : createSectionGroup === "other"
                      ? "Other"
                      : "Individual"}
                </Badge>
                <Text size="sm" c="dimmed">Creates a new notebook section in this area.</Text>
              </Group>
            </Stack>
          </Card>
          <TextInput
            label="Section name"
            value={createSectionName}
            onChange={(e) => setCreateSectionName(e.currentTarget.value)}
            placeholder="Type the notebook section name"
            description="This creates a new notebook section like the ones shown in the sidebar."
            autoFocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateSectionOpen(false)}>Cancel</Button>
            <Button onClick={() => void createSectionFolder()} loading={saving}>Create section</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={openComposer} onClose={() => setOpenComposer(false)} title={editingNoteId ? "Edit notebook page" : parentNoteId ? "Create subpage" : !isManager ? "New sticky note" : notebookMode === "management" ? "Create management notebook page" : "Prepare 1:1 page"} centered size="xl">
        <Stack gap="md">
          {!isManager ? (
            <>
              <Card withBorder radius="lg" p="md" style={{ background: "rgba(255,140,0,0.06)", borderColor: "rgba(255,140,0,0.24)" }}>
                <Stack gap="xs">
                  <Group gap="sm" wrap="nowrap">
                    <ThemeIcon radius="md" variant="light" color="orange"><IconNotes size={16} /></ThemeIcon>
                    <div>
                      <Text fw={700} size="sm">Personal sticky note</Text>
                      <Text size="sm" c="dimmed">Write a quick reminder, draft, handoff note, link, or anything else you want to keep in your notebook.</Text>
                    </div>
                  </Group>
                </Stack>
              </Card>

              <TextInput
                label="Section"
                value={customSectionName}
                onChange={(e) => setCustomSectionName(e.currentTarget.value)}
                placeholder={activeSection?.label || "General notes"}
                description="This note will be saved in this notebook section."
              />

              <TextInput
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                placeholder="Quick note"
              />

              <Textarea
                label="Note"
                minRows={12}
                autosize
                value={sourceNotes}
                onChange={(e) => setSourceNotes(e.currentTarget.value)}
                placeholder="Type your sticky note here — reminders, links, handoff notes, follow-ups, ideas, drafts…"
                ref={composerBodyRef}
              />

              <Group justify="flex-end" gap="xs">
                <Button variant="default" onClick={() => setOpenComposer(false)}>Cancel</Button>
                <Button color="orange" leftSection={<IconNotes size={14} />} onClick={() => void saveNote("shared")} loading={saving}>
                  {editingNoteId ? "Save changes" : "Create note"}
                </Button>
              </Group>
            </>
          ) : (
            <>
              <Alert icon={<IconBook size={16} />} color={notebookMode === "management" ? "blue" : "grape"} variant="light">
                {notebookMode === "management"
                  ? "Capture management-level meeting notes into reusable notebook sections for leadership, staffing, operations, and coaching themes."
                  : <>Gmail notes are synced automatically from <strong>label:gemini-notes</strong>. Team-member 1:1 pages and My Notebook pages are created from Gmail labels without manual import.</>}
              </Alert>

              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                <Select label="Notebook type" data={NOTEBOOK_OPTIONS} value={notebookMode} onChange={(value) => setNotebookMode((value as NotebookMode) || "individual")} allowDeselect={false} />
                <TextInput label="Meeting date" type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.currentTarget.value)} />
              </SimpleGrid>

              {notebookMode === "individual" && (
                <>
                  <Card withBorder radius="lg" p="md">
                    <Stack gap="sm">
                      <Group justify="space-between" align="flex-end" wrap="wrap">
                        <Stack gap={2}>
                          <Text fw={700}>Gmail label sync</Text>
                          <Text size="sm" c="dimmed">Click <strong>Gmail sync</strong> to automatically load approved Gmail labels, map each email to its matching folder, generate summaries, and save pages without manual review.</Text>
                        </Stack>
                        <Group gap="xs">
                          <Badge variant="light" color="grape">{gmailMessages.length} loaded</Badge>
                          <Badge variant="light" color={gmailLoading || saving ? "blue" : "green"}>{gmailLoading || saving ? "Syncing Gmail" : "Ready"}</Badge>
                          <Button size="xs" variant="light" color="blue" leftSection={<IconMailSpark size={12} />} loading={gmailLoading || saving} disabled={saving} onClick={() => { void runManualGmailSync(); }}>
                            Gmail sync
                          </Button>
                        </Group>
                      </Group>

                      <Text size="xs" c="dimmed">Approved member labels found in Gmail are shown below. Matching emails are imported into these folders automatically during sync.</Text>

                      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                        <TextInput
                          label="Auto-sync start"
                          type="date"
                          value={gmailStartDate}
                          onChange={(e) => setGmailStartDate(e.currentTarget.value)}
                        />
                        <TextInput
                          label="Auto-sync end"
                          type="date"
                          value={gmailEndDate}
                          onChange={(e) => setGmailEndDate(e.currentTarget.value)}
                        />
                      </SimpleGrid>

                      {gmailAvailableLabels.length > 0 && (
                        <Card withBorder radius="md" p="sm" bg="rgba(255,255,255,0.01)">
                          <Stack gap={6}>
                            <Text size="xs" tt="uppercase" fw={700} c="dimmed">Approved Gmail member labels found</Text>
                            <Group gap="xs">
                              {gmailAvailableLabels.map((label) => (
                                <Badge key={label} variant="light" color="grape">{label.split("/").pop() ?? label}</Badge>
                              ))}
                            </Group>
                          </Stack>
                        </Card>
                      )}

                      {gmailSyncStats && (
                        <Card withBorder radius="md" p="sm" bg="rgba(255,255,255,0.01)">
                          <Stack gap={6}>
                            <Text size="xs" tt="uppercase" fw={700} c="dimmed">Last Gmail sync result</Text>
                            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
                              <Badge variant="light">Fetched: {gmailSyncStats.fetched}</Badge>
                              <Badge variant="light">Matched labels: {gmailSyncStats.approvedFolderMatches}</Badge>
                              <Badge variant="light">Pending: {gmailSyncStats.pending}</Badge>
                              <Badge variant="light" color={gmailSyncStats.createdPages > 0 ? "green" : "gray"}>Created: {gmailSyncStats.createdPages}</Badge>
                              <Badge variant="light">Extracted notes: {gmailSyncStats.extractedNotes}</Badge>
                              <Badge variant="light">AI structured: {gmailSyncStats.aiStructured}</Badge>
                              <Badge variant="light">Fallback structured: {gmailSyncStats.fallbackStructured}</Badge>
                              <Badge variant="light" color={(gmailSyncStats.skippedNoExtractedNotes + gmailSyncStats.skippedNoStructuredContent) > 0 ? "yellow" : "gray"}>Skipped parse: {gmailSyncStats.skippedNoExtractedNotes + gmailSyncStats.skippedNoStructuredContent}</Badge>
                            </SimpleGrid>
                            {gmailSyncStats.statusMessage && <Text size="sm">{gmailSyncStats.statusMessage}</Text>}
                            <Text size="xs" c="dimmed">
                              Existing: {gmailSyncStats.skippedExisting} · Unclassified: {gmailSyncStats.skippedUnclassified} · No extracted notes: {gmailSyncStats.skippedNoExtractedNotes} · No structured content: {gmailSyncStats.skippedNoStructuredContent}
                            </Text>
                            <Text size="xs" c="dimmed">Range: {gmailSyncStats.start} → {gmailSyncStats.end}</Text>
                          </Stack>
                        </Card>
                      )}

                      {gmailMessages.length === 0 ? (
                        <Text size="sm" c="dimmed">No Gmail notes loaded for this range yet.</Text>
                      ) : gmailMessagesByMemberLabel.length === 0 ? (
                        <Text size="sm" c="dimmed">Emails were loaded, but none of them matched the approved member-label folders.</Text>
                      ) : (
                        <Stack gap="sm">
                          {gmailMessagesByMemberLabel.map((group) => (
                            <Card key={group.sectionName} withBorder radius="md" p="sm">
                              <Stack gap="sm">
                                <Group justify="space-between" align="center">
                                  <Stack gap={2}>
                                    <Text fw={700}>{group.sectionName}</Text>
                                    <Text size="xs" c="dimmed">{group.label}</Text>
                                  </Stack>
                                  <Badge variant="light" color="grape">{group.messages.length} email{group.messages.length === 1 ? "" : "s"}</Badge>
                                </Group>

                                {group.messages.map((message) => (
                                  <Card key={message.id} withBorder radius="md" p="sm" bg="rgba(255,255,255,0.02)">
                                    <Stack gap="sm">
                                      <Group justify="space-between" align="flex-start">
                                        <Stack gap={2} style={{ flex: 1 }}>
                                          <Text fw={600}>{message.subject}</Text>
                                          <Text size="xs" c="dimmed">{formatDate(message.internalDate ?? message.date)}{message.from ? ` · ${message.from}` : ""}</Text>
                                          <Text size="sm" c="dimmed" lineClamp={2}>{message.snippet || message.body}</Text>
                                        </Stack>
                                        <Group gap="xs">
                                          <Badge variant="light" color={message.imported ? "green" : "blue"}>{message.imported ? "Imported" : "Pending import"}</Badge>
                                        </Group>
                                      </Group>
                                    </Stack>
                                  </Card>
                                ))}
                              </Stack>
                            </Card>
                          ))}
                        </Stack>
                      )}
                    </Stack>
                  </Card>
                </>
              )}

              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                {notebookMode === "individual" ? (
                  <Select
                    label="Start from an existing employee section"
                    data={PERSON_TEAM_NAMES.map((name) => ({ value: name, label: name }))}
                    value={selectedEmployee}
                    onChange={(value) => {
                      setSelectedEmployee(value);
                      if (value) setCustomSectionName(value);
                    }}
                    searchable
                    clearable
                    description="Optional. Pick an existing employee section, or type a brand-new section name on the right."
                  />
                ) : notebookMode === "management" ? (
                  <Select
                    label="Start from an existing management section"
                    data={DEFAULT_MANAGEMENT_SECTIONS.map((name) => ({ value: name, label: name }))}
                    value={managementSection}
                    onChange={(value) => {
                      const next = value || DEFAULT_MANAGEMENT_SECTIONS[0];
                      setManagementSection(next);
                      setCustomSectionName(value || "");
                    }}
                    searchable
                    clearable
                    description="Optional. Pick a common management section, or type a new one on the right."
                  />
                ) : (
                  <TextInput
                    label="Notebook"
                    value="Other notebook"
                    readOnly
                    description="Use this notebook for extracted pages and custom sections that are not tied to a specific employee."
                  />
                )}
                <TextInput
                  label={notebookMode === "individual" ? "Section name" : notebookMode === "management" ? "Management section name" : "Other section name"}
                  value={customSectionName}
                  onChange={(e) => setCustomSectionName(e.currentTarget.value)}
                  placeholder={notebookMode === "individual" ? "Type a new employee or topic section" : notebookMode === "management" ? "Leadership sync" : "Project follow-ups"}
                  description="This section will be created automatically if it does not already exist."
                />
              </SimpleGrid>

              <Select label="Source" data={SOURCE_OPTIONS} value={sourceType} onChange={setSourceType} allowDeselect={false} />

              {sourceType === "gmail_gemini" ? (
                <Alert icon={<IconMailSpark size={16} />} color="grape" variant="light">
                  Gmail-labeled notes are imported automatically during Gmail sync. You only need the manual editor below for pasted notes, handwritten notes, or editing an existing page.
                </Alert>
              ) : (
                <>
                  <TextInput label="Title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
                  <Textarea
                    label={notebookMode === "management" ? "Meeting notes" : "Gemini / Gmail notes"}
                    minRows={8}
                    value={sourceNotes}
                    onChange={(e) => setSourceNotes(e.currentTarget.value)}
                    placeholder={notebookMode === "management" ? "Paste leadership or management meeting notes" : "Imported Gmail note body or pasted Gemini-generated notes"}
                    ref={composerBodyRef}
                    description={importedMessageSubject ? `Loaded from: ${importedMessageSubject}` : undefined}
                  />

                  <Group justify="space-between">
                    <Group gap="xs">
                      <Button variant="light" leftSection={<IconSparkles size={14} />} onClick={() => void generateFromNotes()} loading={aiLoading}>Prepare summary</Button>
                      {aiResult && <Badge variant="light" color="grape">AI structured</Badge>}
                    </Group>
                    <Group gap="xs">
                      <Button variant="default" onClick={() => setOpenComposer(false)}>Cancel</Button>
                      {notebookMode === "individual" && !editingNoteId && <Button variant="light" color="yellow" leftSection={<IconClipboardText size={14} />} onClick={() => void saveNote("draft")} loading={saving}>Save draft</Button>}
                      <Button color={notebookMode === "management" ? "blue" : "grape"} leftSection={notebookMode === "management" ? <IconBook size={14} /> : <IconSend size={14} />} onClick={() => void saveNote("shared")} loading={saving}>{editingNoteId ? "Save changes" : notebookMode === "management" ? "Save to notebook" : "Save page"}</Button>
                    </Group>
                  </Group>

                  <Textarea label="Meeting summary" minRows={6} value={summaryMarkdown} onChange={(e) => setSummaryMarkdown(e.currentTarget.value)} placeholder="Clean summary with context, decisions, feedback, and outcomes" />
                  <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
                    <Textarea label="Discussion points" minRows={6} value={discussionPoints} onChange={(e) => setDiscussionPoints(e.currentTarget.value)} placeholder="One item per line" />
                    <Textarea label="Manager action items" minRows={6} value={managerActionItems} onChange={(e) => setManagerActionItems(e.currentTarget.value)} placeholder="One item per line" />
                    <Textarea label={notebookMode === "management" ? "Team follow-ups" : "Employee action items"} minRows={6} value={employeeActionItems} onChange={(e) => setEmployeeActionItems(e.currentTarget.value)} placeholder="One item per line" />
                  </SimpleGrid>
                </>
              )}
            </>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(moveDialogNote)}
        onClose={() => {
          setMoveDialogNoteId(null);
          setMoveTargetSectionKey(null);
        }}
        title={moveDialogNote ? `Move “${moveDialogNote.title}”` : "Move page"}
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">Right-click any page to open this menu, or drag a page onto a section in the left sidebar.</Text>
          <Select
            label="Move to section"
            data={allSectionOptions}
            value={moveTargetSectionKey}
            onChange={setMoveTargetSectionKey}
            searchable
            allowDeselect={false}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => {
              setMoveDialogNoteId(null);
              setMoveTargetSectionKey(null);
            }}>Cancel</Button>
            <Button
              onClick={() => {
                if (moveDialogNote && moveTargetSectionKey) void moveNoteToSection(moveDialogNote, moveTargetSectionKey);
              }}
              disabled={!moveDialogNote || !moveTargetSectionKey}
            >
              Move page
            </Button>
          </Group>
        </Stack>
      </Modal>
    </WidgetFrame>
  );
}
