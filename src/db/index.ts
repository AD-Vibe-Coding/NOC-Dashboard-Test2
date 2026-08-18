// Database client — Supabase-backed, server-mediated.
//
// The frontend never talks to Supabase directly. Every call here goes
// through a same-origin /api/<table> route (see api/_lib/crud.js + the
// per-table route files), which uses the service-role admin client on
// the server.
//
// This module exposes:
//   - `schema`   — the Drizzle table definitions (kept so that widgets
//                  can still derive row types via `typeof schema.X.$inferSelect`)
//   - `db`       — a per-table client with list / insert / update / delete
//                  methods that delegate to the API routes
//   - `dbReady`  — backward-compat: legacy widgets awaited this before the
//                  first query. With Supabase there's no IndexedDB bootstrap,
//                  so it resolves immediately.
import * as schemaModule from "./schema";
import { api } from "../lib/api";

export const schema = schemaModule;

// Legacy widgets call `await dbReady;` at startup. Resolve immediately —
// Supabase tables are provisioned via the "Push to Supabase" button.
export const dbReady: Promise<void> = Promise.resolve();

// ---------------------------------------------------------------------------
// Per-table client
// ---------------------------------------------------------------------------

type Primitive = string | number | boolean | null;
type Filter = Record<string, Primitive>;

export interface ListOptions {
  filter?: Filter;
  orderBy?: { column: string; ascending?: boolean };
  limit?: number;
}

