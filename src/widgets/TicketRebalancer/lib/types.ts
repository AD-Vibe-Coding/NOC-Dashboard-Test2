import type { PriorityBand, SlaType, Stage } from "./weight-matrix";
import type { Tier } from "./team-config";
import type { ShiftId } from "./shifts";

export interface RawTicket {
  ticket: string;
  owner: string;
  stage: string;
  priority: string;
  service: string;
  issue?: string;
  type?: string;
  age?: number | string;
  last_updated_on?: string;
  // Column F in iPath exports — when the carrier/customer is expected to act.
  // Used for the "due today" dashboard count. Typed as `unknown` because XLSX
  // can hand back strings, Date objects, or Excel serial numbers depending on
  // cell formatting; the rebalancer's date parser handles all three shapes.
  due_date?: unknown;
  // keep original row for debugging
  _raw?: Record<string, unknown>;
}

export interface ScoredTicket extends RawTicket {
  sla: SlaType | "Unknown";
  priorityBand: PriorityBand;
  stageNorm: Stage | "Unknown";
  weight: number;
}

export type AvailabilityStatus =
  | "Available"
  | "WO"
  | "PTO"
  | "Sick Leave"
  | "Sick Leave - Tentative"
  | "Emergency Leave"
  | "Holiday"
  | "Blank"
  | "Other";

export interface RosterEntry {
  name: string;
  tier?: Tier;
  isManager: boolean;
  cellRaw: string;
  status: AvailabilityStatus;
  shift?: string; // e.g. "08:00 AM to 05:00 PM"
  shiftId?: ShiftId; // detected from the time-range start
  available: boolean;
}

export interface AgentLoad {
  name: string;
  tier?: Tier;
  available: boolean;
  shiftId?: ShiftId;
  ticketCount: number;
  weight: number;
  band: "over" | "under" | "ok" | "n/a";
  delta: number; // weight - mean
  // Count of tickets in stage "Pending Carrier Action / Update" with
  // priority Critical or High — the most active, highest-weight tickets.
  hotTickets: number;
  // Count of tickets in stage "Pending Customer Response" — these are
  // waiting on the customer, so they're parked load (not actively worked).
  pendingCustomer: number;
  // Count of tickets in stage "Pending RFO" owned by this agent.
  pendingRfo: number;
  // Active P1 (Critical) and P2 (High) tickets owned by this agent. "Active"
  // = anything not in "Pending Complete" (filtered out in rebalance()).
  p1Count: number;
  p2Count: number;
  // Active P3 = priority Medium + stage Pending Carrier Action / Update.
  // Tracked separately from the Medium/Low weight bucket because P3 is a
  // dashboard-headline metric, not a weight modifier.
  p3Count: number;
  // Active tickets due on the analysis date — stage Pending Carrier Action /
  // Update with a due_date matching today's calendar day.
  dueToday: number;
  // Aging buckets — count of tickets whose iPath `age` (in days) exceeds
  // the threshold. Surfaced on the dashboard as quick visual signals for
  // who is sitting on stale work.
  ageOver10: number;
  ageOver30: number;
}

export interface RebalanceMove {
  ticket: ScoredTicket;
  from: string;
  to: string;
  reason: string;
}

export interface RebalanceResult {
  date: string;
  totalTickets: number;
  totalWeight: number;
  availableAgents: number;
  meanLoad: number;
  band: number;
  agentLoads: AgentLoad[];
  unassignedOrUnknownOwner: ScoredTicket[];
  movesSuggested: RebalanceMove[];
  // Loads after applying suggested moves (preview).
  agentLoadsAfter: AgentLoad[];
  warnings: string[];
  // When a shift-handoff was run, this describes which transition.
  shiftTransition?: {
    id: string;
    label: string;
    context: string;
    sourceShifts: ShiftId[];
    targetShift: ShiftId;
    sourceGoingOff: boolean;
  };
}
