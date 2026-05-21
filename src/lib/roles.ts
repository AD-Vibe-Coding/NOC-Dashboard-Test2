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

export type Role = "tier1" | "tier2" | "tier3" | "manager";

export const ROLES: Role[] = ["tier1", "tier2", "tier3", "manager"];

export const ROLE_LABELS: Record<Role, string> = {
  tier1: "Tier 1",
  tier2: "Tier 2",
  tier3: "Tier 3",
  manager: "Manager",
};

export const ROLE_SHORT_LABELS: Record<Role, string> = {
  tier1: "T1",
  tier2: "T2",
  tier3: "T3",
  manager: "Mgr",
};

export const ROLE_COLORS: Record<Role, string> = {
  tier1: "appdirect",
  tier2: "cyan",
  tier3: "violet",
  manager: "red",
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
  // ---- Managers ----
  "Anirudh Kukudala": "manager",
  "Perry Cox": "manager",
  "Matt Marquez": "manager",

  // ---- Tier 3 ----
  "Otukho Olembo": "tier3",

  // ---- Tier 2 ----
  "Mohammed Zubairuddin": "tier2",
  "Karthik Radhakrishnan": "tier2",
  "Abhishek Benarji": "tier2",

  // ---- Tier 1 (NOC) ----
  "Pranav Dandibhotla": "tier1",
  "Mohammed Ashraf": "tier1",
  "Akram Ahmed": "tier1",
  "Kenya Gentry": "tier1",
  "Hamza Rahmani": "tier1",
  "Sriram Parisa": "tier1",
  "Karthik Damagalla": "tier1",
  "Lokesh Naik Banavath": "tier1",
  "Mahalakshmi Samiti": "tier1",

  // ---- Tier 1 (Mobility) ----
  "Akash Hanvate": "tier1",

  // ---- Legacy name-variant migrations (don't show in roster autocomplete,
  // but resolve correctly if persisted from an older session) ----
  "Mohammed Akram Ahmed": "tier1",
  "Ashraf Mohammed": "tier1",
  "Zubair Mohammed": "tier2",
  "Samiti Mahalakshmi": "tier1",
  "Abishek Benarji": "tier2",
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
  // ---- Managers ----
  "anirudh.kukudala@appdirect.com": { name: "Anirudh Kukudala", role: "manager" },
  "perry.cox@appdirect.com":        { name: "Perry Cox",        role: "manager" },
  "matt.marquez@appdirect.com":     { name: "Matt Marquez",     role: "manager" },

  // ---- Tier 3 ----
  "otukho.olembo@appdirect.com":    { name: "Otukho Olembo",    role: "tier3" },

  // ---- Tier 2 ----
  "zubair.mohd@appdirect.com":             { name: "Mohammed Zubairuddin", role: "tier2" },
  "karthik.radhakrishnan@appdirect.com":   { name: "Karthik Radhakrishnan", role: "tier2" },
  "abishek.benarji@appdirect.com":         { name: "Abhishek Benarji",     role: "tier2" },

  // ---- Tier 1 (NOC) ----
  "pranav.dandibhotla@appdirect.com":  { name: "Pranav Dandibhotla",  role: "tier1" },
  "ashraf.mohammed@appdirect.com":     { name: "Mohammed Ashraf",     role: "tier1" },
  "akram.mohammed@appdirect.com":      { name: "Akram Ahmed",         role: "tier1" },
  "kenya.gentry@appdirect.com":        { name: "Kenya Gentry",        role: "tier1" },
  "hamza.umme@appdirect.com":          { name: "Hamza Rahmani",       role: "tier1" },
  "sriram.parisa@appdirect.com":       { name: "Sriram Parisa",       role: "tier1" },
  "karthik.damagalla@appdirect.com":   { name: "Karthik Damagalla",   role: "tier1" },
  "lokesh.banavath@appdirect.com":     { name: "Lokesh Naik Banavath", role: "tier1" },
  "samiti.mahalakshmi@appdirect.com":  { name: "Mahalakshmi Samiti",  role: "tier1" },

  // ---- Tier 1 (Mobility) ----
  "akash.hanvate@appdirect.com":       { name: "Akash Hanvate",       role: "tier1" },
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
  tier1: "tier1",
  tier2: "tier2",
  tier3: "tier3",
};

/**
 * Check whether the current user role has access to a widget. If a widget
 * declares no `roles` requirement, all roles can access it.
 */
export function canAccess(
  userRole: Role | null | undefined,
  requiredRoles?: Role[],
): boolean {
  if (!requiredRoles || requiredRoles.length === 0) return true; // everyone
  if (!userRole) return false;
  return requiredRoles.includes(userRole);
}
