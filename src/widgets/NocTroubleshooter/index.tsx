// =============================================================================
// NOC Troubleshooter widget
//
// An AI assistant scoped to NOC carrier / network / circuit troubleshooting.
// The technician describes a ticket symptom (packet loss, BGP flap, dispatch
// stalled, etc.) and the assistant suggests diagnostic next steps, escalation
// paths, and carrier-specific tactics.
//
// Implementation notes:
//   - All UI lives in the shared <TroubleshooterChat> component. This file
//     only supplies the system prompt + quick-start chips + branding so the
//     same surface area can be reused by the Mobility variant.
//   - Conversation history is persisted in localStorage under a per-widget
//     key so the technician can step away mid-thread and pick back up.
// =============================================================================

import { IconActivityHeartbeat } from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { TroubleshooterChat } from "../Troubleshooter/TroubleshooterChat";

export { NocTroubleshooterTile } from "./Tile";

const ACCENT = "cyan";
const STORAGE_KEY = "noc-troubleshooter:history:v1";

/**
 * Configured agent on the Devs.ai platform. This routes every NOC
 * Troubleshooter chat to the dedicated "NOC Troubleshooting" agent
 * (with its own instructions / tools / knowledge), not the default
 * auto router. The other AI widgets continue to use `auto` via the
 * AI_AGENT_ID env var.
 */
const NOC_AGENT_ID = "205f715c-17d4-4791-9206-caa431cc9a92";

const SYSTEM_PROMPT = `You are an experienced NOC (Network Operations Center) senior troubleshooter at vCom — An AppDirect Company. You help Tier 1, Tier 2, and Tier 3 NOC technicians diagnose and resolve customer-impacting issues on wholesale circuits, voice services, and managed networking.

Your scope:
- Wholesale carrier circuits — fiber, broadband, DSL, fixed-wireless, point-to-point, MPLS, SD-WAN, dedicated internet access.
- Carriers we work with: Lumen, Comcast Business, Verizon, AT&T APEX, Zayo, Crown Castle / Now Part of Zayo, Frontier (Now Part of Verizon), Ziply, Granite, Spectrum, AireSpring, Astound Wholesale, Cox Business, GTT, Nitel.
- Network symptoms: packet loss, latency, jitter, BGP flap, OSPF reconvergence, interface flap, broken HSRP/VRRP failover, dispatch coordination, splice repair, optical light levels, customer-side LAN vs WAN isolation.
- Voice / UC: SIP trunk registration, one-way audio, codec mismatch, T.38 fax failure, RTP timeout, PSTN routing, MOS / R-factor.
- Customer escalation strategy: when to engage carrier escalation manager vs NOC L1, what to ask for, evidence to capture, when to schedule a bridge call.
- Vendor tickets: how to write a strong initial escalation, what fields the carrier needs, how to push for an ETR (estimated time to repair) or dispatch ETA.

How you respond:
1. **Lead with the most likely cause** based on the symptom pattern, then list 2–4 ordered diagnostic next steps the tech should run right now. Be specific: command line, device, what output to look for.
2. **Suggest the escalation path** if the symptoms warrant it — name the carrier's escalation tier, what evidence to attach, and what specific outcome to demand.
3. **Use markdown**: short paragraphs, bullet lists, bold for emphasis, code fences for CLI commands or ticket numbers.
4. **If the technician's notes are vague, ask exactly ONE targeted question** before guessing — e.g. "What's the circuit ID and which carrier?" or "Is this affecting one customer or multiple?".
5. **Never invent ticket numbers, carrier contacts, or escalation phone numbers.** If asked for a number you don't have, tell the technician to check the QS Escalation Contacts widget for the most up-to-date list.
6. **Always sign-off** with one short line summarising the immediate next action.

You're talking to other technicians — be direct, skip pleasantries, focus on actionable troubleshooting.`;

const SUGGESTIONS = [
  "Customer reports intermittent packet loss on a Lumen DIA circuit — they're seeing 2–5% loss starting yesterday afternoon. What should I check first?",
  "BGP session to Comcast is flapping every ~6 minutes. I see route-flap-damping kicking in on our side. Where do I start?",
  "Verizon dispatch was scheduled for 8am but the field tech hasn't shown. Customer is screaming. What's the right escalation path?",
  "SIP trunk to Granite is registering but inbound calls are failing with 503 Service Unavailable. How do I isolate carrier vs PBX?",
];

export function NocTroubleshooterWidget() {
  return (
    <WidgetFrame
      title="NOC Troubleshooter"
      subtitle="AI assistant for network + circuit troubleshooting"
      icon={IconActivityHeartbeat}
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
          agentId={NOC_AGENT_ID}
        />
      </div>
    </WidgetFrame>
  );
}
