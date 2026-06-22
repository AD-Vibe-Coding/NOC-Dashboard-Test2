import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
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
  IconArrowUp,
  IconBolt,
  IconCopy,
  IconDownload,
  IconPlayerStop,
  IconRefresh,
  IconShieldLock,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import { sendMessage, type Message } from "../../lib/devs-ai/client";
import { useIdentity } from "../../lib/identity";
import { downloadBlob } from "../../lib/download";
import { WidgetFrame } from "../WidgetFrame";
import { WidgetTile } from "../WidgetTile";

const FORTIGATE_AGENT_ID = "f7675879-e88d-4954-ade4-a88f62e2852f";

const INCIDENT_TEMPLATES: Array<{ label: string; prompt: string }> = [
  {
    label: "IPsec VPN down",
    prompt:
      "Incident template: FortiGate IPsec VPN down. Build a step-by-step triage checklist with tunnel status checks, phase1/phase2 validation, routing/NAT verification, relevant CLI commands, GUI paths, and escalation data to gather.",
  },
  {
    label: "SSL VPN issue",
    prompt:
      "Incident template: FortiGate / FortiClient SSL VPN issue. Provide ordered diagnostics covering user auth, portal config, certificates, client logs, EMS dependencies, and what to verify on both client and FortiGate.",
  },
  {
    label: "HA failover",
    prompt:
      "Incident template: FortiGate HA failover or cluster instability. Generate a troubleshooting workflow covering HA state, heartbeat links, session sync, firmware parity, split-brain risk, and commands to collect before escalation.",
  },
  {
    label: "High CPU / conserve mode",
    prompt:
      "Incident template: FortiGate high CPU or memory conserve mode. Give a triage runbook with top diagnostics, process checks, traffic/session review, policy/security-profile impact, and safe remediation guidance.",
  },
];

type StoredMessage = Message & { ts: number };

function loadHistory(storageKey: string): StoredMessage[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m: unknown): m is StoredMessage =>
        typeof m === "object" &&
        m !== null &&
        "role" in m &&
        "content" in m &&
        typeof (m as { role?: string }).role === "string" &&
        typeof (m as { content?: string }).content === "string",
    );
  } catch {
    return [];
  }
}

function saveHistory(storageKey: string, messages: StoredMessage[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(messages.slice(-80)));
  } catch {
    // ignore storage quota errors
  }
}

