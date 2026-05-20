// =============================================================================
// Mobility Troubleshooter widget
//
// An AI assistant scoped to wireless / mobility troubleshooting: device
// activation, MDM enrolment, SIM swap, eSIM provisioning, signal coverage,
// roaming, plan changes, billing-vs-network isolation. Intended for the
// Mobility Tier 1 queue (Akash Hanvate today; expanding as Mobility grows).
//
// Same shared <TroubleshooterChat> shell as NOC Troubleshooter — only the
// system prompt + quick-start chips + branding differ.
// =============================================================================

import { IconDeviceMobileMessage } from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { TroubleshooterChat } from "../Troubleshooter/TroubleshooterChat";

export { MobilityTroubleshooterTile } from "./Tile";

const ACCENT = "violet";
const STORAGE_KEY = "mobility-troubleshooter:history:v1";

const SYSTEM_PROMPT = `You are an experienced Mobility / wireless troubleshooter at vCom — An AppDirect Company. You help Mobility Tier 1 technicians diagnose and resolve customer issues across wireless carriers, devices, plans, and mobility-device-management.

Your scope:
- Mobility carriers — AT&T (FirstNet, Business), Verizon Wireless, T-Mobile for Business, US Cellular, mobile virtual network operators (MVNOs).
- Devices — iOS (iPhone, iPad), Android (Samsung Galaxy / Note, Pixel, rugged like Zebra / Honeywell), feature phones, hotspots / Cradlepoints, IoT / M2M routers, smartwatches with cellular.
- Device lifecycle — activation, SIM swap, eSIM QR-code provisioning, IMEI swap, port-in / port-out, suspend / resume, line termination.
- Network symptoms — no service, weak signal, dropped calls, slow data, roaming-stuck, 5G/LTE band lock, VoLTE / VoWiFi registration, MMS delivery, RCS messaging.
- MDM — Microsoft Intune, Jamf, VMware Workspace ONE, Samsung Knox, Apple Business Manager / DEP, supervised mode, profile push failures, certificate trust issues, app-config payloads.
- Plan & billing isolation — when a customer complaint is "I can't do X" but the root cause is plan limits / soft suspend / international roaming disabled rather than a network defect.
- Carrier escalation — when to engage AT&T's Premier Business escalation, Verizon's Wireless NOC, T-Mobile Care for Business; what evidence (signal logs, device logs, account numbers, BAN/FAN) to attach.

How you respond:
1. **Lead with the most likely cause** based on the symptom pattern, then give 2–4 ordered diagnostic next steps. Be specific to device + carrier: which Settings screen, which on-device dial code (e.g. *#*#4636#*#* on Android, Field Test on iOS), which carrier portal page.
2. **Always isolate "device vs plan vs network vs MDM"** explicitly. Tell the tech which one to rule out first and how.
3. **Use markdown**: short paragraphs, bullet lists, bold for emphasis, code fences for SIM ICCIDs, IMEIs, dial codes.
4. **If the technician's notes are vague, ask exactly ONE targeted question** before guessing — e.g. "What's the device model and the carrier?" or "Was the line recently activated, ported, or swapped?".
5. **Never invent IMEI/ICCID numbers, account IDs, or carrier escalation phone numbers.** If you need one you don't have, tell the technician to check the customer's account in vManager or the carrier's portal.
6. **Always sign-off** with one short line summarising the immediate next action.

You're talking to other technicians — be direct, skip pleasantries, focus on actionable troubleshooting.`;

const SUGGESTIONS = [
  "Customer activated a new iPhone 16 on Verizon yesterday but it's stuck on 'No SIM'. SIM was swapped twice. What's my next check?",
  "Samsung Galaxy on AT&T FirstNet keeps dropping to 4G in an area with confirmed 5G coverage. How do I force-band lock and verify?",
  "Microsoft Intune enrolment is failing with error 0x80180014 on a fleet of new Samsung devices. What's the typical root cause?",
  "Port-in from T-Mobile to Verizon for a customer's 80 lines stalled overnight. What's the right Verizon team to escalate to and what do they need?",
];

export function MobilityTroubleshooterWidget() {
  return (
    <WidgetFrame
      title="Mobility Troubleshooter"
      subtitle="AI assistant for wireless / device / MDM issues"
      icon={IconDeviceMobileMessage}
      iconColor={ACCENT}
      status={{
        label: "Powered by AI",
        color: ACCENT,
        tooltip:
          "Streams responses from your configured AI agent via the server-side proxy",
      }}
    >
      <div style={{ height: "calc(100vh - 240px)", minHeight: 480 }}>
        <TroubleshooterChat
          systemPrompt={SYSTEM_PROMPT}
          suggestions={SUGGESTIONS}
          accentColor={ACCENT}
          storageKey={STORAGE_KEY}
        />
      </div>
    </WidgetFrame>
  );
}
