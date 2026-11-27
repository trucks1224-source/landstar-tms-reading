// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { normalizeCustomerName } from '../lib/trackingEmails.js';
import { isAmeriCustomer, fixedLaneRates, ameriMenardsStops, ameriPickupHours, applyAmeriLoadDefaults } from './laneRates.js';
import { stateCodes, editDistance } from './screenshotParsers.js';

// ==========================================
// CITY/STATE GRID SCREENSHOTS (AMERI 18347- ATZ and other shipper-portal lists)
// ==========================================
// Columns: Origin city | Origin state | Dest city | Dest st | Early P/U dt | Early del dt.
// No load numbers. OCR of these grids is noisy (2026-11-25, AMERI screenshots): cell borders
// read as "[" or "|", spaces vanish ("SANTJAMES"), states garble ("hz" = AZ, "JL" = IL,
// "|A" = IA, "Wv" = WY) and highlighted rows lose their slashes ("1124120260600" =
// 11/24/2026 0600). Each city is matched to a real place: the customer's rate-sheet lanes
// first, then the ZIP database's cities in that state (or nearby state codes).
function isCityGridScreenshot(lineTexts) {
  return lineTexts.some(text => /origin\s*c\w*/i.test(text) && /dest/i.test(text));
}

const ocrStateLookalikes = { I: 'TLJ', J: 'I', L: 'I', T: 'I', V: 'Y', Y: 'V', H: 'A', '|': 'I', 1: 'I' };

// OCR date like 11/30/2026 0600, 12/0412026 0600, 1112412026 0600 or 1124120260600.
function readCityGridDates(text) {
  const dates = [];
  const pattern = /(\d{1,2})[/1Il|]?(\d{2})[/1Il|](20\d{2})\s*(\d{4})?/g;
  let match;
  while ((match = pattern.exec(text))) {
    const [, month, day, year, time] = match;
    if (Number(day) < 1 || Number(day) > 31) continue;
    dates.push({ month: Number(month), day: Number(day), year: Number(year), time: time || '', index: match.index });
  }
  return dates;
}

