import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  ScrollArea,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClipboard,
  IconClipboardList,
  IconDeviceFloppy,
  IconRefresh,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { WorkAllotmentGeneratorTile } from "./Tile";
import { useIdentity } from "../../lib/identity";
import { ROLE_BY_NAME, ROSTER_BY_EMAIL } from "../../lib/roles";
import {
  DEFAULT_MEMBER_NAMES,
  getCurrentMonthKey,
  getDateKeyForMonthDay,
  getDaysInMonth,
  getHoursForEntry,
  getMonthLabel,
  getMonthlyTotals,
  loadTrackerStore,
  saveTrackerStore,
  type FairnessEntry,
  type ScheduledPostRow,
} from "./tracker";

export { WorkAllotmentGeneratorTile };

interface ShiftPlanResult {
  status: "ok" | "no_post";
  slot: string;
  message: string;
  primary?: string | null;
  backup?: string | null;
  nextPrimary?: string | null;
  nextPostTime?: string | null;
  primaryShiftCode?: string | null;
  dateKey?: string;
  continuingFrom?: string | null;
  fairnessBefore?: number;
  fairnessAfter?: number;
  fairnessDelta?: number;
  availableMembers?: Array<{ name: string; shiftCode?: string | null }>;
}

interface FairnessUpdate {
  name: string;
  before: number;
  after: number;
  delta: number;
  row: number | null;
  column: number | null;
  sheetName: string;
  dateKey: string;
}

interface DayPlanResult {
  status: "ok";
  dateKey: string;
  rosterSheet: string;
  fairnessSheet: string;
  fairnessWarning?: string | null;
  shifts: ShiftPlanResult[];
  fairnessUpdates: FairnessUpdate[];
  appliedFairnessUpdates?: FairnessUpdate[];
  tracker?: {
    fairnessEntries: FairnessEntry[];
    scheduledPosts: ScheduledPostRow[];
    memberNames: string[];
    monthKey: string;
  };
}

interface GeneratorResponse {
  ok: boolean;
  config: {
    rosterSpreadsheetId: string;
    slackChannelId: string;
    slackChannelName: string;
    timeZone: string;
    fairnessTrackerMode: string;
    fairnessTrackerName: string;
    memberNames: string[];
  };
  result: DayPlanResult;
}

interface PostResponse {
  ok: boolean;
  config: GeneratorResponse["config"];
  result: DayPlanResult;
}

function isManagerIdentity(identity: ReturnType<typeof useIdentity>["identity"]) {
  if (!identity) return false;
  if (identity.role === "manager") return true;
  const canonicalByName = identity.name ? ROLE_BY_NAME[identity.name.trim()] : undefined;
  if (canonicalByName === "manager") return true;
  const canonicalByEmail = identity.email
    ? ROSTER_BY_EMAIL[identity.email.trim().toLowerCase()]?.role
    : undefined;
  return canonicalByEmail === "manager";
}

function formatAvailableMembers(members: Array<{ name: string; shiftCode?: string | null }> = []) {
  return members
    .map((member) => member.shiftCode ? `${member.name} (${member.shiftCode})` : member.name)
    .join(", ");
}

