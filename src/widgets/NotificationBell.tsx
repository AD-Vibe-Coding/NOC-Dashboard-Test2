/**
 * NotificationBell — manager-only header component.
 *
 * Polls /api/notifications every 30 s. Shows a red badge with the count of
 * unread notifications. Click to open a popover listing all pending items.
 * Read state is persisted to localStorage so dismissed items stay dismissed
 * across page reloads, until they are resolved (status changes from pending).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Indicator,
  Popover,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconBell,
  IconCalendarEvent,
  IconChartBar,
  IconCheck,
} from "@tabler/icons-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  type: "wfh" | "dispute";
  title: string;
  body: string;
  created_at: string;
  widget_id: string;
}

// ── localStorage helpers ──────────────────────────────────────────────────────

const LS_KEY = "noc_read_notifications";

function getReadSet(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {}
  return new Set();
}

function saveReadSet(ids: Set<string>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...ids]));
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onNavigate: (widgetId: string) => void;
}

export function NotificationBell({ onNavigate }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(getReadSet);
  const [opened, setOpened] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications");
      if (!r.ok) return;
      const j = await r.json();
      setNotifications(j.notifications ?? []);
    } catch {
      // silent — non-critical
    }
  }, []);

  // Initial load + 30 s polling
  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [load]);

  // Remove read IDs that are no longer in the live notifications list
  // (i.e. they were resolved). This keeps localStorage from growing forever.
  useEffect(() => {
    const liveIds = new Set(notifications.map((n) => n.id));
    setReadIds((prev) => {
      const pruned = new Set([...prev].filter((id) => liveIds.has(id)));
      if (pruned.size !== prev.size) saveReadSet(pruned);
      return pruned;
    });
  }, [notifications]);

  const unread = notifications.filter((n) => !readIds.has(n.id));

  function markRead(id: string) {
    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveReadSet(next);
      return next;
    });
  }

  function markAllRead() {
    const all = new Set(notifications.map((n) => n.id));
    setReadIds(all);
    saveReadSet(all);
  }

  function handleClick(n: Notification) {
    markRead(n.id);
    setOpened(false);
    onNavigate(n.widget_id);
  }

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      offset={8}
      shadow="lg"
      radius="lg"
      width={360}
      withinPortal
    >
      <Popover.Target>
        <Tooltip label="Notifications" withArrow>
          <Indicator
            inline
            label={unread.length > 0 ? String(unread.length) : undefined}
            color="red"
            size={16}
            disabled={unread.length === 0}
            processing={unread.length > 0}
            styles={{ indicator: { fontSize: 10, fontWeight: 700 } }}
          >
            <ActionIcon
              variant="default"
              size="lg"
              radius="md"
              onClick={() => setOpened((o) => !o)}
              aria-label="Notifications"
            >
              <IconBell size={18} />
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown p={0} style={{ overflow: "hidden" }}>
        {/* Header */}
        <Group justify="space-between" px="md" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
          <Group gap="xs">
            <ThemeIcon size="sm" variant="light" color="appdirect" radius="md">
              <IconBell size={13} />
            </ThemeIcon>
            <Text fw={600} size="sm">Notifications</Text>
            {unread.length > 0 && (
              <Badge size="xs" color="red" variant="filled" circle>
                {unread.length}
              </Badge>
            )}
          </Group>
          {unread.length > 0 && (
            <Button
              size="compact-xs"
              variant="subtle"
              color="dimmed"
              leftSection={<IconCheck size={11} />}
              onClick={markAllRead}
            >
              Mark all read
            </Button>
          )}
        </Group>

        {/* List */}
        {notifications.length === 0 ? (
          <Box px="md" py="xl" ta="center">
            <ThemeIcon size="xl" variant="light" color="teal" radius="xl" mx="auto" mb="sm">
              <IconCheck size={20} />
            </ThemeIcon>
            <Text size="sm" c="dimmed">All caught up — no pending items</Text>
          </Box>
        ) : (
          <ScrollArea.Autosize mah={420}>
            <Stack gap={0}>
              {notifications.map((n, i) => {
                const isUnread = !readIds.has(n.id);
                const Icon = n.type === "wfh" ? IconCalendarEvent : IconChartBar;
                const color = n.type === "wfh" ? "cyan" : "orange";
                return (
                  <Box key={n.id}>
                    {i > 0 && <Divider />}
                    <Box
                      px="md"
                      py="sm"
                      onClick={() => handleClick(n)}
                      style={{
                        cursor: "pointer",
                        background: isUnread
                          ? "var(--mantine-color-dark-6)"
                          : "transparent",
                        transition: "background 150ms",
                        position: "relative",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          "var(--mantine-color-dark-5)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          isUnread ? "var(--mantine-color-dark-6)" : "transparent";
                      }}
                    >
                      <Group gap="sm" wrap="nowrap" align="flex-start">
                        {/* Unread dot */}
                        <Box
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: isUnread
                              ? "var(--mantine-color-red-5)"
                              : "transparent",
                            flexShrink: 0,
                            marginTop: 6,
                          }}
                        />
                        <ThemeIcon size="sm" variant="light" color={color} radius="md" style={{ flexShrink: 0, marginTop: 2 }}>
                          <Icon size={12} />
                        </ThemeIcon>
                        <Box style={{ minWidth: 0, flex: 1 }}>
                          <Group justify="space-between" gap="xs" wrap="nowrap">
                            <Text size="xs" fw={isUnread ? 700 : 500} truncate>
                              {n.title}
                            </Text>
                            <Text size="xs" c="dimmed" style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
                              {timeAgo(n.created_at)}
                            </Text>
                          </Group>
                          <Text size="xs" c="dimmed" mt={2} lineClamp={2}>
                            {n.body}
                          </Text>
                          <Text size="xs" c={color} mt={3}>
                            {n.type === "wfh" ? "Open WFH Requests →" : "Open Performance Tracker →"}
                          </Text>
                        </Box>
                      </Group>
                    </Box>
                  </Box>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        )}

        {/* Footer */}
        {notifications.length > 0 && (
          <Box px="md" py="xs" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
            <Text size="xs" c="dimmed" ta="center">
              {notifications.length} pending item{notifications.length !== 1 ? "s" : ""} · auto-refreshes every 30s
            </Text>
          </Box>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
