import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCollection } from "./_lib/crud.js";
import { getAppBuilderSession, requireManagerAppBuilder } from "./_lib/appbuilder-auth.js";
import { supabaseAdmin } from "./_lib/supabase-admin.js";

function stripAuto(row: Record<string, unknown>) {
  const { id: _id, created_at: _createdAt, ...rest } = row;
  return rest;
}

/**
 * Saved NOC MTTR report uploads.
 * Managers can list history and create new saved imports.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const session = await getAppBuilderSession(req);
    const effectiveRole = session?.role;
    if (!session || (effectiveRole !== "manager" && effectiveRole !== "customer_service_manager")) {
      return res.status(403).json({ error: "Manager or Customer Service Manager required." });
    }
    const orderDir = req.query.orderDir === "asc" ? true : false;
    const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const limit = typeof limitRaw === "string" && /^\d+$/.test(limitRaw) ? Math.min(Number(limitRaw), 100) : 25;

    const { data, error } = await supabaseAdmin
      .from("noc_mttr_reports")
      .select("id, file_name, file_size_bytes, uploaded_by, selected_sheet_name, selected_customer_column, selected_month_column, selected_mttr_column, row_count, created_at")
      .order("id", { ascending: orderDir })
      .limit(limit);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data ?? []);
  }

  const managerSession = await requireManagerAppBuilder(req, res);
  if (!managerSession) return;

  if (req.method === "POST") {
    const rawValues = Array.isArray(req.body?.values) ? req.body.values : [];
    const values = rawValues
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
      .map((row) => stripAuto(row));

    if (values.length === 0) {
      return res.status(400).json({ error: "Body must include a non-empty values array" });
    }

    const { data, error } = await supabaseAdmin
      .from("noc_mttr_reports")
      .insert(values)
      .select("id, file_name, file_size_bytes, uploaded_by, selected_sheet_name, selected_customer_column, selected_month_column, selected_mttr_column, row_count, created_at");

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data ?? []);
  }

  return handleCollection("noc_mttr_reports", req, res);
}
