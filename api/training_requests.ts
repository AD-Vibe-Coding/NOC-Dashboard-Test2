import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { getSession } from "./_lib/auth-middleware.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("training_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ requests: data ?? [] });
    }

    if (req.method === "POST") {
      const session = getSession(req);
      if (!session) {
        return res.status(401).json({ error: "Not authenticated — please sign in first" });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const training_title = String(body.training_title ?? "").trim();
      const training_type = String(body.training_type ?? "").trim();
      const due_date = String(body.due_date ?? "").trim() || null;
      const details = String(body.details ?? "").trim() || null;

      if (!training_title || !training_type) {
        return res.status(400).json({ error: "training_title and training_type are required" });
      }
      if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
        return res.status(400).json({ error: "due_date must be YYYY-MM-DD" });
      }

      const { data, error } = await supabaseAdmin
        .from("training_requests")
        .insert({
          requester_name: session.name,
          requester_email: session.email ?? null,
          training_title,
          training_type,
          due_date,
          details,
          status: "requested",
          manager_note: null,
          reviewed_by: null,
          reviewed_at: null,
        })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ request: data });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
