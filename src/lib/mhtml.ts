// Minimal MHTML / multipart-MIME parser. Browsers can "Save as → Web Page,
// Complete (.mhtml)" — the result is a multipart/related MIME envelope with
// the main HTML plus inlined CSS/images/etc as base64 or quoted-printable
// parts. We only need the readable text, so:
//
//   1. Split on the MIME boundary into parts
//   2. Find the first `text/html` (or `text/plain`) part
//   3. Decode `Content-Transfer-Encoding` (quoted-printable, base64, 7bit)
//   4. Strip HTML tags → plain text
//   5. Pull out common ticket metadata (ticket number, subject, status, etc.)
//
// Robust against the variations Chrome / Edge / Outlook / ServiceNow produce.

export interface ParsedMhtml {
  /** Readable plain-text body from the main HTML part. */
  text: string;
  /** Original HTML, if available — useful for richer downstream rendering. */
  html?: string;
  /** Captured Subject: header from the MIME envelope, if any. */
  subject?: string;
  /** Heuristically-extracted ticket number from URL/subject/body. */
  ticket_number?: string;
  /** Heuristically-extracted ticket subject line from the body. */
  ticket_subject?: string;
  /** Length of the extracted text — used to size the AI prompt. */
  length: number;
}

export async function parseMhtmlFile(file: File): Promise<ParsedMhtml> {
  const buf = await file.arrayBuffer();
  // MHTML headers are ASCII; the body of HTML parts is usually utf-8 or
  // quoted-printable-encoded utf-8. Read as latin1 first so byte values are
  // preserved, then re-decode the HTML part as utf-8 if needed.
  const raw = new TextDecoder("latin1").decode(buf);
  return parseMhtmlString(raw, file.name);
}

export function parseMhtmlString(raw: string, fileName = ""): ParsedMhtml {
  // 1. Extract the outer envelope's Content-Type to find the boundary.
  const headerEnd = raw.search(/\r?\n\r?\n/);
  const envelopeHeaders = headerEnd > 0 ? raw.slice(0, headerEnd) : raw.slice(0, 4000);

  const subjectMatch = envelopeHeaders.match(/^Subject:\s*(.+)$/im);
  const subject = subjectMatch ? decodeMimeWord(subjectMatch[1].trim()) : undefined;

  const boundaryMatch = envelopeHeaders.match(/boundary\s*=\s*"?([^";\r\n]+)"?/i);
  const boundary = boundaryMatch ? boundaryMatch[1] : null;

  // 2. Split on the boundary. If we have no boundary, treat the whole file as
  //    one part — some "MHTML" exports from Outlook are actually plain HTML
  //    with .mhtml extension.
  const parts = boundary
    ? raw
        .split(new RegExp(`--${escapeRegExp(boundary)}(?:--)?`))
        .map((p) => p.replace(/^\r?\n/, "").replace(/\r?\n$/, ""))
        .filter((p) => p.trim().length > 0)
    : [raw];

  // 3. Find the first text/html (preferred) or text/plain part.
  let htmlPart: { headers: string; body: string } | null = null;
  let textPart: { headers: string; body: string } | null = null;
  for (const part of parts) {
    const sep = part.search(/\r?\n\r?\n/);
    if (sep < 0) continue;
    const headers = part.slice(0, sep);
    const body = part.slice(sep).replace(/^\r?\n\r?\n/, "");
    const ct = (headers.match(/^Content-Type:\s*([^;\r\n]+)/im) || [])[1]?.toLowerCase();
    if (!htmlPart && ct === "text/html") htmlPart = { headers, body };
    else if (!textPart && ct === "text/plain") textPart = { headers, body };
  }

  const chosen = htmlPart ?? textPart;
  if (!chosen) {
    return {
      text: stripHtml(raw),
      subject,
      length: raw.length,
    };
  }

  // 4. Decode based on Content-Transfer-Encoding.
  const cte = (chosen.headers.match(/^Content-Transfer-Encoding:\s*(\S+)/im) || [])[1]?.toLowerCase();
  let decoded = chosen.body;
  if (cte === "quoted-printable") decoded = decodeQuotedPrintable(decoded);
  else if (cte === "base64") decoded = decodeBase64ToUtf8(decoded);

  // The decoded string is now likely a utf-8 byte string (since we read the
  // file as latin1). Re-decode through TextDecoder if we see escaped multibyte.
  if (/[\u0080-\u00ff]/.test(decoded)) {
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i) & 0xff;
    try {
      decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
      /* keep latin1 — better than nothing */
    }
  }

  const html = htmlPart ? decoded : undefined;
  const text = htmlPart ? stripHtml(decoded) : decoded;

  return {
    text,
    html,
    subject,
    ticket_number: extractTicketNumber({ text, html, subject, fileName }),
    ticket_subject: extractTicketSubject(text) ?? subject,
    length: text.length,
  };
}

