import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { getSession } from "./_lib/auth-middleware.js";

const VALID_STATUS = new Set(["not_started", "in_progress", "completed"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    if (req.method === "GET") {
      const training_id = String(req.query.training_id ?? "").trim();
      const agent_name = String(req.query.agent_name ?? "").trim();

      let query = supabaseAdmin
        .from("training_completions")
        .select("*")
        .order("created_at", { ascending: false });

      if (training_id) query = query.eq("training_id", training_id);
      if (agent_name) query = query.eq("agent_name", agent_name);

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ completions: data ?? [] });
    }

    if (req.method === "POST") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const training_id = Number(body.training_id);
      const status = String(body.status ?? "").trim();
      const target_date = String(body.target_date ?? "").trim() || null;
      const note = String(body.note ?? "").trim() || null;
      const progress_percent_raw = Number(body.progress_percent ?? (status === "completed" ? 100 : 0));
      const agent_name = String(body.agent_name ?? session.name).trim();

      if (!Number.isFinite(training_id)) return res.status(400).json({ error: "training_id is required" });
      if (!VALID_STATUS.has(status)) return res.status(400).json({ error: "Invalid status" });
      if (target_date && !/^\d{4}-\d{2}-\d{2}$/.test(target_date)) {
        return res.status(400).json({ error: "target_date must be YYYY-MM-DD" });
      }
      if (!Number.isFinite(progress_percent_raw) || progress_percent_raw < 0 || progress_percent_raw > 100) {
        return res.status(400).json({ error: "progress_percent must be between 0 and 100" });
      }

      const isManager = session.role === "manager";
      if (!isManager && agent_name !== session.name) {
        return res.status(403).json({ error: "You can only update your own progress" });
      }

      const now = new Date().toISOString();
      const progress_percent = status === "completed" ? 100 : Math.round(progress_percent_raw);
      const completed_at = status === "completed" ? now : null;

      const { data, error } = await supabaseAdmin
        .from("training_completions")
        .insert({ training_id, agent_name, status, progress_percent, target_date, note, completed_at, updated_at: now })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ completion: data });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
