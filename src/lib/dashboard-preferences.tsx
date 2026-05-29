import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useIdentity } from "./identity";

export type DashboardTemplate =
  | "classic"
  | "focus"
  | "operations"
  | "learning"
  | "command-center"
  | "velocity"
  | "night-shift"
  | "minimalist"
  | "trainer"
  | "escalation-desk";
export type DashboardSectionKey = "my-work" | "queue-monitoring" | "ai-tools" | "communication" | "requests";

export interface DashboardLayoutSectionState {
  key: DashboardSectionKey;
  hidden: boolean;
  itemIds: string[];
}

export interface DashboardLayoutState {
  sections: DashboardLayoutSectionState[];
}

export const DASHBOARD_TEMPLATES: Array<{
  value: DashboardTemplate;
  label: string;
  description: string;
}> = [
  { value: "classic", label: "Classic", description: "Balanced all-rounder with a polished, familiar flow." },
  { value: "focus", label: "Focus", description: "Quiet, high-priority layout that keeps execution tools first." },
  { value: "operations", label: "Operations", description: "Queue, monitoring, and response workflow pushed to the front." },
  { value: "learning", label: "Learning", description: "Training, AI, and communication surfaces prioritized for growth." },
  { value: "command-center", label: "Command Center", description: "Best for power users who want live ops and oversight at the top." },
  { value: "velocity", label: "Velocity", description: "Built for fast movement through tickets, queue, and escalation actions." },
  { value: "night-shift", label: "Night Shift", description: "Calm but high-signal layout optimized for low-noise operations." },
  { value: "minimalist", label: "Minimalist", description: "Cleaner, more spacious view with only the most useful sections visible." },
  { value: "trainer", label: "Trainer", description: "Coaching-forward layout that keeps metrics, learning, and communication close." },
  { value: "escalation-desk", label: "Escalation Desk", description: "Front-loads handover, escalations, and queue pressure tools." },
];

