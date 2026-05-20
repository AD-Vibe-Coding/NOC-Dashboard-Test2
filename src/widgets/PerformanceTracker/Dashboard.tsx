import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Grid,
  Group,
  Loader,
  Modal,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCalendar,
  IconClipboardCheck,
  IconClipboardList,
  IconClock,
  IconFilter,
  IconInfoCircle,
  IconTool,
  IconPhone,
  IconPhoneIncoming,
  IconPhoneX,
  IconSearch,
  IconShieldCheck,
  IconTicket,
  IconUsersGroup,
} from "@tabler/icons-react";
import type { ComponentType, ReactNode } from "react";
import {
  LOCKED_TEAM,
  LOCKED_TEAM_NAMES,
  TIER_COLORS,
  TIER_LABELS,
  TIER_SHORT_LABELS,
  tierFor,
} from "./team";
import {
  aggregateMetrics,
  diagnoseMemberTickets,
  listAvailablePeriods,
  type AggregateOptions,
  type MemberSummary,
  type MemberTicketDiagnostic,
  type PerformanceMetric,
  type Queue,
  type SourceBucket,
} from "./data";
import { type SourceType } from "./import";

interface Props {
  metrics: PerformanceMetric[];
  scopedMember: string | null;
  /** Optional: caller (the widget root) can provide the re-derive action so
   *  the diagnostic banner can offer a one-click "fix it" button. */
  onRederive?: () => void;
  /** True while onRederive is in flight. */
  isRederiving?: boolean;
}

// =============================================================================
// Top-level component
// =============================================================================

export function PerformanceDashboard({
  metrics,
  scopedMember,
  onRederive,
  isRederiving,
}: Props) {
  // ---- Filter state ----
  const [queueFilter, setQueueFilter] = useState<Queue | "all">("all");
  const [periodMode, setPeriodMode] = useState<"all" | "month" | "quarter">(
    "all",
  );
  const [periodValue, setPeriodValue] = useState<string | null>(null);
  // Maintenance-notification filter — defaults ON because these rows
  // aren't real incident work and skew the team KPIs upward. Toggle
  // applies to tickets only; call data is never affected.
  const [excludeMaintenance, setExcludeMaintenance] = useState(true);

  const periods = useMemo(() => listAvailablePeriods(metrics), [metrics]);

  // When the user switches mode, auto-select the most recent value if any
  // are available, otherwise reset to null.
  const effectivePeriodValue = useMemo(() => {
    if (periodMode === "all") return null;
    if (periodValue) return periodValue;
    const fallback =
      periodMode === "month" ? periods.months[0] : periods.quarters[0];
    return fallback ?? null;
  }, [periodMode, periodValue, periods]);

  const options: AggregateOptions = {
    queue: queueFilter,
    period:
      periodMode === "all" || !effectivePeriodValue
        ? { type: "all" }
        : periodMode === "month"
          ? { type: "month", value: effectivePeriodValue }
          : { type: "quarter", value: effectivePeriodValue },
    excludeMaintenance,
  };

  const summaries = useMemo(
    () => aggregateMetrics(metrics, LOCKED_TEAM_NAMES, options),
    [metrics, options.queue, options.period, options.excludeMaintenance],
  );

  // ---- Auto-diagnostic: do we have ticket rows that don't have a
  // period_month? If so the user almost certainly imported with a buggy
  // parser version or has a `month` column format we don't yet recognize.
  // Show a yellow banner with actionable guidance.
  const ticketDiagnostic = useMemo(() => {
    let total = 0;
    let withMonth = 0;
    for (const m of metrics) {
      if (m.source_type !== "tickets") continue;
      total++;
      if (m.period_month) withMonth++;
    }
    return { total, withMonth, missing: total - withMonth };
  }, [metrics]);

  if (metrics.length === 0) {
    return <EmptyState />;
  }

  return (
    <Stack gap="md">
      {ticketDiagnostic.missing > 0 && ticketDiagnostic.withMonth === 0 && (
        <Alert
          color="yellow"
          variant="light"
          icon={<IconAlertTriangle size={14} />}
          title="Period data missing — re-derive needed"
        >
          <Stack gap="xs">
            <Text size="sm">
              {ticketDiagnostic.missing.toLocaleString()} ticket row
              {ticketDiagnostic.missing === 1 ? " has" : "s have"} no
              extractable month. These rows were imported before the latest
              parser update. Click below to re-process them against the stored
              <Code mx={4}>raw_json</Code>using the current logic — no
              re-import required.
            </Text>
            {onRederive && (
              <Group>
                <Button
                  size="xs"
                  color="cyan"
                  leftSection={<IconCalendar size={14} />}
                  loading={isRederiving}
                  onClick={onRederive}
                >
                  Re-derive periods now
                </Button>
                <Text size="xs" c="dimmed">
                  If the count stays at zero after re-deriving, click the 🔍 on
                  any member row to see what's actually in their{" "}
                  <Code>month</Code> column (column B) and{" "}
                  <Code>month_label</Code> fallback.
                </Text>
              </Group>
            )}
          </Stack>
        </Alert>
      )}
      <FilterBar
        queueFilter={queueFilter}
        onQueueChange={setQueueFilter}
        periodMode={periodMode}
        onPeriodModeChange={(m) => {
          setPeriodMode(m);
          setPeriodValue(null);
        }}
        periodValue={effectivePeriodValue}
        onPeriodValueChange={setPeriodValue}
        availableMonths={periods.months}
        availableQuarters={periods.quarters}
        excludeMaintenance={excludeMaintenance}
        onExcludeMaintenanceChange={setExcludeMaintenance}
      />

      {scopedMember ? (
        <MemberDetailView
          member={scopedMember}
          summary={
            summaries.find((s) => s.memberName === scopedMember) ?? null
          }
          activePeriodMonth={
            periodMode === "month" ? effectivePeriodValue : null
          }
        />
      ) : (
        <TeamOverview
          summaries={summaries}
          activePeriodMonth={
            periodMode === "month" ? effectivePeriodValue : null
          }
        />
      )}
    </Stack>
  );
}

// =============================================================================
// Filter bar — Queue + Period selectors
// =============================================================================

