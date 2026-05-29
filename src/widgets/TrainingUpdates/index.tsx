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
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import {
  IconAlertCircle,
  IconCalendarEvent,
  IconCheck,
  IconPlus,
  IconSchool,
  IconSend,
  IconTrash,
  IconUserCheck,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { useIdentity } from "../../lib/identity";
import { useTrainingNotifications } from "../../lib/training-notifications";

export { TrainingUpdatesTile } from "./Tile";

type TrainingRequest = {
  id: number;
  requester_name: string;
  requester_email?: string | null;
  training_title: string;
  training_type: string;
  due_date?: string | null;
  details?: string | null;
  status: "requested" | "submitted";
  manager_note?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
};

type UpcomingTraining = {
  id: number;
  title: string;
  description: string;
  training_date: string;
  audience: string;
  posted_by: string;
  created_at: string;
};

function toIsoDate(value: Date | null) {
  if (!value) return "";
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function TrainingUpdatesWidget() {
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<TrainingRequest[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingTraining[]>([]);

  const [trainingTitle, setTrainingTitle] = useState("");
  const [trainingType, setTrainingType] = useState<string | null>("required");
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [postTitle, setPostTitle] = useState("");
  const [postDescription, setPostDescription] = useState("");
  const [postAudience, setPostAudience] = useState<string | null>("all");
  const [postDate, setPostDate] = useState<Date | null>(null);
  const [posting, setPosting] = useState(false);

  const [reviewing, setReviewing] = useState<TrainingRequest | null>(null);
  const [managerNote, setManagerNote] = useState("");
  const [reviewWorking, setReviewWorking] = useState(false);
  const { pendingCount: upcomingNotificationCount } = useTrainingNotifications();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [reqRes, upRes] = await Promise.all([
        fetch("/api/training_requests"),
        fetch("/api/upcoming_trainings"),
      ]);
      const reqJson = await reqRes.json();
      const upJson = await upRes.json();
      if (!reqRes.ok) throw new Error(reqJson.error ?? "Failed to load training requests");
      if (!upRes.ok) throw new Error(upJson.error ?? "Failed to load upcoming trainings");
      setRequests(reqJson.requests ?? []);
      setUpcoming(upJson.trainings ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const pendingCount = useMemo(() => requests.filter((r) => r.status === "requested").length, [requests]);

  async function submitRequest() {
    if (!trainingTitle.trim() || !trainingType) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/training_requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          training_title: trainingTitle.trim(),
          training_type: trainingType,
          due_date: toIsoDate(dueDate) || undefined,
          details: details.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to submit training request");
      setTrainingTitle("");
      setTrainingType("required");
      setDueDate(null);
      setDetails("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function postUpcoming() {
    if (!postTitle.trim() || !postDescription.trim() || !postAudience || !postDate) return;
    setPosting(true);
    try {
      const res = await fetch("/api/upcoming_trainings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: postTitle.trim(),
          description: postDescription.trim(),
          training_date: toIsoDate(postDate),
          audience: postAudience,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to post upcoming training");
      setPostTitle("");
      setPostDescription("");
      setPostAudience("all");
      setPostDate(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPosting(false);
    }
  }

  async function markSubmitted() {
    if (!reviewing) return;
    setReviewWorking(true);
    try {
      const res = await fetch(`/api/training_requests/${reviewing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "submitted", manager_note: managerNote.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to review request");
      setReviewing(null);
      setManagerNote("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewWorking(false);
    }
  }

  async function removeUpcoming(id: number) {
    try {
      const res = await fetch(`/api/upcoming_trainings/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to delete upcoming training");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <WidgetFrame
      title="Training Updates"
      subtitle={isManager ? "Review agent requests and post upcoming trainings" : "Submit training needs and track requested trainings"}
      icon={IconSchool}
      iconColor="blue"
      loading={loading}
      onRefresh={refresh}
      status={{ label: upcomingNotificationCount > 0 ? `${upcomingNotificationCount} new upcoming` : pendingCount > 0 ? `${pendingCount} pending` : "Up to date", color: upcomingNotificationCount > 0 ? "red" : pendingCount > 0 ? "yellow" : "green" }}
    >
      <Stack gap="lg">
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" radius="md">{error}</Alert>
        )}

        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
          <Card withBorder radius="md" p="md">
            <Stack gap="md">
              <Group gap="xs">
                <ThemeIcon color="blue" variant="light"><IconSend size={16} /></ThemeIcon>
                <Text fw={700}>Submit training request</Text>
              </Group>
              <TextInput label="Training title" placeholder="Example: HIPAA refresher" value={trainingTitle} onChange={(e) => setTrainingTitle(e.currentTarget.value)} />
              <Select
                label="Training type"
                data={[
                  { value: "required", label: "Required" },
                  { value: "certification", label: "Certification" },
                  { value: "upskill", label: "Upskill" },
                  { value: "compliance", label: "Compliance" },
                ]}
                value={trainingType}
                onChange={setTrainingType}
              />
              <DateInput label="Requested due date" value={dueDate} onChange={setDueDate} clearable />
              <Textarea label="Details" minRows={3} placeholder="Add context, links, or why this training is needed" value={details} onChange={(e) => setDetails(e.currentTarget.value)} />
              <Button leftSection={<IconPlus size={16} />} onClick={submitRequest} loading={submitting}>Submit request</Button>
            </Stack>
          </Card>

          <Card withBorder radius="md" p="md">
            <Stack gap="md">
              <Group gap="xs">
                <ThemeIcon color="teal" variant="light"><IconCalendarEvent size={16} /></ThemeIcon>
                <Text fw={700}>Upcoming trainings</Text>
              </Group>
              {upcoming.length === 0 ? (
                <Text size="sm" c="dimmed">No upcoming trainings posted yet.</Text>
              ) : (
                <Stack gap="sm">
                  {upcoming.map((item) => (
                    <Card key={item.id} withBorder radius="md" p="sm">
                      <Group justify="space-between" align="flex-start" wrap="nowrap">
                        <Box style={{ minWidth: 0, flex: 1 }}>
                          <Group gap="xs" mb={4}>
                            <Text fw={600}>{item.title}</Text>
                            <Badge size="xs" variant="light" color="blue">{item.audience}</Badge>
                          </Group>
                          <Text size="sm" c="dimmed">{item.description}</Text>
                          <Text size="xs" c="dimmed" mt={6}>{item.training_date} · posted by {item.posted_by}</Text>
                        </Box>
                        {isManager && (
                          <Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={14} />} onClick={() => removeUpcoming(item.id)}>
                            Remove
                          </Button>
                        )}
                      </Group>
                    </Card>
                  ))}
                </Stack>
              )}
            </Stack>
          </Card>
        </SimpleGrid>

        {isManager && (
          <Card withBorder radius="md" p="md">
            <Stack gap="md">
              <Group gap="xs">
                <ThemeIcon color="grape" variant="light"><IconCalendarEvent size={16} /></ThemeIcon>
                <Text fw={700}>Post upcoming training</Text>
              </Group>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                <TextInput label="Training title" value={postTitle} onChange={(e) => setPostTitle(e.currentTarget.value)} />
                <Select
                  label="Audience"
                  data={[
                    { value: "all", label: "All" },
                    { value: "tier1", label: "Tier 1" },
                    { value: "tier2", label: "Tier 2" },
                    { value: "tier3", label: "Tier 3" },
                    { value: "manager", label: "Manager" },
                  ]}
                  value={postAudience}
                  onChange={setPostAudience}
                />
                <DateInput label="Training date" value={postDate} onChange={setPostDate} clearable />
                <Box />
              </SimpleGrid>
              <Textarea label="Description" minRows={3} value={postDescription} onChange={(e) => setPostDescription(e.currentTarget.value)} />
              <Group justify="flex-end">
                <Button leftSection={<IconPlus size={16} />} onClick={postUpcoming} loading={posting}>Post training</Button>
              </Group>
            </Stack>
          </Card>
        )}

        <Card withBorder radius="md" p="md">
          <Stack gap="md">
            <Group justify="space-between">
              <Group gap="xs">
                <ThemeIcon color="orange" variant="light"><IconUserCheck size={16} /></ThemeIcon>
                <Text fw={700}>Requested trainings</Text>
              </Group>
              <Badge variant="light" color="yellow">{pendingCount} pending</Badge>
            </Group>
            <Divider />
            <Table.ScrollContainer minWidth={900}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Agent</Table.Th>
                    <Table.Th>Training</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Due</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Manager note</Table.Th>
                    {isManager && <Table.Th>Action</Table.Th>}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {requests.length === 0 ? (
                    <Table.Tr><Table.Td colSpan={isManager ? 7 : 6}><Text size="sm" c="dimmed">No training requests yet.</Text></Table.Td></Table.Tr>
                  ) : requests.map((item) => (
                    <Table.Tr key={item.id}>
                      <Table.Td>{item.requester_name}</Table.Td>
                      <Table.Td>
                        <Stack gap={2}>
                          <Text size="sm" fw={600}>{item.training_title}</Text>
                          {item.details && <Text size="xs" c="dimmed">{item.details}</Text>}
                        </Stack>
                      </Table.Td>
                      <Table.Td>{item.training_type}</Table.Td>
                      <Table.Td>{item.due_date ?? "—"}</Table.Td>
                      <Table.Td>
                        <Badge color={item.status === "submitted" ? "green" : "yellow"} variant="light">{item.status}</Badge>
                      </Table.Td>
                      <Table.Td>{item.manager_note ?? (item.reviewed_by ? `Reviewed by ${item.reviewed_by}` : "—")}</Table.Td>
                      {isManager && (
                        <Table.Td>
                          {item.status === "requested" ? (
                            <Button size="xs" variant="light" onClick={() => { setReviewing(item); setManagerNote(item.manager_note ?? ""); }}>
                              Review & submit
                            </Button>
                          ) : (
                            <Text size="xs" c="dimmed">Done</Text>
                          )}
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        </Card>

        <Modal opened={!!reviewing} onClose={() => setReviewing(null)} title="Review training request" centered>
          <Stack gap="md">
            <Text fw={600}>{reviewing?.training_title}</Text>
            <Text size="sm" c="dimmed">{reviewing?.requester_name} · {reviewing?.training_type}</Text>
            <Textarea label="Manager note" minRows={3} value={managerNote} onChange={(e) => setManagerNote(e.currentTarget.value)} placeholder="Optional note before marking submitted" />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setReviewing(null)}>Cancel</Button>
              <Button leftSection={<IconCheck size={16} />} onClick={markSubmitted} loading={reviewWorking}>Mark as submitted</Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </WidgetFrame>
  );
}
