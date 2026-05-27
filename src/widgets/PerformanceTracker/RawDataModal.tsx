/**
 * RawDataModal — row-level drill-down for a team member.
 *
 * Shows every individual metric row (ticket, call, task) for a selected
 * member, respecting all active filters (queue, period, maintenance,
 * weekday/weekend, shift). Supports sorting by any column and CSV export.
 */

import { useMemo, useState } from "react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  Popover,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconBolt,
  IconClipboardList,
  IconDownload,
  IconGavel,
  IconPhone,
  IconTable,
  IconTicket,
} from "@tabler/icons-react";
import { downloadBlob } from "../../lib/download";
import {
  filterMetrics,
  type AggregateOptions,
  type PerformanceMetric,
} from "./data";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortDir = "asc" | "desc";
type SourceTab = "tickets" | "calls" | "tasks" | "audits";

export interface DisputeInfo {
  id: number;
  field_name: string;
  status: string; // "pending" | "approved" | "rejected"
  proposed_value: number;
  review_note: string | null;
}

interface Props {
  /** Member name to show data for, or null to close the modal. */
  memberName: string | null;
  /** Full metrics array (pre-loaded). */
  metrics: PerformanceMetric[];
  /** Current filter options — used to pre-filter the rows. */
  filterOptions?: AggregateOptions;
  onClose: () => void;
  /** Callback to open a dispute form for a specific metric + field. */
  onDispute?: (metric: PerformanceMetric, field: "ack_minutes" | "carrier_ticket_minutes") => void;
  /** Map of metric_id → dispute info for showing status badges. */
  disputesByMetricId?: Map<number, DisputeInfo[]>;
}

// ---------------------------------------------------------------------------
// Column definitions per source type
// ---------------------------------------------------------------------------

interface ColDef {
  key: string;
  label: string;
  /** Extract display string from a metric row (used for CSV export). */
  render: (m: PerformanceMetric) => string;
  /** Optional JSX renderer for the table cell. Falls back to `render()`. */
  renderCell?: (m: PerformanceMetric) => React.ReactNode;
  /** Extract numeric/string for sorting. */
  sortValue: (m: PerformanceMetric) => number | string;
  align?: "right";
  width?: number;
}

const raw = (m: PerformanceMetric) => m as Record<string, unknown>;
const str = (v: unknown): string =>
  v != null && v !== "" ? String(v) : "";

/** Parse raw_json for audit rows — cached per metric id to avoid repeated JSON.parse calls */
const auditRawCache = new WeakMap<PerformanceMetric, Record<string, unknown>>();
function auditRaw(m: PerformanceMetric): Record<string, unknown> {
  if (auditRawCache.has(m)) return auditRawCache.get(m)!;
  try {
    const parsed = JSON.parse((m as any).raw_json ?? "{}");
    auditRawCache.set(m, parsed);
    return parsed;
  } catch {
    auditRawCache.set(m, {});
    return {};
  }
}

function fmtMin(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v < 1) return `${Math.round(v * 60)}s`;
  const whole = Math.floor(v);
  const sec = Math.round((v - whole) * 60);
  if (sec > 0 && whole < 10) return `${whole}m ${sec}s`;
  return `${Math.round(v)}m`;
}

function fmtSec(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v < 60) return `${Math.round(v)}s`;
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return `${m}m ${s}s`;
}

const IPATH_URL = "https://ipath.vcomsolutions.com/Cases/EditTrouble";

