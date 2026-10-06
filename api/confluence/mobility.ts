import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getBundledMobilityResponse,
  MOBILITY_CARRIER,
  type DeviceSteps,
  type MobilityIssueGuide,
  type MobilityResponse,
} from "../_lib/mobility-guides.js";

/**
 * Mobility Troubleshooter API.
 *
 * LIVE: fetches AT&T OPUS Troubleshooting Workflow from Confluence
 *   https://appdirect.jira.com/wiki/spaces/vComNoc/pages/6315114528
 * FALLBACK: fully bundled Mobility Matrix when credentials/live fetch fail.
 *
 * Steps are always returned in full so the UI never asks the tech to open
 * Confluence just to read the runbook.
 */

const CONFLUENCE_BASE = "https://appdirect.jira.com/wiki";
const CONFLUENCE_ORIGIN = "https://appdirect.jira.com";
const SPACE_KEY = "vComNoc";
const OPUS_PAGE_ID = "6315114528";
const OPUS_PAGE_TITLE = "AT&T OPUS Troubleshooting Workflow";
const OPUS_PAGE_URL = `${CONFLUENCE_BASE}/spaces/${SPACE_KEY}/pages/${OPUS_PAGE_ID}/AT+T+OPUS+Troubleshooting+Workflow`;

// ---------------------------------------------------------------------------
// Issue catalog — maps OPUS h2 titles → widget dropdown entries
// ---------------------------------------------------------------------------

const ISSUE_CATALOG: Array<{
  id: string;
  label: string;
  matchers: RegExp[];
}> = [
  {
    id: "activation",
    label: "Activation / Porting assistance",
    matchers: [/activation/i, /porting/i],
  },
  {
    id: "calls",
    label: "Calls Inbound / Outbound issue",
    matchers: [/calls inbound/i, /inbound\s*\/\s*outbound/i],
  },
  {
    id: "data",
    label: "Data issue",
    matchers: [/^data issue/i],
  },
  {
    id: "esim",
    label: "eSIM Issue",
    matchers: [/e-?sim/i],
  },
  {
    id: "text",
    label: "Text issue",
    matchers: [/^text issue/i, /sms|mms|imessage/i],
  },
  {
    id: "voicemail",
    label: "Voicemail / Visual voicemail issue",
    matchers: [/voicemail/i],
  },
  {
    id: "roaming",
    label: "International Roaming",
    matchers: [/international roaming/i, /roaming/i],
  },
  {
    id: "network",
    label: "Network connectivity / Poor connection",
    matchers: [/network connectivity/i, /poor connection/i],
  },
  {
    id: "sos",
    label: "SOS Mode",
    matchers: [/sos mode/i],
  },
  {
    id: "plan",
    label: "Plan and feature change",
    matchers: [/plan and feature/i, /feature change/i],
  },
  {
    id: "outage",
    label: "Proactive Outage Notification",
    matchers: [/proactive outage/i, /outage notification/i],
  },
  {
    id: "warranty",
    label: "Warranty inquiry",
    matchers: [/warranty/i],
  },
  {
    id: "others",
    label: "Others",
    matchers: [/^others$/i],
  },
];

const DEFAULT_DEVICE_STEPS: DeviceSteps = {
  iphone:
    "iPhone SE and above: Settings → General → Transfer or Reset iPhone → Reset → Reset Network Settings",
  ipad: "iPad: Settings → General → Transfer or Reset iPad → Reset → Reset Network Settings",
  samsung: "Samsung: Settings → General Management → Reset → Reset Network Settings",
  pixel: "Google Pixel: Settings → System → Reset options → Reset Network Settings",
  kyocera:
    "Kyocera: Settings → System → Reset options → Reset Wi-Fi, mobile & Bluetooth → Reset Settings",
  other: "Perform a network settings reset per the device OEM documentation, then reboot.",
};

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function absoluteHref(href: string): string {
  if (!href) return href;
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return href.replace(
      "https://appdirect.jira.com/wiki/wiki/",
      "https://appdirect.jira.com/wiki/",
    );
  }
  if (href.startsWith("/wiki/")) return `${CONFLUENCE_ORIGIN}${href}`;
  if (href.startsWith("/spaces/") || href.startsWith("/pages/")) {
    return `${CONFLUENCE_BASE}${href}`;
  }
  if (href.startsWith("/")) return `${CONFLUENCE_BASE}${href}`;
  return href;
}

