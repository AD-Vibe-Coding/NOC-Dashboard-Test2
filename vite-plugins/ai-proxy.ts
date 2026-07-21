import type { Plugin } from "vite";
import { loadEnv } from "vite";

export function aiProxyPlugin(): Plugin {
  let env: Record<string, string> = {};
  return {
    name: "ai-proxy",
    configureServer(server) {
      env = loadEnv("development", process.cwd(), "");

      server.middlewares.use("/api/ai/chat", async (req, res) => {
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
          });
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST");
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk);
          const raw = Buffer.concat(chunks).toString("utf8");
          const body = raw ? JSON.parse(raw) : {};

          const apiKey = env.AI_API_KEY;
          const platformUrl = env.AI_PLATFORM_URL || "https://devs.ai";
          const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : env.AI_AGENT_ID || "auto";

          if (!apiKey) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "AI_API_KEY not configured in .env" }));
            return;
          }

          const upstream = await fetch(`${platformUrl}/api/v2/responses`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              input: body.input,
              previous_response_id: body.previous_response_id || undefined,
              stream: true,
            }),
          });

          res.writeHead(upstream.status, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });

          if (!upstream.body) {
            res.end();
            return;
          }
          const reader = upstream.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
        } catch (err) {
          console.error("[ai-proxy] error:", err);
          try {
            if (!res.headersSent) {
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
              );
            } else {
              res.end();
            }
          } catch {
            // ignore
          }
        }
      });
    },
  };
}
