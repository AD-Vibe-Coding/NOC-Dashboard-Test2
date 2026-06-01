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
    const max = Number(req.query?.max ?? 5);
    const messages = await listGeminiNoteMessages(String(session.email ?? ""), Number.isFinite(max) ? max : 5);
    return res.status(200).json({
      label: "gemini-notes",
      query: "label:gemini-notes",
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