function cellToMarkdown(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|br|table|ul|ol)>/gi, "\n")
    .replace(/<(h[1-6])[^>]*>/gi, "\n### ")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<strong[^>]*>|<\/strong>|<b[^>]*>|<\/b>/gi, "**")
    .replace(/<em[^>]*>|<\/em>|<i[^>]*>|<\/i>/gi, "_")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
      const clean = String(text).replace(/<[^>]+>/g, "").trim() || href;
      return `[${clean}](${absoluteHref(href)})`;
    })
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\*{2,}/g, (m) => (m.length % 2 === 0 ? m : m.slice(0, -1)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\*+$/gm, "")
    .trim();
}

function stripHeadingLine(md: string, title: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return md
    .replace(new RegExp(`^###?\\s*${escaped}\\s*`, "i"), "")
    .replace(new RegExp(`^${escaped}\\s*`, "i"), "")
    .trim();
}

// ---------------------------------------------------------------------------
// Parse OPUS page (heading / list structure — not a table)
// ---------------------------------------------------------------------------

interface Section {
  title: string;
  level: 1 | 2;
  markdown: string;
}

function extractSections(html: string): Section[] {
  const re = /<(h[12])[^>]*>([\s\S]*?)<\/\1>/gi;
  const heads: Array<{ level: 1 | 2; title: string; idx: number }> = [];
  for (const m of html.matchAll(re)) {
    const level = m[1].toLowerCase() === "h1" ? 1 : 2;
    const title = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (title) heads.push({ level, title, idx: m.index ?? 0 });
  }

  return heads.map((h, i) => {
    const start = h.idx;
    const end = i + 1 < heads.length ? heads[i + 1].idx : html.length;
    const md = stripHeadingLine(cellToMarkdown(html.slice(start, end)), h.title);
    return { title: h.title, level: h.level, markdown: md };
  });
}

/**
 * Split a free-form OPUS section into Step 1 (NOC) / Step 2 (carrier) /
 * Step 3 (persist) based on language cues, while keeping the full content.
 */
function splitIntoSteps(md: string): { step1: string; step2: string; step3: string } {
  if (!md.trim()) return { step1: "", step2: "", step3: "" };

  // Prefer bullet/numbered lines as atomic units; fall back to paragraphs.
  const units = md
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (units.length === 0) return { step1: md, step2: "", step3: "" };

  const isIntro = (u: string) =>
    /^(use this section|do not |best practice|validation\/notes|suggested notification|quick device|step-by-step)/i.test(
      u,
    ) || (!/^[-*•]/.test(u) && !/^\d+[.)]/.test(u) && u.length < 220 && !/\b(OPUS|OTA|IMEI|ICCID)\b/i.test(u));

  const isCarrier = (u: string) =>
    /contact (AT&T|ATT|carrier)|tier\s*1|1-888-334-3787|security pin|partner exchange|carrier support|validate with AT&T|ask AT&T/i.test(
      u,
    );

  const isPersist = (u: string) =>
    /factory reset|warranty|alternate device|new (e)?SIM|reprovision|replacement|escalate|if (the )?(issue )?(still )?(remains|persists|continues|unresolved)|last resort|partner exchange portal|document the/i.test(
      u,
    ) && !isCarrier(u);

  const intro: string[] = [];
  const noc: string[] = [];
  const carrier: string[] = [];
  const persist: string[] = [];
  let phase: "noc" | "carrier" | "persist" = "noc";

  for (const u of units) {
    if (isIntro(u) && noc.length === 0 && carrier.length === 0) {
      intro.push(u);
      continue;
    }
    if (isCarrier(u)) {
      phase = "carrier";
      carrier.push(u);
      continue;
    }
    if (phase === "carrier" && isPersist(u)) {
      phase = "persist";
      persist.push(u);
      continue;
    }
    if (phase === "noc" && isPersist(u) && carrier.length === 0) {
      // Some sections jump straight from NOC to persist without carrier wording
      phase = "persist";
      persist.push(u);
      continue;
    }
    if (phase === "persist") {
      persist.push(u);
    } else if (phase === "carrier") {
      // After first carrier line, later non-carrier lines that look like next actions
      // (SIM swap, escalate) go to persist; otherwise stay with carrier.
      if (isPersist(u)) {
        phase = "persist";
        persist.push(u);
      } else {
        carrier.push(u);
      }
    } else {
      noc.push(u);
    }
  }

  const join = (parts: string[]) => parts.join("\n\n").trim();
  const step1 = join([...intro, ...noc]) || md;
  const step2 = join(carrier);
  const step3 = join(persist);

  // If we failed to split (everything stayed in step1), still return full content
  // in step1 so nothing is lost — UI will show it all under NOC checks.
  return { step1, step2, step3 };
}

