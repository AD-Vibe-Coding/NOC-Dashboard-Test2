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

export const break_schedules = pgTable("break_schedules", {
  id: serial("id").primaryKey(),
  employee_name: text("employee_name").notNull(),
  schedule_type: text("schedule_type").notNull(), // "fixed" | "override"
  schedule_date: text("schedule_date"), // YYYY-MM-DD for override rows, null for fixed rows
  start_time: text("start_time").notNull(), // HH:MM
  end_time: text("end_time").notNull(),   // HH:MM
  updated_by: text("updated_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const reminder_events = pgTable("reminder_events", {
  id: serial("id").primaryKey(),
  employee_name: text("employee_name").notNull(),
  reminder_type: text("reminder_type").notNull(),
  dedupe_key: text("dedupe_key").notNull(),
  sent_at: text("sent_at").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const punch_events = pgTable("punch_events", {
  id: serial("id").primaryKey(),
  employee_name: text("employee_name").notNull(),
  action: text("action").notNull(), // punch_in | punch_out
  message: text("message"),
  slack_posted: boolean("slack_posted"),
  slack_channel: text("slack_channel"),
  slack_ts: text("slack_ts"),
  punched_at: text("punched_at").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const one_on_one_notes = pgTable("one_on_one_notes", {
  id: serial("id").primaryKey(),
  manager_name: text("manager_name").notNull(),
  employee_name: text("employee_name").notNull(),
  title: text("title").notNull(),
  meeting_date: text("meeting_date"),
  source_type: text("source_type").notNull(), // gmail_gemini | pasted | manual
  source_message_id: text("source_message_id"),
  source_subject: text("source_subject"),
  source_excerpt: text("source_excerpt"),
  source_body: text("source_body"),
  summary_markdown: text("summary_markdown").notNull(),
  discussion_points_json: text("discussion_points_json"),
  manager_action_items_json: text("manager_action_items_json"),
  employee_action_items_json: text("employee_action_items_json"),
  status: text("status").notNull(), // draft | shared | archived
  notebook_group: text("notebook_group"), // individual | management
  section_name: text("section_name"),
  parent_note_id: integer("parent_note_id"),
  sort_order: integer("sort_order"),
  is_favorite: boolean("is_favorite"),
  is_archived: boolean("is_archived"),
  archived_at: text("archived_at"),
  updated_at: text("updated_at"),
  shared_at: text("shared_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const notebook_section_preferences = pgTable("notebook_section_preferences", {
  id: serial("id").primaryKey(),
  owner_name: text("owner_name").notNull(),
  notebook_group: text("notebook_group").notNull(),
  section_key: text("section_key").notNull(),
  section_label: text("section_label").notNull(),
  is_favorite: boolean("is_favorite").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const personal_action_items = pgTable("personal_action_items", {
  id: serial("id").primaryKey(),
  employee_name: text("employee_name").notNull(),
  owner_name: text("owner_name"),
  note_id: integer("note_id"),
  title: text("title").notNull(),
  details: text("details"),
  status: text("status").notNull(), // open | in_progress | blocked | done
  priority: text("priority"), // low | medium | high | critical
  progress_percent: integer("progress_percent"),
  due_date: text("due_date"),
  section_name: text("section_name"),
  notebook_group: text("notebook_group"),
  created_by: text("created_by").notNull(),
  blocked_by_id: integer("blocked_by_id"), // FK → personal_action_items.id (dependency)
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
  // Header
  shift_name: text("shift_name").notNull(),
  shift_date: text("shift_date").notNull(),
  handoff_style: text("handoff_style"),
  next_owner: text("next_owner"),
  sender_name: text("sender_name"),
  owner_in_threads: text("owner_in_threads"),
  summary_in_ticket: text("summary_in_ticket"),
  raw_notes: text("raw_notes").notNull(),
  // Structured sections (JSON arrays)
  tickets_json: text("tickets_json"),       // TicketEntry[]
  bridges_json: text("bridges_json"),       // BridgeEntry[]
  // Notes sections
  active_service_note: text("active_service_note"),
  rolling_handoff_note: text("rolling_handoff_note"),
  // Weekend / holiday extras
  is_weekend_holiday: boolean("is_weekend_holiday"),
  new_tickets_count: integer("new_tickets_count"),
  p1_p2_count: integer("p1_p2_count"),
  shift_occupancy: text("shift_occupancy"),
  idle_time_note: text("idle_time_note"),
  // Status
  submitted: boolean("submitted"),
  // Generated output
  subject: text("subject"),
  body_markdown: text("body_markdown").notNull(),
  ticket_count: integer("ticket_count"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const work_allotment_jobs = pgTable("work_allotment_jobs", {
  id: serial("id").primaryKey(),
  operational_date: text("operational_date").notNull(), // YYYY-MM-DD run date (S1..S6 batch)
  post_date: text("post_date").notNull(), // YYYY-MM-DD actual calendar post date (S6 rolls to next day)
  shift: text("shift").notNull(),
  primary: text("primary"),
  backup: text("backup"),
  nt_primary: text("nt_primary"),
  message: text("message").notNull(),
  next_primary: text("next_primary"),
  next_post_time: text("next_post_time"),
  continuing_from: text("continuing_from"),
  carry_path_used: text("carry_path_used"),
  carry_path_rule: text("carry_path_rule"),
  available_members_json: text("available_members_json"),
  post_time_label: text("post_time_label").notNull(),
  post_at: text("post_at").notNull(), // ISO timestamp in UTC for cron comparison
  status: text("status").notNull(), // planned | posted
  slack_ts: text("slack_ts"),
  last_error: text("last_error"),
  generated_at: text("generated_at").notNull(),
  posted_at: text("posted_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const work_allotment_asrh_hours = pgTable("work_allotment_asrh_hours", {
  id: serial("id").primaryKey(),
  month_key: text("month_key").notNull(),
  date_key: text("date_key").notNull(),
  member_name: text("member_name").notNull(),
  hours: real("hours").notNull(),
  source: text("source").notNull(), // manual | generated
  notes: text("notes"),
  updated_by: text("updated_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const work_allotment_automation_runs = pgTable("work_allotment_automation_runs", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(), // generate | post-due | run
  ran_at: text("ran_at").notNull(),
  generation_triggered: boolean("generation_triggered"),
  generation_skipped: boolean("generation_skipped"),
  due_count: integer("due_count"),
  posted_count: integer("posted_count"),
  failure_count: integer("failure_count"),
  note: text("note"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const ownership_tasks = pgTable("ownership_tasks", {
  id: serial("id").primaryKey(),
  task_type: text("task_type").notNull(), // work_allotment_off_members
  dedupe_key: text("dedupe_key").notNull(),
  operational_date: text("operational_date").notNull(),
  assignee_name: text("assignee_name").notNull(),
  title: text("title").notNull(),
  details: text("details"),
  source_shift: text("source_shift"),
  off_members_json: text("off_members_json"),
  status: text("status").notNull(), // open | completed
  completed_at: text("completed_at"),
  start_at: text("start_at"),
  next_reminder_at: text("next_reminder_at"),
  last_reminded_at: text("last_reminded_at"),
  reminder_interval_minutes: integer("reminder_interval_minutes"),
  reminder_count: integer("reminder_count"),
  slack_user_id: text("slack_user_id"),
  last_error: text("last_error"),
  created_by: text("created_by").notNull(),
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

export const performance_discussions = pgTable("performance_discussions", {
  id: serial("id").primaryKey(),
  employee_name: text("employee_name").notNull(),
  manager_name: text("manager_name").notNull(),
  cycle_label: text("cycle_label").notNull(),
  period_start: text("period_start").notNull(),
  period_end: text("period_end").notNull(),
  status: text("status").notNull(), // draft | scheduled | completed
  scheduled_date: text("scheduled_date"),
  discussion_date: text("discussion_date"),
  overall_summary: text("overall_summary"),
  strengths: text("strengths"),
  growth_areas: text("growth_areas"),
  manager_notes: text("manager_notes"),
  employee_commitments: text("employee_commitments"),
  metrics_snapshot_json: text("metrics_snapshot_json"),
  updated_at: text("updated_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const performance_discussion_submissions = pgTable("performance_discussion_submissions", {
  id: serial("id").primaryKey(),
  employee_name: text("employee_name").notNull(),
  cycle_label: text("cycle_label").notNull(),
  period_start: text("period_start").notNull(),
  period_end: text("period_end").notNull(),
  submission_status: text("submission_status").notNull(), // draft | submitted
  opening_notes: text("opening_notes"),
  business_impact_notes: text("business_impact_notes"),
  behaviors_notes: text("behaviors_notes"),
  feedback_notes: text("feedback_notes"),
  engagement_notes: text("engagement_notes"),
  development_notes: text("development_notes"),
  second_half_priorities: text("second_half_priorities"),
  closing_summary: text("closing_summary"),
  overall_summary: text("overall_summary"),
  employee_commitments: text("employee_commitments"),
  metrics_snapshot_json: text("metrics_snapshot_json"),
  submitted_at: text("submitted_at"),
  updated_at: text("updated_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

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

export const enhancements = pgTable("enhancements", {
  id: serial("id").primaryKey(),
  legacy_id: text("legacy_id"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  platform: text("platform").notNull(), // ipath | noc_dashboard
  category: text("category").notNull(),
  priority: text("priority").notNull(),
  status: text("status").notNull(), // pending | approved | in_progress | completed | rejected
  submitted_by_name: text("submitted_by_name").notNull(),
  submitted_by_email: text("submitted_by_email"),
  approved_by_name: text("approved_by_name"),
  approved_at: text("approved_at"),
  assignee_name: text("assignee_name"),
  assignee_email: text("assignee_email"),
  manager_notes: text("manager_notes"),
  target_quarter: text("target_quarter"),
  updates_json: text("updates_json"),
  updated_at: text("updated_at"),
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

export const google_account_tokens = pgTable("google_account_tokens", {
  id: serial("id").primaryKey(),
  google_sub: text("google_sub").notNull(),
  email: text("email").notNull(),
  name: text("name"),
  access_token: text("access_token"),
  refresh_token: text("refresh_token"),
  token_type: text("token_type"),
  granted_scopes: text("granted_scopes"),
  expires_at: text("expires_at"),
  updated_at: text("updated_at").notNull(),
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
// Training Updates — agent-submitted training needs + manager-posted upcoming
// training schedule visible to everyone.
// =============================================================================

export const training_requests = pgTable("training_requests", {
  id: serial("id").primaryKey(),
  requester_name: text("requester_name").notNull(),
  requester_email: text("requester_email"),
  training_title: text("training_title").notNull(),
  training_type: text("training_type").notNull(),
  due_date: text("due_date"),              // YYYY-MM-DD
  details: text("details"),
  status: text("status").notNull(),        // "requested" | "submitted"
  manager_note: text("manager_note"),
  reviewed_by: text("reviewed_by"),
  reviewed_at: text("reviewed_at"),        // ISO timestamp
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const upcoming_trainings = pgTable("upcoming_trainings", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  training_date: text("training_date").notNull(),   // YYYY-MM-DD
  audience: text("audience").notNull(),             // "all" | "tier1" | "tier2" | "tier3" | "manager"
  posted_by: text("posted_by").notNull(),
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
  audit_role: text("audit_role"),           // Owner | Contributor | Contributor - AS
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

// =============================================================================
// Kudos Board — peer recognition posts
// =============================================================================
export const kudos = pgTable("kudos", {
  id: serial("id").primaryKey(),
  from_name: text("from_name").notNull(),
  to_name: text("to_name").notNull(),
  message: text("message").notNull(),
  category: text("category").notNull(), // teamwork | problem-solving | customer-service | above-beyond | mentorship
  is_pinned: boolean("is_pinned").notNull().default(false),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// =============================================================================
// Celebrations Tracker — recurring birthdays and anniversaries
// =============================================================================
export const celebrations = pgTable("celebrations", {
  id: serial("id").primaryKey(),
  person_name: text("person_name").notNull(),
  event_type: text("event_type").notNull(), // birthday | work_anniversary | marriage_anniversary
  event_month: integer("event_month").notNull(), // 1-12
  event_day: integer("event_day").notNull(), // 1-31
  event_year: integer("event_year"),
  notes: text("notes"),
  created_by: text("created_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// =============================================================================
// Shift Handover Checklist — structured end-of-shift items per agent
// =============================================================================
export const shift_checklist_items = pgTable("shift_checklist_items", {
  id: serial("id").primaryKey(),
  agent_name: text("agent_name").notNull(),
  shift_date: text("shift_date").notNull(),     // YYYY-MM-DD
  category: text("category").notNull(),          // tickets | escalations | outages | notes
  item_text: text("item_text").notNull(),
  is_done: boolean("is_done").notNull().default(false),
  sort_order: integer("sort_order").notNull().default(0),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// =============================================================================
// Knowledge Base Gaps — questions flagged as missing from the KB
// =============================================================================
export const kb_gaps = pgTable("kb_gaps", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  reported_by: text("reported_by").notNull(),
  ai_response: text("ai_response"),              // what the AI answered (may be incomplete)
  status: text("status").notNull(),              // open | in_review | resolved
  resolved_by: text("resolved_by"),
  resolution_note: text("resolution_note"),      // e.g. "Added to Confluence page XYZ"
  confluence_url: text("confluence_url"),         // link to the new/updated page
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// =============================================================================
// Training completions — agent-level status per upcoming_training row
// =============================================================================
export const training_completions = pgTable("training_completions", {
  id: serial("id").primaryKey(),
  training_id: integer("training_id").notNull(), // FK → upcoming_trainings.id
  agent_name: text("agent_name").notNull(),
  status: text("status").notNull(),              // not_started | in_progress | completed
  progress_percent: integer("progress_percent").notNull().default(0), // 0..100
  target_date: text("target_date"),              // YYYY-MM-DD target date set by agent
  completed_at: text("completed_at"),            // ISO timestamp
  approval_status: text("approval_status").notNull().default("not_required"), // not_required | pending | approved | rejected
  approval_note: text("approval_note"),
  approved_by: text("approved_by"),
  approved_at: text("approved_at"),
  evidence_link: text("evidence_link"),
  evidence_file_url: text("evidence_file_url"),
  updated_at: text("updated_at"),                // ISO timestamp (last update)
  note: text("note"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const training_certifications = pgTable("training_certifications", {
  id: serial("id").primaryKey(),
  certification: text("certification").notNull(),
  badge: text("badge").notNull(),
  holder_name: text("holder_name").notNull(),
  issuer: text("issuer"),
  cert_id: text("cert_id"),
  issue_date: text("issue_date"),
  expires_on: text("expires_on"),
  proof_link: text("proof_link"),
  proof_file_url: text("proof_file_url"),
  status: text("status").notNull().default("active"), // active | expired | renewed
  renewed_from_id: integer("renewed_from_id"),
  created_by: text("created_by").notNull(),
  updated_at: text("updated_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const training_comments = pgTable("training_comments", {
  id: serial("id").primaryKey(),
  training_id: integer("training_id").notNull(),
  author_name: text("author_name").notNull(),
  author_role: text("author_role").notNull(),
  message: text("message").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

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

// =============================================================================
// Reminder Queue widget — server-side meeting reminders (Vercel Cron + Supabase)
//
//   - calendar_meetings      Synced Google Calendar meetings to remind on
//   - meeting_reminder_jobs  One row per (meeting, offset) reminder to deliver
//   - notification_targets   Where to deliver (Slack DM / channel) per person
//   - reminder_policies      Per-person reminder offsets + toggles
// =============================================================================

export const calendar_meetings = pgTable("calendar_meetings", {
  id: serial("id").primaryKey(),
  employee_name: text("employee_name").notNull(),
  employee_email: text("employee_email"),
  calendar_event_id: text("calendar_event_id").notNull(),
  title: text("title"),
  description: text("description"),
  location: text("location"),
  start_at: text("start_at").notNull(),   // ISO timestamp
  end_at: text("end_at"),                 // ISO timestamp
  join_link: text("join_link"),
  provider: text("provider"),             // "Google Meet" | "Zoom" | "Teams" | ...
  status: text("status"),                 // "confirmed" | "cancelled" | ...
  raw_json: text("raw_json"),             // full event payload
  synced_at: text("synced_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const meeting_reminder_jobs = pgTable("meeting_reminder_jobs", {
  id: serial("id").primaryKey(),
  employee_name: text("employee_name").notNull(),
  employee_email: text("employee_email"),
  calendar_event_id: text("calendar_event_id").notNull(),
  meeting_start_at: text("meeting_start_at").notNull(),  // ISO timestamp
  reminder_offset_minutes: integer("reminder_offset_minutes").notNull(),
  scheduled_for: text("scheduled_for").notNull(),        // ISO timestamp the reminder fires
  dedupe_key: text("dedupe_key").notNull(),
  join_link: text("join_link"),
  payload_json: text("payload_json"),                    // { title, timeLabel, ... }
  status: text("status").notNull(),                      // pending|sending|sent|failed|dead_letter|cancelled
  attempt_count: integer("attempt_count"),
  last_error: text("last_error"),
  sent_at: text("sent_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const notification_targets = pgTable("notification_targets", {
  id: serial("id").primaryKey(),
  employee_name: text("employee_name").notNull(),
  employee_email: text("employee_email"),
  channel_type: text("channel_type").notNull(),   // "slack_dm" | "slack_channel"
  slack_user_id: text("slack_user_id"),
  slack_channel_id: text("slack_channel_id"),
  enabled: boolean("enabled"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const reminder_policies = pgTable("reminder_policies", {
  id: serial("id").primaryKey(),
  employee_name: text("employee_name").notNull(),
  employee_email: text("employee_email"),
  timezone: text("timezone"),
  meeting_enabled: boolean("meeting_enabled"),
  offset_30_enabled: boolean("offset_30_enabled"),
  offset_15_enabled: boolean("offset_15_enabled"),
  offset_5_enabled: boolean("offset_5_enabled"),
  only_with_join_link: boolean("only_with_join_link"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// =============================================================================
// NOC MTTR Reports — saved workbook imports + selected column mappings
// =============================================================================

export const noc_mttr_reports = pgTable("noc_mttr_reports", {
  id: serial("id").primaryKey(),
  file_name: text("file_name").notNull(),
  file_size_bytes: integer("file_size_bytes"),
  uploaded_by: text("uploaded_by"),
  selected_sheet_name: text("selected_sheet_name"),
  selected_customer_column: text("selected_customer_column"),
  selected_month_column: text("selected_month_column"),
  selected_mttr_column: text("selected_mttr_column"),
  parsed_json: text("parsed_json").notNull(),
  row_count: integer("row_count").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// =============================================================================
// Manager Feedback — manager-view store for peer feedback tied to ticket work
// =============================================================================

export const manager_feedback = pgTable("manager_feedback", {
  id: serial("id").primaryKey(),
  feedback_from: text("feedback_from").notNull(),
  feedback_for: text("feedback_for").notNull(),
  ticket_number: text("ticket_number"),
  screenshot_name: text("screenshot_name"),
  screenshot_type: text("screenshot_type"),
  screenshot_data_url: text("screenshot_data_url"),
  comment: text("comment").notNull(),
  recipient_comment: text("recipient_comment"),
  recipient_comment_by: text("recipient_comment_by"),
  recipient_comment_at: text("recipient_comment_at"),
  recipient_acknowledged_at: text("recipient_acknowledged_at"),
  recipient_acknowledged_by: text("recipient_acknowledged_by"),
  submitted_by: text("submitted_by").notNull(),
  approval_status: text("approval_status").notNull().default("pending"), // pending | approved
  approved_by: text("approved_by"),
  approved_at: text("approved_at"),
  recipient_read_at: text("recipient_read_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const finance_cases = pgTable("finance_cases", {
  id: serial("id").primaryKey(),
  month_key: text("month_key").notNull(),
  service: text("service").notNull().default("mobility"),
  case_number: text("case_number").notNull(),
  comment: text("comment").notNull(),
  created_by: text("created_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});
