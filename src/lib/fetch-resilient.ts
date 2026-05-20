/**
 * Lightweight fetch wrapper that auto-retries transient failures.
 *
 * Background: in a dev/preview environment Vite hot-restarts the server
 * whenever .env, vite.config.ts, or a Vite plugin file changes. During the
 * ~500 ms restart window, the platform's proxy returns HTTP 502 to any
 * in-flight request, and our polling widgets log noisy errors.
 *
 * This wrapper retries 502/503/504 responses and network errors with a short
 * exponential backoff (200ms → 500ms → 1s), so a single momentary blip is
 * invisible to the user and the widgets recover on their own.
 *
 * Note: the preview inspector (`public/devs-inspect.js`) intercepts every
 * `window.fetch` call and forwards any non-2xx response to the console as
 * "[HTTP NNN] Server error: <path>". That's a platform feature we can't
 * suppress — but with retries in place, those errors will be rare and
 * transparent rather than user-facing.
 */

export interface ResilientFetchOptions {
  /** Max number of attempts (including the first). Defaults to 4. */
  retries?: number;
  /** Base delay in ms between retries. Defaults to 200. */
  baseDelayMs?: number;
  /** HTTP statuses that should trigger a retry. Defaults to [502, 503, 504]. */
  retryStatuses?: number[];
  /** AbortSignal to cancel the entire retry loop. */
  signal?: AbortSignal;
}

const DEFAULT_RETRY_STATUSES = [502, 503, 504];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Like fetch() but retries transient 5xx and network errors.
 * Returns the final Response (which may still be non-2xx — caller decides).
 */
export async function resilientFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts: ResilientFetchOptions = {},
): Promise<Response> {
  const retries = opts.retries ?? 4;
  const baseDelay = opts.baseDelayMs ?? 200;
  const retryStatuses = opts.retryStatuses ?? DEFAULT_RETRY_STATUSES;
  const signal = opts.signal ?? init?.signal ?? undefined;

  let lastError: unknown = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const res = await fetch(input, { ...init, signal });
      if (!retryStatuses.includes(res.status)) {
        return res;
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      // AbortError should propagate immediately
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      lastError = err;
    }

    // Don't wait after the last attempt
    if (attempt < retries - 1) {
      const delay = baseDelay * Math.pow(2, attempt); // 200, 400, 800, 1600...
      await sleep(delay, signal);
    }
  }

  // All retries exhausted — do one final fetch so we return a Response
  // (caller can inspect status) rather than throwing.
  try {
    return await fetch(input, { ...init, signal });
  } catch (err) {
    if (lastError instanceof Error) throw lastError;
    throw err;
  }
}

/**
 * Convenience wrapper that fetches JSON and throws if the final response
 * is not OK. Use for GET endpoints where you want `{...}` or an error.
 */
export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: ResilientFetchOptions,
): Promise<T> {
  const res = await resilientFetch(input, init, opts);
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.text();
      detail = body.length < 200 ? `: ${body}` : "";
    } catch { /* ignore */ }
    throw new Error(`HTTP ${res.status}${detail}`);
  }
  return res.json() as Promise<T>;
}
