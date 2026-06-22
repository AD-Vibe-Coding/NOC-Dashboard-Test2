import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Group, Select, SimpleGrid, Stack, Table, Text, TextInput } from "@mantine/core";
import { IconAlertCircle, IconClockRecord, IconDownload, IconSearch } from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { useAttendanceSummary } from "./data";
import { downloadBlob } from "../../lib/download";

export { AttendanceTrackerTile } from "./Tile";

function fmt(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isoDateDaysAgo(daysAgo: number) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isLatePunchIn(iso?: string | null) {
  if (!iso) return false;
  const date = new Date(iso);
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  return hour > 11 || (hour === 11 && minute > 15);
}

function exportRowsToCsv(rows: Array<{
  employee_name: string;
  first_punch_in: string | null;
  last_punch_out: string | null;
  days_present: number;
  total_punch_ins: number;
  total_punch_outs: number;
  queue_reminders: number;
  break_reminders: number;
  late_punch_days: number;
  missed_punch_out_days: number;
}>) {
  const header = [
    "Employee",
    "First Punch In",
    "Last Punch Out",
    "Days Present",
    "Punch Ins",
    "Punch Outs",
    "Queue Reminders",
    "Break Reminders",
    "Late Punch Days",
    "Missed Punch-out Days",
  ];
  const lines = rows.map((row) => [
    row.employee_name,
    row.first_punch_in ?? "",
    row.last_punch_out ?? "",
    String(row.days_present),
    String(row.total_punch_ins),
    String(row.total_punch_outs),
    String(row.queue_reminders),
    String(row.break_reminders),
    String(row.late_punch_days),
    String(row.missed_punch_out_days),
  ]);
  const csv = [header, ...lines]
    .map((line) => line.map((cell) => `"${String(cell).split('"').join('""')}"`).join(","))
    .join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `attendance-reminders-${new Date().toISOString().slice(0, 10)}.csv`);
}

