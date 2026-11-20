/**
 * DisputeForm — modal for disputing imported KPI values or AI-generated audit feedback.
 *
 * Supports attaching screenshots and email files as evidence.
 */

import { useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Image,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconFile,
  IconPaperclip,
  IconX,
} from "@tabler/icons-react";
import { type PerformanceMetric } from "./data";

export type DisputeField = "ack_minutes" | "carrier_ticket_minutes" | "success_count" | "ai_feedback";

export interface Attachment {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

interface Props {
  metric: PerformanceMetric | null;
  field: DisputeField | null;
  submitterName: string;
  onClose: () => void;
  onSubmitted: () => void;
}

const FIELD_LABELS: Record<DisputeField, string> = {
  ack_minutes: "Acknowledgement Time (minutes)",
  carrier_ticket_minutes: "Time to Open w/ Carrier (minutes)",
  success_count: "Met SLA",
  ai_feedback: "What You Missed / Could Do Better (AI feedback)",
};

const ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "application/pdf",
  "message/rfc822",
  "application/vnd.ms-outlook",
  "text/plain",
].join(",");

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_FILES = 5;

const TASK_SLA_DELAY_OPTIONS = [
  { value: "Customer", label: "Customer" },
  { value: "Carrier", label: "Carrier" },
  { value: "MOM team", label: "MOM team" },
  { value: "Other Technician", label: "Other Technician" },
];