const DEFAULT_LAYOUTS: Record<DashboardTemplate, DashboardLayoutState> = {
  classic: {
    sections: [
      { key: "my-work", hidden: false, itemIds: ["my-day", "performance-tracker", "break-tracker"] },
      { key: "queue-monitoring", hidden: false, itemIds: ["zoom-queue", "logic-monitor"] },
      { key: "ai-tools", hidden: false, itemIds: ["smart-search", "ticket-summary", "noc-troubleshooter", "mobility-troubleshooter"] },
      { key: "communication", hidden: false, itemIds: ["escalation-email", "email-polisher", "shift-handover", "qs-escalations"] },
      { key: "requests", hidden: false, itemIds: ["wfh", "training-updates"] },
    ],
  },
  focus: {
    sections: [
      { key: "my-work", hidden: false, itemIds: ["my-day", "break-tracker", "performance-tracker"] },
      { key: "requests", hidden: false, itemIds: ["wfh", "training-updates"] },
      { key: "queue-monitoring", hidden: false, itemIds: ["zoom-queue", "logic-monitor"] },
      { key: "communication", hidden: true, itemIds: ["shift-handover", "escalation-email", "email-polisher", "qs-escalations"] },
      { key: "ai-tools", hidden: false, itemIds: ["smart-search", "ticket-summary", "noc-troubleshooter", "mobility-troubleshooter"] },
    ],
  },
  operations: {
    sections: [
      { key: "queue-monitoring", hidden: false, itemIds: ["zoom-queue", "logic-monitor"] },
      { key: "communication", hidden: false, itemIds: ["escalation-email", "shift-handover", "qs-escalations", "email-polisher"] },
      { key: "my-work", hidden: false, itemIds: ["my-day", "break-tracker", "performance-tracker"] },
      { key: "ai-tools", hidden: false, itemIds: ["noc-troubleshooter", "mobility-troubleshooter", "smart-search", "ticket-summary"] },
      { key: "requests", hidden: true, itemIds: ["wfh", "training-updates"] },
    ],
  },
  learning: {
    sections: [
      { key: "ai-tools", hidden: false, itemIds: ["smart-search", "ticket-summary", "noc-troubleshooter", "mobility-troubleshooter"] },
      { key: "requests", hidden: false, itemIds: ["training-updates", "wfh"] },
      { key: "communication", hidden: false, itemIds: ["email-polisher", "shift-handover", "escalation-email", "qs-escalations"] },
      { key: "my-work", hidden: false, itemIds: ["performance-tracker", "my-day", "break-tracker"] },
      { key: "queue-monitoring", hidden: true, itemIds: ["zoom-queue", "logic-monitor"] },
    ],
  },
  "command-center": {
    sections: [
      { key: "queue-monitoring", hidden: false, itemIds: ["zoom-queue", "logic-monitor"] },
      { key: "my-work", hidden: false, itemIds: ["my-day", "performance-tracker", "break-tracker"] },
      { key: "communication", hidden: false, itemIds: ["shift-handover", "escalation-email", "qs-escalations", "email-polisher"] },
      { key: "ai-tools", hidden: false, itemIds: ["smart-search", "noc-troubleshooter", "mobility-troubleshooter", "ticket-summary"] },
      { key: "requests", hidden: false, itemIds: ["training-updates", "wfh"] },
    ],
  },
  velocity: {
    sections: [
      { key: "my-work", hidden: false, itemIds: ["my-day", "zoom-queue", "break-tracker", "performance-tracker"] },
      { key: "communication", hidden: false, itemIds: ["shift-handover", "email-polisher", "escalation-email", "qs-escalations"] },
      { key: "queue-monitoring", hidden: false, itemIds: ["logic-monitor"] },
      { key: "ai-tools", hidden: false, itemIds: ["smart-search", "ticket-summary", "noc-troubleshooter", "mobility-troubleshooter"] },
      { key: "requests", hidden: true, itemIds: ["wfh", "training-updates"] },
    ],
  },
  "night-shift": {
    sections: [
      { key: "queue-monitoring", hidden: false, itemIds: ["logic-monitor", "zoom-queue"] },
      { key: "my-work", hidden: false, itemIds: ["my-day", "break-tracker", "performance-tracker"] },
      { key: "ai-tools", hidden: false, itemIds: ["noc-troubleshooter", "smart-search", "ticket-summary", "mobility-troubleshooter"] },
      { key: "communication", hidden: true, itemIds: ["shift-handover", "qs-escalations", "escalation-email", "email-polisher"] },
      { key: "requests", hidden: true, itemIds: ["training-updates", "wfh"] },
    ],
  },
  minimalist: {
    sections: [
      { key: "my-work", hidden: false, itemIds: ["my-day", "zoom-queue", "break-tracker"] },
      { key: "ai-tools", hidden: false, itemIds: ["smart-search", "ticket-summary"] },
      { key: "communication", hidden: true, itemIds: ["email-polisher", "shift-handover", "escalation-email", "qs-escalations"] },
      { key: "queue-monitoring", hidden: true, itemIds: ["logic-monitor"] },
      { key: "requests", hidden: true, itemIds: ["wfh", "training-updates"] },
    ],
  },
  trainer: {
    sections: [
      { key: "my-work", hidden: false, itemIds: ["performance-tracker", "my-day", "break-tracker"] },
      { key: "requests", hidden: false, itemIds: ["training-updates", "wfh"] },
      { key: "communication", hidden: false, itemIds: ["email-polisher", "shift-handover", "escalation-email", "qs-escalations"] },
      { key: "ai-tools", hidden: false, itemIds: ["smart-search", "ticket-summary", "mobility-troubleshooter", "noc-troubleshooter"] },
      { key: "queue-monitoring", hidden: true, itemIds: ["zoom-queue", "logic-monitor"] },
    ],
  },
  "escalation-desk": {
    sections: [
      { key: "communication", hidden: false, itemIds: ["escalation-email", "shift-handover", "qs-escalations", "email-polisher"] },
      { key: "queue-monitoring", hidden: false, itemIds: ["zoom-queue", "logic-monitor"] },
      { key: "my-work", hidden: false, itemIds: ["my-day", "performance-tracker", "break-tracker"] },
      { key: "ai-tools", hidden: false, itemIds: ["noc-troubleshooter", "smart-search", "ticket-summary", "mobility-troubleshooter"] },
      { key: "requests", hidden: false, itemIds: ["wfh", "training-updates"] },
    ],
  },
};

