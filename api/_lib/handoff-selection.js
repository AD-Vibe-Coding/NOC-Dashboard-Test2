export function selectS5HandoffPool(s6Pool = []) {
  return { pool: s6Pool, targetSlot: "S6" };
}

export function selectS6HandoffPool(s1Pool = [], s6Pool = []) {
  if (s1Pool.length > 0) return { pool: s1Pool, targetSlot: "S1" };
  return { pool: s6Pool, targetSlot: s6Pool.length > 0 ? "S6" : "S1" };
}

export function selectHandoffCandidatePool(shiftCodes = [], byShift = new Map()) {
  return shiftCodes
    .flatMap((code) => byShift.get(code) ?? [])
    .filter((member, index, all) => all.findIndex((entry) => entry.name === member.name) === index)
    .filter((member) => !member.asrhRestricted);
}

export function selectNextHandoffRecipient(nextCandidates = []) {
  return nextCandidates[0]?.name ?? null;
}