function buildTicketNotes(messages: StoredMessage[]): string {
  const latestUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "N/A";
  const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "N/A";
  const timestamp = new Date().toLocaleString();

  return [
    "Fortigate Incident Notes",
    `Generated: ${timestamp}`,
    "",
    "Issue Summary:",
    latestUser,
    "",
    "AI Troubleshooting Guidance:",
    latestAssistant,
    "",
    "Conversation Excerpt:",
    ...messages.slice(-8).map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`),
  ].join("\n");
}

export function FortigateTroubleshooterTile({ onExpand }: { onExpand: () => void }) {
  return (
    <WidgetTile
      title="Fortigate Troubleshooting Agent"
      description="AI assistant for FortiGate incident triage"
      icon={IconShieldLock}
      iconColor="orange"
      onExpand={onExpand}
      status={{ label: "AI ready", color: "orange" }}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon radius="md" variant="light" color="orange">
            <IconBolt size={16} />
          </ThemeIcon>
          <div style={{ flex: 1 }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Agent-backed knowledge
            </Text>
            <Text fw={700}>Fortinet Knowledge Base</Text>
          </div>
          <Badge variant="light" color="orange">
            Streaming
          </Badge>
        </Group>
        <Text size="sm" c="dimmed">
          Ask troubleshooting questions and get structured, step-by-step FortiGate guidance with CLI commands, GUI paths, and verified solutions.
        </Text>
      </Stack>
    </WidgetTile>
  );
}

export function FortigateTroubleshooterWidget() {
  const { identity } = useIdentity();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const storageKey = useMemo(
    () => `fortigate-troubleshooter:history:${identity?.email ?? identity?.name ?? "anonymous"}`,
    [identity?.email, identity?.name],
  );

  useEffect(() => {
    setMessages(loadHistory(storageKey));
  }, [storageKey]);

  useEffect(() => {
    saveHistory(storageKey, messages);
  }, [messages, storageKey]);

  const canSend = input.trim().length > 0 && !isLoading;

  const history = useMemo(() => {
    if (messages.length > 0) return messages;
    return [
      {
        role: "assistant" as const,
        content:
          "Hi! I’m your Fortigate Troubleshooting Agent. Share the FortiGate symptoms, topology, logs, and what’s already been tried, and I’ll help you build a clear triage path.",
        ts: Date.now(),
      },
    ];
  }, [messages]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    setError(null);
    setInput("");
    setIsLoading(true);

    const userMsg: StoredMessage = { role: "user", content: trimmed, ts: Date.now() };
    const assistantPlaceholder: StoredMessage = { role: "assistant", content: "", ts: Date.now() };
    const next = [...messages, userMsg, assistantPlaceholder];
    setMessages(next);

    const wire: Message[] = next.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));

    let assembled = "";
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    await sendMessage(
      wire,
      (delta) => {
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
      () => setIsLoading(false),
      (err) => {
        setError(err);
        setIsLoading(false);
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant" && !last.content) return updated.slice(0, -1);
          return updated;
        });
      },
      abortRef.current.signal,
      FORTIGATE_AGENT_ID,
    );

    setTimeout(() => {
      viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" });
    }, 30);
  };

  const clear = () => {
    abortRef.current?.abort();
    setIsLoading(false);
    setError(null);
    setMessages([]);
  };

  const stop = () => {
    abortRef.current?.abort();
    setIsLoading(false);
  };

  const copyTicketNotes = async () => {
    const notes = buildTicketNotes(messages);
    try {
      await navigator.clipboard.writeText(notes);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard may be blocked
    }
  };

  const exportTicketNotes = () => {
    const notes = buildTicketNotes(messages);
    const blob = new Blob([notes], { type: "text/plain;charset=utf-8" });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBlob(blob, `fortigate-ticket-notes-${stamp}.txt`);
  };

  return (
    <WidgetFrame
      title="Fortigate Troubleshooting Agent"
      subtitle="Powered by your Fortinet knowledge agent"
      icon={IconShieldLock}
      iconColor="orange"
      status={{ label: isLoading ? "Streaming" : "Ready", color: "orange" }}
      headerActions={
        <Group gap="xs">
          <Tooltip label={copied ? "Copied" : "Copy ticket notes"}>
            <ActionIcon variant="subtle" color="gray" onClick={() => void copyTicketNotes()} aria-label="Copy ticket notes" disabled={messages.length === 0}>
              <IconCopy size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Export ticket notes">
            <ActionIcon variant="subtle" color="gray" onClick={exportTicketNotes} aria-label="Export ticket notes" disabled={messages.length === 0}>
              <IconDownload size={16} />
            </ActionIcon>
          </Tooltip>
          <ActionIcon variant="subtle" color="gray" onClick={clear} aria-label="Clear chat">
            <IconRefresh size={16} />
          </ActionIcon>
          {isLoading && (
            <ActionIcon variant="subtle" color="red" onClick={stop} aria-label="Stop response">
              <IconPlayerStop size={16} />
            </ActionIcon>
          )}
        </Group>
      }
    >
      <Stack gap="md">
        <Card withBorder radius="lg" p="sm">
          <Text size="xs" c="dimmed" mb="xs" fw={700} tt="uppercase">
            Incident templates
          </Text>
          <Group gap="xs" wrap="wrap">
            {INCIDENT_TEMPLATES.map((template) => (
              <Button
                key={template.label}
                size="xs"
                variant="light"
                color="orange"
                disabled={isLoading}
                onClick={() => void send(template.prompt)}
              >
                {template.label}
              </Button>
            ))}
          </Group>
        </Card>

        <Card withBorder radius="lg" p="md">
          <ScrollArea h={420} viewportRef={viewport} offsetScrollbars>
            <Stack gap="sm">
              {history.map((m, idx) => {
                const isUser = m.role === "user";
                return (
                  <Card
                    key={`${m.role}-${idx}`}
                    withBorder
                    radius="md"
                    p="sm"
                    bg={isUser ? "var(--mantine-color-orange-9)" : "var(--mantine-color-dark-6)"}
                  >
                    <Stack gap={6}>
                      <Text size="xs" c="dimmed" fw={700} tt="uppercase">
                        {isUser ? "You" : "Assistant"}
                      </Text>
                      {isUser ? (
                        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{m.content}</Text>
                      ) : (
                        <div className="prose prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-li:my-0">
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                        </div>
                      )}
                    </Stack>
                  </Card>
                );
              })}
            </Stack>
          </ScrollArea>
        </Card>

        {error ? (
          <Text size="sm" c="red.4">
            {error}
          </Text>
        ) : null}

        <Group align="end" gap="sm" wrap="nowrap">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            placeholder="Ask a FortiGate troubleshooting question…"
            autosize
            minRows={2}
            maxRows={6}
            style={{ flex: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <ActionIcon
            size="xl"
            radius="xl"
            variant="filled"
            color="orange"
            onClick={() => void send(input)}
            disabled={!canSend}
            aria-label="Send"
          >
            <IconArrowUp size={18} />
          </ActionIcon>
        </Group>
      </Stack>
    </WidgetFrame>
  );
}
