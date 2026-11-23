import { useState } from "react";
import { Link } from "react-router-dom";
import { useIdentity } from "../../../lib/identity";
import { FileSpreadsheet } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { KPI_BY_KEY, KPI_DEFS, formatKpi } from "@/widgets/TeamPerformanceMetrics/lib/kpis";
import { VOLUME_DEFS } from "@/widgets/TeamPerformanceMetrics/lib/volumes";
import { type TrendGrain } from "@/widgets/TeamPerformanceMetrics/lib/seed-snapshot";
import { useSnapshotUploads } from "@/widgets/TeamPerformanceMetrics/lib/snapshot-store";
import type { UploadKind } from "@/widgets/TeamPerformanceMetrics/lib/parse-excel";
import { RawReferenceTable } from "@/widgets/TeamPerformanceMetrics/components/RawReferenceDialog";
import { hasLiveData, liveMemberTrends } from "@/widgets/TeamPerformanceMetrics/lib/live-data";
import { TEAM_MEMBERS, matchTeamMember } from "@/widgets/TeamPerformanceMetrics/lib/team-members";
import { Card, CardContent } from "@/widgets/TeamPerformanceMetrics/components/ui/card";
import { Button } from "@/widgets/TeamPerformanceMetrics/components/ui/button";
import { BlurFade } from "@/widgets/TeamPerformanceMetrics/components/ui/blur-fade";
import { NumberTicker } from "@/widgets/TeamPerformanceMetrics/components/ui/number-ticker";
import { Delta } from "@/widgets/TeamPerformanceMetrics/components/Delta";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/widgets/TeamPerformanceMetrics/components/ui/select";

const STROKE = "#0b5cab";
const VOLUME_SOURCES: { kind: UploadKind; label: string }[] = [
  { kind: "tickets", label: "Tickets" },
  { kind: "calls", label: "Calls" },
  { kind: "mobility", label: "Mobility tasks" },
];

function TrendArea({
  data,
  grain,
  formatValue,
  fillId,
}: {
  data: { label: string; value: number }[];
  grain: TrendGrain;
  formatValue: (v: number) => string;
  fillId: string;
}) {
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.22, max * 0.04, 0.5);
  const domain: [number, number] = [Math.max(0, min - pad), max + pad];
  const angled = grain === "month";

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 22, right: 20, left: 0, bottom: angled ? 28 : 8 }}>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={STROKE} stopOpacity={0.38} />
            <stop offset="100%" stopColor={STROKE} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#d5dde5" vertical={false} />
        <XAxis
          dataKey="label"
          interval={0}
          tick={{ fontSize: 10, fill: "#5b6775" }}
          tickMargin={8}
          angle={angled ? -40 : 0}
          textAnchor={angled ? "end" : "middle"}
          height={angled ? 52 : 28}
        />
        <YAxis
          domain={domain}
          width={48}
          tick={{ fontSize: 11, fill: "#5b6775" }}
          tickFormatter={(v: number) =>
            v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v * 10) / 10)
          }
        />
        <Tooltip
          formatter={(val) => formatValue(Number(val ?? 0))}
          contentStyle={{
            borderRadius: 8,
            border: "1px solid #d5dde5",
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={STROKE}
          strokeWidth={2.5}
          fill={`url(#${fillId})`}
          dot={{ r: 3, fill: STROKE, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="value"
            position="top"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            content={(props: any) => {
              const x = Number(props.x);
              const y = Number(props.y);
              const value = Number(props.value);
              if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(value)) {
                return null;
              }
              return (
                <text
                  x={x}
                  y={y}
                  dy={-8}
                  textAnchor="middle"
                  fill="#1b2430"
                  fontSize={10}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatValue(value)}
                </text>
              );
            }}
          />
        </Area>
      </AreaChart>
    </ResponsiveContainer>
  );
}

function MetricTrend({
  title,
  data,
  grain,
  formatValue,
  higherIsBetter,
  unit,
  fillId,
}: {
  title: string;
  data: { label: string; value: number }[];
  grain: TrendGrain;
  formatValue: (v: number) => string;
  higherIsBetter: boolean;
  unit: "percent" | "number" | "seconds";
  fillId: string;
}) {
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const display = last?.value ?? 0;
  const isSeconds = unit === "seconds";

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="font-display mt-1 flex items-baseline text-3xl tabular-nums">
              {isSeconds ? (
                formatValue(display)
              ) : (
                <>
                  <NumberTicker value={Number(display.toFixed(unit === "percent" ? 1 : 0))} />
                  {unit === "percent" ? "%" : ""}
                </>
              )}
              {prev ? (
                <Delta
                  current={display}
                  previous={prev.value}
                  higherIsBetter={higherIsBetter}
                  unit={unit}
                />
              ) : null}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {last?.label}
              {prev ? ` vs ${prev.label}` : ""}
            </p>
          </div>
        </div>
        <div className="mt-2 h-64">
          <TrendArea data={data} grain={grain} formatValue={formatValue} fillId={fillId} />
        </div>
      </CardContent>
    </Card>
  );
}

