import type { CarrierEscalation, EscalationContact } from "./confluence";

/**
 * Common alias / sub-brand / acquired-by mappings for the carriers in the
 * Confluence QS Escalation list. When notes mention any of the aliases the
 * matcher will resolve to the canonical carrier.
 *
 * Keys are LOWERCASED. Values are the canonical carrier short-name as it
 * appears in the Confluence `carrier` field.
 *
 * Add entries here whenever new carrier nicknames show up in the notes that
 * the simple word-match wouldn't otherwise find.
 */
const CARRIER_ALIASES: Record<string, string> = {
  // CenturyLink → Lumen rebrand (2020). Notes still say "CenturyLink"
  // frequently — and circuit IDs / portal names still carry "CTL".
  centurylink: "Lumen",
  ctl: "Lumen",
  "century link": "Lumen",
  qwest: "Lumen", // legacy ILEC inside Lumen
  level3: "Lumen",
  "level 3": "Lumen",
  l3: "Lumen",

  // Comcast Business
  xfinity: "Comcast",
  bnoc: "Comcast", // Comcast's "Business NOC" team
  "comcast business": "Comcast",
  ccs: "Comcast", // ccs_noc@comcast.com etc.

  // AT&T
  att: "AT&T APEX",
  "at&t": "AT&T APEX",
  "att apex": "AT&T APEX",
  "at and t": "AT&T APEX",
  apex: "AT&T APEX",
  sbc: "AT&T APEX", // legacy

  // Verizon family (Frontier was acquired by Verizon)
  vz: "Verizon",
  verizon: "Verizon",
  vzb: "Verizon",
  ftr: "Frontier (Verizon)",
  frontier: "Frontier (Verizon)",

  // Charter / Spectrum
  charter: "Spectrum",
  "spectrum business": "Spectrum",
  "spectrum enterprise": "Spectrum",
  twc: "Spectrum", // Time Warner Cable (now Spectrum)
  "time warner": "Spectrum",

  // Zayo / CrownCastle Fiber. CrownCastle Fiber's network was sold to
  // Zayo (2024), so notes saying either "Zayo" or "Crown Castle" route to
  // CrownCastle Fiber (Zayo) — the carrier entry that has the actual NOC
  // contacts in our Confluence list. (The plain "Zayo" entry in Confluence
  // is currently empty of contacts.)
  zayo: "CrownCastle Fiber (Zayo)",
  crowncastle: "CrownCastle Fiber (Zayo)",
  "crown castle": "CrownCastle Fiber (Zayo)",
  "cc fiber": "CrownCastle Fiber (Zayo)",

  // Cox
  cox: "Cox",
  "cox business": "Cox",

  // Granite
  granite: "Granite",

  // Nitel
  nitel: "Nitel",

  // AireSpring
  airespring: "AireSpring",
  aire: "AireSpring",

  // Astound (was RCN / Wave / Grande)
  astound: "Astound Wholesale",
  rcn: "Astound Wholesale",
  wave: "Astound Wholesale",
  grande: "Astound Wholesale",

  // GTT
  gtt: "GTT",

  // Ziply (was Frontier's NW assets, now independent)
  ziply: "Ziply Fiber",
  "ziply fiber": "Ziply Fiber",
};

export interface CarrierMatch {
  /** The matched carrier from the Confluence list. */
  carrier: CarrierEscalation;
  /** The exact substring from the notes that triggered the match. */
  matched_term: string;
  /**
   * `"exact"` — the carrier's own `carrier` field appeared as a word in the
   *   notes (the most confident match).
   * `"alias"` — a known alias (CenturyLink → Lumen, etc.) matched.
   * `"title"` — the carrier's full page title was matched (last-resort).
   */
  source: "exact" | "alias" | "title";
}

/**
 * Find the best carrier match for a chunk of free-form notes against the
 * loaded Confluence carrier list. Returns `null` if nothing plausible matches.
 *
 * Strategy:
 *   1. Build a list of (alias_term → canonical_carrier_name) entries from
 *      both the alias table AND each carrier's own `carrier` field.
 *   2. Sort terms longest-first so multi-word aliases ("Comcast Business",
 *      "Spectrum Enterprise", "AT&T APEX") match before their single-word
 *      substrings.
 *   3. Word-boundary match each term against the lowercased notes.
 *   4. Take the FIRST (i.e. longest, most-specific) hit.
 *
 * Falls back to fuzzy title contains-match if no alias hit.
 */
