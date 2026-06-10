export function isPageVisible() {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

export function getCalmerPollingMs(baseMs: number) {
  const inDev = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);
  return inDev ? Math.max(baseMs, Math.round(baseMs * 2)) : baseMs;
}

export function runVisibleTask(task: () => void | Promise<void>) {
  if (!isPageVisible()) return;
  void task();
}
