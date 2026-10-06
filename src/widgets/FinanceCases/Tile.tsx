import { Badge, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconBriefcase, IconCalendarMonth } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { db } from "../../db";
import { WidgetTile } from "../WidgetTile";

type FinanceCase = Awaited<ReturnType<typeof db.finance_cases.list>>[number];

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

export function FinanceCasesTile({ onExpand }: { onExpand: () => void }) {
  const [rows, setRows] = useState<FinanceCase[]>([]);

  useEffect(() => {
    db.finance_cases.list({
      filter: { month_key: currentMonthKey() },
      orderBy: { column: "created_at", ascending: false },
      limit: 5,
    }).then((data) => setRows(Array.isArray(data) ? data : [])).catch(() => setRows([]));
  }, []);

  const latest = useMemo(() => rows[0] ?? null, [rows]);

  return (
    <WidgetTile
      title="Finance Cases"
      description="Monthly finance case number and comment log"
      icon={IconBriefcase}
      iconColor="teal"
      onExpand={onExpand}
      status={{
        label: `${rows.length} this month`,
        color: rows.length > 0 ? "teal" : "gray",
      }}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon radius="md" variant="light" color="teal"><IconCalendarMonth size={16} /></ThemeIcon>
          <div style={{ flex: 1 }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Current month</Text>
            <Text fw={700}>{rows.length} finance case{rows.length === 1 ? "" : "s"}</Text>
          </div>
          <Badge variant="light" color="teal">Log</Badge>
        </Group>
        <Text size="sm" c="dimmed">
          {latest ? `Latest: ${latest.case_number}` : "Track finance cases received each month with a short comment."}
        </Text>
      </Stack>
    </WidgetTile>
  );
}
