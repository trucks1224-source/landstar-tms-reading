import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from './lib/supabase';
import { detectScreenshotGrid, readScreenshotGrid } from './lib/screenshotTable.js';
import { findNtgCardRegions } from './lib/ntgCards.js';
import { createEmailWorker, describeEmailWorker } from './lib/emailWorker.js';
import Prospects from './Prospects.jsx';
import automationPolicy from '../bot/automation-policy.json';

const exportedLoadRetentionMs = 30 * 24 * 60 * 60 * 1000;
// Landstar's bulk upload accepts at most 25 loads per spreadsheet.
const landstarExportChunkSize = 25;

// ==========================================
// ZIP CODE AUTO-FILL DICTIONARY & HELPER
// ==========================================
const zipDatabase = {
  "PARCHMENT, MI": "49004",
  "STONE MOUNTAIN, GA": "30083",
  // 08520 is filed under Hightstown in the offline ZIP data.
  "EAST WINDSOR, NJ": "08520",
  // Add other recurring lanes or missing cities here as needed:
};

// CANADIAN POSTAL CODE AUTO-FILL (the zipcodes package is US-only)
// Key: "CITY, PROVINCE" (uppercase). Value: a representative postal code.
// Add recurring Canadian lanes here as they come up.
const canadianPostalDatabase = {
  // Quebec
  "ST JN S RICHELIEU, QC": "J3B 1A1",
  "SAINT JEAN SUR RICHELIEU, QC": "J3B 1A1",
  "ST JEAN SUR RICHELIEU, QC": "J3B 1A1",
  "MONTREAL, QC": "H1A 0A1",
  "QUEBEC, QC": "G1A 0A1",
  "QUEBEC CITY, QC": "G1A 0A1",
  "LAVAL, QC": "H7A 0A1",
  "GATINEAU, QC": "J8P 0A1",
  "LONGUEUIL, QC": "J3Y 0A1",
  "SHERBROOKE, QC": "J1H 0A1",
  "TROIS RIVIERES, QC": "G8T 0A1",
  "DRUMMONDVILLE, QC": "J2A 0A1",
  "GRANBY, QC": "J2G 0A1",
  "SAINT HYACINTHE, QC": "J2R 0A1",
  "BROSSARD, QC": "J4W 0A1",
  // Ontario
  "TORONTO, ON": "M1A 0A1",
  "MISSISSAUGA, ON": "L4T 0A1",
  "BRAMPTON, ON": "L6P 0A1",
  "VAUGHAN, ON": "L4H 0A1",
  "ETOBICOKE, ON": "M8V 0A1",
  "SCARBOROUGH, ON": "M1B 0A1",
  "MARKHAM, ON": "L3P 0A1",
  "HAMILTON, ON": "L8E 0A1",
  "LONDON, ON": "N5V 0A1",
  "KITCHENER, ON": "N2A 0A1",
  "CAMBRIDGE, ON": "N1R 0A1",
  "GUELPH, ON": "N1E 0A1",
  "WINDSOR, ON": "N8N 0A1",
  "OTTAWA, ON": "K1A 0A1",
  "BARRIE, ON": "L4M 0A1",
  "OSHAWA, ON": "L1G 0A1",
  "BURLINGTON, ON": "L7L 0A1",
  "OAKVILLE, ON": "L6H 0A1",
  "MILTON, ON": "L9T 0A1",
  "AJAX, ON": "L1S 0A1",
  "PICKERING, ON": "L1V 0A1",
  "WHITBY, ON": "L1M 0A1",
  "KINGSTON, ON": "K7K 0A1",
  "SUDBURY, ON": "P3A 0A1",
  "THUNDER BAY, ON": "P7A 0A1",
  "SARNIA, ON": "N7S 0A1",
  "BELLEVILLE, ON": "K8N 0A1",
  "CORNWALL, ON": "K6H 0A1",
  "BROCKVILLE, ON": "K6V 0A1",
  "NIAGARA FALLS, ON": "L2E 0A1",
  "ST CATHARINES, ON": "L2M 0A1",
  // Manitoba
  "WINNIPEG, MB": "R2C 0A1",
  "BRANDON, MB": "R7A 0A1",
  // Saskatchewan
  "REGINA, SK": "S4N 0A1",
  "SASKATOON, SK": "S7H 0A1",
  // Alberta
  "CALGARY, AB": "T1X 0A1",
  "EDMONTON, AB": "T5A 0A1",
  "RED DEER, AB": "T4N 0A1",
  "LETHBRIDGE, AB": "T1H 0A1",
  "FORT MCMURRAY, AB": "T9H 0A1",
  // British Columbia
  "VANCOUVER, BC": "V5K 0A1",
  "SURREY, BC": "V3R 0A1",
  "BURNABY, BC": "V5A 0A1",
  "RICHMOND, BC": "V6V 0A1",
  "DELTA, BC": "V3M 0A1",
  "LANGLEY, BC": "V2Y 0A1",
  "ABBOTSFORD, BC": "V2S 0A1",
  "KELOWNA, BC": "V1V 0A1",
  "VICTORIA, BC": "V8T 0A1",
  "KAMLOOPS, BC": "V1S 0A1",
  "PRINCE GEORGE, BC": "V2L 0A1",
  // New Brunswick
  "MONCTON, NB": "E1A 0A1",
  "SAINT JOHN, NB": "E2H 0A1",
  "FREDERICTON, NB": "E3A 0A1",
  // Nova Scotia
  "HALIFAX, NS": "B3H 0A1",
  "DARTMOUTH, NS": "B2V 0A1",
  "SYDNEY, NS": "B1L 0A1",
  // Prince Edward Island
  "CHARLOTTETOWN, PE": "C1A 0A1",
  // Newfoundland and Labrador
  "ST JOHNS, NL": "A1A 0A1",
  // Yukon / Northwest Territories / Nunavut
  "WHITEHORSE, YT": "Y1A 0A1",
  "YELLOWKNIFE, NT": "X1A 0A1",
  "IQALUIT, NU": "X0A 0H0"
};

function lookupCanadianPostalCode(city, province) {
  const key = `${String(city || '').trim().toUpperCase()}, ${String(province || '').trim().toUpperCase()}`;
  return canadianPostalDatabase[key] || '';
}

function autoFillLoadZipCodes(loads) {
  return loads.map(load => {
    const updated = { ...load };
    
    // Check and fill Origin ZIP if missing
    if (!updated.origZip && updated.origCity && updated.origSt) {
      const originKey = `${updated.origCity.trim().toUpperCase()}, ${updated.origSt.trim().toUpperCase()}`;
      if (zipDatabase[originKey]) {
        updated.origZip = zipDatabase[originKey];
      }
    }

    // Check and fill Destination ZIP if missing
    if (!updated.destZip && updated.destCity && updated.destSt) {
      const destKey = `${updated.destCity.trim().toUpperCase()}, ${updated.destSt.trim().toUpperCase()}`;
      if (zipDatabase[destKey]) {
        updated.destZip = zipDatabase[destKey];
      }
    }

    return updated;
  });
}

// A load added by hand (＋ Add Load). It stays in the TMS until you delete it: imports of
// the customer's list never remove it, it never expires, and its Landstar posting is never
// sent to the bot for removal.
function createManualLoad(id, fields = {}) {
  return {
    id: String(id || '').trim() || `MANUAL-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    eCode: 'VZ', status: 'OPEN', tag: 'OPEN', route: '', puDate: 'PU: Today', delDate: 'DFL: Upcoming',
    pickupTime: '', origCity: '', origSt: '', origZip: '', weight: '', deliveryTime: '',
    destCity: '', destSt: '', destZip: '', miles: '', planningComment: 'Added by hand',
    carrier: '', driver: '', truck: '', trailer: '', rateInput: '', brokerable: 'false', notes: '',
    ...fields,
    manualEntry: true
  };
}

function getCitySuggestions(zipData, query, state = '') {
  const text = String(query || '').trim().toUpperCase();
  if (text.length < 2) return [];
  const seen = new Set();
  return Object.values(zipData?.codes || {}).filter(place => {
    const key = `${place.city.toUpperCase()}, ${place.state}`;
    if (seen.has(key) || (state && place.state !== state.toUpperCase())
      || !key.startsWith(text)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.city.localeCompare(b.city) || a.state.localeCompare(b.state)).slice(0, 30);
}

function applyLocationInput(load, field, value, zipData) {
  const next = { ...load, [field]: value };
  const prefix = field.startsWith('orig') ? 'orig' : 'dest';
  const cityField = `${prefix}City`;
  const stateField = `${prefix}St`;
  const zipField = `${prefix}Zip`;
  if (field === zipField) {
    const place = zipData?.codes?.[String(value).trim()];
    if (place) Object.assign(next, { [cityField]: place.city.toUpperCase(), [stateField]: place.state });
  } else {
    if (field === cityField && value !== load[field]) next[zipField] = '';
    const label = String(next[cityField] || '').match(/^(.+),\s*([A-Z]{2})$/i);
    const city = String(label?.[1] || next[cityField] || '').trim();
    const state = String(label?.[2] || next[stateField] || '').trim().toUpperCase();
    const matches = (zipData?.lookupByName?.(city, state) || [])
      .filter(place => place.city.toUpperCase() === city.toUpperCase() && place.state === state)
      .sort((a, b) => a.zip.localeCompare(b.zip));
    if (matches.length) Object.assign(next, {
      [cityField]: matches[0].city.toUpperCase(), [stateField]: matches[0].state,
      [zipField]: matches.some(place => place.zip === next[zipField]) ? next[zipField] : matches[0].zip
    });
    else if (field === stateField && value !== load[field]) next[zipField] = '';
  }
  if (['google', 'estimated'].includes(load.milesSource)
    && [cityField, stateField, zipField].some(key => next[key] !== load[key])) {
    next.miles = '';
    delete next.milesSource;
  }
  return next;
}

// "📄 Copy Load" in the order editor: a new load in the same customer carrying the route,
// schedule, weight, miles, equipment, rate and comments of an existing one, so a repeat
// load only needs a new order # and whatever differs. The copy starts OPEN with no driver,
// truck or tracking, and imports keep it like any load added by hand.
const LOAD_COPY_FIELDS = [
  'eCode', 'route', 'puDate', 'delDate', 'pickupTime', 'origCity', 'origSt', 'origZip',
  'weight', 'deliveryTime', 'destCity', 'destSt', 'destZip', 'miles', 'rateInput',
  'rateSource', 'brokerable', 'postingCode', 'landstarComment', 'planningComment',
  'notes', 'team', 'hazmat', 'tanker', 'commodity', 'equipment2', 'equipment3'
];
function copyLoadDetails(load, newId) {
  const fields = {};
  LOAD_COPY_FIELDS.forEach(field => {
    if (load?.[field] !== undefined && load?.[field] !== '') fields[field] = load[field];
  });
  return createManualLoad(newId, fields);
}

function removeExpiredExportedLoads(customerOrders, now = Date.now()) {
  let changed = false;
  const nextOrders = {};
  Object.entries(customerOrders).forEach(([customer, loads]) => {
    nextOrders[customer] = loads.filter(load => {
      if (load.manualEntry || String(load.needsCapacity || '').trim()) return true;
      if (load.status !== 'ENT' || !load.landstarExportedAt) return true;
      const exportedAt = Date.parse(load.landstarExportedAt);
      const keep = !Number.isFinite(exportedAt) || now - exportedAt < exportedLoadRetentionMs;
      if (!keep) changed = true;
      return keep;
    });
  });
  return changed ? nextOrders : customerOrders;
}

// Standard comments from the "Comments" tab of Landstar's bulk template (column AA).
const landstarCommentOptions = [
  'All inclusive rate', 'Animals prohibited at facility', 'Driver Assist', 'Includes FSC', 'Load Ready now',
  'No Facial hair allowed', 'No touch', 'Round Trip', 'Tarping Required', 'Tracking Required',
  'Truck may be subject to security inspection onsite'
];

// The ZIP is the source of truth on export: when a valid US ZIP was entered, Landstar gets
// that ZIP's postal city and state, whatever city/state is typed on the load.
function getExportPlace(typedCity, typedState, zipLocation) {
  if (zipLocation?.city) {
    return { city: zipLocation.city, state: String(zipLocation.state || typedState || '').toUpperCase(), fromZip: true };
  }
  return { city: typedCity, state: typedState, fromZip: false };
}

function getStatusTag(status) {
  if (status === 'ENT') return 'ENT';
  if (status === 'ON HOLD') return 'HOLD';
  if (status === 'OFFER') return 'OFFER';
  if (status === 'BOOKED') return 'BOOKED';
  return 'OPEN';
}

function moveToOfferWithDriverPhone(load) {
  return load.status !== 'BOOKED' && /\d/.test(String(load.driverPhone || ''))
    ? { ...load, status: 'OFFER', tag: 'OFFER' }
    : load;
}

// Booking a load needs a driver; the load moves to the Booked Loads folder.
function bookLoad(load, bookedAt = new Date().toISOString()) {
  if (!String(load?.driver || '').trim()) {
    throw new Error('Enter the driver name before booking this load.');
  }
  // Booking covers the capacity need, so the ⭐ flag clears itself.
  const { needsCapacity, ...rest } = load;
  return { ...rest, status: 'BOOKED', tag: 'BOOKED', bookedAt: load.bookedAt || bookedAt };
}

// Takes the truck off a booked load: clears the driver, equipment, pickup ETA, previous
// empty location and tracking, and puts the load back in OPEN so it can be re-booked or
// exported. The rate and every other load detail are kept.
// The driver's details as one text block for chats and emails:
//   Driver 1 / name / phone / Tractor 1 / truck / Trailer 1 / trailer /
//   Previous Empty / location / Pickup ETA / eta / load#123
// A section with nothing filled in is left out.
function formatDriverInfo(load) {
  const value = field => String(load?.[field] || '').trim();
  const lines = [];
  if (value('driver') || value('driverPhone')) lines.push('Driver 1', ...[value('driver'), value('driverPhone')].filter(Boolean));
  if (value('truck')) lines.push('Tractor 1', value('truck'));
  if (value('trailer')) lines.push('Trailer 1', value('trailer'));
  if (value('emptyLocation')) lines.push('Previous Empty', value('emptyLocation'));
  if (value('pickupEta')) lines.push('Pickup ETA', value('pickupEta'));
  lines.push(`load#${value('id')}`);
  return lines.join('\n');
}

// "Copy Order #" by the order title: the order number, plus the previous empty
// location on the next line when one is entered.
function formatOrderCopy(load) {
  const emptyLocation = String(load?.emptyLocation || '').trim();
  return [String(load?.id || '').trim(), emptyLocation].filter(Boolean).join('\n');
}

function removeCapacity(load) {
  const { bookedAt, trackingStage, checkCalls, paramountTracking, driverEmails, trackingStartedAt,
    trackingStartedByHand, paperworkReceivedAt, paperworkFiles, paperworkSince, paperworkDone,
    paperworkSentAt, driverReplyIds, driverRepliesSeenAt, etaReplyIds, customerStatusReplyIds,
    customerStatusReportedAt, ...rest } = load || {};
  return { ...rest, manualEntry: true, needsCapacity: 'true', status: 'OPEN', tag: 'OPEN', driver: '', driverPhone: '', truck: '', trailer: '', pickupEta: '', emptyLocation: '' };
}

function getPostingRefreshDetails(load) {
  return ['origCity', 'origSt', 'origZip', 'destCity', 'destSt', 'destZip', 'pickupTime',
    'deliveryTime', 'weight', 'eCode', 'rateInput', 'rateSource', 'landstarComment',
    'planningComment', 'team', 'brokerable', 'commodity', 'equipment2', 'equipment3']
    .map(field => String(load[field] || '').trim());
}

function getPostingMaintenanceLoads(customerOrders) {
  return Object.entries(customerOrders).flatMap(([customer, loads]) => loads
    .filter(load => load.landstarPosting && (load.manualEntry || String(load.needsCapacity || '').trim() || load.status === 'BOOKED'))
    .map(load => ({
      customer, loadId: String(load.id), posting: load.landstarPosting,
      revision: getPostingRefreshDetails(load),
      refresh: Boolean(String(load.needsCapacity || '').trim()) && ['OPEN', 'ENT'].includes(load.status) && !String(load.truck || '').trim(),
      status: load.status, truck: load.truck || '',
      pickupTime: load.pickupTime || '', deliveryTime: load.deliveryTime || '',
      origCity: load.origCity || '', origSt: load.origSt || '',
      destCity: load.destCity || '', destSt: load.destSt || '',
      weight: load.weight || '', eCode: load.eCode || ''
    })));
}

// Drivers, trucks and trailers already used on any load, for auto-complete.
// When a driver appears on several loads, the most recently booked one wins
// and any missing phone/truck/trailer is filled from their other loads.
function buildDriverDirectory(customerOrdersMap) {
  const clean = value => String(value || '').trim();
  const drivers = new Map();
  const trucks = new Set();
  const trailers = new Set();
  Object.values(customerOrdersMap || {}).flat().forEach(load => {
    const truck = clean(load?.truck);
    const trailer = clean(load?.trailer);
    if (truck) trucks.add(truck);
    if (trailer) trailers.add(trailer);
    const driver = clean(load?.driver);
    if (!driver) return;
    const key = driver.toUpperCase();
    const entry = { driver, driverPhone: clean(load.driverPhone), truck, trailer, at: Date.parse(load.bookedAt) || 0 };
    const known = drivers.get(key);
    if (!known) { drivers.set(key, entry); return; }
    const [newer, older] = entry.at > known.at ? [entry, known] : [known, entry];
    drivers.set(key, {
      ...newer,
      driverPhone: newer.driverPhone || older.driverPhone,
      truck: newer.truck || older.truck,
      trailer: newer.trailer || older.trailer
    });
  });
  const byText = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  return {
    drivers: Array.from(drivers.values()).sort((a, b) => byText(a.driver, b.driver)),
    trucks: Array.from(trucks).sort(byText),
    trailers: Array.from(trailers).sort(byText)
  };
}

function findKnownDriver(directory, name) {
  const key = String(name || '').trim().toUpperCase();
  return key ? directory.drivers.find(entry => entry.driver.toUpperCase() === key) || null : null;
}

function markLoadsExported(loads, exportedIds, exportedAt) {
  return loads.map(load => exportedIds.has(String(load.id))
    ? { ...load, status: load.status === 'OFFER' ? 'OFFER' : 'ENT', tag: load.status === 'OFFER' ? 'OFFER' : 'ENT', landstarExportedAt: exportedAt }
    : load);
}

const screenshotColumns = [0, 0.024, 0.081, 0.171, 0.27, 0.352, 0.452, 0.547, 0.58, 0.616, 0.693, 0.724, 0.78, 0.815, 0.856, 1];
const canadianProvinceCodes = new Set('AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' '));
const stateCodes = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
canadianProvinceCodes.forEach(code => stateCodes.add(code));
const sortedStateCodes = Array.from(stateCodes).sort();

function normalizeCanadianPostalCode(value) {
  const compact = String(value || '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(compact)) return '';
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

function getCountryForRegion(region) {
  return canadianProvinceCodes.has(String(region || '').trim().toUpperCase()) ? 'CA' : 'US';
}

function clusterPositions(values, tolerance = 0.012) {
  const sorted = [...values].sort((a, b) => a - b);
  const clusters = [];
  sorted.forEach(value => {
    const last = clusters[clusters.length - 1];
    if (last && value - last.max <= tolerance) {
      last.max = value;
      last.count += 1;
    } else {
      clusters.push({ min: value, max: value, count: 1 });
    }
  });
  return clusters;
}

function detectColumnsFromData(allWords, imageWidth) {
  const words = allWords.map(word => ({
    text: word.text,
    x0: word.bbox.x0 / imageWidth,
    x1: word.bbox.x1 / imageWidth
  }));
  const margin = 0.004;
  const largest = clusters => [...clusters].sort((a, b) => b.count - a.count)[0];

  const dateWords = words.filter(word => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(word.text));
  const dateClusters = clusterPositions(dateWords.map(word => word.x0));
  const strongest = Math.max(0, ...dateClusters.map(cluster => cluster.count));
  const dateColumns = dateClusters.filter(cluster => cluster.count >= Math.max(2, strongest * 0.3));
  if (dateColumns.length !== 4) return null;

  const distanceCluster = largest(clusterPositions(
    words.filter(word => /^[^A-Za-z0-9]*\d{2,4}\.\d[^A-Za-z0-9]*$/.test(word.text)).map(word => word.x0)
  ));
  if (!distanceCluster || distanceCluster.count < 2) return null;
  const distanceStart = distanceCluster.min;

  const zipClusters = clusterPositions(words
    .filter(word => /^[^A-Za-z0-9]*\d{5}[^A-Za-z0-9]*$/.test(word.text) && !/\.\./.test(word.text)
      && word.x0 > dateColumns[3].min + 0.1 && word.x0 < distanceStart - 0.02)
    .map(word => word.x0))
    .filter(cluster => cluster.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .sort((a, b) => a.min - b.min);
  if (zipClusters.length !== 2) return null;
  const [originZip, destZip] = zipClusters.map(cluster => cluster.min);

  const cityStart = (from, to) => largest(clusterPositions(words
    .filter(word => word.x0 > from && word.x0 < to && /[A-Za-z]{3,}/.test(word.text))
    .map(word => word.x0)));
  const originCity = cityStart(dateColumns[3].min + 0.07, originZip - 0.04);
  const destCity = cityStart(originZip + 0.04, destZip - 0.04);
  if (!originCity || !destCity) return null;

  const weightCluster = largest(clusterPositions(words
    .filter(word => word.x0 > distanceStart + 0.03 && /^[^A-Za-z]*\d{4,6}/.test(word.text))
    .map(word => word.x0)));
  if (!weightCluster) return null;

  const columns = [
    0,
    dateColumns[0].min - 0.06,
    dateColumns[0].min - margin,
    dateColumns[1].min - margin,
    dateColumns[2].min - margin,
    dateColumns[3].min - margin,
    originCity.min - margin,
    originCity.min + (originZip - originCity.min) * 0.6,
    originZip - margin,
    destCity.min - margin,
    destCity.min + (destZip - destCity.min) * 0.6,
    destZip - margin,
    distanceStart - margin,
    weightCluster.min - margin,
    weightCluster.min + 0.048,
    1
  ];
  return columns.every((value, index) => index === 0 || value > columns[index - 1]) ? columns : null;
}

function detectScreenshotColumns(lines, imageWidth) {
  if (lines[0]?.screenshotColumns) return lines[0].screenshotColumns;
  const allWords = lines.flatMap(line => line.words || []);
  return detectColumnsFromHeader(allWords, imageWidth)
    || detectColumnsFromData(allWords, imageWidth)
    || screenshotColumns;
}

function detectColumnsFromHeader(allWords, imageWidth) {
  const orderHeader = allWords
    .filter(word => /^order$/i.test(word.text))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0)[0];
  if (!orderHeader) return null;

  const headerY = (orderHeader.bbox.y0 + orderHeader.bbox.y1) / 2;
  const tolerance = (orderHeader.bbox.y1 - orderHeader.bbox.y0) * 0.5;
  const headerWords = allWords
    .filter(word => Math.abs((word.bbox.y0 + word.bbox.y1) / 2 - headerY) <= tolerance)
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const find = pattern => headerWords.filter(word => pattern.test(word.text.replace(/[^A-Za-z]/g, '')));
  const origin = find(/^origin./i)[0];
  const dest = find(/^destc/i)[0];
  const distance = find(/^dist/i)[0];
  const weight = find(/^weigh/i)[0];
  const planning = find(/^plan/i)[0];
  if (!origin || !dest || !distance || !weight || !planning) return null;
  const dateHeaders = headerWords.filter(word =>
    word.bbox.x0 > orderHeader.bbox.x1 && word.bbox.x1 <= origin.bbox.x0 + 1
  );
  if (dateHeaders.length !== 4) return null;
  const [early, late, earlyDelivery, lateDelivery] = dateHeaders;
  const start = word => Math.max(0, word.bbox.x0 / imageWidth - 0.004);
  const originStart = start(origin);
  const destStart = start(dest);
  const distanceStart = start(distance);
  const originSpan = destStart - originStart;
  const destSpan = distanceStart - destStart;
  const columns = [
    0,
    start(orderHeader),
    start(early),
    start(late),
    start(earlyDelivery),
    start(lateDelivery),
    originStart,
    originStart + originSpan * 0.57,
    originStart + originSpan * 0.76,
    destStart,
    destStart + destSpan * 0.46,
    destStart + destSpan * 0.65,
    distanceStart,
    start(weight),
    start(planning),
    1
  ];
  return columns.every((value, index) => index === 0 || value > columns[index - 1])
    ? columns
    : null;
}

function parseWeightPounds(value) {
  const normalized = String(value ?? '').trim().replace(/,/g, '');
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const pounds = Number(match[0]);
  return Number.isFinite(pounds) && pounds > 0 ? Math.round(pounds) : null;
}

function parseScreenshotLines(lines, imageWidth, imageHeight, selectedBroker) {
  const isParaImport = isParaCustomer(selectedBroker);
  const holdsRedRows = holdsRedScreenshotLoads(selectedBroker);
  const cleanCell = value => value
    .replace(/[|[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parseWeight = value => {
    return String(parseWeightPounds(value) || '');
  };
  const parseDateTime = (value, fallbackDate = '') => {
    const text = String(value || '').trim();
    const dateMatch = text.match(/\b(1[0-2]|0?[1-9])\s*[/.-]\s*(3[01]|[12]\d|0?[1-9])\s*[/.-]\s*(20\d{2}|\d{2})\b/);
    const fallbackMatch = String(fallbackDate || '').match(/\b(1[0-2]|0?[1-9])\s*[/.-]\s*(3[01]|[12]\d|0?[1-9])\s*[/.-]\s*(20\d{2}|\d{2})\b/);
    const date = dateMatch || fallbackMatch;
    if (!date) return '';

    const [, month, day, yearText] = date;
    const year = yearText.length === 2 ? `20${yearText}` : yearText;
    const timeText = dateMatch ? text.slice(dateMatch.index + dateMatch[0].length).trim() : text;
    const timeMatch = timeText.match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\b/i)
      || timeText.match(/\b(\d{3,4})\b/);
    if (!timeMatch) return `${month}/${day}/${year} 0000`;

    let hour;
    let minute;
    const [, hourText, minuteText, meridiem] = timeMatch;
    if (minuteText !== undefined) {
      hour = Number(hourText);
      minute = Number(minuteText);
    } else if (isParaImport && hourText.length <= 2) {
      // Para's clipped cells show hours, not minutes; a lone zero uses 08:00.
      hour = hourText === '0' && !meridiem ? 8 : Number(hourText);
      minute = 0;
    } else {
      const digits = hourText.padStart(4, '0');
      hour = Number(digits.slice(0, -2));
      minute = Number(digits.slice(-2));
    }
    if (meridiem) {
      if (hour < 1 || hour > 12) return '';
      hour = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
    }
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), hour, minute));
    if (parsed.getUTCFullYear() !== Number(year)
      || parsed.getUTCMonth() !== Number(month) - 1
      || parsed.getUTCDate() !== Number(day)
      || hour > 23
      || minute > 59) return '';
    return `${month}/${day}/${year} ${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;
  };
  const shortDateTime = value => value.replace(/^(\d{1,2})\/(\d{1,2})\/\d{4}/, '$1/$2');
  
  const parseState = value => {
    const cleanVal = String(value || '').replace(/[^A-Za-z]/g, '').toUpperCase();
    if (stateCodes.has(cleanVal)) return cleanVal;
    if (cleanVal.length > 2 && stateCodes.has(cleanVal.slice(-2))) return cleanVal.slice(-2);
    return Array.from(cleanVal.matchAll(/[A-Z]{2}/g)).map(match => match[0]).reverse().find(code => stateCodes.has(code)) || '';
  };

  const columns = detectScreenshotColumns(lines, imageWidth);
  return lines.map((line, index) => {
    if (line.bbox.y0 < imageHeight * 0.035) return null;
    const cells = Array.from({ length: columns.length - 1 }, () => []);
    line.words.forEach(word => {
      const x = (word.bbox.x0 + word.bbox.x1) / 2 / imageWidth;
      const column = columns.findIndex((boundary, cellIndex) => x >= boundary && x < columns[cellIndex + 1]);
      if (column >= 0) cells[column].push(word);
    });

    const values = cells.map(cell => cleanCell(cell.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(word => word.text).join(' ')));
    const [equipmentText, orderText, earlyPickup, latePickup, earlyDelivery, lateDelivery, origCity, origSt, origZip, destCity, destSt, destZip, miles, weight, planningComment] = values;
    const numberText = orderText.replace(/\D/g, '');
    const orderMatch = numberText.match(/22\d{5}/)?.[0];
    const id = line.verifiedOrderId || orderMatch || '';
    const equipment = line.verifiedEquipmentCode
      || equipmentText.toUpperCase().match(/\b(V53|VM|VT|VZ|VE|VR|RZ|R|F|FV|FH|SD|VAN|V)\b/)?.[0]?.replace(/^V53$/, 'V') || '';
    const rowText = line.text.toLowerCase();
    if (/distance/.test(rowText) && /weight/.test(rowText) && /comment/.test(rowText)) return null;
    if (/\border\b/.test(rowText) && /\bearly\b/.test(rowText) && /\blate\b/.test(rowText)) return null;
    // A row whose city didn't read used to vanish. Keep it whenever the order number is
    // known, flagged "verify", so it imports and you can fix the city instead of losing it.
    if (!origCity && !destCity && !id) return null;

    const pickupFrom = parseDateTime(earlyPickup);
    const pickupTo = parseDateTime(latePickup, earlyPickup);
    const deliveryFrom = parseDateTime(earlyDelivery);
    const deliveryTo = parseDateTime(lateDelivery, earlyDelivery);
    const mileageDigits = miles.replace(/\D/g, '');
    const rawDecimalMiles = miles.replace(/\s/g, '').match(/\d{1,6}\.\d/)?.[0];
    const decimalMiles = rawDecimalMiles && rawDecimalMiles.split('.')[0].length >= 5
      ? `${rawDecimalMiles.slice(0, 3)}.${rawDecimalMiles.slice(-1)}`
      : rawDecimalMiles;
    const mergedMiles = !decimalMiles && mileageDigits.length >= 7
      ? mileageDigits.slice(0, -6)
      : '';
    const mileage = mergedMiles
      ? `${mergedMiles}.0`
      : decimalMiles
      ? decimalMiles
      : miles.includes('.')
        ? miles.replace(/[^0-9.]/g, '')
      : mileageDigits.length === 4 || mileageDigits.length === 5
        ? `${mileageDigits.slice(0, -1)}.${mileageDigits.slice(-1)}`
        : mileageDigits;
    const normalizeCity = (city, stateText) => {
      let normalizedCity = city.toUpperCase().replace(/[^A-Z\s.'-]/g, '').trim();
      let state = parseState(stateText);
      const trailingState = normalizedCity.match(/\s+([A-Z]{2})$/)?.[1];
      if (trailingState && stateCodes.has(trailingState)) {
        state ||= trailingState;
        normalizedCity = normalizedCity.slice(0, -trailingState.length).trim();
      } else if (!state) {
        const gluedState = normalizedCity.match(/^(.{3,}?)[.\s]*I?([A-Z]{2})$/);
        if (gluedState && stateCodes.has(gluedState[2])) {
          normalizedCity = gluedState[1].replace(/\.+$/, '').trim();
          state = gluedState[2];
        }
      }
      return { city: normalizedCity, state };
    };
    const normalizedOrigin = normalizeCity(origCity, origSt);
    const normalizedDestination = normalizeCity(destCity, destSt);
    const origin = normalizedOrigin.city;
    const destination = normalizedDestination.city;
    const originState = normalizedOrigin.state;
    const destinationState = normalizedDestination.state;
    const originZipcode = origZip.replace(/\D/g, '').match(/\d{5}/)?.[0] || '';
    const destinationZipcode = destZip.replace(/\D/g, '').match(/\d{5}/)?.[0] || '';
    const positionedWeightText = line.words
      .filter(word => {
        const center = (word.bbox.x0 + word.bbox.x1) / 2 / imageWidth;
        return center >= columns[13] && center < columns[14];
      })
      .sort((a, b) => a.bbox.x0 - b.bbox.x0)
      .map(word => word.text)
      .join(' ');
    const weightFromComment = parseWeight(planningComment.match(/^\s*(\d[\d,. ]{2,8})/)?.[1]);
    const weightFromLabel = parseWeight(
      line.text.match(/\b(\d[\d,. ]{2,8})\s*(?:lbs?|pounds)\b/i)?.[1]
    );
    const rawWeight = parseWeight(weight)
      || parseWeight(positionedWeightText)
      || weightFromComment
      || weightFromLabel;
    const weightValue = /^1\d{5}$/.test(rawWeight) && Number(rawWeight.slice(1)) >= 1000
      ? rawWeight.slice(1)
      : rawWeight;
    const normalizedComment = weightFromComment
      ? planningComment.replace(/^\s*\d[\d,. ]{2,8}\s*/, '').trim()
      : planningComment;

    return {
      id: id || `IMG-${Date.now()}-${index}`,
      eCode: isTeamEquipment(equipment) ? 'V' : equipment || (isRxoCustomer(selectedBroker) ? 'VAN:VAN' : 'VZ'),
      team: isTeamEquipment(equipment) ? 'true' : 'false',
      status: holdsRedRows && line.orderNumberHighlighted ? 'ON HOLD' : 'OPEN',
      tag: holdsRedRows && line.orderNumberHighlighted ? 'HOLD' : 'OPEN',
      ...(holdsRedRows && typeof line.orderNumberHighlighted === 'boolean'
        ? { screenshotStatus: line.orderNumberHighlighted ? 'ON HOLD' : 'OPEN' }
        : {}),
      route: `${origin}${originState ? `, ${originState}` : ''} → ${destination}${destinationState ? `, ${destinationState}` : ''}`,
      puDate: pickupFrom || pickupTo ? `PU: ${shortDateTime(pickupFrom || pickupTo)}` : 'PU: Today',
      delDate: deliveryTo || deliveryFrom ? `DFL: ${shortDateTime(deliveryTo || deliveryFrom)}` : 'DFL: Upcoming',
      pickupTime: pickupFrom && pickupTo ? `${pickupFrom} - ${pickupTo}` : pickupFrom || pickupTo || '10/19/2026 0800 - 1700',
      origCity: origin,
      origSt: originState,
      origZip: originZipcode,
      weight: weightValue ? `${weightValue} lbs` : '40000 lbs',
      deliveryTime: deliveryFrom && deliveryTo ? `${deliveryFrom} - ${deliveryTo}` : deliveryFrom || deliveryTo || '10/21/2026 0800 - 1700',
      destCity: destination,
      destSt: destinationState,
      destZip: destinationZipcode,
      miles: normalizeMilesValue(mileage) || '400',
      planningComment: normalizedComment,
      carrier: '',
      driver: '',
      truck: '',
      trailer: '',
      rateInput: '',
      brokerable: 'false',
      notes: id && originState && origin && destination ? '' : 'Some fields were unreadable from the screenshot; please verify the cities, state codes and times.'
    };
  }).filter(Boolean);
}

function findNtgCards(lines, imageWidth, imageHeight, { wholeCard = false } = {}) {
  const words = lines.flatMap(line => line.words || [])
    .map(word => {
      const x0 = word.bbox.x0 / imageWidth;
      const x1 = word.bbox.x1 / imageWidth;
      return { text: String(word.text || '').trim(), x0, x1, cx: (x0 + x1) / 2, cy: (word.bbox.y0 + word.bbox.y1) / 2, h: word.bbox.y1 - word.bbox.y0 };
    })
    .filter(word => word.text);
  if (wholeCard) {
    return { cards: words.length ? [{ cy: imageHeight * 0.3, top: 0, bottom: imageHeight, words }] : [], spacing: imageHeight };
  }
  const markers = words
    .filter(word => (word.cx > 0.5 && /^(sto\w{0,2}|weight|total)$/i.test(word.text)) || (word.x0 < 0.2 && /^\d{7}$/.test(word.text)))
    .sort((a, b) => a.cy - b.cy);
  const clusters = [];
  markers.forEach(word => {
    const last = clusters[clusters.length - 1];
    if (last && word.cy - last.cy < imageHeight * 0.02) {
      last.count += 1;
      last.cy += (word.cy - last.cy) / last.count;
    } else {
      clusters.push({ cy: word.cy, count: 1 });
    }
  });
  const anchors = clusters;
  const spacing = anchors.length > 1
    ? anchors.slice(1).map((anchor, index) => anchor.cy - anchors[index].cy).sort((a, b) => a - b)[Math.floor((anchors.length - 1) / 2)]
    : imageHeight;
  const cards = anchors.map(anchor => {
    const top = anchor.cy - spacing * 0.2;
    const bottom = anchor.cy + spacing * 0.8;
    return { cy: anchor.cy, top, bottom, words: words.filter(word => word.cy >= top && word.cy < bottom) };
  });
  return { cards, spacing };
}

function parseNtgScreenshotLines(lines, imageWidth, imageHeight, options = {}) {
  const { cards: anchors } = findNtgCards(lines, imageWidth, imageHeight, options);
  const toRows = region => {
    const rows = [];
    region.slice().sort((a, b) => a.cy - b.cy).forEach(word => {
      const row = rows[rows.length - 1];
      if (row && Math.abs(word.cy - row.cy) < Math.max(6, word.h * 0.6)) {
        row.words.push(word);
        row.cy = row.words.reduce((sum, item) => sum + item.cy, 0) / row.words.length;
      } else {
        rows.push({ cy: word.cy, words: [word] });
      }
    });
    return rows.map(row => ({ ...row, text: row.words.sort((a, b) => a.x0 - b.x0).map(word => word.text).join(' ') }));
  };
  const parseCity = text => {
    const match = text.replace(/[|]/g, '').replace(/(\s+\d{1,2})+\s*$/, '').match(/^(.*?)[,.]?\s+([A-Za-z]{2})$/);
    const state = match?.[2].toUpperCase();
    if (!match || !stateCodes.has(state)) return null;
    const city = match[1].replace(/[^A-Za-z\s.'-]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
    return city ? { city, state } : null;
  };
  const parseDates = text => {
    const cleaned = text.replace(/[Oo]/g, '0').replace(/(\d)\s*[vV|\\]\s*(\d)/g, '$1/$2');
    const dateMatch = cleaned.match(/(1[0-2]|0?[1-9])\s*\/?\s*(3[01]|[12]\d|0?[1-9])\s*\/\s*(20\d{2}|\d{2})/);
    if (!dateMatch) return '';
    const date = `${dateMatch[1].padStart(2, '0')}/${dateMatch[2].padStart(2, '0')}/${dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3]}`;
    const timeText = cleaned.slice(dateMatch.index + dateMatch[0].length)
      .replace(/\b[D0]?[BR0-9][\s:;.]*\d{2}\b/g, value => value.replace(/D/g, '0').replace(/[BR]/g, '8'));
    const times = Array.from(timeText.matchAll(/\b([01]?\d|2[0-3])\s*[:;.]?\s*([0-5]\d)\b/g))
      .map(match => `${match[1].padStart(2, '0')}${match[2]}`);
    const start = times[0] || '0800';
    const end = times[1] || (times[0] ? times[0] : '1600');
    return `${date} ${start} - ${end}`;
  };

  return anchors.map((anchor, index) => {
    const card = anchor.words;
    const idWord = card.find(word => word.x0 < 0.2 && /^\d{7}$/.test(word.text));
    const milesWord = card.find(word => /miles?$/i.test(word.text));
    const centerX = milesWord ? milesWord.cx : 0.45;
    let mileage = milesWord?.text.match(/(\d{2,5})\s*miles?/i)?.[1] || '';
    if (milesWord && !mileage) {
      mileage = card
        .filter(word => /^\D{0,2}\d{2,5}$/.test(word.text) && Math.abs(word.cy - milesWord.cy) < milesWord.h && word.x1 <= milesWord.x0 + 0.01 && word.x0 > milesWord.x0 - 0.08)
        .sort((a, b) => b.x1 - a.x1)[0]?.text.replace(/\D/g, '') || '';
    }
    const statsLeft = (card.find(word => /^stops$/i.test(word.text))?.x0 ?? 0.69) - 0.02;
    const rateWord = card.find(word => /^\$\s*[\d,]+(\.\d+)?$/.test(word.text));
    const rate = rateWord ? rateWord.text.replace(/[^0-9.]/g, '') : '';
    const weightWord = card
      .filter(word => word.cx >= statsLeft && word !== rateWord && /^(\d{1,3}([,.]\d{3})+|\d{2,6})(\.\d+)?$/.test(word.text))
      .sort((a, b) => a.x0 - b.x0)[0];
    // "2.293" is a misread "2,293"; a decimal weight like "39,974.4" keeps its decimal.
    const weightText = weightWord ? weightWord.text.replace(/^(\d{1,3})\.(\d{3})(?=$|\.)/, '$1,$2') : '';
    let weightValue = weightWord ? Math.round(Number(weightText.replace(/,/g, ''))) : 0;
    // OCR sometimes drops the separators in weights like "39,974.4", producing 399744.
    while (weightValue > 60000 && !/[.,]/.test(weightWord.text)) weightValue = Math.round(weightValue / 10);
    const weight = weightValue ? String(weightValue) : '';

    const originRows = toRows(card.filter(word => word.x0 > 0.08 && word.cx < centerX - 0.06));
    const destRows = toRows(card.filter(word => word.cx > centerX + 0.06 && word.cx < statsLeft));
    const findLocation = rows => {
      const rowIndex = rows.findIndex(row => parseCity(row.text));
      return rowIndex < 0 ? { location: null, dates: '' } : {
        location: parseCity(rows[rowIndex].text),
        dates: parseDates(rows[rowIndex + 1]?.text || '')
      };
    };
    const origin = findLocation(originRows);
    const destination = findLocation(destRows);
    if (!origin.location || !destination.location) return null;

    const equipmentText = card.map(word => word.text).join(' ');
    const isReefer = /reefer/i.test(equipmentText);
    const isFlatbed = /flat\s*bed|\bflat\b/i.test(equipmentText);
    const tags = [/haz|\b\w{1,2}zmat\b/i.test(equipmentText) && 'Hazmat', /tanker/i.test(equipmentText) && 'Tanker (N) Endorsement'].filter(Boolean);
    const isHazmat = tags.includes('Hazmat');
    const shortDate = value => value.replace(/^(\d{2})\/(\d{2})\/\d{4}\s+(\d{4}).*$/, '$1/$2 $3');
    return {
      id: idWord ? idWord.text : `NTG-${Date.now()}-${index}`,
      eCode: /str\w{0,3}ght\s*tr\w*|sprinter|box\s*truck/i.test(equipmentText) ? normalizeEquipmentCode(`Straight Truck ${equipmentText}`) : /c\w{1,3}est\w{0,2}ga/i.test(equipmentText) ? 'FLCS' : isFlatbed ? (isHazmat ? 'FH' : 'F,SD') : isHazmat ? (isReefer && !/\bvan\b/i.test(equipmentText) ? 'RZ' : 'VZ') : isReefer ? (/\bvan\b/i.test(equipmentText) ? 'VR' : 'R') : 'V',
      ...(isHazmat ? { hazmat: 'true' } : {}),
      ...(tags.some(tag => /tanker/i.test(tag)) ? { tanker: 'true' } : {}),
      status: 'OPEN',
      tag: 'OPEN',
      route: `${origin.location.city}, ${origin.location.state} → ${destination.location.city}, ${destination.location.state}`,
      puDate: origin.dates ? `PU: ${shortDate(origin.dates)}` : 'PU: Today',
      delDate: destination.dates ? `DFL: ${shortDate(destination.dates)}` : 'DFL: Upcoming',
      pickupTime: origin.dates,
      origCity: origin.location.city,
      origSt: origin.location.state,
      origZip: '',
      weight: weight ? `${weight} lbs` : '',
      deliveryTime: destination.dates,
      destCity: destination.location.city,
      destSt: destination.location.state,
      destZip: '',
      miles: mileage,
      planningComment: tags.join(', '),
      carrier: '',
      driver: '',
      truck: '',
      trailer: '',
      rateInput: rate,
      rateSource: rate ? 'user-entered' : undefined,
      brokerable: 'false',
      notes: idWord ? '' : 'Load number was unreadable from the NTG screenshot; please enter it.'
    };
  }).filter(Boolean);
}

async function readCanvasStrip(worker, canvas, x0, y0, x1, y1, pattern, thresholds = [150, 110, 190, 0]) {
  const left = Math.max(0, Math.round(x0));
  const top = Math.max(0, Math.round(y0));
  const width = Math.min(canvas.width, Math.round(x1)) - left;
  const height = Math.min(canvas.height, Math.round(y1)) - top;
  if (width < 4 || height < 4) return '';
  for (const threshold of thresholds) {
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = width * 2 + 64;
    cropCanvas.height = height * 2 + 64;
    const cropContext = cropCanvas.getContext('2d', { willReadFrequently: true });
    cropContext.fillStyle = '#fff';
    cropContext.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
    cropContext.drawImage(canvas, left, top, width, height, 32, 32, width * 2, height * 2);
    if (threshold) {
      const pixels = cropContext.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        const luminance = pixels.data[offset] * 0.299 + pixels.data[offset + 1] * 0.587 + pixels.data[offset + 2] * 0.114;
        const value = luminance < threshold ? 0 : 255;
        pixels.data[offset] = value;
        pixels.data[offset + 1] = value;
        pixels.data[offset + 2] = value;
        pixels.data[offset + 3] = 255;
      }
      cropContext.putImageData(pixels, 0, 0);
    }
    const { data: stripData } = await worker.recognize(cropCanvas);
    const found = stripData.text.match(pattern)?.[0];
    if (found) return found;
  }
  return '';
}

// Picks the most common digit at each position across several OCR readings of one load number.
function voteNtgLoadNumber(candidates) {
  const readings = candidates.filter(candidate => /^\d{7}$/.test(candidate));
  if (!readings.length) return null;
  const value = Array.from({ length: 7 }, (_, position) => {
    const counts = {};
    readings.forEach(reading => { counts[reading[position]] = (counts[reading[position]] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }).join('').replace(/^0/, '9');
  return { value, unanimous: readings.length >= 2 && readings.every(reading => reading === value) };
}

// Re-reads the small parts of one cropped NTG/Beon load card that full-card OCR tends to miss.
async function fillMissingNtgCardDetails(worker, canvas, lines) {
  const W = canvas.width;
  const H = canvas.height;
  const words = lines.flatMap(line => line.words || [])
    .map(word => ({ text: String(word.text || '').trim(), ...word.bbox }))
    .filter(word => word.text);
  const add = (text, x0, y0, x1, y1) => lines.push({ text, bbox: { x0, y0, x1, y1 }, words: [{ text, bbox: { x0, y0, x1, y1 } }] });
  const find = pattern => words.find(word => pattern.test(word.text));
  const allText = words.map(word => word.text).join(' ');
  const milesWord = words.find(word => /miles?$/i.test(word.text) && word.x0 > W * 0.15 && word.x1 < W * 0.65);
  const totalLabel = words.find(word => /^total$/i.test(word.text) && word.x0 > W * 0.6);
  const weightLabel = words.find(word => /^w\w{2,4}t$/i.test(word.text) && word.x0 > W * 0.6);
  const label = totalLabel || weightLabel;
  const labelHeight = label ? label.y1 - label.y0 : H * 0.08;
  const valueTop = label ? label.y1 + labelHeight * 0.2 : H * 0.35;
  const valueBottom = label ? label.y1 + labelHeight * 3 : H * 0.75;

  await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '0123456789,.$' });
  const idCandidates = words.filter(word => word.x0 < W * 0.2 && /^\d{7}$/.test(word.text)).map(word => word.text);
  for (const threshold of [0, 150, 110, 190, 130, 170]) {
    const reading = await readCanvasStrip(worker, canvas, 0, 0, W * 0.08, H, /\d{7}/, [threshold]);
    if (reading) idCandidates.push(reading.slice(0, 7));
  }
  const loadNumber = voteNtgLoadNumber(idCandidates);
  if (loadNumber) {
    const text = loadNumber.value;
    lines.unshift({ text, bbox: { x0: W * 0.01, y0: H * 0.45, x1: W * 0.05, y1: H * 0.5 }, words: [{ text, bbox: { x0: W * 0.01, y0: H * 0.45, x1: W * 0.05, y1: H * 0.5 } }] });
    if (!loadNumber.unanimous) lines.ntgIdUncertain = true;
  }
  const statsLeft = W * 0.67;
  if (!words.some(word => word.x0 > statsLeft && /^\$\s*[\d,]+(\.\d+)?$/.test(word.text))) {
    const rateLeft = totalLabel ? totalLabel.x0 - W * 0.01 : W * 0.765;
    const rateText = await readCanvasStrip(worker, canvas, rateLeft, valueTop, rateLeft + W * 0.075, valueBottom, /\d[\d,]*\.\d{2}/);
    if (rateText) add(`$${rateText}`, rateLeft + W * 0.01, (valueTop + valueBottom) / 2 - 4, rateLeft + W * 0.06, (valueTop + valueBottom) / 2 + 4);
  }
  if (!words.some(word => word.x0 > statsLeft && /^(\d{1,3}(,\d{3})+|\d{2,6})(\.\d+)?$/.test(word.text))) {
    const weightLeft = weightLabel ? weightLabel.x0 - W * 0.02 : W * 0.69;
    const weightRight = totalLabel ? totalLabel.x0 - W * 0.01 : W * 0.765;
    const weightText = await readCanvasStrip(worker, canvas, weightLeft, valueTop, weightRight, valueBottom, /\d{1,3}(,\d{3})+(\.\d+)?|\d{2,6}(\.\d+)?/);
    if (weightText) add(weightText, weightLeft + W * 0.01, (valueTop + valueBottom) / 2 - 4, weightRight - W * 0.01, (valueTop + valueBottom) / 2 + 4);
  }

  await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' });
  if (!/van|reefer|flat|truck|sprinter|hot\s*shot|step|conestoga/i.test(allText)) {
    const lineHeight = milesWord ? milesWord.y1 - milesWord.y0 : H * 0.08;
    const top = milesWord ? milesWord.y0 - lineHeight * 3.4 : 0;
    const bottom = milesWord ? milesWord.y0 - lineHeight * 0.3 : H * 0.5;
    const equipment = await readCanvasStrip(worker, canvas, W * 0.2, top, W * 0.52, bottom, /[\w /]*(van|reefer|flat\s*bed|truck|sprinter|hot\s*shot)[\w /]*/i);
    const centerX = milesWord ? (milesWord.x0 + milesWord.x1) / 2 : W * 0.37;
    if (equipment) add(equipment.trim(), centerX - 4, top, centerX + 4, bottom);
  }
  if (!/haz|\b\w{1,2}zmat\b/i.test(allText)) {
    const tagText = await readCanvasStrip(worker, canvas, 0, H * 0.7, W * 0.35, H, /.*(haz|tank).*/is);
    const tags = [/haz/i.test(tagText) && 'Hazmat', /tank/i.test(tagText) && 'Tanker'].filter(Boolean);
    if (tags.length) add(tags.join(' '), W * 0.01, H * 0.9, W * 0.1, H * 0.95);
  }
}

async function readNtgScreenshotCards(worker, image, onProgress) {
  const analysis = document.createElement('canvas');
  analysis.width = image.naturalWidth || image.width;
  analysis.height = image.naturalHeight || image.height;
  const analysisContext = analysis.getContext('2d', { willReadFrequently: true });
  if (!analysisContext) return [];
  analysisContext.drawImage(image, 0, 0);
  // Zoomed-out Beon pages have thin, very light gaps between cards: a stricter white level
  // keeps neighbouring cards apart. Use whichever level finds more separate cards.
  const pixels0 = analysisContext.getImageData(0, 0, analysis.width, analysis.height).data;
  const regions = [246, 250]
    .map(whiteLevel => findNtgCardRegions(pixels0, analysis.width, analysis.height, { whiteLevel }))
    .reduce((best, found) => (found.length > best.length ? found : best), []);
  const loads = [];
  for (const [index, region] of regions.entries()) {
    onProgress?.(`Reading NTG load card ${index + 1} of ${regions.length}...`);
    const regionWidth = region.x1 - region.x0;
    const regionHeight = region.y1 - region.y0;
    // Small (zoomed-out) cards are enlarged more so their small print can be read.
    const scale = Math.max(1, Math.min(4, 5600 / regionWidth));
    const cardCanvas = document.createElement('canvas');
    cardCanvas.width = Math.round(regionWidth * scale);
    cardCanvas.height = Math.round(regionHeight * scale);
    const cardContext = cardCanvas.getContext('2d', { willReadFrequently: true });
    if (!cardContext) continue;
    cardContext.imageSmoothingQuality = 'high';
    cardContext.drawImage(image, region.x0, region.y0, regionWidth, regionHeight, 0, 0, cardCanvas.width, cardCanvas.height);
    const pixels = cardContext.getImageData(0, 0, cardCanvas.width, cardCanvas.height);
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const gray = pixels.data[offset] * 0.299 + pixels.data[offset + 1] * 0.587 + pixels.data[offset + 2] * 0.114;
      pixels.data[offset] = gray;
      pixels.data[offset + 1] = gray;
      pixels.data[offset + 2] = gray;
    }
    cardContext.putImageData(pixels, 0, 0);
    await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
    const { data } = await worker.recognize(cardCanvas, {}, { blocks: true });
    const lines = (data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines));
    await fillMissingNtgCardDetails(worker, cardCanvas, lines);
    loads.push(...parseNtgScreenshotLines(lines, cardCanvas.width, cardCanvas.height, { wholeCard: true })
      .map(load => ({
        ...load,
        id: /^NTG-/.test(load.id) ? `NTG-${Date.now()}-${index}` : load.id,
        ...(lines.ntgIdUncertain && !/^NTG-/.test(load.id)
          ? { notes: [load.notes, 'Load number was hard to read from the screenshot; please verify it.'].filter(Boolean).join(' ') }
          : {})
      })));
  }
  await worker.setParameters({ tessedit_pageseg_mode: '3', tessedit_char_whitelist: '' });
  return loads;
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

// DAT region names that are not postal cities, so ZIP data cannot correct OCR misreads.
const datRegionCityAliases = {
  NY: { LONGLISLAND: 'LONG ISLAND' }
};

function correctDatCities(loads, zipData) {
  const normalize = value => String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
  const cache = {};
  const citiesFor = state => {
    if (!cache[state]) {
      const names = Array.from(new Set((zipData.lookupByState?.(state) || []).map(item => String(item.city).toUpperCase())));
      cache[state] = names.map(name => ({ name, key: normalize(name) }));
    }
    return cache[state];
  };
  const fix = (load, cityKey, stateKey) => {
    const state = load[stateKey];
    const cities = state ? citiesFor(state) : [];
    if (!cities.length) return;
    const tokens = String(load[cityKey] || '').toUpperCase().split(/\s+/).filter(Boolean);
    if (!tokens.length || cities.some(city => city.name === tokens.join(' '))) return;
    let best = null;
    for (let start = 0; start < tokens.length; start += 1) {
      for (let end = tokens.length; end > start; end -= 1) {
        const text = tokens.slice(start, end).join(' ');
        const exact = cities.find(city => city.name === text || city.key === normalize(text));
        if (exact && (!best || text.length > best.length)) best = { length: text.length, name: exact.name };
      }
    }
    if (!best) {
      const joined = normalize(tokens.join(''));
      let bestDistance = 3;
      cities.forEach(city => {
        if (city.key.length < 5) return;
        const distance = editDistance(city.key, joined);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { name: city.name };
        }
      });
      Object.entries(datRegionCityAliases[state] || {}).forEach(([key, name]) => {
        const distance = editDistance(key, joined);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { name };
        }
      });
    }
    if (best) load[cityKey] = best.name;
  };
  loads.forEach(load => {
    fix(load, 'origCity', 'origSt');
    fix(load, 'destCity', 'destSt');
    load.route = `${load.origCity}${load.origSt ? `, ${load.origSt}` : ''} → ${load.destCity}${load.destSt ? `, ${load.destSt}` : ''}`;
  });
  return loads;
}

function correctCitiesFromZip(loads, zipData) {
  const normalize = value => String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
  const fix = (load, cityKey, stateKey, zipKey) => {
    const zip = String(load[zipKey] || '').replace(/\D/g, '').slice(0, 5);
    const location = zip.length === 5 ? zipData.codes?.[zip] : null;
    const ocrCity = normalize(load[cityKey]);
    const truncated = /\.\.|…/.test(String(load[cityKey] || '')) && ocrCity.length >= 5;
    if (truncated && load[stateKey]) {
      const names = Array.from(new Set((zipData.lookupByState?.(load[stateKey]) || []).map(item => String(item.city))));
      const candidates = names.filter(name => normalize(name).startsWith(ocrCity));
      if (candidates.length === 1) {
        load[cityKey] = candidates[0].toUpperCase();
        return;
      }
    }
    if (!location && !load[stateKey] && ocrCity.length >= 3) {
      const cityName = String(load[cityKey]).trim();
      const states = Array.from(stateCodes).filter(code => zipData.lookupByName?.(cityName, code)?.length);
      if (states.length === 1) load[stateKey] = states[0];
      return;
    }
    if (!location) return;
    if (load[stateKey] && load[stateKey] !== location.state) return;
    const postalCity = normalize(location.city);
    // A ZIP's preferred postal city can differ from the actual load city.
    if (!ocrCity || ocrCity === postalCity
      || ocrCity.length >= 5 && editDistance(ocrCity, postalCity) <= 2
      || truncated && postalCity.startsWith(ocrCity)) {
      load[cityKey] = String(location.city).toUpperCase();
    }
    load[stateKey] = location.state;
  };
  loads.forEach(load => {
    fix(load, 'origCity', 'origSt', 'origZip');
    fix(load, 'destCity', 'destSt', 'destZip');
    load.route = `${load.origCity}${load.origSt ? `, ${load.origSt}` : ''} → ${load.destCity}${load.destSt ? `, ${load.destSt}` : ''}`;
  });
  return loads;
}

function parseDatRateText(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (/\/\s*mi\b/i.test(line)) continue;
    const match = line.match(/^\$?\s*(\d{1,3}(?:,\d{3})+|\d{3,5})(?:\.00)?\s*$/);
    if (match) {
      const rate = Number(match[1].replace(/,/g, ''));
      if (rate >= 100 && rate < 100000) return rate;
    }
  }
  return 0;
}

function parseDatScreenshotLines(lines, imageWidth, imageHeight, selectedBroker, laneRates) {
  const allBbox = lines.flatMap(line => [line.bbox, ...(line.words || []).map(word => word.bbox)].filter(Boolean));
  if (!(imageWidth > 0) && allBbox.length) imageWidth = Math.max(...allBbox.map(b => b.x1 || 0));
  if (!(imageHeight > 0) && allBbox.length) imageHeight = Math.max(...allBbox.map(b => b.y1 || 0));
  const cleanCell = words => words
    .sort((a, b) => a.bbox.x0 - b.bbox.x0)
    .map(word => word.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const headerCenters = {};
  const headerPatterns = {
    rate: /^rate/i,
    trip: /^trip$/i,
    origin: /^origin$/i,
    destination: /^destination$/i,
    pickup: /^pick(?:\s*up)?$/i,
    equipment: /^e[sq5)\]]+$/i,
    weight: /^weight$/i
  };
  const allWords = lines.flatMap(line => line.words || []);
  const headerWords = {};
  Object.entries(headerPatterns).forEach(([field, pattern]) => {
    headerWords[field] = allWords
      .filter(word => pattern.test(word.text))
      .sort((a, b) => a.bbox.y0 - b.bbox.y0)[0];
    if (headerWords[field]) {
      headerCenters[field] = (headerWords[field].bbox.x0 + headerWords[field].bbox.x1) / 2 / imageWidth;
    }
  });
  const headerFields = Object.keys(headerCenters)
    .sort((a, b) => headerCenters[a] - headerCenters[b]);
  const getHeaderCell = (line, field) => {
    const fieldIndex = headerFields.indexOf(field);
    if (fieldIndex < 0) return '';
    const center = headerCenters[field];
    const left = fieldIndex === 0
      ? 0
      : (headerCenters[headerFields[fieldIndex - 1]] + center) / 2;
    const right = fieldIndex === headerFields.length - 1
      ? 1
      : (center + headerCenters[headerFields[fieldIndex + 1]]) / 2;
    return cleanCell(line.words.filter(word => {
      const wordCenter = (word.bbox.x0 + word.bbox.x1) / 2 / imageWidth;
      return wordCenter >= left && wordCenter < right;
    }));
  };
  const getCellBounds = field => {
    const fieldIndex = headerFields.indexOf(field);
    if (fieldIndex < 0) return null;
    const center = headerCenters[field];
    return {
      left: fieldIndex === 0 ? 0 : (headerCenters[headerFields[fieldIndex - 1]] + center) / 2,
      right: fieldIndex === headerFields.length - 1
        ? 1
        : (center + headerCenters[headerFields[fieldIndex + 1]]) / 2
    };
  };
  const tripBounds = getCellBounds('trip');
  const rateBounds = getCellBounds('rate');
  const tripHeaderY = headerWords.trip
    ? (headerWords.trip.bbox.y0 + headerWords.trip.bbox.y1) / 2
    : 0;
  const tripAnchors = tripBounds
    ? allWords.filter(word => {
      const centerX = (word.bbox.x0 + word.bbox.x1) / 2 / imageWidth;
      const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
      return centerX >= tripBounds.left
        && centerX < tripBounds.right
        && centerY > tripHeaderY
        && /^\d{2,5}$/.test(word.text.replace(/[Oo]/g, '0'));
    }).sort((a, b) => a.bbox.y0 - b.bbox.y0)
    : [];
  const pickupHeaderY = headerWords.pickup
    ? (headerWords.pickup.bbox.y0 + headerWords.pickup.bbox.y1) / 2
    : tripHeaderY;
  const pickupDateAnchors = allWords.filter(word => {
    const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
    const text = word.text.replace(/[Oo]/g, '0');
    return centerY > pickupHeaderY
      && !/[$]|\/\s*mi\b/i.test(text)
      && /\b(?:0?[1-9]|1[0-2])\s*[/.-]\s*(?:0?[1-9]|[12]\d|3[01])(?:\s*[/.-]\s*\d{2,4})?\b/.test(text);
  }).sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const datRows = [];
  const rowTolerance = Math.max(8, Math.min(imageHeight * 0.02, imageHeight * 0.035));
  const rowAnchors = tripAnchors.length ? tripAnchors : pickupDateAnchors;
  rowAnchors.forEach(anchor => {
    const centerY = (anchor.bbox.y0 + anchor.bbox.y1) / 2;
    const previous = datRows[datRows.length - 1];
    if (previous && Math.abs(previous.centerY - centerY) < rowTolerance * 0.5) return;
    const words = allWords.filter(word =>
      Math.abs((word.bbox.y0 + word.bbox.y1) / 2 - centerY) <= rowTolerance
    );
    datRows.push({
      words,
      text: words.map(word => word.text).join(' '),
      bbox: { y0: centerY - rowTolerance, y1: centerY + rowTolerance },
      trip: tripAnchors.length ? anchor.text.replace(/[Oo]/g, '0') : ''
    });
  });
  const rowsToRead = datRows.length ? datRows : lines;
  const rowEquipment = line => {
    const fromCell = getHeaderCell(line, 'equipment').toUpperCase().replace(/^VV$/, 'V')
      .match(/\b(VT|VAN|V|R|F|SD|VR|RZ|VZ|VE|FH|RG|ST|LB|AC|HS|HR|LA|SR|SS|TT|VA|VF|VS|DD|DT|FA|FB|FD|FN|FR|FT|GN|LS|LT|NB|NF|NG|NR|NS|OT|PD|PO|RA|RE|RF|RN|RO|RS|RT|SB|SC|SK|SL|SN|SO|SQ|SW|TA|TB|TC|TD|TE|TF|TG|TH|TK|TL|TM|TN|TO|TP|TR|TS|TU|TV|TW|TX|TY|TZ)\b/)?.[0];
    if (fromCell) return fromCell;
    const date = line.text.match(/\b(?:1[0-2]|0?[1-9])\s*[/.-]\s*(?:3[01]|[12]\d|0?[1-9])\b/);
    return date
      ? line.text.slice(date.index + date[0].length).toUpperCase()
        .match(/\b(VT|VAN|VV|V|R|F|SD|VR|RZ|VZ|VE|FH|RG|ST|LB|AC|HS|HR|LA|SR|SS|TT|VA|VF|VS|DD|DT|FA|FB|FD|FN|FR|FT|GN|LS|LT|NB|NF|NG|NR|NS|OT|PD|PO|RA|RE|RF|RN|RO|RS|RT|SB|SC|SK|SL|SN|SO|SQ|SW|TA|TB|TC|TD|TE|TF|TG|TH|TK|TL|TM|TN|TO|TP|TR|TS|TU|TV|TW|TX|TY|TZ)\b/)?.[0]?.replace(/^VV$/, 'V') || ''
      : '';
  };
  const equipmentCounts = rowsToRead
    .map(rowEquipment)
    .filter(Boolean)
    .reduce((counts, equipment) => ({
      ...counts,
      [equipment]: (counts[equipment] || 0) + 1
    }), {});
  const [dominantEquipment, dominantEquipmentCount] = Object.entries(equipmentCounts)
    .sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const reliableDominantEquipment = dominantEquipmentCount >= 3
    && dominantEquipmentCount / Object.values(equipmentCounts).reduce((total, count) => total + count, 0) >= 0.8
    ? dominantEquipment
    : '';
  const rateObservations = lines.flatMap(line => {
    const rateText = line.text.replace(/\$\s*[\d,.]+[^A-Za-z0-9]*\/\s*mi\b/gi, '');
    const match = rateText.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
    const rate = Number(match?.[1].replace(/,/g, ''));
    return rate > 0
      ? [{ y: (line.bbox.y0 + line.bbox.y1) / 2, rate }]
      : [];
  });
  const getLocation = value => {
    const match = value.match(/^(.*?)[,\s]+([A-Z]{2})$/i);
    if (!match || !stateCodes.has(match[2].toUpperCase())) return null;
    const city = match[1]
      .replace(/^[A-Za-z0]{1,2}\s*[-=>»|]+\s*/, '')
      .replace(/^([NSEW])(?=[A-Z][a-z]{2,})/, '$1 ')
      .replace(/^[Oo0]\s+(?=[A-Z])/, '')
      .replace(/[^\w\s.'-]/g, '')
      .trim()
      .toUpperCase();
    const tokens = city.split(/\s+/).filter(Boolean);
    const cleanedTokens = tokens.filter((token, tokenIndex) =>
      !tokens.some((other, otherIndex) =>
        otherIndex !== tokenIndex
        && token.length >= 4
        && (other.length > token.length || (other.length === token.length && otherIndex < tokenIndex))
        && other.includes(token))
      && !(tokenIndex === tokens.length - 1 && tokenIndex > 0 && token.replace(/[^A-Z]/g, '').length <= 2)
    );
    const finalCity = cleanedTokens.join(' ').replace(/[^\w\s.'-]/g, '').trim();
    return finalCity ? { city: finalCity, state: match[2].toUpperCase() } : null;
  };
  const monthCounts = {};
  allWords.forEach(word => {
    const found = word.text.replace(/[Oo]/g, '0').match(/^(1[0-2]|[1-9])\/(3[01]|[12]\d|0?[1-9])$/);
    if (found) monthCounts[found[1]] = (monthCounts[found[1]] || 0) + 1;
  });
  const commonMonth = Number(Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0]?.[0]) || new Date().getMonth() + 1;
  const getDate = value => {
    const cleaned = value.replace(/[Oo]/g, '0').trim();
    const match = cleaned.match(/\b(1[0-2]|0?[1-9])\s*[/.-]\s*(3[01]|[12]\d|0?[1-9])\b/)
      || cleaned.match(/^(1[0-2])(0[1-9]|[12]\d|3[01])$/)
      || cleaned.match(/(?:^|\s)0\s*\/\s*(3[01]|[12]\d|0?[1-9])\b/);
    if (!match) return '';
    const isMissingMonth = match.length === 2;
    const month = isMissingMonth ? commonMonth : Number(match[1]);
    const day = Number(isMissingMonth ? match[1] : match[2]);
    const year = new Date().getFullYear();
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
    return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
  };
  const getTextRow = text => {
    const normalizedText = String(text || '')
      .replace(/\$?\s*\d[\d,.]*\s*[/°*]\s*mi\b/gi, ' ')
      .replace(/\/\s*mi\b/gi, ' ')
      .replace(/[Oo](?=\d)/g, '0')
      .replace(/[IlM1|]bs\b/g, ' lbs');
    const dateMatch = normalizedText.match(/\b(1[0-2]|0?[1-9])\s*[/.-]\s*(3[01]|[12]\d|0?[1-9])\b/);
    if (!dateMatch) return null;
    const prefix = normalizedText.slice(0, dateMatch.index);
    const stateMatches = Array.from(prefix.matchAll(/\b([A-Z]{2})\b/gi))
      .filter(match => stateCodes.has(match[1].toUpperCase()));
    if (stateMatches.length < 2) return null;

    const originStateMatch = stateMatches[0];
    const destinationStateMatch = stateMatches[1];
    const originPrefix = prefix.slice(0, originStateMatch.index);
    const tripNumberMatches = Array.from(originPrefix.matchAll(/\b\d{3,8}\s+/g));
    const originText = tripNumberMatches.length
      ? originPrefix.slice(tripNumberMatches[tripNumberMatches.length - 1].index + tripNumberMatches[tripNumberMatches.length - 1][0].length)
      : originPrefix;
    const originCity = originText.replace(/[^A-Z\s.'-]/gi, ' ').replace(/\s+/g, ' ').trim();
    const destinationCity = prefix
      .slice(originStateMatch.index + originStateMatch[0].length, destinationStateMatch.index)
      .replace(/[^A-Z\s.'-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const tail = normalizedText.slice(dateMatch.index + dateMatch[0].length);
    const equipment = tail.match(/\b(VT|VAN|VV|V|R|F|SD|VR|RZ|VZ|VE|FH|RG|ST|LB|AC|HS|HR|LA|SR|SS|TT|VA|VF|VS|DD|DT|FA|FB|FD|FN|FR|FT|GN|LS|LT|NB|NF|NG|NR|NS|OT|PD|PO|RA|RE|RF|RN|RO|RS|RT|SB|SC|SK|SL|SN|SO|SQ|SW|TA|TB|TC|TD|TE|TF|TG|TH|TK|TL|TM|TN|TO|TP|TR|TS|TU|TV|TW|TX|TY|TZ)\b/i)?.[0]?.toUpperCase().replace(/^VV$/, 'V') || '';
    const weight = normalizedText.match(/([\d][\d,.]*)\s*lbs?\b/i)?.[1] || '';
    const origin = getLocation(`${originCity}, ${originStateMatch[1]}`);
    const destination = getLocation(`${destinationCity}, ${destinationStateMatch[1]}`);
    const pickupDate = getDate(dateMatch[0]);
    if (!origin || !destination || !pickupDate || !equipment || !(Number(weight.replace(/,/g, '')) > 0)) return null;
    return { origin, destination, pickupDate, equipment, weightRaw: weight };
  };
  const loads = [];
  rowsToRead.forEach((line, index) => {
    if (!line.words?.length) return;
    const textRow = getTextRow(line.text);
    const origin = getLocation(getHeaderCell(line, 'origin')) || textRow?.origin;
    const destination = getLocation(getHeaderCell(line, 'destination')) || textRow?.destination;
    const pickupBounds = getCellBounds('pickup');
    const rowCenterY = (line.bbox.y0 + line.bbox.y1) / 2;
    const pickupWords = pickupBounds
      ? allWords.filter(word => {
        const centerX = (word.bbox.x0 + word.bbox.x1) / 2 / imageWidth;
        const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
        return centerX >= pickupBounds.left && centerX < pickupBounds.right
          && centerY > tripHeaderY
          && Math.abs(centerY - rowCenterY) <= rowTolerance * 2;
      })
      : line.words;
    const pickupCell = cleanCell(pickupWords) || getHeaderCell(line, 'pickup');
    const pickupRange = pickupCell.match(/(\d{1,2}\s*\/\s*\d{1,2})\s*[-–—]\s*(\d{1,2}\s*\/\s*\d{1,2})/)
      || line.text.match(/(\d{1,2}\s*\/\s*\d{1,2})\s*[-–—]\s*(\d{1,2}\s*\/\s*\d{1,2})/);
    const pickupDate = getDate(pickupRange?.[1] || pickupCell) || textRow?.pickupDate || '';
    const pickupEndDate = pickupRange ? getDate(pickupRange[2]) : '';
    const equipmentText = getHeaderCell(line, 'equipment').toUpperCase().replace(/^VV$/, 'V');
    const equipment = equipmentText.match(/\b(VT|VAN|V|R|F|SD|VR|RZ|VZ|VE|FH|RG|ST|LB|AC|HS|HR|LA|SR|SS|TT|VA|VF|VS|DD|DT|FA|FB|FD|FN|FR|FT|GN|LS|LT|NB|NF|NG|NR|NS|OT|PD|PO|RA|RE|RF|RN|RO|RS|RT|SB|SC|SK|SL|SN|SO|SQ|SW|TA|TB|TC|TD|TE|TF|TG|TH|TK|TL|TM|TN|TO|TP|TR|TS|TU|TV|TW|TX|TY|TZ)\b/)?.[0]
      || textRow?.equipment
      || reliableDominantEquipment
      || 'V';
    const weightText = getHeaderCell(line, 'weight').replace(/[Oo]/g, '0').replace(/[IlM1|]bs\b/g, ' lbs');
    const rawWeight = weightText.match(/(\d[\d,.]*)\s*lbs?\b/i)?.[1]
      || weightText.match(/\d[\d,.]*/)?.[0]
      || textRow?.weightRaw
      || '';
    const weight = rawWeight.replace(/^(\d{1,3},\d{3})\d$/, '$1').replace(/,/g, '');
    const trip = line.trip || getHeaderCell(line, 'trip').replace(/[Oo]/g, '0').match(/\b\d{2,5}\b/)?.[0] || '';
    const positionedRateWords = rateBounds
      ? allWords.filter(word => {
        const centerX = (word.bbox.x0 + word.bbox.x1) / 2 / imageWidth;
        const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
        const rowCenter = (line.bbox.y0 + line.bbox.y1) / 2;
        return centerX >= rateBounds.left
          && centerX < rateBounds.right
          && Math.abs(centerY - rowCenter) <= rowTolerance;
      })
        .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)
      : [];
    const positionedRateLines = [];
    positionedRateWords.forEach(word => {
      const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
      const previousLine = positionedRateLines[positionedRateLines.length - 1];
      if (previousLine && Math.abs(previousLine.centerY - centerY) <= rowTolerance * 0.25) {
        previousLine.words.push(word);
      } else {
        positionedRateLines.push({ centerY, words: [word] });
      }
    });
    const positionedRate = positionedRateLines
      .map(rateLine => cleanCell(rateLine.words))
      .filter(rateLine => !/\/\s*mi\b/i.test(rateLine))
      .map(rateLine => Number(
        rateLine.match(/(?:\$\s*)(\d[\d,]*(?:\.\d{1,2})?)/)?.[1]?.replace(/,/g, '')
          || rateLine.replace(/,/g, '').match(/(?:\$\s*)?(\d{3,})\b/)?.[1]
          || 0
      ))
      .find(rateValue => rateValue >= 100) || 0;
    const rateText = getHeaderCell(line, 'rate');
    const directRate = /\$/.test(rateText)
      ? Number(rateText.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/)?.[1]?.replace(/,/g, '') || 0)
      : 0;
    const rowCenter = (line.bbox.y0 + line.bbox.y1) / 2;
    const nearestRate = rateObservations
      .map(observation => ({ ...observation, distance: Math.abs(observation.y - rowCenter) }))
      .filter(observation => observation.distance <= imageHeight * 0.045)
      .sort((a, b) => a.distance - b.distance)[0];
    const rate = positionedRate || directRate || nearestRate?.rate || 0;
    const hasWeight = Number(weight?.replace(/,/g, '')) > 0;
    const equipmentWasGuessed = !equipmentText.match(/\b(VT|VAN|V|R|F|SD|VR|RZ|VZ|VE|FH|RG)\b/) && !textRow?.equipment;
    if (!origin || !destination || !pickupDate || !equipment) return;
    if (!line.text.trim()) return;

    const order = {
      id: `DAT-${Date.now()}-${index}`,
      eCode: equipment,
      team: equipment === 'VT' ? 'true' : 'false',
      status: 'OPEN',
      tag: 'OPEN',
      route: `${origin.city}, ${origin.state} → ${destination.city}, ${destination.state}`,
      puDate: `PU: ${pickupDate}`,
      delDate: 'DFL: Upcoming',
      pickupTime: pickupEndDate
        ? `${pickupDate} 0800 - ${pickupEndDate} 1600`
        : `${pickupDate} 0800 - 1600`,
      origCity: origin.city,
      origSt: origin.state,
      origZip: '',
      weight: hasWeight ? `${weight} lbs` : '40000 lbs',
      deliveryTime: isNolanCustomer(selectedBroker) ? '' : '0800 - 1600',
      destCity: destination.city,
      destSt: destination.state,
      destZip: '',
      miles: trip,
      planningComment: [
        'Imported from DAT screenshot',
        !hasWeight && 'weight not visible — enter weight',
        equipmentWasGuessed && 'equipment not read — confirm equipment'
      ].filter(Boolean).join('; '),
      carrier: '',
      driver: '',
      truck: '',
      trailer: '',
      rateInput: rate > 0 ? String(rate) : '',
      ...(rate > 0 ? { rateSource: 'dat-screenshot' } : {}),
      brokerable: 'false',
      rateCrop: { centerY: (line.bbox.y0 + line.bbox.y1) / 2 },
      notes: `DAT screenshot does not include ZIP codes. ${trip ? 'Trip value was imported as miles; verify it.' : 'Trip miles were not recognized; enter them before export.'}`
    };
    // Your saved rate for this lane beats the rate on the DAT screenshot.
    const savedLaneRate = getSavedLaneRate(laneRates, selectedBroker, order);
    if (savedLaneRate) {
      order.rateInput = savedLaneRate;
      order.rateSource = 'user-entered';
    }
    loads.push(order);
  });
  const lanes = {};
  loads.forEach(load => {
    const key = `${load.origCity}|${load.origSt}|${load.destCity}|${load.destSt}`;
    (lanes[key] = lanes[key] || []).push(load);
  });
  Object.values(lanes).forEach(group => {
    const counts = {};
    group.forEach(load => { if (load.miles) counts[load.miles] = (counts[load.miles] || 0) + 1; });
    const [common, commonCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ['', 0];
    if (commonCount < 2) return;
    group.forEach(load => {
      if (load.miles !== common && editDistance(load.miles, common) <= 1) load.miles = common;
    });
  });
  const rowCenters = loads.map(load => load.rateCrop.centerY).sort((a, b) => a - b);
  const spacings = rowCenters.slice(1).map((center, index) => center - rowCenters[index]).filter(gap => gap > 10).sort((a, b) => a - b);
  const rowHeight = spacings[Math.floor(spacings.length / 2)] || imageHeight * 0.06;
  const tripLeft = headerWords.trip
    ? headerWords.trip.bbox.x0
    : (tripAnchors.length ? Math.min(...tripAnchors.map(word => word.bbox.x0)) : imageWidth * 0.1);
  const rateRight = tripLeft * 0.71;
  loads.forEach(load => {
    const { centerY } = load.rateCrop;
    load.rateCrop = { centerY, rowHeight, x0: 0, x1: Math.round(rateRight) };
  });
  return loads;
}

function getEquipmentDescription(eCode) {
  const code = eCode?.trim().toUpperCase();
  switch (code) {
    case 'VE': return 'VAN:VAN';
    case 'VZ': return 'VAN:VAN, VAN:53VN, REFR:REFR';
    case 'VAN':
    case 'V': return 'VAN:VAN, VAN:53VN';
    case 'VM':
    case 'VT': return 'VAN:VAN, VAN:53VN';
    case 'VR': return 'VAN:VAN, REFR:REFR';
    case 'V,R': return 'VAN:VAN, REFR:REFR';
    case 'R': return 'REFR:REFR';
    case 'RZ': return 'REFR:REFR';
    case 'F': return '48FL, 53FL, FLAT';
    case 'F,SD': return '48FL, 53FL, FLAT, STEP:SD';
    case 'FH': return '48FL, 53FL, FLAT, STEP:SD';
    case 'FV': return '48FL, 53FL, FLAT, STEP:SD';
    case 'FLCS': return 'FLCS';
    case 'SD': return 'STEP:SD';
    case 'D-LG': return 'Straight truck - liftgate required';
    case 'D-ST': return 'Straight truck';
    case 'D-RF': return 'Straight truck - reefer';
    case 'D-LG,D-ST': return 'D-LG, D-ST';
    default: return eCode || 'VAN:VAN';
  }
}

function formatExcelDateTime(val) {
  if (val == null || val === '') return '10/18/2026 0800 - 1200';
  if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
    return formatRxoExcelDateTime(val);
  }
  const str = String(val).trim();
  if (/^\d+(?:\.\d+)?$/.test(str) && Number(str) >= 10000) {
    return formatRxoExcelDateTime(Number(str));
  }
  return str;
}

function formatRxoExcelDateTime(value) {
  const text = String(value ?? '').trim();
  let date;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    date = new Date(Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
      value.getUTCHours(),
      value.getUTCMinutes()
    ));
  } else if (
    (typeof value === 'number' && Number.isFinite(value) && value >= 0)
    || (/^\d+(?:\.\d+)?$/.test(text) && Number(text) >= 0)
  ) {
    const serial = Number(value);
    date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
  } else {
    const timeRange = text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):?(\d{2})\s*(AM|PM)?\s*(?:-|–|—|to)\s*(\d{1,2}):?(\d{2})\s*(AM|PM)?$/i
    );
    if (timeRange) {
      const to24 = (h, m, meridiem) => {
        let hour = Number(h);
        if (meridiem) {
          if (hour < 1 || hour > 12) return null;
          hour = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
        }
        return hour > 23 || Number(m) > 59 ? null : `${String(hour).padStart(2, '0')}${m}`;
      };
      const start = to24(timeRange[4], timeRange[5], timeRange[6]);
      const end = to24(timeRange[7], timeRange[8], timeRange[9] || timeRange[6]);
      const year = timeRange[3].length === 2 ? `20${timeRange[3]}` : timeRange[3];
      if (start && end) {
        return `${timeRange[1].padStart(2, '0')}/${timeRange[2].padStart(2, '0')}/${year} ${start} - ${end}`;
      }
      return text;
    }
    const usDateTime = text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):?(\d{2})\s*(AM|PM)?$/i
    );
    const isoDateTime = text.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/
    );
    if (!usDateTime && !isoDateTime) return text;

    const month = Number(usDateTime ? usDateTime[1] : isoDateTime[2]);
    const day = Number(usDateTime ? usDateTime[2] : isoDateTime[3]);
    const yearText = usDateTime ? usDateTime[3] : isoDateTime[1];
    const year = Number(yearText) < 100 ? 2000 + Number(yearText) : Number(yearText);
    let hour = Number(usDateTime ? usDateTime[4] : isoDateTime[4]);
    const minute = Number(usDateTime ? usDateTime[5] : isoDateTime[5]);
    const meridiem = usDateTime?.[6]?.toUpperCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) return text;
      hour = hour % 12 + (meridiem === 'PM' ? 12 : 0);
    }
    date = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day || hour > 23 || minute > 59) {
      return text;
    }
  }

  if (!Number.isFinite(date.getTime())) return '';
  const pad = part => String(part).padStart(2, '0');
  return `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

function formatRxoBusinessHours(dateTime, endTime) {
  const dateMatch = String(dateTime || '').match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (!dateMatch) return dateTime;
  const [, month, day, yearText] = dateMatch;
  const year = yearText.length === 2 ? `20${yearText}` : yearText;
  const date = `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`;
  return `${date} 0800 - ${endTime}`;
}

function applyRxoPayerBusinessHours(loads, customer) {
  if (normalizeCustomerName(customer) !== rxoPayerCustomerName) return loads;
  return loads.map(load => ({
    ...load,
    pickupTime: formatRxoBusinessHours(load.pickupTime || load.puDate, '2000'),
    deliveryTime: formatRxoBusinessHours(load.deliveryTime || load.delDate, '1200')
  }));
}

function decodeGmailBody(data) {
  const base64 = String(data || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function getGmailMessageText(payload) {
  const plainParts = [];
  const htmlParts = [];
  const collectParts = part => {
    if (part.body?.data) {
      if (part.mimeType === 'text/plain') plainParts.push(decodeGmailBody(part.body.data));
      if (part.mimeType === 'text/html') htmlParts.push(decodeGmailBody(part.body.data));
    }
    (part.parts || []).forEach(collectParts);
  };
  collectParts(payload);
  if (plainParts.length) return plainParts.join('\n');
  if (!htmlParts.length) return '';

  const htmlAsText = htmlParts.join('\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:tr|p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, '\n');
  const document = new DOMParser().parseFromString(htmlAsText, 'text/html');
  return (document.body.textContent || '').replace(/[ \t]+\n/g, '\n');
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) resolve();
      else reject(new Error('Google authorization did not initialize.'));
    };
    script.onerror = () => reject(new Error('Could not load Google authorization. Check your internet connection.'));
    document.head.appendChild(script);
  });
}

async function getGmailApiError(response, action) {
  let details = '';
  try {
    const body = await response.json();
    const apiError = body.error;
    details = apiError?.message || apiError?.errors?.[0]?.reason || '';
  } catch (error) {
    console.error(`Could not read Gmail ${action} error details:`, error);
  }
  return new Error(`Gmail ${action} failed (${response.status})${details ? `: ${details}` : '.'}`);
}

// ==========================================
// C.H. ROBINSON LOAD-BOARD SCREENSHOT (date-grouped table with Weight and Bin/rate columns)
// ==========================================
function findChHeaders(lines) {
  const words = lines.flatMap(line => line.words || []);
  const find = pattern => words.filter(word => pattern.test(word.text)).sort((a, b) => a.bbox.y0 - b.bbox.y0)[0];
  const headers = {
    origin: find(/^origin$/i),
    ost: find(/^ost$/i),
    destination: find(/^destination$/i),
    dst: find(/^dst$/i),
    pickup: find(/^pickup$/i),
    mode: find(/^mode$/i),
    bin: find(/^bin$/i)
  };
  return Object.values(headers).every(Boolean) ? headers : null;
}

function getChColumnBounds(headers, imageWidth) {
  const margin = imageWidth * 0.008;
  return {
    originLeft: headers.origin.bbox.x0 - margin * 1.5,
    ostLeft: headers.ost.bbox.x0 - margin,
    destinationLeft: headers.destination.bbox.x0 - margin,
    dstLeft: headers.dst.bbox.x0 - margin,
    pickupLeft: headers.pickup.bbox.x0 - margin,
    modeLeft: headers.mode.bbox.x0 - margin,
    binLeft: headers.bin.bbox.x0 - margin
  };
}

// The board shows weights like "17.007.9 lbs" or "8.496 lbs" because OCR confuses commas and periods.
function parseChWeight(text) {
  const raw = String(text || '').match(/\d[\d.,]*/)?.[0]?.replace(/[.,]+$/, '');
  if (!raw) return 0;
  const parts = raw.split(/[.,]/);
  if (parts.length === 1) return Number(parts[0]);
  const last = parts[parts.length - 1];
  const value = last.length === 3
    ? Number(parts.join(''))
    : Number(`${parts.slice(0, -1).join('')}.${last}`);
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function parseChScreenshotLines(lines, imageWidth, imageHeight, selectedBroker, laneRates, strips = {}) {
  const headers = findChHeaders(lines);
  if (!headers) return { loads: [], skippedLtl: 0, skippedNoDate: 0 };
  const bounds = getChColumnBounds(headers, imageWidth);
  const pad = value => String(value).padStart(2, '0');
  const cellText = (line, left, right) => (line.words || [])
    .filter(word => {
      const center = (word.bbox.x0 + word.bbox.x1) / 2;
      return center >= left && center < right;
    })
    .sort((a, b) => a.bbox.x0 - b.bbox.x0)
    .map(word => word.text)
    .join(' ');
  const cleanCity = text => text.toUpperCase().replace(/[^A-Z\s.'-]/g, ' ').replace(/\s+/g, ' ').trim();
  const sortedLines = [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const rowCenters = sortedLines
    .filter(line => /(?<!\d)\d{9}(?!\d)/.test(line.text))
    .map(line => (line.bbox.y0 + line.bbox.y1) / 2);
  const gaps = rowCenters.slice(1).map((center, index) => center - rowCenters[index]).filter(gap => gap > 4).sort((a, b) => a - b);
  const rowGap = gaps[Math.floor(gaps.length / 2)] || imageHeight * 0.012;
  const nearestStrip = (items, y) => (items || [])
    .map(item => ({ ...item, distance: Math.abs(item.y - y) }))
    .filter(item => item.distance <= rowGap * 0.55)
    .sort((a, b) => a.distance - b.distance)[0];

  let pickupDate = '';
  let skippedLtl = 0;
  let skippedNoDate = 0;
  const seenIds = new Set();
  const parsedRows = [];
  sortedLines.forEach(line => {
    const heading = line.text.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(20\d{2})\s*-\s*[A-Za-z]{3}/);
    if (heading) {
      pickupDate = `${pad(heading[1])}/${pad(heading[2])}/${heading[3]}`;
      return;
    }
    const idMatch = line.text.match(/(?<!\d)(\d{9})(?!\d)/);
    if (!idMatch || idMatch.index > 12 || seenIds.has(idMatch[1])) return;
    if (!pickupDate) {
      skippedNoDate += 1;
      return;
    }
    const y = (line.bbox.y0 + line.bbox.y1) / 2;
    const modeText = cellText(line, bounds.modeLeft, bounds.modeLeft + (bounds.binLeft - bounds.modeLeft) * 0.3)
      .toUpperCase().replace(/[^A-Z,]/g, '');
    const rowText = line.text.toUpperCase();
    if (/LTL/.test(modeText) || /\sLTL\s/.test(` ${rowText} `)) {
      skippedLtl += 1;
      return;
    }
    seenIds.add(idMatch[1]);

    const notes = ['Imported from CH screenshot; delivery date/time and miles are not on the board.'];
    const origin = cleanCity(cellText(line, bounds.originLeft, bounds.ostLeft));
    const destination = cleanCity(cellText(line, bounds.destinationLeft, bounds.dstLeft));
    if (!origin || !destination) return;
    const readState = (stripItems, left, right) => {
      const fromStrip = nearestStrip(stripItems, y)?.text || '';
      if (stateCodes.has(fromStrip)) return fromStrip;
      const fromRow = cellText(line, left, right).toUpperCase().replace(/[^A-Z]/g, '');
      return stateCodes.has(fromRow) ? fromRow : '';
    };
    const originState = readState(strips.ost, bounds.ostLeft, bounds.destinationLeft);
    const destinationState = readState(strips.dst, bounds.dstLeft, bounds.pickupLeft);

    const pickupCell = cellText(line, bounds.pickupLeft, bounds.modeLeft);
    const time = pickupCell.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/)
      || line.text.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
    const validTime = time && Number(time[1]) <= 23 && Number(time[3]) <= 23 && Number(time[2]) <= 59 && Number(time[4]) <= 59;
    if (!validTime) notes.push('Pickup hours could not be read; verify them.');
    const pickupHours = validTime
      ? `${pad(time[1])}${time[2]} - ${pad(time[3])}${time[4]}`
      : '0800 - 1600';

    const weight = parseChWeight(line.text.match(/(\d[\d.,]*)\s*[Il1|]bs\b/i)?.[1]);
    if (!weight) notes.push('Weight could not be read; enter it before export.');

    const binText = nearestStrip(strips.bin, y)?.text || '';
    const rateText = binText.match(/\d{3,4}/)?.[0]
      || line.text.match(/[Il1|]bs\s+(\d{3,4})\b/i)?.[1]
      || '';
    const rate = Number(rateText);
    const hasRate = rate >= 100 && rate <= 20000;

    const mode = /^R/.test(modeText) ? 'R' : /^F/.test(modeText) ? 'F,SD' : 'V';
    const order = {
      id: idMatch[1],
      eCode: mode,
      status: 'OPEN',
      tag: 'OPEN',
      route: '',
      puDate: `PU: ${pickupDate}`,
      delDate: 'DFL: Upcoming',
      pickupTime: `${pickupDate} ${pickupHours}`,
      deliveryTime: '',
      origCity: origin,
      origSt: originState,
      origZip: '',
      weight: weight ? `${weight} lbs` : '',
      destCity: destination,
      destSt: destinationState,
      destZip: '',
      miles: '',
      planningComment: 'Imported from CH screenshot',
      carrier: '',
      driver: '',
      truck: '',
      trailer: '',
      rateInput: hasRate ? String(rate) : '',
      ...(hasRate ? { rateSource: 'user-entered' } : {}),
      brokerable: 'false',
      notes: notes.join(' ')
    };
    if (!order.rateInput) {
      const savedLaneRate = getSavedLaneRate(laneRates, selectedBroker, order);
      if (savedLaneRate) {
        order.rateInput = savedLaneRate;
        order.rateSource = 'user-entered';
      }
    }
    parsedRows.push(order);
  });

  // A state the OCR could not read is taken from another row of this screenshot with the same city.
  const statesByCity = {};
  const record = (city, state) => {
    if (!state) return;
    const counts = statesByCity[city] = statesByCity[city] || {};
    counts[state] = (counts[state] || 0) + 1;
  };
  parsedRows.forEach(order => {
    record(order.origCity, order.origSt);
    record(order.destCity, order.destSt);
  });
  const likelyState = city => Object.entries(statesByCity[city] || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const loads = parsedRows.map(order => {
    const origSt = order.origSt || likelyState(order.origCity);
    const destSt = order.destSt || likelyState(order.destCity);
    const missingState = !origSt || !destSt;
    return {
      ...order,
      origSt,
      destSt,
      route: `${order.origCity}${origSt ? `, ${origSt}` : ''} → ${order.destCity}${destSt ? `, ${destSt}` : ''}`,
      notes: missingState ? `${order.notes} A state could not be read; enter it before export.` : order.notes
    };
  });
  return { loads, skippedLtl, skippedNoDate };
}

async function readChScreenshot(worker, canvas, lines, brokerName, laneRates, scale) {
  const headers = findChHeaders(lines);
  if (!headers) return { loads: [], skippedLtl: 0, skippedNoDate: 0 };
  const bounds = getChColumnBounds(headers, canvas.width);
  // Reading each narrow column on its own is far more accurate than reading it inside the full table.
  const readStrip = async (left, right, whitelist) => {
    const x0 = Math.max(0, Math.round(left));
    const x1 = Math.min(canvas.width, Math.round(right));
    if (x1 - x0 < 8) return [];
    const factor = Math.max(1, 4 / scale);
    const margin = 40;
    const strip = document.createElement('canvas');
    strip.width = Math.round((x1 - x0) * factor) + margin * 2;
    strip.height = Math.round(canvas.height * factor) + margin * 2;
    const context = strip.getContext('2d', { willReadFrequently: true });
    if (!context) return [];
    context.fillStyle = '#fff';
    context.fillRect(0, 0, strip.width, strip.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(canvas, x0, 0, x1 - x0, canvas.height, margin, margin, (x1 - x0) * factor, canvas.height * factor);
    // Highlighted rows (yellow, green, gray) confuse OCR, so light backgrounds are whitened while dark text stays.
    const pixels = context.getImageData(0, 0, strip.width, strip.height);
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const luminance = pixels.data[offset] * 0.299 + pixels.data[offset + 1] * 0.587 + pixels.data[offset + 2] * 0.114;
      const value = luminance >= 205 ? 255 : luminance;
      pixels.data[offset] = value;
      pixels.data[offset + 1] = value;
      pixels.data[offset + 2] = value;
      pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: whitelist });
    const { data } = await worker.recognize(strip, {}, { blocks: true });
    return (data.blocks || [])
      .flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines))
      .map(line => ({
        y: ((line.bbox.y0 + line.bbox.y1) / 2 - margin) / factor,
        text: line.text.replace(/\s+/g, '')
      }));
  };
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const strips = {
    ost: await readStrip(bounds.ostLeft, bounds.destinationLeft, letters),
    dst: await readStrip(bounds.dstLeft, bounds.pickupLeft, letters),
    bin: await readStrip(bounds.binLeft, canvas.width, '0123456789')
  };
  await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
  return parseChScreenshotLines(lines, canvas.width, canvas.height, brokerName, laneRates, strips);
}

function parseGmailLoadEmail(messageText, selectedBroker, laneRates) {
  const lines = String(messageText || '')
    .replace(/\r/g, '\n')
    .replace(/\t/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const loads = [];
  let pickupDate = '';
  const parseDate = text => {
    const match = String(text || '').match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
    if (!match) return '';
    const [, month, day, yearText] = match;
    const year = yearText.length === 2 ? `20${yearText}` : yearText;
    return `${month}/${day}/${year}`;
  };
  const findState = text => /^[A-Z]{2,3}$/i.test(text);
  const skipMetadata = text => /^(?:OPEN|INIT|WEB|COST|VIEW|UNBOOKED|HAZMAT)$/i.test(text);
  const createLoad = (id, origin, originState, destination, destinationState, weightText, trailingText = '') => {
    const weight = weightText.match(/[\d,]+(?:\.\d+)?/)?.[0] || '';
    if (!pickupDate || !origin || !destination || !weight) return;
    const tailParts = trailingText.match(/[\d,]+(?:\.\d+)?/g) || [];
    const miles = isCh593772Customer(selectedBroker)
      ? ''
      : tailParts.length ? tailParts[0].replace(/,/g, '') : '';
    const eCode = /\bHAZMAT\b/i.test(messageText.slice(0, 500)) ? 'VZ' : 'VAN:VAN';
    const order = {
      id,
      eCode,
      status: 'OPEN',
      tag: 'OPEN',
      route: `${origin.toUpperCase()}, ${originState.toUpperCase()} → ${destination.toUpperCase()}, ${destinationState.toUpperCase()}`,
      puDate: `PU: ${pickupDate}`,
      delDate: 'DFL: Upcoming',
      pickupTime: `${pickupDate} 0800 - 1600`,
      deliveryTime: '',
      origCity: origin.toUpperCase(),
      origSt: originState.toUpperCase(),
      origZip: '',
      weight: `${weight} lbs`,
      destCity: destination.toUpperCase(),
      destSt: destinationState.toUpperCase(),
      destZip: '',
      miles,
      planningComment: 'Imported from Gmail',
      carrier: '',
      driver: '',
      truck: '',
      trailer: '',
      rateInput: '',
      brokerable: 'false',
      notes: 'Delivery date/time not included in email; please enter before export.'
    };
    const savedLaneRate = getSavedLaneRate(laneRates, selectedBroker, order);
    if (savedLaneRate) {
      order.rateInput = savedLaneRate;
      order.rateSource = 'user-entered';
    }
    loads.push(order);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const dateHeading = lines[index].match(/\b(\d{1,2}\/(\d{1,2})\/(?:\d{2}|\d{4}))\s*-\s*[A-Za-z]{3,9}\b/);
    if (dateHeading) pickupDate = parseDate(dateHeading[1]);

    const inlineRow = lines[index].match(
      /^(\d{8,10})\s+(.+?)\s+([A-Z]{2,3})\s+(.+?)\s+([A-Z]{2,3})\s+([\d,]+(?:\.\d+)?)\s*lbs?\b(.*)$/i
    );
    if (inlineRow) {
      createLoad(inlineRow[1], inlineRow[2], inlineRow[3], inlineRow[4], inlineRow[5], inlineRow[6], inlineRow[7]);
      continue;
    }
    if (!/^\d{8,10}$/.test(lines[index])) continue;

    const values = [];
    let nextIndex = index + 1;
    while (nextIndex < lines.length && values.length < 8) {
      if (/^\d{8,10}$/.test(lines[nextIndex])
        || /\b\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4})\s*-\s*[A-Za-z]{3,9}\b/.test(lines[nextIndex])) break;
      if (!skipMetadata(lines[nextIndex])) values.push(lines[nextIndex]);
      nextIndex += 1;
    }

    const originStateIndex = values.findIndex(findState);
    if (originStateIndex < 1) continue;
    const destinationStateIndex = values.findIndex(
      (value, valueIndex) => valueIndex >= originStateIndex + 2 && findState(value)
    );
    if (destinationStateIndex < originStateIndex + 2) continue;
    const weightIndex = values.findIndex((value, valueIndex) =>
      valueIndex > destinationStateIndex && /[\d,]+(?:\.\d+)?\s*lbs?/i.test(value)
    );
    if (weightIndex < 0) continue;
    createLoad(
      lines[index],
      values.slice(0, originStateIndex).join(' '),
      values[originStateIndex],
      values.slice(originStateIndex + 1, destinationStateIndex).join(' '),
      values[destinationStateIndex],
      values[weightIndex],
      values.slice(weightIndex + 1).join(' ')
    );
    index = nextIndex - 1;
  }
  return autoFillLoadZipCodes(loads);
}

// Earliest pickup start Landstar will accept, as an Excel serial on the local clock:
// now plus a lead time (for the upload bot's rate check and upload), rounded up to
// the next quarter hour. Landstar rejects "Pickup Start Date cannot be in the past".
function getEarliestPickupSerial(now = new Date(), leadMinutes = 30) {
  const quarterHour = 15 * 60 * 1000;
  const wallClock = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + leadMinutes);
  return (Math.ceil(wallClock / quarterHour) * quarterHour - Date.UTC(1899, 11, 30)) / 86400000;
}

// Excel serial (local clock) -> "MM/DD/YY HH:MM", the way the Landstar board shows times.
function excelSerialToBoardTime(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial)) return '';
  const date = new Date(Math.round(serial * 86400000) + Date.UTC(1899, 11, 30));
  const pad = value => String(value).padStart(2, '0');
  return `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${pad(date.getUTCFullYear() % 100)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

// What identifies a load's posting on Landstar (Landstar postings carry no customer
// load number): both ZIPs, pickup and delivery END times, and weight, exactly as exported.
// End times are used because the export may move a past pickup START up to now.
function buildLandstarPosting(record) {
  return {
    originZip: String(record['Origin Zipcode(Required)'] || '').trim().toUpperCase(),
    destZip: String(record['Destination Zipcode(Required)'] || '').trim().toUpperCase(),
    pickupThru: excelSerialToBoardTime(record['Pickup Date (Thru)(Required)']),
    deliveryThru: excelSerialToBoardTime(record['Delivery Date (Thru)(Required)']),
    weight: Number(record['Weight(Required)']) || 0
  };
}

// Loads that were posted to Landstar and are missing from a customer's new list. This
// includes Nolan: any posted Nolan load not in the new screenshots is removed too.
function findDroppedPostings(customer, importedLoads, existingLoads, equipmentScope = null) {
  const importedIds = new Set(importedLoads.map(load => normalizeLoadId(getBaseLoadId(load))).filter(Boolean));
  if (!importedIds.size) return [];
  // Loads added by hand are never taken off Landstar for being missing from the list.
  // With an equipment scope (RXO's separate van/flatbed/reefer/hazmat lists), only postings in
  // the uploaded categories are candidates; the other lists' postings stay up.
  return existingLoads.filter(load => load.landstarPosting && !load.manualEntry
    && !String(load.needsCapacity || '').trim() && load.status !== 'BOOKED'
    && (!equipmentScope || equipmentScope.has(getRxoEquipmentListCategory(load)))
    && !importedIds.has(normalizeLoadId(getBaseLoadId(load))));
}

// Tabs of an Excel workbook that hold loads: the first tab always (as before), plus any
// other tab whose header row names a load number and an origin city column, so a
// customer's list split across tabs imports as one list and summary tabs are ignored.
const loadIdHeaders = ['order #', 'load id', 'order number', 'load posting code'];
const originCityHeaders = ['origin city', 'orig city', 'origin', 'origin - city'];
function getLoadSheetNames(workbook, xlsx) {
  const names = workbook?.SheetNames || [];
  return names.filter((name, index) => {
    if (index === 0) return true;
    const header = (xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1 })[0] || [])
      .map(cell => String(cell || '').trim().toLowerCase());
    return header.some(cell => loadIdHeaders.includes(cell)) && header.some(cell => originCityHeaders.includes(cell));
  });
}

// A pickup window that already started but is still open is posted from the earliest
// allowed start (its end stays the same); a window that is over can't be posted.
function adjustPickupWindow(pickupFrom, pickupThru, earliestStart) {
  if (pickupFrom === null || pickupThru === null) return { from: pickupFrom, ended: false, moved: false };
  if (pickupThru < earliestStart) return { from: pickupFrom, ended: true, moved: false };
  if (pickupFrom < earliestStart) return { from: earliestStart, ended: false, moved: true };
  return { from: pickupFrom, ended: false, moved: false };
}

function toExcelDateTime(value, fallbackDateValue = '') {
  const dateTime = String(value || '').replace(/[•·]/g, ' ').replace(/\s+/g, ' ').trim();
  const fullMatch = dateTime.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,4})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (fullMatch) {
    const [, monthText, dayText, yearText, hourText, minuteText, meridiem] = fullMatch;
    const month = Number(monthText);
    const day = Number(dayText);
    const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
    let hour;
    let minute;
    if (minuteText !== undefined) {
      hour = Number(hourText);
      minute = Number(minuteText);
    } else if (hourText.length > 2) {
      hour = Number(hourText.slice(0, -2));
      minute = Number(hourText.slice(-2));
    } else {
      hour = Number(hourText);
      minute = 0;
    }
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      hour = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
    }
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day || hour > 23 || minute > 59) return null;
    return (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
  }

  const timeMatch = dateTime.match(/^(\d{1,4})(?::(\d{2}))?\s*(AM|PM)?$/i);
  const fallbackMatch = String(fallbackDateValue || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (!timeMatch || !fallbackMatch) return null;
  const [, timeText, minuteText, meridiem] = timeMatch;
  let hour;
  let minute;
  if (minuteText !== undefined) {
    hour = Number(timeText);
    minute = Number(minuteText);
  } else if (timeText.length > 2) {
    hour = Number(timeText.slice(0, -2));
    minute = Number(timeText.slice(-2));
  } else {
    hour = Number(timeText);
    minute = 0;
  }
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  const [, monthText, dayText, yearText] = fallbackMatch;
  const month = Number(monthText);
  const day = Number(dayText);
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
}

// Splits a schedule into start/end parts, handling ranges with a full date on both
// sides even when the dash has no spaces (10/29/2026 09:00-10/30/2026 16:00).
function splitScheduleRange(value) {
  const text = String(value || '').replace(/[–—]/g, '-');
  const spaced = Array.from(
    text.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):?(\d{2})/g)
  ).map(match => `${match[1]}/${match[2]}/${match[3].length === 2 ? `20${match[3]}` : match[3]} ${match[4]}${match[5]}`);
  if (spaced.length >= 2) return spaced;
  const parts = text.split(' - ');
  if (parts.length >= 2) return parts;
  const timeRange = text.match(/^(.*?)-(\d{1,2}:?\d{2}\s*(?:AM|PM)?)$/i);
  return timeRange ? [timeRange[1].trim(), timeRange[2].trim()] : parts;
}

function parseSchedulePickerParts(value) {
  const parts = splitScheduleRange(value);
  const parse = text => {
    const match = String(text || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):?(\d{2})/);
    if (!match) return null;
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return {
      date: `${year}-${String(Number(match[1])).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`,
      time: `${String(Number(match[4])).padStart(2, '0')}:${match[5]}`
    };
  };
  return { from: parse(parts[0]), to: parse(parts[1]) };
}

function formatSchedulePickerParts(from, to) {
  const format = (part, fallbackTime) => {
    if (!part?.date) return '';
    const [year, month, day] = part.date.split('-');
    const time = (part.time || fallbackTime).replace(':', '');
    return `${Number(month)}/${Number(day)}/${year} ${time}`;
  };
  const fromText = format(from, '08:00');
  const toText = format(to, '16:00');
  return fromText && toText ? `${fromText} - ${toText}` : fromText || toText;
}

function normalizeMilesValue(value) {
  const compact = String(value ?? '').replace(/[\s,]/g, '');
  if (/^\d{1,4}(\.\d+)?$/.test(compact)) return compact;
  const decimal = compact.match(/(\d{1,4})\.(\d)/);
  if (decimal) return `${decimal[1]}.${decimal[2]}`;
  const digits = compact.replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(0, -6) : digits;
}

function isTeamEquipment(value) {
  return ['VM', 'VT'].includes(String(value || '').trim().toUpperCase());
}

function hasLoadRate(load) {
  return Number(String(load?.rateInput || '').replace(/[$,]/g, '')) > 0;
}

function getRatePerMile(rate, miles) {
  const rateValue = Number(String(rate || '').replace(/[$,]/g, ''));
  // Miles can arrive with a unit suffix from broker exports, e.g. '396.3 miles'.
  const mileValue = Number(String(miles || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0]);
  if (!(rateValue > 0) || !(mileValue > 0)) return '';
  return (rateValue / mileValue).toFixed(2);
}

// Weekly fuel surcharge ($/mile) by pickup region, the same four regions as the weekly
// fuel email ("East .86 Midwest .88 West 1.03 New England .89"). The Gulf states use the
// Midwest rate; anything not listed (Canada, blank) uses Midwest too.
const fuelSurchargeRegions = {
  east: { label: 'East', states: ['NY', 'NJ', 'PA', 'DE', 'MD', 'DC', 'VA', 'WV', 'NC', 'SC', 'GA', 'FL'] },
  midwest: { label: 'Midwest (and Gulf: TX LA AR MS AL NM)', states: ['OH', 'MI', 'IN', 'IL', 'WI', 'MN', 'IA', 'MO', 'KY', 'TN', 'KS', 'NE', 'SD', 'ND', 'OK', 'TX', 'LA', 'AR', 'MS', 'AL', 'NM'] },
  west: { label: 'West', states: ['CO', 'ID', 'MT', 'UT', 'WY', 'AZ', 'NV', 'CA', 'OR', 'WA', 'AK', 'HI'] },
  newEngland: { label: 'New England', states: ['CT', 'ME', 'MA', 'NH', 'RI', 'VT'] }
};

const defaultFuelSurchargeRates = { east: '0.86', midwest: '0.88', west: '1.03', newEngland: '0.89' };

function normalizeFuelSurchargeRates(value) {
  const rates = { ...defaultFuelSurchargeRates };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return rates;
  // Settings saved before the four email regions: National -> East and Midwest, West Coast -> West.
  if (!['east', 'midwest', 'west'].some(key => key in value) && ('national' in value || 'westCoast' in value)) {
    value = { east: value.national, midwest: value.national, west: value.westCoast, newEngland: value.newEngland };
  }
  Object.keys(rates).forEach(key => {
    const parsed = Number(String(value[key] ?? '').replace(/[$,]/g, ''));
    rates[key] = parsed > 0 ? String(Math.round(parsed * 100) / 100) : '';
  });
  return rates;
}

function getFuelSurchargeRegion(state) {
  const code = String(state || '').trim().toUpperCase();
  const match = Object.entries(fuelSurchargeRegions)
    .find(([, info]) => info.states.includes(code));
  return match ? match[0] : 'midwest';
}

// $/mile for a pickup state; a blank regional rate falls back to the Midwest rate.
function getFuelSurchargeRate(rates, state) {
  if (!rates || typeof rates !== 'object') return null;
  const parse = value => Number(String(value || '').replace(/[$,]/g, ''));
  const regional = parse(rates[getFuelSurchargeRegion(state)]);
  const rate = regional > 0 ? regional : parse(rates.midwest);
  return rate > 0 ? rate : null;
}

// The weekly fuel email: "11/3/2026   East .86  Midwest .88   West 1.03 New England .89".
// Returns { date, rates } or null (all four rates must be there and look like $/mile).
function parseFuelSurchargeEmail(text) {
  const value = String(text || '');
  const rate = name => {
    const match = value.match(new RegExp(`${name}\\s*[:=]?\\s*\\$?(\\d*\\.\\d+|\\d+(?:\\.\\d+)?)`, 'i'));
    const number = match ? Number(match[1]) : NaN;
    return number >= 0.3 && number <= 2.5 ? String(Math.round(number * 100) / 100) : '';
  };
  const rates = { east: rate('(?<!north)east'), midwest: rate('midwest'), west: rate('(?<!mid)west'), newEngland: rate('new\\s*england') };
  if (Object.values(rates).some(item => !item)) return null;
  const date = value.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/)?.[1] || '';
  return { date, rates };
}

// Team comes from the Team switch when set; otherwise team equipment (VM/VT) means team.
function isTeamLoad(load) {
  const team = String(load?.team || '').trim().toLowerCase();
  if (team === 'true') return true;
  if (team === 'false') return false;
  return isTeamEquipment(load?.eCode);
}

// Team vans (VM/VT) are shown as a plain V; the Team flag carries the team part.
// Equipment we don't haul: oversized/specialized trailers, and intermodal ("INT" in the
// equipment box). These loads are never imported or exported, for every customer.
function isSkippableEquipment(value) {
  return /OVER\s*DIMENSIONAL|OVER\s*SIZE|OVERSIZE|REMOVABLE\s*GOOSE\s*NECK|GOOSE\s*NECK|\bRGN\b|LOW\s*BOY|DOUBLE\s*DROP|\bINT\b|INTER\s*MODAL/i.test(String(value || ''));
}

function normalizeEquipmentCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!code) return '';
  if (/^D-(LG|ST|RF)/.test(code)) return code.replace(/\s/g, '');
  if (/STRAIGHT\s*TRUCK|SPRINTER|BOX\s*TRUCK|HOT\s*SHOT/.test(code)) {
    if (/REEFER|REFRIGERATED/.test(code)) return 'D-RF';
    return /LIFT\s*GATE/.test(code) && !/NO\s*LIFT\s*GATE|WITHOUT\s*(?:A\s*)?LIFT\s*GATE/.test(code) ? 'D-LG' : 'D-ST';
  }
  if (/CONESTOGA/.test(code)) return 'FLCS';
  // Step Deck before flatbed so "Flatbed or Step Deck" imports as SD.
  if (/STEP\s*DECK|STEPDECK|\bSTEP\b/.test(code)) return 'SD';
  if (/FLAT\s*BED|\bFLAT\b/.test(code)) return 'F';
  if (/\bVAN\b\s+OR\s+(REEFER|REFR)\b/.test(code)) return 'V,R';
  if (/REEFER|\bREFR/.test(code)) return 'R';
  if (/\bVAN\b/.test(code)) return 'V';
  return code;
}

function getDisplayEquipmentCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (code === 'VE') return 'VAN';
  return isTeamEquipment(code) ? 'V' : value;
}

// Liftgate-required freight cannot accept a straight truck without a liftgate.
function getLandstarEquipment2(ord) {
  if (ord?.equipment2 !== undefined) return ord.equipment2;
  if (isTeamLoad(ord)) return '53VN';
  if (isFlatbedEquipment(ord?.eCode)) return 'STEP';
  const code = String(ord?.eCode || '').trim().toUpperCase();
  if (['D-ST', 'D-ST,D-LG', 'D-LG,D-ST'].includes(code.replace(/\s/g, ''))) return 'D-LG';
  if (code === 'V,R') return 'REFR';
  return '';
}

function getLandstarEquipmentCode(value) {
  const code = String(value || '').trim().toUpperCase();
  const equipmentCodes = {
    VZ: 'VAN',
    VAN: 'VAN',
    V: 'VAN',
    VT: 'VAN',
    VM: 'VAN',
    VE: 'VAN',
    VR: 'VAN',
    'V,R': 'VAN',
    R: 'REFR',
    RZ: 'REFR',
    F: 'FLAT',
    'F,SD': 'FLAT',
    FH: 'FH',
    FV: 'FLAT',
    FLCS: 'FLCS',
    SD: 'STEP'
  };
  if (equipmentCodes[code]) return equipmentCodes[code];
  if (['D-ST', 'D-ST,D-LG', 'D-LG,D-ST'].includes(code.replace(/\s/g, ''))) return 'D-ST';
  if (code === 'D-LG' || code === 'D-RF') return code;
  if (code.includes('53 FEET') || code.includes('53FT') || code.includes('53 FT')) return '53VN';
  if (code.startsWith('VAN')) return 'VAN';
  if (code.startsWith('REFR') || code.startsWith('REEFER')) return 'REFR';
  if (code.startsWith('FLAT')) return 'FLAT';
  if (code.startsWith('STEP')) return 'STEP';
  return code.match(/\b(24VN|28VN|48VN|53VN|VAN|REFR|FLAT|48FL|53FL|STEP|53SD|SD)\b/)?.[0] || '';
}

const equipmentOptions = [
  ['V', 'Van'], ['VZ', 'Van - hazmat'], ['VE', 'Van - non-hazardous chemicals'],
  ['R', 'Reefer'], ['RZ', 'Reefer - hazmat'], ['F', 'Flatbed'],
  ['FV', 'Flatbed - hazmat'], ['SD', 'Step deck'], ['FH', 'Flatbed hotshot'],
  ['FLCS', 'Conestoga'], ['D-ST', 'Straight truck'], ['D-LG', 'Straight truck - liftgate required'],
  ['D-RF', 'Straight truck - reefer'],
  ['24VN', '24-foot van'], ['28VN', '28-foot van'], ['48VN', '48-foot van'], ['53VN', '53-foot van'],
  ['48FL', '48-foot flatbed'], ['53FL', '53-foot flatbed'], ['53SD', '53-foot step deck']
];

// Equipment bucket for scoping RXO list imports: the van, flatbed and reefer lists are
// uploaded separately, so an import only replaces existing loads in the buckets it contains.
function getEquipmentListCategory(eCode) {
  const code = getLandstarEquipmentCode(eCode);
  if (code === 'REFR') return 'reefer';
  if (['FLAT', 'FH', 'STEP', 'FLCS'].includes(code)) return 'flatbed';
  if (code === 'VAN' || /^\d{2}VN$/.test(code)) return 'van';
  return 'other';
}

// RXO imports default blank equipment to VAN:VAN, so scope lookups do the same.
// Hazmat is its own list: a hazmat upload never replaces van/reefer/flatbed loads,
// and a van upload never replaces hazmat loads (VZ/RZ would otherwise count as van/reefer).
function getRxoEquipmentListCategory(load) {
  if (isHazmatLoad(load)) return 'hazmat';
  const eCode = String(load?.eCode || '').trim();
  return getEquipmentListCategory(eCode || 'VAN:VAN');
}

function getLandstarCommodity(value) {
  const equipmentCode = String(value || '').trim().toUpperCase().split(':')[0];
  // FH (flatbed hotshot) is not hazmat by itself; hazmat loads carry hazmat: 'true'.
  // FV (flatbed/stepdeck hazmat) is hazmat by itself, like VZ/RZ.
  if (['VZ', 'RZ', 'FV'].includes(equipmentCode)) {
    return 'HAZMAT';
  }
  if (equipmentCode === 'VE') {
    return 'CHEM';
  }
  return 'CGAPP';
}

function playExportSound() {
  try {
    const AudioCtx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [190, 250].forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime;
      osc.frequency.value = freq;
      osc.type = 'sawtooth';
      gain.gain.setValueAtTime(0.0001, start);
      [0, 0.42].forEach((offset) => {
        gain.gain.setValueAtTime(0.0001, start + offset);
        gain.gain.exponentialRampToValueAtTime(0.08, start + offset + 0.025);
        gain.gain.setValueAtTime(0.08, start + offset + 0.23);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.29);
      });
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.75);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {
    // Sound is optional.
  }
}

// Greets the signed-in agent by posting code with a warm, natural voice. Voices load
// asynchronously in some browsers, so wait for them before speaking.
const WELCOME_LINES = [
  code => `Hey, welcome back${code ? `, agent ${code}` : ''}! Good to see you.`,
  code => `Hi${code ? `, agent ${code}` : ''}! Welcome back.`,
  code => `Welcome back${code ? `, agent ${code}` : ''}. Hope you're doing well today.`,
];

function speakWelcomeGreeting(postingCode) {
  try {
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return;
    const code = String(postingCode || '').trim().toUpperCase();
    // Spell the posting code letter by letter so it reads naturally.
    const spokenCode = code.split('').join(' ');
    const line = WELCOME_LINES[Math.floor(Math.random() * WELCOME_LINES.length)];
    const utterance = new SpeechSynthesisUtterance(line(spokenCode));
    utterance.pitch = 1;
    utterance.rate = 1;
    utterance.volume = 0.9;
    const speak = () => {
      const voices = window.speechSynthesis.getVoices();
      // Prefer Chrome's natural-sounding Google voices; they avoid the robotic
      // tone of the older Microsoft desktop voices.
      const preferred = voices.find(voice => /^google us english$/i.test(voice.name))
        || voices.find(voice => /google uk english female/i.test(voice.name))
        || voices.find(voice => /^google/i.test(voice.name) && /^en([-_]|$)/i.test(voice.lang))
        || voices.find(voice => /aria|jenny|samantha/i.test(voice.name))
        || voices.find(voice => /^en([-_]|$)/i.test(voice.lang));
      if (preferred) utterance.voice = preferred;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    };
    if (window.speechSynthesis.getVoices().length) {
      speak();
      return;
    }
    const onVoicesChanged = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      speak();
    };
    window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
    // Some browsers never fire voiceschanged; speak with the default voice after a short wait.
    window.setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      if (!window.speechSynthesis.speaking) speak();
    }, 500);
  } catch {
    // The greeting is optional.
  }
}

function isHazmatLoad(load) {
  if (['CGAPP', 'HAZMAT', 'CHEM'].includes(load?.commodity)) return load.commodity === 'HAZMAT';
  return getLandstarCommodity(load?.eCode) === 'HAZMAT'
    || String(load?.eCode || '').trim().toUpperCase() === 'FV'
    || String(load?.hazmat || '').toLowerCase() === 'true'
    || /\bhazmat\b/i.test(String(load?.planningComment || ''));
}

function isTankerLoad(load) {
  return String(load?.tanker || '').toLowerCase() === 'true' || /tanker/i.test(String(load?.planningComment || ''));
}

// Customer lists mark hazmat and tanker freight in the equipment type ("Van Hazmat",
// "Tanker") or the commodity ("HAZMAT CHEMICALS"). "NON-HAZMAT ..." is not hazmat.
function getImportedHazmatTanker(equipment, commodities = []) {
  const flags = {};
  const text = [equipment, ...commodities].map(value => String(value || '')).join(' | ');
  if (/(?<!NON[-\s]?)\bHAZ\s*MAT\b/i.test(text)) flags.hazmat = 'true';
  if (/\bTANK(ER)?\b/i.test(String(equipment || ''))) flags.tanker = 'true';
  return flags;
}

function isFlatbedEquipment(value) {
  return ['F', 'F,SD', 'FH', 'FV'].includes(String(value || '').replace(/\s/g, '').toUpperCase());
}

function getLoadCommodity(load) {
  if (['CGAPP', 'HAZMAT', 'CHEM'].includes(load?.commodity)) return load.commodity;
  return isHazmatLoad(load) ? 'HAZMAT' : getLandstarCommodity(load?.eCode);
}

function getLandstarCommodityValue(code) {
  const commodityValues = {
    CGAPP: 'CGAPP-CONSUMER GOODS OR APPLIANCES',
    HAZMAT: 'HAZMAT-HAZMAT NON-HIGH RISK OR AA&E BRP',
    CHEM: 'CHEM-CHEMICALS (NON-HAZ/REGULATED)'
  };
  return commodityValues[code] || '';
}

function getLandstarCity(value, location) {
  const city = String(value || '').trim();
  const postalCity = String(location?.city || '').trim();
  const normalize = name => name.toUpperCase()
    .replace(/\bST\b\.?/g, 'SAINT').replace(/\bMT\b\.?/g, 'MOUNT').replace(/\bFT\b\.?/g, 'FORT')
    .replace(/[^A-Z0-9]/g, '');
  return postalCity && normalize(city) === normalize(postalCity) ? postalCity : city;
}

// Landstar caps city fields at 18 characters; shorten known long names, then hard-truncate.
// ZIP city names Landstar rejects as "Invalid Origin/Destination", mapped to the
// spelling its city list uses (the Post Office's short name, as shown on the board).
const landstarCityAbbreviations = {
  'WASHINGTON COURT HOUSE': 'Washington CH',
  'HOT SPRINGS NATIONAL PARK': 'Hot Sprs', // ZIP 71901/71913
  'FEASTERVILLE TREVOSE': 'Fstrvl Trvose', // ZIP 19053
  'MC CORDSVILLE': 'McCordsville' // ZIP 46055
};
// Landstar shortens military-base names (e.g. its city list has "MARCH ARB, CA" for
// ZIP 92518 "March Air Reserve Base"); cutting them at 18 characters instead gives a
// name Landstar rejects as "Invalid Origin".
const landstarCityPhrases = [
  [/\bAir Reserve Base\b/i, 'ARB'],
  [/\bAir Force Base\b/i, 'AFB'],
  [/\bNaval Air Station\b/i, 'NAS'],
  [/\bMarine Corps Air Station\b/i, 'MCAS']
];
function toLandstarCity(value) {
  const city = String(value || '').trim();
  let abbreviated = landstarCityAbbreviations[city.toUpperCase()] || city;
  if (abbreviated.length > 18) {
    landstarCityPhrases.forEach(([phrase, short]) => { abbreviated = abbreviated.replace(phrase, short); });
  }
  return abbreviated.length > 18 ? abbreviated.slice(0, 18).trim() : abbreviated;
}

const rxoCustomerName = 'R X O 2429200 - ATZ';
const rxoPayerCustomerName = 'R X O 2429200 - ATZ P';
const ntgCustomerName = 'Nolan 965974 - ATZ H';

function normalizeCustomerName(name) {
  const normalized = String(name || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized === 'RXO2429200ATZP') {
    return rxoPayerCustomerName;
  }
  if (['NOLAN965974ATZH', 'NTG965974ATZH'].includes(normalized)) {
    return ntgCustomerName;
  }
  if (normalized === 'RXO' || normalized === 'RXL' || normalized === 'RXO2429200ATZ') {
    return rxoCustomerName;
  }
  return String(name || '').trim();
}

// Customer rules match one exact account. Accounts can share a name and number and differ
// only by the letter at the end ("Para 1522166 - ATZ" vs "Para 1522166 - ATZ H"): those
// are separate accounts, so a rule for one must never check just the name or number.
function isNolanCustomer(name) {
  return normalizeCustomerName(name) === ntgCustomerName;
}

function getImportedLoadSelection(customer, importedLoads) {
  return isNolanCustomer(customer)
    ? Array.from(new Set(importedLoads.map(load => load.id)))
    : [];
}

function isRxoCustomer(name) {
  const normalized = normalizeCustomerName(name);
  return normalized === rxoCustomerName || normalized === rxoPayerCustomerName;
}

// R X O 2429200 - ATZ only (not ATZ P): van freight picking up in these states is
// skipped on import and never exported. Reefer and other equipment, and hazmat or tanker
// loads, are unaffected.
const rxoSkippedVanOriginStates = new Set(['WI', 'IN', 'OH', 'MI', 'MN', 'SD', 'ND', 'UT', 'ID']);
const vanEquipmentCodes = new Set(['VAN', '24VN', '28VN', '48VN', '53VN']);

function isRxoSkippedVanLoad(customer, load) {
  if (normalizeCustomerName(customer) !== rxoCustomerName) return false;
  // Hazmat and tanker freight is always kept, whatever the pickup state.
  if (isHazmatLoad(load) || isTankerLoad(load)) return false;
  const originState = String(load?.origSt || '').trim().toUpperCase();
  if (!rxoSkippedVanOriginStates.has(originState)) return false;
  // getLandstarEquipmentCode maps V, VZ, VT and Van-or-Reefer (VR) to VAN.
  return vanEquipmentCodes.has(getLandstarEquipmentCode(load?.eCode));
}

// R X O 2429200 - ATZ only (not ATZ P): van loads priced from DAT post under the DAT rate.
// Under $1,000: $50 less; $1,000 to under $1,600: $100 less; $1,600 to $3,500: $200 less;
// over $3,500: $300 less. Hazmat and tanker loads keep the full rate (hazmat must stay highest).
// When another agent has the load on the board, the bot posts their rate + $25 instead.
function getRxoAtzDatVanDiscount(customer, load, rate) {
  if (normalizeCustomerName(customer) !== rxoCustomerName) return 0;
  if (!['dat-api', 'dat-screenshot'].includes(load?.rateSource)) return 0;
  if (!vanEquipmentCodes.has(getLandstarEquipmentCode(load?.eCode))) return 0;
  if (isHazmatLoad(load) || isTankerLoad(load)) return 0;
  if (!(rate > 0)) return 0;
  if (rate < 1000) return 50;
  if (rate < 1600) return 100;
  if (rate <= 3500) return 200;
  return 300;
}

// R X O 2429200 - ATZ only: a load that picks up and delivers in the same city is never exported.
function isRxoSameCityLoad(customer, load) {
  if (normalizeCustomerName(customer) !== rxoCustomerName) return false;
  const place = (city, state) => `${String(city || '').toUpperCase().replace(/[^A-Z]/g, '')}|${String(state || '').trim().toUpperCase()}`;
  const origin = place(load?.origCity, load?.origSt);
  return origin !== '|' && !origin.startsWith('|') && origin === place(load?.destCity, load?.destSt);
}

// Loads picking up in or delivering to Mexico are never imported or exported, for every
// customer. Customer lists mark Mexico with a MX/MEX country code or a Mexican state code
// (EM, JA, GJ, BJ, NX, CH, CU, ...): any two-letter region that is not a US state or a
// Canadian province counts.
function isMexicoPlace(state, country) {
  const countryCode = String(country || '').trim().toUpperCase();
  if (countryCode === 'MX' || countryCode === 'MEX' || countryCode === 'MEXICO') return true;
  const region = String(state || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(region) && !stateCodes.has(region);
}

function isMexicoLoad(load) {
  return isMexicoPlace(load?.origSt, load?.origCountry) || isMexicoPlace(load?.destSt, load?.destCountry);
}

function isParaCustomer(name) {
  return normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, '') === 'PARA1522166ATZ';
}

// Customers whose screenshots mark loads on hold with a red order number: a red order #
// imports as ON HOLD, any other as OPEN. Para 1522166 - ATZ and Para 1522166 - ATZ H.
const redHoldScreenshotCustomers = new Set(['PARA1522166ATZ', 'PARA1522166ATZH']);

function holdsRedScreenshotLoads(name) {
  return redHoldScreenshotCustomers.has(normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, ''));
}

function isCh593772Customer(name) {
  return normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, '') === 'CH593772ATZ';
}

// Accounts whose imports are the customer's full list: a re-import replaces the list, so
// loads that dropped off it are deleted (and their Landstar postings taken down).
const importStatusPreservationCustomers = new Set([
  'PARA1522166ATZ',
  'PARA1522166ATZH',
  'RXO2429200ATZ',
  'RXO2429200ATZP',
  'NOLAN965974ATZ',
  'NOLAN965974ATZH'
]);

function preservesImportedLoadStatus(name) {
  const normalized = normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return importStatusPreservationCustomers.has(normalized);
}

// When Google Routes can't answer, driving miles are estimated from the two ZIP codes:
// straight-line miles between them times 1.2 (roads are about 20% longer than a straight line).
const zipRoadMilesFactor = 1.2;

function estimateRoadMilesFromZips(zipData, originZip, destZip) {
  const zip5 = value => String(value || '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(zip5(originZip)) || !/^\d{5}$/.test(zip5(destZip))) return '';
  if (!zipData?.lookup?.(zip5(originZip)) || !zipData?.lookup?.(zip5(destZip))) return '';
  const straightMiles = Number(zipData.distance(zip5(originZip), zip5(destZip)));
  return straightMiles > 0 ? String(Math.round(straightMiles * zipRoadMilesFactor)) : '';
}

// Google Routes charges per lookup, so the driving miles for each lane are saved the first
// time Google answers and reused after that (roads don't move). A lane is its origin and
// destination ZIPs, or city + state when a ZIP is missing. Saved in this browser only.
const roadMilesCacheKey = 'landstar_roadMilesCache';

function getRoadMilesLaneKey(order) {
  const zip5 = value => String(value || '').trim().slice(0, 5);
  if (/^\d{5}$/.test(zip5(order?.origZip)) && /^\d{5}$/.test(zip5(order?.destZip))) {
    return `${zip5(order.origZip)}>${zip5(order.destZip)}`;
  }
  const place = (city, state) => {
    const cityKey = String(city || '').toUpperCase().replace(/[^A-Z]/g, '');
    const stateKey = String(state || '').trim().toUpperCase();
    return cityKey && stateKey ? `${cityKey},${stateKey}` : '';
  };
  const origin = place(order?.origCity, order?.origSt);
  const destination = place(order?.destCity, order?.destSt);
  return origin && destination ? `${origin}>${destination}` : '';
}

function readRoadMilesCache() {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(roadMilesCacheKey) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function saveRoadMiles(laneKey, miles) {
  if (!laneKey) return;
  try {
    const cache = readRoadMilesCache();
    cache[laneKey] = miles;
    globalThis.localStorage?.setItem(roadMilesCacheKey, JSON.stringify(cache));
  } catch (error) {
    console.error('Could not save the lane miles:', error);
  }
}

async function getGoogleRoadMiles(order) {
  const laneKey = getRoadMilesLaneKey(order);
  const savedMiles = laneKey ? readRoadMilesCache()[laneKey] : undefined;
  if (Number(savedMiles) > 0) return String(savedMiles);
  const response = await fetch('/api/road-miles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origin: { city: order.origCity, state: order.origSt, zip: order.origZip },
      destination: { city: order.destCity, state: order.destSt, zip: order.destZip }
    })
  });
  let result;
  try {
    result = await response.json();
  } catch (error) {
    console.error('Could not read Google Routes road-mile response:', error);
    throw new Error(`Google Routes returned an invalid response for load ${order.id}.`);
  }
  if (!response.ok || !Number.isFinite(result?.miles) || result.miles <= 0) {
    throw new Error(`Could not calculate driving miles for load ${order.id}: ${result?.error || 'Google Routes returned no valid mileage.'}`);
  }
  saveRoadMiles(laneKey, String(result.miles));
  return String(result.miles);
}

// Import policy: every imported load uses Google Routes driving miles instead of
// the miles printed on the import, for every customer. Lookups run a few at a time
// so big imports do not wait on one request after another.
const importLookupConcurrency = 5;

async function applyGoogleRoadMiles(loads, onProgress, sourceLabel) {
  const eligible = loads.filter(load => load.origCity && load.origSt && load.destCity && load.destSt);
  let mileageError = '';
  let done = 0;
  let failed = false;
  for (let start = 0; start < eligible.length; start += importLookupConcurrency) {
    const batch = eligible.slice(start, start + importLookupConcurrency);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(batch.map(async load => {
      if (failed) return;
      try {
        load.miles = await getGoogleRoadMiles(load);
        const note = 'driving miles calculated by Google Routes';
        load.planningComment = load.planningComment ? `${load.planningComment}; ${note}` : `${sourceLabel}; ${note}`;
      } catch (error) {
        console.error('Google Routes could not calculate imported load miles:', error);
        if (!mileageError) mileageError = error.message || 'Google Routes could not calculate the driving miles.';
        failed = true;
      } finally {
        done += 1;
        if (onProgress) onProgress(`Calculating driving miles ${Math.min(done, eligible.length)} of ${eligible.length}...`);
      }
    }));
    if (failed) {
      for (let remaining = start; remaining < eligible.length; remaining += 1) {
        const remainingLoad = eligible[remaining];
        if (remainingLoad.planningComment?.includes('driving miles calculated by Google Routes')) continue;
        const note = Number(remainingLoad.miles) > 0
          ? 'Google Routes unavailable; miles kept from the import'
          : 'driving miles need to be entered manually';
        remainingLoad.planningComment = remainingLoad.planningComment
          ? `${remainingLoad.planningComment}; ${note}`
          : `${sourceLabel}; ${note}`;
      }
      break;
    }
  }
  return { mileageError };
}

// ==========================================
// DAT RATECAST API AUTO-FETCH HELPER
// ==========================================
async function fetchDatRateForImport(order, selectedBroker, laneRates) {
  // 1. Check local saved rates first
  const savedLaneRate = getSavedLaneRate(laneRates, selectedBroker, order);
  if (savedLaneRate) {
    return { rateInput: savedLaneRate, rateSource: 'user-entered' };
  }

  // 2. Fetch live rate automatically via backend DAT Ratecast API
  try {
    const response = await fetch('/api/dat-rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { city: order.origCity, state: order.origSt, zip: order.origZip },
        destination: { city: order.destCity, state: order.destSt, zip: order.destZip },
        equipment: order.eCode
      })
    });
    
    const data = await response.json();
    if (data && data.rate) {
      return { rateInput: String(data.rate), rateSource: 'dat-api' };
    }
    return { rateInput: '', rateSource: undefined, error: data?.error || `DAT rate request failed (${response.status}).` };
  } catch (error) {
    console.error(`Could not auto-fetch DAT rate for order ${order.id}:`, error);
    return { rateInput: '', rateSource: undefined, error: error.message || 'Could not reach the DAT rate service.' };
  }
}

// Fetches DAT rates for every load missing one, a few at a time so big imports do
// not wait on one request after another. Fills rateInput/rateSource in place and
// remembers each rate in the lane list. Returns the first error, if any.
async function applyDatRatesForImport(loads, selectedBroker, laneRates, setLaneRates, shouldFetch = () => true) {
  let rateError = '';
  const targets = loads.filter(load => !(Number(load.rateInput) > 0) && shouldFetch(load));
  for (let start = 0; start < targets.length; start += importLookupConcurrency) {
    const batch = targets.slice(start, start + importLookupConcurrency);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(batch.map(async load => {
      const datRateInfo = await fetchDatRateForImport(load, selectedBroker, laneRates);
      if (datRateInfo.rateInput) {
        load.rateInput = datRateInfo.rateInput;
        load.rateSource = datRateInfo.rateSource;
        setLaneRates(prev => rememberLaneRate(prev, selectedBroker, load, load.rateInput, load.rateSource));
      } else if (!rateError && datRateInfo.error) {
        rateError = datRateInfo.error;
      }
    }));
  }
  return rateError;
}

function normalizeLoadId(value) {
  const text = String(value || '').trim().replace(/-ALT[A-Z]+$/i, '');
  const digits = text.replace(/\D/g, '');
  return digits || text.toUpperCase();
}

function getExportedRecordsForCustomer(registry, customer) {
  const customerKey = normalizeCustomerName(customer).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const matchingEntries = Object.entries(registry || {}).filter(([key]) =>
    normalizeCustomerName(key).toUpperCase().replace(/[^A-Z0-9]/g, '') === customerKey
  );
  return matchingEntries.reduce((records, [, value]) => ({
    ids: [...records.ids, ...(Array.isArray(value?.ids) ? value.ids : []).map(normalizeLoadId)],
    laneDays: [...records.laneDays, ...(Array.isArray(value?.laneDays) ? value.laneDays : [])]
  }), { ids: [], laneDays: [] });
}

function createLaneDayKey(order) {
  const normalize = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const origin = normalize(order.origCity);
  const destination = normalize(order.destCity);
  const originState = normalize(order.origSt);
  const destinationState = normalize(order.destSt);
  const dateText = String(order.pickupTime || order.puDate || '');
  const usDate = dateText.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  const isoDate = dateText.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (!origin || !destination || !usDate && !isoDate) return '';

  const pickupDate = usDate
    ? `${usDate[3].length === 2 ? `20${usDate[3]}` : usDate[3]}-${usDate[1].padStart(2, '0')}-${usDate[2].padStart(2, '0')}`
    : `${isoDate[1]}-${isoDate[2].padStart(2, '0')}-${isoDate[3].padStart(2, '0')}`;
  return JSON.stringify([origin, originState, destination, destinationState, pickupDate]);
}

// Earliest pickup first; loads without a readable pickup date go last.
function getPickupDay(order) {
  const value = getPickupSortValue(order);
  return value === Number.MAX_SAFE_INTEGER ? '' : new Date(value).toISOString().slice(0, 10);
}

function getPickupSortValue(order) {
  const text = String(order.pickupTime || order.puDate || '');
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b(?:\s+(\d{2})(\d{2}))?/);
  if (us) {
    const year = us[3].length === 2 ? Number(`20${us[3]}`) : Number(us[3]);
    return Date.UTC(year, Number(us[1]) - 1, Number(us[2]), Number(us[4] || 0), Number(us[5] || 0));
  }
  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  return iso ? Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : Number.MAX_SAFE_INTEGER;
}

function removeDuplicateLoadImports(loads) {
  const seenLoadSchedules = new Set();
  let duplicateCount = 0;
  const uniqueLoads = loads.filter(load => {
    const loadId = normalizeLoadId(load.sourceLoadId || load.id);
    const scheduleKey = createLaneScheduleKey(load);
    if (!loadId || !scheduleKey) return true;
    const key = JSON.stringify([loadId, scheduleKey]);
    if (seenLoadSchedules.has(key)) {
      duplicateCount += 1;
      return false;
    }
    seenLoadSchedules.add(key);
    return true;
  });
  return { loads: uniqueLoads, duplicateCount };
}

function countPreviouslyExportedLoads(loads, records, { idOnly = false } = {}) {
  const ids = new Set(records.ids || []);
  const laneDays = new Set(records.laneDays || []);
  let exportedCount = 0;
  const exportedLoadIds = new Set();
  loads.forEach(load => {
    const key = createLaneDayKey(load);
    const worked = (ids.has(normalizeLoadId(load.id)) && (!key || laneDays.has(key)))
      || (!idOnly && Boolean(key) && laneDays.has(key));
    if (worked) {
      exportedCount += 1;
      exportedLoadIds.add(normalizeLoadId(load.id));
    }
  });
  return { exportedCount, exportedLoadIds };
}

function keepPreviouslyExportedLoadsOpen(loads, exportedLoadIds, customer) {
  return loads.map(load => exportedLoadIds.has(normalizeLoadId(load.id))
    ? { ...load, status: 'OPEN', tag: 'OPEN' }
    : load);
}

function getReimportedLoadStatus(existingLoad, wasPreviouslyExported) {
  if (existingLoad?.status === 'OFFER') return { status: 'OFFER', tag: 'OFFER' };
  return { status: 'OPEN', tag: 'OPEN' };
}

function getImportedLoadKey(load) {
  const baseId = getBaseLoadId(load);
  const key = normalizeLoadId(baseId);
  if (!key || /^(?:IMG|IMP|NTG|DAT)-\d+-\d+$/i.test(baseId)) {
    throw new Error('An imported load has no readable load number. Use a list with load numbers. Existing loads were not deleted.');
  }
  return key;
}

function deduplicateDatImports(importedLoads, existingLoads) {
  const existingByLaneDay = new Map(existingLoads.map(load => [createLaneDayKey(load), load]).filter(([key]) => key));
  const seenLaneDays = new Set();
  const unreadableRows = [];
  let skippedDuplicateCount = 0;
  const loads = importedLoads.flatMap((load, index) => {
    const key = createLaneDayKey(load);
    if (!key) {
      unreadableRows.push(`Row ${index + 1}: ${load.route || `${load.origCity || '?'} → ${load.destCity || '?'}`} (pickup: ${load.pickupTime || load.puDate || 'unreadable'})`);
      return [];
    }
    if (seenLaneDays.has(key)) {
      skippedDuplicateCount += 1;
      return [];
    }
    seenLaneDays.add(key);
    const existing = existingByLaneDay.get(key);
    if (existing) {
      return [{ ...load, id: existing.id, sourceLoadId: existing.sourceLoadId || existing.id }];
    }
    return [load];
  });
  if (unreadableRows.length === importedLoads.length && unreadableRows.length) {
    throw new Error(`No DAT rows had a readable lane and pickup date. Existing loads were not changed.\n${unreadableRows.join('\n')}`);
  }
  return { loads, skippedDuplicateCount, unreadableRows };
}

function replaceImportedCustomerLoads(customer, importedLoads, existingLoads, {
  additive = !preservesImportedLoadStatus(customer), allowGeneratedIds = additive, now = Date.now(), keepManualEnt = false,
  // false for partial lists (DAT rate screenshots, screenshots with unreadable rows)
  reportDroppedPostings = true
} = {}) {
  if (!importedLoads.length) {
    throw new Error('The imported load list is empty. Existing loads were not deleted.');
  }
  // RXO ATZ van loads picking up in skipped states are not imported (see isRxoSkippedVanLoad).
  const skippedRxoVanCount = importedLoads.filter(load => isRxoSkippedVanLoad(customer, load)).length;
  importedLoads = importedLoads.filter(load => !isRxoSkippedVanLoad(customer, load));
  // Loads to or from Mexico are never imported.
  const skippedMexicoCount = importedLoads.filter(isMexicoLoad).length;
  importedLoads = importedLoads.filter(load => !isMexicoLoad(load));
  // Intermodal ("INT") and oversized equipment is never imported, from any source.
  const skippedEquipmentCount = importedLoads.filter(load => isSkippableEquipment(load.eCode)).length;
  importedLoads = importedLoads.filter(load => !isSkippableEquipment(load.eCode));
  if (!importedLoads.length) {
    throw new Error('Every load in this list goes to or from Mexico or uses equipment we skip (INT/oversized), so nothing was imported. Existing loads were not deleted.');
  }
  // RXO's van, flatbed, reefer and hazmat lists are uploaded separately: a full-list import only
  // replaces existing loads in the equipment categories the file contains. Loads of other
  // equipment stay, and their Landstar postings are never dropped.
  const equipmentScope = !additive && isRxoCustomer(customer)
    ? new Set(importedLoads.map(load => getRxoEquipmentListCategory(load)))
    : null;
  const loadKey = load => normalizeLoadId(getBaseLoadId(load));
  const importedById = new Map();
  let duplicateCount = 0;
  importedLoads.forEach(load => {
    const id = allowGeneratedIds ? getBaseLoadId(load) : getImportedLoadKey(load);
    if (!id) throw new Error('An imported load has no readable load number. Existing loads were not deleted.');
    const key = JSON.stringify([id, createLaneDayKey(load)]);
    if (importedById.has(key)) {
      duplicateCount += 1;
      return;
    }
    importedById.set(key, { ...load, id, sourceLoadId: id });
  });
  const importedLaneDays = new Set();
  const matchedIds = new Set();
  const mergedLoads = [];
  let laneDayDuplicateCount = 0;
  for (const load of importedById.values()) {
    const laneDay = createLaneDayKey(load);
    if (laneDay && importedLaneDays.has(laneDay)) {
      laneDayDuplicateCount += 1;
      console.warn(`[import] skipped same-lane/pickup-day duplicate #${getBaseLoadId(load)}: ${load.origCity}, ${load.origSt} → ${load.destCity}, ${load.destSt} pickup ${load.pickupTime || load.puDate || ''}`);
      continue;
    }
    if (laneDay) importedLaneDays.add(laneDay);
    const existing = existingLoads.find(order => loadKey(order) === loadKey(load) && !isNewDayForExistingLoad(order, load))
      || (allowGeneratedIds && existingLoads.find(order => laneDay && createLaneDayKey(order) === laneDay))
      || existingLoads.find(order => loadKey(order) === loadKey(load));
    const populatedFields = Object.fromEntries(Object.entries(load).filter(([, value]) =>
      value !== undefined && value !== null && String(value).trim() !== ''
    ));
    const merged = { ...existing, ...populatedFields, status: 'OPEN', tag: 'OPEN' };
    if (existing) {
      ['rateInput', 'rateSource', 'carrier', 'driver', 'driverPhone', 'truck', 'trailer', 'pickupEta', 'emptyLocation', 'notes', 'landstarComment', 'needsCapacity', 'commodity'].forEach(field => {
        if (String(existing[field] || '').trim()) merged[field] = existing[field];
      });
      // The load still carries a DAT rate but you have typed a rate for this lane since: use yours.
      if (load.rateSource === 'user-entered' && Number(load.rateInput) > 0 && isDatRateSource(existing.rateSource)) {
        merged.rateInput = load.rateInput;
        merged.rateSource = 'user-entered';
      }
      if (allowGeneratedIds && load.rateSource === 'dat-screenshot' && existing.rateSource !== 'user-entered'
        && Number(load.rateInput) > 0) {
        merged.rateInput = load.rateInput;
        merged.rateSource = load.rateSource;
      }
      if (!isNewDayForExistingLoad(existing, load)) {
        merged.id = existing.id;
        merged.sourceLoadId = existing.sourceLoadId || getBaseLoadId(existing);
        matchedIds.add(String(existing.id));
      }
    }
    const fixedLaneRate = getFixedLaneRate(customer, merged);
    if (fixedLaneRate && (!existing || existing.rateSource !== 'user-entered')) {
      merged.rateInput = fixedLaneRate;
      merged.rateSource = 'user-entered';
    }
    delete merged.landstarExportedAt;
    if (holdsRedScreenshotLoads(customer) && load.screenshotStatus === 'ON HOLD') {
      merged.status = 'ON HOLD';
      merged.tag = 'HOLD';
    }
    delete merged.screenshotStatus;
    // Pickup date already passed: the load goes (or stays) on ENT, new or re-imported.
    if (hasPastPickupDate(merged)) {
      merged.status = 'ENT';
      merged.tag = 'ENT';
    }
    if (existing?.status === 'OFFER' && !isNewDayForExistingLoad(existing, load)) {
      merged.status = 'OFFER';
      merged.tag = 'OFFER';
    }
    // A booked load stays booked when the customer's list is imported again.
    if (existing?.status === 'BOOKED' && !isNewDayForExistingLoad(existing, load)) {
      merged.status = 'BOOKED';
      merged.tag = 'BOOKED';
      merged.bookedAt = existing.bookedAt;
    }
    const reservedLoads = existingLoads.filter(order => additive || (order.status === 'ENT'
      && Number.isFinite(Date.parse(order.landstarExportedAt))
      && now - Date.parse(order.landstarExportedAt) < exportedLoadRetentionMs));
    mergedLoads.push(assignImportedLoadIdentity(merged, reservedLoads, mergedLoads));
  }
  const retained = existingLoads.filter(load => {
    if (matchedIds.has(String(load.id))) return false;
    // Booked loads are covered; keep them even when the customer drops them from the list.
    if (load.status === 'BOOKED') return true;
    // Loads added by hand stay until you delete them.
    if (load.manualEntry || String(load.needsCapacity || '').trim()) return true;
    // Loads from before the RXO van state rule was added are cleared out on the next import.
    if (isRxoSkippedVanLoad(customer, load)) return false;
    // Same for loads to or from Mexico imported before that rule.
    if (isMexicoLoad(load)) return false;
    if (isSkippableEquipment(load.eCode)) return false;
    // RXO separate lists: equipment categories not in this file are left alone.
    if (equipmentScope && !equipmentScope.has(getRxoEquipmentListCategory(load))) return true;
    const exportedAt = Date.parse(load.landstarExportedAt);
    // A full customer list is the truth: anything not on it is deleted (exported ENT loads
    // too; their rates stay in the rate history). Booked and hand-added loads stay (above),
    // and screenshot imports keep loads you moved to ENT by hand (never exported).
    if (!additive) return load.status === 'ENT' && !Number.isFinite(exportedAt) && keepManualEnt;
    // Screenshot imports also keep loads moved to ENT by hand (no export date).
    const retainedArchive = load.status === 'ENT' && (Number.isFinite(exportedAt)
      ? now - exportedAt < exportedLoadRetentionMs
      : keepManualEnt);
    if (retainedArchive) return true;
    if (importedLaneDays.has(createLaneDayKey(load))) return false;
    return retainedArchive || (additive && !(load.status === 'ENT' && Number.isFinite(exportedAt)
      && now - exportedAt >= exportedLoadRetentionMs));
  });
  // Posted loads missing from this (full) list: the upload bot removes their Landstar
  // postings. Each is handed over once, so its saved posting details are cleared here.
  const dropped = reportDroppedPostings ? findDroppedPostings(customer, importedLoads, existingLoads, equipmentScope) : [];
  const droppedIds = new Set(dropped.map(load => String(load.id)));
  const droppedPostings = dropped.map(load => ({ customer, loadId: String(load.id), posting: load.landstarPosting }));
  const loads = [...mergedLoads, ...retained].map(load => {
    if (!droppedIds.has(String(load.id))) return load;
    const { landstarPosting, ...rest } = load;
    return rest;
  });
  return {
    loads, additive, processedLoads: mergedLoads, droppedPostings, skippedRxoVanCount, skippedMexicoCount, skippedEquipmentCount,
    laneDayDuplicateCount, equipmentScope,
    usesScreenshotStatus: holdsRedScreenshotLoads(customer)
      && importedLoads.some(load => ['ON HOLD', 'OPEN'].includes(load.screenshotStatus)),
    duplicateCount,
    removedCount: existingLoads.filter(load => !matchedIds.has(String(load.id)) && !retained.includes(load)).length
  };
}

function getImportReplacementMessage(replacement) {
  const scopeLabel = replacement?.equipmentScope ? [...replacement.equipmentScope].join('/') : '';
  return replacement
    ? `• ${replacement.additive ? 'Imported list merged' : scopeLabel ? `${scopeLabel} list replaced` : 'Full list replaced'}; removed loads: ${replacement.removedCount}. ${replacement.additive ? 'Exported ENT loads retained for 30 days unless re-imported.' : scopeLabel ? `Loads missing from the file were deleted from the ${scopeLabel} list(s) only; other equipment, booked and hand-added loads kept.` : 'Loads not on the list were deleted (booked and hand-added loads kept).'}\n` +
      `• Duplicate load/day rows skipped: ${replacement.duplicateCount}; ${replacement.usesScreenshotStatus ? 'Para screenshot: red = ON HOLD, non-red = OPEN' : 'imported loads set to OPEN'}.\n`
      + (replacement.laneDayDuplicateCount ? `• Same-lane/pickup-day duplicates skipped: ${replacement.laneDayDuplicateCount} (first load kept).\n` : '')
      + (replacement.skippedRxoVanCount ? `• Skipped ${replacement.skippedRxoVanCount} RXO van load(s) picking up in WI, IN, OH, MI, MN, SD, ND, UT or ID.\n` : '')
      + (replacement.skippedMexicoCount ? `• Skipped ${replacement.skippedMexicoCount} load(s) to or from Mexico.\n` : '')
      + (replacement.skippedEquipmentCount ? `• Skipped ${replacement.skippedEquipmentCount} intermodal (INT) or oversized load(s).\n` : '')
      + (replacement.droppedPostings?.length ? `• No longer on the list: ${replacement.droppedPostings.length} posted load(s); the upload bot will remove them from Landstar.\n` : '')
    : '';
}

function isNewDayForExistingLoad(existingLoad, importedLoad) {
  const existingKey = createLaneDayKey(existingLoad);
  const importedKey = createLaneDayKey(importedLoad);
  return Boolean(existingKey && importedKey && existingKey !== importedKey);
}

function normalizeScheduleValue(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return '';

  const usDate = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  const isoDate = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  const date = usDate
    ? `${usDate[3].length === 2 ? `20${usDate[3]}` : usDate[3]}-${usDate[1].padStart(2, '0')}-${usDate[2].padStart(2, '0')}`
    : isoDate
      ? `${isoDate[1]}-${isoDate[2].padStart(2, '0')}-${isoDate[3].padStart(2, '0')}`
      : '';
  const timeText = text
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' ')
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, ' ');
  const times = Array.from(timeText.matchAll(/\b(\d{1,2}):?(\d{2})\s*(AM|PM)?\b/g))
    .map(([, hourText, minuteText, meridiem]) => {
      let hour = Number(hourText);
      const minute = Number(minuteText);
      if (meridiem) hour = hour % 12 + (meridiem === 'PM' ? 12 : 0);
      return hour <= 23 && minute <= 59
        ? `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`
        : '';
    })
    .filter(Boolean);

  return JSON.stringify([date, times.length ? times : timeText.replace(/\s+/g, ' ').trim()]);
}

function createLaneScheduleKey(order) {
  const laneDayKey = createLaneDayKey(order);
  if (!laneDayKey) return '';
  return JSON.stringify([
    laneDayKey,
    normalizeScheduleValue(order.pickupTime || order.puDate),
    normalizeScheduleValue(order.deliveryTime || order.delDate)
  ]);
}

function markDifferentScheduleLoadsEnt(loads, existingLoads = [], customer) {
  return loads.map(load => ({ ...load, status: 'OPEN', tag: 'OPEN' }));
}

function toAlphabeticalSuffix(index) {
  let value = Number(index);
  let suffix = '';
  while (value >= 0) {
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26) - 1;
  }
  return suffix;
}

function getBaseLoadId(order) {
  return String(order?.sourceLoadId || order?.id || '').trim().replace(/-ALT[A-Z]+$/i, '');
}

// Returns true when the load's pickup date is before today (past-dated imports become ENT).
// A pickup window over several days counts by its last day, so it stays open until then.
function hasPastPickupDate(load) {
  const text = String(load?.pickupTime || load?.puDate || '');
  const match = [...text.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g)].pop();
  if (!match) return false;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const pickup = new Date(year, Number(match[1]) - 1, Number(match[2]));
  if (Number.isNaN(pickup.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return pickup < today;
}

// Past-dated pickups import as ENT, new loads and re-imported ones alike
// (booked loads stay booked: replaceImportedCustomerLoads checks that last).
function applyPastPickupEntStatus(importedLoad, existingLoads) {
  if (!hasPastPickupDate(importedLoad)) return importedLoad;
  return { ...importedLoad, status: 'ENT', tag: 'ENT' };
}

function assignImportedLoadIdentity(importedLoad, existingLoads, stagedLoads) {
  const fallbackId = String(importedLoad?.id || '').trim();
  const baseId = getBaseLoadId(importedLoad) || fallbackId;
  if (!baseId) return importedLoad;

  const normalizedLoad = {
    ...importedLoad,
    sourceLoadId: baseId
  };
  const relatedLoads = [...existingLoads, ...stagedLoads].filter(load => getBaseLoadId(load) === baseId);
  const sameLaneDayLoad = relatedLoads.find(load => !isNewDayForExistingLoad(load, normalizedLoad));
  if (sameLaneDayLoad) {
    return { ...normalizedLoad, id: String(sameLaneDayLoad.id) };
  }

  const usedIds = new Set([...existingLoads, ...stagedLoads].map(load => String(load.id)));
  if (!usedIds.has(baseId)) return { ...normalizedLoad, id: baseId };

  let variantIndex = 0;
  let variantId = `${baseId}-ALT${toAlphabeticalSuffix(variantIndex)}`;
  while (usedIds.has(variantId)) {
    variantIndex += 1;
    variantId = `${baseId}-ALT${toAlphabeticalSuffix(variantIndex)}`;
  }
  return { ...normalizedLoad, id: variantId };
}

// Fixed lane-rate overrides: these lanes always pay the listed amount.
const fixedLaneRates = [
  { origSt: 'ID', destSt: 'FL', rate: '11000' }
];

function getFixedLaneRate(customer, order) {
  const text = value => String(value || '').trim().toUpperCase();
  const match = fixedLaneRates.find(lane =>
    (!lane.customer || normalizeCustomerName(lane.customer) === normalizeCustomerName(customer))
    && (!lane.origSt || text(order.origSt) === lane.origSt)
    && (!lane.destSt || text(order.destSt) === lane.destSt)
    && (!lane.origCity || text(order.origCity) === lane.origCity)
    && (!lane.destCity || text(order.destCity) === lane.destCity));
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

// ==========================================
// MULTI-TAB / MULTI-DEVICE WRITE GUARD
// ==========================================
// Every saved write carries a per-key version number. A tab may only write a key when
// its state is based on the latest saved version; otherwise an older tab's save would
// wipe newer data (e.g. freshly imported loads) saved from another tab or device.
const dataVersionKey = 'landstar_dataVersion';
const syncedDataKeys = [
  'landstar_brokers',
  'landstar_customerOrdersMap',
  'landstar_laneRates',
  'landstar_rateHistory',
  'landstar_exportedLoads',
  'landstar_profile'
];
let syncGuardReady = false;
const lastSavedValues = {};
const lastSavedVersions = {};
let reloadSavedDataFn = null;
let loadListHealTimer = null;

function readDataVersions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(dataVersionKey));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function initSyncGuardFromStorage() {
  if (syncGuardReady) return;
  syncGuardReady = true;
  const versions = readDataVersions();
  syncedDataKeys.forEach(key => {
    try {
      lastSavedValues[key] = localStorage.getItem(key);
    } catch (error) {
      lastSavedValues[key] = null;
    }
    lastSavedVersions[key] = versions[key] || 0;
  });
}

function getLastSavedValue(key) {
  return key in lastSavedValues ? lastSavedValues[key] : undefined;
}

// Writes one synced key and bumps its version. Returns false without writing when
// storage already holds a newer version from another tab/device; the caller should
// adopt that newer data instead of overwriting it.
function writeSyncedKey(key, value) {
  initSyncGuardFromStorage();
  const versions = readDataVersions();
  if ((versions[key] || 0) > (lastSavedVersions[key] || 0)) return false;
  localStorage.setItem(key, value);
  const nextVersions = { ...versions, [key]: (versions[key] || 0) + 1 };
  localStorage.setItem(dataVersionKey, JSON.stringify(nextVersions));
  lastSavedValues[key] = value;
  lastSavedVersions[key] = nextVersions[key];
  return true;
}

// Records values this tab loaded from storage so later change detection only reacts
// to writes made elsewhere. Keys whose content is unchanged simply track the latest
// version so unrelated version bumps do not mark them as externally changed.
function markStorageAdopted(values) {
  const versions = readDataVersions();
  syncedDataKeys.forEach(key => {
    if (key in values) {
      lastSavedValues[key] = values[key];
      lastSavedVersions[key] = versions[key] || 0;
    } else {
      try {
        if (localStorage.getItem(key) === lastSavedValues[key]) lastSavedVersions[key] = versions[key] || 0;
      } catch (error) {
        // Keep the previous stamp when storage cannot be read.
      }
    }
  });
}

// Synced keys whose stored string differs from what this tab last saved or adopted.
function getChangedSyncedKeys(values) {
  initSyncGuardFromStorage();
  return Object.entries(values)
    .filter(([key, value]) => lastSavedValues[key] !== value)
    .map(([key]) => key);
}

// True when a key changed without its version advancing, i.e. it was written by an
// outdated app version or a stale tab that does not version its writes.
function isUnversionedExternalChange(key) {
  initSyncGuardFromStorage();
  if (!(key in lastSavedValues)) return false;
  let current;
  try {
    current = localStorage.getItem(key);
  } catch (error) {
    return false;
  }
  if (current === lastSavedValues[key]) return false;
  const versions = readDataVersions();
  return (versions[key] || 0) <= (lastSavedVersions[key] || 0);
}

// Restores the last known-good value over an unversioned external write. The write
// goes through the normal path so it also syncs back to the cloud and other tabs.
function restoreLastSavedKey(key) {
  const value = getLastSavedValue(key);
  if (value === undefined || value === null) return false;
  if (!isUnversionedExternalChange(key)) return false;
  return writeSyncedKey(key, value);
}

// Splits changed synced keys into ones to adopt and a load-list change to treat as a
// regression. Only same-browser writes (the storage event) can be regressions: data
// that arrived from the cloud was saved by one of the user's own signed-in browsers,
// and its version row can be held back or arrive separately, so reverting it would
// push this browser's older list back over a fresh import on the other device.
function classifyChangedSyncedKeys(changedKeys, versions, fromCloud) {
  const adopt = [];
  let heal = false;
  changedKeys.forEach(key => {
    const versioned = (versions[key] || 0) > (lastSavedVersions[key] || 0);
    if (key === 'landstar_customerOrdersMap' && !versioned && !fromCloud) heal = true;
    else adopt.push(key);
  });
  return { adopt, heal };
}

// Gives a version bump a short window to arrive before treating a load-list change as
// a regression from an outdated app version; realtime echoes of the data and its
// version can arrive in either order.
function scheduleUnversionedLoadListHeal() {
  if (loadListHealTimer !== null || typeof setTimeout === 'undefined') return;
  loadListHealTimer = setTimeout(() => {
    loadListHealTimer = null;
    if (restoreLastSavedKey('landstar_customerOrdersMap')) {
      console.warn('Ignored a load-list change from an outdated app version or stale tab; kept the newer load list.');
    }
  }, 2500);
}

const isDatRateSource = source => /^dat/i.test(String(source || ''));

// Persist a rate for a lane so the next load in the same lane reuses it.
// Only rates you type are saved for reuse: DAT rates go to the rate history but never
// into laneRates, so a saved lane rate always means your own rate and beats DAT.
// Returns the updated laneRates map (or the original if the rate/key is invalid).
function rememberLaneRate(laneRates, customer, order, rate, source = 'manual') {
  const numericRate = Number(String(rate || '').replace(/[$,]/g, ''));
  const key = createLaneRateKey(customer, order);
  if (!key || !(numericRate > 0) || !Number.isFinite(numericRate)) return laneRates;
  recordRateHistory(customer, order, numericRate, source);
  if (isDatRateSource(source)) return laneRates;
  if (laneRates[key] === String(numericRate)) return laneRates;
  const next = { ...laneRates, [key]: String(numericRate) };
  try {
    writeSyncedKey('landstar_laneRates', JSON.stringify(next));
  } catch (error) {
    console.error('Could not save lane rate:', error);
  }
  return next;
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

// ==========================================
// HISTORICAL RATE LOOKUP
// ==========================================
// Every saved lane rate is also kept in a per-user history so the app can suggest
// past rates for an identical lane as soon as origin and destination are known.
// One row per distinct rate per lane; reusing a rate refreshes its timestamp.
const rateHistoryKey = 'landstar_rateHistory';
const rateHistoryLimit = 1000;

function readRateHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(rateHistoryKey));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Could not load rate history:', error);
    return [];
  }
}

// Lane match ignoring customer and equipment, e.g. CITYOFINDUSTRY, CA -> CALEXICO, CA.
function createLaneLookupKey(order) {
  const normalize = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const origin = normalize(order.origCity);
  const destination = normalize(order.destCity);
  if (!origin || !destination) return '';
  return JSON.stringify([origin, normalize(order.origSt), destination, normalize(order.destSt)]);
}

// Adds (or refreshes) one rate per item in a history list; pure, no saving.
function addRateHistoryEntries(history, customer, items, source, now = new Date().toISOString()) {
  let next = history.slice();
  items.forEach(({ order, rate }) => {
    const numericRate = Number(String(rate || '').replace(/[$,]/g, ''));
    const key = createLaneRateKey(customer, order);
    const lane = createLaneLookupKey(order);
    if (!key || !lane || !(numericRate > 0) || !Number.isFinite(numericRate)) return;
    const existingIndex = next.findIndex(entry => entry && entry.key === key && entry.rate === String(numericRate));
    if (existingIndex >= 0) {
      next[existingIndex] = { ...next[existingIndex], source, savedAt: now };
    } else {
      next.push({
        key,
        lane,
        customer: normalizeCustomerName(customer),
        origCity: String(order.origCity || '').trim().toUpperCase(),
        origSt: String(order.origSt || '').trim().toUpperCase(),
        destCity: String(order.destCity || '').trim().toUpperCase(),
        destSt: String(order.destSt || '').trim().toUpperCase(),
        eCode: String(order.eCode || '').trim().toUpperCase(),
        rate: String(numericRate),
        source,
        savedAt: now
      });
    }
  });
  if (next.length > rateHistoryLimit) {
    next = next.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt))).slice(0, rateHistoryLimit);
  }
  return next;
}

function saveRateHistory(next) {
  try {
    writeSyncedKey(rateHistoryKey, JSON.stringify(next));
  } catch (error) {
    console.error('Could not save rate history:', error);
  }
  return next;
}

function recordRateHistory(customer, order, rate, source = 'manual') {
  const history = readRateHistory();
  const next = addRateHistoryEntries(history, customer, [{ order, rate }], source);
  return next.length === history.length && next.every((entry, i) => entry === history[i]) ? history : saveRateHistory(next);
}

// Every load exported to Landstar becomes a past rate for its lane, so the rate
// outlives the ENT load (ENT loads are removed 30 days after export).
function recordExportedRates(customer, exportedLoads) {
  const items = exportedLoads.map(order => ({ order, rate: order.rateInput }));
  return saveRateHistory(addRateHistoryEntries(readRateHistory(), customer, items, 'exported'));
}

// One-time seed: lanes that already have a saved rate predate the history log.
// They appear as undated "saved" suggestions until a fresh rate is recorded.
function seedRateHistoryFromLaneRates(laneRates) {
  const seeded = [];
  Object.entries(laneRates || {}).forEach(([key, rate]) => {
    let parts;
    try {
      parts = JSON.parse(key);
    } catch (error) {
      return;
    }
    const numericRate = Number(String(rate || '').replace(/[$,]/g, ''));
    if (!Array.isArray(parts) || parts.length !== 8 || !(numericRate > 0)) return;
    const entry = {
      key,
      customer: parts[0],
      origCity: parts[1],
      origSt: parts[2],
      destCity: parts[4],
      destSt: parts[5],
      eCode: parts[7],
      rate: String(numericRate),
      source: 'saved',
      savedAt: ''
    };
    entry.lane = createLaneLookupKey(entry);
    if (entry.lane) seeded.push(entry);
  });
  return seeded;
}

// Past rates for the order's lane: exact customer/equipment matches first, then
// the same city pair under other customers or equipment. Newest first.
function getLaneRateHistory(history, customer, order) {
  const key = createLaneRateKey(customer, order);
  const lane = createLaneLookupKey(order);
  if (!lane) return [];
  const newestFirst = (a, b) => String(b.savedAt).localeCompare(String(a.savedAt));
  const exact = [];
  const similar = [];
  history.forEach(entry => {
    if (!entry) return;
    const entryLane = entry.lane || createLaneLookupKey(entry);
    if (entryLane !== lane) return;
    (key && entry.key === key ? exact : similar).push(entry);
  });
  return [...exact.sort(newestFirst), ...similar.sort(newestFirst)];
}

// Moves a customer to where another one sits (drag-and-drop in the customer list).
function moveCustomer(list, name, targetName) {
  const from = list.indexOf(name);
  const to = list.indexOf(targetName);
  if (from < 0 || to < 0 || from === to) return list;
  const next = list.filter(item => item !== name);
  next.splice(to, 0, name);
  return next;
}

const customerDragType = 'text/x-tms-customer';

function normalizeBrokerList(value) {
  const brokerList = Array.isArray(value) ? value : ['Para 1522166 - ATZ', rxoCustomerName];
  const normalizedBrokers = Array.from(new Set(brokerList.map(normalizeCustomerName).filter(Boolean)));
  if (normalizedBrokers.some(isRxoCustomer)) {
    [rxoCustomerName, rxoPayerCustomerName].forEach(name => {
      if (!normalizedBrokers.includes(name)) normalizedBrokers.push(name);
    });
  }
  if (!normalizedBrokers.includes(ntgCustomerName)) normalizedBrokers.push(ntgCustomerName);
  return normalizedBrokers;
}

function normalizeCustomerOrders(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : defaultCustomerDatasets;
  const normalized = {};
  Object.entries(source).forEach(([name, loads]) => {
    const normalizedName = normalizeCustomerName(name);
    if (!Array.isArray(loads)) return;
    const merged = new Map((normalized[normalizedName] || []).map(load => [load.id, load]));
    loads.forEach(load => {
      if (!load || load.id == null) return;
      // Visibility group and the default posting code come from each user's My Settings
      // at export time, so shared loads never carry one teammate's codes to another.
      const { visibilityGroup, ...rest } = load;
      const normalizedLoad = { brokerable: 'false', ...rest };
      const postingCode = String(normalizedLoad.postingCode || '').trim().toUpperCase();
      if (!postingCode || postingCode === 'ANQ') delete normalizedLoad.postingCode;
      merged.set(load.id, normalizedLoad);
    });
    normalized[normalizedName] = Array.from(merged.values());
  });
  return normalized;
}

const horizontalFlag = (...colors) => `linear-gradient(to bottom, ${colors.map((color, index) => `${color} ${(index * 100) / colors.length}% ${((index + 1) * 100) / colors.length}%`).join(', ')})`;
const verticalFlag = (...colors) => horizontalFlag(...colors).replace('to bottom', 'to right');

// Simplified flags (no emblems) drawn with CSS, since Windows does not show emoji flags.
const countryFlags = {
  CO: { name: 'Colombia', background: 'linear-gradient(to bottom, #fcd116 0% 50%, #003893 50% 75%, #ce1126 75% 100%)' },
  US: { name: 'United States', background: 'linear-gradient(#3c3b6e, #3c3b6e) 0 0 / 40% 54% no-repeat, repeating-linear-gradient(to bottom, #b22234 0 7.69%, #fff 7.69% 15.38%)' },
  MX: { name: 'Mexico', background: verticalFlag('#006847', '#fff', '#ce1126') },
  VE: { name: 'Venezuela', background: horizontalFlag('#ffcc00', '#00247d', '#cf142b') },
  EC: { name: 'Ecuador', background: 'linear-gradient(to bottom, #ffdd00 0% 50%, #034ea2 50% 75%, #ed1c24 75% 100%)' },
  PE: { name: 'Peru', background: verticalFlag('#d91023', '#fff', '#d91023') },
  AR: { name: 'Argentina', background: horizontalFlag('#74acdf', '#fff', '#74acdf') },
  GT: { name: 'Guatemala', background: verticalFlag('#4997d0', '#fff', '#4997d0') },
  HN: { name: 'Honduras', background: horizontalFlag('#0073cf', '#fff', '#0073cf') },
  SV: { name: 'El Salvador', background: horizontalFlag('#0047ab', '#fff', '#0047ab') },
  NI: { name: 'Nicaragua', background: horizontalFlag('#0067c6', '#fff', '#0067c6') },
  CU: { name: 'Cuba', background: 'linear-gradient(to bottom right, #cf142b 0 25%, transparent 25%) 0 0 / 80% 100% no-repeat, repeating-linear-gradient(to bottom, #002a8f 0 20%, #fff 20% 40%)' },
  HT: { name: 'Haiti', background: horizontalFlag('#00209f', '#d21034') },
  PR: { name: 'Puerto Rico', background: 'linear-gradient(to bottom right, #0050f0 0 25%, transparent 25%) 0 0 / 80% 100% no-repeat, repeating-linear-gradient(to bottom, #ed0000 0 20%, #fff 20% 40%)' },
  UA: { name: 'Ukraine', background: horizontalFlag('#0057b7', '#ffd700') },
  PL: { name: 'Poland', background: horizontalFlag('#fff', '#dc143c') },
  RU: { name: 'Russia', background: horizontalFlag('#fff', '#0039a6', '#d52b1e') },
  IN: { name: 'India', background: horizontalFlag('#ff9933', '#fff', '#138808') },
  NG: { name: 'Nigeria', background: verticalFlag('#008751', '#fff', '#008751') },
  IT: { name: 'Italy', background: verticalFlag('#009246', '#fff', '#ce2b37') },
  FR: { name: 'France', background: verticalFlag('#0055a4', '#fff', '#ef4135') },
  DE: { name: 'Germany', background: horizontalFlag('#000', '#dd0000', '#ffce00') }
};

const emptyProfile = { phone: '', postingCode: '', visibilityGroup: '', flag: 'CO', fuelSurcharge: { ...defaultFuelSurchargeRates } };

function getUserProfile() {
  if (typeof localStorage === 'undefined') return { ...emptyProfile };
  try {
    const saved = JSON.parse(localStorage.getItem('landstar_profile'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...emptyProfile };
    return {
      phone: String(saved.phone || ''),
      postingCode: String(saved.postingCode || ''),
      visibilityGroup: String(saved.visibilityGroup || ''),
      flag: saved.flag === 'NONE' || countryFlags[saved.flag] ? saved.flag : 'CO',
      fuelSurcharge: normalizeFuelSurchargeRates(saved.fuelSurcharge)
    };
  } catch (error) {
    console.error('Could not load My Settings:', error);
    return { ...emptyProfile };
  }
}

function formatPhone(digits) {
  const value = String(digits || '').replace(/\D/g, '');
  return value.length === 10 ? `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6)}` : value;
}

const defaultCustomerDatasets = {
  'Para 1522166 - ATZ': [
    { id: '2274611', visibilityGroup: 'ANQ', eCode: 'VZ', status: 'ENT', tag: 'ENT', route: 'NORFOLK, VA → CHARLOTTE, NC', puDate: 'PU: 10/15 0500', delDate: 'DFL: 10/16 0900', pickupTime: '10/15/2026 0500 - 1500', origCity: 'NORFOLK', origSt: 'VA', origZip: '23502', weight: '42,852 lbs', deliveryTime: '10/16/2026 0000 - 1500', destCity: 'CHARLOTTE', destSt: 'NC', destZip: '29217', miles: '327', planningComment: 'Standard Dry Van Load', carrier: '', driver: '', truck: '', trailer: '', rateInput: '', brokerable: 'false', notes: '' }
  ],
  [rxoCustomerName]: [
    { id: '24424438', visibilityGroup: 'RXO', eCode: 'VAN:VAN', status: 'OPEN', tag: 'OPEN', route: 'BOLINGBROOK, IL → SCOTTSVILLE, KY', puDate: 'PU: Today', delDate: 'DFL: Upcoming', pickupTime: '10/18/2026 0800 - 1200', origCity: 'BOLINGBROOK', origSt: 'IL', origZip: '60440', weight: '20000 lbs', deliveryTime: '10/20/2026 0800 - 1700', destCity: 'SCOTTSVILLE', destSt: 'KY', destZip: '42164', miles: '431', planningComment: 'Imported from Excel', carrier: '', driver: '', truck: '', trailer: '', rateInput: '', brokerable: 'false', notes: '' }
  ]
};

// Search box match: load #, freight bill, cities, states, ZIPs, driver, truck, notes.
// City names forgive small misspellings ("Shepardsville" finds SHEPHERDSVILLE).
function loadMatchesSearch(order, searchQuery) {
  const query = String(searchQuery || '').trim().toLowerCase();
  if (!query) return true;
  // A bare 2-letter query is a state search: match the state code exactly, not the
  // substring "ca" inside "CAnton". Check this before the loose field substring match.
  if (/^[a-z]{2}$/.test(query)) {
    const states = [order.origSt, order.destSt].map(value => String(value || '').toLowerCase());
    return states.includes(query);
  }

  const fields = [
    order.id, order.route, order.origCity, order.origSt, order.origZip,
    order.destCity, order.destSt, order.destZip, order.planningComment,
    order.driver, order.truck, order.trailer,
    order.paramountTracking?.freightBill, order.landstarAssignment?.landstarLoadId
  ].map(value => String(value || '').toLowerCase());
  if (fields.some(value => value.includes(query))) return true;

  // "City ST" / "City, ST" typed together: match the city and state as a pair, since no
  // single field holds the whole string.
  const stateMatch = query.match(/^(.*?)[\s,]+([a-z]{2})$/);
  if (stateMatch) {
    const cityPart = stateMatch[1].trim();
    const statePart = stateMatch[2];
    const pairs = [
      [order.origCity, order.origSt],
      [order.destCity, order.destSt]
    ].map(([city, st]) => [String(city || '').toLowerCase(), String(st || '').toLowerCase()]);
    if (pairs.some(([city, st]) => st === statePart && (!cityPart || city.includes(cityPart)))) return true;
  }

  const letters = query.replace(/[^a-z]/g, '');
  if (letters.length < 6 || letters.length !== query.replace(/\s/g, '').length) return false;
  const allowed = letters.length >= 9 ? 2 : 1;
  return [order.origCity, order.destCity]
    .map(value => String(value || '').toLowerCase().replace(/[^a-z]/g, ''))
    .some(city => city.length >= 5 && Math.abs(city.length - letters.length) <= allowed && editDistance(letters, city) <= allowed);
}

function getLoadSearchEntries(customerOrdersMap, selectedBroker, searchQuery, allCustomers = false) {
  const query = searchQuery.trim().toLowerCase();
  const customers = query || allCustomers ? Object.entries(customerOrdersMap) : [[selectedBroker, customerOrdersMap[selectedBroker] || []]];
  return customers.flatMap(([customer, loads]) => loads
    .filter(order => loadMatchesSearch(order, query))
    .map(order => ({ customer, order })));
}

function getPastedImage(event) {
  if (event.target?.isContentEditable || event.target?.closest?.('input, textarea, select')) return null;
  const item = Array.from(event.clipboardData?.items || [])
    .find(item => item.type.startsWith('image/'));
  return item?.getAsFile() || null;
}

async function readClipboardImage(clipboard) {
  if (typeof clipboard?.read !== 'function') {
    throw new Error('Clipboard access is unavailable. Click the app background and press Ctrl+V, or use Import NTG Loads to choose a saved screenshot.');
  }
  const items = await clipboard.read();
  for (const item of items) {
    const type = item.types.find(type => type === 'image/png') || item.types.find(type => type.startsWith('image/'));
    if (type) return item.getType(type);
  }
  throw new Error('No screenshot is on the clipboard. Take a snip with Win+Shift+S, then return here and paste it.');
}

// ---------- Booked Loads page & driver tracking ----------

const trackingStages = ['Booked', 'Dispatched', 'At Pickup', 'Loaded', 'In Transit', 'At Delivery', 'Delivered'];
const checkCallDueMs = 4 * 60 * 60 * 1000;

// First date/time in a schedule like "11/06/2026 1100 - 1300" as a local timestamp.
function parseScheduleStart(value) {
  const match = String(splitScheduleRange(value)[0] || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):?(\d{2})/);
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return new Date(year, Number(match[1]) - 1, Number(match[2]), Number(match[4]), Number(match[5])).getTime();
}

function hasPickupDayStarted(load, now = Date.now()) {
  const pickupAt = parseScheduleStart(load.pickupTime);
  if (!Number.isFinite(pickupAt)) return false;
  const day = new Date(pickupAt);
  day.setHours(0, 0, 0, 0);
  return now >= day.getTime();
}

// Every booked load across all customers, earliest pickup first.
function getBookedLoads(customerOrdersMap) {
  return Object.entries(customerOrdersMap || {})
    .flatMap(([customer, loads]) => (loads || []).filter(load => load.status === 'BOOKED').map(load => ({ customer, load })))
    .sort((a, b) => {
      return (parseScheduleStart(a.load.pickupTime) ?? Infinity) - (parseScheduleStart(b.load.pickupTime) ?? Infinity);
    });
}

function getLastCheckCall(load) {
  const calls = Array.isArray(load.checkCalls) ? load.checkCalls : [];
  return calls.length ? calls[calls.length - 1] : null;
}

// What needs attention on a booked load: late (red) beats check call due (amber).
function getTrackingAlert(load, now = Date.now()) {
  if (!hasPickupDayStarted(load, now)) return null;
  const stage = load.trackingStage || 'Booked';
  if (stage === 'Delivered') return null;
  const pickupAt = parseScheduleStart(load.pickupTime);
  if (pickupAt && now > pickupAt && ['Booked', 'Dispatched'].includes(stage)) {
    return { level: 'late', text: 'Pickup time passed, not at pickup yet' };
  }
  const deliveryAt = parseScheduleStart(load.deliveryTime);
  if (deliveryAt && now > deliveryAt && stage !== 'At Delivery') {
    return { level: 'late', text: 'Delivery time passed, not delivered' };
  }
  const pickupDay = new Date(pickupAt);
  pickupDay.setHours(0, 0, 0, 0);
  const lastAt = Math.max(Date.parse(getLastCheckCall(load)?.at) || Date.parse(load.bookedAt) || 0, pickupDay.getTime());
  if (Number.isFinite(lastAt) && now - lastAt > checkCallDueMs) {
    return { level: 'due', text: `Check call due (${Math.floor((now - lastAt) / 3600000)}h since last update)` };
  }
  return null;
}

// Records a check call (and the stage it reports) on the load; keeps the last 20.
function logCheckCall(load, { stage, note = '' }, at = new Date().toISOString()) {
  const nextStage = trackingStages.includes(stage) ? stage : (load.trackingStage || 'Booked');
  const calls = Array.isArray(load.checkCalls) ? load.checkCalls : [];
  return {
    ...load,
    trackingStage: nextStage,
    checkCalls: [...calls, { at, stage: nextStage, note: String(note).trim() }].slice(-20)
  };
}

function formatCheckTime(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' });
}

// ---------- Driver texts through Google Voice (free; Daniel presses send) ----------
// A US phone number as +1XXXXXXXXXX, or '' if it isn't one.
function toUsPhoneE164(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

// Opens (or starts) the text conversation with that number in Google Voice on the web.
function getGoogleVoiceUrl(phone) {
  const number = toUsPhoneE164(phone);
  return number ? `https://voice.google.com/u/0/messages?itemId=t.${encodeURIComponent(number)}` : 'https://voice.google.com/u/0/messages';
}

// A short text for the driver, matching where the load is. Kept SMS-short.
function buildDriverText(load, customer = '', now = Date.now()) {
  const first = titleCase(String(load.driver || '').trim().split(/\s+/)[0] || '');
  const hi = `Hi${first ? ` ${first}` : ''}, this is Daniel with Landstar.`;
  const bill = load.paramountTracking?.freightBill ? `load ${load.paramountTracking.freightBill}` : `load #${load.id}`;
  const pickup = [titleCase(load.origCity), load.origSt].filter(Boolean).join(', ');
  const delivery = [titleCase(load.destCity), load.destSt].filter(Boolean).join(', ');
  const app = getTrackingAppName(customer);
  const tracking = ` Please keep ${app || 'your tracking app'} on for the whole trip.`;
  const stage = load.trackingStage || 'Booked';
  if (stage === 'Delivered') {
    if (load.paperworkReceivedAt) return `${hi} Thank you for delivering ${bill} in ${delivery}!`;
    return `${hi} Please send the signed POD for ${bill} (${delivery}) today, just reply to the BCO email with a photo. `
      + `Paperwork is due within ${PAPERWORK_DUE_HOURS} hours of delivery or the customer can charge back.`;
  }
  if (stage === 'At Delivery') return `${hi} Are you unloaded on ${bill} in ${delivery}? Please send the signed POD as soon as you're done.`;
  if (stage === 'Loaded' || stage === 'In Transit') {
    return `${hi} How is ${bill} going? What's your ETA to ${delivery}${load.deliveryTime ? ` (appt ${load.deliveryTime})` : ''}?${tracking}`;
  }
  if (stage === 'At Pickup') return `${hi} Are you loaded yet on ${bill} in ${pickup}? Please send me the BOL photo when you leave.${tracking}`;
  const pickupAt = parseScheduleStart(load.pickupTime);
  const today = pickupAt && sameLocalDay(pickupAt, now) ? ' today' : '';
  return `${hi} Checking on ${bill}, picking up${today} in ${pickup}${load.pickupTime ? ` (appt ${load.pickupTime})` : ''}. `
    + `What's your ETA to the shipper?${app ? ` Please turn on ${app} now.` : ''}`;
}

// Text button: copy the message, open the Google Voice conversation; Daniel pastes and sends.
async function openDriverText(event, load, customer) {
  const button = event?.currentTarget;
  const text = buildDriverText(load, customer);
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch { /* shown below */ }
  window.open(getGoogleVoiceUrl(load.driverPhone), 'google-voice');
  if (!copied) { window.prompt('Copy this text, then paste it in Google Voice:', text); return; }
  if (button) {
    const label = button.textContent;
    button.textContent = '✅ Copied: paste in Google Voice (Ctrl+V, Enter)';
    setTimeout(() => { button.textContent = label; }, 6000);
  }
}

// Delivered, the paperwork is in, and it went to the customer (or didn't need to): the load
// leaves the main Booked Loads list. Older loads marked by hand count as done.
const isBookedLoadComplete = load => load.trackingStage === 'Delivered' && Boolean(load.paperworkReceivedAt)
  && load.paperworkDone !== false;

// The paperwork line on a delivered load's card.
function getPaperworkStatus(load, now = Date.now()) {
  if (load.paperworkReceivedAt) {
    return { level: 'ok', text: `Paperwork received ${formatCheckTime(load.paperworkReceivedAt)}${load.paperworkSentAt ? ' · sent to the customer' : load.paperworkDone ? '' : ' · waiting for you to send it to the customer'}` };
  }
  const deliveredAt = getDeliveredAt(load);
  if (!deliveredAt) return { level: 'waiting', text: 'Waiting on paperwork from the driver' };
  const hours = Math.floor((now - deliveredAt) / 3600000);
  const left = PAPERWORK_DUE_HOURS - hours;
  return left > 0
    ? { level: hours >= 24 ? 'due' : 'waiting', text: `Waiting on paperwork · delivered ${hours}h ago · due in ${left}h` }
    : { level: 'late', text: `Paperwork LATE · delivered ${hours}h ago (due within ${PAPERWORK_DUE_HOURS}h, customer can charge back)` };
}

function BookedLoadsPage({ entries: allEntries, now, onBack, onOpen, onUpdate, onRemoveCapacity, emails = null, searchQuery = '', onSearch = null }) {
  const query = String(searchQuery || '').trim();
  const isMatch = load => Boolean(query) && loadMatchesSearch(load, query);
  const completed = allEntries.filter(({ load }) => isBookedLoadComplete(load));
  const completedMatches = completed.filter(({ load }) => isMatch(load));
  // Search matches go to the top, so the load you are looking for is the first card.
  const entries = allEntries.filter(({ load }) => !isBookedLoadComplete(load))
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => Number(isMatch(b.entry.load)) - Number(isMatch(a.entry.load)) || a.index - b.index)
    .map(({ entry }) => entry);
  const matchCount = entries.filter(({ load }) => isMatch(load)).length + completedMatches.length;
  const activeCount = entries.filter(({ load }) => load.trackingStage !== 'Delivered').length;
  const alertCount = entries.filter(({ load }) => getTrackingAlert(load, now)).length;
  const phoneDigits = value => String(value || '').replace(/[^\d+]/g, '');
  // Phone: this page sits under the load list, so jump down to it once when it opens.
  const jumpToPageOnPhone = node => {
    if (!node || node.dataset.jumped || !isPhoneScreen()) return;
    node.dataset.jumped = 'true';
    node.scrollIntoView?.({ block: 'start' });
  };
  return (
    <div ref={jumpToPageOnPhone} className="flex flex-col gap-4" aria-label="Booked Loads">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#161f36] px-3 sm:px-4 py-3 rounded-lg border border-purple-500/60">
        <div>
          <h2 className="text-lg font-bold text-purple-200">📦 Booked Loads</h2>
          <p className="text-xs text-gray-300">
            {activeCount} active · {entries.length - activeCount} delivered · {alertCount} need attention · {completed.length} completed · all customers · earliest pickup first
          </p>
        </div>
        {onSearch && (
          <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
            <input
              type="text"
              value={searchQuery}
              onChange={event => onSearch(event.target.value)}
              placeholder="🔍 Find a booked load: load #, city, driver, truck..."
              aria-label="Find a booked load"
              className="w-full bg-[#0b132b] border-2 border-yellow-400/70 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-400 outline-none focus:border-yellow-300"
            />
            {query && (
              <button type="button" onClick={() => onSearch('')} title="Clear the search" className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2 py-1.5 rounded cursor-pointer">✕</button>
            )}
          </div>
        )}
        <button type="button" onClick={onBack} className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-3 py-1.5 rounded font-semibold cursor-pointer">
          ← Back to loads
        </button>
      </div>
      {emails && emails.replies.some(reply => !reply.loadId) && (
        <div className="rounded-lg border border-sky-500 p-3 bg-[#121829]">
          <p className="text-sm font-bold text-sky-200">💬 Driver replies on loads not booked in the TMS</p>
          {emails.replies.filter(reply => !reply.loadId).map(reply => (
            <p key={`fb-${reply.id}`} className="text-xs text-gray-300 mt-1">Freight bill {reply.freightBill}</p>
          ))}
          <LoadEmailBox drafts={[]} replies={emails.replies.filter(reply => !reply.loadId)} onDismissReply={emails.onDismissReply} />
        </div>
      )}
      {query && (
        <p role="status" className={`text-sm font-semibold rounded-lg px-4 py-2 border ${matchCount ? 'bg-yellow-400/15 border-yellow-400 text-yellow-200' : 'bg-red-900/30 border-red-500 text-red-200'}`}>
          {matchCount
            ? `🔎 ${matchCount} booked load${matchCount === 1 ? '' : 's'} match "${query}" (highlighted in yellow, shown first)`
            : `No booked load matches "${query}". Check the spelling, or try the load #, driver or truck.`}
        </p>
      )}
      {entries.length === 0 && (
        <p className="text-sm text-gray-300 bg-[#121829] border border-[#1c2541] rounded-lg p-6 text-center">
          No booked loads yet. Open a load, enter the driver, and click 📦 Book Load.
        </p>
      )}
      {entries.map(({ customer, load }) => {
        const stage = load.trackingStage || 'Booked';
        const alert = getTrackingAlert(load, now);
        const lastCall = getLastCheckCall(load);
        const delivered = stage === 'Delivered';
        const phone = phoneDigits(load.driverPhone);
        const matched = isMatch(load);
        return (
          <div
            key={`${customer}|${load.id}`}
            data-booked-load={load.id}
            data-search-match={matched ? 'true' : undefined}
            className={`tms-booked-card rounded-lg border p-3 sm:p-4 bg-[#121829] ${matched ? 'border-yellow-300 ring-4 ring-yellow-300/80 shadow-[0_0_24px_rgba(253,224,71,0.45)]' : alert?.level === 'late' ? 'border-red-500' : alert?.level === 'due' ? 'border-amber-400' : delivered ? 'border-[#1c2541] opacity-60' : 'border-purple-500/50'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] text-gray-400">
                  {matched && <span className="mr-2 bg-yellow-300 text-black font-bold px-1.5 py-0.5 rounded">🔎 Match</span>}
                  {customer}
                </p>
                <button type="button" onClick={() => onOpen(customer, load.id)} title="Open this load" className="text-white font-bold text-sm hover:underline cursor-pointer">
                  #{load.id}
                </button>
                <p className="text-sm text-white">{load.origCity}, {load.origSt} → {load.destCity}, {load.destSt}</p>
                <p className="text-[11px] text-gray-300">PU {load.pickupTime || '—'} · DEL {load.deliveryTime || '—'}{load.rateInput ? ` · $${load.rateInput}` : ''}</p>
              </div>
              <div className="text-sm text-white">
                <p className="font-semibold">🚚 {load.driver || 'No driver'}</p>
                <p className="text-[11px] text-gray-300">Truck {load.truck || '—'} · Trailer {load.trailer || '—'}{load.pickupEta ? ` · PU ETA ${load.pickupEta}` : ''}{load.emptyLocation ? ` · Empty ${load.emptyLocation}` : ''}</p>
                {phone ? (
                  <p className="tms-booked-actions flex flex-wrap gap-2 mt-1">
                    <a href={`tel:${phone}`} className="bg-emerald-700 hover:bg-emerald-600 text-white text-[11px] px-2 py-0.5 rounded font-semibold">📞 Call {load.driverPhone}</a>
                    <button
                      type="button"
                      onClick={event => { void openDriverText(event, load, customer); }}
                      title={`Opens Google Voice with this text copied:\n\n${buildDriverText(load, customer, now)}`}
                      className="bg-sky-700 hover:bg-sky-600 text-white text-[11px] px-2 py-0.5 rounded font-semibold cursor-pointer"
                    >
                      💬 Text (Google Voice)
                    </button>
                  </p>
                ) : <p className="text-[11px] text-amber-300 mt-1">No driver phone on file</p>}
              </div>
              <div className="tms-booked-side flex flex-col items-start sm:items-end gap-1 w-full sm:w-auto">
                <label className="text-[11px] text-gray-400" htmlFor={`stage-${customer}-${load.id}`}>Stage</label>
                <select
                  id={`stage-${customer}-${load.id}`}
                  value={stage}
                  onChange={event => onUpdate(customer, load.id, logCheckCall(load, { stage: event.target.value, note: `Stage: ${event.target.value}` }))}
                  className="bg-[#0b132b] border border-[#1c2541] rounded p-1 text-xs text-white"
                >
                  {trackingStages.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
                {alert && (
                  <span role="alert" className={`text-[11px] px-2 py-0.5 rounded font-bold ${alert.level === 'late' ? 'bg-red-600 text-white' : 'bg-amber-400 text-black'}`}>
                    {alert.level === 'late' ? '⚠ ' : '⏰ '}{alert.text}
                  </span>
                )}
                {(() => {
                  const tracking = getTruckerToolsStatus(load, customer);
                  if (!tracking) return null;
                  const tone = tracking.level === 'ok' ? 'bg-emerald-700 text-white' : tracking.level === 'late' ? 'bg-red-600 text-white' : 'bg-amber-400 text-black';
                  return (
                    <>
                      <span data-tracking-status={tracking.level} className={`text-[11px] px-2 py-0.5 rounded font-bold mt-1 max-w-[320px] text-right ${tone}`}>
                        {tracking.level === 'ok' ? '✅ ' : tracking.level === 'late' ? '⚠ ' : '⏳ '}{tracking.text}
                      </span>
                      {!load.trackingStartedAt && (
                        <button
                          type="button"
                          onClick={() => onUpdate(customer, load.id, markTrackingStarted(load, new Date().toISOString(), { byHand: true }))}
                          title="The driver is tracking but no Trucker Tools email came: stop the reminder emails. Nothing is emailed."
                          className="bg-slate-700 hover:bg-slate-600 text-white text-[11px] px-2 py-0.5 rounded font-semibold cursor-pointer"
                        >
                          Mark tracking started
                        </button>
                      )}
                    </>
                  );
                })()}
                {delivered && (() => {
                  const paperwork = getPaperworkStatus(load, now);
                  const tone = paperwork.level === 'ok' ? 'bg-emerald-700 text-white' : paperwork.level === 'late' ? 'bg-red-600 text-white' : paperwork.level === 'due' ? 'bg-amber-400 text-black' : 'bg-slate-600 text-white';
                  return (
                    <>
                      <span className={`text-[11px] px-2 py-0.5 rounded font-bold mt-1 max-w-[320px] text-right ${tone}`}>
                        {paperwork.level === 'ok' ? '✅ ' : '📄 '}{paperwork.text}
                      </span>
                      {!load.paperworkReceivedAt && (
                        <button
                          type="button"
                          onClick={() => onUpdate(customer, load.id, {
                            ...load, paperworkReceivedAt: new Date().toISOString(), paperworkDone: true,
                            notes: [load.notes, 'Paperwork marked received by hand'].filter(Boolean).join('\n')
                          })}
                          title="You got the POD another way (text, fax): stop the daily reminders and move this load to Completed. Nothing is emailed."
                          className="bg-slate-700 hover:bg-slate-600 text-white text-[11px] px-2 py-0.5 rounded font-semibold cursor-pointer"
                        >
                          Mark paperwork received
                        </button>
                      )}
                    </>
                  );
                })()}
                <div className="flex flex-wrap gap-1 mt-1">
                  <button type="button" onClick={() => onOpen(customer, load.id)} title="Open this load to change the rate, dates or driver" className="bg-slate-700 hover:bg-slate-600 text-white text-[11px] px-2 py-0.5 rounded font-semibold cursor-pointer">
                    ✏️ Edit load
                  </button>
                  {onRemoveCapacity && (
                    <button type="button" onClick={() => onRemoveCapacity(customer, load.id)} title="Clear the driver, truck and trailer and move this load back to OPEN" className="bg-amber-600 hover:bg-amber-500 text-white text-[11px] px-2 py-0.5 rounded font-semibold cursor-pointer">
                      ↩ Remove capacity
                    </button>
                  )}
                </div>
              </div>
            </div>
            {emails && (
              <LoadEmailBox
                drafts={emails.drafts.filter(draft => draft.customer === customer && String(draft.loadId) === String(load.id))}
                replies={emails.replies.filter(reply => reply.customer === customer && String(reply.loadId) === String(load.id))}
                onChangeText={emails.onChangeText}
                onSend={emails.onSend}
                onSkip={emails.onSkip}
                onDismissReply={emails.onDismissReply}
              />
            )}
            <form
              className="tms-checkcall flex gap-2 mt-3"
              onSubmit={event => {
                event.preventDefault();
                const form = event.currentTarget;
                const note = String(form.elements.note.value || '').trim();
                if (!note) return;
                const updated = logCheckCall(load, { stage, note });
                updated.checkCalls[updated.checkCalls.length - 1].customerEmailPending = true;
                onUpdate(customer, load.id, updated);
                form.reset();
              }}
            >
              <input name="note" type="text" placeholder="Check call note (location, ETA, issues)…" className="min-w-0 flex-1 bg-[#0b132b] border border-[#1c2541] rounded p-1.5 text-xs text-white" />
              <button type="submit" className="bg-purple-600 hover:bg-purple-500 text-white text-xs px-3 rounded font-semibold cursor-pointer">Log check call</button>
            </form>
            <p className="text-[11px] text-gray-300 mt-2">
              {lastCall
                ? `Last update ${formatCheckTime(lastCall.at)} · ${lastCall.stage}${lastCall.note ? ` · ${lastCall.note}` : ''}`
                : `Booked ${formatCheckTime(load.bookedAt) || ''} · no check calls yet`}
            </p>
          </div>
        );
      })}
      {completed.length > 0 && (
        <details
          key={completedMatches.length ? 'completed-open' : 'completed'}
          open={completedMatches.length > 0}
          className="rounded-lg border border-emerald-700/60 bg-[#0f1a24] p-3"
          aria-label="Completed loads"
        >
          <summary className="cursor-pointer text-sm font-bold text-emerald-200">
            ✅ Completed: delivered, paperwork received ({completed.length})
          </summary>
          <div className="flex flex-col gap-1 mt-2">
            {completed.map(({ customer, load }) => {
              const matched = isMatch(load);
              return (
                <div
                  key={`done-${customer}|${load.id}`}
                  data-booked-load={load.id}
                  data-search-match={matched ? 'true' : undefined}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded px-3 py-2 text-xs border ${matched ? 'border-yellow-300 ring-2 ring-yellow-300/80 bg-yellow-400/10' : 'border-[#1c2541] bg-[#121829]'}`}
                >
                  <span className="text-gray-200">
                    {matched && <span className="mr-2 bg-yellow-300 text-black font-bold px-1.5 py-0.5 rounded">🔎 Match</span>}
                    <span className="text-gray-400">{customer}</span>{' · '}
                    <button type="button" onClick={() => onOpen(customer, load.id)} className="font-bold text-white hover:underline cursor-pointer">#{load.id}</button>
                    {' · '}{load.origCity}, {load.origSt} → {load.destCity}, {load.destSt}
                    {' · '}🚚 {load.driver || 'No driver'}{load.truck ? ` (${load.truck})` : ''}
                    {' · '}paperwork {formatCheckTime(load.paperworkReceivedAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdate(customer, load.id, { ...load, paperworkReceivedAt: '', paperworkDone: false })}
                    title="Paperwork not in after all: put this load back on the Booked Loads list"
                    className="bg-slate-700 hover:bg-slate-600 text-white text-[11px] px-2 py-0.5 rounded font-semibold cursor-pointer"
                  >
                    ↩ Back to booked
                  </button>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

// ---------- Driver inquiry links ----------

const inquiryCompanyName = 'Landstar';

// Long random code for a load's public driver link (not guessable).
function createInquiryToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Only what a driver should see: no customer name, notes or internal fields.
function buildInquiryDetails(load, profile = {}) {
  const rate = Number(String(load?.rateInput || '').replace(/[$,]/g, ''));
  const phone = String(profile.phone || '').replace(/\D/g, '');
  const weight = parseWeightPounds(load?.weight);
  const miles = Number(normalizeMilesValue(load?.miles));
  return {
    ref: String(load?.id || ''),
    company: inquiryCompanyName,
    callbackPhone: phone.length === 10 ? `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}` : '',
    origin: `${load?.origCity || ''}, ${load?.origSt || ''}`.replace(/^, |, $/g, ''),
    destination: `${load?.destCity || ''}, ${load?.destSt || ''}`.replace(/^, |, $/g, ''),
    pickup: String(load?.pickupTime || ''),
    delivery: String(load?.deliveryTime || ''),
    equipment: getEquipmentDescription(load?.eCode) || String(load?.eCode || ''),
    weight: weight ? `${weight.toLocaleString('en-US')} lbs` : '',
    miles: miles > 0 ? `${Math.round(miles)} mi` : '',
    rate: rate > 0 ? `$${rate.toLocaleString('en-US')}` : ''
  };
}

// Driver links always point at the live site, even when the TMS runs on this
// computer (a localhost link only works on your own PC). Override with
// VITE_PUBLIC_SITE_URL if the site address ever changes.
const publicSiteUrl = String(
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PUBLIC_SITE_URL) || 'https://landstar-tms-reading-cffe.vercel.app'
).replace(/\/+$/, '');

function getInquiryUrl(token, siteUrl = publicSiteUrl) {
  return `${String(siteUrl).replace(/\/+$/, '')}/i/${token}`;
}


// What goes in Landstar column AA. The bulk upload treats it as a comment CODE: anything
// that is not exactly one of Landstar's standard comments fails the whole posting
// ("Comment Code Not Found"). So only a standard comment is sent, spelled the way
// Landstar has it; free text and links are left out.
function getLandstarExportComment(load) {
  const comment = String(load?.landstarComment || '').trim().toLowerCase();
  return landstarCommentOptions.find(option => option.toLowerCase() === comment) || '';
}

// ==========================================
// LOAD-LIST HISTORY
// ==========================================
// The cloud keeps dated copies of each user's load list for 3 days (see
// supabase/app-data-history.sql): hourly, and the old list right before any save that
// cuts it by more than half. The History window lists them and rolls back to one.
const loadListHistoryReasons = {
  hourly: 'Hourly copy',
  'before-shrink': 'Before the list shrank',
  'before-restore': 'Before a restore'
};

// "RXO ATZ: 2,463 loads (1 booked) · Para: 27 loads"
function describeLoadListSummary(summary) {
  if (!summary || typeof summary !== 'object') return 'No details';
  const parts = Object.entries(summary)
    .filter(([, info]) => Number(info?.loads) > 0)
    .sort(([, a], [, b]) => Number(b.loads) - Number(a.loads))
    .map(([customer, info]) => `${customer}: ${Number(info.loads).toLocaleString('en-US')} load${Number(info.loads) === 1 ? '' : 's'}`
      + (Number(info.booked) > 0 ? ` (${info.booked} booked)` : ''));
  return parts.length ? parts.join(' · ') : 'Empty list';
}

function LoadListHistory({ onRestore }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [busyId, setBusyId] = useState(null);

  const loadRows = async () => {
    setStatus('Loading saved copies…');
    const { data, error } = await supabase.from('app_data_history')
      .select('id, reason, saved_at, summary')
      .eq('key', 'landstar_customerOrdersMap')
      .order('saved_at', { ascending: false })
      .limit(200);
    if (error) {
      setStatus(/relation|does not exist|schema cache/i.test(error.message)
        ? 'History is not set up yet: run supabase/app-data-history.sql in Supabase first.'
        : `Could not load history: ${error.message}`);
      return;
    }
    setRows(data || []);
    setStatus(data?.length ? '' : 'No saved copies yet. The first one is made on your next save.');
  };

  const restore = async row => {
    const when = new Date(row.saved_at).toLocaleString();
    if (!window.confirm(`Replace your whole load list with the copy from ${when}?\n\n${describeLoadListSummary(row.summary)}\n\nYour current list is saved to History first, so this can be undone.`)) return;
    setBusyId(row.id);
    try {
      const { data, error } = await supabase.from('app_data_history').select('value').eq('id', row.id).single();
      if (error) throw error;
      const { data: userData } = await supabase.auth.getUser();
      const current = localStorage.getItem('landstar_customerOrdersMap');
      if (userData?.user?.id && current) {
        const { error: saveError } = await supabase.from('app_data_history').insert({
          user_id: userData.user.id, key: 'landstar_customerOrdersMap', value: current, reason: 'before-restore'
        });
        if (saveError) throw new Error(`Could not save your current list first (${saveError.message}); nothing was changed.`);
      }
      if (!onRestore(data.value)) throw new Error('The restored list could not be saved in this browser.');
      alert(`Restored the load list from ${when}.`);
      setOpen(false);
    } catch (error) {
      alert(`Restore failed: ${error.message}`);
    } finally {
      setBusyId(null);
    }
  };

  if (!supabase) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); void loadRows(); }}
        className="tms-tool"
        data-accent="slate"
        title="Roll your load list back to a saved copy from the last 3 days"
      >
        🕘 History
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-label="Load list history">
          <div className="w-[40rem] max-w-full max-h-[80vh] overflow-y-auto bg-[#121829] border border-slate-500 rounded-lg shadow-2xl p-3 normal-case tracking-normal text-left">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-white">🕘 Load list history (last 3 days)</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-300 hover:text-white text-sm px-2 cursor-pointer" aria-label="Close history">✕</button>
            </div>
            <p className="text-[11px] text-gray-300 mb-2">Copies are saved every hour, and right before any save that cuts your list by more than half. Restoring replaces your whole load list.</p>
            {status && <p className="text-xs text-gray-300">{status}</p>}
            {rows.map(row => (
              <div key={row.id} className="border border-[#1c2541] rounded p-2 mb-2 text-xs text-white flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold">{new Date(row.saved_at).toLocaleString()} <span className="font-normal text-gray-400">· {loadListHistoryReasons[row.reason] || row.reason}</span></div>
                  <div className="text-gray-300">{describeLoadListSummary(row.summary)}</div>
                </div>
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => restore(row)}
                  className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 px-2 py-1 text-[10px] font-bold rounded text-white cursor-pointer shrink-0"
                >
                  {busyId === row.id ? 'Restoring…' : 'Restore'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// Full-height list: hides everything above the load list (logo, tools, customers,
// filters) so the loads fill the whole sidebar. Remembered per browser.
const listFocusKey = 'landstar_listFocus';

// The truck's own painted lights (roof and step markers, headlights, fog lights,
// under-glow) are cut out of the art into two layers so the glow sits exactly on them:
// public/truck-lights-yellow.png (roof, side and step markers) and
// public/truck-lights-under.png (white headlights, fog lights and under-glow). They flash for a few seconds after sign-in, then stay on.
// Lights the art doesn't have (mirrors, exhaust stacks) are added as dots; positions
// are percentages of the 1152x768 background, shown centered with "contain".
const truckLights = [
  // LED strips down the outer edge of each mirror
  ['mirror', 45.35, 40.2], ['mirror', 64.15, 37.9],
  // lights running up the left exhaust stack, bottom to top
  ['stack', 43.6, 54.6], ['stack', 43.3, 51], ['stack', 42.9, 47.4], ['stack', 42.6, 43.8], ['stack', 42.3, 40.2],
  ['stack', 42, 36.6], ['stack', 41.7, 33], ['stack', 41.4, 29.4],
];
// Exhaust stack tops; smoke rises from here all the time.
const truckStacks = [[41, 27.6], [56.3, 22.8]];
const smokePuffs = 12;
const truckFlashMs = 6000;

// Import/Data tools and the customer list live in a drawer that slides out from the
// left. The sidebar keeps one button showing the selected customer; picking a customer,
// clicking outside, Esc or ✕ closes it.
// Pinned (📌, the default): the drawer stays open while switching customers and using the page,
// and is open again after a reload. Unpinned: picking a customer closes it, as before.
const toolsPinnedKey = 'landstar_toolsPinned';
// On a phone the drawer covers the whole screen, so it never stays pinned open there.
const isPhoneScreen = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 767px)').matches);
const readToolsPinned = () => {
  if (isPhoneScreen()) return false;
  try { return localStorage.getItem(toolsPinnedKey) !== 'false'; } catch { return true; }
};

function ToolsDrawer({ selected, count, children }) {
  const [pinned, setPinned] = useState(readToolsPinned);
  const [open, setOpen] = useState(readToolsPinned);
  const togglePinned = () => setPinned(current => {
    const next = !current;
    try { localStorage.setItem(toolsPinnedKey, String(next)); } catch { /* this visit only */ }
    return next;
  });
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    // The sidebar's blur would trap the fixed drawer inside it, so drop it while open.
    if (open) {
      document.body.classList.add('tms-drawer-open');
      const onKey = event => { if (event.key === 'Escape') setOpen(false); };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
    const timer = setTimeout(() => document.body.classList.remove('tms-drawer-open'), 320);
    return () => clearTimeout(timer);
  }, [open]);
  return (
    <>
      <button type="button" className="tms-drawer-trigger" onClick={() => setOpen(true)} aria-expanded={open}>
        <span className="tms-drawer-burger" aria-hidden="true">☰</span>
        <span className="tms-drawer-trigger-text">
          <span>Tools &amp; Customers ({count})</span>
          <strong>{selected || 'Pick a customer'}</strong>
        </span>
        <span className="tms-drawer-chevron" aria-hidden="true">›</span>
      </button>
      <div className={`tms-drawer${open ? ' is-open' : ''}${pinned ? ' is-pinned' : ''}`}>
        {/* Pinned: no dark backdrop, so the page next to the drawer stays usable. */}
        {!pinned && <div className="tms-drawer-backdrop" onClick={() => setOpen(false)} />}
        <aside
          className="tms-drawer-panel tms-sidebar-header"
          aria-label="Tools and customers"
          onClick={event => { if (!pinned && event.target?.closest?.('[data-close-drawer]')) setOpen(false); }}
        >
          <div className="tms-drawer-head">
            <span>Tools &amp; Customers</span>
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={togglePinned}
                aria-pressed={pinned}
                title={pinned ? 'Pinned: stays open when you switch customers. Click to close it after each pick.' : 'Click to keep this panel open while you switch customers.'}
                className={`text-xs px-2 py-0.5 rounded cursor-pointer ${pinned ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-200'}`}
              >
                📌 {pinned ? 'Kept open' : 'Keep open'}
              </button>
              <button type="button" className="tms-drawer-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </span>
          </div>
          {children}
        </aside>
      </div>
    </>
  );
}

function TruckLights() {
  const [flashing, setFlashing] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setFlashing(false), truckFlashMs);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="tms-truck-fx" aria-hidden="true">
      <div className="tms-truck-box">
        <div className={`tms-broski-badge${flashing ? ' is-flashing' : ''}`} />
        {truckStacks.map(([x, y], stack) => (
          <div key={`stack-${stack}`} className="tms-smoke" style={{ left: `${x}%`, top: `${y}%` }}>
            {Array.from({ length: smokePuffs }, (_, puff) => (
              <span key={puff} style={{ animationDelay: `${-(puff * 0.4 + stack * 0.2).toFixed(1)}s` }} />
            ))}
          </div>
        ))}
        <div className={`tms-truck-lit${flashing ? ' is-flashing' : ''}`}>
          <div className="tms-truck-glow is-yellow" />
          <div className="tms-truck-glow is-under" />
          {truckLights.map(([kind, x, y], index) => (
            <span
              key={index}
              className={`tms-truck-light is-${kind}`}
              style={{ left: `${x}%`, top: `${y}%`, '--chase': index }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ListFocusToggle() {
  const [focus, setFocus] = useState(() => {
    try { return localStorage.getItem(listFocusKey) === 'true'; } catch { return false; }
  });
  useEffect(() => {
    if (typeof document !== 'undefined') document.body.classList.toggle('tms-list-focus', focus);
    try { localStorage.setItem(listFocusKey, String(focus)); } catch { /* storage unavailable */ }
  }, [focus]);
  return (
    <button
      type="button"
      onClick={() => setFocus(on => !on)}
      aria-pressed={focus}
      title={focus ? 'Show the tools, customers and filters again' : 'Hide everything above the list so the loads fill the sidebar'}
      className="tms-list-bar-button"
    >
      {focus ? '⤡ Show controls' : '⤢ Full-height list'}
    </button>
  );
}

function InquiriesPanel({ inquiries, onOpen, onSeen, onClose }) {
  return (
    <div className="fixed right-4 top-16 z-40 w-[26rem] max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto bg-[#121829] border border-purple-500 rounded-lg shadow-2xl p-3 normal-case tracking-normal text-left" role="dialog" aria-label="Driver inquiries">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-purple-200">📨 Driver inquiries</h2>
        <button type="button" onClick={onClose} className="text-gray-300 hover:text-white text-sm px-2 cursor-pointer" aria-label="Close inquiries">✕</button>
      </div>
      {inquiries.length === 0 && <p className="text-xs text-gray-300">No inquiries yet. Use 🔗 Copy driver link on a load and send it to drivers.</p>}
      {inquiries.map(inquiry => (
        <div key={inquiry.id} className={`border rounded p-2 mb-2 text-xs text-white ${inquiry.seen ? 'border-[#1c2541] opacity-75' : 'border-purple-400 bg-purple-950/30'}`}>
          <div className="flex justify-between gap-2">
            <span className="font-bold">{inquiry.driver_name}</span>
            <span className="text-gray-400">{formatCheckTime(inquiry.created_at)}</span>
          </div>
          <p>
            <a href={`tel:${String(inquiry.driver_phone).replace(/[^\d+]/g, '')}`} className="text-emerald-300 underline">📞 {inquiry.driver_phone}</a>
            {inquiry.mc_or_truck ? ` · ${inquiry.mc_or_truck}` : ''}
          </p>
          {inquiry.message && <p className="text-gray-200 mt-1">“{inquiry.message}”</p>}
          <p className="text-gray-400 mt-1">Load #{inquiry.load_id} · {inquiry.customer}</p>
          {inquiry.notify_error && <p className="text-amber-300 mt-1">Email not sent: {inquiry.notify_error}</p>}
          <div className="flex gap-2 mt-1">
            <button type="button" onClick={() => onOpen(inquiry)} className="bg-purple-600 hover:bg-purple-500 text-white px-2 py-0.5 rounded font-semibold cursor-pointer">Open load</button>
            {!inquiry.seen && <button type="button" onClick={() => onSeen(inquiry)} className="bg-slate-700 hover:bg-slate-600 text-white px-2 py-0.5 rounded cursor-pointer">Mark seen</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

// Tracking emails for one load (Paramount / RXO), shown inside its Booked Loads card:
// a warning badge while an email waits for Send, which opens the email to review.
function LoadEmailBox({ drafts = [], replies = [], onChangeText, onSend, onSkip, onDismissReply }) {
  const [open, setOpen] = useState(false);
  if (!drafts.length && !replies.length) return null;
  const kindLabel = { initial: 'Tracking link + pickup ETA', arrived: 'Arrived at shipper', departed: 'Loaded, left shipper', rxo: 'Reply to update request', rxoForward: 'Forward RXO request to Ivan', driverEta: 'Driver ETA update', driverStatus: 'Driver status update', paperwork: 'POD / paperwork (files attached)', location: 'Daily location update', dailyCustomer: 'Daily customer update', checkCall: 'Logged check call update' };
  const approvalsLeft = draft => Math.max(0, PARAMOUNT_AUTO_SEND_AFTER
    - readApprovedCount(draft.kind === 'paperwork' ? paperworkApprovedKey : draft.kind === 'driver' ? driverApprovedKey : draft.kind === 'rxo' ? rxoApprovedKey : paramountApprovedKey));
  const who = draft => (draft.kind === 'driver' ? 'Driver' : draft.kind === 'checkCall' ? draft.customer : draft.kind === 'rxoForward' ? 'Ivan' : draft.kind === 'rxo' || draft.target === 'rxo' ? 'RXO' : 'Paramount');
  // Paperwork drafts carry no addresses: the send replies on the customer's email thread.
  const recipients = draft => [...(draft.to || []), ...(draft.cc || [])];
  return (
    <div data-email-draft={drafts.length ? 'waiting' : undefined} className="mt-3 text-xs text-white normal-case tracking-normal text-left">
      <div className="flex flex-wrap gap-2">
        {drafts.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(value => !value)}
            aria-expanded={open}
            title="An email is waiting for you to review and send"
            className="bg-amber-400 hover:bg-amber-300 text-black px-2 py-0.5 rounded font-bold cursor-pointer"
          >
            ⚠ {drafts.length === 1 ? 'Email ready to send' : `${drafts.length} emails ready to send`} · {open ? 'Hide' : 'Review'}
          </button>
        )}
        {replies.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(value => !value)}
            className="bg-sky-500 hover:bg-sky-400 text-black px-2 py-0.5 rounded font-bold cursor-pointer"
          >
            💬 {replies.length === 1 ? 'New reply' : `${replies.length} new replies`} · {open ? 'Hide' : 'Read'}
          </button>
        )}
      </div>
      {open && replies.map(reply => (
        <div key={reply.id} className="border border-sky-400 bg-sky-950/30 rounded p-2 mt-2">
          <p className="font-bold text-sky-200">💬 {reply.driver ? 'Driver · ' : ''}{reply.from} · {formatCheckTime(reply.at)}</p>
          <p className="mt-1 text-gray-100">“{reply.snippet}”</p>
          <div className="flex gap-2 mt-1">
            <a href={`https://mail.google.com/mail/u/0/#all/${reply.threadId}`} target="_blank" rel="noreferrer" className="bg-sky-600 hover:bg-sky-500 text-white px-2 py-0.5 rounded font-semibold">Open in Gmail</a>
            <button type="button" onClick={() => onDismissReply(reply)} className="bg-slate-700 hover:bg-slate-600 text-white px-2 py-0.5 rounded cursor-pointer">Dismiss</button>
          </div>
        </div>
      ))}
      {open && drafts.map(draft => (
        <div key={draft.id} className="border border-amber-400 rounded p-2 mt-2">
          <p className="font-bold text-amber-200">✉️ {who(draft)} email · {draft.kind === 'driver' ? driverEmailLabels[draft.driverKind] : kindLabel[draft.kind]}</p>
          {draft.request && <p className="text-amber-100 mt-0.5">They asked: “{draft.request}”</p>}
          {draft.warning && <p role="alert" className="mt-1 bg-red-600 text-white font-bold rounded px-2 py-1">⚠ {draft.warning} Send only if it is; otherwise click Don&apos;t send.</p>}
          {draft.kind === 'rxo' && !draft.complete && <p className="text-amber-300 mt-0.5">Fill in the blanks (like the pickup ETA) before sending.</p>}
          <p className="text-gray-300">{recipients(draft).length
            ? `Reply all to: ${recipients(draft).join(', ')}`
            : `Sends with the files on the ${who(draft)} email thread`}</p>
          <textarea
            value={draft.text}
            onChange={event => onChangeText(draft, event.target.value)}
            rows={10}
            className="w-full mt-1 bg-[#0b1020] border border-[#1c2541] rounded p-1.5 text-xs text-white font-sans"
            aria-label={`Email text for order ${draft.loadId}`}
          />
          {draft.error && <p className="text-red-300 mt-1">Not sent: {draft.error}</p>}
          <div className="flex flex-wrap gap-2 mt-1 items-center">
            <button type="button" disabled={draft.sending} onClick={() => onSend(draft)} className="bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white px-3 py-0.5 rounded font-semibold cursor-pointer">{draft.sending ? 'Sending…' : 'Send'}</button>
            <button type="button" disabled={draft.sending} onClick={() => onSkip(draft)} className="bg-slate-700 hover:bg-slate-600 text-white px-2 py-0.5 rounded cursor-pointer">Don&apos;t send</button>
            <span className="text-gray-400">{draft.warning ? 'Waits for your Send (short stop at the shipper)' : paramountAlwaysAskKinds.has(draft.kind) ? 'Always waits for your Send' : approvalsLeft(draft) ? `${approvalsLeft(draft)} more approval${approvalsLeft(draft) === 1 ? '' : 's'}, then these send automatically` : 'Sending automatically'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// The Landstar upload bot (bot/status-server.js) reports its login status on
// this computer while it runs. No answer means the bot is not running.
const BOT_STATUS_URL = 'http://127.0.0.1:47615/status';
const BOT_UNPOST_URL = 'http://127.0.0.1:47615/unpost';

// Postings waiting to be removed from Landstar by the upload bot (loads that dropped
// off a customer's list). Kept in this browser until the bot confirms it has them.
const unpostQueueKey = 'landstar_unpostQueue';
// More removals than this from one import, and over half the customer's posted loads, needs a yes.
const LARGE_DROP_MIN = 10;
function readUnpostQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(unpostQueueKey));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeUnpostQueue(queue) {
  try {
    localStorage.setItem(unpostQueueKey, JSON.stringify(queue));
  } catch (error) {
    console.error('Could not save the Landstar removal queue:', error);
  }
}
function addToUnpostQueue(droppedPostings) {
  const queue = readUnpostQueue();
  const seen = new Set(queue.map(item => `${item.customer}|${item.loadId}`));
  droppedPostings.forEach(item => {
    if (item?.posting && !seen.has(`${item.customer}|${item.loadId}`)) {
      queue.push({ ...item, queuedAt: new Date().toISOString() });
      seen.add(`${item.customer}|${item.loadId}`);
    }
  });
  writeUnpostQueue(queue);
  return queue.length;
}
// Loads booked in the TMS: the bot assigns the truck (BCO tractor number) to the load's
// Landstar posting. Kept in this browser until the bot confirms it has them.
const BOT_ASSIGN_URL = 'http://127.0.0.1:47615/assign';
const assignQueueKey = 'landstar_assignQueue';
const assignSeenKey = 'landstar_assignSeenAt';

// What the bot needs to assign a booked load on Landstar, or why it can't.
function buildAssignRequest(customer, load) {
  const truck = String(load?.truck || '').trim();
  if (!truck) return { reason: 'There is no truck number on this load.' };
  let posting = load?.landstarPosting;
  const recoverPosting = !posting?.originZip;
  if (recoverPosting) {
    const pickup = splitScheduleRange(load.pickupTime);
    const delivery = splitScheduleRange(load.deliveryTime);
    const from = toExcelDateTime(pickup[0]);
    let thru = toExcelDateTime(pickup[1] || pickup[0], pickup[0]);
    const deliveryFrom = toExcelDateTime(delivery[0]);
    let deliveryThru = toExcelDateTime(delivery[1] || delivery[0], delivery[0]);
    if (from !== null && thru !== null && thru <= from) thru = from + 1 / 24;
    if (deliveryFrom !== null && deliveryThru !== null && deliveryThru <= deliveryFrom) deliveryThru = deliveryFrom + 1 / 24;
    if (!load.origZip || !load.destZip || thru === null || deliveryThru === null || !(parseWeightPounds(load.weight) > 0)) {
      return { reason: 'Saved posting details are missing, and ZIPs, pickup/delivery times and weight are required to safely recover the bot-uploaded posting.' };
    }
    posting = buildLandstarPosting({
      'Origin Zipcode(Required)': load.origZip, 'Destination Zipcode(Required)': load.destZip,
      'Pickup Date (Thru)(Required)': thru, 'Delivery Date (Thru)(Required)': deliveryThru,
      'Weight(Required)': parseWeightPounds(load.weight)
    });
  }
  return {
    item: {
      customer, loadId: String(load.id), truck,
      driver: String(load.driver || '').trim(), posting, recoverPosting
    }
  };
}
function readAssignQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(assignQueueKey));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function addToAssignQueue(item) {
  const key = `${item.customer}|${item.loadId}`;
  const queue = readAssignQueue().filter(existing => `${existing.customer}|${existing.loadId}` !== key);
  try {
    localStorage.setItem(assignQueueKey, JSON.stringify([...queue, { ...item, queuedAt: new Date().toISOString() }]));
  } catch (error) {
    console.error('Could not save the Landstar assign queue:', error);
  }
}
// Hands booked loads to the bot; returns how many it accepted (0 if the bot is off).
async function sendAssignQueueToBot() {
  const queue = readAssignQueue();
  if (!queue.length) return 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(BOT_ASSIGN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookings: queue }),
      signal: controller.signal
    });
    if (!response.ok) return 0;
    const sent = new Set(queue.map(item => `${item.customer}|${item.loadId}|${item.truck}`));
    const left = readAssignQueue().filter(item => !sent.has(`${item.customer}|${item.loadId}|${item.truck}`));
    localStorage.setItem(assignQueueKey, JSON.stringify(left));
    return queue.length;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}
// Results the bot reports that this browser hasn't shown yet.
function takeNewAssignResults(results) {
  if (!Array.isArray(results) || !results.length) return [];
  let seenAt = 0;
  try { seenAt = Number(localStorage.getItem(assignSeenKey)) || 0; } catch { /* first time */ }
  const fresh = results.filter(result => Number(result?.at) > seenAt);
  if (fresh.length) {
    try { localStorage.setItem(assignSeenKey, String(Math.max(...fresh.map(result => Number(result.at))))); } catch { /* shown again next time */ }
  }
  return fresh;
}
// The load's note after the bot's assignment: "Landstar: Assigned 420371 - LDWY ..." or why not.
function applyAssignResult(load, result) {
  const line = result.ok
    ? `Landstar: ${result.message}`
    : result.unconfirmed
      ? `Landstar: truck ${result.truck} NOT CONFIRMED - check Landstar before assigning again. ${result.message}`
      : `Landstar: truck ${result.truck} NOT assigned - ${result.message}. Assign it by hand.`;
  return {
    ...load,
    ...(result.ok && result.posting ? { landstarPosting: result.posting } : {}),
    landstarAssignment: { ok: Boolean(result.ok), truck: result.truck, landstarLoadId: result.landstarLoadId || '', message: result.message, at: result.at },
    notes: load.notes ? `${load.notes}\n${line}` : line
  };
}

// ---------- Paramount tracking emails ----------
// Booked Paramount loads (Para 1522166 - ATZ and - ATZ H): the bot reads Clarity for the
// tracking link, pickup ETA and shipper arrival/departure (bot/clarity.js); the TMS replies
// all on Paramount's "Rate Confirmation for order: <order#>" email with them
// (/api/paramount-email), and flags replies from Paramount. The first few emails wait for
// a Send click; after that they go out on their own.
const BOT_TRACKING_URL = 'http://127.0.0.1:47615/tracking';
const PARAMOUNT_EMAIL_URL = '/api/paramount-email';
const paramountTrackingCustomers = new Set(['PARA1522166ATZ', 'PARA1522166ATZH']);
const paramountApprovedKey = 'landstar_paramountApprovedSends';
const PARAMOUNT_AUTO_SEND_AFTER = 3;
// Arrived at the shipper: always waits for Daniel's Send click (his rule, 2026-11-06).
const paramountAlwaysAskKinds = new Set(['arrived']);
const paramountMaySendItself = kind => !paramountAlwaysAskKinds.has(kind) && readParamountApprovedCount() >= PARAMOUNT_AUTO_SEND_AFTER;
// Loaded / left the shipper (rule 2026-11-07): sent automatically with the loaded time, unless
// the truck was at the shipper under 15 minutes (or Clarity has no arrival): then Daniel is
// asked whether it really is the loaded time.
const MIN_LOADING_MINUTES = 15;
function getLoadedTimeWarning(info = {}) {
  const left = Date.parse(info.leftShipperAt);
  const arrived = Date.parse(info.arrivedShipperAt);
  if (!Number.isFinite(left)) return '';
  if (!Number.isFinite(arrived)) return 'Clarity has no arrival time at the shipper. Is this really the loaded time?';
  const minutes = Math.round((left - arrived) / 60000);
  return minutes < MIN_LOADING_MINUTES
    ? `The truck was at the shipper only ${minutes} min (arrived ${formatParamountTime(info.arrivedShipperAt, info.pickupTimezone)}, left ${formatParamountTime(info.leftShipperAt, info.pickupTimezone)}). Is this really the loaded time?`
    : '';
}
// Daily location update to the customer while the load is rolling (rule 2026-11-07).
const LOCATION_EMAIL_HOUR = 9;
const PARAMOUNT_WATCH_DAYS = 5;
const paramountEmailKinds = ['initial', 'arrived', 'departed'];
const paramountSignatureName = 'Daniel Gomez';
// The App's latest loads/profile for the email timers, and drafts already being handled.
const paramountLatest = {};
const paramountBusy = new Set();
// Clarity results already handed to the App (the bot repeats them on every status check).
const paramountResultSeen = new Map();
// Duplicated freight bills already shown as a banner (the helper repeats them while they exist).
const duplicateBillSeen = new Map();
// The fuel surcharge email last applied (Gmail message id).
const fuelEmailSeenKey = 'landstar_fuelEmailSeen';
// Freight bills from recent BCO Load Detail emails (refreshed every few minutes).
const bcoBillsCache = { at: 0, bills: [] };
const truckerToolsCache = { at: 0, okAt: 0, starts: [] };
// Daniel's VIP customers (2026-11-09): a gold banner + Windows notification the moment one
// of them emails, on any thread. Heather books the Paramount loads - never miss her.
const VIP_CONTACTS = [
  { email: 'heather.locke@rlglobal.com', name: 'Heather Locke (Paramount)' }
];
const vipSeenKey = 'landstar_vipSeen';
// Driver replies must be seen right away: a Windows notification (even when the TMS tab is in the
// background), a sound, and a blinking tab title until the TMS is looked at.
function alertDriverReply(title, body, gmailThreadId, tabTitle = '💬 DRIVER REPLIED') {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const note = new Notification(title, { body, requireInteraction: true, tag: `driver-${gmailThreadId || title}` });
      note.onclick = () => {
        window.focus();
        if (gmailThreadId) window.open(`https://mail.google.com/mail/u/0/#all/${gmailThreadId}`, '_blank');
        note.close();
      };
    }
  } catch { /* the banner still shows */ }
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audio = new AudioContext();
    [0, 0.25, 0.5].forEach(start => {
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.frequency.value = 880;
      gain.gain.value = 0.25;
      tone.connect(gain).connect(audio.destination);
      tone.start(audio.currentTime + start);
      tone.stop(audio.currentTime + start + 0.15);
    });
  } catch { /* no sound */ }
  if (!blinkTimer) {
    const original = document.title;
    let on = false;
    blinkTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        clearInterval(blinkTimer);
        blinkTimer = null;
        document.title = original;
        return;
      }
      on = !on;
      document.title = on ? tabTitle : original;
    }, 1000);
  }
}
let blinkTimer = null;

// Driver replies already shown for loads that aren't booked in the TMS.
const driverReplySeenKey = 'landstar_driverReplySeenIds';
function readSeenDriverReplies() {
  try { const parsed = JSON.parse(localStorage.getItem(driverReplySeenKey)); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
function markSeenDriverReplies(ids) {
  try { localStorage.setItem(driverReplySeenKey, JSON.stringify([...readSeenDriverReplies(), ...ids].slice(-300))); } catch { /* shown again next time */ }
}

function isParamountTrackingCustomer(name) {
  return paramountTrackingCustomers.has(normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, ''));
}

// Booked Paramount loads with a truck, not delivered, booked in the last few days.
function getParamountWatchList(customerOrdersMap, now = Date.now()) {
  return Object.entries(customerOrdersMap || {})
    .filter(([customer]) => isParamountTrackingCustomer(customer))
    .flatMap(([customer, loads]) => (loads || [])
      .filter(load => load.status === 'BOOKED' && String(load.truck || '').trim()
        && load.trackingStage !== 'Delivered'
        && (!Date.parse(load.bookedAt) || now - Date.parse(load.bookedAt) < PARAMOUNT_WATCH_DAYS * 86400000))
      .map(load => ({
        key: `${customer}|${load.id}`, customer, loadId: String(load.id), truck: String(load.truck).trim(),
        pickupCity: load.origCity || '', pickupState: load.origSt || '', billTo: 'paramount'
      })));
}

// "11/06 at 08:00 CST" in the stop's own time zone.
function formatParamountTime(iso, timeZone) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const options = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' };
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', { ...options, timeZone: timeZone || undefined }).formatToParts(new Date(at));
  } catch {
    parts = new Intl.DateTimeFormat('en-US', options).formatToParts(new Date(at));
  }
  const get = type => parts.find(part => part.type === type)?.value || '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('month')}/${get('day')} at ${hour}:${get('minute')} ${get('timeZoneName')}`.trim();
}

const titleCase = text => String(text || '').toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase());

function paramountSignature(phone) {
  return ['Best regards,', paramountSignatureName, 'Landstar', formatPhone(phone) || '484-575-6486'].join('\n');
}

// The email text for one update. info = the bot's Clarity result; greetingName from the thread.
function buildParamountEmail(kind, load, info = {}, { greetingName = '', phone = '' } = {}) {
  const order = String(load.id);
  const hello = greetingName ? `Hi ${greetingName} and team,` : 'Hello team,';
  const driver = titleCase(info.driver || load.driver || '') || 'our driver';
  const pickupPlace = info.pickupCity || [titleCase(load.origCity), load.origSt].filter(Boolean).join(', ');
  const deliveryPlace = info.deliveryCity || [titleCase(load.destCity), load.destSt].filter(Boolean).join(', ');
  // Pickup ETA: only what Daniel typed in the load's Pickup ETA box, never Clarity's (often wrong).
  const pickupEta = String(load.pickupEta || '').trim();
  const deliveryEta = formatParamountTime(info.deliveryEta || info.deliveryScheduled, info.deliveryTimezone);
  const link = info.trackingLink ? `\n\nHere is the live tracking link for this load, so you can follow the truck at any time:\n${info.trackingLink}` : '';
  const sign = `\n\n${paramountSignature(phone)}`;
  if (kind === 'initial') {
    const status = info.leftShipperAt
      ? `Our driver, ${driver}, has already picked up in ${pickupPlace} and is on the way to ${deliveryPlace}${deliveryEta ? `, with an estimated arrival of ${deliveryEta}` : ''}.`
      : `Our driver, ${driver}, is scheduled to pick up in ${pickupPlace}${pickupEta ? `, with an estimated arrival of ${pickupEta}` : ''}.`;
    return `${hello}\n\nThank you so much for trusting us with order ${order}! We truly appreciate the business.${link}\n\n${status}\n\n`
      + 'We will keep you updated right here on this thread when the driver arrives at the shipper and once the truck is loaded and rolling. '
      + 'If you need anything at all, please don\'t hesitate to reach out. We\'re always happy to help.\n\nThank you again, and have a wonderful day!'
      + sign;
  }
  if (kind === 'arrived') {
    return `${hello}\n\nQuick update on order ${order}: ${driver} has arrived at the shipper in ${pickupPlace}`
      + `${info.arrivedShipperAt ? ` (${formatParamountTime(info.arrivedShipperAt, info.pickupTimezone)})` : ''}. `
      + 'We\'ll let you know as soon as the truck is loaded and on the way.'
      + `${info.trackingLink ? `\n\nLive tracking: ${info.trackingLink}` : ''}\n\nThank you!${sign}`;
  }
  if (kind === 'location') {
    const where = String(info.lastLocation || '').trim();
    const when = info.lastLocationAt ? ` (as of ${formatParamountTime(info.lastLocationAt, info.deliveryTimezone || info.pickupTimezone)})` : '';
    return `${hello}\n\nDaily update on order ${order}: the truck is in ${where}${when}, on the way to ${deliveryPlace}.`
      + `${deliveryEta ? ` The estimated arrival at delivery is ${deliveryEta}.` : ''}`
      + `${info.trackingLink ? `\n\nLive tracking: ${info.trackingLink}` : ''}\n\nThank you!${sign}`;
  }
  return `${hello}\n\nGreat news on order ${order}: the truck is loaded and has left the shipper in ${pickupPlace}`
    + `${info.leftShipperAt ? ` (${formatParamountTime(info.leftShipperAt, info.pickupTimezone)})` : ''}, heading to ${deliveryPlace}.`
    + `${deliveryEta ? ` The estimated arrival at delivery is ${deliveryEta}.` : ''}`
    + `${info.trackingLink ? `\n\nLive tracking: ${info.trackingLink}` : ''}\n\nThank you for working with us, and please reach out if you need anything!${sign}`;
}

// Which tracking emails are due for a load, given the bot's latest Clarity result.
// The first email needs the tracking link; once the truck has left the shipper, a
// not-yet-sent "arrived" email is skipped (the "left" one covers it).
function getDueParamountEmails(load, info, now = Date.now()) {
  if (!info?.ok) return [];
  const sent = load.paramountTracking?.emails || {};
  const due = [];
  if (!sent.initial) {
    if (info.trackingLink) due.push('initial');
    return due;
  }
  if (!hasPickupDayStarted(load, now)) return [];
  if (info.leftShipperAt && !sent.departed) return ['departed'];
  if (isDailyCustomerUpdateDue(load, info, now)) return ['location'];
  if (info.arrivedShipperAt && !sent.arrived && !info.leftShipperAt) due.push('arrived');
  return due;
}

function isDailyCustomerUpdateDue(load, tracking, now = Date.now()) {
  if (!hasPickupDayStarted(load, now)) return false;
  if (load.status !== 'BOOKED' || load.trackingStage === 'Delivered' || tracking.deliveredAt) return false;
  if (!tracking.leftShipperAt && !['Loaded', 'In Transit', 'At Delivery'].includes(load.trackingStage)) return false;
  if (!String(tracking.lastLocation || '').replace(/[\s,]/g, '')) return false;
  const checkedAt = Date.parse(tracking.checkedAt);
  if (!Number.isFinite(checkedAt) || now < checkedAt || now - checkedAt > 30 * 60 * 1000) return false;
  const sent = load.paramountTracking?.emails || {};
  return now >= atHourOf(now, LOCATION_EMAIL_HOUR)
    && ![sent.location?.at, sent.departed?.at].some(at => at && sameLocalDay(Date.parse(at), now));
}

// Records a sent (or skipped) email on the load, with a line in its notes.
function markParamountEmail(load, kind, { at = new Date().toISOString(), skipped = false } = {}) {
  const tracking = load.paramountTracking || {};
  const emails = { ...(tracking.emails || {}), [kind]: { at, ...(skipped ? { skipped: true } : {}) } };
  // Sending "left the shipper" also settles the "arrived" email.
  if (kind === 'departed' && !emails.arrived) emails.arrived = { at, skipped: true };
  if (kind === 'initial' && !skipped && tracking.leftShipperAt) {
    emails.arrived = emails.arrived || { at, skipped: true };
    emails.departed = emails.departed || { at, skipped: true };
  }
  const label = { initial: 'tracking link + pickup ETA', arrived: 'arrived at shipper', departed: 'left shipper + delivery ETA', location: 'daily location update' }[kind];
  const line = `Paramount email ${skipped ? 'skipped' : 'sent'}: ${label}`;
  return { ...load, paramountTracking: { ...tracking, emails }, notes: load.notes ? `${load.notes}\n${line}` : line };
}

// Saves the bot's Clarity result on the load and moves its tracking stage forward.
function applyParamountTrackingInfo(load, info) {
  if (!info?.ok) return load;
  const { key, customer, loadId, ok, at, ...rest } = info;
  const next = { ...load, paramountTracking: { ...(load.paramountTracking || {}), ...rest, checkedAt: at || Date.now() } };
  const order = trackingStages.indexOf(load.trackingStage || 'Booked');
  const target = info.deliveredAt ? 'Delivered' : info.leftShipperAt ? 'Loaded' : info.arrivedShipperAt ? 'At Pickup' : null;
  if (target && trackingStages.indexOf(target) > order) next.trackingStage = target;
  return next;
}

function readParamountApprovedCount() {
  try { return Number(localStorage.getItem(paramountApprovedKey)) || 0; } catch { return 0; }
}

async function callParamountEmail(body) {
  const response = await fetch(PARAMOUNT_EMAIL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Email request failed (HTTP ${response.status}).`);
  return result;
}

// ---------- Driver emails ----------
// Every booked load whose Landstar freight bill the bot found in Clarity: the TMS replies
// in Daniel's "BCO Load Detail" email to the driver (Cc his Landstar address):
//   dispatch        right after the BCO Load Detail email: turn on the tracking app, confirm.
//   pickupMorning   7:00 AM on pickup day: good to go? ETA to the shipper?
//   pickedUp        once Clarity shows the truck left the shipper: ETA for delivery?
//   deliveryMorning 7:00 AM on delivery day (picked up on an earlier day): good? ETA?
//   pod             once delivered: please send the POD.
// The first few wait for a Send click; driver replies show on the load with a pop-up.
const driverApprovedKey = 'landstar_driverApprovedSends';
const DRIVER_EMAIL_HOUR = 7;
const TRACKING_WATCH_DAYS = 10;
const driverEmailLabels = {
  dispatch: 'Driver follow-up: tracking + confirmation + ETA',
  pickupMorning: 'Pickup day: good to go + ETA',
  pickedUp: 'Picked up: delivery ETA',
  deliveryMorning: 'Delivery day: good to go + ETA',
  pod: 'Delivered: send the POD',
  podReminder: 'Paperwork reminder (due within 48 hours)',
  trackingReminder: 'Reminder: start Trucker Tools tracking'
};
const PAPERWORK_DUE_HOURS = 48;
const PAPERWORK_REMINDER_DAYS = 7; // daily reminders stop after a week
const paperworkApprovedKey = 'landstar_paperworkApprovedSends';

// When the load delivered: Clarity's delivery time, else when the stage was set to Delivered.
function getDeliveredAt(load, tracking = load?.paramountTracking || {}) {
  const fromClarity = Date.parse(tracking.deliveredAt);
  if (Number.isFinite(fromClarity)) return fromClarity;
  // Clarity sometimes reports a finished delivery with no time (deliveredAt: 'done').
  if (!tracking.deliveredAt && (load?.trackingStage || '') !== 'Delivered') return null;
  const call = [...(Array.isArray(load?.checkCalls) ? load.checkCalls : [])].reverse().find(item => item.stage === 'Delivered');
  const at = Date.parse(call?.at);
  if (Number.isFinite(at)) return at;
  // Delivered without any recorded time: when the TMS asked for the POD, else the
  // scheduled delivery - so the paperwork check still picks the load up.
  const podAt = Date.parse(load?.driverEmails?.pod?.at);
  if (Number.isFinite(podAt)) return podAt;
  const scheduled = parseScheduleStart(load?.deliveryTime);
  return Number.isFinite(scheduled) ? scheduled : null;
}

// The customer email thread a driver's POD is forwarded to (Paramount or RXO), or ''.
function getPaperworkTarget(customer) {
  if (isParamountTrackingCustomer(customer)) return 'paramount';
  if (isRxoTrackingCustomer(customer)) return 'rxo';
  return '';
}

function getPaperworkSince(load, tracking = load.paramountTracking || {}) {
  const times = [getDeliveredAt(load, tracking), parseScheduleStart(load.deliveryTime), Date.parse(load.bookedAt)]
    .filter(time => Number.isFinite(time) && time > 0);
  return load.paperworkSince || new Date((times.length ? Math.min(...times) : Date.now()) - 86400000).toISOString();
}

async function checkBeforePodRequest(load, tracking, readPaperwork = callParamountEmail) {
  if (load.paperworkReceivedAt) return { received: true, files: [] };
  const result = await readPaperwork({
    action: 'driverPaperwork', freightBill: tracking.freightBill, since: getPaperworkSince(load, tracking)
  });
  if (!Array.isArray(result.files)) throw new Error('Could not verify driver paperwork: invalid attachment response.');
  return { received: result.files.length > 0, files: result.files };
}

// Every booked load with a truck for the bot to find in Clarity (Paramount, RXO, all others).
function getTrackingWatchList(customerOrdersMap, now = Date.now()) {
  const entries = Object.entries(customerOrdersMap || {})
    .filter(([customer]) => !isParamountTrackingCustomer(customer) && !isRxoTrackingCustomer(customer))
    .flatMap(([customer, loads]) => (loads || [])
      .filter(load => load.status === 'BOOKED' && String(load.truck || '').trim()
        && load.trackingStage !== 'Delivered'
        && (!Date.parse(load.bookedAt) || now - Date.parse(load.bookedAt) < TRACKING_WATCH_DAYS * 86400000))
      .map(load => ({
        key: `${customer}|${load.id}`, customer, loadId: String(load.id), truck: String(load.truck).trim(),
        pickupCity: load.origCity || '', pickupState: load.origSt || '', billTo: 'any'
      })));
  return [...getParamountWatchList(customerOrdersMap, now), ...getRxoWatchList(customerOrdersMap, now), ...entries].slice(0, 50);
}

const atHourOf = (time, hour) => {
  const date = new Date(time);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
};
const sameLocalDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

// Which driver email is due now (at most one), given the load and the bot's Clarity data.
function getDueDriverEmails(load, tracking = {}, now = Date.now()) {
  if (load.status !== 'BOOKED' || !tracking.freightBill) return [];
  const sent = load.driverEmails || {};
  const stage = load.trackingStage || 'Booked';
  const delivered = Boolean(tracking.deliveredAt) || stage === 'Delivered';
  const pickedUp = Boolean(tracking.leftShipperAt) || ['Loaded', 'In Transit', 'At Delivery'].includes(stage);
  if (!delivered && !pickedUp && !sent.dispatch && !sent.pickupMorning) return ['dispatch'];
  if (!hasPickupDayStarted(load, now)) return [];
  if (delivered) {
    if (load.paperworkReceivedAt) return [];
    if (!sent.pod) return ['pod'];
    // No paperwork yet: one reminder each morning (not on the day the POD email went out),
    // for up to a week after delivery.
    const deliveredAt = getDeliveredAt(load, tracking) || Date.parse(sent.pod.at);
    if (now - deliveredAt > PAPERWORK_REMINDER_DAYS * 86400000) return [];
    const remindedToday = [sent.pod.at, sent.podReminder?.at].some(at => at && sameLocalDay(Date.parse(at), now));
    return now >= atHourOf(now, DRIVER_EMAIL_HOUR) && !remindedToday ? ['podReminder'] : [];
  }
  const morning = atHourOf(now, DRIVER_EMAIL_HOUR);
  if (pickedUp) {
    if (!sent.pickedUp) return ['pickedUp'];
    const deliveryAt = parseScheduleStart(load.deliveryTime);
    const askedToday = Date.parse(sent.pickedUp.at) >= morning;
    if (deliveryAt && sameLocalDay(deliveryAt, now) && now >= morning && !sent.deliveryMorning && !askedToday) return ['deliveryMorning'];
    return [];
  }
  const pickupAt = parseScheduleStart(load.pickupTime);
  // Booked after 7 AM on pickup day, or the dispatch email went out this morning: no morning check.
  const bookedBefore = !Date.parse(load.bookedAt) || Date.parse(load.bookedAt) < morning;
  const dispatchedToday = sent.dispatch && Date.parse(sent.dispatch.at) >= morning;
  if (pickupAt && sameLocalDay(pickupAt, now) && now >= morning && !sent.pickupMorning && bookedBefore && !dispatchedToday) return ['pickupMorning'];
  return [];
}

// The tracking app each customer uses: RXO = MacroPoint, Paramount = Trucker Tools.
function getTrackingAppName(customer) {
  if (isRxoTrackingCustomer(customer)) return 'MacroPoint';
  if (isParamountTrackingCustomer(customer)) return 'Trucker Tools';
  return '';
}

// Very visible at the top of every driver email until delivery.
function trackingAppNotice(customer) {
  const app = getTrackingAppName(customer);
  const name = app ? `the ${app.toUpperCase()} tracking app` : 'your tracking app';
  return `*** IMPORTANT: PLEASE TURN ON ${name.toUpperCase()} ON THE DAY OF PICKUP ***\n`
    + `Keep ${app || 'it'} on and tracking for the ENTIRE trip, from pickup to delivery. The customer charges back if tracking is not used.\n\n`;
}

function buildDriverEmail(kind, load, tracking = {}, { phone = '', customer = '' } = {}) {
  const first = titleCase(String(load.driver || '').trim().split(/\s+/)[0] || '');
  const notice = kind === 'pod' || kind === 'podReminder' ? '' : trackingAppNotice(customer);
  const hello = `${first ? `Hi ${first},` : 'Hi,'}\n\n${notice}`.trimEnd();
  const bill = tracking.freightBill ? `load ${tracking.freightBill}` : `load #${load.id}`;
  const pickupPlace = tracking.pickupCity || [titleCase(load.origCity), load.origSt].filter(Boolean).join(', ');
  const deliveryPlace = tracking.deliveryCity || [titleCase(load.destCity), load.destSt].filter(Boolean).join(', ');
  const appt = value => (String(value || '').trim() ? ` (appointment ${String(value).trim()})` : '');
  const sign = `\n\nThank you!\n\n${paramountSignature(phone)}`;
  if (kind === 'dispatch') {
    return `${hello}\n\nThank you for taking ${bill}! Pickup is in ${pickupPlace}${appt(load.pickupTime)} and delivery is in ${deliveryPlace}${appt(load.deliveryTime)}.\n\n`
      + `Please reply to confirm you received the load details and attached documents, and that you will use ${getTrackingAppName(customer) || 'your tracking app'} from pickup day through delivery. Let me know your ETA to the shipper.` + sign;
  }
  if (kind === 'pickupMorning') {
    return `Good morning ${first || ''}`.trim() + `!\n\n${notice}Just checking in on ${bill}, picking up today in ${pickupPlace}${appt(load.pickupTime)}. `
      + 'Are you good to go for pickup? What is your ETA to the shipper?' + sign;
  }
  if (kind === 'trackingReminder') {
    return `${hello}\n\nReminder: Trucker Tools has not confirmed tracking for ${bill} yet (customer load #${load.id}). `
      + 'Please open the Trucker Tools app and start tracking for this load on the day of pickup. '
      + 'If you did not get the Trucker Tools link, or the app is giving you trouble, please reply and let me know right away.' + sign;
  }
  if (kind === 'pickedUp') {
    return `${hello}\n\nThank you for picking up ${bill} in ${pickupPlace}! What is your ETA for delivery in ${deliveryPlace}${appt(load.deliveryTime)}?` + sign;
  }
  if (kind === 'deliveryMorning') {
    return `Good morning ${first || ''}`.trim() + `!\n\n${notice}${bill.charAt(0).toUpperCase()}${bill.slice(1)} delivers today in ${deliveryPlace}${appt(load.deliveryTime)}. `
      + 'Are you good for delivery? What is your ETA?' + sign;
  }
  const chargeBack = `The paperwork must be sent within ${PAPERWORK_DUE_HOURS} hours of delivery, or the customer can charge back.`;
  if (kind === 'podReminder') {
    return `${hello}\n\nReminder: I still need the signed POD / paperwork for ${bill} delivered in ${deliveryPlace}. ${chargeBack} `
      + 'Please reply to this email today with a clear photo or scan of it.' + sign;
  }
  return `${hello}\n\nThank you for delivering ${bill} in ${deliveryPlace}! Please send the signed POD as soon as you can. `
    + `Just reply to this email with a clear photo or scan of it. ${chargeBack}` + sign;
}

// The customer email that goes with the driver's POD files (reply-all on their tracking thread).
function buildPaperworkEmail(load, tracking = {}, { greetingName = '', phone = '' } = {}) {
  const hello = greetingName ? `Hi ${greetingName},` : 'Hi,';
  const place = tracking.deliveryCity || [titleCase(load.destCity), load.destSt].filter(Boolean).join(', ');
  return `${hello}\n\nAttached is the signed POD / paperwork for order #${load.id}${place ? `, delivered in ${place}` : ''}. `
    + `Please let me know if you need anything else.\n\nThank you!\n\n${paramountSignature(phone)}`;
}

// Records a sent (or skipped) driver email on the load, with a line in its notes.
function markDriverEmail(load, kind, { at = new Date().toISOString(), skipped = false } = {}) {
  const line = `Driver email ${skipped ? 'skipped' : 'sent'}: ${driverEmailLabels[kind] || kind}`;
  return {
    ...load,
    driverEmails: {
      ...(load.driverEmails || {}),
      [kind]: {
        at, ...(skipped ? { skipped: true } : {}),
        // Tracking reminders repeat: count every one (sent or skipped) so they stay spaced out.
        ...(kind === 'trackingReminder' ? { count: (load.driverEmails?.trackingReminder?.count || 0) + 1 } : {})
      }
    },
    notes: load.notes ? `${load.notes}\n${line}` : line
  };
}

// ---------- Trucker Tools tracking confirmation (Paramount) ----------
// noreply@truckertools.com emails "Load Track has been started - Load Number: <order #>" once
// the driver starts tracking. Until it comes, the driver gets a reminder in the BCO thread:
// the first one 45 minutes after the first driver email, then every 90 minutes, only between
// 7 AM and 9 PM, only from 24 hours before pickup until delivery, at most 6 reminders.
const TRACKING_REMINDER_FIRST_MINUTES = 45;
const TRACKING_REMINDER_EVERY_MINUTES = 90;
const TRACKING_REMINDER_START_HOUR = 7;
const TRACKING_REMINDER_END_HOUR = 21;
const TRACKING_REMINDER_MAX = 6;

// The time of the Trucker Tools "tracking started" email for this load (same load number), or ''.
function findTruckerToolsStart(load, starts) {
  const id = String(load?.id || '').trim();
  if (!id) return '';
  return (starts || []).filter(item => String(item.loadNumber) === id).map(item => item.at).sort()[0] || '';
}

function markTrackingStarted(load, at, { byHand = false } = {}) {
  const line = byHand ? 'Trucker Tools tracking marked started by hand' : `Trucker Tools tracking started ${formatCheckTime(at)} (email from Trucker Tools)`;
  return { ...load, trackingStartedAt: at, ...(byHand ? { trackingStartedByHand: true } : {}), notes: load.notes ? `${load.notes}\n${line}` : line };
}

// True when a "please start Trucker Tools" reminder should go to the driver now.
function isTrackingReminderDue(load, customer, tracking = {}, now = Date.now()) {
  if (!hasPickupDayStarted(load, now)) return false;
  if (!isParamountTrackingCustomer(customer) || load.status !== 'BOOKED' || !tracking.freightBill || load.trackingStartedAt) return false;
  if (tracking.deliveredAt || load.trackingStage === 'Delivered') return false;
  const sent = load.driverEmails || {};
  // Waits for the first driver email (the one that asks to turn the app on).
  const first = Object.entries(sent)
    .filter(([kind, item]) => kind !== 'trackingReminder' && !item?.skipped && Date.parse(item?.at))
    .map(([, item]) => Date.parse(item.at)).sort((a, b) => a - b)[0];
  if (!first) return false;
  const hour = new Date(now).getHours();
  if (hour < TRACKING_REMINDER_START_HOUR || hour >= TRACKING_REMINDER_END_HOUR) return false;
  const pickupAt = parseScheduleStart(load.pickupTime);
  if (pickupAt && now < atHourOf(pickupAt, 0)) return false;
  const reminder = sent.trackingReminder;
  if ((reminder?.count || 0) >= TRACKING_REMINDER_MAX) return false;
  const last = Math.max(first, Date.parse(reminder?.at) || 0);
  const wait = reminder ? TRACKING_REMINDER_EVERY_MINUTES : TRACKING_REMINDER_FIRST_MINUTES;
  return now - last >= wait * 60000;
}

// The tracking line on a Paramount load's card, or null for other customers.
function getTruckerToolsStatus(load, customer, now = Date.now()) {
  if (!isParamountTrackingCustomer(customer)) return null;
  if (!hasPickupDayStarted(load, now)) return null;
  if (load.trackingStartedAt) {
    return { level: 'ok', text: `Tracking started ${formatCheckTime(load.trackingStartedAt)}${load.trackingStartedByHand ? ' (marked by hand)' : ''}` };
  }
  if (load.trackingStage === 'Delivered') return null;
  const count = load.driverEmails?.trackingReminder?.count || 0;
  if (count >= TRACKING_REMINDER_MAX) return { level: 'late', text: `No Trucker Tools tracking yet · ${count} reminders sent · call the driver` };
  return { level: 'waiting', text: `Waiting for Trucker Tools tracking${count ? ` · reminder ${count} sent ${formatCheckTime(load.driverEmails.trackingReminder.at)}` : ''}` };
}

// Ctrl+V of a picture: which list it is. Para lists come from Heather in Google Chat:
// the account ending in H is hazmat, the other one non-hazmat.
const pasteImportChoices = [
  { label: 'Para 1522166 - ATZ · non-hazmat list', customer: 'Para 1522166 - ATZ', className: 'bg-sky-700 hover:bg-sky-600' },
  { label: 'Para 1522166 - ATZ H · hazmat list', customer: 'Para 1522166 - ATZ H', className: 'bg-red-700 hover:bg-red-600' },
  { label: 'NTG load cards', customer: '', className: 'bg-slate-700 hover:bg-slate-600' }
];

// ---------- Driver ETA -> Paramount ----------
function getPendingDriverStatusReply(load, replies, now = Date.now()) {
  if (!hasPickupDayStarted(load, now)) return null;
  const latest = (replies || []).filter(reply => ['arrived', 'loaded', 'departed', 'delivered'].includes(reply.status)
    && Date.parse(reply.at) <= now && now - Date.parse(reply.at) <= 24 * 3600000)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (!latest || (load.customerStatusReplyIds || []).includes(latest.id)) return null;
  if (Date.parse(latest.at) <= Date.parse(load.customerStatusReportedAt)) return null;
  return latest;
}

// A driver's reply like "ETA 11 to 11:30 AM" or "I'll be there at 1130": the ETA, or ''.
// Only the driver's own words count (the quoted email below "On ... wrote:" is cut off), and a
// time needs AM/PM or the word ETA next to it, so dates and appointment windows aren't taken.
function findDriverEta(text) {
  const own = String(text || '').split(/\bOn\b[^\n]{0,120}\bwrote:|-{2,}\s*Original Message|\bFrom:\s|Sent from my|Get Outlook for/i)[0];
  const ampm = value => String(value || '').toUpperCase().replace(/\./g, '');
  const time = (hour, minute) => `${Number(hour)}:${minute || '00'}`;
  const range = own.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|to|and)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i);
  if (range && Number(range[1]) <= 12 && Number(range[4]) <= 12) {
    const first = `${time(range[1], range[2])}${range[3] && ampm(range[3]) !== ampm(range[6]) ? ` ${ampm(range[3])}` : ''}`;
    return `${first} to ${time(range[4], range[5])} ${ampm(range[6])}`;
  }
  const single = own.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i);
  if (single && Number(single[1]) <= 12) return `${time(single[1], single[2])} ${ampm(single[3])}`;
  const military = own.match(/\beta\b[^\d\n]{0,15}(\d{1,2}):?(\d{2})\b/i);
  if (military && Number(military[1]) <= 23 && Number(military[2]) <= 59) return `${String(military[1]).padStart(2, '0')}:${military[2]}`;
  return '';
}

// The email to Paramount's thread with the ETA the driver gave (pickup, or delivery once loaded).
function buildParamountEtaEmail(load, tracking = {}, eta, { greetingName = '', phone = '' } = {}) {
  const hello = greetingName ? `Hi ${greetingName} and team,` : 'Hello team,';
  const loaded = Boolean(tracking.leftShipperAt) || ['Loaded', 'In Transit', 'At Delivery'].includes(load.trackingStage);
  const place = loaded
    ? tracking.deliveryCity || [titleCase(load.destCity), load.destSt].filter(Boolean).join(', ')
    : tracking.pickupCity || [titleCase(load.origCity), load.origSt].filter(Boolean).join(', ');
  const link = tracking.trackingLink ? `\n\nLive tracking: ${tracking.trackingLink}` : '';
  return `${hello}\n\nQuick update on order ${load.id}: our driver confirmed an ETA of ${eta} to the ${loaded ? 'receiver' : 'shipper'} in ${place}.`
    + `${link}\n\nWe'll keep you posted. Thank you!\n\n${paramountSignature(phone)}`;
}

// ---------- MercuryGate (Landstar's TMS) for booked Paramount loads ----------
// The helper bot fills MercuryGate the way Daniel does by hand (bot/mercurygate-job.js):
// "booked": Customer Reference Number, pickup + drop from the rate confirmation PDF, special
// instructions; "pickedUp": upload the PDF as a Customer Confirmation Sheet. Loads booked before
// the bot started doing this (MERCURYGATE_FROM) were entered by hand and are left alone.
const BOT_MERCURYGATE_URL = 'http://127.0.0.1:47615/mercurygate';
const MERCURYGATE_FROM = Date.parse('2026-11-06T16:55:00Z');
const mercurygateSeenKey = 'landstar_mercurygateSeenAt';

// The MercuryGate step due for a booked Paramount load, or ''.
// The number MercuryGate is searched by: the Landstar freight bill (from Clarity / the BCO email)
// or, right after booking, the Landstar load number from Assign Capacity (also a reference there).
function getMercuryGateSearchNumber(load, tracking = {}) {
  return String(tracking.freightBill || (load.landstarAssignment?.ok ? load.landstarAssignment.landstarLoadId : '') || '');
}

function getDueMercuryGateStep(load, tracking = {}) {
  if (!automationPolicy.automaticDispatchEnabled) return '';
  if (load.status !== 'BOOKED' || !getMercuryGateSearchNumber(load, tracking)) return '';
  if (!(Date.parse(load.bookedAt) >= MERCURYGATE_FROM)) return '';
  const done = load.mercurygate || {};
  if (!done.booked) return 'booked';
  if (tracking.leftShipperAt && !done.pickedUp) return 'pickedUp';
  return '';
}

// The load's notes after the bot's MercuryGate run.
function applyMercuryGateResult(load, result) {
  const lines = (result.results || []).map(item => `MercuryGate: ${item.message}`);
  if (!result.ok && result.retrying) lines.push(`MercuryGate: not finished yet, trying again - ${String(result.message || '').split('\n')[0]}`);
  else if (!result.ok) lines.push(`MercuryGate: NOT finished - ${String(result.message || '').split('\n')[0]}. Finish it by hand.`);
  return {
    ...load,
    mercurygate: { ...(load.mercurygate || {}), [`${result.step}Result`]: { ok: Boolean(result.ok), at: result.at } },
    notes: [load.notes, ...lines].filter(Boolean).join('\n')
  };
}

// ---------- RXO update requests ----------
// RXO tracking emails "Update Request - Order # <order#>" or "Order # <order#>" asking where
// the truck is. For booked loads of R X O 2429200 - ATZ, - ATZ P and - ATZ V, the TMS drafts a
// reply-all with the status and location from Clarity, the pickup ETA Daniel typed (never
// Clarity's), the delivery ETA once loaded, and the tracking link. The first few wait for
// a Send click; after that a reply goes out on its own only when nothing is missing.
const rxoTrackingCustomers = new Set(['RXO2429200ATZ', 'RXO2429200ATZP', 'RXO2429200ATZV']);
const rxoApprovedKey = 'landstar_rxoApprovedSends';
const rxoHandledKey = 'landstar_rxoHandledRequests';
const RXO_ETA_BLANK = '____';

function isRxoTrackingCustomer(name) {
  return rxoTrackingCustomers.has(normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, ''));
}

// Booked RXO loads with a truck, for the bot to find in Clarity.
function getRxoWatchList(customerOrdersMap, now = Date.now()) {
  return Object.entries(customerOrdersMap || {})
    .filter(([customer]) => isRxoTrackingCustomer(customer))
    .flatMap(([customer, loads]) => (loads || [])
      .filter(load => load.status === 'BOOKED' && String(load.truck || '').trim()
        && load.trackingStage !== 'Delivered'
        && (!Date.parse(load.bookedAt) || now - Date.parse(load.bookedAt) < PARAMOUNT_WATCH_DAYS * 86400000))
      .map(load => ({
        key: `${customer}|${load.id}`, customer, loadId: String(load.id), truck: String(load.truck).trim(),
        pickupCity: load.origCity || '', pickupState: load.origSt || '', billTo: 'rxo'
      })));
}

// The booked RXO load an update request is about (same order number), or null.
function getEmailPostingCode(load, profilePostingCode = '') {
  return String(load?.postingCode || profilePostingCode || '').trim().toUpperCase();
}

function getRxoEmailPostingCodes(map, profilePostingCode = '') {
  const codes = {};
  for (const [customer, loads] of Object.entries(map || {})) {
    if (!isRxoTrackingCustomer(customer)) continue;
    for (const load of loads || []) {
      const order = String(load.id).trim();
      const code = getEmailPostingCode(load, profilePostingCode);
      codes[order] = Object.prototype.hasOwnProperty.call(codes, order) && codes[order] !== code ? '' : code;
    }
  }
  return codes;
}

function findRxoLoadForRequest(customerOrdersMap, orderNumber) {
  const order = String(orderNumber || '').trim();
  for (const [customer, loads] of Object.entries(customerOrdersMap || {})) {
    if (!isRxoTrackingCustomer(customer)) continue;
    const load = (loads || []).find(item => String(item.id).trim() === order && item.status === 'BOOKED');
    if (load) return { customer, load };
  }
  return null;
}

// The reply to an RXO update request. complete = nothing left to fill in (may send on its own).
function buildRxoUpdateEmail(load, tracking = {}, { phone = '', availableOnly = false } = {}) {
  if (availableOnly) {
    const lines = [];
    const delivered = Boolean(load.deliveredAt) || load.trackingStage === 'Delivered';
    const departed = Boolean(tracking.leftShipperAt) || ['In Transit', 'At Delivery'].includes(load.trackingStage);
    if (delivered) lines.push('The load is marked delivered.');
    else if (load.trackingStage === 'At Delivery') lines.push('The driver is at the receiver.');
    else if (departed) lines.push('The driver has left the shipper and is in transit.');
    else if (load.trackingStage === 'Loaded') lines.push('The truck is loaded. Departure has not been confirmed.');
    else if (tracking.arrivedShipperAt || load.trackingStage === 'At Pickup') lines.push('The driver is at the shipper.');
    else lines.push('Current shipment status has not yet been confirmed.');
    if (tracking.lastLocation) {
      const asOf = formatParamountTime(tracking.lastLocationAt || tracking.checkedAt, tracking.pickupTimezone);
      lines.push(`Last reported location: ${tracking.lastLocation}${asOf ? ` (as of ${asOf})` : ''}.`);
    }
    if (!delivered) {
      if (departed || load.trackingStage === 'Loaded') {
        const eta = formatParamountTime(tracking.deliveryEta, tracking.deliveryTimezone);
        lines.push(eta ? `Reported delivery ETA: ${eta}.` : 'Delivery ETA has not yet been confirmed.');
      } else {
        lines.push(String(load.pickupEta || '').trim()
          ? `Reported pickup ETA: ${String(load.pickupEta).trim()}.` : 'Pickup ETA has not yet been confirmed.');
      }
    }
    if (tracking.trackingLink) lines.push(`Live tracking: ${tracking.trackingLink}`);
    return {
      text: `Hello team,\n\nLatest available update for order ${load.id}:\n\n${lines.join('\n')}\n\n${paramountSignature(phone)}`,
      complete: true
    };
  }
  const order = String(load.id);
  const known = Boolean(tracking.freightBill);
  const pickupPlace = tracking.pickupCity || [titleCase(load.origCity), load.origSt].filter(Boolean).join(', ');
  const deliveryPlace = tracking.deliveryCity || [titleCase(load.destCity), load.destSt].filter(Boolean).join(', ');
  const loaded = Boolean(tracking.leftShipperAt) || ['Loaded', 'In Transit', 'At Delivery'].includes(load.trackingStage);
  const atShipper = !loaded && (Boolean(tracking.arrivedShipperAt) || load.trackingStage === 'At Pickup');
  const typedEta = String(load.pickupEta || '').trim();
  const lines = [];
  if (loaded) lines.push(`The truck is loaded and on the way to ${deliveryPlace}.`);
  else if (atShipper) lines.push(`The driver is at the shipper in ${pickupPlace}.`);
  else lines.push(`The driver is empty and heading to the shipper in ${pickupPlace}.`);
  if (tracking.lastLocation) {
    const asOf = formatParamountTime(tracking.lastLocationAt, tracking.pickupTimezone);
    lines.push(`Current location: ${tracking.lastLocation}${asOf ? ` (as of ${asOf})` : ''}`);
  }
  if (!loaded && !atShipper) lines.push(`Pickup ETA: ${typedEta || RXO_ETA_BLANK}`);
  if (loaded) {
    const deliveryEta = formatParamountTime(tracking.deliveryEta || tracking.deliveryScheduled, tracking.deliveryTimezone);
    if (deliveryEta) lines.push(`Delivery ETA: ${deliveryEta}`);
  }
  if (tracking.trackingLink) lines.push(`Live tracking: ${tracking.trackingLink}`);
  const text = `Hello team,\n\nThank you for checking in on order ${order}.\n\n${lines.join('\n')}\n\n`
    + `Please let us know if you need anything else.\n\n${paramountSignature(phone)}`;
  const complete = known && Boolean(tracking.trackingLink) && Boolean(tracking.lastLocation)
    && (loaded || atShipper || Boolean(typedEta));
  return { text, complete };
}

function readRxoHandled() {
  try {
    const parsed = JSON.parse(localStorage.getItem(rxoHandledKey));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function markRxoHandled(messageId) {
  try { localStorage.setItem(rxoHandledKey, JSON.stringify([...readRxoHandled(), messageId].slice(-300))); } catch { /* asked again next time */ }
}

function readApprovedCount(key) {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}

// "Heather Locke <heather.locke@rlglobal.com>" -> "Heather"
function greetingNameFrom(address) {
  const name = String(address || '').replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  const first = name.includes(',') ? name.split(',')[1]?.trim().split(/\s+/)[0] : name.split(/\s+/)[0];
  return /^[A-Za-z][A-Za-z'-]+$/.test(first || '') && !/@/.test(name) ? titleCase(first) : '';
}

// Hands the queue to the bot; returns how many it accepted (0 if the bot is off).
async function sendUnpostQueueToBot() {
  const queue = readUnpostQueue();
  if (!queue.length) return 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(BOT_UNPOST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postings: queue }),
      signal: controller.signal
    });
    if (!response.ok) return 0;
    const sent = new Set(queue.map(item => `${item.customer}|${item.loadId}`));
    writeUnpostQueue(readUnpostQueue().filter(item => !sent.has(`${item.customer}|${item.loadId}`)));
    return queue.length;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}
const botStatusStyles = {
  'logged-in': { label: 'Bot logged in', dot: '#22c55e', glow: '0 0 8px #22c55e' },
  uploading: { label: 'Bot uploading', dot: '#22c55e', glow: '0 0 8px #22c55e' },
  'signing-in': { label: 'Bot signing in…', dot: '#facc15', glow: '0 0 8px #facc15' },
  starting: { label: 'Bot starting…', dot: '#facc15', glow: '0 0 8px #facc15' },
  off: { label: 'Bot off', dot: '#64748b', glow: 'none' }
};

// The local TMS (npm run dev) can start the bot; the live site can only show its status.
const BOT_START_URL = '/api/bot/start';
const BOT_START_GRACE_MS = 45_000;
const canStartBotHere = () => typeof window !== 'undefined'
  && ['127.0.0.1', 'localhost'].includes(window.location.hostname);

export function BotStatusLight() {
  const [status, setStatus] = useState({ state: 'off', message: 'Upload bot is not running' });
  const startRequestedAt = useRef(0);
  const offStatus = () => (Date.now() - startRequestedAt.current < BOT_START_GRACE_MS
    ? { state: 'starting', message: 'Opening the bot window…' }
    : { state: 'off', message: 'Upload bot is not running' });
  useEffect(() => {
    if (!canStartBotHere()) return undefined;
    let cancelled = false;
    const check = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch(BOT_STATUS_URL, { cache: 'no-store', signal: controller.signal });
        const next = await response.json();
        if (!cancelled) setStatus(botStatusStyles[next.state] ? next : offStatus());
        // Assign Capacity results for booked loads: the TMS adds them to the load's notes.
        takeNewAssignResults(next.assignResults).forEach(result => {
          window.dispatchEvent(new CustomEvent('landstar-assign-result', { detail: result }));
        });
        // MercuryGate results (helper bot) -> load notes.
        let mgSeen = 0;
        try { mgSeen = Number(localStorage.getItem(mercurygateSeenKey)) || 0; } catch { /* first time */ }
        const mgFresh = (Array.isArray(next.mercurygateResults) ? next.mercurygateResults : []).filter(result => Number(result.at) > mgSeen && result.mode === 'save');
        if (mgFresh.length) {
          try { localStorage.setItem(mercurygateSeenKey, String(Math.max(...mgFresh.map(result => Number(result.at))))); } catch { /* shown again */ }
          mgFresh.forEach(result => window.dispatchEvent(new CustomEvent('landstar-mercurygate-result', { detail: result })));
        }
        // Clarity results for booked Paramount loads (tracking emails).
        (Array.isArray(next.trackingResults) ? next.trackingResults : []).forEach(result => {
          if (paramountResultSeen.get(result.key) === result.at) return;
          paramountResultSeen.set(result.key, result.at);
          window.dispatchEvent(new CustomEvent('landstar-tracking-result', { detail: result }));
        });
        // Freight bills the helper found duplicated in MercuryGate -> a warning banner.
        (Array.isArray(next.duplicateBills) ? next.duplicateBills : []).forEach(duplicate => {
          if (duplicateBillSeen.get(duplicate.bill) === duplicate.at) return;
          duplicateBillSeen.set(duplicate.bill, duplicate.at);
          window.dispatchEvent(new CustomEvent('landstar-duplicate-bill', { detail: duplicate }));
        });
        (Array.isArray(next.postingRefresh) ? next.postingRefresh : []).forEach(issue => {
          window.dispatchEvent(new CustomEvent('landstar-refresh-issue', { detail: issue }));
        });
      } catch {
        if (!cancelled) setStatus(offStatus());
      } finally {
        clearTimeout(timer);
      }
    };
    check();
    const interval = setInterval(check, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);
  const startBot = async () => {
    startRequestedAt.current = Date.now();
    setStatus({ state: 'starting', message: 'Opening the bot window…' });
    try {
      const response = await fetch(BOT_START_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'The bot could not be started.');
    } catch (error) {
      startRequestedAt.current = 0;
      setStatus({ state: 'off', message: 'Upload bot is not running' });
      alert(`${error.message || 'The bot could not be started.'}\n\nYou can also double-click "Start Landstar Bot.bat" in the bot folder.`);
    }
  };
  if (!canStartBotHere()) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs normal-case tracking-normal" role="status">
        <span className="rounded border border-amber-600 bg-slate-800 px-2.5 py-1 text-amber-200"
          title="The shared website cannot start or monitor Landstar bots on another computer. Each worker needs the local Windows TMS and a Landstar sign-in.">
          Landstar bots: local computer required
        </span>
        <span className="text-slate-300">Posting / Helper / Rates / Removals are not hosted on this website.</span>
      </span>
    );
  }
  const style = botStatusStyles[status.state] || botStatusStyles.off;
  const clickable = status.state === 'off' && canStartBotHere();
  const dot = (
    <span
      aria-hidden="true"
      style={{ width: 10, height: 10, borderRadius: '50%', background: style.dot, boxShadow: style.glow, display: 'inline-block' }}
    />
  );
  if (clickable) {
    return (
      <span className="inline-flex items-center gap-1.5 max-w-full">
      <button
        type="button"
        onClick={startBot}
        className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs px-2.5 py-1 rounded font-medium normal-case tracking-normal cursor-pointer border border-slate-600"
        title="The upload bot is off. Click to start it (a bot window opens; log in to Landstar if asked)."
      >
        {dot}
        Bot off · Start bot
      </button>
      <RateWorkerLight />
      </span>
    );
  }
  const detail = status.state === 'off' ? '' : describeBotProgress(status);
  return (
    <span className="inline-flex items-center gap-1.5 max-w-full">
      <span
        className="inline-flex items-center gap-1.5 bg-slate-800 text-white text-xs px-2.5 py-1 rounded font-medium normal-case tracking-normal max-w-full"
        title={[style.label, detail].filter(Boolean).join(' · ') || status.message}
        role="status"
        aria-live="polite"
      >
        {dot}
        {style.label}
        {detail && <span className="text-slate-300 font-normal truncate max-w-[22rem]">· {detail}</span>}
      </span>
      {status.helper && <HelperBotLight helper={status.helper} />}
      <RateWorkerLight />
      {status.removal && (
        <span
          role="status"
          title={status.removal.message}
          className="inline-flex items-center bg-slate-800 text-white text-xs px-2.5 py-1 rounded"
        >
          Removals: {status.removal.state === 'off' ? 'off' : status.removal.message}
        </span>
      )}
    </span>
  );
}

function describeRateWorker(status) {
  if (status.state === 'off') return 'Rate worker off';
  if (status.state === 'signing-in') return 'Rate worker: sign in to Landstar';
  if (status.state === 'starting') return 'Rate worker starting';
  if (status.state === 'blocked') return 'Rate worker: needs attention';
  if (status.state === 'working') return 'Rate worker: checking';
  return status.state === 'logged-in' ? 'Rate worker on' : 'Rate worker: status unavailable';
}

function RateWorkerLight() {
  const [status, setStatus] = useState({ state: 'off', message: 'Rate worker is not running' });
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (!canStartBotHere()) return undefined;
    let cancelled = false;
    let timer;
    const check = async () => {
      try {
        const response = await fetch('/api/rates/status', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error(`Rate-worker status returned HTTP ${response.status}`);
        const next = await response.json();
        if (!cancelled) { setStatus(next); setError(''); }
      } catch (failure) {
        if (!cancelled) setError(`Rate-worker status unavailable: ${failure.message}`);
      } finally {
        if (!cancelled) timer = setTimeout(check, 5000);
      }
    };
    void check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  if (!canStartBotHere()) return null;
  const start = async () => {
    setStarting(true);
    setError('');
    try {
      const response = await fetch('/api/rates/start', { method: 'POST', signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not start the rate worker.');
      setStatus({ state: 'starting', message: 'Opening rate-worker browser; sign in if asked' });
    } catch (failure) {
      setError(failure.message);
    } finally { setStarting(false); }
  };
  const label = starting ? 'Rate worker starting' : describeRateWorker(status);
  return (
    <details className="relative normal-case tracking-normal text-left text-xs" aria-label="Rate worker">
      <summary className="bg-slate-800 border border-slate-600 rounded px-2.5 py-1 cursor-pointer">
        <span role="status">{error ? 'Rate worker: needs attention' : label}</span>
      </summary>
      <div className="absolute right-0 bottom-full mb-2 z-50 w-72 max-w-[90vw] bg-slate-900 border border-slate-600 rounded p-3 shadow-xl space-y-2">
        <p>{error || status.message}</p>
        <p>Prepares export rates using the Landstar board. DAT API quotes remain in the TMS. This worker never uploads loads.</p>
        {status.state === 'off' && <button type="button" disabled={starting} onClick={start} className="bg-blue-600 rounded px-3 py-1 disabled:opacity-50">Start rate worker</button>}
      </div>
    </details>
  );
}

// The helper bot (bot/helper.js): Assign Capacity, Clarity and MercuryGate in its own window.
// Its state comes through the main bot's status; when it's off, a click starts it.
function HelperBotLight({ helper }) {
  const [starting, setStarting] = useState(0);
  const state = helper?.state || 'off';
  const isOn = state === 'logged-in' || state === 'working';
  const color = isOn ? '#22c55e' : state === 'signing-in' || (starting && Date.now() - starting < 60000) ? '#facc15' : '#64748b';
  const dot = <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: color === '#64748b' ? 'none' : `0 0 8px ${color}`, display: 'inline-block' }} />;
  const label = isOn ? `Helper ${state === 'working' ? `· ${helper.message || 'working'}` : 'on'}`
    : state === 'signing-in' ? 'Helper · sign in to Landstar in its window' : starting ? 'Helper starting…' : 'Helper off · Start';
  if (!isOn && state !== 'signing-in' && canStartBotHere()) {
    return (
      <button
        type="button"
        onClick={async () => {
          setStarting(Date.now());
          try {
            const response = await fetch('/api/helper/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'The helper bot could not be started.');
          } catch (error) {
            setStarting(0);
            alert(`${error.message}\n\nYou can also double-click "Start Helper Bot.bat" in the bot folder.`);
          }
        }}
        title="The helper bot does Assign Capacity, Clarity checks and MercuryGate so the main bot can keep uploading. Click to start it."
        className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs px-2.5 py-1 rounded font-medium normal-case tracking-normal cursor-pointer border border-slate-600"
      >
        {dot}
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 bg-slate-800 text-white text-xs px-2.5 py-1 rounded font-medium normal-case tracking-normal" title={helper?.message || label} role="status">
      {dot}
      {label}
    </span>
  );
}

// The bot light's progress line: files uploaded / still waiting, and what the bot is on.
// "Rate-checking R_X_O_2429200___ATZ_9of108" -> "12 uploaded · 94 waiting · Rate-checking file 9 of 108"
function describeBotProgress(status) {
  const parts = [];
  const progress = status?.progress;
  if (progress && (progress.uploaded > 0 || progress.waiting > 0)) {
    parts.push(`${progress.uploaded} uploaded`);
    if (progress.waiting > 0) parts.push(`${progress.waiting} waiting`);
  }
  // Export file names end in "_26of108": show that as "file 26 of 108".
  const message = String(status?.message || '').trim().replace(/\S*?(\d+)of(\d+)\b/, 'file $1 of $2');
  if (/^(Rate-checking|Uploading|Removing|Checking|Waiting for the rate worker|Uploads paused)/i.test(message)) parts.push(message);
  return parts.join(' · ');
}

export default function App({ sharing = null } = {}) {
  const [brokers, setBrokers] = useState(() => {
    try {
      return normalizeBrokerList(JSON.parse(localStorage.getItem('landstar_brokers')));
    } catch (error) {
      console.error('Could not load saved customer names:', error);
      return normalizeBrokerList(null);
    }
  });
  
  const [selectedBroker, setSelectedBroker] = useState(() => {
    try {
      const savedBrokers = JSON.parse(localStorage.getItem('landstar_brokers'));
      return normalizeBrokerList(savedBrokers)[0] || 'Para 1522166 - ATZ';
    } catch (error) {
      console.error('Could not load the selected customer:', error);
      return 'Para 1522166 - ATZ';
    }
  });
  
  const [customerOrdersMap, setCustomerOrdersMap] = useState(() => {
    try {
      return removeExpiredExportedLoads(
        normalizeCustomerOrders(JSON.parse(localStorage.getItem('landstar_customerOrdersMap')))
      );
    } catch (error) {
      console.error('Could not load saved customer loads:', error);
      return defaultCustomerDatasets;
    }
  });
  const [laneRates, setLaneRates] = useState(() => {
    try {
      const savedRates = JSON.parse(localStorage.getItem('landstar_laneRates'));
      return savedRates && typeof savedRates === 'object' && !Array.isArray(savedRates) ? savedRates : {};
    } catch (error) {
      console.error('Could not load saved lane rates:', error);
      return {};
    }
  });
  const [rateHistory, setRateHistory] = useState(() => readRateHistory());

  // One-time seed: pre-existing saved lane rates become undated history entries.
  useEffect(() => {
    if (rateHistory.length || localStorage.getItem(rateHistoryKey)) return;
    const seeded = seedRateHistoryFromLaneRates(laneRates);
    if (!seeded.length) return;
    try {
      writeSyncedKey(rateHistoryKey, JSON.stringify(seeded));
    } catch (error) {
      console.error('Could not save rate history:', error);
    }
    setRateHistory(seeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [exportedLoadRegistry, setExportedLoadRegistry] = useState(() => {
    try {
      const savedRegistry = JSON.parse(localStorage.getItem('landstar_exportedLoads'));
      return savedRegistry && typeof savedRegistry === 'object' && !Array.isArray(savedRegistry)
        ? savedRegistry
        : {};
    } catch (error) {
      console.error('Could not load previously exported load records:', error);
      return {};
    }
  });
  
  const orders = customerOrdersMap[selectedBroker] || [];
  const [selectedOrder, setSelectedOrder] = useState(() => orders[0] || null);

  const [filter, setFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadFilters, setLoadFilters] = useState({ rate: '', minMiles: '', maxMiles: '', pickupState: '', deliveryState: '', pickupDate: '' });
  const [laneSort, setLaneSort] = useState('');
  const [showTools, setShowTools] = useState(true);
  const [showCustomers, setShowCustomers] = useState(true);
  const [showHeader, setShowHeader] = useState(true);
 
  const [isAddingBroker, setIsAddingBroker] = useState(false);
  const [newBrokerInput, setNewBrokerInput] = useState('');
 
  const [editingBroker, setEditingBroker] = useState(null);
  const [editBrokerInput, setEditBrokerInput] = useState('');

  const [selectedIds, setSelectedIds] = useState([]);
  const [exportErrorIds, setExportErrorIds] = useState([]);
  const [isImportingScreenshot, setIsImportingScreenshot] = useState(false);
  const [screenshotImportMode, setScreenshotImportMode] = useState('');
  const [screenshotImportProgress, setScreenshotImportProgress] = useState('');
  const [isGmailImportOpen, setIsGmailImportOpen] = useState(false);
  const [gmailClientId, setGmailClientId] = useState(() => {
    try {
      return localStorage.getItem('landstar_gmailClientId') || '';
    } catch (error) {
      console.error('Could not load the saved Google client ID:', error);
      return '';
    }
  });
  const [gmailQuery, setGmailQuery] = useState('');
  const [gmailAuthReady, setGmailAuthReady] = useState(false);
  const [gmailImportProgress, setGmailImportProgress] = useState('');
  const [storageError, setStorageError] = useState('');
  const [profile, setProfile] = useState(getUserProfile);
  const [profileDraft, setProfileDraft] = useState(null);
  const [sharedCustomers, setSharedCustomers] = useState(() => sharing?.getSharedCustomers() || {});
  const [shareCustomerName, setShareCustomerName] = useState(null);
  const [teammates, setTeammates] = useState([]);
  const [shareSelection, setShareSelection] = useState([]);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  // Keep these last: tests address earlier state hooks by position.
  const [view, setView] = useState('loads');
  const [clock, setClock] = useState(() => Date.now());
  const [inquiries, setInquiries] = useState([]);
  const [showInquiries, setShowInquiries] = useState(false);
  const [locationData, setLocationData] = useState(null);

  const getLatestExportedRegistry = () => {
    try {
      const storedRegistry = JSON.parse(localStorage.getItem('landstar_exportedLoads'));
      return storedRegistry && typeof storedRegistry === 'object' && !Array.isArray(storedRegistry)
        ? storedRegistry
        : exportedLoadRegistry;
    } catch (error) {
      console.error('Could not read the latest exported-load history:', error);
      return exportedLoadRegistry;
    }
  };

  const persistAppData = (nextBrokers = brokers, nextOrders = customerOrdersMap) => {
    try {
      initSyncGuardFromStorage();
      const versions = readDataVersions();
      const brokersStale = (versions.landstar_brokers || 0) > (lastSavedVersions.landstar_brokers || 0);
      const ordersStale = (versions.landstar_customerOrdersMap || 0) > (lastSavedVersions.landstar_customerOrdersMap || 0);
      if (brokersStale || ordersStale) {
        // Another tab or device saved newer data since this tab's state was last synced.
        // Adopt it instead of overwriting it with this tab's older state.
        setStorageError('Newer data was saved from another tab or device, so the list was refreshed.');
        if (reloadSavedDataFn) reloadSavedDataFn();
        return true;
      }
      const brokersValue = JSON.stringify(nextBrokers);
      const ordersValue = JSON.stringify(nextOrders);
      localStorage.setItem('landstar_brokers', brokersValue);
      localStorage.setItem('landstar_customerOrdersMap', ordersValue);
      const nextVersions = {
        ...versions,
        landstar_brokers: (versions.landstar_brokers || 0) + 1,
        landstar_customerOrdersMap: (versions.landstar_customerOrdersMap || 0) + 1
      };
      localStorage.setItem(dataVersionKey, JSON.stringify(nextVersions));
      lastSavedValues.landstar_brokers = brokersValue;
      lastSavedValues.landstar_customerOrdersMap = ordersValue;
      lastSavedVersions.landstar_brokers = nextVersions.landstar_brokers;
      lastSavedVersions.landstar_customerOrdersMap = nextVersions.landstar_customerOrdersMap;
      setStorageError('');
      return true;
    } catch (error) {
      console.error('Could not save customer loads in this browser:', error);
      setStorageError('Could not save changes in this browser. Keep this page open and check available storage.');
      return false;
    }
  };

  useEffect(() => {
    persistAppData();
  }, [brokers, customerOrdersMap]);

  useEffect(() => {
    if (!supabase) return undefined;
    let cancelled = false;
    let applying = false;
    let applyAgain = false;
    const applyEmailLoads = async () => {
      if (applying) {
        applyAgain = true;
        return;
      }
      applying = true;
      try {
        const rows = [];
        let lastId = null;
        while (!cancelled) {
          let query = supabase.from('email_loads').select('id, customer, load')
            .eq('status', 'pending').order('id').limit(100);
          if (lastId !== null) query = query.gt('id', lastId);
          const { data, error } = await query;
          if (error) throw error;
          rows.push(...(data || []));
          if (!data || data.length < 100) break;
          lastId = data[data.length - 1].id;
        }
        if (cancelled || !rows.length) return;
        const latestRates = JSON.parse(localStorage.getItem('landstar_laneRates') || '{}');
        rows.forEach(row => {
          if (!row.load?.id) return;
          const savedRate = getSavedLaneRate(latestRates, row.customer, row.load);
          if (savedRate && (!(Number(row.load.rateInput) > 0) || isDatRateSource(row.load.rateSource))) {
            row.load = { ...row.load, rateInput: savedRate, rateSource: 'user-entered' };
          }
        });
        const emailImportLoads = [];
        rows.forEach(row => {
          if (normalizeCustomerName(row.customer) && row.load?.id) emailImportLoads.push(row.load);
        });
        await applyGoogleRoadMiles(emailImportLoads, null, 'Imported from email');
        if (cancelled) return;
        const fullLists = new Map();
        rows.forEach(row => {
          const customer = normalizeCustomerName(row.customer);
          if (!customer || !row.load?.id) return;
          getImportedLoadKey(row.load);
          const loads = fullLists.get(customer) || [];
          loads.push(row.load);
          fullLists.set(customer, loads);
        });
        setCustomerOrdersMap(current => {
          const next = { ...current };
          fullLists.forEach((loads, customer) => {
            const replacement = replaceImportedCustomerLoads(customer, loads, current[customer] || []);
            next[customer] = replacement.loads;
            // Background import: never asks, so an unusually large drop is skipped instead.
            queueDroppedPostings(replacement, current[customer] || [], { interactive: false });
          });
          return next;
        });
        const validIds = rows.filter(row => normalizeCustomerName(row.customer) && row.load?.id).map(row => row.id);
        if (validIds.length) {
          const { error } = await supabase.from('email_loads').update({ status: 'applied' }).in('id', validIds);
          if (error) throw error;
        }
      } catch (error) {
        console.error('Automatic email load import failed:', error);
        if (!cancelled) setStorageError(`Automatic email import failed: ${error.message || 'Could not update the load list.'}`);
      } finally {
        applying = false;
        if (applyAgain && !cancelled) {
          applyAgain = false;
          applyEmailLoads();
        }
      }
    };
    applyEmailLoads();
    const channel = supabase.channel('email-loads-apply')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'email_loads' }, applyEmailLoads)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  // App only mounts after sign-in (or in local mode), so this greets each agent on login.
  useEffect(() => {
    speakWelcomeGreeting(getUserProfile().postingCode);
  }, []);

  useEffect(() => {
    const cleanupExpiredLoads = () => {
      setCustomerOrdersMap(current => removeExpiredExportedLoads(current));
    };
    const interval = window.setInterval(cleanupExpiredLoads, 60 * 60 * 1000);
    window.addEventListener('focus', cleanupExpiredLoads);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', cleanupExpiredLoads);
    };
  }, []);

  useEffect(() => {
    if (!isGmailImportOpen) return undefined;
    let active = true;
    setGmailAuthReady(false);
    setGmailImportProgress('Loading Google authorization...');
    loadGoogleIdentityScript()
      .then(() => {
        if (active) {
          setGmailAuthReady(true);
          setGmailImportProgress('');
        }
      })
      .catch(error => {
        console.error('Could not initialize Google authorization:', error);
        if (active) setGmailImportProgress(error.message);
      });
    return () => {
      active = false;
    };
  }, [isGmailImportOpen]);

  useEffect(() => {
    if (orders.length > 0) {
      if (!selectedOrder || !orders.some(o => o.id === selectedOrder.id)) {
        setSelectedOrder(orders[0]);
      }
    } else {
      setSelectedOrder(null);
    }
  }, [selectedBroker, customerOrdersMap]);

  const handleSelectBroker = (brokerName) => {
    setSelectedBroker(brokerName);
    const brokerLoads = customerOrdersMap[brokerName] || [];
    if (brokerLoads.length > 0) {
      setSelectedOrder(brokerLoads[0]);
    } else {
      setSelectedOrder(null);
    }
    setSelectedIds([]);
  };

  const handleInputChange = (field, value) => {
    if (!selectedOrder) return;
    if (field === 'id' && orders.some(order => order.id !== selectedOrder.id
      && normalizeLoadId(order.id) === normalizeLoadId(value))) {
      alert(`Load #${value} already exists in ${selectedBroker}. The order number was not changed.`);
      return;
    }
    let updatedOrder = { ...selectedOrder, [field]: value };
    if (['origCity', 'origSt', 'origZip', 'destCity', 'destSt', 'destZip'].includes(field)) {
      updatedOrder = applyLocationInput(selectedOrder, field, value, locationData);
    }
    if (field === 'miles') updatedOrder.milesSource = 'manual';
    if (field === 'driverPhone') updatedOrder = moveToOfferWithDriverPhone(updatedOrder);
    if (field === 'eCode' && isTeamEquipment(selectedOrder.eCode)) {
      updatedOrder.team = 'true';
    }
    if (field === 'rateInput') {
      if (String(value).trim()) {
        updatedOrder.rateSource = 'user-entered';
      } else {
        delete updatedOrder.rateSource;
      }
      const laneRateKey = createLaneRateKey(selectedBroker, updatedOrder);
      const numericRate = Number(String(value).replace(/[$,]/g, ''));
      if (laneRateKey && numericRate > 0 && Number.isFinite(numericRate)) {
        const nextLaneRates = { ...laneRates, [laneRateKey]: String(numericRate) };
        setLaneRates(nextLaneRates);
        setRateHistory(recordRateHistory(selectedBroker, updatedOrder, numericRate, 'manual'));
        try {
          writeSyncedKey('landstar_laneRates', JSON.stringify(nextLaneRates));
        } catch (error) {
          console.error('Could not save lane rate:', error);
          setStorageError('Could not save lane rates in this browser. Check available storage.');
        }
      }
      if (numericRate > 0 && Number.isFinite(numericRate)) {
        setSelectedIds(previousIds => (
          previousIds.includes(updatedOrder.id) ? previousIds : [...previousIds, updatedOrder.id]
        ));
      }
    } else if (['origCity', 'origSt', 'origZip', 'destCity', 'destSt', 'destZip', 'eCode'].includes(field)) {
      const savedRate = getSavedLaneRate(laneRates, selectedBroker, updatedOrder);
      if (savedRate) {
        updatedOrder.rateInput = savedRate;
        updatedOrder.rateSource = 'user-entered';
      } else {
        updatedOrder.rateInput = '';
        delete updatedOrder.rateSource;
      }
    }
    
    setSelectedOrder(updatedOrder);
    setCustomerOrdersMap(prev => ({
      ...prev,
      [selectedBroker]: (prev[selectedBroker] || []).map(o => o.id === selectedOrder.id ? updatedOrder : o)
    }));
    if (field === 'id') {
      setSelectedIds(ids => ids.map(id => id === selectedOrder.id ? updatedOrder.id : id));
    }
  };

  const handleOpenDatRateView = async () => {
    if (!selectedOrder) return;
    const origin = [selectedOrder.origCity, selectedOrder.origSt, selectedOrder.origZip].filter(Boolean).join(', ');
    const destination = [selectedOrder.destCity, selectedOrder.destSt, selectedOrder.destZip].filter(Boolean).join(', ');
    const equipment = getEquipmentDescription(selectedOrder.eCode) || selectedOrder.eCode || 'Not specified';
    const laneDetails = [
      `Customer: ${selectedBroker}`,
      `Origin: ${origin || 'Not specified'}`,
      `Destination: ${destination || 'Not specified'}`,
      `Equipment: ${equipment}`,
      `Pickup: ${selectedOrder.pickupTime || selectedOrder.puDate || 'Not specified'}`,
      `Weight: ${selectedOrder.weight || 'Not specified'}`,
      `Order #: ${selectedOrder.id || 'Not specified'}`
    ].join('\n');

    window.open('https://iq.dat.com/rateview', '_blank', 'noopener,noreferrer');

    try {
      await navigator.clipboard.writeText(laneDetails);
    } catch (error) {
      console.error('Could not copy the RateView lane details to the clipboard:', error);
    }
  };

  const handleOpenLandstarLoads = async () => {
    if (!selectedOrder) return;
    window.open('https://www.landstaronline.com/loads/', '_blank', 'noopener,noreferrer');

    const laneDetails = [
      `Origin: ${[selectedOrder.origCity, selectedOrder.origSt, selectedOrder.origZip].filter(Boolean).join(', ')}`,
      `Destination: ${[selectedOrder.destCity, selectedOrder.destSt, selectedOrder.destZip].filter(Boolean).join(', ')}`
    ].join('\n');

    try {
      await navigator.clipboard.writeText(laneDetails);
      alert('Landstar Loads opened. Origin and destination details are copied; paste them into the matching fields.');
    } catch (error) {
      console.error('Could not copy the Landstar origin and destination details:', error);
      alert('Landstar Loads opened, but the lane details could not be copied. Check clipboard permissions and try again.');
    }
  };

  const saveLoad = updatedOrder => {
    setSelectedOrder(updatedOrder);
    setCustomerOrdersMap(prev => ({
      ...prev,
      [selectedBroker]: (prev[selectedBroker] || []).map(o => o.id === updatedOrder.id ? updatedOrder : o)
    }));
  };

  const confirmRemoveCapacity = load => window.confirm(
    `Remove ${String(load.driver || '').trim() || 'the truck'} from load #${load.id} and move it back to OPEN?\n\n`
    + 'The driver, phone, truck, trailer, pickup ETA and tracking are cleared. The rate and load details stay. This load is marked IMPORTANT / NEEDS CAPACITY and protected from missing-list removal. The local posting bot will attempt a refresh every 15 minutes while it is available and the pickup window is still open.'
  );

  const handleRemoveCapacity = () => {
    if (!selectedOrder || !confirmRemoveCapacity(selectedOrder)) return;
    saveLoad(removeCapacity(selectedOrder));
  };

  // ⭐ Needs capacity: flags a pre-booked load that still needs a truck. The star shows on
  // the load card until you turn it off (or book the load). Imports keep the flag.
  const handleToggleNeedsCapacity = () => {
    if (!selectedOrder) return;
    const next = { ...selectedOrder };
    if (String(next.needsCapacity || '').trim()) delete next.needsCapacity;
    else next.needsCapacity = 'true';
    saveLoad(next);
  };

  // Booking also sends the truck to the bot, which assigns it on Landstar (Assign Capacity).
  const handleBookLoad = () => {
    if (!selectedOrder) return;
    let booked;
    try {
      booked = bookLoad(selectedOrder);
    } catch (error) {
      alert(error.message);
      return;
    }
    const request = buildAssignRequest(selectedBroker, booked);
    if (request.item) {
      saveLoad(booked);
      addToAssignQueue(request.item);
      void sendAssignQueueToBot();
    } else {
      const line = `Landstar: not assigned automatically - ${request.reason} Assign it by hand.`;
      saveLoad({ ...booked, notes: booked.notes ? `${booked.notes}\n${line}` : line });
      alert(`Booked in the TMS only. ${line}`);
    }
  };

  // Typing or picking a known driver fills in their phone, truck and trailer
  // (only into boxes that are still empty).
  const handleDriverChange = value => {
    if (!selectedOrder) return;
    const known = findKnownDriver(driverDirectory, value);
    let updatedOrder = { ...selectedOrder, driver: value };
    if (known) {
      ['driverPhone', 'truck', 'trailer'].forEach(field => {
        if (!String(selectedOrder[field] || '').trim() && known[field]) updatedOrder[field] = known[field];
      });
      if (updatedOrder.driverPhone !== selectedOrder.driverPhone) {
        updatedOrder = moveToOfferWithDriverPhone(updatedOrder);
      }
    }
    saveLoad(updatedOrder);
  };

  // Calculate city-to-city driving miles after location editing stops.
  useEffect(() => {
    const order = selectedOrder;
    if (!order || Number(normalizeMilesValue(order.miles)) > 0) return undefined;
    const originZip = String(order.origZip || '').trim();
    const destZip = String(order.destZip || '').trim();
    if (![order.origCity, order.origSt, order.destCity, order.destSt].every(value => String(value || '').trim())) return undefined;
    const routeOrder = { ...order, origZip: '', destZip: '' };
    const laneKey = getRoadMilesLaneKey(routeOrder);
    const customer = selectedBroker;
    let cancelled = false;
    const timer = setTimeout(async () => {
      let miles = '';
      let note = '';
      try {
        miles = await getGoogleRoadMiles(routeOrder);
        note = 'city-to-city driving miles calculated by Google Routes';
      } catch (error) {
        try {
          const zipModule = await import('zipcodes');
          miles = estimateRoadMilesFromZips(zipModule.default || zipModule, originZip, destZip);
          note = 'miles estimated from the ZIPs (Google Routes unavailable); check before posting';
        } catch (zipError) {
          console.error('Could not estimate miles from the ZIPs:', zipError);
        }
      }
      if (cancelled) return;
      if (!miles) {
        pushNotice(`Could not calculate miles for load ${order.id}. Verify the cities and states or enter miles manually.`);
        return;
      }
      const fill = load => (String(load.id) === String(order.id)
        && !(Number(normalizeMilesValue(load.miles)) > 0)
        && getRoadMilesLaneKey({ ...load, origZip: '', destZip: '' }) === laneKey
        && String(load.origZip || '').trim() === originZip && String(load.destZip || '').trim() === destZip)
        ? { ...load, miles, milesSource: note.startsWith('city-to-city') ? 'google' : 'estimated', planningComment: load.planningComment ? `${load.planningComment}; ${note}` : note }
        : load;
      setCustomerOrdersMap(prev => ({ ...prev, [customer]: (prev[customer] || []).map(fill) }));
      setSelectedOrder(current => (current ? fill(current) : current));
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectedOrder?.id, selectedOrder?.origCity, selectedOrder?.origSt, selectedOrder?.destCity, selectedOrder?.destSt, selectedOrder?.origZip, selectedOrder?.destZip, selectedOrder?.miles, selectedBroker]);

  // ＋ Add Load: a blank load in the selected customer, filled in with the order editor.
  const handleAddManualLoad = () => {
    if (!selectedBroker) {
      alert('Select a customer before adding a load.');
      return;
    }
    const load = createManualLoad();
    handleClearAllFilters();
    setFilter('ALL');
    setSelectedIds([]);
    setView('loads');
    setCustomerOrdersMap(prev => ({ ...prev, [selectedBroker]: [load, ...(prev[selectedBroker] || [])] }));
    setSelectedOrder(load);
  };

  // 📄 Copy Load: a new load in the same customer with this load's details, so a repeat
  // load only needs a new order # and whatever differs.
  const handleCopyLoad = () => {
    if (!selectedOrder || !selectedBroker) return;
    const id = String(window.prompt(`Order # of the new load, copied from #${selectedOrder.id} in ${selectedBroker}:`) || '').trim();
    if (!id) return;
    const existing = orders.find(o => normalizeLoadId(o.id) === normalizeLoadId(id));
    if (existing) {
      alert(`Load #${id} is already in ${selectedBroker}. Pick a different order #.`);
      return;
    }
    const load = copyLoadDetails(selectedOrder, id);
    setCustomerOrdersMap(prev => ({ ...prev, [selectedBroker]: [load, ...(prev[selectedBroker] || [])] }));
    setSelectedOrder(load);
  };

  const handleDelete = () => {
    if (!selectedOrder) return;
    const remaining = orders.filter(o => o.id !== selectedOrder.id);
    setCustomerOrdersMap(prev => ({ ...prev, [selectedBroker]: remaining }));
    if (remaining.length > 0) setSelectedOrder(remaining[0]);
    else setSelectedOrder(null);
  };

  const selectionKey = (customer, id) => filter === 'OFFER' ? JSON.stringify([customer, String(id)]) : id;

  const handleToggleSelect = (id, e, customer = selectedBroker) => {
    e.stopPropagation();
    const key = selectionKey(customer, id);
    if (selectedIds.includes(key)) {
      setSelectedIds(selectedIds.filter(item => item !== key));
    } else {
      setSelectedIds([...selectedIds, key]);
    }
  };

  const handleSelectAll = (filteredOrders) => {
    const filteredIds = filter === 'OFFER'
      ? visibleOrderEntries.map(({ customer, order }) => selectionKey(customer, order.id))
      : filteredOrders.map(o => o.id);
    const allSelected = filteredIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(selectedIds.filter(id => !filteredIds.includes(id)));
    } else {
      const combined = Array.from(new Set([...selectedIds, ...filteredIds]));
      setSelectedIds(combined);
    }
  };

  const handleClearAllFilters = () => {
    setSearchQuery('');
    setLoadFilters({ rate: '', minMiles: '', maxMiles: '', pickupState: '', deliveryState: '', pickupDate: '' });
    setLaneSort('');
  };

  // After an import: show the imported list itself, not a leftover search, filter or the
  // Booked Loads page (those made fresh imports look like they never arrived).
  const showImportedList = () => {
    handleClearAllFilters();
    setView('loads');
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    if (window.confirm(`Are you sure you want to delete ${selectedIds.length} selected loads?`)) {
      const remaining = orders.filter(o => !selectedIds.includes(selectionKey(selectedBroker, o.id)));
      setCustomerOrdersMap(prev => Object.fromEntries(Object.entries(prev).map(([customer, loads]) => [
        customer, filter === 'OFFER' || customer === selectedBroker
          ? loads.filter(o => !selectedIds.includes(selectionKey(customer, o.id))) : loads
      ])));
      setSelectedIds([]);
      if (remaining.length > 0) setSelectedOrder(remaining[0]);
      else setSelectedOrder(null);
    }
  };

  const handleStatusChange = (newStatus) => {
    if (!selectedOrder) return;
    const updatedOrder = {
      ...selectedOrder,
      status: newStatus,
      tag: getStatusTag(newStatus)
    };
    if (newStatus !== 'BOOKED') delete updatedOrder.bookedAt;
    setSelectedOrder(updatedOrder);
    setCustomerOrdersMap(prev => ({
      ...prev,
      [selectedBroker]: prev[selectedBroker].map(o => o.id === updatedOrder.id ? updatedOrder : o)
    }));
  };

  const handleMoveSelected = (newStatus) => {
    if (selectedIds.length === 0) return;
    const tag = getStatusTag(newStatus);
    setCustomerOrdersMap(prev => Object.fromEntries(Object.entries(prev).map(([customer, loads]) => [
      customer, filter === 'OFFER' || customer === selectedBroker
        ? loads.map(o => selectedIds.includes(selectionKey(customer, o.id)) ? { ...o, status: newStatus, tag } : o)
        : loads
    ])));
    setSelectedOrder(current => (
      current && selectedIds.includes(selectionKey(selectedBroker, current.id)) ? { ...current, status: newStatus, tag } : current
    ));
  };

  const copyToClipboard = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error(`Could not copy ${label} to the clipboard:`, error);
    }
  };

  // Picks up changes saved from another browser or by teammates on shared customers.
  // Only keys whose stored value actually changed are adopted, so an unrelated sync
  // event (e.g. a lane-rate update) never replaces the load list being worked on.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const reloadSavedData = event => {
      const fromCloud = event?.type === 'landstar-data-changed';
      let values;
      try {
        values = {
          landstar_brokers: localStorage.getItem('landstar_brokers'),
          landstar_customerOrdersMap: localStorage.getItem('landstar_customerOrdersMap'),
          landstar_laneRates: localStorage.getItem('landstar_laneRates'),
          landstar_rateHistory: localStorage.getItem('landstar_rateHistory'),
          landstar_exportedLoads: localStorage.getItem('landstar_exportedLoads'),
          landstar_profile: localStorage.getItem('landstar_profile')
        };
      } catch (error) {
        console.error('Could not load the latest saved data:', error);
        return;
      }
      initSyncGuardFromStorage();
      const versions = readDataVersions();
      const changedKeys = getChangedSyncedKeys(values);
      const adopted = {};
      const { adopt, heal } = classifyChangedSyncedKeys(changedKeys, versions, fromCloud);
      // A same-browser load-list change without a version bump came from an outdated
      // app version or a stale tab; keep this tab's newer list and restore it instead.
      if (heal) scheduleUnversionedLoadListHeal();
      // A missing value is never adopted: an empty slot would otherwise load the
      // sample loads over the real list.
      adopt.forEach(key => { if (values[key] !== null) adopted[key] = values[key]; });
      // Track version bumps that arrived without content changes.
      markStorageAdopted({});
      if (!Object.keys(adopted).length) return;
      let nextBrokers;
      let nextOrders;
      let nextRates;
      let nextRateHistory;
      let nextRegistry;
      let brokerList;
      let ordersMap;
      try {
        if ('landstar_brokers' in adopted) {
          nextBrokers = normalizeBrokerList(JSON.parse(adopted.landstar_brokers));
        }
        if ('landstar_customerOrdersMap' in adopted) {
          nextOrders = removeExpiredExportedLoads(normalizeCustomerOrders(JSON.parse(adopted.landstar_customerOrdersMap)));
        }
        if ('landstar_laneRates' in adopted) {
          const savedRates = JSON.parse(adopted.landstar_laneRates);
          nextRates = savedRates && typeof savedRates === 'object' && !Array.isArray(savedRates) ? savedRates : {};
        }
        if ('landstar_rateHistory' in adopted) {
          const savedHistory = JSON.parse(adopted.landstar_rateHistory);
          nextRateHistory = Array.isArray(savedHistory) ? savedHistory : [];
        }
        if ('landstar_exportedLoads' in adopted) {
          const savedRegistry = JSON.parse(adopted.landstar_exportedLoads);
          nextRegistry = savedRegistry && typeof savedRegistry === 'object' && !Array.isArray(savedRegistry) ? savedRegistry : {};
        }
        if (nextBrokers || nextOrders) {
          brokerList = nextBrokers || normalizeBrokerList(JSON.parse(values.landstar_brokers));
          ordersMap = nextOrders || removeExpiredExportedLoads(normalizeCustomerOrders(JSON.parse(values.landstar_customerOrdersMap)));
        }
      } catch (error) {
        console.error('Could not load the latest saved data:', error);
        return;
      }
      markStorageAdopted(adopted);
      if (nextBrokers) setBrokers(nextBrokers);
      if (nextOrders) setCustomerOrdersMap(nextOrders);
      if (nextRates) setLaneRates(nextRates);
      if (nextRateHistory) setRateHistory(nextRateHistory);
      if (nextRegistry) setExportedLoadRegistry(nextRegistry);
      setProfile(getUserProfile());
      if (nextBrokers || nextOrders) {
        const nextSelected = brokerList.includes(selectedBroker) ? selectedBroker : brokerList[0];
        setSelectedBroker(nextSelected);
        setSelectedOrder(current => {
          const loads = ordersMap[nextSelected] || [];
          return (current && loads.find(load => String(load.id) === String(current.id))) || loads[0] || null;
        });
      }
    };
    reloadSavedDataFn = reloadSavedData;
    window.addEventListener('landstar-data-changed', reloadSavedData);
    window.addEventListener('storage', reloadSavedData);
    return () => {
      if (reloadSavedDataFn === reloadSavedData) reloadSavedDataFn = null;
      window.removeEventListener('landstar-data-changed', reloadSavedData);
      window.removeEventListener('storage', reloadSavedData);
    };
  }, [selectedBroker]);

  useEffect(() => (sharing ? sharing.onSharedCustomersChange(setSharedCustomers) : undefined), [sharing]);

  const openProfileSettings = () => setProfileDraft({ ...profile, phone: formatPhone(profile.phone) });
  // The signed-in account bar (bottom right, next to Sign out) opens My Settings through this.
  if (typeof window !== 'undefined') window.__tmsOpenSettings = openProfileSettings;

  const handleSaveProfile = (e) => {
    e.preventDefault();
    const nextProfile = {
      phone: profileDraft.phone.replace(/\D/g, ''),
      postingCode: profileDraft.postingCode.trim().toUpperCase(),
      visibilityGroup: profileDraft.visibilityGroup.trim().toUpperCase(),
      flag: profileDraft.flag,
      fuelSurcharge: normalizeFuelSurchargeRates(profileDraft.fuelSurcharge)
    };
    const invalidFuelSurcharge = Object.entries(profileDraft.fuelSurcharge || {})
      .some(([, value]) => String(value ?? '').trim() !== '' && !(Number(String(value).replace(/[$,]/g, '')) > 0));
    if (invalidFuelSurcharge) {
      alert('Fuel surcharge rates must be a positive $/mile number, or blank to skip a region.');
      return;
    }
    if (nextProfile.phone.length !== 10) {
      alert('Enter a 10-digit phone number.');
      return;
    }
    if (!nextProfile.postingCode || !nextProfile.visibilityGroup) {
      alert('Enter your posting code and visibility group.');
      return;
    }
    try {
      writeSyncedKey('landstar_profile', JSON.stringify(nextProfile));
    } catch (error) {
      console.error('Could not save My Settings:', error);
      alert('Could not save My Settings. Check available browser storage and try again.');
      return;
    }
    setProfile(nextProfile);
    setProfileDraft(null);
  };

  const openShareDialog = async (customer) => {
    setShareCustomerName(customer);
    setShareSelection([]);
    setShareMessage('Loading teammates…');
    try {
      setTeammates(await sharing.listTeammates());
      setShareMessage('');
    } catch (error) {
      console.error('Could not load teammates:', error);
      setShareMessage(error.message || 'Could not load teammates.');
    }
  };

  const runShareAction = async (action, successMessage) => {
    setShareBusy(true);
    setShareMessage('');
    try {
      await action();
      setShareSelection([]);
      setShareMessage(successMessage);
      return true;
    } catch (error) {
      console.error('Customer sharing failed:', error);
      setShareMessage(error.message || 'Something went wrong. Try again.');
      return false;
    } finally {
      setShareBusy(false);
    }
  };

  const teammateEmail = (userId) => teammates.find(person => person.id === userId)?.email || 'a teammate';

  const toggleShareSelection = (userId) => {
    setShareSelection(current => current.includes(userId)
      ? current.filter(id => id !== userId)
      : [...current, userId]);
  };

  const renderSchedulePicker = field => {
    const parts = parseSchedulePickerParts(selectedOrder?.[field]);
    const update = (side, key, inputValue) => {
      const current = parseSchedulePickerParts(selectedOrder?.[field]);
      const next = { from: current.from || {}, to: current.to || {} };
      next[side] = { ...next[side], [key]: inputValue };
      if (key === 'time' && inputValue && !next[side].date) {
        const other = side === 'from' ? next.to : next.from;
        next[side].date = other.date || new Date().toISOString().slice(0, 10);
      }
      if (!next[side].date && !next[side].time) next[side] = null;
      handleFieldChange(field, formatSchedulePickerParts(next.from, next.to));
    };
    const pickerClass = 'w-full min-w-0 min-h-[48px] bg-[#0b132b] border border-[#1c2541] rounded-lg px-3 py-2 text-base text-white [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-blue-400';
    const scheduleLabel = field === 'pickupTime' ? 'Pickup' : 'Delivery';
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
        {['from', 'to'].map(side => (
          <div key={side} className="min-w-0">
            <span className="block text-sm font-semibold text-gray-300 mb-1">{side === 'from' ? 'From' : 'To'}</span>
            <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-2">
              <input aria-label={`${scheduleLabel} ${side} date`} type="date" value={parts[side]?.date || ''} onChange={e => update(side, 'date', e.target.value)} className={pickerClass} />
              <input aria-label={`${scheduleLabel} ${side} time`} type="time" value={parts[side]?.time || ''} onChange={e => update(side, 'time', e.target.value)} className={pickerClass} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderCopyableField = (label, field) => (
    <div className="min-w-0">
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      <div className="flex gap-1">
        <input
          type="text"
          aria-label={label}
          list={field === 'origCity' || field === 'destCity' ? `${field}-suggestions` : undefined}
          onFocus={() => {
            if (!locationData) void import('zipcodes').then(module => setLocationData(module.default || module))
              .catch(error => { console.error('Could not load city suggestions:', error); pushNotice('City suggestions could not load. Enter the city, state and ZIP by hand.'); });
          }}
          value={selectedOrder[field] || ''}
          onChange={(e) => handleFieldChange(field, e.target.value)}
          className="min-w-0 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white"
        />
        {(field === 'origCity' || field === 'destCity') && (
          <datalist id={`${field}-suggestions`}>
            {getCitySuggestions(locationData, selectedOrder[field]).map(place => (
              <option key={`${place.city}|${place.state}`} value={`${place.city.toUpperCase()}, ${place.state}`} label={`ZIP ${place.zip}`} />
            ))}
          </datalist>
        )}
        <button
          type="button"
          onClick={() => copyToClipboard(selectedOrder[field] || '', label)}
          aria-label={`Copy ${label}`}
          title={`Copy ${label}`}
          className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-2 rounded text-[11px] cursor-pointer"
        >
          📋
        </button>
      </div>
    </div>
  );

  const handleAddBroker = (e) => {
    e.preventDefault();
    const name = normalizeCustomerName(newBrokerInput);
    if (name && !brokers.includes(name)) {
      const updatedBrokers = [...brokers, name];
      setBrokers(updatedBrokers);
      setCustomerOrdersMap(prev => ({ ...prev, [name]: [] }));
      handleSelectBroker(name);
      setNewBrokerInput('');
      setIsAddingBroker(false);
    }
  };

  const handleSaveEditBroker = (oldName, e) => {
    e.preventDefault();
    if (sharedCustomers[oldName]) {
      alert('This customer is shared, so its name cannot be changed. Use 🤝 Share to stop sharing first.');
      return;
    }
    const newName = normalizeCustomerName(editBrokerInput);
    if (newName && !brokers.includes(newName)) {
      const updatedBrokers = brokers.map(b => b === oldName ? newName : b);
      setBrokers(updatedBrokers);
      
      setCustomerOrdersMap(prev => {
        const copy = { ...prev };
        copy[newName] = copy[oldName];
        delete copy[oldName];
        return copy;
      });

      if (selectedBroker === oldName) {
        setSelectedBroker(newName);
      }
      setEditingBroker(null);
      setEditBrokerInput('');
    }
  };

  const handleDeleteBroker = (brokerToDelete, e) => {
    e.stopPropagation();
    if (sharedCustomers[brokerToDelete]) {
      alert(sharedCustomers[brokerToDelete].isOwner
        ? 'This customer is shared. Use 🤝 Share → Stop sharing before deleting it.'
        : 'This customer is shared with you. Use 🤝 Share → Leave to remove it from your list.');
      return;
    }
    if (brokers.length <= 1) {
      alert("You must keep at least one customer/broker.");
      return;
    }
    if (window.confirm(`Delete customer "${brokerToDelete}"?`)) {
      const updatedBrokers = brokers.filter(b => b !== brokerToDelete);
      setBrokers(updatedBrokers);
      
      setCustomerOrdersMap(prev => {
        const copy = { ...prev };
        delete copy[brokerToDelete];
        return copy;
      });

      if (selectedBroker === brokerToDelete) {
        handleSelectBroker(updatedBrokers[0]);
      }
    }
  };

  const handleGmailImport = async () => {
    if (!gmailAuthReady || !window.google?.accounts?.oauth2) {
      alert(gmailImportProgress || 'Google authorization is still loading. Wait a moment and try again.');
      return;
    }
    if (!gmailClientId.trim()) {
      alert('Enter a Google OAuth Web client ID first. The Gmail setup instructions are shown above the search box.');
      return;
    }
    if (!gmailQuery.trim()) {
      alert('Enter a Gmail search query, such as newer_than:7d or from:loads@example.com.');
      return;
    }

    let accessToken;
    try {
      localStorage.setItem('landstar_gmailClientId', gmailClientId.trim());
      accessToken = await new Promise((resolve, reject) => {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: gmailClientId.trim(),
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          callback: response => {
            if (response.error || !response.access_token) {
              reject(new Error(response.error_description || response.error || 'Google did not grant Gmail read-only access.'));
              return;
            }
            resolve(response.access_token);
          },
          error_callback: error => reject(new Error(error.message || 'Google authorization was cancelled or blocked.'))
        });
        tokenClient.requestAccessToken({ prompt: 'consent' });
      });

      setGmailImportProgress('Searching Gmail...');
      const apiHeaders = { Authorization: `Bearer ${accessToken}` };
      const searchResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(gmailQuery.trim())}&maxResults=1`,
        { headers: apiHeaders }
      );
      if (!searchResponse.ok) {
        throw await getGmailApiError(searchResponse, 'search');
      }
      const searchResult = await searchResponse.json();
      const messages = searchResult.messages || [];
      if (!messages.length) {
        alert('Gmail search found no matching messages.');
        return;
      }

      const parsedLoads = [];
      for (let index = 0; index < messages.length; index += 1) {
        setGmailImportProgress('Reading newest matching email...');
        const messageResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messages[index].id)}?format=full`,
          { headers: apiHeaders }
        );
        if (!messageResponse.ok) {
          throw await getGmailApiError(messageResponse, `message read for ${messages[index].id}`);
        }
        const message = await messageResponse.json();
        const text = getGmailMessageText(message.payload || {});
        parsedLoads.push(...parseGmailLoadEmail(text, selectedBroker, laneRates));
      }

      if (!parsedLoads.length) {
        alert('The newest matching email was read, but no load rows could be recognized. Check that the email contains load numbers, origin/destination, weight, and pickup-date headings.');
        return;
      }

      const payerLoads = applyRxoPayerBusinessHours(parsedLoads, selectedBroker);
      const latestRegistry = getLatestExportedRegistry();
      const exportedRecords = getExportedRecordsForCustomer(latestRegistry, selectedBroker);
      const { exportedCount, exportedLoadIds } = countPreviouslyExportedLoads(payerLoads, exportedRecords);
      const { loads: deduplicatedLoads, duplicateCount } = isRxoCustomer(selectedBroker)
        ? removeDuplicateLoadImports(payerLoads)
        : { loads: payerLoads, duplicateCount: 0 };
      const existingOrders = customerOrdersMap[selectedBroker] || [];
      const uniqueLoads = keepPreviouslyExportedLoadsOpen(
        markDifferentScheduleLoadsEnt(deduplicatedLoads, existingOrders, selectedBroker),
        exportedLoadIds,
        selectedBroker
      );
      if (!uniqueLoads.length) {
        alert(`Found ${parsedLoads.length} loads, but they were all duplicates.`);
        return;
      }

      // Auto-fetch DAT rates for Gmail imported loads if missing
      const gmailDatRateError = await applyDatRatesForImport(uniqueLoads, selectedBroker, laneRates, setLaneRates);
      setRateHistory(readRateHistory());

      const { mileageError: mileageCalculationError } = await applyGoogleRoadMiles(
        deduplicatedLoads,
        setGmailImportProgress,
        'Imported from Gmail'
      );

      const resolvedLoads = [];
      uniqueLoads.forEach(load => {
        resolvedLoads.push(assignImportedLoadIdentity(applyPastPickupEntStatus(load, existingOrders), existingOrders, resolvedLoads));
      });
      const merged = new Map(existingOrders.map(load => [String(load.id), load]));
      resolvedLoads.forEach(load => {
        const existingLoad = merged.get(String(load.id));
        const keepsEnt = existingLoad && existingLoad.status === 'ENT' && !isNewDayForExistingLoad(existingLoad, load);
        const wasPreviouslyExported = exportedLoadIds.has(normalizeLoadId(load.id));
        const preserveStatus = preservesImportedLoadStatus(selectedBroker);
        merged.set(String(load.id), existingLoad
          ? {
            ...existingLoad,
            ...load,
            ...(preserveStatus
              ? getReimportedLoadStatus(existingLoad, wasPreviouslyExported)
              : {}),
            ...(!preserveStatus && existingLoad.status !== 'OFFER' && wasPreviouslyExported
              ? { status: 'OPEN', tag: 'OPEN' }
              : !preserveStatus && keepsEnt ? { status: 'ENT', tag: 'ENT' } : {}),
            ...(existingLoad.status === 'OFFER' && !isNewDayForExistingLoad(existingLoad, load)
              ? { status: 'OFFER', tag: 'OFFER' } : {}),
            ...(isNewDayForExistingLoad(existingLoad, load) ? { landstarExportedAt: undefined } : {}),
            miles: load.miles || existingLoad.miles,
            rateInput: existingLoad.rateInput || load.rateInput,
            rateSource: existingLoad.rateSource || load.rateSource
          }
          : load);
      });
      const mergedList = Array.from(merged.values());
      const { loads: mergedFinalLoads, duplicateCount: existingDuplicates } = isRxoCustomer(selectedBroker)
        ? removeDuplicateLoadImports(mergedList)
        : { loads: mergedList, duplicateCount: 0 };
      const replacement = replaceImportedCustomerLoads(selectedBroker, payerLoads, existingOrders);
      queueDroppedPostings(replacement, existingOrders);
      const finalLoads = replacement ? replacement.loads : mergedFinalLoads;
      const nextOrders = { ...customerOrdersMap, [selectedBroker]: finalLoads };
      const saved = persistAppData(brokers, nextOrders);
      setCustomerOrdersMap(nextOrders);
      setSelectedOrder(finalLoads.find(load => load.id === resolvedLoads[0].id) || finalLoads[0]);
      setSelectedIds(getImportedLoadSelection(selectedBroker, replacement?.processedLoads || resolvedLoads));
      showImportedList();
      setFilter('OPEN');
      
      alert(
        `✉️ Gmail Import Complete for ${selectedBroker}:\n` +
        `• Recognized loads: ${parsedLoads.length}\n` +
        `• Unique loads imported: ${replacement ? finalLoads.length : uniqueLoads.length}\n` +
        `• Total in list: ${finalLoads.length}\n` +
        getImportReplacementMessage(replacement) +
        (exportedCount > 0
          ? preservesImportedLoadStatus(selectedBroker)
            ? `• Previously exported; moved to OPEN: ${exportedCount}\n`
            : `• Previously exported; kept OPEN: ${exportedCount}\n`
          : '') +
        (gmailDatRateError ? `• DAT rates could not be fetched; enter rates manually. DAT reported: ${gmailDatRateError}\n` : '') +
        (saved ? '• Status: Saved successfully in browser storage.' : '• Warning: Save failed, check browser storage.')
      );

      if (!saved || mileageCalculationError) alert(`${saved ? '' : 'Saving failed; keep this page open and check browser storage. '}${mileageCalculationError ? `Driving miles were not calculated and remain blank where no prior miles were saved. You can still enter miles manually. Google Routes reported: ${mileageCalculationError}` : ''}`.trim());
    } catch (error) {
      console.error('Gmail load import failed:', error);
      alert(`Gmail import failed: ${error.message || 'Check your Google OAuth client ID, Gmail API setup, and search query.'}`);
    } finally {
      setGmailImportProgress('');
    }
  };

  // One customer's list often comes as several Excel files (or tabs). Pick them all at
  // once: they are combined into one list first, so a Landstar posting is only removed
  // when its load is on none of them. Importing them one at a time treats each file as
  // the whole list and removes the other files' postings. RXO is the exception: its van,
  // flatbed and reefer lists can be uploaded one at a time — an import only replaces the
  // equipment categories in the file (see replaceImportedCustomerLoads).
  const handleExcelImport = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;

    const runImport = async () => {
      try {
        const isRxoPayerImport = normalizeCustomerName(selectedBroker) === rxoPayerCustomerName;
        const isRxoImport = isRxoCustomer(selectedBroker);
        // Every data row of every load tab, with that tab's column positions.
        const sheetRows = [];
        let anyRxoDateTimeFormat = false;
        let sheetCount = 0;
        for (const file of files) {
          const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: false });
          for (const sheetName of getLoadSheetNames(workbook, XLSX)) {
            const worksheet = workbook.Sheets[sheetName];
            const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            if (rawRows.length <= 1) continue;
            sheetCount += 1;

            const headerRow = rawRows[0] || [];
            const findColIndex = (possibleNames, defaultIdx) => {
              for (let name of possibleNames) {
                const idx = headerRow.findIndex(h => String(h || '').trim().toLowerCase() === name.toLowerCase());
                if (idx !== -1) return idx;
              }
              return defaultIdx;
            };
            const pickupTimeCol = findColIndex(['Pickup Date (From)', 'Pickup Time', 'PU Time'], -1);
            const deliveryTimeCol = findColIndex(['Delivery Date (From)', 'Delivery Time', 'Del Time'], -1);
            const hasRxoTimeColumns = pickupTimeCol >= 0 && deliveryTimeCol >= 0;
            const columns = {
              colA: findColIndex(['Order #', 'Load ID', 'Order Number', 'Load Posting Code'], 0),
              colB: findColIndex(['Equipment', 'Equipment Type', 'Equipment 1', 'Equip'], 1),
              colG: findColIndex(['Origin City', 'Orig City', 'Origin', 'Origin - City'], 6),
              colH: findColIndex(['Origin State', 'Origin St', 'Orig State', 'Origin - State'], 7),
              colI: findColIndex(['Origin Zipcode', 'Origin Zip', 'Orig Zip', 'Origin - Zip'], 8),
              colL: findColIndex(['Destination City', 'Dest City', 'Destination', 'Destination - City'], 11),
              colM: findColIndex(['Destination State', 'Destination St', 'Dest State', 'Destination - State'], 12),
              colN: findColIndex(['Destination Zipcode', 'Destination Zip', 'Dest Zip', 'Destination - Zip'], 13),
              colO: findColIndex(['Weight', 'Wgt', 'Weight (lbs)'], 14),
              useRxoDateTimeFormat: isRxoImport || hasRxoTimeColumns,
              colQ: isRxoImport && !hasRxoTimeColumns ? 16 : pickupTimeCol >= 0 ? pickupTimeCol : 16,
              colR: isRxoImport && !hasRxoTimeColumns ? 17 : deliveryTimeCol >= 0 ? deliveryTimeCol : 17,
              colS: findColIndex(['Bill as Miles', 'Miles', 'Distance', 'Loaded Miles'], 18),
              // Only real column names here (no position fallback): other files put weight or
              // dates where an RXO list has its commodity.
              commodityCols: ['Commodity', 'Commodity Description']
                .map(name => findColIndex([name], -1))
                .filter(index => index >= 0)
            };
            if (columns.useRxoDateTimeFormat) anyRxoDateTimeFormat = true;
            rawRows.slice(1).forEach((row, rowIndex) => {
              const getRxoDateTime = colIndex => {
                const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex + 1, c: colIndex })];
                return formatRxoExcelDateTime(cell ? XLSX.utils.format_cell(cell) : row[colIndex]);
              };
              sheetRows.push({ ...columns, row, getRxoDateTime });
            });
          }
        }

        if (!sheetCount) {
          alert(files.length > 1
            ? 'The selected Excel files are empty or only contain headers!'
            : 'The uploaded Excel sheet is empty or only contains headers!');
          return;
        }

        let datRateError = '';
        let skippedEquipmentCount = 0;
        let importedRows = [];
        for (let idx = 0; idx < sheetRows.length; idx++) {
          const {
            row, colA, colB, colG, colH, colI, colL, colM, colN, colO, colQ, colR, colS,
            commodityCols, useRxoDateTimeFormat, getRxoDateTime
          } = sheetRows[idx];
          if (!row || row.length === 0) continue;

          // Skip oversized/specialized equipment we don't haul (Over Dimensional, RGN, etc.).
          if (isSkippableEquipment(row[colB])) {
          skippedEquipmentCount += 1;
          continue;
          }

          const loadId = String(row[colA] || `IMP-${Date.now()}-${idx}`).trim();
          const origC = String(row[colG] || 'UNKNOWN').toUpperCase().trim();
          const origS = String(row[colH] || '').toUpperCase().trim();
          const origZ = String(row[colI] || '00000').trim();
          const destC = String(row[colL] || 'UNKNOWN').toUpperCase().trim();
          const destS = String(row[colM] || '').toUpperCase().trim();
          const destZ = String(row[colN] || '00000').trim();
          const weightVal = isRxoPayerImport ? '42000 lbs' : String(row[colO] || '40000 lbs').trim();
          
          const puTimeVal = useRxoDateTimeFormat
            ? getRxoDateTime(colQ)
            : formatExcelDateTime(row[colQ]);
          const delTimeVal = useRxoDateTimeFormat
            ? getRxoDateTime(colR)
            : formatExcelDateTime(row[colR]);
          // Broker exports append a unit to miles, e.g. '396.3 miles'; store the number only.
          const milesVal = String(row[colS] || '500').replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0] || '500';

          const laneKey = `${origC}${origS ? ', ' + origS : ''} → ${destC}${destS ? ', ' + destS : ''}`;
          
          const rawEquip = row[colB];
          const normalizedEquip = normalizeEquipmentCode(rawEquip);
          // RXO defaults to VAN:VAN, but reefer/flatbed/etc. equipment text wins.
          const eCodeVal = isRxoCustomer(selectedBroker)
            ? (normalizedEquip && normalizedEquip !== 'V' ? normalizedEquip : 'VAN:VAN')
            : normalizedEquip || 'VZ';
          
          const tempOrder = {
            origCity: origC, origSt: origS, origZip: origZ,
            destCity: destC, destSt: destS, destZip: destZ,
            eCode: eCodeVal
          };

          const rateVal = getSavedLaneRate(laneRates, selectedBroker, tempOrder);
          const rateSrc = rateVal ? 'user-entered' : undefined;

          const hazmatTanker = getImportedHazmatTanker(rawEquip, commodityCols.map(index => row[index]));
          importedRows.push({
            id: loadId,
            eCode: eCodeVal,
            ...hazmatTanker,
            status: 'OPEN',
            tag: 'OPEN',
            route: laneKey,
            puDate: useRxoDateTimeFormat && puTimeVal ? `PU: ${puTimeVal.split(' ')[0]}` : 'PU: Today',
            delDate: useRxoDateTimeFormat && delTimeVal ? `DFL: ${delTimeVal.split(' ')[0]}` : 'DFL: Upcoming',
            pickupTime: puTimeVal,
            origCity: origC,
            origSt: origS,
            origZip: origZ,
            weight: weightVal,
            deliveryTime: delTimeVal,
            destCity: destC,
            destSt: destS,
            destZip: destZ,
            miles: milesVal,
            planningComment: 'Imported from Excel',
            carrier: '',
            driver: '',
            truck: '',
            trailer: '',
            rateInput: rateVal,
            ...(rateSrc ? { rateSource: rateSrc } : {}),
            brokerable: 'false',
            notes: ''
          });
        }

        // Run ZIP code auto-fill on Excel import rows
        importedRows = autoFillLoadZipCodes(importedRows);
        importedRows = applyRxoPayerBusinessHours(importedRows, selectedBroker);
        // Auto-fetch DAT rates for rows with no saved lane rate (a few at a time).
        // Logged in the rate history only; your typed rates are what get reused.
        const excelDatRateError = await applyDatRatesForImport(importedRows, selectedBroker, laneRates, setLaneRates);
        if (excelDatRateError && !datRateError) datRateError = excelDatRateError;
        const { mileageError: excelMileageError } = await applyGoogleRoadMiles(importedRows, null, 'Imported from Excel');

        const latestRegistry = getLatestExportedRegistry();
        const exportedRecords = getExportedRecordsForCustomer(latestRegistry, selectedBroker);
        const { exportedCount, exportedLoadIds } = countPreviouslyExportedLoads(importedRows, exportedRecords);
        const { loads: deduplicatedLoads, duplicateCount: duplicateImportCount } = isRxoImport
          ? removeDuplicateLoadImports(importedRows)
          : { loads: importedRows, duplicateCount: 0 };
        const existingLoads = customerOrdersMap[selectedBroker] || [];
        const importedLoads = keepPreviouslyExportedLoadsOpen(
          markDifferentScheduleLoadsEnt(deduplicatedLoads, existingLoads, selectedBroker),
          exportedLoadIds,
          selectedBroker
        );

        if (importedLoads.length === 0) {
          alert("No valid loads found in the spreadsheet rows.");
          return;
        }

        const resolvedImportedLoads = [];
        importedLoads.forEach(load => {
          resolvedImportedLoads.push(assignImportedLoadIdentity(applyPastPickupEntStatus(load, existingLoads), existingLoads, resolvedImportedLoads));
        });
        const mergedLoads = new Map(existingLoads.map(load => [load.id, load]));
        resolvedImportedLoads.forEach(load => {
          const existingLoad = mergedLoads.get(load.id);
          const wasPreviouslyExported = exportedLoadIds.has(normalizeLoadId(load.id));
          const preserveStatus = preservesImportedLoadStatus(selectedBroker);
          if (existingLoad && preserveStatus && !isNewDayForExistingLoad(existingLoad, load)) {
            mergedLoads.set(load.id, {
              ...existingLoad,
              ...getReimportedLoadStatus(existingLoad, wasPreviouslyExported)
            });
          }
          if (!existingLoad || isNewDayForExistingLoad(existingLoad, load)) {
            mergedLoads.set(load.id, existingLoad ? { ...load, rateInput: load.rateInput || existingLoad.rateInput } : load);
          } else if (existingLoad.status === 'OFFER') {
            mergedLoads.set(load.id, { ...existingLoad, status: 'OFFER', tag: 'OFFER' });
          } else if (wasPreviouslyExported && !preserveStatus) {
            mergedLoads.set(load.id, { ...existingLoad, status: 'OPEN', tag: 'OPEN' });
          } else if (load.status === 'ENT' && existingLoad.status !== 'ENT' && !preserveStatus) {
            mergedLoads.set(load.id, { ...existingLoad, status: 'ENT', tag: 'ENT' });
          } else if (anyRxoDateTimeFormat) {
            mergedLoads.set(load.id, {
              ...mergedLoads.get(load.id),
              pickupTime: load.pickupTime || existingLoad.pickupTime,
              deliveryTime: load.deliveryTime || existingLoad.deliveryTime,
              rateInput: existingLoad.rateInput || load.rateInput,
              rateSource: existingLoad.rateSource || load.rateSource,
              puDate: load.puDate,
              delDate: load.delDate
            });
          }
        });
        const mergedLoadList = Array.from(mergedLoads.values());
        const { loads: mergedFinalLoads, duplicateCount: duplicateExistingCount } = isRxoImport
          ? removeDuplicateLoadImports(mergedLoadList)
          : { loads: mergedLoadList, duplicateCount: 0 };
        const replacement = replaceImportedCustomerLoads(selectedBroker, importedRows, existingLoads);
        queueDroppedPostings(replacement, existingLoads);
        const finalLoads = replacement ? replacement.loads : mergedFinalLoads;
        const nextOrders = { ...customerOrdersMap, [selectedBroker]: finalLoads };
        const saved = persistAppData(brokers, nextOrders);
        setCustomerOrdersMap(nextOrders);
        setSelectedOrder(finalLoads.find(load => load.id === resolvedImportedLoads[0].id) || finalLoads[0]);
        setSelectedIds(getImportedLoadSelection(selectedBroker, replacement?.processedLoads || resolvedImportedLoads));
        showImportedList();
        setFilter('OPEN');

        const duplicatesRemoved = replacement ? 0 : duplicateImportCount + duplicateExistingCount;

        alert(
          `📂 Excel Import Complete for ${selectedBroker}:\n` +
          (files.length > 1 || sheetCount > 1
            ? `• Combined into one list: ${files.length} file(s), ${sheetCount} tab(s)\n`
            : '') +
          `• Added/Processed: ${replacement ? finalLoads.length : importedLoads.length} loads\n` +
          `• Total in list: ${finalLoads.length} loads\n` +
          getImportReplacementMessage(replacement) +
          (exportedCount > 0
            ? preservesImportedLoadStatus(selectedBroker)
              ? `• Previously exported; moved to OPEN: ${exportedCount}\n`
              : `• Previously exported; kept OPEN: ${exportedCount}\n`
            : '') +
          (duplicatesRemoved > 0 ? `• Skipped duplicates: ${duplicatesRemoved}\n` : '') +
          (skippedEquipmentCount > 0 ? `• Skipped oversized/specialized equipment: ${skippedEquipmentCount}\n` : '') +
          (datRateError ? `• DAT rates could not be fetched; enter rates manually. DAT reported: ${datRateError}\n` : '') +
          (excelMileageError ? `• Driving miles could not be calculated for some loads; enter them manually. Google Routes reported: ${excelMileageError}\n` : '') +
          (saved ? '• Status: Saved successfully in browser storage.' : '• Warning: Save failed, check browser storage.')
        );

        if (!saved) alert('Saving failed; keep this page open and check browser storage.');
      } catch (err) {
        console.error(err);
        alert(`Excel import failed: ${err.message || "Please make sure it's a valid .xlsx or .xls file."}`);
      }
    };
    return runImport();
  };

  const handleScreenshotImport = async (event, importMode = 'ai') => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (isImportingScreenshot) return;
    await importScreenshotFile(file, importMode);
  };

  const importScreenshotFile = async (file, importMode, customerOverride = '') => {
    if (!file) return;
    const brokerName = customerOverride || selectedBroker;
    let worker;
    let imageUrl;

    setScreenshotImportMode(importMode);
    setIsImportingScreenshot(true);
    setScreenshotImportProgress(importMode === 'dat' ? 'Preparing DAT screenshot...' : importMode === 'ntg' ? 'Preparing NTG screenshot...' : importMode === 'ch' ? 'Preparing CH screenshot...' : 'Preparing customer screenshot...');
    try {
      if (!file.type.startsWith('image/')) {
        throw new Error('Please choose an image file.');
      }

      setScreenshotImportProgress('Loading OCR module...');
      const tesseractModule = await import('tesseract.js');
      const createWorker = tesseractModule.createWorker || tesseractModule.default?.createWorker;
      if (typeof createWorker !== 'function') {
        throw new Error('The OCR engine could not be loaded.');
      }
      setScreenshotImportProgress('Opening screenshot...');
      const image = new Image();
      imageUrl = URL.createObjectURL(file);
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('The selected image could not be opened.'));
        image.src = imageUrl;
      });
      setScreenshotImportProgress('Loading OCR engine...');

      const scale = Math.min(3, 5000 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not prepare the image for text recognition.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      worker = await createWorker('eng', 1, {
        logger: message => {
          if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
            setScreenshotImportProgress(`Recognizing ${Math.round(message.progress * 100)}%`);
          } else if (message.status) {
            setScreenshotImportProgress(message.status);
          }
        }
      });
      setScreenshotImportProgress('Recognizing text...');
      await worker.setParameters({
        tessedit_pageseg_mode: importMode === 'dat' || importMode === 'ntg' ? '3' : '6'
      });
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      let lines = (data.blocks || []).flatMap(block =>
        block.paragraphs.flatMap(paragraph => paragraph.lines)
      );
      const tableGrid = importMode === 'ai' ? detectScreenshotGrid(canvas) : null;
      let gridSkippedRows = [];
      if (tableGrid) {
        lines = await readScreenshotGrid(worker, canvas, tableGrid, setScreenshotImportProgress, image);
        gridSkippedRows = lines.skippedRows || [];
        if (!lines.length) {
          throw new Error(`No screenshot rows could be read. Existing loads were not deleted.\n${gridSkippedRows.join('\n')}`);
        }
      }
      const dataLines = lines
        .filter(line => line.bbox.y0 >= canvas.height * 0.035)
        .sort((a, b) => a.bbox.y0 - b.bbox.y0);
      const centers = dataLines.map(line => (line.bbox.y0 + line.bbox.y1) / 2);
      const spacings = centers.slice(1)
        .map((center, index) => center - centers[index])
        .filter(spacing => spacing > 0 && spacing < canvas.height * 0.08)
        .sort((a, b) => a - b);
      const rowSpacing = spacings[Math.floor(spacings.length / 2)];

      if (!tableGrid && rowSpacing && importMode !== 'ntg' && importMode !== 'ch') {
        for (let index = 1; index < dataLines.length; index += 1) {
          const previousCenter = centers[index - 1];
          const nextCenter = centers[index];
          const missingCount = Math.max(0, Math.round((nextCenter - previousCenter) / rowSpacing) - 1);

          for (let missingIndex = 0; missingIndex < missingCount; missingIndex += 1) {
            const expectedCenter = previousCenter + rowSpacing * (missingIndex + 1);
            const cropTop = Math.max(0, Math.round(expectedCenter - rowSpacing * 1.5));
            const cropHeight = Math.min(Math.round(rowSpacing * 1.9), canvas.height - cropTop);
            const rowCanvas = document.createElement('canvas');
            rowCanvas.width = canvas.width;
            rowCanvas.height = cropHeight;
            const rowContext = rowCanvas.getContext('2d');
            if (!rowContext) throw new Error('Could not isolate a missed screenshot row.');
            rowContext.drawImage(canvas, 0, cropTop, canvas.width, cropHeight, 0, 0, canvas.width, cropHeight);

            const { data: rowData } = await worker.recognize(rowCanvas, {}, { blocks: true });
            const croppedLines = (rowData.blocks || []).flatMap(block =>
              block.paragraphs.flatMap(paragraph => paragraph.lines)
            );
            const targetCenter = expectedCenter - cropTop;
            const missedLine = croppedLines
              .map(line => ({
                line,
                distance: Math.abs((line.bbox.y0 + line.bbox.y1) / 2 - targetCenter)
              }))
              .filter(candidate => candidate.distance < rowSpacing * 0.6)
              .sort((a, b) => a.distance - b.distance)[0]?.line;

            if (missedLine) {
              lines.push({
                ...missedLine,
                bbox: {
                  ...missedLine.bbox,
                  y0: missedLine.bbox.y0 + cropTop,
                  y1: missedLine.bbox.y1 + cropTop
                }
              });
            }
          }
        }
      }

      if (importMode === 'ai' && !tableGrid) {
        await worker.setParameters({
          tessedit_pageseg_mode: '7',
          tessedit_char_whitelist: '0123456789'
        });
        const detectedColumns = detectScreenshotColumns(lines, canvas.width);
        const orderCellX = Math.round(canvas.width * detectedColumns[1]);
        const orderCellWidth = Math.round(canvas.width * (detectedColumns[2] + 0.016 - detectedColumns[1]));
        const orderCellHeight = Math.max(1, Math.round(rowSpacing * 0.9));
        for (const line of lines) {
          if (line.bbox.y0 < canvas.height * 0.035) continue;
          const centerY = (line.bbox.y0 + line.bbox.y1) / 2;
          const sourceY = Math.max(0, Math.min(
            canvas.height - orderCellHeight,
            Math.round(centerY - orderCellHeight / 2)
          ));
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = orderCellWidth * 3;
          cropCanvas.height = orderCellHeight * 3;
          const cropContext = cropCanvas.getContext('2d', { willReadFrequently: true });
          if (!cropContext) throw new Error('Could not isolate an order number for recognition.');
          cropContext.drawImage(
            canvas,
            orderCellX,
            sourceY,
            orderCellWidth,
            orderCellHeight,
            0,
            0,
            cropCanvas.width,
            cropCanvas.height
          );

          const imageData = cropContext.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
          let redPixels = 0;
          for (let offset = 0; offset < imageData.data.length; offset += 4) {
            if (imageData.data[offset] > 180 && imageData.data[offset + 1] < 100 && imageData.data[offset + 2] < 100) {
              redPixels += 1;
            }
          }
          line.orderNumberHighlighted = redPixels > cropCanvas.width * cropCanvas.height * 0.2;
          let backgroundLuminance = 0;
          let edgeSamples = 0;
          for (let x = 0; x < cropCanvas.width; x += 4) {
            for (const y of [0, cropCanvas.height - 1]) {
              const offset = (y * cropCanvas.width + x) * 4;
              backgroundLuminance += imageData.data[offset] * 0.299
                + imageData.data[offset + 1] * 0.587
                + imageData.data[offset + 2] * 0.114;
              edgeSamples += 1;
            }
          }
          const isHighlighted = backgroundLuminance / edgeSamples < 150;
          const threshold = isHighlighted ? 130 : 170;
          for (let offset = 0; offset < imageData.data.length; offset += 4) {
            const luminance = imageData.data[offset] * 0.299
              + imageData.data[offset + 1] * 0.587
              + imageData.data[offset + 2] * 0.114;
            const pixel = isHighlighted
              ? (luminance < threshold ? 255 : 0)
              : (luminance < threshold ? 0 : 255);
            imageData.data[offset] = pixel;
            imageData.data[offset + 1] = pixel;
            imageData.data[offset + 2] = pixel;
            imageData.data[offset + 3] = 255;
          }
          cropContext.putImageData(imageData, 0, 0);
          const { data: orderData } = await worker.recognize(cropCanvas);
          line.verifiedOrderId = orderData.text.replace(/\D/g, '').match(/22\d{5}/)?.[0] || '';
        }
      }

      const isDatImport = importMode === 'dat';
      const isNtgImport = importMode === 'ntg';
      const isChImport = importMode === 'ch';
      let chSkipNote = '';
      let ntgCardLoads = [];
      if (isNtgImport) {
        ntgCardLoads = await readNtgScreenshotCards(worker, image, setScreenshotImportProgress);
      }
      if (isNtgImport && !ntgCardLoads.length) {
        const { cards: ntgCards, spacing: ntgSpacing } = findNtgCards(lines, canvas.width, canvas.height);
        const readStrip = (x0, y0, x1, y1, pattern) => readCanvasStrip(worker, canvas, x0, y0, x1, y1, pattern);
        const cardNeedsId = card => !card.words.some(word => word.x0 < 0.2 && /^\d{7}$/.test(word.text));
        const cardNeedsWeight = card => !card.words.some(word =>
          word.cx > 0.6 && /^(\d{1,3}(,\d{3})+|\d{4,6})(\.\d+)?$/.test(word.text)
        );
        if (ntgCards.some(card => cardNeedsId(card) || cardNeedsWeight(card))) {
          setScreenshotImportProgress('Reading missed load details...');
          await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789,.' });
          for (const card of ntgCards) {
            if (cardNeedsId(card)) {
              const idWordSize = card.words.find(word => /^total$/i.test(word.text))?.h || canvas.height * 0.06;
              const loadNumber = (await readStrip(
                canvas.width * 0.01, card.cy - idWordSize, canvas.width * 0.1, card.cy + idWordSize * 2.4, /\d{7}/
              )).slice(0, 7);
              if (loadNumber) {
                lines.push({
                  bbox: { x0: 0, y0: card.cy - 5, x1: canvas.width * 0.08, y1: card.cy + 5 },
                  text: loadNumber,
                  words: [{ text: loadNumber, bbox: { x0: canvas.width * 0.03, y0: card.cy - 5, x1: canvas.width * 0.08, y1: card.cy + 5 } }]
                });
              }
            }
            const totalWord = card.words.find(word => /^total$/i.test(word.text));
            if (cardNeedsWeight(card) && totalWord) {
              const weightText = await readStrip(
                canvas.width * 0.69, totalWord.cy + totalWord.h * 1.5,
                totalWord.x0 * canvas.width - 8, totalWord.cy + totalWord.h * 4.2,
                /\d{1,3}(,\d{3})+(\.\d+)?|\d{4,6}(\.\d+)?/
              );
              if (weightText) {
                const y = totalWord.cy + totalWord.h * 2.7;
                lines.push({
                  bbox: { x0: canvas.width * 0.74, y0: y - 5, x1: canvas.width * 0.8, y1: y + 5 },
                  text: weightText,
                  words: [{ text: weightText, bbox: { x0: canvas.width * 0.74, y0: y - 5, x1: canvas.width * 0.8, y1: y + 5 } }]
                });
              }
            }
          }
        }
        const cardHasHazmat = card => card.words.some(word => /^haz/i.test(word.text));
        if (ntgCards.some(card => !cardHasHazmat(card))) {
          setScreenshotImportProgress('Checking cards for Hazmat tags...');
          await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' });
          for (const card of ntgCards) {
            if (cardHasHazmat(card)) continue;
            const tagText = await readStrip(
              canvas.width * 0.005, card.cy + ntgSpacing * 0.3, canvas.width * 0.3, card.cy + ntgSpacing * 0.78, /haz\w*/i
            );
            if (tagText) {
              const y = card.cy + ntgSpacing * 0.5;
              lines.push({
                bbox: { x0: 0, y0: y - 5, x1: canvas.width * 0.1, y1: y + 5 },
                text: 'Hazmat',
                words: [{ text: 'Hazmat', bbox: { x0: 0, y0: y - 5, x1: canvas.width * 0.1, y1: y + 5 } }]
              });
            }
          }
        }
      }
      let recognizedLoads;
      if (isChImport) {
        setScreenshotImportProgress('Reading states and rates...');
        const chResult = await readChScreenshot(worker, canvas, lines, brokerName, laneRates, scale);
        recognizedLoads = chResult.loads;
        chSkipNote = (chResult.skippedLtl ? `• Skipped LTL rows: ${chResult.skippedLtl}\n` : '')
          + (chResult.skippedNoDate ? `• Skipped rows with no date heading above them: ${chResult.skippedNoDate}\n` : '');
      } else {
        recognizedLoads = isDatImport
          ? parseDatScreenshotLines(lines, canvas.width, canvas.height, brokerName, laneRates)
          : isNtgImport
            ? (ntgCardLoads.length ? ntgCardLoads : parseNtgScreenshotLines(lines, canvas.width, canvas.height))
            : parseScreenshotLines(lines, canvas.width, canvas.height, brokerName);
      }
      if (tableGrid && recognizedLoads.length !== tableGrid.rows.length - gridSkippedRows.length) {
        throw new Error(`Read ${recognizedLoads.length} of ${tableGrid.rows.length - gridSkippedRows.length} screenshot load rows. Existing loads were not deleted. Use a clearer image with every origin and destination visible.`);
      }
      
      // Run ZIP Code Auto-fill on Screenshot loads
      recognizedLoads = autoFillLoadZipCodes(recognizedLoads);

      if (!isDatImport && !isNtgImport && recognizedLoads.length > 0) {
        try {
          const zipModule = await import('zipcodes');
          correctCitiesFromZip(recognizedLoads, zipModule.default || zipModule);
        } catch (error) {
          console.error('Could not use ZIP data to verify screenshot cities:', error);
        }
      }
      const applyDatCityFix = async () => {
        if (!(isDatImport || isChImport) || recognizedLoads.length === 0) return;
        try {
          const zipModule = await import('zipcodes');
          correctDatCities(recognizedLoads, zipModule.default || zipModule);
        } catch (error) {
          console.error('Could not verify DAT cities:', error);
        }
      };
      if (isDatImport && recognizedLoads.length === 0) {
        for (const pageSegMode of ['6', '11']) {
          setScreenshotImportProgress('Trying another DAT table recognition mode...');
          await worker.setParameters({ tessedit_pageseg_mode: pageSegMode });
          const { data: retryData } = await worker.recognize(canvas, {}, { blocks: true });
          const retryLines = (retryData.blocks || []).flatMap(block =>
            block.paragraphs.flatMap(paragraph => paragraph.lines)
          );
          let retryLoads = parseDatScreenshotLines(
            retryLines,
            canvas.width,
            canvas.height,
            brokerName,
            laneRates
          );
          retryLoads = autoFillLoadZipCodes(retryLoads);
          if (retryLoads.length > recognizedLoads.length) recognizedLoads = retryLoads;
          if (recognizedLoads.length > 0) break;
        }
      }

      if (isDatImport && recognizedLoads.length > 0) {
        setScreenshotImportProgress('Reading DAT rates...');
        await worker.setParameters({
          tessedit_pageseg_mode: '7',
          tessedit_char_whitelist: '0123456789,$./mi'
        });
        for (const load of recognizedLoads) {
          const crop = load.rateCrop;
          if (!crop || crop.x1 <= crop.x0) continue;
          // Lanes with your own saved rate keep it; the DAT rate is not read.
          if (load.rateSource === 'user-entered') continue;
          const miles = Number(load.miles) || 0;
          const isPlausible = value => value >= 100 && value < 100000
            && (!(miles > 0) || (value / miles >= 0.4 && value / miles <= 25));
          const variants = [
            [-0.34, 0.1, 140], [-0.34, 0.1, 110], [-0.34, 0.1, 170],
            [-0.45, 0.02, 140], [-0.3, 0.2, 140], [-0.5, 0.15, 125]
          ];
          let found = 0;
          const candidates = new Map();
          for (const [top, bottom, threshold] of variants) {
            const y0 = Math.max(0, Math.round(crop.centerY + crop.rowHeight * top));
            const y1 = Math.min(canvas.height, Math.round(crop.centerY + crop.rowHeight * bottom));
            if (y1 <= y0) continue;
            const scale = 4;
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = (crop.x1 - crop.x0) * scale + 32;
            cropCanvas.height = (y1 - y0) * scale + 32;
            const cropContext = cropCanvas.getContext('2d', { willReadFrequently: true });
            if (!cropContext) break;
            cropContext.imageSmoothingQuality = 'high';
            cropContext.fillStyle = '#fff';
            cropContext.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
            cropContext.drawImage(canvas, crop.x0, y0, crop.x1 - crop.x0, y1 - y0, 16, 16, cropCanvas.width - 32, cropCanvas.height - 32);
            const cropData = cropContext.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
            for (let offset = 0; offset < cropData.data.length; offset += 4) {
              const luminance = cropData.data[offset] * 0.299 + cropData.data[offset + 1] * 0.587 + cropData.data[offset + 2] * 0.114;
              const pixel = luminance < threshold ? 0 : 255;
              cropData.data[offset] = pixel;
              cropData.data[offset + 1] = pixel;
              cropData.data[offset + 2] = pixel;
              cropData.data[offset + 3] = 255;
            }
            cropContext.putImageData(cropData, 0, 0);
            const { data: rateData } = await worker.recognize(cropCanvas);
            const rateValue = parseDatRateText(rateData.text);
            if (isPlausible(rateValue)) {
              candidates.set(rateValue, (candidates.get(rateValue) || 0) + 1);
            }
          }
          const ranked = [...candidates].sort((a, b) => b[1] - a[1]);
          if (ranked[0]?.[1] >= 2 && (!ranked[1] || ranked[0][1] > ranked[1][1])) found = ranked[0][0];
          if (found) {
            load.rateInput = String(found);
            load.rateSource = 'dat-screenshot';
          } else if (load.rateInput && !isPlausible(Number(load.rateInput))) {
            load.rateInput = '';
            delete load.rateSource;
          }
        }
      }
      await applyDatCityFix();
      recognizedLoads.forEach(load => { delete load.rateCrop; });

      // DAT screenshots must retain posted rates rather than substitute market estimates.
      // Nolan posts at the load board's own rate: never a DAT rate (Daniel, 2026-11-06).
      if (!isDatImport && !isNolanCustomer(brokerName)) {
        await applyDatRatesForImport(recognizedLoads, brokerName, laneRates, setLaneRates);
      }

      if (recognizedLoads.length === 0) {
        throw new Error(isChImport
          ? `No CH loads were recognized.${chSkipNote ? ` Skipped rows:\n${chSkipNote}` : ' Capture the board straight-on with the Load #, Origin, OST, Destination, DST, Pickup Hours, Mode, Weight and Bin columns and a date heading visible.'}`
          : isDatImport
          ? 'No DAT load rows were recognized. Capture the DAT results table straight-on with the Origin, Destination, Pick Up, EQ, and Weight columns visible.'
          : isNtgImport
            ? 'No NTG loads were recognized. The text in the screenshot is probably too small to read: set the browser zoom to 100% (Ctrl+0), then capture about 4-5 load cards at a time with the Load #, cities, miles, weight and Total Rate visible.'
          : 'No load rows could be read. Try a clearer, straight-on screenshot that includes the full table.');
      }

      recognizedLoads = applyRxoPayerBusinessHours(recognizedLoads, brokerName);
      const { mileageError } = await applyGoogleRoadMiles(
        recognizedLoads,
        setScreenshotImportProgress,
        `Imported from ${isDatImport ? 'DAT' : isNtgImport ? 'NTG' : isChImport ? 'CH' : 'customer'} screenshot`
      );
      const existingOrders = customerOrdersMap[brokerName] || [];
      const latestRegistry = getLatestExportedRegistry();
      const exportedRecords = getExportedRecordsForCustomer(latestRegistry, brokerName);
      const { exportedCount, exportedLoadIds } = countPreviouslyExportedLoads(
        recognizedLoads,
        exportedRecords,
        { idOnly: isNtgImport || isChImport }
      );
      let importedLoads = recognizedLoads;
      let skippedDuplicateCount = 0;
      let datUnreadableRows = [];
      if (isDatImport) {
        const deduplicated = deduplicateDatImports(importedLoads, existingOrders);
        importedLoads = deduplicated.loads;
        skippedDuplicateCount = deduplicated.skippedDuplicateCount;
        datUnreadableRows = deduplicated.unreadableRows;
      }
      importedLoads = keepPreviouslyExportedLoadsOpen(
        markDifferentScheduleLoadsEnt(importedLoads, existingOrders, brokerName),
        exportedLoadIds,
        brokerName
      );

      if (importedLoads.length === 0) {
        const exportedMessage = !isDatImport && exportedCount
          ? preservesImportedLoadStatus(brokerName)
            ? ` ${exportedCount} previously exported loads moved to OPEN.`
            : ` ${exportedCount} previously exported loads remain in OPEN.`
          : '';
        alert(`Read ${recognizedLoads.length} load rows, but none were added for ${brokerName}.${exportedMessage}${skippedDuplicateCount ? ' They duplicated a lane and pickup date already imported.' : ''}${datUnreadableRows.length ? `\nSkipped unreadable rows:\n${datUnreadableRows.join('\n')}` : ''}`);
        return;
      }

      const resolvedImportedLoads = [];
      importedLoads.forEach(load => {
        resolvedImportedLoads.push(assignImportedLoadIdentity(applyPastPickupEntStatus(load, existingOrders), existingOrders, resolvedImportedLoads));
      });

      const existingIds = new Set(existingOrders.map(order => order.id));
      const mergeableFields = [
        'pickupTime', 'origCity', 'origSt', 'origZip', 'weight',
        'deliveryTime', 'destCity', 'destSt', 'destZip', 'miles',
        'planningComment', 'rateInput', 'rateSource'
      ];
      const mergedImportedLoads = resolvedImportedLoads.map(importedLoad => {
        const existingLoad = existingOrders.find(order => order.id === importedLoad.id);
        if (!existingLoad) return importedLoad;
        const wasPreviouslyExported = exportedLoadIds.has(normalizeLoadId(importedLoad.id));
        if (isNewDayForExistingLoad(existingLoad, importedLoad)) {
          const { landstarExportedAt, ...rest } = existingLoad;
          return { ...rest, ...importedLoad, rateInput: importedLoad.rateInput || existingLoad.rateInput };
        }
        const mergedLoad = { ...importedLoad, ...existingLoad };
        if (isDatImport && importedLoad.rateSource === 'dat-screenshot'
          && existingLoad.rateSource !== 'user-entered' && Number(importedLoad.rateInput) > 0) {
          mergedLoad.rateInput = importedLoad.rateInput;
          mergedLoad.rateSource = 'dat-screenshot';
        }
        const fixedLaneRate = getFixedLaneRate(brokerName, mergedLoad);
        if (fixedLaneRate && existingLoad.rateSource !== 'user-entered') {
          mergedLoad.rateInput = fixedLaneRate;
          mergedLoad.rateSource = 'user-entered';
        }
        const preserveStatus = preservesImportedLoadStatus(brokerName);
        if (existingLoad.status === 'OFFER') {
          mergedLoad.status = 'OFFER';
          mergedLoad.tag = 'OFFER';
        } else if (preserveStatus) {
          Object.assign(mergedLoad, getReimportedLoadStatus(existingLoad, wasPreviouslyExported));
        } else if (wasPreviouslyExported) {
          mergedLoad.status = 'OPEN';
          mergedLoad.tag = 'OPEN';
        } else if (importedLoad.status === 'ENT' && !preserveStatus) {
          mergedLoad.status = 'ENT';
          mergedLoad.tag = 'ENT';
        }
        if (!isDatImport) {
          [
            'eCode', 'route', 'puDate', 'delDate', 'pickupTime', 'origCity', 'origSt', 'origZip',
            'weight', 'deliveryTime', 'destCity', 'destSt', 'destZip', 'miles'
          ].forEach(field => {
            if (String(importedLoad[field] || '').trim()) mergedLoad[field] = importedLoad[field];
          });
        }
        mergeableFields.forEach(field => {
          if (!String(existingLoad[field] || '').trim() && String(importedLoad[field] || '').trim()) {
            mergedLoad[field] = importedLoad[field];
          }
        });
        return mergedLoad;
      });
      const newLoads = mergedImportedLoads.filter(order => !existingIds.has(order.id));
      const mergedOrders = new Map(existingOrders.map(order => [order.id, order]));
      mergedImportedLoads.forEach(order => mergedOrders.set(order.id, order));
      const replacement = replaceImportedCustomerLoads(brokerName, isDatImport ? importedLoads : recognizedLoads, existingOrders,
        isDatImport ? { additive: true, allowGeneratedIds: true, reportDroppedPostings: false }
          : gridSkippedRows.length
            ? { additive: true, allowGeneratedIds: !preservesImportedLoadStatus(brokerName), reportDroppedPostings: false }
            : { keepManualEnt: true });
      queueDroppedPostings(replacement, existingOrders);
      const finalLoads = replacement ? replacement.loads : Array.from(mergedOrders.values());
      const nextOrders = {
        ...customerOrdersMap,
        [brokerName]: finalLoads
      };
      const saved = persistAppData(brokers, nextOrders);
      setCustomerOrdersMap(nextOrders);
      setSelectedOrder(replacement.processedLoads[0]);
      setSelectedIds(getImportedLoadSelection(brokerName, replacement.processedLoads));
      showImportedList();
      setFilter(replacement.usesScreenshotStatus ? 'ALL' : 'OPEN');

      const unreadableIds = isChImport ? 0 : importedLoads.filter(order => order.notes).length;
      const unreadableWeights = importedLoads.filter(order => !order.weight).length;
      const unreadablePickups = importedLoads.filter(order => !order.pickupTime).length;
      const unreadableRates = isDatImport || isChImport ? importedLoads.filter(order => !(Number(order.rateInput) > 0)).length : 0;
      const missingChStates = isChImport ? importedLoads.filter(order => !order.origSt || !order.destSt).length : 0;
      const missingChMiles = isChImport ? importedLoads.filter(order => order.status !== 'ENT' && !(Number(order.miles) > 0)).length : 0;
      const newLoadCount = replacement.processedLoads.filter(load => !existingIds.has(load.id)).length;
      const updatedLoads = replacement.processedLoads.length - newLoadCount;

      alert(
        `📸 ${isDatImport ? 'DAT' : isNtgImport ? 'NTG' : isChImport ? 'CH' : 'Customer'} Screenshot Import Complete for ${brokerName}:\n` +
        `• Recognized rows: ${recognizedLoads.length}\n` +
        `• New loads added: ${newLoadCount}\n` +
        `• Existing loads updated: ${updatedLoads}\n` +
        getImportReplacementMessage(replacement) +
        (isDatImport && skippedDuplicateCount ? `• Duplicate lane/pickup-day rows skipped: ${skippedDuplicateCount}\n` : '') +
        (datUnreadableRows.length ? `• Skipped unreadable rows (not imported):\n${datUnreadableRows.join('\n')}\n` : '') +
        (gridSkippedRows.length ? `• Skipped rows (not imported; existing loads kept). Add these by hand or widen the column and re-import:\n${gridSkippedRows.join('\n')}\n` : '') +
        (exportedCount > 0
          ? replacement?.usesScreenshotStatus
            ? `• Previously exported; status taken from screenshot color: ${exportedCount}\n`
          : preservesImportedLoadStatus(brokerName)
            ? `• Previously exported; moved to OPEN: ${exportedCount}\n`
            : `• Previously exported; kept OPEN: ${exportedCount}\n`
          : '') +
        chSkipNote +
        (unreadableWeights > 0 ? `• Missing weights: ${unreadableWeights}\n` : '') +
        (unreadablePickups > 0 ? `• Missing pickup times: ${unreadablePickups}\n` : '') +
        (isChImport && unreadableRates > 0 ? `• No rate on the board (enter manually): ${unreadableRates}\n` : '') +
        (missingChStates > 0 ? `• State not read: ${missingChStates}\n` : '') +
        (missingChMiles > 0 ? `• Driving miles missing: ${missingChMiles}${mileageError ? ` (${mileageError})` : ''}\n` : '') +
        (!isChImport && mileageError ? `• Google driving miles unavailable; miles kept from the import where present. Google Routes reported: ${mileageError}\n` : '') +
        (saved ? '• Status: Saved successfully.' : '• Warning: Save failed.')
      );

      const importWarnings = `${saved ? '' : ' Saving failed; keep this page open and check browser storage.'}${unreadableIds ? ` ${unreadableIds} order number${unreadableIds === 1 ? ' was' : 's were'} unreadable.` : ''}${unreadablePickups ? ` ${unreadablePickups} pickup date/time${unreadablePickups === 1 ? ' was' : 's were'} not recognized; please check those loads.` : ''}${unreadableWeights ? ` ${unreadableWeights} weight${unreadableWeights === 1 ? ' was' : 's were'} not recognized; please check those loads.` : ''}${unreadableRates ? ` ${unreadableRates} DAT rate${unreadableRates === 1 ? ' was' : 's were'} not recognized; enter them manually.` : ''}`.trim();
      if (importWarnings && !saved) alert(importWarnings);
    } catch (error) {
      const source = importMode === 'ntg' ? 'NTG screenshot' : importMode === 'dat' ? 'DAT screenshot' : 'Customer screenshot';
      console.error(`${source} import failed:`, error);
      alert(`${source} import failed: ${error.message || 'Could not read the image.'}`);
    } finally {
      if (worker) await worker.terminate();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      setIsImportingScreenshot(false);
      setScreenshotImportMode('');
      setScreenshotImportProgress('');
    }
  };

  const handlePasteScreenshot = async (importMode) => {
    if (isImportingScreenshot) return;
    setIsImportingScreenshot(true);
    setScreenshotImportMode(importMode);
    setScreenshotImportProgress('Reading clipboard...');
    try {
      const image = await readClipboardImage(navigator.clipboard);
      await importScreenshotFile(image, importMode);
    } catch (error) {
      console.error(`Could not read the ${importMode.toUpperCase()} screenshot from the clipboard:`, error);
      alert(`Could not paste the ${importMode.toUpperCase()} screenshot: ${error.message}\n\nIf clipboard access was blocked, click the app background and press Ctrl+V instead.`);
    } finally {
      setIsImportingScreenshot(false);
      setScreenshotImportMode('');
      setScreenshotImportProgress('');
    }
  };

  const handlePasteNtgScreenshot = () => handlePasteScreenshot('ntg');

  useEffect(() => {
    const handlePaste = event => {
      const image = getPastedImage(event);
      if (!image) return;
      event.preventDefault();
      if (isImportingScreenshot) return;
      // Para lists come from Heather in Google Chat: ask which account (or NTG cards).
      setPastedImage(image);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isImportingScreenshot, importScreenshotFile]);

  // Refreshes Booked Loads alerts (check call due / late) every minute.
  // Keep this the last effect: tests address earlier effects by position.
  useEffect(() => {
    if (view !== 'booked') return undefined;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, [view]);

  const updateCustomerLoad = (customer, id, updatedLoad) => {
    setCustomerOrdersMap(prev => ({
      ...prev,
      [customer]: (prev[customer] || []).map(o => (String(o.id) === String(id) ? updatedLoad : o))
    }));
    setSelectedOrder(current => (current && customer === selectedBroker && String(current.id) === String(id) ? updatedLoad : current));
  };

  const openBookedLoad = (customer, id) => {
    const target = (customerOrdersMap[customer] || []).find(o => String(o.id) === String(id));
    if (!target) return;
    if (customer !== selectedBroker) handleSelectBroker(customer);
    setFilter('BOOKED');
    setSelectedOrder(target);
    setView('loads');
  };

  // Driver inquiries: checked when the app opens and every minute after.
  // Keep this the last effect: tests address earlier effects by position.
  useEffect(() => {
    if (!supabase) return undefined;
    let cancelled = false;
    const loadInquiries = async () => {
      const { data, error } = await supabase
        .from('load_inquiries')
        .select('id, customer, load_id, driver_name, driver_phone, mc_or_truck, message, notify_error, seen, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) {
        // Table not created yet (run supabase/load-inquiries.sql) or signed out: stay quiet.
        if (!/does not exist|schema cache/i.test(error.message || '')) console.error('Could not load driver inquiries:', error);
        return;
      }
      if (!cancelled) setInquiries(data || []);
    };
    loadInquiries();
    const timer = setInterval(loadInquiries, 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Hands loads that dropped off a customer's list to the upload bot, which removes
  // their Landstar postings. Retries every 30 seconds while the bot is off.
  // Keep this the last effect: tests address earlier effects by position.
  // Also hands booked loads to the bot for Landstar Assign Capacity (every 5 seconds while
  // any are waiting) and writes the bot's results onto the loads.
  useEffect(() => {
    const timer = setInterval(() => { void sendUnpostQueueToBot(); }, 30 * 1000);
    const assignTimer = setInterval(() => { void sendAssignQueueToBot(); }, 5 * 1000);
    const onAssignResult = event => {
      const result = event.detail || {};
      setCustomerOrdersMap(prev => {
        const loads = prev[result.customer];
        if (!Array.isArray(loads) || !loads.some(load => String(load.id) === String(result.loadId))) return prev;
        return { ...prev, [result.customer]: loads.map(load => (String(load.id) === String(result.loadId) ? applyAssignResult(load, result) : load)) };
      });
      setSelectedOrder(current => (current && String(current.id) === String(result.loadId)
        ? applyAssignResult(current, result) : current));
      if (!result.ok && result.unconfirmed) {
        pushNotice(`Landstar Assign Capacity: load #${result.loadId} (truck ${result.truck}) - Landstar did not confirm. ${result.message} It may already be assigned: check the load on Landstar before assigning it again.`);
      } else if (!result.ok) {
        pushNotice(`Landstar Assign Capacity: load #${result.loadId} (truck ${result.truck}) was NOT assigned. ${result.message} Assign it by hand on Landstar.`);
      }
      if (!result.ok) {
        alertDriverReply(`Capacity assignment needs attention - load #${result.loadId}`,
          `Truck ${result.truck}: ${result.message}. ${result.unconfirmed
            ? 'Check Landstar before retrying; the assignment may already exist.'
            : 'Verify the tractor number and finish the assignment on Landstar.'}`,
          undefined, 'CAPACITY ASSIGNMENT FAILED');
      }
    };
    window.addEventListener('landstar-assign-result', onAssignResult);
    return () => {
      clearInterval(timer);
      clearInterval(assignTimer);
      window.removeEventListener('landstar-assign-result', onAssignResult);
    };
  }, []);

  // ---------- Paramount tracking emails ----------
  const [paramountDrafts, setParamountDrafts] = useState([]);
  const [paramountReplies, setParamountReplies] = useState([]);
  const [emailWorkerStatus, setEmailWorkerStatus] = useState({ state: 'starting', message: 'Starting scheduled checks', issues: [] });
  // Background warnings (bot results, fuel updates): banners instead of alert() pop-ups,
  // because an open alert freezes the whole tab and stops the email timers.
  const [notices, setNotices] = useState([]);
  const pushNotice = (text, level = 'warn') => setNotices(current => [
    ...current.filter(item => item.text !== text),
    { id: `${Date.now()}-${Math.random()}`, text, level, at: new Date().toISOString() }
  ].slice(-6));
  // New emails from VIP customers (Heather), shown until dismissed.
  const [vipMessages, setVipMessages] = useState([]);
  const [pastedImage, setPastedImage] = useState(null);
  paramountLatest.profile = profile;
  // Applies the weekly fuel email's rates to My Settings (once per email).
  const applyFuelSurchargeEmail = found => {
    const parsed = parseFuelSurchargeEmail(found?.subject) || parseFuelSurchargeEmail(found?.text);
    if (!parsed || !found.messageId) return;
    let seen = '';
    try { seen = localStorage.getItem(fuelEmailSeenKey) || ''; } catch { /* first time */ }
    if (seen === found.messageId) return;
    const current = paramountLatest.profile || getUserProfile();
    const nextRates = normalizeFuelSurchargeRates(parsed.rates);
    const changed = JSON.stringify(normalizeFuelSurchargeRates(current.fuelSurcharge)) !== JSON.stringify(nextRates);
    try { localStorage.setItem(fuelEmailSeenKey, found.messageId); } catch { /* applied again next time */ }
    if (!changed) return;
    const nextProfile = { ...current, fuelSurcharge: nextRates };
    try {
      writeSyncedKey('landstar_profile', JSON.stringify(nextProfile));
    } catch (error) {
      console.error('Could not save the new fuel surcharge:', error);
      return;
    }
    setProfile(nextProfile);
    pushNotice(`⛽ Fuel surcharge updated from the ${parsed.date || 'latest'} fuel email: East ${nextRates.east} · Midwest ${nextRates.midwest} · West ${nextRates.west} · New England ${nextRates.newEngland}`, 'info');
  };
  const importPastedImage = (customer) => {
    const image = pastedImage;
    setPastedImage(null);
    if (!image) return;
    if (!customer) {
      void importScreenshotFile(image, 'ntg');
      return;
    }
    if (customer !== selectedBroker) handleSelectBroker(customer);
    void importScreenshotFile(image, 'ai', customer);
  };
  paramountLatest.map = customerOrdersMap;
  paramountLatest.phone = profile.phone;
  paramountLatest.postingCode = profile.postingCode;
  paramountLatest.selectedBroker = selectedBroker;

  const patchParamountLoad = (customer, id, change) => {
    setCustomerOrdersMap(prev => {
      const loads = prev[customer];
      if (!Array.isArray(loads) || !loads.some(load => String(load.id) === String(id))) return prev;
      return { ...prev, [customer]: loads.map(load => (String(load.id) === String(id) ? change(load) : load)) };
    });
    setSelectedOrder(current => (current && paramountLatest.selectedBroker === customer && String(current.id) === String(id)
      ? change(current) : current));
  };

  const findParamountLoad = (customer, id) => (paramountLatest.map?.[customer] || []).find(load => String(load.id) === String(id));

  const recordDriverPaperwork = (customer, load, files) => {
    if (files.length) {
      patchParamountLoad(customer, load.id, current => ({
        ...current,
        paperworkReceivedAt: current.paperworkReceivedAt || files[files.length - 1].at,
        paperworkFiles: files.map(file => file.filename),
        paperworkSince: getPaperworkSince(current),
        paperworkDone: current.paperworkDone || !getPaperworkTarget(customer)
      }));
    }
    setParamountDrafts(current => current.filter(item => !(item.kind === 'driver'
      && ['pod', 'podReminder'].includes(item.driverKind)
      && item.customer === customer && item.loadId === String(load.id))));
  };

  // Sends one draft (reply-all on the rate confirmation thread) and records it on the load.
  const sendParamountDraft = async (draft, { auto = false } = {}) => {
    setParamountDrafts(current => current.map(item => (item.id === draft.id ? { ...item, sending: true, error: '' } : item)));
    const isRxo = draft.kind === 'rxo';
    const isDriver = draft.kind === 'driver';
    const isPaperwork = draft.kind === 'paperwork';
    try {
      const currentLoad = findParamountLoad(draft.customer, draft.loadId);
      const initialDriverConfirmation = isDriver && draft.driverKind === 'dispatch';
      if (initialDriverConfirmation && (!currentLoad
        || String(currentLoad.paramountTracking?.freightBill) !== String(draft.freightBill)
        || !getDueDriverEmails(currentLoad, currentLoad.paramountTracking || {}).includes('dispatch'))) {
        throw new Error('The load, freight bill, or initial confirmation changed. Driver email was not sent.');
      }
      if (!['initial', 'paperwork'].includes(draft.kind) && !initialDriverConfirmation && (!currentLoad || !hasPickupDayStarted(currentLoad))) {
        throw new Error('Tracking emails start on pickup day. This email was not sent.');
      }
      const postingCode = draft.kind === 'rxoForward'
        ? getRxoEmailPostingCodes(paramountLatest.map, paramountLatest.postingCode)[draft.loadId] || ''
        : currentLoad ? getEmailPostingCode(currentLoad, paramountLatest.postingCode) : '';
      if (draft.kind === 'rxoForward' && postingCode !== 'SNB') {
        throw new Error('This load is not confirmed as SNB. Nothing forwarded to Ivan.');
      }
      if (isPaperwork) {
        const sent = await callParamountEmail({
          action: 'sendPaperwork', freightBill: draft.freightBill, since: draft.since,
          orderNumber: draft.loadId, target: draft.target, text: draft.text, postingCode
        });
        patchParamountLoad(draft.customer, draft.loadId, load => ({
          ...load, paperworkDone: true, paperworkSentAt: new Date().toISOString(),
          notes: [load.notes, `Paperwork sent to ${draft.target === 'rxo' ? 'RXO' : 'Paramount'}: ${(sent.files || draft.files || []).join(', ')}`].filter(Boolean).join('\n')
        }));
      } else if (draft.kind === 'driverStatus') {
        const load = findParamountLoad(draft.customer, draft.loadId);
        if (!load || String(load.paramountTracking?.freightBill) !== draft.freightBill) {
          throw new Error('The load or assigned freight bill changed. Driver update was not sent.');
        }
        if (Date.parse(draft.reportedAt) < Date.parse(load.customerStatusReportedAt)) {
          throw new Error('A newer driver status has already been sent. This older update was not sent.');
        }
        await callParamountEmail({
          action: 'driverStatusSend', customer: draft.customer, orderNumber: draft.loadId,
          freightBill: draft.freightBill, messageId: draft.messageId, since: draft.since, postingCode
        });
        patchParamountLoad(draft.customer, draft.loadId, current => ({
          ...current,
          customerStatusReplyIds: [...new Set([...(current.customerStatusReplyIds || []), draft.messageId])].slice(-100),
          customerStatusReportedAt: draft.reportedAt,
          notes: [current.notes, `Customer emailed driver report: ${draft.status} (${draft.reportedAt})`].filter(Boolean).join('\n')
        }));
      } else if (draft.kind === 'dailyCustomer') {
        const load = findParamountLoad(draft.customer, draft.loadId);
        if (!load || !isDailyCustomerUpdateDue(load, load.paramountTracking || {})) {
          setParamountDrafts(current => current.filter(item => item.id !== draft.id));
          return;
        }
        await callParamountEmail({
          action: 'dailyCustomerSend', customer: draft.customer, orderNumber: draft.loadId,
          day: draft.day, text: draft.text, postingCode
        });
        patchParamountLoad(draft.customer, draft.loadId, load => markParamountEmail(load, 'location'));
      } else if (draft.kind === 'checkCall') {
        await callParamountEmail({
          action: 'checkCallSend', customer: draft.customer, orderNumber: draft.loadId,
          checkCallAt: draft.checkCallAt, text: draft.text, postingCode
        });
        patchParamountLoad(draft.customer, draft.loadId, load => ({
          ...load, checkCalls: (load.checkCalls || []).map(call => call.at === draft.checkCallAt
            ? { ...call, customerEmailPending: false, customerEmailedAt: new Date().toISOString() } : call)
        }));
      } else if (isDriver) {
        if (['pod', 'podReminder'].includes(draft.driverKind)) {
          const load = findParamountLoad(draft.customer, draft.loadId);
          if (!load) throw new Error('Load no longer available. POD request was not sent.');
          const paperwork = await checkBeforePodRequest(load, { ...load.paramountTracking, freightBill: draft.freightBill });
          if (paperwork.received) {
            recordDriverPaperwork(draft.customer, load, paperwork.files);
            return;
          }
        }
        const text = draft.text
          .replace(/(\*\*\* IMPORTANT: PLEASE TURN ON [^\r\n]*?) NOW \*\*\*/g, '$1 ON THE DAY OF PICKUP ***')
          .replace('Please open the Trucker Tools app and start tracking for this load now.',
            'Please open the Trucker Tools app and start tracking for this load on the day of pickup.');
        await callParamountEmail({ action: 'driverSend', freightBill: draft.freightBill, text, postingCode });
        patchParamountLoad(draft.customer, draft.loadId, load => markDriverEmail(load, draft.driverKind));
      } else if (draft.kind === 'rxoForward') {
        throw new Error('Separate forwards to Ivan are disabled. Use reply-all on the customer request.');
      } else if (isRxo) {
        const text = auto && postingCode === 'SNB' && currentLoad
          ? buildRxoUpdateEmail(currentLoad, currentLoad.paramountTracking || {}, { phone: paramountLatest.phone, availableOnly: true }).text
          : draft.text;
        await callParamountEmail({ action: 'rxoSend', threadId: draft.threadId, text, postingCode });
        markRxoHandled(draft.messageId);
        patchParamountLoad(draft.customer, draft.loadId, load => ({ ...load, notes: [load.notes, 'RXO update request answered'].filter(Boolean).join('\n') }));
      } else if (draft.kind === 'driverEta') {
        await callParamountEmail({ action: 'send', orderNumber: draft.loadId, text: draft.text, postingCode });
        patchParamountLoad(draft.customer, draft.loadId, load => ({ ...load, notes: [load.notes, 'Paramount email sent: driver ETA'].filter(Boolean).join('\n') }));
      } else {
        await callParamountEmail({ action: 'send', orderNumber: draft.loadId, text: draft.text, postingCode });
        patchParamountLoad(draft.customer, draft.loadId, load => markParamountEmail(load, draft.kind));
      }
      if (!auto) {
        const key = isPaperwork ? paperworkApprovedKey : isDriver ? driverApprovedKey : isRxo ? rxoApprovedKey : paramountApprovedKey;
        try { localStorage.setItem(key, String(readApprovedCount(key) + 1)); } catch { /* counts again next time */ }
      }
      setParamountDrafts(current => current.filter(item => item.id !== draft.id));
    } catch (error) {
      // Shown in the panel so nothing goes missing silently.
      setParamountDrafts(current => (current.some(item => item.id === draft.id)
        ? current.map(item => (item.id === draft.id ? { ...item, sending: false, error: error.message } : item))
        : [...current, { ...draft, sending: false, error: error.message }]));
      if (auto) throw error;
    }
  };

  const skipParamountDraft = draft => {
    if (draft.kind === 'rxo') markRxoHandled(draft.messageId);
    else if (draft.kind === 'checkCall') patchParamountLoad(draft.customer, draft.loadId, load => ({
      ...load, checkCalls: (load.checkCalls || []).map(call => call.at === draft.checkCallAt
        ? { ...call, customerEmailPending: false, customerEmailSkipped: true } : call)
    }));
    else if (draft.kind === 'driverEta' || draft.kind === 'driverStatus' || draft.kind === 'rxoForward') { /* nothing to record */ }
    else if (draft.kind === 'paperwork') patchParamountLoad(draft.customer, draft.loadId, load => ({ ...load, paperworkDone: true, notes: [load.notes, 'Paperwork not sent to the customer (skipped)'].filter(Boolean).join('\n') }));
    else if (draft.kind === 'driver') patchParamountLoad(draft.customer, draft.loadId, load => markDriverEmail(load, draft.driverKind, { skipped: true }));
    else patchParamountLoad(draft.customer, draft.loadId, load => markParamountEmail(load, draft.kind, { skipped: true }));
    setParamountDrafts(current => current.filter(item => item.id !== draft.id));
  };

  // Booked Loads: bring the first card matching the search into view.
  useEffect(() => {
    if (view !== 'booked' || !searchQuery.trim() || typeof document === 'undefined') return undefined;
    const timer = setTimeout(() => {
      document.querySelector('[data-search-match="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => clearTimeout(timer);
  }, [view, searchQuery]);

  // Paramount tracking emails: tells the bot which booked Paramount loads to read in
  // Clarity, turns its results into emails (approved by hand for the first few, then sent
  // automatically) and checks the email threads for Paramount's replies.
  // Keep this the last effect: tests address earlier effects by position.
  useEffect(() => {
    let cancelled = false;
    let emailWorker;
    let maintenanceError = '';
    const syncPostingMaintenance = async () => {
      if (!canStartBotHere()) return;
      try {
        const response = await fetch('http://127.0.0.1:47615/posting-maintenance', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loads: getPostingMaintenanceLoads(paramountLatest.map) }),
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error(`posting bot returned HTTP ${response.status}; restart it to load the posting protections and refresh worker`);
        maintenanceError = '';
      } catch (error) {
        const message = `Posting protection / important-load refresh is not connected: ${error.message}`;
        if (!cancelled && message !== maintenanceError) pushNotice(message);
        maintenanceError = message;
        console.error(message);
      }
    };
    void syncPostingMaintenance();
    const maintenanceTimer = setInterval(syncPostingMaintenance, 10000);
    const onRefreshIssue = event => {
      if (event.detail?.message) pushNotice(event.detail.message);
    };
    window.addEventListener('landstar-refresh-issue', onRefreshIssue);
    const pendingTrackingEmails = new Map();
    const emailIssue = (message, error) => {
      const detail = error ? `${message}: ${error.message}` : message;
      console.warn(detail);
      if (emailWorker?.reportIssue(detail)) throw new Error(detail);
    };
    const pushWatchList = async () => {
      if (!canStartBotHere()) return;
      // Freight bills from the BCO Load Detail emails, read again every 5 minutes: the bot opens
      // them in Clarity when a booked truck isn't in Clarity's freight list yet.
      if (Date.now() - bcoBillsCache.at > 5 * 60 * 1000) {
        try {
          bcoBillsCache.bills = (await callParamountEmail({ action: 'bcoBills' })).bills || [];
          bcoBillsCache.at = Date.now();
        } catch (error) {
          emailIssue('Could not refresh BCO freight bills', error);
        }
      }
      try {
        const response = await fetch(BOT_TRACKING_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loads: getTrackingWatchList(paramountLatest.map), candidateBills: bcoBillsCache.bills }),
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error(`Tracking worker returned HTTP ${response.status}`);
      } catch (error) {
        emailIssue('Tracking feed unavailable; driver-reply checks still run', error);
      }
    };
    const prepare = async (customer, load, kind, info) => {
      // The daily location email has one id per day, so tomorrow's isn't blocked by today's.
      const id = `${customer}|${load.id}|${kind}${kind === 'location' ? `|${new Date().toDateString()}` : ''}`;
      if (paramountBusy.has(id)) return;
      paramountBusy.add(id);
      try {
        const thread = await callParamountEmail({ action: 'thread', orderNumber: String(load.id) });
        if (cancelled) return;
        const text = buildParamountEmail(kind, load, info, { greetingName: greetingNameFrom(thread.to?.[0]), phone: paramountLatest.phone });
        // Loaded: automatic, except a short stop at the shipper, which Daniel confirms first.
        const warning = kind === 'departed' ? getLoadedTimeWarning(info) : '';
        const draft = { id, customer, loadId: String(load.id), kind, text, to: thread.to || [], cc: thread.cc || [], ...(warning ? { warning } : {}) };
        if (kind === 'departed' ? !warning : paramountMaySendItself(kind)) {
          await sendParamountDraft(draft, { auto: true });
        } else {
          setParamountDrafts(current => (current.some(item => item.id === id) ? current : [...current, draft]));
        }
      } catch (error) {
        // Usually the rate confirmation email isn't in Gmail yet: try again with the next result.
        emailIssue(`Broker email for order ${load.id} not ready`, error);
        paramountBusy.delete(id);
      }
    };
    const onTrackingResult = event => {
      const info = event.detail || {};
      const load = findParamountLoad(info.customer, info.loadId);
      if (!load || !info.ok) return;
      const updated = applyParamountTrackingInfo(load, info);
      const { checkedAt: oldChecked, ...before } = load.paramountTracking || {};
      const { checkedAt: newChecked, ...after } = updated.paramountTracking || {};
      if (JSON.stringify(before) !== JSON.stringify(after) || updated.trackingStage !== load.trackingStage) {
        patchParamountLoad(info.customer, info.loadId, current => applyParamountTrackingInfo(current, info));
      }
      if (!isParamountTrackingCustomer(info.customer)) return; // RXO: kept for update-request replies
      pendingTrackingEmails.set(`${info.customer}|${info.loadId}`, info);
      if (!emailWorker?.isOwner()) return;
      // MercuryGate: once the freight bill is known (and again after pickup for the PDF).
      queueMercuryGateJobs();
      emailWorker.request('tracking-emails');
    };
    const checkTrackingEmails = async () => {
      for (const [key, info] of pendingTrackingEmails) {
        if (cancelled) return;
        pendingTrackingEmails.delete(key);
        const load = findParamountLoad(info.customer, info.loadId);
        if (!load || load.status !== 'BOOKED') continue;
        const updated = applyParamountTrackingInfo(load, info);
        for (const kind of getDueParamountEmails(updated, info).filter(kind => kind !== 'location')) {
          if (cancelled) return;
          await prepare(info.customer, updated, kind, info);
        }
      }
    };
    // MercuryGate jobs for booked Paramount loads: as soon as the truck is assigned on Landstar
    // (or the freight bill is known), and the PDF upload after pickup. Checked every minute.
    const queueMercuryGateJobs = () => {
      if (!automationPolicy.automaticDispatchEnabled) return;
      if (!canStartBotHere()) return;
      for (const { customer, load } of getBookedLoads(paramountLatest.map)) {
        if (!isParamountTrackingCustomer(customer)) continue;
        const tracking = load.paramountTracking || {};
        const step = getDueMercuryGateStep(load, tracking);
        if (!step) continue;
        const id = `mg|${customer}|${load.id}|${step}`;
        if (paramountBusy.has(id)) continue;
        paramountBusy.add(id);
        fetch(BOT_MERCURYGATE_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobs: [{ customer, loadId: String(load.id), freightBill: getMercuryGateSearchNumber(load, tracking), step, mode: 'save' }] })
        }).then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          patchParamountLoad(customer, load.id, current => ({ ...current, mercurygate: { ...(current.mercurygate || {}), [step]: new Date().toISOString() } }));
        }).catch(() => paramountBusy.delete(id));
      }
    };
    const checkReplies = async () => {
      if (!canStartBotHere()) return;
      for (const entry of getParamountWatchList(paramountLatest.map)) {
        const load = findParamountLoad(entry.customer, entry.loadId);
        const tracking = load?.paramountTracking;
        const firstSent = Object.values(tracking?.emails || {}).filter(item => !item.skipped).map(item => item.at).sort()[0];
        if (!firstSent) continue;
        try {
          const result = await callParamountEmail({ action: 'thread', orderNumber: entry.loadId, since: tracking.repliesSeenAt || firstSent });
          const replies = (result.replies || []).filter(reply => !(tracking.replyIds || []).includes(reply.id));
          if (cancelled || !replies.length) continue;
          setParamountReplies(current => [...current, ...replies
            .filter(reply => !current.some(item => item.id === reply.id))
            .map(reply => ({ ...reply, customer: entry.customer, loadId: entry.loadId, threadId: result.threadId }))]);
          patchParamountLoad(entry.customer, entry.loadId, current => {
            const lines = replies.map(reply => `Paramount reply from ${reply.from.replace(/<[^>]*>/, '').trim()}: ${reply.snippet}`);
            const seen = current.paramountTracking || {};
            return {
              ...current,
              paramountTracking: {
                ...seen,
                repliesSeenAt: replies.map(reply => reply.at).sort().pop(),
                replyIds: [...(seen.replyIds || []), ...replies.map(reply => reply.id)].slice(-30)
              },
              notes: [current.notes, ...lines].filter(Boolean).join('\n')
            };
          });
        } catch (error) {
          emailIssue(`Could not check broker replies for order ${entry.loadId}`, error);
        }
      }
    };
    // RXO "Update Request - Order #" emails about booked RXO loads: draft (or send) a reply.
    const checkRxoRequests = async () => {
      if (!canStartBotHere()) return;
      let requests = [];
      try {
        const result = await callParamountEmail({
          action: 'rxoRequests', postingCodes: getRxoEmailPostingCodes(paramountLatest.map, paramountLatest.postingCode)
        });
        requests = result.requests || [];
      } catch (error) {
        emailIssue('Could not check RXO update requests', error);
        return;
      }
      const handled = new Set(readRxoHandled());
      for (const request of requests) {
        const id = `rxo|${request.messageId}`;
        if (cancelled || handled.has(request.messageId) || paramountBusy.has(id)) continue;
        const match = findRxoLoadForRequest(paramountLatest.map, request.orderNumber);
        if (!match) {
          emailIssue(`RXO order ${request.orderNumber}: no matching booked load; broker update was not sent.`);
          const warningId = `rxoMissing|${request.messageId}`;
          if (!paramountBusy.has(warningId)) {
            paramountBusy.add(warningId);
            pushNotice(`RXO order ${request.orderNumber}: no matching booked load in this TMS. Customer update was not sent. Only confirmed SNB loads are copied to Ivan.`);
          }
          continue;
        }
        if (!hasPickupDayStarted(match.load)) continue;
        paramountBusy.add(id);
        const snb = getEmailPostingCode(match.load, paramountLatest.postingCode) === 'SNB';
        const { text, complete } = buildRxoUpdateEmail(match.load, match.load.paramountTracking || {}, {
          phone: paramountLatest.phone, availableOnly: snb
        });
        const draft = {
          id, kind: 'rxo', customer: match.customer, loadId: String(match.load.id), threadId: request.threadId,
          messageId: request.messageId, request: request.snippet, text, complete, to: request.to || [], cc: request.cc || []
        };
        if (snb || (complete && readApprovedCount(rxoApprovedKey) >= PARAMOUNT_AUTO_SEND_AFTER)) {
          await sendParamountDraft(draft, { auto: true });
        } else {
          setParamountDrafts(current => (current.some(item => item.id === id) ? current : [...current, draft]));
        }
      }
    };
    // Driver emails for every booked load the bot found in Clarity (morning checks, picked up,
    // delivered). Runs every few minutes, so a 7:00 AM email goes out on the first check after 7.
    const checkDriverEmails = async () => {
      if (!canStartBotHere()) return;
      const now = Date.now();
      // Paramount loads still waiting on the Trucker Tools "tracking started" email: look in Gmail
      // (every 5 minutes) and mark the ones that started, so their reminders stop.
      const waitingTracking = getBookedLoads(paramountLatest.map)
        .filter(({ customer, load }) => isParamountTrackingCustomer(customer) && !load.trackingStartedAt && load.trackingStage !== 'Delivered');
      if (waitingTracking.length && now - truckerToolsCache.at > 5 * 60 * 1000) {
        truckerToolsCache.at = now;
        try {
          truckerToolsCache.starts = (await callParamountEmail({ action: 'truckerToolsStarts' })).starts || [];
          truckerToolsCache.okAt = Date.now();
        } catch (error) {
          emailIssue('Could not check the Trucker Tools emails', error);
        }
      }
      const startedNow = new Set();
      for (const { customer, load } of waitingTracking) {
        const startedAt = findTruckerToolsStart(load, truckerToolsCache.starts);
        if (!startedAt) continue;
        startedNow.add(`${customer}|${load.id}`);
        patchParamountLoad(customer, load.id, current => (current.trackingStartedAt ? current : markTrackingStarted(current, startedAt)));
        setParamountDrafts(current => current.filter(item => !(item.driverKind === 'trackingReminder' && item.customer === customer && item.loadId === String(load.id))));
      }
      // Reminders only go out when the Gmail check worked lately (never on a stale "not started").
      const trackingCheckFresh = Date.now() - (truckerToolsCache.okAt || 0) < 15 * 60 * 1000;
      for (const { customer, load } of getBookedLoads(paramountLatest.map)) {
        const tracking = load.paramountTracking || {};
        let dueKinds = getDueDriverEmails(load, tracking, now);
        if (!dueKinds.length && trackingCheckFresh && !startedNow.has(`${customer}|${load.id}`) && isTrackingReminderDue(load, customer, tracking, now)) {
          dueKinds = ['trackingReminder'];
        }
        for (const driverKind of dueKinds) {
          const reminderNumber = driverKind === 'trackingReminder' ? `|${(load.driverEmails?.trackingReminder?.count || 0) + 1}` : '';
          const id = `driver|${customer}|${load.id}|${driverKind}${reminderNumber}`;
          if (cancelled || paramountBusy.has(id)) continue;
          paramountBusy.add(id);
          try {
            if (['pod', 'podReminder'].includes(driverKind)) {
              const paperwork = await checkBeforePodRequest(load, tracking);
              if (cancelled) return;
              if (paperwork.received) {
                recordDriverPaperwork(customer, load, paperwork.files);
                paramountBusy.delete(id);
                continue;
              }
            }
            const thread = await callParamountEmail({ action: 'driverThread', freightBill: tracking.freightBill });
            const draft = {
              id, kind: 'driver', driverKind, customer, loadId: String(load.id), freightBill: tracking.freightBill,
              text: buildDriverEmail(driverKind, load, tracking, { phone: paramountLatest.phone, customer }),
              to: thread.to || [], cc: thread.cc || []
            };
            if (readApprovedCount(driverApprovedKey) >= PARAMOUNT_AUTO_SEND_AFTER) {
              await sendParamountDraft(draft, { auto: true });
            } else {
              setParamountDrafts(current => (current.some(item => item.id === id) ? current : [...current, draft]));
            }
          } catch (error) {
            // Usually no BCO Load Detail email for that freight bill: try again next time.
            emailIssue(`Driver email for load ${load.id} not ready`, error);
            paramountBusy.delete(id);
          }
        }
      }
    };
    // Delivered loads still waiting on paperwork: when the driver's reply has the POD attached,
    // the load is marked "paperwork received" and (Paramount / RXO) the files are forwarded on
    // the existing customer's tracking email thread automatically.
    const checkPaperwork = async () => {
      if (!canStartBotHere()) return;
      for (const { customer, load } of getBookedLoads(paramountLatest.map)) {
        const tracking = load.paramountTracking || {};
        const deliveredAt = getDeliveredAt(load, tracking);
        // Already sent to the customer once: never again (even if the load is put back on the list).
        if (!deliveredAt || load.paperworkDone || load.paperworkSentAt || !tracking.freightBill) continue;
        if (Date.now() - deliveredAt > (PAPERWORK_REMINDER_DAYS + 3) * 86400000) continue;
        const id = `paperwork|${customer}|${load.id}`;
        if (cancelled || paramountBusy.has(id)) continue;
        paramountBusy.add(id);
        try {
          // From a day before delivery (scheduled or actual, whichever is earlier): drivers often send
          // the POD before the load is marked delivered.
          const since = getPaperworkSince(load, tracking);
          let names = Array.isArray(load.paperworkFiles) ? load.paperworkFiles : [];
          const target = getPaperworkTarget(customer);
          // Received but not sent yet (e.g. the tab reloaded before the Send click):
          // skip straight to rebuilding the waiting email below.
          if (!load.paperworkReceivedAt) {
            const { files = [] } = await callParamountEmail({ action: 'driverPaperwork', freightBill: tracking.freightBill, since });
            if (cancelled || !files.length) { paramountBusy.delete(id); continue; }
            const receivedAt = files[files.length - 1].at;
            names = files.map(file => file.filename);
            patchParamountLoad(customer, load.id, current => ({
              ...current,
              paperworkReceivedAt: receivedAt,
              paperworkFiles: names,
              paperworkSince: since,
              paperworkDone: !target,
              notes: [current.notes, `Paperwork received from the driver: ${names.join(', ')}${target ? '' : ' (no customer tracking email to send it to)'}`].filter(Boolean).join('\n')
            }));
            recordDriverPaperwork(customer, load, files);
            alertDriverReply(`Paperwork received · load #${load.id}`, `${names.join(', ')}${target ? ' · ready to send to the customer' : ''}`);
          }
          if (!target || cancelled) continue;
          let greetingName = '';
          if (target === 'paramount') {
            const thread = await callParamountEmail({ action: 'thread', orderNumber: String(load.id) }).catch(() => ({}));
            greetingName = greetingNameFrom(thread.to?.[0]);
          }
          const draft = {
            id, kind: 'paperwork', target, customer, loadId: String(load.id), freightBill: tracking.freightBill, since,
            files: names, text: buildPaperworkEmail(load, tracking, { greetingName, phone: paramountLatest.phone })
          };
          await sendParamountDraft(draft, { auto: true });
        } catch (error) {
          emailIssue(`Paperwork check for load ${load.id}`, error);
          paramountBusy.delete(id);
        }
      }
    };
    // Driver replies in the BCO Load Detail threads: badge on the load, a note, and a pop-up.
    let checkingDriverReplies = false;
    const checkDriverReplies = async () => {
      if (!canStartBotHere() || checkingDriverReplies) return;
      checkingDriverReplies = true;
      try {
      for (const { customer, load } of getBookedLoads(paramountLatest.map)) {
        if (cancelled) return;
        if (!hasPickupDayStarted(load)) continue;
        const freightBill = load.paramountTracking?.freightBill;
        // From the first driver email the TMS sent, or from booking when Daniel emails the driver himself.
        const firstSent = Object.values(load.driverEmails || {}).filter(item => !item.skipped).map(item => item.at).sort()[0] || load.bookedAt;
        if (!freightBill || !firstSent) continue;
        try {
          const result = await callParamountEmail({ action: 'driverThread', freightBill, since: firstSent });
          if (cancelled) continue;
          const statusReply = getPendingDriverStatusReply(load, result.replies);
          if (statusReply) {
            const id = `driverStatus|${customer}|${load.id}|${statusReply.id}`;
            if (!paramountBusy.has(id)) {
              paramountBusy.add(id);
              try {
                await sendParamountDraft({
                  id, kind: 'driverStatus', customer, loadId: String(load.id), freightBill: String(freightBill),
                  messageId: statusReply.id, since: firstSent, status: statusReply.status, reportedAt: statusReply.at,
                  text: `Driver reports ${statusReply.status} for order ${load.id}. Received ${statusReply.at}.`,
                  request: statusReply.snippet
                }, { auto: true });
              } finally {
                paramountBusy.delete(id);
              }
            }
          }
          const replies = (result.replies || []).filter(reply => !(load.driverReplyIds || []).includes(reply.id));
          // ETAs: every driver reply not used yet (also ones already shown before this was added).
          const etaReplies = (result.replies || []).filter(reply => !(load.etaReplyIds || []).includes(reply.id));
          if (replies.length) {
          setParamountReplies(current => [...current, ...replies
            .filter(reply => !current.some(item => item.id === reply.id))
            .map(reply => ({ ...reply, customer, loadId: String(load.id), threadId: result.threadId, driver: true }))]);
          patchParamountLoad(customer, load.id, current => ({
            ...current,
            driverRepliesSeenAt: replies.map(reply => reply.at).sort().pop(),
            driverReplyIds: [...(current.driverReplyIds || []), ...replies.map(reply => reply.id)].slice(-30),
            notes: [current.notes, ...replies.map(reply => `Driver reply from ${reply.from.replace(/<[^>]*>/, '').trim()}: ${reply.snippet}`)].filter(Boolean).join('\n')
          }));
          replies.forEach(reply => alertDriverReply(`Driver replied · load #${load.id}`, `${reply.from.replace(/<[^>]*>/, '').trim()}: ${reply.snippet}`, result.threadId));
          }
          // An ETA in the driver's reply on a Paramount load goes to Paramount's email thread.
          if (isParamountTrackingCustomer(customer)) {
            for (const reply of etaReplies) {
              const eta = findDriverEta(reply.snippet);
              if (!eta) continue;
              const id = `eta|${reply.id}`;
              if (paramountBusy.has(id)) continue;
              paramountBusy.add(id);
              patchParamountLoad(customer, load.id, current => ({ ...current, etaReplyIds: [...(current.etaReplyIds || []), reply.id].slice(-30) }));
              try {
                const thread = await callParamountEmail({ action: 'thread', orderNumber: String(load.id) });
                const draft = {
                  id, kind: 'driverEta', customer, loadId: String(load.id), request: reply.snippet,
                  text: buildParamountEtaEmail(load, load.paramountTracking || {}, eta, { greetingName: greetingNameFrom(thread.to?.[0]), phone: paramountLatest.phone }),
                  to: thread.to || [], cc: thread.cc || []
                };
                if (readParamountApprovedCount() >= PARAMOUNT_AUTO_SEND_AFTER) await sendParamountDraft(draft, { auto: true });
                else setParamountDrafts(current => (current.some(item => item.id === id) ? current : [...current, draft]));
              } catch (error) {
                emailIssue(`Could not prepare the ETA email for order ${load.id}`, error);
                paramountBusy.delete(id);
              }
            }
          }
        } catch (error) {
          emailIssue(`Could not check driver replies for load ${load.id}`, error);
        }
      }
      } finally {
        checkingDriverReplies = false;
      }
    };
    // Driver replies on every BCO Load Detail email Daniel sent lately, also for loads that aren't
    // booked in the TMS (no load card): one pop-up, and a list at the top of Booked Loads.
    const checkOtherDriverReplies = async () => {
      if (!canStartBotHere()) return;
      if (!bcoBillsCache.bills.length) {
        try {
          bcoBillsCache.bills = (await callParamountEmail({ action: 'bcoBills' })).bills || [];
          bcoBillsCache.at = Date.now();
        } catch (error) {
          emailIssue('Could not list the BCO Load Detail emails', error);
          return;
        }
      }
      const bookedBills = new Set(getBookedLoads(paramountLatest.map).map(({ load }) => String(load.paramountTracking?.freightBill || '')).filter(Boolean));
      const seen = new Set(readSeenDriverReplies());
      const fresh = [];
      for (const bill of bcoBillsCache.bills.filter(item => !bookedBills.has(String(item)))) {
        try {
          const result = await callParamountEmail({ action: 'driverThread', freightBill: bill, since: new Date(Date.now() - 36 * 3600000).toISOString() });
          (result.replies || []).filter(reply => !seen.has(reply.id)).forEach(reply => fresh.push({ ...reply, freightBill: String(bill), threadId: result.threadId }));
        } catch (error) {
          emailIssue(`Could not check driver replies on freight bill ${bill}`, error);
        }
        if (cancelled) return;
      }
      if (!fresh.length) return;
      markSeenDriverReplies(fresh.map(reply => reply.id));
      setParamountReplies(current => [...current, ...fresh
        .filter(reply => !current.some(item => item.id === reply.id))
        .map(reply => ({ ...reply, customer: '', loadId: '', driver: true }))]);
      fresh.forEach(reply => alertDriverReply(`Driver replied · freight bill ${reply.freightBill}`, `${reply.from.replace(/<[^>]*>/, '').trim()}: ${reply.snippet}`, reply.threadId));
    };
    // The weekly fuel surcharge email: checked shortly after opening and every hour.
    const checkFuelEmail = async () => {
      if (!canStartBotHere()) return;
      try {
        const found = await callParamountEmail({ action: 'fuelRates' });
        if (!cancelled) applyFuelSurchargeEmail(found);
      } catch (error) {
        emailIssue('Could not check the fuel surcharge email', error);
      }
    };
    const checkDailyCustomerUpdates = async () => {
      if (!canStartBotHere()) return;
      const now = Date.now();
      const date = new Date(now);
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      for (const { customer, load } of getBookedLoads(paramountLatest.map)) {
        if (cancelled) return;
        const tracking = load.paramountTracking || {};
        if (!isDailyCustomerUpdateDue(load, tracking, now)) continue;
        const id = `dailyCustomer|${customer}|${load.id}|${day}`;
        if (paramountBusy.has(id)) continue;
        paramountBusy.add(id);
        try {
          await sendParamountDraft({
            id, kind: 'dailyCustomer', customer, loadId: String(load.id), day,
            text: buildParamountEmail('location', load, tracking, { phone: paramountLatest.phone })
          }, { auto: true });
        } finally {
          paramountBusy.delete(id);
        }
      }
    };
    const checkCallEmails = async () => {
      if (!canStartBotHere()) return;
      for (const { customer, load } of getBookedLoads(paramountLatest.map)) {
        for (const call of load.checkCalls || []) {
          if (cancelled) return;
          if (!call.customerEmailPending || !hasPickupDayStarted(load)) continue;
          const id = `checkCall|${customer}|${load.id}|${call.at}`;
          if (paramountBusy.has(id)) continue;
          paramountBusy.add(id);
          try {
            await sendParamountDraft({
              id, kind: 'checkCall', customer, loadId: String(load.id), checkCallAt: call.at,
              text: `Hello team,\n\nCheck call update for order #${load.id}:\n\n${call.note}\n\nReported stage: ${call.stage}\nCheck call logged: ${formatCheckTime(call.at)}.\n\nThank you!\n\n${paramountSignature(paramountLatest.phone)}`
            }, { auto: true });
          } finally {
            paramountBusy.delete(id);
          }
        }
      }
    };
    // VIP customers (Heather): any new email from them, on any thread, right away.
    const checkVipMessages = async () => {
      if (!canStartBotHere()) return;
      try {
        const seen = JSON.parse(localStorage.getItem(vipSeenKey) || '{}');
        // First run: only mail from the last 2 hours (not the whole history).
        const fallback = Date.now() - 2 * 60 * 60 * 1000;
        const since = new Date(Math.min(...VIP_CONTACTS.map(vip => Date.parse(seen[vip.email]) || fallback))).toISOString();
        const { replies } = await callParamountEmail({ action: 'prospectReplies', addresses: VIP_CONTACTS.map(vip => vip.email), since });
        if (cancelled) return;
        for (const reply of replies || []) {
          const contact = VIP_CONTACTS.find(vip => vip.email === reply.from);
          if (!contact || Date.parse(reply.at) <= (Date.parse(seen[reply.from]) || fallback)) continue;
          seen[reply.from] = reply.at;
          try { localStorage.setItem(vipSeenKey, JSON.stringify(seen)); } catch { /* shown again next time */ }
          setVipMessages(current => (current.some(item => item.id === reply.id) ? current : [...current, { ...reply, name: contact.name }]));
          alertDriverReply(`⭐ ${contact.name} emailed you`, reply.snippet, reply.threadId);
        }
      } catch (error) {
        emailIssue('Could not check VIP emails', error);
      }
    };
    if (canStartBotHere()) {
      emailWorker = createEmailWorker({
        locks: navigator.locks,
        onStatus: setEmailWorkerStatus,
        tasks: [
          { id: 'driver-replies', label: 'Checking driver replies', delay: 15000, every: 120000, run: checkDriverReplies },
          { id: 'rxo-requests', label: 'Checking RXO broker requests', delay: 20000, every: 120000, run: checkRxoRequests },
          { id: 'tracking-feed', label: 'Updating tracking watch list', every: 60000, run: async () => { await pushWatchList(); queueMercuryGateJobs(); } },
          { id: 'tracking-emails', label: 'Preparing tracking updates', delay: 15000, every: 120000, run: checkTrackingEmails },
          { id: 'check-call-emails', label: 'Sending logged check calls to customers', delay: 5000, every: 15000, run: checkCallEmails },
          { id: 'daily-updates', label: 'Checking daily broker updates', delay: 30000, every: 300000, run: checkDailyCustomerUpdates },
          { id: 'driver-emails', label: 'Checking driver follow-ups', delay: 15000, every: 120000, run: checkDriverEmails },
          { id: 'broker-replies', label: 'Checking broker replies', delay: 15000, every: 120000, run: checkReplies },
          { id: 'other-drivers', label: 'Checking other BCO replies', delay: 15000, every: 120000, run: checkOtherDriverReplies },
          { id: 'paperwork', label: 'Checking driver paperwork', delay: 15000, every: 120000, run: checkPaperwork },
          { id: 'vip', label: 'Checking priority broker emails', delay: 25000, every: 120000, run: checkVipMessages },
          { id: 'fuel', label: 'Checking fuel surcharge email', delay: 15000, every: 3600000, run: checkFuelEmail }
        ]
      });
      emailWorker.start();
    } else {
      setEmailWorkerStatus({ state: 'view-only', message: 'Email worker: local TMS only', issues: [] });
    }
    window.addEventListener('landstar-tracking-result', onTrackingResult);
    const onMercuryGateResult = event => {
      const result = event.detail || {};
      patchParamountLoad(result.customer, result.loadId, current => applyMercuryGateResult(current, result));
      // Only when the bot has given up (no pop-up for each retry while MercuryGate is down).
      if (!result.ok && !result.retrying) pushNotice(`MercuryGate: order #${result.loadId} was NOT fully filled in. ${String(result.message || '').split('\n')[0]} Please finish it by hand in MercuryGate.`);
    };
    window.addEventListener('landstar-mercurygate-result', onMercuryGateResult);
    const onDuplicateBill = event => {
      const duplicate = event.detail || {};
      pushNotice(`MercuryGate has ${duplicate.routes} routes for freight bill ${duplicate.bill}. Delete the extra route so the BCO is not tendered twice.`);
    };
    window.addEventListener('landstar-duplicate-bill', onDuplicateBill);
    return () => {
      window.removeEventListener('landstar-duplicate-bill', onDuplicateBill);
      window.removeEventListener('landstar-mercurygate-result', onMercuryGateResult);
      cancelled = true;
      emailWorker?.stop();
      clearInterval(maintenanceTimer);
      window.removeEventListener('landstar-refresh-issue', onRefreshIssue);
      window.removeEventListener('landstar-tracking-result', onTrackingResult);
    };
  }, []);

  // Queues a full-list import's dropped loads for removal from Landstar. If an import
  // would drop more than half of a customer's posted loads, ask first: the file may be
  // cut off or misread.
  const queueDroppedPostings = (replacement, existingLoads, { interactive = true } = {}) => {
    const dropped = replacement?.droppedPostings || [];
    if (!dropped.length) return 0;
    const posted = (existingLoads || []).filter(load => load.landstarPosting).length;
    // Full customer lists queue missing postings automatically, with a large-drop safeguard.
    if (dropped.length > LARGE_DROP_MIN && dropped.length > posted / 2) {
      const ok = interactive && window.confirm(
        `This import would remove ${dropped.length} of ${posted} ${dropped[0].customer} loads posted on Landstar `
        + '(they are not on the new list).\n\nThat is unusually many. The file may be cut off or the wrong list.\n\n'
        + 'Remove them from Landstar? Choose Cancel to leave them posted.'
      );
      if (!ok) return 0;
    }
    addToUnpostQueue(dropped);
    void sendUnpostQueueToBot();
    return dropped.length;
  };

  const unseenInquiryCount = inquiries.filter(inquiry => !inquiry.seen).length;

  const markInquirySeen = async inquiry => {
    setInquiries(current => current.map(item => (item.id === inquiry.id ? { ...item, seen: true } : item)));
    if (!supabase) return;
    const { error } = await supabase.from('load_inquiries').update({ seen: true }).eq('id', inquiry.id);
    if (error) console.error('Could not mark the inquiry as seen:', error);
  };

  const openInquiryLoad = inquiry => {
    const loads = customerOrdersMap[inquiry.customer] || [];
    const target = loads.find(o => String(o.id) === String(inquiry.load_id));
    if (!target) {
      alert(`Load #${inquiry.load_id} is no longer in ${inquiry.customer}.`);
      return;
    }
    if (inquiry.customer !== selectedBroker) handleSelectBroker(inquiry.customer);
    setFilter('ALL');
    setSelectedOrder(target);
    setView('loads');
    setShowInquiries(false);
    if (!inquiry.seen) void markInquirySeen(inquiry);
  };

  // Creates or refreshes the public driver links for these loads (one per load,
  // reused across exports) and returns Map(loadId -> token). Throws if unavailable.
  const ensureInquiryLinks = async (customer, loads) => {
    if (!supabase) throw new Error('Driver links need the cloud account. Sign in to the TMS with cloud sync turned on.');
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) throw new Error('Sign in again to create driver links.');
    const loadIds = loads.map(load => String(load.id));
    const { data: existing, error: findError } = await supabase
      .from('load_inquiry_links').select('token, load_id')
      .eq('owner_id', user.id).eq('customer', customer).in('load_id', loadIds);
    if (findError) throw findError;
    const tokens = new Map((existing || []).map(row => [String(row.load_id), row.token]));
    const now = new Date().toISOString();
    const rows = loads.map(load => {
      const loadId = String(load.id);
      if (!tokens.has(loadId)) tokens.set(loadId, createInquiryToken());
      return {
        token: tokens.get(loadId), owner_id: user.id, owner_email: user.email || null, customer, load_id: loadId,
        details: buildInquiryDetails(load, profile), active: true, updated_at: now
      };
    });
    const { error: saveError } = await supabase.from('load_inquiry_links').upsert(rows, { onConflict: 'token' });
    if (saveError) throw saveError;
    return tokens;
  };

  const describeLinkError = error => (/does not exist|schema cache/i.test(error?.message || '')
    ? 'Driver links are not set up yet: run supabase/load-inquiries.sql in Supabase first.'
    : error?.message || 'Try again.');

  // Creates (or refreshes) this load's driver link, shows it under the comment box, and copies it.
  const handleCopyDriverLink = async () => {
    if (!selectedOrder) return;
    try {
      const token = (await ensureInquiryLinks(selectedBroker, [selectedOrder])).get(String(selectedOrder.id));
      if (selectedOrder.inquiryToken !== token) saveLoad({ ...selectedOrder, inquiryToken: token });
      const url = getInquiryUrl(token);
      await copyToClipboard(url, 'Driver link');
      alert(`Driver link copied for load #${selectedOrder.id}:\n${url}\n\nPaste it into the load's BCO Posting Comments on Landstar, or text it to drivers. You'll get an email when a driver inquires.`);
    } catch (error) {
      console.error('Could not create the driver link:', error);
      alert(`Could not create the driver link: ${describeLinkError(error)}`);
    }
  };

  const handleExportToLandstar = async () => {
    setExportErrorIds([]);
    const exportPhone = profile.phone.replace(/\D/g, '');
    const exportVisibilityGroup = profile.visibilityGroup.trim().toUpperCase();
    if (exportPhone.length !== 10 || !profile.postingCode.trim() || !exportVisibilityGroup) {
      alert('Open ⚙ My Settings and enter your 10-digit phone number, posting code and visibility group before exporting.');
      openProfileSettings();
      return;
    }
    // Export everything on the current list, including loads already exported
    // (ENT) — re-posting the same loads to Landstar is allowed. Loads not on
    // the list are untouched; exported loads are (re)marked ENT below.
    const candidateLoads = selectedIds.length > 0
      ? orders.filter(o => selectedIds.includes(selectionKey(selectedBroker, o.id)))
      : filteredOrders;
    // Booked loads already have a truck; never post them to the Landstar board.
    const unbookedLoads = candidateLoads.filter(o => o.status !== 'BOOKED');
    const skippedBookedCount = candidateLoads.length - unbookedLoads.length;
    // RXO ATZ van loads picking up in skipped states are never posted.
    const notRxoSkipped = unbookedLoads.filter(o => !isRxoSkippedVanLoad(selectedBroker, o));
    const skippedRxoVanCount = unbookedLoads.length - notRxoSkipped.length;
    // RXO ATZ loads that pick up and deliver in the same city are never posted.
    const notSameCity = notRxoSkipped.filter(o => !isRxoSameCityLoad(selectedBroker, o));
    const skippedSameCityCount = notRxoSkipped.length - notSameCity.length;
    // Loads to or from Mexico are never posted.
    const notMexico = notSameCity.filter(o => !isMexicoLoad(o));
    const skippedMexicoCount = notSameCity.length - notMexico.length;
    // Intermodal ("INT") and oversized equipment is never posted.
    const loadsToExport = notMexico.filter(o => !isSkippableEquipment(o.eCode));
    const skippedEquipmentExportCount = notMexico.length - loadsToExport.length;

    if (loadsToExport.length === 0) {
      alert(skippedBookedCount || skippedRxoVanCount || skippedSameCityCount || skippedMexicoCount || skippedEquipmentExportCount
        ? `Nothing to export: ${[
          skippedBookedCount && `${skippedBookedCount} booked load(s)`,
          skippedRxoVanCount && `${skippedRxoVanCount} RXO van load(s) picking up in WI, IN, OH, MI, MN, SD, ND, UT or ID`,
          skippedSameCityCount && `${skippedSameCityCount} RXO load(s) picking up and delivering in the same city`,
          skippedMexicoCount && `${skippedMexicoCount} load(s) to or from Mexico`,
          skippedEquipmentExportCount && `${skippedEquipmentExportCount} intermodal (INT) or oversized load(s)`
        ].filter(Boolean).join(' and ')} are not exported to Landstar.`
        : 'No loads selected for export!');
      return;
    }

    // Make sure each exported load has a driver inquiry link (shown under its comment box,
    // for texting or pasting into BCO Posting Comments). It is NOT sent in column AA:
    // Landstar rejects any non-standard comment there. A failure never blocks the export.
    let inquiryTokens = new Map();
    let inquiryLinkError = '';
    try {
      inquiryTokens = await ensureInquiryLinks(selectedBroker, loadsToExport);
    } catch (error) {
      console.error('Could not create driver links for the export:', error);
      inquiryLinkError = describeLinkError(error);
    }
    const reExportCount = loadsToExport.filter(o => o.status === 'ENT').length;

    const normalizedBroker = normalizeCustomerName(selectedBroker).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const customerIdVal = normalizedBroker.includes('593772')
      ? '593772'
      : normalizedBroker.includes('1522166')
        ? '1522166'
        : isRxoCustomer(selectedBroker)
          ? '2429200'
          : (String(selectedBroker).match(/\b\d{5,8}\b/)?.[0] || '9999999');
    const isChCustomer = isCh593772Customer(selectedBroker);
    const allowMissingMiles = isChCustomer;
    let zipModule = null;
    try {
      zipModule = await import('zipcodes');
    } catch (error) {
      console.error('Could not load offline ZIP location data for the Landstar export:', error);
      alert('Could not load the offline ZIP location data needed for the Landstar export.');
      return;
    }
    const zipData = zipModule.default || zipModule;
    const lookupZip = zip => zipData.codes?.[zip] || null;
    const lookupCityState = (city, state) => {
      const extraCities = {
        'HAMBERG|ND': { zip: '58145', city: 'Hamberg', state: 'ND' },
        'ROSEMONT|IL': { zip: '60018', city: 'Rosemont', state: 'IL' },
        'MALTA|NY': { zip: '12020', city: 'Malta', state: 'NY' },
        // Delanco's ZIP is filed under neighboring Riverside in the offline data.
        'DELANCO|NJ': { zip: '08075', city: 'Delanco', state: 'NJ' },
        // Pembroke's ZIP 03275 is filed under Suncook (a village in Pembroke) in the offline data.
        'PEMBROKE|NH': { zip: '03275', city: 'Pembroke', state: 'NH' },
        // Broker lists abbreviate North Smithfield; the offline data only has the full name.
        'N SMITHFIELD|RI': { zip: '02896', city: 'North Smithfield', state: 'RI' },
        // Logan Township's ZIPs are filed under Swedesboro/Bridgeport in the offline data.
        'LOGAN TOWNSHIP|NJ': { zip: '08085', city: 'Logan Township', state: 'NJ' },
        // Woolwich Township's ZIP 08085 is also filed under Swedesboro in the offline data.
        'WOOLWICH TOWNSHIP|NJ': { zip: '08085', city: 'Woolwich Township', state: 'NJ' },
        // Trappe's ZIP 19426 is filed under Collegeville in the offline data.
        'TRAPPE|PA': { zip: '19426', city: 'Trappe', state: 'PA' },
        // Westampton's ZIP 08060 is filed under Mount Holly in the offline data.
        'WESTAMPTON|NJ': { zip: '08060', city: 'Westampton', state: 'NJ' },
        // East Windsor's ZIP 08520 is filed under Hightstown in the offline data.
        'EAST WINDSOR|NJ': { zip: '08520', city: 'East Windsor', state: 'NJ' },
        // Brentwood's ZIPs outside NY/MD/TN/CA are filed under neighboring cities in the offline data.
        'BRENTWOOD|MO': { zip: '63144', city: 'Brentwood', state: 'MO' },
        'BRENTWOOD|PA': { zip: '15227', city: 'Brentwood', state: 'PA' },
        'BRENTWOOD|NH': { zip: '03833', city: 'Brentwood', state: 'NH' }
      };
      const extraKey = `${String(city || '').trim().toUpperCase()}|${String(state || '').trim().toUpperCase()}`;
      if (extraCities[extraKey]) return extraCities[extraKey];
      const rawCity = String(city || '').trim();
      const cityName = rawCity
        .replace(/\bMT\.?\s+/gi, 'Mount ').replace(/\bST\.?\s+/gi, 'Saint ').replace(/\bFT\.?\s+/gi, 'Fort ');
      // Broker lists often abbreviate directions (N/S/E/W) or add suffixes the postal data omits.
      const expandedCity = cityName
        .replace(/^N\.?\s+/i, 'North ').replace(/^S\.?\s+/i, 'South ')
        .replace(/^E\.?\s+/i, 'East ').replace(/^W\.?\s+/i, 'West ');
      const strippedCity = expandedCity
        .replace(/\s+(Township|Twp|Borough|Boro|Village|City)$/i, '');
      const stateCode = String(state || '').trim();
      const exactMatches = [cityName, rawCity, rawCity.replace(/\./g, ''), expandedCity, strippedCity]
        .map(name => zipData.lookupByName?.(name, stateCode) || [])
        .find(matches => matches.length) || [];
      const prefixCounts = exactMatches.reduce((counts, location) => {
        const prefix = location.zip.slice(0, 3);
        counts[prefix] = (counts[prefix] || 0) + 1;
        return counts;
      }, {});
      const exactMatch = exactMatches.length > 1
        ? exactMatches.find(location => prefixCounts[location.zip.slice(0, 3)] > 1 && !location.zip.endsWith('00')) || exactMatches[0]
        : exactMatches[0];
      if (exactMatch) return exactMatch;

      const normalizeCity = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const normalizedCity = normalizeCity(cityName);
      if (normalizedCity.length < 5) return null;

      const prefixMatches = (zipData.lookupByState?.(stateCode) || [])
        .filter(location => normalizeCity(location.city).startsWith(normalizedCity));
      const matchingCities = Array.from(new Set(prefixMatches.map(location => normalizeCity(location.city))));
      return matchingCities.length === 1 ? prefixMatches[0] || null : null;
    };
    let representativeZipCount = 0;
    const representativeZipExamples = [];

    const validationErrors = [];
    const exportEntries = [];
    const earliestPickupSerial = getEarliestPickupSerial();
    const movedPickupStarts = [];
    loadsToExport.forEach(ord => {
      const rowErrors = [];
      const originState = String(ord.origSt || '').trim().toUpperCase();
      const destinationState = String(ord.destSt || '').trim().toUpperCase();
      const fuelSurchargeRate = getFuelSurchargeRate(profile.fuelSurcharge, originState);
      const originCountry = getCountryForRegion(originState);
      const destinationCountry = getCountryForRegion(destinationState);
      const enteredOriginZip = originCountry === 'CA'
        ? normalizeCanadianPostalCode(ord.origZip)
        : String(ord.origZip || '').replace(/\D/g, '').slice(0, 5);
      const enteredDestinationZip = destinationCountry === 'CA'
        ? normalizeCanadianPostalCode(ord.destZip)
        : String(ord.destZip || '').replace(/\D/g, '').slice(0, 5);
      const enteredOriginLocation = originCountry === 'US' && enteredOriginZip.length === 5
        ? lookupZip(enteredOriginZip)
        : null;
      const enteredDestinationLocation = destinationCountry === 'US' && enteredDestinationZip.length === 5
        ? lookupZip(enteredDestinationZip)
        : null;
      const originLocation = enteredOriginLocation || (originCountry === 'US' ? lookupCityState(ord.origCity, originState) : null);
      const destinationLocation = enteredDestinationLocation || (destinationCountry === 'US' ? lookupCityState(ord.destCity, destinationState) : null);
      const originZip = originCountry === 'CA'
        ? enteredOriginZip || lookupCanadianPostalCode(ord.origCity, originState)
        : originLocation?.zip || (enteredOriginLocation ? enteredOriginZip : '');
      const destinationZip = destinationCountry === 'CA'
        ? enteredDestinationZip || lookupCanadianPostalCode(ord.destCity, destinationState)
        : destinationLocation?.zip || (enteredDestinationLocation ? enteredDestinationZip : '');
      // A ZIP found from the city name means the postal spelling matched, so send that spelling to Landstar.
      // When a ZIP was entered directly, still correct the city to the ZIP's postal spelling when it is
      // clearly the same place (spacing/punctuation only, e.g. "McCordsville" -> "Mc Cordsville");
      // otherwise flag the mismatch below so Landstar's city/ZIP lookup does not reject the posting.
      const normalizeCityName = name => String(name || '').toUpperCase()
        .replace(/\bST\b\.?/g, 'SAINT').replace(/\bMT\b\.?/g, 'MOUNT').replace(/\bFT\b\.?/g, 'FORT')
        .replace(/[^A-Z0-9]/g, '');
      const cityMatchesPostalCity = (city, location) =>
        Boolean(location?.city) && normalizeCityName(city) === normalizeCityName(location.city);
      // An entered ZIP always wins: export its postal city and state (see getExportPlace).
      const originPlace = getExportPlace(ord.origCity, originState, enteredOriginLocation);
      const destinationPlace = getExportPlace(ord.destCity, destinationState, enteredDestinationLocation);
      const originCity = toLandstarCity(
        originPlace.fromZip
          ? originPlace.city
          : originLocation?.city || cityMatchesPostalCity(ord.origCity, originLocation)
            ? originLocation.city
            : getLandstarCity(ord.origCity, originLocation)
      );
      const destinationCity = toLandstarCity(
        destinationPlace.fromZip
          ? destinationPlace.city
          : destinationLocation?.city || cityMatchesPostalCity(ord.destCity, destinationLocation)
            ? destinationLocation.city
            : getLandstarCity(ord.destCity, destinationLocation)
      );
      const originStateMatchesZip = originPlace.fromZip || !ord.origSt || !originLocation || originState === originLocation.state;
      const destinationStateMatchesZip = destinationPlace.fromZip || !ord.destSt || !destinationLocation || destinationState === destinationLocation.state;
      const originZipWasResolved = !enteredOriginLocation && Boolean(originLocation);
      const destinationZipWasResolved = !enteredDestinationLocation && Boolean(destinationLocation);
      if (originZipWasResolved) representativeZipCount += 1;
      if (destinationZipWasResolved) representativeZipCount += 1;
      if ((originZipWasResolved || destinationZipWasResolved) && representativeZipExamples.length < 5) {
        representativeZipExamples.push(
          `${ord.id}: ${originZipWasResolved ? `${originCity}, ${originState} ${originZip}` : ''}${originZipWasResolved && destinationZipWasResolved ? ' → ' : ''}${destinationZipWasResolved ? `${destinationCity}, ${destinationState} ${destinationZip}` : ''}`
        );
      }
      const puParts = splitScheduleRange(ord.pickupTime);
      const delParts = splitScheduleRange(ord.deliveryTime);
      let pickupThru = toExcelDateTime(puParts[1] || puParts[0], puParts[0]);
      const pickupWindow = adjustPickupWindow(toExcelDateTime(puParts[0]), pickupThru, earliestPickupSerial);
      const pickupFrom = pickupWindow.from;
      // A single pickup time (no range) makes start == end, a zero-width window Landstar
      // rejects. Widen it to one hour so the posting is accepted.
      if (pickupFrom !== null && pickupThru !== null && pickupThru <= pickupFrom) {
        pickupThru = pickupFrom + (1 / 24);
      }
      if (pickupWindow.moved) movedPickupStarts.push(ord.id);
      const deliveryFrom = toExcelDateTime(delParts[0]);
      let deliveryThru = toExcelDateTime(delParts[1] || delParts[0], delParts[0]);
      // Same zero-width guard on the delivery side.
      if (deliveryFrom !== null && deliveryThru !== null && deliveryThru <= deliveryFrom) {
        deliveryThru = deliveryFrom + (1 / 24);
      }
      const equipment = getLandstarEquipmentCode(ord.eCode);
      const commodity = getLoadCommodity(ord);
      const miles = Number(normalizeMilesValue(ord.miles));
      const weight = parseWeightPounds(ord.weight);
      const quotedRate = Number(String(ord.rateInput || '').replace(/[$,]/g, ''));
      // RXO ATZ van loads priced from DAT post under the DAT rate (see getRxoAtzDatVanDiscount).
      const rate = quotedRate - getRxoAtzDatVanDiscount(selectedBroker, ord, quotedRate);
      const postingCode = String(ord.postingCode || profile.postingCode).trim().toUpperCase();
      const visibilityCode = exportVisibilityGroup;
      const brokerable = ['true', 'y'].includes(String(ord.brokerable || '').trim().toLowerCase()) ? 'Y' : 'N';
      const today = new Date();
      const todaySerial = (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(1899, 11, 30)) / 86400000;

      if (!ord.origCity && !originPlace.fromZip) rowErrors.push('origin city');
      if (!originPlace.fromZip && (!originState || !stateCodes.has(originState))) rowErrors.push('origin state/province');
      if (originCountry === 'CA' && !originZip) rowErrors.push('valid Canadian origin postal code');
      if (!originStateMatchesZip) rowErrors.push(`origin state must match ZIP ${originZip} (${originLocation.state})`);
      if (!ord.destCity && !destinationPlace.fromZip) rowErrors.push('destination city');
      if (!destinationPlace.fromZip && (!destinationState || !stateCodes.has(destinationState))) rowErrors.push('destination state/province');
      if (destinationCountry === 'CA' && !destinationZip) rowErrors.push('valid Canadian destination postal code');
      if (!destinationStateMatchesZip) rowErrors.push(`destination state must match ZIP ${destinationZip} (${destinationLocation.state})`);
      if (pickupFrom === null || pickupThru === null) {
        rowErrors.push(`pickup date/time (current value "${ord.pickupTime || ''}" — use MM/DD/YYYY HHMM - HHMM)`);
      }
      else if (pickupWindow.ended) rowErrors.push('pickup window has already ended (Landstar only accepts a pickup that is still open)');
      else if (pickupThru < pickupFrom) rowErrors.push('pickup end must be after pickup start');
      if (deliveryFrom === null || deliveryThru === null) rowErrors.push('delivery date and time');
      else if (deliveryThru < todaySerial) rowErrors.push('delivery end date cannot be in the past');
      else if (deliveryThru < deliveryFrom) rowErrors.push('delivery end must be after delivery start');
      if (pickupFrom !== null && deliveryFrom !== null && deliveryFrom <= pickupFrom) {
        rowErrors.push('delivery start must be later than pickup start');
      }
      if (!equipment) rowErrors.push('valid equipment');
      const equipmentChoices = [equipment, getLandstarEquipment2(ord), ord.equipment3].filter(Boolean);
      if (new Set(equipmentChoices).size !== equipmentChoices.length) rowErrors.push('distinct equipment choices (remove duplicate alternates)');
      if (equipment === 'D-LG' && equipmentChoices.includes('D-ST')) rowErrors.push('liftgate-required loads cannot offer D-ST as an alternate');
      if (!['CGAPP', 'HAZMAT', 'CHEM'].includes(commodity)) rowErrors.push('valid commodity');
      if (!allowMissingMiles && !(miles > 0)) rowErrors.push('miles');
      if (weight === null || weight > 999999) {
        rowErrors.push('weight (enter whole pounds from 1 to 999,999)');
      }
      if (!(rate > 0) || !['user-entered', 'dat-screenshot', 'dat-api'].includes(ord.rateSource)) {
        rowErrors.push('rate (enter a current DAT quote or import one via DAT API/screenshot)');
      }

      if (rowErrors.length) {
        validationErrors.push(`Order ${ord.id}: ${rowErrors.join(', ')}`);
        return;
      }

      exportEntries.push({ ord, record: {
        "Customer ID(Required)": customerIdVal,
        "Posting Call Back 10 Digits Phone Number": exportPhone,
        "Origin City": originCity,
        "Origin Zipcode(Required)": originZip,
        "Origin State": originPlace.state,
        "Origin Country(Required)": originCountry,
        "Destination City": destinationCity,
        "Destination Zipcode(Required)": destinationZip,
        "Destination State": destinationPlace.state,
        "Destination Country(Required)": destinationCountry,
        "Pickup Date (From)(Required)": pickupFrom,
        "Pickup Date (Thru)(Required)": pickupThru,
        "Delivery Date (From)(Required)": deliveryFrom,
        "Delivery Date (Thru)(Required)": deliveryThru,
        "Load Posting Code": postingCode,
        "Visibility Code": visibilityCode,
        "Bill as Miles": allowMissingMiles && !(miles > 0) ? '' : miles,
        "Equipment 1(Required)": equipment,
        "Equipment 2": getLandstarEquipment2(ord),
        "Equipment 3": ord.equipment3 || "",
        "Weight(Required)": weight ?? '',
        "Rate Type(Required)": "Flat Rate",
        "Rate(Required)": rate,
        "Commodity": getLandstarCommodityValue(commodity),
        "Brokerable": brokerable,
        "Carrier Amt": rate,
        "Carrier Load Alerts": "",
        // The Landstar template has no Team column; team is set through this attribute.
        "Load Attributes": [isHazmatLoad(ord) && 'Hazmat', isTeamLoad(ord) && 'Team Required'].filter(Boolean).join(', '),
        "Comments": getLandstarExportComment(ord),
        // FSC columns stay blank; the fuel surcharge is already removed from the linehaul rate.
        "Fuel Surcharge Rate Type": "",
        "Fuel Surcharge": "",
        "Team": isTeamLoad(ord) ? 'true' : 'false'
      } });
    });

    const failedIds = validationErrors
      .map(error => error.match(/^Order\s+([^:]+):/)?.[1])
      .filter(Boolean);
    if (failedIds.length) {
      setExportErrorIds(failedIds);
      const firstFailedOrder = loadsToExport.find(order => failedIds.includes(String(order.id)));
      if (firstFailedOrder) setSelectedOrder(firstFailedOrder);
    }

    const hasAllZips = record => Boolean(record['Origin Zipcode(Required)'] && record['Destination Zipcode(Required)']);
    const missingZipEntries = exportEntries.filter(({ record }) => !hasAllZips(record));
    const readyEntries = exportEntries.filter(({ record }) => hasAllZips(record));

    if (!readyEntries.length) {
      const problems = [];
      if (validationErrors.length) {
        const visibleErrors = validationErrors.slice(0, 10).join('\n');
        const additionalCount = validationErrors.length - 10;
        problems.push(`Landstar-required load data needs correction:\n\n${visibleErrors}${additionalCount > 0 ? `\n…and ${additionalCount} more load(s).` : ''}`);
      }
      if (missingZipEntries.length) {
        problems.push(`No ZIP code could be found for ${missingZipEntries.length} load${missingZipEntries.length === 1 ? '' : 's'}, and Landstar needs a ZIP to fill in the state. Enter the ZIP in the load's Origin or Destination ZIP field, then export again:\n\n${missingZipEntries.slice(0, 10).map(({ record }) => `${record['Origin City'] || ''} → ${record['Destination City'] || ''}`).join('\n')}`);
      }
      alert(`No loads could be exported.\n\n${problems.join('\n\n')}`);
      return;
    }

    const exportData = readyEntries.map(({ record }) => record);
    const exportedIds = new Set(readyEntries.map(({ ord }) => String(ord.id)));
    const exportBlobs = [];
    try {
      const templateResponse = await fetch(`${import.meta.env.BASE_URL}landstar-bulk-template.xlsx`);
      if (!templateResponse.ok) {
        throw new Error(`Template download returned HTTP ${templateResponse.status}.`);
      }
      const templateBytes = await templateResponse.arrayBuffer();
      for (let chunkStart = 0; chunkStart < exportData.length; chunkStart += landstarExportChunkSize) {
      const chunkData = exportData.slice(chunkStart, chunkStart + landstarExportChunkSize);
      const workbook = XLSX.read(templateBytes, { type: 'array' });
      const worksheet = workbook.Sheets.Loads;
      if (!worksheet) throw new Error('The Landstar template does not contain its required Loads sheet.');

      const range = XLSX.utils.decode_range(worksheet['!ref']);
      const headers = Array.from({ length: range.e.c + 1 }, (_, column) =>
        worksheet[XLSX.utils.encode_cell({ r: 0, c: column })]?.v
      );
      const normalizeHeader = header => String(header || '').replace(/[\r\n]/g, '').trim().toLowerCase();
      ['Origin State', 'Destination State'].forEach(header => {
        if (!headers.some(existing => normalizeHeader(existing) === normalizeHeader(header))) {
          headers.push(header);
        }
      });
      if (!headers.some(existing => normalizeHeader(existing) === 'team')) {
        headers.push('Team');
      }
      range.e.c = headers.length - 1;
      const headerIndexes = new Map(headers.map((header, index) => [normalizeHeader(header), index]));
      const requiredHeaders = ['Customer ID(Required)', 'Origin City', 'Load Posting Code', 'Commodity'];
      const missingHeaders = requiredHeaders.filter(header => !headerIndexes.has(normalizeHeader(header)));
      if (missingHeaders.length) {
        throw new Error(`The supplied Landstar template is missing required columns: ${missingHeaders.join(', ')}.`);
      }

      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(templateBytes);
      const mainNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
      const documentRelationshipsNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
      const packageRelationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
      const parser = new DOMParser();
      const serializer = new XMLSerializer();
      const parseXml = (xml, partName) => {
        const document = parser.parseFromString(xml, 'application/xml');
        if (document.getElementsByTagName('parsererror').length) {
          throw new Error(`The Landstar template contains invalid XML in ${partName}.`);
        }
        return document;
      };
      const workbookDocument = parseXml(
        await zip.file('xl/workbook.xml').async('string'),
        'xl/workbook.xml'
      );
      const relationshipsDocument = parseXml(
        await zip.file('xl/_rels/workbook.xml.rels').async('string'),
        'xl/_rels/workbook.xml.rels'
      );
      const loadsSheet = Array.from(workbookDocument.getElementsByTagNameNS(mainNamespace, 'sheet'))
        .find(sheet => sheet.getAttribute('name') === 'Loads');
      const relationshipId = loadsSheet?.getAttributeNS(documentRelationshipsNamespace, 'id');
      const loadsRelationship = Array.from(
        relationshipsDocument.getElementsByTagNameNS(packageRelationshipsNamespace, 'Relationship')
      ).find(relationship => relationship.getAttribute('Id') === relationshipId);
      if (!loadsRelationship) throw new Error('Could not locate the Loads worksheet in the Landstar template.');

      const worksheetTarget = loadsRelationship.getAttribute('Target');
      const worksheetPath = worksheetTarget.startsWith('/')
        ? worksheetTarget.slice(1)
        : `xl/${worksheetTarget}`;
      const worksheetFile = zip.file(worksheetPath);
      const sharedStringsFile = zip.file('xl/sharedStrings.xml');
      if (!worksheetFile || !sharedStringsFile) {
        throw new Error('The Landstar template is missing its Loads worksheet or shared-string table.');
      }

      const worksheetDocument = parseXml(await worksheetFile.async('string'), worksheetPath);
      const sharedStringsDocument = parseXml(
        await sharedStringsFile.async('string'),
        'xl/sharedStrings.xml'
      );
      const sheetData = worksheetDocument.getElementsByTagNameNS(mainNamespace, 'sheetData')[0];
      const sharedStrings = sharedStringsDocument.getElementsByTagNameNS(mainNamespace, 'sst')[0];
      if (!sheetData || !sharedStrings) {
        throw new Error('The Landstar template has an invalid Loads worksheet or shared-string table.');
      }

      const sharedItems = () => Array.from(sharedStrings.getElementsByTagNameNS(mainNamespace, 'si'));
      const getSharedStringText = item =>
        Array.from(item.getElementsByTagNameNS(mainNamespace, 't'))
          .map(text => text.textContent || '')
          .join('');
      const sharedStringIndexes = new Map(sharedItems().map((item, index) => [getSharedStringText(item), index]));
      let sharedStringReferenceDelta = 0;
      const getSharedStringIndex = value => {
        if (sharedStringIndexes.has(value)) return sharedStringIndexes.get(value);
        const item = sharedStringsDocument.createElementNS(mainNamespace, 'si');
        const text = sharedStringsDocument.createElementNS(mainNamespace, 't');
        if (value !== value.trim()) {
          text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        }
        text.textContent = value;
        item.appendChild(text);
        const index = sharedItems().length;
        sharedStrings.appendChild(item);
        sharedStringIndexes.set(value, index);
        return index;
      };

      const rows = Array.from(sheetData.getElementsByTagNameNS(mainNamespace, 'row'));
      const rowByNumber = new Map(rows.map(row => [Number(row.getAttribute('r')), row]));
      const templateRow = rowByNumber.get(2);
      if (!templateRow) throw new Error('The Landstar template does not include its first load row.');
      const getOrCreateRow = rowNumber => {
        if (rowByNumber.has(rowNumber)) return rowByNumber.get(rowNumber);
        const newRow = templateRow.cloneNode(true);
        newRow.setAttribute('r', String(rowNumber));
        Array.from(newRow.getElementsByTagNameNS(mainNamespace, 'c')).forEach(cell => {
          cell.setAttribute('r', cell.getAttribute('r').replace(/\d+$/, String(rowNumber)));
        });
        const nextRow = Array.from(sheetData.getElementsByTagNameNS(mainNamespace, 'row'))
          .find(row => Number(row.getAttribute('r')) > rowNumber);
        sheetData.insertBefore(newRow, nextRow || null);
        rowByNumber.set(rowNumber, newRow);
        return newRow;
      };
      const getOrCreateCell = (row, rowNumber, column) => {
        const address = XLSX.utils.encode_cell({ r: rowNumber - 1, c: column });
        const existingCell = Array.from(row.getElementsByTagNameNS(mainNamespace, 'c'))
          .find(cell => cell.getAttribute('r') === address);
        if (existingCell) return existingCell;

        const cell = worksheetDocument.createElementNS(mainNamespace, 'c');
        cell.setAttribute('r', address);
        const nextCell = Array.from(row.getElementsByTagNameNS(mainNamespace, 'c'))
          .find(candidate => XLSX.utils.decode_cell(candidate.getAttribute('r')).c > column);
        row.insertBefore(cell, nextCell || null);
        return cell;
      };
      const setCellValue = (cell, value) => {
        const previousType = cell.getAttribute('t');
        if (previousType === 's') sharedStringReferenceDelta -= 1;
        Array.from(cell.children)
          .filter(child => ['f', 'v', 'is'].includes(child.localName))
          .forEach(child => cell.removeChild(child));

        if (value === '' || value == null) {
          cell.removeAttribute('t');
          return;
        }

        const valueElement = worksheetDocument.createElementNS(mainNamespace, 'v');
        if (typeof value === 'number') {
          cell.removeAttribute('t');
          valueElement.textContent = String(value);
        } else {
          cell.setAttribute('t', 's');
          valueElement.textContent = String(getSharedStringIndex(String(value)));
          sharedStringReferenceDelta += 1;
        }
        cell.appendChild(valueElement);
      };

      const headerRow = getOrCreateRow(1);
      headers.forEach((header, column) => {
        setCellValue(getOrCreateCell(headerRow, 1, column), header);
      });

      for (let rowNumber = 2; rowNumber <= range.e.r + 1; rowNumber += 1) {
        const row = rowByNumber.get(rowNumber);
        if (!row) continue;
        Array.from(row.getElementsByTagNameNS(mainNamespace, 'c'))
          .forEach(cell => setCellValue(cell, ''));
      }

      chunkData.forEach((record, recordIndex) => {
        const rowNumber = recordIndex + 2;
        const row = getOrCreateRow(rowNumber);
        const recordValues = new Map(
          Object.entries(record).map(([header, value]) => [normalizeHeader(header), value])
        );
        headers.forEach((header, column) => {
          const value = recordValues.get(normalizeHeader(header)) ?? '';
          setCellValue(getOrCreateCell(row, rowNumber, column), value);
        });
      });

      const lastDataRow = chunkData.length + 1;
      const dimensions = worksheetDocument.getElementsByTagNameNS(mainNamespace, 'dimension');
      if (dimensions.length) {
        dimensions[0].setAttribute(
          'ref',
          `A1:${XLSX.utils.encode_col(range.e.c)}${Math.max(lastDataRow, range.e.r + 1)}`
        );
      }
      if (lastDataRow > 26) {
        Array.from(worksheetDocument.getElementsByTagNameNS(mainNamespace, 'dataValidation'))
          .forEach(validation => {
            validation.setAttribute(
              'sqref',
              validation.getAttribute('sqref').replace(/T2:T26/g, `T2:T${lastDataRow}`)
            );
          });
      }

      const sharedStringCount = Number(sharedStrings.getAttribute('count'));
      sharedStrings.setAttribute(
        'count',
        String((Number.isFinite(sharedStringCount) ? sharedStringCount : 0) + sharedStringReferenceDelta)
      );
      sharedStrings.setAttribute('uniqueCount', String(sharedItems().length));
      zip.file(worksheetPath, serializer.serializeToString(worksheetDocument));
      zip.file('xl/sharedStrings.xml', serializer.serializeToString(sharedStringsDocument));
      exportBlobs.push(await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      }));
      }
    } catch (error) {
      console.error('Could not prepare the official Landstar bulk template:', error);
      alert(`Could not create a spreadsheet from the official Landstar template: ${error.message || 'Please try again.'}`);
      return;
    }

    try {
      const brokerSlug = selectedBroker.replace(/[^a-zA-Z0-9]/g, '_');
      for (let index = 0; index < exportBlobs.length; index += 1) {
        const downloadUrl = URL.createObjectURL(exportBlobs[index]);
        const downloadLink = document.createElement('a');
        downloadLink.href = downloadUrl;
        downloadLink.download = exportBlobs.length > 1
          ? `Landstar_Bulk_${brokerSlug}_${index + 1}of${exportBlobs.length}.xlsx`
          : `Landstar_Bulk_${brokerSlug}.xlsx`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
        // Browsers may drop rapid consecutive downloads; space them out slightly.
        if (index < exportBlobs.length - 1) await new Promise(resolve => setTimeout(resolve, 400));
      }
      playExportSound();
      if (exportBlobs.length > 1) {
        alert(`${exportBlobs.length} spreadsheets were created (up to ${landstarExportChunkSize} loads each). If your browser asks, allow multiple downloads for this site.`);
      }
      if (skippedBookedCount) {
        alert(`${skippedBookedCount} booked load${skippedBookedCount === 1 ? ' was' : 's were'} left out of the Landstar export.`);
      }
      if (inquiryLinkError) console.error(`Driver links were not created: ${inquiryLinkError}`);
    } catch (error) {
      console.error('Could not create the Landstar bulk spreadsheet:', error);
      alert('The Landstar bulk spreadsheet could not be created. Please try again.');
      return;
    }

    const exportedAt = new Date().toISOString();
    const registryKey = normalizeCustomerName(selectedBroker);
    const latestRegistry = getLatestExportedRegistry();
    const previousRecords = getExportedRecordsForCustomer(latestRegistry, selectedBroker);
    const nextExportedRecords = {
      ids: Array.from(new Set([
        ...previousRecords.ids,
        ...readyEntries.map(({ ord }) => normalizeLoadId(ord.id))
      ])),
      laneDays: Array.from(new Set([
        ...(previousRecords.laneDays || []),
        ...readyEntries.map(({ ord }) => createLaneDayKey(ord)).filter(Boolean)
      ]))
    };
    const nextExportedRegistry = { ...latestRegistry, [registryKey]: nextExportedRecords };
    let exportedRegistrySaved = true;
    try {
      writeSyncedKey('landstar_exportedLoads', JSON.stringify(nextExportedRegistry));
      setExportedLoadRegistry(nextExportedRegistry);
    } catch (error) {
      exportedRegistrySaved = false;
      console.error('Could not save exported load records:', error);
    }
    // Remember exactly what was posted, so the bot can find and remove the posting
    // later if the load drops off the customer's list.
    const postingsById = new Map(readyEntries.map(({ ord, record }) => [String(ord.id), buildLandstarPosting(record)]));
    const nextOrders = {
      ...customerOrdersMap,
      [selectedBroker]: markLoadsExported(orders, exportedIds, exportedAt).map(load => {
        const posting = postingsById.get(String(load.id));
        const withPosting = posting ? {
          ...load, landstarPosting: { ...posting, refreshDetails: getPostingRefreshDetails(load) }
        } : load;
        return inquiryTokens.has(String(load.id)) ? { ...withPosting, inquiryToken: inquiryTokens.get(String(load.id)) } : withPosting;
      })
    };
    const saved = persistAppData(brokers, nextOrders);
    setRateHistory(recordExportedRates(selectedBroker, readyEntries.map(({ ord }) => ord)));
    setExportErrorIds(failedIds);
    setCustomerOrdersMap(nextOrders);
    setSelectedIds(prev => prev.filter(id => !exportedIds.has(String(id))));
    setSelectedOrder(
      selectedOrder && exportedIds.has(String(selectedOrder.id))
        ? nextOrders[selectedBroker].find(order => String(order.id) === String(selectedOrder.id)) || selectedOrder
        : selectedOrder || nextOrders[selectedBroker][0] || null
    );

    const skippedNotes = [];
    if (skippedRxoVanCount) {
      skippedNotes.push(`Left out ${skippedRxoVanCount} RXO van load(s) picking up in WI, IN, OH, MI, MN, SD, ND, UT or ID (not posted for RXO).`);
    }
    if (skippedSameCityCount) {
      skippedNotes.push(`Left out ${skippedSameCityCount} RXO load(s) picking up and delivering in the same city (not posted for RXO).`);
    }
    if (skippedMexicoCount) {
      skippedNotes.push(`Left out ${skippedMexicoCount} load(s) to or from Mexico (never posted).`);
    }
    if (skippedEquipmentExportCount) {
      skippedNotes.push(`Left out ${skippedEquipmentExportCount} intermodal (INT) or oversized load(s) (never posted).`);
    }
    if (movedPickupStarts.length) {
      skippedNotes.push(`Moved the pickup start to now for ${movedPickupStarts.length} load(s) whose pickup window had already started (Landstar rejects a past pickup start). The pickup end time is unchanged.`);
    }
    if (reExportCount > 0) {
      skippedNotes.push(`Re-exported ${reExportCount} load(s) that were already posted to Landstar (ENT). They stay ENT.`);
    }
    if (validationErrors.length) {
      const visibleErrors = validationErrors.slice(0, 10).join('\n');
      const additionalCount = validationErrors.length - 10;
      skippedNotes.push(`Skipped ${validationErrors.length} load(s) that need correction (they stay open and selected):\n\n${visibleErrors}${additionalCount > 0 ? `\n…and ${additionalCount} more load(s).` : ''}`);
    }
    if (missingZipEntries.length) {
      skippedNotes.push(`Skipped ${missingZipEntries.length} load(s) with no ZIP code (enter the Origin/Destination ZIP and export again):\n\n${missingZipEntries.slice(0, 10).map(({ record }) => `${record['Origin City'] || ''} → ${record['Destination City'] || ''}`).join('\n')}`);
    }
    const exportWarnings = [
      ...skippedNotes,
      saved ? '' : 'Browser storage could not be updated, so the archive may not persist after refresh.',
      exportedRegistrySaved ? '' : 'Warning: exported-load history could not be saved, so duplicate imports may occur after refresh.'
    ].filter(Boolean).join('\n\n');
    if (exportWarnings) alert(exportWarnings);
  };

  const isGlobalSearch = Boolean(searchQuery.trim());
  const isAllCustomersView = isGlobalSearch || filter === 'OFFER';
  const handleGlobalSearch = value => {
    setSearchQuery(value);
    if (value.trim()) setView('loads');
  };
  const statusOrderEntries = getLoadSearchEntries(customerOrdersMap, selectedBroker, searchQuery, filter === 'OFFER')
    .filter(({ order: ord }) => isGlobalSearch || filter === 'ALL' || ord.status === filter);
  const rateCountOrders = statusOrderEntries.filter(({ customer }) => filter === 'OFFER' || customer === selectedBroker).map(({ order }) => order);
  const withRateCount = rateCountOrders.filter(hasLoadRate).length;
  const noRateCount = rateCountOrders.length - withRateCount;
  const minMilesFilter = Number(loadFilters.minMiles);
  const maxMilesFilter = Number(loadFilters.maxMiles);
  const hasMinMiles = loadFilters.minMiles !== '' && Number.isFinite(minMilesFilter);
  const hasMaxMiles = loadFilters.maxMiles !== '' && Number.isFinite(maxMilesFilter);
  const visibleOrderEntries = statusOrderEntries.filter(({ order: ord }) => {
    if (isGlobalSearch) return true;
    if (loadFilters.pickupState && String(ord.origSt || '').trim().toUpperCase() !== loadFilters.pickupState) return false;
    if (loadFilters.deliveryState && String(ord.destSt || '').trim().toUpperCase() !== loadFilters.deliveryState) return false;
    if (loadFilters.pickupDate && getPickupDay(ord) !== loadFilters.pickupDate) return false;
    if (loadFilters.rate === 'with' && !hasLoadRate(ord)) return false;
    if (loadFilters.rate === 'without' && hasLoadRate(ord)) return false;
    if (hasMinMiles || hasMaxMiles) {
      const miles = Number(normalizeMilesValue(ord.miles));
      if (hasMinMiles && !(miles >= minMilesFilter)) return false;
      if (hasMaxMiles && !(miles <= maxMilesFilter)) return false;
    }
    return true;
  }).sort(({ order: left }, { order: right }) => {
    const priority = Number(Boolean(String(right.needsCapacity || '').trim()))
      - Number(Boolean(String(left.needsCapacity || '').trim()));
    if (priority) return priority;
    if (!laneSort || laneSort === 'pickup-asc' || laneSort === 'pickup-desc') {
      const difference = getPickupSortValue(left) - getPickupSortValue(right);
      return (laneSort === 'pickup-desc' ? -difference : difference)
        || String(left.id).localeCompare(String(right.id), undefined, { numeric: true });
    }
    const descending = laneSort.endsWith('-desc');
    const sortKey = laneSort.replace(/-asc$|-desc$/, '');
    const isOrigin = sortKey.startsWith('origin');
    const [leftCity, leftState] = isOrigin
      ? [left.origCity, left.origSt]
      : [left.destCity, left.destSt];
    const [rightCity, rightState] = isOrigin
      ? [right.origCity, right.origSt]
      : [right.destCity, right.destSt];
    const stateFirst = sortKey.endsWith('-state');
    const leftLocation = stateFirst ? [leftState, leftCity] : [leftCity, leftState];
    const rightLocation = stateFirst ? [rightState, rightCity] : [rightCity, rightState];
    const comparison = leftLocation.map(value => String(value || '').trim()).join(', ').localeCompare(
      rightLocation.map(value => String(value || '').trim()).join(', '),
      undefined,
      { sensitivity: 'base', numeric: true }
    );
    return (descending ? -comparison : comparison) || String(left.id).localeCompare(String(right.id));
  });
  const filteredOrders = visibleOrderEntries
    .filter(({ customer }) => customer === selectedBroker)
    .map(({ order }) => order);

  const handleSelectSearchResult = (customer, order) => {
    if (customer !== selectedBroker) {
      setSelectedBroker(customer);
      setSelectedIds([]);
      setExportErrorIds([]);
    }
    setSelectedOrder(order);
    // Phone: the load details sit under the list, so jump down to them.
    if (isPhoneScreen()) {
      setTimeout(() => document.querySelector('.tms-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  };

  const handleFieldChange = (field, value) => {
    handleInputChange(field, value);
  };

  const handleRateKeyDown = event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const rate = Number(String(selectedOrder?.rateInput || '').replace(/[$,]/g, ''));
    if (!(rate > 0) || !Number.isFinite(rate)) return;

    const currentIndex = filteredOrders.findIndex(order => order.id === selectedOrder.id);
    const nextOrder = currentIndex >= 0 ? filteredOrders[currentIndex + 1] : null;
    if (nextOrder) setSelectedOrder(nextOrder);
  };

  const entCount = orders.filter(o => o.status === 'ENT').length;
  const bookedCount = orders.filter(o => o.status === 'BOOKED').length;
  const offerCount = Object.values(customerOrdersMap || {}).flat().filter(o => o?.status === 'OFFER').length;
  const allBookedCount = Object.values(customerOrdersMap || {}).flat().filter(o => o?.status === 'BOOKED').length;
  const driverDirectory = buildDriverDirectory(customerOrdersMap);

  const handleBackupExport = () => {
    const data = {};
    Object.keys(localStorage)
      .filter(key => key.startsWith('landstar_') && key !== 'landstar_gmailClientId')
      .forEach(key => { data[key] = localStorage.getItem(key); });
    const blob = new Blob([JSON.stringify({ app: 'landstar-tms-reader', savedAt: new Date().toISOString(), data })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `landstar-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Replaces the whole load list with a saved copy from History; customers in the copy
  // are added back to the customer list. Returns false when it could not be saved.
  const restoreLoadListSnapshot = snapshotValue => {
    let parsed;
    try {
      parsed = JSON.parse(snapshotValue);
    } catch (error) {
      return false;
    }
    // Never fall back to the sample loads for a damaged copy.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const nextOrders = removeExpiredExportedLoads(normalizeCustomerOrders(parsed));
    const nextBrokers = normalizeBrokerList([...brokers, ...Object.keys(nextOrders)]);
    const saved = persistAppData(nextBrokers, nextOrders);
    if (!saved) return false;
    setBrokers(nextBrokers);
    setCustomerOrdersMap(nextOrders);
    setSelectedOrder((nextOrders[selectedBroker] || [])[0] || null);
    return true;
  };

  const handleBackupImport = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const entries = Object.entries(backup?.data || {})
        .filter(([key, value]) => key.startsWith('landstar_') && typeof value === 'string');
      if (backup?.app !== 'landstar-tms-reader' || entries.length === 0) {
        throw new Error('This is not a Landstar TMS backup file.');
      }
      if (!window.confirm(`Restore this backup (${new Date(backup.savedAt).toLocaleString()})? It will replace the customers, loads, rates and exported-load history in this browser.`)) return;
      entries.forEach(([key, value]) => localStorage.setItem(key, value));
      // Bump restored keys so other tabs and devices adopt the backup instead of
      // treating it as a regression from an outdated app version.
      const versions = readDataVersions();
      entries.forEach(([key]) => {
        if (syncedDataKeys.includes(key)) versions[key] = (versions[key] || 0) + 1;
      });
      localStorage.setItem(dataVersionKey, JSON.stringify(versions));
      window.location.reload();
    } catch (error) {
      alert(`Could not restore the backup: ${error.message}`);
    }
  };

  return (
    <div className="tms-shell flex flex-col md:flex-row min-h-screen md:h-screen text-white overflow-x-hidden md:overflow-hidden font-sans">
      <TruckLights />
      {/* Left Sidebar - Order List */}
      <div className="tms-sidebar w-full md:w-96 border-b md:border-b-0 md:border-r border-[#1c2541] flex flex-col">
        <div className="tms-sidebar-header p-3 border-b border-[#1c2541]">
          <ToolsDrawer selected={selectedBroker} count={brokers.length}>
          <div className="tms-top-controls flex flex-col items-start gap-2 mb-2">
            <button
              type="button"
              onClick={() => setShowTools(open => !open)}
              aria-expanded={showTools}
              className="text-[10px] font-bold text-gray-300 hover:text-white self-start"
            >
              {showTools ? '▾ Hide tools' : '▸ Show tools'}
            </button>
            {showTools && (
            <div className="tms-toolbox">
              <div className="tms-tool-group">
                <span className="tms-tool-label">Import</span>
                <div className="tms-tool-row">
                  <button
                    type="button"
                    onClick={handleAddManualLoad}
                    className="tms-tool"
                    data-accent="emerald"
                    title="Add one load by hand to the selected customer and fill it in. It stays until you delete it: importing the customer's list never removes it."
                  >
                    ＋ Add Load
                  </button>
                  <label className={`tms-tool cursor-pointer ${isImportingScreenshot ? 'opacity-60 cursor-wait' : ''}`} data-accent="emerald" title="AI Screenshot Import">
                    <span>{isImportingScreenshot && screenshotImportMode === 'ai' ? screenshotImportProgress : '✨ Customer Screenshot'}</span>
                    <input type="file" accept="image/*" onChange={handleScreenshotImport} className="hidden" disabled={isImportingScreenshot} />
                  </label>
                  <button
                    type="button"
                    onClick={handlePasteNtgScreenshot}
                    disabled={isImportingScreenshot}
                    className="tms-tool"
                    data-accent="amber"
                    title="Take a snip with Win+Shift+S, then paste it here without saving a file. You can also click the app background and press Ctrl+V. Imports into the selected customer."
                  >
                    Paste NTG Screenshot
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePasteScreenshot('dat')}
                    disabled={isImportingScreenshot}
                    className="tms-tool"
                    data-accent="indigo"
                    title="Take a snip of the DAT load board with Win+Shift+S, then paste it here without saving a file. Imports into the selected customer."
                  >
                    {isImportingScreenshot && screenshotImportMode === 'dat' ? screenshotImportProgress : 'Paste DAT Screenshot'}
                  </button>
                  <label className="tms-tool cursor-pointer" data-accent="sky" title="Import Excel Spreadsheet">
                    <span>📂 Import Excel</span>
                    <input type="file" accept=".xlsx, .xls, .csv" multiple onChange={handleExcelImport} className="hidden" />
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsGmailImportOpen(open => !open)}
                    className="tms-tool"
                    data-accent="rose"
                    title="Search Gmail for loads"
                  >
                    Import Gmail
                  </button>
                </div>
              </div>
              <div className="tms-tool-group">
                <span className="tms-tool-label">Data</span>
                <div className="tms-tool-row">
                  <button
                    type="button"
                    onClick={handleBackupExport}
                    className="tms-tool"
                    data-accent="slate"
                    title="Download all customers, loads and rates as a backup file"
                  >
                    💾 Backup
                  </button>
                  <label className="tms-tool cursor-pointer" data-accent="slate" title="Restore customers, loads and rates from a backup file">
                    <span>📤 Restore</span>
                    <input type="file" accept=".json,application/json" onChange={handleBackupImport} className="hidden" />
                  </label>
                  <LoadListHistory onRestore={restoreLoadListSnapshot} />
                  <Prospects />
                </div>
              </div>
            </div>
            )}
          </div>

          {isGmailImportOpen && (
            <div className="mb-3 rounded border border-red-700/60 bg-[#0b132b] p-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-white">Gmail Load Import</span>
                <button
                  type="button"
                  onClick={() => setIsGmailImportOpen(false)}
                  className="text-xs text-gray-400 hover:text-white"
                  aria-label="Close Gmail import"
                >
                  Close
                </button>
              </div>
              <p className="text-[10px] leading-relaxed text-gray-400 mb-2">
                Setup required once: in Google Cloud Console, create a project, enable Gmail API, configure the OAuth consent screen and create an OAuth Client ID for a Web application. Add this app’s origin (localhost:5173 and your deployed origin) to Authorized JavaScript origins. Do not enter a client secret here.
              </p>
              <label className="block text-[10px] text-gray-400 mb-1" htmlFor="gmail-client-id">Google OAuth Web client ID</label>
              <input
                id="gmail-client-id"
                type="text"
                value={gmailClientId}
                onChange={event => setGmailClientId(event.target.value)}
                placeholder="...apps.googleusercontent.com"
                className="w-full bg-[#161f36] border border-[#1c2541] rounded p-1.5 text-xs text-white placeholder-gray-500 mb-2"
              />
              <label className="block text-[10px] text-gray-400 mb-1" htmlFor="gmail-search-query">Gmail search query</label>
              <input
                id="gmail-search-query"
                type="text"
                value={gmailQuery}
                onChange={event => setGmailQuery(event.target.value)}
                placeholder="newer_than:7d or from:sender@example.com"
                className="w-full bg-[#161f36] border border-[#1c2541] rounded p-1.5 text-xs text-white placeholder-gray-500 mb-2"
              />
              <p className="text-[10px] text-gray-500 mb-2">
                Imports only the newest email matching this query. Only requests Gmail read-only access after you authorize Google. Pickup date comes from date headings; delivery dates are left blank if absent.
              </p>
              <p className="text-[10px] text-amber-300 mb-2">
                Every import calculates driving miles with Google Routes for all customers, replacing the miles on the import. Enable the Routes API and configure GOOGLE_MAPS_API_KEY on the server (or in your local .env file); never put the key in browser code.
              </p>
              {gmailImportProgress && <p role="status" className="text-[10px] text-amber-300 mb-2">{gmailImportProgress}</p>}
              <button
                type="button"
                onClick={handleGmailImport}
                disabled={!gmailAuthReady || gmailImportProgress.startsWith('Searching') || gmailImportProgress.startsWith('Reading') || gmailImportProgress.startsWith('Calculating')}
                className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-wait px-2 py-1.5 text-xs font-bold rounded text-white"
              >
                {gmailImportProgress && gmailImportProgress.startsWith('Reading')
                  ? gmailImportProgress
                  : gmailAuthReady ? 'Authorize Gmail & Import Matching Loads' : 'Loading Google Authorization...'}
              </button>
            </div>
          )}

          {/* Customer / Broker Buttons */}
          <div className="tms-customers-section flex flex-col gap-1.5 my-2">
            <button
              type="button"
              onClick={() => setShowCustomers(open => !open)}
              aria-expanded={showCustomers}
              className="text-[11px] text-gray-400 font-bold uppercase tracking-wider hover:text-white text-left"
            >
              {showCustomers ? '▾' : '▸'} Customers / Brokers ({brokers.length})
            </button>
            {showCustomers && brokers.map(broker => (
              editingBroker === broker ? (
                <form key={broker} onSubmit={(e) => handleSaveEditBroker(broker, e)} className="flex items-center space-x-1 w-full">
                  <input
                    type="text"
                    value={editBrokerInput}
                    onChange={(e) => setEditBrokerInput(e.target.value)}
                    autoFocus
                    className="bg-[#0b132b] border border-blue-500 rounded px-2 py-1 text-[11px] text-white outline-none flex-1"
                  />
                  <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 text-[11px] rounded font-bold">Save</button>
                  <button type="button" onClick={() => setEditingBroker(null)} className="bg-gray-600 hover:bg-gray-500 text-white px-1.5 py-1 text-[11px] rounded">Cancel</button>
                </form>
              ) : (
                <div
                  key={broker}
                  draggable
                  title="Drag to change the order"
                  onDragStart={event => {
                    event.dataTransfer.setData(customerDragType, broker);
                    event.dataTransfer.effectAllowed = 'move';
                    event.currentTarget.classList.add('is-dragging');
                  }}
                  onDragEnd={event => event.currentTarget.classList.remove('is-dragging')}
                  onDragOver={event => {
                    if (![...event.dataTransfer.types].includes(customerDragType)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    event.currentTarget.classList.add('is-drop-target');
                  }}
                  onDragLeave={event => event.currentTarget.classList.remove('is-drop-target')}
                  onDrop={event => {
                    event.preventDefault();
                    event.currentTarget.classList.remove('is-drop-target');
                    const dragged = event.dataTransfer.getData(customerDragType);
                    if (dragged && dragged !== broker) setBrokers(current => moveCustomer(current, dragged, broker));
                  }}
                  className={`tms-customer flex items-center justify-between px-2.5 py-1.5 text-[11px] rounded font-medium border transition-colors ${selectedBroker === broker ? 'bg-blue-600/30 border-blue-500 text-white' : 'bg-[#1c2541] border-[#253259] text-gray-300 hover:bg-[#253259]'}`}
                  data-selected={selectedBroker === broker}
                >
                  <span className="tms-drag-handle" aria-hidden="true">⠿</span>
                  <span
                    className="truncate flex-1 cursor-pointer"
                    data-close-drawer
                    onClick={() => handleSelectBroker(broker)}
                    title={sharedCustomers[broker] ? 'Shared customer – teammates see the same loads' : undefined}
                  >
                    {sharedCustomers[broker] && '🤝 '}{broker} {selectedBroker === broker && ' ✓'}
                  </span>
                  <div className="flex items-center space-x-1 ml-2">
                    {sharing && (
                      <button
                        onClick={() => openShareDialog(broker)}
                        title="Share this customer with teammates"
                        className="bg-slate-700 hover:bg-emerald-600 text-gray-200 hover:text-white px-1.5 py-0.5 rounded text-[10px]"
                      >
                        🤝 Share
                      </button>
                    )}
                    <button
                      onClick={() => { setEditingBroker(broker); setEditBrokerInput(broker); }}
                      title="Edit Customer"
                      className="bg-slate-700 hover:bg-blue-600 text-gray-200 hover:text-white px-1.5 py-0.5 rounded text-[10px]"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={(e) => handleDeleteBroker(broker, e)}
                      title="Delete Customer"
                      className="bg-slate-700 hover:bg-red-600 text-gray-200 hover:text-white px-1.5 py-0.5 rounded text-[10px]"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            ))}

            {showCustomers && (isAddingBroker ? (
              <form onSubmit={handleAddBroker} className="flex items-center space-x-1 mt-1 w-full">
                <input
                  type="text"
                  placeholder="Customer ID / Name..."
                  value={newBrokerInput}
                  onChange={(e) => setNewBrokerInput(e.target.value)}
                  autoFocus
                  className="bg-[#0b132b] border border-blue-500 rounded px-2 py-1 text-[11px] text-white outline-none flex-1"
                />
                <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 text-[11px] rounded font-bold">Add</button>
                <button type="button" onClick={() => setIsAddingBroker(false)} className="bg-gray-600 hover:bg-gray-500 text-white px-1.5 py-1 text-[11px] rounded">Cancel</button>
              </form>
            ) : (
              <button
                onClick={() => setIsAddingBroker(true)}
                className="mt-1 px-2.5 py-1 text-[11px] rounded font-medium bg-[#1c2541] hover:bg-blue-600 text-blue-300 hover:text-white transition-colors text-left"
              >
                + Add Customer
              </button>
            ))}
          </div>

          </ToolsDrawer>

          <div className="relative mb-2">
            <input
              type="text"
              placeholder="🔍 Search all customers: load #, city, state..."
              aria-label="Search loads across all customers"
              value={searchQuery}
              onChange={(e) => handleGlobalSearch(e.target.value)}
              className="w-full bg-[#0b132b] border-2 border-blue-500/60 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-400 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/40"
            />
          </div>
          {isGlobalSearch && (
            <p className="mb-2 text-[10px] text-gray-400">
              All customers · All folders and load statuses · All filters are ignored while searching. Click a result to open its customer.
              Bulk selection and export apply to the selected customer only.
            </p>
          )}

          <div className="flex items-center justify-between text-[11px] text-gray-400 mb-2">
            <span>{isAllCustomersView ? `${visibleOrderEntries.length} ${isGlobalSearch ? 'matches' : 'offers'} · All customers` : `${filteredOrders.length} shown · ${orders.length} loads · ${entCount} ENT · ${bookedCount} booked`}</span>
            <span className={storageError ? 'text-amber-400' : 'text-emerald-400'} title={storageError || 'Loads are saved in this browser.'}>
              {storageError || '🔒 Saved in this browser'}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
            <div className="flex flex-wrap gap-1">
              {['ALL', 'OPEN', 'ON HOLD', 'OFFER', 'ENT', 'BOOKED'].map(tab => (
                <button
                  key={tab}
                  onClick={() => {
                    // BOOKED opens its page; OFFER filters this list across all customers.
                    if (tab === 'BOOKED') {
                      setView('booked');
                    } else {
                      setFilter(tab);
                      setView('loads');
                    }
                  }}
                  title={tab === 'BOOKED' ? 'Open the Booked Loads page: every load with a driver, all customers' : tab === 'OFFER' ? 'Show offers across all customers' : undefined}
                  className={`px-2 py-1 text-[11px] rounded font-semibold ${tab === 'OPEN' ? `tms-open ${filter === tab ? 'ring-2 ring-emerald-200' : ''}` : tab === 'ENT' ? `tms-ent ${filter === tab ? 'ring-2 ring-yellow-200' : ''}` : tab === 'ON HOLD' ? filter === tab ? 'bg-red-600 text-white ring-2 ring-red-300' : 'bg-red-700 hover:bg-red-600 text-white' : tab === 'BOOKED' ? filter === tab ? 'bg-purple-600 text-white ring-2 ring-purple-300' : 'bg-purple-700 hover:bg-purple-600 text-white' : filter === tab ? 'bg-blue-600 text-white' : 'bg-[#1c2541] text-gray-400'}`}
                >
                  {tab === 'BOOKED' ? `BOOKED (${allBookedCount})` : tab === 'OFFER' ? `OFFER (${offerCount})` : tab}
                </button>
              ))}
            </div>
            {selectedIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 w-full">
                <span className="text-[10px] text-gray-400">Move to:</span>
                {['OPEN', 'ON HOLD', 'OFFER', 'ENT'].map(status => (
                  <button
                    key={status}
                    onClick={() => handleMoveSelected(status)}
                    title={`Move ${selectedIds.length} selected load${selectedIds.length === 1 ? '' : 's'} to ${status}`}
                    className={`text-white text-[10px] px-2 py-1 rounded font-bold cursor-pointer ${status === 'OPEN' ? 'bg-emerald-600 hover:bg-emerald-500' : status === 'ENT' ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-red-700 hover:bg-red-600'}`}
                  >
                    {status}
                  </button>
                ))}
                <button
                  onClick={handleDeleteSelected}
                  className="bg-red-600 hover:bg-red-700 text-white text-[10px] px-2 py-1 rounded font-bold cursor-pointer"
                >
                  Delete Selected ({selectedIds.length})
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between mt-1 mb-1 px-1">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                onChange={() => handleSelectAll(filteredOrders)}
                checked={filter === 'OFFER'
                  ? visibleOrderEntries.length > 0 && visibleOrderEntries.every(({ customer, order }) => selectedIds.includes(selectionKey(customer, order.id)))
                  : filteredOrders.length > 0 && filteredOrders.every(o => selectedIds.includes(o.id))}
                className="cursor-pointer accent-blue-600"
              />
              <span className="text-[11px] text-gray-400">{filter === 'OFFER' ? 'Select All (all customers)' : isAllCustomersView ? 'Select All (current customer)' : 'Select All'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={selectedIds.length === 0}
                onClick={() => copyToClipboard(
                  visibleOrderEntries.filter(({ customer, order }) => (filter === 'OFFER' || customer === selectedBroker) && selectedIds.includes(selectionKey(customer, order.id)))
                    .map(({ order }) => `${order.id} ${order.route || ''}`.trim()).join('\n'),
                  'Selected loads'
                )}
                title="Copy load number and pickup/delivery city/state for every checked load"
                className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold px-2 py-0.5 rounded cursor-pointer"
              >
                📋 Copy Selected ({visibleOrderEntries.filter(({ customer, order }) => (filter === 'OFFER' || customer === selectedBroker) && selectedIds.includes(selectionKey(customer, order.id))).length})
              </button>
              <button
                type="button"
                onClick={handleClearAllFilters}
                disabled={!searchQuery.trim() && !loadFilters.rate && !loadFilters.minMiles && !loadFilters.maxMiles && !loadFilters.pickupState && !loadFilters.deliveryState && !loadFilters.pickupDate && !laneSort}
                title="Clear the search box and all lane filters and sorting"
                className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold px-2 py-0.5 rounded cursor-pointer"
              >
                ✕ Clear All Filters
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 mb-1 px-1">
            <span className="text-[11px] text-gray-400">Show:</span>
            {[
              ['', `All (${rateCountOrders.length})`, 'bg-blue-600 border-blue-400'],
              ['with', `With rate (${withRateCount})`, 'bg-emerald-600 border-emerald-300'],
              ['without', `No rate (${noRateCount})`, 'bg-amber-600 border-amber-300']
            ].map(([value, label, activeClass]) => (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={loadFilters.rate === value}
                onClick={() => { setLoadFilters(prev => ({ ...prev, rate: value })); setSelectedIds([]); }}
                className={`text-white text-[10px] font-bold px-2 py-0.5 rounded cursor-pointer border ${loadFilters.rate === value ? `${activeClass} ring-2 ring-white/60` : 'bg-slate-700 border-transparent hover:bg-slate-600'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="tms-pickup-date-filter mt-2">
            <label htmlFor="pickup-date-filter" className="block mb-2 text-base font-semibold text-slate-100">Pickup date:</label>
            <div className="flex flex-col gap-2">
            <input
              id="pickup-date-filter"
              type="date"
              value={loadFilters.pickupDate}
              onClick={event => {
                if (typeof event.currentTarget.showPicker === 'function') event.currentTarget.showPicker();
              }}
              onChange={e => { setLoadFilters(prev => ({ ...prev, pickupDate: e.target.value })); setSelectedIds([]); }}
              className={`flex-1 min-w-0 min-h-[44px] rounded-lg border px-2 py-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-sky-300 [color-scheme:dark] ${loadFilters.pickupDate ? 'bg-blue-600 border-blue-400' : 'bg-[#0b132b] border-slate-500 focus:border-sky-300'}`}
              title="Show only loads picking up on this day"
            />
            <button
              type="button"
              aria-label="Open pickup date calendar"
              aria-controls="pickup-date-filter"
              onClick={event => {
                const input = event.currentTarget.parentElement.querySelector('input');
                input.focus();
                if (typeof input.showPicker === 'function') input.showPicker();
              }}
              className="shrink-0 min-h-[44px] min-w-[44px] rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-2 text-sm font-semibold text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
            >
              Open calendar
            </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Quick pickup dates">
              {[['Today', 0], ['Tomorrow', 1]].map(([label, offset]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    const date = new Date();
                    date.setDate(date.getDate() + offset);
                    const pickupDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                    setLoadFilters(prev => ({ ...prev, pickupDate }));
                    setSelectedIds([]);
                  }}
                  className="flex-1 rounded-lg bg-slate-700 hover:bg-slate-600 px-3 py-2 text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setLoadFilters(prev => ({ ...prev, pickupDate: '' })); setSelectedIds([]); }}
                aria-label="Clear pickup date filter"
                aria-pressed={!loadFilters.pickupDate}
                className="flex-1 text-white bg-slate-700 hover:bg-slate-600 rounded-lg px-3 py-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              >
                All dates
              </button>
            </div>
          </div>
          <div className="mt-1.5">
            <select
              aria-label="Sort loads by city and state"
              value={laneSort === 'pickup-asc' ? '' : laneSort}
              onChange={e => setLaneSort(e.target.value)}
              className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-1.5 text-xs text-white outline-none focus:border-blue-500"
            >
              <option value="">Sort: pickup date, earliest first (default)</option>
              <option value="pickup-desc">Pickup date: latest first</option>
              <option value="origin-asc">Pickup city: A to Z</option>
              <option value="origin-desc">Pickup city: Z to A</option>
              <option value="destination-asc">Delivery city: A to Z</option>
              <option value="destination-desc">Delivery city: Z to A</option>
              <option value="origin-state-asc">Pickup state: A to Z</option>
              <option value="origin-state-desc">Pickup state: Z to A</option>
              <option value="destination-state-asc">Delivery state: A to Z</option>
              <option value="destination-state-desc">Delivery state: Z to A</option>
            </select>
          </div>
          <div className="flex items-center gap-2 mt-1.5 px-1">
            <span className="text-sm text-gray-300 font-semibold">States:</span>
            <select
              aria-label="Filter by pickup state"
              value={loadFilters.pickupState}
              onChange={e => { setLoadFilters(prev => ({ ...prev, pickupState: e.target.value })); setSelectedIds([]); }}
              className="w-full bg-[#0b132b] border-2 border-[#2c3a5f] rounded-lg px-2 py-2.5 text-base text-white outline-none focus:border-blue-400 cursor-pointer"
            >
              <option value="">Pickup state (all)</option>
              {sortedStateCodes.map(state => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
            <span className="text-base text-gray-400 font-bold">→</span>
            <select
              aria-label="Filter by delivery state"
              value={loadFilters.deliveryState}
              onChange={e => { setLoadFilters(prev => ({ ...prev, deliveryState: e.target.value })); setSelectedIds([]); }}
              className="w-full bg-[#0b132b] border-2 border-[#2c3a5f] rounded-lg px-2 py-2.5 text-base text-white outline-none focus:border-blue-400 cursor-pointer"
            >
              <option value="">Delivery state (all)</option>
              {sortedStateCodes.map(state => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 px-1">
            <span className="text-[11px] text-gray-400">Miles:</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Min"
              aria-label="Minimum miles"
              value={loadFilters.minMiles}
              onChange={e => { setLoadFilters(prev => ({ ...prev, minMiles: e.target.value.replace(/[^\d]/g, '') })); setSelectedIds([]); }}
              className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-1 text-xs text-white placeholder-gray-500 outline-none focus:border-blue-500"
            />
            <span className="text-[11px] text-gray-500">–</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Max"
              aria-label="Maximum miles"
              value={loadFilters.maxMiles}
              onChange={e => { setLoadFilters(prev => ({ ...prev, maxMiles: e.target.value.replace(/[^\d]/g, '') })); setSelectedIds([]); }}
              className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-1 text-xs text-white placeholder-gray-500 outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="tms-list-bar">
          <span className="tms-list-bar-title" title={selectedBroker}>{selectedBroker}</span>
          <ListFocusToggle />
        </div>
        <div className="tms-load-list flex-1 overflow-y-auto p-2 space-y-2">
          {visibleOrderEntries.length === 0 ? (
            <div className="text-center text-gray-500 text-xs py-10">{isAllCustomersView ? 'No matching loads across all customers with the current filters.' : `No loads found for ${selectedBroker}. Click "📂 Import Excel" above!`}</div>
          ) : (
            visibleOrderEntries.map(({ customer, order: ord }) => (
              <div
                key={JSON.stringify([customer, ord.id])}
                id={`load-card-${ord.id}`}
                onClick={() => handleSelectSearchResult(customer, ord)}
                onDoubleClick={(e) => { if (filter === 'OFFER' || customer === selectedBroker) handleToggleSelect(ord.id, e, customer); }}
                title="Double-click to select or unselect"
                className={`tms-load-card p-3 rounded-lg cursor-pointer select-none border transition-all flex items-start space-x-2.5 ${
                  customer === selectedBroker && exportErrorIds.includes(String(ord.id))
                    ? 'bg-red-950/50 border-red-500 shadow-md'
                    : customer === selectedBroker && selectedOrder?.id === ord.id
                      ? `bg-[#2b3d73] border-yellow-300 border-2 ${isHazmatLoad(ord) ? 'border-l-8 border-l-orange-400' : ''} ring-4 ring-yellow-300/70 shadow-lg shadow-yellow-400/30`
                      : isHazmatLoad(ord)
                        ? 'bg-orange-950/40 border-orange-500/70 border-l-4 hover:bg-orange-900/40'
                        : 'bg-[#161f36]/60 border-transparent hover:bg-[#1c2541]/50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={(filter === 'OFFER' || customer === selectedBroker) && selectedIds.includes(selectionKey(customer, ord.id))}
                  disabled={filter !== 'OFFER' && customer !== selectedBroker}
                  title={filter !== 'OFFER' && customer !== selectedBroker ? 'Open this load to select its customer first' : 'Select load'}
                  onChange={(e) => handleToggleSelect(ord.id, e, customer)}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="mt-1 cursor-pointer accent-blue-600"
                />
                <div className="flex-1 min-w-0">
                  {isAllCustomersView && <div className="text-[10px] text-teal-200 mb-1">{customer}</div>}
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-sm text-blue-400">{ord.id}</span>
                      {customer === selectedBroker && exportErrorIds.includes(String(ord.id)) && (
                        <span className="bg-red-700 text-white text-[9px] px-1.5 py-0.5 rounded font-bold">EXPORT ERROR</span>
                      )}
                      <span className="bg-blue-900/60 text-blue-300 text-[10px] px-1.5 py-0.5 rounded font-mono" title={getEquipmentDescription(ord.eCode)}>{getDisplayEquipmentCode(ord.eCode)}</span>
                                            {isHazmatLoad(ord) && (
                                              <span aria-label={`Hazmat load ${ord.id}`} title="Hazmat load" className="bg-orange-500 text-black text-[10px] px-1.5 py-0.5 rounded font-extrabold whitespace-nowrap">☢ HAZ</span>
                                            )}
                                            {isTankerLoad(ord) && (
                                              <span aria-label={`Tanker endorsement load ${ord.id}`} title="Tanker (N) Endorsement required" className="bg-yellow-400 text-black text-[10px] px-1.5 py-0.5 rounded font-extrabold whitespace-nowrap">🛢 TANKER</span>
                                            )}
                                            {String(ord.needsCapacity || '').trim() && (
                                              <span aria-label={`Load ${ord.id} needs capacity`} title="Important: protected from missing-list removal; refresh requested every 15 minutes" className="bg-amber-400 text-black text-[10px] px-1.5 py-0.5 rounded font-extrabold whitespace-nowrap">⭐ IMPORTANT / NEEDS CAPACITY</span>
                                            )}
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${ord.status === 'ENT' ? 'tms-ent' : ord.status === 'ON HOLD' ? 'bg-red-900/60 text-red-300' : ord.status === 'OPEN' ? 'tms-open' : ord.status === 'BOOKED' ? 'bg-purple-900/60 text-purple-200' : 'bg-blue-900/60 text-blue-300'}`}>{ord.status}</span>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${ord.tag === 'ENT' ? 'tms-ent' : ord.tag === 'HOLD' ? 'bg-red-600 text-white' : ord.tag === 'OPEN' ? 'tms-open' : ord.tag === 'BOOKED' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white'}`}>{ord.tag}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mb-1 min-w-0">
                    <div className="text-xs font-medium text-gray-200 truncate">{ord.route}</div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation();                       copyToClipboard(`${ord.id} ${ord.route || ''}`.trim(), 'Load number and route'); }}
                                            title="Copy load number and pickup/delivery city/state"
                      aria-label={`Copy route for load ${ord.id}`}
                      className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-1.5 py-0.5 rounded text-[10px] cursor-pointer"
                    >📋</button>
                  </div>
                  <div className="tms-card-meta">
                  <div className="tms-card-dates text-[11px] text-gray-400">{ord.puDate} {ord.delDate}</div>
                  <div aria-label={`Rate for load ${ord.id}`} className="tms-card-rate mt-1 text-xs text-emerald-400 font-bold">
                    Rate: ${(Number(String(ord.rateInput || '').replace(/[$,]/g, '')) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </div>
                  </div>
                  {ord.planningComment && <div className="tms-card-comment mt-1 text-[11px] text-amber-300 font-semibold truncate">{ord.planningComment}</div>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="tms-workspace flex-1 flex flex-col overflow-y-auto p-3 md:p-6">
        <div className="tms-brand">
          <div className="tms-brand-logos">
              <div className="tms-landstar-mark" role="img" aria-label="Landstar">
                <span className="tms-landstar-word">Landstar</span>
                <svg className="tms-landstar-star" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 1.8l3.05 6.55 7.15.86-5.27 4.93 1.38 7.1L12 17.75l-6.31 3.49 1.38-7.1L1.8 9.21l7.15-.86z" />
                </svg>
              </div>
              <img className="tms-eagles-logo" src="/eagles-sidebar.png" alt="Eagles artwork" width="474" height="475" />
          </div>
          <div className="tms-brand-name">
          <span className="tms-brand-title">Broski Transportation &amp; Logistics</span>
          {profile.phone ? (
            <a className="tms-brand-phone" href={`tel:+1${profile.phone}`}>
              {countryFlags[profile.flag] && (
                <span
                  className="tms-colombia-flag"
                  role="img"
                  aria-label={`${countryFlags[profile.flag].name} flag`}
                  style={{ background: countryFlags[profile.flag].background }}
                />
              )}
              <span>{formatPhone(profile.phone)}</span>
            </a>
          ) : (
            <span className="text-xs text-amber-400">Add your phone in ⚙ My Settings</span>
          )}
          </div>
          <span className="tms-brand-actions inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowInquiries(open => !open)}
              title="Driver inquiries from your load links"
              className={`text-white text-xs px-2.5 py-1 rounded font-medium cursor-pointer normal-case tracking-normal ${unseenInquiryCount ? 'bg-purple-600 hover:bg-purple-500' : 'bg-slate-700 hover:bg-slate-600'}`}
            >
              📨 Inquiries{unseenInquiryCount ? ` (${unseenInquiryCount} new)` : ''}
            </button>
            <button
              type="button"
              onClick={handleExportToLandstar}
              className="tms-export-button"
              title="Export the selected (or shown) loads to a Landstar bulk file and move them to ENT; the bot uploads it"
            >
              🚀 Export to Landstar
            </button>
            {pastedImage && (
              <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 normal-case tracking-normal text-left" role="dialog" aria-label="Which list is this?">
                <div className="bg-[#121829] border border-purple-500 rounded-lg shadow-2xl p-4 w-[24rem] max-w-full">
                  <h2 className="text-sm font-bold text-purple-200 mb-1">📋 Which list did you paste?</h2>
                  <p className="text-xs text-gray-300 mb-3">The picture is imported into the account you pick.</p>
                  <div className="flex flex-col gap-2">
                    {pasteImportChoices.map(choice => (
                      <button
                        key={choice.label}
                        type="button"
                        onClick={() => importPastedImage(choice.customer)}
                        className={`${choice.className} text-white text-sm px-3 py-2 rounded font-semibold cursor-pointer text-left`}
                      >
                        {choice.label}
                      </button>
                    ))}
                    <button type="button" onClick={() => setPastedImage(null)} className="text-gray-300 hover:text-white text-xs mt-1 cursor-pointer">Cancel</button>
                  </div>
                </div>
              </div>
            )}
            {paramountReplies.some(reply => reply.driver) && (
              <div className="fixed left-1/2 -translate-x-1/2 top-2 z-50 w-[46rem] max-w-[calc(100vw-1rem)] bg-red-600 text-white rounded-lg shadow-2xl border-2 border-red-300 p-3 normal-case tracking-normal text-left" role="alert">
                <p className="font-bold text-base">💬 Driver replied - answer right away</p>
                {paramountReplies.filter(reply => reply.driver).map(reply => (
                  <div key={`banner-${reply.id}`} className="mt-2 bg-red-700/60 rounded p-2 text-sm">
                    <p className="font-semibold">{reply.loadId ? `Load #${reply.loadId}` : `Freight bill ${reply.freightBill}`} · {String(reply.from || '').replace(/<[^>]*>/, '').trim()} · {formatCheckTime(reply.at)}</p>
                    <p className="mt-0.5">“{reply.snippet}”</p>
                    <div className="flex gap-2 mt-1">
                      <a href={`https://mail.google.com/mail/u/0/#all/${reply.threadId}`} target="_blank" rel="noreferrer" className="bg-white text-red-700 px-3 py-0.5 rounded font-bold">Open in Gmail</a>
                      <button type="button" onClick={() => setParamountReplies(current => current.filter(item => item.id !== reply.id))} className="bg-red-900 hover:bg-red-950 px-3 py-0.5 rounded font-semibold cursor-pointer">Got it</button>
                    </div>
                  </div>
                ))}
                {typeof Notification !== 'undefined' && Notification.permission === 'default' && (
                  <button type="button" onClick={() => Notification.requestPermission()} className="mt-2 bg-yellow-300 text-black px-3 py-1 rounded font-bold cursor-pointer">Turn on Windows notifications for driver replies</button>
                )}
              </div>
            )}
            {vipMessages.length > 0 && (
              <div className="fixed left-1/2 -translate-x-1/2 top-14 z-50 w-[46rem] max-w-[calc(100vw-1rem)] bg-yellow-400 text-black rounded-lg shadow-2xl border-2 border-yellow-200 p-3 normal-case tracking-normal text-left" role="alert">
                <p className="font-bold text-base">⭐ VIP customer emailed you</p>
                {vipMessages.map(message => (
                  <div key={`vip-${message.id}`} className="mt-2 bg-yellow-300/80 rounded p-2 text-sm">
                    <p className="font-semibold">{message.name} · {formatCheckTime(message.at)}{message.subject ? ` · ${message.subject}` : ''}</p>
                    <p className="mt-0.5">“{message.snippet}”</p>
                    <div className="flex gap-2 mt-1">
                      <a href={`https://mail.google.com/mail/u/0/#all/${message.threadId}`} target="_blank" rel="noreferrer" className="bg-black text-yellow-300 px-3 py-0.5 rounded font-bold">Open in Gmail</a>
                      <button type="button" onClick={() => setVipMessages(current => current.filter(item => item.id !== message.id))} className="bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-0.5 rounded font-semibold cursor-pointer">Got it</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {notices.length > 0 && (
              <div className="fixed right-2 bottom-12 z-50 w-[26rem] max-w-[calc(100vw-1rem)] space-y-2 normal-case tracking-normal text-left">
                {notices.map(notice => (
                  <div key={notice.id} role="alert" className={`rounded-lg shadow-2xl border p-2.5 text-xs flex items-start gap-2 ${notice.level === 'info' ? 'bg-sky-950 border-sky-500 text-sky-100' : 'bg-amber-950 border-amber-400 text-amber-100'}`}>
                    <p className="flex-1 whitespace-pre-wrap">{notice.level === 'info' ? '' : '⚠ '}{notice.text}</p>
                    <button type="button" onClick={() => setNotices(current => current.filter(item => item.id !== notice.id))} className="text-white/70 hover:text-white font-bold px-1 cursor-pointer" aria-label="Dismiss notice">✕</button>
                  </div>
                ))}
              </div>
            )}
            {(paramountDrafts.length > 0 || paramountReplies.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  setView('booked');
                  // Already on Booked Loads (or right after the switch): jump to the first waiting email.
                  setTimeout(() => document.querySelector('[data-email-draft]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
                }}
                title="Tracking emails waiting for you on Booked Loads"
                className="bg-amber-400 hover:bg-amber-300 text-black text-xs px-2.5 py-1 rounded font-bold cursor-pointer normal-case tracking-normal"
              >
                ⚠ {[
                  paramountDrafts.length ? `${paramountDrafts.length} email${paramountDrafts.length === 1 ? '' : 's'} to send` : '',
                  paramountReplies.length ? `${paramountReplies.length} repl${paramountReplies.length === 1 ? 'y' : 'ies'}` : ''
                ].filter(Boolean).join(' · ')}
              </button>
            )}
            {showInquiries && (
              <InquiriesPanel
                inquiries={inquiries}
                onOpen={openInquiryLoad}
                onSeen={markInquirySeen}
                onClose={() => setShowInquiries(false)}
              />
            )}
            {/* Signed in, the bot light and My Settings sit next to Sign out (bottom right);
                local mode keeps them here. */}
            {!sharing && <BotStatusLight />}
            <details className="relative normal-case tracking-normal text-left text-xs" aria-label="Driver-to-broker worker">
                <summary className="bg-slate-800 border border-slate-600 rounded px-2.5 py-1 cursor-pointer">
                  <span role="status" aria-live="polite">{describeEmailWorker(emailWorkerStatus, paramountDrafts)}</span>
                </summary>
                <div className="absolute left-0 top-full mt-2 z-50 w-80 max-w-[90vw] max-h-[60vh] overflow-y-auto bg-slate-900 border border-slate-600 rounded p-3 shadow-xl space-y-2">
                  <p>{emailWorkerStatus.message}</p>
                  {emailWorkerStatus.lastCheckedAt && <p>Last completed check: {new Date(emailWorkerStatus.lastCheckedAt).toLocaleTimeString()}</p>}
                  <p>Runs while the local TMS is open. Posting runs separately. Only one local tab runs automatic email checks.</p>
                  {emailWorkerStatus.issues.map(issue => <p key={issue.task} className="text-amber-300">{issue.task}: {issue.message}</p>)}
                  {paramountDrafts.some(draft => draft.error) && <p className="text-amber-300">Email send failures are shown in Booked Loads.</p>}
                  {paramountDrafts.some(draft => !draft.error && !draft.sending) && <p>Emails awaiting approval are in Booked Loads.</p>}
                </div>
              </details>
            {!sharing && (
            <button
              type="button"
              onClick={openProfileSettings}
              className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2.5 py-1 rounded font-medium cursor-pointer"
            >
              ⚙ My Settings
            </button>
            )}
          </span>
        </div>
        {profileDraft && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" role="dialog" aria-label="My Settings">
            <form onSubmit={handleSaveProfile} className="w-96 max-w-full bg-[#121829] border border-[#1c2541] rounded-lg p-5 space-y-3">
              <h2 className="text-sm font-bold text-gray-100">⚙ My Settings</h2>
              <p className="text-[11px] text-gray-400">Used on your exports. Each teammate has their own.</p>
              {[
                ['phone', 'Call back phone (10 digits)', '484-555-1234'],
                ['postingCode', 'Posting code', 'ANQ'],
                ['visibilityGroup', 'Visibility group', 'ANQ']
              ].map(([field, label, example]) => (
                <label key={field} className="block text-xs text-gray-400">
                  {label}
                  <input
                    type="text"
                    value={profileDraft[field]}
                    onChange={(e) => setProfileDraft(current => ({ ...current, [field]: e.target.value }))}
                    placeholder={example}
                    className="mt-1 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono"
                  />
                </label>
              ))}
              <label className="block text-xs text-gray-400">
                Flag next to your phone
                <div className="mt-1 flex items-center gap-2">
                  <select
                    value={profileDraft.flag}
                    onChange={(e) => setProfileDraft(current => ({ ...current, flag: e.target.value }))}
                    className="flex-1 bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white"
                  >
                    {Object.entries(countryFlags)
                      .sort(([, a], [, b]) => a.name.localeCompare(b.name))
                      .map(([code, flag]) => <option key={code} value={code}>{flag.name}</option>)}
                    <option value="NONE">No flag</option>
                  </select>
                  {countryFlags[profileDraft.flag] && (
                    <span className="tms-colombia-flag" aria-hidden="true" style={{ background: countryFlags[profileDraft.flag].background }} />
                  )}
                </div>
              </label>
              <fieldset className="border border-[#1c2541] rounded p-3">
                <legend className="text-xs text-gray-300 px-1">⛽ Fuel surcharge ($/mile, by pickup region)</legend>
                <p className="text-[11px] text-gray-400 mb-2">Exported as a Per Mile surcharge on each load. Updated automatically from the weekly fuel email (East / Midwest / West / New England). Blank regions use the Midwest rate; blank Midwest exports no surcharge.</p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(fuelSurchargeRegions).map(([key, region]) => (
                    <label key={key} className="block text-xs text-gray-400">
                      {region.label}
                      <input
                        type="text"
                        inputMode="decimal"
                        value={profileDraft.fuelSurcharge?.[key] ?? ''}
                        onChange={(e) => setProfileDraft(current => ({
                          ...current,
                          fuelSurcharge: { ...current.fuelSurcharge, [key]: e.target.value }
                        }))}
                        placeholder="0.00"
                        className="mt-1 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono"
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setProfileDraft(null)} className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-1.5 text-xs rounded">Cancel</button>
                <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-xs rounded font-bold">Save</button>
              </div>
            </form>
          </div>
        )}
        {shareCustomerName && (() => {
          const shareInfo = sharedCustomers[shareCustomerName];
          const memberIds = shareInfo?.memberIds || [];
          const choices = teammates.filter(person => person.id !== shareInfo?.ownerId && !memberIds.includes(person.id));
          const closeShareDialog = () => {
            setShareCustomerName(null);
            setShareMessage('');
          };
          const renderChoices = (buttonLabel, onSubmit) => (
            <>
              {choices.length ? choices.map(person => (
                <label key={person.id} className="flex items-center gap-2 text-xs text-gray-200">
                  <input type="checkbox" checked={shareSelection.includes(person.id)} onChange={() => toggleShareSelection(person.id)} />
                  {person.email}
                </label>
              )) : <p className="text-[11px] text-gray-500">No other teammates to add.</p>}
              <button
                type="button"
                disabled={shareBusy || !shareSelection.length}
                onClick={onSubmit}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 text-xs rounded font-bold"
              >
                {buttonLabel}
              </button>
            </>
          );
          return (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" role="dialog" aria-label="Share customer">
              <div className="w-96 max-w-full max-h-[80vh] overflow-y-auto bg-[#121829] border border-[#1c2541] rounded-lg p-5 space-y-3">
                <h2 className="text-sm font-bold text-gray-100">🤝 Share “{shareCustomerName}”</h2>
                {!shareInfo && (
                  <>
                    <p className="text-[11px] text-gray-400">
                      Teammates you pick will see and edit this customer’s loads and lane rates live, together with you.
                      Everyone keeps their own phone, posting code and visibility group.
                    </p>
                    {renderChoices('Share', () => runShareAction(
                      () => sharing.shareCustomer(shareCustomerName, shareSelection),
                      'Shared. Your teammates will see this customer the next time their page updates.'
                    ))}
                  </>
                )}
                {shareInfo && (
                  <>
                    <p className="text-[11px] text-gray-400">
                      {shareInfo.isOwner ? 'You shared this customer.' : `Shared with you by ${teammateEmail(shareInfo.ownerId)}.`}
                    </p>
                    <div className="space-y-1">
                      <span className="text-[11px] font-bold text-gray-300">Shared with:</span>
                      {memberIds.length ? memberIds.map(memberId => (
                        <div key={memberId} className="flex items-center justify-between text-xs text-gray-200">
                          <span>{teammateEmail(memberId)}</span>
                          {shareInfo.isOwner && (
                            <button
                              type="button"
                              disabled={shareBusy}
                              onClick={() => runShareAction(() => sharing.removeSharedMember(shareCustomerName, memberId), 'Teammate removed.')}
                              className="bg-slate-700 hover:bg-red-600 text-white px-1.5 py-0.5 rounded text-[10px]"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      )) : <p className="text-[11px] text-gray-500">Nobody yet.</p>}
                    </div>
                    {shareInfo.isOwner ? (
                      <>
                        <span className="block text-[11px] font-bold text-gray-300">Add teammates:</span>
                        {renderChoices('Add', () => runShareAction(
                          () => sharing.addSharedMembers(shareCustomerName, shareSelection),
                          'Teammates added.'
                        ))}
                        <button
                          type="button"
                          disabled={shareBusy}
                          onClick={async () => {
                            if (!window.confirm(`Stop sharing "${shareCustomerName}"? Teammates lose access. You keep all its loads and lane rates.`)) return;
                            if (await runShareAction(() => sharing.stopSharingCustomer(shareCustomerName), '')) closeShareDialog();
                          }}
                          className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-3 py-1.5 text-xs rounded font-bold"
                        >
                          Stop sharing
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={shareBusy}
                        onClick={async () => {
                          if (!window.confirm(`Leave "${shareCustomerName}"? It will be removed from your list. The other teammates keep it.`)) return;
                          if (await runShareAction(() => sharing.leaveSharedCustomer(shareCustomerName), '')) closeShareDialog();
                        }}
                        className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-3 py-1.5 text-xs rounded font-bold"
                      >
                        Leave this customer
                      </button>
                    )}
                  </>
                )}
                {shareMessage && <p role="status" className="text-[11px] text-amber-300">{shareMessage}</p>}
                <button type="button" onClick={closeShareDialog} className="w-full bg-gray-600 hover:bg-gray-500 text-white px-3 py-1.5 text-xs rounded">
                  Close
                </button>
              </div>
            </div>
          );
        })()}
        {view === 'booked' ? (
          <BookedLoadsPage
            entries={getBookedLoads(customerOrdersMap)}
            now={clock}
            onBack={() => setView('loads')}
            onOpen={openBookedLoad}
            onUpdate={updateCustomerLoad}
            searchQuery={searchQuery}
            onSearch={handleGlobalSearch}
            emails={{
              drafts: paramountDrafts,
              replies: paramountReplies,
              onChangeText: (draft, text) => setParamountDrafts(current => current.map(item => (item.id === draft.id ? { ...item, text } : item))),
              onSend: draft => { void sendParamountDraft(draft); },
              onSkip: skipParamountDraft,
              onDismissReply: reply => setParamountReplies(current => current.filter(item => item.id !== reply.id))
            }}
            onRemoveCapacity={(customer, id) => {
              const load = (customerOrdersMap[customer] || []).find(o => String(o.id) === String(id));
              if (load && confirmRemoveCapacity(load)) updateCustomerLoad(customer, id, removeCapacity(load));
            }}
          />
        ) : selectedOrder ? (
          <div>
            <div className="tms-action-bar flex items-center justify-between bg-[#161f36] px-4 py-3 rounded-lg mb-6 border border-[#1c2541]">
              <div className="flex items-center space-x-3">
                <span className="text-xs font-bold text-gray-400">MOVE TO:</span>
                <button onClick={() => handleStatusChange('OPEN')} className="tms-open px-3 py-1 text-xs font-bold rounded cursor-pointer">OPEN</button>
                <button onClick={() => handleStatusChange('ON HOLD')} className="bg-red-600 hover:bg-red-500 px-3 py-1 text-xs font-bold rounded text-white cursor-pointer">ON HOLD</button>
                <button onClick={() => handleStatusChange('OFFER')} className="bg-blue-600 hover:bg-blue-500 px-3 py-1 text-xs font-bold rounded text-white cursor-pointer">OFFER</button>
                <button onClick={() => handleStatusChange('ENT')} className="tms-ent px-3 py-1 text-xs font-bold rounded cursor-pointer">ENT</button>
              </div>
            </div>

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <h2 className="text-xl font-bold tracking-wide">{String(selectedOrder.id).startsWith('MANUAL-') ? 'NEW LOAD · ORDER # OPTIONAL' : `ORDER #${selectedOrder.id}`}</h2>
                <button
                  onClick={() => copyToClipboard(formatOrderCopy(selectedOrder), 'Order #')}
                  title={String(selectedOrder.emptyLocation || '').trim() ? 'Copy the order # and previous empty location' : 'Copy the order #'}
                  className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2.5 py-1 rounded font-medium flex items-center space-x-1 cursor-pointer"
                >
                  <span>📋 Copy Order #</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                {String(selectedOrder.needsCapacity || '').trim() && (
                  <span className="bg-amber-400 text-black text-xs px-2 py-1 rounded font-bold" title="Protected from missing-list removal; local posting refresh requested every 15 minutes">IMPORTANT / NEEDS CAPACITY</span>
                )}
                <span className={`text-xs px-2.5 py-1 rounded font-semibold ${selectedOrder.tag === 'ENT' ? 'tms-ent' : selectedOrder.tag === 'HOLD' ? 'bg-red-600 text-white' : selectedOrder.tag === 'OPEN' ? 'tms-open' : selectedOrder.tag === 'BOOKED' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white'}`}>{selectedOrder.tag}</span>
                <button
                  type="button"
                  onClick={handleCopyLoad}
                  title="Create a new load with this load's details (route, schedule, weight, miles, rate, comments). The copy starts OPEN with no driver."
                  className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer"
                >
                  📄 Copy Load
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer"
                >
                  Delete Load
                </button>
              </div>
            </div>

            <div className="tms-load-details space-y-4 bg-[#161f36]/40 p-5 rounded-xl border border-[#1c2541]">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">ORDER #</label>
                  <div className="flex gap-1">
                    <input type="text" value={String(selectedOrder.id).startsWith('MANUAL-') ? '' : selectedOrder.id} placeholder="Optional order number" onChange={(e) => handleFieldChange('id', e.target.value || selectedOrder.id)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white outline-none" />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(selectedOrder.id, 'Order #')}
                      title="Copy Order #"
                      className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-2.5 rounded text-xs cursor-pointer"
                    >
                      📋
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">VISIBILITY GROUP</label>
                  <input type="text" value={profile.visibilityGroup} placeholder="Set in ⚙ My Settings" readOnly title="Change in ⚙ My Settings" className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono placeholder-amber-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">EQUIPMENT</label>
                  {String(selectedOrder.eCode || '').trim().toUpperCase() === 'VE' && (
                    <>
                      <input type="text" value="VAN" readOnly aria-label="Mapped equipment" className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                      <label className="text-xs text-gray-400 block mt-2 mb-1">SOURCE EQUIPMENT CODE (VE = VAN / CHEM)</label>
                    </>
                  )}
                  <label htmlFor="load-equipment-primary" className="text-xs text-gray-400 block mb-1">Primary equipment</label>
                  <select id="load-equipment-primary" value={selectedOrder.eCode || ''}
                    onChange={event => {
                      saveLoad({ ...selectedOrder, eCode: event.target.value, equipment2: undefined, equipment3: '' });
                    }}
                    className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white">
                    <option value="">Select equipment</option>
                    {selectedOrder.eCode && !equipmentOptions.some(([code]) => code === selectedOrder.eCode) && (
                      <option value={selectedOrder.eCode}>{selectedOrder.eCode} - {getEquipmentDescription(selectedOrder.eCode)}</option>
                    )}
                    {equipmentOptions.map(([code, label]) => <option key={code} value={code}>{code} - {label}</option>)}
                  </select>
                  {[2, 3].map(slot => {
                    const field = `equipment${slot}`;
                    const value = slot === 2 ? getLandstarEquipment2(selectedOrder) : selectedOrder.equipment3 || '';
                    const choices = [...new Map(equipmentOptions.map(([code, label]) => [getLandstarEquipmentCode(code), label])).entries()];
                    return (
                      <div key={field} className="mt-2">
                        <label htmlFor={`load-${field}`} className="text-xs text-gray-400 block mb-1">Alternate equipment {slot - 1}</label>
                        <select id={`load-${field}`} value={value}
                          onChange={event => handleFieldChange(field, event.target.value)}
                          className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white">
                          <option value="">None</option>
                          {value && !choices.some(([code]) => code === value) && <option value={value}>{value}</option>}
                          {choices.filter(([code]) => code && code !== getLandstarEquipmentCode(selectedOrder.eCode)
                            && !(getLandstarEquipmentCode(selectedOrder.eCode) === 'D-LG' && code === 'D-ST')
                            && (slot === 2 || code !== getLandstarEquipment2(selectedOrder)))
                            .map(([code, label]) => <option key={code} value={code}>{code} - {label}</option>)}
                        </select>
                      </div>
                    );
                  })}
                  <div className="text-[11px] text-emerald-400 mt-1 font-mono">{getEquipmentDescription(selectedOrder.eCode)}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Brokerable (true / false)</label>
                  <input type="text" value={selectedOrder.brokerable || 'false'} onChange={(e) => handleFieldChange('brokerable', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono" placeholder="false" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">POSTING CODE</label>
                  <input
                    type="text"
                    value={selectedOrder.postingCode || profile.postingCode}
                    placeholder="Set in ⚙ My Settings"
                    onChange={(e) => handleFieldChange('postingCode', e.target.value)}
                    className="w-full bg-[#0b132b] border border-emerald-500/60 rounded p-2 text-sm text-white font-mono"
                  />
                </div>
              </div>

              <div className="border border-[#1c2541] bg-[#121829]/60 p-4 rounded-lg">
                <div className="mb-3">
                  <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wide flex items-center">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 mr-2"></span> Pickup Details
                  </h3>
                </div>
               
                <div className="mb-3">
                  <label className="text-xs text-gray-400 block mb-1">Pickup Time (Early - Late)</label>
                  <input
                    type="text"
                    value={selectedOrder.pickupTime || ''}
                    onChange={(e) => handleFieldChange('pickupTime', e.target.value)}
                    className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono"
                  />
                  {renderSchedulePicker('pickupTime')}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                  {renderCopyableField('Origin City', 'origCity')}
                  {renderCopyableField('Origin State', 'origSt')}
                  {renderCopyableField('Origin ZIP', 'origZip')}
                </div>
               
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Weight</label>
                    <div className="flex space-x-2">
                      <input type="text" value={selectedOrder.weight} onChange={(e) => handleFieldChange('weight', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" />
                      <button onClick={() => copyToClipboard(selectedOrder.weight, 'Weight')} className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-xs cursor-pointer">📋 Copy</button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border border-[#1c2541] bg-[#121829]/60 p-4 rounded-lg">
                <div className="mb-3">
                  <h3 className="text-xs font-bold text-blue-400 uppercase tracking-wide flex items-center">
                    <span className="w-2 h-2 rounded-full bg-blue-400 mr-2"></span> Delivery Details
                  </h3>
                </div>

                <div className="mb-3">
                  <label className="text-xs text-gray-400 block mb-1">Delivery Time (Early - Late)</label>
                  <input
                    type="text"
                    value={selectedOrder.deliveryTime || ''}
                    placeholder={isNolanCustomer(selectedBroker) ? 'MM/DD/YY 08:00  MM/DD/YY 16:00' : ''}
                    onChange={(e) => handleFieldChange('deliveryTime', e.target.value)}
                    className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono"
                  />
                  {renderSchedulePicker('deliveryTime')}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                  {renderCopyableField('Destination City', 'destCity')}
                  {renderCopyableField('Destination State', 'destSt')}
                  {renderCopyableField('Destination ZIP', 'destZip')}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Miles</label>
                    <div className="flex space-x-2">
                      <input type="text" value={selectedOrder.miles} onChange={(e) => handleFieldChange('miles', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" />
                      <button onClick={() => copyToClipboard(selectedOrder.miles, 'Miles')} className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-xs cursor-pointer">📋 Copy</button>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">Driving miles calculate automatically from pickup and delivery city/state. ZIP codes are not required. You can override miles.</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Rate Type</label>
                    <input
                      type="text"
                      value="Flat Rate"
                      readOnly
                      className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white"
                    />
                  </div>
                  <div className="row-span-2">
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs text-emerald-400 font-bold">Rate ($) - DAT quote</label>
                      <span className="text-[10px] bg-emerald-950 text-emerald-300 px-1 py-0.2 rounded font-mono border border-emerald-600/40">
                        {selectedOrder.rateSource === 'dat-screenshot' ? 'From screenshot' : selectedOrder.rateSource === 'dat-api' ? 'From DAT API' : 'Manual'}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={['user-entered', 'dat-screenshot', 'dat-api'].includes(selectedOrder.rateSource) ? selectedOrder.rateInput || '' : ''}
                        onChange={(e) => handleFieldChange('rateInput', e.target.value)}
                        onKeyDown={handleRateKeyDown}
                        placeholder="Enter DAT quote"
                        className="flex-1 basis-0 min-w-0 h-12 bg-[#0b132b] border-2 border-emerald-500 rounded px-3 text-xl text-white font-mono font-extrabold"
                      />
                      <button
                        type="button"
                        onClick={() => copyToClipboard(selectedOrder.rateInput || '', 'Rate')}
                        title="Copy Rate"
                        className="shrink-0 h-12 bg-slate-700 hover:bg-slate-600 text-white px-2.5 rounded text-xs cursor-pointer"
                      >
                        📋
                      </button>
                      {(() => {
                        const shownRate = ['user-entered', 'dat-screenshot', 'dat-api'].includes(selectedOrder.rateSource) ? selectedOrder.rateInput : '';
                        const rpm = getRatePerMile(shownRate, selectedOrder.miles);
                        return (
                          <div aria-label="Rate per mile" title="Rate ÷ miles" className="flex-1 basis-0 min-w-0 h-12 flex items-center justify-center bg-emerald-950 border-2 border-emerald-500 text-emerald-300 px-3 rounded text-xl font-mono font-extrabold whitespace-nowrap">
                            {rpm ? `$${rpm}/mi` : '$/mi'}
                          </div>
                        );
                      })()}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">Saved automatically for future loads with this customer, origin/destination city and state, and equipment. ZIP differences do not affect matching. The latest entered rate is reused. After you type a rate or any other load detail, it moves to the next load about 5 seconds after you stop editing (or press Enter).</p>
                    {(() => {
                      const laneHistory = getLaneRateHistory(rateHistory, selectedBroker, selectedOrder);
                      if (!laneHistory.length) return null;
                      const currentRate = String(Number(String(selectedOrder.rateInput || '').replace(/[$,]/g, '')) || '');
                      const exactKey = createLaneRateKey(selectedBroker, selectedOrder);
                      return (
                        <div className="mt-2" aria-label="Past rates for this lane">
                          <div className="text-[10px] text-gray-500 mb-1">
                            📈 Past rates: {selectedOrder.origCity}, {selectedOrder.origSt} → {selectedOrder.destCity}, {selectedOrder.destSt}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {laneHistory.slice(0, 6).map(entry => {
                              const isCurrent = entry.rate === currentRate;
                              const isExact = Boolean(exactKey) && entry.key === exactKey;
                              const savedDate = entry.savedAt ? new Date(entry.savedAt) : null;
                              const dateLabel = savedDate && !Number.isNaN(savedDate.getTime())
                                ? savedDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
                                : 'saved';
                              const titleParts = [
                                entry.customer,
                                entry.eCode || 'Any equipment',
                                entry.source === 'manual' ? 'Entered' : entry.source === 'saved' ? 'Saved rate' : entry.source === 'exported' ? 'Exported to Landstar' : entry.source,
                                savedDate && !Number.isNaN(savedDate.getTime()) ? savedDate.toLocaleString() : ''
                              ].filter(Boolean);
                              if (!isExact) titleParts.push('different customer/equipment');
                              return (
                                <button
                                  key={`${entry.key}|${entry.rate}`}
                                  type="button"
                                  onClick={() => handleFieldChange('rateInput', entry.rate)}
                                  title={titleParts.join(' • ')}
                                  className={`px-2 py-1 rounded text-xs font-mono font-bold border cursor-pointer ${isCurrent
                                    ? 'bg-emerald-600 border-emerald-400 text-white'
                                    : 'bg-[#0b132b] border-emerald-700/50 text-emerald-300 hover:bg-emerald-950'}`}
                                >
                                  ${Number(entry.rate).toLocaleString('en-US')} · {dateLabel}{isExact ? '' : ` · ${String(entry.customer || '').split(' ')[0]}`}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                    {(() => {
                      const fscRate = getFuelSurchargeRate(profile.fuelSurcharge, selectedOrder.origSt);
                      if (!fscRate) return null;
                      const region = fuelSurchargeRegions[getFuelSurchargeRegion(selectedOrder.origSt)];
                      const fscMiles = Number(String(selectedOrder.miles || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0]);
                      const fscTotal = fscMiles > 0 ? fscRate * fscMiles : null;
                      const shownRate = ['user-entered', 'dat-screenshot', 'dat-api'].includes(selectedOrder.rateSource)
                        ? Number(String(selectedOrder.rateInput || '').replace(/[$,]/g, ''))
                        : 0;
                      const linehaul = shownRate > 0 && fscTotal !== null ? shownRate - fscTotal : null;
                      return (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div
                            aria-label="Linehaul"
                            title="Linehaul = customer rate − fuel surcharge"
                            className="h-12 flex items-center justify-between gap-2 bg-sky-950 border-2 border-sky-500 text-sky-300 px-3 rounded"
                          >
                            <span className="text-xl font-mono font-extrabold whitespace-nowrap">
                              🚛 {linehaul !== null ? `$${linehaul.toFixed(2)}` : 'Linehaul'}
                            </span>
                            <span className="text-[11px] text-sky-400/90 text-right leading-tight">
                              {linehaul !== null && fscMiles > 0 ? `$${(linehaul / fscMiles).toFixed(2)}/mi` : 'rate − FSC'}
                            </span>
                          </div>
                          <div
                            aria-label="Fuel surcharge"
                            title={`Fuel surcharge on export (${region.label}). Update weekly in ⚙ My Settings.`}
                            className="h-12 flex items-center justify-between gap-2 bg-amber-950 border-2 border-amber-500 text-amber-300 px-3 rounded"
                          >
                            <span className="text-xl font-mono font-extrabold whitespace-nowrap">
                              ⛽ {fscTotal !== null ? `$${fscTotal.toFixed(2)}` : 'FSC'}
                            </span>
                            <span className="text-[11px] text-amber-400/90 text-right leading-tight">
                              ${fscRate.toFixed(2)}/mi • {region.label}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="col-span-2 self-start">
                    <label htmlFor="landstar-comment" className="text-xs text-gray-400 block mb-1">
                      Landstar Comment <span className="text-[10px] text-gray-500">(exports to column AA)</span>
                    </label>
                    <input
                      id="landstar-comment"
                      type="text"
                      list="landstar-comment-options"
                      autoComplete="off"
                      maxLength={250}
                      value={selectedOrder.landstarComment || ''}
                      onChange={(e) => handleFieldChange('landstarComment', e.target.value)}
                      placeholder="Type a comment or pick a Landstar comment"
                      className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white"
                    />
                    <datalist id="landstar-comment-options">
                      {landstarCommentOptions.map(option => <option key={option} value={option} />)}
                    </datalist>
                    {String(selectedOrder.landstarComment || '').trim() && !getLandstarExportComment(selectedOrder) && (
                      <p className="text-[11px] text-amber-300 mt-1" id="landstar-comment-warning">
                        ⚠ Not a Landstar comment code, so it will not be exported (Landstar rejects the whole posting otherwise). Pick one from the list.
                      </p>
                    )}
                    <p className="text-[11px] text-gray-300 mt-1 break-all" id="landstar-comment-link">
                      {selectedOrder.inquiryToken
                        ? <>🔗 Driver link (paste into BCO Posting Comments or text it): <a href={getInquiryUrl(selectedOrder.inquiryToken)} target="_blank" rel="noreferrer" className="text-purple-300 underline">{getInquiryUrl(selectedOrder.inquiryToken)}</a></>
                        : '🔗 Driver link: created when you export, or use “Copy driver link” above.'}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-[1fr_8rem] gap-4">
                  <div>
                    <label htmlFor="load-commodity" className="text-xs text-gray-400 block mb-1">Commodity</label>
                    <select
                      id="load-commodity"
                      value={selectedOrder.commodity || ''}
                      onChange={event => {
                        const commodity = event.target.value;
                        if (isHazmatLoad(selectedOrder) && commodity && commodity !== 'HAZMAT'
                          && !window.confirm('Confirm this freight is NOT hazardous. This changes the hazmat classification and Landstar export attributes.')) return;
                        handleFieldChange('commodity', commodity);
                      }}
                      className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white"
                    >
                      <option value="">Automatic ({getLoadCommodity({ ...selectedOrder, commodity: '' })})</option>
                      <option value="CGAPP">CGAPP - Consumer goods / appliances</option>
                      <option value="HAZMAT">HAZMAT - Hazardous materials</option>
                      <option value="CHEM">CHEM - Non-hazardous chemicals</option>
                    </select>
                    {isTankerLoad(selectedOrder) && (
                      <p className="text-xs text-yellow-300 font-bold mt-1">🛢 Tanker (N) Endorsement required</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="load-team" className="text-xs text-gray-400 block mb-1">Team</label>
                    <select
                      id="load-team"
                      value={isTeamLoad(selectedOrder) ? 'true' : 'false'}
                      onChange={event => handleFieldChange('team', event.target.value)}
                      className={`w-full border rounded p-2 text-sm font-bold cursor-pointer ${isTeamLoad(selectedOrder) ? 'bg-emerald-900/60 border-emerald-500 text-emerald-200' : 'bg-[#0b132b] border-[#1c2541] text-white'}`}
                    >
                      <option value="false">false</option>
                      <option value="true">true</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Driver & Equipment Assignment */}
              <div className="border border-[#1c2541] bg-[#121829]/60 p-4 rounded-lg">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="text-xs font-bold text-purple-400 uppercase tracking-wide">Driver & Equipment Assignment</h3>
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    <button
                      type="button"
                      onClick={async (event) => {
                        const button = event.currentTarget;
                        await copyToClipboard(formatDriverInfo(selectedOrder), 'Driver info');
                        button.textContent = '✓ Copied';
                        setTimeout(() => { button.textContent = '📋 Copy driver info'; }, 1500);
                      }}
                      title="Copy the driver's name, phone, truck, trailer, previous empty location, pickup ETA and load number"
                      className="bg-slate-700 hover:bg-slate-600 text-white text-[11px] px-2.5 py-1 rounded font-semibold cursor-pointer"
                    >
                      📋 Copy driver info
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyDriverLink}
                      title="Copy a link drivers can open to see this load and send you an inquiry"
                      className="bg-purple-700 hover:bg-purple-600 text-white text-[11px] px-2.5 py-1 rounded font-semibold cursor-pointer"
                    >
                      🔗 Copy driver link
                    </button>
                  </div>
                </div>
                {(() => {
                  const loadInquiries = inquiries.filter(inquiry => inquiry.customer === selectedBroker && String(inquiry.load_id) === String(selectedOrder.id));
                  if (!loadInquiries.length) return null;
                  return (
                    <div className="mb-3 border border-purple-500/50 rounded p-2 bg-purple-950/20">
                      <p className="text-[11px] font-bold text-purple-200 mb-1">📨 {loadInquiries.length} driver inquir{loadInquiries.length === 1 ? 'y' : 'ies'} on this load</p>
                      {loadInquiries.map(inquiry => (
                        <p key={inquiry.id} className="text-xs text-white">
                          {formatCheckTime(inquiry.created_at)} · <span className="font-semibold">{inquiry.driver_name}</span> ·{' '}
                          <a href={`tel:${String(inquiry.driver_phone).replace(/[^\d+]/g, '')}`} className="text-emerald-300 underline">{inquiry.driver_phone}</a>
                          {inquiry.mc_or_truck ? ` · ${inquiry.mc_or_truck}` : ''}
                          {inquiry.message ? ` · “${inquiry.message}”` : ''}
                        </p>
                      ))}
                    </div>
                  );
                })()}
                <datalist id="known-drivers">
                  {driverDirectory.drivers.map(entry => (
                    <option key={entry.driver} value={entry.driver} label={[entry.truck && `Truck ${entry.truck}`, entry.trailer && `Trailer ${entry.trailer}`, entry.driverPhone].filter(Boolean).join(' · ')} />
                  ))}
                </datalist>
                <datalist id="known-trucks">
                  {driverDirectory.trucks.map(truck => <option key={truck} value={truck} />)}
                </datalist>
                <datalist id="known-trailers">
                  {driverDirectory.trailers.map(trailer => <option key={trailer} value={trailer} />)}
                </datalist>
                <datalist id="known-driver-phones">
                  {driverDirectory.drivers.filter(entry => entry.driverPhone).map(entry => (
                    <option key={entry.driver} value={entry.driverPhone} label={entry.driver} />
                  ))}
                </datalist>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
                  <div>
                    <label htmlFor="assignment-driver" className="text-xs text-gray-400 block mb-1">Driver Name</label>
                    <div className="flex gap-1">
                      <input id="assignment-driver" type="text" list="known-drivers" autoComplete="off" value={selectedOrder.driver || ''} onChange={(e) => handleDriverChange(e.target.value)} placeholder="Type or pick a driver" className="min-w-0 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                      <button type="button" onClick={() => copyToClipboard(selectedOrder.driver || '', 'Driver Name')} title="Copy Driver Name" aria-label="Copy Driver Name" className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-2.5 rounded text-xs cursor-pointer">📋</button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="assignment-truck" className="text-xs text-gray-400 block mb-1">Truck Number</label>
                    <div className="flex gap-1">
                      <input id="assignment-truck" type="text" list="known-trucks" autoComplete="off" value={selectedOrder.truck || ''} onChange={(e) => handleFieldChange('truck', e.target.value)} placeholder="Truck number" className="min-w-0 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                      <button type="button" onClick={() => copyToClipboard(selectedOrder.truck || '', 'Truck Number')} title="Copy Truck Number" aria-label="Copy Truck Number" className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-2.5 rounded text-xs cursor-pointer">📋</button>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="assignment-trailer" className="text-xs text-gray-400 block mb-1">Trailer Number</label>
                    <div className="flex gap-1">
                      <input id="assignment-trailer" type="text" list="known-trailers" autoComplete="off" value={selectedOrder.trailer || ''} onChange={(e) => handleFieldChange('trailer', e.target.value)} placeholder="Trailer number" className="min-w-0 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                      <button type="button" onClick={() => copyToClipboard(selectedOrder.trailer || '', 'Trailer Number')} title="Copy Trailer Number" aria-label="Copy Trailer Number" className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-2.5 rounded text-xs cursor-pointer">📋</button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="assignment-pickup-eta" className="text-xs text-gray-400 block mb-1">Pickup ETA</label>
                    <input id="assignment-pickup-eta" type="text" value={selectedOrder.pickupEta || ''} onChange={(e) => handleFieldChange('pickupEta', e.target.value)} placeholder="MM/DD/YYYY HH:mm (local pickup time)" className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                  </div>
                </div>
                <div className="mt-3">
                  <label htmlFor="assignment-empty-location" className="text-xs text-gray-400 block mb-1">Previous Empty Location</label>
                  <div className="flex gap-1">
                    <input id="assignment-empty-location" type="text" autoComplete="off" value={selectedOrder.emptyLocation || ''} onChange={(e) => handleFieldChange('emptyLocation', e.target.value)} placeholder="City, ST where the truck empties before this load" className="min-w-0 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                    <button type="button" onClick={() => copyToClipboard(selectedOrder.emptyLocation || '', 'Previous Empty Location')} title="Copy Previous Empty Location" aria-label="Copy Previous Empty Location" className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-2.5 rounded text-xs cursor-pointer">📋</button>
                  </div>
                </div>
                <div className="mt-3">
                  <label htmlFor="assignment-driver-phone" className="text-xs text-gray-400 block mb-1">Driver Cell Phone</label>
                  <p className="text-xs text-gray-400 mb-1">Entering a phone number moves an unbooked load to OFFER. Book Load separately when accepted.</p>
                  <div className="flex gap-1">
                    <input id="assignment-driver-phone" type="tel" list="known-driver-phones" autoComplete="off" value={selectedOrder.driverPhone || ''} onChange={(e) => handleFieldChange('driverPhone', e.target.value)} placeholder="Enter cell phone number" className="min-w-0 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                    <button type="button" onClick={() => copyToClipboard(selectedOrder.driverPhone || '', 'Driver Cell Phone')} title="Copy Driver Cell Phone" aria-label="Copy Driver Cell Phone" className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-2.5 rounded text-xs cursor-pointer">📋</button>
                  </div>
                </div>
              </div>

              {/* Planning Comment Box */}
              <div className="bg-amber-950/30 border border-amber-600/50 p-3 rounded-lg">
                <span className="text-[11px] font-bold text-amber-400 block mb-1 uppercase">Planning Comment</span>
                <input
                  type="text"
                  value={selectedOrder.planningComment}
                  onChange={(e) => handleFieldChange('planningComment', e.target.value)}
                  className="w-full bg-[#0b132b] border border-amber-600/30 rounded p-1.5 text-xs text-amber-200 font-mono outline-none"
                />
              </div>

              {/* DAT RateView Reference */}
              <div className="border border-emerald-500/40 bg-emerald-950/20 p-4 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-wide">DAT RateView</span>
                  <div>
                    <button
                      onClick={handleOpenDatRateView}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] px-3 py-1.5 rounded font-semibold cursor-pointer shadow"
                    >
                      🔎 Open DAT + Copy Load Details
                    </button>
                  </div>
                </div>
                <div className="text-xs text-gray-300 font-mono bg-[#0b132b] p-2.5 rounded border border-[#1c2541]">
                  DAT API rate fetching is active. You can also open [RateView - DAT iQ](https://iq.dat.com/rateview) if needed.
                </div>
              </div>

              <div className="flex justify-between items-center gap-2 pt-4 border-t border-[#1c2541]">
                <button
                  type="button"
                  onClick={handleToggleNeedsCapacity}
                  title="Flag this pre-booked load as needing capacity soon. A ⭐ NEEDS CAPACITY badge shows on the load until you turn it off."
                  className={`px-4 py-2 rounded text-sm font-semibold cursor-pointer whitespace-nowrap ${String(selectedOrder.needsCapacity || '').trim() ? 'bg-amber-400 text-black' : 'bg-slate-700 hover:bg-slate-600 text-slate-100'}`}
                >
                  {String(selectedOrder.needsCapacity || '').trim() ? '⭐ Needs capacity' : '☆ Mark needs capacity'}
                </button>
                {selectedOrder.status === 'BOOKED' ? (
                  <div className="w-full flex flex-wrap items-center gap-2">
                    <div className="flex-1 min-w-[12rem] text-center bg-purple-900/50 border border-purple-500 text-purple-100 px-4 py-2 rounded text-sm font-semibold" role="status">
                      ✓ Booked in TMS{selectedOrder.driver ? ` · ${selectedOrder.driver}` : ''} · Landstar assignment is separate · edits save automatically
                    </div>
                    {String(selectedOrder.notes || '').includes('Landstar: not assigned automatically - ') && (
                      <div className="w-full text-amber-200 text-sm" role="alert">
                        {String(selectedOrder.notes).split('\n').filter(line => line.startsWith('Landstar: not assigned automatically - ')).join(' ')}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleRemoveCapacity}
                      title="Clear the driver, truck and trailer and move this load back to OPEN"
                      className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded text-sm font-semibold cursor-pointer"
                    >
                      ↩ Remove capacity
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleBookLoad}
                    title={String(selectedOrder.driver || '').trim() ? 'Book this load and move it to Booked Loads' : 'Enter the driver name to book this load'}
                    className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-2 rounded text-sm font-semibold flex-1 transition-colors shadow-lg cursor-pointer"
                  >
                    📦 Book Load
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <p>No loads available for this customer. Click "📂 Import Excel" at the top left to load your spreadsheet!</p>
          </div>
        )}
      </div>
    </div>
  );
}
