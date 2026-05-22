import { useEffect, useState } from "react";
import { Badge, Group, Skeleton, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconActivity, IconUsers } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { useIdentity } from "../../lib/identity";

interface Props { onExpand: () => void; }

interface Summary {
  dau: number;
  wau: number;
  mau: number;
  total_events: number;
}

export function AppUsageTile({ onExpand }: Props) {
  const { identity, loading: identityLoading } = useIdentity();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [topUsers, setTopUsers] = useState<{ name: string; week_events: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (identityLoading || !identity) { setLoading(false); return; }
    fetch("/api/app-usage")
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((j) => {
        setSummary(j.summary ?? null);
        setTopUsers((j.users ?? []).filter((u: any) => u.week_events > 0).slice(0, 3));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [identity, identityLoading]);

  return (
    <WidgetTile
      title="App Usage"
      description="Who's using what, and when"
      icon={IconActivity}
      iconColor="teal"
      onExpand={onExpand}
    >
      {loading ? (
        <Stack gap={6}>
          <Skeleton height={14} radius="sm" />
          <Skeleton height={14} radius="sm" width="70%" />
        </Stack>
      ) : summary ? (
        <Stack gap="xs">
          {/* DAU / WAU pills */}
          <Group gap={6} wrap="wrap">
            <Badge size="sm" color="teal" variant="filled">
              {summary.dau} today
            </Badge>
            <Badge size="sm" color="appdirect" variant="light">
              {summary.wau} this week
            </Badge>
            <Badge size="sm" color="gray" variant="light">
              {summary.mau} this month
            </Badge>
          </Group>

          {/* Top active this week */}
          {topUsers.length > 0 && (
            <Stack gap={2} mt={2}>
              {topUsers.map((u) => (
                <Group key={u.name} gap={6} wrap="nowrap">
                  <ThemeIcon size="xs" color="teal" variant="light" radius="xl">
                    <IconUsers size={9} />
                  </ThemeIcon>
                  <Text size="xs" truncate style={{ flex: 1 }}>
                    {u.name.split(" ")[0]}
                  </Text>
                  <Text size="xs" c="dimmed" ff="monospace">
                    {u.week_events}
                  </Text>
                </Group>
              ))}
            </Stack>
          )}

          {summary.total_events === 0 && (
            <Text size="xs" c="dimmed">No usage data yet — opens tracked from now on.</Text>
          )}
        </Stack>
      ) : (
        <Text size="xs" c="dimmed">Click to view usage stats</Text>
      )}
    </WidgetTile>
  );
}