// ---- Helpers -------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeQuotedPrintable(s: string): string {
  // Soft line breaks: `=\r\n` or `=\n` joins the next line.
  return s
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function decodeBase64ToUtf8(s: string): string {
  const cleaned = s.replace(/[^A-Za-z0-9+/=]/g, "");
  try {
    const binary = typeof atob === "function" ? atob(cleaned) : "";
    return binary;
  } catch {
    return s;
  }
}

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#34;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&hellip;": "…",
  "&ndash;": "–",
  "&mdash;": "—",
  "&rsquo;": "'",
  "&lsquo;": "'",
  "&rdquo;": "\u201D",
  "&ldquo;": "\u201C",
  "&bull;": "•",
  "&middot;": "·",
  "&copy;": "©",
  "&reg;": "®",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&(?:[a-z]+|#x?[0-9a-f]+);/gi, (m) => {
      if (HTML_ENTITIES[m]) return HTML_ENTITIES[m];
      const num = m.match(/&#x?([0-9a-f]+);/i);
      if (num) {
        const code = parseInt(num[1], num[0].toLowerCase().includes("x") ? 16 : 10);
        if (!Number.isNaN(code)) return String.fromCodePoint(code);
      }
      return m;
    });
}

function stripHtml(html: string): string {
  // Strip script/style entirely (don't surface their contents as "text").
  let s = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Preserve paragraph and line breaks
    .replace(/<\/(p|div|tr|li|h[1-6]|br|hr|blockquote|td|th)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Drop all remaining tags
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  // Collapse whitespace, but preserve newlines.
  s = s.replace(/[ \t\f\v]+/g, " ");
  s = s.replace(/\n[ \t]+/g, "\n");
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function decodeMimeWord(s: string): string {
  // RFC 2047 encoded-word: =?utf-8?Q?...?=  or  =?utf-8?B?...?=
  return s.replace(/=\?([^?]+)\?([QB])\?([^?]+)\?=/gi, (_, _charset, enc, data) => {
    if (enc.toUpperCase() === "Q") {
      return decodeQuotedPrintable(data.replace(/_/g, " "));
    }
    return decodeBase64ToUtf8(data);
  });
}

function extractTicketNumber(input: {
  text: string;
  html?: string;
  subject?: string;
  fileName?: string;
}): string | undefined {
  const candidates: string[] = [];
  // 1. Subject often contains the canonical ticket id (e.g. "INC0123456 - ..."
  //    or "Ticket #654402 — outage")
  if (input.subject) candidates.push(input.subject);
  // 2. Filename
  if (input.fileName) candidates.push(input.fileName);
  // 3. First 1500 chars of body (typically has breadcrumb / page title)
  candidates.push(input.text.slice(0, 1500));

  const patterns: RegExp[] = [
    /\b(INC|REQ|RITM|CHG|PRB|TASK)\d{5,}\b/i, // ServiceNow
    /\bTicket\s*#?\s*(\d{4,8})\b/i,
    /\b#(\d{6,8})\b/, // bare "#654402"
    /\b(\d{6,7})\b\s*[-–—|]/, // "654402 - subject"
    /\b(JIRA|PROJ|ABC)-\d{3,}\b/i,
  ];
  for (const text of candidates) {
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m) {
        return m[0].replace(/^Ticket\s*#?\s*/i, "").trim();
      }
    }
  }
  return undefined;
}

function extractTicketSubject(text: string): string | undefined {
  // Look at the first ~30 lines for something that smells like the ticket
  // summary / short description.
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 40);

  // ServiceNow-style: "Short description: ..."
  for (const l of lines) {
    const m = l.match(/^(?:Short\s+description|Summary|Subject|Title)\s*[:\-]\s*(.+)$/i);
    if (m && m[1].length > 4 && m[1].length < 200) return m[1].trim();
  }
  // Fallback: first long-ish line that's not all-caps boilerplate.
  for (const l of lines) {
    if (l.length >= 20 && l.length <= 180 && !/^[A-Z\s]+$/.test(l)) return l;
  }
  return undefined;
}
