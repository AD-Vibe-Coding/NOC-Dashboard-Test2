import { useMemo, useRef, useState, useEffect } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconMessageCircle,
  IconSend,
  IconX,
  IconSparkles,
  IconTrash,
  IconPlayerStop,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import { useChat } from "../lib/devs-ai/use-chat";

type Props = {
  model?: string;
};

export function AutoChatAssistant({ model = "auto" }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const viewport = useRef<HTMLDivElement | null>(null);
  const { messages, sendMessage, isLoading, error, abort, clear } = useChat(model);

  useEffect(() => {
    if (!viewport.current) return;
    viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [messages, open]);

  const hasMessages = messages.length > 0;
  const canSend = draft.trim().length > 0 && !isLoading;

  const intro = useMemo(
    () => "Ask Auto anything about your current workflows, meetings, tickets, or summaries.",
    [],
  );

  return (
    <>
      {open ? (
        <Card
          withBorder
          radius="lg"
          p="sm"
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            width: 380,
            height: 560,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
          }}
        >
          <Group justify="space-between" mb="xs">
            <Group gap="xs">
              <ThemeIcon color="appdirect" variant="light" radius="md">
                <IconSparkles size={16} />
              </ThemeIcon>
              <Box>
                <Text fw={700} size="sm">Auto Assistant</Text>
                <Text size="xs" c="dimmed">Streaming answers · chat history</Text>
              </Box>
            </Group>
            <Group gap={4}>
              {hasMessages && (
                <Tooltip label="Clear chat">
                  <ActionIcon variant="subtle" color="gray" onClick={clear}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
              <ActionIcon variant="subtle" color="gray" onClick={() => setOpen(false)}>
                <IconX size={14} />
              </ActionIcon>
            </Group>
          </Group>

          <Card withBorder radius="md" p="xs" style={{ flex: 1, minHeight: 0 }}>
            <ScrollArea h="100%" viewportRef={viewport}>
              <Stack gap="xs" p={4}>
                {!hasMessages && (
                  <Text size="sm" c="dimmed">{intro}</Text>
                )}

                {messages.map((msg, i) => (
                  <Box
                    key={`${msg.role}-${i}`}
                    style={{
                      alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                      maxWidth: "90%",
                    }}
                  >
                    <Card
                      radius="md"
                      p="xs"
                      withBorder
                      bg={msg.role === "user" ? "appdirect.9" : undefined}
                    >
                      <Group justify="space-between" mb={4}>
                        <Badge size="xs" variant="light" color={msg.role === "user" ? "appdirect" : "grape"}>
                          {msg.role === "user" ? "You" : "Auto"}
                        </Badge>
                      </Group>
                      {msg.role === "assistant" ? (
                        <Box style={{ fontSize: 13, lineHeight: 1.45 }}>
                          <ReactMarkdown>{msg.content || "…"}</ReactMarkdown>
                        </Box>
                      ) : (
                        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{msg.content}</Text>
                      )}
                    </Card>
                  </Box>
                ))}
                {error && <Text size="xs" c="red">{error}</Text>}
              </Stack>
            </ScrollArea>
          </Card>

          <Stack gap={6} mt="xs">
            <Textarea
              placeholder="Message Auto…"
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              autosize
              minRows={2}
              maxRows={5}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!canSend) return;
                  const text = draft;
                  setDraft("");
                  void sendMessage(text);
                }
              }}
            />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Enter to send · Shift+Enter newline</Text>
              <Group gap="xs">
                {isLoading && (
                  <Button size="xs" variant="light" color="red" leftSection={<IconPlayerStop size={14} />} onClick={abort}>
                    Stop
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="filled"
                  color="appdirect"
                  rightSection={<IconSend size={14} />}
                  disabled={!canSend}
                  onClick={() => {
                    if (!canSend) return;
                    const text = draft;
                    setDraft("");
                    void sendMessage(text);
                  }}
                >
                  Send
                </Button>
              </Group>
            </Group>
          </Stack>
        </Card>
      ) : (
        <Tooltip label="Open Auto Assistant">
          <ActionIcon
            size="xl"
            radius="xl"
            variant="filled"
            color="appdirect"
            onClick={() => setOpen(true)}
            style={{
              position: "fixed",
              right: 20,
              bottom: 20,
              zIndex: 1000,
              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            }}
          >
            <IconMessageCircle size={20} />
          </ActionIcon>
        </Tooltip>
      )}
    </>
  );
}
