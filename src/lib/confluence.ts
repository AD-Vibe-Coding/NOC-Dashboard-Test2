// Confluence — QS Carrier Escalation Contacts client helpers.

export interface EscalationContact {
  level: string; // "L1" | "L2" | "L3" | "M1" | "M2" | etc.
  name?: string;
  role?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export interface ConfluenceTable {
  caption?: string;
  headers: string[];
  rows: string[][];
}

export interface ConfluenceLink {
  text: string;
  href: string;
}

export interface ConfluenceImage {
  /** Absolute URL to the image. Confluence-hosted images require Basic auth. */
  src: string;
  alt?: string;
}

export interface CarrierEscalation {
  id: string;
  carrier: string; // Short carrier name e.g. "Nitel"
  title: string; // Full page title
  url: string; // Direct link to the Confluence page
  primary_phone?: string;
  primary_email?: string;
  contacts: EscalationContact[];
  notes?: string;
  external_url?: string; // e.g. carrier portal/PDF URL when applicable
  last_updated: string; // ISO date
  /** Full plain-text body content scraped from the Confluence page. */
  body_text?: string;
  /** Tables extracted from the page body, in document order. */
  tables?: ConfluenceTable[];
  /** External links extracted from the page body (carrier portals, PDFs, etc). */
  links?: ConfluenceLink[];
  /** Inline images on the Confluence page. Used to trigger AI extraction. */
  images?: ConfluenceImage[];
  /** True if body content was successfully scraped (live mode only). */
  has_full_body?: boolean;
}

export interface PdfAttachment {
  title: string;
  url: string;
  file_size?: number;
}

/** Every extractable attachment kind we can show "Open in Confluence" for. */
export type AttachmentKind = "pdf" | "docx" | "xlsx" | "pptx";

export interface ConfluenceAttachment {
  title: string;
  url: string;
  kind: AttachmentKind;
  file_size?: number;
}

export interface ImageExtractionResult {
  source: "ai-vision";
  carrier_id: string;
  carrier: string;
  contacts: EscalationContact[];
  raw_text?: string;
  image_count: number;
  cached: boolean;
  extracted_at: string;
  warning?: string;
  /**
   * @deprecated Use `attachments` instead. PDF-only subset, kept for one
   * release of backwards compat.
   */
  pdf_attachments?: PdfAttachment[];
  /**
   * Every extractable attachment on the Confluence page (PDF / Word /
   * Excel / PowerPoint). Surfaced so the UI can offer "Open in Confluence"
   * links — Atlassian routes attachment binary through the Media API which
   * doesn't accept API-token Basic auth, so we can't auto-download them,
   * but the user's browser session CAN.
   */
  attachments?: ConfluenceAttachment[];
}

export interface EscalationsResponse {
  source: "live" | "snapshot";
  space: string;
  folder_id: string;
  folder_title: string;
  folder_url: string;
  fetched_at: string;
  carriers: CarrierEscalation[];
  warning: string | null;
}

import { fetchJson, resilientFetch } from "./fetch-resilient";

export async function fetchEscalations(): Promise<EscalationsResponse> {
  return fetchJson<EscalationsResponse>("/api/confluence/escalations");
}

/**
 * A user-uploaded file ready to ship to the extract endpoint. The server
 * sniffs the bytes and dispatches by file type:
 *   - image/* → AI vision
 *   - PDF → pdf-parse → AI text prompt
 *   - DOCX → mammoth → AI text prompt
 *   - XLSX → xlsx → AI text prompt (per-sheet CSV)
 */
export interface FileUpload {
  /** Original file name (used for labelling in the prompt + UI). */
  name: string;
  /** base64 data URL: `data:<mime>;base64,...` */
  data_url: string;
  /** Detected MIME type. */
  mime: string;
}

/**
 * Use the Devs.ai agent to extract structured escalation contacts. Three
 * modes:
 *   - Auto (carrierId only): server pulls images from Confluence via
 *     /exportword, runs vision; falls back to public PDF URLs scraped from
 *     the page body; falls back to Confluence-attached PDF/DOCX/XLSX files
 *     downloaded via the v2 attachments API.
 *   - Manual upload (images only — legacy): pass `imageDataUrls`.
 *   - Manual upload (any supported file): pass `fileUploads` with
 *     image / PDF / Word / Excel files.
 *
 * Results are server-side cached per carrier for 1 hour on success.
 *
 * Uses `resilientFetch` so transient 502s during Vite hot-reload windows
 * are auto-retried with exponential backoff.
 */
export async function extractCarrierImages(
  carrierId: string,
  opts: {
    refresh?: boolean;
    imageDataUrls?: string[];
    fileUploads?: FileUpload[];
    carrierName?: string;
  } = {},
): Promise<ImageExtractionResult> {
  const r = await resilientFetch(
    "/api/confluence/extract-images",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        carrier_id: carrierId,
        refresh: opts.refresh,
        image_data_urls: opts.imageDataUrls,
        file_uploads: opts.fileUploads,
        carrier_name: opts.carrierName,
      }),
    },
    // The AI extraction can take 10-20 seconds for cold (uncached) calls,
    // so use a single retry with a longer base delay. After one retry, if
    // it's still failing, the caller gets a normal error.
    { retries: 2, baseDelayMs: 800 },
  );
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(j.error ?? `Extract failed: ${r.status}`);
  }
  return j as ImageExtractionResult;
}

