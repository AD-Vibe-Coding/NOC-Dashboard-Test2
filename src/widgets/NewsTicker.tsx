import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBell,
  IconCheck,
  IconInfoCircle,
  IconPencilPlus,
  IconPin,
  IconTrash,
  IconUrgent,
} from "@tabler/icons-react";
import { useIdentity } from "../lib/identity";
import { isManagerRole } from "../lib/auth";
import { db } from "../db";

/* -------------------------------------------------------------------------- */
/*                               Types                                        */
/* -------------------------------------------------------------------------- */

type Priority = "info" | "warning" | "urgent" | "success";

interface ManagerUpdate {
  id: number;
  author_name: string;
  author_email: string | null;
  content: string;
  priority: Priority;
  expires_at: string | null;
  pinned: boolean | null;
  created_at: string;
}

const PRIORITY_CONFIG: Record<
  Priority,
  { color: string; icon: typeof IconInfoCircle; label: string }
> = {
  info: { color: "blue", icon: IconInfoCircle, label: "Info" },
  warning: { color: "yellow", icon: IconAlertTriangle, label: "Warning" },
  urgent: { color: "red", icon: IconUrgent, label: "Urgent" },
  success: { color: "green", icon: IconCheck, label: "Success" },
};

/* -------------------------------------------------------------------------- */
/*                           Scrolling Ticker                                 */
/* -------------------------------------------------------------------------- */

