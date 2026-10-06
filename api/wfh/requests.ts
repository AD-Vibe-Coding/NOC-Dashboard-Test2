/**
 * GET  /api/wfh/requests  — list requests (manager sees all; employee sees own)
 * POST /api/wfh/requests  — submit a new WFH request
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { getAppBuilderSession } from "../_lib/appbuilder-auth.js";

function dayCount(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!isFinite(a) || !isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // ----------------------------------------------------------------
    // GET — list requests
    // ----------------------------------------------------------------
    if (req.method === "GET") {
      const session = await getAppBuilderSession(req);
      if (!session) {
        return res.status(200).json({
          requests: [],
          is_approver: false,
          approver_name: "your manager",
          viewer: null,
        });
      }

      const isManager = session.role === "manager";

      let query = supabaseAdmin
        .from("wfh_requests")
        .select("*")
        .order("submitted_at", { ascending: false });

      if (!isManager) {
        query = (query as any).eq("employee_name", session.name);
      }

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      return res.status(200).json({
        requests: data ?? [],
        is_approver: isManager,
        approver_name: isManager ? session.name : "your manager",
        viewer: session.name,
      });
    }

    // ----------------------------------------------------------------
    // POST — submit a new request
    // ----------------------------------------------------------------
    if (req.method === "POST") {
      const session = await getAppBuilderSession(req);
      if (!session) {
        return res.status(401).json({ error: "Not authenticated — please sign in first" });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const start_date = String(body.start_date ?? "").trim();
      const end_date   = String(body.end_date   ?? "").trim();
      const reason     = String(body.reason     ?? "").trim();

      if (!start_date || !end_date || !reason) {
        return res.status(400).json({ error: "start_date, end_date, and reason are required" });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
        return res.status(400).json({ error: "Dates must be YYYY-MM-DD" });
      }
      if (Date.parse(`${end_date}T00:00:00Z`) < Date.parse(`${start_date}T00:00:00Z`)) {
        return res.status(400).json({ error: "end_date must be on or after start_date" });
      }
      if (reason.length < 3) {
        return res.status(400).json({ error: "Reason must be at least 3 characters" });
      }

      const days = dayCount(start_date, end_date);
      const now  = new Date().toISOString();

      const { data, error } = await supabaseAdmin
        .from("wfh_requests")
        .insert({
          employee_name:  session.name,
          employee_email: session.email ?? null,
          start_date,
          end_date,
          reason,
          status:        "pending",
          submitted_at:  now,
          reviewed_by:   null,
          reviewed_at:   null,
          decision_note: null,
        })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });

      return res.status(201).json({ request: data, days });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[wfh/requests]", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
