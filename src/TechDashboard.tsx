/**
 * TechDashboard — the focused, personal view for Tier 1/2/3 techs.
 *
 * Individual templates are now real layouts: each person can pick a template,
 * drag sections and widgets into a custom order, and hide/show sections.
 */

import { useMemo } from "react";
import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Card,
  Container,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconActivity,
  IconActivityHeartbeat,
  IconAddressBook,
  IconAdjustmentsHorizontal,
  IconChartArea,
  IconCoffee,
  IconClock,
  IconDeviceMobileMessage,
  IconFileText,
  IconGift,
  IconHeadset,
  IconHome,
  IconMail,
  IconMailForward,
  IconMoon,
  IconNotes,
  IconReportAnalytics,
  IconSearch,
  IconStar,
  IconBook,
  IconBulb,
  IconClipboardList,
  IconSun,
  IconWorldPin,
} from "@tabler/icons-react";
import { BrandLogo } from "./widgets/BrandLogo";
import { IdentityBadge } from "./widgets/IdentityBadge";
import { NewsTicker } from "./widgets/NewsTicker";
import { resolveTeamMember } from "./widgets/PerformanceTracker/team";
import { WIDGETS } from "./widgets/registry";
import { DashboardCustomizerDrawer } from "./components/DashboardCustomizerDrawer";
import { DashboardTemplatePicker } from "./components/DashboardTemplatePicker";
import { FloatingWindow } from "./components/FloatingWindow";
import { Taskbar } from "./components/Taskbar";
import {
  type DashboardSectionKey,
  useDashboardPreferences,
} from "./lib/dashboard-preferences";
import { useIdentity } from "./lib/identity";
import { canAccess, ROLE_COLORS, ROLE_LABELS } from "./lib/roles";
import { trackWidgetOpen } from "./lib/track";
import { useTrainingNotifications } from "./lib/training-notifications";
import { useWindowManager } from "./lib/window-manager";

const APPDIRECT_BRAND_PRIMARY = "#006080";
const APPDIRECT_BRAND_ACCENT = "#0080a6";

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  color: string;
  description: string;
  badgeCount?: number;
}

interface NavSection {
  key: DashboardSectionKey;
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    key: "my-work",
    title: "My Work",
    items: [
      { id: "my-day", label: "My Day", icon: IconActivity, color: "indigo", description: "Today's tickets & calls" },
      { id: "meeting-notes", label: "Meeting Notes", icon: IconNotes, color: "grape", description: "OneNote-style individual ..." },
      { id: "performance-tracker", label: "My Metrics", icon: IconReportAnalytics, color: "green", description: "Performance & disputes" },
      { id: "noc-mttr-report", label: "NOC MTTR Report", icon: IconClock, color: "orange", description: "Upload MTTR Excel and trend by month" },
      { id: "break-tracker", label: "Breaks", icon: IconCoffee, color: "orange", description: "Start & track breaks" },
    ],
  },
  {
    key: "queue-monitoring",
    title: "Queue & Monitoring",
    items: [
      { id: "zoom-queue", label: "Zoom Queue", icon: IconHeadset, color: "appdirect", description: "Live call queue" },
      { id: "logic-monitor", label: "LogicMonitor", icon: IconChartArea, color: "red", description: "Alerts & device health" },
    ],
  },
  {
    key: "ai-tools",
    title: "AI Tools",
    items: [
      { id: "smart-search", label: "Smart Search", icon: IconSearch, color: "indigo", description: "Search across everything" },
      { id: "ticket-summary", label: "Ticket Summary", icon: IconFileText, color: "indigo", description: "Summarize .mhtml tickets" },
      { id: "noc-troubleshooter", label: "NOC Troubleshooter", icon: IconActivityHeartbeat, color: "cyan", description: "Network & circuit help" },
      { id: "mobility-troubleshooter", label: "Mobility Troubleshooter", icon: IconDeviceMobileMessage, color: "violet", description: "Wireless & device help" },
      { id: "piab-troubleshooter", label: "PIAB Troubleshooter", icon: IconBook, color: "indigo", description: "PIAB Knowledge Base troubleshooting" },
      { id: "timezone-helper", label: "Timezone Helper", icon: IconWorldPin, color: "cyan", description: "Convert customer time → PST/PT" },
    ],
  },
  {
    key: "communication",
    title: "Communication",
    items: [
      { id: "escalation-email", label: "Escalation Email", icon: IconMail, color: "teal", description: "Draft ESC-MGR alerts" },
      { id: "email-polisher", label: "Email Polisher", icon: IconMailForward, color: "lime", description: "Polish any draft email" },

      { id: "qs-escalations", label: "Escalation Contacts", icon: IconAddressBook, color: "grape", description: "Carrier contact lists" },
    ],
  },
  {
    key: "requests",
    title: "Requests",
    items: [
      { id: "wfh", label: "WFH Request", icon: IconHome, color: "appdirect", description: "Apply for work-from-home" },
      { id: "training-updates", label: "Training Updates", icon: IconFileText, color: "blue", description: "Submit and track training requests" },
    ],
  },
  {
    key: "team",
    title: "Team",
    items: [
      { id: "kudos-board", label: "Kudos Board", icon: IconStar, color: "yellow", description: "Peer recognition & shoutouts" },
      { id: "celebrations-tracker", label: "Celebrations Tracker", icon: IconGift, color: "pink", description: "Birthdays, work anniversaries, and marriage anniversaries" },
      { id: "enhancement-tracker", label: "Enhancement Tracker", icon: IconBulb, color: "yellow", description: "Submit and review team improvement ideas" },
      { id: "shift-checklist", label: "Shift Checklist", icon: IconClipboardList, color: "teal", description: "End-of-shift handover checklist" },
      { id: "kb-gap-finder", label: "KB Gap Finder", icon: IconBook, color: "indigo", description: "Ask questions · Flag missing docs" },
    ],
  },
];

