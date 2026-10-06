function fairnessScoreFor(name, fairness, slot = null) {
  const member = fairness.byName.get(name);
  if (!member) return 0;
  const total = Number(member.score ?? member.hours ?? 0);
  const groupKey = slot === "S3" || slot === "S4" || slot === "S4.1" || slot === "S4.2"
    ? "day-swing"
    : slot === "S5"
      ? "late-evening"
      : slot
        ? "overnight-early"
        : null;
  if (!groupKey) return total;
  const groupScore = Number(member.groupScores?.get(groupKey) ?? 0);
  return Math.max(groupScore, total);
}

function sortByFairness(members, fairness, slot = null) {
  return [...members].sort((a, b) => {
    const ah = fairnessScoreFor(a.name, fairness, slot);
    const bh = fairnessScoreFor(b.name, fairness, slot);
    return ah - bh || a.name.localeCompare(b.name);
  });
}

function allowedRollingSourcesForSlot(slot) {
  const allowedTransitions = {
    S2: ["S1", "S6"],
    S3: ["S1", "S2", "S6"],
    S4: ["S1", "S2", "S3"],
    "S4.1": ["S2"],
    "S4.2": ["S3"],
    S5: ["S4", "S4.1", "S4.2"],
    S6: ["S5"],
  };
  return allowedTransitions[slot] ?? [];
}

function isAllowedRollingHandoff(previousSlot, nextSlot) {
  return Boolean(previousSlot && allowedRollingSourcesForSlot(nextSlot).includes(previousSlot));
}

function preferredPrimaryPoolForSlot(slot, eligible) {
  if (slot === "S1") {
    const s6Pool = eligible.filter((member) => member.shiftCode === "S6");
    const s1Pool = eligible.filter((member) => member.shiftCode === "S1");
    if (s6Pool.length > 0 && s1Pool.length > 0) return [...s6Pool, ...s1Pool];
    if (s6Pool.length > 0) return s6Pool;
    return s1Pool;
  }
  if (slot === "S2") {
    const s2Pool = eligible.filter((member) => member.shiftCode === "S2");
    if (s2Pool.length > 0) return s2Pool;
    const s6Pool = eligible.filter((member) => member.shiftCode === "S6");
    const s1Pool = eligible.filter((member) => member.shiftCode === "S1");
    if (s6Pool.length > 0) return s6Pool;
    return s1Pool;
  }
  return eligible;
}

function shouldCarryPrimaryForSlot({ slot, previousPrimary, previousSlot, eligible, fairness }) {
  if (!previousPrimary || !previousSlot || !isAllowedRollingHandoff(previousSlot, slot)) return false;
  const carriedMember = eligible.find((member) => member.name === previousPrimary);
  if (!carriedMember) return false;

  if (slot === "S2") {
    const nativeS2Pool = eligible.filter((member) => member.name !== previousPrimary && member.shiftCode === "S2");
    if (nativeS2Pool.length > 0) {
      const previousScore = Math.max(
        fairnessScoreFor(previousPrimary, fairness, previousSlot),
        fairnessScoreFor(previousPrimary, fairness, slot),
        fairnessScoreFor(previousPrimary, fairness, null),
      );
      const bestCandidate = sortByFairness(nativeS2Pool, fairness, slot)[0];
      const minScore = bestCandidate ? fairnessScoreFor(bestCandidate.name, fairness, slot) : Number.POSITIVE_INFINITY;
      return previousScore < minScore;
    }
    if (carriedMember.shiftCode === "S6") {
      const directHandoffPool = eligible.filter((member) => member.name !== previousPrimary && (member.shiftCode === "S1" || member.shiftCode === "S2"));
      return directHandoffPool.length === 0;
    }
    const others = eligible.filter((member) => member.name !== previousPrimary);
    if (others.length === 0) return true;
    const previousScoreNoS2 = Math.max(
      fairnessScoreFor(previousPrimary, fairness, previousSlot),
      fairnessScoreFor(previousPrimary, fairness, slot),
      fairnessScoreFor(previousPrimary, fairness, null),
    );
    const bestOther = sortByFairness(others, fairness, slot)[0];
    const otherScore = bestOther ? fairnessScoreFor(bestOther.name, fairness, slot) : Number.POSITIVE_INFINITY;
    return previousScoreNoS2 < otherScore;
  }
  if (slot === "S3") {
    const nativeS3Pool = eligible.filter((member) => member.name !== previousPrimary && member.shiftCode === "S3");
    const comparisonPool = nativeS3Pool.length > 0
      ? nativeS3Pool
      : eligible.filter((member) => member.name !== previousPrimary);
    if (comparisonPool.length === 0) return true;
    const previousScore = Math.max(
      fairnessScoreFor(previousPrimary, fairness, previousSlot),
      fairnessScoreFor(previousPrimary, fairness, slot),
      fairnessScoreFor(previousPrimary, fairness, null),
    );
    const bestCandidate = sortByFairness(comparisonPool, fairness, slot)[0] ?? null;
    const minScore = bestCandidate ? fairnessScoreFor(bestCandidate.name, fairness, slot) : Number.POSITIVE_INFINITY;
    return previousScore < minScore;
  }
  return false;
}

function choosePrimaryForSlot({ slot, availableMembers, fairness, previousPrimary = null, previousSlot = null }) {
  const eligible = sortByFairness(availableMembers, fairness, slot);
  if (shouldCarryPrimaryForSlot({ slot, previousPrimary, previousSlot, eligible, fairness })) {
    return { primary: previousPrimary, carried: true };
  }
  const slotPrimaryEligible = preferredPrimaryPoolForSlot(slot, eligible);
  const primaryPool = sortByFairness(slotPrimaryEligible.length > 0 ? slotPrimaryEligible : eligible, fairness, slot);
  return { primary: primaryPool[0]?.name ?? null, carried: false };
}

const members = [
  { name: "Mohammed Ashraf", shiftCode: "S1" },
  { name: "Sriram Parisa", shiftCode: "S6" },
  { name: "Karthik Damagalla", shiftCode: "S2" },
  { name: "Hamza Rahmani", shiftCode: "S3" },
];

function fairnessRow(hours) {
  return {
    score: hours,
    hours,
    groupScores: new Map([
      ["overnight-early", hours],
      ["day-swing", 0],
      ["late-evening", 0],
    ]),
  };
}

const byName = new Map(members.map((m) => [m.name, fairnessRow(m.name === "Mohammed Ashraf" ? 8 : 0)]));
const fairness = { byName };

const s1 = choosePrimaryForSlot({ slot: "S1", availableMembers: members.filter((m) => ["S1", "S6"].includes(m.shiftCode)), fairness });
const s2 = choosePrimaryForSlot({
  slot: "S2",
  availableMembers: members.filter((m) => ["S1", "S2", "S6"].includes(m.shiftCode)),
  fairness,
  previousPrimary: s1.primary,
  previousSlot: "S1",
});
const s3 = choosePrimaryForSlot({
  slot: "S3",
  availableMembers: members.filter((m) => ["S1", "S2", "S3", "S6"].includes(m.shiftCode)),
  fairness,
  previousPrimary: s2.primary,
  previousSlot: "S2",
});

console.log({ s1, s2, s3 });
if (s1.primary !== "Sriram Parisa") throw new Error("S1 should be S5.1 Sriram");
if (s2.primary !== "Karthik Damagalla") throw new Error("S2 should hand off to Karthik");
if (s3.primary !== "Hamza Rahmani") throw new Error("S3 should hand off to Hamza");
console.log("PASS");
