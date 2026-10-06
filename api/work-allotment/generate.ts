import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireManagerAppBuilder } from "../_lib/appbuilder-auth.js";
import { ALL_MEMBERS, planWorkAllotmentsForDay, WORK_ALLOTMENT_CONFIG } from "../_lib/google-sheets-work-allotment.js";

function parseNow(value: unknown) {
  if (!value) return new Date();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function readTrackerPayload(req: VercelRequest) {
  const body = (req.body && typeof req.body === "object") ? req.body : {};
  return {
    fairnessEntries: Array.isArray(body.fairnessEntries) ? body.fairnessEntries : [],
    scheduledPosts: Array.isArray(body.scheduledPosts) ? body.scheduledPosts : [],
    memberNames: Array.isArray(body.memberNames) ? body.memberNames : ALL_MEMBERS,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const managerSession = await requireManagerAppBuilder(req, res);
  if (!managerSession) return;

  try {
    const now = parseNow(req.method === "GET" ? req.query.at : req.body?.at);
    const tracker = req.method === "POST" ? readTrackerPayload(req) : { fairnessEntries: [], scheduledPosts: [], memberNames: ALL_MEMBERS };
    const plan = await planWorkAllotmentsForDay({ now, tracker });

    return res.status(200).json({
      ok: true,
      config: {
        ...WORK_ALLOTMENT_CONFIG,
        memberNames: ALL_MEMBERS,
      },
      result: plan,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to generate work allotment.",
    });
  }
}
