import { useEffect, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Card, Checkbox, Divider, Group,
  Progress, ScrollArea, Select, SimpleGrid, Stack, Switch, Tabs, Text,
  Textarea, TextInput, ThemeIcon,
} from "@mantine/core";
import {
  IconAlertCircle, IconCheck, IconChevronDown, IconChevronUp,
  IconClipboardList, IconHistory, IconPlus, IconSend,
  IconTrash, IconUsers,
} from "@tabler/icons-react";
import { db } from "../../db";
import { WidgetFrame } from "../WidgetFrame";
import { useIdentity } from "../../lib/identity";
import { postSlackMessage } from "../../lib/slack";
import { LOCKED_TEAM_NAMES } from "../PerformanceTracker/team";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TicketEntry {
  _key: string;
  ticket_id: string;
  status: string;
  next_plan: string;
  due_date: string;
  assigned_to: string;
  owner_in_threads: "Yes" | "No" | "";
  summary_in_ticket: "Yes" | "No" | "";
}

interface BridgeEntry {
  _key: string;
  ticket_id: string;
  scheduled_time: string;
  purpose: string;
  bridge_link: string;
  assigned_to: string;
  owner_in_threads: boolean;
  summary_in_ticket: boolean;
}

type HandoverRow = Awaited<ReturnType<typeof db.shift_handovers.list>>[number];

// ─── Constants ────────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

const SHIFT_OPTIONS = [
  { value: "Early Shift",       label: "🌙 Early Shift (2 AM – 6 AM)" },
  { value: "Morning Shift",     label: "☀️ Morning Shift (8 AM)" },
  { value: "Mid-Morning Shift", label: "🌤 Mid-Morning Shift (10–11 AM)" },
  { value: "Night Shift",       label: "🌑 Night Shift (after 6 PM)" },
];

function autoDetectShift(): string {
  const h = new Date().getHours();
  if (h >= 2 && h < 7)  return "Early Shift";
  if (h >= 7 && h < 10) return "Morning Shift";
  if (h >= 10 && h < 18) return "Mid-Morning Shift";
  return "Night Shift";
}

function isWeekendToday(): boolean {
  const d = new Date().getDay();
  return d === 0 || d === 6;
}

function newTicket(o?: Partial<TicketEntry>): TicketEntry {
  return {
    _key: crypto.randomUUID(),
    ticket_id: "",
    status: "Carrier Investigating",
    next_plan: "",
    due_date: "",
    assigned_to: "",
    owner_in_threads: "",
    summary_in_ticket: "",
    ...o,
  };
}

function newBridge(o?: Partial<BridgeEntry>): BridgeEntry {
  return {
    _key: crypto.randomUUID(),
    ticket_id: "", scheduled_time: "", purpose: "",
    bridge_link: "", assigned_to: "",
    owner_in_threads: false, summary_in_ticket: false,
    ...o,
  };
}

// ─── Body/Subject generators ──────────────────────────────────────────────────

function generateSubject(shiftName: string, date: string): string {
  const d = new Date(date + "T12:00:00");
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  return `Shift Handover | ${shiftName} | ${month} ${day} |`;
}

interface BodyParams {
  shiftName: string; shiftDate: string; agentName: string;
  tickets: TicketEntry[]; bridges: BridgeEntry[];
  activeServiceNote: string; rollingHandoffNote: string;
  isWeekendHoliday: boolean; newTicketsCount: string;
  p1p2Count: string; shiftOccupancy: string; idleTimeNote: string;
}

function generateSlackBody(p: BodyParams): string {
  // Slack version — no header (name/date/prepared-by). Bot username carries the author.
  const lines: string[] = [];

  if (p.tickets.length > 0) {
    lines.push("*1. High-Priority Incidents (P1/P2)*");
    for (const t of p.tickets) {
      lines.push("");
      if (t.ticket_id) lines.push(`Ticket #${t.ticket_id}`);
      if (t.status)     lines.push(`   Status: ${t.status}`);
      if (t.next_plan)  lines.push(`   Next Plan of Action: ${t.next_plan}`);
      if (t.due_date)   lines.push(`   Due Date: ${t.due_date}`);
      if (t.assigned_to) lines.push(`   Assigned to: ${t.assigned_to}`);
      lines.push(`   Add the next owner to all related email threads: ${t.owner_in_threads || "Not set"}`);
      lines.push(`   Ticket Summary added to ticket: ${t.summary_in_ticket || "Not set"}`);
    }
  }

  if (p.bridges.length > 0) {
    if (lines.length) lines.push("");
    lines.push("*2. Upcoming Bridge Calls:*");
    for (const b of p.bridges) {
      lines.push("");
      if (b.ticket_id)      lines.push(`Ticket #${b.ticket_id}:`);
      if (b.scheduled_time) lines.push(`   Scheduled: ${b.scheduled_time}`);
      if (b.purpose)        lines.push(`   Purpose: ${b.purpose}`);
      if (b.bridge_link)    lines.push(`   Bridge Invite: ${b.bridge_link}`);
      if (b.assigned_to)    lines.push(`   Assigned to: ${b.assigned_to}`);
      if (b.owner_in_threads || b.summary_in_ticket) {
        lines.push(`   Add the next owner to all related email threads and Bridge Invite: ${b.owner_in_threads ? "Yes" : "No"}`);
        lines.push(`   Ticket Summary added to ticket: ${b.summary_in_ticket ? "Yes" : "No"}`);
      }
    }
  }

  if (p.activeServiceNote.trim()) {
    if (lines.length) lines.push("");
    lines.push(`*3. Active Service:*\n   ${p.activeServiceNote.trim()}`);
  }

  if (p.rollingHandoffNote.trim()) {
    if (lines.length) lines.push("");
    lines.push(`*4. Rolling Handoff:*\n   ${p.rollingHandoffNote.trim()}`);
  }

  if (p.isWeekendHoliday) {
    const hasData = p.newTicketsCount || p.p1p2Count || p.shiftOccupancy || p.idleTimeNote;
    if (hasData) {
      if (lines.length) lines.push("");
      lines.push("*Weekend / US Holiday*");
      if (p.newTicketsCount) lines.push(`New Tickets: ${p.newTicketsCount}`);
      if (p.p1p2Count)       lines.push(`P1 / P2 Tickets: ${p.p1p2Count}`);
      if (p.shiftOccupancy)  lines.push(`Shift Occupancy: ${p.shiftOccupancy}`);
      if (p.idleTimeNote)    lines.push(`Idle Time: ${p.idleTimeNote}`);
    }
  }

  return lines.join("\n");
}

