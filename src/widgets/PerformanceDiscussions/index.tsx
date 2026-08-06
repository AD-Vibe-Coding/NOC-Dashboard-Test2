import { useEffect, useMemo, useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import {
  IconBrain,
  IconCalendarStats,
  IconCheck,
  IconClipboardText,
  IconRefresh,
  IconSparkles,
  IconTargetArrow,
  IconUserEdit,
  IconUsers,
} from "@tabler/icons-react";
import { db } from "../../db";
import { downloadBlob } from "../../lib/download";
import { useIdentity } from "../../lib/identity";
import { useCompletion } from "../../lib/devs-ai/use-completion";
import { ROLE_BY_NAME, ROSTER_BY_EMAIL } from "../../lib/roles";
import { WidgetFrame } from "../WidgetFrame";
import { WidgetTile } from "../WidgetTile";
import { aggregateMetrics, type SourceBucket } from "../PerformanceTracker/data";

type DiscussionRow = Awaited<ReturnType<typeof db.performance_discussions.list>>[number];
type SubmissionRow = Awaited<ReturnType<typeof db.performance_discussion_submissions.list>>[number];
type MetricRow = Awaited<ReturnType<typeof db.performance_metrics.list>>[number];

type Snapshot = ReturnType<typeof buildMetricsSnapshot>;
type ReviewSectionKey = "openingNotes" | "businessImpactNotes" | "behaviorsNotes" | "feedbackNotes" | "engagementNotes" | "developmentNotes" | "secondHalfPriorities" | "closingSummary";

type SelfReviewDraft = {
  openingNotes: string[];
  businessImpactNotes: string[];
  behaviorsNotes: string[];
  feedbackNotes: string[];
  engagementNotes: string[];
  developmentNotes: string[];
  secondHalfPriorities: string[];
  closingSummary: string[];
  overallSummary: string;
  employeeCommitments: string;
};

type TextHighlight = {
  start: number;
  end: number;
};

type HighlightMap = Record<string, TextHighlight[]>;
type QuestionNoteMap = Record<string, string>;

const SUMMARY_AGENT_ID = "2d6e4c84-9581-4753-bf84-9da21eddf76c";
const FIXED_CYCLE_LABEL = "2026 H1";

function blankAnswers(count: number) {
  return Array.from({ length: count }, () => "");
}

const EMPTY_REVIEW: SelfReviewDraft = {
  openingNotes: blankAnswers(7),
  businessImpactNotes: blankAnswers(5),
  behaviorsNotes: blankAnswers(5),
  feedbackNotes: blankAnswers(7),
  engagementNotes: blankAnswers(5),
  developmentNotes: blankAnswers(5),
  secondHalfPriorities: blankAnswers(5),
  closingSummary: blankAnswers(4),
  overallSummary: "",
  employeeCommitments: "",
};

const AGENDA_SECTIONS = [
  {
    key: "openingNotes",
    title: "1. Start with how you're feeling",
    duration: "5 min",
    goal: "Share how you're doing overall, how the role feels, and give context for the conversation.",
    prompts: [
      "How are you feeling overall?",
      "How has the year felt for you so far?",
      "What have been your highlights and lowlights recently?",
      "How has your experience of the role felt so far?",
      "How clear do you feel about what success in your role looks like today?",
      "Are there any parts of your role, priorities, or expectations that still feel unclear?",
      "If one part of your day-to-day work could feel better in the second half, what would you focus on?",
    ],
  },
  {
    key: "businessImpactNotes",
    title: "2. Reflect on first-half business impact — the What",
    duration: "10–15 min",
    goal: "Summarize accomplishments, goals, business impact, customer value, and obstacles from the first half using your dashboard metrics as context.",
    prompts: [
      "Looking at your dashboard metrics from Jan to Jun, which results are you most proud of and why?",
      "Which metrics best reflect the impact you made in the first half?",
      "Where do you think your numbers show strong performance or steady improvement?",
      "Were there any metrics that do not fully reflect the work or complexity you handled?",
      "What challenges, blockers, or workload conditions affected your results or metrics?",
    ],
  },
  {
    key: "behaviorsNotes",
    title: "3. Reflect on behaviors and values — the How",
    duration: "10–15 min",
    goal: "Share how you've approached collaboration, communication, ownership, teamwork, and day-to-day working relationships.",
    prompts: [
      "Where have you been strongest in how you work with others?",
      "What feedback have you heard from peers or partners?",
      "Which values or behaviors do you want to strengthen in the second half?",
      "Where could teamwork, communication, or ways of working feel even smoother?",
      "What helps you feel comfortable sharing ideas and perspectives?",
    ],
  },
  {
    key: "feedbackNotes",
    title: "4. Capture strengths, recognition, and support needs",
    duration: "10 min",
    goal: "Write down the strengths you want recognized, how support is working for you, and what would help you be even more effective.",
    prompts: [
      "One strength I want to highlight is…",
      "One area I want to improve is…",
      "Do you feel your work and contributions are being recognized in a meaningful way?",
      "What kind of recognition, feedback, or acknowledgment feels most motivating to you?",
      "What support would help me improve or accelerate?",
      "What kind of feedback has been most useful to you recently?",
      "What kind of support, clarity, or coaching would help you most right now?",
    ],
  },
  {
    key: "engagementNotes",
    title: "5. Reflect on motivation and day-to-day experience",
    duration: "10 min",
    goal: "Share what energizes you, what feels challenging, how sustainable the work feels, and what would make the next six months better.",
    prompts: [
      "When have you felt most energized in your work?",
      "Which parts of your role are most motivating?",
      "What has felt confusing or frustrating lately?",
      "How has your workload felt overall in the first half?",
      "What would make your day-to-day experience feel more sustainable or effective?",
    ],
  },
  {
    key: "developmentNotes",
    title: "6. Focus on development, career growth, and AI readiness",
    duration: "5–10 min",
    goal: "Call out growth goals, skills to build, career aspirations, stretch opportunities, and where AI support or training is needed.",
    prompts: [
      "How do you feel you're tracking on your growth goals?",
      "Are there any new skills you'd like to build?",
      "What kind of stretch assignment would help your development?",
      "Where would you like more coaching, visibility, or learning support?",
      "Where would more AI guidance, training, or clarity be useful?",
    ],
  },
  {
    key: "secondHalfPriorities",
    title: "7. Suggest second-half priorities, actions, and support",
    duration: "5–10 min",
    goal: "Outline your top priorities, likely roadblocks, support needs, preferred check-in cadence, and the actions that would make the biggest difference.",
    prompts: [
      "What should be your top priorities for the next 3–6 months?",
      "What roadblocks may slow you down?",
      "What support from your manager would make the biggest difference?",
      "How would you like to check in on progress?",
      "What team, process, or communication improvements would help you most in the second half?",
    ],
  },
  {
    key: "closingSummary",
    title: "8. Close with clear next steps",
    duration: "3–5 min",
    goal: "Summarize your strengths, focus areas, support needs, and what you want to leave the meeting aligned on.",
    prompts: [
      "To summarize, my key strengths are…",
      "The biggest focus areas for the second half are…",
      "The support I need most is…",
      "What I want us aligned on after this conversation is…",
    ],
  },
] as const;

function currentCycleLabel() {
  return FIXED_CYCLE_LABEL;
}

function cycleRange(label: string) {
  const year = Number(label.slice(0, 4)) || new Date().getFullYear();
  const isH1 = label.includes("H1");
  return {
    periodStart: `${year}-${isH1 ? "01" : "07"}-01`,
    periodEnd: `${year}-${isH1 ? "06" : "12"}-${isH1 ? "30" : "31"}`,
  };
}

function toShare(part: number, whole: number) {
  if (!whole) return null;
  return (part / whole) * 100;
}

function formatMetricNumber(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function discussionStatusColor(status: string | null | undefined) {
  if (status === "completed") return "teal";
  if (status === "scheduled") return "blue";
  if (status === "submitted") return "violet";
  return "gray";
}

function isManagerIdentity(identity: ReturnType<typeof useIdentity>["identity"]) {
  if (!identity) return false;
  if (identity.role === "manager") return true;

  const canonicalByName = identity.name ? ROLE_BY_NAME[identity.name.trim()] : undefined;
  if (canonicalByName === "manager") return true;

  const canonicalByEmail = identity.email
    ? ROSTER_BY_EMAIL[identity.email.trim().toLowerCase()]?.role
    : undefined;
  return canonicalByEmail === "manager";
}

function isSixMonthReviewRow(row: MetricRow, cycleLabel: string) {
  const year = Number(cycleLabel.slice(0, 4));
  const expectedYear = Number.isNaN(year) ? new Date().getFullYear() : year;

  if (!row.period_month) return false;
  const match = row.period_month.match(/(\d{4})-(\d{2})/);
  if (!match) return false;
  const rowYear = Number(match[1]);
  const rowMonth = Number(match[2]);
  return rowYear === expectedYear && rowMonth >= 1 && rowMonth <= 6;
}

function buildMetricsSnapshot(rows: MetricRow[], employeeName: string | null, teamRows: MetricRow[]) {
  const periods = new Set<string>();

  const normalizeRows = (inputRows: MetricRow[]) => {
    const sourceBuckets = inputRows.reduce<Record<string, MetricRow[]>>((acc, row) => {
      const source = row.source_type || "other";
      acc[source] = acc[source] ?? [];
      acc[source].push(row);
      return acc;
    }, {});

    return Object.values(sourceBuckets).flatMap((bucket) => {
      const monthlyRows = bucket.filter((row) => !!row.period_month);
      return monthlyRows.length > 0 ? monthlyRows : bucket;
    });
  };

  const normalizedRows = normalizeRows(rows);
  const normalizedTeamRows = normalizeRows(teamRows);

  for (const row of normalizedRows) {
    if (row.period_month) periods.add(row.period_month);
  }

  const memberKey = employeeName ?? normalizedRows[0]?.member_name ?? "";
  const memberNames = Array.from(new Set(normalizedTeamRows.map((row) => row.member_name).filter(Boolean)));

  const [summary] = aggregateMetrics(normalizedRows as never[], [memberKey], {
    excludeMaintenance: true,
    period: { type: "all" },
  });
  const teamSummaries = aggregateMetrics(normalizedTeamRows as never[], memberNames, {
    excludeMaintenance: true,
    period: { type: "all" },
  });

  const sumBuckets = (type: keyof NonNullable<typeof summary.byType>, field: keyof SourceBucket) => {
    return teamSummaries.reduce((sum, member) => {
      const bucket = member.byType[type] as SourceBucket | undefined;
      const value = bucket?.[field];
      return sum + (typeof value === "number" ? value : 0);
    }, 0);
  };

  const tickets = summary?.byType.tickets as SourceBucket | undefined;
  const calls = summary?.byType.calls as SourceBucket | undefined;
  const tasks = summary?.byType.tasks as SourceBucket | undefined;
  const audit = summary?.byType.audit as SourceBucket | undefined;

  const teamTicketsAcked = sumBuckets("tickets", "totalSum");
  const teamInboundCallsAnswered = sumBuckets("calls", "answeredCount");
  const teamRefusedCalls = sumBuckets("calls", "refusedCount");
  const teamTotalTasksWorked = sumBuckets("tasks", "totalSum");
  const teamCarrierMetCount = sumBuckets("tickets", "carrierUnder15Count");
  const teamCarrierEligibleCount = sumBuckets("tickets", "carrierTotalCount");
  const teamAckMinutesSum = sumBuckets("tickets", "ackMinutesSum");
  const teamAckMinutesSamples = sumBuckets("tickets", "ackMinutesSamples");
  const teamWaitSecondsSum = sumBuckets("calls", "waitSecondsSum");
  const teamWaitSecondsSamples = sumBuckets("calls", "waitSecondsSamples");

  const bySource: Record<string, number> = {
    ...(tickets ? { tickets: tickets.totalSum } : {}),
    ...(calls ? { calls: calls.answeredCount } : {}),
    ...(tasks ? { tasks: tasks.totalSum } : {}),
    ...(audit ? { audit: audit.totalSum } : {}),
  };

  const avgAckMinutes = tickets && tickets.ackMinutesSamples > 0
    ? tickets.ackMinutesSum / tickets.ackMinutesSamples
    : null;
  const avgSpeedOfAnswer = calls && calls.waitSecondsSamples > 0
    ? calls.waitSecondsSum / calls.waitSecondsSamples
    : null;
  const teamAvgAckMinutes = teamAckMinutesSamples > 0
    ? teamAckMinutesSum / teamAckMinutesSamples
    : null;
  const teamAvgSpeedOfAnswer = teamWaitSecondsSamples > 0
    ? teamWaitSecondsSum / teamWaitSecondsSamples
    : null;
  const carrierWithin15Pct = tickets && tickets.carrierTotalCount > 0
    ? (tickets.carrierUnder15Count / tickets.carrierTotalCount) * 100
    : null;
  const slaMetPct = tasks && tasks.slaMetTotalCount > 0
    ? (tasks.slaMetCount / tasks.slaMetTotalCount) * 100
    : null;

  return {
    records: normalizedRows.length,
    bySource,
    periods: Array.from(periods).slice(0, 8),
    ticketsAcked: tickets?.totalSum ?? 0,
    ticketsAckedSharePct: toShare(tickets?.totalSum ?? 0, teamTicketsAcked),
    avgAckMinutes,
    teamAvgAckMinutes,
    carrierWithin15Count: tickets?.carrierUnder15Count ?? 0,
    carrierEligibleCount: tickets?.carrierTotalCount ?? 0,
    carrierWithin15Pct,
    carrierWithin15SharePct: toShare(tickets?.carrierUnder15Count ?? 0, teamCarrierMetCount),
    inboundCallsAnswered: calls?.answeredCount ?? 0,
    inboundCallsAnsweredSharePct: toShare(calls?.answeredCount ?? 0, teamInboundCallsAnswered),
    refusedCalls: calls?.refusedCount ?? 0,
    refusedCallsSharePct: toShare(calls?.refusedCount ?? 0, teamRefusedCalls),
    avgSpeedOfAnswer,
    teamAvgSpeedOfAnswer,
    totalTasksWorked: tasks?.totalSum ?? 0,
    totalTasksWorkedSharePct: toShare(tasks?.totalSum ?? 0, teamTotalTasksWorked),
    slaMetPct,
    teamTotals: {
      ticketsAcked: teamTicketsAcked,
      inboundCallsAnswered: teamInboundCallsAnswered,
      refusedCalls: teamRefusedCalls,
      totalTasksWorked: teamTotalTasksWorked,
      carrierMetCount: teamCarrierMetCount,
      carrierEligibleCount: teamCarrierEligibleCount,
      avgAckMinutes: teamAvgAckMinutes,
      avgSpeedOfAnswer: teamAvgSpeedOfAnswer,
    },
  };
}

function parseMetricsSnapshot(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Snapshot;
  } catch {
    return null;
  }
}

function buildAiPrompt(employeeName: string, cycleLabel: string, snapshot: Snapshot, rows: MetricRow[]) {
  const compactRows = rows.slice(0, 60).map((row) => ({
    source: row.source_type,
    queue: row.queue,
    total_count: row.total_count,
    success_count: row.success_count,
    period_month: row.period_month,
    ack_minutes: row.ack_minutes,
    carrier_ticket_minutes: row.carrier_ticket_minutes,
    wait_seconds: row.wait_seconds,
  }));

  return `You are helping a manager prepare for a half-year performance review.
Use the employee's performance metrics as the ONLY evidence source.
The key metrics to evaluate are:
- Tickets Acked
- Avg Ack Time
- Carrier ≤ 15 min
- Inbound Calls (Answered)
- Refused Calls
- Avg Speed of Answer
- Total Tasks Worked
- SLA-Met %

Return plain text in exactly this format:
Strong areas:
- ...
- ...
Areas of improvement:
- ...
- ...
Manager talking points:
- ...
- ...

Rules:
- Be balanced, specific, and coaching-oriented.
- Reference trends or metric evidence when possible.
- Do not invent missing metrics.
- Do not mention compensation, promotion, or formal year-end review.
- If evidence is limited, say that briefly and stay cautious.

Employee: ${employeeName}
Cycle: ${cycleLabel}
Key metric summary: ${JSON.stringify(snapshot, null, 2)}
Supporting metric rows: ${JSON.stringify(compactRows, null, 2)}`;
}

function extractSection(text: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}:\\s*([\\s\\S]*?)(?=\\n[A-Z][^\\n]*:|$)`, "i");
  const match = text.match(regex);
  return match?.[1]?.trim() ?? "";
}

function answersToText(answers: string[]) {
  return JSON.stringify(answers);
}

function textToAnswers(value: string | null | undefined, count: number) {
  if (!value) return blankAnswers(count);
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return Array.from({ length: count }, (_, index) => String(parsed[index] ?? ""));
    }
  } catch {
    // fall through to legacy single-text handling
  }
  const answers = blankAnswers(count);
  answers[0] = value;
  return answers;
}

function sectionAnswerSummary(label: string, answers: string[]) {
  const filled = answers.map((answer) => answer.trim()).filter(Boolean);
  return filled.length ? `${label}: ${filled.join(" | ")}` : "";
}

function isReviewComplete(review: SelfReviewDraft) {
  return AGENDA_SECTIONS.every((section) =>
    review[section.key].every((answer) => answer.trim().length > 0),
  );
}

function createDiscussionSummary(review: SelfReviewDraft, managerSummary: string) {
  return [
    managerSummary.trim(),
    sectionAnswerSummary("Opening & tone", review.openingNotes),
    sectionAnswerSummary("Business impact", review.businessImpactNotes),
    sectionAnswerSummary("Behaviors & values", review.behaviorsNotes),
    sectionAnswerSummary("Feedback themes", review.feedbackNotes),
    sectionAnswerSummary("Engagement", review.engagementNotes),
    sectionAnswerSummary("Development", review.developmentNotes),
    sectionAnswerSummary("Second-half priorities", review.secondHalfPriorities),
    sectionAnswerSummary("Close & next steps", review.closingSummary),
  ].filter(Boolean).join("\n\n");
}

const QUESTION_NOTES_MARKER = "<!-- QUESTION_NOTES_JSON:";
const MANAGER_AUTOSAVE_PREFIX = "performance-discussions-manager-autosave-v1";

function buildQuestionPromptMap() {
  const map: Record<string, string> = {};
  for (const section of AGENDA_SECTIONS) {
    section.prompts.forEach((prompt, index) => {
      map[`${section.key}-${index}`] = prompt;
    });
  }
  return map;
}

const QUESTION_PROMPT_BY_ID = buildQuestionPromptMap();

function toPdfSafeText(text: string) {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2264/g, "<=")
    .replace(/\u2265/g, ">=")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapPdfText(text: string, maxChars = 92) {
  const normalized = toPdfSafeText(text);
  if (!normalized) return [""];

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

async function generateHalfYearlyQuestionsPdf() {
  const pdf = await PDFDocument.create();
  const pageSize: [number, number] = [612, 792];
  const marginX = 48;
  const marginTop = 56;
  const marginBottom = 52;
  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - marginTop;

  const ensureSpace = (needed = 20) => {
    if (y - needed < marginBottom) {
      page = pdf.addPage(pageSize);
      y = pageSize[1] - marginTop;
    }
  };

  const drawLines = (lines: string[], options?: { size?: number; color?: ReturnType<typeof rgb>; indent?: number; gap?: number; font?: typeof bodyFont }) => {
    const size = options?.size ?? 11;
    const color = options?.color ?? rgb(0.17, 0.24, 0.34);
    const indent = options?.indent ?? 0;
    const gap = options?.gap ?? 4;
    const font = options?.font ?? bodyFont;

    for (const line of lines) {
      ensureSpace(size + gap + 2);
      page.drawText(line, {
        x: marginX + indent,
        y,
        size,
        font,
        color,
      });
      y -= size + gap;
    }
  };

  page.drawText("Half-Yearly Discussion Questions", {
    x: marginX,
    y,
    size: 22,
    font: titleFont,
    color: rgb(0.09, 0.2, 0.3),
  });
  y -= 30;

  drawLines(wrapPdfText("Question bank for team half-yearly discussions. This export includes prompts only and does not include any employee answers."), {
    size: 11,
    color: rgb(0.33, 0.39, 0.46),
    gap: 5,
  });
  y -= 8;

  for (const section of AGENDA_SECTIONS) {
    ensureSpace(72);
    page.drawText(section.title, {
      x: marginX,
      y,
      size: 14,
      font: boldFont,
      color: rgb(0.12, 0.21, 0.34),
    });
    y -= 20;

    drawLines(wrapPdfText(`Suggested time: ${section.duration}`), {
      size: 10,
      color: rgb(0.43, 0.49, 0.56),
      font: boldFont,
    });
    drawLines(wrapPdfText(`Goal: ${section.goal}`), {
      size: 10,
      color: rgb(0.35, 0.41, 0.48),
      gap: 5,
    });
    y -= 4;

    section.prompts.forEach((prompt, index) => {
      const bulletLines = wrapPdfText(`${index + 1}. ${prompt}`, 84);
      drawLines(bulletLines, {
        size: 11,
        indent: 12,
        gap: 4,
        color: rgb(0.17, 0.24, 0.34),
      });
    });

    y -= 10;
  }

  const pdfBytes = await pdf.save();
  downloadBlob(new Blob([pdfBytes], { type: "application/pdf" }), "half-yearly-discussion-questions.pdf");
}

function parseSavedManagerNotes(rawValue: string | null | undefined) {
  const raw = rawValue ?? "";
  const questionNotes: QuestionNoteMap = {};
  let managerNotes = raw;

  const markerStart = raw.indexOf(QUESTION_NOTES_MARKER);
  if (markerStart >= 0) {
    const markerEnd = raw.indexOf("-->", markerStart);
    if (markerEnd > markerStart) {
      const jsonText = raw.slice(markerStart + QUESTION_NOTES_MARKER.length, markerEnd).trim();
      try {
        const parsed = JSON.parse(jsonText) as QuestionNoteMap;
        Object.assign(questionNotes, parsed ?? {});
      } catch {
        // ignore malformed stored JSON marker
      }
      managerNotes = `${raw.slice(0, markerStart).trim()}\n\n${raw.slice(markerEnd + 3).trim()}`.trim();
    }
  }

  if (Object.keys(questionNotes).length === 0 && managerNotes) {
    const lines = managerNotes.split("\n");
    const remainingLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      let matched = false;
      for (const [answerId, prompt] of Object.entries(QUESTION_PROMPT_BY_ID)) {
        if (trimmed.startsWith(`${prompt}:`)) {
          const note = trimmed.slice(prompt.length + 1).trim();
          if (note) questionNotes[answerId] = note;
          matched = true;
          break;
        }
      }
      if (!matched) remainingLines.push(line);
    }
    managerNotes = remainingLines.join("\n").trim();
  }

  return { managerNotes, questionNotes };
}

function buildSavedManagerNotes(managerNotes: string, aiTalkingPoints: string, questionNotes: QuestionNoteMap) {
  const cleanedQuestionNotes = Object.fromEntries(
    Object.entries(questionNotes).filter(([, value]) => value.trim().length > 0),
  );

  return [
    managerNotes.trim(),
    aiTalkingPoints.trim(),
    Object.keys(cleanedQuestionNotes).length
      ? `${QUESTION_NOTES_MARKER} ${JSON.stringify(cleanedQuestionNotes)} -->`
      : "",
  ].filter(Boolean).join("\n\n") || null;
}

type ManagerAutosaveDraft = {
  managerNotes: string;
  questionNotes: QuestionNoteMap;
  managerSummary: string;
  strengths: string;
  growthAreas: string;
  status: string;
  scheduledDate: string;
  discussionDate: string;
  updatedAt: string;
};

function managerAutosaveKey(managerName: string, employeeName: string, cycleLabel: string) {
  return `${MANAGER_AUTOSAVE_PREFIX}:${managerName}::${employeeName}::${cycleLabel}`;
}

function readManagerAutosave(key: string): ManagerAutosaveDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ManagerAutosaveDraft>;
    return {
      managerNotes: typeof parsed.managerNotes === "string" ? parsed.managerNotes : "",
      questionNotes: parsed.questionNotes && typeof parsed.questionNotes === "object" ? parsed.questionNotes as QuestionNoteMap : {},
      managerSummary: typeof parsed.managerSummary === "string" ? parsed.managerSummary : "",
      strengths: typeof parsed.strengths === "string" ? parsed.strengths : "",
      growthAreas: typeof parsed.growthAreas === "string" ? parsed.growthAreas : "",
      status: typeof parsed.status === "string" ? parsed.status : "draft",
      scheduledDate: typeof parsed.scheduledDate === "string" ? parsed.scheduledDate : "",
      discussionDate: typeof parsed.discussionDate === "string" ? parsed.discussionDate : "",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return null;
  }
}

function writeManagerAutosave(key: string, draft: ManagerAutosaveDraft) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // ignore storage write failures
  }
}

function clearManagerAutosave(key: string | null) {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage removal failures
  }
}

function reviewFromSubmission(submission: SubmissionRow | null | undefined): SelfReviewDraft {
  if (!submission) return { ...EMPTY_REVIEW, openingNotes: [...EMPTY_REVIEW.openingNotes], businessImpactNotes: [...EMPTY_REVIEW.businessImpactNotes], behaviorsNotes: [...EMPTY_REVIEW.behaviorsNotes], feedbackNotes: [...EMPTY_REVIEW.feedbackNotes], engagementNotes: [...EMPTY_REVIEW.engagementNotes], developmentNotes: [...EMPTY_REVIEW.developmentNotes], secondHalfPriorities: [...EMPTY_REVIEW.secondHalfPriorities], closingSummary: [...EMPTY_REVIEW.closingSummary] };
  return {
    openingNotes: textToAnswers(submission.opening_notes, 7),
    businessImpactNotes: textToAnswers(submission.business_impact_notes, 5),
    behaviorsNotes: textToAnswers(submission.behaviors_notes, 5),
    feedbackNotes: textToAnswers(submission.feedback_notes, 7),
    engagementNotes: textToAnswers(submission.engagement_notes, 5),
    developmentNotes: textToAnswers(submission.development_notes, 5),
    secondHalfPriorities: textToAnswers(submission.second_half_priorities, 5),
    closingSummary: textToAnswers(submission.closing_summary, 4),
    overallSummary: submission.overall_summary ?? "",
    employeeCommitments: submission.employee_commitments ?? "",
  };
}

function normalizeSubmissionKeyPart(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function submissionSortValue(submission: SubmissionRow) {
  const value = submission.updated_at ?? submission.submitted_at ?? submission.created_at ?? "";
  return value instanceof Date ? value.toISOString() : String(value);
}

function choosePreferredSubmission(rows: SubmissionRow[]) {
  return [...rows].sort((a, b) => {
    const aSubmitted = a.submission_status === "submitted" ? 1 : 0;
    const bSubmitted = b.submission_status === "submitted" ? 1 : 0;
    if (aSubmitted !== bSubmitted) return bSubmitted - aSubmitted;
    return submissionSortValue(b).localeCompare(submissionSortValue(a)) || b.id - a.id;
  })[0] ?? null;
}

function dedupeSubmissions(rows: SubmissionRow[]) {
  const grouped = new Map<string, SubmissionRow[]>();
  for (const row of rows) {
    const key = `${normalizeSubmissionKeyPart(row.employee_name)}::${normalizeSubmissionKeyPart(row.cycle_label)}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  return Array.from(grouped.values())
    .map((group) => choosePreferredSubmission(group))
    .filter((row): row is SubmissionRow => Boolean(row))
    .sort((a, b) => submissionSortValue(b).localeCompare(submissionSortValue(a)) || b.id - a.id);
}

function MetricStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card withBorder radius="md" p="sm">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
      <Text fw={800} size="lg" mt={4}>{value}</Text>
      {hint && <Text size="xs" c="dimmed" mt={4}>{hint}</Text>}
    </Card>
  );
}

function MetricsPanel({
  title,
  snapshot,
  rowCount,
}: {
  title: string;
  snapshot: Snapshot;
  rowCount: number;
}) {
  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="md">
        <Group justify="space-between">
          <Text fw={700}>{title}</Text>
          <Badge color="red" variant="light">{rowCount} rows</Badge>
        </Group>
        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
          <MetricStat label="Tickets Acked" value={String(snapshot.ticketsAcked || 0)} hint={snapshot.ticketsAckedSharePct != null ? `${formatMetricNumber(snapshot.ticketsAckedSharePct)}% of team` : undefined} />
          <MetricStat label="Avg Ack Time" value={snapshot.avgAckMinutes != null ? `${formatMetricNumber(snapshot.avgAckMinutes)} min` : "—"} hint={snapshot.teamAvgAckMinutes != null ? `Team avg ${formatMetricNumber(snapshot.teamAvgAckMinutes)} min` : undefined} />
          <MetricStat label="Inbound Calls (Answered)" value={String(snapshot.inboundCallsAnswered || 0)} hint={snapshot.inboundCallsAnsweredSharePct != null ? `${formatMetricNumber(snapshot.inboundCallsAnsweredSharePct)}% of team` : undefined} />
          <MetricStat label="Refused Calls" value={String(snapshot.refusedCalls || 0)} hint={snapshot.refusedCallsSharePct != null ? `${formatMetricNumber(snapshot.refusedCallsSharePct)}% of team` : undefined} />
          <MetricStat label="Carrier ≤ 15 min" value={snapshot.carrierWithin15Pct != null ? `${formatMetricNumber(snapshot.carrierWithin15Pct)}%` : "—"} hint={snapshot.carrierWithin15SharePct != null ? `${formatMetricNumber(snapshot.carrierWithin15SharePct)}% of team met count` : undefined} />
          <MetricStat label="Avg Speed of Answer" value={snapshot.avgSpeedOfAnswer != null ? `${formatMetricNumber(snapshot.avgSpeedOfAnswer)} sec` : "—"} hint={snapshot.teamAvgSpeedOfAnswer != null ? `Team avg ${formatMetricNumber(snapshot.teamAvgSpeedOfAnswer)} sec` : undefined} />
          <MetricStat label="Total Tasks Worked" value={String(snapshot.totalTasksWorked || 0)} hint={snapshot.totalTasksWorkedSharePct != null ? `${formatMetricNumber(snapshot.totalTasksWorkedSharePct)}% of team` : undefined} />
          <MetricStat label="SLA-Met %" value={snapshot.slaMetPct != null ? `${formatMetricNumber(snapshot.slaMetPct)}%` : "—"} />
        </SimpleGrid>
        <Divider />
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
          <MetricStat label="Carrier met count" value={snapshot.carrierEligibleCount ? `${snapshot.carrierWithin15Count}/${snapshot.carrierEligibleCount}` : "—"} />
          <MetricStat label="Metric periods" value={String(snapshot.periods.length)} />
        </SimpleGrid>
        <Box>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>Performance sources</Text>
          <Group gap="xs">
            {Object.entries(snapshot.bySource).length ? Object.entries(snapshot.bySource).map(([key, value]) => (
              <Badge key={key} variant="light" color="gray">{key}: {value}</Badge>
            )) : <Text size="sm" c="dimmed">No imported metrics found yet.</Text>}
          </Group>
        </Box>
        <Box>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>Periods covered</Text>
          <Group gap="xs">
            {snapshot.periods.length ? snapshot.periods.map((period) => (
              <Badge key={period} variant="outline" color="gray">{period}</Badge>
            )) : <Text size="sm" c="dimmed">No period metadata available.</Text>}
          </Group>
        </Box>
      </Stack>
    </Card>
  );
}

