import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadSession } from "../auth/_lib/session.js";
import { defaultRoleFor, lookupByEmail } from "../_lib/roles.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { planWorkAllotmentsForDay, WORK_ALLOTMENT_CONFIG } from "../_lib/google-sheets-work-allotment.js";
import { buildOwnershipTaskRows } from "../_lib/work-allotment-automation.js";

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

  const leftCompact = left.replace(/\s+/g, "");
  const rightCompact = right.replace(/\s+/g, "");
  if (leftCompact === rightCompact) return true;

  return false;
}

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

function isMissingTableError(error: unknown) {
  const message = String((error as { message?: string } | null)?.message ?? error ?? "");
  return message.includes("schema cache") || message.includes("does not exist");
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

async function listPersistedOwnershipTasks(name: string, operationalDate: string) {
  const { data, error } = await supabaseAdmin
    .from("ownership_tasks")
    .select("*")
    .eq("operational_date", operationalDate)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).filter((row) => samePersonLoose(row.assignee_name, name));
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
  if (!identity.name) {
    return res.status(400).json({ error: "Unable to resolve signed-in user." });
  }

  const now = new Date();
  const operationalDate = zonedDateKey(now);

  try {
    const persisted = await listPersistedOwnershipTasks(identity.name, operationalDate);
    if (persisted.length > 0) {
      return res.status(200).json(persisted);
    }
  } catch (error) {
    if (!isMissingTableError(error)) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load ownership tasks." });
    }
  }

  try {
    const generatedAt = now.toISOString();
    const plan = await planWorkAllotmentsForDay({ now });
    const liveRows = buildOwnershipTaskRows(plan, operationalDate, generatedAt).filter((row) => samePersonLoose(row.assignee_name, identity.name));

    if (liveRows.length === 0) {
      return res.status(200).json([]);
    }

    const insertedRows = [];
    for (const row of liveRows) {
      try {
        const { data, error } = await supabaseAdmin
          .from("ownership_tasks")
          .upsert(row, { onConflict: "dedupe_key" })
          .select("*");
        if (error) throw error;
        insertedRows.push(...(data ?? []));
      } catch (error) {
        if (isMissingTableError(error)) {
          insertedRows.push({
            id: `derived-${row.dedupe_key}`,
            created_at: generatedAt,
            updated_at: generatedAt,
            ...row,
            is_derived: true,
          });
          continue;
        }
        throw error;
      }
    }

    return res.status(200).json(insertedRows);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to resolve ownership tasks." });
  }
}
