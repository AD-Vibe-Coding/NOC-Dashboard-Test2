/**
 * AppDirect-branded Mantine theme.
 *
 * Source of truth: AppDirect's Base design-system documentation defines
 * its primary color as #006080 (RGB 0,96,128; HSL 195°, 100%, 25%) —
 * a deep petrol teal. This theme builds a coordinated palette around
 * that anchor and applies it across the whole app via Mantine's
 * primary color + palette-override mechanism.
 *
 * Strategy
 * --------
 * The codebase has dozens of `color="blue"`, `color="green"`,
 * `color="cyan"`, `color="violet"`, etc. props baked into widget code
 * (KPI cards, status badges, ThemeIcons, etc.). Renaming them all
 * would be thousands of edits and would lose the semantic separation
 * of distinct hues for distinct KPI groups (tickets / calls / tasks
 * each have their own accent).
 *
 * Instead this theme **retunes what those palette names resolve to**
 * so every widget inherits a brand-coherent palette with zero code
 * changes outside this file:
 *
 *   blue   →  AppDirect primary teal      (Tickets accents)
 *   green  →  teal-shifted positive green (Calls / OK status)
 *   cyan   →  leans into the AppDirect base
 *   violet →  teal-purple                 (Trends / tasks-alt)
 *   orange →  warm amber complement        (Tasks / reset — deliberate
 *                                          warm accent for chunking)
 *   red    →  near-default Mantine red    (errors / warnings)
 *   yellow →  near-default Mantine yellow (warnings / alerts)
 *
 * Each entry is a 10-stop tuple (shades 0..9) generated to give Mantine
 * enough headroom for hover/active/focus states on both light and dark
 * backgrounds. Shade 5/6 is the "main" color; lighter shades (0-4) for
 * fills + dark-mode text; darker shades (7-9) for borders + hover.
 */
import type { MantineColorsTuple, MantineThemeOverride } from "@mantine/core";

/**
 * AppDirect primary — anchored on #006080 at shade 6.
 *
 * 0..4 lighten progressively (for subtle backgrounds + dark-mode text)
 * 5..6 are the brand mid-tones
 * 7..9 darken progressively (for borders + hover states)
 */
const appdirect: MantineColorsTuple = [
  "#e6f3f7", // 0  — lightest tint
  "#cce6ef", // 1
  "#99cce0", // 2
  "#66b3d0", // 3
  "#3399c1", // 4
  "#0080a6", // 5
  "#006080", // 6  — BRAND PRIMARY
  "#005066", // 7
  "#00404d", // 8
  "#003040", // 9  — darkest shade
];

/**
 * Secondary accent — a slightly desaturated, lighter teal used for
 * hover states, secondary buttons, and the brand-coordinated cyan.
 */
const brandTeal: MantineColorsTuple = [
  "#e8f4f8",
  "#d0e8f0",
  "#a1d1e1",
  "#72bad2",
  "#43a3c3",
  "#1f8aa6", // 5  — main accent
  "#16728a",
  "#0d5a6e",
  "#054152",
  "#022a36",
];

/**
 * Override Mantine's default `blue` to the AppDirect teal family.
 * This makes every existing `color="blue"` usage in the codebase
 * (Tickets KPI card, agent labels, info badges, primary buttons that
 * specify color="blue") automatically inherit the brand color.
 */
const blue: MantineColorsTuple = appdirect;

/**
 * Calls / OK / positive — teal-shifted green so it lives in the same
 * temperature family as the brand teal but still reads unmistakably
 * as "positive / answered / available".
 */
const green: MantineColorsTuple = [
  "#e6f7f1",
  "#c2ebda",
  "#94d9bc",
  "#65c79d",
  "#37b67f",
  "#1ea96d", // 5
  "#108e58",
  "#067043",
  "#03522e",
  "#01331a",
];

/**
 * Cyan — biased toward the AppDirect base so the re-derive icon
 * and "info" actions visually anchor with the brand.
 */
const cyan: MantineColorsTuple = [
  "#e0f4f9",
  "#bee5ee",
  "#7ccbdc",
  "#3ab1ca",
  "#0a98b8",
  "#0080a6", // 5  — matches appdirect.5
  "#006785",
  "#004f66",
  "#003848",
  "#00212c",
];

