import { useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconArrowRight,
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

interface WidgetMeta {
  id: string;
  title: string;
  desc: string;
  keywords: string[];
}

const WIDGET_LIST: WidgetMeta[] = [
  {
    id: "my-day",
    title: "My Day",
    desc: "Your tickets + calls for today",
    keywords: ["my day", "today", "tickets", "calls", "workload", "queue"],
  },
  {
    id: "performance-tracker",
    title: "Team Performance",
    desc: "Excel-imported team metrics + per-member drill-down",
    keywords: ["performance", "kpi", "metrics", "score", "dispute", "audit"],
  },
  {
    id: "logic-monitor",
    title: "LogicMonitor",
    desc: "Live alert feed + device health",
    keywords: ["alert", "down", "device", "monitor", "logicmonitor", "severity"],
  },
  {
    id: "zoom-queue",
    title: "Zoom Queue",
    desc: "Who's on a call and for how long",
    keywords: ["zoom", "call", "queue", "agent", "engagement", "on call"],
  },
  {
    id: "break-tracker",
    title: "Break Tracker",
    desc: "Team breaks via Slack + local",
    keywords: ["break", "lunch", "bio", "pause", "rest"],
  },
  {
    id: "qs-escalations",
    title: "QS Escalation Contacts",
    desc: "Carrier escalation lists",
    keywords: ["carrier", "escalation", "contacts", "comcast", "rogers", "lumen", "optimum"],
  },
  {
    id: "ticket-summary",
    title: "Ticket Summary",
    desc: "AI summarizes uploaded .mhtml tickets",
    keywords: ["summary", "ticket", "mhtml", "incident summary"],
  },
  {
    id: "wfh",
    title: "WFH Requests",
    desc: "Apply for work-from-home approval",
    keywords: ["wfh", "remote", "home", "request", "approval"],
  },
  {
    id: "escalation-email",
    title: "Escalation Email",
    desc: "AI drafts the ESC-MGR Alert email from your notes",
    keywords: ["email", "escalation", "esc-mgr", "draft", "manager alert"],
  },
  {
    id: "shift-handover",
    title: "Shift Handover",
    desc: "AI structures your ticket notes into a handover message",
    keywords: ["handover", "shift", "handoff", "transition"],
  },
  {
    id: "email-polisher",
    title: "Email Polisher",
    desc: "Polish a draft for customer, internal, or carrier",
    keywords: ["polish", "rewrite", "grammar", "email improvement"],
  },
  {
    id: "noc-troubleshooter",
    title: "NOC Troubleshooter",
    desc: "AI agent for network + circuit troubleshooting",
    keywords: ["noc", "network", "circuit", "troubleshoot", "outage"],
  },
  {
    id: "mobility-troubleshooter",
    title: "Mobility Troubleshooter",
    desc: "AI agent for wireless + device troubleshooting",
    keywords: ["mobility", "wireless", "mobile", "device", "sim", "phone"],
  },
];

const SYSTEM_CONTEXT = `You are the vCom NOC Operations Dashboard smart search assistant.

You must do two things for each user query:
1) Give a concise AI-generated summary answer.
2) Recommend practical next actions for the operator.

Available dashboard widgets:
${WIDGET_LIST.map((w) => `- ${w.title}: ${w.desc}`).join("\n")}

Rules:
- Be concise and operationally useful.
- Prefer bullet points over long paragraphs.
- Mention exact widget titles when relevant.
- If uncertain, clearly say what data is missing.
- Never fabricate carrier contacts or incident facts.

Response markdown format:
## Summary
(2-5 bullets)

## Recommended next actions
(3-6 bullets, each action-oriented)
`;

interface RelevantWidget {
  id: string;
  title: string;
  desc: string;
  score: number;
}

interface SearchResult {
  query: string;
  answer: string;
  timestamp: number;
  relevant: RelevantWidget[];
}

function rankRelevantWidgets(query: string): RelevantWidget[] {
  const q = query.toLowerCase();
  const ranked = WIDGET_LIST.map((w) => {
    let score = 0;
    if (q.includes(w.title.toLowerCase())) score += 5;
    if (q.includes(w.id.replace(/-/g, " "))) score += 4;
    for (const kw of w.keywords) {
      if (q.includes(kw)) score += 2;
    }
    for (const token of q.split(/\s+/).filter(Boolean)) {
      if (w.title.toLowerCase().includes(token)) score += 1;
      if (w.desc.toLowerCase().includes(token)) score += 1;
    }
    return { id: w.id, title: w.title, desc: w.desc, score };
  })
    .filter((w) => w.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  if (ranked.length > 0) return ranked;

  // Generic fallback when no keyword match is detected.
  return [
    {
      id: "smart-search",
      title: "Smart Search",
      desc: "Refine your query with service/provider/ticket details.",
      score: 1,
    },
    {
      id: "noc-troubleshooter",
      title: "NOC Troubleshooter",
      desc: "Get guided troubleshooting for network and circuit incidents.",
      score: 1,
    },
  ];
}

function openWidget(widgetId: string) {
  window.location.hash = `#/${widgetId}`;
}

export function SmartSearchWidget() {
  const ai = useCompletion({ model: "auto" });
  const { identity } = useIdentity();
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<SearchResult[]>([]);
  const [activeRelevant, setActiveRelevant] = useState<RelevantWidget[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const hasAnyResults = useMemo(
    () => history.length > 0 || activeRelevant.length > 0,
    [history.length, activeRelevant.length],
  );

  async function handleSearch() {
    const q = query.trim();
    if (!q || ai.isLoading) return;

    const relevant = rankRelevantWidgets(q);
    setActiveRelevant(relevant);

    const userContext = identity
      ? `[User: ${identity.name}, Role: ${identity.role}]`
      : "[User: not signed in]";

    const resultContext = `Likely relevant widgets for this query:\n${relevant
      .map((w) => `- ${w.title}: ${w.desc}`)
      .join("\n")}`;

    const prompt = `${SYSTEM_CONTEXT}\n\n${userContext}\n\n${resultContext}\n\nUser query: ${q}`;

    setQuery("");
    const answer = await ai.complete(prompt);
    if (answer) {
      setHistory((prev) => [
        { query: q, answer, timestamp: Date.now(), relevant },
        ...prev,
      ]);
      ai.setResult("");
    }

    setTimeout(() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }), 100);
  }

  function clearHistory() {
    setHistory([]);
    setActiveRelevant([]);
    ai.setResult("");
    inputRef.current?.focus();
  }

  return (
    <WidgetFrame
      title="Smart Search"
      subtitle="AI-powered natural language search with relevant widget results"
      icon={IconSearch}
      iconColor="indigo"
    >
      <Stack gap="md" style={{ height: "calc(100vh - 200px)", maxHeight: 800 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSearch();
          }}
        >
          <TextInput
            ref={inputRef}
            placeholder="Ask anything… e.g. 'How do I escalate a Comcast ticket?'"
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

        {activeRelevant.length > 0 && (
          <Card withBorder radius="lg" p="md">
            <Group justify="space-between" mb="sm">
              <Text size="sm" fw={700}>Relevant results</Text>
              <Badge size="sm" variant="light" color="indigo">
                {activeRelevant.length}
              </Badge>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              {activeRelevant.map((w) => (
                <Card key={`${w.id}-${w.score}`} withBorder radius="md" p="sm">
                  <Stack gap={6}>
                    <Group justify="space-between" wrap="nowrap" gap={8}>
                      <Text fw={600} size="sm" style={{ minWidth: 0 }} truncate>
                        {w.title}
                      </Text>
                      <Badge size="xs" variant="light" color="gray">
                        Score {w.score}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {w.desc}
                    </Text>
                    <Button
                      size="xs"
                      variant="light"
                      rightSection={<IconArrowRight size={12} />}
                      onClick={() => openWidget(w.id)}
                    >
                      Open widget
                    </Button>
                  </Stack>
                </Card>
              ))}
            </SimpleGrid>
          </Card>
        )}

        {ai.isLoading && ai.result && (
          <Card withBorder radius="lg" p="md">
            <Group gap={8} mb="xs">
              <ThemeIcon size="sm" radius="xl" variant="light" color="indigo">
                <IconSparkles size={12} />
              </ThemeIcon>
              <Text size="xs" fw={600} c="indigo">
                Generating AI summary…
              </Text>
              <Loader size={12} color="indigo" />
            </Group>
            <Box style={{ fontSize: 14, lineHeight: 1.6 }}>
              <ReactMarkdown>{ai.result}</ReactMarkdown>
            </Box>
          </Card>
        )}

        {ai.error && (
          <Card withBorder radius="lg" p="md" bg="red.0">
            <Text size="sm" c="red">
              {ai.error}
            </Text>
          </Card>
        )}

        <ScrollArea viewportRef={scrollRef} style={{ flex: 1, minHeight: 0 }} scrollbarSize={6}>
          <Stack gap="md">
            {history.length > 0 && (
              <Group justify="space-between" align="center">
                <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                  Recent searches
                </Text>
                <ActionIcon variant="subtle" size="xs" color="gray" onClick={clearHistory}>
                  <IconX size={12} />
                </ActionIcon>
              </Group>
            )}

            {history.map((item) => (
              <Card key={item.timestamp} withBorder radius="lg" p="md">
                <Group gap={8} mb="xs">
                  <ThemeIcon size="sm" radius="xl" variant="light" color="indigo">
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

                {item.relevant.length > 0 && (
                  <Group gap={6} mb="sm">
                    {item.relevant.slice(0, 3).map((w) => (
                      <Badge key={`${item.timestamp}-${w.id}`} size="xs" variant="light" color="gray">
                        {w.title}
                      </Badge>
                    ))}
                  </Group>
                )}

                <Box style={{ fontSize: 14, lineHeight: 1.6 }}>
                  <ReactMarkdown>{item.answer}</ReactMarkdown>
                </Box>
              </Card>
            ))}

            {!hasAnyResults && !ai.isLoading && (
              <Box ta="center" py="xl">
                <ThemeIcon size={48} radius="xl" variant="light" color="indigo" mx="auto" mb="md">
                  <IconSearch size={24} />
                </ThemeIcon>
                <Text size="lg" fw={600} mb={4}>
                  Ask in natural language
                </Text>
                <Text size="sm" c="dimmed" maw={480} mx="auto">
                  Smart Search will return AI-generated summaries and relevant widgets you can open directly.
                </Text>
              </Box>
            )}
          </Stack>
        </ScrollArea>
      </Stack>
    </WidgetFrame>
  );
}
