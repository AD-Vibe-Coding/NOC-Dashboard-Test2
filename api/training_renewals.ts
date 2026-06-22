import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { getSession, requireManager } from "./_lib/auth-middleware.js";

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
    if (!requireManager(req, res)) return;

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const thresholdDays = Number(req.body?.threshold_days ?? 60);

    const { data: certs, error } = await supabaseAdmin.from("training_certifications").select("*");
    if (error) return res.status(500).json({ error: error.message });

    const expiring = (certs ?? []).filter((c: any) => {
      const d = daysTo(c.expires_on);
      return d !== null && d >= 0 && d <= thresholdDays;
    });

    let created = 0;
    for (const cert of expiring) {
      const title = `Renewal: ${cert.certification}`;
      const audience = cert.holder_name ? `user:${cert.holder_name}` : "all";
      const dueDate = cert.expires_on ?? new Date().toISOString().slice(0, 10);

      const { data: existing } = await supabaseAdmin
        .from("upcoming_trainings")
        .select("id")
        .eq("title", title)
        .eq("audience", audience)
        .eq("training_date", dueDate)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const { error: insertErr } = await supabaseAdmin.from("upcoming_trainings").insert({
        title,
        description: `Certification renewal due soon (${cert.certification})`,
        training_date: dueDate,
        audience,
        posted_by: session.name,
      });
      if (!insertErr) created += 1;
    }

    return res.status(200).json({ created, scanned: expiring.length, threshold_days: thresholdDays });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
