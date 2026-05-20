import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  Loader,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBuildingBroadcastTower,
  IconCheck,
  IconClipboard,
  IconCopy,
  IconExternalLink,
  IconHistory,
  IconMail,
  IconPlayerStop,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { useCompletion } from "../../lib/devs-ai/use-completion";
import { useIdentity } from "../../lib/identity";
import { formatDateTime } from "../../lib/format";
import {
  availableLevels,
  buildMailtoUrl,
  matchCarrierFromNotes,
  splitContactsForEmail,
  type CarrierMatch,
} from "../../lib/carrier-match";
import type { CarrierEscalation, EscalationContact } from "../../lib/confluence";
import { extractCarrierImages } from "../../lib/confluence";
import { WidgetFrame } from "../WidgetFrame";
import { useEscalations } from "../Escalations/data";
import { useEscalationDrafts, type EscalationDraft } from "./data";

export { EscalationEmailTile } from "./Tile";

// =============================================================================
// AI Prompts — two variants generated SIMULTANEOUSLY from the same notes
//   1. OUTBOUND  — addressed TO the carrier's NOC, asking for help
//   2. INTERNAL  — ESC-MGR Alert template, addressed to AppDirect's escalation
//                  manager team
// =============================================================================

const INTERNAL_PROMPT = `You are an experienced NOC technician at AppDirect drafting an internal escalation email to the carrier-escalation team. Convert the technician's raw notes into a polished, professional email matching the NOC's "Initial Escalation Email" template — ESC-MGR Alert format.

OUTPUT FORMAT (strict — follow exactly):

\`\`\`
Subject: ESC-MGR Alert | <TICKET#> | <CUSTOMER NAME> | <SERVICE PROVIDER & SHORT ISSUE DESCRIPTION>

**Hi <RECIPIENT>,**

We have NOC ticket <TICKET#> created on <DATE> at <TIME>, via <SYSTEM>.

<2–4 sentence paragraph: who was engaged, how quickly, what they identified, the customer's report, anything observed onsite. Plain prose, no bullets.>

**Current Investigation Status:**
<1–3 sentences on what's currently being investigated, hardware/equipment/fiber assessments, who's involved, locations, distances.>

**Latest Update:**
<Most recent updates from carrier, recent splices/dispatches, alarms cleared/reappeared, what we're waiting on, and ETA for next update.>

**Escalation Level:**
<One line: e.g. "Currently, we are at the 3rd level with Lumen on our individual ticket.">

**Customer Feedback:**
<1–2 sentences on customer temperament + cadence of updates being provided. End with: "Let me know if any further assistance is needed.">

---

**Best regards,**

[Name]
NOC Technician
\`\`\`

RULES:
1. Start the very first line with literally "Subject: " then the subject line.
2. Then ONE blank line, then the body. Do NOT add a "Body:" label.
3. Use the section headings exactly as shown (bold via **), in the same order.
4. If notes don't mention something (e.g. no backup-circuit info), OMIT that detail rather than inventing.
5. Keep tone factual, neutral, third-person about the customer.
6. Convert technical jargon and shorthand from notes into full sentences.
7. If a piece of info is missing, use a bracketed placeholder like \`[Ticket #]\`, \`[Sameer & Team]\`, \`[Date]\`.
8. Sign with the provided sender name; if none was provided, leave \`[Name]\` as a placeholder.
9. Do not wrap the whole output in a code block. Output the email directly as markdown.
10. Do not include any preamble like "Here is the draft:" — start directly with "Subject:".`;

const OUTBOUND_PROMPT = `You are an experienced NOC technician at AppDirect drafting an outbound escalation email TO a telecommunications carrier's NOC / customer-support team, requesting escalation assistance on a customer-impacting issue.

This email is sent OUTSIDE the company (to e.g. Lumen NOC, Comcast BNOC, Verizon Service Assurance, AT&T APEX, Zayo NOC). Tone must be:
  - Polite but firm — we are a paying wholesale partner asking for escalation.
  - Specific about the impact (customer name, service type, severity).
  - Specific about what we're asking the carrier to do.
  - Brief — carrier reps read dozens of these per shift.

OUTPUT FORMAT (strict — follow exactly):

\`\`\`
Subject: Escalation Request | <CARRIER> | <CARRIER CIRCUIT/TICKET#> | <CUSTOMER NAME> | <SHORT ISSUE>

**Hi <CARRIER NOC TEAM>,**

<1 sentence opener — we have an active service-impacting issue affecting our customer <CUSTOMER>, and we are requesting your help with escalation.>

**Reference:**
- AppDirect NOC ticket: <#>
- <CARRIER> ticket / circuit ID: <#>
- Service impacted: <SERVICE TYPE — e.g. DIA, MPLS, EVPL, broadband>
- Customer site: <LOCATION / ADDRESS if known>
- Issue opened: <DATE / TIME>

**Investigation Summary:**
<2–4 sentence summary of what we've observed, what we've already tested on our side, and what the carrier has reported back so far. Plain prose, no bullets.>

**Latest <CARRIER> Update:**
<Most recent status / ETA / dispatch info that the carrier has provided. Skip this section if there's been no update from them yet.>

**What we need from you:**
- <Bulleted list — concrete asks. Examples: "Confirm next dispatch ETA", "Re-engage OSPE / splicing crews", "Escalate this to next tier", "Provide an updated circuit-level alarm summary", "Issue an RFO once resolved".>
- <Each ask on its own line, max 4 bullets.>

We'd appreciate an update on next steps and a target update cadence.

Thanks,
[Name]
NOC Technician — AppDirect
\`\`\`

RULES:
1. Start the very first line with literally "Subject: " then the subject line. Subject must start with "Escalation Request".
2. Then ONE blank line, then the body. Do NOT add a "Body:" label.
3. The greeting "Hi <CARRIER NOC TEAM>," should use the recipient name provided in the structured inputs if available (e.g. "Hi Lumen NOC Team," or "Hi Sameer,"). If the recipient is a single named person, use their first name.
4. Use the section headings exactly as shown (bold via **), in the same order.
5. The "What we need from you:" section is REQUIRED — always derive concrete asks from the notes. If the notes are vague, default to: "Provide a status update", "Confirm ETA for next update", "Escalate to next tier if no progress in the next [reasonable interval]".
6. If a piece of info is missing, use a bracketed placeholder like \`[Carrier ticket #]\`, \`[Circuit ID]\`, \`[Customer site]\`.
7. Convert internal jargon (W-numbers, OSPE shorthand) into terms the carrier will recognise (their own ticket number, "outside-plant engineering team", etc.) — but ONLY when it's clearly translatable. Otherwise pass through unchanged.
8. Sign with the provided sender name; if none was provided, leave \`[Name]\` as a placeholder.
9. Do not wrap the whole output in a code block. Output the email directly as markdown.
10. Do not include any preamble like "Here is the draft:" — start directly with "Subject:".`;

