import { useEffect, useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { ActionIcon, Badge, Tooltip } from "@mantine/core";
import { IconBolt } from "@tabler/icons-react";
import { useIdentity } from "../../../lib/identity";
import { DisputeForm, type DisputeField } from "@/widgets/PerformanceTracker/DisputeForm";
import type { PerformanceMetric } from "@/widgets/PerformanceTracker/data";
import { resolveTeamMember } from "@/widgets/PerformanceTracker/team";
import { RAW_REFERENCE_COLUMNS, type RawReferenceRow, type UploadKind, type UploadResult } from "@/widgets/TeamPerformanceMetrics/lib/parse-excel";
import type { VolumeKey } from "@/widgets/TeamPerformanceMetrics/lib/volumes";
import { Button } from "@/widgets/TeamPerformanceMetrics/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/widgets/TeamPerformanceMetrics/components/ui/table";

type Props = {
  member: string;
  metric: string;
  upload?: UploadResult;
  active: boolean;
};

type DisputeTarget = {
  row: RawReferenceRow;
  field: DisputeField;
  columnIndex: number;
  header: string;
};

function disputeFieldForColumn(kind: UploadKind | undefined, index: number, header: string): DisputeField | null {
  if (kind !== "tickets") return null;
  const normalized = header.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.includes("openticketwiththecarrier") || normalized.includes("openticketwithcarrier") || normalized.includes("carrierticketminutes")) {
    return "carrier_ticket_minutes";
  }
  if (normalized.includes("acknowledgementtime") || normalized.includes("acknowledgetime") || normalized.includes("ackminutes")) {
    return "ack_minutes";
  }
  if (index === 32) return "carrier_ticket_minutes";
  if (index === 39) return "ack_minutes";
  return null;
}

function rawMinutes(value: RawReferenceRow["cells"][string]): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return value > 0 && value < 1 ? value * 1440 : value;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const hms = text.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hms) return Number(hms[1]) * 60 + Number(hms[2]) + Number(hms[3]) / 60;
  const ms = text.match(/^(\d{1,3}):(\d{2})$/);
  if (ms) return Number(ms[1]) + Number(ms[2]) / 60;
  const numeric = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric > 0 && numeric < 1 ? numeric * 1440 : numeric;
}

function rawTicketReference(row: RawReferenceRow, headers: string[] | undefined): string | null {
  const idColumn = (headers ?? []).findIndex((header) => {
    const name = header.toLowerCase().replace(/[^a-z0-9]/g, "");
    return ["troubleid", "ticketid", "ticketnumber", "referencenumber", "refnumber"].includes(name);
  });
  const value = row.cells[String(idColumn >= 0 ? idColumn : 0)];
  return value == null || String(value).trim() === "" ? null : String(value).trim();
}

export function uploadKindForMetric(metricKey: string): UploadKind {
  if (metricKey === "asa_seconds" || metricKey === "refused_calls") return "calls";
  if (metricKey === "mobility_sla_pct") return "mobility";
  return "tickets";
}

export function uploadKindForVolume(volumeKey: VolumeKey): UploadKind {
  if (volumeKey === "tickets_received") return "tickets";
  if (volumeKey === "mobility_tasks") return "mobility";
  return "calls";
}

function excelColumnLabel(index: number) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function rowSortValue(row: RawReferenceRow, column: string): string | number | boolean | null {
  if (column === "excelRow") return row.sourceRow;
  if (column === "month") return row.monthKey;
  if (column.startsWith("cell:")) return row.cells[column.slice(5)] ?? null;
  return null;
}

function compareSortValues(a: string | number | boolean | null, b: string | number | boolean | null) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  const numericA = typeof a === "number" ? a : typeof a === "string" && a.trim() ? Number(a) : Number.NaN;
  const numericB = typeof b === "number" ? b : typeof b === "string" && b.trim() ? Number(b) : Number.NaN;
  if (Number.isFinite(numericA) && Number.isFinite(numericB)) return numericA - numericB;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function compareRows(a: RawReferenceRow, b: RawReferenceRow, column: string, direction: "asc" | "desc") {
  const primary = compareSortValues(rowSortValue(a, column), rowSortValue(b, column));
  const directed = primary * (direction === "asc" ? 1 : -1);
  return directed || a.monthKey.localeCompare(b.monthKey) || a.sourceRow - b.sourceRow;
}

