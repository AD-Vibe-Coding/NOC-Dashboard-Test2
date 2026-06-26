import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  Loader,
  Modal,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowBackUp,
  IconBuildingBroadcastTower,
  IconCheck,
  IconClipboard,
  IconCopy,
  IconHistory,
  IconMail,
  IconPlayerStop,
  IconRefresh,
  IconReplace,
  IconSparkles,
  IconTrash,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import { db } from "../../db";
import { useCompletion } from "../../lib/devs-ai/use-completion";
import { formatDateTime } from "../../lib/format";
import { useIdentity } from "../../lib/identity";
import {
  availableLevels,
  buildMailtoUrl,
  matchCarrierFromNotes,
  splitContactsForEmail,
  type CarrierMatch,
} from "../../lib/carrier-match";
import type { CarrierEscalation, EscalationContact } from "../../lib/confluence";
import { extractCarrierImages } from "../../lib/confluence";
import { useEscalations } from "../Escalations/data";
import { WidgetFrame } from "../WidgetFrame";
import { EmailAssistantTile } from "./Tile";
import {
  buildQualityChecks,
  createDiffLines,
  extractStructuredContext,
  findMissingFields,
  generateSubjectSuggestions,
  makeOutlookFriendlyEmail,
  markdownToPlainText,
  normalizeSourceText,
  splitSubjectBody,
  type AssistantMode,
  type Audience,
  type EscalationVariantKey,
  type OutputVariantKey,
} from "./helpers";
import { type EscalationDraft, type PolishedEmail, useEscalationDrafts, usePolishedEmails } from "./data";

export { EmailAssistantTile };

type OutputVariant = {
  key: OutputVariantKey;
  title: string;
  color: string;
  icon: ComponentType<{ size?: number; color?: string }>;
  audience?: Audience;
  badge: string;
  subject: string;
  body: string;
  to?: string[];
  cc?: string[];
  mailtoUrl?: string | null;
};

type Toast = {
  id: number;
  color: "green" | "red" | "blue";
  title: string;
  body?: string;
};

type RefineTone = "shorter" | "firmer" | "clearer" | "empathetic" | "technical" | "executive";

type OutputRecord = { subject: string; body: string };

type RefinementOption = {
  value: RefineTone;
  label: string;
};

type PendingGenerateAction = "escalation-all" | "escalation-selected" | "polish-all" | "polish-selected" | null;

type SubjectPreset = { label: string; build: (context: ReturnType<typeof extractStructuredContext>) => string };

const ESCALATION_VARIANTS: Array<{ key: EscalationVariantKey; title: string; color: string; icon: ComponentType<{ size?: number; color?: string }>; badge: string }> = [
  { key: "carrier", title: "Carrier draft", color: "teal", icon: IconBuildingBroadcastTower, badge: "External" },
  { key: "internal", title: "ESC-MGR alert", color: "violet", icon: IconUsers, badge: "Internal" },
  { key: "customer", title: "Customer update", color: "cyan", icon: IconUser, badge: "Customer" },
  { key: "executive", title: "Executive summary", color: "orange", icon: IconSparkles, badge: "Leadership" },
];

const POLISH_VARIANTS: Array<{ key: Audience; title: string; color: string; icon: ComponentType<{ size?: number; color?: string }>; badge: string }> = [
  { key: "customer", title: "Customer email", color: "cyan", icon: IconUser, badge: "Customer" },
  { key: "internal", title: "Internal email", color: "violet", icon: IconUsers, badge: "Internal" },
  { key: "carrier", title: "Carrier email", color: "orange", icon: IconBuildingBroadcastTower, badge: "Carrier" },
];

const TONE_OPTIONS = [
  { value: "neutral", label: "Neutral" },
  { value: "apologetic", label: "Apologetic" },
  { value: "reassuring", label: "Reassuring" },
  { value: "firm", label: "Firm" },
];

const LENGTH_OPTIONS = [
  { value: "concise", label: "Concise" },
  { value: "standard", label: "Standard" },
  { value: "detailed", label: "Detailed" },
];

const RECIPIENT_PROFILES = [
  { value: "technical-customer", label: "Technical customer" },
  { value: "executive-customer", label: "Executive customer" },
  { value: "field-tech", label: "Field technician" },
  { value: "carrier-noc", label: "Carrier NOC" },
  { value: "internal-manager", label: "Internal manager" },
];

const ESCALATION_INTENTS = [
  { value: "initial-escalation", label: "Initial escalation" },
  { value: "follow-up-update", label: "Follow-up update" },
  { value: "eta-request", label: "ETA request" },
  { value: "dispatch-follow-up", label: "Dispatch follow-up" },
  { value: "monitoring-update", label: "Monitoring update" },
];

const POLISH_INTENTS = [
  { value: "status-update", label: "Status update" },
  { value: "customer-reassurance", label: "Customer reassurance" },
  { value: "closure", label: "Closure / resolution" },
  { value: "eta-request", label: "ETA request" },
  { value: "follow-up", label: "Follow-up" },
];

const SUBJECT_PRESETS: SubjectPreset[] = [
  { label: "Customer Impact", build: (ctx) => `${ctx.customerName || "Customer"} | ${ctx.impact || "Service impact"}` },
  { label: "ETA Request", build: (ctx) => `${ctx.customerName || "Customer"} | ETA request | ${ctx.ticketNumber || "[Ticket #]"}` },
  { label: "Dispatch Update", build: (ctx) => `${ctx.customerName || "Customer"} | Dispatch update | ${ctx.site || "Site"}` },
  { label: "Monitoring Update", build: (ctx) => `${ctx.customerName || "Customer"} | Monitoring update | ${ctx.ticketNumber || "[Ticket #]"}` },
  { label: "Escalation Request", build: (ctx) => `${ctx.customerName || "Customer"} | Escalation request | ${ctx.ticketNumber || "[Ticket #]"}` },
];

const REFINEMENT_OPTIONS: RefinementOption[] = [
  { value: "shorter", label: "Shorter" },
  { value: "firmer", label: "Firmer" },
  { value: "clearer", label: "Clearer" },
  { value: "empathetic", label: "Empathetic" },
  { value: "technical", label: "More technical" },
  { value: "executive", label: "Executive summary" },
];

const SNIPPETS = [
  "We are actively engaging the carrier and will share the next update as soon as it is available.",
  "At this time, service remains impacted while investigation continues.",
  "Please confirm receipt and advise the current ETA or dispatch status.",
  "No additional customer action is required at this time.",
  "We will provide the next update by [time].",
  "Monitoring remains in place and we are tracking for stability.",
];

const ESC_INTERNAL_PROMPT = `You are an experienced NOC technician at AppDirect drafting an internal escalation email to the carrier-escalation team.
Return markdown that starts with \"Subject:\" followed by a blank line and the email body.
Use these sections in order when relevant: Current Investigation Status, Latest Update, Escalation Level, Customer Feedback.
Keep the tone factual, concise, and operationally useful.`;

const ESC_OUTBOUND_PROMPT = `You are an experienced NOC technician at AppDirect drafting an outbound escalation email to a telecommunications carrier.
Return markdown that starts with \"Subject:\" followed by a blank line and the email body.
Be polite but firm. Include a Reference section, current status, and a concrete \"What we need from you\" section.`;

const CUSTOMER_PROMPT = `You are a senior NOC technician at AppDirect writing a polished email to a customer.
Return markdown that starts with \"Subject:\" followed by a blank line and the email body.
Use plain English, acknowledge impact, avoid heavy jargon, and include the next update time or cadence.`;

