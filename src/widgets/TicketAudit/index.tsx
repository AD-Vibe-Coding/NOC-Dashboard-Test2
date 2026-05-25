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
  NumberInput,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconChartBar,
  IconClipboardText,
  IconFiles,
  IconFlag,
  IconGavel,
  IconHistory,
  IconInfoCircle,
  IconPlayerStop,
  IconSend,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import { parseMhtmlFile } from "../../lib/mhtml";
import { useIdentity } from "../../lib/identity";
import { WidgetFrame } from "../WidgetFrame";
import { LOCKED_TEAM, resolveTeamMember } from "../PerformanceTracker/team";
import { BulkUploadTab } from "./BulkUploadTab";
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

function emptyFields(): AuditFields {
  return {
    ticket_number: "",
    ticket_subject: "",
    ticket_date: "",
    agent_name: "",
    overall_score: "",
    grade: "",
    audit_month: new Date().toISOString().slice(0, 7),
    queue: "noc",
    criteria: {},
    deductions: {},
    what_did_well: "",
    what_missed: "",
  };
}

// ── Dispute state for a single criterion ─────────────────────────────────────
interface DisputeEntry {
  criterion: string;
  originalScore: number;
  suggestedScore: number | "";
  reason: string;
  resolved: boolean;  // true once user submits the dispute (score updated)
}

