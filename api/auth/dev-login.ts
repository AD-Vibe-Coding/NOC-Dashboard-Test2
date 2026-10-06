import type { VercelRequest, VercelResponse } from "@vercel/node";
import { signJwt } from "../_lib/jwt.js";
import { lookupByEmail } from "../_lib/roles.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

/**
 * POST /api/auth/dev-login — development login locked to the approved roster.
 * Only works when GOOGLE_CLIENT_ID is NOT set. In production this
 * endpoint returns 403.
 *
 * Body: { email: "name@appdirect.com" }
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

  const email = String((req.body as Record<string, unknown>)?.email ?? "").trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const rosterEntry = lookupByEmail(email);
  if (!rosterEntry) {
    return res.status(403).json({
      error: "Access denied. Your email is not on the approved access list.",
    });
  }

  const token = signJwt({
    email,
    name: rosterEntry.name,
    role: rosterEntry.role,
    picture: null,
  }, 86400);

  try {
    await supabaseAdmin.from("user_sessions").delete().eq("email", email);
    await supabaseAdmin.from("user_sessions").insert({
      name: rosterEntry.name,
      email,
      sign_in_method: "dev",
      last_sign_in: new Date().toISOString(),
    });
  } catch {
    /* non-fatal */
  }

  res.setHeader(
    "Set-Cookie",
    `noc_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
  );
  return res.status(200).json({
    name: rosterEntry.name,
    role: rosterEntry.role,
    roleLabel: rosterEntry.roleLabel,
    team: rosterEntry.team,
    accessLevel: rosterEntry.accessLevel,
    email,
  });
}
