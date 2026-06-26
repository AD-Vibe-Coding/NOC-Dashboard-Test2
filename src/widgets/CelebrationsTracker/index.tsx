import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCake,
  IconEdit,
  IconGift,
  IconHeart,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { db } from "../../db";
import { useIdentity } from "../../lib/identity";
import { WidgetFrame } from "../WidgetFrame";

export type CelebrationRow = Awaited<ReturnType<typeof db.celebrations.list>>[number];

const EVENT_TYPES = [
  { value: "birthday", label: "Birthday", color: "pink", icon: IconCake },
  { value: "work_anniversary", label: "Work anniversary", color: "blue", icon: IconGift },
  { value: "marriage_anniversary", label: "Marriage anniversary", color: "grape", icon: IconHeart },
] as const;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getEventMeta(type: string) {
  return EVENT_TYPES.find((entry) => entry.value === type) ?? EVENT_TYPES[0];
}

function getDaysInMonth(month: number) {
  return new Date(2024, month, 0).getDate();
}

function formatMonthDay(month: number, day: number) {
  return `${MONTHS[month - 1]} ${day}`;
}

function safeOccurrenceDate(year: number, month: number, day: number) {
  const adjustedDay = Math.min(day, getDaysInMonth(month));
  return new Date(year, month - 1, adjustedDay);
}

function nextOccurrence(row: CelebrationRow, now = new Date()) {
  const currentYear = now.getFullYear();
  let date = safeOccurrenceDate(currentYear, row.event_month, row.event_day);
  if (date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    date = safeOccurrenceDate(currentYear + 1, row.event_month, row.event_day);
  }
  return date;
}

function daysUntil(date: Date, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((target - start) / (1000 * 60 * 60 * 24));
}

function yearsLabel(row: CelebrationRow, occurrence: Date) {
  if (!row.event_year) return null;
  const years = occurrence.getFullYear() - row.event_year;
  if (years < 0) return null;
  if (row.event_type === "birthday") return `${years}`;
  return `${years} year${years === 1 ? "" : "s"}`;
}

function occurrenceLabel(row: CelebrationRow) {
  return row.event_year ? `${formatMonthDay(row.event_month, row.event_day)}, ${row.event_year}` : formatMonthDay(row.event_month, row.event_day);
}

function relativeLabel(days: number) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 0) return "Passed";
  return `In ${days} days`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong";
}

function blankForm() {
  const today = new Date();
  return {
    person_name: "",
    event_type: "birthday",
    event_month: String(today.getMonth() + 1),
    event_day: String(today.getDate()),
    event_year: "",
    notes: "",
  };
}

function validateForm(form: ReturnType<typeof blankForm>) {
  const month = Number(form.event_month);
  const day = Number(form.event_day);
  if (!form.person_name.trim()) return "Please enter a person name.";
  if (!Number.isInteger(month) || month < 1 || month > 12) return "Please choose a valid month.";
  if (!Number.isInteger(day) || day < 1 || day > getDaysInMonth(month)) return "Please enter a valid day for that month.";
  if (form.event_year.trim()) {
    const year = Number(form.event_year);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) return "Enter a valid year or leave it blank.";
  }
  return null;
}