const POLISH_INTERNAL_PROMPT = `You are a senior NOC technician at AppDirect writing a polished email to an internal team.
Return markdown that starts with \"Subject:\" followed by a blank line and the email body.
Be concise, action-oriented, and feel free to use short bullet points.`;

const CARRIER_PROMPT = `You are a senior NOC technician at AppDirect writing a polished email to a wholesale carrier.
Return markdown that starts with \"Subject:\" followed by a blank line and the email body.
Be specific, firm, and ask for concrete carrier actions, ETA, or dispatch confirmation.`;

const EXEC_PROMPT = `You are a senior NOC technician at AppDirect drafting a brief executive summary email.
Return markdown that starts with \"Subject:\" followed by a blank line and the email body.
Use 3-5 short paragraphs or bullets summarizing impact, status, risk, and next update timing in non-technical language.`;

const PROMPTS: Record<Audience, string> = {
  customer: CUSTOMER_PROMPT,
  internal: POLISH_INTERNAL_PROMPT,
  carrier: CARRIER_PROMPT,
};

function carrierStyleGuidance(carrierName: string) {
  const lower = carrierName.toLowerCase();
  if (lower.includes("lumen")) return "Mention circuit or carrier case identifiers prominently and ask for dispatch / ETA specificity.";
  if (lower.includes("at&t") || lower.includes("att")) return "Keep the note concise and clearly state requested action, impact, and target update cadence.";
  if (lower.includes("spectrum") || lower.includes("charter")) return "Call out site/location and whether service is hard down or degraded.";
  if (lower.includes("verizon")) return "Emphasize ticket identifiers, tests completed, and the expected next action from Verizon.";
  if (lower.includes("comcast")) return "Lead with impact, then request ETA and ticket/dispatch confirmation.";
  return "Keep carrier communication direct, specific, and operationally actionable.";
}

function SectionCard({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card radius="lg" withBorder p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Box style={{ minWidth: 0 }}>
            <Text fw={600} size="sm">{title}</Text>
            {description ? <Text size="xs" c="dimmed" mt={2}>{description}</Text> : null}
          </Box>
          {action}
        </Group>
        {children}
      </Stack>
    </Card>
  );
}

function ToastStack({ toasts, onClose }: { toasts: Toast[]; onClose: (id: number) => void }) {
  return (
    <Box style={{ position: "fixed", top: 76, right: 16, zIndex: 1000, display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
      {toasts.map((toast) => (
        <Alert
          key={toast.id}
          color={toast.color}
          icon={toast.color === "red" ? <IconAlertCircle size={16} /> : <IconSparkles size={16} />}
          title={toast.title}
          variant="filled"
          radius="md"
          withCloseButton
          onClose={() => onClose(toast.id)}
        >
          {toast.body}
        </Alert>
      ))}
    </Box>
  );
}

function CopyActions({
  subject,
  body,
  onCopy,
  to = [],
  cc = [],
}: {
  subject: string;
  body: string;
  onCopy: (text: string, title: string, body?: string) => void;
  to?: string[];
  cc?: string[];
}) {
  const plainText = markdownToPlainText(body);
  const full = [
    to.length ? `To: ${to.join(", ")}` : "",
    cc.length ? `Cc: ${cc.join(", ")}` : "",
    `Subject: ${subject}`,
    "",
    body,
  ].filter(Boolean).join("\n");
  const outlook = makeOutlookFriendlyEmail(subject, body, [
    to.length ? `To: ${to.join(", ")}` : "",
    cc.length ? `Cc: ${cc.join(", ")}` : "",
  ]);

  return (
    <Group gap={6} wrap="wrap">
      <Button size="compact-xs" variant="light" leftSection={<IconCopy size={12} />} onClick={() => onCopy(subject, "Subject copied")}>Subject</Button>
      <Button size="compact-xs" variant="light" leftSection={<IconClipboard size={12} />} onClick={() => onCopy(body, "Body copied")}>Body</Button>
      <Button size="compact-xs" variant="light" leftSection={<IconClipboard size={12} />} onClick={() => onCopy(full, "Full email copied")}>Full email</Button>
      <Button size="compact-xs" variant="light" leftSection={<IconClipboard size={12} />} onClick={() => onCopy(plainText, "Plain text copied")}>Plain text</Button>
      <Button size="compact-xs" variant="light" leftSection={<IconMail size={12} />} onClick={() => onCopy(outlook, "Outlook-friendly copy ready")}>Outlook</Button>
    </Group>
  );
}

function ContactPreview({ carrier, contactSplit }: { carrier: CarrierEscalation; contactSplit: ReturnType<typeof splitContactsForEmail> | null }) {
  if (!contactSplit) return null;
  const totalWithEmail = contactSplit.to.length + contactSplit.cc.length;
  if (totalWithEmail === 0) {
    return (
      <Alert icon={<IconAlertCircle size={14} />} color="yellow" variant="light" radius="sm">
        <Text size="xs">{carrier.contacts.length > 0 ? "Contacts exist, but none are eligible for the current level cutoff." : "No carrier contacts with email are available yet."}</Text>
      </Alert>
    );
  }
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
      <Box>
        <Text c="dimmed" tt="uppercase" fw={700} style={{ fontSize: 10 }} mb={4}>To · {contactSplit.to.length}</Text>
        <Stack gap={4}>{contactSplit.to.map((contact, i) => <ContactLine key={`to-${i}`} contact={contact} primary />)}</Stack>
      </Box>
      <Box>
        <Text c="dimmed" tt="uppercase" fw={700} style={{ fontSize: 10 }} mb={4}>Cc · {contactSplit.cc.length}</Text>
        <Stack gap={4}>{contactSplit.cc.map((contact, i) => <ContactLine key={`cc-${i}`} contact={contact} />)}</Stack>
      </Box>
    </SimpleGrid>
  );
}

function ContactLine({ contact, primary = false }: { contact: EscalationContact; primary?: boolean }) {
  return (
    <Group gap={6} wrap="nowrap" align="baseline">
      <Badge size="xs" variant="light" color={primary ? "teal" : "gray"}>{contact.level}</Badge>
      <Box style={{ minWidth: 0, flex: 1 }}>
        {contact.name ? <Text size="xs" fw={500} truncate>{contact.name}</Text> : null}
        {contact.email ? <Text size="xs" c="dimmed" style={{ wordBreak: "break-all" }}>{contact.email}</Text> : null}
      </Box>
    </Group>
  );
}

function OutputCard({
  output,
  loading,
  onCopy,
  onSubjectChange,
}: {
  output: OutputVariant;
  loading: boolean;
  onCopy: (text: string, title: string, body?: string) => void;
  onSubjectChange: (value: string) => void;
}) {
  const hasContent = Boolean(output.subject || output.body || loading);
  return (
    <Card radius="lg" withBorder p={0}>
      <Box px="md" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-dark-4)", background: `var(--mantine-color-${output.color}-9)` }}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon size="sm" radius="sm" variant="light" color={output.color}><output.icon size={12} /></ThemeIcon>
            <Text fw={600} size="sm">{output.title}</Text>
            <Badge size="xs" variant="light" color={output.color}>{output.badge}</Badge>
          </Group>
          {loading ? <Loader size="xs" color={output.color} /> : null}
        </Group>
      </Box>
      {!hasContent ? (
        <Box p="xl"><Text size="sm" c="dimmed">Generate this variant to see a draft here.</Text></Box>
      ) : (
        <Stack gap={0}>
          <Box p="md" style={{ borderBottom: "1px solid var(--mantine-color-dark-4)", background: "var(--mantine-color-dark-7)" }}>
            <Stack gap="xs">
              {output.to?.length ? <Text size="xs" c="dimmed">To: {output.to.join(", ")}</Text> : null}
              {output.cc?.length ? <Text size="xs" c="dimmed">Cc: {output.cc.join(", ")}</Text> : null}
              <TextInput label="Subject" value={output.subject} onChange={(event) => onSubjectChange(event.currentTarget.value)} size="sm" />
            </Stack>
          </Box>
          <Box p="md">
            <Stack gap="sm">
              <CopyActions subject={output.subject} body={output.body} to={output.to} cc={output.cc} onCopy={onCopy} />
              {output.mailtoUrl ? (
                <Button component="a" href={output.mailtoUrl} variant="light" color={output.color} leftSection={<IconMail size={14} />}>
                  Open in mail
                </Button>
              ) : null}
              <Divider />
              <Box className="ai-markdown" style={{ lineHeight: 1.6, fontSize: 14 }}>
                {output.body ? <ReactMarkdown>{output.body}</ReactMarkdown> : <Text size="sm" c="dimmed">{loading ? "Generating…" : "—"}</Text>}
              </Box>
            </Stack>
          </Box>
        </Stack>
      )}
    </Card>
  );
}

