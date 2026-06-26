import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Modal,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBulb,
  IconCheck,
  IconClipboardList,
  IconEdit,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUserCheck,
} from "@tabler/icons-react";
import { db } from "../../db";
import { useIdentity } from "../../lib/identity";
import { WidgetFrame } from "../WidgetFrame";
import { WidgetTile } from "../WidgetTile";

type Enhancement = Awaited<ReturnType<typeof db.enhancements.list>>[number];
type EnhancementStatus = "pending" | "approved" | "in_progress" | "completed" | "rejected";

type EnhancementPlatform = "ipath" | "noc_dashboard";

type FormState = {
  legacy_id: string;
  title: string;
  description: string;
  platform: EnhancementPlatform;
  category: string;
  priority: string;
  status: EnhancementStatus;
  manager_notes: string;
  target_quarter: string;
};

const PLATFORM_OPTIONS = [
  { value: "ipath", label: "iPath enhancements" },
  { value: "noc_dashboard", label: "NOC Dashboard" },
];

const CATEGORY_OPTIONS = [
  { value: "workflow", label: "Workflow" },
  { value: "automation", label: "Automation" },
  { value: "reporting", label: "Reporting" },
  { value: "ui", label: "UI / UX" },
  { value: "integration", label: "Integration" },
  { value: "other", label: "Other" },
];

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const STATUS_OPTIONS: Array<{ value: EnhancementStatus; label: string; color: string }> = [
  { value: "pending", label: "Pending review", color: "yellow" },
  { value: "approved", label: "Approved", color: "green" },
  { value: "in_progress", label: "In progress", color: "blue" },
  { value: "completed", label: "Completed", color: "teal" },
  { value: "rejected", label: "Rejected", color: "red" },
];

const EMPTY_FORM: FormState = {
  legacy_id: "",
  title: "",
  description: "",
  platform: "noc_dashboard",
  category: "workflow",
  priority: "medium",
  status: "pending",
  manager_notes: "",
  target_quarter: "",
};

function statusMeta(status: string | null | undefined) {
  return STATUS_OPTIONS.find((item) => item.value === status) ?? STATUS_OPTIONS[0];
}

function platformLabel(platform: string | null | undefined) {
  return PLATFORM_OPTIONS.find((item) => item.value === platform)?.label ?? "NOC Dashboard";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong";
}

