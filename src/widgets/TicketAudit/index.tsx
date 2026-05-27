/**
 * Ticket Audit Widget
 *
 * Upload an MHTML ticket file → AI analyzes it using the configured audit agent
 * → extracts structured scores + writes to ticket_audits table
 * → optionally pushes to performance_metrics as source_type="audit"
 *
 * Three tabs:
 *   1. Upload & Analyze  — drag-drop MHTML, stream AI results, review + save
 *   2. Audit History     — table of all saved audits with scores
 *   3. Push to Metrics   — select audits → push scores to Performance Tracker
 */
import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Loader,
  Modal,
  Progress,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconChartBar,
  IconClipboardText,
  IconFiles,
  IconGavel,
  IconHistory,
  IconMessageCircle,
  IconPlayerStop,
  IconSend,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import { parseMhtmlFile } from "../../lib/mhtml";
import { useIdentity } from "../../lib/identity";
import { WidgetFrame } from "../WidgetFrame";
import { resolveTeamMember } from "../PerformanceTracker/team";
import { BulkUploadTab } from "./BulkUploadTab";
import { AuditChat } from "./AuditChat";
import {
  extractAnalysisMarkdown,
  gradeColor,
  parseAuditJson,
  scoreColor,
  useTicketAudits,
  type AuditIndividual,
  type ParsedAuditResult,
  type TicketAudit,
} from "./data";

export { TicketAuditTile } from "./Tile";

const MAX_PROMPT_CHARS = 80_000;

// ── The 6 exact audit criteria (in display order) ─────────────────────────────
const AUDIT_CRITERIA = [
  "Response & Timeliness",
  "Data Quality & Completeness",
  "Communication Quality",
  "Process & Workflow Compliance",
  "Technical Handling",
  "Closure & Documentation",
] as const;

export const AUDIT_CRITERIA_MAX: Record<string, number> = {
  "Response & Timeliness": 20,
  "Data Quality & Completeness": 16,
  "Communication Quality": 25,
  "Process & Workflow Compliance": 14,
  "Technical Handling": 13,
  "Closure & Documentation": 12,
};

// ── Editable fields after AI analysis ────────────────────────────────────────
interface AuditFields {
  ticket_number: string;
  ticket_subject: string;
  ticket_date: string;
  agent_name: string;
  overall_score: number | "";
  grade: string;
  audit_month: string;
  queue: string;
  criteria: Record<string, number>;
  deductions: Record<string, string>;  // criterion → reason for deduction
  what_did_well: string;
  what_missed: string;
}

// emptyFields used by IndividualReviewPanel via buildFieldsFromIndividual
function emptyFields(): AuditFields {
  return { ticket_number: "", ticket_subject: "", ticket_date: "", agent_name: "", overall_score: "", grade: "", audit_month: new Date().toISOString().slice(0, 7), queue: "noc", criteria: {}, deductions: {}, what_did_well: "", what_missed: "" };
}
void emptyFields; // suppress unused warning — used at runtime via buildFieldsFromIndividual



function buildFieldsFromIndividual(result: ParsedAuditResult, ind: AuditIndividual): AuditFields {
  const criteria: Record<string, number> = {};
  const deductions: Record<string, string> = {};
  for (const c of AUDIT_CRITERIA) {
    const s = ind.scores[c];
    if (s) {
      criteria[c] = s.score;
      if (s.deduction_reason && s.deduction_reason.toLowerCase() !== "full marks") {
        deductions[c] = s.deduction_reason;
      }
    }
  }
  return {
    ticket_number: result.ticket_number ?? "",
    ticket_subject: result.ticket_subject ?? "",
    ticket_date: result.ticket_date ?? "",
    agent_name: resolveTeamMember(ind.name) ?? ind.name ?? "",
    overall_score: typeof ind.total_score === "number" ? ind.total_score : "",
    grade: ind.grade ?? "",
    audit_month: result.audit_month ?? new Date().toISOString().slice(0, 7),
    queue: result.queue ?? "noc",
    criteria,
    deductions,
    what_did_well: ind.what_did_well ?? "",
    what_missed: ind.what_missed ?? "",
  };
}

// ── Per-individual review + save panel ───────────────────────────────────────
// Module-level save registry — survives component remounts caused by parent re-renders.
// Key: "fileName::individualName::role" — ensures each individual is saved exactly once
// per analysis session regardless of how many times the panel mounts/unmounts.
const _savedRegistry = new Set<string>();

// ── Score badge ───────────────────────────────────────────────────────────────
function ScoreBadge({ score, grade }: { score: number | null; grade: string | null }) {
  return (
    <Group gap={6}>
      {score !== null && (
        <Badge color={scoreColor(score)} variant="filled" size="sm" fw={700}>{score}</Badge>
      )}
      {grade && (
        <Badge color={gradeColor(grade)} variant="light" size="sm">{grade}</Badge>
      )}
    </Group>
  );
}

