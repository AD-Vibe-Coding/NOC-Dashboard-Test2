const OVERNIGHT_CARRY_SLOTS = new Set(["S1", "S2"]);
const MINIMUM_REMAINING_MINUTES = 45;

function remainingMinutesAtPost(member, postMinutes) {
  const start = Number(member?.shiftWindow?.start);
  const end = Number(member?.shiftWindow?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(postMinutes) || start <= end) {
    return Number.NEGATIVE_INFINITY;
  }
  const normalizedEnd = end + 24 * 60;
  const normalizedPost = postMinutes < start ? postMinutes + 24 * 60 : postMinutes;
  return normalizedEnd - normalizedPost;
}

/**
 * Carry yesterday's overnight S6 roster entries into today's S1/S2 planning
 * window, replacing a matching WO/off row for the worker whose shift spans
 * midnight. The caller supplies the slot's post time so the carryover expires
 * naturally once there is less than 45 minutes left in the overnight shift.
 */
export function mergeOvernightS6Carryover(roster, previousDayS6Members = [], slot, postMinutes) {
  if (!roster || !OVERNIGHT_CARRY_SLOTS.has(slot)) return roster;

  const members = [...(roster.members ?? [])];
  const indexByName = new Map(members.map((member, index) => [String(member.name ?? "").trim(), index]));
  let changed = false;

  for (const previousMember of previousDayS6Members) {
    if (previousMember?.shiftCode !== "S6") continue;
    if (remainingMinutesAtPost(previousMember, postMinutes) < MINIMUM_REMAINING_MINUTES) continue;

    const name = String(previousMember.name ?? "").trim();
    if (!name) continue;
    const currentIndex = indexByName.get(name);
    const currentMember = currentIndex === undefined ? null : members[currentIndex];

    // A real assignment on today's roster wins. A blank/off marker does not
    // cancel the still-active overnight shift from yesterday.
    if (currentMember?.shiftCode && !currentMember.offReason) continue;

    const carryover = { ...previousMember, offReason: null };
    if (currentIndex === undefined) {
      indexByName.set(name, members.length);
      members.push(carryover);
    } else {
      members[currentIndex] = carryover;
    }
    changed = true;
  }

  return changed ? { ...roster, members } : roster;
}
