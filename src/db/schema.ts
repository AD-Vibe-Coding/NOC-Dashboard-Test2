import { boolean, integer, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";

export const breaks = pgTable("breaks", {
  id: serial("id").primaryKey(),
  employee_name: text("employee_name").notNull(),
  break_type: text("break_type").notNull(),
  start_time: text("start_time").notNull(),
  end_time: text("end_time"),
  duration_minutes: integer("duration_minutes"),
  is_active: boolean("is_active").notNull(),
  slack_message_ts: text("slack_message_ts"),
  slack_posted: boolean("slack_posted"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const ticket_summaries = pgTable("ticket_summaries", {
  id: serial("id").primaryKey(),
  file_name: text("file_name").notNull(),
  file_size_bytes: integer("file_size_bytes").notNull(),
  ticket_number: text("ticket_number"),
  ticket_subject: text("ticket_subject"),
  summary_markdown: text("summary_markdown").notNull(),
  extracted_chars: integer("extracted_chars"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const shift_handovers = pgTable("shift_handovers", {
  id: serial("id").primaryKey(),
  // Structured inputs
  shift_name: text("shift_name").notNull(),
  shift_date: text("shift_date").notNull(),
  handoff_style: text("handoff_style"),
  next_owner: text("next_owner"),
  sender_name: text("sender_name"),
  owner_in_threads: text("owner_in_threads"),
  summary_in_ticket: text("summary_in_ticket"),
  raw_notes: text("raw_notes").notNull(),
  // Per-ticket structured entries (JSON-encoded TicketEntry[])
  tickets_json: text("tickets_json"),
  subject: text("subject"),
  body_markdown: text("body_markdown").notNull(),
  ticket_count: integer("ticket_count"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const polished_emails = pgTable("polished_emails", {
  id: serial("id").primaryKey(),
  // "customer" | "internal" | "carrier"
  audience: text("audience").notNull(),
  // Optional structured context
  recipient_name: text("recipient_name"),
  customer_name: text("customer_name"),
  carrier_name: text("carrier_name"),
  ticket_number: text("ticket_number"),
  sender_name: text("sender_name"),
  // User's raw draft
  raw_draft: text("raw_draft").notNull(),
  // Generated output
  subject: text("subject"),
  body_markdown: text("body_markdown").notNull(),
  // Style controls used at generation time
  tone: text("tone"),     // "neutral" | "apologetic" | "firm" | "reassuring"
  length: text("length"), // "concise" | "standard" | "detailed"
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// =============================================================================
// Performance Tracker widget
//
// Excel imports produce three tables:
//   - team_members        Locked 14-member roster (auto-synced from team.ts)
//   - performance_imports One row per upload session (file + sheet + counts)
//   - performance_metrics One row per imported Excel row, member-tagged + JSON
// =============================================================================

export const team_members = pgTable("team_members", {
  id: serial("id").primaryKey(),
  // Canonical display name. Unique constraint enforced via CREATE TABLE.
  name: text("name").notNull(),
  tier: text("tier").notNull(),       // tier1 | tier2 | tier3
  team: text("team").notNull(),       // noc | mobility
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const performance_imports = pgTable("performance_imports", {
  id: serial("id").primaryKey(),
  file_name: text("file_name").notNull(),
  imported_by: text("imported_by"),
  source_type: text("source_type").notNull(),   // tickets|calls|tasks|queue|audit
  sheet_name: text("sheet_name"),
  row_count: integer("row_count").notNull(),
  matched_count: integer("matched_count").notNull(),
  skipped_count: integer("skipped_count").notNull(),
  period_label: text("period_label"),
  period_start: text("period_start"),
  period_end: text("period_end"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const performance_metrics = pgTable("performance_metrics", {
  id: serial("id").primaryKey(),
  import_id: integer("import_id").notNull(),
  member_name: text("member_name").notNull(), // canonical
  source_type: text("source_type").notNull(),
  // ---- Generic per-row summary (preserved for backward compat + simple sums) ----
  total_count: integer("total_count"),
  success_count: integer("success_count"),
  duration_minutes: real("duration_minutes"),
  score: text("score"),                        // text to preserve "92.5%" etc.
  period_start: text("period_start"),
  period_end: text("period_end"),
  // ---- Queue + period normalization (for NOC vs Mobility split + filters) ----
  // Queue: "noc" | "mobility" — derived from reported_via (tickets) or
  // Operator Name (calls). Null when source column missing/unknown.
  queue: text("queue"),
  // YYYY-MM for chronological sort; from month / Year+Month columns.
  period_month: text("period_month"),
  // YYYY-Qn (e.g. "2025-Q3").
  period_quarter: text("period_quarter"),
  // ---- Source-specific KPI fields (null when not applicable) ----
  // Tickets: time-to-first-touch in minutes (from first_touch).
  ack_minutes: real("ack_minutes"),
  // Tickets: time-to-open-with-carrier in minutes (from time_to_carrier_ticket).
  // Null = blank cell (excluded from the "% under 15 min" calculation).
  carrier_ticket_minutes: real("carrier_ticket_minutes"),
  // Calls: total handle time in seconds (from Duration).
  handle_seconds: real("handle_seconds"),
  // Calls: wait time / speed-of-answer in seconds (from Wait Time).
  wait_seconds: real("wait_seconds"),
  raw_json: text("raw_json").notNull(),        // full row as JSON for drill-down
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const escalation_drafts = pgTable("escalation_drafts", {
  id: serial("id").primaryKey(),
  // Structured inputs (all optional — the AI will infer from notes if missing)
  ticket_number: text("ticket_number"),
  customer_name: text("customer_name"),
  service_provider: text("service_provider"),
  recipient: text("recipient"),
  sender_name: text("sender_name"),
  // Raw pasted notes the user entered
  raw_notes: text("raw_notes").notNull(),
  // Generated output
  subject: text("subject"),
  body_markdown: text("body_markdown").notNull(),
  // Email mode: "internal" (ESC-MGR Alert) | "outbound" (ask carrier for help)
  mode: text("mode"),
  // Comma-separated recipient email lists (outbound mode only)
  to_emails: text("to_emails"),
  cc_emails: text("cc_emails"),
  // Matched carrier ID from the Confluence list (outbound mode)
  carrier_id: text("carrier_id"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});
