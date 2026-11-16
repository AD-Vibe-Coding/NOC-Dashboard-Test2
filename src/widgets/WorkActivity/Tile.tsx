import { useCallback, useEffect, useState } from "react";
import { Stack, Group, Text, Title, Box, Badge, Divider, Button, Skeleton } from "@mantine/core";
import {
  IconActivity,
  IconBolt,
  IconCalendar,
  IconCheck,
  IconExternalLink,
  IconPhone,
  IconTicket,
  IconUser,
} from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useWorkActivity } from "./data";
import { useIdentity } from "../../lib/identity";
import { buildMyDayMetrics, findUserActivity } from "../../lib/work-activity";

interface Props {
  onExpand: () => void;
}

type CalendarMeeting = {
  id: string;
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  joinLink?: string | null;
};

type CalendarResponse = {
  connected: boolean;
  events: CalendarMeeting[];
  error?: string;
};

function formatMeetingTime(meeting: CalendarMeeting) {
  if (!meeting.start?.dateTime) return "All day";
  const start = new Date(meeting.start.dateTime);
  const end = meeting.end?.dateTime ? new Date(meeting.end.dateTime) : null;
  const format = (date: Date) => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return end ? `${format(start)} – ${format(end)}` : format(start);
}

function isMeetingToday(meeting: CalendarMeeting) {
  const value = meeting.start?.dateTime ?? meeting.start?.date;
  return !!value && new Date(value).toDateString() === new Date().toDateString();
}

