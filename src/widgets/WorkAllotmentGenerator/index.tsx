import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  ScrollArea,
  Stack,
  Table,
  Tabs,
  Text,
} from "@mantine/core";
import {
  IconClipboardList,
  IconScale,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { WorkAllotmentGeneratorTile } from "./Tile";
import { useIdentity } from "../../lib/identity";
import { ROLE_BY_NAME, ROSTER_BY_EMAIL } from "../../lib/roles";
import {
  DEFAULT_MEMBER_NAMES,
  isExcludedFairnessMember,
  loadTrackerStore,
  saveTrackerStore,
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
  carryPathUsed?: string | null;
  carryPathRule?: string | null;
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

interface FairnessGroupMember {
  name: string;
  workedDays: number;
  rosterFairnessCount: number;
  rosterFairnessHours: number;
  trackerHours: number;
  fairnessUnits: number;
  fairnessScore: number;
  shiftBreakdown: Array<{ code: string; count: number }>;
}

interface FairnessGroupSummary {
  key: string;
  label: string;
  shiftLabels: string[];
  shiftCodes: string[];
  highestCount: number;
  members: FairnessGroupMember[];
}

interface CombinedFairnessMember extends FairnessGroupMember {
  groupKey: string;
  groupLabel: string;
  groupShiftLabels: string[];
}

interface FairnessSummary {
  monthKey: string;
  sheetTitle: string;
  groups: FairnessGroupSummary[];
  combinedMembers: CombinedFairnessMember[];
}

interface DayPlanResult {
  status: "ok";
  dateKey: string;
  rosterSheet: string;
  fairnessSheet: string;
  fairnessWarning?: string | null;
  fairnessSummary?: FairnessSummary;
  shifts: ShiftPlanResult[];
  fairnessUpdates: FairnessUpdate[];
  appliedFairnessUpdates?: FairnessUpdate[];
  tracker?: {
    scheduledPosts: ScheduledPostRow[];
    memberNames: string[];
    monthKey: string;
    rosterMonthSheet?: string;
    fairnessSheetTitle?: string;
    fairnessSpreadsheetUrl?: string;
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

interface WorkAllotmentJobStatus {
  id: number;
  operational_date: string;
  post_date: string;
  shift: string;
  primary?: string | null;
  backup?: string | null;
  status: string;
  slack_ts?: string | null;
  last_error?: string | null;
  post_time_label?: string | null;
  posted_at?: string | null;
  generated_at?: string | null;
}

interface WorkAllotmentAutomationRun {
  id?: number;
  action: string;
  ran_at: string;
  generation_triggered?: boolean | null;
  generation_skipped?: boolean | null;
  due_count?: number | null;
  posted_count?: number | null;
  failure_count?: number | null;
  note?: string | null;
}

interface WorkAllotmentStatusResult {
  ok: true;
  operationalDate: string;
  generationWindow: boolean;
  jobCount: number;
  postedCount: number;
  plannedCount: number;
  jobs: WorkAllotmentJobStatus[];
  recent: WorkAllotmentJobStatus[];
  latestRun?: WorkAllotmentAutomationRun | null;
}

function formatTimestamp(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  }).format(parsed);
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
    .map((member) => (member.shiftCode ? `${member.name} (${member.shiftCode})` : member.name))
    .join(", ");
}

function formatMonthLabel(monthKey?: string | null) {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return "Current month";
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function formatVisibleShiftLabel(slot?: string | null) {
  return slot === "S6" ? "S5.1" : (slot ?? "—");
}

const FAIRNESS_GROUP_DISPLAY_ORDER: Record<string, number> = {
  "overnight-early": 0,
  "day-swing": 1,
  "late-evening": 2,
};

export function WorkAllotmentGeneratorWidget() {
  const { identity } = useIdentity();
  const isManager = isManagerIdentity(identity);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<GeneratorResponse | null>(null);
  const [automationStatus, setAutomationStatus] = useState<WorkAllotmentStatusResult | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPostRow[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>("allotments");

  const memberNames = useMemo(() => {
    const fromApi = data?.config.memberNames ?? [];
    return Array.from(new Set([...DEFAULT_MEMBER_NAMES, ...fromApi]))
      .filter((name) => !isExcludedFairnessMember(name))
      .sort((a, b) => a.localeCompare(b));
  }, [data?.config.memberNames]);

  useEffect(() => {
    const stored = loadTrackerStore();
    setScheduledPosts(stored.scheduledPosts);
  }, []);

  function persistScheduledPosts(nextPosts: ScheduledPostRow[]) {
    saveTrackerStore({ fairnessEntries: [], scheduledPosts: nextPosts });
    setScheduledPosts(nextPosts);
  }

  async function loadStatus() {
    if (!identity || !isManager) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const response = await fetch(`/api/work-allotment/status`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Failed to load automation status.");
      setAutomationStatus((json as { ok: boolean; result: WorkAllotmentStatusResult }).result);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to load automation status.");
    } finally {
      setStatusLoading(false);
    }
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
        body: JSON.stringify({ scheduledPosts, memberNames }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Failed to generate work allotment.");
      setData(json as GeneratorResponse);
      if ((json as GeneratorResponse).result?.tracker?.scheduledPosts) {
        persistScheduledPosts((json as GeneratorResponse).result.tracker?.scheduledPosts ?? []);
      }
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate work allotment.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!identity || !isManager) return;
    void load();
  }, [identity, isManager]);

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
        <Alert color="red">Only managers can preview the NOC work allotment and fairness tracker.</Alert>
      </WidgetFrame>
    );
  }

  const result = data?.result ?? null;
  const readyShiftCount = result?.shifts?.filter((shift) => shift.status === "ok").length ?? 0;
  const fairnessSummary = result?.fairnessSummary ?? null;
  const fairnessGroups = fairnessSummary?.groups ?? [];
  const fairnessSourceTitle = result?.tracker?.fairnessSheetTitle ?? fairnessSummary?.sheetTitle ?? result?.fairnessSheet ?? "—";
  const fairnessSourceUrl = result?.tracker?.fairnessSpreadsheetUrl ?? null;
  const latestAutomationActivity = automationStatus?.latestRun?.ran_at
    ?? ([...(automationStatus?.recent ?? [])]
      .map((job) => job.posted_at || job.generated_at || null)
      .find((value) => Boolean(value)) ?? null);
  const combinedFairnessMembers = [...(fairnessSummary?.combinedMembers ?? [])].sort((a, b) => {
    const orderDiff = (FAIRNESS_GROUP_DISPLAY_ORDER[a.groupKey] ?? 999) - (FAIRNESS_GROUP_DISPLAY_ORDER[b.groupKey] ?? 999);
    if (orderDiff !== 0) return orderDiff;
    return a.name.localeCompare(b.name);
  });

  return (
    <WidgetFrame
      title="Work Allotment Generator"
      subtitle={result ? `${readyShiftCount} shifts prepared for ${result.dateKey}` : "Read roster, plan all shifts, and review monthly fairness by shift group"}
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

        <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="allotments" leftSection={<IconClipboardList size={16} />}>
              Shift allotments
            </Tabs.Tab>
            <Tabs.Tab value="fairness" leftSection={<IconScale size={16} />}>
              Fairness tracker
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="allotments" pt="md">
            <Stack gap="md">
              <Card withBorder radius="md" p="md">
                <Stack gap="md">
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={4}>
                      <Text fw={700}>Automation status</Text>
                      <Text size="sm" c="dimmed">
                        Server-side schedule for today&apos;s generated work allotments and Slack posting state.
                      </Text>
                      <Text size="xs" c="dimmed">
                        Cron schedule: generates the full day at 3:10 AM PT, then checks for due shifts every 5 minutes and posts anything whose scheduled time has passed.
                      </Text>
                      <Text size="xs" c="dimmed">
                        Last cron activity: {formatTimestamp(latestAutomationActivity)}
                      </Text>
                      <Text size="xs" c="dimmed">
                        Note: automatic 5-minute cron runs happen only on the deployed Vercel app. The App Builder/dev preview does not execute Vercel cron jobs.
                      </Text>
                    </Stack>
                    <Group gap="xs">
                      <Badge color="indigo" variant="light">Date: {automationStatus?.operationalDate ?? result?.dateKey ?? "—"}</Badge>
                      <Badge color="green" variant="light">Posted: {automationStatus?.postedCount ?? 0}</Badge>
                      <Badge color="yellow" variant="light">Planned: {automationStatus?.plannedCount ?? 0}</Badge>
                    </Group>
                  </Group>

                  {statusLoading ? (
                    <Text size="sm" c="dimmed">Loading automation status…</Text>
                  ) : statusError ? (
                    <Alert color="red">{statusError}</Alert>
                  ) : (automationStatus?.jobs?.length ?? 0) === 0 ? (
                    <Text size="sm" c="dimmed">No generated shift jobs have been saved for today yet.</Text>
                  ) : (
                    <ScrollArea>
                      <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: 860 }}>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Shift</Table.Th>
                            <Table.Th>Status</Table.Th>
                            <Table.Th>Primary</Table.Th>
                            <Table.Th>Backup</Table.Th>
                            <Table.Th>Slack TS</Table.Th>
                            <Table.Th>Last error</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {(automationStatus?.jobs ?? []).map((job) => (
                            <Table.Tr key={job.id}>
                              <Table.Td>{formatVisibleShiftLabel(job.shift)}</Table.Td>
                              <Table.Td>
                                <Badge color={job.status === "posted" ? "green" : "yellow"} variant="light">
                                  {job.status}
                                </Badge>
                              </Table.Td>
                              <Table.Td>{job.primary || "—"}</Table.Td>
                              <Table.Td>{job.backup || "—"}</Table.Td>
                              <Table.Td>{job.slack_ts || "—"}</Table.Td>
                              <Table.Td>
                                <Text size="sm" c={job.last_error ? "red" : "dimmed"}>
                                  {job.last_error || "—"}
                                </Text>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                  )}
                </Stack>
              </Card>

              <Card withBorder radius="md" p="md">
                <Stack gap="md">
                  <Text fw={700}>Shift allotments for the day</Text>
                  {(result?.shifts ?? []).length === 0 ? (
                    <Text size="sm" c="dimmed">No shifts were generated for today.</Text>
                  ) : (
                    (result?.shifts ?? []).map((shift) => (
                      <Card key={shift.slot} withBorder radius="md" p="md">
                        <Stack gap="sm">
                          <Group justify="space-between" align="center">
                            <Group gap={8}>
                              <Badge color={shift.status === "ok" ? "green" : "gray"} variant="light">{formatVisibleShiftLabel(shift.slot)}</Badge>
                              {shift.primary ? <Badge color="indigo" variant="light">Primary: {shift.primary}</Badge> : null}
                              {shift.backup ? <Badge color="blue" variant="light">Backup: {shift.backup}</Badge> : null}
                              {shift.continuingFrom ? <Badge color="violet" variant="light">Continuing from {formatVisibleShiftLabel(shift.continuingFrom)}</Badge> : null}
                              {shift.carryPathUsed ? <Badge color="teal" variant="light">Carry path used: {shift.carryPathUsed}</Badge> : null}
                            </Group>
                            {typeof shift.fairnessAfter === "number" ? (
                              <Badge color="grape" variant="light">{shift.fairnessBefore} → {shift.fairnessAfter}</Badge>
                            ) : null}
                          </Group>
                          <Text size="xs" c="dimmed">
                            Available during {formatVisibleShiftLabel(shift.slot)}: {formatAvailableMembers(shift.availableMembers)}
                          </Text>
                          {shift.carryPathRule ? (
                            <Text size="xs" c="dimmed">
                              Carry rule for {formatVisibleShiftLabel(shift.slot)}: {shift.carryPathRule}
                            </Text>
                          ) : null}
                          <Text component="pre" size="sm" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                            {shift.message}
                          </Text>
                        </Stack>
                      </Card>
                    ))
                  )}
                </Stack>
              </Card>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="fairness" pt="md">
            <Stack gap="md">
              <Card withBorder radius="md" p="md">
                <Stack gap="xs">
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={4}>
                      <Text fw={700}>Monthly fairness tracker</Text>
                      <Text size="sm" c="dimmed">
                        This tracker is sourced from the Google Sheet <strong>{fairnessSourceTitle}</strong> for {formatMonthLabel(fairnessSummary?.monthKey)}. It now shows only member name, worked days till date, and AS&amp;RH hours taken directly from that sheet.
                      </Text>
                    </Stack>
                    {fairnessSourceUrl ? (
                      <Button component="a" href={fairnessSourceUrl} target="_blank" rel="noreferrer" variant="light" color="grape" size="xs">
                        Open fairness sheet
                      </Button>
                    ) : null}
                  </Group>
                </Stack>
              </Card>

              {combinedFairnessMembers.length === 0 ? (
                <Card withBorder radius="md" p="md">
                  <Text size="sm" c="dimmed">No monthly Google Sheet fairness data was returned.</Text>
                </Card>
              ) : (
                <>
                  <Card withBorder radius="md" p="md">
                    <Stack gap="md">
                      <Group justify="space-between" align="flex-start">
                        <Stack gap={4}>
                          <Text fw={700}>Combined fairness table</Text>
                          <Text size="sm" c="dimmed">Each member appears once under the shift family where they accumulated the most activity. Only the Google Sheet-backed AS&amp;RH hours are shown.</Text>
                        </Stack>
                        <Badge color="grape" variant="light">{fairnessGroups.length} shift families</Badge>
                      </Group>

                      <ScrollArea>
                        <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: 720 }}>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Member</Table.Th>
                              <Table.Th ta="right">Worked days</Table.Th>
                              <Table.Th ta="right">Roster AS&amp;RH hrs</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {combinedFairnessMembers.map((member) => (
                              <Table.Tr key={`${member.groupKey}-${member.name}`}>
                                <Table.Td>{member.name}</Table.Td>
                                <Table.Td ta="right">{member.workedDays}</Table.Td>
                                <Table.Td ta="right">{member.trackerHours}</Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      </ScrollArea>
                    </Stack>
                  </Card>

                  {fairnessGroups.map((group) => (
                    <Card key={group.key} withBorder radius="md" p="md">
                      <Stack gap="md">
                        <Group justify="space-between" align="flex-start">
                          <Stack gap={4}>
                            <Text fw={700}>{group.label}</Text>
                            <Text size="sm" c="dimmed">
                              Members are listed with only days worked till date and AS&amp;RH hours taken from the Google Sheet.
                            </Text>
                          </Stack>
                          <Badge color="indigo" variant="light">Highest: {group.highestCount}</Badge>
                        </Group>

                        <ScrollArea>
                          <Table withTableBorder withColumnBorders striped highlightOnHover style={{ minWidth: 720 }}>
                            <Table.Thead>
                              <Table.Tr>
                                <Table.Th>Member</Table.Th>
                                <Table.Th ta="right">Worked days</Table.Th>
                                <Table.Th ta="right">Roster AS&amp;RH hrs</Table.Th>
                              </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                              {group.members.map((member) => (
                                <Table.Tr key={`${group.key}-${member.name}`}>
                                  <Table.Td>{member.name}</Table.Td>
                                  <Table.Td ta="right">{member.workedDays}</Table.Td>
                                  <Table.Td ta="right">{member.trackerHours}</Table.Td>
                                </Table.Tr>
                              ))}
                            </Table.Tbody>
                          </Table>
                        </ScrollArea>
                      </Stack>
                    </Card>
                  ))}
                </>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </WidgetFrame>
  );
}
