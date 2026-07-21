import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Divider,
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
  IconArrowUp,
  IconCopy,
  IconFileText,
  IconHistory,
  IconMessageCircle,
  IconPlayerStop,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import { db } from "../../db";
import { useChat } from "../../lib/devs-ai/use-chat";
import { parseMhtmlFile, type ParsedMhtml } from "../../lib/mhtml";
import { useCompletion } from "../../lib/devs-ai/use-completion";
import { formatDateTime } from "../../lib/format";
import { WidgetFrame } from "../WidgetFrame";
import { useTicketSummaries, type TicketSummary } from "./data";

export { TicketSummaryTile } from "./Tile";

const SUMMARY_INSTRUCTION = `You are an expert NOC analyst summarizing a support ticket from a saved web page. Produce a concise, well-structured Markdown summary with these sections — only include a section if you have real content for it:

## Overview
2–3 sentence executive summary: what's broken, for whom, what's the impact.

## Ticket details
Bullet list (omit fields you can't find): Ticket #, Status, Priority/Severity, Customer / Account, Carrier, Service / Circuit, Site / Location, Opened, Last updated, Assigned to.

## Timeline
Chronological bullet list of the major events from the ticket's notes/comments. Use \`HH:MM\` timestamps when present. Keep each bullet to one line.

## Root cause / current theory
What's currently believed to be the cause (cite the comment author + time if shown).

## Next steps
What needs to happen next, and who owns it.

## Recommended action for NOC
1-3 short actionable bullets the on-shift NOC engineer should do right now.

Be terse. Skip Confluence/JIRA-style navigation chrome, copyright footers, signature blocks, and any pasted email headers that don't add information. If the raw text is empty or doesn't look like a ticket, say so and stop.`;

const DIRECT_SUMMARY_CHARS = 18_000;
const SUMMARY_CHUNK_CHARS = 14_000;
const SUMMARY_REDUCTION_BATCH_SIZE = 8;
const QUICK_ASSIST_ACTIONS = [
  {
    label: "Executive",
    prompt:
      "Rewrite the current ticket summary as a tight executive summary for a team lead. Keep it under 6 bullets.",
  },
  {
    label: "Customer update",
    prompt:
      "Rewrite this as a customer-safe status update with no internal jargon, 1 short paragraph plus 3 next steps.",
  },
  {
    label: "Timeline only",
    prompt:
      "Convert this into a timeline-only summary with timestamps/events only. Omit analysis and recommendations.",
  },
  {
    label: "Next actions",
    prompt:
      "Based on this ticket, tell me exactly what I should do next on shift. Use a short numbered list.",
  },
] as const;

function splitIntoChunks(text: string, maxChars: number) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [] as string[];
  if (normalized.length <= maxChars) return [normalized];

  const lines = normalized.split("\n");
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current) chunks.push(current);

    if (line.length <= maxChars) {
      current = line;
      continue;
    }

    for (let i = 0; i < line.length; i += maxChars) {
      const slice = line.slice(i, i + maxChars);
      if (slice) chunks.push(slice);
    }
    current = "";
  }

  if (current) chunks.push(current);
  return chunks;
}

