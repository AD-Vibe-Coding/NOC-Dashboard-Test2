import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleItem } from "../_lib/crud.js";
import { getAppBuilderSession, requireManagerAppBuilder } from "../_lib/appbuilder-auth.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

/**
 * Saved NOC MTTR report record.
 * Managers can update saved column mappings for a report.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;
  const idRaw = Array.isArray(id) ? id[0] : id;
  const recordId = Number(idRaw);

  if (!Number.isFinite(recordId)) {
    return res.status(400).json({ error: `Invalid id: ${idRaw}` });
  }

  if (req.method === "GET") {
    const session = await getAppBuilderSession(req);
    const effectiveRole = session?.role;
    if (!session || (effectiveRole !== "manager" && effectiveRole !== "customer_service_manager")) {
      return res.status(403).json({ error: "Manager or Customer Service Manager required." });
    }
    const { data, error } = await supabaseAdmin
      .from("noc_mttr_reports")
      .select("id, file_name, file_size_bytes, uploaded_by, selected_sheet_name, selected_customer_column, selected_month_column, selected_mttr_column, parsed_json, row_count, created_at")
      .eq("id", recordId)
      .single();

    if (error) {
      return res.status(404).json({ error: error.message });
    }

    return res.status(200).json(data);
  }

  const managerSession = await requireManagerAppBuilder(req, res);
  if (!managerSession) return;

  if (req.method === "PATCH") {
    const patch = req.body ?? {};
    const lightweightPatch = {
      selected_sheet_name: patch.selected_sheet_name ?? null,
      selected_customer_column: patch.selected_customer_column ?? null,
      selected_month_column: patch.selected_month_column ?? null,
      selected_mttr_column: patch.selected_mttr_column ?? null,
      row_count: patch.row_count ?? null,
    };

    const { data, error } = await supabaseAdmin
      .from("noc_mttr_reports")
      .update(lightweightPatch)
      .eq("id", recordId)
      .select("id, file_name, selected_sheet_name, selected_customer_column, selected_month_column, selected_mttr_column, row_count, created_at")
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data);
  }

  return handleItem("noc_mttr_reports", idRaw, req, res);
}
