import type { VercelRequest, VercelResponse } from "@vercel/node";
import { listGeminiNoteMessages, listGmailLabels } from "../_lib/google-gmail.js";
import { requireManagerAppBuilder } from "../_lib/appbuilder-auth.js";

const APPROVED_TEAM_MEMBER_NAMES = [
  "Karthik Radhakrishnan",
  "Pranav Dandibhotla",
  "Sriram Parisa",
  "Lokesh Naik Banavath",
  "Kenya Gentry",
  "Mohammed Ashraf",
  "Hamza Rahmani",
  "Akash Hanvate",
  "Otukho Olembo",
  "Mohammed Zubairuddin",
  "Karthik Damagalla",
  "Abhishek Benarji",
  "Akram Ahmed",
  "Mahalakshmi Samiti",
] as const;

function normalizeLabelName(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

const gmailMeetingNotesCache = new Map<string, { at: number; payload: unknown }>();
const GMAIL_MEETING_NOTES_CACHE_MS = 60_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  const session = await requireManagerAppBuilder(req, res);
  if (!session) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const max = Number(req.query?.max ?? 100);
    const startDate = typeof req.query?.start === "string" ? req.query.start : "2026-04-01";
    const endDate = typeof req.query?.end === "string" ? req.query.end : "2026-06-01";
    const email = String(session.email ?? "");
    const cacheKey = `${email}:${startDate}:${endDate}:${Number.isFinite(max) ? max : 500}`;
    const cached = gmailMeetingNotesCache.get(cacheKey);
    if (cached && Date.now() - cached.at < GMAIL_MEETING_NOTES_CACHE_MS) {
      return res.status(200).json(cached.payload);
    }
    const [messages, labels] = await Promise.all([
      listGeminiNoteMessages(
        email,
        Number.isFinite(max) ? max : 500,
        startDate,
        endDate,
      ),
      listGmailLabels(email),
    ]);
    const approvedLabelSet = new Set(APPROVED_TEAM_MEMBER_NAMES.map(normalizeLabelName));
    const approvedLabels = labels
      .filter((label) => {
        const leaf = normalizeLabelName(String(label.name ?? "").split("/").pop() ?? "");
        return approvedLabelSet.has(leaf);
      })
      .map((label) => label.name)
      .sort((a, b) => a.localeCompare(b));
    const payload = {
      label: "gemini-notes",
      startDate,
      endDate,
      query: messages[0]?.labelQuery ?? `label:gemini-notes after:2026/04/01 before:2026/06/02`,
      count: messages.length,
      labels,
      approvedLabels,
      messages,
    };
    gmailMeetingNotesCache.set(cacheKey, { at: Date.now(), payload });
    return res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load Gemini notes from Gmail.";
    const quotaExceeded = /quota|rate limit|too many requests/i.test(message);
    return res.status(quotaExceeded ? 429 : 400).json({
      error: quotaExceeded
        ? "Gmail API quota was exceeded. Please wait about a minute, then try Gmail sync again. The app now avoids background Gmail loads and reuses recent results to reduce quota pressure."
        : message,
      needs_reauth: !quotaExceeded,
    });
  }
}