const TICKET_COLS: ColDef[] = [
  {
    key: "ref_number",
    label: "Ticket #",
    render: (m) => str(raw(m).ref_number) || "—",
    renderCell: (m) => {
      const id = str(raw(m).ref_number);
      if (!id) return "—";
      return (
        <Anchor
          href={`${IPATH_URL}?trouble_id=${encodeURIComponent(id)}&sel_tab=Cases`}
          target="_blank"
          rel="noopener noreferrer"
          size="xs"
          fw={600}
        >
          {id}
        </Anchor>
      );
    },
    sortValue: (m) => str(raw(m).ref_number),
    width: 85,
  },
  {
    key: "customer_name",
    label: "Customer",
    render: (m) => str(raw(m).customer_name) || "—",
    sortValue: (m) => str(raw(m).customer_name),
    width: 160,
  },
  {
    key: "subject_text",
    label: "Subject",
    render: (m) => str(raw(m).subject_text) || "—",
    sortValue: (m) => str(raw(m).subject_text),
    width: 220,
  },
  {
    key: "period_month",
    label: "Month",
    render: (m) => m.period_month ?? "—",
    sortValue: (m) => m.period_month ?? "",
    width: 80,
  },
  {
    key: "queue",
    label: "Queue",
    render: (m) => (m.queue ?? "—").toUpperCase(),
    sortValue: (m) => m.queue ?? "",
    width: 70,
  },
  {
    key: "hour",
    label: "Hour",
    render: (m) => {
      const h = raw(m).hour as number | null;
      return h != null ? `${h}:00` : "—";
    },
    sortValue: (m) => (raw(m).hour as number) ?? -1,
    width: 55,
    align: "right",
  },
  {
    key: "is_weekend",
    label: "Day",
    render: (m) => {
      const w = raw(m).is_weekend;
      return w === true ? "Weekend" : w === false ? "Weekday" : "—";
    },
    sortValue: (m) => (raw(m).is_weekend === true ? 1 : 0),
    width: 70,
  },
  {
    key: "ack_minutes",
    label: "Ack Time",
    render: (m) => fmtMin(m.ack_minutes),
    sortValue: (m) => m.ack_minutes ?? 99999,
    width: 70,
    align: "right",
  },
  {
    key: "carrier_ticket_minutes",
    label: "Carrier ≤15",
    render: (m) => {
      if (m.carrier_ticket_minutes == null) return "—";
      return m.carrier_ticket_minutes <= 15
        ? `✓ ${fmtMin(m.carrier_ticket_minutes)}`
        : `✗ ${fmtMin(m.carrier_ticket_minutes)}`;
    },
    sortValue: (m) => m.carrier_ticket_minutes ?? 99999,
    width: 85,
    align: "right",
  },
  {
    key: "success_count",
    label: "Within 24h",
    render: (m) =>
      m.success_count === 1 ? "Yes" : m.success_count === 0 ? "No" : "—",
    sortValue: (m) => m.success_count ?? -1,
    width: 75,
  },
  {
    key: "duration_minutes",
    label: "MTTR",
    render: (m) => fmtMin(m.duration_minutes),
    sortValue: (m) => m.duration_minutes ?? 99999,
    width: 70,
    align: "right",
  },
  {
    key: "score",
    label: "Priority",
    render: (m) => m.score ?? "—",
    sortValue: (m) => m.score ?? "",
    width: 80,
  },
  {
    key: "is_maintenance",
    label: "Maint.",
    render: (m) => (raw(m).is_maintenance ? "Yes" : "No"),
    sortValue: (m) => (raw(m).is_maintenance ? 1 : 0),
    width: 55,
  },
  {
    key: "period_start",
    label: "Opened",
    render: (m) => m.period_start ?? "—",
    sortValue: (m) => m.period_start ?? "",
    width: 90,
  },
  {
    key: "period_end",
    label: "Closed",
    render: (m) => m.period_end ?? "—",
    sortValue: (m) => m.period_end ?? "",
    width: 90,
  },
];

