import type { Plugin } from "vite";
import { loadEnv } from "vite";
// pdf-parse is a Node-side pure-JS PDF text extractor (wraps Mozilla's pdfjs).
// We use it to OCR public-URL PDFs (e.g. carriers that host their escalation
// list on their own marketing site), since the AI vision model gets ~0 contacts
// when fed a PDF as image_url but the same text via prompt yields the full list
// reliably.
import { PDFParse } from "pdf-parse";
// mammoth — pure-JS Word .docx text extractor. Carriers occasionally attach
// their escalation list as a Word document; we run the same NOC-only AI
// extraction prompt against the extracted text.
import mammoth from "mammoth";
// xlsx — pure-JS Excel reader. Some carriers ship their contacts as an .xlsx
// spreadsheet; we serialize every sheet to CSV-ish text and feed that to the
// same NOC-only AI extraction prompt.
import * as XLSX from "xlsx";

// =============================================================================
// QS Carrier Escalation Contacts proxy
//
// Two modes:
//   - LIVE     — When CONFLUENCE_USER_EMAIL + CONFLUENCE_API_TOKEN are set in
//                .env, the proxy calls the Confluence REST API directly, pulls
//                the body.view (HTML) of every page under folder 6010634319, and
//                scrapes plain text + tables + links from it.
//   - SNAPSHOT — Otherwise, returns a curated snapshot of the folder contents
//                captured via the Confluence MCP. Each entry below has been
//                hand-extracted from the page excerpt so the widget still has
//                useful body content offline.
// =============================================================================

const FOLDER_ID = "6010634319";
const FOLDER_TITLE = "QS Carrier Escalation Contacts";
const FOLDER_URL =
  "https://appdirect.jira.com/wiki/spaces/vComNoc/folder/6010634319";
const SPACE_KEY = "vComNoc";
const BASE = "https://appdirect.jira.com/wiki";

// ----------------------------------------------------------------------------
// Types (mirror src/lib/confluence.ts but local to the server side)
// ----------------------------------------------------------------------------

