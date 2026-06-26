export type AssistantMode = "escalation" | "polish";
export type Audience = "customer" | "internal" | "carrier" | "executive";
export type EscalationVariantKey = "carrier" | "internal" | "customer" | "executive";
export type PolishVariantKey = "polish-customer" | "polish-internal" | "polish-carrier" | "polish-executive";
export type OutputVariantKey = EscalationVariantKey | PolishVariantKey;

export type StructuredContext = {
  ticketNumber: string;
  customerName: string;
  carrierTicket: string;
  site: string;
  eta: string;
  nextUpdate: string;
  impact: string;
  serviceType: string;
  ask: string;
};

export type QualityCheck = {
  label: string;
  status: "good" | "warn" | "missing";
  detail: string;
};

export function splitSubjectBody(text: string) {
  const lines = text.split(/\r?\n/);
  let subjectLine = "";
  let bodyStart = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i += 1) {
    const match = /^\s*subject\s*[:\-—]\s*(.*)$/i.exec(lines[i]);
    if (match) {
      subjectLine = match[1].trim();
      bodyStart = i + 1;
      break;
    }
  }
  while (bodyStart < lines.length && lines[bodyStart].trim() === "") bodyStart += 1;
  return { subject: subjectLine, body: lines.slice(bodyStart).join("\n").trim() };
}