function DiffPanel({ previousText, currentText }: { previousText: string; currentText: string }) {
  const lines = useMemo(() => createDiffLines(previousText, currentText), [previousText, currentText]);
  if (!previousText || !currentText) {
    return <Text size="xs" c="dimmed">Generate or restore another version to compare changes.</Text>;
  }
  return (
    <ScrollArea h={220}>
      <Stack gap={4}>
        {lines.length === 0 ? <Text size="xs" c="dimmed">No meaningful differences yet.</Text> : null}
        {lines.map((line, index) => (
          <Box
            key={`${line.type}-${index}`}
            px="xs"
            py={4}
            style={{
              borderRadius: 6,
              background:
                line.type === "added" ? "rgba(46, 160, 67, 0.18)"
                : line.type === "removed" ? "rgba(248, 81, 73, 0.15)"
                : line.type === "changed" ? "rgba(210, 153, 34, 0.14)"
                : "transparent",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 12,
            }}
          >
            {line.text}
          </Box>
        ))}
      </Stack>
    </ScrollArea>
  );
}

function HistoryPanel<T>({
  title,
  rows,
  count,
  renderMeta,
  renderTitle,
  onLoad,
  onDuplicate,
  onCompare,
  onDelete,
}: {
  title: string;
  rows: T[];
  count: number;
  renderMeta: (row: T) => ReactNode;
  renderTitle: (row: T) => string;
  onLoad: (row: T) => void;
  onDuplicate: (row: T) => void;
  onCompare: (row: T) => void;
  onDelete: (row: T) => void;
}) {
  return (
    <SectionCard title={title} action={<Badge size="xs" variant="default">{count}</Badge>}>
      {rows.length === 0 ? (
        <Text size="xs" c="dimmed" fs="italic">Nothing saved yet.</Text>
      ) : (
        <ScrollArea h={250} type="auto">
          <Stack gap={6}>
            {rows.map((row, index) => (
              <Card key={index} withBorder radius="md" p="xs">
                <Stack gap={6}>
                  <Group gap={6} wrap="wrap">{renderMeta(row)}</Group>
                  <Text size="xs" fw={600} truncate>{renderTitle(row)}</Text>
                  <Group gap={6} wrap="wrap">
                    <Button size="compact-xs" variant="light" onClick={() => onLoad(row)}>Restore</Button>
                    <Button size="compact-xs" variant="light" leftSection={<IconArrowBackUp size={12} />} onClick={() => onDuplicate(row)}>Duplicate</Button>
                    <Button size="compact-xs" variant="light" leftSection={<IconHistory size={12} />} onClick={() => onCompare(row)}>Compare</Button>
                    <ActionIcon size="sm" variant="subtle" color="red" onClick={() => onDelete(row)}><IconTrash size={13} /></ActionIcon>
                  </Group>
                </Stack>
              </Card>
            ))}
          </Stack>
        </ScrollArea>
      )}
    </SectionCard>
  );
}

