import { Badge, Group, Text } from "@mantine/core";
import type { AggregateOptions } from "./data";
import { SHIFT_LABELS } from "./data";

export function filterChipLabels(options?: AggregateOptions) {
  const periodLabel = !options?.period || options.period.type === "all"
    ? "Month range: All time"
    : options.period.type === "month"
      ? `Month range: ${options.period.value}`
      : `Quarter: ${options.period.value}`;

  return [
    `Queue: ${options?.queue && options.queue !== "all" ? options.queue.toUpperCase() : "All"}`,
    `Maintenance: ${options?.excludeMaintenance ? "Excluded" : "Included"}`,
    `Days: ${options?.dayFilter === "weekday" ? "Weekday only" : options?.dayFilter === "weekend" ? "Weekend only" : "All days"}`,
    `Shift: ${SHIFT_LABELS[options?.shiftFilter ?? "all"]}`,
    periodLabel,
  ];
}

export function ActiveFilterChips({
  options,
  rowCount,
  scopeLabel,
}: {
  options?: AggregateOptions;
  rowCount?: number;
  scopeLabel?: string;
}) {
  const labels = filterChipLabels(options);
  return (
    <Group gap="xs" wrap="wrap">
      {scopeLabel && (
        <Badge variant="light" color="blue">
          Scope: {scopeLabel}
        </Badge>
      )}
      {typeof rowCount === "number" && (
        <Badge variant="outline" color="gray">
          Matching rows: {rowCount.toLocaleString()}
        </Badge>
      )}
      {labels.map((label) => (
        <Badge key={label} variant="dot" color="teal">
          {label}
        </Badge>
      ))}
    </Group>
  );
}

export function FilterHintText({ text }: { text: string }) {
  return (
    <Text size="xs" c="dimmed">
      {text}
    </Text>
  );
}
