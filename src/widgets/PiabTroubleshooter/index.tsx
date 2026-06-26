import { IconBook } from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { TroubleshooterChat } from "../Troubleshooter/TroubleshooterChat";

export { PiabTroubleshooterTile } from "./Tile";

const ACCENT = "indigo";
const STORAGE_KEY = "piab-troubleshooter:history:v1";
const PIAB_AGENT_ID = "9a816dd0-2e36-496c-ba57-26d483845821";

const SYSTEM_PROMPT = `You are the dedicated PIAB Troubleshooter surface inside the Devs.ai dashboard.

Use the PIAB Knowledge Base agent and keep every answer focused on PIAB-related troubleshooting, diagnosis, configuration guidance, and next-step recommendations.

How to respond:
- Lead with the most likely explanation or failure point.
- Give clear, ordered troubleshooting steps.
- Call out what evidence or screenshots/logs the technician should collect next.
- If the request is ambiguous, ask one precise follow-up question.
- Use concise markdown with bullets and short sections.
- End with one line stating the immediate next action.`;

const SUGGESTIONS = [
  "A PIAB workflow is failing after a recent change. What should I verify first?",
  "Help me troubleshoot a PIAB issue and give me the most likely cause plus next steps.",
  "Rewrite this PIAB troubleshooting guidance into a short handoff update for the next shift.",
  "What logs, screenshots, or evidence should I collect before escalating this PIAB issue?",
];

export function PiabTroubleshooterWidget() {
  return (
    <WidgetFrame
      title="PIAB Troubleshooter"
      subtitle="Dedicated AI assistant powered by the PIAB Knowledge Base agent"
      icon={IconBook}
      iconColor={ACCENT}
      status={{
        label: "PIAB Agent",
        color: ACCENT,
        tooltip: "This widget is hard-wired to the PIAB Knowledge Base agent only.",
      }}
    >
      <div style={{ height: "calc(100vh - 240px)", minHeight: 480 }}>
        <TroubleshooterChat
          systemPrompt={SYSTEM_PROMPT}
          suggestions={SUGGESTIONS}
          accentColor={ACCENT}
          storageKey={STORAGE_KEY}
          agentId={PIAB_AGENT_ID}
        />
      </div>
    </WidgetFrame>
  );
}
