import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { IconAlertCircle, IconCalendarClock, IconClockEdit, IconListDetails } from "@tabler/icons-react";
import { db } from "../../db";
import { LOCKED_TEAM_NAMES } from "../PerformanceTracker/team";

export type BreakScheduleRow = Awaited<ReturnType<typeof db.break_schedules.list>>[number];

type Props = {
  opened: boolean;
  onClose: () => void;
  identityName?: string | null;
  isManager: boolean;
};

const TODAY_LABEL = new Date().toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const todayIso = new Date().toISOString().slice(0, 10);

function norm(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function timeValueOrBlank(value?: string | null) {
  return value && /^\d{2}:\d{2}$/.test(value) ? value : "";
}

function formatWindow(start?: string | null, end?: string | null) {
  if (!start || !end) return "—";
  return `${start} – ${end}`;
}

export function BreakScheduleModal({ opened, onClose, identityName, isManager }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<BreakScheduleRow[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>("fixed");
  const [selectedName, setSelectedName] = useState<string | null>(identityName ?? null);
  const [fixedStart, setFixedStart] = useState("");
  const [fixedEnd, setFixedEnd] = useState("");
  const [todayStart, setTodayStart] = useState("");
  const [todayEnd, setTodayEnd] = useState("");

  const canEditName = isManager;
  const effectiveName = canEditName ? selectedName : (identityName ?? null);
  const peopleOptions = LOCKED_TEAM_NAMES.map((name) => ({ value: name, label: name }));

  async function loadRows() {
    setLoading(true);
    setError(null);
    try {
      const data = await db.break_schedules.list({ orderBy: { column: "employee_name", ascending: true } });
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!opened) return;
    void loadRows();
  }, [opened]);

  useEffect(() => {
    if (!opened) return;
    setSelectedName(identityName ?? null);
  }, [identityName, opened]);

  const rowMaps = useMemo(() => {
    const fixed = new Map<string, BreakScheduleRow>();
    const overrides = new Map<string, BreakScheduleRow>();
    for (const row of rows) {
      const key = norm(row.employee_name);
      if (row.schedule_type === "fixed") fixed.set(key, row);
      if (row.schedule_type === "override" && row.schedule_date === todayIso) overrides.set(key, row);
    }
    return { fixed, overrides };
  }, [rows]);

  useEffect(() => {
    const key = effectiveName ? norm(effectiveName) : null;
    const fixedRow = key ? rowMaps.fixed.get(key) : undefined;
    const overrideRow = key ? rowMaps.overrides.get(key) : undefined;
    setFixedStart(timeValueOrBlank(fixedRow?.start_time));
    setFixedEnd(timeValueOrBlank(fixedRow?.end_time));
    setTodayStart(timeValueOrBlank(overrideRow?.start_time));
    setTodayEnd(timeValueOrBlank(overrideRow?.end_time));
  }, [effectiveName, rowMaps]);

  async function saveSchedule(kind: "fixed" | "override") {
    const start = kind === "fixed" ? fixedStart : todayStart;
    const end = kind === "fixed" ? fixedEnd : todayEnd;
    if (!effectiveName) {
      setError("Select a team member first.");
      return;
    }
    if (!start || !end) {
      setError("Please enter both start and end times.");
      return;
    }
    if (end <= start) {
      setError("End time must be after start time.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await db.break_schedules.deleteWhere({
        employee_name: effectiveName,
        schedule_type: kind,
        schedule_date: kind === "override" ? todayIso : null,
      });
      await db.break_schedules.insert({
        employee_name: effectiveName,
        schedule_type: kind,
        schedule_date: kind === "override" ? todayIso : null,
        start_time: start,
        end_time: end,
        updated_by: identityName ?? effectiveName,
      });
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function clearTodayOverride() {
    if (!effectiveName) return;
    setSaving(true);
    setError(null);
    try {
      await db.break_schedules.deleteWhere({
        employee_name: effectiveName,
        schedule_type: "override",
        schedule_date: todayIso,
      });
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const allRows = LOCKED_TEAM_NAMES.map((name) => {
    const key = norm(name);
    const fixed = rowMaps.fixed.get(key);
    const today = rowMaps.overrides.get(key);
    return {
      name,
      fixed: formatWindow(fixed?.start_time, fixed?.end_time),
      today: formatWindow(today?.start_time, today?.end_time),
      effective: formatWindow(today?.start_time ?? fixed?.start_time, today?.end_time ?? fixed?.end_time),
      hasOverride: !!today,
    };
  });

  return (
    <Modal opened={opened} onClose={onClose} title="Break times" centered size="xl">
      <Stack gap="md">
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            {error}
          </Alert>
        )}

        <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="fixed" leftSection={<IconClockEdit size={14} />}>
              Change fixed break
            </Tabs.Tab>
            <Tabs.Tab value="today" leftSection={<IconCalendarClock size={14} />}>
              Change break only for today
            </Tabs.Tab>
            <Tabs.Tab value="list" leftSection={<IconListDetails size={14} />}>
              Show list of all breaks
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="fixed" pt="md">
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                This becomes the default break time used every day the teammate is in shift.
              </Text>
              {canEditName ? (
                <Select label="Team member" data={peopleOptions} value={selectedName} onChange={setSelectedName} searchable />
              ) : (
                <Text size="sm">Updating fixed break for <strong>{identityName ?? "—"}</strong>.</Text>
              )}
              <Group grow>
                <TextInput label="Start time" type="time" value={fixedStart} onChange={(e) => setFixedStart(e.currentTarget.value)} />
                <TextInput label="End time" type="time" value={fixedEnd} onChange={(e) => setFixedEnd(e.currentTarget.value)} />
              </Group>
              <Group justify="flex-end">
                <Button onClick={() => void saveSchedule("fixed")} loading={saving || loading}>
                  Save fixed break
                </Button>
              </Group>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="today" pt="md">
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                Today-only override for {TODAY_LABEL}. If blank, the fixed break will be used.
              </Text>
              {canEditName ? (
                <Select label="Team member" data={peopleOptions} value={selectedName} onChange={setSelectedName} searchable />
              ) : (
                <Text size="sm">Updating only today for <strong>{identityName ?? "—"}</strong>.</Text>
              )}
              <Group grow>
                <TextInput label="Start time" type="time" value={todayStart} onChange={(e) => setTodayStart(e.currentTarget.value)} />
                <TextInput label="End time" type="time" value={todayEnd} onChange={(e) => setTodayEnd(e.currentTarget.value)} />
              </Group>
              <Group justify="space-between">
                <Button variant="default" onClick={() => void clearTodayOverride()} loading={saving || loading}>
                  Clear today override
                </Button>
                <Button onClick={() => void saveSchedule("override")} loading={saving || loading}>
                  Save today only
                </Button>
              </Group>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="list" pt="md">
            <Stack gap="sm">
              <Text size="sm" c="dimmed">
                Everyone can view the team’s break schedule. Personal editing is restricted to your own record unless you are a manager.
              </Text>
              <Table striped highlightOnHover withRowBorders={false}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Fixed break</Table.Th>
                    <Table.Th>Today override</Table.Th>
                    <Table.Th>Effective today</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {allRows.map((row) => (
                    <Table.Tr key={row.name}>
                      <Table.Td>
                        <Group gap="xs">
                          <Text size="sm">{row.name}</Text>
                          {row.hasOverride && <Badge size="xs" color="blue" variant="light">Today override</Badge>}
                        </Group>
                      </Table.Td>
                      <Table.Td>{row.fixed}</Table.Td>
                      <Table.Td>{row.today}</Table.Td>
                      <Table.Td>{row.effective}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Modal>
  );
}
