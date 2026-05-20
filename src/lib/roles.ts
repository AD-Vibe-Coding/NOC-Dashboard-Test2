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
  // Mobility queue, same access as NOC Tier 1 for now. When Mobility gets
  // distinct features in the future, introduce a new role or feature flag.
  "Akash Hanvate": "tier1",

  // ---- Legacy name-variant migrations (don't show in roster autocomplete,
  // but resolve correctly if persisted from an older session) ----
  "Mohammed Akram Ahmed": "tier1",
  "Ashraf Mohammed": "tier1",
  "Zubair Mohammed": "tier2",
  "Samiti Mahalakshmi": "tier1",
  "Abishek Benarji": "tier2",
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
