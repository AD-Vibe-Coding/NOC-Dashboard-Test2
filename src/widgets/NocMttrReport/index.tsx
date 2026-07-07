import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  FileInput,
  Group,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconChartLine,
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconFilter,
  IconMinus,
  IconUpload,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";
import { WidgetTile } from "../WidgetTile";

export interface MttrRow {
  customer: string;
  monthKey: string;
  mttrMinutes: number;
  raw: Record<string, unknown>;
}

interface ParsedWorkbook {
  fileName: string;
  sheets: Array<{
    name: string;
    headers: string[];
    rows: Record<string, unknown>[];
    detectedCustomerColumn: string | null;
    detectedMonthColumn: string | null;
    detectedMttrColumn: string | null;
  }>;
}

const CUSTOMER_COLUMN_PATTERNS = [
  /customer/i,
  /customer\s*name/i,
  /account/i,
  /client/i,
  /company/i,
  /organization/i,
];

const MONTH_COLUMN_PATTERNS = [
  /^month$/i,
  /month/i,
  /date/i,
  /opened/i,
  /closed/i,
  /created/i,
  /period/i,
  /reporting/i,
];

const MTTR_COLUMN_PATTERNS = [
  /^mttr$/i,
  /mean\s*time\s*to\s*resolve/i,
  /time\s*to\s*resolve/i,
  /resolve\s*time/i,
  /resolution\s*time/i,
  /mttr\s*\(.*\)/i,
];

function detectHeader(headers: string[], patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = headers.find((header) => pattern.test(String(header).trim()));
    if (match) return match;
  }
  return null;
}

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, 1);
  return date.toLocaleString(undefined, { month: "short", year: "numeric" });
}

