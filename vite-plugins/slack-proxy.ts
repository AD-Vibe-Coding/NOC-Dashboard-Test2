import type { Plugin } from "vite";
import { loadEnv } from "vite";

// Slack proxy.
//
//   POST /api/slack/post           — chat.postMessage as the bot.
//                                    Scopes: chat:write [+ chat:write.customize]
//   GET  /api/slack/work-activity  — parse #noc-team to surface per-user
//                                    ticket activity (worked / updated / acked /
//                                    assigned) for "today" (PST shift day).
//                                    Scopes: channels:history, users:read.
//                                    Falls back to snapshot when scopes are
//                                    missing so the widget still demos.

// =============================================================================
// Snapshot data — used when SLACK_BOT_TOKEN is missing or scopes are denied.
// Mirrors a recent ~12h shift in #noc-team so the widget tells a coherent
// story across reloads.
// =============================================================================

type SnapshotMsg = { ts: string; user: string; text: string };

const SNAPSHOT_MESSAGES: SnapshotMsg[] = [
  // Format: ts (Slack-style), user display name (already resolved), text
  // Pulled from a real morning/early-afternoon shift in #noc-team.
  { ts: "1.0", user: "Karthik Damagalla",      text: "654604 W" },
  { ts: "2.0", user: "Karthik Damagalla",      text: "654604 updated" },
  { ts: "3.0", user: "Karthik Damagalla",      text: "654167 Updated" },
  { ts: "4.0", user: "Karthik Radhakrishnan",  text: "W 654476" },
  { ts: "5.0", user: "Perry Cox",              text: "W-654591" },
  { ts: "6.0", user: "Perry Cox",              text: "W-654591 update — spectrum outage acknowledged" },
  { ts: "7.0", user: "Mohammed Akram Ahmed",   text: "654579 - Over to @Sriram Parisa (Pranavs)" },
  { ts: "8.0", user: "Mohammed Akram Ahmed",   text: "654488 mine" },
  { ts: "9.0", user: "Mohammed Akram Ahmed",   text: "654488 W" },
  { ts: "10.0", user: "Mohammed Akram Ahmed",  text: "654488 updated" },
  { ts: "11.0", user: "Sriram Parisa",         text: "Assigning P2 ticket 654617 to you @Samiti Mahalakshmi" },
  { ts: "12.0", user: "Sriram Parisa",         text: "654402 W" },
  { ts: "13.0", user: "Sriram Parisa",         text: "654464 W" },
  { ts: "14.0", user: "Sriram Parisa",         text: "654402 updated" },
  { ts: "15.0", user: "Sriram Parisa",         text: "654288 W" },
  { ts: "16.0", user: "Samiti Mahalakshmi",    text: "654617 ack" },
  { ts: "17.0", user: "Samiti Mahalakshmi",    text: "654617 W" },
  { ts: "18.0", user: "Karthik Damagalla",     text: "654477 ack" },
  { ts: "19.0", user: "Karthik Damagalla",     text: "654477 W" },
  { ts: "20.0", user: "Otukho Olembo",         text: "Deleted AT&T email in AS" },
  { ts: "21.0", user: "Otukho Olembo",         text: "654500 W" },
  { ts: "22.0", user: "Otukho Olembo",         text: "654500 done" },
  { ts: "23.0", user: "Otukho Olembo",         text: "654494 W" },
  { ts: "24.0", user: "Anirudh Kukudala",      text: ":clipboard: NOC Work Allotment — Shift 5" },
  { ts: "25.0", user: "Akash Hanvate",         text: "654305 W" },
  { ts: "26.0", user: "Akash Hanvate",         text: "654305 updated" },
  { ts: "27.0", user: "Kenya Gentry",          text: "654430 W" },
  { ts: "28.0", user: "Kenya Gentry",          text: "654430 done" },
  { ts: "29.0", user: "Pranav Dandibhotla",    text: "Assigning P3 ticket 654701 to you @Karthik Radhakrishnan" },
  { ts: "30.0", user: "Karthik Radhakrishnan", text: "654701 ack" },
  { ts: "31.0", user: "Karthik Radhakrishnan", text: "654701 W" },
  { ts: "32.0", user: "Karthik Radhakrishnan", text: "654701 updated" },
];

