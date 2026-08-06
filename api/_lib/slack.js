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
  const payload = {
    channel: opts.channel || CHANNEL_ID,
    text,
    ...(opts.thread_ts ? { thread_ts: opts.thread_ts } : {}),
    ...(opts.username ? { username: opts.username } : {}),
    ...(opts.icon_emoji ? { icon_emoji: opts.icon_emoji } : {}),
  };
  try {
    let r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let j = await r.json();
    // Retry without username/icon if scope missing
    if (!j.ok && (j.error === "missing_scope" || j.error === "not_allowed_token_type")) {
      const retry = { channel: CHANNEL_ID, text };
      if (opts.thread_ts) retry.thread_ts = opts.thread_ts;
      r = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(retry),
      });
      j = await r.json();
    }
    if (!j.ok) {
      console.warn(`[slack] post error: ${j.error}`);
      return { posted: false, ts: null };
    }
    return { posted: true, ts: j.ts ?? null };
  } catch (err) {
    console.warn("[slack] post exception:", err?.message);
    return { posted: false, ts: null };
  }
}
