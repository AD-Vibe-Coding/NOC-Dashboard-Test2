/**
 * POST /api/slack/post
 *
 * Production serverless handler for Slack chat.postMessage.
 * Supports chat:write.customize — sends username + icon_emoji so each
 * team member's break posts appear under their own name in Slack.
 *
 * Body: { text, username?, icon_emoji?, thread_ts?, target_user_id? }
 *
 * Strategy:
 *   1. Try with username + icon_emoji (requires chat:write.customize scope)
 *   2. If Slack rejects with missing_scope / not_allowed_token_type,
 *      retry with name prefixed into the text body (graceful fallback)
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

const CHANNEL_ID   = process.env.SLACK_CHANNEL_ID   ?? "C09Q89PHN8M";
const CHANNEL_NAME = process.env.SLACK_CHANNEL_NAME ?? "noc-team";

const SCOPE_ERRORS = new Set([
  "missing_scope",
  "not_allowed_token_type",
  "invalid_arg_name",
  "not_authed",
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ posted: false, error: "Method not allowed" });
  }

  const body       = (req.body ?? {}) as Record<string, unknown>;
  const text       = String(body.text ?? "").trim();
  const username   = body.username   ? String(body.username).trim()   : undefined;
  const icon_emoji = body.icon_emoji ? String(body.icon_emoji).trim() : undefined;
  const thread_ts      = body.thread_ts      ? String(body.thread_ts)      : undefined;
  const target_user_id = body.target_user_id ? String(body.target_user_id) : undefined;

  if (!text) return res.status(400).json({ posted: false, error: "text is required" });

  const token = String(process.env.SLACK_BOT_TOKEN ?? "").trim();

  // No token → demo mode (log to console, return fake ts)
  if (!token || !token.startsWith("xoxb-")) {
    const fakeTs = `demo-${Date.now()}.${Math.floor(Math.random() * 1_000_000)}`;
    console.log(
      `[slack/post] DEMO — would post to #${CHANNEL_NAME}` +
      (username ? ` as "${username}"` : "") +
      `: "${text}"`,
    );
    return res.status(200).json({
      posted: false,
      demo: true,
      ts: fakeTs,
      channel: CHANNEL_NAME,
      text,
      thread_ts: thread_ts ?? null,
      warning: "SLACK_BOT_TOKEN not set — message logged but NOT sent to Slack.",
    });
  }

  const wantCustomize = !!(username || icon_emoji);
  const fallbackText  = username ? `${username}: ${text}` : text;

  async function openDmChannel(userId: string) {
    const r = await fetch("https://slack.com/api/conversations.open", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ users: userId }),
    });
    return r.json() as Promise<{ ok: boolean; error?: string; channel?: { id?: string } }>;
  }

  async function postOnce(withCustomize: boolean, channelId: string) {
    const msgText = withCustomize ? text : fallbackText;
    const payload: Record<string, unknown> = { channel: channelId, text: msgText };
    if (thread_ts) payload.thread_ts = thread_ts;
    if (withCustomize) {
      if (username)   payload.username   = username;
      if (icon_emoji) payload.icon_emoji = icon_emoji;
    }
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return r.json() as Promise<{ ok: boolean; ts?: string; error?: string }>;
  }

  try {
    let targetChannelId = CHANNEL_ID;
    let targetLabel = CHANNEL_NAME;

    if (target_user_id) {
      const dm = await openDmChannel(target_user_id);
      if (!dm.ok || !dm.channel?.id) {
        return res.status(502).json({
          posted: false,
          error: dm.error ?? "Could not open DM channel",
          warning: `Failed to open DM with user ${target_user_id}. No channel fallback was used.`,
        });
      }
      targetChannelId = dm.channel.id;
      targetLabel = `dm:${target_user_id}`;
    }

    let j = await postOnce(wantCustomize, targetChannelId);
    let customizeDenied = false;

    // If scope missing, retry with name in text body
    if (!j.ok && wantCustomize && j.error && SCOPE_ERRORS.has(j.error)) {
      console.warn(`[slack/post] chat:write.customize denied (${j.error}) — retrying with prefixed text. Reinstall the Slack app to activate the scope.`);
      customizeDenied = true;
      j = await postOnce(false, targetChannelId);
    }

    if (!j.ok) {
      console.error(`[slack/post] Slack error: ${j.error}`);
      return res.status(502).json({ posted: false, error: j.error ?? "Slack rejected the message" });
    }

    return res.status(200).json({
      posted: true,
      demo: false,
      ts: j.ts,
      channel: targetLabel,
      text: customizeDenied ? fallbackText : text,
      thread_ts: thread_ts ?? null,
      warning: customizeDenied
        ? "Bot lacks chat:write.customize — emoji/name prefixed in message body. Reinstall the Slack app to restore custom avatar/name."
        : undefined,
    });
  } catch (err) {
    console.error("[slack/post] exception:", err);
    return res.status(502).json({
      posted: false,
      error: err instanceof Error ? err.message : "Network error reaching Slack",
    });
  }
}
