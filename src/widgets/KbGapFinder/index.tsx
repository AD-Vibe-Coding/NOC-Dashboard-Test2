import { useEffect, useRef, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Card, Divider, Group, Loader,
  Modal, ScrollArea, Stack, Text, Textarea, ThemeIcon, Anchor, Tabs,
} from "@mantine/core";
import {
  IconAlertCircle, IconBook, IconBook2, IconBulb, IconCheck, IconCopy,
  IconExternalLink, IconFlag, IconLayoutList, IconSearch, IconSparkles, IconTrash,
} from "@tabler/icons-react";
import { db } from "../../db";
import { WidgetFrame } from "../WidgetFrame";
import { useIdentity } from "../../lib/identity";
import { useCompletion } from "../../lib/devs-ai/use-completion";

type KbGap = Awaited<ReturnType<typeof db.kb_gaps.list>>[number];

interface ConfluencePage {
  id: string;
  title: string;
  url: string;
  excerpt: string;
}

const CONFLUENCE_BASE = "https://appdirect.jira.com/wiki";
const CONFLUENCE_SPACE = `${CONFLUENCE_BASE}/spaces/vComNoc`;
const CONFLUENCE_URL = `${CONFLUENCE_SPACE}/overview`;

const QUICK_LINKS = [
  { label: "📚 KB Overview",            url: CONFLUENCE_URL,          desc: "Main NOC knowledge base" },
  { label: "🔌 Circuit Troubleshooting", url: CONFLUENCE_URL,          desc: "Fiber, MPLS, SD-WAN issues" },
  { label: "📞 Carrier Escalations",    url: CONFLUENCE_URL,          desc: "Escalation contacts & procedures" },
  { label: "📱 Mobility Runbooks",       url: CONFLUENCE_URL,          desc: "Wireless & device support" },
  { label: "☎ VoIP / UCaaS",            url: CONFLUENCE_URL,          desc: "Voice & collaboration issues" },
  { label: "🚨 Outage Procedures",       url: CONFLUENCE_URL,          desc: "Major incident handling" },
];

