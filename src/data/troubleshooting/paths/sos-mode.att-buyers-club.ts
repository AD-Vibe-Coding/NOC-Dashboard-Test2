import type { TroubleshootPath } from "../../../lib/troubleshooting/types";
import {
  ATT_TIER1,
  DEVICE_NETWORK_RESET,
  OPUS_SOURCE,
  OPUS_URL,
  SIGN_OFF,
  ATT_PLANS_HELP,
  OPUS_IMEI_ICCID_HELP,
} from "./_shared";

/**
 * SOS Mode — ATT Buyers' Club
 * Connectivity/provisioning first; may escalate to SIM/device.
 */
export const SOS_ATT_BUYERS_CLUB: TroubleshootPath = {
  id: "sos-mode--att-buyers-club--any",
  issueId: "sos-mode",
  carrier: "att-buyers-club",
  deviceFamily: "any",
  title: "SOS Mode — ATT Buyers' Club",
  sourceUrl: OPUS_SOURCE,
  steps: [
    {
      id: "sos-att-01",
      order: 1,
      title: "Treat as connectivity/provisioning — verify OPUS",
      checkOnly: true,
      helpLinks: [OPUS_IMEI_ICCID_HELP, ATT_PLANS_HELP],
      instructions: [
        `Verify IMEI and ICCID in OPUS (${OPUS_URL})`,
        "Confirm whether the device uses eSIM or physical SIM",
        "Note any recent activation or SIM change",
      ],
      resolvedTemplate: `Hello,

We verified your line in the carrier portal. Please retest whether your {{deviceLabel}} still shows SOS-only and share the result.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We verified your line details. Next we will send a network refresh (OTA) and guide a network reset (and SIM reseat if physical SIM).

${SIGN_OFF}`,
    },
    {
      id: "sos-att-02",
      order: 2,
      title: "Send OTA + network reset / SIM reseat",
      instructions: [
        "Send OTA from OPUS",
        "Instruct network reset; physical SIM: remove/reseat",
        "Retest whether device registers (no longer SOS-only)",
      ],
      deviceNotes: { ...DEVICE_NETWORK_RESET },
      resolvedTemplate: `Hello,

After the network refresh and device steps, your {{deviceLabel}} should register on the network. Please confirm it is no longer stuck on SOS.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We sent a network refresh (OTA). Please complete:

{{deviceSteps}}

Then check whether the device leaves SOS mode and can place/receive calls.

${SIGN_OFF}`,
    },
    {
      id: "sos-att-03",
      order: 3,
      title: "Carrier registration check",
      instructions: [
        ATT_TIER1,
        "Validate line provisioning and network registration",
        "Document case/reference",
      ],
      resolvedTemplate: `Hello,

Carrier registration checks are complete. Please confirm your {{deviceLabel}} is no longer in SOS mode.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We contacted the carrier about SOS/registration. Next we may test a new eSIM or physical SIM depending on device capability.

${SIGN_OFF}`,
    },
    {
      id: "sos-att-04",
      order: 4,
      title: "New SIM/eSIM test or warranty path",
      instructions: [
        "If unresolved: test new eSIM or physical SIM based on device capability",
        "If all service TS complete and hardware-related: evaluate warranty eligibility",
      ],
      isTerminal: true,
      resolvedTemplate: `Hello,

After the SIM/eSIM or device path, service should be restored on your {{deviceLabel}}. Please confirm it is no longer in SOS mode.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We completed SOS-mode troubleshooting including carrier registration checks. If the device still cannot register, next steps are SIM/eSIM replacement completion or warranty evaluation with your point of contact.

${SIGN_OFF}`,
    },
  ],
};
