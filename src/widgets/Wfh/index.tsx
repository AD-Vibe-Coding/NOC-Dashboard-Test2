import { useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Grid,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import {
  IconAlertCircle,
  IconCheck,
  IconHome,
  IconInfoCircle,
  IconUser,
  IconUserCheck,
  IconX,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { useWfhData } from "./data";
import { useIdentity } from "../../lib/identity";
import { NOC_ROSTER } from "../../lib/roster";
import {
  WFH_STATUS_COLORS,
  WFH_STATUS_LABELS,
  dayCount,
  decideWfhRequest,
  formatDateRange,
  submitWfhRequest,
  type WfhRequest,
} from "../../lib/wfh";

export { WfhTile } from "./Tile";

type Toast = {
  id: number;
  color: "green" | "red" | "blue" | "yellow";
  title: string;
  body?: string;
};

function toISODateString(d: Date | null): string | null {
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function WfhWidget() {
  const { data, loading, error, refresh } = useWfhData();
  const { identity } = useIdentity();

  const [submitting, setSubmitting] = useState(false);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [reason, setReason] = useState("");

  const [deciding, setDeciding] = useState<{
    request: WfhRequest;
    decision: "approved" | "denied";
  } | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [decisionWorking, setDecisionWorking] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);
  function showToast(t: Omit<Toast, "id">) {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((x) => x.id !== id)),
      5000,
    );
  }

  const requests = data?.requests ?? [];
  const isApprover = !!data?.is_approver;
  const approverName = data?.approver_name ?? "the approver";

  const pending = useMemo(
    () => requests.filter((r) => r.status === "pending"),
    [requests],
  );
  const approved = useMemo(
    () => requests.filter((r) => r.status === "approved"),
    [requests],
  );
  const denied = useMemo(
    () => requests.filter((r) => r.status === "denied"),
    [requests],
  );

  async function handleSubmit() {
    if (!identity?.name) {
      showToast({
        color: "red",
        title: "Set your identity first",
        body: "Open the dashboard header → Pick who you are.",
      });
      return;
    }
    const startISO = toISODateString(startDate);
    const endISO = toISODateString(endDate);
    if (!startISO || !endISO) {
      showToast({
        color: "red",
        title: "Pick start and end dates",
      });
      return;
    }
    if (reason.trim().length < 3) {
      showToast({
        color: "red",
        title: "Add a reason (at least 3 characters)",
      });
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitWfhRequest({
        employee_name: identity.name,
        start_date: startISO,
        end_date: endISO,
        reason: reason.trim(),
      });
      const req = result.request;
      showToast({
        color: "green",
        title: "Request submitted",
        body: `${formatDateRange(req.start_date, req.end_date)} · Awaiting approval from ${approverName}`,
      });
      setStartDate(null);
      setEndDate(null);
      setReason("");
      await refresh();
    } catch (err) {
      showToast({
        color: "red",
        title: "Submission failed",
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecision() {
    if (!deciding || !identity?.name) return;
    setDecisionWorking(true);
    try {
      const result = await decideWfhRequest(deciding.request.id, {
        reviewer: identity.name,
        decision: deciding.decision,
        note: decisionNote.trim() || undefined,
      });
      const channels = ["Slack thread reply"];
      if (result.email_sent) {
        channels.push(`email to ${result.employee_email}`);
      } else if (result.email_error === "disabled") {
        // skip — employee notifications disabled by config
      } else if (
        result.email_error &&
        !/AI_API_KEY/.test(result.email_error)
      ) {
        channels.push("email failed (see server log)");
      } else if (result.email_error) {
        channels.push("email pending (AI agent not configured)");
      }
      showToast({
        color: deciding.decision === "approved" ? "green" : "blue",
        title: `${deciding.decision === "approved" ? "Approved" : "Denied"} — ${deciding.request.employee_name}`,
        body: `${formatDateRange(deciding.request.start_date, deciding.request.end_date)} · ${channels.join(" · ")}`,
      });
      setDeciding(null);
      setDecisionNote("");
      await refresh();
    } catch (err) {
      showToast({
        color: "red",
        title: "Decision failed",
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDecisionWorking(false);
    }
  }

  const subtitle = identity?.name
    ? isApprover
      ? `You are the approver`
      : `Submit and view your requests`
    : `Pick your identity first to submit a request`;

  return (
    <WidgetFrame
      title="WFH Requests"
      subtitle={subtitle}
      icon={IconHome}
      iconColor="cyan"
      loading={loading}
      onRefresh={refresh}
      status={
        isApprover
          ? {
              label: pending.length > 0 ? `${pending.length} pending` : "All clear",
              color: pending.length > 0 ? "red" : "green",
              tooltip: "You have requests awaiting your decision",
            }
          : identity?.name
            ? { label: "Employee", color: "blue" }
            : undefined
      }
    >
      <Box
        style={{
          position: "fixed",
          top: 76,
          right: 16,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 380,
        }}
      >
        {toasts.map((t) => (
          <Alert
            key={t.id}
            color={t.color}
            icon={
              t.color === "red" ? (
                <IconAlertCircle size={16} />
              ) : t.color === "green" ? (
                <IconCheck size={16} />
              ) : (
                <IconInfoCircle size={16} />
              )
            }
            title={t.title}
            variant="filled"
            radius="md"
            withCloseButton
            onClose={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            styles={{ root: { boxShadow: "0 8px 24px rgba(0,0,0,0.3)" } }}
          >
            {t.body}
          </Alert>
        ))}
      </Box>

      <Stack gap="lg">
        {error && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="red"
            variant="light"
            radius="md"
          >
            Failed to load WFH data: {error}
          </Alert>
        )}

        {!identity?.name && (
          <Alert
            icon={<IconUser size={16} />}
            color="cyan"
            variant="light"
            radius="md"
            title="Identity required"
          >
            To apply for WFH, set who you are first. Use the Break Tracker
            widget's "Pick who you are" panel — that identity is shared
            across the dashboard.
          </Alert>
        )}

        {/* ---- Stats row ---------------------------------------------------- */}
        <Grid gutter="md">
          <Grid.Col span={{ base: 4 }}>
            <StatCard
              label="Pending"
              value={pending.length}
              color="yellow"
            />
          </Grid.Col>
          <Grid.Col span={{ base: 4 }}>
            <StatCard
              label="Approved"
              value={approved.length}
              color="green"
            />
          </Grid.Col>
          <Grid.Col span={{ base: 4 }}>
            <StatCard
              label="Denied"
              value={denied.length}
              color="red"
            />
          </Grid.Col>
        </Grid>

        {/* ---- Submission form --------------------------------------------- */}
        {identity?.name && (
          <Card radius="md" withBorder p="lg" style={{ background: "var(--mantine-color-dark-7)" }}>
            <Stack gap="md">
              <Group justify="space-between">
                <Group gap="sm">
                  <ThemeIcon variant="light" color="cyan" radius="md">
                    <IconHome size={16} />
                  </ThemeIcon>
                  <Box>
                    <Text fw={600}>Apply for WFH</Text>
                    <Text size="xs" c="dimmed">
                      Submitting as {identity.name}
                    </Text>
                  </Box>
                </Group>
              </Group>
              <Grid gutter="sm" align="flex-end">
                <Grid.Col span={{ base: 12, sm: 4 }}>
                  <DatePickerInput
                    label="Start date"
                    placeholder="Pick start"
                    value={startDate}
                    onChange={(v) => {
                      // @mantine/dates 7 returns Date | null
                      const d = v as Date | null;
                      setStartDate(d);
                      // If end is before start, auto-set end = start
                      if (d && endDate && endDate < d) setEndDate(d);
                    }}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 4 }}>
                  <DatePickerInput
                    label="End date"
                    placeholder="Pick end"
                    value={endDate}
                    onChange={(v) => setEndDate(v as Date | null)}
                    minDate={startDate ?? new Date()}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 4 }}>
                  <Box>
                    <Text size="xs" c="dimmed">
                      Duration
                    </Text>
                    <Text fw={500} mt={4}>
                      {startDate && endDate
                        ? `${dayCount(
                            toISODateString(startDate)!,
                            toISODateString(endDate)!,
                          )} day${
                            dayCount(
                              toISODateString(startDate)!,
                              toISODateString(endDate)!,
                            ) === 1
                              ? ""
                              : "s"
                          }`
                        : "—"}
                    </Text>
                  </Box>
                </Grid.Col>
              </Grid>
              <Textarea
                label="Reason"
                placeholder="e.g. Doctor appointment in the morning, family commitment, etc."
                value={reason}
                onChange={(e) => setReason(e.currentTarget.value)}
                minRows={2}
                autosize
                maxRows={4}
              />
              <Group justify="space-between" align="center">
                <Text size="xs" c="dimmed">
                  Posts a notification to #noc-team and pings {approverName}.
                </Text>
                <Button
                  onClick={handleSubmit}
                  loading={submitting}
                  disabled={!startDate || !endDate || reason.trim().length < 3}
                  color="cyan"
                  leftSection={<IconHome size={16} />}
                >
                  Submit Request
                </Button>
              </Group>
            </Stack>
          </Card>
        )}

        {/* ---- Requests list ----------------------------------------------- */}
        {isApprover ? (
          <Tabs defaultValue="pending" variant="default" keepMounted={false}>
            <Tabs.List>
              <Tabs.Tab
                value="pending"
                leftSection={<IconUserCheck size={14} />}
                rightSection={
                  pending.length > 0 ? (
                    <Badge size="sm" circle color="red">
                      {pending.length}
                    </Badge>
                  ) : null
                }
              >
                Pending
              </Tabs.Tab>
              <Tabs.Tab value="approved" leftSection={<IconCheck size={14} />}>
                Approved ({approved.length})
              </Tabs.Tab>
              <Tabs.Tab value="denied" leftSection={<IconX size={14} />}>
                Denied ({denied.length})
              </Tabs.Tab>
              <Tabs.Tab value="all">All ({requests.length})</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="pending" pt="md">
              <RequestTable
                requests={pending}
                showActions
                onDecide={(req, decision) => {
                  setDeciding({ request: req, decision });
                  setDecisionNote("");
                }}
              />
            </Tabs.Panel>
            <Tabs.Panel value="approved" pt="md">
              <RequestTable requests={approved} />
            </Tabs.Panel>
            <Tabs.Panel value="denied" pt="md">
              <RequestTable requests={denied} />
            </Tabs.Panel>
            <Tabs.Panel value="all" pt="md">
              <RequestTable requests={requests} />
            </Tabs.Panel>
          </Tabs>
        ) : (
          identity?.name && (
            <Box>
              <Group justify="space-between" mb="sm">
                <Text size="sm" fw={600} c="dimmed">
                  Your requests
                </Text>
                <Text size="xs" c="dimmed">
                  {requests.length} total
                </Text>
              </Group>
              <RequestTable requests={requests} />
            </Box>
          )
        )}

        {data && (
          <Text size="xs" c="dimmed" ta="right">
            Approver: {approverName} ·
            {" "}
            {NOC_ROSTER.length} team members ·
            {" "}
            Auto-refreshes every 30s
          </Text>
        )}
      </Stack>

      {/* ---- Decision modal ------------------------------------------------ */}
      <Modal
        opened={!!deciding}
        onClose={() => !decisionWorking && setDeciding(null)}
        title={
          deciding?.decision === "approved"
            ? "Approve WFH request"
            : "Deny WFH request"
        }
        size="md"
        centered
      >
        {deciding && (
          <Stack gap="md">
            <Card radius="md" withBorder p="sm">
              <Stack gap={4}>
                <Group justify="space-between">
                  <Text fw={600}>{deciding.request.employee_name}</Text>
                  <Badge variant="light" color="cyan">
                    {formatDateRange(
                      deciding.request.start_date,
                      deciding.request.end_date,
                    )}{" "}
                    ·{" "}
                    {dayCount(
                      deciding.request.start_date,
                      deciding.request.end_date,
                    )}{" "}
                    day
                    {dayCount(
                      deciding.request.start_date,
                      deciding.request.end_date,
                    ) === 1
                      ? ""
                      : "s"}
                  </Badge>
                </Group>
                <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                  {deciding.request.reason}
                </Text>
                <Text size="xs" c="dimmed" mt={4}>
                  Submitted {new Date(deciding.request.submitted_at).toLocaleString()}
                </Text>
              </Stack>
            </Card>
            <Textarea
              label="Note to employee (optional)"
              placeholder={
                deciding.decision === "approved"
                  ? "e.g. Approved, please update your calendar."
                  : "e.g. Cannot approve — need on-site presence that day."
              }
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.currentTarget.value)}
              minRows={2}
              autosize
              maxRows={4}
            />
            <Group justify="flex-end">
              <Button
                variant="subtle"
                color="gray"
                onClick={() => setDeciding(null)}
                disabled={decisionWorking}
              >
                Cancel
              </Button>
              <Button
                color={deciding.decision === "approved" ? "green" : "red"}
                onClick={handleDecision}
                loading={decisionWorking}
                leftSection={
                  deciding.decision === "approved" ? (
                    <IconCheck size={16} />
                  ) : (
                    <IconX size={16} />
                  )
                }
              >
                Confirm {deciding.decision === "approved" ? "Approval" : "Denial"}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </WidgetFrame>
  );
}

// ---- Helpers --------------------------------------------------------------

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <Card radius="md" withBorder p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text c={color} fw={700} mt={4} style={{ fontSize: 24, lineHeight: 1 }}>
        {value}
      </Text>
    </Card>
  );
}

