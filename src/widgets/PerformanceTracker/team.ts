/**
 * Locked 16-member NOC team roster for the Performance Tracker widget.
 *
 * Members include 14 individual contributors PLUS the two managers
 * (Anirudh Kukudala, Perry Cox) — both managers are now performance-tracked
 * too because they also take tickets / calls.
 *
 * Why this is separate from `src/lib/roster.ts`:
 *   - Roster.ts is the full identity list used for sign-in, identity badges,
 *     and widgets like Break Tracker, Shift Handover, etc.
 *   - LOCKED_TEAM (this file) is the **performance-tracked** subset. The
 *     startup migration in `src/db/index.ts` enforces it by deleting
 *     non-roster names from imports.
 *
 * Tier semantics here are slightly different from `src/lib/roles.ts`:
 *   - "tier1" / "tier2" / "tier3" = individual contributor tier
 *   - "manager"                   = Anirudh / Perry — shown in red
 */

export type Tier = "tier1" | "tier2" | "tier3" | "manager";
export type TeamSection = "noc" | "mobility";

export interface TeamMember {
  name: string;
  tier: Tier;
  team: TeamSection;
}

export const LOCKED_TEAM: TeamMember[] = [
  // ---- Managers ----
  { name: "Anirudh Kukudala", tier: "manager", team: "noc" },
  { name: "Perry Cox", tier: "manager", team: "noc" },
  { name: "Matt Marquez", tier: "manager", team: "noc" },
  // ---- Tier 3 ----
  { name: "Otukho Olembo", tier: "tier3", team: "noc" },
  // ---- Tier 2 ----
  { name: "Mohammed Zubairuddin", tier: "tier2", team: "noc" },
  { name: "Karthik Radhakrishnan", tier: "tier2", team: "noc" },
  { name: "Abhishek Benarji", tier: "tier2", team: "noc" },
  // ---- Tier 1 (NOC) ----
  { name: "Pranav Dandibhotla", tier: "tier1", team: "noc" },
  { name: "Mohammed Ashraf", tier: "tier1", team: "noc" },
  { name: "Akram Ahmed", tier: "tier1", team: "noc" },
  { name: "Kenya Gentry", tier: "tier1", team: "noc" },
  { name: "Hamza Rahmani", tier: "tier1", team: "noc" },
  { name: "Sriram Parisa", tier: "tier1", team: "noc" },
  { name: "Karthik Damagalla", tier: "tier1", team: "noc" },
  { name: "Lokesh Naik Banavath", tier: "tier1", team: "noc" },
  { name: "Mahalakshmi Samiti", tier: "tier1", team: "noc" },
  // ---- Tier 1 (Mobility) ----
  { name: "Akash Hanvate", tier: "tier1", team: "mobility" },
  // ---- Group entries ----
  { name: "Team", tier: "tier1", team: "noc" },
  { name: "NOC Seniors", tier: "tier1", team: "noc" },
  // ---- Automation entries ----
  { name: "Automation", tier: "tier1", team: "noc" },
  { name: "Automation - Failed", tier: "tier1", team: "noc" },
];

export const LOCKED_TEAM_NAMES: string[] = LOCKED_TEAM.map((m) => m.name);

/**
 * Names that are "virtual" entries (groups, automation bots, etc.) — not real
 * individual people. These should only appear in the Performance Tracker
 * widget (where tickets may be logged under these names) and must be excluded
 * from every other widget that builds dropdowns / people-pickers / rosters.
 */
export const NON_PERSON_NAMES = new Set<string>([
  "Team",
  "NOC Seniors",
  "Automation",
  "Automation - Failed",
]);

/**
 * Subset of LOCKED_TEAM_NAMES that contains only real individuals.
 * Use this in any widget that shows a people-picker / roster / assignee list
 * (BreakTracker, ZoomQueue break schedule, MeetingNotes, KudosBoard,
 * ShiftChecklist, etc.) to avoid showing virtual/group entries.
 */
export const PERSON_TEAM_NAMES: string[] = LOCKED_TEAM_NAMES.filter(
  (n) => !NON_PERSON_NAMES.has(n),
);

// =============================================================================
// Canonical name normalization
//
// The Excel imports could contain any of:
//   "Akram Ahmed", "akram ahmed ", "AKRAM AHMED", "Mohammed Akram Ahmed",
//   "Kartik Damagalla" (no 'h'), "Anirudh", "Perry", etc.
//
// We canonicalize all of those to their official roster name. Strategy:
//   1. ckey(s): lowercase, collapse whitespace, trim, strip zero-width chars
//   2. Look up ckey in a hand-curated VARIANT_MAP (built from ALIASES + the
//      canonical names themselves)
//   3. Last-resort: substring match against canonical names; only return a
//      match if EXACTLY ONE roster member matches (avoids ambiguity from
//      e.g. "Mohammed" alone)
// =============================================================================

