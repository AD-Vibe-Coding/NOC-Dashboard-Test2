/**
 * GET  /api/access-control  — Returns full team roster with effective roles
 *                             (static defaults merged with any DB overrides).
 * PATCH /api/access-control — Update a member's role (manager only).
 *                             Body: { name, email?, role }
 * DELETE /api/access-control?name=... — Reset to static default (manager only).
 *
 * Manager-only for writes; all authenticated users can read.
 */
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { getSession, requireManager } from "./_lib/auth-middleware.js";

// Static roster — source of truth for who is on the team.
const STATIC_ROSTER: Array<{ name: string; email: string; defaultRole: string }> = [
  // Managers
  { name: "Anirudh Kukudala",      email: "anirudh.kukudala@appdirect.com",    defaultRole: "manager" },
  { name: "Perry Cox",             email: "perry.cox@appdirect.com",            defaultRole: "manager" },
  { name: "Matt Marquez",          email: "matt.marquez@appdirect.com",         defaultRole: "manager" },
  // Tier 3
  { name: "Otukho Olembo",         email: "otukho.olembo@appdirect.com",        defaultRole: "tier3"   },
  // Tier 2
  { name: "Mohammed Zubairuddin",  email: "zubair.mohd@appdirect.com",          defaultRole: "tier2"   },
  { name: "Karthik Radhakrishnan", email: "karthik.radhakrishnan@appdirect.com",defaultRole: "tier2"   },
  { name: "Abhishek Benarji",      email: "abishek.benarji@appdirect.com",      defaultRole: "tier2"   },
  // Tier 1 — NOC
  { name: "Pranav Dandibhotla",    email: "pranav.dandibhotla@appdirect.com",   defaultRole: "tier1"   },
  { name: "Mohammed Ashraf",       email: "ashraf.mohammed@appdirect.com",      defaultRole: "tier1"   },
  { name: "Akram Ahmed",           email: "akram.mohammed@appdirect.com",       defaultRole: "tier1"   },
  { name: "Kenya Gentry",          email: "kenya.gentry@appdirect.com",         defaultRole: "tier1"   },
  { name: "Hamza Rahmani",         email: "hamza.umme@appdirect.com",           defaultRole: "tier1"   },
  { name: "Sriram Parisa",         email: "sriram.parisa@appdirect.com",        defaultRole: "tier1"   },
  { name: "Karthik Damagalla",     email: "karthik.damagalla@appdirect.com",    defaultRole: "tier1"   },
  { name: "Lokesh Naik Banavath",  email: "lokesh.banavath@appdirect.com",      defaultRole: "tier1"   },
  { name: "Mahalakshmi Samiti",    email: "samiti.mahalakshmi@appdirect.com",   defaultRole: "tier1"   },
  // Tier 1 — Mobility
  { name: "Akash Hanvate",         email: "akash.hanvate@appdirect.com",        defaultRole: "tier1"   },
];

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  const session = getSession(req);

  // ── GET ─────────────────────────────────────────────────────────────────────
  if (!req.method || req.method === "GET") {
    // Fetch all DB overrides — gracefully handle missing table
    let overrides: any[] = [];
    try {
      const { data, error } = await supabaseAdmin
        .from("user_roles")
        .select("*")
        .order("created_at", { ascending: false });

      // If the table doesn't exist yet (42P01), just use empty overrides
      if (error && !error.message?.includes("42P01") && !error.message?.includes("does not exist")) {
        return res.status(500).json({ error: error.message });
      }
      overrides = data ?? [];
    } catch {
      // Table not yet created — fall back to static roster with no overrides
    }

    // Build a map: name → override row (latest wins)
    const overrideMap = new Map<string, any>();
    for (const row of (overrides ?? [])) {
      if (!overrideMap.has(row.name)) overrideMap.set(row.name, row);
    }

    // Fetch sign-in sessions (best-effort — table may not exist yet)
    let sessions: any[] = [];
    try {
      const { data: sessionData } = await supabaseAdmin
        .from("user_sessions")
        .select("name, email, sign_in_method, picture, last_sign_in")
        .order("last_sign_in", { ascending: false });
      sessions = sessionData ?? [];
    } catch { /* user_sessions table not yet created — push schema to Supabase */ }

    const sessionMap = new Map<string, any>();
    for (const s of sessions) {
      if (!sessionMap.has(s.name)) sessionMap.set(s.name, s);
    }

    // Merge static roster with overrides + sessions
    const members = STATIC_ROSTER.map((m) => {
      const override = overrideMap.get(m.name);
      const session = sessionMap.get(m.name);
      return {
        name: m.name,
        email: session?.email ?? m.email,
        defaultRole: m.defaultRole,
        role: override?.role ?? m.defaultRole,
        isOverridden: !!override,
        overrideId: override?.id ?? null,
        updatedBy: override?.updated_by ?? null,
        updatedAt: override?.created_at ?? null,
        lastSignIn: session?.last_sign_in ?? null,
        signInMethod: session?.sign_in_method ?? null,
        picture: session?.picture ?? null,
      };
    });

    // Counts
    const counts = { manager: 0, customer_service_manager: 0, tier3: 0, tier2: 0, tier1: 0 };
    for (const m of members) {
      if (m.role in counts) (counts as any)[m.role]++;
    }

    // SSO configuration info
    const ssoConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS || "appdirect.com")
      .split(",").map((d: string) => d.trim()).filter(Boolean);

    return res.status(200).json({
      members,
      counts,
      sso: { configured: ssoConfigured, allowedDomains },
    });
  }

  // ── PATCH — update a member's role ──────────────────────────────────────────
  if (req.method === "PATCH") {
    if (!requireManager(req, res)) return;

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim() || null;
    const role = String(body.role ?? "").trim();

    if (!name) return res.status(400).json({ error: "name is required." });
    const validRoles = ["tier1", "tier2", "tier3", "manager", "customer_service_manager"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${validRoles.join(", ")}` });
    }

    const staticMember = STATIC_ROSTER.find((m) => m.name === name);
    if (!staticMember) {
      return res.status(404).json({ error: `"${name}" is not in the team roster.` });
    }

    // If role matches static default, delete any override (clean up)
    if (role === staticMember.defaultRole) {
      await supabaseAdmin.from("user_roles").delete().eq("name", name);
      return res.status(200).json({ name, role, isOverridden: false, message: "Role reset to default." });
    }

    // Upsert the override (delete old + insert new to ensure only one row per name)
    await supabaseAdmin.from("user_roles").delete().eq("name", name);
    const { data, error } = await supabaseAdmin
      .from("user_roles")
      .insert({ name, email: email || staticMember.email, role, updated_by: session!.name })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ name, role, isOverridden: true, override: data });
  }

  // ── DELETE — reset a member to their default role ───────────────────────────
  if (req.method === "DELETE") {
    if (!requireManager(req, res)) return;

    const name = String(
      (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {})?.name
        ?? req.query?.name
        ?? ""
    ).trim();

    if (!name) return res.status(400).json({ error: "name is required." });

    await supabaseAdmin.from("user_roles").delete().eq("name", name);
    const staticMember = STATIC_ROSTER.find((m) => m.name === name);
    return res.status(200).json({
      name,
      role: staticMember?.defaultRole ?? "tier1",
      isOverridden: false,
      message: "Role reset to static default.",
    });
  }

  res.setHeader("Allow", "GET, PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed." });
}
