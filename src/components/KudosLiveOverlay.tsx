import { useEffect, useRef, useState } from "react";
import { ActionIcon, Badge, Card, Group, Modal, Stack, Text } from "@mantine/core";
import { IconSparkles, IconX } from "@tabler/icons-react";

type KudosPayload = {
  id: number;
  from_name: string;
  to_name: string;
  message: string;
  category: string;
  created_at: string;
};

type KudosEventDetail = KudosPayload | KudosPayload[];

type KudosAnnouncement = {
  from_name: string;
  to_names: string[];
  message: string;
  category: string;
  created_at: string;
};

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  teamwork: { label: "Teamwork", color: "blue" },
  "problem-solving": { label: "Problem Solving", color: "violet" },
  "customer-service": { label: "Customer Service", color: "yellow" },
  "above-beyond": { label: "Above & Beyond", color: "orange" },
  mentorship: { label: "Mentorship", color: "teal" },
};

function categoryMeta(value: string) {
  return CATEGORY_META[value] ?? { label: value || "Kudos", color: "gray" };
}

export function KudosLiveOverlay() {
  const [kudos, setKudos] = useState<KudosAnnouncement | null>(null);
  const timerRef = useRef<number | null>(null);
  const queueRef = useRef<KudosAnnouncement[]>([]);
  const currentRef = useRef<KudosAnnouncement | null>(null);

  function clearTimer() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function showNext() {
    const next = queueRef.current.shift() ?? null;
    currentRef.current = next;
    setKudos(next);
    if (!next) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      showNext();
    }, 25_000);
  }

  function dismissCurrent() {
    clearTimer();
    currentRef.current = null;
    setKudos(null);
    showNext();
  }

  useEffect(() => {
    function handlePosted(event: Event) {
      const detail = (event as CustomEvent<KudosEventDetail>).detail;
      const items = Array.isArray(detail)
        ? detail.filter(Boolean)
        : detail
          ? [detail]
          : [];
      if (items.length === 0) return;

      const first = items[0];
      queueRef.current.push({
        from_name: first.from_name,
        to_names: items.map((item) => item.to_name),
        message: first.message,
        category: first.category,
        created_at: first.created_at,
      });

      if (!currentRef.current && !timerRef.current) {
        showNext();
      }
    }

    window.addEventListener("kudos:posted", handlePosted as EventListener);
    return () => {
      clearTimer();
      queueRef.current = [];
      currentRef.current = null;
      window.removeEventListener("kudos:posted", handlePosted as EventListener);
    };
  }, []);

  const meta = categoryMeta(kudos?.category ?? "");
  const recipientLabel = (kudos?.to_names.length ?? 0) > 1 ? "Recipients" : "Recipient";
  const recipientText = kudos?.to_names.join(", ") ?? "";

  return (
    <Modal
      opened={Boolean(kudos)}
      onClose={dismissCurrent}
      withCloseButton={false}
      centered
      radius="xl"
      padding={0}
      overlayProps={{ backgroundOpacity: 0.35, blur: 2 }}
      styles={{
        content: { overflow: "hidden" },
        body: { padding: 0 },
      }}
    >
      {kudos ? (
        <Card p="xl" radius="xl" style={{ border: "1px solid rgba(255, 215, 87, 0.24)" }}>
          <Stack gap="lg">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Group gap="sm" align="center" wrap="nowrap">
                <IconSparkles size={22} color="var(--mantine-color-yellow-4)" />
                <Stack gap={2}>
                  <Text fw={800} size="lg">Kudos details</Text>
                  <Text size="sm" c="dimmed">Live recognition will stay on screen for 25 seconds.</Text>
                </Stack>
              </Group>
              <ActionIcon variant="subtle" color="gray" onClick={dismissCurrent}>
                <IconX size={16} />
              </ActionIcon>
            </Group>

            <Group justify="space-between" align="flex-start">
              <Stack gap={4} style={{ flex: 1 }}>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">{recipientLabel}</Text>
                <Text fw={900} size="2rem" c="yellow.4">{recipientText}</Text>
              </Stack>
              <Badge color={meta.color} variant="light" size="lg">{meta.label}</Badge>
            </Group>

            <Group gap="xl">
              <Stack gap={2}>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">From</Text>
                <Text fw={700}>{kudos.from_name}</Text>
              </Stack>
              <Stack gap={2}>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">Submitted</Text>
                <Text fw={700}>{new Date(kudos.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</Text>
              </Stack>
            </Group>

            <Card radius="lg" p="lg" style={{ border: "1px solid rgba(255, 215, 87, 0.18)", background: "rgba(255, 215, 87, 0.06)" }}>
              <Stack gap="xs">
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">Full message</Text>
                <Text size="lg" style={{ whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{kudos.message}</Text>
              </Stack>
            </Card>
          </Stack>
        </Card>
      ) : null}
    </Modal>
  );
}
