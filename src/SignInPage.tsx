/**
 * SignInPage — the pre-login landing page.
 *
 * Shown when no identity is set. Clean, branded — no widget details, no sidebar.
 * Just the vCom logo, a brief description, and a sign-in button.
 */

import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Center,
  Code,
  Container,
  CopyButton,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  ThemeIcon,
  Title,
  useMantineColorScheme,
  useComputedColorScheme,
  ActionIcon,
  Tooltip,
  Divider,
  Collapse,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBrandGoogle,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconExternalLink,
  IconLink,
  IconLogin,
  IconMoon,
  IconSettings,
  IconShieldCheck,
  IconSun,
  IconUser,
} from "@tabler/icons-react";
import { BrandLogo } from "./widgets/BrandLogo";
import { useIdentity } from "./lib/identity";
import { NOC_ROSTER } from "./lib/roster";

// Map URL auth_error params to human-readable messages
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  consent_denied: "Sign-in was cancelled. Please try again.",
  token_exchange_failed: "Authentication failed. Please try again.",
  domain_not_allowed: "Only @appdirect.com accounts are allowed.",
  network_error: "A network error occurred. Please check your connection and try again.",
  profile_fetch_failed: "Could not load your Google profile. Please try again.",
  no_email: "Could not retrieve your email from Google. Please try again.",
};

// AppDirect brand colors
const APPDIRECT_BRAND_PRIMARY = "#006080";
const APPDIRECT_BRAND_ACCENT = "#0080a6";
const FALLBACK_DEPLOYMENT_URL = "https://sb-48rvj5c9ycdl.vercel.run/";

