/**
 * DisputesPanel — manager review queue for metric disputes.
 *
 * Shows pending disputes at the top, then a history of approved/rejected.
 * Managers can approve (overwrites the metric) or reject (value unchanged).
 */

import { useCallback, useEffect, useState } from "react";
import {
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Image,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconCheck,
  IconClock,
  IconFile,
  IconGavel,
  IconX,
} from "@tabler/icons-react";
import { downloadBlob } from "../../lib/download";
import { type Attachment } from "./DisputeForm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Dispute {
  id: number;
  metric_id: number;
  ticket_ref: string | null;
  submitted_by: string;
  field_name: string;
  original_value: number;
  proposed_value: number;
  reason: string;
  evidence_note: string | null;
  attachments_json: string | null;
  status: string;
  reviewed_by: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface Props {
  /** Manager's canonical name for the reviewed_by field. */
  reviewerName: string;
  /** Called after an approval so the parent can refresh metrics. */
  onMetricsChanged: () => void;
  /** Whether the current user is a manager (can approve/reject). */
  isManager?: boolean;
  /** If non-manager, the current user's name (to filter to their own disputes). */
  currentUserName?: string;
}

const FIELD_LABELS: Record<string, string> = {
  ack_minutes: "Ack Time",
  carrier_ticket_minutes: "Carrier Time",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "yellow",
  approved: "green",
  rejected: "red",
};

