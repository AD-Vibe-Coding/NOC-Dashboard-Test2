import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";

function normalizeAuditMonth(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const isoMatch = raw.match(/^(\d{4})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
  const date = new Date(`${raw} 1`);
  if (!Number.isNaN(date.getTime())) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }
  return raw;
}

function normalizeAuditGrade(value: unknown, score?: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  const g = raw.toLowerCase();
  if (g === "pass" || g === "review" || g === "fail") return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  if (g === "needs improvement") return "Review";
  if (["a", "a+", "a-", "b+", "b", "b-"].includes(g)) return "Pass";
  if (["c+", "c", "c-"] .includes(g)) return "Review";
  if (["d", "d+", "d-", "f"].includes(g)) return "Fail";
  const numeric = typeof score === "number" ? score : Number(score);
  if (Number.isFinite(numeric)) {
    if (numeric >= 85) return "Pass";
    if (numeric >= 70) return "Review";
    return "Fail";
  }
  return raw || null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const { data, error } = await supabaseAdmin
      .from("ticket_audits")
      .select("id,file_name,file_size_bytes,ticket_number,ticket_subject,ticket_date,agent_name,agent_name_raw,audit_role,overall_score,grade,criteria_json,what_did_well,what_missed,audit_month,queue,audited_by,metrics_id,created_at")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data ?? []);
  }

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const {
      file_name, file_size_bytes, ticket_number, ticket_subject,
      ticket_date, agent_name, agent_name_raw, audit_role, overall_score, grade,
      criteria_json, what_did_well, what_missed,
      analysis_markdown, audit_month, queue, audited_by, metrics_id,
    } = body;

    if (!file_name || !analysis_markdown) {
      return res.status(400).json({ error: "file_name and analysis_markdown are required" });
    }

    const normalizedTicketNumber = typeof ticket_number === "string" ? ticket_number.trim() : null;
    const normalizedAgentName = typeof agent_name === "string" ? agent_name.trim() : null;
    const normalizedAuditRole = typeof audit_role === "string" ? audit_role.trim() : null;
    const normalizedFileName = typeof file_name === "string" ? file_name.trim() : null;

    const basePayload = {
      file_name,
      file_size_bytes: file_size_bytes ?? 0,
      ticket_number,
      ticket_subject,
      ticket_date,
      agent_name,
      agent_name_raw,
      audit_role,
      overall_score,
      grade: normalizeAuditGrade(grade, overall_score),
      criteria_json: typeof criteria_json === "object" ? JSON.stringify(criteria_json) : criteria_json,
      what_did_well,
      what_missed,
      analysis_markdown,
      audit_month: finalAuditMonth,
      queue,
      audited_by,
      metrics_id,
    };

    let existingId: number | null = null;

    // Primary dedupe key: ticket_number + agent_name + audit_role
    if (normalizedTicketNumber && normalizedAgentName && normalizedAuditRole) {
      const existing = await supabaseAdmin
        .from("ticket_audits")
        .select("id")
        .eq("ticket_number", normalizedTicketNumber)
        .eq("agent_name", normalizedAgentName)
        .eq("audit_role", normalizedAuditRole)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing.error) {
        return res.status(500).json({ error: existing.error.message });
      }
      existingId = existing.data?.id ?? null;
    }

    // Fallback dedupe key for audits without a ticket number: file_name + agent_name + audit_role
    if (!existingId && normalizedFileName && normalizedAgentName && normalizedAuditRole) {
      const existing = await supabaseAdmin
        .from("ticket_audits")
        .select("id")
        .eq("file_name", normalizedFileName)
        .eq("agent_name", normalizedAgentName)
        .eq("audit_role", normalizedAuditRole)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing.error) {
        return res.status(500).json({ error: existing.error.message });
      }
      existingId = existing.data?.id ?? null;
    }

    let data;
    let error;

    if (existingId) {
      const updated = await supabaseAdmin
        .from("ticket_audits")
        .update(basePayload)
        .eq("id", existingId)
        .select()
        .single();
      data = updated.data;
      error = updated.error;
    } else {
      const inserted = await supabaseAdmin
        .from("ticket_audits")
        .insert(basePayload)
        .select()
        .single();
      data = inserted.data;
      error = inserted.error;
    }

    // Backward-compatible fallback for projects where the DB table
    // has not yet been pushed with the new `audit_role` column.
    if (error && /audit_role/i.test(error.message ?? "")) {
      const { audit_role: _ignored, ...fallbackPayload } = basePayload;
      const retry = existingId
        ? await supabaseAdmin
            .from("ticket_audits")
            .update(fallbackPayload)
            .eq("id", existingId)
            .select()
            .single()
        : await supabaseAdmin
            .from("ticket_audits")
            .insert(fallbackPayload)
            .select()
            .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) return res.status(500).json({ error: error.message });
    return res.status(existingId ? 200 : 201).json(data);
  }

  // DELETE — wipe all audit rows (manager-initiated clear)
  if (req.method === "DELETE") {
    const { error } = await supabaseAdmin
      .from("ticket_audits")
      .delete()
      .neq("id", 0); // match all rows
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ cleared: true });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}
