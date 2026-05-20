import { Box, Divider, Group, Stack, Text, Title } from "@mantine/core";
import { IconReportAnalytics, IconUpload, IconUsersGroup } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useIdentity } from "../../lib/identity";
import { usePerformanceData, aggregateMetrics } from "./data";
import {
  LOCKED_TEAM,
  LOCKED_TEAM_NAMES,
  resolveTeamMember,
} from "./team";

interface Props {
  onExpand: () => void;
}

export function PerformanceTrackerTile({ onExpand }: Props) {
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";
  const canonicalSelf = identity ? resolveTeamMember(identity.name) : null;
  const { metrics, imports } = usePerformanceData();

  const summaries = aggregateMetrics(metrics, LOCKED_TEAM_NAMES);

  // Stats vary based on viewer
  const personal = canonicalSelf
    ? summaries.find((s) => s.memberName === canonicalSelf)
    : null;

  // For the tile preview, surface the "top" stat
  const ticketsTotal = isManager
    ? metrics.filter((m) => m.source_type === "tickets").reduce((s, m) => s + (m.total_count ?? 0), 0)
    : personal?.byType?.tickets?.totalSum ?? 0;
  const callsTotal = isManager
    ? metrics.filter((m) => m.source_type === "calls").reduce((s, m) => s + (m.total_count ?? 0), 0)
    : personal?.byType?.calls?.totalSum ?? 0;
  const tasksTotal = isManager
    ? metrics.filter((m) => m.source_type === "tasks").reduce((s, m) => s + (m.total_count ?? 0), 0)
    : personal?.byType?.tasks?.totalSum ?? 0;

  const headlineNumber = ticketsTotal;
  const subtitle = isManager
    ? `${LOCKED_TEAM.length} members · ${imports.length} import${imports.length === 1 ? "" : "s"}`
    : canonicalSelf
      ? `${canonicalSelf} · ${imports.length} import${imports.length === 1 ? "" : "s"}`
      : "Not on performance roster";

  // Top performer by tickets (manager view)
  const topPerformer = isManager
    ? [...summaries]
        .filter((s) => (s.byType.tickets?.totalSum ?? 0) > 0)
        .sort(
          (a, b) =>
            (b.byType.tickets?.totalSum ?? 0) -
            (a.byType.tickets?.totalSum ?? 0),
        )[0]
    : null;

  const hasData = metrics.length > 0;

  return (
    <WidgetTile
      title="Team Performance"
      description={isManager ? "Team metrics + Excel import" : "Your metrics"}
      icon={IconReportAnalytics}
      iconColor="green"
      status={{
        label: isManager ? "manager" : "individual",
        color: isManager ? "red" : "blue",
        tooltip: isManager
          ? "Full team access"
          : "Locked to your own metrics",
      }}
      onExpand={onExpand}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {isManager ? "Team tickets" : "Your tickets"}
          </Text>
          <Group align="flex-end" gap="xs">
            <Title order={1} c="green" style={{ lineHeight: 1 }}>
              {headlineNumber.toLocaleString()}
            </Title>
          </Group>
          <Text size="xs" c="dimmed" mt={2}>
            {subtitle}
          </Text>
        </Box>

        {hasData ? (
          <>
            <Divider variant="dashed" />
            <Group gap="sm" justify="space-between">
              <SmallStat label="Calls" value={callsTotal} color="green" />
              <SmallStat label="Tasks" value={tasksTotal} color="violet" />
            </Group>

            {isManager && topPerformer && (
              <Box mt="xs">
                <Group gap={6}>
                  <IconUsersGroup
                    size={12}
                    color="var(--mantine-color-dimmed)"
                  />
                  <Text size="xs" c="dimmed">
                    Top:{" "}
                    <Text component="span" fw={600}>
                      {topPerformer.memberName}
                    </Text>{" "}
                    ({topPerformer.byType.tickets?.totalSum ?? 0})
                  </Text>
                </Group>
              </Box>
            )}
          </>
        ) : (
          <Box style={{ flex: 1 }}>
            <Group gap={6} mt="md">
              <IconUpload size={12} color="var(--mantine-color-dimmed)" />
              <Text size="xs" c="dimmed">
                {isManager
                  ? "Click to import an Excel workbook"
                  : "Waiting for manager to import data"}
              </Text>
            </Group>
          </Box>
        )}
      </Stack>
    </WidgetTile>
  );
}

function SmallStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <Box>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ fontSize: 9 }}>
        {label}
      </Text>
      <Text
        size="sm"
        fw={600}
        ff="monospace"
        c={value > 0 ? `${color}.4` : "dimmed"}
      >
        {value > 0 ? value.toLocaleString() : "—"}
      </Text>
    </Box>
  );
}
