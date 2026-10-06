import {
  addEsimStepsFor,
  deleteEsimStepsFor,
  deviceStepsFor,
  fillTemplate,
} from "./fillTemplate";
import { resolvePath } from "./resolvePath";
import {
  CARRIER_LABELS,
  DEVICE_LABELS,
  type CarrierId,
  type CompletedStepRecord,
  type DeviceFamily,
  type TemplateContext,
  type TroubleshootPath,
  type WizardState,
} from "./types";

export type StartWizardInput = {
  paths: TroubleshootPath[];
  issueId: string;
  carrier: CarrierId;
  device: Exclude<DeviceFamily, "any">;
  /** Optional values for template placeholders */
  templateDefaults?: Partial<
    Pick<TemplateContext, "customerName" | "ticketId" | "imei" | "iccid">
  >;
};

export function startWizard(
  input: StartWizardInput,
): { ok: true; state: WizardState } | { ok: false; error: string } {
  const path = resolvePath(
    input.paths,
    input.issueId,
    input.carrier,
    input.device,
  );
  if (!path) {
    return {
      ok: false,
      error: `No runbook path for issue=${input.issueId}, carrier=${input.carrier}, device=${input.device}`,
    };
  }
  if (!path.steps.length) {
    return { ok: false, error: `Path ${path.id} has zero steps` };
  }

  return {
    ok: true,
    state: {
      issueId: input.issueId,
      carrier: input.carrier,
      device: input.device,
      path,
      currentStepIndex: 0,
      status: "in_progress",
      activeTemplate: null,
      templateKind: null,
      completedSteps: [],
      generatedSummary: null,
    },
  };
}

function ctxFor(
  state: WizardState,
  extras?: StartWizardInput["templateDefaults"],
): TemplateContext {
  const step = state.path.steps[state.currentStepIndex];
  return {
    customerName: extras?.customerName,
    deviceLabel: DEVICE_LABELS[state.device],
    carrierLabel: CARRIER_LABELS[state.carrier],
    stepTitle: step.title,
    stepNumber: state.currentStepIndex + 1,
    totalSteps: state.path.steps.length,
    deviceSteps: deviceStepsFor(step, state.device),
    deleteEsimSteps: deleteEsimStepsFor(step, state.device),
    addEsimSteps: addEsimStepsFor(step, state.device),
    ticketId: extras?.ticketId,
    imei: extras?.imei,
    iccid: extras?.iccid,
  };
}

export function currentStep(state: WizardState) {
  return state.path.steps[state.currentStepIndex];
}

export function previewCurrentTemplate(
  state: WizardState,
  kind: "resolved" | "continue" | "escalation" = "continue",
  extras?: StartWizardInput["templateDefaults"],
): string | null {
  const step = currentStep(state);

  if (kind === "resolved") {
    return step.resolvedTemplate
      ? fillTemplate(step.resolvedTemplate, "resolved", ctxFor(state, extras))
      : null;
  }

  if (kind === "escalation") {
    return step.continueTemplate
      ? fillTemplate(step.continueTemplate, "escalation", ctxFor(state, extras))
      : null;
  }

  return step.continueTemplate
    ? fillTemplate(step.continueTemplate, "continue", ctxFor(state, extras))
    : null;
}

export function progress(state: WizardState) {
  return {
    current: state.currentStepIndex + 1,
    total: state.path.steps.length,
    isLast: state.currentStepIndex >= state.path.steps.length - 1,
  };
}

function customerActionsForStep(state: WizardState): string[] {
  const step = currentStep(state);
  return [
    ...(step.deviceNotes?.[state.device] ?? []),
    ...(step.deleteEsimNotes?.[state.device] ?? []),
    ...(step.addEsimNotes?.[state.device] ?? []),
  ];
}

function recordCompletedStep(state: WizardState): CompletedStepRecord[] {
  const step = currentStep(state);
  const stepNumberLabel = step.displayOrderLabel ?? String(state.currentStepIndex + 1);
  const nextRecord: CompletedStepRecord = {
    stepId: step.id,
    stepTitle: step.title,
    stepNumberLabel,
    nocActions: [...step.instructions],
    customerActions: customerActionsForStep(state),
  };

  const withoutCurrent = state.completedSteps.filter((item) => item.stepId !== step.id);
  return [...withoutCurrent, nextRecord];
}

