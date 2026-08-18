import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { getSession } from "../_lib/auth-middleware.js";
import { defaultRoleFor, lookupByEmail } from "../_lib/roles.js";

function send(res: VercelResponse, code: number, body: unknown) {
  return res.status(code).json(body);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const session = getSession(req);
  const role = session
    ? session.role
      ?? lookupByEmail(String(session.email ?? "").toLowerCase())?.role
      ?? defaultRoleFor(String(session.name ?? ""))
      ?? "anonymous"
    : "anonymous";
  const sessionName = String(session?.name ?? "").trim();
  const id = Number(req.query.id);

  if (!sessionName) {
    return send(res, 403, { error: "Sign in required." });
  }

  if (!Number.isFinite(id)) {
    return send(res, 400, { error: `Invalid id: ${req.query.id}` });
  }

  try {
    if (req.method === "GET") {
      let query = supabaseAdmin.from("manager_feedback").select("*").eq("id", id);
      if (role !== "manager") {
        query = query.eq("feedback_for", sessionName).eq("approval_status", "approved");
      }
      const { data, error } = await query.single();
      if (error) {
        return send(res, 404, { error: error.message });
      }
      return send(res, 200, data);
    }

    if (req.method === "PATCH") {
      if (role !== "manager") {
        return send(res, 403, { error: "Manager access required." });
      }

      const body = req.body ?? {};
      const patch: Record<string, unknown> = {};

      if (body.approval_status === "approved") {
        patch.approval_status = "approved";
        patch.approved_by = sessionName;
        patch.approved_at = new Date().toISOString();
      }

      if (typeof body.comment === "string") patch.comment = body.comment.trim();
      if (typeof body.ticket_number === "string") patch.ticket_number = body.ticket_number.trim() || null;
      if (typeof body.feedback_from === "string") patch.feedback_from = body.feedback_from.trim();
      if (typeof body.feedback_for === "string") patch.feedback_for = body.feedback_for.trim();

      if (Object.keys(patch).length === 0) {
        return send(res, 400, { error: "No supported fields to update." });
      }

      const { data, error } = await supabaseAdmin
        .from("manager_feedback")
        .update(patch)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return send(res, 500, { error: error.message });
      }
      return send(res, 200, data);
    }

    if (req.method === "DELETE") {
      if (role !== "manager") {
        return send(res, 403, { error: "Manager access required." });
      }
      const { error } = await supabaseAdmin.from("manager_feedback").delete().eq("id", id);
      if (error) {
        return send(res, 500, { error: error.message });
      }
      return send(res, 200, { ok: true });
    }

    res.setHeader("Allow", "GET, PATCH, DELETE");
    return send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    return send(res, 500, {
      error: err instanceof Error ? err.message : "Server error",
    });
  }
}
