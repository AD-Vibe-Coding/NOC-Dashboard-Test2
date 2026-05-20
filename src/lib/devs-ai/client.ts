// SSE client for the Devs.ai chat completions endpoint (via /api/ai/chat
// server proxy). Parses the platform's named event stream:
//
//   event: message.delta
//   data: { "type": "message.delta", "content": { "type": "text", "text": "..." } }
//
//   event: message.complete
//   data: { "type": "message.complete" }
//
//   event: message.error
//   data: { "error": "..." }
//
// DO NOT modify the parser logic — it correctly handles buffering, partial
// chunks, keep-alive comments, and blank-line event boundaries.

export type Message = { role: "user" | "assistant"; content: string };

export async function sendMessage(
  messages: Message[],
  onDelta: (text: string) => void,
  onComplete: () => void,
  onError: (err: string) => void,
  signal?: AbortSignal,
  model?: string,
) {
  let res: Response;
  try {
    res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, model }),
      signal,
    });
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
    return;
  }
  if (!res.ok || !res.body) {
    onError("Request failed: " + res.status);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let currentData = "";

  try {
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
          if (currentEvent && currentData) {
            try {
              const parsed = JSON.parse(currentData);
              if (currentEvent === "message.delta" && parsed.content?.text) {
                onDelta(parsed.content.text);
              } else if (currentEvent === "message.complete") {
                onComplete();
              } else if (currentEvent === "message.error") {
                onError(parsed.error || "Stream error");
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
    onError(err instanceof Error ? err.message : String(err));
  }
}
