import { useState, useEffect, type FormEvent } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Modal,
  PasswordInput,
  SegmentedControl,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconClipboardCopy,
  IconInfoCircle,
  IconKey,
  IconLock,
  IconLogin,
  IconLogout,
  IconMailForward,
  IconShieldCheck,
  IconUser,
  IconUserPlus,
  IconX,
} from "@tabler/icons-react";
import { useIdentity, type Identity } from "../lib/identity";
import { BrandLogo } from "./BrandLogo";
import {
  hasAnyUsers,
  isManagerRole,
  listResetRequests,
  markResetResolved,
  PASSWORD_RULES,
  resetPasswordByManager,
  validatePassword,
  type PasswordResetRequest,
  type SubmitResetInput,
} from "../lib/auth";
import {
  ROLES,
  ROLE_COLORS,
  ROLE_DESCRIPTIONS,
  ROLE_SHORT_LABELS,
  defaultRoleFor,
  type Role,
} from "../lib/roles";
import { NOC_ROSTER } from "../lib/roster";

/**
 * Header badge showing the active identity + role.
 *   - When no identity: a pulsing "Sign in" button.
 *   - When identity set: avatar + name + role pill, click to manage.
 */
export function IdentityBadge() {
  const {
    identity,
    signIn,
    signUp,
    setRole,
    clearIdentity,
    submitResetRequest,
    pendingResetCount,
    refreshResetRequests,
  } = useIdentity();
  const [opened, setOpened] = useState(false);

  // Surface pending reset requests to managers only — other roles
  // ignore them (and can't act on them anyway).
  const showPendingBadge =
    isManagerRole(identity?.role) && pendingResetCount > 0;

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
        <IdentityModal
          opened={opened}
          onClose={() => setOpened(false)}
          identity={identity}
          signIn={signIn}
          signUp={signUp}
          setRole={setRole}
          clearIdentity={clearIdentity}
          submitResetRequest={submitResetRequest}
          refreshResetRequests={refreshResetRequests}
        />
      </>
    );
  }

  return (
    <>
      <Tooltip
        label={
          showPendingBadge
            ? `${pendingResetCount} pending password reset${pendingResetCount === 1 ? "" : "s"}`
            : "Manage account"
        }
      >
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
            background: "var(--mantine-color-dark-6)",
            border: showPendingBadge
              ? "1px solid var(--mantine-color-red-7)"
              : "1px solid var(--mantine-color-dark-4)",
            borderRadius: 8,
            padding: "4px 8px 4px 4px",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            transition: "border-color 120ms",
            position: "relative",
          }}
          className="identity-badge-pill"
        >
          <ThemeIcon
            size="sm"
            radius="xl"
            variant="light"
            color={ROLE_COLORS[identity.role]}
          >
            <IconUser size={12} />
          </ThemeIcon>
          <Text
            size="xs"
            fw={600}
            style={{ lineHeight: 1, letterSpacing: "-0.01em" }}
          >
            {identity.name}
          </Text>
          <Badge
            size="xs"
            variant="filled"
            color={ROLE_COLORS[identity.role]}
            radius="sm"
          >
            {ROLE_SHORT_LABELS[identity.role]}
          </Badge>
          {showPendingBadge && (
            <Badge
              size="xs"
              color="red"
              variant="filled"
              circle
              style={{ minWidth: 18, height: 18, padding: 0 }}
              aria-label={`${pendingResetCount} pending password reset requests`}
            >
              {pendingResetCount}
            </Badge>
          )}
          <IconChevronDown size={12} style={{ opacity: 0.6 }} />
        </Box>
      </Tooltip>
      <IdentityModal
        opened={opened}
        onClose={() => setOpened(false)}
        identity={identity}
        signIn={signIn}
        signUp={signUp}
        setRole={setRole}
        clearIdentity={clearIdentity}
        submitResetRequest={submitResetRequest}
        refreshResetRequests={refreshResetRequests}
      />
    </>
  );
}

