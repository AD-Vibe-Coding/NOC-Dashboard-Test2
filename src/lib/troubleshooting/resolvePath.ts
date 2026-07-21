import type { CarrierId, DeviceFamily, TroubleshootPath } from "./types";

/**
 * Pick the best path for issue + carrier + device.
 *
 * Priority (highest first):
 *   1. issue + carrier + device
 *   2. issue + carrier + any
 *   3. issue + generic + device
 *   4. issue + generic + any
 */
export function resolvePath(
  paths: TroubleshootPath[],
  issueId: string,
  carrier: CarrierId,
  device: DeviceFamily,
): TroubleshootPath | null {
  const candidates = paths.filter((p) => p.issueId === issueId);

  const scoreOf = (p: TroubleshootPath): number => {
    let score = 0;

    if (p.carrier === carrier) score += 10;
    else if (p.carrier === "generic") score += 1;
    else return -1;

    if (p.deviceFamily === device) score += 5;
    else if (p.deviceFamily === "any") score += 1;
    else return -1;

    return score;
  };

  const ranked = candidates
    .map((p) => ({ p, score: scoreOf(p) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.p ?? null;
}

/** Returns validation errors (empty array = valid). */
export function validatePath(path: TroubleshootPath): string[] {
  const errors: string[] = [];
  if (!path.steps.length) errors.push(`${path.id}: no steps`);

  path.steps.forEach((s, i) => {
    if (s.order !== i + 1) {
      errors.push(
        `${path.id}: step[${i}] order is ${s.order}, expected ${i + 1}`,
      );
    }
    if (!s.id?.trim()) errors.push(`${path.id}: step[${i}] missing id`);
    if (!s.title?.trim()) errors.push(`${path.id}: step[${i}] missing title`);
    if (!s.instructions?.length) {
      errors.push(`${path.id}: step[${i}] needs at least one instruction`);
    }
  });

  const ids = path.steps.map((s) => s.id);
  if (new Set(ids).size !== ids.length) {
    errors.push(`${path.id}: duplicate step ids`);
  }

  return errors;
}

export function validateAllPaths(paths: TroubleshootPath[]): string[] {
  return paths.flatMap(validatePath);
}
