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
  Button,
  Card,
  Center,
  Grid,
  Group,
  Loader,
  Modal,
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
  IconSearch,
  IconSun,
} from "@tabler/icons-react";
import { WIDGETS } from "./widgets/registry";
import { trackWidgetOpen } from "./lib/track";
import type { WidgetDefinition } from "./widgets/types";
import { IdentityBadge } from "./widgets/IdentityBadge";
import { NewsTicker } from "./widgets/NewsTicker";
import { BrandLogo } from "./widgets/BrandLogo";
import { NotificationBell } from "./widgets/NotificationBell";
import { useIdentity } from "./lib/identity";
import {
  canAccess,
  effectiveRoleForIdentity,
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
import { SmartSearchPanel } from "./widgets/SmartSearch";
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
  const [searchOpen, { open: openSearch, close: closeSearch }] = useDisclosure(false);
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light", {
    getInitialValueInEffect: true,
  });
  const isDark = computedColorScheme === "dark";
  const toggleColorScheme = () => setColorScheme(isDark ? "light" : "dark");

  const effectiveRole = effectiveRoleForIdentity(identity);

  const visibleWidgets = useMemo(() => {
    const accessible = !identity ? WIDGETS : WIDGETS.filter((w) => canAccess(effectiveRole, w.roles));
    return accessible.filter((w) => w.id !== "smart-search");
  }, [effectiveRole, identity]);

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
    if (!identity || effectiveRole !== "manager") return;

    const fromHash = () => {
      const h = window.location.hash.replace(/^#\/?/, "");
      if (!h) return;
      const widget = WIDGETS.find((w) => w.id === h);
      if (!widget) return;
      if (!canAccess(effectiveRole, widget.roles)) {
        window.location.hash = "";
        return;
      }
      openWindow(widget);
      window.location.hash = "";
    };

    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [effectiveRole, identity, openWindow]);

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
  const accentColor = effectiveRole ? ROLE_COLORS[effectiveRole] : "appdirect";
  const accentGradient = identity
    ? `linear-gradient(90deg, transparent 0%, var(--mantine-color-${accentColor}-7) 30%, var(--mantine-color-${accentColor}-6) 70%, transparent 100%)`
    : "linear-gradient(90deg, transparent 0%, rgba(0, 96, 128,0.65) 30%, rgba(0, 128, 166,0.65) 70%, transparent 100%)";

  return (
    <AppShell
      data-dashboard-template={template}
      header={{ height: 52, offset: false }}
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
        <Box h="100%" px={8}>
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Group gap="xs" style={{ minWidth: 0 }} wrap="nowrap">
              <Box
                style={{
                  position: "relative",
                  filter: `drop-shadow(0 0 16px var(--mantine-color-${accentColor}-6))`,
                }}
              >
                <BrandLogo
                  size={28}
                  glowColor={`var(--mantine-color-${accentColor}-6)`}
                />
              </Box>
              <Box style={{ minWidth: 0 }}>
                <Group gap={6} align="center">
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
                      style={{ fontSize: 15, letterSpacing: "-0.01em" }}
                    >
                      {identity ? "NOC Operations Dashboard" : "vCom NOC Operations Dashboard"}
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
                  mt={0}
                  style={{ letterSpacing: "0.01em", lineHeight: 1.25 }}
                >
                  {identity
                    ? `${sidebarWidgets.length + featuredWidgets.length} tools · click any widget to open`
                    : "Sign in to access the dashboard"}
                </Text>
              </Box>
            </Group>
            <Group gap="xs" wrap="nowrap">
              <DashboardTemplatePicker />
              <Button
                variant="light"
                color="indigo"
                leftSection={<IconSearch size={15} />}
                radius="md"
                size="sm"
                px="sm"
                onClick={openSearch}
              >
                Search dashboard
              </Button>
              <Tooltip
                label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                withArrow
              >
                <ActionIcon
                  variant="default"
                  size="md"
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
          paddingTop: 52,
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
        <Box style={{ position: "relative", zIndex: 1 }}>
          <Box px={8} pt={0} pb={0}>
            <NewsTicker />
          </Box>
          <Box px={8} pt={0} pb={6}>
            <ManagerHome
              identity={identity}
              featuredWidgets={featuredWidgets}
              visibleWidgets={visibleWidgets}
              onExpand={expand}
              template={template}
            />
          </Box>
        </Box>
      </AppShell.Main>

      <Modal
        opened={searchOpen}
        onClose={closeSearch}
        title="Smart Search"
        size="xl"
        centered
        radius="lg"
      >
        <SmartSearchPanel
          autofocus
          availableWidgets={visibleWidgets.map((w) => ({
            id: w.id,
            title: w.title,
            desc: w.description ?? "Open this dashboard tool",
          }))}
          onOpenWidget={(id) => {
            closeSearch();
            expand(id);
          }}
        />
      </Modal>

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
  identity,
  featuredWidgets,
  visibleWidgets,
  onExpand,
  template,
}: {
  identity?: ReturnType<typeof useIdentity>["identity"];
  featuredWidgets: WidgetDefinition[];
  visibleWidgets: WidgetDefinition[];
  onExpand: (id: string) => void;
  template: DashboardTemplate;
}) {
  const monitoringWidgets = featuredWidgets.filter((w) => w.id !== "my-day");
  const highlightedWidgets =
    template === "learning"
      ? monitoringWidgets.slice(0, 2)
      : template === "operations"
        ? monitoringWidgets.slice(0, 3)
        : monitoringWidgets;

  const visibleIds = new Set(visibleWidgets.map((w) => w.id));
  const filteredGroups = MANAGER_QUICK_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (!visibleIds.has(item.id)) return false;
      if (
        identity?.role !== "manager" &&
        group.label === "Monitoring & Operations" &&
        ["logic-monitor", "velocloud-api"].includes(item.id)
      ) {
        return false;
      }
      return true;
    }),
  })).filter((group) => group.items.length > 0);

  const coreOperationsGroup = filteredGroups.find((group) => group.label === "Core Operations");
  const troubleshootingGroup = filteredGroups.find((group) => group.label === "Troubleshooting Agents");
  const teamManagementGroup = filteredGroups.find((group) => group.label === "Team Management");
  const monitoringOpsGroup = filteredGroups.find((group) => group.label === "Monitoring & Operations");
  const adminUtilitiesGroup = filteredGroups.find((group) => group.label === "Admin & Utilities");
  const remainingGroups = filteredGroups.filter(
    (group) => ![
      "Core Operations",
      "Troubleshooting Agents",
      "Team Management",
      "Monitoring & Operations",
      "Admin & Utilities",
    ].includes(group.label),
  );

  return (
    <Stack gap={6}>
      <Grid gutter={6} align="flex-start">
        <Grid.Col span={{ base: 12, xl: 3 }}>
          <Card
            withBorder
            radius="xl"
            p="xs"
            style={{
              borderTop: "2px solid var(--mantine-color-appdirect-6)",
              background: "linear-gradient(180deg, color-mix(in srgb, var(--mantine-color-appdirect-9) 7%, var(--mantine-color-body)) 0%, color-mix(in srgb, var(--mantine-color-appdirect-9) 3%, var(--mantine-color-body)) 100%)",
              boxShadow: "0 14px 34px rgba(3, 10, 24, 0.18)",
            }}
          >
            <Group gap={6} mb="xs">
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

        <Grid.Col span={{ base: 12, xl: 9 }}>
          <Grid gutter={6} align="flex-start">
            <Grid.Col span={{ base: 12, lg: 4 }}>
              <Stack gap={6}>
                {highlightedWidgets.length > 0 && (
                  <Card
                    withBorder
                    radius="xl"
                    p="xs"
                    style={{
                      background: "linear-gradient(180deg, color-mix(in srgb, var(--mantine-color-white) 4%, var(--mantine-color-body)) 0%, color-mix(in srgb, var(--mantine-color-white) 1%, var(--mantine-color-body)) 100%)",
                      boxShadow: "0 14px 34px rgba(3, 10, 24, 0.14)",
                    }}
                  >
                    <Group justify="space-between" align="center" mb="xs">
                      <Text
                        size="xs"
                        fw={700}
                        tt="uppercase"
                        c="dimmed"
                        style={{ letterSpacing: "0.08em" }}
                      >
                        Team Overview
                      </Text>
                      <Badge variant="light" color="gray" radius="sm">
                        {monitoringWidgets.length} live
                      </Badge>
                    </Group>
                    <Stack gap="xs">
                      {monitoringWidgets.map((w) => {
                        const Tile = w.Tile;
                        return (
                          <ErrorBoundary key={w.id} label={w.title} compact>
                            <Tile onExpand={() => onExpand(w.id)} />
                          </ErrorBoundary>
                        );
                      })}
                    </Stack>
                  </Card>
                )}

                {teamManagementGroup && (
                  <ManagerQuickLaunchSection
                    label={teamManagementGroup.label}
                    items={teamManagementGroup.items}
                    onExpand={onExpand}
                    cols={{ base: 1, sm: 2 }}
                    compact
                  />
                )}

                {adminUtilitiesGroup && (
                  <ManagerQuickLaunchSection
                    label={adminUtilitiesGroup.label}
                    items={adminUtilitiesGroup.items}
                    onExpand={onExpand}
                    cols={{ base: 1, sm: 1 }}
                    compact
                  />
                )}
              </Stack>
            </Grid.Col>

            <Grid.Col span={{ base: 12, lg: 8 }}>
              <Stack gap={6}>
                <Grid gutter={6} align="flex-start">
                  {coreOperationsGroup && (
                    <Grid.Col span={{ base: 12, md: troubleshootingGroup ? 6 : 12 }}>
                      <ManagerQuickLaunchSection
                        label={coreOperationsGroup.label}
                        items={coreOperationsGroup.items}
                        onExpand={onExpand}
                        cols={{ base: 1, sm: 1 }}
                        featured
                        compact
                      />
                    </Grid.Col>
                  )}

                  {troubleshootingGroup && (
                    <Grid.Col span={{ base: 12, md: coreOperationsGroup ? 6 : 12 }}>
                      <ManagerQuickLaunchSection
                        label={troubleshootingGroup.label}
                        items={troubleshootingGroup.items}
                        onExpand={onExpand}
                        cols={{ base: 1, sm: 1, xl: 1 }}
                        compact
                      />
                    </Grid.Col>
                  )}
                </Grid>

                {monitoringOpsGroup && (
                  <ManagerQuickLaunchSection
                    label={monitoringOpsGroup.label}
                    items={monitoringOpsGroup.items}
                    onExpand={onExpand}
                    cols={{ base: 1, sm: 2 }}
                    compact
                  />
                )}

                {remainingGroups.map((group) => (
                  <ManagerQuickLaunchSection
                    key={group.label}
                    label={group.label}
                    items={group.items}
                    onExpand={onExpand}
                    cols={group.items.length <= 2 ? { base: 1, sm: 2 } : { base: 1, sm: 2, xl: 3 }}
                    compact
                  />
                ))}
              </Stack>
            </Grid.Col>
          </Grid>
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
    label: "Core Operations",
    items: [
      { id: "email-assistant",              emoji: "✉️", label: "NOC Email Assistant",         desc: "Draft, polish, compare, and QA emails", color: "teal" },
      { id: "ticket-summary",               emoji: "📄", label: "Ticket Summary",              desc: "Summarize tickets",                     color: "indigo" },
      { id: "shift-checklist",              emoji: "🔄", label: "Shift Handover Checklist",    desc: "Structured handover",                   color: "teal" },
      { id: "kb-gap-finder",                emoji: "📘", label: "Knowledge Base",              desc: "Runbooks & missing docs",               color: "indigo" },
      { id: "qs-escalations",               emoji: "📋", label: "QS Carrier Escalation Contacts", desc: "Carrier contacts",                    color: "grape" },
      { id: "timezone-helper",              emoji: "🌍", label: "NOC Timezone Helper",         desc: "DST-aware time conversion",             color: "cyan" },
      { id: "maintenance-note-generator",   emoji: "🛠️", label: "Maintenance Note Generator",  desc: "Parse carrier maintenance notices",     color: "indigo" },
    ],
  },
  {
    label: "Troubleshooting Agents",
    items: [
      { id: "noc-troubleshooter",         emoji: "🩺", label: "NOC Troubleshooter",                desc: "AI network troubleshooting",          color: "cyan" },
      { id: "velocloud-troubleshooter",   emoji: "🌐", label: "VeloCloud Troubleshooter",          desc: "Arista SD-WAN troubleshooting",       color: "cyan" },
      { id: "fortigate-troubleshooter",   emoji: "🛡️", label: "Fortigate Troubleshooting Agent",  desc: "FortiGate troubleshooting",           color: "orange" },
      { id: "mobility-troubleshooter",    emoji: "📱", label: "Mobility Troubleshooter",           desc: "Wireless/device troubleshooting",     color: "violet" },
      { id: "piab-troubleshooter",        emoji: "📘", label: "PIAB Troubleshooter",               desc: "PIAB Knowledge Base troubleshooting", color: "indigo" },
    ],
  },
  {
    label: "Team Management",
    items: [
      { id: "performance-tracker", emoji: "📊", label: "Performance",       desc: "Team metrics & audits",       color: "green" },
      { id: "noc-mttr-report",     emoji: "⏱️", label: "NOC MTTR Report",   desc: "Upload MTTR Excel and trend by month", color: "orange" },
      { id: "wfh",                 emoji: "🏠", label: "WFH Requests",      desc: "Review & approve WFH",        color: "appdirect" },
      { id: "training-updates",    emoji: "🎓", label: "Training Hub",      desc: "Requests, sessions, progress", color: "blue" },
      { id: "attendance-tracker",  emoji: "🕒", label: "Attendance & Reminders", desc: "Punches + reminder counts", color: "orange" },
      { id: "ticket-rebalancer",   emoji: "🔀", label: "Ticket Rebalancer", desc: "Balance team ticket load",     color: "grape" },
      { id: "meeting-notes",       emoji: "📒", label: "Meeting Notes",     desc: "1:1 and team notebooks",      color: "grape" },
      { id: "kudos-board",         emoji: "⭐", label: "Kudos Board",       desc: "Peer recognition",             color: "yellow" },
      { id: "enhancement-tracker", emoji: "💡", label: "Enhancement Tracker", desc: "Ideas, approvals, and status", color: "yellow" },
      { id: "work-allotment-generator", emoji: "📋", label: "Work Allotment Generator", desc: "Generate NOC shift assignments", color: "indigo" },
    ],
  },
  {
    label: "Monitoring & Operations",
    items: [
      { id: "logic-monitor",            emoji: "🔔", label: "LogicMonitor",             desc: "Alerts & alert analyzer",              color: "red" },
      { id: "velocloud-api",            emoji: "🌐", label: "VeloCloud API",            desc: "SD-WAN alerts & link status",          color: "cyan" },
      { id: "zoom-call-metrics",        emoji: "📈", label: "Zoom Call Metrics",        desc: "Queue call data",                      color: "green" },
      { id: "data-health",              emoji: "🗄️", label: "Data Health",              desc: "App data table counts",                color: "orange" },
      { id: "ticket-audit",             emoji: "🔍", label: "Ticket Audit",             desc: "AI-powered QA audits",                 color: "pink" },
      { id: "performance-discussions",  emoji: "🗓️", label: "Half-Yearly Discussions", desc: "Manager performance discussion records", color: "red" },
      { id: "building-apps-agents",     emoji: "🧩", label: "Building Apps / Agents",    desc: "Decision-ready intake wizard",        color: "blue" },
    ],
  },
  {
    label: "Admin & Utilities",
    items: [
      { id: "access-control",      emoji: "🛡️", label: "Access Control",    desc: "Manage roles & access",       color: "red" },
      { id: "app-usage",           emoji: "📉", label: "App Usage",         desc: "Tool adoption & DAU",         color: "teal" },
    ],
  },
];