export function RawReferenceTable({ member, metric, upload, active }: Props) {
  const { identity } = useIdentity();
  const submitterName = identity ? resolveTeamMember(identity.name) ?? identity.name : "";
  const [disputeTarget, setDisputeTarget] = useState<DisputeTarget | null>(null);
  const [refreshRawRows, setRefreshRawRows] = useState(0);
  const [selectedMonths, setSelectedMonths] = useState<string[]>(() => {
    const months = [...(upload?.months ?? [])].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    const latest = months[months.length - 1];
    return latest ? [latest.monthKey] : [];
  });
  const [sortBy, setSortBy] = useState("month");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [memberRows, setMemberRows] = useState<RawReferenceRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverPaged, setServerPaged] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 100;
  const titleId = useId();

  const monthOptions = useMemo(() =>
    (upload?.months ?? [])
      .map(({ monthKey, monthLabel }) => [monthKey, monthLabel] as [string, string])
      .sort(([a], [b]) => a.localeCompare(b)),
  [upload?.months]);
  const selectedSet = useMemo(() => new Set(selectedMonths), [selectedMonths]);
  const disputeMetric = useMemo(() => {
    if (!disputeTarget) return null;
    const original = rawMinutes(disputeTarget.row.cells[String(disputeTarget.columnIndex)]);
    return {
      id: 0,
      ref_number: rawTicketReference(disputeTarget.row, upload?.rawHeaders),
      ack_minutes: disputeTarget.field === "ack_minutes" ? original : null,
      carrier_ticket_minutes: disputeTarget.field === "carrier_ticket_minutes" ? original : null,
      raw_json: "{}",
    } as unknown as PerformanceMetric;
  }, [disputeTarget, upload?.rawHeaders]);

  useEffect(() => {
    if (!active || selectedSet.size === 0) {
      setMemberRows([]);
      setTotalRows(0);
      setLoadingRows(false);
      setLoadError(null);
      setServerPaged(false);
      return;
    }

    let cancelled = false;
    let timer = 0;
    const sourceRows = upload?.rawRows ?? [];
    setLoadingRows(true);
    setLoadError(null);
    setMemberRows([]);

    const loadLocally = () => {
      const matchingRows: RawReferenceRow[] = [];
      let cursor = 0;
      const processChunk = () => {
        const end = Math.min(cursor + 1000, sourceRows.length);
        for (; cursor < end; cursor += 1) {
          const row = sourceRows[cursor];
          if (row.memberName === member && selectedSet.has(row.monthKey)) matchingRows.push(row);
        }
        if (cursor < sourceRows.length) {
          timer = window.setTimeout(processChunk, 0);
        } else if (!cancelled) {
          matchingRows.sort((a, b) => compareRows(a, b, sortBy, sortDirection));
          setMemberRows(matchingRows);
          setTotalRows(matchingRows.length);
          setServerPaged(false);
          setLoadingRows(false);
        }
      };
      timer = window.setTimeout(processChunk, 0);
    };

    const load = async () => {
      if (!upload?.uploadId) {
        loadLocally();
        return;
      }
      try {
        const params = new URLSearchParams({
          member,
          months: selectedMonths.join(","),
          page: String(page),
          limit: String(pageSize),
          direction: sortDirection,
          sortBy,
        });
        const response = await fetch(`/api/team-performance/uploads/${upload.uploadId}/raw-rows?${params}`, { credentials: "include" });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(String(payload?.error ?? `Could not load raw rows (${response.status}).`));
        const rows = Array.isArray(payload?.rows) ? payload.rows as RawReferenceRow[] : [];
        const total = Number(payload?.total) || 0;
        if (total === 0 && sourceRows.length > 0) {
          loadLocally();
          return;
        }
        if (!cancelled) {
          setMemberRows(rows);
          setTotalRows(total);
          setServerPaged(true);
          setLoadingRows(false);
        }
      } catch (error) {
        if (sourceRows.length > 0) {
          loadLocally();
        } else if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Could not load raw rows.");
          setLoadingRows(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, member, page, refreshRawRows, selectedMonths, selectedSet, sortBy, sortDirection, upload?.rawRows, upload?.uploadId]);

  const visibleRows = useMemo(() => {
    if (loadingRows || selectedSet.size === 0) return [];
    if (serverPaged) return memberRows;
    return [...memberRows].sort((a, b) => compareRows(a, b, sortBy, sortDirection));
  }, [loadingRows, memberRows, selectedSet, serverPaged, sortBy, sortDirection]);
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const pageRows = useMemo(
    () => serverPaged ? visibleRows : visibleRows.slice(page * pageSize, (page + 1) * pageSize),
    [page, pageSize, serverPaged, visibleRows],
  );
  const visibleColumns = useMemo(() => {
    const headers = upload?.rawHeaders ?? [];
    const requestedIndexes = upload ? RAW_REFERENCE_COLUMNS[upload.kind] : undefined;
    if (requestedIndexes) {
      return requestedIndexes.map((index) => ({
        header: headers[index] || `Column ${excelColumnLabel(index)}`,
        index,
      }));
    }
    return headers.map((header, index) => ({ header, index }));
  }, [upload?.kind, upload?.rawHeaders]);

  function selectMonths(months: string[]) {
    setSelectedMonths(months);
    setMemberRows([]);
    setTotalRows(0);
    setLoadError(null);
    setLoadingRows(months.length > 0);
    setPage(0);
  }

  function toggleMonth(monthKey: string) {
    const nextMonths = selectedMonths.includes(monthKey)
      ? selectedMonths.filter((month) => month !== monthKey)
      : [...selectedMonths, monthKey];
    selectMonths(nextMonths);
  }

  function toggleSort(column: string) {
    if (sortBy === column) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortDirection("asc");
    }
    setPage(0);
  }

  function sortableHeader(label: string, column: string, className?: string) {
    const active = sortBy === column;
    const sortLabel = active ? sortDirection === "asc" ? "ascending" : "descending" : "none";
    return (
      <TableHead key={column} className={className} aria-sort={sortLabel}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-left font-medium"
          onClick={() => toggleSort(column)}
          aria-label={`Sort by ${label}${active ? `, ${sortDirection === "asc" ? "ascending" : "descending"}` : ""}`}
          aria-pressed={active}
        >
          <span>{label}</span>
          {active
            ? sortDirection === "asc" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />
            : <ArrowUpDown aria-hidden="true" />}
        </Button>
      </TableHead>
    );
  }

  if (!active) return null;

  return (
      <section aria-labelledby={titleId} className="space-y-4 rounded-lg border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex shrink-0 flex-col gap-2 pr-8 text-center sm:text-left">
            <h2 id={titleId} className="text-lg leading-none font-semibold">Raw Excel data · {metric}</h2>
            <p className="text-sm text-muted-foreground">
              {member} · {upload?.filename ?? "No matching workbook uploaded"}. The latest month is selected initially; choose other months to compare source rows.
            </p>
          </div>

          <section className="shrink-0 space-y-3" aria-label="Month filters">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Months</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => selectMonths(monthOptions.map(([key]) => key))}
                  disabled={!monthOptions.length}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => selectMonths([])}
                  disabled={!selectedMonths.length}
                >
                  Clear
                </Button>
              </div>
            </div>
            {loadingRows ? (
              <p role="status" className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Loading source rows…
              </p>
            ) : monthOptions.length ? (
              <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto">
                {monthOptions.map(([key, label]) => {
                  const selected = selectedSet.has(key);
                  return (
                    <Button
                      key={key}
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      aria-pressed={selected}
                      onClick={() => toggleMonth(key)}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {upload ? "No source rows were saved for this individual in this workbook. Re-upload it to enable raw-row reference." : "Upload the matching workbook to view this individual’s source rows."}
              </p>
            )}
          </section>

          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t pt-3">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {selectedMonths.length ? `${totalRows} source row${totalRows === 1 ? "" : "s"}` : "Select one or more months to show source rows."}
              </p>
              <p className="text-xs text-muted-foreground">Select any column heading to sort the table.</p>
            </div>

            {loadingRows ? (
              <p role="status" className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                Preparing the selected individual’s source rows…
              </p>
            ) : loadError ? (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-8 text-center text-sm text-destructive">
                {loadError}. If the raw-row table was just added, push the Supabase schema first.
              </p>
            ) : selectedMonths.length > 0 && visibleRows.length > 0 ? (
              <>
                <div className="min-h-0 flex-1 overflow-auto rounded-md border">
                  <Table className="min-w-max">
                    <TableHeader className="sticky top-0 z-10 bg-muted">
                      <TableRow>
                        {sortableHeader("Excel row", "excelRow", "sticky left-0 z-20 bg-muted")}
                        {sortableHeader("Month", "month")}
                        {visibleColumns.map(({ header, index }) =>
                          sortableHeader(header, `cell:${index}`)
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageRows.map((row) => (
                        <TableRow key={`${row.monthKey}-${row.sourceRow}`}>
                          <TableCell className="sticky left-0 z-[1] bg-background font-mono text-xs">{row.sourceRow}</TableCell>
                          <TableCell>{row.monthLabel}</TableCell>
                          {visibleColumns.map(({ header, index }) => {
                            const field = disputeFieldForColumn(upload?.kind, index, header);
                            const latestDispute = field
                              ? row.disputes?.find((dispute) => dispute.field_name === field)
                              : undefined;
                            const canSubmit = Boolean(upload?.uploadId && row.id != null && submitterName);
                            const value = row.cells[String(index)];
                            return (
                              <TableCell key={index} className="max-w-64" title={value == null ? "" : String(value)}>
                                <div className="flex min-w-max items-center gap-1.5">
                                  <span className="max-w-64 truncate">{value == null ? "" : String(value)}</span>
                                  {latestDispute ? (
                                    <Tooltip label={`Dispute ${latestDispute.status}${latestDispute.review_note ? `: ${latestDispute.review_note}` : ""}`} withinPortal>
                                      <Badge
                                        size="xs"
                                        variant="dot"
                                        color={latestDispute.status === "pending" ? "yellow" : latestDispute.status === "approved" ? "green" : "red"}
                                      >
                                        {latestDispute.status}
                                      </Badge>
                                    </Tooltip>
                                  ) : field ? (
                                    <Tooltip label={canSubmit ? "Dispute this value" : "Upload and save this workbook before submitting a dispute"} withinPortal>
                                      <span>
                                        <ActionIcon
                                          type="button"
                                          size="xs"
                                          variant="subtle"
                                          color="yellow"
                                          aria-label={`Dispute ${header} for row ${row.sourceRow}`}
                                          disabled={!canSubmit}
                                          onClick={() => setDisputeTarget({ row, field, columnIndex: index, header })}
                                        >
                                          <IconBolt size={13} aria-hidden="true" />
                                        </ActionIcon>
                                      </span>
                                    </Tooltip>
                                  ) : null}
                                </div>
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {pageCount > 1 ? (
                  <div className="flex shrink-0 items-center justify-between gap-3 border-t pt-2 text-sm">
                    <span className="text-muted-foreground">Page {page + 1} of {pageCount} · {pageSize} rows per page</span>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}>
                        Previous
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page >= pageCount - 1}>
                        Next
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : selectedMonths.length > 0 ? (
              <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                {upload?.uploadId
                  ? "No saved raw rows match this individual and the selected month or months. If this snapshot predates raw-row storage, re-upload the workbook to rebuild the reference."
                  : !Array.isArray(upload?.rawRows)
                    ? "This saved workbook has no raw-row reference. Re-upload it after raw-row storage is enabled."
                    : upload.rawRows.length === 0
                      ? "No individual source rows were captured in this snapshot. Re-upload the workbook to rebuild the raw-row reference."
                      : "No rows for this individual in the selected month or months."}
              </p>
            ) : null}
          </div>
          {disputeTarget && disputeTarget.row.id != null && disputeMetric ? (
            <DisputeForm
              key={`${disputeTarget.row.id}-${disputeTarget.field}`}
              metric={disputeMetric}
              field={disputeTarget.field}
              fixedField={disputeTarget.field}
              submitterName={submitterName}
              rawRowId={disputeTarget.row.id}
              sourceContext={JSON.stringify({
                source: "team_performance_raw_rows",
                memberName: member,
                monthKey: disputeTarget.row.monthKey,
                monthLabel: disputeTarget.row.monthLabel,
                sourceRow: disputeTarget.row.sourceRow,
                uploadId: upload?.uploadId,
                filename: upload?.filename,
                columnIndex: disputeTarget.columnIndex,
                columnHeader: disputeTarget.header,
              })}
              onClose={() => setDisputeTarget(null)}
              onSubmitted={() => setRefreshRawRows((current) => current + 1)}
            />
          ) : null}
      </section>
  );
}
