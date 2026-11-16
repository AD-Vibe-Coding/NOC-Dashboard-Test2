import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  hasRingCentralConfig,
  isRingCentralConnected,
  setRingCentralQueueCallsEnabled,
} from "../_lib/ringcentral.js";

type QueueToggleBody = {
  employeeName?: string;
  queueName?: string;
  enabled?: boolean;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!hasRingCentralConfig(req)) {
    return res.status(400).json({ error: "RingCentral OAuth settings are incomplete." });
  }

  if (!(await isRingCentralConnected(req))) {
    return res.status(401).json({ error: "The shared RingCentral session is not connected in this browser. Connect using Anirudh Kukudala's RingCentral account." });
  }

  const body = (req.body ?? {}) as QueueToggleBody;
  const employeeName = String(body.employeeName ?? "").trim();
  const queueName = String(body.queueName ?? "").trim();
  const enabled = typeof body.enabled === "boolean" ? body.enabled : null;

  if (!employeeName) {
    return res.status(400).json({ error: "employeeName is required." });
  }

  if (enabled === null) {
    return res.status(400).json({ error: "enabled must be a boolean." });
  }

  try {
    const result = await setRingCentralQueueCallsEnabled(req, res, employeeName, enabled, queueName || undefined);
    return res.status(200).json({
      ok: true,
      employeeName: result.employeeName,
      canonicalName: result.canonicalName,
      displayName: result.displayName,
      extensionId: result.extensionId,
      queueName: result.queueName,
      enabled: result.enabled,
      dndStatus: result.dndStatus,
      message: enabled
        ? `${result.canonicalName} is now accepting calls in ${result.queueName ?? "the configured RingCentral queues"}.`
        : `${result.canonicalName} is no longer accepting calls in ${result.queueName ?? "the configured RingCentral queues"}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[RingCentral] queue toggle failed for ${employeeName}: ${message}`);
    return res.status(500).json({
      ok: false,
      error: message.slice(0, 240),
    });
  }
}
