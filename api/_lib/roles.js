// Server-side duplicate of the role-by-name mapping from src/lib/roles.ts.
// Kept here so api/ routes don't need to import from src/.

export const ROLE_BY_NAME = {
  "Robin Footdale": "customer_service_manager",
  "Kirsten Dichiappari": "customer_service_manager",
  "Corey Stark": "customer_service_manager",
  "Chris Hernandez": "customer_service_manager",
  "Hilary Blake": "customer_service_manager",
  "Kristen Salmon": "customer_service_manager",
  "Rodrigo Garcia": "customer_service_manager",
  "Andrew Freitas": "customer_service_manager",
  "Georgia Bourikas": "customer_service_manager",
  "Anirudh Kukudala": "manager",
  "Perry Cox": "manager",
  "Matt Marquez": "manager",
  "Otukho Olembo": "tier3",
  "Akash Hanvate": "tier2",
  "Karthik Radhakrishnan": "tier2",
  "Mohammed Zubairuddin": "tier2",
  "Abishek Benarji": "tier2",
  "Abhishek Benarji": "tier2",
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
  "Zubair Mohammed": "tier2",
};

export function defaultRoleFor(name) {
  return ROLE_BY_NAME[(name ?? "").trim()] ?? "tier1";
}

export const MIGRATE_OLD_ROLE = {
  technician: "tier1",
  lead: "tier3",
  manager: "manager",
  customer_service_manager: "customer_service_manager",
  tier1: "tier1",
  tier2: "tier2",
  tier3: "tier3",
};

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
  // ---- Customer Service Managers ----
  "robin.footdale@appdirect.com": { name: "Robin Footdale", role: "customer_service_manager" },
  "kirsten.dichiappari@appdirect.com": { name: "Kirsten Dichiappari", role: "customer_service_manager" },
  "corey.stark@appdirect.com": { name: "Corey Stark", role: "customer_service_manager" },
  "chris.hernandez@appdirect.com": { name: "Chris Hernandez", role: "customer_service_manager" },
  "hilary.blake@appdirect.com": { name: "Hilary Blake", role: "customer_service_manager" },
  "kristen.salmon@appdirect.com": { name: "Kristen Salmon", role: "customer_service_manager" },
  "rodrigo.garcia@appdirect.com": { name: "Rodrigo Garcia", role: "customer_service_manager" },
  "andrew.freitas@appdirect.com": { name: "Andrew Freitas", role: "customer_service_manager" },
  "georgia.bourikas@appdirect.com": { name: "Georgia Bourikas", role: "customer_service_manager" },

  // ---- Managers ----
  "anirudh.kukudala@appdirect.com": { name: "Anirudh Kukudala", role: "manager" },
  "perry.cox@appdirect.com": { name: "Perry Cox", role: "manager" },
  "matt.marquez@appdirect.com": { name: "Matt Marquez", role: "manager" },

  // ---- Tier 3 ----
  "otukho.olembo@appdirect.com": { name: "Otukho Olembo", role: "tier3" },

  // ---- Tier 2 ----
  "akash.hanvate@appdirect.com": { name: "Akash Hanvate", role: "tier2" },
  "karthik.radhakrishnan@appdirect.com": { name: "Karthik Radhakrishnan", role: "tier2" },
  "zubair.mohd@appdirect.com": { name: "Mohammed Zubairuddin", role: "tier2" },
  "abishek.benarji@appdirect.com": { name: "Abishek Benarji", role: "tier2" },

  // ---- Tier 1 ----
  "ashraf.mohammed@appdirect.com": { name: "Mohammed Ashraf", role: "tier1" },
  "hamza.umme@appdirect.com": { name: "Hamza Rahmani", role: "tier1" },
  "karthik.damagalla@appdirect.com": { name: "Karthik Damagalla", role: "tier1" },
  "lokesh.banavath@appdirect.com": { name: "Lokesh Banavath", role: "tier1" },
  "pranav.dandibhotla@appdirect.com": { name: "Pranav Dandibhotla", role: "tier1" },
  "sriram.parisa@appdirect.com": { name: "Sriram Parisa", role: "tier1" },
  "akram.mohammed@appdirect.com": { name: "Akram Ahmed", role: "tier1" },
  "samiti.mahalakshmi@appdirect.com": { name: "Mahalakshmi Samiti", role: "tier1" },
  "kenya.gentry@appdirect.com": { name: "Kenya Gentry", role: "tier1" },
};

/**
 * Look up a user by email. Returns { name, role } if found, null otherwise.
 * Email is case-insensitive.
 */
export function lookupByEmail(email) {
  if (!email) return null;
  return ROSTER_BY_EMAIL[email.toLowerCase().trim()] ?? null;
}
