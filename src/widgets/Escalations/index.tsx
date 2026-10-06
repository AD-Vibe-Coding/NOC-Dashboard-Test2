import { useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Divider,
  Grid,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAddressBook,
  IconAlertCircle,
  IconChevronDown,
  IconCopy,
  IconExternalLink,
  IconFileSpreadsheet,
  IconFileText,
  IconFileTypePdf,
  IconFileUpload,
  IconFileWord,
  IconLink,
  IconMail,
  IconPhone,
  IconPhoto,
  IconPresentation,
  IconRefresh,
  IconSearch,
  IconSparkles,
  IconTable,
} from "@tabler/icons-react";
import type {
  AttachmentKind,
  CarrierEscalation,
  ConfluenceAttachment,
  EscalationContact,
  FileUpload,
  ImageExtractionResult,
} from "../../lib/confluence";
import { extractCarrierImages, fileToUpload } from "../../lib/confluence";
import { WidgetFrame } from "../WidgetFrame";
import { useEscalations } from "./data";

export { EscalationsTile } from "./Tile";

export function EscalationsWidget() {
  const { data, loading, error, refresh, cachedAt } = useEscalations();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data?.carriers ?? [];
    return (data?.carriers ?? []).filter((c) => {
      if (c.carrier.toLowerCase().includes(q)) return true;
      if (c.title.toLowerCase().includes(q)) return true;
      if (c.primary_email?.toLowerCase().includes(q)) return true;
      if (c.primary_phone?.toLowerCase().includes(q)) return true;
      if (c.body_text?.toLowerCase().includes(q)) return true;
      if (c.notes?.toLowerCase().includes(q)) return true;
      for (const contact of c.contacts) {
        if (
          contact.name?.toLowerCase().includes(q) ||
          contact.email?.toLowerCase().includes(q) ||
          contact.phone?.toLowerCase().includes(q) ||
          contact.role?.toLowerCase().includes(q)
        ) {
          return true;
        }
      }
      for (const link of c.links ?? []) {
        if (
          link.text.toLowerCase().includes(q) ||
          link.href.toLowerCase().includes(q)
        ) {
          return true;
        }
      }
      return false;
    });
  }, [query, data]);

  return (
    <WidgetFrame
      title="QS Carrier Escalation Contacts"
      subtitle={
        data ? `${data.carriers.length} carriers · from #${data.space}` : "Loading…"
      }
      icon={IconAddressBook}
      iconColor="grape"
      loading={loading}
      onRefresh={refresh}
      status={
        data
          ? {
              label: `Confluence: ${data.source}`,
              color: data.source === "live" ? "green" : "yellow",
              tooltip:
                data.source === "live"
                  ? "Live data from Confluence REST API"
                  : "Snapshot fallback — set CONFLUENCE_API_TOKEN in .env to go live",
            }
          : undefined
      }
      headerActions={
        data && (
          <Tooltip label="Open folder in Confluence">
            <ActionIcon
              component="a"
              href={data.folder_url}
              target="_blank"
              rel="noopener noreferrer"
              variant="subtle"
              size="md"
              aria-label="Open folder in Confluence"
            >
              <IconExternalLink size={16} />
            </ActionIcon>
          </Tooltip>
        )
      }
    >
      <Stack gap="lg">
        {data?.warning && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="yellow"
            variant="light"
            radius="md"
          >
            {data.warning}
          </Alert>
        )}
        {error && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="red"
            variant="light"
            radius="md"
          >
            Failed to load Confluence data: {error}
          </Alert>
        )}

        <TextInput
          leftSection={<IconSearch size={14} />}
          placeholder="Search carriers, names, phone, email…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          radius="md"
        />

        {filtered.length === 0 ? (
          <Box p="xl" ta="center">
            <ThemeIcon size={40} radius="xl" variant="light" color="gray" mx="auto">
              <IconFileText size={20} />
            </ThemeIcon>
            <Text c="dimmed" mt="sm">
              {query ? "No carriers match your search." : "No carriers loaded yet."}
            </Text>
          </Box>
        ) : (
          <Grid gutter="md">
            {filtered.map((c) => (
              <Grid.Col key={c.id} span={{ base: 12, sm: 6, lg: 4 }}>
                <CarrierCard carrier={c} />
              </Grid.Col>
            ))}
          </Grid>
        )}

        {data && (
          <Text size="xs" c="dimmed" ta="right">
            {data.carriers.length} carriers · cached for 24h · last refreshed{" "}
            {new Date(cachedAt ?? data.fetched_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            · click <IconRefresh size={10} style={{ verticalAlign: "middle" }} /> to force refresh
          </Text>
        )}
      </Stack>
    </WidgetFrame>
  );
}

