export type AiAgentDefinition = {
  id: string;
  label: string;
  description?: string;
};

const DEFAULT_AGENT_ID = String(import.meta.env.VITE_AI_AGENT_ID ?? "").trim();

export const AI_AGENTS: AiAgentDefinition[] = [
  ...(DEFAULT_AGENT_ID
    ? [{ id: DEFAULT_AGENT_ID, label: "Default Assistant", description: "General-purpose assistant" }]
    : []),
  {
    id: "d5b2744f-ccc0-44cd-8db8-15ed75fd652a",
    label: "Ticket Auditor",
    description: "Audits tickets and operational quality",
  },
];

export function getDefaultAgentId() {
  return AI_AGENTS[0]?.id ?? "";
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
