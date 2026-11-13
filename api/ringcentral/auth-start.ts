import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRingCentralAuthorizeUrl, hasRingCentralConfig } from "../_lib/ringcentral.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!hasRingCentralConfig(req)) {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({
      authType: "oauth",
      configured: false,
      message: "RingCentral OAuth is not fully configured.",
      nextStep: "Set RINGCENTRAL_CLIENT_ID, RINGCENTRAL_CLIENT_SECRET, RINGCENTRAL_SERVER_URL, and RINGCENTRAL_REDIRECT_URI before connecting.",
    });
  }

  try {
    const authorizeUrl = getRingCentralAuthorizeUrl(req, res);
    res.statusCode = 302;
    res.setHeader("Location", authorizeUrl);
    return res.end();
  } catch (error) {
    res.setHeader("Content-Type", "application/json");
    return res.status(500).json({
      authType: "oauth",
      configured: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
