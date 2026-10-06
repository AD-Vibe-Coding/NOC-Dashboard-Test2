import dayjs from "dayjs";
import { scoreTickets } from "./parse-tickets";
import type { RawTicket, ScoredTicket } from "./types";

export type LiveTicketValidationIssue = {
  ticket: string;
  issue: string;
};

export type LiveTicketsResponse = {
  source?: string;
  fetchedAt?: string;
  targetDate?: string;
  totalReceived?: number;
  validTickets?: number;
  invalidTickets?: number;
  validationIssues?: LiveTicketValidationIssue[];
  tickets?: RawTicket[];
  error?: string;
};

export type LoadedLiveTickets = {
  tickets: ScoredTicket[];
  source: string;
  fetchedAt: string;
  targetDate: string;
  totalReceived: number;
  validTickets: number;
  invalidTickets: number;
  validationIssues: LiveTicketValidationIssue[];
};

export async function fetchLiveTicketsForDate(date: Date): Promise<LoadedLiveTickets> {
  const targetDate = dayjs(date).format("YYYY-MM-DD");
  const response = await fetch(`/api/ticket-rebalancer/live?date=${encodeURIComponent(targetDate)}`);

  const payload = (await response.json().catch(() => ({}))) as LiveTicketsResponse;

  if (!response.ok) {
    throw new Error(payload.error || `Live ticket API request failed with status ${response.status}.`);
  }

  if (payload.error) {
    throw new Error(payload.error);
  }

  const rawTickets = Array.isArray(payload.tickets) ? payload.tickets : [];

  return {
    tickets: scoreTickets(rawTickets),
    source: payload.source || "Live iPath API",
    fetchedAt: payload.fetchedAt || new Date().toISOString(),
    targetDate: payload.targetDate || targetDate,
    totalReceived: Number(payload.totalReceived ?? rawTickets.length),
    validTickets: Number(payload.validTickets ?? rawTickets.length),
    invalidTickets: Number(payload.invalidTickets ?? 0),
    validationIssues: Array.isArray(payload.validationIssues) ? payload.validationIssues : [],
  };
}
