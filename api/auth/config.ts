import type { VercelRequest, VercelResponse } from "@vercel/node";

/** Returns auth configuration the frontend needs to decide which sign-in UI to show. */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const googleSso = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS || "appdirect.com")
    .split(",")
    .map((d: string) => d.trim().toLowerCase())
    .filter(Boolean);

  const deploymentHost = process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.VERCEL_BRANCH_URL
    || process.env.VERCEL_URL
    || null;
  const deploymentUrl = deploymentHost
    ? `https://${deploymentHost.replace(/^https?:\/\//, "")}`
    : null;

  return res.status(200).json({
    google_sso: googleSso,
    allowed_domains: allowedDomains,
    deployment_url: deploymentUrl,
  });
}
