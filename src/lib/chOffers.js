// C.H. Robinson offers helper (Daniel, 2026-11-25).
//
// CH posts its loads low, so Daniel offers DAT rate + $500. He copies Navisphere's Find Loads
// results (Ctrl+A, Ctrl+C) and pastes them into the TMS; this reads that text. Nothing here
// touches C.H. Robinson's site: Daniel makes every offer himself in Navisphere.
//
// Navisphere's copied text, one block per load:
//   Origin Information:\nSan Diego, CA, US\nDeadhead Distance from Pickup139.0 mi\nPickup Date\n
//   12/01/2026\n12:00 PM\nDestination Information:\nFresno, CA, US\nDrop Off Date\n12/02/2026\n
//   09:00 AM\nDistance352 mi\n1 pick, 1 drop\nWeight43,703 lbs\n[EndorsementSTF\n]Equipment TypeVan\n
//   Equipment Size53\nRate\n1,560.00 USD\nBook or Offer   (or just "Make Offer" with no rate)

export const CH_OFFER_OVER_DAT = 500;

// "Copy CH loads" bookmark for Chrome's bookmarks bar. Clicked on Navisphere's Find Loads page,
// it copies every load on the page with its (hidden) load number, for pasting into CH Offers.
// It only reads what is already on the page: no clicks, searches or requests to C.H. Robinson.
export const CH_COPY_BOOKMARKLET = "javascript:(()=>{const c=[...document.querySelectorAll('[data-testid=\"find-loads-result\"]')];"
  + "if(!c.length){alert('Open Navisphere Find Loads results first.');return;}"
  + "const t=c.map(x=>'Load #'+((x.firstElementChild&&x.firstElementChild.textContent)||'').trim()+'\\n'+x.innerText).join('\\n');"
  + "navigator.clipboard.writeText(t).then(()=>alert('Copied '+c.length+' C.H. Robinson loads. Paste them into CH Offers in your TMS.'),()=>prompt('Copy this text:',t));})();";

const number = text => Number(String(text || '').replace(/[^\d.]/g, '')) || 0;
const place = line => {
  const match = String(line || '').trim().match(/^(.+?),\s*([A-Z]{2}),\s*(US|USA|CA|MX)$/i);
  return match ? { city: match[1].trim(), state: match[2].toUpperCase(), country: match[3].toUpperCase() } : null;
};
const DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const TIME = /^\d{1,2}:\d{2}\s*[AP]M(\s*-\s*\d{1,2}:\d{2}\s*[AP]M)?$/i;

// TMS equipment code for a Navisphere equipment type (for the DAT rate lookup).
export function chEquipmentCode(type) {
  const text = String(type || '').toLowerCase();
  if (/reefer|refrig/.test(text)) return 'R';
  if (/step\s*deck/.test(text)) return 'SD';
  if (/flat/.test(text)) return 'F';
  return 'V';
}

