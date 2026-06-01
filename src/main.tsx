import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createTheme, MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "./index.css";
import App from "./App";
import { IdentityProvider } from "./lib/identity";
import { DashboardPreferencesProvider } from "./lib/dashboard-preferences";

// Custom theme — built around AppDirect's official brand palette.
// AppDirect's Base design-system documents `#006080` (deep petrol teal,
// HSL 195° 100% 25%) as the primary brand color. The 10-stop scale
// below is anchored on that primary at shade 6, with lighter tints
// (0–5) for fills + dark-mode text and darker shades (7–9) for
// borders + hover/active states.
const theme = createTheme({
  colors: {
    appdirect: [
      "#e6f3f7", // 0  — page-level wash / tinted surface
      "#cce6ef", // 1  — hover tint
      "#99cce0", // 2
      "#66b3d0", // 3
      "#3399c1", // 4
      "#0080a6", // 5  — bright mid teal (interactive hover)
      "#006080", // 6  — APPDIRECT BRAND PRIMARY
      "#005066", // 7
      "#00404d", // 8
      "#003040", // 9  — darkest shade
    ],
  },
  primaryColor: "appdirect",
  primaryShade: { light: 6, dark: 5 },
  defaultRadius: "md",
  fontFamily:
    '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif',
  fontFamilyMonospace:
    '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
  headings: {
    fontFamily:
      '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontWeight: "600",
  },
  components: {
    Card: {
      defaultProps: {
        radius: "lg",
        // Lift cards off the page background in both light/dark modes.
        // `--widget-tile-surface` is defined in src/index.css and is one
        // step lighter than `--mantine-color-body` in dark mode.
        bg: "var(--widget-tile-surface)",
      },
    },
    Button: {
      defaultProps: { radius: "md" },
    },
    Badge: {
      defaultProps: { radius: "sm" },
    },
    Modal: {
      defaultProps: { radius: "lg", zIndex: 10000 },
    },
    Menu: {
      defaultProps: { withinPortal: true, zIndex: 10000 },
    },
    Popover: {
      defaultProps: { withinPortal: true, zIndex: 10000 },
    },
    Tooltip: {
      defaultProps: { withinPortal: true, zIndex: 10000 },
    },
    Select: {
      defaultProps: {
        comboboxProps: { withinPortal: true, zIndex: 10000 },
      },
    },
    MultiSelect: {
      defaultProps: {
        comboboxProps: { withinPortal: true, zIndex: 10000 },
      },
    },
    Autocomplete: {
      defaultProps: {
        comboboxProps: { withinPortal: true, zIndex: 10000 },
      },
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="light" theme={theme}>
      <IdentityProvider>
        <DashboardPreferencesProvider>
          <App />
        </DashboardPreferencesProvider>
      </IdentityProvider>
    </MantineProvider>
  </StrictMode>,
);
