import type { MaintenanceData, MaintenanceType, ConfidenceLevel } from '../types';
import { detectTimezone, getTimezoneAbbreviation, convertUTCToTimezone } from './timezoneDetector';

function field(value: string, confidence: ConfidenceLevel) {
  return { value, confidence };
}

// ─── Carrier Detection ────────────────────────────────────────
type CarrierType = 'att_ip' | 'att_vpn' | 'spectrum' | 'windstream' | 'nitel' | 'uniti' | 'expereo' | 'lumen' | 'comcast' | 'frontier' | 'generic';

function detectCarrierType(text: string): { type: CarrierType; display: string; confidence: ConfidenceLevel } {
  const lower = text.toLowerCase();

  // AT&T VPN (check before regular AT&T)
  if (lower.includes('at&t planned maintenance event') && lower.includes('vpn')) {
    return { type: 'att_vpn', display: 'AT&T', confidence: 'found' };
  }
  // AT&T IP Services
  if (lower.includes('dear at&t ip services customer') || lower.includes('at&t network engineers')) {
    return { type: 'att_ip', display: 'AT&T', confidence: 'found' };
  }
  // Spectrum Business
  if (lower.includes('spectrum business') && lower.includes('maintenance notifications')) {
    return { type: 'spectrum', display: 'Spectrum Business', confidence: 'found' };
  }
  // Windstream
  if (lower.includes('windstream') && (lower.includes('maintenance notification') || lower.includes('wmt'))) {
    return { type: 'windstream', display: 'Windstream', confidence: 'found' };
  }
  // Nitel
  if (lower.includes('nitel') || (lower.includes('nit') && lower.includes('scheduled maintenance'))) {
    return { type: 'nitel', display: 'Nitel', confidence: 'found' };
  }
  // Uniti Fiber
  if (lower.includes('uniti fiber') || lower.includes('uniti')) {
    return { type: 'uniti', display: 'Uniti Fiber', confidence: 'found' };
  }
  // Expereo
  if (lower.includes('expereo')) {
    return { type: 'expereo', display: 'Expereo', confidence: 'found' };
  }
  // Lumen / CenturyLink / Level3
  if (lower.includes('lumen') || lower.includes('centurylink') || lower.includes('level 3') || lower.includes('level3')) {
    return { type: 'lumen', display: 'Lumen', confidence: 'found' };
  }
  // Comcast
  if (lower.includes('comcast')) {
    return { type: 'comcast', display: 'Comcast', confidence: 'found' };
  }
  // Frontier
  if (lower.includes('frontier')) {
    return { type: 'frontier', display: 'Frontier', confidence: 'found' };
  }

  // Fallback carrier name detection
  const carriers = [
    { names: ['zayo', 'zayo group'], display: 'Zayo' },
    { names: ['cogent'], display: 'Cogent' },
    { names: ['crown castle'], display: 'Crown Castle' },
    { names: ['verizon'], display: 'Verizon' },
    { names: ['telia'], display: 'Telia' },
    { names: ['ntt'], display: 'NTT' },
    { names: ['megaport'], display: 'Megaport' },
    { names: ['equinix'], display: 'Equinix' },
    { names: ['t-mobile', 'tmobile'], display: 'T-Mobile' },
    { names: ['cox'], display: 'Cox' },
  ];

  for (const c of carriers) {
    for (const name of c.names) {
      if (lower.includes(name)) return { type: 'generic', display: c.display, confidence: 'found' };
    }
  }

  return { type: 'generic', display: '[Carrier Not Found]', confidence: 'not_found' };
}

