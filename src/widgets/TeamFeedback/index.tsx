import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconClockHour4,
  IconEdit,
  IconMessageCircle,
  IconMessageReply,
  IconSend,
} from "@tabler/icons-react";
import { api } from "../../lib/api";
import { useIdentity } from "../../lib/identity";
import { PERSON_TEAM_NAMES } from "../PerformanceTracker/team";
import { WidgetFrame } from "../WidgetFrame";

type FeedbackRow = {
  id: number;
  feedback_from: string;
  feedback_for: string;
  ticket_number: string | null;
  comment: string;
  recipient_comment: string | null;
  recipient_comment_by: string | null;
  recipient_comment_at: string | null;
  recipient_acknowledged_at: string | null;
  recipient_acknowledged_by: string | null;
  submitted_by: string | null;
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
  recipient_read_at: string | null;
  created_at: string;
};

type FeedbackDraft = {
  id: number;
  feedback_from: string;
  feedback_for: string;
  ticket_number: string;
  comment: string;
};

type RecipientCommentDraft = {
  id: number;
  recipient_comment: string;
};

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong";
}

function FeedbackCard({
  row,
  action,
  isManagerView = false,
}: {
  row: FeedbackRow;
  action?: React.ReactNode;
  isManagerView?: boolean;
}) {
  const isApproved = row.approval_status === "approved";

  return (
    <Card withBorder radius="lg" p="md">
      <Stack gap={6}>
        <Group justify="space-between" align="flex-start">
          <Group gap="xs" wrap="wrap">
            {isManagerView ? (
              <>
                <Badge color="violet" variant="light">From: {row.feedback_from}</Badge>
                <Badge color="blue" variant="light">For: {row.feedback_for}</Badge>
              </>
            ) : null}
            {row.ticket_number ? (
              <Badge color="gray" variant="outline">Ticket #{row.ticket_number}</Badge>
            ) : null}
            <Badge color={isApproved ? "teal" : "orange"} variant="light">
              {isApproved ? "Approved" : "Pending review"}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">{formatDate(row.created_at)}</Text>
        </Group>
        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{row.comment}</Text>
        {row.recipient_comment ? (
          <Card withBorder radius="md" p="sm" bg="var(--mantine-color-gray-0)">
            <Stack gap={2}>
              <Text size="xs" fw={700} c="dimmed">Recipient comment</Text>
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{row.recipient_comment}</Text>
              <Text size="xs" c="dimmed">
                {isManagerView
                  ? `Added by ${row.recipient_comment_by ?? row.feedback_for} on ${formatDate(row.recipient_comment_at)}`
                  : `You added this on ${formatDate(row.recipient_comment_at)}`}
              </Text>
            </Stack>
          </Card>
        ) : null}
        {row.recipient_acknowledged_at ? (
          <Badge color="teal" variant="light" size="sm">
            {isManagerView
              ? `Acknowledged by ${row.recipient_acknowledged_by ?? row.feedback_for} on ${formatDate(row.recipient_acknowledged_at)}`
              : `Acknowledged on ${formatDate(row.recipient_acknowledged_at)}`}
          </Badge>
        ) : null}
        <Group justify="space-between" align="center">
          <Stack gap={0}>
            {isManagerView ? (
              <>
                <Text size="xs" c="dimmed">Submitted by {row.submitted_by ?? "—"}</Text>
                {isApproved ? (
                  <Text size="xs" c="dimmed">
                    Approved by {row.approved_by ?? "—"} on {formatDate(row.approved_at)}
                  </Text>
                ) : null}
              </>
            ) : isApproved ? (
              <Text size="xs" c="dimmed">Shared with you on {formatDate(row.approved_at ?? row.created_at)}</Text>
            ) : null}
          </Stack>
          {action}
        </Group>
      </Stack>
    </Card>
  );
}

