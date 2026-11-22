import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase-admin.js";
import { getSession } from "../_lib/auth-middleware.js";
import { getAppBuilderSession } from "../_lib/appbuilder-auth.js";
import { lookupByEmail } from "../_lib/roles.js";

const MAX_PARSED_BYTES = 4 * 1024 * 1024;
const KINDS = new Set(["tickets", "mobility", "calls"]);
const SELECT_FIELDS = "id,kind,filename,mime_type,file_size_bytes,data_url,parsed_data,uploaded_by,created_at";

function bodyOf(req: VercelRequest): Record<string, unknown> {
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return (req.body ?? {}) as Record<string, unknown>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Google SSO uses the encrypted iframe-partitioned cookie; dev sign-in
    // still uses the signed legacy noc_session cookie. Accept either verified
    // session, but always derive authorization from the server-side roster.
    const session = await getAppBuilderSession(req);
    const legacySession = session ? null : getSession(req);
    const sessionEmail = session?.email ?? legacySession?.email;
    const member = sessionEmail ? lookupByEmail(String(sessionEmail).toLowerCase()) : null;
    // Prefer the roster when an email matches; otherwise use the role resolved
    // by the shared App Builder session helper or the verified legacy session.
    const verifiedRole = member?.role ?? session?.role ?? legacySession?.role;
    if ((!session && !legacySession) || String(verifiedRole ?? "").toLowerCase() !== "manager") {
      return res.status(403).json({
        error: "Manager access required.",
        hint: "Sign in with a manager account to use this feature.",
      });
    }

    if (req.method === "GET") {
      const kind = typeof req.query.kind === "string" ? req.query.kind : "";
      if (!KINDS.has(kind)) return res.status(400).json({ error: "A valid upload kind is required." });

      const { data, error } = await supabaseAdmin
        .from("team_performance_uploads")
        .select(SELECT_FIELDS)
        .eq("kind", kind)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ upload: data ?? null });
    }

    if (req.method === "POST") {
      const body = bodyOf(req);
      const kind = String(body.kind ?? "");
      const filename = String(body.filename ?? "").trim().replace(/[\\/]/g, "_").slice(0, 255);
      const sourceFileBytes = Number(body.file_size_bytes);
      const parsed = body.parsed_data;
      if (!KINDS.has(kind)) return res.status(400).json({ error: "A valid upload kind is required." });
      if (!filename) return res.status(400).json({ error: "A filename is required." });
      if (!Number.isSafeInteger(sourceFileBytes) || sourceFileBytes < 0) {
        return res.status(400).json({ error: "A valid source file size is required." });
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return res.status(400).json({ error: "Parsed dashboard data is required." });
      }
      const snapshot = parsed as Record<string, unknown>;
      if (snapshot.kind !== kind || snapshot.filename !== filename || !Array.isArray(snapshot.months)) {
        return res.status(400).json({ error: "Parsed data does not match the selected workbook." });
      }

      // Defensive strip: raw source rows are stored in the dedicated table, never
      // in parsed_data (which remains capped at 4 MiB for dashboard summaries).
      const { rawRows: _rawRows, ...compactSnapshot } = snapshot;
      const parsedData = JSON.stringify(compactSnapshot);
      const parsedBytes = Buffer.byteLength(parsedData, "utf8");
      if (parsedBytes > MAX_PARSED_BYTES) {
        return res.status(413).json({ error: "The compact dashboard summary is too large to save (maximum 4 MiB)." });
      }

      // Fail before creating a visible snapshot if the separate raw-row table
      // has not yet been installed through the Supabase schema push flow.
      const { error: rawTableError } = await supabaseAdmin
        .from("team_performance_raw_rows")
        .select("id")
        .limit(0);
      if (rawTableError) {
        return res.status(503).json({ error: "Raw-row storage is not ready. Push the Supabase schema, then retry the upload." });
      }

      const { data, error } = await supabaseAdmin
        .from("team_performance_uploads")
        .insert({
          kind,
          filename,
          file_size_bytes: sourceFileBytes,
          parsed_data: compactSnapshot,
          uploaded_by: member.name,
        })
        .select("id,kind,filename,file_size_bytes,uploaded_by,created_at")
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ upload: data });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Server error." });
  }
}
