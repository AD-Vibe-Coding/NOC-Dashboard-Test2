import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  FileButton,
  Group,
  Select,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
  Code,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleCheck,
  IconFileSpreadsheet,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import {
  executeImport,
  parseWorkbookFile,
  SOURCE_TYPE_DESCRIPTIONS,
  SOURCE_TYPE_LABELS,
  type ImportPlan,
  type ImportResult,
  type ParsedWorkbookFile,
  type SheetInfo,
  type SheetPlan,
  type SourceType,
} from "./import";
import { resolveTeamMember } from "./team";

interface Props {
  onComplete: (result: ImportResult) => Promise<void>;
}

type RequiredUploadType = "tickets" | "calls" | "tasks";

type UploadSlot = {
  sourceType: RequiredUploadType;
  label: string;
  description: string;
  file: File | null;
  parsed: ParsedWorkbookFile | null;
  parseError: string | null;
  parsing: boolean;
};

const SOURCE_OPTIONS = [
  { value: "tickets", label: "Tickets" },
  { value: "calls", label: "Inbound Calls" },
  { value: "tasks", label: "Tasks" },
  { value: "queue", label: "Queue Availability" },
  { value: "audit", label: "Audit" },
  { value: "skip", label: "Skip this sheet" },
];

const REQUIRED_UPLOADS: Array<Pick<UploadSlot, "sourceType" | "label" | "description">> = [
  {
    sourceType: "tickets",
    label: "Tickets file",
    description: "Upload the ticket workbook/file only.",
  },
  {
    sourceType: "calls",
    label: "Calls file",
    description: "Upload the inbound calls workbook/file only.",
  },
  {
    sourceType: "tasks",
    label: "Mobility tasks file",
    description: "Upload the mobility tasks workbook/file only.",
  },
];

function createInitialSlot(config: Pick<UploadSlot, "sourceType" | "label" | "description">): UploadSlot {
  return {
    ...config,
    file: null,
    parsed: null,
    parseError: null,
    parsing: false,
  };
}

function buildInitialSlots(): Record<RequiredUploadType, UploadSlot> {
  return {
    tickets: createInitialSlot(REQUIRED_UPLOADS[0]),
    calls: createInitialSlot(REQUIRED_UPLOADS[1]),
    tasks: createInitialSlot(REQUIRED_UPLOADS[2]),
  };
}

function inferredSourceType(slotType: RequiredUploadType, detectedType: SheetInfo["detectedType"]): SourceType | "skip" {
  if (detectedType === "unknown") return slotType;
  return detectedType;
}

