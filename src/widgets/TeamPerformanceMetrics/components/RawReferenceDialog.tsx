import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, FileSpreadsheet } from "lucide-react";
import type { UploadKind, UploadResult } from "@/widgets/TeamPerformanceMetrics/lib/parse-excel";
import { Button } from "@/widgets/TeamPerformanceMetrics/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/widgets/TeamPerformanceMetrics/components/ui/dialog";
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

export function RawReferenceDialog({ member, metric, upload }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const memberRows = useMemo(
    () => (upload?.rawRows ?? []).filter((row) => row.memberName === member),
    [member, upload],
  );
  const monthOptions = useMemo(() => {
    const map = new Map<string, string>();
    memberRows.forEach((row) => map.set(row.monthKey, row.monthLabel));
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [memberRows]);
  const selectedSet = useMemo(() => new Set(selectedMonths), [selectedMonths]);
  const visibleRows = useMemo(
    () => memberRows
      .filter((row) => selectedSet.has(row.monthKey))
      .sort((a, b) => {
        const monthOrder = a.monthKey.localeCompare(b.monthKey);
        const rowOrder = a.sourceRow - b.sourceRow;
        return (monthOrder || rowOrder) * (sortDirection === "asc" ? 1 : -1);
      }),
    [memberRows, selectedSet, sortDirection],
  );
  const visibleColumns = useMemo(() => {
    const headers = upload?.rawHeaders ?? [];
    return headers
      .map((header, index) => ({ header, index }))
      .filter(({ index }) => visibleRows.some((row) => row.cells[String(index)] !== undefined));
  }, [upload?.rawHeaders, visibleRows]);

  function toggleMonth(monthKey: string) {
    setSelectedMonths((current) => current.includes(monthKey)
      ? current.filter((month) => month !== monthKey)
      : [...current, monthKey]);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`View raw Excel data for ${metric}`}
        title="View raw Excel data"
        onClick={() => setOpen(true)}
      >
        <FileSpreadsheet aria-hidden="true" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100%-2rem)] max-w-6xl flex-col gap-4 overflow-hidden p-5 sm:p-6">
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>Raw Excel data · {metric}</DialogTitle>
            <DialogDescription>
              {member} · {upload?.filename ?? "No matching workbook uploaded"}. Choose one or more months to view the original rows.
            </DialogDescription>
          </DialogHeader>

          <section className="shrink-0 space-y-3" aria-label="Month filters">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Months</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedMonths(monthOptions.map(([key]) => key))}
                  disabled={!monthOptions.length}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedMonths([])}
                  disabled={!selectedMonths.length}
                >
                  Clear
                </Button>
              </div>
            </div>
            {monthOptions.length ? (
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
                {selectedMonths.length ? `${visibleRows.length} source row${visibleRows.length === 1 ? "" : "s"}` : "Select one or more months to show source rows."}
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

            {selectedMonths.length > 0 && visibleRows.length > 0 ? (
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
                    {visibleRows.map((row) => (
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
            ) : selectedMonths.length > 0 ? (
              <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                No rows for the selected month or months.
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