// ─── AT&T IP Services Parser ──────────────────────────────────
function parseATTIP(text: string): Partial<MaintenanceData> {
  // Circuit ID: "IUEC.862409..ATI" pattern — appears on line after "listed as a contact"
  let circuitId = field('[Circuit ID Not Found]', 'not_found');
  const cktMatch = text.match(/listed as a contact\.\s*\n?\s*([A-Z]{2,6}\.[A-Z0-9]+\.\.[A-Z]+)/i);
  if (cktMatch) circuitId = field(cktMatch[1].trim(), 'found');
  else {
    const cktMatch2 = text.match(/\b([A-Z]{2,6}\.\d{4,}\.\.[A-Z]{2,4})\b/);
    if (cktMatch2) circuitId = field(cktMatch2[1], 'found');
  }

  // Address: "Address: 540 TRADE CENTER ST MONTGOMERY, AL 36108"
  let address = field('[Address Not Found]', 'not_found');
  const addrMatch = text.match(/Address:\s*(.+?)(?:\n|Please note)/i);
  if (addrMatch) address = field(addrMatch[1].trim(), 'found');

  // Reason: "performing a(n) IOS UPGRADE"
  let reason = field('[Reason Not Found]', 'not_found');
  const reasonMatch = text.match(/performing a\(n\)\s*(.+?)\.?\s*\n/i);
  if (reasonMatch) reason = field(reasonMatch[1].trim(), 'found');

  // Date: "performed on 04/28/2026, during the maintenance window of 12:00AM-6:00AM, local time"
  let startTime = field('[Start Time Not Found]', 'not_found');
  let endTime = field('[End Time Not Found]', 'not_found');

  const dateWindowMatch = text.match(/performed on\s+(\d{2}\/\d{2}\/\d{4})\s*,\s*during the maintenance window of\s*(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)\s*,\s*local time/i);
  if (dateWindowMatch) {
    const dateStr = dateWindowMatch[1];
    const startStr = dateWindowMatch[2];
    const endStr = dateWindowMatch[3];
    // Parse date parts
    const [mm, dd, yyyy] = dateStr.split('/');
    const dateObj = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const formattedDate = `${months[dateObj.getMonth()]} ${String(dateObj.getDate()).padStart(2, '0')}, ${dateObj.getFullYear()}`;
    startTime = field(`${formattedDate}, ${startStr.trim()}`, 'found');
    endTime = field(`${formattedDate}, ${endStr.trim()}`, 'found');
  }

  // GAR city for timezone
  let timezone = field('[Timezone Not Found]', 'not_found');
  const garMatch = text.match(/maintenance on\s+([A-Za-z\s\-]+)\s+GAR/i);
  if (garMatch) {
    const tz = detectTimezone(text);
    if (tz.confidence !== 'not_found') {
      const dateForDST = dateWindowMatch ? new Date(dateWindowMatch[1]) : new Date();
      const abbr = getTimezoneAbbreviation(tz.timezone, dateForDST);
      timezone = field(abbr, tz.confidence);
      // Append timezone to times — AT&T says "local time"
      if (startTime.confidence === 'found') {
        startTime = field(`${startTime.value} (${abbr})`, 'found');
      }
      if (endTime.confidence === 'found') {
        endTime = field(`${endTime.value} (${abbr})`, 'found');
      }
    }
  } else {
    // Fall back to address-based timezone detection
    const tz = detectTimezone(text);
    if (tz.confidence !== 'not_found') {
      const dateForDST = dateWindowMatch ? new Date(dateWindowMatch[1]) : new Date();
      const abbr = getTimezoneAbbreviation(tz.timezone, dateForDST);
      timezone = field(abbr, tz.confidence);
      if (startTime.confidence === 'found' && !startTime.value.includes('(')) {
        startTime = field(`${startTime.value} (${abbr})`, 'found');
      }
      if (endTime.confidence === 'found' && !endTime.value.includes('(')) {
        endTime = field(`${endTime.value} (${abbr})`, 'found');
      }
    }
  }

  return { circuitId, address, reason, startTime, endTime, timezone };
}

