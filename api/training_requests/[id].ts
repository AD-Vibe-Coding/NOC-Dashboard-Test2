import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { getSession, requireManager } from "../_lib/auth-middleware.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "PATCH") {
      res.setHeader("Allow", "PATCH");
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!requireManager(req, res)) return;
    const session = getSession(req)!;
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: "Missing request id" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const status = String(body.status ?? "").trim();
    const manager_note = String(body.manager_note ?? "").trim() || null;

    if (status !== "submitted") {
      return res.status(400).json({ error: "status must be 'submitted'" });
    }

    const { data, error } = await supabaseAdmin
      .from("training_requests")
      .update({
        status,
        manager_note,
        reviewed_by: session.name,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ request: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
