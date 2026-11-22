import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/widgets/TeamPerformanceMetrics/lib/utils";

export function Delta({
  current,
  previous,
  higherIsBetter,
  unit,
}: {
  current: number;
  previous: number;
  higherIsBetter: boolean;
  unit?: "percent" | "number" | "seconds";
}) {
  const diff = current - previous;
  const abs = Math.abs(diff);
  const improved = higherIsBetter ? diff > 0 : diff < 0;
  const worsened = higherIsBetter ? diff < 0 : diff > 0;
  const flat = Math.abs(diff) < 0.05;

  const formatted =
    unit === "percent"
      ? `${abs.toFixed(1)}`
      : unit === "seconds"
        ? abs < 10
          ? abs.toFixed(1)
          : abs.toFixed(0)
        : abs.toLocaleString("en-US", { maximumFractionDigits: 0 });

  return (
    <span
      className={cn(
        "ml-2 inline-flex items-center gap-0.5 align-middle text-[11px] font-medium tabular-nums",
        flat && "text-muted-foreground",
        improved && "text-emerald-600 dark:text-emerald-400",
        worsened && "text-red-600 dark:text-red-400",
      )}
      title={`Previous: ${previous}`}
    >
      {flat ? (
        <Minus className="size-3" aria-hidden />
      ) : improved ? (
        <ArrowUp className="size-3" aria-hidden />
      ) : (
        <ArrowDown className="size-3" aria-hidden />
      )}
      {formatted}
      {unit === "percent" ? " pts" : ""}
    </span>
  );
}
