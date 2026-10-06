import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBriefcase,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { db } from "../../db";
import { useIdentity } from "../../lib/identity";
import { WidgetFrame } from "../WidgetFrame";
export { FinanceCasesTile } from "./Tile";

type FinanceCase = Awaited<ReturnType<typeof db.finance_cases.list>>[number];
type FinanceService = "mobility" | "network";

const SERVICE_OPTIONS = [
  { value: "mobility", label: "Mobility" },
  { value: "network", label: "Network" },
];

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong";
}

function getServiceLabel(service?: string | null) {
  return service === "network" ? "Network" : "Mobility";
}

export function FinanceCasesWidget() {
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";
  const [rows, setRows] = useState<FinanceCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [service, setService] = useState<FinanceService>("mobility");
  const [modalOpen, setModalOpen] = useState(false);
  const [caseNumber, setCaseNumber] = useState("");
  const [comment, setComment] = useState("");
  const [newCaseService, setNewCaseService] = useState<FinanceService>("mobility");

  async function load() {
    if (!identity) return;
    setLoading(true);
    setError(null);
    try {
      const data = await db.finance_cases.list({
        filter: { month_key: monthKey, service },
        orderBy: { column: "created_at", ascending: false },
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [identity, monthKey, service]);

  async function addCase() {
    if (!identity?.name) return;
    if (!caseNumber.trim() || !comment.trim()) {
      setError("Add both finance case number and comment.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await db.finance_cases.insert({
        month_key: monthKey,
        service: newCaseService,
        case_number: caseNumber.trim(),
        comment: comment.trim(),
        created_by: identity.name,
      });
      setCaseNumber("");
      setComment("");
      setNewCaseService("mobility");
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteCase(row: FinanceCase) {
    setError(null);
    try {
      await db.finance_cases.deleteById(row.id);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  const totalThisMonth = rows.length;
  const latestEntry = useMemo(() => rows[0] ?? null, [rows]);

  if (!identity) {
    return (
      <WidgetFrame title="Finance Cases" subtitle="Sign in required" icon={IconBriefcase} iconColor="teal">
        <Alert color="gray">Sign in with a manager account to view finance cases.</Alert>
      </WidgetFrame>
    );
  }

  if (!isManager) {
    return (
      <WidgetFrame title="Finance Cases" subtitle="Manager access required" icon={IconBriefcase} iconColor="teal">
        <Alert color="yellow">Only managers can track monthly finance cases.</Alert>
      </WidgetFrame>
    );
  }

  return (
    <WidgetFrame
      title="Finance Cases"
      subtitle={`${totalThisMonth} ${getServiceLabel(service).toLowerCase()} cases logged for ${formatMonthLabel(monthKey)}`}
      icon={IconBriefcase}
      iconColor="teal"
      loading={loading}
      onRefresh={load}
      headerActions={(
        <Group gap="xs">
          <TextInput
            type="month"
            value={monthKey}
            onChange={(event) => setMonthKey(event.currentTarget.value || currentMonthKey())}
            size="xs"
            styles={{ input: { minWidth: 150 } }}
          />
          <Select
            size="xs"
            data={SERVICE_OPTIONS}
            value={service}
            onChange={(value) => setService((value as FinanceService) || "mobility")}
            allowDeselect={false}
            styles={{ input: { minWidth: 140 } }}
          />
          <Button size="xs" color="teal" leftSection={<IconPlus size={14} />} onClick={() => setModalOpen(true)}>
            Add case
          </Button>
        </Group>
      )}
      status={{
        label: `${totalThisMonth} this month`,
        color: totalThisMonth > 0 ? "teal" : "gray",
      }}
    >
      <Stack gap="md">
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            {error}
          </Alert>
        )}

        <Card withBorder radius="lg" p="md">
          <Group justify="space-between" align="flex-start">
            <Stack gap={2}>
              <Text fw={700}>Monthly finance case log</Text>
              <Text size="sm" c="dimmed">
                Document the {getServiceLabel(service).toLowerCase()} finance cases received during {formatMonthLabel(monthKey)} using the case number and a short comment.
              </Text>
            </Stack>
            <Badge color="teal" variant="light">{getServiceLabel(service)} · {totalThisMonth} entries</Badge>
          </Group>
          {latestEntry ? (
            <Text size="xs" c="dimmed" mt="sm">
              Latest entry: {latestEntry.case_number} · {formatDateTime(latestEntry.created_at)}
            </Text>
          ) : (
            <Text size="xs" c="dimmed" mt="sm">No finance cases logged for this month yet.</Text>
          )}
        </Card>

        <Card withBorder radius="lg" p={0}>
          <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 140 }}>Case number</Table.Th>
                <Table.Th style={{ width: 120 }}>Service</Table.Th>
                <Table.Th>Comment</Table.Th>
                <Table.Th style={{ width: 190 }}>Logged by</Table.Th>
                <Table.Th style={{ width: 190 }}>Created</Table.Th>
                <Table.Th style={{ width: 70 }}>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text size="sm" c="dimmed" ta="center" py="lg">
                      No {getServiceLabel(service).toLowerCase()} finance cases recorded for {formatMonthLabel(monthKey)}.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : rows.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>
                    <Text fw={700} size="sm">{row.case_number}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={row.service === "network" ? "blue" : "teal"}>
                      {getServiceLabel(row.service)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{row.comment}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{row.created_by || "—"}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{formatDateTime(row.created_at)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon color="red" variant="subtle" onClick={() => void deleteCase(row)} aria-label={["Delete ", row.case_number].join("")}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title="Add finance case" centered>
        <Stack gap="md">
          <Select
            label="Service"
            data={SERVICE_OPTIONS}
            value={newCaseService}
            onChange={(value) => setNewCaseService((value as FinanceService) || "mobility")}
            allowDeselect={false}
            required
          />
          <TextInput
            label="Finance case number"
            placeholder="FC-12345"
            value={caseNumber}
            onChange={(event) => setCaseNumber(event.currentTarget.value)}
            required
          />
          <Textarea
            label="Comment"
            placeholder="Add the monthly finance case note"
            value={comment}
            onChange={(event) => setComment(event.currentTarget.value)}
            minRows={4}
            required
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button color="teal" onClick={() => void addCase()} loading={saving} leftSection={<IconPlus size={14} />}>
              Save case
            </Button>
          </Group>
        </Stack>
      </Modal>
    </WidgetFrame>
  );
}
