/**
 * AppOverview — high-level summary of the NOC Dashboard.
 * Click the dashboard title in the header to open.
 * Shareable with the whole team to explain what the app does.
 */
import {
  Badge,
  Box,
  Card,
  Divider,
  Grid,
  Group,
  List,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconActivityHeartbeat,
  IconBrain,
  IconBrandGoogle,
  IconBrandZoom,
  IconBriefcase,
  IconCalendarStats,
  IconChartBar,
  IconCheckbox,
  IconCoffee,
  IconDeviceMobileMessage,
  IconHeadset,
  IconHome,
  IconLayoutDashboard,
  IconMail,
  IconPhone,
  IconReportAnalytics,
  IconSearch,
  IconShield,
  IconUsers,
} from "@tabler/icons-react";

interface Props {
  opened: boolean;
  onClose: () => void;
}

const PILLARS = [
  {
    icon: IconHeadset,
    color: "blue",
    title: "Live Queue Visibility",
    desc: "See who is in queue vs out in real-time via Zoom Phone API. Break Tracker integration shows WHY an agent is out — coffee, lunch, restroom, or personal.",
  },
  {
    icon: IconReportAnalytics,
    color: "green",
    title: "Performance Management",
    desc: "Import Excel scorecards to track call metrics, ticket quality, and SLA adherence per agent. AI-powered ticket audits score quality automatically and push results to the tracker.",
  },
  {
    icon: IconBrain,
    color: "violet",
    title: "AI-Powered Tools",
    desc: "Embedded AI agents handle escalation email drafting, shift handover notes, ticket summarization, email polishing, and intelligent troubleshooting for both NOC and Mobility issues.",
  },
  {
    icon: IconCalendarStats,
    color: "orange",
    title: "Shift & Team Management",
    desc: "Google Sheets roster integration filters the queue view to show only agents on shift. WFH request flow with manager approval. Break tracking with Slack notifications.",
  },
];

const TOOLS = [
  { icon: IconLayoutDashboard, color: "appdirect", label: "My Day",            desc: "Google Calendar + personal task planner for the shift" },
  { icon: IconHeadset,         color: "blue",       label: "Zoom Queue",        desc: "Live in-queue vs out, per-queue breakdown, break reasons" },
  { icon: IconCoffee,          color: "orange",     label: "Break Tracker",     desc: "Start/end breaks with Slack alerts and live duration timers" },
  { icon: IconPhone,           color: "green",      label: "Zoom Call Metrics", desc: "Jan–Apr 2026 inbound call volume, handle time, and trends" },
  { icon: IconChartBar,        color: "green",      label: "Performance",       desc: "Excel-imported scorecards with per-agent drill-down" },
  { icon: IconCheckbox,        color: "violet",     label: "Ticket Audit",      desc: "AI QA scoring from MHTML tickets pushed to the tracker" },
  { icon: IconActivityHeartbeat,color: "red",       label: "LogicMonitor",      desc: "Live network alerts, device health, and alert analyzer" },
  { icon: IconSearch,          color: "indigo",     label: "Smart Search",      desc: "Natural language search across the entire dashboard" },
  { icon: IconMail,            color: "teal",       label: "Escalation Email",  desc: "AI drafts ESC-MGR alert emails from your raw notes" },
  { icon: IconBriefcase,       color: "blue",       label: "Shift Handover",    desc: "AI structures ticket notes into a clean handover message" },
  { icon: IconMail,            color: "lime",       label: "Email Polisher",    desc: "Polish drafts for customer, internal, or carrier audiences" },
  { icon: IconActivityHeartbeat,color: "cyan",      label: "NOC Troubleshooter",desc: "AI agent for network & circuit troubleshooting" },
  { icon: IconDeviceMobileMessage,color:"violet",   label: "Mobility Troubleshooter",desc:"AI agent for wireless & device issues" },
  { icon: IconUsers,           color: "grape",      label: "QS Escalation Contacts",desc:"Carrier escalation contact lists" },
  { icon: IconHome,            color: "appdirect",  label: "WFH Requests",      desc: "Submit & approve work-from-home requests" },
  { icon: IconShield,          color: "red",        label: "Access Control",    desc: "Manage team roles and dashboard permissions" },
  { icon: IconChartBar,        color: "teal",       label: "App Usage",         desc: "Per-person widget usage and daily active users" },
];

const INTEGRATIONS = [
  { icon: IconBrandZoom,   color: "blue",   label: "Zoom Phone API",        desc: "Queue membership, call logs, live agent status" },
  { icon: IconBrandGoogle, color: "red",    label: "Google Calendar",       desc: "Personal calendar events in the My Day widget" },
  { icon: IconBrandGoogle, color: "green",  label: "Google Sheets",         desc: "Roster import for shift-based queue filtering" },
  { icon: IconBrain,       color: "violet", label: "Devs.ai Agent",         desc: "Ticket Auditor AI for quality scoring" },
  { icon: IconUsers,       color: "orange", label: "Slack",                 desc: "Break start/end notifications to the team channel" },
  { icon: IconChartBar,    color: "teal",   label: "Supabase",              desc: "Persistent storage for all team data" },
];

