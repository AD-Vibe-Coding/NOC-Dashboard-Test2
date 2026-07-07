import {
  IconActivity,
  IconActivityHeartbeat,
  IconAddressBook,
  IconChartArea,
  IconChartBar,
  IconClockRecord,
  IconDatabase,
  IconDeviceMobileMessage,
  IconFileText,
  IconGavel,
  IconHeadset,
  IconShieldLock,
  IconHome,
  IconMail,
  IconNotes,
  IconPhone,
  IconSchool,
  IconReportAnalytics,
  IconShield,
  IconWorldPin,
  IconStar,
  IconClipboardList,
  IconBook,
  IconArrowsShuffle,
  IconBulb,
  IconGift,
} from "@tabler/icons-react";
import { ZoomQueueWidget, ZoomQueueTile } from "./ZoomQueue";
import { EscalationsWidget, EscalationsTile } from "./Escalations";
import { TicketSummaryWidget, TicketSummaryTile } from "./TicketSummary";
import { WfhWidget, WfhTile } from "./Wfh";
import { EmailAssistantWidget, EmailAssistantTile } from "./EmailAssistant";
import { WorkActivityWidget, WorkActivityTile } from "./WorkActivity";
import { DataHealthWidget, DataHealthTile } from "./DataHealth";
import { LogicMonitorWidget, LogicMonitorTile } from "./LogicMonitor";
import {
  NocTroubleshooterWidget,
  NocTroubleshooterTile,
} from "./NocTroubleshooter";
import {
  MobilityTroubleshooterWidget,
  MobilityTroubleshooterTile,
} from "./MobilityTroubleshooter";
import { VelocloudTroubleshooterWidget, VelocloudTroubleshooterTile } from "./VelocloudTroubleshooter";
import { FortigateTroubleshooterWidget, FortigateTroubleshooterTile } from "./FortigateTroubleshooter";
import { PiabTroubleshooterWidget, PiabTroubleshooterTile } from "./PiabTroubleshooter";
import { VelocloudApiWidget, VelocloudApiTile } from "./VelocloudApi";
import {
  PerformanceTrackerWidget,
  PerformanceTrackerTile,
} from "./PerformanceTracker";
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
import { EnhancementsWidget, EnhancementsTile } from "./Enhancements";
import { ShiftChecklistWidget, ShiftChecklistTile } from "./ShiftChecklist";
import { KbGapFinderWidget, KbGapFinderTile } from "./KbGapFinder";
import { AttendanceTrackerWidget, AttendanceTrackerTile } from "./AttendanceTracker";
import { CelebrationsTrackerWidget, CelebrationsTrackerTile } from "./CelebrationsTracker";
import { TicketRebalancerWidget, TicketRebalancerTile } from "./TicketRebalancer";
import {
  MaintenanceNoteGeneratorWidget,
  MaintenanceNoteGeneratorTile,
} from "./MaintenanceNoteGenerator";
import { NocMttrReportWidget, NocMttrReportTile } from "./NocMttrReport";
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
    id: "noc-mttr-report",
    title: "NOC MTTR Report",
    description: "Upload MTTR Excel data and trend average resolve time month over month",
    icon: IconClockRecord,
    iconColor: "orange",
    tileSize: "sm",
    Tile: NocMttrReportTile,
    Full: NocMttrReportWidget,
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
    id: "velocloud-api",
    title: "VeloCloud API",
    description: "SD-WAN alerts, link status, and health summary",
    icon: IconWorldPin,
    iconColor: "cyan",
    tileSize: "sm",
    Tile: VelocloudApiTile,
    Full: VelocloudApiWidget,
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
    title: "Training Hub",
    description: "Requests, upcoming sessions, and progress",
    icon: IconSchool,
    iconColor: "blue",
    tileSize: "sm",
    Tile: TrainingUpdatesTile,
    Full: TrainingUpdatesWidget,
  },
  {
    id: "celebrations-tracker",
    title: "Celebrations Tracker",
    description: "Birthdays, work anniversaries, and marriage anniversaries",
    icon: IconGift,
    iconColor: "pink",
    tileSize: "sm",
    Tile: CelebrationsTrackerTile,
    Full: CelebrationsTrackerWidget,
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
    id: "email-assistant",
    title: "NOC Email Assistant",
    description: "Generate escalation variants, polish drafts, and validate email quality",
    icon: IconMail,
    iconColor: "teal",
    tileSize: "sm",
    Tile: EmailAssistantTile,
    Full: EmailAssistantWidget,
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
    id: "data-health",
    title: "Data Health",
    description: "Read-only table row counts across all app data",
    icon: IconDatabase,
    iconColor: "orange",
    tileSize: "sm",
    roles: ["manager"],
    Tile: DataHealthTile,
    Full: DataHealthWidget,
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
    id: "attendance-tracker",
    title: "Attendance & Reminders",
    description: "Punch in/out activity and queue/break reminder counts",
    icon: IconClockRecord,
    iconColor: "orange",
    tileSize: "sm",
    roles: ["manager"],
    Tile: AttendanceTrackerTile,
    Full: AttendanceTrackerWidget,
  },
  {
    id: "ticket-rebalancer",
    title: "Ticket Rebalancer",
    description: "Google Sheet roster + file upload fallback for ticket balancing analysis",
    icon: IconArrowsShuffle,
    iconColor: "grape",
    tileSize: "sm",
    roles: ["manager"],
    Tile: TicketRebalancerTile,
    Full: TicketRebalancerWidget,
  },
  {
    id: "maintenance-note-generator",
    title: "Maintenance Note Generator",
    description: "Parse carrier maintenance notices and generate a formatted maintenance note",
    icon: IconNotes,
    iconColor: "indigo",
    tileSize: "sm",
    Tile: MaintenanceNoteGeneratorTile,
    Full: MaintenanceNoteGeneratorWidget,
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
    id: "velocloud-troubleshooter",
    title: "VeloCloud Troubleshooter",
    description: "AI assistant for Arista VeloCloud SD-WAN troubleshooting",
    icon: IconActivityHeartbeat,
    iconColor: "cyan",
    tileSize: "sm",
    Tile: VelocloudTroubleshooterTile,
    Full: VelocloudTroubleshooterWidget,
  },
  {
    id: "fortigate-troubleshooter",
    title: "Fortigate Troubleshooting Agent",
    description: "AI assistant for FortiGate troubleshooting",
    icon: IconShieldLock,
    iconColor: "orange",
    tileSize: "sm",
    Tile: FortigateTroubleshooterTile,
    Full: FortigateTroubleshooterWidget,
  },
  {
    id: "piab-troubleshooter",
    title: "PIAB Troubleshooter",
    description: "Dedicated PIAB Knowledge Base troubleshooting assistant",
    icon: IconBook,
    iconColor: "indigo",
    tileSize: "sm",
    Tile: PiabTroubleshooterTile,
    Full: PiabTroubleshooterWidget,
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
    id: "enhancement-tracker",
    title: "Enhancement Tracker",
    description: "Team-submitted enhancements with manager approval workflow",
    icon: IconBulb,
    iconColor: "yellow",
    tileSize: "sm",
    Tile: EnhancementsTile,
    Full: EnhancementsWidget,
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

];
