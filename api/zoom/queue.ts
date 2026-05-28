/**
 * GET /api/zoom/queue
 *
 * Returns who is currently in queue vs not in queue.
 * Uses only:
 *   phone:read:list_call_queues:admin
 *   phone:read:list_call_queue_members:admin
 *
 * Status is derived purely from receive_call on each queue member:
 *   receive_call = true  → in_queue
 *   receive_call = false → not_in_queue
 */

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
  const rows = [
    { n: "Sriram Parisa",          inQueue: true  },
    { n: "Mohammed Akram Ahmed",   inQueue: true  },
    { n: "Karthik Damagalla",      inQueue: true  },
    { n: "Kenya Gentry",           inQueue: true  },
    { n: "Karthik Radhakrishnan",  inQueue: true  },
    { n: "Mohammed Ashraf",        inQueue: true  },
    { n: "Otukho Olembo",          inQueue: false },
    { n: "Perry Cox",              inQueue: false },
    { n: "Akash Hanvate",          inQueue: false },
    { n: "Pranav Dandibhotla",     inQueue: false },
  ];
  const agents = rows.map((r, i) => ({
    agent_id: `snap-${i + 1}`,
    display_name: r.n,
    status: r.inQueue ? "in_queue" : "not_in_queue",
    queues: [queueName],
    queue_opt_in: { [queueName]: r.inQueue },
  }));
  return {
    agents,
    totals: {
      in_queue:     agents.filter((a) => a.status === "in_queue").length,
      not_in_queue: agents.filter((a) => a.status === "not_in_queue").length,
    },
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const accountId    = String(process.env.ZOOM_ACCOUNT_ID    ?? "").trim();
  const clientId     = String(process.env.ZOOM_CLIENT_ID     ?? "").trim();
  const clientSecret = String(process.env.ZOOM_CLIENT_SECRET ?? "").trim();
  const queueIdFilter = String(process.env.ZOOM_QUEUE_ID     ?? "").trim() || undefined;

  if (!accountId || !clientId || !clientSecret) {
    const { agents, totals } = buildSnapshot("NOC Queue");
    return res.status(200).json({
      source: "snapshot", fetched_at: new Date().toISOString(),
      queue_name: "NOC Queue", agents, totals,
      warning: "Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET in .env to enable live data.",
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

    // 3. Collect members, de-duplicate by user ID
    const memberMap = new Map<string, {
      id: string; name: string;
      receive_call: boolean; queues: string[];
      queue_opt_in: Record<string, boolean>;
    }>();

    await Promise.all(targetQueues.map(async (q: any) => {
      const members = await paginate(token, `/phone/call_queues/${q.id}/members`, "call_queue_members");
      for (const m of members) {
        const uid = String(m.id ?? m.user_id ?? "");
        if (!uid) continue;
        const qName = String(q.name);
        const rcv = !!m.receive_call;
        if (memberMap.has(uid)) {
          const ex = memberMap.get(uid)!;
          ex.queues.push(qName);
          ex.queue_opt_in[qName] = rcv;
          if (rcv) ex.receive_call = true;
        } else {
          memberMap.set(uid, {
            id: uid,
            name: String(m.name ?? m.display_name ?? m.email ?? "Unknown"),
            receive_call: rcv,
            queues: [qName],
            queue_opt_in: { [qName]: rcv },
          });
        }
      }
    }));

    // 4. Build agent list — two statuses only
    const agents = Array.from(memberMap.values())
      .filter((u) => !u.name.toLowerCase().includes("overflow"))
      .map((u, i) => ({
        agent_id: u.id || `live-${i}`,
        display_name: u.name,
        status: u.receive_call ? "in_queue" : "not_in_queue",
        queues: u.queues,
        queue_opt_in: u.queue_opt_in,
      }))
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "in_queue" ? -1 : 1;
        return a.display_name.localeCompare(b.display_name);
      });

    const totals = {
      in_queue:     agents.filter((a) => a.status === "in_queue").length,
      not_in_queue: agents.filter((a) => a.status === "not_in_queue").length,
    };

    return res.status(200).json({
      source: "live",
      fetched_at: new Date().toISOString(),
      queue_name: resolvedQueueName,
      agents,
      totals,
      warning: null,
    });

  } catch (err: any) {
    const msg = String(err?.message ?? "Zoom API error");
    const { agents, totals } = buildSnapshot("NOC Queue");
    return res.status(200).json({
      source: "snapshot", fetched_at: new Date().toISOString(),
      queue_name: "NOC Queue", agents, totals,
      warning: `Zoom API error — showing snapshot: ${msg.slice(0, 200)}`,
    });
  }
}
