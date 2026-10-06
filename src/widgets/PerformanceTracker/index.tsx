import { useCallback, useEffect, useMemo, useState } from "react";
import { installPerformanceDebugConsole } from "./debugConsole";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCalendarStats,
  IconCalendarTime,
  IconHistory,
  IconLayoutDashboard,
  IconGavel,
  IconLock,
  IconChartBar,
  IconChartHistogram,
  IconRefresh,
  IconTrash,
  IconUpload,
  IconUser,
} from "@tabler/icons-react";
import { useIdentity } from "../../lib/identity";
import { WidgetFrame } from "../WidgetFrame";
import { ImportFlow } from "./ImportFlow";
import { PerformanceDashboard } from "./Dashboard";
import { PerformanceTrends } from "./Trends";
import { DisputesPanel } from "./DisputesPanel";
import {
  clearAllPerformanceData,
  deleteImport,
  persistImport,
  rederivePeriodsForAllRows,
  usePerformanceData,
  type PerformanceMetric,
} from "./data";
import {
  LOCKED_TEAM,
  resolveTeamMember,
  TIER_COLORS,
  TIER_LABELS,
} from "./team";
import { SOURCE_TYPE_LABELS, type SourceType } from "./import";

export { PerformanceTrackerTile } from "./Tile";

const SNAPSHOT_DEMO_MEMBER = "Snapshot Demo User";

