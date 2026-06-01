import { useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Menu,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBook,
  IconChecklist,
  IconClipboardText,
  IconArrowsRight,
  IconDotsVertical,
  IconEdit,
  IconMailSpark,
  IconNotes,
  IconPlus,
  IconSearch,
  IconSend,
  IconSparkles,
  IconStar,
  IconFolders,
  IconStarFilled,
  IconTrash,
  IconUser,
  IconUsersGroup,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { LOCKED_TEAM_NAMES } from "../PerformanceTracker/team";
import { useIdentity } from "../../lib/identity";
import { useCompletion } from "../../lib/devs-ai/use-completion";
import { db } from "../../db";

export { MeetingNotesTile } from "./Tile";

type OneOnOneNote = Awaited<ReturnType<typeof db.one_on_one_notes.list>>[number];
type NotebookSectionPreference = Awaited<ReturnType<typeof db.notebook_section_preferences.list>>[number];
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

type NotebookMode = "individual" | "management" | "other";

type NormalizedNote = OneOnOneNote & {
  notebook_group: NotebookMode;
  section_name: string;
  parent_note_id: number | null;
  is_archived: boolean;
  is_favorite: boolean;
  updated_at: string | null;
  sort_order: number;
};

type SectionRecord = {
  key: string;
  label: string;
  notebook_group: NotebookMode;
  notes: NormalizedNote[];
  favorite: boolean;
};

type SectionTreeNode = {
  key: string;
  label: string;
  fullLabel: string;
  notebook_group: NotebookMode;
  notes: NormalizedNote[];
  favorite: boolean;
  children: SectionTreeNode[];
};

const SOURCE_OPTIONS = [
  { value: "gmail_gemini", label: "Gemini notes from Gmail" },
  { value: "pasted", label: "Paste meeting notes" },
  { value: "manual", label: "Manual summary" },
];

const NOTEBOOK_OPTIONS = [
  { value: "individual", label: "Individual 1:1 notebook" },
  { value: "management", label: "Management meeting notebook" },
  { value: "other", label: "Other notebook" },
];

const TASK_STATUS_OPTIONS = [
  { value: "open", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
];

const TASK_PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const DEFAULT_MANAGEMENT_SECTIONS = [
  "Leadership sync",
  "Manager standup",
  "Operations review",
  "Hiring and staffing",
  "Coaching themes",
  "NOC Team Meetings",
];

const MANAGEMENT_PREFIX = "Management · ";
const OTHER_PREFIX = "Other · ";
const DEFAULT_OTHER_SECTION = "Others";
const SECTION_PATH_SEPARATOR = " / ";

function safeJsonArray(text: string | null | undefined): string[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseJsonSummary(input: string): StructuredSummary | null {
  try {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    if (start < 0 || end < 0 || end <= start) return null;
    const parsed = JSON.parse(input.slice(start, end + 1)) as Partial<StructuredSummary>;
    return {
      title: String(parsed.title ?? "Meeting summary").trim() || "Meeting summary",
      summary: String(parsed.summary ?? "").trim(),
      discussionPoints: Array.isArray(parsed.discussionPoints) ? parsed.discussionPoints.map(String).filter(Boolean) : [],
      managerActionItems: Array.isArray(parsed.managerActionItems) ? parsed.managerActionItems.map(String).filter(Boolean) : [],
      employeeActionItems: Array.isArray(parsed.employeeActionItems) ? parsed.employeeActionItems.map(String).filter(Boolean) : [],
    };
  } catch {
    return null;
  }
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function isManagementEmployeeValue(value: string | null | undefined) {
  return String(value ?? "").startsWith(MANAGEMENT_PREFIX);
}

function isOtherEmployeeValue(value: string | null | undefined) {
  return String(value ?? "").startsWith(OTHER_PREFIX);
}

function deriveNotebookGroup(note: OneOnOneNote): NotebookMode {
  if (note.notebook_group === "management" || note.notebook_group === "individual" || note.notebook_group === "other") return note.notebook_group;
  if (isManagementEmployeeValue(note.employee_name)) return "management";
  if (isOtherEmployeeValue(note.employee_name)) return "other";
  return "individual";
}

function deriveSectionName(note: OneOnOneNote): string {
  if (note.section_name) return note.section_name;
  const group = deriveNotebookGroup(note);
  if (group === "management") {
    return String(note.employee_name ?? "").replace(MANAGEMENT_PREFIX, "") || DEFAULT_MANAGEMENT_SECTIONS[0];
  }
  if (group === "other") {
    return String(note.employee_name ?? "").replace(OTHER_PREFIX, "") || DEFAULT_OTHER_SECTION;
  }
  return String(note.employee_name ?? "");
}

function normalizeNote(note: OneOnOneNote): NormalizedNote {
  return {
    ...note,
    notebook_group: deriveNotebookGroup(note),
    section_name: deriveSectionName(note),
    parent_note_id: note.parent_note_id ?? null,
    is_archived: Boolean(note.is_archived || note.status === "archived"),
    is_favorite: Boolean(note.is_favorite),
    updated_at: note.updated_at ?? note.shared_at ?? null,
    sort_order: note.sort_order ?? 0,
  };
}

function noteMatchesSearch(note: NormalizedNote, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    note.title,
    note.section_name,
    note.manager_name,
    note.employee_name,
    note.summary_markdown,
    note.source_subject,
    note.source_excerpt,
    note.source_body,
    ...safeJsonArray(note.discussion_points_json),
    ...safeJsonArray(note.manager_action_items_json),
    ...safeJsonArray(note.employee_action_items_json),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return haystack.includes(q);
}

function splitSectionPath(label: string) {
  return String(label)
    .split(SECTION_PATH_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
}

function noteSortValue(note: NormalizedNote) {
  return new Date(note.updated_at ?? note.meeting_date ?? note.created_at ?? 0).getTime();
}

function sortNotes(a: NormalizedNote, b: NormalizedNote) {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return noteSortValue(b) - noteSortValue(a);
}

function MarkdownBlock({ text }: { text: string }) {
  return <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{text}</Text>;
}

function DetailCard({ note, managerView }: { note: NormalizedNote; managerView: boolean }) {
  const discussion = safeJsonArray(note.discussion_points_json);
  const managerItems = safeJsonArray(note.manager_action_items_json);
  const employeeItems = safeJsonArray(note.employee_action_items_json);
  const management = note.notebook_group === "management";

  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Group gap="xs">
              <Text fw={700} size="lg">{note.title}</Text>
              <Badge variant="light" color={management ? "blue" : "grape"}>{management ? "Management" : "1:1"}</Badge>
              {note.is_archived && <Badge variant="light" color="gray">Archived</Badge>}
            </Group>
            <Text size="sm" c="dimmed">
              {managerView
                ? `${management ? `Section: ${note.section_name}` : `Employee: ${note.section_name}`} · ${formatDate(note.meeting_date)}`
                : `Shared by ${note.manager_name} · ${formatDate(note.meeting_date)}`}
            </Text>
          </Stack>
          <Badge color={note.status === "shared" ? "green" : note.status === "archived" ? "gray" : "yellow"} variant="light">{note.status}</Badge>
        </Group>

        <MarkdownBlock text={note.summary_markdown} />

        {discussion.length > 0 && (
          <Stack gap={4}>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed">Discussion points</Text>
            {discussion.map((item, index) => <Text key={`${note.id}-discussion-${index}`} size="sm">• {item}</Text>)}
          </Stack>
        )}

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Card withBorder radius="md" p="sm">
            <Stack gap={4}>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">Manager action items</Text>
              {managerItems.length > 0 ? managerItems.map((item, index) => <Text key={`${note.id}-manager-${index}`} size="sm">• {item}</Text>) : <Text size="sm" c="dimmed">No manager action items.</Text>}
            </Stack>
          </Card>
          <Card withBorder radius="md" p="sm">
            <Stack gap={4}>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">{management ? "Team follow-ups" : "Employee action items"}</Text>
              {employeeItems.length > 0 ? employeeItems.map((item, index) => <Text key={`${note.id}-employee-${index}`} size="sm">• {item}</Text>) : <Text size="sm" c="dimmed">No action items.</Text>}
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
  const { complete, result, isLoading: aiLoading, error: aiError } = useCompletion();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rawNotes, setRawNotes] = useState<OneOnOneNote[]>([]);
  const [preferences, setPreferences] = useState<NotebookSectionPreference[]>([]);
  const [tasks, setTasks] = useState<PersonalActionItem[]>([]);
  const [gmailMessages, setGmailMessages] = useState<GmailNoteMessage[]>([]);
  const [gmailStartDate, setGmailStartDate] = useState("2026-04-01");
  const [gmailEndDate, setGmailEndDate] = useState(new Date().toISOString().slice(0, 10));

  const [search, setSearch] = useState("");
  const [showArchived] = useState(false);
  const [activeSectionKey, setActiveSectionKey] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<number | null>(null);
  const [accordionValues, setAccordionValues] = useState<string[]>(["favorites", "individual", "management", "other"]);
  const [managerView, setManagerView] = useState<"notebook" | "all_notes" | "actions">("notebook");
  const [noteGroupFilter, setNoteGroupFilter] = useState<string>("all");
  const [taskOwnerFilter, setTaskOwnerFilter] = useState<string>("all");
  const [taskStatusFilter, setTaskStatusFilter] = useState<string>("all");
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<string>("all");
  const [taskSectionFilter, setTaskSectionFilter] = useState<string>("all");

  const [openComposer, setOpenComposer] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [parentNoteId, setParentNoteId] = useState<number | null>(null);
  const [draggedNoteId, setDraggedNoteId] = useState<number | null>(null);
  const [draggedSectionKey, setDraggedSectionKey] = useState<string | null>(null);
  const [moveDialogNoteId, setMoveDialogNoteId] = useState<number | null>(null);
  const [moveTargetSectionKey, setMoveTargetSectionKey] = useState<string | null>(null);
  const [createSectionOpen, setCreateSectionOpen] = useState(false);
  const [createSectionGroup, setCreateSectionGroup] = useState<NotebookMode>("individual");
  const [createSectionName, setCreateSectionName] = useState("");
  const [createSectionParent, setCreateSectionParent] = useState<string | null>(null);
  const [createAreaOpen, setCreateAreaOpen] = useState(false);
  const [createAreaName, setCreateAreaName] = useState("");
  const [manageSectionKey, setManageSectionKey] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    type: "section" | "area";
    x: number;
    y: number;
    sectionKey?: string;
    areaName?: string;
  } | null>(null);
  const [renameSectionOpen, setRenameSectionOpen] = useState(false);
  const [renameSectionKey, setRenameSectionKey] = useState<string | null>(null);
  const [renameSectionName, setRenameSectionName] = useState("");
  const [moveSectionOpen, setMoveSectionOpen] = useState(false);
  const [moveSectionKey, setMoveSectionKey] = useState<string | null>(null);
  const [moveSectionTargetParent, setMoveSectionTargetParent] = useState<string | null>(null);
  const [notebookMode, setNotebookMode] = useState<NotebookMode>("individual");
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [managementSection, setManagementSection] = useState(DEFAULT_MANAGEMENT_SECTIONS[0]);
  const [customSectionName, setCustomSectionName] = useState("");
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
  const composerBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const gmailRequestInFlightRef = useRef(false);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDetails, setTaskDetails] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");

  function openCreateSectionModal(group: NotebookMode, parent: string | null = null) {
    setCreateSectionGroup(group);
    setCreateSectionParent(parent);
    setCreateSectionName("");
    setCreateSectionOpen(true);
  }

  function openSectionContextMenu(event: React.MouseEvent, section: SectionRecord) {
    event.preventDefault();
    event.stopPropagation();
    setActiveSectionKey(section.key);
    setContextMenu({ type: "section", x: event.clientX, y: event.clientY, sectionKey: section.key });
  }

  function openAreaContextMenu(event: React.MouseEvent, areaName: string) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ type: "area", x: event.clientX, y: event.clientY, areaName });
  }

  const notes = useMemo(() => rawNotes.map(normalizeNote), [rawNotes]);

  async function load() {
    if (!identity?.name) return;
    setLoading(true);
    setError(null);
    try {
      const loaders = [
        db.one_on_one_notes.list({ orderBy: { column: "created_at", ascending: false } }),
        db.personal_action_items.list({ orderBy: { column: "created_at", ascending: false } }),
      ] as const;
      const prefPromise = isManager
        ? db.notebook_section_preferences.list({ filter: { owner_name: identity.name } }).catch(() => [] as NotebookSectionPreference[])
        : Promise.resolve([] as NotebookSectionPreference[]);
      const [noteRows, taskRows, prefRows] = await Promise.all([...loaders, prefPromise]);
      setRawNotes(noteRows);
      setTasks(taskRows);
      setPreferences(prefRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [identity?.name, isManager]);

  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (event: PointerEvent | MouseEvent) => {
      const target = event.target;
      if (contextMenuRef.current && target instanceof Node && !contextMenuRef.current.contains(target)) {
        setContextMenu(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [contextMenu]);

  const managerOwnedNotes = useMemo(() => {
    if (!identity?.name) return [] as NormalizedNote[];
    return notes.filter((note) => note.manager_name === identity.name);
  }, [identity?.name, notes]);

  const receivedNotes = useMemo(() => {
    if (!identity?.name) return [] as NormalizedNote[];
    return notes.filter((note) => note.notebook_group === "individual" && note.employee_name === identity.name && note.status === "shared" && !note.is_archived);
  }, [identity?.name, notes]);

  const managerNotesVisible = useMemo(() => managerOwnedNotes.filter((note) => showArchived || !note.is_archived), [managerOwnedNotes, showArchived]);

  const filteredManagerNotes = useMemo(() => managerNotesVisible.filter((note) => noteMatchesSearch(note, search)), [managerNotesVisible, search]);

  const sectionRecords = useMemo(() => {
    const sectionMap = new Map<string, SectionRecord>();

    const ensureSection = (notebook_group: NotebookMode, label: string) => {
      const cleanLabel = String(label ?? "").trim();
      if (!cleanLabel) return;
      const key = `${notebook_group}:${cleanLabel}`;
      if (!sectionMap.has(key)) {
        const pref = preferences.find((row) => row.section_key === key && row.owner_name === identity?.name);
        sectionMap.set(key, {
          key,
          label: cleanLabel,
          notebook_group,
          notes: [],
          favorite: Boolean(pref?.is_favorite),
        });
      }
    };

    LOCKED_TEAM_NAMES.forEach((name) => ensureSection("individual", name));
    DEFAULT_MANAGEMENT_SECTIONS.forEach((name) => ensureSection("management", name));
    ensureSection("other", DEFAULT_OTHER_SECTION);
    preferences
      .filter((pref) => pref.owner_name === identity?.name)
      .forEach((pref) => {
        const prefGroup = pref.notebook_group as NotebookMode;
        const prefLabel = pref.section_label || pref.section_key.split(":").slice(1).join(":");
        ensureSection(prefGroup, prefLabel);
      });

    filteredManagerNotes.forEach((note) => {
      ensureSection(note.notebook_group, note.section_name);
      const key = `${note.notebook_group}:${note.section_name}`;
      sectionMap.get(key)?.notes.push(note);
    });

    return Array.from(sectionMap.values())
      .map((section) => ({ ...section, notes: [...section.notes].sort(sortNotes) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredManagerNotes, preferences, identity?.name]);

  const favoriteSections = useMemo(() => sectionRecords.filter((section) => section.favorite), [sectionRecords]);
  const individualSections = useMemo(() => sectionRecords.filter((section) => section.notebook_group === "individual"), [sectionRecords]);
  const managementSections = useMemo(() => sectionRecords.filter((section) => section.notebook_group === "management"), [sectionRecords]);
  const otherSections = useMemo(() => sectionRecords.filter((section) => section.notebook_group === "other"), [sectionRecords]);
  const customAreaNames = useMemo(
    () => preferences
      .filter((pref) => pref.owner_name === identity?.name && pref.section_key.startsWith("area:"))
      .map((pref) => pref.section_label || pref.section_key.replace(/^area:/, ""))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    [preferences, identity?.name],
  );
  const defaultOtherSections = useMemo(
    () => otherSections.filter((section) => !customAreaNames.some((area) => section.label === area || section.label.startsWith(`${area}${SECTION_PATH_SEPARATOR}`))),
    [otherSections, customAreaNames],
  );

  function buildSectionTree(sections: SectionRecord[], notebook_group: NotebookMode): SectionTreeNode[] {
    const nodeMap = new Map<string, SectionTreeNode>();
    const roots: SectionTreeNode[] = [];

    const ensureNode = (fullLabel: string) => {
      const key = `${notebook_group}:${fullLabel}`;
      if (!nodeMap.has(key)) {
        const matching = sections.find((section) => section.key === key);
        nodeMap.set(key, {
          key,
          label: splitSectionPath(fullLabel).slice(-1)[0] ?? fullLabel,
          fullLabel,
          notebook_group,
          notes: matching?.notes ?? [],
          favorite: matching?.favorite ?? false,
          children: [],
        });
      }
      return nodeMap.get(key)!;
    };

    sections.forEach((section) => {
      const parts = splitSectionPath(section.label);
      let currentPath = "";
      let parentNode: SectionTreeNode | null = null;

      parts.forEach((part, index) => {
        currentPath = currentPath ? `${currentPath}${SECTION_PATH_SEPARATOR}${part}` : part;
        const node = ensureNode(currentPath);
        if (index === parts.length - 1) {
          node.notes = section.notes;
          node.favorite = section.favorite;
        }
        if (parentNode) {
          if (!parentNode.children.some((child) => child.key === node.key)) parentNode.children.push(node);
        } else if (!roots.some((root) => root.key === node.key)) {
          roots.push(node);
        }
        parentNode = node;
      });
    });

    const sortNodes = (nodes: SectionTreeNode[]) => {
      nodes.sort((a, b) => a.label.localeCompare(b.label));
      nodes.forEach((node) => sortNodes(node.children));
      return nodes;
    };

    return sortNodes(roots);
  }

  const individualTree = useMemo(() => buildSectionTree(individualSections, "individual"), [individualSections]);
  const managementTree = useMemo(() => buildSectionTree(managementSections, "management"), [managementSections]);
  const otherTree = useMemo(() => buildSectionTree(defaultOtherSections, "other"), [defaultOtherSections]);
  const customAreaTrees = useMemo(
    () => Object.fromEntries(
      customAreaNames.map((area) => {
        const scopedSections = otherSections
          .filter((section) => section.label.startsWith(`${area}${SECTION_PATH_SEPARATOR}`))
          .map((section) => ({
            ...section,
            label: section.label.slice(`${area}${SECTION_PATH_SEPARATOR}`.length),
          }));
        return [area, buildSectionTree(scopedSections, "other")];
      }),
    ) as Record<string, SectionTreeNode[]>,
    [customAreaNames, otherSections],
  );

  useEffect(() => {
    if (!isManager) return;
    const firstKey = favoriteSections[0]?.key ?? individualSections[0]?.key ?? managementSections[0]?.key ?? null;
    if (!activeSectionKey) {
      setActiveSectionKey(firstKey);
      return;
    }
    const valid = sectionRecords.some((section) => section.key === activeSectionKey);
    if (!valid) setActiveSectionKey(firstKey);
  }, [isManager, activeSectionKey, favoriteSections, individualSections, managementSections, sectionRecords]);

  const activeSection = useMemo(() => sectionRecords.find((section) => section.key === activeSectionKey) ?? null, [sectionRecords, activeSectionKey]);
  const managedSection = useMemo(() => sectionRecords.find((section) => section.key === manageSectionKey) ?? null, [sectionRecords, manageSectionKey]);
  const renamingSection = useMemo(() => sectionRecords.find((section) => section.key === renameSectionKey) ?? null, [sectionRecords, renameSectionKey]);
  const movingSection = useMemo(() => sectionRecords.find((section) => section.key === moveSectionKey) ?? null, [sectionRecords, moveSectionKey]);
  const contextMenuSection = useMemo(() => sectionRecords.find((section) => section.key === contextMenu?.sectionKey) ?? null, [sectionRecords, contextMenu]);
  const pageList = useMemo(() => activeSection?.notes ?? [], [activeSection]);

  useEffect(() => {
    const firstPageId = pageList[0]?.id ?? null;
    if (!selectedPageId) {
      setSelectedPageId(firstPageId);
      return;
    }
    if (selectedPageId && !pageList.some((note) => note.id === selectedPageId)) {
      setSelectedPageId(firstPageId);
    }
  }, [pageList, selectedPageId]);

  const selectedNote = useMemo(() => pageList.find((note) => note.id === selectedPageId) ?? null, [pageList, selectedPageId]);

  const visiblePageList = useMemo(() => [...pageList].sort(sortNotes).slice(0, 250), [pageList]);
  const moveDialogNote = useMemo(() => managerOwnedNotes.find((note) => note.id === moveDialogNoteId) ?? null, [managerOwnedNotes, moveDialogNoteId]);
  const allSectionOptions = useMemo(() => sectionRecords.map((section) => ({ value: section.key, label: `${section.notebook_group === "management" ? "Management" : section.notebook_group === "other" ? "Others" : "Individual"} · ${section.label}` })), [sectionRecords]);
  const moveSectionParentOptions = useMemo(() => {
    if (!movingSection) return [] as { value: string; label: string }[];
    return sectionRecords
      .filter((section) => section.notebook_group === movingSection.notebook_group)
      .filter((section) => section.key !== movingSection.key)
      .filter((section) => !section.label.startsWith(`${movingSection.label}${SECTION_PATH_SEPARATOR}`))
      .map((section) => ({ value: section.label, label: section.label }));
  }, [movingSection, sectionRecords]);

  const myTasks = useMemo(() => {
    if (!identity?.name) return [] as PersonalActionItem[];
    return tasks.filter((task) => task.employee_name === identity.name || task.owner_name === identity.name);
  }, [identity?.name, tasks]);

  const managerTaskRows = useMemo(() => tasks.filter((task) => task.created_by === identity?.name), [tasks, identity?.name]);
  const allNotesRows = useMemo(() => [...managerOwnedNotes].sort(sortNotes), [managerOwnedNotes]);
  const filteredAllNotes = useMemo(() => allNotesRows.filter((note) => noteMatchesSearch(note, search) && (noteGroupFilter === "all" || note.notebook_group === noteGroupFilter)), [allNotesRows, search, noteGroupFilter]);
  const filteredManagerTasks = useMemo(() => managerTaskRows.filter((task) => {
    const ownerOk = taskOwnerFilter === "all" || (task.owner_name ?? task.employee_name) === taskOwnerFilter;
    const statusOk = taskStatusFilter === "all" || task.status === taskStatusFilter;
    const priorityOk = taskPriorityFilter === "all" || (task.priority ?? "medium") === taskPriorityFilter;
    const sectionOk = taskSectionFilter === "all" || (task.section_name ?? "") === taskSectionFilter;
    const text = `${task.title} ${task.details ?? ""}`.toLowerCase();
    const textOk = !search.trim() || text.includes(search.trim().toLowerCase());
    return ownerOk && statusOk && priorityOk && sectionOk && textOk;
  }), [managerTaskRows, taskOwnerFilter, taskStatusFilter, taskPriorityFilter, taskSectionFilter, search]);

  const individualCount = useMemo(() => managerOwnedNotes.filter((note) => note.notebook_group === "individual" && !note.is_archived).length, [managerOwnedNotes]);
  const managementCount = useMemo(() => managerOwnedNotes.filter((note) => note.notebook_group === "management" && !note.is_archived).length, [managerOwnedNotes]);
  const otherCount = useMemo(() => managerOwnedNotes.filter((note) => note.notebook_group === "other" && !note.is_archived).length, [managerOwnedNotes]);
  const archivedCount = useMemo(() => managerOwnedNotes.filter((note) => note.is_archived).length, [managerOwnedNotes]);

  function resetComposer(mode: NotebookMode = "individual") {
    setEditingNoteId(null);
    setParentNoteId(null);
    setNotebookMode(mode);
    setSelectedEmployee(mode === "individual" ? LOCKED_TEAM_NAMES[0] ?? null : null);
    setManagementSection(DEFAULT_MANAGEMENT_SECTIONS[0]);
    setMeetingDate("");
    setSourceType(mode === "management" ? "manual" : "gmail_gemini");
    setTitle(mode === "management" ? "Management Meeting Notes" : "1:1 Meeting Summary");
    setSourceNotes("");
    setImportedMessageId(null);
    setImportedMessageSubject(null);
    setSummaryMarkdown("");
    setDiscussionPoints("");
    setManagerActionItems("");
    setEmployeeActionItems("");
    setGmailMessages([]);
  }

  function populateComposer(note: NormalizedNote, asSubpage = false) {
    setEditingNoteId(asSubpage ? null : note.id);
    setParentNoteId(asSubpage ? note.id : note.parent_note_id ?? null);
    setNotebookMode(note.notebook_group);
    setSelectedEmployee(note.notebook_group === "individual" ? note.section_name : null);
    setManagementSection(note.notebook_group === "management" ? note.section_name : DEFAULT_MANAGEMENT_SECTIONS[0]);
    setMeetingDate(note.meeting_date ?? "");
    setSourceType(note.source_type ?? "manual");
    setTitle(asSubpage ? `Subpage · ${note.title}` : note.title ?? "");
    setSourceNotes(note.source_body ?? "");
    setImportedMessageId(note.source_message_id ?? null);
    setImportedMessageSubject(note.source_subject ?? null);
    setSummaryMarkdown(note.summary_markdown ?? "");
    setDiscussionPoints(safeJsonArray(note.discussion_points_json).join("\n"));
    setManagerActionItems(safeJsonArray(note.manager_action_items_json).join("\n"));
    setEmployeeActionItems(safeJsonArray(note.employee_action_items_json).join("\n"));
  }

  function applyImportedMessage(message: GmailNoteMessage) {
    setOpenComposer(true);
    setNotebookMode("individual");
    setSourceType("gmail_gemini");
    setSourceNotes(message.body || message.snippet || "");
    setImportedMessageId(message.id);
    setImportedMessageSubject(message.subject);
    setTitle(message.subject?.trim() || "1:1 Meeting Summary");
    if (message.internalDate) setMeetingDate(message.internalDate.slice(0, 10));

    window.setTimeout(() => {
      composerBodyRef.current?.focus();
      composerBodyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  async function loadGmailNotes() {
    if (!isManager) return;
    if (!gmailStartDate || !gmailEndDate) {
      setError("Choose both a start date and end date for the Gmail import range.");
      return;
    }
    if (gmailStartDate > gmailEndDate) {
      setError("The Gmail start date must be on or before the end date.");
      return;
    }

    gmailRequestInFlightRef.current = true;
    setGmailLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        start: gmailStartDate,
        end: gmailEndDate,
        max: "500",
      });
      const response = await fetch(`/api/gmail/meeting-notes?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      const messages = Array.isArray(payload.messages) ? (payload.messages as GmailNoteMessage[]) : [];
      setGmailMessages(messages);
      if (messages.length > 0 && !sourceNotes.trim()) applyImportedMessage(messages[0]);
      if (messages.length === 0) {
        setError(`No Gemini notes were found in Gmail between ${gmailStartDate} and ${gmailEndDate}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      gmailRequestInFlightRef.current = false;
      setGmailLoading(false);
    }
  }

  useEffect(() => {
    if (openComposer && isManager && notebookMode === "individual" && sourceType === "gmail_gemini" && !sourceNotes.trim() && gmailMessages.length === 0) {
      void loadGmailNotes();
    }
  }, [openComposer, isManager, notebookMode, sourceType, sourceNotes, gmailMessages.length]);

  async function generateFromNotes() {
    if (!sourceNotes.trim()) {
      setError("Import or paste the meeting notes first.");
      return;
    }
    setError(null);
    const prompt = notebookMode === "management"
      ? `Turn these management meeting notes into JSON with this exact shape: {"title":"...","summary":"...","discussionPoints":["..."],"managerActionItems":["..."],"employeeActionItems":["..."]}. Focus on leadership decisions, risks, owners, and follow-ups. Notes:\n\n${sourceNotes}`
      : `Turn these 1:1 meeting notes into JSON with this exact shape: {"title":"...","summary":"...","discussionPoints":["..."],"managerActionItems":["..."],"employeeActionItems":["..."]}. Keep each bullet concise and factual. Notes:\n\n${sourceNotes}`;
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

  function classifyImportedMessage(message: GmailNoteMessage): { mode: NotebookMode; sectionName: string; title: string } {
    const subject = String(message.subject ?? "").trim();
    const oneOnOneMatch = subject.match(/^Bi-Weekly One on One\s*-\s*(.+)$/i);
    if (oneOnOneMatch) {
      return {
        mode: "individual",
        sectionName: oneOnOneMatch[1].trim(),
        title: subject || "1:1 Meeting Summary",
      };
    }
    if (/noc management/i.test(subject)) {
      return {
        mode: "management",
        sectionName: "NOC Management",
        title: subject || "NOC Management Meeting",
      };
    }
    return {
      mode: "other",
      sectionName: "Others",
      title: subject || "Other Meeting Notes",
    };
  }

  function buildAutoOrganizePrompt(message: GmailNoteMessage, mode: NotebookMode) {
    const noteText = message.body || message.snippet || "";
    if (mode === "management") {
      return `Turn these management meeting notes into JSON with this exact shape: {"title":"...","summary":"...","discussionPoints":["..."],"managerActionItems":["..."],"employeeActionItems":["..."]}. Focus on leadership decisions, risks, owners, and follow-ups. Notes:\n\n${noteText}`;
    }
    if (mode === "other") {
      return `Turn these general meeting notes into JSON with this exact shape: {"title":"...","summary":"...","discussionPoints":["..."],"managerActionItems":["..."],"employeeActionItems":["..."]}. Focus on the topic, decisions, owners, and follow-ups. Notes:\n\n${noteText}`;
    }
    return `Turn these 1:1 meeting notes into JSON with this exact shape: {"title":"...","summary":"...","discussionPoints":["..."],"managerActionItems":["..."],"employeeActionItems":["..."]}. Keep each bullet concise and factual. Notes:\n\n${noteText}`;
  }

  async function autoOrganizeLoadedNotes() {
    if (!identity?.name) return;
    const pendingMessages = gmailMessages.filter((message) => !message.imported);
    if (pendingMessages.length === 0) {
      setError("There are no new Gmail notes to auto-organize in this date range.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      for (const message of pendingMessages) {
        const classification = classifyImportedMessage(message);
        const raw = await complete(buildAutoOrganizePrompt(message, classification.mode));
        const parsed = parseJsonSummary(raw);
        if (!parsed) continue;

        const employeeValue = classification.mode === "management"
          ? `${MANAGEMENT_PREFIX}${classification.sectionName}`
          : classification.mode === "other"
            ? `${OTHER_PREFIX}${classification.sectionName}`
            : classification.sectionName;

        await db.one_on_one_notes.insert({
          manager_name: identity.name,
          employee_name: employeeValue,
          title: parsed.title || classification.title,
          meeting_date: message.internalDate ? message.internalDate.slice(0, 10) : null,
          source_type: "gmail_gemini",
          source_message_id: message.id,
          source_subject: message.subject,
          source_excerpt: (message.snippet || "").slice(0, 280) || null,
          source_body: message.body || null,
          summary_markdown: parsed.summary || "",
          discussion_points_json: JSON.stringify(parsed.discussionPoints ?? []),
          manager_action_items_json: JSON.stringify(parsed.managerActionItems ?? []),
          employee_action_items_json: JSON.stringify(parsed.employeeActionItems ?? []),
          status: classification.mode === "individual" ? "draft" : "shared",
          notebook_group: classification.mode,
          section_name: classification.sectionName,
          parent_note_id: null,
          sort_order: 0,
          is_archived: false,
          archived_at: null,
          updated_at: new Date().toISOString(),
          shared_at: new Date().toISOString(),
        });
      }

      await load();
      await loadGmailNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveNote(status: "draft" | "shared") {
    if (!identity?.name) return;
    if (notebookMode === "individual" && !selectedEmployee) {
      setError("Choose the employee section for this 1:1 note.");
      return;
    }
    if (notebookMode === "management" && !managementSection.trim()) {
      setError("Add a management section name.");
      return;
    }
    if (!summaryMarkdown.trim()) {
      setError("Add or generate the meeting summary first.");
      return;
    }

    const sectionName = notebookMode === "individual"
      ? String(customSectionName.trim() || selectedEmployee || "").trim()
      : notebookMode === "management"
        ? customSectionName.trim() || managementSection.trim()
        : customSectionName.trim();
    const employeeValue = notebookMode === "management"
      ? `${MANAGEMENT_PREFIX}${sectionName}`
      : notebookMode === "other"
        ? `${OTHER_PREFIX}${sectionName}`
        : sectionName;
    const effectiveStatus = notebookMode === "management" || notebookMode === "other" ? "shared" : status;
    const payload = {
      manager_name: identity.name,
      employee_name: employeeValue,
      title: title.trim() || (notebookMode === "management" ? "Management Meeting Notes" : "1:1 Meeting Summary"),
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
      status: effectiveStatus,
      notebook_group: notebookMode,
      section_name: sectionName,
      parent_note_id: parentNoteId,
      sort_order: 0,
      is_archived: false,
      archived_at: null,
      updated_at: new Date().toISOString(),
      shared_at: effectiveStatus === "shared" ? new Date().toISOString() : null,
    };

    setSaving(true);
    setError(null);
    try {
      if (editingNoteId) {
        const updated = await db.one_on_one_notes.updateById(editingNoteId, payload);
        setSelectedPageId(updated.id);
        setActiveSectionKey(`${notebookMode}:${sectionName}`);
      } else {
        const inserted = await db.one_on_one_notes.insert(payload);
        const created = inserted[0];
        if (created?.id) setSelectedPageId(created.id);
        setActiveSectionKey(`${notebookMode}:${sectionName}`);
      }
      setOpenComposer(false);
      resetComposer();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleFavoriteSection(section: SectionRecord) {
    if (!identity?.name) return;
    const existing = preferences.find((pref) => pref.owner_name === identity.name && pref.section_key === section.key);
    try {
      if (existing) {
        await db.notebook_section_preferences.updateById(existing.id, { is_favorite: !existing.is_favorite });
      } else {
        await db.notebook_section_preferences.insert({
          owner_name: identity.name,
          notebook_group: section.notebook_group,
          section_key: section.key,
          section_label: section.label,
          is_favorite: true,
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function archiveNote(note: NormalizedNote, archived: boolean) {
    try {
      await db.one_on_one_notes.updateById(note.id, {
        is_archived: archived,
        archived_at: archived ? new Date().toISOString() : null,
        status: archived ? "archived" : (note.notebook_group === "management" ? "shared" : note.status === "archived" ? "draft" : note.status),
        updated_at: new Date().toISOString(),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteNote(note: NormalizedNote) {
    if (!window.confirm(`Delete "${note.title}" permanently?`)) return;
    try {
      await db.one_on_one_notes.deleteById(note.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function addTask() {
    if (!identity?.name || !taskTitle.trim()) return;
    setSaving(true);
    try {
      await db.personal_action_items.insert({
        employee_name: identity.name,
        owner_name: identity.name,
        note_id: selectedNote?.id ?? null,
        title: taskTitle.trim(),
        details: taskDetails.trim() || null,
        status: "open",
        priority: "medium",
        progress_percent: 0,
        due_date: taskDueDate || null,
        section_name: selectedNote?.section_name ?? activeSection?.label ?? null,
        notebook_group: selectedNote?.notebook_group ?? activeSection?.notebook_group ?? null,
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

  async function updateTask(task: PersonalActionItem, patch: Partial<PersonalActionItem>) {
    await db.personal_action_items.updateById(task.id, patch);
    await load();
  }

  async function createTasksFromNote(note: NormalizedNote) {
    if (!identity?.name) return;
    const sourceItems = [...safeJsonArray(note.manager_action_items_json), ...safeJsonArray(note.employee_action_items_json)].map((item) => item.trim()).filter(Boolean);
    if (sourceItems.length === 0) {
      setError("This note does not have any extracted action items yet.");
      return;
    }
    const existing = tasks.filter((task) => task.note_id === note.id).map((task) => task.title.trim().toLowerCase());
    const values = sourceItems.filter((item) => !existing.includes(item.toLowerCase())).map((item) => ({
      employee_name: identity.name,
      owner_name: identity.name,
      note_id: note.id,
      title: item,
      details: note.title,
      status: "open",
      priority: "medium",
      progress_percent: 0,
      due_date: null,
      section_name: note.section_name,
      notebook_group: note.notebook_group,
      created_by: identity.name,
    }));
    if (values.length === 0) {
      setError("Action items from this note are already in the action center.");
      return;
    }
    setSaving(true);
    try {
      await db.personal_action_items.insert(values);
      await load();
    } finally {
      setSaving(false);
    }
  }

  function employeeValueForSection(notebookGroup: NotebookMode, sectionName: string) {
    if (notebookGroup === "management") return `${MANAGEMENT_PREFIX}${sectionName}`;
    if (notebookGroup === "other") return `${OTHER_PREFIX}${sectionName}`;
    return sectionName;
  }

  async function moveNoteToSection(note: NormalizedNote, sectionKey: string) {
    const separatorIndex = sectionKey.indexOf(":");
    if (separatorIndex < 0) return;
    const notebookGroup = sectionKey.slice(0, separatorIndex) as NotebookMode;
    const sectionName = sectionKey.slice(separatorIndex + 1).trim();
    if (!sectionName) return;

    try {
      await db.one_on_one_notes.updateById(note.id, {
        notebook_group: notebookGroup,
        section_name: sectionName,
        employee_name: employeeValueForSection(notebookGroup, sectionName),
        updated_at: new Date().toISOString(),
        status: note.is_archived ? "archived" : (notebookGroup === "individual" ? (note.status === "archived" ? "draft" : note.status) : "shared"),
      });
      setActiveSectionKey(sectionKey);
      setSelectedPageId(note.id);
      setDraggedNoteId(null);
      setMoveDialogNoteId(null);
      setMoveTargetSectionKey(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function createSectionFolder() {
    if (!identity?.name) return;
    const leafLabel = createSectionName.trim();
    if (!leafLabel) {
      setError("Enter a section name.");
      return;
    }

    const fullLabel = createSectionParent
      ? `${createSectionParent}${SECTION_PATH_SEPARATOR}${leafLabel}`
      : leafLabel;
    const sectionKey = `${createSectionGroup}:${fullLabel}`;
    const existing = preferences.find((pref) => pref.owner_name === identity.name && pref.section_key === sectionKey);

    try {
      setSaving(true);
      setError(null);
      if (!existing) {
        await db.notebook_section_preferences.insert({
          owner_name: identity.name,
          notebook_group: createSectionGroup,
          section_key: sectionKey,
          section_label: fullLabel,
          is_favorite: false,
        });
      }
      setCreateSectionOpen(false);
      setCreateSectionName("");
      setCreateSectionParent(null);
      setActiveSectionKey(sectionKey);
      setAccordionValues((prev) => Array.from(new Set([...prev, createSectionGroup, ...(createSectionParent ? [createSectionParent] : [])])));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function createNotebookArea() {
    if (!identity?.name) return;
    const label = createAreaName.trim();
    if (!label) {
      setError("Enter a notebook area name.");
      return;
    }

    const existing = preferences.find(
      (pref) => pref.owner_name === identity.name && pref.section_key === `area:${label}`,
    );
    if (existing) {
      setError("A notebook area with this name already exists.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await db.notebook_section_preferences.insert({
        owner_name: identity.name,
        notebook_group: "other",
        section_key: `area:${label}`,
        section_label: label,
        is_favorite: false,
      });
      setCreateAreaOpen(false);
      setCreateAreaName("");
      setAccordionValues((prev) => Array.from(new Set([...prev, label])));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function moveSectionFolder(section: SectionRecord, targetParentLabel: string | null, targetNotebookGroup?: NotebookMode) {
    if (!identity?.name) return;

    const destinationGroup = targetNotebookGroup ?? section.notebook_group;
    const baseName = splitSectionPath(section.label).slice(-1)[0] ?? section.label;
    const nextLabel = targetParentLabel ? `${targetParentLabel}${SECTION_PATH_SEPARATOR}${baseName}` : baseName;
    if (nextLabel === section.label) {
      setMoveSectionOpen(false);
      setMoveSectionKey(null);
      setMoveSectionTargetParent(null);
      return;
    }

    const affectedSections = sectionRecords.filter(
      (candidate) => candidate.notebook_group === section.notebook_group && (candidate.label === section.label || candidate.label.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)),
    );
    const affectedNotes = managerOwnedNotes.filter(
      (note) => note.notebook_group === section.notebook_group && (note.section_name === section.label || note.section_name.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)),
    );

    try {
      setSaving(true);
      setError(null);

      for (const pref of preferences.filter((row) => row.owner_name === identity.name && row.notebook_group === section.notebook_group && (row.section_label === section.label || row.section_label?.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`) || row.section_key === section.key || row.section_key.startsWith(`${section.notebook_group}:${section.label}${SECTION_PATH_SEPARATOR}`)))) {
        const currentLabel = pref.section_label || pref.section_key.split(":").slice(1).join(":");
        const movedLabel = currentLabel === section.label
          ? nextLabel
          : `${nextLabel}${currentLabel.slice(section.label.length)}`;
        await db.notebook_section_preferences.updateById(pref.id, {
          section_key: `${section.notebook_group}:${movedLabel}`,
          section_label: movedLabel,
        });
      }

      for (const childSection of affectedSections) {
        if (!preferences.some((pref) => pref.owner_name === identity.name && pref.section_key === childSection.key)) {
          const movedLabel = childSection.label === section.label
            ? nextLabel
            : `${nextLabel}${childSection.label.slice(section.label.length)}`;
          await db.notebook_section_preferences.insert({
            owner_name: identity.name,
            notebook_group: section.notebook_group,
            section_key: `${section.notebook_group}:${movedLabel}`,
            section_label: movedLabel,
            is_favorite: childSection.favorite,
          });
        }
      }

      for (const note of affectedNotes) {
        const movedLabel = note.section_name === section.label
          ? nextLabel
          : `${nextLabel}${note.section_name.slice(section.label.length)}`;
        await db.one_on_one_notes.updateById(note.id, {
          notebook_group: destinationGroup,
          section_name: movedLabel,
          employee_name: employeeValueForSection(destinationGroup, movedLabel),
          status: note.is_archived ? "archived" : (destinationGroup === "individual" ? (note.status === "archived" ? "draft" : note.status) : "shared"),
          updated_at: new Date().toISOString(),
        });
      }

      if (activeSectionKey === section.key || activeSectionKey?.startsWith(`${section.notebook_group}:${section.label}${SECTION_PATH_SEPARATOR}`)) {
        const suffix = activeSectionKey === section.key ? "" : activeSectionKey?.slice(`${section.notebook_group}:${section.label}`.length) ?? "";
        setActiveSectionKey(`${section.notebook_group}:${nextLabel}${suffix}`);
      }

      setMoveSectionOpen(false);
      setMoveSectionKey(null);
      setMoveSectionTargetParent(null);
      setManageSectionKey(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function renameSectionFolder(section: SectionRecord, nextLeafName: string) {
    if (!identity?.name) return;
    const trimmed = nextLeafName.trim();
    if (!trimmed) {
      setError("Enter a folder name.");
      return;
    }

    const parentPath = splitSectionPath(section.label).slice(0, -1).join(SECTION_PATH_SEPARATOR);
    const nextLabel = parentPath ? `${parentPath}${SECTION_PATH_SEPARATOR}${trimmed}` : trimmed;
    if (nextLabel === section.label) {
      setRenameSectionOpen(false);
      setRenameSectionKey(null);
      setRenameSectionName("");
      return;
    }

    const collision = sectionRecords.some(
      (candidate) => candidate.notebook_group === section.notebook_group && candidate.label === nextLabel && candidate.key !== section.key,
    );
    if (collision) {
      setError("A folder with this name already exists in that location.");
      return;
    }

    const affectedSections = sectionRecords.filter(
      (candidate) => candidate.notebook_group === section.notebook_group && (candidate.label === section.label || candidate.label.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)),
    );
    const affectedNotes = managerOwnedNotes.filter(
      (note) => note.notebook_group === section.notebook_group && (note.section_name === section.label || note.section_name.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)),
    );

    try {
      setSaving(true);
      setError(null);

      for (const pref of preferences.filter((row) => row.owner_name === identity.name && row.notebook_group === section.notebook_group && ((row.section_label || row.section_key.split(":").slice(1).join(":")) === section.label || (row.section_label || row.section_key.split(":").slice(1).join(":")).startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)))) {
        const currentLabel = pref.section_label || pref.section_key.split(":").slice(1).join(":");
        const renamedLabel = currentLabel === section.label
          ? nextLabel
          : `${nextLabel}${currentLabel.slice(section.label.length)}`;
        await db.notebook_section_preferences.updateById(pref.id, {
          section_key: `${section.notebook_group}:${renamedLabel}`,
          section_label: renamedLabel,
        });
      }

      for (const childSection of affectedSections) {
        if (!preferences.some((pref) => pref.owner_name === identity.name && pref.section_key === childSection.key)) {
          const renamedLabel = childSection.label === section.label
            ? nextLabel
            : `${nextLabel}${childSection.label.slice(section.label.length)}`;
          await db.notebook_section_preferences.insert({
            owner_name: identity.name,
            notebook_group: section.notebook_group,
            section_key: `${section.notebook_group}:${renamedLabel}`,
            section_label: renamedLabel,
            is_favorite: childSection.favorite,
          });
        }
      }

      for (const note of affectedNotes) {
        const renamedLabel = note.section_name === section.label
          ? nextLabel
          : `${nextLabel}${note.section_name.slice(section.label.length)}`;
        await db.one_on_one_notes.updateById(note.id, {
          section_name: renamedLabel,
          employee_name: employeeValueForSection(section.notebook_group, renamedLabel),
          updated_at: new Date().toISOString(),
        });
      }

      if (activeSectionKey === section.key || activeSectionKey?.startsWith(`${section.notebook_group}:${section.label}${SECTION_PATH_SEPARATOR}`)) {
        const suffix = activeSectionKey === section.key ? "" : activeSectionKey?.slice(`${section.notebook_group}:${section.label}`.length) ?? "";
        setActiveSectionKey(`${section.notebook_group}:${nextLabel}${suffix}`);
      }

      setRenameSectionOpen(false);
      setRenameSectionKey(null);
      setRenameSectionName("");
      setManageSectionKey(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function duplicateSectionFolder(section: SectionRecord) {
    if (!identity?.name) return;

    const parentPath = splitSectionPath(section.label).slice(0, -1).join(SECTION_PATH_SEPARATOR);
    const leaf = splitSectionPath(section.label).slice(-1)[0] ?? section.label;
    let nextLeaf = `${leaf} Copy`;
    let nextLabel = parentPath ? `${parentPath}${SECTION_PATH_SEPARATOR}${nextLeaf}` : nextLeaf;
    let index = 2;
    while (sectionRecords.some((candidate) => candidate.notebook_group === section.notebook_group && candidate.label === nextLabel)) {
      nextLeaf = `${leaf} Copy ${index}`;
      nextLabel = parentPath ? `${parentPath}${SECTION_PATH_SEPARATOR}${nextLeaf}` : nextLeaf;
      index += 1;
    }

    const affectedSections = sectionRecords.filter(
      (candidate) => candidate.notebook_group === section.notebook_group && (candidate.label === section.label || candidate.label.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)),
    );
    const affectedNotes = managerOwnedNotes.filter(
      (note) => note.notebook_group === section.notebook_group && (note.section_name === section.label || note.section_name.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)),
    );

    try {
      setSaving(true);
      setError(null);
      await db.notebook_section_preferences.insert({
        owner_name: identity.name,
        notebook_group: section.notebook_group,
        section_key: `${section.notebook_group}:${nextLabel}`,
        section_label: nextLabel,
        is_favorite: false,
      });

      for (const childSection of affectedSections.filter((candidate) => candidate.label !== section.label)) {
        const copiedLabel = `${nextLabel}${childSection.label.slice(section.label.length)}`;
        await db.notebook_section_preferences.insert({
          owner_name: identity.name,
          notebook_group: section.notebook_group,
          section_key: `${section.notebook_group}:${copiedLabel}`,
          section_label: copiedLabel,
          is_favorite: false,
        });
      }

      for (const note of affectedNotes) {
        const copiedLabel = note.section_name === section.label ? nextLabel : `${nextLabel}${note.section_name.slice(section.label.length)}`;
        await db.one_on_one_notes.insert({
          manager_name: note.manager_name,
          employee_name: employeeValueForSection(section.notebook_group, copiedLabel),
          title: note.title,
          meeting_date: note.meeting_date ?? null,
          source_type: note.source_type ?? "manual",
          source_message_id: note.source_message_id ?? null,
          source_subject: note.source_subject ?? null,
          source_excerpt: note.source_excerpt ?? null,
          source_body: note.source_body ?? null,
          summary_markdown: note.summary_markdown ?? "",
          discussion_points_json: note.discussion_points_json ?? "[]",
          manager_action_items_json: note.manager_action_items_json ?? "[]",
          employee_action_items_json: note.employee_action_items_json ?? "[]",
          status: section.notebook_group === "individual" ? note.status : "shared",
          notebook_group: section.notebook_group,
          section_name: copiedLabel,
          parent_note_id: null,
          sort_order: note.sort_order ?? 0,
          is_archived: Boolean(note.is_archived),
          archived_at: note.archived_at ?? null,
          updated_at: new Date().toISOString(),
          shared_at: note.shared_at ?? null,
        });
      }

      setContextMenu(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function renameArea(areaName: string, nextAreaName: string) {
    if (!identity?.name) return;
    const trimmed = nextAreaName.trim();
    if (!trimmed || trimmed === areaName) return;
    if (customAreaNames.includes(trimmed)) {
      setError("A notebook area with this name already exists.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const areaPref = preferences.find((pref) => pref.owner_name === identity.name && pref.section_key === `area:${areaName}`);
      if (areaPref) {
        await db.notebook_section_preferences.updateById(areaPref.id, {
          section_key: `area:${trimmed}`,
          section_label: trimmed,
        });
      }
      for (const pref of preferences.filter((row) => row.owner_name === identity.name && row.notebook_group === "other" && row.section_label?.startsWith(`${areaName}${SECTION_PATH_SEPARATOR}`))) {
        const suffix = pref.section_label.slice(areaName.length + SECTION_PATH_SEPARATOR.length);
        const nextLabel = `${trimmed}${SECTION_PATH_SEPARATOR}${suffix}`;
        await db.notebook_section_preferences.updateById(pref.id, {
          section_key: `other:${nextLabel}`,
          section_label: nextLabel,
        });
      }
      for (const note of managerOwnedNotes.filter((row) => row.notebook_group === "other" && row.section_name.startsWith(`${areaName}${SECTION_PATH_SEPARATOR}`))) {
        const suffix = note.section_name.slice(areaName.length + SECTION_PATH_SEPARATOR.length);
        const nextLabel = `${trimmed}${SECTION_PATH_SEPARATOR}${suffix}`;
        await db.one_on_one_notes.updateById(note.id, {
          section_name: nextLabel,
          employee_name: employeeValueForSection("other", nextLabel),
          updated_at: new Date().toISOString(),
        });
      }
      setContextMenu(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function moveArea(areaName: string, targetAreaName: string | null) {
    if (!identity?.name) return;
    const trimmedTarget = targetAreaName?.trim() || null;
    if (trimmedTarget === areaName) return;

    try {
      setSaving(true);
      setError(null);
      const areaPref = preferences.find((pref) => pref.owner_name === identity.name && pref.section_key === `area:${areaName}`);
      if (areaPref) await db.notebook_section_preferences.deleteById(areaPref.id);
      for (const pref of preferences.filter((row) => row.owner_name === identity.name && row.notebook_group === "other" && row.section_label?.startsWith(`${areaName}${SECTION_PATH_SEPARATOR}`))) {
        const suffix = pref.section_label.slice(areaName.length + SECTION_PATH_SEPARATOR.length);
        const nextLabel = trimmedTarget ? `${trimmedTarget}${SECTION_PATH_SEPARATOR}${suffix}` : suffix;
        await db.notebook_section_preferences.updateById(pref.id, {
          section_key: `other:${nextLabel}`,
          section_label: nextLabel,
        });
      }
      for (const note of managerOwnedNotes.filter((row) => row.notebook_group === "other" && row.section_name.startsWith(`${areaName}${SECTION_PATH_SEPARATOR}`))) {
        const suffix = note.section_name.slice(areaName.length + SECTION_PATH_SEPARATOR.length);
        const nextLabel = trimmedTarget ? `${trimmedTarget}${SECTION_PATH_SEPARATOR}${suffix}` : suffix;
        await db.one_on_one_notes.updateById(note.id, {
          section_name: nextLabel,
          employee_name: employeeValueForSection("other", nextLabel),
          updated_at: new Date().toISOString(),
        });
      }
      setContextMenu(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function copyArea(areaName: string) {
    if (!identity?.name) return;
    let nextArea = `${areaName} Copy`;
    let index = 2;
    while (customAreaNames.includes(nextArea)) {
      nextArea = `${areaName} Copy ${index}`;
      index += 1;
    }

    try {
      setSaving(true);
      setError(null);
      await db.notebook_section_preferences.insert({
        owner_name: identity.name,
        notebook_group: "other",
        section_key: `area:${nextArea}`,
        section_label: nextArea,
        is_favorite: false,
      });
      for (const section of otherSections.filter((row) => row.label.startsWith(`${areaName}${SECTION_PATH_SEPARATOR}`))) {
        const nextLabel = `${nextArea}${section.label.slice(areaName.length)}`;
        await db.notebook_section_preferences.insert({
          owner_name: identity.name,
          notebook_group: "other",
          section_key: `other:${nextLabel}`,
          section_label: nextLabel,
          is_favorite: false,
        });
      }
      for (const note of managerOwnedNotes.filter((row) => row.notebook_group === "other" && row.section_name.startsWith(`${areaName}${SECTION_PATH_SEPARATOR}`))) {
        const nextLabel = `${nextArea}${note.section_name.slice(areaName.length)}`;
        await db.one_on_one_notes.insert({
          manager_name: note.manager_name,
          employee_name: employeeValueForSection("other", nextLabel),
          title: note.title,
          meeting_date: note.meeting_date ?? null,
          source_type: note.source_type ?? "manual",
          source_message_id: note.source_message_id ?? null,
          source_subject: note.source_subject ?? null,
          source_excerpt: note.source_excerpt ?? null,
          source_body: note.source_body ?? null,
          summary_markdown: note.summary_markdown ?? "",
          discussion_points_json: note.discussion_points_json ?? "[]",
          manager_action_items_json: note.manager_action_items_json ?? "[]",
          employee_action_items_json: note.employee_action_items_json ?? "[]",
          status: "shared",
          notebook_group: "other",
          section_name: nextLabel,
          parent_note_id: null,
          sort_order: note.sort_order ?? 0,
          is_archived: Boolean(note.is_archived),
          archived_at: note.archived_at ?? null,
          updated_at: new Date().toISOString(),
          shared_at: note.shared_at ?? null,
        });
      }
      setContextMenu(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSectionFolder(section: SectionRecord) {
    if (!identity?.name) return;

    const affectedSections = sectionRecords.filter(
      (candidate) => candidate.notebook_group === section.notebook_group && (candidate.label === section.label || candidate.label.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)),
    );
    const affectedNotes = managerOwnedNotes.filter(
      (note) => note.notebook_group === section.notebook_group && (note.section_name === section.label || note.section_name.startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)),
    );

    const confirmed = window.confirm(
      `Delete folder "${section.label}" and permanently remove ${affectedNotes.length} page${affectedNotes.length === 1 ? "" : "s"} across ${affectedSections.length} folder${affectedSections.length === 1 ? "" : "s"}?`,
    );
    if (!confirmed) return;

    try {
      setSaving(true);
      setError(null);

      for (const note of affectedNotes) {
        await db.one_on_one_notes.deleteById(note.id);
      }

      for (const pref of preferences.filter((row) => row.owner_name === identity.name && row.notebook_group === section.notebook_group && ((row.section_label || row.section_key.split(":").slice(1).join(":")) === section.label || (row.section_label || row.section_key.split(":").slice(1).join(":")).startsWith(`${section.label}${SECTION_PATH_SEPARATOR}`)))) {
        await db.notebook_section_preferences.deleteById(pref.id);
      }

      if (activeSectionKey === section.key || activeSectionKey?.startsWith(`${section.notebook_group}:${section.label}${SECTION_PATH_SEPARATOR}`)) {
        setActiveSectionKey(null);
        setSelectedPageId(null);
      }
      setManageSectionKey(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function renderSectionTree(nodes: SectionTreeNode[], depth = 0): React.ReactNode {
    return nodes.map((node) => {
      const sectionLike: SectionRecord = {
        key: node.key,
        label: node.fullLabel,
        notebook_group: node.notebook_group,
        notes: node.notes,
        favorite: node.favorite,
      };
      const isActive = activeSectionKey === node.key;
      const isInlineRenaming = renameSectionKey === node.key;
      const isDraggedSection = draggedSectionKey === node.key;

      return (
        <Stack key={node.key} gap={4}>
          <Card
            withBorder
            radius="lg"
            p="sm"
            style={{
              marginLeft: depth * 12,
              cursor: "pointer",
              background: isActive ? "rgba(0, 96, 128, 0.12)" : isDraggedSection ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.01)",
              borderColor: isActive ? "rgba(0, 128, 166, 0.42)" : isDraggedSection ? "rgba(148, 163, 184, 0.26)" : undefined,
              boxShadow: isActive ? "inset 0 0 0 1px rgba(0, 128, 166, 0.12)" : undefined,
            }}
            onClick={() => setActiveSectionKey(node.key)}
            onContextMenu={(event) => openSectionContextMenu(event, sectionLike)}
            draggable
            onDragStart={(event) => {
              setDraggedSectionKey(node.key);
              event.dataTransfer.setData("application/x-folder-key", node.key);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => setDraggedSectionKey(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const folderKey = event.dataTransfer.getData("application/x-folder-key");
              if (folderKey) {
                const draggedSection = sectionRecords.find((section) => section.key === folderKey);
                if (
                  draggedSection &&
                  draggedSection.key !== node.key &&
                  !node.fullLabel.startsWith(`${draggedSection.label}${SECTION_PATH_SEPARATOR}`)
                ) {
                  void moveSectionFolder(draggedSection, node.fullLabel, node.notebook_group);
                }
                setDraggedSectionKey(null);
                return;
              }

              const noteId = Number(event.dataTransfer.getData("text/plain") || draggedNoteId || 0);
              const note = managerOwnedNotes.find((item) => item.id === noteId);
              if (note) void moveNoteToSection(note, node.key);
            }}
          >
            <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
              <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                <ThemeIcon size={34} radius="md" variant={isActive ? "filled" : "light"} color={node.notebook_group === "management" ? "blue" : node.notebook_group === "other" ? "orange" : "grape"}>
                  <IconFolders size={16} />
                </ThemeIcon>
                <div style={{ minWidth: 0, flex: 1 }}>
                  {isInlineRenaming ? (
                    <TextInput
                      value={renameSectionName}
                      onChange={(e) => setRenameSectionName(e.currentTarget.value)}
                      size="xs"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          void renameSectionFolder(sectionLike, renameSectionName);
                        }
                        if (e.key === "Escape") {
                          setRenameSectionKey(null);
                          setRenameSectionName("");
                        }
                      }}
                      onBlur={() => {
                        if (renameSectionName.trim()) {
                          void renameSectionFolder(sectionLike, renameSectionName);
                        } else {
                          setRenameSectionKey(null);
                          setRenameSectionName("");
                        }
                      }}
                    />
                  ) : (
                    <>
                      <Text fw={600} size="sm" truncate>{node.label}</Text>
                      <Group gap={6}>
                        <Text size="xs" c="dimmed">{node.notes.length} {node.notes.length === 1 ? "page" : "pages"}</Text>
                        {node.notes.length > 0 && (() => {
                          const openActions = tasks.filter(t => t.created_by === identity?.name && t.status !== "done" && (t.section_name === node.fullLabel || t.section_name === node.label));
                          if (openActions.length === 0) return null;
                          return <Badge size="xs" variant="light" color="yellow">{openActions.length} open</Badge>;
                        })()}
                      </Group>
                    </>
                  )}
                </div>
              </Group>

              <Group gap={2} wrap="nowrap">
                <ActionIcon
                  variant="subtle"
                  color={sectionLike.favorite ? "yellow" : "gray"}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleFavoriteSection(sectionLike);
                  }}
                >
                  {sectionLike.favorite ? <IconStarFilled size={15} /> : <IconStar size={15} />}
                </ActionIcon>
                <Menu withinPortal position="bottom-end" shadow="md">
                  <Menu.Target>
                    <ActionIcon variant="subtle" color="gray" onClick={(e) => e.stopPropagation()}>
                      <IconDotsVertical size={16} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                    <Menu.Item
                      leftSection={<IconPlus size={14} />}
                      onClick={() => {
                        setCreateSectionGroup(node.notebook_group);
                        setCreateSectionParent(node.fullLabel);
                        setCreateSectionName("");
                        setCreateSectionOpen(true);
                      }}
                    >
                      New subfolder
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconEdit size={14} />}
                      onClick={() => {
                        setRenameSectionKey(node.key);
                        setRenameSectionName(node.label);
                      }}
                    >
                      Rename inline
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconArrowsRight size={14} />}
                      onClick={() => {
                        setMoveSectionKey(node.key);
                        setMoveSectionTargetParent(null);
                        setMoveSectionOpen(true);
                      }}
                    >
                      Move folder
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      onClick={() => void deleteSectionFolder(sectionLike)}
                    >
                      Delete folder
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </Group>
          </Card>
          {node.children.length > 0 ? renderSectionTree(node.children, depth + 1) : null}
        </Stack>
      );
    });
  }

  function renderPageNode(note: NormalizedNote) {
    const active = selectedPageId === note.id;
    const notebookColor = note.notebook_group === "management" ? "blue" : note.notebook_group === "other" ? "orange" : "grape";
    const discussionCount = safeJsonArray(note.discussion_points_json).length;
    const actionCount = safeJsonArray(note.manager_action_items_json).length + safeJsonArray(note.employee_action_items_json).length;

    return (
      <Card
        key={note.id}
        withBorder
        radius="lg"
        p="sm"
        draggable
        onDragStart={(event) => {
          setDraggedNoteId(note.id);
          event.dataTransfer.setData("text/plain", String(note.id));
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => setDraggedNoteId(null)}
        onClick={() => setSelectedPageId(note.id)}
        style={{
          cursor: "pointer",
          background: active ? "rgba(0, 96, 128, 0.10)" : "rgba(255,255,255,0.015)",
          borderColor: active ? "rgba(0, 128, 166, 0.42)" : undefined,
          boxShadow: active ? "inset 0 0 0 1px rgba(0, 128, 166, 0.1)" : undefined,
        }}
      >
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <ThemeIcon size={30} radius="md" variant={active ? "filled" : "light"} color={notebookColor} style={{ flexShrink: 0, marginTop: 2 }}>
            <IconClipboardText size={14} />
          </ThemeIcon>
          <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Text fw={600} size="sm" truncate style={{ flex: 1 }}>{note.title}</Text>
              <Text size="xs" c="dimmed" style={{ flexShrink: 0, whiteSpace: "nowrap" }}>{formatDate(note.meeting_date)}</Text>
            </Group>
            <Text size="xs" c="dimmed" lineClamp={1}>{note.summary_markdown || "No summary yet."}</Text>
            <Group gap={6} mt={2}>
              {note.is_archived && <Badge size="xs" variant="light" color="gray">Archived</Badge>}
              {note.parent_note_id && <Badge size="xs" variant="dot" color={notebookColor}>Subpage</Badge>}
              {discussionCount > 0 && <Text size="xs" c="dimmed">{discussionCount} topics</Text>}
              {actionCount > 0 && <Badge size="xs" variant="light" color="yellow">{actionCount} actions</Badge>}
            </Group>
          </Stack>
        </Group>
      </Card>
    );
  }

  const pagePanelTitle = search.trim()
    ? `Search results (${filteredManagerNotes.length})`
    : activeSection
      ? `${activeSection.notebook_group === "management" ? "Management" : activeSection.notebook_group === "other" ? "Others" : "Individual"} section · ${activeSection.label}`
      : "Select a section";

  return (
    <WidgetFrame
      title="Meeting Notes"
      subtitle={isManager ? `${managerOwnedNotes.length} pages · ${tasks.filter(t => t.created_by === identity?.name && t.status !== "done").length} open actions` : "Your shared notes and follow-up tasks"}
      icon={IconNotes}
      iconColor="grape"
      loading={loading}
      onRefresh={load}
      headerActions={isManager ? (
        <Group gap="xs">
          <Button size="xs" variant="subtle" color="dimmed" leftSection={<IconMailSpark size={14} />} onClick={() => { resetComposer("individual"); setOpenComposer(true); void loadGmailNotes(); }} loading={gmailLoading}>Sync Gmail</Button>
          <Button size="xs" variant="filled" color="grape" leftSection={<IconPlus size={14} />} onClick={() => { resetComposer("individual"); setOpenComposer(true); }}>New page</Button>
        </Group>
      ) : undefined}
    >
      <Stack gap="md">
        {error && <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">{error}</Alert>}
        {aiError && <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light">AI assistant: {aiError}</Alert>}

        {isManager ? (
          <>
            <SegmentedControl
              value={managerView}
              onChange={(value) => setManagerView(value as "notebook" | "all_notes" | "actions")}
              data={[
                { value: "notebook", label: "Notebook" },
                { value: "all_notes", label: "All notes" },
                { value: "actions", label: "Action center" },
              ]}
            />
            <Card withBorder radius="lg" p="sm">
              <Group gap="xl" wrap="wrap">
                <Group gap="xs">
                  <ThemeIcon size={28} radius="md" variant="light" color="grape"><IconUser size={14} /></ThemeIcon>
                  <Stack gap={0}>
                    <Text size="xs" c="dimmed">1:1 pages</Text>
                    <Text fw={700} size="sm">{individualCount}</Text>
                  </Stack>
                </Group>
                <Group gap="xs">
                  <ThemeIcon size={28} radius="md" variant="light" color="blue"><IconUsersGroup size={14} /></ThemeIcon>
                  <Stack gap={0}>
                    <Text size="xs" c="dimmed">Management</Text>
                    <Text fw={700} size="sm">{managementCount}</Text>
                  </Stack>
                </Group>
                <Group gap="xs">
                  <ThemeIcon size={28} radius="md" variant="light" color="orange"><IconBook size={14} /></ThemeIcon>
                  <Stack gap={0}>
                    <Text size="xs" c="dimmed">Other</Text>
                    <Text fw={700} size="sm">{otherCount}</Text>
                  </Stack>
                </Group>
                <Group gap="xs">
                  <ThemeIcon size={28} radius="md" variant="light" color="gray"><IconClipboardText size={14} /></ThemeIcon>
                  <Stack gap={0}>
                    <Text size="xs" c="dimmed">Archived</Text>
                    <Text fw={700} size="sm">{archivedCount}</Text>
                  </Stack>
                </Group>
                <Group gap="xs">
                  <ThemeIcon size={28} radius="md" variant="light" color="yellow"><IconChecklist size={14} /></ThemeIcon>
                  <Stack gap={0}>
                    <Text size="xs" c="dimmed">Open actions</Text>
                    <Text fw={700} size="sm">{tasks.filter(t => t.created_by === identity?.name && t.status !== "done").length}</Text>
                  </Stack>
                </Group>
                <Group gap="xs">
                  <ThemeIcon size={28} radius="md" variant="light" color="teal"><IconFolders size={14} /></ThemeIcon>
                  <Stack gap={0}>
                    <Text size="xs" c="dimmed">Sections</Text>
                    <Text fw={700} size="sm">{sectionRecords.length}</Text>
                  </Stack>
                </Group>
              </Group>
            </Card>

            {managerView === "notebook" ? (
            <Stack gap="md">
              <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 320px) minmax(300px, 360px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
                <Card withBorder radius="xl" p="md">
                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <Text fw={700} size="sm">Sections</Text>
                      <Button
                        size="xs"
                        radius="md"
                        variant="light"
                        leftSection={<IconPlus size={12} />}
                        onClick={() => { setCreateSectionGroup("individual"); setCreateSectionParent(null); setCreateSectionName(""); setCreateSectionOpen(true); }}
                      >
                        New
                      </Button>
                    </Group>

                    <TextInput
                      value={search}
                      onChange={(e) => setSearch(e.currentTarget.value)}
                      placeholder="Search sections or pages…"
                      leftSection={<IconSearch size={14} />}
                      radius="md"
                      size="sm"
                    />

                    <Accordion multiple value={accordionValues} onChange={setAccordionValues} chevronPosition="right" variant="separated" radius="md">
                      {favoriteSections.length > 0 && (
                        <Accordion.Item value="favorites">
                          <Accordion.Control icon={<IconStar size={14} />}><Text size="sm">Pinned</Text></Accordion.Control>
                          <Accordion.Panel>
                            <Stack gap="xs">
                              {favoriteSections.map((section) => (
                                <Card key={section.key} withBorder radius="md" p="xs" style={{ cursor: "pointer", background: activeSectionKey === section.key ? "rgba(0, 96, 128, 0.12)" : undefined, borderColor: activeSectionKey === section.key ? "rgba(0, 128, 166, 0.45)" : undefined }} onClick={() => setActiveSectionKey(section.key)}>
                                  <Group justify="space-between" wrap="nowrap">
                                    <Group gap="xs" wrap="nowrap">
                                      <ThemeIcon size={22} radius="sm" variant="light" color="yellow"><IconStarFilled size={11} /></ThemeIcon>
                                      <div>
                                        <Text fw={600} size="xs">{section.label}</Text>
                                        <Text size="xs" c="dimmed">{section.notes.length} pages</Text>
                                      </div>
                                    </Group>
                                    <ActionIcon size="xs" variant="subtle" color="yellow" onClick={(e) => { e.stopPropagation(); void toggleFavoriteSection(section); }}>
                                      <IconStarFilled size={11} />
                                    </ActionIcon>
                                  </Group>
                                </Card>
                              ))}
                            </Stack>
                          </Accordion.Panel>
                        </Accordion.Item>
                      )}

                      <Accordion.Item value="individual">
                        <Accordion.Control icon={<IconUser size={14} />}>
                          <Group justify="space-between" wrap="nowrap" pr="xs">
                            <Text size="sm">1:1 sections</Text>
                            <Badge size="xs" variant="light" color="grape">{individualTree.reduce((acc, n) => acc + 1 + n.children.length, 0)}</Badge>
                          </Group>
                        </Accordion.Control>
                        <Accordion.Panel>
                          <Stack gap="xs">
                            <ScrollArea.Autosize mah={320} offsetScrollbars>
                              <Stack gap="xs">{renderSectionTree(individualTree)}</Stack>
                            </ScrollArea.Autosize>
                            <Button size="xs" radius="md" variant="subtle" leftSection={<IconPlus size={11} />} onClick={() => { setCreateSectionGroup("individual"); setCreateSectionParent(null); setCreateSectionName(""); setCreateSectionOpen(true); }}>Add folder</Button>
                          </Stack>
                        </Accordion.Panel>
                      </Accordion.Item>

                      <Accordion.Item value="management">
                        <Accordion.Control icon={<IconUsersGroup size={14} />}>
                          <Group justify="space-between" wrap="nowrap" pr="xs">
                            <Text size="sm">Management</Text>
                            <Badge size="xs" variant="light" color="blue">{managementTree.reduce((acc, n) => acc + 1 + n.children.length, 0)}</Badge>
                          </Group>
                        </Accordion.Control>
                        <Accordion.Panel>
                          <Stack gap="xs">
                            <ScrollArea.Autosize mah={320} offsetScrollbars>
                              <Stack gap="xs">{renderSectionTree(managementTree)}</Stack>
                            </ScrollArea.Autosize>
                            <Button size="xs" radius="md" variant="subtle" leftSection={<IconPlus size={11} />} onClick={() => { setCreateSectionGroup("management"); setCreateSectionParent(null); setCreateSectionName(""); setCreateSectionOpen(true); }}>Add folder</Button>
                          </Stack>
                        </Accordion.Panel>
                      </Accordion.Item>

                      <Accordion.Item value="other">
                        <Accordion.Control icon={<IconBook size={14} />}>
                          <Group justify="space-between" wrap="nowrap" pr="xs">
                            <Text size="sm">Other</Text>
                            <Badge size="xs" variant="light" color="orange">{otherTree.reduce((acc, n) => acc + 1 + n.children.length, 0)}</Badge>
                          </Group>
                        </Accordion.Control>
                        <Accordion.Panel>
                          <Stack gap="xs">
                            <ScrollArea.Autosize mah={260} offsetScrollbars>
                              <Stack gap="xs">{renderSectionTree(otherTree)}</Stack>
                            </ScrollArea.Autosize>
                            <Button size="xs" radius="md" variant="subtle" leftSection={<IconPlus size={11} />} onClick={() => { setCreateSectionGroup("other"); setCreateSectionParent(null); setCreateSectionName(""); setCreateSectionOpen(true); }}>Add folder</Button>
                          </Stack>
                        </Accordion.Panel>
                      </Accordion.Item>

                      {customAreaNames.map((area) => (
                        <Accordion.Item key={area} value={area}>
                          <Accordion.Control icon={<IconBook size={16} />} onContextMenu={(event) => openAreaContextMenu(event, area)}>{area}</Accordion.Control>
                          <Accordion.Panel>
                            <Stack gap="sm">
                              <Group justify="space-between">
                                <Text size="xs" tt="uppercase" fw={700} c="dimmed">Notebook area</Text>
                                <Button size="xs" radius="md" variant="subtle" leftSection={<IconPlus size={12} />} onClick={() => openCreateSectionModal("other", area)}>Add section</Button>
                              </Group>
                              <Divider />
                              <ScrollArea.Autosize mah={260} offsetScrollbars>
                                <Stack gap="xs">
                                  {(customAreaTrees[area] ?? []).length === 0 ? (
                                    <Card withBorder radius="lg" p="md" bg="transparent">
                                      <Text size="sm" c="dimmed">No sections in this area yet.</Text>
                                    </Card>
                                  ) : renderSectionTree(customAreaTrees[area] ?? [])}
                                </Stack>
                              </ScrollArea.Autosize>
                            </Stack>
                          </Accordion.Panel>
                        </Accordion.Item>
                      ))}
                    </Accordion>
                  </Stack>
                </Card>

                <Card withBorder radius="xl" p="md">
                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <Text fw={700} size="sm" truncate style={{ maxWidth: 220 }}>{pagePanelTitle}</Text>
                      {pageList.length > 0 && <Badge variant="light" size="sm">{pageList.length}</Badge>}
                    </Group>
                    <ScrollArea.Autosize mah={660} offsetScrollbars>
                      <Stack gap="xs">
                        {!activeSection && !search.trim() ? (
                          <Stack gap="xs">
                            <Text size="xs" c="dimmed" tt="uppercase" fw={600} px={2}>Recent pages</Text>
                            {[...managerOwnedNotes]
                              .filter(n => !n.is_archived)
                              .sort((a, b) => new Date(b.meeting_date ?? b.created_at ?? 0).getTime() - new Date(a.meeting_date ?? a.created_at ?? 0).getTime())
                              .slice(0, 7)
                              .map((note) => renderPageNode(note))}
                          </Stack>
                        ) : visiblePageList.length === 0 ? (
                          <Card withBorder radius="lg" p="lg" bg="transparent">
                            <Stack align="center" gap="xs" py="sm">
                              <ThemeIcon size={32} radius="md" variant="light" color="gray"><IconNotes size={16} /></ThemeIcon>
                              <Text size="sm" c="dimmed" ta="center">No pages in this section yet.</Text>
                              <Button size="xs" variant="light" color="grape" leftSection={<IconPlus size={12} />} onClick={() => { resetComposer("individual"); setOpenComposer(true); }}>Add a page</Button>
                            </Stack>
                          </Card>
                        ) : visiblePageList.map((note) => renderPageNode(note))}
                        {pageList.length > visiblePageList.length && <Text size="xs" c="dimmed" ta="center">Showing {visiblePageList.length} of {pageList.length}</Text>}
                      </Stack>
                    </ScrollArea.Autosize>
                  </Stack>
                </Card>

                <Stack gap="sm">
                  {selectedNote ? (
                    <>
                      <Card withBorder radius="xl" p="sm">
                        <Group justify="space-between" align="center" gap="sm" wrap="nowrap">
                          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                            <Text fw={700} size="sm" truncate>{selectedNote.title}</Text>
                            <Group gap={6}>
                              <Badge size="xs" variant="light" color={selectedNote.notebook_group === "management" ? "blue" : selectedNote.notebook_group === "other" ? "orange" : "grape"}>{selectedNote.section_name}</Badge>
                              {selectedNote.is_archived && <Badge size="xs" variant="light" color="gray">Archived</Badge>}
                              {selectedNote.meeting_date && <Text size="xs" c="dimmed">{formatDate(selectedNote.meeting_date)}</Text>}
                            </Group>
                          </Stack>
                          <Group gap={4} wrap="nowrap">
                            <Button size="xs" radius="md" variant="light" onClick={() => { populateComposer(selectedNote); setOpenComposer(true); }}>Edit</Button>
                            <Button size="xs" radius="md" variant="subtle" onClick={() => { populateComposer(selectedNote, true); setOpenComposer(true); }}>+ Subpage</Button>
                            <Button size="xs" radius="md" variant="subtle" color="gray" onClick={() => void archiveNote(selectedNote, !selectedNote.is_archived)}>{selectedNote.is_archived ? "Restore" : "Archive"}</Button>
                            <ActionIcon size="sm" color="red" variant="subtle" onClick={() => void deleteNote(selectedNote)}><IconTrash size={14} /></ActionIcon>
                          </Group>
                        </Group>
                      </Card>
                      <DetailCard note={selectedNote} managerView />
                    </>
                  ) : (
                    <Card withBorder radius="xl" p="xl" style={{ background: "transparent" }}>
                      <Stack gap="xs" align="center" py="lg">
                        <ThemeIcon size={40} radius="xl" variant="light" color="grape">
                          <IconNotes size={20} />
                        </ThemeIcon>
                        <Text fw={600} size="sm">Pick a page to view</Text>
                        <Text size="xs" c="dimmed" ta="center">Select a section, then click any page card to see its summary and actions here.</Text>
                      </Stack>
                    </Card>
                  )}
                </Stack>
              </div>
            </Stack>
            ) : managerView === "all_notes" ? (
              <Stack gap="md">
                <Group gap="sm">
                  <Select
                    size="sm"
                    placeholder="All notebooks"
                    data={[{ value: "all", label: "All notebooks" }, { value: "individual", label: "1:1 notes" }, { value: "management", label: "Management" }, { value: "other", label: "Other" }]}
                    value={noteGroupFilter}
                    onChange={(value) => setNoteGroupFilter(value || "all")}
                    allowDeselect={false}
                    style={{ width: 180 }}
                  />
                  <TextInput
                    size="sm"
                    value={search}
                    onChange={(e) => setSearch(e.currentTarget.value)}
                    placeholder="Search notes…"
                    leftSection={<IconSearch size={14} />}
                    style={{ flex: 1 }}
                  />
                </Group>
                <Card withBorder radius="lg" p={0}>
                  <Table highlightOnHover horizontalSpacing="md" verticalSpacing="sm">
                    <Table.Thead><Table.Tr><Table.Th>Note</Table.Th><Table.Th>Section</Table.Th><Table.Th>Date</Table.Th><Table.Th>Actions</Table.Th></Table.Tr></Table.Thead>
                    <Table.Tbody>
                      {filteredAllNotes.length === 0 ? <Table.Tr><Table.Td colSpan={4}><Text size="sm" c="dimmed" ta="center">No notes matched your filters.</Text></Table.Td></Table.Tr> : filteredAllNotes.map((note) => (
                        <Table.Tr key={note.id}>
                          <Table.Td><Text fw={600} size="sm">{note.title}</Text><Text size="xs" c="dimmed" lineClamp={1}>{note.summary_markdown}</Text></Table.Td>
                          <Table.Td><Badge variant="light" size="sm" color={note.notebook_group === "management" ? "blue" : note.notebook_group === "other" ? "orange" : "grape"}>{note.section_name}</Badge></Table.Td>
                          <Table.Td><Text size="sm">{formatDate(note.meeting_date)}</Text></Table.Td>
                          <Table.Td><Group gap="xs"><Button size="xs" variant="light" onClick={() => { setManagerView("notebook"); setActiveSectionKey(`${note.notebook_group}:${note.section_name}`); setSelectedPageId(note.id); }}>Open</Button><Button size="xs" variant="subtle" color="grape" onClick={() => void createTasksFromNote(note)}>Extract tasks</Button></Group></Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Card>
              </Stack>
            ) : (
              <Stack gap="md">
                <Group gap="sm" wrap="wrap">
                  <Select
                    size="sm"
                    placeholder="All owners"
                    data={[{ value: "all", label: "All owners" }, ...Array.from(new Set(managerTaskRows.map((task) => task.owner_name ?? task.employee_name))).filter(Boolean).map((name) => ({ value: name, label: name }))]}
                    value={taskOwnerFilter}
                    onChange={(value) => setTaskOwnerFilter(value || "all")}
                    searchable
                    allowDeselect={false}
                    style={{ width: 160 }}
                  />
                  <Select
                    size="sm"
                    placeholder="All statuses"
                    data={[{ value: "all", label: "All statuses" }, ...TASK_STATUS_OPTIONS]}
                    value={taskStatusFilter}
                    onChange={(value) => setTaskStatusFilter(value || "all")}
                    allowDeselect={false}
                    style={{ width: 150 }}
                  />
                  <Select
                    size="sm"
                    placeholder="All priorities"
                    data={[{ value: "all", label: "All priorities" }, ...TASK_PRIORITY_OPTIONS]}
                    value={taskPriorityFilter}
                    onChange={(value) => setTaskPriorityFilter(value || "all")}
                    allowDeselect={false}
                    style={{ width: 150 }}
                  />
                  <TextInput
                    size="sm"
                    value={search}
                    onChange={(e) => setSearch(e.currentTarget.value)}
                    placeholder="Search tasks…"
                    leftSection={<IconSearch size={14} />}
                    style={{ flex: 1, minWidth: 160 }}
                  />
                </Group>
                <Card withBorder radius="lg" p={0}>
                  <Table highlightOnHover horizontalSpacing="md" verticalSpacing="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Task</Table.Th>
                        <Table.Th>Owner</Table.Th>
                        <Table.Th>Priority</Table.Th>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>Due</Table.Th>
                        <Table.Th>Section</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {filteredManagerTasks.length === 0 ? (
                        <Table.Tr><Table.Td colSpan={6}><Text size="sm" c="dimmed" ta="center" py="md">No action items matched your filters.</Text></Table.Td></Table.Tr>
                      ) : filteredManagerTasks.map((task) => (
                        <Table.Tr key={task.id}>
                          <Table.Td>
                            <Text fw={600} size="sm">{task.title}</Text>
                            {task.details && <Text size="xs" c="dimmed" lineClamp={1}>{task.details}</Text>}
                          </Table.Td>
                          <Table.Td><Text size="sm">{task.owner_name ?? task.employee_name}</Text></Table.Td>
                          <Table.Td>
                            <Select size="xs" data={TASK_PRIORITY_OPTIONS} value={task.priority ?? "medium"} onChange={(value) => void updateTask(task, { priority: value || "medium" })} allowDeselect={false} style={{ width: 110 }} />
                          </Table.Td>
                          <Table.Td>
                            <Select size="xs" data={TASK_STATUS_OPTIONS} value={task.status} onChange={(value) => void updateTask(task, { status: value || "open" })} allowDeselect={false} style={{ width: 120 }} />
                          </Table.Td>
                          <Table.Td>
                            <TextInput size="xs" type="date" value={task.due_date ?? ""} onChange={(e) => void updateTask(task, { due_date: e.currentTarget.value || null })} style={{ width: 140 }} />
                          </Table.Td>
                          <Table.Td>
                            {task.section_name ? <Badge variant="light" size="sm" color="gray">{task.section_name}</Badge> : <Text size="xs" c="dimmed">—</Text>}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Card>
              </Stack>
            )}
          </>
        ) : (
          <Tabs defaultValue="received">
            <Tabs.List>
              <Tabs.Tab value="received" leftSection={<IconNotes size={14} />}>My notebook</Tabs.Tab>
              <Tabs.Tab value="tasks" leftSection={<IconChecklist size={14} />}>My action items</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="received" pt="md">
              <Stack gap="md">
                <TextInput leftSection={<IconSearch size={14} />} placeholder="Search my notes" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
                {receivedNotes.filter((note) => noteMatchesSearch(note, search)).length === 0
                  ? <Text size="sm" c="dimmed">No meeting summaries have been shared with you yet.</Text>
                  : receivedNotes.filter((note) => noteMatchesSearch(note, search)).map((note) => <DetailCard key={note.id} note={note} managerView={false} />)}
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
                    <Group justify="flex-end"><Button onClick={() => void addTask()} loading={saving} leftSection={<IconPlus size={14} />}>Add task</Button></Group>
                  </Stack>
                </Card>
                <Card withBorder radius="lg" p={0}>
                  <Table highlightOnHover horizontalSpacing="md" verticalSpacing="sm">
                    <Table.Thead><Table.Tr><Table.Th>Task</Table.Th><Table.Th>Status</Table.Th><Table.Th>Due</Table.Th><Table.Th>Action</Table.Th></Table.Tr></Table.Thead>
                    <Table.Tbody>
                      {myTasks.length === 0 ? (
                        <Table.Tr><Table.Td colSpan={4}><Text size="sm" c="dimmed" ta="center">No personal tasks yet.</Text></Table.Td></Table.Tr>
                      ) : myTasks.map((task) => (
                        <Table.Tr key={task.id}>
                          <Table.Td><Text fw={600}>{task.title}</Text>{task.details && <Text size="xs" c="dimmed">{task.details}</Text>}</Table.Td>
                          <Table.Td><Badge variant="light" color={task.status === "done" ? "green" : task.status === "in_progress" ? "blue" : "yellow"}>{task.status}</Badge></Table.Td>
                          <Table.Td>{task.due_date || "—"}</Table.Td>
                          <Table.Td><Group gap="xs">{task.status !== "in_progress" && <Button size="xs" variant="light" onClick={() => void updateTaskStatus(task, "in_progress")}>Start</Button>}{task.status !== "done" && <Button size="xs" variant="light" color="green" onClick={() => void updateTaskStatus(task, "done")}>Done</Button>}</Group></Table.Td>
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

      {contextMenu && (
        <Card
          ref={contextMenuRef}
          withBorder
          radius="lg"
          p="xs"
          style={{
            position: "fixed",
            left: Math.min(contextMenu.x, window.innerWidth - 240),
            top: Math.min(contextMenu.y, window.innerHeight - 220),
            width: 220,
            zIndex: 10050,
            boxShadow: "0 18px 48px rgba(0,0,0,0.35)",
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <Stack gap={4}>
            {contextMenu.type === "section" && contextMenuSection ? (
              <>
                <Button variant="subtle" justify="flex-start" leftSection={<IconEdit size={14} />} onClick={() => { setRenameSectionKey(contextMenuSection.key); setRenameSectionName(splitSectionPath(contextMenuSection.label).slice(-1)[0] ?? contextMenuSection.label); setContextMenu(null); }}>Rename</Button>
                <Button variant="subtle" justify="flex-start" leftSection={<IconArrowsRight size={14} />} onClick={() => { setMoveSectionKey(contextMenuSection.key); setMoveSectionTargetParent(null); setMoveSectionOpen(true); setContextMenu(null); }}>Move</Button>
                <Button variant="subtle" justify="flex-start" leftSection={<IconClipboardText size={14} />} onClick={() => void duplicateSectionFolder(contextMenuSection)}>Copy</Button>
                <Button variant="subtle" justify="flex-start" color="red" leftSection={<IconTrash size={14} />} onClick={() => void deleteSectionFolder(contextMenuSection)}>Delete</Button>
              </>
            ) : contextMenu.type === "area" && contextMenu.areaName ? (
              <>
                <Button variant="subtle" justify="flex-start" leftSection={<IconEdit size={14} />} onClick={() => { const next = window.prompt("Rename notebook area", contextMenu.areaName ?? ""); if (next && contextMenu.areaName) void renameArea(contextMenu.areaName, next); setContextMenu(null); }}>Rename</Button>
                <Button variant="subtle" justify="flex-start" leftSection={<IconArrowsRight size={14} />} onClick={() => { const next = window.prompt("Move area into another area (leave blank for Other sections)", ""); void moveArea(contextMenu.areaName!, next || null); setContextMenu(null); }}>Move</Button>
                <Button variant="subtle" justify="flex-start" leftSection={<IconClipboardText size={14} />} onClick={() => void copyArea(contextMenu.areaName!)}>Copy</Button>
              </>
            ) : null}
          </Stack>
        </Card>
      )}

      <Modal
        opened={Boolean(managedSection)}
        onClose={() => setManageSectionKey(null)}
        title={managedSection ? `Manage folder · ${managedSection.label}` : "Manage folder"}
        centered
      >
        <Stack gap="md">
          {managedSection && (
            <>
              <Card withBorder radius="lg" p="md">
                <Stack gap={4}>
                  <Text fw={700}>{managedSection.label}</Text>
                  <Text size="sm" c="dimmed">
                    {managedSection.notes.length} page{managedSection.notes.length === 1 ? "" : "s"} in this folder.
                  </Text>
                </Stack>
              </Card>
              <Button
                variant="light"
                leftSection={<IconPlus size={14} />}
                onClick={() => {
                  openCreateSectionModal(managedSection.notebook_group, managedSection.label);
                  setManageSectionKey(null);
                }}
              >
                Create section
              </Button>
              <Button
                variant="light"
                color="blue"
                leftSection={<IconArrowsRight size={14} />}
                onClick={() => {
                  setMoveSectionKey(managedSection.key);
                  setMoveSectionTargetParent(null);
                  setMoveSectionOpen(true);
                  setManageSectionKey(null);
                }}
              >
                Move folder
              </Button>
              <Button
                variant="light"
                color="red"
                leftSection={<IconTrash size={14} />}
                onClick={() => void deleteSectionFolder(managedSection)}
                loading={saving}
              >
                Delete folder
              </Button>
            </>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={renameSectionOpen}
        onClose={() => {
          setRenameSectionOpen(false);
          setRenameSectionKey(null);
          setRenameSectionName("");
        }}
        title={renamingSection ? `Rename folder · ${renamingSection.label}` : "Rename folder"}
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Rename this folder without changing its parent location. Nested subfolders and pages will keep their structure.
          </Text>
          <TextInput
            label="Folder name"
            value={renameSectionName}
            onChange={(e) => setRenameSectionName(e.currentTarget.value)}
            placeholder="Type the new folder name"
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setRenameSectionOpen(false);
                setRenameSectionKey(null);
                setRenameSectionName("");
              }}
            >
              Cancel
            </Button>
            <Button
              leftSection={<IconEdit size={14} />}
              onClick={() => {
                if (renamingSection) void renameSectionFolder(renamingSection, renameSectionName);
              }}
              loading={saving}
              disabled={!renamingSection || !renameSectionName.trim()}
            >
              Rename folder
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={moveSectionOpen}
        onClose={() => {
          setMoveSectionOpen(false);
          setMoveSectionKey(null);
          setMoveSectionTargetParent(null);
        }}
        title={movingSection ? `Move folder · ${movingSection.label}` : "Move folder"}
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Choose a new parent folder in the same notebook group. Selecting top level will move this folder out to the root.
          </Text>
          <Select
            label="New parent folder"
            data={[{ value: "", label: "Top level" }, ...moveSectionParentOptions]}
            value={moveSectionTargetParent ?? ""}
            onChange={(value) => setMoveSectionTargetParent(value || null)}
            searchable
            allowDeselect={false}
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setMoveSectionOpen(false);
                setMoveSectionKey(null);
                setMoveSectionTargetParent(null);
              }}
            >
              Cancel
            </Button>
            <Button
              leftSection={<IconArrowsRight size={14} />}
              onClick={() => {
                if (movingSection) void moveSectionFolder(movingSection, moveSectionTargetParent);
              }}
              loading={saving}
              disabled={!movingSection}
            >
              Move folder
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={createAreaOpen}
        onClose={() => setCreateAreaOpen(false)}
        title="Create notebook area"
        centered
      >
        <Stack gap="md">
          <TextInput
            label="Area name"
            value={createAreaName}
            onChange={(e) => setCreateAreaName(e.currentTarget.value)}
            placeholder="Type the notebook area name"
            description="Creates a new top-level notebook area like the ones shown in the sidebar."
            autoFocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateAreaOpen(false)}>Cancel</Button>
            <Button onClick={() => void createNotebookArea()} loading={saving}>Create area</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={createSectionOpen}
        onClose={() => setCreateSectionOpen(false)}
        title="Create notebook section"
        centered
      >
        <Stack gap="md">
          <Card withBorder radius="lg" p="sm">
            <Stack gap={4}>
              <Text size="xs" tt="uppercase" fw={700} c="dimmed">Section type</Text>
              <Group gap="xs">
                <Badge
                  variant="light"
                  color={createSectionGroup === "management" ? "blue" : createSectionGroup === "other" ? "orange" : "grape"}
                >
                  {createSectionGroup === "management"
                    ? "Management"
                    : createSectionGroup === "other"
                      ? "Other"
                      : "Individual"}
                </Badge>
                <Text size="sm" c="dimmed">Creates a new notebook section in this area.</Text>
              </Group>
            </Stack>
          </Card>
          <TextInput
            label="Section name"
            value={createSectionName}
            onChange={(e) => setCreateSectionName(e.currentTarget.value)}
            placeholder="Type the notebook section name"
            description="This creates a new notebook section like the ones shown in the sidebar."
            autoFocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateSectionOpen(false)}>Cancel</Button>
            <Button onClick={() => void createSectionFolder()} loading={saving}>Create section</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={openComposer} onClose={() => setOpenComposer(false)} title={editingNoteId ? "Edit notebook page" : parentNoteId ? "Create subpage" : notebookMode === "management" ? "Create management notebook page" : "Prepare 1:1 page"} centered size="xl">
        <Stack gap="md">
          <Alert icon={<IconBook size={16} />} color={notebookMode === "management" ? "blue" : "grape"} variant="light">
            {notebookMode === "management"
              ? "Capture management-level meeting notes into reusable notebook sections for leadership, staffing, operations, and coaching themes."
              : <>Managers can pull Gmail messages automatically from <strong>label:gemini-notes</strong>, structure them, then save them into each employee notebook.</>}
          </Alert>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
            <Select label="Notebook type" data={NOTEBOOK_OPTIONS} value={notebookMode} onChange={(value) => setNotebookMode((value as NotebookMode) || "individual")} allowDeselect={false} />
            <TextInput label="Meeting date" type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.currentTarget.value)} />
          </SimpleGrid>

          {notebookMode === "individual" && (
            <>
              <Card withBorder radius="lg" p="md">
                <Stack gap="sm">
                  <Group justify="space-between" align="flex-end" wrap="wrap">
                    <Stack gap={2}>
                      <Text fw={700}>Gmail Gemini notes</Text>
                      <Text size="sm" c="dimmed">Gmail label source: <strong>label:gemini-notes</strong>. Change the date range below, then load matching notes.</Text>
                    </Stack>
                    <Group gap="xs">
                      <Badge variant="light" color="grape">{gmailMessages.length} loaded</Badge>
                      <Button
                        size="xs"
                        variant="light"
                        color="grape"
                        leftSection={<IconSparkles size={14} />}
                        onClick={() => void autoOrganizeLoadedNotes()}
                        loading={saving || aiLoading}
                        disabled={gmailMessages.filter((message) => !message.imported).length === 0}
                      >
                        Auto-organize all
                      </Button>
                    </Group>
                  </Group>

                  <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                    <TextInput
                      label="Start date"
                      type="date"
                      value={gmailStartDate}
                      onChange={(e) => setGmailStartDate(e.currentTarget.value)}
                    />
                    <TextInput
                      label="End date"
                      type="date"
                      value={gmailEndDate}
                      onChange={(e) => setGmailEndDate(e.currentTarget.value)}
                    />
                    <Button
                      mt={{ base: 0, sm: 25 }}
                      size="sm"
                      variant="light"
                      leftSection={<IconMailSpark size={14} />}
                      onClick={() => void loadGmailNotes()}
                      loading={gmailLoading}
                      fullWidth
                    >
                      Load notes
                    </Button>
                  </SimpleGrid>

                  {gmailMessages.length === 0 ? (
                    <Text size="sm" c="dimmed">No Gmail notes loaded for this range yet.</Text>
                  ) : gmailMessages.map((message) => (
                    <Card key={message.id} withBorder radius="md" p="sm">
                      <Group justify="space-between" align="flex-start">
                        <Stack gap={2} style={{ flex: 1 }}>
                          <Text fw={600}>{message.subject}</Text>
                          <Text size="xs" c="dimmed">{formatDate(message.internalDate ?? message.date)}{message.from ? ` · ${message.from}` : ""}</Text>
                          <Text size="sm" c="dimmed" lineClamp={2}>{message.snippet || message.body}</Text>
                        </Stack>
                        <Group gap="xs">
                          {message.imported && <Badge variant="light" color="yellow">Already used</Badge>}
                          {importedMessageId === message.id && <Badge variant="light" color="grape">Selected</Badge>}
                          <Button
                            size="xs"
                            color="grape"
                            variant={importedMessageId === message.id ? "filled" : "light"}
                            onClick={() => applyImportedMessage(message)}
                          >
                            {importedMessageId === message.id ? "Selected" : "Use this note"}
                          </Button>
                        </Group>
                      </Group>
                    </Card>
                  ))}
                </Stack>
              </Card>
            </>
          )}

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
            {notebookMode === "individual" ? (
              <Select
                label="Start from an existing employee section"
                data={LOCKED_TEAM_NAMES.map((name) => ({ value: name, label: name }))}
                value={selectedEmployee}
                onChange={(value) => {
                  setSelectedEmployee(value);
                  if (value) setCustomSectionName(value);
                }}
                searchable
                clearable
                description="Optional. Pick an existing employee section, or type a brand-new section name on the right."
              />
            ) : notebookMode === "management" ? (
              <Select
                label="Start from an existing management section"
                data={DEFAULT_MANAGEMENT_SECTIONS.map((name) => ({ value: name, label: name }))}
                value={managementSection}
                onChange={(value) => {
                  const next = value || DEFAULT_MANAGEMENT_SECTIONS[0];
                  setManagementSection(next);
                  setCustomSectionName(value || "");
                }}
                searchable
                clearable
                description="Optional. Pick a common management section, or type a new one on the right."
              />
            ) : (
              <TextInput
                label="Notebook"
                value="Other notebook"
                readOnly
                description="Use this notebook for extracted pages and custom sections that are not tied to a specific employee."
              />
            )}
            <TextInput
              label={notebookMode === "individual" ? "Section name" : notebookMode === "management" ? "Management section name" : "Other section name"}
              value={customSectionName}
              onChange={(e) => setCustomSectionName(e.currentTarget.value)}
              placeholder={notebookMode === "individual" ? "Type a new employee or topic section" : notebookMode === "management" ? "Leadership sync" : "Project follow-ups"}
              description="This section will be created automatically if it does not already exist."
            />
          </SimpleGrid>

          <Select label="Source" data={SOURCE_OPTIONS} value={sourceType} onChange={setSourceType} allowDeselect={false} />

          <TextInput label="Title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
          <Textarea
            label={notebookMode === "management" ? "Meeting notes" : "Gemini / Gmail notes"}
            minRows={8}
            value={sourceNotes}
            onChange={(e) => setSourceNotes(e.currentTarget.value)}
            placeholder={notebookMode === "management" ? "Paste leadership or management meeting notes" : "Imported Gmail note body or pasted Gemini-generated notes"}
            ref={composerBodyRef}
            description={importedMessageSubject ? `Loaded from: ${importedMessageSubject}` : undefined}
          />

          <Group justify="space-between">
            <Group gap="xs">
              <Button variant="light" leftSection={<IconSparkles size={14} />} onClick={() => void generateFromNotes()} loading={aiLoading}>Prepare summary</Button>
              {result && <Badge variant="light" color="grape">AI structured</Badge>}
            </Group>
            <Group gap="xs">
              <Button variant="default" onClick={() => setOpenComposer(false)}>Cancel</Button>
              {notebookMode === "individual" && !editingNoteId && <Button variant="light" color="yellow" leftSection={<IconClipboardText size={14} />} onClick={() => void saveNote("draft")} loading={saving}>Save draft</Button>}
              <Button color={notebookMode === "management" ? "blue" : "grape"} leftSection={notebookMode === "management" ? <IconBook size={14} /> : <IconSend size={14} />} onClick={() => void saveNote("shared")} loading={saving}>{editingNoteId ? "Save changes" : notebookMode === "management" ? "Save to notebook" : "Save page"}</Button>
            </Group>
          </Group>

          <Textarea label="Meeting summary" minRows={6} value={summaryMarkdown} onChange={(e) => setSummaryMarkdown(e.currentTarget.value)} placeholder="Clean summary with context, decisions, feedback, and outcomes" />
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
            <Textarea label="Discussion points" minRows={6} value={discussionPoints} onChange={(e) => setDiscussionPoints(e.currentTarget.value)} placeholder="One item per line" />
            <Textarea label="Manager action items" minRows={6} value={managerActionItems} onChange={(e) => setManagerActionItems(e.currentTarget.value)} placeholder="One item per line" />
            <Textarea label={notebookMode === "management" ? "Team follow-ups" : "Employee action items"} minRows={6} value={employeeActionItems} onChange={(e) => setEmployeeActionItems(e.currentTarget.value)} placeholder="One item per line" />
          </SimpleGrid>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(moveDialogNote)}
        onClose={() => {
          setMoveDialogNoteId(null);
          setMoveTargetSectionKey(null);
        }}
        title={moveDialogNote ? `Move “${moveDialogNote.title}”` : "Move page"}
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">Right-click any page to open this menu, or drag a page onto a section in the left sidebar.</Text>
          <Select
            label="Move to section"
            data={allSectionOptions}
            value={moveTargetSectionKey}
            onChange={setMoveTargetSectionKey}
            searchable
            allowDeselect={false}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => {
              setMoveDialogNoteId(null);
              setMoveTargetSectionKey(null);
            }}>Cancel</Button>
            <Button
              onClick={() => {
                if (moveDialogNote && moveTargetSectionKey) void moveNoteToSection(moveDialogNote, moveTargetSectionKey);
              }}
              disabled={!moveDialogNote || !moveTargetSectionKey}
            >
              Move page
            </Button>
          </Group>
        </Stack>
      </Modal>
    </WidgetFrame>
  );
}
