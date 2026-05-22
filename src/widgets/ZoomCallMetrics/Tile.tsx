import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Box,
  Card,
  Group,
  Progress,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { IconPhone } from "@tabler/icons-react";

interface MonthStats {
  answered: number;
  refused:  number;
  missed:   number;
  handle_seconds_sum: number;
  handle_count:       number;
  wait_seconds_sum:   number;
  wait_count:         number;
}

interface AgentData {
  name:     string;
  by_month: Record<string, MonthStats>;
}

interface ApiResponse {
  source:  "live" | "snapshot";
  months:  string[];
  agents:  AgentData[];
  warning: string | null;
}

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04"];

function addStats(a: MonthStats, b: MonthStats): MonthStats {
  return {
    answered:           a.answered + b.answered,
    refused:            a.refused  + b.refused,
    missed:             a.missed   + b.missed,
    handle_seconds_sum: a.handle_seconds_sum + b.handle_seconds_sum,
    handle_count:       a.handle_count + b.handle_count,
    wait_seconds_sum:   a.wait_seconds_sum + b.wait_seconds_sum,
    wait_count:         a.wait_count + b.wait_count,
  };
}

const empty = (): MonthStats => ({
  answered: 0, refused: 0, missed: 0,
  handle_seconds_sum: 0, handle_count: 0,
  wait_seconds_sum: 0, wait_count: 0,
});

function formatSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

export function ZoomCallMetricsTile() {
  const [data, setData]       = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch("/api/zoom/call-logs-range")
      .then((r) => r.json())
      .then((j) => setData(j))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Top 5 agents by answered calls (all months combined)
  const top5 = useMemo(() => {
    if (!data) return [];
    return data.agents
      .map((ag) => ({
        name: ag.name,
        total: MONTHS.reduce(
          (acc, m) => addStats(acc, ag.by_month[m] ?? empty()),
          empty(),
        ),
      }))
      .filter((r) => r.total.answered > 0)
      .sort((a, b) => b.total.answered - a.total.answered)
      .slice(0, 5);
  }, [data]);

  const teamTotal = useMemo(
    () => top5.reduce((acc, r) => addStats(acc, r.total), empty()),
    [top5],
  );

  const maxAnswered = top5.length > 0 ? top5[0].total.answered : 1;
  const teamHandle  =
    teamTotal.handle_count > 0
      ? teamTotal.handle_seconds_sum / teamTotal.handle_count
      : null;

  return (
    <Card withBorder radius="lg" p="md" h="100%">
      <Stack gap="sm" h="100%">
        {/* Header */}
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon radius="md" variant="light" color="green" size="md">
            <IconPhone size={16} />
          </ThemeIcon>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text fw={600} size="sm" truncate>
              Zoom Inbound Calls
            </Text>
            <Group gap={6}>
              <Text size="xs" c="dimmed">
                Jan – Apr 2026
              </Text>
              {data && (
                <Badge
                  size="xs"
                  color={data.source === "live" ? "green" : "yellow"}
                  variant="dot"
                >
                  {data.source === "live" ? "live" : "snapshot"}
                </Badge>
              )}
            </Group>
          </Box>
        </Group>

        {/* Summary row */}
        {loading ? (
          <>
            <Skeleton height={20} radius="sm" />
            <Skeleton height={20} radius="sm" />
            <Skeleton height={20} radius="sm" />
          </>
        ) : data ? (
          <>
            <Group justify="space-between" gap="xs">
              {[
                {
                  label: "Answered",
                  value: top5.reduce((s, r) => s + r.total.answered, 0) + (data.agents.slice(5).reduce((s, ag) => s + MONTHS.reduce((ss, m) => ss + (ag.by_month[m]?.answered ?? 0), 0), 0)),
                  color: "green.4",
                },
                {
                  label: "Refused",
                  value: data.agents.reduce((s, ag) => s + MONTHS.reduce((ss, m) => ss + (ag.by_month[m]?.refused ?? 0), 0), 0),
                  color: "red.4",
                },
                {
                  label: "Avg Handle",
                  value: teamHandle != null ? formatSeconds(teamHandle) : "—",
                  color: "teal.4",
                },
              ].map(({ label, value, color }) => (
                <Box key={label} ta="center">
                  <Text size="lg" fw={700} ff="monospace" c={color}>
                    {typeof value === "number" ? value.toLocaleString() : value}
                  </Text>
                  <Text size="xs" c="dimmed">{label}</Text>
                </Box>
              ))}
            </Group>

            {/* Top 5 agent mini-bars */}
            <Stack gap={4} style={{ flex: 1 }}>
              {top5.map((r) => (
                <Group key={r.name} gap="xs" wrap="nowrap">
                  <Text size="xs" truncate style={{ width: 110, flexShrink: 0 }}>
                    {r.name.split(" ")[0]}
                  </Text>
                  <Progress
                    value={(r.total.answered / maxAnswered) * 100}
                    color="green"
                    size="sm"
                    radius="xl"
                    style={{ flex: 1 }}
                  />
                  <Text
                    size="xs"
                    fw={600}
                    ff="monospace"
                    c="green.4"
                    style={{ width: 28, textAlign: "right", flexShrink: 0 }}
                  >
                    {r.total.answered}
                  </Text>
                </Group>
              ))}
            </Stack>
          </>
        ) : null}
      </Stack>
    </Card>
  );
}