function ReviewSectionCard({
  section,
  review,
  onChange,
}: {
  section: (typeof AGENDA_SECTIONS)[number];
  review: SelfReviewDraft;
  onChange: (sectionKey: ReviewSectionKey, index: number, value: string) => void;
}) {
  return (
    <Card withBorder radius="md" p="sm" bg="color-mix(in srgb, var(--mantine-color-red-6) 3%, var(--mantine-color-body))">
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start">
          <Box>
            <Text fw={700}>{section.title}</Text>
            <Text size="sm" c="dimmed">{section.goal}</Text>
          </Box>
          <Badge variant="outline" color="gray">{section.duration}</Badge>
        </Group>
        <Stack gap="sm">
          {section.prompts.map((prompt, index) => (
            <Textarea
              key={prompt}
              label={prompt}
              minRows={2}
              value={review[section.key][index] ?? ""}
              onChange={(event) => onChange(section.key, index, event.currentTarget.value)}
            />
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}

function normalizeHighlights(highlights: TextHighlight[]) {
  const sorted = [...highlights]
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start);

  const merged: TextHighlight[] = [];
  for (const item of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || item.start > previous.end) {
      merged.push({ ...item });
    } else {
      previous.end = Math.max(previous.end, item.end);
    }
  }
  return merged;
}

function getSelectedRange(answerId: string) {
  if (typeof window === "undefined") return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const container = document.querySelector(`[data-answer-id="${answerId}"]`);
  if (!container) return null;
  if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return null;

  const range = selection.getRangeAt(0);
  const beforeRange = range.cloneRange();
  beforeRange.selectNodeContents(container);
  beforeRange.setEnd(range.startContainer, range.startOffset);

  const selectedText = range.toString();
  if (!selectedText.trim()) return null;

  const start = beforeRange.toString().length;
  const end = start + selectedText.length;
  return end > start ? { start, end } : null;
}

function AnswerText({ text, highlights, answerId }: { text: string; highlights: TextHighlight[]; answerId: string }) {
  const normalized = normalizeHighlights(highlights);
  if (normalized.length === 0) {
    return (
      <Text size="sm" style={{ whiteSpace: "pre-wrap" }} data-answer-id={answerId}>
        {text}
      </Text>
    );
  }

  const segments: Array<{ text: string; highlighted: boolean }> = [];
  let cursor = 0;
  for (const item of normalized) {
    if (item.start > cursor) {
      segments.push({ text: text.slice(cursor, item.start), highlighted: false });
    }
    segments.push({ text: text.slice(item.start, item.end), highlighted: true });
    cursor = item.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlighted: false });
  }

  return (
    <Text size="sm" style={{ whiteSpace: "pre-wrap" }} data-answer-id={answerId}>
      {segments.map((segment, index) => (
        <span
          key={`${answerId}-${index}`}
          style={segment.highlighted
            ? {
              backgroundColor: "color-mix(in srgb, var(--mantine-color-yellow-2) 88%, transparent)",
              borderRadius: 4,
              padding: "0 1px",
            }
            : undefined}
        >
          {segment.text}
        </span>
      ))}
    </Text>
  );
}

