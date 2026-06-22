// Dashboard shell — featured tiles in the main area + sidebar tools list.
//
//   - The 3 "featured" widgets (My Day, Zoom Queue, Break Tracker) render as
//     large tiles in the main pane.
//   - Every other widget is surfaced as a sidebar entry under "Tools". Click
//     to expand it into the main pane (full view), click the dashboard
//     breadcrumb to return.
//   - Header shows the BrandLogo, IdentityBadge (name + role) and an accent
//     strip tinted by the current role.
//   - When no identity is set, a welcome / sign-in card is shown above the
//     tile grid.
//   - Widgets can declare `roles: ["lead", "manager"]` to restrict access.
//     Deep-links to restricted widgets fall back to the dashboard.
import { useEffect, useMemo } from "react";
import {
  ActionIcon,
  AppShell,
  Box,
  Card,
  Center,
  Grid,
  Group,
  Loader,
  Text,
  Breadcrumbs,
  Anchor,
  SimpleGrid,
  Stack,
  ThemeIcon,
  Badge,
  Tooltip,
  UnstyledButton,
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconLayoutDashboard,
  IconMoon,
  IconSun,
} from "@tabler/icons-react";
import { WIDGETS } from "./widgets/registry";
import { trackWidgetOpen } from "./lib/track";
import type { WidgetDefinition } from "./widgets/types";
import { SIZE_TO_SPAN } from "./widgets/types";
import { IdentityBadge } from "./widgets/IdentityBadge";
import { NewsTicker } from "./widgets/NewsTicker";
import { BrandLogo } from "./widgets/BrandLogo";
import { NotificationBell } from "./widgets/NotificationBell";
import { useIdentity } from "./lib/identity";
import {
  canAccess,
  ROLE_COLORS,
} from "./lib/roles";
import SignInPage from "./SignInPage";
import { ManagerDayWidget } from "./widgets/ManagerDay";
import { WindowManagerProvider, useWindowManager } from "./lib/window-manager";
import { FloatingWindow } from "./components/FloatingWindow";
import { Taskbar } from "./components/Taskbar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppOverview } from "./components/AppOverview";
import { DashboardTemplatePicker } from "./components/DashboardTemplatePicker";
import { AutoChatAssistant } from "./components/AutoChatAssistant";
import { type DashboardTemplate, useDashboardPreferences } from "./lib/dashboard-preferences";

// AppDirect brand colors. Primary is #006080 (deep petrol teal,
// sourced from AppDirect's Base design-system docs); the lighter mid
// teal #0080a6 is used for the bright accent in the brand strip.
const APPDIRECT_BRAND_PRIMARY = "#006080";
const APPDIRECT_BRAND_ACCENT = "#0080a6";

export default function App() {
  return (
    <WindowManagerProvider>
      <AppInner />
    </WindowManagerProvider>
  );
}