function buildQuery(opts?: ListOptions): string {
  if (!opts) return "";
  const params = new URLSearchParams();
  if (opts.filter) {
    for (const [k, v] of Object.entries(opts.filter)) {
      params.set(`filter.${k}`, v === null ? "null" : String(v));
    }
  }
  if (opts.orderBy) {
    params.set("orderBy", opts.orderBy.column);
    params.set("orderDir", opts.orderBy.ascending === false ? "desc" : "asc");
  }
  if (opts.limit != null) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function filterQuery(filter?: Filter, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  if (filter) {
    for (const [k, v] of Object.entries(filter)) {
      params.set(`filter.${k}`, v === null ? "null" : String(v));
    }
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

interface TableClient<T> {
  list(opts?: ListOptions): Promise<T[]>;
  insert(values: Partial<T> | Partial<T>[]): Promise<T[]>;
  /** Bulk insert without returning rows (much faster for large batches). */
  insertBulk(values: Partial<T>[]): Promise<{ count: number }>;
  updateById(id: number, patch: Partial<T>): Promise<T>;
  deleteById(id: number): Promise<void>;
  deleteWhere(filter: Filter): Promise<void>;
  deleteAll(): Promise<void>;
}

function tableClient<T>(name: string): TableClient<T> {
  return {
    list: (opts) => api.get<T[]>(`/api/${name}${buildQuery(opts)}`),
    insert: (values) =>
      api.post<T[]>(`/api/${name}`, {
        values: Array.isArray(values) ? values : [values],
      }),
    insertBulk: (values) =>
      api.post<{ count: number }>(`/api/${name}?minimal=true`, { values }),
    updateById: (id, patch) => api.patch<T>(`/api/${name}/${id}`, patch),
    deleteById: (id) =>
      api.delete<{ ok: true }>(`/api/${name}/${id}`).then(() => undefined),
    deleteWhere: (filter) =>
      api
        .delete<{ ok: true }>(`/api/${name}${filterQuery(filter)}`)
        .then(() => undefined),
    deleteAll: () =>
      api
        .delete<{ ok: true }>(`/api/${name}?all=true`)
        .then(() => undefined),
  };
}

// Row-type aliases — derived from the Drizzle schema so widgets keep
// type safety without importing drizzle-orm directly.
type BreakRow = typeof schema.breaks.$inferSelect;
type BreakScheduleRow = typeof schema.break_schedules.$inferSelect;
type ReminderEventRow = typeof schema.reminder_events.$inferSelect;
type PunchEventRow = typeof schema.punch_events.$inferSelect;
type OneOnOneNoteRow = typeof schema.one_on_one_notes.$inferSelect;
type NotebookSectionPreferenceRow = typeof schema.notebook_section_preferences.$inferSelect;
type PersonalActionItemRow = typeof schema.personal_action_items.$inferSelect;
type TicketSummaryRow = typeof schema.ticket_summaries.$inferSelect;
type EscalationDraftRow = typeof schema.escalation_drafts.$inferSelect;
type ShiftHandoverRow = typeof schema.shift_handovers.$inferSelect;
type PolishedEmailRow = typeof schema.polished_emails.$inferSelect;
type PerformanceImportRow = typeof schema.performance_imports.$inferSelect;
type PerformanceMetricRow = typeof schema.performance_metrics.$inferSelect;
type TeamMemberRow = typeof schema.team_members.$inferSelect;
type ManagerUpdateRow = typeof schema.manager_updates.$inferSelect;
type PerformanceDiscussionRow = typeof schema.performance_discussions.$inferSelect;
type PerformanceDiscussionSubmissionRow = typeof schema.performance_discussion_submissions.$inferSelect;
type EnhancementRow = typeof schema.enhancements.$inferSelect;
type KudosRow = typeof schema.kudos.$inferSelect;
type CelebrationRow = typeof schema.celebrations.$inferSelect;
type ShiftChecklistItemRow = typeof schema.shift_checklist_items.$inferSelect;
type KbGapRow = typeof schema.kb_gaps.$inferSelect;
type TrainingCompletionRow = typeof schema.training_completions.$inferSelect;
type UpcomingTrainingRow = typeof schema.upcoming_trainings.$inferSelect;
type TrainingRequestRow = typeof schema.training_requests.$inferSelect;
type WfhRequestRow = typeof schema.wfh_requests.$inferSelect;
type UserRoleRow = typeof schema.user_roles.$inferSelect;
type UserSessionRow = typeof schema.user_sessions.$inferSelect;
type TicketAuditRow = typeof schema.ticket_audits.$inferSelect;
type MetricDisputeRow = typeof schema.metric_disputes.$inferSelect;
type AppEventRow = typeof schema.app_events.$inferSelect;
type ZoomQueueSnapshotRow = typeof schema.zoom_queue_snapshots.$inferSelect;
type CalendarMeetingRow = typeof schema.calendar_meetings.$inferSelect;
type MeetingReminderJobRow = typeof schema.meeting_reminder_jobs.$inferSelect;
type NotificationTargetRow = typeof schema.notification_targets.$inferSelect;
type ReminderPolicyRow = typeof schema.reminder_policies.$inferSelect;
type NocMttrReportRow = typeof schema.noc_mttr_reports.$inferSelect;
type ManagerFeedbackRow = typeof schema.manager_feedback.$inferSelect;

export const db = {
  breaks: tableClient<BreakRow>("breaks"),
  break_schedules: tableClient<BreakScheduleRow>("break_schedules"),
  reminder_events: tableClient<ReminderEventRow>("reminder_events"),
  punch_events: tableClient<PunchEventRow>("punch_events"),
  one_on_one_notes: tableClient<OneOnOneNoteRow>("one_on_one_notes"),
  notebook_section_preferences: tableClient<NotebookSectionPreferenceRow>("notebook_section_preferences"),
  personal_action_items: tableClient<PersonalActionItemRow>("personal_action_items"),
  ticket_summaries: tableClient<TicketSummaryRow>("ticket_summaries"),
  escalation_drafts: tableClient<EscalationDraftRow>("escalation_drafts"),
  shift_handovers: tableClient<ShiftHandoverRow>("shift_handovers"),
  polished_emails: tableClient<PolishedEmailRow>("polished_emails"),
  performance_imports: tableClient<PerformanceImportRow>("performance_imports"),
  performance_metrics: tableClient<PerformanceMetricRow>("performance_metrics"),
  team_members: tableClient<TeamMemberRow>("team_members"),
  manager_updates: tableClient<ManagerUpdateRow>("manager_updates"),
  performance_discussions: tableClient<PerformanceDiscussionRow>("performance_discussions"),
  performance_discussion_submissions: tableClient<PerformanceDiscussionSubmissionRow>("performance_discussion_submissions"),
  enhancements: tableClient<EnhancementRow>("enhancements"),
  kudos: tableClient<KudosRow>("kudos"),
  celebrations: tableClient<CelebrationRow>("celebrations"),
  shift_checklist_items: tableClient<ShiftChecklistItemRow>("shift_checklist_items"),
  kb_gaps: tableClient<KbGapRow>("kb_gaps"),
  training_completions: tableClient<TrainingCompletionRow>("training_completions"),
  upcoming_trainings: tableClient<UpcomingTrainingRow>("upcoming_trainings"),
  training_requests: tableClient<TrainingRequestRow>("training_requests"),
  wfh_requests: tableClient<WfhRequestRow>("wfh_requests"),
  user_roles: tableClient<UserRoleRow>("user_roles"),
  user_sessions: tableClient<UserSessionRow>("user_sessions"),
  ticket_audits: tableClient<TicketAuditRow>("ticket_audits"),
  metric_disputes: tableClient<MetricDisputeRow>("metric_disputes"),
  app_events: tableClient<AppEventRow>("app_events"),
  zoom_queue_snapshots: tableClient<ZoomQueueSnapshotRow>("zoom_queue_snapshots"),
  calendar_meetings: tableClient<CalendarMeetingRow>("calendar_meetings"),
  meeting_reminder_jobs: tableClient<MeetingReminderJobRow>("meeting_reminder_jobs"),
  notification_targets: tableClient<NotificationTargetRow>("notification_targets"),
  reminder_policies: tableClient<ReminderPolicyRow>("reminder_policies"),
  noc_mttr_reports: tableClient<NocMttrReportRow>("noc_mttr_reports"),
  manager_feedback: tableClient<ManagerFeedbackRow>("manager_feedback"),
};