function fmtMin(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v < 1) return `${Math.round(v * 60)}s`;
  return `${Math.round(v * 100) / 100} min`;
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(type: string): boolean {
  return type.startsWith("image/");
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readOriginalAiFeedback(metric: PerformanceMetric | null): string {
  if (!metric) return "";
  try {
    const parsed = JSON.parse(String((metric as Record<string, unknown>).raw_json ?? "{}")) as Record<string, unknown>;
    return String(parsed.what_missed ?? parsed.what_you_missed ?? parsed.what_you_missed_could_do_better ?? "");
  } catch {
    return "";
  }
}

export function DisputeForm({
  metric,
  field: initialField,
  submitterName,
  onClose,
  onSubmitted,
}: Props) {
  const [field, setField] = useState<DisputeField | null>(initialField);
  const [proposedValue, setProposedValue] = useState<number | string>("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const raw = metric as Record<string, unknown> | null;
  const ticketRef = raw?.ref_number ? String(raw.ref_number) : undefined;
  const isTaskSlaDispute = field === "success_count";
  const isAiFeedbackDispute = field === "ai_feedback";
  const originalValue =
    field && metric && field !== "ai_feedback"
      ? ((metric as Record<string, unknown>)[field] as number | null)
      : null;
  const originalAiFeedback = readOriginalAiFeedback(metric);

  async function handleFilesSelected(files: FileList | null) {
    if (!files) return;
    setError(null);

    const newAttachments: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (attachments.length + newAttachments.length >= MAX_FILES) {
        setError(`Maximum ${MAX_FILES} files allowed.`);
        break;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(`"${file.name}" is too large (${fmtFileSize(file.size)}). Max ${fmtFileSize(MAX_FILE_SIZE)} per file.`);
        continue;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        newAttachments.push({
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          dataUrl,
        });
      } catch {
        setError(`Failed to read "${file.name}".`);
      }
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    if (!metric || !field) return;
    if (!isAiFeedbackDispute && !isTaskSlaDispute && (typeof proposedValue !== "number" || proposedValue < 0)) {
      setError("Please enter a valid proposed value.");
      return;
    }
    if (!reason.trim()) {
      setError(
        isAiFeedbackDispute
          ? "Please explain what was wrong in the AI-generated feedback."
          : "Please provide a reason for the dispute.",
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/metric_disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: {
            metric_id: metric.id,
            ticket_ref: ticketRef ?? null,
            submitted_by: submitterName,
            field_name: field,
            original_value: isAiFeedbackDispute ? 0 : (originalValue ?? 0),
            proposed_value: isAiFeedbackDispute ? 0 : (isTaskSlaDispute ? (originalValue ?? 0) : proposedValue),
            reason: reason.trim(),
            evidence_note: isAiFeedbackDispute
              ? JSON.stringify({
                  evidence_note: evidence.trim() || null,
                  ai_feedback_original: originalAiFeedback || null,
                  ai_feedback_mistake: reason.trim(),
                })
              : (evidence.trim() || null),
            attachments_json: attachments.length > 0 ? JSON.stringify(attachments) : null,
            status: "pending",
          },
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      }

      setField(null);
      setProposedValue("");
      setReason("");
      setEvidence("");
      setAttachments([]);
      onSubmitted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      opened={metric != null}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconAlertTriangle size={18} color="var(--mantine-color-yellow-5)" />
          <Text fw={600}>Dispute KPI Value</Text>
          {ticketRef && (
            <Badge size="sm" variant="light" color="blue">
              Ticket #{ticketRef}
            </Badge>
          )}
        </Group>
      }
      size="lg"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          If a tool outage, audit issue, or AI-generated feedback mistake affected your evaluation, submit a dispute with context and supporting evidence. Your manager will review and approve or reject it.
        </Text>

        <Select
          label="Field to dispute"
          data={[
            { value: "ack_minutes", label: FIELD_LABELS.ack_minutes },
            { value: "carrier_ticket_minutes", label: FIELD_LABELS.carrier_ticket_minutes },
            { value: "success_count", label: FIELD_LABELS.success_count },
            { value: "ai_feedback", label: FIELD_LABELS.ai_feedback },
          ]}
          value={field}
          onChange={(v) => setField(v as DisputeField)}
          allowDeselect={false}
          size="sm"
        />

        {field && (
          isTaskSlaDispute ? (
            <Select
              label="Delay caused by"
              placeholder="Select a delay category"
              data={TASK_SLA_DELAY_OPTIONS}
              value={reason}
              onChange={(v) => setReason(v ?? "")}
              allowDeselect={false}
              size="sm"
            />
          ) : isAiFeedbackDispute ? (
            <Stack gap="sm">
              <Card withBorder radius="md" p="sm">
                <Stack gap={4}>
                  <Text size="xs" c="dimmed">Original AI-generated feedback</Text>
                  <Text size="sm">{originalAiFeedback || "—"}</Text>
                </Stack>
              </Card>
              <Textarea
                label="What was the mistake in AI-generated feedback?"
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
                minRows={4}
                autosize
                placeholder="Explain what was incorrect, misleading, incomplete, or unfair in the AI-generated feedback."
                withAsterisk
              />
            </Stack>
          ) : (
            <Group gap="lg">
              <div>
                <Text size="xs" c="dimmed">Current value</Text>
                <Text fw={700} c="red.4" ff="monospace" size="lg">
                  {fmtMin(originalValue)}
                </Text>
              </div>
              <Text c="dimmed" size="lg">→</Text>
              <NumberInput
                label="Proposed value (minutes)"
                value={proposedValue}
                onChange={setProposedValue}
                min={0}
                step={0.5}
                decimalScale={2}
                size="sm"
                style={{ flex: 1 }}
                placeholder="e.g. 2.5"
              />
            </Group>
          )
        )}

        {!isAiFeedbackDispute && (
          <Textarea
            label="Reason"
            placeholder="e.g. iPath was down for maintenance from 9:00 AM to 11:15 AM on 3/15. I had the ticket ready but couldn't update until the tool came back online."
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            minRows={3}
            autosize
            size="sm"
            withAsterisk
          />
        )}

        <TextInput
          label={isAiFeedbackDispute ? "Supporting context (optional)" : "Evidence / Notes"}
          placeholder={isAiFeedbackDispute ? "Add any extra context, examples, or clarifications." : "Slack thread link, incident reference, etc."}
          value={evidence}
          onChange={(e) => setEvidence(e.currentTarget.value)}
          size="sm"
        />

        <Box>
          <Group gap="xs" mb={6}>
            <Text size="sm" fw={500}>Attachments</Text>
            <Text size="xs" c="dimmed">
              Screenshots, emails, PDFs — up to {MAX_FILES} files, {fmtFileSize(MAX_FILE_SIZE)} each
            </Text>
          </Group>

          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            accept={ACCEPTED_TYPES}
            multiple
            onChange={(e) => handleFilesSelected(e.target.files)}
          />

          {attachments.length > 0 && (
            <Stack gap={6} mb="sm">
              {attachments.map((att, idx) => (
                <Card key={idx} withBorder radius="sm" p="xs">
                  <Group gap="sm" wrap="nowrap">
                    {isImage(att.type) ? (
                      <Image src={att.dataUrl} alt={att.name} w={48} h={48} fit="cover" radius="sm" style={{ flexShrink: 0 }} />
                    ) : (
                      <Box
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 4,
                          background: "var(--mantine-color-dark-5)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <IconFile size={20} color="var(--mantine-color-dimmed)" />
                      </Box>
                    )}
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={500} truncate>{att.name}</Text>
                      <Text size="xs" c="dimmed">{fmtFileSize(att.size)}</Text>
                    </Box>
                    <Tooltip label="Remove">
                      <ActionIcon size="sm" variant="subtle" color="red" onClick={() => removeAttachment(idx)}>
                        <IconX size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Card>
              ))}
            </Stack>
          )}

          <Button
            variant="light"
            color="gray"
            size="xs"
            leftSection={<IconPaperclip size={14} />}
            onClick={() => fileInputRef.current?.click()}
            disabled={attachments.length >= MAX_FILES}
          >
            {attachments.length > 0 ? `Add more files (${attachments.length}/${MAX_FILES})` : "Attach screenshot or email"}
          </Button>
        </Box>

        {error && <Text size="sm" c="red">{error}</Text>}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button
            color="yellow"
            onClick={handleSubmit}
            loading={submitting}
            disabled={
              !field ||
              (!isAiFeedbackDispute && !isTaskSlaDispute && typeof proposedValue !== "number") ||
              !reason.trim()
            }
          >
            Submit Dispute
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
