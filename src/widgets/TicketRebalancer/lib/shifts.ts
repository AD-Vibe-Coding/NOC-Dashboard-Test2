// Shift schedule and transitions for handoff-style rebalancing.
// Times are PST (matches the roster sheet header note).

export type ShiftId = 1 | 2 | 3 | 4 | 5;

export interface ShiftDef {
  id: ShiftId;
  name: string;
  /** start hour in 24h time, PST */
  startHour: number;
  startMinute: number;
  /** end hour in 24h time, PST. May be earlier than startHour for overnight. */
  endHour: number;
  endMinute: number;
  /** Posting time the script should fire at, PST. */
  postingTime: string;
}

export const SHIFTS: ShiftDef[] = [
  {
    id: 1,
    name: "Early Morning",
    startHour: 3,
    startMinute: 0,
    endHour: 12,
    endMinute: 0,
    postingTime: "3:45 AM",
  },
  {
    id: 2,
    name: "Morning",
    startHour: 6,
    startMinute: 0,
    endHour: 15,
    endMinute: 0,
    postingTime: "6:45 AM",
  },
  {
    id: 3,
    name: "Mid-Day",
    startHour: 8,
    startMinute: 0,
    endHour: 17,
    endMinute: 0,
    postingTime: "8:45 AM",
  },
  {
    id: 4,
    name: "Afternoon",
    startHour: 11,
    startMinute: 0,
    endHour: 20,
    endMinute: 0,
    postingTime: "11:45 AM",
  },
  {
    id: 5,
    name: "Overnight",
    startHour: 19, // 7 PM
    startMinute: 0,
    endHour: 4, // crosses midnight
    endMinute: 0,
    postingTime: "7:45 PM",
  },
];

export function shiftById(id: ShiftId): ShiftDef {
  return SHIFTS.find((s) => s.id === id)!;
}

export interface ShiftTransition {
  id: string;
  label: string;
  /** Shift IDs whose agents are eligible to GIVE UP hot SLA tickets. */
  sourceShifts: ShiftId[];
  /** Shift ID whose agents are eligible to RECEIVE tickets. */
  targetShift: ShiftId;
  /**
   * If true, source agents are leaving — all of their eligible tickets MUST
   * move (target receives all). Pool for mean = target only.
   *
   * If false, source agents are still on shift — target is being added to
   * the pool to share load. Pool for mean = source ∪ target.
   */
  sourceGoingOff: boolean;
  /**
   * Offset (in days) from the analysis date to use when looking up source
   * agents in the roster. 0 = same day; -1 = previous day.
   *
   * The Shift 5 (Overnight) team starts at 7 PM the PREVIOUS calendar day,
   * so when running the 5→1 handoff at 3:45 AM on day D, the agents
   * actually working overnight are listed in column D-1 of the roster
   * (their "today" cell on day D is typically blank, WO, or a daytime
   * shift after their rest).
   */
  sourceDateOffset?: number;
  /** Brief context string for the Slack post header. */
  context: string;
}

export const SHIFT_TRANSITIONS: ShiftTransition[] = [
  {
    id: "5-to-1",
    label: "Shift 5 → Shift 1 (Overnight handoff)",
    sourceShifts: [5],
    targetShift: 1,
    sourceGoingOff: true,
    // Overnight agents clocked in at 7 PM the previous day — their roster
    // cell lives in YESTERDAY's column.
    sourceDateOffset: -1,
    context: "Overnight team handing off to Early Morning",
  },
  {
    id: "1-to-2",
    label: "Shift 1 → Shift 2 (Morning arrives)",
    sourceShifts: [1],
    targetShift: 2,
    sourceGoingOff: false,
    context: "Morning shift arriving — share load with Early Morning",
  },
  {
    id: "12-to-3",
    label: "Shifts 1+2 → Shift 3 (Mid-Day arrives)",
    sourceShifts: [1, 2],
    targetShift: 3,
    sourceGoingOff: false,
    context: "Mid-Day shift arriving — share load with Early Morning + Morning",
  },
  {
    id: "1-to-4",
    label: "Shift 1 → Shift 4 (Afternoon arrives)",
    sourceShifts: [1],
    targetShift: 4,
    sourceGoingOff: false,
    context: "Afternoon shift arriving — share load with Early Morning",
  },
];

// Parse a start time from a roster cell ("8:00 AM to 5:00 PM" → 8:00 AM)
// and match it to a known shift start with ±30 min tolerance.
export function detectShift(cellRaw: string | undefined | null): ShiftId | null {
  if (!cellRaw) return null;
  const m = cellRaw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3].toLowerCase().replace(/\./g, "");
  if (ampm === "pm" && h !== 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  const actualMin = h * 60 + min;
  let best: { id: ShiftId; diff: number } | null = null;
  for (const s of SHIFTS) {
    const expected = s.startHour * 60 + s.startMinute;
    const diff = Math.abs(actualMin - expected);
    if (diff <= 30 && (!best || diff < best.diff)) {
      best = { id: s.id, diff };
    }
  }
  return best?.id ?? null;
}