const SNAPSHOT_DEMO_METRICS: PerformanceMetric[] = [
  {
    id: -9901,
    import_id: -1,
    member_name: SNAPSHOT_DEMO_MEMBER,
    source_type: "tickets",
    total_count: 1,
    success_count: 1,
    duration_minutes: 42,
    score: "High",
    period_start: "2026-01-09T14:12:00Z",
    period_end: "2026-01-09T14:54:00Z",
    queue: "noc",
    period_month: "2026-01",
    period_quarter: "2026-Q1",
    ack_minutes: 5,
    carrier_ticket_minutes: 11,
    handle_seconds: null,
    wait_seconds: null,
    raw_json: JSON.stringify({
      ref_number: "DEMO-23011",
      customer_name: "Acme Retail Group",
      subject_text: "Core switch packet loss review",
      hour: 14,
      is_weekend: false,
      is_maintenance: false,
      within_24h: "less than 24 hours",
    }),
    created_at: "2026-01-09T14:54:00Z",
  } as unknown as PerformanceMetric,
  {
    id: -9902,
    import_id: -1,
    member_name: SNAPSHOT_DEMO_MEMBER,
    source_type: "calls",
    total_count: 1,
    success_count: 1,
    duration_minutes: null,
    score: "Answered",
    period_start: "2026-02-12T16:08:00Z",
    period_end: "2026-02-12T16:19:00Z",
    queue: "mobility",
    period_month: "2026-02",
    period_quarter: "2026-Q1",
    ack_minutes: null,
    carrier_ticket_minutes: null,
    handle_seconds: 404,
    wait_seconds: 22,
    raw_json: JSON.stringify({
      caller_info: "+1 (555) 010-2201",
      customer_name: "Northwind Health",
      hour: 16,
      is_weekend: false,
    }),
    created_at: "2026-02-12T16:19:00Z",
  } as unknown as PerformanceMetric,
  {
    id: -9903,
    import_id: -1,
    member_name: SNAPSHOT_DEMO_MEMBER,
    source_type: "tasks",
    total_count: 1,
    success_count: 1,
    duration_minutes: 31,
    score: null,
    period_start: "2026-03-03T11:25:00Z",
    period_end: "2026-03-03T11:56:00Z",
    queue: "noc",
    period_month: "2026-03",
    period_quarter: "2026-Q1",
    ack_minutes: null,
    carrier_ticket_minutes: null,
    handle_seconds: null,
    wait_seconds: null,
    raw_json: JSON.stringify({
      ref_number: "TASK-7701",
      customer_name: "Litware Inc.",
      subject_text: "Firewall object update",
      hour: 11,
      is_weekend: false,
    }),
    created_at: "2026-03-03T11:56:00Z",
  } as unknown as PerformanceMetric,
  {
    id: -9904,
    import_id: -1,
    member_name: SNAPSHOT_DEMO_MEMBER,
    source_type: "tickets",
    total_count: 1,
    success_count: 0,
    duration_minutes: 67,
    score: "Medium",
    period_start: "2026-04-18T19:02:00Z",
    period_end: "2026-04-18T20:09:00Z",
    queue: "noc",
    period_month: "2026-04",
    period_quarter: "2026-Q2",
    ack_minutes: 8,
    carrier_ticket_minutes: 19,
    handle_seconds: null,
    wait_seconds: null,
    raw_json: JSON.stringify({
      ref_number: "DEMO-23814",
      customer_name: "Contoso Logistics",
      subject_text: "Carrier handoff validation",
      hour: 19,
      is_weekend: false,
      is_maintenance: false,
      within_24h: "more than 24 hours",
    }),
    created_at: "2026-04-18T20:09:00Z",
  } as unknown as PerformanceMetric,
  {
    id: -9905,
    import_id: -1,
    member_name: SNAPSHOT_DEMO_MEMBER,
    source_type: "tickets",
    total_count: 1,
    success_count: 1,
    duration_minutes: 38,
    score: "High",
    period_start: "2026-05-06T13:02:00Z",
    period_end: "2026-05-06T13:40:00Z",
    queue: "noc",
    period_month: "2026-05",
    period_quarter: "2026-Q2",
    ack_minutes: 4,
    carrier_ticket_minutes: 9,
    handle_seconds: null,
    wait_seconds: null,
    raw_json: JSON.stringify({
      ref_number: "DEMO-24051",
      customer_name: "Acme Retail Group",
      subject_text: "WAN latency investigation",
      hour: 13,
      is_weekend: false,
      is_maintenance: false,
      within_24h: "less than 24 hours",
    }),
    created_at: "2026-05-06T13:40:00Z",
  } as unknown as PerformanceMetric,
  {
    id: -9906,
    import_id: -1,
    member_name: SNAPSHOT_DEMO_MEMBER,
    source_type: "tickets",
    total_count: 1,
    success_count: 0,
    duration_minutes: 71,
    score: "Medium",
    period_start: "2026-06-02T15:10:00Z",
    period_end: "2026-06-02T16:21:00Z",
    queue: "noc",
    period_month: "2026-06",
    period_quarter: "2026-Q2",
    ack_minutes: 7,
    carrier_ticket_minutes: 17,
    handle_seconds: null,
    wait_seconds: null,
    raw_json: JSON.stringify({
      ref_number: "DEMO-24118",
      customer_name: "Northwind Health",
      subject_text: "Primary circuit flap review",
      hour: 15,
      is_weekend: false,
      is_maintenance: false,
      within_24h: "more than 24 hours",
    }),
    created_at: "2026-06-02T16:21:00Z",
  } as unknown as PerformanceMetric,
  {
    id: -9907,
    import_id: -1,
    member_name: SNAPSHOT_DEMO_MEMBER,
    source_type: "calls",
    total_count: 1,
    success_count: 1,
    duration_minutes: null,
    score: "Answered",
    period_start: "2026-06-03T14:05:00Z",
    period_end: "2026-06-03T14:17:00Z",
    queue: "mobility",
    period_month: "2026-06",
    period_quarter: "2026-Q2",
    ack_minutes: null,
    carrier_ticket_minutes: null,
    handle_seconds: 482,
    wait_seconds: 31,
    raw_json: JSON.stringify({
      caller_info: "+1 (555) 010-2400",
      customer_name: "Adventure Works",
      hour: 14,
      is_weekend: false,
    }),
    created_at: "2026-06-03T14:17:00Z",
  } as unknown as PerformanceMetric,
  {
    id: -9908,
    import_id: -1,
    member_name: SNAPSHOT_DEMO_MEMBER,
    source_type: "calls",
    total_count: 1,
    success_count: 0,
    duration_minutes: null,
    score: "No answer",
    period_start: "2026-06-04T18:20:00Z",
    period_end: "2026-06-04T18:22:00Z",
    queue: "mobility",
    period_month: "2026-06",
    period_quarter: "2026-Q2",
    ack_minutes: null,
    carrier_ticket_minutes: null,
    handle_seconds: 0,
    wait_seconds: 19,
    raw_json: JSON.stringify({
      caller_info: "+1 (555) 010-9988",
      customer_name: "Graphic Design Institute",
      hour: 18,
      is_weekend: false,
    }),
    created_at: "2026-06-04T18:22:00Z",
  } as unknown as PerformanceMetric,
  {
    id: -9909,
    import_id: -1,
    member_name: SNAPSHOT_DEMO_MEMBER,
    source_type: "tasks",
    total_count: 1,
    success_count: 1,
    duration_minutes: 26,
    score: null,
    period_start: "2026-06-05T12:10:00Z",
    period_end: "2026-06-05T12:36:00Z",
    queue: "noc",
    period_month: "2026-06",
    period_quarter: "2026-Q2",
    ack_minutes: null,
    carrier_ticket_minutes: null,
    handle_seconds: null,
    wait_seconds: null,
    raw_json: JSON.stringify({
      ref_number: "TASK-8801",
      customer_name: "Litware Inc.",
      subject_text: "Update monitoring contacts",
      hour: 12,
      is_weekend: false,
    }),
    created_at: "2026-06-05T12:36:00Z",
  } as unknown as PerformanceMetric,
  {
    id: -9910,
    import_id: -1,
    member_name: SNAPSHOT_DEMO_MEMBER,
    source_type: "tasks",
    total_count: 1,
    success_count: 0,
    duration_minutes: 44,
    score: null,
    period_start: "2026-06-07T09:45:00Z",
    period_end: "2026-06-07T10:29:00Z",
    queue: "mobility",
    period_month: "2026-06",
    period_quarter: "2026-Q2",
    ack_minutes: null,
    carrier_ticket_minutes: null,
    handle_seconds: null,
    wait_seconds: null,
    raw_json: JSON.stringify({
      ref_number: "TASK-8824",
      customer_name: "Contoso Logistics",
      subject_text: "SIM swap follow-up",
      hour: 9,
      is_weekend: true,
    }),
    created_at: "2026-06-07T10:29:00Z",
  } as unknown as PerformanceMetric,
];

