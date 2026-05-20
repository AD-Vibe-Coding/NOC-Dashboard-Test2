import type { VercelRequest, VercelResponse } from "@vercel/node";
import { signJwt } from "../_lib/jwt.js";
import { defaultRoleFor } from "../_lib/roles.js";

/**
 * POST /api/auth/dev-login — Development-only name picker sign-in.
 * Only works when GOOGLE_CLIENT_ID is NOT set. In production this
 * endpoint returns 403.
 *
 * Body: { name: "Anirudh Kukudala" }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.GOOGLE_CLIENT_ID) {
    return res
      .status(403)
      .json({ error: "Dev login disabled — use Google SSO." });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const name = String((req.body as Record<string, unknown>)?.name ?? "").trim();
  if (!name) {
    return res.status(400).json({ error: "Name is required" });
  }

  const role = defaultRoleFor(name);
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}@appdirect.com`;

  const token = signJwt({ email, name, role, picture: null }, 86400);

  res.setHeader(
    "Set-Cookie",
    `noc_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
  );
  return res.status(200).json({ name, role, email });
}