interface ParsedContact {
  level: string;
  name?: string;
  role?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

interface ParsedTable {
  caption?: string;
  headers: string[];
  rows: string[][];
}

interface ParsedLink {
  text: string;
  href: string;
}

interface ParsedImage {
  /** Absolute URL to the image (may require Basic auth to fetch). */
  src: string;
  /** Optional alt text from the <img> tag. */
  alt?: string;
}

interface CarrierEntry {
  id: string;
  carrier: string;
  title: string;
  webui: string;
  primary_phone?: string;
  primary_email?: string;
  external_url?: string;
  notes?: string;
  contacts: ParsedContact[];
  body_text?: string;
  tables?: ParsedTable[];
  links?: ParsedLink[];
  images?: ParsedImage[];
  has_full_body?: boolean;
  last_updated: string;
}

// ----------------------------------------------------------------------------
// Snapshot — captured via Confluence MCP, manually structured.
// ----------------------------------------------------------------------------

const SNAPSHOT: CarrierEntry[] = [
  {
    id: "6011781170",
    carrier: "Comcast",
    title: "Comcast Escalation List",
    webui: "/spaces/vComNoc/pages/6011781170/Comcast+Escalation+List",
    primary_phone: "888-262-7300 Option 2",
    primary_email: "ccs_noc@comcast.com",
    contacts: [
      {
        level: "L1",
        name: "BNOC (24x7)",
        role: "Business Services Network Operations",
        phone: "888-262-7300 Option 2",
        email: "ccs_noc@comcast.com",
      },
      {
        level: "L2",
        role: "BNOC On Duty / On Call Manager",
        phone: "888-262-7300 Option 2",
        email: "ccs_noc@comcast.com",
      },
      {
        level: "L3",
        name: "Shinu Varghese",
        role: "BNOC Director",
        phone: "888-262-7300 Option 2",
        email: "shinu_varghese@comcast.com",
      },
    ],
    body_text:
      "Comcast Escalation List - SLA services\n\nTechnical Support - BNOC\nBNOC (24 x 7) — Business Services Network Operations\nPhone: 888-262-7300 Option 2\nEmail: ccs_noc@comcast.com\n\nSupervisor\nBNOC On Duty / On Call Manager\nPhone: 888-262-7300 Option 2\nEmail: ccs_noc@comcast.com\n\nShinu Varghese — BNOC Director\nPhone: 888-262-7300 Option 2\nEmail: shinu_varghese@comcast.com",
    tables: [
      {
        caption: "Comcast SLA Services Escalation",
        headers: ["Level", "Role", "Name", "Phone", "Email"],
        rows: [
          [
            "L1",
            "Technical Support - BNOC (24x7)",
            "Business Services Network Operations",
            "888-262-7300 Option 2",
            "ccs_noc@comcast.com",
          ],
          [
            "L2",
            "Supervisor",
            "BNOC On Duty / On Call Manager",
            "888-262-7300 Option 2",
            "ccs_noc@comcast.com",
          ],
          [
            "L3",
            "BNOC Director",
            "Shinu Varghese",
            "888-262-7300 Option 2",
            "shinu_varghese@comcast.com",
          ],
        ],
      },
    ],
    links: [],
    has_full_body: false,
    last_updated: "2026-05-11",
  },
  {
    id: "6090784798",
    carrier: "Nitel",
    title: "Nitel Escalation List",
    webui: "/spaces/vComNoc/pages/6090784798/Nitel+Escalation+List",
    primary_phone: "866-892-0915",
    primary_email: "noc@nitelusa.com",
    contacts: [
      {
        level: "L1",
        role: "Technician on Duty",
        phone: "866-892-0915",
        email: "noc@nitelusa.com",
      },
      {
        level: "L2",
        name: "Doug Kozak",
        role: "NOC Manager",
        phone: "866-892-0915",
        email: "douglas_kozak2@comcast.com",
      },
      {
        level: "L3",
        name: "Phil Lukacek",
        role: "Sr. Manager, NOC",
        phone: "708-219-0366",
        email: "phillip_lukacek@comcast.com",
      },
    ],
    body_text:
      "NOC ESCALATION\n\n1st Level — Technician on Duty\nPhone: 866-892-0915\nEmail: noc@nitelusa.com\n\n2nd Level — Doug Kozak, NOC Manager\nPhone: 866.892.0915\nEmail: douglas_kozak2@comcast.com\n\n3rd Level — Phil Lukacek, Sr. Manager, NOC\nPhone: 708.219.0366\nEmail: phillip_lukacek@comcast.com",
    tables: [
      {
        caption: "Nitel NOC Escalation",
        headers: ["Level", "Name", "Role", "Phone", "Email"],
        rows: [
          [
            "1st",
            "—",
            "Technician on Duty",
            "866-892-0915",
            "noc@nitelusa.com",
          ],
          [
            "2nd",
            "Doug Kozak",
            "NOC Manager",
            "866.892.0915",
            "douglas_kozak2@comcast.com",
          ],
          [
            "3rd",
            "Phil Lukacek",
            "Sr. Manager, NOC",
            "708.219.0366",
            "phillip_lukacek@comcast.com",
          ],
        ],
      },
    ],
    links: [],
    has_full_body: false,
    last_updated: "2026-05-11",
  },
  {
    id: "6087901221",
    carrier: "Lumen",
    title: "Lumen Escalation List",
    webui: "/spaces/vComNoc/pages/6087901221/Lumen+Escalation+List",
    notes:
      "Lumen accepts escalations only via calls. If nobody answers, leave a voicemail and start an escalation via email.",
    external_url: "https://repairescalations.lumen.com/",
    contacts: [
      {
        level: "L3",
        name: "Keith Fitzgerald",
        role: "Sr. Manager (On Call)",
        email: "Keith.Fitzgerald@lumen.com",
      },
    ],
    body_text:
      "Lumen Repair Escalations Portal: https://repairescalations.lumen.com/\n\nNote: Lumen accepts escalations only via calls. If we didn't get hold of anyone, we can send a voicemail and start an escalation via email.\n\nESCALATION EMAIL CONTACTS\n\nTHIRD LEVEL — Sr. Managers (On Call)\nKeith Fitzgerald — Keith.Fitzgerald@lumen.com",
    tables: [
      {
        caption: "Lumen Escalation Email Contacts",
        headers: ["Level", "Name", "Role", "Email"],
        rows: [
          [
            "L3",
            "Keith Fitzgerald",
            "Sr. Manager (On Call)",
            "Keith.Fitzgerald@lumen.com",
          ],
        ],
      },
    ],
    links: [
      {
        text: "Repair Escalations Portal",
        href: "https://repairescalations.lumen.com/",
      },
    ],
    has_full_body: false,
    last_updated: "2026-05-11",
  },
  {
    id: "6088917009",
    carrier: "GTT",
    title: "GTT Escalation List",
    webui: "/spaces/vComNoc/pages/6088917009/GTT+Escalation+List",
    primary_phone: "833-402-6222",
    primary_email: "Americas.Solutions.M1@gtt.net",
    notes: "Day: M1 8am-8pm CST Mon-Fri. After hours / weekends: 24/7 phone.",
    contacts: [
      {
        level: "M1",
        role: "Shift Manager (8:00-20:00 CST Mon-Fri)",
        email: "Americas.Solutions.M1@gtt.net",
      },
      {
        level: "M1 (after-hours)",
        role: "24/7 phone or email",
        phone: "833-402-6222",
      },
      {
        level: "M2",
        name: "Steven Daidone",
        role: "Senior Manager (8:00-20:00 CST Mon-Fri)",
        email: "Americas.Solutions.M2@gtt.net",
      },
    ],
    body_text:
      "GTT Escalation Matrix\n\nM1 — Shift Manager\n  08:00-20:00 CST Mon-Fri: Email Americas.Solutions.M1@gtt.net, phone via NOC contact lines\n  20:00-08:00 CST & weekends: email 24/7 or phone 833-402-6222\n\nM2 — Steven Daidone, Senior Manager\n  08:00-20:00 CST Mon-Fri: Email Americas.Solutions.M2@gtt.net",
    tables: [
      {
        caption: "GTT Escalation Matrix",
        headers: ["Level", "Role / Name", "Coverage", "Email", "Phone"],
        rows: [
          [
            "M1",
            "Shift Manager",
            "08:00-20:00 CST Mon-Fri",
            "Americas.Solutions.M1@gtt.net",
            "via NOC contact lines",
          ],
          [
            "M1",
            "Shift Manager",
            "20:00-08:00 CST & weekends",
            "email 24/7",
            "833-402-6222",
          ],
          [
            "M2",
            "Steven Daidone, Senior Manager",
            "08:00-20:00 CST Mon-Fri",
            "Americas.Solutions.M2@gtt.net",
            "—",
          ],
        ],
      },
    ],
    links: [],
    has_full_body: false,
    last_updated: "2026-05-11",
  },
  {
    id: "6090653725",
    carrier: "CrownCastle Fiber (Zayo)",
    title: "CrownCastle Fiber (Now Part of Zayo)",
    webui: "/spaces/vComNoc/pages/6090653725/CrownCastle+Fiber+Now+Part+of+Zayo",
    primary_phone: "1-855-93-FIBER",
    primary_email: "FiberSupport@zayo.com",
    contacts: [
      {
        level: "L1",
        role: "NOC Supervisor on Duty",
        email: "FiberSupport@zayo.com",
        phone: "1-855-93-FIBER",
      },
      {
        level: "L1 (secondary)",
        phone: "844-584-4237",
      },
    ],
    body_text:
      "CrownCastle Fiber (Now Part of Zayo)\n\nNOC Supervisor on Duty\nEmail: FiberSupport@zayo.com\nPrimary: 1-855-93-FIBER\nSecondary: (844) 584-4237",
    tables: [
      {
        caption: "CrownCastle Fiber / Zayo Contacts",
        headers: ["Title", "Name", "Email", "Phone"],
        rows: [
          [
            "NOC Supervisor",
            "On duty",
            "FiberSupport@zayo.com",
            "Primary: 1-855-93-FIBER · Secondary: (844) 584-4237",
          ],
        ],
      },
    ],
    links: [],
    has_full_body: false,
    last_updated: "2026-05-12",
  },
  {
    id: "6092128263",
    carrier: "Zayo",
    title: "Zayo Escalation List",
    webui: "/spaces/vComNoc/pages/6092128263/Zayo+Escalation+List",
    external_url: "https://tranzact.zayo.com/#!/escalation-lists",
    notes:
      "Open Tranzact and pick 'Global Service Management' from the Escalation Group dropdown, then your specific service.",
    contacts: [],
    body_text:
      "For escalation list, go to https://tranzact.zayo.com/#!/escalation-lists\n\nSelect 'Global Service Management' from the 'Select your Escalation Group' dropdown, then pick the appropriate service from the 'Select your Service' dropdown.",
    tables: [],
    links: [
      {
        text: "Tranzact Escalation Lists",
        href: "https://tranzact.zayo.com/#!/escalation-lists",
      },
    ],
    has_full_body: false,
    last_updated: "2026-05-11",
  },
  {
    id: "6092029981",
    carrier: "Ziply Fiber",
    title: "Ziply Fiber Escalation List",
    webui: "/spaces/vComNoc/pages/6092029981/Ziply+Fiber+Escalation+List",
    notes:
      "Wholesale Repair Center contacts for ASR & LSR (Ethernet / DIA ASR circuits), plus WFI / Wholesale Broadband. See Confluence page for the full lists.",
    contacts: [],
    body_text:
      "Wholesale Repair Center Contacts and Escalation Lists\n\n• Repair Contact and Escalation List for ASR and LSR (Ethernet / DIA ASR Circuits)\n• Tech Support and Repair Contact List for WFI, Wholesale Broadband",
    tables: [],
    links: [],
    has_full_body: false,
    last_updated: "2026-05-11",
  },
  {
    id: "6091997192",
    carrier: "Verizon",
    title: "Verizon Escalation List",
    webui: "/spaces/vComNoc/pages/6091997192/Verizon+Escalation+List",
    notes:
      "Full list (incl. SAM Escalation Matrix attachment) lives on the Confluence page.",
    contacts: [],
    body_text:
      "Full Verizon escalation matrix is attached to the Confluence page (SAM Escalation Matrix). See link to view in Confluence.",
    tables: [],
    links: [],
    has_full_body: false,
    last_updated: "2026-05-11",
  },
  {
    id: "6090653717",
    carrier: "Frontier (Verizon)",
    title: "Frontier Escalation List (Now Part of Verizon)",
    webui:
      "/spaces/vComNoc/pages/6090653717/Frontier+Escalation+List+Now+Part+of+Verizon",
    primary_email: "CSA.Escalations.FL@FTR.com",
    external_url:
      "https://wholesale.frontier.com/contacts-and-escalation-lists/wholesale-repair-contacts",
    notes:
      "For SLA services email CSA.Escalations.FL@FTR.com. For broadband/fiber repair, see the wholesale portal link.",
    contacts: [
      {
        level: "L1",
        role: "SLA Services Escalations",
        email: "CSA.Escalations.FL@FTR.com",
      },
    ],
    body_text:
      "Frontier Escalation List (Now Part of Verizon)\n\nFrontier SLA Services Escalation\n  Include CSA.Escalations.FL@FTR.com on escalations.\n\nFrontier DSL and Fiber Broadband Escalation\n  https://wholesale.frontier.com/contacts-and-escalation-lists/wholesale-repair-contacts",
    tables: [
      {
        caption: "Frontier Escalation Channels",
        headers: ["Service", "Channel", "Contact"],
        rows: [
          [
            "SLA Services",
            "Email",
            "CSA.Escalations.FL@FTR.com",
          ],
          [
            "DSL / Fiber Broadband",
            "Portal",
            "wholesale.frontier.com/contacts-and-escalation-lists",
          ],
        ],
      },
    ],
    links: [
      {
        text: "Wholesale Repair Contacts (Frontier)",
        href: "https://wholesale.frontier.com/contacts-and-escalation-lists/wholesale-repair-contacts",
      },
    ],
    has_full_body: false,
    last_updated: "2026-05-12",
  },
  {
    id: "6091571219",
    carrier: "Granite",
    title: "Granite Escalation List - NOC",
    webui: "/spaces/vComNoc/pages/6091571219/Granite+Escalation+List+-+NOC",
    notes:
      "See the Q2 2026 NOC Escalation Matrix attachment on the Confluence page.",
    contacts: [],
    body_text:
      "Granite NOC Escalation Matrix — see the 'Granite NOC escalation matrix 2026 Q2.pdf' attachment on the Confluence page for the current quarterly list.",
    tables: [],
    links: [],
    has_full_body: false,
    last_updated: "2026-05-11",
  },
  {
    id: "6089637893",
    carrier: "Spectrum",
    title: "Spectrum Escalation List",
    webui: "/spaces/vComNoc/pages/6089637893/Spectrum+Escalation+List",
    contacts: [],
    body_text:
      "Spectrum escalation contacts are listed on the Confluence page. Set CONFLUENCE_API_TOKEN in .env to scrape the full body content.",
    tables: [],
    links: [],
    has_full_body: false,
    last_updated: "2026-05-11",
  },
  {
    id: "6089408515",
    carrier: "AireSpring",
    title: "AireSpring Escalation List",
    webui: "/spaces/vComNoc/pages/6089408515/AireSpring+Escalation+List",
    external_url:
      "https://airespring.com/wp-content/uploads/AireSpring_Advantage_Support_Escalation_List.pdf",
    notes:
      "AireSpring's full Advantage Support escalation list lives on their site.",
    contacts: [],
    body_text:
      "AireSpring Advantage Support Escalation List (PDF):\nhttps://airespring.com/wp-content/uploads/AireSpring_Advantage_Support_Escalation_List.pdf",
    tables: [],
    links: [
      {
        text: "AireSpring Advantage Support Escalation List (PDF)",
        href: "https://airespring.com/wp-content/uploads/AireSpring_Advantage_Support_Escalation_List.pdf",
      },
    ],
    has_full_body: false,
    last_updated: "2026-05-11",
  },
  {
    id: "6089244673",
    carrier: "AT&T APEX",
    title: "AT&T APEX Escalation List",
    webui: "/spaces/vComNoc/pages/6089244673/AT+T+APEX+Escalation+List",
    external_url: "https://partnerexchange.att.com",
    notes:
      "For SLA services, open a support ticket via the AT&T Partner Exchange Portal.",
    contacts: [],
    body_text:
      "For SLA services, engage the AT&T escalation team by opening a support ticket via the AT&T Partner Exchange Portal.\n\nPortal URL: https://partnerexchange.att.com",
    tables: [],
    links: [
      {
        text: "AT&T Partner Exchange Portal",
        href: "https://partnerexchange.att.com",
      },
    ],
    has_full_body: false,
    last_updated: "2026-05-11",
  },
  {
    id: "6012928001",
    carrier: "Astound Wholesale",
    title: "Astound Wholesale Escalation List",
    webui: "/spaces/vComNoc/pages/6012928001/Astound+Wholesale+Escalation+List",
    contacts: [],
    body_text:
      "Astound Wholesale escalation contacts are listed on the Confluence page. Set CONFLUENCE_API_TOKEN in .env to scrape the full body content.",
    tables: [],
    links: [],
    has_full_body: false,
    last_updated: "2026-04-21",
  },
  {
    id: "6011420701",
    carrier: "Cox Business",
    title: "Cox Business Escalation List",
    webui: "/spaces/vComNoc/pages/6011420701/Cox+Business+Escalation+List",
    contacts: [],
    body_text:
      "Cox Business escalation contacts are listed on the Confluence page. Set CONFLUENCE_API_TOKEN in .env to scrape the full body content.",
    tables: [],
    links: [],
    has_full_body: false,
    last_updated: "2026-04-21",
  },
];

// ----------------------------------------------------------------------------
// HTML → structured data parser
//
// The Confluence REST API returns rendered HTML for body.view. We turn that
// HTML into plain text, tables, and a list of external links. No third-party
// deps — Confluence HTML is well-formed enough that a few regexes + tag walks
// do the job cleanly.
// ----------------------------------------------------------------------------

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
}

