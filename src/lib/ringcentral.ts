export type RingCentralQueueToggleResult = {
  ok: boolean;
  employeeName?: string;
  canonicalName?: string;
  displayName?: string;
  extensionId?: string;
  enabled?: boolean;
  dndStatus?: string;
  message?: string;
  error?: string;
};

export const RINGCENTRAL_QUEUE_UPDATED_EVENT = "ringcentral-queue-updated";

export async function toggleRingCentralQueueCalls(employeeName: string, enabled: boolean) {
  const response = await fetch("/api/ringcentral/queue-toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeName, enabled }),
  });

  let json: RingCentralQueueToggleResult | null = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok || !json?.ok) {
    throw new Error(json?.error ?? json?.message ?? `RingCentral queue toggle failed (${response.status}).`);
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(RINGCENTRAL_QUEUE_UPDATED_EVENT, {
      detail: {
        employeeName,
        enabled,
      },
    }));
  }

  return json;
}
