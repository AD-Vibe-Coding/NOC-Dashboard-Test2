import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { requireManager } from "../_lib/auth-middleware.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!requireManager(req, res)) return;

    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: "Missing training id" });

    if (req.method === "PATCH") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const title = String(body.title ?? "").trim();
      const description = String(body.description ?? "").trim();
      const training_date = String(body.training_date ?? "").trim();
      const audience = String(body.audience ?? "all").trim();
      const assignee = String(body.assignee ?? "").trim() || null;

      if (!title || !description || !training_date) {
        return res.status(400).json({ error: "title, description, and training_date are required" });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(training_date)) {
        return res.status(400).json({ error: "training_date must be YYYY-MM-DD" });
      }

      const effectiveAudience = assignee ? `user:${assignee}` : audience;

      const { data, error } = await supabaseAdmin
        .from("upcoming_trainings")
        .update({ title, description, training_date, audience: effectiveAudience })
        .eq("id", id)
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ training: data });
    }

    if (req.method === "DELETE") {
      const { error } = await supabaseAdmin.from("upcoming_trainings").delete().eq("id", id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
