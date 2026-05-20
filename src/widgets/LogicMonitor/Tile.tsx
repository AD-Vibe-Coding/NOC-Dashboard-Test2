import { Box, Badge, Divider, Group, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle, IconChartArea } from "@tabler/icons-react";
import { useLogicMonitor } from "./data";
import { elapsedSince, LM_SEVERITY_COLORS } from "../../lib/logicmonitor";
import { WidgetTile } from "../WidgetTile";

interface Props {
  onExpand: () => void;
}

export function LogicMonitorTile({ onExpand }: Props) {
  const { alerts, devices } = useLogicMonitor({
    severity: ["critical", "error"],
    includeAcked: false,
    size: 50,
  });

  const activeAlerts = alerts?.alerts ?? [];
  const critCount = activeAlerts.filter((a) => a.severity === "critical").length;
  const errCount = activeAlerts.filter((a) => a.severity === "error").length;
  const topAlert = activeAlerts[0];

  return (
    <WidgetTile
      title="LogicMonitor"
      description="Live alert feed + device health"
      icon={IconChartArea}
      iconColor="red"
      status={
        alerts
          ? {
              label: alerts.source === "live" ? "live" : "snapshot",
              color: alerts.source === "live" ? "green" : "yellow",
              tooltip: alerts.warning ?? undefined,
            }
          : undefined
      }
      onExpand={onExpand}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group align="flex-end" justify="space-between" wrap="nowrap">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Open alerts
            </Text>
            <Title
              order={1}
              c={critCount > 0 ? "red" : errCount > 0 ? "orange" : "dimmed"}
              style={{ lineHeight: 1 }}
              mt={2}
            >
              {activeAlerts.length}
            </Title>
            <Text size="xs" c="dimmed" mt={2}>
              {critCount === 0 && errCount === 0
                ? "All clear"
                : `${critCount} critical · ${errCount} error`}
            </Text>
          </Box>
          {devices?.summary && (
            <Box ta="right">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Devices
              </Text>
              <Text size="lg" fw={600}>
                {devices.summary.total_devices.toLocaleString()}
              </Text>
              <Text size="xs" c="dimmed">
                {devices.summary.by_alert_state.ok} healthy
              </Text>
            </Box>
          )}
        </Group>

        {topAlert && (
          <>
            <Divider variant="dashed" />
            <Box>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
                Top alert
              </Text>
              <Group gap={6} wrap="nowrap">
                <IconAlertTriangle
                  size={12}
                  color={`var(--mantine-color-${LM_SEVERITY_COLORS[topAlert.severity]}-5)`}
                />
                <Badge
                  size="xs"
                  variant="light"
                  color={LM_SEVERITY_COLORS[topAlert.severity]}
                >
                  {topAlert.severity}
                </Badge>
                <Text size="xs" ff="monospace" c="dimmed">
                  {elapsedSince(topAlert.start_epoch)}
                </Text>
              </Group>
              <Text size="sm" fw={500} truncate mt={4}>
                {topAlert.monitor_object_name}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {topAlert.resource_template_name} · {topAlert.data_point}
              </Text>
            </Box>
          </>
        )}
      </Stack>
    </WidgetTile>
  );
}