// ─── AT&T VPN Parser ──────────────────────────────────────────
function parseATTVPN(text: string): Partial<MaintenanceData> {
  // Circuit ID from user-provided or from text
  let circuitId = field('[Circuit ID Not Found]', 'not_found');
  const cktMatch = text.match(/\b([A-Z]{2,6}\d{5,}[A-Z]{2,4})\b/);
  if (cktMatch) circuitId = field(cktMatch[1], 'found');
  else {
    const bfecMatch = text.match(/\b(BFEC\d+)\b/i);
    if (bfecMatch) circuitId = field(bfecMatch[1], 'found');
  }

  let reason = field('network change (LCE Hot Cut activity) to improve service performance and reliability', 'found');
  const descMatch = text.match(/Description:\s*(.+)/i);
  if (descMatch) reason = field(descMatch[1].trim(), 'found');

  // Times in GMT/UTC — need conversion
  let startTime = field('[Start Time Not Found]', 'not_found');
  let endTime = field('[End Time Not Found]', 'not_found');
  let timezone = field('[Timezone Not Found]', 'not_found');

  const startMatch = text.match(/Start Time:\s*(.+?)(?:\n|$)/i);
  const endMatch = text.match(/End Time:\s*(.+?)(?:\n|$)/i);

  if (startMatch && endMatch) {
    const tz = detectTimezone(text);
    const targetTz = tz.confidence !== 'not_found' ? tz.timezone : 'Eastern';
    const startConv = convertUTCToTimezone(startMatch[1].trim(), targetTz);
    const endConv = convertUTCToTimezone(endMatch[1].trim(), targetTz);

    if (startConv) {
      startTime = field(startConv.localStr, 'found');
      timezone = field(startConv.tzAbbr, 'found');
    }
    if (endConv) {
      endTime = field(endConv.localStr, 'found');
    }
  }

  return { circuitId, reason, startTime, endTime, timezone };
}

// ─── Spectrum Business Parser ─────────────────────────────────
function parseSpectrum(text: string): Partial<MaintenanceData> {
  // Circuit ID: table line with "XX.L1XX.XXXXXX..CHTR"
  let circuitId = field('[Circuit ID Not Found]', 'not_found');
  const chtrMatch = text.match(/\b(\d{2}\.L\d[A-Z]{2}\.\d{6}\.\.[A-Z]+)\b/i);
  if (chtrMatch) circuitId = field(chtrMatch[1], 'found');

  // Address from circuits table
  let address = field('[Address Not Found]', 'not_found');
  const addrMatch = text.match(/(\d+\s+[A-Z][A-Z\s]+(?:ST|AVE|BLVD|DR|RD|WAY|LN|CT|PL|PKWY|HWY)(?:\s+[A-Z]*)?,\s*[A-Z\s]+(?:[A-Z]{2}))\s/i);
  if (addrMatch) {
    address = field(addrMatch[1].trim(), 'found');
  } else {
    // Try the address line near CircuitID
    const addrMatch2 = text.match(/\b(\d+\s+\w[\w\s]*(?:ST|AVE|BLVD|DR|RD|WAY|LN|CT|PL|PKWY|HWY|OAKS)[\w\s]*,\s*\w[\w\s]*\b[A-Z]{2})\b/i);
    if (addrMatch2) address = field(addrMatch2[1].trim(), 'found');
  }

  // Reason from Description field
  let reason = field('[Reason Not Found]', 'not_found');
  const descMatch = text.match(/Description\s*\n?\s*((?:STD|Emergency)[^\n]+)/i);
  if (descMatch) {
    const desc = descMatch[1].trim();
    // Clean up: "STD | LOS | OS Upgrade" → "OS upgrade to improve network performance and reliability"
    if (desc.toLowerCase().includes('os upgrade')) {
      reason = field('OS upgrade to improve network performance and reliability', 'found');
    } else if (desc.toLowerCase().includes('software upgrade')) {
      reason = field('software upgrade to improve network performance and reliability', 'found');
    } else if (desc.toLowerCase().includes('network maintenance')) {
      reason = field('3rd party network maintenance to address service impacting conditions', 'found');
    } else {
      const parts = desc.split('|').map(s => s.trim());
      reason = field(parts[parts.length - 1] || desc, 'found');
    }
  }

  // Duration from Impact Details
  let explicitDuration = '';
  const durMatch = text.match(/Duration\s*\n?\s*(\d+)\s*\(?(minutes?)\)?/i);
  if (durMatch) {
    const mins = parseInt(durMatch[1]);
    explicitDuration = mins >= 60 ? `approximately ${Math.floor(mins / 60)} hours` : `approximately ${mins} minutes`;
    if (mins > 60 && mins % 60 !== 0) {
      explicitDuration = `approximately ${mins} minutes`;
    }
  }

  // Times: "Planned Start\n04/28/2026 12:00AM PDT"
  let startTime = field('[Start Time Not Found]', 'not_found');
  let endTime = field('[End Time Not Found]', 'not_found');
  let timezone = field('[Timezone Not Found]', 'not_found');

  const startMatch = text.match(/Planned Start\s*\n?\s*(\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s*[AP]M\s*[A-Z]{2,4})/i);
  const endMatch = text.match(/Planned End\s*\n?\s*(\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s*[AP]M\s*[A-Z]{2,4})/i);

  if (startMatch) {
    const raw = startMatch[1].trim();
    const formatted = formatSpectrumDate(raw);
    startTime = field(formatted, 'found');
    const tzPart = raw.match(/[A-Z]{2,4}$/)?.[0] || '';
    timezone = field(tzPart, 'found');
  }
  if (endMatch) {
    const raw = endMatch[1].trim();
    const formatted = formatSpectrumDate(raw);
    endTime = field(formatted, 'found');
  }

  return { circuitId, address, reason, startTime, endTime, timezone, ...(explicitDuration ? { duration: field(explicitDuration, 'found') } : {}) };
}

