import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { getSession, requireManager } from "../_lib/auth-middleware.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });
    if (!requireManager(req, res)) return;

    const id = String(req.query.id ?? "").trim();
    if (!id) return res.status(400).json({ error: "Missing certification id" });

    if (req.method === "PATCH") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch = {
        certification: body.certification !== undefined ? (String(body.certification ?? "").trim() || null) : undefined,
        badge: body.badge !== undefined ? (String(body.badge ?? "").trim() || null) : undefined,
        holder_name: body.holder_name !== undefined ? (String(body.holder_name ?? "").trim() || null) : undefined,
        issuer: body.issuer !== undefined ? (String(body.issuer ?? "").trim() || null) : undefined,
        cert_id: body.cert_id !== undefined ? (String(body.cert_id ?? "").trim() || null) : undefined,
        issue_date: body.issue_date !== undefined ? (String(body.issue_date ?? "").trim() || null) : undefined,
        expires_on: body.expires_on !== undefined ? (String(body.expires_on ?? "").trim() || null) : undefined,
        proof_link: body.proof_link !== undefined ? (String(body.proof_link ?? "").trim() || null) : undefined,
        proof_file_url: body.proof_file_url !== undefined ? (String(body.proof_file_url ?? "").trim() || null) : undefined,
        status: body.status !== undefined ? (String(body.status ?? "").trim() || null) : undefined,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabaseAdmin.from("training_certifications").update(patch).eq("id", id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ certification: data });
    }

    if (req.method === "DELETE") {
      const { error } = await supabaseAdmin.from("training_certifications").delete().eq("id", id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
