// Single loads Tyler Cook posts as messages in LANDJA18 (RXO), besides his spreadsheet lists
// (Daniel 2026-11-27). A message looks like:
//
//   need a solid driver for this one -
//   Load Number: 24837921
//   Load Date: 11/30/2026
//   Pickup: Charlotte NC, 28208 USA
//   Pickup: 11/30/2026 10:00 - 13:00
//   Delivery: Cincinnati OH, 45238 USA
//   Delivery: 12/01/2026 08:00
//   Distance: 478 mi
//   Equipment: Van - 53 Feet
//   Expected Weight: 20000 lbs
//
//   $1500
//
// Rules (Daniel 2026-11-27): the account follows the equipment (van -> ATZ V, reefer -> ATZ R,
// flatbed/step deck -> ATZ F, hazmat -> ATZ H); it posts at the higher of Tyler's price and
// the DAT rate (the upload bot then beats anyone higher on the board by $25); it exports to
// Landstar by itself; a later spreadsheet with the same load number keeps one copy.

const DATE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;

// "Charlotte NC, 28208 USA" / "Charlotte, NC 28208" -> { city, state, zip }.
function readPlace(text) {
  const match = String(text || '').match(/^\s*(.+?)[,\s]+([A-Z]{2})\b[,\s]*(\d{5})?/);
  if (!match) return null;
  return { city: match[1].replace(/,\s*$/, '').trim().toUpperCase(), state: match[2].toUpperCase(), zip: match[3] || '' };
}

// "11/30/2026 10:00 - 13:00" -> "11/30/2026 1000 - 1300"; "12/01/2026 08:00" -> "12/01/2026 0800 - 0800".
function readSchedule(text) {
  const date = String(text || '').match(DATE);
  if (!date) return '';
  const times = String(text).slice(date.index + date[0].length).match(/\d{1,2}:\d{2}(?:\s*[AP]M)?/gi) || [];
  const to24 = time => {
    const [, hour, minute, half = ''] = time.match(/(\d{1,2}):(\d{2})\s*([AP]M)?/i);
    let value = Number(hour);
    if (/p/i.test(half) && value < 12) value += 12;
    if (/a/i.test(half) && value === 12) value = 0;
    return `${String(value).padStart(2, '0')}${minute}`;
  };
  const first = times[0] ? to24(times[0]) : '0800';
  const last = times[1] ? to24(times[1]) : times[0] ? first : '1600';
  return `${date[1].padStart(2, '0')}/${date[2].padStart(2, '0')}/${date[3]} ${first} - ${last}`;
}

// TMS equipment code: V, R, F, SD; hazmat versions VZ, RZ, FV.
export function chatLoadEquipmentCode(equipment, text = '') {
  const value = String(equipment || '').toLowerCase();
  const hazmat = /\bhaz(mat)?\b/i.test(`${equipment} ${text}`);
  let code = 'V';
  if (/reefer|refrig/.test(value)) code = 'R';
  else if (/step\s*deck/.test(value)) code = 'SD';
  else if (/flat/.test(value)) code = 'F';
  if (!hazmat) return code;
  return code === 'R' ? 'RZ' : code === 'V' ? 'VZ' : 'FV';
}

// Reads one message. Returns null when it is not a load (needs a load number, both places
// and a pickup date).
export function parseChatLoadMessage(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean);
  const value = label => lines.filter(line => new RegExp(`^${label}\\s*:`, 'i').test(line))
    .map(line => line.replace(new RegExp(`^${label}\\s*:\\s*`, 'i'), '').trim());
  const loadNumber = (value('Load Number')[0] || '').match(/\d{5,12}/)?.[0] || '';
  const pickups = value('Pickup');
  const deliveries = value('Delivery');
  const origin = readPlace(pickups.find(line => !DATE.test(line)));
  const destination = readPlace(deliveries.find(line => !DATE.test(line)));
  const pickupTime = readSchedule(pickups.find(line => DATE.test(line)) || value('Load Date')[0]);
  const deliveryTime = readSchedule(deliveries.find(line => DATE.test(line)));
  if (!loadNumber || !origin || !destination || !pickupTime) return null;
  const equipment = value('Equipment')[0] || 'Van';
  // The price is a line with just "$1500" (or "$1,500"), usually at the end.
  const priceLine = [...lines].reverse().find(line => /^\$\s*[\d,]+(?:\.\d+)?$/.test(line));
  return {
    loadNumber,
    origin, destination,
    pickupTime, deliveryTime,
    miles: Number((value('Distance')[0] || '').replace(/[^\d.]/g, '')) || 0,
    equipment,
    equipmentCode: chatLoadEquipmentCode(equipment, raw),
    weight: Number((value('(?:Expected )?Weight')[0] || '').replace(/[^\d.]/g, '')) || 0,
    price: priceLine ? Number(priceLine.replace(/[^\d.]/g, '')) : 0
  };
}

// Which RXO account a single load goes into, by its equipment.
export function chatLoadAccount(load) {
  const code = load?.equipmentCode || 'V';
  if (/Z$|^FV$/.test(code)) return 'R X O 2429200 - ATZ H';
  if (code === 'R') return 'R X O 2429200 - ATZ R';
  if (code === 'F' || code === 'SD') return 'R X O 2429200 - ATZ F';
  return 'R X O 2429200 - ATZ V';
}

// The posted rate: the higher of Tyler's price and the DAT rate (0 when neither is known).
export function chatLoadRate(price, datRate) {
  return Math.round(Math.max(Number(price) || 0, Number(datRate) || 0));
}

// A TMS load for the account (the caller adds it like a hand-entered load, so the list
// imports keep one copy and never delete it).
export function chatLoadToTmsLoad(load, datRate = 0) {
  const rate = chatLoadRate(load.price, datRate);
  const date = time => String(time || '').split(' ')[0];
  const hazmat = /Z$|^FV$/.test(load.equipmentCode);
  return {
    id: load.loadNumber,
    eCode: load.equipmentCode,
    status: 'OPEN', tag: 'OPEN',
    route: `${load.origin.city}, ${load.origin.state} → ${load.destination.city}, ${load.destination.state}`,
    puDate: `PU: ${date(load.pickupTime)}`,
    delDate: load.deliveryTime ? `DFL: ${date(load.deliveryTime)}` : 'DFL: Upcoming',
    pickupTime: load.pickupTime,
    deliveryTime: load.deliveryTime,
    origCity: load.origin.city, origSt: load.origin.state, origZip: load.origin.zip,
    destCity: load.destination.city, destSt: load.destination.state, destZip: load.destination.zip,
    weight: load.weight > 0 ? `${load.weight} lbs` : '',
    miles: load.miles > 0 ? String(load.miles) : '',
    rateInput: rate > 0 ? String(rate) : '',
    ...(rate > 0 ? { rateSource: 'user-entered' } : {}),
    ...(hazmat ? { hazmat: 'true' } : {}),
    brokerable: 'false',
    planningComment: 'From LANDJA18 (single load)',
    notes: `RXO price $${load.price || 'n/a'}; DAT $${Math.round(Number(datRate) || 0) || 'n/a'}; posted at the higher.`
  };
}
