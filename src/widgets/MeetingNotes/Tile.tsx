import { Badge, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconBook, IconChecklist, IconNotes, IconUsersGroup } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { WidgetTile } from "../WidgetTile";
import { useIdentity } from "../../lib/identity";
import { db } from "../../db";

type OneOnOneNote = Awaited<ReturnType<typeof db.one_on_one_notes.list>>[number];
type PersonalActionItem = Awaited<ReturnType<typeof db.personal_action_items.list>>[number];

const MANAGEMENT_PREFIX = "Management · ";
const OTHER_PREFIX = "Other · ";

function isManagementNote(note: OneOnOneNote) {
  return String(note.employee_name ?? "").startsWith(MANAGEMENT_PREFIX);
}

function isOtherNotebookNote(note: OneOnOneNote) {
  return note.notebook_group === "other" || String(note.employee_name ?? "").startsWith(OTHER_PREFIX);
}

export function MeetingNotesTile({ onExpand }: { onExpand: () => void }) {
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";
  const [notes, setNotes] = useState<OneOnOneNote[]>([]);
  const [tasks, setTasks] = useState<PersonalActionItem[]>([]);

  useEffect(() => {
    Promise.all([
      db.one_on_one_notes.list({ orderBy: { column: "created_at", ascending: false } }).catch(() => [] as OneOnOneNote[]),
      db.personal_action_items.list({ orderBy: { column: "created_at", ascending: false } }).catch(() => [] as PersonalActionItem[]),
    ]).then(([noteRows, taskRows]) => {
      setNotes(noteRows);
      setTasks(taskRows);
    });
  }, []);

  const myManagedNotes = useMemo(() => identity?.name ? notes.filter((note) => note.manager_name === identity.name) : [], [identity?.name, notes]);
  const individualCount = useMemo(() => myManagedNotes.filter((note) => !isManagementNote(note) && !isOtherNotebookNote(note)).length, [myManagedNotes]);
  const managementCount = useMemo(() => myManagedNotes.filter(isManagementNote).length, [myManagedNotes]);
  const personalNotebookCount = useMemo(() => myManagedNotes.filter(isOtherNotebookNote).length, [myManagedNotes]);
  const receivedCount = useMemo(() => identity?.name ? notes.filter((note) => !isManagementNote(note) && note.employee_name === identity.name && note.status === "shared").length : 0, [identity?.name, notes]);
  const openTaskCount = useMemo(() => identity?.name ? tasks.filter((task) => task.employee_name === identity.name && task.status !== "done").length : 0, [identity?.name, tasks]);

  return (
    <WidgetTile
      title="Notebook"
      description={isManager ? "Notebook workspace for 1:1s and management notes" : "Personal notepad for sticky notes, shared summaries, and action items"}
      icon={IconNotes}
      iconColor="grape"
      onExpand={onExpand}
      status={{
        label: isManager ? `${individualCount + managementCount} notes` : `${personalNotebookCount} notebook page${personalNotebookCount === 1 ? "" : "s"}`,
        color: isManager ? "grape" : personalNotebookCount > 0 ? "orange" : "gray",
      }}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        {isManager ? (
          <>
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon radius="md" variant="light" color="grape"><IconBook size={16} /></ThemeIcon>
              <div style={{ flex: 1 }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Individual notebook</Text>
                <Text fw={700}>{individualCount} employee note pages</Text>
              </div>
              <Badge variant="light" color="grape">1:1</Badge>
            </Group>
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon radius="md" variant="light" color="blue"><IconUsersGroup size={16} /></ThemeIcon>
              <div style={{ flex: 1 }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Management notebook</Text>
                <Text fw={700}>{managementCount} leadership pages</Text>
              </div>
              <Badge variant="light" color="blue">Mgmt</Badge>
            </Group>
          </>
        ) : (
          <Stack gap="sm">
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon radius="md" variant="light" color="orange"><IconNotes size={16} /></ThemeIcon>
              <div style={{ flex: 1 }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>My notebook</Text>
                <Text fw={700}>{personalNotebookCount} personal page{personalNotebookCount === 1 ? "" : "s"}</Text>
              </div>
              <Badge variant="light" color="orange">Notepad</Badge>
            </Group>
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon radius="md" variant="light" color="grape"><IconChecklist size={16} /></ThemeIcon>
              <div style={{ flex: 1 }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Shared with me</Text>
                <Text fw={700}>{receivedCount} shared summar{receivedCount === 1 ? "y" : "ies"}</Text>
              </div>
              <Badge variant="light" color={openTaskCount > 0 ? "yellow" : "green"}>{openTaskCount} open tasks</Badge>
            </Group>
          </Stack>
        )}
        <Text size="sm" c="dimmed">
          {isManager
            ? "Organize 1:1 pages by employee and keep a separate notebook for management-level meeting notes in one place."
            : "Use My notebook like sticky notes or a personal notepad for reminders, links, drafts, handoff notes, and anything you want to save for yourself."}
        </Text>
      </Stack>
    </WidgetTile>
  );
}