function formatSpectrumDate(raw: string): string {
  // "04/28/2026 12:00AM PDT" → "April 28, 2026, 12:00 AM PDT"
  const match = raw.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}:\d{2})\s*([AP]M)\s*([A-Z]{2,4})/i);
  if (!match) return raw;
  const [, mm, dd, yyyy, time, ampm, tz] = match;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthName = months[parseInt(mm) - 1];
  return `${monthName} ${String(parseInt(dd)).padStart(2, '0')}, ${yyyy}, ${time} ${ampm} ${tz}`;
}

// ─── Windstream Parser ────────────────────────────────────────
function parseWindstream(text: string): Partial<MaintenanceData> {
  // Circuit ID
  let circuitId = field('[Circuit ID Not Found]', 'not_found');
  const cktMatch = text.match(/\b([A-Z]{2}\/[A-Z]{4}\/\d+\/\s*\/[A-Z]+\/)\b/i);
  if (cktMatch) circuitId = field(cktMatch[1].replace(/\s/g, ''), 'found');

  // Address from Maintenance Address field
  let address = field('[Address Not Found]', 'not_found');
  const addrMatch = text.match(/Maintenance Address:\s*\n?\s*(.+?)(?:\n|Service)/i);
  if (addrMatch) address = field(addrMatch[1].trim(), 'found');
  else {
    // Try A-Loc Address
    const aLocMatch = text.match(/A-Loc Address\s*\n?\s*(.+)/i);
    if (aLocMatch) address = field(aLocMatch[1].trim(), 'found');
  }

  // Reason
  let reason = field('[Reason Not Found]', 'not_found');
  const descMatch = text.match(/DESCRIPTION OF MAINTENANCE\s*\n?\s*(.+)/i);
  if (descMatch) {
    const rawReason = descMatch[1].trim();
    reason = field(rawReason.toLowerCase().replace(/^(fiber maintenance\s*-?\s*)/, 'fiber '), 'found');
  }

  // Duration
  let explicitDuration = '';
  const durMatch = text.match(/Outage\s+(\d+)\s+minute/i);
  if (durMatch) {
    const mins = parseInt(durMatch[1]);
    explicitDuration = mins >= 60 ? `up to ${Math.floor(mins / 60)} hours` : `up to ${mins} minutes`;
  }

  // Times with ET
  let startTime = field('[Start Time Not Found]', 'not_found');
  let endTime = field('[End Time Not Found]', 'not_found');
  let timezone = field('[Timezone Not Found]', 'not_found');

  const eventStartMatch = text.match(/Event Start Date\s*(?:&|&amp;)\s*Time:\s*(.+)/i);
  const eventEndMatch = text.match(/Event End Date\s*(?:&|&amp;)\s*Time:\s*(.+)/i);

  if (eventStartMatch) {
    const raw = eventStartMatch[1].trim();
    startTime = field(formatWindstreamDate(raw), 'found');
    const tzPart = raw.match(/[A-Z]{2,4}$/)?.[0] || 'ET';
    timezone = field(tzPart, 'found');
  }
  if (eventEndMatch) {
    endTime = field(formatWindstreamDate(eventEndMatch[1].trim()), 'found');
  }

  return { circuitId, address, reason, startTime, endTime, timezone, ...(explicitDuration ? { duration: field(explicitDuration, 'found') } : {}) };
}

