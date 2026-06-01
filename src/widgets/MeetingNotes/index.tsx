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
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconChecklist,
  IconClipboardText,
  IconMailSpark,
  IconNotes,
  IconPlus,
  IconSend,
  IconSparkles,
  IconUserCheck,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { LOCKED_TEAM_NAMES } from "../PerformanceTracker/team";
import { useIdentity } from "../../lib/identity";
import { useCompletion } from "../../lib/devs-ai/use-completion";
import { db } from "../../db";

export { MeetingNotesTile } from "./Tile";

type OneOnOneNote = Awaited<ReturnType<typeof db.one_on_one_notes.list>>[number];
type PersonalActionItem = Awaited<ReturnType<typeof db.personal_action_items.list>>[number];

type StructuredSummary = {
  title: string;
  summary: string;
  discussionPoints: string[];
  managerActionItems: string[];
  employeeActionItems: string[];
};

type GmailNoteMessage = {
  id: string;
  threadId: string | null;
  subject: string;
  from: string | null;
  date: string | null;
  snippet: string;
  body: string;
  imported: boolean;
  internalDate: string | null;
  labelQuery: string;
};

const SOURCE_OPTIONS = [
  { value: "gmail_gemini", label: "Gemini notes from Gmail" },
  { value: "pasted", label: "Paste meeting notes" },
  { value: "manual", label: "Manual summary" },
];

function parseJsonSummary(input: string): StructuredSummary | null {
  try {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    if (start < 0 || end < 0 || end <= start) return null;
    const parsed = JSON.parse(input.slice(start, end + 1)) as Partial<StructuredSummary>;
    return {
      title: String(parsed.title ?? "1:1 meeting summary").trim() || "1:1 meeting summary",
      summary: String(parsed.summary ?? "").trim(),
      discussionPoints: Array.isArray(parsed.discussionPoints) ? parsed.discussionPoints.map(String).filter(Boolean) : [],
      managerActionItems: Array.isArray(parsed.managerActionItems) ? parsed.managerActionItems.map(String).filter(Boolean) : [],
      employeeActionItems: Array.isArray(parsed.employeeActionItems) ? parsed.employeeActionItems.map(String).filter(Boolean) : [],
    };
  } catch {
    return null;
  }
}

