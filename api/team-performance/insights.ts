import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireManager } from "../_lib/auth-middleware.js";

const SYSTEM = `You are writing for NOC leadership. Analyze the last 13 months in the JSON (payload.months) and write an executive briefing of patterns, not a single-month recap.
Use only the JSON. Do not invent counts.

Cover, in this order, using **bold** for key figures and names:
1. Volume trend across the window (payload.window). Note peaks, troughs, and latest month vs prior.
2. Issue types (column M / issueTypes): only three buckets — **MNS Alert**, **Maintenance Notification**, and **Other** (everything else rolled together). Which of those three rose or fell over months.
3. Resolutions (column X): dominant resolutions and shifts.
4. Source (column Y): Tech Support vs manual. Treat "Tech Support" as system-opened; everything else as manual.
5. Time to open with carrier (column AG, minutes): is avgCarrierOpenMinutes rising or falling? Which carriers in carrierOpenByCarrier drive that.
6. Hour of day (column AX / hours) and day of week (column AW / days): which hours/days are increasing or decreasing.

If a series is empty, say that field was not present in the upload. Do not pretend mix or patterns are known.
6–10 short paragraphs. Blank lines between paragraphs. No tables. No wrapping whole sentences in asterisks.
Tone: calm, specific, board-ready.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "POST only" });
    }
    if (!requireManager(req, res)) return;

    const apiKey = process.env.AI_API_KEY;
    const platformUrl = process.env.AI_PLATFORM_URL || "https://devs.ai";
    const model = process.env.AI_AGENT_ID || "gpt-4.1-mini";
    if (!apiKey) {
      return res.status(500).json({ error: "AI is not configured for this app." });
    }

    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) as {
      payload?: unknown;
      question?: string;
    };
    const question =
      (body.question || "").trim() ||
      "Explain why ticket volume changed vs the prior period. Call out maintenance vs outage mix and Comcast specifically.";
    const input = `${SYSTEM}\n\n${question}\n\nFacts JSON:\n${JSON.stringify(body.payload ?? {})}`;

    const upstream = await fetch(`${platformUrl}/api/v2/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
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
    let briefing = "";
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
              if (typeof parsed.delta === "string") briefing += parsed.delta;
            } catch {
              /* skip */
            }
          }
          currentEvent = "";
          currentData = "";
        }
      }
    }

    return res.status(200).json({
      briefing: briefing.trim() || "No briefing returned.",
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Server error",
    });
  }
}
