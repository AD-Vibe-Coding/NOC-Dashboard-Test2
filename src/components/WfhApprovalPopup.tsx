import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconX } from "@tabler/icons-react";
import { useWfhData } from "@/widgets/Wfh/data";
import {
  dayCount,
  decideWfhRequest,
  formatDateRange,
  type WfhRequest,
} from "@/lib/wfh";
import { useIdentity } from "@/lib/identity";

type ToastPayload = {
  color: "green" | "red" | "blue" | "yellow";
  title: string;
  body?: string;
};

interface Props {
  showToast?: (toast: ToastPayload) => void;
}

export function WfhApprovalPopup({ showToast }: Props) {
  const { data, refresh } = useWfhData();
  const { identity } = useIdentity();
  const [opened, setOpened] = useState(false);
  const [requestIndex, setRequestIndex] = useState(0);
  const [decision, setDecision] = useState<"approved" | "denied">("approved");
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [seenPendingIds, setSeenPendingIds] = useState<string[]>([]);

  const isApprover = !!data?.is_approver;
  const pending = useMemo(
    () => (data?.requests ?? []).filter((request) => request.status === "pending"),
    [data?.requests],
  );
  const activeRequest = pending[requestIndex] ?? pending[0] ?? null;

  useEffect(() => {
    if (!identity?.name || !isApprover) {
      setOpened(false);
      setRequestIndex(0);
      setDecision("approved");
      setNote("");
      setSeenPendingIds([]);
      return;
    }

    const pendingIds = pending.map((request) => request.id);
    const hasNewPending = pendingIds.some((id) => !seenPendingIds.includes(id));

    if (pendingIds.length === 0) {
      setOpened(false);
      setRequestIndex(0);
      setDecision("approved");
      setNote("");
      setSeenPendingIds([]);
      return;
    }

    if (hasNewPending) {
      setOpened(true);
      setRequestIndex(0);
      setDecision("approved");
      setNote("");
      setSeenPendingIds(pendingIds);
      return;
    }

    setSeenPendingIds((prev) => prev.filter((id) => pendingIds.includes(id)));
    setRequestIndex((prev) => Math.min(prev, Math.max(0, pendingIds.length - 1)));
  }, [identity?.name, isApprover, pending, seenPendingIds]);

  async function processDecision(request: WfhRequest, nextDecision: "approved" | "denied", nextNote: string) {
    const result = await decideWfhRequest(request.id, {
      reviewer: identity?.name ?? "Manager",
      decision: nextDecision,
      note: nextNote.trim() || undefined,
    });

    const channels = ["Slack thread reply"];
    if (result.email_sent) {
      channels.push(`email to ${result.employee_email}`);
    } else if (result.email_error === "disabled") {
      // Email intentionally disabled.
    } else if (result.email_error && !/AI_API_KEY/.test(result.email_error)) {
      channels.push("email failed (see server log)");
    } else if (result.email_error) {
      channels.push("email pending (AI agent not configured)");
    }

    showToast?.({
      color: nextDecision === "approved" ? "green" : "blue",
      title: `${nextDecision === "approved" ? "Approved" : "Denied"} — ${request.employee_name}`,
      body: `${formatDateRange(request.start_date, request.end_date)} · ${channels.join(" · ")}`,
    });
  }

  async function handleConfirm() {
    if (!activeRequest) return;
    setWorking(true);
    try {
      await processDecision(activeRequest, decision, note);
      setDecision("approved");
      setNote("");
      setRequestIndex(0);
      await refresh();
    } catch (err) {
      showToast?.({
        color: "red",
        title: "Decision failed",
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal
      opened={opened && isApprover && pending.length > 0}
      onClose={() => !working && setOpened(false)}
      title="Pending WFH requests"
      size="lg"
      centered
      closeOnClickOutside={!working}
      closeOnEscape={!working}
    >
      {activeRequest && (
        <Stack gap="md">
          <Alert
            color="yellow"
            variant="light"
            icon={<IconAlertCircle size={16} />}
            title={`${pending.length} request${pending.length === 1 ? "" : "s"} waiting for review`}
          >
            Review requests directly from this popup when you log in. You can approve, deny, skip to the next one, or close and return later.
          </Alert>

          <Card radius="md" withBorder p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Box>
                  <Text fw={700} size="lg">{activeRequest.employee_name}</Text>
                  <Text size="sm" c="dimmed">
                    Submitted {new Date(activeRequest.submitted_at).toLocaleString()}
                  </Text>
                </Box>
                <Badge color="yellow" variant="light" size="lg">
                  Request {requestIndex + 1} of {pending.length}
                </Badge>
              </Group>

              <Group gap="xs" wrap="wrap">
                <Badge variant="light" color="cyan">
                  {formatDateRange(activeRequest.start_date, activeRequest.end_date)}
                </Badge>
                <Badge variant="light" color="grape">
                  {dayCount(activeRequest.start_date, activeRequest.end_date)} day{dayCount(activeRequest.start_date, activeRequest.end_date) === 1 ? "" : "s"}
                </Badge>
              </Group>

              <Divider />

              <Box>
                <Text size="xs" tt="uppercase" c="dimmed" fw={700} mb={6}>
                  Reason
                </Text>
                <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                  {activeRequest.reason}
                </Text>
              </Box>
            </Stack>
          </Card>

          <Group gap="sm" grow>
            <Button
              variant={decision === "approved" ? "filled" : "light"}
              color="green"
              leftSection={<IconCheck size={16} />}
              onClick={() => setDecision("approved")}
              disabled={working}
            >
              Approve
            </Button>
            <Button
              variant={decision === "denied" ? "filled" : "light"}
              color="red"
              leftSection={<IconX size={16} />}
              onClick={() => setDecision("denied")}
              disabled={working}
            >
              Deny
            </Button>
          </Group>

          <Textarea
            label="Note to employee (optional)"
            placeholder={
              decision === "approved"
                ? "e.g. Approved, please update your calendar."
                : "e.g. Cannot approve — need on-site presence that day."
            }
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            minRows={2}
            autosize
            maxRows={4}
            disabled={working}
          />

          <Group justify="space-between" wrap="nowrap">
            <Group gap="xs">
              <Button
                variant="subtle"
                color="gray"
                onClick={() => {
                  setRequestIndex((prev) => (prev + 1) % pending.length);
                  setDecision("approved");
                  setNote("");
                }}
                disabled={working || pending.length <= 1}
              >
                Next request
              </Button>
              <Button
                variant="subtle"
                color="gray"
                onClick={() => setOpened(false)}
                disabled={working}
              >
                Remind me later
              </Button>
            </Group>
            <Button
              color={decision === "approved" ? "green" : "red"}
              leftSection={decision === "approved" ? <IconCheck size={16} /> : <IconX size={16} />}
              onClick={handleConfirm}
              loading={working}
            >
              Confirm {decision === "approved" ? "approval" : "denial"}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
