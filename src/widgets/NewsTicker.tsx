import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Portal,
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
  IconConfetti,
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

interface KudosAnnouncement {
  id: number;
  from_name: string;
  to_name: string;
  message: string;
  category: string;
  is_pinned: boolean;
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

const CELEBRATION_DURATION_MS = 25_000;
const DAILY_KUDOS_CELEBRATION_STORAGE_KEY = "devsai:kudos-celebration-shown-by-day";
const CONFETTI_PARTICLES = Array.from({ length: 24 }, (_, index) => ({
  id: index,
  left: `${4 + ((index * 97) % 92)}%`,
  delay: `${(index % 8) * 0.22}s`,
  duration: `${4.8 + (index % 6) * 0.55}s`,
  rotate: `${((index * 37) % 120) - 60}deg`,
  color: ["#ffd43b", "#ff8787", "#74c0fc", "#69db7c", "#b197fc", "#ffa94d"][index % 6],
  shape: index % 3 === 0 ? "18px" : index % 3 === 1 ? "12px" : "10px",
}));

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function isSameDayKudos(createdAt: string) {
  return createdAt.slice(0, 10) === getTodayKey();
}

function shouldCelebrateToday(kudos: KudosAnnouncement) {
  return kudos.is_pinned || isSameDayKudos(kudos.created_at);
}

function getShownCelebrationIdsForToday() {
  if (typeof window === "undefined") return [] as number[];
  try {
    const raw = window.localStorage.getItem(DAILY_KUDOS_CELEBRATION_STORAGE_KEY);
    if (!raw) return [] as number[];
    const parsed = JSON.parse(raw) as Record<string, number[]>;
    return Array.isArray(parsed?.[getTodayKey()]) ? parsed[getTodayKey()] : [];
  } catch {
    return [] as number[];
  }
}

function markCelebrationShownForToday(id: number) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(DAILY_KUDOS_CELEBRATION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, number[]> : {};
    const todayKey = getTodayKey();
    const current = Array.isArray(parsed[todayKey]) ? parsed[todayKey] : [];
    parsed[todayKey] = Array.from(new Set([...current, id]));
    window.localStorage.setItem(DAILY_KUDOS_CELEBRATION_STORAGE_KEY, JSON.stringify({
      [todayKey]: parsed[todayKey],
    }));
  } catch {
    // ignore storage failures
  }
}

/* -------------------------------------------------------------------------- */
/*                           Scrolling Ticker                                 */
/* -------------------------------------------------------------------------- */

