import type { TroubleshootPath } from "../../../lib/troubleshooting/types";
import {
  ATT_TIER1,
  DEVICE_NETWORK_RESET,
  OPUS_SOURCE,
  OPUS_URL,
  SIGN_OFF,
} from "./_shared";

/**
 * International Roaming — ATT Buyers' Club
 */
export const ROAMING_ATT_BUYERS_CLUB: TroubleshootPath = {
  id: "international-roaming--att-buyers-club--any",
  issueId: "international-roaming",
  carrier: "att-buyers-club",
  deviceFamily: "any",
  title: "International Roaming — ATT Buyers' Club",
  sourceUrl: OPUS_SOURCE,
  steps: [
    {
      id: "roam-att-01",
      order: 1,
      title: "Confirm international feature and order status",
      checkOnly: true,
      instructions: [
        `Check the line in OPUS (${OPUS_URL}) and confirm whether the international feature is already active`,
        "If international service is missing: verify whether there is an order tied to the request",
        "If an order exists: work with order manager / apply the feature per process",
        "If no order and user is requesting new international service: direct POC to place the proper request (do not freehand enable without authorization)",
        "If international roaming was added only after the user left the home country: advise service may not apply correctly until process/order rules are met",
      ],
      resolvedTemplate: `Hello,

We confirmed international roaming features on your line. Please enable Data Roaming on your {{deviceLabel}}, retest calls/text/data abroad, and share the result.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We reviewed international feature status on your line. Next we will guide device roaming settings and, if needed, engage the carrier for roaming troubleshooting.

Please confirm the country you are in and whether calls, texts, and/or data are affected.

${SIGN_OFF}`,
    },
    {
      id: "roam-att-02",
      order: 2,
      title: "Device roaming settings",
      instructions: [
        "Ask the user to enable Data Roaming",
        "If needed: guide manual network selection to an available partner network",
        "Power cycle device and retest voice, SMS, and data",
        "Avoid unnecessary eSIM reprovision while abroad unless confirmed safe",
      ],
      deviceNotes: {
        iphone: [
          "Settings → Cellular → Cellular Data Options → Data Roaming ON",
          "Settings → Cellular → Network Selection → turn off Automatic, pick a partner network if needed",
          "Power cycle and retest",
        ],
        samsung: [
          "Settings → Connections → Mobile networks → Data roaming ON",
          "Network operators → search/select partner network if needed",
          "Power cycle and retest",
        ],
        pixel: [
          "Settings → Network & internet → SIMs → Roaming ON",
          "Automatically select network OFF and pick partner if needed",
          "Power cycle and retest",
        ],
        "data-only": [
          "Enable data roaming in the device/admin UI if available",
          "Power cycle and retest data registration",
          ...DEVICE_NETWORK_RESET["data-only"],
        ],
      },
      resolvedTemplate: `Hello,

After enabling roaming settings on your {{deviceLabel}}, service should work internationally. Please retest and confirm.

${SIGN_OFF}`,
      continueTemplate: `Hello,

Please complete the roaming device steps below, then retest:

{{deviceSteps}}

If service still fails, reply with country, symptoms (calls/text/data), and we will engage the carrier.

${SIGN_OFF}`,
    },
    {
      id: "roam-att-03",
      order: 3,
      title: "Carrier roaming troubleshooting / order path",
      instructions: [
        ATT_TIER1,
        "Request roaming troubleshooting and confirm feature status on the carrier side",
        "If no order exists for new international service: stop and route POC to place the correct request",
        "Document carrier findings and next update",
      ],
      isTerminal: true,
      resolvedTemplate: `Hello,

The carrier confirmed roaming is working / restored for your line. Please retest on your {{deviceLabel}} and confirm.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We engaged the carrier for international roaming support and documented the case. If a new international feature order is still required, your point of contact will need to place that request before service can be enabled.

We will share the next update when available.

${SIGN_OFF}`,
    },
  ],
};
