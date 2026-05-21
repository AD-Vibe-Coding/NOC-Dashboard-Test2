/**
 * TechDashboard — the focused, personal view for Tier 1/2/3 techs.
 *
 * Layout philosophy:
 *   - Top: Welcome banner + performance hero (the stuff they care about most)
 *   - Middle: Quick-action nav buttons organized by workflow
 *   - Clean, scannable — every click leads to a full widget view
 *
 * No sidebar. No clutter. Focused on getting the tech to the right tool fast.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Card,
  Container,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconActivity,
  IconActivityHeartbeat,
  IconAddressBook,
  IconArrowLeft,
  IconChartArea,
  IconClipboardText,
  IconCoffee,
  IconDeviceMobileMessage,
  IconFileText,
  IconHeadset,
  IconHome,
  IconMail,
  IconMailForward,
  IconMoon,
  IconReportAnalytics,
  IconSearch,
  IconSun,
} from "@tabler/icons-react";
import { WIDGETS } from "./widgets/registry";
import { IdentityBadge } from "./widgets/IdentityBadge";
import { NewsTicker } from "./widgets/NewsTicker";
import { BrandLogo } from "./widgets/BrandLogo";
import { useIdentity } from "./lib/identity";
import { canAccess, ROLE_COLORS, ROLE_LABELS } from "./lib/roles";
import { resolveTeamMember } from "./widgets/PerformanceTracker/team";

// AppDirect brand colors
const APPDIRECT_BRAND_PRIMARY = "#006080";
const APPDIRECT_BRAND_ACCENT = "#0080a6";

// ---------------------------------------------------------------------------
// Navigation structure — what the tech sees on their home screen
// ---------------------------------------------------------------------------

interface NavItem {
  id: string;          // widget id (for expand)
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  color: string;       // Mantine color
  description: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: "My Work",
    items: [
      {
        id: "my-day",
        label: "My Day",
        icon: IconActivity,
        color: "indigo",
        description: "Today's tickets & calls",
      },
      {
        id: "performance-tracker",
        label: "My Metrics",
        icon: IconReportAnalytics,
        color: "green",
        description: "Performance & disputes",
      },
      {
        id: "break-tracker",
        label: "Breaks",
        icon: IconCoffee,
        color: "orange",
        description: "Start & track breaks",
      },
    ],
  },
  {
    title: "Queue & Monitoring",
    items: [
      {
        id: "zoom-queue",
        label: "Zoom Queue",
        icon: IconHeadset,
        color: "appdirect",
        description: "Live call queue",
      },
      {
        id: "logic-monitor",
        label: "LogicMonitor",
        icon: IconChartArea,
        color: "red",
        description: "Alerts & device health",
      },
    ],
  },
  {
    title: "AI Tools",
    items: [
      {
        id: "smart-search",
        label: "Smart Search",
        icon: IconSearch,
        color: "indigo",
        description: "Search across everything",
      },
      {
        id: "ticket-summary",
        label: "Ticket Summary",
        icon: IconFileText,
        color: "indigo",
        description: "Summarize .mhtml tickets",
      },
      {
        id: "noc-troubleshooter",
        label: "NOC Troubleshooter",
        icon: IconActivityHeartbeat,
        color: "cyan",
        description: "Network & circuit help",
      },
      {
        id: "mobility-troubleshooter",
        label: "Mobility Troubleshooter",
        icon: IconDeviceMobileMessage,
        color: "violet",
        description: "Wireless & device help",
      },
    ],
  },
  {
    title: "Communication",
    items: [
      {
        id: "escalation-email",
        label: "Escalation Email",
        icon: IconMail,
        color: "teal",
        description: "Draft ESC-MGR alerts",
      },
      {
        id: "email-polisher",
        label: "Email Polisher",
        icon: IconMailForward,
        color: "lime",
        description: "Polish any draft email",
      },
      {
        id: "shift-handover",
        label: "Shift Handover",
        icon: IconClipboardText,
        color: "blue",
        description: "Create handover message",
      },
      {
        id: "qs-escalations",
        label: "Escalation Contacts",
        icon: IconAddressBook,
        color: "grape",
        description: "Carrier contact lists",
      },
    ],
  },
  {
    title: "Requests",
    items: [
      {
        id: "wfh",
        label: "WFH Request",
        icon: IconHome,
        color: "appdirect",
        description: "Apply for work-from-home",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TechDashboard() {
  const { identity } = useIdentity();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light", {
    getInitialValueInEffect: true,
  });
  const isDark = computedColorScheme === "dark";
  const toggleColorScheme = () => setColorScheme(isDark ? "light" : "dark");

  const canonicalSelf = identity ? resolveTeamMember(identity.name) : null;
  const displayName = canonicalSelf ?? identity?.name ?? "Tech";
  const firstName = displayName.split(" ")[0];

  const visibleWidgets = useMemo(() => {
    if (!identity) return WIDGETS;
    return WIDGETS.filter((w) => canAccess(identity.role, w.roles));
  }, [identity]);

  // Hash-based routing
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

  function expand(id: string) {
    window.location.hash = `#/${id}`;
  }
  function collapse() {
    window.location.hash = "";
  }

  const expanded = expandedId
    ? WIDGETS.find((w) => w.id === expandedId)
    : null;

  const accentColor = identity ? ROLE_COLORS[identity.role] : "appdirect";

  return (
    <AppShell header={{ height: 68 }} padding={0}>
      {/* ---- Header ---- */}
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
        {/* Brand strip */}
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
        {/* Role accent line */}
        <Box
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 1,
            background: `linear-gradient(90deg, transparent 0%, var(--mantine-color-${accentColor}-7) 30%, var(--mantine-color-${accentColor}-6) 70%, transparent 100%)`,
            opacity: 0.7,
            pointerEvents: "none",
          }}
        />
        <Container size="xl" h="100%" px="md">
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
              {expanded && (
                <Tooltip label="Back to dashboard">
                  <ActionIcon
                    variant="default"
                    size="lg"
                    radius="md"
                    onClick={collapse}
                  >
                    <IconArrowLeft size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
              <Box
                style={{
                  position: "relative",
                  filter: `drop-shadow(0 0 16px var(--mantine-color-${accentColor}-6))`,
                  cursor: expanded ? "pointer" : undefined,
                }}
                onClick={expanded ? collapse : undefined}
              >
                <BrandLogo
                  size={32}
                  glowColor={`var(--mantine-color-${accentColor}-6)`}
                />
              </Box>
              <Box style={{ minWidth: 0 }}>
                <Group gap={8} align="center">
                  <Text
                    fw={600}
                    c="bright"
                    style={{ fontSize: 16, letterSpacing: "-0.01em" }}
                  >
                    {expanded ? expanded.title : `${displayName}'s Dashboard`}
                  </Text>
                  {!expanded && (
                    <Box
                      className="dashboard-status-pulse"
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: `var(--mantine-color-${accentColor}-5)`,
                        flexShrink: 0,
                      }}
                    />
                  )}
                </Group>
                <Text size="xs" c="dimmed" mt={1}>
                  {expanded
                    ? expanded.description
                    : `${ROLE_LABELS[identity?.role ?? "tier1"]} · vCom NOC Operations`}
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
                >
                  {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
                </ActionIcon>
              </Tooltip>
              <IdentityBadge />
            </Group>
          </Group>
        </Container>
      </AppShell.Header>

      {/* ---- Main content ---- */}
      <AppShell.Main
        style={{
          background: isDark
            ? "linear-gradient(180deg, #0b111e 0%, #0e1626 100%)"
            : "linear-gradient(180deg, #f4f8fb 0%, rgba(204, 230, 239,0.40) 100%)",
          minHeight: "100vh",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Subtle ambient glow */}
        <Box
          style={{
            position: "fixed",
            top: "-15%",
            left: "10%",
            width: "55vw",
            height: "55vh",
            background: `radial-gradient(circle at center, ${
              isDark ? "rgba(0, 96, 128,0.18)" : "rgba(0, 96, 128,0.06)"
            }, transparent 60%)`,
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
            <expanded.Full />
          ) : (
            <TechHome
              firstName={firstName}
              identity={identity}
              accentColor={accentColor}
              visibleWidgetIds={new Set(visibleWidgets.map((w) => w.id))}
              onExpand={expand}
            />
          )}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Home — the dashboard grid
// ---------------------------------------------------------------------------

function TechHome({
  firstName,
  identity,
  accentColor,
  visibleWidgetIds,
  onExpand,
}: {
  firstName: string;
  identity: ReturnType<typeof useIdentity>["identity"];
  accentColor: string;
  visibleWidgetIds: Set<string>;
  onExpand: (id: string) => void;
}) {
  const role = identity?.role ?? "tier1";

  // Greeting based on time of day
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Filter nav sections to only include visible widgets
  const sections = NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((item) => visibleWidgetIds.has(item.id)),
  })).filter((s) => s.items.length > 0);

  return (
    <Stack gap="lg">
      {/* ---- Welcome banner ---- */}
      <Card
        withBorder
        radius="lg"
        p="lg"
        style={{
          background: `linear-gradient(135deg, color-mix(in srgb, var(--mantine-color-${accentColor}-6) 8%, var(--mantine-color-body)) 0%, var(--mantine-color-body) 100%)`,
          borderColor: `color-mix(in srgb, var(--mantine-color-${accentColor}-6) 25%, var(--mantine-color-default-border))`,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <Box
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            background: `var(--mantine-color-${accentColor}-6)`,
          }}
        />
        <Group justify="space-between" align="center" wrap="wrap">
          <Box>
            <Text size="sm" c="dimmed" fw={500}>
              {greeting},
            </Text>
            <Title order={2} c="bright" style={{ letterSpacing: "-0.02em" }}>
              {firstName}
            </Title>
          </Box>
          <Group gap="sm">
            <Badge size="lg" variant="light" color={accentColor} radius="md">
              {ROLE_LABELS[role]}
            </Badge>
            <Text size="sm" c="dimmed" ff="monospace">
              {new Date().toLocaleDateString([], {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </Text>
          </Group>
        </Group>
      </Card>

      {/* ---- News ticker ---- */}
      <NewsTicker />

      {/* ---- Navigation sections ---- */}
      {sections.map((section) => (
        <Box key={section.title}>
          <Text
            size="xs"
            fw={700}
            c="dimmed"
            tt="uppercase"
            mb="sm"
            style={{ letterSpacing: "0.08em", paddingLeft: 4 }}
          >
            {section.title}
          </Text>
          <SimpleGrid
            cols={{ base: 1, xs: 2, sm: 3, md: section.items.length <= 3 ? section.items.length : 4 }}
            spacing="md"
          >
            {section.items.map((item) => (
              <NavButton key={item.id} item={item} onExpand={onExpand} />
            ))}
          </SimpleGrid>
        </Box>
      ))}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Navigation button — clean, card-style button for each tool
// ---------------------------------------------------------------------------

function NavButton({
  item,
  onExpand,
}: {
  item: NavItem;
  onExpand: (id: string) => void;
}) {
  const accentVar = `var(--mantine-color-${item.color}-6)`;

  return (
    <UnstyledButton
      onClick={() => onExpand(item.id)}
      style={{ width: "100%" }}
    >
      <Card
        withBorder
        radius="md"
        p="md"
        h="100%"
        style={{
          cursor: "pointer",
          transition: "all 150ms ease",
          position: "relative",
          overflow: "hidden",
        }}
        className="tech-nav-button"
      >
        {/* Top accent stripe */}
        <Box
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: accentVar,
            opacity: 0.7,
          }}
        />
        <Group gap="md" wrap="nowrap" align="flex-start">
          <ThemeIcon
            size="lg"
            radius="md"
            variant="light"
            color={item.color}
            style={{
              flexShrink: 0,
              filter: `drop-shadow(0 0 8px color-mix(in srgb, ${accentVar} 30%, transparent))`,
            }}
          >
            <item.icon size={20} />
          </ThemeIcon>
          <Box style={{ minWidth: 0 }}>
            <Text size="sm" fw={600} c="bright" style={{ lineHeight: 1.3 }}>
              {item.label}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={2} mt={2}>
              {item.description}
            </Text>
          </Box>
        </Group>
      </Card>
    </UnstyledButton>
  );
}
