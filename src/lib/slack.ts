// Slack client — POST-ONLY.
//
// The Break Tracker widget posts break-start and break-end messages to
// #noc-team via the Vite dev proxy at /api/slack/post. There is no longer a
// read path — the widget tracks active breaks from the Supabase-backed API. This
// drops the bot's scope requirements down to just `chat:write` (plus the
// optional `chat:write.customize` to post under each teammate's name).

export interface SlackPostResult {
  posted: boolean;
  demo?: boolean;
  ts?: string;
  channel?: string;
  text?: string;
  thread_ts?: string | null;
  warning?: string;
  error?: string;
}

export interface SlackPostOptions {
  /** Optional thread parent ts to reply in-thread. */
  thread_ts?: string | null;
  /**
   * Override the displayed sender name on Slack. Requires the bot to have the
   * `chat:write.customize` OAuth scope. If omitted, Slack falls back to the
   * bot's installed name.
   */
  username?: string;
  /** e.g. ":lunch:" — appears in place of the bot's avatar. */
  icon_emoji?: string;
}

export async function postSlackMessage(
  text: string,
  thread_tsOrOptions?: string | null | SlackPostOptions,
  legacyOptions?: SlackPostOptions,
): Promise<SlackPostResult> {
  // Backwards-compatible call signatures:
  //   postSlackMessage(text)
  //   postSlackMessage(text, "thread_ts")
  //   postSlackMessage(text, { thread_ts, username, icon_emoji })
  let opts: SlackPostOptions = {};
  if (typeof thread_tsOrOptions === "string" || thread_tsOrOptions === null) {
    opts = { thread_ts: thread_tsOrOptions, ...(legacyOptions ?? {}) };
  } else if (thread_tsOrOptions && typeof thread_tsOrOptions === "object") {
    opts = thread_tsOrOptions;
  }

  const payload: Record<string, unknown> = { text };
  if (opts.thread_ts) payload.thread_ts = opts.thread_ts;
  if (opts.username) payload.username = opts.username;
  if (opts.icon_emoji) payload.icon_emoji = opts.icon_emoji;

  const r = await fetch("/api/slack/post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = (await r.json()) as SlackPostResult;
  if (!r.ok && !j.error) {
    throw new Error(`Slack post failed: ${r.status}`);
  }
  return j;
}

/**
 * Slack `icon_emoji` value (with surrounding colons) for each break type.
 * Makes #noc-team messages visually distinct per break category.
 */
export const SLACK_BREAK_EMOJI: Record<string, string> = {
  Coffee: ":coffee:",
  Lunch: ":fork_and_knife:",
  Dinner: ":crescent_moon:",
  Restroom: ":toilet:",
  Personal: ":hourglass_flowing_sand:",
  Other: ":hourglass_flowing_sand:",
  Back: ":arrow_backward:",
};

export function emojiForBreak(breakType: string): string {
  return SLACK_BREAK_EMOJI[breakType] ?? ":hourglass_flowing_sand:";
}

/**
 * Format a break-start message in the style of #noc-team posts. The bot
 * sends this text verbatim to Slack via chat.postMessage.
 */
export function formatBreakStartMessage(breakType: string): string {
  switch (breakType) {
    case "Coffee":
      return "BRB - Coffee";
    case "Lunch":
      return "Lunch";
    case "Dinner":
      return "Dinner";
    case "Restroom":
      return "Bio";
    case "Personal":
      return "BRB";
    case "Other":
      return "BRB";
    default:
      return breakType;
  }
}

/**
 * Display color for each manual break type. Kept aligned with the previous
 * Slack-side colors so the visual language across the dashboard is consistent.
 */
export const BREAK_TYPE_COLORS: Record<string, string> = {
  Coffee: "yellow",
  Lunch: "orange",
  Dinner: "red",
  Restroom: "blue",
  Personal: "grape",
  Other: "gray",
};
