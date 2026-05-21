/**
 * SignInPage — the pre-login landing page.
 *
 * Shown when no identity is set. Clean, branded — no widget details, no sidebar.
 * Just the vCom logo, a brief description, and a sign-in button.
 */

import { useState } from "react";
import {
  Box,
  Button,
  Card,
  Center,
  Container,
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
} from "@mantine/core";
import {
  IconLogin,
  IconMoon,
  IconShieldCheck,
  IconSun,
  IconUser,
} from "@tabler/icons-react";
import { BrandLogo } from "./widgets/BrandLogo";
import { useIdentity } from "./lib/identity";
import { NOC_ROSTER } from "./lib/roster";

// AppDirect brand colors
const APPDIRECT_BRAND_PRIMARY = "#006080";
const APPDIRECT_BRAND_ACCENT = "#0080a6";

export default function SignInPage() {
  const { ssoEnabled, signIn, devSignIn } = useIdentity();
  const [devModalOpened, setDevModalOpened] = useState(false);
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light", {
    getInitialValueInEffect: true,
  });
  const isDark = computedColorScheme === "dark";
  const toggleColorScheme = () => setColorScheme(isDark ? "light" : "dark");

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
        <Container size="xs" px="md">
          <Stack align="center" gap="xl">
            {/* Logo */}
            <Box
              style={{
                filter: `drop-shadow(0 0 40px ${
                  isDark ? "rgba(0,128,166,0.4)" : "rgba(0,96,128,0.2)"
                })`,
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

            {/* Sign-in card */}
            <Card
              withBorder
              radius="lg"
              p="xl"
              w="100%"
              maw={380}
              style={{
                background: isDark
                  ? "rgba(15, 22, 36, 0.8)"
                  : "rgba(255, 255, 255, 0.9)",
                backdropFilter: "blur(20px)",
              }}
            >
              <Stack gap="md">
                {ssoEnabled ? (
                  <Button
                    fullWidth
                    size="md"
                    color="appdirect"
                    leftSection={<IconShieldCheck size={18} />}
                    onClick={signIn}
                    radius="md"
                  >
                    Sign in with Google
                  </Button>
                ) : (
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
                )}

                <Group gap="xs" justify="center">
                  <ThemeIcon size="xs" variant="transparent" color="dimmed">
                    <IconShieldCheck size={12} />
                  </ThemeIcon>
                  <Text size="xs" c="dimmed">
                    Restricted to @appdirect.com accounts
                  </Text>
                </Group>
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