function fmtMin(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v < 1) return `${Math.round(v * 60)}s`;
  return `${Math.round(v * 100) / 100} min`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DisputesPanel({ reviewerName, onMetricsChanged, isManager, currentUserName }: Props) {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/metric_disputes?orderBy=created_at&orderDir=desc");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Dispute[];
      setDisputes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load disputes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Non-managers only see their own disputes
  const visible = (!isManager && currentUserName)
    ? disputes.filter((d) => d.submitted_by === currentUserName)
    : disputes;

  const pending = visible.filter((d) => d.status === "pending");
  const reviewed = visible.filter((d) => d.status !== "pending");

  if (loading) {
    return (
      <Card withBorder radius="md" p="xl">
        <Group justify="center">
          <Loader size="sm" />
        </Group>
      </Card>
    );
  }

  if (error) {
    return (
      <Card withBorder radius="md" p="xl">
        <Text c="red" size="sm">{error}</Text>
      </Card>
    );
  }

  if (visible.length === 0) {
    return (
      <Card withBorder radius="md" p="xl">
        <Stack align="center" gap="sm">
          <IconGavel size={36} color="var(--mantine-color-dimmed)" />
          <Text size="sm" c="dimmed" ta="center">
            {isManager
              ? "No disputes yet. Techs can submit disputes from the Raw Data viewer when tool outages inflate their ack or carrier times."
              : "You haven't submitted any disputes yet. Open the Raw Data viewer from the Overview tab, click the ⚡ icon next to an inflated ack or carrier time, and submit a dispute."}
          </Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Stack gap="md">
      {/* Pending disputes */}
      {pending.length > 0 && (
        <Card withBorder radius="md" p="md" style={{ borderTop: "2px solid var(--mantine-color-yellow-6)" }}>
          <Stack gap="sm">
            <Group gap="sm">
              <ThemeIcon variant="light" color="yellow" radius="md" size="md">
                <IconClock size={16} />
              </ThemeIcon>
              <Title order={5}>Pending Disputes</Title>
              <Badge color="yellow" variant="filled" size="sm">
                {pending.length}
              </Badge>
            </Group>
            {pending.map((d, idx) => (
              <DisputeCard
                key={`pending-dispute-${d.id}-${idx}`}
                dispute={d}
                reviewerName={reviewerName}
                canReview={!!isManager}
                onReviewed={() => {
                  load();
                  onMetricsChanged();
                }}
              />
            ))}
          </Stack>
        </Card>
      )}

      {/* History */}
      {reviewed.length > 0 && (
        <Card withBorder radius="md" p="md">
          <Stack gap="sm">
            <Group gap="sm">
              <ThemeIcon variant="light" color="gray" radius="md" size="md">
                <IconGavel size={16} />
              </ThemeIcon>
              <Title order={5}>Dispute History</Title>
              <Badge color="gray" variant="light" size="sm">
                {reviewed.length}
              </Badge>
            </Group>
            <ScrollArea.Autosize mah={400}>
              <Stack gap="xs">
                {reviewed.map((d, idx) => (
                  <DisputeCard key={`reviewed-dispute-${d.id}-${idx}`} dispute={d} reviewerName={reviewerName} canReview={false} onReviewed={load} />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Individual dispute card
// ---------------------------------------------------------------------------

function DisputeCard({
  dispute,
  reviewerName,
  canReview,
  onReviewed,
}: {
  dispute: Dispute;
  reviewerName: string;
  canReview: boolean;
  onReviewed: () => void;
}) {
  const [reviewNote, setReviewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isPending = dispute.status === "pending";

  async function handleReview(action: "approve" | "reject") {
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/metric_disputes/${dispute.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reviewed_by: reviewerName,
          review_note: reviewNote.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      }
      onReviewed();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card
      withBorder
      radius="sm"
      p="sm"
      style={{
        borderLeft: `3px solid var(--mantine-color-${STATUS_COLORS[dispute.status] ?? "gray"}-6)`,
        background: isPending ? "var(--mantine-color-dark-7)" : undefined,
      }}
    >
      <Stack gap="xs">
        {/* Header row */}
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="wrap">
            {dispute.ticket_ref && (
              <Badge size="xs" variant="light" color="blue">
                #{dispute.ticket_ref}
              </Badge>
            )}
            <Text size="sm" fw={600}>
              {dispute.submitted_by}
            </Text>
            <Badge size="xs" variant="light" color={STATUS_COLORS[dispute.status]}>
              {dispute.status}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            {relativeTime(dispute.created_at)}
          </Text>
        </Group>

        {/* Value change */}
        <Group gap="sm" wrap="nowrap">
          <Badge size="sm" variant="outline" color="gray">
            {FIELD_LABELS[dispute.field_name] ?? dispute.field_name}
          </Badge>
          <Text size="sm" ff="monospace" c="red.4" fw={600} td="line-through">
            {fmtMin(dispute.original_value)}
          </Text>
          <Text size="sm" c="dimmed">→</Text>
          <Text size="sm" ff="monospace" c="green.4" fw={600}>
            {fmtMin(dispute.proposed_value)}
          </Text>
        </Group>

        {/* Reason */}
        <Box>
          <Text size="xs" c="dimmed" fw={600}>Reason:</Text>
          <Text size="sm">{dispute.reason}</Text>
        </Box>

        {dispute.evidence_note && (
          <Box>
            <Text size="xs" c="dimmed" fw={600}>Evidence / Notes:</Text>
            <Text size="sm">{dispute.evidence_note}</Text>
          </Box>
        )}

        {/* Attachments */}
        <AttachmentGallery attachmentsJson={dispute.attachments_json} />

        {/* Reviewed info */}
        {!isPending && dispute.reviewed_by && (
          <Box
            style={{
              background: "var(--mantine-color-dark-6)",
              borderRadius: 4,
              padding: "6px 10px",
            }}
          >
            <Text size="xs" c="dimmed">
              Reviewed by <Text component="span" fw={600}>{dispute.reviewed_by}</Text>
              {dispute.reviewed_at && ` · ${relativeTime(dispute.reviewed_at)}`}
            </Text>
            {dispute.review_note && (
              <Text size="sm" mt={2}>{dispute.review_note}</Text>
            )}
          </Box>
        )}

        {/* Action buttons (pending + manager only) */}
        {isPending && canReview && (
          <Stack gap="xs" mt="xs">
            <Textarea
              placeholder="Response to the tech (optional)"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.currentTarget.value)}
              size="xs"
              minRows={2}
              autosize
            />
            {actionError && <Text size="xs" c="red">{actionError}</Text>}
            <Group justify="flex-end" gap="xs">
              <Button
                size="xs"
                variant="light"
                color="red"
                leftSection={<IconX size={14} />}
                onClick={() => handleReview("reject")}
                loading={submitting}
              >
                Reject
              </Button>
              <Button
                size="xs"
                color="green"
                leftSection={<IconCheck size={14} />}
                onClick={() => handleReview("approve")}
                loading={submitting}
              >
                Approve & Overwrite
              </Button>
            </Group>
          </Stack>
        )}
        {isPending && !canReview && (
          <Badge size="sm" variant="light" color="yellow" mt="xs">
            Waiting for manager review
          </Badge>
        )}
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Attachment gallery — renders images as clickable thumbnails, other files
// as download links.
// ---------------------------------------------------------------------------

function AttachmentGallery({
  attachmentsJson,
}: {
  attachmentsJson: string | null;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  if (!attachmentsJson) return null;

  let attachments: Attachment[];
  try {
    attachments = JSON.parse(attachmentsJson);
  } catch {
    return null;
  }
  if (!Array.isArray(attachments) || attachments.length === 0) return null;

  function handleDownload(att: Attachment) {
    // Convert data URL back to a Blob for download
    const arr = att.dataUrl.split(",");
    const mime = arr[0]?.match(/:(.*?);/)?.[1] || att.type;
    const bstr = atob(arr[1] || "");
    const u8 = new Uint8Array(bstr.length);
    for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
    const blob = new Blob([u8], { type: mime });
    downloadBlob(blob, att.name);
  }

  const images = attachments.filter((a) => a.type.startsWith("image/"));
  const files = attachments.filter((a) => !a.type.startsWith("image/"));

  return (
    <>
      <Box>
        <Text size="xs" c="dimmed" fw={600} mb={4}>
          Attachments ({attachments.length}):
        </Text>

        {/* Image thumbnails */}
        {images.length > 0 && (
          <Group gap="xs" mb={files.length > 0 ? "xs" : 0}>
            {images.map((att, idx) => (
              <Box
                key={idx}
                style={{
                  cursor: "pointer",
                  borderRadius: 6,
                  overflow: "hidden",
                  border: "1px solid var(--mantine-color-dark-4)",
                }}
                onClick={() => setPreviewUrl(att.dataUrl)}
              >
                <Image
                  src={att.dataUrl}
                  alt={att.name}
                  w={72}
                  h={72}
                  fit="cover"
                />
              </Box>
            ))}
          </Group>
        )}

        {/* Non-image files */}
        {files.length > 0 && (
          <Stack gap={4}>
            {files.map((att, idx) => (
              <Group key={idx} gap="xs" wrap="nowrap">
                <IconFile size={14} color="var(--mantine-color-dimmed)" />
                <Anchor
                  size="xs"
                  onClick={(e) => {
                    e.preventDefault();
                    handleDownload(att);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  {att.name}
                </Anchor>
                <Text size="xs" c="dimmed">
                  ({fmtFileSize(att.size)})
                </Text>
              </Group>
            ))}
          </Stack>
        )}
      </Box>

      {/* Full-size image preview modal */}
      <Modal
        opened={previewUrl != null}
        onClose={() => setPreviewUrl(null)}
        size="xl"
        title="Attachment Preview"
        centered
      >
        {previewUrl && (
          <Image
            src={previewUrl}
            alt="Preview"
            fit="contain"
            mah="70vh"
            radius="sm"
          />
        )}
      </Modal>
    </>
  );
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