export function CelebrationsTrackerWidget() {
  const { identity } = useIdentity();
  const [rows, setRows] = useState<CelebrationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [form, setForm] = useState(blankForm());

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await db.celebrations.list({ orderBy: { column: "person_name", ascending: true } });
      setRows(Array.isArray(result) ? result : []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const enriched = useMemo(() => {
    return rows
      .map((row) => {
        const next = nextOccurrence(row);
        const delta = daysUntil(next);
        return {
          ...row,
          next,
          days_until: delta,
          years_label: yearsLabel(row, next),
        };
      })
      .sort((a, b) => a.next.getTime() - b.next.getTime());
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (filter === "all") return enriched;
    return enriched.filter((row) => row.event_type === filter);
  }, [enriched, filter]);

  const upcoming = filteredRows.filter((row) => row.days_until >= 0 && row.days_until <= 30);
  const nextUp = upcoming[0] ?? filteredRows.find((row) => row.days_until >= 0) ?? null;

  async function submit() {
    const validation = validateForm(form);
    if (validation) {
      setError(validation);
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      person_name: form.person_name.trim(),
      event_type: form.event_type,
      event_month: Number(form.event_month),
      event_day: Number(form.event_day),
      event_year: form.event_year.trim() ? Number(form.event_year) : null,
      notes: form.notes.trim() || null,
      created_by: identity?.name ?? null,
    };

    try {
      if (editingId) {
        await db.celebrations.updateById(editingId, payload);
      } else {
        await db.celebrations.insert(payload);
      }
      setModalOpen(false);
      setEditingId(null);
      setForm(blankForm());
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function openCreate() {
    setEditingId(null);
    setForm(blankForm());
    setError(null);
    setModalOpen(true);
  }

  function openEdit(row: CelebrationRow) {
    setEditingId(row.id);
    setForm({
      person_name: row.person_name,
      event_type: row.event_type,
      event_month: String(row.event_month),
      event_day: String(row.event_day),
      event_year: row.event_year ? String(row.event_year) : "",
      notes: row.notes ?? "",
    });
    setError(null);
    setModalOpen(true);
  }

  async function remove(row: CelebrationRow) {
    try {
      setError(null);
      await db.celebrations.deleteById(row.id);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <WidgetFrame
      title="Celebrations Tracker"
      subtitle="Track birthdays, work anniversaries, and marriage anniversaries"
      icon={IconGift}
      iconColor="pink"
      loading={loading}
      onRefresh={load}
      status={nextUp ? { label: `${nextUp.person_name} ${relativeLabel(nextUp.days_until).toLowerCase()}`, color: "pink" } : undefined}
    >
      <Stack gap="md" p="md">
        {error ? (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            {error}
          </Alert>
        ) : null}

        <Group justify="space-between" align="center">
          <Stack gap={2}>
            <Text fw={700}>Team celebrations</Text>
            <Text size="sm" c="dimmed">Keep important recurring dates in one place.</Text>
          </Stack>
          <Group>
            <Select
              value={filter}
              onChange={(value) => setFilter(value ?? "all")}
              data={[{ value: "all", label: "All types" }, ...EVENT_TYPES.map((type) => ({ value: type.value, label: type.label }))]}
              w={220}
            />
            <Button leftSection={<IconPlus size={14} />} color="pink" onClick={openCreate}>
              Add celebration
            </Button>
          </Group>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 4 }}>
          <Card withBorder radius="lg" p="md"><Text size="xs" c="dimmed">Total entries</Text><Text fw={800} size="xl">{filteredRows.length}</Text></Card>
          <Card withBorder radius="lg" p="md"><Text size="xs" c="dimmed">Next 30 days</Text><Text fw={800} size="xl">{upcoming.length}</Text></Card>
          <Card withBorder radius="lg" p="md"><Text size="xs" c="dimmed">Birthdays</Text><Text fw={800} size="xl">{filteredRows.filter((row) => row.event_type === "birthday").length}</Text></Card>
          <Card withBorder radius="lg" p="md"><Text size="xs" c="dimmed">Anniversaries</Text><Text fw={800} size="xl">{filteredRows.filter((row) => row.event_type !== "birthday").length}</Text></Card>
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Card withBorder radius="lg" p="md">
            <Group justify="space-between" mb="sm">
              <Text fw={700}>Coming up</Text>
              <Badge color="pink" variant="light">Next 30 days</Badge>
            </Group>
            <Stack gap="sm">
              {upcoming.length === 0 ? (
                <Text size="sm" c="dimmed">No upcoming celebrations in the next 30 days.</Text>
              ) : upcoming.map((row) => {
                const meta = getEventMeta(row.event_type);
                return (
                  <Card key={row.id} withBorder radius="md" p="sm">
                    <Group justify="space-between" align="flex-start">
                      <Stack gap={2}>
                        <Group gap="xs">
                          <Badge color={meta.color} variant="light">{meta.label}</Badge>
                          <Badge variant="dot" color={row.days_until <= 7 ? "pink" : "gray"}>{relativeLabel(row.days_until)}</Badge>
                        </Group>
                        <Text fw={700}>{row.person_name}</Text>
                        <Text size="sm" c="dimmed">{formatMonthDay(row.event_month, row.event_day)}{row.years_label ? ` • ${row.years_label}` : ""}</Text>
                        {row.notes ? <Text size="sm">{row.notes}</Text> : null}
                      </Stack>
                    </Group>
                  </Card>
                );
              })}
            </Stack>
          </Card>

          <Card withBorder radius="lg" p="md">
            <Group justify="space-between" mb="sm">
              <Text fw={700}>Next up</Text>
              {nextUp ? <Badge color="pink" variant="light">{relativeLabel(nextUp.days_until)}</Badge> : null}
            </Group>
            {nextUp ? (
              <Stack gap="sm">
                <ThemeIcon color={getEventMeta(nextUp.event_type).color} variant="light" size={48} radius="xl">
                  {(() => {
                    const Icon = getEventMeta(nextUp.event_type).icon;
                    return <Icon size={24} />;
                  })()}
                </ThemeIcon>
                <div>
                  <Text fw={800} size="lg">{nextUp.person_name}</Text>
                  <Text c="dimmed">{getEventMeta(nextUp.event_type).label}</Text>
                </div>
                <Divider />
                <Text size="sm">Date: {formatMonthDay(nextUp.event_month, nextUp.event_day)}</Text>
                {nextUp.years_label ? <Text size="sm">Milestone: {nextUp.years_label}</Text> : null}
                {nextUp.notes ? <Text size="sm">Notes: {nextUp.notes}</Text> : null}
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">Add your first celebration to start tracking upcoming dates.</Text>
            )}
          </Card>
        </SimpleGrid>

        <Card withBorder radius="lg" p="md">
          <Group justify="space-between" mb="sm">
            <Text fw={700}>All celebrations</Text>
            <Badge variant="light" color="gray">Recurring yearly</Badge>
          </Group>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Person</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Original date</Table.Th>
                <Table.Th>Next occurrence</Table.Th>
                <Table.Th>Notes</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredRows.map((row) => {
                const meta = getEventMeta(row.event_type);
                return (
                  <Table.Tr key={row.id}>
                    <Table.Td><Text fw={600}>{row.person_name}</Text></Table.Td>
                    <Table.Td><Badge color={meta.color} variant="light">{meta.label}</Badge></Table.Td>
                    <Table.Td>{occurrenceLabel(row)}</Table.Td>
                    <Table.Td>{formatMonthDay(row.event_month, row.event_day)} • {relativeLabel(row.days_until)}</Table.Td>
                    <Table.Td><Text size="sm" c={row.notes ? undefined : "dimmed"}>{row.notes || "—"}</Text></Table.Td>
                    <Table.Td>
                      <Group gap={6}>
                        <Tooltip label="Edit">
                          <ActionIcon variant="subtle" color="blue" onClick={() => openEdit(row)}>
                            <IconEdit size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Delete">
                          <ActionIcon variant="subtle" color="red" onClick={() => void remove(row)}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {filteredRows.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6}><Text size="sm" c="dimmed">No celebrations found yet. Add one to get started.</Text></Table.Td>
                </Table.Tr>
              ) : null}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>

      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={<Text fw={700}>{editingId ? "Edit celebration" : "Add celebration"}</Text>}
        centered
        radius="lg"
      >
        <Stack gap="md">
          <TextInput
            label="Person"
            placeholder="Enter a name"
            value={form.person_name}
            onChange={(event) => setForm((current) => ({ ...current, person_name: event.currentTarget.value }))}
            required
          />
          <Select
            label="Type"
            data={EVENT_TYPES.map((type) => ({ value: type.value, label: type.label }))}
            value={form.event_type}
            onChange={(value) => setForm((current) => ({ ...current, event_type: value ?? "birthday" }))}
            required
          />
          <Group grow align="end">
            <Select
              label="Month"
              data={MONTHS.map((month, index) => ({ value: String(index + 1), label: month }))}
              value={form.event_month}
              onChange={(value) => setForm((current) => ({ ...current, event_month: value ?? "1" }))}
              searchable
              required
            />
            <TextInput
              label="Day"
              placeholder="DD"
              value={form.event_day}
              onChange={(event) => setForm((current) => ({ ...current, event_day: event.currentTarget.value }))}
              required
            />
            <TextInput
              label="Year (optional)"
              placeholder="YYYY"
              value={form.event_year}
              onChange={(event) => setForm((current) => ({ ...current, event_year: event.currentTarget.value }))}
            />
          </Group>
          <Textarea
            label="Notes"
            placeholder="Optional details, gift ideas, or milestone context"
            minRows={3}
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.currentTarget.value }))}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button color="pink" onClick={() => void submit()} loading={saving}>
              {editingId ? "Save changes" : "Add celebration"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </WidgetFrame>
  );
}