interface ModalProps {
  opened: boolean;
  onClose: () => void;
  identity: Identity | null;
  signIn: (username: string, password: string) => Promise<Identity>;
  signUp: (input: {
    username: string;
    password: string;
    displayName?: string;
    role?: Role;
  }) => Promise<Identity>;
  setRole: (role: Role) => void;
  clearIdentity: () => void;
  submitResetRequest: (input: SubmitResetInput) => PasswordResetRequest;
  refreshResetRequests: () => void;
}

function IdentityModal({
  opened,
  onClose,
  identity,
  signIn,
  signUp,
  setRole,
  clearIdentity,
  submitResetRequest,
  refreshResetRequests,
}: ModalProps) {
  // View modes when signed out: "signin" | "signup" | "forgot".
  // (When signed in we render the AccountPanel instead.)
  const [view, setView] = useState<"signin" | "signup" | "forgot">("signin");

  useEffect(() => {
    if (opened) {
      // If no accounts exist on this browser yet, default to Sign Up so
      // first-time visitors don't get stuck.
      setView(identity ? "signin" : hasAnyUsers() ? "signin" : "signup");
    }
  }, [opened, identity]);

  const titleText = identity
    ? "Account & role"
    : view === "forgot"
      ? "Reset password"
      : "Sign in";

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={8}>
          <ThemeIcon size="sm" radius="md" variant="light" color="appdirect">
            <IconUser size={14} />
          </ThemeIcon>
          <Text fw={600}>{titleText}</Text>
        </Group>
      }
      size="md"
      centered
    >
      {identity ? (
        <AccountPanel
          identity={identity}
          setRole={setRole}
          clearIdentity={() => {
            clearIdentity();
            onClose();
          }}
          onClose={onClose}
          refreshResetRequests={refreshResetRequests}
        />
      ) : view === "forgot" ? (
        <ForgotPasswordForm
          submitResetRequest={submitResetRequest}
          backToSignIn={() => setView("signin")}
        />
      ) : (
        <Tabs
          value={view}
          onChange={(v) => v && setView(v as "signin" | "signup")}
          variant="pills"
          radius="md"
        >
          <Tabs.List grow mb="md">
            <Tabs.Tab value="signin" leftSection={<IconLogin size={14} />}>
              Sign in
            </Tabs.Tab>
            <Tabs.Tab value="signup" leftSection={<IconUserPlus size={14} />}>
              Create account
            </Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="signin">
            <SignInForm
              signIn={signIn}
              onSuccess={onClose}
              switchToSignUp={() => setView("signup")}
              switchToForgot={() => setView("forgot")}
            />
          </Tabs.Panel>
          <Tabs.Panel value="signup">
            <SignUpForm
              signUp={signUp}
              onSuccess={onClose}
              switchToSignIn={() => setView("signin")}
            />
          </Tabs.Panel>
        </Tabs>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 Sign In                                    */
/* -------------------------------------------------------------------------- */

function SignInForm({
  signIn,
  onSuccess,
  switchToSignUp,
  switchToForgot,
}: {
  signIn: (username: string, password: string) => Promise<Identity>;
  onSuccess: () => void;
  switchToSignUp: () => void;
  switchToForgot: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setBusy(true);
    try {
      await signIn(username, password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <TextInput
          label="Username"
          placeholder="your.username"
          value={username}
          onChange={(e) => setUsername(e.currentTarget.value)}
          leftSection={<IconUser size={14} />}
          autoComplete="username"
          autoFocus
          size="sm"
          required
        />
        <PasswordInput
          label="Password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          leftSection={<IconLock size={14} />}
          autoComplete="current-password"
          size="sm"
          required
        />
        <Group justify="flex-end" gap={4} mt={-6}>
          <Button
            variant="subtle"
            size="compact-xs"
            color="appdirect"
            onClick={switchToForgot}
            type="button"
            leftSection={<IconKey size={11} />}
          >
            Forgot password?
          </Button>
        </Group>
        {error && (
          <Alert
            color="red"
            variant="light"
            icon={<IconInfoCircle size={14} />}
          >
            {error}
          </Alert>
        )}
        <Button
          type="submit"
          color="appdirect"
          loading={busy}
          leftSection={<IconLogin size={14} />}
          fullWidth
        >
          Sign in
        </Button>
        <Divider
          label={
            <Text size="xs" c="dimmed">
              New here?
            </Text>
          }
          labelPosition="center"
        />
        <Button variant="subtle" size="xs" onClick={switchToSignUp}>
          Create an account
        </Button>
      </Stack>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/*                            Password checklist                              */
/* -------------------------------------------------------------------------- */

function PasswordChecklist({ password }: { password: string }) {
  return (
    <Box
      p="xs"
      style={{
        background: "var(--mantine-color-dark-7)",
        border: "1px solid var(--mantine-color-dark-5)",
        borderRadius: 6,
      }}
    >
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={6}>
        Password must contain
      </Text>
      <Stack gap={4}>
        {PASSWORD_RULES.map((rule) => {
          const ok = rule.test(password);
          return (
            <Group key={rule.label} gap={6} wrap="nowrap">
              <ThemeIcon
                size={14}
                radius="xl"
                variant="light"
                color={ok ? "teal" : "gray"}
              >
                {ok ? <IconCheck size={10} /> : <IconX size={10} />}
              </ThemeIcon>
              <Text
                size="xs"
                c={ok ? "teal.4" : "dimmed"}
                style={{ lineHeight: 1.3 }}
              >
                {rule.label}
              </Text>
            </Group>
          );
        })}
      </Stack>
    </Box>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 Sign Up                                    */
/* -------------------------------------------------------------------------- */

function SignUpForm({
  signUp,
  onSuccess,
  switchToSignIn,
}: {
  signUp: (input: {
    username: string;
    password: string;
    displayName?: string;
    role?: Role;
  }) => Promise<Identity>;
  onSuccess: () => void;
  switchToSignIn: () => void;
}) {
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setLocalRole] = useState<Role>("tier1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function handleDisplayName(value: string | null) {
    setDisplayName(value);
    if (value) {
      // Auto-derive a sensible username from the roster name and
      // auto-pick the default role.
      const derived = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ".")
        .replace(/^\.|\.$/g, "");
      setUsername(derived);
      setLocalRole(defaultRoleFor(value));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!displayName) {
      setError("Pick your name from the NOC roster.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await signUp({ username, password, displayName, role });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <Select
          label="Your name"
          description="Pick your name from the NOC roster."
          placeholder="Select your name"
          data={NOC_ROSTER}
          value={displayName}
          onChange={handleDisplayName}
          searchable
          size="sm"
          required
        />
        <TextInput
          label="Username"
          description="Letters, numbers, '.', '_' and '-'. Used to sign in."
          placeholder="your.username"
          value={username}
          onChange={(e) =>
            setUsername(
              e.currentTarget.value.toLowerCase().replace(/\s+/g, ""),
            )
          }
          leftSection={<IconUser size={14} />}
          autoComplete="username"
          size="sm"
          required
        />
        <PasswordInput
          label="Password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          leftSection={<IconLock size={14} />}
          autoComplete="new-password"
          size="sm"
          required
        />
        <PasswordChecklist password={password} />
        <PasswordInput
          label="Confirm password"
          placeholder="••••••••"
          value={confirm}
          onChange={(e) => setConfirm(e.currentTarget.value)}
          leftSection={<IconLock size={14} />}
          autoComplete="new-password"
          size="sm"
          required
        />
        <Box>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={6}>
            Role
          </Text>
          <SegmentedControl
            fullWidth
            value={role}
            onChange={(v) => setLocalRole(v as Role)}
            data={ROLES.map((r) => ({
              label: ROLE_SHORT_LABELS[r],
              value: r,
            }))}
            size="xs"
          />
          <Box
            mt={6}
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
        {error && (
          <Alert
            color="red"
            variant="light"
            icon={<IconInfoCircle size={14} />}
          >
            {error}
          </Alert>
        )}
        <Button
          type="submit"
          color="appdirect"
          loading={busy}
          leftSection={<IconUserPlus size={14} />}
          fullWidth
        >
          Create account & sign in
        </Button>
        <Divider
          label={
            <Text size="xs" c="dimmed">
              Already have an account?
            </Text>
          }
          labelPosition="center"
        />
        <Button variant="subtle" size="xs" onClick={switchToSignIn}>
          Sign in instead
        </Button>
      </Stack>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/*                       Forgot-password request form                         */
/* -------------------------------------------------------------------------- */

/**
 * Submitted by a locked-out user (no backend → request lives in
 * localStorage). A signed-in manager can then triage it from their
 * account panel. We deliberately do NOT verify whether the username
 * exists, so the form can't be used to enumerate accounts.
 */
function ForgotPasswordForm({
  submitResetRequest,
  backToSignIn,
}: {
  submitResetRequest: (input: SubmitResetInput) => PasswordResetRequest;
  backToSignIn: () => void;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [contact, setContact] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function handleNamePick(value: string | null) {
    setDisplayName(value);
    if (value && !username) {
      const derived = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ".")
        .replace(/^\.|\.$/g, "");
      setUsername(derived);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!displayName) {
      setError("Pick your name from the roster.");
      return;
    }
    setBusy(true);
    try {
      submitResetRequest({
        username,
        displayName,
        contact,
        reason,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit request.");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <Stack gap="md">
        <Alert
          color="teal"
          variant="light"
          icon={<IconCheck size={16} />}
          title="Request sent to a manager"
        >
          A manager will review your request and issue a temporary password.
          They'll reach out at the contact you provided.
        </Alert>
        <Group justify="flex-end">
          <Button
            variant="default"
            size="xs"
            onClick={backToSignIn}
            leftSection={<IconLogin size={12} />}
          >
            Back to sign in
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <Alert
          color="appdirect"
          variant="light"
          icon={<IconKey size={16} />}
          title="Forgot your password?"
        >
          Fill out the form below and a manager will issue a temporary
          password. You'll be able to change it after signing in.
        </Alert>
        <Select
          label="Your name"
          description="Pick your name from the NOC roster."
          placeholder="Select your name"
          data={NOC_ROSTER}
          value={displayName}
          onChange={handleNamePick}
          searchable
          size="sm"
          required
        />
        <TextInput
          label="Username"
          description="The username you can't sign in to."
          placeholder="your.username"
          value={username}
          onChange={(e) =>
            setUsername(
              e.currentTarget.value.toLowerCase().replace(/\s+/g, ""),
            )
          }
          leftSection={<IconUser size={14} />}
          size="sm"
          required
        />
        <TextInput
          label="Email or other contact"
          description="How a manager can reach you (work email, Slack, phone)."
          placeholder="you@appdirect.com"
          value={contact}
          onChange={(e) => setContact(e.currentTarget.value)}
          leftSection={<IconMailForward size={14} />}
          size="sm"
          required
        />
        <TextInput
          label="Reason (optional)"
          placeholder="Forgot my password / phone got reset / …"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          size="sm"
        />
        {error && (
          <Alert color="red" variant="light" icon={<IconInfoCircle size={14} />}>
            {error}
          </Alert>
        )}
        <Group justify="space-between">
          <Button variant="default" size="xs" onClick={backToSignIn} type="button">
            Cancel
          </Button>
          <Button
            type="submit"
            color="appdirect"
            loading={busy}
            leftSection={<IconMailForward size={14} />}
          >
            Send to manager
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/*                Manager: review pending password reset requests             */
/* -------------------------------------------------------------------------- */

function ManagerResetRequestsPanel({
  managerUsername,
  refresh,
}: {
  managerUsername: string;
  refresh: () => void;
}) {
  const [requests, setRequests] = useState<PasswordResetRequest[]>(() =>
    listResetRequests(),
  );

  function reload() {
    setRequests(listResetRequests());
    refresh();
  }

  const pending = requests.filter((r) => r.status === "pending");
  const handled = requests.filter((r) => r.status !== "pending").slice(0, 4);

  return (
    <Box>
      <Group gap={6} mb={6} align="center">
        <ThemeIcon size="sm" radius="md" variant="light" color="orange">
          <IconKey size={12} />
        </ThemeIcon>
        <Text size="xs" fw={600} c="dimmed" tt="uppercase">
          Password reset requests
        </Text>
        {pending.length > 0 && (
          <Badge size="xs" color="red" variant="filled">
            {pending.length} pending
          </Badge>
        )}
      </Group>

      {pending.length === 0 && handled.length === 0 && (
        <Text size="xs" c="dimmed">
          No requests yet. When a teammate uses "Forgot password?" on the
          sign-in screen, their request will appear here.
        </Text>
      )}

      <Stack gap="xs">
        {pending.map((req) => (
          <PendingRequestCard
            key={req.id}
            request={req}
            managerUsername={managerUsername}
            onChange={reload}
          />
        ))}
        {handled.length > 0 && (
          <Box mt="xs">
            <Text size="xs" c="dimmed" mb={4}>
              Recently handled
            </Text>
            <Stack gap={6}>
              {handled.map((req) => (
                <Box
                  key={req.id}
                  p="xs"
                  style={{
                    border: "1px solid var(--mantine-color-dark-5)",
                    borderRadius: 8,
                    background: "var(--mantine-color-dark-7)",
                    opacity: 0.75,
                  }}
                >
                  <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Box style={{ minWidth: 0 }}>
                      <Text size="xs" fw={600} truncate>
                        {req.displayName}{" "}
                        <Text component="span" size="xs" c="dimmed">
                          @{req.username}
                        </Text>
                      </Text>
                      <Text size="xs" c="dimmed">
                        {req.status === "resolved" ? "Reset" : "Denied"} by{" "}
                        {req.resolvedBy ?? "—"} ·{" "}
                        {req.resolvedAt
                          ? new Date(req.resolvedAt).toLocaleString()
                          : ""}
                      </Text>
                    </Box>
                    <Badge
                      size="xs"
                      color={req.status === "resolved" ? "teal" : "gray"}
                      variant="light"
                    >
                      {req.status === "resolved" ? "Reset" : "Denied"}
                    </Badge>
                  </Group>
                </Box>
              ))}
            </Stack>
          </Box>
        )}
      </Stack>
    </Box>
  );
}

function PendingRequestCard({
  request,
  managerUsername,
  onChange,
}: {
  request: PasswordResetRequest;
  managerUsername: string;
  onChange: () => void;
}) {
  const [resetting, setResetting] = useState(false);
  const [newPwd, setNewPwd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);

  async function doReset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const pwError = validatePassword(newPwd);
    if (pwError) {
      setError(pwError);
      return;
    }
    setBusy(true);
    try {
      await resetPasswordByManager({
        username: request.username,
        newPassword: newPwd,
        managerUsername,
        requestId: request.id,
        note: "Temporary password issued via dashboard.",
      });
      setIssued(newPwd);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset password.");
    } finally {
      setBusy(false);
    }
  }

  function deny() {
    markResetResolved(
      request.id,
      "denied",
      managerUsername,
      "Denied by manager.",
    );
    onChange();
  }

  function copyPwd() {
    if (!issued) return;
    navigator.clipboard?.writeText(issued).catch(() => {
      /* ignore — older browser */
    });
  }

  const contactIsEmail = /@/.test(request.contact);

  return (
    <Box
      p="sm"
      style={{
        border: "1px solid var(--mantine-color-orange-9)",
        borderRadius: 10,
        background: "var(--mantine-color-dark-7)",
      }}
    >
      <Group justify="space-between" gap="xs" wrap="nowrap" align="flex-start">
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} align="center">
            <Text size="sm" fw={600} truncate>
              {request.displayName}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              @{request.username}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            Submitted {new Date(request.requestedAt).toLocaleString()}
          </Text>
          <Group gap={4} mt={4} wrap="wrap">
            <Badge
              size="xs"
              variant="light"
              color="appdirect"
              leftSection={<IconMailForward size={9} />}
            >
              {contactIsEmail ? (
                <Text
                  component="a"
                  href={`mailto:${request.contact}?subject=NOC Dashboard password reset`}
                  size="xs"
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  {request.contact}
                </Text>
              ) : (
                request.contact
              )}
            </Badge>
          </Group>
          {request.reason && (
            <Text size="xs" c="dimmed" mt={4} style={{ fontStyle: "italic" }}>
              "{request.reason}"
            </Text>
          )}
        </Box>
        <Badge size="xs" color="orange" variant="filled">
          Pending
        </Badge>
      </Group>

      {issued ? (
        <Alert
          mt="sm"
          color="teal"
          variant="light"
          icon={<IconShieldCheck size={16} />}
          title="Temporary password issued"
        >
          <Stack gap={6}>
            <Text size="xs">
              Share this temporary password with {request.displayName} via{" "}
              {request.contact}. Ask them to sign in and change it from the
              account panel.
            </Text>
            <Group gap="xs">
              <Text
                size="sm"
                fw={700}
                style={{
                  fontFamily: "var(--mantine-font-family-monospace)",
                  letterSpacing: "0.04em",
                  background: "var(--mantine-color-dark-9)",
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--mantine-color-dark-4)",
                }}
              >
                {issued}
              </Text>
              <Button
                size="compact-xs"
                variant="default"
                leftSection={<IconClipboardCopy size={11} />}
                onClick={copyPwd}
              >
                Copy
              </Button>
            </Group>
          </Stack>
        </Alert>
      ) : resetting ? (
        <form onSubmit={doReset}>
          <Stack gap="xs" mt="sm">
            <PasswordInput
              label="Temporary password"
              placeholder="At least 8 chars, with mixed case, number, symbol"
              value={newPwd}
              onChange={(e) => setNewPwd(e.currentTarget.value)}
              leftSection={<IconLock size={14} />}
              size="sm"
              required
            />
            <PasswordChecklist password={newPwd} />
            {error && (
              <Alert
                color="red"
                variant="light"
                icon={<IconAlertTriangle size={14} />}
              >
                {error}
              </Alert>
            )}
            <Group justify="flex-end" gap="xs">
              <Button
                size="xs"
                variant="default"
                onClick={() => {
                  setResetting(false);
                  setNewPwd("");
                  setError(null);
                }}
                type="button"
              >
                Cancel
              </Button>
              <Button
                size="xs"
                color="teal"
                loading={busy}
                type="submit"
                leftSection={<IconShieldCheck size={12} />}
              >
                Issue password
              </Button>
            </Group>
          </Stack>
        </form>
      ) : (
        <Group mt="sm" gap="xs" justify="flex-end">
          <Button
            size="xs"
            variant="subtle"
            color="red"
            leftSection={<IconX size={12} />}
            onClick={deny}
          >
            Deny
          </Button>
          <Button
            size="xs"
            color="teal"
            leftSection={<IconKey size={12} />}
            onClick={() => setResetting(true)}
          >
            Issue temporary password
          </Button>
        </Group>
      )}
    </Box>
  );
}

/* -------------------------------------------------------------------------- */
/*                          Logged-in account panel                           */
/* -------------------------------------------------------------------------- */

function AccountPanel({
  identity,
  setRole,
  clearIdentity,
  onClose,
  refreshResetRequests,
}: {
  identity: Identity;
  setRole: (role: Role) => void;
  clearIdentity: () => void;
  onClose: () => void;
  refreshResetRequests: () => void;
}) {
  const [role, setLocalRole] = useState<Role>(identity.role);
  const isManager = isManagerRole(identity.role);

  function save() {
    if (role !== identity.role) setRole(role);
    onClose();
  }

  return (
    <Stack gap="md">
      <Box
        p="sm"
        style={{
          border: "1px solid var(--mantine-color-dark-4)",
          borderRadius: 10,
          background: "var(--mantine-color-dark-7)",
        }}
      >
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon
            size={42}
            radius="xl"
            variant="light"
            color={ROLE_COLORS[identity.role]}
          >
            <IconUser size={20} />
          </ThemeIcon>
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Text fw={600} size="sm" truncate>
              {identity.name}
            </Text>
            {identity.username && (
              <Text size="xs" c="dimmed" truncate>
                @{identity.username}
              </Text>
            )}
          </Box>
          <Badge color={ROLE_COLORS[identity.role]} variant="light">
            {ROLE_SHORT_LABELS[identity.role]}
          </Badge>
        </Group>
      </Box>

      <Box>
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={6}>
          Change role
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

      {isManager && (
        <>
          <Divider />
          <ManagerResetRequestsPanel
            managerUsername={identity.username ?? identity.name}
            refresh={refreshResetRequests}
          />
        </>
      )}

      <Group justify="space-between" mt="xs">
        <Button
          variant="subtle"
          color="red"
          size="xs"
          leftSection={<IconLogout size={12} />}
          onClick={clearIdentity}
        >
          Sign out
        </Button>
        <Group gap="xs">
          <Button variant="default" size="xs" onClick={onClose}>
            Cancel
          </Button>
          <Button size="xs" color="appdirect" onClick={save}>
            Save
          </Button>
        </Group>
      </Group>
    </Stack>
  );
}

/* -------------------------------------------------------------------------- */
/*                       Welcome card (above tile grid)                       */
/* -------------------------------------------------------------------------- */

/**
 * Small alert/callout shown above the tile grid when no identity is set.
 * Encourages the user to sign in / sign up. Renders nothing once an
 * identity is active.
 */
export function IdentityWelcomeCard() {
  const {
    identity,
    signIn,
    signUp,
    setRole,
    clearIdentity,
    submitResetRequest,
    refreshResetRequests,
  } = useIdentity();
  const [opened, setOpened] = useState(false);

  if (identity) return null;

  const accountsExist = hasAnyUsers();

  return (
    <Box
      mb="lg"
      p="lg"
      style={{
        // Theme-aware: real surface color, not a low-opacity gradient
        // (otherwise the page tint bleeds through and on dark backgrounds
        // we get a washed-out card that swallows text).
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
              {accountsExist
                ? "Sign in with your username and password to unlock your tools."
                : "Create an account with a username and password to get started."}
            </Text>
          </Box>
        </Group>

        <Group gap="xs">
          <Button
            color="appdirect"
            leftSection={<IconLogin size={14} />}
            onClick={() => setOpened(true)}
          >
            {accountsExist ? "Sign in" : "Create account"}
          </Button>
          {accountsExist && (
            <Button
              variant="default"
              leftSection={<IconUserPlus size={14} />}
              onClick={() => setOpened(true)}
            >
              Sign up
            </Button>
          )}
        </Group>
      </Stack>

      <IdentityModal
        opened={opened}
        onClose={() => setOpened(false)}
        identity={null}
        signIn={signIn}
        signUp={signUp}
        setRole={setRole}
        clearIdentity={clearIdentity}
        submitResetRequest={submitResetRequest}
        refreshResetRequests={refreshResetRequests}
      />
    </Box>
  );
}
