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
 * Text issue (SMS / MMS / iMessage) — ATT Buyers' Club
 */
export const TEXT_ATT_BUYERS_CLUB: TroubleshootPath = {
  id: "text-issue--att-buyers-club--any",
  issueId: "text-issue",
  carrier: "att-buyers-club",
  deviceFamily: "any",
  title: "Text issue (SMS / MMS / iMessage) — ATT Buyers' Club",
  sourceUrl: OPUS_SOURCE,
  steps: [
    {
      id: "text-att-01",
      order: 1,
      title: "Verify line and device details in OPUS",
      checkOnly: true,
      helpLinks: [OPUS_IMEI_ICCID_HELP, ATT_PLANS_HELP],
      instructions: [
        `Log into OPUS (${OPUS_URL}) and locate the MDN / line`,
        "Confirm IMEI and ICCID match vCom inventory",
        "Confirm messaging features are expected on the plan",
      ],
      resolvedTemplate: `Hello,

We verified your line details on the carrier side (IMEI {{imei}}, ICCID {{iccid}}). Please retest SMS/MMS on your {{deviceLabel}} and let us know the result.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We verified your line details on the carrier side. Next we will send a network refresh (OTA) and guide you through messaging/device checks on your {{deviceLabel}}.

${SIGN_OFF}`,
    },
    {
      id: "text-att-02",
      order: 2,
      title: "Send OTA + device messaging checks",
      instructions: [
        "Send OTA / network refresh from OPUS",
        "Have the user complete network reset steps",
        "If physical SIM: reseat SIM; if eSIM: network reset only",
        "iPhone: confirm iMessage is on and Send & Receive includes the phone number and correct Apple ID",
        "Retest SMS to a non-iPhone number and MMS (picture) if applicable",
      ],
      deviceNotes: {
        ...DEVICE_NETWORK_RESET,
        iphone: [
          ...DEVICE_NETWORK_RESET.iphone,
          "Settings → Messages → iMessage ON",
          "Settings → Messages → Send & Receive: select phone number and correct Apple ID",
        ],
      },
      resolvedTemplate: `Hello,

We refreshed the line and completed messaging/device checks. Please retest SMS/MMS (and iMessage if applicable) on your {{deviceLabel}} and confirm.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We sent a network refresh (OTA). Please complete the steps below, then retest texting:

{{deviceSteps}}

Please share whether SMS, MMS, and/or iMessage still fail, and to which types of numbers.

${SIGN_OFF}`,
    },
    {
      id: "text-att-03",
      order: 3,
      title: "Contact AT&T for messaging provisioning",
      instructions: [
        ATT_TIER1,
        "Ask AT&T to check SMS/MMS provisioning blocks and messaging feature issues",
        "Document case/reference and findings",
      ],
      resolvedTemplate: `Hello,

We worked with the carrier on messaging provisioning. Please retest SMS/MMS on your {{deviceLabel}} and share the result.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We contacted the carrier about your texting issue. Next we may test with a new eSIM or physical SIM if appropriate, then retest messaging.

${SIGN_OFF}`,
    },
    {
      id: "text-att-04",
      order: 4,
      title: "New eSIM / physical SIM test or device path",
      instructions: [
        "If still failing after carrier validation: provision new eSIM or ship/test new physical SIM when appropriate",
        "Retest SMS/MMS after SIM change",
        "If isolated to device: warranty / change-device discussion with POC",
      ],
      isTerminal: true,
      resolvedTemplate: `Hello,

After the latest SIM/eSIM or device steps, messaging should be restored. Please confirm SMS/MMS on your {{deviceLabel}}.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We completed line validation, network refresh, device messaging checks, and carrier messaging review. If texting still fails, next steps are SIM/eSIM replacement completion or device warranty evaluation with your point of contact.

Please reply with the latest test results.

${SIGN_OFF}`,
    },
  ],
};