export function CelebrationsTrackerTile({ onExpand }: { onExpand: () => void }) {
  const [items, setItems] = useState<CelebrationRow[]>([]);

  useEffect(() => {
    db.celebrations.list({ orderBy: { column: "person_name", ascending: true } }).then((rows) => {
      setItems(Array.isArray(rows) ? rows : []);
    }).catch(() => {
      setItems([]);
    });
  }, []);

  const nextUp = useMemo(() => {
    return items
      .map((row) => ({ ...row, next: nextOccurrence(row), days_until: daysUntil(nextOccurrence(row)) }))
      .sort((a, b) => a.next.getTime() - b.next.getTime())[0] ?? null;
  }, [items]);

  return (
    <Card withBorder radius="lg" p="md" style={{ cursor: "pointer", height: "100%" }} onClick={onExpand}>
      <Group gap="sm" align="flex-start" wrap="nowrap">
        <ThemeIcon size={36} radius="md" variant="light" color="pink">
          <IconGift size={20} />
        </ThemeIcon>
        <Stack gap={2} style={{ flex: 1 }}>
          <Text fw={700} size="sm">Celebrations Tracker</Text>
          <Text size="xs" c="dimmed">Birthdays and anniversaries</Text>
          <Badge size="xs" variant="light" color="pink" mt={4}>{items.length} saved</Badge>
          {nextUp ? (
            <Text size="xs" c="dimmed">Next: {nextUp.person_name} • {relativeLabel(nextUp.days_until)}</Text>
          ) : (
            <Text size="xs" c="dimmed">Add the first celebration</Text>
          )}
        </Stack>
      </Group>
    </Card>
  );
}