const CALL_COLS: ColDef[] = [
  {
    key: "caller_info",
    label: "Called From",
    render: (m) => str(raw(m).caller_info) || "—",
    sortValue: (m) => str(raw(m).caller_info),
    width: 180,
  },
  {
    key: "customer_name",
    label: "Operator",
    render: (m) => str(raw(m).customer_name) || "—",
    sortValue: (m) => str(raw(m).customer_name),
    width: 160,
  },
  {
    key: "period_month",
    label: "Month",
    render: (m) => m.period_month ?? "—",
    sortValue: (m) => m.period_month ?? "",
    width: 80,
  },
  {
    key: "queue",
    label: "Queue",
    render: (m) => (m.queue ?? "—").toUpperCase(),
    sortValue: (m) => m.queue ?? "",
    width: 70,
  },
  {
    key: "hour",
    label: "Hour",
    render: (m) => {
      const h = raw(m).hour as number | null;
      return h != null ? `${h}:00` : "—";
    },
    sortValue: (m) => (raw(m).hour as number) ?? -1,
    width: 55,
    align: "right",
  },
  {
    key: "is_weekend",
    label: "Day",
    render: (m) => {
      const w = raw(m).is_weekend;
      return w === true ? "Weekend" : w === false ? "Weekday" : "—";
    },
    sortValue: (m) => (raw(m).is_weekend === true ? 1 : 0),
    width: 70,
  },
  {
    key: "score",
    label: "Call Result",
    render: (m) => m.score ?? "—",
    sortValue: (m) => m.score ?? "",
    width: 130,
  },
  {
    key: "success_count",
    label: "Answered",
    render: (m) =>
      m.success_count === 1 ? "Yes" : m.success_count === 0 ? "No" : "—",
    sortValue: (m) => m.success_count ?? -1,
    width: 70,
  },
  {
    key: "handle_seconds",
    label: "Handle Time",
    render: (m) => fmtSec(m.handle_seconds),
    sortValue: (m) => m.handle_seconds ?? 99999,
    width: 85,
    align: "right",
  },
  {
    key: "wait_seconds",
    label: "Wait Time",
    render: (m) => fmtSec(m.wait_seconds),
    sortValue: (m) => m.wait_seconds ?? 99999,
    width: 80,
    align: "right",
  },
  {
    key: "period_start",
    label: "Start Time",
    render: (m) => m.period_start ?? "—",
    sortValue: (m) => m.period_start ?? "",
    width: 130,
  },
];

const IPATH_TASK_URL = "https://ipath.vcomsolutions.com/vMobile/tasks/edittask";

const TASK_COLS: ColDef[] = [
  {
    key: "ref_number",
    label: "Task #",
    render: (m) => str(raw(m).ref_number) || "—",
    renderCell: (m) => {
      const id = str(raw(m).ref_number);
      if (!id) return "—";
      return (
        <Anchor
          href={`${IPATH_TASK_URL}?taskID=${encodeURIComponent(id)}`}
          target="_blank"
          rel="noopener noreferrer"
          size="xs"
          fw={600}
        >
          {id}
        </Anchor>
      );
    },
    sortValue: (m) => str(raw(m).ref_number),
    width: 85,
  },
  {
    key: "customer_name",
    label: "Customer",
    render: (m) => str(raw(m).customer_name) || "—",
    sortValue: (m) => str(raw(m).customer_name),
    width: 160,
  },
  {
    key: "subject_text",
    label: "Subject",
    render: (m) => str(raw(m).subject_text) || "—",
    sortValue: (m) => str(raw(m).subject_text),
    width: 220,
  },
  {
    key: "period_month",
    label: "Month",
    render: (m) => m.period_month ?? "—",
    sortValue: (m) => m.period_month ?? "",
    width: 80,
  },
  {
    key: "hour",
    label: "Hour",
    render: (m) => {
      const h = raw(m).hour as number | null;
      return h != null ? `${h}:00` : "—";
    },
    sortValue: (m) => (raw(m).hour as number) ?? -1,
    width: 55,
    align: "right",
  },
  {
    key: "is_weekend",
    label: "Day",
    render: (m) => {
      const w = raw(m).is_weekend;
      return w === true ? "Weekend" : w === false ? "Weekday" : "—";
    },
    sortValue: (m) => (raw(m).is_weekend === true ? 1 : 0),
    width: 70,
  },
  {
    key: "success_count",
    label: "Met SLA",
    render: (m) =>
      m.success_count === 1 ? "Yes" : m.success_count === 0 ? "No" : "—",
    sortValue: (m) => m.success_count ?? -1,
    width: 70,
  },
  {
    key: "duration_minutes",
    label: "Duration",
    render: (m) => fmtMin(m.duration_minutes),
    sortValue: (m) => m.duration_minutes ?? 99999,
    width: 80,
    align: "right",
  },
  {
    key: "period_start",
    label: "Opened",
    render: (m) => m.period_start ?? "—",
    sortValue: (m) => m.period_start ?? "",
    width: 130,
  },
  {
    key: "period_end",
    label: "Closed",
    render: (m) => m.period_end ?? "—",
    sortValue: (m) => m.period_end ?? "",
    width: 130,
  },
];

