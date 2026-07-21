/**
 * Structured troubleshooting engine (Option A).
 *
 * Paths are curated JSON/TS data (from Confluence), not live-parsed prose.
 * Step count is variable per issue + carrier (+ device) — never hardcoded.
 */

export type CarrierId = "att-buyers-club" | "tmobile" | "verizon" | "generic";

export type DeviceFamily =
  | "iphone"
  | "samsung"
  | "pixel"
  | "data-only"
  | "any";

export type WizardStatus = "in_progress" | "resolved" | "escalated";

export type TroubleshootStep = {
  id: string;
  order: number;
  /** Optional UI label override (for example: "6.1") */
  displayOrderLabel?: string;
  title: string;
  /** NOC / agent actions for this step */
  instructions: string[];
  /**
   * Pure NOC checklist step (e.g. verify OPUS details).
   * UI shows only "Next step" — no "Yes, it worked" / "Still an issue" branch
   * and no customer template on advance.
   */
  checkOnly?: boolean;
  /** Optional how-to links shown on the right of the step header */
  helpLinks?: Array<{
    label: string;
    url: string;
  }>;
  /** Device-specific bullets shown only when that device is selected */
  deviceNotes?: Partial<Record<Exclude<DeviceFamily, "any">, string[]>>;
  /** Device-specific steps for deleting an eSIM */
  deleteEsimNotes?: Partial<Record<Exclude<DeviceFamily, "any">, string[]>>;
  /** Device-specific steps for adding / installing a new eSIM */
  addEsimNotes?: Partial<Record<Exclude<DeviceFamily, "any">, string[]>>;
  /** Copy-ready message when tech clicks the left outcome button */
  resolvedTemplate?: string;
  /** Copy-ready message when tech clicks the right outcome button */
  continueTemplate?: string;
  /** Optional custom labels for the left/right outcome buttons */
  outcomeLabels?: {
    resolved?: string;
    continue?: string;
  };
  /** If true, the right outcome button advances without showing a template */
  suppressContinueTemplate?: boolean;
  /** Last step / escalation path */
  isTerminal?: boolean;
};

export type TroubleshootPath = {
  id: string;
  issueId: string;
  carrier: CarrierId;
  deviceFamily: DeviceFamily;
  title: string;
  /** Confluence / OPUS reference (optional) */
  sourceUrl?: string;
  steps: TroubleshootStep[];
};

export type IssueDefinition = {
  id: string;
  label: string;
  description?: string;
};

export type TemplateContext = {
  customerName?: string;
  deviceLabel: string;
  carrierLabel: string;
  stepTitle: string;
  stepNumber: number;
  totalSteps: number;
  deviceSteps: string;
  deleteEsimSteps: string;
  addEsimSteps: string;
  ticketId?: string;
  imei?: string;
  iccid?: string;
};

export type CompletedStepRecord = {
  stepId: string;
  stepTitle: string;
  stepNumberLabel: string;
  nocActions: string[];
  customerActions: string[];
};

export type WizardState = {
  issueId: string;
  carrier: CarrierId;
  device: Exclude<DeviceFamily, "any">;
  path: TroubleshootPath;
  currentStepIndex: number;
  status: WizardStatus;
  /** Last template shown (resolved, continue, or escalation) */
  activeTemplate: string | null;
  templateKind: "resolved" | "continue" | "escalation" | null;
  /** Structured record of completed steps used to generate the final summary */
  completedSteps: CompletedStepRecord[];
  /** Generated recap shown from the final step */
  generatedSummary: string | null;
};

export const CARRIER_LABELS: Record<CarrierId, string> = {
  "att-buyers-club": "ATT Wireless via vCom Buyers' Club",
  tmobile: "T-Mobile",
  verizon: "Verizon",
  generic: "Carrier",
};

export const DEVICE_LABELS: Record<Exclude<DeviceFamily, "any">, string> = {
  iphone: "iPhone",
  samsung: "Samsung",
  pixel: "Google Pixel",
  "data-only": "Data Only device",
};

export const DEVICE_OPTIONS: Array<{
  value: Exclude<DeviceFamily, "any">;
  label: string;
}> = [
  { value: "iphone", label: "iPhone" },
  { value: "samsung", label: "Samsung" },
  { value: "pixel", label: "Google Pixel" },
  { value: "data-only", label: "Data Only device" },
];