export function WorkActivityTile({ onExpand }: Props) {
  const { slack, calls, loading } = useWorkActivity();
  const { identity } = useIdentity();
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [connectingCalendar, setConnectingCalendar] = useState(false);

  const refreshCalendar = useCallback(async () => {
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      const response = await fetch("/api/calendar/events", { credentials: "include" });
      if (!response.ok) throw new Error(`Calendar request failed (${response.status})`);
      const result = await response.json() as CalendarResponse;
      setCalendar(result);
      if (result.error) setCalendarError(result.error);
    } catch (error) {
      setCalendarError(error instanceof Error ? error.message : "Unable to load calendar.");
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCalendar();
    const interval = window.setInterval(() => void refreshCalendar(), 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [refreshCalendar]);

  const connectCalendar = useCallback(() => {
    setConnectingCalendar(true);
    const width = 520;
    const height = 640;
    const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
    const top = Math.round(window.screenY + (window.outerHeight - height) / 2);
    const popup = window.open(
      "/api/calendar/start",
      "gcal_oauth",
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`,
    );
    if (!popup) {
      setCalendarError("Allow pop-ups to connect Google Calendar.");
      setConnectingCalendar(false);
      return;
    }
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "gcal-oauth-success") {
        cleanup();
        setConnectingCalendar(false);
        void refreshCalendar();
      } else if (event.data?.type === "gcal-oauth-error") {
        cleanup();
        setConnectingCalendar(false);
        setCalendarError("Google Calendar connection did not complete.");
      }
    };
    window.addEventListener("message", onMessage);
    const poll = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        setConnectingCalendar(false);
      }
    }, 500);
  }, [refreshCalendar]);

  const resolved = identity?.name
    ? findUserActivity(identity.name, slack).matched ?? identity.name
    : null;
  const me = resolved ? buildMyDayMetrics(resolved, slack, calls) : null;

  const source = !slack && !calls
    ? null
    : slack?.source === "live" && calls?.source === "live"
      ? { label: "live", color: "green" }
      : { label: slack?.source === "live" ? "Slack live" : "snapshot", color: "yellow" };
  const todayMeetings = (calendar?.events ?? [])
    .filter((meeting) => meeting.status !== "cancelled" && isMeetingToday(meeting))
    .sort((a, b) => new Date(a.start?.dateTime ?? a.start?.date ?? 0).getTime() - new Date(b.start?.dateTime ?? b.start?.date ?? 0).getTime());

  return (
    <WidgetTile
      title="My Day"
      description="Today's tickets + calls"
      icon={IconActivity}
      iconColor="indigo"
      status={source ?? undefined}
      onExpand={onExpand}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        {!identity?.name ? (
          <Box style={{ flex: 1 }}>
            <Text size="xs" c="dimmed" ta="center" mt="md">
              Set your identity to see your day's activity
            </Text>
          </Box>
        ) : me ? (
          <>
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Box>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Today
                </Text>
                <Title order={1} c="indigo" style={{ lineHeight: 1 }} mt={2}>
                  {me.worked + me.updated + me.acked + me.calls_answered}
                </Title>
                <Text size="xs" c="dimmed" mt={2}>
                  total actions
                </Text>
              </Box>
              <Badge
                variant="light"
                color="indigo"
                leftSection={<IconUser size={10} />}
                size="sm"
                style={{ textTransform: "none" }}
              >
                {identity.name.split(" ")[0]}
              </Badge>
            </Group>
            <Divider variant="dashed" />
            <Stack gap={6}>
              <MetricRow icon={IconTicket} color="indigo" label="Worked" value={me.worked} />
              <MetricRow icon={IconCheck} color="teal" label="Updated" value={me.updated} />
              <MetricRow
                icon={IconBolt}
                color="yellow"
                label="Ack'd"
                value={me.acked + me.assignments_received}
              />
              <MetricRow icon={IconPhone} color="blue" label="Calls" value={me.calls_answered} />
            </Stack>
          </>
        ) : (
          <Text size="xs" c="dimmed" ta="center" mt="md">
            {loading ? "Loading…" : "No activity today"}
          </Text>
        )}

        <Divider variant="dashed" />
        <Stack gap={6}>
          <Group justify="space-between" wrap="nowrap" gap={6}>
            <Group gap={5} wrap="nowrap">
              <IconCalendar size={14} color="var(--mantine-color-appdirect-5)" />
              <Text size="xs" fw={700}>Today’s meetings</Text>
            </Group>
            {calendar?.connected && !calendarLoading && (
              <Badge size="xs" variant="light" color="appdirect">{todayMeetings.length}</Badge>
            )}
          </Group>

          {calendarLoading ? (
            <Stack gap={5} aria-label="Loading today’s meetings">
              <Skeleton height={12} width="88%" />
              <Skeleton height={12} width="68%" />
            </Stack>
          ) : !calendar?.connected ? (
            <Group justify="space-between" wrap="nowrap" gap={6}>
              <Text size="xs" c="dimmed" style={{ minWidth: 0 }}>
                {calendarError || calendar?.error || "Connect Google Calendar to see your schedule."}
              </Text>
              <Button
                size="compact-xs"
                variant="light"
                color="appdirect"
                loading={connectingCalendar}
                onClick={(event) => { event.stopPropagation(); connectCalendar(); }}
              >
                {String(calendar?.error ?? calendarError ?? "").toLowerCase().includes("sign out and sign in again") ? "Re-authorize" : "Connect"}
              </Button>
            </Group>
          ) : calendarError ? (
            <Group justify="space-between" wrap="nowrap" gap={6}>
              <Text size="xs" c="dimmed" lineClamp={2}>{calendarError}</Text>
              <Button
                size="compact-xs"
                variant="subtle"
                color="appdirect"
                loading={calendarLoading}
                onClick={(event) => { event.stopPropagation(); void refreshCalendar(); }}
              >
                Retry
              </Button>
            </Group>
          ) : todayMeetings.length === 0 ? (
            <Text size="xs" c="dimmed">No meetings scheduled today.</Text>
          ) : (
            <Stack gap={5}>
              {todayMeetings.map((meeting) => {
                const isPast = meeting.end?.dateTime
                  ? new Date(meeting.end.dateTime).getTime() < Date.now()
                  : false;
                return (
                  <Group key={meeting.id} justify="space-between" wrap="nowrap" gap={6}>
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Text size="xs" fw={500} lineClamp={1} title={meeting.summary ?? "Untitled meeting"}>
                        {meeting.summary || "Untitled meeting"}
                      </Text>
                      <Text size="10px" c="dimmed" ff="monospace">{formatMeetingTime(meeting)}{isPast ? " · done" : ""}</Text>
                    </Box>
                    {meeting.joinLink && (
                      <Button
                        component="a"
                        href={meeting.joinLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        size="compact-xs"
                        variant="light"
                        color="appdirect"
                        rightSection={<IconExternalLink size={11} />}
                        onClick={(event) => event.stopPropagation()}
                      >
                        Join
                      </Button>
                    )}
                  </Group>
                );
              })}
            </Stack>
          )}
        </Stack>
      </Stack>
    </WidgetTile>
  );
}

function MetricRow({
  icon: Icon,
  color,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  color: string;
  label: string;
  value: number;
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap={6}>
      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
        <Icon size={12} color={`var(--mantine-color-${color}-5)`} />
        <Text size="xs" c="dimmed">
          {label}
        </Text>
      </Group>
      <Text size="sm" fw={600} ff="monospace" c={value > 0 ? `${color}.4` : "dimmed"}>
        {value || "—"}
      </Text>
    </Group>
  );
}