/**
 * Read a File (from a <input type="file"> or drop event) as a base64 data URL
 * suitable for the multimodal AI prompt. Returns null for non-image files or
 * files exceeding 8 MB.
 *
 * @deprecated Prefer `fileToUpload` which supports PDF / Word / Excel in
 * addition to images. Kept for any in-flight callers.
 */
export async function fileToImageDataUrl(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  if (file.size > 8 * 1024 * 1024) return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

/** MIME types accepted by the extract endpoint. */
const SUPPORTED_UPLOAD_MIMES = new Set<string>([
  // Images
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  // PDF
  "application/pdf",
  // Word
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  // Excel
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
]);

/** File extensions accepted (some browsers report a blank MIME for .docx etc). */
const SUPPORTED_UPLOAD_EXTS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
  ".docx",
  ".doc",
  ".xlsx",
  ".xls",
  ".csv",
];

/** Human-readable label for an upload error. */
export type UploadError =
  | { kind: "unsupported_type"; ext: string }
  | { kind: "too_large"; sizeMb: number }
  | { kind: "read_failed" };

/**
 * Read any supported file (image / PDF / Word / Excel) as a base64 data URL
 * suitable for the extract endpoint. Returns either an `UploadError` or a
 * `FileUpload` ready to pass into `extractCarrierImages({ fileUploads: [...] })`.
 *
 * Size cap: 15 MB. Bigger than that and we'd overrun the proxy's 40 MB body
 * cap with even a small batch. Most carrier escalation docs are < 1 MB.
 */
export async function fileToUpload(
  file: File,
): Promise<FileUpload | { error: UploadError }> {
  const name = file.name || "upload";
  const ext = (name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  const mime = file.type || "";
  const supported =
    SUPPORTED_UPLOAD_MIMES.has(mime) ||
    SUPPORTED_UPLOAD_EXTS.includes(ext);
  if (!supported) {
    return { error: { kind: "unsupported_type", ext: ext || "unknown" } };
  }
  if (file.size > 15 * 1024 * 1024) {
    return { error: { kind: "too_large", sizeMb: file.size / (1024 * 1024) } };
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve({
        name,
        data_url: dataUrl,
        mime: mime || "application/octet-stream",
      });
    };
    reader.onerror = () => resolve({ error: { kind: "read_failed" } });
    reader.readAsDataURL(file);
  });
}