function ReadOnlyReviewAgenda({
  review,
  highlightedAnswers,
  questionNotes,
  onAddHighlight,
  onClearHighlights,
  onQuestionNoteChange,
  managerMode = true,
}: {
  review: SelfReviewDraft;
  highlightedAnswers?: HighlightMap;
  questionNotes?: QuestionNoteMap;
  onAddHighlight?: (answerId: string) => void;
  onClearHighlights?: (answerId: string) => void;
  onQuestionNoteChange?: (answerId: string, value: string) => void;
  managerMode?: boolean;
}) {
  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="md">
        <Box>
          <Text fw={700}>Employee self-review answers</Text>
          <Text size="sm" c="dimmed">Review each submitted answer below while preparing for the half-yearly discussion. Use highlight to flag answers you want to revisit in the meeting.</Text>
        </Box>
        {AGENDA_SECTIONS.map((section) => (
          <Card key={section.key} withBorder radius="md" p="sm" bg="color-mix(in srgb, var(--mantine-color-red-6) 3%, var(--mantine-color-body))">
            <Stack gap="xs">
              <Group justify="space-between" align="flex-start">
                <Box>
                  <Text fw={700}>{section.title}</Text>
                  <Text size="sm" c="dimmed">{section.goal}</Text>
                </Box>
                <Badge variant="outline" color="gray">{section.duration}</Badge>
              </Group>
              <Stack gap="sm">
                {section.prompts.map((prompt, index) => {
                  const answerId = `${section.key}-${index}`;
                  const answer = review[section.key][index]?.trim() || "—";
                  const answerHighlights = highlightedAnswers?.[answerId] ?? [];
                  const hasHighlights = answerHighlights.length > 0;
                  return (
                    <Box key={prompt}>
                      <Group justify="space-between" align="center" mb={4}>
                        <Text size="sm" fw={600}>{prompt}</Text>
                        {managerMode && (
                          <Group gap="xs">
                            <Button
                              size="compact-xs"
                              variant="light"
                              color="yellow"
                              onClick={() => onAddHighlight?.(answerId)}
                            >
                              Highlight selection
                            </Button>
                            {hasHighlights && (
                              <Button
                                size="compact-xs"
                                variant="subtle"
                                color="gray"
                                onClick={() => onClearHighlights?.(answerId)}
                              >
                                Clear
                              </Button>
                            )}
                          </Group>
                        )}
                      </Group>
                      <Card
                        withBorder
                        radius="md"
                        p="sm"
                        bg={hasHighlights
                          ? "color-mix(in srgb, var(--mantine-color-yellow-1) 40%, var(--mantine-color-body))"
                          : "color-mix(in srgb, var(--mantine-color-gray-1) 70%, var(--mantine-color-body))"}
                        style={hasHighlights ? { borderColor: "var(--mantine-color-yellow-5)" } : undefined}
                      >
                        <AnswerText text={answer} highlights={answerHighlights} answerId={answerId} />
                      </Card>
                      {managerMode && (
                        <Textarea
                          label="Manager note"
                          placeholder="Add a quick note for this answer"
                          minRows={2}
                          autosize
                          value={questionNotes?.[answerId] ?? ""}
                          onChange={(event) => onQuestionNoteChange?.(answerId, event.currentTarget.value)}
                          mt="xs"
                          c="violet.9"
                          styles={{
                            input: {
                              color: "var(--mantine-color-violet-9)",
                              background: "color-mix(in srgb, var(--mantine-color-violet-1) 72%, var(--mantine-color-body))",
                              borderColor: "var(--mantine-color-violet-3)",
                            },
                            label: {
                              color: "var(--mantine-color-violet-7)",
                              fontWeight: 700,
                            },
                          }}
                        />
                      )}
                    </Box>
                  );
                })}
              </Stack>
            </Stack>
          </Card>
        ))}
      </Stack>
    </Card>
  );
}

