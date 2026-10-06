/**
 * Role-based access for the NOC dashboard.
 *
 * FOUR ROLES (tiered NOC team structure):
 *   - "tier1"    Entry-level NOC tech. Daily operations.
 *   - "tier2"    Mid-level NOC tech. Same access as Tier 1 for now.
 *   - "tier3"    Senior NOC tech. Same access as Tier 1 for now; reserved
 *                for future per-member elevated access.
 *   - "manager"  Manager / supervisor. Full access incl. WFH approvals
 *                and team-wide admin views.
 *
 * ACCESS MODEL (current):
 *   All tiers + manager see the same widgets. The role still lives in
 *   localStorage so that future per-role gates ("only T3 can ack alerts",
 *   "only Manager sees team-wide breakdowns") can be added without
 *   another data migration.
 *
 * Roles are stored alongside the identity in localStorage (see
 * src/lib/identity.ts). When a known team member picks their name, we
 * default their role from `ROLE_BY_NAME` below. Users can override their
 * role via the header IdentityBadge for demo / testing.
 *
 * This is a UI-level gate — it controls which widgets appear, not real
 * security. To enforce roles server-side, add an `X-User-Role` header to
 * fetches in `src/lib/fetch-resilient.ts` and check it in each
 * `vite-plugins/*` proxy.
 */

export type Role = "tier1" | "tier2" | "tier3" | "manager" | "customer_service_manager";

export const ROLES: Role[] = ["tier1", "tier2", "tier3", "manager", "customer_service_manager"];

export const ROLE_LABELS: Record<Role, string> = {
  tier1: "Tier 1",
  tier2: "Tier 2",
  tier3: "Tier 3",
  manager: "Manager",
  customer_service_manager: "Customer Service Manager",
};

export const ROLE_SHORT_LABELS: Record<Role, string> = {
  tier1: "T1",
  tier2: "T2",
  tier3: "T3",
  manager: "Mgr",
  customer_service_manager: "CSM",
};

export const ROLE_COLORS: Record<Role, string> = {
  tier1: "appdirect",
  tier2: "cyan",
  tier3: "violet",
  manager: "red",
  customer_service_manager: "orange",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  tier1:
    "Entry-level NOC tech. Daily operations: Zoom Queue, breaks, tickets, escalations, handovers.",
  tier2:
    "Mid-level NOC tech. Same operational tools as Tier 1. Reserved for future advanced features.",
  tier3:
    "Senior NOC tech. Same operational tools as Tier 1. Reserved for future senior-only features.",
  manager:
    "Manager / supervisor. Full access — WFH approvals, team breakdowns, all tools.",
  customer_service_manager:
    "Customer Service Manager. Limited access to the NOC MTTR Report only.",
};

/**
 * Pre-assigned roles for every NOC team member. Sourced from the official
 * Agent / Role table. Anyone not listed defaults to "tier1".
 *
 * Today every tier has identical widget access. Per-tier feature gates
 * (e.g. only T3+ can acknowledge LM alerts) can be added without changing
 * this map.
 *
 * Legacy name variants are kept so users with older localStorage records
 * still resolve to the correct tier without re-signing-in.
 */
export const ROLE_BY_NAME: Record<string, Role> = {
  // ---- Customer Service Managers ----
  "Robin Footdale": "customer_service_manager",
  "Kirsten Dichiappari": "customer_service_manager",
  "Corey Stark": "customer_service_manager",
  "Chris Hernandez": "customer_service_manager",
  "Hilary Blake": "customer_service_manager",
  "Kristen Salmon": "customer_service_manager",
  "Rodrigo Garcia": "customer_service_manager",
  "Andrew Freitas": "customer_service_manager",
  "Georgia Bourikas": "customer_service_manager",

  // ---- Managers ----
  "Anirudh Kukudala": "manager",
  "Perry Cox": "manager",
  "Matt Marquez": "manager",

  // ---- Tier 3 ----
  "Otukho Olembo": "tier3",

  // ---- Tier 2 ----
  "Akash Hanvate": "tier2",
  "Karthik Radhakrishnan": "tier2",
  "Mohammed Zubairuddin": "tier2",
  "Abishek Benarji": "tier2",
  "Abhishek Benarji": "tier2",

  // ---- Tier 1 (NOC) ----
  "Pranav Dandibhotla": "tier1",
  "Mohammed Ashraf": "tier1",
  "Ashraf Mohammed": "tier1",
  "Akram Ahmed": "tier1",
  "Mohammed Akram Ahmed": "tier1",
  "Hamza Rahmani": "tier1",
  "Hamza Umme": "tier1",
  "Sriram Parisa": "tier1",
  "Karthik Damagalla": "tier1",
  "Lokesh Banavath": "tier1",
  "Lokesh Naik Banavath": "tier1",
  "Mahalakshmi Samiti": "tier1",
  "Samiti Mahalakshmi": "tier1",
  "Kenya Gentry": "tier1",

  // ---- Legacy name-variant migrations (don't show in roster autocomplete,
  // but resolve correctly if persisted from an older session) ----
  "Zubair Mohammed": "tier2",
};

/**
 * Email → roster name mapping.
 *
 * When someone signs in via Google SSO, their Google profile name may not
 * exactly match the roster name (e.g. "A. Kukudala" vs "Anirudh Kukudala").
 * This map uses the email (which never changes) to reliably resolve the
 * canonical roster name + role.
 *
 * Keys are lowercased emails. If you need to add a new team member, add
 * their email here AND their name in ROLE_BY_NAME above.
 *
 * IMPORTANT: Also update the server-side copy in api/_lib/roles.js
 */