function CarrierCard({ carrier }: { carrier: CarrierEscalation }) {
  const [aiResult, setAiResult] = useState<ImageExtractionResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiAttempted, setAiAttempted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hasImages = (carrier.images?.length ?? 0) > 0;
  const aiContacts = aiResult?.contacts ?? [];
  // Merge AI-extracted contacts into the displayed list. AI results take
  // precedence when the page's own scrape returned nothing.
  const displayedContacts: EscalationContact[] =
    carrier.contacts.length > 0 ? carrier.contacts : aiContacts;

  async function runExtractionFromUploads(uploads: FileUpload[]) {
    setAiLoading(true);
    setAiError(null);
    setAiAttempted(true);
    try {
      const r = await extractCarrierImages(carrier.id, {
        fileUploads: uploads,
        carrierName: carrier.carrier,
      });
      setAiResult(r);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  }

  // Auto-extract: server pulls images straight from Confluence via the
  // exportword endpoint (which accepts API-token auth), parses the MHTML
  // for inline base64 images, and pipes them to the AI vision model.
  // Server-side cache is 1 hour, so calling this on every render is cheap.
  async function runAutoExtraction(forceRefresh = false) {
    setAiLoading(true);
    setAiError(null);
    setAiAttempted(true);
    try {
      const r = await extractCarrierImages(carrier.id, {
        carrierName: carrier.carrier,
        refresh: forceRefresh,
      });
      setAiResult(r);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  }

  // ---- Auto-trigger on mount ----------------------------------------------
  // When a carrier has no scraped contacts but Confluence shows images on the
  // page, automatically run the AI extraction. Server-side cache returns
  // instantly on repeat visits, so this is cheap.
  useEffect(() => {
    if (
      carrier.contacts.length === 0 &&
      hasImages &&
      !aiAttempted &&
      !aiLoading
    ) {
      runAutoExtraction(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrier.id]);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).slice(0, 6);
    if (list.length === 0) return;
    const uploads: FileUpload[] = [];
    const errors: string[] = [];
    for (const f of list) {
      const result = await fileToUpload(f);
      if ("error" in result) {
        if (result.error.kind === "unsupported_type") {
          errors.push(
            `${f.name}: unsupported file type (${result.error.ext}). Use PNG/JPEG/GIF/WebP/PDF/DOCX/XLSX.`,
          );
        } else if (result.error.kind === "too_large") {
          errors.push(
            `${f.name}: too large (${result.error.sizeMb.toFixed(1)} MB, limit 15 MB).`,
          );
        } else {
          errors.push(`${f.name}: failed to read.`);
        }
      } else {
        uploads.push(result);
      }
    }
    if (uploads.length === 0) {
      setAiError(errors.join(" "));
      return;
    }
    if (errors.length > 0) setAiError(errors.join(" "));
    await runExtractionFromUploads(uploads);
  }

  return (
    <Card radius="md" withBorder p="md" h="100%">
      <Stack gap="sm" h="100%">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Box style={{ minWidth: 0 }}>
            <Title order={6} c="bright" style={{ lineHeight: 1.2 }}>
              {carrier.carrier}
            </Title>
            <Text size="xs" c="dimmed" truncate>
              {carrier.title}
            </Text>
          </Box>
          <Group gap={4}>
            {carrier.external_url && (
              <Tooltip label="External resource">
                <ActionIcon
                  component="a"
                  href={carrier.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="subtle"
                  size="sm"
                  color="cyan"
                  aria-label="External link"
                >
                  <IconExternalLink size={14} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label="View in Confluence">
              <ActionIcon
                component="a"
                href={carrier.url}
                target="_blank"
                rel="noopener noreferrer"
                variant="subtle"
                size="sm"
                aria-label="View page in Confluence"
              >
                <IconFileText size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {carrier.primary_phone || carrier.primary_email ? (
          <Box>
            <Stack gap={4}>
              {carrier.primary_phone && (
                <ContactLine
                  icon={IconPhone}
                  value={carrier.primary_phone}
                  href={`tel:${carrier.primary_phone.replace(/\s/g, "")}`}
                  color="green"
                />
              )}
              {carrier.primary_email && (
                <ContactLine
                  icon={IconMail}
                  value={carrier.primary_email}
                  href={`mailto:${carrier.primary_email}`}
                  color="blue"
                />
              )}
            </Stack>
          </Box>
        ) : null}

        {displayedContacts.length > 0 && (
          <>
            <Divider variant="dashed" />
            {aiResult && carrier.contacts.length === 0 && (
              <Group gap={6} align="center">
                <Badge
                  size="xs"
                  variant="light"
                  color="violet"
                  leftSection={<IconSparkles size={10} />}
                  title={aiResult?.warning ?? undefined}
                >
                  AI-extracted{aiResult?.warning?.includes("from ") ? "" : ""}
                </Badge>
                <Tooltip label="Re-extract from Confluence">
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    onClick={() => {
                      setAiResult(null);
                      setAiAttempted(false);
                      runAutoExtraction(true);
                    }}
                    aria-label="Re-extract from Confluence"
                    loading={aiLoading}
                  >
                    <IconRefresh size={11} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Upload a different image instead">
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    onClick={() => {
                      setAiResult(null);
                      setAiAttempted(false);
                      setTimeout(() => fileInputRef.current?.click(), 50);
                    }}
                    aria-label="Upload different image"
                  >
                    <IconPhoto size={11} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            )}
            <Stack gap={6}>
              {displayedContacts.map((contact, i) => (
                <Box key={i}>
                  <Group gap={6} wrap="nowrap" align="baseline">
                    <Badge
                      size="xs"
                      variant="light"
                      color={
                        aiResult && carrier.contacts.length === 0
                          ? "violet"
                          : "grape"
                      }
                    >
                      {contact.level}
                    </Badge>
                    {contact.name && (
                      <Text size="sm" fw={500} truncate>
                        {contact.name}
                      </Text>
                    )}
                  </Group>
                  {contact.role && (
                    <Text size="xs" c="dimmed" ml={4}>
                      {contact.role}
                    </Text>
                  )}
                  <Stack gap={2} mt={2} ml={4}>
                    {contact.phone && (
                      <ContactLine
                        icon={IconPhone}
                        value={contact.phone}
                        href={`tel:${contact.phone.replace(/\s/g, "")}`}
                        color="green"
                        compact
                      />
                    )}
                    {contact.email && (
                      <ContactLine
                        icon={IconMail}
                        value={contact.email}
                        href={`mailto:${contact.email}`}
                        color="blue"
                        compact
                      />
                    )}
                  </Stack>
                </Box>
              ))}
            </Stack>
          </>
        )}

        {/* AI extraction status — only shown when no contacts were scraped
            from the page text. Auto-triggers on mount; this UI just reflects
            state (loading / failed / no results / has PDF instead). NO image
            preview, no manual upload UI in the default case. */}
        {carrier.contacts.length === 0 && aiContacts.length === 0 && (
          <>
            <Divider variant="dashed" />

            {aiLoading && (
              <Group gap={8} c="violet.3" align="center">
                <Loader size={12} color="violet" />
                <Text size="xs" c="violet.3" fw={500}>
                  Extracting NOC contacts from Confluence with AI…
                </Text>
              </Group>
            )}

            {/* Hard error path (network/AI down) */}
            {!aiLoading && aiError && (
              <Alert
                icon={<IconAlertCircle size={14} />}
                color="red"
                variant="light"
                radius="md"
                p="xs"
                styles={{ message: { fontSize: 11 } }}
              >
                <Stack gap={6}>
                  <Text size="xs">{aiError}</Text>
                  <Button
                    size="compact-xs"
                    variant="light"
                    color="violet"
                    leftSection={<IconRefresh size={11} />}
                    onClick={() => runAutoExtraction(true)}
                    loading={aiLoading}
                  >
                    Retry
                  </Button>
                </Stack>
              </Alert>
            )}

            {/* Soft warning path: AI ran but found nothing usable.
                Surfaces PDF attachments (if any) as a direct link to the
                Confluence page where the user can view the matrix natively. */}
            {!aiLoading && !aiError && aiResult && aiResult.contacts.length === 0 && (
              <Alert
                icon={<IconAlertCircle size={14} />}
                color="yellow"
                variant="light"
                radius="md"
                p="xs"
                styles={{ message: { fontSize: 11 } }}
              >
                <Stack gap={6}>
                  <Text size="xs">
                    {aiResult.warning ??
                      "AI returned no NOC contacts for this carrier."}
                  </Text>
                  {(() => {
                    // Prefer the generalised `attachments` list; fall back
                    // to the legacy `pdf_attachments` until the server is
                    // guaranteed to send the new field.
                    const atts: ConfluenceAttachment[] =
                      aiResult.attachments ??
                      (aiResult.pdf_attachments ?? []).map((p) => ({
                        ...p,
                        kind: "pdf" as const,
                      }));
                    if (atts.length === 0) return null;
                    return (
                      <Stack gap={4}>
                        <Text size="xs" c="dimmed" style={{ fontSize: 10 }}>
                          Open in Confluence (uses your browser session):
                        </Text>
                        {atts.map((att, i) => (
                          <AttachmentButton key={i} attachment={att} />
                        ))}
                      </Stack>
                    );
                  })()}
                  <Group gap={6}>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="violet"
                      onClick={() => runAutoExtraction(true)}
                      leftSection={<IconRefresh size={11} />}
                    >
                      Re-run AI
                    </Button>
                    <Tooltip label="Upload an image, PDF, Word doc, or Excel spreadsheet">
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="violet"
                        onClick={() => fileInputRef.current?.click()}
                        leftSection={<IconFileUpload size={11} />}
                      >
                        Upload file
                      </Button>
                    </Tooltip>
                  </Group>
                </Stack>
              </Alert>
            )}

            {/* Carrier has no images at all AND nothing was scraped — page
                is genuinely empty or behind a PDF/Word attachment. */}
            {!aiLoading &&
              !aiError &&
              !aiResult &&
              !hasImages &&
              !carrier.body_text && (
                <Text size="xs" c="dimmed" fs="italic">
                  No contact data found on the Confluence page.
                </Text>
              )}

            {/* Hidden file input — only triggered via the "Upload file"
                fallback button. Accepts images, PDFs, Word docs, Excel
                spreadsheets. The server sniffs the bytes and dispatches by
                kind (image → vision, doc → text extraction → same NOC AI
                prompt). Up to 6 files at once, 15 MB each. */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/msword,.doc,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,application/vnd.ms-excel,.xls,text/csv,.csv"
              hidden
              onChange={(e) => {
                const fs = e.target.files;
                if (fs && fs.length > 0) {
                  void handleFiles(fs);
                  // Reset so re-selecting the same file fires onChange again.
                  e.target.value = "";
                }
              }}
            />
          </>
        )}

        {carrier.notes && (
          <>
            <Divider variant="dashed" />
            <Text size="xs" c="dimmed" fs="italic">
              {carrier.notes}
            </Text>
          </>
        )}

        {!carrier.primary_phone &&
          !carrier.primary_email &&
          carrier.contacts.length === 0 &&
          aiContacts.length === 0 &&
          !hasImages &&
          !carrier.notes &&
          !carrier.body_text && (
            <Text size="xs" c="dimmed" fs="italic">
              Contact details on the Confluence page.
            </Text>
          )}

        {/* Scraped body content — collapsed by default */}
        {(carrier.body_text ||
          (carrier.tables && carrier.tables.length > 0) ||
          (carrier.links && carrier.links.length > 0)) && (
          <Accordion
            variant="separated"
            chevron={<IconChevronDown size={14} />}
            styles={{
              item: {
                background: "var(--mantine-color-dark-6)",
                border: "1px solid var(--mantine-color-dark-4)",
              },
              control: { padding: "6px 10px" },
              content: { padding: "8px 10px" },
            }}
          >
            <Accordion.Item value="body">
              <Accordion.Control>
                <Group gap={6}>
                  <IconFileText size={12} />
                  <Text size="xs" fw={500}>
                    Full body content
                  </Text>
                  {carrier.has_full_body && (
                    <Badge size="xs" color="green" variant="light">
                      live
                    </Badge>
                  )}
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  {/* Tables */}
                  {carrier.tables?.map((t, i) => (
                    <Box key={`table-${i}`}>
                      <Group gap={4} mb={4}>
                        <IconTable size={11} style={{ opacity: 0.6 }} />
                        <Text size="xs" c="dimmed" fw={500}>
                          {t.caption ?? `Table ${i + 1}`}
                        </Text>
                      </Group>
                      <ScrollArea.Autosize mah={220} type="auto">
                        <Table
                          striped
                          highlightOnHover
                          withTableBorder
                          fz="xs"
                          verticalSpacing={4}
                          horizontalSpacing={6}
                        >
                          <Table.Thead>
                            <Table.Tr>
                              {t.headers.map((h, hi) => (
                                <Table.Th key={hi} style={{ whiteSpace: "nowrap" }}>
                                  {h}
                                </Table.Th>
                              ))}
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {t.rows.map((row, ri) => (
                              <Table.Tr key={ri}>
                                {row.map((cell, ci) => (
                                  <Table.Td
                                    key={ci}
                                    style={{ verticalAlign: "top" }}
                                  >
                                    {renderCell(cell)}
                                  </Table.Td>
                                ))}
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      </ScrollArea.Autosize>
                    </Box>
                  ))}

                  {/* External links */}
                  {carrier.links && carrier.links.length > 0 && (
                    <Box>
                      <Group gap={4} mb={4}>
                        <IconLink size={11} style={{ opacity: 0.6 }} />
                        <Text size="xs" c="dimmed" fw={500}>
                          Links
                        </Text>
                      </Group>
                      <Stack gap={3}>
                        {carrier.links.slice(0, 12).map((l, i) => (
                          <Anchor
                            key={i}
                            href={l.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            size="xs"
                            style={{ wordBreak: "break-all" }}
                          >
                            {l.text}
                          </Anchor>
                        ))}
                      </Stack>
                    </Box>
                  )}

                  {/* Plain text body */}
                  {carrier.body_text && (
                    <Box>
                      <Group gap={4} mb={4}>
                        <IconFileText size={11} style={{ opacity: 0.6 }} />
                        <Text size="xs" c="dimmed" fw={500}>
                          Body text
                        </Text>
                      </Group>
                      <ScrollArea.Autosize mah={220} type="auto">
                        <Code
                          block
                          style={{
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            background: "var(--mantine-color-dark-7)",
                            fontSize: 11,
                            lineHeight: 1.5,
                          }}
                        >
                          {carrier.body_text}
                        </Code>
                      </ScrollArea.Autosize>
                    </Box>
                  )}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        )}

        <Box style={{ flex: 1 }} />
        <Anchor
          href={carrier.url}
          target="_blank"
          rel="noopener noreferrer"
          size="xs"
          c="dimmed"
        >
          View full list in Confluence ↗
        </Anchor>
      </Stack>
    </Card>
  );
}

/**
 * Render a single table cell. If the cell looks like an email or phone, make
 * it clickable; if it contains multiple lines, preserve them.
 */
function renderCell(cell: string) {
  if (!cell || cell === "—") {
    return <Text size="xs" c="dimmed">—</Text>;
  }
  const emailMatch = cell.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const phoneMatch = cell.match(
    /\b(?:1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  );
  if (emailMatch && emailMatch[0] === cell.trim()) {
    return (
      <Anchor href={`mailto:${emailMatch[0]}`} size="xs">
        {emailMatch[0]}
      </Anchor>
    );
  }
  if (phoneMatch && phoneMatch[0] === cell.trim()) {
    return (
      <Anchor href={`tel:${phoneMatch[0].replace(/\s/g, "")}`} size="xs">
        {phoneMatch[0]}
      </Anchor>
    );
  }
  return (
    <Text size="xs" style={{ whiteSpace: "pre-wrap" }}>
      {cell}
    </Text>
  );
}

function ContactLine({
  icon: Icon,
  value,
  href,
  color,
  compact,
}: {
  icon: React.ComponentType<{ size?: number }>;
  value: string;
  href: string;
  color: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Group gap={6} wrap="nowrap">
      <ThemeIcon size={compact ? "xs" : "sm"} variant="light" color={color} radius="sm">
        <Icon size={compact ? 10 : 12} />
      </ThemeIcon>
      <Anchor href={href} size={compact ? "xs" : "sm"} truncate style={{ minWidth: 0 }}>
        {value}
      </Anchor>
      <Tooltip label={copied ? "Copied!" : "Copy"} withinPortal>
        <ActionIcon
          size="xs"
          variant="subtle"
          color="gray"
          aria-label="Copy"
          onClick={(e) => {
            e.preventDefault();
            navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <IconCopy size={10} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

/* -------------------------------------------------------------------------- */
/* AttachmentButton — full-width clickable row showing kind icon + filename.   */
/* Used when the AI couldn't auto-extract contacts because they live in a      */
/* PDF/Word/Excel/PowerPoint attachment that Atlassian's API token can't       */
/* download. Clicking opens it in Confluence in a new tab, where the user's    */
/* browser session authenticates and the file renders inline.                  */
/* -------------------------------------------------------------------------- */

const ATTACHMENT_KIND_META: Record<
  AttachmentKind,
  { label: string; Icon: React.ComponentType<{ size?: number }>; color: string }
> = {
  pdf: { label: "PDF", Icon: IconFileTypePdf, color: "red" },
  docx: { label: "Word doc", Icon: IconFileWord, color: "blue" },
  xlsx: { label: "Excel", Icon: IconFileSpreadsheet, color: "green" },
  pptx: { label: "PowerPoint", Icon: IconPresentation, color: "orange" },
};

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentButton({ attachment }: { attachment: ConfluenceAttachment }) {
  const meta = ATTACHMENT_KIND_META[attachment.kind];
  const Icon = meta.Icon;
  const sizeLabel = formatBytes(attachment.file_size);
  return (
    <Tooltip
      label={`Open ${attachment.title} in Confluence (new tab)`}
      withinPortal
    >
      <Anchor
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        underline="never"
        style={{
          display: "block",
          padding: "6px 8px",
          borderRadius: 6,
          border:
            "1px solid color-mix(in srgb, var(--mantine-color-violet-6) 25%, var(--widget-tile-border))",
          background:
            "color-mix(in srgb, var(--mantine-color-violet-6) 8%, var(--widget-tile-surface))",
          textDecoration: "none",
          transition: "background 120ms ease, border-color 120ms ease",
        }}
      >
        <Group gap={6} wrap="nowrap" align="center">
          <ThemeIcon
            size="sm"
            radius="sm"
            variant="light"
            color={meta.color}
            style={{ flexShrink: 0 }}
          >
            <Icon size={12} />
          </ThemeIcon>
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Text
              size="xs"
              fw={500}
              c="bright"
              lh={1.25}
              style={{
                // Wrap, don't truncate — the user needs to read the full
                // filename to know which carrier doc they're opening.
                wordBreak: "break-word",
                whiteSpace: "normal",
              }}
            >
              {attachment.title}
            </Text>
            <Group gap={6} mt={1}>
              <Text size="xs" c="dimmed" style={{ fontSize: 9 }}>
                {meta.label}
                {sizeLabel ? ` · ${sizeLabel}` : ""}
              </Text>
            </Group>
          </Box>
          <IconExternalLink
            size={11}
            style={{
              flexShrink: 0,
              color: "var(--mantine-color-violet-6)",
            }}
          />
        </Group>
      </Anchor>
    </Tooltip>
  );
}
