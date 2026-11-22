import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionName, requireManager } from "../_lib/auth-middleware.js";
import { supabaseAdmin } from "../_lib/supabase-admin.js";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const KINDS = new Set(["tickets", "mobility", "calls"]);
const SELECT_FIELDS = "id,kind,filename,mime_type,file_size_bytes,data_url,uploaded_by,created_at";

function bodyOf(req: VercelRequest): Record<string, unknown> {
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return (req.body ?? {}) as Record<string, unknown>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!requireManager(req, res)) return;

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
      const dataUrl = String(body.data_url ?? "");
      if (!KINDS.has(kind)) return res.status(400).json({ error: "A valid upload kind is required." });
      if (!filename) return res.status(400).json({ error: "A filename is required." });

      const dataUrlMatch = /^data:([^;,]{1,128});base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
      if (!dataUrlMatch || dataUrl.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 256) {
        return res.status(400).json({ error: "The uploaded file data is invalid." });
      }
      const mimeType = String(body.mime_type || dataUrlMatch[1] || "application/octet-stream").slice(0, 128);
      const base64 = dataUrlMatch[2];
      const bytes = Buffer.from(base64, "base64");
      if (bytes.byteLength === 0) return res.status(400).json({ error: "The uploaded file is empty." });
      if (bytes.byteLength > MAX_FILE_BYTES) {
        return res.status(413).json({ error: "Files must be 2 MiB or smaller." });
      }
      if (Number(body.file_size_bytes) !== bytes.byteLength) {
        return res.status(400).json({ error: "The uploaded file size did not match its data." });
      }

      const { data, error } = await supabaseAdmin
        .from("team_performance_uploads")
        .insert({
          kind,
          filename,
          mime_type: mimeType,
          file_size_bytes: bytes.byteLength,
          data_url: dataUrl,
          uploaded_by: getSessionName(req),
        })
        .select("id,kind,filename,mime_type,file_size_bytes,uploaded_by,created_at")
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