function RequestTable({
  requests,
  showActions,
  onDecide,
}: {
  requests: WfhRequest[];
  showActions?: boolean;
  onDecide?: (req: WfhRequest, decision: "approved" | "denied") => void;
}) {
  if (requests.length === 0) {
    return (
      <Box p="xl" ta="center">
        <Text c="dimmed" size="sm">
          No requests in this category.
        </Text>
      </Box>
    );
  }
  return (
    <ScrollArea.Autosize mah={420} type="auto">
      <Table verticalSpacing="sm" horizontalSpacing="md" stickyHeader>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Employee</Table.Th>
            <Table.Th>Dates</Table.Th>
            <Table.Th>Days</Table.Th>
            <Table.Th>Reason</Table.Th>
            <Table.Th>Submitted</Table.Th>
            <Table.Th>Status</Table.Th>
            {showActions && <Table.Th ta="right">Action</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {requests.map((r, idx) => (
            <Table.Tr key={`wfh-request-${r.id}-${idx}`}>
              <Table.Td>
                <Text fw={500}>{r.employee_name}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{formatDateRange(r.start_date, r.end_date)}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" ff="monospace" c="dimmed">
                  {dayCount(r.start_date, r.end_date)}
                </Text>
              </Table.Td>
              <Table.Td style={{ maxWidth: 280 }}>
                <Text size="sm" lineClamp={2} title={r.reason}>
                  {r.reason}
                </Text>
              </Table.Td>
              <Table.Td>
                <Tooltip
                  label={new Date(r.submitted_at).toLocaleString()}
                  withinPortal
                >
                  <Text size="xs" c="dimmed">
                    {timeAgo(r.submitted_at)}
                  </Text>
                </Tooltip>
              </Table.Td>
              <Table.Td>
                <Stack gap={2}>
                  <Badge
                    variant="light"
                    color={WFH_STATUS_COLORS[r.status]}
                    size="sm"
                  >
                    {WFH_STATUS_LABELS[r.status]}
                  </Badge>
                  {r.status !== "pending" && r.reviewed_by && (
                    <Text size="xs" c="dimmed">
                      by {r.reviewed_by.split(" ")[0]}
                    </Text>
                  )}
                  {r.decision_note && (
                    <Tooltip label={r.decision_note} withinPortal>
                      <Text size="xs" c="dimmed" fs="italic" lineClamp={1}>
                        note: {r.decision_note}
                      </Text>
                    </Tooltip>
                  )}
                </Stack>
              </Table.Td>
              {showActions && (
                <Table.Td ta="right">
                  <Group gap={4} wrap="nowrap" justify="flex-end">
                    <Tooltip label="Approve">
                      <ActionIcon
                        variant="light"
                        color="green"
                        size="md"
                        onClick={() => onDecide?.(r, "approved")}
                        aria-label="Approve"
                      >
                        <IconCheck size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Deny">
                      <ActionIcon
                        variant="light"
                        color="red"
                        size="md"
                        onClick={() => onDecide?.(r, "denied")}
                        aria-label="Deny"
                      >
                        <IconX size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              )}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}


