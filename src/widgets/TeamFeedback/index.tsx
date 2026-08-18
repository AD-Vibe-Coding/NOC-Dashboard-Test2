import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
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
  IconMessageCircle,
  IconSend,
} from "@tabler/icons-react";
import { db } from "../../db";
import { useIdentity } from "../../lib/identity";
import { PERSON_TEAM_NAMES } from "../PerformanceTracker/team";
import { WidgetFrame } from "../WidgetFrame";

type FeedbackRow = Awaited<ReturnType<typeof db.manager_feedback.list>>[number];

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
}: {
  row: FeedbackRow;
  action?: React.ReactNode;
}) {
  const isApproved = row.approval_status === "approved";

  return (
    <Card withBorder radius="lg" p="md">
      <Stack gap={6}>
        <Group justify="space-between" align="flex-start">
          <Group gap="xs" wrap="wrap">
            <Badge color="violet" variant="light">From: {row.feedback_from}</Badge>
            <Badge color="blue" variant="light">For: {row.feedback_for}</Badge>
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
        <Group justify="space-between" align="center">
          <Stack gap={0}>
            <Text size="xs" c="dimmed">Submitted by {row.submitted_by ?? "—"}</Text>
            {isApproved ? (
              <Text size="xs" c="dimmed">
                Approved by {row.approved_by ?? "—"} on {formatDate(row.approved_at)}
              </Text>
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
  const isManager = identity?.role === "manager";
  const submittedBy = identity?.name?.trim() || "Unknown";

  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [feedbackFrom, setFeedbackFrom] = useState<string | null>(identity?.name?.trim() || null);
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [ticketNumber, setTicketNumber] = useState("");
  const [comment, setComment] = useState("");

  const teamOptions = useMemo(
    () => PERSON_TEAM_NAMES.map((name) => ({ value: name, label: name })),
    [],
  );

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
      const result = await db.manager_feedback.list({
        orderBy: { column: "created_at", ascending: false },
        limit: isManager ? 100 : 50,
      });
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
      await db.manager_feedback.insert({
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
      await db.manager_feedback.updateById(id, { approval_status: "approved" } as Partial<FeedbackRow>);
      setSuccessMessage("Feedback approved and is now visible to the recipient.");
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <WidgetFrame title="Team Feedback" icon={IconMessageCircle} iconColor="violet">
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
                {isManager ? `${pendingRows.length} pending` : "Submit only"}
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
                        action={
                          <Button
                            size="xs"
                            color="teal"
                            leftSection={<IconCheck size={14} />}
                            loading={approvingId === row.id}
                            onClick={() => void approveFeedback(Number(row.id))}
                          >
                            Approve
                          </Button>
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
                    <FeedbackCard key={row.id} row={row} />
                  ))}
                </Stack>
              )}
            </Stack>
          </Stack>
        ) : (
          <Stack gap="sm">
            <Group justify="space-between" align="center">
              <Text fw={700}>Approved feedback shared with you</Text>
              <Badge variant="light" color="teal">{rows.length} visible</Badge>
            </Group>

            {rows.length === 0 ? (
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
                {rows.map((row) => (
                  <FeedbackCard key={row.id} row={row} />
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
  const isManager = identity?.role === "manager";
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    db.manager_feedback
      .list({ orderBy: { column: "created_at", ascending: false }, limit: 100 })
      .then((result) => {
        const rows = Array.isArray(result) ? result : [];
        if (isManager) {
          setCount(rows.filter((row) => row.approval_status !== "approved").length);
        } else {
          setCount(rows.length);
        }
      })
      .catch(() => setCount(0));
  }, [isManager]);

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
          {count !== null ? (
            <Badge size="xs" variant="light" color={isManager ? "orange" : "teal"} mt={4}>
              {isManager ? `${count} pending review` : `${count} approved for you`}
            </Badge>
          ) : null}
        </Stack>
      </Group>
    </Card>
  );
}