export const ROSTER_BY_EMAIL: Record<string, { name: string; role: Role }> = {
  // ---- Customer Service Managers ----
  "robin.footdale@appdirect.com":        { name: "Robin Footdale",        role: "customer_service_manager" },
  "kirsten.dichiappari@appdirect.com":   { name: "Kirsten Dichiappari",   role: "customer_service_manager" },
  "corey.stark@appdirect.com":           { name: "Corey Stark",           role: "customer_service_manager" },
  "chris.hernandez@appdirect.com":       { name: "Chris Hernandez",       role: "customer_service_manager" },
  "hilary.blake@appdirect.com":          { name: "Hilary Blake",          role: "customer_service_manager" },
  "kristen.salmon@appdirect.com":        { name: "Kristen Salmon",        role: "customer_service_manager" },
  "rodrigo.garcia@appdirect.com":        { name: "Rodrigo Garcia",        role: "customer_service_manager" },
  "andrew.freitas@appdirect.com":        { name: "Andrew Freitas",        role: "customer_service_manager" },
  "georgia.bourikas@appdirect.com":      { name: "Georgia Bourikas",      role: "customer_service_manager" },

  // ---- Managers ----
  "anirudh.kukudala@appdirect.com":      { name: "Anirudh Kukudala",      role: "manager" },
  "perry.cox@appdirect.com":             { name: "Perry Cox",             role: "manager" },
  "matt.marquez@appdirect.com":          { name: "Matt Marquez",          role: "manager" },

  // ---- Tier 3 ----
  "otukho.olembo@appdirect.com":         { name: "Otukho Olembo",         role: "tier3" },

  // ---- Tier 2 ----
  "akash.hanvate@appdirect.com":         { name: "Akash Hanvate",         role: "tier2" },
  "karthik.radhakrishnan@appdirect.com": { name: "Karthik Radhakrishnan", role: "tier2" },
  "zubair.mohd@appdirect.com":           { name: "Mohammed Zubairuddin",  role: "tier2" },
  "abishek.benarji@appdirect.com":       { name: "Abishek Benarji",       role: "tier2" },

  // ---- Tier 1 ----
  "ashraf.mohammed@appdirect.com":       { name: "Mohammed Ashraf",       role: "tier1" },
  "hamza.umme@appdirect.com":            { name: "Hamza Rahmani",         role: "tier1" },
  "karthik.damagalla@appdirect.com":     { name: "Karthik Damagalla",     role: "tier1" },
  "lokesh.banavath@appdirect.com":       { name: "Lokesh Banavath",       role: "tier1" },
  "pranav.dandibhotla@appdirect.com":    { name: "Pranav Dandibhotla",    role: "tier1" },
  "sriram.parisa@appdirect.com":         { name: "Sriram Parisa",         role: "tier1" },
  "akram.mohammed@appdirect.com":        { name: "Akram Ahmed",           role: "tier1" },
  "samiti.mahalakshmi@appdirect.com":    { name: "Mahalakshmi Samiti",    role: "tier1" },
  "kenya.gentry@appdirect.com":          { name: "Kenya Gentry",          role: "tier1" },
};

export const DEFAULT_ROLE: Role = "tier1";

/**
 * Compute the default role for a team member by name. Returns "tier1" for
 * any name not pre-assigned in `ROLE_BY_NAME`.
 */
export function defaultRoleFor(name: string): Role {
  return ROLE_BY_NAME[name.trim()] ?? DEFAULT_ROLE;
}

/**
 * Migration map: older versions of the dashboard stored these legacy role
 * values in localStorage. We translate them to the current tier system
 * transparently on read so existing users don't have to re-sign-in.
 *
 *   "technician" → "tier1"  (entry/mid-level baseline)
 *   "lead"       → "tier3"  (senior coordinator)
 *   "manager"    → unchanged
 */
export const MIGRATE_OLD_ROLE: Record<string, Role> = {
  technician: "tier1",
  lead: "tier3",
  manager: "manager",
  customer_service_manager: "customer_service_manager",
  tier1: "tier1",
  tier2: "tier2",
  tier3: "tier3",
};

/**
 * Check whether the current user role has access to a widget. If a widget
 * declares no `roles` requirement, all roles can access it.
 */
export function effectiveRoleForIdentity(identity: {
  role?: Role | null;
  name?: string | null;
  email?: string | null;
} | null | undefined): Role | null {
  if (!identity) return null;
  if (identity.role && ROLES.includes(identity.role)) {
    return identity.role;
  }

  const canonicalByName = identity.name ? ROLE_BY_NAME[identity.name.trim()] : undefined;
  if (canonicalByName) return canonicalByName;

  const canonicalByEmail = identity.email
    ? ROSTER_BY_EMAIL[identity.email.trim().toLowerCase()]?.role
    : undefined;
  if (canonicalByEmail) return canonicalByEmail;

  return identity.role ?? null;
}

export function canAccess(
  userRole: Role | null | undefined,
  requiredRoles?: Role[],
): boolean {
  if (!requiredRoles || requiredRoles.length === 0) return true; // everyone
  if (!userRole) return false;
  return requiredRoles.includes(userRole);
}
