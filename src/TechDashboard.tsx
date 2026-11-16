/**
 * TechDashboard — the focused, personal view for Tier 1/2/3 techs.
 *
 * Individual templates are now real layouts: each person can pick a template,
 * drag sections and widgets into a custom order, and hide/show sections.
 */

import { useMemo, useState } from "react";
import {
  ActionIcon,
  AppShell,
  Drawer,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
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
  IconCalendarStats,
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
  IconChartBar,
  IconSearch,
  IconStar,
  IconBook,
  IconBulb,
  IconClipboardList,
  IconSun,
  IconWorldPin,
  IconAlertTriangle,
  IconArrowUp,
  IconArrowDown,
  IconArrowsShuffle,
  IconPhone,
  IconChevronDown,
  IconChevronUp,
  IconPin,
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
  isAlwaysPinnedSection,
  type DashboardSectionKey,
  useDashboardPreferences,
} from "./lib/dashboard-preferences";
import { useIdentity } from "./lib/identity";
import { canAccess, effectiveRoleForIdentity, ROLE_COLORS, ROLE_LABELS } from "./lib/roles";
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
    key: "critical-alerts",
    title: "Critical Alerts & Updates",
    items: [
      { id: "logic-monitor", label: "LogicMonitor Alerts", icon: IconAlertTriangle, color: "red", description: "Critical alert feed and device health" },
      { id: "velocloud-api", label: "VeloCloud Health", icon: IconWorldPin, color: "cyan", description: "SD-WAN alerts and link status" },
      { id: "data-health", label: "Data Health", icon: IconActivityHeartbeat, color: "orange", description: "Check dashboard data freshness" },
    ],
  },
  {
    key: "my-tasks",
    title: "My Open Tasks",
    items: [
      { id: "my-day", label: "My Day", icon: IconActivity, color: "indigo", description: "Today's tickets and calls" },
    ],
  },
  {
    key: "team-availability",
    title: "Team Availability",
    items: [
      { id: "zoom-queue", label: "Team Availability", icon: IconHeadset, color: "appdirect", description: "Queue availability, breaks, and meeting status" },
    ],
  },
  {
    key: "operations",
    title: "Frequently Used Operations Tools",
    items: [
      { id: "shift-checklist", label: "Shift Handover", icon: IconClipboardList, color: "teal", description: "End-of-shift checklist" },
      { id: "work-allotment-generator", label: "Work Allotment", icon: IconClipboardList, color: "indigo", description: "View NOC shift assignments" },
      { id: "ticket-audit", label: "Ticket Audit", icon: IconClipboardList, color: "orange", description: "Review and audit ticket handling" },
      { id: "ticket-rebalancer", label: "Ticket Rebalancer", icon: IconArrowsShuffle, color: "cyan", description: "Help balance the ticket queue" },
      { id: "maintenance-note-generator", label: "Maintenance Notes", icon: IconFileText, color: "blue", description: "Generate maintenance communications" },
      { id: "zoom-call-metrics", label: "Call Metrics", icon: IconPhone, color: "green", description: "RingCentral queue analytics" },
    ],
  },
  {
    key: "my-work",
    title: "My Work", 
    items: [
      { id: "my-day", label: "My Day", icon: IconActivity, color: "indigo", description: "Today's tickets & calls" },
      { id: "meeting-notes", label: "Notebook", icon: IconNotes, color: "grape", description: "OneNote-style individual ..." },
      { id: "performance-tracker", label: "My Metrics", icon: IconChartBar, color: "green", description: "Performance & disputes" },
      { id: "noc-mttr-report", label: "NOC MTTR Report", icon: IconClock, color: "orange", description: "Upload MTTR Excel and trend by month" },
      { id: "break-tracker", label: "Breaks", icon: IconCoffee, color: "orange", description: "Start & track breaks" },
    ],
  },
  {
    key: "queue-monitoring",
    title: "Queue & Monitoring",
    items: [
      { id: "zoom-queue", label: "Team Availability", icon: IconHeadset, color: "appdirect", description: "Live call queue" },
      { id: "logic-monitor", label: "LogicMonitor", icon: IconChartArea, color: "red", description: "Alerts & device health" },
      { id: "performance-discussions", label: "Half-Yearly Discussions", icon: IconCalendarStats, color: "red", description: "Manager-led performance discussion records" },
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
      { id: "team-feedback", label: "Team Feedback", icon: IconClipboardList, color: "violet", description: "Store peer feedback tied to ticket work" },
      { id: "celebrations-tracker", label: "Celebrations Tracker", icon: IconGift, color: "pink", description: "Birthdays, work anniversaries, and marriage anniversaries" },
      { id: "enhancement-tracker", label: "Enhancement Tracker", icon: IconBulb, color: "yellow", description: "Submit and review team improvement ideas" },
      { id: "shift-checklist", label: "Shift Checklist", icon: IconClipboardList, color: "teal", description: "End-of-shift handover checklist" },
      { id: "work-allotment-generator", label: "Work Allotment Generator", icon: IconClipboardList, color: "indigo", description: "View NOC shift assignments" },
      { id: "kb-gap-finder", label: "KB Gap Finder", icon: IconBook, color: "indigo", description: "Ask questions · Flag missing docs" },
    ],
  },
];