export function generateSummary(state: WizardState): WizardState {
  const completedSteps = recordCompletedStep(state);

  const completedTitles = completedSteps.map(
    (record) => `Step ${record.stepNumberLabel}: ${record.stepTitle}`,
  );

  const customerActionTitles = completedSteps
    .filter((record) => record.customerActions.length > 0)
    .map((record) => `Step ${record.stepNumberLabel}: ${record.stepTitle}`);

  const sawCarrierEngagement = completedSteps.some((record) =>
    [...record.nocActions, ...record.customerActions].some((action) =>
      /(carrier|at&t|att|network-side|outage)/i.test(action),
    ),
  );

  const finalDisposition =
    "Issue isolated as device-related after completion of troubleshooting. Warranty replacement recommended if the carrier confirms no further network-side steps are required.";

  const summary = [
    ["Ticket Update — ", state.path.title].join(""),
    ["Carrier: ", CARRIER_LABELS[state.carrier]].join(""),
    ["Device: ", DEVICE_LABELS[state.device]].join(""),
    "",
    [
      "Runbook completed through ",
      currentStep(state).displayOrderLabel ?? String(state.currentStepIndex + 1),
      " (",
      currentStep(state).title,
      ").",
    ].join(""),
    "",
    "NOC actions completed:",
    completedTitles.length
      ? `Completed structured troubleshooting steps: ${completedTitles.join("; ")}.`
      : "No NOC actions recorded.",
    sawCarrierEngagement
      ? "Carrier was engaged and troubleshooting completed was documented for carrier-side review."
      : "Carrier engagement not captured in the completed runbook steps.",
    "",
    "Customer actions completed:",
    customerActionTitles.length
      ? `Customer completed guided device actions during: ${customerActionTitles.join("; ")}.`
      : "No customer-performed device actions were recorded in the completed steps.",
    "",
    "Disposition:",
    finalDisposition,
  ].join("\n");

  return {
    ...state,
    completedSteps,
    generatedSummary: summary,
  };
}

/** Tech: "Yes, it worked" (action steps only — not checkOnly). */
export function markWorked(
  state: WizardState,
  extras?: StartWizardInput["templateDefaults"],
): WizardState {
  if (state.status !== "in_progress") return state;
  const step = currentStep(state);
  // Check-only steps never resolve the ticket — use advanceCheckStep instead.
  if (step.checkOnly) return advanceCheckStep(state, extras);
  return {
    ...state,
    status: "resolved",
    templateKind: "resolved",
    activeTemplate: fillTemplate(
      step.resolvedTemplate,
      "resolved",
      ctxFor(state, extras),
    ),
    completedSteps: recordCompletedStep(state),
    generatedSummary: null,
  };
}

/**
 * Tech: "Next step" on a pure checklist/customer-action step (checkOnly).
 * These steps do not branch on worked/still-issue, but they MAY still emit a
 * continue template (for example: ask the customer to complete a network reset)
 * before advancing to the next step.
 */
export function advanceCheckStep(
  state: WizardState,
  extras?: StartWizardInput["templateDefaults"],
): WizardState {
  if (state.status !== "in_progress") return state;

  const step = currentStep(state);
  const { isLast } = progress(state);

  if (isLast || step.isTerminal) {
    return {
      ...state,
      status: "escalated",
      templateKind: step.continueTemplate ? "escalation" : null,
      activeTemplate: step.continueTemplate
        ? fillTemplate(step.continueTemplate, "escalation", ctxFor(state, extras))
        : null,
      completedSteps: recordCompletedStep(state),
      generatedSummary: null,
    };
  }

  return {
    ...state,
    currentStepIndex: state.currentStepIndex + 1,
    status: "in_progress",
    templateKind: step.continueTemplate ? "continue" : null,
    activeTemplate: step.continueTemplate
      ? fillTemplate(step.continueTemplate, "continue", ctxFor(state, extras))
      : null,
    completedSteps: recordCompletedStep(state),
    generatedSummary: null,
  };
}

/** Tech: "Still an issue, proceed" */
export function markStillIssue(
  state: WizardState,
  extras?: StartWizardInput["templateDefaults"],
): WizardState {
  if (state.status !== "in_progress") return state;

  const step = currentStep(state);
  // Check-only steps advance with a single Next step action.
  if (step.checkOnly) return advanceCheckStep(state, extras);

  const { isLast } = progress(state);

  if (isLast || step.isTerminal) {
    return {
      ...state,
      status: "escalated",
      templateKind: "escalation",
      activeTemplate: fillTemplate(
        step.continueTemplate,
        "escalation",
        ctxFor(state, extras),
      ),
      completedSteps: recordCompletedStep(state),
      generatedSummary: null,
    };
  }

  // Template for the step we just finished, then advance to the next step
  const template = step.suppressContinueTemplate
    ? null
    : fillTemplate(step.continueTemplate, "continue", ctxFor(state, extras));

  return {
    ...state,
    currentStepIndex: state.currentStepIndex + 1,
    status: "in_progress",
    templateKind: template ? "continue" : null,
    activeTemplate: template,
    completedSteps: recordCompletedStep(state),
    generatedSummary: null,
  };
}

/** Clear template banner after copy / dismiss */
export function dismissTemplate(state: WizardState): WizardState {
  return { ...state, activeTemplate: null, templateKind: null };
}

/** Restart same path from step 1 */
export function restartWizard(state: WizardState): WizardState {
  return {
    ...state,
    currentStepIndex: 0,
    status: "in_progress",
    activeTemplate: null,
    templateKind: null,
    completedSteps: [],
    generatedSummary: null,
  };
}
