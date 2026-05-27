import { useCallback, useEffect, useState } from "react";

export interface TicketAudit {
  id: number;
  file_name: string;
  file_size_bytes: number;
  ticket_number: string | null;
  ticket_subject: string | null;
  agent_name: string | null;
  agent_name_raw: string | null;
  overall_score: number | null;
  grade: string | null;
  criteria_json: string | null;
  analysis_markdown: string;
  audit_month: string | null;
  queue: string | null;
  audited_by: string | null;
  metrics_id: number | null;
  created_at: string;
}

export function useTicketAudits() {
  const [audits, setAudits] = useState<TicketAudit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/ticket-audits");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setAudits(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audits");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const saveAudit = useCallback(async (payload: Omit<TicketAudit, "id" | "created_at">) => {
    const r = await fetch("/api/ticket-audits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error ?? `HTTP ${r.status}`);
    }
    const saved = await r.json();
    await refresh();
    return saved as TicketAudit;
  }, [refresh]);

  const deleteAudit = useCallback(async (id: number) => {
    const r = await fetch(`/api/ticket-audits/${id}`, { method: "DELETE" });
    if (!r.ok && r.status !== 204) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error ?? `HTTP ${r.status}`);
    }
    await refresh();
  }, [refresh]);

  const clearAllAudits = useCallback(async () => {
    const r = await fetch("/api/ticket-audits", { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error ?? `HTTP ${r.status}`);
    }
    await refresh();
  }, [refresh]);

  return { audits, loading, error, refresh, saveAudit, deleteAudit, clearAllAudits };
}

// ── Types for the structured audit JSON the agent returns ────────────────────
export interface AuditIndividual {
  name: string;
  role: "Owner" | "Contributor" | string;
  scores: Record<string, { score: number; max: number; deduction_reason: string }>;
  total_score: number;
  grade: string;
  what_did_well: string;
  what_missed: string;
}

export interface ParsedAuditResult {
  ticket_number: string | null;
  ticket_subject: string | null;
  ticket_date: string | null;
  audit_month: string | null;
  queue: string | null;
  individuals: AuditIndividual[];
}

/**
 * Parse the structured JSON block the agent returns.
 * Returns null if no valid JSON block found.
 */
