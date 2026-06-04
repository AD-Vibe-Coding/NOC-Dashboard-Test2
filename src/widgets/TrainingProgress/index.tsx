import { useEffect, useMemo, useState } from "react";
import {
  Badge, Button, Card, Group, Modal,
  Progress, Select, Stack, Table, Text, Textarea, ThemeIcon, Tabs,
} from "@mantine/core";
import {
  IconCheck, IconChartBar, IconPlayerPlay,
  IconSchool, IconUser, IconUsers,
} from "@tabler/icons-react";
import { db } from "../../db";
import { WidgetFrame } from "../WidgetFrame";
import { useIdentity } from "../../lib/identity";
import { LOCKED_TEAM_NAMES } from "../PerformanceTracker/team";

type UpcomingTraining = Awaited<ReturnType<typeof db.upcoming_trainings.list>>[number];
type TrainingCompletion = Awaited<ReturnType<typeof db.training_completions.list>>[number];

const STATUS_META: Record<string, { color: string; label: string }> = {
  not_started: { color: "gray",   label: "Not Started" },
  in_progress:  { color: "blue",  label: "In Progress" },
  completed:    { color: "green", label: "Completed" },
};

function isPast(dateStr: string) {
  return new Date(dateStr) < new Date();
}

export function TrainingProgressWidget(_props: { onCollapse?: () => void }) {
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";
  const myName = identity?.name ?? "";

  const [trainings, setTrainings] = useState<UpcomingTraining[]>([]);
  const [completions, setCompletions] = useState<TrainingCompletion[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updateModal, setUpdateModal] = useState<{ training: UpcomingTraining; current: TrainingCompletion | null } | null>(null);
  const [newStatus, setNewStatus] = useState<string>("not_started");
  const [newNote, setNewNote] = useState("");
  const [filterAgent, setFilterAgent] = useState<string | null>(null);

  const agentOptions = LOCKED_TEAM_NAMES.map((n: string) => ({ value: n, label: n }));

  async function load() {
    setLoading(true);
    try {
      const [t, c] = await Promise.all([
        db.upcoming_trainings.list({ orderBy: { column: "training_date", ascending: false } }),
        db.training_completions.list(),
      ]);
      setTrainings(Array.isArray(t) ? t : []);
      setCompletions(Array.isArray(c) ? c : []);
    } catch {
      // silently ignore load errors
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function getCompletion(trainingId: number, agentName: string) {
    return completions.find(c => c.training_id === trainingId && c.agent_name === agentName) ?? null;
  }

  function openUpdate(training: UpcomingTraining) {
    const current = getCompletion(training.id, myName);
    setUpdateModal({ training, current });
    setNewStatus(current?.status ?? "not_started");
    setNewNote(current?.note ?? "");
  }

  async function saveStatus() {
    if (!updateModal) return;
    setSaving(true);
    try {
      const existing = getCompletion(updateModal.training.id, myName);
      if (existing) {
        await db.training_completions.updateById(existing.id, {
          status: newStatus,
          note: newNote.trim() || null,
          completed_at: newStatus === "completed" ? new Date().toISOString() : null,
        });
      } else {
        await db.training_completions.insert({
          training_id: updateModal.training.id,
          agent_name: myName,
          status: newStatus,
          note: newNote.trim() || null,
          completed_at: newStatus === "completed" ? new Date().toISOString() : null,
        });
      }
      setUpdateModal(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  // Manager overview: completion rate per training
  const trainingStats = useMemo(() => {
    const agents = LOCKED_TEAM_NAMES;
    return trainings.map(t => {
      const agentCompletions = agents.map(a => getCompletion(t.id, a));
      const done = agentCompletions.filter(c => c?.status === "completed").length;
      const inProgress = agentCompletions.filter(c => c?.status === "in_progress").length;
      const pct = Math.round((done / agents.length) * 100);
      return { training: t, done, inProgress, total: agents.length, pct };
    });
  }, [trainings, completions]);

  // My trainings
  const myTrainings = trainings.filter(t =>
    t.audience === "all" || t.audience === identity?.role
  );

  return (
    <WidgetFrame title="Training Progress" icon={IconSchool} iconColor="grape">
      <Tabs defaultValue={isManager ? "overview" : "mine"} keepMounted={false}>
        <Tabs.List px="md" pt="xs">
          <Tabs.Tab value="mine" leftSection={<IconUser size={13} />}>My Progress</Tabs.Tab>
          {isManager && <Tabs.Tab value="overview" leftSection={<IconUsers size={13} />}>Team Overview</Tabs.Tab>}
          {isManager && <Tabs.Tab value="detail" leftSection={<IconChartBar size={13} />}>By Agent</Tabs.Tab>}
        </Tabs.List>

        {/* ── My Progress ── */}
        <Tabs.Panel value="mine" p="md">
          <Stack gap="sm">
            {loading ? (
              <Text size="sm" c="dimmed" ta="center" py="md">Loading…</Text>
            ) : myTrainings.length === 0 ? (
              <Card withBorder radius="lg" p="xl">
                <Stack align="center" gap="sm">
                  <ThemeIcon size={48} radius="xl" color="grape" variant="light"><IconSchool size={28} /></ThemeIcon>
                  <Text fw={600}>No trainings assigned</Text>
                  <Text size="sm" c="dimmed">Check back when your manager posts new training.</Text>
                </Stack>
              </Card>
            ) : myTrainings.map(t => {
              const c = getCompletion(t.id, myName);
              const status = c?.status ?? "not_started";
              const meta = STATUS_META[status];
              const overdue = isPast(t.training_date) && status !== "completed";
              return (
                <Card key={t.id} withBorder radius="lg" p="md"
                  style={overdue ? { borderColor: "var(--mantine-color-red-7)" } : undefined}>
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={4} style={{ flex: 1 }}>
                      <Group gap="xs">
                        <Badge color={meta.color} variant="light" size="sm">{meta.label}</Badge>
                        {overdue && <Badge color="red" variant="filled" size="xs">⚠ Overdue</Badge>}
                        <Badge color="gray" variant="outline" size="xs">{t.audience}</Badge>
                      </Group>
                      <Text fw={700} size="sm">{t.title}</Text>
                      <Text size="xs" c="dimmed">{t.description}</Text>
                      <Text size="xs" c="dimmed">Due: {t.training_date} · Posted by {t.posted_by}</Text>
                      {c?.note && <Text size="xs" c="dimmed" mt={2}>Note: {c.note}</Text>}
                    </Stack>
                    <Button size="xs" variant="light" color={meta.color}
                      leftSection={status === "completed" ? <IconCheck size={12} /> : <IconPlayerPlay size={12} />}
                      onClick={() => openUpdate(t)}>
                      {status === "completed" ? "Completed" : "Update"}
                    </Button>
                  </Group>
                </Card>
              );
            })}
          </Stack>
        </Tabs.Panel>

        {/* ── Team Overview (manager) ── */}
        {isManager && (
          <Tabs.Panel value="overview" p="md">
            <Stack gap="sm">
              {trainingStats.length === 0 ? (
                <Text size="sm" c="dimmed" ta="center" py="md">No trainings posted yet.</Text>
              ) : trainingStats.map(s => (
                <Card key={s.training.id} withBorder radius="lg" p="md">
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Stack gap={2}>
                        <Text fw={700} size="sm">{s.training.title}</Text>
                        <Text size="xs" c="dimmed">Due: {s.training.training_date} · {s.training.audience}</Text>
                      </Stack>
                      <Stack gap={0} align="flex-end">
                        <Text fw={800} size="lg" c={s.pct === 100 ? "green" : s.pct > 50 ? "yellow" : "red"}>
                          {s.pct}%
                        </Text>
                        <Text size="xs" c="dimmed">{s.done}/{s.total} done</Text>
                      </Stack>
                    </Group>
                    <Progress.Root size="sm" radius="xl">
                      <Progress.Section value={s.pct} color={s.pct === 100 ? "green" : s.pct > 50 ? "yellow" : "red"} />
                      <Progress.Section value={Math.round((s.inProgress / s.total) * 100)} color="blue" />
                    </Progress.Root>
                    <Group gap="xs">
                      <Badge size="xs" color="green" variant="light">{s.done} completed</Badge>
                      <Badge size="xs" color="blue" variant="light">{s.inProgress} in progress</Badge>
                      <Badge size="xs" color="gray" variant="light">{s.total - s.done - s.inProgress} not started</Badge>
                    </Group>
                  </Stack>
                </Card>
              ))}
            </Stack>
          </Tabs.Panel>
        )}

        {/* ── By Agent (manager) ── */}
        {isManager && (
          <Tabs.Panel value="detail" p="md">
            <Stack gap="sm">
              <Select placeholder="Filter by agent…" data={agentOptions} value={filterAgent}
                onChange={setFilterAgent} clearable size="xs" w={200} />
              <Card withBorder radius="lg" p={0}>
                <Table highlightOnHover horizontalSpacing="md" verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Agent</Table.Th>
                      {trainings.slice(0, 4).map(t => (
                        <Table.Th key={t.id}><Text size="xs" lineClamp={1} maw={100}>{t.title}</Text></Table.Th>
                      ))}
                      <Table.Th>Overall</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {LOCKED_TEAM_NAMES
                      .filter(a => !filterAgent || a === filterAgent)
                      .map(agent => {
                        const agentCompletions = trainings.map(t => getCompletion(t.id, agent));
                        const done = agentCompletions.filter(c => c?.status === "completed").length;
                        const pct = trainings.length > 0 ? Math.round((done / trainings.length) * 100) : 0;
                        return (
                          <Table.Tr key={agent}>
                            <Table.Td><Text size="xs" fw={600}>{agent}</Text></Table.Td>
                            {trainings.slice(0, 4).map((t, i) => {
                              const c = agentCompletions[i];
                              const s = c?.status ?? "not_started";
                              return (
                                <Table.Td key={t.id}>
                                  <Badge size="xs" color={STATUS_META[s].color} variant="light">
                                    {s === "completed" ? "✓" : s === "in_progress" ? "▶" : "—"}
                                  </Badge>
                                </Table.Td>
                              );
                            })}
                            <Table.Td>
                              <Badge size="xs" color={pct === 100 ? "green" : pct > 50 ? "yellow" : "red"} variant="filled">
                                {pct}%
                              </Badge>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                  </Table.Tbody>
                </Table>
              </Card>
            </Stack>
          </Tabs.Panel>
        )}
      </Tabs>

      {/* Update status modal */}
      <Modal opened={!!updateModal} onClose={() => setUpdateModal(null)}
        title={<Group gap="xs"><IconSchool size={16} /><Text fw={700}>Update Training Status</Text></Group>}
        radius="lg" centered size="sm">
        {updateModal && (
          <Stack gap="md">
            <Text size="sm" fw={600}>{updateModal.training.title}</Text>
            <Select label="Status"
              data={Object.entries(STATUS_META).map(([v, m]) => ({ value: v, label: m.label }))}
              value={newStatus} onChange={v => v && setNewStatus(v)} />
            <Textarea label="Note (optional)" placeholder="e.g. Completed in LMS, certificate attached"
              value={newNote} onChange={e => setNewNote(e.currentTarget.value)} minRows={2} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setUpdateModal(null)}>Cancel</Button>
              <Button color="grape" leftSection={<IconCheck size={14} />} onClick={() => void saveStatus()} loading={saving}>
                Save
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </WidgetFrame>
  );
}

export function TrainingProgressTile({ onExpand }: { onExpand: () => void }) {
  const { identity } = useIdentity();
  const [stats, setStats] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    if (!identity?.name) return;
    Promise.all([
      db.upcoming_trainings.list(),
      db.training_completions.list({ filter: { agent_name: identity.name } }),
    ]).then(([t, c]) => {
      const safeT = Array.isArray(t) ? t : [];
      const safeC = Array.isArray(c) ? c : [];
      setStats({ done: safeC.filter(x => x.status === "completed").length, total: safeT.length });
    }).catch(() => {});
  }, [identity?.name]);
  return (
    <Card withBorder radius="lg" p="md" style={{ cursor: "pointer", height: "100%" }} onClick={onExpand}>
      <Group gap="sm" align="flex-start">
        <ThemeIcon size={36} radius="md" variant="light" color="grape">
          <IconSchool size={20} />
        </ThemeIcon>
        <Stack gap={2} style={{ flex: 1 }}>
          <Text fw={700} size="sm">Training Progress</Text>
          <Text size="xs" c="dimmed">Track completions · Team overview</Text>
          {stats && stats.total > 0 && (
            <>
              <Progress value={Math.round((stats.done / stats.total) * 100)}
                color={stats.done === stats.total ? "green" : "grape"} size="xs" mt={6} radius="xl" />
              <Text size="xs" c="dimmed">{stats.done}/{stats.total} completed</Text>
            </>
          )}
        </Stack>
      </Group>
    </Card>
  );
}