export function EnhancementsWidget() {
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";

  const [rows, setRows] = useState<Enhancement[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Enhancement | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [platformTab, setPlatformTab] = useState<EnhancementPlatform>("noc_dashboard");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [managerView, setManagerView] = useState<"all" | "pending">("all");
  const [importingBaseline, setImportingBaseline] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await db.enhancements.list({ orderBy: { column: "created_at", ascending: false } });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const pendingCount = useMemo(() => rows.filter((row) => row.status === "pending").length, [rows]);
  const approvedCount = useMemo(() => rows.filter((row) => row.status === "approved").length, [rows]);
  const completedCount = useMemo(() => rows.filter((row) => row.status === "completed").length, [rows]);
  const ipathCount = useMemo(() => rows.filter((row) => row.platform === "ipath").length, [rows]);
  const nocDashboardCount = useMemo(() => rows.filter((row) => row.platform === "noc_dashboard").length, [rows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesManagerView = !isManager || managerView === "all" || row.status === "pending";
      const matchesStatus = statusFilter === "all" || row.status === statusFilter;
      const matchesPlatform = row.platform === platformTab;
      const matchesCategory = categoryFilter === "all" || row.category === categoryFilter;
      const matchesPriority = priorityFilter === "all" || row.priority === priorityFilter;
      const haystack = [
        row.legacy_id,
        row.title,
        row.description,
        row.submitted_by_name,
        row.submitted_by_email,
        row.manager_notes,
        row.target_quarter,
        row.category,
        row.priority,
        row.platform,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = !query || haystack.includes(query);

      return matchesManagerView && matchesStatus && matchesPlatform && matchesCategory && matchesPriority && matchesSearch;
    });
  }, [rows, search, statusFilter, platformTab, categoryFilter, priorityFilter, isManager, managerView]);

  function openSubmitModal() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEditModal(row: Enhancement) {
    setEditing(row);
    setForm({
      legacy_id: row.legacy_id ?? "",
      title: row.title ?? "",
      description: row.description ?? "",
      platform: (row.platform as EnhancementPlatform) ?? "noc_dashboard",
      category: row.category ?? "workflow",
      priority: row.priority ?? "medium",
      status: (row.status as EnhancementStatus) ?? "pending",
      manager_notes: row.manager_notes ?? "",
      target_quarter: row.target_quarter ?? "",
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function submitForm() {
    if (!identity?.name) {
      setError("Sign in before submitting an enhancement.");
      return;
    }
    if (!form.title.trim() || !form.description.trim()) {
      setError("Title and description are required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await db.enhancements.updateById(editing.id, {
          legacy_id: form.legacy_id.trim() || null,
          title: form.title.trim(),
          description: form.description.trim(),
          platform: form.platform,
          category: form.category,
          priority: form.priority,
          status: form.status,
          manager_notes: form.manager_notes.trim() || null,
          target_quarter: form.target_quarter.trim() || null,
        });
      } else {
        await db.enhancements.insert({
          legacy_id: form.legacy_id.trim() || null,
          title: form.title.trim(),
          description: form.description.trim(),
          platform: form.platform,
          category: form.category,
          priority: form.priority,
          target_quarter: form.target_quarter.trim() || null,
        });
      }
      closeModal();
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function approve(row: Enhancement) {
    setSaving(true);
    setError(null);
    try {
      await db.enhancements.updateById(row.id, {
        status: "approved",
        manager_notes: row.manager_notes ?? null,
      });
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: Enhancement) {
    setSaving(true);
    setError(null);
    try {
      await db.enhancements.deleteById(row.id);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function importIPathBaseline() {
    setImportingBaseline(true);
    setError(null);
    try {
      const response = await fetch("/api/enhancements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "seed_ipath_baseline" }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Failed to import iPath enhancements.");
      }

      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setImportingBaseline(false);
    }
  }

  return (
    <WidgetFrame
      title="Enhancement Tracker"
      subtitle={isManager ? "Manage, approve, and update enhancement requests" : "View all enhancements and submit new ideas"}
      icon={IconBulb}
      iconColor="yellow"
      onRefresh={load}
      loading={loading}
      status={isManager ? { label: pendingCount > 0 ? `${pendingCount} pending` : "Manager mode", color: pendingCount > 0 ? "yellow" : "green" } : { label: "Team view", color: "blue" }}
    >
      <Stack gap="lg" p="md">
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            {error}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <StatCard label="Pending" value={pendingCount} color="yellow" />
          <StatCard label="Approved" value={approvedCount} color="green" />
          <StatCard label="Completed" value={completedCount} color="teal" />
        </SimpleGrid>

        <Card withBorder radius="lg" p="lg">
          <Stack gap="md">
            <Group justify="space-between" align="flex-start">
              <Stack gap={4}>
                <Text fw={700}>Enhancement backlog</Text>
                <Text size="sm" c="dimmed">
                  Track ideas across iPath enhancements and the NOC Dashboard. Non-managers can submit and view all requests. Managers can edit every field and approve requests.
                </Text>
              </Stack>
              <Group gap="sm">
                {isManager && platformTab === "ipath" && (
                  <Button
                    variant="default"
                    onClick={() => void importIPathBaseline()}
                    loading={importingBaseline}
                  >
                    Import existing iPath list
                  </Button>
                )}
                <Button leftSection={<IconPlus size={16} />} color="yellow" onClick={openSubmitModal}>
                  Submit enhancement
                </Button>
              </Group>
            </Group>

            {isManager && (
              <SegmentedControl
                value={managerView}
                onChange={(value) => setManagerView(value as "all" | "pending")}
                data={[
                  { label: `All enhancements (${rows.length})`, value: "all" },
                  { label: `My pending approvals (${pendingCount})`, value: "pending" },
                ]}
              />
            )}

            <Tabs value={platformTab} onChange={(value) => value && setPlatformTab(value as EnhancementPlatform)}>
              <Tabs.List>
                <Tabs.Tab value="ipath">iPath enhancements ({ipathCount})</Tabs.Tab>
                <Tabs.Tab value="noc_dashboard">NOC Dashboard ({nocDashboardCount})</Tabs.Tab>
              </Tabs.List>
            </Tabs>

            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput
                  label="Search"
                  placeholder="Search legacy ID, title, notes, submitter, or description"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  leftSection={<IconSearch size={16} />}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4, md: 2 }}>
                <Select
                  label="Status"
                  value={statusFilter}
                  onChange={(value) => setStatusFilter(value || "all")}
                  data={[{ value: "all", label: "All statuses" }, ...STATUS_OPTIONS.map((item) => ({ value: item.value, label: item.label }))]}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4, md: 2 }}>
                <Select
                  label="Category"
                  value={categoryFilter}
                  onChange={(value) => setCategoryFilter(value || "all")}
                  data={[{ value: "all", label: "All categories" }, ...CATEGORY_OPTIONS]}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4, md: 2 }}>
                <Select
                  label="Priority"
                  value={priorityFilter}
                  onChange={(value) => setPriorityFilter(value || "all")}
                  data={[{ value: "all", label: "All priorities" }, ...PRIORITY_OPTIONS]}
                />
              </Grid.Col>
            </Grid>
          </Stack>
        </Card>

        {rows.length === 0 && !loading ? (
          <Card withBorder radius="lg" p="xl">
            <Stack align="center" gap="sm">
              <ThemeIcon size={48} radius="xl" color="yellow" variant="light">
                <IconClipboardList size={26} />
              </ThemeIcon>
              <Text fw={700}>No enhancements yet</Text>
              <Text c="dimmed" size="sm" ta="center">
                Start the backlog by submitting the first workflow, automation, or UI improvement request.
              </Text>
              <Button color="yellow" leftSection={<IconPlus size={16} />} onClick={openSubmitModal}>
                Create first enhancement
              </Button>
            </Stack>
          </Card>
        ) : filteredRows.length === 0 ? (
          <Card withBorder radius="lg" p="xl">
            <Stack align="center" gap="sm">
              <ThemeIcon size={48} radius="xl" color="yellow" variant="light">
                <IconClipboardList size={26} />
              </ThemeIcon>
              <Text fw={700}>No matching enhancements</Text>
              <Text c="dimmed" size="sm" ta="center">
                Try adjusting the search term or filters to find enhancements across iPath and the NOC Dashboard, including legacy request IDs.
              </Text>
            </Stack>
          </Card>
        ) : (
          <Card withBorder radius="lg" p={0}>
            <Table.ScrollContainer minWidth={1100}>
              <Table highlightOnHover verticalSpacing="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Legacy ID</Table.Th>
                    <Table.Th>Title</Table.Th>
                    <Table.Th>Platform</Table.Th>
                    <Table.Th>Category</Table.Th>
                    <Table.Th>Priority</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Submitted by</Table.Th>
                    <Table.Th>Target</Table.Th>
                    <Table.Th>Manager notes</Table.Th>
                    <Table.Th>Approved by</Table.Th>
                    {isManager && <Table.Th style={{ width: 160 }}>Actions</Table.Th>}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredRows.map((row) => {
                    const meta = statusMeta(row.status);
                    return (
                      <Table.Tr key={row.id}>
                        <Table.Td>
                          {row.legacy_id ? (
                            <Badge variant="light" color="gray">#{row.legacy_id}</Badge>
                          ) : (
                            <Text size="sm" c="dimmed">—</Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text fw={600}>{row.title}</Text>
                            <Text size="sm" c="dimmed" lineClamp={2}>{row.description}</Text>
                            <Text size="xs" c="dimmed">Created {formatDate(String(row.created_at ?? ""))}</Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Badge color="violet" variant="light">{platformLabel(row.platform)}</Badge>
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="light">{row.category}</Badge>
                        </Table.Td>
                        <Table.Td>
                          <Badge color={row.priority === "critical" ? "red" : row.priority === "high" ? "orange" : row.priority === "medium" ? "yellow" : "gray"} variant="light">
                            {row.priority}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Badge color={meta.color} variant="light">{meta.label}</Badge>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text size="sm">{row.submitted_by_name}</Text>
                            <Text size="xs" c="dimmed">{row.submitted_by_email || "No email"}</Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td>{row.target_quarter || "—"}</Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed" lineClamp={2}>{row.manager_notes || "—"}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text size="sm">{row.approved_by_name || "—"}</Text>
                            <Text size="xs" c="dimmed">{formatDate(row.approved_at)}</Text>
                          </Stack>
                        </Table.Td>
                        {isManager && (
                          <Table.Td>
                            <Group gap={6} wrap="nowrap">
                              {row.status === "pending" && (
                                <ActionIcon color="green" variant="light" onClick={() => void approve(row)} disabled={saving}>
                                  <IconUserCheck size={16} />
                                </ActionIcon>
                              )}
                              <ActionIcon color="blue" variant="light" onClick={() => openEditModal(row)}>
                                <IconEdit size={16} />
                              </ActionIcon>
                              <ActionIcon color="red" variant="light" onClick={() => void remove(row)} disabled={saving}>
                                <IconTrash size={16} />
                              </ActionIcon>
                            </Group>
                          </Table.Td>
                        )}
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        )}
      </Stack>

      <Modal
        opened={modalOpen}
        onClose={closeModal}
        title={editing ? "Edit enhancement" : "Submit enhancement"}
        centered
        radius="lg"
        size="lg"
      >
        <Stack gap="md">
          <TextInput
            label="Legacy ID"
            placeholder="Optional, e.g. 19396"
            value={form.legacy_id}
            onChange={(event) => setForm((prev) => ({ ...prev, legacy_id: event.currentTarget.value.replace(/[^0-9-]/g, "") }))}
          />
          <TextInput
            label="Title"
            placeholder="Short, clear title"
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.currentTarget.value }))}
            required
          />
          <Textarea
            label="Description"
            placeholder="Describe the problem, expected improvement, and why it matters"
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.currentTarget.value }))}
            minRows={4}
            required
          />
          <Grid>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Select
                label="Platform"
                data={PLATFORM_OPTIONS}
                value={form.platform}
                onChange={(value) => setForm((prev) => ({ ...prev, platform: (value as EnhancementPlatform) || "noc_dashboard" }))}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Select
                label="Category"
                data={CATEGORY_OPTIONS}
                value={form.category}
                onChange={(value) => setForm((prev) => ({ ...prev, category: value || "workflow" }))}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Select
                label="Priority"
                data={PRIORITY_OPTIONS}
                value={form.priority}
                onChange={(value) => setForm((prev) => ({ ...prev, priority: value || "medium" }))}
              />
            </Grid.Col>
          </Grid>
          <TextInput
            label="Target quarter"
            placeholder="Optional, e.g. 2026-Q3"
            value={form.target_quarter}
            onChange={(event) => setForm((prev) => ({ ...prev, target_quarter: event.currentTarget.value }))}
          />
          {isManager && editing && (
            <>
              <Select
                label="Status"
                data={STATUS_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                value={form.status}
                onChange={(value) => setForm((prev) => ({ ...prev, status: (value as EnhancementStatus) || "pending" }))}
              />
              <Textarea
                label="Manager notes"
                placeholder="Approval notes, implementation guidance, blockers, etc."
                value={form.manager_notes}
                onChange={(event) => setForm((prev) => ({ ...prev, manager_notes: event.currentTarget.value }))}
                minRows={3}
              />
            </>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeModal}>Cancel</Button>
            <Button color="yellow" leftSection={editing ? <IconCheck size={16} /> : <IconPlus size={16} />} onClick={() => void submitForm()} loading={saving}>
              {editing ? "Save changes" : "Submit"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </WidgetFrame>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap={4}>
        <Text size="sm" c="dimmed">{label}</Text>
        <Group gap="sm" align="center">
          <ThemeIcon color={color} variant="light" radius="md">
            <IconBulb size={16} />
          </ThemeIcon>
          <Text fw={800} size="xl">{value}</Text>
        </Group>
      </Stack>
    </Card>
  );
}

export function EnhancementsTile({ onExpand }: { onExpand: () => void }) {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    db.enhancements
      .list({ orderBy: { column: "created_at", ascending: false } })
      .then((rows) => setPending(rows.filter((row) => row.status === "pending").length))
      .catch(() => setPending(0));
  }, []);

  return (
    <WidgetTile
      title="Enhancement Tracker"
      description="Submit, review, and manage product enhancements"
      icon={IconBulb}
      iconColor="yellow"
      onExpand={onExpand}
      status={{ label: pending > 0 ? `${pending} pending` : "Ready", color: pending > 0 ? "yellow" : "green" }}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Text size="sm" c="dimmed">
          Team members can submit ideas and view the full backlog. Managers can approve, edit, and update enhancement status.
        </Text>
      </Stack>
    </WidgetTile>
  );
}
