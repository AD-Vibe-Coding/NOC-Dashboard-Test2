import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { getSession } from "../_lib/auth-middleware.js";
import { lookupByEmail, defaultRoleFor } from "../_lib/roles.js";

function getEffectiveRole(session: ReturnType<typeof getSession>) {
  if (!session) return null;
  const fallbackRole = lookupByEmail(String(session.email ?? "").toLowerCase())?.role
    ?? defaultRoleFor(String(session.name ?? ""));
  return session.role ?? fallbackRole;
}

function send(res: VercelResponse, code: number, body: unknown) {
  return res.status(code).json(body);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const session = getSession(req);
  if (!session) {
    return send(res, 401, { error: "Authentication required." });
  }

  const id = Number.parseInt(String(req.query.id ?? ""), 10);
  if (!Number.isFinite(id)) {
    return send(res, 400, { error: "Invalid submission id." });
  }

  const effectiveRole = getEffectiveRole(session);
  const isManager = effectiveRole === "manager";
  const sessionName = String(session.name ?? "").trim();

  try {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("performance_discussion_submissions")
      .select("*")
      .eq("id", id)
      .single();

    if (existingError) {
      const code = existingError.code === "PGRST116" ? 404 : 500;
      return send(res, code, { error: existingError.message });
    }

    if (!isManager && existing.employee_name !== sessionName) {
      return send(res, 403, { error: "You can only access your own submission." });
    }

    if (req.method === "GET") {
      return send(res, 200, existing);
    }

    if (req.method === "PATCH") {
      const { id: _id, created_at: _createdAt, ...rest } = req.body ?? {};
      const patch = {
        ...rest,
        employee_name: isManager
          ? String(rest.employee_name ?? existing.employee_name ?? sessionName).trim() || existing.employee_name || sessionName
          : existing.employee_name,
      };

      const { data, error } = await supabaseAdmin
        .from("performance_discussion_submissions")
        .update(patch)
        .eq("id", id)
        .select()
        .single();

      if (error) return send(res, 500, { error: error.message });
      return send(res, 200, data);
    }

    if (req.method === "DELETE") {
      const { error } = await supabaseAdmin
        .from("performance_discussion_submissions")
        .delete()
        .eq("id", id);
      if (error) return send(res, 500, { error: error.message });
      return send(res, 200, { ok: true });
    }

    res.setHeader("Allow", "GET, PATCH, DELETE");
    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return send(res, 500, { error: error instanceof Error ? error.message : "Server error" });
  }
}