function SubmissionSummaryCard({ submission, onUseForManagerPrep }: { submission: SubmissionRow; onUseForManagerPrep?: () => void }) {
  const snapshot = parseMetricsSnapshot(submission.metrics_snapshot_json);
  return (
    <Card
      withBorder
      radius="md"
      p="md"
      onClick={onUseForManagerPrep}
      style={{ cursor: onUseForManagerPrep ? "pointer" : "default" }}
    >
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Box>
            <Text fw={700}>{submission.employee_name}</Text>
            <Text size="sm" c="dimmed">{submission.cycle_label}</Text>
          </Box>
          <Badge color={discussionStatusColor(submission.submission_status)} variant="light">{submission.submission_status}</Badge>
        </Group>
        <Group gap="xs">
          <Badge variant="outline" color="gray">{submission.period_start} → {submission.period_end}</Badge>
          {submission.submitted_at && <Badge variant="outline" color="violet">Submitted {submission.submitted_at}</Badge>}
        </Group>
        <Text size="sm" c="dimmed">
          Click this response to open the full read-only question-and-answer view, then prepare your manager review notes.
        </Text>
        {submission.overall_summary && (
          <Box>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>Employee overall summary</Text>
            <Text size="sm" lineClamp={4}>{submission.overall_summary}</Text>
          </Box>
        )}
        {snapshot && (
          <Group gap="xs">
            <Badge color="red" variant="light">Tickets {snapshot.ticketsAcked}</Badge>
            <Badge color="green" variant="light">Calls {snapshot.inboundCallsAnswered}</Badge>
            <Badge color="grape" variant="light">Tasks {snapshot.totalTasksWorked}</Badge>
          </Group>
        )}
        {onUseForManagerPrep && (
          <Group justify="flex-end">
            <Button
              size="xs"
              variant="light"
              color="red"
              onClick={(event) => {
                event.stopPropagation();
                onUseForManagerPrep();
              }}
            >
              Prepare for meeting
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  );
}

export function PerformanceDiscussionsTile({ onExpand }: { onExpand: () => void }) {
  const { identity } = useIdentity();
  const isManager = isManagerIdentity(identity);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const promise = isManager
      ? db.performance_discussion_submissions.list({ orderBy: { column: "created_at", ascending: false }, limit: 50 })
      : db.performance_discussion_submissions.list({ filter: { employee_name: identity?.name ?? "" }, orderBy: { column: "created_at", ascending: false }, limit: 10 });
    void promise.then((rows) => setCount(rows.length)).catch(() => setCount(0));
  }, [identity?.name, isManager]);

  return (
    <WidgetTile
      title="Half-Yearly Discussions"
      description={isManager ? "Review team self-submissions and prep manager discussions" : "Complete your half-year self-review before the meeting"}
      icon={IconCalendarStats}
      iconColor="red"
      status={{
        label: isManager ? "manager" : "team",
        color: "red",
        tooltip: isManager ? "Managers can see all submissions" : "Team members can submit their own answers",
      }}
      onExpand={onExpand}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="flex-end">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Submissions</Text>
            <Text size="xl" fw={800} c="red.4" ff="monospace">{count == null ? "…" : count}</Text>
          </Box>
          <Badge color="red" variant="light">Half-yearly</Badge>
        </Group>
        <Text size="xs" c="dimmed">
          {isManager
            ? "Managers can review every team submission and prepare final meeting notes."
            : "Complete your self-review in advance so the meeting can focus on discussion, support, and next steps."}
        </Text>
      </Stack>
    </WidgetTile>
  );
}