function IndividualReviewPanel({
  individual,
  parsedResult,
  fileName,
  fileSize,
  analysisMarkdown,
  saveAudit,
  identity,
  onSaved,
}: {
  individual: AuditIndividual;
  parsedResult: ParsedAuditResult;
  fileName: string;
  fileSize: number;
  analysisMarkdown: string;
  saveAudit: (payload: Omit<TicketAudit, "id" | "created_at">) => Promise<TicketAudit>;
  identity: { name: string } | null;
  onSaved: () => void;
}) {
  const fields = buildFieldsFromIndividual(parsedResult, individual);
  // Stable key for this individual within this file — survives remounts
  const saveKey = `${fileName}::${individual.name}::${individual.role}`;
  const alreadySaved = _savedRegistry.has(saveKey);
  const [saving, setSaving] = useState(!alreadySaved);
  const [saved, setSaved] = useState(alreadySaved);
  const [saveError, setSaveError] = useState<string | null>(null);
  const isContributorAS = individual.role === "Contributor - AS";

  // Auto-save immediately on mount — no manual save button.
  // Module-level registry (_savedRegistry) prevents duplicate saves across remounts.
  useEffect(() => {
    if (_savedRegistry.has(saveKey)) return; // already saved in this session
    _savedRegistry.add(saveKey);
    async function autoSave() {
      try {
        let criteriaJson: string | null = null;
        if (individual.scores && Object.keys(individual.scores).length > 0) {
          const full: Record<string, { score: number; max: number; points_deducted: number; deduction_reason: string; evidence: string }> = {};
          for (const [cat, s] of Object.entries(individual.scores)) {
            full[cat] = {
              score: fields.criteria[cat] ?? s.score,
              max: s.max,
              points_deducted: s.max - (fields.criteria[cat] ?? s.score),
              deduction_reason: s.deduction_reason || "Full marks",
              evidence: s.evidence || "N/A",
            };
          }
          criteriaJson = JSON.stringify(full);
        } else if (Object.keys(fields.criteria).length > 0) {
          criteriaJson = JSON.stringify(fields.criteria);
        }
        await saveAudit({
          file_name: fileName,
          file_size_bytes: fileSize,
          ticket_number: fields.ticket_number || null,
          ticket_subject: fields.ticket_subject || null,
          ticket_date: fields.ticket_date || null,
          agent_name: fields.agent_name || null,
          agent_name_raw: fields.agent_name || null,
          overall_score: typeof fields.overall_score === "number" ? fields.overall_score : null,
          grade: fields.grade || null,
          criteria_json: criteriaJson,
          what_did_well: fields.what_did_well || null,
          what_missed: fields.what_missed || null,
          analysis_markdown: analysisMarkdown,
          audit_month: fields.audit_month || null,
          queue: fields.queue || null,
          audited_by: identity?.name ?? null,
          metrics_id: null,
        } as any);
        setSaved(true);
        onSaved();
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSaving(false);
      }
    }
    autoSave();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card withBorder radius="md" p="md">
      <Group justify="space-between" mb="md">
        <Group gap="xs">
          <Text fw={700} size="sm">{individual.name || "Unknown"}</Text>
          <Badge
            size="sm"
            color={individual.role === "Owner" ? "violet" : individual.role === "Contributor - AS" ? "orange" : "blue"}
            variant="light"
          >
            {individual.role}
          </Badge>
          {isContributorAS && (
            <Badge size="xs" color="orange" variant="outline">Admin Support — Full Marks</Badge>
          )}
        </Group>
        <Group gap="xs">
          <ScoreBadge score={typeof fields.overall_score === "number" ? fields.overall_score : null} grade={fields.grade} />
          {saving && <Loader size="xs" color="violet" />}
          {saved && <Badge size="sm" color="green" variant="light" leftSection={<IconCheck size={10} />}>Saved to History</Badge>}
          {saveError && <Badge size="sm" color="red" variant="light">Save failed</Badge>}
        </Group>
      </Group>

      <Stack gap="sm">
        {/* Read-only ticket info */}
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
          {fields.ticket_number && <Box><Text size="xs" c="dimmed" fw={600} tt="uppercase">Ticket</Text><Text size="sm" fw={500}>{fields.ticket_number}</Text></Box>}
          {fields.ticket_date && <Box><Text size="xs" c="dimmed" fw={600} tt="uppercase">Date</Text><Text size="sm">{fields.ticket_date}</Text></Box>}
          {fields.audit_month && <Box><Text size="xs" c="dimmed" fw={600} tt="uppercase">Month</Text><Text size="sm">{fields.audit_month}</Text></Box>}
          {fields.queue && <Box><Text size="xs" c="dimmed" fw={600} tt="uppercase">Queue</Text><Badge size="sm" color={fields.queue === "noc" ? "blue" : "violet"} variant="light">{fields.queue.toUpperCase()}</Badge></Box>}
        </SimpleGrid>

        {/* Criteria scores — read-only display */}
        <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
          {AUDIT_CRITERIA.map((criterion) => {
            const score = fields.criteria[criterion];
            const detail = individual.scores?.[criterion];
            const hasDeduction = detail && detail.points_deducted > 0;
            return (
              <Box key={criterion} p="xs" style={{ background: "var(--mantine-color-dark-7)", borderRadius: 6, borderLeft: `3px solid ${hasDeduction ? "var(--mantine-color-red-7)" : "var(--mantine-color-green-7)"}` }}>
                <Group justify="space-between" mb={2}>
                  <Text size="xs" fw={600} lineClamp={1}>{criterion}</Text>
                  <Badge size="xs" color={hasDeduction ? "red" : "green"} variant="light">
                    {score ?? "—"}/{AUDIT_CRITERIA_MAX[criterion]}
                  </Badge>
                </Group>
                {hasDeduction && detail.deduction_reason && detail.deduction_reason !== "Full marks" && (
                  <Text size="xs" c="red.4" lineClamp={2}>{detail.deduction_reason}</Text>
                )}
              </Box>
            );
          })}
        </SimpleGrid>

        {/* What did well / what missed */}
        {(fields.what_did_well || fields.what_missed) && (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            {fields.what_did_well && (
              <Box p="xs" style={{ background: "var(--mantine-color-dark-7)", borderRadius: 6 }}>
                <Text size="xs" fw={700} c="green.4" mb={4}>✓ What You Did Well</Text>
                <Text size="xs" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>{fields.what_did_well}</Text>
              </Box>
            )}
            {fields.what_missed && (
              <Box p="xs" style={{ background: "var(--mantine-color-dark-7)", borderRadius: 6 }}>
                <Text size="xs" fw={700} c="red.4" mb={4}>✗ What You Missed</Text>
                <Text size="xs" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>{fields.what_missed}</Text>
              </Box>
            )}
          </SimpleGrid>
        )}

        {saveError && <Alert color="red" icon={<IconAlertCircle size={16} />} radius="md">{saveError}</Alert>}
      </Stack>
    </Card>
  );
}

// ── Upload & Analyze tab ──────────────────────────────────────────────────────
function UploadTab({ onSaved }: { onSaved: () => void }) {
  const { identity } = useIdentity();
  const { saveAudit } = useTicketAudits();

  const [inputMode, setInputMode] = useState<"upload" | "paste">("upload");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [parsedText, setParsedText] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [streaming, setStreaming] = useState(false);
  const [streamResult, setStreamResult] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [analysisMarkdown, setAnalysisMarkdown] = useState("");
  const [analyzed, setAnalyzed] = useState(false);
  const [parsedResult, setParsedResult] = useState<ParsedAuditResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetState() {
    setParseError(null);
    setStreamResult("");
    setStreamError(null);
    setAnalyzed(false);
    setParsedResult(null);
  }

  async function handleFile(file: File) {
    resetState();
    setFileName(file.name);
    setFileSize(file.size);
    setParsedText("");
    try {
      const parsed = await parseMhtmlFile(file);
      setParsedText(parsed.text);
      // ticket metadata extracted after analysis — no per-field pre-fill needed
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Failed to parse file");
    }
  }

  function handleUsePasted() {
    if (!pastedText.trim()) return;
    resetState();
    setFileName("pasted-ticket.txt");
    setFileSize(new Blob([pastedText]).size);
    setParsedText(pastedText.slice(0, MAX_PROMPT_CHARS));
  }



  async function runAnalysis() {
    if (!parsedText) return;
    setStreaming(true);
    setStreamResult("");
    setStreamError(null);
    setAnalyzed(false);
    abortRef.current = new AbortController();

    let assembled = "";

    // Use the /api/audit/analyze endpoint which uses AUDIT_AGENT_ID
    try {
      const res = await fetch("/api/audit/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: parsedText, fileName }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setStreamError(j.error ?? `HTTP ${res.status}`);
        setStreaming(false);
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
                  assembled += parsed.content.text;
                  setStreamResult(assembled);
                } else if (currentEvent === "message.complete") {
                  // done
                } else if (currentEvent === "message.error") {
                  setStreamError(parsed.error ?? "Stream error");
                }
              } catch { /* skip */ }
            }
            currentEvent = "";
            currentData = "";
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setStreamError(e instanceof Error ? e.message : "Failed to analyze");
      }
    }

    // Parse structured fields from the result
    const parsed = parseAuditJson(assembled);
    setParsedResult(parsed);
    // IndividualReviewPanel components initialize their own fields per individual
    setAnalysisMarkdown(extractAnalysisMarkdown(assembled));
    setStreaming(false);
    setAnalyzed(true);
  }

  return (
    <Stack gap="md" pt="md">

      {/* Input mode switcher */}
      <SegmentedControl
        value={inputMode}
        onChange={(v) => {
          setInputMode(v as "upload" | "paste");
          resetState();
          setParsedText("");
          setPastedText("");
          setFileName("");
        }}
        data={[
          { value: "upload", label: (
            <Group gap={6} wrap="nowrap">
              <IconUpload size={14} />
              <Text size="sm">Upload MHTML File</Text>
            </Group>
          )},
          { value: "paste", label: (
            <Group gap={6} wrap="nowrap">
              <IconClipboardText size={14} />
              <Text size="sm">Paste Ticket Data</Text>
            </Group>
          )},
        ]}
        fullWidth
      />

      {/* ── Upload mode ── */}
      {inputMode === "upload" && (
        <>
          <Card
            withBorder radius="md" p="xl"
            style={{
              borderStyle: "dashed",
              borderColor: dragOver ? "var(--mantine-color-violet-5)" : "var(--mantine-color-dark-4)",
              background: dragOver ? "var(--mantine-color-violet-9)" : undefined,
              cursor: "pointer",
              textAlign: "center",
            }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".mhtml,.mht,.html,.htm"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <Stack align="center" gap="xs">
              <IconUpload size={28} color="var(--mantine-color-violet-5)" />
              {parsedText ? (
                <>
                  <Text fw={600} size="sm">{fileName}</Text>
                  <Text size="xs" c="dimmed">{(fileSize / 1024).toFixed(1)} KB · {parsedText.length.toLocaleString()} chars extracted</Text>
                </>
              ) : (
                <>
                  <Text fw={600} size="sm">Drop a ticket .mhtml file here</Text>
                  <Text size="xs" c="dimmed">or click to browse · .mhtml / .mht / .html</Text>
                </>
              )}
            </Stack>
          </Card>
        </>
      )}

      {/* ── Paste mode ── */}
      {inputMode === "paste" && (
        <Stack gap="sm">
          <Textarea
            label="Paste Ticket Data"
            description="Paste the full ticket notes, history, or any relevant text directly here"
            placeholder={"Ticket #: TT-123456\nAgent: John Smith\nDate: 2026-05-20\n\nNotes:\n[Paste your ticket content here...]"}
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            minRows={10}
            autosize
            styles={{ input: { fontFamily: "monospace", fontSize: 13 } }}
          />
          {pastedText.trim() && !parsedText && (
            <Group>
              <Button
                leftSection={<IconClipboardText size={15} />}
                color="violet"
                variant="light"
                onClick={handleUsePasted}
              >
                Use This Text
              </Button>
              <Text size="xs" c="dimmed">{pastedText.length.toLocaleString()} characters</Text>
            </Group>
          )}
          {parsedText && inputMode === "paste" && (
            <Alert color="green" variant="light" radius="md" icon={<IconCheck size={14} />}>
              <Text size="xs">Text loaded — {parsedText.length.toLocaleString()} chars ready for analysis.</Text>
            </Alert>
          )}
        </Stack>
      )}

      {parseError && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} radius="md">
          {parseError}
        </Alert>
      )}

      {/* Analyze button */}
      {parsedText && !analyzed && (
        <Group>
          <Button
            leftSection={<IconGavel size={16} />}
            color="violet"
            onClick={runAnalysis}
            loading={streaming}
          >
            Analyze with AI Auditor
          </Button>
          {streaming && (
            <ActionIcon variant="subtle" color="gray" onClick={() => abortRef.current?.abort()}>
              <IconPlayerStop size={16} />
            </ActionIcon>
          )}
        </Group>
      )}

      {/* Streaming result */}
      {streamResult && (
        <Card withBorder radius="md" p="md">
          <Group justify="space-between" mb="xs">
            <Text size="xs" fw={700} tt="uppercase" c="violet">AI Audit Analysis</Text>
            {streaming && <Loader size="xs" color="violet" />}
          </Group>
          <ScrollArea h={320}>
            <Box className="prose prose-invert max-w-none" style={{ fontSize: 13 }}>
              <ReactMarkdown>{streamResult}</ReactMarkdown>
            </Box>
          </ScrollArea>
        </Card>
      )}

      {streamError && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} radius="md">
          {streamError}
        </Alert>
      )}

      {/* Structured fields to review/edit — split by role */}
      {analyzed && parsedResult && (() => {
        const owners = parsedResult.individuals.filter((i) => i.role === "Owner");
        const contributors = parsedResult.individuals.filter((i) => i.role !== "Owner");
        return (
        <>
          <Divider label="Review & Save Audit Scores" labelPosition="center" />

          <Tabs defaultValue="owners" variant="outline">
            <Tabs.List>
              <Tabs.Tab value="owners" leftSection={<IconGavel size={14} />}>
                Owners <Badge size="xs" ml={4} color="violet" variant="light">{owners.length}</Badge>
              </Tabs.Tab>
              <Tabs.Tab value="contributors" leftSection={<IconClipboardText size={14} />}>
                Contributors <Badge size="xs" ml={4} color="blue" variant="light">{contributors.length}</Badge>
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="owners" pt="md">
              {owners.length === 0 ? (
                <Text c="dimmed" ta="center" py="xl" size="sm">No owners identified in this ticket.</Text>
              ) : (
                <Stack gap="lg">
                  {owners.map((ind, i) => (
                    <IndividualReviewPanel
                      key={i}
                      individual={ind}
                      parsedResult={parsedResult}
                      fileName={fileName}
                      fileSize={fileSize}
                      analysisMarkdown={analysisMarkdown || streamResult}
                      saveAudit={saveAudit}
                      identity={identity}
                      onSaved={onSaved}
                    />
                  ))}
                </Stack>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="contributors" pt="md">
              {contributors.length === 0 ? (
                <Text c="dimmed" ta="center" py="xl" size="sm">No contributors identified in this ticket.</Text>
              ) : (
                <Stack gap="lg">
                  {contributors.map((ind, i) => (
                    <IndividualReviewPanel
                      key={i}
                      individual={ind}
                      parsedResult={parsedResult}
                      fileName={fileName}
                      fileSize={fileSize}
                      analysisMarkdown={analysisMarkdown || streamResult}
                      saveAudit={saveAudit}
                      identity={identity}
                      onSaved={onSaved}
                    />
                  ))}
                </Stack>
              )}
            </Tabs.Panel>
          </Tabs>

          <Divider
            label={<Group gap={6}><IconMessageCircle size={13} /><Text size="xs" fw={600}>Ask the Audit Assistant</Text></Group>}
            labelPosition="left"
            mt="xs"
          />
          <AuditChat
            audit={{
              id: 0,
              file_name: fileName,
              file_size_bytes: fileSize,
              ticket_number: parsedResult.ticket_number,
              ticket_subject: parsedResult.ticket_subject,
              ticket_date: parsedResult.ticket_date,
              agent_name: parsedResult.individuals[0]?.name ?? null,
              agent_name_raw: parsedResult.individuals[0]?.name ?? null,
              overall_score: parsedResult.individuals[0]?.total_score ?? null,
              grade: parsedResult.individuals[0]?.grade ?? null,
              criteria_json: null,
              what_did_well: parsedResult.individuals[0]?.what_did_well ?? null,
              what_missed: parsedResult.individuals[0]?.what_missed ?? null,
              analysis_markdown: analysisMarkdown || streamResult,
              audit_month: parsedResult.audit_month,
              queue: parsedResult.queue,
              audited_by: null,
              metrics_id: null,
              created_at: new Date().toISOString(),
            }}
          />

          <Group justify="flex-end">
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              onClick={() => { setAnalyzed(false); setStreamResult(""); setParsedResult(null); setParsedText(""); setFileName(""); setAnalysisMarkdown(""); }}
            >
              Clear & Start Over
            </Button>
          </Group>
        </>
        );
      })()}
    </Stack>
  );
}

