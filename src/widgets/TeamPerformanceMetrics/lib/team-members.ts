export const TEAM_MEMBERS = [
  "Karthik Radhakrishnan",
  "Pranav Dandibhotla",
  "Sriram Parisa",
  "Lokesh Naik Banavath",
  "Kenya Gentry",
  "Mohammed Ashraf",
  "Hamza Rahmani",
  "Akash Hanvate",
  "Otukho Olembo",
  "Mohammed Zubairuddin",
  "Karthik Damagalla",
  "Abhishek Benarji",
  "Akram Ahmed",
  "Mahalakshmi Samiti",
] as const;

export type TeamMember = (typeof TEAM_MEMBERS)[number];

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Map a sheet "acked by" / agent cell to a known roster name. */
export function matchTeamMember(raw: string): TeamMember | null {
  const n = norm(raw);
  if (!n) return null;
  for (const name of TEAM_MEMBERS) {
    if (norm(name) === n) return name;
  }
  for (const name of TEAM_MEMBERS) {
    const parts = norm(name).split(" ");
    const last = parts[parts.length - 1];
    const first = parts[0];
    if (n.includes(norm(name)) || norm(name).includes(n)) return name;
    if (n.includes(first) && n.includes(last)) return name;
  }
  return null;
}
