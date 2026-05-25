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

/** Parse the JSON block out of the AI response markdown */
export function parseAuditJson(markdown: string): Record<string, unknown> | null {
  const match = markdown.match(/```json\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/** Extract the markdown report (everything after the first ``` block) */
export function extractAnalysisMarkdown(full: string): string {
  const idx = full.indexOf("```json");
  if (idx === -1) return full;
  const endIdx = full.indexOf("```", idx + 7);
  if (endIdx === -1) return full;
  return full.slice(endIdx + 3).trim();
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
