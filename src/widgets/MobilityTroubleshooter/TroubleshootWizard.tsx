/**
 * One-step-at-a-time troubleshooting wizard (Option A engine).
 *
 * - checkOnly steps → single "Next step" button (NOC checklist only)
 * - action steps → Yes, it worked / Still an issue + customer templates
 */

import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Group,
  Progress,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconExternalLink,
  IconMail,
  IconPlayerPlay,
  IconRefresh,
  IconCircleCheck,
  IconAlertTriangle,
} from "@tabler/icons-react";
import {
  advanceCheckStep,
  currentStep,
  dismissTemplate,
  generateSummary,
  markStillIssue,
  markWorked,
  previewCurrentTemplate,
  progress,
  restartWizard,
  type WizardState,
} from "../../lib/troubleshooting";
import { DEVICE_LABELS } from "../../lib/troubleshooting/types";
import { CARRIER_LABELS } from "../../lib/troubleshooting/types";

const ACCENT = "violet";

function useCopyToClipboard(timeoutMs = 1800) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copy = useCallback(
    async (text: string, key: string) => {
      try {
        await navigator.clipboard?.writeText(text);
        setCopiedKey(key);
        window.setTimeout(() => {
          setCopiedKey((cur) => (cur === key ? null : cur));
        }, timeoutMs);
        return true;
      } catch {
        setCopiedKey(null);
        return false;
      }
    },
    [timeoutMs],
  );
  return { copiedKey, copy };
}

function TemplateCard({
  kind,
  text,
  onDismiss,
}: {
  kind: NonNullable<WizardState["templateKind"]>;
  text: string;
  onDismiss?: () => void;
}) {
  const { copiedKey, copy } = useCopyToClipboard();
  const isCopied = copiedKey === "template";

  const meta =
    kind === "resolved"
      ? {
          title: "Customer template — issue resolved",
          color: "teal" as const,
          hint: "Send this when the customer confirms it worked",
        }
      : kind === "escalation"
        ? {
            title: "Customer template — escalating",
            color: "orange" as const,
            hint: "All steps completed; share this while you escalate",
          }
        : {
            title: "Customer template — next steps",
            color: "blue" as const,
            hint: "What we did + what the customer should do next",
          };

  return (
    <Card
      withBorder
      radius="md"
      padding="sm"
      style={{
        background: `color-mix(in srgb, var(--mantine-color-${meta.color}-6) 8%, var(--mantine-color-body))`,
        borderColor: `color-mix(in srgb, var(--mantine-color-${meta.color}-6) 35%, var(--mantine-color-default-border))`,
      }}
    >
      <Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon color={meta.color} variant="light" radius="md" size={28}>
            <IconMail size={15} />
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Text size="sm" fw={700}>
              {meta.title}
            </Text>
            <Text size="xs" c="dimmed">
              {meta.hint}
            </Text>
          </div>
        </Group>
        <Group gap={6} wrap="nowrap">
          <Tooltip label={isCopied ? "Copied" : "Copy message"}>
            <Button
              size="xs"
              variant={isCopied ? "filled" : "light"}
              color={meta.color}
              leftSection={
                isCopied ? <IconCheck size={14} /> : <IconCopy size={14} />
              }
              onClick={() => void copy(text, "template")}
            >
              {isCopied ? "Copied" : "Copy"}
            </Button>
          </Tooltip>
          {onDismiss && (
            <Button size="xs" variant="subtle" color="gray" onClick={onDismiss}>
              Hide
            </Button>
          )}
        </Group>
      </Group>
      <Code
        block
        mt="sm"
        style={{
          whiteSpace: "pre-wrap",
          fontSize: 12,
          lineHeight: 1.5,
          maxHeight: 260,
          overflow: "auto",
          background: "var(--mantine-color-default)",
        }}
      >
        {text}
      </Code>
    </Card>
  );
}