function formatWindstreamDate(raw: string): string {
  // "04/21/26 01:00 ET" → "April 21, 2026, 01:00 AM ET"
  const match = raw.match(/(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*([A-Z]{2,4})?/i);
  if (!match) return raw;
  let [, mm, dd, yy, hr, min, tz] = match;
  if (yy.length === 2) yy = '20' + yy;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthName = months[parseInt(mm) - 1];
  const hour = parseInt(hr);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${monthName} ${String(parseInt(dd)).padStart(2, '0')}, ${yy}, ${String(h12).padStart(2, '0')}:${min} ${ampm} ${tz || 'ET'}`;
}

// ─── Nitel Parser ─────────────────────────────────────────────
function parseNitel(text: string): Partial<MaintenanceData> {
  let circuitId = field('[Circuit ID Not Found]', 'not_found');
  const sidMatch = text.match(/Service Id:\s*(\S+)/i) || text.match(/\b(NIT\d+)\b/i);
  if (sidMatch) circuitId = field(sidMatch[1], 'found');

  let address = field('[Address Not Found]', 'not_found');
  const locMatch = text.match(/Location:\s*(.+?)(?:\n|Ticket)/i);
  if (locMatch) address = field(locMatch[1].trim(), 'found');

  let reason = field('[Reason Not Found]', 'not_found');
  const descMatch = text.match(/Description of Maintenance:\s*(.+?)(?:\n|$)/i);
  if (descMatch) reason = field(descMatch[1].trim(), 'found');
  else {
    const descMatch2 = text.match(/performing\s+(.+?)(?:\.|$)/i);
    if (descMatch2) reason = field(descMatch2[1].trim(), 'found');
  }

  // Times — Nitel often provides both EST and GMT
  let startTime = field('[Start Time Not Found]', 'not_found');
  let endTime = field('[End Time Not Found]', 'not_found');
  let timezone = field('[Timezone Not Found]', 'not_found');

  const localTimeMatch = text.match(/Maintenance Date\/Time\s*\(Local\)\s*:\s*(.+?)\s*-\s*(.+?)(?:\n|$)/i);
  if (localTimeMatch) {
    startTime = field(localTimeMatch[1].trim(), 'found');
    endTime = field(localTimeMatch[2].trim(), 'found');
    const tzPart = localTimeMatch[1].match(/[A-Z]{2,4}$/)?.[0] || '';
    timezone = field(tzPart, 'found');
  }

  return { circuitId, address, reason, startTime, endTime, timezone };
}

// ─── Uniti Fiber Parser ───────────────────────────────────────
function parseUniti(text: string): Partial<MaintenanceData> {
  let circuitId = field('[Circuit ID Not Found]', 'not_found');
  const cktMatch = text.match(/(\/INT\/\d+\/\/[A-Z]+\/)/i);
  if (cktMatch) circuitId = field(cktMatch[1], 'found');

  let address = field('[Address Not Found]', 'not_found');
  const aLocMatch = text.match(/A Location\s*\n?\s*(.+?)(?:\n|\|)/i);
  if (aLocMatch) address = field(aLocMatch[1].trim(), 'found');
  else {
    // Try address after pipe in circuits
    const pipeMatch = text.match(/\|\s*(\d+\s+\w[\w\s]+,\s*\w[\w\s]+,\s*[A-Z]{2}\s*\d{5})/i);
    if (pipeMatch) address = field(pipeMatch[1].trim(), 'found');
  }

  let reason = field('[Reason Not Found]', 'not_found');
  const descMatch = text.match(/Description of Maintenance:\s*(.+?)(?:\n|$)/i);
  if (descMatch) reason = field(descMatch[1].trim().replace(/\?/g, ''), 'found');
  else {
    const descMatch2 = text.match(/will be performing\s+(.+?)(?:\.|\n)/i);
    if (descMatch2) reason = field(descMatch2[1].trim(), 'found');
  }

  let explicitDuration = '';
  const durMatch = text.match(/Up to a?\s*(\d+)[- ]minute/i);
  if (durMatch) explicitDuration = `up to ${durMatch[1]} minutes`;

  // Times in UTC — need conversion
  let startTime = field('[Start Time Not Found]', 'not_found');
  let endTime = field('[End Time Not Found]', 'not_found');
  let timezone = field('[Timezone Not Found]', 'not_found');

  const timeMatch = text.match(/Date\/Time:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*-\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*UTC/i);
  if (timeMatch) {
    const tz = detectTimezone(text);
    const targetTz = tz.confidence !== 'not_found' ? tz.timezone : 'Eastern';
    const startConv = convertUTCToTimezone(timeMatch[1], targetTz);
    const endConv = convertUTCToTimezone(timeMatch[2], targetTz);
    if (startConv) {
      startTime = field(startConv.localStr, 'found');
      timezone = field(startConv.tzAbbr, 'found');
    }
    if (endConv) endTime = field(endConv.localStr, 'found');
  }

  return { circuitId, address, reason, startTime, endTime, timezone, ...(explicitDuration ? { duration: field(explicitDuration, 'found') } : {}) };
}

// ─── Expereo Parser ───────────────────────────────────────────
function parseExpereo(text: string): Partial<MaintenanceData> {
  let circuitId = field('[Circuit ID Not Found]', 'not_found');
  const svcMatch = text.match(/Service ID:\s*(\S+)/i);
  if (svcMatch) circuitId = field(svcMatch[1], 'found');

  let address = field('[Address Not Found]', 'not_found');
  const siteMatch = text.match(/Site:\s*(.+?)(?:\n|$)/i);
  if (siteMatch) address = field(siteMatch[1].trim().replace(/\s*,\s*[A-Z]{2}$/, ''), 'found');

  let reason = field('[Reason Not Found]', 'not_found');
  const reasonMatch = text.match(/Reason:\s*(.+?)(?:\n|$)/i);
  if (reasonMatch) reason = field(reasonMatch[1].trim().toLowerCase(), 'found');

  let explicitDuration = '';
  const durMatch = text.match(/Expected Outage:\s*(\d+)\s*minutes/i);
  if (durMatch) {
    const mins = parseInt(durMatch[1]);
    explicitDuration = mins >= 60 ? `up to ${Math.floor(mins / 60)} hours` : `up to ${mins} minutes`;
  }

  // Times in UTC
  let startTime = field('[Start Time Not Found]', 'not_found');
  let endTime = field('[End Time Not Found]', 'not_found');
  let timezone = field('[Timezone Not Found]', 'not_found');

  const startMatch = text.match(/Start Time\s*\(UTC\)\s*:\s*(.+?)(?:\n|$)/i);
  const endMatch = text.match(/End Time\s*\(UTC\)\s*:\s*(.+?)(?:\n|$)/i);

  if (startMatch && endMatch) {
    const tz = detectTimezone(text);
    const targetTz = tz.confidence !== 'not_found' ? tz.timezone : 'Eastern';
    const startConv = convertUTCToTimezone(startMatch[1].trim(), targetTz);
    const endConv = convertUTCToTimezone(endMatch[1].trim(), targetTz);
    if (startConv) {
      startTime = field(startConv.localStr, 'found');
      timezone = field(startConv.tzAbbr, 'found');
    }
    if (endConv) endTime = field(endConv.localStr, 'found');
  }

  return { circuitId, address, reason, startTime, endTime, timezone, ...(explicitDuration ? { duration: field(explicitDuration, 'found') } : {}) };
}

// ─── Generic Fallback Parser ──────────────────────────────────
function parseGeneric(text: string): Partial<MaintenanceData> {
  // Circuit ID patterns
  let circuitId = field('[Circuit ID Not Found]', 'not_found');
  const cktPatterns = [
    /circuit\s*(?:id|#|number)?[\s:]+([A-Z0-9\-\/\.]+)/gi,
    /\b([A-Z]{2,6}[\-\/][A-Z0-9\-\/]{4,})\b/g,
    /\b(\d{3,}[\-]\d{3,}[\-]?\d*)\b/g,
  ];
  for (const p of cktPatterns) {
    const m = text.match(p);
    if (m) {
      let id = m[0];
      const colonIdx = id.indexOf(':');
      if (colonIdx !== -1) id = id.substring(colonIdx + 1).trim();
      id = id.replace(/^(?:circuit|reference|order|ticket|cid)\s*(?:id|#|number|no\.?)?\s*:?\s*/i, '').trim();
      if (id.length >= 4) { circuitId = field(id, 'found'); break; }
    }
  }

  // Address
  let address = field('[Address Not Found]', 'not_found');
  const addrPatterns = [
    /(?:location|address|site|facility)[\s:]+([^\n]+)/i,
    /(\d+\s+\w+(?:\s+\w+)*\s*,\s*\w+(?:\s+\w+)*\s*,\s*[A-Z]{2}\s*\d{5})/i,
  ];
  for (const p of addrPatterns) {
    const m = text.match(p);
    if (m) { address = field(m[1].trim(), 'found'); break; }
  }

  // Reason
  let reason = field('[Reason Not Found]', 'not_found');
  const reasonPatterns = [
    /(?:reason|description|purpose|maintenance\s+type)[\s:]+([^\n]+)/i,
    /performing\s+(?:a\(n\)\s+)?(.+?)(?:\.|$)/im,
  ];
  for (const p of reasonPatterns) {
    const m = text.match(p);
    if (m) { reason = field(m[1].trim(), 'found'); break; }
  }

  // Times
  let startTime = field('[Start Time Not Found]', 'not_found');
  let endTime = field('[End Time Not Found]', 'not_found');
  const startPatterns = [/(?:start|begin|from)\s*(?:date|time)?[\s:]+([^\n]+)/i];
  const endPatterns = [/(?:end|finish|until|through)\s*(?:date|time)?[\s:]+([^\n]+)/i];
  for (const p of startPatterns) { const m = text.match(p); if (m) { startTime = field(m[1].trim(), 'found'); break; } }
  for (const p of endPatterns) { const m = text.match(p); if (m) { endTime = field(m[1].trim(), 'found'); break; } }

  // Timezone
  let timezone = field('[Timezone Not Found]', 'not_found');
  const tz = detectTimezone(text);
  if (tz.confidence !== 'not_found') timezone = field(getTimezoneAbbreviation(tz.timezone), tz.confidence);

  return { circuitId, address, reason, startTime, endTime, timezone };
}

// ─── Duration Calculator ──────────────────────────────────────
function calculateDurationFromTimes(startStr: string, endStr: string): string {
  if (startStr.includes('Not Found') || endStr.includes('Not Found')) return '';

  // Extract hours from start/end to calculate diff
  const extractHour = (s: string): number | null => {
    const m = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    let h = parseInt(m[1]);
    const min = parseInt(m[2]);
    const ampm = m[3].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h + min / 60;
  };

  const startH = extractHour(startStr);
  const endH = extractHour(endStr);

  if (startH !== null && endH !== null) {
    let diff = endH - startH;
    if (diff < 0) diff += 24; // Crosses midnight
    const hours = Math.floor(diff);
    const mins = Math.round((diff - hours) * 60);
    if (mins === 0) return `up to ${hours} hours`;
    return `up to ${hours} hours ${mins} minutes`;
  }

  return '';
}

// ─── Main Entry Point ─────────────────────────────────────────
export function parseMaintenanceEmail(text: string): MaintenanceData {
  const carrier = detectCarrierType(text);

  let parsed: Partial<MaintenanceData> = {};

  switch (carrier.type) {
    case 'att_ip': parsed = parseATTIP(text); break;
    case 'att_vpn': parsed = parseATTVPN(text); break;
    case 'spectrum': parsed = parseSpectrum(text); break;
    case 'windstream': parsed = parseWindstream(text); break;
    case 'nitel': parsed = parseNitel(text); break;
    case 'uniti': parsed = parseUniti(text); break;
    case 'expereo': parsed = parseExpereo(text); break;
    default: parsed = parseGeneric(text); break;
  }

  // Calculate duration if not explicitly provided
  let duration = (parsed as any).duration || field('[Duration Not Found]', 'not_found');
  if (duration.confidence === 'not_found' && parsed.startTime && parsed.endTime) {
    const calc = calculateDurationFromTimes(parsed.startTime.value, parsed.endTime.value);
    if (calc) duration = field(calc, 'found');
  }

  // Also check for explicit duration in text
  if (duration.confidence === 'not_found') {
    const durMatch = text.match(/(?:lasting|duration|outage)\s*(?:of|:)?\s*(?:up to|approximately)?\s*(\d+)\s*(minute|hour|min|hr)/i);
    if (durMatch) {
      const val = parseInt(durMatch[1]);
      const unit = durMatch[2].toLowerCase();
      if (unit.startsWith('hour') || unit.startsWith('hr')) {
        duration = field(`up to ${val} hours`, 'found');
      } else {
        duration = field(`approximately ${val} minutes`, 'found');
      }
    }
  }

  return {
    carrier: field(carrier.display, carrier.confidence),
    address: parsed.address || field('[Address Not Found]', 'not_found'),
    circuitId: parsed.circuitId || field('[Circuit ID Not Found]', 'not_found'),
    startTime: parsed.startTime || field('[Start Time Not Found]', 'not_found'),
    endTime: parsed.endTime || field('[End Time Not Found]', 'not_found'),
    duration,
    reason: parsed.reason || field('[Reason Not Found]', 'not_found'),
    timezone: parsed.timezone || field('[Timezone Not Found]', 'not_found'),
  };
}

// ─── Generate vCom Customer Note ──────────────────────────────
export function generateNote(data: MaintenanceData, type: MaintenanceType): string {
  const carrier = data.carrier.value;
  const typeLabel = type === 'emergency' ? 'emergency' : 'scheduled';
  const address = data.address.value;
  const circuitId = data.circuitId.value;
  const duration = data.duration.value.includes('Not Found') ? 'the duration of' : data.duration.value;
  const reason = data.reason.value.includes('Not Found') ? '[REASON]' : data.reason.value;
  const startTime = data.startTime.value.includes('Not Found') ? '[START TIME]' : data.startTime.value;
  const endTime = data.endTime.value.includes('Not Found') ? '[END TIME]' : data.endTime.value;

  return `Hello Team,

Please be advised, ${carrier} will be performing ${typeLabel} maintenance that will impact your service at location ${address}.

Your vCom provided circuit ${circuitId} will be subject to an outage lasting ${duration} during this maintenance window (Please note this is an estimate and no guarantee of actual impact). This maintenance is for ${reason}

Start time: ${startTime}
End time: ${endTime}

If you experience service issues after that window, you may need to reboot your equipment. If you continue to have any problems, call our toll-free Technical Support number 800-804-8266 opt 3, and refer to this ticket for further assistance.`;
}

// ─── Supported carrier count ──────────────────────────────────
export const SUPPORTED_CARRIERS = [
  { name: 'AT&T', format: 'IP Services (GAR/local times) & VPN (GMT/UTC times) — unified carrier' },
  { name: 'Spectrum Business', format: 'Table-based notifications with PDT/EDT times' },
  { name: 'Windstream', format: 'Emergency/Demand/Scheduled with ET times, WMT tickets' },
  { name: 'Nitel', format: 'Ticket-based notices with NIT service IDs' },
  { name: 'Uniti Fiber', format: 'NCC tickets with UTC times, fiber/software upgrades' },
  { name: 'Expereo', format: 'International SVC IDs with UTC times' },
  { name: 'Lumen / CenturyLink / Level 3', format: 'Standard carrier format with fallback detection' },
  { name: 'Comcast', format: 'Standard carrier format' },
  { name: 'Frontier', format: 'Standard carrier format' },
  { name: 'Zayo', format: 'Generic format support' },
  { name: 'Cogent', format: 'Generic format support' },
  { name: 'Crown Castle', format: 'Generic format support' },
  { name: 'Verizon', format: 'Generic format support' },
  { name: 'Telia', format: 'Generic format support' },
  { name: 'NTT', format: 'Generic format support' },
  { name: 'Megaport', format: 'Generic format support' },
  { name: 'Equinix', format: 'Generic format support' },
  { name: 'T-Mobile', format: 'Generic format support' },
  { name: 'Cox', format: 'Generic format support' },
];
