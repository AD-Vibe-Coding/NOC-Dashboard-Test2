import { useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
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
  IconCopy,
  IconHistory,
  IconMailForward,
  IconPlayerStop,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconUser,
  IconUsers,
  IconWand,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { useCompletion } from "../../lib/devs-ai/use-completion";
import { useIdentity } from "../../lib/identity";
import { formatDateTime } from "../../lib/format";
import { WidgetFrame } from "../WidgetFrame";
import { usePolishedEmails, type PolishedEmail } from "./data";

export { EmailPolisherTile } from "./Tile";

// =============================================================================
// Email Polisher
// Takes a rough draft + recipient audience and produces a polished, properly-
// toned email. The audience selector (Customer / Internal / Carrier) drives
// the prompt — each audience has very different conventions:
//   - Customer: courteous, plain-English, no internal jargon, reassuring,
//     clear next steps, ALWAYS includes greeting + sign-off.
//   - Internal: NOC/engineering team, technical shorthand OK, terse,
//     action-oriented, brief.
//   - Carrier: wholesale partner asking for help. Polite-firm tone, specific
//     asks, references our ticket + their circuit/ticket ID.
// =============================================================================

type Audience = "customer" | "internal" | "carrier";

const AUDIENCE_META: Record<
  Audience,
  {
    label: string;
    color: string;
    icon: React.ComponentType<{ size?: number }>;
    description: string;
  }
> = {
  customer: {
    label: "Customer",
    color: "cyan",
    icon: IconUser,
    description: "External — plain-English, no internal jargon, reassuring",
  },
  internal: {
    label: "Internal",
    color: "violet",
    icon: IconUsers,
    description: "Coworkers — technical shorthand OK, brief, action-oriented",
  },
  carrier: {
    label: "Carrier",
    color: "orange",
    icon: IconBuildingBroadcastTower,
    description: "Wholesale partner — polite-firm, specific asks, brief",
  },
};

const CUSTOMER_PROMPT = `You are a senior NOC technician at AppDirect writing a polished EMAIL TO A CUSTOMER.

This is an external-facing email. The customer is a paying business that relies on us for their telecom services (DIA, MPLS, voice, broadband, SD-WAN). They may be calm, frustrated, or anxious. The email must:
  - Open with a polite greeting using the recipient's first name when available, else "Hi there,".
  - Use plain English. NEVER use internal jargon ("OSPE", "BNOC", "L4 escalation", "W-numbers", "ack", "bio break", "snmp poll").
  - Translate carrier shorthand into customer-readable language. ("Lumen has dispatched a splice team" not "OSPE crews dispatched on the Lumen ticket".)
  - Acknowledge the customer's pain or impact in the first 1-2 sentences.
  - State the current status clearly and what we are doing right now.
  - State the next concrete step + timeline (ETA, when we will update them next).
  - Avoid blame language ("the carrier hasn't responded yet") — use neutral phrasing ("we are awaiting a response from the carrier and will follow up if we don't hear back by HH:MM").
  - Close with a courteous sign-off that invites them to reach out with any questions.
  - Sign with the technician's name + "AppDirect NOC Team".

OUTPUT FORMAT (strict):

\`\`\`
Subject: <Clear, helpful subject — service/issue + status, e.g. "Update: Internet Outage at <Site> — Carrier Dispatched">

Hi <Customer first name or "there">,

<Body — 2-5 short paragraphs. NO bullet lists unless the user explicitly asks for them. Use plain prose.>

We will follow up with our next update by <TIME or "within the hour" / "by 4:00 PM PST">. Please don't hesitate to reach out if you have any questions in the meantime.

Best regards,
<Sender name>
AppDirect NOC Team
\`\`\``;

const INTERNAL_PROMPT = `You are a senior NOC technician at AppDirect writing a polished email to a COWORKER or INTERNAL TEAM (NOC, engineering, sales engineering, account management, escalation manager).

Internal recipients understand telecom jargon and prefer brevity. The email must:
  - Open with first-name greeting or no greeting at all if it's a quick reply.
  - Be terse and action-oriented. No customer-facing softening.
  - Use bullet points or short sections for status, action items, and asks.
  - Internal shorthand is fine and expected (W-numbers, OSPE, L3, BNOC, splice, dispatch, RFO).
  - Be explicit about what the recipient needs to do, by when.
  - Sign-off can be informal ("Thanks," + first name).

OUTPUT FORMAT (strict):

\`\`\`
Subject: <Short, scannable subject — usually starts with ticket number or context tag, e.g. "[574995] Lumen update — need approval to engage L4">

Hi <First name(s)>,

<Body — bullet points or short numbered sections preferred. Bold field labels (**Status**, **Ask**, **By when**) where useful. Keep it under 12 short lines.>

Thanks,
<Sender first name>
\`\`\``;

const CARRIER_PROMPT = `You are a senior NOC technician at AppDirect writing a polished email TO A WHOLESALE CARRIER (Lumen, Comcast, Verizon, AT&T, Zayo, Spectrum, etc.) — typically their NOC, customer-support, or escalation-manager team.

This is an external email going to a vendor. The tone must be:
  - Polite but firm — we are a paying wholesale partner asking for action.
  - Specific — always reference our ticket # and the carrier's ticket / circuit ID if known.
  - Brief — carrier reps read dozens of these per shift. No fluff.
  - Concrete asks — what we want them to do, by when.
  - Avoid emotional language even if frustrated. Stick to facts and asks.

OUTPUT FORMAT (strict):

\`\`\`
Subject: <Carrier name> | <Their ticket / circuit ID or our ticket #> | <Short issue + ask>

Hi <Carrier> Team,

<1 sentence opener: what's happening + the customer impact.>

**Reference:**
- AppDirect NOC ticket: <#>
- <Carrier> ticket / circuit ID: <# or "[Insert]">
- Service impacted: <DIA / MPLS / EVPL / Broadband / Voice>
- Site: <Location if known>

**Current Status:**
<2-3 short sentences on what we've observed, what we've done on our side, what we've heard from the carrier so far.>

**What we need from you:**
- <Concrete ask 1>
- <Concrete ask 2>
- <Concrete ask 3 — max 4 bullets>

Please confirm receipt and provide an updated ETA at your earliest convenience.

Thanks,
<Sender name>
NOC Technician — AppDirect
\`\`\``;

const PROMPTS: Record<Audience, string> = {
  customer: CUSTOMER_PROMPT,
  internal: INTERNAL_PROMPT,
  carrier: CARRIER_PROMPT,
};

const TONE_OPTIONS = [
  { value: "neutral", label: "Neutral" },
  { value: "apologetic", label: "Apologetic" },
  { value: "reassuring", label: "Reassuring" },
  { value: "firm", label: "Firm" },
];

const LENGTH_OPTIONS = [
  { value: "concise", label: "Concise — only the essentials" },
  { value: "standard", label: "Standard" },
  { value: "detailed", label: "Detailed — more context" },
];

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
  return { subject: subjectLine, body: lines.slice(bodyStart).join("\n").trim() };
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

// =============================================================================
// Widget
// =============================================================================

export function EmailPolisherWidget() {
  const { emails, refresh } = usePolishedEmails();
  const { identity } = useIdentity();
  const senderName = identity?.name ?? "";

  const [audience, setAudience] = useState<Audience>("customer");
  const [recipientName, setRecipientName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [ticketNumber, setTicketNumber] = useState("");
  const [tone, setTone] = useState<string>("neutral");
  const [length, setLength] = useState<string>("standard");
  const [draft, setDraft] = useState("");

  const ai = useCompletion();
  const [viewing, setViewing] = useState<PolishedEmail | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function showToast(t: Omit<Toast, "id">) {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 3500);
  }

  async function copyToClipboard(text: string, key: string, toastTitle: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
      showToast({ color: "green", title: toastTitle });
    } catch {
      showToast({ color: "red", title: "Copy failed", body: "Browser blocked clipboard access." });
    }
  }

  async function runPolish() {
    if (!draft.trim()) {
      showToast({ color: "red", title: "Paste your draft first" });
      return;
    }
    setViewing(null);

    const structured: string[] = [];
    if (recipientName.trim()) structured.push(`Recipient name: ${recipientName.trim()}`);
    if (customerName.trim()) structured.push(`Customer/company: ${customerName.trim()}`);
    if (carrierName.trim() && audience !== "customer")
      structured.push(`Carrier: ${carrierName.trim()}`);
    if (ticketNumber.trim()) structured.push(`AppDirect ticket #: ${ticketNumber.trim()}`);
    if (senderName) structured.push(`Sender (signature): ${senderName}`);
    structured.push(`Desired tone: ${tone}`);
    structured.push(`Desired length: ${length}`);

    const structuredBlock = `\nKnown details (use these — don't invent placeholders for these):\n${structured.map((s) => `- ${s}`).join("\n")}\n`;

    const prompt = `${PROMPTS[audience]}
${structuredBlock}
---
USER'S RAW DRAFT (polish this — preserve their intent and facts; fix tone, grammar, structure, and add anything missing per the format rules above):

${draft.trim()}
---

Now output the polished email starting with "Subject:".`;

    const text = await ai.complete(prompt);
    if (text && text.trim().length > 0) {
      const { subject, body } = splitSubjectBody(text);
      await db.insert(schema.polished_emails).values({
        audience,
        recipient_name: recipientName.trim() || null,
        customer_name: customerName.trim() || null,
        carrier_name: carrierName.trim() || null,
        ticket_number: ticketNumber.trim() || null,
        sender_name: senderName || null,
        raw_draft: draft.trim(),
        subject: subject || null,
        body_markdown: body,
        tone,
        length,
      });
      refresh();
    }
  }

  function reset() {
    setDraft("");
    setRecipientName("");
    setCustomerName("");
    setCarrierName("");
    setTicketNumber("");
    setTone("neutral");
    setLength("standard");
    ai.setResult("");
    setViewing(null);
  }

  async function deleteEmail(id: number) {
    await db.delete(schema.polished_emails).where(eq(schema.polished_emails.id, id));
    if (viewing?.id === id) setViewing(null);
    refresh();
  }

  function loadEmail(e: PolishedEmail) {
    setAudience((e.audience as Audience) ?? "customer");
    setRecipientName(e.recipient_name ?? "");
    setCustomerName(e.customer_name ?? "");
    setCarrierName(e.carrier_name ?? "");
    setTicketNumber(e.ticket_number ?? "");
    setTone(e.tone ?? "neutral");
    setLength(e.length ?? "standard");
    setDraft(e.raw_draft ?? "");
    setViewing(e);
    ai.setResult("");
  }

  const display = useMemo(() => {
    if (viewing) {
      return { subject: viewing.subject ?? "", body: viewing.body_markdown ?? "" };
    }
    if (ai.result) return splitSubjectBody(ai.result);
    return { subject: "", body: "" };
  }, [viewing, ai.result]);

  const audienceMeta = AUDIENCE_META[audience];

  return (
    <WidgetFrame
      title="Email Polisher"
      subtitle="Paste a rough draft → AI rewrites for the audience"
      icon={IconMailForward}
      iconColor="lime"
      loading={ai.isLoading}
      status={{ label: "AI", color: "lime", tooltip: "Powered by Devs.ai" }}
      headerActions={
        (draft || ai.result || viewing) && (
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
            icon={t.color === "red" ? <IconAlertCircle size={16} /> : <IconSparkles size={16} />}
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
            {/* Audience selector — the headline control */}
            <Card radius="md" withBorder p="md">
              <Stack gap="xs">
                <Text fw={600} size="sm">
                  Send to
                </Text>
                <SegmentedControl
                  fullWidth
                  data={[
                    {
                      value: "customer",
                      label: (
                        <Group gap={6} justify="center" wrap="nowrap">
                          <IconUser size={14} />
                          <Text size="sm">Customer</Text>
                        </Group>
                      ),
                    },
                    {
                      value: "internal",
                      label: (
                        <Group gap={6} justify="center" wrap="nowrap">
                          <IconUsers size={14} />
                          <Text size="sm">Internal</Text>
                        </Group>
                      ),
                    },
                    {
                      value: "carrier",
                      label: (
                        <Group gap={6} justify="center" wrap="nowrap">
                          <IconBuildingBroadcastTower size={14} />
                          <Text size="sm">Carrier</Text>
                        </Group>
                      ),
                    },
                  ]}
                  value={audience}
                  onChange={(v) => setAudience(v as Audience)}
                  color={audienceMeta.color}
                />
                <Group gap={6} wrap="nowrap">
                  <ThemeIcon
                    size="xs"
                    radius="sm"
                    variant="light"
                    color={audienceMeta.color}
                  >
                    <audienceMeta.icon size={10} />
                  </ThemeIcon>
                  <Text size="xs" c="dimmed" fs="italic">
                    {audienceMeta.description}
                  </Text>
                </Group>
              </Stack>
            </Card>

            {/* Draft input */}
            <Card radius="md" withBorder p="md">
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Text fw={600} size="sm">
                    Your draft
                  </Text>
                  <Badge size="xs" variant="light" color="gray">
                    {draft.length.toLocaleString()} chars
                  </Badge>
                </Group>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.currentTarget.value)}
                  placeholder={
                    audience === "customer"
                      ? `Hey, want to let you know your internet at the Tamarac office is still down. Lumen says they dispatched but we don't have an ETA. We're staying on it. Will update later today.`
                      : audience === "internal"
                        ? `574995 — Lumen splice ongoing, ETA 60 min. Need someone to cover next 30 min while I jump on bridge call for 654617. Akram any chance you can monitor?`
                        : `Hi Lumen — ticket 574995, circuit DIA at Tamarac FL. Customer is still down 4 hours later. We need a dispatch ETA and please bump to next tier if no progress in 60 min.`
                  }
                  autosize
                  minRows={8}
                  maxRows={18}
                  styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
                />
                <Text size="xs" c="dimmed" fs="italic">
                  Paste your rough version — the AI will fix tone, grammar, structure,
                  and translate jargon for the selected audience.
                </Text>
              </Stack>
            </Card>

            {/* Optional context */}
            <Card radius="md" withBorder p="md">
              <Text fw={600} size="sm" mb="sm">
                Optional context
              </Text>
              <Stack gap="xs">
                <TextInput
                  label={
                    audience === "customer"
                      ? "Customer recipient name"
                      : audience === "carrier"
                        ? "Carrier team / contact name"
                        : "Internal recipient name(s)"
                  }
                  placeholder={
                    audience === "customer"
                      ? "Jane Doe"
                      : audience === "carrier"
                        ? "Lumen NOC Team"
                        : "Sameer & Team"
                  }
                  size="xs"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.currentTarget.value)}
                />
                <TextInput
                  label="Customer / company"
                  placeholder="ACME Corp"
                  size="xs"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.currentTarget.value)}
                />
                {audience !== "customer" && (
                  <TextInput
                    label="Carrier"
                    placeholder="Lumen / Comcast / Verizon …"
                    size="xs"
                    value={carrierName}
                    onChange={(e) => setCarrierName(e.currentTarget.value)}
                  />
                )}
                <TextInput
                  label="AppDirect ticket #"
                  placeholder="574995"
                  size="xs"
                  value={ticketNumber}
                  onChange={(e) => setTicketNumber(e.currentTarget.value)}
                />
                <Group grow>
                  <Select
                    label="Tone"
                    data={TONE_OPTIONS}
                    value={tone}
                    onChange={(v) => setTone(v ?? "neutral")}
                    size="xs"
                    allowDeselect={false}
                  />
                  <Select
                    label="Length"
                    data={LENGTH_OPTIONS}
                    value={length}
                    onChange={(v) => setLength(v ?? "standard")}
                    size="xs"
                    allowDeselect={false}
                  />
                </Group>
                <TextInput
                  label="Your name (signature)"
                  placeholder={senderName || "Set your identity in the dashboard"}
                  size="xs"
                  value={senderName}
                  disabled
                />
              </Stack>
            </Card>

            <Group justify="flex-end">
              {ai.isLoading ? (
                <Button
                  leftSection={<IconPlayerStop size={14} />}
                  size="sm"
                  color="red"
                  variant="light"
                  onClick={() => ai.abort()}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  leftSection={<IconWand size={14} />}
                  size="sm"
                  color={audienceMeta.color}
                  onClick={runPolish}
                  disabled={!draft.trim()}
                >
                  Polish email
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
                py="sm"
                style={{
                  borderBottom: "1px solid var(--mantine-color-dark-4)",
                  background: `var(--mantine-color-${audienceMeta.color}-9)`,
                  opacity: 0.95,
                }}
              >
                <Group justify="space-between" wrap="nowrap" gap="sm">
                  <Group gap="xs" wrap="nowrap">
                    <ThemeIcon
                      size="sm"
                      radius="sm"
                      variant="light"
                      color={audienceMeta.color}
                    >
                      <audienceMeta.icon size={12} />
                    </ThemeIcon>
                    <Text fw={600} size="sm" c="bright">
                      Polished email — {audienceMeta.label}
                    </Text>
                  </Group>
                  {viewing && (
                    <Badge size="xs" variant="light" color="gray">
                      from history · {formatDateTime(new Date(viewing.created_at as unknown as string))}
                    </Badge>
                  )}
                </Group>
              </Box>

              <Box p="md" style={{ minHeight: 340 }}>
                {!display.body && !ai.isLoading ? (
                  <Stack gap="xs" align="center" py="xl">
                    <ThemeIcon
                      size={48}
                      radius="xl"
                      variant="light"
                      color={audienceMeta.color}
                    >
                      <IconWand size={22} />
                    </ThemeIcon>
                    <Text size="sm" c="dimmed" ta="center">
                      Paste a draft on the left, pick the audience, and click{" "}
                      <b>Polish email</b>.
                    </Text>
                    <Text size="xs" c="dimmed" ta="center" maw={420}>
                      The AI will rewrite for the audience — translating jargon for
                      customers, keeping it terse for internal coworkers, or
                      structuring concrete asks for carriers.
                    </Text>
                  </Stack>
                ) : (
                  <Stack gap="md">
                    {display.subject && (
                      <Box>
                        <Group justify="space-between" wrap="nowrap" gap="xs">
                          <Box style={{ minWidth: 0 }}>
                            <Text c="dimmed" tt="uppercase" fw={700} size="xs">
                              Subject
                            </Text>
                            <Text fw={600} size="sm" mt={2}>
                              {display.subject}
                            </Text>
                          </Box>
                          <Tooltip label="Copy subject">
                            <ActionIcon
                              size="md"
                              variant="subtle"
                              onClick={() =>
                                copyToClipboard(display.subject, "subj", "Subject copied")
                              }
                              aria-label="Copy subject"
                            >
                              {copiedKey === "subj" ? (
                                <IconCheck size={14} />
                              ) : (
                                <IconCopy size={14} />
                              )}
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Box>
                    )}
                    <Box>
                      <Group justify="space-between" wrap="nowrap" mb={4}>
                        <Text c="dimmed" tt="uppercase" fw={700} size="xs">
                          Body
                        </Text>
                        <Group gap={4}>
                          <Tooltip label="Copy body (markdown)">
                            <ActionIcon
                              size="md"
                              variant="subtle"
                              onClick={() =>
                                copyToClipboard(display.body, "body", "Body copied")
                              }
                              aria-label="Copy body"
                            >
                              {copiedKey === "body" ? (
                                <IconCheck size={14} />
                              ) : (
                                <IconCopy size={14} />
                              )}
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Copy full email (subject + body, plain text)">
                            <ActionIcon
                              size="md"
                              variant="filled"
                              color={audienceMeta.color}
                              onClick={() =>
                                copyToClipboard(
                                  `Subject: ${display.subject}\n\n${markdownToPlainText(display.body)}`,
                                  "all",
                                  "Full email copied",
                                )
                              }
                              aria-label="Copy full email"
                            >
                              {copiedKey === "all" ? (
                                <IconCheck size={14} />
                              ) : (
                                <IconCopy size={14} />
                              )}
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Group>
                      <Box className="ai-markdown">
                        <ReactMarkdown>{display.body}</ReactMarkdown>
                      </Box>
                      {ai.isLoading && (
                        <Group gap={6} mt="xs">
                          <Loader size="xs" color={audienceMeta.color} />
                          <Text size="xs" c="dimmed" fs="italic">
                            Polishing…
                          </Text>
                        </Group>
                      )}
                    </Box>
                  </Stack>
                )}
                {ai.error && (
                  <Alert
                    icon={<IconAlertCircle size={14} />}
                    color="red"
                    variant="light"
                    radius="sm"
                    mt="sm"
                  >
                    {ai.error}
                  </Alert>
                )}
              </Box>
            </Card>

            {/* History */}
            <Card radius="md" withBorder p="md">
              <Group justify="space-between" mb="xs">
                <Group gap={6}>
                  <IconHistory size={14} />
                  <Text fw={600} size="sm">
                    Recent polished emails
                  </Text>
                </Group>
                <Badge size="xs" variant="default">
                  {emails.length}
                </Badge>
              </Group>
              {emails.length === 0 ? (
                <Text size="xs" c="dimmed" fs="italic">
                  Nothing yet. Polished emails appear here automatically.
                </Text>
              ) : (
                <ScrollArea h={220} type="auto">
                  <Stack gap={4}>
                    {emails.map((e) => {
                      const meta = AUDIENCE_META[e.audience as Audience] ?? AUDIENCE_META.internal;
                      const Icon = meta.icon;
                      return (
                        <Group
                          key={e.id}
                          justify="space-between"
                          wrap="nowrap"
                          gap={6}
                          p={6}
                          style={{
                            borderRadius: 6,
                            cursor: "pointer",
                            background:
                              viewing?.id === e.id
                                ? "var(--mantine-color-dark-5)"
                                : "transparent",
                          }}
                          onClick={() => loadEmail(e)}
                        >
                          <Box style={{ minWidth: 0, flex: 1 }}>
                            <Group gap={6} wrap="nowrap" align="center">
                              <Badge
                                size="xs"
                                variant="light"
                                color={meta.color}
                                leftSection={<Icon size={9} />}
                              >
                                {meta.label}
                              </Badge>
                              {e.ticket_number && (
                                <Badge size="xs" variant="default">
                                  #{e.ticket_number}
                                </Badge>
                              )}
                              <Text size="xs" c="dimmed">
                                {formatDateTime(new Date(e.created_at as unknown as string))}
                              </Text>
                            </Group>
                            <Text size="xs" truncate fw={500} mt={2}>
                              {e.subject ?? "(no subject)"}
                            </Text>
                          </Box>
                          <Tooltip label="Delete">
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              color="red"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                deleteEmail(e.id);
                              }}
                              aria-label="Delete polished email"
                            >
                              <IconTrash size={12} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      );
                    })}
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
