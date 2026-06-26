import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { getSession, requireManager } from "./_lib/auth-middleware.js";

type EnhancementInsert = {
  legacy_id: string | null;
  title: string;
  description: string;
  platform: string;
  category: string;
  priority: string;
  status: string;
  submitted_by_name: string;
  submitted_by_email: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  manager_notes: string | null;
  target_quarter: string | null;
  updates_json: string;
  updated_at: string;
};

function sendJson(res: VercelResponse, status: number, body: unknown) {
  return res.status(status).json(body);
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function splitLegacyTitle(titleValue: unknown, legacyValue: unknown) {
  const title = normalizeText(titleValue);
  const currentLegacy = normalizeText(legacyValue);
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

function normalizeRow(row: Record<string, unknown>) {
  const parsed = splitLegacyTitle(row.title, row.legacy_id);
  return {
    ...row,
    legacy_id: parsed.legacy_id,
    title: parsed.title,
    assignee_name: normalizeText(row.assignee_name) || null,
    assignee_email: normalizeText(row.assignee_email) || null,
    updates_json: JSON.stringify(parseUpdates(row.updates_json)),
  };
}

const LEGACY_IPATH_ENHANCEMENTS: EnhancementInsert[] = [
  {
    legacy_id: "19396",
    title: "Adding Ticket Summary before handoff (using AI)",
    description: "Build AI into the Trouble Ticket system to provide a summary of what has transpired on a ticket and details for anyone reviewing that ticket.",
    platform: "ipath",
    category: "automation",
    priority: "high",
    status: "pending",
    submitted_by_name: "Imported iPath backlog",
    submitted_by_email: null,
    approved_by_name: null,
    approved_at: null,
    assignee_name: null,
    assignee_email: null,
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Submitted to SD Team - Pending evaluation and amount of effort.",
    target_quarter: "2025-Q4",
    updates_json: "[]",
    updated_at: "2025-12-04T00:00:00.000Z",
  },
  {
    legacy_id: null,
    title: "Customer Metrics",
    description: "Automate recurring customer reporting and provide customer-facing reporting details on request.",
    platform: "ipath",
    category: "reporting",
    priority: "medium",
    status: "pending",
    submitted_by_name: "Imported iPath backlog",
    submitted_by_email: null,
    approved_by_name: null,
    approved_at: null,
    assignee_name: null,
    assignee_email: null,
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Pending requirements from NOC Leadership and submittance to SD team.",
    target_quarter: "2025-Q4",
    updates_json: "[]",
    updated_at: "2025-12-04T00:00:00.000Z",
  },
  {
    legacy_id: null,
    title: "Mobility Task Enhancement",
    description: "Provide needed information to complete Mobility Tasks in an automated fashion so the tech performing the activation does not have to manually gather required information.",
    platform: "ipath",
    category: "automation",
    priority: "medium",
    status: "pending",
    submitted_by_name: "Imported iPath backlog",
    submitted_by_email: null,
    approved_by_name: null,
    approved_at: null,
    assignee_name: null,
    assignee_email: null,
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Pending requirements from NOC Leadership and submittance to SD team.",
    target_quarter: "2025-Q4",
    updates_json: "[]",
    updated_at: "2025-12-04T00:00:00.000Z",
  },
  {
    legacy_id: "19271",
    title: "Request to Change/Add a Device to a Mobile Line (MDN)",
    description: "Allow customers to change or add their device to a mobile line via the vManager platform.",
    platform: "ipath",
    category: "workflow",
    priority: "medium",
    status: "pending",
    submitted_by_name: "Imported iPath backlog",
    submitted_by_email: null,
    approved_by_name: null,
    approved_at: null,
    assignee_name: null,
    assignee_email: null,
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Submitted to SD Team - Pending evaluation and amount of effort.",
    target_quarter: "2025-Q4",
    updates_json: "[]",
    updated_at: "2025-12-04T00:00:00.000Z",
  },
  {
    legacy_id: null,
    title: "Weeldi - Comcast Cable Outage inquiry and modem check",
    description: "Use a bot to check the Comcast website for known outages and modem health to automate up-front triage of Comcast cable trouble tickets.",
    platform: "ipath",
    category: "integration",
    priority: "medium",
    status: "in_progress",
    submitted_by_name: "Imported iPath backlog",
    submitted_by_email: null,
    approved_by_name: null,
    approved_at: null,
    assignee_name: null,
    assignee_email: null,
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Business Analyst is working to build templates within Weeldi and establish work effort required to complete this enhancement request.",
    target_quarter: "2025-Q4",
    updates_json: "[]",
    updated_at: "2025-12-04T00:00:00.000Z",
  },
  {
    legacy_id: null,
    title: "Weeldi - Spectrum Cable Outage inquiry and modem check",
    description: "Use a bot to check the Spectrum website for known outages and modem health to automate up-front triage of cable trouble tickets.",
    platform: "ipath",
    category: "integration",
    priority: "medium",
    status: "in_progress",
    submitted_by_name: "Imported iPath backlog",
    submitted_by_email: null,
    approved_by_name: null,
    approved_at: null,
    assignee_name: null,
    assignee_email: null,
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Business Analyst is working to build templates within Weeldi and establish work effort required to complete this enhancement request.",
    target_quarter: "2025-Q4",
    updates_json: "[]",
    updated_at: "2025-12-04T00:00:00.000Z",
  },
  {
    legacy_id: null,
    title: "Weeldi - Open AT&T Brokerage/Retail Tickets in AT&T Express",
    description: "Use a bot to open trouble tickets in the AT&T Express website in an automated fashion similar to an API workflow.",
    platform: "ipath",
    category: "integration",
    priority: "high",
    status: "in_progress",
    submitted_by_name: "Imported iPath backlog",
    submitted_by_email: null,
    approved_by_name: null,
    approved_at: null,
    assignee_name: null,
    assignee_email: null,
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Business Analyst is working to build templates within Weeldi and establish work effort required to complete this enhancement request.",
    target_quarter: "2025-Q4",
    updates_json: "[]",
    updated_at: "2025-12-04T00:00:00.000Z",
  },
  {
    legacy_id: null,
    title: "Weeldi - Open Verizon Brokerage/Retail Tickets on Verizon website",
    description: "Use a bot to open trouble tickets on the Verizon website in an automated fashion similar to an API workflow.",
    platform: "ipath",
    category: "integration",
    priority: "high",
    status: "in_progress",
    submitted_by_name: "Imported iPath backlog",
    submitted_by_email: null,
    approved_by_name: null,
    approved_at: null,
    assignee_name: null,
    assignee_email: null,
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Business Analyst is working to build templates within Weeldi and establish work effort required to complete this enhancement request.",
    target_quarter: "2025-Q4",
    updates_json: "[]",
    updated_at: "2025-12-04T00:00:00.000Z",
  },
  {
    legacy_id: "19271",
    title: "Updating Inventory from a Trouble Ticket Activity",
    description: "Automate the follow-up inventory/order activity required after troubleshooting changes are made through a trouble ticket so inventory remains accurate.",
    platform: "ipath",
    category: "automation",
    priority: "medium",
    status: "pending",
    submitted_by_name: "Imported iPath backlog",
    submitted_by_email: null,
    approved_by_name: null,
    approved_at: null,
    assignee_name: null,
    assignee_email: null,
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Submitted to SD team for effort of work and timeline.",
    target_quarter: "2025-Q4",
    updates_json: "[]",
    updated_at: "2025-12-04T00:00:00.000Z",
  },
  {
    legacy_id: null,
    title: "Update Trouble Ticket Subject line",
    description: "Update trouble ticket notification subject lines to include the account name or reference ID as well as the carrier.",
    platform: "ipath",
    category: "workflow",
    priority: "medium",
    status: "pending",
    submitted_by_name: "Imported iPath backlog",
    submitted_by_email: null,
    approved_by_name: null,
    approved_at: null,
    assignee_name: null,
    assignee_email: null,
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Pending submission to SD team.",
    target_quarter: "2025-Q4",
    updates_json: "[]",
    updated_at: "2025-12-04T00:00:00.000Z",
  },
  {
    legacy_id: "14497",
    title: "Develop a report that compares iPath with LogicMonitor (LM)",
    description: "Create a report to ensure LogicMonitor and iPath stay in sync for active services.",
    platform: "ipath",
    category: "reporting",
    priority: "medium",
    status: "pending",
    submitted_by_name: "Imported iPath backlog",
    submitted_by_email: null,
    approved_by_name: null,
    approved_at: null,
    assignee_name: null,
    assignee_email: null,
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Pending submission to SD team.",
    target_quarter: "2025-Q4",
    updates_json: "[]",
    updated_at: "2025-12-04T00:00:00.000Z",
  },
  {
    legacy_id: "10080",
    title: "Highlighted Ticket Notes History",
    description: "Show who opened a highlighted ticket note after an update so the team has visibility once the note is viewed.",
    platform: "ipath",
    category: "ui",
    priority: "medium",
    status: "pending",
    submitted_by_name: "Imported iPath backlog",
    submitted_by_email: null,
    approved_by_name: null,
    approved_at: null,
    assignee_name: null,
    assignee_email: null,
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Pending submission to SD team.",
    target_quarter: "2025-Q4",
    updates_json: "[]",
    updated_at: "2025-12-04T00:00:00.000Z",
  },
  {
    legacy_id: null,
    title: "Search Capability in iPath",
    description: "Add the capability to search customer email addresses and IPs within iPath so services can be identified by IP address.",
    platform: "ipath",
    category: "workflow",
    priority: "high",
    status: "pending",
    submitted_by_name: "Imported iPath backlog",
    submitted_by_email: null,
    approved_by_name: null,
    approved_at: null,
    assignee_name: null,
    assignee_email: null,
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Pending submission to SD team.",
    target_quarter: "2025-Q4",
    updates_json: "[]",
    updated_at: "2025-12-04T00:00:00.000Z",
  },
  {
    legacy_id: "8222",
    title: "Flapping updates",
    description: "Send an email to the ticket owner when flapping updates are posted to ticket notes.",
    platform: "ipath",
    category: "automation",
    priority: "medium",
    status: "pending",
    submitted_by_name: "Imported iPath backlog",
    submitted_by_email: null,
    approved_by_name: null,
    approved_at: null,
    assignee_name: null,
    assignee_email: null,
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Pending submission to SD team.",
    target_quarter: "2025-Q4",
    updates_json: "[]",
    updated_at: "2025-12-04T00:00:00.000Z",
  },
  {
    legacy_id: "9277",
    title: "Updating timer for the \"Researching\" stage",
    description: "Update the amount of time before escalations are triggered while a ticket is in the Researching stage in an iPath trouble ticket.",
    platform: "ipath",
    category: "workflow",
    priority: "medium",
    status: "pending",
    submitted_by_name: "Imported iPath backlog",
    submitted_by_email: null,
    approved_by_name: null,
    approved_at: null,
    assignee_name: null,
    assignee_email: null,
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Pending submission to SD team.",
    target_quarter: "2025-Q4",
    updates_json: "[]",
    updated_at: "2025-12-04T00:00:00.000Z",
  },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("enhancements")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return sendJson(res, 500, { error: error.message });

      const normalized = (data ?? []).map((row) => normalizeRow(row));

      return sendJson(res, 200, normalized);
    }

    if (req.method === "POST") {
      const session = getSession(req);
      if (!session?.name) {
        return sendJson(res, 401, { error: "Sign in to submit an enhancement." });
      }

      if (req.body?.action === "bulk_update") {
        if (!requireManager(req, res)) return;

        const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value)) : [];
        if (!ids.length) return sendJson(res, 400, { error: "Select at least one enhancement." });

        const updates: Record<string, unknown> = {};
        const summaryParts: string[] = [];
        const nextStatus = normalizeText(req.body?.patch?.status);
        const nextPriority = normalizeText(req.body?.patch?.priority);
        const nextTargetQuarter = normalizeText(req.body?.patch?.target_quarter);
        const nextAssigneeName = normalizeText(req.body?.patch?.assignee_name);
        const nextAssigneeEmail = normalizeText(req.body?.patch?.assignee_email);

        if (nextStatus) {
          updates.status = nextStatus;
          summaryParts.push(`status → ${nextStatus}`);
          if (nextStatus === "approved") {
            updates.approved_by_name = session.name;
            updates.approved_at = new Date().toISOString();
          }
        }
        if (nextPriority) {
          updates.priority = nextPriority;
          summaryParts.push(`priority → ${nextPriority}`);
        }
        if (nextTargetQuarter) {
          updates.target_quarter = nextTargetQuarter;
          summaryParts.push(`target → ${nextTargetQuarter}`);
        }
        if (nextAssigneeName || nextAssigneeEmail) {
          updates.assignee_name = nextAssigneeName || null;
          updates.assignee_email = nextAssigneeEmail || null;
          summaryParts.push(`assignee → ${nextAssigneeName || nextAssigneeEmail}`);
        }

        updates.updated_at = new Date().toISOString();

        const { data: currentRows, error: currentError } = await supabaseAdmin
          .from("enhancements")
          .select("id, updates_json")
          .in("id", ids);
        if (currentError) return sendJson(res, 500, { error: currentError.message });

        const note = normalizeText(req.body?.note);
        const summary = summaryParts.length ? summaryParts.join(", ") : "Bulk update";

        for (const row of currentRows ?? []) {
          const history = parseUpdates(row.updates_json);
          history.unshift(createUpdateEntry("bulk_update", session.name, note ? `${summary}. ${note}` : summary));
          const { error } = await supabaseAdmin
            .from("enhancements")
            .update({ ...updates, updates_json: JSON.stringify(history.slice(0, 50)) })
            .eq("id", row.id);
          if (error) return sendJson(res, 500, { error: error.message });
        }

        return sendJson(res, 200, { ok: true, updated: ids.length });
      }

      if (req.body?.action === "seed_ipath_baseline") {
        if (!requireManager(req, res)) return;

        const titles = LEGACY_IPATH_ENHANCEMENTS.map((item) => item.title);
        const { data: existingRows, error: existingError } = await supabaseAdmin
          .from("enhancements")
          .select("title, platform")
          .eq("platform", "ipath")
          .in("title", titles);

        if (existingError) return sendJson(res, 500, { error: existingError.message });

        const existingTitleSet = new Set((existingRows ?? []).map((row) => `${row.platform}::${row.title}`));
        const missingRows = LEGACY_IPATH_ENHANCEMENTS.filter(
          (row) => !existingTitleSet.has(`${row.platform}::${row.title}`),
        );

        if (missingRows.length === 0) {
          return sendJson(res, 200, { inserted: 0, skipped: LEGACY_IPATH_ENHANCEMENTS.length, message: "iPath baseline already imported." });
        }

        const { data, error } = await supabaseAdmin
          .from("enhancements")
          .insert(missingRows)
          .select();

        if (error) return sendJson(res, 500, { error: error.message });
        return sendJson(res, 201, {
          inserted: data?.length ?? missingRows.length,
          skipped: LEGACY_IPATH_ENHANCEMENTS.length - missingRows.length,
          rows: data ?? [],
        });
      }

      const values = Array.isArray(req.body?.values) ? req.body.values : [req.body ?? {}];
      const prepared: EnhancementInsert[] = [];

      for (const raw of values) {
        const parsed = splitLegacyTitle(raw?.title, raw?.legacy_id);
        const title = parsed.title;
        const description = normalizeText(raw?.description);
        const platform = normalizeText(raw?.platform) || "noc_dashboard";
        const category = normalizeText(raw?.category) || "workflow";
        const priority = normalizeText(raw?.priority) || "medium";

        if (!title) return sendJson(res, 400, { error: "Title is required." });
        if (!description) return sendJson(res, 400, { error: "Description is required." });
        if (!["ipath", "noc_dashboard"].includes(platform)) {
          return sendJson(res, 400, { error: "Platform must be iPath or NOC Dashboard." });
        }

        prepared.push({
          legacy_id: parsed.legacy_id,
          title,
          description,
          platform,
          category,
          priority,
          status: "pending",
          submitted_by_name: session.name,
          submitted_by_email: session.email ?? null,
          approved_by_name: null,
          approved_at: null,
          assignee_name: null,
          assignee_email: null,
          manager_notes: null,
          target_quarter: normalizeText(raw?.target_quarter) || null,
          updates_json: JSON.stringify([
            createUpdateEntry(
              "submitted",
              session.name,
              `Submitted enhancement${platform === "ipath" ? " for iPath" : " for NOC Dashboard"}.`,
            ),
          ]),
          updated_at: new Date().toISOString(),
        });
      }

      const { data, error } = await supabaseAdmin
        .from("enhancements")
        .insert(prepared)
        .select();
      if (error) return sendJson(res, 500, { error: error.message });
      return sendJson(res, 201, data ?? []);
    }

    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Method not allowed" });
  } catch (err) {
    return sendJson(res, 500, {
      error: err instanceof Error ? err.message : "Server error",
    });
  }
}