// The lines between the previous load's Book/Offer button and this load's "Origin Information:"
// belong to this load: its load number ("Load #574648046" from the Copy CH loads bookmark, or
// "#574648046") and its "Online only" tag.
const leadIn = text => {
  const lines = String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
  const end = lines.map(line => /(^|\s)(Book or Offer|Make Offer|Book)$/i.test(line)).lastIndexOf(true);
  const tail = lines.slice(end + 1);
  const numbers = tail.map(line => line.match(/^(?:Load\s*)?#\s*(\d{6,12})$|^(\d{9})$/i)).filter(Boolean);
  return {
    loadNumber: numbers.length ? (numbers[numbers.length - 1][1] || numbers[numbers.length - 1][2]) : '',
    onlineOnly: tail.some(line => /^Online only$/i.test(line))
  };
};

// Reads pasted Navisphere Find Loads text into loads. Unreadable blocks are skipped and counted.
// Works with Ctrl+A copies ("Distance352 mi") and the Copy CH loads bookmark ("Distance\n352 mi").
export function parseNavisphereLoads(text) {
  const parts = String(text || '').replace(/\r/g, '').split(/Origin Information:\s*\n/);
  const blocks = parts.slice(1);
  const loads = [];
  let skipped = 0;
  for (const [index, block] of blocks.entries()) {
    const { loadNumber, onlineOnly } = leadIn(parts[index]);
    // This load ends at its own Book/Offer button (anything after belongs to the next load).
    const allLines = block.split('\n').map(line => line.trim()).filter(Boolean);
    const buttonAt = allLines.findIndex(line => /(^|\s)(Book or Offer|Make Offer|Book)$/i.test(line));
    const lines = buttonAt >= 0 ? allLines.slice(0, buttonAt + 1) : allLines;
    const [originPart, destinationPart = ''] = lines.join('\n').split(/Destination Information:\s*\n/);
    const originLines = originPart.split('\n');
    const destinationLines = destinationPart.split('\n');
    const origin = place(originLines[0]);
    const destination = place(destinationLines[0]);
    const dateTime = part => {
      const dateIndex = part.findIndex(line => DATE.test(line));
      return dateIndex < 0 ? { date: '', time: '' } : { date: part[dateIndex], time: TIME.test(part[dateIndex + 1] || '') ? part[dateIndex + 1] : '' };
    };
    const pickup = dateTime(originLines);
    const drop = dateTime(destinationLines);
    // "Weight43,703 lbs" (Ctrl+A copy) or "Weight" then "43,703 lbs" on the next line (bookmark).
    const field = (part, label) => {
      const at = part.findIndex(item => item.toLowerCase().startsWith(label.toLowerCase()));
      if (at < 0) return '';
      return part[at].slice(label.length).trim() || (part[at + 1] || '').trim();
    };
    const rateIndex = destinationLines.findIndex(line => /^Rate$/i.test(line));
    const rateLine = rateIndex >= 0 ? destinationLines[rateIndex + 1] || '' : '';
    const chRate = /USD/i.test(rateLine) ? number(rateLine) : null;
    const load = {
      loadNumber,
      origin, destination,
      deadheadMiles: number(field(originLines, 'Deadhead Distance from Pickup')),
      pickupDate: pickup.date, pickupTime: pickup.time,
      dropDate: drop.date, dropTime: drop.time,
      miles: number(field(destinationLines, 'Distance')),
      stops: destinationLines.find(line => /\bpicks?\b.*\bdrops?\b/i.test(line)) || '',
      weight: number(field(destinationLines, 'Weight')),
      endorsement: field(destinationLines, 'Endorsement'),
      equipment: field(destinationLines, 'Equipment Type'),
      size: field(destinationLines, 'Equipment Size'),
      chRate,
      makeOfferOnly: chRate === null,
      onlineOnly,
      // Your offer already on it: "Countered Offer", "Offer Pending", ...
      status: field(destinationLines, 'Status')
    };
    if (!origin || !destination || !load.pickupDate || !load.equipment) { skipped += 1; continue; }
    load.equipmentCode = chEquipmentCode(load.equipment);
    load.key = loadNumber || [origin.city, origin.state, destination.city, destination.state, load.pickupDate, load.pickupTime, load.equipment, load.weight].join('|');
    loads.push(load);
  }
  return { loads, skipped };
}

// Your offer: DAT rate + $500, rounded up to the next $25 step that ends in 5 - amounts ending in
// 25 or 75 ($2,057 -> $2,075, $2,400 -> $2,425; Daniel, 2026-11-25), so it never drops under
// DAT + $500. 0 with no DAT rate.
export function chOfferAmount(datRate) {
  const rate = Number(datRate) || 0;
  if (!(rate > 0)) return 0;
  const target = rate + CH_OFFER_OVER_DAT;
  return Math.ceil((target - 25) / 50) * 50 + 25;
}

// The TMS account checked CH offers go into (Daniel 2026-11-27), and so are exported to Landstar.
export const CH_TMS_ACCOUNT = 'CH 593772- ATZ H';

// "08:00 AM - 03:00 PM" -> "0800 - 1500"; "12:00 PM" -> "1200 - 1200" (the Landstar export
// widens a single time to one hour). '' when there is no time.
export function chTimeRange(text) {
  const times = String(text || '').match(/\d{1,2}:\d{2}\s*[AP]M/gi) || [];
  const to24 = time => {
    const [, hour, minute, half] = time.match(/(\d{1,2}):(\d{2})\s*([AP])M/i);
    const value = (Number(hour) % 12) + (/p/i.test(half) ? 12 : 0);
    return `${String(value).padStart(2, '0')}${minute}`;
  };
  if (!times.length) return '';
  return `${to24(times[0])} - ${to24(times[1] || times[0])}`;
}

// A checked CH offer -> a TMS load for CH 593772- ATZ H. It posts at CH's own rate (the
// "BIN", like CH loads from Gmail); a "Make Offer" load has no CH rate, so it posts at your
// offer (DAT + $500). Added like a hand-entered load: list imports never delete it.
export function chOfferToTmsLoad(load) {
  const hazmat = /haz/i.test(load.endorsement || '');
  const code = load.equipmentCode || chEquipmentCode(load.equipment);
  const eCode = hazmat ? (code === 'R' ? 'RZ' : code === 'F' ? 'FV' : 'VZ') : code;
  const pickupRange = chTimeRange(load.pickupTime) || '0800 - 1600';
  const dropRange = chTimeRange(load.dropTime) || '0800 - 1600';
  const upper = value => String(value || '').toUpperCase();
  const binRate = load.chRate > 0;
  const rate = binRate ? load.chRate : load.offer;
  return {
    id: String(load.loadNumber || '').trim() || `CH-${String(load.key || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`,
    eCode,
    status: 'OPEN', tag: 'OPEN',
    route: `${upper(load.origin.city)}, ${upper(load.origin.state)} → ${upper(load.destination.city)}, ${upper(load.destination.state)}`,
    puDate: `PU: ${load.pickupDate}`,
    delDate: load.dropDate ? `DFL: ${load.dropDate}` : 'DFL: Upcoming',
    pickupTime: `${load.pickupDate} ${pickupRange}`,
    deliveryTime: load.dropDate ? `${load.dropDate} ${dropRange}` : '',
    origCity: upper(load.origin.city), origSt: upper(load.origin.state), origZip: '',
    destCity: upper(load.destination.city), destSt: upper(load.destination.state), destZip: '',
    weight: load.weight > 0 ? `${load.weight} lbs` : '',
    miles: load.miles > 0 ? String(load.miles) : '',
    rateInput: rate > 0 ? String(Math.round(rate)) : '',
    ...(rate > 0 ? { rateSource: binRate ? 'customer-bin' : 'user-entered' } : {}),
    ...(hazmat ? { hazmat: 'true' } : {}),
    brokerable: 'false',
    planningComment: 'From CH Offers (Navisphere)',
    notes: [load.stops && load.stops !== '1 pick, 1 drop' ? load.stops : '', load.endorsement ? `Endorsement: ${load.endorsement}` : '', binRate ? '' : `Make Offer load: posted at your offer (DAT ${load.datRate ? `$${Math.round(load.datRate)}` : 'n/a'} + $${CH_OFFER_OVER_DAT})`]
      .filter(Boolean).join(' · '),
    chOfferKey: load.key
  };
}

// CH 593772- ATZ H loads exported to Landstar today, newest first (the "New lanes" tab).
export function getTodaysExportedLanes(loads, now = new Date()) {
  const day = date => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const today = day(now);
  return (loads || [])
    .filter(load => {
      const at = Date.parse(load?.landstarExportedAt || '');
      return Number.isFinite(at) && day(new Date(at)) === today;
    })
    .sort((a, b) => Date.parse(b.landstarExportedAt) - Date.parse(a.landstarExportedAt));
}

// Search box: every word must appear somewhere in the load (city, state, load #, equipment,
// dates, rate...). Works for CH offers and TMS loads.
export function chLoadMatchesSearch(load, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [
    load.loadNumber, load.id, load.origin?.city, load.origin?.state, load.destination?.city, load.destination?.state,
    load.origCity, load.origSt, load.destCity, load.destSt, load.equipment, load.eCode, load.endorsement,
    load.pickupDate, load.pickupTime, load.dropDate, load.status, load.chRate, load.offer, load.rateInput, load.weight, load.miles
  ].filter(value => value !== undefined && value !== null && value !== '').join(' ').toLowerCase();
  return words.every(word => text.includes(word));
}

// Lane + equipment key for sharing one DAT lookup between identical lanes.
export function chLaneKey(load) {
  return [load.origin.city, load.origin.state, load.destination.city, load.destination.state, load.equipmentCode].join('|').toUpperCase();
}
