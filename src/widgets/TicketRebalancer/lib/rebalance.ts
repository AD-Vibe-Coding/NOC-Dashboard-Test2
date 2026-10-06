import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import type { ScoredTicket, RosterEntry, AgentLoad, RebalanceMove, RebalanceResult } from "./types";
import { TEAM, isManager, normalizeName } from "./team-config";
import {
  type ShiftTransition,
  shiftById,
  SHIFT_TRANSITIONS,
} from "./shifts";

dayjs.extend(customParseFormat);

function buildFallbackRosterEntry(name: string): RosterEntry | null {
  const member = TEAM.find((entry) => normalizeName(entry.name) === normalizeName(name));
  if (!member) return null;
  return {
    name: member.name,
    tier: member.tier,
    isManager: false,
    cellRaw: "CONFIGURED_TEAM_FALLBACK",
    status: "Available",
    available: true,
  };
}

function seedConfiguredTeamRoster(rosterByNorm: Map<string, RosterEntry>) {
  for (const member of TEAM) {
    const key = normalizeName(member.name);
    if (!rosterByNorm.has(key)) {
      const fallback = buildFallbackRosterEntry(member.name);
      if (fallback) rosterByNorm.set(key, fallback);
    }
  }
}

// "Pending Complete" tickets are essentially done — they must not count
// toward per-agent ticket counts, weighted load, or rebalance moves.
function isPendingComplete(t: ScoredTicket): boolean {
  return t.stageNorm === "Pending Complete";
}

// Active tickets = everything except Pending Complete. Used for ticketCount
// and totalTickets so the dashboard reflects real open work only.
function isCountedTicket(t: ScoredTicket): boolean {
  return !isPendingComplete(t);
}

// "Hot" = stage "Pending Carrier Action / Update" AND priority Critical or High.
// These are the highest-weight (3.0 – 5.0) tickets actively waiting on
// carriers; surfacing them per-agent helps the NOC lead see WHO is sitting
// on the hottest queue, not just who has the heaviest aggregate weight.
function isHotTicket(t: ScoredTicket): boolean {
  return (
    t.stageNorm === "Pending Carrier Action / Update" &&
    (t.priorityBand === "Critical" || t.priorityBand === "High")
  );
}

// Active P1 = priority Critical AND stage Pending Carrier Action / Update.
// Active P2 = priority High AND stage Pending Carrier Action / Update.
// These are the dashboard's headline counts — what the NOC lead glances at
// to know how many high-stakes tickets are actively waiting on carrier action
// across the whole team right now.
function isActiveP1(t: ScoredTicket): boolean {
  return (
    t.stageNorm === "Pending Carrier Action / Update" &&
    t.priorityBand === "Critical"
  );
}
function isActiveP2(t: ScoredTicket): boolean {
  return (
    t.stageNorm === "Pending Carrier Action / Update" &&
    t.priorityBand === "High"
  );
}

// Active P3 = priority Medium AND stage Pending Carrier Action / Update.
// The internal `PriorityBand` collapses Medium and Low into a single
// "Medium/Low" bucket because the weight matrix groups them, so we match
// against the RAW priority string from iPath here to distinguish Medium
// specifically.
function isActiveP3(t: ScoredTicket): boolean {
  if (t.stageNorm !== "Pending Carrier Action / Update") return false;
  const p = (t.priority ?? "").toString().trim().toLowerCase();
  return p === "medium" || p === "med" || p === "p3" || p === "3";
}

// All date formats we'll try when parsing iPath due dates. dayjs strict mode
// requires we list each variant explicitly, but we also try permissive native
// Date() as the last resort. Order matters: longer formats first so dayjs
// picks the most specific match (e.g. "5/8/2025 3:00 PM" before "5/8/2025").
const DUE_DATE_FORMATS = [
  // Slash-separated with time
  "M/D/YYYY h:mm A",
  "M/D/YYYY h:mm:ss A",
  "MM/DD/YYYY h:mm A",
  "MM/DD/YYYY HH:mm",
  "MM/DD/YYYY HH:mm:ss",
  "M/D/YYYY HH:mm",
  // Slash-separated date-only
  "M/D/YYYY",
  "MM/DD/YYYY",
  "M/D/YY",
  "MM/DD/YY",
  // Dash-separated (ISO-ish)
  "YYYY-MM-DD HH:mm:ss",
  "YYYY-MM-DD HH:mm",
  "YYYY-MM-DD",
  "YYYY/MM/DD",
  // Day-Month-Year (Indian / European style — iPath is built in India so
  // exports often default to DD-MM-YYYY)
  "DD-MM-YYYY HH:mm",
  "DD-MM-YYYY HH:mm:ss",
  "DD-MM-YYYY",
  "DD/MM/YYYY HH:mm",
  "DD/MM/YYYY",
  "D/M/YYYY",
  // Day-Mon-Year text (e.g. "08-May-2025", "8-May-25", common in iPath UI)
  "D-MMM-YYYY",
  "DD-MMM-YYYY",
  "D-MMM-YY",
  "DD-MMM-YY",
  "D MMM YYYY",
  "DD MMM YYYY",
  // Month-Day-Year text (e.g. "May 8, 2025")
  "MMM D, YYYY",
  "MMMM D, YYYY",
  "MMM DD YYYY",
];

