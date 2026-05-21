// Server-side duplicate of the role-by-name mapping from src/lib/roles.ts.
// Kept here so api/ routes don't need to import from src/.

export const ROLE_BY_NAME = {
  "Anirudh Kukudala": "manager",
  "Perry Cox": "manager",
  "Matt Marquez": "manager",
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

/**
 * Email → roster identity mapping.
 * When someone signs in via Google SSO, we use their email (which never
 * changes) to reliably resolve the canonical roster name + role —
 * regardless of how Google formats their profile name.
 *
 * Keys MUST be lowercased.
 *
 * IMPORTANT: Keep in sync with src/lib/roles.ts ROSTER_BY_EMAIL.
 */
export const ROSTER_BY_EMAIL = {
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

/**
 * Look up a user by email. Returns { name, role } if found, null otherwise.
 * Email is case-insensitive.
 */
export function lookupByEmail(email) {
  if (!email) return null;
  return ROSTER_BY_EMAIL[email.toLowerCase().trim()] ?? null;
}
