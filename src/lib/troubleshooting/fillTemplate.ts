import type { TemplateContext, TroubleshootStep } from "./types";

const FALLBACK_RESOLVED =
  "Hi {{customerName}},\n\n" +
  "We completed “{{stepTitle}}” (step {{stepNumber}} of {{totalSteps}}) for your {{deviceLabel}} on {{carrierLabel}}. " +
  "Please retest and confirm everything is working.\n\nThank you,\nvCom NOC Support";

const FALLBACK_CONTINUE =
  "Hi {{customerName}},\n\n" +
  "We completed “{{stepTitle}}” (step {{stepNumber}} of {{totalSteps}}). " +
  "We are proceeding to the next check.\n\n" +
  "{{deviceSteps}}\n\n" +
  "Please reply with your findings.\n\nThank you,\nvCom NOC Support";

const FALLBACK_ESCALATION =
  "Hi {{customerName}},\n\n" +
  "We completed all standard checks for your {{deviceLabel}} on {{carrierLabel}}, " +
  "including “{{stepTitle}}”. We are escalating for further investigation. " +
  "We will update you with next steps.\n\nThank you,\nvCom NOC Support";

function replaceToken(input: string, token: string, value: string): string {
  return input.split(token).join(value);
}

function apply(template: string, ctx: TemplateContext): string {
  const name = ctx.customerName?.trim() || "there";
  let out = template;
  out = replaceToken(out, "{{customerName}}", name);
  out = replaceToken(out, "{{deviceLabel}}", ctx.deviceLabel);
  out = replaceToken(out, "{{carrierLabel}}", ctx.carrierLabel);
  out = replaceToken(out, "{{stepTitle}}", ctx.stepTitle);
  out = replaceToken(out, "{{stepNumber}}", String(ctx.stepNumber));
  out = replaceToken(out, "{{totalSteps}}", String(ctx.totalSteps));
  out = replaceToken(
    out,
    "{{deviceSteps}}",
    ctx.deviceSteps || "Please retest and share results.",
  );
  out = replaceToken(
    out,
    "{{deleteEsimSteps}}",
    ctx.deleteEsimSteps || "Please delete the current eSIM from your device settings.",
  );
  out = replaceToken(
    out,
    "{{addEsimSteps}}",
    ctx.addEsimSteps || "Please install and activate the new eSIM using the instructions we provided.",
  );
  out = replaceToken(out, "{{ticketId}}", ctx.ticketId || "");
  out = replaceToken(out, "{{imei}}", ctx.imei || "()");
  out = replaceToken(out, "{{iccid}}", ctx.iccid || "()");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export function fillTemplate(
  template: string | undefined,
  kind: "resolved" | "continue" | "escalation",
  ctx: TemplateContext,
): string {
  const source =
    template?.trim() ||
    (kind === "resolved"
      ? FALLBACK_RESOLVED
      : kind === "escalation"
        ? FALLBACK_ESCALATION
        : FALLBACK_CONTINUE);

  return apply(source, ctx);
}

/** Join device-specific notes for the selected device into a numbered list. */
function numberedNotes(notes?: string[]): string {
  if (!notes?.length) return "";
  return notes.map((n, i) => `${i + 1}. ${n}`).join("\n");
}

export function deviceStepsFor(
  step: Pick<TroubleshootStep, "deviceNotes">,
  device: string,
): string {
  const notes =
    step.deviceNotes?.[device as keyof NonNullable<typeof step.deviceNotes>];
  return numberedNotes(notes);
}

export function deleteEsimStepsFor(
  step: Pick<TroubleshootStep, "deleteEsimNotes">,
  device: string,
): string {
  const notes =
    step.deleteEsimNotes?.[
      device as keyof NonNullable<typeof step.deleteEsimNotes>
    ];
  return numberedNotes(notes);
}

export function addEsimStepsFor(
  step: Pick<TroubleshootStep, "addEsimNotes">,
  device: string,
): string {
  const notes =
    step.addEsimNotes?.[device as keyof NonNullable<typeof step.addEsimNotes>];
  return numberedNotes(notes);
}
