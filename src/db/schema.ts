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
  // Canonical display name. Unique constraint is applied when the schema is pushed to Supabase.
  name: text("name").notNull(),
  tier: text("tier").notNull(),       // tier1 | tier2 | tier3
  team: text("team").notNull(),       // noc | mobility
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const performance_imports = pgTable("performance_imports", {
  id: serial("id").primaryKey(),
  file_name: text("file_name").notNull(),
  imported_by: text("imported_by"),
  source_type: text("source_type"),              // tickets|calls|tasks|queue|audit
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
  source_type: text("source_type"),
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

// =============================================================================
// Manager Updates — news ticker / bulletin board
// =============================================================================

export const manager_updates = pgTable("manager_updates", {
  id: serial("id").primaryKey(),
  author_name: text("author_name").notNull(),
  author_email: text("author_email"),
  content: text("content").notNull(),
  // "info" | "warning" | "urgent" | "success"
  priority: text("priority").notNull(),
  // Optional expiry (ISO date string). Null = never expires.
  expires_at: text("expires_at"),
  pinned: boolean("pinned"),
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

// =============================================================================
// User Roles — manager-controlled role overrides for every team member.
// Overrides the static ROLE_BY_NAME map at sign-in time.
// =============================================================================

export const user_roles = pgTable("user_roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),        // canonical roster name
  email: text("email"),                // appdirect.com email (optional, for SSO lookup)
  role: text("role").notNull(),        // tier1 | tier2 | tier3 | manager
  updated_by: text("updated_by"),      // manager's name who made the change
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// =============================================================================
// User Sessions — tracks every sign-in for the Access Control widget.
// One row per user (upserted on each sign-in — delete+insert pattern).
// =============================================================================

export const user_sessions = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),              // canonical roster name
  email: text("email"),                      // sign-in email
  sign_in_method: text("sign_in_method").notNull(), // "google" | "dev"
  picture: text("picture"),                  // Google profile picture URL
  last_sign_in: timestamp("last_sign_in").defaultNow().notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// =============================================================================
// WFH Requests — work-from-home approval flow
// =============================================================================

export const wfh_requests = pgTable("wfh_requests", {
  id: serial("id").primaryKey(),
  employee_name: text("employee_name").notNull(),
  employee_email: text("employee_email"),
  start_date: text("start_date").notNull(),         // YYYY-MM-DD
  end_date: text("end_date").notNull(),              // YYYY-MM-DD
  reason: text("reason").notNull(),
  status: text("status").notNull(),                 // "pending" | "approved" | "denied"
  submitted_at: text("submitted_at").notNull(),      // ISO timestamp
  reviewed_by: text("reviewed_by"),
  reviewed_at: text("reviewed_at"),                 // ISO timestamp
  decision_note: text("decision_note"),
  slack_message_ts: text("slack_message_ts"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// =============================================================================
// App Events — per-user widget usage tracking for the manager usage dashboard.
// One lightweight row per widget open / tool use. Kept lean intentionally —
// only what's needed to answer "who used what, when".
// =============================================================================

// =============================================================================
// Zoom Queue Snapshots — periodic opt-in/out status per agent per queue
// Saved every ~5 minutes by the ZoomQueue widget for daily availability view
// =============================================================================

export const zoom_queue_snapshots = pgTable("zoom_queue_snapshots", {
  id: serial("id").primaryKey(),
  agent_id: text("agent_id").notNull(),
  agent_name: text("agent_name").notNull(),
  queue_name: text("queue_name").notNull(),
  receive_call: boolean("receive_call").notNull(),
  snapshot_date: text("snapshot_date").notNull(),   // YYYY-MM-DD PST
  snapshot_hour: integer("snapshot_hour").notNull(), // 0-23 PST
  snapshot_time: text("snapshot_time").notNull(),    // ISO timestamp
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// =============================================================================
// Ticket Audits — AI-analyzed ticket quality audits uploaded as MHTML files.
// Each row = one audited ticket. Also writes a row to performance_metrics
// with source_type = "audit" so scores appear in the Performance Tracker.
// =============================================================================

export const ticket_audits = pgTable("ticket_audits", {
  id: serial("id").primaryKey(),
  // Source file
  file_name: text("file_name").notNull(),
  file_size_bytes: integer("file_size_bytes").notNull(),
  // Ticket metadata (extracted by AI)
  ticket_number: text("ticket_number"),
  ticket_subject: text("ticket_subject"),
  // Agent attribution
  agent_name: text("agent_name"),           // canonical team member name
  agent_name_raw: text("agent_name_raw"),   // as found in the ticket
  // Audit result
  overall_score: real("overall_score"),     // 0–100
  grade: text("grade"),                     // "Pass" | "Fail" | "Needs Improvement"
  // Date of the ticket being audited (YYYY-MM-DD)
  ticket_date: text("ticket_date"),
  // Per-criteria scores (JSON: { criterion: score }) — 6 exact criteria
  criteria_json: text("criteria_json"),
  // Feedback fields (extracted by AI)
  what_did_well: text("what_did_well"),
  what_missed: text("what_missed"),
  // AI full analysis markdown
  analysis_markdown: text("analysis_markdown").notNull(),
  // Month this audit belongs to (YYYY-MM) — for Performance Tracker grouping
  audit_month: text("audit_month"),
  // Queue: "noc" | "mobility" — for Performance Tracker split
  queue: text("queue"),
  // Who ran the audit
  audited_by: text("audited_by"),
  // Linked performance_metrics row id
  metrics_id: integer("metrics_id"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const app_events = pgTable("app_events", {
  id: serial("id").primaryKey(),
  user_name: text("user_name").notNull(),        // canonical roster name
  user_role: text("user_role"),                  // tier1 | tier2 | tier3 | manager
  event_type: text("event_type").notNull(),       // "widget_open" | "sign_in" | "page_view"
  widget_id: text("widget_id"),                  // widget id (e.g. "zoom-queue") or null
  widget_title: text("widget_title"),            // human-readable widget name
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// =============================================================================
// Metric Disputes — techs can challenge KPI values affected by outages
// =============================================================================

export const metric_disputes = pgTable("metric_disputes", {
  id: serial("id").primaryKey(),
  metric_id: integer("metric_id").notNull(),           // FK → performance_metrics.id
  ticket_ref: text("ticket_ref"),                      // trouble_id for quick reference
  submitted_by: text("submitted_by").notNull(),        // tech's canonical name
  field_name: text("field_name").notNull(),            // "ack_minutes" | "carrier_ticket_minutes"
  original_value: real("original_value"),              // the current (bad) value
  proposed_value: real("proposed_value"),              // what it should be
  reason: text("reason").notNull(),                    // freeform explanation
  evidence_note: text("evidence_note"),                // Slack thread, notes, etc.
  attachments_json: text("attachments_json"),          // JSON array of {name, type, size, dataUrl}
  status: text("status").notNull(),                    // "pending" | "approved" | "rejected"
  reviewed_by: text("reviewed_by"),                    // manager's name
  review_note: text("review_note"),                    // manager's response
  reviewed_at: text("reviewed_at"),                    // ISO timestamp of review
  created_at: timestamp("created_at").defaultNow().notNull(),
});