function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>|<\/li>|<\/tr>|<\/h\d>/gi, "\n")
      .replace(/<\/td>|<\/th>/gi, " | ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extract text from a fragment of HTML (cells, link content, etc). */
function cellText(html: string): string {
  return stripHtmlTags(html).replace(/\s+/g, " ").trim();
}

/** Extract all `<table>...</table>` blocks and parse them into rows. */
function extractTables(html: string): ParsedTable[] {
  const tables: ParsedTable[] = [];
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(html)) !== null) {
    const tableHtml = m[1];

    // Optional caption
    const capMatch = /<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(tableHtml);
    const caption = capMatch ? cellText(capMatch[1]) : undefined;

    // All rows
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const allRows: string[][] = [];
    let r: RegExpExecArray | null;
    while ((r = rowRe.exec(tableHtml)) !== null) {
      const rowHtml = r[1];
      const cells: string[] = [];
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let c: RegExpExecArray | null;
      while ((c = cellRe.exec(rowHtml)) !== null) {
        cells.push(cellText(c[1]));
      }
      if (cells.length > 0) allRows.push(cells);
    }
    if (allRows.length === 0) continue;

    // Heuristic: first row is the header if all its cells are short non-empty
    // labels and at least one cell looks header-y (capitalized words, no @ / digits).
    const first = allRows[0];
    const looksLikeHeader = first.every(
      (c) => c.length > 0 && c.length < 40 && !/@/.test(c),
    );
    const headers = looksLikeHeader ? first : first.map((_, i) => `Col ${i + 1}`);
    const rows = looksLikeHeader ? allRows.slice(1) : allRows;

    tables.push({ caption, headers, rows });
  }
  return tables;
}

/** Extract all `<img src="...">` tags and normalize to absolute URLs. */
function extractImages(html: string, baseUrl: string): ParsedImage[] {
  const out: ParsedImage[] = [];
  const seen = new Set<string>();
  const imgRe = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    // Confluence body.view sometimes uses data-src for lazy-loaded images.
    const srcMatch =
      /\bsrc=["']([^"']+)["']/i.exec(tag) ||
      /\bdata-src=["']([^"']+)["']/i.exec(tag) ||
      /\bdata-image-src=["']([^"']+)["']/i.exec(tag);
    if (!srcMatch) continue;
    let src = decodeHtmlEntities(srcMatch[1]);
    // Skip inline data: URIs (already an image, no need to fetch)
    if (src.startsWith("data:")) continue;
    // Skip Confluence UI icons / emoticons
    if (/\/(images\/icons|emoticons|aui)\//i.test(src)) continue;
    // Normalize to absolute
    if (src.startsWith("//")) src = "https:" + src;
    else if (src.startsWith("/")) src = baseUrl.replace(/\/$/, "") + src;
    if (seen.has(src)) continue;
    seen.add(src);

    const altMatch = /\balt=["']([^"']*)["']/i.exec(tag);
    out.push({
      src,
      alt: altMatch ? decodeHtmlEntities(altMatch[1]) : undefined,
    });
  }
  return out;
}

/** Extract all external `<a href=...>` links (anything starting with http). */
function extractLinks(html: string): ParsedLink[] {
  const seen = new Set<string>();
  const out: ParsedLink[] = [];
  const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1].trim();
    if (!/^https?:\/\//i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    const text = cellText(m[2]) || href;
    out.push({ text, href });
  }
  return out;
}

/** Extract contact rows from any table that looks like an escalation matrix. */
function tablesToContacts(tables: ParsedTable[]): ParsedContact[] {
  const out: ParsedContact[] = [];
  const phoneRe = /(\+?\d[\d\s().-]{7,})/;
  const emailRe = /[\w.+-]+@[\w-]+\.[\w.-]+/;

  for (const t of tables) {
    // Find which columns are which by header name
    const headerLower = t.headers.map((h) => h.toLowerCase());
    const idx = (kw: string[]) =>
      headerLower.findIndex((h) => kw.some((k) => h.includes(k)));
    const levelCol = idx(["level", "tier", "step"]);
    const nameCol = idx(["name"]);
    const roleCol = idx(["role", "title", "position"]);
    const phoneCol = idx(["phone", "tel", "number"]);
    const emailCol = idx(["email", "e-mail", "mail"]);

    // Skip tables that look unrelated to escalations
    if (levelCol < 0 && nameCol < 0 && phoneCol < 0 && emailCol < 0) continue;

    for (let r = 0; r < t.rows.length; r++) {
      const row = t.rows[r];
      const pickCol = (i: number) =>
        i >= 0 && i < row.length ? row[i].trim() : "";
      const joined = row.join(" ");

      const phone = pickCol(phoneCol) || (phoneRe.exec(joined)?.[1] ?? "");
      const email = pickCol(emailCol) || (emailRe.exec(joined)?.[0] ?? "");
      const name = pickCol(nameCol);
      const role = pickCol(roleCol);
      const level = pickCol(levelCol) || `Row ${r + 1}`;

      // Skip rows that have no useful data
      if (!phone && !email && !name && !role) continue;

      out.push({
        level: level || `Row ${r + 1}`,
        name: name || undefined,
        role: role || undefined,
        phone: phone || undefined,
        email: email || undefined,
      });
    }
  }
  return out;
}

/** Extract the first phone-looking and email-looking value from body text. */
function extractPrimary(text: string): {
  primary_phone?: string;
  primary_email?: string;
} {
  const emailMatch = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(text);
  const phoneMatch =
    /\b(?:1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/.exec(text);
  return {
    primary_phone: phoneMatch ? phoneMatch[0].trim() : undefined,
    primary_email: emailMatch ? emailMatch[0].trim() : undefined,
  };
}

/** Parse a Confluence page's body.view HTML into a richer carrier entry. */
function parseBodyHtml(html: string, baseUrl: string) {
  const body_text = stripHtmlTags(html);
  const tables = extractTables(html);
  const links = extractLinks(html);
  const images = extractImages(html, baseUrl);
  const contactsFromTables = tablesToContacts(tables);
  const primary = extractPrimary(body_text);
  return {
    body_text,
    tables,
    links,
    images,
    contactsFromTables,
    primary_phone: primary.primary_phone,
    primary_email: primary.primary_email,
  };
}

// ----------------------------------------------------------------------------
// API serialization
// ----------------------------------------------------------------------------

function entryToResponse(e: CarrierEntry) {
  return {
    id: e.id,
    carrier: e.carrier,
    title: e.title,
    url: BASE + e.webui,
    primary_phone: e.primary_phone,
    primary_email: e.primary_email,
    contacts: e.contacts,
    notes: e.notes,
    external_url: e.external_url,
    last_updated: e.last_updated,
    body_text: e.body_text,
    tables: e.tables,
    links: e.links,
    images: e.images ?? [],
    has_full_body: e.has_full_body,
  };
}

// ----------------------------------------------------------------------------
// Live fetch — calls the Confluence REST API directly with Basic auth, pulls
// body.view for every page under the folder, and runs the HTML parser on each.
// ----------------------------------------------------------------------------

async function fetchLive(
  baseUrl: string,
  email: string,
  apiToken: string,
): Promise<CarrierEntry[]> {
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  };
  const cql = encodeURIComponent(`ancestor=${FOLDER_ID}`);
  const url = `${baseUrl.replace(/\/$/, "")}/rest/api/content/search?cql=${cql}&limit=50&expand=body.view,version`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`Confluence HTTP ${r.status}`);
  const j: any = await r.json();

  const snapById = new Map(SNAPSHOT.map((e) => [e.id, e] as const));

  return (j.results ?? []).map((p: any): CarrierEntry => {
    const id = String(p.id);
    const snap = snapById.get(id);
    const html: string = p.body?.view?.value ?? "";
    const parsed = html ? parseBodyHtml(html, baseUrl) : null;

    // Prefer scraped contacts; fall back to snapshot's curated list.
    const contacts =
      parsed && parsed.contactsFromTables.length > 0
        ? parsed.contactsFromTables
        : (snap?.contacts ?? []);

    // Pick the first non-Confluence link as the "external resource"
    const externalUrl =
      parsed?.links.find(
        (l) =>
          !l.href.startsWith(baseUrl) &&
          !l.href.includes("appdirect.jira.com"),
      )?.href ?? snap?.external_url;

    const carrier =
      snap?.carrier ??
      (p.title ?? "")
        .replace(/\s+Escalation List.*$/i, "")
        .replace(/\s+\(Now Part of .*\)$/, "")
        .trim();

    return {
      id,
      carrier,
      title: p.title ?? snap?.title ?? "",
      webui: p._links?.webui ?? snap?.webui ?? "",
      primary_phone: parsed?.primary_phone ?? snap?.primary_phone,
      primary_email: parsed?.primary_email ?? snap?.primary_email,
      external_url: externalUrl,
      notes: snap?.notes,
      contacts,
      body_text: parsed?.body_text ?? snap?.body_text,
      tables: parsed?.tables ?? snap?.tables,
      links: parsed?.links ?? snap?.links,
      images: parsed?.images,
      has_full_body: !!parsed,
      last_updated:
        (p.version?.when ?? "").slice(0, 10) || snap?.last_updated || "",
    };
  });
}

// ----------------------------------------------------------------------------
// AI-powered image extraction
//
// For carriers whose Confluence page has the escalation contacts only as an
// embedded image (e.g. Astound Wholesale), we download the image, ship it to
// the Devs.ai agent as a multimodal `image_url` content item, and ask the
// agent to extract structured contacts as JSON.
// ----------------------------------------------------------------------------

interface PdfAttachment {
  title: string;
  /** Confluence URL the user can open in their browser session. */
  url: string;
  file_size?: number;
}

interface ExtractionResult {
  source: "ai-vision";
  carrier_id: string;
  carrier: string;
  contacts: ParsedContact[];
  raw_text?: string;
  image_count: number;
  cached: boolean;
  extracted_at: string;
  warning?: string;
  /**
   * @deprecated Use `attachments` instead. PDF-only subset of attachments,
   * kept for one release for backwards compat with the existing UI.
   */
  pdf_attachments?: PdfAttachment[];
  /**
   * Every extractable attachment on the Confluence page (PDF / DOCX / XLSX
   * / PPTX). Surfaced so the UI can offer "Open in Confluence" links when
   * the contacts live in an attachment that we can't auto-download (Cloud
   * routes attachment binary through Media API, which API tokens can't
   * authenticate against).
   */
  attachments?: Array<{
    title: string;
    url: string;
    kind: "pdf" | "docx" | "xlsx" | "pptx";
    file_size?: number;
  }>;
}

/** In-memory cache of extraction results, keyed by carrier_id. */
const extractionCache = new Map<
  string,
  { result: ExtractionResult; cached_at: number }
