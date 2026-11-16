import { useEffect, useState } from "react";
import { Badge, Group, Skeleton, Stack, Text } from "@mantine/core";

type Meeting = {
  id: string;
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

type CalendarResponse = {
  connected: boolean;
  events: Meeting[];
  error?: string;
};

function isToday(meeting: Meeting) {
  const start = meeting.start?.dateTime ?? meeting.start?.date;
  return !!start && new Date(start).toDateString() === new Date().toDateString();
}

function meetingTime(meeting: Meeting) {
  if (!meeting.start?.dateTime) return "All day";
  const start = new Date(meeting.start.dateTime);
  const end = meeting.end?.dateTime ? new Date(meeting.end.dateTime) : null;
  const format = (date: Date) => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return end ? `${format(start)}–${format(end)}` : format(start);
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
    .filter((meeting) => meeting.status !== "cancelled" && isToday(meeting))
    .sort((a, b) => new Date(a.start?.dateTime ?? a.start?.date ?? 0).getTime() - new Date(b.start?.dateTime ?? b.start?.date ?? 0).getTime());

  return (
    <Stack gap={3} mt="xs" aria-label="Today's meetings">
      <Group gap={5} wrap="nowrap">
        <Text size="10px" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.05em" }}>
          Today’s meetings
        </Text>
        {calendar?.connected && !loading && <Badge size="xs" variant="light" color="appdirect">{meetings.length}</Badge>}
      </Group>
      {loading ? (
        <Stack gap={4}>
          <Skeleton height={11} width="88%" />
          <Skeleton height={11} width="64%" />
        </Stack>
      ) : !calendar?.connected ? (
        <Text size="xs" c="dimmed" lineClamp={1} title={calendar?.error ?? "Connect Google Calendar to see meetings"}>
          {calendar?.error ?? "Connect Google Calendar to see meetings"}
        </Text>
      ) : meetings.length === 0 ? (
        <Text size="xs" c="dimmed">No meetings scheduled today</Text>
      ) : (
        <>
          {meetings.slice(0, 2).map((meeting) => (
            <Group key={meeting.id} gap="xs" wrap="nowrap" justify="space-between">
              <Text size="xs" fw={500} lineClamp={1} style={{ minWidth: 0, flex: 1 }} title={meeting.summary || "Untitled meeting"}>
                {meeting.summary || "Untitled meeting"}
              </Text>
              <Text size="10px" c="dimmed" ff="monospace" style={{ flexShrink: 0 }}>{meetingTime(meeting)}</Text>
            </Group>
          ))}
          {meetings.length > 2 && (
            <Text size="10px" c="dimmed">+{meetings.length - 2} more today</Text>
          )}
        </>
      )}
    </Stack>
  );
}
