/**
 * Bundled ATT Wireless via vCom Buyers' Club troubleshooting matrix.
 * Sourced from the Mobility Matrix (ATT via Buyers Club sheet) / OPUS workflow.
 *
 * Used as the offline fallback when live Confluence fetch of
 * "AT&T OPUS Troubleshooting Workflow" (page 6315114528) is unavailable.
 */

export interface DeviceSteps {
  iphone?: string | null;
  ipad?: string | null;
  samsung?: string | null;
  pixel?: string | null;
  kyocera?: string | null;
  other?: string | null;
}

export interface MobilityIssueGuide {
  id: string;
  label: string;
  /** Original matrix / workflow issue title */
  source_issue: string;
  step1: string;
  step2: string;
  step3: string;
  device_steps: DeviceSteps;
}

export interface MobilityResponse {
  /** live = fetched from Confluence OPUS page; bundled = offline matrix fallback */
  source: "live" | "bundled";
  carrier: string;
  carrier_label: string;
  portal_url: string;
  support_phone: string;
  support_pin: string;
  fetched_at: string;
  issues: MobilityIssueGuide[];
  warning: string | null;
  /** Confluence OPUS Troubleshooting Workflow page metadata (when available) */
  page_id?: string;
  page_title?: string;
  page_url?: string;
  page_version?: number | null;
}

export const MOBILITY_CARRIER = {
  id: "att-buyers-club",
  label: "ATT Wireless via vCom Buyers' Club",
  portal_url: "https://opus.att.net/cc",
  support_phone: "1-888-334-3787",
  support_pin: "10426",
} as const;

