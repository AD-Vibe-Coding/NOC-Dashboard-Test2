/**
 * GET /api/zoom/queue
 *
 * Live Zoom Phone queue availability using Server-to-Server OAuth.
 *
 * Confirmed working endpoints (with current scopes):
 *   ✅ GET /phone/call_queues                    — list queues
 *   ✅ GET /phone/call_queues/{id}/members        — member roster + receive_call status
 *   ❌ GET /phone/users                          — requires phone:read:list_users:admin (403)
 *   ❌ GET /users/{id}/presence_status           — requires user:read:presence_status:admin (not available)
 *
 * Status mapping from receive_call field:
 *   receive_call: true  → "ready"     (opted in to receive queue calls)
 *   receive_call: false → "not_ready" (opted out / on break / DND)
 */

// In-process token cache
let _token: { value: string; expiresAt: number } | null = null;

async function getToken(accountId: string, clientId: string, clientSecret: string): Promise<string> {
  if (_token && _token.expiresAt > Date.now() + 60_000) return _token.value;
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const r = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    { method: "POST", headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" } },
  );
  if (!r.ok) { const t = await r.text(); throw new Error(`Zoom OAuth (${r.status}): ${t.slice(0, 200)}`); }
  const j: any = await r.json();
  if (!j.access_token) throw new Error("Zoom OAuth: missing access_token");
  _token = { value: String(j.access_token), expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return _token.value;
}

async function zoomGet(token: string, path: string): Promise<any> {
  const r = await fetch(`https://api.zoom.us/v2${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) { const t = await r.text(); throw new Error(`Zoom GET ${path} (${r.status}): ${t.slice(0, 200)}`); }
  return r.json();
}

async function paginate(token: string, path: string, key: string): Promise<any[]> {
  const all: any[] = [];
  let next = "";
  for (let i = 0; i < 5; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${path}${sep}page_size=100${next ? `&next_page_token=${next}` : ""}`;
    const j: any = await zoomGet(token, url);
    all.push(...(Array.isArray(j?.[key]) ? j[key] : []));
    next = String(j?.next_page_token ?? "");
    if (!next) break;
  }
  return all;
}

function buildSnapshot(queueName: string) {
  const now = Date.now();
  const rows = [
    { n: "Sriram Parisa",         s: "on_call",   ch: "voice", age: 14*60+22 },
    { n: "Mohammed Akram Ahmed",  s: "on_call",   ch: "voice", age: 7*60+8  },
    { n: "Karthik Damagalla",     s: "on_call",   ch: "video", age: 2*60+41 },
    { n: "Kenya Gentry",          s: "wrap_up",              age: 38       },
    { n: "Karthik Radhakrishnan", s: "ready",                age: 18*60    },
    { n: "Anirudh Kukudala",      s: "ready",                age: 5*60     },
    { n: "Otukho Olembo",         s: "not_ready", sub: "Lunch", age: 26*60 },
    { n: "Perry Cox",             s: "not_ready", sub: "Lunch", age: 36*60 },
    { n: "Akash Hanvate",         s: "not_ready", sub: "Break", age: 4*60  },
    { n: "Ashraf Mohammed",       s: "offline",              age: 72*60    },
  ] as Array<{ n: string; s: string; ch?: string; sub?: string; age: number }>;

  const agents = rows.map((r, i) => ({
    agent_id: `snap-${i + 1}`,
    display_name: r.n,
    status: r.s,
    sub_status: r.sub,
    status_changed_at: now - r.age * 1000,
    engagement_started_at: r.s === "on_call" ? now - r.age * 1000 : undefined,
    engagement_channel: r.ch,
    queues: [queueName],
  }));
  const totals = { on_call: 0, ready: 0, wrap_up: 0, not_ready: 0, offline: 0 };
  for (const a of agents) (totals as any)[a.status] = ((totals as any)[a.status] ?? 0) + 1;
  return { agents, totals };
}

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const accountId = String(process.env.ZOOM_ACCOUNT_ID ?? "").trim();
  const clientId  = String(process.env.ZOOM_CLIENT_ID  ?? "").trim();
  const clientSecret = String(process.env.ZOOM_CLIENT_SECRET ?? "").trim();
  const queueIdFilter = String(process.env.ZOOM_QUEUE_ID ?? "").trim() || undefined;

  // No credentials → snapshot
  if (!accountId || !clientId || !clientSecret) {
    const { agents, totals } = buildSnapshot("NOC Queue");
    return res.status(200).json({
      source: "snapshot", fetched_at: new Date().toISOString(),
      queue_name: "NOC Queue", agents, totals,
      warning: "Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET in .env to enable live mode.",
    });
  }

  try {
    const token = await getToken(accountId, clientId, clientSecret);

    // 1. List all queues
    const allQueues = await paginate(token, "/phone/call_queues", "call_queues");
    if (allQueues.length === 0) throw new Error("No Zoom Phone call queues found.");

    // 2. Filter by ZOOM_QUEUE_ID if set
    let targetQueues = allQueues;
    if (queueIdFilter) {
      const match = allQueues.find(
        (q: any) => q.id === queueIdFilter ||
          String(q.name ?? "").toLowerCase().includes(queueIdFilter.toLowerCase()),
      );
      if (match) targetQueues = [match];
    }

    const resolvedQueueName = targetQueues.length === 1
      ? String(targetQueues[0].name)
      : targetQueues.map((q: any) => q.name).join(" + ");

    // 3. Collect members from all target queues, de-duplicate by user ID
    const memberMap = new Map<string, {
      id: string; name: string; email?: string;
      receive_call: boolean; queues: string[];
    }>();

    await Promise.all(targetQueues.map(async (q: any) => {
      const members = await paginate(token, `/phone/call_queues/${q.id}/members`, "call_queue_members");
      for (const m of members) {
        const uid = String(m.id ?? m.user_id ?? "");
        if (!uid) continue;
        if (memberMap.has(uid)) {
          memberMap.get(uid)!.queues.push(String(q.name));
          // If ANY queue has receive_call=true, treat as ready
          if (m.receive_call) memberMap.get(uid)!.receive_call = true;
        } else {
          memberMap.set(uid, {
            id: uid,
            name: String(m.name ?? m.display_name ?? m.email ?? "Unknown"),
            email: m.email ? String(m.email) : undefined,
            receive_call: !!m.receive_call,
            queues: [String(q.name)],
          });
        }
      }
    }));

    const roster = Array.from(memberMap.values());
    const now = Date.now();

    // 4. Map receive_call → status
    //    receive_call: true  = agent opted in → "ready"
    //    receive_call: false = agent opted out → "not_ready"
    const agents = roster.map((u) => ({
      agent_id: u.id,
      display_name: u.name,
      status: u.receive_call ? "ready" : "not_ready",
      sub_status: u.receive_call ? undefined : "Opted out",
      status_changed_at: now,
      engagement_started_at: undefined,
      engagement_channel: undefined,
      queues: u.queues,
    }));

    // Sort: ready first, then not_ready, alphabetically within each group
    agents.sort((a, b) => {
      if (a.status !== b.status) return a.status === "ready" ? -1 : 1;
      return a.display_name.localeCompare(b.display_name);
    });

    const totals = {
      on_call:   agents.filter((a) => a.status === "on_call").length,
      ready:     agents.filter((a) => a.status === "ready").length,
      wrap_up:   agents.filter((a) => a.status === "wrap_up").length,
      not_ready: agents.filter((a) => a.status === "not_ready").length,
      offline:   agents.filter((a) => a.status === "offline").length,
    };

    return res.status(200).json({
      source: "live",
      fetched_at: new Date().toISOString(),
      queue_name: resolvedQueueName,
      agents,
      totals,
      warning: "Showing queue availability (receive_call). To detect active calls, add scope user:read:presence_status:admin in Zoom Marketplace.",
    });

  } catch (err: any) {
    // Always fall back to snapshot — never return 500
    const msg = String(err?.message ?? "Zoom API error");
    const { agents, totals } = buildSnapshot("NOC Queue");
    return res.status(200).json({
      source: "snapshot",
      fetched_at: new Date().toISOString(),
      queue_name: "NOC Queue",
      agents,
      totals,
      warning: `Zoom API error — showing snapshot: ${msg.slice(0, 200)}`,
    });
  }
}
