import type { TroubleshootPath } from "../../../lib/troubleshooting/types";
import { OPUS_SOURCE, OPUS_URL, SIGN_OFF } from "./_shared";

/**
 * Activation / Porting assistance — ATT Buyers' Club
 * Order-gated: do not activate without related order/task.
 */
export const ACTIVATION_ATT_BUYERS_CLUB: TroubleshootPath = {
  id: "activation--att-buyers-club--any",
  issueId: "activation",
  carrier: "att-buyers-club",
  deviceFamily: "any",
  title: "Activation / Porting assistance — ATT Buyers' Club",
  sourceUrl: OPUS_SOURCE,
  steps: [
    {
      id: "act-att-01",
      order: 1,
      title: "Confirm related order or task (do not skip)",
      checkOnly: true,
      instructions: [
        "Do not activate a new device or make port-related changes until a related order/task is confirmed",
        "Open vMobile → Inventory, search by line number, review Related Orders",
        "Check open orders for pending activation / device change / port",
        "Review whether the request is device change/upgrade vs number port/transfer",
        "If a task exists and is already completed: investigate why the customer still has issues and open a trouble ticket if needed",
      ],
      resolvedTemplate: `Hello,

We confirmed your activation/port request status. No further activation action is required on our side right now. Please power cycle your {{deviceLabel}} and retest service, then reply with the result.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We are reviewing the related order/task for your activation or port request. We will proceed only on the authorized order path and update you with next steps for your {{deviceLabel}}.

${SIGN_OFF}`,
    },
    {
      id: "act-att-02",
      order: 2,
      title: "Complete activation in carrier portal when authorized",
      instructions: [
        "If pending activation order exists: log into carrier portal / OPUS and complete activation",
        "If device shows Active in inventory: verify in carrier portal and complete any still-pending activation",
        "Generate task / create ticket notes post completion as required",
        `Portal: ${OPUS_URL}`,
      ],
      resolvedTemplate: `Hello,

Activation has been completed for your line. Please finish any on-device setup on your {{deviceLabel}}, then retest calls/data/text and confirm.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We are completing the authorized activation steps in the carrier portal. Please keep the {{deviceLabel}} nearby and powered on. We will send setup steps if device-side action is required.

${SIGN_OFF}`,
    },
    {
      id: "act-att-03",
      order: 3,
      title: "If no order — Mobility Order Required path",
      instructions: [
        "If no order exists: do not activate",
        "Share Mobility Order Required guidance with the customer/POC",
        "Advise they must place an order to get a new device activated",
        "Include latest Customer Reference Guide when applicable",
        "Copy Customer Care on the notification",
      ],
      isTerminal: true,
      resolvedTemplate: `Hello,

Your activation order path is complete / service is active. Please confirm your {{deviceLabel}} is working as expected.

${SIGN_OFF}`,
      continueTemplate: `Hello,

We do not see an authorized activation/port order for this request, so we cannot complete activation from the NOC side yet.

Please have your point of contact place the proper mobility order for new device activation or porting. Include this ticket reference if available. Customer Care can assist with the order path if needed.

${SIGN_OFF}`,
    },
  ],
};
