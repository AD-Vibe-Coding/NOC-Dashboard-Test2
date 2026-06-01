import type { VercelRequest, VercelResponse } from "@vercel/node";
import { listGeminiNoteMessages } from "../_lib/google-gmail.js";
import { requireManagerAppBuilder } from "../_lib/appbuilder-auth.js";

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
    const max = Number(req.query?.max ?? 500);
    const startDate = typeof req.query?.start === "string" ? req.query.start : "2026-04-01";
    const endDate = typeof req.query?.end === "string" ? req.query.end : "2026-06-01";
    const messages = await listGeminiNoteMessages(
      String(session.email ?? ""),
      Number.isFinite(max) ? max : 500,
      startDate,
      endDate,
    );
    return res.status(200).json({
      label: "gemini-notes",
      startDate,
      endDate,
      query: messages[0]?.labelQuery ?? `label:gemini-notes after:2026/04/01 before:2026/06/02`,
      count: messages.length,
      messages,
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to load Gemini notes from Gmail.",
      needs_reauth: true,
    });
  }
}
