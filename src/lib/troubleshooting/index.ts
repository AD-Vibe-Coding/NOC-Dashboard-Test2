/**
 * Structured troubleshooting engine (Option A).
 *
 * Usage:
 *   import { PATHS, startWizard, markWorked, markStillIssue } from "@/lib/troubleshooting";
 *   // or relative: from "../../lib/troubleshooting"
 */

export type {
  CarrierId,
  DeviceFamily,
  IssueDefinition,
  TemplateContext,
  TroubleshootPath,
  TroubleshootStep,
  WizardState,
  WizardStatus,
} from "./types";

export {
  CARRIER_LABELS,
  DEVICE_LABELS,
  DEVICE_OPTIONS,
} from "./types";

export { resolvePath, validateAllPaths, validatePath } from "./resolvePath";
export { deviceStepsFor, fillTemplate } from "./fillTemplate";
export {
  advanceCheckStep,
  currentStep,
  dismissTemplate,
  generateSummary,
  markStillIssue,
  markWorked,
  previewCurrentTemplate,
  progress,
  restartWizard,
  startWizard,
  type StartWizardInput,
} from "./wizard";
