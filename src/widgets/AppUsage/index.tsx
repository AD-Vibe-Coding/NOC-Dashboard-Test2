/**
 * AppUsage — manager-only widget showing per-person app usage stats.
 *
 * Displays:
 *   - Summary bar: DAU / WAU / MAU / total events
 *   - Daily active users sparkline (last 14 days)
 *   - Per-person table: last active, today / week opens, active days, top tool
 *   - Top widgets bar chart
 */
import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconActivity,
  IconBrandGoogle,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { useIdentity } from "../../lib/identity";
import { ROLE_COLORS, ROLE_LABELS, type Role } from "../../lib/roles";

export { AppUsageTile } from "./Tile";

// ── Types ────────────────────────────────────────────────────────────────────

interface UserStat {
  name: string;
  role: string;
  picture: string | null;
  sign_in_method: "google" | "dev" | null;
  last_active: string | null;
  total_events: number;
  today_events: number;
  week_events: number;
  active_days_30: number;
  top_widget: { id: string; title: string; count: number } | null;
}

interface UsageData {
  summary: { dau: number; wau: number; mau: number; total_events: number };
  users: UserStat[];
  top_widgets: { widget_id: string; widget_title: string; count: number }[];
  daily_active: { date: string; count: number }[];
}

interface AppUsageSheetConfigResponse {
  ok: boolean;
  config: {
    spreadsheetId: string;
    tabName: string;
    schedule: string;
    source: string;
    exactColumns: string[];
  };
  next_manual_sync_window: {
    weekStart: string;
    weekEnd: string;
  };
}

interface AppUsageSheetSyncResponse {
  ok: boolean;
  result: {
    spreadsheetId: string;
    tabName: string;
    weekStart: string;
    weekEnd: string;
    totalWidgetEvents: number;
    preparedRows: number;
    appendedRows: number;
    skippedExistingRows: number;
    unmappedUsers: string[];
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatLastActive(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

// ── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const width = 260;
  const height = 36;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (d.count / max) * height;
    return `${x},${y}`;
  });
  const polyline = pts.join(" ");
  const area = `0,${height} ${polyline} ${width},${height}`;

  return (
    <Box style={{ width, height: height + 4 }}>
      <svg width={width} height={height + 4} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--mantine-color-appdirect-5)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--mantine-color-appdirect-5)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#spark-fill)" />
        <polyline points={polyline} fill="none" stroke="var(--mantine-color-appdirect-5)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => {
          const x = (i / (data.length - 1)) * width;
          const y = height - (d.count / max) * height;
          return d.count > 0 ? (
            <Tooltip key={i} label={`${d.date.slice(5)}: ${d.count} active`} withArrow>
              <circle cx={x} cy={y} r={3} fill="var(--mantine-color-appdirect-5)" style={{ cursor: "default" }} />
            </Tooltip>
          ) : null;
        })}
      </svg>
    </Box>
  );
}

// ── Main Widget ──────────────────────────────────────────────────────────────