// ── Audit History tab ─────────────────────────────────────────────────────────
function HistoryTab({ audits, loading, onDelete, onClearAll }: {
  audits: TicketAudit[];
  loading: boolean;
  onDelete: (id: number) => Promise<void>;
  onClearAll: () => Promise<void>;
}) {
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";
  const [viewing, setViewing] = useState<TicketAudit | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  async function handleDelete(id: number) {
    setDeleting(id);
    try { await onDelete(id); } finally { setDeleting(null); }
  }

  async function handleClearAll() {
    setClearing(true);
    try { await onClearAll(); setConfirmClear(false); } finally { setClearing(false); }
  }

  return (
    <Stack gap="md" pt="md">
      {loading && <Loader size="sm" color="violet" />}

      {/* Manager-only: Clear All button + confirm */}
      {isManager && audits.length > 0 && (
        <Group justify="flex-end">
          {confirmClear ? (
            <Group gap="xs">
              <Text size="xs" c="dimmed">Delete all {audits.length} audits?</Text>
              <Button size="xs" color="red" loading={clearing} onClick={handleClearAll}
                leftSection={<IconTrash size={12} />}>
                Yes, clear all
              </Button>
              <Button size="xs" variant="subtle" color="gray" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            </Group>
          ) : (
            <Button size="xs" variant="light" color="red"
              leftSection={<IconTrash size={12} />}
              onClick={() => setConfirmClear(true)}>
              Clear All Audits
            </Button>
          )}
        </Group>
      )}

      {audits.length === 0 && !loading && (
        <Text c="dimmed" ta="center" py="xl">
          No audits saved yet. Upload an MHTML ticket in the Upload tab.
        </Text>
      )}

      {audits.length > 0 && (
        <Card withBorder radius="md" p={0}>
          <ScrollArea>
            <Table fz="sm" horizontalSpacing="md" verticalSpacing="sm" striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>#</Table.Th>
                  <Table.Th>Agent</Table.Th>
                  <Table.Th>Ticket</Table.Th>
                  <Table.Th>Month</Table.Th>
                  <Table.Th>Queue</Table.Th>
                  <Table.Th>Score</Table.Th>
                  <Table.Th>Grade</Table.Th>
                  <Table.Th>Metrics</Table.Th>
                  <Table.Th>Date</Table.Th>
                  <Table.Th></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {audits.map((a) => (
                  <Table.Tr key={a.id} style={{ cursor: "pointer" }} onClick={() => setViewing(a)}>
                    <Table.Td>
                      <Text size="xs" c="dimmed" ff="monospace">{a.id}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text fw={500} size="sm">{a.agent_name ?? "—"}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" truncate style={{ maxWidth: 180 }}>
                        {a.ticket_number ?? ""}
                        {a.ticket_subject ? ` · ${a.ticket_subject}` : ""}
                        {!a.ticket_number && !a.ticket_subject ? a.file_name : ""}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace">{a.audit_month ?? "—"}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color={a.queue === "noc" ? "blue" : "violet"}>
                        {a.queue ?? "—"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {a.overall_score !== null ? (
                        <Badge size="sm" color={scoreColor(a.overall_score)} variant="filled" fw={700}>
                          {a.overall_score}
                        </Badge>
                      ) : "—"}
                    </Table.Td>
                    <Table.Td>
                      {a.grade ? (
                        <Badge size="sm" color={gradeColor(a.grade)} variant="light">{a.grade}</Badge>
                      ) : "—"}
                    </Table.Td>
                    <Table.Td>
                      {a.metrics_id ? (
                        <Badge size="xs" color="green" variant="light">Pushed</Badge>
                      ) : (
                        <Badge size="xs" color="gray" variant="outline">Pending</Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {new Date(a.created_at).toLocaleDateString()}
                      </Text>
                    </Table.Td>
                    <Table.Td onClick={(e) => e.stopPropagation()}>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="red"
                        loading={deleting === a.id}
                        onClick={() => handleDelete(a.id)}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      )}

      {/* Detail modal */}
      <Modal
        opened={!!viewing}
        onClose={() => setViewing(null)}
        title={
          <Group gap="sm">
            <IconGavel size={18} color="var(--mantine-color-violet-5)" />
            <Text fw={600}>{viewing?.ticket_number ?? viewing?.file_name}</Text>
            {viewing && <ScoreBadge score={viewing.overall_score} grade={viewing.grade} />}
          </Group>
        }
        size="xl"
        scrollAreaComponent={ScrollArea.Autosize}
      >
        {viewing && (
          <Stack gap="md">
            <SimpleGrid cols={2} spacing="sm">
              <Box>
                <Text size="xs" c="dimmed" fw={600} tt="uppercase">Agent</Text>
                <Text fw={500}>{viewing.agent_name ?? "—"}</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed" fw={600} tt="uppercase">Month</Text>
                <Text fw={500}>{viewing.audit_month ?? "—"}</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed" fw={600} tt="uppercase">Queue</Text>
                <Badge color={viewing.queue === "noc" ? "blue" : "violet"} variant="light">
                  {viewing.queue ?? "—"}
                </Badge>
              </Box>
              <Box>
                <Text size="xs" c="dimmed" fw={600} tt="uppercase">Audited by</Text>
                <Text fw={500}>{viewing.audited_by ?? "—"}</Text>
              </Box>
            </SimpleGrid>

            {viewing.criteria_json && (() => {
              try {
                const raw = JSON.parse(viewing.criteria_json);
                // Detect format: new = { score, max, deduction_reason, ... }, old = plain number
                const isNew = Object.values(raw).some((v) => v !== null && typeof v === "object");
                return (
                  <Card withBorder radius="md" p="sm">
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="xs">Criteria Scores</Text>
                    <Stack gap={8}>
                      {Object.entries(raw).map(([k, v]) => {
                        const score = isNew ? (v as any).score : (v as number);
                        const max   = isNew ? (v as any).max   : null;
                        const deducted = isNew ? (v as any).points_deducted : 0;
                        const reason   = isNew ? (v as any).deduction_reason : null;
                        // support both new `evidence` and legacy `what_happened`+`exact_evidence`
                        const rawEvidence = isNew ? ((v as any).evidence || [((v as any).what_happened || ""), ((v as any).exact_evidence || "")].filter(x => x && x !== "N/A").join(" | ")) : null;
                        const evidence = rawEvidence || null;
                        const pct = max ? (score / max) * 100 : score * 10;
                        return (
                          <Box key={k}>
                            <Group justify="space-between" mb={3}>
                              <Text size="sm" fw={500}>{k}</Text>
                              <Group gap={6}>
                                <Progress value={pct} size="sm" w={80} color={scoreColor(pct)} />
                                <Badge size="sm" color={scoreColor(pct)} variant="light" miw={48}>
                                  {score}{max ? `/${max}` : ""}
                                </Badge>
                              </Group>
                            </Group>
                            {deducted > 0 && reason && reason !== "Full marks" && (
                              <Box
                                p="xs"
                                style={{
                                  background: "var(--mantine-color-dark-7)",
                                  borderLeft: "3px solid var(--mantine-color-red-7)",
                                  borderRadius: "0 6px 6px 0",
                                }}
                              >
                                <Text size="xs" c="red.4" fw={600} mb={2}>
                                  −{deducted} pts · {reason}
                                </Text>
                                {evidence && evidence !== "N/A" && (
                                  <Text size="xs" c="dimmed" mt={2}>
                                    <Text component="span" fw={600} c="bright" inherit>Evidence: </Text>
                                    {evidence}
                                  </Text>
                                )}
                              </Box>
                            )}
                          </Box>
                        );
                      })}
                    </Stack>
                  </Card>
                );
              } catch { return null; }
            })()}

            <Divider label="Audit Report" labelPosition="center" />
            <Box className="prose prose-invert max-w-none" style={{ fontSize: 13 }}>
              <ReactMarkdown>{viewing.analysis_markdown}</ReactMarkdown>
            </Box>

            <Divider
              label={
                <Group gap={6}>
                  <IconMessageCircle size={13} />
                  <Text size="xs" fw={600}>Ask the Audit Assistant</Text>
                </Group>
              }
              labelPosition="left"
            />
            <AuditChat audit={viewing} />
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

// ── Push to Metrics tab ───────────────────────────────────────────────────────
function PushToMetricsTab({ audits, onPushed }: { audits: TicketAudit[]; onPushed: () => void }) {
  const unpushed = audits.filter((a) => !a.metrics_id && a.agent_name && a.overall_score !== null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<string | null>(null);

  function toggleAll() {
    if (selected.size === unpushed.length) setSelected(new Set());
    else setSelected(new Set(unpushed.map((a) => a.id)));
  }

  async function handlePush() {
    if (selected.size === 0) return;
    setPushing(true);
    setPushError(null);
    setPushResult(null);

    const audit_ids = unpushed
      .filter((a) => selected.has(a.id))
      .map((a) => a.id);

    try {
      const r = await fetch("/api/audit/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audit_ids }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);

      const { pushed, failed, errors } = j as { pushed: number; failed: number; errors: string[] };

      setPushResult(
        `Pushed ${pushed} audit${pushed !== 1 ? "s" : ""} to Performance Tracker` +
        (failed > 0 ? ` · ${failed} failed: ${errors.join("; ")}` : " ✅"),
      );
      setSelected(new Set());
      onPushed();
    } catch (e) {
      setPushError(e instanceof Error ? e.message : "Push failed");
    }

    setPushing(false);
    onPushed();
  }

  return (
    <Stack gap="md" pt="md">
      <Alert icon={<IconChartBar size={16} />} color="violet" variant="light" radius="md">
        <Text size="sm">
          Select audits below to push their scores to the <b>Team Performance</b> widget as <code>source_type = "audit"</code>. 
          Each pushed audit creates a performance metric row for the agent, visible in their drill-down.
        </Text>
      </Alert>

      {unpushed.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          No audits ready to push. Either all audits are already in metrics, or you haven't saved any audits with agent name + score yet.
        </Text>
      ) : (
        <>
          <Group justify="space-between">
            <Group gap="sm">
              <Checkbox
                checked={selected.size === unpushed.length}
                indeterminate={selected.size > 0 && selected.size < unpushed.length}
                onChange={toggleAll}
                label={`Select all (${unpushed.length})`}
              />
              <Text size="xs" c="dimmed">{selected.size} selected</Text>
            </Group>
            <Button
              leftSection={<IconSend size={15} />}
              color="violet"
              size="sm"
              disabled={selected.size === 0}
              loading={pushing}
              onClick={handlePush}
            >
              Push to Performance Tracker
            </Button>
          </Group>

          <Card withBorder radius="md" p={0}>
            <Table fz="sm" horizontalSpacing="md" verticalSpacing="sm" striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}></Table.Th>
                  <Table.Th>Agent</Table.Th>
                  <Table.Th>Ticket</Table.Th>
                  <Table.Th>Month</Table.Th>
                  <Table.Th>Score</Table.Th>
                  <Table.Th>Grade</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {unpushed.map((a) => (
                  <Table.Tr key={a.id}>
                    <Table.Td>
                      <Checkbox
                        checked={selected.has(a.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.currentTarget.checked) next.add(a.id);
                          else next.delete(a.id);
                          setSelected(next);
                        }}
                      />
                    </Table.Td>
                    <Table.Td><Text fw={500}>{a.agent_name}</Text></Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">{a.ticket_number ?? a.file_name}</Text>
                    </Table.Td>
                    <Table.Td><Text size="xs" ff="monospace">{a.audit_month ?? "—"}</Text></Table.Td>
                    <Table.Td>
                      <Badge color={scoreColor(a.overall_score)} variant="filled" size="sm" fw={700}>
                        {a.overall_score}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={gradeColor(a.grade)} variant="light" size="sm">{a.grade}</Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        </>
      )}

      {pushError && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} radius="md">{pushError}</Alert>
      )}
      {pushResult && (
        <Alert color="green" icon={<IconCheck size={16} />} radius="md">{pushResult}</Alert>
      )}
    </Stack>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────
export function TicketAuditWidget() {
  const { identity } = useIdentity();
  const role = identity?.role;
  const canUseAuditWidget = role === "tier2" || role === "tier3" || role === "manager";
  const canPushMetrics = role === "manager";

  const { audits, loading, error, refresh, deleteAudit, clearAllAudits } = useTicketAudits();
  const [activeTab, setActiveTab] = useState<string | null>("upload");

  return (
    <WidgetFrame
      title="Ticket Audit"
      subtitle="AI-powered quality audits from MHTML ticket files"
      icon={IconGavel}
      iconColor="violet"
      loading={false}
      onRefresh={refresh}
      status={{ label: "AI Audit", color: "violet", tooltip: "Uses your configured audit agent" }}
    >
      <Stack gap={0}>
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" radius="md" mb="md">
            {error}
          </Alert>
        )}

        {!canUseAuditWidget ? (
          <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light" radius="md" mt="md">
            Ticket Audit is available to Tier 2, Tier 3, and Managers. Your current role does not have access.
          </Alert>
        ) : (
          <Tabs value={activeTab} onChange={setActiveTab} variant="default" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="upload" leftSection={<IconUpload size={14} />}>
              Upload &amp; Analyze
            </Tabs.Tab>
            <Tabs.Tab value="bulk" leftSection={<IconFiles size={14} />}>
              Bulk Upload
            </Tabs.Tab>
            <Tabs.Tab
              value="history"
              leftSection={<IconHistory size={14} />}
              rightSection={
                audits.length > 0 ? (
                  <Badge size="xs" circle color="violet">{audits.length}</Badge>
                ) : null
              }
            >
              Audit History
            </Tabs.Tab>
            {(role === "manager") && (
              <Tabs.Tab value="metrics" leftSection={<IconChartBar size={14} />}>
                Push to Metrics
              </Tabs.Tab>
            )}
          </Tabs.List>

          <Tabs.Panel value="upload">
            <UploadTab onSaved={() => { refresh(); setActiveTab("history"); }} />
          </Tabs.Panel>

          <Tabs.Panel value="bulk">
            <BulkUploadTab onSaved={refresh} />
          </Tabs.Panel>

          <Tabs.Panel value="history">
            <HistoryTab audits={audits} loading={loading} onDelete={deleteAudit} onClearAll={clearAllAudits} />
          </Tabs.Panel>

          {canPushMetrics && (
            <Tabs.Panel value="metrics">
              <PushToMetricsTab audits={audits} onPushed={refresh} />
            </Tabs.Panel>
          )}
        </Tabs>
        )}
      </Stack>
    </WidgetFrame>
  );
}
