import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema";
import { LOCKED_TEAM, resolveTeamMember } from "../widgets/PerformanceTracker/team";

const client = new PGlite("idb://app-db");
(window as any).__devs_pglite = client;
export const db = drizzle(client, { schema });
export { schema };

// Safely interpolate a string into a SQL literal. We only use this for trusted
// values (canonical team-member names from a hard-coded constant + canonical
// names we computed via resolveTeamMember). Doubling single quotes is enough.
function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export const dbReady = (async () => {
  // ---------- Break Tracker ----------
  await client.exec(`CREATE TABLE IF NOT EXISTS breaks (id SERIAL PRIMARY KEY, employee_name TEXT NOT NULL, break_type TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT, duration_minutes INTEGER, is_active BOOLEAN NOT NULL, slack_message_ts TEXT, slack_posted BOOLEAN, created_at TIMESTAMP DEFAULT NOW() NOT NULL)`);
  await client.exec(`ALTER TABLE breaks ADD COLUMN IF NOT EXISTS slack_message_ts TEXT`);
  await client.exec(`ALTER TABLE breaks ADD COLUMN IF NOT EXISTS slack_posted BOOLEAN`);

  // ---------- Ticket Summary ----------
  await client.exec(`CREATE TABLE IF NOT EXISTS ticket_summaries (id SERIAL PRIMARY KEY, file_name TEXT NOT NULL, file_size_bytes INTEGER NOT NULL, ticket_number TEXT, ticket_subject TEXT, summary_markdown TEXT NOT NULL, extracted_chars INTEGER, created_at TIMESTAMP DEFAULT NOW() NOT NULL)`);

  // ---------- Escalation Email ----------
  await client.exec(`CREATE TABLE IF NOT EXISTS escalation_drafts (id SERIAL PRIMARY KEY, ticket_number TEXT, customer_name TEXT, service_provider TEXT, recipient TEXT, sender_name TEXT, raw_notes TEXT NOT NULL, subject TEXT, body_markdown TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW() NOT NULL)`);
  await client.exec(`ALTER TABLE escalation_drafts ADD COLUMN IF NOT EXISTS mode TEXT`);
  await client.exec(`ALTER TABLE escalation_drafts ADD COLUMN IF NOT EXISTS to_emails TEXT`);
  await client.exec(`ALTER TABLE escalation_drafts ADD COLUMN IF NOT EXISTS cc_emails TEXT`);
  await client.exec(`ALTER TABLE escalation_drafts ADD COLUMN IF NOT EXISTS carrier_id TEXT`);

  // ---------- Shift Handover ----------
  await client.exec(`CREATE TABLE IF NOT EXISTS shift_handovers (id SERIAL PRIMARY KEY, shift_name TEXT NOT NULL, shift_date TEXT NOT NULL, handoff_style TEXT, next_owner TEXT, sender_name TEXT, owner_in_threads TEXT, summary_in_ticket TEXT, raw_notes TEXT NOT NULL, subject TEXT, body_markdown TEXT NOT NULL, ticket_count INTEGER, created_at TIMESTAMP DEFAULT NOW() NOT NULL)`);
  await client.exec(`ALTER TABLE shift_handovers ADD COLUMN IF NOT EXISTS tickets_json TEXT`);

  // ---------- Email Polisher ----------
  await client.exec(`CREATE TABLE IF NOT EXISTS polished_emails (id SERIAL PRIMARY KEY, audience TEXT NOT NULL, recipient_name TEXT, customer_name TEXT, carrier_name TEXT, ticket_number TEXT, sender_name TEXT, raw_draft TEXT NOT NULL, subject TEXT, body_markdown TEXT NOT NULL, tone TEXT, length TEXT, created_at TIMESTAMP DEFAULT NOW() NOT NULL)`);

  // ---------- Performance Tracker ----------
  // team_members table — canonical 14-member roster
  await client.exec(`CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    tier TEXT NOT NULL,
    team TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);

  // performance_imports — one row per Excel upload session
  await client.exec(`CREATE TABLE IF NOT EXISTS performance_imports (
    id SERIAL PRIMARY KEY,
    file_name TEXT NOT NULL,
    imported_by TEXT,
    source_type TEXT NOT NULL,
    sheet_name TEXT,
    row_count INTEGER NOT NULL,
    matched_count INTEGER NOT NULL,
    skipped_count INTEGER NOT NULL,
    period_label TEXT,
    period_start TEXT,
    period_end TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);

  // performance_metrics — one row per matched, imported Excel row
  await client.exec(`CREATE TABLE IF NOT EXISTS performance_metrics (
    id SERIAL PRIMARY KEY,
    import_id INTEGER NOT NULL,
    member_name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    total_count INTEGER,
    success_count INTEGER,
    duration_minutes REAL,
    score TEXT,
    period_start TEXT,
    period_end TEXT,
    queue TEXT,
    period_month TEXT,
    period_quarter TEXT,
    ack_minutes REAL,
    carrier_ticket_minutes REAL,
    handle_seconds REAL,
    wait_seconds REAL,
    raw_json TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`);
  // Add the queue + period + KPI-specific columns when upgrading from an
  // older sandbox DB. New installs already have them from CREATE TABLE.
  await client.exec(`ALTER TABLE performance_metrics ADD COLUMN IF NOT EXISTS queue TEXT`);
  await client.exec(`ALTER TABLE performance_metrics ADD COLUMN IF NOT EXISTS period_month TEXT`);
  await client.exec(`ALTER TABLE performance_metrics ADD COLUMN IF NOT EXISTS period_quarter TEXT`);
  await client.exec(`ALTER TABLE performance_metrics ADD COLUMN IF NOT EXISTS ack_minutes REAL`);
  await client.exec(`ALTER TABLE performance_metrics ADD COLUMN IF NOT EXISTS carrier_ticket_minutes REAL`);
  await client.exec(`ALTER TABLE performance_metrics ADD COLUMN IF NOT EXISTS handle_seconds REAL`);
  await client.exec(`ALTER TABLE performance_metrics ADD COLUMN IF NOT EXISTS wait_seconds REAL`);
  // Indexes for the common query paths
  await client.exec(`CREATE INDEX IF NOT EXISTS idx_perf_metrics_member ON performance_metrics(member_name)`);
  await client.exec(`CREATE INDEX IF NOT EXISTS idx_perf_metrics_source ON performance_metrics(source_type)`);
  await client.exec(`CREATE INDEX IF NOT EXISTS idx_perf_metrics_import ON performance_metrics(import_id)`);
  await client.exec(`CREATE INDEX IF NOT EXISTS idx_perf_metrics_queue ON performance_metrics(queue)`);
  await client.exec(`CREATE INDEX IF NOT EXISTS idx_perf_metrics_month ON performance_metrics(period_month)`);

  // -------------------------------------------------------------------------
  // One-time startup migration: enforce the locked 14-member team
  // -------------------------------------------------------------------------
  // 1. Sync team_members table to the locked roster:
  //    - DELETE any team_members not on the list (dedupes + removes strays)
  //    - UPSERT each locked member to backfill correct tier + team
  const lockedNames = LOCKED_TEAM.map((m) => lit(m.name)).join(", ");
  await client.exec(
    `DELETE FROM team_members WHERE name NOT IN (${lockedNames})`,
  );
  for (const m of LOCKED_TEAM) {
    await client.exec(`
      INSERT INTO team_members (name, tier, team)
      VALUES (${lit(m.name)}, ${lit(m.tier)}, ${lit(m.team)})
      ON CONFLICT (name) DO UPDATE SET tier = EXCLUDED.tier, team = EXCLUDED.team
    `);
  }

  // 2. Normalize any pre-existing performance_metrics rows. If anyone has
  //    seeded the DB with variant spellings ("Samiti Mahalakshmi" instead of
  //    "Mahalakshmi Samiti", or "akram ahmed " with trailing space), this
  //    rewrites them in place. Rows whose member_name doesn't resolve to a
  //    locked-roster member get DELETED — the locked list is authoritative.
  //
  // Wrapped in try/catch so a single malformed row can't cascade as an
  // unhandled promise rejection at app startup.
  try {
    const allMetrics = await client.query<{ id: number; member_name: string }>(
      `SELECT id, member_name FROM performance_metrics`,
    );
    for (const row of allMetrics.rows ?? []) {
      try {
        const canonical = resolveTeamMember(row.member_name);
        if (!canonical) {
          await client.exec(
            `DELETE FROM performance_metrics WHERE id = ${row.id}`,
          );
        } else if (canonical !== row.member_name) {
          await client.exec(
            `UPDATE performance_metrics SET member_name = ${lit(canonical)} WHERE id = ${row.id}`,
          );
        }
      } catch (rowErr) {
        console.warn(
          "[db migration] failed to normalize performance_metrics row",
          row.id,
          rowErr,
        );
      }
    }
  } catch (err) {
    console.warn(
      "[db migration] failed to normalize performance_metrics member names:",
      err,
    );
  }
})();
