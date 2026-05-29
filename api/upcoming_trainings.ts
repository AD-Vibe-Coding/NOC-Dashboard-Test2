import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { getSession, requireManager } from "./_lib/auth-middleware.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("upcoming_trainings")
        .select("*")
        .order("training_date", { ascending: true });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ trainings: data ?? [] });
    }

    if (req.method === "POST") {
      if (!requireManager(req, res)) return;
      const session = getSession(req)!;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const title = String(body.title ?? "").trim();
      const description = String(body.description ?? "").trim();
      const training_date = String(body.training_date ?? "").trim();
      const audience = String(body.audience ?? "all").trim();

      if (!title || !description || !training_date) {
        return res.status(400).json({ error: "title, description, and training_date are required" });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(training_date)) {
        return res.status(400).json({ error: "training_date must be YYYY-MM-DD" });
      }

      const { data, error } = await supabaseAdmin
        .from("upcoming_trainings")
        .insert({ title, description, training_date, audience, posted_by: session.name })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ training: data });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