function generateBody(p: BodyParams): string {
  const lines: string[] = [];
  lines.push(`Subject: ${generateSubject(p.shiftName, p.shiftDate)}`);
  lines.push("");
  lines.push(`Shift Name: ${p.shiftName}`);
  lines.push(`Date: ${p.shiftDate}`);
  if (p.agentName) lines.push(`Prepared by: ${p.agentName}`);


  // 1. P1/P2 — only include if there are tickets
  if (p.tickets.length > 0) {
    lines.push("");
    lines.push("1. High-Priority Incidents (P1/P2)");
    for (const t of p.tickets) {
      lines.push("");
      if (t.ticket_id)      lines.push(`Ticket #${t.ticket_id}`);
      if (t.status)         lines.push(`   Status: ${t.status}`);
      if (t.next_plan)      lines.push(`   Next Plan of Action: ${t.next_plan}`);
      if (t.due_date)       lines.push(`   Due Date: ${t.due_date}`);
      if (t.assigned_to)    lines.push(`   Assigned to: ${t.assigned_to}`);
      // Only include checklist fields if at least one is checked
      if (t.owner_in_threads || t.summary_in_ticket) {
        lines.push(`   Add the next owner to all related email threads: ${t.owner_in_threads ? "Yes" : "No"}`);
        lines.push(`   Ticket Summary added to ticket: ${t.summary_in_ticket ? "Yes" : "No"}`);
      }
    }
  }

  // 2. Bridge Calls — only include if there are bridge entries
  if (p.bridges.length > 0) {
    lines.push("");
    lines.push("2. Upcoming Bridge Calls:");
    for (const b of p.bridges) {
      lines.push("");
      if (b.ticket_id)       lines.push(`Ticket #${b.ticket_id}:`);
      if (b.scheduled_time)  lines.push(`   Scheduled: ${b.scheduled_time}`);
      if (b.purpose)         lines.push(`   Purpose: ${b.purpose}`);
      if (b.bridge_link)     lines.push(`   Bridge Invite: ${b.bridge_link}`);
      if (b.assigned_to)     lines.push(`   Assigned to: ${b.assigned_to}`);
      if (b.owner_in_threads || b.summary_in_ticket) {
        lines.push(`   Add the next owner to all related email threads and Bridge Invite: ${b.owner_in_threads ? "Yes" : "No"}`);
        lines.push(`   Ticket Summary added to ticket: ${b.summary_in_ticket ? "Yes" : "No"}`);
      }
    }
  }

  // 3. Active Service — only if note is filled
  if (p.activeServiceNote.trim()) {
    lines.push("");
    lines.push("3. Active Service:");
    lines.push(`   ${p.activeServiceNote.trim()}`);
  }

  // 4. Rolling Handoff — only if note is filled
  if (p.rollingHandoffNote.trim()) {
    lines.push("");
    lines.push("4. Rolling Handoff:");
    lines.push(`   ${p.rollingHandoffNote.trim()}`);
  }

  // Weekend / Holiday extras — only if toggle is on AND at least one field is filled
  if (p.isWeekendHoliday) {
    const hasWeekendData = p.newTicketsCount || p.p1p2Count || p.shiftOccupancy || p.idleTimeNote;
    if (hasWeekendData) {
      lines.push("");
      lines.push("─── Weekend / US Holiday ───");
      if (p.newTicketsCount)  lines.push(`New Tickets: ${p.newTicketsCount}`);
      if (p.p1p2Count)        lines.push(`P1 / P2 Tickets: ${p.p1p2Count}`);
      if (p.shiftOccupancy)   lines.push(`Shift Occupancy: ${p.shiftOccupancy}`);
      if (p.idleTimeNote)     lines.push(`Idle Time: ${p.idleTimeNote}`);
    }
  }

  return lines.join("\n");
}

// ─── Ticket card ──────────────────────────────────────────────────────────────

function TicketCard({ ticket, index, agents, onChange, onRemove }: {
  ticket: TicketEntry; index: number;
  agents: { value: string; label: string }[];
  onChange: (t: TicketEntry) => void; onRemove: () => void;
}) {
  function set<K extends keyof TicketEntry>(k: K, v: TicketEntry[K]) { onChange({ ...ticket, [k]: v }); }
  return (
    <Card withBorder radius="md" p="md" style={{ borderColor: "var(--mantine-color-red-8)", borderLeftWidth: 3 }}>
      <Stack gap="sm">
        <Group justify="space-between">
          <Badge color="red" variant="filled" size="sm">🚨 P1/P2 Ticket #{index + 1}</Badge>
          <ActionIcon variant="subtle" color="red" size="sm" onClick={onRemove}><IconTrash size={13} /></ActionIcon>
        </Group>
        <Group grow gap="xs">
          <TextInput label="Ticket # *" placeholder="12345" value={ticket.ticket_id}
            onChange={e => set("ticket_id", e.currentTarget.value)} size="xs" />
          <Select label="Assigned To *" data={agents} value={ticket.assigned_to || null}
            onChange={v => set("assigned_to", v ?? "")} searchable allowDeselect={false} size="xs" />
        </Group>
        <TextInput label="Status *" placeholder="Carrier Investigating"
          value={ticket.status} onChange={e => set("status", e.currentTarget.value)} size="xs" />
        <Textarea label="Next Plan of Action *" placeholder="e.g. Follow up with carrier for dispatch status"
          value={ticket.next_plan} onChange={e => set("next_plan", e.currentTarget.value)}
          size="xs" minRows={2} autosize />
        <TextInput label="Due Date *" placeholder="e.g. 02/18/2026 08:10 AM" value={ticket.due_date}
          onChange={e => set("due_date", e.currentTarget.value)} size="xs" />
        <Group grow gap="xs" mt={4}>
          <Select
            size="xs"
            label="Next owner added to email threads *"
            data={[{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }]}
            value={ticket.owner_in_threads || null}
            onChange={v => set("owner_in_threads", (v ?? "") as TicketEntry["owner_in_threads"])}
            allowDeselect={false}
          />
          <Select
            size="xs"
            label="Ticket summary added to ticket *"
            data={[{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }]}
            value={ticket.summary_in_ticket || null}
            onChange={v => set("summary_in_ticket", (v ?? "") as TicketEntry["summary_in_ticket"])}
            allowDeselect={false}
          />
        </Group>
        {(!ticket.ticket_id.trim() || !ticket.assigned_to.trim() || !ticket.status.trim() || !ticket.next_plan.trim() || !ticket.due_date.trim() || !ticket.owner_in_threads || !ticket.summary_in_ticket) && (
          <Alert color="yellow" variant="light" icon={<IconAlertCircle size={14} />}>
            Ticket #, Assigned To, Status, Next Plan of Action, Due Date, and both pre-checklist items are required for each high-priority ticket.
          </Alert>
        )}
      </Stack>
    </Card>
  );
}

