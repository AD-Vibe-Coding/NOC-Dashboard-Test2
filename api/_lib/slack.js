import "dotenv/config";

/**
 * Minimal Slack chat.postMessage helper for API routes.
 * Returns { ts, posted } — never throws.
 */

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || "C09Q89PHN8M";

export async function postSlackMessage(text, opts = {}) {
  const token = process.env.SLACK_BOT_TOKEN ?? "";
  if (!token || !token.startsWith("xoxb-")) {
    console.log(`[slack] (no token) would post: "${text.slice(0, 80)}"`);
    return { posted: false, ts: null, demo: true };
  }

  const channel = opts.channel || CHANNEL_ID;
  const wantCustomize = Boolean(opts.username || opts.icon_emoji);
  const fallbackText = opts.username ? `${opts.username}: ${text}` : text;

  async function postOnce(withCustomize) {
    const payload = {
      channel,
      text: withCustomize ? text : fallbackText,
      ...(opts.thread_ts ? { thread_ts: opts.thread_ts } : {}),
      ...(withCustomize && opts.username ? { username: opts.username } : {}),
      ...(withCustomize && opts.icon_emoji ? { icon_emoji: opts.icon_emoji } : {}),
    };

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  }

  try {
    let j = await postOnce(wantCustomize);
    let customizeDenied = false;

    if (!j.ok && wantCustomize && (j.error === "missing_scope" || j.error === "not_allowed_token_type" || j.error === "invalid_arg_name" || j.error === "not_authed")) {
      customizeDenied = true;
      j = await postOnce(false);
    }

    if (!j.ok) {
      console.warn(`[slack] post error: ${j.error}`);
      return { posted: false, ts: null, error: j.error ?? "slack_post_failed" };
    }

    return {
      posted: true,
      ts: j.ts ?? null,
      warning: customizeDenied
        ? "Bot lacks chat:write.customize — name was prefixed into the message body instead."
        : undefined,
    };
  } catch (err) {
    console.warn("[slack] post exception:", err?.message);
    return { posted: false, ts: null, error: err?.message ?? "slack_post_exception" };
  }
}