function formatMinutes(totalMinutes: number | null) {
  if (totalMinutes == null || !Number.isFinite(totalMinutes)) return "—";
  if (totalMinutes < 60) return `${Math.round(totalMinutes)}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatDelta(value: number | null, positiveIsGood = false) {
  if (value == null || !Number.isFinite(value) || value === 0) {
    return { icon: IconMinus, color: "gray", label: "0" };
  }
  const improved = positiveIsGood ? value > 0 : value < 0;
  const Icon = value > 0 ? IconChevronUp : IconChevronDown;
  return {
    icon: Icon,
    color: improved ? "teal" : "red",
    label: `${value > 0 ? "+" : ""}${Math.round(value)}m`,
  };
}

function normalizeHeaderValue(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function parseExcelDate(value: number): Date | null {
  const parsed = XLSX.SSF.parse_date_code(value);
  if (!parsed) return null;
  return new Date(parsed.y, parsed.m - 1, parsed.d);
}

function toMonthKey(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const excelDate = parseExcelDate(value);
    if (excelDate) {
      return `${excelDate.getFullYear()}-${String(excelDate.getMonth() + 1).padStart(2, "0")}`;
    }
  }

  const text = String(value).trim();
  if (!text) return null;

  const normalized = text.replace(/\./g, "/").replace(/,/g, " ").replace(/\s+/g, " ");

  if (/^\d{4}-\d{2}$/.test(normalized)) return normalized;
  if (/^\d{4}\/\d{1,2}$/.test(normalized)) {
    const [year, month] = normalized.split("/");
    return `${year}-${month.padStart(2, "0")}`;
  }
  if (/^\d{1,2}\/\d{4}$/.test(normalized)) {
    const [month, year] = normalized.split("/");
    return `${year}-${month.padStart(2, "0")}`;
  }

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
  }

  const monthMatch = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i.exec(normalized);
  const yearMatch = /(20\d{2}|19\d{2})/.exec(normalized);
  if (monthMatch && yearMatch) {
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const month = monthNames.indexOf(monthMatch[1].slice(0, 3).toLowerCase()) + 1;
    if (month > 0) return `${yearMatch[1]}-${String(month).padStart(2, "0")}`;
  }

  return null;
}

function toMinutes(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 24 ? Math.round(value * 60) : Math.round(value);
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d{1,3}(:\d{1,2}){1,2}(\.\d+)?$/.test(text)) {
    const parts = text.split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return null;
    let seconds = 0;
    if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
    else seconds = parts[0] * 60;
    return Math.round(seconds / 60);
  }

  const normalized = text.toLowerCase();
  const hoursMatch = /(\d+(?:\.\d+)?)\s*h/.exec(normalized);
  const minutesMatch = /(\d+(?:\.\d+)?)\s*m/.exec(normalized);
  if (hoursMatch || minutesMatch) {
    const hours = hoursMatch ? Number(hoursMatch[1]) : 0;
    const minutes = minutesMatch ? Number(minutesMatch[1]) : 0;
    return Math.round(hours * 60 + minutes);
  }

  const numeric = Number(normalized.replace(/[^\d.-]/g, ""));
  if (Number.isFinite(numeric)) {
    return numeric < 24 ? Math.round(numeric * 60) : Math.round(numeric);
  }

  return null;
}

function parseWorkbook(file: File): Promise<ParsedWorkbook> {
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheets = workbook.SheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: null,
        raw: false,
      });
      const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
      return {
        name: sheetName,
        headers,
        rows,
        detectedCustomerColumn: detectHeader(headers, CUSTOMER_COLUMN_PATTERNS),
        detectedMonthColumn: detectHeader(headers, MONTH_COLUMN_PATTERNS),
        detectedMttrColumn: detectHeader(headers, MTTR_COLUMN_PATTERNS),
      };
    });

    return {
      fileName: file.name,
      sheets,
    };
  });
}

function buildRows(
  parsed: ParsedWorkbook | null,
  sheetName: string | null,
  customerColumn: string | null,
  monthColumn: string | null,
  mttrColumn: string | null,
): MttrRow[] {
  if (!parsed || !sheetName || !customerColumn || !monthColumn || !mttrColumn) return [];
  const sheet = parsed.sheets.find((entry) => entry.name === sheetName);
  if (!sheet) return [];

  return sheet.rows.flatMap((row) => {
    const customer = normalizeHeaderValue(row[customerColumn]);
    const monthKey = toMonthKey(row[monthColumn]);
    const mttrMinutes = toMinutes(row[mttrColumn]);
    if (!customer || !monthKey || mttrMinutes == null) return [];
    return [{ customer, monthKey, mttrMinutes, raw: row }];
  });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function monthSort(a: string, b: string) {
  return a.localeCompare(b);
}

export function NocMttrReportWidget() {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [customerColumn, setCustomerColumn] = useState<string | null>(null);
  const [monthColumn, setMonthColumn] = useState<string | null>(null);
  const [mttrColumn, setMttrColumn] = useState<string | null>(null);
  const [customerFilterEnabled, setCustomerFilterEnabled] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);

  async function handleFileUpload(nextFile: File | null) {
    setFile(nextFile);
    setError(null);
    setSelectedCustomer(null);
    if (!nextFile) {
      setParsed(null);
      setSheetName(null);
      setCustomerColumn(null);
      setMonthColumn(null);
      setMttrColumn(null);
      return;
    }

    setLoading(true);
    try {
      const nextParsed = await parseWorkbook(nextFile);
      setParsed(nextParsed);
      const firstSheet = nextParsed.sheets[0] ?? null;
      setSheetName(firstSheet?.name ?? null);
      setCustomerColumn(firstSheet?.detectedCustomerColumn ?? firstSheet?.headers[0] ?? null);
      setMonthColumn(firstSheet?.detectedMonthColumn ?? firstSheet?.headers[1] ?? null);
      setMttrColumn(firstSheet?.detectedMttrColumn ?? firstSheet?.headers[2] ?? null);
      if (!firstSheet || firstSheet.rows.length === 0) {
        setError("The uploaded workbook did not contain any readable rows.");
      }
    } catch (err) {
      setParsed(null);
      setError(err instanceof Error ? err.message : "Failed to read workbook.");
    } finally {
      setLoading(false);
    }
  }

  const activeSheet = useMemo(() => {
    return parsed?.sheets.find((entry) => entry.name === sheetName) ?? null;
  }, [parsed, sheetName]);

  const rows = useMemo(() => buildRows(parsed, sheetName, customerColumn, monthColumn, mttrColumn), [parsed, sheetName, customerColumn, monthColumn, mttrColumn]);

  const customerOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.customer))).sort((a, b) => a.localeCompare(b)).map((customer) => ({
      value: customer,
      label: customer,
    }));
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!customerFilterEnabled || !selectedCustomer) return rows;
    return rows.filter((row) => row.customer === selectedCustomer);
  }, [rows, customerFilterEnabled, selectedCustomer]);

  const monthSummaries = useMemo(() => {
    const groups = new Map<string, number[]>();
    for (const row of filteredRows) {
      const list = groups.get(row.monthKey) ?? [];
      list.push(row.mttrMinutes);
      groups.set(row.monthKey, list);
    }

    return Array.from(groups.entries())
      .sort((a, b) => monthSort(a[0], b[0]))
      .map(([monthKey, values]) => {
        const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
        return {
          monthKey,
          count: values.length,
          avgMinutes: avg,
          medianMinutes: median(values),
          minMinutes: Math.min(...values),
          maxMinutes: Math.max(...values),
        };
      });
  }, [filteredRows]);

  const latest = monthSummaries[monthSummaries.length - 1] ?? null;
  const previous = monthSummaries[monthSummaries.length - 2] ?? null;
  const deltaAvg = latest && previous ? latest.avgMinutes - previous.avgMinutes : null;

  const previewRows = useMemo(() => {
    return activeSheet?.rows.slice(0, 5) ?? [];
  }, [activeSheet]);

  const trendRows = [
    {
      key: "count",
      label: "Ticket Count",
      positiveIsGood: true,
      getValue: (month: (typeof monthSummaries)[number]) => month.count,
      format: (value: number | null) => (value == null ? "—" : String(value)),
      unit: "tickets",
    },
    {
      key: "avg",
      label: "Avg MTTR",
      positiveIsGood: false,
      getValue: (month: (typeof monthSummaries)[number]) => month.avgMinutes,
      format: (value: number | null) => formatMinutes(value),
      unit: "minutes",
    },
    {
      key: "median",
      label: "Median MTTR",
      positiveIsGood: false,
      getValue: (month: (typeof monthSummaries)[number]) => month.medianMinutes,
      format: (value: number | null) => formatMinutes(value),
      unit: "minutes",
    },
    {
      key: "best",
      label: "Best MTTR",
      positiveIsGood: false,
      getValue: (month: (typeof monthSummaries)[number]) => month.minMinutes,
      format: (value: number | null) => formatMinutes(value),
      unit: "minutes",
    },
    {
      key: "worst",
      label: "Worst MTTR",
      positiveIsGood: false,
      getValue: (month: (typeof monthSummaries)[number]) => month.maxMinutes,
      format: (value: number | null) => formatMinutes(value),
      unit: "minutes",
    },
  ];

  return (
    <WidgetFrame
      title="NOC MTTR Report"
      subtitle="Upload an Excel file and review month-over-month MTTR trends"
      icon={IconClock}
      iconColor="orange"
      loading={loading}
      status={latest ? { label: monthLabel(latest.monthKey), color: "orange", tooltip: "Latest month in the current trend view" } : undefined}
      onRefresh={() => {
        if (file) void handleFileUpload(file);
      }}
    >
      <Stack gap="md">
        {error ? (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            {error}
          </Alert>
        ) : null}

        <Card withBorder radius="md" p="md">
          <Stack gap="md">
            <Group justify="space-between" align="end">
              <Stack gap={2}>
                <Title order={5}>Upload workbook</Title>
                <Text size="sm" c="dimmed">
                  Import a sheet that includes a customer field, a month/date field, and an MTTR field.
                </Text>
              </Stack>
              <Button leftSection={<IconUpload size={16} />} variant="light" disabled>
                Excel import ready
              </Button>
            </Group>

            <FileInput
              label="Excel file"
              placeholder="Upload .xlsx or .xls"
              value={file}
              onChange={handleFileUpload}
              accept=".xlsx,.xls,.csv"
              clearable
            />

            {parsed ? (
              <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }}>
                <Select
                  label="Sheet"
                  value={sheetName}
                  onChange={(value) => {
                    setSheetName(value);
                    const nextSheet = parsed.sheets.find((entry) => entry.name === value) ?? null;
                    setCustomerColumn(nextSheet?.detectedCustomerColumn ?? nextSheet?.headers[0] ?? null);
                    setMonthColumn(nextSheet?.detectedMonthColumn ?? nextSheet?.headers[1] ?? null);
                    setMttrColumn(nextSheet?.detectedMttrColumn ?? nextSheet?.headers[2] ?? null);
                  }}
                  data={parsed.sheets.map((sheet) => ({ value: sheet.name, label: `${sheet.name} (${sheet.rows.length} rows)` }))}
                />
                <Select
                  label="Customer column"
                  value={customerColumn}
                  onChange={setCustomerColumn}
                  data={(activeSheet?.headers ?? []).map((header) => ({ value: header, label: header }))}
                />
                <Select
                  label="Month/date column"
                  value={monthColumn}
                  onChange={setMonthColumn}
                  data={(activeSheet?.headers ?? []).map((header) => ({ value: header, label: header }))}
                />
                <Select
                  label="MTTR column"
                  value={mttrColumn}
                  onChange={setMttrColumn}
                  data={(activeSheet?.headers ?? []).map((header) => ({ value: header, label: header }))}
                />
              </SimpleGrid>
            ) : null}
          </Stack>
        </Card>

        {parsed ? (
          <>
            <Card withBorder radius="md" p="md">
              <Group justify="space-between" align="end">
                <Stack gap={2}>
                  <Title order={5}>Customer filter</Title>
                  <Text size="sm" c="dimmed">
                    Toggle customer filtering on to focus the trend view on one customer.
                  </Text>
                </Stack>
                <ThemeIcon variant="light" color="orange" size="lg">
                  <IconFilter size={18} />
                </ThemeIcon>
              </Group>

              <SimpleGrid cols={{ base: 1, md: 2 }} mt="md">
                <Switch
                  checked={customerFilterEnabled}
                  onChange={(event) => setCustomerFilterEnabled(event.currentTarget.checked)}
                  label="Filter by customer name"
                />
                <Select
                  label="Customer"
                  placeholder={customerFilterEnabled ? "Choose a customer" : "Enable the toggle first"}
                  value={selectedCustomer}
                  onChange={setSelectedCustomer}
                  disabled={!customerFilterEnabled}
                  searchable
                  data={customerOptions}
                />
              </SimpleGrid>
            </Card>

            <SimpleGrid cols={{ base: 1, md: 3 }}>
              <Card withBorder radius="md" p="md">
                <Stack gap={4}>
                  <Text size="sm" c="dimmed">Rows included</Text>
                  <Title order={3}>{filteredRows.length}</Title>
                  <Text size="xs" c="dimmed">{parsed.fileName}</Text>
                </Stack>
              </Card>
              <Card withBorder radius="md" p="md">
                <Stack gap={4}>
                  <Text size="sm" c="dimmed">Latest avg MTTR</Text>
                  <Title order={3}>{latest ? formatMinutes(latest.avgMinutes) : "—"}</Title>
                  <Text size="xs" c="dimmed">{latest ? monthLabel(latest.monthKey) : "Upload data to calculate"}</Text>
                </Stack>
              </Card>
              <Card withBorder radius="md" p="md">
                <Stack gap={4}>
                  <Text size="sm" c="dimmed">Month-over-month delta</Text>
                  <Group gap="xs">
                    {(() => {
                      const delta = formatDelta(deltaAvg, false);
                      const DeltaIcon = delta.icon;
                      return (
                        <>
                          <ThemeIcon size="lg" radius="md" variant="light" color={delta.color}>
                            <DeltaIcon size={18} />
                          </ThemeIcon>
                          <Title order={3}>{delta.label}</Title>
                        </>
                      );
                    })()}
                  </Group>
                  <Text size="xs" c="dimmed">Negative is better for MTTR</Text>
                </Stack>
              </Card>
            </SimpleGrid>

            <Card withBorder radius="md" p="md">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Stack gap={2}>
                    <Title order={5}>Month-over-month MTTR trend</Title>
                    <Text size="sm" c="dimmed">
                      Similar to Performance Tracker trends, with each month shown side-by-side.
                    </Text>
                  </Stack>
                  {customerFilterEnabled && selectedCustomer ? (
                    <Badge color="orange" variant="light">{selectedCustomer}</Badge>
                  ) : (
                    <Badge color="gray" variant="light">All customers</Badge>
                  )}
                </Group>

                {monthSummaries.length === 0 ? (
                  <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light">
                    I couldn’t build the trend table yet. Check the selected sheet and make sure the customer, month/date, and MTTR columns are mapped correctly.
                  </Alert>
                ) : (
                  <ScrollArea>
                    <Table withTableBorder withColumnBorders stickyHeader>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th miw={180}>KPI</Table.Th>
                          {monthSummaries.map((month) => (
                            <Table.Th key={month.monthKey} miw={170}>{monthLabel(month.monthKey)}</Table.Th>
                          ))}
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {trendRows.map((row) => (
                          <Table.Tr key={row.key}>
                            <Table.Td>
                              <Stack gap={0}>
                                <Text fw={600}>{row.label}</Text>
                                <Text size="xs" c="dimmed">{row.unit}</Text>
                              </Stack>
                            </Table.Td>
                            {monthSummaries.map((month, index) => {
                              const value = row.getValue(month);
                              const prev = index > 0 ? row.getValue(monthSummaries[index - 1]) : null;
                              const deltaValue = value != null && prev != null ? value - prev : null;
                              const delta = formatDelta(deltaValue, row.positiveIsGood);
                              const DeltaIcon = delta.icon;
                              return (
                                <Table.Td key={`${row.key}-${month.monthKey}`}>
                                  <Stack gap={2}>
                                    <Text fw={600}>{row.format(value)}</Text>
                                    {deltaValue != null ? (
                                      <Group gap={4}>
                                        <DeltaIcon size={14} color={`var(--mantine-color-${delta.color}-6)`} />
                                        <Text size="xs" c={delta.color}>{delta.label}</Text>
                                      </Group>
                                    ) : (
                                      <Text size="xs" c="dimmed">—</Text>
                                    )}
                                  </Stack>
                                </Table.Td>
                              );
                            })}
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                )}
              </Stack>
            </Card>

            {previewRows.length > 0 ? (
              <Card withBorder radius="md" p="md">
                <Stack gap="sm">
                  <Title order={5}>Preview rows</Title>
                  <ScrollArea>
                    <Table withTableBorder withColumnBorders>
                      <Table.Thead>
                        <Table.Tr>
                          {(activeSheet?.headers ?? []).slice(0, 8).map((header) => (
                            <Table.Th key={header}>{header}</Table.Th>
                          ))}
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {previewRows.map((row, index) => (
                          <Table.Tr key={index}>
                            {(activeSheet?.headers ?? []).slice(0, 8).map((header) => (
                              <Table.Td key={header}>
                                <Text size="sm" lineClamp={2}>{row[header] == null ? "" : String(row[header])}</Text>
                              </Table.Td>
                            ))}
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                </Stack>
              </Card>
            ) : null}
          </>
        ) : (
          <Card withBorder radius="md" p="xl">
            <Stack align="center" gap="sm">
              <ThemeIcon size={56} radius="xl" variant="light" color="orange">
                <IconChartLine size={28} />
              </ThemeIcon>
              <Title order={4}>Upload an MTTR workbook to begin</Title>
              <Text c="dimmed" ta="center" maw={620}>
                The widget will detect your sheet, month/date field, customer name field, and MTTR field. You can override any mapping before reviewing the month-over-month trend table.
              </Text>
            </Stack>
          </Card>
        )}
      </Stack>
    </WidgetFrame>
  );
}

export function NocMttrReportTile({ onExpand }: { onExpand: () => void }) {
  return (
    <WidgetTile
      title="NOC MTTR Report"
      description="Upload MTTR Excel data, trend month over month, and filter by customer"
      icon={IconClock}
      iconColor="orange"
      onExpand={onExpand}
    >
      <Stack gap={6}>
        <Group gap="xs">
          <Badge color="orange" variant="light">Excel upload</Badge>
          <Badge color="blue" variant="light">MoM trends</Badge>
        </Group>
        <Text size="sm" c="dimmed">
          Review MTTR changes by month and narrow the report to a single customer with one toggle.
        </Text>
      </Stack>
    </WidgetTile>
  );
}
