/**
 * POST /api/audit/chat
 *
 * Audit follow-up chat endpoint. Receives the full audit context (scores,
 * deductions, markdown report) plus the conversation history and streams
 * back the AI response using the same LLM as the auditor.
 *
 * Body: {
 *   messages: { role: "user" | "assistant"; content: string }[],
 *   auditContext: {
 *     ticket_number: string | null,
 *     agent_name: string | null,
 *     overall_score: number | null,
 *     grade: string | null,
 *     criteria_json: string | null,   // JSON string of { criterion: score }
 *     analysis_markdown: string,
 *     what_did_well: string | null,
 *     what_missed: string | null,
 *   }
 * }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

function buildAuditChatSystemPrompt(ctx: {
  ticket_number: string | null;
  agent_name: string | null;
  overall_score: number | null;
  grade: string | null;
  criteria_json: string | null;
  analysis_markdown: string;
  what_did_well: string | null;
  what_missed: string | null;
}): string {
  let criteriaSection = "";
  if (ctx.criteria_json) {
    try {
      const c = JSON.parse(ctx.criteria_json) as Record<string, number>;
      criteriaSection = Object.entries(c)
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join("\n");
    } catch {
      criteriaSection = ctx.criteria_json;
    }
  }

  return `You are an expert vCom NOC Ticket Audit Reviewer. Your job is to help the user understand this completed audit in detail — explaining exactly why scores were deducted, what the agent did wrong, what they did right, and what needs to change.

You have full knowledge of the audit below. Answer every question with specific evidence from the audit report. Be direct, detailed, and actionable.

════════════════════════════════════════════════════
COMPLETED AUDIT CONTEXT
════════════════════════════════════════════════════

Ticket Number: ${ctx.ticket_number ?? "Not provided"}
Agent: ${ctx.agent_name ?? "Unknown"}
Overall Score: ${ctx.overall_score ?? "N/A"} / 100
Grade: ${ctx.grade ?? "N/A"}

Category Scores:
${criteriaSection || "  Not available"}

What the Agent Did Well:
${ctx.what_did_well || "Not recorded"}

What the Agent Missed / Could Do Better:
${ctx.what_missed || "Not recorded"}

Full Audit Report:
────────────────────────────────────────────────────
${ctx.analysis_markdown}
────────────────────────────────────────────────────

════════════════════════════════════════════════════
YOUR ROLE
════════════════════════════════════════════════════

- Answer questions about specific score deductions with exact evidence from the audit.
- Explain the policy/rule that was violated when a deduction was made.
- Clarify what the agent should have done differently.
- Help the user decide what feedback or action items to note.
- If the user asks to note or record something, confirm what they want noted so they can save it.
- Be concise, specific, and evidence-based in all responses.
- Do NOT make up information not present in the audit above.`;
}

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
  const model = process.env.AUDIT_MODEL || process.env.AI_AGENT_ID || "gpt-4o";

  if (!apiKey) return res.status(500).json({ error: "AI_API_KEY not configured" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
  const { messages, auditContext } = body;

  if (!Array.isArray(messages) || !auditContext) {
    return res.status(400).json({ error: "messages and auditContext are required" });
  }

  const systemPrompt = buildAuditChatSystemPrompt(auditContext);

  const upstream = await fetch(`${platformUrl}/api/v1/chats/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
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
