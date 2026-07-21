export type Message = { role: "user" | "assistant"; content: string };

export type SendOptions = {
  model?: string;
  previousResponseId?: string | null;
};

export async function sendMessage(
  input: string,
  opts: SendOptions,
  onDelta: (text: string) => void,
  onComplete: (responseId: string | null) => void,
  onError: (err: string) => void,
  signal?: AbortSignal,
) {
  let responseId: string | null = null;
  let settled = false;
  const finish = (id: string | null) => {
    if (!settled) {
      settled = true;
      onComplete(id);
    }
  };
  const fail = (msg: string) => {
    if (!settled) {
      settled = true;
      onError(msg);
    }
  };

  try {
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        model: opts.model,
        previous_response_id: opts.previousResponseId ?? undefined,
      }),
      signal,
    });
    if (!res.ok || !res.body) {
      fail("Request failed: " + res.status);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";
    let currentData = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          currentData = line.slice(6);
        } else if (line.startsWith(":")) {
          // SSE comment (keep-alive), ignore
        } else if (line === "") {
          if (currentEvent && currentData && currentData !== "[DONE]") {
            try {
              const parsed = JSON.parse(currentData);
              if (currentEvent === "response.output_text.delta") {
                if (typeof parsed.delta === "string") onDelta(parsed.delta);
              } else if (currentEvent === "response.created" || currentEvent === "response.completed") {
                if (parsed.response?.id) responseId = parsed.response.id;
                if (currentEvent === "response.completed") finish(responseId);
              } else if (currentEvent === "response.failed") {
                fail(parsed.response?.error?.message || "Stream error");
              }
            } catch {
              // skip malformed JSON
            }
          }
          currentEvent = "";
          currentData = "";
        }
      }
    }
  } catch (err) {
    if (!signal?.aborted) fail(err instanceof Error ? err.message : "Stream error");
  } finally {
    finish(null);
  }
}
