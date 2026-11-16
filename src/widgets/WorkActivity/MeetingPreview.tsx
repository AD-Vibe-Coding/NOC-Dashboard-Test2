import { useEffect, useState } from "react";
import { Badge, Box, Button, Card, Group, ScrollArea, Skeleton, Stack, Text } from "@mantine/core";
import { IconExternalLink } from "@tabler/icons-react";

type Meeting = {
  id: string;
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  joinLink?: string | null;
  htmlLink?: string;
  colorId?: string;
};

type CalendarResponse = {
  connected: boolean;
  events: Meeting[];
  error?: string;
};

const EVENT_COLORS: Record<string, string> = {
  "1": "blue", "2": "teal", "3": "gray", "4": "red", "5": "yellow", "6": "orange",
  "7": "cyan", "8": "dark", "9": "blue", "10": "green", "11": "violet",
};

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isToday(meeting: Meeting) {
  if (meeting.start?.date && !meeting.start.dateTime) return meeting.start.date === localDateKey(new Date());
  return !!meeting.start?.dateTime && new Date(meeting.start.dateTime).toDateString() === new Date().toDateString();
}

function meetingTime(meeting: Meeting) {
  if (!meeting.start?.dateTime) return "All day";
  const start = new Date(meeting.start.dateTime);
  const end = meeting.end?.dateTime ? new Date(meeting.end.dateTime) : null;
  const format = (date: Date) => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return end ? `${format(start)} – ${format(end)}` : format(start);
}

function hasEnded(meeting: Meeting) {
  if (meeting.start?.date && !meeting.start.dateTime) return false;
  return !!meeting.end?.dateTime && new Date(meeting.end.dateTime).getTime() < Date.now();
}

function getState(meeting: Meeting) {
  const now = Date.now();
  const start = meeting.start?.dateTime ? new Date(meeting.start.dateTime).getTime() : null;
  const end = meeting.end?.dateTime ? new Date(meeting.end.dateTime).getTime() : null;
  if (start !== null && end !== null && now >= start && now <= end) return { label: "NOW", color: "green" };
  if (start !== null && start > now && start - now <= 30 * 60 * 1000) return { label: "SOON", color: "yellow" };
  return { label: "LATER", color: "blue" };
}

export function MeetingPreview() {
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/calendar/events", { credentials: "include" });
        if (!response.ok) throw new Error(`Calendar request failed (${response.status})`);
        const result = await response.json() as CalendarResponse;
        if (active) setCalendar(result);
      } catch {
        if (active) setCalendar({ connected: false, events: [], error: "Calendar unavailable" });
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const meetings = (calendar?.events ?? [])
    .filter((meeting) => meeting.status !== "cancelled" && isToday(meeting) && !hasEnded(meeting))
    .sort((a, b) => new Date(a.start?.dateTime ?? a.start?.date ?? 0).getTime() - new Date(b.start?.dateTime ?? b.start?.date ?? 0).getTime());

  return (
    <Stack gap={4} mt="sm" aria-label="Today's meetings">
      <Group justify="space-between" align="center" gap={4}>
        <Text size="xs" fw={700} style={{ lineHeight: 1.05 }}>Today’s meetings</Text>
        {calendar?.connected && !loading && <Badge size="xs" variant="light" color="appdirect">{meetings.length}</Badge>}
      </Group>
      {loading ? (
        <Stack gap={5}>
          <Skeleton height={38} radius="md" />
          <Skeleton height={38} radius="md" />
        </Stack>
      ) : !calendar?.connected ? (
        <Text size="xs" c="dimmed" title={calendar?.error ?? "Connect Google Calendar to see meetings"}>
          {calendar?.error ?? "Connect Google Calendar to see meetings"}
        </Text>
      ) : meetings.length === 0 ? (
        <Text size="xs" c="dimmed">No meetings scheduled for today.</Text>
      ) : (
        <ScrollArea.Autosize mah={356} offsetScrollbars type="auto">
          <Stack gap={4} pr={4}>
            {meetings.map((meeting) => {
              const state = getState(meeting);
              const eventColor = EVENT_COLORS[meeting.colorId ?? ""] ?? "appdirect";
              const borderColor = state.label === "NOW" || state.label === "SOON" ? state.color : eventColor;
              const joinUrl = meeting.joinLink ?? meeting.htmlLink;
              return (
                <Card
                  key={meeting.id}
                  withBorder
                  radius="md"
                  p={6}
                  style={{ borderLeft: `3px solid var(--mantine-color-${borderColor}-6)` }}
                >
                  <Group justify="space-between" wrap="nowrap" gap={6} align="flex-start">
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Group gap={4} wrap="nowrap" align="flex-start">
                        <Badge size="xs" px={5} color={state.color} variant={state.label === "NOW" ? "filled" : "light"}>
                          {state.label}
                        </Badge>
                        <Text size="xs" fw={state.label === "NOW" ? 700 : 500} lineClamp={2} style={{ lineHeight: 1.1 }}>
                          {meeting.summary || "Untitled meeting"}
                        </Text>
                      </Group>
                      <Text size="10px" c="dimmed" ff="monospace" mt={2} style={{ lineHeight: 1.05 }}>
                        {meetingTime(meeting)}
                      </Text>
                    </Box>
                    {joinUrl && (
                      <Button
                        component="a"
                        href={joinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        size="compact-xs"
                        px={8}
                        variant="light"
                        color={state.label === "NOW" ? "green" : "appdirect"}
                        rightSection={<IconExternalLink size={11} />}
                        style={{ flexShrink: 0, marginTop: 1 }}
                        aria-label={`Join ${meeting.summary || "meeting"}`}
                      >
                        Join
                      </Button>
                    )}
                  </Group>
                </Card>
              );
            })}
          </Stack>
        </ScrollArea.Autosize>
      )}
    </Stack>
  );
}
