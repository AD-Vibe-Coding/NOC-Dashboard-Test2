import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { getSession } from "../_lib/auth-middleware.js";

const VALID_STATUS = new Set(["not_started", "in_progress", "completed"]);

function isMissingColumnError(message: string) {
  const m = message.toLowerCase();
  return m.includes("column") && (m.includes("evidence_link") || m.includes("evidence_file_url") || m.includes("approval_status"));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    if (req.method !== "PATCH") {
      res.setHeader("Allow", "PATCH");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const id = String(req.query.id ?? "").trim();
    if (!id) return res.status(400).json({ error: "Missing completion id" });

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("training_completions")
      .select("*")
      .eq("id", id)
      .single();

    if (existingErr || !existing) return res.status(404).json({ error: "Completion not found" });

    const isManager = session.role === "manager";
    if (!isManager && existing.agent_name !== session.name) {
      return res.status(403).json({ error: "You can only update your own progress" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const status = body.status !== undefined ? String(body.status ?? "").trim() : existing.status;
    const target_date = body.target_date !== undefined ? (String(body.target_date ?? "").trim() || null) : existing.target_date;
    const note = body.note !== undefined ? (String(body.note ?? "").trim() || null) : existing.note;
    const evidence_link = body.evidence_link !== undefined ? (String(body.evidence_link ?? "").trim() || null) : existing.evidence_link;
    const evidence_file_url = body.evidence_file_url !== undefined ? (String(body.evidence_file_url ?? "").trim() || null) : existing.evidence_file_url;
    const progress_percent_raw = body.progress_percent !== undefined
      ? Number(body.progress_percent)
      : Number(existing.progress_percent ?? (status === "completed" ? 100 : 0));

    if (!VALID_STATUS.has(status)) return res.status(400).json({ error: "Invalid status" });
    if (target_date && !/^\d{4}-\d{2}-\d{2}$/.test(target_date)) {
      return res.status(400).json({ error: "target_date must be YYYY-MM-DD" });
    }
    if (!Number.isFinite(progress_percent_raw) || progress_percent_raw < 0 || progress_percent_raw > 100) {
      return res.status(400).json({ error: "progress_percent must be between 0 and 100" });
    }

    const now = new Date().toISOString();
    const progress_percent = status === "completed" ? 100 : Math.round(progress_percent_raw);
    const completed_at = status === "completed" ? (existing.completed_at ?? now) : null;
    const approval_status = status === "completed"
      ? (existing.approval_status === "approved" ? "approved" : "pending")
      : "not_required";

    const modernPayload = {
      status,
      progress_percent,
      target_date,
      note,
      evidence_link,
      evidence_file_url,
      completed_at,
      approval_status,
      updated_at: now,
    };

    let { data, error } = await supabaseAdmin
      .from("training_completions")
      .update(modernPayload)
      .eq("id", id)
      .select()
      .single();

    if (error && isMissingColumnError(error.message)) {
      ({ data, error } = await supabaseAdmin
        .from("training_completions")
        .update({
          status,
          progress_percent,
          target_date,
          note,
          completed_at,
          updated_at: now,
        })
        .eq("id", id)
        .select()
        .single());
    }

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ completion: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
