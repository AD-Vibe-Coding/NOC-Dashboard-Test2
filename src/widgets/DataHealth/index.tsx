import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Card,
  Group,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { IconDatabase } from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";

export { DataHealthTile } from "./Tile";

type TableRow = {
  table: string;
  count: number;
  ok: boolean;
  error?: string;
};

type DataHealthResponse = {
  checked_at: string;
  totals: {
    total_tables: number;
    non_empty_tables: number;
    empty_tables: number;
    errored_tables: number;
    total_rows: number;
  };
  tables: TableRow[];
};

export function DataHealthWidget() {
  const [data, setData] = useState<DataHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/data-health");
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? `HTTP ${res.status}`);
      setData(payload as DataHealthResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data health");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const sortedTables = useMemo(() => {
    if (!data) return [];
    return [...data.tables].sort((a, b) => b.count - a.count);
  }, [data]);

  return (
    <WidgetFrame
      title="Data Health"
      subtitle={data ? `Last checked ${new Date(data.checked_at).toLocaleString()}` : "Checking database status…"}
      icon={IconDatabase}
      iconColor="orange"
      loading={loading}
      onRefresh={load}
      status={{ label: "Read only", color: "green", tooltip: "Counts only — no write/delete operations" }}
    >
      <Stack gap="lg">
        {error && (
          <Card withBorder radius="md" p="md" style={{ borderColor: "var(--mantine-color-red-6)" }}>
            <Text c="red" size="sm">{error}</Text>
          </Card>
        )}

        <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="sm">
          <MetricCard label="Tables" value={data?.totals.total_tables ?? 0} color="orange" />
          <MetricCard label="Non-empty" value={data?.totals.non_empty_tables ?? 0} color="teal" />
          <MetricCard label="Empty" value={data?.totals.empty_tables ?? 0} color="gray" />
          <MetricCard label="Errored" value={data?.totals.errored_tables ?? 0} color="red" />
          <MetricCard label="Total rows" value={data?.totals.total_rows ?? 0} color="indigo" />
        </SimpleGrid>

        <Card withBorder radius="md" p={0}>
          <ScrollArea.Autosize mah={420}>
            <Table striped highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Table</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>Rows</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sortedTables.map((row) => (
                  <Table.Tr key={row.table}>
                    <Table.Td>
                      <Text ff="monospace" size="sm">{row.table}</Text>
                      {row.error && (
                        <Text size="xs" c="red">{row.error}</Text>
                      )}
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }}>
                      <Text fw={600}>{row.count.toLocaleString()}</Text>
                    </Table.Td>
                    <Table.Td>
                      {row.ok ? (
                        <Badge size="sm" color={row.count > 0 ? "teal" : "gray"} variant="light">
                          {row.count > 0 ? "Has data" : "Empty"}
                        </Badge>
                      ) : (
                        <Badge size="sm" color="red" variant="light">Error</Badge>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        </Card>
      </Stack>
    </WidgetFrame>
  );
}

function MetricCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card withBorder radius="md" p="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={2}>
          <Text size="xs" c="dimmed">{label}</Text>
          <Text fw={700} size="xl" c={color} ff="monospace">
            {value.toLocaleString()}
          </Text>
        </Stack>
      </Group>
    </Card>
  );
}
