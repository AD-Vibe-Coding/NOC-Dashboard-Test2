/**
 * POST /api/audit/analyze
 *
 * Accepts { text, fileName } — the plain-text contents of an MHTML ticket —
 * and streams back an SSE response from the Devs.ai audit agent.
 *
 * The agent is configured with audit instructions. The prompt asks it to
 * return a structured JSON block followed by a markdown analysis.
 *
 * Uses AUDIT_AGENT_ID if set, otherwise falls back to AI_AGENT_ID.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

const MAX_TEXT_CHARS = 80_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
  const agentId = process.env.AUDIT_AGENT_ID || process.env.AI_AGENT_ID || "auto";

  if (!apiKey) {
    return res.status(500).json({ error: "AI_API_KEY not configured" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
  const { text, fileName } = body;

  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "text is required" });
  }

  const truncated = text.slice(0, MAX_TEXT_CHARS);

  const prompt = `You are a NOC ticket quality auditor. Analyze the following support ticket and produce a structured quality audit.

TICKET FILE: ${fileName ?? "unknown.mhtml"}

TICKET CONTENT:
${truncated}

---

Instructions:
1. First, output a JSON block (fenced with \`\`\`json ... \`\`\`) containing the following fields:
   - ticket_number: string or null
   - ticket_subject: string or null  
   - agent_name: string or null (the primary agent who worked the ticket)
   - overall_score: number 0–100
   - grade: "Pass" | "Needs Improvement" | "Fail"
   - audit_month: string "YYYY-MM" based on the ticket date, or null
   - queue: "noc" | "mobility" | null (based on the ticket type/queue)
   - criteria: object with criterion names as keys and scores (0–10) as values. Use these criteria:
     - "Acknowledgement Speed" (was it acknowledged promptly?)
     - "Communication Quality" (were updates clear and professional?)
     - "Technical Accuracy" (was the diagnosis and troubleshooting correct?)
     - "Process Adherence" (did they follow escalation and documentation procedures?)
     - "Resolution Completeness" (was the issue fully resolved with proper closure?)
     - "Customer Handling" (how well was the customer/stakeholder managed?)

2. After the JSON block, write a detailed markdown audit report with these sections:
   ## Audit Summary
   ## Strengths
   ## Areas for Improvement
   ## Recommendations
   ## Score Breakdown

Be objective and specific. Reference actual ticket notes and timestamps when scoring.`;

  const upstream = await fetch(`${platformUrl}/api/v1/chats/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: agentId,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return res.status(upstream.status).json({ error: errText.slice(0, 200) });
  }

  res.writeHead(upstream.status, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  if (!upstream.body) { res.end(); return; }

  const reader = upstream.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}
