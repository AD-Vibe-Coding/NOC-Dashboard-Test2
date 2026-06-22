import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { getSession } from "./_lib/auth-middleware.js";

function csvEscape(value: unknown) {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes("\n") || s.includes("\"")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    const [{ data: completions }, { data: trainings }, { data: certs }] = await Promise.all([
      supabaseAdmin.from("training_completions").select("*"),
      supabaseAdmin.from("upcoming_trainings").select("id,title,training_date,audience"),
      supabaseAdmin.from("training_certifications").select("*")
    ]);

    const trainingById = new Map((trainings ?? []).map((t: any) => [t.id, t]));

    if (String(req.query.kind ?? "completions") === "certifications") {
      const header = ["certification", "holder_name", "issuer", "cert_id", "issue_date", "expires_on", "status", "proof_link"];
      const rows = (certs ?? []).map((c: any) => [
        c.certification, c.holder_name, c.issuer, c.cert_id, c.issue_date, c.expires_on, c.status, c.proof_link,
      ]);
      const csv = [header.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      return res.status(200).send(csv);
    }

    const header = ["agent_name", "training_title", "status", "approval_status", "progress_percent", "target_date", "completed_at", "updated_at", "audience"];
    const rows = (completions ?? []).map((c: any) => {
      const t = trainingById.get(c.training_id);
      return [
        c.agent_name,
        t?.title ?? `training:${c.training_id}`,
        c.status,
        c.approval_status,
        c.progress_percent,
        c.target_date,
        c.completed_at,
        c.updated_at,
        t?.audience ?? "",
      ];
    });
    const csv = [header.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    return res.status(200).send(csv);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
