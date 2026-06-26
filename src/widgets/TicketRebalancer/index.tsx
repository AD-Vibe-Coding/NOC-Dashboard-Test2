import { useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  FileButton,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { Dropzone } from "@mantine/dropzone";
import {
  IconArrowsShuffle,
  IconArrowRight,
  IconCalendar,
  IconClipboardText,
  IconCopy,
  IconFileSpreadsheet,
  IconInfoCircle,
  IconTableImport,
  IconUsers,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import type { TileProps } from "../types";
import { findTeamMember, isManager } from "./lib/team-config";
import { parseTicketFile, scoreTickets } from "./lib/parse-tickets";
import { DEFAULT_OPTIONS, rebalance, rebalanceShiftHandoff, type RebalanceMode } from "./lib/rebalance";
import { detectShift, SHIFT_TRANSITIONS } from "./lib/shifts";
import { formatForSlack } from "./lib/slack-format";
import type { AvailabilityStatus, RebalanceResult, RosterEntry, ScoredTicket } from "./lib/types";

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card withBorder radius="md" p="md" h="100%">
      <Stack gap={4}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: "0.06em" }}>
          {label}
        </Text>
        <Text fw={800} size="xl">
          {value}
        </Text>
        {hint ? (
          <Text size="xs" c="dimmed">
            {hint}
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}

function copyText(text: string) {
  return navigator.clipboard.writeText(text);
}

type SharedRosterApiEntry = {
  name: string;
  cell: string;
  status: AvailabilityStatus;
  available: boolean;
};

type SharedRosterApiResponse = {
  dailyEntries?: SharedRosterApiEntry[];
  sheetTitle?: string;
  targetDate?: string;
  strategy?: string;
  error?: string;
};

function mapSharedRosterEntries(entries: SharedRosterApiEntry[]): RosterEntry[] {
  return entries.map((entry) => {
    const member = findTeamMember(entry.name);
    const manager = isManager(entry.name);
    return {
      name: member?.name ?? entry.name,
      tier: member?.tier,
      isManager: manager,
      cellRaw: entry.cell,
      status: entry.status,
      shift: entry.available ? entry.cell : undefined,
      shiftId: entry.available ? detectShift(entry.cell) ?? undefined : undefined,
      available: entry.available && !manager,
    };
  });
}

export function TicketRebalancerTile({ onExpand }: TileProps) {
  return (
    <Card withBorder radius="lg" p="lg" h="100%" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <ThemeIcon size="xl" radius="md" color="grape" variant="light">
            <IconArrowsShuffle size={22} />
          </ThemeIcon>
          <Badge color="grape" variant="light">
            Manager
          </Badge>
        </Group>
        <div>
          <Text fw={700}>Ticket Rebalancer</Text>
          <Text size="sm" c="dimmed" mt={6}>
            Load an iPath export and run analysis to automatically pull the roster from the shared Team Availability source.
          </Text>
        </div>
        <Group gap="xs">
          <Badge variant="light" color="blue">Shared roster source</Badge>
        </Group>
      </Stack>
      <Button mt="lg" rightSection={<IconArrowRight size={16} />} onClick={onExpand}>
        Open widget
      </Button>
    </Card>
  );
}

export function TicketRebalancerWidget() {
  const [analysisDate, setAnalysisDate] = useState<Date | null>(new Date());
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [rosterWarnings, setRosterWarnings] = useState<string[]>([]);
  const [rosterSource, setRosterSource] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [ticketFileName, setTicketFileName] = useState<string | null>(null);
  const [tickets, setTickets] = useState<ScoredTicket[]>([]);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<RebalanceMode>("full");
  const [band, setBand] = useState(DEFAULT_OPTIONS.band);
  const [minMoveWeight, setMinMoveWeight] = useState(DEFAULT_OPTIONS.minMoveWeight);
  const [maxMoveWeight, setMaxMoveWeight] = useState(DEFAULT_OPTIONS.maxMoveWeight);
  const [maxAgeDays, setMaxAgeDays] = useState<number | "">("");
  const [shiftTransitionId, setShiftTransitionId] = useState(DEFAULT_OPTIONS.shiftTransitionId ?? "5-to-1");
  const [result, setResult] = useState<RebalanceResult | null>(null);

  const availableRosterCount = roster?.filter((entry) => entry.available).length ?? 0;
  const weekOffCount = roster?.filter((entry) => entry.status === "WO").length ?? 0;
  const leaveCount = roster?.filter((entry) => ["PTO", "Sick Leave", "Sick Leave - Tentative", "Emergency Leave", "Holiday"].includes(entry.status)).length ?? 0;
  const shiftOptions = SHIFT_TRANSITIONS.map((transition) => ({
    value: transition.id,
    label: transition.label,
  }));

  const summaryText = useMemo(() => (result ? formatForSlack(result) : ""), [result]);

  async function handleTicketUpload(file: File | null) {
    if (!file) return;
    setLoadingTickets(true);
    setTicketError(null);
    try {
      const parsed = await parseTicketFile(file);
      setTickets(scoreTickets(parsed));
      setTicketFileName(file.name);
      setResult(null);
    } catch (error) {
      setTicketError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingTickets(false);
    }
  }

  async function fetchSharedRosterForAnalysis() {
    if (!analysisDate) {
      throw new Error("Pick a roster date first.");
    }

    const dateValue = dayjs(analysisDate).format("YYYY-MM-DD");
    const previousDateValue = dayjs(analysisDate).subtract(1, "day").format("YYYY-MM-DD");

    const [currentResponse, previousResponse] = await Promise.all([
      fetch(`/api/roster-shift?date=${encodeURIComponent(dateValue)}`),
      fetch(`/api/roster-shift?date=${encodeURIComponent(previousDateValue)}`),
    ]);

    if (!currentResponse.ok) {
      throw new Error(`Roster API request failed with status ${currentResponse.status}.`);
    }
    if (!previousResponse.ok) {
      throw new Error(`Previous-day roster API request failed with status ${previousResponse.status}.`);
    }

    const currentData = (await currentResponse.json()) as SharedRosterApiResponse;
    const previousData = (await previousResponse.json()) as SharedRosterApiResponse;

    if (currentData.error) {
      throw new Error(currentData.error);
    }
    if (!currentData.dailyEntries?.length) {
      throw new Error("No roster entries were returned for the selected date.");
    }

    const nextRoster = mapSharedRosterEntries(currentData.dailyEntries);
    const nextPreviousRoster = mapSharedRosterEntries(previousData.dailyEntries ?? []);
    const nextSource = `Shared availability roster (${currentData.sheetTitle ?? "Roster"} • ${currentData.targetDate ?? dateValue})`;

    setRoster(nextRoster);
    setRosterSource(nextSource);
    setRosterWarnings([]);

    return { nextRoster, nextPreviousRoster };
  }

  async function runAnalysis() {
    if (!analysisDate) {
      setRosterError("Pick a roster date first.");
      return;
    }
    if (!tickets.length) {
      setTicketError("Upload an iPath ticket export first.");
      return;
    }

    setRunning(true);
    setRosterError(null);
    setTicketError(null);

    try {
      const dateLabel = dayjs(analysisDate).format("YYYY-MM-DD");
      const options = {
        mode,
        band,
        minMoveWeight,
        maxMoveWeight,
        maxAgeDays: maxAgeDays === "" ? undefined : Number(maxAgeDays),
        enforceTierMatch: true,
        skipStages: [],
        shiftTransitionId,
      };

      setLoadingRoster(true);
      const shared = await fetchSharedRosterForAnalysis();
      const activeRoster = shared.nextRoster;
      const activePreviousRoster = shared.nextPreviousRoster;
      setLoadingRoster(false);

      const nextResult =
        mode === "shift-handoff"
          ? rebalanceShiftHandoff(
              tickets,
              activeRoster,
              dateLabel,
              shiftTransitionId,
              options,
              activePreviousRoster,
              analysisDate,
            )
          : rebalance(tickets, activeRoster, dateLabel, options, analysisDate);

      setResult(nextResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRosterError(message);
    } finally {
      setLoadingRoster(false);
      setRunning(false);
    }
  }

  const headerActions = result ? (
    <Tooltip label="Copy Slack-friendly summary">
      <Button
        size="compact-sm"
        variant="light"
        leftSection={<IconCopy size={14} />}
        onClick={() => void copyText(summaryText)}
      >
        Copy summary
      </Button>
    </Tooltip>
  ) : undefined;

  return (
    <WidgetFrame
      title="Ticket Rebalancer"
      subtitle="Manager tool for load balancing using ticket exports plus roster availability"
      icon={IconArrowsShuffle}
      iconColor="grape"
      loading={loadingRoster || loadingTickets || running}
      headerActions={headerActions}
    >
      <Stack gap="lg">
        <SimpleGrid cols={{ base: 1, md: 1 }}>
          <Card withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Group justify="space-between">
                <Group gap="xs">
                  <IconTableImport size={18} />
                  <Text fw={700}>Ticket export + run settings</Text>
                </Group>
                <Group gap="xs">
                  <Badge color="blue" variant="light">Shared roster on run</Badge>
                  {ticketFileName ? <Badge color="teal" variant="light">{ticketFileName}</Badge> : null}
                </Group>
              </Group>

              <DateInput
                label="Analysis date"
                value={analysisDate}
                onChange={(value) => setAnalysisDate(typeof value === "string" ? new Date(value) : value)}
                valueFormat="ddd, MMM D, YYYY"
                leftSection={<IconCalendar size={16} />}
              />

              <Alert color="blue" icon={<IconInfoCircle size={16} />}>
                <Text size="sm">
                  When you click <strong>Run analysis</strong>, this widget automatically fetches the shared Team Availability roster for the selected date.
                </Text>
              </Alert>

              {rosterSource ? (
                <Alert color="teal" icon={<IconInfoCircle size={16} />}>
                  <Stack gap={4}>
                    <Text size="sm">Using roster from {rosterSource}.</Text>
                    <Group gap="xs">
                      <Badge color="teal" variant="light">Available: {availableRosterCount}</Badge>
                      <Badge color="yellow" variant="light">Leave: {leaveCount}</Badge>
                      <Badge color="gray" variant="light">Week off: {weekOffCount}</Badge>
                    </Group>
                  </Stack>
                </Alert>
              ) : null}
              {rosterError ? (
                <Alert color="red" icon={<IconAlertTriangle size={16} />}>
                  <Text size="sm">{rosterError}</Text>
                </Alert>
              ) : null}
              {rosterWarnings.length > 0 ? (
                <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
                  <Stack gap={4}>
                    {rosterWarnings.slice(0, 5).map((warning) => (
                      <Text key={warning} size="sm">• {warning}</Text>
                    ))}
                    {rosterWarnings.length > 5 ? <Text size="sm">…and {rosterWarnings.length - 5} more</Text> : null}
                  </Stack>
                </Alert>
              ) : null}

              <Dropzone
                onDrop={(files) => void handleTicketUpload(files[0] ?? null)}
                loading={loadingTickets}
                maxFiles={1}
                accept={{
                  "text/csv": [".csv", ".tsv", ".txt"],
                  "application/vnd.ms-excel": [".xls"],
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx", ".xlsm"],
                }}
              >
                <Group justify="center" mih={90} style={{ pointerEvents: "none" }}>
                  <IconClipboardText size={28} />
                  <Text size="sm">Drop an iPath ticket export here</Text>
                </Group>
              </Dropzone>

              <FileButton onChange={(file) => void handleTicketUpload(file)} accept=".csv,.tsv,.txt,.xls,.xlsx,.xlsm">
                {(props) => (
                  <Button {...props} variant="light" leftSection={<IconFileSpreadsheet size={14} />}>
                    Choose ticket export
                  </Button>
                )}
              </FileButton>

              <Select
                label="Mode"
                value={mode}
                onChange={(value) => setMode((value as RebalanceMode) ?? "full")}
                data={[
                  { value: "full", label: "Full rebalance" },
                  { value: "shift-handoff", label: "Shift handoff" },
                ]}
              />

              {mode === "shift-handoff" ? (
                <Select
                  label="Shift transition"
                  value={shiftTransitionId}
                  onChange={(value) => setShiftTransitionId(value ?? DEFAULT_OPTIONS.shiftTransitionId ?? "5-to-1")}
                  data={shiftOptions}
                />
              ) : null}

              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <NumberInput label="Tolerance band" value={band} onChange={(value) => setBand(Number(value) || DEFAULT_OPTIONS.band)} min={0} step={0.25} decimalScale={2} />
                <NumberInput label="Min move weight" value={minMoveWeight} onChange={(value) => setMinMoveWeight(Number(value) || DEFAULT_OPTIONS.minMoveWeight)} min={0} step={0.25} decimalScale={2} />
                <NumberInput label="Max move weight" value={maxMoveWeight} onChange={(value) => setMaxMoveWeight(Number(value) || DEFAULT_OPTIONS.maxMoveWeight)} min={0.25} step={0.25} decimalScale={2} />
              </SimpleGrid>

              <NumberInput
                label="Max ticket age to move (optional)"
                value={maxAgeDays}
                onChange={(value) => setMaxAgeDays(value === "" || value === null ? "" : Number(value))}
                min={0}
                placeholder="Leave blank for no age cap"
              />

              {ticketError ? (
                <Alert color="red" icon={<IconAlertTriangle size={16} />}>
                  <Text size="sm">{ticketError}</Text>
                </Alert>
              ) : null}

              <Button onClick={() => void runAnalysis()} loading={running || loadingRoster} leftSection={<IconArrowsShuffle size={16} />}>
                Run analysis
              </Button>
            </Stack>
          </Card>
        </SimpleGrid>

        <SimpleGrid cols={{ base: 2, md: 4 }}>
          <StatCard label="Roster available" value={String(availableRosterCount)} hint={rosterSource ?? "No roster loaded yet"} />
          <StatCard label="Tickets loaded" value={String(tickets.length)} hint={ticketFileName ?? "No ticket export loaded"} />
          <StatCard label="Mode" value={mode === "shift-handoff" ? "Shift handoff" : "Full rebalance"} hint={mode === "shift-handoff" ? shiftOptions.find((option) => option.value === shiftTransitionId)?.label : "All available agents considered"} />
          <StatCard label="Result" value={result ? `${result.movesSuggested.length} move(s)` : "—"} hint={result ? `${result.totalWeight.toFixed(2)} weighted load reviewed` : "Run analysis to generate moves"} />
        </SimpleGrid>

        {roster?.length ? (
          <Card withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={700}>Roster preview</Text>
                <Badge variant="light" color="blue">{roster.length} agent(s)</Badge>
              </Group>
              <Text size="sm" c="dimmed">
                Review exact roster status before running the rebalance. Only agents marked as available and not managers are included in the balancing pool.
              </Text>
              <Table.ScrollContainer minWidth={820}>
                <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Agent</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Shift / Cell</Table.Th>
                      <Table.Th>Tier</Table.Th>
                      <Table.Th>Manager</Table.Th>
                      <Table.Th>Included in pool</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {roster.map((entry) => (
                      <Table.Tr key={`${entry.name}-${entry.cellRaw}-${entry.status}`}>
                        <Table.Td>{entry.name}</Table.Td>
                        <Table.Td>
                          <Badge
                            variant="light"
                            color={
                              entry.status === "Available"
                                ? "teal"
                                : entry.status === "WO"
                                  ? "gray"
                                  : entry.status === "Blank"
                                    ? "dark"
                                    : "yellow"
                            }
                          >
                            {entry.status}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{entry.cellRaw || entry.shift || "—"}</Table.Td>
                        <Table.Td>{entry.tier ?? "—"}</Table.Td>
                        <Table.Td>{entry.isManager ? "Yes" : "No"}</Table.Td>
                        <Table.Td>
                          <Badge variant="light" color={entry.available ? "teal" : "gray"}>
                            {entry.available ? "Yes" : "No"}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Stack>
          </Card>
        ) : null}

        {result ? (
          <Stack gap="lg">
            <SimpleGrid cols={{ base: 2, md: 5 }}>
              <StatCard label="Eligible tickets" value={String(result.totalTickets)} />
              <StatCard label="Total weight" value={result.totalWeight.toFixed(2)} />
              <StatCard label="Pool agents" value={String(result.availableAgents)} />
              <StatCard label="Mean load" value={result.meanLoad.toFixed(2)} />
              <StatCard label="Band" value={`±${result.band.toFixed(2)}`} />
            </SimpleGrid>

            {result.warnings.length > 0 ? (
              <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
                <Stack gap={4}>
                  {result.warnings.map((warning, index) => (
                    <Text key={`${index}-${warning}`} size="sm">• {warning}</Text>
                  ))}
                </Stack>
              </Alert>
            ) : null}

            <Card withBorder radius="lg" p="lg">
              <Stack gap="md">
                <Group justify="space-between">
                  <Text fw={700}>Per-agent load</Text>
                  <Badge variant="light" color="grape">Before moves</Badge>
                </Group>
                <Table.ScrollContainer minWidth={900}>
                  <Table striped highlightOnHover withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Agent</Table.Th>
                        <Table.Th>Tier</Table.Th>
                        <Table.Th>Avail</Table.Th>
                        <Table.Th>Tix</Table.Th>
                        <Table.Th>Hot</Table.Th>
                        <Table.Th>Pend Cust</Table.Th>
                        <Table.Th>Due Today</Table.Th>
                        <Table.Th>Age &gt; 10</Table.Th>
                        <Table.Th>Age &gt; 30</Table.Th>
                        <Table.Th>Weight</Table.Th>
                        <Table.Th>Δ</Table.Th>
                        <Table.Th>Band</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {result.agentLoads.map((load) => (
                        <Table.Tr key={load.name}>
                          <Table.Td>{load.name}</Table.Td>
                          <Table.Td>{load.tier ?? "—"}</Table.Td>
                          <Table.Td>{load.available ? "Yes" : "No"}</Table.Td>
                          <Table.Td>{load.ticketCount}</Table.Td>
                          <Table.Td>{load.hotTickets}</Table.Td>
                          <Table.Td>{load.pendingCustomer}</Table.Td>
                          <Table.Td>{load.dueToday}</Table.Td>
                          <Table.Td>{load.ageOver10}</Table.Td>
                          <Table.Td>{load.ageOver30}</Table.Td>
                          <Table.Td>{load.weight.toFixed(2)}</Table.Td>
                          <Table.Td>{load.available ? load.delta.toFixed(2) : "—"}</Table.Td>
                          <Table.Td>{load.band}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Stack>
            </Card>

            <Card withBorder radius="lg" p="lg">
              <Stack gap="md">
                <Group justify="space-between">
                  <Text fw={700}>Suggested moves</Text>
                  <Badge variant="light" color={result.movesSuggested.length ? "teal" : "gray"}>
                    {result.movesSuggested.length ? `${result.movesSuggested.length} suggestion(s)` : "No moves needed"}
                  </Badge>
                </Group>

                {result.movesSuggested.length ? (
                  <Table.ScrollContainer minWidth={860}>
                    <Table striped highlightOnHover withTableBorder>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Ticket</Table.Th>
                          <Table.Th>From</Table.Th>
                          <Table.Th>To</Table.Th>
                          <Table.Th>Service</Table.Th>
                          <Table.Th>Priority</Table.Th>
                          <Table.Th>Stage</Table.Th>
                          <Table.Th>Weight</Table.Th>
                          <Table.Th>Reason</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {result.movesSuggested.map((move) => (
                          <Table.Tr key={`${move.ticket.ticket}-${move.from}-${move.to}`}>
                            <Table.Td>{move.ticket.ticket}</Table.Td>
                            <Table.Td>{move.from}</Table.Td>
                            <Table.Td>{move.to}</Table.Td>
                            <Table.Td>{move.ticket.service}</Table.Td>
                            <Table.Td>{move.ticket.priorityBand}</Table.Td>
                            <Table.Td>{move.ticket.stageNorm === "Unknown" ? move.ticket.stage : move.ticket.stageNorm}</Table.Td>
                            <Table.Td>{move.ticket.weight.toFixed(2)}</Table.Td>
                            <Table.Td>{move.reason}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                ) : (
                  <Alert color="teal" icon={<IconInfoCircle size={16} />}>
                    <Text size="sm">All available agents are already within the configured tolerance band.</Text>
                  </Alert>
                )}
              </Stack>
            </Card>

            <Card withBorder radius="lg" p="lg">
              <Stack gap="md">
                <Group justify="space-between">
                  <Text fw={700}>Slack-ready summary</Text>
                  <Button variant="light" leftSection={<IconCopy size={14} />} onClick={() => void copyText(summaryText)}>
                    Copy
                  </Button>
                </Group>
                <Card radius="md" p="md" withBorder bg="dark.8">
                  <Text ff="monospace" size="sm" style={{ whiteSpace: "pre-wrap" }}>
                    {summaryText}
                  </Text>
                </Card>
              </Stack>
            </Card>

            {result.unassignedOrUnknownOwner.length > 0 ? (
              <Card withBorder radius="lg" p="lg">
                <Stack gap="md">
                  <Text fw={700}>Excluded tickets</Text>
                  <Text size="sm" c="dimmed">
                    These tickets were excluded because their owner was missing, unknown, or belongs to a manager/off-roster entry.
                  </Text>
                  <Table.ScrollContainer minWidth={720}>
                    <Table striped highlightOnHover withTableBorder>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Ticket</Table.Th>
                          <Table.Th>Owner</Table.Th>
                          <Table.Th>Service</Table.Th>
                          <Table.Th>Priority</Table.Th>
                          <Table.Th>Stage</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {result.unassignedOrUnknownOwner.slice(0, 100).map((ticket) => (
                          <Table.Tr key={`${ticket.ticket}-${ticket.owner}-${ticket.stage}`}>
                            <Table.Td>{ticket.ticket}</Table.Td>
                            <Table.Td>{ticket.owner || "—"}</Table.Td>
                            <Table.Td>{ticket.service || "—"}</Table.Td>
                            <Table.Td>{ticket.priority || "—"}</Table.Td>
                            <Table.Td>{ticket.stage || "—"}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Stack>
              </Card>
            ) : null}
          </Stack>
        ) : (
          <Card withBorder radius="lg" p="xl">
            <Stack gap="sm" align="center">
              <ThemeIcon size={56} radius="xl" color="grape" variant="light">
                <IconUsers size={28} />
              </ThemeIcon>
              <Title order={4}>Ready to analyze</Title>
              <Text size="sm" c="dimmed" ta="center" maw={620}>
                Upload the iPath ticket export, choose the analysis date, and run the rebalance. The widget will fetch the shared Team Availability roster automatically unless you uploaded a manual roster override.
              </Text>
            </Stack>
          </Card>
        )}

        <Divider />
        <Text size="xs" c="dimmed">
          Notes: Run analysis fetches the same shared Team Availability roster already configured in this app for the selected date. Use the manual roster upload only when you need to override that shared source.
        </Text>
      </Stack>
    </WidgetFrame>
  );
}
