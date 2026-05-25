import {
  IconActivity,
  IconActivityHeartbeat,
  IconAddressBook,
  IconChartArea,
  IconChartBar,
  IconClipboardText,
  IconCoffee,
  IconDeviceMobileMessage,
  IconFileText,
  IconGavel,
  IconHeadset,
  IconHome,
  IconMail,
  IconMailForward,
  IconPhone,
  IconReportAnalytics,
  IconSearch,
  IconShield,
} from "@tabler/icons-react";
import { BreakTrackerWidget, BreakTrackerTile } from "./BreakTracker";
import { ZoomQueueWidget, ZoomQueueTile } from "./ZoomQueue";
import { EscalationsWidget, EscalationsTile } from "./Escalations";
import { TicketSummaryWidget, TicketSummaryTile } from "./TicketSummary";
import { WfhWidget, WfhTile } from "./Wfh";
import { EscalationEmailWidget, EscalationEmailTile } from "./EscalationEmail";
import { WorkActivityWidget, WorkActivityTile } from "./WorkActivity";
import { ShiftHandoverWidget, ShiftHandoverTile } from "./ShiftHandover";
import { EmailPolisherWidget, EmailPolisherTile } from "./EmailPolisher";
import { LogicMonitorWidget, LogicMonitorTile } from "./LogicMonitor";
import {
  NocTroubleshooterWidget,
  NocTroubleshooterTile,
} from "./NocTroubleshooter";
import {
  MobilityTroubleshooterWidget,
  MobilityTroubleshooterTile,
} from "./MobilityTroubleshooter";
import {
  PerformanceTrackerWidget,
  PerformanceTrackerTile,
} from "./PerformanceTracker";
import {
  SmartSearchWidget,
  SmartSearchTile,
} from "./SmartSearch";
import {
  AccessControlWidget,
  AccessControlTile,
} from "./AccessControl";
import {
  AppUsageWidget,
  AppUsageTile,
} from "./AppUsage";
import {
  ZoomCallMetricsWidget,
  ZoomCallMetricsTile,
} from "./ZoomCallMetrics";
import {
  TicketAuditWidget,
  TicketAuditTile,
} from "./TicketAudit";
import type { WidgetDefinition } from "./types";

/**
 * Registry of all dashboard widgets.
 *
 * To add a new widget:
 *   1. Create src/widgets/<MyWidget>/index.tsx exporting both
 *      `<MyWidget>Widget` (full view) and `<MyWidget>Tile` (compact view).
 *   2. (optional) Add a Vite plugin under vite-plugins/ for any server-side
 *      proxy/auth, and register it in vite.config.ts.
 *   3. Push an entry into this array.
 *
 * Tiles are rendered in a responsive grid on the dashboard. Clicking a tile
 * expands it into the full view.
 */
