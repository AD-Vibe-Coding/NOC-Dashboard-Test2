import {
  IconActivity,
  IconActivityHeartbeat,
  IconAddressBook,
  IconChartArea,
  IconChartBar,
  IconDeviceMobileMessage,
  IconFileText,
  IconGavel,
  IconHeadset,
  IconHome,
  IconMail,
  IconMailForward,
  IconNotes,
  IconPhone,
  IconSchool,
  IconReportAnalytics,
  IconSearch,
  IconShield,
  IconWorldPin,
  IconStar,
  IconClipboardList,
  IconBook,

  IconSchool as IconSchoolReg,
} from "@tabler/icons-react";
import { ZoomQueueWidget, ZoomQueueTile } from "./ZoomQueue";
import { EscalationsWidget, EscalationsTile } from "./Escalations";
import { TicketSummaryWidget, TicketSummaryTile } from "./TicketSummary";
import { WfhWidget, WfhTile } from "./Wfh";
import { EscalationEmailWidget, EscalationEmailTile } from "./EscalationEmail";
import { WorkActivityWidget, WorkActivityTile } from "./WorkActivity";

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
import {
  TrainingUpdatesWidget,
  TrainingUpdatesTile,
} from "./TrainingUpdates";
import {
  MeetingNotesWidget,
  MeetingNotesTile,
} from "./MeetingNotes";
import {
  TimezoneHelperWidget,
  TimezoneHelperTile,
} from "./TimezoneHelper";
import { KudosBoardWidget, KudosBoardTile } from "./KudosBoard";
import { ShiftChecklistWidget, ShiftChecklistTile } from "./ShiftChecklist";
import { KbGapFinderWidget, KbGapFinderTile } from "./KbGapFinder";
import { TrainingProgressWidget, TrainingProgressTile } from "./TrainingProgress";
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
    title: "Team Availability",
    description: "Queue availability, breaks, and meeting status",
    icon: IconHeadset,
    iconColor: "appdirect",
    tileSize: "lg",
    featured: true,
    Tile: ZoomQueueTile,
    Full: ZoomQueueWidget,
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
    id: "training-updates",
    title: "Training Updates",
    description: "Training requests, reviews, and upcoming sessions",
    icon: IconSchool,
    iconColor: "blue",
    tileSize: "sm",
    Tile: TrainingUpdatesTile,
    Full: TrainingUpdatesWidget,
  },
  {
    id: "meeting-notes",
    title: "Meeting Notes",
    description: "OneNote-style individual and management meeting notebooks",
    icon: IconNotes,
    iconColor: "grape",
    tileSize: "sm",
    Tile: MeetingNotesTile,
    Full: MeetingNotesWidget,
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
    title: "Zoom Call Metrics",
    description: "May 2026 Mobility + Network queue call data",
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
  {
    id: "timezone-helper",
    title: "NOC Timezone Helper",
    description: "Convert customer location to PST/PT — DST-aware, support hours indicator",
    icon: IconWorldPin,
    iconColor: "cyan",
    tileSize: "sm",
    Tile: TimezoneHelperTile,
    Full: TimezoneHelperWidget,
  },
  {
    id: "kudos-board",
    title: "Kudos Board",
    description: "Peer recognition & team shoutouts",
    icon: IconStar,
    iconColor: "yellow",
    tileSize: "sm",
    Tile: KudosBoardTile,
    Full: KudosBoardWidget,
  },
  {
    id: "shift-checklist",
    title: "Shift Handover Checklist",
    description: "Structured end-of-shift handover with P1/P2 tickets, bridges, AI summary and manager view",
    icon: IconClipboardList,
    iconColor: "teal",
    tileSize: "sm",
    Tile: ShiftChecklistTile,
    Full: ShiftChecklistWidget,
  },
  {
    id: "kb-gap-finder",
    title: "NOC Knowledge Base",
    description: "Search Confluence KB · Runbook AI · Quick links · Flag missing docs",
    icon: IconBook,
    iconColor: "indigo",
    tileSize: "sm",
    Tile: KbGapFinderTile,
    Full: KbGapFinderWidget,
  },
  {
    id: "training-progress",
    title: "Training Progress",
    description: "Track training completions per agent — manager overview included",
    icon: IconSchoolReg,
    iconColor: "grape",
    tileSize: "sm",
    Tile: TrainingProgressTile,
    Full: TrainingProgressWidget,
  },
];