export function matchCarrierFromNotes(
  notes: string,
  carriers: CarrierEscalation[],
): CarrierMatch | null {
  const text = notes.toLowerCase();
  if (!text.trim() || carriers.length === 0) return null;

  // Build a lookup: name → carrier object
  const byName = new Map<string, CarrierEscalation>();
  for (const c of carriers) {
    byName.set(c.carrier.toLowerCase(), c);
  }

  // Candidate terms with their source classification
  type Candidate = {
    term: string;
    canonical: string;
    source: "exact" | "alias";
  };
  const candidates: Candidate[] = [];

  // 1. The carrier's own short name
  for (const c of carriers) {
    candidates.push({
      term: c.carrier.toLowerCase(),
      canonical: c.carrier.toLowerCase(),
      source: "exact",
    });
  }
  // 2. Aliases (only include those whose canonical actually exists in the
  // loaded carrier list — avoids matching a brand we have no contacts for)
  for (const [term, canonical] of Object.entries(CARRIER_ALIASES)) {
    if (byName.has(canonical.toLowerCase())) {
      candidates.push({
        term,
        canonical: canonical.toLowerCase(),
        source: "alias",
      });
    }
  }

  // Longest-first so "Comcast Business" wins over plain "Comcast" when both
  // are present in the notes.
  candidates.sort((a, b) => b.term.length - a.term.length);

  // Collect ALL matches first, then pick the best one. "Best" means:
  //   - longest matched term (most specific)
  //   - then, prefer canonical-via-alias when the alias-canonical carrier
  //     actually has populated NOC contacts (e.g. "Zayo" in notes routes to
  //     CrownCastle Fiber (Zayo) only because it has contacts; if it didn't,
  //     plain "Zayo" would still be chosen).
  type Hit = {
    candidate: Candidate;
    carrier: CarrierEscalation;
    matched_term: string;
  };
  const hits: Hit[] = [];
  for (const c of candidates) {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(c.term)}([^a-z0-9]|$)`, "i");
    if (re.test(text)) {
      const carrier = byName.get(c.canonical);
      if (!carrier) continue;
      const match = re.exec(notes);
      const matched_term =
        match?.[0]?.trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "") ?? c.term;
      hits.push({ candidate: c, carrier, matched_term });
    }
  }

  if (hits.length > 0) {
    // Group by matched substring length (the candidates list is already sorted
    // longest-first). Take everything tied for the longest match.
    const maxLen = hits[0].candidate.term.length;
    const topHits = hits.filter((h) => h.candidate.term.length === maxLen);

    // Within the tied group, prefer the carrier with populated NOC contacts —
    // an empty carrier entry is useless for drafting an email.
    const withContacts = topHits.find((h) => h.carrier.contacts.length > 0);
    const chosen = withContacts ?? topHits[0];
    return {
      carrier: chosen.carrier,
      matched_term: chosen.matched_term,
      source: chosen.candidate.source,
    };
  }

  // 3. Last resort — match against full page titles ("Lumen Escalation List")
  for (const c of carriers) {
    if (text.includes(c.title.toLowerCase())) {
      return { carrier: c, matched_term: c.title, source: "title" };
    }
  }

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract the numeric tier from a contact's level label.
 * "L1" / "Level 1" / "Tier 1" / "1" → 1
 * "M1" / unlabeled → 99 (sorts after numbered tiers)
 */
export function tierOf(c: EscalationContact): number {
  const m = /(\d+)/.exec(c.level ?? "");
  return m ? parseInt(m[1], 10) : 99;
}

/**
 * Return the sorted set of unique numeric tier levels that exist in the
 * carrier's contact list. Used to populate the "Include up to level"
 * dropdown — we only show level options the carrier actually has.
 * Excludes the 99 (unlabeled) sentinel.
 */
export function availableLevels(contacts: EscalationContact[]): number[] {
  const tiers = new Set<number>();
  for (const c of contacts) {
    if (!c.email?.trim()) continue;
    const t = tierOf(c);
    if (t < 99) tiers.add(t);
  }
  return Array.from(tiers).sort((a, b) => a - b);
}

/**
 * Split a carrier's contacts into the people who should be on the To: line of
 * an outbound escalation email vs the Cc: line. Convention:
 *   - To:  L1 / Tier 1 / lowest-numbered tier (the team that picks up first).
 *   - Cc:  L2+ and management — they want visibility but the L1 owns the SLA.
 *   - If multiple "L1" rows exist (e.g. shared mailbox + specific person),
 *     all go on To: so the email reaches every alias.
 *
 * `maxLevel` (optional) caps the highest tier included anywhere in the email.
 * If a carrier has L1, L2, L3, L4 and `maxLevel = 2` is passed, only L1 and
 * L2 contacts are returned (L3 and L4 are excluded entirely). When omitted,
 * ALL tiers are included.
 *
 * Contacts without an email address are skipped from both lines but kept in
 * the escalation-chain display so the user can see phone-only escalation
 * paths for follow-up.
 */
export function splitContactsForEmail(
  contacts: EscalationContact[],
  maxLevel?: number,
): {
  to: EscalationContact[];
  cc: EscalationContact[];
  phone_only: EscalationContact[];
  excluded_count: number;
} {
  const withEmail = contacts.filter((c) => !!c.email?.trim());
  const phone_only = contacts.filter((c) => !c.email?.trim() && !!c.phone?.trim());

  // Apply maxLevel filter. Unlabeled contacts (tier 99) are always kept —
  // they're typically shared mailboxes / generic addresses that should
  // remain in the list regardless of cutoff.
  const filtered =
    typeof maxLevel === "number"
      ? withEmail.filter((c) => {
          const t = tierOf(c);
          return t === 99 || t <= maxLevel;
        })
      : withEmail;

  const excluded_count = withEmail.length - filtered.length;

  if (filtered.length === 0) return { to: [], cc: [], phone_only, excluded_count };
  if (filtered.length === 1)
    return { to: filtered, cc: [], phone_only, excluded_count };

  const sorted = [...filtered].sort((a, b) => tierOf(a) - tierOf(b));
  const lowestTier = tierOf(sorted[0]);
  const to = sorted.filter((c) => tierOf(c) === lowestTier);
  const cc = sorted.filter((c) => tierOf(c) !== lowestTier);
  return { to, cc, phone_only, excluded_count };
}

/**
 * Build a `mailto:` URL with the To, Cc, Subject, and body pre-filled.
 * Used by the "Open in mail client" button so users can review and send
 * from their normal mail UI without retyping anything.
 */
export function buildMailtoUrl(opts: {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}): string {
  const params = new URLSearchParams();
  if (opts.cc && opts.cc.length > 0) params.set("cc", opts.cc.join(","));
  if (opts.subject) params.set("subject", opts.subject);
  if (opts.body) params.set("body", opts.body);
  return `mailto:${opts.to.join(",")}?${params.toString()}`;
}