export default function SignInPage() {
  const { ssoEnabled, signIn, devSignIn } = useIdentity();
  const [devModalOpened, setDevModalOpened] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [redirectUri, setRedirectUri] = useState<string | null>(null);
  const [deploymentUrl, setDeploymentUrl] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light", {
    getInitialValueInEffect: true,
  });
  const isDark = computedColorScheme === "dark";
  const toggleColorScheme = () => setColorScheme(isDark ? "light" : "dark");
  const previewParams = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : null;
  const isEmbeddedPreview = typeof window !== "undefined"
    && (window.self !== window.top
      || previewParams?.has("appBuilderParentOrigin")
      || previewParams?.has("authPreview"));
  const isVercelDeployment = typeof window !== "undefined"
    && /(?:^|\.)vercel\.(?:app|run)$/i.test(window.location.hostname);
  const effectiveDeploymentUrl = deploymentUrl ?? FALLBACK_DEPLOYMENT_URL;
  const shouldShowPreviewInstructions = ssoEnabled && (isEmbeddedPreview || !isVercelDeployment);

  // Fetch the exact redirect URI the server generates
  useEffect(() => {
    fetch("/api/auth/redirect-uri")
      .then((r) => r.json())
      .then((d) => setRedirectUri(d.google ?? null))
      .catch(() => null);
  }, []);

  useEffect(() => {
    fetch("/api/auth/config")
      .then((r) => r.json())
      .then((d) => setDeploymentUrl(d.deployment_url ?? FALLBACK_DEPLOYMENT_URL))
      .catch(() => setDeploymentUrl(FALLBACK_DEPLOYMENT_URL));
  }, []);

  // Parse auth_error from URL on mount, then strip it from the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("auth_error");
    const domain = params.get("domain");
    if (err) {
      const msg = AUTH_ERROR_MESSAGES[err]
        ?? (err === "domain_not_allowed" && domain
          ? `${domain} is not an allowed domain. Use your @appdirect.com account.`
          : `Sign-in error: ${err}`);
      setAuthError(msg);
      // Auto-expand setup panel on redirect_uri_mismatch type errors
      setShowSetup(true);
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
    }
  }, []);

  return (
    <Box
      style={{
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        background: isDark
          ? "linear-gradient(180deg, #0b111e 0%, #0e1a2e 50%, #0b111e 100%)"
          : "linear-gradient(180deg, #f4f8fb 0%, #e8f0f4 50%, #f4f8fb 100%)",
      }}
    >
      {/* Brand strip */}
      <Box
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 3,
          background: `linear-gradient(90deg, ${APPDIRECT_BRAND_PRIMARY} 0%, ${APPDIRECT_BRAND_ACCENT} 50%, ${APPDIRECT_BRAND_PRIMARY} 100%)`,
          zIndex: 10,
        }}
      />

      {/* Ambient glow */}
      <Box
        style={{
          position: "absolute",
          top: "10%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "60vw",
          height: "60vh",
          background: `radial-gradient(circle at center, ${
            isDark ? "rgba(0, 128, 166,0.15)" : "rgba(0, 128, 166,0.08)"
          }, transparent 60%)`,
          pointerEvents: "none",
          filter: "blur(40px)",
        }}
      />

      {/* Theme toggle */}
      <Box style={{ position: "absolute", top: 16, right: 16, zIndex: 20 }}>
        <Tooltip label={isDark ? "Light mode" : "Dark mode"} withArrow>
          <ActionIcon
            variant="default"
            size="lg"
            radius="md"
            onClick={toggleColorScheme}
          >
            {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
          </ActionIcon>
        </Tooltip>
      </Box>

      {/* Main content */}
      <Center style={{ minHeight: "100vh", position: "relative", zIndex: 1 }}>
        <Container size={shouldShowPreviewInstructions ? "lg" : "xs"} px="md">
          <Stack align="center" gap="xl">
            {/* Logo */}
            <Box
              style={{
                filter: [
                  "drop-shadow(0 0 40px ",
                  isDark ? "rgba(0,128,166,0.4)" : "rgba(0,96,128,0.2)",
                  ")",
                ].join(""),
              }}
            >
              <BrandLogo size={64} glowColor="var(--mantine-color-appdirect-6)" />
            </Box>

            {/* Title */}
            <Stack align="center" gap={4}>
              <Title
                order={2}
                c="bright"
                ta="center"
                style={{ letterSpacing: "-0.02em" }}
              >
                vCom NOC Operations
              </Title>
              <Text size="sm" c="dimmed" ta="center" maw={320}>
                Sign in with your team credentials to access your dashboard
              </Text>
            </Stack>

            {/* Auth error alert */}
            {authError && (
              <Alert
                icon={<IconAlertCircle size={16} />}
                color="red"
                radius="md"
                w="100%"
                maw={380}
                withCloseButton
                onClose={() => setAuthError(null)}
              >
                {authError}
              </Alert>
            )}

            {/* Sign-in card */}
            <Card
              withBorder
              radius="lg"
              p="xl"
              w="100%"
              maw={shouldShowPreviewInstructions ? 840 : 420}
              style={{
                background: isDark
                  ? "rgba(15, 22, 36, 0.8)"
                  : "rgba(255, 255, 255, 0.9)",
                backdropFilter: "blur(20px)",
              }}
            >
              <Stack gap="md">
                {shouldShowPreviewInstructions ? (
                  <Stack gap="xl">
                    <Alert
                      icon={<IconShieldCheck size={24} />}
                      color="blue"
                      radius="md"
                      variant="light"
                      styles={{
                        root: { padding: 24 },
                        message: { fontSize: 24, lineHeight: 1.6 },
                        icon: { alignSelf: "flex-start", marginTop: 6 },
                      }}
                    >
                      Google login is available only through the Vercel app. Click the link below to open the login page. This preview enables the sandbox; you’ll need the sandbox turned on to log in because the Vercel app hasn’t been published yet.
                    </Alert>

                    <Stack gap={14}>
                      <Text fw={700} style={{ fontSize: 24, lineHeight: 1.3 }}>
                        Production login on Vercel
                      </Text>
                      <Text c="dimmed" style={{ fontSize: 24, lineHeight: 1.6 }}>
                        Use the below link to sign in to the App
                      </Text>
                    </Stack>

                    {effectiveDeploymentUrl ? (
                      <>
                        <Stack gap={14}>
                          <Text style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.4 }} c="dimmed" tt="uppercase">
                            Production login URL
                          </Text>
                          <Code
                            block
                            style={{
                              fontSize: 24,
                              lineHeight: 1.6,
                              wordBreak: "break-all",
                              padding: "20px 22px",
                            }}
                          >
                            {effectiveDeploymentUrl}
                          </Code>
                        </Stack>
                        <Group grow>
                          <CopyButton value={effectiveDeploymentUrl} timeout={2000}>
                            {({ copied, copy }) => (
                              <Button
                                variant={copied ? "filled" : "light"}
                                color={copied ? "green" : "appdirect"}
                                size="xl"
                                radius="md"
                                leftSection={copied ? <IconCheck size={22} /> : <IconCopy size={22} />}
                                onClick={copy}
                                styles={{ root: { minHeight: 68, fontSize: 24, fontWeight: 600, paddingInline: 20 } }}
                              >
                                {copied ? "Copied Vercel link" : "Copy Vercel link"}
                              </Button>
                            )}
                          </CopyButton>
                          <Button
                            component="a"
                            href={effectiveDeploymentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            size="xl"
                            color="appdirect"
                            leftSection={<IconExternalLink size={22} />}
                            radius="md"
                            styles={{ root: { minHeight: 68, fontSize: 24, fontWeight: 600, paddingInline: 20 } }}
                          >
                            Open Vercel login page
                          </Button>
                        </Group>
                      </>
                    ) : (
                      <Alert
                        icon={<IconLink size={24} />}
                        color="gray"
                        radius="md"
                        variant="light"
                        styles={{
                          root: { padding: 24 },
                          message: { fontSize: 24, lineHeight: 1.6 },
                          icon: { alignSelf: "flex-start", marginTop: 6 },
                        }}
                      >
                        Your Vercel deployment link will appear here after you publish from the Deploy panel.
                      </Alert>
                    )}
                  </Stack>
                ) : ssoEnabled ? (
                  <>
                    <Button
                      fullWidth
                      size="md"
                      color="appdirect"
                      leftSection={<IconBrandGoogle size={18} />}
                      onClick={signIn}
                      radius="md"
                      styles={{ root: { fontWeight: 600 } }}
                    >
                      Sign in with Google
                    </Button>
                    <Group gap="xs" justify="center">
                      <ThemeIcon size="xs" variant="transparent" color="dimmed">
                        <IconShieldCheck size={12} />
                      </ThemeIcon>
                      <Text size="xs" c="dimmed">
                        Restricted to approved @appdirect.com accounts
                      </Text>
                    </Group>
                  </>
                ) : (
                  <>
                    <Button
                      fullWidth
                      size="md"
                      color="appdirect"
                      leftSection={<IconLogin size={18} />}
                      onClick={() => setDevModalOpened(true)}
                      radius="md"
                    >
                      Sign in
                    </Button>
                    <Divider label="Development mode" labelPosition="center" />
                    <Text size="xs" c="dimmed" ta="center">
                      Google SSO not configured — using name picker.
                    </Text>
                  </>
                )}

                {/* Google Cloud Console setup helper */}
                {!shouldShowPreviewInstructions && ssoEnabled && redirectUri && (
                  <>
                    <Divider />
                    <Box
                      style={{ cursor: "pointer" }}
                      onClick={() => setShowSetup((v) => !v)}
                    >
                      <Group justify="space-between" align="center">
                        <Group gap={6}>
                          <IconSettings size={13} color="var(--mantine-color-dimmed)" />
                          <Text size="xs" c="dimmed" fw={500}>
                            Getting a redirect_uri_mismatch error?
                          </Text>
                        </Group>
                        {showSetup
                          ? <IconChevronUp size={13} color="var(--mantine-color-dimmed)" />
                          : <IconChevronDown size={13} color="var(--mantine-color-dimmed)" />
                        }
                      </Group>
                    </Box>
                    <Collapse in={showSetup}>
                      <Stack gap="xs">
                        <Text size="xs" c="dimmed">
                          Add this exact URI to your{" "}
                          <Text
                            component="a"
                            href="https://console.cloud.google.com/apis/credentials"
                            target="_blank"
                            rel="noopener noreferrer"
                            size="xs"
                            c="appdirect.5"
                            style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
                          >
                            Google Cloud Console
                            <IconExternalLink size={10} />
                          </Text>
                          {" "}under <b>Authorized redirect URIs</b>:
                        </Text>
                        <Group gap="xs" wrap="nowrap" align="center">
                          <Code
                            block
                            style={{
                              fontSize: 10,
                              flex: 1,
                              wordBreak: "break-all",
                              padding: "6px 10px",
                            }}
                          >
                            {redirectUri}
                          </Code>
                          <CopyButton value={redirectUri} timeout={2000}>
                            {({ copied, copy }) => (
                              <Tooltip label={copied ? "Copied!" : "Copy"} withArrow>
                                <ActionIcon
                                  variant={copied ? "filled" : "light"}
                                  color={copied ? "green" : "appdirect"}
                                  size="lg"
                                  radius="md"
                                  onClick={copy}
                                  style={{ flexShrink: 0 }}
                                >
                                  {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </CopyButton>
                        </Group>
                        <Text size="xs" c="dimmed">
                          Google Cloud Console → APIs &amp; Services → Credentials → your OAuth client → Authorized redirect URIs → Add URI → Save
                        </Text>
                      </Stack>
                    </Collapse>
                  </>
                )}
              </Stack>
            </Card>

            {/* Footer */}
            <Text size="xs" c="dimmed" ta="center" style={{ opacity: 0.5 }}>
              vCom Solutions · NOC Operations Dashboard
            </Text>
          </Stack>
        </Container>
      </Center>

      {/* Dev mode sign-in modal */}
      <DevSignInModal
        opened={devModalOpened}
        onClose={() => setDevModalOpened(false)}
        devSignIn={devSignIn}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Dev mode sign-in modal (reused from IdentityBadge but self-contained)
// ---------------------------------------------------------------------------

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
