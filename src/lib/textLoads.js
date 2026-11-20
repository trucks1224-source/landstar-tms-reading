// Reads a load list typed as text (Ryan Murray's Square 2570577 messages in Google Chat):
//
//   Charlotte, NC 28273 → Cincinnati, OH 45246
//     HAZMAT · UN2796 SULFURIC ACID · Van · Tanker endorsement · 43,504 lbs · 491 mi · Ref 31474-08698 · PU 06:00–14:00 · DEL Tue 11/24
//
// One load per "City, ST ZIP → City, ST ZIP" line; the details may wrap over several lines.
// The lists give the delivery DAY but not the pickup day, so the pickup day is estimated from the
// miles (same day under 250 mi, then a day per 550 mi) and the load says so in its notes.

const HEADER = /^\s*(.+?),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\s*(?:→|->|➝|➔|—>|–>|=>)\s*(.+?),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\s*$/i;
const TIME = '(\\d{1,2}):?(\\d{2})';
const SAME_DAY_MILES = 250;
const MILES_PER_DAY = 550;

const pad = value => String(value).padStart(2, '0');
const hhmm = (hours, minutes) => `${pad(Number(hours))}${pad(Number(minutes))}`;
const toMinutes = text => Number(text.slice(0, 2)) * 60 + Number(text.slice(2));
const fromMinutes = minutes => hhmm(Math.floor(minutes / 60), minutes % 60);
const dateText = date => `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`;

// "11/24" -> the next such date from today (a date more than 60 days back means next year).
function upcomingDate(month, day, now) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const date = new Date(today.getFullYear(), month - 1, day);
  if (date.getMonth() !== month - 1) return null;
  if (today - date > 60 * 86400000) date.setFullYear(date.getFullYear() + 1);
  return date;
}

// "PU 06:00–14:00", "PU APPT 09:00" -> { from: '0600', to: '1400' }; null when not given.
function readWindow(text) {
  const match = String(text || '').match(new RegExp(`^(?:APPT\\s*)?${TIME}(?:\\s*[–—-]\\s*${TIME})?`, 'i'));
  if (!match) return null;
  const from = hhmm(match[1], match[2]);
  return { from, to: match[3] ? hhmm(match[3], match[4]) : from, appointment: /^APPT/i.test(text) || !match[3] };
}

const titleCase = text => String(text || '').trim().toUpperCase();

export function parseTextLoadList(text, { now = Date.now(), source = 'text list' } = {}) {
  const lines = String(text || '').replace(/ /g, ' ').split(/\r?\n/);
  const blocks = [];
  for (const line of lines) {
    const header = line.match(HEADER);
    if (header) blocks.push({ header, details: [] });
    else if (blocks.length && line.trim()) blocks[blocks.length - 1].details.push(line.trim());
  }
  const loads = [];
  const problems = [];
  for (const { header, details } of blocks) {
    const [, origCity, origSt, origZip, destCity, destSt, destZip] = header;
    const lane = `${titleCase(origCity)}, ${origSt.toUpperCase()} → ${titleCase(destCity)}, ${destSt.toUpperCase()}`;
    const detail = details.join(' ').replace(/\s+/g, ' ');
    const parts = detail.split(/\s*[·•|]\s*/).map(part => part.trim()).filter(Boolean);
    const weight = detail.match(/([\d,]+)\s*lbs?\b/i)?.[1]?.replace(/,/g, '') || '';
    const miles = detail.match(/([\d,]+)\s*mi\b/i)?.[1]?.replace(/,/g, '') || '';
    const ref = detail.match(/\bRef\.?\s*#?\s*([A-Z0-9][\w-]*)/i)?.[1] || '';
    const delivery = detail.match(/\bDEL\s+(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})\/(\d{1,2})/i);
    if (!weight || !ref || !delivery) {
      problems.push(`${lane}: ${!ref ? 'no Ref #' : !weight ? 'no weight' : 'no DEL date'}`);
      continue;
    }
    const deliveryDate = upcomingDate(Number(delivery[1]), Number(delivery[2]), now);
    if (!deliveryDate) {
      problems.push(`${lane}: delivery date ${delivery[1]}/${delivery[2]} is not a real date`);
      continue;
    }
    // Delivery hours come right after the DEL date ("DEL Wed 11/25 · 08:00–13:00", "· APPT 07:00").
    const delIndex = parts.findIndex(part => /^DEL\b/i.test(part));
    const deliveryWindow = readWindow(parts[delIndex + 1]);
    const pickupWindow = readWindow(parts.find(part => /^PU\b/i.test(part))?.replace(/^PU\s*/i, ''));

    const transitDays = miles && Number(miles) <= SAME_DAY_MILES ? 0 : Math.max(1, Math.ceil(Number(miles || MILES_PER_DAY) / MILES_PER_DAY));
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const pickupDate = new Date(deliveryDate);
    pickupDate.setDate(pickupDate.getDate() - transitDays);
    if (pickupDate < today) pickupDate.setTime(today.getTime());
    const sameDay = pickupDate.getTime() === deliveryDate.getTime();

    let pickup = pickupWindow || (sameDay ? { from: '0600', to: '1000' } : { from: '0800', to: '1600' });
    const deliveryHours = deliveryWindow || (sameDay ? { from: '1300', to: '1700' } : { from: '0800', to: '1600' });
    // Landstar needs the delivery window to end after the pickup window.
    if (sameDay && toMinutes(deliveryHours.to) <= toMinutes(pickup.to)) {
      pickup = { ...pickup, to: fromMinutes(Math.max(toMinutes(pickup.from), toMinutes(deliveryHours.to) - 60)) };
    }

    const hazmat = /\bHAZMAT\b/i.test(detail) || /\bUN\s?\d{4}\b/i.test(detail);
    const reefer = parts.some(part => /^re(?:e)?fer$|^refrigerated$/i.test(part));
    const commodity = parts.find(part => /\bUN\s?\d{4}\b/i.test(part)) || '';
    const tanker = /tanker\s+endorsement/i.test(detail);
    const notes = [
      `Pickup day estimated as ${dateText(pickupDate)} from the delivery date${miles ? ` (${miles} mi)` : ''}: confirm with the customer.`,
      tanker ? 'Driver needs a TANKER endorsement.' : '',
      commodity ? `Commodity: ${commodity}` : '',
      `Imported from the ${source}.`
    ].filter(Boolean).join('\n');
    loads.push({
      id: ref,
      eCode: reefer ? (hazmat ? 'RZ' : 'R') : hazmat ? 'VZ' : 'VAN:VAN',
      status: 'OPEN',
      tag: 'OPEN',
      route: lane,
      puDate: `PU: ${dateText(pickupDate)}`,
      delDate: `DFL: ${dateText(deliveryDate)}`,
      pickupTime: `${dateText(pickupDate)} ${pickup.from} - ${pickup.to}`,
      deliveryTime: `${dateText(deliveryDate)} ${deliveryHours.from} - ${deliveryHours.to}`,
      origCity: titleCase(origCity),
      origSt: origSt.toUpperCase(),
      origZip,
      weight: `${Number(weight).toLocaleString('en-US')} lbs`,
      destCity: titleCase(destCity),
      destSt: destSt.toUpperCase(),
      destZip,
      miles,
      planningComment: commodity || (hazmat ? 'Hazmat' : 'Imported from text'),
      carrier: '',
      driver: '',
      truck: '',
      trailer: '',
      rateInput: '',
      brokerable: 'false',
      notes
    });
  }
  return { loads, problems };
}
