import { Badge, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconBook, IconChecklist, IconNotes, IconUsersGroup } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { WidgetTile } from "../WidgetTile";
import { useIdentity } from "../../lib/identity";
import { db } from "../../db";

type OneOnOneNote = Awaited<ReturnType<typeof db.one_on_one_notes.list>>[number];
type PersonalActionItem = Awaited<ReturnType<typeof db.personal_action_items.list>>[number];

const MANAGEMENT_PREFIX = "Management · ";

function isManagementNote(note: OneOnOneNote) {
  return String(note.employee_name ?? "").startsWith(MANAGEMENT_PREFIX);
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
  const individualCount = useMemo(() => myManagedNotes.filter((note) => !isManagementNote(note)).length, [myManagedNotes]);
  const managementCount = useMemo(() => myManagedNotes.filter(isManagementNote).length, [myManagedNotes]);
  const receivedCount = useMemo(() => identity?.name ? notes.filter((note) => !isManagementNote(note) && note.employee_name === identity.name && note.status === "shared").length : 0, [identity?.name, notes]);
  const openTaskCount = useMemo(() => identity?.name ? tasks.filter((task) => task.employee_name === identity.name && task.status !== "done").length : 0, [identity?.name, tasks]);

  return (
    <WidgetTile
      title="Meeting Notes"
      description={isManager ? "Notebook workspace for 1:1s and management notes" : "Shared summaries and personal action items"}
      icon={IconNotes}
      iconColor="grape"
      onExpand={onExpand}
      status={{
        label: isManager ? `${individualCount + managementCount} notes` : `${receivedCount} shared`,
        color: isManager ? "grape" : receivedCount > 0 ? "green" : "gray",
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
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon radius="md" variant="light" color="grape"><IconChecklist size={16} /></ThemeIcon>
            <div style={{ flex: 1 }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>My notebook</Text>
              <Text fw={700}>{receivedCount} shared summaries</Text>
            </div>
            <Badge variant="light" color={openTaskCount > 0 ? "yellow" : "green"}>{openTaskCount} open tasks</Badge>
          </Group>
        )}
        <Text size="sm" c="dimmed">
          {isManager
            ? "Organize 1:1 pages by employee and keep a separate notebook for management-level meeting notes in one place."
            : "Review shared 1:1 notes and keep track of your own follow-up tasks."}
        </Text>
      </Stack>
    </WidgetTile>
  );
}