>();
const EXTRACT_TTL_MS = 60 * 60 * 1000; // 1 hour

function guessMime(url: string): string {
  const u = url.toLowerCase();
  if (u.endsWith(".png") || u.includes(".png?") || u.includes(".png&")) return "image/png";
  if (u.endsWith(".gif") || u.includes(".gif?") || u.includes(".gif&")) return "image/gif";
  if (u.endsWith(".webp") || u.includes(".webp?")) return "image/webp";
  return "image/jpeg";
}

async function downloadImageAsDataUrl(
  url: string,
  baseUrl: string,
  email: string,
  apiToken: string,
): Promise<{ dataUrl: string; size: number; mime: string } | null> {
  const headers: Record<string, string> = {};
  // Confluence-hosted images need Basic auth.
  if (url.startsWith(baseUrl) || url.startsWith("https://appdirect.jira.com")) {
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    headers.Authorization = `Basic ${auth}`;
  }
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const mimeHeader = r.headers.get("content-type")?.split(";")[0].trim();
    const mime = mimeHeader && mimeHeader.startsWith("image/") ? mimeHeader : guessMime(url);
    if (!mime.startsWith("image/")) return null;
    // 8 MB cap to avoid bloated prompts (most Confluence embeds are <500 KB)
    if (buf.length > 8 * 1024 * 1024) return null;
    const b64 = buf.toString("base64");
    return { dataUrl: `data:${mime};base64,${b64}`, size: buf.length, mime };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Auto-extract via Confluence's MS Word export endpoint
// ---------------------------------------------------------------------------
//
// /wiki/download/attachments/... rejects API-token Basic auth on Confluence
// Cloud, but /wiki/exportword?pageId=<id> accepts it just fine and returns
// the page as MHTML — a multipart/related MIME envelope that has every
// referenced image embedded inline as base64. This is the only documented
// server-side way to fetch a page's images on Cloud without OAuth 3LO.
//
// We parse the MHTML manually (no extra deps): split on the boundary, then
// for each non-HTML part, base64-decode the body and check the first few
// bytes for a known image signature (PNG / JPEG / GIF / WEBP). Word's
// export labels images as "application/octet-stream" so we can't trust
// the declared Content-Type — we sniff the bytes.

function detectImageMime(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  // GIF: 47 49 46 38
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  )
    return "image/gif";
  // WEBP: 52 49 46 46 .. .. .. .. 57 45 42 50
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  return null;
}

interface ExtractedImage {
  dataUrl: string;
  mime: string;
  size: number;
}

async function listPdfAttachments(
  pageId: string,
  baseUrl: string,
  email: string,
  apiToken: string,
): Promise<PdfAttachment[]> {
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  try {
    const r = await fetch(
      `${baseUrl}/api/v2/pages/${encodeURIComponent(pageId)}/attachments`,
      { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } },
    );
    if (!r.ok) return [];
    const j: any = await r.json();
    const results: any[] = Array.isArray(j?.results) ? j.results : [];
    const seen = new Set<string>();
    const out: PdfAttachment[] = [];
    for (const a of results) {
      const mt = String(a?.mediaType ?? "");
      const title = String(a?.title ?? "").trim();
      if (!title || !mt.startsWith("application/pdf")) continue;
      // De-dupe by title (Confluence sometimes returns the same file twice)
      if (seen.has(title)) continue;
      seen.add(title);
      // Use the user-facing webui link so the user lands on the preview page
      // (their browser session authenticates) instead of the download URL
      // which their browser would auto-download.
      const webui = a?._links?.webui ?? a?.webuiLink;
      const url = webui
        ? `https://appdirect.jira.com/wiki${webui}`
        : `${baseUrl}${a?.downloadLink ?? ""}`;
      out.push({
        title,
        url,
        file_size: typeof a?.fileSize === "number" ? a.fileSize : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchPageImagesViaExportWord(
  pageId: string,
  baseUrl: string,
  email: string,
  apiToken: string,
): Promise<{
  ok: boolean;
  images: ExtractedImage[];
  http_status?: number;
  error?: string;
}> {
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/exportword?pageId=${encodeURIComponent(pageId)}`, {
      headers: {
        Authorization: `Basic ${auth}`,
        // Be explicit so Atlassian doesn't downgrade to HTML
        Accept: "multipart/related, message/rfc822, */*",
      },
    });
  } catch (err) {
    return {
      ok: false,
      images: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!resp.ok) {
    return {
      ok: false,
      images: [],
      http_status: resp.status,
      error: `exportword HTTP ${resp.status}`,
    };
  }

  const raw = Buffer.from(await resp.arrayBuffer());
  // 30 MB cap on Word export
  if (raw.length > 30 * 1024 * 1024) {
    return {
      ok: false,
      images: [],
      error: "exportword response too large",
    };
  }
  const headerEnd = raw.indexOf("\r\n\r\n");
  if (headerEnd < 0) {
    return { ok: false, images: [], error: "no MHTML headers" };
  }
  const headerStr = raw.subarray(0, headerEnd).toString("ascii");
  // Boundary may be quoted across a line wrap ("\r\n\tboundary=...")
  const boundaryMatch = headerStr.match(/boundary="?([^"\r\n]+)"?/i);
  if (!boundaryMatch) {
    return { ok: false, images: [], error: "no MIME boundary" };
  }
  const boundary = boundaryMatch[1].trim();
  const boundaryBuf = Buffer.from(`--${boundary}`);

  // Split the body on the boundary marker
  const body = raw.subarray(headerEnd + 4);
  const partRanges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < body.length) {
    const idx = body.indexOf(boundaryBuf, cursor);
    if (idx < 0) break;
    if (partRanges.length > 0) {
      partRanges[partRanges.length - 1].end = idx;
    }
    const partStart = idx + boundaryBuf.length;
    // Skip CRLF after the boundary marker
    const afterBoundary =
      body[partStart] === 0x0d && body[partStart + 1] === 0x0a
        ? partStart + 2
        : partStart;
    // Closing boundary is "--<boundary>--"
    if (body[partStart] === 0x2d && body[partStart + 1] === 0x2d) {
      break;
    }
    partRanges.push({ start: afterBoundary, end: body.length });
    cursor = afterBoundary;
  }

  const images: ExtractedImage[] = [];

  for (const range of partRanges) {
    const part = body.subarray(range.start, range.end);
    const partHeaderEnd = part.indexOf("\r\n\r\n");
    if (partHeaderEnd < 0) continue;
    const partHeaders = part.subarray(0, partHeaderEnd).toString("ascii");
    const partBody = part.subarray(partHeaderEnd + 4);

    // Skip the HTML part — only interested in binary attachments
    if (/Content-Type:\s*text\/html/i.test(partHeaders)) continue;

    const encMatch = partHeaders.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const encoding = (encMatch?.[1] ?? "").toLowerCase();

    let decoded: Buffer;
    if (encoding === "base64") {
      // Strip whitespace from base64 chunks (MHTML wraps lines at 76 chars)
      const b64 = partBody.toString("ascii").replace(/[\r\n\t ]+/g, "");
      try {
        decoded = Buffer.from(b64, "base64");
      } catch {
        continue;
      }
    } else if (encoding === "quoted-printable" || encoding === "" || encoding === "7bit" || encoding === "8bit") {
      decoded = partBody;
    } else {
      continue;
    }

    // Sniff the bytes — the part's declared Content-Type lies (often
    // application/octet-stream for what's actually a PNG).
    const mime = detectImageMime(decoded);
    if (!mime) continue;
    // 8 MB per-image cap
    if (decoded.length > 8 * 1024 * 1024) continue;

    const dataUrl = `data:${mime};base64,${decoded.toString("base64")}`;
    images.push({ dataUrl, mime, size: decoded.length });
  }

  return { ok: true, images };
}

// =============================================================================
// Multi-format text extraction (PDF / DOCX / XLSX) — all pure-JS, no native deps
// =============================================================================

/** Document kinds we can extract NOC contacts from (besides images). */
type ExtractableKind = "pdf" | "docx" | "xlsx" | "pptx";

interface ExtractableAttachment {
  /** Atlassian attachment ID (used by the v2 download endpoint). */
  id: string;
  title: string;
  kind: ExtractableKind;
  mediaType: string;
  /** Confluence URL the user can open in their browser session. */
  url: string;
  file_size?: number;
}

function attachmentKind(mediaType: string, title: string): ExtractableKind | null {
  const mt = (mediaType || "").toLowerCase();
  const tt = (title || "").toLowerCase();
  if (mt.startsWith("application/pdf") || tt.endsWith(".pdf")) return "pdf";
  if (
    mt.includes("officedocument.wordprocessingml.document") ||
    mt === "application/msword" ||
    tt.endsWith(".docx") ||
    tt.endsWith(".doc")
  )
    return "docx";
  if (
    mt.includes("officedocument.spreadsheetml.sheet") ||
    mt === "application/vnd.ms-excel" ||
    tt.endsWith(".xlsx") ||
    tt.endsWith(".xls") ||
    tt.endsWith(".csv")
  )
    return "xlsx";
  if (
    mt.includes("officedocument.presentationml") ||
    tt.endsWith(".pptx") ||
    tt.endsWith(".ppt")
  )
    return "pptx";
  return null;
}

/**
 * List every extractable (PDF / DOCX / XLSX / PPTX) attachment on a Confluence
 * page. Generalisation of `listPdfAttachments` — that one is kept for backward
 * compatibility with the existing UI `pdf_attachments` field.
 */
async function listExtractableAttachments(
  pageId: string,
  baseUrl: string,
  email: string,
  apiToken: string,
): Promise<ExtractableAttachment[]> {
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  try {
    const r = await fetch(
      `${baseUrl}/api/v2/pages/${encodeURIComponent(pageId)}/attachments`,
      { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } },
    );
    if (!r.ok) return [];
    const j: any = await r.json();
    const results: any[] = Array.isArray(j?.results) ? j.results : [];
    const seen = new Set<string>();
    const out: ExtractableAttachment[] = [];
    for (const a of results) {
      const id = String(a?.id ?? "").trim();
      const mt = String(a?.mediaType ?? "");
      const title = String(a?.title ?? "").trim();
      if (!id || !title) continue;
      const kind = attachmentKind(mt, title);
      if (!kind) continue;
      // Dedupe by title alone — same file uploaded twice (e.g. someone
      // re-attached the PDF without deleting the old one) shouldn't render
      // as two identical "Open" buttons in the UI.
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const webui = a?._links?.webui ?? a?.webuiLink;
      const url = webui
        ? `https://appdirect.jira.com/wiki${webui}`
        : `${baseUrl}${a?.downloadLink ?? ""}`;
      out.push({
        id,
        title,
        kind,
        mediaType: mt,
        url,
        file_size: typeof a?.fileSize === "number" ? a.fileSize : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Download a Confluence attachment's binary content using API-token Basic
 * auth. Uses the v2 download endpoint (`/api/v2/attachments/<id>/download`)
 * which — unlike the legacy `/download/attachments/...` path — DOES accept
 * API-token auth on Confluence Cloud and 302-redirects to a presigned S3 URL
 * that `fetch` follows automatically.
 */
async function downloadConfluenceAttachment(
  attachmentId: string,
  baseUrl: string,
  email: string,
  apiToken: string,
): Promise<Buffer | null> {
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  try {
    const r = await fetch(
      `${baseUrl}/api/v2/attachments/${encodeURIComponent(attachmentId)}/download`,
      {
        headers: { Authorization: `Basic ${auth}` },
        redirect: "follow",
      },
    );
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    // 25 MB cap (matches PDF cap)
    if (buf.length > 25 * 1024 * 1024) return null;
    if (buf.length === 0) return null;
    return buf;
  } catch {
    return null;
  }
}

/** Extract plain text from a PDF buffer (pdf-parse). */
async function extractPdfBufferText(buf: Buffer): Promise<string> {
  if (buf.slice(0, 4).toString() !== "%PDF") return "";
  try {
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const result = await parser.getText();
    return (result.text ?? "").trim();
  } catch {
    return "";
  }
}

/** Extract plain text from a Word .docx buffer (mammoth). */
async function extractDocxBufferText(buf: Buffer): Promise<string> {
  // .docx files are ZIP archives starting with "PK" (50 4B). Reject obviously
  // wrong magic bytes early so we don't waste time in mammoth.
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return "";
  try {
    const result = await mammoth.extractRawText({ buffer: buf });
    return (result.value ?? "").trim();
  } catch {
    return "";
  }
}

/**
 * Extract plain text from an Excel .xlsx buffer (xlsx). Each sheet is
 * serialized as CSV-style rows and labelled with the sheet name so the AI
 * can see workbook structure (e.g. "L1 contacts" sheet vs "Account team").
 */
function extractXlsxBufferText(buf: Buffer): string {
  if (buf.length < 4) return "";
  try {
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheets: string[] = [];
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      if (!sheet) continue;
      // sheet_to_csv with FS="," and blankrows=false produces clean rows.
      const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ",", blankrows: false });
      if (!csv.trim()) continue;
      sheets.push(`=== Sheet: ${name} ===\n${csv.trim()}`);
    }
    return sheets.join("\n\n");
  } catch {
    return "";
  }
}

/**
 * Top-level dispatcher: given any extractable buffer + its kind, return the
 * extracted plain text. Empty string on failure or unsupported kind.
 */
async function extractTextByKind(
  buf: Buffer,
  kind: ExtractableKind,
): Promise<string> {
  switch (kind) {
    case "pdf":
      return extractPdfBufferText(buf);
    case "docx":
      return extractDocxBufferText(buf);
    case "xlsx":
      return extractXlsxBufferText(buf);
    case "pptx":
      // Best-effort: pptx contains XML slides. mammoth-style extraction would
      // need a separate library (pptx2json). For now we punt — the user can
      // open the file from Confluence. The list_extractable_attachments call
      // still surfaces the file so the UI can offer an "Open in Confluence"
      // button.
      return "";
  }
}

/** Sniff a data URL or raw buffer's first bytes to identify its kind. */
function detectKindFromBytes(buf: Buffer, declaredMime?: string): ExtractableKind | "image" | null {
  // Image signatures (mirrors detectImageMime above)
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image"; // JPEG
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return "image"; // PNG
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38
  )
    return "image"; // GIF
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57
  )
    return "image"; // WEBP
  // PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)
    return "pdf";
  // ZIP-based Office formats (DOCX / XLSX / PPTX all start with PK)
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    // Disambiguate via declared MIME / filename hint
    const mt = (declaredMime || "").toLowerCase();
    if (mt.includes("spreadsheet") || mt.includes("excel")) return "xlsx";
    if (mt.includes("presentation") || mt.includes("powerpoint")) return "pptx";
    if (
      mt.includes("wordprocessing") ||
      mt.includes("word") ||
      mt === "application/msword"
    )
      return "docx";
    // No reliable signal — default to docx (mammoth) since carrier escalation
    // attachments are more often Word than Excel.
    return "docx";
  }
  return null;
}

/** Parse a `data:<mime>;base64,...` URL into { mime, buffer }. */
function parseDataUrl(dataUrl: string): { mime: string; buf: Buffer } | null {
  const m = /^data:([^;,]+)(?:;base64)?,(.*)$/i.exec(dataUrl);
  if (!m) return null;
  const mime = m[1];
  const isB64 = /;base64/i.test(dataUrl.slice(0, dataUrl.indexOf(",")));
  try {
    const buf = isB64
      ? Buffer.from(m[2], "base64")
      : Buffer.from(decodeURIComponent(m[2]), "utf8");
    return { mime, buf };
  } catch {
    return null;
  }
}

/**
 * Download a PDF from a public URL (no auth) and extract its text.
 * Returns null if anything goes wrong (bad URL, not a real PDF, parsing error).
 */
async function fetchAndExtractPdfText(url: string): Promise<{
  text: string;
  pages: number;
  bytes: number;
} | null> {
  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: {
        // Some CDNs reject default Node UA; advertise a generic UA.
        "User-Agent":
          "Mozilla/5.0 (compatible; NOCDashboard/1.0; +https://noc.appdirect.com)",
        Accept: "application/pdf,*/*",
      },
    });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    const buf = Buffer.from(await r.arrayBuffer());
    // Verify PDF signature
    if (buf.slice(0, 4).toString() !== "%PDF") return null;
    // 25 MB sanity cap so we never blow up extraction
    if (buf.length > 25 * 1024 * 1024) return null;
    void ct;
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const result = await parser.getText();
    const text = (result.text ?? "").trim();
    if (!text) return null;
    return {
      text,
      pages: result.pages?.length ?? 0,
      bytes: buf.length,
    };
  } catch {
    return null;
  }
}

