import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { requireManager } from "../_lib/auth-middleware.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "DELETE") {
      res.setHeader("Allow", "DELETE");
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!requireManager(req, res)) return;

    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: "Missing training id" });

    const { error } = await supabaseAdmin.from("upcoming_trainings").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
