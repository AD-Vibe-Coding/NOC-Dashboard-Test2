import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  MultiSelect,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import {
  IconArrowRight,
  IconBulb,
  IconCheck,
  IconCopy,
  IconCpu,
  IconDatabase,
  IconInfoCircle,
  IconLink,
  IconRocket,
  IconTargetArrow,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";

export { BuildingAppsAgentsTile } from "./Tile";

type BuilderType = "App" | "AI Agent" | "Workflow Automation" | "Assistant / Copilot";
type Maturity = "Idea" | "Shaping" | "Ready to review";
type Effort = "Low" | "Medium" | "High";
type Confidence = "Low" | "Medium" | "High";

type StarterState = {
  title: string;
  type: BuilderType;
  audience: string;
  maturity: Maturity;
  problem: string;
  whyNow: string;
  currentWorkaround: string;
  desiredOutcome: string;
  coreJobs: string[];
  keepManual: string;
  successLooksLike: string;
  dataNeeded: string;
  systems: string[];
  otherSystems: string;
  integrationsNeeded: string;
  trigger: string;
  effort: Effort;
  confidence: Confidence;
  timeToday: number | null;
  timeAfter: number | null;
  monthlyVolume: number | null;
  monthlyCost: number | null;
  implementationCost: number | null;
  monthlyRunCost: number | null;
  openQuestions: string[];
  nextStep: string;
};

const SYSTEM_OPTIONS = [
  "Google Sheet",
  "Google Drive",
  "Slack",
  "iPath",
  "SharePoint",
  "Excel / CSV",
  "Email",
  "API",
  "Ticketing System",
  "Database",
  "CRM",
  "Documents",
  "Other",
];

const JOB_SUGGESTIONS = [
  "Answer repeat questions",
  "Summarize inputs",
  "Draft updates or emails",
  "Look up data across systems",
  "Recommend next actions",
  "Trigger a workflow step",
  "Create a report or dashboard",
  "Flag risks or exceptions",
];

const QUESTION_STARTERS = [
  "What data is still missing?",
  "Who needs to approve the outcome?",
  "Which step is highest risk if automated?",
  "What would make this obviously useful in week 1?",
  "What integration is most uncertain?",
];

const STORAGE_KEY = "building-apps-agents-draft";

const DEFAULT_STATE: StarterState = {
  title: "",
  type: "AI Agent",
  audience: "",
  maturity: "Idea",
  problem: "",
  whyNow: "",
  currentWorkaround: "",
  desiredOutcome: "",
  coreJobs: [JOB_SUGGESTIONS[0]],
  keepManual: "",
  successLooksLike: "",
  dataNeeded: "",
  systems: [],
  otherSystems: "",
  integrationsNeeded: "",
  trigger: "",
  effort: "Medium",
  confidence: "Medium",
  timeToday: null,
  timeAfter: null,
  monthlyVolume: null,
  monthlyCost: null,
  implementationCost: null,
  monthlyRunCost: null,
  openQuestions: [QUESTION_STARTERS[0]],
  nextStep: "Clarify business problem and confirm one real first use case.",
};

function formatMoney(value: number | null) {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatHours(value: number | null) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(value >= 10 ? 0 : 1)} hrs`;
}

function perMonthHours(minutes: number | null, volume: number | null) {
  if (minutes == null || volume == null) return null;
  return (minutes * volume) / 60;
}

function SectionCard({
  title,
  icon,
  children,
  helper,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number }>;
  children: React.ReactNode;
  helper: string;
}) {
  const Icon = icon;
  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap="md">
        <Group gap="sm" align="flex-start">
          <ThemeIcon color="blue" variant="light" radius="md">
            <Icon size={18} />
          </ThemeIcon>
          <div style={{ flex: 1 }}>
            <Text fw={700}>{title}</Text>
            <Text size="sm" c="dimmed">{helper}</Text>
          </div>
        </Group>
        {children}
      </Stack>
    </Card>
  );
}

function scoreColor(score: number) {
  if (score >= 75) return "green";
  if (score >= 45) return "yellow";
  return "red";
}

export function BuildingAppsAgentsWidget() {
  const [state, setState] = useState<StarterState>(DEFAULT_STATE);
  const [showNextStep, setShowNextStep] = useState(false);
  const [copied, setCopied] = useState<"prompt" | "summary" | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { state?: Partial<StarterState>; savedAt?: string };
      if (parsed.state) {
        setState({ ...DEFAULT_STATE, ...parsed.state });
      }
      if (parsed.savedAt) {
        setSavedAt(parsed.savedAt);
      }
    } catch {
      // ignore corrupted draft payloads
    }
  }, []);

  const monthlyHoursToday = useMemo(() => perMonthHours(state.timeToday, state.monthlyVolume), [state.timeToday, state.monthlyVolume]);
  const monthlyHoursAfter = useMemo(() => perMonthHours(state.timeAfter, state.monthlyVolume), [state.timeAfter, state.monthlyVolume]);
  const monthlyHoursSaved = useMemo(() => {
    if (monthlyHoursToday == null || monthlyHoursAfter == null) return null;
    return Math.max(monthlyHoursToday - monthlyHoursAfter, 0);
  }, [monthlyHoursAfter, monthlyHoursToday]);

  const annualHoursSaved = useMemo(() => {
    if (monthlyHoursSaved == null) return null;
    return monthlyHoursSaved * 12;
  }, [monthlyHoursSaved]);

  const annualNetValue = useMemo(() => {
    if (state.monthlyCost == null || state.monthlyRunCost == null || state.implementationCost == null) return null;
    return state.monthlyCost * 12 - state.monthlyRunCost * 12 - state.implementationCost;
  }, [state.implementationCost, state.monthlyCost, state.monthlyRunCost]);

  const helperWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (!state.problem.trim()) warnings.push("No clear business problem entered yet.");
    if (!state.desiredOutcome.trim()) warnings.push("The desired outcome is still too vague for a build conversation.");
    if (state.systems.length === 0) warnings.push("No data source or system selected yet.");
    if (state.timeToday == null || state.timeAfter == null || state.monthlyVolume == null) warnings.push("Value estimate is incomplete — add time and volume to show likely impact.");
    if (state.systems.includes("Other") && !state.otherSystems.trim()) warnings.push("You selected Other under systems involved — add the system name.");
    if (!state.nextStep.trim()) warnings.push("No recommended next step defined.");
    return warnings;
  }, [state]);

  const businessClarity = useMemo(() => {
    const checks = [state.title, state.problem, state.whyNow, state.desiredOutcome, state.audience].filter((value) => value.trim().length > 0).length;
    return Math.round((checks / 5) * 100);
  }, [state]);

  const solutionClarity = useMemo(() => {
    const checks = [state.coreJobs.filter(Boolean).length > 0, !!state.keepManual.trim(), !!state.successLooksLike.trim(), !!state.trigger.trim()].filter(Boolean).length;
    return Math.round((checks / 4) * 100);
  }, [state]);

  const feasibility = useMemo(() => {
    const checks = [
      state.systems.length > 0,
      !state.systems.includes("Other") || !!state.otherSystems.trim(),
      !!state.dataNeeded.trim(),
      !!state.integrationsNeeded.trim(),
    ].filter(Boolean).length;
    return Math.round((checks / 4) * 100);
  }, [state]);

  const actionReadiness = useMemo(() => {
    const checks = [helperWarnings.length === 0, !!state.nextStep.trim(), annualNetValue != null].filter(Boolean).length;
    return Math.round((checks / 3) * 100);
  }, [annualNetValue, helperWarnings.length, state.nextStep]);

  const executiveSummary = useMemo(() => {
    return [
      state.title ? `${state.title} is proposed as a ${state.type.toLowerCase()}.` : "A new app/agent idea is being shaped.",
      state.problem ? `It addresses: ${state.problem}` : "The problem still needs to be clarified.",
      state.desiredOutcome ? `Target outcome: ${state.desiredOutcome}` : "Outcome is not defined yet.",
      annualHoursSaved != null ? `Estimated annual hours saved: ${annualHoursSaved.toFixed(0)}.` : "Savings estimate not available yet.",
    ].join(" ");
  }, [annualHoursSaved, state.desiredOutcome, state.problem, state.title, state.type]);

  const resolvedSystems = useMemo(() => {
    const base = state.systems.filter((system) => system !== "Other");
    return state.otherSystems.trim() ? [...base, state.otherSystems.trim()] : base;
  }, [state.otherSystems, state.systems]);

  const reviewerSummary = useMemo(() => {
    return [
      `Idea: ${state.title || "Untitled concept"}`,
      `Type: ${state.type}`,
      `Users: ${state.audience || "Not defined"}`,
      `Problem: ${state.problem || "Not defined"}`,
      `Outcome: ${state.desiredOutcome || "Not defined"}`,
      `Core jobs: ${state.coreJobs.filter(Boolean).join(", ") || "Not defined"}`,
      `Systems: ${resolvedSystems.join(", ") || "Not defined"}`,
      `Trigger: ${state.trigger || "Not defined"}`,
      `Effort: ${state.effort}`,
      `Confidence: ${state.confidence}`,
      `Annual hours saved: ${formatHours(annualHoursSaved)}`,
      `Net value estimate: ${formatMoney(annualNetValue)}`,
      `Next step: ${state.nextStep || "Not defined"}`,
    ].join("\n");
  }, [annualHoursSaved, annualNetValue, resolvedSystems, state]);

  const generatedPrompt = useMemo(() => {
    const typeInstruction = state.type === "AI Agent"
      ? "Design an AI agent"
      : state.type === "App"
        ? "Design an app"
        : state.type === "Workflow Automation"
          ? "Design a workflow automation"
          : "Design an assistant / copilot";

    return `${typeInstruction} based on the following planning notes.

Name:
${state.title || "Untitled concept"}

Primary users:
${state.audience || "Not defined"}

Business problem:
${state.problem || "Not defined"}

Why now:
${state.whyNow || "Not defined"}

Current workaround:
${state.currentWorkaround || "Not defined"}

Desired outcome:
${state.desiredOutcome || "Not defined"}

Core jobs to perform:
${state.coreJobs.filter(Boolean).map((job) => `- ${job}`).join("\n") || "- Not defined"}

What should remain manual:
${state.keepManual || "Not defined"}

What success looks like:
${state.successLooksLike || "Not defined"}

Data needed:
${state.dataNeeded || "Not defined"}

Systems involved:
${resolvedSystems.map((system) => `- ${system}`).join("\n") || "- Not defined"}

Likely integrations:
${state.integrationsNeeded || "Not defined"}

Typical trigger:
${state.trigger || "Not defined"}

Estimated effort:
${state.effort}

Confidence in feasibility:
${state.confidence}

Value estimate:
- Current time per task: ${state.timeToday ?? "Not defined"} minutes
- Expected time after solution: ${state.timeAfter ?? "Not defined"} minutes
- Monthly volume: ${state.monthlyVolume ?? "Not defined"}
- Annual hours saved: ${annualHoursSaved == null ? "Not defined" : annualHoursSaved.toFixed(0)}
- Net value estimate: ${formatMoney(annualNetValue)}

Open questions:
${state.openQuestions.filter((question) => question.trim()).map((question) => `- ${question}`).join("\n") || "- None listed"}

Recommended next step:
${state.nextStep || "Not defined"}

Please turn this into a practical solution plan with:
1. a concise solution concept
2. core features / behaviors
3. suggested user flow
4. required data and integrations
5. risks / assumptions
6. an MVP scope recommendation`;
  }, [annualHoursSaved, annualNetValue, resolvedSystems, state]);

  async function handleCopy(value: string, type: "prompt" | "summary") {
    await navigator.clipboard.writeText(value);
    setCopied(type);
    window.setTimeout(() => setCopied((current) => (current === type ? null : current)), 1500);
  }

  function saveDraft(nextState: StarterState) {
    if (typeof window === "undefined") return;
    const timestamp = new Date().toISOString();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: nextState, savedAt: timestamp }));
    setSavedAt(timestamp);
  }

  function handleNextStep() {
    saveDraft(state);
    setShowNextStep(true);
  }

  function handleReset() {
    setState(DEFAULT_STATE);
    setShowNextStep(false);
    setCopied(null);
    setSavedAt(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }

  return (
    <WidgetFrame
      title="Building Apps / Agents"
      subtitle="Starter workspace for shaping ideas before a build request"
      icon={IconCpu}
      iconColor="blue"
      status={{ label: state.maturity, color: state.maturity === "Ready to review" ? "green" : state.maturity === "Shaping" ? "yellow" : "gray" }}
      headerActions={<Button size="xs" variant="light" onClick={handleReset}>Reset</Button>}
    >
      <Stack gap="lg">
        <Card withBorder radius="lg" p="lg">
          <Group justify="space-between" align="flex-start" gap="md">
            <div style={{ flex: 1 }}>
              <Text fw={700} size="lg">Helpful starting point, not a formal intake</Text>
              <Text size="sm" c="dimmed" mt={4}>
                Use this workspace to shape an idea clearly, estimate value quickly, and give managers a clean overview of what the team is asking to build.
              </Text>
              {savedAt ? (
                <Text size="xs" c="dimmed" mt={6}>Draft saved {new Date(savedAt).toLocaleString()}</Text>
              ) : null}
            </div>
            <SegmentedControl
              value={state.maturity}
              onChange={(value) => setState({ ...state, maturity: value as Maturity })}
              data={["Idea", "Shaping", "Ready to review"]}
            />
          </Group>
        </Card>

        {helperWarnings.length > 0 ? (
          <Alert icon={<IconInfoCircle size={16} />} color="yellow" variant="light" title="What still needs clarification">
            <Stack gap={4}>
              {helperWarnings.map((warning) => (
                <Text key={warning} size="sm">• {warning}</Text>
              ))}
            </Stack>
          </Alert>
        ) : null}

        <SimpleGrid cols={{ base: 1, md: 4 }} spacing="md">
          <Card withBorder radius="lg" p="md"><Text size="xs" tt="uppercase" fw={700} c="dimmed">Business clarity</Text><Text fw={800} size="xl" c={`${scoreColor(businessClarity)}.6`}>{businessClarity}%</Text></Card>
          <Card withBorder radius="lg" p="md"><Text size="xs" tt="uppercase" fw={700} c="dimmed">Solution clarity</Text><Text fw={800} size="xl" c={`${scoreColor(solutionClarity)}.6`}>{solutionClarity}%</Text></Card>
          <Card withBorder radius="lg" p="md"><Text size="xs" tt="uppercase" fw={700} c="dimmed">Feasibility</Text><Text fw={800} size="xl" c={`${scoreColor(feasibility)}.6`}>{feasibility}%</Text></Card>
          <Card withBorder radius="lg" p="md"><Text size="xs" tt="uppercase" fw={700} c="dimmed">Action readiness</Text><Text fw={800} size="xl" c={`${scoreColor(actionReadiness)}.6`}>{actionReadiness}%</Text></Card>
        </SimpleGrid>

        <ScrollArea.Autosize mah={900} offsetScrollbars>
          <Stack gap="lg">
            <SectionCard title="1. Idea snapshot" icon={IconBulb} helper="Capture the core idea in plain language so anyone can understand it in under a minute.">
              <SimpleGrid cols={{ base: 1, md: 2 }}>
                <TextInput label="Idea name" placeholder="e.g. Maintenance window copilot" value={state.title} onChange={(e) => setState({ ...state, title: e.currentTarget.value })} />
                <Select label="Build type" data={["App", "AI Agent", "Workflow Automation", "Assistant / Copilot"]} value={state.type} onChange={(value) => setState({ ...state, type: (value as BuilderType) || "AI Agent" })} />
                <TextInput label="Primary users" placeholder="Who will use this first?" value={state.audience} onChange={(e) => setState({ ...state, audience: e.currentTarget.value })} />
              </SimpleGrid>
              <Textarea label="Problem to solve" minRows={3} placeholder="What is frustrating, slow, repetitive, or hard today?" value={state.problem} onChange={(e) => setState({ ...state, problem: e.currentTarget.value })} />
              <Textarea label="Why now?" minRows={2} placeholder="Why is this worth attention now instead of later?" value={state.whyNow} onChange={(e) => setState({ ...state, whyNow: e.currentTarget.value })} />
              <Textarea label="Current workaround" minRows={2} placeholder="How is the team handling this today?" value={state.currentWorkaround} onChange={(e) => setState({ ...state, currentWorkaround: e.currentTarget.value })} />
              <Textarea label="Desired outcome" minRows={2} placeholder="What should be noticeably better if this gets built?" value={state.desiredOutcome} onChange={(e) => setState({ ...state, desiredOutcome: e.currentTarget.value })} />
            </SectionCard>

            <SectionCard title="2. What should it actually do?" icon={IconRocket} helper="Keep this practical. Think in terms of helpful jobs, not a huge feature list.">
              <MultiSelect
                label="Core jobs"
                data={[...JOB_SUGGESTIONS, ...state.coreJobs.filter((value) => !JOB_SUGGESTIONS.includes(value))]}
                value={state.coreJobs}
                onChange={(value) => setState({ ...state, coreJobs: value })}
                searchable
              />
              <Textarea label="What should stay manual?" minRows={2} placeholder="Which parts should remain with a human?" value={state.keepManual} onChange={(e) => setState({ ...state, keepManual: e.currentTarget.value })} />
              <Textarea label="What does good look like?" minRows={2} placeholder="How would a user say this is working well?" value={state.successLooksLike} onChange={(e) => setState({ ...state, successLooksLike: e.currentTarget.value })} />
              <TextInput label="Typical trigger" placeholder="Manual request, scheduled run, event, new ticket, etc." value={state.trigger} onChange={(e) => setState({ ...state, trigger: e.currentTarget.value })} />
            </SectionCard>

            <SectionCard title="3. Data and systems" icon={IconDatabase} helper="This is a quick feasibility check, not a technical spec. Just identify what the solution would need to touch.">
              <Textarea label="Data needed" minRows={2} placeholder="What data would this need to read or write?" value={state.dataNeeded} onChange={(e) => setState({ ...state, dataNeeded: e.currentTarget.value })} />
              <MultiSelect label="Systems involved" data={SYSTEM_OPTIONS} value={state.systems} onChange={(value) => setState({ ...state, systems: value })} searchable />
              {state.systems.includes("Other") ? (
                <TextInput
                  label="Other system name"
                  placeholder="Enter the system name"
                  value={state.otherSystems}
                  onChange={(e) => setState({ ...state, otherSystems: e.currentTarget.value })}
                />
              ) : null}
              <Textarea label="Likely integrations" minRows={2} placeholder="APIs, files, email, SharePoint, database queries, etc." value={state.integrationsNeeded} onChange={(e) => setState({ ...state, integrationsNeeded: e.currentTarget.value })} />
              <SimpleGrid cols={{ base: 1, md: 2 }}>
                <Select label="Estimated effort" data={["Low", "Medium", "High"]} value={state.effort} onChange={(value) => setState({ ...state, effort: (value as Effort) || "Medium" })} />
                <Select label="Confidence in feasibility" data={["Low", "Medium", "High"]} value={state.confidence} onChange={(value) => setState({ ...state, confidence: (value as Confidence) || "Medium" })} />
              </SimpleGrid>
            </SectionCard>

            <SectionCard title="4. Quick value estimate" icon={IconTargetArrow} helper="Give people a simple way to judge whether the idea is worth deeper design or build time.">
              <SimpleGrid cols={{ base: 1, md: 3 }}>
                <NumberInput label="Current time per task (minutes)" value={state.timeToday ?? undefined} onChange={(value) => setState({ ...state, timeToday: typeof value === "number" ? value : null })} min={0} />
                <NumberInput label="Expected time after solution (minutes)" value={state.timeAfter ?? undefined} onChange={(value) => setState({ ...state, timeAfter: typeof value === "number" ? value : null })} min={0} />
                <NumberInput label="Monthly volume" value={state.monthlyVolume ?? undefined} onChange={(value) => setState({ ...state, monthlyVolume: typeof value === "number" ? value : null })} min={0} />
                <NumberInput label="Current monthly cost" value={state.monthlyCost ?? undefined} onChange={(value) => setState({ ...state, monthlyCost: typeof value === "number" ? value : null })} min={0} prefix="$" />
                <NumberInput label="One-time implementation cost" value={state.implementationCost ?? undefined} onChange={(value) => setState({ ...state, implementationCost: typeof value === "number" ? value : null })} min={0} prefix="$" />
                <NumberInput label="New monthly run cost" value={state.monthlyRunCost ?? undefined} onChange={(value) => setState({ ...state, monthlyRunCost: typeof value === "number" ? value : null })} min={0} prefix="$" />
              </SimpleGrid>
              <SimpleGrid cols={{ base: 1, md: 4 }}>
                <Card withBorder radius="md" p="md"><Text size="xs" tt="uppercase" fw={700} c="dimmed">Monthly hours today</Text><Text fw={800}>{formatHours(monthlyHoursToday)}</Text></Card>
                <Card withBorder radius="md" p="md"><Text size="xs" tt="uppercase" fw={700} c="dimmed">Monthly hours after</Text><Text fw={800}>{formatHours(monthlyHoursAfter)}</Text></Card>
                <Card withBorder radius="md" p="md"><Text size="xs" tt="uppercase" fw={700} c="dimmed">Annual hours saved</Text><Text fw={800}>{formatHours(annualHoursSaved)}</Text></Card>
                <Card withBorder radius="md" p="md"><Text size="xs" tt="uppercase" fw={700} c="dimmed">Net value after build/run cost</Text><Text fw={800}>{formatMoney(annualNetValue)}</Text></Card>
              </SimpleGrid>
            </SectionCard>

            <SectionCard title="5. Open questions" icon={IconLink} helper="Capture the few questions that would unblock the idea fastest.">
              <Stack gap="sm">
                {state.openQuestions.map((question, index) => (
                  <Group key={`question-${index}`} align="flex-start">
                    <Textarea
                      style={{ flex: 1 }}
                      minRows={2}
                      value={question}
                      placeholder="What still needs to be answered?"
                      onChange={(e) => {
                        const next = [...state.openQuestions];
                        next[index] = e.currentTarget.value;
                        setState({ ...state, openQuestions: next });
                      }}
                    />
                    <Button variant="subtle" color="red" onClick={() => setState({ ...state, openQuestions: state.openQuestions.filter((_, i) => i !== index) })}>Remove</Button>
                  </Group>
                ))}
                <Button variant="light" onClick={() => setState({ ...state, openQuestions: [...state.openQuestions, ""] })}>Add question</Button>
              </Stack>
            </SectionCard>
          </Stack>
        </ScrollArea.Autosize>

        <Divider />

        <Card withBorder radius="lg" p="lg">
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Text fw={700}>Executive summary</Text>
              <Badge color={helperWarnings.length === 0 ? "green" : "yellow"} variant="light">
                {helperWarnings.length === 0 ? "Ready to discuss" : "Needs shaping"}
              </Badge>
            </Group>
            <Text size="sm">{executiveSummary}</Text>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <Card withBorder radius="md" p="md">
                <Stack gap={6}>
                  <Text size="xs" tt="uppercase" fw={700} c="dimmed">Decision snapshot</Text>
                  <Text size="sm"><strong>Type:</strong> {state.type}</Text>
                  <Text size="sm"><strong>Users:</strong> {state.audience || "—"}</Text>
                  <Text size="sm"><strong>Effort:</strong> {state.effort}</Text>
                  <Text size="sm"><strong>Feasibility confidence:</strong> {state.confidence}</Text>
                </Stack>
              </Card>
              <Card withBorder radius="md" p="md">
                <Stack gap={6}>
                  <Text size="xs" tt="uppercase" fw={700} c="dimmed">Recommended conversation</Text>
                  <Text size="sm">1. Confirm the first use case and expected outcome.</Text>
                  <Text size="sm">2. Validate the data path and trigger.</Text>
                  <Text size="sm">3. Decide whether this needs a lightweight prototype or full build review.</Text>
                </Stack>
              </Card>
            </SimpleGrid>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">Use this widget to shape a strong idea quickly, then take only the necessary details into the next planning conversation.</Text>
              <Button rightSection={<IconArrowRight size={16} />} onClick={handleNextStep}>
                Save + next step
              </Button>
            </Group>
          </Stack>
        </Card>

        {showNextStep ? (
          <Card withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <div>
                  <Text fw={700}>Saved output</Text>
                  <Text size="sm" c="dimmed">Your worksheet is saved and turned into ready-to-use outputs.</Text>
                </div>
                <Badge variant="light" color="green">Saved</Badge>
              </Group>

              <SimpleGrid cols={{ base: 1, md: 2 }}>
                <Card withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <Text fw={700}>Reviewer summary</Text>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={copied === "summary" ? <IconCheck size={14} /> : <IconCopy size={14} />}
                        onClick={() => void handleCopy(reviewerSummary, "summary")}
                      >
                        {copied === "summary" ? "Copied" : "Copy summary"}
                      </Button>
                    </Group>
                    <Textarea value={reviewerSummary} minRows={14} autosize readOnly />
                  </Stack>
                </Card>

                <Card withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <Text fw={700}>Generated App / Agent prompt</Text>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={copied === "prompt" ? <IconCheck size={14} /> : <IconCopy size={14} />}
                        onClick={() => void handleCopy(generatedPrompt, "prompt")}
                      >
                        {copied === "prompt" ? "Copied" : "Copy prompt"}
                      </Button>
                    </Group>
                    <Textarea value={generatedPrompt} minRows={14} autosize readOnly />
                  </Stack>
                </Card>
              </SimpleGrid>
            </Stack>
          </Card>
        ) : null}

        {showNextStep ? (
          <Card withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <div>
                  <Text fw={700}>Next-step output</Text>
                  <Text size="sm" c="dimmed">Use this summary for a manager/dev conversation, and use the generated prompt to start building the app or agent.</Text>
                </div>
                <Badge variant="light" color={helperWarnings.length === 0 ? "green" : "yellow"}>
                  {helperWarnings.length === 0 ? "Ready to use" : "Usable, but incomplete"}
                </Badge>
              </Group>

              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                <Card withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <Text fw={700}>Reviewer summary</Text>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={copied === "summary" ? <IconCheck size={14} /> : <IconCopy size={14} />}
                        onClick={() => void handleCopy(reviewerSummary, "summary")}
                      >
                        {copied === "summary" ? "Copied" : "Copy summary"}
                      </Button>
                    </Group>
                    <Textarea value={reviewerSummary} readOnly minRows={14} autosize />
                  </Stack>
                </Card>

                <Card withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <Text fw={700}>Generated App / Agent prompt</Text>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={copied === "prompt" ? <IconCheck size={14} /> : <IconCopy size={14} />}
                        onClick={() => void handleCopy(generatedPrompt, "prompt")}
                      >
                        {copied === "prompt" ? "Copied" : "Copy prompt"}
                      </Button>
                    </Group>
                    <Textarea value={generatedPrompt} readOnly minRows={14} autosize />
                  </Stack>
                </Card>
              </SimpleGrid>
            </Stack>
          </Card>
        ) : null}
      </Stack>
    </WidgetFrame>
  );
}
