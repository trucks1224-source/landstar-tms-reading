// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { normalizeCustomerName } from '../lib/trackingEmails.js';

// AMERI 18347- ATZ (exact account; Daniel 2026-11-25): every load ships from Colony, WY.
// Contractor rates from "americo rates.xlsx": the Rate column, never the Notes column. A lane's
// "Got $X on 11/xx" note (an amount already approved) goes on imported loads as a Planning
// Comment, not into the rate (Daniel, 2026-11-25). Flatbed-only rates
// (Tacoma $2,800, Lovell $1,400) are left out: the list doesn't say the equipment.
const ameriCustomerKey = 'AMERI18347ATZ';

function isAmeriCustomer(name) {
  return normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, '') === ameriCustomerKey;
}

const ameriColonyRates = [
  ['BENTONVILLE', 'AR', 3000], ['BUCKEYE', 'AZ', 4100], ['APPLE VALLEY', 'CA', 4000],
  ['RED BLUFF', 'CA', 4500, 'Got $4,800 approved on 11/19'], ['PORTERVILLE', 'CA', 4000], ['LOVELAND', 'CO', 1800],
  ['MOUNT PLEASANT', 'IA', 2600], ['SHELL ROCK', 'IA', 2000], ['PLANO', 'IL', 2200],
  ['GRANITE CITY', 'IL', 2150], ['SPRING VALLEY', 'IL', 2800], ['TERRE HAUTE', 'IN', 2850],
  ['SEYMOUR', 'IN', 3000, 'Got $3,800 approved on 11/18'], ['OTTAWA', 'KS', 2400], ['SAGINAW', 'MI', 3400],
  ['SAINT JAMES', 'MO', 3000], ['SULLIVAN', 'MO', 2700], ['MCKENZIE', 'ND', 1000],
  ['VALLEY', 'NE', 1600], ['WASHINGTON COURT HOUSE', 'OH', 3400], ['HOLIDAY CITY', 'OH', 3000],
  ['HERMISTON', 'OR', 3500, 'Got $4,100 approved on 11/16'], ['SEALY', 'TX', 3700], ['PALESTINE', 'TX', 4000, 'Got $4,300 approved on 11/18'],
  ['PLAINVIEW', 'TX', 2900], ['NEW BRAUNFELS', 'TX', 4000, 'Got $4,400 approved on 11/18'], ['SANGER', 'TX', 3500, 'Got $3,500 approved on 11/18'],
  ['GRANTSVILLE', 'UT', 2700, 'Got $3,000 approved on 11/23'], ['EAU CLAIRE', 'WI', 1650], ['IRON RIDGE', 'WI', 2100],
  ['MENOMONIE', 'WI', 1900], ['BEAVER DAM', 'WI', 2500], ['SEATTLE', 'WA', 2400],
  ['FIFE', 'WA', 2500], ['LOVELL', 'WY', 1200]
].map(([destCity, destSt, rate, approved]) => ({
  customer: 'AMERI 18347- ATZ', origCity: 'COLONY', origSt: 'WY', destCity, destSt, rate: String(rate),
  ...(approved ? { approved } : {})
}));

// AMERI 18347- ATZ loads picking up in York, PA (the sheet's "York PA" tab).
const ameriYorkRates = [
  ['RAYMOND', 'NH', 2200], ['SHELBY', 'NC', 1350], ['HOPE MILLS', 'NC', 1500],
  ['FORT PIERCE', 'FL', 4100], ['ALACHUA', 'FL', 3400], ['LAGRANGE', 'GA', 2200],
  ['DOUGLAS', 'GA', 2100], ['SUTHERLAND', 'VA', 1000], ['MIAMI', 'FL', 4100], ['SMYRNA', 'DE', 800]
].map(([destCity, destSt, rate]) => ({
  customer: 'AMERI 18347- ATZ', origCity: 'YORK', origSt: 'PA', destCity, destSt, rate: String(rate)
}));

