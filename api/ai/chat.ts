import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Production serverless port of vite-plugins/ai-proxy.ts.
 *
 * Forwards POST /api/ai/chat requests to the Devs.ai chat completions
 * endpoint with server-side Bearer auth, then streams the upstream SSE
 * response straight back to the browser.
 *
 * The frontend (src/lib/devs-ai/client.ts) doesn't care which environment
 * it's running in — it always POSTs to /api/ai/chat. In dev that's the
 * Vite middleware, in production it's this Vercel function. Both honor
 * the same env vars:
 *   - AI_API_KEY       (required) — Bearer token, never sent to the client
 *   - AI_AGENT_ID      (optional) — defaults to "auto"
 *   - AI_PLATFORM_URL  (optional) — defaults to https://devs.ai
 *
 * To deploy successfully on Vercel, those three variables MUST be set in
 * the Vercel project's Environment Variables (Settings → Environment
 * Variables). Without AI_API_KEY this function returns 500 and every AI
 * widget will show an error.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.AI_API_KEY;
  const platformUrl = process.env.AI_PLATFORM_URL || "https://devs.ai";

  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "AI_API_KEY not configured on the server" });
  }

  // Vercel auto-parses JSON bodies when Content-Type is application/json,
  // so req.body is already an object. Fall back to manual parse if it's
  // a string (older Vercel runtimes).
  const body: { messages?: unknown; model?: string } =
    typeof req.body === "string"
      ? JSON.parse(req.body || "{}")
      : (req.body ?? {});

  const agentId = body.model || process.env.AI_AGENT_ID || "auto";

  if (!Array.isArray(body.messages)) {
    return res.status(400).json({ error: "messages must be an array" });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${platformUrl}/api/v1/chats/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: agentId,
        messages: body.messages,
        stream: true,
      }),
    });
  } catch (err) {
    console.error("[api/ai/chat] upstream fetch failed:", err);
    return res.status(502).json({
      error: err instanceof Error ? err.message : "Upstream fetch failed",
    });
  }

  // Non-2xx upstream — drain the body as text and return a JSON error so
  // the client sees a useful message instead of a half-open SSE stream.
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    console.error(
      `[api/ai/chat] upstream returned ${upstream.status}:`,
      text.slice(0, 500),
    );
    return res.status(upstream.status).json({
      error: `Upstream returned ${upstream.status}`,
      detail: text.slice(0, 500),
    });
  }

  // Stream SSE back to the client. We MUST set headers before writing
  // any chunks, and we must NOT call res.json() / res.send() afterward.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Disable Vercel/edge buffering that would batch SSE chunks and break
  // token-by-token streaming on the client.
  res.setHeader("X-Accel-Buffering", "no");

  if (!upstream.body) {
    return res.end();
  }

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // value is a Uint8Array; Vercel's res.write accepts Buffer/Uint8Array.
      res.write(value);
    }
  } catch (err) {
    console.error("[api/ai/chat] stream pump error:", err);
  } finally {
    res.end();
  }
}

// Tell Vercel this is a Node.js (not Edge) function, and give it enough
// runtime to handle long LLM streams. Default maxDuration on Hobby is 10s,
// which can cut off mid-response on a verbose answer; 60s is generous.
export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};
