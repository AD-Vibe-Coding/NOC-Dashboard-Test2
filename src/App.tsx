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
import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  AppShell,
  Box,
  Button,
  Center,
  Container,
  Grid,
  Group,
  Loader,
  Text,
  Breadcrumbs,
  Anchor,
  ScrollArea,
  Stack,
  ThemeIcon,
  Badge,
  Tooltip,
  Burger,
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconArrowLeft,
  IconLayoutDashboard,
  IconMoon,
  IconSun,
} from "@tabler/icons-react";
import { WIDGETS } from "./widgets/registry";
import type { WidgetDefinition } from "./widgets/types";
import { SIZE_TO_SPAN } from "./widgets/types";
import { IdentityBadge, IdentityWelcomeCard } from "./widgets/IdentityBadge";
import { NewsTicker } from "./widgets/NewsTicker";
import { BrandLogo } from "./widgets/BrandLogo";
import { useIdentity } from "./lib/identity";
import {
  canAccess,
  ROLE_COLORS,
  ROLE_LABELS,
  ROLE_SHORT_LABELS,
} from "./lib/roles";

// AppDirect brand colors. Primary is #006080 (deep petrol teal,
// sourced from AppDirect's Base design-system docs); the lighter mid
// teal #0080a6 is used for the bright accent in the brand strip.
const APPDIRECT_BRAND_PRIMARY = "#006080";
const APPDIRECT_BRAND_ACCENT = "#0080a6";

export default function App() {
  const { identity, loading: identityLoading } = useIdentity();
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
    const fromHash = () => {
      const h = window.location.hash.replace(/^#\/?/, "");
      if (!h) {
        setExpandedId(null);
        return;
      }
      const widget = WIDGETS.find((w) => w.id === h);
      if (!widget) {
        setExpandedId(null);
        return;
      }
      if (identity && !canAccess(identity.role, widget.roles)) {
        window.location.hash = "";
        setExpandedId(null);
        return;
      }
      setExpandedId(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
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

  function expand(id: string) {
    window.location.hash = `#/${id}`;
    closeNav();
  }
  function collapse() {
    window.location.hash = "";
  }

  const expanded = expandedId ? WIDGETS.find((w) => w.id === expandedId) : null;

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
                      onClick={collapse}
                      fw={600}
                      c={expanded ? "dimmed" : "bright"}
                      underline="never"
                      style={{ fontSize: 16, letterSpacing: "-0.01em" }}
                    >
                      vCom NOC Operations Dashboard
                    </Anchor>
                    {expanded && (
                      <Text
                        c="bright"
                        fw={600}
                        size="md"
                        style={{ letterSpacing: "-0.01em" }}
                      >
                        {expanded.title}
                      </Text>
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
                  {expanded
                    ? expanded.description
                    : `${featuredWidgets.length} on your shift · ${sidebarWidgets.length} tool${
                        sidebarWidgets.length === 1 ? "" : "s"
                      }`}
                </Text>
              </Box>
            </Group>
            <Group gap="sm" wrap="nowrap">
              {expanded && (
                <Button
                  leftSection={<IconArrowLeft size={14} />}
                  variant="default"
                  size="xs"
                  onClick={collapse}
                  visibleFrom="sm"
                >
                  Dashboard
                </Button>
              )}
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
              active={!expanded}
              onClick={collapse}
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

            {sidebarWidgets.map((widget) => (
              <SidebarItem
                key={widget.id}
                icon={widget.icon}
                iconColor={widget.iconColor}
                label={widget.title}
                description={widget.description}
                role={widget.roles?.[0]}
                active={expandedId === widget.id}
                onClick={() => expand(widget.id)}
              />
            ))}
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
          {expanded ? (
            <ExpandedView WidgetFull={expanded.Full} />
          ) : (
            <>
              <IdentityWelcomeCard />
              {identity && <NewsTicker />}
              <FeaturedGrid widgets={featuredWidgets} onExpand={expand} />
            </>
          )}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}

function FeaturedGrid({
  widgets,
  onExpand,
}: {
  widgets: WidgetDefinition[];
  onExpand: (id: string) => void;
}) {
  if (widgets.length === 0) return null;

  return (
    <Box>
      {/* Section banner — sits on a real tile-surface card with a left accent
          bar so the heading stands out from the page background in BOTH light
          and dark modes (otherwise the page tint blends into bright/dimmed
          text colors). */}
      <Box
        mb="md"
        py="md"
        px="lg"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--mantine-color-appdirect-6) 10%, var(--widget-tile-surface)) 0%, var(--widget-tile-surface) 100%)",
          border:
            "1px solid color-mix(in srgb, var(--mantine-color-appdirect-6) 25%, var(--widget-tile-border))",
          borderRadius: 12,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Left accent bar */}
        <Box
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            background:
              "linear-gradient(180deg, var(--mantine-color-appdirect-6) 0%, var(--mantine-color-appdirect-8) 100%)",
          }}
        />
        <Group justify="space-between" align="flex-end" wrap="nowrap">
          <Box>
            <Text
              size="xs"
              fw={700}
              c="appdirect.6"
              tt="uppercase"
              style={{ letterSpacing: "0.12em" }}
            >
              Your shift
            </Text>
            <Text
              size="xl"
              fw={700}
              c="bright"
              style={{ letterSpacing: "-0.02em", lineHeight: 1.2 }}
            >
              What's happening right now
            </Text>
          </Box>
        </Group>
      </Box>
      <Grid gutter="lg">
        {widgets.map((widget) => {
          const Tile = widget.Tile;
          const span = SIZE_TO_SPAN[widget.tileSize];
          return (
            <Grid.Col key={widget.id} span={span}>
              <Tile onExpand={() => onExpand(widget.id)} />
            </Grid.Col>
          );
        })}
      </Grid>
    </Box>
  );
}

function ExpandedView({ WidgetFull }: { WidgetFull: React.ComponentType }) {
  return <WidgetFull />;
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
}: {
  icon: React.ComponentType<{ size?: number }>;
  iconColor: string;
  label: string;
  description?: string;
  active?: boolean;
  onClick: () => void;
  role?: string;
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
