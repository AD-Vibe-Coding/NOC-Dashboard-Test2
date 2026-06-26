import type { RebalanceResult } from "./types";

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

// Slack does not render full Markdown tables — we use a fixed-width
// monospace block instead, which displays correctly in Slack channels.
function fixedWidthTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const headerLine = headers.map((h, i) => pad(h, widths[i])).join("  ");
  const sepLine = widths.map((w) => "-".repeat(w)).join("  ");
  const dataLines = rows.map((r) =>
    r.map((c, i) => pad(c ?? "", widths[i])).join("  "),
  );
  return ["```", headerLine, sepLine, ...dataLines, "```"].join("\n");
}

export function formatForSlack(result: RebalanceResult): string {
  const lines: string[] = [];
  if (result.shiftTransition) {
    lines.push(`*🔄 Shift Handoff — ${result.shiftTransition.label}*`);
    lines.push(`_${result.shiftTransition.context}_`);
    lines.push(`Date: *${result.date}*`);
  } else {
    lines.push(`*🎟️ Ticket Bin Review — ${result.date}*`);
  }
  lines.push(
    `Eligible tickets: *${result.totalTickets}* · Total weight: *${result.totalWeight.toFixed(2)}* · Pool agents: *${result.availableAgents}* · Mean: *${result.meanLoad.toFixed(2)}* · Band: *±${result.band}*`,
  );
  lines.push("");

  // Per-agent load table
  lines.push(result.shiftTransition ? "*Eligible-pool load*" : "*Per-agent load*");
  // "Hot" = stage Pending Carrier Action / Update + priority Critical or High
  // "Hot" = stage Pending Carrier Action / Update + priority Critical or High
  const loadHeaders = ["Agent", "Tier", "Avail", "Tix", "Hot", "PendCust", "DueToday", "Age>10", "Age>30", "Weight", "Δ", "Band"];
  const loadRows = result.agentLoads
    .slice()
    .sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      if (b.ticketCount !== a.ticketCount) return b.ticketCount - a.ticketCount;
      return b.weight - a.weight;
    })
    .map((l) => [
      l.name,
      l.tier ?? "—",
      l.available ? "✓" : "✗",
      l.ticketCount.toString(),
      l.hotTickets > 0 ? `🔥${l.hotTickets}` : "0",
      l.pendingCustomer > 0 ? `👤${l.pendingCustomer}` : "0",
      l.dueToday > 0 ? `📅${l.dueToday}` : "0",
      l.ageOver10 > 0 ? `⏳${l.ageOver10}` : "0",
      l.ageOver30 > 0 ? `🕒${l.ageOver30}` : "0",
      l.weight.toFixed(2),
      l.available ? (l.delta >= 0 ? `+${l.delta.toFixed(2)}` : l.delta.toFixed(2)) : "—",
      l.band === "over" ? "OVER" : l.band === "under" ? "UNDER" : l.band === "ok" ? "ok" : "—",
    ]);
  lines.push(fixedWidthTable(loadHeaders, loadRows));
  lines.push("_🔥 Hot = Pending Carrier + Critical/High · 👤 PendCust = Pending Customer · 📅 DueToday = Pending Carrier due today · ⏳ Age>10 days · 🕒 Age>30 days._");
  lines.push("");

  // Suggested moves
  if (result.movesSuggested.length === 0) {
    lines.push("*✅ No rebalance needed* — all available agents within tolerance band.");
  } else {
    lines.push(`*Suggested moves (${result.movesSuggested.length})*`);
    const moveHeaders = ["Ticket", "From → To", "Service", "Priority", "Stage", "W"];
    const moveRows = result.movesSuggested.map((m) => [
      m.ticket.ticket,
      `${m.from} → ${m.to}`,
      m.ticket.service.length > 24 ? m.ticket.service.slice(0, 21) + "…" : m.ticket.service,
      m.ticket.priorityBand,
      m.ticket.stageNorm === "Unknown" ? m.ticket.stage : m.ticket.stageNorm,
      m.ticket.weight.toFixed(2),
    ]);
    lines.push(fixedWidthTable(moveHeaders, moveRows));
    lines.push("");
    lines.push("_💡 Suggestions only — please review before reassigning in iPath._");
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("*⚠️ Warnings*");
    for (const w of result.warnings) lines.push(`• ${w}`);
  }
  if (result.unassignedOrUnknownOwner.length > 0) {
    lines.push("");
    lines.push(
      `*ℹ️ ${result.unassignedOrUnknownOwner.length} ticket(s)* with unknown/manager/off-roster owner — excluded from balance math.`,
    );
  }

  return lines.join("\n");
}
