import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireManager } from "../_lib/auth-middleware.js";

const SYSTEM = `You are a professional writing assistant. Produce polished, ready-to-use content from the user's brief.
Write articles, summaries, descriptions, Slack posts, or other copy as requested.
Use clear structure, specific language, and no filler. Match the requested tone if given.
If the brief is vague, make reasonable editorial choices and keep the piece concise.
Return markdown.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "POST only" });
    }
    if (!requireManager(req, res)) return;

    const apiKey = process.env.AI_API_KEY;
    const platformUrl = process.env.AI_PLATFORM_URL || "https://devs.ai";
    if (!apiKey) {
      return res.status(500).json({ error: "AI is not configured for this app." });
    }

    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) as {
      prompt?: string;
    };
    const prompt = (body.prompt || "").trim();
    if (!prompt) {
      return res.status(400).json({ error: "Describe what you want generated." });
    }

    const input = `${SYSTEM}\n\nUser brief:\n${prompt}`;

    const upstream = await fetch(`${platformUrl}/api/v2/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4",
        input,
        stream: true,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      return res.status(502).json({
        error: `AI request failed (${upstream.status})`,
        detail: detail.slice(0, 400),
      });
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let currentEvent = "";
    let currentData = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          currentData = line.slice(6);
        } else if (line === "") {
          if (currentEvent === "response.output_text.delta" && currentData && currentData !== "[DONE]") {
            try {
              const parsed = JSON.parse(currentData) as { delta?: string };
              if (typeof parsed.delta === "string") content += parsed.delta;
            } catch {
              /* skip */
            }
          }
          currentEvent = "";
          currentData = "";
        }
      }
    }

    return res.status(200).json({ content: content.trim() || "No content returned." });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Server error",
    });
  }
}
