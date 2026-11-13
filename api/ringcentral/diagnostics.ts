import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getRingCentralConfig,
  getActiveToken,
  hasRingCentralConfig,
  isRingCentralConnected,
  listCallQueues,
} from "../_lib/ringcentral.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const config = getRingCentralConfig(req);

  if (!hasRingCentralConfig(req)) {
    return res.status(200).json({
      ok: false,
      connected: false,
      config: {
        queueName: config.queueName,
        queueNames: config.queueNames,
        queueId: config.queueId,
      },
      error: "RingCentral OAuth settings are incomplete.",
    });
  }

  if (!isRingCentralConnected(req)) {
    return res.status(200).json({
      ok: false,
      connected: false,
      config: {
        queueName: config.queueName,
        queueNames: config.queueNames,
        queueId: config.queueId,
      },
      error: "RingCentral OAuth is configured but not connected yet.",
    });
  }

  try {
    const token = await getActiveToken(req, res);
    const queues = await listCallQueues(req, res).catch(() => []);

    return res.status(200).json({
      ok: true,
      connected: true,
      config: {
        queueName: config.queueName,
        queueNames: config.queueNames,
        queueId: config.queueId,
      },
      token: {
        scope: token.scope ?? null,
        expiresAt: token.expiresAt,
        refreshTokenExpiresAt: token.refreshTokenExpiresAt ?? null,
      },
      queueCount: queues.length,
      queues: queues.map((queue: any) => ({
        id: String(queue?.id ?? ""),
        name: String(queue?.name ?? ""),
        extensionNumber: String(queue?.extensionNumber ?? ""),
      })),
    });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      connected: true,
      config: {
        queueName: config.queueName,
        queueNames: config.queueNames,
        queueId: config.queueId,
      },
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