export function TeamFeedbackWidget(_props: { onCollapse?: () => void }) {
  const { identity } = useIdentity();
  const role = String(identity?.role ?? "").toLowerCase();
  const isManager = role === "manager";
  const submittedBy = identity?.name?.trim() || "Unknown";
  const currentName = identity?.name?.trim() || "";

  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editingDraft, setEditingDraft] = useState<FeedbackDraft | null>(null);
  const [recipientCommentDraft, setRecipientCommentDraft] = useState<RecipientCommentDraft | null>(null);
  const [recipientCommentSavingId, setRecipientCommentSavingId] = useState<number | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<number | null>(null);

  const [feedbackFrom, setFeedbackFrom] = useState<string | null>(identity?.name?.trim() || null);
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [ticketNumber, setTicketNumber] = useState("");
  const [comment, setComment] = useState("");

  const teamOptions = useMemo(
    () => PERSON_TEAM_NAMES.map((name) => ({ value: name, label: name })),
    [],
  );

  const safeVisibleRows = isManager
    ? rows
    : rows.filter(
        (row) => row.approval_status === "approved" && row.feedback_for?.trim() === currentName,
      );
  const unreadVisibleRows = safeVisibleRows.filter((row) => !row.recipient_read_at);

  const pendingRows = rows.filter((row) => row.approval_status !== "approved");
  const approvedRows = rows.filter((row) => row.approval_status === "approved");

  useEffect(() => {
    if (!isManager) {
      setFeedbackFrom(identity?.name?.trim() || null);
    }
  }, [identity?.name, isManager]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<FeedbackRow[]>(
        isManager ? "/api/manager_feedback" : "/api/manager_feedback?markRead=true"
      );
      setRows(Array.isArray(result) ? result : []);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [isManager]);

  async function submit() {
    const effectiveFrom = isManager ? feedbackFrom : submittedBy;

    if (!effectiveFrom || !feedbackFor || !comment.trim()) {
      setError(
        isManager
          ? "Please select who gave feedback, who it is for, and enter a comment."
          : "Please select who the feedback is for and enter a comment.",
      );
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await api.post<FeedbackRow[]>("/api/manager_feedback", {
        feedback_from: effectiveFrom,
        feedback_for: feedbackFor,
        ticket_number: ticketNumber.trim() || null,
        comment: comment.trim(),
        submitted_by: submittedBy,
      });
      if (isManager) {
        setFeedbackFrom(null);
      }
      setFeedbackFor(null);
      setTicketNumber("");
      setComment("");
      setSuccessMessage(
        isManager
          ? "Feedback saved and approved immediately."
          : "Feedback submitted for manager review.",
      );
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function approveFeedback(id: number) {
    setApprovingId(id);
    setError(null);
    setSuccessMessage(null);
    try {
      await api.patch<FeedbackRow[]>("/api/manager_feedback", {
        id,
        approval_status: "approved",
      });
      setSuccessMessage("Feedback approved and is now visible to the recipient.");
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setApprovingId(null);
    }
  }

  function openEditModal(row: FeedbackRow) {
    setError(null);
    setSuccessMessage(null);
    setEditingDraft({
      id: Number(row.id),
      feedback_from: String(row.feedback_from ?? ""),
      feedback_for: String(row.feedback_for ?? ""),
      ticket_number: String(row.ticket_number ?? ""),
      comment: String(row.comment ?? ""),
    });
  }

  function closeEditModal() {
    if (editingId !== null) return;
    setEditingDraft(null);
  }

  function openRecipientCommentModal(row: FeedbackRow) {
    setError(null);
    setSuccessMessage(null);
    setRecipientCommentDraft({
      id: Number(row.id),
      recipient_comment: String(row.recipient_comment ?? ""),
    });
  }

  function closeRecipientCommentModal() {
    if (recipientCommentSavingId !== null) return;
    setRecipientCommentDraft(null);
  }

  async function saveEdit() {
    if (!editingDraft) return;
    if (!editingDraft.feedback_from.trim() || !editingDraft.feedback_for.trim() || !editingDraft.comment.trim()) {
      setError("Please select who gave feedback, who it is for, and enter a comment.");
      return;
    }

    setEditingId(editingDraft.id);
    setError(null);
    setSuccessMessage(null);
    try {
      await api.patch<FeedbackRow[]>("/api/manager_feedback", {
        id: editingDraft.id,
        feedback_from: editingDraft.feedback_from.trim(),
        feedback_for: editingDraft.feedback_for.trim(),
        ticket_number: editingDraft.ticket_number.trim(),
        comment: editingDraft.comment.trim(),
      });
      setSuccessMessage("Feedback updated successfully.");
      setEditingDraft(null);
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setEditingId(null);
    }
  }

  async function saveRecipientComment() {
    if (!recipientCommentDraft) return;
    if (!recipientCommentDraft.recipient_comment.trim()) {
      setError("Please enter your comment before saving.");
      return;
    }

    setRecipientCommentSavingId(recipientCommentDraft.id);
    setError(null);
    setSuccessMessage(null);
    try {
      await api.patch<FeedbackRow[]>("/api/manager_feedback", {
        id: recipientCommentDraft.id,
        recipient_comment: recipientCommentDraft.recipient_comment.trim(),
      });
      setSuccessMessage("Your comment was added to this feedback.");
      setRecipientCommentDraft(null);
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setRecipientCommentSavingId(null);
    }
  }

  async function acknowledgeFeedback(id: number) {
    setAcknowledgingId(id);
    setError(null);
    setSuccessMessage(null);
    try {
      await api.patch<FeedbackRow[]>("/api/manager_feedback", {
        id,
        recipient_acknowledge: true,
      });
      setSuccessMessage("Feedback acknowledged.");
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setAcknowledgingId(null);
    }
  }

  return (
    <WidgetFrame title="Team Feedback" icon={IconMessageCircle} iconColor="violet">
      <Modal
        opened={Boolean(editingDraft)}
        onClose={closeEditModal}
        title="Edit feedback"
        centered
      >
        {editingDraft ? (
          <Stack gap="md">
            <Select
              label="Who is giving the feedback?"
              placeholder="Select team member"
              data={teamOptions}
              value={editingDraft.feedback_from || null}
              onChange={(value) => setEditingDraft((current) => (current ? { ...current, feedback_from: value ?? "" } : current))}
              searchable
              clearable
              required
            />

            <Select
              label="Who is the feedback for?"
              placeholder="Select recipient"
              data={teamOptions}
              value={editingDraft.feedback_for || null}
              onChange={(value) => setEditingDraft((current) => (current ? { ...current, feedback_for: value ?? "" } : current))}
              searchable
              clearable
              required
            />

            <TextInput
              label="Ticket number"
              placeholder="e.g. 659492"
              value={editingDraft.ticket_number}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setEditingDraft((current) => (current ? { ...current, ticket_number: value } : current));
              }}
            />

            <Textarea
              label="Comment"
              placeholder="Update the feedback…"
              value={editingDraft.comment}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setEditingDraft((current) => (current ? { ...current, comment: value } : current));
              }}
              minRows={4}
              required
            />

            <Group justify="flex-end">
              <Button variant="default" onClick={closeEditModal} disabled={editingId !== null}>Cancel</Button>
              <Button color="violet" leftSection={<IconEdit size={14} />} onClick={() => void saveEdit()} loading={editingId !== null}>
                Save changes
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>

      <Modal
        opened={Boolean(recipientCommentDraft)}
        onClose={closeRecipientCommentModal}
        title="Add your comment"
        centered
      >
        {recipientCommentDraft ? (
          <Stack gap="md">
            <Textarea
              label="Your comment"
              placeholder="Add context, acknowledge the feedback, or note the action you took…"
              value={recipientCommentDraft.recipient_comment}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setRecipientCommentDraft((current) => (current ? { ...current, recipient_comment: value } : current));
              }}
              minRows={4}
              required
            />

            <Group justify="flex-end">
              <Button variant="default" onClick={closeRecipientCommentModal} disabled={recipientCommentSavingId !== null}>Cancel</Button>
              <Button
                color="teal"
                leftSection={<IconMessageReply size={14} />}
                onClick={() => void saveRecipientComment()}
                loading={recipientCommentSavingId !== null}
              >
                Save comment
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>

      <Stack gap="md" p="md">
        {error && (
          <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light">
            {error}
          </Alert>
        )}

        {successMessage && (
          <Alert color="teal" variant="light">
            {successMessage}
          </Alert>
        )}

        <Card withBorder radius="lg" p="lg">
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <div>
                <Text fw={700}>{isManager ? "Capture and review feedback" : "Submit team feedback"}</Text>
                <Text size="sm" c="dimmed">
                  {isManager
                    ? "Review pending peer feedback, approve it, and keep a visible record of what has been shared."
                    : "Share feedback about a teammate's ticket work. A manager must approve it before the recipient can see it."}
                </Text>
              </div>
              <Badge variant="light" color="violet">
                {isManager ? `${pendingRows.length} pending` : `${unreadVisibleRows.length} new for you`}
              </Badge>
            </Group>

            {isManager ? (
              <Select
                label="Who is giving the feedback?"
                placeholder="Select team member"
                data={teamOptions}
                value={feedbackFrom}
                onChange={setFeedbackFrom}
                searchable
                clearable
                required
              />
            ) : null}

            <Select
              label="Who is the feedback for?"
              placeholder="Select recipient"
              data={teamOptions}
              value={feedbackFor}
              onChange={setFeedbackFor}
              searchable
              clearable
              required
            />

            <TextInput
              label="Ticket number"
              placeholder="e.g. 659492"
              value={ticketNumber}
              onChange={(event) => setTicketNumber(event.currentTarget.value)}
            />

            <Textarea
              label="Comment"
              placeholder="Add the feedback received about the work done…"
              value={comment}
              onChange={(event) => setComment(event.currentTarget.value)}
              minRows={4}
              required
            />

            <Group justify="flex-end">
              <Button
                color="violet"
                leftSection={<IconSend size={14} />}
                onClick={() => void submit()}
                loading={saving}
                disabled={isManager ? !feedbackFrom || !feedbackFor || !comment.trim() : !feedbackFor || !comment.trim()}
              >
                {isManager ? "Save & Approve" : "Submit Feedback"}
              </Button>
            </Group>
          </Stack>
        </Card>

        {loading ? (
          <Text size="sm" c="dimmed" ta="center" py="lg">Loading feedback…</Text>
        ) : isManager ? (
          <Stack gap="md">
            <Card withBorder radius="lg" p="lg">
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Group gap="sm">
                    <ThemeIcon size={36} radius="md" color="orange" variant="light">
                      <IconClockHour4 size={18} />
                    </ThemeIcon>
                    <div>
                      <Text fw={700}>Pending manager review</Text>
                      <Text size="sm" c="dimmed">
                        New staff submissions stay here until you approve them for the recipient.
                      </Text>
                    </div>
                  </Group>
                  <Badge variant="light" color="orange">{pendingRows.length} awaiting review</Badge>
                </Group>

                {pendingRows.length === 0 ? (
                  <Text size="sm" c="dimmed">No pending feedback right now.</Text>
                ) : (
                  <Stack gap="sm">
                    {pendingRows.map((row) => (
                      <FeedbackCard
                        key={row.id}
                        row={row}
                        isManagerView={isManager}
                        action={
                          <Group gap="xs">
                            <Button
                              size="xs"
                              variant="default"
                              leftSection={<IconEdit size={14} />}
                              onClick={() => openEditModal(row)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="xs"
                              color="teal"
                              leftSection={<IconCheck size={14} />}
                              loading={approvingId === row.id}
                              onClick={() => void approveFeedback(Number(row.id))}
                            >
                              Approve
                            </Button>
                          </Group>
                        }
                      />
                    ))}
                  </Stack>
                )}
              </Stack>
            </Card>

            <Divider label="Approved feedback" labelPosition="center" />

            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={700}>Approved feedback history</Text>
                <Badge variant="light" color="teal">{approvedRows.length} approved</Badge>
              </Group>

              {approvedRows.length === 0 ? (
                <Card withBorder radius="lg" p="xl">
                  <Stack align="center" gap="xs">
                    <ThemeIcon size={48} radius="xl" color="violet" variant="light">
                      <IconMessageCircle size={24} />
                    </ThemeIcon>
                    <Text fw={700}>No approved feedback yet</Text>
                    <Text size="sm" c="dimmed" ta="center">
                      Approved feedback will appear here after manager review.
                    </Text>
                  </Stack>
                </Card>
              ) : (
                <Stack gap="sm">
                  {approvedRows.map((row) => (
                    <FeedbackCard
                      key={row.id}
                      row={row}
                      isManagerView={isManager}
                      action={
                        <Button
                          size="xs"
                          variant="default"
                          leftSection={<IconEdit size={14} />}
                          onClick={() => openEditModal(row)}
                        >
                          Edit
                        </Button>
                      }
                    />
                  ))}
                </Stack>
              )}
            </Stack>
          </Stack>
        ) : (
          <Stack gap="sm">
            <Group justify="space-between" align="center">
              <Text fw={700}>Approved feedback shared with you</Text>
              <Group gap="xs">
                <Badge variant="light" color="teal">{safeVisibleRows.length} visible</Badge>
                {unreadVisibleRows.length > 0 ? (
                  <Badge variant="light" color="violet">{unreadVisibleRows.length} new</Badge>
                ) : null}
              </Group>
            </Group>

            {safeVisibleRows.length === 0 ? (
              <Card withBorder radius="lg" p="xl">
                <Stack align="center" gap="xs">
                  <ThemeIcon size={48} radius="xl" color="teal" variant="light">
                    <IconCheck size={24} />
                  </ThemeIcon>
                  <Text fw={700}>No approved feedback yet</Text>
                  <Text size="sm" c="dimmed" ta="center">
                    When a manager approves feedback addressed to you, it will appear here.
                  </Text>
                </Stack>
              </Card>
            ) : (
              <Stack gap="sm">
                {safeVisibleRows.map((row) => (
                  <FeedbackCard
                    key={row.id}
                    row={row}
                    isManagerView={isManager}
                    action={
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="default"
                          leftSection={<IconMessageReply size={14} />}
                          onClick={() => openRecipientCommentModal(row)}
                        >
                          {row.recipient_comment ? "Edit comment" : "Add comment"}
                        </Button>
                        {row.recipient_acknowledged_at ? null : (
                          <Button
                            size="xs"
                            color="teal"
                            leftSection={<IconCheck size={14} />}
                            loading={acknowledgingId === row.id}
                            onClick={() => void acknowledgeFeedback(Number(row.id))}
                          >
                            Acknowledge
                          </Button>
                        )}
                      </Group>
                    }
                  />
                ))}
              </Stack>
            )}
          </Stack>
        )}
      </Stack>
    </WidgetFrame>
  );
}

