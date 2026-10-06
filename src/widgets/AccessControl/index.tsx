/**
 * Access Control — manager-only widget for managing team roles and SSO.
 *
 * Tabs:
 *   1. Team Members — full roster with roles, sign-in status, override controls
 *   2. SSO Setup    — Google OAuth configuration guide + current status
 */
import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Code,
  CopyButton,
  Divider,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBrandGoogle,
  IconCheck,
  IconClockHour4,
  IconCopy,
  IconEdit,
  IconExternalLink,
  IconInfoCircle,
  IconRefresh,
  IconSearch,
  IconShield,
  IconShieldCheck,
  IconShieldOff,
  IconUserCheck,
  IconX,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { useIdentity } from "../../lib/identity";
import {
  ROLE_COLORS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type Role,
} from "../../lib/roles";

export { AccessControlTile } from "./Tile";

// ── Types ────────────────────────────────────────────────────────────────────

interface TeamMember {
  name: string;
  email: string;
  defaultRole: string;
  role: string;
  isOverridden: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
  lastSignIn: string | null;
  signInMethod: "google" | "dev" | null;
  picture: string | null;
}

interface SsoConfig {
  configured: boolean;
  allowedDomains: string[];
}

interface AccessControlData {
  members: TeamMember[];
  counts: Record<Role, number>;
  sso: SsoConfig;
}

