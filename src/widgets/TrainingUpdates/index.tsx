import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import {
  IconAlertCircle,
  IconCheck,
  IconEdit,
  IconMessageCircle,
  IconPlus,
  IconSchool,
  IconTargetArrow,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { useIdentity } from "../../lib/identity";
import { LOCKED_TEAM_NAMES } from "../PerformanceTracker/team";
import { ROLE_BY_NAME } from "../../lib/roles";

export { TrainingUpdatesTile } from "./Tile";

type UpcomingTraining = {
  id: number;
  title: string;
  description: string;
  training_date: string;
  audience: string;
  posted_by: string;
  created_at: string;
};

type TrainingCompletion = {
  id: number;
  training_id: number;
  agent_name: string;
  status: "not_started" | "in_progress" | "completed";
  progress_percent?: number | null;
  target_date?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  note?: string | null;
  created_at: string;
};

type TrainingComment = {
  id: number;
  training_id: number;
  author_name: string;
  author_role: string;
  message: string;
  created_at: string;
};

const STATUS_META: Record<TrainingCompletion["status"], { color: string; label: string }> = {
  not_started: { color: "gray", label: "Not started" },
  in_progress: { color: "blue", label: "In progress" },
  completed: { color: "green", label: "Completed" },
};

const CERTIFICATION_REGISTRY: Array<{
  certification: string;
  badge: string;
  badgeImage?: string;
  individuals: string[];
  status: "Active" | "Expired";
}> = [
  {
    certification: "CCNA",
    badge: "Cisco Certified CCNA",
    badgeImage: "/user-uploads/image.png",
    individuals: ["Karthik Radhakrishnan", "Kartik Damagalla", "Akram Ahmed"],
    status: "Active",
  },
  {
    certification: "CCNP",
    badge: "Cisco Certified CCNP",
    individuals: ["Otukho Olembo"],
    status: "Expired",
  },
  {
    certification: "CCNP ENCOR",
    badge: "Cisco Certified Specialist ENCOR",
    individuals: ["Mohammed Zubairuddin"],
    status: "Active",
  },
  {
    certification: "Fortinet NSE 4",
    badge: "Fortinet NSE 4",
    individuals: ["Otukho Olembo"],
    status: "Active",
  },
];

function toIsoDate(value: Date | null) {
  if (!value) return "";
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseAudience(audience: string) {
  if (audience.startsWith("user:")) return { kind: "user" as const, value: audience.slice(5) };
  return { kind: "group" as const, value: audience };
}

function appliesToMember(training: UpcomingTraining, memberName: string) {
  const parsed = parseAudience(training.audience);
  if (parsed.kind === "user") return parsed.value === memberName;
  return parsed.value === "all" || !!parsed.value;
}

function formatAgo(iso?: string | null) {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function daysTo(dateText?: string | null) {
  if (!dateText) return null;
  const now = new Date();
  const target = new Date(`${dateText}T00:00:00`);
  const diff = target.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function TrainingUpdatesWidget() {
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trainings, setTrainings] = useState<UpcomingTraining[]>([]);
  const [completions, setCompletions] = useState<TrainingCompletion[]>([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [certDate, setCertDate] = useState<Date | null>(null);
  const [audience, setAudience] = useState<string | null>("all");
  const [assignee, setAssignee] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editingTraining, setEditingTraining] = useState<UpcomingTraining | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDate, setEditDate] = useState<Date | null>(null);
  const [editAudience, setEditAudience] = useState<string | null>("all");
  const [editAssignee, setEditAssignee] = useState<string | null>(null);
  const [editWorking, setEditWorking] = useState(false);

  const [deletingTraining, setDeletingTraining] = useState<UpcomingTraining | null>(null);

  const [selfTitle, setSelfTitle] = useState("");
  const [selfDescription, setSelfDescription] = useState("");
  const [selfDate, setSelfDate] = useState<Date | null>(null);
  const [selfCreating, setSelfCreating] = useState(false);

  const [updating, setUpdating] = useState<UpcomingTraining | null>(null);
  const [newStatus, setNewStatus] = useState<TrainingCompletion["status"]>("not_started");
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [targetDate, setTargetDate] = useState<Date | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [threadTraining, setThreadTraining] = useState<UpcomingTraining | null>(null);
  const [threadComments, setThreadComments] = useState<TrainingComment[]>([]);
  const [threadMessage, setThreadMessage] = useState("");
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadPosting, setThreadPosting] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [tRes, cRes] = await Promise.all([fetch("/api/upcoming_trainings"), fetch("/api/training_completions")]);
      const tJson = await tRes.json();
      const cJson = await cRes.json();
      if (!tRes.ok) throw new Error(tJson.error ?? "Failed to load trainings");
      if (!cRes.ok) throw new Error(cJson.error ?? "Failed to load completions");
      setTrainings((tJson.trainings ?? []) as UpcomingTraining[]);
      setCompletions((cJson.completions ?? []) as TrainingCompletion[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const teamMembers = useMemo(
    () => LOCKED_TEAM_NAMES.filter((n) => n !== "Team" && n !== "NOC Seniors").filter((n) => ROLE_BY_NAME[n] !== "manager"),
    [],
  );

  const visibleTrainings = useMemo(() => {
    if (!identity) return [] as UpcomingTraining[];
    if (isManager) return trainings;
    return trainings.filter((t) => {
      const parsed = parseAudience(t.audience);
      if (parsed.kind === "user") return parsed.value === identity.name;
      return parsed.value === "all" || parsed.value === identity.role;
    });
  }, [trainings, identity, isManager]);

  function getCompletion(trainingId: number, agentName: string) {
    return completions.find((c) => c.training_id === trainingId && c.agent_name === agentName) ?? null;
  }

  const certStats = useMemo(
    () =>
      trainings.map((t) => {
        const applicable = teamMembers.filter((m) => appliesToMember(t, m));
        const rows = applicable.map((m) => getCompletion(t.id, m));
        const completed = rows.filter((r) => r?.status === "completed").length;
        const inProgress = rows.filter((r) => r?.status === "in_progress").length;
        const notStarted = Math.max(0, applicable.length - completed - inProgress);
        const pct = applicable.length ? Math.round((completed / applicable.length) * 100) : 0;
        return { training: t, completed, inProgress, notStarted, pct };
      }),
    [trainings, teamMembers, completions],
  );

  const byPerson = useMemo(
    () =>
      teamMembers.map((member) => {
        const rows = trainings.filter((t) => appliesToMember(t, member)).map((t) => ({ training: t, completion: getCompletion(t.id, member) }));
        const completed = rows.filter((r) => r.completion?.status === "completed").length;
        const inProgress = rows.filter((r) => r.completion?.status === "in_progress").length;
        const pct = rows.length ? Math.round((completed / rows.length) * 100) : 0;
        return { member, completed, inProgress, total: rows.length, pct };
      }),
    [teamMembers, trainings, completions],
  );

  const myRows = useMemo(() => {
    if (!identity?.name) return [] as Array<{ training: UpcomingTraining; completion: TrainingCompletion | null }>;
    return visibleTrainings.map((t) => ({ training: t, completion: getCompletion(t.id, identity.name!) }));
  }, [visibleTrainings, completions, identity?.name]);

  const completedCount = myRows.filter((r) => r.completion?.status === "completed").length;
  const inProgressCount = myRows.filter((r) => r.completion?.status === "in_progress").length;

  const nearDueItems = useMemo(() => {
    if (isManager) return [] as Array<{ training: UpcomingTraining; completion: TrainingCompletion | null; days: number }>;
    return myRows
      .map((r) => {
        const due = r.completion?.target_date ?? r.training.training_date;
        return { training: r.training, completion: r.completion, days: daysTo(due) };
      })
      .filter((x) => x.days !== null && (x.completion?.status ?? "not_started") !== "completed" && (x.days as number) >= 0 && (x.days as number) <= 7)
      .map((x) => ({ ...x, days: x.days as number }));
  }, [isManager, myRows]);

  async function createTraining() {
    if (!title.trim() || !description.trim() || !certDate) return;
    setCreating(true);
    try {
      const res = await fetch("/api/upcoming_trainings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          training_date: toIsoDate(certDate),
          audience: assignee ? "all" : (audience ?? "all"),
          assignee: assignee ?? undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to assign training");
      setTitle("");
      setDescription("");
      setCertDate(null);
      setAudience("all");
      setAssignee(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function createSelfTraining() {
    if (!selfTitle.trim() || !selfDescription.trim() || !selfDate) return;
    setSelfCreating(true);
    try {
      const res = await fetch("/api/upcoming_trainings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: selfTitle.trim(), description: selfDescription.trim(), training_date: toIsoDate(selfDate), self_start: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to start course");
      setSelfTitle("");
      setSelfDescription("");
      setSelfDate(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSelfCreating(false);
    }
  }

  function openUpdate(training: UpcomingTraining) {
    if (!identity?.name) return;
    const current = getCompletion(training.id, identity.name);
    setUpdating(training);
    setNewStatus((current?.status as TrainingCompletion["status"]) ?? "not_started");
    setProgressPercent(Number(current?.progress_percent ?? (current?.status === "completed" ? 100 : 0)));
    setTargetDate(current?.target_date ? new Date(current.target_date) : null);
    setNote(current?.note ?? "");
  }

  async function quickStatusUpdate(training: UpcomingTraining, status: TrainingCompletion["status"]) {
    if (!identity?.name) return;
    const existing = getCompletion(training.id, identity.name);
    const inferredProgress = status === "completed" ? 100 : status === "in_progress" ? Math.max(Number(existing?.progress_percent ?? 0), 25) : 0;

    const body = {
      status,
      progress_percent: inferredProgress,
      target_date: existing?.target_date ?? training.training_date,
      note: existing?.note ?? null,
    };

    const res = await fetch(existing ? `/api/training_completions/${existing.id}` : "/api/training_completions", {
      method: existing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(existing ? body : { ...body, training_id: training.id }),
    });

    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Failed quick update");
      return;
    }
    await refresh();
  }

  function beginEdit(training: UpcomingTraining) {
    const parsed = parseAudience(training.audience);
    setEditingTraining(training);
    setEditTitle(training.title);
    setEditDescription(training.description);
    setEditDate(training.training_date ? new Date(training.training_date) : null);
    if (parsed.kind === "user") {
      setEditAudience("all");
      setEditAssignee(parsed.value);
    } else {
      setEditAudience(parsed.value || "all");
      setEditAssignee(null);
    }
  }

  async function saveTrainingEdit() {
    if (!editingTraining || !editTitle.trim() || !editDescription.trim() || !editDate) return;
    setEditWorking(true);
    try {
      const res = await fetch(`/api/upcoming_trainings/${editingTraining.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDescription.trim(),
          training_date: toIsoDate(editDate),
          audience: editAssignee ? "all" : (editAudience ?? "all"),
          assignee: editAssignee ?? undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update training");
      setEditingTraining(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditWorking(false);
    }
  }

  async function deleteTraining(id: number) {
    try {
      const res = await fetch(`/api/upcoming_trainings/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to delete training");
      setDeletingTraining(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveUpdate() {
    if (!updating || !identity?.name) return;
    setSaving(true);
    try {
      const existing = getCompletion(updating.id, identity.name);
      const body = {
        status: newStatus,
        progress_percent: newStatus === "completed" ? 100 : progressPercent,
        target_date: toIsoDate(targetDate) || null,
        note: note.trim() || null,
      };
      const res = await fetch(existing ? `/api/training_completions/${existing.id}` : "/api/training_completions", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(existing ? body : { ...body, training_id: updating.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save progress");
      setUpdating(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function loadThread(training: UpcomingTraining) {
    setThreadTraining(training);
    setThreadLoading(true);
    setThreadMessage("");
    try {
      const res = await fetch(`/api/training_comments?training_id=${training.id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load comments");
      setThreadComments((json.comments ?? []) as TrainingComment[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setThreadComments([]);
    } finally {
      setThreadLoading(false);
    }
  }

  async function postThreadComment() {
    if (!threadTraining || !threadMessage.trim()) return;
    setThreadPosting(true);
    try {
      const res = await fetch("/api/training_comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ training_id: threadTraining.id, message: threadMessage.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to post comment");
      setThreadMessage("");
      await loadThread(threadTraining);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setThreadPosting(false);
    }
  }

  return (
    <WidgetFrame
      title="Training Hub"
      subtitle={isManager ? "Assign certifications and track team completion" : "Start your own courses and update progress"}
      icon={IconSchool}
      iconColor="blue"
      loading={loading}
      onRefresh={refresh}
      status={{
        label: isManager ? `${trainings.length} active trainings` : `${completedCount}/${myRows.length} completed`,
        color: completedCount === myRows.length && myRows.length > 0 ? "green" : "blue",
      }}
    >
      <Stack gap="lg">
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            {error}
          </Alert>
        )}

        {!isManager && nearDueItems.length > 0 ? (
          <Alert color="yellow" variant="light" title="Weekly reminder">
            You have {nearDueItems.length} training item(s) due in the next 7 days.
          </Alert>
        ) : null}

        {isManager ? (
          <Tabs defaultValue="assign">
            <Tabs.List>
              <Tabs.Tab value="assign" leftSection={<IconPlus size={14} />}>Push Training</Tabs.Tab>
              <Tabs.Tab value="certs" leftSection={<IconTargetArrow size={14} />}>By Certification</Tabs.Tab>
              <Tabs.Tab value="members" leftSection={<IconUsers size={14} />}>By Member</Tabs.Tab>
              <Tabs.Tab value="completed" leftSection={<IconSchool size={14} />}>Completed Certifications</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="assign" pt="md">
              <Card withBorder radius="lg" p="md">
                <Stack gap="sm">
                  <Text fw={700}>Push training / certification to team</Text>
                  <SimpleGrid cols={{ base: 1, md: 2 }}>
                    <TextInput label="Training / Certification" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
                    <DateInput label="Due / target date" value={certDate} onChange={setCertDate} />
                    <Select
                      label="Audience"
                      value={assignee ? "specific" : audience}
                      onChange={setAudience}
                      data={[{ value: "all", label: "All non-managers" }, { value: "tier1", label: "Tier 1" }, { value: "tier2", label: "Tier 2" }, { value: "specific", label: "Specific member" }]}
                    />
                    <Select label="Specific member" value={assignee} onChange={setAssignee} disabled={audience !== "specific"} data={teamMembers.map((m) => ({ value: m, label: m }))} />
                  </SimpleGrid>
                  <Textarea label="Description" minRows={2} value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
                  <Group justify="flex-end">
                    <Button leftSection={<IconPlus size={14} />} onClick={() => void createTraining()} loading={creating}>Push training</Button>
                  </Group>
                </Stack>
              </Card>
            </Tabs.Panel>

            <Tabs.Panel value="certs" pt="md">
              <Stack gap="sm">
                {certStats.map((row) => (
                  <Card key={row.training.id} withBorder radius="lg" p="md">
                    <Stack gap={6}>
                      <Group justify="space-between" align="flex-start" wrap="nowrap">
                        <div>
                          <Text fw={700}>{row.training.title}</Text>
                          <Text size="xs" c="dimmed">{row.training.description}</Text>
                        </div>
                        <Group gap={6}>
                          <Badge variant="light" color="blue">{row.pct}% complete</Badge>
                          <Button size="xs" variant="subtle" color="gray" leftSection={<IconMessageCircle size={12} />} onClick={() => void loadThread(row.training)}>Thread</Button>
                          <Button size="xs" variant="subtle" color="blue" leftSection={<IconEdit size={12} />} onClick={() => beginEdit(row.training)}>Edit</Button>
                          <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={12} />} onClick={() => setDeletingTraining(row.training)}>Delete</Button>
                        </Group>
                      </Group>
                      <Progress value={row.pct} color="blue" />
                      <Group gap="xs">
                        <Badge color="green" variant="light">{row.completed} completed</Badge>
                        <Badge color="blue" variant="light">{row.inProgress} in progress</Badge>
                        <Badge color="gray" variant="light">{row.notStarted} not started</Badge>
                      </Group>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="members" pt="md">
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Member</Table.Th>
                    <Table.Th>Completed</Table.Th>
                    <Table.Th>In progress</Table.Th>
                    <Table.Th>Total assigned</Table.Th>
                    <Table.Th>Progress</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {byPerson.map((p) => (
                    <Table.Tr key={p.member}>
                      <Table.Td>{p.member}</Table.Td>
                      <Table.Td>{p.completed}</Table.Td>
                      <Table.Td>{p.inProgress}</Table.Td>
                      <Table.Td>{p.total}</Table.Td>
                      <Table.Td style={{ minWidth: 180 }}><Progress value={p.pct} /></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Tabs.Panel>

            <Tabs.Panel value="completed" pt="md">
              <Card withBorder radius="lg" p="md">
                <Table striped withTableBorder withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Certification</Table.Th>
                      <Table.Th>Logo/Badge</Table.Th>
                      <Table.Th>Certified Individuals</Table.Th>
                      <Table.Th>Status</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {CERTIFICATION_REGISTRY.map((row) => (
                      <Table.Tr key={row.certification}>
                        <Table.Td><Text fw={700}>{row.certification}</Text></Table.Td>
                        <Table.Td><Badge variant="outline" color="blue">{row.badge}</Badge></Table.Td>
                        <Table.Td>
                          <Stack gap={4}>
                            {row.individuals.map((name) => (
                              <Text key={name} size="sm">{name}</Text>
                            ))}
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Badge color={row.status === "Active" ? "green" : "yellow"} variant="light">
                            {row.status === "Active" ? "✅ Active" : "⚠️ Expired"}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Card>
            </Tabs.Panel>
          </Tabs>
        ) : (
          <Tabs defaultValue="my">
            <Tabs.List>
              <Tabs.Tab value="my" leftSection={<IconUsers size={14} />}>My Progress</Tabs.Tab>
              <Tabs.Tab value="completed" leftSection={<IconSchool size={14} />}>Completed Certifications</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="my" pt="md">
              <Stack gap="md">
                <Card withBorder radius="lg" p="md">
                  <Stack gap="sm">
                    <Group gap="xs">
                      <ThemeIcon variant="light" color="blue"><IconPlus size={16} /></ThemeIcon>
                      <Text fw={700}>Start your own training / certification</Text>
                    </Group>
                    <SimpleGrid cols={{ base: 1, md: 2 }}>
                      <TextInput label="Course / Certification" value={selfTitle} onChange={(e) => setSelfTitle(e.currentTarget.value)} />
                      <DateInput label="Target completion date" value={selfDate} onChange={setSelfDate} />
                    </SimpleGrid>
                    <Textarea label="Description" minRows={2} value={selfDescription} onChange={(e) => setSelfDescription(e.currentTarget.value)} />
                    <Group justify="flex-end">
                      <Button leftSection={<IconPlus size={14} />} onClick={() => void createSelfTraining()} loading={selfCreating}>Start course</Button>
                    </Group>
                  </Stack>
                </Card>

                <Card withBorder radius="lg" p="md">
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text fw={700}>My training progress</Text>
                      <Group gap="xs">
                        <Badge color="green" variant="light">{completedCount} completed</Badge>
                        <Badge color="blue" variant="light">{inProgressCount} in progress</Badge>
                      </Group>
                    </Group>

                    {myRows.length === 0 ? (
                      <Text size="sm" c="dimmed">No trainings assigned yet. Start one above or wait for manager assignment.</Text>
                    ) : (
                      myRows.map((row) => {
                        const status = row.completion?.status ?? "not_started";
                        const meta = STATUS_META[status];
                        const progress = Math.round(Number(row.completion?.progress_percent ?? (status === "completed" ? 100 : 0)));
                        return (
                          <Card key={row.training.id} withBorder radius="md" p="sm">
                            <Group justify="space-between" align="flex-start">
                              <Stack gap={4} style={{ flex: 1 }}>
                                <Text fw={600}>{row.training.title}</Text>
                                <Text size="xs" c="dimmed">{row.training.description}</Text>
                                <Text size="xs" c="dimmed">Last updated by me: {formatAgo(row.completion?.updated_at ?? row.completion?.created_at ?? null)}</Text>

                                <Group gap="xs">
                                  <Badge size="xs" variant="light" color={meta.color}>{meta.label}</Badge>
                                  <Badge size="xs" variant="light" color="blue">Progress: {progress}%</Badge>
                                  <Badge size="xs" variant="light" color="grape">Target: {row.completion?.target_date ?? row.training.training_date ?? "—"}</Badge>
                                </Group>

                                <Progress value={progress} color={meta.color} size="sm" />

                                <Group gap={6}>
                                  <Button size="xs" variant="subtle" onClick={() => void quickStatusUpdate(row.training, "not_started")}>Start</Button>
                                  <Button size="xs" variant="subtle" onClick={() => void quickStatusUpdate(row.training, "in_progress")}>In Progress</Button>
                                  <Button size="xs" color="green" variant="light" onClick={() => void quickStatusUpdate(row.training, "completed")}>Completed</Button>
                                  <Button size="xs" variant="subtle" color="gray" leftSection={<IconMessageCircle size={12} />} onClick={() => void loadThread(row.training)}>Thread</Button>
                                </Group>

                                {row.completion?.note ? <Text size="xs" c="dimmed">Comment: {row.completion.note}</Text> : null}
                              </Stack>

                              <Button size="xs" variant="light" onClick={() => openUpdate(row.training)}>Update</Button>
                            </Group>
                          </Card>
                        );
                      })
                    )}
                  </Stack>
                </Card>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="completed" pt="md">
              <Card withBorder radius="lg" p="md">
                <Table striped withTableBorder withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Certification</Table.Th>
                      <Table.Th>Logo/Badge</Table.Th>
                      <Table.Th>Certified Individuals</Table.Th>
                      <Table.Th>Status</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {CERTIFICATION_REGISTRY.map((row) => (
                      <Table.Tr key={row.certification}>
                        <Table.Td><Text fw={700}>{row.certification}</Text></Table.Td>
                        <Table.Td><Badge variant="outline" color="blue">{row.badge}</Badge></Table.Td>
                        <Table.Td>
                          <Stack gap={4}>
                            {row.individuals.map((name) => (
                              <Text key={name} size="sm">{name}</Text>
                            ))}
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Badge color={row.status === "Active" ? "green" : "yellow"} variant="light">
                            {row.status === "Active" ? "✅ Active" : "⚠️ Expired"}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Card>
            </Tabs.Panel>
          </Tabs>
        )}

        <Modal opened={Boolean(editingTraining)} onClose={() => setEditingTraining(null)} title="Edit training / certification" centered>
          <Stack>
            <TextInput label="Title" value={editTitle} onChange={(e) => setEditTitle(e.currentTarget.value)} />
            <Textarea label="Description" value={editDescription} onChange={(e) => setEditDescription(e.currentTarget.value)} autosize minRows={2} />
            <DateInput label="Due date" value={editDate} onChange={setEditDate} valueFormat="YYYY-MM-DD" />
            <Select label="Audience" value={editAudience} onChange={setEditAudience} data={[{ value: "all", label: "All non-managers" }, { value: "tier1", label: "Tier 1" }, { value: "tier2", label: "Tier 2" }, { value: "tier3", label: "Tier 3" }]} disabled={Boolean(editAssignee)} />
            <Select label="Or assign to specific non-manager" clearable value={editAssignee} onChange={setEditAssignee} data={teamMembers.map((n) => ({ value: n, label: n }))} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEditingTraining(null)}>Cancel</Button>
              <Button color="blue" loading={editWorking} onClick={() => void saveTrainingEdit()}>Save changes</Button>
            </Group>
          </Stack>
        </Modal>

        <Modal opened={Boolean(updating)} onClose={() => setUpdating(null)} title={updating ? `Update progress · ${updating.title}` : "Update progress"}>
          <Stack>
            <Select
              label="Status"
              value={newStatus}
              onChange={(v) => setNewStatus((v as TrainingCompletion["status"]) ?? "not_started")}
              data={[{ value: "not_started", label: "Not started" }, { value: "in_progress", label: "In progress" }, { value: "completed", label: "Completed" }]}
            />
            <NumberInput label="Progress (%)" min={0} max={100} value={progressPercent} onChange={(v) => setProgressPercent(typeof v === "number" ? v : 0)} disabled={newStatus === "completed"} />
            <DateInput label="Target completion date" value={targetDate} onChange={setTargetDate} />
            <Textarea label="Comments" minRows={3} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setUpdating(null)}>Cancel</Button>
              <Button leftSection={<IconCheck size={14} />} onClick={() => void saveUpdate()} loading={saving}>Save update</Button>
            </Group>
          </Stack>
        </Modal>

        <Modal opened={Boolean(deletingTraining)} onClose={() => setDeletingTraining(null)} title="Confirm delete" centered>
          <Stack gap="md">
            <Text size="sm">Are you sure you want to delete <b>{deletingTraining?.title}</b>? This will remove it for assigned members.</Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDeletingTraining(null)}>Cancel</Button>
              <Button color="red" leftSection={<IconTrash size={14} />} onClick={() => deletingTraining && void deleteTraining(deletingTraining.id)}>Delete training</Button>
            </Group>
          </Stack>
        </Modal>

        <Modal opened={Boolean(threadTraining)} onClose={() => setThreadTraining(null)} title={threadTraining ? `Coaching thread · ${threadTraining.title}` : "Coaching thread"} centered>
          <Stack gap="sm">
            {threadLoading ? (
              <Text size="sm" c="dimmed">Loading conversation…</Text>
            ) : threadComments.length === 0 ? (
              <Text size="sm" c="dimmed">No comments yet. Start the coaching thread.</Text>
            ) : (
              <Stack gap="xs" mah={280} style={{ overflowY: "auto" }}>
                {threadComments.map((c) => (
                  <Card key={c.id} withBorder radius="md" p="xs">
                    <Group justify="space-between" mb={4}>
                      <Text size="xs" fw={700}>{c.author_name}</Text>
                      <Text size="xs" c="dimmed">{new Date(c.created_at).toLocaleString()}</Text>
                    </Group>
                    <Text size="sm">{c.message}</Text>
                  </Card>
                ))}
              </Stack>
            )}
            <Textarea label={isManager ? "Reply to member" : "Update for manager"} minRows={3} value={threadMessage} onChange={(e) => setThreadMessage(e.currentTarget.value)} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setThreadTraining(null)}>Close</Button>
              <Button leftSection={<IconMessageCircle size={14} />} onClick={() => void postThreadComment()} loading={threadPosting}>Post message</Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </WidgetFrame>
  );
}
