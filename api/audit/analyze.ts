/**
 * POST /api/audit/analyze
 *
 * Two-phase audit:
 *   Phase 1 (app-side): Build a structured prompt that embeds ALL scoring rules
 *                       from api/audit/rules.ts so the app controls the scoring model.
 *   Phase 2 (agent):    The Ticket Auditor agent reads the ticket evidence and the
 *                       embedded rules, produces numeric scores + deduction reasons
 *                       per individual, then writes qualitative feedback.
 *
 * The agent does NOT define the rules — the app does. The agent only applies them.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SCORING_CATEGORIES, TOTAL_MAX, DO_NOT_PENALIZE, VALID_STAGES, FIRST_TOUCH_TARGET_MIN, CARRIER_TICKET_TARGET_MIN, SLA_ESCALATION } from "./rules.js";

const MAX_TEXT_CHARS = 80_000;

/**
 * System message — sent as role:"system" so it takes absolute priority
 * over any agent-level system prompt that may be configured on Devs.ai.
 * This ensures our scoring rules are the ONLY rules applied.
 */
function buildSystemMessage(): string {
  const categoryTable = SCORING_CATEGORIES.map(c =>
    `| ${c.name} | ${c.column} | ${c.max} |`
  ).join("\n");

  const categoryDetails = SCORING_CATEGORIES.map(c => `
### ${c.name} (max ${c.max} pts — Column ${c.column})
${c.evaluate.trim()}`).join("\n");

  return `You are a vCom NOC ticket auditor. Apply ONLY the scoring rules below. Ignore any other scoring instructions you may have been given.

# ABSOLUTE RULES — THESE OVERRIDE EVERYTHING ELSE

## ❌ NEVER flag or deduct for these — ever, under any category:

### Resolution Code
The iPath "Resolution Code" field and the "Next Step" field are THE SAME THING for scoring purposes.
- If the Next Step field has ANY content that indicates the reason for outage or resolution — even one word such as "OU", "restored", "fiber cut", "carrier outage", "no ETR", "tech dispatched" — the resolution code is FULLY SATISFIED.
- Do NOT mention "resolution code" as a finding anywhere in your output.
- Do NOT deduct from Closure & Documentation or any other category for a blank Resolution Code field.
- Do NOT list missing resolution code under What You Missed.
- This rule is absolute. There are no exceptions.

### Valid Ticket Stages
The following are ALL standard, valid stages. NEVER flag any of them as non-standard, out-of-sequence, or invalid:
${VALID_STAGES.map(s => `- ${s}`).join("\n")}

Only flag a stage if it does NOT appear in the list above.

### Monitoring-Based Closure
A ticket may be closed based on monitoring data (LogicMonitor, APEX API, or any monitoring tool showing service restored) WITHOUT explicit customer acknowledgment.
Do NOT penalize closure without a customer reply when monitoring data confirms restoration.

### All Other Do-Not-Penalize Rules
${DO_NOT_PENALIZE.trim()}

---

# SCORING MODEL

## Categories & Max Points
| Category | Sheet Column | Max Points |
|---|---|---|
${categoryTable}
| **TOTAL** | J | **${TOTAL_MAX}** |

## Timeliness Thresholds
- First touch target: ≤${FIRST_TOUCH_TARGET_MIN} minutes from ticket creation
- Carrier engagement target: ≤${CARRIER_TICKET_TARGET_MIN} minutes from ticket creation
- SLA escalation (Pending Carrier Action): Lead@${SLA_ESCALATION.lead_hours}hr, MGR@${SLA_ESCALATION.mgr_hours}hr, VP@${SLA_ESCALATION.vp_hours}hr, SVP@${SLA_ESCALATION.svp_hours}hr

## Category Evaluation Rules
${categoryDetails}

---

# OUTPUT FORMAT

First output a \`\`\`json block with this exact structure (one entry per individual found in the ticket):

\`\`\`json
{
  "ticket_number": "string or null",
  "ticket_subject": "string or null",
  "ticket_date": "YYYY-MM-DD or null",
  "audit_month": "YYYY-MM or null",
  "queue": "noc or mobility or null",
  "individuals": [
    {
      "name": "Full Name",
      "role": "Owner or Contributor",
      "scores": {
        "Response & Timeliness":         { "score": 0, "max": 17, "deduction_reason": "specific reason or 'Full marks'" },
        "Data Quality & Completeness":   { "score": 0, "max": 17, "deduction_reason": "..." },
        "Communication Quality":         { "score": 0, "max": 17, "deduction_reason": "..." },
        "Process & Workflow Compliance": { "score": 0, "max": 17, "deduction_reason": "..." },
        "Technical Handling":            { "score": 0, "max": 16, "deduction_reason": "..." },
        "Closure & Documentation":       { "score": 0, "max": 16, "deduction_reason": "..." }
      },
      "total_score": 0,
      "grade": "Pass or Needs Improvement or Fail",
      "what_did_well": "• bullet 1\n• bullet 2",
      "what_missed": "• bullet 1 with timestamp/evidence\n• bullet 2"
    }
  ]
}
\`\`\`

Grade thresholds: Pass = 85–100, Needs Improvement = 70–84, Fail = below 70.
total_score MUST equal the sum of all six category scores. Max = ${TOTAL_MAX}.

Then write the full markdown audit report after the JSON block.`;
}

function buildUserMessage(ticketText: string, fileName: string): string {
  return `Please audit this ticket file.

TICKET FILE: ${fileName}

${ticketText}`;
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
  const systemMessage = buildSystemMessage();
  const userMessage = buildUserMessage(truncated, fileName ?? "unknown.mhtml");

  // Send rules as role:"system" — this takes priority over any agent-level
  // system prompt configured on Devs.ai, ensuring our scoring rules win.
  const upstream = await fetch(`${platformUrl}/api/v1/chats/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: agentId,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user",   content: userMessage },
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
