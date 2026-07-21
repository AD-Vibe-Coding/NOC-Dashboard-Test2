import { useRef, useState, useEffect, useCallback } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconClipboard,
  IconCopy,
  IconPlayerStop,
  IconSend,
  IconSparkles,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";

import { sendMessage, type Message } from "../../lib/devs-ai/client";

/**
 * Reusable streaming-chat assistant for the NOC and Mobility Troubleshooter
 * widgets. Each variant supplies its own system prompt + "suggestions"
 * quick-start chip set so the same UI can be reused for different domains.
 */

export interface TroubleshooterChatProps {
  /**
   * System prompt fed as the very first message of the conversation. Drives
   * the assistant's tone + scope (NOC carrier troubleshooting vs Mobility
   * activation troubleshooting, for example).
   */
  systemPrompt: string;
  /**
   * Quick-start prompt chips shown when the chat is empty. Clicking one
   * fills the input box with that text so the technician can refine before
   * sending.
   */
  suggestions?: string[];
  /**
   * Accent color used for the assistant's avatar / send button / chip tint.
   * Matches the widget's iconColor from the registry.
   */
  accentColor: string;
  /**
   * Storage key used to persist the message history per-device (so
   * navigating away and back keeps the conversation).
   */
  storageKey: string;
  /**
   * Optional agent ID (UUID) to route this widget's chat to a specific
   * configured agent on the platform (e.g. the NOC Troubleshooting agent).
   * When omitted, the proxy falls back to the global `AI_AGENT_ID` env
   * var (typically "auto").
   */
  agentId?: string;
}

type StoredMessage = Message & { ts: number };

function loadHistory(key: string): StoredMessage[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m: unknown): m is StoredMessage =>
        typeof m === "object" &&
        m !== null &&
        "role" in m &&
        "content" in m &&
        (m as { role: string }).role !== "system",
    );
  } catch {
    return [];
  }
}

function saveHistory(key: string, messages: StoredMessage[]) {
  try {
    // Cap stored history at the last 50 messages to keep localStorage tidy.
    localStorage.setItem(key, JSON.stringify(messages.slice(-50)));
  } catch {
    // ignore quota errors
  }
}