const ROLE_OPTIONS = [
  { value: "tier1", label: "Tier 1 — Entry-level NOC tech" },
  { value: "tier2", label: "Tier 2 — Mid-level NOC tech" },
  { value: "tier3", label: "Tier 3 — Senior NOC tech" },
  { value: "customer_service_manager", label: "Customer Service Manager — NOC MTTR only" },
  { value: "manager", label: "Manager — Full access" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatLastSeen(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function memberInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

// ── Main Widget ──────────────────────────────────────────────────────────────

export function AccessControlWidget() {
  const { identity } = useIdentity();
  const [data, setData] = useState<AccessControlData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [methodFilter, setMethodFilter] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/access-control");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j as AccessControlData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (identity) load();
  }, [identity]);

  function openEdit(member: TeamMember) {
    setEditingMember(member);
    setPendingRole(member.role);
    setSaveError(null);
  }

  async function saveRole() {
    if (!editingMember) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch("/api/access-control", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingMember.name,
          email: editingMember.email,
          role: pendingRole,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setEditingMember(null);
      setSuccessMsg(
        `${editingMember.name}'s role updated to ${ROLE_LABELS[pendingRole as Role] ?? pendingRole}.`
      );
      setTimeout(() => setSuccessMsg(null), 5000);
      await load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function resetRole(member: TeamMember) {
    try {
      await fetch("/api/access-control", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: member.name }),
      });
      setSuccessMsg(`${member.name}'s role reset to default (${ROLE_LABELS[member.defaultRole as Role] ?? member.defaultRole}).`);
      setTimeout(() => setSuccessMsg(null), 5000);
      await load();
    } catch { /* ignore */ }
  }

  // ── Filtered members ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.members.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.email.toLowerCase().includes(q)) return false;
      if (roleFilter && m.role !== roleFilter) return false;
      if (methodFilter === "google" && m.signInMethod !== "google") return false;
      if (methodFilter === "dev" && m.signInMethod !== "dev") return false;
      if (methodFilter === "never" && m.lastSignIn !== null) return false;
      return true;
    });
  }, [data, query, roleFilter, methodFilter]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const ssoStats = useMemo(() => {
    if (!data) return null;
    const googleCount = data.members.filter((m) => m.signInMethod === "google").length;
    const devCount = data.members.filter((m) => m.signInMethod === "dev").length;
    const neverCount = data.members.filter((m) => !m.lastSignIn).length;
    const overrideCount = data.members.filter((m) => m.isOverridden).length;
    return { googleCount, devCount, neverCount, overrideCount };
  }, [data]);

  // ── Current redirect URI ───────────────────────────────────────────────────
  const redirectUri = `${window.location.origin}/api/auth/callback`;

  return (
    <WidgetFrame
      title="Access Control"
      subtitle={
        data
          ? `${data.members.length} team members · ${ssoStats?.overrideCount ?? 0} role overrides`
          : "Loading…"
      }
      icon={IconShield}
      iconColor="red"
      loading={loading}
      onRefresh={load}
      status={
        data
          ? {
              label: data.sso.configured ? "Google SSO: On" : "SSO: Off",
              color: data.sso.configured ? "green" : "yellow",
              tooltip: data.sso.configured
                ? `SSO active — @${data.sso.allowedDomains.join(", @")} accounts only`
                : "Google SSO not configured — set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in .env",
            }
          : undefined
      }
    >
      <Stack gap="lg">
        {/* Success toast */}
        {successMsg && (
          <Alert
            icon={<IconCheck size={16} />}
            color="green"
            variant="light"
            radius="md"
            withCloseButton
            onClose={() => setSuccessMsg(null)}
          >
            {successMsg}
          </Alert>
        )}

        {/* Error */}
        {error && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="red"
            variant="light"
            radius="md"
          >
            {error}
          </Alert>
        )}

        <Tabs defaultValue="members" variant="default">
          <Tabs.List>
            <Tabs.Tab value="members" leftSection={<IconUserCheck size={14} />}>
              Team Members
            </Tabs.Tab>
            <Tabs.Tab
              value="sso"
              leftSection={<IconBrandGoogle size={14} />}
              rightSection={
                data && !data.sso.configured ? (
                  <Badge size="xs" color="yellow" circle>!</Badge>
                ) : null
              }
            >
              SSO Setup
            </Tabs.Tab>
          </Tabs.List>

          {/* ── TEAM MEMBERS TAB ─────────────────────────────────────────── */}
          <Tabs.Panel value="members" pt="md">
            <Stack gap="md">
              {/* Stats row */}
              {data && ssoStats && (
                <Group gap="xs" wrap="wrap">
                  {(["manager", "customer_service_manager", "tier3", "tier2", "tier1"] as Role[]).map((role) =>
                    data.counts[role] > 0 ? (
                      <Badge
                        key={role}
                        size="sm"
                        color={ROLE_COLORS[role]}
                        variant="light"
                      >
                        {data.counts[role]} {ROLE_LABELS[role]}
                      </Badge>
                    ) : null
                  )}
                  <Divider orientation="vertical" />
                  {ssoStats.googleCount > 0 && (
                    <Badge size="sm" color="green" variant="light" leftSection={<IconBrandGoogle size={10} />}>
                      {ssoStats.googleCount} via Google
                    </Badge>
                  )}
                  {ssoStats.devCount > 0 && (
                    <Badge size="sm" color="gray" variant="light">
                      {ssoStats.devCount} dev login
                    </Badge>
                  )}
                  {ssoStats.neverCount > 0 && (
                    <Badge size="sm" color="orange" variant="light" leftSection={<IconClockHour4 size={10} />}>
                      {ssoStats.neverCount} never signed in
                    </Badge>
                  )}
                  {ssoStats.overrideCount > 0 && (
                    <Badge size="sm" color="violet" variant="light">
                      {ssoStats.overrideCount} override{ssoStats.overrideCount !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </Group>
              )}

              {/* Filters */}
              <Group gap="sm" wrap="nowrap">
                <TextInput
                  flex={1}
                  placeholder="Search by name or email…"
                  leftSection={<IconSearch size={14} />}
                  value={query}
                  onChange={(e) => setQuery(e.currentTarget.value)}
                  radius="md"
                  size="sm"
                  rightSection={
                    query ? (
                      <ActionIcon size="xs" variant="transparent" onClick={() => setQuery("")}>
                        <IconX size={12} />
                      </ActionIcon>
                    ) : null
                  }
                />
                <Select
                  placeholder="All roles"
                  data={[
                    { value: "manager", label: "Manager" },
                    { value: "tier3", label: "Tier 3" },
                    { value: "tier2", label: "Tier 2" },
                    { value: "tier1", label: "Tier 1" },
                  ]}
                  value={roleFilter}
                  onChange={setRoleFilter}
                  clearable
                  size="sm"
                  radius="md"
                  w={120}
                />
                <Select
                  placeholder="All logins"
                  data={[
                    { value: "google", label: "Google SSO" },
                    { value: "dev", label: "Dev login" },
                    { value: "never", label: "Never signed in" },
                  ]}
                  value={methodFilter}
                  onChange={setMethodFilter}
                  clearable
                  size="sm"
                  radius="md"
                  w={140}
                />
              </Group>

              {/* Members table */}
              {filtered.length === 0 ? (
                <Box ta="center" py="xl">
                  <Text c="dimmed" size="sm">No members match your filters.</Text>
                </Box>
              ) : (
                <ScrollArea>
                  <Table verticalSpacing="sm" horizontalSpacing="md" striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Member</Table.Th>
                        <Table.Th>Role</Table.Th>
                        <Table.Th>Sign-in</Table.Th>
                        <Table.Th>Last seen</Table.Th>
                        <Table.Th w={80}>Actions</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {filtered.map((m) => (
                        <Table.Tr key={m.name}>
                          {/* Name + Email */}
                          <Table.Td>
                            <Group gap="sm" wrap="nowrap">
                              <Avatar
                                src={m.picture || undefined}
                                size={32}
                                radius="xl"
                                color={ROLE_COLORS[m.role as Role] ?? "gray"}
                              >
                                {!m.picture && memberInitials(m.name)}
                              </Avatar>
                              <Box style={{ minWidth: 0 }}>
                                <Text size="sm" fw={600} truncate>
                                  {m.name}
                                </Text>
                                <Text size="xs" c="dimmed" truncate>
                                  {m.email}
                                </Text>
                              </Box>
                            </Group>
                          </Table.Td>

                          {/* Role */}
                          <Table.Td>
                            <Group gap={6} wrap="nowrap">
                              <Badge
                                size="sm"
                                color={ROLE_COLORS[m.role as Role] ?? "gray"}
                                variant={m.isOverridden ? "filled" : "light"}
                              >
                                {ROLE_LABELS[m.role as Role] ?? m.role}
                              </Badge>
                              {m.isOverridden && (
                                <Tooltip
                                  label={`Overridden by ${m.updatedBy ?? "manager"}`}
                                  withArrow
                                >
                                  <ThemeIcon size="xs" color="violet" variant="light" radius="xl">
                                    <IconShieldCheck size={10} />
                                  </ThemeIcon>
                                </Tooltip>
                              )}
                            </Group>
                          </Table.Td>

                          {/* Sign-in method */}
                          <Table.Td>
                            {m.signInMethod === "google" ? (
                              <Badge
                                size="sm"
                                color="green"
                                variant="light"
                                leftSection={<IconBrandGoogle size={10} />}
                              >
                                Google
                              </Badge>
                            ) : m.signInMethod === "dev" ? (
                              <Badge size="sm" color="gray" variant="light">
                                Dev
                              </Badge>
                            ) : (
                              <Text size="xs" c="dimmed">—</Text>
                            )}
                          </Table.Td>

                          {/* Last seen */}
                          <Table.Td>
                            <Text
                              size="xs"
                              c={m.lastSignIn ? undefined : "dimmed"}
                              ff={m.lastSignIn ? undefined : undefined}
                            >
                              {formatLastSeen(m.lastSignIn)}
                            </Text>
                          </Table.Td>

                          {/* Actions */}
                          <Table.Td>
                            <Group gap={4} wrap="nowrap">
                              <Tooltip label="Edit role" withArrow>
                                <ActionIcon
                                  size="sm"
                                  variant="light"
                                  color="appdirect"
                                  onClick={() => openEdit(m)}
                                >
                                  <IconEdit size={13} />
                                </ActionIcon>
                              </Tooltip>
                              {m.isOverridden && (
                                <Tooltip label="Reset to default role" withArrow>
                                  <ActionIcon
                                    size="sm"
                                    variant="light"
                                    color="gray"
                                    onClick={() => resetRole(m)}
                                  >
                                    <IconRefresh size={13} />
                                  </ActionIcon>
                                </Tooltip>
                              )}
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              )}

              <Text size="xs" c="dimmed" ta="right">
                Role changes take effect on the member's next sign-in.
              </Text>
            </Stack>
          </Tabs.Panel>

          {/* ── SSO SETUP TAB ────────────────────────────────────────────── */}
          <Tabs.Panel value="sso" pt="md">
            <Stack gap="md">
              {/* Current SSO status */}
              <Card withBorder radius="md" p="md">
                <Group justify="space-between" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap">
                    <ThemeIcon
                      size="lg"
                      radius="xl"
                      variant="light"
                      color={data?.sso.configured ? "green" : "yellow"}
                    >
                      {data?.sso.configured ? (
                        <IconShieldCheck size={18} />
                      ) : (
                        <IconShieldOff size={18} />
                      )}
                    </ThemeIcon>
                    <Box>
                      <Text fw={600} size="sm">
                        {data?.sso.configured
                          ? "Google SSO is active"
                          : "Google SSO not configured"}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {data?.sso.configured
                          ? `Allowed domains: @${data.sso.allowedDomains.join(", @")}`
                          : "Users sign in via the dev name picker — no real authentication"}
                      </Text>
                    </Box>
                  </Group>
                  <Badge
                    size="md"
                    color={data?.sso.configured ? "green" : "yellow"}
                    variant="light"
                  >
                    {data?.sso.configured ? "Active" : "Inactive"}
                  </Badge>
                </Group>
              </Card>

              {data?.sso.configured ? (
                /* ── Already configured ─────────────────────────────────── */
                <Stack gap="sm">
                  <Alert
                    icon={<IconShieldCheck size={16} />}
                    color="green"
                    variant="light"
                    radius="md"
                  >
                    Google SSO is enabled. Team members sign in with their{" "}
                    <strong>@{data.sso.allowedDomains[0]}</strong> Google account. Roles are
                    auto-assigned from the roster, with any manager overrides applied at sign-in.
                  </Alert>

                  <Card withBorder radius="md" p="md">
                    <Stack gap="xs">
                      <Text size="sm" fw={600}>Authorized redirect URI</Text>
                      <Text size="xs" c="dimmed">
                        Verify this is set in your Google Cloud Console → OAuth 2.0 Credentials.
                      </Text>
                      <Group gap="xs" wrap="nowrap">
                        <Code style={{ flex: 1, fontSize: 12 }}>{redirectUri}</Code>
                        <CopyButton value={redirectUri}>
                          {({ copied, copy }) => (
                            <Tooltip label={copied ? "Copied!" : "Copy"} withArrow>
                              <ActionIcon
                                size="sm"
                                variant="light"
                                color={copied ? "green" : "gray"}
                                onClick={copy}
                              >
                                {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </CopyButton>
                      </Group>
                    </Stack>
                  </Card>

                  <Card withBorder radius="md" p="md">
                    <Stack gap="xs">
                      <Text size="sm" fw={600}>Allowed domains</Text>
                      <Group gap="xs">
                        {data.sso.allowedDomains.map((d) => (
                          <Badge key={d} size="sm" variant="light" color="appdirect">
                            @{d}
                          </Badge>
                        ))}
                      </Group>
                      <Text size="xs" c="dimmed">
                        Change via <Code>ALLOWED_EMAIL_DOMAINS</Code> in .env (comma-separated).
                      </Text>
                    </Stack>
                  </Card>
                </Stack>
              ) : (
                /* ── Setup guide ────────────────────────────────────────── */
                <Stack gap="sm">
                  <Alert
                    icon={<IconInfoCircle size={16} />}
                    color="yellow"
                    variant="light"
                    radius="md"
                  >
                    Add <Code>GOOGLE_CLIENT_ID</Code> and <Code>GOOGLE_CLIENT_SECRET</Code> to
                    your <Code>.env</Code> file to enable Google SSO. Users will then sign in
                    with their @appdirect.com Google accounts.
                  </Alert>

                  {/* Steps */}
                  {[
                    {
                      step: "1",
                      title: "Open Google Cloud Console",
                      desc: "Go to console.cloud.google.com and select or create a project.",
                      action: { label: "Open Console", href: "https://console.cloud.google.com" },
                    },
                    {
                      step: "2",
                      title: "Create OAuth 2.0 credentials",
                      desc: 'Navigate to APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID. Choose "Web application".',
                      action: {
                        label: "Open Credentials",
                        href: "https://console.cloud.google.com/apis/credentials",
                      },
                    },
                    {
                      step: "3",
                      title: "Add Authorized JavaScript Origin + Redirect URI",
                      desc: "Two separate fields in Google Cloud Console — copy each one exactly:",
                      twoFields: true,
                    },
                    {
                      step: "4",
                      title: "Copy credentials to .env",
                      desc: "After creating the app, copy your Client ID and Client Secret into your .env file:",
                      code: "GOOGLE_CLIENT_ID=your_client_id_here\nGOOGLE_CLIENT_SECRET=your_client_secret_here",
                    },
                    {
                      step: "5",
                      title: "Restart the dev server",
                      desc: "Run npm run dev — the Sign-in page will switch to Google SSO automatically.",
                      code: "npm run dev",
                    },
                  ].map(({ step, title, desc, code, action, twoFields }: any) => (
                    <Card key={step} withBorder radius="md" p="md">
                      <Group gap="sm" align="flex-start" wrap="nowrap">
                        <ThemeIcon
                          size="md"
                          radius="xl"
                          variant="filled"
                          color="appdirect"
                          style={{ flexShrink: 0, marginTop: 2 }}
                        >
                          <Text size="xs" fw={700}>{step}</Text>
                        </ThemeIcon>
                        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                          <Text size="sm" fw={600}>{title}</Text>
                          <Text size="xs" c="dimmed">{desc}</Text>

                          {/* Step 3 — two separate labelled copy fields */}
                          {twoFields && (
                            <Stack gap={10} mt={4}>
                              <Box>
                                <Group gap={6} mb={4} align="center">
                                  <Text size="xs" fw={600}>Authorized JavaScript Origins</Text>
                                  <Badge size="xs" color="red" variant="light">No path — domain only</Badge>
                                </Group>
                                <Group gap="xs" wrap="nowrap">
                                  <Code style={{ flex: 1, fontSize: 12, padding: "6px 10px" }}>
                                    {window.location.origin}
                                  </Code>
                                  <CopyButton value={window.location.origin}>
                                    {({ copied, copy }) => (
                                      <Tooltip label={copied ? "Copied!" : "Copy"} withArrow>
                                        <ActionIcon size="sm" variant="light" color={copied ? "green" : "gray"} onClick={copy}>
                                          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                                        </ActionIcon>
                                      </Tooltip>
                                    )}
                                  </CopyButton>
                                </Group>
                              </Box>
                              <Box>
                                <Group gap={6} mb={4} align="center">
                                  <Text size="xs" fw={600}>Authorized Redirect URIs</Text>
                                  <Badge size="xs" color="green" variant="light">Includes /api/auth/callback</Badge>
                                </Group>
                                <Group gap="xs" wrap="nowrap">
                                  <Code style={{ flex: 1, fontSize: 12, padding: "6px 10px" }}>
                                    {redirectUri}
                                  </Code>
                                  <CopyButton value={redirectUri}>
                                    {({ copied, copy }) => (
                                      <Tooltip label={copied ? "Copied!" : "Copy"} withArrow>
                                        <ActionIcon size="sm" variant="light" color={copied ? "green" : "gray"} onClick={copy}>
                                          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                                        </ActionIcon>
                                      </Tooltip>
                                    )}
                                  </CopyButton>
                                </Group>
                              </Box>
                            </Stack>
                          )}

                          {code && (
                            <Group gap="xs" wrap="nowrap">
                              <Code block style={{ fontSize: 11, flex: 1, whiteSpace: "pre" }}>
                                {code}
                              </Code>
                              <CopyButton value={code}>
                                {({ copied, copy }) => (
                                  <Tooltip label={copied ? "Copied!" : "Copy"} withArrow>
                                    <ActionIcon
                                      size="sm"
                                      variant="light"
                                      color={copied ? "green" : "gray"}
                                      onClick={copy}
                                      style={{ flexShrink: 0 }}
                                    >
                                      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                                    </ActionIcon>
                                  </Tooltip>
                                )}
                              </CopyButton>
                            </Group>
                          )}
                          {action && (
                            <Box>
                              <Button
                                component="a"
                                href={action.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                size="xs"
                                variant="light"
                                color="appdirect"
                                rightSection={<IconExternalLink size={12} />}
                              >
                                {action.label}
                              </Button>
                            </Box>
                          )}
                        </Stack>
                      </Group>
                    </Card>
                  ))}
                </Stack>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>

      {/* ── Edit Role Modal ───────────────────────────────────────────────── */}
      <Modal
        opened={!!editingMember}
        onClose={() => setEditingMember(null)}
        title={
          <Group gap={8}>
            <ThemeIcon size="sm" radius="md" variant="light" color="red">
              <IconShield size={14} />
            </ThemeIcon>
            <Text fw={600}>Edit Role</Text>
          </Group>
        }
        size="sm"
        centered
      >
        {editingMember && (
          <Stack gap="md">
            {/* Member info */}
            <Group gap="sm" wrap="nowrap">
              <Avatar
                src={editingMember.picture || undefined}
                size={40}
                radius="xl"
                color={ROLE_COLORS[editingMember.role as Role] ?? "gray"}
              >
                {!editingMember.picture && memberInitials(editingMember.name)}
              </Avatar>
              <Box>
                <Text fw={600} size="sm">{editingMember.name}</Text>
                <Text size="xs" c="dimmed">{editingMember.email}</Text>
              </Box>
            </Group>

            <Divider />

            {/* Role picker */}
            <Select
              label="Role"
              description="Changes take effect on the member's next sign-in."
              data={ROLE_OPTIONS}
              value={pendingRole}
              onChange={(v) => v && setPendingRole(v)}
              size="sm"
            />

            {/* Role description */}
            {pendingRole && (
              <Box
                p="xs"
                style={{
                  background: "var(--mantine-color-dark-7)",
                  borderRadius: 6,
                  borderLeft: `3px solid var(--mantine-color-${ROLE_COLORS[pendingRole as Role]}-6)`,
                }}
              >
                <Text size="xs" c="dimmed">
                  {ROLE_DESCRIPTIONS[pendingRole as Role]}
                </Text>
              </Box>
            )}

            {/* Default role note */}
            {pendingRole === editingMember.defaultRole && editingMember.isOverridden && (
              <Alert
                icon={<IconInfoCircle size={14} />}
                color="blue"
                variant="light"
                radius="sm"
                p="xs"
              >
                <Text size="xs">
                  This matches the static default — saving will remove the override.
                </Text>
              </Alert>
            )}

            {saveError && (
              <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light" p="xs">
                {saveError}
              </Alert>
            )}

            <Group justify="space-between">
              <Button
                variant="default"
                size="xs"
                onClick={() => setEditingMember(null)}
                leftSection={<IconX size={12} />}
              >
                Cancel
              </Button>
              <Button
                size="xs"
                color="appdirect"
                loading={saving}
                onClick={saveRole}
                disabled={pendingRole === editingMember.role && !editingMember.isOverridden}
                leftSection={<IconCheck size={12} />}
              >
                Save role
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </WidgetFrame>
  );
}
