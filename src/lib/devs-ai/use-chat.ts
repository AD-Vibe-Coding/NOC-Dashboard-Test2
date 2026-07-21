import { useState, useRef, useCallback } from "react";
import { sendMessage, type Message } from "./client";

export function useChat(model?: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previousResponseIdRef = useRef<string | null>(null);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: trimmed }, { role: "assistant", content: "" }]);
    setIsLoading(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    let assembled = "";

    await sendMessage(
      trimmed,
      { model, previousResponseId: previousResponseIdRef.current },
      (delta) => {
        assembled += delta;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assembled };
          return updated;
        });
      },
      (responseId) => {
        if (responseId) previousResponseIdRef.current = responseId;
        setIsLoading(false);
      },
      (err) => {
        setError(err);
        setIsLoading(false);
      },
      abortRef.current.signal,
    );
  }, [model]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    previousResponseIdRef.current = null;
    setMessages([]);
    setError(null);
    setIsLoading(false);
  }, []);

  return { messages, sendMessage: send, isLoading, error, abort, clear };
}
