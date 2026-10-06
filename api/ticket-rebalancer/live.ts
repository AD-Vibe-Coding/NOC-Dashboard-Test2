import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireManager } from "../_lib/auth-middleware.js";

const TICKET_REBALANCER_AGENT_ID = "48f58a17-ed7a-4220-b11b-d110f72aae3e";
const DEFAULT_PLATFORM_URL = "https://devs.ai";

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanOptionalString(value: unknown): string | undefined {
  const next = cleanString(value);
  return next || undefined;
}

function cleanAge(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : trimmed;
  }
  return undefined;
}

function cleanDueDate(value: unknown): unknown {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

type NormalizedLiveTicket = {
  ticket: string;
  owner: string;
  stage: string;
  priority: string;
  service: string;
  issue?: string;
  type?: string;
  age?: number | string;
  last_updated_on?: string;
  due_date?: unknown;
  _raw?: Record<string, unknown>;
};

type ValidationIssue = {
  ticket: string;
  issue: string;
};

function normalizeTicket(ticketLike: unknown, index: number): { ticket: NormalizedLiveTicket | null; issues: ValidationIssue[] } {
  const row = asObject(ticketLike);
  if (!row) {
    return {
      ticket: null,
      issues: [{ ticket: `row-${index + 1}`, issue: "Ticket row was not an object" }],
    };
  }

  const ticket = cleanString(row.ticket ?? row.ticket_id ?? row.id ?? row.number);
  const owner = cleanString(row.owner ?? row.assignee ?? row.assigned_to);
  const stage = cleanString(row.stage ?? row.status);
  const priority = cleanString(row.priority ?? row.priority_level);
  const service = cleanString(row.service ?? row.service_name ?? row.service_type);

  const issues: ValidationIssue[] = [];
  const label = ticket || `row-${index + 1}`;

  if (!ticket) issues.push({ ticket: label, issue: "Missing ticket number" });
  if (!owner) issues.push({ ticket: label, issue: "Missing owner" });
  if (!stage) issues.push({ ticket: label, issue: "Missing stage" });
  if (!priority) issues.push({ ticket: label, issue: "Missing priority" });
  if (!service) issues.push({ ticket: label, issue: "Missing service" });

  if (issues.length > 0) {
    return { ticket: null, issues };
  }

  return {
    ticket: {
      ticket,
      owner,
      stage,
      priority,
      service,
      issue: cleanOptionalString(row.issue ?? row.issue_type),
      type: cleanOptionalString(row.type ?? row.ticket_type),
      age: cleanAge(row.age ?? row.age_days),
      last_updated_on: cleanOptionalString(row.last_updated_on ?? row.last_updated ?? row.updated_at),
      due_date: cleanDueDate(row.due_date ?? row.due ?? row.next_action ?? row.follow_up),
      _raw: row,
    },
    issues: [],
  };
}

function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  const start = [firstBrace, firstBracket].filter((value) => value >= 0).sort((a, b) => a - b)[0];
  return start >= 0 ? text.slice(start).trim() : text.trim();
}

function tryParseResponseJson(rawText: string): Record<string, unknown> | null {
  const candidate = extractJsonBlock(rawText);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    return asObject(parsed);
  } catch {
    return null;
  }
}

function collectOutputText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const parts: string[] = [];
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string") parts.push(part.text);
    }
  }
  return parts.join("\n").trim();
}

function buildPrompt(targetDate: string) {
  return [
    `Use ${targetDate} as the requested analysis date context if the API supports date-aware filtering, but do not exclude still-open tickets solely because they were opened earlier.`,
    "Show all open trouble tickets across all customers using closeDate = null as the definition of open.",
    "Apply these filters:",
    '- Exclude tickets where issue = "Maintenance Notification Issue"',
    '- Exclude tickets where stage = "Pending Complete"',
    "Sort by:",
    "- openedOn descending",
    "Return all matching results, not just the first page. If there are more than 100 results, fetch them in batches and combine them before responding.",
    "Return ONLY strict JSON with this exact shape:",
    '{"source":"short source name","fetched_at":"ISO timestamp if available","totalCount":0,"tickets":[{"ticket":"","ticketId":"","subject":"","issue":"","openedOn":"","stage":"","lastUpdatedBy":"","owner":"","priority":"","service":"","type":"","age":"","last_updated_on":"","due_date":""}]}',
    "JSON rules:",
    "- No markdown, no commentary, no prose, no table formatting.",
    "- Do not include closed tickets.",
    "- Keep field names exactly as shown.",
    "- Map ticket/ticketId to the ticket identifier.",
    "- Map last_updated_on from openedOn or other update fields only if a dedicated last-updated field is unavailable.",
    "- Preserve raw owner/stage/priority text from the source system.",
    "- Include subject, openedOn, and lastUpdatedBy when available.",
    "- Omit optional fields only when the source truly has no value.",
  ].join("\n");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireManager(req, res)) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const targetDate = typeof req.query.date === "string" ? req.query.date.trim() : "";
  if (!targetDate) {
    return res.status(400).json({ error: "date query parameter is required (YYYY-MM-DD)." });
  }

  const apiKey = process.env.AI_API_KEY;
  const platformUrl = process.env.AI_PLATFORM_URL || DEFAULT_PLATFORM_URL;

  if (!apiKey) {
    return res.status(500).json({ error: "AI_API_KEY not configured on the server." });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${platformUrl}/api/v2/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TICKET_REBALANCER_AGENT_ID,
        input: buildPrompt(targetDate),
        stream: false,
      }),
    });
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : "Live ticket upstream request failed.",
    });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return res.status(upstream.status).json({
      error: `Live ticket upstream returned ${upstream.status}.`,
      detail: detail.slice(0, 800),
    });
  }

  const payload = await upstream.json().catch(() => null);
  const outputText = collectOutputText(payload);
  const parsed = tryParseResponseJson(outputText);

  if (!parsed) {
    return res.status(502).json({
      error: "Live ticket agent returned non-JSON output.",
      detail: outputText.slice(0, 800),
    });
  }

  const ticketRows = Array.isArray(parsed.tickets) ? parsed.tickets : [];
  const normalizedTickets: NormalizedLiveTicket[] = [];
  const validationIssues: ValidationIssue[] = [];

  ticketRows.forEach((ticketLike, index) => {
    const normalized = normalizeTicket(ticketLike, index);
    if (normalized.ticket) normalizedTickets.push(normalized.ticket);
    if (normalized.issues.length > 0) validationIssues.push(...normalized.issues);
  });

  return res.status(200).json({
    source: cleanString(parsed.source) || "Live iPath API",
    fetchedAt: cleanString(parsed.fetched_at) || new Date().toISOString(),
    targetDate,
    totalReceived: ticketRows.length,
    validTickets: normalizedTickets.length,
    invalidTickets: validationIssues.length,
    validationIssues,
    tickets: normalizedTickets,
  });
}

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};
