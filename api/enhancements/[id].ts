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

function parseUpdates(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createUpdateEntry(type: string, actorName: string, summary: string) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    actor_name: actorName,
    summary,
    created_at: new Date().toISOString(),
  };
}

function splitLegacyTitle(titleValue: unknown, legacyValue: unknown) {
  const title = String(titleValue ?? "").trim();
  const currentLegacy = String(legacyValue ?? "").trim();
  const match = title.match(/^(\d{3,})\s*-\s*(.+)$/);

  if (match) {
    return {
      legacy_id: currentLegacy || match[1],
      title: match[2].trim(),
    };
  }

  return {
    legacy_id: currentLegacy || null,
    title,
  };
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
      const parsed = splitLegacyTitle(data?.title, data?.legacy_id);
      return sendJson(res, 200, {
        ...data,
        legacy_id: parsed.legacy_id,
        title: parsed.title,
      });
    }

    const session = getSession(req);
    if (!session || session.role !== "manager") {
      return sendJson(res, 403, {
        error: "Manager access required.",
        hint: "Sign in with a manager account to edit or approve enhancements.",
      });
    }

    if (req.method === "PATCH") {
      const { data: current, error: currentError } = await supabaseAdmin
        .from("enhancements")
        .select("*")
        .eq("id", id)
        .single();
      if (currentError) return sendJson(res, 500, { error: currentError.message });
      if (!current) return sendJson(res, 404, { error: "Enhancement not found." });

      const nextStatus = String(req.body?.status ?? "").trim() || undefined;
      const parsed = splitLegacyTitle(req.body?.title, req.body?.legacy_id);
      const nextTitle = parsed.title ? parsed.title : normalizeOptional(req.body?.title);
      const nextDescription = normalizeOptional(req.body?.description);
      const nextPlatform = normalizeOptional(req.body?.platform);
      const nextCategory = normalizeOptional(req.body?.category);
      const nextPriority = normalizeOptional(req.body?.priority);
      const nextManagerNotes = normalizeOptional(req.body?.manager_notes);
      const nextTargetQuarter = normalizeOptional(req.body?.target_quarter);
      const nextAssigneeName = normalizeOptional(req.body?.assignee_name);
      const nextAssigneeEmail = normalizeOptional(req.body?.assignee_email);
      const note = normalizeOptional(req.body?.update_note);

      const patch = {
        legacy_id: parsed.legacy_id,
        title: nextTitle,
        description: nextDescription,
        platform: nextPlatform,
        category: nextCategory,
        priority: nextPriority,
        status: nextStatus ?? null,
        manager_notes: nextManagerNotes,
        target_quarter: nextTargetQuarter,
        assignee_name: nextAssigneeName,
        assignee_email: nextAssigneeEmail,
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

      const summaryParts: string[] = [];
      if (current.title !== filtered.title && filtered.title !== undefined) summaryParts.push(`title → ${filtered.title}`);
      if (current.description !== filtered.description && filtered.description !== undefined) summaryParts.push("description updated");
      if (current.platform !== filtered.platform && filtered.platform !== undefined) summaryParts.push(`platform → ${filtered.platform}`);
      if (current.category !== filtered.category && filtered.category !== undefined) summaryParts.push(`category → ${filtered.category}`);
      if (current.priority !== filtered.priority && filtered.priority !== undefined) summaryParts.push(`priority → ${filtered.priority}`);
      if (current.status !== filtered.status && filtered.status !== undefined) summaryParts.push(`status → ${filtered.status}`);
      if (current.target_quarter !== filtered.target_quarter && filtered.target_quarter !== undefined) summaryParts.push(`target → ${filtered.target_quarter ?? "cleared"}`);
      if (current.manager_notes !== filtered.manager_notes && filtered.manager_notes !== undefined) summaryParts.push("manager notes updated");
      if (current.assignee_name !== filtered.assignee_name || current.assignee_email !== filtered.assignee_email) {
        if (filtered.assignee_name !== undefined || filtered.assignee_email !== undefined) {
          summaryParts.push(`assignee → ${filtered.assignee_name ?? filtered.assignee_email ?? "cleared"}`);
        }
      }

      const history = parseUpdates(current.updates_json);
      if (summaryParts.length || note) {
        history.unshift(
          createUpdateEntry(
            "edited",
            session.name,
            [summaryParts.join(", "), note].filter(Boolean).join(note && summaryParts.length ? ". " : ""),
          ),
        );
        filtered.updates_json = JSON.stringify(history.slice(0, 50));
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
