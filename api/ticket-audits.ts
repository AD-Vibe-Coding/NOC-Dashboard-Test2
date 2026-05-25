import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const { data, error } = await supabaseAdmin
      .from("ticket_audits")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data ?? []);
  }

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const {
      file_name, file_size_bytes, ticket_number, ticket_subject,
      agent_name, agent_name_raw, overall_score, grade, criteria_json,
      analysis_markdown, audit_month, queue, audited_by, metrics_id,
    } = body;

    if (!file_name || !analysis_markdown) {
      return res.status(400).json({ error: "file_name and analysis_markdown are required" });
    }

    const { data, error } = await supabaseAdmin
      .from("ticket_audits")
      .insert({
        file_name, file_size_bytes: file_size_bytes ?? 0,
        ticket_number, ticket_subject,
        agent_name, agent_name_raw, overall_score, grade,
        criteria_json: typeof criteria_json === "object" ? JSON.stringify(criteria_json) : criteria_json,
        analysis_markdown, audit_month, queue, audited_by, metrics_id,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
