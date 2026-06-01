import { loadSession } from "../auth/_lib/session.js";
import { defaultRoleFor, lookupByEmail } from "./roles.js";

export async function getAppBuilderSession(req) {
  const session = await loadSession(req);
  if (!session) return null;

  const roster = lookupByEmail(String(session.email ?? "").toLowerCase());
  const role =
    (typeof session.role === "string" ? session.role : null) ??
    roster?.role ??
    defaultRoleFor(session.name ?? "");

  return {
    ...session,
    role,
    name: roster?.name ?? session.name ?? null,
    email: session.email ?? null,
  };
}

export async function requireManagerAppBuilder(req, res) {
  const session = await getAppBuilderSession(req);
  if (!session || session.role !== "manager") {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Manager access required." }));
    return null;
  }
  return session;
}