export default function Individual() {
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";
  const ownMember = identity ? matchTeamMember(identity.name) ?? "" : "";
  const [grain, setGrain] = useState<TrendGrain>("month");
  const [selectedMember, setSelectedMember] = useState<string>(TEAM_MEMBERS[0]);
  const member = isManager ? selectedMember : ownMember;
  const [activeSourceKind, setActiveSourceKind] = useState<UploadKind | null>(null);
  const { uploads } = useSnapshotUploads();
  const sourceOptions = VOLUME_SOURCES.map((source) => ({
    ...source,
    upload: uploads.find((upload) => upload.kind === source.kind),
  }));
  const selectedSource = sourceOptions.find(
    (source) => source.kind === activeSourceKind && source.upload,
  );
  const live = hasLiveData(uploads);
  const series = liveMemberTrends(uploads, grain, member);
  const windowLabel = grain === "month" ? "13 months (Oct 25–Oct 26)" : "5 quarters (Q4 25–Q4 26)";

  if (!live) {
    return (
      <div className="space-y-8">
        <BlurFade>
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">NOC</p>
            <h1 className="font-display mt-1 text-3xl md:text-4xl">Individual metrics</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Same volume and SLA charts as Team Trends, filtered to one person. Upload tickets first.
            </p>
          </div>
        </BlurFade>
        <Card>
          <CardContent className="flex flex-col items-start gap-4 py-10">
            <p className="text-sm text-muted-foreground">
              {isManager ? "No file loaded yet." : "Performance data is not available yet. Ask your manager to upload the workbook."}
            </p>
            {isManager ? (
              <Button asChild>
                <Link to="/upload">Upload Excel</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isManager && !TEAM_MEMBERS.includes(member as (typeof TEAM_MEMBERS)[number])) {
    return (
      <Card>
        <CardContent className="py-10 text-sm text-muted-foreground">
          Your individual performance profile could not be matched to this workbook roster. Contact your manager to verify your roster name.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <BlurFade>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">NOC</p>
            <h1 className="font-display mt-1 text-3xl md:text-4xl">Individual metrics</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Tickets are attributed via Acked By and mobility via Task Owner. Last {windowLabel}. Call metrics appear only when the calls report identifies this person.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {isManager ? (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Team member
                <Select value={member} onValueChange={setSelectedMember}>
                  <SelectTrigger className="w-[260px]" aria-label="Team member">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEAM_MEMBERS.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            ) : (
              <div className="flex flex-col gap-1 text-xs text-muted-foreground" aria-label="Your individual metrics">
                <span>Your metrics</span>
                <span className="text-sm font-medium text-foreground">{member}</span>
              </div>
            )}
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Window
              <Select value={grain} onValueChange={(v) => setGrain(v as TrendGrain)}>
                <SelectTrigger className="w-[200px]" aria-label="Trend window">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">13 months</SelectItem>
                  <SelectItem value="quarter">5 quarters · Q4 25–Q4 26</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
        </div>
      </BlurFade>

      <div>
        <h2 className="font-display text-2xl">Volumes</h2>
        <p className="mt-1 text-sm text-muted-foreground">This person’s tickets (and other volumes if present) over the window.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {VOLUME_DEFS.map((v) => {
          const data = series.map((p) => ({ label: p.label, value: p.volumes[v.key] }));
          return (
            <MetricTrend
              key={v.key}
              title={v.label}
              data={data}
              grain={grain}
              formatValue={(val) => val.toLocaleString("en-US")}
              higherIsBetter
              unit="number"
              fillId={`ind-vol-${v.key}`}
            />
          );
        })}
      </div>

      <section aria-labelledby="volume-source-heading" className="space-y-4">
        <div>
          <h3 id="volume-source-heading" className="font-display text-xl">Volume source rows</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a workbook to inspect the original rows behind this person’s volume totals.
          </p>
        </div>
        <div role="group" aria-label="Volume source workbook" className="flex flex-wrap gap-2">
          {sourceOptions.map((source) => (
            <Button
              key={source.kind}
              type="button"
              variant={selectedSource?.kind === source.kind ? "default" : "outline"}
              aria-pressed={selectedSource?.kind === source.kind}
              disabled={!source.upload}
              onClick={() => setActiveSourceKind((current) => current === source.kind ? null : source.kind)}
            >
              <FileSpreadsheet aria-hidden="true" />
              {source.label}
            </Button>
          ))}
        </div>
        {selectedSource?.upload ? (
          <RawReferenceTable
            key={`${selectedSource.kind}-${selectedSource.upload.uploadId ?? selectedSource.upload.filename}`}
            member={member}
            metric={selectedSource.label}
            upload={selectedSource.upload}
            active
          />
        ) : (
          <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            {selectedSource
              ? "Upload this workbook type to view its source rows here."
              : "Select a workbook above to show its source rows."}
          </p>
        )}
      </section>

      <div>
        <h2 className="font-display text-2xl">SLA</h2>
        <p className="mt-1 text-sm text-muted-foreground">Same SLA charts as Team Trends, for {member} only.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {KPI_DEFS.filter((k) => k.showOnTeam).map((k) => {
          const overallKey = k.overallKey ?? k.key;
          const overallDef = KPI_BY_KEY[overallKey];
          const data = series.map((p) => ({
            label: p.label,
            value: p.kpis[overallKey] ?? p.kpis[k.key] ?? 0,
          }));
          return (
            <MetricTrend
              key={k.key}
              title={k.label}
              data={data}
              grain={grain}
              formatValue={(val) => formatKpi(val, overallDef.unit, overallKey === "asa_seconds")}
              higherIsBetter={overallDef.higherIsBetter}
              unit={overallDef.unit}
              fillId={`ind-kpi-${k.key}`}
            />
          );
        })}
      </div>
    </div>
  );
}
