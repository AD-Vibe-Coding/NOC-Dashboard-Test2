// =============================================================================
// Mobility Troubleshooter widget
//
// Flow:
//   1. Select carrier
//   2. Select issue type
//   3. Select device model
//   4. Guide:
//        - Structured path (Option A wizard) when a PATHS entry exists
//          → one step at a time + Worked / Still an issue + templates
//        - Else legacy 3-section OPUS/matrix guide
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Stepper,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconAntennaBars5,
  IconCheck,
  IconDeviceMobile,
  IconDeviceMobileMessage,
  IconListCheck,
  IconPhone,
  IconRefresh,
  IconRouter,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import { PATHS } from "../../data/troubleshooting";
import {
  DEVICE_OPTIONS as WIZARD_DEVICE_OPTIONS,
  resolvePath,
  startWizard,
  type CarrierId,
  type DeviceFamily,
  type WizardState,
} from "../../lib/troubleshooting";
import {
  DEVICE_OPTIONS as LEGACY_DEVICE_OPTIONS,
  deviceStepFor,
  filterContentForDevice,
  pathChips,
  toSimpleSteps,
  type DeviceKey,
  type MobilityIssueGuide,
} from "../../lib/mobility-confluence";
import {
  linkifyOtaMentions,
  OTA_GUIDE,
  OTA_LINK_HREF,
} from "../../lib/ota-guide";
import { WidgetFrame } from "../../widgets/WidgetFrame";
import { useMobilityGuides } from "../../widgets/MobilityTroubleshooter/data";
import { TroubleshootWizard } from "../../widgets/MobilityTroubleshooter/TroubleshootWizard";

const ACCENT = "violet";

const CARRIERS = [
  {
    value: "att-buyers-club",
    label: "ATT Wireless via vCom Buyers' Club",
    description: "OPUS portal · Buyers' Club wholesale",
  },
] as const;

type CarrierValue = (typeof CARRIERS)[number]["value"];

/** Device values used in the selector (wizard + legacy). */
type DeviceSelectValue = DeviceKey | Exclude<DeviceFamily, "any">;

const STEP_META = [
  {
    key: "step1" as const,
    title: "1. NOC checks",
    color: "violet",
    icon: IconListCheck,
  },
  {
    key: "step2" as const,
    title: "2. Carrier checks",
    color: "orange",
    icon: IconPhone,
  },
  {
    key: "step3" as const,
    title: "3. If still broken",
    color: "red",
    icon: IconAlertCircle,
  },
];

/**
 * Map OPUS / bundled issue ids (or free-text labels) onto structured path issueIds.
 * Only issues with a registered PATHS entry use the one-step wizard.
 */
function mapToStructuredIssueId(
  issueId: string | null | undefined,
): string | null {
  if (!issueId) return null;
  if (PATHS.some((p) => p.issueId === issueId)) return issueId;

  const key = issueId.toLowerCase().trim();

  // Exact OPUS / matrix ids
  const exact: Record<string, string> = {
    calls: "calls-inbound-outbound",
    sos: "sos-mode",
    network: "network-connectivity",
    connectivity: "network-connectivity",
    "poor-connection": "network-connectivity",
    data: "data-issue",
    text: "text-issue",
    esim: "esim-issue",
    roaming: "international-roaming",
    voicemail: "voicemail",
    activation: "activation",
  };
  if (exact[key]) return exact[key];

  // Label / free-text fallbacks
  if (
    /calls?\b.*inbound|inbound.*outbound|outbound.*call|static|gargled/i.test(
      key,
    )
  ) {
    return "calls-inbound-outbound";
  }
  if (/\bsos\b|no.?service/i.test(key)) return "sos-mode";
  if (/connectivity|poor.?connection|weak.?signal/i.test(key)) {
    return "network-connectivity";
  }
  if (/\bdata\b|throttle|internet|slow.?data/i.test(key)) return "data-issue";
  if (/\btext\b|sms|mms|imessage|messaging/i.test(key)) return "text-issue";
  if (/\besim\b|e-sim/i.test(key)) return "esim-issue";
  if (/roam|international|travel/i.test(key)) return "international-roaming";
  if (/voicemail|visual.?voice/i.test(key)) return "voicemail";
  if (/activat|porting|port-in|new.?device/i.test(key)) return "activation";

  return null;
}

