import { useState } from "react";
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
  parseWorkbook,
  SOURCE_TYPE_DESCRIPTIONS,
  SOURCE_TYPE_LABELS,
  type ImportPlan,
  type ImportResult,
  type SheetInfo,
  type SheetPlan,
  type SourceType,
} from "./import";
import { resolveTeamMember } from "./team";

interface Props {
  onComplete: (result: ImportResult) => Promise<void>;
}

const SOURCE_OPTIONS = [
  { value: "tickets", label: "Tickets" },
  { value: "calls", label: "Inbound Calls" },
  { value: "tasks", label: "Tasks" },
  { value: "queue", label: "Queue Availability" },
  { value: "audit", label: "Audit" },
  { value: "skip", label: "Skip this sheet" },
];

/**
 * Three-step Excel import flow:
 *   Step 1: Upload file
 *   Step 2: Review detected sheets, adjust source type + name column per sheet
 *   Step 3: Execute import + show results
 */
export function ImportFlow({ onComplete }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetInfo[] | null>(null);
  const [plan, setPlan] = useState<Record<string, SheetPlan>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  async function handleFile(f: File | null) {
    if (!f) return;
    setFile(f);
    setParseError(null);
    setSheets(null);
    setImportResult(null);
    setParsing(true);
    try {
      const detected = await parseWorkbook(f);
      setSheets(detected);
      // Seed the plan with detected values
      const initial: Record<string, SheetPlan> = {};
      for (const s of detected) {
        initial[s.name] = {
          sheetName: s.name,
          sourceType: (s.detectedType === "unknown" ? "skip" : s.detectedType) as
            | SourceType
            | "skip",
          nameColumn: s.detectedNameColumn ?? s.headers[0] ?? "",
        };
      }
      setPlan(initial);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    } finally {
      setParsing(false);
    }
  }

  function updatePlan(sheet: string, patch: Partial<SheetPlan>) {
    setPlan((prev) => ({ ...prev, [sheet]: { ...prev[sheet], ...patch } }));
  }

  async function runImport() {
    if (!file || !sheets) return;
    setImporting(true);
    setImportError(null);
    try {
      const planObj: ImportPlan = {
        sheets: sheets.map((s) => plan[s.name]).filter(Boolean),
      };
      const result = await executeImport(file, planObj);
      setImportResult(result);
      await onComplete(result);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setFile(null);
    setSheets(null);
    setPlan({});
    setImportResult(null);
    setImportError(null);
    setParseError(null);
  }

  // ---- Render -----------------------------------------------------------

  // Step 3: results shown after a successful import
  if (importResult) {
    const totalMatched = importResult.bySheet.reduce(
      (n, s) => n + s.matchedRows,
      0,
    );
    const totalSkipped = importResult.bySheet.reduce(
      (n, s) => n + s.skippedRows,
      0,
    );
    return (
      <Card withBorder radius="md" p="lg">
        <Stack gap="md">
          <Group gap="sm">
            <IconCircleCheck size={28} color="var(--mantine-color-green-5)" />
            <Box>
              <Title order={5}>Import complete</Title>
              <Text size="xs" c="dimmed">
                {importResult.fileName} — {totalMatched} row
                {totalMatched === 1 ? "" : "s"} imported across{" "}
                {importResult.bySheet.length} sheet
                {importResult.bySheet.length === 1 ? "" : "s"}
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
                <Table.Tr key={s.sheetName}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {s.sheetName}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light">
                      {SOURCE_TYPE_LABELS[s.sourceType]}
                    </Badge>
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace">
                    {s.totalRows}
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace" c="green.4">
                    {s.matchedRows}
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace" c={s.skippedRows > 0 ? "yellow.5" : "dimmed"}>
                    {s.skippedRows}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          {totalSkipped > 0 && (
            <Alert
              icon={<IconAlertTriangle size={16} />}
              color="yellow"
              variant="light"
              title={`${totalSkipped} row${totalSkipped === 1 ? "" : "s"} skipped`}
            >
              <Text size="sm" mb={4}>
                These rows had names not on the locked 14-member roster.
              </Text>
              {importResult.bySheet.flatMap((s) =>
                s.skippedNames.length > 0 ? [
                  <Text key={s.sheetName} size="xs" c="dimmed">
                    <b>{s.sheetName}:</b> {s.skippedNames.slice(0, 8).join(", ")}
                    {s.skippedNames.length > 8 ? `, +${s.skippedNames.length - 8} more` : ""}
                  </Text>
                ] : []
              )}
            </Alert>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={reset}>
              Import another file
            </Button>
          </Group>
        </Stack>
      </Card>
    );
  }

  // Step 1: nothing uploaded yet
  if (!file || !sheets) {
    return (
      <Card withBorder radius="md" p="xl">
        <Stack align="center" gap="md">
          <Box
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              background: "var(--mantine-color-green-9)",
              opacity: 0.25,
              filter: "blur(20px)",
              position: "absolute",
            }}
          />
          <IconFileSpreadsheet
            size={48}
            color="var(--mantine-color-green-5)"
            style={{ position: "relative" }}
          />
          <Stack align="center" gap={4}>
            <Title order={4}>Upload Excel workbook</Title>
            <Text size="sm" c="dimmed" ta="center" maw={420}>
              Drop a single .xlsx file containing ticket, call, task, queue,
              or audit data per agent. Each sheet is reviewed before import —
              names are normalized to the locked 14-member roster.
            </Text>
          </Stack>
          <FileButton onChange={handleFile} accept=".xlsx,.xls">
            {(props) => (
              <Button
                {...props}
                size="md"
                leftSection={<IconUpload size={16} />}
                color="green"
                loading={parsing}
              >
                Choose file…
              </Button>
            )}
          </FileButton>
          {parseError && (
            <Alert color="red" icon={<IconX size={16} />} variant="light" w="100%">
              {parseError}
            </Alert>
          )}
        </Stack>
      </Card>
    );
  }

  // Step 2: classify each sheet
  const validSheetCount = sheets.filter(
    (s) => plan[s.name]?.sourceType !== "skip",
  ).length;
  const totalProjected = sheets.reduce((sum, s) => {
    const p = plan[s.name];
    if (!p || p.sourceType === "skip") return sum;
    // When the user kept the auto-detected name column, use the accurate
    // workbook-wide projection from parseWorkbook.
    if (p.nameColumn === s.detectedNameColumn) {
      return sum + s.projectedMatches;
    }
    // Otherwise estimate from the preview rows (lower bound).
    let projected = 0;
    for (const row of s.preview) {
      const v = row[p.nameColumn];
      if (v && resolveTeamMember(String(v))) projected++;
    }
    return sum + projected;
  }, 0);

  return (
    <Stack gap="md">
      <Card withBorder radius="md" p="md">
        <Group justify="space-between">
          <Group gap="sm">
            <IconFileSpreadsheet
              size={24}
              color="var(--mantine-color-green-5)"
            />
            <Box>
              <Text fw={600} size="sm">
                {file.name}
              </Text>
              <Text size="xs" c="dimmed">
                {sheets.length} sheet{sheets.length === 1 ? "" : "s"} detected
                · {validSheetCount} configured for import · ~{totalProjected}{" "}
                rows will match roster
              </Text>
            </Box>
          </Group>
          <Group gap="xs">
            <Button variant="subtle" size="xs" onClick={reset}>
              Cancel
            </Button>
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
        </Group>
      </Card>

      {importError && (
        <Alert color="red" icon={<IconX size={16} />} variant="light">
          {importError}
        </Alert>
      )}

      {sheets.map((s) => (
        <SheetReviewCard
          key={s.name}
          info={s}
          plan={plan[s.name]}
          onPlanChange={(patch) => updatePlan(s.name, patch)}
        />
      ))}

      <Group justify="flex-end">
        <Button variant="subtle" onClick={reset} disabled={importing}>
          Cancel
        </Button>
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
  plan: SheetPlan;
  onPlanChange: (patch: Partial<SheetPlan>) => void;
}) {
  const isSkipped = plan.sourceType === "skip";
  // Recompute projected matches against the chosen name column (using preview
  // as a quick proxy — fully accurate after import).
  return (
    <Card
      withBorder
      radius="md"
      p="md"
      style={{
        opacity: isSkipped ? 0.6 : 1,
        borderColor: isSkipped
          ? "var(--mantine-color-dark-4)"
          : "var(--mantine-color-green-7)",
      }}
    >
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <Text fw={600} truncate>
              {info.name}
            </Text>
            <Badge size="xs" variant="default">
              {info.totalRows} row{info.totalRows === 1 ? "" : "s"}
            </Badge>
            {info.detectedType !== "unknown" && (
              <Tooltip label={SOURCE_TYPE_DESCRIPTIONS[info.detectedType]}>
                <Badge size="xs" color="green" variant="light">
                  detected: {SOURCE_TYPE_LABELS[info.detectedType]}
                </Badge>
              </Tooltip>
            )}
          </Group>
          <Badge
            size="sm"
            color={
              info.projectedMatches === info.totalRows && info.projectedMatches > 0
                ? "green"
                : info.projectedMatches > 0
                  ? "yellow"
                  : "red"
            }
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
            value={plan.sourceType}
            onChange={(v) =>
              onPlanChange({ sourceType: (v ?? "skip") as SourceType | "skip" })
            }
            allowDeselect={false}
          />
          <Select
            label="Agent name column"
            size="xs"
            data={info.headers
              .filter((h) => !!h)
              .map((h) => ({ value: h, label: h }))}
            value={plan.nameColumn}
            onChange={(v) => onPlanChange({ nameColumn: v ?? "" })}
            disabled={isSkipped}
            searchable
            allowDeselect={false}
          />
        </Group>

        {!isSkipped && info.preview.length > 0 && (
          <Box style={{ overflowX: "auto" }}>
            <Table
              withTableBorder
              withColumnBorders
              striped
              fz="xs"
              styles={{ td: { whiteSpace: "nowrap" } }}
            >
              <Table.Thead>
                <Table.Tr>
                  {info.headers.slice(0, 8).map((h) => (
                    <Table.Th
                      key={h}
                      style={{
                        background:
                          h === plan.nameColumn
                            ? "var(--mantine-color-green-9)"
                            : undefined,
                      }}
                    >
                      {h || "(blank)"}
                    </Table.Th>
                  ))}
                  {info.headers.length > 8 && (
                    <Table.Th c="dimmed">
                      +{info.headers.length - 8} more cols
                    </Table.Th>
                  )}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {info.preview.slice(0, 3).map((row, i) => (
                  <Table.Tr key={i}>
                    {info.headers.slice(0, 8).map((h) => {
                      const isNameCol = h === plan.nameColumn;
                      const v = row[h];
                      const canonical = isNameCol && v
                        ? resolveTeamMember(String(v))
                        : null;
                      return (
                        <Table.Td
                          key={h}
                          style={{
                            background:
                              isNameCol && !canonical && v
                                ? "var(--mantine-color-yellow-9)"
                                : isNameCol && canonical
                                  ? "var(--mantine-color-green-9)"
                                  : undefined,
                            opacity:
                              isNameCol && !canonical && v ? 0.7 : 1,
                          }}
                        >
                          {v == null || v === "" ? (
                            <Text size="xs" c="dimmed" fs="italic">
                              —
                            </Text>
                          ) : (
                            <Text size="xs">
                              {String(v)}
                              {isNameCol && canonical && canonical !== String(v) && (
                                <Text component="span" c="green.4" ml={4} fz="xs">
                                  → {canonical}
                                </Text>
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
              <Text size="xs" c="dimmed" mt={6}>
                + {info.totalRows - 3} more row{info.totalRows - 3 === 1 ? "" : "s"} not shown
              </Text>
            )}
          </Box>
        )}
      </Stack>
    </Card>
  );
}
