import type { ReactNode } from "react";
import {
  Card,
  Group,
  ThemeIcon,
  Title,
  Text,
  Box,
  ActionIcon,
  Tooltip,
  Stack,
  Badge,
  Loader,
} from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import type { ComponentType } from "react";

interface WidgetFrameProps {
  title: string;
  subtitle?: string;
  icon: ComponentType<{ size?: number }>;
  iconColor: string;
  onRefresh?: () => void;
  loading?: boolean;
  status?: {
    label: string;
    color: string;
    tooltip?: string;
  };
  headerActions?: ReactNode;
  children: ReactNode;
}

/**
 * Shared card chrome for every dashboard widget. Keeps the visual rhythm
 * consistent and concentrates "common" concerns (refresh, status, loading)
 * in one place so each widget body can focus on its own logic.
 *
 * Light-mode visual design: the header is a vibrant gradient strip in the
 * widget's accent color, with a filled-icon-on-white treatment that reads
 * as a hero bar instead of a flat gray panel.
 */
export function WidgetFrame({
  title,
  subtitle,
  icon: Icon,
  iconColor,
  onRefresh,
  loading,
  status,
  headerActions,
  children,
}: WidgetFrameProps) {
  const accent6 = `var(--mantine-color-${iconColor}-6)`;
  const accent7 = `var(--mantine-color-${iconColor}-7)`;
  // Subtle accent wash that reads in both light and dark mode — mixes the
  // accent into the body color so it stays light-on-light / dark-on-dark.
  const accentWash = `color-mix(in srgb, ${accent6} 12%, var(--mantine-color-body))`;

  return (
    <Card
      radius="lg"
      withBorder
      p={0}
      h="100%"
      style={{
        overflow: "hidden",
        background: "var(--widget-tile-surface)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Box
        px="lg"
        py="md"
        style={{
          borderBottom: "1px solid var(--mantine-color-default-border)",
          background: `linear-gradient(135deg, ${accentWash} 0%, var(--widget-tile-surface) 100%)`,
          position: "relative",
        }}
      >
        {/* Top accent stripe */}
        <Box
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: 3,
            background: `linear-gradient(90deg, ${accent6} 0%, ${accent7} 100%)`,
            pointerEvents: "none",
          }}
        />
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <Box
              style={{
                position: "relative",
                filter: `drop-shadow(0 0 14px ${accent6}55)`,
              }}
            >
              <ThemeIcon
                size="xl"
                radius="md"
                variant="filled"
                color={iconColor}
              >
                <Icon size={22} />
              </ThemeIcon>
            </Box>
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Title
                order={4}
                c="bright"
                style={{ lineHeight: 1.2, letterSpacing: "-0.01em" }}
              >
                {title}
              </Title>
              {subtitle && (
                <Text size="xs" c="dimmed" truncate>
                  {subtitle}
                </Text>
              )}
            </Stack>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {status && (
              <Tooltip
                label={status.tooltip ?? status.label}
                disabled={!status.tooltip}
              >
                <Badge variant="filled" color={iconColor} size="sm">
                  {status.label}
                </Badge>
              </Tooltip>
            )}
            {headerActions}
            {loading && <Loader size="xs" color={iconColor} />}
            {onRefresh && (
              <Tooltip label="Refresh widget">
                <ActionIcon
                  variant="subtle"
                  size="md"
                  onClick={onRefresh}
                  aria-label={`Refresh ${title}`}
                >
                  <IconRefresh size={16} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        </Group>
      </Box>
      <Box p="lg">{children}</Box>
    </Card>
  );
}
