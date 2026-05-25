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

  return { audits, loading, error, refresh, saveAudit, deleteAudit };
}

/**
 * Parse structured fields from the AI agent's response.
 * Supports two formats:
 *   1. A ```json ... ``` block (if the agent emits one)
 *   2. Plain-text / markdown extraction — handles table rows, bold labels,
 *      and natural language patterns the Ticket Auditor agent produces.
 */
export function parseAuditJson(markdown: string): Record<string, unknown> | null {
  // ── Strategy 1: explicit ```json block ─────────────────────────────────────
  const jsonMatch = markdown.match(/```json\s*([\s\S]*?)```/i);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[1]); } catch { /* fall through */ }
  }

  // ── Strategy 2: extract fields from natural agent output ───────────────────
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
    const num = parseFloat(scoreRaw);
    // Normalise: if score looks like it's out of 60 (sum of 6×10), convert to 0-100
    result.overall_score = num > 10 && num <= 60
      ? Math.round((num / 60) * 100)
      : num > 100 ? 100 : Math.round(num);
  }

  // Criteria scores — match table rows or labeled lines
  const CRITERIA_KEYS = [
    "Response & Timeliness",
    "Data Quality & Completeness",
    "Communication Quality",
    "Process & Workflow Compliance",
    "Technical Handling",
    "Closure & Documentation",
  ];

  const criteria: Record<string, number> = {};
  for (const key of CRITERIA_KEYS) {
    // Escape key for regex
    const escaped = key.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&").replace(/\s+/g, "\\s+");
    const re = new RegExp(`${escaped}[\\s|*:]+([\\d.]+)(?:\\s*/\\s*10)?`, "i");
    const m = markdown.match(re);
    if (m?.[1]) {
      criteria[key] = Math.min(10, Math.max(0, parseFloat(m[1])));
    }
  }
  if (Object.keys(criteria).length > 0) result.criteria = criteria;

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

  // Return null only if we found nothing at all
  return Object.keys(result).length > 0 ? result : null;
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