export function TroubleshooterChat({
  systemPrompt,
  suggestions = [],
  accentColor,
  storageKey,
  agentId,
}: TroubleshooterChatProps) {
  const [messages, setMessages] = useState<StoredMessage[]>(() =>
    loadHistory(storageKey),
  );
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Persist messages every time they change.
  useEffect(() => {
    saveHistory(storageKey, messages);
  }, [messages, storageKey]);

  // Auto-scroll to the bottom whenever a new chunk arrives.
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isStreaming]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      setError(null);
      setInput("");

      const userMessage: StoredMessage = {
        role: "user",
        content: trimmed,
        ts: Date.now(),
      };
      const placeholder: StoredMessage = {
        role: "assistant",
        content: "",
        ts: Date.now(),
      };
      const next = [...messages, userMessage, placeholder];
      setMessages(next);
      setIsStreaming(true);

      // Build the wire payload: system prompt + full conversation. We
      // prepend the system prompt as an extra user turn so the upstream
      // chat-completions endpoint behaves consistently across agent IDs
      // and raw LLM models — both treat the first user message as the
      // de-facto instruction frame.
      const wire = [
        systemPrompt,
        ...next.slice(0, -1).map(({ role, content }) => `${role.toUpperCase()}: ${content}`),
      ].join("\n\n");

      let assembled = "";
      abortRef.current = new AbortController();

      await sendMessage(
        wire,
        { model: agentId, previousResponseId: null },
        (delta: string) => {
          assembled += delta;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: assembled,
            };
            return updated;
          });
        },
        () => {
          setIsStreaming(false);
        },
        (err) => {
          setError(err);
          setIsStreaming(false);
          // Drop the empty assistant placeholder on error.
          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            if (last.role === "assistant" && last.content === "") {
              return prev.slice(0, -1);
            }
            return prev;
          });
        },
        abortRef.current.signal,
      );
    },
    [messages, systemPrompt, isStreaming, agentId],
  );

  function stop() {
    abortRef.current?.abort();
    setIsStreaming(false);
  }

  function clearChat() {
    if (isStreaming) abortRef.current?.abort();
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  }

  async function copyMessage(idx: number) {
    try {
      await navigator.clipboard.writeText(messages[idx].content);
      setCopiedIndex(idx);
      setTimeout(() => setCopiedIndex(null), 1200);
    } catch {
      /* clipboard blocked */
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send(input);
    }
  }

  const hasMessages = messages.length > 0;

  return (
    <Stack gap="md" style={{ height: "100%", minHeight: 0 }}>
      {/* ============================== Header row ============================== */}
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="xs" wrap="nowrap">
          <Badge
            variant="light"
            color={accentColor}
            leftSection={<IconSparkles size={11} />}
          >
            AI Assistant
          </Badge>
          <Text size="xs" c="dimmed">
            {hasMessages
              ? `${messages.filter((m) => m.role === "user").length} question${
                  messages.filter((m) => m.role === "user").length === 1
                    ? ""
                    : "s"
                } in this thread`
              : "Start a new troubleshooting thread"}
          </Text>
        </Group>
        <Group gap={6} wrap="nowrap">
          {hasMessages && (
            <Tooltip label="Clear conversation">
              <ActionIcon
                variant="subtle"
                color="red"
                onClick={clearChat}
                aria-label="Clear conversation"
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>

      {/* ============================== Message thread ========================== */}
      <Box
        style={{
          flex: 1,
          minHeight: 0,
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: 12,
          background:
            "color-mix(in srgb, var(--mantine-color-body) 92%, var(--widget-tile-surface))",
          overflow: "hidden",
        }}
      >
        <ScrollArea
          viewportRef={scrollAreaRef}
          h="100%"
          type="auto"
          offsetScrollbars
        >
          <Box p="md">
            {!hasMessages ? (
              <EmptyState
                accentColor={accentColor}
                suggestions={suggestions}
                onPick={(text) => {
                  setInput(text);
                  inputRef.current?.focus();
                }}
              />
            ) : (
              <Stack gap="md">
                {messages.map((m, idx) => (
                  <MessageBubble
                    key={idx}
                    message={m}
                    accentColor={accentColor}
                    isStreamingTail={
                      isStreaming &&
                      idx === messages.length - 1 &&
                      m.role === "assistant"
                    }
                    onCopy={() => copyMessage(idx)}
                    copied={copiedIndex === idx}
                  />
                ))}
              </Stack>
            )}
          </Box>
        </ScrollArea>
      </Box>

      {/* ============================== Error banner ============================ */}
      {error && (
        <Alert
          color="red"
          variant="light"
          radius="md"
          icon={<IconAlertCircle size={14} />}
          withCloseButton
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      {/* ============================== Composer ============================== */}
      <Box>
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder="Describe the issue, paste error text, share the customer or carrier name…"
          autosize
          minRows={2}
          maxRows={6}
          disabled={isStreaming}
          styles={{
            input: {
              background: "var(--widget-tile-surface)",
              borderColor: "var(--mantine-color-default-border)",
            },
          }}
        />
        <Group justify="space-between" mt={6} wrap="nowrap">
          <Text size="xs" c="dimmed">
            <kbd
              style={{
                background: "var(--widget-tile-surface)",
                border: "1px solid var(--mantine-color-default-border)",
                borderRadius: 4,
                padding: "0 4px",
                fontSize: 10,
              }}
            >
              ⌘
            </kbd>
            {"  "}
            <kbd
              style={{
                background: "var(--widget-tile-surface)",
                border: "1px solid var(--mantine-color-default-border)",
                borderRadius: 4,
                padding: "0 4px",
                fontSize: 10,
              }}
            >
              ↵
            </kbd>{" "}
            to send
          </Text>
          <Group gap="xs" wrap="nowrap">
            {isStreaming ? (
              <Button
                variant="light"
                color="red"
                size="sm"
                leftSection={<IconPlayerStop size={14} />}
                onClick={stop}
              >
                Stop
              </Button>
            ) : (
              <Button
                color={accentColor}
                size="sm"
                leftSection={<IconSend size={14} />}
                onClick={() => void send(input)}
                disabled={!input.trim()}
              >
                Send
              </Button>
            )}
          </Group>
        </Group>
      </Box>
    </Stack>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 Sub-components                             */
/* -------------------------------------------------------------------------- */

function EmptyState({
  accentColor,
  suggestions,
  onPick,
}: {
  accentColor: string;
  suggestions: string[];
  onPick: (text: string) => void;
}) {
  return (
    <Stack align="center" gap="md" py="xl">
      <Box
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: `color-mix(in srgb, var(--mantine-color-${accentColor}-6) 18%, var(--widget-tile-surface))`,
          border: `1px solid color-mix(in srgb, var(--mantine-color-${accentColor}-6) 40%, transparent)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: `var(--mantine-color-${accentColor}-6)`,
        }}
      >
        <IconSparkles size={26} />
      </Box>
      <Box ta="center" maw={460}>
        <Text fw={600} c="bright" size="md">
          How can I help you troubleshoot?
        </Text>
        <Text size="sm" c="dimmed" mt={4}>
          Share the customer or carrier, what the ticket says, what you've
          already tried — I'll suggest next steps, escalation paths, or commands
          to run.
        </Text>
      </Box>
      {suggestions.length > 0 && (
        <Stack gap={6} w="100%" maw={520} mt="sm">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" ta="center">
            Try one of these
          </Text>
          {suggestions.map((s) => (
            <Button
              key={s}
              variant="default"
              size="sm"
              fullWidth
              onClick={() => onPick(s)}
              styles={{
                inner: { justifyContent: "flex-start" },
                root: {
                  background: "var(--widget-tile-surface)",
                  borderColor: "var(--mantine-color-default-border)",
                  fontWeight: 500,
                  height: "auto",
                  whiteSpace: "normal",
                  textAlign: "left",
                  paddingTop: 8,
                  paddingBottom: 8,
                },
                label: {
                  whiteSpace: "normal",
                  textAlign: "left",
                  lineHeight: 1.35,
                },
              }}
              leftSection={<IconSparkles size={14} />}
            >
              {s}
            </Button>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function MessageBubble({
  message,
  accentColor,
  isStreamingTail,
  onCopy,
  copied,
}: {
  message: StoredMessage;
  accentColor: string;
  isStreamingTail: boolean;
  onCopy: () => void;
  copied: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <Group
      align="flex-start"
      wrap="nowrap"
      gap="sm"
      style={{ flexDirection: isUser ? "row-reverse" : "row" }}
    >
      <Box
        style={{
          flex: "0 0 32px",
          width: 32,
          height: 32,
          borderRadius: 10,
          background: isUser
            ? "var(--widget-tile-surface)"
            : `color-mix(in srgb, var(--mantine-color-${accentColor}-6) 22%, var(--widget-tile-surface))`,
          border: `1px solid ${
            isUser
              ? "var(--mantine-color-default-border)"
              : `color-mix(in srgb, var(--mantine-color-${accentColor}-6) 45%, transparent)`
          }`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: isUser
            ? "var(--mantine-color-dimmed)"
            : `var(--mantine-color-${accentColor}-6)`,
        }}
      >
        {isUser ? <IconUser size={16} /> : <IconSparkles size={16} />}
      </Box>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Box
          style={{
            background: isUser
              ? `color-mix(in srgb, var(--mantine-color-${accentColor}-6) 10%, var(--widget-tile-surface))`
              : "var(--widget-tile-surface)",
            border: `1px solid ${
              isUser
                ? `color-mix(in srgb, var(--mantine-color-${accentColor}-6) 30%, transparent)`
                : "var(--mantine-color-default-border)"
            }`,
            borderRadius: 12,
            padding: "10px 14px",
            color: "var(--mantine-color-text)",
          }}
        >
          {isUser ? (
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {message.content}
            </Text>
          ) : message.content ? (
            <Box className="ai-markdown" style={{ fontSize: 14 }}>
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </Box>
          ) : (
            <Group gap={6}>
              <Loader size="xs" color={accentColor} />
              <Text size="sm" c="dimmed">
                Thinking…
              </Text>
            </Group>
          )}
          {isStreamingTail && message.content && (
            <Text size="xs" c="dimmed" mt={4}>
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: `var(--mantine-color-${accentColor}-6)`,
                  marginRight: 6,
                  verticalAlign: "middle",
                  animation: "dashboard-pulse 1.4s ease-out infinite",
                }}
              />
              streaming…
            </Text>
          )}
        </Box>
        {!isUser && message.content && !isStreamingTail && (
          <Group gap={4} mt={4} wrap="nowrap">
            <Tooltip label={copied ? "Copied" : "Copy response"} withArrow>
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                onClick={onCopy}
                aria-label="Copy response"
              >
                {copied ? (
                  <IconClipboard size={12} />
                ) : (
                  <IconCopy size={12} />
                )}
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
      </Box>
    </Group>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Tile-side preview                             */
/* -------------------------------------------------------------------------- */

interface TilePreviewProps {
  storageKey: string;
  accentColor: string;
}

export function TroubleshooterTilePreview({
  storageKey,
  accentColor,
}: TilePreviewProps) {
  // Tile shows a small recency chip + last-question echo so the dashboard
  // surfaces "what was your last troubleshoot" without needing to expand.
  const [history, setHistory] = useState<StoredMessage[]>(() =>
    loadHistory(storageKey),
  );

  // Re-read storage when the tile is mounted — covers re-renders without
  // adding global state plumbing.
  useEffect(() => {
    setHistory(loadHistory(storageKey));
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey) setHistory(loadHistory(storageKey));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const totalQuestions = history.filter((m) => m.role === "user").length;

  if (!history.length) {
    return (
      <Stack gap="xs" style={{ height: "100%" }}>
        <Group gap={6}>
          <Badge
            size="xs"
            variant="light"
            color={accentColor}
            leftSection={<IconSparkles size={10} />}
          >
            AI Assistant
          </Badge>
        </Group>
        <Text size="xs" c="dimmed">
          No conversations yet. Click to start a new troubleshooting thread.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="xs" style={{ height: "100%" }}>
      <Group gap="xs" justify="space-between">
        <Badge
          size="xs"
          variant="light"
          color={accentColor}
          leftSection={<IconSparkles size={10} />}
        >
          AI Assistant
        </Badge>
        <Text size="xs" c="dimmed">
          {totalQuestions} question{totalQuestions === 1 ? "" : "s"} saved
        </Text>
      </Group>
      {lastUser && (
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Last question
          </Text>
          <Text size="sm" lineClamp={3} mt={2}>
            {lastUser.content}
          </Text>
        </Box>
      )}
    </Stack>
  );
}

export type { Message };