/**
 * Team Performance Tracker — main widget.
 *
 * Access model:
 *   - Manager:   sees team-wide dashboard + can drill into any member +
 *                can import / delete imports / reset all data.
 *   - Everyone else: sees ONLY their own metrics. The "Member" picker is
 *                locked to their identity. Import + History tabs are hidden.
 */
export function PerformanceTrackerWidget() {
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";

  // Who the current viewer is allowed to see metrics for.
  // - Manager: null = team view; can pick any member
  // - Anyone else: locked to their own canonical name
  const canonicalSelf = identity ? resolveTeamMember(identity.name) : null;
  const [selectedMember, setSelectedMember] = useState<string | null>(null);

  // Effective scoped member: managers can pick freely, others are locked.
  const scopedMember = isManager
    ? selectedMember
    : canonicalSelf;

  const [activeTab, setActiveTab] = useState<string | null>("overview");
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"fit" | "zoom">("zoom");
  const [zoomPercent, setZoomPercent] = useState<string>("110");
  const [fitScale, setFitScale] = useState(1);

  const { metrics, imports, loading, refresh } = usePerformanceData();
  const effectiveMetrics = useMemo(
    () => (selectedMember === SNAPSHOT_DEMO_MEMBER ? SNAPSHOT_DEMO_METRICS : metrics),
    [metrics, selectedMember],
  );

  useEffect(() => {
    const updateFitScale = () => {
      const availableHeight = window.innerHeight - 220;
      const estimatedContentHeight = activeTab === "trends" ? 1080 : 1240;
      const nextScale = Math.max(0.72, Math.min(1, availableHeight / estimatedContentHeight));
      setFitScale(Number(nextScale.toFixed(2)));
    };

    updateFitScale();
    window.addEventListener("resize", updateFitScale);
    return () => window.removeEventListener("resize", updateFitScale);
  }, [activeTab, scopedMember, isManager]);

  // Track pending dispute count for the tab badge
  const [pendingDisputeCount, setPendingDisputeCount] = useState(0);
  const [disputeRefreshKey, setDisputeRefreshKey] = useState(0);

  useEffect(() => {
    fetch("/api/metric_disputes")
      .then((r) => r.ok ? r.json() : [])
      .then((data: Array<{ status: string }>) => {
        setPendingDisputeCount(data.filter((d) => d.status === "pending").length);
      })
      .catch(() => {});
  }, [disputeRefreshKey]);

  const handleDisputeChange = useCallback(() => {
    setDisputeRefreshKey((k) => k + 1);
    refresh(); // also refresh metrics in case a dispute was approved
  }, [refresh]);

  // One-time install of the `window.perf` debug helpers. Lets the user
  // inspect imported data from DevTools — e.g. `await perf.help()`,
  // `console.table(await perf.columns("calls"))`. Side-effect runs once
  // on first mount; subsequent mounts re-attach harmlessly.
  useEffect(() => {
    installPerformanceDebugConsole();
  }, []);

  // Mantine v7 Select grouped-data format:
  //   [{ group: "Group name", items: [{ value, label }, ...] }, ...]
  // The previous shape (flat array with a `group` field on each item) is
  // NOT valid for Mantine — it caused "Cannot read properties of undefined
  // (reading 'map')" because Mantine tried to `.map(items)` on each group
  // entry where `items` was undefined.
  const memberOptions = useMemo(() => {
    const nocItems = LOCKED_TEAM.filter((m) => m.team === "noc").map((m) => ({
      value: m.name,
      label: `${m.name} · ${TIER_LABELS[m.tier]}`,
    }));
    const mobilityItems = LOCKED_TEAM.filter((m) => m.team === "mobility").map(
      (m) => ({
        value: m.name,
        label: `${m.name} · ${TIER_LABELS[m.tier]}`,
      }),
    );
    return [
      { group: "View", items: [{ value: "__team__", label: "Whole team" }] },
      {
        group: "Snapshot-safe demo",
        items: [{ value: SNAPSHOT_DEMO_MEMBER, label: `${SNAPSHOT_DEMO_MEMBER} · presentation only` }],
      },
      { group: "NOC", items: nocItems },
      { group: "Mobility", items: mobilityItems },
    ];
  }, []);

  const [importError, setImportError] = useState<string | null>(null);

  async function handleImportComplete(result: any) {
    setImportError(null);
    try {
      await persistImport(result, identity?.name ?? null);
      refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[performance-tracker] persistImport failed:", err);
      setImportError(msg);
      // Re-throw so the ImportFlow UI can surface the failure too.
      throw err;
    }
  }

  async function handleDeleteImport(id: number) {
    try {
      await deleteImport(id);
      refresh();
    } catch (err) {
      console.error("[performance-tracker] deleteImport failed:", err);
      setImportError(
        ["Failed to delete import: ", err instanceof Error ? err.message : String(err)].join(""),
      );
    }
  }

  async function handleResetAll() {
    try {
      await clearAllPerformanceData();
      setResetConfirmOpen(false);
      refresh();
    } catch (err) {
      console.error("[performance-tracker] reset failed:", err);
      setImportError(
        ["Failed to reset data: ", err instanceof Error ? err.message : String(err)].join(""),
      );
    }
  }

  /**
   * Re-derive period_month / period_quarter / queue for every existing row
   * using the current extractor. Used to retroactively fix imports made
   * with older (buggy) extractor code — most recently, dates getting
   * mis-parsed because XLSX returns Date objects whose String() form isn't
   * locale-safe. Surface success / failure via the same banner.
   */
  const [rederiveResult, setRederiveResult] = useState<string | null>(null);
  const [isRederiving, setIsRederiving] = useState(false);
  async function handleRederivePeriods() {
    setImportError(null);
    setRederiveResult(null);
    setIsRederiving(true);
    try {
      const r = await rederivePeriodsForAllRows();
      setRederiveResult(
        `Re-derived periods · scanned ${r.scanned}, updated ${r.updated}`,
      );
      refresh();
    } catch (err) {
      console.error("[performance-tracker] re-derive failed:", err);
      setImportError(
        `Failed to re-derive periods: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsRederiving(false);
    }
  }

  // Restrict view for non-managers — if they have no canonical name on the
  // roster, they don't see ANY data (most users do have one).
  const showAccessNotice = !isManager && !canonicalSelf;

  return (
    <WidgetFrame
      title={isManager ? "Team Performance" : `${canonicalSelf ?? identity?.name ?? "My"} Metrics`}
      subtitle={
        isManager
          ? "Team-wide metrics + per-member drill-down · Excel import"
          : "Your performance metrics from imported team data"
      }
      icon={IconChartBar}
      iconColor="green"
      loading={loading}
      status={{
        label: isManager ? "manager" : "individual",
        color: isManager ? "red" : "blue",
        tooltip: isManager
          ? "Full team access + import permissions"
          : "Locked to your own metrics",
      }}
      headerActions={
        isManager &&
        metrics.length > 0 && (
          <>
            <Tooltip label="Re-derive month / quarter / queue from raw data (fixes legacy imports)">
              <ActionIcon
                variant="subtle"
                color="cyan"
                size="md"
                onClick={handleRederivePeriods}
                aria-label="Re-derive periods"
              >
                <IconCalendarTime size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Reset all imported data">
              <ActionIcon
                variant="subtle"
                color="red"
                size="md"
                onClick={() => setResetConfirmOpen(true)}
                aria-label="Reset all"
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </>
        )
      }
    >
      {showAccessNotice ? (
        <Alert
          icon={<IconLock size={16} />}
          color="yellow"
          variant="light"
          title="Sign in as a roster member"
        >
          Your identity ({identity?.name ?? "—"}) isn't on the locked 14-member
          performance roster, so there's nothing personal to display here.
          Managers can see this dashboard with team-wide data.
        </Alert>
      ) : (
        <>
        {importError && (
          <Alert
            icon={<IconAlertCircle size={14} />}
            color="red"
            variant="light"
            mb="sm"
            withCloseButton
            onClose={() => setImportError(null)}
            title="Import failed"
          >
            {importError}
          </Alert>
        )}
        {rederiveResult && (
          <Alert
            icon={<IconCalendarTime size={14} />}
            color="cyan"
            variant="light"
            mb="sm"
            withCloseButton
            onClose={() => setRederiveResult(null)}
            title="Periods re-derived"
          >
            {rederiveResult}
          </Alert>
        )}
        {/* Shared View picker — lifted out of the Overview panel so it
            controls Overview AND Trends simultaneously. Manager picks
            a member (or "Whole team"); non-managers are locked to their
            own canonical name. The same `scopedMember` value is passed
            to both dashboards below. Hidden on Import/History tabs
            since those aren't member-scoped. */}
        {(activeTab === "overview" || activeTab === "trends") &&
          (isManager ? (
            <Card withBorder radius="md" p="sm" mt="md" mb={0}>
              <Group justify="space-between" wrap="nowrap">
                <Group gap="xs">
                  <ThemeIcon variant="light" color="green" radius="md" size="sm">
                    <IconChartHistogram size={14} />
                  </ThemeIcon>
                  <Text size="sm" fw={500}>
                    View
                  </Text>
                  {scopedMember && (
                    <Badge
                      size="xs"
                      variant="light"
                      color={scopedMember === SNAPSHOT_DEMO_MEMBER ? "violet" : "blue"}
                    >
                      {scopedMember === SNAPSHOT_DEMO_MEMBER
                        ? "Snapshot-safe demo view"
                        : "Individual: applies to both Overview & Trends"}
                    </Badge>
                  )}
                </Group>
                <Group gap="xs" wrap="nowrap">
                  <Tooltip label="Reload latest performance imports and metrics">
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconRefresh size={14} />}
                      onClick={() => refresh()}
                      loading={loading}
                    >
                      Reload
                    </Button>
                  </Tooltip>
                  <SegmentedControl
                    size="xs"
                    value={viewMode}
                    onChange={(value) => setViewMode(value as "fit" | "zoom")}
                    data={[
                      { value: "fit", label: "Fit whole" },
                      { value: "zoom", label: "Zoom + scroll" },
                    ]}
                  />
                  {viewMode === "zoom" && (
                    <Select
                      size="xs"
                      w={92}
                      data={[
                        { value: "100", label: "100%" },
                        { value: "110", label: "110%" },
                        { value: "125", label: "125%" },
                        { value: "140", label: "140%" },
                      ]}
                      value={zoomPercent}
                      onChange={(value) => value && setZoomPercent(value)}
                      allowDeselect={false}
                    />
                  )}
                  <Select
                    size="xs"
                    w={280}
                    data={memberOptions}
                    value={selectedMember ?? "__team__"}
                    onChange={(v) =>
                      setSelectedMember(v === "__team__" ? null : v)
                    }
                    searchable
                    allowDeselect={false}
                  />
                </Group>
              </Group>
            </Card>
          ) : (
            canonicalSelf && (
              <Card withBorder radius="md" p="sm" mt="md" mb={0}>
                <Group gap="xs">
                  <ThemeIcon variant="light" color="blue" radius="md" size="sm">
                    <IconUser size={14} />
                  </ThemeIcon>
                  <Text size="sm">
                    Viewing your metrics:{" "}
                    <Text component="span" fw={600}>
                      {canonicalSelf}
                    </Text>
                  </Text>
                  <Badge
                    size="xs"
                    color={TIER_COLORS[LOCKED_TEAM.find((m) => m.name === canonicalSelf)?.tier ?? "tier1"]}
                    variant="light"
                  >
                    {TIER_LABELS[LOCKED_TEAM.find((m) => m.name === canonicalSelf)?.tier ?? "tier1"]}
                  </Badge>
                </Group>
              </Card>
            )
          ))}
        <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab
              value="overview"
              leftSection={<IconLayoutDashboard size={14} />}
            >
              Overview
            </Tabs.Tab>
            <Tabs.Tab
              value="trends"
              leftSection={<IconCalendarStats size={14} />}
            >
              Team Trends
            </Tabs.Tab>
            {isManager && (
              <Tabs.Tab value="import" leftSection={<IconUpload size={14} />}>
                Import data
              </Tabs.Tab>
            )}
            {isManager && (
              <Tabs.Tab
                value="history"
                leftSection={<IconHistory size={14} />}
              >
                History
                <Badge
                  size="xs"
                  variant="light"
                  ml={6}
                  color={imports.length > 0 ? "green" : "gray"}
                >
                  {imports.length}
                </Badge>
              </Tabs.Tab>
            )}
            <Tabs.Tab
              value="disputes"
              leftSection={<IconGavel size={14} />}
            >
              Disputes
              {pendingDisputeCount > 0 && (
                <Badge
                  size="xs"
                  variant="filled"
                  color="yellow"
                  ml={6}
                >
                  {pendingDisputeCount}
                </Badge>
              )}
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="overview" pt="md">
            <Box
              style={{
                zoom: viewMode === "fit" ? fitScale : Number(zoomPercent) / 100,
                transformOrigin: "top left",
                width: viewMode === "fit" ? `${100 / fitScale}%` : undefined,
              }}
            >
              <PerformanceDashboard
                metrics={effectiveMetrics}
                scopedMember={scopedMember}
                onRederive={isManager ? handleRederivePeriods : undefined}
                isRederiving={isRederiving}
                currentUserName={canonicalSelf ?? undefined}
                onDisputeChange={handleDisputeChange}
              />
            </Box>
          </Tabs.Panel>

          <Tabs.Panel value="trends" pt="md">
            {/* Month-over-month comparison view. Respects the same
                scopedMember as Overview so:
                  - Managers viewing "Whole team": team-wide trends
                  - Managers viewing a specific member: only that
                    member's tickets + calls trended over months
                  - Non-managers: automatically scoped to their own
                    canonical name (set above)
                The Trends tab carries its own queue (All/NOC/Mobility)
                filter so users can slice the trend by team without
                affecting the Overview tab's filters. */}
            <Box
              style={{
                zoom: viewMode === "fit" ? fitScale : Number(zoomPercent) / 100,
                transformOrigin: "top left",
                width: viewMode === "fit" ? `${100 / fitScale}%` : undefined,
              }}
            >
              <PerformanceTrends
                metrics={effectiveMetrics}
                scopedMember={scopedMember}
              />
            </Box>
          </Tabs.Panel>

          {isManager && (
            <Tabs.Panel value="import" pt="md">
              <ImportFlow onComplete={handleImportComplete} />
            </Tabs.Panel>
          )}

          {isManager && (
            <Tabs.Panel value="history" pt="md">
              <ImportHistory
                imports={imports}
                onDelete={handleDeleteImport}
              />
            </Tabs.Panel>
          )}

          <Tabs.Panel value="disputes" pt="md">
            <DisputesPanel
              reviewerName={isManager ? (canonicalSelf ?? identity?.name ?? "Manager") : ""}
              onMetricsChanged={handleDisputeChange}
              isManager={isManager}
              currentUserName={canonicalSelf ?? undefined}
            />
          </Tabs.Panel>
        </Tabs>
        </>
      )}

      <Modal
        opened={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        title={
          <Group gap={8}>
            <IconAlertCircle size={20} color="var(--mantine-color-red-5)" />
            <Title order={5}>Reset all performance data?</Title>
          </Group>
        }
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            This deletes every imported row across all source types. The
            14-member roster itself is preserved — only the metrics get wiped.
          </Text>
          <Text size="xs" c="dimmed">
            {metrics.length} metric row{metrics.length === 1 ? "" : "s"} from{" "}
            {imports.length} import{imports.length === 1 ? "" : "s"} will be
            deleted.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setResetConfirmOpen(false)}>
              Cancel
            </Button>
            <Button color="red" onClick={handleResetAll}>
              Yes, reset everything
            </Button>
          </Group>
        </Stack>
      </Modal>
    </WidgetFrame>
  );
}

// =============================================================================
// Import history tab
// =============================================================================

function ImportHistory({
  imports,
  onDelete,
}: {
  imports: ReturnType<typeof usePerformanceData>["imports"];
  onDelete: (id: number) => Promise<void>;
}) {
  if (imports.length === 0) {
    return (
      <Card withBorder radius="md" p="xl">
        <Stack align="center" gap="xs">
          <IconHistory size={36} color="var(--mantine-color-dimmed)" />
          <Text size="sm" c="dimmed">
            No imports yet. Upload an Excel workbook from the Import tab to
            populate the dashboard.
          </Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={6}>Import history</Title>
          <Text size="xs" c="dimmed">
            {imports.length} import{imports.length === 1 ? "" : "s"}
          </Text>
        </Group>
        <Box style={{ overflowX: "auto" }}>
          <Table withTableBorder striped highlightOnHover fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>When</Table.Th>
                <Table.Th>File</Table.Th>
                <Table.Th>Ticket Audit File</Table.Th>
                <Table.Th>Sheet</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th ta="right">Total</Table.Th>
                <Table.Th ta="right">Matched</Table.Th>
                <Table.Th ta="right">Skipped</Table.Th>
                <Table.Th>By</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {imports.map((imp, idx) => (
                <Table.Tr key={`import-${imp.id}-${imp.file_name}-${imp.sheet_name ?? "sheet"}-${idx}`}>
                  <Table.Td>
                    <Text size="xs">
                      {new Date(imp.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" truncate maw={180}>
                      {imp.file_name}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {imp.sheet_name ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" variant="light">
                      {SOURCE_TYPE_LABELS[imp.source_type as SourceType] ??
                        imp.source_type}
                    </Badge>
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace">
                    {imp.row_count}
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace" c="green.4">
                    {imp.matched_count}
                  </Table.Td>
                  <Table.Td
                    ta="right"
                    ff="monospace"
                    c={imp.skipped_count > 0 ? "yellow.5" : "dimmed"}
                  >
                    {imp.skipped_count}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {imp.imported_by ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Tooltip label="Delete this import (removes its rows)">
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="red"
                        onClick={() => onDelete(imp.id)}
                        aria-label="Delete import"
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      </Stack>
    </Card>
  );
}
