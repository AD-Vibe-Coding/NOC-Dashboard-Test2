import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method === "OPTIONS") {
    const allowed = applyCors(req, res);
    return allowed ? res.status(204).end() : res.status(403).json({ error: "Origin not allowed" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.AI_API_KEY;
  const platformUrl = process.env.AI_PLATFORM_URL || "https://devs.ai";

  if (!apiKey) {
    return res.status(500).json({ error: "AI_API_KEY not configured on the server" });
  }

  const body: { input?: unknown; model?: string; previous_response_id?: unknown } =
    typeof req.body === "string"
      ? JSON.parse(req.body || "{}")
      : (req.body ?? {});

  const requestedModel = typeof body.model === "string" ? body.model.trim() : "";
  const model = requestedModel || process.env.AI_AGENT_ID || "auto";

  let upstream: Response;
  try {
    upstream = await fetch(`${platformUrl}/api/v2/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: typeof body.input === "string" ? body.input : "",
        previous_response_id:
          typeof body.previous_response_id === "string" && body.previous_response_id.trim()
            ? body.previous_response_id
            : undefined,
        stream: true,
      }),
    });
  } catch (err) {
    console.error("[api/ai/chat] upstream fetch failed:", err);
    return res.status(502).json({
      error: err instanceof Error ? err.message : "Upstream fetch failed",
    });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    console.error(`[api/ai/chat] upstream returned ${upstream.status}:`, text.slice(0, 500));
    return res.status(upstream.status).json({
      error: `Upstream returned ${upstream.status}`,
      detail: text.slice(0, 500),
    });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  if (!upstream.body) {
    return res.end();
  }

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (err) {
    console.error("[api/ai/chat] stream pump error:", err);
  } finally {
    res.end();
  }
}

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};