/**
 * Violet — teal-purple. Used for Trends headers and tasks-alt
 * accents. Sits next to the brand teal without screaming.
 */
const violet: MantineColorsTuple = [
  "#efeafa",
  "#d6ccef",
  "#b39de0",
  "#906ed1",
  "#7048c3",
  "#5a35b3", // 5
  "#48298f",
  "#371d6c",
  "#27124a",
  "#170828",
];

/**
 * Orange — warm amber complement. Deliberate warm accent for visual
 * chunking against the dominant teal palette. Used by the Tasks card
 * and the reset/destructive icon (subtle attention without "alert").
 */
const orange: MantineColorsTuple = [
  "#fef4e6",
  "#fbe2bf",
  "#f6c885",
  "#f2ae4a",
  "#ee961c",
  "#d97e0a", // 5
  "#a96106",
  "#7a4403",
  "#4c2900",
  "#2e1900",
];

/**
 * Red — kept close to Mantine's default for instant "error/danger"
 * recognition. Slightly desaturated so it doesn't visually fight
 * the teal-dominated palette.
 */
const red: MantineColorsTuple = [
  "#fdecec",
  "#fbd5d5",
  "#f6a8a8",
  "#f17b7b",
  "#ec5454",
  "#d63d3d", // 5
  "#b62b2b",
  "#911f1f",
  "#6c1414",
  "#470a0a",
];

/**
 * Yellow — kept close to Mantine default for warning consistency.
 */
const yellow: MantineColorsTuple = [
  "#fff8e1",
  "#ffeeb3",
  "#ffe082",
  "#ffd54f",
  "#ffca28",
  "#ffb300", // 5
  "#ff8f00",
  "#ff6f00",
  "#cc5500",
  "#993f00",
];

/**
 * Teal — keep separate from `appdirect` so widgets that pick
 * `color="teal"` (Avg Speed of Answer, Within 24h, SLA-Met) read as
 * a distinct teal-positive that doesn't merge into the primary
 * Tickets accent.
 */
const teal: MantineColorsTuple = [
  "#dff7f4",
  "#bfeae4",
  "#80d6ca",
  "#41c2b0",
  "#15ad97",
  "#0d9885", // 5
  "#067a6a",
  "#035c50",
  "#013e37",
  "#001f1c",
];

export const appdirectTheme: MantineThemeOverride = {
  /**
   * Setting `primaryColor` to "appdirect" makes the brand teal the
   * default for any component that doesn't explicitly specify a color
   * (e.g. <Button> with no color prop). This is the single biggest
   * lever for applying the brand across the app.
   */
  primaryColor: "appdirect",
  /**
   * Pin the "main" shade Mantine pulls from the palette. Shade 6 is
   * the on-brand #006080. On dark mode, Mantine auto-shifts toward
   * shade 5 (lighter) for adequate contrast against dark surfaces;
   * `primaryShade` accepts a {light, dark} object to control this
   * explicitly.
   */
  primaryShade: { light: 6, dark: 5 },

  colors: {
    appdirect,
    brandTeal,
    // Overridden Mantine palette entries — these names are used all
    // over the codebase; retuning them here cascades app-wide.
    blue,
    green,
    cyan,
    violet,
    orange,
    red,
    yellow,
    teal,
  },

  /**
   * Slightly rounded corners by default — matches AppDirect's clean,
   * approachable visual language ("precise, engineered forms meet
   * approachable colors and type").
   */
  defaultRadius: "md",

  /**
   * Component-level token tweaks. Most components inherit the right
   * colors automatically via `primaryColor`; this block is for the
   * few that need explicit tuning.
   */
  components: {
    Anchor: {
      defaultProps: {
        // Links throughout the app should be on-brand teal, not
        // Mantine's default blue.
        c: "appdirect.4",
      },
    },
    Badge: {
      defaultProps: {
        // Default badge variant looks better as "light" against the
        // dark theme background — softer than the default "filled".
        variant: "light",
      },
    },
  },
};
