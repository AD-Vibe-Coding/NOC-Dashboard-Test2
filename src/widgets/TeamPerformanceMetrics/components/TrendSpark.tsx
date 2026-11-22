import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { cn } from "@/widgets/TeamPerformanceMetrics/lib/utils";

export function TrendSpark({
  data,
  id,
  className,
}: {
  data: { label: string; value: number }[];
  id: string;
  className?: string;
}) {
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.18, max * 0.02, 0.01);
  const domain: [number, number] = [Math.max(0, min - pad), max + pad];

  return (
    <div className={cn("h-24 w-full", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0b5cab" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#0b5cab" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke="#0b5cab"
            strokeWidth={2}
            fill={`url(#fill-${id})`}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            baseValue={domain[0]}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PeriodHeatmap({
  data,
  formatValue,
  higherIsBetter,
}: {
  data: { label: string; value: number }[];
  formatValue: (v: number) => string;
  higherIsBetter: boolean;
}) {
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(4.5rem, 1fr))" }}
    >
      {data.map((d) => {
        const t = (d.value - min) / span;
        const intensity = higherIsBetter ? t : 1 - t;
        const bg = `color-mix(in srgb, #0b5cab ${Math.round(18 + intensity * 62)}%, #e8eef4)`;
        const fg = intensity > 0.55 ? "#f7fbff" : "#1b2430";
        return (
          <div
            key={d.label}
            className="flex min-h-[64px] flex-col justify-between rounded-md px-1.5 py-1.5"
            style={{ background: bg, color: fg }}
            title={`${d.label}: ${formatValue(d.value)}`}
          >
            <span className="text-[10px] font-medium leading-tight opacity-80">{d.label}</span>
            <span className="text-[11px] font-semibold tabular-nums">{formatValue(d.value)}</span>
          </div>
        );
      })}
    </div>
  );
}
