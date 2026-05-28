import {
  Alert,
  Badge,
  Box,
  Card,
  Divider,
  Group,
  RingProgress,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCoffee,
  IconHeadset,
  IconUserCheck,
  IconUserOff,
} from "@tabler/icons-react";
import { ZOOM_STATUS_COLORS, ZOOM_STATUS_LABELS, type ZoomAgent } from "../../lib/zoom";
import { WidgetFrame } from "../WidgetFrame";
import { useZoomQueue } from "./data";
import { useBreakData } from "../BreakTracker/data";
import { useRosterShift } from "../../lib/use-roster-shift";
import { IconCalendar } from "@tabler/icons-react";

export { ZoomQueueTile } from "./Tile";

const TRACKED_QUEUES = ["Network Tech Support", "Mobility Tech Support"];
const QUEUE_SHORT: Record<string, string> = {
  "Network Tech Support": "NOC",
  "Mobility Tech Support": "Mobility",
};

const BREAK_EMOJI: Record<string, string> = {
  Coffee:   "☕",
  Lunch:    "🍽️",
  Restroom: "🚻",
  Personal: "👤",
  Other:    "⏸️",
};

// Normalise names for fuzzy matching between Zoom display names and Break Tracker employee names
function normName(n: string) {
  return n.toLowerCase().replace(/\s+/g, " ").trim();
}

