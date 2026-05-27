import { useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconChevronDown,
  IconLogin,
  IconLogout,
  IconUser,
  IconSwitch,
  IconArrowBack,
} from "@tabler/icons-react";
import { useIdentity, type Identity } from "../lib/identity";
import { BrandLogo } from "./BrandLogo";
import {
  ROLES,
  ROLE_COLORS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_SHORT_LABELS,
  type Role,
} from "../lib/roles";
import { NOC_ROSTER } from "../lib/roster";

// ── Impersonation helpers ─────────────────────────────────────────────────────
const IMPERSONATE_KEY = "noc_impersonate_original";

function saveOriginalManager(name: string) {
  localStorage.setItem(IMPERSONATE_KEY, name);
}
function getOriginalManager(): string | null {
  return localStorage.getItem(IMPERSONATE_KEY);
}
function clearOriginalManager() {
  localStorage.removeItem(IMPERSONATE_KEY);
}

/* -------------------------------------------------------------------------- */
/*                           Header IdentityBadge                             */
/* -------------------------------------------------------------------------- */

export function IdentityBadge() {
  const { identity, loading, devSignIn, impersonate, signOut, setRole } = useIdentity();
  const [opened, setOpened] = useState(false);

  const originalManager = getOriginalManager();
  const isImpersonating = !!originalManager && identity?.name !== originalManager;

  async function returnToManager() {
    if (!originalManager) return;
    clearOriginalManager();
    impersonate(originalManager);
    setOpened(false);
  }

  if (loading) {
    return <Loader size="xs" color="appdirect" />;
  }

  if (!identity) {
    return (
      <>
        <Button
          size="xs"
          variant="light"
          color="appdirect"
          leftSection={<IconLogin size={14} />}
          onClick={() => setOpened(true)}
          aria-label="Sign in"
          className="dashboard-status-pulse"
          styles={{ root: { fontWeight: 600 } }}
        >
          Sign in
        </Button>
        <DevSignInModal
          opened={opened}
          onClose={() => setOpened(false)}
          devSignIn={devSignIn}
        />
      </>
    );
  }

  return (
    <>
      {/* Impersonation banner — shown when a manager is viewing as someone else */}
      {isImpersonating && (
        <Button
          size="xs"
          variant="filled"
          color="orange"
          leftSection={<IconArrowBack size={12} />}
          onClick={returnToManager}
          styles={{ root: { fontWeight: 700 } }}
        >
          Return to {originalManager}
        </Button>
      )}

      <Tooltip label={isImpersonating ? `Viewing as ${identity.name} (manager impersonation)` : "Manage account"}>
        <Box
          role="button"
          tabIndex={0}
          onClick={() => setOpened(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpened(true);
            }
          }}
          style={{
            cursor: "pointer",
            background: isImpersonating ? "var(--mantine-color-orange-9)" : "var(--mantine-color-dark-6)",
            border: `1px solid ${isImpersonating ? "var(--mantine-color-orange-6)" : "var(--mantine-color-dark-4)"}`,
            borderRadius: 8,
            padding: "4px 8px 4px 4px",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            transition: "border-color 120ms",
          }}
          className="identity-badge-pill"
        >
          {identity.picture ? (
            <Avatar src={identity.picture} size={22} radius="xl" />
          ) : (
            <ThemeIcon
              size="sm"
              radius="xl"
              variant="light"
              color={isImpersonating ? "orange" : ROLE_COLORS[identity.role]}
            >
              {isImpersonating ? <IconSwitch size={12} /> : <IconUser size={12} />}
            </ThemeIcon>
          )}
          <Text size="xs" fw={600} style={{ lineHeight: 1, letterSpacing: "-0.01em" }}>
            {identity.name}
          </Text>
          <Badge
            size="xs"
            variant="filled"
            color={isImpersonating ? "orange" : ROLE_COLORS[identity.role]}
            radius="sm"
          >
            {isImpersonating ? "As" : ROLE_SHORT_LABELS[identity.role]}
          </Badge>
          <IconChevronDown size={12} style={{ opacity: 0.6 }} />
        </Box>
      </Tooltip>

      <AccountModal
        opened={opened}
        onClose={() => setOpened(false)}
        identity={identity}
        setRole={setRole}
        isImpersonating={isImpersonating}
        originalManager={originalManager}
        impersonate={impersonate}
        signOut={async () => {
          clearOriginalManager();
          await signOut();
          setOpened(false);
        }}
        returnToManager={returnToManager}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                       Dev-mode name picker modal                           */
/* -------------------------------------------------------------------------- */

function DevSignInModal({
  opened,
  onClose,
  devSignIn,
}: {
  opened: boolean;
  onClose: () => void;
  devSignIn: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name) return;
    setBusy(true);
    try {
      await devSignIn(name);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={8}>
          <ThemeIcon size="sm" radius="md" variant="light" color="appdirect">
            <IconUser size={14} />
          </ThemeIcon>
          <Text fw={600}>Sign in</Text>
        </Group>
      }
      size="sm"
      centered
    >
      <Stack gap="md">
        <Select
          label="Pick your name"
          placeholder="Select from NOC roster"
          data={NOC_ROSTER}
          value={name}
          onChange={setName}
          searchable
          size="sm"
        />

        <Button
          color="appdirect"
          loading={busy}
          disabled={!name}
          onClick={submit}
          leftSection={<IconLogin size={14} />}
          fullWidth
        >
          Sign in as {name || "…"}
        </Button>
      </Stack>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*                           Account / role modal                             */
/* -------------------------------------------------------------------------- */

function AccountModal({
  opened,
  onClose,
  identity,
  setRole,
  signOut,
  isImpersonating,
  originalManager,
  impersonate,
  returnToManager,
}: {
  opened: boolean;
  onClose: () => void;
  identity: Identity;
  setRole: (role: Role) => void;
  signOut: () => Promise<void>;
  isImpersonating: boolean;
  originalManager: string | null;
  impersonate: (name: string) => void;
  returnToManager: () => Promise<void>;
}) {
  const [role, setLocalRole] = useState<Role>(identity.role);
  const [impersonateTarget, setImpersonateTarget] = useState<string | null>(null);

  function handleImpersonate() {
    if (!impersonateTarget) return;
    // Save manager name before first switch
    if (!isImpersonating) {
      saveOriginalManager(identity.name);
    }
    impersonate(impersonateTarget);
    setImpersonateTarget(null);
    onClose();
  }

  function save() {
    if (role !== identity.role) setRole(role);
    onClose();
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={8}>
          <ThemeIcon size="sm" radius="md" variant="light" color="appdirect">
            <IconUser size={14} />
          </ThemeIcon>
          <Text fw={600}>Account & Role</Text>
        </Group>
      }
      size="md"
      centered
    >
      <Stack gap="md">
        {/* User info card */}
        <Box
          p="sm"
          style={{
            border: "1px solid var(--mantine-color-dark-4)",
            borderRadius: 10,
            background: "var(--mantine-color-dark-7)",
          }}
        >
          <Group gap="sm" wrap="nowrap">
            {identity.picture ? (
              <Avatar src={identity.picture} size={42} radius="xl" />
            ) : (
              <ThemeIcon
                size={42}
                radius="xl"
                variant="light"
                color={ROLE_COLORS[identity.role]}
              >
                <IconUser size={20} />
              </ThemeIcon>
            )}
            <Box style={{ minWidth: 0, flex: 1 }}>
              <Text fw={600} size="sm" truncate>
                {identity.name}
              </Text>
              {identity.email && (
                <Text size="xs" c="dimmed" truncate>
                  {identity.email}
                </Text>
              )}
            </Box>
            <Badge color={ROLE_COLORS[identity.role]} variant="light">
              {ROLE_SHORT_LABELS[identity.role]}
            </Badge>
          </Group>
        </Box>

        {/* Impersonation banner inside modal */}
        {isImpersonating && (
          <Alert
            color="orange"
            variant="light"
            radius="md"
            icon={<IconSwitch size={16} />}
            title={`Viewing as ${identity.name}`}
          >
            <Stack gap={6}>
              <Text size="xs">
                You are currently logged in as <b>{identity.name}</b> on behalf of manager <b>{originalManager}</b>.
              </Text>
              <Button
                size="xs"
                color="orange"
                variant="filled"
                leftSection={<IconArrowBack size={12} />}
                onClick={() => returnToManager()}
              >
                Return to {originalManager}
              </Button>
            </Stack>
          </Alert>
        )}

        {/* Login As — managers only */}
        {(identity.role === "manager" || !!originalManager) && (
          <Box>
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={6}>
              Login as team member
            </Text>
            <Stack gap="xs">
              <Select
                placeholder="Select a team member…"
                data={NOC_ROSTER.filter((n) => n !== (originalManager ?? identity.name))}
                value={impersonateTarget}
                onChange={setImpersonateTarget}
                searchable
                clearable
                size="sm"
                leftSection={<IconSwitch size={14} />}
              />
              <Button
                size="xs"
                color="orange"
                variant="light"
                leftSection={<IconSwitch size={13} />}
                disabled={!impersonateTarget}
                onClick={handleImpersonate}
              >
                Login as {impersonateTarget ?? "…"}
              </Button>
            </Stack>
          </Box>
        )}

        <Divider />

        {/* Role display — managers can switch for demo; techs see read-only badge */}
        {identity.role === "manager" ? (
          <Box>
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={6}>
              Role override (manager only)
            </Text>
            <SegmentedControl
              fullWidth
              value={role}
              onChange={(v) => setLocalRole(v as Role)}
              data={ROLES.map((r) => ({
                label: ROLE_SHORT_LABELS[r],
                value: r,
              }))}
              size="sm"
            />
            <Box
              mt={8}
              p="xs"
              style={{
                background: "var(--mantine-color-dark-7)",
                borderRadius: 6,
                borderLeft: `3px solid var(--mantine-color-${ROLE_COLORS[role]}-6)`,
              }}
            >
              <Text size="xs" c="dimmed">
                {ROLE_DESCRIPTIONS[role]}
              </Text>
            </Box>
          </Box>
        ) : (
          <Box
            p="xs"
            style={{
              background: "var(--mantine-color-dark-7)",
              borderRadius: 8,
              borderLeft: `3px solid var(--mantine-color-${ROLE_COLORS[identity.role]}-6)`,
            }}
          >
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>
              Access Level
            </Text>
            <Group gap="xs">
              <Badge color={ROLE_COLORS[identity.role]} variant="light" size="sm">
                {ROLE_LABELS[identity.role]}
              </Badge>
              <Text size="xs" c="dimmed">
                {ROLE_DESCRIPTIONS[identity.role]}
              </Text>
            </Group>
          </Box>
        )}

        <Divider />

        {/* Actions */}
        <Group justify="space-between">
          <Button
            variant="subtle"
            color="red"
            size="xs"
            leftSection={<IconLogout size={12} />}
            onClick={signOut}
          >
            Sign out
          </Button>
          <Group gap="xs">
            <Button variant="default" size="xs" onClick={onClose}>
              Close
            </Button>
            {identity.role === "manager" && (
              <Button size="xs" color="appdirect" onClick={save}>
                Save
              </Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*                       Welcome card (above tile grid)                       */
/* -------------------------------------------------------------------------- */

export function IdentityWelcomeCard() {
  const { identity, loading, devSignIn } = useIdentity();
  const [devModalOpened, setDevModalOpened] = useState(false);

  if (loading || identity) return null;

  return (
    <Box
      mb="lg"
      p="lg"
      style={{
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--mantine-color-appdirect-6) 10%, var(--widget-tile-surface)) 0%, var(--widget-tile-surface) 100%)",
        border:
          "1px solid color-mix(in srgb, var(--mantine-color-appdirect-6) 35%, var(--widget-tile-border))",
        borderRadius: 16,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <Box
        style={{
          position: "absolute",
          top: -40,
          right: -40,
          width: 180,
          height: 180,
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--mantine-color-appdirect-6) 22%, transparent), transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <Stack gap="md" style={{ position: "relative" }}>
        <Group gap="md" wrap="nowrap">
          <BrandLogo size={44} />
          <Box style={{ minWidth: 0 }}>
            <Text fw={600} size="md" style={{ letterSpacing: "-0.01em" }}>
              Welcome to the vCom NOC Operations Dashboard
            </Text>
            <Text size="xs" c="dimmed">
              Pick your name from the NOC roster to access your tools.
            </Text>
          </Box>
        </Group>

        <Group gap="xs">
          <Button
            color="appdirect"
            leftSection={<IconLogin size={14} />}
            onClick={() => setDevModalOpened(true)}
          >
            Sign in
          </Button>
          <DevSignInModal
            opened={devModalOpened}
            onClose={() => setDevModalOpened(false)}
            devSignIn={devSignIn}
          />
        </Group>
      </Stack>
    </Box>
  );
}
