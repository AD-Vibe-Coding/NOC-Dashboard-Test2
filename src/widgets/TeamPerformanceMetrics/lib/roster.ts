/** Snapshot roster for the NOC dashboard. */
export type RosterPerson = {
  name: string;
  email: string;
  team: string;
  tier: "tier-1" | "tier-2" | "tier-3";
  role: "staff" | "manager";
};

export const TEAMS = [{ slug: "noc", name: "NOC" }] as const;

export const TIERS = [
  { slug: "tier-1", name: "Tier 1" },
  { slug: "tier-2", name: "Tier 2" },
  { slug: "tier-3", name: "Tier 3" },
] as const;

export const ROSTER: RosterPerson[] = [
  { name: "Jordan Hale", email: "jordan.hale@example.com", team: "noc", tier: "tier-1", role: "manager" },
  { name: "Priya Shah", email: "priya.shah@example.com", team: "noc", tier: "tier-1", role: "staff" },
  { name: "Marcus Chen", email: "marcus.chen@example.com", team: "noc", tier: "tier-2", role: "staff" },
  { name: "Elena Rossi", email: "elena.rossi@example.com", team: "noc", tier: "tier-2", role: "manager" },
  { name: "Sam Okonkwo", email: "sam.okonkwo@example.com", team: "noc", tier: "tier-2", role: "staff" },
  { name: "Avery Kim", email: "avery.kim@example.com", team: "noc", tier: "tier-3", role: "staff" },
  { name: "Chris Patel", email: "chris.patel@example.com", team: "noc", tier: "tier-3", role: "manager" },
];

export function tierName(slug: string) {
  return TIERS.find((t) => t.slug === slug)?.name ?? slug;
}