export function ZoomQueueWidget() {
  const { data, loading, error, refresh } = useZoomQueue();
  const { active: activeBreaks } = useBreakData();
  const { data: rosterData, isInShift, configured: rosterConfigured } = useRosterShift();

  // Build a map: normalised name → break_type for anyone currently on break
  const breakMap = new Map<string, string>(
    activeBreaks.map((b) => [normName(b.employee_name), b.break_type]),
  );

  // All Zoom agents, filtered to only those in their shift per the roster
  const allAgents  = (data?.agents ?? []).filter((a) => !a.display_name.toLowerCase().includes("overflow"));
  const agents     = allAgents.filter((a) => isInShift(a.display_name));
  const hiddenCount = allAgents.length - agents.length; // agents filtered out (off-shift)

  const inQueue    = agents.filter((a) => a.status === "in_queue");
  const notInQueue = agents.filter((a) => a.status === "not_in_queue");
  const total      = agents.length;
  const pct        = total > 0 ? Math.round((inQueue.length / total) * 100) : 0;

  // Per-queue counts
  const allQueues = TRACKED_QUEUES.filter((q) =>
    agents.some((a) => a.queue_opt_in && q in a.queue_opt_in),
  );
  const queueCounts = Object.fromEntries(
    allQueues.map((q) => [q, agents.filter((a) => a.queue_opt_in?.[q] === true).length]),
  );

  const onBreakCount = notInQueue.filter((a) => breakMap.has(normName(a.display_name))).length;



  return (
    <WidgetFrame
      title="Zoom Queue"
      subtitle={data
        ? `${data.queue_name ?? "NOC Queue"} · ${agents.length} in shift${hiddenCount > 0 ? ` (${hiddenCount} off-shift hidden)` : ""}`
        : "Loading…"}
      icon={IconHeadset}
      iconColor="blue"
      loading={loading}
      onRefresh={refresh}
      status={
        data
          ? {
              label: data.source,
              color: data.source === "live" ? "green" : "yellow",
              tooltip: data.source === "live"
                ? "Live data from Zoom Phone API"
                : "Snapshot — set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET in .env",
            }
          : undefined
      }
    >
      <Stack gap="md">
        {data?.warning && (
          <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light" radius="md">
            {data.warning}
          </Alert>
        )}
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" radius="md">
            Failed to load: {error}
          </Alert>
        )}

        {/* ── Roster shift banner ── */}
        {rosterConfigured && rosterData && !rosterData.error && (
          <Alert
            icon={<IconCalendar size={16} />}
            color="blue"
            variant="light"
            radius="md"
          >
            <Group gap="xs" wrap="wrap">
              <Text size="sm" fw={600}>Roster filtered — showing {agents.length} agents in shift</Text>
              {hiddenCount > 0 && (
                <Badge size="sm" color="gray" variant="outline">{hiddenCount} off-shift hidden</Badge>
              )}
              <Text size="xs" c="dimmed">
                · {rosterData.sheetTitle} · strategy: {rosterData.strategy}
              </Text>
            </Group>
          </Alert>
        )}
        {rosterData?.error && (
          <Alert icon={<IconAlertCircle size={16} />} color="orange" variant="light" radius="md">
            Roster not linked: {rosterData.error}
          </Alert>
        )}

        {/* ── Availability summary ── */}
        <SimpleGrid cols={{ base: 1, sm: allQueues.length > 0 ? 3 : 2 }} spacing="md">
          {/* Overall */}
          <Card withBorder radius="md" p="md">
            <Group justify="space-between" align="center" wrap="nowrap">
              <Stack gap={2}>
                <Text size="xs" c="dimmed" fw={600} tt="uppercase">Queue Availability</Text>
                <Group gap={4} align="baseline">
                  <Text size="2rem" fw={800} c="green" ff="monospace" style={{ lineHeight: 1 }}>
                    {inQueue.length}
                  </Text>
                  <Text size="sm" c="dimmed">/ {total} agents</Text>
                </Group>
                <Group gap={6}>
                  <Text size="xs" c="dimmed">{notInQueue.length} not in queue</Text>
                  {onBreakCount > 0 && (
                    <Badge size="xs" color="orange" variant="light" leftSection={<IconCoffee size={10} />}>
                      {onBreakCount} on break
                    </Badge>
                  )}
                </Group>
              </Stack>
              <RingProgress
                size={80}
                thickness={8}
                roundCaps
                sections={[{ value: pct, color: pct >= 60 ? "green" : pct >= 30 ? "yellow" : "red" }]}
                label={
                  <Box ta="center">
                    <Text size="xs" fw={700} ff="monospace">{pct}%</Text>
                  </Box>
                }
              />
            </Group>
          </Card>

          {/* Per-queue cards */}
          {allQueues.map((q) => {
            const count = queueCounts[q] ?? 0;
            const qPct  = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <Card key={q} withBorder radius="md" p="md">
                <Group justify="space-between" align="center" wrap="nowrap">
                  <Stack gap={2}>
                    <Text size="xs" c="dimmed" fw={600} tt="uppercase">{QUEUE_SHORT[q] ?? q}</Text>
                    <Group gap={4} align="baseline">
                      <Text size="2rem" fw={800} c="teal" ff="monospace" style={{ lineHeight: 1 }}>
                        {count}
                      </Text>
                      <Text size="sm" c="dimmed">opted in</Text>
                    </Group>
                    <Text size="xs" c="dimmed">{total - count} out</Text>
                  </Stack>
                  <RingProgress
                    size={80}
                    thickness={8}
                    roundCaps
                    sections={[{ value: qPct, color: "teal" }]}
                    label={
                      <Box ta="center">
                        <Text size="xs" fw={700} ff="monospace">{qPct}%</Text>
                      </Box>
                    }
                  />
                </Group>
              </Card>
            );
          })}
        </SimpleGrid>

        {/* ── Agent lists ── */}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          {/* In Queue */}
          <Card withBorder radius="md" p={0}
            style={{ borderTop: "3px solid var(--mantine-color-green-6)" }}>
            <Group px="md" py="sm" gap="xs">
              <ThemeIcon size="sm" variant="light" color="green" radius="xl">
                <IconUserCheck size={13} />
              </ThemeIcon>
              <Text fw={600} size="sm">In Queue</Text>
              <Badge size="sm" color="green" variant="filled" circle>{inQueue.length}</Badge>
            </Group>
            <Divider />
            {inQueue.length === 0 ? (
              <Text size="xs" c="dimmed" ta="center" py="lg">No agents in queue</Text>
            ) : (
              <ScrollArea.Autosize mah={360}>
                <Table striped highlightOnHover withRowBorders={false} verticalSpacing="xs" horizontalSpacing="md">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Agent</Table.Th>
                      {allQueues.map((q) => (
                        <Table.Th key={q} style={{ textAlign: "center" }}>{QUEUE_SHORT[q] ?? q}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {inQueue.map((a) => (
                      <AgentRow key={a.agent_id} agent={a} queues={allQueues} breakType={undefined} showReason={false} />
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}
          </Card>

          {/* Not in Queue */}
          <Card withBorder radius="md" p={0}
            style={{ borderTop: "3px solid var(--mantine-color-gray-6)" }}>
            <Group px="md" py="sm" gap="xs">
              <ThemeIcon size="sm" variant="light" color="gray" radius="xl">
                <IconUserOff size={13} />
              </ThemeIcon>
              <Text fw={600} size="sm">Not in Queue</Text>
              <Badge size="sm" color="gray" variant="filled" circle>{notInQueue.length}</Badge>
              {onBreakCount > 0 && (
                <Badge size="xs" color="orange" variant="light">
                  {onBreakCount} on break
                </Badge>
              )}
            </Group>
            <Divider />
            {notInQueue.length === 0 ? (
              <Text size="xs" c="dimmed" ta="center" py="lg">All agents are in queue</Text>
            ) : (
              <ScrollArea.Autosize mah={360}>
                <Table striped highlightOnHover withRowBorders={false} verticalSpacing="xs" horizontalSpacing="md">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Agent</Table.Th>
                      <Table.Th>Reason</Table.Th>
                      {allQueues.map((q) => (
                        <Table.Th key={q} style={{ textAlign: "center" }}>{QUEUE_SHORT[q] ?? q}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {notInQueue.map((a) => (
                      <AgentRow
                        key={a.agent_id}
                        agent={a}
                        queues={allQueues}
                        breakType={breakMap.get(normName(a.display_name))}
                        showReason
                      />
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}
          </Card>
        </SimpleGrid>

        {data && (
          <Text size="xs" c="dimmed" ta="right">
            {total} agents · refreshed {new Date(data.fetched_at).toLocaleTimeString()} · break status from Break Tracker
          </Text>
        )}
      </Stack>
    </WidgetFrame>
  );
}

function AgentRow({
  agent,
  queues,
  breakType,
  showReason,
}: {
  agent: ZoomAgent;
  queues: string[];
  breakType?: string;
  showReason: boolean;
}) {
  const isOnBreak = !!breakType;

  return (
    <Table.Tr>
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          <Badge size="xs" variant="dot" color={ZOOM_STATUS_COLORS[agent.status]} />
          <Text size="sm" fw={500}>{agent.display_name}</Text>
        </Group>
      </Table.Td>

      {showReason && (
        <Table.Td>
          {isOnBreak ? (
            <Tooltip label={`On ${breakType} break`} withArrow withinPortal>
              <Badge size="sm" color="orange" variant="light" leftSection={<IconCoffee size={11} />}>
                {BREAK_EMOJI[breakType ?? ""] ?? "⏸️"} {breakType}
              </Badge>
            </Tooltip>
          ) : (
            <Badge size="sm" color="gray" variant="subtle">Not in queue</Badge>
          )}
        </Table.Td>
      )}

      {queues.map((q) => {
        const isIn  = agent.queue_opt_in?.[q] === true;
        const known = agent.queue_opt_in && q in agent.queue_opt_in;
        return (
          <Table.Td key={q} style={{ textAlign: "center" }}>
            {!known ? (
              <Text size="xs" c="dimmed">—</Text>
            ) : isIn ? (
              <Badge size="xs" color="green" variant="light">In</Badge>
            ) : (
              <Badge size="xs" color="gray" variant="light">Out</Badge>
            )}
          </Table.Td>
        );
      })}
    </Table.Tr>
  );
}

// Suppress unused import warnings
void ZOOM_STATUS_LABELS;