/** Canonical key: lowercase, single-spaced, trimmed, zero-widths removed,
 *  Unicode dashes normalized to ASCII hyphen, non-breaking spaces to space. */
function ckey(s: string): string {
  return (s ?? "")
    .toString()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")   // zero-width chars
    .replace(/[\u2013\u2014\u2212]/g, "-")   // en/em/minus → ASCII hyphen
    .replace(/[\u00A0\u202F]/g, " ")         // non-breaking spaces → space
    .replace(/\([^)]*\)/g, " ")              // remove parenthetical suffixes
    .replace(/<[^>]+>/g, " ")                  // remove angle-bracket emails
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Strip a leading initials prefix from a Zoom Phone-style name.
 *
 * Zoom Phone often exports agent names with their initials prepended:
 *   "AB - Abhishek Benarji"   → "Abhishek Benarji"
 *   "KD | Karthik Damagalla"  → "Karthik Damagalla"
 *   "AA: Akram Ahmed"         → "Akram Ahmed"
 *   "MZ Mohammed Zubairuddin" → "Mohammed Zubairuddin"
 *
 * We strip 1–4 leading uppercase initials (already lowercased in ckey) when
 * followed by a separator (dash, pipe, colon) or whitespace. The function is
 * conservative: it requires AT LEAST two more words after the prefix so that
 * a real two-word name like "AJ Smith" doesn't get its first name stripped.
 *
 * Returns the stripped form, OR null if no prefix pattern matched.
 */
function stripInitialsPrefix(key: string): string | null {
  // Match: 1-4 letters, optional separator (- | :), required whitespace, rest
  const m = /^([a-z]{1,4})\s*(?:[-|:]\s*)?\s+(.+)$/.exec(key);
  if (!m) return null;
  const rest = m[2].trim();
  // Require the remainder to be a multi-word name so we don't strip the
  // first name from a legitimate two-word name like "Aj Smith".
  if (!/\s/.test(rest)) return null;
  // Reject if the "initials" themselves look like a real first name
  // (4 letters could be "Akash", "Hamza", etc.). Easiest check: only
  // strip when the prefix has an explicit separator OR is ≤ 3 chars.
  const hadSeparator = /^[a-z]{1,4}\s*[-|:]/.test(key);
  const shortPrefix = m[1].length <= 3;
  if (!hadSeparator && !shortPrefix) return null;
  return rest;
}

/**
 * Explicit alias overrides. Each entry maps a raw-name variant
 * (canonicalized) → the official canonical roster name.
 *
 * Add an entry here when you see a name in an Excel import that doesn't
 * resolve correctly. The substring-match fallback handles many common cases
 * automatically, but explicit aliases are needed when a name is ambiguous
 * (e.g. "Mohammed" alone) or unusual (e.g. an old Slack handle, a misspelling
 * that loses a letter so substring match can't catch it).
 */
