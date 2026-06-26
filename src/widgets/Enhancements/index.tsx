import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
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
  IconArrowUpRight,
  IconBulb,
  IconCheck,
  IconClipboardList,
  IconClock,
  IconDownload,
  IconEdit,
  IconHistory,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUserCheck,
} from "@tabler/icons-react";
import { db } from "../../db";
import { api } from "../../lib/api";
import { downloadBlob } from "../../lib/download";
import { useIdentity } from "../../lib/identity";
import { WidgetFrame } from "../WidgetFrame";
import { WidgetTile } from "../WidgetTile";

type Enhancement = Awaited<ReturnType<typeof db.enhancements.list>>[number];
type EnhancementStatus = "pending" | "approved" | "in_progress" | "completed" | "rejected";
type EnhancementPlatform = "ipath" | "noc_dashboard";
type QuickView = "all_open" | "actionable" | "pending" | "approved" | "in_progress" | "completed";
type SortOption = "newest" | "oldest" | "priority" | "status" | "legacy_id";

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
  assignee_name: string;
  assignee_email: string;
  update_note: string;
};

type UpdateEntry = {
  id?: string;
  type?: string;
  actor_name?: string;
  summary?: string;
  created_at?: string;
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

const QUICK_VIEWS: Array<{ value: QuickView; label: string }> = [
  { value: "all_open", label: "All open" },
  { value: "actionable", label: "Actionable" },
  { value: "pending", label: "Pending review" },
  { value: "approved", label: "Approved" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
];

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "priority", label: "Priority" },
  { value: "status", label: "Status" },
  { value: "legacy_id", label: "Legacy ID" },
];

const EMPTY_FORM: FormState = {
  legacy_id: "",
  title: "",
  description: "",
  platform: "ipath",
  category: "workflow",
  priority: "medium",
  status: "pending",
  manager_notes: "",
  target_quarter: "",
  assignee_name: "",
  assignee_email: "",
  update_note: "",
};

function statusMeta(status: string | null | undefined) {
  return STATUS_OPTIONS.find((item) => item.value === status) ?? STATUS_OPTIONS[0];
}

function platformLabel(platform: string | null | undefined) {
  return PLATFORM_OPTIONS.find((item) => item.value === platform)?.label ?? "NOC Dashboard";
}

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return withTime
    ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : date.toLocaleDateString();
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong";
}

function getInputValue(event: unknown) {
  if (
    event &&
    typeof event === "object" &&
    "currentTarget" in event &&
    event.currentTarget &&
    typeof event.currentTarget === "object" &&
    "value" in event.currentTarget
  ) {
    return String(event.currentTarget.value ?? "");
  }

  return "";
}

function parseUpdates(value: unknown): UpdateEntry[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getAnchorDate(row: Enhancement) {
  return String(row.updated_at ?? row.approved_at ?? row.created_at ?? "");
}

function getAgeInDays(row: Enhancement) {
  const anchor = new Date(getAnchorDate(row));
  if (Number.isNaN(anchor.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - anchor.getTime()) / 86_400_000));
}

function getAgingMeta(days: number) {
  if (days >= 90) return { label: `Stale ${days}d`, color: "red" };
  if (days >= 60) return { label: `${days}d old`, color: "orange" };
  if (days >= 30) return { label: `${days}d aging`, color: "yellow" };
  return null;
}

