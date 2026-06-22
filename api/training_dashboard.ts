import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { getSession } from "./_lib/auth-middleware.js";

function daysTo(dateText?: string | null) {
  if (!dateText) return null;
  const target = new Date(`${dateText}T00:00:00`);
  const now = new Date();
  const floor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((target.getTime() - floor.getTime()) / (1000 * 60 * 60 * 24));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    const [{ data: trainings }, { data: completions }, { data: certs }] = await Promise.all([
      supabaseAdmin.from("upcoming_trainings").select("*").order("training_date", { ascending: true }),
      supabaseAdmin.from("training_completions").select("*"),
      supabaseAdmin.from("training_certifications").select("*")
    ]);

    const completionRows = completions ?? [];
    const certRows = certs ?? [];
    const nowIso = new Date().toISOString();

    const overdue = completionRows.filter((c: any) => c.status !== "completed" && c.target_date && daysTo(c.target_date)! < 0).length;
    const dueSoon = completionRows.filter((c: any) => c.status !== "completed" && c.target_date && (daysTo(c.target_date) ?? 999) >= 0 && (daysTo(c.target_date) ?? 999) <= 7).length;
    const expiring30 = certRows.filter((c: any) => c.expires_on && (daysTo(c.expires_on) ?? 999) >= 0 && (daysTo(c.expires_on) ?? 999) <= 30).length;
    const expiring60 = certRows.filter((c: any) => c.expires_on && (daysTo(c.expires_on) ?? 999) >= 0 && (daysTo(c.expires_on) ?? 999) <= 60).length;

    const managerReviewPending = completionRows.filter((c: any) => c.approval_status === "pending").length;

    const myRows = completionRows.filter((c: any) => c.agent_name === session.name);
    const myCompleted = myRows.filter((c: any) => c.status === "completed").length;

    return res.status(200).json({
      generated_at: nowIso,
      manager: {
        active_trainings: (trainings ?? []).length,
        review_pending: managerReviewPending,
        overdue_count: overdue,
        due_soon_count: dueSoon,
        expiring_30_count: expiring30,
        expiring_60_count: expiring60,
      },
      agent: {
        my_total: myRows.length,
        my_completed: myCompleted,
        my_due_soon: myRows.filter((c: any) => c.status !== "completed" && c.target_date && (daysTo(c.target_date) ?? 999) >= 0 && (daysTo(c.target_date) ?? 999) <= 7).length,
        my_overdue: myRows.filter((c: any) => c.status !== "completed" && c.target_date && (daysTo(c.target_date) ?? 999) < 0).length,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
