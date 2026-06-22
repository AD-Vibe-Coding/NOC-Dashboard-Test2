import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { getSession, requireManager } from "./_lib/auth-middleware.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    if (req.method === "GET") {
      const holder = String(req.query.holder_name ?? "").trim();
      const status = String(req.query.status ?? "").trim();

      let query = supabaseAdmin.from("training_certifications").select("*").order("created_at", { ascending: false });
      if (holder) query = query.eq("holder_name", holder);
      if (status && status !== "all") query = query.eq("status", status);

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ certifications: data ?? [] });
    }

    if (req.method === "POST") {
      if (!requireManager(req, res)) return;

      const body = (req.body ?? {}) as Record<string, unknown>;
      const certification = String(body.certification ?? "").trim();
      const badge = String(body.badge ?? "").trim() || certification;
      const holder_name = String(body.holder_name ?? "").trim();

      if (!certification || !holder_name) {
        return res.status(400).json({ error: "certification and holder_name are required" });
      }

      const now = new Date().toISOString();
      const status = String(body.status ?? "active").trim() || "active";

      const { data, error } = await supabaseAdmin
        .from("training_certifications")
        .insert({
          certification,
          badge,
          holder_name,
          issuer: String(body.issuer ?? "").trim() || null,
          cert_id: String(body.cert_id ?? "").trim() || null,
          issue_date: String(body.issue_date ?? "").trim() || null,
          expires_on: String(body.expires_on ?? "").trim() || null,
          proof_link: String(body.proof_link ?? "").trim() || null,
          proof_file_url: String(body.proof_file_url ?? "").trim() || null,
          status,
          created_by: session.name,
          updated_at: now,
        })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ certification: data });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