function timeAgo(ts: Date | string) {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function KbGapFinderWidget(_props: { onCollapse?: () => void }) {
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";
  const myName = identity?.name ?? "";

  // ── Search KB state ──────────────────────────────────────────────────────
  const [question, setQuestion] = useState("");
  const [cfResults, setCfResults] = useState<ConfluencePage[]>([]);
  const [cfLoading, setCfLoading] = useState(false);
  const [cfError, setCfError] = useState<string | null>(null);
  const [cfTotal, setCfTotal] = useState(0);
  const [searched, setSearched] = useState(false);
  const [kbCopied, setKbCopied] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { complete: completeKb, result: aiKbAnswer, isLoading: aiKbLoading, error: aiKbError } = useCompletion();

  // ── Runbook state ────────────────────────────────────────────────────────
  const [rbQuestion, setRbQuestion] = useState("");
  const [rbCopied, setRbCopied] = useState(false);
  const { complete: completeRb, result: rbAnswer, isLoading: rbLoading, error: rbError } = useCompletion();

  // ── Gap Reports state ────────────────────────────────────────────────────
  const [gaps, setGaps] = useState<KbGap[]>([]);
  const [gapError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [resolveModal, setResolveModal] = useState<KbGap | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [resolveUrl, setResolveUrl] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadGaps() {
    try {
      const rows = await db.kb_gaps.list({ orderBy: { column: "created_at", ascending: false } });
      setGaps(Array.isArray(rows) ? rows : []);
    } catch {
      // silently show empty state if table not yet provisioned
    }
  }
  useEffect(() => { void loadGaps(); }, []);

  // ── Confluence search ────────────────────────────────────────────────────
  async function searchConfluence() {
    const q = question.trim();
    if (!q) return;
    setCfLoading(true);
    setCfError(null);
    setCfResults([]);
    setSearched(true);
    try {
      const res = await fetch(`/api/confluence/search?q=${encodeURIComponent(q)}`);
      const data = await res.json() as { pages?: ConfluencePage[]; total?: number; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Search failed");
      setCfResults(data.pages ?? []);
      setCfTotal(data.total ?? 0);
    } catch (e) {
      setCfError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setCfLoading(false);
    }
  }

  async function askKbAI() {
    if (!question.trim()) return;
    const ctx = cfResults.length > 0
      ? `\n\nRelevant Confluence pages:\n${cfResults.map(p => `- ${p.title}: ${p.excerpt.slice(0, 300)}`).join("\n")}`
      : "";
    await completeKb(`You are a NOC assistant for AppDirect vCom.
Agent asks: "${question.trim()}"${ctx}
Answer concisely using the Confluence content above (if any) and your NOC knowledge.
If not covered, say so and note it may be a KB gap. Max 250 words.`);
  }

  // ── Runbook AI ───────────────────────────────────────────────────────────
  async function askRunbook() {
    if (!rbQuestion.trim()) return;
    await completeRb(`You are a senior NOC engineer at AppDirect vCom.
A technician asks: "${rbQuestion.trim()}"

Provide a numbered step-by-step runbook answer drawing on:
- Carrier circuit troubleshooting (fiber, MPLS, Ethernet, SD-WAN, BGP)
- Escalation procedures (Tier 1 → Tier 2 → Carrier)
- VoIP / UCaaS troubleshooting
- Mobility / wireless device issues
- NOC procedures (ticket handling, outage comms, bridge setup)

Be specific and actionable. Max 300 words.`);
  }

  // ── Gap management ───────────────────────────────────────────────────────
  async function reportGap() {
    if (!question.trim()) return;
    setSaving(true);
    try {
      await db.kb_gaps.insert({
        question: question.trim(),
        reported_by: myName,
        ai_response: aiKbAnswer || null,
        status: "open",
        resolved_by: null,
        resolution_note: null,
        confluence_url: null,
      });
      setReportOpen(false);
      await loadGaps();
    } finally {
      setSaving(false);
    }
  }

  async function resolveGap() {
    if (!resolveModal) return;
    setSaving(true);
    try {
      await db.kb_gaps.updateById(resolveModal.id, {
        status: "resolved",
        resolved_by: myName,
        resolution_note: resolveNote.trim() || null,
        confluence_url: resolveUrl.trim() || null,
      });
      setResolveModal(null);
      setResolveNote("");
      setResolveUrl("");
      await loadGaps();
    } finally {
      setSaving(false);
    }
  }

  async function deleteGap(g: KbGap) {
    await db.kb_gaps.deleteById(g.id);
    await loadGaps();
  }

  const openGaps = gaps.filter(g => g.status !== "resolved");

  return (
    <WidgetFrame title="NOC Knowledge Base" icon={IconBook} iconColor="indigo">
      <Tabs defaultValue="search" keepMounted={false}>
        <Tabs.List px="md" pt="xs">
          <Tabs.Tab value="search"   leftSection={<IconSearch size={13} />}>Search KB</Tabs.Tab>
          <Tabs.Tab value="runbook"  leftSection={<IconBook2 size={13} />}>Runbook AI</Tabs.Tab>
          <Tabs.Tab value="links"    leftSection={<IconLayoutList size={13} />}>Quick Links</Tabs.Tab>
          <Tabs.Tab value="gaps"     leftSection={<IconFlag size={13} />}>
            Gaps
            {openGaps.length > 0 && <Badge size="xs" color="red" variant="filled" ml={6}>{openGaps.length}</Badge>}
          </Tabs.Tab>
        </Tabs.List>

        {/* ──────────────────── SEARCH KB TAB ──────────────────────────── */}
        <Tabs.Panel value="search" p="md">
          <Stack gap="md">
            <Textarea
              ref={inputRef}
              placeholder='e.g. "BGP flap troubleshooting", "fiber outage AT&T escalation", "VoIP no dial tone"'
              value={question}
              onChange={e => { setQuestion(e.currentTarget.value); setSearched(false); setCfResults([]); }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void searchConfluence(); } }}
              minRows={2} maxRows={4} autosize
            />
            <Group gap="xs">
              <Button
                leftSection={cfLoading ? <Loader size={13} color="white" /> : <IconSearch size={14} />}
                color="indigo" disabled={!question.trim()} loading={cfLoading}
                onClick={() => void searchConfluence()}
              >
                Search KB
              </Button>
              <Button
                leftSection={<IconSparkles size={14} />} variant="light" color="violet"
                loading={aiKbLoading} disabled={!question.trim()}
                onClick={() => void askKbAI()}
              >
                Ask AI
              </Button>
              <Anchor href={CONFLUENCE_URL} target="_blank" size="xs" ml="auto" style={{ alignSelf: "center" }}>
                <Group gap={4} wrap="nowrap"><IconExternalLink size={12} />Browse all</Group>
              </Anchor>
            </Group>

            {cfError && (
              <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light" withCloseButton onClose={() => setCfError(null)}>
                {cfError}
              </Alert>
            )}

            {searched && !cfLoading && cfResults.length === 0 && !cfError && (
              <Card withBorder radius="lg" p="md">
                <Stack align="center" gap="xs">
                  <ThemeIcon size={40} radius="xl" color="orange" variant="light"><IconFlag size={22} /></ThemeIcon>
                  <Text fw={600} size="sm">No pages found in Confluence</Text>
                  <Text size="xs" c="dimmed" ta="center">Try "Ask AI" for a best-effort answer, or report a knowledge gap.</Text>
                  <Group gap="xs">
                    <Button size="xs" variant="light" color="violet" leftSection={<IconSparkles size={12} />}
                      loading={aiKbLoading} onClick={() => void askKbAI()}>Ask AI</Button>
                    <Button size="xs" variant="light" color="orange" leftSection={<IconFlag size={12} />}
                      onClick={() => setReportOpen(true)}>Report Gap</Button>
                  </Group>
                </Stack>
              </Card>
            )}

            {cfResults.length > 0 && (
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="xs" fw={600} c="dimmed">{cfResults.length} of {cfTotal} PAGES IN CONFLUENCE</Text>
                  <Button size="xs" variant="light" color="violet" leftSection={<IconSparkles size={11} />}
                    loading={aiKbLoading} onClick={() => void askKbAI()}>
                    Summarise with AI
                  </Button>
                </Group>
                <ScrollArea.Autosize mah={360}>
                  <Stack gap="sm">
                    {cfResults.map(page => (
                      <Card key={page.id} withBorder radius="lg" p="md">
                        <Stack gap="xs">
                          <Group justify="space-between" wrap="nowrap" gap="xs">
                            <Text fw={700} size="sm" lineClamp={1} style={{ flex: 1 }}>{page.title}</Text>
                            <Anchor href={page.url} target="_blank" size="xs" style={{ flexShrink: 0 }}>
                              <Group gap={4} wrap="nowrap"><IconExternalLink size={12} />Open</Group>
                            </Anchor>
                          </Group>
                          {page.excerpt && (
                            <Text size="xs" c="dimmed" lineClamp={4} style={{ lineHeight: 1.6 }}>{page.excerpt}</Text>
                          )}
                        </Stack>
                      </Card>
                    ))}
                  </Stack>
                </ScrollArea.Autosize>
              </Stack>
            )}

            {(aiKbError || gapError) && !cfError && (
              <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light">{aiKbError ?? gapError}</Alert>
            )}

            {aiKbAnswer && (
              <Card withBorder radius="lg" p="md" style={{ borderColor: "var(--mantine-color-violet-7)" }}>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Group gap="xs">
                      <ThemeIcon size="sm" color="violet" variant="light"><IconBulb size={12} /></ThemeIcon>
                      <Text size="xs" fw={600} c="dimmed">AI ANSWER</Text>
                    </Group>
                    <Button size="xs" variant="subtle" color={kbCopied ? "green" : "gray"}
                      leftSection={kbCopied ? <IconCheck size={11} /> : <IconCopy size={11} />}
                      onClick={() => { navigator.clipboard.writeText(aiKbAnswer); setKbCopied(true); setTimeout(() => setKbCopied(false), 2000); }}>
                      {kbCopied ? "Copied" : "Copy"}
                    </Button>
                  </Group>
                  <Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{aiKbAnswer}</Text>
                  <Divider />
                  <Group justify="space-between" align="center">
                    <Text size="xs" c="dimmed">Answer missing or incorrect?</Text>
                    <Button size="xs" variant="light" color="orange" leftSection={<IconFlag size={12} />}
                      onClick={() => setReportOpen(true)}>Report Gap</Button>
                  </Group>
                </Stack>
              </Card>
            )}
          </Stack>
        </Tabs.Panel>

        {/* ──────────────────── RUNBOOK AI TAB ─────────────────────────── */}
        <Tabs.Panel value="runbook" p="md">
          <Stack gap="md">
            <Text size="xs" c="dimmed">
              Ask any NOC procedure question. The AI will provide numbered step-by-step runbook guidance.
            </Text>
            <Textarea
              placeholder='e.g. "Customer reports no dial tone on VoIP — first 5 steps?" or "How do I open a bridge for a major outage?"'
              value={rbQuestion}
              onChange={e => setRbQuestion(e.currentTarget.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void askRunbook(); } }}
              minRows={2} maxRows={5} autosize
            />
            <Group gap="xs">
              <Button leftSection={<IconSparkles size={14} />} color="cyan"
                onClick={() => void askRunbook()} loading={rbLoading} disabled={!rbQuestion.trim()}>
                Get Runbook Steps
              </Button>
              <Anchor href={CONFLUENCE_URL} target="_blank" size="xs" style={{ alignSelf: "center" }}>
                <Group gap={4} wrap="nowrap"><IconExternalLink size={12} />Open Confluence</Group>
              </Anchor>
            </Group>

            {rbError && (
              <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light">{rbError}</Alert>
            )}

            {rbAnswer && (
              <Card withBorder radius="lg" p="md" style={{ borderColor: "var(--mantine-color-cyan-7)" }}>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Group gap="xs">
                      <ThemeIcon size="sm" color="cyan" variant="light"><IconBulb size={12} /></ThemeIcon>
                      <Text size="xs" fw={600} c="dimmed">RUNBOOK STEPS</Text>
                    </Group>
                    <Button size="xs" variant="subtle" color={rbCopied ? "green" : "gray"}
                      leftSection={rbCopied ? <IconCheck size={11} /> : <IconCopy size={11} />}
                      onClick={() => { navigator.clipboard.writeText(rbAnswer); setRbCopied(true); setTimeout(() => setRbCopied(false), 2000); }}>
                      {rbCopied ? "Copied" : "Copy"}
                    </Button>
                  </Group>
                  <Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{rbAnswer}</Text>
                  <Divider />
                  <Anchor href={CONFLUENCE_URL} target="_blank" size="xs" c="dimmed">
                    <Group gap={4}><IconExternalLink size={12} />Verify against official Confluence runbooks</Group>
                  </Anchor>
                </Stack>
              </Card>
            )}
          </Stack>
        </Tabs.Panel>

        {/* ──────────────────── QUICK LINKS TAB ────────────────────────── */}
        <Tabs.Panel value="links" p="md">
          <Stack gap="sm">
            <Group justify="space-between" align="center">
              <Text size="xs" c="dimmed">Direct links to NOC Confluence sections</Text>
              <Anchor href={CONFLUENCE_URL} target="_blank" size="xs">
                <Group gap={4} wrap="nowrap"><IconExternalLink size={12} />Open full KB</Group>
              </Anchor>
            </Group>
            {QUICK_LINKS.map(link => (
              <Card key={link.label} withBorder radius="md" p="sm"
                component="a" href={link.url} target="_blank"
                style={{ cursor: "pointer", textDecoration: "none", color: "inherit" }}>
                <Group justify="space-between" align="center">
                  <Stack gap={2}>
                    <Text size="sm" fw={600}>{link.label}</Text>
                    <Text size="xs" c="dimmed">{link.desc}</Text>
                  </Stack>
                  <IconExternalLink size={14} color="var(--mantine-color-dimmed)" />
                </Group>
              </Card>
            ))}
          </Stack>
        </Tabs.Panel>

        {/* ──────────────────── GAP REPORTS TAB ────────────────────────── */}
        <Tabs.Panel value="gaps" p="md">
          <Stack gap="sm">
            {gapError && (
              <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light">{gapError}</Alert>
            )}
            {gaps.length === 0 ? (
              <Card withBorder radius="lg" p="xl">
                <Stack align="center" gap="sm">
                  <ThemeIcon size={48} radius="xl" color="green" variant="light"><IconCheck size={28} /></ThemeIcon>
                  <Text fw={600}>No gaps reported</Text>
                  <Text size="sm" c="dimmed">All questions answered!</Text>
                </Stack>
              </Card>
            ) : gaps.map(g => (
              <Card key={g.id} withBorder radius="lg" p="md"
                style={g.status === "resolved" ? { opacity: 0.6 } : undefined}>
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Stack gap={4} style={{ flex: 1 }}>
                    <Group gap="xs">
                      <Badge color={g.status === "resolved" ? "green" : g.status === "in_review" ? "yellow" : "red"}
                        variant="light" size="xs">{g.status}</Badge>
                      <Text size="xs" c="dimmed">{timeAgo(g.created_at)} · {g.reported_by}</Text>
                    </Group>
                    <Text size="sm" fw={600}>{g.question}</Text>
                    {g.resolution_note && <Text size="xs" c="teal.4">✓ {g.resolution_note}</Text>}
                    {g.confluence_url && (
                      <Anchor href={g.confluence_url} target="_blank" size="xs">
                        <Group gap={4}><IconExternalLink size={11} />View in Confluence</Group>
                      </Anchor>
                    )}
                  </Stack>
                  <Group gap="xs">
                    {isManager && g.status !== "resolved" && (
                      <Button size="xs" variant="light" color="teal" onClick={() => setResolveModal(g)}>Resolve</Button>
                    )}
                    {isManager && (
                      <ActionIcon variant="subtle" color="red" size="sm" onClick={() => void deleteGap(g)}>
                        <IconTrash size={13} />
                      </ActionIcon>
                    )}
                  </Group>
                </Group>
              </Card>
            ))}
          </Stack>
        </Tabs.Panel>
      </Tabs>

      {/* ── Report gap modal ── */}
      <Modal opened={reportOpen} onClose={() => setReportOpen(false)}
        title={<Group gap="xs"><IconFlag size={16} color="var(--mantine-color-orange-4)" /><Text fw={700}>Report KB Gap</Text></Group>}
        radius="lg" centered size="sm">
        <Stack gap="md">
          <Text size="sm" c="dimmed">Flag this question as missing from the knowledge base so your manager can add it to Confluence.</Text>
          <Card withBorder radius="md" p="sm"><Text size="sm" fw={600}>{question}</Text></Card>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setReportOpen(false)}>Cancel</Button>
            <Button color="orange" leftSection={<IconFlag size={14} />} onClick={() => void reportGap()} loading={saving}>
              Report Gap
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ── Resolve modal (manager) ── */}
      <Modal opened={!!resolveModal} onClose={() => setResolveModal(null)}
        title={<Group gap="xs"><IconCheck size={16} color="var(--mantine-color-teal-4)" /><Text fw={700}>Resolve Gap</Text></Group>}
        radius="lg" centered size="sm">
        <Stack gap="md">
          {resolveModal && <Card withBorder radius="md" p="sm"><Text size="sm" fw={600}>{resolveModal.question}</Text></Card>}
          <Textarea label="Resolution note" placeholder="e.g. Added runbook to the BGP section in Confluence"
            value={resolveNote} onChange={e => setResolveNote(e.currentTarget.value)} minRows={2} />
          <Textarea label="Confluence URL (optional)" placeholder="https://appdirect.jira.com/wiki/…"
            value={resolveUrl} onChange={e => setResolveUrl(e.currentTarget.value)} minRows={1} autosize />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setResolveModal(null)}>Cancel</Button>
            <Button color="teal" leftSection={<IconCheck size={14} />} onClick={() => void resolveGap()} loading={saving}>Mark Resolved</Button>
          </Group>
        </Stack>
      </Modal>
    </WidgetFrame>
  );
}