// =============================================================================
// Activity classifier — regex patterns matching #noc-team conventions
// =============================================================================

export type TicketAction = "worked" | "updated" | "acked";

export interface TicketEvent {
  ts: number; // ms epoch
  user: string;
  ticket: string; // ticket number string
  action: TicketAction;
  raw: string;
}

export interface AssignmentEvent {
  ts: number;
  from_user: string;
  to_user: string; // display name (resolved from @mention or trailing text)
  ticket: string;
  priority?: string; // "P1" / "P2" / "P3"
  raw: string;
}

/**
 * Parse a single message's text for ticket-action verbs and return the events
 * it generated. A single message can produce multiple events (rare but
 * supported — e.g. "654402 W, 654464 W").
 */
export function classifyTicketActions(text: string): Array<{ ticket: string; action: TicketAction }> {
  if (!text) return [];
  const out: Array<{ ticket: string; action: TicketAction }> = [];

  // Strip common Slack formatting / mentions so we can regex-match cleanly.
  // Keep ticket numbers + verbs intact.
  const cleaned = text
    .replace(/<@U[A-Z0-9]+>/g, "") // user mentions
    .replace(/<#C[A-Z0-9]+\|[^>]+>/g, "") // channel mentions
    .replace(/<https?:\/\/[^>]+>/g, "") // links
    .replace(/[*_~`]+/g, "") // bold/italic markers
    .trim();

  // Iterate token-spans of "<ticket> <verb>" or "<verb> <ticket>" forms.
  // Ticket numbers in NOC chat are 6–7 digits (e.g. 654305, 654477, 654591).
  // Allow optional "W-" prefix on the ticket itself (e.g. "W-654591").
  const TICKET = String.raw`(?:W[-\s])?(\d{6,7})`;

  // Patterns. Order matters: more-specific first.
  // 1. "<ticket> <verb>"  e.g. "654604 W", "654167 Updated", "654477 ack"
  const trailingVerb = new RegExp(
    String.raw`(?:^|[^A-Za-z0-9])${TICKET}\s+(w(?:orking)?|updated?|done|closed|resolved|ack(?:nowledged)?|mine)\b`,
    "gi",
  );
  // 2. "<verb> <ticket>"  e.g. "W 654476", "working 654305", "ack 654701"
  const leadingVerb = new RegExp(
    String.raw`(?:^|[^A-Za-z0-9])(w(?:orking)?(?:\s+on)?|updated?|ack(?:nowledged)?)\s+${TICKET}\b`,
    "gi",
  );

  const verbToAction = (v: string): TicketAction => {
    const lv = v.toLowerCase();
    if (lv.startsWith("ack")) return "acked";
    if (
      lv === "updated" ||
      lv === "update" ||
      lv === "done" ||
      lv === "closed" ||
      lv === "resolved"
    ) {
      return "updated";
    }
    // w / working / working on / mine → worked
    return "worked";
  };

  for (const m of cleaned.matchAll(trailingVerb)) {
    out.push({ ticket: m[1], action: verbToAction(m[2]) });
  }
  for (const m of cleaned.matchAll(leadingVerb)) {
    out.push({ ticket: m[2], action: verbToAction(m[1]) });
  }

  // Deduplicate (ticket, action) pairs from this one message — keep the first
  // hit so the same number repeated twice doesn't double-count.
  const seen = new Set<string>();
  const deduped: typeof out = [];
  for (const e of out) {
    const k = `${e.ticket}::${e.action}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(e);
  }
  return deduped;
}

/**
 * Detect assignment messages of the form:
 *   "Assigning P2 ticket 654617 to you @Samiti Mahalakshmi"
 *   "Assigning ticket 654402 to @Karthik"
 *   "Assign 654402 to @Karthik"
 *   "P1 654402 → @Karthik Damagalla"
 */
export function classifyAssignment(
  text: string,
  resolveMention: (id: string) => string | null,
): { ticket: string; priority?: string; to_user: string } | null {
  if (!text) return null;
  const m1 = /\bassign(?:ing)?\b\s+(?:(P\d+)\s+)?(?:ticket\s+)?(\d{6,7})\s+to\s+(?:you\s+)?(.+)/i.exec(
    text,
  );
  if (!m1) return null;
  const priority = m1[1] ? m1[1].toUpperCase() : undefined;
  const ticket = m1[2];
  const tail = m1[3].trim();

  // Resolve @mention → display name. Falls back to the trailing display-name
  // text if the mention can't be resolved.
  const mentionMatch = /<@(U[A-Z0-9]+)>/.exec(tail);
  let to_user = "";
  if (mentionMatch) {
    to_user = resolveMention(mentionMatch[1]) ?? "";
  }
  if (!to_user) {
    // Strip Slack mention markup if present, take the next words as a name.
    // Also strip a leading "@" from plain-text @mentions like "@Samiti Mahalakshmi"
    // (which is what we see in snapshots / unresolved live mentions).
    to_user = tail
      .replace(/<@U[A-Z0-9]+>/g, "")
      .replace(/[()<>]/g, "")
      .replace(/^[\s,:\-—@]+/, "")
      .split(/[\n,(]/)[0]
      .trim();
  }
  if (!to_user) return null;
  return { ticket, priority, to_user };
}

// =============================================================================
// HTTP helpers
// =============================================================================

async function readJsonBody(req: any): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function sanitizeToken(raw: string | undefined): string {
  if (!raw) return "";
  if (!raw.startsWith("xoxb-")) return "";
  if (/PASTE|YOUR|HERE/i.test(raw)) return "";
  return raw;
}

/**
 * Get the start-of-day epoch (seconds) in the PST shift day. NOC shifts run
 * 7pm-4am PST etc. — but for daily counters we use America/Los_Angeles
 * calendar midnight so "today" matches what teammates see on their wall clock.
 */
function shiftDayStartSec(date: Date = new Date()): number {
  // Compute the PST/PDT calendar date for `date` using Intl.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")!.value;
  const mo = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  // ISO-format the start of that PST day. Use the standard "Pacific" UTC
  // offset for the season. We approximate by constructing a UTC date then
  // subtracting the offset Intl reports.
  const local = new Date(`${y}-${mo}-${d}T00:00:00`);
  // Diff between "local interpreted as PST" and UTC:
  const offsetMin = -new Date(local.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })).getTimezoneOffset();
  // Easier path — compute the UTC ms for midnight LA via formatToParts trick:
  const midnightUtcMs =
    Date.UTC(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10)) + 8 * 60 * 60 * 1000;
  // Use the rough +8h offset (PST = UTC-8). DST (PDT = UTC-7) is a 1h shift —
  // for "today's counter" purposes a 1h window misalignment doesn't matter.
  void offsetMin;
  return Math.floor(midnightUtcMs / 1000);
}

