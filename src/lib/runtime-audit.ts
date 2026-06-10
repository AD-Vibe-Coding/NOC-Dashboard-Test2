export type RuntimeAuditLevel = "error" | "warning" | "info";

export type RuntimeAuditEvent = {
  id: string;
  timestamp: string;
  level: RuntimeAuditLevel;
  source: string;
  label: string;
  message: string;
  stack?: string;
  details?: string;
  url?: string;
};

const STORAGE_KEY = "runtime-audit-events-v1";
const MAX_EVENTS = 75;

function safeParse(raw: string | null): RuntimeAuditEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as RuntimeAuditEvent[] : [];
  } catch {
    return [];
  }
}

export function readRuntimeAuditEvents(): RuntimeAuditEvent[] {
  if (typeof window === "undefined") return [];
  return safeParse(window.sessionStorage.getItem(STORAGE_KEY));
}

export function writeRuntimeAuditEvents(events: RuntimeAuditEvent[]) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(0, MAX_EVENTS)));
}

export function recordRuntimeAuditEvent(input: Omit<RuntimeAuditEvent, "id" | "timestamp">) {
  if (typeof window === "undefined") return;
  const next: RuntimeAuditEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...input,
  };
  const events = [next, ...readRuntimeAuditEvents()].slice(0, MAX_EVENTS);
  writeRuntimeAuditEvents(events);
  window.dispatchEvent(new CustomEvent("runtime-audit:updated", { detail: next }));
}

export function clearRuntimeAuditEvents() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent("runtime-audit:cleared"));
}

export function formatRuntimeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}
