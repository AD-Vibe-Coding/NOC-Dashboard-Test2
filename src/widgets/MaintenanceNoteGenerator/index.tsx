import { useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  CopyButton,
  Divider,
  Grid,
  Group,
  List,
  Radio,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconClipboard,
  IconClipboardCheck,
  IconFileDescription,
  IconNotes,
  IconSparkles,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { generateNote, parseMaintenanceEmail, SUPPORTED_CARRIERS } from "./lib/maintenanceParser";
import type { ConfidenceLevel, MaintenanceData, MaintenanceType, ParsedField } from "./types";

const SAMPLE_INPUT = `Carrier: Lumen
Address: 123 Main St, Dallas, TX 75201
Circuit ID: ABC123456
Start: 2026-06-25 01:00 UTC
End: 2026-06-25 03:00 UTC
Reason: Planned network maintenance impacting connectivity during the window.`;

function getConfidenceColor(level: ConfidenceLevel) {
  if (level === "found") return "teal";
  if (level === "guessed") return "yellow";
  return "red";
}

function getConfidenceLabel(level: ConfidenceLevel) {
  if (level === "found") return "Found";
  if (level === "guessed") return "Guessed";
  return "Missing";
}

function formatFieldLabel(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function noteToHtml(note: string) {
  return note
    .split("\n")
    .map((line) => escapeHtml(line) || "&nbsp;")
    .join("<br />");
}

async function copyRichAndPlain(note: string) {
  if (typeof window === "undefined") return;
  const html = noteToHtml(note);

  if (navigator.clipboard && "write" in navigator.clipboard && typeof ClipboardItem !== "undefined") {
    const item = new ClipboardItem({
      "text/plain": new Blob([note], { type: "text/plain" }),
      "text/html": new Blob([html], { type: "text/html" }),
    });
    await navigator.clipboard.write([item]);
    return;
  }

  await navigator.clipboard.writeText(note);
}

function buildSubject(data: MaintenanceData, type: MaintenanceType) {
  const prefix = type === "emergency" ? "Emergency" : "Scheduled";
  const carrier = data.carrier.value || "Carrier";
  const circuit = data.circuitId.value || "Circuit";
  return `${prefix} Maintenance Note - ${carrier} - ${circuit}`;
}

function FieldCard({ label, field }: { label: string; field: ParsedField }) {
  return (
    <Card withBorder radius="lg" p="md" style={{ height: "100%" }}>
      <Stack gap={8}>
        <Group justify="space-between" align="flex-start" gap="xs">
          <Text fw={600} size="sm">{label}</Text>
          <Badge color={getConfidenceColor(field.confidence)} variant="light" size="sm">
            {getConfidenceLabel(field.confidence)}
          </Badge>
        </Group>
        <Text size="sm" c={field.value ? undefined : "dimmed"} style={{ whiteSpace: "pre-wrap" }}>
          {field.value || "No value detected"}
        </Text>
      </Stack>
    </Card>
  );
}

function MaintenanceNoteGeneratorContent() {
  const [rawText, setRawText] = useState("");
  const [maintenanceType, setMaintenanceType] = useState<MaintenanceType>("scheduled");
  const [copiedRich, setCopiedRich] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const parsed = useMemo(() => parseMaintenanceEmail(rawText), [rawText]);
  const generatedNote = useMemo(() => generateNote(parsed, maintenanceType), [parsed, maintenanceType]);
  const generatedSubject = useMemo(() => buildSubject(parsed, maintenanceType), [parsed, maintenanceType]);

  const parsedEntries = Object.entries(parsed) as [keyof MaintenanceData, ParsedField][];
  const missingCount = parsedEntries.filter(([, field]) => field.confidence === "not_found").length;
  const guessedCount = parsedEntries.filter(([, field]) => field.confidence === "guessed").length;

  const canGenerate = rawText.trim().length > 0;

  async function handleCopyRich() {
    try {
      setCopyError(null);
      await copyRichAndPlain(generatedNote);
      setCopiedRich(true);
      window.setTimeout(() => setCopiedRich(false), 1800);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : "Could not copy the maintenance note.");
    }
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" gap="md">
        <div>
          <Text fw={700} size="lg">Maintenance Note Generator</Text>
          <Text size="sm" c="dimmed" mt={6} maw={760}>
            Paste a carrier maintenance notice from email, parse the key details, and generate a ready-to-send maintenance note. This widget was ported from your uploaded toolkit and is now available in both dashboards.
          </Text>
        </div>
        <Badge variant="light" color="blue" leftSection={<IconSparkles size={14} />}>
          Available on tech + manager dashboards
        </Badge>
      </Group>

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, xl: 6 }}>
          <Card withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <Group gap="xs">
                  <ThemeIcon variant="light" color="indigo" size="lg">
                    <IconFileDescription size={18} />
                  </ThemeIcon>
                  <div>
                    <Text fw={600}>Source notice</Text>
                    <Text size="sm" c="dimmed">Paste the original maintenance email or text block.</Text>
                  </div>
                </Group>
                <Button variant="light" size="xs" onClick={() => setRawText(SAMPLE_INPUT)}>
                  Load sample
                </Button>
              </Group>

              <Textarea
                value={rawText}
                onChange={(event) => setRawText(event.currentTarget.value)}
                minRows={16}
                autosize
                placeholder="Paste the full maintenance email here..."
              />

              <Radio.Group
                label="Maintenance type"
                value={maintenanceType}
                onChange={(value) => setMaintenanceType(value as MaintenanceType)}
              >
                <Group mt="xs">
                  <Radio value="scheduled" label="Scheduled" />
                  <Radio value="emergency" label="Emergency" />
                </Group>
              </Radio.Group>

              <Alert color="blue" variant="light" icon={<IconNotes size={16} />}>
                Supported carrier patterns include {SUPPORTED_CARRIERS.slice(0, 8).join(", ")}
                {SUPPORTED_CARRIERS.length > 8 ? `, +${SUPPORTED_CARRIERS.length - 8} more` : ""}.
              </Alert>
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, xl: 6 }}>
          <Stack gap="lg">
            <Card withBorder radius="lg" p="lg">
              <Stack gap="md">
                <Group justify="space-between" align="center">
                  <div>
                    <Text fw={600}>Generated output</Text>
                    <Text size="sm" c="dimmed">Copy the subject or the formatted maintenance note.</Text>
                  </div>
                  <Group gap="xs">
                    <CopyButton value={generatedSubject} timeout={1500}>
                      {({ copied, copy }) => (
                        <Tooltip label={copied ? "Copied" : "Copy subject"}>
                          <ActionIcon size="lg" variant="light" color={copied ? "teal" : "gray"} onClick={copy}>
                            {copied ? <IconClipboardCheck size={18} /> : <IconClipboard size={18} />}
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </CopyButton>
                    <Tooltip label={copiedRich ? "Copied" : "Copy note"}>
                      <ActionIcon size="lg" variant="light" color={copiedRich ? "teal" : "gray"} onClick={() => void handleCopyRich()}>
                        {copiedRich ? <IconCheck size={18} /> : <IconClipboardCheck size={18} />}
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>

                <div>
                  <Text size="xs" tt="uppercase" fw={700} c="dimmed" mb={6}>Subject</Text>
                  <Card withBorder radius="md" p="sm">
                    <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{canGenerate ? generatedSubject : "Subject will appear here once you paste a maintenance notice."}</Text>
                  </Card>
                </div>

                <div>
                  <Text size="xs" tt="uppercase" fw={700} c="dimmed" mb={6}>Maintenance note</Text>
                  <Card withBorder radius="md" p="sm">
                    <ScrollArea.Autosize mah={280}>
                      <Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }} c={canGenerate ? undefined : "dimmed"}>
                        {canGenerate ? generatedNote : "Paste a maintenance notice to generate the formatted note."}
                      </Text>
                    </ScrollArea.Autosize>
                  </Card>
                </div>

                {copyError ? (
                  <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                    {copyError}
                  </Alert>
                ) : null}
              </Stack>
            </Card>

            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <Card withBorder radius="lg" p="md">
                <Stack gap={4}>
                  <Text size="xs" tt="uppercase" fw={700} c="dimmed">Fields parsed</Text>
                  <Text fw={700} size="xl">{parsedEntries.length}</Text>
                </Stack>
              </Card>
              <Card withBorder radius="lg" p="md">
                <Stack gap={4}>
                  <Text size="xs" tt="uppercase" fw={700} c="dimmed">Guessed</Text>
                  <Text fw={700} size="xl" c={guessedCount ? "yellow" : undefined}>{guessedCount}</Text>
                </Stack>
              </Card>
              <Card withBorder radius="lg" p="md">
                <Stack gap={4}>
                  <Text size="xs" tt="uppercase" fw={700} c="dimmed">Missing</Text>
                  <Text fw={700} size="xl" c={missingCount ? "red" : undefined}>{missingCount}</Text>
                </Stack>
              </Card>
            </SimpleGrid>
          </Stack>
        </Grid.Col>
      </Grid>

      {missingCount > 0 ? (
        <Alert color="yellow" variant="light" icon={<IconAlertCircle size={16} />}>
          Some values were not found. Review the parsed field cards below before sending the note.
        </Alert>
      ) : null}

      <Divider label="Parsed fields" labelPosition="center" />

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        {parsedEntries.map(([key, field]) => (
          <FieldCard key={key} label={formatFieldLabel(key)} field={field} />
        ))}
      </SimpleGrid>

      <Card withBorder radius="lg" p="lg">
        <Stack gap="sm">
          <Text fw={600}>How it works</Text>
          <List spacing="xs" size="sm">
            <List.Item>Parses the email body using the uploaded toolkit’s maintenance parsing rules.</List.Item>
            <List.Item>Detects field confidence as found, guessed, or missing.</List.Item>
            <List.Item>Builds a maintenance note you can paste into internal workflows.</List.Item>
          </List>
        </Stack>
      </Card>
    </Stack>
  );
}

