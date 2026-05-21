import type { ComponentType } from "react";
import type { Role } from "../lib/roles";

export type WidgetSize = "sm" | "md" | "lg" | "xl";

export interface WidgetDefinition {
  id: string;
  title: string;
  description?: string;
  icon: ComponentType<{ size?: number }>;
  iconColor: string; // Mantine theme color name
  /** Default tile size when shown on the dashboard grid. */
  tileSize: WidgetSize;
  /** Compact card shown on the dashboard. Click anywhere to expand. */
  Tile: ComponentType<TileProps>;
  /** Full-screen view shown when the user expands the widget. */
  Full: ComponentType;
  /**
   * Roles allowed to see this widget. If undefined, the widget is visible
   * to every role (the default — most widgets are general-purpose).
   *
   * Example: `roles: ["lead", "manager"]` hides the widget from Technicians.
   */
  roles?: Role[];
  /**
   * Featured widgets are rendered as big tiles in the main dashboard area
   * (the "Your shift" hero grid). Non-featured widgets are surfaced in the
   * left sidebar under "Tools" — they're still fully functional, just kept
   * out of the way until the user needs them.
   *
   * Default: false (sidebar tool).
   */
  featured?: boolean;
}

export interface TileProps {
  onExpand: () => void;
}

/**
 * Maps a widget's logical tile size to its colspan on a 12-column responsive
 * grid. Smaller tile sizes pack more widgets per row.
 */
export const SIZE_TO_SPAN: Record<
  WidgetSize,
  { base: number; xs?: number; sm?: number; md?: number; lg?: number }
> = {
  sm: { base: 12, xs: 6, sm: 6, md: 4, lg: 3 },
  md: { base: 12, sm: 6, md: 4, lg: 4 },
  lg: { base: 12, sm: 12, md: 6, lg: 6 },
  xl: { base: 12 },
};
