import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { getSession } from "./_lib/auth-middleware.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    const { data, error } = await supabaseAdmin
      .from("training_comments")
      .select("training_id,author_name,author_role,created_at")
      .order("created_at", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const summary: Record<string, { comment_count: number; unread_count: number; last_manager_at: string | null }> = {};

    for (const c of data ?? []) {
      const key = String(c.training_id);
      if (!summary[key]) summary[key] = { comment_count: 0, unread_count: 0, last_manager_at: null };
      summary[key].comment_count += 1;
      if (c.author_name !== session.name) summary[key].unread_count += 1;
      if (c.author_role === "manager") summary[key].last_manager_at = c.created_at;
    }

    return res.status(200).json({ summary });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
