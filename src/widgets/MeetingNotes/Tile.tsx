import { Badge, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconChecklist, IconNotes } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { WidgetTile } from "../WidgetTile";
import { useIdentity } from "../../lib/identity";
import { db } from "../../db";

type OneOnOneNote = Awaited<ReturnType<typeof db.one_on_one_notes.list>>[number];
type PersonalActionItem = Awaited<ReturnType<typeof db.personal_action_items.list>>[number];

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

  const managerCount = useMemo(() => identity?.name ? notes.filter((note) => note.manager_name === identity.name).length : 0, [identity?.name, notes]);
  const receivedCount = useMemo(() => identity?.name ? notes.filter((note) => note.employee_name === identity.name && note.status === "shared").length : 0, [identity?.name, notes]);
  const openTaskCount = useMemo(() => identity?.name ? tasks.filter((task) => task.employee_name === identity.name && task.status !== "done").length : 0, [identity?.name, tasks]);

  return (
    <WidgetTile
      title="1:1 Notes"
      description={isManager ? "Prepare and share meeting summaries" : "Received notes + personal tasks"}
      icon={IconNotes}
      iconColor="grape"
      onExpand={onExpand}
      status={{ label: isManager ? `${managerCount} notes` : `${receivedCount} shared`, color: isManager ? "grape" : receivedCount > 0 ? "green" : "gray" }}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon radius="md" variant="light" color="grape"><IconChecklist size={16} /></ThemeIcon>
          <div style={{ flex: 1 }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{isManager ? "Manager view" : "Individual view"}</Text>
            <Text fw={700}>{isManager ? `${managerCount} prepared summaries` : `${receivedCount} received summaries`}</Text>
          </div>
          <Badge variant="light" color={openTaskCount > 0 ? "yellow" : "green"}>{openTaskCount} open tasks</Badge>
        </Group>
        <Text size="sm" c="dimmed">
          {isManager ? "Auto-pull Gemini meeting notes from Gmail label gemini-notes, structure them into 1:1 summaries, and push them to team members." : "Read manager-shared notes and create your own follow-up action items."}
        </Text>
      </Stack>
    </WidgetTile>
  );
}
