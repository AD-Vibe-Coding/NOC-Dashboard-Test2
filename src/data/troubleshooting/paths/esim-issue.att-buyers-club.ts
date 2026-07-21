import type { TroubleshootPath } from "../../../lib/troubleshooting/types";
import { OPUS_SOURCE, OPUS_URL, SIGN_OFF,
  ATT_PLANS_HELP,
  OPUS_IMEI_ICCID_HELP,
} from "./_shared";

/**
 * eSIM Issue — ATT Buyers' Club
 * Activation, re-provision, install failures.
 */
export const ESIM_ATT_BUYERS_CLUB: TroubleshootPath = {
  id: "esim-issue--att-buyers-club--any",
  issueId: "esim-issue",
  carrier: "att-buyers-club",
  deviceFamily: "any",
  title: "eSIM Issue — ATT Buyers' Club",
  sourceUrl: OPUS_SOURCE,
  steps: [
    {
      id: "esim-att-01",
      order: 1,
      title: "Confirm request type and open line in OPUS",
      checkOnly: true,
      helpLinks: [OPUS_IMEI_ICCID_HELP, ATT_PLANS_HELP],
      instructions: [
        "Confirm whether the request is: provision new eSIM, convert physical SIM → eSIM, or fix install failure",
        `Open the line in OPUS (${OPUS_URL}) and review current equipment / eSIM state`,
        "Confirm IMEI(s), EID, and current ICCID against vCom inventory",
        "For 4G iPhone models: ensure activation is performed on the correct IMEI as documented",
      ],
      resolvedTemplate: `Hello,

We reviewed your line and eSIM state in the carrier portal. No further eSIM change appears needed. Please confirm service on your {{deviceLabel}} and reply with the result.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We reviewed your line and eSIM state in the carrier portal. Next we will provision or reinstall the eSIM and guide you through device setup on your {{deviceLabel}}.

${SIGN_OFF}`,
    },
    {
      id: "esim-att-02",
      order: 2,
      title: "Provision / re-provision eSIM in OPUS",
      instructions: [
        "Use OPUS Mobile Maintenance → Get New eSIM / provision workflow",
        "If an existing eSIM must be replaced: have the user delete the old eSIM on-device first when applicable",
        "Guide device install: newer iPhones may show setup banner; older models may need manual Cellular setup",
        "Document how many times eSIM was re-provisioned and why",
        "After success: create/update change order notes so charges can be passed to the customer (C3 / order path as required)",
      ],
      deviceNotes: {
        iphone: [
          "Delete old eSIM if replacing: Settings → Cellular → plan → Delete eSIM",
          "Install: follow carrier QR / OPUS install prompt, or Settings → Cellular → Add eSIM",
          "Confirm line shows under Cellular and is selected for data/voice as needed",
        ],
        samsung: [
          "Settings → Connections → SIM manager → Add eSIM / scan QR as provided",
          "Remove old eSIM profile if replacing before installing the new one",
        ],
        pixel: [
          "Settings → Network & internet → SIMs → Download a SIM instead / Add",
          "Remove old eSIM profile if replacing before installing the new one",
        ],
        "data-only": [
          "Follow OEM eSIM install instructions for the device model",
          "Power cycle after install and confirm data registration",
        ],
      },
      resolvedTemplate: `Hello,

We provisioned a new eSIM for your line. Please complete install on your {{deviceLabel}} if not already done, then retest calls/data/text and confirm.

Device tips:
{{deviceSteps}}

${SIGN_OFF}`,
      continueTemplate: `Hello,

We attempted eSIM provisioning for your line. Please complete the device install steps below and share any error message you see:

{{deviceSteps}}

If install fails, reply with a screenshot of the error so we can escalate.

${SIGN_OFF}`,
    },
    {
      id: "esim-att-03",
      order: 3,
      title: "If portal provisioning fails — escalate to AT&T assurance",
      instructions: [
        "If provisioning fails in OPUS: create a ticket with AT&T partner exchange / Assurance team",
        "Document re-provision count and failure details",
        "Do not leave the customer without next-update expectations",
      ],
      isTerminal: true,
      resolvedTemplate: `Hello,

The eSIM issue has been resolved with the carrier/assurance path. Please confirm your {{deviceLabel}} shows the line active and service works.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We escalated the eSIM provisioning failure to the carrier assurance team and documented the attempts made. We will update you when we have a carrier response or next action.

${SIGN_OFF}`,
    },
  ],
};
