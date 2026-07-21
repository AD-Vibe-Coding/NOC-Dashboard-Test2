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
 * Network connectivity / Poor connection — ATT Buyers' Club
 * Shorter path than full Calls (no full 7-step call isolation unless needed).
 */
export const NETWORK_ATT_BUYERS_CLUB: TroubleshootPath = {
  id: "network-connectivity--att-buyers-club--any",
  issueId: "network-connectivity",
  carrier: "att-buyers-club",
  deviceFamily: "any",
  title: "Network connectivity / Poor connection — ATT Buyers' Club",
  sourceUrl: OPUS_SOURCE,
  steps: [
    {
      id: "net-att-01",
      order: 1,
      title: "Verify IMEI/ICCID and provisioned state",
      checkOnly: true,
      helpLinks: [OPUS_IMEI_ICCID_HELP, ATT_PLANS_HELP],
      instructions: [
        `Log into OPUS (${OPUS_URL}) and verify IMEI and ICCID match inventory`,
        "Confirm the line is provisioned correctly",
        "Note whether symptoms are intermittent, weak signal, or unstable registration",
      ],
      resolvedTemplate: `Hello,

We verified your line details on the carrier side. Please retest connectivity on your {{deviceLabel}} and share the result.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We verified your line details on the carrier side. Next we will send a network refresh (OTA) and guide device network reset steps.

${SIGN_OFF}`,
    },
    {
      id: "net-att-02",
      order: 2,
      title: "Send OTA + device network reset",
      instructions: [
        "Send OTA from OPUS",
        "Have user complete network reset; physical SIM: SIM pull/reseat",
        "Retest registration and data/voice stability",
      ],
      deviceNotes: { ...DEVICE_NETWORK_RESET },
      resolvedTemplate: `Hello,

After the network refresh and device reset, connectivity should be stable on your {{deviceLabel}}. Please retest and confirm.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We sent a network refresh (OTA). Please complete:

{{deviceSteps}}

Then retest signal/connectivity and reply with results (including your approximate location if signal is weak).

${SIGN_OFF}`,
    },
    {
      id: "net-att-03",
      order: 3,
      title: "Contact AT&T for outage / local network conditions",
      instructions: [
        ATT_TIER1,
        "Verify outage, provisioning, and local network conditions",
        "Document findings; if SIM-related behavior: move to SIM/eSIM replacement",
        "If network strength is consistently poor at the user location: document and recommend alternate carrier coverage review with POC",
      ],
      isTerminal: true,
      resolvedTemplate: `Hello,

Carrier checks are complete and connectivity should be improved. Please retest on your {{deviceLabel}} and confirm.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We completed connectivity troubleshooting including carrier review. If signal remains poor at your location, your point of contact may need to evaluate alternate coverage or device replacement options. Please reply with the latest results so we can document next steps.

${SIGN_OFF}`,
    },
  ],
};