// =============================================================================
// Helpers
// =============================================================================

type Toast = {
  id: number;
  color: "green" | "red" | "blue";
  title: string;
  body?: string;
};

function splitSubjectBody(text: string): { subject: string; body: string } {
  const lines = text.split(/\r?\n/);
  let subjectLine = "";
  let bodyStart = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const m = /^\s*subject\s*[:\-—]\s*(.*)$/i.exec(lines[i]);
    if (m) {
      subjectLine = m[1].trim();
      bodyStart = i + 1;
      break;
    }
  }
  while (bodyStart < lines.length && lines[bodyStart].trim() === "") {
    bodyStart++;
  }
  const body = lines.slice(bodyStart).join("\n").trim();
  return { subject: subjectLine, body };
}

/**
 * Strip markdown bold/italic/bullets/headings so the resulting plain text
 * looks reasonable in a mailto: body (mail clients display the body verbatim).
 */
function markdownToPlainText(md: string): string {
  return md
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "  • ")
    .replace(/^---+$/gm, "")
    .replace(/`([^`]+)`/g, "$1");
}

type EmailMode = "outbound" | "internal";

// =============================================================================
// Widget
// =============================================================================

export function EscalationEmailWidget() {
  const { drafts, refresh } = useEscalationDrafts();
  const { identity } = useIdentity();
  const escalations = useEscalations();

  // Form inputs
  const [notes, setNotes] = useState("");
  const [ticketNumber, setTicketNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [recipient, setRecipient] = useState("");
  const senderName = identity?.name ?? "";

  // Carrier override (user can pick a different one if the auto-match is wrong)
  const [carrierOverride, setCarrierOverride] = useState<string | null>(null);

  // Maximum escalation tier to include in the email. Default 2 = L1 + L2 only
  // (L1 → To, L2 → Cc). Bumping to 3 brings L3 into Cc, etc. `null` = include
  // every tier the carrier has.
  const [maxLevel, setMaxLevel] = useState<number | null>(2);

  // Two independent AI streams, generated in parallel from the same notes
  const outboundAi = useCompletion();
  const internalAi = useCompletion();

  // Viewing-from-history state. When set, the matching output card shows the
  // saved draft instead of the streaming AI result.
  const [viewingOutbound, setViewingOutbound] = useState<EscalationDraft | null>(null);
  const [viewingInternal, setViewingInternal] = useState<EscalationDraft | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);

  function showToast(t: Omit<Toast, "id">) {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 3500);
  }

  // ---- Carrier matching --------------------------------------------------
  // Runs every keystroke. Cheap (substring search across ~15 carrier names).
  const autoMatch: CarrierMatch | null = useMemo(() => {
    if (!escalations.data?.carriers) return null;
    return matchCarrierFromNotes(notes, escalations.data.carriers);
  }, [notes, escalations.data]);

  // Effective carrier = explicit override OR auto-detected match.
  const effectiveCarrier: CarrierEscalation | null = useMemo(() => {
    const all = escalations.data?.carriers ?? [];
    if (carrierOverride) {
      return all.find((c) => c.id === carrierOverride) ?? null;
    }
    return autoMatch?.carrier ?? null;
  }, [carrierOverride, autoMatch, escalations.data]);

  // ---- Lazy AI extraction for image/PDF carriers --------------------------
  // The /api/confluence/escalations endpoint only returns base-scraped
  // contacts. For carriers whose contacts live in screenshots (AireSpring,
  // Astound, AT&T APEX, etc.), the AI vision extractor has to run before we
  // can populate the email. We trigger it here on demand, cache results by
  // carrier_id, and merge them into a `carrierWithContacts` view. The
  // server-side endpoint has its own 1-hour cache so warm calls are fast.
  const [extractedContacts, setExtractedContacts] = useState<
    Map<string, EscalationContact[]>
  >(new Map());
  const [extracting, setExtracting] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  useEffect(() => {
    if (!effectiveCarrier) return;
    if (effectiveCarrier.contacts.length > 0) return; // base scrape has them
    if (extractedContacts.has(effectiveCarrier.id)) return; // already done
    if (extracting === effectiveCarrier.id) return; // already in flight

    const carrierId = effectiveCarrier.id;
    const carrierName = effectiveCarrier.carrier;
    setExtracting(carrierId);
    setExtractError(null);
    extractCarrierImages(carrierId, { carrierName })
      .then((r) => {
        setExtractedContacts((prev) => {
          const next = new Map(prev);
          next.set(carrierId, r.contacts ?? []);
          return next;
        });
      })
      .catch((err) => {
        // Cache empty so we don't hammer the endpoint on repeated keystrokes
        setExtractedContacts((prev) => {
          const next = new Map(prev);
          next.set(carrierId, []);
          return next;
        });
        setExtractError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setExtracting(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCarrier?.id]);

  // Merge base + AI-extracted contacts. AI extraction runs only when base
  // is empty, so there's no double-counting risk.
  const carrierWithContacts: CarrierEscalation | null = useMemo(() => {
    if (!effectiveCarrier) return null;
    if (effectiveCarrier.contacts.length > 0) return effectiveCarrier;
    const extracted = extractedContacts.get(effectiveCarrier.id);
    if (!extracted) return effectiveCarrier;
    return { ...effectiveCarrier, contacts: extracted };
  }, [effectiveCarrier, extractedContacts]);

  const contactSplit = useMemo(() => {
    if (!carrierWithContacts) return null;
    return splitContactsForEmail(
      carrierWithContacts.contacts,
      maxLevel ?? undefined,
    );
  }, [carrierWithContacts, maxLevel]);

  // Levels the matched carrier actually has, sorted ascending. Used to
  // populate the "Include up to level" dropdown so we only offer real options.
  const carrierLevels = useMemo(() => {
    if (!carrierWithContacts) return [];
    return availableLevels(carrierWithContacts.contacts);
  }, [carrierWithContacts]);

  const isExtractingMatched =
    !!effectiveCarrier && extracting === effectiveCarrier.id;

  const carrierOptions = useMemo(() => {
    const cs = escalations.data?.carriers ?? [];
    return cs.map((c) => ({
      value: c.id,
      label:
        c.carrier +
        (c.contacts.length > 0 ? ` (${c.contacts.length} contacts)` : " (no contacts)"),
    }));
  }, [escalations.data]);

  const isLoading = outboundAi.isLoading || internalAi.isLoading;

  // ---- Draft generation --------------------------------------------------
  async function runDraft() {
    if (!notes.trim()) {
      showToast({ color: "red", title: "Paste your notes first" });
      return;
    }
    // Clear any "viewing from history" state so the new streams render.
    setViewingOutbound(null);
    setViewingInternal(null);

    const carrier = carrierWithContacts;

    // Shared structured details (pin AI's placeholders to real values)
    const sharedLines: string[] = [];
    if (ticketNumber.trim()) sharedLines.push(`AppDirect ticket #: ${ticketNumber.trim()}`);
    if (customerName.trim()) sharedLines.push(`Customer name: ${customerName.trim()}`);
    if (senderName) sharedLines.push(`Sender name (signature): ${senderName}`);

    // Outbound-specific extras (carrier addressing)
    const outboundLines = [...sharedLines];
    if (carrier) {
      outboundLines.push(`Carrier (matched from notes): ${carrier.carrier}`);
      const greetingNames = recipient.trim()
        ? recipient.trim()
        : (contactSplit?.to ?? [])
            .map((c) => c.name)
            .filter(Boolean)
            .join(", ") || `${carrier.carrier} NOC Team`;
      outboundLines.push(`Recipient (greeting): ${greetingNames}`);
      const toLine = (contactSplit?.to ?? [])
        .map((c) => `${c.name ?? c.email} <${c.email}>`)
        .filter(Boolean)
        .join(", ");
      if (toLine) outboundLines.push(`Email To: ${toLine}`);
      const ccLine = (contactSplit?.cc ?? [])
        .map((c) => `${c.name ?? c.email} <${c.email}>`)
        .filter(Boolean)
        .join(", ");
      if (ccLine) outboundLines.push(`Email Cc: ${ccLine}`);
    }

    // Internal-specific extras (ESC-MGR recipient)
    const internalLines = [...sharedLines];
    if (carrier) internalLines.push(`Service provider / carrier: ${carrier.carrier}`);
    if (recipient.trim()) internalLines.push(`Recipient (greeting): ${recipient.trim()}`);

    const outboundBlock = outboundLines.length
      ? `\nKnown details (use these, don't replace with placeholders):\n${outboundLines.map((s) => `- ${s}`).join("\n")}\n`
      : "";
    const internalBlock = internalLines.length
      ? `\nKnown details (use these, don't replace with placeholders):\n${internalLines.map((s) => `- ${s}`).join("\n")}\n`
      : "";

    const outboundPrompt = `${OUTBOUND_PROMPT}\n${outboundBlock}\n---\nTECHNICIAN'S RAW NOTES:\n${notes.trim()}\n---\n\nNow draft the email.`;
    const internalPrompt = `${INTERNAL_PROMPT}\n${internalBlock}\n---\nTECHNICIAN'S RAW NOTES:\n${notes.trim()}\n---\n\nNow draft the email.`;

    // Fire both in parallel
    const [outboundText, internalText] = await Promise.all([
      outboundAi.complete(outboundPrompt),
      internalAi.complete(internalPrompt),
    ]);

    // Persist both drafts so they show up in the history list
    const inserts: Promise<unknown>[] = [];
    if (outboundText && outboundText.trim()) {
      const { subject, body } = splitSubjectBody(outboundText);
      inserts.push(
        db.insert(schema.escalation_drafts).values({
          ticket_number: ticketNumber.trim() || null,
          customer_name: customerName.trim() || null,
          service_provider: carrier?.carrier ?? null,
          recipient: recipient.trim() || null,
          sender_name: senderName || null,
          raw_notes: notes.trim(),
          subject: subject || null,
          body_markdown: body,
          mode: "outbound",
          to_emails: contactSplit
            ? contactSplit.to.map((c) => c.email).filter(Boolean).join(",")
            : null,
          cc_emails: contactSplit
            ? contactSplit.cc.map((c) => c.email).filter(Boolean).join(",")
            : null,
          carrier_id: carrier?.id ?? null,
        }),
      );
    }
    if (internalText && internalText.trim()) {
      const { subject, body } = splitSubjectBody(internalText);
      inserts.push(
        db.insert(schema.escalation_drafts).values({
          ticket_number: ticketNumber.trim() || null,
          customer_name: customerName.trim() || null,
          service_provider: carrier?.carrier ?? null,
          recipient: recipient.trim() || null,
          sender_name: senderName || null,
          raw_notes: notes.trim(),
          subject: subject || null,
          body_markdown: body,
          mode: "internal",
          to_emails: null,
          cc_emails: null,
          carrier_id: carrier?.id ?? null,
        }),
      );
    }
    if (inserts.length) {
      await Promise.all(inserts);
      refresh();
    }
  }

  function stop() {
    outboundAi.abort();
    internalAi.abort();
  }

  function reset() {
    setNotes("");
    setTicketNumber("");
    setCustomerName("");
    setRecipient("");
    setCarrierOverride(null);
    outboundAi.setResult("");
    internalAi.setResult("");
    setViewingOutbound(null);
    setViewingInternal(null);
  }

  async function deleteDraft(id: number) {
    await db.delete(schema.escalation_drafts).where(eq(schema.escalation_drafts.id, id));
    if (viewingOutbound?.id === id) setViewingOutbound(null);
    if (viewingInternal?.id === id) setViewingInternal(null);
    refresh();
  }

  function loadDraft(d: EscalationDraft) {
    // Restore the inputs so the user can edit and re-draft
    setNotes(d.raw_notes ?? "");
    setTicketNumber(d.ticket_number ?? "");
    setCustomerName(d.customer_name ?? "");
    setRecipient(d.recipient ?? "");
    setCarrierOverride(d.carrier_id ?? null);
    // Show the saved draft in the matching output card
    if (d.mode === "internal") {
      setViewingInternal(d);
      internalAi.setResult("");
    } else {
      setViewingOutbound(d);
      outboundAi.setResult("");
    }
  }

  function copy(text: string, label: string) {
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => showToast({ color: "green", title: `${label} copied` }))
      .catch(() =>
        showToast({
          color: "red",
          title: "Copy failed",
          body: "Browser blocked clipboard access.",
        }),
      );
  }

  // ---- Output computation ------------------------------------------------
  const outboundDisplay = useMemo(() => {
    if (viewingOutbound) {
      return {
        subject: viewingOutbound.subject ?? "",
        body: viewingOutbound.body_markdown ?? "",
        to: viewingOutbound.to_emails ? viewingOutbound.to_emails.split(",").filter(Boolean) : [],
        cc: viewingOutbound.cc_emails ? viewingOutbound.cc_emails.split(",").filter(Boolean) : [],
      };
    }
    if (outboundAi.result) {
      const { subject, body } = splitSubjectBody(outboundAi.result);
      return {
        subject,
        body,
        to: contactSplit ? contactSplit.to.map((c) => c.email!).filter(Boolean) : [],
        cc: contactSplit ? contactSplit.cc.map((c) => c.email!).filter(Boolean) : [],
      };
    }
    return { subject: "", body: "", to: [] as string[], cc: [] as string[] };
  }, [viewingOutbound, outboundAi.result, contactSplit]);

  const internalDisplay = useMemo(() => {
    if (viewingInternal) {
      return {
        subject: viewingInternal.subject ?? "",
        body: viewingInternal.body_markdown ?? "",
      };
    }
    if (internalAi.result) {
      return splitSubjectBody(internalAi.result);
    }
    return { subject: "", body: "" };
  }, [viewingInternal, internalAi.result]);

  const hasAnyOutput =
    !!(outboundDisplay.subject || outboundDisplay.body || internalDisplay.subject || internalDisplay.body || isLoading);

  // mailto: link for outbound only — internal goes to a AppDirect alias the user
  // already has in their contacts.
  const outboundMailto = useMemo(() => {
    if (outboundDisplay.to.length === 0) return null;
    return buildMailtoUrl({
      to: outboundDisplay.to,
      cc: outboundDisplay.cc,
      subject: outboundDisplay.subject,
      body: markdownToPlainText(outboundDisplay.body),
    });
  }, [outboundDisplay]);

  return (
    <WidgetFrame
      title="Escalation Email Drafter"
      subtitle="Paste notes once → drafts BOTH the carrier email and the internal ESC-MGR alert"
      icon={IconMail}
      iconColor="teal"
      loading={isLoading}
      status={{
        label: "AI",
        color: "teal",
        tooltip: "Devs.ai server-side completion + carrier-contact matching",
      }}
      headerActions={
        (notes || outboundAi.result || internalAi.result || viewingOutbound || viewingInternal) && (
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
                    Notes
                  </Text>
                  <Group gap={6}>
                    {autoMatch && (
                      <Badge
                        size="xs"
                        variant="light"
                        color="violet"
                        leftSection={<IconSparkles size={10} />}
                      >
                        Carrier detected: {autoMatch.carrier.carrier}
                      </Badge>
                    )}
                    <Badge size="xs" variant="light" color="gray">
                      {notes.length.toLocaleString()} chars
                    </Badge>
                  </Group>
                </Group>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.currentTarget.value)}
                  placeholder={`Paste any notes — rough bullets, timeline, what carriers said, what you observed.

The carrier (Lumen, Comcast, Verizon, Zayo, etc.) is detected automatically from these notes and used to address the outbound email.

Example:
- ticket 574995 opened 6/21 at 6:19am via MNS
- Lumen engaged in 25 min, identified service impact in Tamarac FL within 60 min
- customer says Lumen interface down, no onsite power issues
- field ops checking fiber ~32 miles from test point, OSPE engaged splicing crews
- alarms cleared but still observing as down — Lumen re-engaged, ETA 60 min
- L4 escalation, customer calm, hourly updates`}
                  autosize
                  minRows={10}
                  maxRows={22}
                  styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
                />
              </Stack>
            </Card>

            {/* Matched-carrier panel */}
            <Card radius="md" withBorder p="md">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Group gap={6}>
                    <IconBuildingBroadcastTower
                      size={14}
                      color="var(--mantine-color-teal-5)"
                    />
                    <Text fw={600} size="sm">
                      Matched carrier
                    </Text>
                  </Group>
                  {carrierWithContacts && (
                    <Tooltip label="Open in Confluence">
                      <ActionIcon
                        component="a"
                        href={carrierWithContacts.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="subtle"
                        size="xs"
                        aria-label="Open in Confluence"
                      >
                        <IconExternalLink size={12} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>

                <Select
                  placeholder="Auto-detected from notes"
                  data={carrierOptions}
                  value={carrierOverride ?? autoMatch?.carrier.id ?? null}
                  onChange={setCarrierOverride}
                  clearable
                  searchable
                  size="xs"
                  nothingFoundMessage={
                    escalations.loading ? "Loading carriers…" : "No carriers loaded"
                  }
                  leftSection={
                    escalations.loading ? (
                      <Loader size={12} />
                    ) : (
                      <IconBuildingBroadcastTower size={12} />
                    )
                  }
                />

                {carrierLevels.length > 1 && (
                  <Select
                    label="Include up to level"
                    description={
                      maxLevel === null
                        ? `All ${carrierLevels.length} levels — every tier is included`
                        : `L1 goes on To · L2…L${maxLevel} go on Cc · L${maxLevel + 1}+ excluded`
                    }
                    data={[
                      ...carrierLevels.map((lvl) => ({
                        value: String(lvl),
                        label:
                          lvl === 1
                            ? "L1 only (To: only)"
                            : `L1 – L${lvl} (To + Cc through L${lvl})`,
                      })),
                      { value: "all", label: `All levels (L1 – L${carrierLevels[carrierLevels.length - 1]})` },
                    ]}
                    value={maxLevel === null ? "all" : String(maxLevel)}
                    onChange={(v) => {
                      if (v === "all" || v === null) {
                        setMaxLevel(null);
                      } else {
                        const n = parseInt(v, 10);
                        setMaxLevel(Number.isFinite(n) ? n : null);
                      }
                    }}
                    size="xs"
                    allowDeselect={false}
                  />
                )}

                {carrierWithContacts ? (
                  <Box>
                    <Group gap={6} mb={6}>
                      {carrierOverride ? (
                        <Badge size="xs" variant="light" color="orange">
                          manually selected
                        </Badge>
                      ) : autoMatch ? (
                        <Badge size="xs" variant="light" color="violet">
                          {autoMatch.source === "alias"
                            ? `alias: "${autoMatch.matched_term}"`
                            : autoMatch.source === "title"
                              ? `matched title`
                              : `matched "${autoMatch.matched_term}"`}
                        </Badge>
                      ) : null}
                      {isExtractingMatched ? (
                        <Badge
                          size="xs"
                          variant="light"
                          color="teal"
                          leftSection={<Loader size={8} color="teal" />}
                        >
                          Extracting contacts…
                        </Badge>
                      ) : (
                        <Badge size="xs" variant="default">
                          {carrierWithContacts.contacts.length} contacts
                        </Badge>
                      )}
                    </Group>
                    {extractError && effectiveCarrier?.id === carrierWithContacts.id && (
                      <Alert
                        icon={<IconAlertCircle size={14} />}
                        color="red"
                        variant="light"
                        radius="sm"
                        p="xs"
                        mb={6}
                        styles={{ message: { fontSize: 11 } }}
                      >
                        AI extraction failed: {extractError}
                      </Alert>
                    )}
                    {carrierWithContacts.contacts.length === 0 ? (
                      isExtractingMatched ? (
                        <Group gap={6}>
                          <Loader size={12} />
                          <Text size="xs" c="dimmed" fs="italic">
                            Running AI vision / PDF extraction…
                          </Text>
                        </Group>
                      ) : (
                        <Alert
                          icon={<IconAlertCircle size={14} />}
                          color="yellow"
                          variant="light"
                          radius="sm"
                          p="xs"
                          styles={{ message: { fontSize: 11 } }}
                        >
                          This carrier has no extracted NOC contacts yet. Open
                          the QS Carrier Escalation Contacts widget and load
                          this carrier first, or pick another carrier above.
                        </Alert>
                      )
                    ) : (
                      <ContactPreview
                        carrier={carrierWithContacts}
                        contactSplit={contactSplit}
                      />
                    )}
                  </Box>
                ) : (
                  <Text size="xs" c="dimmed" fs="italic">
                    Type a carrier name in the notes (e.g. "Lumen", "Zayo",
                    "Comcast", "CenturyLink") and we'll auto-fill the
                    escalation contacts here.
                  </Text>
                )}
              </Stack>
            </Card>

            <Card radius="md" withBorder p="md">
              <Text fw={600} size="sm" mb="sm">
                Optional details
              </Text>
              <Stack gap="xs">
                <TextInput
                  label="Ticket #"
                  placeholder="574995"
                  size="xs"
                  value={ticketNumber}
                  onChange={(e) => setTicketNumber(e.currentTarget.value)}
                />
                <TextInput
                  label="Customer name"
                  placeholder="ACME Corp"
                  size="xs"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.currentTarget.value)}
                />
                <TextInput
                  label="Recipient greeting (override)"
                  placeholder={
                    carrierWithContacts
                      ? `e.g. "Lumen NOC Team" or "Sameer & Team"`
                      : "Sameer & Team"
                  }
                  size="xs"
                  value={recipient}
                  onChange={(e) => setRecipient(e.currentTarget.value)}
                />
                <TextInput
                  label="Your name (signature)"
                  placeholder={senderName || "Set your identity in the dashboard"}
                  size="xs"
                  value={senderName}
                  readOnly
                  styles={{ input: { opacity: 0.7 } }}
                />
              </Stack>
            </Card>

            <Group justify="space-between">
              {isLoading ? (
                <Button
                  color="red"
                  variant="light"
                  leftSection={<IconPlayerStop size={14} />}
                  onClick={stop}
                  fullWidth
                >
                  Stop streaming
                </Button>
              ) : (
                <Button
                  color="teal"
                  leftSection={<IconSparkles size={14} />}
                  onClick={runDraft}
                  disabled={!notes.trim()}
                  fullWidth
                >
                  {outboundAi.result || internalAi.result || viewingOutbound || viewingInternal
                    ? "Re-draft both emails"
                    : "Draft both emails"}
                </Button>
              )}
            </Group>

            {(outboundAi.error || internalAi.error) && (
              <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
                AI request failed: {outboundAi.error ?? internalAi.error}
              </Alert>
            )}
          </Stack>
        </Grid.Col>

        {/* ---------- RIGHT: two outputs stacked ---------- */}
        <Grid.Col span={{ base: 12, md: 7 }}>
          {hasAnyOutput ? (
            <Stack gap="md">
              <EmailOutputCard
                title="To carrier"
                icon={IconBuildingBroadcastTower}
                color="teal"
                modeBadge="outbound"
                isLoading={outboundAi.isLoading}
                viewing={viewingOutbound}
                subject={outboundDisplay.subject}
                body={outboundDisplay.body}
                to={outboundDisplay.to}
                cc={outboundDisplay.cc}
                mailtoUrl={outboundMailto}
                onCopySubject={() => copy(outboundDisplay.subject, "Subject")}
                onCopyBody={() => copy(outboundDisplay.body, "Body")}
                onCopyFull={() =>
                  copy(
                    [
                      outboundDisplay.to.length
                        ? `To: ${outboundDisplay.to.join(", ")}`
                        : null,
                      outboundDisplay.cc.length
                        ? `Cc: ${outboundDisplay.cc.join(", ")}`
                        : null,
                      `Subject: ${outboundDisplay.subject}`,
                      "",
                      outboundDisplay.body,
                    ]
                      .filter((v) => v !== null)
                      .join("\n"),
                    "Full email",
                  )
                }
                onCopyToRow={() => copy(outboundDisplay.to.join(", "), "To addresses")}
                onCopyCcRow={() => copy(outboundDisplay.cc.join(", "), "Cc addresses")}
              />
              <EmailOutputCard
                title="Internal ESC-MGR alert"
                icon={IconUser}
                color="violet"
                modeBadge="internal"
                isLoading={internalAi.isLoading}
                viewing={viewingInternal}
                subject={internalDisplay.subject}
                body={internalDisplay.body}
                to={[]}
                cc={[]}
                mailtoUrl={null}
                onCopySubject={() => copy(internalDisplay.subject, "Subject")}
                onCopyBody={() => copy(internalDisplay.body, "Body")}
                onCopyFull={() =>
                  copy(
                    `Subject: ${internalDisplay.subject}\n\n${internalDisplay.body}`,
                    "Full email",
                  )
                }
              />
            </Stack>
          ) : (
            <Card radius="md" withBorder p={0} style={{ minHeight: 360 }}>
              <Stack align="center" justify="center" h={360} gap="xs">
                <ThemeIcon size={48} radius="xl" variant="light" color="teal" mx="auto">
                  <IconMail size={24} />
                </ThemeIcon>
                <Text size="sm" fw={500} ta="center">
                  No drafts yet
                </Text>
                <Text size="xs" c="dimmed" ta="center" maw={360}>
                  Paste your investigation notes on the left. We'll draft TWO
                  emails in parallel — one addressed to the matched carrier's
                  NOC contacts asking for escalation assistance, and one
                  internal ESC-MGR Alert for the AppDirect escalation manager team.
                </Text>
              </Stack>
            </Card>
          )}
        </Grid.Col>
      </Grid>

      {/* History */}
      {drafts.length > 0 && (
        <Box mt="lg">
          <Group gap="xs" mb="xs">
            <IconHistory size={14} />
            <Text size="sm" fw={600}>
              Recent drafts
            </Text>
            <Badge size="xs" variant="light" color="gray">
              {drafts.length}
            </Badge>
          </Group>
          <Card radius="md" withBorder p={0}>
            <ScrollArea.Autosize mah={280}>
              <Stack gap={0}>
                {drafts.map((d, idx) => (
                  <Box
                    key={d.id}
                    style={{
                      borderBottom:
                        idx === drafts.length - 1
                          ? "none"
                          : "1px solid var(--mantine-color-dark-4)",
                      cursor: "pointer",
                      background:
                        viewingOutbound?.id === d.id || viewingInternal?.id === d.id
                          ? "var(--mantine-color-dark-6)"
                          : "transparent",
                    }}
                    px="md"
                    py="sm"
                    onClick={() => loadDraft(d)}
                  >
                    <Group justify="space-between" wrap="nowrap" gap="sm">
                      <Box style={{ minWidth: 0, flex: 1 }}>
                        <Group gap={6} wrap="nowrap">
                          {d.ticket_number && (
                            <Badge size="xs" variant="light" color="teal">
                              {d.ticket_number}
                            </Badge>
                          )}
                          {d.mode && (
                            <Badge
                              size="xs"
                              variant="light"
                              color={d.mode === "outbound" ? "violet" : "gray"}
                            >
                              {d.mode === "outbound" ? "→ carrier" : "internal"}
                            </Badge>
                          )}
                          {d.service_provider && (
                            <Badge size="xs" variant="default">
                              {d.service_provider}
                            </Badge>
                          )}
                          <Text size="sm" fw={500} truncate>
                            {d.subject ?? "(no subject)"}
                          </Text>
                        </Group>
                        <Text size="xs" c="dimmed" truncate>
                          {[d.customer_name, d.service_provider]
                            .filter(Boolean)
                            .join(" · ") || formatDateTime(new Date(d.created_at))}
                        </Text>
                      </Box>
                      <Tooltip label="Delete">
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteDraft(d.id);
                          }}
                          aria-label="Delete draft"
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
    </WidgetFrame>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

interface EmailOutputCardProps {
  title: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  color: string;
  modeBadge: EmailMode;
  isLoading: boolean;
  viewing: EscalationDraft | null;
  subject: string;
  body: string;
  to: string[];
  cc: string[];
  mailtoUrl: string | null;
  onCopySubject: () => void;
  onCopyBody: () => void;
  onCopyFull: () => void;
  onCopyToRow?: () => void;
  onCopyCcRow?: () => void;
}

function EmailOutputCard({
  title,
  icon: Icon,
  color,
  modeBadge,
  isLoading,
  viewing,
  subject,
  body,
  to,
  cc,
  mailtoUrl,
  onCopySubject,
  onCopyBody,
  onCopyFull,
  onCopyToRow,
  onCopyCcRow,
}: EmailOutputCardProps) {
  const hasContent = !!(subject || body || isLoading);
  return (
    <Card radius="md" withBorder p={0}>
      {/* Card title strip */}
      <Box
        p="xs"
        px="md"
        style={{
          borderBottom: "1px solid var(--mantine-color-dark-4)",
          background: `var(--mantine-color-${color}-9)`,
        }}
      >
        <Group gap="xs">
          <Icon size={14} color={`var(--mantine-color-${color}-3)`} />
          <Text size="sm" fw={600}>
            {title}
          </Text>
          <Badge size="xs" variant="light" color={color}>
            {modeBadge === "outbound" ? "to carrier" : "internal"}
          </Badge>
          {viewing && (
            <Badge size="xs" variant="light" color="gray" leftSection={<IconHistory size={10} />}>
              Saved {formatDateTime(new Date(viewing.created_at))}
            </Badge>
          )}
          {isLoading && <Loader size="xs" />}
        </Group>
      </Box>

      {!hasContent ? (
        <Box p="md">
          <Text size="xs" c="dimmed">
            —
          </Text>
        </Box>
      ) : (
        <>
          {/* To / Cc / Subject header */}
          <Box
            p="md"
            style={{
              borderBottom: "1px solid var(--mantine-color-dark-4)",
              background: "var(--mantine-color-dark-7)",
            }}
          >
            <Stack gap={6}>
              {to.length > 0 && onCopyToRow && (
                <EmailHeaderRow label="To" emails={to} onCopy={onCopyToRow} />
              )}
              {cc.length > 0 && onCopyCcRow && (
                <EmailHeaderRow label="Cc" emails={cc} onCopy={onCopyCcRow} />
              )}
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Box style={{ minWidth: 0, flex: 1 }}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    Subject
                  </Text>
                  <Text
                    size="sm"
                    fw={600}
                    mt={2}
                    style={{
                      fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
                      wordBreak: "break-word",
                    }}
                  >
                    {subject || (
                      <Text component="span" c="dimmed" fs="italic">
                        (generating subject…)
                      </Text>
                    )}
                  </Text>
                </Box>
                <Group gap={4} wrap="nowrap">
                  {subject && (
                    <Tooltip label="Copy subject">
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        onClick={onCopySubject}
                        aria-label="Copy subject"
                      >
                        <IconCopy size={14} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              </Group>
            </Stack>
          </Box>

          {/* Body */}
          <Box p="md">
            <Group justify="flex-end" mb="sm">
              <Group gap={4}>
                {body && (
                  <>
                    {mailtoUrl && (
                      <Tooltip label="Open in your mail client (To/Cc/Subject/body pre-filled)">
                        <Button
                          component="a"
                          href={mailtoUrl}
                          size="compact-xs"
                          variant="light"
                          color={color}
                          leftSection={<IconMail size={12} />}
                        >
                          Open in mail
                        </Button>
                      </Tooltip>
                    )}
                    <Tooltip label="Copy body (markdown)">
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        onClick={onCopyBody}
                        aria-label="Copy body"
                      >
                        <IconCopy size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Copy full email (Subject + Body)">
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        onClick={onCopyFull}
                        aria-label="Copy full email"
                      >
                        <IconClipboard size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </>
                )}
              </Group>
            </Group>
            <Divider mb="sm" />
            <Box className="ai-markdown" style={{ lineHeight: 1.6, fontSize: 14 }}>
              {body ? (
                <ReactMarkdown>{body}</ReactMarkdown>
              ) : (
                <Text size="sm" c="dimmed">
                  {isLoading ? "Streaming…" : "—"}
                </Text>
              )}
            </Box>
          </Box>
        </>
      )}
    </Card>
  );
}

function ContactPreview({
  carrier,
  contactSplit,
}: {
  carrier: CarrierEscalation;
  contactSplit: ReturnType<typeof splitContactsForEmail> | null;
}) {
  if (!contactSplit) return null;
  const totalWithEmail = contactSplit.to.length + contactSplit.cc.length;
  if (totalWithEmail === 0) {
    return (
      <Alert
        icon={<IconAlertCircle size={14} />}
        color="yellow"
        variant="light"
        radius="sm"
        p="xs"
        styles={{ message: { fontSize: 11 } }}
      >
        <Stack gap={4}>
          <Text size="xs">
            {contactSplit.excluded_count > 0
              ? `All ${contactSplit.excluded_count} email-capable contacts are above the selected level cutoff. Raise the "Include up to level" setting to include them.`
              : `${carrier.contacts.length} contacts found but none have email addresses. The email draft will use placeholders for recipients.`}
          </Text>
          {contactSplit.phone_only.length > 0 && (
            <Text size="xs" c="dimmed">
              Phone-only escalation paths:{" "}
              {contactSplit.phone_only
                .slice(0, 3)
                .map((c) => `${c.name ?? c.level} (${c.phone})`)
                .join(", ")}
            </Text>
          )}
        </Stack>
      </Alert>
    );
  }
  return (
    <Stack gap={6}>
      {contactSplit.to.length > 0 && (
        <Box>
          <Group justify="space-between" align="center" mb={2}>
            <Text c="dimmed" tt="uppercase" fw={600} style={{ fontSize: 10 }}>
              To · {contactSplit.to.length}
            </Text>
            <CopyAllButton
              label="To"
              emails={contactSplit.to
                .map((c) => c.email)
                .filter((e): e is string => !!e)}
            />
          </Group>
          <Stack gap={2}>
            {contactSplit.to.map((c, i) => (
              <ContactLine key={`to-${i}`} contact={c} primary />
            ))}
          </Stack>
        </Box>
      )}
      {contactSplit.cc.length > 0 && (
        <Box>
          <Group justify="space-between" align="center" mb={2}>
            <Text c="dimmed" tt="uppercase" fw={600} style={{ fontSize: 10 }}>
              Cc · {contactSplit.cc.length}
            </Text>
            <CopyAllButton
              label="Cc"
              emails={contactSplit.cc
                .map((c) => c.email)
                .filter((e): e is string => !!e)}
            />
          </Group>
          <Stack gap={2}>
            {contactSplit.cc.slice(0, 5).map((c, i) => (
              <ContactLine key={`cc-${i}`} contact={c} />
            ))}
            {contactSplit.cc.length > 5 && (
              <Text size="xs" c="dimmed" ml={4}>
                +{contactSplit.cc.length - 5} more
              </Text>
            )}
          </Stack>
        </Box>
      )}
      {contactSplit.phone_only.length > 0 && (
        <Text size="xs" c="dimmed" fs="italic" mt={2}>
          + {contactSplit.phone_only.length} phone-only escalation contact
          {contactSplit.phone_only.length === 1 ? "" : "s"}
        </Text>
      )}
      {contactSplit.excluded_count > 0 && (
        <Text size="xs" c="dimmed" fs="italic">
          {contactSplit.excluded_count} higher-tier contact
          {contactSplit.excluded_count === 1 ? "" : "s"} excluded by level filter
        </Text>
      )}
    </Stack>
  );
}

function ContactLine({
  contact,
  primary,
}: {
  contact: EscalationContact;
  primary?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!contact.email) return;
    navigator.clipboard
      .writeText(contact.email)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* silently fail — toast is for parent contexts */
      });
  }

  return (
    <Group gap={6} wrap="nowrap" align="baseline">
      <Badge
        size="xs"
        variant="light"
        color={primary ? "teal" : "gray"}
        style={{ flexShrink: 0 }}
      >
        {contact.level}
      </Badge>
      <Box style={{ minWidth: 0, flex: 1 }}>
        {contact.name && (
          <Text size="xs" fw={500} truncate>
            {contact.name}
          </Text>
        )}
        {contact.email && (
          <Group gap={4} wrap="nowrap" align="center">
            <Anchor
              href={`mailto:${contact.email}`}
              size="xs"
              c={primary ? "teal.4" : "blue.4"}
              style={{ flex: 1, wordBreak: "break-all", minWidth: 0 }}
            >
              {contact.email}
            </Anchor>
            <Tooltip
              label={copied ? "Copied!" : "Copy email"}
              position="left"
              withArrow
            >
              <ActionIcon
                size="xs"
                variant="subtle"
                color={copied ? "green" : "gray"}
                onClick={handleCopy}
                aria-label={`Copy ${contact.email}`}
                style={{ flexShrink: 0 }}
              >
                {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
      </Box>
    </Group>
  );
}

/**
 * Small button next to the "To" / "Cc" section header that copies every
 * email in that section as a comma-separated list, ready to paste into
 * a mail client's address field.
 */
function CopyAllButton({ label, emails }: { label: string; emails: string[] }) {
  const [copied, setCopied] = useState(false);
  if (emails.length === 0) return null;

  function handle() {
    navigator.clipboard
      .writeText(emails.join(", "))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* ignore */
      });
  }

  return (
    <Tooltip
      label={copied ? "Copied!" : `Copy all ${label} (${emails.length})`}
      position="left"
      withArrow
    >
      <ActionIcon
        size="xs"
        variant="subtle"
        color={copied ? "green" : "gray"}
        onClick={handle}
        aria-label={`Copy all ${label} emails`}
      >
        {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
      </ActionIcon>
    </Tooltip>
  );
}

function EmailHeaderRow({
  label,
  emails,
  onCopy,
}: {
  label: string;
  emails: string[];
  onCopy: () => void;
}) {
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start" gap={6}>
      <Box style={{ minWidth: 0, flex: 1 }}>
        <Group gap={4} wrap="nowrap" align="baseline">
          <Text
            c="dimmed"
            tt="uppercase"
            fw={700}
            style={{ fontSize: 10, minWidth: 24 }}
          >
            {label}
          </Text>
          <Text
            size="xs"
            style={{
              fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
              wordBreak: "break-all",
            }}
          >
            {emails.join(", ")}
          </Text>
        </Group>
      </Box>
      <Tooltip label={`Copy ${label}`}>
        <ActionIcon
          variant="subtle"
          size="xs"
          onClick={onCopy}
          aria-label={`Copy ${label}`}
        >
          <IconCopy size={12} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
