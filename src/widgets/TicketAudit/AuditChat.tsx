/**
 * AuditChat — post-audit AI chat panel.
 *
 * Appears after an audit is completed. The full audit context (scores,
 * deductions, markdown report) is injected into the system prompt so the
 * AI can answer any question about why a specific score was deducted.
 *
 * Also includes a Notes section for recording action items.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconCheck,
  IconCopy,
  IconMessageCircle,
  IconNotes,
  IconPlus,
  IconRobot,
  IconSend,
  IconTrash,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import type { TicketAudit } from "./data";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Note {
  id: number;
  text: string;
  createdAt: string;
}

// ── SSE stream helper ─────────────────────────────────────────────────────────
async function streamAuditChat(
  messages: Message[],
  auditContext: object,
  onDelta: (text: string) => void,
  onComplete: () => void,
  onError: (err: string) => void,
  signal?: AbortSignal,
) {
  const res = await fetch("/api/audit/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, auditContext }),
    signal,
  });

  if (!res.ok || !res.body) {
    onError(`Request failed: ${res.status}`);
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
          } catch { /* skip malformed */ }
        }
        currentEvent = "";
        currentData = "";
      }
    }
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export function AuditChat({ audit }: { audit: TicketAudit }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [activePanel, setActivePanel] = useState<"chat" | "notes">("chat");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build audit context to inject into every request
  const auditContext = {
    ticket_number: audit.ticket_number,
    agent_name: audit.agent_name,
    overall_score: audit.overall_score,
    grade: audit.grade,
    criteria_json: audit.criteria_json,
    analysis_markdown: audit.analysis_markdown,
    what_did_well: audit.what_did_well ?? null,
    what_missed: audit.what_missed ?? null,
  };

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
    setError(null);
    const userMsg: Message = { role: "user", content: text.trim() };
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setIsLoading(true);
    abortRef.current = new AbortController();
    let assembled = "";

    await streamAuditChat(
      history,
      auditContext,
      (delta) => {
        assembled += delta;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assembled };
          return updated;
        });
      },
      () => setIsLoading(false),
      (err) => { setError(err); setIsLoading(false); },
      abortRef.current.signal,
    );
  }, [messages, isLoading, auditContext]);

  function addNote() {
    const text = noteInput.trim();
    if (!text) return;
    setNotes((prev) => [
      ...prev,
      { id: Date.now(), text, createdAt: new Date().toLocaleTimeString() },
    ]);
    setNoteInput("");
  }

  function addNoteFromMessage(content: string) {
    const text = content.trim().slice(0, 500);
    if (!text) return;
    setNotes((prev) => [...prev, { id: Date.now(), text, createdAt: new Date().toLocaleTimeString() }]);
  }

  function copyNotes() {
    const text = notes.map((n, i) => `${i + 1}. ${n.text}`).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const suggestedQuestions = [
    "Why was my score deducted?",
    "What should I have done differently?",
    "Explain the SLA escalation finding",
    "What did I do well on this ticket?",
  ];

  return (
    <Card withBorder radius="md" p={0} style={{ borderColor: "var(--mantine-color-violet-7)" }}>
      {/* Header */}
      <Group
        justify="space-between"
        px="md"
        py="sm"
        style={{ borderBottom: "1px solid var(--mantine-color-dark-4)", background: "var(--mantine-color-dark-7)" }}
      >
        <Group gap="xs">
          <ThemeIcon size="sm" variant="light" color="violet" radius="md">
            <IconMessageCircle size={13} />
          </ThemeIcon>
          <Text size="sm" fw={700}>Audit Assistant</Text>
          <Badge size="xs" variant="light" color="violet">AI</Badge>
          {audit.agent_name && (
            <Text size="xs" c="dimmed">· {audit.agent_name} · {audit.ticket_number ?? "No ticket #"}</Text>
          )}
        </Group>
        <Group gap={6}>
          <Button
            size="xs"
            variant={activePanel === "chat" ? "filled" : "subtle"}
            color="violet"
            leftSection={<IconMessageCircle size={12} />}
            onClick={() => setActivePanel("chat")}
          >
            Chat
          </Button>
          <Button
            size="xs"
            variant={activePanel === "notes" ? "filled" : "subtle"}
            color="violet"
            leftSection={<IconNotes size={12} />}
            onClick={() => setActivePanel("notes")}
            rightSection={notes.length > 0 ? <Badge size="xs" circle color="orange">{notes.length}</Badge> : undefined}
          >
            Notes
          </Button>
        </Group>
      </Group>

      {/* Chat panel */}
      {activePanel === "chat" && (
        <Stack gap={0}>
          {/* Messages */}
          <ScrollArea h={340} viewportRef={scrollRef} px="md" py="sm">
            <Stack gap="sm">
              {messages.length === 0 && (
                <Stack gap="xs" align="center" py="md">
                  <ThemeIcon size={40} variant="light" color="violet" radius="xl">
                    <IconRobot size={20} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" ta="center">
                    Ask me anything about this audit — why a score was deducted, what the agent should have done, or what needs to be flagged.
                  </Text>
                  {/* Suggested questions */}
                  <Group gap="xs" justify="center" mt={4} style={{ flexWrap: "wrap" }}>
                    {suggestedQuestions.map((q) => (
                      <Button
                        key={q}
                        size="xs"
                        variant="light"
                        color="violet"
                        radius="xl"
                        onClick={() => send(q)}
                        style={{ fontSize: 11 }}
                      >
                        {q}
                      </Button>
                    ))}
                  </Group>
                </Stack>
              )}

              {messages.map((msg, i) => (
                <Box key={i}>
                  {msg.role === "user" ? (
                    <Group gap="xs" justify="flex-end" align="flex-start">
                      <Box
                        p="sm"
                        style={{
                          background: "var(--mantine-color-violet-9)",
                          borderRadius: "10px 10px 2px 10px",
                          maxWidth: "80%",
                        }}
                      >
                        <Text size="sm">{msg.content}</Text>
                      </Box>
                      <ThemeIcon size="xs" variant="light" color="violet" radius="xl">
                        <IconUser size={10} />
                      </ThemeIcon>
                    </Group>
                  ) : (
                    <Group gap="xs" align="flex-start">
                      <ThemeIcon size="xs" variant="light" color="violet" radius="xl" style={{ marginTop: 4 }}>
                        <IconRobot size={10} />
                      </ThemeIcon>
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Box
                          p="sm"
                          style={{
                            background: "var(--mantine-color-dark-6)",
                            border: "1px solid var(--mantine-color-dark-4)",
                            borderRadius: "10px 10px 10px 2px",
                          }}
                        >
                          {msg.content === "" && isLoading ? (
                            <Loader size="xs" color="violet" />
                          ) : (
                            <Box style={{ fontSize: 13 }}>
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </Box>
                          )}
                        </Box>
                        {msg.content && !isLoading && i === messages.length - 1 && (
                          <Group gap={4} mt={4}>
                            <Tooltip label="Add to notes">
                              <ActionIcon
                                size="xs"
                                variant="subtle"
                                color="orange"
                                onClick={() => { addNoteFromMessage(msg.content); setActivePanel("notes"); }}
                              >
                                <IconNotes size={11} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        )}
                      </Box>
                    </Group>
                  )}
                </Box>
              ))}

              {error && (
                <Text size="xs" c="red" ta="center">{error}</Text>
              )}
            </Stack>
          </ScrollArea>

          {/* Input */}
          <Box
            px="md"
            pb="sm"
            pt="xs"
            style={{ borderTop: "1px solid var(--mantine-color-dark-4)" }}
          >
            <Group gap="xs" align="flex-end">
              <Textarea
                style={{ flex: 1 }}
                placeholder="Ask about a specific deduction, what the agent missed, or what to flag…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                autosize
                minRows={1}
                maxRows={4}
                size="sm"
                radius="md"
                disabled={isLoading}
              />
              {isLoading ? (
                <ActionIcon
                  size="lg"
                  variant="light"
                  color="red"
                  radius="md"
                  onClick={() => abortRef.current?.abort()}
                >
                  <IconX size={16} />
                </ActionIcon>
              ) : (
                <ActionIcon
                  size="lg"
                  variant="filled"
                  color="violet"
                  radius="md"
                  disabled={!input.trim()}
                  onClick={() => send(input)}
                >
                  <IconSend size={16} />
                </ActionIcon>
              )}
            </Group>
            <Text size="xs" c="dimmed" mt={4}>Enter to send · Shift+Enter for new line</Text>
          </Box>
        </Stack>
      )}

      {/* Notes panel */}
      {activePanel === "notes" && (
        <Stack gap={0}>
          <Box px="md" pt="sm" pb="xs">
            <Group gap="xs" align="flex-end">
              <Textarea
                style={{ flex: 1 }}
                placeholder="Type a note or action item…"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    addNote();
                  }
                }}
                autosize
                minRows={1}
                maxRows={3}
                size="sm"
                radius="md"
              />
              <ActionIcon
                size="lg"
                variant="filled"
                color="orange"
                radius="md"
                disabled={!noteInput.trim()}
                onClick={addNote}
              >
                <IconPlus size={16} />
              </ActionIcon>
            </Group>
          </Box>

          <ScrollArea h={260} px="md">
            {notes.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" py="xl">
                No notes yet. Add action items here or click the notes icon on any AI response.
              </Text>
            ) : (
              <Stack gap="xs" pb="sm">
                {notes.map((note, i) => (
                  <Group key={note.id} gap="xs" align="flex-start" wrap="nowrap">
                    <Text size="xs" c="dimmed" fw={700} mt={2} style={{ flexShrink: 0, minWidth: 18 }}>
                      {i + 1}.
                    </Text>
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {note.text}
                      </Text>
                      <Text size="xs" c="dimmed">{note.createdAt}</Text>
                    </Box>
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color="red"
                      onClick={() => setNotes((prev) => prev.filter((n) => n.id !== note.id))}
                      style={{ flexShrink: 0 }}
                    >
                      <IconTrash size={11} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            )}
          </ScrollArea>

          {notes.length > 0 && (
            <Box
              px="md"
              pb="sm"
              pt="xs"
              style={{ borderTop: "1px solid var(--mantine-color-dark-4)" }}
            >
              <Group justify="space-between" align="center">
                <Text size="xs" c="dimmed">{notes.length} note{notes.length !== 1 ? "s" : ""}</Text>
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="light"
                    color={copied ? "green" : "gray"}
                    leftSection={copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
                    onClick={copyNotes}
                  >
                    {copied ? "Copied!" : "Copy all"}
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    leftSection={<IconTrash size={11} />}
                    onClick={() => setNotes([])}
                  >
                    Clear
                  </Button>
                </Group>
              </Group>
            </Box>
          )}
        </Stack>
      )}
    </Card>
  );
}