function parseCityGridScreenshotText(lineTexts, zipData, customer) {
  const letters = value => String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
  const known = [];
  fixedLaneRates.filter(lane => lane.customer && normalizeCustomerName(lane.customer) === normalizeCustomerName(customer))
    .forEach(lane => {
      known.push({ city: lane.origCity, state: lane.origSt });
      known.push({ city: lane.destCity, state: lane.destSt });
    });
  if (isAmeriCustomer(customer)) {
    [...Object.keys(ameriPickupHours), ...ameriMenardsStops].forEach(key => {
      const [city, state] = key.split('|');
      known.push({ city, state });
    });
  }
  const cityCache = new Map();
  const citiesIn = state => {
    if (!cityCache.has(state)) {
      const names = new Set((zipData?.lookupByState?.(state) || []).map(item => String(item.city || '').toUpperCase()));
      known.filter(place => place.state === state).forEach(place => names.add(place.city));
      cityCache.set(state, [...names].map(name => ({ name, key: letters(name), known: known.some(place => place.state === state && place.city === name) })));
    }
    return cityCache.get(state);
  };
  const stateCandidates = raw => {
    let code = String(raw || '').toUpperCase().replace(/[^A-Z|1]/g, '');
    if (code.length === 3 && /^[LIJ|]/.test(code)) code = code.slice(1);
    const out = new Map();
    if (stateCodes.has(code)) out.set(code, 0);
    const lookalike = code.split('').map(char => [char, ...(ocrStateLookalikes[char] || '')]);
    if (code.length === 2) {
      lookalike[0].forEach(a => lookalike[1].forEach(b => { if (stateCodes.has(a + b) && !out.has(a + b)) out.set(a + b, 0.02); }));
    }
    stateCodes.forEach(state => {
      if (!out.has(state) && code && editDistance(code, state) <= 1) out.set(state, 0.05);
    });
    return out;
  };
  // Best real place for an OCR city (letters, possibly truncated with "..") in the given states.
  const matchCity = (ocrText, states) => {
    const truncated = /\.\s*\.?\s*$|…/.test(String(ocrText).trim());
    const raw = letters(ocrText);
    if (raw.length < 3) return null;
    const variants = [raw];
    if (/^[IJL]/.test(raw) && raw.length > 4) variants.push(raw.slice(1));
    let best = null;
    states.forEach((penalty, state) => {
      citiesIn(state).forEach(city => {
        variants.forEach((variant, variantIndex) => {
          if (truncated && city.key.length < variant.length) return;
          const target = truncated ? city.key.slice(0, variant.length) : city.key;
          const distance = editDistance(variant, target);
          const limit = variant.length >= 6 ? 2 : 1;
          if (distance > limit) return;
          const score = 1 - distance / Math.max(variant.length, target.length) - penalty
            + (city.known ? 0.05 : 0) - (variantIndex ? 0.03 : 0);
          if (score >= 0.72 && (!best || score > best.score)) best = { city: city.name, state, score };
        });
      });
    });
    return best;
  };
  const allStates = new Map([...stateCodes].map(state => [state, 0.08]));
  const pad = value => String(value).padStart(2, '0');
  const loads = [];
  const skippedRows = [];
  const laneDayCounts = new Map();
  lineTexts.forEach(rawText => {
    const text = String(rawText || '').replace(/[[\]{}~_¥—–“”"'’`]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || /origin\s*c/i.test(text)) return;
    let dates = readCityGridDates(text);
    if (!/^[A-Za-z|]/.test(text)) return;
    if (dates.length < 2) {
      skippedRows.push(`${text} (pickup or delivery date not readable)`);
      return;
    }
    dates = dates.slice(0, 2);
    // A lost leading "1" (2/02 for 12/02) shows up as a month far before the other date's.
    const [pickup, delivery] = dates;
    [[pickup, delivery], [delivery, pickup]].forEach(([date, other]) => {
      if (date.month <= 2 && other.month >= 11 && date.month + 10 <= 12) date.month += 10;
    });
    if (dates.some(date => date.month < 1 || date.month > 12)) {
      skippedRows.push(`${text} (date not readable)`);
      return;
    }
    const words = text.slice(0, pickup.index).replace(/[|]/g, ' ').split(/\s+/).filter(token => /[A-Za-z]/.test(token));
    // A state is a short token; a border read in front of it can add a letter ("liz" = AZ).
    const isStateToken = token => !/\.\./.test(token)
      && (letters(token).length <= 2 || letters(token).length === 3 && /^[LIJ|]/i.test(token));
    // Origin: the first place on the row; destination: the rest. States are the short tokens.
    let origin = null;
    let destWords = [];
    let destStateRaw = '';
    const originStateIndex = words.findIndex((token, index) => index > 0 && isStateToken(token));
    if (originStateIndex > 0) {
      origin = matchCity(words.slice(0, originStateIndex).join(' '), stateCandidates(words[originStateIndex]));
      const rest = words.slice(originStateIndex + 1);
      if (rest.length > 1 && isStateToken(rest[rest.length - 1])) {
        destStateRaw = rest[rest.length - 1];
        destWords = rest.slice(0, -1);
      } else {
        destWords = rest;
      }
    } else {
      // No readable origin state: try the first word as the origin city anywhere.
      origin = matchCity(words[0] || '', allStates);
      destWords = words.slice(1);
      if (destWords.length > 1 && isStateToken(destWords[destWords.length - 1])) destStateRaw = destWords.pop();
    }
    const destination = destWords.length
      ? matchCity(destWords.join(' '), destStateRaw ? stateCandidates(destStateRaw) : allStates)
        || (destStateRaw ? matchCity(destWords.join(' '), allStates) : null)
      : null;
    if (!origin || !destination) {
      skippedRows.push(`${text} (${!origin ? 'origin' : 'destination'} city not readable)`);
      return;
    }
    const dateText = date => `${pad(date.month)}/${pad(date.day)}/${date.year}${date.time ? ` ${date.time}` : ''}`;
    const laneDay = `${pad(pickup.month)}${pad(pickup.day)}${letters(destination.city).slice(0, 3)}`;
    const count = (laneDayCounts.get(laneDay) || 0) + 1;
    laneDayCounts.set(laneDay, count);
    loads.push(applyAmeriLoadDefaults(customer, {
      id: `${laneDay}${count}`,
      eCode: isAmeriCustomer(customer) ? 'VR' : 'V',
      status: 'OPEN',
      tag: 'OPEN',
      route: `${origin.city}, ${origin.state} → ${destination.city}, ${destination.state}`,
      puDate: `PU: ${dateText(pickup)}`,
      delDate: `DFL: ${dateText(delivery)}`,
      pickupTime: dateText(pickup),
      origCity: origin.city,
      origSt: origin.state,
      origZip: '',
      weight: '',
      deliveryTime: dateText(delivery),
      destCity: destination.city,
      destSt: destination.state,
      destZip: '',
      miles: '',
      planningComment: '',
      carrier: '',
      driver: '',
      truck: '',
      trailer: '',
      rateInput: '',
      brokerable: 'false',
      notes: ''
    }));
  });
  return { loads, skippedRows };
}

export {
  isCityGridScreenshot,
  ocrStateLookalikes,
  readCityGridDates,
  parseCityGridScreenshotText
};