type StoredPreferences = {
  template: DashboardTemplate;
  layouts: Record<DashboardTemplate, DashboardLayoutState>;
};

type DashboardPreferencesContextValue = {
  template: DashboardTemplate;
  setTemplate: (template: DashboardTemplate) => void;
  currentLayout: DashboardLayoutState;
  moveSection: (fromKey: DashboardSectionKey, toKey: DashboardSectionKey) => void;
  moveWidget: (fromSection: DashboardSectionKey, toSection: DashboardSectionKey, itemId: string, beforeItemId?: string) => void;
  toggleSectionVisibility: (sectionKey: DashboardSectionKey) => void;
  resetCurrentTemplateLayout: () => void;
};

const STORAGE_KEY_PREFIX = "dashboard-preferences";
const DashboardPreferencesContext = createContext<DashboardPreferencesContextValue | null>(null);

function isTemplate(value: string | null | undefined): value is DashboardTemplate {
  return !!value && DASHBOARD_TEMPLATES.some((item) => item.value === value);
}

function cloneLayouts(): Record<DashboardTemplate, DashboardLayoutState> {
  return Object.fromEntries(
    (Object.entries(DEFAULT_LAYOUTS) as Array<[DashboardTemplate, DashboardLayoutState]>).map(([key, layout]) => [
      key,
      { sections: layout.sections.map((section) => ({ ...section, itemIds: [...section.itemIds] })) },
    ]),
  ) as Record<DashboardTemplate, DashboardLayoutState>;
}

function getStorageKey(viewer: string | null | undefined) {
  return `${STORAGE_KEY_PREFIX}:${viewer ?? "anonymous"}`;
}

function readStoredPreferences(viewer: string) {
  if (typeof window === "undefined") {
    return { template: "classic" as DashboardTemplate, layouts: cloneLayouts() };
  }

  try {
    const raw = window.localStorage.getItem(getStorageKey(viewer));
    if (!raw) return { template: "classic" as DashboardTemplate, layouts: cloneLayouts() };
    const parsed = JSON.parse(raw) as Partial<StoredPreferences>;
    return {
      template: isTemplate(parsed.template) ? parsed.template : "classic",
      layouts: {
        ...cloneLayouts(),
        ...(parsed.layouts ?? {}),
      },
    };
  } catch {
    return { template: "classic" as DashboardTemplate, layouts: cloneLayouts() };
  }
}

