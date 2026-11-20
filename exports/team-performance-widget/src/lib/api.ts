// Tiny typed fetch wrapper for the same-origin /api/* routes. The browser
// never talks to Supabase directly; it always goes through these routes,
// which use the service-role client server-side.

/** Statuses the edge proxy returns on transient failures. */
const RETRYABLE = new Set([502, 503, 504]);
const MAX_RETRIES = 3;

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  let lastRes: Response | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
    try {
      lastRes = await fetch(url, init);
      // Only retry on transient proxy errors
      if (RETRYABLE.has(lastRes.status) && attempt < MAX_RETRIES) continue;
      break;
    } catch (err) {
      // Network error — retry if we have attempts left
      if (attempt >= MAX_RETRIES) throw err;
    }
  }

  const res = lastRes!;
  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!res.ok) {
    const message =
      (payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : null) ?? `${method} ${url} failed: ${res.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body),
  delete: <T>(url: string) => request<T>("DELETE", url),
};