export const MOBILITY_ISSUES: MobilityIssueGuide[] = [
  {
    "id": "activation",
    "label": "Activation assistance",
    "source_issue": "Activation assistance",
    "step1": "POC/User Requesting assistance with new device activation, verify if line has any new device activation pending by searching the MDN in vCom inventory and under Orders as status will shows “Pending Activation”.\n\nIf there is a pending activation look for the order and complete the activation by logging into Carrier portal (Generate task post completion).\nIf the new device is showing Active, verify the same by logging into Carrier portal and complete the activation if is stll pending (Create ticket post completion).",
    "step2": "If no order share the Mobility Order Required template and advise the customer they will need to place order to Get a New Device Activated.\nInclude the latest version of the Customer Reference Guide also Copy the Customer care team on the notification",
    "step3": "",
    "device_steps": {
      "iphone": "iPhone SE and above: Settings → General → Transfer or Reset iPhone → Reset → Reset Network Settings",
      "ipad": "iPad: Settings → General → Transfer or Reset iPad → Reset → Reset Network Settings",
      "samsung": "Samsung: Settings → General Management → Reset → Reset Network Settings",
      "pixel": "Google Pixel: Settings → System → Reset options → Reset Network Settings",
      "kyocera": "Kyocera: Settings → System → Reset options → Reset Wi-Fi, mobile & Bluetooth → Reset Settings",
      "other": "Perform a network settings reset per the device OEM documentation, then reboot."
    }
  },
  {
    "id": "calls",
    "label": "Calls Inbound/ Outbound / SOS / No Service",
    "source_issue": "General Trouble :- Calls not working Inbound/Outbound, Static/Gargled Voice/SOS Mode/No Network or service",
    "step1": "Log into OPUS (https://opus.att.net/cc) and verify the IMEI and ICCID. Once the details match with VCOM inventory proceed with sending OTA (Over the Air) network refresh signal to user’s line and then send the device-specific network-reset steps below.",
    "step2": "Reach out to carrier tier 1 support (**1-888-334-3787** Security PIN: **10426**) to investigate if there is any outage and provisioning issue (If not suggest user to get an eSIM activated if applicable if the issue remains and user has a physical SIM send user a new SIM to test if the issue resolves).\nIf applicable: provision a new eSIM in OPUS (Mobile Maintenance → Get New eSIM)\nIf needed: delete the existing eSIM on-device, then provision a new eSIM in OPUS\nIf needed: ship a new physical SIM via Customer Care (****customercare@vcomsolutions.com****)\n\nif the issue remains the same, please confirm user's address and check network strength working with the carrier rep and perform factory reset making sure the data is backed up before Factory reset.",
    "step3": "Check if the device provided by vCom or BYOD, once confirmed check device is under warranty and have POC process a Warranty replacement (Device will be under warranty till 1 year from the date activation, if not under warranty advise POC/User to place Change device order)\n\nIf the issue is with the network strength have the POC place a port request to port line to a different carrier",
    "device_steps": {
      "iphone": "iPhone SE and above: Settings → General → Transfer or Reset → Reset → Reset Network Settings",
      "ipad": "iPad: Settings → General → Transfer or Reset iPad → Reset → Reset Network Settings",
      "samsung": "Samsung: Settings → General Management → Reset → Reset Network Settings",
      "pixel": "Google Pixel: Settings → System → Reset options → Reset Network Settings",
      "kyocera": "Kyocera: Settings → System → Reset options → Reset Wi-Fi, mobile & Bluetooth → Reset Settings",
      "other": "Perform a network settings reset per the device OEM documentation, then reboot."
    }
  },
  {
    "id": "sos",
    "label": "SOS Mode / No Service",
    "source_issue": "General Trouble :- Calls not working Inbound/Outbound, Static/Gargled Voice/SOS Mode/No Network or service",
    "step1": "SOS / No Service uses the same path as general call/network trouble.\n\nLog into OPUS (https://opus.att.net/cc) and verify the IMEI and ICCID. Once the details match with VCOM inventory proceed with sending OTA (Over the Air) network refresh signal to user’s line and then send the device-specific network-reset steps below.",
    "step2": "Reach out to carrier tier 1 support (**1-888-334-3787** Security PIN: **10426**) to investigate if there is any outage and provisioning issue (If not suggest user to get an eSIM activated if applicable if the issue remains and user has a physical SIM send user a new SIM to test if the issue resolves).\nIf applicable: provision a new eSIM in OPUS (Mobile Maintenance → Get New eSIM)\nIf needed: delete the existing eSIM on-device, then provision a new eSIM in OPUS\nIf needed: ship a new physical SIM via Customer Care (****customercare@vcomsolutions.com****)\n\nif the issue remains the same, please confirm user's address and check network strength working with the carrier rep and perform factory reset making sure the data is backed up before Factory reset.",
    "step3": "Check if the device provided by vCom or BYOD, once confirmed check device is under warranty and have POC process a Warranty replacement (Device will be under warranty till 1 year from the date activation, if not under warranty advise POC/User to place Change device order)\n\nIf the issue is with the network strength have the POC place a port request to port line to a different carrier",
    "device_steps": {
      "iphone": "iPhone SE and above: Settings → General → Transfer or Reset → Reset → Reset Network Settings",
      "ipad": "iPad: Settings → General → Transfer or Reset iPad → Reset → Reset Network Settings",
      "samsung": "Samsung: Settings → General Management → Reset → Reset Network Settings",
      "pixel": "Google Pixel: Settings → System → Reset options → Reset Network Settings",
      "kyocera": "Kyocera: Settings → System → Reset options → Reset Wi-Fi, mobile & Bluetooth → Reset Settings",
      "other": "Perform a network settings reset per the device OEM documentation, then reboot."
    }
  },
  {
    "id": "network",
    "label": "Network connectivity / Poor connection",
    "source_issue": "General Trouble :- Calls not working Inbound/Outbound, Static/Gargled Voice/SOS Mode/No Network or service",
    "step1": "Poor connection / network connectivity uses the same path as general call/network trouble.\n\nLog into OPUS (https://opus.att.net/cc) and verify the IMEI and ICCID. Once the details match with VCOM inventory proceed with sending OTA (Over the Air) network refresh signal to user’s line and then send the device-specific network-reset steps below.",
    "step2": "Reach out to carrier tier 1 support (**1-888-334-3787** Security PIN: **10426**) to investigate if there is any outage and provisioning issue (If not suggest user to get an eSIM activated if applicable if the issue remains and user has a physical SIM send user a new SIM to test if the issue resolves).\nIf applicable: provision a new eSIM in OPUS (Mobile Maintenance → Get New eSIM)\nIf needed: delete the existing eSIM on-device, then provision a new eSIM in OPUS\nIf needed: ship a new physical SIM via Customer Care (****customercare@vcomsolutions.com****)\n\nif the issue remains the same, please confirm user's address and check network strength working with the carrier rep and perform factory reset making sure the data is backed up before Factory reset.",
    "step3": "Check if the device provided by vCom or BYOD, once confirmed check device is under warranty and have POC process a Warranty replacement (Device will be under warranty till 1 year from the date activation, if not under warranty advise POC/User to place Change device order)\n\nIf the issue is with the network strength have the POC place a port request to port line to a different carrier",
    "device_steps": {
      "iphone": "iPhone SE and above: Settings → General → Transfer or Reset → Reset → Reset Network Settings",
      "ipad": "iPad: Settings → General → Transfer or Reset iPad → Reset → Reset Network Settings",
      "samsung": "Samsung: Settings → General Management → Reset → Reset Network Settings",
      "pixel": "Google Pixel: Settings → System → Reset options → Reset Network Settings",
      "kyocera": "Kyocera: Settings → System → Reset options → Reset Wi-Fi, mobile & Bluetooth → Reset Settings",
      "other": "Perform a network settings reset per the device OEM documentation, then reboot."
    }
  },
  {
    "id": "data",
    "label": "Data issue",
    "source_issue": "Data Not working: Device not loading page, Slow data speed/ No internet",
    "step1": "Follow intial troubleshooting same as Genenal TS : -Log into OPUS (https://opus.att.net/cc) and verify the IMEI and ICCID once the details match VCOM inventory check if data is being throttled.\n1. Check plan type -\nApex Unlimited Standard includes 12GB of highspeed data and will throttle to 256KBPS\nAdvance level includes 22GB of data and throttles to 256KBPS\nPremium includes 22GB and throttles to 3MBPS\nWork with Account manager to verfiy Data usage and once confirmed advise POC/User that a plan change is needed to resolve throttling issue.\n2. Data blockage\nConfirm the data block is due to international data overusage.Inform the customer and notify the Account Manager.\nIf the customer is outside the U.S.: Add an international data pack (if applicable) before removing the block. Review Data Roaming troubleshooting.\nIf the customer has returned to the U.S.: Remove the data block, send an OTA network refresh, ask the customer to reboot the device, and continue device-specific data troubleshooting if needed.",
    "step2": "Reach out to carrier tier 1 support (**1-888-334-3787** Security PIN: **10426**) to investigate if there is any outage and provisioning issue (If not suggest user to get an eSIM activated if applicable if the issue remains and user has a physical SIM send user a new SIM). (Do not activate eSIM if user is travelling overseas)\nHow to Provision new eSIM\nHow to Delete existing eSIM and Provision new eSIM\nHow to Ship a new SIM\n\nif the issue remains the same, please confirm user's address and check network strength working with the carrier rep and perform factory reset making sure the data is backed up before Factory reset.",
    "step3": "Check if the device provided by vCom or BYOD, once confirmed check device is under warranty and have POC process a Warranty replacement (Device will be under warranty till 1 year from the date activation, if not under warranty advise POC/User to place Change device order)\n\nIf the issue is with the network strength have the POC place a port request to port line to a different carrier",
    "device_steps": {
      "iphone": "iPhone SE and above: Settings → General → Transfer or Reset iPhone → Reset → Reset Network Settings",
      "ipad": "iPad: Settings → General → Transfer or Reset iPad → Reset → Reset Network Settings",
      "samsung": "Samsung: : Settings → General Management → Reset → Reset Network Settings",
      "pixel": "Google Pixel: Settings → System → Reset options → Reset Network Settings",
      "kyocera": "Kyocera: Settings → System → Reset options → Reset Wi-Fi, mobile & Bluetooth → Reset Settings",
      "other": "Perform a network settings reset per the device OEM documentation, then reboot."
    }
  },
  {
    "id": "text",
    "label": "Text issue (SMS / MMS / iMessage)",
    "source_issue": "Text (SMS, MMS and iMessage) not working :User reporing device not able to send and recive text",
    "step1": "Follow intial troubleshooting - Genenal TS : - Log into OPUS (https://opus.att.net/cc) and verify the IMEI and ICCID. Once the details match VCOM inventory proceed with sending OTA Network refresh signal to user’s line and then send the device-specific network-reset steps below. Phone- (If there is no Blockage and provisioning issue work with user to check if iMessage is turn on and make sure the Send/Receive options selected on their Device for both their number and their Apple ID).",
    "step2": "Reach out to carrier tier 1 support (**1-888-334-3787** Security PIN: **10426**) to investigate if there is any Blockage and provisioning issue.\n\nif the issue remains the same, please confirm user's address and check network strength working with the carrier rep and provision a new eSIM or send a new SIM if user has a physical SIM if applicable.",
    "step3": "Check if the device provided by vCom or BYOD, once confirmed check device is under warranty and have POC process a Warranty replacement (Device will be under warranty till 1 year from the date activation, if not under warranty advise POC/User to place Change device order)\n\nIf the issue is with the network strength have the POC place a port request to port line to a different carrier",
    "device_steps": {
      "iphone": "iPhone SE and above: Settings → General → Transfer or Reset → Reset → Reset Network Settings",
      "ipad": "iPad: Settings → General → Transfer or Reset iPad → Reset → Reset Network Settings",
      "samsung": "Samsung: Settings → General Management → Reset → Reset Network Settings",
      "pixel": "Google Pixel: Settings → System → Reset options → Reset Network Settings",
      "kyocera": "Kyocera: Settings → System → Reset options → Reset Wi-Fi, mobile & Bluetooth → Reset Settings",
      "other": "Perform a network settings reset per the device OEM documentation, then reboot."
    }
  },
  {
    "id": "esim",
    "label": "eSIM Issue",
    "source_issue": "eSIM Activation",
    "step1": "POC/User requesting assistance with eSIM activation confirm if the request is to Provision a new eSIM or converting a Physical SIM to eSIM and assist with desired request (Engage C3 post Completion sent info using below template)\n\nSubject: Ticket# || Request to create a change order || Line Number:\n\nHello Team,\nPlease submit an order as eSIM was provisioned for line listed below during troubleshooting so that the charges can be passed over to the customer.\n\neSIM provisioned count: *** (Mention how many times you have re-provisioned eSIM, if it is more than once, provide more details on why we had to re-provision multiple times)\n\nCustomer Name:\nLine #\nCarrier :\nDevice :\nIMEI 1 :\nIMEI 2 :\nEID :\nOld ICCID :\nNew ICCID :\n\nIf there is an existing order which is related to new device activation and is pending activation proceed with completing the same create a task and close.",
    "step2": "If issue with new eSIM - Create a ticket with ATT partner exchange Assurance team",
    "step3": "",
    "device_steps": {
      "iphone": "iPhone: complete on → device eSIM setup when prompted. Settings → Cellular → Add eSIM. Delete: Settings → Cellular → [plan] → Delete eSIM.",
      "ipad": "iPad (cellular): Settings → Cellular Data → Add Cellular Plan. Delete via Settings → Cellular Data → [plan] → Delete eSIM.",
      "samsung": "Samsung: : Settings → Connections → SIM manager → Add eSIM. Remove via SIM manager → eSIM → Remove.",
      "pixel": "Pixel: Settings → Network & internet → SIMs → Download a SIM instead.",
      "kyocera": "Kyocera: Settings → System → Reset options → Reset Wi-Fi, mobile & Bluetooth → Reset Settings",
      "other": null
    }
  },
  {
    "id": "voicemail",
    "label": "Voicemail not working",
    "source_issue": "Voicemail not wokring",
    "step1": "Perform the basic troubleshooting needed and verify if the voicemail feature is added to user’s line. Usually VM feature is basic for all lines. Advise users they can access voicemail by Holiding \"1\" on their dail pad and complete the setup.",
    "step2": "Reach out to carrier tier 1 support (**1-888-334-3787** Security PIN: **10426**) to investigate if there is any provisioning issue (If line has the required feature and no provisioning issue work with end user further troubleshoot on a conference call with the carrier support team to resolve).",
    "step3": "Create a ticket with ATT partner exchange Assurance team",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "visual-voicemail",
    "label": "Visual Voicemail not working",
    "source_issue": "Visual Voicemail not wokring",
    "step1": "Perform the basic troubleshooting needed and verify if the Visual voicemail feature is added to user’s line. Carrier no longer has acess to reprovision VVM so to troubleshoot remove VM feature from the line and re-add.",
    "step2": "Unfortunately carrier will be able to troubleshoot but not and add and remove feature to user’s line",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "voicemail-password",
    "label": "Voicemail password change",
    "source_issue": "Voicemail password change",
    "step1": "Log into OPUS (https://opus.att.net/cc) and follow the instructions in the wiki guide on how to reset the voicemail password. Usually, the voicemail password would be last 7 digits off the MDN, please share the same with the end user and proceed with closing the case. Advise user the exisiting voicemails will not be lost and only the password will be changed.",
    "step2": "If issue error with portal - Create a ticket with ATT partner exchange Assurance team",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "roaming",
    "label": "International Roaming",
    "source_issue": "International Calling/Data Not working(Roaming issue) :User has travelled to different country and having issue with Calls/Data",
    "step1": "Log into the carrier portal and verify if international roaming(International data pass/International Feature) is enabled on the line once verified have user enable data roaming on their line and share information with user on how to select Network manually sharing steps from device FAQ’s available.\n\nIf line does not show International Feature added on the carrier portal, please verify if the line has order for international service and work with the order manager to add international roaming to their line and in their absence add the accurate feature manually and update the order manager via e-mail.",
    "step2": "If the issue still remains confirm user when international roaming was added to their line, check if they were in the home country when the international roaming was added and work with carrier to perfrom additional TS\n\nIf user is already outside the country and the international roaming has been added post their departure advise user that there is no guarantee that international roaming would work as it is important to device to be connected to the domestic network before leaving to apply the feature",
    "step3": "If user has not yet travelled or has no order for international service have the point of contact place an order using the customer reference guide.Use the Mobility Order Required template in iPath and advise the customer they will need to place the request to add International service\nInclude the latest version of the Customer Reference Guide\nCopy the Customer care Team on the notification to the customer\nSet the ticket for closure",
    "device_steps": {
      "iphone": "iPhone: Settings → Cellular → Cellular Data Options → Data Roaming → On",
      "ipad": "iPad: Settings → Cellular Data → Data Roaming → On",
      "samsung": "Samsung: : Settings → Connections → Mobile networks → Data roaming → On",
      "pixel": "Pixel: Settings → Network & internet → SIMs → [SIM] → Roaming → On",
      "kyocera": "Kyocera: Settings → System → Reset options → Reset Wi-Fi, mobile & Bluetooth → Reset Settings",
      "other": null
    }
  },
  {
    "id": "plan",
    "label": "Plan and feature change",
    "source_issue": "Plan / Feature Changes",
    "step1": "Plan/Feature change should only be done if there an order related the request. If no order please ask User/POC to place an order and work with the OM or Carrier to complete the order.",
    "step2": "Share the Mobility Order Required template and advise the customer they will need to place order for Plan/Feature change .\nInclude the latest version of the Customer Reference Guide\nCopy the Customer care Team on the notification to the customer\nSet the ticket for closure",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "outage",
    "label": "Proactive Outage Notification",
    "source_issue": "Proactive Outage Notification (carrier tier-1 check)",
    "step1": "Log into OPUS (https://opus.att.net/cc), verify line status for the MDN, and determine whether the report is single-line or multi-user / multi-site.",
    "step2": "Call AT&T Buyers' Club tier-1 at **1-888-334-3787** (Security PIN: **10426**) and ask for known outages / provisioning incidents. Capture the carrier reference number.",
    "step3": "If confirmed outage: update the NOC ticket, notify the POC, set proactive follow-up. If no outage: continue device-specific troubleshooting under Calls / Data / Network.",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "warranty",
    "label": "Warranty inquiry",
    "source_issue": "Device Warranty Replacements (Post all trroubleshooting and been performed)",
    "step1": "After all basic troubleshooting has been performed and the device is still having issues as reported please verify the devcie is purchsed through vCom or BYOD, check warranty Status and have User/POC place a warranty replacement request. Please make sure the reference number from the carrier troubleshooting is added to the ticket for order manager to use as reference for warranty replacement.\n\nPlease note: If device has any physical or water damage device will not be applicable for warranty replacement.",
    "step2": "Share the Mobility Order Required template and advise the customer they will need to place the warranty replacement request and User the case number as reference number to complete the replacement request.\nInclude the latest version of the Customer Reference Guide\nCopy the Customer care Team on the notification to the customer\nSet the ticket for closure",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "sim-replacement",
    "label": "SIM Replacement",
    "source_issue": "SIM Repalcement : -Issue issue is not resolved on live TS and Carrier advise to get User a new SIM.",
    "step1": "AT&T Buyers Club :- Send a request to **customercare@vcomsolutions.com** with the belew details:-\n\nWe request you please send out the new SIM card to the below address.\nPlease Ship (expedite or Normal) a new SIM card for Line MDN-\nCustomer :\nAccount :\nCarrier :\nDevice :\nIMEI :\nAttn:\nAddress:\n\nKeep the ticket open and track the delivery of the SIM Card and add the order number to the ticket and work with the customer to get the new SIM Activated and confirm with the customer that device is working properly after the new SIM Card.\nOnce the SIM card is activated please send request to the QScare team to update the inventory to show the new ICCID.",
    "step2": "Email ****customercare@vcomsolutions.com**** with ship-to details for a new SIM.",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "call-forwarding",
    "label": "Add / Remove Call Forwarding",
    "source_issue": "Add/Remove Call Forwading : User is requesting to forward call to a specific MDN",
    "step1": "Option 1: Call forward management is NOT available in OPUS (https://opus.att.net/cc). To enable/disable call forwarding:\nCall tier 1 support (**1-888-334-3787** Security PIN: **10426**) to Assist with adding/Removing call forwarding\n\nOption 2 : Turn “ON” Call Forwarding Manually form device : Note: Example: *21*1234567890# forwards your calls to the phone number 123-456-7890. Wait at least three seconds to hear a confirmation tone before ending the call.\nTurn “OFF” Call Forwarding: Dial #21#.",
    "step2": "If BITMOS team denies the request - Create a ticket with ATT partner exchange Assurance team to enable call forwarding",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "activate-suspended",
    "label": "Activate suspended line",
    "source_issue": "Activate Suspended line",
    "step1": "Check the line status in VCOM inventory to verify and confirm if line is in suspended state and verify the line status on carrier portal. Once confirmed please have Caller/POC place an order following the customer reference guide.\n\nPlease note this line will not be lost if it's suspended more than 30 days which is different from being disconnected and can be reactivated at any point of time.",
    "step2": "To expedite the reconnection have POC place an order and share the order number with the order manager and update user once the line is reconnected.",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "email",
    "label": "Adding Email (Outlook / Microsoft)",
    "source_issue": "Adding Email (Outlook/Microsoft)",
    "step1": "If User/POC is informing that they are not getting their Emails on their device confirm if their data is working and assist user on logging into their Outlook/Microsoft account",
    "step2": "Carrier will not assist with Adding Email related quires",
    "step3": "Share the relevant device FAQ steps for the customer's device type.",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "battery",
    "label": "Battery issue",
    "source_issue": "Battery Issue",
    "step1": "User/POC reporting Battery issue- Research to find basic troubleshooting steps according to the device type and share to perform initial troubleshooting.",
    "step2": "if the issue remains check if device has any Physical/Water damage. If not advise user to submit warranty replacement if applicable",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "billing",
    "label": "Billing related issue",
    "source_issue": "Billing related issue",
    "step1": "Route the User/POC to Customer care Team",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "block-number",
    "label": "Block a number",
    "source_issue": "Block a number",
    "step1": "User/POC requesting to block a number, please advise carrier will not have option to block a number and they will have to Manually perform the steps to block a number.\n\nNote :Number can be flagged/Reported as Spam at the carrier's system which will be blocked by their filtering system.",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "usage-report",
    "label": "Call or Data usage report",
    "source_issue": "Call or Data Usage details report",
    "step1": "If user is requesting for call records for a single line advice POC/User to follow the instrction on Viki Page listed below for Data usage engage C3",
    "step2": "For call records use the Requesting Mobility Call Records process; for data usage engage C3 / Customer Care.",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "caller-id",
    "label": "Caller ID update / change",
    "source_issue": "Caller ID update/Change",
    "step1": "A telephone service that allows a subscriber to identify the telephone number of a caller before answering the call. To Update caller ID call AT&T Wireless Via Buyer’s club on call support team at **1-888-334-3787** Security PIN: **10426**.\n\nNote : Please be advised User/POC that the change can take 48-72 Hours to update and upto 2-3 weeks at smaller carrier",
    "step2": "If the caller is still not updated please escalte with the carrier and follow up with the end user after 72hours.",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "voicemail-full",
    "label": "Delete Voicemail / Voicemail full",
    "source_issue": "Delete Voicemail/Voicemail Full : User reporting is VM box is full and cannot recive more Voicemails",
    "step1": "Advice user that the NOC cannot delete user’s voicemail due to the privacy protocol at the carrier's end and they will have to manually remove voicemails from their visual voicemail app or following the instructions listed on device FAQ on how to delete voicemail from their device.\n\nIf user is advising that that they have been assigned to this phone and want provision the voicemail as new, please work with the carrier to provision the voicemail as new so that user can set up the voicemail as they need. Please note- Once provisioned all existing voicemails will be deleted and cannot be retrieved",
    "step2": "Share the relevant device FAQ steps for the customer's device type.",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "power",
    "label": "Device power issue",
    "source_issue": "Device power Issue",
    "step1": "Please work with the end user to perform basic troubleshooting and engage carrier to confirm if additional troubleshooting can be done, please confirm if the device has any physical or water damage and check the eligibility for warranty replacement.\n\nIf the issue remains advice user to submit a warranty replacement if the device is under warranty or something to change request if the device is not eligible.",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "disconnect",
    "label": "Disconnect line",
    "source_issue": "Disconnect Line",
    "step1": "Caller requesting to disconnect a line i.e., the line will be disconnected as it is no longer needed by the customer, User no longer with company, Line not in use, Device stolen/Lost.\n\nCheck the line status in VCOM inventory to verify the line status and confirm if we have an existing disconnect order and verify the line status on carrier portal (If not order follow step 2) If there is an existing order reach out to the OM to complete the request. During weekends and holidays get confirmation from the NOC manager and proceed with the instructions listed.",
    "step2": "Please have POC place a disconnect order, following customer reference guide slide #0. (Please note the line can only be reconnected within 30days of the disconnection and cannot be reconnected once the 30 days’ time window is passed).\n\nWithin 30 days – Reconnect order will be needed\nAbove 30day - User will have to opt for new line of service",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "etf",
    "label": "ETF amount",
    "source_issue": "ETF amount",
    "step1": "Route the User/POC to Customer care Team",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "factory-reset",
    "label": "Factory reset",
    "source_issue": "Factory reset",
    "step1": "User requesting assistance on Factory reset their device please share the steps according to their device type from device FAQ's",
    "step2": "Carrier will not assist with Factory reset related quires",
    "step3": "Share the relevant device FAQ steps for the customer's device type.",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "factory-reset-vm",
    "label": "Factory reset Voicemail",
    "source_issue": "Factory reset Voicemail",
    "step1": "User/POC requesting to Factory reset Voicemail as user wants to setup the VM as new, please advise user that all existing VM will be lost and user can setup the Voicemail by dailing \"1\". Please set the VM password and share the details with the required party.",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "flipflop",
    "label": "Flip-Flop device",
    "source_issue": "Flip- Flop Device: Interchanging number with one other within the organization (From one device to another).",
    "step1": "Check the line status and see if there is a pending flip-Flop order. Once confirmed work with the POC/User to confirm service.\n\nDo not make any changes or activate a new device without an order always advise User/POC to place an order to port device share the required reference guide.",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "new-number",
    "label": "Get a new number",
    "source_issue": "Get a new Number: User/POC requesting to get a new number or change the existing number",
    "step1": "Check the line status and see if the order is completed and share the new MDN, if the request is still pending work with the Order manager to complete the order and share the new MDN once completed.",
    "step2": "If no order share the Mobility Order Required template and advise the customer they will need to place order to Get a new number/Change a number\nInclude the latest version of the Customer Reference Guide\nCopy the S&S CSM on the notification to the customer\nSet the ticket for closure",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "backup",
    "label": "iPhone data Backup / Transfer",
    "source_issue": "Iphone data Backup/Transfer",
    "step1": "User requesting assistance on Backing up their Data please share the steps according to their device type from device FAQ's",
    "step2": "Carrier will not assist with Data Backup related quires",
    "step3": "Share the relevant device FAQ steps for the customer's device type.",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "abm",
    "label": "Not enrolled in ABM",
    "source_issue": "Not enrolled in ABM",
    "step1": "ABM- Apple buisness Manager, please reach out to order manager to confirm with vendor if device is enrolled in ABM\n\nIf No- Have user work with their inetrnal team to verify if device's serial number is added to Apple buisness Manager\n\nIf Yes- Have user perfrom and factory reset and install the devcie as new",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "accessories",
    "label": "Order accessories",
    "source_issue": "Order Accessories",
    "step1": "Ordering accessories is not currently available to order in the vManager Marketplaces but will hopefully be coming soon. We sincerely apologize for any inconvenience",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "wearable",
    "label": "Order wearable",
    "source_issue": "Order Wearable",
    "step1": "POC/User Requesting to add a Wearable (Apple watch) to the line advise to place an order following the Customer reference guide and if you already see a line Confirm with the user if they need help with the device activation and proceed with troubleshooting to confirm Service.",
    "step2": "To expedite the reconnection have POC place an order and share the order number with the order manager and update user once the device is activated",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "payoff",
    "label": "Pay off device",
    "source_issue": "Pay Off device",
    "step1": "Route the User/POC to Customer care Team",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "receipt",
    "label": "Phone receipt / Bill",
    "source_issue": "Phone receipt/Bill",
    "step1": "If user/POC is requesting for Phone receipt/Bill check the order details for the line to find the phone Bill or reach out to the Order manager for help.",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "port",
    "label": "Port a line",
    "source_issue": "Port a line : User/POC requestion to Port a line to a new Carrier.",
    "step1": "Check the line status and see if there is a pending order to Port the line a new carrier. Once confirmed please login to the carrier portal and verify the Porting status if port has not been completed proceed with completing the port and if the line has already been Ported share the update and troubleshoot with the user to confirm service.\n\nDo not make any changes or activate a new device without an order always advise User/POC to place an order to port device share the required reference guide.",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "reactivate",
    "label": "Reactivate disconnected line",
    "source_issue": "Activate Deactivate Line",
    "step1": "Check the line status in VCOM inventory and verify if the line is disconnected and verify the same at the carrier's end. Please be advised that line can only be reactivated within 30 days off disconnection to verify the same please see the order to check when the line was disconnected and if it's been more than 30 days have POC aware that the line cannot be reactivated, and an order would be needed to assign a new MDN to this device.\n\nIf the disconnection was within 30 days advice POC to place a new order to reconnect the line.",
    "step2": "To expedite the reconnection have POC place an order and share the order number with the order manager and update user once the line is reconnected.",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "inventory",
    "label": "Record-only / Inventory update",
    "source_issue": "Record only change requests /Inventroy Update",
    "step1": "Engage Customer care team for inventory update- **customercare@vcomsolutions.com**\nPlease share the required details in the e-mail and make sure the details are updated before closing any required case.",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "mdm",
    "label": "Remote management / MDM issue",
    "source_issue": "Remote management realated Issue",
    "step1": "If user is reporting that they have existing MDM from a different business our carrier preinstalled and will not allow for them to access or set up the device. Share the details with the Order manager to work with the vendor to remove the MDM and share information on how to perform a factory reset on the device to remove the MDM.",
    "step2": "Share the relevant device FAQ steps for the customer's device type.",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "lost-stolen",
    "label": "Report device lost or stolen",
    "source_issue": "Report a device lost or stolen",
    "step1": "Advise user to submit a Suspend order for Stolen/Lost so Order manager can suspend the line and work to blacklist the device",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "sim-lock",
    "label": "SIM lock / SIM restriction",
    "source_issue": "SIM lock /SIM restriction",
    "step1": "If User/POC is reporting their device is Carrier locked, follow the instructions on how to Unlock a device in new Mobility Process and Procedure.",
    "step2": "Follow the Mobility unlock-device process (work with Order Manager if needed).",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "software-update",
    "label": "Software update",
    "source_issue": "Software Update",
    "step1": "User requesting assistance on updating their device's software please share the steps according to their device type from device FAQ's",
    "step2": "Carrier will not assist with Software update related quires",
    "step3": "Share the relevant device FAQ steps for the customer's device type.",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "spam",
    "label": "Spam Call / Text",
    "source_issue": "Spam Call/Text",
    "step1": "User is reciving to many spam calls and text advise user to place an order to Add call Scam call protection feature to their Line and share the Customer Ref. Guide(ActiveArmor)",
    "step2": "Advise users they can block the numbers they are recoving calls from and",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "suspend",
    "label": "Suspend line",
    "source_issue": "Suspend line",
    "step1": "Customer reaching to suspend the line temporarily due to reasons where User no longer with company, Line not in use, Device stolen/Lost.\n\nCheck the line status in VCOM inventory to verify if we have any existing Suspend order and also verify the line status on carrier portal(If no order follow step 2) If there is an existing order reach out to the OM to complete the request. During weekend and holidays get confirmation from NOC manager and proceed with the instructions to suspend.",
    "step2": "An Order is needed to Suspend any line have POC place an order from Customer refrence Guide. (Note- The line will be in suspended state till 90 days and will automatically be resumed even if not order is submitted to resume service and to unsuspend/reconnect the line before 90day POC will have to submit a reconnect order)",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "transfer",
    "label": "Transfer a line",
    "source_issue": "Transfer a Line : User/POC requesting to Transfer the line to a new Account",
    "step1": "Check the line status and see if there is a pending order to Transfer the line a new account. Once confirmed please login to the carrier portal and verify the Transfer status if transfer has not been completed proceed with completing the port and if the line has already been transferred share the update and troubleshoot with the user to confirm service.\n\nDo not make any changes or activate a new device without an order always advise User/POC to place an order to port device share the required reference guide.",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "tol",
    "label": "Transfer of Liability out",
    "source_issue": "Transfer of Liability out : User/POC requesting to change the Billing responsibity to their Personal Account",
    "step1": "Transfer of liability would mean as user trying to move the line from the business account to their personal account which can be within carrier or from one carrier to another. Check the line status and see if there is a pending order for TOL and user requesting additional help please share the account number, address and the transfer pin for user to complete the TOL.\n\nPlease be advised once TOL is placed order manager will port out the line from business account and the user will have to work with their new carrier to complete the port in.",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "unlock-password",
    "label": "Unlock device password issue",
    "source_issue": "Unlock device password issue",
    "step1": "If user is reporting that they have forgot their devices password advise user to perform factory reset and if this remains advise user to visit Apple store as Carrier will not be able to assist with device password related issue.",
    "step2": "If the user is requesting for proof of purchase work with the S&S CSM to share the proof of purchase so that user can take the device to the apple store and get it unlocked.",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "upgrade-device",
    "label": "Upgrade / Change device",
    "source_issue": "Upgrade/Change device: POC/User requesting to activate a new device.",
    "step1": "Check the line status and see if there is a pending order to upgrade/Change device. Once confirmed please log in to the carrier portal and verify the activation status if the new device has not been activated proceed with the same and if the line has already been activated troubleshoot with the user to confirm service.\n\nDo not make any changes or activate a new device without an order please advise User/POC to place an order to activate any new device share the required reference guide.",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  },
  {
    "id": "wifi-calling",
    "label": "Wi-Fi Calling issue",
    "source_issue": "Wifi Calling issue",
    "step1": "If POC/User is reporting that Wifi calling is disabled/Not working, access carrier portal and verify is Wifi Calling feature is enabled (Work with the carrier to confirm if Wi-Fi calling feature has been added to their line) if feature not added please add fetaure to their line make changes to features on ATT OPUS portal.",
    "step2": "",
    "step3": "",
    "device_steps": {
      "iphone": null,
      "ipad": null,
      "samsung": null,
      "pixel": null,
      "kyocera": null,
      "other": null
    }
  }
];

export function getBundledMobilityResponse(): MobilityResponse {
  return {
    source: "bundled",
    carrier: MOBILITY_CARRIER.id,
    carrier_label: MOBILITY_CARRIER.label,
    portal_url: MOBILITY_CARRIER.portal_url,
    support_phone: MOBILITY_CARRIER.support_phone,
    support_pin: MOBILITY_CARRIER.support_pin,
    fetched_at: new Date().toISOString(),
    issues: MOBILITY_ISSUES,
    warning:
      "Showing bundled Mobility Matrix fallback (offline catalog). Live OPUS fetch was unavailable.",
  };
}
