/**
 * BulkUploadTab — Process multiple MHTML ticket files in one batch.
 *
 * Flow per file:
 *   1. Parse MHTML → extract plain text
 *   2. POST /api/audit/analyze → collect full streamed response
 *   3. Parse structured JSON → auto-save each individual as a separate audit row
 *   4. Mark status: saved / needs_review / error
 *
 * Files are processed sequentially (one at a time) to avoid overloading the API.
 */
import { useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  Progress,
  ScrollArea,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconFiles,
  IconGavel,
  IconPlayerStop,
  IconTrash,
  IconUpload,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { parseMhtmlFile } from "../../lib/mhtml";
import { useIdentity } from "../../lib/identity";
import { resolveTeamMember } from "../PerformanceTracker/team";
import { parseAuditJson, extractAnalysisMarkdown, scoreColor, gradeColor, useTicketAudits } from "./data";

// ── Per-file status ────────────────────────────────────────────────────────────
type BulkStatus =
  | "queued"
  | "parsing"
  | "analyzing"
  | "saving"
  | "saved"
  | "needs_review"
  | "error";

interface BulkItem {
  id: string;
  file: File;
  status: BulkStatus;
  statusText?: string;
  error?: string;
  savedCount?: number;
  individuals?: SavedIndividual[];   // one entry per saved individual with role
}

interface SavedIndividual {
  name: string;
  role: string;      // Owner | Contributor | Contributor - AS
  score: number | null;
  grade: string | null;
}

function statusBadge(item: BulkItem) {
  switch (item.status) {
    case "queued":       return <Badge size="xs" color="gray"   variant="outline">Queued</Badge>;
    case "parsing":      return <Badge size="xs" color="blue"   variant="light">Parsing…</Badge>;
    case "analyzing":    return <Badge size="xs" color="violet" variant="light"><Group gap={4} wrap="nowrap"><Loader size={10} color="violet" /><span>Analyzing…</span></Group></Badge>;
    case "saving":       return <Badge size="xs" color="cyan"   variant="light">Saving…</Badge>;
    case "saved":        return <Badge size="xs" color="green"  variant="filled"><Group gap={4} wrap="nowrap"><IconCheck size={10} /><span>Saved</span></Group></Badge>;
    case "needs_review": return <Badge size="xs" color="orange" variant="filled">Needs Review</Badge>;
    case "error":        return <Badge size="xs" color="red"    variant="filled">Error</Badge>;
  }
}

export function BulkUploadTab({ onSaved }: { onSaved: () => void }) {
  const { identity } = useIdentity();
  const { saveAudit } = useTicketAudits();

  const [items, setItems] = useState<BulkItem[]>([]);
  const [running, setRunning] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function addFiles(files: File[]) {
    const valid = Array.from(files).filter((f) =>
      f.name.match(/\.(mhtml|mht|html|htm)$/i)
    );
    const newItems: BulkItem[] = valid.map((f) => ({
      id: `${f.name}-${f.size}-${Date.now()}-${Math.random()}`,
      file: f,
      status: "queued" as BulkStatus,
    }));
    setItems((prev) => [...prev, ...newItems]);
  }

  function removeItem(id: string) {
    if (running) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function clearDone() {
    setItems((prev) => prev.filter((i) => i.status !== "saved"));
  }

  function clearAll() {
    if (running) return;
    setItems([]);
    setCurrentIdx(-1);
  }

  function patchItem(id: string, patch: Partial<BulkItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  // ── Collect full SSE stream ────────────────────────────────────────────────
  async function collectStream(
    text: string,
    fileName: string,
    signal: AbortSignal,
    onChunk: (partial: string) => void
  ): Promise<string> {
    const res = await fetch("/api/audit/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, fileName }),
      signal,
    });

    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";
    let currentData = "";
    let assembled = "";

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
                assembled += parsed.content.text;
                onChunk(assembled);
              } else if (currentEvent === "message.error") {
                throw new Error(parsed.error ?? "Stream error");
              }
            } catch (e: any) {
              if (currentEvent === "message.error") throw e;
            }
          }
          currentEvent = "";
          currentData = "";
        }
      }
    }
    return assembled;
  }

  // ── Process one file ───────────────────────────────────────────────────────
  async function processItem(item: BulkItem, signal: AbortSignal): Promise<void> {
    // 1. Parse
    patchItem(item.id, { status: "parsing", statusText: "Extracting text from file…" });
    let parsedText = "";
    try {
      const parsed = await parseMhtmlFile(item.file);
      parsedText = parsed.text;
    } catch (e) {
      patchItem(item.id, {
        status: "error",
        error: `Parse failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }

    // 2. Analyze (stream)
    patchItem(item.id, { status: "analyzing", statusText: "Sending to AI auditor…" });
    let rawResponse = "";
    try {
      rawResponse = await collectStream(
        parsedText,
        item.file.name,
        signal,
        (partial) => {
          // Show how many chars received as live feedback
          const chars = partial.length;
          patchItem(item.id, {
            statusText: `Receiving AI response… (${(chars / 1000).toFixed(1)}k chars)`,
          });
        }
      );
    } catch (e: any) {
      if (e?.name === "AbortError") {
        patchItem(item.id, { status: "queued", statusText: undefined });
        return;
      }
      patchItem(item.id, {
        status: "error",
        error: `Analysis failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }

    // 3. Parse JSON
    patchItem(item.id, { statusText: "Parsing structured results…" });
    const result = parseAuditJson(rawResponse);
    if (!result || !result.individuals || result.individuals.length === 0) {
      const snippet = rawResponse.slice(0, 120).replace(/\n/g, " ");
      console.error("[BulkUpload] Parse failed. Response head:", snippet);
      patchItem(item.id, {
        status: "needs_review",
        error: `Could not extract structured scores (response: "${snippet}…") — open in Upload & Analyze tab to review manually`,
      });
      return;
    }

    // Auto-save — owners first, then contributors
    const owners = result.individuals.filter(i => i.role === "Owner");
    const contributors = result.individuals.filter(i => i.role !== "Owner");
    const orderedInds = [...owners, ...contributors];
    patchItem(item.id, {
      status: "saving",
      statusText: `Auto-saving ${owners.length} owner(s) + ${contributors.length} contributor(s)…`,
    });

    let savedCount = 0;
    const individuals: SavedIndividual[] = [];

    // Strip JSON block from markdown once — reuse for all individuals
    const cleanMarkdown = extractAnalysisMarkdown(rawResponse);

    for (const ind of orderedInds) {
      try {
        const criteriaFull: Record<string, {
          score: number; max: number; points_deducted: number;
          deduction_reason: string; evidence: string;
        }> = {};
        for (const [cat, s] of Object.entries(ind.scores ?? {})) {
          criteriaFull[cat] = {
            score: s.score,
            max: s.max,
            points_deducted: s.points_deducted ?? (s.max - s.score),
            deduction_reason: s.deduction_reason || "Full marks",
            evidence: s.evidence || "N/A",
          };
        }

        const agentName = resolveTeamMember(ind.name) ?? ind.name ?? null;

        await saveAudit({
          file_name: item.file.name,
          file_size_bytes: item.file.size,
          ticket_number: result.ticket_number ?? null,
          ticket_subject: result.ticket_subject ?? null,
          ticket_date: result.ticket_date ?? null,
          agent_name: agentName,
          agent_name_raw: ind.name ?? null,
          overall_score: typeof ind.total_score === "number" ? ind.total_score : null,
          grade: ind.grade ?? null,
          criteria_json: Object.keys(criteriaFull).length > 0 ? JSON.stringify(criteriaFull) : null,
          what_did_well: ind.what_did_well ?? null,
          what_missed: ind.what_missed ?? null,
          analysis_markdown: cleanMarkdown,
          audit_month: result.audit_month ?? null,
          queue: result.queue ?? null,
          audited_by: identity?.name ?? null,
          metrics_id: null,
        } as any);

        individuals.push({
          name: agentName ?? ind.name ?? "Unknown",
          role: ind.role ?? "Owner",
          score: typeof ind.total_score === "number" ? ind.total_score : null,
          grade: ind.grade ?? null,
        });
        savedCount++;
      } catch (saveErr) {
        console.error("[BulkUpload] Save failed for", ind.name, ":", saveErr instanceof Error ? saveErr.message : saveErr);
      }
    }

    if (savedCount > 0) {
      patchItem(item.id, {
        status: "saved",
        statusText: undefined,
        savedCount,
        individuals,
        error: undefined,
      });
      onSaved();
    } else {
      patchItem(item.id, {
        status: "needs_review",
        statusText: undefined,
        error: "All individual saves failed — check API configuration",
      });
    }
  }

  // ── Queue runner ───────────────────────────────────────────────────────────
  async function startQueue() {
    const pending = items.filter(
      (i) => i.status === "queued" || i.status === "error" || i.status === "needs_review"
    );
    if (pending.length === 0) return;

    setRunning(true);
    stoppedRef.current = false;
    abortRef.current = new AbortController();

    // Re-read items freshly to avoid stale closure
    setItems((prev) => {
      // kick off processing using latest snapshot
      (async () => {
        for (let i = 0; i < prev.length; i++) {
          if (stoppedRef.current) break;
          const item = prev[i];
          if (
            item.status !== "queued" &&
            item.status !== "error" &&
            item.status !== "needs_review"
          )
            continue;
          setCurrentIdx(i);
          await processItem(item, abortRef.current!.signal);
          if (stoppedRef.current) break;
        }
        setRunning(false);
        setCurrentIdx(-1);
      })();
      return prev;
    });
  }

  function stopQueue() {
    stoppedRef.current = true;
    abortRef.current?.abort();
    setRunning(false);
    setCurrentIdx(-1);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const total = items.length;
  const saved = items.filter((i) => i.status === "saved").length;
  const errored = items.filter((i) => i.status === "error" || i.status === "needs_review").length;
  const queuedCount = items.filter((i) => i.status === "queued").length;
  const done = saved + errored;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = !running && total > 0 && done === total;

  return (
    <Stack gap="md" pt="md">

      {/* Drop zone */}
      <Card
        withBorder
        radius="md"
        p="xl"
        style={{
          borderStyle: "dashed",
          borderColor: dragOver
            ? "var(--mantine-color-violet-5)"
            : "var(--mantine-color-dark-4)",
          background: dragOver ? "var(--mantine-color-violet-9)" : undefined,
          cursor: "pointer",
          textAlign: "center",
          transition: "border-color 0.15s, background 0.15s",
        }}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".mhtml,.mht,.html,.htm"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files) addFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
        <Stack align="center" gap="xs">
          <ThemeIcon size={56} variant="light" color="violet" radius="xl">
            <IconFiles size={28} />
          </ThemeIcon>
          <Text fw={700} size="md">Drop multiple .mhtml files here</Text>
          <Text size="sm" c="dimmed">
            or click to browse — select as many tickets as you need at once
          </Text>
          <Text size="xs" c="dimmed">Accepts .mhtml · .mht · .html · .htm</Text>
          {total > 0 && (
            <Badge color="violet" variant="filled" size="lg" mt={4} radius="xl">
              {total} file{total !== 1 ? "s" : ""} in queue
            </Badge>
          )}
        </Stack>
      </Card>

      {/* Controls + progress bar */}
      {total > 0 && (
        <Card withBorder radius="md" p="md">
          <Group justify="space-between" mb="md" wrap="nowrap">
            {/* Stats */}
            <Group gap="xl">
              <Box ta="center">
                <Text size="lg" fw={800} lh={1}>{total}</Text>
                <Text size="xs" c="dimmed" mt={2}>Total</Text>
              </Box>
              <Box ta="center">
                <Text size="lg" fw={800} lh={1} c="blue">{queuedCount}</Text>
                <Text size="xs" c="dimmed" mt={2}>Queued</Text>
              </Box>
              <Box ta="center">
                <Text size="lg" fw={800} lh={1} c="green">{saved}</Text>
                <Text size="xs" c="dimmed" mt={2}>Saved</Text>
              </Box>
              <Box ta="center">
                <Text size="lg" fw={800} lh={1} c={errored > 0 ? "orange" : "dimmed"}>{errored}</Text>
                <Text size="xs" c="dimmed" mt={2}>Review</Text>
              </Box>
            </Group>

            {/* Action buttons */}
            <Group gap="xs">
              {running ? (
                <Button
                  leftSection={<IconPlayerStop size={15} />}
                  color="orange"
                  variant="light"
                  onClick={stopQueue}
                >
                  Stop
                </Button>
              ) : (
                <>
                  <Button
                    leftSection={<IconUpload size={15} />}
                    color="violet"
                    disabled={queuedCount === 0 && errored === 0}
                    onClick={startQueue}
                  >
                    {saved > 0 && (queuedCount > 0 || errored > 0)
                      ? "Resume / Retry"
                      : "Start Audit Batch"}
                  </Button>
                  {saved > 0 && (
                    <Tooltip label="Remove saved files from list" withinPortal>
                      <Button
                        variant="light"
                        color="green"
                        leftSection={<IconCheck size={14} />}
                        onClick={clearDone}
                      >
                        Clear Saved
                      </Button>
                    </Tooltip>
                  )}
                  <Tooltip label="Clear all files" withinPortal>
                    <Button
                      variant="subtle"
                      color="gray"
                      leftSection={<IconTrash size={14} />}
                      onClick={clearAll}
                    >
                      Clear All
                    </Button>
                  </Tooltip>
                </>
              )}
            </Group>
          </Group>

          {/* Progress */}
          <Progress
            value={progress}
            color={allDone ? (errored > 0 ? "orange" : "green") : "violet"}
            size="md"
            radius="xl"
            striped={running}
            animated={running}
          />
          <Group justify="space-between" mt={4}>
            <Text size="xs" c="dimmed">
              {running
                ? `Processing file ${currentIdx + 1} of ${total}…`
                : allDone
                ? `Completed — ${saved} saved, ${errored} need review`
                : `${done} of ${total} processed`}
            </Text>
            <Text size="xs" c="dimmed">{progress}%</Text>
          </Group>
        </Card>
      )}

      {/* File queue table */}
      {items.length > 0 && (
        <Card withBorder radius="md" p={0}>
          <ScrollArea h={Math.min(items.length * 58 + 48, 480)}>
            <Table
              fz="sm"
              horizontalSpacing="md"
              verticalSpacing="sm"
              stickyHeader
              striped
              highlightOnHover
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>#</Table.Th>
                  <Table.Th>File</Table.Th>
                  <Table.Th style={{ width: 140 }}>Status</Table.Th>
                  <Table.Th style={{ width: 170 }}>
                    <Group gap={4}><IconGavel size={11} /><span>Owners</span></Group>
                  </Table.Th>
                  <Table.Th style={{ width: 160 }}>
                    <Group gap={4}><IconUsers size={11} /><span>Contributors</span></Group>
                  </Table.Th>
                  <Table.Th style={{ width: 100 }}>Grade</Table.Th>
                  <Table.Th style={{ width: 36 }}></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((item, idx) => (
                  <Table.Tr
                    key={item.id}
                    style={{
                      opacity: item.status === "saved" ? 0.75 : 1,
                      background:
                        running && currentIdx === idx
                          ? "var(--mantine-color-violet-9)"
                          : undefined,
                    }}
                  >
                    {/* # */}
                    <Table.Td>
                      <Text size="xs" c="dimmed" ff="monospace">{idx + 1}</Text>
                    </Table.Td>

                    {/* File name + sub-status */}
                    <Table.Td>
                      <Text size="xs" fw={500} truncate style={{ maxWidth: 260 }}>
                        {item.file.name}
                      </Text>
                      {item.statusText && (
                        <Text size="xs" c="violet" mt={1}>{item.statusText}</Text>
                      )}
                      {item.error && !item.statusText && (
                        <Text size="xs" c="orange" mt={1} truncate style={{ maxWidth: 260 }}>
                          {item.error}
                        </Text>
                      )}
                      {item.savedCount && item.savedCount > 1 && (
                        <Text size="xs" c="green" mt={1}>
                          {item.savedCount} individuals saved
                        </Text>
                      )}
                      <Text size="xs" c="dimmed">
                        {(item.file.size / 1024).toFixed(1)} KB
                      </Text>
                    </Table.Td>

                    {/* Status badge */}
                    <Table.Td>{statusBadge(item)}</Table.Td>

                    {/* Owners */}
                    <Table.Td>
                      {item.individuals && item.individuals.filter(i => i.role === "Owner").length > 0 ? (
                        <Stack gap={3}>
                          {item.individuals.filter(i => i.role === "Owner").map((ind, i) => (
                            <Group key={i} gap={4} wrap="nowrap">
                              <IconGavel size={10} color="var(--mantine-color-violet-5)" />
                              <Text size="xs" fw={600} truncate style={{ maxWidth: 130 }}>{ind.name}</Text>
                              {ind.score !== null && (
                                <Badge size="xs" color={scoreColor(ind.score)} variant="filled" fw={700}>{ind.score}</Badge>
                              )}
                            </Group>
                          ))}
                        </Stack>
                      ) : <Text size="xs" c="dimmed">—</Text>}
                    </Table.Td>

                    {/* Contributors */}
                    <Table.Td>
                      {item.individuals && item.individuals.filter(i => i.role !== "Owner").length > 0 ? (
                        <Stack gap={3}>
                          {item.individuals.filter(i => i.role !== "Owner").map((ind, i) => (
                            <Group key={i} gap={4} wrap="nowrap">
                              <IconUsers size={10} color="var(--mantine-color-blue-5)" />
                              <Text size="xs" fw={500} truncate style={{ maxWidth: 110 }}>{ind.name}</Text>
                              {ind.role === "Contributor - AS" && (
                                <Badge size="xs" color="orange" variant="outline">AS</Badge>
                              )}
                              {ind.score !== null && (
                                <Badge size="xs" color={scoreColor(ind.score)} variant="filled" fw={700}>{ind.score}</Badge>
                              )}
                            </Group>
                          ))}
                        </Stack>
                      ) : <Text size="xs" c="dimmed">—</Text>}
                    </Table.Td>

                    {/* Grade(s) */}
                    <Table.Td>
                      {item.individuals && item.individuals.length > 0 ? (
                        <Stack gap={2}>
                          {item.individuals.map((ind, i) => ind.grade ? (
                            <Badge key={i} size="xs" color={gradeColor(ind.grade)} variant="light">{ind.grade}</Badge>
                          ) : null)}
                        </Stack>
                      ) : "—"}
                    </Table.Td>

                    {/* Remove */}
                    <Table.Td>
                      <Tooltip label={running ? "Stop queue first" : "Remove"} withinPortal>
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="gray"
                          disabled={running}
                          onClick={() => removeItem(item.id)}
                        >
                          <IconX size={13} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      )}

      {/* Done summary */}
      {allDone && (
        <Alert
          color={errored > 0 ? "orange" : "green"}
          icon={errored > 0 ? <IconAlertCircle size={16} /> : <IconCheck size={16} />}
          radius="md"
          title={
            errored > 0
              ? `${saved} saved · ${errored} need manual review`
              : `All ${saved} ticket${saved !== 1 ? "s" : ""} processed successfully!`
          }
        >
          {errored > 0 && (
            <Text size="xs" mt={4}>
              Files marked "Needs Review" couldn't be auto-parsed. Upload them individually in the <b>Upload &amp; Analyze</b> tab to review and correct manually.
            </Text>
          )}
          {saved > 0 && (
            <Text size="xs" mt={4} c="dimmed">
              All saved audits are visible in the <b>Audit History</b> tab.
            </Text>
          )}
        </Alert>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <Stack align="center" gap="xs" py="xl">
          <ThemeIcon size={48} variant="light" color="gray" radius="xl">
            <IconFiles size={24} />
          </ThemeIcon>
          <Text c="dimmed" size="sm" ta="center">
            No files added yet.
          </Text>
          <Text c="dimmed" size="xs" ta="center" maw={380}>
            Drop multiple .mhtml ticket files above — they'll be queued and processed one by one.
            Each ticket's individuals are scored and saved separately.
          </Text>
        </Stack>
      )}

    </Stack>
  );
}