function scoreCell(score: number | null | undefined | unknown) {
  // Defensively handle object format { score, max, ... } stored by older push logic
  if (score != null && typeof score === "object" && typeof (score as any).score === "number") {
    score = (score as any).score;
  }
  const n = score == null ? null : Number(score);
  if (n == null || isNaN(n)) return <Text size="xs" c="dimmed">—</Text>;
  const color = n >= 8 ? "green" : n >= 6 ? "yellow" : "red";
  return (
    <Badge size="xs" color={color} variant="light" fw={700}>
      {n}
    </Badge>
  );
}

function totalScoreCell(score: number | null | undefined) {
  if (score == null) return "—";
  const color = score >= 80 ? "green" : score >= 60 ? "yellow" : "red";
  return (
    <Badge size="sm" color={color} variant="filled" fw={700}>
      {score}
    </Badge>
  );
}

/** Truncated cell with a popover on hover showing the full text */
function FeedbackCell({ value, color }: { value: string; color: string }) {
  if (!value || value === "—") return <Text size="xs" c="dimmed">—</Text>;
  const preview = value.length > 60 ? value.slice(0, 60) + "…" : value;
  return (
    <Popover
      width={360}
      position="left"
      withArrow
      shadow="md"
      withinPortal
    >
      <Popover.Target>
        <Text
          size="xs"
          c={color}
          style={{
            cursor: "pointer",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 190,
          }}
        >
          {preview}
        </Text>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Card withBorder={false} radius="md" p="md" style={{ maxHeight: 320, overflowY: "auto" }}>
          <Text size="xs" fw={700} tt="uppercase" c={color} mb="xs">
            {color === "green" ? "What You Did Well" : "What You Missed / Could Do Better"}
          </Text>
          <Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
            {value}
          </Text>
        </Card>
      </Popover.Dropdown>
    </Popover>
  );
}