export function KbGapFinderTile({ onExpand }: { onExpand: () => void }) {
  const [openCount, setOpenCount] = useState<number | null>(null);
  useEffect(() => {
    db.kb_gaps.list().then(rows => setOpenCount(Array.isArray(rows) ? rows.filter(r => r.status !== "resolved").length : 0)).catch(() => {});
  }, []);
  return (
    <Card withBorder radius="lg" p="md" style={{ cursor: "pointer", height: "100%" }} onClick={onExpand}>
      <Group gap="sm" align="flex-start">
        <ThemeIcon size={36} radius="md" variant="light" color="indigo">
          <IconBook size={20} />
        </ThemeIcon>
        <Stack gap={2} style={{ flex: 1 }}>
          <Text fw={700} size="sm">NOC Knowledge Base</Text>
          <Text size="xs" c="dimmed">Search KB · Runbook AI · Quick links · Gap reports</Text>
          <Group gap={4} mt={4}>
            <Badge size="xs" variant="light" color="indigo">Confluence</Badge>
            <Badge size="xs" variant="light" color="cyan">Runbook AI</Badge>
            {openCount !== null && openCount > 0 && (
              <Badge size="xs" variant="light" color="red">{openCount} gap{openCount !== 1 ? "s" : ""}</Badge>
            )}
          </Group>
        </Stack>
      </Group>
    </Card>
  );
}