export function WorkAllotmentGeneratorWidget() {
  const { identity } = useIdentity();
  const isManager = isManagerIdentity(identity);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [copying, setCopying] = useState(false);
  const [savingTracker, setSavingTracker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<GeneratorResponse | null>(null);
  const [monthKey, setMonthKey] = useState(getCurrentMonthKey());
  const [fairnessEntries, setFairnessEntries] = useState<FairnessEntry[]>([]);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPostRow[]>([]);

  const memberNames = useMemo(() => {
    const fromApi = data?.config.memberNames ?? [];
    return Array.from(new Set([...DEFAULT_MEMBER_NAMES, ...fromApi])).sort((a, b) => a.localeCompare(b));
  }, [data?.config.memberNames]);

  useEffect(() => {
    const stored = loadTrackerStore();
    setFairnessEntries(stored.fairnessEntries);
    setScheduledPosts(stored.scheduledPosts);
  }, []);

  function persistTracker(nextEntries: FairnessEntry[], nextPosts: ScheduledPostRow[], nextNotice?: string) {
    saveTrackerStore({ fairnessEntries: nextEntries, scheduledPosts: nextPosts });
    setFairnessEntries(nextEntries);
    setScheduledPosts(nextPosts);
    if (nextNotice) setNotice(nextNotice);
  }

  async function load() {
    if (!identity || !isManager) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/work-allotment/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fairnessEntries, scheduledPosts, memberNames }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Failed to generate work allotment.");
      setData(json as GeneratorResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate work allotment.");
    } finally {
      setLoading(false);
    }
  }

  async function applyDayPlan() {
    if (!identity || !isManager) return;
    setApplying(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/work-allotment/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fairnessEntries, scheduledPosts, memberNames }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Failed to update fairness tracker.");
      const posted = json as PostResponse;
      setData(posted as unknown as GeneratorResponse);
      const nextEntries = posted.result.tracker?.fairnessEntries ?? fairnessEntries;
      const nextPosts = posted.result.tracker?.scheduledPosts ?? scheduledPosts;
      persistTracker(nextEntries, nextPosts, `Updated in-widget fairness tracker for ${posted.result.appliedFairnessUpdates?.length ?? 0} member(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update fairness tracker.");
    } finally {
      setApplying(false);
    }
  }

  async function copyMessage() {
    const text = (data?.result?.shifts ?? [])
      .filter((shift) => shift.status === "ok")
      .map((shift) => shift.message)
      .join("\n\n--------------------------------\n\n");
    if (!text) return;
    setCopying(true);
    setNotice(null);
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Daily work allotment plan copied to clipboard.");
    } catch {
      setError("Failed to copy the plan to clipboard.");
    } finally {
      setCopying(false);
    }
  }

  function updateEntry(name: string, day: number, value: string | number) {
    const dateKey = getDateKeyForMonthDay(monthKey, day);
    const numeric = Math.max(0, Number(value) || 0);
    const remaining = fairnessEntries.filter((entry) => !(entry.name === name && entry.dateKey === dateKey));
    const nextEntries = numeric > 0
      ? [...remaining, { name, dateKey, hours: numeric }].sort((a, b) => `${a.dateKey}-${a.name}`.localeCompare(`${b.dateKey}-${b.name}`))
      : remaining;
    setFairnessEntries(nextEntries);
  }

  function saveTracker() {
    setSavingTracker(true);
    try {
      persistTracker(fairnessEntries, scheduledPosts, `Saved fairness tracker for ${getMonthLabel(monthKey)}.`);
    } finally {
      setSavingTracker(false);
    }
  }

  function moveMonth(offset: number) {
    const [year, month] = monthKey.split("-").map(Number);
    const next = new Date(year, (month - 1) + offset, 1);
    setMonthKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  }

  useEffect(() => {
    void load();
  }, [identity, isManager]);

  const monthDays = getDaysInMonth(monthKey);
  const monthLabel = getMonthLabel(monthKey);
  const monthlyTotals = useMemo(() => getMonthlyTotals(fairnessEntries, memberNames, monthKey), [fairnessEntries, memberNames, monthKey]);
  const highestTotal = Math.max(0, ...Array.from(monthlyTotals.values()));
  const fairnessScores = useMemo(() => {
    return new Map(memberNames.map((name) => {
      const total = monthlyTotals.get(name) ?? 0;
      const score = highestTotal > 0 ? (total / highestTotal) * 100 : 0;
      return [name, score];
    }));
  }, [memberNames, monthlyTotals, highestTotal]);
  const trackerRows = useMemo(() => {
    return memberNames.map((name) => ({
      name,
      total: monthlyTotals.get(name) ?? 0,
      score: fairnessScores.get(name) ?? 0,
    }));
  }, [memberNames, monthlyTotals, fairnessScores]);

  if (!identity) {
    return (
      <WidgetFrame title="Work Allotment Generator" subtitle="Sign in required" icon={IconClipboardList} iconColor="indigo">
        <Alert color="gray">Sign in with a manager account to generate or post the work allotment.</Alert>
      </WidgetFrame>
    );
  }

  if (!isManager) {
    return (
      <WidgetFrame title="Work Allotment Generator" subtitle="Manager access required" icon={IconClipboardList} iconColor="indigo">
        <Alert color="red">Only managers can preview or post the NOC work allotment.</Alert>
      </WidgetFrame>
    );
  }

  const result = data?.result ?? null;
  const readyShiftCount = result?.shifts?.filter((shift) => shift.status === "ok").length ?? 0;
  const fairnessUpdateCount = result?.fairnessUpdates?.length ?? 0;

  return (
    <WidgetFrame
      title="Work Allotment Generator"
      subtitle={result ? `${readyShiftCount} shifts prepared for ${result.dateKey}` : "Read roster, plan all shifts, and manage fairness hours inside the widget"}
      icon={IconClipboardList}
      iconColor="indigo"
      loading={loading}
      onRefresh={() => void load()}
      status={{ label: result ? `${readyShiftCount} shifts planned` : "Loading", color: result ? "green" : "gray" }}
      headerActions={<Badge variant="light" color="indigo">PDT / America/Los_Angeles</Badge>}
    >
      <Stack gap="lg">
        {(error || notice) && <Alert color={error ? "red" : "green"}>{error || notice}</Alert>}
        {result?.fairnessWarning ? <Alert color="yellow">{result.fairnessWarning}</Alert> : null}

        <Card withBorder radius="md" p="md">
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Text fw={700}>Day planner controls</Text>
              <Badge color="indigo" variant="light">{result?.dateKey ?? "Today"}</Badge>
            </Group>
            <Text size="sm" c="dimmed">
              This reads today’s roster, uses the in-widget fairness tracker totals for the current month, builds each slot from everyone overlapping that time window, and tries to keep the same AS&amp;RH primary across adjacent shifts unless fairness drift gets too large.
            </Text>
            <Group>
              <Button leftSection={<IconRefresh size={16} />} variant="light" color="indigo" onClick={() => void load()} loading={loading}>
                Prepare day plan
              </Button>
              <Button leftSection={<IconClipboard size={16} />} variant="light" color="gray" onClick={() => void copyMessage()} disabled={readyShiftCount === 0} loading={copying}>
                Copy all shifts
              </Button>
              <Button leftSection={<IconCheck size={16} />} color="indigo" onClick={() => void applyDayPlan()} loading={applying} disabled={fairnessUpdateCount === 0}>
                Apply to fairness tracker
              </Button>
            </Group>
          </Stack>
        </Card>

        <Card withBorder radius="md" p="md">
          <Stack gap="sm">
            <Group justify="space-between" align="center">
              <Text fw={700}>Sources and summary</Text>
              <Badge color="green" variant="light">{readyShiftCount} ready</Badge>
            </Group>
            <Text size="sm" c="dimmed">Roster sheet: {result?.rosterSheet ?? "—"} · Fairness source: {result?.fairnessSheet ?? "In-widget tracker"}</Text>
            <Text size="sm" c="dimmed">Pending fairness updates: {fairnessUpdateCount}</Text>
          </Stack>
        </Card>

        <Card withBorder radius="md" p="md">
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Stack gap={2}>
                <Text fw={700}>Fairness hours tracker</Text>
                <Text size="sm" c="dimmed">Spreadsheet-style monthly tracker built into the widget. Edit daily hours directly here and use Apply to add today’s assignments into the current month.</Text>
              </Stack>
              <Group gap="xs">
                <Button variant="light" color="gray" size="xs" onClick={() => moveMonth(-1)} leftSection={<IconChevronLeft size={14} />}>
                  Prev month
                </Button>
                <Badge color="grape" variant="light">{monthLabel}</Badge>
                <Button variant="light" color="gray" size="xs" onClick={() => moveMonth(1)} rightSection={<IconChevronRight size={14} />}>
                  Next month
                </Button>
                <Button variant="light" color="indigo" size="xs" leftSection={<IconDeviceFloppy size={14} />} onClick={saveTracker} loading={savingTracker}>
                  Save tracker
                </Button>
              </Group>
            </Group>

            <Stack gap={4}>
              <Text fw={700} size="sm">FAIRNESS HOURS TRACKER - {monthLabel.toUpperCase()}</Text>
              <Text size="xs" c="dimmed">Member rows mirror the sheet-style layout, while totals and fairness scores are calculated automatically below.</Text>
            </Stack>

            <ScrollArea>
              <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: 1100 }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th miw={220}>Member Name</Table.Th>
                    {Array.from({ length: monthDays }, (_, index) => index + 1).map((day) => (
                      <Table.Th key={day} ta="center" miw={72}>{day}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {memberNames.map((name) => (
                    <Table.Tr key={name}>
                      <Table.Td>
                        <Text size="sm" fw={600}>{name}</Text>
                      </Table.Td>
                      {Array.from({ length: monthDays }, (_, index) => index + 1).map((day) => {
                        const dateKey = getDateKeyForMonthDay(monthKey, day);
                        const value = getHoursForEntry(fairnessEntries, name, dateKey);
                        return (
                          <Table.Td key={`${name}-${day}`} p={4}>
                            <NumberInput
                              value={value || ""}
                              onChange={(next) => updateEntry(name, day, next)}
                              min={0}
                              step={1}
                              hideControls
                              decimalScale={0}
                              allowNegative={false}
                              placeholder="0"
                              size="xs"
                              styles={{ input: { textAlign: "center", minWidth: 56 } }}
                            />
                          </Table.Td>
                        );
                      })}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>

            <Divider />

            <Stack gap="md">
              <Text fw={700} size="sm">FAIRNESS SCORE CALCULATION</Text>
              <Table withTableBorder withColumnBorders striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Member Name</Table.Th>
                    <Table.Th ta="right">Total Hours (Z)</Table.Th>
                    <Table.Th ta="right">Fairness Score (%)</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {trackerRows.map((row) => (
                    <Table.Tr key={`score-${row.name}`}>
                      <Table.Td>{row.name}</Table.Td>
                      <Table.Td ta="right">{row.total}</Table.Td>
                      <Table.Td ta="right">{row.score.toFixed(2)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          </Stack>
        </Card>

        <Card withBorder radius="md" p="md">
          <Stack gap="md">
            <Text fw={700}>Shift allotments for the day</Text>
            {(result?.shifts ?? []).map((shift) => (
              <Card key={shift.slot} withBorder radius="md" p="md">
                <Stack gap="sm">
                  <Group justify="space-between" align="center">
                    <Group gap={8}>
                      <Badge color={shift.status === "ok" ? "green" : "gray"} variant="light">{shift.slot}</Badge>
                      {shift.primary ? <Badge color="indigo" variant="light">Primary: {shift.primary}</Badge> : null}
                      {shift.backup ? <Badge color="blue" variant="light">Backup: {shift.backup}</Badge> : null}
                      {shift.continuingFrom ? <Badge color="violet" variant="light">Continuing from {shift.continuingFrom}</Badge> : null}
                    </Group>
                    {typeof shift.fairnessAfter === "number" ? (
                      <Badge color="grape" variant="light">{shift.fairnessBefore} → {shift.fairnessAfter}h</Badge>
                    ) : null}
                  </Group>
                  <Text size="xs" c="dimmed">
                    Available during {shift.slot}: {formatAvailableMembers(shift.availableMembers)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Tracker hours added for this slot: {shift.fairnessDelta ?? 0}h · AS&amp;RH primary changes only when overlap ends or fairness variance becomes too large.
                  </Text>
                  <Text component="pre" size="sm" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                    {shift.message}
                  </Text>
                </Stack>
              </Card>
            ))}
          </Stack>
        </Card>

        <Card withBorder radius="md" p="md">
          <Stack gap="sm">
            <Text fw={700}>Fairness tracker updates</Text>
            {(result?.fairnessUpdates?.length ?? 0) === 0 ? (
              <Text size="sm" c="dimmed">No fairness changes are pending.</Text>
            ) : (
              result?.fairnessUpdates.map((update) => (
                <Group key={`${update.name}-${update.dateKey}`} justify="space-between" align="center">
                  <Text size="sm">{update.name} · {update.dateKey}</Text>
                  <Badge color="grape" variant="light">{update.before} → {update.after} ({update.delta > 0 ? `+${update.delta}` : update.delta})</Badge>
                </Group>
              ))
            )}
          </Stack>
        </Card>
      </Stack>
    </WidgetFrame>
  );
}