export function DashboardPreferencesProvider({ children }: { children: React.ReactNode }) {
  const { identity } = useIdentity();
  const viewer = identity?.email ?? identity?.name ?? "anonymous";
  const [template, setTemplateState] = useState<DashboardTemplate>("classic");
  const [layouts, setLayouts] = useState<Record<DashboardTemplate, DashboardLayoutState>>(cloneLayouts);

  useEffect(() => {
    const stored = readStoredPreferences(viewer);
    setTemplateState(stored.template);
    setLayouts({
      classic: stored.layouts.classic ?? cloneLayouts().classic,
      focus: stored.layouts.focus ?? cloneLayouts().focus,
      operations: stored.layouts.operations ?? cloneLayouts().operations,
      learning: stored.layouts.learning ?? cloneLayouts().learning,
      "command-center": stored.layouts["command-center"] ?? cloneLayouts()["command-center"],
      velocity: stored.layouts.velocity ?? cloneLayouts().velocity,
      "night-shift": stored.layouts["night-shift"] ?? cloneLayouts()["night-shift"],
      minimalist: stored.layouts.minimalist ?? cloneLayouts().minimalist,
      trainer: stored.layouts.trainer ?? cloneLayouts().trainer,
      "escalation-desk": stored.layouts["escalation-desk"] ?? cloneLayouts()["escalation-desk"],
    });
  }, [viewer]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored: StoredPreferences = { template, layouts };
    window.localStorage.setItem(getStorageKey(viewer), JSON.stringify(stored));
    document.documentElement.setAttribute("data-dashboard-template", template);
  }, [template, layouts, viewer]);

  const moveSection = useCallback((fromKey: DashboardSectionKey, toKey: DashboardSectionKey) => {
    if (fromKey === toKey) return;
    setLayouts((prev) => {
      const nextSections = [...prev[template].sections];
      const fromIndex = nextSections.findIndex((section) => section.key === fromKey);
      const toIndex = nextSections.findIndex((section) => section.key === toKey);
      if (fromIndex === -1 || toIndex === -1) return prev;
      const [moved] = nextSections.splice(fromIndex, 1);
      nextSections.splice(toIndex, 0, moved);
      return { ...prev, [template]: { sections: nextSections } };
    });
  }, [template]);

  const moveWidget = useCallback((fromSection: DashboardSectionKey, toSection: DashboardSectionKey, itemId: string, beforeItemId?: string) => {
    setLayouts((prev) => {
      const nextSections = prev[template].sections.map((section) => ({ ...section, itemIds: [...section.itemIds] }));
      const source = nextSections.find((section) => section.key === fromSection);
      const target = nextSections.find((section) => section.key === toSection);
      if (!source || !target) return prev;

      source.itemIds = source.itemIds.filter((id) => id !== itemId);
      target.itemIds = target.itemIds.filter((id) => id !== itemId);

      if (beforeItemId) {
        const targetIndex = target.itemIds.findIndex((id) => id === beforeItemId);
        if (targetIndex >= 0) {
          target.itemIds.splice(targetIndex, 0, itemId);
        } else {
          target.itemIds.push(itemId);
        }
      } else {
        target.itemIds.push(itemId);
      }

      return { ...prev, [template]: { sections: nextSections } };
    });
  }, [template]);

  const toggleSectionVisibility = useCallback((sectionKey: DashboardSectionKey) => {
    setLayouts((prev) => ({
      ...prev,
      [template]: {
        sections: prev[template].sections.map((section) =>
          section.key === sectionKey ? { ...section, hidden: !section.hidden } : section,
        ),
      },
    }));
  }, [template]);

  const resetCurrentTemplateLayout = useCallback(() => {
    setLayouts((prev) => ({
      ...prev,
      [template]: {
        sections: DEFAULT_LAYOUTS[template].sections.map((section) => ({ ...section, itemIds: [...section.itemIds] })),
      },
    }));
  }, [template]);

  const currentLayout = layouts[template];

  const value = useMemo(() => ({
    template,
    setTemplate: setTemplateState,
    currentLayout,
    moveSection,
    moveWidget,
    toggleSectionVisibility,
    resetCurrentTemplateLayout,
  }), [currentLayout, moveSection, moveWidget, resetCurrentTemplateLayout, template, toggleSectionVisibility]);

  return (
    <DashboardPreferencesContext.Provider value={{ ...value, currentLayout }}>
      {children}
    </DashboardPreferencesContext.Provider>
  );
}

export function useDashboardPreferences() {
  const ctx = useContext(DashboardPreferencesContext);
  if (!ctx) throw new Error("useDashboardPreferences must be used inside DashboardPreferencesProvider");
  return ctx;
}
