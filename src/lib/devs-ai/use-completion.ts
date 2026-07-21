import { useCallback, useRef, useState } from "react";
import { sendMessage } from "./client";

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
        prompt,
        { model: opts?.model, previousResponseId: null },
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
      );
      return assembled;
    },
    [opts?.model],
  );

  const abort = useCallback(() => abortRef.current?.abort(), []);

  return { complete, result, isLoading, error, abort, setResult };
}
