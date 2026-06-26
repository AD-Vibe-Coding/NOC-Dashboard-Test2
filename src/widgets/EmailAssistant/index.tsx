import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Divider,
  Grid,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBuildingBroadcastTower,
  IconClipboard,
  IconCopy,
  IconFileText,
  IconMail,
  IconPlayerStop,
  IconRefresh,
  IconSparkles,
  IconUpload,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import { db } from "../../db";
import { useCompletion } from "../../lib/devs-ai/use-completion";
import { useIdentity } from "../../lib/identity";
import { parseMhtmlFile, type ParsedMhtml } from "../../lib/mhtml";
import {
  availableLevels,
  matchCarrierFromNotes,
  type CarrierMatch,
} from "../../lib/carrier-match";
import { extractCarrierImages, type EscalationContact } from "../../lib/confluence";
import { useEscalations } from "../Escalations/data";
import { WidgetFrame } from "../WidgetFrame";
import { EmailAssistantTile } from "./Tile";
import {
  extractStructuredContext,
  makeOutlookFriendlyEmail,
  markdownToPlainText,
  normalizeSourceText,
  splitSubjectBody,
  type Audience,
  type EscalationVariantKey,
  type OutputVariantKey,
  type PolishVariantKey,
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

type DraftModeChoice = "polish" | "escalation";

const ESCALATION_VARIANTS: Array<{ key: EscalationVariantKey; title: string; color: string; icon: ComponentType<{ size?: number; color?: string }>; badge: string }> = [
  { key: "carrier", title: "Carrier draft", color: "teal", icon: IconBuildingBroadcastTower, badge: "External" },
  { key: "internal", title: "ESC-MGR alert", color: "violet", icon: IconUsers, badge: "Internal" },
  { key: "customer", title: "Customer update", color: "cyan", icon: IconUser, badge: "Customer" },
  { key: "executive", title: "Executive summary", color: "orange", icon: IconSparkles, badge: "Leadership" },
];

const POLISH_VARIANTS: Array<{ key: PolishVariantKey; audience: Audience; title: string; color: string; icon: ComponentType<{ size?: number; color?: string }>; badge: string }> = [
  { key: "polish-customer", audience: "customer", title: "Polished customer email", color: "cyan", icon: IconUser, badge: "Polish" },
  { key: "polish-internal", audience: "internal", title: "Polished internal email", color: "violet", icon: IconUsers, badge: "Polish" },
  { key: "polish-carrier", audience: "carrier", title: "Polished carrier email", color: "orange", icon: IconBuildingBroadcastTower, badge: "Polish" },
  { key: "polish-executive", audience: "executive", title: "Polished executive email", color: "grape", icon: IconSparkles, badge: "Polish" },
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

const REFINEMENT_OPTIONS: RefinementOption[] = [
  { value: "shorter", label: "Shorter" },
  { value: "firmer", label: "Firmer" },
  { value: "clearer", label: "Clearer" },
  { value: "empathetic", label: "Empathetic" },
  { value: "technical", label: "More technical" },
  { value: "executive", label: "Executive summary" },
];

const ESC_INTERNAL_PROMPT = `You are an experienced NOC technician at vCom drafting an internal escalation email to the carrier-escalation team.
Return markdown that starts with \"Subject:\" followed by a blank line and the email body.
Use first-person plural voice for vCom, such as \"we want to escalate\", \"we would like to escalate\", or \"we need support with\".
Do not refer to vCom in the third person. Never write phrases like \"vCom is requesting\" or \"vCom is escalating\".
Use these sections in order when relevant: Current Investigation Status, Latest Update, Escalation Level, Customer Feedback.
Keep the tone factual, concise, and operationally useful.`;

const ESC_OUTBOUND_PROMPT = `You are an experienced NOC technician at vCom drafting an outbound escalation email to a telecommunications carrier.
Return markdown that starts with \"Subject:\" followed by a blank line and the email body.
Use first-person plural voice for vCom, such as \"we want to escalate\", \"we would like to escalate\", or \"we need your help with\".
Do not refer to vCom in the third person. Never write phrases like \"vCom is requesting\" or \"vCom is escalating\".
Because this email is being sent directly to the carrier, do not say \"we will follow up with the carrier\" or describe the carrier as a third party. Address the recipient directly as \"you\" and ask them for the needed action, updated outage status, ETTR, dispatch status, or restoration estimate.
In the Reference section, include only these lines when the values are actually available: Customer, Address, Circuit. Skip any of those lines that are missing. Do not add other reference labels or placeholders.
Be polite but firm. Include a Reference section, current status, and a concrete \"What we need from you\" section.`;
const CUSTOMER_PROMPT = `You are a senior NOC technician at vCom writing a polished email to a customer.
Return markdown that starts with \"Subject:\" followed by a blank line and the email body.
Use plain English, acknowledge impact, avoid heavy jargon, and include the next update time or cadence.`;

const POLISH_INTERNAL_PROMPT = `You are a senior NOC technician at vCom writing a polished email to an internal team.
Return markdown that starts with \"Subject:\" followed by a blank line and the email body.
Be concise, action-oriented, and feel free to use short bullet points.`;

const CARRIER_PROMPT = `You are a senior NOC technician at vCom writing a polished email to a wholesale carrier.
Return markdown that starts with \"Subject:\" followed by a blank line and the email body.
In the Reference section, include only these lines when the values are actually available: Customer, Address, Circuit. Skip any of those lines that are missing. Do not add other reference labels or placeholders.
Be specific, firm, and ask for concrete carrier actions, ETA, or dispatch confirmation.`;

const EXEC_PROMPT = `You are a senior NOC technician at vCom drafting a brief executive summary email.
Return markdown that starts with \"Subject:\" followed by a blank line and the email body.
Use 3-5 short paragraphs or bullets summarizing impact, status, risk, and next update timing in non-technical language.`;

const PROMPTS: Record<Audience, string> = {
  customer: CUSTOMER_PROMPT,
  internal: POLISH_INTERNAL_PROMPT,
  carrier: CARRIER_PROMPT,
  executive: EXEC_PROMPT,
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

export function EmailAssistantWidget() {
  const { identity } = useIdentity();
  const senderName = identity?.name ?? "";
  const { refresh: refreshDrafts } = useEscalationDrafts();
  const { refresh: refreshEmails } = usePolishedEmails();
  const escalations = useEscalations();

  const [selectedOutputKey, setSelectedOutputKey] = useState<OutputVariantKey>("carrier");
  const [notes, setNotes] = useState("");
  const [uploadedMhtml, setUploadedMhtml] = useState<ParsedMhtml | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [uploadedFileSize, setUploadedFileSize] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
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
  const [recipientProfile] = useState("technical-customer");
  const [carrierOverride, setCarrierOverride] = useState<string | null>(null);
  const [maxLevel, setMaxLevel] = useState<number | null>(2);
  const [tone, setTone] = useState("neutral");
  const [length, setLength] = useState("standard");
  const [escalationIntent] = useState("initial-escalation");
  const [polishIntent] = useState("status-update");
  const [selectedRefinement, setSelectedRefinement] = useState<RefineTone>("shorter");
  const [generateModalOpened, setGenerateModalOpened] = useState(false);
  const [draftModeChoice, setDraftModeChoice] = useState<DraftModeChoice>("escalation");
  const [selectedEscalationVariant, setSelectedEscalationVariant] = useState<EscalationVariantKey>("internal");
  const [selectedPolishVariant, setSelectedPolishVariant] = useState<PolishVariantKey>("polish-customer");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [outputs, setOutputs] = useState<Record<string, OutputRecord>>({});
  const [, setOutputVersions] = useState<Record<string, string[]>>({});
  const [, setCompareBaseline] = useState("");
  const [, setViewingOutbound] = useState<EscalationDraft | null>(null);
  const [, setViewingInternal] = useState<EscalationDraft | null>(null);
  const [, setViewingPolish] = useState<PolishedEmail | null>(null);
  const [extractedContacts, setExtractedContacts] = useState<Map<string, EscalationContact[]>>(new Map());
  const [extracting, setExtracting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const carrierAi = useCompletion();
  const internalAi = useCompletion();
  const customerAi = useCompletion();
  const executiveAi = useCompletion();
  const polishCustomerAi = useCompletion();
  const polishInternalAi = useCompletion();
  const polishCarrierAi = useCompletion();
  const polishExecutiveAi = useCompletion();
  const refineAi = useCompletion();

  const sourceText = notes;
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
    extractCarrierImages(carrierId, { carrierName: effectiveCarrier.carrier })
      .then((result) => {
        setExtractedContacts((prev) => {
          const next = new Map(prev);
          next.set(carrierId, result.contacts ?? []);
          return next;
        });
      })
      .catch(() => {
        // Silent fallback: carrier-specific contact extraction is optional in the simplified UI.
      })
      .finally(() => setExtracting(null));
  }, [effectiveCarrier, extractedContacts, extracting]);

  const carrierWithContacts = useMemo(() => {
    if (!effectiveCarrier) return null;
    if (effectiveCarrier.contacts.length > 0) return effectiveCarrier;
    const extracted = extractedContacts.get(effectiveCarrier.id);
    return extracted ? { ...effectiveCarrier, contacts: extracted } : effectiveCarrier;
  }, [effectiveCarrier, extractedContacts]);

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

  async function handleMhtmlFile(file: File) {
    setUploadError(null);
    setUploadedFileName(file.name);
    setUploadedFileSize(file.size);

    try {
      const parsed = await parseMhtmlFile(file);
      if (!parsed.text || parsed.text.length < 100) {
        setUploadError("Could not extract meaningful text from this file. Is it a valid .mhtml?");
        setUploadedMhtml(null);
        return;
      }

      setUploadedMhtml(parsed);
      setNotes(parsed.text);
      setTicketNumber((current) => current || parsed.ticket_number || "");
      setCustomerName((current) => current || parsed.ticket_subject || parsed.subject || "");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
      setUploadedMhtml(null);
    }
  }

  function resetAll() {
    setNotes("");
    setUploadedMhtml(null);
    setUploadedFileName("");
    setUploadedFileSize(0);
    setUploadError(null);
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
    setGenerateModalOpened(false);
    setDraftModeChoice("escalation");
    setSelectedEscalationVariant("internal");
    setSelectedPolishVariant("polish-customer");
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
    polishExecutiveAi.setResult("");
    refineAi.setResult("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function buildSharedContextLines() {
    const lines: string[] = [];
    if (mergedContext.ticketNumber) lines.push(`vCom ticket #: ${mergedContext.ticketNumber}`);
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

  function buildSourceReviewInstructions() {
    const lines: string[] = [];

    if (uploadedMhtml) {
      lines.push("Primary source: uploaded ticket data dump (.mhtml) exported from the ticketing tool.");
      lines.push("Review the entire extracted dump below before drafting.");
      lines.push("Use the full ticket history, timestamps, status notes, and metadata in the dump — not just the short extracted fields above.");
      lines.push("Treat any manually filled fields as overrides or clarifications, but keep the uploaded dump as the source of truth unless the user clearly changed the text.");
      lines.push("Generate the strongest complete email you can from the full record, with no placeholders.");
    } else {
      lines.push("Primary source: pasted notes or rough draft supplied by the user.");
      lines.push("Review the full source text below before drafting.");
      lines.push("Generate the strongest complete email you can from the full record, with no placeholders.");
    }

    return lines.map((line) => `- ${line}`).join("\n");
  }

  async function runEscalationVariant(key: EscalationVariantKey) {
    if (!normalizedSource.trim()) {
      showToast({ color: "red", title: "Paste investigation notes first" });
      return;
    }

    const refinementInstruction = REFINEMENT_OPTIONS.find((option) => option.value === selectedRefinement)?.label ?? "Shorter";
    const shared = buildSharedContextLines();
    const carrierName = carrierWithContacts?.carrier ?? "Carrier";
    const intentLabel = ESCALATION_INTENTS.find((option) => option.value === escalationIntent)?.label ?? escalationIntent;
    const sourceReviewInstructions = buildSourceReviewInstructions();

    const promptBase = [
      ...shared,
      `Escalation intent: ${intentLabel}`,
      `Preferred drafting refinement: ${refinementInstruction}`,
      `Carrier-specific guidance: ${carrierStyleGuidance(carrierName)}`,
      carrierWithContacts ? `Carrier: ${carrierName}` : "",
    ].filter(Boolean).map((line) => `- ${line}`).join("\n");

    const prompts: Record<EscalationVariantKey, string> = {
      carrier: `${ESC_OUTBOUND_PROMPT}\n\nHow to use the source:\n${sourceReviewInstructions}\n\nKnown details:\n${promptBase}\n\nFull source text to review before drafting:\n${normalizedSource}`,
      internal: `${ESC_INTERNAL_PROMPT}\n\nHow to use the source:\n${sourceReviewInstructions}\n\nKnown details:\n${promptBase}\n\nFull source text to review before drafting:\n${normalizedSource}`,
      customer: `${CUSTOMER_PROMPT}\n\nHow to use the source:\n${sourceReviewInstructions}\n\nKnown details:\n${promptBase}\n\nDraft the best customer-ready email based on this full source record:\n${normalizedSource}`,
      executive: `${EXEC_PROMPT}\n\nHow to use the source:\n${sourceReviewInstructions}\n\nKnown details:\n${promptBase}\n\nDraft the best executive summary email based on this full source record:\n${normalizedSource}`,
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
        to_emails: null,
        cc_emails: null,
        carrier_id: carrierWithContacts?.id ?? null,
      });
      await refreshDrafts();
    }
  }

  async function runPolishVariant(key: PolishVariantKey) {
    if (!normalizedSource.trim()) {
      showToast({ color: "red", title: "Paste a rough draft first" });
      return;
    }

    const refinementInstruction = REFINEMENT_OPTIONS.find((option) => option.value === selectedRefinement)?.label ?? "Shorter";
    const intentLabel = POLISH_INTENTS.find((option) => option.value === polishIntent)?.label ?? polishIntent;
    const audience = POLISH_VARIANTS.find((variant) => variant.key === key)?.audience ?? "customer";
    const sourceReviewInstructions = buildSourceReviewInstructions();
    const prompt = `${PROMPTS[audience]}\n\nHow to use the source:\n${sourceReviewInstructions}\n\nKnown details:\n${[
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
    ].filter(Boolean).map((line) => `- ${line}`).join("\n")}\n\nFull source text to review before drafting the best email:\n${normalizedSource}`;

    const runners = {
      "polish-customer": polishCustomerAi,
      "polish-internal": polishInternalAi,
      "polish-carrier": polishCarrierAi,
      "polish-executive": polishExecutiveAi,
    } as const;

    const result = await runners[key].complete(prompt);
    const parsed = splitSubjectBody(result);
    updateOutput(key, parsed);
    await db.polished_emails.insert({
      audience,
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

  async function confirmGenerate() {
    setGenerateModalOpened(false);

    if (draftModeChoice === "escalation") {
      setSelectedOutputKey(selectedEscalationVariant);
      await runEscalationVariant(selectedEscalationVariant);
      return;
    }

    setSelectedOutputKey(selectedPolishVariant);
    await runPolishVariant(selectedPolishVariant);
  }

  const escalationOutputs = useMemo<OutputVariant[]>(() => {
    return ESCALATION_VARIANTS.map((variant) => {
      const output = outputs[variant.key] ?? { subject: "", body: "" };
      const to: string[] = [];
      const cc: string[] = [];
      const mailtoUrl = null;
      return { ...variant, ...output, to, cc, mailtoUrl };
    });
  }, [outputs]);

  const polishOutputs = useMemo<OutputVariant[]>(() => {
    return POLISH_VARIANTS.map((variant) => ({
      ...variant,
      ...((outputs[variant.key] ?? { subject: "", body: "" })),
      audience: variant.audience,
      to: [],
      cc: [],
      mailtoUrl: null,
    }));
  }, [outputs]);

  const allOutputs = useMemo<OutputVariant[]>(() => [...escalationOutputs, ...polishOutputs], [escalationOutputs, polishOutputs]);

  const activeOutput = useMemo(() => {
    return allOutputs.find((item) => item.key === selectedOutputKey) ?? allOutputs[0];
  }, [allOutputs, selectedOutputKey]);

  const activeLoading =
    (selectedOutputKey === "carrier" && carrierAi.isLoading) ||
    (selectedOutputKey === "internal" && internalAi.isLoading) ||
    (selectedOutputKey === "customer" && customerAi.isLoading) ||
    (selectedOutputKey === "executive" && executiveAi.isLoading) ||
    (selectedOutputKey === "polish-customer" && polishCustomerAi.isLoading) ||
    (selectedOutputKey === "polish-internal" && polishInternalAi.isLoading) ||
    (selectedOutputKey === "polish-carrier" && polishCarrierAi.isLoading) ||
    (selectedOutputKey === "polish-executive" && polishExecutiveAi.isLoading) ||
    false;

  const globalBusy = [carrierAi, internalAi, customerAi, executiveAi, polishCustomerAi, polishInternalAi, polishCarrierAi, polishExecutiveAi].some((item) => item.isLoading);

  return (
    <WidgetFrame
      title="NOC Email Assistant"
      subtitle="A simple workspace to turn notes into a clean email draft fast"
      icon={IconMail}
      iconColor="teal"
      loading={globalBusy}
      status={{ label: "AI", color: "teal", tooltip: "Simple NOC email drafting" }}
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
        opened={generateModalOpened}
        onClose={() => setGenerateModalOpened(false)}
        title="Generate email"
        centered
        radius="lg"
      >
        <Stack gap="md">
          <Select
            label="1. What do you want to do?"
            data={[
              { value: "polish", label: "Polish email" },
              { value: "escalation", label: "Escalation" },
            ]}
            value={draftModeChoice}
            onChange={(value) => setDraftModeChoice((value as DraftModeChoice) ?? "escalation")}
            allowDeselect={false}
          />

          {draftModeChoice === "escalation" ? (
            <Select
              label="2. Which escalation email?"
              data={[
                { value: "internal", label: "Internal escalation email (ESC_MGR)" },
                { value: "carrier", label: "Carrier-facing escalation email" },
              ]}
              value={selectedEscalationVariant}
              onChange={(value) => setSelectedEscalationVariant((value as EscalationVariantKey) ?? "internal")}
              allowDeselect={false}
            />
          ) : (
            <Select
              label="2. Who is the polished email for?"
              data={[
                { value: "polish-customer", label: "Customer" },
                { value: "polish-carrier", label: "Carrier" },
                { value: "polish-internal", label: "Internal" },
                { value: "polish-executive", label: "Executive level" },
              ]}
              value={selectedPolishVariant}
              onChange={(value) => setSelectedPolishVariant((value as PolishVariantKey) ?? "polish-customer")}
              allowDeselect={false}
            />
          )}

          <Select
            label="3. Drafting style"
            data={REFINEMENT_OPTIONS}
            value={selectedRefinement}
            onChange={(value) => setSelectedRefinement((value as RefineTone) ?? "shorter")}
            allowDeselect={false}
          />

          {draftModeChoice === "polish" ? (
            <Group grow>
              <Select label="Tone" size="sm" data={TONE_OPTIONS} value={tone} onChange={(value) => setTone(value ?? "neutral")} allowDeselect={false} />
              <Select label="Length" size="sm" data={LENGTH_OPTIONS} value={length} onChange={(value) => setLength(value ?? "standard")} allowDeselect={false} />
            </Group>
          ) : null}

          <Card withBorder radius="md" p="sm" bg="dark.7">
            <Text size="xs" c="dimmed" mb={4}>You are about to generate</Text>
            <Text fw={600} size="sm">
              {draftModeChoice === "escalation"
                ? (selectedEscalationVariant === "internal" ? "Internal escalation email (ESC_MGR)" : "Carrier-facing escalation email")
                : POLISH_VARIANTS.find((variant) => variant.key === selectedPolishVariant)?.title}
            </Text>
            <Text size="xs" c="dimmed" mt={4}>
              Style: {REFINEMENT_OPTIONS.find((option) => option.value === selectedRefinement)?.label ?? "Shorter"}
            </Text>
          </Card>

          <Group justify="flex-end">
            <Button variant="default" onClick={() => setGenerateModalOpened(false)}>
              Cancel
            </Button>
            <Button color="teal" leftSection={<IconSparkles size={14} />} onClick={confirmGenerate}>
              Generate draft
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Stack gap="lg">
        <Card withBorder radius="lg" p="md">
          <Group justify="space-between" align="center" wrap="wrap">
            <Text size="sm" c="dimmed">If you upload a ticket data dump, the assistant reviews the full extracted record before generating the email.</Text>
            <Group gap="xs" wrap="wrap">
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
                    polishExecutiveAi.abort();
                  }}
                >
                  Stop
                </Button>
              ) : null}
              <Button
                color="teal"
                leftSection={<IconSparkles size={14} />}
                onClick={() => setGenerateModalOpened(true)}
                disabled={!normalizedSource.trim()}
              >
                Generate
              </Button>
            </Group>
          </Group>
        </Card>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Stack gap="md">
              <SectionCard
                title="Add your source"
                description="Paste notes manually or upload a ticket data dump (.mhtml) from your ticketing tool. The assistant will review the full extracted dump before drafting."
              >
                  {!uploadedMhtml ? (
                    <Box
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDragOver(false);
                        const file = event.dataTransfer.files?.[0];
                        if (file) void handleMhtmlFile(file);
                      }}
                      style={{
                        border: `2px dashed ${dragOver ? "var(--mantine-color-teal-5)" : "var(--mantine-color-dark-4)"}`,
                        borderRadius: 12,
                        padding: "20px 16px",
                        textAlign: "center",
                        cursor: "pointer",
                        background: dragOver ? "var(--mantine-color-teal-9)" : "var(--mantine-color-dark-7)",
                        transition: "all 150ms ease",
                      }}
                    >
                      <Stack gap={6} align="center">
                        <IconUpload size={24} color={dragOver ? "var(--mantine-color-teal-3)" : "var(--mantine-color-dimmed)"} />
                        <Text size="sm" fw={500}>
                          Drop an <Code>.mhtml</Code> file here, or click to browse
                        </Text>
                        <Text size="xs" c="dimmed">
                          Upload the exported ticket dump and we’ll review the full extracted record before generating the email.
                        </Text>
                      </Stack>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".mhtml,.mht,message/rfc822,multipart/related"
                        hidden
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void handleMhtmlFile(file);
                        }}
                      />
                    </Box>
                  ) : (
                    <Card radius="md" withBorder p="md" bg="dark.7">
                      <Group justify="space-between" align="flex-start" wrap="nowrap">
                        <Box style={{ minWidth: 0 }}>
                          <Group gap={6} wrap="nowrap">
                            <IconFileText size={14} />
                            <Text fw={600} truncate>Ticket data dump</Text>
                          </Group>
                          <Text size="xs" c="dimmed" mt={4} truncate>
                            {uploadedFileName || uploadedMhtml.ticket_subject || uploadedMhtml.subject || "Uploaded .mhtml file"}
                          </Text>
                          <Group gap="sm" mt={6}>
                            {uploadedMhtml.ticket_number ? (
                              <Badge variant="light" color="teal" size="sm">{uploadedMhtml.ticket_number}</Badge>
                            ) : null}
                            <Text size="xs" c="dimmed">
                              {(uploadedFileSize / 1024).toFixed(1)} KB · {uploadedMhtml.text.length.toLocaleString()} chars extracted
                            </Text>
                          </Group>
                        </Box>
                        <Button
                          variant="light"
                          size="xs"
                          onClick={() => {
                            setUploadedMhtml(null);
                            setUploadedFileName("");
                            setUploadedFileSize(0);
                            setUploadError(null);
                            if (fileInputRef.current) fileInputRef.current.value = "";
                          }}
                        >
                          Remove file
                        </Button>
                      </Group>
                    </Card>
                  )}

                  {uploadError ? (
                    <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
                      {uploadError}
                    </Alert>
                  ) : null}
                </SectionCard>

              <SectionCard
                title="Paste your source"
                description="Paste raw investigation notes or an existing rough email. The assistant can draft fresh escalations or polish the message into different outputs."
                action={<Badge size="xs" variant="light" color="gray">{sourceText.length.toLocaleString()} chars</Badge>}
              >
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.currentTarget.value)}
                  placeholder="Paste raw notes, troubleshooting updates, or a rough email draft here."
                  autosize
                  minRows={14}
                  maxRows={24}
                  styles={{ input: { fontFamily: "ui-monospace, SF Mono, Menlo, monospace", fontSize: 12 } }}
                />
              </SectionCard>

              <SectionCard title="Key details" description="Only the essentials. Fill in what matters; leave the rest blank.">
                <Stack gap="xs">
                  <Group grow>
                    <TextInput label="Ticket #" size="sm" value={ticketNumber} onChange={(event) => setTicketNumber(event.currentTarget.value)} placeholder={extractedContext.ticketNumber || "574995"} />
                    <TextInput label="Customer" size="sm" value={customerName} onChange={(event) => setCustomerName(event.currentTarget.value)} placeholder={extractedContext.customerName || "Customer name"} />
                  </Group>
                  <TextInput label="Impact" size="sm" value={impact} onChange={(event) => setImpact(event.currentTarget.value)} placeholder={extractedContext.impact || "What is impacted?"} />
                  <Group grow>
                    <TextInput label="Next update" size="sm" value={nextUpdate} onChange={(event) => setNextUpdate(event.currentTarget.value)} placeholder={extractedContext.nextUpdate || "Next update time or cadence"} />
                    <TextInput label="Recipient name" size="sm" value={recipientName} onChange={(event) => setRecipientName(event.currentTarget.value)} placeholder="Customer or team name" />
                  </Group>
                </Stack>
              </SectionCard>

              <SectionCard
                title="Carrier"
                description="Optional. If a carrier is detected, we will use the right contact path automatically."
                action={autoMatch ? <Badge size="xs" variant="light" color="violet">{autoMatch.carrier.carrier}</Badge> : undefined}
              >
                <Stack gap="xs">
                  <Select
                    placeholder="Auto-detected from notes"
                    data={carrierOptions}
                    value={carrierOverride ?? autoMatch?.carrier.id ?? null}
                    onChange={setCarrierOverride}
                    clearable
                    searchable
                    size="sm"
                    nothingFoundMessage={escalations.loading ? "Loading carriers…" : "No carriers loaded"}
                  />
                  {carrierLevels.length > 1 ? (
                    <Select
                      label="Contact level"
                      data={[
                        ...carrierLevels.map((level) => ({ value: String(level), label: level === 1 ? "L1 only" : `L1 – L${level}` })),
                        { value: "all", label: "All levels" },
                      ]}
                      value={maxLevel === null ? "all" : String(maxLevel)}
                      onChange={(value) => setMaxLevel(value === "all" || value === null ? null : Number.parseInt(value, 10))}
                      size="sm"
                      allowDeselect={false}
                    />
                  ) : null}
                  <Text size="xs" c="dimmed">Optional: choose a carrier if you want carrier-facing drafts tailored to that provider.</Text>
                </Stack>
              </SectionCard>

            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 7 }}>
            <Stack gap="md">
              <SectionCard title="Current output" description="The last generated draft appears here. Use Generate to choose a new draft type and style.">
                <Group gap="sm" wrap="wrap">
                  <Badge size="sm" variant="light" color={activeOutput.color}>{activeOutput.title}</Badge>
                  <Badge size="sm" variant="light" color="gray">
                    {activeOutput.key.startsWith("polish-") ? "Polish" : activeOutput.key === "internal" ? "ESC_MGR" : activeOutput.key === "carrier" ? "Carrier escalation" : "Email draft"}
                  </Badge>
                  <Badge size="sm" variant="light" color="gray">
                    Style: {REFINEMENT_OPTIONS.find((option) => option.value === selectedRefinement)?.label ?? "Shorter"}
                  </Badge>
                </Group>
              </SectionCard>

              <OutputCard
                output={activeOutput}
                loading={activeLoading}
                onCopy={copyToClipboard}
                onSubjectChange={(value) => updateOutputSubject(activeOutput.key, value)}
              />

            </Stack>
          </Grid.Col>
        </Grid>
      </Stack>
    </WidgetFrame>
  );
}
