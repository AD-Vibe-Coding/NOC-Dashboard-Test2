import type { Plugin } from "vite";
import { loadEnv } from "vite";
import { promises as fs } from "fs";
import path from "path";

/**
 * WFH (Work From Home) approval proxy.
 *
 * Endpoints:
 *   GET    /api/wfh/requests              List requests. Filtered by viewer
 *                                          identity passed as `?as=Name`. The
 *                                          approver sees ALL; everyone else
 *                                          sees only their own.
 *   POST   /api/wfh/requests              Submit a new request.
 *   PATCH  /api/wfh/requests/:id          Approve/deny — approver only.
 *
 * Storage: a JSON file at `data/wfh-requests.json`. This gives team-wide
 * shared state when the app is deployed (every team member's browser hits
 * the same server file).
 *
 * Slack: when SLACK_BOT_TOKEN is set, we post a notification to #noc-team
 * on submission and on decision (in the same thread).
 */

interface WfhRequest {
  id: string;
  employee_name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  reason: string;
  status: "pending" | "approved" | "denied";
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  decision_note: string | null;
  slack_message_ts: string | null;
}

interface Store {
  requests: WfhRequest[];
}

// ---- File I/O -------------------------------------------------------------
const DATA_DIR = path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "wfh-requests.json");

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.requests)) return parsed as Store;
  } catch {
    // file missing or corrupt — start fresh
  }
  return { requests: [] };
}

async function writeStore(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  // atomic write: write to tmp then rename
  const tmp = DATA_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmp, DATA_FILE);
}

// ---- Helpers --------------------------------------------------------------
function shortId(): string {
  // 6-char URL-safe ID (more than enough for ~thousands of requests)
  return Math.random().toString(36).slice(2, 8);
}

function isValidDate(s: any): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function dayCount(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!isFinite(a) || !isFinite(b) || b < a) return 0;
  return Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

function formatDateRange(start: string, end: string): string {
  if (start === end) {
    return new Date(`${start}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  return `${new Date(`${start}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} → ${new Date(`${end}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

function getApproverNames(env: Record<string, string>): string[] {
  const raw = env.WFH_APPROVER_NAME || "Anirudh Kukudala";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isApprover(name: string | null, env: Record<string, string>): boolean {
  if (!name) return false;
  const approvers = getApproverNames(env);
  return approvers.some(
    (a) => a.toLowerCase() === name.trim().toLowerCase(),
  );
}

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

// ---- Slack notification (best-effort) ------------------------------------
async function postToSlack(
  env: Record<string, string>,
  text: string,
  opts: { username?: string; icon_emoji?: string; thread_ts?: string } = {},
): Promise<{ ts?: string; posted: boolean }> {
  const rawToken = env.SLACK_BOT_TOKEN;
  const token =
    rawToken && rawToken.startsWith("xoxb-") && !/PASTE|YOUR|HERE/i.test(rawToken)
      ? rawToken
      : "";
  if (!token) {
    console.log(`[wfh-proxy] (no slack token) would post: "${text}"`);
    return { posted: false };
  }
  const channelId = env.SLACK_CHANNEL_ID || "C09Q89PHN8M";
  try {
    const payload: any = { channel: channelId, text };
    if (opts.username) payload.username = opts.username;
    if (opts.icon_emoji) payload.icon_emoji = opts.icon_emoji;
    if (opts.thread_ts) payload.thread_ts = opts.thread_ts;
    let r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });
    let j: any = await r.json();
    // Fallback: drop customize fields if scope is missing
    if (
      !j.ok &&
      (opts.username || opts.icon_emoji) &&
      (j.error === "not_allowed_token_type" ||
        j.error === "missing_scope" ||
        j.error === "invalid_arg_name")
    ) {
      const retryPayload: any = { channel: channelId, text };
      if (opts.thread_ts) retryPayload.thread_ts = opts.thread_ts;
      r = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(retryPayload),
      });
      j = await r.json();
    }
    if (!j.ok) {
      console.warn(`[wfh-proxy] slack post error: ${j.error}`);
      return { posted: false };
    }
    return { ts: j.ts, posted: true };
  } catch (err) {
    console.warn(`[wfh-proxy] slack post failed:`, err);
    return { posted: false };
  }
}

// ---- Email notification (best-effort) -----------------------------------
//
// Sends through the **Devs.ai agent's Gmail MCP tool** — no third-party email
// provider needed. The agent (configured via AI_AGENT_ID + AI_API_KEY) has
// Gmail MCP attached on the Devs.ai platform side, so calling the chat
// completions endpoint with an "email this for me" prompt makes the agent
// invoke its Gmail tool and send from the connected Google account.
//
// Practically: the email lands from anirudh.kukudala@appdirect.com (or
// whichever Gmail account is connected to the agent), shows up in that
// account's "Sent" folder, and replies from approvers go back to the same
// inbox.
//
// Falls back to a server-console preview log when AI_API_KEY is missing so
// dev mode still works without any external dependency.

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Parses the Devs.ai SSE stream and returns the assembled assistant text.
 * The agent runs its Gmail MCP tool during this stream (which we can detect
 * via `event: tool.delta`) and then emits a short text confirmation.
 */
async function readAgentStream(body: ReadableStream<Uint8Array>): Promise<{
  text: string;
  toolUsed: boolean;
}> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assembled = "";
  let toolUsed = false;
  let currentEvent = "";
  let currentData = "";

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        currentData = line.slice(6);
      } else if (line === "" && currentEvent) {
        try {
          const parsed = currentData ? JSON.parse(currentData) : null;
          if (currentEvent === "message.delta" && parsed?.content?.text) {
            assembled += parsed.content.text;
          } else if (currentEvent.startsWith("tool.")) {
            toolUsed = true;
          }
        } catch {
          /* skip malformed JSON */
        }
        currentEvent = "";
        currentData = "";
      }
    }
  }
  return { text: assembled, toolUsed };
}

