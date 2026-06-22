import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { requireManager } from "./_lib/auth-middleware.js";

function toDateKey(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

function formatRangeLabel(dateFrom: string, dateTo: string) {
  return `${dateFrom} → ${dateTo}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!requireManager(req, res)) return;
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const dateTo = String(req.query.date_to ?? new Date().toISOString().slice(0, 10));
    const dateFrom = String(
      req.query.date_from ?? new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    );

    const fromIso = `${dateFrom}T00:00:00.000Z`;
    const toIso = `${dateTo}T23:59:59.999Z`;

    const [{ data: punches, error: punchErr }, { data: reminders, error: reminderErr }] = await Promise.all([
      supabaseAdmin
        .from("punch_events")
        .select("id,employee_name,action,punched_at,message")
        .gte("punched_at", fromIso)
        .lte("punched_at", toIso)
        .order("punched_at", { ascending: true }),
      supabaseAdmin
        .from("reminder_events")
        .select("id,employee_name,reminder_type,sent_at")
        .gte("sent_at", fromIso)
        .lte("sent_at", toIso)
        .order("sent_at", { ascending: true }),
    ]);

    if (punchErr) return res.status(500).json({ error: punchErr.message });
    if (reminderErr) return res.status(500).json({ error: reminderErr.message });

    const people = new Map<string, {
      employee_name: string;
      first_punch_in: string | null;
      last_punch_out: string | null;
      total_punch_ins: number;
      total_punch_outs: number;
      queue_reminders: number;
      break_reminders: number;
      daily: Record<string, { punch_in: string | null; punch_out: string | null; queue_reminders: number; break_reminders: number }>;
    }>();

    for (const row of punches ?? []) {
      const name = String(row.employee_name ?? "Unknown");
      if (!people.has(name)) {
        people.set(name, {
          employee_name: name,
          first_punch_in: null,
          last_punch_out: null,
          total_punch_ins: 0,
          total_punch_outs: 0,
          queue_reminders: 0,
          break_reminders: 0,
          daily: {},
        });
      }
      const person = people.get(name)!;
      const dateKey = toDateKey(String(row.punched_at));
      person.daily[dateKey] ??= { punch_in: null, punch_out: null, queue_reminders: 0, break_reminders: 0 };

      if (row.action === "punch_in") {
        person.total_punch_ins += 1;
        person.first_punch_in = person.first_punch_in ?? String(row.punched_at);
        person.daily[dateKey].punch_in = person.daily[dateKey].punch_in ?? String(row.punched_at);
      }
      if (row.action === "punch_out") {
        person.total_punch_outs += 1;
        person.last_punch_out = String(row.punched_at);
        person.daily[dateKey].punch_out = String(row.punched_at);
      }
    }

    for (const row of reminders ?? []) {
      const name = String(row.employee_name ?? "Unknown");
      if (!people.has(name)) {
        people.set(name, {
          employee_name: name,
          first_punch_in: null,
          last_punch_out: null,
          total_punch_ins: 0,
          total_punch_outs: 0,
          queue_reminders: 0,
          break_reminders: 0,
          daily: {},
        });
      }
      const person = people.get(name)!;
      const dateKey = toDateKey(String(row.sent_at));
      person.daily[dateKey] ??= { punch_in: null, punch_out: null, queue_reminders: 0, break_reminders: 0 };
      const type = String(row.reminder_type ?? "").toLowerCase();
      if (type.includes("queue")) {
        person.queue_reminders += 1;
        person.daily[dateKey].queue_reminders += 1;
      } else {
        person.break_reminders += 1;
        person.daily[dateKey].break_reminders += 1;
      }
    }

    const members = Array.from(people.values())
      .map((p) => ({
        ...p,
        days_present: Object.values(p.daily).filter((d) => d.punch_in || d.punch_out).length,
      }))
      .sort((a, b) => a.employee_name.localeCompare(b.employee_name));

    const summary = {
      total_people: members.length,
      total_punch_ins: members.reduce((s, m) => s + m.total_punch_ins, 0),
      total_punch_outs: members.reduce((s, m) => s + m.total_punch_outs, 0),
      total_queue_reminders: members.reduce((s, m) => s + m.queue_reminders, 0),
      total_break_reminders: members.reduce((s, m) => s + m.break_reminders, 0),
      range_label: formatRangeLabel(dateFrom, dateTo),
    };

    return res.status(200).json({ summary, members, date_from: dateFrom, date_to: dateTo });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
}
