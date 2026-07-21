import type { TroubleshootPath } from "../../../lib/troubleshooting/types";
import {
  ATT_PLANS_HELP,
  DEVICE_NETWORK_RESET,
  OPUS_IMEI_ICCID_HELP,
  OPUS_NEW_ESIM_HELP,
  OPUS_SOURCE,
} from "./_shared";

/**
 * Calls Inbound / Outbound — ATT Wireless via vCom Buyers' Club
 *
 * Curated from live Confluence OPUS Troubleshooting Workflow
 * ("Calls Inbound / Outbound issue") — 7 guided steps + email templates.
 *
 * Templates use {{placeholders}} filled at runtime:
 *   {{deviceLabel}} {{carrierLabel}} {{imei}} {{iccid}} {{deviceSteps}}
 *   {{stepTitle}} {{stepNumber}} {{totalSteps}} {{customerName}} {{ticketId}}
 *
 * Replace any wording with final approved copy when ready — same shape, no engine changes.
 */

export const CALLS_ATT_BUYERS_CLUB: TroubleshootPath = {
  id: "calls-inbound-outbound--att-buyers-club--any",
  issueId: "calls-inbound-outbound",
  carrier: "att-buyers-club",
  deviceFamily: "any",
  title: "Calls Inbound / Outbound — ATT Buyers' Club",
  sourceUrl: OPUS_SOURCE,
  steps: [
    // ------------------------------------------------------------------
    // Step 1 — Verify line / device in OPUS
    // ------------------------------------------------------------------
    {
      id: "calls-att-01",
      order: 1,
      title: "Verify line and device details in OPUS",
      // Pure NOC checklist — no worked/still-issue branch; just Next step
      checkOnly: true,
      helpLinks: [OPUS_IMEI_ICCID_HELP, ATT_PLANS_HELP],
      instructions: [
        "Log into OPUS (https://opus.att.net/cc) and locate the MDN / line",
        "Confirm MDN, IMEI, ICCID, and SIM/eSIM type match vCom inventory",
        "Confirm the line is provisioned correctly for voice services",
        "If IMEI/ICCID do not match inventory, check with customer to see if they have same details that we have in the carrier portal",
      ],
    },

    // ------------------------------------------------------------------
    // Step 2 — Send OTA + power cycle
    // ------------------------------------------------------------------
    {
      id: "calls-att-02",
      order: 2,
      title: "Send OTA network refresh",
      checkOnly: true,
      instructions: [
        "From OPUS, send an OTA / network refresh to the line (click on Opus Guide for steps)",
        "Confirm the portal shows the OTA as submitted or successful",
        "Ask the user to power cycle the device and retest inbound + outbound calls",
      ],
    },

    // ------------------------------------------------------------------
    // Step 3 — Device-level checks (network reset / SIM pull)
    // ------------------------------------------------------------------
    {
      id: "calls-att-03",
      order: 3,
      title: "Complete device-level checks (network reset / SIM pull)",
      checkOnly: true,
      instructions: [
        "Have the user complete network reset for their device type",
        "If physical SIM: remove, inspect, and reseat the SIM, then retest",
        "If eSIM: network reset only — skip SIM pull",
        "Ask the customer to reply after completing the network reset steps",
      ],
      deviceNotes: { ...DEVICE_NETWORK_RESET },
      continueTemplate: `Hello,

The IMEI and ICCID in our records match the carrier records.

Please confirm whether you are currently using the device with IMEI {{imei}} or a different device.

- If you are using a different device, please do not perform the steps below and reply so we can continue.
- If you are using the same device, please proceed with the following steps:

{{deviceSteps}}

We have also completed a network refresh from the carrier’s end, which should help refresh the network signal on your device. To ensure the refresh is completed properly, please perform a network reset on your device.

If you continue to experience any issues after the network reset, please let us know.

Thank you,
vCom NOC Support`,
    },

    // ------------------------------------------------------------------
    // Step 4 — Contact AT&T tier-1 (outage / provisioning)
    // ------------------------------------------------------------------
    {
      id: "calls-att-04",
      order: 4,
      title: "Contact AT&T tier-1 support",
      outcomeLabels: {
        resolved: "Outage",
        continue: "No Outage",
      },
      suppressContinueTemplate: true,
      instructions: [
        "Call AT&T tier-1 support: 1-888-334-3787 · Security PIN 10426",
        "Ask AT&T to check for outages, provisioning issues, feature blocks, and local network conditions",
        "Document AT&T findings, case/reference number, and recommended next steps",
        "If AT&T confirms an outage: send the outage email template, document details, pause further TS until restored",
        "If AT&T confirms no outage: continue to step 5 (SIM / eSIM swap)",
      ],
      resolvedTemplate: `Hello,

We contacted the carrier regarding the issue, and they confirmed that there is currently an area-wide outage affecting services in your location. This outage may be impacting your network connectivity and overall service.

At this time, the carrier has not provided an estimated time of restoration. We will continue to follow up with them and keep you updated as more information becomes available.

Thank you for your patience and understanding.

Thank you,
vCom NOC Support`,
      continueTemplate: undefined,
    },

    // ------------------------------------------------------------------
    // Step 5 — SIM swap / new eSIM (no network-side issue)
    // ------------------------------------------------------------------
    {
      id: "calls-att-05",
      order: 5,
      title: "Swap SIM or provision a new eSIM",
      checkOnly: true,
      helpLinks: [OPUS_NEW_ESIM_HELP],
      instructions: [
        "Only after AT&T confirms no outage / no network-side block",
        "Physical SIM: arrange replacement SIM via Customer Care (customercare@vcomsolutions.com) if needed, then retest",
        "eSIM: provision a new eSIM in OPUS (Opus Portal -> eSIM Manage → Get New eSIM) - Check the link for detailed steps",
        "Before installing new eSIM: have user delete the existing eSIM on-device, then install/activate the new one",
        "Ask the customer to reply after deleting the old eSIM, installing the new eSIM, and testing calls again",
      ],
      deleteEsimNotes: {
        iphone: [
          "Open Settings → Cellular (or Mobile Data)",
          "Select the existing cellular plan / eSIM",
          "Tap Remove Cellular Plan and confirm removal",
        ],
        samsung: [
          "Open Settings → Connections → SIM manager",
          "Select the existing eSIM plan",
          "Tap Remove and confirm removal",
        ],
        pixel: [
          "Open Settings → Network & internet → SIMs",
          "Select the existing eSIM",
          "Tap Delete SIM / Remove SIM and confirm removal",
        ],
        "data-only": [
          "Open the device cellular / network settings",
          "Locate the current eSIM / mobile profile",
          "Remove the existing eSIM profile and confirm deletion",
        ],
      },
      addEsimNotes: {
        iphone: [
          "Open Settings → Cellular (or Mobile Data)",
          "Tap Add eSIM",
          "Choose the option provided for carrier activation / QR activation and follow the prompts to install the new eSIM",
        ],
        samsung: [
          "Open Settings → Connections → SIM manager",
          "Tap Add eSIM",
          "Follow the prompts to install and activate the new eSIM",
        ],
        pixel: [
          "Open Settings → Network & internet → SIMs",
          "Tap Add SIM",
          "Follow the prompts to download and activate the new eSIM",
        ],
        "data-only": [
          "Open the device network / cellular settings",
          "Choose Add eSIM / Add mobile plan if available",
          "Follow the device prompts to install and activate the new eSIM profile",
        ],
      },
      continueTemplate: `Hello,

We checked with the carrier and confirmed that there is currently no outage affecting service in your area.

To help resolve the issue, we have provisioned a new eSIM for your line.

Please complete the steps below on your {{deviceLabel}}.

Delete the existing eSIM:
{{deleteEsimSteps}}

Install and activate the new eSIM:
{{addEsimSteps}}

Once the new eSIM is active, please test inbound and outbound calls again and let us know the result.

If you continue to experience any issues after activating the new eSIM, please let us know and we will continue with the next troubleshooting steps.

Thank you,
vCom NOC Support`,
    },

    // ------------------------------------------------------------------
    // Step 6 — Factory reset (last resort before device isolation)
    // ------------------------------------------------------------------
    {
      id: "calls-att-06",
      order: 6,
      title: "Factory reset (last resort)",
      checkOnly: true,
      instructions: [
        "Only if issue remains after SIM/eSIM replacement",
        "Clearly advise the customer that factory reset erases the device",
        "Ask the customer to back up all data before proceeding",
        "After reset completes: provision a new eSIM and retest inbound/outbound calls",
        "Ask the customer to let us know once the factory reset is complete so we can initiate the new eSIM",
      ],
      deviceNotes: {
        iphone: [
          "Open Settings → General → Transfer or Reset iPhone",
          "Tap Erase All Content and Settings",
          "Follow the prompts to complete the factory reset",
        ],
        samsung: [
          "Open Settings → General management → Reset",
          "Tap Factory data reset",
          "Review the information, then follow the prompts to complete the reset",
        ],
        pixel: [
          "Open Settings → System → Reset options",
          "Tap Erase all data (factory reset)",
          "Follow the prompts to complete the factory reset",
        ],
        "data-only": [
          "Open the device settings and locate Reset or System reset options",
          "Choose the factory reset / erase all data option",
          "Follow the prompts to complete the reset on the device",
        ],
      },
      continueTemplate: `Hello,

We checked with the carrier and confirmed that there is currently no outage affecting service in your area.

Since the previous troubleshooting steps did not resolve the issue, the next recommended step is to perform a factory reset on your {{deviceLabel}}.

Before proceeding, please make sure your data is backed up, as a factory reset will erase all data and settings from the device.

Please complete the steps below on your {{deviceLabel}}.

Factory reset steps:
{{deviceSteps}}

Once the factory reset is complete, please reply to this email and let us know so we can provision and initiate a new eSIM for your line.

If you have any questions in the meantime, please let us know.

Thank you,
vCom NOC Support`,
    },

    // ------------------------------------------------------------------
    // Step 6.1 — Initiate a new eSIM after factory reset
    // ------------------------------------------------------------------
    {
      id: "calls-att-07",
      order: 7,
      displayOrderLabel: "6.1",
      title: "Initiate a new eSIM",
      checkOnly: true,
      helpLinks: [OPUS_NEW_ESIM_HELP],
      instructions: [
        "After the customer confirms the factory reset is complete, provision a new eSIM in OPUS",
        "Use Opus Portal -> eSIM Manage → Get New eSIM",
        "Send the customer the install steps for their selected device",
        "Ask the customer to install/activate the new eSIM and retest inbound/outbound calls",
        "Ask the customer to reply with the test result after activation",
      ],
      addEsimNotes: {
        iphone: [
          "Open Settings → Cellular (or Mobile Data)",
          "Tap Add eSIM",
          "Choose the option provided for carrier activation / QR activation and follow the prompts to install the new eSIM",
        ],
        samsung: [
          "Open Settings → Connections → SIM manager",
          "Tap Add eSIM",
          "Follow the prompts to install and activate the new eSIM",
        ],
        pixel: [
          "Open Settings → Network & internet → SIMs",
          "Tap Add SIM",
          "Follow the prompts to download and activate the new eSIM",
        ],
        "data-only": [
          "Open the device network / cellular settings",
          "Choose Add eSIM / Add mobile plan if available",
          "Follow the device prompts to install and activate the new eSIM profile",
        ],
      },
      continueTemplate: `Hello,

We have now provisioned a new eSIM for your line following the factory reset.

Please complete the steps below on your {{deviceLabel}}.

Install and activate the new eSIM:
{{addEsimSteps}}

Once the new eSIM is active, please test inbound and outbound calls again and let us know the result.

If you continue to experience any issues after activating the new eSIM, please let us know if you have any other unlocked device to test.

Thank you,
vCom NOC Support`,
    },

    // ------------------------------------------------------------------
    // Step 7 — Device isolation / warranty (terminal)
    // ------------------------------------------------------------------
    {
      id: "calls-att-08",
      order: 8,
      title: "Isolate device · warranty replacement if needed",
      instructions: [
        "If another device is available: activate the line (eSIM/SIM) on that device and test inbound/outbound calls",
        "If it works on the other device: treat as device-related — recommend warranty replacement order / engage C3",
        "Even if the issue points to the device and requires warranty replacement, the MOM team needs carrier-side documentation, so engage the carrier, provide all troubleshooting completed, and ask whether any additional steps are required",
        "If no other device is available: contact AT&T again, share full troubleshooting completed, and ask for any remaining steps",
        "If the carrier confirms the issue is device-related and has no further steps: document that confirmation as evidence, then use the warranty replacement customer template and proceed with replacement / C3 guidance",
        "Update ticket notes with all actions, carrier findings, and final outcome",
      ],
      isTerminal: true,
      // 7A — different device works / resolved via device path
      resolvedTemplate: `Hello [],

We tested the eSIM on another device, and it worked successfully. Based on the results, the issue appears to be with the device itself rather than the eSIM or network service.

At this point, we recommend placing a warranty replacement order for the device. (see attached file for instructions)

If you need assistance with placing the order, please reply to this thread and our Customer Care Team will be happy to assist you further.

Since this no longer appears to be a repair-related issue, we will be closing this trouble ticket.`,
      // 7B — no different device / escalate to warranty
      continueTemplate: `Hello [],

Since you do not have another device available for testing, and the carrier has isolated the issue to the device, this appears to be a device-related issue.

At this point, we recommend placing a warranty replacement order for the device. (see attached file for instructions)

If you need assistance with placing the order, please reply to this thread and our Customer Care Team will be happy to assist you further.

Since this no longer appears to be a repair-related issue, we will be closing this trouble ticket.`, 
    },
  ],
};