const AUDIT_COLS: ColDef[] = [
  {
    key: "date",
    label: "Date",
    render: (m) => str(auditRaw(m).date) || (m.period_start ?? "—"),
    sortValue: (m) => str(auditRaw(m).date) || (m.period_start ?? ""),
    width: 100,
  },
  {
    key: "ticket_owner",
    label: "Ticket Owner",
    render: (m) => str(auditRaw(m).ticket_owner) || m.member_name,
    sortValue: (m) => str(auditRaw(m).ticket_owner) || m.member_name,
    width: 160,
  },
  {
    key: "ticket_number",
    label: "Ticket Number",
    render: (m) => str(auditRaw(m).ticket_number) || "—",
    sortValue: (m) => str(auditRaw(m).ticket_number),
    width: 110,
  },
  {
    key: "response_timeliness",
    label: "Response & Timeliness",
    render: (m) => auditRaw(m).response_timeliness != null ? String(auditRaw(m).response_timeliness) : "—",
    renderCell: (m) => scoreCell(auditRaw(m).response_timeliness as number),
    sortValue: (m) => (auditRaw(m).response_timeliness as number) ?? -1,
    width: 80,
    align: "right",
  },
  {
    key: "data_quality",
    label: "Data Quality & Completeness",
    render: (m) => auditRaw(m).data_quality != null ? String(auditRaw(m).data_quality) : "—",
    renderCell: (m) => scoreCell(auditRaw(m).data_quality as number),
    sortValue: (m) => (auditRaw(m).data_quality as number) ?? -1,
    width: 80,
    align: "right",
  },
  {
    key: "communication_quality",
    label: "Communication Quality",
    render: (m) => auditRaw(m).communication_quality != null ? String(auditRaw(m).communication_quality) : "—",
    renderCell: (m) => scoreCell(auditRaw(m).communication_quality as number),
    sortValue: (m) => (auditRaw(m).communication_quality as number) ?? -1,
    width: 80,
    align: "right",
  },
  {
    key: "process_compliance",
    label: "Process & Workflow Compliance",
    render: (m) => auditRaw(m).process_compliance != null ? String(auditRaw(m).process_compliance) : "—",
    renderCell: (m) => scoreCell(auditRaw(m).process_compliance as number),
    sortValue: (m) => (auditRaw(m).process_compliance as number) ?? -1,
    width: 80,
    align: "right",
  },
  {
    key: "technical_handling",
    label: "Technical Handling",
    render: (m) => auditRaw(m).technical_handling != null ? String(auditRaw(m).technical_handling) : "—",
    renderCell: (m) => scoreCell(auditRaw(m).technical_handling as number),
    sortValue: (m) => (auditRaw(m).technical_handling as number) ?? -1,
    width: 80,
    align: "right",
  },
  {
    key: "closure_documentation",
    label: "Closure & Documentation",
    render: (m) => auditRaw(m).closure_documentation != null ? String(auditRaw(m).closure_documentation) : "—",
    renderCell: (m) => scoreCell(auditRaw(m).closure_documentation as number),
    sortValue: (m) => (auditRaw(m).closure_documentation as number) ?? -1,
    width: 80,
    align: "right",
  },
  {
    key: "total_score",
    label: "Total Score",
    render: (m) => auditRaw(m).total_score != null ? String(auditRaw(m).total_score) : (m.score ?? "—"),
    renderCell: (m) => totalScoreCell((auditRaw(m).total_score as number) ?? (m.score ? parseFloat(m.score) : null)),
    sortValue: (m) => (auditRaw(m).total_score as number) ?? parseFloat(m.score ?? "0") ?? -1,
    width: 80,
    align: "right",
  },
  {
    key: "what_did_well",
    label: "What You Did Well",
    render: (m) => str(auditRaw(m).what_did_well) || "—",
    renderCell: (m) => <FeedbackCell value={str(auditRaw(m).what_did_well)} color="green" />,
    sortValue: (m) => str(auditRaw(m).what_did_well),
    width: 200,
  },
  {
    key: "what_missed",
    label: "What You Missed / Could Do Better",
    render: (m) => str(auditRaw(m).what_missed) || "—",
    renderCell: (m) => <FeedbackCell value={str(auditRaw(m).what_missed)} color="orange" />,
    sortValue: (m) => str(auditRaw(m).what_missed),
    width: 200,
  },
];

const COLS_BY_SOURCE: Record<SourceTab, ColDef[]> = {
  tickets: TICKET_COLS,
  calls: CALL_COLS,
  tasks: TASK_COLS,
  audits: AUDIT_COLS,
};

const TAB_ICONS: Record<SourceTab, typeof IconTicket> = {
  tickets: IconTicket,
  calls: IconPhone,
  tasks: IconClipboardList,
  audits: IconGavel,
};

