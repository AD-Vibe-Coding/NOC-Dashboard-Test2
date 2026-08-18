import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { getSession } from "./_lib/auth-middleware.js";
import { defaultRoleFor, lookupByEmail } from "./_lib/roles.js";

function send(res: VercelResponse, code: number, body: unknown) {
  return res.status(code).json(body);
}

function getEffectiveRole(session: { role?: string | null; email?: string | null; name?: string | null } | null) {
  if (!session) return "anonymous";
  return (
    session.role
    ?? lookupByEmail(String(session.email ?? "").toLowerCase())?.role
    ?? defaultRoleFor(String(session.name ?? ""))
    ?? "anonymous"
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const session = getSession(req);
  const role = getEffectiveRole(session);
  const sessionName = String(session?.name ?? "").trim();

  if (!sessionName) {
    return send(res, 403, { error: "Sign in required." });
  }

  try {
    if (req.method === "GET") {
      let query = supabaseAdmin.from("manager_feedback").select("*");

      if (role === "manager") {
        query = query.order("created_at", { ascending: false });
      } else {
        query = query
          .eq("feedback_for", sessionName)
          .eq("approval_status", "approved")
          .order("approved_at", { ascending: false });
      }

      const { data, error } = await query;
      if (error) {
        return send(res, 500, { error: error.message });
      }
      return send(res, 200, data ?? []);
    }

    if (req.method === "POST") {
      const body = req.body ?? {};
      const raw = body.values !== undefined ? body.values : body;
      const row = Array.isArray(raw) ? raw[0] : raw;

      const feedbackFor = String(row?.feedback_for ?? "").trim();
      const comment = String(row?.comment ?? "").trim();
      const ticketNumber = String(row?.ticket_number ?? "").trim() || null;
      const requestedFrom = String(row?.feedback_from ?? "").trim();
      const submittedBy = sessionName;
      const isManager = role === "manager";
      const feedbackFrom = isManager ? requestedFrom || submittedBy : submittedBy;
      const approvalStatus = isManager ? "approved" : "pending";
      const approvedBy = isManager ? submittedBy : null;
      const approvedAt = isManager ? new Date().toISOString() : null;

      if (!feedbackFor || !comment || !feedbackFrom) {
        return send(res, 400, { error: "feedback_for, comment, and feedback_from are required." });
      }

      const { data, error } = await supabaseAdmin
        .from("manager_feedback")
        .insert({
          feedback_from: feedbackFrom,
          feedback_for: feedbackFor,
          ticket_number: ticketNumber,
          comment,
          submitted_by: submittedBy,
          approval_status: approvalStatus,
          approved_by: approvedBy,
          approved_at: approvedAt,
        })
        .select();

      if (error) {
        return send(res, 500, { error: error.message });
      }

      return send(res, 201, data ?? []);
    }

    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    return send(res, 500, {
      error: err instanceof Error ? err.message : "Server error",
    });
  }
}