export function AppOverview({ opened, onClose }: Props) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="xl"
      title={
        <Group gap="sm">
          <ThemeIcon size="lg" variant="gradient" gradient={{ from: "#006080", to: "#0080a6" }} radius="md">
            <IconLayoutDashboard size={20} />
          </ThemeIcon>
          <Box>
            <Title order={4} style={{ lineHeight: 1.2 }}>vCom NOC Operations Dashboard</Title>
            <Text size="xs" c="dimmed">What this app does · who it's for · how it helps</Text>
          </Box>
        </Group>
      }

    >
      <Stack gap="xl">

        {/* ── Mission statement ── */}
        <Card withBorder radius="md" p="lg"
          style={{ background: "linear-gradient(135deg, rgba(0,96,128,0.12) 0%, rgba(0,128,166,0.06) 100%)" }}>
          <Stack gap="sm">
            <Badge color="appdirect" variant="light" size="sm">Purpose</Badge>
            <Title order={3}>
              One dashboard for the entire NOC shift — real-time visibility, AI assistance, and team management in one place.
            </Title>
            <Text size="sm" c="dimmed" lh={1.7}>
              The NOC Operations Dashboard replaces scattered Slack threads, spreadsheets, and separate tools with a
              unified command center. Managers get instant visibility into who is available, what's happening in the
              queue, and how the team is performing — while individual technicians get AI tools that help them
              resolve issues faster and communicate more clearly.
            </Text>
          </Stack>
        </Card>

        {/* ── Who is it for ── */}
        <Box>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="sm" style={{ letterSpacing: "0.08em" }}>
            Who uses it
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <Card withBorder radius="md" p="md">
              <Group gap="sm" mb="xs">
                <ThemeIcon size="sm" color="appdirect" variant="light"><IconUsers size={14} /></ThemeIcon>
                <Text fw={700} size="sm">NOC Managers</Text>
              </Group>
              <List size="sm" c="dimmed" spacing={4}>
                <List.Item>Monitor live queue availability at a glance</List.Item>
                <List.Item>See who is on break and why</List.Item>
                <List.Item>Review and score ticket quality with AI</List.Item>
                <List.Item>Import and track monthly performance scorecards</List.Item>
                <List.Item>Approve WFH requests and manage access roles</List.Item>
              </List>
            </Card>
            <Card withBorder radius="md" p="md">
              <Group gap="sm" mb="xs">
                <ThemeIcon size="sm" color="blue" variant="light"><IconHeadset size={14} /></ThemeIcon>
                <Text fw={700} size="sm">NOC Technicians (Tier 1 / 2 / 3)</Text>
              </Group>
              <List size="sm" c="dimmed" spacing={4}>
                <List.Item>Track their own shift with the My Day planner</List.Item>
                <List.Item>Log breaks and see who else is on break</List.Item>
                <List.Item>Use AI troubleshooters for NOC and Mobility issues</List.Item>
                <List.Item>Draft escalation emails and handover notes with AI</List.Item>
                <List.Item>Submit WFH requests and view their metrics</List.Item>
              </List>
            </Card>
          </SimpleGrid>
        </Box>

        {/* ── Four pillars ── */}
        <Box>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="sm" style={{ letterSpacing: "0.08em" }}>
            What we're trying to achieve
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            {PILLARS.map((p) => (
              <Card key={p.title} withBorder radius="md" p="md">
                <Group gap="sm" mb={6} wrap="nowrap">
                  <ThemeIcon size="md" color={p.color} variant="light" radius="md">
                    <p.icon size={16} />
                  </ThemeIcon>
                  <Text fw={700} size="sm">{p.title}</Text>
                </Group>
                <Text size="xs" c="dimmed" lh={1.6}>{p.desc}</Text>
              </Card>
            ))}
          </SimpleGrid>
        </Box>

        <Divider />

        {/* ── All tools ── */}
        <Box>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="sm" style={{ letterSpacing: "0.08em" }}>
            All {TOOLS.length} widgets — click the title bar to open any as a floating window
          </Text>
          <Grid gutter="xs">
            {TOOLS.map((t) => (
              <Grid.Col key={t.label} span={{ base: 12, sm: 6, md: 4 }}>
                <Group gap="xs" wrap="nowrap" p={6}
                  style={{ borderRadius: 8, border: "1px solid var(--mantine-color-dark-5)" }}>
                  <ThemeIcon size="sm" color={t.color} variant="light" radius="sm" style={{ flexShrink: 0 }}>
                    <t.icon size={12} />
                  </ThemeIcon>
                  <Box style={{ minWidth: 0 }}>
                    <Text size="xs" fw={600} truncate>{t.label}</Text>
                    <Text size="xs" c="dimmed" truncate>{t.desc}</Text>
                  </Box>
                </Group>
              </Grid.Col>
            ))}
          </Grid>
        </Box>

        <Divider />

        {/* ── Integrations ── */}
        <Box>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="sm" style={{ letterSpacing: "0.08em" }}>
            Integrations
          </Text>
          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
            {INTEGRATIONS.map((i) => (
              <Group key={i.label} gap="xs" wrap="nowrap">
                <ThemeIcon size="sm" color={i.color} variant="light" radius="sm" style={{ flexShrink: 0 }}>
                  <i.icon size={12} />
                </ThemeIcon>
                <Box style={{ minWidth: 0 }}>
                  <Text size="xs" fw={600}>{i.label}</Text>
                  <Text size="xs" c="dimmed" truncate>{i.desc}</Text>
                </Box>
              </Group>
            ))}
          </SimpleGrid>
        </Box>

        <Card withBorder radius="md" p="md"
          style={{ background: "linear-gradient(135deg, rgba(0,96,128,0.08) 0%, transparent 100%)" }}>
          <Group gap="xs">
            <Text size="xs" c="dimmed" fw={500}>
              💡 <strong>Pro tip:</strong> Open multiple widgets simultaneously using the floating window system.
              Drag, resize, minimize to the taskbar, or maximize any widget. Click the dashboard title anytime to reopen this overview.
            </Text>
          </Group>
        </Card>

      </Stack>
    </Modal>
  );
}
