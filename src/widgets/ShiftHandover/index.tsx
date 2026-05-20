import { useMemo, useState } from "react";
import {
  ActionIcon,
  Accordion,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { DateInput, DateTimePicker } from "@mantine/dates";
import {
  IconAlertCircle,
  IconCheck,
  IconClipboard,
  IconClipboardText,
  IconCopy,
  IconHistory,
  IconPlayerStop,
  IconPlus,
  IconRefresh,
  IconSparkles,
  IconTicket,
  IconTrash,
  IconX,
} from "@tabler/icons-react";

import ReactMarkdown from "react-markdown";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { useCompletion } from "../../lib/devs-ai/use-completion";
import { useIdentity } from "../../lib/identity";
import { formatDateTime } from "../../lib/format";
import { WidgetFrame } from "../WidgetFrame";
import { useShiftHandovers, type ShiftHandover } from "./data";

export { ShiftHandoverTile } from "./Tile";

// ===========================================================================
// Shift Handover widget
//
// Converts the technician's raw end-of-shift ticket notes into the structured
// handover template the NOC uses to brief the next shift. The exact template
// (sections, headers, per-ticket fields) is baked into PROMPT_TEMPLATE so the
// output is consistent every time and lines up with what the team already
// posts to the shift-handover Slack thread.
// ===========================================================================

const PROMPT_TEMPLATE = `You are a senior NOC technician at AppDirect drafting an end-of-shift handover message for the next shift. Convert the raw notes into the EXACT structured handover template below.

OUTPUT FORMAT (strict — follow exactly, in this order):

\`\`\`
Hello Team,

Subject: Shift Handover: <SHIFT NAME> | <MM/DD> |

## 1. High-Priority Incidents (P1/P2)

(One block per high-priority ticket — only include tickets that are clearly P1, P2, or otherwise high-impact. Skip routine low-priority tickets.)

**Ticket #<NUMBER>**: <Brief one-line description of the issue>
- **Status**: <Carrier investigating / Outage ongoing / Pending dispatch ETA / Customer testing / etc.>
- **Current Action**: <What's being done right now, e.g. "Awaiting field tech ETA at 08:00 PST">
- **Next Plan of action**: <What the next shift should do next, e.g. "Follow up with Lumen for dispatch status">
- **Due Date**: <Date/time the next action is needed, e.g. "05/16/2026 08:10 AM">
- **Assigned to**: <Name from notes, or the configured next-owner, or "[Next Owner]" if unknown>
- **Add the next owner to all related email threads**: <Yes/No per the configured global flag, or AI-judged from notes if "Per-ticket">
- **Ticket Summary added to ticket**: <Yes/No per the configured global flag, or AI-judged from notes if "Per-ticket">

(Repeat block per ticket. If no high-priority tickets in the notes, write "No P1/P2 incidents this shift." and omit nothing else.)

## 2. Upcoming Bridge Calls

(Include this section ONLY if notes mention a scheduled bridge / con-call. Omit the section header entirely if there are none.)

**Ticket #<NUMBER>**:
- **Scheduled**: <Time>
- **Purpose**: <e.g. "Troubleshooting for packet loss issue">
- **Bridge Invite**: <URL if present in notes, else "[Insert Link Here]">
- **Assigned to**: <Name>
- **Add the next owner to all related email threads and Bridge Invite**: <Yes/No>
- **Ticket Summary added to ticket**: <Yes/No>

## 3. Active Service

(Include this section ONLY if the handoff style is "active" OR the AI detects from notes that the technician was on Active Service this shift. Mutually exclusive with section 4 — never render both.)

<1-3 sentences describing pending Active Service items, e.g.: "There are 3 pending maintenance notification emails in the Active Service mailbox. Reason: extended Lumen escalation handling on 574995 consumed the last 90 min of the shift.">

## 4. Rolling Handoff

(Include this section ONLY if handoff style is "rolling" OR notes suggest a rolling-handoff context. Mutually exclusive with section 3.)

<1-3 sentences describing rolling-handoff tickets, e.g.: "3 tickets require immediate follow-up: 654617 (Lumen dispatch ETA pending), 654604 (BGP flap monitoring), 574995 (splice repair in progress).">

---

Thanks,
<SENDER NAME or "[Name]" placeholder>
NOC Technician
\`\`\`

RULES:
1. Start the very first line with literally "Hello Team," then a blank line, then "Subject: ...".
2. Subject MUST be exactly: \`Subject: Shift Handover: <Shift Name> | <MM/DD> |\` (with trailing pipe and space).
3. Use markdown section headers (## 1., ## 2., ...) as shown.
4. Use bold (**) for every field label on the per-ticket lines.
5. The two flag-fields ("Add the next owner...", "Ticket Summary added...") use these rules:
   - If the user configured "owner_in_threads" = "Yes", every ticket's line reads "Yes".
   - If "No", every ticket's line reads "No".
   - If "Per-ticket" (or unset), AI infers Yes/No per ticket from context. Default to "No — please add" if uncertain.
   - Same logic applies to "summary_in_ticket".
6. Section 3 (Active Service) and section 4 (Rolling Handoff) are MUTUALLY EXCLUSIVE. Pick one based on the configured handoff_style or what the notes describe. Never render both.
7. Section 2 (Bridge Calls) is OMITTED ENTIRELY (no header) if no bridge calls are in the notes.
8. P1/P2 detection: only include tickets in section 1 that are clearly P1, P2, or high-impact based on notes. Don't pad with low-priority tickets.
9. Date format: MM/DD/YYYY HH:MM AM/PM for the per-ticket Due Date.
10. Sign with the provided sender name; if none, leave "[Name]" as a placeholder.
11. Do not wrap the whole output in a code block. Output as markdown directly.
12. Do not include any preamble like "Here is the handover:" — start directly with "Hello Team,".`;

const SHIFT_OPTIONS = [
  { value: "auto", label: "Auto-detect from current time" },
  { value: "Early Shift", label: "Early Shift (2–6 AM PST)" },
  { value: "Morning Shift", label: "Morning Shift (8 AM PST)" },
  { value: "Mid-Morning Shift", label: "Mid-Morning Shift (10–11 AM PST)" },
  { value: "Night Shift", label: "Night Shift (after 6 PM PST)" },
];

const STYLE_OPTIONS = [
  { value: "auto", label: "Auto — infer from notes" },
  { value: "active", label: "Active Service (handling everything)" },
  { value: "rolling", label: "Rolling Handoff (passing tickets along)" },
];

const FLAG_OPTIONS = [
  { value: "PerTicket", label: "Per-ticket (AI decides)" },
  { value: "Yes", label: "Yes — all tickets" },
  { value: "No", label: "No — all tickets" },
];

const PRIORITY_OPTIONS = [
  { value: "P1", label: "P1 — Critical" },
  { value: "P2", label: "P2 — High" },
  { value: "P3", label: "P3 — Medium" },
];

// Per-ticket override flag values — these take precedence over the shift-wide
// `owner_in_threads` / `summary_in_ticket` defaults.
const TICKET_FLAG_OPTIONS = [
  { value: "", label: "Use shift default" },
  { value: "Yes", label: "Yes" },
  { value: "No", label: "No" },
];

interface TicketEntry {
  /** Local React key — not persisted to DB. */
  id: string;
  ticket_number: string;
  priority: "P1" | "P2" | "P3" | "";
  description: string;
  status: string;
  current_action: string;
  next_plan: string;
  /** ISO datetime string or empty. Stored verbatim. */
  due_date: string;
  assigned_to: string;
  /** Per-ticket override. "" means inherit shift-wide owner_in_threads. */
  owner_in_threads: "Yes" | "No" | "";
  /** Per-ticket override. "" means inherit shift-wide summary_in_ticket. */
  summary_in_ticket: "Yes" | "No" | "";
}

function emptyTicket(): TicketEntry {
  return {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ticket_number: "",
    priority: "P2",
    description: "",
    status: "",
    current_action: "",
    next_plan: "",
    due_date: "",
    assigned_to: "",
    owner_in_threads: "",
    summary_in_ticket: "",
  };
}

function formatDueDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${mm}/${dd}/${yyyy} ${String(h).padStart(2, "0")}:${min} ${ampm}`;
}

type Toast = {
  id: number;
  color: "green" | "red" | "blue";
  title: string;
  body?: string;
};

function detectShiftFromTime(): string {
  // Time in PST (America/Los_Angeles). The shifts table on file:
  //   Early Shift: 2 AM – 6 AM
  //   Morning Shift: 8 AM (~ 8 AM – 11 AM)
  //   Mid-Morning Shift: 10–11 AM (~ 11 AM – 6 PM)
  //   Night Shift: after 6 PM
  const pstHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
    10,
  );
  if (pstHour >= 2 && pstHour < 7) return "Early Shift";
  if (pstHour >= 7 && pstHour < 10) return "Morning Shift";
  if (pstHour >= 10 && pstHour < 18) return "Mid-Morning Shift";
  return "Night Shift";
}

function splitSubjectBody(text: string): { subject: string; body: string } {
  // The output starts with "Hello Team," then a blank line then "Subject: ..."
  // We display "Hello Team," + everything as body, and lift just the subject
  // into the separate Subject field for the Copy-Subject button.
  const m = /^\s*subject\s*[:\-—]\s*(.*)$/im.exec(text);
  const subject = m ? m[1].trim() : "";
  return { subject, body: text.trim() };
}

function markdownToPlainText(md: string): string {
  return md
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "  • ")
    .replace(/^---+$/gm, "")
    .replace(/`([^`]+)`/g, "$1");
}

function formatMMDD(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}

export function ShiftHandoverWidget() {
  const { handovers, refresh } = useShiftHandovers();
  const { identity } = useIdentity();

  const [shiftName, setShiftName] = useState<string>("auto");
  const [shiftDate, setShiftDate] = useState<Date | null>(new Date());
  const [handoffStyle, setHandoffStyle] = useState<string>("auto");
  const [nextOwner, setNextOwner] = useState("");
  const [ownerInThreads, setOwnerInThreads] = useState<string>("PerTicket");
  const [summaryInTicket, setSummaryInTicket] = useState<string>("PerTicket");
  const [notes, setNotes] = useState("");
  const [tickets, setTickets] = useState<TicketEntry[]>([]);

  const [viewing, setViewing] = useState<ShiftHandover | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const { complete, result, isLoading, error, abort, setResult } = useCompletion();

  const senderName = identity?.name ?? "";

  function showToast(t: Omit<Toast, "id">) {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 3500);
  }

  function copy(text: string, label: string, key: string) {
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(key);
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
        showToast({ color: "green", title: `${label} copied` });
      })
      .catch(() =>
        showToast({
          color: "red",
          title: "Copy failed",
          body: "Browser blocked clipboard access.",
        }),
      );
  }

  const effectiveShift = useMemo(
    () => (shiftName === "auto" ? detectShiftFromTime() : shiftName),
    [shiftName],
  );

  function addTicket() {
    setTickets((prev) => [...prev, emptyTicket()]);
  }
  function removeTicket(id: string) {
    setTickets((prev) => prev.filter((t) => t.id !== id));
  }
  function updateTicket<K extends keyof TicketEntry>(
    id: string,
    field: K,
    value: TicketEntry[K],
  ) {
    setTickets((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)),
    );
  }

  async function runDraft() {
    if (!notes.trim() && tickets.length === 0) {
      showToast({
        color: "red",
        title: "Add at least one ticket or paste shift notes",
      });
      return;
    }
    setViewing(null);

    const dateForPrompt = shiftDate ?? new Date();
    const structured: string[] = [];
    structured.push(`Shift Name: ${effectiveShift}`);
    structured.push(`Date (MM/DD): ${formatMMDD(dateForPrompt)}`);
    structured.push(
      `Date (full): ${dateForPrompt.toLocaleDateString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
      })}`,
    );
    if (handoffStyle !== "auto") {
      structured.push(
        `Handoff style: ${handoffStyle === "active" ? "Active Service (render section 3, omit section 4)" : "Rolling Handoff (render section 4, omit section 3)"}`,
      );
    } else {
      structured.push(
        `Handoff style: AUTO — pick section 3 or 4 based on notes (never both).`,
      );
    }
    if (nextOwner.trim()) structured.push(`Default next owner name: ${nextOwner.trim()}`);
    structured.push(
      `Flag — Add owner to email threads (shift-wide default): ${ownerInThreads === "PerTicket" ? "Per-ticket (AI decides per ticket unless per-ticket override is set)" : ownerInThreads}`,
    );
    structured.push(
      `Flag — Ticket Summary added to ticket (shift-wide default): ${summaryInTicket === "PerTicket" ? "Per-ticket (AI decides per ticket unless per-ticket override is set)" : summaryInTicket}`,
    );
    if (senderName) structured.push(`Sender name (signature): ${senderName}`);

    // Build the structured tickets block. The AI is told to use these
    // EXACTLY in section 1 and not to invent additional tickets.
    let ticketsBlock = "";
    if (tickets.length > 0) {
      const lines: string[] = [];
      lines.push(
        `Structured ticket entries (USE THESE EXACTLY for section 1 — do NOT invent additional tickets; use raw notes for sections 2-4 only):`,
      );
      tickets.forEach((t, i) => {
        lines.push(`TICKET ${i + 1}:`);
        if (t.ticket_number) lines.push(`- Number: ${t.ticket_number}`);
        if (t.priority) lines.push(`- Priority: ${t.priority}`);
        if (t.description) lines.push(`- Description: ${t.description}`);
        if (t.status) lines.push(`- Status: ${t.status}`);
        if (t.current_action) lines.push(`- Current Action: ${t.current_action}`);
        if (t.next_plan) lines.push(`- Next Plan: ${t.next_plan}`);
        if (t.due_date) lines.push(`- Due Date: ${formatDueDate(t.due_date)}`);
        if (t.assigned_to) lines.push(`- Assigned to: ${t.assigned_to}`);
        if (t.owner_in_threads)
          lines.push(`- Add owner to threads (per-ticket override): ${t.owner_in_threads}`);
        if (t.summary_in_ticket)
          lines.push(`- Ticket summary added (per-ticket override): ${t.summary_in_ticket}`);
      });
      ticketsBlock = `\n\n${lines.join("\n")}\n`;
    }

    const notesBlock = notes.trim()
      ? `\n---\nTECHNICIAN'S RAW SHIFT NOTES (use for sections 2-4, and as additional context for section 1):\n${notes.trim()}\n---`
      : "";

    const prompt = `${PROMPT_TEMPLATE}

Configured details:
${structured.map((s) => `- ${s}`).join("\n")}
${ticketsBlock}${notesBlock}

Now produce the handover.`;

    const text = await complete(prompt);
    if (text && text.trim().length > 0) {
      const { subject, body } = splitSubjectBody(text);
      const ticketCount =
        tickets.length > 0
          ? tickets.length
          : (body.match(/\*\*Ticket #/g) || []).length;
      await db.insert(schema.shift_handovers).values({
        shift_name: effectiveShift,
        shift_date: dateForPrompt.toISOString().slice(0, 10),
        handoff_style: handoffStyle || null,
        next_owner: nextOwner.trim() || null,
        sender_name: senderName || null,
        owner_in_threads: ownerInThreads,
        summary_in_ticket: summaryInTicket,
        raw_notes: notes.trim(),
        tickets_json: tickets.length > 0 ? JSON.stringify(tickets) : null,
        subject: subject || null,
        body_markdown: body,
        ticket_count: ticketCount,
      });
      refresh();
    }
  }

  function reset() {
    setShiftName("auto");
    setShiftDate(new Date());
    setHandoffStyle("auto");
    setNextOwner("");
    setOwnerInThreads("PerTicket");
    setSummaryInTicket("PerTicket");
    setNotes("");
    setTickets([]);
    setResult("");
    setViewing(null);
  }

  async function deleteHandover(id: number) {
    await db.delete(schema.shift_handovers).where(eq(schema.shift_handovers.id, id));
    if (viewing?.id === id) setViewing(null);
    refresh();
  }

  function loadHandover(h: ShiftHandover) {
    setViewing(h);
    setNotes(h.raw_notes ?? "");
    setShiftName(h.shift_name ?? "auto");
    if (h.shift_date) setShiftDate(new Date(h.shift_date));
    setHandoffStyle(h.handoff_style ?? "auto");
    setNextOwner(h.next_owner ?? "");
    setOwnerInThreads(h.owner_in_threads ?? "PerTicket");
    setSummaryInTicket(h.summary_in_ticket ?? "PerTicket");
    // Restore the structured ticket entries if any
    if (h.tickets_json) {
      try {
        const parsed = JSON.parse(h.tickets_json) as TicketEntry[];
        if (Array.isArray(parsed)) setTickets(parsed);
      } catch {
        setTickets([]);
      }
    } else {
      setTickets([]);
    }
    setResult("");
  }

  // Display either the saved draft we're "viewing" or the streaming AI result
  const displayed = useMemo(() => {
    if (viewing) {
      return { subject: viewing.subject ?? "", body: viewing.body_markdown ?? "" };
    }
    if (result) {
      return splitSubjectBody(result);
    }
    return { subject: "", body: "" };
  }, [viewing, result]);

  const fullCopy = displayed.subject
    ? `Subject: ${displayed.subject}\n\n${markdownToPlainText(displayed.body)}`
    : markdownToPlainText(displayed.body);

  return (
    <WidgetFrame
      title="Shift Handover"
      subtitle="Paste shift notes → structured handover for the next team"
      icon={IconClipboardText}
      iconColor="blue"
      loading={isLoading}
      status={{
        label: "AI",
        color: "blue",
        tooltip: "Devs.ai server-side completion",
      }}
      headerActions={
        (notes || result || viewing) && (
          <Tooltip label="Clear inputs and start fresh">
            <ActionIcon variant="subtle" size="md" onClick={reset} aria-label="Reset">
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        )
      }
    >
      {/* Toast stack */}
      <Box
        style={{
          position: "fixed",
          top: 76,
          right: 16,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 360,
        }}
      >
        {toasts.map((t) => (
          <Alert
            key={t.id}
            color={t.color}
            icon={
              t.color === "red" ? <IconAlertCircle size={16} /> : <IconSparkles size={16} />
            }
            title={t.title}
            variant="filled"
            radius="md"
            withCloseButton
            onClose={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            styles={{ root: { boxShadow: "0 8px 24px rgba(0,0,0,0.3)" } }}
          >
            {t.body}
          </Alert>
        ))}
      </Box>

      <Grid gutter="lg">
        {/* ---------- LEFT: form ---------- */}
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack gap="md">
            <Card radius="md" withBorder p="md">
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Text fw={600} size="sm">
                    Shift details
                  </Text>
                  <Badge size="xs" variant="light" color="blue">
                    {effectiveShift}
                  </Badge>
                </Group>
                <Select
                  label="Shift"
                  data={SHIFT_OPTIONS}
                  value={shiftName}
                  onChange={(v) => setShiftName(v ?? "auto")}
                  size="xs"
                  allowDeselect={false}
                />
                <DateInput
                  label="Date"
                  value={shiftDate}
                  onChange={(d) => setShiftDate(d as Date | null)}
                  valueFormat="ddd, MMM D YYYY"
                  size="xs"
                  clearable={false}
                />
                <Select
                  label="Handoff style"
                  data={STYLE_OPTIONS}
                  value={handoffStyle}
                  onChange={(v) => setHandoffStyle(v ?? "auto")}
                  size="xs"
                  allowDeselect={false}
                />
              </Stack>
            </Card>

            <Card radius="md" withBorder p="md">
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Text fw={600} size="sm">
                    Shift notes (free-form)
                  </Text>
                  <Badge size="xs" variant="light" color="gray">
                    optional · feeds bridge calls + active service sections
                  </Badge>
                </Group>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.currentTarget.value)}
                  placeholder={`Paste any context that ISN'T captured in the structured ticket entries above — bridge call info, pending Active Service emails, rolling-handoff notes, etc.

Example:
- bridge call at 7am PST for 574995 to confirm Lumen splice ETA
- 2 pending maint emails in Active Service mailbox, couldn't get to them — extended Lumen handling burned the last hour`}
                  autosize
                  minRows={7}
                  maxRows={16}
                  styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
                />
                <Group gap={4} align="center">
                  <Badge size="xs" variant="light" color="gray">
                    {notes.length.toLocaleString()} chars
                  </Badge>
                </Group>
              </Stack>
            </Card>

            <Card radius="md" withBorder p="md">
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Group gap={6}>
                    <IconTicket size={14} />
                    <Text fw={600} size="sm">
                      P1 / P2 ticket entries
                    </Text>
                    {tickets.length > 0 && (
                      <Badge size="xs" variant="default">
                        {tickets.length}
                      </Badge>
                    )}
                  </Group>
                  <Button
                    leftSection={<IconPlus size={12} />}
                    size="compact-xs"
                    variant="light"
                    onClick={addTicket}
                  >
                    Add ticket
                  </Button>
                </Group>

                {tickets.length === 0 ? (
                  <Text size="xs" c="dimmed" fs="italic">
                    Click <b>+ Add ticket</b> to fill in ticket #, status, due
                    date, assignee, etc. for each P1/P2 ticket. These get
                    rendered verbatim into section 1 of the handover.
                  </Text>
                ) : (
                  <Accordion
                    variant="separated"
                    radius="sm"
                    styles={{
                      control: { padding: "6px 10px" },
                      item: {
                        backgroundColor: "var(--mantine-color-dark-7)",
                        border: "1px solid var(--mantine-color-dark-4)",
                      },
                      content: { padding: "6px 10px 10px" },
                    }}
                  >
                    {tickets.map((t, idx) => (
                      <Accordion.Item key={t.id} value={t.id}>
                        <Box style={{ position: "relative" }}>
                          <Accordion.Control>
                            <Group gap={6} wrap="nowrap">
                              <Text size="xs" c="dimmed" w={18}>
                                #{idx + 1}
                              </Text>
                              <Badge
                                size="xs"
                                variant="light"
                                color={
                                  t.priority === "P1"
                                    ? "red"
                                    : t.priority === "P2"
                                      ? "orange"
                                      : "yellow"
                                }
                              >
                                {t.priority || "—"}
                              </Badge>
                              <Text size="xs" fw={600} truncate>
                                {t.ticket_number ? `#${t.ticket_number}` : "(no number)"}
                                {t.description ? ` — ${t.description}` : ""}
                              </Text>
                              {t.assigned_to && (
                                <Text size="xs" c="dimmed" truncate>
                                  · {t.assigned_to}
                                </Text>
                              )}
                            </Group>
                          </Accordion.Control>
                          <Tooltip label="Remove ticket">
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeTicket(t.id);
                              }}
                              aria-label="Remove ticket"
                              style={{
                                position: "absolute",
                                right: 36,
                                top: 8,
                                zIndex: 2,
                              }}
                            >
                              <IconX size={12} />
                            </ActionIcon>
                          </Tooltip>
                        </Box>
                        <Accordion.Panel>
                          <Stack gap={6}>
                            <Group gap={6} grow>
                              <TextInput
                                label="Ticket #"
                                placeholder="574995"
                                size="xs"
                                value={t.ticket_number}
                                onChange={(e) =>
                                  updateTicket(t.id, "ticket_number", e.currentTarget.value)
                                }
                              />
                              <Select
                                label="Priority"
                                data={PRIORITY_OPTIONS}
                                value={t.priority || null}
                                onChange={(v) =>
                                  updateTicket(t.id, "priority", (v ?? "") as TicketEntry["priority"])
                                }
                                size="xs"
                                allowDeselect={false}
                              />
                            </Group>
                            <TextInput
                              label="Brief description"
                              placeholder="Lumen DIA circuit down at Tamarac FL"
                              size="xs"
                              value={t.description}
                              onChange={(e) =>
                                updateTicket(t.id, "description", e.currentTarget.value)
                              }
                            />
                            <TextInput
                              label="Status"
                              placeholder="Carrier investigating / Outage ongoing / Pending dispatch ETA"
                              size="xs"
                              value={t.status}
                              onChange={(e) =>
                                updateTicket(t.id, "status", e.currentTarget.value)
                              }
                            />
                            <TextInput
                              label="Current Action"
                              placeholder="Awaiting field tech ETA at 08:00 PST"
                              size="xs"
                              value={t.current_action}
                              onChange={(e) =>
                                updateTicket(t.id, "current_action", e.currentTarget.value)
                              }
                            />
                            <Textarea
                              label="Next Plan of action"
                              placeholder="Follow up with carrier for dispatch status"
                              size="xs"
                              value={t.next_plan}
                              onChange={(e) =>
                                updateTicket(t.id, "next_plan", e.currentTarget.value)
                              }
                              autosize
                              minRows={1}
                              maxRows={4}
                            />
                            <Group gap={6} grow>
                              <DateTimePicker
                                label="Due Date"
                                placeholder="MM/DD/YYYY HH:MM AM/PM"
                                size="xs"
                                value={t.due_date ? new Date(t.due_date) : null}
                                onChange={(d) =>
                                  updateTicket(
                                    t.id,
                                    "due_date",
                                    d ? new Date(d as any).toISOString() : "",
                                  )
                                }
                                valueFormat="MM/DD/YYYY hh:mm A"
                                clearable
                              />
                              <TextInput
                                label="Assigned to"
                                placeholder="Karthik Damagalla"
                                size="xs"
                                value={t.assigned_to}
                                onChange={(e) =>
                                  updateTicket(t.id, "assigned_to", e.currentTarget.value)
                                }
                              />
                            </Group>
                            <Group gap={6} grow>
                              <Select
                                label="Add owner to email threads?"
                                data={TICKET_FLAG_OPTIONS}
                                value={t.owner_in_threads || ""}
                                onChange={(v) =>
                                  updateTicket(
                                    t.id,
                                    "owner_in_threads",
                                    (v ?? "") as TicketEntry["owner_in_threads"],
                                  )
                                }
                                size="xs"
                                allowDeselect={false}
                              />
                              <Select
                                label="Ticket summary added?"
                                data={TICKET_FLAG_OPTIONS}
                                value={t.summary_in_ticket || ""}
                                onChange={(v) =>
                                  updateTicket(
                                    t.id,
                                    "summary_in_ticket",
                                    (v ?? "") as TicketEntry["summary_in_ticket"],
                                  )
                                }
                                size="xs"
                                allowDeselect={false}
                              />
                            </Group>
                          </Stack>
                        </Accordion.Panel>
                      </Accordion.Item>
                    ))}
                  </Accordion>
                )}

                {tickets.length > 0 && (
                  <Button
                    leftSection={<IconPlus size={12} />}
                    size="compact-xs"
                    variant="subtle"
                    onClick={addTicket}
                  >
                    Add another ticket
                  </Button>
                )}
              </Stack>
            </Card>

            <Card radius="md" withBorder p="md">
              <Stack gap="sm">
                <Text fw={600} size="sm">
                  Optional details
                </Text>
                <TextInput
                  label="Next owner (default name for tickets)"
                  placeholder="e.g. Samiti Mahalakshmi (leave blank for [Next Owner])"
                  size="xs"
                  value={nextOwner}
                  onChange={(e) => setNextOwner(e.currentTarget.value)}
                />
                <Select
                  label="Add owner to email threads?"
                  data={FLAG_OPTIONS}
                  value={ownerInThreads}
                  onChange={(v) => setOwnerInThreads(v ?? "PerTicket")}
                  size="xs"
                  allowDeselect={false}
                />
                <Select
                  label="Ticket summary added to ticket?"
                  data={FLAG_OPTIONS}
                  value={summaryInTicket}
                  onChange={(v) => setSummaryInTicket(v ?? "PerTicket")}
                  size="xs"
                  allowDeselect={false}
                />
              </Stack>
            </Card>

            <Group justify="flex-end">
              {isLoading ? (
                <Button
                  leftSection={<IconPlayerStop size={14} />}
                  variant="default"
                  size="sm"
                  onClick={() => abort()}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  leftSection={<IconSparkles size={14} />}
                  size="sm"
                  onClick={runDraft}
                  disabled={!notes.trim() && tickets.length === 0}
                >
                  Generate handoff
                </Button>
              )}
            </Group>
          </Stack>
        </Grid.Col>

        {/* ---------- RIGHT: output + history ---------- */}
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack gap="md">
            {/* Output card */}
            <Card radius="md" withBorder p={0}>
              <Box
                px="md"
                py="xs"
                style={{
                  background:
                    "linear-gradient(180deg, var(--mantine-color-blue-9) 0%, var(--mantine-color-dark-7) 100%)",
                  borderBottom: "1px solid var(--mantine-color-dark-4)",
                  borderTopLeftRadius: 12,
                  borderTopRightRadius: 12,
                }}
              >
                <Group justify="space-between" wrap="nowrap">
                  <Group gap="xs">
                    <IconClipboardText size={14} color="white" />
                    <Text fw={600} size="xs" c="white">
                      Handover
                    </Text>
                    {viewing && (
                      <Badge size="xs" variant="filled" color="dark">
                        from history · {formatDateTime(viewing.created_at)}
                      </Badge>
                    )}
                    {isLoading && !viewing && (
                      <Badge
                        size="xs"
                        variant="filled"
                        color="dark"
                        leftSection={<Loader size={8} color="blue" />}
                      >
                        streaming
                      </Badge>
                    )}
                  </Group>
                  {(displayed.body || isLoading) && (
                    <Group gap={4}>
                      {displayed.subject && (
                        <Tooltip
                          label={
                            copied === "subj" ? "Copied!" : "Copy subject"
                          }
                        >
                          <ActionIcon
                            size="xs"
                            variant="subtle"
                            color="gray"
                            onClick={() =>
                              copy(displayed.subject, "Subject", "subj")
                            }
                            aria-label="Copy subject"
                          >
                            {copied === "subj" ? (
                              <IconCheck size={11} />
                            ) : (
                              <IconCopy size={11} />
                            )}
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {displayed.body && (
                        <>
                          <Tooltip
                            label={
                              copied === "body" ? "Copied!" : "Copy body (markdown)"
                            }
                          >
                            <ActionIcon
                              size="xs"
                              variant="subtle"
                              color="gray"
                              onClick={() =>
                                copy(displayed.body, "Body", "body")
                              }
                              aria-label="Copy body"
                            >
                              {copied === "body" ? (
                                <IconCheck size={11} />
                              ) : (
                                <IconCopy size={11} />
                              )}
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip
                            label={
                              copied === "full" ? "Copied!" : "Copy full handoff"
                            }
                          >
                            <ActionIcon
                              size="xs"
                              variant="subtle"
                              color="gray"
                              onClick={() =>
                                copy(fullCopy, "Full handoff", "full")
                              }
                              aria-label="Copy full handoff"
                            >
                              {copied === "full" ? (
                                <IconCheck size={11} />
                              ) : (
                                <IconClipboard size={11} />
                              )}
                            </ActionIcon>
                          </Tooltip>
                        </>
                      )}
                    </Group>
                  )}
                </Group>
                {displayed.subject && (
                  <Text
                    size="xs"
                    c="white"
                    mt={4}
                    style={{ fontFamily: "ui-monospace, Menlo, monospace" }}
                  >
                    Subject: {displayed.subject}
                  </Text>
                )}
              </Box>
              <ScrollArea h={520} type="auto">
                <Box p="md">
                  {error && (
                    <Alert
                      icon={<IconAlertCircle size={16} />}
                      color="red"
                      variant="light"
                      mb="md"
                      radius="sm"
                    >
                      AI request failed: {error}
                    </Alert>
                  )}
                  {displayed.body ? (
                    <Box className="ai-markdown">
                      <ReactMarkdown>{displayed.body}</ReactMarkdown>
                    </Box>
                  ) : isLoading ? (
                    <Group gap="xs" mt="sm">
                      <Loader size="xs" color="blue" />
                      <Text size="sm" c="dimmed">
                        Generating handover…
                      </Text>
                    </Group>
                  ) : (
                    <Box ta="center" py="xl">
                      <IconClipboardText
                        size={28}
                        color="var(--mantine-color-dark-3)"
                      />
                      <Text size="sm" c="dimmed" mt="sm">
                        Paste shift notes, pick your shift, click <b>Generate handoff</b>.
                      </Text>
                      <Text size="xs" c="dimmed" mt={4}>
                        The output is rendered here — ready to copy into Slack or email.
                      </Text>
                    </Box>
                  )}
                </Box>
              </ScrollArea>
            </Card>

            {/* History */}
            <Card radius="md" withBorder p="md">
              <Group gap="xs" mb="sm">
                <IconHistory size={14} />
                <Text fw={600} size="sm">
                  Recent handovers
                </Text>
                <Badge size="xs" variant="default">
                  {handovers.length}
                </Badge>
              </Group>
              {handovers.length === 0 ? (
                <Text size="xs" c="dimmed" fs="italic">
                  No handovers saved yet. Generate one and it shows up here.
                </Text>
              ) : (
                <ScrollArea h={200} type="auto">
                  <Stack gap={4}>
                    {handovers.map((h) => (
                      <Group
                        key={h.id}
                        justify="space-between"
                        wrap="nowrap"
                        gap={4}
                        p={6}
                        style={{
                          borderRadius: 6,
                          background:
                            viewing?.id === h.id
                              ? "var(--mantine-color-dark-6)"
                              : "transparent",
                          cursor: "pointer",
                        }}
                        onClick={() => loadHandover(h)}
                      >
                        <Box style={{ minWidth: 0, flex: 1 }}>
                          <Group gap={6} wrap="nowrap">
                            <Badge size="xs" variant="light" color="blue">
                              {h.shift_name}
                            </Badge>
                            <Text size="xs" c="dimmed">
                              {h.shift_date}
                            </Text>
                            {!!h.ticket_count && (
                              <Badge size="xs" variant="default">
                                {h.ticket_count} ticket{h.ticket_count === 1 ? "" : "s"}
                              </Badge>
                            )}
                          </Group>
                          <Text size="xs" truncate mt={2}>
                            {h.subject ?? h.body_markdown.slice(0, 80)}
                          </Text>
                          <Text size="xs" c="dimmed" mt={1}>
                            {formatDateTime(h.created_at)}
                          </Text>
                        </Box>
                        <Tooltip label="Delete">
                          <ActionIcon
                            size="xs"
                            variant="subtle"
                            color="red"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteHandover(h.id);
                            }}
                            aria-label="Delete"
                          >
                            <IconTrash size={12} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    ))}
                  </Stack>
                </ScrollArea>
              )}
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>
    </WidgetFrame>
  );
}