export default function TechDashboard() {
  const { identity } = useIdentity();
  const {
    currentLayout,
    moveSection,
    toggleSectionPinned,
    toggleSectionCollapsed,
  } = useDashboardPreferences();
  const { windows, openWindow } = useWindowManager();
  const [customizeOpened, { open: openCustomize, close: closeCustomize }] = useDisclosure(false);
  const [toolsOpened, { open: openTools, close: closeTools }] = useDisclosure(false);
  const [toolSearch, setToolSearch] = useState("");
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light", {
    getInitialValueInEffect: true,
  });
  const isDark = computedColorScheme === "dark";
  const toggleColorScheme = () => setColorScheme(isDark ? "light" : "dark");

  const canonicalSelf = identity ? resolveTeamMember(identity.name) : null;
  const displayName = canonicalSelf ?? identity?.name ?? "Tech";
  const firstName = displayName.split(" ")[0];
  const effectiveRole = effectiveRoleForIdentity(identity);

  const visibleWidgets = useMemo(() => {
    if (!identity) return WIDGETS;
    if (effectiveRole === "customer_service_manager") {
      return WIDGETS.filter((w) => w.id === "noc-mttr-report");
    }
    return WIDGETS.filter((w) => canAccess(effectiveRole, w.roles));
  }, [effectiveRole, identity]);

  const { pendingCount: trainingNotificationCount } = useTrainingNotifications();
  const accentColor = effectiveRole ? ROLE_COLORS[effectiveRole] : "appdirect";

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
          pinned: Boolean(layoutSection.pinned),
          collapsed: Boolean(layoutSection.collapsed),
          items: [...orderedItems, ...missingItems],
        };
      })
      .filter((section): section is { key: DashboardSectionKey; title: string; hidden: boolean; pinned: boolean; collapsed: boolean; items: NavItem[] } => !!section);
  }, [currentLayout.sections, visibleSectionMap]);

  const visibleSections = orderedSections
    .filter((section) => !section.hidden && section.items.length > 0)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const matchingTools = visibleWidgets.filter((widget) => {
    const query = toolSearch.trim().toLowerCase();
    return !query || `${widget.title} ${widget.description}`.toLowerCase().includes(query);
  });

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
                  filter: ["drop-shadow(0 0 16px var(--mantine-color-", accentColor, "-6))"].join(""),
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
              <Tooltip label="Search all tools" withArrow>
                <ActionIcon aria-label="Search all tools" variant="default" size="lg" radius="md" onClick={openTools}>
                  <IconSearch size={18} />
                </ActionIcon>
              </Tooltip>
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
            onExpand={expand}
            onTogglePinned={toggleSectionPinned}
            onToggleCollapsed={toggleSectionCollapsed}
            onMoveSection={(key, direction) => {
              const index = visibleSections.findIndex((section) => section.key === key);
              const target = visibleSections[index + direction];
              if (target) moveSection(key, target.key);
            }}
          />
        </Container>
      </AppShell.Main>

      <Drawer opened={toolsOpened} onClose={closeTools} position="right" size="md" title="All tools" padding="lg">
        <Stack gap="md">
          <Text size="sm" c="dimmed">Search every tool available to your role, then open it without leaving your dashboard.</Text>
          <TextInput
            autoFocus
            value={toolSearch}
            onChange={(event) => setToolSearch(event.currentTarget.value)}
            placeholder="Search tools…"
            aria-label="Search all available tools"
            leftSection={<IconSearch size={16} />}
          />
          <Text size="xs" c="dimmed">{matchingTools.length} tools</Text>
          <Stack gap="xs">
            {matchingTools.map((widget) => (
              <Card key={widget.id} withBorder radius="md" p="sm">
                <Group justify="space-between" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                    <ThemeIcon color={widget.iconColor} variant="light" radius="md">
                      <widget.icon size={17} />
                    </ThemeIcon>
                    <Box style={{ minWidth: 0 }}>
                      <Text size="sm" fw={600}>{widget.title}</Text>
                      <Text size="xs" c="dimmed" lineClamp={2}>{widget.description}</Text>
                    </Box>
                  </Group>
                  <Button size="xs" variant="light" onClick={() => { expand(widget.id); closeTools(); }}>
                    Open
                  </Button>
                </Group>
              </Card>
            ))}
            {matchingTools.length === 0 && (
              <Card withBorder radius="md" p="lg">
                <Text size="sm" fw={600}>No matching tools</Text>
                <Text size="xs" c="dimmed" mt={4}>Try a different search term.</Text>
              </Card>
            )}
          </Stack>
        </Stack>
      </Drawer>

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
  onExpand,
  onTogglePinned,
  onToggleCollapsed,
  onMoveSection,
}: {
  firstName: string;
  identity: ReturnType<typeof useIdentity>["identity"];
  accentColor: string;
  sections: Array<{ key: DashboardSectionKey; title: string; hidden: boolean; pinned: boolean; collapsed: boolean; items: NavItem[] }>;
  onExpand: (id: string) => void;
  onTogglePinned: (key: DashboardSectionKey) => void;
  onToggleCollapsed: (key: DashboardSectionKey) => void;
  onMoveSection: (key: DashboardSectionKey, direction: -1 | 1) => void;
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

      {sections.map((section, index) => (
        <DashboardSection
          key={section.key}
          section={section}
          onExpand={onExpand}
          alwaysPinned={isAlwaysPinnedSection(section.key)}
          onTogglePinned={() => onTogglePinned(section.key)}
          onToggleCollapsed={() => onToggleCollapsed(section.key)}
          onMoveUp={() => onMoveSection(section.key, -1)}
          onMoveDown={() => onMoveSection(section.key, 1)}
          canMoveUp={index > 0}
          canMoveDown={index < sections.length - 1}
          columns={{ base: 1, xs: 2, sm: 2, md: section.items.length <= 3 ? section.items.length : 4 }}
        />
      ))}
    </Stack>
  );
}

