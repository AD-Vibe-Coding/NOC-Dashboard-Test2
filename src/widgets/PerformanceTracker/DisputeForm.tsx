/**
 * DisputeForm — modal for a tech to dispute an ack_minutes or
 * carrier_ticket_minutes value on a specific ticket row.
 *
 * Opened from the Raw Data modal when clicking the ⚡ icon on an outlier.
 */

import { useState } from "react";
import {
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { type PerformanceMetric } from "./data";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DisputeField = "ack_minutes" | "carrier_ticket_minutes";

interface Props {
  /** The metric row being disputed, or null to close the modal. */
  metric: PerformanceMetric | null;
  /** Pre-selected field to dispute. */
  field: DisputeField | null;
  /** The logged-in user's canonical name. */
  submitterName: string;
  onClose: () => void;
  /** Called after a successful submission. */
  onSubmitted: () => void;
}

const FIELD_LABELS: Record<DisputeField, string> = {
  ack_minutes: "Acknowledgement Time (minutes)",
  carrier_ticket_minutes: "Time to Open w/ Carrier (minutes)",
};

function fmtMin(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v < 1) return `${Math.round(v * 60)}s`;
  return `${Math.round(v * 100) / 100} min`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when a new metric opens
  const raw = metric as Record<string, unknown> | null;
  const ticketRef = raw?.ref_number ? String(raw.ref_number) : undefined;
  const originalValue = field && metric ? (metric as Record<string, unknown>)[field] as number | null : null;

  async function handleSubmit() {
    if (!metric || !field) return;
    if (typeof proposedValue !== "number" || proposedValue < 0) {
      setError("Please enter a valid proposed value.");
      return;
    }
    if (!reason.trim()) {
      setError("Please provide a reason for the dispute.");
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
            original_value: originalValue ?? 0,
            proposed_value: proposedValue,
            reason: reason.trim(),
            evidence_note: evidence.trim() || null,
            status: "pending",
          },
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      }

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
      size="md"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          If a tool outage or maintenance window inflated your numbers, submit a
          dispute with the correct value. Your manager will review and approve or
          reject it.
        </Text>

        <Select
          label="Field to dispute"
          data={[
            { value: "ack_minutes", label: FIELD_LABELS.ack_minutes },
            {
              value: "carrier_ticket_minutes",
              label: FIELD_LABELS.carrier_ticket_minutes,
            },
          ]}
          value={field}
          onChange={(v) => setField(v as DisputeField)}
          allowDeselect={false}
          size="sm"
        />

        {field && (
          <Group gap="lg">
            <div>
              <Text size="xs" c="dimmed">
                Current value
              </Text>
              <Text fw={700} c="red.4" ff="monospace" size="lg">
                {fmtMin(originalValue)}
              </Text>
            </div>
            <Text c="dimmed" size="lg">
              →
            </Text>
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
        )}

        <Textarea
          label="Reason"
          placeholder="e.g. iPath was down for maintenance from 9:00 AM to 11:15 AM on 3/15. I had the ticket ready but couldn't update until the tool came back online."
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          minRows={3}
          autosize
          size="sm"
          required
        />

        <TextInput
          label="Evidence (optional)"
          placeholder="Slack thread link, screenshot reference, etc."
          value={evidence}
          onChange={(e) => setEvidence(e.currentTarget.value)}
          size="sm"
        />

        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            color="yellow"
            onClick={handleSubmit}
            loading={submitting}
            disabled={!field || typeof proposedValue !== "number"}
          >
            Submit Dispute
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
