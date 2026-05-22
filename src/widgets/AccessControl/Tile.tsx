import { useEffect, useState } from "react";
import { Badge, Box, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconBrandGoogle, IconShield, IconShieldCheck, IconShieldOff } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { ROLE_COLORS, ROLE_LABELS } from "../../lib/roles";
import { useIdentity } from "../../lib/identity";

interface Props {
  onExpand: () => void;
}

interface TileData {
  counts: { manager: number; tier3: number; tier2: number; tier1: number };
  overrides: number;
  googleSignIns: number;
  neverSignedIn: number;
  ssoConfigured: boolean;
}

export function AccessControlTile({ onExpand }: Props) {
  const { identity, loading: identityLoading } = useIdentity();
  const [tileData, setTileData] = useState<TileData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (identityLoading) return;
    if (!identity) { setLoading(false); return; }

    fetch("/api/access-control")
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((j) => {
        const members = j.members ?? [];
        setTileData({
          counts: j.counts ?? { manager: 0, tier3: 0, tier2: 0, tier1: 0 },
          overrides: members.filter((m: any) => m.isOverridden).length,
          googleSignIns: members.filter((m: any) => m.signInMethod === "google").length,
          neverSignedIn: members.filter((m: any) => !m.lastSignIn).length,
          ssoConfigured: j.sso?.configured ?? false,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [identity, identityLoading]);

  return (
    <WidgetTile
      title="Access Control"
      description="Team roles & SSO management"
      icon={IconShield}
      iconColor="red"
      onExpand={onExpand}
    >
      {loading ? (
        <Box ta="center" pt="sm">
          <ThemeIcon size="xs" color="red" variant="transparent" radius="xl">
            <IconShield size={12} />
          </ThemeIcon>
        </Box>
      ) : tileData ? (
        <Stack gap="xs">
          {/* Role counts */}
          <Group gap={4} wrap="wrap">
            {(["manager", "tier3", "tier2", "tier1"] as const).map((role) =>
              tileData.counts[role] > 0 ? (
                <Badge key={role} size="xs" color={ROLE_COLORS[role]} variant="light">
                  {tileData.counts[role]} {ROLE_LABELS[role]}
                </Badge>
              ) : null
            )}
          </Group>

          <Group gap={4}>
            <ThemeIcon
              size="xs"
              color={tileData.ssoConfigured ? "green" : "yellow"}
              variant="light"
              radius="xl"
            >
              {tileData.ssoConfigured ? <IconShieldCheck size={10} /> : <IconShieldOff size={10} />}
            </ThemeIcon>
            <Text size="xs" c={tileData.ssoConfigured ? "green" : "yellow"} fw={600}>
              SSO {tileData.ssoConfigured ? "active" : "not configured"}
            </Text>
          </Group>

          {tileData.ssoConfigured && tileData.googleSignIns > 0 && (
            <Group gap={4}>
              <IconBrandGoogle size={10} style={{ opacity: 0.6 }} />
              <Text size="xs" c="dimmed">
                {tileData.googleSignIns} signed in via Google
              </Text>
            </Group>
          )}

          {tileData.overrides > 0 && (
            <Text size="xs" c="dimmed">
              {tileData.overrides} role override{tileData.overrides !== 1 ? "s" : ""} active
            </Text>
          )}
        </Stack>
      ) : (
        <Text size="xs" c="dimmed">Click to manage access</Text>
      )}
    </WidgetTile>
  );
}