export function MaintenanceNoteGeneratorWidget() {
  return (
    <WidgetFrame
      title="Maintenance Note Generator"
      subtitle="Parse carrier maintenance notices and generate ready-to-send maintenance notes"
      icon={IconNotes}
      iconColor="indigo"
    >
      <MaintenanceNoteGeneratorContent />
    </WidgetFrame>
  );
}

export function MaintenanceNoteGeneratorTile() {
  return (
    <Card withBorder radius="lg" p="lg" style={{ height: "100%" }}>
      <Stack gap="sm" justify="space-between" style={{ height: "100%" }}>
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={700}>Maintenance Note Generator</Text>
            <Text size="sm" c="dimmed" mt={4}>
              Parse pasted maintenance emails into a clean formatted note.
            </Text>
          </div>
          <ThemeIcon variant="light" color="indigo" size="lg">
            <IconNotes size={18} />
          </ThemeIcon>
        </Group>

        <SimpleGrid cols={3} spacing="sm">
          <Card withBorder radius="md" p="sm">
            <Text size="xs" c="dimmed">Input</Text>
            <Text fw={700} size="sm">Email text</Text>
          </Card>
          <Card withBorder radius="md" p="sm">
            <Text size="xs" c="dimmed">Output</Text>
            <Text fw={700} size="sm">Formatted note</Text>
          </Card>
          <Card withBorder radius="md" p="sm">
            <Text size="xs" c="dimmed">Access</Text>
            <Text fw={700} size="sm">Both views</Text>
          </Card>
        </SimpleGrid>
      </Stack>
    </Card>
  );
}
