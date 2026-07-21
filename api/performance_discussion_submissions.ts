import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { getSession } from "./_lib/auth-middleware.js";
import { lookupByEmail, defaultRoleFor } from "./_lib/roles.js";

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

  const effectiveRole = getEffectiveRole(session);
  const isManager = effectiveRole === "manager";
  const sessionName = String(session.name ?? "").trim();

  try {
    if (req.method === "GET") {
      let query = supabaseAdmin.from("performance_discussion_submissions").select("*");

      const requestedEmployeeName = typeof req.query["filter.employee_name"] === "string"
        ? req.query["filter.employee_name"].trim()
        : "";

      if (!isManager) {
        query = query.eq("employee_name", sessionName);
      } else if (requestedEmployeeName) {
        query = query.eq("employee_name", requestedEmployeeName);
      }

      for (const [key, value] of Object.entries(req.query)) {
        if (!key.startsWith("filter.")) continue;
        if (key === "filter.employee_name") continue;
        const column = key.slice(7);
        if (typeof value !== "string") continue;
        query = query.eq(column, value === "null" ? null : value);
      }

      const orderBy = typeof req.query.orderBy === "string" ? req.query.orderBy : "created_at";
      const ascending = req.query.orderDir !== "desc";
      query = query.order(orderBy, { ascending });

      if (typeof req.query.limit === "string") {
        const limit = Number.parseInt(req.query.limit, 10);
        if (Number.isFinite(limit) && limit > 0) query = query.limit(limit);
      }

      const { data, error } = await query;
      if (error) return send(res, 500, { error: error.message });
      return send(res, 200, data ?? []);
    }

    if (req.method === "POST") {
      const values = Array.isArray(req.body?.values) ? req.body.values : [];
      if (!values.length) {
        return send(res, 400, { error: "At least one row is required." });
      }

      const sanitized = values.map((row) => {
        const { id: _id, created_at: _createdAt, ...rest } = row ?? {};
        return {
          ...rest,
          employee_name: isManager
            ? String(rest.employee_name ?? sessionName).trim() || sessionName
            : sessionName,
        };
      });

      const { data, error } = await supabaseAdmin
        .from("performance_discussion_submissions")
        .insert(sanitized)
        .select();

      if (error) return send(res, 500, { error: error.message });
      return send(res, 200, data ?? []);
    }

    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return send(res, 500, { error: error instanceof Error ? error.message : "Server error" });
  }
}
