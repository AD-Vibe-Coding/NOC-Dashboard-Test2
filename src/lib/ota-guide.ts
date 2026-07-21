/**
 * Bundled OTA (Over the Air) network-refresh procedure for ATT Buyers' Club / OPUS.
 * Shown when the tech clicks an "OTA" link in Mobility Troubleshooter steps.
 */

export const OTA_GUIDE = {
  title: "OTA network refresh",
  subtitle: "Over-the-Air signal refresh from OPUS (ATT Buyers' Club)",
  portalUrl: "https://opus.att.net/cc",
  summary:
    "An OTA (Over the Air) network refresh pushes a carrier-side signal to the line so the device re-registers on the network. Send it after IMEI and ICCID match vCom inventory.",
  whenToUse: [
    "Calls inbound / outbound, static, SOS, or no service",
    "Data not working or slow (after throttle / block checks)",
    "SMS / MMS / iMessage issues",
    "After removing a data block or completing a provision change",
  ],
  steps: [
    {
      title: "Open OPUS",
      detail:
        "Log into the ATT Buyers' Club portal at https://opus.att.net/cc with your OPUS credentials.",
    },
    {
      title: "Locate the line",
      detail:
        "Search by MDN (mobile number). Open the subscriber / line record that matches the ticket.",
    },
    {
      title: "Verify IMEI and ICCID",
      detail:
        "Confirm the IMEI and ICCID shown in OPUS match vCom inventory for this line. Do not send OTA if they do not match — correct the mismatch first.",
    },
    {
      title: "Send the OTA network refresh",
      detail:
        "From the line tools / Mobile Maintenance area, send an OTA (Over the Air) network refresh / network signal refresh to the user's line. Confirm the portal shows the OTA as submitted or successful.",
    },
    {
      title: "Notify the customer",
      detail:
        "Tell the customer an OTA refresh was sent from the carrier end. Ask them to keep the device powered on with signal (not airplane mode) for a few minutes so it can receive the refresh.",
    },
    {
      title: "Walk through device-side steps",
      detail:
        "Have the user verify IMEI/ICCID on device, perform a SIM pull (physical SIM only), and a Network reset for their device type. For eSIM, Network reset only — skip SIM pull.",
    },
    {
      title: "Collect findings",
      detail:
        "Ask the customer to share results after the OTA and device steps. If still broken, continue to carrier tier-1 checks.",
    },
  ],
  notes: [
    "OTA = Over the Air network refresh signal from the carrier portal — not an OS software update.",
    "Always verify IMEI + ICCID against vCom inventory before sending OTA.",
    "eSIM lines: skip SIM pull; Network reset only after OTA.",
    "If OTA fails in OPUS, note the error and escalate to carrier tier-1 (1-888-334-3787, PIN 10426).",
  ],
} as const;

/** Markdown fragment used so step text can deep-link into the OTA modal. */
export const OTA_LINK_HREF = "#ota-guide";

/**
 * Turn bare "OTA" mentions into markdown links that open the OTA popup.
 * Existing markdown links are protected so we never double-wrap.
 */
export function linkifyOtaMentions(text: string): string {
  if (!text) return text;

  // Stash existing [label](href) links so later \bOTA\b matches can't nest.
  const protectedChunks: string[] = [];
  let out = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m) => {
    protectedChunks.push(m);
    return `\u0000L${protectedChunks.length - 1}\u0000`;
  });

  out = out
    .replace(
      /\bOTA\s*\(\s*Over the Air\s*\)/gi,
      `[OTA (Over the Air)](${OTA_LINK_HREF})`,
    )
    .replace(/\bOTA\b/g, `[OTA](${OTA_LINK_HREF})`);

  out = out.replace(/\u0000L(\d+)\u0000/g, (_, i) => protectedChunks[Number(i)]);
  return out;
}
