export type ConfidenceLevel = "found" | "guessed" | "not_found";

export interface ParsedField<T = string> {
  value: T;
  confidence: ConfidenceLevel;
}

export interface MaintenanceData {
  carrier: ParsedField;
  address: ParsedField;
  circuitId: ParsedField;
  startTime: ParsedField;
  endTime: ParsedField;
  duration: ParsedField;
  reason: ParsedField;
  timezone: ParsedField;
}

export type MaintenanceType = "scheduled" | "emergency";
