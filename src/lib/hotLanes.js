// Hot lanes (Daniel's request, 2026-11-24): lanes other Landstar agents are booking, from an
// RXO "orderSearch_Export" spreadsheet. Any load of ours on one of those lanes gets a 🔥 badge
// and sorts to the top of the load list, so we stay on top of it.

export const hotLanesKey = 'landstar_hotLanes';

const CITY_WORDS = { ST: 'SAINT', STE: 'SAINTE', FT: 'FORT', MT: 'MOUNT', N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST' };

// "N. Las Vegas" / "North Las Vegas", "St Louis" / "Saint Louis", "Ft Worth" / "Fort Worth" match.
export function normalizeLaneCity(city) {
  return String(city || '').toUpperCase().replace(/[.,']/g, ' ').split(/\s+/).filter(Boolean)
    .map(word => CITY_WORDS[word] || word).join(' ');
}

export function hotLaneKey(origCity, origSt, destCity, destSt) {
  const state = value => String(value || '').trim().toUpperCase();
  const parts = [normalizeLaneCity(origCity), state(origSt), normalizeLaneCity(destCity), state(destSt)];
  return parts.every(Boolean) ? `${parts[0]}, ${parts[1]}>${parts[2]}, ${parts[3]}` : '';
}

const money = value => {
  const number = Number(String(value ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const shortAgent = name => String(name || '').replace(/^LANDSTAR RANGER INC\s*\(?/i, '').replace(/\)\s*$/, '').trim();

// rows: objects keyed by the export's column headers (sheet_to_json default).
// Returns { lanes: { [key]: { origin, destination, count, agents, avgPay, lastPickup } }, rows }.
export function buildHotLanes(rows) {
  const lanes = {};
  let used = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = hotLaneKey(row['Origin - City'], row['Origin - State'], row['Destination - City'], row['Destination - State']);
    if (!key) continue;
    used += 1;
    const lane = lanes[key] || (lanes[key] = {
      origin: `${String(row['Origin - City']).trim()}, ${String(row['Origin - State']).trim().toUpperCase()}`,
      destination: `${String(row['Destination - City']).trim()}, ${String(row['Destination - State']).trim().toUpperCase()}`,
      count: 0, agents: [], payTotal: 0, payCount: 0, minPay: 0, maxPay: 0, lastPickup: '', lastPay: 0
    });
    lane.count += 1;
    const agent = shortAgent(row['Carrier Name']);
    if (agent && !lane.agents.includes(agent)) lane.agents.push(agent);
    // The rate the other agent booked the truck at (carrier line haul pay).
    const pay = money(row['Carrier Line Haul Pay Current']);
    if (pay) {
      lane.payTotal += pay;
      lane.payCount += 1;
      lane.minPay = lane.minPay ? Math.min(lane.minPay, pay) : pay;
      lane.maxPay = Math.max(lane.maxPay, pay);
    }
    const pickup = Date.parse(row['Pickup Time']);
    if (Number.isFinite(pickup) && (!lane.lastPickup || pickup > Date.parse(lane.lastPickup))) {
      lane.lastPickup = new Date(pickup).toISOString();
      if (pay) lane.lastPay = pay;
    }
  }
  for (const lane of Object.values(lanes)) {
    lane.avgPay = lane.payCount ? Math.round(lane.payTotal / lane.payCount) : 0;
    delete lane.payTotal;
    delete lane.payCount;
  }
  return { lanes, rows: used };
}

export function getHotLane(load, hotLanes) {
  const lanes = hotLanes?.lanes;
  if (!lanes || !load) return null;
  return lanes[hotLaneKey(load.origCity, load.origSt, load.destCity, load.destSt)] || null;
}

const dollars = value => `$${Math.round(value).toLocaleString('en-US')}`;

// Short rate for the badge: the average booked rate, or "" when the export had none.
export function hotLaneRate(lane) {
  return lane?.avgPay ? dollars(lane.avgPay) : '';
}

export function describeHotLane(lane) {
  if (!lane) return '';
  const range = lane.minPay && lane.maxPay && lane.minPay !== lane.maxPay ? ` (range ${dollars(lane.minPay)}–${dollars(lane.maxPay)})` : '';
  return `${lane.origin} → ${lane.destination}: booked ${lane.count}× by other agents`
    + `${lane.agents.length ? ` (${lane.agents.join(', ')})` : ''}`
    + `${lane.avgPay ? `. Booked at avg ${dollars(lane.avgPay)}${range}` : ''}`
    + `${lane.lastPickup ? `. Last pickup ${new Date(lane.lastPickup).toLocaleDateString('en-US')}${lane.lastPay ? ` at ${dollars(lane.lastPay)}` : ''}` : ''}`;
}
