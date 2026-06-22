import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_lib/supabase-admin.js";
import { getSession, requireManager } from "../../_lib/auth-middleware.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });
    if (!requireManager(req, res)) return;

    if (req.method !== "PATCH") {
      res.setHeader("Allow", "PATCH");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const id = String(req.query.id ?? "").trim();
    if (!id) return res.status(400).json({ error: "Missing completion id" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const decision = String(body.decision ?? "").trim();
    const note = String(body.note ?? "").trim() || null;

    if (decision !== "approved" && decision !== "rejected") {
      return res.status(400).json({ error: "decision must be approved or rejected" });
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      approval_status: decision,
      approval_note: note,
      approved_by: session.name,
      approved_at: now,
      updated_at: now,
    };

    if (decision === "approved") {
      patch.status = "completed";
      patch.progress_percent = 100;
      patch.completed_at = now;
    }

    const { data, error } = await supabaseAdmin
      .from("training_completions")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ completion: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