export default function TechDashboard() {
  const { identity } = useIdentity();
  const { currentLayout } = useDashboardPreferences();
  const { windows, openWindow } = useWindowManager();
  const [customizeOpened, { open: openCustomize, close: closeCustomize }] = useDisclosure(false);
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

  const { pendingCount: trainingNotificationCount } = useTrainingNotifications();
  const accentColor = identity ? ROLE_COLORS[identity.role] : "appdirect";

  function expand(id: string) {
    const widget = visibleWidgets.find((w) => w.id === id);
    if (!widget) return;
    trackWidgetOpen(id, widget.title);
    openWindow(widget);
  }

  const visibleSectionMap = useMemo(() => {
    return new Map(
      NAV_SECTIONS.map((section) => {
        const items = section.items
          .map((item) =>
            item.id === "training-updates"
              ? { ...item, badgeCount: trainingNotificationCount }
              : item,
          )
          .filter((item) => visibleWidgets.some((widget) => widget.id === item.id));

        return [section.key, { ...section, items }] as const;
      }).filter((entry) => entry[1].items.length > 0),
    );
  }, [trainingNotificationCount, visibleWidgets]);

  const orderedSections = useMemo(() => {
    return currentLayout.sections
      .map((layoutSection) => {
        const source = visibleSectionMap.get(layoutSection.key);
        if (!source) return null;

        const itemLookup = new Map(source.items.map((item) => [item.id, item]));
        const orderedItems = layoutSection.itemIds
          .map((itemId) => itemLookup.get(itemId))
          .filter((item): item is NavItem => !!item);
        const missingItems = source.items.filter((item) => !layoutSection.itemIds.includes(item.id));

        return {
          key: layoutSection.key,
          title: source.title,
          hidden: layoutSection.hidden,
          items: [...orderedItems, ...missingItems],
        };
      })
      .filter((section): section is { key: DashboardSectionKey; title: string; hidden: boolean; items: NavItem[] } => !!section);
  }, [currentLayout.sections, visibleSectionMap]);

  const visibleSections = orderedSections.filter((section) => !section.hidden && section.items.length > 0);

  return (
    <AppShell header={{ height: 68 }} padding={0}>
      <AppShell.Header
        style={{
          background: isDark ? "rgba(15, 22, 36, 0.78)" : "rgba(255, 255, 255, 0.85)",
          backdropFilter: "blur(16px) saturate(160%)",
          WebkitBackdropFilter: "blur(16px) saturate(160%)",
          borderBottom: isDark ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(15,23,42,0.08)",
          position: "relative",
          zIndex: 100,
        }}
      >
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
              <Box
                style={{
                  position: "relative",
                  filter: `drop-shadow(0 0 16px var(--mantine-color-${accentColor}-6))`,
                }}
              >
                <BrandLogo size={32} glowColor={`var(--mantine-color-${accentColor}-6)`} />
              </Box>
              <Box style={{ minWidth: 0 }}>
                <Group gap={8} align="center">
                  <Text fw={600} c="bright" style={{ fontSize: 16, letterSpacing: "-0.01em" }}>
                    {`${displayName}'s Dashboard`}
                  </Text>
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
                  {windows.length > 0 && (
                    <Badge size="sm" color="appdirect" variant="light">
                      {windows.length} open
                    </Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed" mt={1}>
                  {`${ROLE_LABELS[identity?.role ?? "tier1"]} · Drag and customize your own dashboard layout by template`}
                </Text>
              </Box>
            </Group>
            <Group gap="sm" wrap="nowrap">
              <DashboardTemplatePicker />
              <Tooltip label="Customize layout" withArrow>
                <ActionIcon variant="default" size="lg" radius="md" onClick={openCustomize}>
                  <IconAdjustmentsHorizontal size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={isDark ? "Switch to light mode" : "Switch to dark mode"} withArrow>
                <ActionIcon variant="default" size="lg" radius="md" onClick={toggleColorScheme}>
                  {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
                </ActionIcon>
              </Tooltip>
              <IdentityBadge />
            </Group>
          </Group>
        </Container>
      </AppShell.Header>

      <AppShell.Main
        style={{
          background: isDark ? "var(--dashboard-page-bg-dark)" : "var(--dashboard-page-bg-light)",
          minHeight: "100vh",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <Box
          style={{
            position: "fixed",
            top: "-15%",
            left: "10%",
            width: "55vw",
            height: "55vh",
            background: `radial-gradient(circle at center, ${isDark ? "rgba(0, 96, 128,0.18)" : "rgba(0, 96, 128,0.06)"}, transparent 60%)`,
            pointerEvents: "none",
            zIndex: 0,
            filter: "blur(20px)",
          }}
        />
        <Box className="dot-grid-bg" />

        <Container size="xl" py="lg" px="md" style={{ position: "relative", zIndex: 1, paddingBottom: 72 }}>
          <TechHome
            firstName={firstName}
            identity={identity}
            accentColor={accentColor}
            sections={visibleSections}
            featuredWidgets={visibleWidgets.filter((widget) => ["zoom-queue", "break-tracker"].includes(widget.id))}
            onExpand={expand}
          />
        </Container>
      </AppShell.Main>

      <DashboardCustomizerDrawer opened={customizeOpened} onClose={closeCustomize} sections={orderedSections} />

      {windows.map((win) => (
        <FloatingWindow key={win.id} win={win} />
      ))}

      <Taskbar />
    </AppShell>
  );
}

function TechHome({
  firstName,
  identity,
  accentColor,
  sections,
  featuredWidgets,
  onExpand,
}: {
  firstName: string;
  identity: ReturnType<typeof useIdentity>["identity"];
  accentColor: string;
  sections: Array<{ key: DashboardSectionKey; title: string; hidden: boolean; items: NavItem[] }>;
  featuredWidgets: Array<(typeof WIDGETS)[number]>;
  onExpand: (id: string) => void;
}) {
  const role = identity?.role ?? "tier1";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <Stack gap="lg">
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
            <Text size="sm" c="dimmed" fw={500}>{greeting},</Text>
            <Title order={2} c="bright" style={{ letterSpacing: "-0.02em" }}>{firstName}</Title>
            <Text size="xs" c="dimmed" mt={2}>Personal workspace · sections and widgets are fully customizable per template</Text>
          </Box>
          <Group gap="sm">
            <Badge size="lg" variant="filled" color={accentColor} radius="md">{ROLE_LABELS[role]}</Badge>
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

      <NewsTicker />

      {featuredWidgets.length > 0 && (
        <Card withBorder radius="lg" p="lg">
          <Stack gap="md">
            <Box>
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.08em" }}>
                Live Overview
              </Text>
              <Divider mt="xs" />
            </Box>
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
              {featuredWidgets.map((widget) => {
                const Tile = widget.Tile;
                return <Tile key={widget.id} onExpand={() => onExpand(widget.id)} />;
              })}
            </SimpleGrid>
          </Stack>
        </Card>
      )}

      {sections.map((section) => (
        <DashboardSection
          key={section.key}
          section={section}
          onExpand={onExpand}
          columns={{ base: 1, xs: 2, sm: 2, md: section.items.length <= 3 ? section.items.length : 4 }}
        />
      ))}
    </Stack>
  );
}

function DashboardSection({
  section,
  onExpand,
  columns,
}: {
  section: { title: string; items: NavItem[] };
  onExpand: (id: string) => void;
  columns: { base: number; xs?: number; sm?: number; md?: number; lg?: number };
}) {
  if (section.items.length === 0) return null;

  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap="md">
        <Box>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.08em" }}>
            {section.title}
          </Text>
          <Divider mt="xs" />
        </Box>
        <SimpleGrid cols={columns} spacing="md">
          {section.items.map((item) => (
            <NavButton key={item.id} item={item} onExpand={onExpand} />
          ))}
        </SimpleGrid>
      </Stack>
    </Card>
  );
}

function NavButton({
  item,
  onExpand,
}: {
  item: NavItem;
  onExpand: (id: string) => void;
}) {
  const accentVar = `var(--mantine-color-${item.color}-6)`;

  return (
    <UnstyledButton onClick={() => onExpand(item.id)} style={{ width: "100%" }}>
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
            <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
              <Text size="sm" fw={600} c="bright" style={{ lineHeight: 1.3 }}>
                {item.label}
              </Text>
              {typeof item.badgeCount === "number" && item.badgeCount > 0 && (
                <Badge size="xs" color="red" variant="filled">{item.badgeCount}</Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed" lineClamp={2} mt={2}>
              {item.description}
            </Text>
          </Box>
        </Group>
      </Card>
    </UnstyledButton>
  );
}
