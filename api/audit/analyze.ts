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
import { SCORING_CATEGORIES, TOTAL_MAX, DO_NOT_PENALIZE, FIRST_TOUCH_TARGET_MIN, CARRIER_TICKET_TARGET_MIN, SLA_ESCALATION } from "./rules.js";

const MAX_TEXT_CHARS = 80_000;

function buildPrompt(ticketText: string, fileName: string): string {
  const categoryTable = SCORING_CATEGORIES.map(c =>
    `| ${c.name} | ${c.column} | ${c.max} |`
  ).join("\n");

  const categoryDetails = SCORING_CATEGORIES.map(c => `
### ${c.name} (max ${c.max} pts — Column ${c.column})
${c.evaluate.trim()}`).join("\n");

  return `You are auditing a vCom NOC support ticket. The scoring rules below are defined by the app — apply them exactly. Do NOT use any other scoring model.

---

## SCORING MODEL (app-defined — apply exactly)

### Categories & Max Points
| Category | Sheet Column | Max Points |
|---|---|---|
${categoryTable}
| **TOTAL** | J | **${TOTAL_MAX}** |

### Timeliness Thresholds
- First touch target: ≤${FIRST_TOUCH_TARGET_MIN} minutes from ticket creation
- Carrier engagement target: ≤${CARRIER_TICKET_TARGET_MIN} minutes from ticket creation
- SLA escalation (Pending Carrier Action): Lead@${SLA_ESCALATION.lead_hours}hr, MGR@${SLA_ESCALATION.mgr_hours}hr, VP@${SLA_ESCALATION.vp_hours}hr, SVP@${SLA_ESCALATION.svp_hours}hr

### Category Evaluation Rules
${categoryDetails}

### NEVER PENALIZE FOR
${DO_NOT_PENALIZE.trim()}

---

## YOUR TASK

Analyze the ticket below and perform a complete audit. Identify EVERY individual who worked the ticket (Owner + all Contributors). Score each person separately.

**STEP 1 — Extract ticket metadata:**
Ticket number, date, subject, queue (noc/mobility), ticket owner, all contributors with their roles and actions.

**STEP 2 — Score each individual** using ONLY the app-defined scoring rules above.
For any scoring item NOT applicable to an individual (performed by someone else), award FULL MARKS.

**STEP 3 — Output a \`\`\`json block** with this exact structure (one entry per individual):

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
        "Response & Timeliness":        { "score": 0, "max": 17, "deduction_reason": "why points were deducted, or 'Full marks' if none" },
        "Data Quality & Completeness":  { "score": 0, "max": 17, "deduction_reason": "..." },
        "Communication Quality":        { "score": 0, "max": 17, "deduction_reason": "..." },
        "Process & Workflow Compliance":{ "score": 0, "max": 17, "deduction_reason": "..." },
        "Technical Handling":           { "score": 0, "max": 16, "deduction_reason": "..." },
        "Closure & Documentation":      { "score": 0, "max": 16, "deduction_reason": "..." }
      },
      "total_score": 0,
      "grade": "Pass or Needs Improvement or Fail",
      "what_did_well": "• bullet 1\n• bullet 2\n• bullet 3",
      "what_missed": "• bullet 1 with timestamp/evidence\n• bullet 2"
    }
  ]
}
\`\`\`

Grade thresholds: Pass = 85–100, Needs Improvement = 70–84, Fail = below 70.
total_score MUST equal sum of all six category scores. Max 100.

**STEP 4 — After the JSON block**, write your full markdown audit report covering:
- Extracted Ticket Information (table)
- Ticket Content Review
- Individual Audit sections (one per person) with Score Breakdown table, ✅ What You Did Well, ❌ What You Missed

---

## TICKET FILE: ${fileName}

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
  const prompt = buildPrompt(truncated, fileName ?? "unknown.mhtml");

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
