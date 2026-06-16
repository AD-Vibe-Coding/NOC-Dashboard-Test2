import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { getSession } from "./_lib/auth-middleware.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    if (req.method === "GET") {
      const training_id = Number(req.query.training_id);
      if (!Number.isFinite(training_id)) return res.status(400).json({ error: "training_id is required" });

      const { data, error } = await supabaseAdmin
        .from("training_comments")
        .select("*")
        .eq("training_id", training_id)
        .order("created_at", { ascending: true });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ comments: data ?? [] });
    }

    if (req.method === "POST") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const training_id = Number(body.training_id);
      const message = String(body.message ?? "").trim();
      if (!Number.isFinite(training_id)) return res.status(400).json({ error: "training_id is required" });
      if (!message) return res.status(400).json({ error: "message is required" });

      const { data, error } = await supabaseAdmin
        .from("training_comments")
        .insert({
          training_id,
          author_name: session.name,
          author_role: session.role,
          message,
        })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ comment: data });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