function FilterBar({
  queueFilter,
  onQueueChange,
  periodMode,
  onPeriodModeChange,
  periodValue,
  onPeriodValueChange,
  availableMonths,
  availableQuarters,
  excludeMaintenance,
  onExcludeMaintenanceChange,
}: {
  queueFilter: Queue | "all";
  onQueueChange: (q: Queue | "all") => void;
  periodMode: "all" | "month" | "quarter";
  onPeriodModeChange: (m: "all" | "month" | "quarter") => void;
  periodValue: string | null;
  onPeriodValueChange: (v: string | null) => void;
  availableMonths: string[];
  availableQuarters: string[];
  excludeMaintenance: boolean;
  onExcludeMaintenanceChange: (v: boolean) => void;
}) {
  const periodOptions = useMemo(() => {
    if (periodMode === "month") {
      return availableMonths.map((v) => ({
        value: v,
        label: formatMonthLabel(v),
      }));
    }
    if (periodMode === "quarter") {
      return availableQuarters.map((v) => ({ value: v, label: v }));
    }
    return [];
  }, [periodMode, availableMonths, availableQuarters]);

  return (
    <Card withBorder radius="md" p="sm">
      <Group gap="md" wrap="wrap">
        <Group gap={6} wrap="nowrap">
          <ThemeIcon
            variant="light"
            color="gray"
            radius="md"
            size="sm"
            aria-label="Queue filter"
          >
            <IconFilter size={12} />
          </ThemeIcon>
          <Text size="xs" c="dimmed" fw={600}>
            Queue
          </Text>
          <SegmentedControl
            size="xs"
            value={queueFilter}
            onChange={(v) => onQueueChange(v as Queue | "all")}
            data={[
              { value: "all", label: "All" },
              { value: "noc", label: "NOC" },
              { value: "mobility", label: "Mobility" },
            ]}
          />
        </Group>

        <Group gap={6} wrap="nowrap">
          <ThemeIcon
            variant="light"
            color="gray"
            radius="md"
            size="sm"
            aria-label="Period filter"
          >
            <IconCalendar size={12} />
          </ThemeIcon>
          <Text size="xs" c="dimmed" fw={600}>
            Period
          </Text>
          <SegmentedControl
            size="xs"
            value={periodMode}
            onChange={(v) =>
              onPeriodModeChange(v as "all" | "month" | "quarter")
            }
            data={[
              { value: "all", label: "All time" },
              { value: "month", label: "Month" },
              { value: "quarter", label: "Quarter" },
            ]}
          />
          {periodMode !== "all" && periodOptions.length > 0 && (
            <Select
              size="xs"
              w={170}
              data={periodOptions}
              value={periodValue}
              onChange={onPeriodValueChange}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
            />
          )}
          {periodMode !== "all" && periodOptions.length === 0 && (
            <Text size="xs" c="dimmed" fs="italic">
              (no {periodMode} data yet)
            </Text>
          )}
        </Group>

        {/* Maintenance-notification toggle (tickets only) */}
        <Group gap={6} wrap="nowrap">
          <ThemeIcon
            variant="light"
            color="gray"
            radius="md"
            size="sm"
            aria-label="Ticket category filter"
          >
            <IconTool size={12} />
          </ThemeIcon>
          <Tooltip
            label="When ON, ticket rows whose Issue Type is 'Maintenance Notification' are excluded from ticket KPIs. Call data is not affected."
            withinPortal
            multiline
            w={280}
          >
            <Switch
              size="xs"
              checked={excludeMaintenance}
              onChange={(e) =>
                onExcludeMaintenanceChange(e.currentTarget.checked)
              }
              label="Exclude maintenance"
              styles={{ label: { fontSize: 11, fontWeight: 600 } }}
            />
          </Tooltip>
        </Group>
      </Group>
    </Card>
  );
}

function formatMonthLabel(yyyyMm: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyyMm);
  if (!m) return yyyyMm;
  const date = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1);
  return date.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

// =============================================================================
// Team-wide view
// =============================================================================

function TeamOverview({
  summaries,
  activePeriodMonth,
}: {
  summaries: MemberSummary[];
  activePeriodMonth: string | null;
}) {
  // Track which source types have any data — only render their cards
  const hasTickets = summaries.some((s) => (s.byType.tickets?.rowCount ?? 0) > 0);
  const hasCalls = summaries.some((s) => (s.byType.calls?.rowCount ?? 0) > 0);
  const hasTasks = summaries.some((s) => (s.byType.tasks?.rowCount ?? 0) > 0);

  return (
    <Stack gap="lg">
      <Box>
        <Group gap="xs" mb="xs">
          <ThemeIcon variant="light" radius="md" size="md" color="green">
            <IconUsersGroup size={16} />
          </ThemeIcon>
          <Title order={5}>Team-wide performance</Title>
          <Badge variant="default" size="xs">
            {LOCKED_TEAM.length} members
          </Badge>
        </Group>
        <Text size="xs" c="dimmed">
          Aggregated across all imports matching the filters above. Manager
          view — drill into individuals via the View dropdown.
        </Text>
      </Box>

      <Grid gutter="md">
        {hasTickets && (
          <Grid.Col span={{ base: 12, lg: 12 }}>
            <TicketsKpiCard
              summaries={summaries}
              activePeriodMonth={activePeriodMonth}
            />
          </Grid.Col>
        )}
        {hasCalls && (
          <Grid.Col span={{ base: 12, lg: 12 }}>
            <CallsKpiCard summaries={summaries} />
          </Grid.Col>
        )}
        {hasTasks && (
          <Grid.Col span={{ base: 12, lg: 12 }}>
            <TasksKpiCard summaries={summaries} />
          </Grid.Col>
        )}
        {/* Generic legacy cards for queue/audit until they get
            user-defined KPIs of their own. */}
        {(["queue", "audit"] as SourceType[]).map((t) =>
          summaries.some((s) => (s.byType[t]?.rowCount ?? 0) > 0) ? (
            <Grid.Col key={t} span={{ base: 12, md: 6 }}>
              <GenericSourceCard sourceType={t} summaries={summaries} />
            </Grid.Col>
          ) : null,
        )}
      </Grid>
    </Stack>
  );
}

// =============================================================================
// Tickets KPI Card — NEW shape
// Top stats:  Tickets Acked · Avg Ack Time · Time-to-Carrier (% under 15)
// Per-member rows: tickets acked + within-24h%
// =============================================================================

