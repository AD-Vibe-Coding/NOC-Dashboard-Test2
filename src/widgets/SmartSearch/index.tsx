import { useRef, useState } from "react";
import {
  ActionIcon,
  Box,
  Card,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconSearch,
  IconSend,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import { useCompletion } from "../../lib/devs-ai/use-completion";
import { useIdentity } from "../../lib/identity";
import { WidgetFrame } from "../WidgetFrame";

export { SmartSearchTile } from "./Tile";

// Widget descriptions are inlined here instead of importing from ../registry
// to avoid a circular dependency (registry imports SmartSearchWidget).
const WIDGET_LIST = [
  { title: "My Day", desc: "Your tickets + calls for today" },
  { title: "Team Performance", desc: "Excel-imported team metrics + per-member drill-down" },
  { title: "LogicMonitor", desc: "Live alert feed + device health" },
  { title: "Zoom Queue", desc: "Who's on a call and for how long" },
  { title: "Break Tracker", desc: "Team breaks via Slack + local" },
  { title: "QS Escalation Contacts", desc: "Carrier escalation lists" },
  { title: "Ticket Summary", desc: "AI summarizes uploaded .mhtml tickets" },
  { title: "WFH Requests", desc: "Apply for work-from-home approval" },
  { title: "Escalation Email", desc: "AI drafts the ESC-MGR Alert email from your notes" },
  { title: "Shift Handover", desc: "AI structures your ticket notes into a handover message" },
  { title: "Email Polisher", desc: "Polish a draft for customer, internal, or carrier" },
  { title: "NOC Troubleshooter", desc: "AI agent for network + circuit troubleshooting" },
  { title: "Mobility Troubleshooter", desc: "AI agent for wireless + device troubleshooting" },
];

const SYSTEM_CONTEXT = `You are the vCom NOC Operations Dashboard AI assistant. You help NOC operators find information, troubleshoot issues, and navigate the dashboard efficiently.

Available dashboard widgets:
${WIDGET_LIST.map((w) => `- **${w.title}**: ${w.desc}`).join("\n")}

Guidelines:
- Be concise and direct — NOC operators need quick answers during incidents.
- When relevant, suggest which dashboard widget to open (use the exact title).
- For troubleshooting, provide step-by-step guidance.
- For carrier-related queries, mention the QS Escalation Contacts widget.
- For ticket-related queries, mention the Ticket Summary or Shift Handover widgets.
- Format responses with markdown for readability.
- If you don't know something, say so clearly — don't guess during an outage.`;

interface SearchResult {
  query: string;
  answer: string;
  timestamp: number;
}

export function SmartSearchWidget() {
  const ai = useCompletion({ model: "auto" });
  const { identity } = useIdentity();
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function handleSearch() {
    const q = query.trim();
    if (!q || ai.isLoading) return;

    const userContext = identity
      ? `[User: ${identity.name}, Role: ${identity.role}]`
      : "[User: not signed in]";

    const prompt = `${SYSTEM_CONTEXT}\n\n${userContext}\n\nUser query: ${q}`;

    setQuery("");
    const answer = await ai.complete(prompt);
    if (answer) {
      setHistory((prev) => [
        { query: q, answer, timestamp: Date.now() },
        ...prev,
      ]);
      ai.setResult("");
    }
    // Scroll to top after result
    setTimeout(() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }), 100);
  }

  function clearHistory() {
    setHistory([]);
    ai.setResult("");
  }

  return (
    <WidgetFrame
      title="Smart Search"
      subtitle="AI-powered natural language search across the dashboard"
      icon={IconSearch}
      iconColor="indigo"
    >
      <Stack gap="md" style={{ height: "calc(100vh - 200px)", maxHeight: 800 }}>
        {/* Search input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSearch();
          }}
        >
          <TextInput
            ref={inputRef}
            placeholder="Ask anything… e.g. 'How do I escalate a Comcast ticket?' or 'Show me team break stats'"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            leftSection={<IconSearch size={16} />}
            rightSection={
              ai.isLoading ? (
                <Loader size={16} />
              ) : (
                <ActionIcon
                  variant="filled"
                  color="indigo"
                  size="sm"
                  radius="xl"
                  onClick={handleSearch}
                  disabled={!query.trim()}
                >
                  <IconSend size={14} />
                </ActionIcon>
              )
            }
            size="md"
            radius="xl"
            styles={{
              input: {
                paddingRight: 42,
                border: "2px solid var(--mantine-color-indigo-3)",
              },
            }}
          />
        </form>

        {/* Streaming result */}
        {ai.isLoading && ai.result && (
          <Card withBorder radius="lg" p="md" style={{ position: "relative" }}>
            <Group gap={8} mb="xs">
              <ThemeIcon size="sm" radius="xl" variant="light" color="indigo">
                <IconSparkles size={12} />
              </ThemeIcon>
              <Text size="xs" fw={600} c="indigo">
                Searching…
              </Text>
              <Loader size={12} color="indigo" />
            </Group>
            <Box
              style={{ fontSize: 14, lineHeight: 1.6 }}
              className="prose-container"
            >
              <ReactMarkdown>{ai.result}</ReactMarkdown>
            </Box>
          </Card>
        )}

        {/* Error */}
        {ai.error && (
          <Card withBorder radius="lg" p="md" bg="red.0">
            <Text size="sm" c="red">
              {ai.error}
            </Text>
          </Card>
        )}

        {/* History */}
        <ScrollArea
          viewportRef={scrollRef}
          style={{ flex: 1, minHeight: 0 }}
          scrollbarSize={6}
        >
          <Stack gap="md">
            {history.length > 0 && (
              <Group justify="space-between" align="center">
                <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                  Recent searches
                </Text>
                <ActionIcon
                  variant="subtle"
                  size="xs"
                  color="gray"
                  onClick={clearHistory}
                >
                  <IconX size={12} />
                </ActionIcon>
              </Group>
            )}
            {history.map((item) => (
              <Card
                key={item.timestamp}
                withBorder
                radius="lg"
                p="md"
              >
                <Group gap={8} mb="xs">
                  <ThemeIcon
                    size="sm"
                    radius="xl"
                    variant="light"
                    color="indigo"
                  >
                    <IconSparkles size={12} />
                  </ThemeIcon>
                  <Text size="sm" fw={600} style={{ flex: 1 }}>
                    {item.query}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {new Date(item.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                </Group>
                <Box
                  style={{ fontSize: 14, lineHeight: 1.6 }}
                  className="prose-container"
                >
                  <ReactMarkdown>{item.answer}</ReactMarkdown>
                </Box>
              </Card>
            ))}

            {history.length === 0 && !ai.isLoading && (
              <Box ta="center" py="xl">
                <ThemeIcon
                  size={48}
                  radius="xl"
                  variant="light"
                  color="indigo"
                  mx="auto"
                  mb="md"
                >
                  <IconSearch size={24} />
                </ThemeIcon>
                <Text size="lg" fw={600} mb={4}>
                  Ask me anything
                </Text>
                <Text size="sm" c="dimmed" maw={400} mx="auto">
                  Try "How do I escalate a Comcast ticket?", "What's the break
                  policy?", or "Help me draft a shift handover email".
                </Text>
              </Box>
            )}
          </Stack>
        </ScrollArea>
      </Stack>
    </WidgetFrame>
  );
}