function AppInner() {
  const { identity, loading: identityLoading } = useIdentity();
  const { template } = useDashboardPreferences();
  const { windows, openWindow } = useWindowManager();
  const [overviewOpen, { open: openOverview, close: closeOverview }] = useDisclosure(false);
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light", {
    getInitialValueInEffect: true,
  });
  const isDark = computedColorScheme === "dark";
  const toggleColorScheme = () => setColorScheme(isDark ? "light" : "dark");

  const visibleWidgets = useMemo(() => {
    if (!identity) return WIDGETS;
    return WIDGETS.filter((w) => canAccess(identity.role, w.roles));
  }, [identity]);

  const featuredWidgets = useMemo(
    () => visibleWidgets.filter((w) => w.featured),
    [visibleWidgets],
  );
  const sidebarWidgets = useMemo(
    () => visibleWidgets.filter((w) => !w.featured),
    [visibleWidgets],
  );

  useEffect(() => {
    // Manager-only: deep-link hashes open floating windows.
    // Tech dashboard uses hash routing locally to show full widget views.
    if (!identity || identity.role !== "manager") return;

    const fromHash = () => {
      const h = window.location.hash.replace(/^#\/?/, "");
      if (!h) return;
      const widget = WIDGETS.find((w) => w.id === h);
      if (!widget) return;
      if (!canAccess(identity.role, widget.roles)) {
        window.location.hash = "";
        return;
      }
      openWindow(widget);
      window.location.hash = "";
    };

    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [identity, openWindow]);

  useEffect(() => {
    if (!identity) return;

    let disposed = false;
    let inFlight = false;

    const triggerReminderCheck = async () => {
      if (disposed || inFlight || document.hidden) return;
      inFlight = true;
      try {
        await fetch("/api/calendar/reminders", {
          method: "POST",
          credentials: "include",
        });
      } catch {
        // Best-effort polling only; reminder route handles auth/calendar state.
      } finally {
        inFlight = false;
      }
    };

    void triggerReminderCheck();
    const interval = window.setInterval(() => {
      void triggerReminderCheck();
    }, 60_000);

    const handleVisibility = () => {
      if (!document.hidden) {
        void triggerReminderCheck();
      }
    };

    window.addEventListener("focus", handleVisibility);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleVisibility);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [identity]);

  // Show a brief loading spinner while the session check runs (avoids a flash
  // of the "not signed in" welcome card before the session cookie is verified).
  if (identityLoading) {
    return (
      <Center h="100vh">
        <Loader size="lg" color="appdirect" />
      </Center>
    );
  }

  // ---- Route based on auth state ----
  // Not signed in → clean sign-in page (no widgets, no sidebar)
  if (!identity) {
    return <SignInPage />;
  }

  // All signed-in users now use the same dashboard shell/layout.
  // Role-based widget visibility still comes from canAccess(...).
  function expand(id: string) {
    const w = WIDGETS.find((x) => x.id === id);
    if (!w) return;
    trackWidgetOpen(id, w.title);
    openWindow(w);
  }

  // Role-tinted accent under the header. Falls back to the AppDirect brand teal
  // when there's no identity yet.
  const accentColor = identity ? ROLE_COLORS[identity.role] : "appdirect";
  const accentGradient = identity
    ? `linear-gradient(90deg, transparent 0%, var(--mantine-color-${accentColor}-7) 30%, var(--mantine-color-${accentColor}-6) 70%, transparent 100%)`
    : "linear-gradient(90deg, transparent 0%, rgba(0, 96, 128,0.65) 30%, rgba(0, 128, 166,0.65) 70%, transparent 100%)";

  return (
    <AppShell
      data-dashboard-template={template}
      header={{ height: 68 }}
      padding={0}
    >
      <AppShell.Header
        style={{
          background: isDark
            ? "rgba(15, 22, 36, 0.78)"
            : "rgba(255, 255, 255, 0.85)",
          backdropFilter: "blur(16px) saturate(160%)",
          WebkitBackdropFilter: "blur(16px) saturate(160%)",
          borderBottom: isDark
            ? "1px solid rgba(255,255,255,0.06)"
            : "1px solid rgba(15,23,42,0.08)",
          position: "relative",
          zIndex: 100,
        }}
      >
        {/* AppDirect brand strip across the very top */}
        <Box
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: 3,
            background: `linear-gradient(90deg, ${APPDIRECT_BRAND_PRIMARY} 0%, ${APPDIRECT_BRAND_ACCENT} 50%, ${APPDIRECT_BRAND_PRIMARY} 100%)`,
            pointerEvents: "none",
          }}
        />
        {/* Role-tinted gradient line below the header */}
        <Box
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 1,
            background: accentGradient,
            opacity: 0.7,
            pointerEvents: "none",
          }}
        />
        <Box h="100%" px="xl">
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Group gap="md" style={{ minWidth: 0 }} wrap="nowrap">
              <Box
                style={{
                  position: "relative",
                  filter: `drop-shadow(0 0 16px var(--mantine-color-${accentColor}-6))`,
                }}
              >
                <BrandLogo
                  size={32}
                  glowColor={`var(--mantine-color-${accentColor}-6)`}
                />
              </Box>
              <Box style={{ minWidth: 0 }}>
                <Group gap={8} align="center">
                  <Breadcrumbs
                    separator="›"
                    styles={{
                      separator: { color: "var(--mantine-color-dimmed)" },
                      root: { lineHeight: 1.1 },
                    }}
                  >
                    <Anchor
                      component="button"
                      onClick={openOverview}
                      fw={600}
                      c="bright"
                      underline="never"
                      style={{ fontSize: 16, letterSpacing: "-0.01em" }}
                    >
                      {identity ? "NOC Manager Dashboard" : "vCom NOC Operations Dashboard"}
                    </Anchor>
                    {windows.length > 0 && (
                      <Badge size="sm" color="appdirect" variant="light">
                        {windows.length} open
                      </Badge>
                    )}
                  </Breadcrumbs>
                  <Box
                    className="dashboard-status-pulse"
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: `var(--mantine-color-${accentColor}-5)`,
                      flexShrink: 0,
                    }}
                    aria-label="Live"
                  />
                </Group>
                <Text
                  size="xs"
                  c="dimmed"
                  mt={1}
                  style={{ letterSpacing: "0.01em" }}
                >
                  {identity
                    ? `${sidebarWidgets.length + featuredWidgets.length} tools · click any widget to open`
                    : "Sign in to access the dashboard"}
                </Text>
              </Box>
            </Group>
            <Group gap="sm" wrap="nowrap">
              <DashboardTemplatePicker />
              <Tooltip
                label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                withArrow
              >
                <ActionIcon
                  variant="default"
                  size="lg"
                  radius="md"
                  onClick={toggleColorScheme}
                  aria-label="Toggle color scheme"
                >
                  {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
                </ActionIcon>
              </Tooltip>
              <NotificationBell onNavigate={expand} />
              <IdentityBadge />
              <Text
                size="xs"
                c="dimmed"
                visibleFrom="lg"
                style={{
                  fontVariantNumeric: "tabular-nums",
                  fontFamily: "var(--mantine-font-family-monospace)",
                  letterSpacing: "0.02em",
                }}
              >
                {new Date().toLocaleDateString([], {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </Text>
            </Group>
          </Group>
        </Box>
      </AppShell.Header>

      <AppShell.Main
        style={{
          background: isDark
            ? "var(--dashboard-page-bg-dark)"
            : "var(--dashboard-page-bg-light)",
          minHeight: "100vh",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Vibrant aurora glows */}
        <Box
          style={{
            position: "fixed",
            top: "-15%",
            left: "10%",
            width: "55vw",
            height: "55vh",
            background:
              "radial-gradient(circle at center, rgba(0, 96, 128,0.22), transparent 60%)",
            pointerEvents: "none",
            zIndex: 0,
            filter: "blur(20px)",
          }}
        />
        <Box
          style={{
            position: "fixed",
            top: "20%",
            right: "-10%",
            width: "55vw",
            height: "55vh",
            background:
              "radial-gradient(circle at center, rgba(0, 128, 166,0.18), transparent 60%)",
            pointerEvents: "none",
            zIndex: 0,
            filter: "blur(20px)",
          }}
        />
        <Box
          style={{
            position: "fixed",
            bottom: "-25%",
            left: "30%",
            width: "60vw",
            height: "60vh",
            background:
              "radial-gradient(circle at center, rgba(94,190,238,0.16), transparent 60%)",
            pointerEvents: "none",
            zIndex: 0,
            filter: "blur(20px)",
          }}
        />
        <Box className="dot-grid-bg" />
        <Box
          px="xl"
          py="lg"
          style={{ position: "relative", zIndex: 1 }}
        >
          <ManagerHome
            featuredWidgets={featuredWidgets}
            onExpand={expand}
            template={template}
          />
        </Box>
      </AppShell.Main>

      {/* ── Floating Windows ── */}
      {windows.map((win) => (
        <FloatingWindow key={win.id} win={win} />
      ))}

      <AutoChatAssistant model="auto" />

      {/* ── Taskbar ── */}
      <Taskbar />

      {/* ── App Overview modal ── */}
      <AppOverview opened={overviewOpen} onClose={closeOverview} />

    </AppShell>
  );
}

// ── Manager Home ─────────────────────────────────────────────────────────────

function ManagerHome({
  featuredWidgets,
  onExpand,
  template,
}: {
  identity?: ReturnType<typeof useIdentity>["identity"];
  featuredWidgets: WidgetDefinition[];
  onExpand: (id: string) => void;
  template: DashboardTemplate;
}) {
  // Separate "my-day" (WorkActivity) from the rest — managers get ManagerDay instead
  const monitoringWidgets = featuredWidgets.filter((w) => w.id !== "my-day");
  const highlightedWidgets =
    template === "learning"
      ? monitoringWidgets.slice(0, 2)
      : template === "operations"
        ? monitoringWidgets.slice(0, 3)
        : monitoringWidgets;

  return (
    <Stack gap="lg">
      {/* News ticker */}
      <NewsTicker />

      {/* Main 2-column layout: My Day (left) + Team monitoring tiles (right) */}
      <Grid gutter="lg" align="flex-start">

        {/* ── Left: Manager Day planner ── */}
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card withBorder radius="lg" p="lg" h="100%"
            style={{
              borderTop: "3px solid var(--mantine-color-appdirect-6)",
              background: "color-mix(in srgb, var(--mantine-color-appdirect-9) 6%, var(--mantine-color-body))",
            }}
          >
            <Group gap="xs" mb="md">
              <ThemeIcon size="sm" variant="light" color="appdirect" radius="md">
                <IconLayoutDashboard size={14} />
              </ThemeIcon>
              <Text size="xs" fw={700} tt="uppercase" c="appdirect.5" style={{ letterSpacing: "0.08em" }}>
                My Day
              </Text>
            </Group>
            <ManagerDayWidget />
          </Card>
        </Grid.Col>

        {/* ── Right: Team monitoring + quick-launch grid ── */}
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack gap="lg">
            {/* Featured monitoring tiles */}
            {highlightedWidgets.length > 0 && (
              <Box>
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="sm"
                  style={{ letterSpacing: "0.08em", paddingLeft: 2 }}>
                  Team Overview
                </Text>
                <Grid gutter="md">
                  {monitoringWidgets.map((w) => {
                    const Tile = w.Tile;
                    const span = SIZE_TO_SPAN[w.tileSize];
                    return (
                      <Grid.Col key={w.id} span={span}>
                        <ErrorBoundary label={w.title} compact>
                          <Tile onExpand={() => onExpand(w.id)} />
                        </ErrorBoundary>
                      </Grid.Col>
                    );
                  })}
                </Grid>
              </Box>
            )}

            {/* Quick-launch grid: non-featured widgets as compact cards */}
            <ManagerQuickLaunch onExpand={onExpand} />
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

// Quick-launch section — compact cards for non-featured tools
const MANAGER_QUICK_GROUPS: Array<{
  label: string;
  items: Array<{ id: string; emoji: string; label: string; desc: string; color: string }>;
}> = [
  {
    label: "Search & AI Tools",
    items: [
      { id: "smart-search",        emoji: "🔎", label: "Smart Search",      desc: "AI dashboard search",         color: "indigo" },
      { id: "ticket-summary",      emoji: "📄", label: "Ticket Summary",    desc: "Summarize tickets",           color: "indigo" },
      { id: "escalation-email",    emoji: "✉️", label: "ESC Email",         desc: "Draft escalation alerts",     color: "teal" },
      { id: "email-polisher",      emoji: "📝", label: "Email Polisher",    desc: "Polish customer drafts",      color: "lime" },
      { id: "noc-troubleshooter",  emoji: "🩺", label: "NOC Troubleshooter",desc: "AI network troubleshooting",   color: "cyan" },
      { id: "velocloud-troubleshooter", emoji: "🌐", label: "VeloCloud Troubleshooter", desc: "Arista SD-WAN troubleshooting", color: "cyan" },
      { id: "fortigate-troubleshooter", emoji: "🛡️", label: "Fortigate Troubleshooting Agent", desc: "FortiGate troubleshooting", color: "orange" },
      { id: "ticket-audit",        emoji: "🔍", label: "Ticket Audit",      desc: "AI-powered QA audits",        color: "pink" },
    ],
  },
  {
    label: "Team Management",
    items: [
      { id: "performance-tracker", emoji: "📊", label: "Performance",       desc: "Team metrics & audits",       color: "green" },
      { id: "wfh",                 emoji: "🏠", label: "WFH Requests",      desc: "Review & approve WFH",        color: "appdirect" },
      { id: "training-updates",    emoji: "🎓", label: "Training Hub",      desc: "Requests, sessions, progress", color: "blue" },
      { id: "attendance-tracker",  emoji: "🕒", label: "Attendance & Reminders", desc: "Punches + reminder counts", color: "orange" },
      { id: "meeting-notes",       emoji: "📒", label: "Meeting Notes",     desc: "1:1 and team notebooks",      color: "grape" },
      { id: "kudos-board",         emoji: "⭐", label: "Kudos Board",       desc: "Peer recognition",             color: "yellow" },
    ],
  },
  {
    label: "Monitoring & Operations",
    items: [
      { id: "logic-monitor",       emoji: "🔔", label: "LogicMonitor",      desc: "Alerts & alert analyzer",     color: "red" },
      { id: "velocloud-api",       emoji: "🌐", label: "VeloCloud API",     desc: "SD-WAN alerts & link status", color: "cyan" },
      { id: "zoom-queue",          emoji: "📞", label: "Team Availability", desc: "Live queue + meetings",       color: "appdirect" },
      { id: "zoom-call-metrics",   emoji: "📈", label: "Zoom Call Metrics", desc: "Queue call data",             color: "green" },
      { id: "qs-escalations",      emoji: "📋", label: "Escalations",       desc: "Carrier contacts",            color: "grape" },
      { id: "shift-checklist",     emoji: "🔄", label: "Shift Handover",    desc: "Structured handover",         color: "teal" },
      { id: "data-health",         emoji: "🗄️", label: "Data Health",       desc: "App data table counts",       color: "orange" },
    ],
  },
  {
    label: "Admin & Knowledge",
    items: [
      { id: "access-control",      emoji: "🛡️", label: "Access Control",    desc: "Manage roles & access",       color: "red" },
      { id: "app-usage",           emoji: "📉", label: "App Usage",         desc: "Tool adoption & DAU",         color: "teal" },
      { id: "kb-gap-finder",       emoji: "📘", label: "Knowledge Base",    desc: "Runbooks & missing docs",     color: "indigo" },
      { id: "timezone-helper",     emoji: "🌍", label: "Timezone Helper",   desc: "DST-aware time conversion",   color: "cyan" },
      { id: "mobility-troubleshooter", emoji: "📱", label: "Mobility Troubleshooter", desc: "Wireless/device troubleshooting", color: "violet" },
    ],
  },
];

function ManagerQuickLaunch({ onExpand }: { onExpand: (id: string) => void }) {
  const visibleIds = useMemo(
    () => new Set(WIDGETS.map((w) => w.id)),
    [],
  );

  const groups = MANAGER_QUICK_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => visibleIds.has(i.id)),
  })).filter((g) => g.items.length > 0);

  return (
    <Stack gap="md">
      {groups.map((group) => (
        <Box key={group.label}>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="xs"
            style={{ letterSpacing: "0.08em", paddingLeft: 2 }}>
            {group.label}
          </Text>
          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
            {group.items.map((item) => (
              <UnstyledButton key={item.id} onClick={() => onExpand(item.id)} style={{ width: "100%" }}>
                <Card withBorder radius="md" p="sm" className="tech-nav-button"
                  style={{ cursor: "pointer", transition: "all 150ms ease", position: "relative", overflow: "hidden" }}>
                  <Box style={{
                    position: "absolute", top: 0, left: 0, right: 0, height: 2,
                    background: `var(--mantine-color-${item.color}-6)`, opacity: 0.7,
                  }} />
                  <Group gap="xs" wrap="nowrap">
                    <Text size="xl" style={{ lineHeight: 1 }}>{item.emoji}</Text>
                    <Box style={{ minWidth: 0 }}>
                      <Text size="xs" fw={600} c="bright" style={{ lineHeight: 1.3 }}>
                        {item.label}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1} mt={1}>
                        {item.desc}
                      </Text>
                    </Box>
                  </Group>
                </Card>
              </UnstyledButton>
            ))}
          </SimpleGrid>
        </Box>
      ))}
    </Stack>
  );
}