function toWizardDevice(
  device: DeviceSelectValue | null,
): Exclude<DeviceFamily, "any"> | null {
  if (!device) return null;
  if (device === "iphone" || device === "samsung" || device === "pixel") {
    return device;
  }
  if (device === "data-only") return "data-only";
  if (device === "ipad") return "iphone";
  if (device === "other" || device === "kyocera") return "data-only";
  return null;
}

function toLegacyDevice(device: DeviceSelectValue): DeviceKey {
  if (
    device === "iphone" ||
    device === "ipad" ||
    device === "samsung" ||
    device === "pixel" ||
    device === "kyocera" ||
    device === "other"
  ) {
    return device;
  }
  if (device === "data-only") return "other";
  return "other";
}

/**
 * Pull OTA into its own checklist line and linkify every OTA mention so
 * techs can open the OTA how-to popup without leaving the runbook.
 */
function prepareSteps(rawSteps: string[]): string[] {
  const out: string[] = [];

  for (const raw of rawSteps) {
    const step = raw.trim();
    if (!step) continue;

    if (
      /^\*\*Customer template:\*\*/i.test(step) ||
      /^Customer template:/i.test(step)
    ) {
      continue;
    }
    if (
      /^We could see \(Device\) IMEI/i.test(step) ||
      /^Please share your findings after these steps/i.test(step)
    ) {
      continue;
    }

    const sendOtaIdx = step.search(
      /(?:proceed\s+with\s+)?sending\s+(?:an?\s+)?OTA\b/i,
    );
    if (sendOtaIdx > 20) {
      const before = step.slice(0, sendOtaIdx).trim().replace(/[.,;:]+$/, "");
      const rest = step.slice(sendOtaIdx).replace(
        /^(?:proceed\s+with\s+)?sending\s+(?:an?\s+)?OTA\b/i,
        `Send [OTA](${OTA_LINK_HREF})`,
      );
      if (before.length > 12 && !/\bOTA\b/i.test(before)) {
        out.push(linkifyOtaMentions(before));
        out.push(linkifyOtaMentions(rest.trim()));
        continue;
      }
    }

    out.push(linkifyOtaMentions(step));
  }

  return out.filter((s, i, arr) => i === 0 || s !== arr[i - 1]);
}

function isOtaHref(href: string | undefined | null): boolean {
  if (!href) return false;
  return (
    href === OTA_LINK_HREF ||
    href === "#ota-guide" ||
    href.startsWith("#ota") ||
    /ota[-_]?guide/i.test(href)
  );
}

