// Shared CRUD handler used by every api/<table>.ts and api/<table>/[id].ts.
// Each route file is a one-liner that delegates here with its table name.
//
// Contract (matches the client-side `db.<table>` shim in src/db/index.ts):
//
//   GET    /api/<table>                 -- list, with ?filter.col=val, ?orderBy, ?orderDir, ?limit
//   POST   /api/<table>                 -- insert; body = { values: row | row[] }, returns inserted rows
//   DELETE /api/<table>?filter.col=val  -- bulk delete by filter (or ?all=true to wipe)
//   GET    /api/<table>/<id>            -- read one
//   PATCH  /api/<table>/<id>            -- update (body = column patch)
//   DELETE /api/<table>/<id>            -- delete one
//
// All access is via the service-role client. The frontend never reaches
// Supabase directly; it talks to these routes through src/lib/api.ts.

import { supabaseAdmin } from "./supabase-admin.js";

// Allow-list of tables the routes are allowed to touch. Anything not on
// this list returns 404 even if a route file exists — defensive guard
// against a typo causing a wide-open table query.
const ALLOWED_TABLES = new Set([
  "breaks",
  "ticket_summaries",
  "escalation_drafts",
  "shift_handovers",
  "polished_emails",
  "performance_imports",
  "performance_metrics",
  "team_members",
]);

// Strip auto-managed columns from POST/PATCH payloads so callers can't
// override id / created_at by accident.
function stripAuto(row) {
  if (row == null || typeof row !== "object") return row;
  const { id: _i, created_at: _c, ...rest } = row;
  return rest;
}

// Coerce a query-string filter value (always a string) into the right
// JS type before sending it to Supabase. Without this, eq("is_active", "true")
// returns nothing because PostgREST treats the value as a string literal.
function coerceFilterValue(raw) {
  if (Array.isArray(raw)) raw = raw[0];
  if (raw === "null") return { kind: "null" };
  if (raw === "true") return { kind: "value", value: true };
  if (raw === "false") return { kind: "value", value: false };
  // Plain integer (no decimal, no leading zero on multi-digit)
  if (/^-?\d+$/.test(raw)) return { kind: "value", value: Number(raw) };
  // Float
  if (/^-?\d+\.\d+$/.test(raw)) return { kind: "value", value: Number(raw) };
  return { kind: "value", value: raw };
}

function applyFilters(query, reqQuery) {
  let hasFilter = false;
  for (const [key, rawValue] of Object.entries(reqQuery)) {
    if (typeof key !== "string" || !key.startsWith("filter.")) continue;
    const column = key.slice("filter.".length);
    const coerced = coerceFilterValue(rawValue);
    hasFilter = true;
    if (coerced.kind === "null") {
      query = query.is(column, null);
    } else {
      query = query.eq(column, coerced.value);
    }
  }
  return { query, hasFilter };
}

export async function handleCollection(table, req, res) {
  if (!ALLOWED_TABLES.has(table)) {
    return res.status(404).json({ error: `Unknown table: ${table}` });
  }
  try {
    if (req.method === "GET") {
      let q = supabaseAdmin.from(table).select("*");
      ({ query: q } = applyFilters(q, req.query));
      const orderBy = req.query.orderBy;
      if (orderBy && typeof orderBy === "string") {
        const dir = req.query.orderDir;
        q = q.order(orderBy, { ascending: dir !== "desc" });
      }
      const limit = req.query.limit;
      if (limit && typeof limit === "string" && /^\d+$/.test(limit)) {
        q = q.limit(Number(limit));
      }
      const { data, error } = await q;
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data ?? []);
    }

    if (req.method === "POST") {
      const body = req.body ?? {};
      const raw = body.values !== undefined ? body.values : body;
      if (raw == null) {
        return res.status(400).json({ error: "Missing values in request body" });
      }
      const rows = (Array.isArray(raw) ? raw : [raw]).map(stripAuto);
      if (rows.length === 0) {
        return res.status(400).json({ error: "Empty values array" });
      }
      const { data, error } = await supabaseAdmin
        .from(table)
        .insert(rows)
        .select();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json(data ?? []);
    }

    if (req.method === "DELETE") {
      let q = supabaseAdmin.from(table).delete();
      const { query: filtered, hasFilter } = applyFilters(q, req.query);
      q = filtered;
      if (!hasFilter) {
        if (req.query.all !== "true") {
          return res.status(400).json({
            error:
              "Refusing bulk delete without filter. Pass ?all=true to wipe the table.",
          });
        }
        // PostgREST requires every DELETE to have a filter. Use a clause
        // that matches every row (id is a serial PK starting at 1).
        q = q.gte("id", 0);
      }
      const { error } = await q;
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Server error",
    });
  }
}

export async function handleItem(table, idRaw, req, res) {
  if (!ALLOWED_TABLES.has(table)) {
    return res.status(404).json({ error: `Unknown table: ${table}` });
  }
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: `Invalid id: ${idRaw}` });
  }
  try {
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select("*")
        .eq("id", id)
        .single();
      if (error) return res.status(404).json({ error: error.message });
      return res.status(200).json(data);
    }
    if (req.method === "PATCH") {
      const patch = stripAuto(req.body ?? {});
      const { data, error } = await supabaseAdmin
        .from(table)
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data);
    }
    if (req.method === "DELETE") {
      const { error } = await supabaseAdmin.from(table).delete().eq("id", id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    res.setHeader("Allow", "GET, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Server error",
    });
  }
}
