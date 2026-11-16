import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getActiveToken,
  getCachedToken,
  getRingCentralConfig,
  getTeamAvailabilityProvider,
  hasRingCentralConfig,
  isRingCentralConnected,
  ringCentralGet,
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
      provider: getTeamAvailabilityProvider(),
      authType: "oauth",
      configured: false,
      connected: false,
      serverUrl: config.serverUrl || null,
      redirectUri: config.redirectUri || null,
      oauthSessionPresent: false,
      tokenCached: false,
      warning: "RingCentral OAuth credentials are not fully configured.",
    });
  }

  if (!isRingCentralConnected(req)) {
    return res.status(200).json({
      provider: getTeamAvailabilityProvider(),
      authType: "oauth",
      configured: true,
      connected: false,
      serverUrl: config.serverUrl,
      redirectUri: config.redirectUri,
      oauthSessionPresent: false,
      tokenCached: Boolean(getCachedToken(req)?.accessToken),
      warning: "RingCentral OAuth is configured but not connected yet.",
    });
  }

  try {
    const token = await getActiveToken(req, res);
    const extension = await ringCentralGet(req, res, "/restapi/v1.0/account/~/extension/~/");
    return res.status(200).json({
      provider: getTeamAvailabilityProvider(),
      authType: "oauth",
      configured: true,
      connected: true,
      serverUrl: config.serverUrl,
      redirectUri: config.redirectUri,
      oauthSessionPresent: true,
      tokenCached: Boolean(getCachedToken(req)?.accessToken),
      tokenOwnerId: token.ownerId ?? null,
      tokenExpiresAt: new Date(token.expiresAt).toISOString(),
      extension: {
        id: extension?.id ?? null,
        name: extension?.name ?? null,
        email: extension?.contact?.email ?? null,
      },
      warning: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(200).json({
      provider: getTeamAvailabilityProvider(),
      authType: "oauth",
      configured: true,
      connected: false,
      serverUrl: config.serverUrl,
      redirectUri: config.redirectUri,
      oauthSessionPresent: isRingCentralConnected(req),
      tokenCached: Boolean(getCachedToken(req)?.accessToken),
      warning: message,
    });
  }
}