/**
 * Look at a carrier page's HTML body for external `.pdf` URLs (e.g. the
 * carrier hosts their escalation list on their own marketing site).
 * Returns deduplicated absolute URLs.
 */
async function findPublicPdfUrlsOnPage(
  pageId: string,
  baseUrl: string,
  email: string,
  apiToken: string,
): Promise<string[]> {
  try {
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    const r = await fetch(
      `${baseUrl}/rest/api/content/${encodeURIComponent(pageId)}?expand=body.styled_view,body.view`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
      },
    );
    if (!r.ok) return [];
    const j: any = await r.json();
    const sv = j?.body?.styled_view?.value ?? "";
    const view = j?.body?.view?.value ?? "";
    const combined = `${sv}\n${view}`;
    // Match http(s) URLs ending in .pdf (optionally followed by ?query).
    // We're deliberately strict here: only literal .pdf endings count, never
    // generic page URLs (the AI prompt would not get useful data from those).
    const urls = new Set<string>();
    const re = /https?:\/\/[^\s"'<>)\\]+\.pdf(?:\?[^\s"'<>)\\]*)?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(combined)) !== null) {
      // Filter out anything pointing back at appdirect.jira.com (those need
      // session cookie auth, which we don't have)
      if (m[0].includes("appdirect.jira.com")) continue;
      urls.add(m[0]);
    }
    return Array.from(urls);
  } catch {
    return [];
  }
}

/**
 * Per-carrier hints for known escalation-tier conventions. Verizon (formerly
 * Frontier) uses "Level 6+" numbering for SLA Services escalation rather than
 * the usual L1/L2/L3 — the AI tends to invent L1/L2/L3 when it can't see tier
 * labels clearly, so we surface the carrier's actual convention here.
 */
const CARRIER_TIER_HINTS: Record<string, string> = {
  Verizon:
    "Verizon (and Verizon-acquired Frontier) SLA Services escalation tiers start at Level 6 and go up to Level 10. Do NOT use 'L1/L2/L3' — always use the exact level label shown on the page, which will be 'Level 6', 'Level 7', 'Level 8', 'Level 9', or 'Level 10'.",
  Frontier:
    "Frontier (now part of Verizon) SLA Services escalation tiers start at Level 6 and go up to Level 10. Do NOT use 'L1/L2/L3' — always use the exact level label shown on the page, which will be 'Level 6', 'Level 7', 'Level 8', 'Level 9', or 'Level 10'.",
};