function buildAssistantContext(args: {
  fileName: string;
  parsed: ParsedMhtml | null;
  displayedSummary: string;
  showingHistorical: boolean;
  viewingFileName?: string;
}) {
  const summary = args.displayedSummary.trim();
  const rawText = args.parsed?.text?.slice(0, 20_000)?.trim() ?? "";
  const subject = args.parsed?.ticket_subject ?? args.parsed?.subject ?? "";
  const ticketNumber = args.parsed?.ticket_number ?? "";

  return [
    "You are an AI assistant embedded inside a NOC ticket-summary widget.",
    "Answer the user's question about this ticket, or rewrite the summary in the format they request.",
    "Be precise, operational, and concise.",
    "If the user asks to change the summary type, return the rewritten summary directly in Markdown.",
    "If the user asks a specific question, answer it using only the ticket context below. If the answer is uncertain, say what is missing.",
    "Do not invent facts not supported by the context.",
    "",
    `Current file: ${args.parsed ? args.fileName : (args.viewingFileName ?? args.fileName ?? "Saved ticket summary")}`,
    subject ? `Detected subject: ${subject}` : "",
    ticketNumber ? `Detected ticket #: ${ticketNumber}` : "",
    args.showingHistorical
      ? "Context source: saved summary only"
      : rawText
        ? "Context source: uploaded ticket text + current summary"
        : "Context source: current summary",
    "",
    "CURRENT SUMMARY:",
    summary || "(No summary generated yet)",
    rawText ? `\nRAW TICKET TEXT (truncated if needed):\n${rawText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function TicketSummaryWidget() {
  const { summaries, refresh } = useTicketSummaries();
  const [parsed, setParsed] = useState<ParsedMhtml | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [fileSize, setFileSize] = useState<number>(0);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [viewing, setViewing] = useState<TicketSummary | null>(null);
  const [assistantInput, setAssistantInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const TICKET_SUMMARY_AGENT_ID = "2d6e4c84-9581-4753-bf84-9da21eddf76c";

  const { complete, result, isLoading, error, abort, setResult } = useCompletion({
    model: TICKET_SUMMARY_AGENT_ID,
  });
  const preprocessAi = useCompletion({
    model: TICKET_SUMMARY_AGENT_ID,
  });
  const {
    messages: assistantMessages,
    sendMessage: askAssistant,
    isLoading: assistantLoading,
    error: assistantError,
    abort: abortAssistant,
    clear: clearAssistant,
  } = useChat(TICKET_SUMMARY_AGENT_ID);

  async function handleFile(file: File) {
    setParseError(null);
    setViewing(null);
    setResult("");
    setFileName(file.name);
    setFileSize(file.size);
    try {
      const result = await parseMhtmlFile(file);
      if (!result.text || result.text.length < 100) {
        setParseError(
          "Could not extract meaningful text from this file. Is it a valid .mhtml?",
        );
        setParsed(null);
        return;
      }
      setParsed(result);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
      setParsed(null);
    }
  }

  async function runSummary() {
    if (!parsed) return;

    const header = [
      `File: ${fileName}`,
      parsed.subject ? `Subject: ${parsed.subject}` : "",
      parsed.ticket_number ? `Detected ticket #: ${parsed.ticket_number}` : "",
    ].filter(Boolean).join("\n");

    let summary = "";

    if (parsed.text.length <= DIRECT_SUMMARY_CHARS) {
      const prompt = `${SUMMARY_INSTRUCTION}\n\n---\n${header}\n---\n\nRAW TICKET TEXT:\n${parsed.text}`;
      summary = await complete(prompt);
    } else {
      const chunks = splitIntoChunks(parsed.text, SUMMARY_CHUNK_CHARS);
      let currentLevel = chunks.map((chunk, index) => ({
        label: `Section ${index + 1}`,
        content: chunk,
      }));

      setResult(`Analyzing full ticket dump in ${currentLevel.length.toLocaleString()} sections…`);

      for (let index = 0; index < currentLevel.length; index += 1) {
        setResult(`Analyzing section ${index + 1} of ${currentLevel.length}…`);
        const chunkPrompt = `You are reviewing one section of a large saved support ticket. Extract only the operationally important facts from this section in concise Markdown. Focus on status changes, timestamps, owners, impact, carrier/vendor actions, root cause clues, and next steps. Ignore navigation chrome and repeated boilerplate.\n\n${header}\n${currentLevel[index].label} of ${currentLevel.length}:\n\n${currentLevel[index].content}`;
        const chunkSummary = await preprocessAi.complete(chunkPrompt);
        currentLevel[index] = {
          label: currentLevel[index].label,
          content: chunkSummary.trim() || "No operationally meaningful information found in this section.",
        };
      }

      let round = 1;
      while (currentLevel.length > 1) {
        const nextLevel: Array<{ label: string; content: string }> = [];
        const totalGroups = Math.ceil(currentLevel.length / SUMMARY_REDUCTION_BATCH_SIZE);

        for (let groupIndex = 0; groupIndex < totalGroups; groupIndex += 1) {
          const start = groupIndex * SUMMARY_REDUCTION_BATCH_SIZE;
          const group = currentLevel.slice(start, start + SUMMARY_REDUCTION_BATCH_SIZE);
          const from = start + 1;
          const to = start + group.length;
          setResult(`Combining summaries round ${round}: group ${groupIndex + 1} of ${totalGroups}…`);

          const reductionPrompt = `You are consolidating partial findings from a very large saved support ticket. Merge the findings below into one concise Markdown brief. Preserve chronology, keep the newest status when details conflict, remove duplicates, and retain ticket numbers, timestamps, owners, customer impact, root cause clues, carrier/vendor actions, and next steps.\n\n${header}\nRound ${round} · Groups ${from}-${to} of ${currentLevel.length}\n\nPARTIAL FINDINGS:\n${group.map((item) => `## ${item.label}\n${item.content}`).join("\n\n")}`;
          const reduced = await preprocessAi.complete(reductionPrompt);
          nextLevel.push({
            label: `Round ${round} Group ${groupIndex + 1}`,
            content: reduced.trim() || group.map((item) => item.content).join("\n\n"),
          });
        }

        currentLevel = nextLevel;
        round += 1;
      }

      setResult("Combining all section findings into one ticket summary…");
      const combinedPrompt = `${SUMMARY_INSTRUCTION}\n\nYou are given the fully reduced findings extracted from the complete ticket dump. Produce one final unified summary. Deduplicate repeated notes, preserve chronology, and prefer the latest status when facts conflict.\n\n---\n${header}\nOriginal extracted text length: ${parsed.text.length.toLocaleString()} chars\nFull file coverage: yes\nReduction rounds completed: ${Math.max(round - 1, 0)}\n---\n\nREDUCED FINDINGS:\n${currentLevel[0]?.content ?? ""}`;
      summary = await complete(combinedPrompt);
    }

    if (summary && summary.trim().length > 0) {
      await db.ticket_summaries.insert({
        file_name: fileName,
        file_size_bytes: fileSize,
        ticket_number: parsed.ticket_number ?? null,
        ticket_subject: parsed.ticket_subject ?? parsed.subject ?? null,
        summary_markdown: summary,
        extracted_chars: parsed.text.length,
      });
      refresh();
    }
  }

  function reset() {
    setParsed(null);
    setFileName("");
    setFileSize(0);
    setParseError(null);
    setResult("");
    setViewing(null);
    setAssistantInput("");
    clearAssistant();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function deleteSummary(id: number) {
    await db.ticket_summaries.deleteById(id);
    if (viewing?.id === id) setViewing(null);
    refresh();
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  const displayedSummary = viewing?.summary_markdown ?? result;
  const showingHistorical = !!viewing;
  const assistantContext = buildAssistantContext({
    fileName,
    parsed,
    displayedSummary,
    showingHistorical,
    viewingFileName: viewing?.file_name,
  });
  const canUseAssistant = Boolean(displayedSummary || parsed);
  const checklistPromptHint = showingHistorical
    ? "Ask about the saved summary or request a new format"
    : "Ask about the ticket or request a different summary style";

  useEffect(() => {
    clearAssistant();
    setAssistantInput("");
  }, [displayedSummary, parsed?.ticket_number, parsed?.subject, viewing?.id, clearAssistant]);

  async function submitAssistantPrompt(prompt: string) {
    const trimmed = prompt.trim();
    if (!trimmed || !canUseAssistant) return;
    setAssistantInput("");
    await askAssistant(`${assistantContext}\n\nUSER REQUEST:\n${trimmed}`);
  }

  function useAssistantRewrite(prompt: string) {
    void submitAssistantPrompt(prompt);
  }

  function handleAssistantSubmit() {
    void submitAssistantPrompt(assistantInput);
  }

  return (
    <WidgetFrame
      title="Ticket Summary (AI)"
      subtitle={
        parsed
          ? `${fileName} · ${(fileSize / 1024).toFixed(1)} KB · ${parsed.text.length.toLocaleString()} chars extracted`
          : "Upload an .mhtml ticket export"
      }
      icon={IconFileText}
      iconColor="indigo"
      loading={isLoading || preprocessAi.isLoading}
      status={{
        label: "AI",
        color: "indigo",
        tooltip: "Devs.ai server-side completion",
      }}
      headerActions={
        (parsed || result || viewing) && (
          <Tooltip label="Clear and start over">
            <ActionIcon variant="subtle" size="md" onClick={reset} aria-label="Reset">
              <IconX size={16} />
            </ActionIcon>
          </Tooltip>
        )
      }
    >
      <Stack gap="lg">
        {/* Dropzone */}
        {!parsed && !viewing && (
          <Box
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            style={{
              border: `2px dashed ${dragOver ? "var(--mantine-color-indigo-5)" : "var(--mantine-color-dark-4)"}`,
              borderRadius: 12,
              padding: "32px 16px",
              textAlign: "center",
              cursor: "pointer",
              background: dragOver
                ? "var(--mantine-color-indigo-9)"
                : "var(--mantine-color-dark-7)",
              transition: "all 150ms ease",
            }}
          >
            <Stack gap={6} align="center">
              <IconUpload
                size={28}
                color={dragOver ? "var(--mantine-color-indigo-3)" : "var(--mantine-color-dimmed)"}
              />
              <Text size="sm" fw={500}>
                Drop an <Code>.mhtml</Code> file here, or click to browse
              </Text>
              <Text size="xs" c="dimmed">
                In your browser: Save as → Web Page, Complete (.mhtml)
              </Text>
            </Stack>
            <input
              ref={fileInputRef}
              type="file"
              accept=".mhtml,.mht,message/rfc822,multipart/related"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </Box>
        )}

        {parseError && (
          <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
            {parseError}
          </Alert>
        )}

        {/* Parsed file ready for summarization */}
        {parsed && !showingHistorical && (
          <Card radius="md" withBorder p="md">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Box style={{ minWidth: 0 }}>
                <Group gap={6} wrap="nowrap">
                  <IconFileText size={14} />
                  <Text fw={600} truncate>
                    {parsed.ticket_subject ?? parsed.subject ?? fileName}
                  </Text>
                </Group>
                <Group gap="sm" mt={4}>
                  {parsed.ticket_number && (
                    <Badge variant="light" color="indigo" size="sm">
                      {parsed.ticket_number}
                    </Badge>
                  )}
                  <Text size="xs" c="dimmed">
                    {parsed.text.length.toLocaleString()} chars · full file analyzed in staged passes when needed
                  </Text>
                </Group>
              </Box>
              <Group gap="xs" wrap="nowrap">
                {isLoading || preprocessAi.isLoading ? (
                  <Button
                    variant="light"
                    color="red"
                    size="sm"
                    leftSection={<IconPlayerStop size={14} />}
                    onClick={() => {
                      abort();
                      preprocessAi.abort();
                    }}
                  >
                    Stop
                  </Button>
                ) : (
                  <Button
                    color="indigo"
                    size="sm"
                    leftSection={<IconSparkles size={14} />}
                    onClick={runSummary}
                    disabled={!parsed}
                  >
                    {result ? "Re-summarize" : "Summarize"}
                  </Button>
                )}
              </Group>
            </Group>
          </Card>
        )}

        {(error || preprocessAi.error) && (
          <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
            AI request failed: {error || preprocessAi.error}
          </Alert>
        )}

        {/* Streamed / historical summary output */}
        {(displayedSummary || isLoading || preprocessAi.isLoading) && (
          <Card radius="md" withBorder p="md">
            <Group justify="space-between" mb="sm">
              <Group gap="xs">
                {showingHistorical ? (
                  <>
                    <IconHistory size={16} color="var(--mantine-color-dimmed)" />
                    <Text size="sm" c="dimmed">
                      Saved {formatDateTime(new Date(viewing!.created_at))} ·{" "}
                      {viewing!.file_name}
                    </Text>
                  </>
                ) : (
                  <>
                    <IconSparkles size={16} color="var(--mantine-color-indigo-5)" />
                    <Text size="sm" fw={500}>
                      AI Summary
                    </Text>
                    {(isLoading || preprocessAi.isLoading) && <Loader size="xs" />}
                  </>
                )}
              </Group>
              {displayedSummary && (
                <Tooltip label="Copy markdown">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={() => copyToClipboard(displayedSummary)}
                    aria-label="Copy summary"
                  >
                    <IconCopy size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
            <Divider mb="sm" />
            <Box
              style={{
                // Mantine prose-ish defaults for AI markdown.
                lineHeight: 1.55,
                fontSize: 14,
              }}
              className="ai-markdown"
            >
              {displayedSummary ? (
                <ReactMarkdown>{displayedSummary}</ReactMarkdown>
              ) : (
                <Text size="sm" c="dimmed">
                  Streaming summary…
                </Text>
              )}
            </Box>
          </Card>
        )}

        {/* Ask AI / Rewrite summary */}
        {canUseAssistant && (
          <Card radius="md" withBorder p="md">
            <Stack gap="md">
              <Group justify="space-between" align="flex-start" gap="sm">
                <Box style={{ minWidth: 0 }}>
                  <Group gap="xs">
                    <IconMessageCircle size={16} color="var(--mantine-color-indigo-5)" />
                    <Text size="sm" fw={600}>
                      Ask AI about this ticket
                    </Text>
                    <Badge size="xs" variant="light" color="indigo">
                      Context-aware
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed" mt={4}>
                    Ask follow-up questions or request a different summary style based on the current ticket context.
                  </Text>
                </Box>
                {assistantMessages.length > 0 && (
                  <Button variant="subtle" size="xs" onClick={clearAssistant}>
                    Clear chat
                  </Button>
                )}
              </Group>

              <Group gap="xs">
                {QUICK_ASSIST_ACTIONS.map((action) => (
                  <Button
                    key={action.label}
                    size="xs"
                    variant="light"
                    color="indigo"
                    onClick={() => useAssistantRewrite(action.prompt)}
                    disabled={assistantLoading}
                  >
                    {action.label}
                  </Button>
                ))}
              </Group>

              <Textarea
                minRows={3}
                autosize
                value={assistantInput}
                onChange={(event) => setAssistantInput(event.currentTarget.value)}
                placeholder={checklistPromptHint}
                disabled={assistantLoading}
              />

              <Group justify="space-between" align="center">
                <Text size="xs" c="dimmed">
                  Examples: “What is the likely root cause?”, “Rewrite for customer update”, “Make this shorter for Slack”.
                </Text>
                <Group gap="xs">
                  {assistantLoading && (
                    <Button
                      variant="light"
                      color="red"
                      size="sm"
                      leftSection={<IconPlayerStop size={14} />}
                      onClick={abortAssistant}
                    >
                      Stop
                    </Button>
                  )}
                  <Button
                    color="indigo"
                    size="sm"
                    leftSection={<IconArrowUp size={14} />}
                    onClick={handleAssistantSubmit}
                    disabled={!assistantInput.trim() || assistantLoading}
                  >
                    Ask AI
                  </Button>
                </Group>
              </Group>

              {assistantError && (
                <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
                  AI request failed: {assistantError}
                </Alert>
              )}

              {assistantMessages.length > 0 && (
                <Card radius="md" withBorder p="sm" bg="dark.7">
                  <ScrollArea.Autosize mah={320}>
                    <Stack gap="sm">
                      {assistantMessages.map((message, idx) => (
                        <Box
                          key={`${message.role}-${idx}`}
                          p="sm"
                          style={{
                            borderRadius: 10,
                            background:
                              message.role === "user"
                                ? "var(--mantine-color-dark-5)"
                                : "var(--mantine-color-dark-6)",
                            border: "1px solid var(--mantine-color-dark-4)",
                          }}
                        >
                          <Text size="xs" fw={700} c={message.role === "user" ? "indigo.3" : "gray.4"} mb={6}>
                            {message.role === "user" ? "You" : "AI assistant"}
                          </Text>
                          {message.role === "assistant" ? (
                            <Box className="ai-markdown" style={{ lineHeight: 1.55, fontSize: 14 }}>
                              <ReactMarkdown>{message.content || "Working…"}</ReactMarkdown>
                            </Box>
                          ) : (
                            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                              {message.content.replace(/^.*USER REQUEST:\n/s, "")}
                            </Text>
                          )}
                        </Box>
                      ))}
                    </Stack>
                  </ScrollArea.Autosize>
                </Card>
              )}
            </Stack>
          </Card>
        )}

        {/* History */}
        {summaries.length > 0 && (
          <Box>
            <Group gap="xs" mb="xs">
              <IconHistory size={14} />
              <Text size="sm" fw={600}>
                Recent summaries
              </Text>
              <Badge size="xs" variant="light" color="gray">
                {summaries.length}
              </Badge>
            </Group>
            <Card radius="md" withBorder p={0}>
              <ScrollArea.Autosize mah={260}>
                <Stack gap={0}>
                  {summaries.map((s, idx) => (
                    <Box
                      key={`summary-${s.id}-${s.file_name}-${idx}`}
                      style={{
                        borderBottom:
                          idx === summaries.length - 1
                            ? "none"
                            : "1px solid var(--mantine-color-dark-4)",
                        cursor: "pointer",
                        background:
                          viewing?.id === s.id
                            ? "var(--mantine-color-dark-6)"
                            : "transparent",
                      }}
                      px="md"
                      py="sm"
                      onClick={() => {
                        setViewing(s);
                        setParsed(null);
                        setResult("");
                      }}
                    >
                      <Group justify="space-between" wrap="nowrap" gap="sm">
                        <Box style={{ minWidth: 0, flex: 1 }}>
                          <Group gap={6} wrap="nowrap">
                            {s.ticket_number && (
                              <Badge size="xs" variant="light" color="indigo">
                                {s.ticket_number}
                              </Badge>
                            )}
                            <Text size="sm" fw={500} truncate>
                              {s.ticket_subject ?? s.file_name}
                            </Text>
                          </Group>
                          <Text size="xs" c="dimmed">
                            {formatDateTime(new Date(s.created_at))} ·{" "}
                            {(s.file_size_bytes / 1024).toFixed(1)} KB
                          </Text>
                        </Box>
                        <Tooltip label="Delete">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteSummary(s.id);
                            }}
                            aria-label="Delete summary"
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Box>
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            </Card>
          </Box>
        )}

        {viewing && (
          <Group justify="flex-end">
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconRefresh size={12} />}
              onClick={() => {
                setViewing(null);
                setResult("");
              }}
            >
              Back to uploader
            </Button>
          </Group>
        )}
      </Stack>
    </WidgetFrame>
  );
}
