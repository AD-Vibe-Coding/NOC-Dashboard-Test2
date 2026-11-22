export type VolumeKey =
  | "tickets_received"
  | "inbound_calls"
  | "outbound_calls"
  | "mobility_tasks";

export type VolumeDef = {
  key: VolumeKey;
  label: string;
  short: string;
};

export const VOLUME_DEFS: VolumeDef[] = [
  { key: "tickets_received", label: "Total tickets received", short: "Tickets" },
  { key: "inbound_calls", label: "Total inbound calls", short: "Inbound" },
  { key: "outbound_calls", label: "Total outbound calls", short: "Outbound" },
  { key: "mobility_tasks", label: "Total mobility tasks", short: "Mobility tasks" },
];
