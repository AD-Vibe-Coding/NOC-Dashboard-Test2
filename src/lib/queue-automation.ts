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

async function setQueueCalls(employeeName: string, enabled: boolean) {
  const result = await toggleRingCentralQueueCalls(employeeName, enabled);
  return result.message ?? (enabled ? "RingCentral queue calls turned on." : "RingCentral queue calls turned off.");
}

/** Apply punch changes to the affected employee's extension; the API enforces the authorized roster. */
export async function syncQueueCallsForPunch(
  _actorName: string,
  affectedName: string,
  action: PunchAction,
): Promise<QueueAutomationResult | null> {
  let enabled = action === "punch_in";
  let activeBreakRemains = false;
  if (enabled) {
    const activeBreaks = await db.breaks.list({ filter: { is_active: true } });
    activeBreakRemains = activeBreaks.some((row) => samePerson(row.employee_name, affectedName));
    if (activeBreakRemains) enabled = false;
  }

  const message = await setQueueCalls(affectedName, enabled);
  return {
    enabled,
    message: action === "punch_in" && activeBreakRemains
      ? "Punch-in saved, but queue calls remain off while the employee's break is active."
      : message,
  };
}

/** A break keeps the affected employee's queues off; returning enables them only while punched in and free of other active breaks. */
export async function syncQueueCallsForBreak(
  _actorName: string,
  affectedName: string,
  action: BreakAction,
): Promise<QueueAutomationResult | null> {
  if (action === "start") {
    return { enabled: false, message: await setQueueCalls(affectedName, false) };
  }

  const [punchRows, activeBreaks] = await Promise.all([
    db.punch_events.list({
      filter: { employee_name: affectedName },
      orderBy: { column: "punched_at", ascending: false },
      limit: 1,
    }),
    db.breaks.list({ filter: { is_active: true } }),
  ]);
  const punchedIn = punchRows[0]?.action === "punch_in";
  const anotherBreakActive = activeBreaks.some((row) => samePerson(row.employee_name, affectedName));
  const enabled = punchedIn && !anotherBreakActive;
  const message = await setQueueCalls(affectedName, enabled);

  return {
    enabled,
    message: !punchedIn
      ? "Break ended, but queue calls remain off until the employee is punched in."
      : anotherBreakActive
        ? "Queue calls remain off because another break is still active."
        : message,
  };
}