function TicketsKpiCard({
  summaries,
  activePeriodMonth,
}: {
  summaries: MemberSummary[];
  activePeriodMonth: string | null;
}) {
  const [diagMember, setDiagMember] = useState<string | null>(null);

  const rows = summaries
    .map((s) => {
      const b = s.byType.tickets;
      if (!b || b.rowCount === 0) return null;
      const avgAck =
        b.ackMinutesSamples > 0 ? b.ackMinutesSum / b.ackMinutesSamples : null;
      const carrierPct =
        b.carrierTotalCount > 0
          ? (b.carrierUnder15Count / b.carrierTotalCount) * 100
          : null;
      // % of tickets closed within 24h, computed from
      // time_taken_to_close_tickets ("less than 24 hours" vs "more than
      // 24 hours"). Blank cells are excluded from BOTH numerator and
      // denominator so the percentage reflects only closed tickets that
      // had a value in the column.
      const within24Pct =
        b.within24TotalCount > 0
          ? (b.within24Count / b.within24TotalCount) * 100
          : null;
      const avgMttr =
        b.mttrMinutesSamples > 0
          ? b.mttrMinutesSum / b.mttrMinutesSamples
          : null;
      return {
        name: s.memberName,
        acked: b.rowCount,
        avgAck,
        carrierPct,
        carrierUnder: b.carrierUnder15Count,
        carrierTotal: b.carrierTotalCount,
        within24Pct,
        within24: b.within24Count,
        within24Total: b.within24TotalCount,
        avgMttr,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.acked - a.acked);

  const grandAcked = rows.reduce((s, r) => s + r.acked, 0);
  const grandAck =
    rows.length > 0
      ? rows.reduce((s, r) => s + (r.avgAck ?? 0) * (r.avgAck ? 1 : 0), 0) /
        Math.max(rows.filter((r) => r.avgAck != null).length, 1)
      : null;
  const grandCarrierUnder = rows.reduce((s, r) => s + r.carrierUnder, 0);
  const grandCarrierTotal = rows.reduce((s, r) => s + r.carrierTotal, 0);
  const grandCarrierPct =
    grandCarrierTotal > 0
      ? (grandCarrierUnder / grandCarrierTotal) * 100
      : null;
  const grandWithin24 = rows.reduce((s, r) => s + r.within24, 0);
  const grandWithin24Total = rows.reduce((s, r) => s + r.within24Total, 0);
  const grandWithin24Pct =
    grandWithin24Total > 0 ? (grandWithin24 / grandWithin24Total) * 100 : null;

  const maxAcked = rows.length > 0 ? Math.max(...rows.map((r) => r.acked)) : 0;

  return (
    <Card
      withBorder
      radius="md"
      p="md"
      style={{ borderTop: "2px solid var(--mantine-color-blue-6)" }}
    >
      <Stack gap="md">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon radius="md" variant="light" color="blue" size="lg">
            <IconTicket size={20} />
          </ThemeIcon>
          <Box style={{ flex: 1 }}>
            <Title order={5} style={{ lineHeight: 1.2 }}>
              Tickets
            </Title>
            <Text size="xs" c="dimmed">
              {rows.length} contributor{rows.length === 1 ? "" : "s"}
            </Text>
          </Box>
          <Group gap="lg" wrap="wrap" justify="flex-end">
            <KpiNumber
              label="Tickets Acked"
              value={grandAcked.toLocaleString()}
              color="blue"
            />
            <KpiNumber
              label="Avg Ack Time"
              value={grandAck != null ? formatMinutes(grandAck) : "—"}
              hint="from first_touch"
            />
            <KpiNumber
              label="Within 24h"
              value={
                grandWithin24Pct != null
                  ? `${Math.round(grandWithin24Pct)}%`
                  : "—"
              }
              hint={
                grandWithin24Total > 0
                  ? `${grandWithin24} / ${grandWithin24Total}`
                  : "no data"
              }
              color="grape"
            />
            <KpiNumber
              label="Carrier ≤ 15 min"
              value={
                grandCarrierPct != null
                  ? `${Math.round(grandCarrierPct)}%`
                  : "—"
              }
              hint={
                grandCarrierTotal > 0
                  ? `${grandCarrierUnder} / ${grandCarrierTotal}`
                  : "no data"
              }
              color="teal"
            />
          </Group>
        </Group>

        <Stack gap={4}>
          {rows.map((r) => {
            const tier = tierFor(r.name);
            const bar = maxAcked > 0 ? (r.acked / maxAcked) * 100 : 0;
            return (
              <Group gap="sm" wrap="nowrap" key={r.name}>
                <Box style={{ width: 160, flexShrink: 0 }}>
                  <Group gap={4} wrap="nowrap">
                    <Text size="xs" truncate fw={500}>
                      {r.name}
                    </Text>
                    {tier && (
                      <Badge
                        size="xs"
                        variant="light"
                        color={TIER_COLORS[tier]}
                        style={{ flexShrink: 0 }}
                      >
                        {TIER_SHORT_LABELS[tier]}
                      </Badge>
                    )}
                  </Group>
                </Box>
                <Tooltip
                  label={
                    <>
                      <div>Tickets acked: {r.acked.toLocaleString()}</div>
                      <div>
                        Avg ack time:{" "}
                        {r.avgAck != null ? formatMinutes(r.avgAck) : "—"}
                      </div>
                      <div>
                        Within 24h:{" "}
                        {r.within24Pct != null
                          ? `${Math.round(r.within24Pct)}% (${r.within24}/${r.within24Total})`
                          : "—"}
                      </div>
                      <div>
                        Carrier ≤ 15 min:{" "}
                        {r.carrierPct != null
                          ? `${Math.round(r.carrierPct)}% (${r.carrierUnder}/${r.carrierTotal})`
                          : "—"}
                      </div>
                      <div>
                        Avg MTTR:{" "}
                        {r.avgMttr != null ? formatMinutes(r.avgMttr) : "—"}
                      </div>
                    </>
                  }
                  withinPortal
                >
                  <Box style={{ flex: 1 }}>
                    <Progress value={bar} color="blue" size="md" radius="sm" />
                  </Box>
                </Tooltip>
                <Box style={{ width: 78, flexShrink: 0, textAlign: "right" }}>
                  <Text size="xs" ff="monospace" fw={600}>
                    {r.acked.toLocaleString()}
                  </Text>
                  <Text size="xs" c="dimmed" ff="monospace">
                    {r.avgAck != null ? formatMinutes(r.avgAck) : "—"}
                  </Text>
                </Box>
                <Tooltip
                  label="Inspect — see which months this member's tickets are in"
                  withinPortal
                >
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="blue"
                    onClick={() => setDiagMember(r.name)}
                    aria-label="Inspect"
                  >
                    <IconSearch size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            );
          })}
        </Stack>
      </Stack>

      <TicketDiagnosticsModal
        memberName={diagMember}
        activePeriodMonth={activePeriodMonth}
        onClose={() => setDiagMember(null)}
      />
    </Card>
  );
}

// =============================================================================
// Diagnostics Modal — "Why is my count 61 instead of 162?"
// Shows the per-period breakdown for one member, plus a sample of raw_json
// snippets so the user can see exactly which column values determined the
// month resolution.
// =============================================================================

function TicketDiagnosticsModal({
  memberName,
  activePeriodMonth,
  onClose,
}: {
  memberName: string | null;
  activePeriodMonth: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<MemberTicketDiagnostic | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!memberName) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    diagnoseMemberTickets(memberName, {
      samplePeriod: activePeriodMonth,
      sampleSize: 10,
    })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [memberName, activePeriodMonth]);

  return (
    <Modal
      opened={memberName != null}
      onClose={onClose}
      title={
        memberName ? (
          <Group gap="xs">
            <IconSearch size={16} />
            <Text fw={600}>Ticket diagnostics — {memberName}</Text>
          </Group>
        ) : (
          "Ticket diagnostics"
        )
      }
      size="xl"
      withinPortal
    >
      {loading && (
        <Group justify="center" p="lg">
          <Loader size="sm" />
        </Group>
      )}
      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}
      {!loading && !error && data && (
        <Stack gap="md">
          <Group gap="md" wrap="wrap">
            <Box>
              <Text size="xs" c="dimmed">
                Total ticket rows in DB
              </Text>
              <Text fw={700} size="xl" ff="monospace">
                {data.totalRows.toLocaleString()}
              </Text>
            </Box>
            {activePeriodMonth && (
              <Box>
                <Text size="xs" c="dimmed">
                  Rows for {formatMonthLabel(activePeriodMonth)}
                </Text>
                <Text fw={700} size="xl" ff="monospace" c="blue.4">
                  {(
                    data.byPeriod.find(
                      (p) => p.period_month === activePeriodMonth,
                    )?.count ?? 0
                  ).toLocaleString()}
                </Text>
              </Box>
            )}
            {data.byPeriod.find((p) => p.period_month == null) && (
              <Box>
                <Text size="xs" c="dimmed">
                  Rows with NO period (excluded from any month/quarter filter)
                </Text>
                <Text fw={700} size="xl" ff="monospace" c="orange.4">
                  {(
                    data.byPeriod.find((p) => p.period_month == null)?.count ??
                    0
                  ).toLocaleString()}
                </Text>
              </Box>
            )}
          </Group>

          <Box>
            <Text fw={600} size="sm" mb={4}>
              Distribution by period_month
            </Text>
            <Text size="xs" c="dimmed" mb="xs">
              Each ticket row gets one period_month value (derived from the{" "}
              <Code>month</Code> column &mdash; column B &mdash; with{" "}
              <Code>month_label</Code> as a fallback for legacy data). This
              shows exactly how the {data.totalRows} ticket rows are split
              across months. The "Tickets Acked" count for any selected month
              = the number of rows whose period_month matches that selection.
            </Text>
            <Table withTableBorder withColumnBorders striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>period_month</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>Count</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.byPeriod.map((p) => (
                  <Table.Tr
                    key={p.period_month ?? "__null__"}
                    style={
                      p.period_month === activePeriodMonth
                        ? {
                            background:
                              "rgba(34, 139, 230, 0.12)",
                            fontWeight: 600,
                          }
                        : p.period_month == null
                          ? { color: "var(--mantine-color-orange-4)" }
                          : undefined
                    }
                  >
                    <Table.Td>
                      <Code>{p.period_month ?? "NULL"}</Code>
                      {p.period_month && (
                        <Text component="span" size="xs" c="dimmed" ml="xs">
                          {formatMonthLabel(p.period_month)}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }}>
                      {p.count.toLocaleString()}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>

          <Box>
            <Group gap="xs" mb={4}>
              <Text fw={600} size="sm">
                Sample raw rows
                {activePeriodMonth
                  ? ` for ${formatMonthLabel(activePeriodMonth)}`
                  : ""}
              </Text>
              <Tooltip
                label="What this shows: the exact column values stored in raw_json that determined the month. The parser uses `month` (column B) as the primary source, with `month_label` as a fallback. If period_month doesn't match what column B says, that's a parser issue."
                withinPortal
                multiline
                w={320}
              >
                <ThemeIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  radius="xl"
                >
                  <IconInfoCircle size={12} />
                </ThemeIcon>
              </Tooltip>
            </Group>
            {data.samples.length === 0 ? (
              <Text size="xs" c="dimmed">
                No rows to sample.
              </Text>
            ) : (
              <ScrollArea h={280}>
                <Stack gap="xs">
                  {data.samples.map((s) => (
                    <Card
                      key={s.id}
                      withBorder
                      radius="sm"
                      p="xs"
                      style={{
                        background: "var(--mantine-color-dark-7)",
                      }}
                    >
                      <Group gap="xs" wrap="wrap" mb={4}>
                        <Badge size="xs" variant="light" color="gray">
                          id #{s.id}
                        </Badge>
                        <Badge
                          size="xs"
                          variant="light"
                          color={
                            s.period_month === activePeriodMonth
                              ? "blue"
                              : s.period_month == null
                                ? "orange"
                                : "gray"
                          }
                        >
                          period_month: {s.period_month ?? "NULL"}
                        </Badge>
                        <Badge size="xs" variant="light" color="gray">
                          quarter: {s.period_quarter ?? "NULL"}
                        </Badge>
                        <Badge size="xs" variant="light" color="gray">
                          queue: {s.queue ?? "NULL"}
                        </Badge>
                      </Group>
                      <Code
                        block
                        style={{
                          fontSize: 11,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {Object.keys(s.rawSnapshot).length === 0
                          ? "(no month-related columns found in raw_json)"
                          : JSON.stringify(s.rawSnapshot, null, 2)}
                      </Code>
                    </Card>
                  ))}
                </Stack>
              </ScrollArea>
            )}
          </Box>
        </Stack>
      )}
    </Modal>
  );
}

// =============================================================================
// Calls KPI Card — NEW shape
// Top stats: Inbound Calls (Answered) · Refused Calls · Avg Handle Time · Avg Speed of Answer
// Per-member rows: answered + refused
// =============================================================================

function CallsKpiCard({ summaries }: { summaries: MemberSummary[] }) {
  const rows = summaries
    .map((s) => {
      const b = s.byType.calls;
      if (!b || b.rowCount === 0) return null;
      const avgHandle =
        b.handleSecondsSamples > 0
          ? b.handleSecondsSum / b.handleSecondsSamples
          : null;
      const avgWait =
        b.waitSecondsSamples > 0
          ? b.waitSecondsSum / b.waitSecondsSamples
          : null;
      return {
        name: s.memberName,
        answered: b.answeredCount,
        refused: b.refusedCount,
        missed: b.missedCount,
        avgHandle,
        avgWait,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.answered - a.answered);

  const grandAnswered = rows.reduce((s, r) => s + r.answered, 0);
  const grandRefused = rows.reduce((s, r) => s + r.refused, 0);
  const grandHandleSum = rows.reduce((s, r) => s + (r.avgHandle ?? 0), 0);
  const grandHandleCount = rows.filter((r) => r.avgHandle != null).length;
  const grandWaitSum = rows.reduce((s, r) => s + (r.avgWait ?? 0), 0);
  const grandWaitCount = rows.filter((r) => r.avgWait != null).length;
  const avgHandleAll =
    grandHandleCount > 0 ? grandHandleSum / grandHandleCount : null;
  const avgWaitAll =
    grandWaitCount > 0 ? grandWaitSum / grandWaitCount : null;

  const maxAnswered =
    rows.length > 0 ? Math.max(...rows.map((r) => r.answered)) : 0;

  return (
    <Card
      withBorder
      radius="md"
      p="md"
      style={{ borderTop: "2px solid var(--mantine-color-green-6)" }}
    >
      <Stack gap="md">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon radius="md" variant="light" color="green" size="lg">
            <IconPhone size={20} />
          </ThemeIcon>
          <Box style={{ flex: 1 }}>
            <Title order={5} style={{ lineHeight: 1.2 }}>
              Inbound Calls
            </Title>
            <Text size="xs" c="dimmed">
              {rows.length} contributor{rows.length === 1 ? "" : "s"}
            </Text>
          </Box>
          <Group gap="lg" wrap="wrap" justify="flex-end">
            <KpiNumber
              label="Answered"
              value={grandAnswered.toLocaleString()}
              color="green"
              icon={<IconPhoneIncoming size={12} />}
            />
            <KpiNumber
              label="Refused"
              value={grandRefused.toLocaleString()}
              color="red"
              hint="no answer (by other)"
              icon={<IconPhoneX size={12} />}
            />
            <KpiNumber
              label="Avg Handle"
              value={avgHandleAll != null ? formatSeconds(avgHandleAll) : "—"}
              hint="from Duration"
            />
            <KpiNumber
              label="Avg Speed of Answer"
              value={avgWaitAll != null ? formatSeconds(avgWaitAll) : "—"}
              hint="from Wait Time"
              color="teal"
            />
          </Group>
        </Group>

        <Stack gap={4}>
          {rows.map((r) => {
            const tier = tierFor(r.name);
            const bar = maxAnswered > 0 ? (r.answered / maxAnswered) * 100 : 0;
            return (
              <Group gap="sm" wrap="nowrap" key={r.name}>
                <Box style={{ width: 160, flexShrink: 0 }}>
                  <Group gap={4} wrap="nowrap">
                    <Text size="xs" truncate fw={500}>
                      {r.name}
                    </Text>
                    {tier && (
                      <Badge
                        size="xs"
                        variant="light"
                        color={TIER_COLORS[tier]}
                        style={{ flexShrink: 0 }}
                      >
                        {TIER_SHORT_LABELS[tier]}
                      </Badge>
                    )}
                  </Group>
                </Box>
                <Tooltip
                  label={
                    <>
                      <div>Answered: {r.answered}</div>
                      <div>Refused: {r.refused}</div>
                      <div>Other missed: {r.missed}</div>
                      <div>
                        Avg handle:{" "}
                        {r.avgHandle != null ? formatSeconds(r.avgHandle) : "—"}
                      </div>
                      <div>
                        Avg speed of answer:{" "}
                        {r.avgWait != null ? formatSeconds(r.avgWait) : "—"}
                      </div>
                    </>
                  }
                  withinPortal
                >
                  <Box style={{ flex: 1 }}>
                    <Progress
                      value={bar}
                      color="green"
                      size="md"
                      radius="sm"
                    />
                  </Box>
                </Tooltip>
                <Box style={{ width: 88, flexShrink: 0, textAlign: "right" }}>
                  <Text size="xs" ff="monospace" fw={600} c="green.4">
                    {r.answered.toLocaleString()}
                  </Text>
                  <Text
                    size="xs"
                    ff="monospace"
                    c={r.refused > 0 ? "red.4" : "dimmed"}
                  >
                    {r.refused} refused
                  </Text>
                </Box>
              </Group>
            );
          })}
        </Stack>
      </Stack>
    </Card>
  );
}

// =============================================================================
// Tasks KPI Card
// Top stats: Total Tasks Worked · SLA-Met %
// Per-member rows: tasks + SLA-Met %
// =============================================================================

function TasksKpiCard({ summaries }: { summaries: MemberSummary[] }) {
  const rows = summaries
    .map((s) => {
      const b = s.byType.tasks;
      if (!b || b.rowCount === 0) return null;
      const slaPct =
        b.slaMetTotalCount > 0
          ? (b.slaMetCount / b.slaMetTotalCount) * 100
          : null;
      return {
        name: s.memberName,
        tasks: b.rowCount,
        slaMet: b.slaMetCount,
        slaTotal: b.slaMetTotalCount,
        slaPct,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.tasks - a.tasks);

  const grandTasks = rows.reduce((s, r) => s + r.tasks, 0);
  const grandSlaMet = rows.reduce((s, r) => s + r.slaMet, 0);
  const grandSlaTotal = rows.reduce((s, r) => s + r.slaTotal, 0);
  const grandSlaPct =
    grandSlaTotal > 0 ? (grandSlaMet / grandSlaTotal) * 100 : null;

  const maxTasks = rows.length > 0 ? Math.max(...rows.map((r) => r.tasks)) : 0;

  return (
    <Card
      withBorder
      radius="md"
      p="md"
      style={{ borderTop: "2px solid var(--mantine-color-orange-6)" }}
    >
      <Stack gap="md">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon radius="md" variant="light" color="orange" size="lg">
            <IconClipboardList size={20} />
          </ThemeIcon>
          <Box style={{ flex: 1 }}>
            <Title order={5} style={{ lineHeight: 1.2 }}>
              Tasks
            </Title>
            <Text size="xs" c="dimmed">
              {rows.length} contributor{rows.length === 1 ? "" : "s"}
            </Text>
          </Box>
          <Group gap="lg" wrap="wrap" justify="flex-end">
            <KpiNumber
              label="Total Tasks Worked"
              value={grandTasks.toLocaleString()}
              color="orange"
            />
            <KpiNumber
              label="SLA-Met"
              value={
                grandSlaPct != null ? `${Math.round(grandSlaPct)}%` : "—"
              }
              hint={
                grandSlaTotal > 0
                  ? `${grandSlaMet} / ${grandSlaTotal}`
                  : "no Y/N data"
              }
              color="teal"
            />
          </Group>
        </Group>

        <Stack gap={4}>
          {rows.map((r) => {
            const tier = tierFor(r.name);
            const bar = maxTasks > 0 ? (r.tasks / maxTasks) * 100 : 0;
            return (
              <Group gap="sm" wrap="nowrap" key={r.name}>
                <Box style={{ width: 160, flexShrink: 0 }}>
                  <Group gap={4} wrap="nowrap">
                    <Text size="xs" truncate fw={500}>
                      {r.name}
                    </Text>
                    {tier && (
                      <Badge
                        size="xs"
                        variant="light"
                        color={TIER_COLORS[tier]}
                        style={{ flexShrink: 0 }}
                      >
                        {TIER_SHORT_LABELS[tier]}
                      </Badge>
                    )}
                  </Group>
                </Box>
                <Tooltip
                  label={
                    <>
                      <div>Tasks worked: {r.tasks.toLocaleString()}</div>
                      <div>
                        SLA-Met:{" "}
                        {r.slaPct != null
                          ? `${Math.round(r.slaPct)}% (${r.slaMet}/${r.slaTotal})`
                          : "—"}
                      </div>
                    </>
                  }
                  withinPortal
                >
                  <Box style={{ flex: 1 }}>
                    <Progress
                      value={bar}
                      color="orange"
                      size="md"
                      radius="sm"
                    />
                  </Box>
                </Tooltip>
                <Box style={{ width: 88, flexShrink: 0, textAlign: "right" }}>
                  <Text size="xs" ff="monospace" fw={600} c="orange.4">
                    {r.tasks.toLocaleString()}
                  </Text>
                  <Text size="xs" ff="monospace" c="dimmed">
                    {r.slaPct != null ? `${Math.round(r.slaPct)}% SLA` : "—"}
                  </Text>
                </Box>
              </Group>
            );
          })}
        </Stack>
      </Stack>
    </Card>
  );
}

// =============================================================================
// Generic source card (queue / audit) — legacy shape preserved
// =============================================================================

interface GenericConfig {
  label: string;
  icon: ComponentType<{ size?: number }>;
  color: string;
  totalLabel: string;
  successLabel: string;
  showDuration: boolean;
  showScore: boolean;
}

const GENERIC_CONFIGS: Record<SourceType, GenericConfig> = {
  tickets: {
    label: "Tickets",
    icon: IconTicket,
    color: "blue",
    totalLabel: "Owned",
    successLabel: "Within 24h",
    showDuration: true,
    showScore: false,
  },
  calls: {
    label: "Inbound Calls",
    icon: IconPhone,
    color: "green",
    totalLabel: "Calls",
    successLabel: "Answered",
    showDuration: true,
    showScore: false,
  },
  tasks: {
    label: "Tasks",
    icon: IconClipboardList,
    color: "violet",
    totalLabel: "Tasks",
    successLabel: "Completed",
    showDuration: false,
    showScore: false,
  },
  queue: {
    label: "Queue Availability",
    icon: IconClock,
    color: "orange",
    totalLabel: "Sessions",
    successLabel: "",
    showDuration: true,
    showScore: true,
  },
  audit: {
    label: "Audit",
    icon: IconShieldCheck,
    color: "pink",
    totalLabel: "Audits",
    successLabel: "Passed",
    showDuration: false,
    showScore: true,
  },
};

function GenericSourceCard({
  sourceType,
  summaries,
}: {
  sourceType: SourceType;
  summaries: MemberSummary[];
}) {
  const config = GENERIC_CONFIGS[sourceType];
  const rows = summaries
    .map((s) => ({
      name: s.memberName,
      b: s.byType[sourceType],
    }))
    .filter((r) => r.b && r.b.rowCount > 0)
    .map((r) => ({
      name: r.name,
      total: r.b!.totalSum,
      success: r.b!.successSum,
      duration: r.b!.durationSum,
      score: r.b!.latestScore,
      scoreText: r.b!.latestScoreText,
      rowCount: r.b!.rowCount,
    }))
    .sort((a, b) => {
      if (config.showScore && (a.score != null || b.score != null)) {
        return (b.score ?? -1) - (a.score ?? -1);
      }
      return b.total - a.total;
    });

  const grandTotal = rows.reduce((n, r) => n + r.total, 0);
  const grandSuccess = rows.reduce((n, r) => n + r.success, 0);
  const grandDuration = rows.reduce((n, r) => n + r.duration, 0);
  const maxTotal = rows.length > 0 ? Math.max(...rows.map((r) => r.total)) : 0;

  const Icon = config.icon;

  return (
    <Card
      withBorder
      radius="md"
      p="md"
      h="100%"
      style={{
        borderTop: `2px solid var(--mantine-color-${config.color}-6)`,
      }}
    >
      <Stack gap="sm">
        <Group gap="sm">
          <ThemeIcon radius="md" variant="light" color={config.color} size="lg">
            <Icon size={20} />
          </ThemeIcon>
          <Box style={{ flex: 1 }}>
            <Title order={5}>{config.label}</Title>
            <Text size="xs" c="dimmed">
              {rows.length} contributor{rows.length === 1 ? "" : "s"}
            </Text>
          </Box>
          <Stack gap={0} align="flex-end">
            <Text
              size="lg"
              fw={700}
              ff="monospace"
              c={`${config.color}.4`}
            >
              {grandTotal.toLocaleString()}
            </Text>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              {config.totalLabel}
            </Text>
          </Stack>
        </Group>
        <Group gap="lg">
          {config.successLabel && grandSuccess > 0 && (
            <Box>
              <Text size="xs" c="dimmed">
                {config.successLabel}
              </Text>
              <Text size="sm" fw={600} ff="monospace">
                {grandSuccess.toLocaleString()}
                {grandTotal > 0 && (
                  <Text component="span" size="xs" c="dimmed" ml={4}>
                    ({Math.round((grandSuccess / grandTotal) * 100)}%)
                  </Text>
                )}
              </Text>
            </Box>
          )}
          {config.showDuration && grandDuration > 0 && (
            <Box>
              <Text size="xs" c="dimmed">
                Duration
              </Text>
              <Text size="sm" fw={600} ff="monospace">
                {formatMinutes(grandDuration)}
              </Text>
            </Box>
          )}
        </Group>
        <Stack gap={4}>
          {rows.map((r) => {
            const tier = tierFor(r.name);
            const bar = maxTotal > 0 ? (r.total / maxTotal) * 100 : 0;
            return (
              <Group gap="sm" wrap="nowrap" key={r.name}>
                <Box style={{ width: 140, flexShrink: 0 }}>
                  <Group gap={4} wrap="nowrap">
                    <Text size="xs" truncate fw={500}>
                      {r.name}
                    </Text>
                    {tier && (
                      <Badge
                        size="xs"
                        variant="light"
                        color={TIER_COLORS[tier]}
                      >
                        {TIER_SHORT_LABELS[tier]}
                      </Badge>
                    )}
                  </Group>
                </Box>
                <Box style={{ flex: 1 }}>
                  <Progress value={bar} color={config.color} size="md" />
                </Box>
                <Box style={{ width: 60, textAlign: "right" }}>
                  <Text size="xs" ff="monospace" fw={600}>
                    {config.showScore && r.scoreText
                      ? r.scoreText
                      : r.total.toLocaleString()}
                  </Text>
                </Box>
              </Group>
            );
          })}
        </Stack>
      </Stack>
    </Card>
  );
}

// =============================================================================
// Single-member detail view
// =============================================================================

function MemberDetailView({
  member,
  summary,
  activePeriodMonth,
}: {
  member: string;
  summary: MemberSummary | null;
  activePeriodMonth: string | null;
}) {
  const [diagOpen, setDiagOpen] = useState(false);
  const tier = tierFor(member);
  const hasData =
    (summary?.byType && Object.keys(summary.byType).length > 0) ?? false;

  const tickets = summary?.byType.tickets;
  const calls = summary?.byType.calls;

  return (
    <Stack gap="lg">
      <Card
        withBorder
        radius="md"
        p="md"
        style={{
          borderColor: tier
            ? `var(--mantine-color-${TIER_COLORS[tier]}-7)`
            : undefined,
        }}
      >
        <Group justify="space-between">
          <Group gap="md">
            <Box
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: tier
                  ? `var(--mantine-color-${TIER_COLORS[tier]}-9)`
                  : "var(--mantine-color-dark-5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: tier
                  ? `var(--mantine-color-${TIER_COLORS[tier]}-2)`
                  : "var(--mantine-color-dimmed)",
                fontWeight: 700,
                fontSize: 18,
              }}
            >
              {member
                .split(" ")
                .map((p) => p[0])
                .slice(0, 2)
                .join("")}
            </Box>
            <Box>
              <Title order={4}>{member}</Title>
              <Group gap="xs">
                {tier && (
                  <Badge variant="light" color={TIER_COLORS[tier]}>
                    {TIER_LABELS[tier]}
                  </Badge>
                )}
              </Group>
            </Box>
          </Group>
          {(tickets?.rowCount ?? 0) > 0 && (
            <Tooltip
              label="Inspect ticket rows — see which months they're in"
              withinPortal
            >
              <ActionIcon
                size="md"
                variant="light"
                color="blue"
                onClick={() => setDiagOpen(true)}
                aria-label="Inspect tickets"
              >
                <IconSearch size={16} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Card>

      <TicketDiagnosticsModal
        memberName={diagOpen ? member : null}
        activePeriodMonth={activePeriodMonth}
        onClose={() => setDiagOpen(false)}
      />

      {!hasData ? (
        <Card withBorder radius="md" p="xl">
          <Stack align="center" gap="sm">
            <IconClipboardCheck size={40} color="var(--mantine-color-dimmed)" />
            <Text size="sm" c="dimmed" ta="center">
              No metrics for {member} in the selected queue + period.
            </Text>
          </Stack>
        </Card>
      ) : (
        <Grid gutter="md">
          {tickets && tickets.rowCount > 0 && (
            <Grid.Col span={{ base: 12, md: 6 }}>
              <MemberTicketCard b={tickets} />
            </Grid.Col>
          )}
          {calls && calls.rowCount > 0 && (
            <Grid.Col span={{ base: 12, md: 6 }}>
              <MemberCallCard b={calls} />
            </Grid.Col>
          )}
          {summary?.byType.tasks && summary.byType.tasks.rowCount > 0 && (
            <Grid.Col span={{ base: 12, md: 6 }}>
              <MemberTaskCard b={summary.byType.tasks} />
            </Grid.Col>
          )}
          {/* Queue / Audit still use the generic shape */}
          {(["queue", "audit"] as SourceType[]).map((t) => {
            const b = summary?.byType[t];
            if (!b || b.rowCount === 0) return null;
            return (
              <Grid.Col key={t} span={{ base: 12, sm: 6, lg: 4 }}>
                <MemberGenericCard sourceType={t} b={b} />
              </Grid.Col>
            );
          })}
        </Grid>
      )}
    </Stack>
  );
}

function MemberTicketCard({ b }: { b: SourceBucket }) {
  const avgAck =
    b.ackMinutesSamples > 0 ? b.ackMinutesSum / b.ackMinutesSamples : null;
  const avgMttr =
    b.mttrMinutesSamples > 0 ? b.mttrMinutesSum / b.mttrMinutesSamples : null;
  const carrierPct =
    b.carrierTotalCount > 0
      ? (b.carrierUnder15Count / b.carrierTotalCount) * 100
      : null;
  // Within-24h % uses ONLY the rows where time_taken_to_close_tickets
  // had a recognised value ("less than 24 hours" / "more than 24 hours").
  // Blank cells (open tickets, etc.) are excluded from both numerator
  // and denominator.
  const within24Pct =
    b.within24TotalCount > 0
      ? (b.within24Count / b.within24TotalCount) * 100
      : null;

  return (
    <Card
      withBorder
      radius="md"
      p="md"
      h="100%"
      style={{ borderTop: "2px solid var(--mantine-color-blue-6)" }}
    >
      <Group gap="sm" mb="md">
        <ThemeIcon variant="light" color="blue" radius="md">
          <IconTicket size={16} />
        </ThemeIcon>
        <Text fw={600}>Tickets</Text>
      </Group>
      <Grid gutter="sm">
        <Grid.Col span={6}>
          <KpiBlock
            label="Tickets Acked"
            value={b.rowCount.toLocaleString()}
            color="blue"
          />
        </Grid.Col>
        <Grid.Col span={6}>
          <KpiBlock
            label="Avg Ack Time"
            value={avgAck != null ? formatMinutes(avgAck) : "—"}
            hint={`${b.ackMinutesSamples} sample${b.ackMinutesSamples === 1 ? "" : "s"}`}
          />
        </Grid.Col>
        <Grid.Col span={6}>
          <KpiBlock
            label="Carrier ≤ 15 min"
            value={carrierPct != null ? `${Math.round(carrierPct)}%` : "—"}
            hint={
              b.carrierTotalCount > 0
                ? `${b.carrierUnder15Count} / ${b.carrierTotalCount}`
                : "no data"
            }
            color="teal"
          />
        </Grid.Col>
        <Grid.Col span={6}>
          <KpiBlock
            label="Within 24h"
            value={within24Pct != null ? `${Math.round(within24Pct)}%` : "—"}
            hint={
              b.within24TotalCount > 0
                ? `${b.within24Count} / ${b.within24TotalCount}`
                : "no data"
            }
            color="grape"
          />
        </Grid.Col>
        <Grid.Col span={6}>
          <KpiBlock
            label="Avg MTTR"
            value={avgMttr != null ? formatMinutes(avgMttr) : "—"}
            hint={`${b.mttrMinutesSamples} sample${b.mttrMinutesSamples === 1 ? "" : "s"}`}
          />
        </Grid.Col>
      </Grid>
    </Card>
  );
}

function MemberCallCard({ b }: { b: SourceBucket }) {
  const avgHandle =
    b.handleSecondsSamples > 0
      ? b.handleSecondsSum / b.handleSecondsSamples
      : null;
  const avgWait =
    b.waitSecondsSamples > 0
      ? b.waitSecondsSum / b.waitSecondsSamples
      : null;

  return (
    <Card
      withBorder
      radius="md"
      p="md"
      h="100%"
      style={{ borderTop: "2px solid var(--mantine-color-green-6)" }}
    >
      <Group gap="sm" mb="md">
        <ThemeIcon variant="light" color="green" radius="md">
          <IconPhone size={16} />
        </ThemeIcon>
        <Text fw={600}>Inbound Calls</Text>
      </Group>
      <Grid gutter="sm">
        <Grid.Col span={6}>
          <KpiBlock
            label="Inbound Calls (Answered)"
            value={b.answeredCount.toLocaleString()}
            color="green"
          />
        </Grid.Col>
        <Grid.Col span={6}>
          <KpiBlock
            label="Refused Calls"
            value={b.refusedCount.toLocaleString()}
            color={b.refusedCount > 0 ? "red" : undefined}
            hint='"No Answer (Answered by Other)"'
          />
        </Grid.Col>
        <Grid.Col span={6}>
          <KpiBlock
            label="Avg Handle Time"
            value={avgHandle != null ? formatSeconds(avgHandle) : "—"}
            hint="from Duration"
          />
        </Grid.Col>
        <Grid.Col span={6}>
          <KpiBlock
            label="Avg Speed of Answer"
            value={avgWait != null ? formatSeconds(avgWait) : "—"}
            hint="from Wait Time"
            color="teal"
          />
        </Grid.Col>
      </Grid>
    </Card>
  );
}

function MemberTaskCard({ b }: { b: SourceBucket }) {
  const slaPct =
    b.slaMetTotalCount > 0
      ? (b.slaMetCount / b.slaMetTotalCount) * 100
      : null;

  return (
    <Card
      withBorder
      radius="md"
      p="md"
      h="100%"
      style={{ borderTop: "2px solid var(--mantine-color-orange-6)" }}
    >
      <Group gap="sm" mb="md">
        <ThemeIcon variant="light" color="orange" radius="md">
          <IconClipboardList size={16} />
        </ThemeIcon>
        <Text fw={600}>Tasks</Text>
      </Group>
      <Grid gutter="sm">
        <Grid.Col span={6}>
          <KpiBlock
            label="Total Tasks Worked"
            value={b.rowCount.toLocaleString()}
            color="orange"
          />
        </Grid.Col>
        <Grid.Col span={6}>
          <KpiBlock
            label="SLA-Met"
            value={slaPct != null ? `${Math.round(slaPct)}%` : "—"}
            hint={
              b.slaMetTotalCount > 0
                ? `${b.slaMetCount} / ${b.slaMetTotalCount}`
                : "no Y/N data"
            }
            color="teal"
          />
        </Grid.Col>
      </Grid>
    </Card>
  );
}

function MemberGenericCard({
  sourceType,
  b,
}: {
  sourceType: SourceType;
  b: SourceBucket;
}) {
  const cfg = GENERIC_CONFIGS[sourceType];
  const successRate =
    b.totalSum > 0 ? Math.round((b.successSum / b.totalSum) * 100) : null;
  const Icon = cfg.icon;

  return (
    <Card
      withBorder
      radius="md"
      p="md"
      h="100%"
      style={{ borderTop: `2px solid var(--mantine-color-${cfg.color}-6)` }}
    >
      <Group gap="sm" mb="xs">
        <ThemeIcon variant="light" color={cfg.color} radius="md">
          <Icon size={16} />
        </ThemeIcon>
        <Text fw={600} size="sm">
          {cfg.label}
        </Text>
      </Group>
      <Group gap="lg" align="flex-end" mb="xs">
        <Box>
          <Text size="xl" fw={700} ff="monospace" c={`${cfg.color}.4`}>
            {b.totalSum.toLocaleString() || "—"}
          </Text>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {cfg.totalLabel}
          </Text>
        </Box>
        {cfg.successLabel && b.successSum > 0 && (
          <Box>
            <Text size="md" fw={600} ff="monospace">
              {b.successSum.toLocaleString()}
            </Text>
            <Text size="xs" c="dimmed">
              {cfg.successLabel}
              {successRate != null && ` · ${successRate}%`}
            </Text>
          </Box>
        )}
      </Group>
      {cfg.showScore && b.latestScoreText && (
        <Box mt="xs">
          <Text size="xs" c="dimmed">
            Latest score
          </Text>
          <Text size="sm" fw={600} c={`${cfg.color}.4`}>
            {b.latestScoreText}
          </Text>
        </Box>
      )}
      {cfg.showDuration && b.durationSum > 0 && (
        <Box mt="xs">
          <Text size="xs" c="dimmed">
            Time logged
          </Text>
          <Text size="sm" fw={600}>
            {formatMinutes(b.durationSum)}
          </Text>
        </Box>
      )}
    </Card>
  );
}

// =============================================================================
// UI primitives
// =============================================================================

function KpiNumber({
  label,
  value,
  hint,
  color,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
  icon?: ReactNode;
}) {
  return (
    <Box ta="right">
      <Group gap={4} justify="flex-end">
        {icon && (
          <Box c={color ? `${color}.4` : undefined} style={{ display: "flex" }}>
            {icon}
          </Box>
        )}
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {label}
        </Text>
      </Group>
      <Text
        size="lg"
        fw={700}
        ff="monospace"
        c={color ? `${color}.4` : undefined}
      >
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Box>
  );
}

function KpiBlock({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  return (
    <Card withBorder radius="sm" p="sm" bg="var(--mantine-color-dark-6)">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text
        size="xl"
        fw={700}
        ff="monospace"
        c={color ? `${color}.4` : undefined}
        style={{ lineHeight: 1.2 }}
      >
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Card>
  );
}

function EmptyState() {
  return (
    <Card withBorder radius="md" p="xl">
      <Stack align="center" gap="md">
        <ThemeIcon size={56} radius="xl" variant="light" color="green">
          <IconUsersGroup size={28} />
        </ThemeIcon>
        <Stack align="center" gap={4}>
          <Title order={5}>No performance data yet</Title>
          <Text size="sm" c="dimmed" ta="center" maw={420}>
            Import an Excel workbook with ticket, call, task, queue, or audit
            data to populate the team performance dashboard.
          </Text>
        </Stack>
      </Stack>
    </Card>
  );
}

// =============================================================================
// Formatters
// =============================================================================

function formatMinutes(mins: number): string {
  if (!isFinite(mins) || mins <= 0) return "0m";
  if (mins < 1) return `${Math.round(mins * 60)}s`;
  if (mins < 60) {
    const whole = Math.floor(mins);
    const sec = Math.round((mins - whole) * 60);
    if (sec > 0 && whole < 10) return `${whole}m ${sec}s`;
    return `${Math.round(mins)}m`;
  }
  const h = Math.floor(mins / 60);
  const m = Math.round(mins - h * 60);
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h - d * 24}h`;
}

/** Format a number of seconds as `MM:SS` (or `H:MM:SS` if >= 1h). */
function formatSeconds(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "0s";
  const total = Math.round(sec);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  if (m < 60) return `${m}:${String(s).padStart(2, "0")}`;
  const h = Math.floor(m / 60);
  const mm = m - h * 60;
  return `${h}:${String(mm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
