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
  manager_notes: string | null;
  target_quarter: string | null;
  updated_at: string;
};

function sendJson(res: VercelResponse, status: number, body: unknown) {
  return res.status(status).json(body);
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
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
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Submitted to SD Team - Pending evaluation and amount of effort.",
    target_quarter: "2025-Q4",
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
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Pending requirements from NOC Leadership and submittance to SD team.",
    target_quarter: "2025-Q4",
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
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Pending requirements from NOC Leadership and submittance to SD team.",
    target_quarter: "2025-Q4",
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
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Submitted to SD Team - Pending evaluation and amount of effort.",
    target_quarter: "2025-Q4",
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
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Business Analyst is working to build templates within Weeldi and establish work effort required to complete this enhancement request.",
    target_quarter: "2025-Q4",
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
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Business Analyst is working to build templates within Weeldi and establish work effort required to complete this enhancement request.",
    target_quarter: "2025-Q4",
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
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Business Analyst is working to build templates within Weeldi and establish work effort required to complete this enhancement request.",
    target_quarter: "2025-Q4",
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
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Business Analyst is working to build templates within Weeldi and establish work effort required to complete this enhancement request.",
    target_quarter: "2025-Q4",
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
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Submitted to SD team for effort of work and timeline.",
    target_quarter: "2025-Q4",
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
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Pending submission to SD team.",
    target_quarter: "2025-Q4",
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
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Pending submission to SD team.",
    target_quarter: "2025-Q4",
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
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Pending submission to SD team.",
    target_quarter: "2025-Q4",
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
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Pending submission to SD team.",
    target_quarter: "2025-Q4",
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
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Pending submission to SD team.",
    target_quarter: "2025-Q4",
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
    manager_notes: "Imported from SD Enhancements list on 2025-12-04. Legacy status: Pending submission to SD team.",
    target_quarter: "2025-Q4",
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
      return sendJson(res, 200, data ?? []);
    }

    if (req.method === "POST") {
      const session = getSession(req);
      if (!session?.name) {
        return sendJson(res, 401, { error: "Sign in to submit an enhancement." });
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
        const title = normalizeText(raw?.title);
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
          legacy_id: normalizeText(raw?.legacy_id) || null,
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
          manager_notes: null,
          target_quarter: normalizeText(raw?.target_quarter) || null,
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