const EXTRACTION_PROMPT_PREFIX = `You are extracting telecom carrier escalation contacts from one or more images attached to this message.

The images show a list/table of escalation contacts for a carrier. Your job is to extract ONLY the contacts that a NOC engineer would call for a service-impacting outage or ticket escalation.

CRITICAL RULES FOR LEVEL / TIER LABELS:
- Use the EXACT level label that appears in the source image/text. Do not normalize, renumber, or invent tier labels.
- If the source says "Level 6", return "Level 6" (NOT "L1" or "Tier 1").
- If the source says "Tier 1", return "Tier 1" (NOT "L1" or "Level 1").
- Different carriers use different numbering schemes (some start at L1, some at L6, some use M1/M2, some use "1st/2nd/3rd Level"). Always preserve what the source actually says.
- If you can read a name/phone/email but cannot clearly identify the level label for that row, set level to null. NEVER guess at tier numbers.

INCLUDE contacts whose role is one of:
- NOC / Network Operations Center (any tier or level)
- Customer Support / Technical Support / Tech Support
- Service Assurance / Service Desk / Repair / Maintenance Operations
- Field Operations / Outside Plant Engineering (OSPE) / Dispatch
- On-Call Engineer / On-Duty Manager / Escalation Manager (if escalation is for a technical outage)
- NOC Director / Director of Operations / VP of Operations (if listed in the escalation chain)

EXCLUDE — do NOT extract these even if they appear in the same image:
- Sales / Account Manager / Account Executive / Customer Success Manager
- Billing / Finance / Accounts Receivable / Collections
- General executives (CEO, CFO, CMO, etc.) unless they're explicitly named in a NOC escalation chain
- Partner-relations / channel / wholesale-sales contacts
- Marketing / PR / Legal contacts
- Generic "info@" / "sales@" / "marketing@" inboxes

If you're unsure whether a row is a NOC escalation contact or a sales/AM contact, EXCLUDE it. False positives are worse than false negatives here.

Each extracted contact has some of:
- A level / tier (e.g. "L1", "L2", "L3", "Tier 1", "M1", "1st Level", "On-Call")
- A name (person's full name; null for a team mailbox like "NOC Team")
- A role / job title (e.g. "NOC Manager", "Support Engineer", "Escalation Lead")
- A phone number (keep original formatting, including extensions / options)
- An email address

Return ONLY a JSON object with this exact shape, no markdown fences, no surrounding commentary:

{
  "contacts": [
    { "level": "L1", "name": "Jane Doe", "role": "NOC Manager", "phone": "1-800-555-0001", "email": "jane@example.com" }
  ]
}

Rules:
- Use null for any field you can't read.
- Read EVERY visible NOC-related row in the image — never skip a qualifying contact.
- Keep phone numbers in their original format (including suffixes like "Option 2", "ext. 123").
- If the image isn't a contact list (e.g. a logo, a network diagram, a blank attachment thumbnail), return {"contacts": []}.
- Do not invent contacts. If the image is blurry or partially unreadable, include what you can read and leave the rest null.
- If a row clearly belongs to a sales/AM/billing role, OMIT it from the output entirely.

Carrier: `;

/**
 * Build the full extraction prompt for a given carrier, appending any
 * carrier-specific tier hint we know about. Used by both the image (vision)
 * and PDF-text extraction paths so they stay in sync.
 */
function buildExtractionPrompt(carrierName: string): string {
  // Match Verizon / Frontier hints. Carrier names may include suffixes like
  // "Verizon Wholesale" or "Verizon (Frontier)" so do substring matching.
  let hint = "";
  for (const [needle, h] of Object.entries(CARRIER_TIER_HINTS)) {
    if (carrierName.toLowerCase().includes(needle.toLowerCase())) {
      hint = h;
      break;
    }
  }
  if (hint) {
    return `${EXTRACTION_PROMPT_PREFIX}${carrierName}\n\nIMPORTANT — CARRIER-SPECIFIC TIER NUMBERING:\n${hint}`;
  }
  return EXTRACTION_PROMPT_PREFIX + carrierName;
}

/**
 * Heuristic post-filter. Even with the prompt above, vision models occasionally
 * include a sales/AM row from a table that has both NOC and AM contacts. This
 * second pass drops any contact whose role or email obviously belongs to a
 * non-NOC function. Conservative — when in doubt, KEEP the contact.
 */
const NON_NOC_ROLE_PATTERNS = [
  /\bsales\b/i,
  /\baccount\s+(manager|executive|director|rep)/i,
  /\b(am|cse|csm|ae)\b/i,
  /\bcustomer\s+success\b/i,
  /\bbilling\b/i,
  /\bfinance\b/i,
  /\bcollections?\b/i,
  /\b(accounts?\s+receivable|payable)\b/i,
  /\bchannel\b/i,
  /\bpartner(s|ship)?\b/i,
  /\bmarketing\b/i,
  /\b(public\s+relations|pr)\b/i,
  /\blegal\b/i,
  /\bgeneral\s+counsel\b/i,
  /\b(ceo|cfo|cmo|coo|cto)\b/i,
];

const NON_NOC_EMAIL_LOCAL_PATTERNS = [
  /^sales(@|\.)/i,
  /^info(@|\.)/i,
  /^marketing(@|\.)/i,
  /^billing(@|\.)/i,
  /^accounts?(receivable|payable)?(@|\.)/i,
  /^channel(@|\.)/i,
  /^partner(s)?(@|\.)/i,
  /^pr(@|\.)/i,
  /^legal(@|\.)/i,
];

function isNocRelatedContact(c: ParsedContact): boolean {
  const role = (c.role ?? "").trim();
  const email = (c.email ?? "").trim().toLowerCase();
  // Reject by role
  if (role) {
    for (const re of NON_NOC_ROLE_PATTERNS) {
      if (re.test(role)) return false;
    }
  }
  // Reject by email local-part (the bit before @)
  if (email) {
    const localPart = email.split("@")[0] ?? "";
    for (const re of NON_NOC_EMAIL_LOCAL_PATTERNS) {
      if (re.test(localPart + "@")) return false;
    }
  }
  return true;
}

async function extractContactsFromImages(
  env: Record<string, string>,
  carrier: { id: string; carrier: string },
  /**
   * Either a list of data URLs already provided by the client (manual upload
   * path) or a list of Confluence-hosted image URLs to try to download.
   */
  source:
    | { kind: "data_urls"; data_urls: string[] }
    | {
        kind: "confluence_urls";
        urls: string[];
        baseUrl: string;
        email: string;
        apiToken: string;
      },
): Promise<ExtractionResult> {
  const apiKey = env.AI_API_KEY;
  const platformUrl = env.AI_PLATFORM_URL || "https://devs.ai";
  const agentId = env.AI_AGENT_ID || "auto";

  if (!apiKey) {
    return {
      source: "ai-vision",
      carrier_id: carrier.id,
      carrier: carrier.carrier,
      contacts: [],
      image_count: 0,
      cached: false,
      extracted_at: new Date().toISOString(),
      warning: "AI_API_KEY not set in .env — cannot run AI extraction.",
    };
  }

  // Resolve to a list of base64 data URLs we can ship to the AI.
  let dataUrls: string[] = [];
  let downloadAuthFailed = false;
  if (source.kind === "data_urls") {
    dataUrls = source.data_urls.slice(0, 4);
  } else {
    const limited = source.urls.slice(0, 4);
    for (const url of limited) {
      const d = await downloadImageAsDataUrl(
        url,
        source.baseUrl,
        source.email,
        source.apiToken,
      );
      if (d) dataUrls.push(d.dataUrl);
      else downloadAuthFailed = true;
    }
  }

  if (dataUrls.length === 0) {
    return {
      source: "ai-vision",
      carrier_id: carrier.id,
      carrier: carrier.carrier,
      contacts: [],
      image_count: 0,
      cached: false,
      extracted_at: new Date().toISOString(),
      warning: downloadAuthFailed
        ? "Confluence's image-download endpoint doesn't accept API-token auth, so the image couldn't be fetched automatically. Use the 'Upload image' option to paste the screenshot from Confluence directly."
        : "No images to extract from.",
    };
  }

  // Build multimodal content
  const content: any[] = [
    { type: "text", text: buildExtractionPrompt(carrier.carrier) },
  ];
  for (const url of dataUrls) {
    content.push({ type: "image_url", image_url: { url } });
  }

  // Call Devs.ai with streaming, accumulate to one string.
  let rawText = "";
  try {
    const r = await fetch(`${platformUrl}/api/v1/chats/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: agentId,
        messages: [{ role: "user", content }],
        stream: true,
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`AI HTTP ${r.status}: ${body.slice(0, 200)}`);
    }
    if (!r.body) throw new Error("AI response had no body");
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (currentEvent === "message.delta") {
            try {
              const parsed = JSON.parse(data);
              const t = parsed.content?.text;
              if (typeof t === "string") rawText += t;
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  } catch (err) {
    return {
      source: "ai-vision",
      carrier_id: carrier.id,
      carrier: carrier.carrier,
      contacts: [],
      image_count: dataUrls.length,
      cached: false,
      extracted_at: new Date().toISOString(),
      warning: `AI extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Strip markdown fences if present, then parse JSON
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed: any = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to find a JSON-shaped substring as a last resort
    const m = /\{[\s\S]*\}/.exec(cleaned);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        /* still bad */
      }
    }
  }

  const rawContacts: any[] = Array.isArray(parsed?.contacts) ? parsed.contacts : [];
  const parsedContacts: ParsedContact[] = rawContacts
    .map((c: any, i: number) => ({
      level: String(c.level ?? c.tier ?? c.Level ?? `Row ${i + 1}`).trim(),
      name: c.name ? String(c.name).trim() : undefined,
      role: c.role ?? c.title ? String(c.role ?? c.title).trim() : undefined,
      phone: c.phone ? String(c.phone).trim() : undefined,
      email: c.email ? String(c.email).trim() : undefined,
      notes: c.notes ? String(c.notes).trim() : undefined,
    }))
    .filter((c) => c.name || c.email || c.phone || c.role);

  // Server-side safety net: drop any contact that obviously belongs to a
  // sales/AM/billing/exec function even if the prompt didn't catch it.
  const beforeFilter = parsedContacts.length;
  const contacts = parsedContacts.filter(isNocRelatedContact);
  const droppedCount = beforeFilter - contacts.length;

  return {
    source: "ai-vision",
    carrier_id: carrier.id,
    carrier: carrier.carrier,
    contacts,
    raw_text: rawText.slice(0, 4000),
    image_count: dataUrls.length,
    cached: false,
    extracted_at: new Date().toISOString(),
    warning:
      contacts.length === 0
        ? beforeFilter > 0
          ? `Image had ${beforeFilter} contact(s) but none looked like NOC / customer-support roles — likely a sales / account-management list.`
          : "AI returned no contacts. The image may not be a contact list, or it was unreadable."
        : droppedCount > 0
          ? `Filtered out ${droppedCount} non-NOC contact${droppedCount === 1 ? "" : "s"} (sales / AM / billing).`
          : undefined,
  };
}

/**
 * Same shape as `extractContactsFromImages`, but the AI input is plain text
 * extracted from a PDF (no vision required). Re-uses the same NOC-only
 * prompt + post-filter. Each PDF source is identified by a short label so
 * the response can attribute the result.
 */
