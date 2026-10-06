import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireManagerAppBuilder } from "../_lib/appbuilder-auth.js";
import { ALL_MEMBERS, applyWorkAllotmentsForDay, WORK_ALLOTMENT_CONFIG } from "../_lib/google-sheets-work-allotment.js";

function parseNow(value: unknown) {
  if (!value) return new Date();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function cronAuthorized(req: VercelRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = String(req.headers.authorization ?? "");
  return Boolean(secret) && auth === `Bearer ${secret}`;
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

  const isCron = req.method === "GET" && cronAuthorized(req);
  if (!isCron) {
    const managerSession = await requireManagerAppBuilder(req, res);
    if (!managerSession) return;
  }

  try {
    const now = parseNow(req.query.at ?? req.body?.at);
    const tracker = req.method === "POST" ? readTrackerPayload(req) : { fairnessEntries: [], scheduledPosts: [], memberNames: ALL_MEMBERS };
    const result = await applyWorkAllotmentsForDay({ now, tracker });

    return res.status(200).json({
      ok: true,
      config: {
        ...WORK_ALLOTMENT_CONFIG,
        memberNames: ALL_MEMBERS,
      },
      result,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to post work allotment.",
    });
  }
}