export function NewsTicker() {
  const { identity } = useIdentity();
  const [updates, setUpdates] = useState<ManagerUpdate[]>([]);
  const [_loading, setLoading] = useState(true);
  const [postModalOpen, setPostModalOpen] = useState(false);
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const tickerRef = useRef<HTMLDivElement>(null);
  void tickerRef; // kept to avoid removing the import

  const isManager = isManagerRole(identity?.role);

  const fetchUpdates = useCallback(async () => {
    try {
      const rows = await db.manager_updates.list({
        orderBy: { column: "created_at", ascending: false },
        limit: 50,
      });
      // Filter out expired updates
      const now = new Date().toISOString();
      const active = (rows as unknown as ManagerUpdate[]).filter(
        (u) => !u.expires_at || u.expires_at > now,
      );
      setUpdates(active);
    } catch {
      // table may not exist yet — silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUpdates();
    const id = setInterval(fetchUpdates, 30_000); // poll every 30s
    return () => clearInterval(id);
  }, [fetchUpdates]);

  // Show for everyone — managers see "Post Update", agents see updates,
  // unauthenticated users see a sign-in prompt.
  if (!identity) {
    return (
      <Box
        mb="md"
        style={{
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid var(--widget-tile-border)",
          background: "var(--widget-tile-surface)",
        }}
      >
        <Group
          gap="xs"
          px="sm"
          py={6}
          style={{
            borderBottom: "1px solid var(--widget-tile-border)",
            background: "rgba(0, 96, 128, 0.06)",
          }}
        >
          <ThemeIcon size="xs" variant="transparent" color="appdirect">
            <IconBell size={14} />
          </ThemeIcon>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.06em" }}>
            Manager Updates
          </Text>
        </Group>
        <Box px="sm" py={8}>
          <Text size="xs" c="dimmed" ta="center">
            Sign in to see team updates.
          </Text>
        </Box>
      </Box>
    );
  }

  // Sort: pinned first, then by created_at desc
  const sorted = [...updates].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <>
      <Box
        mb="md"
        style={{
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid var(--widget-tile-border)",
          background: "var(--widget-tile-surface)",
          position: "relative",
        }}
      >
        {/* Header bar */}
        <Group
          gap="xs"
          px="sm"
          py={6}
          style={{
            borderBottom: "1px solid var(--widget-tile-border)",
            background: "rgba(0, 96, 128, 0.06)",
          }}
          justify="space-between"
          wrap="nowrap"
        >
          <Group gap={6} wrap="nowrap">
            <ThemeIcon size="xs" variant="transparent" color="appdirect">
              <IconBell size={14} />
            </ThemeIcon>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.06em" }}>
              Manager Updates
            </Text>
            {updates.length > 0 && (
              <Badge size="xs" variant="light" color="appdirect" radius="sm">
                {updates.length}
              </Badge>
            )}
          </Group>
          <Group gap={4} wrap="nowrap">
            {isManager && (
              <>
                <Tooltip label="Manage updates" withArrow>
                  <ActionIcon
                    variant="subtle"
                    size="xs"
                    color="gray"
                    onClick={() => setManageModalOpen(true)}
                  >
                    <IconBell size={12} />
                  </ActionIcon>
                </Tooltip>
                <Button
                  size="compact-xs"
                  variant="light"
                  color="appdirect"
                  leftSection={<IconPencilPlus size={12} />}
                  onClick={() => setPostModalOpen(true)}
                  styles={{ root: { fontWeight: 600, fontSize: 11 } }}
                >
                  Post Update
                </Button>
              </>
            )}
          </Group>
        </Group>

        {/* Static updates list */}
        {sorted.length > 0 ? (
          <Stack gap={0} style={{ padding: "6px 10px" }}>
            {sorted.map((u, idx) => {
              const cfg = PRIORITY_CONFIG[u.priority] || PRIORITY_CONFIG.info;
              const Icon = cfg.icon;
              return (
                <Group
                  key={`update-${u.id}-${idx}`}
                  gap={8}
                  wrap="nowrap"
                  py={5}
                  style={{
                    borderBottom: idx < sorted.length - 1
                      ? "1px solid var(--mantine-color-dark-5)"
                      : undefined,
                  }}
                >
                  {u.pinned && (
                    <IconPin
                      size={11}
                      style={{ color: "var(--mantine-color-appdirect-5)", flexShrink: 0 }}
                    />
                  )}
                  <Icon
                    size={13}
                    style={{ color: `var(--mantine-color-${cfg.color}-5)`, flexShrink: 0 }}
                  />
                  <Text
                    size="xs"
                    fw={u.priority === "urgent" ? 700 : 500}
                    c={u.priority === "urgent" ? "red" : undefined}
                    style={{ flex: 1 }}
                  >
                    {u.content}
                  </Text>
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
                    — {u.author_name}, {formatRelative(u.created_at)}
                  </Text>
                </Group>
              );
            })}
          </Stack>
        ) : (
          <Box px="sm" py={8}>
            <Text size="xs" c="dimmed" ta="center">
              {isManager
                ? "No updates yet — click 'Post Update' to share one with the team."
                : "No manager updates at this time."}
            </Text>
          </Box>
        )}
      </Box>

      {/* Post update modal */}
      <PostUpdateModal
        opened={postModalOpen}
        onClose={() => setPostModalOpen(false)}
        onPosted={fetchUpdates}
        authorName={identity?.name ?? ""}
        authorEmail={identity?.email}
      />

      {/* Manage updates modal */}
      <ManageUpdatesModal
        opened={manageModalOpen}
        onClose={() => setManageModalOpen(false)}
        updates={sorted}
        onRefresh={fetchUpdates}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                          Post Update Modal                                 */
/* -------------------------------------------------------------------------- */

function PostUpdateModal({
  opened,
  onClose,
  onPosted,
  authorName,
  authorEmail,
}: {
  opened: boolean;
  onClose: () => void;
  onPosted: () => void;
  authorName: string;
  authorEmail?: string;
}) {
  const [content, setContent] = useState("");
  const [priority, setPriority] = useState<Priority>("info");
  const [pinned, setPinned] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const text = content.trim();
    if (!text) return;
    setPosting(true);
    setError(null);
    try {
      await db.manager_updates.insert({
        author_name: authorName,
        author_email: authorEmail ?? null,
        content: text,
        priority,
        pinned,
        expires_at: null,
      } as Record<string, unknown>);
      setContent("");
      setPriority("info");
      setPinned(false);
      onPosted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post update");
    } finally {
      setPosting(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={8}>
          <ThemeIcon size="sm" radius="md" variant="light" color="appdirect">
            <IconPencilPlus size={14} />
          </ThemeIcon>
          <Text fw={600}>Post Team Update</Text>
        </Group>
      }
      size="md"
      centered
    >
      <Stack gap="md">
        <Textarea
          label="Update message"
          placeholder="e.g. Comcast maintenance window tonight 10pm–2am CST. Expect elevated ticket volume."
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          minRows={3}
          maxRows={6}
          autosize
          required
        />

        <Box>
          <Text size="xs" fw={600} mb={4}>
            Priority
          </Text>
          <SegmentedControl
            value={priority}
            onChange={(v) => setPriority(v as Priority)}
            data={[
              { label: "ℹ️ Info", value: "info" },
              { label: "⚠️ Warning", value: "warning" },
              { label: "🚨 Urgent", value: "urgent" },
              { label: "✅ Success", value: "success" },
            ]}
            fullWidth
            size="xs"
          />
        </Box>

        <Button
          variant={pinned ? "filled" : "light"}
          color={pinned ? "appdirect" : "gray"}
          size="compact-sm"
          leftSection={<IconPin size={14} />}
          onClick={() => setPinned(!pinned)}
          style={{ alignSelf: "flex-start" }}
        >
          {pinned ? "Pinned — will show first" : "Pin this update"}
        </Button>

        {error && (
          <Text size="xs" c="red">
            {error}
          </Text>
        )}

        <Group justify="flex-end" gap="sm">
          <Button variant="default" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            color="appdirect"
            size="sm"
            onClick={submit}
            loading={posting}
            disabled={!content.trim()}
            leftSection={<IconPencilPlus size={14} />}
          >
            Post Update
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*                        Manage Updates Modal                                */
/* -------------------------------------------------------------------------- */

function ManageUpdatesModal({
  opened,
  onClose,
  updates,
  onRefresh,
}: {
  opened: boolean;
  onClose: () => void;
  updates: ManagerUpdate[];
  onRefresh: () => void;
}) {
  const [deleting, setDeleting] = useState<number | null>(null);

  async function handleDelete(id: number) {
    setDeleting(id);
    try {
      await db.manager_updates.deleteById(id);
      onRefresh();
    } catch {
      // ignore
    } finally {
      setDeleting(null);
    }
  }

  async function togglePin(u: ManagerUpdate) {
    try {
      await db.manager_updates.updateById(u.id, { pinned: !u.pinned } as Record<string, unknown>);
      onRefresh();
    } catch {
      // ignore
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={8}>
          <ThemeIcon size="sm" radius="md" variant="light" color="appdirect">
            <IconBell size={14} />
          </ThemeIcon>
          <Text fw={600}>Manage Updates</Text>
        </Group>
      }
      size="lg"
      centered
    >
      <Stack gap="sm">
        {updates.length === 0 && (
          <Text size="sm" c="dimmed" ta="center" py="md">
            No updates to manage.
          </Text>
        )}
        {updates.map((u, idx) => {
          const cfg = PRIORITY_CONFIG[u.priority] || PRIORITY_CONFIG.info;
          return (
            <Box
              key={`manager-update-${u.id}-${idx}`}
              p="sm"
              style={{
                border: "1px solid var(--mantine-color-dark-4)",
                borderRadius: 10,
                background: "var(--mantine-color-dark-7)",
              }}
            >
              <Group justify="space-between" wrap="nowrap" gap="xs" mb={4}>
                <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                  <Badge size="xs" variant="light" color={cfg.color}>
                    {cfg.label}
                  </Badge>
                  {u.pinned && (
                    <Badge size="xs" variant="light" color="appdirect" leftSection={<IconPin size={8} />}>
                      Pinned
                    </Badge>
                  )}
                  <Text size="xs" c="dimmed">
                    {u.author_name} · {formatRelative(u.created_at)}
                  </Text>
                </Group>
                <Group gap={4} wrap="nowrap">
                  <Tooltip label={u.pinned ? "Unpin" : "Pin"} withArrow>
                    <ActionIcon
                      variant="subtle"
                      size="xs"
                      color={u.pinned ? "appdirect" : "gray"}
                      onClick={() => togglePin(u)}
                    >
                      <IconPin size={12} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Delete" withArrow>
                    <ActionIcon
                      variant="subtle"
                      size="xs"
                      color="red"
                      loading={deleting === u.id}
                      onClick={() => handleDelete(u.id)}
                    >
                      <IconTrash size={12} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
              <Text size="sm">{u.content}</Text>
            </Box>
          );
        })}
      </Stack>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*                               Helpers                                      */
/* -------------------------------------------------------------------------- */

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}
