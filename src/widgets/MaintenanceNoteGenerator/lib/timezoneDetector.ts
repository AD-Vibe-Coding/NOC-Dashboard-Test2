// US State → Timezone mapping
const stateTimezones: Record<string, string> = {
  // Eastern
  FL: 'Eastern', GA: 'Eastern', NY: 'Eastern', NC: 'Eastern', SC: 'Eastern',
  VA: 'Eastern', OH: 'Eastern', PA: 'Eastern', NJ: 'Eastern', CT: 'Eastern',
  MA: 'Eastern', ME: 'Eastern', NH: 'Eastern', VT: 'Eastern', RI: 'Eastern',
  DE: 'Eastern', MD: 'Eastern', DC: 'Eastern', WV: 'Eastern', MI: 'Eastern',
  KY: 'Eastern', IN: 'Eastern',
  // Central
  TX: 'Central', IL: 'Central', MN: 'Central', WI: 'Central', MO: 'Central',
  AL: 'Central', LA: 'Central', MS: 'Central', TN: 'Central',
  IA: 'Central', KS: 'Central', NE: 'Central', ND: 'Central', SD: 'Central',
  OK: 'Central', AR: 'Central',
  // Mountain
  CO: 'Mountain', UT: 'Mountain', MT: 'Mountain', NM: 'Mountain',
  WY: 'Mountain', ID: 'Mountain', AZ: 'Mountain',
  // Pacific
  CA: 'Pacific', WA: 'Pacific', OR: 'Pacific', NV: 'Pacific',
  // Alaska & Hawaii
  AK: 'Alaska', HI: 'Hawaii',
};

// City name shortcuts for common AT&T GAR locations
const cityTimezones: Record<string, string> = {
  'atlanta': 'Eastern', 'charlotte': 'Eastern', 'cleveland': 'Eastern',
  'miami': 'Eastern', 'new york': 'Eastern', 'philadelphia': 'Eastern',
  'pittsburgh': 'Eastern', 'boston': 'Eastern', 'detroit': 'Eastern',
  'jacksonville': 'Eastern', 'tampa': 'Eastern', 'augusta': 'Eastern',
  'madison': 'Central', 'chicago': 'Central', 'dallas': 'Central',
  'houston': 'Central', 'san antonio': 'Central', 'kansas city': 'Central',
  'minneapolis': 'Central', 'milwaukee': 'Central', 'nashville': 'Central',
  'birmingham': 'Central', 'st louis': 'Central', 'memphis': 'Central',
  'wichita': 'Central', 'oklahoma city': 'Central',
  'denver': 'Mountain', 'phoenix': 'Mountain', 'salt lake': 'Mountain',
  'colorado springs': 'Mountain', 'albuquerque': 'Mountain',
  'los angeles': 'Pacific', 'san francisco': 'Pacific', 'seattle': 'Pacific',
  'portland': 'Pacific', 'sacramento': 'Pacific', 'san diego': 'Pacific',
  'san jose': 'Pacific', 'las vegas': 'Pacific',
};

const timezoneAbbreviations: Record<string, string> = {
  EST: 'Eastern', EDT: 'Eastern', ET: 'Eastern',
  CST: 'Central', CDT: 'Central', CT: 'Central',
  MST: 'Mountain', MDT: 'Mountain', MT: 'Mountain',
  PST: 'Pacific', PDT: 'Pacific', PT: 'Pacific',
  AKST: 'Alaska', AKDT: 'Alaska',
  HST: 'Hawaii', HDT: 'Hawaii',
  UTC: 'UTC', GMT: 'UTC',
  SGT: 'Singapore',
};

/**
 * Check if a given date falls in US Daylight Saving Time.
 * DST in the US: 2nd Sunday of March → 1st Sunday of November.
 */
export function isDSTForDate(date: Date): boolean {
  const year = date.getFullYear();
  // 2nd Sunday of March
  const marchFirst = new Date(year, 2, 1);
  const marchSecondSunday = new Date(year, 2, 8 + (7 - marchFirst.getDay()) % 7);
  // 1st Sunday of November
  const novFirst = new Date(year, 10, 1);
  const novFirstSunday = new Date(year, 10, 1 + (7 - novFirst.getDay()) % 7);

  return date >= marchSecondSunday && date < novFirstSunday;
}

/**
 * Returns the correct timezone abbreviation for a timezone name,
 * accounting for DST based on the maintenance date.
 * E.g., "Pacific" on a May date → "PDT", on a January date → "PST"
 */