// ─── Bridge card ──────────────────────────────────────────────────────────────

function BridgeCard({ bridge, index, agents, onChange, onRemove }: {
  bridge: BridgeEntry; index: number;
  agents: { value: string; label: string }[];
  onChange: (b: BridgeEntry) => void; onRemove: () => void;
}) {
  function set<K extends keyof BridgeEntry>(k: K, v: BridgeEntry[K]) { onChange({ ...bridge, [k]: v }); }
  return (
    <Card withBorder radius="md" p="md" style={{ borderColor: "var(--mantine-color-blue-8)", borderLeftWidth: 3 }}>
      <Stack gap="sm">
        <Group justify="space-between">
          <Badge color="blue" variant="filled" size="sm">📞 Bridge Call #{index + 1}</Badge>
          <ActionIcon variant="subtle" color="red" size="sm" onClick={onRemove}><IconTrash size={13} /></ActionIcon>
        </Group>
        <Group grow gap="xs">
          <TextInput label="Ticket #" placeholder="12346" value={bridge.ticket_id}
            onChange={e => set("ticket_id", e.currentTarget.value)} size="xs" />
          <TextInput label="Scheduled Time" placeholder="e.g. 10:00 AM PST" value={bridge.scheduled_time}
            onChange={e => set("scheduled_time", e.currentTarget.value)} size="xs" />
        </Group>
        <TextInput label="Purpose" placeholder="e.g. Troubleshooting for packet loss issue"
          value={bridge.purpose} onChange={e => set("purpose", e.currentTarget.value)} size="xs" />
        <Group grow gap="xs">
          <TextInput label="Bridge Invite Link" placeholder="https://..." value={bridge.bridge_link}
            onChange={e => set("bridge_link", e.currentTarget.value)} size="xs" />
          <Select label="Assigned To" data={agents} value={bridge.assigned_to}
            onChange={v => set("assigned_to", v ?? "")} searchable clearable size="xs" />
        </Group>
        <Group gap="xl" mt={4}>
          <Checkbox size="xs" label="Next owner + bridge invite sent"
            checked={bridge.owner_in_threads} onChange={e => set("owner_in_threads", e.currentTarget.checked)} />
          <Checkbox size="xs" label="Ticket summary added to ticket"
            checked={bridge.summary_in_ticket} onChange={e => set("summary_in_ticket", e.currentTarget.checked)} />
        </Group>
      </Stack>
    </Card>
  );
}

// ─── Incoming shift view ──────────────────────────────────────────────────────

// ─── Manager View Panel ───────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  "Carrier Investigating": "orange",
  "Outage Ongoing": "red",
  "Pending Dispatch": "yellow",
  "Pending Callback": "yellow",
  "Escalated": "red",
  "Resolved": "green",
  "Monitoring": "blue",
  "Other": "gray",
};

function parseChecklist(markdown: string) {
  const reviewed = /All tickets reviewed.*?:\s*(✓|✗)/i.exec(markdown)?.[1] === "✓";
  const pending  = /Included all pending.*?:\s*(✓|✗)/i.exec(markdown)?.[1] === "✓";
  return { reviewed, pending };
}