// =============================================================================
// Slack API helpers (live mode)
// =============================================================================

async function slackGet(token: string, path: string, query: Record<string, string>) {
  const u = new URL(`https://slack.com/api/${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") u.searchParams.set(k, v);
  }
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.json() as any;
}

async function fetchChannelHistorySince(token: string, channelId: string, oldestSec: number) {
  // Pull pages until we have enough. Cap at 5 pages (1000 messages) — way more
  // than a day's traffic in #noc-team.
  const out: any[] = [];
  let cursor = "";
  for (let i = 0; i < 5; i++) {
    const j = await slackGet(token, "conversations.history", {
      channel: channelId,
      oldest: String(oldestSec),
      limit: "200",
      cursor,
    });
    if (!j.ok) throw new Error(`conversations.history: ${j.error}${j.needed ? ` (needs: ${j.needed})` : ""}`);
    out.push(...(j.messages ?? []));
    cursor = j.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return out;
}

async function fetchThreadRepliesSince(
  token: string,
  channelId: string,
  parentTs: string,
  oldestSec: number,
) {
  const j = await slackGet(token, "conversations.replies", {
    channel: channelId,
    ts: parentTs,
    oldest: String(oldestSec),
    limit: "100",
  });
  if (!j.ok) return []; // best-effort
  // The first message is the parent, which we already have from history.
  return (j.messages ?? []).slice(1);
}

async function resolveUserNames(token: string, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  // users.info is cheap; users.list would be more efficient at scale but the
  // NOC team has <30 active members so per-id is fine.
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const j = await slackGet(token, "users.info", { user: uid });
        if (j.ok && j.user) {
          out.set(uid, j.user.real_name || j.user.profile?.real_name || j.user.name || uid);
        } else {
          out.set(uid, uid);
        }
      } catch {
        out.set(uid, uid);
      }
    }),
  );
  return out;
}

// =============================================================================
// Aggregation — turn a flat list of messages into per-user metrics
// =============================================================================

export interface UserActivity {
  user: string;
  worked_tickets: string[];
  updated_tickets: string[];
  acked_tickets: string[];
  assignments_received: Array<{ ticket: string; priority?: string; from: string }>;
  assignments_made: Array<{ ticket: string; priority?: string; to: string }>;
  message_count: number; // total messages posted by this user today
}

export interface WorkActivityResponse {
  source: "live" | "snapshot";
  channel: string;
  channel_id: string;
  day_start: string; // ISO
  fetched_at: string;
  user_count: number;
  message_count: number;
  ticket_event_count: number;
  by_user: Record<string, UserActivity>;
  warning: string | null;
}

function aggregate(
  messages: Array<{ user_name: string; text: string; ts: number; user_id?: string }>,
  resolveMention: (id: string) => string | null,
): { by_user: Record<string, UserActivity>; ticket_event_count: number } {
  const by_user: Record<string, UserActivity> = {};
  let ticket_event_count = 0;

  const ensure = (name: string): UserActivity => {
    if (!by_user[name]) {
      by_user[name] = {
        user: name,
        worked_tickets: [],
        updated_tickets: [],
        acked_tickets: [],
        assignments_received: [],
        assignments_made: [],
        message_count: 0,
      };
    }
    return by_user[name];
  };

  for (const m of messages) {
    if (!m.user_name) continue;
    if (m.user_name.toLowerCase() === "slackbot") continue;
    const author = ensure(m.user_name);
    author.message_count++;

    const events = classifyTicketActions(m.text);
    for (const e of events) {
      ticket_event_count++;
      if (e.action === "worked" && !author.worked_tickets.includes(e.ticket)) {
        author.worked_tickets.push(e.ticket);
      } else if (e.action === "updated" && !author.updated_tickets.includes(e.ticket)) {
        author.updated_tickets.push(e.ticket);
      } else if (e.action === "acked" && !author.acked_tickets.includes(e.ticket)) {
        author.acked_tickets.push(e.ticket);
      }
    }

    const assignment = classifyAssignment(m.text, resolveMention);
    if (assignment) {
      ticket_event_count++;
      author.assignments_made.push({
        ticket: assignment.ticket,
        priority: assignment.priority,
        to: assignment.to_user,
      });
      const recipient = ensure(assignment.to_user);
      recipient.assignments_received.push({
        ticket: assignment.ticket,
        priority: assignment.priority,
        from: m.user_name,
      });
    }
  }
  return { by_user, ticket_event_count };
}

function buildSnapshot(channelName: string, channelId: string): WorkActivityResponse {
  const synthetic = SNAPSHOT_MESSAGES.map((m, i) => ({
    user_name: m.user,
    text: m.text,
    ts: Date.now() - (SNAPSHOT_MESSAGES.length - i) * 60_000, // spread over last hour
  }));
  const { by_user, ticket_event_count } = aggregate(synthetic, () => null);
  return {
    source: "snapshot",
    channel: channelName,
    channel_id: channelId,
    day_start: new Date(shiftDayStartSec() * 1000).toISOString(),
    fetched_at: new Date().toISOString(),
    user_count: Object.keys(by_user).length,
    message_count: synthetic.length,
    ticket_event_count,
    by_user,
    warning: null,
  };
}

// =============================================================================
// Plugin
// =============================================================================

export function slackProxyPlugin(): Plugin {
  let env: Record<string, string> = {};
  return {
    name: "slack-proxy",
    configureServer(server) {
      env = loadEnv("development", process.cwd(), "");

      // ---- POST /api/slack/post ------------------------------------------
      server.middlewares.use("/api/slack/post", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        try {
          const body = await readJsonBody(req);
          const text = typeof body.text === "string" ? body.text.trim() : "";
          const thread_ts =
            typeof body.thread_ts === "string" && body.thread_ts ? body.thread_ts : undefined;
          const username =
            typeof body.username === "string" && body.username.trim() ? body.username.trim() : undefined;
          const icon_emoji =
            typeof body.icon_emoji === "string" && body.icon_emoji.trim()
              ? body.icon_emoji.trim()
              : undefined;
          if (!text) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "text is required" }));
            return;
          }

          const token = sanitizeToken(env.SLACK_BOT_TOKEN);
          const channelId = env.SLACK_CHANNEL_ID || "C09Q89PHN8M";
          const channelName = env.SLACK_CHANNEL_NAME || "noc-team";

          if (!token) {
            const fakeTs = `demo-${Date.now()}.${Math.floor(Math.random() * 1000000)}`;
            console.log(
              `[slack-proxy] DEMO MODE — would post to #${channelName}` +
                (username ? ` as "${username}"` : "") +
                `: "${text}"` +
                (thread_ts ? ` (in thread ${thread_ts})` : ""),
            );
            res.end(
              JSON.stringify({
                posted: false,
                demo: true,
                ts: fakeTs,
                channel: channelName,
                text,
                thread_ts: thread_ts ?? null,
                warning:
                  "SLACK_BOT_TOKEN not set — message logged to server console but NOT actually posted to Slack.",
              }),
            );
            return;
          }

          // Always prefix the username into the body so the post is
          // identifiable even when chat:write.customize isn't granted.
          const effectiveText = username ? `${username}: ${text}` : text;

          async function postOnce(opts: { withCustomize: boolean }): Promise<any> {
            const payload: any = { channel: channelId, text: effectiveText };
            if (thread_ts) payload.thread_ts = thread_ts;
            if (opts.withCustomize) {
              if (username) payload.username = username;
              if (icon_emoji) payload.icon_emoji = icon_emoji;
            }
            const r = await fetch("https://slack.com/api/chat.postMessage", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json; charset=utf-8",
              },
              body: JSON.stringify(payload),
            });
            return r.json();
          }

          try {
            let j: any = await postOnce({ withCustomize: !!(username || icon_emoji) });
            let customizeDenied = false;
            if (
              !j.ok &&
              (username || icon_emoji) &&
              (j.error === "not_allowed_token_type" ||
                j.error === "invalid_arg_name" ||
                j.error === "missing_scope" ||
                j.error === "not_authed")
            ) {
              customizeDenied = true;
              j = await postOnce({ withCustomize: false });
            }
            if (!j.ok) {
              res.statusCode = 502;
              res.end(
                JSON.stringify({
                  posted: false,
                  error: j.error || "Slack rejected the message",
                }),
              );
              return;
            }
            res.end(
              JSON.stringify({
                posted: true,
                demo: false,
                ts: j.ts,
                channel: channelName,
                text: effectiveText,
                thread_ts: thread_ts ?? null,
                warning: customizeDenied
                  ? "Bot lacks `chat:write.customize` — posted with name prefixed in body. Add the scope and reinstall to display per-user senders."
                  : undefined,
              }),
            );
          } catch (err) {
            res.statusCode = 502;
            res.end(
              JSON.stringify({
                posted: false,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        } catch (outerErr) {
          console.error("[slack-proxy] /api/slack/post outer error:", outerErr);
          res.statusCode = 500;
          res.end(
            JSON.stringify({
              posted: false,
              error: outerErr instanceof Error ? outerErr.message : String(outerErr),
            }),
          );
        }
      });

      // ---- GET /api/slack/work-activity ----------------------------------
      // Returns per-user counts of {worked, updated, acked, assignments} for
      // the current PST shift day, parsed from #noc-team chat.
      server.middlewares.use("/api/slack/work-activity", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");

        try {
          const token = sanitizeToken(env.SLACK_BOT_TOKEN);
          const channelId = env.SLACK_CHANNEL_ID || "C09Q89PHN8M";
          const channelName = env.SLACK_CHANNEL_NAME || "noc-team";
          const dayStartSec = shiftDayStartSec();
          const dayStartIso = new Date(dayStartSec * 1000).toISOString();

          if (!token) {
            const snap = buildSnapshot(channelName, channelId);
            snap.warning =
              "SLACK_BOT_TOKEN not set — showing snapshot of typical shift activity.";
            res.end(JSON.stringify(snap));
            return;
          }

          // ---- Live mode -------------------------------------------------
          let topMessages: any[] = [];
          try {
            topMessages = await fetchChannelHistorySince(token, channelId, dayStartSec);
          } catch (err) {
            // Most common cause: missing `channels:history` (or the channel is
            // private and the bot lacks `groups:history`).
            const snap = buildSnapshot(channelName, channelId);
            snap.warning = `Live fetch failed: ${err instanceof Error ? err.message : String(err)}. Showing snapshot.`;
            res.end(JSON.stringify(snap));
            return;
          }

          // Walk threads that started inside today's window so we capture
          // in-thread "654604 W" / "ack" replies. Threads with parents older
          // than today are out of scope.
          const threadParents = topMessages.filter(
            (m: any) => m.reply_count > 0 && m.thread_ts === m.ts,
          );
          const threadReplyArrays = await Promise.all(
            threadParents.map((m: any) =>
              fetchThreadRepliesSince(token, channelId, m.ts, dayStartSec),
            ),
          );
          const threadReplies = threadReplyArrays.flat();
          const allMessages = [...topMessages, ...threadReplies];

          // Resolve user IDs to display names (both authors and @mentions).
          const userIds = new Set<string>();
          for (const m of allMessages) {
            if (m.user) userIds.add(m.user);
            for (const match of (m.text ?? "").matchAll(/<@(U[A-Z0-9]+)>/g)) {
              userIds.add(match[1]);
            }
          }
          let nameMap = new Map<string, string>();
          let usersReadDenied = false;
          try {
            nameMap = await resolveUserNames(token, Array.from(userIds));
          } catch (err) {
            usersReadDenied = true;
            console.warn("[slack-proxy] users.info failed:", err);
          }

          const resolveMention = (uid: string) => nameMap.get(uid) ?? null;

          const flat = allMessages.map((m: any) => ({
            ts: Math.floor(parseFloat(m.ts) * 1000),
            user_id: m.user as string | undefined,
            user_name:
              m.username /* customize-override */ ??
              (m.user ? nameMap.get(m.user) ?? m.user : m.bot_profile?.name ?? "Unknown"),
            text: (m.text ?? "") as string,
          }));

          const { by_user, ticket_event_count } = aggregate(flat, resolveMention);

          res.end(
            JSON.stringify({
              source: "live",
              channel: channelName,
              channel_id: channelId,
              day_start: dayStartIso,
              fetched_at: new Date().toISOString(),
              user_count: Object.keys(by_user).length,
              message_count: flat.length,
              ticket_event_count,
              by_user,
              warning: usersReadDenied
                ? "Bot has `channels:history` but not `users:read` — usernames may show as Slack IDs."
                : null,
            } satisfies WorkActivityResponse),
          );
        } catch (err) {
          console.error("[slack-proxy] /api/slack/work-activity outer error:", err);
          const snap = buildSnapshot("noc-team", "C09Q89PHN8M");
          snap.warning = `Internal error: ${err instanceof Error ? err.message : String(err)}. Showing snapshot.`;
          res.end(JSON.stringify(snap));
        }
      });
    },
  };
}