export function TeamFeedbackTile({ onExpand }: { onExpand: () => void }) {
  const { identity } = useIdentity();
  const role = String(identity?.role ?? "").toLowerCase();
  const isManager = role === "manager";
  const currentName = identity?.name?.trim() || "";
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    api.get<FeedbackRow[]>(isManager ? "/api/manager_feedback" : "/api/manager_feedback?markRead=true")
      .then((result: FeedbackRow[]) => {
        const rows = Array.isArray(result) ? result : [];
        if (isManager) {
          setCount(rows.filter((row) => row.approval_status !== "approved").length);
        } else {
          setCount(
            rows.filter(
              (row) =>
                row.approval_status === "approved"
                && row.feedback_for?.trim() === currentName
                && !row.recipient_read_at,
            ).length,
          );
        }
      })
      .catch(() => setCount(0));
  }, [currentName, isManager]);

  return (
    <Card withBorder radius="lg" p="md" style={{ cursor: "pointer", height: "100%" }} onClick={onExpand}>
      <Group gap="sm" align="flex-start">
        <ThemeIcon size={36} radius="md" variant="light" color="violet">
          <IconMessageCircle size={20} />
        </ThemeIcon>
        <Stack gap={2} style={{ flex: 1 }}>
          <Text fw={700} size="sm">Team Feedback</Text>
          <Text size="xs" c="dimmed">
            {isManager ? "Review and approve peer feedback" : "Submit feedback and view approved notes for you"}
          </Text>
          {count !== null && count > 0 ? (
            <Badge size="xs" variant="light" color={isManager ? "orange" : "violet"} mt={4}>
              {isManager ? `${count} pending review` : `${count} new`}
            </Badge>
          ) : null}
        </Stack>
      </Group>
    </Card>
  );
}