function priorityRank(priority: string | null | undefined) {
  switch (priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function statusRank(status: string | null | undefined) {
  switch (status) {
    case "pending":
      return 1;
    case "approved":
      return 2;
    case "in_progress":
      return 3;
    case "completed":
      return 4;
    case "rejected":
      return 5;
    default:
      return 99;
  }
}

function normalizeCsv(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function quarterKeyForDate(value: string | null | undefined) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return null;
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()}-Q${quarter}`;
}

function currentQuarterKey() {
  const now = new Date();
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
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
  const [historyRow, setHistoryRow] = useState<Enhancement | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [platformTab, setPlatformTab] = useState<EnhancementPlatform>("ipath");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [managerView, setManagerView] = useState<"all" | "pending">("all");
  const [quickView, setQuickView] = useState<QuickView>("all_open");
  const [sortBy, setSortBy] = useState<SortOption>("priority");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkStatus, setBulkStatus] = useState<string>("");
  const [bulkPriority, setBulkPriority] = useState<string>("");
  const [bulkTargetQuarter, setBulkTargetQuarter] = useState("");
  const [bulkAssigneeName, setBulkAssigneeName] = useState("");
  const [bulkAssigneeEmail, setBulkAssigneeEmail] = useState("");
  const [bulkNote, setBulkNote] = useState("");
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

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => rows.some((row) => row.id === id)));
  }, [rows]);

  const platformRows = useMemo(
    () => rows.filter((row) => row.platform === platformTab),
    [rows, platformTab],
  );

  const kpis = useMemo(() => {
    const currentQuarter = currentQuarterKey();
    return {
      actionable: platformRows.filter((row) => ["approved", "in_progress"].includes(String(row.status))).length,
      pending: platformRows.filter((row) => row.status === "pending").length,
      inProgress: platformRows.filter((row) => row.status === "in_progress").length,
      completedThisQuarter: platformRows.filter(
        (row) => row.status === "completed" && quarterKeyForDate(getAnchorDate(row)) === currentQuarter,
      ).length,
    };
  }, [platformRows]);

  const quickViewCounts = useMemo(() => ({
    all_open: platformRows.filter((row) => row.status !== "completed" && row.status !== "rejected").length,
    actionable: platformRows.filter((row) => ["approved", "in_progress"].includes(String(row.status))).length,
    pending: platformRows.filter((row) => row.status === "pending").length,
    approved: platformRows.filter((row) => row.status === "approved").length,
    in_progress: platformRows.filter((row) => row.status === "in_progress").length,
    completed: platformRows.filter((row) => row.status === "completed").length,
  }), [platformRows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    const nextRows = rows.filter((row) => {
      const matchesManagerView = !isManager || managerView === "all" || row.status === "pending";
      const matchesStatus = statusFilter === "all"
        ? true
        : statusFilter === "open"
          ? row.status !== "completed" && row.status !== "rejected"
          : row.status === statusFilter;
      const matchesPlatform = row.platform === platformTab;
      const matchesCategory = categoryFilter === "all" || row.category === categoryFilter;
      const matchesPriority = priorityFilter === "all" || row.priority === priorityFilter;
      const matchesQuickView = quickView === "all_open"
        ? row.status !== "completed" && row.status !== "rejected"
        : quickView === "actionable"
          ? row.status === "approved" || row.status === "in_progress"
          : row.status === quickView;

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
        row.assignee_name,
        row.assignee_email,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = !query || haystack.includes(query);

      return matchesManagerView && matchesStatus && matchesPlatform && matchesCategory && matchesPriority && matchesQuickView && matchesSearch;
    });

    return [...nextRows].sort((a, b) => {
      switch (sortBy) {
        case "oldest":
          return new Date(String(a.created_at ?? 0)).getTime() - new Date(String(b.created_at ?? 0)).getTime();
        case "priority": {
          const rankDiff = priorityRank(b.priority) - priorityRank(a.priority);
          if (rankDiff !== 0) return rankDiff;
          return new Date(getAnchorDate(b)).getTime() - new Date(getAnchorDate(a)).getTime();
        }
        case "status": {
          const rankDiff = statusRank(a.status) - statusRank(b.status);
          if (rankDiff !== 0) return rankDiff;
          return priorityRank(b.priority) - priorityRank(a.priority);
        }
        case "legacy_id":
          return String(a.legacy_id ?? "zzzz").localeCompare(String(b.legacy_id ?? "zzzz"), undefined, { numeric: true });
        case "newest":
        default:
          return new Date(getAnchorDate(b)).getTime() - new Date(getAnchorDate(a)).getTime();
      }
    });
  }, [rows, search, statusFilter, platformTab, categoryFilter, priorityFilter, isManager, managerView, quickView, sortBy]);

  function openSubmitModal() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, platform: platformTab });
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
      assignee_name: row.assignee_name ?? "",
      assignee_email: row.assignee_email ?? "",
      update_note: "",
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
        await api.patch(`/api/enhancements/${editing.id}`, {
          legacy_id: form.legacy_id.trim() || null,
          title: form.title.trim(),
          description: form.description.trim(),
          platform: form.platform,
          category: form.category,
          priority: form.priority,
          status: form.status,
          manager_notes: form.manager_notes.trim() || null,
          target_quarter: form.target_quarter.trim() || null,
          assignee_name: form.assignee_name.trim() || null,
          assignee_email: form.assignee_email.trim() || null,
          update_note: form.update_note.trim() || null,
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
      await api.patch(`/api/enhancements/${row.id}`, {
        status: "approved",
        manager_notes: row.manager_notes ?? null,
        assignee_name: row.assignee_name ?? null,
        assignee_email: row.assignee_email ?? null,
        update_note: "Approved from backlog view.",
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

  function toggleSelection(id: number) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  }

  function toggleSelectAllVisible() {
    const visibleIds = filteredRows.map((row) => row.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) => {
      if (allSelected) {
        return prev.filter((id) => !visibleIds.includes(id));
      }
      return Array.from(new Set([...prev, ...visibleIds]));
    });
  }

  async function applyBulkAction() {
    if (!selectedIds.length) {
      setError("Select at least one enhancement for bulk actions.");
      return;
    }

    const patch: Record<string, string> = {};
    if (bulkStatus) patch.status = bulkStatus;
    if (bulkPriority) patch.priority = bulkPriority;
    if (bulkTargetQuarter.trim()) patch.target_quarter = bulkTargetQuarter.trim();
    if (bulkAssigneeName.trim()) patch.assignee_name = bulkAssigneeName.trim();
    if (bulkAssigneeEmail.trim()) patch.assignee_email = bulkAssigneeEmail.trim();

    if (Object.keys(patch).length === 0 && !bulkNote.trim()) {
      setError("Choose at least one bulk field or add a note.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api.post("/api/enhancements", {
        action: "bulk_update",
        ids: selectedIds,
        patch,
        note: bulkNote.trim() || null,
      });
      setSelectedIds([]);
      setBulkStatus("");
      setBulkPriority("");
      setBulkTargetQuarter("");
      setBulkAssigneeName("");
      setBulkAssigneeEmail("");
      setBulkNote("");
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const headers = [
      "legacy_id",
      "title",
      "platform",
      "category",
      "priority",
      "status",
      "submitted_by_name",
      "submitted_by_email",
      "assignee_name",
      "assignee_email",
      "target_quarter",
      "approved_by_name",
      "approved_at",
      "updated_at",
      "created_at",
      "description",
      "manager_notes",
    ];

    const csv = [
      headers.join(","),
      ...filteredRows.map((row) =>
        [
          row.legacy_id,
          row.title,
          row.platform,
          row.category,
          row.priority,
          row.status,
          row.submitted_by_name,
          row.submitted_by_email,
          row.assignee_name,
          row.assignee_email,
          row.target_quarter,
          row.approved_by_name,
          row.approved_at,
          row.updated_at,
          row.created_at,
          row.description,
          row.manager_notes,
        ]
          .map(normalizeCsv)
          .join(","),
      ),
    ].join("\n");

    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `enhancements-${platformTab}.csv`);
  }

  const visibleIds = filteredRows.map((row) => row.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const historyEntries = parseUpdates(historyRow?.updates_json).sort(
    (a, b) => new Date(String(b.created_at ?? 0)).getTime() - new Date(String(a.created_at ?? 0)).getTime(),
  );

  return (
    <WidgetFrame
      title="Enhancement Tracker"
      subtitle={isManager ? "Manage, approve, and update enhancement requests" : "View all enhancements and submit new ideas"}
      icon={IconBulb}
      iconColor="yellow"
      onRefresh={load}
      loading={loading}
      status={isManager ? { label: kpis.pending > 0 ? `${kpis.pending} pending` : "Manager mode", color: kpis.pending > 0 ? "yellow" : "green" } : { label: "Team view", color: "blue" }}
    >
      <Stack gap="lg" p="md">
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            {error}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
          <StatCard label="Actionable" value={kpis.actionable} color="indigo" detail="Approved or in progress" />
          <StatCard label="Pending review" value={kpis.pending} color="yellow" detail="Needs manager triage" />
          <StatCard label="In progress" value={kpis.inProgress} color="blue" detail="Actively moving" />
          <StatCard label="Completed this quarter" value={kpis.completedThisQuarter} color="teal" detail={currentQuarterKey()} />
        </SimpleGrid>

        <Card withBorder radius="lg" p="lg">
          <Stack gap="md">
            <Group justify="space-between" align="flex-start">
              <Stack gap={4}>
                <Text fw={700}>Enhancement backlog</Text>
                <Text size="sm" c="dimmed">
                  Track ideas across iPath enhancements and the NOC Dashboard. Quick views, aging indicators, owner assignment, and history are built in for review meetings and follow-up.
                </Text>
              </Stack>
              <Group gap="sm">
                <Button variant="default" leftSection={<IconDownload size={16} />} onClick={exportCsv}>
                  Export CSV
                </Button>
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
                  { label: `My pending approvals (${rows.filter((row) => row.status === "pending").length})`, value: "pending" },
                ]}
              />
            )}

            <Tabs value={platformTab} onChange={(value) => value && setPlatformTab(value as EnhancementPlatform)}>
              <Tabs.List>
                <Tabs.Tab value="ipath">iPath enhancements ({rows.filter((row) => row.platform === "ipath").length})</Tabs.Tab>
                <Tabs.Tab value="noc_dashboard">NOC Dashboard ({rows.filter((row) => row.platform === "noc_dashboard").length})</Tabs.Tab>
              </Tabs.List>
            </Tabs>

            <Group gap="xs">
              {QUICK_VIEWS.map((view) => (
                <Button
                  key={view.value}
                  variant={quickView === view.value ? "filled" : "light"}
                  color={quickView === view.value ? "yellow" : "gray"}
                  onClick={() => setQuickView(view.value)}
                  size="xs"
                >
                  {view.label} ({quickViewCounts[view.value]})
                </Button>
              ))}
            </Group>

            <Grid>
              <Grid.Col span={{ base: 12, lg: 4 }}>
                <TextInput
                  label="Search"
                  placeholder="Search legacy ID, title, owner, notes, or description"
                  value={search}
                  onChange={(event) => setSearch(getInputValue(event))}
                  leftSection={<IconSearch size={16} />}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6, lg: 2 }}>
                <Select
                  label="Status"
                  value={statusFilter}
                  onChange={(value) => setStatusFilter(value || "open")}
                  data={[
                    { value: "open", label: "Open enhancements" },
                    { value: "all", label: "All statuses" },
                    ...STATUS_OPTIONS.map((item) => ({ value: item.value, label: item.label })),
                  ]}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6, lg: 2 }}>
                <Select
                  label="Category"
                  value={categoryFilter}
                  onChange={(value) => setCategoryFilter(value || "all")}
                  data={[{ value: "all", label: "All categories" }, ...CATEGORY_OPTIONS]}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6, lg: 2 }}>
                <Select
                  label="Priority"
                  value={priorityFilter}
                  onChange={(value) => setPriorityFilter(value || "all")}
                  data={[{ value: "all", label: "All priorities" }, ...PRIORITY_OPTIONS]}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6, lg: 2 }}>
                <Select
                  label="Sort by"
                  value={sortBy}
                  onChange={(value) => setSortBy((value as SortOption) || "priority")}
                  data={SORT_OPTIONS}
                />
              </Grid.Col>
            </Grid>
          </Stack>
        </Card>

        {isManager && selectedIds.length > 0 && (
          <Card withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <div>
                  <Text fw={700}>Bulk actions</Text>
                  <Text size="sm" c="dimmed">Update {selectedIds.length} selected enhancements at once.</Text>
                </div>
                <Button variant="subtle" color="gray" onClick={() => setSelectedIds([])}>
                  Clear selection
                </Button>
              </Group>
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
                  <Select
                    label="Status"
                    placeholder="Leave unchanged"
                    value={bulkStatus}
                    onChange={(value) => setBulkStatus(value || "")}
                    data={STATUS_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                    clearable
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
                  <Select
                    label="Priority"
                    placeholder="Leave unchanged"
                    value={bulkPriority}
                    onChange={(value) => setBulkPriority(value || "")}
                    data={PRIORITY_OPTIONS}
                    clearable
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
                  <TextInput
                    label="Target quarter"
                    placeholder="2026-Q3"
                    value={bulkTargetQuarter}
                    onChange={(event) => setBulkTargetQuarter(getInputValue(event))}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
                  <TextInput
                    label="Assignee"
                    placeholder="Owner name"
                    value={bulkAssigneeName}
                    onChange={(event) => setBulkAssigneeName(getInputValue(event))}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
                  <TextInput
                    label="Assignee email"
                    placeholder="owner@appdirect.com"
                    value={bulkAssigneeEmail}
                    onChange={(event) => setBulkAssigneeEmail(getInputValue(event))}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, lg: 9 }}>
                  <Textarea
                    label="Bulk note"
                    placeholder="Optional update that will be recorded in each item's history"
                    value={bulkNote}
                    onChange={(event) => setBulkNote(getInputValue(event))}
                    minRows={2}
                  />
                </Grid.Col>
              </Grid>
              <Group justify="flex-end">
                <Button color="yellow" onClick={() => void applyBulkAction()} loading={saving}>
                  Apply to selected items
                </Button>
              </Group>
            </Stack>
          </Card>
        )}

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
                Try adjusting the quick view, search term, or filters to find enhancements across iPath and the NOC Dashboard.
              </Text>
            </Stack>
          </Card>
        ) : (
          <Card withBorder radius="lg" p={0}>
            <Table.ScrollContainer minWidth={1450}>
              <Table highlightOnHover verticalSpacing="md">
                <Table.Thead>
                  <Table.Tr>
                    {isManager && (
                      <Table.Th style={{ width: 52 }}>
                        <Checkbox checked={allVisibleSelected} onChange={toggleSelectAllVisible} aria-label="Select all visible enhancements" />
                      </Table.Th>
                    )}
                    <Table.Th style={{ width: 120, minWidth: 120, whiteSpace: "nowrap" }}>Legacy ID</Table.Th>
                    <Table.Th>Title</Table.Th>
                    <Table.Th style={{ minWidth: 110, whiteSpace: "nowrap" }}>Platform</Table.Th>
                    <Table.Th style={{ minWidth: 130, whiteSpace: "nowrap" }}>Category</Table.Th>
                    <Table.Th style={{ minWidth: 100, whiteSpace: "nowrap" }}>Priority</Table.Th>
                    <Table.Th style={{ minWidth: 130, whiteSpace: "nowrap" }}>Status</Table.Th>
                    <Table.Th style={{ minWidth: 120, whiteSpace: "nowrap" }}>Aging</Table.Th>
                    <Table.Th style={{ minWidth: 150 }}>Submitted by</Table.Th>
                    <Table.Th style={{ minWidth: 150 }}>Owner</Table.Th>
                    <Table.Th style={{ minWidth: 90, whiteSpace: "nowrap" }}>Target</Table.Th>
                    <Table.Th style={{ minWidth: 120 }}>Approved by</Table.Th>
                    <Table.Th style={{ minWidth: 90, whiteSpace: "nowrap" }}>Updates</Table.Th>
                    {isManager && <Table.Th style={{ width: 160 }}>Actions</Table.Th>}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredRows.map((row) => {
                    const meta = statusMeta(row.status);
                    const agingDays = getAgeInDays(row);
                    const agingMeta = getAgingMeta(agingDays);
                    const updates = parseUpdates(row.updates_json);
                    return (
                      <Table.Tr key={row.id}>
                        {isManager && (
                          <Table.Td>
                            <Checkbox checked={selectedIds.includes(row.id)} onChange={() => toggleSelection(row.id)} aria-label={`Select enhancement ${row.title}`} />
                          </Table.Td>
                        )}
                        <Table.Td style={{ width: 120, minWidth: 120, whiteSpace: "nowrap" }}>
                          {row.legacy_id ? (
                            <Badge variant="light" color="gray" style={{ whiteSpace: "nowrap", flexShrink: 0, minWidth: "fit-content" }}>
                              #{row.legacy_id}
                            </Badge>
                          ) : (
                            <Text size="sm" c="dimmed">—</Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={4}>
                            <Group gap="xs" wrap="wrap">
                              <Text fw={600}>{row.title}</Text>
                              {row.status === "approved" && !row.assignee_name && !row.assignee_email && (
                                <Badge color="orange" variant="light">Needs owner</Badge>
                              )}
                            </Group>
                            <Text size="sm" c="dimmed" lineClamp={2}>{row.description}</Text>
                            <Text size="xs" c="dimmed">Created {formatDate(String(row.created_at ?? ""))} · Updated {formatDate(getAnchorDate(row))}</Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td style={{ minWidth: 110, whiteSpace: "nowrap" }}>
                          <Badge color="violet" variant="light" style={{ whiteSpace: "nowrap", flexShrink: 0, minWidth: "fit-content" }}>
                            {platformLabel(row.platform)}
                          </Badge>
                        </Table.Td>
                        <Table.Td style={{ minWidth: 130, whiteSpace: "nowrap" }}>
                          <Badge variant="light" style={{ whiteSpace: "nowrap", flexShrink: 0, minWidth: "fit-content" }}>
                            {row.category}
                          </Badge>
                        </Table.Td>
                        <Table.Td style={{ minWidth: 100, whiteSpace: "nowrap" }}>
                          <Badge color={row.priority === "critical" ? "red" : row.priority === "high" ? "orange" : row.priority === "medium" ? "yellow" : "gray"} variant="light" style={{ whiteSpace: "nowrap", flexShrink: 0, minWidth: "fit-content" }}>
                            {row.priority}
                          </Badge>
                        </Table.Td>
                        <Table.Td style={{ minWidth: 130, whiteSpace: "nowrap" }}>
                          <Badge color={meta.color} variant="light" style={{ whiteSpace: "nowrap", flexShrink: 0, minWidth: "fit-content" }}>
                            {meta.label}
                          </Badge>
                        </Table.Td>
                        <Table.Td style={{ minWidth: 120, whiteSpace: "nowrap" }}>
                          <Stack gap={4}>
                            {agingMeta ? (
                              <Badge color={agingMeta.color} variant="light" leftSection={<IconClock size={12} />}>
                                {agingMeta.label}
                              </Badge>
                            ) : (
                              <Badge color="green" variant="light">Fresh {agingDays}d</Badge>
                            )}
                            <Text size="xs" c="dimmed">Last touch {agingDays}d ago</Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text size="sm">{row.submitted_by_name}</Text>
                            <Text size="xs" c="dimmed">{row.submitted_by_email || "No email"}</Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text size="sm">{row.assignee_name || "—"}</Text>
                            <Text size="xs" c="dimmed">{row.assignee_email || "Unassigned"}</Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td style={{ minWidth: 90, whiteSpace: "nowrap" }}>{row.target_quarter || "—"}</Table.Td>
                        <Table.Td style={{ minWidth: 120 }}>
                          <Stack gap={2}>
                            <Text size="sm">{row.approved_by_name || "—"}</Text>
                            <Text size="xs" c="dimmed">{formatDate(row.approved_at)}</Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Button variant="subtle" size="compact-sm" leftSection={<IconHistory size={14} />} onClick={() => setHistoryRow(row)}>
                            {updates.length}
                          </Button>
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
            onChange={(event) => setForm((prev) => ({ ...prev, legacy_id: getInputValue(event).replace(/[^0-9-]/g, "") }))}
          />
          <TextInput
            label="Title"
            placeholder="Short, clear title"
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: getInputValue(event) }))}
            required
          />
          <Textarea
            label="Description"
            placeholder="Describe the problem, expected improvement, and why it matters"
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: getInputValue(event) }))}
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
          <Grid>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput
                label="Target quarter"
                placeholder="Optional, e.g. 2026-Q3"
                value={form.target_quarter}
                onChange={(event) => setForm((prev) => ({ ...prev, target_quarter: getInputValue(event) }))}
              />
            </Grid.Col>
            {isManager && editing && (
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Select
                  label="Status"
                  data={STATUS_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                  value={form.status}
                  onChange={(value) => setForm((prev) => ({ ...prev, status: (value as EnhancementStatus) || "pending" }))}
                />
              </Grid.Col>
            )}
          </Grid>
          {isManager && editing && (
            <>
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <TextInput
                    label="Assignee name"
                    placeholder="Person responsible for follow-up"
                    value={form.assignee_name}
                    onChange={(event) => setForm((prev) => ({ ...prev, assignee_name: getInputValue(event) }))}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <TextInput
                    label="Assignee email"
                    placeholder="owner@appdirect.com"
                    value={form.assignee_email}
                    onChange={(event) => setForm((prev) => ({ ...prev, assignee_email: getInputValue(event) }))}
                  />
                </Grid.Col>
              </Grid>
              <Textarea
                label="Manager notes"
                placeholder="Current guidance, blockers, or implementation notes"
                value={form.manager_notes}
                onChange={(event) => setForm((prev) => ({ ...prev, manager_notes: getInputValue(event) }))}
                minRows={3}
              />
              <Textarea
                label="Add update to history"
                placeholder="Optional timeline entry, e.g. aligned with SD, waiting on requirements, owner assigned"
                value={form.update_note}
                onChange={(event) => setForm((prev) => ({ ...prev, update_note: getInputValue(event) }))}
                minRows={2}
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

      <Modal
        opened={Boolean(historyRow)}
        onClose={() => setHistoryRow(null)}
        title={historyRow ? `Update history · ${historyRow.title}` : "Update history"}
        centered
        radius="lg"
        size="lg"
      >
        <Stack gap="md">
          {historyRow && (
            <Card withBorder radius="lg" p="md">
              <Stack gap={4}>
                <Text fw={700}>{historyRow.title}</Text>
                <Text size="sm" c="dimmed">{historyRow.description}</Text>
                <Group gap="xs">
                  <Badge variant="light" color="violet">{platformLabel(historyRow.platform)}</Badge>
                  <Badge variant="light" color={statusMeta(historyRow.status).color}>{statusMeta(historyRow.status).label}</Badge>
                  {historyRow.assignee_name && <Badge variant="light" color="blue">Owner: {historyRow.assignee_name}</Badge>}
                </Group>
              </Stack>
            </Card>
          )}

          {historyEntries.length === 0 ? (
            <Card withBorder radius="lg" p="lg">
              <Stack align="center" gap="xs">
                <ThemeIcon size={40} radius="xl" color="gray" variant="light">
                  <IconHistory size={20} />
                </ThemeIcon>
                <Text fw={600}>No update history yet</Text>
                <Text size="sm" c="dimmed" ta="center">
                  Timeline entries appear here whenever an item is submitted, edited, approved, or updated in bulk.
                </Text>
              </Stack>
            </Card>
          ) : (
            <Stack gap="sm">
              {historyEntries.map((entry, index) => (
                <Card key={entry.id ?? `${entry.created_at}-${index}`} withBorder radius="lg" p="md">
                  <Stack gap={6}>
                    <Group justify="space-between" align="flex-start">
                      <Group gap="xs">
                        <ThemeIcon size="sm" color={entry.type === "submitted" ? "yellow" : entry.type === "bulk_update" ? "blue" : "indigo"} variant="light">
                          <IconArrowUpRight size={12} />
                        </ThemeIcon>
                        <div>
                          <Text fw={600}>{entry.actor_name || "System update"}</Text>
                          <Text size="xs" c="dimmed">{formatDate(entry.created_at, true)}</Text>
                        </div>
                      </Group>
                      {entry.type && (
                        <Badge variant="light" color="gray">{entry.type.replace(/_/g, " ")}</Badge>
                      )}
                    </Group>
                    <Text size="sm">{entry.summary || "Updated enhancement."}</Text>
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </Stack>
      </Modal>
    </WidgetFrame>
  );
}

function StatCard({ label, value, color, detail }: { label: string; value: number; color: string; detail: string }) {
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
        <Text size="xs" c="dimmed">{detail}</Text>
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
          Team members can submit ideas and view the full backlog. Managers can sort, assign owners, run bulk actions, and review full update history.
        </Text>
      </Stack>
    </WidgetTile>
  );
}