const TAB_COLORS: Record<SourceTab, string> = {
  tickets: "blue",
  calls: "green",
  tasks: "orange",
  audits: "violet",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RawDataModal({
  memberName,
  metrics,
  filterOptions,
  onClose,
  onDispute,
  disputesByMetricId,
}: Props) {
  const [activeTab, setActiveTab] = useState<SourceTab>("tickets");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Pre-filter to this member + apply current dashboard filters
  const memberRows = useMemo(() => {
    if (!memberName) return [];
    const memberFiltered = metrics.filter(
      (m) => m.member_name === memberName,
    );
    return filterMetrics(memberFiltered, filterOptions);
  }, [memberName, metrics, filterOptions]);

  // Split by source type
  const bySource = useMemo(() => {
    const out: Record<SourceTab, PerformanceMetric[]> = {
      tickets: [],
      calls: [],
      tasks: [],
      audits: [],
    };
    for (const m of memberRows) {
      const st = m.source_type as SourceTab;
      if (st in out) out[st].push(m);
      else if ((st as string) === "audit") out.audits.push(m); // handle "audit" singular
    }
    return out;
  }, [memberRows]);

  // Auto-select a tab that has data
  const currentRows = bySource[activeTab];
  const cols = COLS_BY_SOURCE[activeTab];

  // Sort rows
  const sortedRows = useMemo(() => {
    if (!sortCol) return currentRows;
    const col = cols.find((c) => c.key === sortCol);
    if (!col) return currentRows;
    const sorted = [...currentRows].sort((a, b) => {
      const av = col.sortValue(a);
      const bv = col.sortValue(b);
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv));
    });
    return sortDir === "desc" ? sorted.reverse() : sorted;
  }, [currentRows, sortCol, sortDir, cols]);

  // Toggle sort
  const handleSort = (key: string) => {
    if (sortCol === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(key);
      setSortDir("asc");
    }
  };

  // CSV export
  const handleExport = () => {
    if (!memberName || sortedRows.length === 0) return;
    const header = cols.map((c) => c.label).join(",");
    const rows = sortedRows.map((m) =>
      cols
        .map((c) => {
          const v = c.render(m);
          // Escape quotes
          if (v.includes(",") || v.includes('"') || v.includes("\n")) {
            return `"${v.replace(/"/g, '""')}"`;
          }
          return v;
        })
        .join(","),
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const safeName = memberName.replace(/[^a-zA-Z0-9]/g, "_");
    downloadBlob(blob, `${safeName}_${activeTab}_raw.csv`);
  };

  return (
    <Modal
      opened={memberName != null}
      onClose={onClose}
      title={
        memberName ? (
          <Group gap="xs">
            <IconTable size={18} />
            <Text fw={600}>Raw Data — {memberName}</Text>
          </Group>
        ) : (
          "Raw Data"
        )
      }
      size="95vw"
      styles={{
        body: { padding: "0.5rem" },
        content: { maxHeight: "90vh" },
      }}
      withinPortal
    >
      <Stack gap="sm">
        {/* Source tabs + export button */}
        <Group justify="space-between" wrap="nowrap">
          <SegmentedControl
            size="xs"
            value={activeTab}
            onChange={(v) => {
              setActiveTab(v as SourceTab);
              setSortCol(null);
            }}
            data={(["tickets", "calls", "tasks", "audits"] as SourceTab[]).map((s) => ({
              value: s,
              label: (
                <Group gap={4} wrap="nowrap">
                  <ThemeIcon
                    size="xs"
                    variant="transparent"
                    color={TAB_COLORS[s]}
                  >
                    {(() => {
                      const Icon = TAB_ICONS[s];
                      return <Icon size={12} />;
                    })()}
                  </ThemeIcon>
                  <Text size="xs" fw={600}>
                    {s.charAt(0).toUpperCase() + s.slice(1)} ({bySource[s].length})
                  </Text>
                </Group>
              ),
            }))}
          />
          <Tooltip label="Export filtered rows as CSV" withinPortal>
            <Button
              size="xs"
              variant="light"
              color="gray"
              leftSection={<IconDownload size={14} />}
              onClick={handleExport}
              disabled={sortedRows.length === 0}
            >
              CSV
            </Button>
          </Tooltip>
        </Group>

        {/* Active filter summary */}
        <Group gap={4} wrap="wrap">
          <Text size="xs" c="dimmed">
            Showing {sortedRows.length} {activeTab} rows
          </Text>
          {filterOptions?.queue && filterOptions.queue !== "all" && (
            <Badge size="xs" variant="light">
              Queue: {filterOptions.queue.toUpperCase()}
            </Badge>
          )}
          {filterOptions?.period && filterOptions.period.type !== "all" && (
            <Badge size="xs" variant="light">
              {filterOptions.period.type}: {filterOptions.period.value}
            </Badge>
          )}
          {filterOptions?.excludeMaintenance && (
            <Badge size="xs" variant="light" color="yellow">
              Excl. maintenance
            </Badge>
          )}
          {filterOptions?.dayFilter && filterOptions.dayFilter !== "all" && (
            <Badge size="xs" variant="light" color="cyan">
              {filterOptions.dayFilter}
            </Badge>
          )}
          {filterOptions?.shiftFilter && filterOptions.shiftFilter !== "all" && (
            <Badge size="xs" variant="light" color="violet">
              {filterOptions.shiftFilter} shift
            </Badge>
          )}
        </Group>

        {/* Data table */}
        {sortedRows.length === 0 ? (
          <Box p="xl" style={{ textAlign: "center" }}>
            <Text c="dimmed" size="sm">
              No {activeTab} data for {memberName} with current filters.
            </Text>
          </Box>
        ) : (
          <ScrollArea h="calc(80vh - 140px)" type="auto">
            <Table
              striped
              highlightOnHover
              withTableBorder
              withColumnBorders
              stickyHeader
              styles={{
                th: { fontSize: 11, whiteSpace: "nowrap" },
                td: { fontSize: 11, padding: "4px 8px" },
              }}
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 40, textAlign: "right" }}>#</Table.Th>
                  {cols.map((c) => (
                    <Table.Th
                      key={c.key}
                      style={{
                        width: c.width,
                        textAlign: c.align ?? "left",
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                      onClick={() => handleSort(c.key)}
                    >
                      <Group gap={2} wrap="nowrap" justify={c.align === "right" ? "flex-end" : "flex-start"}>
                        {c.label}
                        {sortCol === c.key && (
                          sortDir === "asc" ? (
                            <IconArrowUp size={10} />
                          ) : (
                            <IconArrowDown size={10} />
                          )
                        )}
                      </Group>
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sortedRows.map((m, idx) => {
                  const disputes = disputesByMetricId?.get(m.id) ?? [];
                  return (
                    <Table.Tr key={`metric-${m.id ?? "no-id"}-${m.import_id ?? "no-import"}-${idx}`}>
                      <Table.Td style={{ textAlign: "right", color: "var(--mantine-color-dimmed)" }}>
                        {idx + 1}
                      </Table.Td>
                      {cols.map((c) => {
                        // Show dispute badge + button for disputable fields
                        const isDisputable =
                          activeTab === "tickets" &&
                          (c.key === "ack_minutes" || c.key === "carrier_ticket_minutes");
                        const fieldDisputes = disputes.filter(
                          (d) => d.field_name === c.key,
                        );
                        const latestDispute = fieldDisputes[0];

                        return (
                          <Table.Td
                            key={c.key}
                            style={{
                              textAlign: c.align ?? "left",
                              fontFamily:
                                c.align === "right"
                                  ? "var(--mantine-font-family-monospace)"
                                  : undefined,
                            }}
                          >
                            <Group gap={4} wrap="nowrap" justify={c.align === "right" ? "flex-end" : "flex-start"}>
                              {c.renderCell ? c.renderCell(m) : c.render(m)}
                              {isDisputable && latestDispute && (
                                <Tooltip
                                  label={
                                    latestDispute.status === "pending"
                                      ? "Dispute pending review"
                                      : latestDispute.status === "approved"
                                        ? `Approved — was ${fmtMin(
                                            (m as Record<string, unknown>)[c.key] as number,
                                          )}${latestDispute.review_note ? `: ${latestDispute.review_note}` : ""}`
                                        : `Rejected${latestDispute.review_note ? `: ${latestDispute.review_note}` : ""}`
                                  }
                                  withinPortal
                                  multiline
                                  w={220}
                                >
                                  <Badge
                                    size="xs"
                                    variant="dot"
                                    color={
                                      latestDispute.status === "pending"
                                        ? "yellow"
                                        : latestDispute.status === "approved"
                                          ? "green"
                                          : "red"
                                    }
                                  >
                                    {latestDispute.status === "pending"
                                      ? "⏳"
                                      : latestDispute.status === "approved"
                                        ? "✓"
                                        : "✗"}
                                  </Badge>
                                </Tooltip>
                              )}
                              {isDisputable && onDispute && !latestDispute && (
                                <Tooltip label="Dispute this value" withinPortal>
                                  <ActionIcon
                                    size="xs"
                                    variant="subtle"
                                    color="yellow"
                                    onClick={() =>
                                      onDispute(
                                        m,
                                        c.key as "ack_minutes" | "carrier_ticket_minutes",
                                      )
                                    }
                                  >
                                    <IconBolt size={12} />
                                  </ActionIcon>
                                </Tooltip>
                              )}
                            </Group>
                          </Table.Td>
                        );
                      })}
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Stack>
    </Modal>
  );
}
