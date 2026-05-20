// Shared time / duration formatters used across widgets.

export function formatElapsed(startMs: number, endMs?: number | null): string {
  const end = endMs ?? Date.now();
  const diffSec = Math.max(0, Math.floor((end - startMs) / 1000));
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatElapsedIso(
  startIso: string,
  endIso?: string | null,
): string {
  return formatElapsed(
    new Date(startIso).getTime(),
    endIso ? new Date(endIso).getTime() : null,
  );
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(d: Date): string {
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
