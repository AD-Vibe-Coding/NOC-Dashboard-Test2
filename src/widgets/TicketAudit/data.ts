import { useCallback, useEffect, useState } from "react";

export interface TicketAudit {
  id: number;
  file_name: string;
  file_size_bytes: number;
  ticket_number: string | null;
  ticket_subject: string | null;
  ticket_date?: string | null;
  agent_name: string | null;
  agent_name_raw: string | null;
  audit_role?: string | null;
  overall_score: number | null;
  grade: string | null;
  criteria_json: string | null;
  what_did_well?: string | null;
  what_missed?: string | null;
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
export interface AuditScoreDetail {
  score: number;
  max: number;
  points_deducted: number;
  deduction_reason: string;
  evidence: string;
  // legacy fields — kept for backward compatibility with older saved audits
  what_happened?: string;
  exact_evidence?: string;
}

export interface AuditIndividual {
  name: string;
  party?: string;
  role: "Owner" | "Contributor" | "Contributor - AS" | string;
  scores: Record<string, AuditScoreDetail>;
  total_score: number;
  grade: string;
  what_did_well: string;
  what_missed: string;
}

export interface AuditParties {
  agents: string[];
  customers: string[];
  carriers: string[];
}

export interface ParsedAuditResult {
  ticket_number: string | null;
  ticket_subject: string | null;
  ticket_date: string | null;
  audit_month: string | null;
  queue: string | null;
  parties?: AuditParties;
  individuals: AuditIndividual[];
}

export function normalizeAuditOwners(individuals: AuditIndividual[]): AuditIndividual[] {
  const ownerIndexes = individuals
    .map((ind, index) => ({ ind, index }))
    .filter(({ ind }) => ind.role === "Owner");

  if (ownerIndexes.length <= 1) return individuals;

  const keeper = ownerIndexes.reduce((best, current) => {
    const bestScore = typeof best.ind.total_score === "number" ? best.ind.total_score : -1;
    const currentScore = typeof current.ind.total_score === "number" ? current.ind.total_score : -1;
    return currentScore > bestScore ? current : best;
  });

  return individuals.map((ind, index) => {
    if (ind.role !== "Owner") return ind;
    if (index === keeper.index) return ind;
    return { ...ind, role: "Contributor" };
  });
}

export function deriveAuditSummaries(criteriaJson: string | null | undefined): {
  whatDidWell: string | null;
  whatMissed: string | null;
} {
  if (!criteriaJson) return { whatDidWell: null, whatMissed: null };

  try {
    const raw = JSON.parse(criteriaJson) as Record<string, any>;
    const criteriaEntries = Object.entries(raw).filter(([key, value]) => {
      if (["total_score", "grade", "what_did_well", "what_missed"].includes(key)) return false;
      return value && typeof value === "object" && typeof value.score === "number";
    });

    const strengths = criteriaEntries
      .filter(([, value]) => (value.points_deducted ?? 0) === 0)
      .slice(0, 2)
      .map(([key]) => key);

    const misses = criteriaEntries
      .filter(([, value]) => (value.points_deducted ?? 0) > 0)
      .sort((a, b) => (b[1].points_deducted ?? 0) - (a[1].points_deducted ?? 0))
      .slice(0, 2)
      .map(([, value]) => String(value.deduction_reason ?? "").trim())
      .filter(Boolean)
      .filter((reason) => !["full marks", "n/a"].includes(reason.toLowerCase()));

    return {
      whatDidWell: strengths.length > 0 ? `Strong in ${strengths.join(" and ")}.` : null,
      whatMissed: misses.length > 0 ? misses.join(" ") : null,
    };
  } catch {
    return { whatDidWell: null, whatMissed: null };
  }
}

/**
 * Parse the structured JSON block the agent returns.
 * Returns null if no valid JSON block found.
 */
/** Extract the raw JSON string from whatever shape the model returned.
 *
 * Three cases (in priority order):
 *  1. Full fenced block:  ```json\n{...}\n```
 *  2. Primer mode:        model response starts with "{" because the opening
 *     ```json was pre-filled as an assistant primer — response is just the
 *     object body + optional closing ```
 *  3. Bare JSON anywhere in the text: first "{" to last "}"
 */
function extractJsonString(text: string): string | null {
  // Helper: slice from first "{" to last "}" — handles any nesting depth
  function firstToLast(s: string): string | null {
    const first = s.indexOf("{");
    const last  = s.lastIndexOf("}");
    return (first !== -1 && last > first) ? s.slice(first, last + 1) : null;
  }

  const trimmed = text.trim();

  // Case 1 — response starts with an opening fence, but the model may omit the
  // closing fence if it gets truncated. Strip the opener and recover the JSON
  // body from the remaining text.
  if (trimmed.startsWith("```")) {
    const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "");
    const json = firstToLast(withoutFence.replace(/\s*```\s*$/, ""));
    if (json) {
      try { JSON.parse(json); return json; } catch { /* keep trying */ }
    }
  }

  // Case 2 — find ALL fence pairs and try each one until JSON.parse succeeds.
  const fenceOpenRe = /```(?:json)?\s*\n/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceOpenRe.exec(text)) !== null) {
    const contentStart = match.index + match[0].length;
    const fenceEnd = text.indexOf("```", contentStart);
    if (fenceEnd === -1) {
      const json = firstToLast(text.slice(contentStart));
      if (json) {
        try { JSON.parse(json); return json; } catch { /* try next strategy */ }
      }
      continue;
    }
    const between = text.slice(contentStart, fenceEnd);
    const json = firstToLast(between);
    if (json) {
      try { JSON.parse(json); return json; } catch { /* try next fence */ }
    }
  }

  // Case 3 — primer mode OR bare response: starts with "{" (or whitespace then "{")
  if (trimmed.startsWith("{")) {
    const stripped = trimmed.replace(/\s*```[\w]*\s*$/, "").trim();
    const json = firstToLast(stripped);
    if (json) {
      try { JSON.parse(json); return json; } catch { /* fall through */ }
    }
  }

  // Case 4 — last resort: grab first "{" to last "}"
  return firstToLast(text);
}

export function parseAuditJson(markdown: string): ParsedAuditResult | null {
  const raw = extractJsonString(markdown);
  if (!raw) {
    console.warn("[parseAuditJson] No JSON string found. Response head:", markdown.slice(0, 300));
    return null;
  }
  if (raw) {
    try {
      const parsed = JSON.parse(raw);

      // Accept either "individuals" (expected) or "individual" (model typo)
      if (!Array.isArray(parsed.individuals) && Array.isArray(parsed.individual)) {
        parsed.individuals = parsed.individual;
      }
      // Accept root-level individual object (model returned one object without array)
      if (!Array.isArray(parsed.individuals) && parsed.name && parsed.scores) {
        parsed.individuals = [parsed];
      }

      if (Array.isArray(parsed.individuals) && parsed.individuals.length > 0) {
        // Sanitize each individual: clamp per-category scores to their max,
        // then recompute total_score from the clamped values — never trust
        // a model-returned total that could exceed 100.
        const CATEGORY_MAXES: Record<string, number> = {
          "Response & Timeliness": 20,
          "Data Quality & Completeness": 16,
          "Communication Quality": 25,
          "Process & Workflow Compliance": 14,
          "Technical Handling": 13,
          "Closure & Documentation": 12,
        };
        parsed.individuals = parsed.individuals.map((ind: AuditIndividual) => {
          if (ind.scores && typeof ind.scores === "object") {
            for (const [cat, catMax] of Object.entries(CATEGORY_MAXES)) {
              if (ind.scores[cat]) {
                const s = ind.scores[cat];
                s.score = Math.min(s.score ?? 0, catMax);
                s.max = catMax; // enforce correct max
                // Recompute points_deducted from clamped score
                s.points_deducted = catMax - s.score;
                // Ensure deduction detail fields are always present
                s.deduction_reason = s.deduction_reason || "Full marks";
                // Normalise: new format uses `evidence`, old format used what_happened + exact_evidence
                if (!s.evidence) {
                  const wh = s.what_happened || "";
                  const ee = s.exact_evidence || "";
                  s.evidence = [wh, ee].filter(v => v && v !== "N/A").join(" | ") || "N/A";
                }
              }
            }
          }
          // Recompute total from clamped scores — ignore model-returned total
          const computedTotal = Object.values(ind.scores ?? {}).reduce(
            (s: number, v: AuditScoreDetail) => s + (v.score ?? 0), 0
          );
          ind.total_score = Math.min(computedTotal, 100);
          ind.grade = normalizeAuditGrade(ind.grade, ind.total_score) ?? "";
          if (!ind.what_did_well?.trim() || !ind.what_missed?.trim()) {
            const syntheticCriteriaJson = JSON.stringify(ind.scores ?? {});
            const derived = deriveAuditSummaries(syntheticCriteriaJson);
            ind.what_did_well = ind.what_did_well?.trim() || derived.whatDidWell || "";
            ind.what_missed = ind.what_missed?.trim() || derived.whatMissed || "";
          }
          return ind;
        });
        return parsed as ParsedAuditResult;
      } else {
        console.warn("[parseAuditJson] JSON parsed OK but no individuals found. Keys:", Object.keys(parsed), "| head:", raw.slice(0, 200));
      }
    } catch (e) {
      console.warn("[parseAuditJson] JSON.parse failed:", (e as Error).message, "| raw head:", raw.slice(0, 300));
    }
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
  const scores: Record<string, AuditScoreDetail> = {};
  const MAXES: Record<string, number> = {
    "Response & Timeliness": 20,
    "Data Quality & Completeness": 16,
    "Communication Quality": 25,
    "Process & Workflow Compliance": 14,
    "Technical Handling": 13,
    "Closure & Documentation": 12,
  };
  for (const [k, max] of Object.entries(MAXES)) {
    const raw = criteriaObj[k] ?? max;
    const clamped = Math.min(raw, max);
    // Clamp each criterion score to its own max — never allow over-scoring
    scores[k] = {
      score: clamped,
      max,
      points_deducted: max - clamped,
      deduction_reason: reasonsObj[k] ?? "Full marks",
      evidence: "N/A",
    };
  }
  // Always recompute total from actual scores — never trust a model-returned total
  const computedTotal = Object.values(scores).reduce((s, v) => s + v.score, 0);
  const total = Math.min(computedTotal, 100);
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
    if (endIdx !== -1) {
      const after = full.slice(endIdx + 3).trim();
      // If nothing remains after the JSON block (SECTION 3 was dropped),
      // store the full response so analysis_markdown is never empty.
      return after.length > 0 ? after : full.trim();
    }
  }
  // Otherwise the entire response is the analysis
  return full.trim();
}

export function normalizeAuditGrade(grade: string | null | undefined, score?: number | null): string | null {
  const raw = (grade ?? "").trim();
  const g = raw.toLowerCase();

  if (g === "pass" || g === "review" || g === "fail") return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  if (g === "needs improvement") return "Review";
  if (["a", "a+", "a-", "b+", "b", "b-"].includes(g)) return "Pass";
  if (["c+", "c", "c-", "review"].includes(g)) return "Review";
  if (["d", "d+", "d-", "f"].includes(g)) return "Fail";

  if (typeof score === "number") {
    if (score >= 85) return "Pass";
    if (score >= 70) return "Review";
    return "Fail";
  }

  return raw || null;
}

export function gradeColor(grade: string | null): string {
  const normalized = normalizeAuditGrade(grade);
  if (!normalized) return "gray";
  const g = normalized.toLowerCase();
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

export function normalizeAuditFileName(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

export function extractTicketNumberFromAuditFileName(name: string | null | undefined): string | null {
  const normalized = normalizeAuditFileName(name);
  if (!normalized) return null;
  const stem = normalized.replace(/\.(mhtml|mht|html|htm)$/i, "").trim();
  if (!stem) return null;
  return /^[a-z]*\d+[a-z0-9-]*$/i.test(stem) ? stem.toUpperCase() : null;
}

export function normalizeAuditMonth(value: string | null | undefined, fallbackDate?: string | null): string | null {
  const raw = (value ?? "").trim();
  if (raw) {
    const isoMatch = raw.match(/^(\d{4})-(\d{2})$/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
    const parsed = new Date(`${raw} 1`);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
    }
  }

  const fallback = (fallbackDate ?? "").trim();
  if (fallback) {
    const date = new Date(fallback);
    if (!Number.isNaN(date.getTime())) {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }
    const directMatch = fallback.match(/^(\d{4})-(\d{2})/);
    if (directMatch) return `${directMatch[1]}-${directMatch[2]}`;
  }

  return null;
}


export function formatAuditMonth(value: string | null | undefined): string {
  const normalized = normalizeAuditMonth(value);
  if (!normalized) return "—";

  const isoMatch = normalized.match(/^(\d{4})-(\d{2})$/);
  if (!isoMatch) return normalized;

  const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, 1);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
}