function DashboardSection({
  section,
  onExpand,
  alwaysPinned,
  onTogglePinned,
  onToggleCollapsed,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  columns,
}: {
  section: { key: DashboardSectionKey; title: string; items: NavItem[]; pinned: boolean; collapsed: boolean };
  onExpand: (id: string) => void;
  alwaysPinned: boolean;
  onTogglePinned: () => void;
  onToggleCollapsed: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  columns: { base: number; xs?: number; sm?: number; md?: number; lg?: number };
}) {
  if (section.items.length === 0) return null;

  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap="md">
        <Group justify="space-between" align="center" wrap="wrap">
          <Group gap="xs">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.08em" }}>
              {section.title}
            </Text>
            {section.pinned && <Badge size="xs" variant="light" color="appdirect">Pinned</Badge>}
          </Group>
          <Group gap={4}>
            <Tooltip label={alwaysPinned ? "Always pinned for your dashboard" : section.pinned ? "Unpin section" : "Pin section to the top"} withArrow>
              <ActionIcon aria-label={alwaysPinned ? `${section.title} is always pinned` : section.pinned ? `Unpin ${section.title}` : `Pin ${section.title}`} aria-pressed={section.pinned} disabled={alwaysPinned} size="sm" variant={section.pinned ? "light" : "subtle"} color={section.pinned ? "appdirect" : "gray"} onClick={onTogglePinned}>
                <IconPin size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Move section up" withArrow>
              <ActionIcon aria-label={`Move ${section.title} up`} size="sm" variant="subtle" disabled={!canMoveUp} onClick={onMoveUp}><IconArrowUp size={15} /></ActionIcon>
            </Tooltip>
            <Tooltip label="Move section down" withArrow>
              <ActionIcon aria-label={`Move ${section.title} down`} size="sm" variant="subtle" disabled={!canMoveDown} onClick={onMoveDown}><IconArrowDown size={15} /></ActionIcon>
            </Tooltip>
            <Tooltip label={alwaysPinned ? "Always expanded on your dashboard" : section.collapsed ? "Expand section" : "Collapse section"} withArrow>
              <ActionIcon aria-label={alwaysPinned ? `${section.title} is always expanded` : section.collapsed ? `Expand ${section.title}` : `Collapse ${section.title}`} aria-expanded={!section.collapsed} disabled={alwaysPinned} size="sm" variant="subtle" onClick={onToggleCollapsed}>
                {section.collapsed ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        <Divider />
        {!section.collapsed && (
          <SimpleGrid cols={columns} spacing="md">
            {section.items.map((item) => (
              <NavButton key={item.id} item={item} onExpand={onExpand} />
            ))}
          </SimpleGrid>
        )}
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
              filter: ["drop-shadow(0 0 8px color-mix(in srgb, ", accentVar, " 30%, transparent))"].join(""),
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