export function parseAuditJson(markdown: string): ParsedAuditResult | null {
  // Parse the structured ```json block the agent returns
  const jsonMatch = markdown.match(/```json\s*([\s\S]*?)```/i);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed.individuals) && parsed.individuals.length > 0) {
        return parsed as ParsedAuditResult;
      }
    } catch { /* fall through to legacy */ }
  }

  // ── Legacy fallback: plain-text extraction for old format ──────────────────
  const result: Record<string, unknown> = {};

  // Helper: search for a value after a label in the text
  // Handles: "**Label:** value", "| Label | value |", "Label: value"
  function extract(patterns: RegExp[]): string | null {
    for (const re of patterns) {
      const m = markdown.match(re);
      if (m?.[1]) return m[1].trim().replace(/\*+/g, "").trim();
    }
    return null;
  }

  // Ticket Number
  const tn = extract([
    /ticket\s*(?:number|#|id)[:\s|*]+([A-Z0-9\-_]+)/i,
    /\|\s*Ticket\s*(?:Number|#|ID)\s*\|\s*([A-Z0-9\-_]+)/i,
  ]);
  if (tn) result.ticket_number = tn;

  // Ticket Subject / Title
  const subj = extract([
    /ticket\s*subject[:\s|*]+(.*?)(?:\n|$)/i,
    /\|\s*(?:subject|title)\s*\|\s*(.*?)(?:\||$)/i,
    /subject[:\s|*]+(.*?)(?:\n|$)/i,
  ]);
  if (subj) result.ticket_subject = subj;

  // Ticket Owner / Agent
  const agent = extract([
    /ticket\s*owner[:\s|*]+(.*?)(?:\n|$)/i,
    /\|\s*Ticket\s*Owner\s*\|\s*(.*?)(?:\||$)/i,
    /assigned\s*to[:\s|*]+(.*?)(?:\n|$)/i,
    /agent[:\s|*]+(.*?)(?:\n|$)/i,
    /handled\s*by[:\s|*]+(.*?)(?:\n|$)/i,
  ]);
  if (agent) result.agent_name = agent;

  // Date
  const date = extract([
    /\|\s*Date\s*\|\s*([\d\-\/]+)/i,
    /date[:\s|*]+([\d]{4}[-\/]\d{2}[-\/]\d{2})/i,
    /ticket\s*date[:\s|*]+([\d\-\/]+)/i,
  ]);
  if (date) result.date = date.replace(/\//g, "-");

  // Audit Month — derive from date if not explicit
  const monthMatch = extract([
    /audit\s*month[:\s|*]+([\d]{4}-\d{2})/i,
    /month[:\s|*]+([\d]{4}-\d{2})/i,
  ]);
  if (monthMatch) {
    result.audit_month = monthMatch;
  } else if (date) {
    result.audit_month = date.slice(0, 7).replace(/\//g, "-");
  }

  // Grade / Result
  const grade = extract([
    /\|\s*(?:grade|result|status)\s*\|\s*(Pass|Fail|Needs Improvement)/i,
    /(?:grade|overall\s*result)[:\s|*]+(Pass|Fail|Needs Improvement)/i,
    /\*+(?:grade|result)[:\s*]+(Pass|Fail|Needs Improvement)/i,
  ]);
  if (grade) result.grade = grade;

  // Total Score — look for number out of 60 or percentage or plain number
  const scoreRaw = extract([
    /total\s*score[:\s|*]+([\d.]+)\s*(?:\/\s*[\d]+)?/i,
    /\|\s*Total\s*Score\s*\|\s*([\d.]+)/i,
    /overall\s*score[:\s|*]+([\d.]+)/i,
    /score[:\s|*]+([\d.]+)\s*(?:\/\s*(?:60|100))?/i,
  ]);
  if (scoreRaw) {
    result.overall_score = parseFloat(scoreRaw);
  }

  // Criteria scores + deduction reasons — match table rows or labeled lines
  const CRITERIA_KEYS = [
    "Response & Timeliness",
    "Data Quality & Completeness",
    "Communication Quality",
    "Process & Workflow Compliance",
    "Technical Handling",
    "Closure & Documentation",
  ];

  const criteria: Record<string, number> = {};
  const criteria_reasons: Record<string, string> = {};

  for (const key of CRITERIA_KEYS) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&").replace(/\s+/g, "\\s+");

    // Score extraction
    const scoreRe = new RegExp(`${escaped}[\\s|*:]+([\\d.]+)(?:\\s*/\\s*[\\d]+)?`, "i");
    const scoreMatch = markdown.match(scoreRe);
    if (scoreMatch?.[1]) {
      criteria[key] = parseFloat(scoreMatch[1]);
    }

    // Reason extraction — try multiple patterns:
    // 1. Table row with 4+ cols: | Criterion | Score | Max | Reason |
    const tableReasonRe = new RegExp(
      `\\|\\s*${escaped}\\s*\\|[^|]+\\|[^|]*\\|\\s*([^|\\n]+)`, "i"
    );
    const tableReason = markdown.match(tableReasonRe);
    if (tableReason?.[1]?.trim()) {
      criteria_reasons[key] = tableReason[1].trim();
      continue;
    }

    // 2. Line after criterion heading: "**Criterion:** score\nreason text"
    const afterRe = new RegExp(
      `${escaped}[\\s|*:]+[\\d./]+[^\\n]*\\n+([^\\n#|*]+)`, "i"
    );
    const afterMatch = markdown.match(afterRe);
    if (afterMatch?.[1]?.trim()) {
      criteria_reasons[key] = afterMatch[1].trim();
      continue;
    }

    // 3. Inline dash/colon after score: "Criterion: 7/10 – reason"
    const inlineRe = new RegExp(
      `${escaped}[^\\n]*[\\d.]+[^\\n]*[-–—:]+\\s*([^\\n|]+)`, "i"
    );
    const inlineMatch = markdown.match(inlineRe);
    if (inlineMatch?.[1]?.trim()) {
      criteria_reasons[key] = inlineMatch[1].trim();
    }
  }

  if (Object.keys(criteria).length > 0) result.criteria = criteria;
  if (Object.keys(criteria_reasons).length > 0) result.criteria_reasons = criteria_reasons;

  // What You Did Well
  const wellSection = markdown.match(
    /(?:what\s+you\s+did\s+well|strengths?)[:\s\n]+([\s\S]*?)(?=\n#+\s|\nWhat\s+You\s+Missed|What\s+You\s+Could|$)/i
  );
  if (wellSection?.[1]) {
    result.what_did_well = wellSection[1]
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, 6)
      .join("\n");
  }

  // What You Missed
  const missedSection = markdown.match(
    /(?:what\s+you\s+missed|could\s+do\s+better|areas?\s+(?:for\s+)?improvement)[:\s\n]+([\s\S]*?)(?=\n#+\s|$)/i
  );
  if (missedSection?.[1]) {
    result.what_missed = missedSection[1]
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, 6)
      .join("\n");
  }

  // Wrap legacy result into ParsedAuditResult shape
  if (Object.keys(result).length === 0) return null;
  const r = result as Record<string, unknown>;
  const criteriaObj = (r.criteria as Record<string, number>) ?? {};
  const reasonsObj = (r.criteria_reasons as Record<string, string>) ?? {};
  const scores: Record<string, { score: number; max: number; deduction_reason: string }> = {};
  const MAXES: Record<string, number> = {
    "Response & Timeliness": 17,
    "Data Quality & Completeness": 17,
    "Communication Quality": 17,
    "Process & Workflow Compliance": 17,
    "Technical Handling": 16,
    "Closure & Documentation": 16,
  };
  for (const [k, max] of Object.entries(MAXES)) {
    scores[k] = { score: criteriaObj[k] ?? max, max, deduction_reason: reasonsObj[k] ?? "Full marks" };
  }
  const total = typeof r.overall_score === "number" ? r.overall_score
    : Object.values(scores).reduce((s, v) => s + v.score, 0);
  return {
    ticket_number: (r.ticket_number as string) ?? null,
    ticket_subject: (r.ticket_subject as string) ?? null,
    ticket_date: (r.date as string) ?? null,
    audit_month: (r.audit_month as string) ?? null,
    queue: (r.queue as string) ?? null,
    individuals: [{
      name: (r.agent_name as string) ?? "",
      role: "Owner",
      scores,
      total_score: total,
      grade: (r.grade as string) ?? "",
      what_did_well: (r.what_did_well as string) ?? "",
      what_missed: (r.what_missed as string) ?? "",
    }],
  };
}

/** Extract the markdown report — the full response is the report when no JSON block */
export function extractAnalysisMarkdown(full: string): string {
  // If there's a ```json block, strip it and return the rest
  const idx = full.indexOf("```json");
  if (idx !== -1) {
    const endIdx = full.indexOf("```", idx + 7);
    if (endIdx !== -1) return full.slice(endIdx + 3).trim();
  }
  // Otherwise the entire response is the analysis
  return full.trim();
}

export function gradeColor(grade: string | null): string {
  if (!grade) return "gray";
  const g = grade.toLowerCase();
  if (g === "pass") return "green";
  if (g === "fail") return "red";
  return "yellow";
}

export function scoreColor(score: number | null): string {
  if (score === null) return "gray";
  if (score >= 85) return "green";
  if (score >= 70) return "yellow";
  return "red";
}
