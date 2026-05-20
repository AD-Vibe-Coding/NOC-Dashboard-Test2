// Client-side types + fetchers for the Work Activity widget.
//
// Surface today's per-user activity in #noc-team (tickets worked / updated /
// acknowledged + assignments received) plus Zoom Phone call counts. All real
// API calls happen server-side in the Vite middleware plugins.

import { fetchJson } from "./fetch-resilient";

export interface UserActivity {
  user: string;
  worked_tickets: string[];
  updated_tickets: string[];
  acked_tickets: string[];
  assignments_received: Array<{ ticket: string; priority?: string; from: string }>;
  assignments_made: Array<{ ticket: string; priority?: string; to: string }>;
  message_count: number;
}

export interface WorkActivityResponse {
  source: "live" | "snapshot";
  channel: string;
  channel_id: string;
  day_start: string;
  fetched_at: string;
  user_count: number;
  message_count: number;
  ticket_event_count: number;
  by_user: Record<string, UserActivity>;
  warning: string | null;
}

export async function fetchWorkActivity(): Promise<WorkActivityResponse> {
  return fetchJson<WorkActivityResponse>("/api/slack/work-activity");
}

export interface CallsTodayUser {
  answered: number;
  missed: number;
  total_minutes: number;
}

export interface CallsTodayResponse {
  source: "live" | "snapshot";
  fetched_at: string;
  day_start: string;
  by_user: Record<string, CallsTodayUser>;
  warning: string | null;
}

export async function fetchCallsToday(): Promise<CallsTodayResponse> {
  return fetchJson<CallsTodayResponse>("/api/zoom/calls-today");
}

/**
 * Combined per-user metrics — used as a "primary key" for the widget. If the
 * Slack response is missing a user, defaults to zeros. Same for Zoom.
 */
export interface MyDayMetrics {
  user: string;
  // From Slack
  worked: number;
  updated: number;
  acked: number;
  assignments_received: number;
  message_count: number;
  // From Zoom
  calls_answered: number;
  calls_missed: number;
  call_minutes: number;
  // Raw rows for the detailed view
  worked_tickets: string[];
  updated_tickets: string[];
  acked_tickets: string[];
  assignments_received_list: Array<{ ticket: string; priority?: string; from: string }>;
}

export function buildMyDayMetrics(
  user: string,
  slack: WorkActivityResponse | null,
  calls: CallsTodayResponse | null,
): MyDayMetrics {
  const ua = slack?.by_user[user];
  const cu = calls?.by_user[user];
  return {
    user,
    worked: ua?.worked_tickets.length ?? 0,
    updated: ua?.updated_tickets.length ?? 0,
    acked: ua?.acked_tickets.length ?? 0,
    assignments_received: ua?.assignments_received.length ?? 0,
    message_count: ua?.message_count ?? 0,
    calls_answered: cu?.answered ?? 0,
    calls_missed: cu?.missed ?? 0,
    call_minutes: cu?.total_minutes ?? 0,
    worked_tickets: ua?.worked_tickets ?? [],
    updated_tickets: ua?.updated_tickets ?? [],
    acked_tickets: ua?.acked_tickets ?? [],
    assignments_received_list: ua?.assignments_received ?? [],
  };
}

/**
 * Best-effort fuzzy lookup of a user's activity from the live data. Slack
 * resolves names from `users.info` so they may not exactly match the NOC
 * roster casing/spacing. Try exact first, then case-insensitive substring.
 */
export function findUserActivity(
  user: string,
  slack: WorkActivityResponse | null,
): { matched: string | null; activity: UserActivity | null } {
  if (!slack) return { matched: null, activity: null };
  if (slack.by_user[user]) return { matched: user, activity: slack.by_user[user] };
  const target = user.toLowerCase();
  // Try first-name match if the user picked a casual identity
  const candidates = Object.keys(slack.by_user);
  const exactFirst = candidates.find((c) => c.toLowerCase() === target);
  if (exactFirst) return { matched: exactFirst, activity: slack.by_user[exactFirst] };
  const partial = candidates.find(
    (c) =>
      c.toLowerCase().includes(target) ||
      target.includes(c.toLowerCase().split(/\s+/)[0]),
  );
  if (partial) return { matched: partial, activity: slack.by_user[partial] };
  return { matched: null, activity: null };
}

export function findCallsForUser(
  user: string,
  calls: CallsTodayResponse | null,
): CallsTodayUser | null {
  if (!calls) return null;
  if (calls.by_user[user]) return calls.by_user[user];
  const target = user.toLowerCase();
  const partial = Object.keys(calls.by_user).find(
    (c) =>
      c.toLowerCase() === target ||
      c.toLowerCase().includes(target) ||
      target.includes(c.toLowerCase().split(/\s+/)[0]),
  );
  return partial ? calls.by_user[partial] : null;
}
