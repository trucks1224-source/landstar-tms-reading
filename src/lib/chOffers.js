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

// Lane + equipment key for sharing one DAT lookup between identical lanes.
export function chLaneKey(load) {
  return [load.origin.city, load.origin.state, load.destination.city, load.destination.state, load.equipmentCode].join('|').toUpperCase();
}
