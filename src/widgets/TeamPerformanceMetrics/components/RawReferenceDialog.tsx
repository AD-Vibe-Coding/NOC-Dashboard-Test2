import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileSpreadsheet } from "lucide-react";
import { RAW_REFERENCE_COLUMNS, type RawReferenceRow, type UploadKind, type UploadResult } from "@/widgets/TeamPerformanceMetrics/lib/parse-excel";
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
};

export function uploadKindForMetric(metricKey: string): UploadKind {
  if (metricKey === "asa_seconds" || metricKey === "refused_calls") return "calls";
  if (metricKey === "mobility_sla_pct") return "mobility";
  return "tickets";
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

export function RawReferenceDialog({ member, metric, upload }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [memberRows, setMemberRows] = useState<RawReferenceRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverPaged, setServerPaged] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 100;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const monthOptions = useMemo(() =>
    (upload?.months ?? [])
      .map(({ monthKey, monthLabel }) => [monthKey, monthLabel] as [string, string])
      .sort(([a], [b]) => a.localeCompare(b)),
  [upload?.months]);
  const selectedSet = useMemo(() => new Set(selectedMonths), [selectedMonths]);

  useEffect(() => {
    if (!open || selectedSet.size === 0) {
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
          const direction = sortDirection === "asc" ? 1 : -1;
          matchingRows.sort((a, b) => (a.monthKey.localeCompare(b.monthKey) || a.sourceRow - b.sourceRow) * direction);
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
  }, [member, open, page, selectedMonths, selectedSet, sortDirection, upload?.rawRows, upload?.uploadId]);

  const visibleRows = useMemo(() => {
    if (loadingRows || selectedSet.size === 0) return [];
    if (serverPaged) return memberRows;
    return [...memberRows].sort((a, b) => {
      const monthOrder = a.monthKey.localeCompare(b.monthKey);
      const rowOrder = a.sourceRow - b.sourceRow;
      return (monthOrder || rowOrder) * (sortDirection === "asc" ? 1 : -1);
    });
  }, [loadingRows, memberRows, selectedSet, serverPaged, sortDirection]);
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

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    setMemberRows([]);
    setTotalRows(0);
    setSelectedMonths([]);
    setLoadingRows(false);
    setLoadError(null);
    setPage(0);
  }

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

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`View raw Excel data for ${metric}`}
        title="View raw Excel data"
        onClick={() => handleOpenChange(true)}
      >
        <FileSpreadsheet aria-hidden="true" />
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="fixed left-1/2 top-1/2 z-50 m-0 max-h-[90vh] w-[calc(100%-2rem)] max-w-6xl -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-hidden rounded-lg border bg-background p-5 text-foreground shadow-lg outline-none backdrop:bg-black/50 sm:p-6"
        style={{ display: open ? "flex" : "none" }}
        onCancel={() => handleOpenChange(false)}
        onClose={() => handleOpenChange(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) handleOpenChange(false);
        }}
      >
          <div className="flex shrink-0 flex-col gap-2 pr-8 text-center sm:text-left">
            <h2 id={titleId} className="text-lg leading-none font-semibold">Raw Excel data · {metric}</h2>
            <p className="text-sm text-muted-foreground">
              {member} · {upload?.filename ?? "No matching workbook uploaded"}. Choose one or more months to view the original rows.
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSortDirection((direction) => direction === "asc" ? "desc" : "asc")}
                disabled={!selectedMonths.length}
                aria-label={`Sort ${sortDirection === "asc" ? "descending" : "ascending"}`}
              >
                {sortDirection === "asc" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
                {sortDirection === "asc" ? "Ascending" : "Descending"}
              </Button>
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
                        <TableHead className="sticky left-0 z-20 bg-muted">Excel row</TableHead>
                        <TableHead>Month</TableHead>
                        {visibleColumns.map(({ header, index }) => (
                          <TableHead key={index}>{header}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageRows.map((row) => (
                        <TableRow key={`${row.monthKey}-${row.sourceRow}`}>
                          <TableCell className="sticky left-0 z-[1] bg-background font-mono text-xs">{row.sourceRow}</TableCell>
                          <TableCell>{row.monthLabel}</TableCell>
                          {visibleColumns.map(({ index }) => (
                            <TableCell key={index} className="max-w-64 truncate" title={String(row.cells[String(index)] ?? "")}>
                              {row.cells[String(index)] == null ? "" : String(row.cells[String(index)])}
                            </TableCell>
                          ))}
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
      </dialog>
    </>
  );
}