function ManagerQuickLaunchSection({
  label,
  items,
  onExpand,
  cols = { base: 1, sm: 2 },
  featured = false,
  compact = false,
}: {
  label: string;
  items: Array<{ id: string; emoji: string; label: string; desc: string; color: string }>;
  onExpand: (id: string) => void;
  cols?: { base: number; sm?: number; xl?: number };
  featured?: boolean;
  compact?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <Card
      withBorder
      radius="xl"
      p="xs"
      style={{
        background: featured
          ? "linear-gradient(180deg, color-mix(in srgb, var(--mantine-color-appdirect-9) 6%, var(--mantine-color-body)) 0%, color-mix(in srgb, var(--mantine-color-appdirect-9) 2%, var(--mantine-color-body)) 100%)"
          : "linear-gradient(180deg, color-mix(in srgb, var(--mantine-color-white) 3%, var(--mantine-color-body)) 0%, color-mix(in srgb, var(--mantine-color-white) 1%, var(--mantine-color-body)) 100%)",
        boxShadow: featured
          ? "0 14px 34px rgba(3, 10, 24, 0.16)"
          : "0 12px 28px rgba(3, 10, 24, 0.12)",
      }}
    >
      <Group justify="space-between" align="center" mb={compact ? "xs" : "sm"}>
        <Text
          size="xs"
          fw={700}
          tt="uppercase"
          c={featured ? "appdirect.5" : "dimmed"}
          style={{ letterSpacing: "0.08em" }}
        >
          {label}
        </Text>
        <Badge variant="light" color={featured ? "appdirect" : "gray"} radius="sm" size="sm">
          {items.length}
        </Badge>
      </Group>

      <SimpleGrid cols={cols} spacing="xs" verticalSpacing="xs">
        {items.map((item) => (
          <UnstyledButton key={item.id} onClick={() => onExpand(item.id)} style={{ width: "100%" }}>
            <Card
              withBorder
              radius="lg"
              p="xs"
              className="tech-nav-button"
              style={{
                cursor: "pointer",
                transition: "transform 160ms ease, border-color 160ms ease, background 160ms ease, box-shadow 160ms ease",
                position: "relative",
                overflow: "hidden",
                minHeight: compact ? 60 : 74,
                background: "color-mix(in srgb, var(--mantine-color-white) 2%, var(--mantine-color-body))",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
              }}
            >
              <Box
                style={{
                  position: "absolute",
                  top: 10,
                  left: 10,
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: `var(--mantine-color-${item.color}-6)`,
                  opacity: 0.95,
                }}
              />
              <Group gap={compact ? 6 : "xs"} wrap="nowrap" align="flex-start">
                <ThemeIcon
                  size={compact ? 28 : 34}
                  radius="md"
                  variant="light"
                  color={item.color}
                  style={{ flexShrink: 0, marginTop: 2 }}
                >
                  <Text size={compact ? "sm" : "lg"} style={{ lineHeight: 1 }}>{item.emoji}</Text>
                </ThemeIcon>
                <Box style={{ minWidth: 0, paddingRight: 4 }}>
                  <Text size="xs" fw={600} c="bright" lineClamp={compact ? 1 : 2} style={{ lineHeight: 1.2 }}>
                    {item.label}
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={1} mt={1} style={{ lineHeight: 1.2 }}>
                    {item.desc}
                  </Text>
                </Box>
              </Group>
            </Card>
          </UnstyledButton>
        ))}
      </SimpleGrid>
    </Card>
  );
}


