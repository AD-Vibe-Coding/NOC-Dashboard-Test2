import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadSession } from "../../../auth/_lib/session.js";
import { defaultRoleFor, lookupByEmail } from "../../../_lib/roles.js";
import { supabaseAdmin } from "../../../_lib/supabase-admin.js";

function normalizePersonName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

function samePersonLoose(a: string | null | undefined, b: string | null | undefined) {
  const left = normalizePersonName(a);
  const right = normalizePersonName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.replace(/\s+/g, "") === right.replace(/\s+/g, "");
}

function canonicalIdentity(session: Awaited<ReturnType<typeof loadSession>>) {
  const email = String(session?.email ?? "").trim().toLowerCase();
  const byEmail = email ? lookupByEmail(email) : null;
  return {
    name: byEmail?.name ?? String(session?.name ?? "").trim(),
    role: byEmail?.role ?? defaultRoleFor(String(session?.name ?? "").trim()),
    email,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST" && req.method !== "PATCH") {
    res.setHeader("Allow", "POST, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await loadSession(req);
  if (!session) {
    return res.status(401).json({ error: "Sign in required." });
  }

  const identity = canonicalIdentity(session);
  if (!identity.name) {
    return res.status(400).json({ error: "Unable to resolve signed-in user." });
  }

  const id = Number(req.query.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid ownership task id." });
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("ownership_tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (existingError) {
    return res.status(500).json({ error: existingError.message });
  }
  if (!existing) {
    return res.status(404).json({ error: "Ownership task not found." });
  }
  if (!samePersonLoose(existing.assignee_name, identity.name) && identity.role !== "manager") {
    return res.status(403).json({ error: "You can only complete your own ownership tasks." });
  }

  const nowIso = new Date().toISOString();
  const patch = {
    status: "completed",
    completed_at: existing.completed_at || nowIso,
    next_reminder_at: null,
    last_reminded_at: null,
    last_error: "",
  };

  const { data, error } = await supabaseAdmin
    .from("ownership_tasks")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json(data);
}
