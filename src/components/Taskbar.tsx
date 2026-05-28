/**
 * Taskbar — fixed bottom bar showing all open windows (minimized + active).
 * Click a minimized button to restore. Click an active button to minimize.
 */
import { Box, Button, Group, ThemeIcon, Text, Tooltip } from "@mantine/core";
import { IconLayoutGrid } from "@tabler/icons-react";
import { useWindowManager } from "../lib/window-manager";

export function Taskbar() {
  const { windows, minimizeWindow, restoreWindow, bringToFront } = useWindowManager();

  if (windows.length === 0) return null;

  return (
    <Box
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: 48,
        zIndex: 9999,
        background: "rgba(10, 16, 28, 0.92)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        alignItems: "center",
        paddingLeft: 12,
        paddingRight: 12,
        gap: 6,
      }}
    >
      {/* Label */}
      <Box style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 8, flexShrink: 0 }}>
        <IconLayoutGrid size={14} color="rgba(255,255,255,0.3)" />
        <Text size="xs" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>
          WINDOWS
        </Text>
      </Box>

      {/* Window buttons */}
      <Group gap={4} wrap="nowrap" style={{ overflow: "hidden", flex: 1 }}>
        {windows.map((win) => {
          const Icon = win.icon;
          const isMinimized = win.minimized;
          return (
            <Tooltip key={win.id} label={isMinimized ? `Restore ${win.title}` : `Minimize ${win.title}`} withArrow withinPortal>
              <Button
                size="xs"
                variant={isMinimized ? "default" : "filled"}
                color={isMinimized ? "gray" : win.iconColor}
                radius="sm"
                leftSection={
                  <ThemeIcon
                    size={14}
                    variant="transparent"
                    color={isMinimized ? "dimmed" : "white"}
                  >
                    <Icon size={10} />
                  </ThemeIcon>
                }
                onClick={() => {
                  if (isMinimized) {
                    restoreWindow(win.id);
                  } else {
                    minimizeWindow(win.id);
                  }
                }}
                onDoubleClick={() => {
                  if (!isMinimized) bringToFront(win.id);
                }}
                style={{
                  opacity: isMinimized ? 0.6 : 1,
                  maxWidth: 160,
                  flexShrink: 0,
                }}
                styles={{
                  label: {
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 120,
                    fontSize: 11,
                  },
                }}
              >
                {win.title}
              </Button>
            </Tooltip>
          );
        })}
      </Group>
    </Box>
  );
}