export function getTimezoneAbbreviation(timezone: string, refDate?: Date): string {
  const date = refDate || new Date();
  const dst = isDSTForDate(date);

  const abbrevs: Record<string, [string, string]> = {
    Eastern: ['EST', 'EDT'],
    Central: ['CST', 'CDT'],
    Mountain: ['MST', 'MDT'],
    Pacific: ['PST', 'PDT'],
    Alaska: ['AKST', 'AKDT'],
    Hawaii: ['HST', 'HST'],   // Hawaii doesn't observe DST
    UTC: ['UTC', 'UTC'],
    Singapore: ['SGT', 'SGT'],
  };

  // Arizona doesn't observe DST (except Navajo Nation)
  if (timezone === 'Mountain') {
    // We can't know if it's AZ without more context, so default to DST-aware
  }

  const pair = abbrevs[timezone];
  if (pair) return dst ? pair[1] : pair[0];
  return timezone;
}

/**
 * Detect timezone from text — tries explicit TZ abbreviations first,
 * then state codes from addresses, then city names.
 */
export function detectTimezone(text: string): { timezone: string; confidence: 'found' | 'guessed' | 'not_found' } {
  // 1. Try explicit timezone abbreviations in the text
  const tzPattern = /\b(EST|EDT|ET|CST|CDT|CT|MST|MDT|MT|PST|PDT|PT|AKST|AKDT|HST|UTC|GMT|SGT)\b/gi;
  const tzMatch = text.match(tzPattern);
  if (tzMatch) {
    const tz = timezoneAbbreviations[tzMatch[0].toUpperCase()];
    if (tz) return { timezone: tz, confidence: 'found' };
  }

  // 2. Try "Time Zone" field (Spectrum format: "Time Zone\nPacific")
  const tzFieldMatch = text.match(/Time\s*Zone\s*[\n:]\s*(Eastern|Central|Mountain|Pacific)/i);
  if (tzFieldMatch) {
    return { timezone: tzFieldMatch[1], confidence: 'found' };
  }

  // 3. Look for "local time" mentions with GAR city (AT&T format)
  const garMatch = text.match(/maintenance on\s+([A-Za-z\s\-]+)\s+GAR/i);
  if (garMatch) {
    const city = garMatch[1].trim().toLowerCase();
    for (const [key, tz] of Object.entries(cityTimezones)) {
      if (city.includes(key)) {
        return { timezone: tz, confidence: 'found' };
      }
    }
  }

  // 4. Try US state codes before zip codes in addresses
  const stateZipPattern = /,\s*([A-Z]{2})\s*\d{5}/g;
  const stateMatches = [...text.matchAll(stateZipPattern)];
  if (stateMatches.length > 0) {
    const stateCode = stateMatches[0][1];
    const tz = stateTimezones[stateCode];
    if (tz) return { timezone: tz, confidence: 'found' };
  }

  // 5. Try bare state codes in address lines
  const addressLinePattern = /(?:Address|Location)[:\s]+.*?\b([A-Z]{2})\b(?:\s*\d{5})?/i;
  const addrMatch = text.match(addressLinePattern);
  if (addrMatch) {
    const tz = stateTimezones[addrMatch[1].toUpperCase()];
    if (tz) return { timezone: tz, confidence: 'found' };
  }

  // 6. Scan for any 2-letter state code
  for (const [code, tz] of Object.entries(stateTimezones)) {
    const stateRegex = new RegExp(`\\b${code}\\b(?:\\s*\\d{5})?`);
    if (stateRegex.test(text)) {
      return { timezone: tz, confidence: 'guessed' };
    }
  }

  return { timezone: '[Timezone Not Found]', confidence: 'not_found' };
}

/**
 * Convert UTC/GMT time string to a US timezone.
 * Input: "05/14/2026 04:00:00 GMT/UTC" and target timezone "Eastern"
 * Returns formatted local time string.
 */
export function convertUTCToTimezone(utcDateStr: string, timezone: string): { localStr: string; tzAbbr: string } | null {
  try {
    // Clean the string
    let cleaned = utcDateStr.replace(/GMT\/UTC|UTC|GMT/gi, '').trim();
    // Try to parse
    const date = new Date(cleaned + ' UTC');
    if (isNaN(date.getTime())) return null;

    const offsets: Record<string, [number, number]> = {
      Eastern: [-5, -4],
      Central: [-6, -5],
      Mountain: [-7, -6],
      Pacific: [-8, -7],
      Alaska: [-9, -8],
      Hawaii: [-10, -10],
      Singapore: [8, 8],
    };

    const pair = offsets[timezone];
    if (!pair) return null;

    const dst = isDSTForDate(date);
    const offsetHours = dst ? pair[1] : pair[0];

    const local = new Date(date.getTime() + offsetHours * 3600000);
    const tzAbbr = getTimezoneAbbreviation(timezone, date);

    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const month = months[local.getUTCMonth()];
    const day = String(local.getUTCDate()).padStart(2, '0');
    const year = local.getUTCFullYear();
    let hours = local.getUTCHours();
    const minutes = String(local.getUTCMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;

    const localStr = `${month} ${day}, ${year}, ${String(hours).padStart(2, '0')}:${minutes} ${ampm} ${tzAbbr}`;
    return { localStr, tzAbbr };
  } catch {
    return null;
  }
}
