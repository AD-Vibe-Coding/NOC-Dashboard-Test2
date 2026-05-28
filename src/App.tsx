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
  Container,
  Grid,
  Group,
  Loader,
  Text,
  Breadcrumbs,
  Anchor,
  ScrollArea,
  SimpleGrid,
  Stack,
  ThemeIcon,
  Badge,
  Tooltip,
  Burger,
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
  ROLE_LABELS,
  ROLE_SHORT_LABELS,
} from "./lib/roles";
import TechDashboard from "./TechDashboard";
import SignInPage from "./SignInPage";
import { ManagerDayWidget } from "./widgets/ManagerDay";
import { WindowManagerProvider, useWindowManager } from "./lib/window-manager";
import { FloatingWindow } from "./components/FloatingWindow";
import { Taskbar } from "./components/Taskbar";

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
  const { windows, openWindow } = useWindowManager();
  const [navOpened, { toggle: toggleNav, close: closeNav }] =
    useDisclosure(false);
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
    // Handle deep-link hashes by opening the widget as a window
    const fromHash = () => {
      const h = window.location.hash.replace(/^#\/?/, "");
      if (!h) return;
      const widget = WIDGETS.find((w) => w.id === h);
      if (!widget) return;
      if (identity && !canAccess(identity.role, widget.roles)) {
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

  // Techs (Tier 1/2/3) → streamlined personal dashboard
  if (identity.role !== "manager") {
    return <TechDashboard />;
  }

  // Managers → full admin dashboard below
  function expand(id: string) {
    const w = WIDGETS.find((x) => x.id === id);
    if (!w) return;
    trackWidgetOpen(id, w.title);
    openWindow(w);
    closeNav();
  }

  // Role-tinted accent under the header. Falls back to the AppDirect brand teal
  // when there's no identity yet.
  const accentColor = identity ? ROLE_COLORS[identity.role] : "appdirect";
  const accentGradient = identity
    ? `linear-gradient(90deg, transparent 0%, var(--mantine-color-${accentColor}-7) 30%, var(--mantine-color-${accentColor}-6) 70%, transparent 100%)`
    : "linear-gradient(90deg, transparent 0%, rgba(0, 96, 128,0.65) 30%, rgba(0, 128, 166,0.65) 70%, transparent 100%)";

  return (
    <AppShell
      header={{ height: 68 }}
      navbar={{ width: 260, breakpoint: "sm", collapsed: { mobile: !navOpened } }}
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
        <Container size="xl" h="100%" px="md">
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Group gap="md" style={{ minWidth: 0 }} wrap="nowrap">
              <Burger
                opened={navOpened}
                onClick={toggleNav}
                hiddenFrom="sm"
                size="sm"
              />
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
        </Container>
      </AppShell.Header>

      <AppShell.Navbar
        p={0}
        style={{
          background: isDark
            ? "linear-gradient(180deg, #0e1626 0%, rgba(0, 96, 128,0.25) 100%)"
            : "linear-gradient(180deg, #f4f8fb 0%, rgba(204, 230, 239,0.30) 100%)",
          borderRight: isDark
            ? "1px solid rgba(148,197,221,0.10)"
            : "1px solid rgba(0, 96, 128,0.10)",
        }}
      >
        <ScrollArea style={{ height: "100%" }} scrollbarSize={6}>
          <Stack gap={2} p="md">
            {/* Dashboard "home" link */}
            <SidebarItem
              icon={IconLayoutDashboard}
              iconColor="appdirect"
              label="Dashboard"
              description="Your shift overview"
              active={false}
              onClick={() => {}}
            />

            <Text
              size="xs"
              fw={700}
              c="dimmed"
              tt="uppercase"
              mt="lg"
              mb={6}
              style={{ letterSpacing: "0.08em", paddingLeft: 6 }}
            >
              Tools
            </Text>

            {sidebarWidgets.map((widget) => {
              const isOpen = windows.some((w) => w.id === widget.id);
              const isMinimized = windows.find((w) => w.id === widget.id)?.minimized;
              return (
                <SidebarItem
                  key={widget.id}
                  icon={widget.icon}
                  iconColor={widget.iconColor}
                  label={widget.title}
                  description={widget.description}
                  role={widget.roles?.[0]}
                  active={isOpen && !isMinimized}
                  badge={isOpen ? (isMinimized ? "minimized" : "open") : undefined}
                  onClick={() => expand(widget.id)}
                />
              );
            })}
          </Stack>
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main
        style={{
          background:
            "linear-gradient(180deg, #f4f8fb 0%, rgba(204, 230, 239,0.40) 100%)",
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
        <Container
          size="xl"
          py="lg"
          px="md"
          style={{ position: "relative", zIndex: 1 }}
        >
          <ManagerHome
            featuredWidgets={featuredWidgets}
            onExpand={expand}
          />
        </Container>
      </AppShell.Main>

      {/* ── Floating Windows ── */}
      {windows.map((win) => (
        <FloatingWindow key={win.id} win={win} />
      ))}

      {/* ── Taskbar ── */}
      <Taskbar />

    </AppShell>
  );
}

// ── Manager Home ─────────────────────────────────────────────────────────────

function ManagerHome({
  featuredWidgets,
  onExpand,
}: {
  identity?: ReturnType<typeof useIdentity>["identity"];
  featuredWidgets: WidgetDefinition[];
  onExpand: (id: string) => void;
}) {
  // Separate "my-day" (WorkActivity) from the rest — managers get ManagerDay instead
  const monitoringWidgets = featuredWidgets.filter((w) => w.id !== "my-day");

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
            {monitoringWidgets.length > 0 && (
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
                        <Tile onExpand={() => onExpand(w.id)} />
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
    label: "Team Management",
    items: [
      { id: "performance-tracker", emoji: "📊", label: "Performance",   desc: "Team metrics & audits",    color: "green"    },
      { id: "ticket-audit",        emoji: "🔍", label: "Ticket Audit",  desc: "AI-powered QA audits",     color: "pink"     },
      { id: "break-tracker",       emoji: "☕", label: "Breaks",        desc: "Team break log",           color: "orange"   },
      { id: "wfh",                 emoji: "🏠", label: "WFH Requests",  desc: "Review & approve WFH",     color: "appdirect"},
    ],
  },
  {
    label: "Monitoring",
    items: [
      { id: "logic-monitor",       emoji: "🔔", label: "LogicMonitor",  desc: "Alerts & alert analyzer",  color: "red"      },
      { id: "zoom-queue",          emoji: "📞", label: "Zoom Queue",    desc: "Live call queue",          color: "appdirect"},
      { id: "qs-escalations",      emoji: "📋", label: "Escalations",   desc: "Carrier contacts",         color: "grape"    },
    ],
  },
  {
    label: "AI Tools",
    items: [
      { id: "ticket-summary",      emoji: "📄", label: "Ticket Summary",desc: "Summarize tickets",        color: "indigo"   },
      { id: "escalation-email",    emoji: "✉️",  label: "ESC Email",     desc: "Draft escalation alerts",  color: "teal"     },
      { id: "shift-handover",      emoji: "🔄", label: "Handover",      desc: "Create shift handover",    color: "blue"     },
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



/* -------------------------------------------------------------------------- */
/*                                Sidebar item                                */
/* -------------------------------------------------------------------------- */

function SidebarItem({
  icon: Icon,
  iconColor,
  label,
  description,
  active,
  onClick,
  role,
  badge,
}: {
  icon: React.ComponentType<{ size?: number }>;
  iconColor: string;
  label: string;
  description?: string;
  active?: boolean;
  onClick: () => void;
  role?: string;
  badge?: "open" | "minimized";
}) {
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="sidebar-item"
      data-active={active || undefined}
      style={{
        cursor: "pointer",
        padding: "8px 10px",
        borderRadius: 10,
        border: active
          ? `1px solid color-mix(in srgb, var(--mantine-color-${iconColor}-6) 45%, transparent)`
          : "1px solid transparent",
        background: active
          ? `linear-gradient(135deg, color-mix(in srgb, var(--mantine-color-${iconColor}-6) 18%, var(--widget-tile-surface)) 0%, var(--widget-tile-surface) 100%)`
          : "transparent",
        position: "relative",
        transition:
          "background 140ms ease, border-color 140ms ease, transform 140ms ease",
      }}
    >
      {/* Left accent bar when active */}
      {active && (
        <Box
          style={{
            position: "absolute",
            left: -1,
            top: 8,
            bottom: 8,
            width: 3,
            background: `var(--mantine-color-${iconColor}-6)`,
            borderRadius: 2,
          }}
        />
      )}
      <Group wrap="nowrap" gap="sm" align="center">
        <ThemeIcon
          size="md"
          radius="md"
          variant={active ? "filled" : "light"}
          color={iconColor}
        >
          <Icon size={16} />
        </ThemeIcon>
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} wrap="nowrap">
            <Text
              size="sm"
              fw={active ? 700 : 600}
              c="bright"
              truncate
              style={{ lineHeight: 1.2 }}
            >
              {label}
            </Text>
            {badge && (
              <Badge size="xs" variant="dot" color={badge === "open" ? "green" : "yellow"}>
                {badge}
              </Badge>
            )}
            {role && (
              <Tooltip label={`Restricted to ${ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role}`}>
                <Badge
                  size="xs"
                  variant="light"
                  color={ROLE_COLORS[role as keyof typeof ROLE_COLORS] ?? "gray"}
                >
                  {ROLE_SHORT_LABELS[role as keyof typeof ROLE_SHORT_LABELS] ??
                    role}
                </Badge>
              </Tooltip>
            )}
          </Group>
          {description && (
            <Text
              size="xs"
              c="dimmed"
              truncate
              lh={1.25}
              mt={1}
            >
              {description}
            </Text>
          )}
        </Box>
      </Group>
    </Box>
  );
}