async function extractContactsFromText(
  env: Record<string, string>,
  carrier: { id: string; carrier: string },
  pdfText: string,
  sourceLabel: string,
): Promise<ExtractionResult> {
  const apiKey = env.AI_API_KEY;
  const platformUrl = env.AI_PLATFORM_URL || "https://devs.ai";
  const agentId = env.AI_AGENT_ID || "auto";

  if (!apiKey) {
    return {
      source: "ai-vision",
      carrier_id: carrier.id,
      carrier: carrier.carrier,
      contacts: [],
      image_count: 0,
      cached: false,
      extracted_at: new Date().toISOString(),
      warning: "AI_API_KEY not set in .env — cannot run AI extraction.",
    };
  }

  // Cap text to ~80 KB to keep prompts within model limits.
  // Most carrier escalation PDFs are under 10 KB of extracted text.
  const truncated = pdfText.slice(0, 80_000);

  const prompt = `${EXTRACTION_PROMPT_PREFIX}${carrier.carrier}

The data below is the plain-text extraction of a PDF document titled "${sourceLabel}" published by the carrier. Apply the same NOC-only filtering rules described above.

---
${truncated}
---

Return ONLY the JSON object. Start your response with "{" — no preamble.`;

  let rawText = "";
  try {
    const r = await fetch(`${platformUrl}/api/v1/chats/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: agentId,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`AI HTTP ${r.status}: ${body.slice(0, 200)}`);
    }
    if (!r.body) throw new Error("AI response had no body");
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (currentEvent === "message.delta") {
            try {
              const parsed = JSON.parse(data);
              const t = parsed.content?.text;
              if (typeof t === "string") rawText += t;
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  } catch (err) {
    return {
      source: "ai-vision",
      carrier_id: carrier.id,
      carrier: carrier.carrier,
      contacts: [],
      image_count: 0,
      cached: false,
      extracted_at: new Date().toISOString(),
      warning: `AI extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Same JSON parsing + NOC filter as extractContactsFromImages
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed: any = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = /\{[\s\S]*\}/.exec(cleaned);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        /* still bad */
      }
    }
  }

  const rawContacts: any[] = Array.isArray(parsed?.contacts) ? parsed.contacts : [];
  const parsedContacts: ParsedContact[] = rawContacts
    .map((c: any, i: number) => ({
      level: String(c.level ?? c.tier ?? c.Level ?? `Row ${i + 1}`).trim(),
      name: c.name ? String(c.name).trim() : undefined,
      role: c.role ?? c.title ? String(c.role ?? c.title).trim() : undefined,
      phone: c.phone ? String(c.phone).trim() : undefined,
      email: c.email ? String(c.email).trim() : undefined,
      notes: c.notes ? String(c.notes).trim() : undefined,
    }))
    .filter((c) => c.name || c.email || c.phone || c.role);

  const beforeFilter = parsedContacts.length;
  const contacts = parsedContacts.filter(isNocRelatedContact);
  const droppedCount = beforeFilter - contacts.length;

  return {
    source: "ai-vision",
    carrier_id: carrier.id,
    carrier: carrier.carrier,
    contacts,
    raw_text: rawText.slice(0, 4000),
    image_count: 0,
    cached: false,
    extracted_at: new Date().toISOString(),
    warning:
      contacts.length === 0
        ? beforeFilter > 0
          ? `PDF had ${beforeFilter} contact(s) but none looked like NOC / customer-support roles.`
          : `AI returned no contacts from PDF "${sourceLabel}".`
        : droppedCount > 0
          ? `Filtered out ${droppedCount} non-NOC contact${droppedCount === 1 ? "" : "s"} (sales / AM / billing).`
          : undefined,
  };
}

// ----------------------------------------------------------------------------
// Vite plugin
// ----------------------------------------------------------------------------