function StepText({
  text,
  onOtaClick,
}: {
  text: string;
  onOtaClick: () => void;
}) {
  return (
    <div className="prose prose-sm max-w-none" style={{ lineHeight: 1.55 }}>
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            if (isOtaHref(href)) {
              return (
                <Anchor
                  component="button"
                  type="button"
                  fw={700}
                  c={ACCENT}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onOtaClick();
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  {children}
                </Anchor>
              );
            }
            return (
              <Anchor href={href} target="_blank" rel="noreferrer" fw={600}>
                {children}
              </Anchor>
            );
          },
          p: ({ children }) => (
            <Text component="span" size="sm" style={{ display: "block" }}>
              {children}
            </Text>
          ),
          strong: ({ children }) => (
            <Text component="span" fw={700} size="sm">
              {children}
            </Text>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function SimpleStepList({
  steps,
  onOtaClick,
}: {
  steps: string[];
  onOtaClick: () => void;
}) {
  if (steps.length === 0) {
    return (
      <Text size="sm" c="dimmed" fs="italic">
        No further steps recorded for this stage.
      </Text>
    );
  }

  return (
    <Stack gap={12}>
      {steps.map((step, i) => (
        <Box key={i}>
          <Group align="flex-start" gap="sm" wrap="nowrap">
            <ThemeIcon
              size={26}
              radius="xl"
              color={ACCENT}
              variant="light"
              style={{ flexShrink: 0, marginTop: 1 }}
            >
              <Text size="xs" fw={700}>
                {i + 1}
              </Text>
            </ThemeIcon>
            <Box style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
              <StepText text={step} onOtaClick={onOtaClick} />
            </Box>
          </Group>
        </Box>
      ))}
    </Stack>
  );
}

function OtaGuideModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      zIndex={10000}
      withinPortal
      title={
        <Group gap="sm">
          <ThemeIcon color={ACCENT} variant="light" radius="md" size={36}>
            <IconAntennaBars5 size={20} />
          </ThemeIcon>
          <div>
            <Text fw={700} size="md">
              {OTA_GUIDE.title}
            </Text>
            <Text size="xs" c="dimmed">
              {OTA_GUIDE.subtitle}
            </Text>
          </div>
        </Group>
      }
      size="lg"
      radius="md"
      centered
      padding="lg"
      overlayProps={{ backgroundOpacity: 0.55, blur: 2 }}
    >
      <Stack gap="md">
        <Text size="sm">{OTA_GUIDE.summary}</Text>

        <Card withBorder radius="md" padding="sm" bg="var(--mantine-color-default)">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>
            When to send OTA
          </Text>
          <Stack gap={4}>
            {OTA_GUIDE.whenToUse.map((item) => (
              <Group key={item} gap="xs" wrap="nowrap" align="flex-start">
                <Text size="sm" c={ACCENT} fw={700}>
                  •
                </Text>
                <Text size="sm">{item}</Text>
              </Group>
            ))}
          </Stack>
        </Card>

        <div>
          <Text size="sm" fw={700} mb="sm">
            How to send OTA in OPUS
          </Text>
          <Stack gap="sm">
            {OTA_GUIDE.steps.map((step, i) => (
              <Group key={step.title} align="flex-start" gap="sm" wrap="nowrap">
                <ThemeIcon
                  size={28}
                  radius="xl"
                  color={ACCENT}
                  variant="filled"
                  style={{ flexShrink: 0 }}
                >
                  <Text size="xs" fw={700}>
                    {i + 1}
                  </Text>
                </ThemeIcon>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" fw={700}>
                    {step.title}
                  </Text>
                  <Text size="sm" c="dimmed" style={{ lineHeight: 1.5 }}>
                    {step.detail}
                  </Text>
                </div>
              </Group>
            ))}
          </Stack>
        </div>

        <Stack gap={4}>
          {OTA_GUIDE.notes.map((note) => (
            <Text key={note} size="xs" c="dimmed">
              • {note}
            </Text>
          ))}
        </Stack>

        <Group justify="space-between" mt="xs">
          <Anchor href={OTA_GUIDE.portalUrl} target="_blank" size="sm" fw={600}>
            Open OPUS portal ↗
          </Anchor>
          <Button color={ACCENT} onClick={onClose}>
            Done
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function DevicePathCard({
  device,
  guidance,
}: {
  device: DeviceKey;
  guidance: string;
}) {
  const label =
    LEGACY_DEVICE_OPTIONS.find((d) => d.value === device)?.label ?? device;
  const chips = pathChips(guidance);

  return (
    <Card withBorder radius="md" padding="md" bg="var(--mantine-color-violet-light)">
      <Group gap="sm" mb={chips.length ? "sm" : 0} align="flex-start">
        <ThemeIcon color={ACCENT} variant="filled" radius="md" size={32}>
          <IconDeviceMobile size={18} />
        </ThemeIcon>
        <div style={{ flex: 1 }}>
          <Text fw={700} size="sm">
            {label} — on-device steps
          </Text>
          <Text size="xs" c="dimmed">
            Device-side network reset path for this model.
          </Text>
        </div>
      </Group>
      {chips.length > 0 ? (
        <Group gap={6} wrap="wrap">
          {chips.map((chip, i) => (
            <Group key={`${chip}-${i}`} gap={6} wrap="nowrap">
              <Badge
                size="md"
                radius="sm"
                variant="filled"
                color={ACCENT}
                style={{ textTransform: "none", fontWeight: 600 }}
              >
                {chip}
              </Badge>
              {i < chips.length - 1 && (
                <Text size="xs" c="dimmed" fw={700}>
                  →
                </Text>
              )}
            </Group>
          ))}
        </Group>
      ) : (
        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
          {guidance}
        </Text>
      )}
    </Card>
  );
}

function IssueGuideView({
  issue,
  device,
  onOtaClick,
}: {
  issue: MobilityIssueGuide;
  device: DeviceKey | null;
  onOtaClick: () => void;
}) {
  const deviceGuidance = deviceStepFor(issue, device);
  const deviceLabel =
    LEGACY_DEVICE_OPTIONS.find((d) => d.value === device)?.label ?? null;

  const sections = useMemo(() => {
    return STEP_META.map(({ key, title, color, icon }) => {
      const raw = issue[key] || "";
      const filtered = filterContentForDevice(raw, device);
      const steps = prepareSteps(toSimpleSteps(filtered));
      return { key, title, color, icon, steps, hasContent: steps.length > 0 };
    }).filter((s) => s.hasContent || s.key === "step1");
  }, [issue, device]);

  const hasOtaMention = useMemo(
    () =>
      sections.some((s) =>
        s.steps.some((step) => /OTA/i.test(step) || step.includes(OTA_LINK_HREF)),
      ),
    [sections],
  );

  return (
    <Stack gap="md">
      <Group gap="xs" wrap="wrap">
        <Badge color={ACCENT} variant="light" size="sm">
          {issue.label}
        </Badge>
        {device && (
          <Badge
            color="gray"
            variant="outline"
            size="sm"
            leftSection={<IconDeviceMobile size={12} />}
          >
            {deviceLabel ?? device}
          </Badge>
        )}
        {hasOtaMention && (
          <Button
            size="xs"
            variant="light"
            color={ACCENT}
            leftSection={<IconAntennaBars5 size={14} />}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOtaClick();
            }}
          >
            View OTA guide
          </Button>
        )}
      </Group>

      {device && deviceGuidance && (
        <DevicePathCard device={device} guidance={deviceGuidance} />
      )}

      <Stack gap="sm">
        {sections.map(({ key, title, color, icon: Icon, steps }) => (
          <Card key={key} withBorder radius="md" padding="md">
            <Group gap="xs" mb="md" wrap="wrap">
              <ThemeIcon color={color} variant="light" radius="md" size={28}>
                <Icon size={16} />
              </ThemeIcon>
              <Text fw={700} size="sm">
                {title}
              </Text>
              <Badge size="xs" variant="light" color={color}>
                {steps.length} {steps.length === 1 ? "step" : "steps"}
              </Badge>
            </Group>
            <SimpleStepList steps={steps} onOtaClick={onOtaClick} />
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}

export function MobilityTroubleshooterModule() {
  const { data, loading, error, refresh, cachedAt, debug, build } =
    useMobilityGuides();
  const [carrier, setCarrier] = useState<CarrierValue | null>(null);
  const [issueId, setIssueId] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceSelectValue | null>(null);
  const [wizardState, setWizardState] = useState<WizardState | null>(null);
  const [otaOpen, setOtaOpen] = useState(false);
  const openOtaGuide = useCallback(() => setOtaOpen(true), []);

  const structuredIssueId = useMemo(
    () => mapToStructuredIssueId(issueId),
    [issueId],
  );

  const useWizardDevices = !!structuredIssueId;

  const deviceSelectOptions = useMemo(() => {
    if (useWizardDevices) {
      return WIZARD_DEVICE_OPTIONS.map((d) => ({
        value: d.value,
        label: d.label,
      }));
    }
    return LEGACY_DEVICE_OPTIONS.map((d) => ({
      value: d.value,
      label: d.label,
    }));
  }, [useWizardDevices]);

  const issueOptions = useMemo(() => {
    if (!data?.issues?.length) {
      return [
        "Activation assistance",
        "Calls Inbound/ Outbound / SOS / No Service",
        "Data issue",
        "eSIM Issue",
        "Text issue (SMS / MMS / iMessage)",
        "Voicemail not working",
        "International Roaming",
        "Network connectivity / Poor connection",
        "SOS Mode / No Service",
        "Plan and feature change",
        "Proactive Outage Notification",
        "Warranty inquiry",
      ].map((label) => ({ value: label, label }));
    }
    return data.issues.map((i) => ({ value: i.id, label: i.label }));
  }, [data]);

  const selectedIssue = useMemo(() => {
    if (!data || !issueId) return null;
    return data.issues.find((i) => i.id === issueId) ?? null;
  }, [data, issueId]);

  const wizardDevice = useMemo(() => toWizardDevice(device), [device]);

  const resolvedStructuredPath = useMemo(() => {
    if (!carrier || !structuredIssueId || !wizardDevice) return null;
    return (
      resolvePath(PATHS, structuredIssueId, carrier as CarrierId, wizardDevice) ||
      resolvePath(PATHS, structuredIssueId, carrier as CarrierId, "any")
    );
  }, [carrier, structuredIssueId, wizardDevice]);

  const resolvedPathSignature = useMemo(() => {
    if (!resolvedStructuredPath) return "";
    return resolvedStructuredPath.steps
      .map((step) => `${step.id}:${step.order}:${step.displayOrderLabel ?? ""}`)
      .join("|");
  }, [resolvedStructuredPath]);

  // Start / reset structured wizard when carrier + issue + device are ready
  useEffect(() => {
    if (!carrier || !structuredIssueId || !wizardDevice || !resolvedStructuredPath) {
      setWizardState(null);
      return;
    }

    setWizardState((current) => {
      const started = startWizard({
        paths: PATHS,
        issueId: structuredIssueId,
        carrier: carrier as CarrierId,
        device: wizardDevice,
      });

      if (!started.ok) return null;
      if (!current) return started.state;

      const currentSignature = current.path.steps
        .map((step) => `${step.id}:${step.order}:${step.displayOrderLabel ?? ""}`)
        .join("|");

      if (
        current.issueId === structuredIssueId &&
        current.carrier === (carrier as CarrierId) &&
        current.device === wizardDevice &&
        currentSignature === resolvedPathSignature
      ) {
        return current;
      }

      const currentStepId = current.path.steps[current.currentStepIndex]?.id;
      const nextStepIndex = currentStepId
        ? Math.max(
            0,
            started.state.path.steps.findIndex((step) => step.id === currentStepId),
          )
        : 0;

      return {
        ...started.state,
        currentStepIndex: nextStepIndex,
      };
    });
  }, [carrier, structuredIssueId, wizardDevice, resolvedStructuredPath, resolvedPathSignature]);

  const activeStep = !carrier ? 0 : !issueId ? 1 : !device ? 2 : 3;

  function resetFrom(step: "carrier" | "issue" | "device") {
    if (step === "carrier") {
      setCarrier(null);
      setIssueId(null);
      setDevice(null);
      setWizardState(null);
    } else if (step === "issue") {
      setIssueId(null);
      setDevice(null);
      setWizardState(null);
    } else {
      setDevice(null);
      setWizardState(null);
    }
  }

  const isLive = data?.source === "live";
  const issueCount = data?.issues?.length ?? 0;

  return (
    <WidgetFrame
      title="Mobility Troubleshooter"
      subtitle={
        isLive
          ? `Live OPUS Troubleshooting Workflow${data?.page_version ? ` · v${data.page_version}` : ""}`
          : data
            ? "Bundled Mobility Matrix fallback"
            : "Loading OPUS Troubleshooting Workflow…"
      }
      icon={IconDeviceMobileMessage}
      iconColor={ACCENT}
      loading={loading}
      onRefresh={() => refresh(true)}
      status={
        data
          ? {
              label: isLive
                ? `Live · ${issueCount} issues`
                : `Bundled · ${issueCount} issues`,
              color: isLive ? "green" : "yellow",
              tooltip: isLive
                ? `Live from Confluence: ${data.page_title || "AT&T OPUS Troubleshooting Workflow"}${data.page_version ? ` (v${data.page_version})` : ""}`
                : data.warning ||
                  "Bundled Mobility Matrix fallback — click refresh to retry live Confluence",
            }
          : undefined
      }
    >
      <ScrollArea
        style={{ height: "calc(100vh - 240px)", minHeight: 480 }}
        type="auto"
        offsetScrollbars
      >
        <Stack gap="lg" p="md">
          {data && data.source === "live" && (
            <Alert
              icon={<IconCheck size={16} />}
              color="green"
              variant="light"
              radius="md"
            >
              <Text size="sm" fw={600}>
                Live OPUS workflow loaded · {data.issues.length} issues
                {data.page_version ? ` · v${data.page_version}` : ""}
              </Text>
              <Text size="xs" c="dimmed" mt={4}>
                {data.page_title || "AT&T OPUS Troubleshooting Workflow"} · build{" "}
                {build}
              </Text>
            </Alert>
          )}
          {data && data.source !== "live" && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              color="yellow"
              variant="light"
              radius="md"
            >
              <Text size="sm" fw={600} mb={4}>
                Bundled fallback active · {data.issues.length} issues
              </Text>
              <Text size="sm">
                {data.warning ||
                  "Showing bundled Mobility Matrix instead of live Confluence OPUS."}
              </Text>
              <Text size="xs" c="dimmed" mt={6}>
                Expected live: ~13 OPUS issues · page 6315114528. Build {build}.
                {debug ? ` Debug: ${debug}` : ""}
              </Text>
              <Button
                size="xs"
                variant="light"
                color="yellow"
                leftSection={<IconRefresh size={14} />}
                mt="xs"
                loading={loading}
                onClick={() => refresh(true)}
              >
                Retry live fetch
              </Button>
            </Alert>
          )}
          {error && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              color="red"
              variant="light"
              radius="md"
            >
              {error}
              {debug && (
                <Text size="xs" c="dimmed" mt={4}>
                  {debug}
                </Text>
              )}
              <Button
                size="xs"
                variant="light"
                color="red"
                leftSection={<IconRefresh size={14} />}
                mt="xs"
                onClick={() => refresh(true)}
              >
                Retry
              </Button>
            </Alert>
          )}

          <Card withBorder radius="md" padding="md">
            <Stepper
              active={activeStep}
              size="sm"
              color={ACCENT}
              allowNextStepsSelect={false}
            >
              <Stepper.Step
                label="Carrier"
                description="Select carrier"
                icon={<IconRouter size={16} />}
              />
              <Stepper.Step
                label="Issue"
                description="Issue type"
                icon={<IconListCheck size={16} />}
              />
              <Stepper.Step
                label="Device"
                description="Device model"
                icon={<IconDeviceMobile size={16} />}
              />
              <Stepper.Step
                label="Guide"
                description="Step-by-step"
                icon={<IconCheck size={16} />}
              />
            </Stepper>
          </Card>

          {/* 1. Carrier */}
          <Card withBorder radius="md" padding="lg">
            <Group justify="space-between" mb="sm">
              <div>
                <Text fw={700} size="sm">
                  1. Select a carrier
                </Text>
                <Text size="xs" c="dimmed">
                  ATT Wireless via vCom Buyers&apos; Club · OPUS portal
                </Text>
              </div>
              {carrier && (
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={() => resetFrom("carrier")}
                >
                  Change
                </Button>
              )}
            </Group>
            <Select
              placeholder="Choose carrier…"
              data={CARRIERS.map((c) => ({ value: c.value, label: c.label }))}
              value={carrier}
              onChange={(v) => {
                setCarrier((v as CarrierValue) || null);
                setIssueId(null);
                setDevice(null);
                setWizardState(null);
              }}
              searchable
              nothingFoundMessage="No carriers"
              leftSection={<IconRouter size={16} />}
              size="md"
            />
            {carrier && data && (
              <Group gap="xs" mt="sm" wrap="wrap">
                <Badge
                  color={data.source === "live" ? "green" : "yellow"}
                  variant="light"
                  size="sm"
                >
                  {data.source === "live"
                    ? "Live OPUS workflow"
                    : "Bundled fallback"}{" "}
                  · {data.issues.length} issues
                </Badge>
                {data.page_url && (
                  <Anchor href={data.page_url} target="_blank" size="xs">
                    {data.page_title || "OPUS Troubleshooting Workflow"} ↗
                  </Anchor>
                )}
                {data.portal_url && (
                  <Anchor href={data.portal_url} target="_blank" size="xs">
                    Open OPUS portal ↗
                  </Anchor>
                )}
                <Badge color="gray" variant="outline" size="sm">
                  Tier-1: {data.support_phone} · PIN {data.support_pin}
                </Badge>
                {cachedAt && (
                  <Text size="xs" c="dimmed">
                    Loaded {new Date(cachedAt).toLocaleTimeString()}
                  </Text>
                )}
              </Group>
            )}
          </Card>

          {/* 2. Issue */}
          {carrier && (
            <Card withBorder radius="md" padding="lg">
              <Group justify="space-between" mb="sm">
                <div>
                  <Text fw={700} size="sm">
                    2. Select an issue type
                  </Text>
                  <Text size="xs" c="dimmed">
                    {structuredIssueId
                      ? "Structured guided path available for this issue family"
                      : "Full step matrix is embedded in the app — nothing to open elsewhere"}
                  </Text>
                </div>
                {issueId && (
                  <Button
                    size="xs"
                    variant="subtle"
                    onClick={() => resetFrom("issue")}
                  >
                    Change
                  </Button>
                )}
              </Group>
              {loading && !data ? (
                <Group gap="sm">
                  <Loader size="sm" color={ACCENT} />
                  <Text size="sm" c="dimmed">
                    Loading OPUS Troubleshooting Workflow…
                  </Text>
                </Group>
              ) : (
                <Select
                  placeholder="Choose issue type…"
                  data={issueOptions}
                  value={issueId}
                  onChange={(v) => {
                    setIssueId(v);
                    setDevice(null);
                    setWizardState(null);
                  }}
                  searchable
                  nothingFoundMessage="No matching issue"
                  leftSection={<IconListCheck size={16} />}
                  size="md"
                  maxDropdownHeight={320}
                />
              )}
            </Card>
          )}

          {/* 3. Device */}
          {carrier && issueId && (
            <Card withBorder radius="md" padding="lg">
              <Group justify="space-between" mb="sm">
                <div>
                  <Text fw={700} size="sm">
                    3. Which device model is the customer using?
                  </Text>
                  <Text size="xs" c="dimmed">
                    {useWizardDevices
                      ? "iPhone / Samsung / Pixel / Data Only — drives device-specific notes"
                      : "Device-specific network-reset and roaming paths are shown next"}
                  </Text>
                </div>
                {device && (
                  <Button
                    size="xs"
                    variant="subtle"
                    onClick={() => resetFrom("device")}
                  >
                    Change
                  </Button>
                )}
              </Group>
              <Select
                placeholder="Choose device model…"
                data={deviceSelectOptions}
                value={device}
                onChange={(v) => {
                  setDevice((v as DeviceSelectValue) || null);
                  setWizardState(null);
                }}
                leftSection={<IconDeviceMobile size={16} />}
                size="md"
              />
            </Card>
          )}

          {/* 4. Guide */}
          {carrier && issueId && device && (
            <Card withBorder radius="md" padding="lg">
              <Group justify="space-between" mb="md">
                <div>
                  <Text fw={700} size="sm">
                    {wizardState
                      ? "4. Guided runbook (one step at a time)"
                      : "4. Simple step-by-step guide"}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {wizardState
                      ? "Complete the current step, then choose Yes it worked or Still an issue."
                      : `Legacy guide for ${
                          deviceSelectOptions.find((d) => d.value === device)
                            ?.label ?? "this device"
                        }. Structured wizard not available for this issue yet.`}
                  </Text>
                </div>
                {wizardState && (
                  <Badge color="teal" variant="light" size="sm">
                    Structured path · {wizardState.path.steps.length} steps
                  </Badge>
                )}
              </Group>
              <Divider mb="md" />
              {wizardState ? (
                <TroubleshootWizard
                  state={wizardState}
                  onChange={setWizardState}
                  onOtaClick={openOtaGuide}
                />
              ) : selectedIssue ? (
                <IssueGuideView
                  issue={selectedIssue}
                  device={toLegacyDevice(device)}
                  onOtaClick={openOtaGuide}
                />
              ) : (
                <Alert color="yellow" variant="light">
                  Could not resolve issue guide. Tap refresh and try again.
                </Alert>
              )}
            </Card>
          )}
        </Stack>
      </ScrollArea>
      <OtaGuideModal opened={otaOpen} onClose={() => setOtaOpen(false)} />
    </WidgetFrame>
  );
}
