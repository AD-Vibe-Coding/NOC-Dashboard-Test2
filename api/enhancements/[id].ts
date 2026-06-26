import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { getSession } from "../_lib/auth-middleware.js";

function sendJson(res: VercelResponse, status: number, body: unknown) {
  return res.status(status).json(body);
}

function normalizeOptional(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const id = Number(req.query.id);
    if (!Number.isFinite(id)) return sendJson(res, 400, { error: "Invalid enhancement id." });

    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("enhancements")
        .select("*")
        .eq("id", id)
        .single();
      if (error) return sendJson(res, 500, { error: error.message });
      return sendJson(res, 200, data);
    }

    const session = getSession(req);
    if (!session || session.role !== "manager") {
      return sendJson(res, 403, {
        error: "Manager access required.",
        hint: "Sign in with a manager account to edit or approve enhancements.",
      });
    }

    if (req.method === "PATCH") {
      const nextStatus = String(req.body?.status ?? "").trim() || undefined;
      const patch = {
        title: normalizeOptional(req.body?.title),
        description: normalizeOptional(req.body?.description),
        platform: normalizeOptional(req.body?.platform),
        category: normalizeOptional(req.body?.category),
        priority: normalizeOptional(req.body?.priority),
        status: nextStatus ?? null,
        manager_notes: normalizeOptional(req.body?.manager_notes),
        target_quarter: normalizeOptional(req.body?.target_quarter),
        updated_at: new Date().toISOString(),
        approved_by_name:
          nextStatus === "approved"
            ? session.name
            : nextStatus && nextStatus !== "approved"
              ? null
              : undefined,
        approved_at:
          nextStatus === "approved"
            ? new Date().toISOString()
            : nextStatus && nextStatus !== "approved"
              ? null
              : undefined,
      };

      const filtered = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      );

      if (filtered.title !== undefined && !filtered.title) {
        return sendJson(res, 400, { error: "Title cannot be empty." });
      }
      if (filtered.description !== undefined && !filtered.description) {
        return sendJson(res, 400, { error: "Description cannot be empty." });
      }
      if (filtered.platform !== undefined && !["ipath", "noc_dashboard"].includes(String(filtered.platform))) {
        return sendJson(res, 400, { error: "Platform must be iPath or NOC Dashboard." });
      }

      const { data, error } = await supabaseAdmin
        .from("enhancements")
        .update(filtered)
        .eq("id", id)
        .select()
        .single();
      if (error) return sendJson(res, 500, { error: error.message });
      return sendJson(res, 200, data);
    }

    if (req.method === "DELETE") {
      const { error } = await supabaseAdmin
        .from("enhancements")
        .delete()
        .eq("id", id);
      if (error) return sendJson(res, 500, { error: error.message });
      return sendJson(res, 200, { ok: true });
    }

    res.setHeader("Allow", "GET, PATCH, DELETE");
    return sendJson(res, 405, { error: "Method not allowed" });
  } catch (err) {
    return sendJson(res, 500, {
      error: err instanceof Error ? err.message : "Server error",
    });
  }
}
