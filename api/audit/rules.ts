/**
 * vCom NOC Ticket Audit Scoring Rules — Single source of truth.
 *
 * All max points, thresholds, deduction triggers, and do-not-penalize rules
 * are defined here so the app controls the scoring model — not the agent.
 * The agent receives these rules verbatim in the prompt and applies them to
 * the ticket evidence to produce numeric scores + qualitative feedback.
 */

export const SCORING_CATEGORIES = [
  {
    name: "Response & Timeliness",
    column: "D",
    max: 17,
    evaluate: `
      Evaluate ONLY actions this individual personally performed:
      - First touch/response time IF THEY sent it (target ≤5 min; average 2 min). Deduct if late.
      - Carrier ticket timing IF THEY engaged the carrier (target ≤15 min of ticket creation). Deduct if late.
      - Follow-up timing for their own updates — unexplained delays.
      - SLA escalation chain adherence during the period THEY were responsible:
          Lead Alert: 2hr, MGR Alert: 3hr, VP Alert: 4hr, SVP Alert: 5hr (in Pending Carrier Action).
      - Review turnaround after Pending Access re-open IF THEY were the responsible tech.
      Award FULL MARKS for any of these items they did not personally perform.`,
  },
  {
    name: "Data Quality & Completeness",
    column: "E",
    max: 17,
    evaluate: `
      - For Owner only: initial ticket fields completeness, issue description, customer info.
      - For all: their own documentation quality, carrier engagement evidence (ticket# NOT required — evidence of contact suffices), troubleshooting they documented.
      - LCON: ONLY deduct if (a) customer provided LCON info and it's NOT captured, OR (b) dispatch was scheduled and dispatch details were not captured/requested — attributed to responsible individual only.
      - RFO shorthand is VALID — "OU", "fiber cut", "carrier outage" etc. are all acceptable. DO NOT penalize.
      Do NOT penalize: Root Cause field blank (non-functional system field), MTTR blank (system-calculated), blank internal notes, missing carrier ticket number, RFO in shorthand/abbreviated form, LCON fields blank when customer never provided info, initial ticket fields for Contributors.`,
  },
  {
    name: "Communication Quality",
    column: "F",
    max: 17,
    evaluate: `
      Evaluate ONLY this individual's own customer-facing communications:
      - Clarity, professionalism, empathy, grammar.
      - Correct notification contacts per account notes.
      - Appropriate tone and usefulness of their updates.
      If they authored NO customer-facing communications, award FULL MARKS.
      Do NOT penalize for blank internal notes or communications authored by others.`,
  },
  {
    name: "Process & Workflow Compliance",
    column: "G",
    max: 17,
    evaluate: `
      Evaluate ONLY process steps this individual was responsible for:
      - Stage changes they made — correct sequence per 7-stage standard.
      - SLA escalation timers during their watch period.
      - Carrier engagement timing for their actions per RFO/circuit grade matrix.
      - Dispatch scheduling/details capture IF THEY handled the dispatch.
      - TSP codes IF THEY opened the carrier ticket AND customer is Stanford Health Care AND service type is DIA/VPLS/MPLS/Point-to-Point ONLY.
      - TTU process if applicable to their actions.
      - Correct and timely stage update after Pending Access re-open IF THEY were responsible.
      Do NOT penalize: auto-timer closure (fully valid), Pending Access appearing after Pending Complete (valid system re-open — NOT a workflow error), missing carrier ticket number, process steps performed by other individuals.`,
  },
  {
    name: "Technical Handling",
    column: "H",
    max: 16,
    evaluate: `
      Evaluate ONLY this individual's own technical work:
      - Their troubleshooting quality and technical accuracy.
      - Their carrier engagement per circuit grade/RFO matrix.
      - Their diagnosis validity and fix appropriateness.
      - Their use of monitoring tools (LogicMonitor, APEX API, eBonding).
      Award FULL MARKS for technical actions they did not personally perform.`,
  },
  {
    name: "Closure & Documentation",
    column: "I",
    max: 16,
    evaluate: `
      Evaluate ONLY closure/documentation this individual performed:
      - RFO documented BY THEM in Next Step field or notes — any shorthand valid (e.g. "OU" = Over Utilization).
      - Service restoration confirmation they handled.
      - Customer confirmation they received or documented.
      - Resolution code IF THEY closed the ticket.
      - Closure method IF THEY closed it — auto-timer and manual are BOTH fully valid.
      Award FULL MARKS for closure/documentation handled by others.
      Do NOT penalize: auto-timer closure, Root Cause field blank, RFO in shorthand.`,
  },
] as const;

export const TOTAL_MAX = SCORING_CATEGORIES.reduce((s, c) => s + c.max, 0); // 100

export const DO_NOT_PENALIZE = `
  NEVER penalize any individual for:
  - Root Cause field blank (known non-functional iPath system field)
  - MTTR field blank (system-calculated, not technician-controlled)
  - Blank or minimal internal notes (not scored)
  - Auto-timer closure (fully equivalent to manual closure — do NOT penalize)
  - Missing carrier ticket number (NOT mandatory — some carriers provide updates directly without tickets)
  - RFO written in shorthand, abbreviation, or codes (e.g., "OU", "fiber cut", "no ETR" — ALL valid)
  - LCON fields blank unless customer provided LCON info not captured OR dispatch was scheduled without capturing/requesting details — and ONLY against the responsible individual
  - Pending Access appearing after Pending Complete — this is a valid system-driven customer re-open event, NOT a workflow error
  - Actions performed by other individuals — ONLY penalize each person for their own actions
  - Optional / non-functional system fields per NOC standards
  - Missing carrier ticket number — evaluate carrier engagement by evidence of contact + documented updates
`;

export const VALID_STAGES = [
  "New",
  "Pending Access / Test Results",
  "Pending Carrier Action / Update",
  "Pending Carrier Information",
  "Customer Confirming Resolution",
  "Pending Complete",
  "Completed",
];

export const FIRST_TOUCH_TARGET_MIN = 5;   // minutes
export const CARRIER_TICKET_TARGET_MIN = 15; // minutes

export const SLA_ESCALATION = {
  lead_hours: 2,
  mgr_hours: 3,
  vp_hours: 4,
  svp_hours: 5,
};