// Fixed lane-rate overrides: these lanes always pay the listed amount.
const fixedLaneRates = [
  { origSt: 'ID', destSt: 'FL', rate: '11000' },
  ...ameriColonyRates,
  ...ameriYorkRates
];

// AMERI 18347- ATZ load details its list doesn't show (Daniel, 2026-11-25):
// - Menards loads weigh 43,500 lbs and deliver 7 AM to 9 PM; every other load is 41,500 lbs.
//   Menards stops are the rate sheet's "Menards 7am - 9pm FCFS" destinations.
// - Pickups use the shipping location's hours ("americo rates - Colony WY" pickup list);
//   Colony is the West Plant, 6 AM to 11 PM. Tilden, TX is by appointment only.
const ameriMenardsStops = new Set([
  'SHELL ROCK|IA', 'TERRE HAUTE|IN', 'SAGINAW|MI', 'SULLIVAN|MO', 'MCKENZIE|ND', 'VALLEY|NE',
  'WASHINGTON COURT HOUSE|OH', 'HOLIDAY CITY|OH', 'EAU CLAIRE|WI', 'IRON RIDGE|WI'
]);

const ameriPickupHours = {
  'LOVELL|WY': ['0700', '1400'], 'COLONY|WY': ['0600', '2300'], 'DILLON|MT': ['0800', '1800'],
  'GREEN RIVER|WY': ['0700', '1700'], 'CHEYENNE|WY': ['0700', '1400'], 'TILDEN|TX': ['0700', '1400'],
  'MILWAUKEE|WI': ['0700', '1430'], 'YORK|PA': ['0600', '2000'], 'CEDARBURG|WI': ['0700', '1400'],
  'PHOENIX|AZ': ['0700', '1500'], 'ROCKFORD|IL': ['0730', '1500'], 'CARTERSVILLE|GA': ['0700', '1400'],
  'EATON|CO': ['0700', '1500'], 'EVANSVILLE|IN': ['0700', '1500'], 'SCOTT CITY|MO': ['0800', '1600'],
  'SEATTLE|WA': ['0700', '1500'], 'NEENAH|WI': ['0700', '1400'], 'WINCHESTER|KY': ['0730', '1430'],
  'GREYBULL|WY': ['0800', '2100'], 'VALLEY|NE': ['0700', '2100'], 'SCRANTON|ND': ['0700', '1400'],
  'GRANITE CITY|IL': ['0800', '1530']
};

const AMERI_MENARDS_WEIGHT = '43500 lbs';

const AMERI_WEIGHT = '41500 lbs';

function ameriPlaceKey(city, state) {
  return `${String(city || '').trim().toUpperCase().replace(/\s+/g, ' ')}|${String(state || '').trim().toUpperCase()}`;
}

function isAmeriMenardsLoad(load) {
  return ameriMenardsStops.has(ameriPlaceKey(load?.destCity, load?.destSt));
}

// Fills weight and pickup/delivery windows on an imported AMERI load (other customers unchanged).
function applyAmeriLoadDefaults(customer, load) {
  if (!isAmeriCustomer(customer)) return load;
  const dateOf = value => String(value || '').match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/)?.[0] || '';
  const menards = isAmeriMenardsLoad(load);
  const next = { ...load, weight: menards ? AMERI_MENARDS_WEIGHT : AMERI_WEIGHT };
  // The amount already approved on this lane (rate sheet note), shown on the load.
  const lane = fixedLaneRates.find(entry => entry.approved && entry.customer === 'AMERI 18347- ATZ'
    && normalizeFixedLaneCity(entry.origCity) === normalizeFixedLaneCity(load.origCity) && entry.origSt === String(load.origSt || '').toUpperCase()
    && normalizeFixedLaneCity(entry.destCity) === normalizeFixedLaneCity(load.destCity) && entry.destSt === String(load.destSt || '').toUpperCase());
  if (lane && !String(load.planningComment || '').includes(lane.approved)) {
    next.planningComment = load.planningComment ? `${lane.approved}; ${load.planningComment}` : lane.approved;
  }
  const hours = ameriPickupHours[ameriPlaceKey(load.origCity, load.origSt)];
  const pickupDate = dateOf(load.pickupTime);
  if (hours && pickupDate) next.pickupTime = `${pickupDate} ${hours[0]} - ${hours[1]}`;
  const deliveryDate = dateOf(load.deliveryTime);
  if (menards && deliveryDate) next.deliveryTime = `${deliveryDate} 0700 - 2100`;
  return next;
}

