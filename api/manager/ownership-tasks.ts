import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadSession } from "../auth/_lib/session.js";
import { defaultRoleFor, lookupByEmail } from "../_lib/roles.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { WORK_ALLOTMENT_CONFIG } from "../_lib/google-sheets-work-allotment.js";

function zonedDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: WORK_ALLOTMENT_CONFIG.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
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

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await loadSession(req);
  if (!session) {
    return res.status(401).json({ error: "Sign in required." });
  }

  const identity = canonicalIdentity(session);
  if (identity.role !== "manager") {
    return res.status(403).json({ error: "Manager access required." });
  }

  try {
    const operationalDate = zonedDateKey(new Date());
    const { data, error } = await supabaseAdmin
      .from("ownership_tasks")
      .select("*")
      .eq("operational_date", operationalDate)
      .eq("task_type", "work_allotment_off_members")
      .order("status", { ascending: true })
      .order("assignee_name", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data ?? []);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load handoff tasks." });
  }
}