function HandoverDetailCard({ row }: { row: HandoverRow }) {
  const tickets: TicketEntry[] = (() => { try { return JSON.parse((row as any).tickets_json ?? "[]"); } catch { return []; } })();
  const bridges: BridgeEntry[] = (() => { try { return JSON.parse((row as any).bridges_json ?? "[]"); } catch { return []; } })();
  const checklist = parseChecklist((row as any).body_markdown ?? "");
  const isWeekend = (row as any).is_weekend_holiday;
  const isNothing = !tickets.length && !(row as any).active_service_note && !(row as any).rolling_handoff_note && !bridges.length;

  return (
    <Stack gap="sm" mt="sm">
      {isNothing ? (
        <Card withBorder radius="md" p="sm" style={{ background: "var(--mantine-color-teal-9)", borderColor: "var(--mantine-color-teal-7)" }}>
          <Group gap="xs">
            <ThemeIcon size="sm" color="teal" variant="light"><IconCheck size={12} /></ThemeIcon>
            <Text size="sm" fw={600} c="teal.3">Nothing to handoff</Text>
          </Group>
        </Card>
      ) : (
        <>
          {/* P1/P2 Tickets */}
          {tickets.length > 0 && (
            <Stack gap="xs">
              <Text size="xs" fw={700} c="red.4" tt="uppercase" style={{ letterSpacing: "0.05em" }}>
                🚨 P1/P2 Tickets ({tickets.length})
              </Text>
              {tickets.map((t, i) => (
                <Card key={i} withBorder radius="md" p="sm"
                  style={{ borderLeft: "3px solid var(--mantine-color-red-7)" }}>
                  <Stack gap={4}>
                    <Group gap="xs" wrap="wrap">
                      {t.ticket_id && <Badge color="red" variant="filled" size="xs">#{t.ticket_id}</Badge>}
                      {t.status && <Badge color={STATUS_COLORS[t.status] ?? "gray"} variant="light" size="xs">{t.status}</Badge>}
                      {t.assigned_to && <Text size="xs" c="dimmed">→ {t.assigned_to}</Text>}
                    </Group>
                    {t.next_plan      && <Text size="xs"><Text span c="dimmed">Next: </Text>{t.next_plan}</Text>}
                    {t.due_date       && <Text size="xs" c="dimmed">Due: {t.due_date}</Text>}
                    {(t.owner_in_threads || t.summary_in_ticket) && (
                      <Group gap="md" mt={2}>
                        <Text size="xs" c={t.owner_in_threads ? "green.4" : "red.4"}>
                          {t.owner_in_threads ? "✓" : "✗"} Threads updated
                        </Text>
                        <Text size="xs" c={t.summary_in_ticket ? "green.4" : "red.4"}>
                          {t.summary_in_ticket ? "✓" : "✗"} Ticket summary
                        </Text>
                      </Group>
                    )}
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}

          {/* Bridge Calls */}
          {bridges.length > 0 && (
            <Stack gap="xs">
              <Text size="xs" fw={700} c="blue.4" tt="uppercase" style={{ letterSpacing: "0.05em" }}>
                📞 Bridge Calls ({bridges.length})
              </Text>
              {bridges.map((b, i) => (
                <Card key={i} withBorder radius="md" p="sm"
                  style={{ borderLeft: "3px solid var(--mantine-color-blue-7)" }}>
                  <Stack gap={4}>
                    <Group gap="xs" wrap="wrap">
                      {b.ticket_id      && <Badge color="blue" variant="filled" size="xs">#{b.ticket_id}</Badge>}
                      {b.assigned_to    && <Text size="xs" c="dimmed">→ {b.assigned_to}</Text>}
                    </Group>
                    {b.scheduled_time && <Text size="xs"><Text span c="dimmed">Time: </Text>{b.scheduled_time}</Text>}
                    {b.purpose        && <Text size="xs"><Text span c="dimmed">Purpose: </Text>{b.purpose}</Text>}
                    {b.bridge_link    && <Text size="xs"><Text span c="dimmed">Link: </Text><Text span c="blue.4">{b.bridge_link}</Text></Text>}
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}

          {/* Active Service + Rolling Handoff */}
          {((row as any).active_service_note || (row as any).rolling_handoff_note) && (
            <SimpleGrid cols={2} spacing="xs">
              {(row as any).active_service_note && (
                <Card withBorder radius="md" p="sm">
                  <Text size="xs" fw={700} c="cyan.4" mb={4}>Active Service</Text>
                  <Text size="xs" style={{ whiteSpace: "pre-wrap" }}>{(row as any).active_service_note}</Text>
                </Card>
              )}
              {(row as any).rolling_handoff_note && (
                <Card withBorder radius="md" p="sm">
                  <Text size="xs" fw={700} c="indigo.4" mb={4}>Rolling Handoff</Text>
                  <Text size="xs" style={{ whiteSpace: "pre-wrap" }}>{(row as any).rolling_handoff_note}</Text>
                </Card>
              )}
            </SimpleGrid>
          )}
        </>
      )}

      {/* Weekend Metrics — manager-only */}
      {isWeekend && (
        <Card withBorder radius="md" p="sm" style={{ borderColor: "var(--mantine-color-yellow-7)" }}>
          <Text size="xs" fw={700} c="yellow.4" mb={6}>📅 Weekend / US Holiday Metrics</Text>
          <SimpleGrid cols={2} spacing="xs">
            {(row as any).new_tickets_count != null && <Text size="xs"><Text span c="dimmed">New Tickets: </Text>{(row as any).new_tickets_count}</Text>}
            {(row as any).p1_p2_count       != null && <Text size="xs"><Text span c="dimmed">P1/P2: </Text>{(row as any).p1_p2_count}</Text>}
            {(row as any).shift_occupancy         && <Text size="xs"><Text span c="dimmed">Occupancy: </Text>{(row as any).shift_occupancy}</Text>}
            {(row as any).idle_time_note          && <Text size="xs" style={{ gridColumn: "span 2" }}><Text span c="dimmed">Idle Time: </Text>{(row as any).idle_time_note}</Text>}
          </SimpleGrid>
        </Card>
      )}

      {/* Pre-submit Checklist */}
      <Card withBorder radius="md" p="sm" style={{ borderColor: "var(--mantine-color-violet-7)", borderStyle: "dashed" }}>
        <Text size="xs" fw={700} c="violet.4" mb={6}>✅ Pre-submit Checklist</Text>
        <Group gap="lg">
          <Text size="xs" c={checklist.reviewed ? "green.4" : "red.4"}>
            {checklist.reviewed ? "✓" : "✗"} All tickets reviewed and updated
          </Text>
          <Text size="xs" c={checklist.pending ? "green.4" : "red.4"}>
            {checklist.pending ? "✓" : "✗"} All pending items included
          </Text>
        </Group>
      </Card>
    </Stack>
  );
}

function ManagerViewPanel({
  rows, date, agents, expanded, setExpanded, onDateChange, onRefresh,
}: {
  rows: HandoverRow[];
  date: string;
  agents: { value: string; label: string }[];
  expanded: number | null;
  setExpanded: (id: number | null) => void;
  onDateChange: (d: string) => void;
  onRefresh: () => void;
}) {
  const submittedAgents = new Set(rows.filter(r => (r as any).submitted).map(r => r.sender_name).filter(Boolean));
  const anyRowAgents    = new Set(rows.map(r => r.sender_name).filter(Boolean));
  const notSubmitted    = agents.filter(a => !submittedAgents.has(a.value));
  const notStarted      = agents.filter(a => !anyRowAgents.has(a.value));
  const total           = agents.length;
  const done            = submittedAgents.size;
  const pct             = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Stack gap="md" p="md">
      {/* Date picker + refresh */}
      <Group align="flex-end" gap="sm" wrap="wrap">
        <TextInput
          label="Shift Date"
          type="date"
          value={date}
          onChange={e => onDateChange(e.currentTarget.value)}
          size="sm"
          w={170}
        />
        <Button size="xs" variant="subtle" onClick={onRefresh}>↻ Refresh</Button>
      </Group>

      {/* Submission summary bar */}
      <Card withBorder radius="lg" p="md">
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm" fw={700}>Team Submission Status</Text>
            <Text size="sm" fw={700} c={pct === 100 ? "green" : "orange"}>{done}/{total} submitted</Text>
          </Group>
          <Progress value={pct} color={pct === 100 ? "green" : "teal"} size="sm" radius="xl" />
          {notSubmitted.length > 0 && (
            <Stack gap={4} mt={4}>
              {notStarted.length > 0 && (
                <Group gap="xs" wrap="wrap">
                  <Text size="xs" c="dimmed" w={60}>Not started:</Text>
                  {notStarted.map(a => (
                    <Badge key={a.value} color="gray" variant="outline" size="xs">{a.value}</Badge>
                  ))}
                </Group>
              )}
              {agents.filter(a => anyRowAgents.has(a.value) && !submittedAgents.has(a.value)).length > 0 && (
                <Group gap="xs" wrap="wrap">
                  <Text size="xs" c="dimmed" w={60}>In draft:</Text>
                  {agents.filter(a => anyRowAgents.has(a.value) && !submittedAgents.has(a.value)).map(a => (
                    <Badge key={a.value} color="yellow" variant="light" size="xs">{a.value}</Badge>
                  ))}
                </Group>
              )}
            </Stack>
          )}
          {notSubmitted.length === 0 && total > 0 && (
            <Text size="xs" c="green.4">✓ All team members have submitted</Text>
          )}
        </Stack>
      </Card>

      {/* Handover cards */}
      <ScrollArea h="55vh">
        <Stack gap="sm">
          {rows.length === 0 ? (
            <Card withBorder radius="lg" p="xl">
              <Stack align="center" gap="sm">
                <ThemeIcon size={48} radius="xl" color="teal" variant="light">
                  <IconClipboardList size={28} />
                </ThemeIcon>
                <Text fw={600}>No handovers yet</Text>
                <Text size="sm" c="dimmed">No handovers found for {date}.</Text>
              </Stack>
            </Card>
          ) : rows.map(row => (
            <Card key={row.id} withBorder radius="lg" p="md"
              style={(row as any).submitted ? { borderColor: "var(--mantine-color-teal-8)" } : undefined}>
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Stack gap={4} style={{ flex: 1 }}>
                  <Group gap="xs" wrap="wrap">
                    <Badge color={(row as any).submitted ? "green" : "orange"} variant={(row as any).submitted ? "filled" : "light"} size="sm">
                      {(row as any).submitted ? "✓ Submitted" : "Draft"}
                    </Badge>
                    <Badge color="teal" variant="light" size="sm">{row.shift_name}</Badge>
                    <Badge color="gray"  variant="outline" size="xs">{row.shift_date}</Badge>
                    {(row as any).is_weekend_holiday && <Badge color="yellow" variant="light" size="xs">🗓 Weekend/Holiday</Badge>}
                  </Group>
                  <Group gap="xs" align="center">
                    <Text fw={700} size="sm">{row.sender_name}</Text>
                    <Text size="xs" c="dimmed">
                      · {new Date(row.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    </Text>
                  </Group>
                  {/* Quick stats */}
                  <Group gap="sm" mt={2}>
                    {(row as any).ticket_count > 0
                      ? <Badge color="red"  variant="light" size="xs">🚨 {(row as any).ticket_count} P1/P2</Badge>
                      : <Badge color="gray" variant="outline" size="xs">No P1/P2</Badge>}
                    {(() => { try { const b = JSON.parse((row as any).bridges_json ?? "[]"); return b.length > 0 ? <Badge color="blue" variant="light" size="xs">📞 {b.length} bridge</Badge> : null; } catch { return null; } })()}
                    {(row as any).active_service_note  && <Badge color="cyan"   variant="light" size="xs">Active service</Badge>}
                    {(row as any).rolling_handoff_note && <Badge color="indigo" variant="light" size="xs">Rolling handoff</Badge>}
                  </Group>
                </Stack>
                <ActionIcon
                  size="sm" variant="subtle" color="gray"
                  onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                  {expanded === row.id ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                </ActionIcon>
              </Group>
              {expanded === row.id && (
                <HandoverDetailCard row={row} />
              )}
            </Card>
          ))}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

// ─── Main widget ──────────────────────────────────────────────────────────────

export function ShiftChecklistWidget(_props: { onCollapse?: () => void }) {
  const { identity } = useIdentity();
  const myName    = identity?.name ?? "";
  const isManager = identity?.role === "manager";
  const agents    = LOCKED_TEAM_NAMES.map((n: string) => ({ value: n, label: n }));

  // Form state
  const [shiftName,           setShiftName]           = useState(autoDetectShift());
  const [shiftDate,           setShiftDate]           = useState(TODAY);
  const [agentName,           setAgentName]           = useState("");

  const [tickets,             setTickets]             = useState<TicketEntry[]>([newTicket()]);
  const [bridges,             setBridges]             = useState<BridgeEntry[]>([]);
  const [activeServiceNote,   setActiveServiceNote]   = useState("");
  const [rollingHandoffNote,  setRollingHandoffNote]  = useState("");
  const [isWeekendHoliday,    setIsWeekendHoliday]    = useState(isWeekendToday());
  const [newTicketsCount,     setNewTicketsCount]     = useState("");
  const [p1p2Count,           setP1p2Count]           = useState("");
  const [shiftOccupancy,      setShiftOccupancy]      = useState("");
  const [idleTimeNote,        setIdleTimeNote]        = useState("");

  // Manager-only checklist (saved to DB, never posted to Slack)
  const [ticketsReviewed,       setTicketsReviewed]       = useState(false);
  const [pendingItemsIncluded,  setPendingItemsIncluded]  = useState(false);

  // UI state
  const [activeTab,     setActiveTab]     = useState<string | null>("form");
  const [submitting,        setSubmitting]        = useState(false);
  const [error,             setError]             = useState<string | null>(null);
  const [success,           setSuccess]           = useState<string | null>(null);
  const [nothingToHandoff,  setNothingToHandoff]  = useState(false);
  const [submitted,         setSubmitted]         = useState(false);

  // History
  const [history,       setHistory]       = useState<HandoverRow[]>([]);
  const [historyAgent,  setHistoryAgent]  = useState("");
  const [expandedId,    setExpandedId]    = useState<number | null>(null);

  // Manager view
  const [managerRows,       setManagerRows]       = useState<HandoverRow[]>([]);
  const [managerDate,       setManagerDate]       = useState(TODAY);
  const [managerExpanded,   setManagerExpanded]   = useState<number | null>(null);

  // Init agent name from identity
  useEffect(() => {
    if (myName) {
      setAgentName(n => n || myName);
      setHistoryAgent(a => a || myName);
    }
  }, [myName]);

  // Load history when historyAgent changes (no draft auto-load — fresh form every open)
  useEffect(() => { void loadHistory(); }, [historyAgent]);

  async function loadHistory() {
    try {
      const rows = await db.shift_handovers.list({
        filter: historyAgent ? { sender_name: historyAgent } : undefined,
        orderBy: { column: "created_at", ascending: false },
        limit: 30,
      });
      setHistory(Array.isArray(rows) ? rows : []);
    } catch { setHistory([]); }
  }

  async function loadManagerView(date: string) {
    try {
      const rows = await db.shift_handovers.list({
        filter: { shift_date: date },
        orderBy: { column: "created_at", ascending: false },
        limit: 100,
      });
      setManagerRows(Array.isArray(rows) ? rows : []);
    } catch { setManagerRows([]); }
  }

  function bodyParams(): BodyParams {
    return {
      shiftName, shiftDate, agentName,
      tickets, bridges, activeServiceNote, rollingHandoffNote,
      isWeekendHoliday, newTicketsCount, p1p2Count, shiftOccupancy, idleTimeNote,
    };
  }

  async function submitHandover() {
    const incompleteTicket = tickets.find(
      (ticket) => !ticket.owner_in_threads || !ticket.summary_in_ticket,
    );
    if (incompleteTicket) {
      setError(
        `Complete both required pre-checklist fields for every P1/P2 ticket before submitting${incompleteTicket.ticket_id ? ` (ticket #${incompleteTicket.ticket_id})` : ""}.`,
      );
      return;
    }

    setSubmitting(true); setError(null);
    try {
      // Build full payload (includes weekend data + manager checklist for DB/history)
      const checklistLines = [
        `\n─── Pre-submit Checklist (manager view) ───`,
        `All tickets reviewed and updated: ${ticketsReviewed ? "✓ Yes" : "✗ No"}`,
        `Included all pending items in handoff: ${pendingItemsIncluded ? "✓ Yes" : "✗ No"}`,
      ].join("\n");
      const fullBody = generateBody(bodyParams()) + checklistLines;
      const payload = {
        shift_name: shiftName, shift_date: shiftDate, sender_name: agentName,
        next_owner: "", handoff_style: "",
        tickets_json: JSON.stringify(tickets),
        bridges_json: JSON.stringify(bridges),
        active_service_note: activeServiceNote,
        rolling_handoff_note: rollingHandoffNote,
        is_weekend_holiday: isWeekendHoliday,
        new_tickets_count: parseInt(newTicketsCount) || 0,
        p1_p2_count: parseInt(p1p2Count) || 0,
        shift_occupancy: shiftOccupancy,
        idle_time_note: idleTimeNote,
        submitted: true,
        subject: generateSubject(shiftName, shiftDate),
        body_markdown: fullBody,
        raw_notes: "",
        ticket_count: tickets.length,
      };

      // Always insert a new record (no draft re-use — each submit = new history entry)
      await db.shift_handovers.insert(payload);

      // Post to Slack — weekend info excluded (manager-only)
      const username = agentName ? `Shift Handover - ${agentName}` : "Shift Handover";
      const slackText = nothingToHandoff
        ? "Nothing to handoff"
        : generateSlackBody({ ...bodyParams(), isWeekendHoliday: false });
      await postSlackMessage(slackText, { username, icon_emoji: ":clipboard:" });

      setSubmitted(true);
      // Reset checklist for next submission
      setTicketsReviewed(false);
      setPendingItemsIncluded(false);
      setSuccess("✓ Handover submitted and posted to Slack!");
      await loadHistory();
      setTimeout(() => setSuccess(null), 5000);
    } catch (e) { setError(e instanceof Error ? e.message : "Submit failed"); }
    finally { setSubmitting(false); }
  }

  return (
    <WidgetFrame title="Shift Handover Checklist" icon={IconClipboardList} iconColor="teal"
      status={submitted ? { label: "Submitted", color: "green" } : undefined}>
      <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
        <Tabs.List px="md" pt="xs">
          <Tabs.Tab value="form" leftSection={<IconClipboardList size={13} />}>
            Handover Form
            {submitted && <Badge size="xs" color="green" variant="filled" ml={6}>✓</Badge>}
          </Tabs.Tab>
          {isManager && (
            <Tabs.Tab value="manager" leftSection={<IconUsers size={13} />}
              onClick={() => void loadManagerView(managerDate)}>
              Manager View
            </Tabs.Tab>
          )}
          <Tabs.Tab value="history" leftSection={<IconHistory size={13} />}>History</Tabs.Tab>
        </Tabs.List>

        {/* ════════════ FORM TAB ════════════ */}
        <Tabs.Panel value="form">
          <ScrollArea h="62vh" px="md" pt="md" pb="xs">
            <Stack gap="lg">

              {error   && <Alert icon={<IconAlertCircle size={14} />} color="red"   variant="light" withCloseButton onClose={() => setError(null)}>{error}</Alert>}
              {success && <Alert icon={<IconCheck size={14} />}       color="green" variant="light">{success}</Alert>}

              {/* ── Nothing to handoff toggle ── */}
              <Card withBorder radius="lg" p="sm"
                style={nothingToHandoff ? { borderColor: "var(--mantine-color-teal-6)", background: "var(--mantine-color-teal-9)" } : undefined}>
                <Switch
                  label={<Text size="sm" fw={700} c={nothingToHandoff ? "teal.3" : "dimmed"}>Nothing to handoff</Text>}
                  description={nothingToHandoff ? "Slack will post: \"Nothing to handoff\"" : "Toggle if there's nothing to pass to the next shift"}
                  checked={nothingToHandoff}
                  onChange={e => setNothingToHandoff(e.currentTarget.checked)}
                  color="teal"
                  size="md"
                />
              </Card>

              {/* ── Shift Info ── */}
              <Card withBorder radius="lg" p="md">
                <Stack gap="sm">
                  <Text fw={700} size="sm" c="teal.4">Shift Information</Text>
                  <Group grow gap="sm" wrap="wrap">
                    <Select label="Shift Name" data={SHIFT_OPTIONS} value={shiftName}
                      onChange={v => v && setShiftName(v)} size="sm" />
                    <TextInput label="Shift Date" type="date" value={shiftDate}
                      onChange={e => setShiftDate(e.currentTarget.value)} size="sm" />
                  </Group>
                  <Select label="Prepared By" data={agents} value={agentName}
                    onChange={v => v && setAgentName(v)} searchable size="sm" />
                </Stack>
              </Card>

              {/* ── P1/P2 Tickets ── */}
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Group gap="xs">
                    <Text fw={700} size="sm">1. High-Priority Incidents</Text>
                    <Badge color="red" variant="light" size="sm">{tickets.length} ticket{tickets.length !== 1 ? "s" : ""}</Badge>
                  </Group>
                  <Button size="xs" variant="light" color="red" leftSection={<IconPlus size={12} />}
                    onClick={() => setTickets(t => [...t, newTicket()])}>
                    Add Ticket
                  </Button>
                </Group>
                {tickets.length === 0 ? (
                  <Card withBorder radius="md" p="sm" style={{ borderStyle: "dashed" }}>
                    <Text size="xs" c="dimmed" ta="center">No P1/P2 tickets — click "Add Ticket" to add one</Text>
                  </Card>
                ) : tickets.map((t, i) => (
                  <TicketCard key={t._key} ticket={t} index={i} agents={agents}
                    onChange={u => setTickets(prev => prev.map(x => x._key === u._key ? u : x))}
                    onRemove={() => setTickets(prev => prev.filter(x => x._key !== t._key))} />
                ))}
              </Stack>

              {/* ── Bridge Calls ── */}
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Group gap="xs">
                    <Text fw={700} size="sm">2. Upcoming Bridge Calls</Text>
                    <Badge color="blue" variant="light" size="sm">{bridges.length} bridge{bridges.length !== 1 ? "s" : ""}</Badge>
                  </Group>
                  <Button size="xs" variant="light" color="blue" leftSection={<IconPlus size={12} />}
                    onClick={() => setBridges(b => [...b, newBridge()])}>
                    Add Bridge
                  </Button>
                </Group>
                {bridges.length === 0 ? (
                  <Card withBorder radius="md" p="sm" style={{ borderStyle: "dashed" }}>
                    <Text size="xs" c="dimmed" ta="center">No bridge calls — click "Add Bridge" to add one</Text>
                  </Card>
                ) : bridges.map((b, i) => (
                  <BridgeCard key={b._key} bridge={b} index={i} agents={agents}
                    onChange={u => setBridges(prev => prev.map(x => x._key === u._key ? u : x))}
                    onRemove={() => setBridges(prev => prev.filter(x => x._key !== b._key))} />
                ))}
              </Stack>

              {/* ── Active Service ── */}
              <Card withBorder radius="lg" p="md">
                <Stack gap="xs">
                  <Text fw={700} size="sm">3. Active Service</Text>
                  <Text size="xs" c="dimmed">Pending maintenance notification emails that the next shift needs to address.</Text>
                  <Textarea
                    placeholder="e.g. Active Service: There are 3 pending maintenance notification emails. [Reason not completed in this shift]"
                    value={activeServiceNote}
                    onChange={e => setActiveServiceNote(e.currentTarget.value)}
                    minRows={3} autosize />
                </Stack>
              </Card>

              {/* ── Rolling Handoff ── */}
              <Card withBorder radius="lg" p="md">
                <Stack gap="xs">
                  <Text fw={700} size="sm">4. Rolling Handoff</Text>
                  <Text size="xs" c="dimmed">Pending tickets the next shift needs to address immediately.</Text>
                  <Textarea
                    placeholder="e.g. Rolling Handoff: 3 tickets require immediate follow-up."
                    value={rollingHandoffNote}
                    onChange={e => setRollingHandoffNote(e.currentTarget.value)}
                    minRows={3} autosize />
                </Stack>
              </Card>

              {/* ── Weekend / Holiday ── */}
              <Card withBorder radius="lg" p="md"
                style={isWeekendHoliday ? { borderColor: "var(--mantine-color-yellow-7)" } : undefined}>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Stack gap={0}>
                      <Text fw={700} size="sm">Weekend / US Holiday</Text>
                      <Text size="xs" c="dimmed">Include additional metrics for weekend/holiday shifts</Text>
                    </Stack>
                    <Switch checked={isWeekendHoliday} onChange={e => setIsWeekendHoliday(e.currentTarget.checked)} size="sm" />
                  </Group>
                  {isWeekendHoliday && (
                    <>
                      <Divider />
                      <Group grow gap="sm">
                        <TextInput label="New Tickets (count)" type="number" placeholder="0"
                          value={newTicketsCount} onChange={e => setNewTicketsCount(e.currentTarget.value)} size="sm" />
                        <TextInput label="P1 / P2 Tickets (count)" type="number" placeholder="0"
                          value={p1p2Count} onChange={e => setP1p2Count(e.currentTarget.value)} size="sm" />
                      </Group>
                      <TextInput label="Shift Occupancy" placeholder="e.g. 3.5 hours occupied"
                        value={shiftOccupancy} onChange={e => setShiftOccupancy(e.currentTarget.value)} size="sm" />
                      <Textarea label="Idle Time" minRows={2} autosize
                        placeholder="e.g. Reviewed and updated 5 RFO tickets, handled 2 P3 tickets during idle time."
                        value={idleTimeNote} onChange={e => setIdleTimeNote(e.currentTarget.value)} />
                    </>
                  )}
                </Stack>
              </Card>

              {/* ── Manager-only checklist ── */}
              <Card withBorder radius="lg" p="md"
                style={{ borderColor: "var(--mantine-color-violet-7)", borderStyle: "dashed" }}>
                <Stack gap="sm">
                  <Group gap="xs">
                    <Text fw={700} size="sm">✅ Pre-submit Checklist</Text>
                    <Badge color="violet" variant="light" size="xs">Saved for manager · not posted to Slack</Badge>
                  </Group>
                  <Checkbox
                    size="sm"
                    label="All tickets are reviewed and updated"
                    checked={ticketsReviewed}
                    onChange={e => setTicketsReviewed(e.currentTarget.checked)}
                  />
                  <Checkbox
                    size="sm"
                    label="Included all pending items in the handoff"
                    checked={pendingItemsIncluded}
                    onChange={e => setPendingItemsIncluded(e.currentTarget.checked)}
                  />
                </Stack>
              </Card>

            </Stack>
          </ScrollArea>

          {/* ── Action bar ── */}
          <Divider />
          <Group px="md" py="md" justify="flex-end">
            <Button
              size="md"
              color={submitted ? "green" : "teal"}
              leftSection={submitted ? <IconCheck size={16} /> : <IconSend size={16} />}
              onClick={() => void submitHandover()}
              loading={submitting}
              disabled={submitted}
            >
              {submitted ? "✓ Submitted" : "Submit Handover"}
            </Button>
          </Group>
        </Tabs.Panel>

        {/* ════════════ MANAGER VIEW TAB ════════════ */}
        {isManager && (
          <Tabs.Panel value="manager">
            <ManagerViewPanel
              rows={managerRows}
              date={managerDate}
              agents={agents}
              expanded={managerExpanded}
              setExpanded={setManagerExpanded}
              onDateChange={(d) => { setManagerDate(d); void loadManagerView(d); }}
              onRefresh={() => void loadManagerView(managerDate)}
            />
          </Tabs.Panel>
        )}

        {/* ════════════ HISTORY TAB ════════════ */}
        <Tabs.Panel value="history" p="md">
          <Stack gap="md">
            <Group gap="sm" align="flex-end" wrap="wrap">
              {isManager ? (
                <Select label="Agent" data={[{ value: "", label: "All agents" }, ...agents]}
                  value={historyAgent} onChange={v => setHistoryAgent(v ?? "")} size="sm" w={220} />
              ) : (
                <Text size="sm" c="dimmed">Showing your handovers</Text>
              )}
              <Button size="xs" variant="subtle" onClick={() => void loadHistory()}>↻ Refresh</Button>
            </Group>

            {history.length === 0 ? (
              <Card withBorder radius="lg" p="xl">
                <Stack align="center" gap="sm">
                  <ThemeIcon size={48} radius="xl" color="teal" variant="light"><IconHistory size={28} /></ThemeIcon>
                  <Text fw={600}>No handovers yet</Text>
                  <Text size="sm" c="dimmed">Submitted handovers will appear here.</Text>
                </Stack>
              </Card>
            ) : history.map(row => (
              <Card key={row.id} withBorder radius="lg" p="md">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Stack gap={4} style={{ flex: 1 }}>
                    <Group gap="xs" wrap="wrap">
                      <Badge color={(row as any).submitted ? "green" : "orange"} variant="light" size="sm">
                        {(row as any).submitted ? "✓ Submitted" : "Draft"}
                      </Badge>
                      <Badge color="gray" variant="outline" size="xs">{row.shift_name}</Badge>
                      <Text size="xs" c="dimmed">{row.shift_date}</Text>
                      {row.sender_name && <Text size="xs" c="dimmed">· by {row.sender_name}</Text>}
                      {row.next_owner && <Text size="xs" c="dimmed">→ {row.next_owner}</Text>}
                    </Group>
                    {row.subject && <Text size="xs" fw={600} c="dimmed">{row.subject}</Text>}
                  </Stack>
                  <ActionIcon size="sm" variant="subtle" color="gray"
                    onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}>
                    <IconChevronDown size={14}
                      style={{ transform: expandedId === row.id ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }} />
                  </ActionIcon>
                </Group>
                {expandedId === row.id && (
                  <Card withBorder radius="md" p="md" mt="sm" style={{ background: "var(--mantine-color-dark-7)" }}>
                    <Text size="xs" style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", lineHeight: 1.6 }}>
                      {row.body_markdown}
                    </Text>
                  </Card>
                )}
              </Card>
            ))}
          </Stack>
        </Tabs.Panel>
      </Tabs>

    </WidgetFrame>
  );
}

// ─── Tile ─────────────────────────────────────────────────────────────────────

export function ShiftChecklistTile({ onExpand }: { onExpand: () => void }) {
  const { identity } = useIdentity();
  const [status, setStatus] = useState<"submitted" | "draft" | "none">("none");

  useEffect(() => {
    if (!identity?.name) return;
    const today = new Date().toISOString().slice(0, 10);
    db.shift_handovers.list({ filter: { sender_name: identity.name, shift_date: today }, limit: 1 })
      .then(rows => {
        const safe = Array.isArray(rows) ? rows : [];
        if (!safe.length) { setStatus("none"); return; }
        setStatus((safe[0] as any).submitted ? "submitted" : "draft");
      }).catch(() => {});
  }, [identity?.name]);

  return (
    <Card withBorder radius="lg" p="md" style={{ cursor: "pointer", height: "100%" }} onClick={onExpand}>
      <Group gap="sm" align="flex-start">
        <ThemeIcon size={36} radius="md" variant="light" color="teal">
          <IconClipboardList size={20} />
        </ThemeIcon>
        <Stack gap={2} style={{ flex: 1 }}>
          <Text fw={700} size="sm">Shift Handover Checklist</Text>
          <Text size="xs" c="dimmed">P1/P2 tickets · Bridges · Manager view · Slack</Text>
          <Group gap={4} mt={4}>
            {status === "submitted" && <Badge size="xs" color="green" variant="filled">✓ Submitted today</Badge>}
            {status === "draft"     && <Badge size="xs" color="orange" variant="light">Draft in progress</Badge>}
            {status === "none"      && <Badge size="xs" color="gray"   variant="outline">No handover yet</Badge>}
          </Group>
        </Stack>
      </Group>
    </Card>
  );
}
