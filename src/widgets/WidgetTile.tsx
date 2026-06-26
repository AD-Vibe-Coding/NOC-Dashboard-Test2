import type { ReactNode, ComponentType } from "react";
import {
  Card,
  Group,
  Stack,
  ThemeIcon,
  Title,
  Text,
  Box,
  Badge,
  Tooltip,
} from "@mantine/core";
import { IconArrowsMaximize } from "@tabler/icons-react";

interface WidgetTileProps {
  title: string;
  description?: string;
  icon: ComponentType<{ size?: number }>;
  iconColor: string;
  status?: { label: string; color: string; tooltip?: string };
  onExpand: () => void;
  headerActions?: ReactNode;
  /** Featured tiles (My Day, Zoom Queue, Break Tracker) get an extra prominent
   *  treatment — bigger icon, stronger shadow, more pronounced hover lift. */
  featured?: boolean;
  children: ReactNode;
}

/**
 * Compact tile rendered on the dashboard grid. The entire card is clickable —
 * clicking anywhere expands the widget into its full view.
 *
 * Light-mode visual design:
 *   - White card background with a soft colored gradient wash in the top-left
 *     corner using the widget's accent color (gives each tile its own
 *     personality without overwhelming).
 *   - Thick (4px) colored top stripe always visible — the immediate visual
 *     anchor that color-codes the tile.
 *   - Subtle soft shadow always present; intensifies on hover.
 *   - Featured tiles get an extra glow ring and a stronger lift.
 */
export function WidgetTile({
  title,
  description,
  icon: Icon,
  iconColor,
  status,
  onExpand,
  headerActions,
  featured,
  children,
}: WidgetTileProps) {
  const accentVar = `var(--mantine-color-${iconColor}-6)`;
  // Theme-aware wash. In light mode this mixes 14% of the accent into white
  // (so it reads as a soft tinted halo). In dark mode it mixes 14% into the
  // near-black body surface — never bleeds white onto a dark card.
  const accentWash = `color-mix(in srgb, ${accentVar} 14%, var(--mantine-color-body))`;

  return (
    <Card
      radius="lg"
      withBorder
      p="sm"
      onClick={onExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onExpand();
        }
      }}
      className={featured ? "widget-tile widget-tile--featured" : "widget-tile"}
      style={{
        cursor: "pointer",
        // Use Mantine's default surface (lifts off the page slightly in
        // both modes — slightly lighter than body in dark, slightly
        // tinted off-white in light).
        background: "var(--widget-tile-surface)",
        position: "relative",
        overflow: "hidden",
        ["--accent-color" as any]: accentVar,
      }}
    >
      {/* Top accent stripe — always visible, thicker for featured tiles */}
      <Box
        className="widget-tile__stripe"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: featured ? 4 : 3,
          background: accentVar,
          opacity: featured ? 0.95 : 0.8,
          pointerEvents: "none",
        }}
      />

      {/* Soft colored gradient wash in the top-left — subtle, decorative.
          Uses a color-mixed accent so it stays readable in both light and
          dark mode (never blasts white onto a dark surface). */}
      <Box
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "55%",
          height: "55%",
          background: `radial-gradient(circle at top left, ${accentWash}, transparent 70%)`,
          opacity: 0.9,
          pointerEvents: "none",
        }}
      />

      <Stack gap="xs" style={{ position: "relative", zIndex: 1 }}>
        <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <Box
              style={{
                position: "relative",
                filter: `drop-shadow(0 0 10px color-mix(in srgb, ${accentVar} 35%, transparent))`,
              }}
            >
              <ThemeIcon
                size={featured ? "xl" : "lg"}
                radius="md"
                variant="light"
                color={iconColor}
              >
                <Icon size={featured ? 24 : 20} />
              </ThemeIcon>
            </Box>
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Title
                order={featured ? 4 : 5}
                style={{ lineHeight: 1.2, letterSpacing: "-0.01em" }}
                c="bright"
              >
                {title}
              </Title>
              {description && (
                <Text size="xs" c="dimmed" truncate>
                  {description}
                </Text>
              )}
            </Stack>
          </Group>
          <Group gap={6} wrap="nowrap" align="center">
            {headerActions}
            {status && (
              <Tooltip
                label={status.tooltip ?? status.label}
                disabled={!status.tooltip}
                withinPortal
              >
                <Badge size="xs" variant="light" color={status.color}>
                  {status.label}
                </Badge>
              </Tooltip>
            )}
            <ThemeIcon
              className="widget-tile__chevron"
              size="sm"
              radius="md"
              variant="subtle"
              color="gray"
              aria-label="Expand"
            >
              <IconArrowsMaximize size={14} />
            </ThemeIcon>
          </Group>
        </Group>
        <Box>{children}</Box>
      </Stack>
    </Card>
  );
}