function safeJsonArray(text: string | null | undefined): string[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function MarkdownBlock({ text }: { text: string }) {
  return <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{text}</Text>;
}

function NotesCard({ note, managerView }: { note: OneOnOneNote; managerView: boolean }) {
  const discussion = safeJsonArray(note.discussion_points_json);
  const managerItems = safeJsonArray(note.manager_action_items_json);
  const employeeItems = safeJsonArray(note.employee_action_items_json);

  return (
    <Card withBorder radius="lg" p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text fw={700}>{note.title}</Text>
            <Text size="xs" c="dimmed">
              {managerView ? `For ${note.employee_name}` : `Shared by ${note.manager_name}`} · {formatDate(note.meeting_date)}
            </Text>
          </Stack>
          <Badge color={note.status === "shared" ? "green" : "yellow"} variant="light">
            {note.status}
          </Badge>
        </Group>

        <MarkdownBlock text={note.summary_markdown} />

        {discussion.length > 0 && (
          <Stack gap={4}>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed">Discussion points</Text>
            {discussion.map((item, index) => <Text key={`${note.id}-d-${index}`} size="sm">• {item}</Text>)}
          </Stack>
        )}

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Card withBorder radius="md" p="sm">
            <Stack gap={4}>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">Manager action items</Text>
              {managerItems.length > 0
                ? managerItems.map((item, index) => <Text key={`${note.id}-m-${index}`} size="sm">• {item}</Text>)
                : <Text size="sm" c="dimmed">No manager action items.</Text>}
            </Stack>
          </Card>
          <Card withBorder radius="md" p="sm">
            <Stack gap={4}>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">Employee action items</Text>
              {employeeItems.length > 0
                ? employeeItems.map((item, index) => <Text key={`${note.id}-e-${index}`} size="sm">• {item}</Text>)
                : <Text size="sm" c="dimmed">No employee action items.</Text>}
            </Stack>
          </Card>
        </SimpleGrid>
      </Stack>
    </Card>
  );
}

export function MeetingNotesWidget() {
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<OneOnOneNote[]>([]);
  const [tasks, setTasks] = useState<PersonalActionItem[]>([]);
  const [gmailMessages, setGmailMessages] = useState<GmailNoteMessage[]>([]);
  const [openComposer, setOpenComposer] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [meetingDate, setMeetingDate] = useState("");
  const [sourceType, setSourceType] = useState<string | null>("gmail_gemini");
  const [title, setTitle] = useState("1:1 Meeting Summary");
  const [sourceNotes, setSourceNotes] = useState("");
  const [importedMessageId, setImportedMessageId] = useState<string | null>(null);
  const [importedMessageSubject, setImportedMessageSubject] = useState<string | null>(null);
  const [summaryMarkdown, setSummaryMarkdown] = useState("");
  const [discussionPoints, setDiscussionPoints] = useState("");
  const [managerActionItems, setManagerActionItems] = useState("");
  const [employeeActionItems, setEmployeeActionItems] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDetails, setTaskDetails] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const { complete, result, isLoading: aiLoading, error: aiError } = useCompletion();

  async function load() {
    if (!identity?.name) return;
    setLoading(true);
    setError(null);
    try {
      const [noteRows, taskRows] = await Promise.all([
        db.one_on_one_notes.list({ orderBy: { column: "created_at", ascending: false } }),
        db.personal_action_items.list({ orderBy: { column: "created_at", ascending: false } }),
      ]);
      setNotes(noteRows);
      setTasks(taskRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [identity?.name]);

  const myReceivedNotes = useMemo(() => {
    if (!identity?.name) return [] as OneOnOneNote[];
    return notes.filter((note) => note.employee_name === identity.name && note.status === "shared");
  }, [identity?.name, notes]);

  const myTasks = useMemo(() => {
    if (!identity?.name) return [] as PersonalActionItem[];
    return tasks.filter((task) => task.employee_name === identity.name);
  }, [identity?.name, tasks]);

  const managerDrafts = useMemo(() => {
    if (!identity?.name) return [] as OneOnOneNote[];
    return notes.filter((note) => note.manager_name === identity.name);
  }, [identity?.name, notes]);

  function resetComposer() {
    setSelectedEmployee(null);
    setMeetingDate("");
    setSourceType("gmail_gemini");
    setTitle("1:1 Meeting Summary");
    setSourceNotes("");
    setImportedMessageId(null);
    setImportedMessageSubject(null);
    setSummaryMarkdown("");
    setDiscussionPoints("");
    setManagerActionItems("");
    setEmployeeActionItems("");
    setGmailMessages([]);
  }

  function applyImportedMessage(message: GmailNoteMessage) {
    setSourceType("gmail_gemini");
    setSourceNotes(message.body || message.snippet || "");
    setImportedMessageId(message.id);
    setImportedMessageSubject(message.subject);
    setTitle(message.subject?.trim() || "1:1 Meeting Summary");
    if (message.internalDate) setMeetingDate(message.internalDate.slice(0, 10));
  }

  async function loadGmailNotes() {
    if (!isManager) return;
    setGmailLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/gmail/meeting-notes?max=5");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      const messages = Array.isArray(payload.messages) ? (payload.messages as GmailNoteMessage[]) : [];
      setGmailMessages(messages);
      if (messages.length > 0 && !sourceNotes.trim()) {
        applyImportedMessage(messages[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGmailLoading(false);
    }
  }

  useEffect(() => {
    if (openComposer && isManager && sourceType === "gmail_gemini" && !sourceNotes.trim() && gmailMessages.length === 0) {
      void loadGmailNotes();
    }
  }, [openComposer, isManager, sourceType, sourceNotes, gmailMessages.length]);

  async function generateFromNotes() {
    if (!sourceNotes.trim()) {
      setError("Import or paste the Gemini/Gmail meeting notes first.");
      return;
    }
    setError(null);
    const prompt = `Turn these 1:1 meeting notes into JSON with this exact shape: {"title":"...","summary":"...","discussionPoints":["..."],"managerActionItems":["..."],"employeeActionItems":["..."]}. Keep each bullet concise and factual. Notes:\n\n${sourceNotes}`;
    const raw = await complete(prompt);
    const parsed = parseJsonSummary(raw);
    if (!parsed) {
      setError("The notes were generated, but the structured format could not be parsed. You can still edit the fields manually.");
      return;
    }
    setTitle(parsed.title);
    setSummaryMarkdown(parsed.summary);
    setDiscussionPoints(parsed.discussionPoints.join("\n"));
    setManagerActionItems(parsed.managerActionItems.join("\n"));
    setEmployeeActionItems(parsed.employeeActionItems.join("\n"));
  }

  async function saveNote(status: "draft" | "shared") {
    if (!identity?.name) return;
    if (!selectedEmployee) {
      setError("Choose the employee receiving the 1:1 notes.");
      return;
    }
    if (!summaryMarkdown.trim()) {
      setError("Add or generate the meeting summary first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await db.one_on_one_notes.insert({
        manager_name: identity.name,
        employee_name: selectedEmployee,
        title: title.trim() || "1:1 Meeting Summary",
        meeting_date: meetingDate || null,
        source_type: sourceType || "manual",
        source_message_id: importedMessageId,
        source_subject: importedMessageSubject,
        source_excerpt: sourceNotes.slice(0, 280) || null,
        source_body: sourceNotes || null,
        summary_markdown: summaryMarkdown,
        discussion_points_json: JSON.stringify(discussionPoints.split("\n").map((x) => x.trim()).filter(Boolean)),
        manager_action_items_json: JSON.stringify(managerActionItems.split("\n").map((x) => x.trim()).filter(Boolean)),
        employee_action_items_json: JSON.stringify(employeeActionItems.split("\n").map((x) => x.trim()).filter(Boolean)),
        status,
        shared_at: status === "shared" ? new Date().toISOString() : null,
      });
      setOpenComposer(false);
      resetComposer();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function addTask() {
    if (!identity?.name || !taskTitle.trim()) return;
    setSaving(true);
    try {
      await db.personal_action_items.insert({
        employee_name: identity.name,
        note_id: null,
        title: taskTitle.trim(),
        details: taskDetails.trim() || null,
        status: "open",
        due_date: taskDueDate || null,
        created_by: identity.name,
      });
      setTaskTitle("");
      setTaskDetails("");
      setTaskDueDate("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function updateTaskStatus(task: PersonalActionItem, status: string) {
    await db.personal_action_items.updateById(task.id, { status });
    await load();
  }

  return (
    <WidgetFrame
      title="1:1 Notes"
      subtitle={isManager ? "Prepare, structure, and share meeting summaries" : "Receive summaries and manage your action items"}
      icon={IconNotes}
      iconColor="grape"
      loading={loading}
      onRefresh={load}
      headerActions={isManager ? (
        <Group gap="xs">
          <Button
            size="xs"
            variant="light"
            color="grape"
            leftSection={<IconMailSpark size={14} />}
            onClick={() => {
              resetComposer();
              setOpenComposer(true);
              void loadGmailNotes();
            }}
            loading={gmailLoading}
          >
            Pull Gmail notes
          </Button>
          <Button
            size="xs"
            variant="light"
            color="grape"
            leftSection={<IconPlus size={14} />}
            onClick={() => {
              resetComposer();
              setOpenComposer(true);
            }}
          >
            New summary
          </Button>
        </Group>
      ) : undefined}
    >
      <Stack gap="md">
        {error && <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">{error}</Alert>}
        {aiError && <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light">AI assistant: {aiError}</Alert>}
        {!isManager && (
          <Alert icon={<IconUserCheck size={16} />} color="blue" variant="light">
            Managers can prepare and send meeting summaries to you. You can add your own personal follow-up tasks below.
          </Alert>
        )}
        {isManager ? (
          <Tabs defaultValue="summaries">
            <Tabs.List>
              <Tabs.Tab value="summaries" leftSection={<IconClipboardText size={14} />}>Meeting summaries</Tabs.Tab>
              <Tabs.Tab value="inbox" leftSection={<IconSend size={14} />}>Shared history</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="summaries" pt="md">
              <Stack gap="md">
                {managerDrafts.length === 0
                  ? <Text size="sm" c="dimmed">No 1:1 summaries yet. Pull the latest Gmail Gemini note or create one manually.</Text>
                  : managerDrafts.map((note) => <NotesCard key={note.id} note={note} managerView />)}
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="inbox" pt="md">
              <Stack gap="md">
                {managerDrafts.filter((note) => note.status === "shared").length === 0
                  ? <Text size="sm" c="dimmed">Nothing has been shared yet.</Text>
                  : managerDrafts.filter((note) => note.status === "shared").map((note) => <NotesCard key={note.id} note={note} managerView />)}
              </Stack>
            </Tabs.Panel>
          </Tabs>
        ) : (
          <Tabs defaultValue="received">
            <Tabs.List>
              <Tabs.Tab value="received" leftSection={<IconMailSpark size={14} />}>Received summaries</Tabs.Tab>
              <Tabs.Tab value="tasks" leftSection={<IconChecklist size={14} />}>My action items</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="received" pt="md">
              <Stack gap="md">
                {myReceivedNotes.length === 0
                  ? <Text size="sm" c="dimmed">No meeting summaries have been shared with you yet.</Text>
                  : myReceivedNotes.map((note) => <NotesCard key={note.id} note={note} managerView={false} />)}
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="tasks" pt="md">
              <Stack gap="md">
                <Card withBorder radius="lg" p="md">
                  <Stack gap="sm">
                    <Text fw={700}>Create a personal follow-up task</Text>
                    <TextInput label="Task title" value={taskTitle} onChange={(e) => setTaskTitle(e.currentTarget.value)} placeholder="Follow up on feedback" />
                    <Textarea label="Details" value={taskDetails} onChange={(e) => setTaskDetails(e.currentTarget.value)} minRows={3} placeholder="Add context or next steps" />
                    <TextInput label="Due date" type="date" value={taskDueDate} onChange={(e) => setTaskDueDate(e.currentTarget.value)} />
                    <Group justify="flex-end">
                      <Button onClick={() => void addTask()} loading={saving} leftSection={<IconPlus size={14} />}>Add task</Button>
                    </Group>
                  </Stack>
                </Card>
                <Card withBorder radius="lg" p={0}>
                  <Table highlightOnHover horizontalSpacing="md" verticalSpacing="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Task</Table.Th>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>Due</Table.Th>
                        <Table.Th>Action</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {myTasks.length === 0 ? (
                        <Table.Tr><Table.Td colSpan={4}><Text size="sm" c="dimmed" ta="center">No personal tasks yet.</Text></Table.Td></Table.Tr>
                      ) : myTasks.map((task) => (
                        <Table.Tr key={task.id}>
                          <Table.Td>
                            <Text fw={600}>{task.title}</Text>
                            {task.details && <Text size="xs" c="dimmed">{task.details}</Text>}
                          </Table.Td>
                          <Table.Td><Badge variant="light" color={task.status === "done" ? "green" : task.status === "in_progress" ? "blue" : "yellow"}>{task.status}</Badge></Table.Td>
                          <Table.Td>{task.due_date || "—"}</Table.Td>
                          <Table.Td>
                            <Group gap="xs">
                              {task.status !== "in_progress" && <Button size="xs" variant="light" onClick={() => void updateTaskStatus(task, "in_progress")}>Start</Button>}
                              {task.status !== "done" && <Button size="xs" variant="light" color="green" onClick={() => void updateTaskStatus(task, "done")}>Done</Button>}
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Card>
              </Stack>
            </Tabs.Panel>
          </Tabs>
        )}
      </Stack>

      <Modal opened={openComposer} onClose={() => setOpenComposer(false)} title="Prepare 1:1 meeting summary" centered size="xl">
        <Stack gap="md">
          <Alert icon={<IconMailSpark size={16} />} color="grape" variant="light">
            Managers can pull Gmail messages automatically from <strong>label:gemini-notes</strong>. Review the imported note, structure it, then push it to the employee.
          </Alert>

          <Group justify="space-between">
            <Text size="sm" c="dimmed">Gmail label source: <strong>label:gemini-notes</strong></Text>
            <Button size="xs" variant="light" leftSection={<IconMailSpark size={14} />} onClick={() => void loadGmailNotes()} loading={gmailLoading}>
              Refresh Gmail notes
            </Button>
          </Group>

          {gmailMessages.length > 0 && (
            <Card withBorder radius="lg" p="md">
              <Stack gap="sm">
                <Text fw={700}>Recent labeled Gmail notes</Text>
                {gmailMessages.map((message) => (
                  <Card key={message.id} withBorder radius="md" p="sm">
                    <Group justify="space-between" align="flex-start">
                      <Stack gap={2} style={{ flex: 1 }}>
                        <Text fw={600}>{message.subject}</Text>
                        <Text size="xs" c="dimmed">
                          {formatDate(message.internalDate ?? message.date)}{message.from ? ` · ${message.from}` : ""}
                        </Text>
                        <Text size="sm" c="dimmed" lineClamp={2}>{message.snippet || message.body}</Text>
                      </Stack>
                      <Group gap="xs">
                        {message.imported && <Badge variant="light" color="yellow">Already used</Badge>}
                        <Button size="xs" variant="light" onClick={() => applyImportedMessage(message)}>Use this note</Button>
                      </Group>
                    </Group>
                  </Card>
                ))}
              </Stack>
            </Card>
          )}

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
            <Select label="Employee" data={LOCKED_TEAM_NAMES.map((name) => ({ value: name, label: name }))} value={selectedEmployee} onChange={setSelectedEmployee} searchable />
            <TextInput label="Meeting date" type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.currentTarget.value)} />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
            <Select label="Source" data={SOURCE_OPTIONS} value={sourceType} onChange={setSourceType} allowDeselect={false} />
            <TextInput label="Title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
          </SimpleGrid>

          <Textarea label="Gemini / Gmail notes" minRows={8} value={sourceNotes} onChange={(e) => setSourceNotes(e.currentTarget.value)} placeholder="Imported Gmail note body or pasted Gemini-generated notes" />

          <Group justify="space-between">
            <Group gap="xs">
              <Button variant="light" leftSection={<IconSparkles size={14} />} onClick={() => void generateFromNotes()} loading={aiLoading}>Prepare summary</Button>
              {result && <Badge variant="light" color="grape">AI structured</Badge>}
            </Group>
            <Group gap="xs">
              <Button variant="default" onClick={() => setOpenComposer(false)}>Cancel</Button>
              <Button variant="light" color="yellow" leftSection={<IconClipboardText size={14} />} onClick={() => void saveNote("draft")} loading={saving}>Save draft</Button>
              <Button color="grape" leftSection={<IconSend size={14} />} onClick={() => void saveNote("shared")} loading={saving}>Push to individual</Button>
            </Group>
          </Group>

          <Divider />

          <Textarea label="Meeting summary" minRows={6} value={summaryMarkdown} onChange={(e) => setSummaryMarkdown(e.currentTarget.value)} placeholder="Clean summary with context, feedback, and outcomes" />
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
            <Textarea label="Discussion points" minRows={6} value={discussionPoints} onChange={(e) => setDiscussionPoints(e.currentTarget.value)} placeholder="One item per line" />
            <Textarea label="Manager action items" minRows={6} value={managerActionItems} onChange={(e) => setManagerActionItems(e.currentTarget.value)} placeholder="One item per line" />
            <Textarea label="Employee action items" minRows={6} value={employeeActionItems} onChange={(e) => setEmployeeActionItems(e.currentTarget.value)} placeholder="One item per line" />
          </SimpleGrid>
        </Stack>
      </Modal>
    </WidgetFrame>
  );
}
