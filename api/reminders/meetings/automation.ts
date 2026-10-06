import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSession } from "../../_lib/auth-middleware.js";

function parseNow(value: unknown) {
  if (!value) return new Date();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function runStep(req: VercelRequest, path: string, now: Date) {
  const host = String(req.headers.host ?? "").trim();
  if (!host) {
    throw new Error("Missing request host for reminder automation.");
  }

  const cookie = String(req.headers.cookie ?? "");
  const protocol = host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  const url = new URL(`${protocol}://${host}${path}`);
  url.searchParams.set("at", now.toISOString());

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: cookie ? { cookie } : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error ?? `Failed ${path}`));
  }
  return payload;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: "Sign in required." });
  }

  try {
    const now = parseNow(req.body?.at);
    const action = String(req.body?.action ?? "run");

    if (action === "sync") {
      const result = await runStep(req, "/api/reminders/meetings/sync", now);
      return res.status(200).json({ ok: true, action, result });
    }

    if (action === "plan") {
      const result = await runStep(req, "/api/reminders/meetings/plan", now);
      return res.status(200).json({ ok: true, action, result });
    }

    if (action === "dispatch") {
      const result = await runStep(req, "/api/reminders/meetings/dispatch", now);
      return res.status(200).json({ ok: true, action, result });
    }

    if (action === "reconcile") {
      const result = await runStep(req, "/api/reminders/meetings/reconcile", now);
      return res.status(200).json({ ok: true, action, result });
    }

    const sync = await runStep(req, "/api/reminders/meetings/sync", now);
    const plan = await runStep(req, "/api/reminders/meetings/plan", now);
    const dispatch = await runStep(req, "/api/reminders/meetings/dispatch", now);
    const reconcile = await runStep(req, "/api/reminders/meetings/reconcile", now);

    return res.status(200).json({
      ok: true,
      action,
      ranAt: now.toISOString(),
      result: { sync, plan, dispatch, reconcile },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to run meeting reminder automation.",
    });
  }
}
