import { useEffect, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Card, Group, Modal, MultiSelect, Select,
  Stack, Text, Textarea, ThemeIcon, Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle, IconHeart, IconHeartFilled,
  IconPlus, IconStar, IconStarFilled, IconTrash,
} from "@tabler/icons-react";
import { db } from "../../db";
import { WidgetFrame } from "../WidgetFrame";
import { useIdentity } from "../../lib/identity";
import { PERSON_TEAM_NAMES } from "../PerformanceTracker/team";

type Kudos = Awaited<ReturnType<typeof db.kudos.list>>[number];

type KudosGroup = {
  ids: number[];
  from_name: string;
  to_names: string[];
  message: string;
  category: string;
  is_pinned: boolean;
  created_at: Date | string;
};

const CATEGORIES = [
  { value: "teamwork",         label: "🤝 Teamwork",           color: "blue" },
  { value: "problem-solving",  label: "🧠 Problem Solving",    color: "violet" },
  { value: "customer-service", label: "🌟 Customer Service",   color: "yellow" },
  { value: "above-beyond",     label: "🚀 Above & Beyond",     color: "orange" },
  { value: "mentorship",       label: "🎓 Mentorship",         color: "teal" },
];

function catMeta(v: string) {
  return CATEGORIES.find(c => c.value === v) ?? { label: v, color: "gray" };
}

function timeAgo(ts: Date | string) {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    if ("error" in error && typeof (error as { error?: unknown }).error === "string") {
      return (error as { error: string }).error;
    }
    if ("message" in error && typeof (error as { message?: unknown }).message === "string") {
      return (error as { message: string }).message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "Something went wrong";
    }
  }
  return "Something went wrong";
}

function formatNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function groupKudosRows(rows: Kudos[]) {
  const groups: KudosGroup[] = [];

  for (const row of rows) {
    const rowTime = new Date(row.created_at).getTime();
    const existing = groups.find((group) => {
      const groupTime = new Date(group.created_at).getTime();
      return (
        group.from_name === row.from_name &&
        group.message === row.message &&
        group.category === row.category &&
        Math.abs(groupTime - rowTime) <= 5_000
      );
    });

    if (existing) {
      existing.ids.push(row.id);
      existing.to_names.push(row.to_name);
      existing.is_pinned = existing.is_pinned || row.is_pinned;
      if (rowTime > new Date(existing.created_at).getTime()) {
        existing.created_at = row.created_at;
      }
      continue;
    }

    groups.push({
      ids: [row.id],
      from_name: row.from_name,
      to_names: [row.to_name],
      message: row.message,
      category: row.category,
      is_pinned: row.is_pinned,
      created_at: row.created_at,
    });
  }

  return groups;
}