export function EmailAssistantWidget() {
  const { identity } = useIdentity();
  const senderName = identity?.name ?? "";
  const { drafts, refresh: refreshDrafts } = useEscalationDrafts();
  const { emails, refresh: refreshEmails } = usePolishedEmails();
  const escalations = useEscalations();

  const [mode, setMode] = useState<AssistantMode>("escalation");
  const [selectedEscalationKey, setSelectedEscalationKey] = useState<EscalationVariantKey>("carrier");
  const [selectedPolishKey, setSelectedPolishKey] = useState<Audience>("customer");
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState("");
  const [ticketNumber, setTicketNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [carrierTicket, setCarrierTicket] = useState("");
  const [site, setSite] = useState("");
  const [eta, setEta] = useState("");
  const [nextUpdate, setNextUpdate] = useState("");
  const [impact, setImpact] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [concreteAsk, setConcreteAsk] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientProfile, setRecipientProfile] = useState("technical-customer");
  const [carrierOverride, setCarrierOverride] = useState<string | null>(null);
  const [maxLevel, setMaxLevel] = useState<number | null>(2);
  const [tone, setTone] = useState("neutral");
  const [length, setLength] = useState("standard");
  const [escalationIntent, setEscalationIntent] = useState("initial-escalation");
  const [polishIntent, setPolishIntent] = useState("status-update");
  const [selectedRefinement, setSelectedRefinement] = useState<RefineTone>("shorter");
  const [refinementModalOpened, setRefinementModalOpened] = useState(false);
  const [pendingGenerateAction, setPendingGenerateAction] = useState<PendingGenerateAction>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [outputs, setOutputs] = useState<Record<string, OutputRecord>>({});
  const [outputVersions, setOutputVersions] = useState<Record<string, string[]>>({});
  const [compareBaseline, setCompareBaseline] = useState("");
  const [viewingOutbound, setViewingOutbound] = useState<EscalationDraft | null>(null);
  const [viewingInternal, setViewingInternal] = useState<EscalationDraft | null>(null);
  const [viewingPolish, setViewingPolish] = useState<PolishedEmail | null>(null);
  const [extractedContacts, setExtractedContacts] = useState<Map<string, EscalationContact[]>>(new Map());
  const [extracting, setExtracting] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  const carrierAi = useCompletion();
  const internalAi = useCompletion();
  const customerAi = useCompletion();
  const executiveAi = useCompletion();
  const polishCustomerAi = useCompletion();
  const polishInternalAi = useCompletion();
  const polishCarrierAi = useCompletion();
  const refineAi = useCompletion();

  const sourceText = mode === "escalation" ? notes : draft;
  const normalizedSource = useMemo(() => normalizeSourceText(sourceText), [sourceText]);
  const extractedContext = useMemo(() => extractStructuredContext(normalizedSource), [normalizedSource]);
  const mergedContext = useMemo(() => ({
    ...extractedContext,
    ticketNumber: ticketNumber || extractedContext.ticketNumber,
    customerName: customerName || extractedContext.customerName,
    carrierTicket: carrierTicket || extractedContext.carrierTicket,
    site: site || extractedContext.site,
    eta: eta || extractedContext.eta,
    nextUpdate: nextUpdate || extractedContext.nextUpdate,
    impact: impact || extractedContext.impact,
    serviceType: serviceType || extractedContext.serviceType,
    ask: concreteAsk || extractedContext.ask,
  }), [carrierTicket, concreteAsk, customerName, eta, extractedContext, impact, nextUpdate, serviceType, site, ticketNumber]);
  const missingFields = useMemo(() => findMissingFields(mergedContext, mode), [mergedContext, mode]);

  const autoMatch: CarrierMatch | null = useMemo(() => {
    if (!escalations.data?.carriers) return null;
    return matchCarrierFromNotes(normalizedSource, escalations.data.carriers);
  }, [normalizedSource, escalations.data]);

  const effectiveCarrier = useMemo(() => {
    const all = escalations.data?.carriers ?? [];
    if (carrierOverride) return all.find((carrier) => carrier.id === carrierOverride) ?? null;
    return autoMatch?.carrier ?? null;
  }, [autoMatch, carrierOverride, escalations.data]);

  useEffect(() => {
    if (!effectiveCarrier) return;
    if (effectiveCarrier.contacts.length > 0) return;
    if (extractedContacts.has(effectiveCarrier.id)) return;
    if (extracting === effectiveCarrier.id) return;

    const carrierId = effectiveCarrier.id;
    setExtracting(carrierId);
    setExtractError(null);
    extractCarrierImages(carrierId, { carrierName: effectiveCarrier.carrier })
      .then((result) => {
        setExtractedContacts((prev) => {
          const next = new Map(prev);
          next.set(carrierId, result.contacts ?? []);
          return next;
        });
      })
      .catch((error) => {
        setExtractError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setExtracting(null));
  }, [effectiveCarrier, extractedContacts, extracting]);

  const carrierWithContacts = useMemo(() => {
    if (!effectiveCarrier) return null;
    if (effectiveCarrier.contacts.length > 0) return effectiveCarrier;
    const extracted = extractedContacts.get(effectiveCarrier.id);
    return extracted ? { ...effectiveCarrier, contacts: extracted } : effectiveCarrier;
  }, [effectiveCarrier, extractedContacts]);

  const contactSplit = useMemo(() => {
    if (!carrierWithContacts) return null;
    return splitContactsForEmail(carrierWithContacts.contacts, maxLevel ?? undefined);
  }, [carrierWithContacts, maxLevel]);

  const carrierLevels = useMemo(() => {
    if (!carrierWithContacts) return [];
    return availableLevels(carrierWithContacts.contacts);
  }, [carrierWithContacts]);

  const carrierOptions = useMemo(() => {
    const carriers = escalations.data?.carriers ?? [];
    return carriers.map((carrier) => ({
      value: carrier.id,
      label: `${carrier.carrier}${carrier.contacts.length > 0 ? ` (${carrier.contacts.length} contacts)` : ""}`,
    }));
  }, [escalations.data]);

  function showToast(toast: Omit<Toast, "id">) {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 3000);
  }

  async function copyToClipboard(text: string, title: string, body?: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast({ color: "green", title, body });
    } catch {
      showToast({ color: "red", title: "Copy failed", body: "Clipboard access was blocked by the browser." });
    }
  }

  function updateOutput(key: string, next: OutputRecord) {
    setOutputs((prev) => ({ ...prev, [key]: next }));
    setOutputVersions((prev) => ({
      ...prev,
      [key]: [...(prev[key] ?? []), `Subject: ${next.subject}\n\n${next.body}`].slice(-8),
    }));
  }

  function updateOutputSubject(key: string, subject: string) {
    setOutputs((prev) => ({
      ...prev,
      [key]: { subject, body: prev[key]?.body ?? "" },
    }));
  }

  function applySnippet(snippet: string) {
    if (mode === "escalation") {
      setNotes((prev) => `${prev.trim()}${prev.trim() ? "\n" : ""}${snippet}`);
    } else {
      setDraft((prev) => `${prev.trim()}${prev.trim() ? "\n" : ""}${snippet}`);
    }
  }

  function fillMissingField(key: string, value: string) {
    if (!value) return;
    if (key === "ticketNumber") setTicketNumber(value);
    if (key === "customerName") setCustomerName(value);
    if (key === "carrierTicket") setCarrierTicket(value);
    if (key === "site") setSite(value);
    if (key === "eta") setEta(value);
    if (key === "nextUpdate") setNextUpdate(value);
    if (key === "impact") setImpact(value);
    if (key === "serviceType") setServiceType(value);
    if (key === "ask") setConcreteAsk(value);
  }

  function resetAll() {
    setNotes("");
    setDraft("");
    setTicketNumber("");
    setCustomerName("");
    setCarrierTicket("");
    setSite("");
    setEta("");
    setNextUpdate("");
    setImpact("");
    setServiceType("");
    setConcreteAsk("");
    setRecipientName("");
    setSelectedRefinement("shorter");
    setRefinementModalOpened(false);
    setPendingGenerateAction(null);
    setOutputs({});
    setOutputVersions({});
    setCompareBaseline("");
    setViewingOutbound(null);
    setViewingInternal(null);
    setViewingPolish(null);
    carrierAi.setResult("");
    internalAi.setResult("");
    customerAi.setResult("");
    executiveAi.setResult("");
    polishCustomerAi.setResult("");
    polishInternalAi.setResult("");
    polishCarrierAi.setResult("");
    refineAi.setResult("");
  }

  function buildSharedContextLines() {
    const lines: string[] = [];
    if (mergedContext.ticketNumber) lines.push(`AppDirect ticket #: ${mergedContext.ticketNumber}`);
    if (mergedContext.customerName) lines.push(`Customer name: ${mergedContext.customerName}`);
    if (mergedContext.carrierTicket) lines.push(`Carrier ticket / circuit: ${mergedContext.carrierTicket}`);
    if (mergedContext.site) lines.push(`Site/location: ${mergedContext.site}`);
    if (mergedContext.eta) lines.push(`ETA: ${mergedContext.eta}`);
    if (mergedContext.nextUpdate) lines.push(`Next update cadence: ${mergedContext.nextUpdate}`);
    if (mergedContext.impact) lines.push(`Customer impact: ${mergedContext.impact}`);
    if (mergedContext.serviceType) lines.push(`Service type: ${mergedContext.serviceType}`);
    if (mergedContext.ask) lines.push(`Concrete ask: ${mergedContext.ask}`);
    if (recipientName.trim()) lines.push(`Recipient / greeting: ${recipientName.trim()}`);
    if (senderName.trim()) lines.push(`Sender name: ${senderName.trim()}`);
    lines.push(`Recipient profile: ${recipientProfile}`);
    return lines;
  }

  async function runEscalationVariant(key: EscalationVariantKey) {
    if (!normalizedSource.trim()) {
      showToast({ color: "red", title: "Paste investigation notes first" });
      return;
    }

    const refinementInstruction = REFINEMENT_OPTIONS.find((option) => option.value === selectedRefinement)?.label ?? "Shorter";
    const shared = buildSharedContextLines();
    const carrierName = carrierWithContacts?.carrier ?? "Carrier";
    const toLine = (contactSplit?.to ?? []).map((contact) => `${contact.name ?? contact.email} <${contact.email}>`).filter(Boolean).join(", ");
    const ccLine = (contactSplit?.cc ?? []).map((contact) => `${contact.name ?? contact.email} <${contact.email}>`).filter(Boolean).join(", ");
    const intentLabel = ESCALATION_INTENTS.find((option) => option.value === escalationIntent)?.label ?? escalationIntent;

    const promptBase = [
      ...shared,
      `Escalation intent: ${intentLabel}`,
      `Preferred drafting refinement: ${refinementInstruction}`,
      `Carrier-specific guidance: ${carrierStyleGuidance(carrierName)}`,
      carrierWithContacts ? `Carrier: ${carrierName}` : "",
      toLine ? `Email To: ${toLine}` : "",
      ccLine ? `Email Cc: ${ccLine}` : "",
    ].filter(Boolean).map((line) => `- ${line}`).join("\n");

    const prompts: Record<EscalationVariantKey, string> = {
      carrier: `${ESC_OUTBOUND_PROMPT}\n\nKnown details:\n${promptBase}\n\nSource notes (normalized):\n${normalizedSource}`,
      internal: `${ESC_INTERNAL_PROMPT}\n\nKnown details:\n${promptBase}\n\nSource notes (normalized):\n${normalizedSource}`,
      customer: `${CUSTOMER_PROMPT}\n\nKnown details:\n${promptBase}\n\nThis is a customer-facing update generated from these notes:\n${normalizedSource}`,
      executive: `${EXEC_PROMPT}\n\nKnown details:\n${promptBase}\n\nThis executive summary is based on these notes:\n${normalizedSource}`,
    };

    const runners = {
      carrier: carrierAi,
      internal: internalAi,
      customer: customerAi,
      executive: executiveAi,
    } as const;

    const result = await runners[key].complete(prompts[key]);
    const parsed = splitSubjectBody(result);
    updateOutput(key, parsed);

    if (key === "carrier" || key === "internal") {
      await db.escalation_drafts.insert({
        ticket_number: mergedContext.ticketNumber || null,
        customer_name: mergedContext.customerName || null,
        service_provider: carrierWithContacts?.carrier ?? null,
        recipient: recipientName.trim() || null,
        sender_name: senderName || null,
        raw_notes: normalizedSource,
        subject: parsed.subject || null,
        body_markdown: parsed.body,
        mode: key === "carrier" ? "outbound" : "internal",
        to_emails: key === "carrier" && contactSplit ? contactSplit.to.map((contact) => contact.email).filter(Boolean).join(",") : null,
        cc_emails: key === "carrier" && contactSplit ? contactSplit.cc.map((contact) => contact.email).filter(Boolean).join(",") : null,
        carrier_id: carrierWithContacts?.id ?? null,
      });
      await refreshDrafts();
    }
  }

  async function runAllEscalationVariants() {
    await Promise.all(ESCALATION_VARIANTS.map((variant) => runEscalationVariant(variant.key)));
  }

  async function runPolishVariant(key: Audience) {
    if (!normalizedSource.trim()) {
      showToast({ color: "red", title: "Paste a rough draft first" });
      return;
    }

    const refinementInstruction = REFINEMENT_OPTIONS.find((option) => option.value === selectedRefinement)?.label ?? "Shorter";
    const intentLabel = POLISH_INTENTS.find((option) => option.value === polishIntent)?.label ?? polishIntent;
    const prompt = `${PROMPTS[key]}\n\nKnown details:\n${[
      `Recipient profile: ${recipientProfile}`,
      `Recipient name: ${recipientName || "[Recipient]"}`,
      `Customer/company: ${mergedContext.customerName || "[Customer]"}`,
      `Carrier: ${carrierWithContacts?.carrier || "[Carrier]"}`,
      `Ticket #: ${mergedContext.ticketNumber || "[Ticket #]"}`,
      `Intent: ${intentLabel}`,
      `Preferred drafting refinement: ${refinementInstruction}`,
      `Desired tone: ${tone}`,
      `Desired length: ${length}`,
      mergedContext.impact ? `Impact: ${mergedContext.impact}` : "",
      mergedContext.nextUpdate ? `Next update: ${mergedContext.nextUpdate}` : "",
      mergedContext.ask ? `Key ask: ${mergedContext.ask}` : "",
      senderName ? `Sender: ${senderName}` : "",
      `Carrier-specific guidance: ${carrierStyleGuidance(carrierWithContacts?.carrier ?? carrierOverride ?? "Carrier")}`,
    ].filter(Boolean).map((line) => `- ${line}`).join("\n")}\n\nRaw draft to polish:\n${normalizedSource}`;

    const runners = {
      customer: polishCustomerAi,
      internal: polishInternalAi,
      carrier: polishCarrierAi,
    } as const;

    const result = await runners[key].complete(prompt);
    const parsed = splitSubjectBody(result);
    updateOutput(key, parsed);
    await db.polished_emails.insert({
      audience: key,
      recipient_name: recipientName.trim() || null,
      customer_name: mergedContext.customerName || null,
      carrier_name: carrierWithContacts?.carrier ?? null,
      ticket_number: mergedContext.ticketNumber || null,
      sender_name: senderName || null,
      raw_draft: normalizedSource,
      subject: parsed.subject || null,
      body_markdown: parsed.body,
      tone,
      length,
    });
    await refreshEmails();
  }

  async function runAllPolishVariants() {
    await Promise.all(POLISH_VARIANTS.map((variant) => runPolishVariant(variant.key)));
  }

  function openRefinementModal(action: PendingGenerateAction) {
    setPendingGenerateAction(action);
    setRefinementModalOpened(true);
  }

  async function confirmGenerateWithRefinement() {
    if (!pendingGenerateAction) return;
    setRefinementModalOpened(false);

    if (pendingGenerateAction === "escalation-all") {
      await runAllEscalationVariants();
    } else if (pendingGenerateAction === "escalation-selected") {
      await runEscalationVariant(selectedEscalationKey);
    } else if (pendingGenerateAction === "polish-all") {
      await runAllPolishVariants();
    } else if (pendingGenerateAction === "polish-selected") {
      await runPolishVariant(selectedPolishKey);
    }

    setPendingGenerateAction(null);
  }

  async function refineCurrentOutput(style: RefineTone) {
    const current = activeOutput;
    if (!current.subject && !current.body) return;
    const instructions: Record<RefineTone, string> = {
      shorter: "Make the email shorter while preserving the key facts and asks.",
      firmer: "Make the tone firmer and more direct, but still professional.",
      clearer: "Improve clarity and readability for the intended audience.",
      empathetic: "Make the wording more empathetic and customer-friendly.",
      technical: "Make the message slightly more technical and operationally precise.",
      executive: "Rewrite this for executive readability in concise plain language.",
    };
    const prompt = `Refine this email. ${instructions[style]} Return markdown that starts with Subject: and then the body.\n\nCurrent email:\nSubject: ${current.subject}\n\n${current.body}`;
    const result = await refineAi.complete(prompt);
    const parsed = splitSubjectBody(result);
    updateOutput(current.key, parsed);
  }

  async function deleteDraft(id: number) {
    await db.escalation_drafts.deleteById(id);
    if (viewingOutbound?.id === id) setViewingOutbound(null);
    if (viewingInternal?.id === id) setViewingInternal(null);
    await refreshDrafts();
  }

  async function deleteEmail(id: number) {
    await db.polished_emails.deleteById(id);
    if (viewingPolish?.id === id) setViewingPolish(null);
    await refreshEmails();
  }

  function loadEscalationDraft(saved: EscalationDraft, duplicate = false) {
    setMode("escalation");
    setNotes(saved.raw_notes ?? "");
    setTicketNumber(saved.ticket_number ?? "");
    setCustomerName(saved.customer_name ?? "");
    setRecipientName(saved.recipient ?? "");
    setCarrierOverride(saved.carrier_id ?? null);
    const parsed = { subject: saved.subject ?? "", body: saved.body_markdown ?? "" };
    updateOutput(saved.mode === "internal" ? "internal" : "carrier", parsed);
    if (saved.mode === "internal") setSelectedEscalationKey("internal");
    else setSelectedEscalationKey("carrier");
    setCompareBaseline(`Subject: ${parsed.subject}\n\n${parsed.body}`);
    if (!duplicate) {
      if (saved.mode === "internal") setViewingInternal(saved);
      else setViewingOutbound(saved);
    } else {
      setViewingInternal(null);
      setViewingOutbound(null);
    }
  }

  function loadPolishedEmail(saved: PolishedEmail, duplicate = false) {
    setMode("polish");
    const audience = (saved.audience as Audience) ?? "customer";
    setSelectedPolishKey(audience);
    setRecipientName(saved.recipient_name ?? "");
    setCustomerName(saved.customer_name ?? "");
    setTicketNumber(saved.ticket_number ?? "");
    setTone(saved.tone ?? "neutral");
    setLength(saved.length ?? "standard");
    setDraft(saved.raw_draft ?? "");
    const parsed = { subject: saved.subject ?? "", body: saved.body_markdown ?? "" };
    updateOutput(audience, parsed);
    setCompareBaseline(`Subject: ${parsed.subject}\n\n${parsed.body}`);
    setViewingPolish(duplicate ? null : saved);
  }

  const escalationOutputs = useMemo<OutputVariant[]>(() => {
    return ESCALATION_VARIANTS.map((variant) => {
      const output = outputs[variant.key] ?? { subject: "", body: "" };
      const to = variant.key === "carrier" ? (contactSplit?.to.map((contact) => contact.email!).filter(Boolean) ?? []) : [];
      const cc = variant.key === "carrier" ? (contactSplit?.cc.map((contact) => contact.email!).filter(Boolean) ?? []) : [];
      const mailtoUrl = variant.key === "carrier" && to.length > 0
        ? buildMailtoUrl({ to, cc, subject: output.subject, body: markdownToPlainText(output.body) })
        : null;
      return { ...variant, ...output, to, cc, mailtoUrl };
    });
  }, [contactSplit, outputs]);

  const polishOutputs = useMemo<OutputVariant[]>(() => {
    return POLISH_VARIANTS.map((variant) => ({
      ...variant,
      ...((outputs[variant.key] ?? { subject: "", body: "" })),
      audience: variant.key,
      to: [],
      cc: [],
      mailtoUrl: null,
    }));
  }, [outputs]);

  const activeOutput = useMemo(() => {
    const list = mode === "escalation" ? escalationOutputs : polishOutputs;
    const key = mode === "escalation" ? selectedEscalationKey : selectedPolishKey;
    return list.find((item) => item.key === key) ?? list[0];
  }, [escalationOutputs, mode, polishOutputs, selectedEscalationKey, selectedPolishKey]);

  const activeLoading =
    (mode === "escalation" && (
      (selectedEscalationKey === "carrier" && carrierAi.isLoading) ||
      (selectedEscalationKey === "internal" && internalAi.isLoading) ||
      (selectedEscalationKey === "customer" && customerAi.isLoading) ||
      (selectedEscalationKey === "executive" && executiveAi.isLoading)
    )) ||
    (mode === "polish" && (
      (selectedPolishKey === "customer" && polishCustomerAi.isLoading) ||
      (selectedPolishKey === "internal" && polishInternalAi.isLoading) ||
      (selectedPolishKey === "carrier" && polishCarrierAi.isLoading)
    )) ||
    false;

  const qualityChecks = useMemo(() => buildQualityChecks({
    mode,
    audience: mode === "polish" ? selectedPolishKey : activeOutput.audience,
    subject: activeOutput?.subject ?? "",
    body: activeOutput?.body ?? "",
    context: mergedContext,
  }), [activeOutput, mergedContext, mode, selectedPolishKey]);

  const subjectSuggestions = useMemo(() => generateSubjectSuggestions({
    mode,
    audience: selectedPolishKey,
    customerName: mergedContext.customerName,
    ticketNumber: mergedContext.ticketNumber,
    carrierName: carrierWithContacts?.carrier,
    impact: mergedContext.impact,
    intentLabel: mode === "escalation"
      ? ESCALATION_INTENTS.find((item) => item.value === escalationIntent)?.label
      : POLISH_INTENTS.find((item) => item.value === polishIntent)?.label,
  }), [carrierWithContacts?.carrier, escalationIntent, mergedContext.customerName, mergedContext.impact, mergedContext.ticketNumber, mode, polishIntent, selectedPolishKey]);

  const currentVersions = outputVersions[activeOutput?.key ?? ""] ?? [];
  const previousVersion = currentVersions.length > 1 ? currentVersions[currentVersions.length - 2] : compareBaseline;
  const currentVersion = activeOutput ? `Subject: ${activeOutput.subject}\n\n${activeOutput.body}` : "";

  const globalBusy = [carrierAi, internalAi, customerAi, executiveAi, polishCustomerAi, polishInternalAi, polishCarrierAi, refineAi].some((item) => item.isLoading);

  return (
    <WidgetFrame
      title="NOC Email Assistant"
      subtitle="Generate escalation variants, polish emails, validate quality, and compare revisions in one workspace"
      icon={IconMail}
      iconColor="teal"
      loading={globalBusy}
      status={{ label: "AI", color: "teal", tooltip: "NOC-focused drafting, polishing, QA, and comparison" }}
      headerActions={
        <Tooltip label="Reset current workspace">
          <ActionIcon variant="subtle" onClick={resetAll}>
            <IconRefresh size={16} />
          </ActionIcon>
        </Tooltip>
      }
    >
      <ToastStack toasts={toasts} onClose={(id) => setToasts((prev) => prev.filter((item) => item.id !== id))} />

      <Modal
        opened={refinementModalOpened}
        onClose={() => {
          setRefinementModalOpened(false);
          setPendingGenerateAction(null);
        }}
        title="Choose drafting refinement"
        centered
        radius="lg"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Select the refinement style first. Drafting will begin only after you confirm.
          </Text>
          <Select
            label="Refinement"
            data={REFINEMENT_OPTIONS}
            value={selectedRefinement}
            onChange={(value) => setSelectedRefinement((value as RefineTone) ?? "shorter")}
            allowDeselect={false}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => {
              setRefinementModalOpened(false);
              setPendingGenerateAction(null);
            }}>
              Cancel
            </Button>
            <Button color={mode === "escalation" ? "teal" : "lime"} leftSection={<IconSparkles size={14} />} onClick={confirmGenerateWithRefinement}>
              Start drafting
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Stack gap="lg">
        <Card withBorder radius="lg" p="md" style={{ position: "sticky", top: 12, zIndex: 20, backdropFilter: "blur(10px)", background: "rgba(17, 24, 39, 0.88)" }}>
          <Group justify="space-between" align="flex-end" wrap="wrap">
            <Stack gap={8} style={{ flex: 1, minWidth: 260 }}>
              <Text fw={600}>Workflow</Text>
              <SegmentedControl
                fullWidth
                radius="md"
                color={mode === "escalation" ? "teal" : "lime"}
                value={mode}
                onChange={(value) => setMode(value as AssistantMode)}
                data={[
                  { value: "escalation", label: "Escalation Draft" },
                  { value: "polish", label: "Polish Existing Draft" },
                ]}
              />
            </Stack>
            <Group gap="xs" wrap="wrap">
              {mode === "escalation" ? (
                <>
                  <Button color="teal" leftSection={<IconSparkles size={14} />} onClick={() => openRefinementModal("escalation-all")} disabled={!normalizedSource.trim()}>
                    Generate all variants
                  </Button>
                  <Button variant="light" color="teal" onClick={() => openRefinementModal("escalation-selected")} disabled={!normalizedSource.trim()}>
                    Generate selected
                  </Button>
                </>
              ) : (
                <>
                  <Button color="lime" leftSection={<IconSparkles size={14} />} onClick={() => openRefinementModal("polish-all")} disabled={!normalizedSource.trim()}>
                    Generate all audiences
                  </Button>
                  <Button variant="light" color="lime" onClick={() => openRefinementModal("polish-selected")} disabled={!normalizedSource.trim()}>
                    Generate selected
                  </Button>
                </>
              )}
              {globalBusy ? (
                <Button
                  color="red"
                  variant="light"
                  leftSection={<IconPlayerStop size={14} />}
                  onClick={() => {
                    carrierAi.abort();
                    internalAi.abort();
                    customerAi.abort();
                    executiveAi.abort();
                    polishCustomerAi.abort();
                    polishInternalAi.abort();
                    polishCarrierAi.abort();
                    refineAi.abort();
                  }}
                >
                  Stop
                </Button>
              ) : null}
            </Group>
          </Group>
        </Card>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Stack gap="md">
              <SectionCard
                title="Input"
                description={mode === "escalation" ? "Paste raw investigation notes; normalization removes extra email clutter before drafting." : "Paste an existing rough draft to clean up, retarget, or adapt for different audiences."}
                action={<Badge size="xs" variant="light" color="gray">{sourceText.length.toLocaleString()} chars</Badge>}
              >
                <Textarea
                  value={mode === "escalation" ? notes : draft}
                  onChange={(event) => mode === "escalation" ? setNotes(event.currentTarget.value) : setDraft(event.currentTarget.value)}
                  placeholder={mode === "escalation" ? "Paste timeline, impact, troubleshooting, carrier notes, and next steps." : "Paste the rough email or handoff note you want polished."}
                  autosize
                  minRows={12}
                  maxRows={24}
                  styles={{ input: { fontFamily: "ui-monospace, SF Mono, Menlo, monospace", fontSize: 12 } }}
                />
                <Divider />
                <Stack gap={6}>
                  <Text size="xs" fw={600} c="dimmed">Reusable snippets</Text>
                  <Group gap={6} wrap="wrap">
                    {SNIPPETS.map((snippet) => (
                      <Button key={snippet} size="compact-xs" variant="light" onClick={() => applySnippet(snippet)}>{snippet.slice(0, 28)}…</Button>
                    ))}
                  </Group>
                </Stack>
              </SectionCard>

              <SectionCard title="Normalized source" description="Cleaner source text improves consistency before the AI prompt is built.">
                <ScrollArea h={140}>
                  <Text size="xs" style={{ whiteSpace: "pre-wrap", fontFamily: "ui-monospace, SF Mono, Menlo, monospace" }}>{normalizedSource || "Nothing to normalize yet."}</Text>
                </ScrollArea>
              </SectionCard>

              <SectionCard title="Context" description="Structured extraction + manual overrides power better drafts and fewer placeholders.">
                <Stack gap="xs">
                  <Group grow>
                    <TextInput label="Ticket #" size="xs" value={ticketNumber} onChange={(event) => setTicketNumber(event.currentTarget.value)} placeholder={extractedContext.ticketNumber || "574995"} />
                    <TextInput label="Customer" size="xs" value={customerName} onChange={(event) => setCustomerName(event.currentTarget.value)} placeholder={extractedContext.customerName || "ACME Corp"} />
                  </Group>
                  <Group grow>
                    <TextInput label="Carrier ticket / circuit" size="xs" value={carrierTicket} onChange={(event) => setCarrierTicket(event.currentTarget.value)} placeholder={extractedContext.carrierTicket || "Carrier ref"} />
                    <TextInput label="Site / location" size="xs" value={site} onChange={(event) => setSite(event.currentTarget.value)} placeholder={extractedContext.site || "Site / address"} />
                  </Group>
                  <Group grow>
                    <TextInput label="ETA" size="xs" value={eta} onChange={(event) => setEta(event.currentTarget.value)} placeholder={extractedContext.eta || "ETA"} />
                    <TextInput label="Next update by" size="xs" value={nextUpdate} onChange={(event) => setNextUpdate(event.currentTarget.value)} placeholder={extractedContext.nextUpdate || "Next update cadence"} />
                  </Group>
                  <TextInput label="Impact" size="xs" value={impact} onChange={(event) => setImpact(event.currentTarget.value)} placeholder={extractedContext.impact || "What is impacted?"} />
                  <Group grow>
                    <TextInput label="Service type" size="xs" value={serviceType} onChange={(event) => setServiceType(event.currentTarget.value)} placeholder={extractedContext.serviceType || "Service type"} />
                    <TextInput label="Concrete ask" size="xs" value={concreteAsk} onChange={(event) => setConcreteAsk(event.currentTarget.value)} placeholder={extractedContext.ask || "ETA / dispatch / confirmation"} />
                  </Group>
                  <Group grow>
                    <TextInput label="Recipient / greeting" size="xs" value={recipientName} onChange={(event) => setRecipientName(event.currentTarget.value)} placeholder="Sameer & Team" />
                    <TextInput label="Sender" size="xs" value={senderName} readOnly placeholder="Set your dashboard identity" />
                  </Group>
                  <Group grow>
                    <Select label="Recipient profile" size="xs" data={RECIPIENT_PROFILES} value={recipientProfile} onChange={(value) => setRecipientProfile(value ?? "technical-customer")} allowDeselect={false} />
                    <Select label="Intent template" size="xs" data={mode === "escalation" ? ESCALATION_INTENTS : POLISH_INTENTS} value={mode === "escalation" ? escalationIntent : polishIntent} onChange={(value) => mode === "escalation" ? setEscalationIntent(value ?? "initial-escalation") : setPolishIntent(value ?? "status-update")} allowDeselect={false} />
                  </Group>
                  <Select
                    label="Draft refinement"
                    description="Applied during the initial Generate step. Default is Shorter."
                    size="xs"
                    allowDeselect={false}
                    data={REFINEMENT_OPTIONS}
                    value={selectedRefinement}
                    onChange={(value) => setSelectedRefinement((value as RefineTone) ?? "shorter")}
                  />
                  {mode === "polish" ? (
                    <Group grow>
                      <Select label="Tone" size="xs" data={TONE_OPTIONS} value={tone} onChange={(value) => setTone(value ?? "neutral")} allowDeselect={false} />
                      <Select label="Length" size="xs" data={LENGTH_OPTIONS} value={length} onChange={(value) => setLength(value ?? "standard")} allowDeselect={false} />
                    </Group>
                  ) : null}
                </Stack>
              </SectionCard>

              {mode === "escalation" ? (
                <SectionCard
                  title="Carrier routing"
                  description="Auto-match the carrier, tune the level cutoff, and review the current contact path."
                  action={autoMatch ? <Badge size="xs" variant="light" color="violet">Detected: {autoMatch.carrier.carrier}</Badge> : undefined}
                >
                  <Select
                    placeholder="Auto-detected from notes"
                    data={carrierOptions}
                    value={carrierOverride ?? autoMatch?.carrier.id ?? null}
                    onChange={setCarrierOverride}
                    clearable
                    searchable
                    size="xs"
                    nothingFoundMessage={escalations.loading ? "Loading carriers…" : "No carriers loaded"}
                  />
                  {carrierLevels.length > 1 ? (
                    <Select
                      label="Include levels"
                      data={[
                        ...carrierLevels.map((level) => ({ value: String(level), label: level === 1 ? "L1 only" : `L1 – L${level}` })),
                        { value: "all", label: "All levels" },
                      ]}
                      value={maxLevel === null ? "all" : String(maxLevel)}
                      onChange={(value) => setMaxLevel(value === "all" || value === null ? null : Number.parseInt(value, 10))}
                      size="xs"
                      allowDeselect={false}
                    />
                  ) : null}
                  {carrierWithContacts ? <ContactPreview carrier={carrierWithContacts} contactSplit={contactSplit} /> : <Text size="xs" c="dimmed">Mention a carrier in the notes and the assistant will auto-match it here.</Text>}
                  {extracting ? <Badge size="xs" variant="light" color="teal">Extracting contacts…</Badge> : null}
                  {extractError ? <Alert color="red" icon={<IconAlertCircle size={14} />} variant="light">{extractError}</Alert> : null}
                </SectionCard>
              ) : null}

              <SectionCard title="Missing-field checklist" description="Detected gaps that are likely to create placeholders or weak asks.">
                {missingFields.length === 0 ? (
                  <Alert color="green" icon={<IconCheck size={14} />} variant="light">No obvious gaps detected from the current source + manual context.</Alert>
                ) : (
                  <Stack gap={6}>
                    {missingFields.map((field) => (
                      <Group key={field.key} justify="space-between" wrap="nowrap">
                        <Text size="xs">{field.label}</Text>
                        {extractedContext[field.key as keyof typeof extractedContext] ? (
                          <Button size="compact-xs" variant="light" onClick={() => fillMissingField(field.key, String(extractedContext[field.key as keyof typeof extractedContext] ?? ""))}>Use extracted value</Button>
                        ) : (
                          <Badge size="xs" color="yellow" variant="light">Needs input</Badge>
                        )}
                      </Group>
                    ))}
                  </Stack>
                )}
              </SectionCard>
            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 7 }}>
            <Stack gap="md">
              <SectionCard title="Output" description="Generate multiple variants, refine one click at a time, and edit the final subject inline.">
                {mode === "escalation" ? (
                  <Tabs value={selectedEscalationKey} onChange={(value) => setSelectedEscalationKey((value as EscalationVariantKey) ?? "carrier")}>
                    <Tabs.List>
                      {escalationOutputs.map((output) => <Tabs.Tab key={output.key} value={output.key}>{output.title}</Tabs.Tab>)}
                    </Tabs.List>
                  </Tabs>
                ) : (
                  <Tabs value={selectedPolishKey} onChange={(value) => setSelectedPolishKey((value as Audience) ?? "customer")}>
                    <Tabs.List>
                      {polishOutputs.map((output) => <Tabs.Tab key={output.key} value={output.key}>{output.title}</Tabs.Tab>)}
                    </Tabs.List>
                  </Tabs>
                )}
              </SectionCard>

              <OutputCard
                output={activeOutput}
                loading={activeLoading || refineAi.isLoading}
                onCopy={copyToClipboard}
                onSubjectChange={(value) => updateOutputSubject(activeOutput.key, value)}
              />

              <Grid gutter="md">
                <Grid.Col span={{ base: 12, md: 6 }}>
                  <SectionCard title="Subject line tools" description="Use presets, alternates, and suggestions for the current email.">
                    <Group gap={6} wrap="wrap">
                      {SUBJECT_PRESETS.map((preset) => (
                        <Button key={preset.label} size="compact-xs" variant="light" onClick={() => updateOutputSubject(activeOutput.key, preset.build(mergedContext))}>{preset.label}</Button>
                      ))}
                    </Group>
                    <Divider />
                    <Stack gap={6}>
                      {subjectSuggestions.map((suggestion) => (
                        <Group key={suggestion} justify="space-between" wrap="nowrap">
                          <Text size="xs" style={{ flex: 1 }}>{suggestion}</Text>
                          <Button size="compact-xs" variant="subtle" onClick={() => updateOutputSubject(activeOutput.key, suggestion)}>Use</Button>
                        </Group>
                      ))}
                    </Stack>
                  </SectionCard>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 6 }}>
                  <SectionCard title="Second-pass rewrite" description="Optional: re-apply the selected refinement after generation if you want another pass.">
                    <Stack gap="sm">
                      <Text size="sm" c="dimmed">
                        Current drafting preference: <Text span fw={600} c="white">{REFINEMENT_OPTIONS.find((option) => option.value === selectedRefinement)?.label ?? "Shorter"}</Text>
                      </Text>
                      <Button
                        variant="light"
                        leftSection={<IconReplace size={14} />}
                        onClick={() => refineCurrentOutput(selectedRefinement)}
                        disabled={!activeOutput.subject && !activeOutput.body}
                      >
                        Rewrite with selected refinement
                      </Button>
                    </Stack>
                  </SectionCard>
                </Grid.Col>
              </Grid>

              <Grid gutter="md">
                <Grid.Col span={{ base: 12, md: 6 }}>
                  <SectionCard title="Quality check" description="Pre-send validation for the currently selected email.">
                    <Stack gap={6}>
                      {qualityChecks.map((check) => (
                        <Group key={check.label} justify="space-between" align="flex-start" wrap="nowrap">
                          <Box style={{ flex: 1 }}>
                            <Text size="sm" fw={600}>{check.label}</Text>
                            <Text size="xs" c="dimmed">{check.detail}</Text>
                          </Box>
                          <Badge size="xs" color={check.status === "good" ? "green" : check.status === "warn" ? "yellow" : "red"} variant="light">
                            {check.status === "good" ? "Ready" : check.status === "warn" ? "Review" : "Missing"}
                          </Badge>
                        </Group>
                      ))}
                    </Stack>
                  </SectionCard>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 6 }}>
                  <SectionCard title="Diff / compare" description="Compare the current draft to the last version or a history item you restored for comparison.">
                    <DiffPanel previousText={previousVersion} currentText={currentVersion} />
                  </SectionCard>
                </Grid.Col>
              </Grid>
            </Stack>
          </Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, md: 6 }}>
            <HistoryPanel<EscalationDraft>
              title="Recent escalation drafts"
              rows={drafts}
              count={drafts.length}
              renderMeta={(saved) => (
                <>
                  {saved.ticket_number ? <Badge size="xs" variant="light" color="teal">{saved.ticket_number}</Badge> : null}
                  <Badge size="xs" variant="light" color={saved.mode === "outbound" ? "teal" : "violet"}>{saved.mode === "outbound" ? "Carrier" : "Internal"}</Badge>
                  <Text size="xs" c="dimmed">{formatDateTime(new Date(saved.created_at as unknown as string))}</Text>
                </>
              )}
              renderTitle={(saved) => saved.subject ?? "(no subject)"}
              onLoad={(saved) => loadEscalationDraft(saved, false)}
              onDuplicate={(saved) => loadEscalationDraft(saved, true)}
              onCompare={(saved) => setCompareBaseline(`Subject: ${saved.subject ?? ""}\n\n${saved.body_markdown ?? ""}`)}
              onDelete={(saved) => deleteDraft(saved.id)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <HistoryPanel<PolishedEmail>
              title="Recent polished emails"
              rows={emails}
              count={emails.length}
              renderMeta={(saved) => (
                <>
                  <Badge size="xs" variant="light" color={saved.audience === "customer" ? "cyan" : saved.audience === "internal" ? "violet" : "orange"}>{saved.audience}</Badge>
                  {saved.ticket_number ? <Badge size="xs" variant="default">#{saved.ticket_number}</Badge> : null}
                  <Text size="xs" c="dimmed">{formatDateTime(new Date(saved.created_at as unknown as string))}</Text>
                </>
              )}
              renderTitle={(saved) => saved.subject ?? "(no subject)"}
              onLoad={(saved) => loadPolishedEmail(saved, false)}
              onDuplicate={(saved) => loadPolishedEmail(saved, true)}
              onCompare={(saved) => setCompareBaseline(`Subject: ${saved.subject ?? ""}\n\n${saved.body_markdown ?? ""}`)}
              onDelete={(saved) => deleteEmail(saved.id)}
            />
          </Grid.Col>
        </Grid>
      </Stack>
    </WidgetFrame>
  );
}