export function NewsTicker() {
  const { identity } = useIdentity();
  const [updates, setUpdates] = useState<ManagerUpdate[]>([]);
  const [recentKudos, setRecentKudos] = useState<KudosAnnouncement[]>([]);
  const [_loading, setLoading] = useState(true);
  const [postModalOpen, setPostModalOpen] = useState(false);
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [allUpdatesOpen, setAllUpdatesOpen] = useState(false);
  const [celebrationKudos, setCelebrationKudos] = useState<KudosAnnouncement | null>(null);
  const [featuredKudos, setFeaturedKudos] = useState<KudosAnnouncement | null>(null);
  const [selectedKudos, setSelectedKudos] = useState<KudosAnnouncement | null>(null);
  const [selectedUpdate, setSelectedUpdate] = useState<ManagerUpdate | null>(null);
  const tickerRef = useRef<HTMLDivElement>(null);
  const celebrationTimeoutRef = useRef<number | null>(null);
  const celebrationQueueRef = useRef<KudosAnnouncement[]>([]);
  const activeCelebrationIdRef = useRef<number | null>(null);
  const lastSeenKudosIdsRef = useRef<number[]>([]);
  void tickerRef; // kept to avoid removing the import

  const isManager = isManagerRole(identity?.role);

  const playNextCelebration = useCallback(() => {
    if (activeCelebrationIdRef.current != null) return;
    const next = celebrationQueueRef.current.shift();
    if (!next) return;

    activeCelebrationIdRef.current = next.id;
    setFeaturedKudos(next);
    setCelebrationKudos(next);
    markCelebrationShownForToday(next.id);

    if (celebrationTimeoutRef.current) {
      window.clearTimeout(celebrationTimeoutRef.current);
    }
    celebrationTimeoutRef.current = window.setTimeout(() => {
      setCelebrationKudos(null);
      celebrationTimeoutRef.current = null;
      activeCelebrationIdRef.current = null;
      window.setTimeout(() => {
        playNextCelebration();
      }, 450);
    }, CELEBRATION_DURATION_MS);
  }, []);

  const enqueueCelebrations = useCallback((kudosItems: KudosAnnouncement[]) => {
    const knownIds = new Set([
      ...celebrationQueueRef.current.map((item) => item.id),
      ...(activeCelebrationIdRef.current != null ? [activeCelebrationIdRef.current] : []),
    ]);

    kudosItems.forEach((item) => {
      if (!knownIds.has(item.id)) {
        celebrationQueueRef.current.push(item);
        knownIds.add(item.id);
      }
    });

    playNextCelebration();
  }, [playNextCelebration]);

  const fetchFeed = useCallback(async () => {
    try {
      const [managerRows, kudosRows] = await Promise.all([
        db.manager_updates.list({
          orderBy: { column: "created_at", ascending: false },
          limit: 50,
        }),
        db.kudos.list({
          orderBy: { column: "created_at", ascending: false },
          limit: 12,
        }),
      ]);

      const now = new Date().toISOString();
      const active = (managerRows as unknown as ManagerUpdate[]).filter(
        (u) => !u.expires_at || u.expires_at > now,
      );
      setUpdates(active);

      const latestKudosRows = (kudosRows as unknown as KudosAnnouncement[]).filter(
        (k) => !!k && !!k.to_name && !!k.from_name && !!k.message,
      );
      setRecentKudos(latestKudosRows);

      const latestCelebrationCandidate = latestKudosRows.find((k) => shouldCelebrateToday(k)) ?? latestKudosRows[0] ?? null;
      setFeaturedKudos(latestCelebrationCandidate);

      const todayShownIds = new Set(getShownCelebrationIdsForToday());
      const currentVisibleIds = new Set(lastSeenKudosIdsRef.current);
      const todaysUnshownKudos = [...latestKudosRows]
        .filter((k) => shouldCelebrateToday(k))
        .filter((k) => !todayShownIds.has(k.id))
        .filter((k) => !currentVisibleIds.has(k.id))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      if (todaysUnshownKudos.length > 0) {
        enqueueCelebrations(todaysUnshownKudos);
      }

      lastSeenKudosIdsRef.current = latestKudosRows.map((item) => item.id);
    } catch {
      // table may not exist yet — silently ignore
    } finally {
      setLoading(false);
    }
  }, [enqueueCelebrations]);

  useEffect(() => {
    fetchFeed();
    const id = setInterval(fetchFeed, 15_000);
    const handleKudosPosted = (event: Event) => {
      const customEvent = event as CustomEvent<KudosAnnouncement | undefined>;
      if (customEvent.detail) {
        setFeaturedKudos(customEvent.detail);
        if (shouldCelebrateToday(customEvent.detail)) {
          enqueueCelebrations([customEvent.detail]);
        }
      }
      void fetchFeed();
    };
    window.addEventListener("kudos:posted", handleKudosPosted as EventListener);
    return () => {
      clearInterval(id);
      if (celebrationTimeoutRef.current) {
        window.clearTimeout(celebrationTimeoutRef.current);
      }
      window.removeEventListener("kudos:posted", handleKudosPosted as EventListener);
    };
  }, [enqueueCelebrations, fetchFeed]);

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

  const kudosTickerItems = recentKudos.map((k) => {
    const shortMessage = k.message.length > 90 ? `${k.message.slice(0, 90).trim()}…` : k.message;
    return `🎉 HUGE CONGRATS 🎉 ${k.to_name} got kudos from ${k.from_name} — ${shortMessage} 🥳 🌟 🙌 💛`;
  });
  const visibleUpdates = sorted.slice(0, 2);

  return (
    <>
      <style>{`
        @keyframes kudos-marquee-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes kudos-emoji-float {
          0%, 100% { transform: translateY(0px) scale(1); opacity: 0.55; }
          50% { transform: translateY(-10px) scale(1.15); opacity: 1; }
        }
        @keyframes kudos-banner-glow {
          0%, 100% { box-shadow: 0 0 0 rgba(255, 193, 7, 0.15); }
          50% { box-shadow: 0 0 28px rgba(255, 193, 7, 0.22); }
        }
        @keyframes kudos-overlay-fade {
          0% { opacity: 0; transform: scale(0.96); }
          10% { opacity: 1; transform: scale(1); }
          88% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.02); }
        }
        @keyframes kudos-confetti-fall {
          0% { transform: translate3d(0, -12vh, 0) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translate3d(0, 110vh, 0) rotate(720deg); opacity: 0; }
        }
        @keyframes kudos-title-pulse {
          0%, 100% { text-shadow: 0 0 16px rgba(255, 212, 59, 0.35), 0 0 36px rgba(255, 111, 97, 0.18); }
          50% { text-shadow: 0 0 24px rgba(255, 212, 59, 0.72), 0 0 48px rgba(255, 111, 97, 0.38); }
        }
      `}</style>

      {celebrationKudos && (
        <Portal>
          <Box
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 10000,
              pointerEvents: "none",
              background: "radial-gradient(circle at 50% 25%, rgba(255, 212, 59, 0.2), rgba(10, 16, 28, 0.86) 45%, rgba(6, 10, 20, 0.94) 100%)",
              backdropFilter: "blur(5px)",
              animation: "kudos-overlay-fade 25s ease forwards",
              overflow: "hidden",
            }}
          >
            {CONFETTI_PARTICLES.map((particle) => (
              <Box
                key={`confetti-${particle.id}`}
                style={{
                  position: "absolute",
                  top: "-10vh",
                  left: particle.left,
                  width: particle.shape,
                  height: `calc(${particle.shape} * 1.8)`,
                  borderRadius: 999,
                  background: particle.color,
                  boxShadow: `0 0 14px ${particle.color}`,
                  opacity: 0.95,
                  transform: `rotate(${particle.rotate})`,
                  animation: `kudos-confetti-fall ${particle.duration} linear ${particle.delay} infinite`,
                }}
              />
            ))}

            <Box
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "32px",
              }}
            >
              <Stack align="center" gap="md" style={{ maxWidth: 980, textAlign: "center" }}>
                <Badge size="lg" radius="xl" color="yellow" variant="filled">
                  🎉 LATEST KUDOS CELEBRATION 🎉
                </Badge>
                <Text size="clamp(2.4rem, 6vw, 5.6rem)" fw={900} c="yellow.2" style={{ letterSpacing: "0.02em", animation: "kudos-title-pulse 1.8s ease-in-out infinite" }}>
                  {celebrationKudos.to_name}
                </Text>
                <Text size="xl" fw={800} c="white">
                  Congratulations! Recognized by {celebrationKudos.from_name} 🥳✨🙌
                </Text>
                <Text
                  size="lg"
                  c="gray.2"
                  maw={900}
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255, 212, 59, 0.18)",
                    borderRadius: 20,
                    padding: "18px 24px",
                    boxShadow: "0 18px 42px rgba(0,0,0,0.28)",
                  }}
                >
                  “{celebrationKudos.message}”
                </Text>
                <Group gap="xs" justify="center">
                  <Text size="xl">🎊</Text>
                  <Text size="xl">🌟</Text>
                  <Text size="xl">💛</Text>
                  <Text size="xl">🚀</Text>
                  <Text size="xl">👏</Text>
                  <Text size="xl">🎉</Text>
                </Group>
                <Text size="sm" c="dimmed">
                  This fades automatically in about 25 seconds and the latest kudos stays visible in the banner below.
                </Text>
              </Stack>
            </Box>
          </Box>
        </Portal>
      )}

      {kudosTickerItems.length > 0 && (
        <Box
          mb={6}
          style={{
            borderRadius: 14,
            overflow: "hidden",
            border: "1px solid rgba(255, 212, 59, 0.35)",
            background: "linear-gradient(90deg, rgba(255, 193, 7, 0.16), rgba(255, 111, 97, 0.16), rgba(151, 117, 250, 0.16))",
            position: "relative",
            animation: "kudos-banner-glow 2.8s ease-in-out infinite",
          }}
        >
          <Box
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.12), transparent 28%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.14), transparent 30%)",
            }}
          />
          <Group
            justify="space-between"
            wrap="nowrap"
            px="sm"
            py={8}
            style={{
              borderBottom: "1px solid rgba(255, 212, 59, 0.22)",
              background: "rgba(10, 16, 28, 0.18)",
              position: "relative",
            }}
          >
            <Group gap={8} wrap="nowrap">
              <ThemeIcon size="sm" radius="xl" color="yellow" variant="filled">
                <IconConfetti size={15} />
              </ThemeIcon>
              <Text size="xs" fw={800} tt="uppercase" style={{ letterSpacing: "0.08em" }}>
                Last Submitted Kudos
              </Text>
              <Badge color="yellow" variant="filled" radius="sm" size="xs">
                {recentKudos.length}
              </Badge>
            </Group>
            <Group gap="xs" wrap="nowrap">
              <Text size="xs" fw={700} c="yellow.2">
                {featuredKudos ? `🎊 ${featuredKudos.to_name} was recognized by ${featuredKudos.from_name} 🎊` : "🎊 Congratulations team! 🎊"}
              </Text>
              {featuredKudos && (
                <Button
                  size="compact-xs"
                  variant="white"
                  color="dark"
                  onClick={() => setSelectedKudos(featuredKudos)}
                  styles={{ root: { fontWeight: 700 } }}
                >
                  View full kudos
                </Button>
              )}
            </Group>
          </Group>

          <Box
            px="sm"
            py={3}
            style={{
              position: "relative",
              overflow: "hidden",
              cursor: featuredKudos ? "pointer" : "default",
            }}
            onClick={() => featuredKudos && setSelectedKudos(featuredKudos)}
          >
            <Text
              size="sm"
              style={{
                position: "absolute",
                left: 8,
                top: 0,
                animation: "kudos-emoji-float 2.4s ease-in-out infinite",
              }}
            >
              🥳
            </Text>
            <Text
              size="sm"
              style={{
                position: "absolute",
                right: 14,
                top: 1,
                animation: "kudos-emoji-float 2.1s ease-in-out infinite 0.3s",
              }}
            >
              🎉
            </Text>
            <Text
              size="sm"
              style={{
                position: "absolute",
                right: 58,
                bottom: 0,
                animation: "kudos-emoji-float 2.8s ease-in-out infinite 0.6s",
              }}
            >
              🌟
            </Text>
            <Text
              size="sm"
              style={{
                position: "absolute",
                left: 52,
                bottom: -1,
                animation: "kudos-emoji-float 2.5s ease-in-out infinite 0.9s",
              }}
            >
              🙌
            </Text>

            <Box style={{ overflow: "hidden", whiteSpace: "nowrap" }}>
              <Box
                style={{
                  display: "inline-flex",
                  minWidth: "max-content",
                  animation: `kudos-marquee-scroll ${Math.max(18, kudosTickerItems.length * 8)}s linear infinite`,
                }}
              >
                {[...kudosTickerItems, ...kudosTickerItems].map((item, index) => (
                  <Text
                    key={`${index}-${item}`}
                    size="xs"
                    fw={700}
                    c="yellow.0"
                    mr={36}
                    style={{ textShadow: "0 1px 10px rgba(255, 212, 59, 0.2)", lineHeight: 1.15 }}
                  >
                    {item}
                  </Text>
                ))}
              </Box>
            </Box>
          </Box>
        </Box>
      )}

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
          <Group gap={6} wrap="nowrap">
            {sorted.length > 2 && (
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={() => setAllUpdatesOpen(true)}
                styles={{ root: { fontWeight: 700 } }}
              >
                View all updates
              </Button>
            )}
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
            {visibleUpdates.map((u, idx) => {
              const cfg = PRIORITY_CONFIG[u.priority] || PRIORITY_CONFIG.info;
              const Icon = cfg.icon;
              return (
                <Group
                  key={["update-", u.id, "-", idx].join("")}
                  gap={8}
                  wrap="nowrap"
                  py={5}
                  onClick={() => setSelectedUpdate(u)}
                  style={{
                    borderBottom: idx < visibleUpdates.length - 1
                      ? "1px solid var(--mantine-color-dark-5)"
                      : undefined,
                    cursor: "pointer",
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
                  <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
                    <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                      — {u.author_name}, {formatRelative(u.created_at)}
                    </Text>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="gray"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedUpdate(u);
                      }}
                    >
                      View full update
                    </Button>
                  </Group>
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

      <Modal
        opened={!!selectedKudos}
        onClose={() => setSelectedKudos(null)}
        title={
          <Group gap={8}>
            <ThemeIcon size="sm" radius="md" color="yellow" variant="light">
              <IconConfetti size={14} />
            </ThemeIcon>
            <Text fw={700}>Kudos details</Text>
          </Group>
        }
        centered
        size="lg"
      >
        {selectedKudos && (
          <Stack gap="md">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Stack gap={2}>
                <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: "0.08em" }}>
                  Recipient
                </Text>
                <Text size="xl" fw={900} c="yellow.5">
                  {selectedKudos.to_name}
                </Text>
              </Stack>
              <Badge color="yellow" variant="light" radius="sm">
                {selectedKudos.category}
              </Badge>
            </Group>

            <Group gap="xl" wrap="wrap">
              <Box>
                <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: "0.08em" }}>
                  From
                </Text>
                <Text size="sm" fw={700}>{selectedKudos.from_name}</Text>
              </Box>
              <Box>
                <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: "0.08em" }}>
                  Submitted
                </Text>
                <Text size="sm" fw={700}>{formatRelative(selectedKudos.created_at)}</Text>
              </Box>
            </Group>

            <Box
              p="lg"
              style={{
                borderRadius: 16,
                border: "1px solid rgba(255, 212, 59, 0.2)",
                background: "rgba(255, 212, 59, 0.06)",
              }}
            >
              <Text size="xs" tt="uppercase" fw={700} c="dimmed" mb="sm" style={{ letterSpacing: "0.08em" }}>
                Full message
              </Text>
              <Text size="md" style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
                {selectedKudos.message}
              </Text>
            </Box>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={allUpdatesOpen}
        onClose={() => setAllUpdatesOpen(false)}
        title={
          <Group gap={8}>
            <ThemeIcon size="sm" radius="md" color="appdirect" variant="light">
              <IconBell size={14} />
            </ThemeIcon>
            <Text fw={700}>All manager updates</Text>
          </Group>
        }
        centered
        size="xl"
      >
        <Stack gap={0}>
          {sorted.map((u, idx) => {
            const cfg = PRIORITY_CONFIG[u.priority] || PRIORITY_CONFIG.info;
            const Icon = cfg.icon;
            return (
              <Group
                key={["all-update-", u.id, "-", idx].join("")}
                gap={8}
                wrap="nowrap"
                py="sm"
                onClick={() => {
                  setAllUpdatesOpen(false);
                  setSelectedUpdate(u);
                }}
                style={{
                  borderBottom: idx < sorted.length - 1
                    ? "1px solid var(--mantine-color-dark-5)"
                    : undefined,
                  cursor: "pointer",
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
                  size="sm"
                  fw={u.priority === "urgent" ? 700 : 500}
                  c={u.priority === "urgent" ? "red" : undefined}
                  style={{ flex: 1 }}
                >
                  {u.content}
                </Text>
                <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
                  <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                    — {u.author_name}, {formatRelative(u.created_at)}
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    onClick={(event) => {
                      event.stopPropagation();
                      setAllUpdatesOpen(false);
                      setSelectedUpdate(u);
                    }}
                  >
                    View full update
                  </Button>
                </Group>
              </Group>
            );
          })}
        </Stack>
      </Modal>

      <Modal
        opened={!!selectedUpdate}
        onClose={() => setSelectedUpdate(null)}
        title={
          <Group gap={8}>
            <ThemeIcon size="sm" radius="md" color="appdirect" variant="light">
              <IconBell size={14} />
            </ThemeIcon>
            <Text fw={700}>Manager update details</Text>
          </Group>
        }
        centered
        size="lg"
      >
        {selectedUpdate && (
          <Stack gap="md">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Stack gap={2}>
                <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: "0.08em" }}>
                  Author
                </Text>
                <Text size="xl" fw={800}>
                  {selectedUpdate.author_name}
                </Text>
              </Stack>
              <Group gap="xs">
                <Badge color={PRIORITY_CONFIG[selectedUpdate.priority]?.color ?? "gray"} variant="light" radius="sm">
                  {PRIORITY_CONFIG[selectedUpdate.priority]?.label ?? selectedUpdate.priority}
                </Badge>
                {selectedUpdate.pinned ? (
                  <Badge color="appdirect" variant="light" radius="sm">
                    Pinned
                  </Badge>
                ) : null}
              </Group>
            </Group>

            <Group gap="xl" wrap="wrap">
              <Box>
                <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: "0.08em" }}>
                  Posted
                </Text>
                <Text size="sm" fw={700}>{formatRelative(selectedUpdate.created_at)}</Text>
              </Box>
              {selectedUpdate.author_email ? (
                <Box>
                  <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: "0.08em" }}>
                    Contact
                  </Text>
                  <Text size="sm" fw={700}>{selectedUpdate.author_email}</Text>
                </Box>
              ) : null}
            </Group>

            <Box
              p="lg"
              style={{
                borderRadius: 16,
                border: "1px solid var(--widget-tile-border)",
                background: "rgba(0, 96, 128, 0.05)",
              }}
            >
              <Text size="xs" tt="uppercase" fw={700} c="dimmed" mb="sm" style={{ letterSpacing: "0.08em" }}>
                Full update
              </Text>
              <Text size="md" style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
                {selectedUpdate.content}
              </Text>
            </Box>
          </Stack>
        )}
      </Modal>

      {/* Post update modal */}
      <PostUpdateModal
        opened={postModalOpen}
        onClose={() => setPostModalOpen(false)}
        onPosted={fetchFeed}
        authorName={identity?.name ?? ""}
        authorEmail={identity?.email}
      />

      {/* Manage updates modal */}
      <ManageUpdatesModal
        opened={manageModalOpen}
        onClose={() => setManageModalOpen(false)}
        updates={sorted}
        onRefresh={fetchFeed}
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
              key={["manager-update-", u.id, "-", idx].join("")}
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