const ALIASES: Array<[string, string]> = [
  // ---- Managers ----
  // Anirudh Kukudala
  ["anirudh", "Anirudh Kukudala"],
  ["kukudala", "Anirudh Kukudala"],
  ["anirudh kukudala", "Anirudh Kukudala"],
  // Perry Cox
  ["perry", "Perry Cox"],
  ["cox", "Perry Cox"],
  ["perry cox", "Perry Cox"],

  // Matt Marquez
  ["matt", "Matt Marquez"],
  ["matt marquez", "Matt Marquez"],
  ["marquez", "Matt Marquez"],
  ["m marqu", "Matt Marquez"],

  // Zubairuddin — sometimes appears as "Zubair Mohammed" (old Slack handle)
  ["zubairuddin", "Mohammed Zubairuddin"],
  ["zubair", "Mohammed Zubairuddin"],
  ["zubair mohammed", "Mohammed Zubairuddin"],
  ["mohammed zubair", "Mohammed Zubairuddin"],
  ["mohammed zubairuddin", "Mohammed Zubairuddin"],

  // Akram Ahmed — also seen as "Mohammed Akram Ahmed" (full legal name)
  ["akram", "Akram Ahmed"],
  ["akram ahmed", "Akram Ahmed"],
  ["mohammed akram", "Akram Ahmed"],
  ["mohammed akram ahmed", "Akram Ahmed"],

  // Mohammed Ashraf — sometimes "Ashraf Mohammed"
  ["ashraf", "Mohammed Ashraf"],
  ["mohammed ashraf", "Mohammed Ashraf"],
  ["ashraf mohammed", "Mohammed Ashraf"],

  // Mahalakshmi Samiti — historically "Samiti Mahalakshmi", "Maha", or "Samiti"
  ["maha", "Mahalakshmi Samiti"],
  ["mahalakshmi", "Mahalakshmi Samiti"],
  ["samiti", "Mahalakshmi Samiti"],
  ["maha samiti", "Mahalakshmi Samiti"],
  ["mahalakshmi samiti", "Mahalakshmi Samiti"],
  ["samiti mahalakshmi", "Mahalakshmi Samiti"],

  // Abhishek Benarji — common misspelling "Abishek"
  ["abhishek", "Abhishek Benarji"],
  ["abishek", "Abhishek Benarji"],
  ["benarji", "Abhishek Benarji"],
  ["abhishek benarji", "Abhishek Benarji"],
  ["abishek benarji", "Abhishek Benarji"],

  // ---- Karthiks ----
  // There are TWO Karthiks on the team — "Karthik" / "Kartik" alone is
  // ambiguous and won't auto-resolve. We accept the missing-h spelling
  // "Kartik Damagalla" / "Kartik Radhakrishnan" as exact aliases per
  // observed Excel exports.
  ["karthik damagalla", "Karthik Damagalla"],
  ["kartik damagalla", "Karthik Damagalla"],   // missing 'h' spelling
  ["karthik damagala", "Karthik Damagalla"],   // missing 'l' typo
  ["kartik damagala", "Karthik Damagalla"],    // both typos combined
  ["damagalla", "Karthik Damagalla"],
  ["damagala", "Karthik Damagalla"],
  ["karthik d", "Karthik Damagalla"],
  ["kartik d", "Karthik Damagalla"],

  ["karthik radhakrishnan", "Karthik Radhakrishnan"],
  ["kartik radhakrishnan", "Karthik Radhakrishnan"], // missing 'h' spelling
  ["radhakrishnan", "Karthik Radhakrishnan"],
  ["karthik r", "Karthik Radhakrishnan"],
  ["kartik r", "Karthik Radhakrishnan"],

  // Otukho Olembo
  ["otukho", "Otukho Olembo"],
  ["olembo", "Otukho Olembo"],
  ["otukho olembo", "Otukho Olembo"],

  // Sriram Parisa
  ["sriram", "Sriram Parisa"],
  ["parisa", "Sriram Parisa"],
  ["sriram parisa", "Sriram Parisa"],

  // Akash Hanvate (Mobility)
  ["akash", "Akash Hanvate"],
  ["hanvate", "Akash Hanvate"],
  ["akash hanvate", "Akash Hanvate"],

  // Pranav Dandibhotla
  ["pranav", "Pranav Dandibhotla"],
  ["dandibhotla", "Pranav Dandibhotla"],
  ["pranav dandibhotla", "Pranav Dandibhotla"],

  // Kenya Gentry
  ["kenya", "Kenya Gentry"],
  ["gentry", "Kenya Gentry"],
  ["kenya gentry", "Kenya Gentry"],

  // Hamza Rahmani
  ["hamza", "Hamza Rahmani"],
  ["rahmani", "Hamza Rahmani"],
  ["hamza rahmani", "Hamza Rahmani"],

  // Lokesh Naik Banavath
  ["lokesh", "Lokesh Naik Banavath"],
  ["lokesh naik", "Lokesh Naik Banavath"],
  ["banavath", "Lokesh Naik Banavath"],
  ["lokesh naik banavath", "Lokesh Naik Banavath"],

  // ---- Automation entries ----
  ["automation", "Automation"],
  ["automation - failed", "Automation - Failed"],
  ["automation failed", "Automation - Failed"],
  ["automation-failed", "Automation - Failed"],
];

const VARIANT_MAP = new Map<string, string>();
for (const [alias, canonical] of ALIASES) {
  VARIANT_MAP.set(ckey(alias), canonical);
}
// Also store each canonical name as-is (so ckey("Akram Ahmed") → "Akram Ahmed")
for (const m of LOCKED_TEAM) {
  VARIANT_MAP.set(ckey(m.name), m.name);
}

