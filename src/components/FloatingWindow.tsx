/**
 * FloatingWindow — a draggable, resizable, minimizable floating widget window.
 */
import { useCallback, useEffect, useRef } from "react";
import { ActionIcon, Box, Group, Text, ThemeIcon, Tooltip } from "@mantine/core";
import {
  IconMinus,
  IconMaximize,
  IconMinimize,
  IconX,
} from "@tabler/icons-react";
import type { WindowState } from "../lib/window-manager";
import { useWindowManager } from "../lib/window-manager";

const HEADER_H  = 68;
const MIN_W     = 400;
const MIN_H     = 300;
const TITLE_BAR = 40;

interface Props {
  win: WindowState;
}

export function FloatingWindow({ win }: Props) {
  const { closeWindow, minimizeWindow, maximizeToggle, bringToFront, moveWindow, resizeWindow } = useWindowManager();
  const dragRef  = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  const boxRef   = useRef<HTMLDivElement>(null);

  // ── Drag ────────────────────────────────────────────────────────────────────
  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if (win.maximized) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    bringToFront(win.id);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: win.x, origY: win.y };
  }, [win, bringToFront]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const nx = Math.max(0, Math.min(vw - win.width, dragRef.current.origX + dx));
      const ny = Math.max(0, Math.min(vh - HEADER_H - TITLE_BAR - 40, dragRef.current.origY + dy));
      moveWindow(win.id, nx, ny);
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [win.id, win.width, moveWindow]);

  // ── Resize ───────────────────────────────────────────────────────────────────
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (win.maximized) return;
    e.preventDefault();
    e.stopPropagation();
    bringToFront(win.id);
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: win.width, origH: win.height };
  }, [win, bringToFront]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = e.clientX - resizeRef.current.startX;
      const dy = e.clientY - resizeRef.current.startY;
      const nw = Math.max(MIN_W, resizeRef.current.origW + dx);
      const nh = Math.max(MIN_H, resizeRef.current.origH + dy);
      resizeWindow(win.id, nw, nh);
    };
    const onUp = () => { resizeRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [win.id, resizeWindow]);

  if (win.minimized) return null;

  const Icon = win.icon;

  const style: React.CSSProperties = win.maximized
    ? {
        position: "fixed",
        left: 0,
        top: HEADER_H,
        width: "100vw",
        height: `calc(100vh - ${HEADER_H}px - 48px)`, // 48px for taskbar
        zIndex: win.zIndex,
      }
    : {
        position: "fixed",
        left: win.x,
        top: win.y + HEADER_H,
        width: win.width,
        height: win.height,
        zIndex: win.zIndex,
      };

  return (
    <Box
      ref={boxRef}
      style={{
        ...style,
        display: "flex",
        flexDirection: "column",
        borderRadius: win.maximized ? 0 : 12,
        overflow: "hidden",
        boxShadow: "0 24px 64px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.08)",
        background: "var(--mantine-color-body)",
      }}
      onMouseDown={() => bringToFront(win.id)}
    >
      {/* ── Title bar ── */}
      <Group
        gap="xs"
        px="sm"
        style={{
          height: TITLE_BAR,
          minHeight: TITLE_BAR,
          background: "linear-gradient(90deg, rgba(0,96,128,0.25) 0%, rgba(0,128,166,0.15) 100%)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          cursor: win.maximized ? "default" : "move",
          userSelect: "none",
          flexShrink: 0,
        }}
        onMouseDown={onTitleMouseDown}
        onDoubleClick={() => maximizeToggle(win.id)}
      >
        <ThemeIcon size="xs" variant="light" color={win.iconColor} radius="sm">
          <Icon size={10} />
        </ThemeIcon>
        <Text size="sm" fw={600} style={{ flex: 1, minWidth: 0 }} truncate>
          {win.title}
        </Text>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Minimize" withArrow withinPortal>
            <ActionIcon
              size="xs"
              variant="subtle"
              color="yellow"
              radius="xl"
              onClick={(e) => { e.stopPropagation(); minimizeWindow(win.id); }}
            >
              <IconMinus size={10} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={win.maximized ? "Restore" : "Maximize"} withArrow withinPortal>
            <ActionIcon
              size="xs"
              variant="subtle"
              color="green"
              radius="xl"
              onClick={(e) => { e.stopPropagation(); maximizeToggle(win.id); }}
            >
              {win.maximized ? <IconMinimize size={10} /> : <IconMaximize size={10} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Close" withArrow withinPortal>
            <ActionIcon
              size="xs"
              variant="subtle"
              color="red"
              radius="xl"
              onClick={(e) => { e.stopPropagation(); closeWindow(win.id); }}
            >
              <IconX size={10} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* ── Content ── */}
      <Box style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        <win.Full />
      </Box>

      {/* ── Resize handle (bottom-right corner) ── */}
      {!win.maximized && (
        <Box
          onMouseDown={onResizeMouseDown}
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: 16,
            height: 16,
            cursor: "se-resize",
            background: "transparent",
            zIndex: 10,
          }}
        >
          {/* Resize grip dots */}
          <svg width="16" height="16" style={{ display: "block" }}>
            <circle cx="12" cy="12" r="1.5" fill="rgba(255,255,255,0.25)" />
            <circle cx="8"  cy="12" r="1.5" fill="rgba(255,255,255,0.15)" />
            <circle cx="12" cy="8"  r="1.5" fill="rgba(255,255,255,0.15)" />
          </svg>
        </Box>
      )}
    </Box>
  );
}
