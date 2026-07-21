// Client helpers for the Mobility Troubleshooter.
// Live Confluence OPUS workflow + bundled offline fallback.

export type {
  DeviceSteps,
  MobilityIssueGuide,
  MobilityResponse,
} from "./mobility-guides";

import { fetchJson } from "./fetch-resilient";
import type { DeviceSteps, MobilityResponse } from "./mobility-guides";

export async function fetchMobilityGuides(
  signal?: AbortSignal,
): Promise<MobilityResponse> {
  // Cache-bust + no-store: a previous "bundled · 51 issues" response was
  // sticking in the browser/proxy even after the API started returning live.
  const url = `/api/confluence/mobility?ts=${Date.now()}&n=${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  return fetchJson<MobilityResponse>(
    url,
    {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
      },
      signal,
    },
    { signal, retries: 5, baseDelayMs: 250 },
  );
}

/** Device options shown after an issue is selected. */
export type DeviceKey =
  | "iphone"
  | "ipad"
  | "samsung"
  | "pixel"
  | "kyocera"
  | "other";

export const DEVICE_OPTIONS: Array<{ value: DeviceKey; label: string }> = [
  { value: "iphone", label: "iPhone" },
  { value: "ipad", label: "iPad" },
  { value: "samsung", label: "Samsung" },
  { value: "pixel", label: "Google Pixel" },
  { value: "kyocera", label: "Kyocera" },
  { value: "other", label: "Other / Unknown" },
];

export function deviceStepFor(
  issue: { device_steps?: DeviceSteps | null } | null | undefined,
  device: DeviceKey | null,
): string | null {
  if (!issue || !device) return null;
  const steps = issue.device_steps || {};
  const direct = steps[device];
  if (direct) return direct;
  // iPad falls back to iPhone guidance; other falls back to any available
  if (device === "ipad" && steps.iphone) return steps.iphone;
  if (device === "other") {
    return (
      steps.other ||
      steps.iphone ||
      steps.samsung ||
      steps.pixel ||
      steps.kyocera ||
      null
    );
  }
  return null;
}

/** Device-name patterns used to strip other-device lines from runbook text. */
const DEVICE_LINE_PATTERNS: Record<Exclude<DeviceKey, "other">, RegExp> = {
  iphone: /\biphone\b/i,
  ipad: /\bipad\b/i,
  samsung: /\bsamsung\b/i,
  pixel: /\b(google\s*)?pixel\b/i,
  kyocera: /\bkyocera\b/i,
};

const ALL_DEVICE_KEYS: Array<Exclude<DeviceKey, "other">> = [
  "iphone",
  "ipad",
  "samsung",
  "pixel",
  "kyocera",
];

function isDeviceSpecificLine(line: string): boolean {
  return ALL_DEVICE_KEYS.some((k) => DEVICE_LINE_PATTERNS[k].test(line));
}

function lineMatchesDevice(line: string, device: DeviceKey): boolean {
  if (device === "other") return true;
  if (device === "ipad") {
    return (
      DEVICE_LINE_PATTERNS.ipad.test(line) ||
      DEVICE_LINE_PATTERNS.iphone.test(line)
    );
  }
  return DEVICE_LINE_PATTERNS[device].test(line);
}

/**
 * Remove multi-device device-path lines so selecting iPhone never still
 * shows Samsung / Pixel / Kyocera paths in the step body.
 */
export function filterContentForDevice(
  markdown: string,
  device: DeviceKey | null,
): string {
  if (!markdown?.trim()) return "";
  if (!device || device === "other") return markdown;

  const lines = markdown.split("\n");
  const out: string[] = [];
  let inDeviceTypes = false;

  for (const raw of lines) {
    const t = raw.trim();

    if (/^device types\s*:?\s*$/i.test(t) || /^device types\s*:/i.test(t)) {
      inDeviceTypes = true;
      continue;
    }

    if (inDeviceTypes) {
      if (!t) {
        inDeviceTypes = false;
        continue;
      }
      const bullet = t.replace(/^[-*•]\s*/, "");
      if (isDeviceSpecificLine(bullet)) continue;
      inDeviceTypes = false;
    }

    const bullet = t.replace(/^[-*•]\s*/, "");
    if (isDeviceSpecificLine(bullet) && !lineMatchesDevice(bullet, device)) {
      continue;
    }
    if (
      isDeviceSpecificLine(bullet) &&
      lineMatchesDevice(bullet, device) &&
      /settings\s*[-–—:>]/i.test(bullet)
    ) {
      continue;
    }

    out.push(raw);
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Split runbook prose into short, actionable checklist items.
 */
/** Strip ready-to-send customer template blocks from guide prose. */
function stripCustomerTemplateBlocks(markdown: string): string {
  if (!markdown) return markdown;
  return markdown
    // Full "**Customer template:** … findings." block (multiline)
    .replace(
      /\n*\*\*Customer template:\*\*[\s\S]*?(?:Please share your findings after these steps are performed\.?)/gi,
      "",
    )
    // Bare "Customer template:" header leftovers
    .replace(/\n*Customer template:\s*/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function toSimpleSteps(markdown: string): string[] {
  if (!markdown?.trim()) return [];

  const stripped = stripCustomerTemplateBlocks(markdown);

  const text = stripped
    .replace(/^#{1,6}\s+.+$/gm, "\n")
    .replace(/\*\*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const bulletLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^([-*•]|\d+[.)])\s+/.test(l))
    .map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    // Never surface customer-template body lines as checklist steps
    .filter(
      (l) =>
        !/^We could see \(Device\) IMEI/i.test(l) &&
        !/^Please share your findings after these steps/i.test(l),
    );

  if (bulletLines.length >= 2) {
    return bulletLines
      .flatMap(splitLongProse)
      .map(cleanStepSentence)
      .filter((s) => s.length > 8);
  }

  const chunks: string[] = [];
  for (const para of text.split(/\n{2,}|\n/)) {
    const p = para.trim();
    if (!p) continue;
    if (
      /^(troubleshooting template|note|device types|customer template)\s*:?\s*$/i.test(
        p,
      )
    ) {
      continue;
    }
    if (/^We could see \(Device\) IMEI/i.test(p)) continue;
    if (/^Please share your findings after these steps/i.test(p)) continue;
    chunks.push(...splitLongProse(p));
  }

  return chunks.map(cleanStepSentence).filter((s) => s.length > 8);
}

function splitLongProse(p: string): string[] {
  if (p.length <= 140) return [p];

  let parts = p
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);

  const withNotes: string[] = [];
  for (const part of parts) {
    const noteMatch = part.match(
      /^(.*?)(\(\s*(?:Note|If|NOTE)[^)]{8,}\))(.*)$/i,
    );
    if (noteMatch) {
      const before = noteMatch[1].trim().replace(/[.,;:]+$/, "");
      const note = noteMatch[2].trim();
      const after = noteMatch[3].trim();
      if (before.length > 8) withNotes.push(before);
      withNotes.push(note);
      if (after.length > 8) withNotes.push(after);
    } else {
      withNotes.push(part);
    }
  }
  parts = withNotes;

  const final: string[] = [];
  for (const part of parts) {
    if (part.length <= 160) {
      final.push(part);
      continue;
    }
    const clauses = part
      .split(
        /\s+(?=(?:also\s+(?:make\s+sure|ensure|perform|verify|check|advise|send|confirm)|once\s+the|and\s+if\s+the|and\s+send\s+|and\s+please\s+|please\s+share\s+))/i,
      )
      .map((s) => s.trim())
      .filter((s) => s.length > 8);
    if (clauses.length > 1) final.push(...clauses);
    else final.push(part);
  }
  return final;
}

function cleanStepSentence(s: string): string {
  return s
    .replace(/^[-*•]\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

/** Turn a "Settings → General → …" path into chip labels. */
export function pathChips(guidance: string): string[] {
  if (!guidance) return [];
  // Drop leading "iPhone: " / "Samsung: " label
  const path = guidance.replace(/^[^:]+:\s*/, "").trim();
  if (!path.includes("→") && !path.includes(">")) return [];
  return path
    .split(/\s*(?:→|>)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
}
