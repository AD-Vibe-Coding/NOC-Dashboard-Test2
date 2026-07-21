import type { TroubleshootPath } from "../../../lib/troubleshooting/types";
import {
  ATT_TIER1,
  OPUS_SOURCE,
  OPUS_URL,
  SIGN_OFF,
} from "./_shared";

/**
 * Voicemail / Visual voicemail — ATT Buyers' Club
 */
export const VOICEMAIL_ATT_BUYERS_CLUB: TroubleshootPath = {
  id: "voicemail--att-buyers-club--any",
  issueId: "voicemail",
  carrier: "att-buyers-club",
  deviceFamily: "any",
  title: "Voicemail / Visual voicemail — ATT Buyers' Club",
  sourceUrl: OPUS_SOURCE,
  steps: [
    {
      id: "vm-att-01",
      order: 1,
      title: "Classify the voicemail issue",
      checkOnly: true,
      instructions: [
        "Determine type: password/PIN reset, standard voicemail access, visual voicemail, or mailbox clear/reset",
        `Open the line in OPUS (${OPUS_URL}) and verify line status`,
        "Do not delete/reset a mailbox without warning that messages may be lost permanently",
      ],
      resolvedTemplate: `Hello,

We reviewed your voicemail configuration. Please try accessing voicemail again on your {{deviceLabel}} and let us know if it works.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We reviewed your voicemail request type. Next we will apply the matching reset or feature check and guide you through access on your {{deviceLabel}}.

${SIGN_OFF}`,
    },
    {
      id: "vm-att-02",
      order: 2,
      title: "Apply the matching voicemail fix",
      instructions: [
        "PIN forgotten: use OPUS voicemail password reset workflow",
        "Standard voicemail not working: verify voicemail feature on the line; user can hold 1 (or dial carrier voicemail access) to enter mailbox",
        "Visual voicemail not working: validate feature / treat as provisioning-feature problem; refresh feature if needed",
        "Mailbox reset-as-new: warn that existing messages may be lost; get explicit customer confirmation before proceeding",
      ],
      deviceNotes: {
        iphone: [
          "Phone app → hold 1 to access voicemail, or open Visual Voicemail tab",
          "If Visual Voicemail stuck: toggle Airplane mode, or reset network settings if advised",
        ],
        samsung: [
          "Phone app → Voicemail / hold 1 for carrier voicemail access",
          "Check voicemail app notifications/permissions if using visual voicemail",
        ],
        pixel: [
          "Phone app → hold 1 for carrier voicemail",
          "Check default dialer voicemail settings",
        ],
        "data-only": [
          "Data-only devices typically have no voice mailbox — confirm the request is on a voice-capable line",
        ],
      },
      resolvedTemplate: `Hello,

Voicemail should now be accessible on your {{deviceLabel}}. Please test and confirm (including visual voicemail if you use it).

${SIGN_OFF}`,
      continueTemplate: `Hello,

Please try the voicemail access steps on your {{deviceLabel}}:

{{deviceSteps}}

If it still fails, reply with whether this is standard voicemail, visual voicemail, or a PIN reset request so we can escalate to the carrier.

${SIGN_OFF}`,
    },
    {
      id: "vm-att-03",
      order: 3,
      title: "Carrier provisioning check",
      instructions: [
        ATT_TIER1,
        "Ask AT&T to investigate voicemail / visual voicemail provisioning",
        "If resetting mailbox as new: reconfirm data-loss warning with user before carrier action",
        "Document case reference and outcome",
      ],
      isTerminal: true,
      resolvedTemplate: `Hello,

The carrier completed voicemail provisioning updates. Please retest voicemail on your {{deviceLabel}} and confirm.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We escalated your voicemail issue to the carrier and documented the case. We will update you when provisioning is corrected or when we need another confirmation from you (for example, approval to reset the mailbox as new).

${SIGN_OFF}`,
    },
  ],
};
