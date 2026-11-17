import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Badge, Box, Button, Card, Group, Loader, Modal, Select, SimpleGrid, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { IconCoffee, IconHeadset, IconPlayerStop, IconSettings, IconUser } from "@tabler/icons-react";
import { db } from "../../db";
import { useIdentity } from "../../lib/identity";
import { BREAK_TYPE_COLORS, emojiForBreak, formatBreakStartMessage, postSlackMessage } from "../../lib/slack";
import { ROLE_BY_NAME, ROSTER_BY_EMAIL } from "../../lib/roles";
import { useBreakData } from "../BreakTracker/data";
import { WidgetTile } from "../WidgetTile";
import { useTeamAvailability } from "./data";
import { useRosterShift } from "../../lib/use-roster-shift";
import { resolveTeamMember } from "../PerformanceTracker/team";
import { toggleRingCentralQueueCalls } from "../../lib/ringcentral";
import { syncQueueCallsForBreak, syncQueueCallsForPunch } from "../../lib/queue-automation";

const TOTAL_BREAK_MINUTES = 90;
const BREAK_ONLY_TYPES = new Set(["Coffee", "Lunch", "Restroom", "Personal", "Other"]);

function isSameLocalDay(iso: string, now = new Date()) {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

interface Props {
  onExpand: () => void;
}

type QueueChange = { queueName: string; enabled: boolean };

function queueDisplayLabel(name: string) {
  if (/mobility/i.test(name)) return "Mobility Queue";
  if (/network|noc/i.test(name)) return "NOC Queue";
  return name;
}

const QUICK_STATUS_TYPES = [
  { value: "Coffee", label: "Coffee" },
  { value: "Lunch", label: "Lunch" },
  { value: "Restroom", label: "Restroom" },
  { value: "Personal", label: "Personal" },
  { value: "Other", label: "Other" },
  { value: "Urgent Task", label: "Urgent Task" },
  { value: "Meeting - Internal", label: "Meeting - Internal" },
  { value: "Meeting - External", label: "Meeting - External" },
];

export function ZoomQueueTile({ onExpand }: Props) {
  const { data, refresh: refreshQueueData } = useTeamAvailability();
  const { active, history, refresh } = useBreakData();
  const { data: rosterData } = useRosterShift();
  const { identity } = useIdentity();
  const [statusType, setStatusType] = useState<string | null>("Lunch");
  const [posting, setPosting] = useState<"status" | "punch_in" | "punch_out" | null>(null);
  const [lastPunchAction, setLastPunchAction] = useState<"punch_in" | "punch_out" | null>(null);
  const [punchInMessage, setPunchInMessage] = useState("Hello Team");
  const [punchOutMessage, setPunchOutMessage] = useState("Signing off for now");
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [draftPunchIn, setDraftPunchIn] = useState("Hello Team");
  const [draftPunchOut, setDraftPunchOut] = useState("Signing off for now");
  const [queueConfirmation, setQueueConfirmation] = useState<QueueChange | null>(null);
  const [pendingQueue, setPendingQueue] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [automationNotice, setAutomationNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const inQueue = data?.totals.in_queue ?? 0;
  const notInQueue = data?.totals.not_in_queue ?? 0;
  const total = inQueue + notInQueue;
  const inShift = rosterData?.inShiftNow?.length ?? total;
  const outOfQueueInShift = Math.max(inShift - inQueue, 0);

  const normalizedEmail = identity?.email?.toLowerCase().trim() ?? "";
  const isManager =
    identity?.role === "manager" ||
    (!!identity?.name && ROLE_BY_NAME[identity.name.trim()] === "manager") ||
    (!!normalizedEmail && ROSTER_BY_EMAIL[normalizedEmail]?.role === "manager");

  const samePerson = (a?: string | null, b?: string | null) => {
    const left = a ? (resolveTeamMember(a) ?? a).trim().toLowerCase() : "";
    const right = b ? (resolveTeamMember(b) ?? b).trim().toLowerCase() : "";
    return !!left && !!right && left === right;
  };

  const myRingCentralAgent = data?.source === "live" && identity?.name
    ? data.agents.find((agent) => samePerson(agent.display_name, identity.name))
    : undefined;
  const myQueueControls = Object.entries(myRingCentralAgent?.queue_opt_in ?? {})
    .filter(([name]) => /mobility|network|noc/i.test(name))
    .sort(([a], [b]) => queueDisplayLabel(a).localeCompare(queueDisplayLabel(b)));

  const youOnBreak = identity?.name
    ? active.find((b) => samePerson(b.employee_name, identity.name)) ?? null
    : null;
  const canQuickControl = !isManager && !!identity?.name;
  const isPunchedIn = lastPunchAction === "punch_in";
  const statusControlsLocked = !isManager && !isPunchedIn;
  const availableQuickStatusTypes = QUICK_STATUS_TYPES;

  const myBreakRows = useMemo(() => {
    if (!identity?.name) return [] as typeof active;
    const rows = [...active, ...history].filter(
      (row) => samePerson(row.employee_name, identity.name) && BREAK_ONLY_TYPES.has(row.break_type) && isSameLocalDay(row.start_time),
    );
    const deduped = new Map<number, (typeof rows)[number]>();
    for (const row of rows) deduped.set(row.id, row);
    return [...deduped.values()];
  }, [active, history, identity?.name]);

  const myBreakTakenCount = myBreakRows.length;
  const myBreakTakenMinutes = useMemo(() => {
    return myBreakRows.reduce((sum, row) => {
      const endMs = row.is_active ? Date.now() : row.end_time ? new Date(row.end_time).getTime() : Date.now();
      const startMs = new Date(row.start_time).getTime();
      const duration = row.duration_minutes ?? Math.max(1, Math.round((endMs - startMs) / 60000));
      return sum + duration;
    }, 0);
  }, [myBreakRows]);
  const breakUsed = Math.min(myBreakTakenMinutes, TOTAL_BREAK_MINUTES);
  const onBreakMembers = useMemo(() => {
    const unique = new Map<string, { name: string; status: string }>();
    for (const row of active) {
      const name = resolveTeamMember(row.employee_name) ?? row.employee_name;
      unique.set(name.trim().toLowerCase(), { name, status: row.break_type });
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [active]);
  const shiftMembers = rosterData?.inShiftNow ?? [];
  const queueAgents = data?.agents ?? [];
  const inQueueNames = queueAgents
    .filter((agent) => agent.status === "in_queue")
    .filter((agent) => !rosterData || shiftMembers.some((name) => samePerson(name, agent.display_name)))
    .filter((agent) => !onBreakMembers.some((member) => samePerson(member.name, agent.display_name)))
    .map((agent) => resolveTeamMember(agent.display_name) ?? agent.display_name);
  const notInQueueNames = rosterData
    ? shiftMembers
        .filter((name) => !queueAgents.some((agent) => agent.status === "in_queue" && samePerson(name, agent.display_name)))
        .filter((name) => !onBreakMembers.some((member) => samePerson(member.name, name)))
        .map((name) => resolveTeamMember(name) ?? name)
    : queueAgents
        .filter((agent) => agent.status === "not_in_queue")
        .filter((agent) => !onBreakMembers.some((member) => samePerson(member.name, agent.display_name)))
        .map((agent) => resolveTeamMember(agent.display_name) ?? agent.display_name);
  const rosterGroups = [
    { title: "In shift + in queue", color: "green", names: inQueueNames },
    { title: "In shift + not in queue", color: "gray", names: notInQueueNames },
    { title: "On break or meeting", color: "orange", names: onBreakMembers.map((member) => `${member.name} · ${member.status}`) },
  ];

  useEffect(() => {
    if (!identity?.name) return;

    try {
      const inMsg = localStorage.getItem(`zoom-queue:tile:punch-in:${identity.name.toLowerCase().trim()}`);
      const outMsg = localStorage.getItem(`zoom-queue:tile:punch-out:${identity.name.toLowerCase().trim()}`);
      if (inMsg) setPunchInMessage(inMsg);
      if (outMsg) setPunchOutMessage(outMsg);
    } catch {
      // ignore storage failures
    }

    let cancelled = false;
    db.punch_events
      .list({
        filter: { employee_name: identity.name },
        orderBy: { column: "punched_at", ascending: false },
        limit: 1,
      })
      .then((rows) => {
        if (cancelled) return;
        const action = rows[0]?.action;
        setLastPunchAction(action === "punch_in" || action === "punch_out" ? action : null);
      })
      .catch(() => {
        if (cancelled) return;
        setLastPunchAction(null);
      });

    return () => {
      cancelled = true;
    };
  }, [identity?.name]);

  useEffect(() => {
    if (!statusType) return;
    if (availableQuickStatusTypes.some((option) => option.value === statusType)) return;
    setStatusType(availableQuickStatusTypes[0]?.value ?? null);
  }, [availableQuickStatusTypes, statusType]);

  function stopTileExpand(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function configurePunchMessages(event: MouseEvent<HTMLElement>) {
    stopTileExpand(event);
    if (!identity?.name) return;
    setDraftPunchIn(punchInMessage);
    setDraftPunchOut(punchOutMessage);
    setMessagesOpen(true);
  }

  function savePunchMessages() {
    if (!identity?.name) return;

    const inMsg = draftPunchIn.trim() || "Hello Team";
    const outMsg = draftPunchOut.trim() || "Signing off for now";

    setPunchInMessage(inMsg);
    setPunchOutMessage(outMsg);

    try {
      localStorage.setItem(`zoom-queue:tile:punch-in:${identity.name.toLowerCase().trim()}`, inMsg);
      localStorage.setItem(`zoom-queue:tile:punch-out:${identity.name.toLowerCase().trim()}`, outMsg);
    } catch {
      // ignore storage failures
    }

    setMessagesOpen(false);
  }

  async function startStatusQuick() {
    if (!identity?.name || !statusType) return;

    if (statusControlsLocked) {
      window.alert("Punch in first before starting any status.");
      return;
    }

    setPosting("status");
    let slackTs: string | null = null;
    let slackPosted = false;
    try {
      const result = await postSlackMessage(formatBreakStartMessage(statusType), {
        username: identity.name,
        icon_emoji: emojiForBreak(statusType),
      });
      slackTs = result.ts ?? null;
      slackPosted = !!result.posted;
    } catch {
      // non-fatal; still record locally
    }

    try {
      await db.breaks.insert({
        employee_name: identity.name,
        break_type: statusType,
        start_time: new Date().toISOString(),
        is_active: true,
        slack_message_ts: slackTs,
        slack_posted: slackPosted,
      });
      await refresh();
      if (BREAK_ONLY_TYPES.has(statusType)) {
        try {
          const result = await syncQueueCallsForBreak(identity.name, identity.name, "start");
          if (result) setAutomationNotice({ kind: "success", message: result.message });
        } catch (error) {
          setAutomationNotice({ kind: "error", message: `Break recorded; RingCentral queues could not be turned off: ${error instanceof Error ? error.message : String(error)}` });
        }
      }
    } finally {
      setPosting(null);
    }
  }

  async function endStatusQuick() {
    if (!youOnBreak) return;
    setPosting("status");
    const end = new Date();
    const duration = Math.max(1, Math.round((end.getTime() - new Date(youOnBreak.start_time).getTime()) / 60000));
    const threadTs =
      youOnBreak.slack_message_ts && !youOnBreak.slack_message_ts.startsWith("demo-")
        ? youOnBreak.slack_message_ts
        : null;

    try {
      await postSlackMessage("Back", {
        thread_ts: threadTs,
        username: youOnBreak.employee_name,
        icon_emoji: ":arrow_backward:",
      });
    } catch {
      // non-fatal; still clear local status even if Slack post fails
    }

    try {
      await db.breaks.updateById(youOnBreak.id, {
        end_time: end.toISOString(),
        duration_minutes: duration,
        is_active: false,
      });
      await refresh();
      if (BREAK_ONLY_TYPES.has(youOnBreak.break_type) && identity?.name) {
        try {
          const result = await syncQueueCallsForBreak(identity.name, youOnBreak.employee_name, "back");
          if (result) setAutomationNotice({ kind: "success", message: result.message });
        } catch (error) {
          setAutomationNotice({ kind: "error", message: `Break ended; RingCentral queues could not be updated: ${error instanceof Error ? error.message : String(error)}` });
        }
      }
    } finally {
      setPosting(null);
    }
  }

  async function quickPunch(action: "punch_in" | "punch_out") {
    if (!identity?.name || posting) return;

    if (action === "punch_out" && youOnBreak && BREAK_ONLY_TYPES.has(youOnBreak.break_type)) {
      window.alert(`Please end your ${youOnBreak.break_type} break before punching out.`);
      return;
    }

    setPosting(action);

    const storedIn = identity?.name ? localStorage.getItem(`zoom-queue:tile:punch-in:${identity.name.toLowerCase().trim()}`) : null;
    const storedOut = identity?.name ? localStorage.getItem(`zoom-queue:tile:punch-out:${identity.name.toLowerCase().trim()}`) : null;
    const text = action === "punch_in"
      ? ((storedIn ?? punchInMessage).trim() || "Hello Team")
      : ((storedOut ?? punchOutMessage).trim() || "Signing off for now");
    let slackPosted = false;
    let slackTs: string | null = null;
    let slackChannel: string | null = null;

    try {
      try {
        const slack = await postSlackMessage(text, {
          username: identity.name,
          ...(action === "punch_in" ? { icon_emoji: ":large_green_circle:" } : { icon_emoji: ":white_circle:" }),
        });
        slackPosted = !!slack.posted;
        slackTs = slack.ts ?? null;
        slackChannel = slack.channel ?? null;
      } catch {
        // non-fatal; keep local logging even if Slack fails
      }

      await db.punch_events.insert({
        employee_name: identity.name,
        action,
        message: text,
        slack_posted: slackPosted,
        slack_channel: slackChannel,
        slack_ts: slackTs,
        punched_at: new Date().toISOString(),
      });
      setLastPunchAction(action);
      try {
        const result = await syncQueueCallsForPunch(identity.name, identity.name, action);
        if (result) setAutomationNotice({ kind: "success", message: result.message });
      } catch (error) {
        setAutomationNotice({ kind: "error", message: `${action === "punch_in" ? "Punch-in" : "Punch-out"} saved; RingCentral queues could not be updated: ${error instanceof Error ? error.message : String(error)}` });
      }
    } finally {
      setPosting(null);
    }
  }

  async function confirmQueueChange() {
    if (!queueConfirmation || !identity?.name || pendingQueue) return;
    const change = queueConfirmation;
    setPendingQueue(change.queueName);
    setQueueNotice(null);
    try {
      const result = await toggleRingCentralQueueCalls(identity.name, change.enabled, change.queueName);
      setQueueNotice({ kind: "success", message: result.message ?? `${queueDisplayLabel(change.queueName)} updated.` });
      await refreshQueueData();
    } catch (error) {
      setQueueNotice({ kind: "error", message: error instanceof Error ? error.message : "Unable to update RingCentral queue." });
    } finally {
      setPendingQueue(null);
      setQueueConfirmation(null);
    }
  }

  return (
    <WidgetTile
      title="Team Availability"
      description="Queue + break status"
      icon={IconHeadset}
      iconColor="blue"
      status={
        data
          ? {
              label: data.source,
              color: data.source === "live" ? "green" : "yellow",
              tooltip:
                data.source === "live"
                  ? "Live data from RingCentral queue presence"
                  : "Snapshot — set ZOOM_* in .env for live data",
            }
          : undefined
      }
      headerActions={canQuickControl && youOnBreak ? (
        <Button
          size="xs"
          px="sm"
          miw={78}
          variant="light"
          color="orange"
          leftSection={<IconPlayerStop size={12} />}
          loading={posting === "status"}
          onClick={(event) => {
            stopTileExpand(event);
            void endStatusQuick();
          }}
        >
          End
        </Button>
      ) : undefined}
      onExpand={onExpand}
    >
      <Stack gap={6}>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={8}>
          <Stack gap={6}>
            <SimpleGrid cols={{ base: 2, sm: canQuickControl && identity?.name ? 2 : 1 }} spacing={6}>
              <Card withBorder radius="md" p={8} style={{ background: "color-mix(in srgb, var(--mantine-color-green-9) 8%, var(--mantine-color-body))" }}>
                <Stack gap={1}>
                  <Text size="10px" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: "0.04em", lineHeight: 1.1 }}>
                    In Queue
                  </Text>
                  <Title order={3} c="green" style={{ lineHeight: 1 }}>
                    {inQueue}
                    <Text component="span" size="xs" c="dimmed" fw={500}>
                      {" "}/ {inShift}
                    </Text>
                  </Title>
                  <Text size="11px" c="dimmed" style={{ lineHeight: 1.15 }}>
                    {outOfQueueInShift} out of queue (in shift)
                  </Text>
                </Stack>
              </Card>

              {canQuickControl && identity?.name && (
                <Card
                  withBorder
                  radius="md"
                  p={8}
                  style={{
                    background: `color-mix(in srgb, var(--mantine-color-${breakUsed >= TOTAL_BREAK_MINUTES ? "red" : "blue"}-9) 10%, var(--mantine-color-body))`,
                  }}
                >
                  <Text size="10px" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: "0.04em", lineHeight: 1.1 }}>Break Summary</Text>
                  <Group justify="space-between" align="flex-end" wrap="nowrap" mt={2} gap={8}>
                    <Stack gap={0}>
                      <Text size="11px" c="dimmed">Taken</Text>
                      <Text fw={800} size="lg" style={{ lineHeight: 1 }}>{myBreakTakenCount}</Text>
                    </Stack>
                    <Stack gap={0} align="flex-end" style={{ minWidth: 0 }}>
                      <Text size="11px" c="dimmed">Used</Text>
                      <Text fw={800} size="md" style={{ lineHeight: 1, wordBreak: "break-word" }}>{breakUsed}/{TOTAL_BREAK_MINUTES} min</Text>
                    </Stack>
                  </Group>
                </Card>
              )}
            </SimpleGrid>

            {canQuickControl && (
              <Card withBorder radius="md" p={8} onClick={stopTileExpand}>
                <Stack gap={6}>
                  <Group justify="space-between" wrap="wrap" gap={6}>
                    <Badge
                      variant="light"
                      color={youOnBreak ? (BREAK_TYPE_COLORS[youOnBreak.break_type] ?? "orange") : "gray"}
                      leftSection={<IconUser size={10} />}
                      size="xs"
                      style={{ textTransform: "none" }}
                    >
                      {identity?.name?.split(" ")[0] ?? "Agent"}
                      {youOnBreak ? ` · ${youOnBreak.break_type}` : " · available"}
                    </Badge>
                    <Button
                      size="compact-xs"
                      px={6}
                      variant="subtle"
                      color="gray"
                      leftSection={<IconSettings size={12} />}
                      onClick={configurePunchMessages}
                    >
                      Set messages
                    </Button>
                  </Group>

                  {!youOnBreak && (
                    <Group gap={6} wrap="nowrap" align="stretch">
                      <Select
                        size="xs"
                        style={{ flex: 1, minWidth: 0 }}
                        data={availableQuickStatusTypes}
                        value={statusType}
                        onChange={setStatusType}
                        allowDeselect={false}
                        disabled={statusControlsLocked}
                        description={statusControlsLocked ? "Punch in to unlock all status options." : undefined}
                      />
                      <Button
                        size="compact-xs"
                        px="sm"
                        variant="light"
                        color="orange"
                        leftSection={<IconCoffee size={12} />}
                        loading={posting === "status"}
                        disabled={statusControlsLocked}
                        onClick={() => void startStatusQuick()}
                      >
                        Start
                      </Button>
                    </Group>
                  )}

                  <Group gap={6} justify="flex-end" wrap="nowrap">
                    <Button
                      size="compact-xs"
                      px={10}
                      variant="light"
                      color="green"
                      loading={posting === "punch_in"}
                      disabled={lastPunchAction === "punch_in"}
                      onClick={() => void quickPunch("punch_in")}
                    >
                      Punch In
                    </Button>
                    <Button
                      size="compact-xs"
                      px={10}
                      variant="light"
                      color="red"
                      loading={posting === "punch_out"}
                      disabled={lastPunchAction === "punch_out"}
                      onClick={() => void quickPunch("punch_out")}
                    >
                      Punch Out
                    </Button>
                  </Group>
                  {automationNotice && (
                    <Text size="10px" c={automationNotice.kind === "error" ? "red" : "green"} role={automationNotice.kind === "error" ? "alert" : "status"}>
                      {automationNotice.message}
                    </Text>
                  )}
                </Stack>
              </Card>
            )}

            {identity?.name && myQueueControls.length > 0 && (
              <Card withBorder radius="md" p={8} onClick={stopTileExpand}>
                <Stack gap={6}>
                  <Group justify="space-between" wrap="nowrap" gap={6}>
                    <Text size="xs" fw={700}>My RingCentral call queues</Text>
                    <Badge size="xs" variant="light" color="green">LIVE</Badge>
                  </Group>
                  {myRingCentralAgent?.global_queue_accept_calls === false && (
                    <Text size="10px" c="orange" role="note">
                      Global queue acceptance is off in RingCentral; per-queue settings won’t route calls until it is enabled.
                    </Text>
                  )}
                  {myQueueControls.map(([queueName, enabled]) => (
                    <Group key={queueName} justify="space-between" wrap="nowrap" gap="sm">
                      <Box style={{ minWidth: 0 }}>
                        <Text size="xs" fw={600}>{queueDisplayLabel(queueName)}</Text>
                        <Text size="10px" c="dimmed">{enabled === null ? "Queue status unavailable" : "Accept incoming queue calls"}</Text>
                      </Box>
                      <Switch
                        checked={enabled === true}
                        disabled={pendingQueue !== null || enabled === null}
                        color="green"
                        size="sm"
                        aria-label={enabled === null
                          ? `${queueDisplayLabel(queueName)} status unavailable`
                          : `${enabled ? "Turn off" : "Turn on"} ${queueDisplayLabel(queueName)}`}
                        onChange={() => {
                          if (enabled !== null) setQueueConfirmation({ queueName, enabled: !enabled });
                        }}
                      />
                      {pendingQueue === queueName && <Loader size="xs" aria-label="Updating queue" />}
                    </Group>
                  ))}
                  {queueNotice && (
                    <Text size="xs" c={queueNotice.kind === "error" ? "red" : "green"} role={queueNotice.kind === "error" ? "alert" : "status"}>
                      {queueNotice.message}
                    </Text>
                  )}
                </Stack>
              </Card>
            )}
          </Stack>

          <Stack gap={6}>
            {rosterGroups.map((group) => (
              <Card key={group.title} withBorder radius="md" p={8} style={{ minWidth: 0 }}>
                <Group justify="space-between" wrap="nowrap" gap={6} align="flex-start">
                  <Text size="xs" fw={700} c={group.color} style={{ lineHeight: 1.3 }}>{group.title}</Text>
                  <Badge size="xs" variant="light" color={group.color}>{group.names.length}</Badge>
                </Group>
                {group.names.length > 0 ? (
                  <Group gap={5} mt={6}>
                    {group.names.map((name) => (
                      <Badge key={`${group.title}-${name}`} size="sm" variant="light" color={group.color} style={{ textTransform: "none" }}>
                        {name}
                      </Badge>
                    ))}
                  </Group>
                ) : (
                  <Text size="xs" c="dimmed" mt={6}>No one</Text>
                )}
              </Card>
            ))}
          </Stack>
        </SimpleGrid>

        <Modal
          opened={messagesOpen}
          onClose={() => setMessagesOpen(false)}
          title="Set default punch messages"
          centered
          onClick={stopTileExpand}
        >
          <Stack gap="sm">
            <TextInput
              label="Punch In message"
              value={draftPunchIn}
              onChange={(event) => setDraftPunchIn(event.currentTarget.value)}
              placeholder="Hello Team"
            />
            <TextInput
              label="Punch Out message"
              value={draftPunchOut}
              onChange={(event) => setDraftPunchOut(event.currentTarget.value)}
              placeholder="Signing off for now"
            />
            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={() => setMessagesOpen(false)}>Cancel</Button>
              <Button color="appdirect" onClick={savePunchMessages}>Save</Button>
            </Group>
          </Stack>
        </Modal>

        <Modal
          opened={queueConfirmation !== null}
          onClose={() => pendingQueue === null && setQueueConfirmation(null)}
          title={`${queueConfirmation?.enabled ? "Turn on" : "Turn off"} ${queueConfirmation ? queueDisplayLabel(queueConfirmation.queueName) : "queue"}?`}
          centered
          onClick={stopTileExpand}
        >
          <Stack gap="sm">
            <Text size="sm">
              {queueConfirmation?.enabled
                ? "RingCentral may route incoming calls from this queue to your extension."
                : "Your extension will stop accepting incoming calls from this queue."}
            </Text>
            <Group justify="flex-end">
              <Button variant="default" disabled={pendingQueue !== null} onClick={() => setQueueConfirmation(null)}>Cancel</Button>
              <Button
                color={queueConfirmation?.enabled ? "green" : "red"}
                loading={pendingQueue !== null}
                onClick={() => void confirmQueueChange()}
              >
                {queueConfirmation?.enabled ? "Turn on queue" : "Turn off queue"}
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </WidgetTile>
  );
}
