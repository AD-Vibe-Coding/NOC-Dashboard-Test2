import { supabaseAdmin } from "./supabase-admin.js";
import { lookupByEmail } from "./roles.js";

export async function getAuthorizedIdentity(session) {
  if (!session?.email) {
    return { session: session ?? null, member: null, role: "anonymous", name: "" };
  }

  const email = String(session.email).toLowerCase().trim();
  const member = lookupByEmail(email);
  if (!member) {
    return { session, member: null, role: "anonymous", name: "" };
  }

  let role = member.role;
  try {
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("email", email)
      .limit(1)
      .maybeSingle();
    if (data?.role) role = data.role;
  } catch {
    // non-fatal; fall back to roster role
  }

  return {
    session,
    member,
    role,
    name: member.name,
  };
}
