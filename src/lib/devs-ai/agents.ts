export type AiAgentDefinition = {
  id: string;
  label: string;
  description?: string;
};

export const AI_AGENTS: AiAgentDefinition[] = [
  {
    id: "auto",
    label: "Auto Router",
    description: "General-purpose assistant without a widget-specific knowledge-base agent",
  },
  {
    id: "d5b2744f-ccc0-44cd-8db8-15ed75fd652a",
    label: "Ticket Auditor",
    description: "Audits tickets and operational quality",
  },
];

export function getDefaultAgentId() {
  return "auto";
}

export function getAgentOptions() {
  return AI_AGENTS.map((agent) => ({
    value: agent.id,
    label: agent.label,
  }));
}

export function getAgentLabel(agentId: string | null | undefined) {
  if (!agentId) return "Unknown agent";
  return AI_AGENTS.find((agent) => agent.id === agentId)?.label ?? agentId;
}