// Robust due-date parser. iPath exports time in many formats — try every
// plausible one before giving up. Returns a Date with the LOCAL year/month/day
// fields populated (timezone-agnostic — we compare day-of-month, not instant).
function parseTicketDueDate(raw: unknown): Date | null {
  if (raw == null) return null;

  // XLSX with raw:false usually returns formatted strings, but some cells
  // come back as JS Date objects (when the cell type is "d"). Handle both.
  if (raw instanceof Date) {
    if (!isNaN(raw.getTime())) return raw;
    return null;
  }

  // Excel serial-number date (rare with raw:false but possible).
  if (typeof raw === "number" && raw > 1 && raw < 100000) {
    // Excel epoch: Dec 30 1899 (with the 1900 leap-year bug already accounted
    // for above 60). 86400000 ms/day.
    const ms = (raw - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d;
  }

  const s = raw.toString().trim();
  if (!s) return null;

  // Try every dayjs format strictly (returns invalid dayjs if no match,
  // rather than guessing wrong on ambiguous strings like "5/8/2025" vs
  // "8/5/2025"). The first format that matches wins.
  for (const fmt of DUE_DATE_FORMATS) {
    const d = dayjs(s, fmt, true);
    if (d.isValid()) return d.toDate();
  }

  // Fallback: native Date() permissive parser. Catches things like ISO 8601
  // strings with timezones and human-readable text we didn't list above.
  const native = new Date(s);
  if (!isNaN(native.getTime())) return native;

  return null;
}

// Active "due today" = stage Pending Carrier Action / Update AND the
// ticket's due date falls on the same calendar day as the analysis date.
function isActiveDueOnDate(t: ScoredTicket, date: Date): boolean {
  if (t.stageNorm !== "Pending Carrier Action / Update") return false;
  const due = parseTicketDueDate(t.due_date);
  if (!due) return false;
  return (
    due.getFullYear() === date.getFullYear() &&
    due.getMonth() === date.getMonth() &&
    due.getDate() === date.getDate()
  );
}

// "Pending customer" = parked tickets waiting on the customer to respond.
// They still count toward weighted load (per the matrix) but aren't
// actively being worked, so we surface them as a separate signal.
function isPendingCustomer(t: ScoredTicket): boolean {
  return t.stageNorm === "Pending Customer Response";
}

function isPendingRfo(t: ScoredTicket): boolean {
  return t.stageNorm === "Pending RFO";
}

// Ticket age (in days) parsed from iPath's `age` column. Accepts numbers
// and numeric strings; returns NaN when missing/unparseable so callers can
// short-circuit safely.
function ticketAgeDays(t: ScoredTicket): number {
  if (t.age == null || t.age === "") return NaN;
  const n = typeof t.age === "number" ? t.age : parseFloat(String(t.age));
  return Number.isFinite(n) ? n : NaN;
}
function isAgeOver10(t: ScoredTicket): boolean {
  const a = ticketAgeDays(t);
  return Number.isFinite(a) && a > 10;
}
function isAgeOver30(t: ScoredTicket): boolean {
  const a = ticketAgeDays(t);
  return Number.isFinite(a) && a > 30;
}

// Hot-SLA = the only tickets that move during a shift handoff.
function isHotSlaTicket(t: ScoredTicket): boolean {
  return t.sla === "SLA" && isHotTicket(t);
}

export type RebalanceMode = "full" | "shift-handoff";

export interface RebalanceOptions {
  mode: RebalanceMode;
  band: number; // tolerance (default 3.0)
  minMoveWeight: number; // skip ultra-light tickets (default 0.25)
  maxMoveWeight: number; // skip ultra-heavy active tickets (default 3.0)
  maxAgeDays?: number; // skip tickets older than this many days
  enforceTierMatch: boolean; // only move tickets within same tier
  skipStages: string[]; // canonical stage names to never move
  // Used in shift-handoff mode only.
  shiftTransitionId?: string;
}

export const DEFAULT_OPTIONS: RebalanceOptions = {
  mode: "full",
  band: 3.0,
  minMoveWeight: 0.25,
  maxMoveWeight: 3.0,
  maxAgeDays: undefined,
  enforceTierMatch: true,
  skipStages: [],
  shiftTransitionId: "5-to-1",
};

function bandOf(load: number, mean: number, band: number): AgentLoad["band"] {
  if (load > mean + band) return "over";
  if (load < mean - band) return "under";
  return "ok";
}

// Diagnostic: how many active (Pending Carrier Action / Update) tickets had
// a due_date that DID parse, didn't parse, or was empty. Surfaces in the
// result warnings so the user can tell us if "due today" is broken because
// of a date-format issue vs. a column-mapping issue.
function dueDateDiagnostic(
  scored: ScoredTicket[],
  dateContext?: Date,
): string[] {
  const warnings: string[] = [];
  if (!dateContext) return warnings;
  const active = scored.filter(
    (t) => t.stageNorm === "Pending Carrier Action / Update",
  );
  if (active.length === 0) return warnings;

  let withRaw = 0;
  let parsed = 0;
  let unparsed = 0;
  let empty = 0;
  const sampleUnparsed: string[] = [];
  const sampleEmpty: string[] = [];

  for (const t of active) {
    const raw = t.due_date;
    const isEmpty =
      raw == null || (typeof raw === "string" && raw.trim() === "");
    if (isEmpty) {
      empty++;
      if (sampleEmpty.length < 3) sampleEmpty.push(t.ticket);
      continue;
    }
    withRaw++;
    const d = parseTicketDueDate(raw);
    if (d) {
      parsed++;
    } else {
      unparsed++;
      const s = (raw as { toString(): string }).toString();
      if (sampleUnparsed.length < 3) sampleUnparsed.push(`${t.ticket}: "${s}"`);
    }
  }

  if (parsed === 0 && active.length > 0) {
    if (withRaw === 0) {
      warnings.push(
        `Due Today shows 0 because NO active ticket has a due_date value. The parser may be reading the wrong column — check that column F in your export is the due date.`,
      );
      if (sampleEmpty.length > 0) {
        warnings.push(
          `Sample tickets with empty due_date: ${sampleEmpty.join(", ")}`,
        );
      }
    } else {
      warnings.push(
        `Due Today shows 0 because ${unparsed} due_date value(s) couldn't be parsed (no recognized format).`,
      );
      if (sampleUnparsed.length > 0) {
        warnings.push(
          `Sample unparseable due dates: ${sampleUnparsed.join(" · ")} — share these with the dev so we can add the format.`,
        );
      }
    }
  } else if (unparsed > 0) {
    warnings.push(
      `${unparsed} of ${active.length} active ticket(s) had unparseable due dates: ${sampleUnparsed.join(" · ")}`,
    );
  }

  return warnings;
}

export function rebalance(
  scored: ScoredTicket[],
  roster: RosterEntry[],
  date: string,
  options: Partial<RebalanceOptions> = {},
  dateContext?: Date,
): RebalanceResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  // Drop Pending Complete before any load / count math — they are done work.
  const activeScored = scored.filter(isCountedTicket);
  const pendingCompleteCount = scored.length - activeScored.length;
  const warnings: string[] = [...dueDateDiagnostic(activeScored, dateContext)];
  if (pendingCompleteCount > 0) {
    warnings.push(
      `${pendingCompleteCount} ticket(s) in stage "Pending Complete" were excluded from ticket counts and load math.`,
    );
  }

  // Index roster by normalized name.
  const rosterByNorm = new Map<string, RosterEntry>();
  for (const r of roster) rosterByNorm.set(normalizeName(r.name), r);
  seedConfiguredTeamRoster(rosterByNorm);

  // Bucket tickets by owner (Pending Complete already excluded above).
  const ticketsByOwner = new Map<string, ScoredTicket[]>();
  const unassignedOrUnknownOwner: ScoredTicket[] = [];
  for (const t of activeScored) {
    const owner = t.owner;
    if (!owner) {
      unassignedOrUnknownOwner.push(t);
      continue;
    }
    if (isManager(owner)) {
      // Manager-owned tickets are excluded from the load math entirely
      // (managers are never balanced — they typically own escalations).
      unassignedOrUnknownOwner.push(t);
      continue;
    }
    const r = rosterByNorm.get(normalizeName(owner));
    if (!r) {
      // Owner not in roster sheet at all.
      unassignedOrUnknownOwner.push(t);
      continue;
    }
    const key = normalizeName(owner);
    if (!ticketsByOwner.has(key)) ticketsByOwner.set(key, []);
    ticketsByOwner.get(key)!.push(t);
  }

  // Build initial loads — only available agents count toward the mean.
  const loads = new Map<string, AgentLoad>();
  for (const r of roster) {
    if (r.isManager) continue;
    const key = normalizeName(r.name);
    const tix = ticketsByOwner.get(key) ?? [];
    const weight = tix.reduce((sum, t) => sum + t.weight, 0);
    loads.set(key, {
      name: r.name,
      tier: r.tier,
      available: r.available,
      ticketCount: tix.length,
      weight,
      band: "n/a",
      delta: 0,
      hotTickets: tix.filter(isHotTicket).length,
      pendingCustomer: tix.filter(isPendingCustomer).length,
      pendingRfo: tix.filter(isPendingRfo).length,
      p1Count: tix.filter(isActiveP1).length,
      p2Count: tix.filter(isActiveP2).length,
      p3Count: tix.filter(isActiveP3).length,
      dueToday: dateContext ? tix.filter((t) => isActiveDueOnDate(t, dateContext)).length : 0,
      ageOver10: tix.filter(isAgeOver10).length,
      ageOver30: tix.filter(isAgeOver30).length,
    });
  }

  // Mean is computed across AVAILABLE agents only.
  const availableLoads = Array.from(loads.values()).filter((l) => l.available);
  const totalAvailableWeight = availableLoads.reduce((s, l) => s + l.weight, 0);
  const meanLoad = availableLoads.length > 0 ? totalAvailableWeight / availableLoads.length : 0;

  for (const l of loads.values()) {
    if (!l.available) {
      l.band = "n/a";
      l.delta = 0;
    } else {
      l.band = bandOf(l.weight, meanLoad, opts.band);
      l.delta = l.weight - meanLoad;
    }
  }

  // Build a working copy of ticket lists per agent for moves.
  // Only consider tickets owned by AVAILABLE agents — tickets owned by
  // unavailable agents need a separate (manual) coverage decision.
  const workingTickets = new Map<string, ScoredTicket[]>();
  for (const l of availableLoads) {
    workingTickets.set(normalizeName(l.name), [
      ...(ticketsByOwner.get(normalizeName(l.name)) ?? []),
    ]);
  }

  // Tickets owned by unavailable (but rostered) agents — flag them.
  const offShiftAgents: string[] = [];
  for (const r of roster) {
    if (r.isManager || r.available) continue;
    const tix = ticketsByOwner.get(normalizeName(r.name)) ?? [];
    if (tix.length > 0) offShiftAgents.push(r.name);
  }
  if (offShiftAgents.length > 0) {
    warnings.push(
      `Tickets are owned by off-shift agents and were NOT redistributed automatically: ${offShiftAgents.join(", ")}.`,
    );
  }

  // Move generation — iteratively pull tickets from the most overloaded agent
  // and push to the most underloaded agent until both are within band.
  const moves: RebalanceMove[] = [];
  const maxIterations = 200; // safety stop
  let iter = 0;

  while (iter++ < maxIterations) {
    const live = Array.from(loads.values()).filter((l) => l.available);
    const currentMean = live.reduce((s, l) => s + l.weight, 0) / live.length;
    const overs = live
      .filter((l) => l.weight > currentMean + opts.band)
      .sort((a, b) => b.weight - a.weight);
    const unders = live
      .filter((l) => l.weight < currentMean - opts.band)
      .sort((a, b) => a.weight - b.weight);

    if (overs.length === 0 || unders.length === 0) break;

    const from = overs[0];
    let moved = false;

    // Pick best transferable ticket from `from`. Preference order:
    // 1. weight in [minMoveWeight, maxMoveWeight]
    // 2. stage NOT in skipStages
    // 3. age ≤ maxAgeDays (if set)
    // 4. closest to weight=1.0 (true "medium")
    const fromKey = normalizeName(from.name);
    const candidates = (workingTickets.get(fromKey) ?? []).filter((t) => {
      if (t.weight < opts.minMoveWeight) return false;
      if (t.weight > opts.maxMoveWeight) return false;
      if (opts.skipStages.includes(t.stageNorm as string)) return false;
      if (opts.maxAgeDays !== undefined) {
        const age = typeof t.age === "number" ? t.age : parseFloat(t.age ?? "");
        if (!Number.isNaN(age) && age > opts.maxAgeDays) return false;
      }
      return true;
    });

    candidates.sort((a, b) => Math.abs(a.weight - 1.0) - Math.abs(b.weight - 1.0));

    for (const ticket of candidates) {
      // Find a recipient: lowest-loaded under-agent matching tier (if enforced).
      let target = unders.find((u) => {
        if (!opts.enforceTierMatch) return true;
        return u.tier === from.tier;
      });
      if (!target && opts.enforceTierMatch) {
        // Allow cross-tier as fallback only if there are still hard imbalances.
        target = unders[0];
      }
      if (!target) break;

      // Don't make a move that would push the target above the upper band
      // or pull `from` below the lower band.
      const newFromW = from.weight - ticket.weight;
      const newToW = target.weight + ticket.weight;
      // Recompute mean (it doesn't change because total stays the same).
      if (newFromW < currentMean - opts.band) continue;
      if (newToW > currentMean + opts.band) continue;

      // Apply move
      moves.push({
        ticket,
        from: from.name,
        to: target.name,
        reason:
          opts.enforceTierMatch && target.tier === from.tier
            ? `Tier-matched move (${from.tier ?? "no tier"})`
            : "Cross-tier balance move",
      });

      from.weight = newFromW;
      from.ticketCount -= 1;
      target.weight = newToW;
      target.ticketCount += 1;

      const list = workingTickets.get(fromKey)!;
      const idx = list.indexOf(ticket);
      if (idx >= 0) list.splice(idx, 1);
      const targetList = workingTickets.get(normalizeName(target.name)) ?? [];
      targetList.push(ticket);
      workingTickets.set(normalizeName(target.name), targetList);

      moved = true;
      break; // re-evaluate from top
    }

    if (!moved) {
      // Couldn't transfer from this overloaded agent; break to avoid infinite loop.
      // (Could implement queueing here if multiple over-agents exist.)
      // Try the next overloaded agent in subsequent iterations only if a swap helped.
      break;
    }
  }

  if (iter >= maxIterations) {
    warnings.push("Hit max iterations during rebalance — output may be partial.");
  }

  // Final post-rebalance bands
  const agentLoadsAfter: AgentLoad[] = Array.from(loads.values()).map((l) => ({
    ...l,
    band: l.available ? bandOf(l.weight, meanLoad, opts.band) : "n/a",
    delta: l.available ? l.weight - meanLoad : 0,
  }));

  // Initial loads (re-derive from ticketsByOwner, since `loads` is now mutated).
  const agentLoads: AgentLoad[] = roster
    .filter((r) => !r.isManager)
    .map((r) => {
      const key = normalizeName(r.name);
      const tix = ticketsByOwner.get(key) ?? [];
      const weight = tix.reduce((s, t) => s + t.weight, 0);
      return {
        name: r.name,
        tier: r.tier,
        available: r.available,
        ticketCount: tix.length,
        weight,
        band: r.available ? bandOf(weight, meanLoad, opts.band) : "n/a",
        delta: r.available ? weight - meanLoad : 0,
        hotTickets: tix.filter(isHotTicket).length,
        pendingCustomer: tix.filter(isPendingCustomer).length,
      pendingRfo: tix.filter(isPendingRfo).length,
      p1Count: tix.filter(isActiveP1).length,
      p2Count: tix.filter(isActiveP2).length,
      p3Count: tix.filter(isActiveP3).length,
      dueToday: dateContext ? tix.filter((t) => isActiveDueOnDate(t, dateContext)).length : 0,
      ageOver10: tix.filter(isAgeOver10).length,
      ageOver30: tix.filter(isAgeOver30).length,
      };
    });

  return {
    date,
    totalTickets: activeScored.length,
    totalWeight: activeScored.reduce((s, t) => s + t.weight, 0),
    availableAgents: availableLoads.length,
    meanLoad,
    band: opts.band,
    agentLoads,
    unassignedOrUnknownOwner,
    movesSuggested: moves,
    agentLoadsAfter,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Shift-handoff mode
// ---------------------------------------------------------------------------
// Only hot SLA tickets are eligible to move.
// Here, "hot" means carrier-action/update stage plus Critical/High priority,
// and the service must be on the SLA list.
// Other tickets stay where they are.
//
// Eligible agent pool depends on the transition:
//   - sourceGoingOff = true  → tickets must move OFF the source pool (Shift 5
//                              going home). Mean is computed over target only.
//   - sourceGoingOff = false → source AND target shifts share load. Mean is
//                              over source ∪ target. Source agents keep some
//                              tickets, target picks up the slack.
export function rebalanceShiftHandoff(
  scored: ScoredTicket[],
  roster: RosterEntry[],
  date: string,
  transitionId: string,
  options: Partial<RebalanceOptions> = {},
  // Optional previous-day roster — used for transitions whose source agents
  // clocked in the previous calendar day (e.g. Shift 5 overnight, which
  // starts at 7 PM the day before).
  rosterPrev?: RosterEntry[],
  dateContext?: Date,
): RebalanceResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const transition: ShiftTransition | undefined = SHIFT_TRANSITIONS.find(
    (t) => t.id === transitionId,
  );
  if (!transition) {
    throw new Error(`Unknown shift transition: ${transitionId}`);
  }
  // Drop Pending Complete before any load / count math — they are done work.
  const activeScored = scored.filter(isCountedTicket);
  const pendingCompleteCount = scored.length - activeScored.length;
  const warnings: string[] = [...dueDateDiagnostic(activeScored, dateContext)];
  if (pendingCompleteCount > 0) {
    warnings.push(
      `${pendingCompleteCount} ticket(s) in stage "Pending Complete" were excluded from ticket counts and load math.`,
    );
  }

  // Eligible tickets: hot SLA only.
  const eligible = activeScored.filter(isHotSlaTicket);

  // Diagnostic: count of scored tickets that DIDN'T qualify as hot SLA, so
  // the user sees why nothing is moving when their export looks "active".
  const hotButNotSla = activeScored.filter(
    (t) => isHotTicket(t) && t.sla !== "SLA",
  ).length;
  const slaButNotHot = activeScored.filter(
    (t) => t.sla === "SLA" && !isHotTicket(t),
  ).length;

  // Pick the roster used for SOURCE-agent identification. For overnight
  // transitions (sourceDateOffset === -1), source agents are listed in
  // yesterday's column — their "today" cell is typically blank/WO/another
  // shift after they finish at 4 AM.
  const usePrev = transition.sourceDateOffset === -1;
  const sourceRoster = usePrev && rosterPrev ? rosterPrev : roster;
  if (usePrev && !rosterPrev) {
    warnings.push(
      "Previous-day roster was not loaded — Shift 5 agents may be missed. Re-load the roster to pull both days.",
    );
  } else if (usePrev && rosterPrev) {
    warnings.push(
      "Source shift (Overnight) agents pulled from the PREVIOUS day's roster column, since they clocked in at 7 PM yesterday.",
    );
  }

  // Determine pool agents (available + in source/target shifts).
  const sourceAgents = sourceRoster.filter(
    (r) =>
      !r.isManager &&
      r.available &&
      r.shiftId !== undefined &&
      transition.sourceShifts.includes(r.shiftId),
  );
  const targetAgents = roster.filter(
    (r) =>
      !r.isManager &&
      r.available &&
      r.shiftId === transition.targetShift,
  );

  // Index roster for ticket-owner lookups. Source agents come from
  // sourceRoster (possibly previous day); target + everyone else from today.
  // Source entries take precedence so we get the right shiftId/availability
  // for the agent we care about in this handoff.
  const rosterByNorm = new Map<string, RosterEntry>();
  for (const r of roster) rosterByNorm.set(normalizeName(r.name), r);
  for (const r of sourceAgents) rosterByNorm.set(normalizeName(r.name), r);
  seedConfiguredTeamRoster(rosterByNorm);

  // Bucket ALL active tickets by owner (not just eligible). The per-agent
  // table displays full workload context — total tickets + total weight +
  // hot count — so a NOC lead can see who's actually busy, not just who's
  // sitting on hot-SLA tickets. Pending Complete is already excluded above.
  // The movable pool is filtered to eligible tickets separately below.
  const ticketsByOwner = new Map<string, ScoredTicket[]>();
  const unassignedOrUnknownOwner: ScoredTicket[] = [];
  for (const t of activeScored) {
    if (!t.owner || isManager(t.owner)) {
      unassignedOrUnknownOwner.push(t);
      continue;
    }
    const r = rosterByNorm.get(normalizeName(t.owner));
    if (!r) {
      unassignedOrUnknownOwner.push(t);
      continue;
    }
    const key = normalizeName(t.owner);
    if (!ticketsByOwner.has(key)) ticketsByOwner.set(key, []);
    ticketsByOwner.get(key)!.push(t);
  }

  // Separate map for movable (eligible) tickets only — used to build moves.
  const eligibleByOwner = new Map<string, ScoredTicket[]>();
  for (const t of eligible) {
    if (!t.owner || isManager(t.owner)) continue;
    if (!rosterByNorm.has(normalizeName(t.owner))) continue;
    const key = normalizeName(t.owner);
    if (!eligibleByOwner.has(key)) eligibleByOwner.set(key, []);
    eligibleByOwner.get(key)!.push(t);
  }

  if (targetAgents.length === 0) {
    warnings.push(
      `No available agents detected on Shift ${transition.targetShift} (${shiftById(transition.targetShift).name}). Hot SLA tickets cannot be redistributed.`,
    );
  }
  if (sourceAgents.length === 0) {
    warnings.push(
      `No available agents detected on the source shift(s) (${transition.sourceShifts.join(", ")}). Nothing to hand off.`,
    );
  }
  if (eligible.length === 0) {
    const hint =
      hotButNotSla > 0
        ? ` (${hotButNotSla} hot ticket(s) were found but on Non-SLA services — check service classification)`
        : slaButNotHot > 0
          ? ` (${slaButNotHot} SLA ticket(s) were found but none are in stage Pending Carrier Action / Update with Critical/High priority)`
          : "";
    warnings.push(
      `No hot SLA tickets eligible for handoff${hint}. Verify the ticket export contains SLA services + stage "Pending Carrier Action / Update" + Critical/High priority.`,
    );
  } else {
    // Surface how many eligible tickets were found and how many are owned
    // by source-shift agents (vs. owned by people outside the handoff scope).
    const eligibleOwnedBySource = sourceAgents.reduce(
      (s, r) =>
        s + (eligible.filter((t) => normalizeName(t.owner) === normalizeName(r.name)).length),
      0,
    );
    if (eligibleOwnedBySource === 0 && transition.sourceGoingOff) {
      warnings.push(
        `Found ${eligible.length} hot SLA ticket(s), but NONE are owned by detected Shift ${transition.sourceShifts.join("/")} agents. Check that overnight agents' names in the ticket export match the roster (and that the previous-day roster column has time ranges for them).`,
      );
    }
  }

  // Pool-for-mean: depends on whether source is going off shift.
  const poolAgents = transition.sourceGoingOff
    ? targetAgents
    : [...sourceAgents, ...targetAgents];

  // Build per-agent load record for everyone in the pool.
  // We also include source agents in the OUTPUT even if going off, so the user
  // sees who is handing off what.
  const allDisplayAgents = transition.sourceGoingOff
    ? [...sourceAgents, ...targetAgents]
    : poolAgents;

  const loads = new Map<string, AgentLoad>();
  for (const r of allDisplayAgents) {
    const key = normalizeName(r.name);
    const tix = ticketsByOwner.get(key) ?? [];
    const weight = tix.reduce((s, t) => s + t.weight, 0);
    loads.set(key, {
      name: r.name,
      tier: r.tier,
      available: r.available,
      shiftId: r.shiftId,
      ticketCount: tix.length,
      weight,
      band: "n/a",
      delta: 0,
      hotTickets: tix.filter(isHotTicket).length,
      pendingCustomer: tix.filter(isPendingCustomer).length,
      pendingRfo: tix.filter(isPendingRfo).length,
      p1Count: tix.filter(isActiveP1).length,
      p2Count: tix.filter(isActiveP2).length,
      p3Count: tix.filter(isActiveP3).length,
      dueToday: dateContext ? tix.filter((t) => isActiveDueOnDate(t, dateContext)).length : 0,
      ageOver10: tix.filter(isAgeOver10).length,
      ageOver30: tix.filter(isAgeOver30).length,
    });
  }

  // The redistribution algorithm operates on ELIGIBLE-ticket weight only
  // (the only tickets we're allowed to move in handoff mode). The display
  // (loads[].weight) shows TOTAL workload for context.
  const eligibleWeightByKey = new Map<string, number>();
  for (const r of [...sourceAgents, ...targetAgents]) {
    const key = normalizeName(r.name);
    const w = (eligibleByOwner.get(key) ?? []).reduce((s, t) => s + t.weight, 0);
    eligibleWeightByKey.set(key, w);
  }

  // Total eligible weight across the whole handoff scope (source + target):
  // this is the load that needs to be balanced.
  const poolKeys = new Set(poolAgents.map((r) => normalizeName(r.name)));
  const totalEligibleScope = [...sourceAgents, ...targetAgents].reduce(
    (s, r) => s + (eligibleWeightByKey.get(normalizeName(r.name)) ?? 0),
    0,
  );
  const totalWeight = totalEligibleScope; // surfaced as "Total Weight" stat

  const meanLoad = poolAgents.length > 0 ? totalEligibleScope / poolAgents.length : 0;

  for (const l of loads.values()) {
    const key = normalizeName(l.name);
    const inPool = poolKeys.has(key);
    const eligibleW = eligibleWeightByKey.get(key) ?? 0;
    if (inPool) {
      l.band =
        eligibleW > meanLoad + opts.band
          ? "over"
          : eligibleW < meanLoad - opts.band
            ? "under"
            : "ok";
      l.delta = eligibleW - meanLoad;
    } else {
      // Source agent going off — flag as over (their tickets must all leave).
      l.band = eligibleW > 0 ? "over" : "n/a";
      l.delta = eligibleW;
    }
  }

  // Build movable tickets: every hot-SLA ticket (eligible only) owned by a
  // source agent.
  const movablePool: { ticket: ScoredTicket; from: string }[] = [];
  for (const r of sourceAgents) {
    const key = normalizeName(r.name);
    const tix = eligibleByOwner.get(key) ?? [];
    for (const t of tix) movablePool.push({ ticket: t, from: r.name });
  }

  // Sort movables by weight desc — we redistribute the heaviest first
  // so they land on whoever is currently lightest.
  movablePool.sort((a, b) => b.ticket.weight - a.ticket.weight);

  const moves: RebalanceMove[] = [];

  // Working state for greedy assignment — tracks ELIGIBLE-ticket weight
  // (since hot SLA tickets are the only ones being moved). Display weights
  // (total) live separately on `loads[].weight`.
  const workingWeight = new Map<string, number>();
  for (const r of poolAgents) {
    const k = normalizeName(r.name);
    workingWeight.set(k, eligibleWeightByKey.get(k) ?? 0);
  }
  // In going-off mode, source agents are NOT in the pool so their eligible
  // weight is not tracked here — all their eligible tickets are surplus and
  // must move to the target pool.

  for (const { ticket, from } of movablePool) {
    const fromKey = normalizeName(from);

    // In pooled mode, decide whether to keep ticket with current owner if
    // they're already below mean (no point moving it).
    if (!transition.sourceGoingOff && poolKeys.has(fromKey)) {
      const fromW = workingWeight.get(fromKey) ?? 0;
      if (fromW <= meanLoad + opts.band) {
        // Source agent is already at-or-under threshold → leave ticket put.
        continue;
      }
    }

    // Find lightest target in the pool (excluding source agents in going-off
    // mode; in pooled mode any pool member is eligible).
    const candidates = poolAgents
      .filter((r) =>
        transition.sourceGoingOff
          ? r.shiftId === transition.targetShift
          : true,
      )
      .map((r) => {
        const k = normalizeName(r.name);
        return { agent: r, weight: workingWeight.get(k) ?? 0 };
      })
      .sort((a, b) => a.weight - b.weight);

    if (candidates.length === 0) break;

    const target = candidates[0].agent;
    const targetKey = normalizeName(target.name);

    // Don't move to self.
    if (targetKey === fromKey) continue;

    // In pooled mode, only move if target is meaningfully lighter than source.
    if (!transition.sourceGoingOff && poolKeys.has(fromKey)) {
      const fromW = workingWeight.get(fromKey) ?? 0;
      const targetW = workingWeight.get(targetKey) ?? 0;
      if (targetW + ticket.weight >= fromW) {
        // Move would just flip the imbalance → skip.
        continue;
      }
    }

    moves.push({
      ticket,
      from,
      to: target.name,
      reason: transition.sourceGoingOff
        ? `Shift ${transition.sourceShifts.join("+")} → Shift ${transition.targetShift} handoff`
        : `Pool rebalance across Shifts ${transition.sourceShifts.join("+")} & ${transition.targetShift}`,
    });

    // Update working weights.
    if (poolKeys.has(fromKey)) {
      workingWeight.set(fromKey, (workingWeight.get(fromKey) ?? 0) - ticket.weight);
    }
    workingWeight.set(targetKey, (workingWeight.get(targetKey) ?? 0) + ticket.weight);
  }

  // Final after-loads: project the moves back onto the TOTAL workload
  // (display weight), not just eligible weight, so the user sees the
  // complete post-handoff picture.
  const agentLoadsAfter: AgentLoad[] = Array.from(loads.values()).map((l) => {
    const key = normalizeName(l.name);
    // Sum the weight of tickets removed and added based on the moves list.
    const myMovesOut = moves.filter((m) => normalizeName(m.from) === key);
    const myMovesIn = moves.filter((m) => normalizeName(m.to) === key);
    const weightRemoved = myMovesOut.reduce((s, m) => s + m.ticket.weight, 0);
    const weightAdded = myMovesIn.reduce((s, m) => s + m.ticket.weight, 0);
    const newDisplayWeight = l.weight - weightRemoved + weightAdded;
    // Eligible-weight-after, used for band computation (matches the same
    // metric we used for the BEFORE band).
    const newEligibleWeight =
      (eligibleWeightByKey.get(key) ?? 0) - weightRemoved + weightAdded;
    const inPool = poolKeys.has(key);
    const newBand: AgentLoad["band"] = inPool
      ? newEligibleWeight > meanLoad + opts.band
        ? "over"
        : newEligibleWeight < meanLoad - opts.band
          ? "under"
          : "ok"
      : newEligibleWeight > 0
        ? "over"
        : "n/a";
    return {
      ...l,
      weight: newDisplayWeight,
      ticketCount: l.ticketCount - myMovesOut.length + myMovesIn.length,
      hotTickets: l.hotTickets - myMovesOut.length + myMovesIn.length,
      // Hot-SLA moves are by definition active P1 (Critical) or active P2
      // (High) — split the count adjustments by priority.
      p1Count:
        l.p1Count -
        myMovesOut.filter((m) => m.ticket.priorityBand === "Critical").length +
        myMovesIn.filter((m) => m.ticket.priorityBand === "Critical").length,
      p2Count:
        l.p2Count -
        myMovesOut.filter((m) => m.ticket.priorityBand === "High").length +
        myMovesIn.filter((m) => m.ticket.priorityBand === "High").length,
      // P3 = Medium + Pending Carrier — never moved in shift handoff (only
      // hot SLA P1/P2 move), so unchanged.
      p3Count: l.p3Count,
      // Due today — adjust if any moved tickets happened to be due today.
      dueToday: dateContext
        ? l.dueToday -
          myMovesOut.filter((m) => isActiveDueOnDate(m.ticket, dateContext))
            .length +
          myMovesIn.filter((m) => isActiveDueOnDate(m.ticket, dateContext))
            .length
        : l.dueToday,
      // Age buckets follow the ticket — re-attribute on each move.
      ageOver10:
        l.ageOver10 -
        myMovesOut.filter((m) => isAgeOver10(m.ticket)).length +
        myMovesIn.filter((m) => isAgeOver10(m.ticket)).length,
      ageOver30:
        l.ageOver30 -
        myMovesOut.filter((m) => isAgeOver30(m.ticket)).length +
        myMovesIn.filter((m) => isAgeOver30(m.ticket)).length,
      band: newBand,
      delta: inPool ? newEligibleWeight - meanLoad : newEligibleWeight,
    };
  });

  return {
    date,
    totalTickets: eligible.length,
    totalWeight,
    availableAgents: poolAgents.length,
    meanLoad,
    band: opts.band,
    agentLoads: Array.from(loads.values()),
    unassignedOrUnknownOwner,
    movesSuggested: moves,
    agentLoadsAfter,
    warnings,
    shiftTransition: {
      id: transition.id,
      label: transition.label,
      context: transition.context,
      sourceShifts: transition.sourceShifts,
      targetShift: transition.targetShift,
      sourceGoingOff: transition.sourceGoingOff,
    },
  };
}
