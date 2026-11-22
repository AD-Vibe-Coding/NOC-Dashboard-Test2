import { useState } from "react";
import { FileSpreadsheet, Phone, Ticket, Truck } from "lucide-react";
import { parseWorkbook, type UploadKind, type UploadResult } from "@/widgets/TeamPerformanceMetrics/lib/parse-excel";
import { useSnapshotUploads } from "@/widgets/TeamPerformanceMetrics/lib/snapshot-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/widgets/TeamPerformanceMetrics/components/ui/card";
import { Button } from "@/widgets/TeamPerformanceMetrics/components/ui/button";
import { Badge } from "@/widgets/TeamPerformanceMetrics/components/ui/badge";
import { BlurFade } from "@/widgets/TeamPerformanceMetrics/components/ui/blur-fade";

const ZONES: {
  kind: UploadKind;
  title: string;
  hint: string;
  icon: typeof Ticket;
  columns: string;
}[] = [
  {
    kind: "tickets",
    title: "Trouble tickets",
    hint: "One row per ticket.",
    icon: Ticket,
    columns:
      "Column B = month · Column AN = Ticket Acknowledge Time · Column AG = time to open with carrier (under 15 min, blanks excluded)",
  },
  {
    kind: "mobility",
    title: "Mobility tasks",
    hint: "One row per mobility task.",
    icon: Truck,
    columns: "Column B = month, then Duration or SLA (under 60 minutes)",
  },
  {
    kind: "calls",
    title: "Inbound / outbound calls",
    hint: "One row per call.",
    icon: Phone,
    columns: "Direction (inbound/outbound), ASA, Refused",
  },
];

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not prepare the file for storage."));
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

function Zone({
  zone,
  busy,
  onFile,
}: {
  zone: (typeof ZONES)[number];
  busy: boolean;
  onFile: (kind: UploadKind, file: File) => void;
}) {
  const Icon = zone.icon;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 font-display text-xl">
          <Icon className="size-4" aria-hidden />
          {zone.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{zone.hint}</p>
        <p className="text-xs text-muted-foreground">Look for columns: {zone.columns}</p>
        <label className="inline-flex">
          <input
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(zone.kind, f);
              e.target.value = "";
            }}
          />
          <Button type="button" asChild disabled={busy}>
            <span>{busy ? "Reading…" : "Choose Excel"}</span>
          </Button>
        </label>
      </CardContent>
    </Card>
  );
}

export default function Upload() {
  const { uploads, applyUpload, clearUploads, isRestoring, restoreError } = useSnapshotUploads();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(kind: UploadKind, file: File) {
    setError(null);
    if (file.size > MAX_FILE_BYTES) {
      setError("Files must be 2 MiB or smaller to store in Supabase.");
      return;
    }
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const result = parseWorkbook(kind, file.name, buf);
      if (!result.used) {
        setError("No usable rows. Check column names against the hints on each card.");
        setLast(result);
        return;
      }

      const response = await fetch("/api/team-performance/uploads", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          filename: file.name,
          mime_type: file.type || "application/octet-stream",
          file_size_bytes: file.size,
          data_url: await fileAsDataUrl(file),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(payload?.error ?? `Could not save file (${response.status}).`));

      applyUpload(result);
      setLast(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read or save that file");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <BlurFade>
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Ingest</p>
          <h1 className="font-display mt-1 text-3xl md:text-4xl">Upload Excel</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Uploads are saved in Supabase with history retained; the latest file in each category restores automatically for managers. Each file can be up to 2 MiB.
          </p>
        </div>
      </BlurFade>

      {restoreError ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Saved workbooks could not be restored: {restoreError}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {ZONES.map((z) => (
          <Zone key={z.kind} zone={z} busy={busy || isRestoring} onFile={onFile} />
        ))}
      </div>

      {last ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">Last file</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="font-medium">{last.filename}</span> · {last.used} of {last.rows} rows used
            </p>
            <p className="text-muted-foreground">
              Volumes: {JSON.stringify(last.volumes)} · KPIs: {JSON.stringify(
                Object.fromEntries(
                  Object.entries(last.kpis).map(([k, v]) => [k, Number(v).toFixed(1)]),
                ),
              )}
            </p>
            {last.errors.length ? (
              <ul className="list-disc pl-5 text-destructive">
                {last.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl">Current data</h2>
        {uploads.length ? (
          <Button type="button" variant="outline" onClick={clearUploads}>
            Clear session
          </Button>
        ) : null}
      </div>
      {uploads.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files yet. Dashboard and Trends stay empty until you upload.</p>
      ) : (
        <ul className="space-y-2">
          {uploads.map((u) => (
            <li key={u.kind} className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
              <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden />
              <span className="font-medium">{u.filename}</span>
              <Badge variant="secondary">{u.kind}</Badge>
              <span className="text-muted-foreground">
                {u.used} rows · {u.months.map((m) => m.monthLabel).join(", ") || "no months"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