function ReminderTrend({ points }: { points: Array<{ date: string; queue: number; break: number }> }) {
  const width = 640;
  const height = 140;
  if (points.length < 2) {
    return <Text size="sm" c="dimmed">Not enough data to chart reminder trends.</Text>;
  }
  const max = Math.max(1, ...points.flatMap((p) => [p.queue, p.break]));
  const makePath = (values: number[]) =>
    values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = height - (value / max) * height;
        return `${index === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: 140 }}>
      <path d={makePath(points.map((p) => p.queue))} fill="none" stroke="var(--mantine-color-blue-5)" strokeWidth="3" />
      <path d={makePath(points.map((p) => p.break))} fill="none" stroke="var(--mantine-color-orange-5)" strokeWidth="3" />
    </svg>
  );
}

export function AttendanceTrackerWidget() {
  const { data, loading, error, refresh } = useAttendanceSummary();
  const [range, setRange] = useState("14");
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [nameFilter, setNameFilter] = useState("");

  useEffect(() => {
    const days = Number(range);
    void refresh({ dateFrom: isoDateDaysAgo(Math.max(0, days - 1)) });
  }, [range]);

  const selectedMember = useMemo(
    () => data?.members.find((member) => member.employee_name === selectedEmployee) ?? data?.members[0] ?? null,
    [data, selectedEmployee],
  );

  const dailyRows = useMemo(() => {
    if (!selectedMember) return [] as Array<{ date: string; punch_in: string | null; punch_out: string | null; queue_reminders: number; break_reminders: number }>;
    return Object.entries(selectedMember.daily)
      .map(([date, value]) => ({ date, ...value }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [selectedMember]);

  const filteredMembers = useMemo(() => {
    const q = nameFilter.trim().toLowerCase();
    return (data?.members ?? [])
      .filter((member) => !q || member.employee_name.toLowerCase().includes(q))
      .map((member) => {
        const daily = Object.values(member.daily);
        const latePunchDays = daily.filter((day) => isLatePunchIn(day.punch_in)).length;
        const missedPunchOutDays = daily.filter((day) => day.punch_in && !day.punch_out).length;
        return {
          ...member,
          late_punch_days: latePunchDays,
          missed_punch_out_days: missedPunchOutDays,
        };
      });
  }, [data, nameFilter]);

  const reminderTrend = useMemo(() => {
    const byDate = new Map<string, { queue: number; break: number }>();
    for (const member of filteredMembers) {
      for (const [date, value] of Object.entries(member.daily)) {
        const current = byDate.get(date) ?? { queue: 0, break: 0 };
        current.queue += value.queue_reminders;
        current.break += value.break_reminders;
        byDate.set(date, current);
      }
    }
    return Array.from(byDate.entries())
      .map(([date, value]) => ({ date, ...value }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredMembers]);

  return (
    <WidgetFrame
      title="Attendance & Reminders"
      subtitle="Track punch-in/out activity plus queue and break reminder counts"
      icon={IconClockRecord}
      iconColor="orange"
      loading={loading}
      onRefresh={refresh}
      status={data ? { label: data.summary.range_label, color: "orange" } : undefined}
    >
      <Stack gap="md">
        {error ? (
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        ) : null}

        <Card withBorder radius="lg" p="md">
          <Group grow align="end">
            <Select
              label="Date range"
              value={range}
              onChange={(value) => setRange(value ?? "14")}
              data={[
                { value: "7", label: "Last 7 days" },
                { value: "14", label: "Last 14 days" },
                { value: "30", label: "Last 30 days" },
              ]}
            />
            <TextInput
              label="Filter by person"
              placeholder="Search employee name"
              value={nameFilter}
              onChange={(event) => setNameFilter(event.currentTarget.value)}
              leftSection={<IconSearch size={14} />}
            />
            <Select
              label="Employee drilldown"
              value={selectedEmployee ?? filteredMembers[0]?.employee_name ?? null}
              onChange={setSelectedEmployee}
              data={filteredMembers.map((member) => ({ value: member.employee_name, label: member.employee_name }))}
              placeholder="Select an employee"
            />
            <Button variant="light" color="orange" leftSection={<IconDownload size={14} />} onClick={() => exportRowsToCsv(filteredMembers)}>
              Export CSV
            </Button>
          </Group>
        </Card>

        <SimpleGrid cols={{ base: 2, md: 5 }}>
          <Card withBorder radius="lg" p="md"><Text size="xs" c="dimmed">People</Text><Text fw={700} size="xl">{filteredMembers.length}</Text></Card>
          <Card withBorder radius="lg" p="md"><Text size="xs" c="dimmed">Punch-ins</Text><Text fw={700} size="xl">{filteredMembers.reduce((sum, row) => sum + row.total_punch_ins, 0)}</Text></Card>
          <Card withBorder radius="lg" p="md"><Text size="xs" c="dimmed">Punch-outs</Text><Text fw={700} size="xl">{filteredMembers.reduce((sum, row) => sum + row.total_punch_outs, 0)}</Text></Card>
          <Card withBorder radius="lg" p="md"><Text size="xs" c="dimmed">Late punch days</Text><Text fw={700} size="xl">{filteredMembers.reduce((sum, row) => sum + row.late_punch_days, 0)}</Text></Card>
          <Card withBorder radius="lg" p="md"><Text size="xs" c="dimmed">Missed punch-out days</Text><Text fw={700} size="xl">{filteredMembers.reduce((sum, row) => sum + row.missed_punch_out_days, 0)}</Text></Card>
        </SimpleGrid>

        <Card withBorder radius="lg" p="md">
          <Group justify="space-between" mb="sm">
            <Text fw={700}>Reminder trend</Text>
            <Group gap="xs">
              <Badge variant="light" color="blue">Queue reminders</Badge>
              <Badge variant="light" color="orange">Break reminders</Badge>
            </Group>
          </Group>
          <ReminderTrend points={reminderTrend} />
        </Card>

        <Card withBorder radius="lg" p="md">
          <Group justify="space-between" mb="sm">
            <Text fw={700}>Team activity</Text>
            <Badge variant="light" color="orange">Manager view</Badge>
          </Group>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Employee</Table.Th>
                <Table.Th>First punch in</Table.Th>
                <Table.Th>Last punch out</Table.Th>
                <Table.Th>Days present</Table.Th>
                <Table.Th>Punch-ins</Table.Th>
                <Table.Th>Punch-outs</Table.Th>
                <Table.Th>Queue reminders</Table.Th>
                <Table.Th>Break reminders</Table.Th>
                <Table.Th>Flags</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredMembers.map((row) => (
                <Table.Tr key={row.employee_name}>
                  <Table.Td><Text fw={600}>{row.employee_name}</Text></Table.Td>
                  <Table.Td>{fmt(row.first_punch_in)}</Table.Td>
                  <Table.Td>{fmt(row.last_punch_out)}</Table.Td>
                  <Table.Td>{row.days_present}</Table.Td>
                  <Table.Td>{row.total_punch_ins}</Table.Td>
                  <Table.Td>{row.total_punch_outs}</Table.Td>
                  <Table.Td>{row.queue_reminders}</Table.Td>
                  <Table.Td>{row.break_reminders}</Table.Td>
                  <Table.Td>
                    <Group gap={6}>
                      {row.late_punch_days > 0 ? <Badge color="yellow" variant="light">{row.late_punch_days} late</Badge> : null}
                      {row.missed_punch_out_days > 0 ? <Badge color="red" variant="light">{row.missed_punch_out_days} missed out</Badge> : null}
                      {row.late_punch_days === 0 && row.missed_punch_out_days === 0 ? <Badge color="green" variant="light">Clean</Badge> : null}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder radius="lg" p="md">
          <Group justify="space-between" mb="sm">
            <Text fw={700}>Daily drilldown</Text>
            {selectedMember ? <Badge variant="light" color="blue">{selectedMember.employee_name}</Badge> : null}
          </Group>
          {selectedMember ? (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>First punch in</Table.Th>
                  <Table.Th>Last punch out</Table.Th>
                  <Table.Th>Queue reminders</Table.Th>
                  <Table.Th>Break reminders</Table.Th>
                  <Table.Th>Flags</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {dailyRows.map((row) => (
                  <Table.Tr key={row.date}>
                    <Table.Td>{row.date}</Table.Td>
                    <Table.Td>{fmt(row.punch_in)}</Table.Td>
                    <Table.Td>{fmt(row.punch_out)}</Table.Td>
                    <Table.Td>{row.queue_reminders}</Table.Td>
                    <Table.Td>{row.break_reminders}</Table.Td>
                    <Table.Td>
                      <Group gap={6}>
                        {isLatePunchIn(row.punch_in) ? <Badge color="yellow" variant="light">Late in</Badge> : null}
                        {row.punch_in && !row.punch_out ? <Badge color="red" variant="light">Missed out</Badge> : null}
                        {!isLatePunchIn(row.punch_in) && !(row.punch_in && !row.punch_out) ? <Badge color="green" variant="light">OK</Badge> : null}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {dailyRows.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={6}><Text size="sm" c="dimmed">No activity in this date range.</Text></Table.Td>
                  </Table.Tr>
                ) : null}
              </Table.Tbody>
            </Table>
          ) : (
            <Text size="sm" c="dimmed">Select an employee to inspect daily activity.</Text>
          )}
        </Card>
      </Stack>
    </WidgetFrame>
  );
}