// ── Dispute Modal ─────────────────────────────────────────────────────────────
function DisputeModal({
  entry,
  deductionReason,
  onClose,
  onSubmit,
}: {
  entry: DisputeEntry | null;
  deductionReason: string;
  onClose: () => void;
  onSubmit: (criterion: string, newScore: number, reason: string) => void;
}) {
  const [score, setScore] = useState<number | "">(entry?.suggestedScore ?? "");
  const [reason, setReason] = useState(entry?.reason ?? "");

  // Reset when entry changes
  useEffect(() => {
    setScore(entry?.originalScore ?? "");
    setReason("");
  }, [entry?.criterion]);

  if (!entry) return null;

  return (
    <Modal
      opened={!!entry}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconFlag size={16} color="var(--mantine-color-orange-5)" />
          <Text fw={600} size="sm">Dispute Score — {entry.criterion}</Text>
        </Group>
      }
      size="md"
      withinPortal
    >
      <Stack gap="md">
        {/* Current score + deduction reason */}
        <Card withBorder radius="md" p="sm" style={{ background: "var(--mantine-color-dark-7)" }}>
          <Group justify="space-between" mb={6}>
            <Text size="xs" tt="uppercase" fw={700} c="dimmed">AI-Assigned Score</Text>
            <Badge color="red" variant="filled" size="sm" fw={700}>{entry.originalScore}</Badge>
          </Group>
          {deductionReason ? (
            <>
              <Text size="xs" fw={600} c="orange" mb={2}>Reason for deduction:</Text>
              <Text size="sm" c="dimmed" style={{ fontStyle: "italic" }}>{deductionReason}</Text>
            </>
          ) : (
            <Text size="xs" c="dimmed">No specific reason extracted from agent output.</Text>
          )}
        </Card>

        {/* Suggested corrected score */}
        <NumberInput
          label="Your Suggested Score"
          description="Enter the score you believe is correct for this criterion"
          value={score}
          onChange={(v) => setScore(typeof v === "number" ? v : "")}
          step={1}
          placeholder="e.g. 9"
        />

        {/* Dispute reason */}
        <Textarea
          label="Reason for Dispute"
          description="Explain why you believe the score should be different"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. The ticket was acknowledged within 10 minutes as per the notes on line 3..."
          minRows={4}
          autosize
        />

        <Group justify="flex-end" gap="sm">
          <Button variant="subtle" color="gray" onClick={onClose} leftSection={<IconX size={14} />}>
            Cancel
          </Button>
          <Button
            color="orange"
            leftSection={<IconFlag size={14} />}
            disabled={typeof score !== "number" || !reason.trim()}
            onClick={() => {
              if (typeof score === "number" && reason.trim()) {
                onSubmit(entry.criterion, score, reason.trim());
                onClose();
              }
            }}
          >
            Apply Dispute
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ── Score Deductions Panel ────────────────────────────────────────────────────
function DeductionsPanel({
  criteria,
  deductions,
  disputes,
  onDispute,
}: {
  criteria: Record<string, number>;
  deductions: Record<string, string>;
  disputes: Record<string, DisputeEntry>;
  onDispute: (criterion: string) => void;
}) {
  const rows = AUDIT_CRITERIA.filter((c) => criteria[c] !== undefined);
  if (rows.length === 0) return null;

  return (
    <Card withBorder radius="md" p="md">
      <Group gap="xs" mb="sm">
        <IconFlag size={15} color="var(--mantine-color-orange-5)" />
        <Text size="sm" fw={700}>Score Deductions</Text>
        <Tooltip label="Shows the score given by the AI for each criterion and the reason. Dispute any score you disagree with before saving." withinPortal>
          <IconInfoCircle size={14} color="var(--mantine-color-dimmed)" style={{ cursor: "help" }} />
        </Tooltip>
      </Group>

      <Table fz="sm" withColumnBorders withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 200 }}>Criterion</Table.Th>
            <Table.Th style={{ width: 80, textAlign: "center" }}>Score</Table.Th>
            <Table.Th>Reason for Deduction</Table.Th>
            <Table.Th style={{ width: 120, textAlign: "center" }}>Action</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((criterion) => {
            const score = criteria[criterion];
            const reason = deductions[criterion] ?? "";
            const dispute = disputes[criterion];

            return (
              <Table.Tr key={criterion}>
                <Table.Td>
                  <Text size="xs" fw={500}>{criterion}</Text>
                </Table.Td>
                <Table.Td style={{ textAlign: "center" }}>
                  <Group gap={4} justify="center">
                    <Badge
                      size="sm"
                      variant="filled"
                      color={dispute?.resolved ? "orange" : "violet"}
                      fw={700}
                    >
                      {dispute?.resolved ? dispute.suggestedScore : score}
                    </Badge>
                    {dispute?.resolved && (
                      <Tooltip label={`Original: ${dispute.originalScore} → Disputed to: ${dispute.suggestedScore}`} withinPortal>
                        <Badge size="xs" color="orange" variant="light">disputed</Badge>
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  {dispute?.resolved ? (
                    <Stack gap={2}>
                      <Text size="xs" c="dimmed" style={{ textDecoration: "line-through" }}>{reason || "—"}</Text>
                      <Text size="xs" c="orange">✓ {dispute.reason}</Text>
                    </Stack>
                  ) : (
                    <Text size="xs" c={reason ? "dimmed" : "dark.3"} style={{ fontStyle: reason ? "italic" : "normal" }}>
                      {reason || "No specific deduction reason extracted"}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td style={{ textAlign: "center" }}>
                  {dispute?.resolved ? (
                    <Badge size="xs" color="orange" variant="outline" leftSection={<IconCheck size={10} />}>
                      Disputed
                    </Badge>
                  ) : (
                    <Button
                      size="xs"
                      variant="light"
                      color="orange"
                      leftSection={<IconFlag size={12} />}
                      onClick={() => onDispute(criterion)}
                    >
                      Dispute
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>

      {Object.values(disputes).some((d) => d.resolved) && (
        <Alert color="orange" variant="light" radius="md" mt="sm" icon={<IconInfoCircle size={14} />}>
          <Text size="xs">
            {Object.values(disputes).filter((d) => d.resolved).length} dispute(s) applied.
            Disputed scores are shown in orange above and will be saved with your audit.
          </Text>
        </Alert>
      )}
    </Card>
  );
}

// ── Score badge ───────────────────────────────────────────────────────────────
function ScoreBadge({ score, grade }: { score: number | null; grade: string | null }) {
  return (
    <Group gap={6}>
      {score !== null && (
        <Badge color={scoreColor(score)} variant="filled" size="sm" fw={700}>
          {score}
        </Badge>
      )}
      {grade && (
        <Badge color={gradeColor(grade)} variant="light" size="sm">
          {grade}
        </Badge>
      )}
    </Group>
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

  const [fields, setFields] = useState<AuditFields>(emptyFields());
  const [analysisMarkdown, setAnalysisMarkdown] = useState("");
  const [analyzed, setAnalyzed] = useState(false);

  // Multi-individual state
  const [parsedResult, setParsedResult] = useState<ParsedAuditResult | null>(null);
  const [selectedIndividualIdx, setSelectedIndividualIdx] = useState(0);

  // Dispute state
  const [disputeTarget, setDisputeTarget] = useState<string | null>(null); // criterion name
  const [disputes, setDisputes] = useState<Record<string, DisputeEntry>>({});

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetState() {
    setParseError(null);
    setStreamResult("");
    setStreamError(null);
    setAnalyzed(false);
    setSaved(false);
    setFields(emptyFields());
    setDisputes({});
    setDisputeTarget(null);
  }

  async function handleFile(file: File) {
    resetState();
    setFileName(file.name);
    setFileSize(file.size);
    setParsedText("");
    try {
      const parsed = await parseMhtmlFile(file);
      setParsedText(parsed.text.slice(0, MAX_PROMPT_CHARS));
      if (parsed.ticket_number) setFields((f) => ({ ...f, ticket_number: parsed.ticket_number! }));
      if (parsed.ticket_subject) setFields((f) => ({ ...f, ticket_subject: parsed.ticket_subject! }));
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

  function populateFieldsFromIndividual(result: ParsedAuditResult, _idx: number, ind: AuditIndividual) {
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
    setFields({
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
    });
    setDisputes({});
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
    if (parsed && parsed.individuals.length > 0) {
      setSelectedIndividualIdx(0);
      populateFieldsFromIndividual(parsed, 0, parsed.individuals[0]);
      setDisputes({});
    }
    setAnalysisMarkdown(extractAnalysisMarkdown(assembled));
    setStreaming(false);
    setAnalyzed(true);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const criteriaJson = Object.keys(fields.criteria).length > 0
        ? JSON.stringify(fields.criteria)
        : null;

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
        analysis_markdown: analysisMarkdown || streamResult,
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

  function handleDisputeSubmit(criterion: string, newScore: number, reason: string) {
    const originalScore = fields.criteria[criterion];
    // Update the criteria score in fields
    setFields((f) => ({
      ...f,
      criteria: { ...f.criteria, [criterion]: newScore },
    }));
    // Record the dispute
    setDisputes((d) => ({
      ...d,
      [criterion]: {
        criterion,
        originalScore,
        suggestedScore: newScore,
        reason,
        resolved: true,
      },
    }));
  }

  const teamNames = LOCKED_TEAM.map((m) => ({ value: m.name, label: m.name }));

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

      {/* Structured fields to review/edit */}
      {analyzed && (
        <>
          <Divider label="Review & Edit Audit Fields" labelPosition="center" />

          {/* Multi-individual selector */}
          {parsedResult && parsedResult.individuals.length > 1 && (
            <Alert icon={<IconInfoCircle size={14} />} color="violet" variant="light" radius="md">
              <Text size="sm" fw={600} mb={6}>
                {parsedResult.individuals.length} individuals identified in this ticket. Select each to review and save separately.
              </Text>
              <Group gap="xs" wrap="wrap">
                {parsedResult.individuals.map((ind, idx) => (
                  <Button
                    key={idx}
                    size="xs"
                    variant={selectedIndividualIdx === idx ? "filled" : "light"}
                    color="violet"
                    onClick={() => {
                      setSelectedIndividualIdx(idx);
                      populateFieldsFromIndividual(parsedResult, idx, ind);
                      setSaved(false);
                    }}
                  >
                    {ind.name || `Individual ${idx + 1}`}
                    <Badge size="xs" ml={6} color={selectedIndividualIdx === idx ? "white" : "violet"} variant={selectedIndividualIdx === idx ? "white" : "light"}>
                      {ind.role}
                    </Badge>
                  </Button>
                ))}
              </Group>
            </Alert>
          )}

          {/* Row 1: ticket info */}
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
            <TextInput
              label="Date"
              value={fields.ticket_date}
              onChange={(e) => setFields((f) => ({ ...f, ticket_date: e.target.value }))}
              placeholder="YYYY-MM-DD"
              description="Date the ticket was worked"
            />
            <TextInput
              label="Ticket Number"
              value={fields.ticket_number}
              onChange={(e) => setFields((f) => ({ ...f, ticket_number: e.target.value }))}
              placeholder="e.g. TT-123456"
            />
            <TextInput
              label="Ticket Subject"
              value={fields.ticket_subject}
              onChange={(e) => setFields((f) => ({ ...f, ticket_subject: e.target.value }))}
              placeholder="Brief description"
            />
          </SimpleGrid>

          {/* Row 2: agent + queue + month + grade */}
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm">
            <Select
              label="Ticket Owner (Agent)"
              data={teamNames}
              value={fields.agent_name || null}
              onChange={(v) => setFields((f) => ({ ...f, agent_name: v ?? "" }))}
              searchable clearable
              placeholder="Select team member"
            />
            <Select
              label="Queue"
              data={[
                { value: "noc", label: "NOC" },
                { value: "mobility", label: "Mobility" },
              ]}
              value={fields.queue}
              onChange={(v) => setFields((f) => ({ ...f, queue: v ?? "noc" }))}
            />
            <TextInput
              label="Audit Month (YYYY-MM)"
              value={fields.audit_month}
              onChange={(e) => setFields((f) => ({ ...f, audit_month: e.target.value }))}
              placeholder="2026-01"
            />
            <Select
              label="Grade"
              data={["Pass", "Needs Improvement", "Fail"]}
              value={fields.grade || null}
              onChange={(v) => setFields((f) => ({ ...f, grade: v ?? "" }))}
            />
          </SimpleGrid>

          {/* Criteria scores — 6 exact columns */}
          <Card withBorder radius="md" p="md">
            <Group justify="space-between" mb="sm">
              <Text size="sm" fw={700}>Criteria Scores</Text>
              <ScoreBadge
                score={typeof fields.overall_score === "number" ? fields.overall_score : null}
                grade={fields.grade}
              />
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
              {AUDIT_CRITERIA.map((criterion) => {
                const score = fields.criteria[criterion];
                return (
                  <Box key={criterion}>
                    <Group justify="space-between" mb={4}>
                      <Text size="xs" fw={500}>{criterion}</Text>
                      {score !== undefined && (
                        <Badge size="xs" color="violet" variant="light">{score}</Badge>
                      )}
                    </Group>
                    <NumberInput
                      value={score ?? ""}
                      onChange={(v) => setFields((f) => {
                        const updated = { ...f.criteria };
                        if (typeof v === "number") updated[criterion] = v;
                        else delete updated[criterion];
                        return { ...f, criteria: updated };
                      })}
                      step={1} size="xs"
                      style={{ width: "100%" }}
                      placeholder="—"
                    />
                  </Box>
                );
              })}
            </SimpleGrid>
            <Divider my="sm" />
            <Group justify="space-between" align="center">
              <Text size="sm" fw={600}>Total Score</Text>
              <NumberInput
                value={fields.overall_score}
                onChange={(v) => setFields((f) => ({ ...f, overall_score: typeof v === "number" ? v : "" }))}
                step={1} size="sm"
                style={{ width: 100 }}
                placeholder="—"
              />
            </Group>
          </Card>

          {/* Score Deductions + Dispute Panel */}
          <DeductionsPanel
            criteria={fields.criteria}
            deductions={fields.deductions}
            disputes={disputes}
            onDispute={(criterion) => setDisputeTarget(criterion)}
          />

          {/* Dispute Modal */}
          <DisputeModal
            entry={
              disputeTarget
                ? {
                    criterion: disputeTarget,
                    originalScore: fields.criteria[disputeTarget] ?? 0,
                    suggestedScore: disputes[disputeTarget]?.suggestedScore ?? "",
                    reason: disputes[disputeTarget]?.reason ?? "",
                    resolved: disputes[disputeTarget]?.resolved ?? false,
                  }
                : null
            }
            deductionReason={fields.deductions[disputeTarget ?? ""] ?? ""}
            onClose={() => setDisputeTarget(null)}
            onSubmit={handleDisputeSubmit}
          />

          {/* Feedback fields */}
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <Textarea
              label="What You Did Well"
              value={fields.what_did_well}
              onChange={(e) => setFields((f) => ({ ...f, what_did_well: e.target.value }))}
              placeholder="• Specific strengths observed..."
              minRows={4}
              autosize
            />
            <Textarea
              label="What You Missed / Could Do Better"
              value={fields.what_missed}
              onChange={(e) => setFields((f) => ({ ...f, what_missed: e.target.value }))}
              placeholder="• Areas needing improvement..."
              minRows={4}
              autosize
            />
          </SimpleGrid>

          {saveError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} radius="md">
              {saveError}
            </Alert>
          )}

          {saved ? (
            <Alert color="green" icon={<IconCheck size={16} />} radius="md">
              Audit saved successfully. Switch to the <b>Audit History</b> tab to view it.
            </Alert>
          ) : (
            <Group>
              <Button
                leftSection={<IconCheck size={16} />}
                color="violet"
                onClick={handleSave}
                loading={saving}
              >
                Save Audit
              </Button>
              <Button
                variant="subtle"
                color="gray"
                onClick={() => { setAnalyzed(false); setStreamResult(""); setFields(emptyFields()); setParsedText(""); setFileName(""); }}
              >
                Clear
              </Button>
            </Group>
          )}
        </>
      )}
    </Stack>
  );
}

// ── Audit History tab ─────────────────────────────────────────────────────────
function HistoryTab({ audits, loading, onDelete }: {
  audits: TicketAudit[];
  loading: boolean;
  onDelete: (id: number) => Promise<void>;
}) {
  const [viewing, setViewing] = useState<TicketAudit | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  async function handleDelete(id: number) {
    setDeleting(id);
    try { await onDelete(id); } finally { setDeleting(null); }
  }

  return (
    <Stack gap="md" pt="md">
      {loading && <Loader size="sm" color="violet" />}

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
                const c: Record<string, number> = JSON.parse(viewing.criteria_json);
                return (
                  <Card withBorder radius="md" p="sm">
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="xs">Criteria Scores</Text>
                    <Stack gap={6}>
                      {Object.entries(c).map(([k, v]) => (
                        <Group key={k} justify="space-between">
                          <Text size="sm">{k}</Text>
                          <Group gap={6}>
                            <Progress value={v * 10} size="sm" w={80} color={scoreColor(v * 10)} />
                            <Badge size="sm" color={scoreColor(v * 10)} variant="light" w={32}>{v}</Badge>
                          </Group>
                        </Group>
                      ))}
                    </Stack>
                  </Card>
                );
              } catch { return null; }
            })()}

            <Divider label="Audit Report" labelPosition="center" />
            <Box className="prose prose-invert max-w-none" style={{ fontSize: 13 }}>
              <ReactMarkdown>{viewing.analysis_markdown}</ReactMarkdown>
            </Box>
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
  const { audits, loading, error, refresh, deleteAudit } = useTicketAudits();
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
            <Tabs.Tab value="metrics" leftSection={<IconChartBar size={14} />}>
              Push to Metrics
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="upload">
            <UploadTab onSaved={() => { refresh(); setActiveTab("history"); }} />
          </Tabs.Panel>

          <Tabs.Panel value="bulk">
            <BulkUploadTab onSaved={refresh} />
          </Tabs.Panel>

          <Tabs.Panel value="history">
            <HistoryTab audits={audits} loading={loading} onDelete={deleteAudit} />
          </Tabs.Panel>

          <Tabs.Panel value="metrics">
            <PushToMetricsTab audits={audits} onPushed={refresh} />
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </WidgetFrame>
  );
}
