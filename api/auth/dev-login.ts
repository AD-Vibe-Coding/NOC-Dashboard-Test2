import type { VercelRequest, VercelResponse } from "@vercel/node";
import { signJwt } from "../_lib/jwt.js";
import { defaultRoleFor, ROSTER_BY_EMAIL } from "../_lib/roles.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

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

  let role = defaultRoleFor(name);

  // Find the canonical email for this person from the roster, or generate one
  let email = `${name.toLowerCase().replace(/\s+/g, ".")}@appdirect.com`;
  for (const [e, entry] of Object.entries(ROSTER_BY_EMAIL)) {
    if (entry.name === name) {
      email = e;
      break;
    }
  }

  // Check for a DB role override set by a manager
  try {
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("name", name)
      .limit(1)
      .maybeSingle();
    if (data?.role) role = data.role;
  } catch { /* non-fatal */ }

  const token = signJwt({ email, name, role, picture: null }, 86400);

  // Record sign-in for Access Control widget (best-effort)
  try {
    await supabaseAdmin.from("user_sessions").delete().eq("name", name);
    await supabaseAdmin.from("user_sessions").insert({
      name,
      email,
      sign_in_method: "dev",
      last_sign_in: new Date().toISOString(),
    });
  } catch { /* non-fatal */ }

  res.setHeader(
    "Set-Cookie",
    `noc_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
  );
  return res.status(200).json({ name, role, email });
}