// City names compare without spaces/punctuation, and "Mt"/"St"/"Ft" match "Mount"/"Saint"/"Fort".
function normalizeFixedLaneCity(value) {
  return String(value || '').trim().toUpperCase()
    .replace(/^MT\.?\s+/, 'MOUNT ').replace(/^ST\.?\s+/, 'SAINT ').replace(/^FT\.?\s+/, 'FORT ')
    .replace(/[^A-Z0-9]/g, '');
}

function getFixedLaneRate(customer, order) {
  const text = value => String(value || '').trim().toUpperCase();
  const match = fixedLaneRates.find(lane =>
    (!lane.customer || normalizeCustomerName(lane.customer).toUpperCase().replace(/[^A-Z0-9]/g, '')
      === normalizeCustomerName(customer).toUpperCase().replace(/[^A-Z0-9]/g, ''))
    && (!lane.origSt || text(order.origSt) === lane.origSt)
    && (!lane.destSt || text(order.destSt) === lane.destSt)
    && (!lane.origCity || normalizeFixedLaneCity(order.origCity) === normalizeFixedLaneCity(lane.origCity))
    && (!lane.destCity || normalizeFixedLaneCity(order.destCity) === normalizeFixedLaneCity(lane.destCity)));
  return match ? match.rate : '';
}

function createLaneRateKey(customer, order) {
  const normalize = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const origin = normalize(order.origCity);
  const destination = normalize(order.destCity);
  if (!origin || !destination) return '';
  return JSON.stringify([
    normalizeCustomerName(customer),
    origin,
    normalize(order.origSt),
    '',
    destination,
    normalize(order.destSt),
    '',
    normalize(order.eCode)
  ]);
}

function getSavedLaneRate(laneRates, customer, order) {
  const fixedRate = getFixedLaneRate(customer, order);
  if (fixedRate) return fixedRate;
  const key = createLaneRateKey(customer, order);
  if (!key) return '';
  if (laneRates[key]) return laneRates[key];
  // Older saved keys include ZIPs. Keep that history usable without rewriting it.
  for (const [savedKey, rate] of Object.entries(laneRates).reverse()) {
    let parts;
    try {
      parts = JSON.parse(savedKey);
    } catch (error) {
      console.error('Could not read a saved lane-rate key:', savedKey, error);
      continue;
    }
    if (!Array.isArray(parts) || parts.length !== 8) continue;
    const legacyOrder = {
      origCity: parts[1], origSt: parts[2], destCity: parts[4], destSt: parts[5], eCode: parts[7]
    };
    if (createLaneRateKey(parts[0], legacyOrder) === key && rate) return rate;
  }
  return '';
}

export {
  ameriCustomerKey,
  isAmeriCustomer,
  ameriColonyRates,
  ameriYorkRates,
  fixedLaneRates,
  ameriMenardsStops,
  ameriPickupHours,
  AMERI_MENARDS_WEIGHT,
  AMERI_WEIGHT,
  ameriPlaceKey,
  isAmeriMenardsLoad,
  applyAmeriLoadDefaults,
  normalizeFixedLaneCity,
  getFixedLaneRate,
  createLaneRateKey,
  getSavedLaneRate
};
