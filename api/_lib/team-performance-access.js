import { getSession } from "./auth-middleware.js";
import { getAppBuilderSession } from "./appbuilder-auth.js";
import { lookupByEmail } from "./roles.js";

const TEAM_PERFORMANCE_ROLES = new Set(["manager", "tier1", "tier2", "tier3"]);

/** Resolve a Team Performance viewer from a verified session and roster email. */
export async function getTeamPerformanceViewer(req) {
  const appSession = await getAppBuilderSession(req);
  const legacySession = appSession ? null : getSession(req);
  const email = appSession?.email ?? legacySession?.email;
  const rosterMember = email ? lookupByEmail(String(email).toLowerCase()) : null;

  if (
    (!appSession && !legacySession) ||
    !rosterMember ||
    !TEAM_PERFORMANCE_ROLES.has(rosterMember.role)
  ) return null;
  return {
    name: rosterMember.name,
    role: rosterMember.role,
    email: String(email).toLowerCase(),
  };
}