// Auto-register unique first-name / last-name shortcuts for names that are
// unambiguous across the locked roster. This helps with exports that use
// only a first name (e.g. "Kenya") or only a surname (e.g. "Marquez").
const firstNameCounts = new Map<string, number>();
const lastNameCounts = new Map<string, number>();
for (const m of LOCKED_TEAM) {
  const parts = ckey(m.name).split(" ").filter(Boolean);
  if (parts.length === 0) continue;
  const first = parts[0];
  const last = parts[parts.length - 1];
  firstNameCounts.set(first, (firstNameCounts.get(first) ?? 0) + 1);
  lastNameCounts.set(last, (lastNameCounts.get(last) ?? 0) + 1);
}
for (const m of LOCKED_TEAM) {
  const parts = ckey(m.name).split(" ").filter(Boolean);
  if (parts.length === 0) continue;
  const first = parts[0];
  const last = parts[parts.length - 1];
  if ((firstNameCounts.get(first) ?? 0) === 1) VARIANT_MAP.set(first, m.name);
  if ((lastNameCounts.get(last) ?? 0) === 1) VARIANT_MAP.set(last, m.name);
}

/**
 * Resolve a raw name (from Excel, Slack, etc.) to its canonical roster name.
 * Returns null if the name doesn't unambiguously map to anyone on the
 * locked roster.
 *
 * Order of resolution:
 *   1. Exact canonical-key match in VARIANT_MAP (handles ~95% of cases)
 *   2. Substring match against canonical names (unique-match only)
 *   3. Strip Zoom Phone-style initials prefix ("AB - X", "KD | Y") and retry
 *      steps 1 + 2 on the stripped form
 *   4. null (rejected)
 */
export function isExcludedAuditActor(rawName: string | null | undefined): boolean {
  const key = ckey(rawName ?? "");
  if (!key) return false;
  return key === "ebonding" || key === "tech support" || key === "techsupport";
}

export function resolveTeamMember(rawName: string | null | undefined): string | null {
  if (isExcludedAuditActor(rawName)) return null;
  if (!rawName) return null;
  const key = ckey(rawName);
  if (!key) return null;

  // Step 1 + 2: try the full key first
  const direct = tryResolveKey(key);
  if (direct) return direct;

  // Step 3: strip "AB - " / "KD | " / "MZ: " style prefixes and retry
  const stripped = stripInitialsPrefix(key);
  if (stripped && stripped !== key) {
    const retry = tryResolveKey(stripped);
    if (retry) return retry;
  }

  // Step 4: handle "Last, First" / "Last, First Middle" exports.
  if (key.includes(",")) {
    const commaParts = key.split(",").map((p) => p.trim()).filter(Boolean);
    if (commaParts.length >= 2) {
      const reordered = [...commaParts.slice(1), commaParts[0]].join(" ");
      const retry = tryResolveKey(reordered);
      if (retry) return retry;
    }
  }

  // Step 5: if the export put an email address in the name field, try the
  // local part and common separators: first.last, first_last, flast, etc.
  const emailMatch = /([a-z0-9._%+-]+)@[a-z0-9.-]+\.[a-z]{2,}/i.exec(String(rawName));
  if (emailMatch) {
    const local = ckey(emailMatch[1].replace(/[._+-]+/g, " "));
    const retry = tryResolveKey(local);
    if (retry) return retry;
  }

  return null;
}

/** Inner helper: exact-key lookup + unique-substring match against a single
 *  canonicalized key. Returns null on no/ambiguous match. */
function tryResolveKey(key: string): string | null {
  // Direct alias map
  const direct = VARIANT_MAP.get(key);
  if (direct) return direct;

  // Unique substring match (forward and reverse)
  const matches: string[] = [];
  for (const m of LOCKED_TEAM) {
    const canon = ckey(m.name);
    if (key.includes(canon) || canon.includes(key)) {
      if (!matches.includes(m.name)) matches.push(m.name);
    }
  }
  if (matches.length === 1) return matches[0];

  return null;
}

/**
 * Get the tier for a canonical team-member name. Returns null for unknown
 * names. Used by the UI to label each row.
 */
export function tierFor(canonicalName: string): Tier | null {
  const m = LOCKED_TEAM.find((x) => x.name === canonicalName);
  return m?.tier ?? null;
}

/** Section ("noc" or "mobility") for a canonical name. */
export function teamFor(canonicalName: string): TeamSection | null {
  const m = LOCKED_TEAM.find((x) => x.name === canonicalName);
  return m?.team ?? null;
}

export const TIER_LABELS: Record<Tier, string> = {
  tier1: "Tier 1",
  tier2: "Tier 2",
  tier3: "Tier 3",
  manager: "Manager",
};

export const TIER_SHORT_LABELS: Record<Tier, string> = {
  tier1: "T1",
  tier2: "T2",
  tier3: "T3",
  manager: "Mgr",
};

export const TIER_COLORS: Record<Tier, string> = {
  tier1: "blue",
  tier2: "cyan",
  tier3: "violet",
  manager: "red",
};

export const SECTION_LABELS: Record<TeamSection, string> = {
  noc: "NOC",
  mobility: "Mobility",
};