export function markdownToPlainText(md: string) {
  return md
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^---+$/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeSourceText(input: string) {
  return input
    .replace(/\r/g, "")
    .replace(/^from:.*$/gim, "")
    .replace(/^sent:.*$/gim, "")
    .replace(/^subject:.*$/gim, "")
    .replace(/^best regards,.*$/gim, "")
    .replace(/^thanks,.*$/gim, "")
    .replace(/\t+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function matchRegex(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

export function extractStructuredContext(text: string): StructuredContext {
  return {
    ticketNumber: matchRegex(text, [
      /(?:appdirect|ad|noc)?\s*ticket\s*(?:#|number|no\.?|:)\s*([A-Z0-9\-]+)/i,
      /\b(ticket|case)\s*#?\s*([A-Z0-9\-]{5,})/i,
    ]).replace(/^(ticket|case)\s*/i, ""),
    customerName: matchRegex(text, [
      /customer\s*(?:name)?\s*[:\-]\s*([^\n]+)/i,
      /account\s*[:\-]\s*([^\n]+)/i,
    ]),
    carrierTicket: matchRegex(text, [
      /carrier\s*(?:ticket|case|ref(?:erence)?)\s*[:#\-]\s*([^\n]+)/i,
      /circuit\s*(?:id|#)?\s*[:\-]\s*([^\n]+)/i,
    ]),
    site: matchRegex(text, [
      /site\s*[:\-]\s*([^\n]+)/i,
      /location\s*[:\-]\s*([^\n]+)/i,
      /address\s*[:\-]\s*([^\n]+)/i,
    ]),
    eta: matchRegex(text, [
      /\bETA\b\s*[:\-]\s*([^\n]+)/i,
      /estimated\s*(?:time|repair)\s*[:\-]\s*([^\n]+)/i,
    ]),
    nextUpdate: matchRegex(text, [
      /next\s*update\s*(?:by|at)?\s*[:\-]?\s*([^\n]+)/i,
      /update\s*cadence\s*[:\-]\s*([^\n]+)/i,
    ]),
    impact: matchRegex(text, [
      /impact\s*[:\-]\s*([^\n]+)/i,
      /customer\s*impact\s*[:\-]\s*([^\n]+)/i,
      /issue\s*[:\-]\s*([^\n]+)/i,
    ]),
    serviceType: matchRegex(text, [
      /service\s*(?:type)?\s*[:\-]\s*([^\n]+)/i,
      /circuit\s*type\s*[:\-]\s*([^\n]+)/i,
    ]),
    ask: matchRegex(text, [
      /need\s*[:\-]\s*([^\n]+)/i,
      /request\s*[:\-]\s*([^\n]+)/i,
      /next\s*step\s*[:\-]\s*([^\n]+)/i,
    ]),
  };
}

export function findMissingFields(context: StructuredContext, mode: AssistantMode) {
  const base = [
    { key: "ticketNumber", label: "Ticket number", value: context.ticketNumber },
    { key: "customerName", label: "Customer name", value: context.customerName },
    { key: "impact", label: "Impact statement", value: context.impact },
    { key: "nextUpdate", label: "Next update cadence", value: context.nextUpdate },
  ];
  const escalation = [
    { key: "carrierTicket", label: "Carrier ticket / circuit", value: context.carrierTicket },
    { key: "site", label: "Site / location", value: context.site },
    { key: "ask", label: "Concrete ask to carrier", value: context.ask },
  ];
  return [...base, ...(mode === "escalation" ? escalation : [])].filter((item) => !item.value.trim());
}

export function generateSubjectSuggestions(params: {
  mode: AssistantMode;
  audience?: Audience;
  customerName?: string;
  ticketNumber?: string;
  carrierName?: string;
  impact?: string;
  intentLabel?: string;
}) {
  const customer = params.customerName || "Customer";
  const ticket = params.ticketNumber || "[Ticket #]";
  const carrier = params.carrierName || "Carrier";
  const impact = params.impact || "Service issue";
  const intent = params.intentLabel || (params.mode === "escalation" ? "Escalation" : "Update");

  if (params.mode === "escalation") {
    return [
      `ESC-MGR Alert | ${ticket} | ${customer} | ${impact}`,
      `${intent} Request | ${carrier} | ${customer} | ${impact}`,
      `${customer} | ${impact} | Next steps needed`,
      `${carrier} escalation | ${ticket} | ${impact}`,
    ];
  }

  return [
    `${customer} | ${impact}`,
    `${intent} | ${ticket} | ${customer}`,
    `${carrier !== "Carrier" ? `${carrier} | ` : ""}${impact} | Status update`,
    `${customer} | Next update and current status`,
  ];
}

export function buildQualityChecks(params: {
  mode: AssistantMode;
  audience?: Audience;
  subject: string;
  body: string;
  context: StructuredContext;
}) {
  const subject = params.subject.trim();
  const rawBody = params.body.trim();
  const body = rawBody.toLowerCase();
  const fullText = `${subject}\n${rawBody}`.toLowerCase();

  const hasPlaceholder = /\[[^\]]+\]|<[^>]+>|\b(?:tbd|unknown|insert|n\/a)\b/i.test(`${subject}\n${rawBody}`);
  const hasExplicitImpact =
    Boolean(params.context.impact.trim()) ||
    /impact|outage|degraded|down|intermittent|service(?:\s+is)?\s+affected|customer(?:\s+is)?\s+unable/.test(body);
  const hasNextUpdate =
    Boolean(params.context.nextUpdate.trim()) ||
    /next update|follow(?:-|\s)?up|update by|cadence|we will provide.*update|next status/.test(body);
  const hasTimeReference =
    Boolean(params.context.eta.trim() || params.context.nextUpdate.trim()) ||
    /\b(?:eta|etr|by\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}:\d{2}\s*(?:am|pm)|today|tomorrow|within\s+\d+\s*(?:min|mins|minutes|hours))\b/i.test(rawBody);
  const hasTicketReference =
    Boolean(params.context.ticketNumber.trim()) ||
    /\bticket\b|\bcase\b|\binc\d+\b|\bim\d+\b|\bchg\d+\b/i.test(fullText);
  const hasCustomerReference = Boolean(params.context.customerName.trim()) || /\bcustomer\b/.test(body);
  const hasCarrierReference = Boolean(params.context.carrierTicket.trim()) || /carrier ticket|circuit id|reference:/.test(body);
  const hasConcreteAsk =
    Boolean(params.context.ask.trim()) ||
    /what we need from you|please confirm|provide (?:an )?(?:eta|etr|update)|dispatch|escalat|investigat|advise|confirm receipt|next steps/.test(body);
  const hasOwnerOrActor =
    /carrier|noc|provider|engineer|dispatch|field tech|appdirect|we have engaged|team is working|vendor/.test(body);
  const hasStatusEvidence =
    /current status|investigation summary|latest update|observ(?:ed|ation)|test(?:ed|ing)?|identified|isolated|confirmed|engaged|working/.test(body);
  const hasCourtesyClose =
    /best regards|thanks,|thank you|please don't hesitate|let me know if any further assistance is needed/.test(body);
  const vagueLanguage = /maybe|might|possibly|hopefully|i think|seems like|appears to be|probably|sort of|kind of/.test(body);
  const customerJargon = /mpls|bgp|ospf|crc|los|flap|flapping|optical|layer\s*[23]|wan edge|sd-?wan|handoff|demarc/.test(body);
  const passiveNoAction = /monitor(?:ing)? only|awaiting update|waiting on update/.test(body) && !hasConcreteAsk;

  const checks: QualityCheck[] = [
    {
      label: "Subject line quality",
      status: !subject ? "missing" : subject.length < 12 ? "warn" : "good",
      detail: !subject
        ? "Add a subject with the ticket, customer, and issue summary."
        : subject.length < 12
          ? "Subject exists, but it is too short for NOC use. Make it more specific."
          : "Subject looks specific enough for operational use.",
    },
    {
      label: "No unresolved placeholders",
      status: hasPlaceholder ? "missing" : "good",
      detail: hasPlaceholder
        ? "Template placeholders or TBD-style values are still present. Resolve them before sending."
        : "No unresolved placeholders detected.",
    },
    {
      label: "Ticket / case reference",
      status: hasTicketReference ? "good" : "missing",
      detail: hasTicketReference
        ? "A ticket or case reference is present."
        : "Add the vCom ticket or case number so the update can be tracked.",
    },
    {
      label: "Customer impact statement",
      status: hasExplicitImpact ? "good" : "missing",
      detail: hasExplicitImpact
        ? "Customer impact is stated clearly."
        : "State exactly how the customer is affected (down, degraded, intermittent, etc.).",
    },
    {
      label: "Current status / evidence",
      status: hasStatusEvidence ? "good" : "warn",
      detail: hasStatusEvidence
        ? "The update includes current investigative status or evidence."
        : "Add current findings, tests performed, or the latest carrier status.",
    },
    {
      label: "Next update or ETA",
      status: hasNextUpdate && hasTimeReference ? "good" : hasNextUpdate || hasTimeReference ? "warn" : "missing",
      detail: hasNextUpdate && hasTimeReference
        ? "Follow-up timing is present with a usable time reference."
        : hasNextUpdate || hasTimeReference
          ? "There is some timing language, but NOC updates should include a clearer next-update commitment or ETA/ETR."
          : "Add a concrete next update time, cadence, ETA, or ETR.",
    },
    {
      label: "Named actor / owner",
      status: hasOwnerOrActor ? "good" : "warn",
      detail: hasOwnerOrActor
        ? "The update identifies who is working the issue."
        : "Call out who is engaged (carrier, field tech, NOC engineer, provider, etc.).",
    },
    {
      label: "Confident operational wording",
      status: vagueLanguage ? "warn" : "good",
      detail: vagueLanguage
        ? "The wording includes uncertainty terms like 'maybe' or 'probably'. Tighten the language for NOC communication."
        : "Language is appropriately direct and operational.",
    },
  ];

  if (params.mode === "escalation") {
    checks.push(
      {
        label: "Carrier reference",
        status: hasCarrierReference ? "good" : "warn",
        detail: hasCarrierReference
          ? "Carrier ticket, circuit, or reference data is present."
          : "Include the carrier ticket, circuit ID, or another provider-side reference if available.",
      },
      {
        label: "Concrete ask to carrier",
        status: hasConcreteAsk ? "good" : "missing",
        detail: hasConcreteAsk
          ? "The escalation includes an explicit action request."
          : "State exactly what you need from the carrier: ETA, dispatch, escalation, investigation update, or confirmation.",
      },
      {
        label: "Not passive / stalled",
        status: passiveNoAction ? "warn" : "good",
        detail: passiveNoAction
          ? "The message reads as passive ('awaiting update') without a direct ask. Add a firm next action."
          : "The escalation includes an active next-step posture.",
      },
    );
  }

  if (params.audience === "customer") {
    checks.push(
      {
        label: "Customer-friendly language",
        status: customerJargon ? "warn" : "good",
        detail: customerJargon
          ? "Heavy telecom jargon detected. Simplify this for a customer-facing message."
          : "Language is appropriate for customer-facing communication.",
      },
      {
        label: "Reassurance + close",
        status: hasCourtesyClose ? "good" : "warn",
        detail: hasCourtesyClose
          ? "The message closes with a customer-safe follow-up tone."
          : "Add a courteous close and reassure the customer you will continue to provide updates.",
      },
    );
  }

  if (params.audience === "internal") {
    const conciseInternal = rawBody.split(/\r?\n/).length <= 18 && rawBody.length <= 1800;
    checks.push({
      label: "Internal brevity",
      status: conciseInternal ? "good" : "warn",
      detail: conciseInternal
        ? "The message length is appropriate for an internal NOC update."
        : "Internal updates should stay concise and highly scannable.",
    });
  }

  if (params.audience === "carrier") {
    const hasCarrierClose = /confirm receipt|provide.*eta|updated eta|next steps|dispatch/.test(body);
    checks.push({
      label: "Carrier follow-up demand",
      status: hasCarrierClose ? "good" : "warn",
      detail: hasCarrierClose
        ? "The carrier email clearly asks for a follow-up response."
        : "Ask the carrier to confirm receipt and provide ETA/next steps.",
    });
  }

  if (!hasCustomerReference && params.audience !== "internal") {
    checks.push({
      label: "Customer identification",
      status: "warn",
      detail: "External communications are stronger when the customer or site is identified clearly.",
    });
  }

  return checks;
}

export function createDiffLines(previousText: string, currentText: string) {
  const before = previousText.split(/\r?\n/);
  const after = currentText.split(/\r?\n/);
  const max = Math.max(before.length, after.length);
  const lines: Array<{ type: "same" | "added" | "removed" | "changed"; text: string }> = [];

  for (let i = 0; i < max; i += 1) {
    const prev = before[i] ?? "";
    const next = after[i] ?? "";
    if (prev === next) {
      if (next.trim()) lines.push({ type: "same", text: next });
      continue;
    }
    if (!prev && next) {
      lines.push({ type: "added", text: next });
      continue;
    }
    if (prev && !next) {
      lines.push({ type: "removed", text: prev });
      continue;
    }
    lines.push({ type: "changed", text: `- ${prev}` });
    lines.push({ type: "changed", text: `+ ${next}` });
  }

  return lines.slice(0, 80);
}

export function makeOutlookFriendlyEmail(subject: string, body: string, extra: string[] = []) {
  const plain = markdownToPlainText(body).replace(/\n/g, "\r\n");
  return [...extra, `Subject: ${subject}`, "", plain].filter(Boolean).join("\r\n");
}
