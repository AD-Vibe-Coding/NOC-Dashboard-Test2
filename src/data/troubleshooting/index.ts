/**
 * Structured troubleshooting content catalog (Option A).
 *
 * Add new path files under ./paths and register them in PATHS.
 * The engine never assumes a fixed step count — each path owns its steps[].
 */

import type {
  IssueDefinition,
  TroubleshootPath,
} from "../../lib/troubleshooting/types";
import { validateAllPaths } from "../../lib/troubleshooting/resolvePath";
import { ACTIVATION_ATT_BUYERS_CLUB } from "./paths/activation.att-buyers-club";
import { CALLS_ATT_BUYERS_CLUB } from "./paths/calls-inbound-outbound.att-buyers-club";
import { DATA_ATT_BUYERS_CLUB } from "./paths/data-issue.att-buyers-club";
import { ESIM_ATT_BUYERS_CLUB } from "./paths/esim-issue.att-buyers-club";
import { ROAMING_ATT_BUYERS_CLUB } from "./paths/international-roaming.att-buyers-club";
import { NETWORK_ATT_BUYERS_CLUB } from "./paths/network-connectivity.att-buyers-club";
import { SOS_ATT_BUYERS_CLUB } from "./paths/sos-mode.att-buyers-club";
import { TEXT_ATT_BUYERS_CLUB } from "./paths/text-issue.att-buyers-club";
import { VOICEMAIL_ATT_BUYERS_CLUB } from "./paths/voicemail.att-buyers-club";

export const ISSUES: IssueDefinition[] = [
  {
    id: "calls-inbound-outbound",
    label: "Calls Inbound / Outbound issue",
    description:
      "Inbound/outbound calls, static/gargled voice — full 7-step ATT path",
  },
  {
    id: "sos-mode",
    label: "SOS Mode",
    description: "SOS-only / cannot register on network",
  },
  {
    id: "network-connectivity",
    label: "Network connectivity / Poor connection",
    description: "Weak signal, intermittent registration, unstable service",
  },
  {
    id: "data-issue",
    label: "Data issue",
    description: "No data, slow data, throttle, or data block",
  },
  {
    id: "text-issue",
    label: "Text issue (SMS / MMS / iMessage)",
    description: "SMS, MMS, or iMessage failures",
  },
  {
    id: "esim-issue",
    label: "eSIM Issue",
    description: "eSIM activation, re-provision, install failures",
  },
  {
    id: "international-roaming",
    label: "International Roaming",
    description: "Traveling — calls/text/data abroad",
  },
  {
    id: "voicemail",
    label: "Voicemail / Visual voicemail",
    description: "PIN reset, access, visual voicemail",
  },
  {
    id: "activation",
    label: "Activation / Porting assistance",
    description: "New device activation or port — order-gated",
  },
];

export const PATHS: TroubleshootPath[] = [
  CALLS_ATT_BUYERS_CLUB,
  SOS_ATT_BUYERS_CLUB,
  NETWORK_ATT_BUYERS_CLUB,
  DATA_ATT_BUYERS_CLUB,
  TEXT_ATT_BUYERS_CLUB,
  ESIM_ATT_BUYERS_CLUB,
  ROAMING_ATT_BUYERS_CLUB,
  VOICEMAIL_ATT_BUYERS_CLUB,
  ACTIVATION_ATT_BUYERS_CLUB,
];

/** Dev-time sanity check — logs once if any path is malformed. */
const pathErrors = validateAllPaths(PATHS);
if (pathErrors.length && typeof console !== "undefined") {
  console.warn("[troubleshooting] path validation errors:", pathErrors);
}

export {
  ACTIVATION_ATT_BUYERS_CLUB,
  CALLS_ATT_BUYERS_CLUB,
  DATA_ATT_BUYERS_CLUB,
  ESIM_ATT_BUYERS_CLUB,
  NETWORK_ATT_BUYERS_CLUB,
  ROAMING_ATT_BUYERS_CLUB,
  SOS_ATT_BUYERS_CLUB,
  TEXT_ATT_BUYERS_CLUB,
  VOICEMAIL_ATT_BUYERS_CLUB,
};