export function KudosBoardWidget(_props: { onCollapse?: () => void }) {
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";
  const myName = identity?.name ?? "";

  const [kudosList, setKudosList] = useState<Kudos[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Form state
  const [toNames, setToNames] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>("teamwork");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const rows = await db.kudos.list({ orderBy: { column: "created_at", ascending: false } });
      setKudosList(Array.isArray(rows) ? rows : []);
    } catch {
      // silently show empty state if table not yet provisioned
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function submit() {
    if (toNames.length === 0 || !message.trim() || !category) return;
    if (!myName.trim()) {
      setError("Please sign in before posting kudos.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const inserted = await db.kudos.insert(
        toNames.map((toName) => ({
          from_name: myName,
          to_name: toName,
          message: message.trim(),
          category,
          is_pinned: false,
        })),
      );
      const savedKudos = Array.isArray(inserted)
        ? inserted.filter(Boolean)
        : inserted
          ? [inserted]
          : [];
      setModalOpen(false);
      setToNames([]);
      setMessage("");
      setCategory("teamwork");
      await load();
      if (savedKudos.length > 0) {
        window.dispatchEvent(new CustomEvent("kudos:posted", { detail: savedKudos }));
      }
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function togglePin(group: KudosGroup) {
    setError(null);
    try {
      await Promise.all(group.ids.map((id) => db.kudos.updateById(id, { is_pinned: !group.is_pinned })));
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function deleteKudos(group: KudosGroup) {
    setError(null);
    try {
      await Promise.all(group.ids.map((id) => db.kudos.deleteById(id)));
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const teamOptions = PERSON_TEAM_NAMES.map((n: string) => ({ value: n, label: n }));

  const groupedKudos = groupKudosRows(kudosList);
  const pinned = groupedKudos.filter((k) => k.is_pinned);
  const unpinned = groupedKudos.filter((k) => !k.is_pinned);
  const filtered = [...pinned, ...unpinned];

  return (
    <WidgetFrame title="Kudos Board" icon={IconStar} iconColor="yellow">
      <Stack gap="md" p="md">
        {error && (
          <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light">
            {error}
          </Alert>
        )}

        {/* Header row */}
        <Group justify="space-between" align="center">
          <Text size="sm" c="dimmed">{filtered.length} kudos</Text>
          <Button
            leftSection={<IconPlus size={14} />}
            size="sm"
            color="yellow"
            variant="filled"
            onClick={() => setModalOpen(true)}
          >
            Give Kudos
          </Button>
        </Group>

        {/* Kudos feed */}
        {loading ? (
          <Text size="sm" c="dimmed" ta="center" py="xl">Loading…</Text>
        ) : filtered.length === 0 ? (
          <Card withBorder radius="lg" p="xl">
            <Stack align="center" gap="sm">
              <ThemeIcon size={48} radius="xl" color="yellow" variant="light">
                <IconStar size={28} />
              </ThemeIcon>
              <Text fw={600}>No kudos yet</Text>
              <Text size="sm" c="dimmed" ta="center">Be the first to recognise a teammate!</Text>
            </Stack>
          </Card>
        ) : (
          <Stack gap="sm">
            {filtered.map((k) => {
              const cat = catMeta(k.category);
              const recipientLabel = k.to_names.length > 1 ? "Recipients" : "Recipient";
              return (
                <Card key={k.ids.join("-")} withBorder radius="lg" p="md"
                  style={k.is_pinned ? { borderColor: "var(--mantine-color-yellow-6)", borderWidth: 2 } : undefined}>
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={4} style={{ flex: 1 }}>
                      <Group gap="xs" wrap="wrap">
                        <Badge color={cat.color} variant="light" size="sm">{cat.label}</Badge>
                        {k.is_pinned && <Badge color="yellow" variant="filled" size="xs">📌 Pinned</Badge>}
                        {k.to_names.length > 1 && <Badge color="gray" variant="outline" size="xs">{k.to_names.length} recipients</Badge>}
                      </Group>
                      <Text fw={700} size="sm">
                        <Text span c="dimmed">{recipientLabel}: </Text>
                        <Text span c="yellow.4">✦ {formatNames(k.to_names)}</Text>
                      </Text>
                      <Text size="sm" c="dimmed">from {k.from_name}</Text>
                      <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{k.message}</Text>
                      <Text size="xs" c="dimmed">{timeAgo(k.created_at)}</Text>
                    </Stack>
                    {isManager && (
                      <Group gap="xs">
                        <Tooltip label={k.is_pinned ? "Unpin" : "Pin"}>
                          <ActionIcon variant="subtle" color="yellow" size="sm" onClick={() => void togglePin(k)}>
                            {k.is_pinned ? <IconStarFilled size={14} /> : <IconStar size={14} />}
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Delete">
                          <ActionIcon variant="subtle" color="red" size="sm" onClick={() => void deleteKudos(k)}>
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    )}
                  </Group>
                </Card>
              );
            })}
          </Stack>
        )}
      </Stack>

      {/* Give Kudos modal */}
      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title={
        <Group gap="xs"><IconHeartFilled size={16} color="var(--mantine-color-yellow-4)" /><Text fw={700}>Give Kudos</Text></Group>
      } radius="lg" centered>
        <Stack gap="md">
          <MultiSelect
            label="Who are you recognising?"
            placeholder="Select one or more teammates…"
            data={teamOptions}
            value={toNames}
            onChange={setToNames}
            searchable
            clearable
            required
          />
          <Select
            label="Category"
            data={CATEGORIES.map(c => ({ value: c.value, label: c.label }))}
            value={category}
            onChange={setCategory}
            required
          />
          <Textarea
            label="Message"
            placeholder="Describe what they did and why it mattered…"
            value={message}
            onChange={e => setMessage(e.currentTarget.value)}
            minRows={3}
            maxRows={6}
            required
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              color="yellow"
              leftSection={<IconHeart size={14} />}
              onClick={() => void submit()}
              loading={saving}
              disabled={toNames.length === 0 || !message.trim() || !category}
            >
              Post Kudos
            </Button>
          </Group>
        </Stack>
      </Modal>
    </WidgetFrame>
  );
}

export function KudosBoardTile({ onExpand }: { onExpand: () => void }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    db.kudos.list({ orderBy: { column: "created_at", ascending: false }, limit: 3 })
      .then(rows => setCount(Array.isArray(rows) ? rows.length : 0)).catch(() => {});
  }, []);
  return (
    <Card withBorder radius="lg" p="md" style={{ cursor: "pointer", height: "100%" }} onClick={onExpand}>
      <Group gap="sm" align="flex-start">
        <ThemeIcon size={36} radius="md" variant="light" color="yellow">
          <IconStar size={20} />
        </ThemeIcon>
        <Stack gap={2} style={{ flex: 1 }}>
          <Text fw={700} size="sm">Kudos Board</Text>
          <Text size="xs" c="dimmed">Peer recognition & shoutouts</Text>
          {count !== null && (
            <Badge size="xs" variant="light" color="yellow" mt={4}>{count} kudos posted</Badge>
          )}
        </Stack>
      </Group>
    </Card>
  );
}
