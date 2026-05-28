/**
 * Window Manager — context + hook for managing floating widget windows.
 * Supports: open multiple windows, bring to front, minimize, maximize, close, drag.
 */
import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { WidgetDefinition } from "../widgets/types";

export interface WindowState {
  id: string;           // widget id
  title: string;
  icon: WidgetDefinition["icon"];
  iconColor: string;
  Full: WidgetDefinition["Full"];
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  zIndex: number;
}

interface WindowManagerCtx {
  windows: WindowState[];
  openWindow: (widget: WidgetDefinition) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  maximizeToggle: (id: string) => void;
  bringToFront: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, w: number, h: number) => void;
  topZ: number;
}

const Ctx = createContext<WindowManagerCtx | null>(null);

const DEFAULT_W = 860;
const DEFAULT_H = 600;
const HEADER_H  = 68; // AppShell header height
const CASCADE   = 32; // cascade offset per window

export function WindowManagerProvider({ children }: { children: React.ReactNode }) {
  const [windows, setWindows] = useState<WindowState[]>([]);
  const zCounter = useRef(100);
  const openCount = useRef(0);

  const topZ = zCounter.current;

  const openWindow = useCallback((widget: WidgetDefinition) => {
    setWindows((prev) => {
      // If already open, just bring to front & restore
      const existing = prev.find((w) => w.id === widget.id);
      if (existing) {
        zCounter.current += 1;
        const z = zCounter.current;
        return prev.map((w) =>
          w.id === widget.id ? { ...w, minimized: false, zIndex: z } : w,
        );
      }

      // Cascade new windows
      const idx = openCount.current % 8;
      openCount.current += 1;
      zCounter.current += 1;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(DEFAULT_W, vw - 40);
      const h = Math.min(DEFAULT_H, vh - HEADER_H - 80);
      const x = Math.max(8, Math.min(vw - w - 8, 60 + idx * CASCADE));
      const y = Math.max(8, Math.min(vh - h - 80, 16 + idx * CASCADE));

      const newWin: WindowState = {
        id: widget.id,
        title: widget.title,
        icon: widget.icon,
        iconColor: widget.iconColor ?? "blue",
        Full: widget.Full,
        x, y, width: w, height: h,
        minimized: false,
        maximized: false,
        zIndex: zCounter.current,
      };
      return [...prev, newWin];
    });
  }, []);

  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const minimizeWindow = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
    );
  }, []);

  const restoreWindow = useCallback((id: string) => {
    setWindows((prev) => {
      zCounter.current += 1;
      const z = zCounter.current;
      return prev.map((w) =>
        w.id === id ? { ...w, minimized: false, maximized: false, zIndex: z } : w,
      );
    });
  }, []);

  const maximizeToggle = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, maximized: !w.maximized } : w)),
    );
  }, []);

  const bringToFront = useCallback((id: string) => {
    setWindows((prev) => {
      zCounter.current += 1;
      const z = zCounter.current;
      return prev.map((w) => (w.id === id ? { ...w, zIndex: z } : w));
    });
  }, []);

  const moveWindow = useCallback((id: string, x: number, y: number) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, x, y } : w)),
    );
  }, []);

  const resizeWindow = useCallback((id: string, width: number, height: number) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, width, height } : w)),
    );
  }, []);

  return (
    <Ctx.Provider value={{
      windows, openWindow, closeWindow, minimizeWindow, restoreWindow,
      maximizeToggle, bringToFront, moveWindow, resizeWindow, topZ,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWindowManager() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWindowManager must be inside WindowManagerProvider");
  return ctx;
}