export function TroubleshootWizard({
  state,
  onChange,
  onOtaClick,
}: {
  state: WizardState;
  onChange: (next: WizardState) => void;
  onOtaClick?: () => void;
}) {
  const step = currentStep(state);
  const { current, total, isLast } = progress(state);
  const stepLabel = step.displayOrderLabel ?? String(current);
  const progressPct = Math.round((current / Math.max(total, 1)) * 100);
  const deviceNotes = step.deviceNotes?.[state.device] ?? [];
  const isCheckOnly = !!step.checkOnly;
  const resolvedLabel = step.outcomeLabels?.resolved ?? "Yes, it worked";
  const continueLabel = step.outcomeLabels?.continue
    ?? (isLast ? "Still an issue — finish runbook" : "Still an issue, proceed");
  const isSummaryStep = isLast && !isCheckOnly;
  const mentionsOta =
    step.instructions.some((i) => /\bOTA\b/i.test(i)) ||
    /\bOTA\b/i.test(step.title);
  const inlineTemplate = isCheckOnly
    ? previewCurrentTemplate(state, "continue")
    : null;
  const resolvedPreview = !isCheckOnly
    ? previewCurrentTemplate(state, "resolved")
    : null;
  const continuePreview = !isCheckOnly
    ? previewCurrentTemplate(state, isLast ? "escalation" : "continue")
    : null;

  const statusBanner = useMemo(() => {
    if (state.status === "resolved") {
      return {
        color: "teal" as const,
        icon: <IconCircleCheck size={16} />,
        title: "Marked resolved",
        body: "Send the customer template below, then close or note the ticket.",
      };
    }
    if (state.status === "escalated") {
      return {
        color: "orange" as const,
        icon: <IconAlertTriangle size={16} />,
        title: "End of runbook — escalate if still broken",
        body: "All structured steps are complete. Use the template and continue with carrier / warranty process as needed.",
      };
    }
    return null;
  }, [state.status]);

  return (
    <Stack gap="md">
      <Group gap="xs" wrap="wrap">
        <Badge color={ACCENT} variant="light" size="sm">
          {state.path.title}
        </Badge>
        <Badge color="gray" variant="outline" size="sm">
          {CARRIER_LABELS[state.carrier]}
        </Badge>
        <Badge color="gray" variant="outline" size="sm">
          {DEVICE_LABELS[state.device]}
        </Badge>
        <Badge color={ACCENT} variant="filled" size="sm">
          Step {stepLabel} of {total}
        </Badge>
        {state.path.sourceUrl && (
          <Anchor href={state.path.sourceUrl} target="_blank" size="xs">
            <Group gap={4}>
              Confluence / OPUS
              <IconExternalLink size={12} />
            </Group>
          </Anchor>
        )}
      </Group>

      <div>
        <Group justify="space-between" mb={6}>
          <Text size="xs" c="dimmed" fw={600}>
            Progress
          </Text>
          <Text size="xs" c="dimmed">
            {progressPct}%
          </Text>
        </Group>
        <Progress value={progressPct} color={ACCENT} size="sm" radius="xl" />
      </div>

      {statusBanner && (
        <Alert
          icon={statusBanner.icon}
          color={statusBanner.color}
          variant="light"
          radius="md"
        >
          <Text size="sm" fw={700}>
            {statusBanner.title}
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            {statusBanner.body}
          </Text>
        </Alert>
      )}

      {state.activeTemplate && state.templateKind && state.status !== "in_progress" && (
        <TemplateCard
          kind={state.templateKind}
          text={state.activeTemplate}
          onDismiss={() => onChange(dismissTemplate(state))}
        />
      )}

      {state.status === "in_progress" && (
        <Card withBorder radius="md" padding="md">
          <Group gap="sm" mb="md" align="flex-start" wrap="nowrap">
            <ThemeIcon color={ACCENT} variant="filled" radius="xl" size={36}>
              <Text size="sm" fw={800}>
                {stepLabel}
              </Text>
            </ThemeIcon>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Group gap="xs" wrap="wrap" mb={2}>
                <Text fw={700} size="md">
                  {step.title}
                </Text>
                {isCheckOnly && (
                  <Badge size="xs" color="gray" variant="light">
                    NOC check
                  </Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {isCheckOnly
                  ? "Complete the NOC checks below, then continue to the next step"
                  : isSummaryStep
                    ? "Complete the final NOC actions below, then generate the troubleshooting summary"
                    : "Complete the NOC actions below, then choose an outcome"}
              </Text>
            </div>
            <Stack gap={6} align="flex-end" style={{ flexShrink: 0 }}>
              {(step.helpLinks ?? []).map((link) => (
                <Anchor
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  size="sm"
                  fw={600}
                  style={{ whiteSpace: "nowrap" }}
                >
                  <Group gap={4} wrap="nowrap">
                    {link.label}
                    <IconExternalLink size={12} />
                  </Group>
                </Anchor>
              ))}
              {mentionsOta && onOtaClick && (
                <Button
                  size="xs"
                  variant="light"
                  color={ACCENT}
                  onClick={onOtaClick}
                >
                  OTA guide
                </Button>
              )}
            </Stack>
          </Group>

          <Stack gap="sm" mb="md">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed">
              NOC actions
            </Text>
            {step.instructions.map((line, i) => (
              <Group key={i} align="flex-start" gap="sm" wrap="nowrap">
                <ThemeIcon
                  size={24}
                  radius="xl"
                  color={ACCENT}
                  variant="light"
                  style={{ flexShrink: 0 }}
                >
                  <Text size="xs" fw={700}>
                    {i + 1}
                  </Text>
                </ThemeIcon>
                <Text size="sm" style={{ lineHeight: 1.5, paddingTop: 2 }}>
                  {line}
                </Text>
              </Group>
            ))}
          </Stack>

          {deviceNotes.length > 0 && (
            <Box
              mb="md"
              p="sm"
              style={{
                borderRadius: 8,
                background:
                  "color-mix(in srgb, var(--mantine-color-violet-6) 10%, var(--mantine-color-body))",
                border:
                  "1px solid color-mix(in srgb, var(--mantine-color-violet-6) 25%, var(--mantine-color-default-border))",
              }}
            >
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>
                {DEVICE_LABELS[state.device]} — customer device steps
              </Text>
              <Stack gap={6}>
                {deviceNotes.map((n, i) => (
                  <Text key={i} size="sm">
                    {i + 1}. {n}
                  </Text>
                ))}
              </Stack>
            </Box>
          )}

          {inlineTemplate && (
            <Box mb="md">
              <TemplateCard
                kind={isCheckOnly ? "continue" : "resolved"}
                text={inlineTemplate}
              />
            </Box>
          )}

          {!isCheckOnly && (resolvedPreview || continuePreview) && (
            <Stack gap="sm" mb="md">
              {resolvedPreview && (
                <Box>
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>
                    Email template after step 7A
                  </Text>
                  <TemplateCard kind="resolved" text={resolvedPreview} />
                </Box>
              )}
              {continuePreview && (
                <Box>
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>
                    Email template after step 7B
                  </Text>
                  <TemplateCard
                    kind={isLast ? "escalation" : "continue"}
                    text={continuePreview}
                  />
                </Box>
              )}
            </Stack>
          )}

          {isSummaryStep && state.generatedSummary && (
            <Box mb="md">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>
                Ticket summary update
              </Text>
              <TemplateCard kind="continue" text={state.generatedSummary} />
            </Box>
          )}

          {isCheckOnly ? (
            <>
              <Text size="xs" c="dimmed" ta="center" mb="sm" mt="xs">
                Checklist complete?
              </Text>
              <Group grow preventGrowOverflow={false} gap="sm">
                <Button
                  variant="subtle"
                  color="gray"
                  leftSection={<IconChevronLeft size={16} />}
                  disabled={current <= 1}
                  onClick={() =>
                    onChange({
                      ...state,
                      currentStepIndex: Math.max(0, state.currentStepIndex - 1),
                      activeTemplate: null,
                      templateKind: null,
                      status: "in_progress",
                    })
                  }
                >
                  Previous step
                </Button>
                <Button
                  color={ACCENT}
                  variant="filled"
                  rightSection={<IconChevronRight size={16} />}
                  onClick={() => onChange(advanceCheckStep(state))}
                >
                  {isLast ? "Finish runbook" : "Next step"}
                </Button>
              </Group>
            </>
          ) : isSummaryStep ? (
            <>
              <Text size="xs" c="dimmed" ta="center" mb="sm" mt="xs">
                Final step actions
              </Text>
              <Group grow preventGrowOverflow={false} gap="sm">
                <Button
                  variant="subtle"
                  color="gray"
                  leftSection={<IconChevronLeft size={16} />}
                  disabled={current <= 1}
                  onClick={() =>
                    onChange({
                      ...state,
                      currentStepIndex: Math.max(0, state.currentStepIndex - 1),
                      activeTemplate: null,
                      templateKind: null,
                      status: "in_progress",
                      generatedSummary: null,
                    })
                  }
                >
                  Previous step
                </Button>
              </Group>
              <Group grow preventGrowOverflow={false} gap="sm" mt="sm">
                <Button
                  color={ACCENT}
                  variant="filled"
                  rightSection={<IconChevronRight size={16} />}
                  onClick={() => onChange(generateSummary(state))}
                >
                  Generate Summary
                </Button>
              </Group>
            </>
          ) : (
            <>
              <Text size="xs" c="dimmed" ta="center" mb="sm" mt="xs">
                Outcome for this step
              </Text>
              <Group grow preventGrowOverflow={false} gap="sm">
                <Button
                  variant="subtle"
                  color="gray"
                  leftSection={<IconChevronLeft size={16} />}
                  disabled={current <= 1}
                  onClick={() =>
                    onChange({
                      ...state,
                      currentStepIndex: Math.max(0, state.currentStepIndex - 1),
                      activeTemplate: null,
                      templateKind: null,
                      status: "in_progress",
                      generatedSummary: null,
                    })
                  }
                >
                  Previous step
                </Button>
              </Group>
              <Group grow preventGrowOverflow={false} gap="sm" mt="sm">
                <Button
                  color="teal"
                  variant="filled"
                  leftSection={<IconCheck size={16} />}
                  onClick={() => onChange(markWorked(state))}
                >
                  {resolvedLabel}
                </Button>
                <Button
                  color={ACCENT}
                  variant="light"
                  rightSection={
                    isLast ? (
                      <IconAlertTriangle size={16} />
                    ) : (
                      <IconChevronRight size={16} />
                    )
                  }
                  onClick={() => onChange(markStillIssue(state))}
                >
                  {continueLabel}
                </Button>
              </Group>
            </>
          )}
        </Card>
      )}

      {state.status !== "in_progress" && (
        <Group gap="sm">
          <Button
            variant="light"
            color={ACCENT}
            leftSection={<IconRefresh size={16} />}
            onClick={() => onChange(restartWizard(state))}
          >
            Restart this runbook
          </Button>
          {state.status === "resolved" && !isLast && (
            <Button
              variant="subtle"
              color="gray"
              leftSection={<IconPlayerPlay size={16} />}
              onClick={() =>
                onChange({
                  ...state,
                  status: "in_progress",
                  currentStepIndex: state.currentStepIndex + 1,
                  activeTemplate: null,
                  templateKind: null,
                })
              }
            >
              Continue to next step anyway
            </Button>
          )}
        </Group>
      )}
    </Stack>
  );
}
