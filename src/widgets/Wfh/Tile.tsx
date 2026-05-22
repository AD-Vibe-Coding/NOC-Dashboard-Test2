import { Badge, Box, Divider, Group, Stack, Text, Title } from "@mantine/core";
import { IconHome, IconUserCheck } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useWfhData } from "./data";
import { useIdentity } from "../../lib/identity";
import { WFH_STATUS_COLORS, WFH_STATUS_LABELS, formatDateRange } from "../../lib/wfh";

interface Props {
  onExpand: () => void;
}

export function WfhTile({ onExpand }: Props) {
  const { data, loading } = useWfhData();
  const { identity } = useIdentity();

  const requests = data?.requests ?? [];
  const isApprover = !!data?.is_approver;
  const pending = requests.filter((r) => r.status === "pending");
  const approved = requests.filter((r) => r.status === "approved");
  const denied = requests.filter((r) => r.status === "denied");

  // For employee view, "your" requests are already filtered server-side.
  const mostRecent = requests[0];

  return (
    <WidgetTile
      title="WFH Requests"
      description={
        isApprover
          ? `Approver: ${identity?.name ?? ""}`
          : identity?.name
            ? "Apply for work-from-home"
            : "Pick your identity to apply"
      }
      icon={IconHome}
      iconColor="cyan"
      status={
        data
          ? isApprover
            ? {
                label: pending.length > 0 ? `${pending.length} pending` : "All clear",
                color: pending.length > 0 ? "red" : "green",
                tooltip: pending.length > 0
                  ? "You have pending requests to review"
                  : "No requests awaiting your approval",
              }
            : undefined
          : undefined
      }
      onExpand={onExpand}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        {isApprover ? (
          // ---- APPROVER VIEW ------------------------------------------------
          <>
            <Group align="flex-end" justify="space-between" wrap="nowrap">
              <Box>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Pending review
                </Text>
                <Title
                  order={1}
                  c={pending.length > 0 ? "red" : "green"}
                  style={{ lineHeight: 1 }}
                  mt={2}
                >
                  {pending.length}
                </Title>
                <Text size="xs" c="dimmed" mt={2}>
                  {approved.length} approved · {denied.length} denied
                </Text>
              </Box>
              <Badge
                variant="light"
                color="cyan"
                leftSection={<IconUserCheck size={10} />}
                size="sm"
                style={{ textTransform: "none" }}
              >
                Approver
              </Badge>
            </Group>
            {pending.length > 0 && (
              <>
                <Divider variant="dashed" />
                <Stack gap={4}>
                  {pending.slice(0, 3).map((r, idx) => (
                    <Group key={`pending-wfh-${r.id}-${idx}`} justify="space-between" wrap="nowrap" gap={6}>
                      <Text size="sm" fw={500} truncate style={{ minWidth: 0 }}>
                        {r.employee_name}
                      </Text>
                      <Text size="xs" c="dimmed" ff="monospace">
                        {formatDateRange(r.start_date, r.end_date)}
                      </Text>
                    </Group>
                  ))}
                  {pending.length > 3 && (
                    <Text size="xs" c="dimmed">
                      +{pending.length - 3} more pending
                    </Text>
                  )}
                </Stack>
              </>
            )}
          </>
        ) : (
          // ---- EMPLOYEE VIEW ------------------------------------------------
          <>
            <Group align="flex-end" justify="space-between" wrap="nowrap">
              <Box>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Your requests
                </Text>
                <Title order={1} c="cyan" style={{ lineHeight: 1 }} mt={2}>
                  {requests.length}
                </Title>
                <Text size="xs" c="dimmed" mt={2}>
                  {pending.length} pending · {approved.length} approved
                </Text>
              </Box>
            </Group>
            {mostRecent && (
              <>
                <Divider variant="dashed" />
                <Box>
                  <Text size="xs" c="dimmed" mb={2}>
                    Latest
                  </Text>
                  <Group justify="space-between" wrap="nowrap" gap={6}>
                    <Text size="sm" truncate style={{ minWidth: 0 }}>
                      {formatDateRange(mostRecent.start_date, mostRecent.end_date)}
                    </Text>
                    <Badge
                      size="xs"
                      variant="light"
                      color={WFH_STATUS_COLORS[mostRecent.status]}
                    >
                      {WFH_STATUS_LABELS[mostRecent.status]}
                    </Badge>
                  </Group>
                </Box>
              </>
            )}
            {requests.length === 0 && !loading && (
              <Box style={{ flex: 1 }}>
                <Text size="xs" c="dimmed" ta="center" mt="md">
                  {identity?.name
                    ? "No requests yet — click to apply"
                    : "Set your identity, then apply"}
                </Text>
              </Box>
            )}
          </>
        )}
      </Stack>
    </WidgetTile>
  );
}
