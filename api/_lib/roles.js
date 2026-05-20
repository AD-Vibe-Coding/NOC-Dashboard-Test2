// Server-side duplicate of the role-by-name mapping from src/lib/roles.ts.
// Kept here so api/ routes don't need to import from src/.

export const ROLE_BY_NAME = {
  "Anirudh Kukudala": "manager",
  "Perry Cox": "manager",
  "Otukho Olembo": "tier3",
  "Mohammed Zubairuddin": "tier2",
  "Karthik Radhakrishnan": "tier2",
  "Abhishek Benarji": "tier2",
  "Pranav Dandibhotla": "tier1",
  "Mohammed Ashraf": "tier1",
  "Akram Ahmed": "tier1",
  "Kenya Gentry": "tier1",
  "Hamza Rahmani": "tier1",
  "Sriram Parisa": "tier1",
  "Karthik Damagalla": "tier1",
  "Lokesh Naik Banavath": "tier1",
  "Mahalakshmi Samiti": "tier1",
  "Akash Hanvate": "tier1",
};

export function defaultRoleFor(name) {
  return ROLE_BY_NAME[(name ?? "").trim()] ?? "tier1";
}
