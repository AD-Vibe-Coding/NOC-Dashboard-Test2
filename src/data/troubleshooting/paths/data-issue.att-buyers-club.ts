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
 * Data issue — ATT Buyers' Club
 * Curated from live OPUS "Data issue" + matrix throttle/block guidance.
 */
export const DATA_ATT_BUYERS_CLUB: TroubleshootPath = {
  id: "data-issue--att-buyers-club--any",
  issueId: "data-issue",
  carrier: "att-buyers-club",
  deviceFamily: "any",
  title: "Data issue — ATT Buyers' Club",
  sourceUrl: OPUS_SOURCE,
  steps: [
    {
      id: "data-att-01",
      order: 1,
      title: "Verify line and device details in OPUS",
      checkOnly: true,
      helpLinks: [OPUS_IMEI_ICCID_HELP, ATT_PLANS_HELP],
      instructions: [
        `Log into OPUS (${OPUS_URL}) and locate the MDN / line`,
        "Confirm IMEI and ICCID match vCom inventory",
        "Confirm the line is provisioned for data services",
        "If IMEI/ICCID do not match inventory, check with customer to see if they have same details that we have in the carrier portal",
      ],
      resolvedTemplate: `Hello,

We verified your line and device details on the carrier side (IMEI {{imei}}, ICCID {{iccid}}) and everything matches. Please retest mobile data on your {{deviceLabel}} and let us know the result.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We verified your line and device details on the carrier side (IMEI {{imei}}, ICCID {{iccid}}). Next we will check for data throttle/blocks and send a network refresh (OTA) if needed. Please keep the {{deviceLabel}} powered on with mobile signal.

${SIGN_OFF}`,
    },
    {
      id: "data-att-02",
      order: 2,
      title: "Check throttle, plan limits, and data blocks",
      instructions: [
        "Check whether the line is throttled due to plan high-speed limits",
        "Apex Unlimited Standard: ~12GB high-speed then throttle to ~256 Kbps",
        "Advance: ~22GB high-speed then throttle to ~256 Kbps",
        "Premium: ~22GB high-speed then throttle to ~3 Mbps",
        "If throttled: work with Account Manager / advise POC that a plan change may be required",
        "Check for excess-data / international overusage data block",
        "If blocked for international overusage: inform customer + notify Account Manager",
        "If customer is outside the U.S.: add international data pack when applicable before removing block; review roaming TS",
        "If customer has returned to the U.S.: remove the data block, then continue with OTA + device steps",
      ],
      resolvedTemplate: `Hello,

We reviewed your data plan and line status. A plan or block condition was addressed on our side. Please power cycle your {{deviceLabel}}, retest mobile data, and share the result.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We reviewed your data plan for throttle limits and any data blocks. No plan/block condition fully explains the issue (or we cleared a block and will continue). Next we will send a network refresh (OTA) and guide you through device data checks.

${SIGN_OFF}`,
    },
    {
      id: "data-att-03",
      order: 3,
      title: "Send OTA and complete device data checks",
      instructions: [
        "Send OTA / network refresh from OPUS",
        "Ask the user to power cycle the device",
        "Have the user complete network reset for their device type",
        "If physical SIM: reseat SIM; if eSIM: network reset only",
        "If the customer is abroad, confirm whether the problem is roaming-related before changing SIM/eSIM",
        "Retest mobile data (browser + apps) and document results",
      ],
      deviceNotes: { ...DEVICE_NETWORK_RESET },
      resolvedTemplate: `Hello,

We sent a network refresh (OTA) and completed device-side data checks. Please retest mobile data on your {{deviceLabel}} and confirm pages/apps load normally.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We sent a network refresh (OTA) from the carrier end. Please complete the device steps below, then retest mobile data:

{{deviceSteps}}

If you are traveling internationally, reply with your country so we can confirm roaming settings before any SIM/eSIM change.

Please share your findings.

${SIGN_OFF}`,
    },
    {
      id: "data-att-04",
      order: 4,
      title: "Contact AT&T tier-1 for data provisioning",
      instructions: [
        ATT_TIER1,
        "Ask AT&T to check outages, data provisioning, feature blocks, and local network conditions",
        "Document AT&T findings and case/reference number",
        "Do not activate a new eSIM for a user already traveling internationally unless confirmed safe for that case",
      ],
      resolvedTemplate: `Hello,

We worked with the carrier on your data service. Please retest mobile data on your {{deviceLabel}} and let us know the result.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We contacted the carrier about your data issue and documented their findings. Next we may replace the physical SIM or provision a new eSIM (if you are not in a restricted international scenario), then retest data.

${SIGN_OFF}`,
    },
    {
      id: "data-att-05",
      order: 5,
      title: "SIM swap / new eSIM or escalate device path",
      instructions: [
        "If no network-side issue: replace physical SIM or provision new eSIM in OPUS",
        "Before new eSIM: have user delete existing eSIM on-device, then install the new one",
        "If still broken: factory reset only after backup warning, then re-provision eSIM",
        "If isolated to device: warranty / change-device path; if poor coverage: consider alternate carrier port discussion with POC",
      ],
      isTerminal: true,
      resolvedTemplate: `Hello,

We completed SIM/eSIM (or device) remediation for your data service. Please confirm mobile data is working on your {{deviceLabel}}.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We completed carrier and SIM/eSIM troubleshooting for mobile data on your line. If service still fails after the latest steps, next options are device warranty/replacement review or coverage evaluation with your point of contact.

Please reply with the latest test results and we will document the next path.

${SIGN_OFF}`,
    },
  ],
};