export function confluenceProxyPlugin(): Plugin {
  let env: Record<string, string> = {};
  return {
    name: "confluence-proxy",
    configureServer(server) {
      env = loadEnv("development", process.cwd(), "");

      server.middlewares.use(
        "/api/confluence/escalations",
        async (_req, res) => {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");

          try {
            const baseUrl = env.CONFLUENCE_BASE_URL || BASE;
            const email = env.CONFLUENCE_USER_EMAIL || "";
            const token = env.CONFLUENCE_API_TOKEN || "";

            let carriers = SNAPSHOT.map(entryToResponse);
            let source: "live" | "snapshot" = "snapshot";
            let warning: string | null =
              "Confluence credentials not set in .env — showing snapshot with bundled body content. Set CONFLUENCE_USER_EMAIL + CONFLUENCE_API_TOKEN to scrape full live bodies.";

            if (email && token) {
              try {
                const live = await fetchLive(baseUrl, email, token);
                if (live.length > 0) {
                  carriers = live.map(entryToResponse);
                  source = "live";
                  warning = null;
                }
              } catch (err) {
                warning = `Confluence fetch failed, falling back to snapshot: ${err instanceof Error ? err.message : String(err)}`;
              }
            }

            carriers.sort((a, b) => a.carrier.localeCompare(b.carrier));

            res.end(
              JSON.stringify({
                source,
                space: SPACE_KEY,
                folder_id: FOLDER_ID,
                folder_title: FOLDER_TITLE,
                folder_url: FOLDER_URL,
                fetched_at: new Date().toISOString(),
                carriers,
                warning,
              }),
            );
          } catch (err) {
            res.statusCode = 500;
            res.end(
              JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        },
      );

      // -----------------------------------------------------------------
      // POST /api/confluence/extract-images
      // Body: { carrier_id: string, refresh?: boolean }
      // Re-fetches the carrier's page, downloads the inline image(s), and
      // asks the Devs.ai agent to extract structured contacts via OCR.
      // Cached per carrier for 1 hour.
      // -----------------------------------------------------------------
      server.middlewares.use(
        "/api/confluence/extract-images",
        async (req, res) => {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Allow", "POST");
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
          }
          try {
            // Read raw body — could be large if image data URLs are included
            const chunks: Buffer[] = [];
            let total = 0;
            for await (const c of req) {
              chunks.push(c);
              total += c.length;
              // Cap at 40 MB to prevent runaway uploads
              if (total > 40 * 1024 * 1024) {
                res.statusCode = 413;
                res.end(JSON.stringify({ error: "Request body too large" }));
                return;
              }
            }
            const rawBody = Buffer.concat(chunks).toString("utf8");
            const body = rawBody ? JSON.parse(rawBody) : {};
            const carrierId = String(body.carrier_id ?? "").trim();
            const forceRefresh = !!body.refresh;
            const carrierNameOverride =
              typeof body.carrier_name === "string" ? body.carrier_name.trim() : "";

            // Accept both legacy `image_data_urls` (string[]) AND new
            // `file_uploads` (Array<{ name, data_url }>) — the latter
            // supports PDF / DOCX / XLSX uploads in addition to images.
            const legacyImageUrls: string[] = Array.isArray(body.image_data_urls)
              ? body.image_data_urls
                  .filter(
                    (u: any) => typeof u === "string" && u.startsWith("data:image/"),
                  )
                  .slice(0, 4)
              : [];
            const rawFileUploads: Array<{ name: string; data_url: string }> =
              Array.isArray(body.file_uploads)
                ? body.file_uploads
                    .filter(
                      (f: any) =>
                        f &&
                        typeof f.data_url === "string" &&
                        f.data_url.startsWith("data:"),
                    )
                    .map((f: any) => ({
                      name: String(f.name ?? "upload").trim() || "upload",
                      data_url: f.data_url as string,
                    }))
                    .slice(0, 6)
                : [];

            // Combine legacy + new upload shapes into a single sniffed list.
            const allUploads: Array<{
              name: string;
              data_url: string;
              mime: string;
              kind: ExtractableKind | "image" | null;
            }> = [];
            for (const u of legacyImageUrls) {
              const parsed = parseDataUrl(u);
              allUploads.push({
                name: "image",
                data_url: u,
                mime: parsed?.mime ?? "image/png",
                kind: parsed ? detectKindFromBytes(parsed.buf, parsed.mime) : "image",
              });
            }
            for (const f of rawFileUploads) {
              const parsed = parseDataUrl(f.data_url);
              if (!parsed) continue;
              allUploads.push({
                name: f.name,
                data_url: f.data_url,
                mime: parsed.mime,
                kind: detectKindFromBytes(parsed.buf, parsed.mime),
              });
            }

            const hasUploads = allUploads.length > 0;

            if (!carrierId && !hasUploads) {
              res.statusCode = 400;
              res.end(
                JSON.stringify({
                  error:
                    "carrier_id or file_uploads (image / PDF / Word / Excel) is required",
                }),
              );
              return;
            }

            // Cache check (only for auto-fetch path keyed by carrier_id;
            // manual uploads always run fresh)
            const useCache = !forceRefresh && !hasUploads && carrierId;
            if (useCache) {
              const cached = extractionCache.get(carrierId);
              if (
                cached &&
                Date.now() - cached.cached_at < EXTRACT_TTL_MS
              ) {
                res.end(
                  JSON.stringify({
                    ...cached.result,
                    cached: true,
                  }),
                );
                return;
              }
            }

            // -------- Manual upload path: dispatch by file type --------
            // Images → AI vision. PDF / DOCX / XLSX → text extraction →
            // same NOC-only AI prompt. PPTX is acknowledged but not
            // extracted (no canonical pure-JS pptx text extractor).
            if (hasUploads) {
              const carrierLabel = {
                id: carrierId || "uploaded",
                carrier: carrierNameOverride || carrierId || "uploaded files",
              };
              const imageUploads = allUploads.filter((u) => u.kind === "image");
              const docUploads = allUploads.filter(
                (u) => u.kind === "pdf" || u.kind === "docx" || u.kind === "xlsx",
              );
              const unsupported = allUploads.filter(
                (u) => u.kind === null || u.kind === "pptx",
              );

              // Pull text out of every PDF/DOCX/XLSX upload, label by file name
              const docTexts: Array<{ name: string; text: string }> = [];
              for (const u of docUploads) {
                const parsed = parseDataUrl(u.data_url);
                if (!parsed) continue;
                const text = await extractTextByKind(
                  parsed.buf,
                  u.kind as ExtractableKind,
                );
                if (text && text.length > 30) {
                  docTexts.push({ name: u.name, text });
                }
              }

              // Strategy:
              //   - If any documents yielded extractable text, run a single
              //     text-mode extraction with all docs concatenated. This
              //     handles mixed uploads (e.g. a Word doc + an Excel
              //     spreadsheet) in one round-trip.
              //   - If only images were uploaded (or text extraction failed),
              //     fall through to vision-mode extraction.
              let result: ExtractionResult | null = null;
              if (docTexts.length > 0) {
                const combinedLabel = docTexts.map((d) => d.name).join(", ");
                const combinedText = docTexts
                  .map((d) => `=== File: ${d.name} ===\n${d.text}`)
                  .join("\n\n");
                result = await extractContactsFromText(
                  env,
                  carrierLabel,
                  combinedText,
                  combinedLabel,
                );
                // If we ALSO have images, ask vision to extract from them
                // too and merge — sometimes the document has the table of
                // contents and the image has the actual matrix.
                if (imageUploads.length > 0) {
                  const visionResult = await extractContactsFromImages(
                    env,
                    carrierLabel,
                    {
                      kind: "data_urls",
                      data_urls: imageUploads.map((u) => u.data_url),
                    },
                  );
                  if (visionResult.contacts.length > 0) {
                    // Dedupe roughly by (level + name + email).
                    const seen = new Set(
                      result.contacts.map(
                        (c) =>
                          `${c.level}|${c.name ?? ""}|${(c.email ?? "").toLowerCase()}`,
                      ),
                    );
                    for (const c of visionResult.contacts) {
                      const k = `${c.level}|${c.name ?? ""}|${(c.email ?? "").toLowerCase()}`;
                      if (!seen.has(k)) {
                        result.contacts.push(c);
                        seen.add(k);
                      }
                    }
                  }
                }
              } else if (imageUploads.length > 0) {
                result = await extractContactsFromImages(env, carrierLabel, {
                  kind: "data_urls",
                  data_urls: imageUploads.map((u) => u.data_url),
                });
              } else {
                // All uploads were unsupported (or text extraction failed
                // for every doc). Return a clear warning.
                result = {
                  source: "ai-vision",
                  carrier_id: carrierLabel.id,
                  carrier: carrierLabel.carrier,
                  contacts: [],
                  image_count: 0,
                  cached: false,
                  extracted_at: new Date().toISOString(),
                  warning:
                    unsupported.length > 0
                      ? `Could not extract text from ${unsupported.length} file(s). Supported formats: PNG, JPEG, GIF, WebP, PDF, DOCX, XLSX.`
                      : "No readable text found in the uploaded file(s).",
                };
              }

              // Cache successful manual extractions too (keyed by carrier)
              if (carrierId && result.contacts.length > 0) {
                extractionCache.set(carrierId, {
                  result,
                  cached_at: Date.now(),
                });
              }
              res.end(JSON.stringify(result));
              return;
            }

            // -------- Auto-fetch path via Word export --------
            // /wiki/download/attachments/... rejects API-token auth on
            // Cloud, but /wiki/exportword?pageId=... accepts it AND inlines
            // every image as base64 in the MHTML response. We parse those
            // out and run the AI extraction on them.
            const liveEmail = env.CONFLUENCE_USER_EMAIL?.trim();
            const liveToken = env.CONFLUENCE_API_TOKEN?.trim();
            if (!liveEmail || !liveToken) {
              res.statusCode = 400;
              res.end(
                JSON.stringify({
                  error:
                    "CONFLUENCE_USER_EMAIL and CONFLUENCE_API_TOKEN must be set in .env for auto-extract.",
                }),
              );
              return;
            }

            // Look up carrier metadata from the live folder listing so we
            // can label the AI prompt with the real carrier name.
            let carrierName = carrierNameOverride;
            if (!carrierName) {
              try {
                const live = await fetchLive(env, false);
                const found = live.carriers.find((c) => c.id === carrierId);
                carrierName = found?.carrier ?? carrierId;
              } catch {
                carrierName = carrierId;
              }
            }

            // Fetch images via exportword AND list every extractable
            // attachment (PDF / DOCX / XLSX / PPTX) in parallel. We want
            // to surface attachments in the response either way so the UI
            // can offer "Open in Confluence" links as a backup.
            const [fetchResult, allAttachments] = await Promise.all([
              fetchPageImagesViaExportWord(carrierId, BASE, liveEmail, liveToken),
              listExtractableAttachments(carrierId, BASE, liveEmail, liveToken),
            ]);
            const pdfAttachments: PdfAttachment[] = allAttachments
              .filter((a) => a.kind === "pdf")
              .map((a) => ({
                title: a.title,
                url: a.url,
                file_size: a.file_size,
              }));

            if (!fetchResult.ok) {
              res.statusCode = 502;
              res.end(
                JSON.stringify({
                  error: `Could not fetch images from Confluence: ${fetchResult.error ?? "unknown error"}`,
                  http_status: fetchResult.http_status,
                  pdf_attachments: pdfAttachments,
                  attachments: allAttachments.map((a) => ({
                    title: a.title,
                    url: a.url,
                    kind: a.kind,
                    file_size: a.file_size,
                  })),
                }),
              );
              return;
            }

            // Filter out tiny thumbnails (< 10 KB or < 400 px on the long
            // side) — these are auto-generated PDF preview icons that don't
            // contain readable contact data, just noise for the AI.
            const usableImages = fetchResult.images.filter(
              (img) => img.size >= 10 * 1024,
            );

            // -------- Stage 1: try inline-image AI vision extraction --------
            let result: ExtractionResult | null = null;
            if (usableImages.length > 0) {
              result = await extractContactsFromImages(
                env,
                { id: carrierId, carrier: carrierName },
                {
                  kind: "data_urls",
                  data_urls: usableImages.map((i) => i.dataUrl),
                },
              );
            }

            // -------- Stage 2: PDF text extraction (public URL fallback) --------
            // If image extraction got us nothing (no usable images OR zero
            // contacts), try to find a publicly-hosted PDF URL on the page
            // (e.g. the carrier mirrors its escalation list on their own
            // marketing site). Download it without auth, extract text via
            // pdf-parse, and run the same NOC-only AI prompt on the text.
            if (!result || result.contacts.length === 0) {
              const publicPdfUrls = await findPublicPdfUrlsOnPage(
                carrierId,
                BASE,
                liveEmail,
                liveToken,
              );
              for (const pdfUrl of publicPdfUrls.slice(0, 3)) {
                const pdf = await fetchAndExtractPdfText(pdfUrl);
                if (!pdf || pdf.text.length < 100) continue;
                const label = pdfUrl.split("/").pop() ?? "escalation.pdf";
                const pdfResult = await extractContactsFromText(
                  env,
                  { id: carrierId, carrier: carrierName },
                  pdf.text,
                  label,
                );
                if (pdfResult.contacts.length > 0) {
                  // Re-shape: report image_count=0 since we extracted from PDF text,
                  // but use a more descriptive warning that mentions the PDF source.
                  result = {
                    ...pdfResult,
                    warning: pdfResult.warning
                      ? pdfResult.warning + ` (from public PDF: ${label})`
                      : `Extracted from public PDF: ${label}`,
                  };
                  break;
                }
                // Even if zero contacts from this PDF, remember it as a
                // candidate so we don't lose track of attempted sources.
                if (!result) result = pdfResult;
              }
            }

            // -------- Stage 2.5: Confluence-attached PDF / DOCX / XLSX --------
            // INTENTIONALLY DISABLED for auto-extract. Atlassian Cloud
            // routes ALL attachment binary downloads through the Media API,
            // which only accepts OAuth 2.0 / Forge / browser-session auth.
            // An API token (the only credential we have server-side) can
            // *list* attachments via /api/v2/pages/<id>/attachments, but
            // every download URL — /api/v2/attachments/<id>/download,
            // /wiki/download/attachments/..., /rest/api/content/<id>/data,
            // and Media API endpoints — returns 401 or 404 for API-token
            // Basic auth. Verified by direct probing 2026-05-20.
            //
            // Workaround paths (handled by the UI, not here):
            //   1. The user clicks "Open in Confluence" on the attachment,
            //      which uses their browser session cookie to authenticate
            //      and renders the file inline in Confluence's viewer.
            //   2. The user downloads the file from Confluence in their
            //      browser, then re-uploads it via the widget's "Upload
            //      file" button. The /api/confluence/extract-images
            //      endpoint's manual-upload path accepts PDF/DOCX/XLSX
            //      bytes from the client and runs the same NOC AI prompt
            //      against the extracted text.
            //
            // We still surface `allAttachments` to the UI below so the user
            // sees what's on the page and can pick a path forward.

            // -------- Stage 3: graceful fallback if all stages failed --------
            if (!result) {
              const attachmentSummary = (() => {
                const counts: Record<string, number> = {};
                for (const a of allAttachments) {
                  counts[a.kind] = (counts[a.kind] ?? 0) + 1;
                }
                const parts: string[] = [];
                if (counts.pdf) parts.push(`${counts.pdf} PDF`);
                if (counts.docx) parts.push(`${counts.docx} Word doc`);
                if (counts.xlsx) parts.push(`${counts.xlsx} Excel`);
                if (counts.pptx) parts.push(`${counts.pptx} PowerPoint`);
                return parts.join(", ");
              })();
              const warning =
                allAttachments.length > 0
                  ? `Contacts live in ${attachmentSummary} attachment that Atlassian only lets your browser session download (API tokens can't fetch it). Click the attachment below to view it in Confluence, or download it and use "Upload file" to extract contacts here.`
                  : fetchResult.images.length > 0
                    ? "Only small thumbnail images were found on this page — not the full contact list."
                    : "Confluence page exported successfully but no extractable contacts were found.";
              result = {
                source: "ai-vision",
                carrier_id: carrierId,
                carrier: carrierName,
                contacts: [],
                image_count: 0,
                cached: false,
                extracted_at: new Date().toISOString(),
                warning,
              };
            }

            // Surface every extractable attachment in the response — useful
            // as a backup source link whether or not auto-extract succeeded.
            // We still populate the legacy `pdf_attachments` field for back-
            // compat with anything that hasn't migrated yet.
            if (allAttachments.length > 0) {
              result.attachments = allAttachments.map((a) => ({
                title: a.title,
                url: a.url,
                kind: a.kind,
                file_size: a.file_size,
              }));
              if (pdfAttachments.length > 0) {
                result.pdf_attachments = pdfAttachments;
              }
            }

            // Cache successful auto-extractions
            if (result.contacts.length > 0) {
              extractionCache.set(carrierId, {
                result,
                cached_at: Date.now(),
              });
            }
            res.end(JSON.stringify(result));
            return;
          } catch (err) {
            res.statusCode = 500;
            res.end(
              JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        },
      );
    },
  };
}
