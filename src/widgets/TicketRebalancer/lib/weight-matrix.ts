// Service classification + weight matrix from the spec.
// Stored as plain data so it can be edited live in the UI (Settings tab) or
// swapped out for a YAML import later without touching the algorithm.

export type SlaType = "SLA" | "Non-SLA";
export type PriorityBand = "Critical" | "High" | "Medium/Low";

// Canonical stage names — match exactly against iPath `stage` (case-insensitive).
export const STAGES = [
  "Pending Carrier Action / Update",
  "Pending Access / Test Results",
  "Pending Carrier Information",
  "Pending Customer Response",
  "Customer Confirming Resolution",
  "Pending RFO",
  "On hold",
  "Pending Complete",
] as const;
export type Stage = (typeof STAGES)[number];

// SLA service catalog (case-insensitive contains-match against iPath `service`).
export const SLA_SERVICES = [
  // Data
  "DIA",
  "MPLS",
  "VPLS",
  "Point to Point",
  "MPLS VPN",
  "Dark Fiber",
  // Voice
  "Local DS1 Circuit",
  "DS3",
  "LD DS1 Circuit",
  "LD Switched",
  "ISDN-PRI",
  "ISDN-BRI",
  "SIP Call Path",
];

export const NON_SLA_SERVICES = [
  // Data
  "DSL",
  "Cable",
  "Fiber Broadband",
  "Fixed Wireless Internet",
  // Voice
  "Local Line",
  "Centrex Lines",
  "Conferencing Rated",
  "eFax",
  "Remote Call Forwarding",
  "Toll Free Switched",
  "Toll Free Ded",
];

// Service classifier. iPath service strings often have suffixes/prefixes,
// so we use case-insensitive substring matching.
export function classifyService(serviceRaw: string): SlaType | "Unknown" {
  const s = (serviceRaw ?? "").toString().trim().toLowerCase();
  if (!s) return "Unknown";
  for (const sla of SLA_SERVICES) {
    if (s.includes(sla.toLowerCase())) return "SLA";
  }
  for (const non of NON_SLA_SERVICES) {
    if (s.includes(non.toLowerCase())) return "Non-SLA";
  }
  return "Unknown";
}

// Priority band: Critical and High are top two; everything else collapses to
// Medium/Low (the matrix groups them).
export function classifyPriority(priorityRaw: string): PriorityBand {
  const p = (priorityRaw ?? "").toString().trim().toLowerCase();
  if (p === "critical" || p === "p1" || p === "1") return "Critical";
  if (p === "high" || p === "p2" || p === "2") return "High";
  return "Medium/Low";
}

// Stage normalizer — case-insensitive, fuzzy on spaces and slashes.
export function classifyStage(stageRaw: string): Stage | "Unknown" {
  const norm = (stageRaw ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  for (const s of STAGES) {
    if (s.toLowerCase() === norm) return s;
  }
  // Common variant: "On Hold" vs "On hold"
  for (const s of STAGES) {
    if (s.toLowerCase().replace(/\s+/g, "") === norm.replace(/\s+/g, ""))
      return s;
  }
  return "Unknown";
}

// The full weight matrix, keyed by `${sla}|${priority}|${stage}`.
// Unknown combinations fall back to UNKNOWN_WEIGHT (0.25) so unclassifiable
// tickets still contribute a small load instead of being silently dropped.
export const UNKNOWN_WEIGHT = 0.25;

export const WEIGHT_MATRIX: Record<string, number> = {
  // SLA · Critical
  "SLA|Critical|Pending Carrier Action / Update": 5.0,
  "SLA|Critical|Pending Access / Test Results": 2.0,
  "SLA|Critical|Pending Carrier Information": 1.0,
  "SLA|Critical|Pending Customer Response": 0.5,
  "SLA|Critical|Customer Confirming Resolution": 0.25,
  "SLA|Critical|Pending RFO": 0.25,
  "SLA|Critical|On hold": 0.25,
  "SLA|Critical|Pending Complete": 0.1,
  // SLA · High
  "SLA|High|Pending Carrier Action / Update": 3.0,
  "SLA|High|Pending Access / Test Results": 2.0,
  "SLA|High|Pending Carrier Information": 1.0,
  "SLA|High|Pending Customer Response": 0.5,
  "SLA|High|Customer Confirming Resolution": 0.25,
  "SLA|High|Pending RFO": 0.25,
  "SLA|High|On hold": 0.25,
  "SLA|High|Pending Complete": 0.1,
  // SLA · Medium/Low
  "SLA|Medium/Low|Pending Carrier Action / Update": 1.0,
  "SLA|Medium/Low|Pending Access / Test Results": 0.5,
  "SLA|Medium/Low|Pending Carrier Information": 0.25,
  "SLA|Medium/Low|Pending Customer Response": 0.25,
  "SLA|Medium/Low|Customer Confirming Resolution": 0.1,
  "SLA|Medium/Low|Pending RFO": 0.1,
  "SLA|Medium/Low|On hold": 0.1,
  "SLA|Medium/Low|Pending Complete": 0.1,
  // Non-SLA · Medium/Low (same as SLA Medium/Low per spec)
  "Non-SLA|Medium/Low|Pending Carrier Action / Update": 1.0,
  "Non-SLA|Medium/Low|Pending Access / Test Results": 0.5,
  "Non-SLA|Medium/Low|Pending Carrier Information": 0.25,
  "Non-SLA|Medium/Low|Pending Customer Response": 0.25,
  "Non-SLA|Medium/Low|Customer Confirming Resolution": 0.1,
  "Non-SLA|Medium/Low|Pending RFO": 0.1,
  "Non-SLA|Medium/Low|On hold": 0.1,
  "Non-SLA|Medium/Low|Pending Complete": 0.1,
};

// Spec only defines Non-SLA for Medium/Low. Critical/High Non-SLA tickets
// are unusual (Non-SLA implies best-effort) — fall back to SLA Medium/Low
// weights so they still register a load.
export function lookupWeight(
  sla: SlaType | "Unknown",
  priority: PriorityBand,
  stage: Stage | "Unknown",
): number {
  if (sla === "Unknown" || stage === "Unknown") return UNKNOWN_WEIGHT;
  const direct = WEIGHT_MATRIX[`${sla}|${priority}|${stage}`];
  if (direct !== undefined) return direct;
  if (sla === "Non-SLA") {
    const fallback = WEIGHT_MATRIX[`Non-SLA|Medium/Low|${stage}`];
    if (fallback !== undefined) return fallback;
  }
  return UNKNOWN_WEIGHT;
}