export const WIDGETS: WidgetDefinition[] = [
  {
    id: "smart-search",
    title: "Smart Search",
    description: "AI-powered natural language search across the dashboard",
    icon: IconSearch,
    iconColor: "indigo",
    tileSize: "sm",
    Tile: SmartSearchTile,
    Full: SmartSearchWidget,
  },
  {
    id: "my-day",
    title: "My Day",
    description: "Your tickets + calls for today",
    icon: IconActivity,
    iconColor: "indigo",
    tileSize: "lg",
    featured: true,
    Tile: WorkActivityTile,
    Full: WorkActivityWidget,
  },
  {
    id: "performance-tracker",
    title: "Team Performance",
    description: "Excel-imported team metrics + per-member drill-down",
    icon: IconReportAnalytics,
    iconColor: "green",
    tileSize: "sm",
    Tile: PerformanceTrackerTile,
    Full: PerformanceTrackerWidget,
  },
  {
    id: "logic-monitor",
    title: "LogicMonitor",
    description: "Live alert feed + device health",
    icon: IconChartArea,
    iconColor: "red",
    tileSize: "sm",
    Tile: LogicMonitorTile,
    Full: LogicMonitorWidget,
  },
  {
    id: "zoom-queue",
    title: "Zoom Queue",
    description: "Who's on a call and for how long",
    icon: IconHeadset,
    iconColor: "appdirect",
    tileSize: "lg",
    featured: true,
    Tile: ZoomQueueTile,
    Full: ZoomQueueWidget,
  },
  {
    id: "break-tracker",
    title: "Break Tracker",
    description: "Team breaks via Slack + local",
    icon: IconCoffee,
    iconColor: "orange",
    tileSize: "lg",
    featured: true,
    Tile: BreakTrackerTile,
    Full: BreakTrackerWidget,
  },
  {
    id: "qs-escalations",
    title: "QS Escalation Contacts",
    description: "Carrier escalation lists",
    icon: IconAddressBook,
    iconColor: "grape",
    tileSize: "sm",
    Tile: EscalationsTile,
    Full: EscalationsWidget,
  },
  {
    id: "ticket-summary",
    title: "Ticket Summary",
    description: "AI summarizes uploaded .mhtml tickets",
    icon: IconFileText,
    iconColor: "indigo",
    tileSize: "sm",
    Tile: TicketSummaryTile,
    Full: TicketSummaryWidget,
  },
  {
    id: "wfh",
    title: "WFH Requests",
    description: "Apply for work-from-home approval",
    icon: IconHome,
    iconColor: "appdirect",
    tileSize: "sm",
    Tile: WfhTile,
    Full: WfhWidget,
  },
  {
    id: "escalation-email",
    title: "Escalation Email",
    description: "AI drafts the ESC-MGR Alert email from your notes",
    icon: IconMail,
    iconColor: "teal",
    tileSize: "sm",
    Tile: EscalationEmailTile,
    Full: EscalationEmailWidget,
  },
  {
    id: "shift-handover",
    title: "Shift Handover",
    description: "AI structures your ticket notes into a handover message",
    icon: IconClipboardText,
    iconColor: "blue",
    tileSize: "sm",
    Tile: ShiftHandoverTile,
    Full: ShiftHandoverWidget,
  },
  {
    id: "email-polisher",
    title: "Email Polisher",
    description: "Polish a draft for customer, internal, or carrier",
    icon: IconMailForward,
    iconColor: "lime",
    tileSize: "sm",
    Tile: EmailPolisherTile,
    Full: EmailPolisherWidget,
  },
  {
    id: "noc-troubleshooter",
    title: "NOC Troubleshooter",
    description: "AI agent for network + circuit troubleshooting",
    icon: IconActivityHeartbeat,
    iconColor: "cyan",
    tileSize: "sm",
    Tile: NocTroubleshooterTile,
    Full: NocTroubleshooterWidget,
  },
  {
    id: "access-control",
    title: "Access Control",
    description: "Manage team member roles and dashboard access",
    icon: IconShield,
    iconColor: "red",
    tileSize: "sm",
    roles: ["manager"],
    Tile: AccessControlTile,
    Full: AccessControlWidget,
  },
  {
    id: "app-usage",
    title: "App Usage",
    description: "Per-person widget usage, daily active users, top tools",
    icon: IconChartBar,
    iconColor: "teal",
    tileSize: "sm",
    roles: ["manager"],
    Tile: AppUsageTile,
    Full: AppUsageWidget,
  },
  {
    id: "zoom-call-metrics",
    title: "Zoom Call Metrics (Test)",
    description: "Jan–Apr 2026 inbound call data pulled live from Zoom Phone API",
    icon: IconPhone,
    iconColor: "green",
    tileSize: "sm",
    roles: ["manager"],
    Tile: ZoomCallMetricsTile,
    Full: ZoomCallMetricsWidget,
  },
  {
    id: "mobility-troubleshooter",
    title: "Mobility Troubleshooter",
    description: "AI agent for wireless + device troubleshooting",
    icon: IconDeviceMobileMessage,
    iconColor: "violet",
    tileSize: "sm",
    Tile: MobilityTroubleshooterTile,
    Full: MobilityTroubleshooterWidget,
  },
  {
    id: "ticket-audit",
    title: "Ticket Audit",
    description: "AI quality audits from MHTML tickets — scores pushed to Performance Tracker",
    icon: IconGavel,
    iconColor: "violet",
    tileSize: "sm",
    roles: ["manager"],
    Tile: TicketAuditTile,
    Full: TicketAuditWidget,
  },
];
