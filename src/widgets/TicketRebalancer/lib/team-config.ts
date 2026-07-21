// Team roster, tier mapping, and manager exclusion list.
// Names must match the iPath `owner` field and the roster sheet's column-A
// agent names (case-insensitive, whitespace-tolerant — see normalizeName).

export type Tier = "Tier 1" | "Tier 2" | "Tier 3";

export interface TeamMember {
  name: string;
  tier: Tier;
}

export const TEAM: TeamMember[] = [
  // Tier 1
  { name: "Pranav Dandibhotla", tier: "Tier 1" },
  { name: "Mohammed Ashraf", tier: "Tier 1" },
  { name: "Akram Ahmed", tier: "Tier 1" },
  { name: "Kenya Gentry", tier: "Tier 1" },
  { name: "Hamza Rahmani", tier: "Tier 1" },
  { name: "Akash Hanvate", tier: "Tier 1" },
  { name: "Sriram Parisa", tier: "Tier 1" },
  { name: "Karthik Damagalla", tier: "Tier 1" },
  { name: "Lokesh Naik Banavath", tier: "Tier 1" },
  { name: "Mahalakshmi Samiti", tier: "Tier 1" },
  { name: "Tech Support", tier: "Tier 1" },
  // Tier 2
  { name: "Mohammed Zubairuddin", tier: "Tier 2" },
  { name: "Karthik Radhakrishnan", tier: "Tier 2" },
  { name: "Abhishek Benarji", tier: "Tier 2" },
  // Tier 3
  { name: "Otukho Olembo", tier: "Tier 3" },
];

// Managers are NEVER counted in load math or eligible for rebalance moves.
export const MANAGERS: string[] = [
  "Anirudh Kukudala",
  "Perry Cox",
  "Matt Marquez",
];

// Known misspellings or short forms in iPath / the roster sheet, mapped to
// their canonical TEAM (or MANAGERS) name. Keys are pre-normalized
// (lowercase, single-spaced); values are the canonical display name.
// Add more entries here as new variants surface.
const NAME_ALIASES: Record<string, string> = {
  "kartik damagalla": "Karthik Damagalla",
};

function baseNormalize(s: string | undefined | null): string {
  return (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeName(s: string | undefined | null): string {
  const base = baseNormalize(s);
  const aliased = NAME_ALIASES[base];
  return aliased ? baseNormalize(aliased) : base;
}

const TEAM_BY_NORM = new Map(TEAM.map((m) => [normalizeName(m.name), m]));
const MANAGER_NORM = new Set(MANAGERS.map(normalizeName));

export function findTeamMember(name: string): TeamMember | undefined {
  return TEAM_BY_NORM.get(normalizeName(name));
}

export function isManager(name: string): boolean {
  return MANAGER_NORM.has(normalizeName(name));
}