export function ImportFlow({ onComplete }: Props) {
  const [uploads, setUploads] = useState<Record<RequiredUploadType, UploadSlot>>(buildInitialSlots);
  const [plan, setPlan] = useState<Record<string, SheetPlan>>({});
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const allSheets = useMemo(
    () => REQUIRED_UPLOADS.flatMap(({ sourceType }) => uploads[sourceType].parsed?.sheets ?? []),
    [uploads],
  );

  const validSheetCount = useMemo(
    () => allSheets.filter((sheet) => {
      const sheetPlan = plan[sheet.name];
      return sheetPlan && sheetPlan.sourceType !== "skip";
    }).length,
    [allSheets, plan],
  );

  async function handleFile(sourceType: RequiredUploadType, file: File | null) {
    setImportError(null);
    setImportResult(null);

    if (!file) {
      setUploads((prev) => ({
        ...prev,
        [sourceType]: {
          ...prev[sourceType],
          file: null,
          parsed: null,
          parseError: null,
          parsing: false,
        },
      }));
      return;
    }

    setUploads((prev) => ({
      ...prev,
      [sourceType]: {
        ...prev[sourceType],
        file,
        parsed: null,
        parseError: null,
        parsing: true,
      },
    }));

    try {
      const detected = await parseWorkbookFile(file);
      setUploads((prev) => ({
        ...prev,
        [sourceType]: {
          ...prev[sourceType],
          file,
          parsed: detected,
          parseError: null,
          parsing: false,
        },
      }));

      setPlan((prev) => {
        const next = { ...prev };
        for (const s of detected.sheets) {
          next[s.name] = {
            sheetName: s.name,
            sourceType: inferredSourceType(sourceType, s.detectedType),
            nameColumn: s.detectedNameColumn ?? s.headers[0] ?? "",
          };
        }
        return next;
      });
    } catch (err) {
      setUploads((prev) => ({
        ...prev,
        [sourceType]: {
          ...prev[sourceType],
          file,
          parsed: null,
          parseError: err instanceof Error ? err.message : String(err),
          parsing: false,
        },
      }));
    }
  }

  function updatePlan(sheet: string, patch: Partial<SheetPlan>) {
    setPlan((prev) => ({ ...prev, [sheet]: { ...prev[sheet], ...patch } }));
  }

  async function runImport() {
    setImporting(true);
    setImportError(null);
    try {
      const combined: ImportResult = { fileName: "Team Performance Multi-File Import", bySheet: [] };

      for (const uploadType of REQUIRED_UPLOADS) {
        const slot = uploads[uploadType.sourceType];
        if (!slot.file || !slot.parsed) continue;
        const planObj: ImportPlan = {
          sheets: slot.parsed.sheets.map((s) => plan[s.name]).filter(Boolean),
        };
        const result = await executeImport(slot.file, planObj);
        combined.fileName = REQUIRED_UPLOADS
          .map((item) => uploads[item.sourceType].file?.name)
          .filter(Boolean)
          .join(" + ");
        combined.bySheet.push(...result.bySheet);
      }

      setImportResult(combined);
      await onComplete(combined);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setUploads(buildInitialSlots());
    setPlan({});
    setImportResult(null);
    setImportError(null);
  }

  if (importResult) {
    const totalMatched = importResult.bySheet.reduce((n, s) => n + s.matchedRows, 0);
    const totalSkipped = importResult.bySheet.reduce((n, s) => n + s.skippedRows, 0);
    return (
      <Card withBorder radius="md" p="lg">
        <Stack gap="md">
          <Group gap="sm">
            <IconCircleCheck size={28} color="var(--mantine-color-green-5)" />
            <Box>
              <Title order={5}>Import complete</Title>
              <Text size="xs" c="dimmed">
                {importResult.fileName} — {totalMatched} row{totalMatched === 1 ? "" : "s"} imported across {importResult.bySheet.length} sheet{importResult.bySheet.length === 1 ? "" : "s"}
              </Text>
            </Box>
          </Group>

          <Table withTableBorder withColumnBorders highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Sheet</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th ta="right">Total</Table.Th>
                <Table.Th ta="right">Matched</Table.Th>
                <Table.Th ta="right">Skipped</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {importResult.bySheet.map((s) => (
                <Table.Tr key={`${s.sheetName}-${s.sourceType}`}>
                  <Table.Td><Text size="sm" fw={500}>{s.sheetName}</Text></Table.Td>
                  <Table.Td><Badge size="sm" variant="light">{SOURCE_TYPE_LABELS[s.sourceType]}</Badge></Table.Td>
                  <Table.Td ta="right" ff="monospace">{s.totalRows}</Table.Td>
                  <Table.Td ta="right" ff="monospace" c="green.4">{s.matchedRows}</Table.Td>
                  <Table.Td ta="right" ff="monospace" c={s.skippedRows > 0 ? "yellow.5" : "dimmed"}>{s.skippedRows}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          {totalSkipped > 0 && (
            <Alert icon={<IconAlertTriangle size={16} />} color="yellow" variant="light" title={`${totalSkipped} row${totalSkipped === 1 ? "" : "s"} skipped`}>
              <Text size="sm" mb={4}>These rows had names not on the locked 14-member roster.</Text>
            </Alert>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={reset}>Import another set of files</Button>
          </Group>
        </Stack>
      </Card>
    );
  }

  return (
    <Stack gap="md">
      <Card withBorder radius="md" p="xl">
        <Stack align="center" gap="md">
          <IconFileSpreadsheet size={48} color="var(--mantine-color-green-5)" />
          <Stack align="center" gap={4}>
            <Title order={4}>Upload separate files by source</Title>
            <Text size="sm" c="dimmed" ta="center" maw={540}>
              Upload tickets, calls, and mobility tasks as separate Excel files. Each file can still contain one or more sheets, and each sheet is reviewed before import.
            </Text>
          </Stack>
        </Stack>
      </Card>

      {REQUIRED_UPLOADS.map((item) => {
        const slot = uploads[item.sourceType];
        return (
          <Card key={item.sourceType} withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Box>
                  <Title order={6}>{item.label}</Title>
                  <Text size="xs" c="dimmed">{item.description}</Text>
                </Box>
                {slot.file && <Badge variant="light">{slot.file.name}</Badge>}
              </Group>

              <Group>
                <FileButton onChange={(file) => handleFile(item.sourceType, file)} accept=".xlsx,.xls">
                  {(props) => (
                    <Button {...props} leftSection={<IconUpload size={16} />} loading={slot.parsing}>
                      {slot.file ? "Replace file" : "Choose file"}
                    </Button>
                  )}
                </FileButton>
                {slot.file && (
                  <Button variant="subtle" color="gray" onClick={() => handleFile(item.sourceType, null)}>
                    Clear
                  </Button>
                )}
              </Group>

              {slot.parseError && (
                <Alert color="red" icon={<IconX size={16} />} variant="light">
                  {slot.parseError}
                </Alert>
              )}

              {(slot.parsed?.sheets ?? []).map((sheet) => (
                <SheetReviewCard
                  key={sheet.name}
                  info={sheet}
                  plan={plan[sheet.name]}
                  onPlanChange={(patch) => updatePlan(sheet.name, patch)}
                />
              ))}
            </Stack>
          </Card>
        );
      })}

      {importError && (
        <Alert color="red" icon={<IconX size={16} />} variant="light">
          {importError}
        </Alert>
      )}

      <Group justify="flex-end">
        <Button variant="subtle" onClick={reset} disabled={importing}>Cancel</Button>
        <Button
          size="sm"
          color="green"
          leftSection={<IconCheck size={14} />}
          loading={importing}
          disabled={validSheetCount === 0}
          onClick={runImport}
        >
          Import {validSheetCount} sheet{validSheetCount === 1 ? "" : "s"}
        </Button>
      </Group>
    </Stack>
  );
}

function SheetReviewCard({
  info,
  plan,
  onPlanChange,
}: {
  info: SheetInfo;
  plan?: SheetPlan;
  onPlanChange: (patch: Partial<SheetPlan>) => void;
}) {
  const effectivePlan = plan ?? {
    sheetName: info.name,
    sourceType: (info.detectedType === "unknown" ? "skip" : info.detectedType) as SourceType | "skip",
    nameColumn: info.detectedNameColumn ?? info.headers[0] ?? "",
  };

  const isSkipped = effectivePlan.sourceType === "skip";
  const unmatchedPreview = info.projectedUnmatchedNames;
  const unmatchedOverflow = Math.max(0, info.projectedUnmatchedCount - unmatchedPreview.length);

  return (
    <Card
      withBorder
      radius="md"
      p="md"
      style={{
        opacity: isSkipped ? 0.6 : 1,
        borderColor: isSkipped ? "var(--mantine-color-dark-4)" : "var(--mantine-color-green-7)",
      }}
    >
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <Text fw={600} truncate>{info.name}</Text>
            <Badge size="xs" variant="default">{info.totalRows} row{info.totalRows === 1 ? "" : "s"}</Badge>
            {info.detectedType !== "unknown" && (
              <Tooltip label={SOURCE_TYPE_DESCRIPTIONS[info.detectedType]}>
                <Badge size="xs" color="green" variant="light">detected: {SOURCE_TYPE_LABELS[info.detectedType]}</Badge>
              </Tooltip>
            )}
          </Group>
          <Badge
            size="sm"
            color={info.projectedMatches === info.totalRows && info.projectedMatches > 0 ? "green" : info.projectedMatches > 0 ? "yellow" : "red"}
            variant="light"
          >
            ~{info.projectedMatches} / {info.totalRows} match roster
          </Badge>
        </Group>

        <Group grow gap="sm">
          <Select
            label="Data type"
            size="xs"
            data={SOURCE_OPTIONS}
            value={effectivePlan.sourceType}
            onChange={(v) => onPlanChange({ sourceType: (v ?? "skip") as SourceType | "skip" })}
            allowDeselect={false}
          />
          <Select
            label="Agent name column"
            size="xs"
            data={info.headers.filter(Boolean).map((h) => ({ value: h, label: h }))}
            value={effectivePlan.nameColumn}
            onChange={(v) => onPlanChange({ nameColumn: v ?? "" })}
            disabled={isSkipped}
            searchable
            allowDeselect={false}
          />
        </Group>

        {!isSkipped && info.projectedUnmatchedCount > 0 && (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
            <Stack gap={6}>
              <Text size="sm" fw={500}>
                {info.projectedUnmatchedCount} distinct name{info.projectedUnmatchedCount === 1 ? "" : "s"} did not match the roster in preview.
              </Text>
              {unmatchedPreview.length > 0 && (
                <Group gap={6}>
                  {unmatchedPreview.map((name) => (
                    <Code key={name}>{name}</Code>
                  ))}
                  {unmatchedOverflow > 0 && <Text size="xs" c="dimmed">+{unmatchedOverflow} more</Text>}
                </Group>
              )}
            </Stack>
          </Alert>
        )}

        {!isSkipped && info.preview.length > 0 && (
          <Box style={{ overflowX: "auto" }}>
            <Table withTableBorder withColumnBorders striped fz="xs" styles={{ td: { whiteSpace: "nowrap" } }}>
              <Table.Thead>
                <Table.Tr>
                  {info.headers.slice(0, 8).map((h) => (
                    <Table.Th
                      key={h}
                      style={{
                        background: h === effectivePlan.nameColumn ? "var(--mantine-color-green-9)" : undefined,
                      }}
                    >
                      {h || "(blank)"}
                    </Table.Th>
                  ))}
                  {info.headers.length > 8 && <Table.Th c="dimmed">+{info.headers.length - 8} more cols</Table.Th>}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {info.preview.slice(0, 3).map((row, i) => (
                  <Table.Tr key={i}>
                    {info.headers.slice(0, 8).map((h) => {
                      const isNameCol = h === effectivePlan.nameColumn;
                      const v = row[h];
                      const canonical = isNameCol && v ? resolveTeamMember(String(v)) : null;
                      return (
                        <Table.Td
                          key={h}
                          style={{
                            background: isNameCol && !canonical && v ? "var(--mantine-color-yellow-9)" : isNameCol && canonical ? "var(--mantine-color-green-9)" : undefined,
                            opacity: isNameCol && !canonical && v ? 0.7 : 1,
                          }}
                        >
                          {v == null || v === "" ? (
                            <Text size="xs" c="dimmed" fs="italic">—</Text>
                          ) : (
                            <Text size="xs">
                              {String(v)}
                              {isNameCol && canonical && canonical !== String(v) && (
                                <Text component="span" c="green.4" ml={4} fz="xs">→ {canonical}</Text>
                              )}
                            </Text>
                          )}
                        </Table.Td>
                      );
                    })}
                    {info.headers.length > 8 && <Table.Td />}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {info.totalRows > 3 && (
              <Text size="xs" c="dimmed" mt={6}>+ {info.totalRows - 3} more row{info.totalRows - 3 === 1 ? "" : "s"} not shown</Text>
            )}
          </Box>
        )}
      </Stack>
    </Card>
  );
}