export function AppUsageWidget() {
  const { identity } = useIdentity();
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [sheetConfig, setSheetConfig] = useState<AppUsageSheetConfigResponse | null>(null);
  const [sheetSyncNotice, setSheetSyncNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<"week" | "today" | "days" | "name">("week");

  async function resetToday() {
    setResetting(true);
    setError(null);
    try {
      const r = await fetch("/api/app-usage", { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Reset failed");
      setResetConfirm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [usageResponse, configResponse] = await Promise.all([
        fetch("/api/app-usage"),
        fetch("/api/app-usage/sync-google-sheet"),
      ]);

      const usageJson = await usageResponse.json();
      if (!usageResponse.ok) throw new Error(usageJson.error ?? `HTTP ${usageResponse.status}`);
      setData(usageJson as UsageData);

      const configJson = await configResponse.json();
      if (!configResponse.ok) throw new Error(configJson.error ?? `HTTP ${configResponse.status}`);
      setSheetConfig(configJson as AppUsageSheetConfigResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function syncLastWeekToSheet() {
    setSyncingSheet(true);
    setSheetSyncNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/app-usage/sync-google-sheet", { method: "POST" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
      const payload = json as AppUsageSheetSyncResponse;
      const unmappedHint = payload.result.unmappedUsers.length > 0
        ? ` Unmapped users: ${payload.result.unmappedUsers.join(", ")}.`
        : "";
      setSheetSyncNotice(`Synced ${payload.result.appendedRows} new rows for ${payload.result.weekStart} to ${payload.result.weekEnd}. ${payload.result.skippedExistingRows} rows were already present.${unmappedHint}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync App Usage to Google Sheet.");
    } finally {
      setSyncingSheet(false);
    }
  }

  useEffect(() => {
    if (identity) load();
  }, [identity]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.users
      .filter((u) => {
        if (q && !u.name.toLowerCase().includes(q)) return false;
        if (roleFilter && u.role !== roleFilter) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "week")  return b.week_events - a.week_events;
        if (sort === "today") return b.today_events - a.today_events;
        if (sort === "days")  return b.active_days_30 - a.active_days_30;
        return a.name.localeCompare(b.name);
      });
  }, [data, query, roleFilter, sort]);

  const maxWeek = useMemo(() => Math.max(...(data?.users.map(u => u.week_events) ?? [1]), 1), [data]);
  const maxWidget = useMemo(() => data?.top_widgets[0]?.count ?? 1, [data]);

  return (
    <WidgetFrame
      title="App Usage"
      subtitle={
        data
          ? `${data.summary.dau} active today · ${data.summary.wau} this week · ${data.summary.mau} this month`
          : "Loading…"
      }
      icon={IconActivity}
      iconColor="teal"
      loading={loading}
      onRefresh={load}
    >
      <Stack gap="lg">
        {error && (
          <Card withBorder radius="md" p="md" style={{ borderColor: "var(--mantine-color-red-6)" }}>
            <Text c="red" size="sm">{error}</Text>
          </Card>
        )}

        {sheetSyncNotice && (
          <Card withBorder radius="md" p="md" style={{ borderColor: "var(--mantine-color-teal-6)" }}>
            <Text c="teal" size="sm">{sheetSyncNotice}</Text>
          </Card>
        )}

        {sheetConfig && (
          <Card withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start">
                <Box>
                  <Text fw={700}>Weekly Google Sheet sync</Text>
                  <Text size="sm" c="dimmed">
                    Auto-appends widget-open usage rows to the <strong>{sheetConfig.config.tabName}</strong> tab every Friday at 5:00 AM PT.
                  </Text>
                </Box>
                <Badge color="teal" variant="light">{sheetConfig.config.schedule}</Badge>
              </Group>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                <Card withBorder radius="md" p="sm">
                  <Text size="xs" tt="uppercase" fw={700} c="dimmed">Sheet target</Text>
                  <Text size="sm" mt={4}>{sheetConfig.config.tabName}</Text>
                  <Text size="xs" c="dimmed" mt={2}>{sheetConfig.config.spreadsheetId}</Text>
                </Card>
                <Card withBorder radius="md" p="sm">
                  <Text size="xs" tt="uppercase" fw={700} c="dimmed">Current sync window</Text>
                  <Text size="sm" mt={4}>{sheetConfig.next_manual_sync_window.weekStart} → {sheetConfig.next_manual_sync_window.weekEnd}</Text>
                  <Text size="xs" c="dimmed" mt={2}>{sheetConfig.config.source}</Text>
                </Card>
              </SimpleGrid>
              <Group justify="space-between" align="center">
                <Text size="xs" c="dimmed">
                  Columns: {sheetConfig.config.exactColumns.join(", ")}
                </Text>
                <Button color="teal" variant="light" onClick={syncLastWeekToSheet} loading={syncingSheet}>
                  Sync this week now
                </Button>
              </Group>
            </Stack>
          </Card>
        )}

        {/* ── Summary cards ─────────────────────────────────────────────── */}
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          {[
            { label: "Active today",      value: data?.summary.dau,          color: "teal"      },
            { label: "Active this week",  value: data?.summary.wau,          color: "appdirect" },
            { label: "Active this month", value: data?.summary.mau,          color: "indigo"    },
            { label: "Widget opens (30d)",value: data?.summary.total_events, color: "grape"     },
          ].map(({ label, value, color }) => (
            <Card key={label} withBorder radius="md" p="md">
              <Group justify="space-between" wrap="nowrap" align="flex-start" gap={4}>
                <Box>
                  {loading ? <Skeleton height={28} radius="sm" width={40} /> : (
                    <Text fw={700} size="xl" c={color} ff="monospace">{value ?? 0}</Text>
                  )}
                  <Text size="xs" c="dimmed" mt={2}>{label}</Text>
                </Box>
                {label === "Active today" && (
                  resetConfirm ? (
                    <Group gap={4} wrap="nowrap">
                      <Tooltip label="Confirm: delete today's events">
                        <ActionIcon
                          size="sm"
                          color="red"
                          variant="filled"
                          loading={resetting}
                          onClick={resetToday}
                          aria-label="Confirm reset"
                        >
                          <IconTrash size={12} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Cancel">
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          onClick={() => setResetConfirm(false)}
                          aria-label="Cancel reset"
                        >
                          <IconX size={12} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  ) : (
                    <Tooltip label="Reset today's active users count">
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="gray"
                        onClick={() => setResetConfirm(true)}
                        aria-label="Reset today's usage"
                      >
                        <IconRefresh size={12} />
                      </ActionIcon>
                    </Tooltip>
                  )
                )}
              </Group>
            </Card>
          ))}
        </SimpleGrid>

        {/* ── Daily active sparkline ────────────────────────────────────── */}
        {data && data.daily_active.length > 0 && (
          <Card withBorder radius="md" p="md">
            <Group justify="space-between" mb="xs">
              <Text size="sm" fw={600}>Daily active users — last 14 days</Text>
              <Text size="xs" c="dimmed">peak: {Math.max(...data.daily_active.map(d => d.count))}</Text>
            </Group>
            <Sparkline data={data.daily_active} />
            <Group gap={4} mt={4}>
              {data.daily_active.slice(-7).map((d) => (
                <Text key={d.date} size="xs" c="dimmed" style={{ flex: 1, textAlign: "center" }}>
                  {new Date(d.date + "T12:00:00").toLocaleDateString([], { weekday: "short" })}
                </Text>
              ))}
            </Group>
          </Card>
        )}

        {/* ── Top widgets ───────────────────────────────────────────────── */}
        {data && data.top_widgets.length > 0 && (
          <Card withBorder radius="md" p="md">
            <Text size="sm" fw={600} mb="sm">Most-used tools (30 days)</Text>
            <Stack gap={6}>
              {data.top_widgets.map((w) => (
                <Group key={w.widget_id} gap="sm" wrap="nowrap">
                  <Text size="xs" style={{ width: 160, flexShrink: 0 }} truncate>
                    {w.widget_title}
                  </Text>
                  <Progress
                    value={(w.count / maxWidget) * 100}
                    color="teal"
                    size="sm"
                    style={{ flex: 1 }}
                    radius="xl"
                  />
                  <Text size="xs" fw={600} ff="monospace" style={{ width: 32, textAlign: "right" }}>
                    {w.count}
                  </Text>
                </Group>
              ))}
            </Stack>
          </Card>
        )}

        {/* ── Per-user table ────────────────────────────────────────────── */}
        <Card withBorder radius="md" p={0}>
          {/* Toolbar */}
          <Box p="md" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
            <Group gap="sm" wrap="wrap">
              <TextInput
                placeholder="Search by name…"
                leftSection={<IconSearch size={14} />}
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                radius="md"
                size="sm"
                style={{ flex: 1, minWidth: 160 }}
                rightSection={query ? (
                  <ActionIcon size="xs" variant="transparent" onClick={() => setQuery("")}>
                    <IconX size={12} />
                  </ActionIcon>
                ) : null}
              />
              <Select
                placeholder="All roles"
                data={[
                  { value: "manager", label: "Manager" },
                  { value: "tier3",   label: "Tier 3"  },
                  { value: "tier2",   label: "Tier 2"  },
                  { value: "tier1",   label: "Tier 1"  },
                ]}
                value={roleFilter}
                onChange={setRoleFilter}
                clearable
                size="sm"
                radius="md"
                w={120}
              />
              <Select
                placeholder="Sort by…"
                data={[
                  { value: "week",  label: "This week"   },
                  { value: "today", label: "Today"       },
                  { value: "days",  label: "Active days" },
                  { value: "name",  label: "Name"        },
                ]}
                value={sort}
                onChange={(v) => setSort((v ?? "week") as typeof sort)}
                size="sm"
                radius="md"
                w={130}
              />
              <ActionIcon variant="default" size="lg" radius="md" onClick={load} loading={loading}>
                <IconRefresh size={16} />
              </ActionIcon>
            </Group>
          </Box>

          {/* Table */}
          <ScrollArea>
            <Table verticalSpacing="sm" horizontalSpacing="md" striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Member</Table.Th>
                  <Table.Th>Role</Table.Th>
                  <Table.Th>Last active</Table.Th>
                  <Table.Th>Today</Table.Th>
                  <Table.Th>This week</Table.Th>
                  <Table.Th>Active days (30d)</Table.Th>
                  <Table.Th>Top tool</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {loading && !data ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <Table.Tr key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <Table.Td key={j}><Skeleton height={16} radius="sm" /></Table.Td>
                      ))}
                    </Table.Tr>
                  ))
                ) : filtered.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={7}>
                      <Text ta="center" c="dimmed" size="sm" py="lg">No members match your filters.</Text>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  filtered.map((u) => (
                    <Table.Tr key={u.name}>
                      {/* Member */}
                      <Table.Td>
                        <Group gap="sm" wrap="nowrap">
                          <Avatar
                            src={u.picture ?? undefined}
                            size={30}
                            radius="xl"
                            color={ROLE_COLORS[u.role as Role] ?? "gray"}
                          >
                            {!u.picture && initials(u.name)}
                          </Avatar>
                          <Box>
                            <Text size="sm" fw={500} style={{ whiteSpace: "nowrap" }}>{u.name}</Text>
                            {u.sign_in_method === "google" && (
                              <Group gap={4}>
                                <IconBrandGoogle size={10} style={{ opacity: 0.5 }} />
                                <Text size="xs" c="dimmed">Google SSO</Text>
                              </Group>
                            )}
                            {u.sign_in_method === "dev" && (
                              <Text size="xs" c="dimmed">Dev login</Text>
                            )}
                          </Box>
                        </Group>
                      </Table.Td>

                      {/* Role */}
                      <Table.Td>
                        <Badge size="xs" color={ROLE_COLORS[u.role as Role] ?? "gray"} variant="light">
                          {ROLE_LABELS[u.role as Role] ?? u.role}
                        </Badge>
                      </Table.Td>

                      {/* Last active */}
                      <Table.Td>
                        <Text
                          size="xs"
                          c={u.last_active ? undefined : "dimmed"}
                          ff={u.last_active ? "monospace" : undefined}
                        >
                          {formatLastActive(u.last_active)}
                        </Text>
                      </Table.Td>

                      {/* Today */}
                      <Table.Td>
                        <Text size="sm" fw={u.today_events > 0 ? 600 : 400} c={u.today_events > 0 ? "bright" : "dimmed"}>
                          {u.today_events > 0 ? u.today_events : "—"}
                        </Text>
                      </Table.Td>

                      {/* This week — with mini bar */}
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm" fw={u.week_events > 0 ? 600 : 400} c={u.week_events > 0 ? "bright" : "dimmed"} style={{ width: 24 }}>
                            {u.week_events > 0 ? u.week_events : "—"}
                          </Text>
                          {u.week_events > 0 && (
                            <Box
                              style={{
                                height: 4,
                                width: Math.max(4, (u.week_events / maxWeek) * 60),
                                background: `var(--mantine-color-${ROLE_COLORS[u.role as Role] ?? "gray"}-6)`,
                                borderRadius: 4,
                                opacity: 0.7,
                              }}
                            />
                          )}
                        </Group>
                      </Table.Td>

                      {/* Active days */}
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          <Text size="sm" c={u.active_days_30 > 0 ? "bright" : "dimmed"}>
                            {u.active_days_30 > 0 ? u.active_days_30 : "—"}
                          </Text>
                          {u.active_days_30 > 0 && (
                            <Text size="xs" c="dimmed">/ 30</Text>
                          )}
                        </Group>
                      </Table.Td>

                      {/* Top tool */}
                      <Table.Td>
                        {u.top_widget ? (
                          <Tooltip label={`${u.top_widget.count} opens`} withArrow>
                            <Badge size="sm" variant="light" color="teal" style={{ cursor: "default" }}>
                              {u.top_widget.title}
                            </Badge>
                          </Tooltip>
                        ) : (
                          <Text size="xs" c="dimmed">—</Text>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea>

          <Box p="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
            <Text size="xs" c="dimmed">
              Usage data is recorded when team members open widgets. Tracking starts from when the app_events table is created.
            </Text>
          </Box>
        </Card>
      </Stack>
    </WidgetFrame>
  );
}