function extractDeviceSteps(md: string): DeviceSteps {
  const devices: DeviceSteps = {
    iphone: null,
    ipad: null,
    samsung: null,
    pixel: null,
    kyocera: null,
    other: null,
  };

  const lower = md.toLowerCase();
  // Common OPUS quick-reset reminder block
  if (/for iphone:.*reset network settings/i.test(md) || /settings\s*>\s*general\s*>\s*transfer/i.test(md)) {
    devices.iphone =
      "iPhone: Settings → General → Transfer or Reset → Reset Network Settings";
  }
  if (/for samsung:.*reset network settings/i.test(md) || /general management/i.test(md)) {
    devices.samsung =
      "Samsung: Settings → General Management → Reset → Reset Network Settings";
  }
  if (/for google pixel:.*reset network settings/i.test(md) || /reset options/i.test(md)) {
    devices.pixel =
      "Google Pixel: Settings → System → Reset options → Reset Network Settings";
  }

  // Connectivity-class issues always get full defaults
  const needsDefaults =
    /network reset|reset network|send ota|sim pull|device-level checks|connectivity/i.test(
      lower,
    );

  if (needsDefaults || Object.values(devices).some(Boolean)) {
    return {
      iphone: devices.iphone || DEFAULT_DEVICE_STEPS.iphone,
      ipad: devices.ipad || DEFAULT_DEVICE_STEPS.ipad,
      samsung: devices.samsung || DEFAULT_DEVICE_STEPS.samsung,
      pixel: devices.pixel || DEFAULT_DEVICE_STEPS.pixel,
      kyocera: devices.kyocera || DEFAULT_DEVICE_STEPS.kyocera,
      other: devices.other || DEFAULT_DEVICE_STEPS.other,
    };
  }

  // eSIM-specific defaults
  if (/e-?sim/i.test(md) && /provision|install|setup banner/i.test(md)) {
    return {
      iphone:
        "iPhone: complete on-device eSIM setup when prompted. Settings → Cellular → Add eSIM. Delete: Settings → Cellular → [plan] → Delete eSIM.",
      ipad: "iPad (cellular): Settings → Cellular Data → Add Cellular Plan. Delete via Settings → Cellular Data → [plan] → Delete eSIM.",
      samsung:
        "Samsung: Settings → Connections → SIM manager → Add eSIM. Remove via SIM manager → eSIM → Remove.",
      pixel: "Pixel: Settings → Network & internet → SIMs → Download a SIM instead.",
      kyocera: "Follow OEM eSIM install steps; if unsupported, ship a physical SIM.",
      other: "Follow OEM eSIM install documentation for the device model.",
    };
  }

  if (/roaming|data roaming/i.test(md)) {
    return {
      iphone:
        "iPhone: Settings → Cellular → Cellular Data Options → Data Roaming → On. Then Network Selection → Automatic.",
      ipad: "iPad: Settings → Cellular Data → Data Roaming → On.",
      samsung: "Samsung: Settings → Connections → Mobile networks → Data roaming → On.",
      pixel: "Pixel: Settings → Network & internet → SIMs → [SIM] → Roaming → On.",
      kyocera: "Kyocera: Settings → Network & internet → Mobile network → Roaming → On.",
      other: "Enable Data Roaming in the device's mobile network settings.",
    };
  }

  return devices;
}

