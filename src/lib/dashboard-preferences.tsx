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
export type DashboardSectionKey = "critical-alerts" | "my-tasks" | "team-availability" | "operations" | "my-work" | "queue-monitoring" | "ai-tools" | "communication" | "requests" | "team";

export interface DashboardLayoutSectionState {
  key: DashboardSectionKey;
  hidden: boolean;
  pinned?: boolean;
  collapsed?: boolean;
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
      { key: "my-tasks", hidden: false, pinned: true, collapsed: false, itemIds: ["my-day"] },
      { key: "team-availability", hidden: false, pinned: true, collapsed: false, itemIds: ["zoom-queue"] },
      { key: "operations", hidden: false, pinned: true, collapsed: false, itemIds: ["shift-checklist", "maintenance-note-generator", "work-allotment-generator", "ticket-audit", "ticket-rebalancer", "zoom-call-metrics"] },
      { key: "critical-alerts", hidden: false, pinned: false, collapsed: true, itemIds: ["logic-monitor", "velocloud-api", "data-health"] },
      { key: "my-work", hidden: false, pinned: false, collapsed: true, itemIds: ["performance-tracker", "noc-mttr-report", "meeting-notes", "break-tracker"] },
      { key: "queue-monitoring", hidden: false, pinned: false, collapsed: true, itemIds: ["building-apps-agents", "velocloud-api"] },
      { key: "ai-tools", hidden: false, pinned: false, collapsed: true, itemIds: ["smart-search", "ticket-summary", "noc-troubleshooter", "mobility-troubleshooter", "timezone-helper", "piab-troubleshooter", "velocloud-troubleshooter", "fortigate-troubleshooter", "kb-gap-finder"] },
      { key: "communication", hidden: false, pinned: false, collapsed: true, itemIds: ["email-assistant", "escalation-email", "email-polisher", "qs-escalations"] },
      { key: "requests", hidden: false, pinned: false, collapsed: true, itemIds: ["wfh", "training-updates"] },
      { key: "team", hidden: false, pinned: false, collapsed: true, itemIds: ["kudos-board", "team-feedback", "celebrations-tracker", "enhancement-tracker", "performance-discussions", "attendance-tracker"] },
    ],
  },
  focus: {
    sections: [
      { key: "my-work", hidden: false, itemIds: ["my-day", "meeting-notes", "break-tracker", "performance-tracker", "noc-mttr-report"] },
      { key: "requests", hidden: false, itemIds: ["wfh", "training-updates", "training-updates"] },
      { key: "queue-monitoring", hidden: false, itemIds: ["zoom-queue", "logic-monitor", "building-apps-agents"] },
      { key: "communication", hidden: true, itemIds: ["shift-checklist", "escalation-email", "email-polisher", "qs-escalations"] },
      { key: "ai-tools", hidden: false, itemIds: ["smart-search", "ticket-summary", "noc-troubleshooter", "mobility-troubleshooter", "timezone-helper", "kb-gap-finder"] },
      { key: "team", hidden: true, itemIds: ["kudos-board", "work-allotment-generator", "performance-discussions"] },
    ],
  },
  operations: {
    sections: [
      { key: "queue-monitoring", hidden: false, itemIds: ["zoom-queue", "logic-monitor", "building-apps-agents"] },
      { key: "communication", hidden: false, itemIds: ["escalation-email", "shift-checklist", "qs-escalations", "email-polisher"] },
      { key: "my-work", hidden: false, itemIds: ["my-day", "meeting-notes", "break-tracker", "performance-tracker", "noc-mttr-report"] },
      { key: "ai-tools", hidden: false, itemIds: ["noc-troubleshooter", "mobility-troubleshooter", "smart-search", "ticket-summary", "timezone-helper", "kb-gap-finder"] },
      { key: "requests", hidden: true, itemIds: ["wfh", "training-updates", "training-updates"] },
      { key: "team", hidden: false, itemIds: ["kudos-board", "team-feedback", "celebrations-tracker", "enhancement-tracker", "work-allotment-generator", "performance-discussions"] },
    ],
  },
  learning: {
    sections: [
      { key: "ai-tools", hidden: false, itemIds: ["smart-search", "ticket-summary", "noc-troubleshooter", "mobility-troubleshooter", "timezone-helper", "kb-gap-finder"] },
      { key: "requests", hidden: false, itemIds: ["training-updates", "wfh"] },
      { key: "communication", hidden: false, itemIds: ["email-polisher", "shift-checklist", "escalation-email", "qs-escalations"] },
      { key: "my-work", hidden: false, itemIds: ["performance-tracker", "noc-mttr-report", "meeting-notes", "my-day", "break-tracker"] },
      { key: "queue-monitoring", hidden: true, itemIds: ["zoom-queue", "logic-monitor", "building-apps-agents"] },
      { key: "team", hidden: false, itemIds: ["kudos-board", "team-feedback", "celebrations-tracker", "enhancement-tracker", "work-allotment-generator", "performance-discussions"] },
    ],
  },
  "command-center": {
    sections: [
      { key: "queue-monitoring", hidden: false, itemIds: ["zoom-queue", "logic-monitor", "building-apps-agents"] },
      { key: "my-work", hidden: false, itemIds: ["my-day", "performance-tracker", "noc-mttr-report", "meeting-notes", "break-tracker"] },
      { key: "communication", hidden: false, itemIds: ["shift-checklist", "escalation-email", "qs-escalations", "email-polisher"] },
      { key: "ai-tools", hidden: false, itemIds: ["smart-search", "noc-troubleshooter", "mobility-troubleshooter", "ticket-summary", "timezone-helper", "kb-gap-finder"] },
      { key: "requests", hidden: false, itemIds: ["training-updates", "wfh"] },
      { key: "team", hidden: false, itemIds: ["kudos-board", "team-feedback", "celebrations-tracker", "enhancement-tracker", "work-allotment-generator", "performance-discussions"] },
    ],
  },
  velocity: {
    sections: [
      { key: "my-work", hidden: false, itemIds: ["my-day", "zoom-queue", "meeting-notes", "break-tracker", "performance-tracker", "noc-mttr-report"] },
      { key: "communication", hidden: false, itemIds: ["shift-checklist", "email-polisher", "escalation-email", "qs-escalations"] },
      { key: "queue-monitoring", hidden: false, itemIds: ["logic-monitor", "building-apps-agents"] },
      { key: "ai-tools", hidden: false, itemIds: ["smart-search", "ticket-summary", "noc-troubleshooter", "mobility-troubleshooter", "timezone-helper"] },
      { key: "requests", hidden: true, itemIds: ["wfh", "training-updates", "training-updates"] },
      { key: "team", hidden: true, itemIds: ["kudos-board", "work-allotment-generator", "performance-discussions"] },
    ],
  },
  "night-shift": {
    sections: [
      { key: "queue-monitoring", hidden: false, itemIds: ["logic-monitor", "zoom-queue", "building-apps-agents"] },
      { key: "my-work", hidden: false, itemIds: ["my-day", "meeting-notes", "break-tracker", "performance-tracker", "noc-mttr-report"] },
      { key: "ai-tools", hidden: false, itemIds: ["noc-troubleshooter", "smart-search", "ticket-summary", "mobility-troubleshooter", "timezone-helper", "kb-gap-finder"] },
      { key: "communication", hidden: false, itemIds: ["shift-checklist", "qs-escalations", "escalation-email", "email-polisher"] },
      { key: "requests", hidden: true, itemIds: ["training-updates", "wfh"] },
      { key: "team", hidden: true, itemIds: ["kudos-board", "work-allotment-generator", "performance-discussions"] },
    ],
  },
  minimalist: {
    sections: [
      { key: "my-work", hidden: false, itemIds: ["my-day", "meeting-notes", "zoom-queue", "break-tracker"] },
      { key: "ai-tools", hidden: false, itemIds: ["smart-search", "ticket-summary", "timezone-helper"] },
      { key: "communication", hidden: true, itemIds: ["email-polisher", "shift-checklist", "escalation-email", "qs-escalations"] },
      { key: "queue-monitoring", hidden: true, itemIds: ["logic-monitor", "building-apps-agents"] },
      { key: "requests", hidden: true, itemIds: ["wfh", "training-updates", "training-updates"] },
      { key: "team", hidden: true, itemIds: ["kudos-board", "work-allotment-generator", "performance-discussions"] },
    ],
  },
  trainer: {
    sections: [
      { key: "my-work", hidden: false, itemIds: ["performance-tracker", "noc-mttr-report", "meeting-notes", "my-day", "break-tracker"] },
      { key: "requests", hidden: false, itemIds: ["training-updates", "wfh"] },
      { key: "communication", hidden: false, itemIds: ["email-polisher", "shift-checklist", "escalation-email", "qs-escalations"] },
      { key: "ai-tools", hidden: false, itemIds: ["smart-search", "ticket-summary", "mobility-troubleshooter", "noc-troubleshooter", "timezone-helper", "kb-gap-finder"] },
      { key: "queue-monitoring", hidden: true, itemIds: ["zoom-queue", "logic-monitor", "building-apps-agents"] },
      { key: "team", hidden: false, itemIds: ["kudos-board", "team-feedback", "celebrations-tracker", "enhancement-tracker", "work-allotment-generator", "performance-discussions"] },
    ],
  },
  "escalation-desk": {
    sections: [
      { key: "communication", hidden: false, itemIds: ["escalation-email", "shift-checklist", "qs-escalations", "email-polisher"] },
      { key: "queue-monitoring", hidden: false, itemIds: ["zoom-queue", "logic-monitor", "building-apps-agents"] },
      { key: "my-work", hidden: false, itemIds: ["my-day", "meeting-notes", "performance-tracker", "noc-mttr-report", "break-tracker"] },
      { key: "ai-tools", hidden: false, itemIds: ["noc-troubleshooter", "smart-search", "ticket-summary", "mobility-troubleshooter", "timezone-helper", "kb-gap-finder"] },
      { key: "requests", hidden: false, itemIds: ["wfh", "training-updates", "training-updates"] },
      { key: "team", hidden: false, itemIds: ["kudos-board", "team-feedback", "celebrations-tracker", "enhancement-tracker", "work-allotment-generator", "performance-discussions"] },
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
  toggleSectionPinned: (sectionKey: DashboardSectionKey) => void;
  toggleSectionCollapsed: (sectionKey: DashboardSectionKey) => void;
  resetCurrentTemplateLayout: () => void;
};

const STORAGE_KEY_PREFIX = "dashboard-preferences-v4";
// Keep this context on globalThis, matching the identity context pattern. Vite can
// reload modules with distinct query strings during HMR; a shared singleton keeps
// the provider and consumers attached to the same React context instance.
const DASHBOARD_PREFERENCES_CONTEXT_KEY = "__vcom_dashboard_preferences_context__";
function getDashboardPreferencesContext() {
  const globalStore = globalThis as typeof globalThis & {
    [DASHBOARD_PREFERENCES_CONTEXT_KEY]?: ReturnType<typeof createContext<DashboardPreferencesContextValue | null>>;
  };
  if (!globalStore[DASHBOARD_PREFERENCES_CONTEXT_KEY]) {
    globalStore[DASHBOARD_PREFERENCES_CONTEXT_KEY] = createContext<DashboardPreferencesContextValue | null>(null);
  }
  return globalStore[DASHBOARD_PREFERENCES_CONTEXT_KEY]!;
}
const DashboardPreferencesContext = getDashboardPreferencesContext();

function isTemplate(value: string | null | undefined): value is DashboardTemplate {
  return !!value && DASHBOARD_TEMPLATES.some((item) => item.value === value);
}

export const ALWAYS_PINNED_SECTION_KEYS = ["my-tasks", "team-availability", "operations"] as const satisfies readonly DashboardSectionKey[];
export function isAlwaysPinnedSection(sectionKey: DashboardSectionKey) {
  return ALWAYS_PINNED_SECTION_KEYS.includes(sectionKey as (typeof ALWAYS_PINNED_SECTION_KEYS)[number]);
}

const ALWAYS_PINNED_WIDGET_IDS = new Set(
  DEFAULT_LAYOUTS.classic.sections
    .filter((section) => ALWAYS_PINNED_SECTION_KEYS.includes(section.key as (typeof ALWAYS_PINNED_SECTION_KEYS)[number]))
    .flatMap((section) => section.itemIds),
);

function enforceAlwaysPinnedSections(layout: DashboardLayoutState): DashboardLayoutState {
  const requiredSections = DEFAULT_LAYOUTS.classic.sections.filter((section) =>
    ALWAYS_PINNED_SECTION_KEYS.includes(section.key as (typeof ALWAYS_PINNED_SECTION_KEYS)[number]),
  );
  const requiredKeys = new Set<DashboardSectionKey>(ALWAYS_PINNED_SECTION_KEYS);
  const existingByKey = new Map(layout.sections.map((section) => [section.key, section]));
  const remainingSections = layout.sections
    .filter((section) => !requiredKeys.has(section.key))
    .map((section) => ({
      ...section,
      itemIds: section.itemIds.filter((id) => !ALWAYS_PINNED_WIDGET_IDS.has(id)),
    }));
  const pinnedSections = requiredSections.map((fallback) => ({
    ...fallback,
    ...(existingByKey.get(fallback.key) ?? {}),
    hidden: false,
    pinned: true,
    collapsed: false,
    // Keep these three widget groups in the requested layout and avoid duplicates
    // in the remaining sections, even when loading older customized layouts.
    itemIds: [...fallback.itemIds],
  }));

  return { sections: [...pinnedSections, ...remainingSections] };
}

function cloneLayouts(): Record<DashboardTemplate, DashboardLayoutState> {
  return Object.fromEntries(
    (Object.entries(DEFAULT_LAYOUTS) as Array<[DashboardTemplate, DashboardLayoutState]>).map(([key, layout]) => [
      key,
      enforceAlwaysPinnedSections({
        sections: layout.sections.map((section) => ({ ...section, itemIds: [...section.itemIds] })),
      }),
    ]),
  ) as Record<DashboardTemplate, DashboardLayoutState>;
}

function getStorageKey(viewer: string | null | undefined) {
  return `${STORAGE_KEY_PREFIX}:${viewer ?? "anonymous"}`;
}

/** Widgets that must always appear in a specific section — injected into stored
 *  layouts if missing (one-time forward-migration for users with old saved prefs). */
const REQUIRED_WIDGETS: Array<{ id: string; section: DashboardSectionKey; afterId?: string }> = [
  { id: "meeting-notes", section: "my-work", afterId: "my-day" },
  { id: "noc-mttr-report", section: "my-work", afterId: "performance-tracker" },
  { id: "timezone-helper", section: "ai-tools" },
  { id: "team-feedback", section: "team", afterId: "kudos-board" },
  { id: "celebrations-tracker", section: "team", afterId: "team-feedback" },
  { id: "enhancement-tracker", section: "team", afterId: "celebrations-tracker" },
  { id: "building-apps-agents", section: "queue-monitoring", afterId: "logic-monitor" },
  { id: "work-allotment-generator", section: "team", afterId: "enhancement-tracker" },
  { id: "performance-discussions", section: "queue-monitoring", afterId: "building-apps-agents" },
];

function migrateLayouts(layouts: Record<DashboardTemplate, DashboardLayoutState>): Record<DashboardTemplate, DashboardLayoutState> {
  const result = { ...layouts };
  // Preserve existing per-viewer order/visibility while adding new controls to
  // previously saved layouts. New defaults only fill fields that did not exist.
  for (const tmpl of Object.keys(result) as DashboardTemplate[]) {
    const defaults = new Map(DEFAULT_LAYOUTS[tmpl].sections.map((section) => [section.key, section]));
    const migrated = result[tmpl].sections.map((section) => {
      const fallback = defaults.get(section.key);
      return {
        ...fallback,
        ...section,
        pinned: typeof section.pinned === "boolean" ? section.pinned : Boolean(fallback?.pinned),
        collapsed: typeof section.collapsed === "boolean" ? section.collapsed : Boolean(fallback?.collapsed),
      };
    });
    const existingKeys = new Set(migrated.map((section) => section.key));
    const addedDefaults = DEFAULT_LAYOUTS[tmpl].sections.filter((section) => !existingKeys.has(section.key));
    result[tmpl] = { sections: [...addedDefaults, ...migrated] };
  }
  // The new Classic defaults promote the four most-used areas into dedicated
  // sections. Remove those tools from their old buckets for saved Classic layouts.
  const classicCoreKeys = new Set<DashboardSectionKey>(["critical-alerts", "my-tasks", "team-availability", "operations"]);
  const promotedClassicItems = new Set(
    DEFAULT_LAYOUTS.classic.sections
      .filter((section) => classicCoreKeys.has(section.key))
      .flatMap((section) => section.itemIds),
  );
  result.classic = {
    sections: result.classic.sections.map((section) =>
      classicCoreKeys.has(section.key)
        ? section
        : { ...section, itemIds: section.itemIds.filter((id) => !promotedClassicItems.has(id)) },
    ),
  };
  // Check per-template (NOT globally) — a widget present in one template's stored
  // layout must not prevent injection into another template that's missing it.
  for (const tmpl of Object.keys(result) as DashboardTemplate[]) {
    for (const { id, section, afterId } of REQUIRED_WIDGETS) {
      const targetSection = tmpl === "classic" && id === "work-allotment-generator" ? "operations" : section;
      const targetAfterId = tmpl === "classic" && id === "work-allotment-generator" ? "shift-checklist" : afterId;
      let alreadyInTarget = false;

      const strippedSections = result[tmpl].sections.map((s) => {
        const filteredIds = s.itemIds.filter((itemId) => itemId !== id);
        if (s.key === targetSection && filteredIds.length !== s.itemIds.length) {
          alreadyInTarget = true;
        }
        return filteredIds.length === s.itemIds.length ? s : { ...s, itemIds: filteredIds };
      });

      result[tmpl] = {
        sections: strippedSections.map((s) => {
          if (s.key !== targetSection) return s;
          if (s.itemIds.includes(id) || alreadyInTarget) {
            return s.itemIds.includes(id) ? s : { ...s, itemIds: [...s.itemIds, id] };
          }
          const idx = targetAfterId ? s.itemIds.indexOf(targetAfterId) : -1;
          const newIds = [...s.itemIds];
          newIds.splice(idx >= 0 ? idx + 1 : newIds.length, 0, id);
          return { ...s, itemIds: newIds };
        }),
      };
    }
  }
  return Object.fromEntries(
    (Object.entries(result) as Array<[DashboardTemplate, DashboardLayoutState]>).map(([template, layout]) => [
      template,
      enforceAlwaysPinnedSections(layout),
    ]),
  ) as Record<DashboardTemplate, DashboardLayoutState>;
}

function readStoredPreferences(viewer: string) {
  if (typeof window === "undefined") {
    return { template: "classic" as DashboardTemplate, layouts: cloneLayouts() };
  }

  try {
    const raw = window.localStorage.getItem(getStorageKey(viewer));
    if (!raw) return { template: "classic" as DashboardTemplate, layouts: cloneLayouts() };
    const parsed = JSON.parse(raw) as Partial<StoredPreferences>;
    const merged = {
      ...cloneLayouts(),
      ...(parsed.layouts ?? {}),
    };
    return {
      template: isTemplate(parsed.template) ? parsed.template : "classic",
      layouts: migrateLayouts(merged),
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
    if (ALWAYS_PINNED_WIDGET_IDS.has(itemId)) return;
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
    if (ALWAYS_PINNED_SECTION_KEYS.includes(sectionKey as (typeof ALWAYS_PINNED_SECTION_KEYS)[number])) return;
    setLayouts((prev) => ({
      ...prev,
      [template]: {
        sections: prev[template].sections.map((section) =>
          section.key === sectionKey ? { ...section, hidden: !section.hidden } : section,
        ),
      },
    }));
  }, [template]);

  const toggleSectionPinned = useCallback((sectionKey: DashboardSectionKey) => {
    if (ALWAYS_PINNED_SECTION_KEYS.includes(sectionKey as (typeof ALWAYS_PINNED_SECTION_KEYS)[number])) return;
    setLayouts((prev) => ({
      ...prev,
      [template]: {
        sections: prev[template].sections.map((section) =>
          section.key === sectionKey ? { ...section, pinned: !section.pinned } : section,
        ),
      },
    }));
  }, [template]);

  const toggleSectionCollapsed = useCallback((sectionKey: DashboardSectionKey) => {
    if (ALWAYS_PINNED_SECTION_KEYS.includes(sectionKey as (typeof ALWAYS_PINNED_SECTION_KEYS)[number])) return;
    setLayouts((prev) => ({
      ...prev,
      [template]: {
        sections: prev[template].sections.map((section) =>
          section.key === sectionKey ? { ...section, collapsed: !section.collapsed } : section,
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
    toggleSectionPinned,
    toggleSectionCollapsed,
    resetCurrentTemplateLayout,
  }), [currentLayout, moveSection, moveWidget, resetCurrentTemplateLayout, template, toggleSectionVisibility, toggleSectionPinned, toggleSectionCollapsed]);

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