export function PerformanceDiscussionsWidget() {
  const { identity } = useIdentity();
  const isManager = isManagerIdentity(identity);
  const employeeNameFromIdentity = identity?.name ?? "";
  const managerName = identity?.name ?? "";

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [discussions, setDiscussions] = useState<DiscussionRow[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);

  const [employeeName, setEmployeeName] = useState<string | null>(isManager ? null : employeeNameFromIdentity || null);
  const [cycleLabel, setCycleLabel] = useState(currentCycleLabel());
  const [periodStart, setPeriodStart] = useState(cycleRange(currentCycleLabel()).periodStart);
  const [periodEnd, setPeriodEnd] = useState(cycleRange(currentCycleLabel()).periodEnd);
  const [status, setStatus] = useState<string | null>("draft");
  const [scheduledDate, setScheduledDate] = useState("");
  const [discussionDate, setDiscussionDate] = useState("");
  const [managerSummary, setManagerSummary] = useState("");
  const [strengths, setStrengths] = useState("");
  const [growthAreas, setGrowthAreas] = useState("");
  const [managerNotes, setManagerNotes] = useState("");
  const [employeeReview, setEmployeeReview] = useState<SelfReviewDraft>(EMPTY_REVIEW);
  const [submissionStatus, setSubmissionStatus] = useState<string | null>("draft");
  const [activeSubmissionId, setActiveSubmissionId] = useState<number | null>(null);
  const [aiTalkingPoints, setAiTalkingPoints] = useState("");
  const [teamReviewStep, setTeamReviewStep] = useState(0);
  const [highlightedAnswers, setHighlightedAnswers] = useState<HighlightMap>({});
  const [questionNotes, setQuestionNotes] = useState<QuestionNoteMap>({});

  const { complete, result: aiResult, isLoading: aiLoading, error: aiError, setResult: setAiResult } = useCompletion({ model: SUMMARY_AGENT_ID });

  const safeMetrics = Array.isArray(metrics) ? metrics : [];
  const safeDiscussions = Array.isArray(discussions) ? discussions : [];
  const safeSubmissions = Array.isArray(submissions) ? submissions : [];
  const dedupedSubmissions = useMemo(() => dedupeSubmissions(safeSubmissions), [safeSubmissions]);

  const scopedEmployeeName = isManager ? employeeName : employeeNameFromIdentity || null;
  const canSubmitReview = isReviewComplete(employeeReview);
  const totalTeamSteps = AGENDA_SECTIONS.length + 2;
  const employeeReviewReadOnlyStep = totalTeamSteps;
  const activeTeamSection = teamReviewStep > 0 && teamReviewStep <= AGENDA_SECTIONS.length
    ? AGENDA_SECTIONS[teamReviewStep - 1]
    : null;

  const selectedMetrics = useMemo(
    () => safeMetrics.filter((row) => row.member_name === scopedEmployeeName && isSixMonthReviewRow(row, cycleLabel)),
    [safeMetrics, scopedEmployeeName, cycleLabel],
  );
  const teamWindowMetrics = useMemo(
    () => metrics.filter((row) => isSixMonthReviewRow(row, cycleLabel)),
    [metrics, cycleLabel],
  );
  const snapshot = useMemo(
    () => buildMetricsSnapshot(selectedMetrics, scopedEmployeeName, teamWindowMetrics),
    [selectedMetrics, scopedEmployeeName, teamWindowMetrics],
  );

  const scopedSubmission = useMemo(() => {
    if (isManager) return dedupedSubmissions.find((submission) => submission.id === activeSubmissionId) ?? null;

    const matchingRows = safeSubmissions.filter((submission) => (
      normalizeSubmissionKeyPart(submission.employee_name) === normalizeSubmissionKeyPart(employeeNameFromIdentity)
      && normalizeSubmissionKeyPart(submission.cycle_label) === normalizeSubmissionKeyPart(cycleLabel)
    ));
    return choosePreferredSubmission(matchingRows);
  }, [activeSubmissionId, cycleLabel, dedupedSubmissions, employeeNameFromIdentity, isManager, safeSubmissions]);

  const hasExistingDraft = !isManager && submissionStatus === "draft" && Boolean(scopedSubmission);

  const sharedManagerDiscussion = useMemo(() => {
    if (!isManager || !scopedEmployeeName) return null;
    return safeDiscussions.find((discussion) => (
      discussion.employee_name === scopedEmployeeName && discussion.cycle_label === cycleLabel
    )) ?? null;
  }, [cycleLabel, isManager, safeDiscussions, scopedEmployeeName]);

  const managerAutosaveStorageKey = useMemo(() => {
    if (!isManager || !managerName || !scopedEmployeeName || !cycleLabel) return null;
    return managerAutosaveKey(managerName, scopedEmployeeName, cycleLabel);
  }, [cycleLabel, isManager, managerName, scopedEmployeeName]);

  async function load() {
    if (!identity) return;
    setLoading(true);
    setError(null);
    try {
      const submissionQuery = isManager
        ? db.performance_discussion_submissions.list({ orderBy: { column: "created_at", ascending: false }, limit: 500 })
        : db.performance_discussion_submissions.list({ filter: { employee_name: employeeNameFromIdentity }, orderBy: { column: "created_at", ascending: false }, limit: 50 });
      const discussionQuery = isManager
        ? db.performance_discussions.list({ orderBy: { column: "created_at", ascending: false }, limit: 500 })
        : Promise.resolve([] as DiscussionRow[]);
      const [metricRows, submissionRows, discussionRows] = await Promise.all([
        db.performance_metrics.list({ orderBy: { column: "created_at", ascending: false } }),
        submissionQuery,
        discussionQuery,
      ]);
      setMetrics(Array.isArray(metricRows) ? metricRows : []);
      setSubmissions(Array.isArray(submissionRows) ? submissionRows : []);
      setDiscussions(Array.isArray(discussionRows) ? discussionRows : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load half-year discussion data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [employeeNameFromIdentity, identity, isManager]);

  useEffect(() => {
    if (!aiResult) return;
    const strong = extractSection(aiResult, "Strong areas");
    const improve = extractSection(aiResult, "Areas of improvement");
    const talkingPoints = extractSection(aiResult, "Manager talking points");
    if (strong) setStrengths(strong);
    if (improve) setGrowthAreas(improve);
    if (talkingPoints) setAiTalkingPoints(talkingPoints);
  }, [aiResult]);

  useEffect(() => {
    if (!scopedSubmission) {
      if (!isManager) {
        setEmployeeReview(EMPTY_REVIEW);
        setSubmissionStatus("draft");
        setTeamReviewStep(0);
      }
      return;
    }
    setEmployeeReview(reviewFromSubmission(scopedSubmission));
    setSubmissionStatus(scopedSubmission.submission_status);
    if (!isManager) {
      setTeamReviewStep(scopedSubmission.submission_status === "submitted" ? totalTeamSteps - 1 : 0);
      return;
    }

    const parsedManagerNotes = parseSavedManagerNotes(sharedManagerDiscussion?.manager_notes);
    const autosavedDraft = managerAutosaveStorageKey
      ? readManagerAutosave(managerAutosaveStorageKey)
      : null;

    setManagerSummary(autosavedDraft?.managerSummary ?? sharedManagerDiscussion?.overall_summary ?? "");
    setStrengths(autosavedDraft?.strengths ?? sharedManagerDiscussion?.strengths ?? "");
    setGrowthAreas(autosavedDraft?.growthAreas ?? sharedManagerDiscussion?.growth_areas ?? "");
    setManagerNotes(autosavedDraft?.managerNotes ?? parsedManagerNotes.managerNotes);
    setQuestionNotes(autosavedDraft?.questionNotes ?? parsedManagerNotes.questionNotes);
    setStatus(autosavedDraft?.status ?? sharedManagerDiscussion?.status ?? "draft");
    setScheduledDate(autosavedDraft?.scheduledDate ?? sharedManagerDiscussion?.scheduled_date ?? "");
    setDiscussionDate(autosavedDraft?.discussionDate ?? sharedManagerDiscussion?.discussion_date ?? "");
  }, [isManager, managerAutosaveStorageKey, scopedSubmission, sharedManagerDiscussion, totalTeamSteps]);

  function updateReviewAnswer(sectionKey: ReviewSectionKey, index: number, value: string) {
    setEmployeeReview((prev) => ({
      ...prev,
      [sectionKey]: (prev[sectionKey] as string[]).map((answer: string, answerIndex: number) => (
        answerIndex === index ? value : answer
      )),
    }));
  }

  function loadSubmissionIntoManagerPrep(submission: SubmissionRow) {
    setActiveSubmissionId(submission.id);
    setEmployeeName(submission.employee_name);
    setCycleLabel(submission.cycle_label);
    setPeriodStart(submission.period_start);
    setPeriodEnd(submission.period_end);
    setEmployeeReview(reviewFromSubmission(submission));
    setManagerSummary(submission.overall_summary ?? "");
    setStatus("draft");
    setScheduledDate("");
    setDiscussionDate("");
    setStrengths("");
    setGrowthAreas("");
    setManagerNotes("");
    setAiTalkingPoints("");
    setAiResult("");
    setHighlightedAnswers({});
    setQuestionNotes({});
  }

  function updateQuestionNote(answerId: string, value: string) {
    setQuestionNotes((prev) => ({
      ...prev,
      [answerId]: value,
    }));
  }

  function addHighlightedAnswer(answerId: string) {
    const nextRange = getSelectedRange(answerId);
    if (!nextRange) return;
    setHighlightedAnswers((prev) => ({
      ...prev,
      [answerId]: normalizeHighlights([...(prev[answerId] ?? []), nextRange]),
    }));
    if (typeof window !== "undefined") {
      window.getSelection()?.removeAllRanges();
    }
  }

  function clearHighlightedAnswer(answerId: string) {
    setHighlightedAnswers((prev) => {
      const next = { ...prev };
      delete next[answerId];
      return next;
    });
  }

  useEffect(() => {
    if (!isManager || !managerAutosaveStorageKey || !scopedSubmission) return;
    writeManagerAutosave(managerAutosaveStorageKey, {
      managerNotes,
      questionNotes,
      managerSummary,
      strengths,
      growthAreas,
      status: status ?? "draft",
      scheduledDate,
      discussionDate,
      updatedAt: new Date().toISOString(),
    });
  }, [
    discussionDate,
    growthAreas,
    isManager,
    managerAutosaveStorageKey,
    managerNotes,
    managerSummary,
    questionNotes,
    scheduledDate,
    scopedSubmission,
    status,
    strengths,
  ]);

  async function saveSubmission(nextStatus: "draft" | "submitted") {
    if (!employeeNameFromIdentity) {
      setError("Missing employee identity.");
      return;
    }
    if (nextStatus === "submitted" && !canSubmitReview) {
      setError("Please answer every self-review question before submitting.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        employee_name: employeeNameFromIdentity,
        cycle_label: cycleLabel,
        period_start: periodStart,
        period_end: periodEnd,
        submission_status: nextStatus,
        opening_notes: answersToText(employeeReview.openingNotes),
        business_impact_notes: answersToText(employeeReview.businessImpactNotes),
        behaviors_notes: answersToText(employeeReview.behaviorsNotes),
        feedback_notes: answersToText(employeeReview.feedbackNotes),
        engagement_notes: answersToText(employeeReview.engagementNotes),
        development_notes: answersToText(employeeReview.developmentNotes),
        second_half_priorities: answersToText(employeeReview.secondHalfPriorities),
        closing_summary: answersToText(employeeReview.closingSummary),
        overall_summary: employeeReview.overallSummary || null,
        employee_commitments: employeeReview.employeeCommitments || null,
        metrics_snapshot_json: JSON.stringify(snapshot),
        submitted_at: nextStatus === "submitted" ? new Date().toISOString().slice(0, 10) : null,
        updated_at: new Date().toISOString(),
      };

      const existingSubmission = choosePreferredSubmission(safeSubmissions.filter((submission) => (
        normalizeSubmissionKeyPart(submission.employee_name) === normalizeSubmissionKeyPart(employeeNameFromIdentity)
        && normalizeSubmissionKeyPart(submission.cycle_label) === normalizeSubmissionKeyPart(cycleLabel)
      )));

      if (existingSubmission?.id) {
        await db.performance_discussion_submissions.updateById(existingSubmission.id, payload);
      } else {
        await db.performance_discussion_submissions.insert(payload);
      }
      setSubmissionStatus(nextStatus);
      if (nextStatus === "submitted") {
        setTeamReviewStep(totalTeamSteps - 1);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save self-review submission.");
    } finally {
      setSaving(false);
    }
  }

  async function enableSubmissionEditing() {
    if (!scopedSubmission?.id) return;
    setSaving(true);
    setError(null);
    try {
      await db.performance_discussion_submissions.updateById(scopedSubmission.id, {
        submission_status: "draft",
        updated_at: new Date().toISOString(),
      });
      setSubmissionStatus("draft");
      setTeamReviewStep(0);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reopen submission for editing.");
    } finally {
      setSaving(false);
    }
  }

  async function generateAiInsights() {
    if (!scopedEmployeeName) {
      setError("Select an employee before generating AI insights.");
      return;
    }
    setError(null);
    const prompt = buildAiPrompt(scopedEmployeeName, cycleLabel, snapshot, selectedMetrics);
    await complete(prompt);
  }

  async function saveDiscussion() {
    if (!scopedEmployeeName || !status) {
      setError("Choose an employee and status before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await db.performance_discussions.insert({
        employee_name: scopedEmployeeName,
        manager_name: managerName,
        cycle_label: cycleLabel,
        period_start: periodStart,
        period_end: periodEnd,
        status,
        scheduled_date: scheduledDate || null,
        discussion_date: discussionDate || null,
        overall_summary: createDiscussionSummary(employeeReview, managerSummary) || null,
        strengths: strengths || null,
        growth_areas: growthAreas || null,
        manager_notes: buildSavedManagerNotes(managerNotes, aiTalkingPoints, questionNotes),
        employee_commitments: employeeReview.employeeCommitments || null,
        metrics_snapshot_json: JSON.stringify(snapshot),
        updated_at: new Date().toISOString(),
      });
      clearManagerAutosave(managerAutosaveStorageKey);
      setManagerSummary("");
      setStrengths("");
      setGrowthAreas("");
      setManagerNotes("");
      setAiTalkingPoints("");
      setAiResult("");
      setScheduledDate("");
      setDiscussionDate("");
      setStatus("draft");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save manager discussion.");
    } finally {
      setSaving(false);
    }
  }

  if (!identity) {
    return (
      <WidgetFrame title="Half-Yearly Discussions" subtitle="Sign in required" icon={IconCalendarStats} iconColor="red">
        <Alert color="gray">Sign in to access your self-review or manager review workflow.</Alert>
      </WidgetFrame>
    );
  }

  if (!isManager) {
    return (
      <WidgetFrame
        title="Half-Yearly Discussions"
        subtitle="Complete your self-review before the meeting"
        icon={IconCalendarStats}
        iconColor="red"
        onRefresh={() => void load()}
        loading={loading}
        status={{ label: submissionStatus ?? "draft", color: submissionStatus === "submitted" ? "violet" : "red" }}
        headerActions={<Badge variant="light" color="red">Team self-review</Badge>}
      >
        <Stack gap="lg">
          {(error || aiError) && <Alert color="red">{error || aiError}</Alert>}

          {teamReviewStep === 0 && (
            <>
              <Card withBorder radius="md" p="md">
                <Stack gap="md">
                  <Group justify="space-between" align="center">
                    <Box>
                      <Text fw={700}>Your half-year self-review</Text>
                      <Text size="sm" c="dimmed">Review your Jan–Jun metrics first, then start the guided self-review.</Text>
                    </Box>
                    <Group>
                      <Badge variant="light" color="violet">{submissionStatus === "submitted" ? "Submitted" : "Draft"}</Badge>
                      {submissionStatus === "submitted" && (
                        <Button leftSection={<IconUserEdit size={16} />} variant="light" color="gray" onClick={() => void enableSubmissionEditing()} loading={saving}>Edit submission</Button>
                      )}
                    </Group>
                  </Group>
                  <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                    <TextInput label="Employee" value={employeeNameFromIdentity} readOnly />
                    <TextInput label="Cycle" value={cycleLabel} readOnly />
                  </SimpleGrid>
                </Stack>
              </Card>

              <MetricsPanel title="Your performance metrics" snapshot={snapshot} rowCount={selectedMetrics.length} />

              <Card withBorder radius="md" p="md">
                <Stack gap="md">
                  <Box>
                    <Text fw={700}>{hasExistingDraft ? "Your draft is ready to continue" : "Start when you're ready"}</Text>
                    <Text size="sm" c="dimmed">
                      {hasExistingDraft
                        ? "You already have a saved draft for this cycle. Open it to continue editing your responses before submitting."
                        : "You will answer one section at a time. You can go back anytime, and you can save a draft before submitting."}
                    </Text>
                  </Box>
                  <Group justify="space-between" align="center">
                    <Text size="sm" c="dimmed">8 guided sections</Text>
                    <Group>
                      <Button variant="light" color="gray" onClick={() => void saveSubmission("draft")} loading={saving}>Save draft</Button>
                      <Button color="red" onClick={() => setTeamReviewStep(1)}>{hasExistingDraft ? "Open draft" : "Start self-review"}</Button>
                    </Group>
                  </Group>
                </Stack>
              </Card>
            </>
          )}

          {activeTeamSection && (
            <Card withBorder radius="md" p="md">
              <Stack gap="md">
                <Group justify="space-between" align="center">
                  <Box>
                    <Text fw={700}>Section {teamReviewStep} of {AGENDA_SECTIONS.length}</Text>
                    <Text size="sm" c="dimmed">Only this section is shown on this page.</Text>
                  </Box>
                  <Badge variant="outline" color="gray">{activeTeamSection.duration}</Badge>
                </Group>
                <ReviewSectionCard section={activeTeamSection} review={employeeReview} onChange={updateReviewAnswer} />
                <Group justify="space-between">
                  <Button variant="light" color="gray" onClick={() => setTeamReviewStep((step) => Math.max(0, step - 1))}>Back</Button>
                  <Group>
                    <Button variant="light" color="gray" onClick={() => void saveSubmission("draft")} loading={saving}>Save draft</Button>
                    <Button color="red" onClick={() => setTeamReviewStep((step) => Math.min(AGENDA_SECTIONS.length + 1, step + 1))}>
                      {teamReviewStep === AGENDA_SECTIONS.length ? "Review submission" : "Next section"}
                    </Button>
                  </Group>
                </Group>
              </Stack>
            </Card>
          )}

          {teamReviewStep === AGENDA_SECTIONS.length + 1 && submissionStatus !== "submitted" && (
            <Card withBorder radius="md" p="md">
              <Stack gap="md">
                <Group justify="space-between" align="center">
                  <Text fw={700}>Final summary and submission</Text>
                  <Badge color="teal" variant="light">Ready to review</Badge>
                </Group>
                <Text size="sm" c="dimmed">Add any final notes, then save as draft or submit your full response.</Text>
                <Textarea
                  label="Overall summary"
                  minRows={3}
                  value={employeeReview.overallSummary}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setEmployeeReview((prev) => ({ ...prev, overallSummary: value }));
                  }}
                />
                <Textarea
                  label="Commitments / follow-ups you want to own"
                  minRows={4}
                  value={employeeReview.employeeCommitments}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setEmployeeReview((prev) => ({ ...prev, employeeCommitments: value }));
                  }}
                />
                {!canSubmitReview && (
                  <Alert color="yellow">Please answer every question in all sections before submitting your responses.</Alert>
                )}
                <Group justify="space-between">
                  <Button variant="light" color="gray" onClick={() => setTeamReviewStep(AGENDA_SECTIONS.length)}>Back</Button>
                  <Group>
                    <Button leftSection={<IconCheck size={16} />} variant="light" color="gray" onClick={() => void saveSubmission("draft")} loading={saving}>Save draft</Button>
                    <Button leftSection={<IconUserEdit size={16} />} color="red" onClick={() => void saveSubmission("submitted")} loading={saving} disabled={!canSubmitReview}>Submit answers</Button>
                  </Group>
                </Group>
              </Stack>
            </Card>
          )}

          {teamReviewStep === totalTeamSteps - 1 && submissionStatus === "submitted" && (
            <Card withBorder radius="md" p="md">
              <Stack gap="md" align="flex-start">
                <Badge color="violet" variant="light">Responses submitted</Badge>
                <Text fw={700} size="lg">Thank you for submitting the responses.</Text>
                <Text size="sm" c="dimmed">
                  We will review and discuss this in the upcoming half yearly performance review meeting.
                </Text>
                <Group>
                  <Button variant="light" color="violet" onClick={() => setTeamReviewStep(employeeReviewReadOnlyStep)}>
                    View submitted responses
                  </Button>
                  <Button leftSection={<IconUserEdit size={16} />} variant="light" color="gray" onClick={() => void enableSubmissionEditing()} loading={saving}>
                    Edit submission
                  </Button>
                </Group>
              </Stack>
            </Card>
          )}

          {teamReviewStep === employeeReviewReadOnlyStep && submissionStatus === "submitted" && (
            <>
              <Card withBorder radius="md" p="md">
                <Group justify="space-between" align="center">
                  <Box>
                    <Text fw={700}>Your submitted responses</Text>
                    <Text size="sm" c="dimmed">This is a read-only view of the answers you submitted for the half-year review.</Text>
                  </Box>
                  <Group>
                    <Button variant="light" color="gray" onClick={() => setTeamReviewStep(totalTeamSteps - 1)}>
                      Back
                    </Button>
                    <Button leftSection={<IconUserEdit size={16} />} variant="light" color="gray" onClick={() => void enableSubmissionEditing()} loading={saving}>
                      Edit submission
                    </Button>
                  </Group>
                </Group>
              </Card>

              <ReadOnlyReviewAgenda review={employeeReview} managerMode={false} />

              <Card withBorder radius="md" p="md">
                <Stack gap="sm">
                  <Text fw={700}>Your final notes</Text>
                  <Box>
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>Overall summary</Text>
                    <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{employeeReview.overallSummary || "—"}</Text>
                  </Box>
                  <Box>
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>Commitments / follow-ups</Text>
                    <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{employeeReview.employeeCommitments || "—"}</Text>
                  </Box>
                </Stack>
              </Card>
            </>
          )}
        </Stack>
      </WidgetFrame>
    );
  }

  const submittedResponses = dedupedSubmissions.filter((submission) => submission.submission_status === "submitted");

  return (
    <WidgetFrame
      title="Half-Yearly Discussions"
      subtitle="Review submitted responses and prepare for the meeting"
      icon={IconCalendarStats}
      iconColor="red"
      onRefresh={() => void load()}
      loading={loading}
      status={{ label: `${submittedResponses.length} submitted`, color: "red" }}
      headerActions={<Badge variant="light" color="red">Managers only</Badge>}
    >
      <Stack gap="lg">
        <Group justify="space-between" align="center">
          <Text size="sm" c="dimmed">Export the question bank as a PDF without any employee answers.</Text>
          <Button variant="light" color="red" leftSection={<IconClipboardText size={16} />} onClick={() => void generateHalfYearlyQuestionsPdf()}>
            Download questions PDF
          </Button>
        </Group>
        {(error || aiError) && <Alert color="red">{error || aiError}</Alert>}

        {!scopedSubmission ? (
          <Stack gap="sm">
            <Group justify="space-between">
              <Box>
                <Text fw={700}>Submitted responses</Text>
                <Text size="sm" c="dimmed">Open a submitted self-review to prepare for the employee's half-yearly discussion.</Text>
              </Box>
              <Button variant="subtle" leftSection={<IconRefresh size={16} />} onClick={() => void load()}>Refresh</Button>
            </Group>
            {submittedResponses.length === 0 ? (
              <Alert color="gray" icon={<IconUsers size={16} />}>No submitted responses yet. Team members will appear here once they submit their self-review.</Alert>
            ) : (
              <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
                {submittedResponses.map((submission) => (
                  <SubmissionSummaryCard
                    key={submission.id}
                    submission={submission}
                    onUseForManagerPrep={() => loadSubmissionIntoManagerPrep(submission)}
                  />
                ))}
              </SimpleGrid>
            )}
          </Stack>
        ) : (
          <>
            <Card withBorder radius="md" p="md">
              <Stack gap="md">
                <Group justify="space-between" align="center">
                  <Box>
                    <Text fw={700}>Prepare for meeting</Text>
                    <Text size="sm" c="dimmed">Review the submitted answers below, then complete your manager review at the end.</Text>
                  </Box>
                  <Group>
                    <Button variant="light" color="gray" onClick={() => {
                      setActiveSubmissionId(null);
                      setEmployeeName(null);
                      setManagerSummary("");
                      setStrengths("");
                      setGrowthAreas("");
                      setManagerNotes("");
                      setAiTalkingPoints("");
                      setAiResult("");
                      setHighlightedAnswers({});
                      setQuestionNotes({});
                    }}>Back to submitted responses</Button>
                    <Button leftSection={<IconSparkles size={16} />} variant="light" color="violet" onClick={() => void generateAiInsights()} loading={aiLoading} disabled={!scopedEmployeeName || selectedMetrics.length === 0}>Generate AI insights</Button>
                    <Button leftSection={<IconCheck size={16} />} color="red" onClick={() => void saveDiscussion()} loading={saving}>Save discussion</Button>
                  </Group>
                </Group>
                <Alert color="violet" icon={<IconClipboardText size={16} />}>
                  Reviewing <strong>{scopedSubmission.employee_name}</strong>'s submitted self-review for {scopedSubmission.cycle_label}.
                </Alert>
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                  <TextInput label="Employee" value={scopedSubmission.employee_name} readOnly />
                  <TextInput label="Cycle" value={scopedSubmission.cycle_label} readOnly />
                  <TextInput label="Period start" value={periodStart} readOnly />
                  <TextInput label="Period end" value={periodEnd} readOnly />
                  <TextInput
                    label="Status"
                    value={status ?? "draft"}
                    onChange={(e) => setStatus(e.currentTarget.value || "draft")}
                    placeholder="draft / scheduled / completed"
                  />
                  <TextInput label="Scheduled date" type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.currentTarget.value)} />
                  <TextInput label="Discussion completed date" type="date" value={discussionDate} onChange={(e) => setDiscussionDate(e.currentTarget.value)} />
                  <TextInput label="Manager" value={managerName} readOnly />
                </SimpleGrid>
              </Stack>
            </Card>

            <ReadOnlyReviewAgenda
              review={employeeReview}
              highlightedAnswers={highlightedAnswers}
              questionNotes={questionNotes}
              onAddHighlight={addHighlightedAnswer}
              onClearHighlights={clearHighlightedAnswer}
              onQuestionNoteChange={updateQuestionNote}
            />

            <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="lg">
              <MetricsPanel title="Employee performance metrics" snapshot={snapshot} rowCount={selectedMetrics.length} />
              <Card withBorder radius="md" p="md">
                <Stack gap="md">
                  <Group justify="space-between">
                    <Text fw={700}>AI review insights</Text>
                    <Badge color="violet" variant="light">Summary Generator</Badge>
                  </Group>
                  <Text size="sm" c="dimmed">Generates strengths, improvement areas, and talking points from the employee's Jan–Jun metrics.</Text>
                  {aiLoading ? (
                    <Group gap="xs"><Loader size="xs" /><Text size="sm" c="dimmed">Analyzing performance metrics…</Text></Group>
                  ) : aiResult ? (
                    <Textarea value={aiResult} readOnly minRows={12} autosize />
                  ) : (
                    <Alert color="gray" icon={<IconBrain size={16} />}>Click <strong>Generate AI insights</strong> to analyze strong areas and areas of improvement.</Alert>
                  )}
                  {aiTalkingPoints && (
                    <Box>
                      <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>Manager talking points</Text>
                      <Textarea value={aiTalkingPoints} readOnly minRows={5} autosize />
                    </Box>
                  )}
                </Stack>
              </Card>
            </SimpleGrid>

            <Card withBorder radius="md" p="md">
              <Stack gap="md">
                <Group justify="space-between" align="center">
                  <Text fw={700}>Manager review</Text>
                  <Badge color="teal" variant="light" leftSection={<IconTargetArrow size={12} />}>Ready for save</Badge>
                </Group>
                <Textarea label="Overall summary" minRows={3} value={managerSummary} onChange={(e) => setManagerSummary(e.currentTarget.value)} />
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                  <Textarea label="Strengths" minRows={5} value={strengths} onChange={(e) => setStrengths(e.currentTarget.value)} />
                  <Textarea label="Areas of improvement" minRows={5} value={growthAreas} onChange={(e) => setGrowthAreas(e.currentTarget.value)} />
                </SimpleGrid>
                <Textarea label="Manager notes / support plan" minRows={4} value={managerNotes} onChange={(e) => setManagerNotes(e.currentTarget.value)} />
                <Textarea
                  label="Employee commitments / follow-ups"
                  minRows={4}
                  value={employeeReview.employeeCommitments}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setEmployeeReview((prev) => ({ ...prev, employeeCommitments: value }));
                  }}
                />
              </Stack>
            </Card>
          </>
        )}
      </Stack>
    </WidgetFrame>
  );
}