function mapSectionsToIssues(sections: Section[]): MobilityIssueGuide[] {
  const h2 = sections.filter((s) => s.level === 2);
  const used = new Set<number>();
  const mapped: MobilityIssueGuide[] = [];

  for (const cat of ISSUE_CATALOG) {
    const idx = h2.findIndex(
      (s, i) => !used.has(i) && cat.matchers.some((re) => re.test(s.title)),
    );
    if (idx < 0) continue;
    used.add(idx);
    const sec = h2[idx];
    const { step1, step2, step3 } = splitIntoSteps(sec.markdown);
    mapped.push({
      id: cat.id,
      label: cat.label,
      source_issue: sec.title,
      step1,
      step2,
      step3,
      device_steps: extractDeviceSteps(sec.markdown),
    });
  }

  // Any unmatched h2 sections under "Others" or as extra entries
  const remaining = h2.filter((_, i) => !used.has(i));
  if (remaining.length > 0) {
    const alreadyHasOthers = mapped.some((m) => m.id === "others");
    if (!alreadyHasOthers) {
      const parts = remaining.map((s) => {
        const { step1, step2, step3 } = splitIntoSteps(s.markdown);
        return { title: s.title, step1, step2, step3, device_steps: extractDeviceSteps(s.markdown) };
      });
      mapped.push({
        id: "others",
        label: "Others",
        source_issue: parts.map((p) => p.title).join(" · "),
        step1: parts.map((p) => `### ${p.title}\n\n${p.step1}`).join("\n\n"),
        step2: parts
          .filter((p) => p.step2)
          .map((p) => `### ${p.title}\n\n${p.step2}`)
          .join("\n\n"),
        step3: parts
          .filter((p) => p.step3)
          .map((p) => `### ${p.title}\n\n${p.step3}`)
          .join("\n\n"),
        device_steps: parts[0]?.device_steps || DEFAULT_DEVICE_STEPS,
      });
    }
  }

  return mapped;
}

// ---------------------------------------------------------------------------
// Live Confluence fetch
// ---------------------------------------------------------------------------

async function confluenceFetch(
  path: string,
  email: string,
  token: string,
): Promise<Response> {
  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  return fetch(`${CONFLUENCE_BASE}${path}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });
}

async function fetchLiveOpusPage(
  email: string,
  token: string,
): Promise<{
  issues: MobilityIssueGuide[];
  page_title: string;
  page_version: number | null;
  page_when: string | null;
}> {
  const res = await confluenceFetch(
    `/rest/api/content/${OPUS_PAGE_ID}?expand=body.view,version`,
    email,
    token,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OPUS page fetch failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const page = (await res.json()) as {
    id: string;
    title: string;
    version?: { number?: number; when?: string };
    body?: { view?: { value: string } };
  };

  const html = page.body?.view?.value || "";
  if (!html.trim()) {
    throw new Error("OPUS page body was empty");
  }

  const sections = extractSections(html);
  const issues = mapSectionsToIssues(sections);
  if (issues.length === 0) {
    throw new Error("OPUS page parsed but no issue sections were found");
  }

  return {
    issues,
    page_title: page.title || OPUS_PAGE_TITLE,
    page_version: page.version?.number ?? null,
    page_when: page.version?.when ?? null,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Never pin a bundled/live response in the browser/proxy — always revalidate.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");

  const email = process.env.CONFLUENCE_USER_EMAIL?.trim();
  const token = process.env.CONFLUENCE_API_TOKEN?.trim();
  const bundled = getBundledMobilityResponse();

  if (!email || !token) {
    const body: MobilityResponse = {
      ...bundled,
      source: "bundled",
      page_id: OPUS_PAGE_ID,
      page_title: OPUS_PAGE_TITLE,
      page_url: OPUS_PAGE_URL,
      page_version: null,
      warning:
        "Confluence credentials not set — showing bundled Mobility Matrix. Set CONFLUENCE_USER_EMAIL + CONFLUENCE_API_TOKEN for live OPUS workflow.",
    };
    return res.status(200).json(body);
  }

  try {
    const live = await fetchLiveOpusPage(email, token);
    const body: MobilityResponse = {
      source: "live",
      carrier: MOBILITY_CARRIER.id,
      carrier_label: MOBILITY_CARRIER.label,
      portal_url: MOBILITY_CARRIER.portal_url,
      support_phone: MOBILITY_CARRIER.support_phone,
      support_pin: MOBILITY_CARRIER.support_pin,
      fetched_at: new Date().toISOString(),
      issues: live.issues,
      warning: null,
      page_id: OPUS_PAGE_ID,
      page_title: live.page_title,
      page_url: OPUS_PAGE_URL,
      page_version: live.page_version,
    };
    return res.status(200).json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Live OPUS fetch failed";
    const body: MobilityResponse = {
      ...bundled,
      source: "bundled",
      page_id: OPUS_PAGE_ID,
      page_title: OPUS_PAGE_TITLE,
      page_url: OPUS_PAGE_URL,
      page_version: null,
      warning: `Live Confluence fetch failed (${msg}). Showing bundled Mobility Matrix fallback.`,
    };
    return res.status(200).json(body);
  }
}
