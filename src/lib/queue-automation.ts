import { db } from "../db";
import { resolveTeamMember } from "../widgets/PerformanceTracker/team";
import { toggleRingCentralQueueCalls } from "./ringcentral";

type PunchAction = "punch_in" | "punch_out";
type BreakAction = "start" | "back";

export type QueueAutomationResult = {
  enabled: boolean;
  message: string;
};

function samePerson(a?: string | null, b?: string | null) {
  const left = a ? (resolveTeamMember(a) ?? a).trim().toLowerCase() : "";
  const right = b ? (resolveTeamMember(b) ?? b).trim().toLowerCase() : "";
  return !!left && !!right && left === right;
}

async function setQueueCalls(actorName: string, enabled: boolean) {
  const result = await toggleRingCentralQueueCalls(actorName, enabled);
  return result.message ?? (enabled ? "RingCentral queue calls turned on." : "RingCentral queue calls turned off.");
}

/** Sync only self-service actions; the server independently scopes the request to the signed-in extension. */
export async function syncQueueCallsForPunch(
  actorName: string,
  affectedName: string,
  action: PunchAction,
): Promise<QueueAutomationResult | null> {
  if (!samePerson(actorName, affectedName)) return null;

  let enabled = action === "punch_in";
  let activeBreakRemains = false;
  if (enabled) {
    const activeBreaks = await db.breaks.list({ filter: { is_active: true } });
    activeBreakRemains = activeBreaks.some((row) => samePerson(row.employee_name, actorName));
    if (activeBreakRemains) enabled = false;
  }

  const message = await setQueueCalls(actorName, enabled);
  return {
    enabled,
    message: action === "punch_in" && activeBreakRemains
      ? "Punch-in saved, but queue calls remain off while your break is active."
      : message,
  };
}

/** A break keeps queues off; returning enables them only while punched in and free of other active breaks. */
export async function syncQueueCallsForBreak(
  actorName: string,
  affectedName: string,
  action: BreakAction,
): Promise<QueueAutomationResult | null> {
  if (!samePerson(actorName, affectedName)) return null;
  if (action === "start") {
    return { enabled: false, message: await setQueueCalls(actorName, false) };
  }

  const [actorPunchRows, affectedPunchRows, activeBreaks] = await Promise.all([
    db.punch_events.list({
      filter: { employee_name: actorName },
      orderBy: { column: "punched_at", ascending: false },
      limit: 1,
    }),
    db.punch_events.list({
      filter: { employee_name: affectedName },
      orderBy: { column: "punched_at", ascending: false },
      limit: 1,
    }),
    db.breaks.list({ filter: { is_active: true } }),
  ]);
  const latestPunch = [...actorPunchRows, ...affectedPunchRows]
    .sort((a, b) => new Date(b.punched_at).getTime() - new Date(a.punched_at).getTime())[0];
  const punchedIn = latestPunch?.action === "punch_in";
  const anotherBreakActive = activeBreaks.some((row) => samePerson(row.employee_name, actorName));
  const enabled = punchedIn && !anotherBreakActive;
  const message = await setQueueCalls(actorName, enabled);

  return {
    enabled,
    message: !punchedIn
      ? "Back recorded, but queue calls remain off until you Punch In."
      : anotherBreakActive
        ? "Queue calls remain off because another break is still active."
        : message,
  };
}
