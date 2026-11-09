// Broker prospects: reads broker contact info out of DAT posting screenshots (OCR text)
// and builds the outreach emails. Pure functions, tested in prospects.test.js.
//
// Daniel's rules for every prospect email (2026-11-09):
//   - Never mention Broski Transportation; the sender is a Landstar agent, MC# 166960.
//   - Lead with "we do not double broker" and "we stay on top of our updates".

export const LANDSTAR_MC = '166960';
export const FOLLOW_UP_AFTER_DAYS = 3;

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE_PATTERN = /(?:\(\d{3}\)\s*|\b\d{3}[-. ])\d{3}[-. ]\d{4}\b(?:\s*(?:x|ext\.?)\s*\d{1,5})?/i;
// "DALLAS, TX" / "Fort Worth, TX" in OCR text; two of them on a line make a lane.
const CITY_STATE_PATTERN = /([A-Za-z][A-Za-z .'-]{1,30}?),\s*([A-Z]{2})\b/g;

// OCR often misreads emails; fix the safe, common cases so more contacts come out usable.
function cleanEmail(email) {
  return String(email || '')
    .toLowerCase()
    .replace(/,/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/\.$/, '');
}

function cleanCompany(text) {
  const line = String(text || '');
  // A line with a "City, ST" in it is the lane (or an address), not the company name.
  if (new RegExp(CITY_STATE_PATTERN.source).test(line)) return '';
  const cleaned = line
    .replace(EMAIL_PATTERN, ' ')
    .replace(/(?:\(\d{3}\)\s*|\b\d{3}[-. ])\d{3}[-. ]\d{4}\b/g, ' ')
    .replace(/[|•·®™]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Lines that are just numbers, rates or dates are not a company name.
  if (!/[A-Za-z]{3}/.test(cleaned)) return '';
  if (/^\$?\d[\d,.]*(\/mi)?$/i.test(cleaned)) return '';
  return cleaned.slice(0, 80);
}

function findLane(line) {
  const places = [];
  for (const match of String(line || '').matchAll(CITY_STATE_PATTERN)) {
    places.push(`${match[1].trim().toUpperCase()}, ${match[2]}`);
    if (places.length === 2) return `${places[0]} -> ${places[1]}`;
  }
  return '';
}

// Every broker contact found in the OCR text of a DAT screenshot:
// [{ company, contact, email, phone, lane }], one per email address, best guesses
// from the surrounding lines (the user edits them before saving).
export function extractProspects(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim());
  const found = new Map();
  lines.forEach((line, index) => {
    for (const match of line.matchAll(EMAIL_PATTERN)) {
      const email = cleanEmail(match[0]);
      if (!email.includes('@') || found.has(email)) continue;
      const nearby = [line, lines[index - 1] || '', lines[index + 1] || '', lines[index - 2] || ''];
      // Company: text on the email's own line first, then the closest line above.
      const company = nearby.map(cleanCompany).find(Boolean) || '';
      const phone = (nearby.map(item => item.match(PHONE_PATTERN)?.[0]).find(Boolean) || '').trim();
      const lane = nearby.map(findLane).find(Boolean) || '';
      found.set(email, { company, contact: '', email, phone, lane });
    }
  });
  return [...found.values()];
}

const firstName = value => String(value || '').trim().split(/\s+/)[0] || '';

function signature(settings = {}) {
  return [
    'Best regards,',
    '',
    String(settings.yourName || '').trim(),
    `Independent Agent for Landstar - MC# ${LANDSTAR_MC}`,
    String(settings.agencyName || '').trim(),
    String(settings.phone || '').trim(),
    String(settings.email || '').trim()
  ].filter((line, index) => index < 2 || line).join('\n');
}

// The intro email (Daniel's template, simplified 2026-11-09): short and direct - no double
// brokering and constant updates front and center, Landstar MC# 166960, never the Broski name.
export function buildProspectEmail(prospect = {}, settings = {}) {
  const hello = firstName(prospect.contact) ? `Hello ${firstName(prospect.contact)},` : 'Hello,';
  const me = String(settings.yourName || '').trim();
  const laneLine = prospect.lane
    ? `We saw your posting for ${prospect.lane} and have trucks in that area.\n\n`
    : '';
  return `${hello}

My name is ${me || '____'}, an independent agent for Landstar (MC# ${LANDSTAR_MC}). We are looking to build new relationships with companies that need reliable capacity and consistent service.

Two things we want you to know up front:

- WE DO NOT DOUBLE BROKER. Your freight moves only on Landstar BCOs - experienced owner-operators.
- WE STAY ON TOP OF OUR UPDATES. Consistent status updates on every load, tracking visibility, and proof of delivery on every shipment.

${laneLine}We have trucks available. Send over any upcoming lanes or freight opportunities and we will be glad to provide rates and availability.

Thank you for your time. We look forward to earning your business.

${signature(settings)}`;
}

export function buildFollowUpEmail(prospect = {}, settings = {}) {
  const hello = firstName(prospect.contact) ? `Hello ${firstName(prospect.contact)},` : 'Hello,';
  return `${hello}

Just following up on my earlier email. We are an independent Landstar agency (MC# ${LANDSTAR_MC}) with trucks available:

- We do not double broker - your freight moves only on Landstar BCO trucks.
- We stay on top of our updates - consistent status updates on every load and proof of delivery on every shipment.

If you have any upcoming lanes or freight opportunities, send them over and we will be glad to provide rates and availability.

${signature(settings)}`;
}

export function defaultSubject() {
  return `Truck capacity for your loads - Landstar agent MC# ${LANDSTAR_MC}`;
}

// Landstar agencies posting on DAT are not prospects (we never email fellow agents).
export function isLandstarProspect(prospect = {}) {
  return /landstar/i.test(`${prospect.company || ''} ${prospect.email || ''} ${prospect.contact || ''}`);
}

// A follow-up is due a few days after the intro email when nobody answered.
export function isFollowUpDue(prospect, now = Date.now()) {
  if (!prospect || prospect.status !== 'emailed') return false;
  const emailedAt = Date.parse(prospect.emailed_at);
  return Number.isFinite(emailedAt) && now - emailedAt > FOLLOW_UP_AFTER_DAYS * 86400000;
}
