import { useCallback, useRef, useState } from "react";
import { sendMessage } from "./client";

/**
 * Hook for single-shot AI completions. Each `complete(prompt)` call:
 *   1. resets `result` to ""
 *   2. streams deltas — `result` updates in real time as text arrives
 *   3. sets isLoading=false on completion or error
 *
 * Use for "summarize this", "translate", "extract entities" features — i.e.
 * any prompt-response that isn't a multi-turn chat.
 */
export function useCompletion(opts?: { model?: string }) {
  const [result, setResult] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const complete = useCallback(
    async (prompt: string) => {
      setError(null);
      setResult("");
      setIsLoading(true);
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      let assembled = "";
      await sendMessage(
        [{ role: "user", content: prompt }],
        (delta) => {
          assembled += delta;
          setResult(assembled);
        },
        () => setIsLoading(false),
        (err) => {
          setError(err);
          setIsLoading(false);
        },
        abortRef.current.signal,
        opts?.model,
      );
      return assembled;
    },
    [opts?.model],
  );

  const abort = useCallback(() => abortRef.current?.abort(), []);

  return { complete, result, isLoading, error, abort, setResult };
}