async function sendEmail(
  env: Record<string, string>,
  payload: EmailPayload,
): Promise<{ sent: boolean; error?: string }> {
  const apiKey = env.AI_API_KEY;
  const platformUrl = env.AI_PLATFORM_URL || "https://devs.ai";
  // Prefer WFH_AGENT_ID so the email path uses a Gmail-MCP-enabled agent
  // while other AI features (Ticket Summary, etc.) stay on AI_AGENT_ID.
  const agentId = env.WFH_AGENT_ID || env.AI_AGENT_ID || "auto";

  // Dev fallback — log a preview so we can see what would have been sent.
  if (!apiKey || apiKey === "PASTE_YOUR_KEY_HERE") {
    console.log(
      `[wfh-proxy] EMAIL (not sent — AI_API_KEY missing) →\n` +
        `  to: ${payload.to}\n` +
        `  subject: ${payload.subject}\n` +
        `  preview: ${payload.text.slice(0, 200).replace(/\n/g, " | ")}`,
    );
    return { sent: false, error: "AI_API_KEY not set" };
  }

  // Instruction to the agent — it must use its connected Gmail MCP tool to
  // send the email and reply with a deterministic confirmation marker so we
  // can detect success programmatically.
  const prompt = [
    "You have a Gmail MCP tool connected. Use it RIGHT NOW to send the email",
    "below. Send the body as HTML (so the recipient sees formatted layout, not",
    "raw tags). Do not ask any clarifying questions — just send it.",
    "",
    `Recipient: ${payload.to}`,
    `Subject: ${payload.subject}`,
    "",
    "--- HTML BODY START ---",
    payload.html,
    "--- HTML BODY END ---",
    "",
    "--- PLAIN-TEXT FALLBACK (optional if the tool requires it) ---",
    payload.text,
    "--- PLAIN-TEXT END ---",
    "",
    "After the Gmail tool returns successfully, reply with EXACTLY this token",
    "and nothing else: __EMAIL_SENT__",
    "",
    "If the Gmail tool is unavailable or fails, reply starting with the token",
    "__EMAIL_FAILED__ followed by a one-sentence reason, e.g.",
    "__EMAIL_FAILED__ Gmail MCP tool is not connected to this agent.",
  ].join("\n");

  try {
    const r = await fetch(`${platformUrl}/api/v1/chats/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: agentId,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      }),
    });
    if (!r.ok || !r.body) {
      const text = await r.text().catch(() => "");
      console.warn(`[wfh-proxy] agent HTTP ${r.status}: ${text.slice(0, 200)}`);
      return { sent: false, error: `Agent HTTP ${r.status}` };
    }

    const { text: assembled, toolUsed } = await readAgentStream(r.body);
    const snippet = assembled.trim().slice(0, 200).replace(/\s+/g, " ");

    if (/__EMAIL_SENT__/.test(assembled)) {
      console.log(
        `[wfh-proxy] email sent via agent Gmail → ${payload.to} (tool_used=${toolUsed})`,
      );
      return { sent: true };
    }
    const failMatch = /__EMAIL_FAILED__\s*[:\-]?\s*(.+)/.exec(assembled);
    if (failMatch) {
      const reason = failMatch[1].trim().slice(0, 200);
      console.warn(`[wfh-proxy] email failed via agent → ${reason}`);
      return { sent: false, error: reason };
    }
    // Heuristic fallback — the agent didn't emit our markers but used a tool
    // and didn't say "can't / don't have access" → treat as success.
    if (
      toolUsed &&
      !/can(not|n't)|don'?t have|unavailable|no.+(tool|access)/i.test(assembled)
    ) {
      console.log(
        `[wfh-proxy] email likely sent via agent (no marker, tool used) → ${payload.to}`,
      );
      return { sent: true };
    }
    console.warn(
      `[wfh-proxy] agent did not confirm send. tool_used=${toolUsed} response="${snippet}"`,
    );
    return {
      sent: false,
      error: `Agent did not confirm send (${snippet || "empty response"})`,
    };
  } catch (err) {
    console.warn(`[wfh-proxy] email exception:`, err);
    return {
      sent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function getApproverEmail(env: Record<string, string>): string {
  // Default to Anirudh's known email (matches CONFLUENCE_USER_EMAIL).
  return (
    env.WFH_APPROVER_EMAIL ||
    env.CONFLUENCE_USER_EMAIL ||
    "anirudh.kukudala@appdirect.com"
  );
}

function getEmployeeEmail(
  env: Record<string, string>,
  employeeName: string,
): string {
  // Derive from "First Last" → "first.last@<domain>". This matches the
  // common AppDirect email pattern. Override-able via .env mappings if a
  // user's email doesn't follow this convention.
  const domain = env.EMPLOYEE_EMAIL_DOMAIN || "appdirect.com";
  // Allow per-name overrides via env: EMPLOYEE_EMAIL_OVERRIDE_<Name>=foo@bar
  // (e.g. `EMPLOYEE_EMAIL_OVERRIDE_KARTHIK_DAMAGALLA=k.damagalla@appdirect.com`).
  const overrideKey = `EMPLOYEE_EMAIL_OVERRIDE_${employeeName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")}`;
  if (env[overrideKey]) return env[overrideKey];

  const parts = employeeName.trim().toLowerCase().split(/\s+/);
  if (parts.length === 0) return "";
  if (parts.length === 1) return `${parts[0]}@${domain}`;
  // Take first + last; drop middle names so "Mohammed Akram Ahmed" → "mohammed.ahmed".
  const first = parts[0];
  const last = parts[parts.length - 1];
  return `${first}.${last}@${domain}`;
}

function getAppUrl(env: Record<string, string>): string {
  return env.WFH_APP_URL || "http://localhost:5173";
}

function dashboardLink(env: Record<string, string>): string {
  const base = getAppUrl(env).replace(/\/$/, "");
  return `${base}/#/wfh`;
}

function emailEscape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- Email templates -----------------------------------------------------
function approverNotificationEmail(
  req: WfhRequest,
  env: Record<string, string>,
): EmailPayload {
  const approverEmail = getApproverEmail(env);
  const days = dayCount(req.start_date, req.end_date);
  const range = formatDateRange(req.start_date, req.end_date);
  const link = dashboardLink(env);
  const submittedLocal = new Date(req.submitted_at).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const subject = `[WFH] New request from ${req.employee_name} — ${range} (${days} day${days === 1 ? "" : "s"})`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#172b4d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #dfe1e6;">
        <tr>
          <td style="background:#0747a6;color:#ffffff;padding:18px 24px;font-size:18px;font-weight:600;">
            🏠 New WFH request — needs your approval
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
            <p style="margin:0 0 16px;font-size:14px;color:#42526e;">
              <strong style="color:#172b4d">${emailEscape(req.employee_name)}</strong>
              has submitted a Work-From-Home request and is waiting for your decision.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr>
                <td style="padding:6px 0;color:#5e6c84;width:120px;">Employee</td>
                <td style="padding:6px 0;color:#172b4d;font-weight:500;">${emailEscape(req.employee_name)}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#5e6c84;">Dates</td>
                <td style="padding:6px 0;color:#172b4d;font-weight:500;">${emailEscape(range)} <span style="color:#5e6c84;font-weight:400;">(${days} day${days === 1 ? "" : "s"})</span></td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#5e6c84;">Submitted</td>
                <td style="padding:6px 0;color:#172b4d;">${emailEscape(submittedLocal)}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#5e6c84;">Request ID</td>
                <td style="padding:6px 0;color:#5e6c84;font-family:monospace;font-size:12px;">${emailEscape(req.id)}</td>
              </tr>
            </table>
            <div style="margin-top:18px;padding:12px 14px;border-left:3px solid #0747a6;background:#f4f5f7;border-radius:0 4px 4px 0;">
              <div style="font-size:12px;color:#5e6c84;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;">Reason</div>
              <div style="font-size:14px;color:#172b4d;white-space:pre-wrap;">${emailEscape(req.reason)}</div>
            </div>
            <div style="margin-top:24px;">
              <a href="${link}" style="display:inline-block;background:#0747a6;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:6px;font-size:14px;font-weight:600;">
                View in NOC Dashboard →
              </a>
            </div>
            <p style="margin:24px 0 0;font-size:12px;color:#5e6c84;">
              You're receiving this because you're the configured WFH approver. Reply to this email or open the dashboard to approve/deny.
            </p>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#97a0af;">NOC Operations Dashboard · WFH Requests</p>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `New WFH request — needs your approval`,
    ``,
    `${req.employee_name} has submitted a WFH request.`,
    ``,
    `Employee:  ${req.employee_name}`,
    `Dates:     ${range} (${days} day${days === 1 ? "" : "s"})`,
    `Submitted: ${submittedLocal}`,
    `Request ID: ${req.id}`,
    ``,
    `Reason:`,
    `${req.reason}`,
    ``,
    `View / decide: ${link}`,
    ``,
    `--`,
    `NOC Operations Dashboard`,
  ].join("\n");

  return { to: approverEmail, subject, html, text };
}

function employeeDecisionEmail(
  req: WfhRequest,
  env: Record<string, string>,
): EmailPayload | null {
  const employeeEmail = getEmployeeEmail(env, req.employee_name);
  if (!employeeEmail) return null;
  const days = dayCount(req.start_date, req.end_date);
  const range = formatDateRange(req.start_date, req.end_date);
  const link = dashboardLink(env);
  const approved = req.status === "approved";
  const verb = approved ? "approved" : "denied";
  const banner = approved
    ? { color: "#006644", bg: "#e3fcef", icon: "✅" }
    : { color: "#bf2600", bg: "#ffebe6", icon: "❌" };

  const subject = `[WFH] Your request for ${range} was ${verb}`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#172b4d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #dfe1e6;">
        <tr>
          <td style="background:${banner.bg};color:${banner.color};padding:18px 24px;font-size:18px;font-weight:600;">
            ${banner.icon} Your WFH request was ${verb}
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
            <p style="margin:0 0 16px;font-size:14px;color:#42526e;">
              Hi ${emailEscape(req.employee_name.split(/\s+/)[0])}, your Work-From-Home request has been <strong style="color:${banner.color};text-transform:lowercase;">${emailEscape(verb)}</strong>${req.reviewed_by ? ` by ${emailEscape(req.reviewed_by)}` : ""}.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr>
                <td style="padding:6px 0;color:#5e6c84;width:120px;">Dates</td>
                <td style="padding:6px 0;color:#172b4d;font-weight:500;">${emailEscape(range)} <span style="color:#5e6c84;font-weight:400;">(${days} day${days === 1 ? "" : "s"})</span></td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#5e6c84;">Status</td>
                <td style="padding:6px 0;color:${banner.color};font-weight:600;text-transform:capitalize;">${emailEscape(verb)}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#5e6c84;">Decided by</td>
                <td style="padding:6px 0;color:#172b4d;">${emailEscape(req.reviewed_by ?? "")}</td>
              </tr>
            </table>
            ${
              req.decision_note
                ? `<div style="margin-top:18px;padding:12px 14px;border-left:3px solid ${banner.color};background:#f4f5f7;border-radius:0 4px 4px 0;">
                <div style="font-size:12px;color:#5e6c84;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;">Note from approver</div>
                <div style="font-size:14px;color:#172b4d;white-space:pre-wrap;">${emailEscape(req.decision_note)}</div>
              </div>`
                : ""
            }
            <div style="margin-top:24px;">
              <a href="${link}" style="display:inline-block;background:#42526e;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:6px;font-size:14px;font-weight:600;">
                Open NOC Dashboard →
              </a>
            </div>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#97a0af;">NOC Operations Dashboard · WFH Requests</p>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Your WFH request was ${verb}`,
    ``,
    `Hi ${req.employee_name.split(/\s+/)[0]}, your Work-From-Home request was ${verb}${req.reviewed_by ? ` by ${req.reviewed_by}` : ""}.`,
    ``,
    `Dates:      ${range} (${days} day${days === 1 ? "" : "s"})`,
    `Status:     ${verb}`,
    `Decided by: ${req.reviewed_by ?? ""}`,
    req.decision_note ? `Note:       ${req.decision_note}` : "",
    ``,
    `Dashboard: ${link}`,
    ``,
    `--`,
    `NOC Operations Dashboard`,
  ]
    .filter(Boolean)
    .join("\n");

  return { to: employeeEmail, subject, html, text };
}

// ---- Plugin --------------------------------------------------------------
export function wfhProxyPlugin(): Plugin {
  let env: Record<string, string> = {};
  return {
    name: "wfh-proxy",
    configureServer(server) {
      env = loadEnv("development", process.cwd(), "");

      server.middlewares.use("/api/wfh/requests", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");

        try {
          const url = new URL(req.url ?? "/", "http://localhost");
          // Strip the /api/wfh/requests prefix; what remains is "" or "/:id"
          const path = url.pathname;
          const idMatch = /^\/?([A-Za-z0-9_-]+)$/.exec(path);
          const targetId = idMatch ? idMatch[1] : null;

          // ---- LIST -----------------------------------------------------
          if (req.method === "GET" && !targetId) {
            const viewer = url.searchParams.get("as");
            const store = await readStore();
            const approver = isApprover(viewer, env);
            const approverName = getApproverNames(env).join(", ");
            const filtered = approver
              ? store.requests
              : viewer
                ? store.requests.filter(
                    (r) =>
                      r.employee_name.trim().toLowerCase() ===
                      viewer.trim().toLowerCase(),
                  )
                : []; // unknown viewer sees nothing
            // Sort newest first
            const sorted = [...filtered].sort(
              (a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at),
            );
            res.statusCode = 200;
            res.end(
              JSON.stringify({
                requests: sorted,
                approver_name: approverName,
                is_approver: approver,
                viewer,
              }),
            );
            return;
          }

          // ---- SUBMIT ---------------------------------------------------
          if (req.method === "POST" && !targetId) {
            const body = await readJsonBody(req);
            const employee = String(body.employee_name ?? "").trim();
            const start = body.start_date;
            const end = body.end_date;
            const reason = String(body.reason ?? "").trim();
            if (!employee) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "employee_name is required" }));
              return;
            }
            if (!isValidDate(start) || !isValidDate(end)) {
              res.statusCode = 400;
              res.end(
                JSON.stringify({
                  error: "start_date and end_date must be YYYY-MM-DD",
                }),
              );
              return;
            }
            if (Date.parse(`${end}T00:00:00Z`) < Date.parse(`${start}T00:00:00Z`)) {
              res.statusCode = 400;
              res.end(
                JSON.stringify({ error: "end_date must be on or after start_date" }),
              );
              return;
            }
            if (reason.length < 3) {
              res.statusCode = 400;
              res.end(
                JSON.stringify({
                  error: "reason is required (at least 3 characters)",
                }),
              );
              return;
            }
            const store = await readStore();
            const days = dayCount(start, end);
            // Slack notification — best effort
            const approver = getApproverNames(env)[0] || "Anirudh Kukudala";
            const slackText = `WFH request for ${formatDateRange(start, end)} (${days} day${days === 1 ? "" : "s"}) — Reason: ${reason}.  cc <@${approver}>`;
            const slack = await postToSlack(env, slackText, {
              username: employee,
              icon_emoji: ":house:",
            });
            const now = new Date().toISOString();
            const newReq: WfhRequest = {
              id: shortId(),
              employee_name: employee,
              start_date: start,
              end_date: end,
              reason,
              status: "pending",
              submitted_at: now,
              reviewed_by: null,
              reviewed_at: null,
              decision_note: null,
              slack_message_ts: slack.ts ?? null,
            };
            store.requests.push(newReq);
            await writeStore(store);

            // Fire-and-forget email to the approver. We await it so we can
            // report the result in the response, but a failure here doesn't
            // block the request — the row is already persisted.
            const emailResult = await sendEmail(
              env,
              approverNotificationEmail(newReq, env),
            );

            res.statusCode = 200;
            res.end(
              JSON.stringify({
                request: newReq,
                slack_posted: slack.posted,
                email_sent: emailResult.sent,
                email_error: emailResult.error ?? null,
                approver_email: getApproverEmail(env),
              }),
            );
            return;
          }

          // ---- DECIDE (approver only) -----------------------------------
          if (req.method === "PATCH" && targetId) {
            const body = await readJsonBody(req);
            const reviewer = String(body.reviewer ?? "").trim();
            const decision = body.decision;
            const note =
              typeof body.note === "string" && body.note.trim()
                ? body.note.trim()
                : null;
            if (!isApprover(reviewer, env)) {
              res.statusCode = 403;
              res.end(
                JSON.stringify({
                  error: `Only the approver (${getApproverNames(env).join(", ")}) can decide requests.`,
                }),
              );
              return;
            }
            if (decision !== "approved" && decision !== "denied") {
              res.statusCode = 400;
              res.end(
                JSON.stringify({
                  error: "decision must be 'approved' or 'denied'",
                }),
              );
              return;
            }
            const store = await readStore();
            const idx = store.requests.findIndex((r) => r.id === targetId);
            if (idx < 0) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: "request not found" }));
              return;
            }
            const target = store.requests[idx];
            if (target.status !== "pending") {
              res.statusCode = 409;
              res.end(
                JSON.stringify({
                  error: `Request is already ${target.status}.`,
                }),
              );
              return;
            }
            target.status = decision;
            target.reviewed_by = reviewer;
            target.reviewed_at = new Date().toISOString();
            target.decision_note = note;
            await writeStore(store);
            // Slack thread reply
            const verb = decision === "approved" ? "Approved ✅" : "Denied ❌";
            const replyText = note
              ? `${verb} by ${reviewer}. Note: ${note}`
              : `${verb} by ${reviewer}.`;
            await postToSlack(env, replyText, {
              username: reviewer,
              icon_emoji: decision === "approved" ? ":white_check_mark:" : ":x:",
              thread_ts: target.slack_message_ts ?? undefined,
            });

            // Email the employee with the decision (unless disabled).
            const notifyEmployee =
              (env.WFH_NOTIFY_EMPLOYEE_ON_DECISION ?? "true").toLowerCase() !==
              "false";
            let employeeEmailResult: { sent: boolean; error?: string } = {
              sent: false,
              error: "disabled",
            };
            if (notifyEmployee) {
              const tpl = employeeDecisionEmail(target, env);
              if (tpl) employeeEmailResult = await sendEmail(env, tpl);
            }

            res.statusCode = 200;
            res.end(
              JSON.stringify({
                request: target,
                email_sent: employeeEmailResult.sent,
                email_error: employeeEmailResult.error ?? null,
                employee_email: notifyEmployee
                  ? getEmployeeEmail(env, target.employee_name)
                  : null,
              }),
            );
            return;
          }

          res.statusCode = 405;
          res.setHeader("Allow", "GET, POST, PATCH");
          res.end(JSON.stringify({ error: "Method not allowed" }));
        } catch (err) {
          console.error("[wfh-proxy] error:", err);
          res.statusCode = 500;
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });
    },
  };
}
