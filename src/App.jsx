import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from './lib/supabase';
import { detectScreenshotGrid, readScreenshotGrid } from './lib/screenshotTable.js';
import { findNtgCardRegions } from './lib/ntgCards.js';

const exportedLoadRetentionMs = 30 * 24 * 60 * 60 * 1000;
// Landstar's bulk upload accepts at most 25 loads per spreadsheet.
const landstarExportChunkSize = 25;

// ==========================================
// ZIP CODE AUTO-FILL DICTIONARY & HELPER
// ==========================================
const zipDatabase = {
  "PARCHMENT, MI": "49004",
  "STONE MOUNTAIN, GA": "30083",
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

function removeExpiredExportedLoads(customerOrders, now = Date.now()) {
  let changed = false;
  const nextOrders = {};
  Object.entries(customerOrders).forEach(([customer, loads]) => {
    nextOrders[customer] = loads.filter(load => {
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
  if (status === 'BOOKED') return 'BOOKED';
  return 'OPEN';
}

// Booking a load needs a driver; the load moves to the Booked Loads folder.
function bookLoad(load, bookedAt = new Date().toISOString()) {
  if (!String(load?.driver || '').trim()) {
    throw new Error('Enter the driver name before booking this load.');
  }
  return { ...load, status: 'BOOKED', tag: 'BOOKED', bookedAt: load.bookedAt || bookedAt };
}

// Takes the truck off a booked load: clears the driver, equipment, pickup ETA and
// tracking, and puts the load back in OPEN so it can be re-booked or exported.
// The rate and every other load detail are kept.
function removeCapacity(load) {
  const { bookedAt, trackingStage, checkCalls, ...rest } = load || {};
  return { ...rest, status: 'OPEN', tag: 'OPEN', driver: '', driverPhone: '', truck: '', trailer: '', pickupEta: '' };
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
    ? { ...load, status: 'ENT', tag: 'ENT', landstarExportedAt: exportedAt }
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
      || equipmentText.toUpperCase().match(/\b(V53|VM|VT|VZ|VE|VR|RZ|R|F|SD|VAN|V)\b/)?.[0]?.replace(/^V53$/, 'V') || '';
    const rowText = line.text.toLowerCase();
    if (/distance/.test(rowText) && /weight/.test(rowText) && /comment/.test(rowText)) return null;
    if (/\border\b/.test(rowText) && /\bearly\b/.test(rowText) && /\blate\b/.test(rowText)) return null;
    if (!origCity || !destCity) return null;

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
      status: isParaImport && line.orderNumberHighlighted ? 'ON HOLD' : 'OPEN',
      tag: isParaImport && line.orderNumberHighlighted ? 'HOLD' : 'OPEN',
      ...(isParaImport && typeof line.orderNumberHighlighted === 'boolean'
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
      notes: id && originState ? '' : 'Some fields were unreadable from the screenshot; please verify state codes and times.'
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
      eCode: /str\w{0,3}ght\s*tr\w*/i.test(equipmentText) ? 'D-LG,D-ST' : /sprinter|box\s*truck/i.test(equipmentText) ? 'D-LG,D-ST' : /c\w{1,3}est\w{0,2}ga/i.test(equipmentText) ? 'FLCS' : isFlatbed ? (isHazmat ? 'FH' : 'F,SD') : isHazmat ? (isReefer && !/\bvan\b/i.test(equipmentText) ? 'RZ' : 'VZ') : isReefer ? (/\bvan\b/i.test(equipmentText) ? 'VR' : 'R') : 'V',
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
  const regions = findNtgCardRegions(
    analysisContext.getImageData(0, 0, analysis.width, analysis.height).data, analysis.width, analysis.height
  );
  const loads = [];
  for (const [index, region] of regions.entries()) {
    onProgress?.(`Reading NTG load card ${index + 1} of ${regions.length}...`);
    const regionWidth = region.x1 - region.x0;
    const regionHeight = region.y1 - region.y0;
    const scale = Math.max(1, Math.min(4, 3600 / regionWidth));
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
      deliveryTime: String(selectedBroker || '').includes('965974') ? '' : '0800 - 1600',
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
    const savedLaneRate = getSavedLaneRate(laneRates, selectedBroker, order);
    if (savedLaneRate && (!order.rateInput || getFixedLaneRate(selectedBroker, order))) {
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
    case 'FLCS': return 'FLCS';
    case 'SD': return 'STEP:SD';
    case 'D-LG': return 'D-LG';
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
function findDroppedPostings(customer, importedLoads, existingLoads) {
  const importedIds = new Set(importedLoads.map(load => normalizeLoadId(getBaseLoadId(load))).filter(Boolean));
  if (!importedIds.size) return [];
  return existingLoads.filter(load => load.landstarPosting && !importedIds.has(normalizeLoadId(getBaseLoadId(load))));
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

// Weekly fuel surcharge report ($/mile) by pickup region; everything not listed uses the national average.
const fuelSurchargeRegions = {
  national: { label: 'National Average', states: [] },
  newEngland: { label: 'New England (PADD 1A)', states: ['CT', 'ME', 'MA', 'NH', 'RI', 'VT'] },
  rockyMountain: { label: 'Rocky Mountain (PADD 4)', states: ['CO', 'ID', 'MT', 'UT', 'WY'] },
  westCoast: { label: 'West Coast (PADD 5)', states: ['AK', 'AZ', 'CA', 'HI', 'NV', 'OR', 'WA'] }
};

const defaultFuelSurchargeRates = { national: '0.87', newEngland: '0.89', rockyMountain: '0.90', westCoast: '1.04' };

function normalizeFuelSurchargeRates(value) {
  const rates = { ...defaultFuelSurchargeRates };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return rates;
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
  return match ? match[0] : 'national';
}

// $/mile for a pickup state; a blank regional rate falls back to the national average.
function getFuelSurchargeRate(rates, state) {
  if (!rates || typeof rates !== 'object') return null;
  const parse = value => Number(String(value || '').replace(/[$,]/g, ''));
  const regional = parse(rates[getFuelSurchargeRegion(state)]);
  const rate = regional > 0 ? regional : parse(rates.national);
  return rate > 0 ? rate : null;
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
  if (/^D-LG/.test(code)) return code.includes('D-ST') ? 'D-LG,D-ST' : 'D-LG';
  if (/STRAIGHT\s*TRUCK|SPRINTER|BOX\s*TRUCK|HOT\s*SHOT/.test(code)) return 'D-LG,D-ST';
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

// Straight trucks post to Landstar as D-LG with D-ST as the alternate equipment.
function getLandstarEquipment2(ord) {
  if (isTeamLoad(ord)) return '53VN';
  if (isFlatbedEquipment(ord?.eCode)) return 'STEP';
  const code = String(ord?.eCode || '').trim().toUpperCase();
  if (code === 'D-LG' || code === 'D-LG,D-ST') return 'D-ST';
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
    FLCS: 'FLCS',
    SD: 'STEP'
  };
  if (equipmentCodes[code]) return equipmentCodes[code];
  if (code.startsWith('D-LG')) return 'D-LG';
  if (code.includes('53 FEET') || code.includes('53FT') || code.includes('53 FT')) return '53VN';
  if (code.startsWith('VAN')) return 'VAN';
  if (code.startsWith('REFR') || code.startsWith('REEFER')) return 'REFR';
  if (code.startsWith('FLAT')) return 'FLAT';
  if (code.startsWith('STEP')) return 'STEP';
  return code.match(/\b(24VN|28VN|48VN|53VN|VAN|REFR|FLAT|48FL|53FL|STEP|53SD|SD)\b/)?.[0] || '';
}

function getLandstarCommodity(value) {
  const equipmentCode = String(value || '').trim().toUpperCase().split(':')[0];
  // FH (flatbed hotshot) is not hazmat by itself; hazmat loads carry hazmat: 'true'.
  if (['VZ', 'RZ'].includes(equipmentCode)) {
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
  return getLandstarCommodity(load?.eCode) === 'HAZMAT'
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
  return ['F', 'F,SD', 'FH'].includes(String(value || '').replace(/\s/g, '').toUpperCase());
}

function getLoadCommodity(load) {
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

function getImportedLoadSelection(customer, importedLoads) {
  return normalizeCustomerName(customer) === ntgCustomerName
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

function isCh593772Customer(name) {
  return normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, '') === 'CH593772ATZ';
}

const importStatusPreservationCustomers = new Set([
  'PARA1522166ATZ',
  'RXO2429200ATZP',
  'NOLAN965974ATZH'
]);

function preservesImportedLoadStatus(name) {
  const normalized = normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return importStatusPreservationCustomers.has(normalized);
}

async function getGoogleRoadMiles(order) {
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
  return String(result.miles);
}

// Import policy: every imported load uses Google Routes driving miles instead of
// the miles printed on the import, for every customer.
async function applyGoogleRoadMiles(loads, onProgress, sourceLabel) {
  const eligible = loads.filter(load => load.origCity && load.origSt && load.destCity && load.destSt);
  let mileageError = '';
  for (let index = 0; index < eligible.length; index += 1) {
    const load = eligible[index];
    if (onProgress) onProgress(`Calculating driving miles ${index + 1} of ${eligible.length}...`);
    try {
      load.miles = await getGoogleRoadMiles(load);
      const note = 'driving miles calculated by Google Routes';
      load.planningComment = load.planningComment ? `${load.planningComment}; ${note}` : `${sourceLabel}; ${note}`;
    } catch (error) {
      console.error('Google Routes could not calculate imported load miles:', error);
      mileageError = error.message || 'Google Routes could not calculate the driving miles.';
      for (let remaining = index; remaining < eligible.length; remaining += 1) {
        const remainingLoad = eligible[remaining];
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
    if (!existing && hasPastPickupDate(load)) {
      merged.status = 'ENT';
      merged.tag = 'ENT';
    }
    if (existing) {
      ['rateInput', 'rateSource', 'carrier', 'driver', 'driverPhone', 'truck', 'trailer', 'pickupEta', 'notes', 'landstarComment'].forEach(field => {
        if (String(existing[field] || '').trim()) merged[field] = existing[field];
      });
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
    if (isParaCustomer(customer) && load.screenshotStatus === 'ON HOLD') {
      merged.status = 'ON HOLD';
      merged.tag = 'HOLD';
    }
    delete merged.screenshotStatus;
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
    // Loads from before the RXO van state rule was added are cleared out on the next import.
    if (isRxoSkippedVanLoad(customer, load)) return false;
    // Same for loads to or from Mexico imported before that rule.
    if (isMexicoLoad(load)) return false;
    if (isSkippableEquipment(load.eCode)) return false;
    const exportedAt = Date.parse(load.landstarExportedAt);
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
  const dropped = reportDroppedPostings ? findDroppedPostings(customer, importedLoads, existingLoads) : [];
  const droppedIds = new Set(dropped.map(load => String(load.id)));
  const droppedPostings = dropped.map(load => ({ customer, loadId: String(load.id), posting: load.landstarPosting }));
  const loads = [...mergedLoads, ...retained].map(load => {
    if (!droppedIds.has(String(load.id))) return load;
    const { landstarPosting, ...rest } = load;
    return rest;
  });
  return {
    loads, additive, processedLoads: mergedLoads, droppedPostings, skippedRxoVanCount, skippedMexicoCount, skippedEquipmentCount,
    laneDayDuplicateCount,
    usesScreenshotStatus: isParaCustomer(customer)
      && importedLoads.some(load => ['ON HOLD', 'OPEN'].includes(load.screenshotStatus)),
    duplicateCount,
    removedCount: existingLoads.filter(load => !matchedIds.has(String(load.id)) && !retained.includes(load)).length
  };
}

function getImportReplacementMessage(replacement) {
  return replacement
    ? `• ${replacement.additive ? 'Imported list merged' : 'Full list replaced'}; removed loads: ${replacement.removedCount}. Exported ENT loads retained for 30 days unless re-imported.\n` +
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
function hasPastPickupDate(load) {
  const text = String(load?.pickupTime || load?.puDate || '');
  const match = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/);
  if (!match) return false;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const pickup = new Date(year, Number(match[1]) - 1, Number(match[2]));
  if (Number.isNaN(pickup.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return pickup < today;
}

// Past-dated pickups import as ENT, but only for loads we have never seen before;
// re-imports of existing loads keep their current status/assignment behavior.
function applyPastPickupEntStatus(importedLoad, existingLoads) {
  if (!hasPastPickupDate(importedLoad)) return importedLoad;
  const baseId = getBaseLoadId(importedLoad);
  const isNew = !existingLoads.some(load => getBaseLoadId(load) === baseId);
  return isNew ? { ...importedLoad, status: 'ENT', tag: 'ENT' } : importedLoad;
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

// Persist a rate for a lane so the next load in the same lane reuses it.
// Returns the updated laneRates map (or the original if the rate/key is invalid).
function rememberLaneRate(laneRates, customer, order, rate, source = 'manual') {
  const numericRate = Number(String(rate || '').replace(/[$,]/g, ''));
  const key = createLaneRateKey(customer, order);
  if (!key || !(numericRate > 0) || !Number.isFinite(numericRate)) return laneRates;
  recordRateHistory(customer, order, numericRate, source);
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

function getLoadSearchEntries(customerOrdersMap, selectedBroker, searchQuery) {
  const query = searchQuery.trim().toLowerCase();
  const customers = query ? Object.entries(customerOrdersMap) : [[selectedBroker, customerOrdersMap[selectedBroker] || []]];
  return customers.flatMap(([customer, loads]) => loads
    .filter(order => !query || [
      order.id, order.route, order.origCity, order.origSt,
      order.destCity, order.destSt, order.planningComment
    ].some(value => String(value || '').toLowerCase().includes(query)))
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

// Every booked load across all customers: active loads by pickup time, delivered last.
function getBookedLoads(customerOrdersMap) {
  return Object.entries(customerOrdersMap || {})
    .flatMap(([customer, loads]) => (loads || []).filter(load => load.status === 'BOOKED').map(load => ({ customer, load })))
    .sort((a, b) => {
      const delivered = entry => (entry.load.trackingStage === 'Delivered' ? 1 : 0);
      if (delivered(a) !== delivered(b)) return delivered(a) - delivered(b);
      return (parseScheduleStart(a.load.pickupTime) ?? Infinity) - (parseScheduleStart(b.load.pickupTime) ?? Infinity);
    });
}

function getLastCheckCall(load) {
  const calls = Array.isArray(load.checkCalls) ? load.checkCalls : [];
  return calls.length ? calls[calls.length - 1] : null;
}

// What needs attention on a booked load: late (red) beats check call due (amber).
function getTrackingAlert(load, now = Date.now()) {
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
  const lastAt = Date.parse(getLastCheckCall(load)?.at) || Date.parse(load.bookedAt);
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

function BookedLoadsPage({ entries, now, onBack, onOpen, onUpdate, onRemoveCapacity }) {
  const activeCount = entries.filter(({ load }) => load.trackingStage !== 'Delivered').length;
  const alertCount = entries.filter(({ load }) => getTrackingAlert(load, now)).length;
  const phoneDigits = value => String(value || '').replace(/[^\d+]/g, '');
  return (
    <div className="flex flex-col gap-4" aria-label="Booked Loads">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#161f36] px-4 py-3 rounded-lg border border-purple-500/60">
        <div>
          <h2 className="text-lg font-bold text-purple-200">📦 Booked Loads</h2>
          <p className="text-xs text-gray-300">
            {activeCount} active · {entries.length - activeCount} delivered · {alertCount} need attention · all customers
          </p>
        </div>
        <button type="button" onClick={onBack} className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-3 py-1.5 rounded font-semibold cursor-pointer">
          ← Back to loads
        </button>
      </div>
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
        return (
          <div
            key={`${customer}|${load.id}`}
            data-booked-load={load.id}
            className={`rounded-lg border p-4 bg-[#121829] ${alert?.level === 'late' ? 'border-red-500' : alert?.level === 'due' ? 'border-amber-400' : delivered ? 'border-[#1c2541] opacity-60' : 'border-purple-500/50'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] text-gray-400">{customer}</p>
                <button type="button" onClick={() => onOpen(customer, load.id)} title="Open this load" className="text-white font-bold text-sm hover:underline cursor-pointer">
                  #{load.id}
                </button>
                <p className="text-sm text-white">{load.origCity}, {load.origSt} → {load.destCity}, {load.destSt}</p>
                <p className="text-[11px] text-gray-300">PU {load.pickupTime || '—'} · DEL {load.deliveryTime || '—'}{load.rateInput ? ` · $${load.rateInput}` : ''}</p>
              </div>
              <div className="text-sm text-white">
                <p className="font-semibold">🚚 {load.driver || 'No driver'}</p>
                <p className="text-[11px] text-gray-300">Truck {load.truck || '—'} · Trailer {load.trailer || '—'}{load.pickupEta ? ` · PU ETA ${load.pickupEta}` : ''}</p>
                {phone ? (
                  <p className="flex gap-2 mt-1">
                    <a href={`tel:${phone}`} className="bg-emerald-700 hover:bg-emerald-600 text-white text-[11px] px-2 py-0.5 rounded font-semibold">📞 Call {load.driverPhone}</a>
                    <a href={`sms:${phone}`} className="bg-sky-700 hover:bg-sky-600 text-white text-[11px] px-2 py-0.5 rounded font-semibold">💬 Text</a>
                  </p>
                ) : <p className="text-[11px] text-amber-300 mt-1">No driver phone on file</p>}
              </div>
              <div className="flex flex-col items-end gap-1">
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
                <div className="flex gap-1 mt-1">
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
            <form
              className="flex gap-2 mt-3"
              onSubmit={event => {
                event.preventDefault();
                const form = event.currentTarget;
                const note = String(form.elements.note.value || '').trim();
                if (!note) return;
                onUpdate(customer, load.id, logCheckCall(load, { stage, note }));
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

// Compact list: smaller load cards so many more fit on screen. Remembered per browser.
const compactListKey = 'landstar_compactList';

function CompactListToggle() {
  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem(compactListKey) === 'true'; } catch { return false; }
  });
  useEffect(() => {
    if (typeof document !== 'undefined') document.body.classList.toggle('tms-compact-list', compact);
    try { localStorage.setItem(compactListKey, String(compact)); } catch { /* storage unavailable */ }
  }, [compact]);
  return (
    <button
      type="button"
      onClick={() => setCompact(on => !on)}
      aria-pressed={compact}
      title={compact ? 'Show full load cards' : 'Show more loads at once (compact cards)'}
      className={`rounded border px-2 text-xs font-semibold whitespace-nowrap ${compact ? 'bg-cyan-600 border-cyan-400 text-white' : 'bg-[#0b132b] border-[#1c2541] text-white hover:border-cyan-500'}`}
    >
      {compact ? '▤ Compact' : '▦ Full cards'}
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

// The Landstar upload bot (bot/status-server.js) reports its login status on
// this computer while it runs. No answer means the bot is not running.
const BOT_STATUS_URL = 'http://127.0.0.1:47615/status';
const BOT_UNPOST_URL = 'http://127.0.0.1:47615/unpost';

// Postings waiting to be removed from Landstar by the upload bot (loads that dropped
// off a customer's list). Kept in this browser until the bot confirms it has them.
const unpostQueueKey = 'landstar_unpostQueue';
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

function BotStatusLight() {
  const [status, setStatus] = useState({ state: 'off', message: 'Upload bot is not running' });
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch(BOT_STATUS_URL, { cache: 'no-store', signal: controller.signal });
        const next = await response.json();
        if (!cancelled) setStatus(botStatusStyles[next.state] ? next : { state: 'off', message: 'Upload bot is not running' });
      } catch {
        if (!cancelled) setStatus({ state: 'off', message: 'Upload bot is not running' });
      } finally {
        clearTimeout(timer);
      }
    };
    check();
    const interval = setInterval(check, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);
  const style = botStatusStyles[status.state] || botStatusStyles.off;
  return (
    <span
      className="inline-flex items-center gap-1.5 bg-slate-800 text-white text-xs px-2.5 py-1 rounded font-medium normal-case tracking-normal"
      title={status.message || style.label}
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        style={{ width: 10, height: 10, borderRadius: '50%', background: style.dot, boxShadow: style.glow, display: 'inline-block' }}
      />
      {style.label}
    </span>
  );
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
  const [loadFilters, setLoadFilters] = useState({ rate: '', minMiles: '', maxMiles: '', pickupState: '', deliveryState: '' });
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
          if (savedRate && !(Number(row.load.rateInput) > 0)) {
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
    let updatedOrder = { ...selectedOrder, [field]: value };
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
      [selectedBroker]: (prev[selectedBroker] || []).map(o => o.id === updatedOrder.id ? updatedOrder : o)
    }));
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
    + 'The driver, phone, truck, trailer, pickup ETA and tracking are cleared. The rate and load details stay.'
  );

  const handleRemoveCapacity = () => {
    if (!selectedOrder || !confirmRemoveCapacity(selectedOrder)) return;
    saveLoad(removeCapacity(selectedOrder));
  };

  const handleBookLoad = () => {
    if (!selectedOrder) return;
    try {
      saveLoad(bookLoad(selectedOrder));
    } catch (error) {
      alert(error.message);
    }
  };

  // Typing or picking a known driver fills in their phone, truck and trailer
  // (only into boxes that are still empty).
  const handleDriverChange = value => {
    if (!selectedOrder) return;
    const known = findKnownDriver(driverDirectory, value);
    const updatedOrder = { ...selectedOrder, driver: value };
    if (known) {
      ['driverPhone', 'truck', 'trailer'].forEach(field => {
        if (!String(selectedOrder[field] || '').trim() && known[field]) updatedOrder[field] = known[field];
      });
    }
    saveLoad(updatedOrder);
  };

  const handleDelete = () => {
    if (!selectedOrder) return;
    const remaining = orders.filter(o => o.id !== selectedOrder.id);
    setCustomerOrdersMap(prev => ({ ...prev, [selectedBroker]: remaining }));
    if (remaining.length > 0) setSelectedOrder(remaining[0]);
    else setSelectedOrder(null);
  };

  const handleToggleSelect = (id, e) => {
    e.stopPropagation();
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(item => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleSelectAll = (filteredOrders) => {
    const filteredIds = filteredOrders.map(o => o.id);
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
    setLoadFilters({ rate: '', minMiles: '', maxMiles: '', pickupState: '', deliveryState: '' });
    setLaneSort('');
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    if (window.confirm(`Are you sure you want to delete ${selectedIds.length} selected loads?`)) {
      const remaining = orders.filter(o => !selectedIds.includes(o.id));
      setCustomerOrdersMap(prev => ({ ...prev, [selectedBroker]: remaining }));
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
    setCustomerOrdersMap(prev => ({
      ...prev,
      [selectedBroker]: (prev[selectedBroker] || []).map(o => (
        selectedIds.includes(o.id) ? { ...o, status: newStatus, tag } : o
      ))
    }));
    setSelectedOrder(current => (
      current && selectedIds.includes(current.id) ? { ...current, status: newStatus, tag } : current
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
    const pickerClass = 'bg-[#0b132b] border border-[#1c2541] rounded px-1 py-0.5 text-[11px] text-white [color-scheme:dark]';
    return (
      <div className="flex flex-wrap items-center gap-1 mt-1">
        <span className="text-[10px] text-gray-500">From</span>
        <input type="date" value={parts.from?.date || ''} onChange={e => update('from', 'date', e.target.value)} className={pickerClass} />
        <input type="time" value={parts.from?.time || ''} onChange={e => update('from', 'time', e.target.value)} className={pickerClass} />
        <span className="text-[10px] text-gray-500 ml-1">To</span>
        <input type="date" value={parts.to?.date || ''} onChange={e => update('to', 'date', e.target.value)} className={pickerClass} />
        <input type="time" value={parts.to?.time || ''} onChange={e => update('to', 'time', e.target.value)} className={pickerClass} />
      </div>
    );
  };

  const renderCopyableField = (label, field) => (
    <div className="min-w-0">
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      <div className="flex gap-1">
        <input
          type="text"
          value={selectedOrder[field] || ''}
          onChange={(e) => handleFieldChange(field, e.target.value)}
          className="min-w-0 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white"
        />
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
      let gmailDatRateError = '';
      for (const load of uniqueLoads) {
        if (!Number(load.rateInput) > 0) {
          const datRateInfo = await fetchDatRateForImport(load, selectedBroker, laneRates);
          if (datRateInfo.rateInput) {
            load.rateInput = datRateInfo.rateInput;
            load.rateSource = datRateInfo.rateSource;
            setLaneRates(prev => rememberLaneRate(prev, selectedBroker, load, load.rateInput, load.rateSource));
          } else if (!gmailDatRateError && datRateInfo.error) {
            gmailDatRateError = datRateInfo.error;
          }
        }
      }
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
            ...(!preserveStatus && wasPreviouslyExported
              ? { status: 'OPEN', tag: 'OPEN' }
              : !preserveStatus && keepsEnt ? { status: 'ENT', tag: 'ENT' } : {}),
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

  const handleExcelImport = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: false });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (rawRows.length <= 1) {
          alert("The uploaded Excel sheet is empty or only contains headers!");
          return;
        }

        const headerRow = rawRows[0] || [];
        const findColIndex = (possibleNames, defaultIdx) => {
          for (let name of possibleNames) {
            const idx = headerRow.findIndex(h => String(h || '').trim().toLowerCase() === name.toLowerCase());
            if (idx !== -1) return idx;
          }
          return defaultIdx;
        };

        const colA = findColIndex(['Order #', 'Load ID', 'Order Number', 'Load Posting Code'], 0);
        const colB = findColIndex(['Equipment', 'Equipment Type', 'Equipment 1', 'Equip'], 1);
        const colG = findColIndex(['Origin City', 'Orig City', 'Origin', 'Origin - City'], 6);
        const colH = findColIndex(['Origin State', 'Origin St', 'Orig State', 'Origin - State'], 7);
        const colI = findColIndex(['Origin Zipcode', 'Origin Zip', 'Orig Zip', 'Origin - Zip'], 8);
        const colL = findColIndex(['Destination City', 'Dest City', 'Destination', 'Destination - City'], 11);
        const colM = findColIndex(['Destination State', 'Destination St', 'Dest State', 'Destination - State'], 12);
        const colN = findColIndex(['Destination Zipcode', 'Destination Zip', 'Dest Zip', 'Destination - Zip'], 13);
        const colO = findColIndex(['Weight', 'Wgt', 'Weight (lbs)'], 14);
        const isRxoPayerImport = normalizeCustomerName(selectedBroker) === rxoPayerCustomerName;
        const isRxoImport = isRxoCustomer(selectedBroker);
        const pickupTimeCol = findColIndex(['Pickup Date (From)', 'Pickup Time', 'PU Time'], -1);
        const deliveryTimeCol = findColIndex(['Delivery Date (From)', 'Delivery Time', 'Del Time'], -1);
        const hasRxoTimeColumns = pickupTimeCol >= 0 && deliveryTimeCol >= 0;
        const useRxoDateTimeFormat = isRxoImport || hasRxoTimeColumns;
        const colQ = isRxoImport && !hasRxoTimeColumns ? 16 : pickupTimeCol >= 0 ? pickupTimeCol : 16;
        const colR = isRxoImport && !hasRxoTimeColumns ? 17 : deliveryTimeCol >= 0 ? deliveryTimeCol : 17;
        const colS = findColIndex(['Bill as Miles', 'Miles', 'Distance', 'Loaded Miles'], 18);
        // Only real column names here (no position fallback): other files put weight or
        // dates where an RXO list has its commodity.
        const commodityCols = ['Commodity', 'Commodity Description']
          .map(name => findColIndex([name], -1))
          .filter(index => index >= 0);

        const dataRows = rawRows.slice(1);
        const getRxoDateTime = (row, rowIndex, colIndex) => {
          const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex + 1, c: colIndex })];
          return formatRxoExcelDateTime(cell ? XLSX.utils.format_cell(cell) : row[colIndex]);
        };
        let datRateError = '';
        let skippedEquipmentCount = 0;
        let importedRows = [];
        for (let idx = 0; idx < dataRows.length; idx++) {
          const row = dataRows[idx];
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
            ? getRxoDateTime(row, idx, colQ)
            : formatExcelDateTime(row[colQ]);
          const delTimeVal = useRxoDateTimeFormat
            ? getRxoDateTime(row, idx, colR)
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

          let rateVal = getSavedLaneRate(laneRates, selectedBroker, tempOrder);
          let rateSrc = rateVal ? 'user-entered' : undefined;

          // Auto-fetch via DAT Ratecast API if no local rate exists
          if (!rateVal) {
            const datRateInfo = await fetchDatRateForImport(tempOrder, selectedBroker, laneRates);
            if (datRateInfo.rateInput) {
              rateVal = datRateInfo.rateInput;
              rateSrc = datRateInfo.rateSource;
              // Remember DAT-fetched rates so the next load in this lane reuses the last rate.
              setLaneRates(prev => rememberLaneRate(prev, selectedBroker, tempOrder, rateVal));
            } else if (!datRateError && datRateInfo.error) {
              datRateError = datRateInfo.error;
            }
          }

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
          } else if (wasPreviouslyExported && !preserveStatus) {
            mergedLoads.set(load.id, { ...existingLoad, status: 'OPEN', tag: 'OPEN' });
          } else if (load.status === 'ENT' && existingLoad.status !== 'ENT' && !preserveStatus) {
            mergedLoads.set(load.id, { ...existingLoad, status: 'ENT', tag: 'ENT' });
          } else if (useRxoDateTimeFormat) {
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
        setFilter('OPEN');

        const duplicatesRemoved = replacement ? 0 : duplicateImportCount + duplicateExistingCount;

        alert(
          `📂 Excel Import Complete for ${selectedBroker}:\n` +
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
    reader.readAsArrayBuffer(file);
  };

  const handleScreenshotImport = async (event, importMode = 'ai') => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (isImportingScreenshot) return;
    await importScreenshotFile(file, importMode);
  };

  const importScreenshotFile = async (file, importMode) => {
    if (!file) return;
    const brokerName = selectedBroker;
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
      for (const load of recognizedLoads) {
        if (!isDatImport && !(Number(load.rateInput) > 0)) {
          const datRateInfo = await fetchDatRateForImport(load, brokerName, laneRates);
          if (datRateInfo.rateInput) {
            load.rateInput = datRateInfo.rateInput;
            load.rateSource = datRateInfo.rateSource;
          }
        }
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
        if (preserveStatus) {
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
      void importScreenshotFile(image, 'ntg');
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
  useEffect(() => {
    const timer = setInterval(() => { void sendUnpostQueueToBot(); }, 30 * 1000);
    return () => clearInterval(timer);
  }, []);

  // Queues a full-list import's dropped loads for removal from Landstar. If an import
  // would drop more than half of a customer's posted loads, ask first: the file may be
  // cut off or misread.
  const queueDroppedPostings = (replacement, existingLoads, { interactive = true } = {}) => {
    const dropped = replacement?.droppedPostings || [];
    if (!dropped.length) return 0;
    // Paramount removals always need a yes; every other customer's are removed automatically.
    if (dropped.some(item => isParaCustomer(item.customer))) {
      const posted = (existingLoads || []).filter(load => load.landstarPosting).length;
      const ok = interactive && window.confirm(
        `${dropped.length} of ${posted} Paramount loads posted on Landstar are not on the new list.\n\n`
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
      ? orders.filter(o => selectedIds.includes(o.id))
      : filteredOrders;
    // Booked loads already have a truck; never post them to the Landstar board.
    const unbookedLoads = candidateLoads.filter(o => o.status !== 'BOOKED');
    const skippedBookedCount = candidateLoads.length - unbookedLoads.length;
    // RXO ATZ van loads picking up in skipped states are never posted.
    const notRxoSkipped = unbookedLoads.filter(o => !isRxoSkippedVanLoad(selectedBroker, o));
    const skippedRxoVanCount = unbookedLoads.length - notRxoSkipped.length;
    // Loads to or from Mexico are never posted.
    const notMexico = notRxoSkipped.filter(o => !isMexicoLoad(o));
    const skippedMexicoCount = notRxoSkipped.length - notMexico.length;
    // Intermodal ("INT") and oversized equipment is never posted.
    const loadsToExport = notMexico.filter(o => !isSkippableEquipment(o.eCode));
    const skippedEquipmentExportCount = notMexico.length - loadsToExport.length;

    if (loadsToExport.length === 0) {
      alert(skippedBookedCount || skippedRxoVanCount || skippedMexicoCount || skippedEquipmentExportCount
        ? `Nothing to export: ${[
          skippedBookedCount && `${skippedBookedCount} booked load(s)`,
          skippedRxoVanCount && `${skippedRxoVanCount} RXO van load(s) picking up in WI, IN, OH, MI, MN, SD, ND, UT or ID`,
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
        'WOOLWICH TOWNSHIP|NJ': { zip: '08085', city: 'Woolwich Township', state: 'NJ' }
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
      const pickupThru = toExcelDateTime(puParts[1] || puParts[0], puParts[0]);
      const pickupWindow = adjustPickupWindow(toExcelDateTime(puParts[0]), pickupThru, earliestPickupSerial);
      const pickupFrom = pickupWindow.from;
      if (pickupWindow.moved) movedPickupStarts.push(ord.id);
      const deliveryFrom = toExcelDateTime(delParts[0]);
      const deliveryThru = toExcelDateTime(delParts[1] || delParts[0], delParts[0]);
      const equipment = getLandstarEquipmentCode(ord.eCode);
      const commodity = getLoadCommodity(ord);
      const miles = Number(normalizeMilesValue(ord.miles));
      const weight = parseWeightPounds(ord.weight);
      const rate = Number(String(ord.rateInput || '').replace(/[$,]/g, ''));
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
        "Equipment 3": "",
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
        const withPosting = posting ? { ...load, landstarPosting: posting } : load;
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
  const statusOrderEntries = getLoadSearchEntries(customerOrdersMap, selectedBroker, searchQuery)
    .filter(({ order: ord }) => filter === 'ALL' || ord.status === filter);
  const rateCountOrders = statusOrderEntries.filter(({ customer }) => customer === selectedBroker).map(({ order }) => order);
  const withRateCount = rateCountOrders.filter(hasLoadRate).length;
  const noRateCount = rateCountOrders.length - withRateCount;
  const minMilesFilter = Number(loadFilters.minMiles);
  const maxMilesFilter = Number(loadFilters.maxMiles);
  const hasMinMiles = loadFilters.minMiles !== '' && Number.isFinite(minMilesFilter);
  const hasMaxMiles = loadFilters.maxMiles !== '' && Number.isFinite(maxMilesFilter);
  const visibleOrderEntries = statusOrderEntries.filter(({ order: ord }) => {
    if (loadFilters.rate === 'with' && !hasLoadRate(ord)) return false;
    if (loadFilters.rate === 'without' && hasLoadRate(ord)) return false;
    if (loadFilters.pickupState && String(ord.origSt || '').trim().toUpperCase() !== loadFilters.pickupState) return false;
    if (loadFilters.deliveryState && String(ord.destSt || '').trim().toUpperCase() !== loadFilters.deliveryState) return false;
    if (hasMinMiles || hasMaxMiles) {
      const miles = Number(normalizeMilesValue(ord.miles));
      if (hasMinMiles && !(miles >= minMilesFilter)) return false;
      if (hasMaxMiles && !(miles <= maxMilesFilter)) return false;
    }
    return true;
  }).sort(({ order: left }, { order: right }) => {
    if (laneSort === 'pickup-asc' || laneSort === 'pickup-desc') {
      const difference = getPickupSortValue(left) - getPickupSortValue(right);
      return (laneSort === 'pickup-desc' ? -difference : difference)
        || String(left.id).localeCompare(String(right.id), undefined, { numeric: true });
    }
    if (!laneSort) return 0;
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
    <div className="tms-shell flex h-screen text-white overflow-hidden font-sans">
      {/* Left Sidebar - Order List */}
      <div className="tms-sidebar w-96 border-r border-[#1c2541] flex flex-col">
        <div className="tms-sidebar-header p-3 border-b border-[#1c2541]">
          <div className="tms-top-controls flex flex-col items-start gap-2 mb-2">
            <button
              type="button"
              onClick={() => setShowHeader(open => !open)}
              aria-expanded={showHeader}
              className="text-[10px] font-bold text-gray-300 hover:text-white self-start"
            >
              {showHeader ? '▾ Hide header' : '▸ Show header'}
            </button>
            {showHeader && (
            <div className="tms-sidebar-logos">
              <div className="tms-landstar-mark" role="img" aria-label="Landstar">
                <span className="tms-landstar-word">Landstar</span>
                <svg className="tms-landstar-star" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 1.8l3.05 6.55 7.15.86-5.27 4.93 1.38 7.1L12 17.75l-6.31 3.49 1.38-7.1L1.8 9.21l7.15-.86z" />
                </svg>
              </div>
              <img className="tms-eagles-logo" src="/eagles-sidebar.png" alt="Eagles artwork" width="474" height="475" />
            </div>
            )}
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
                    <input type="file" accept=".xlsx, .xls, .csv" onChange={handleExcelImport} className="hidden" />
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
          <div className="flex flex-col gap-1.5 my-2">
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
                  className={`tms-customer flex items-center justify-between px-2.5 py-1.5 text-[11px] rounded font-medium border transition-colors ${selectedBroker === broker ? 'bg-blue-600/30 border-blue-500 text-white' : 'bg-[#1c2541] border-[#253259] text-gray-300 hover:bg-[#253259]'}`}
                  data-selected={selectedBroker === broker}
                >
                  <span
                    className="truncate flex-1 cursor-pointer"
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

          <div className="relative mb-2">
            <input
              type="text"
              placeholder="🔍 Search all customers: load #, city, state..."
              aria-label="Search loads across all customers"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0b132b] border-2 border-blue-500/60 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-400 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/40"
            />
          </div>
          {isGlobalSearch && (
            <p className="mb-2 text-[10px] text-gray-400">
              All customers · Current status and lane filters apply. Click a result to open its customer.
              Bulk selection and export apply to the selected customer only.
            </p>
          )}

          <div className="flex items-center justify-between text-[11px] text-gray-400 mb-2">
            <span>{isGlobalSearch ? `${visibleOrderEntries.length} matches · All customers` : `${filteredOrders.length} shown · ${orders.length} loads · ${entCount} ENT · ${bookedCount} booked`}</span>
            <span className={storageError ? 'text-amber-400' : 'text-emerald-400'} title={storageError || 'Loads are saved in this browser.'}>
              {storageError || '🔒 Saved in this browser'}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
            <div className="flex flex-wrap gap-1">
              {['ALL', 'OPEN', 'ON HOLD', 'ENT', 'BOOKED'].map(tab => (
                <button
                  key={tab}
                  onClick={() => {
                    // BOOKED opens the Booked Loads page (all customers); other tabs filter this list.
                    if (tab === 'BOOKED') {
                      setView('booked');
                    } else {
                      setFilter(tab);
                      setView('loads');
                    }
                  }}
                  title={tab === 'BOOKED' ? 'Open the Booked Loads page: every load with a driver, all customers' : undefined}
                  className={`px-2 py-1 text-[11px] rounded font-semibold ${tab === 'OPEN' ? `tms-open ${filter === tab ? 'ring-2 ring-emerald-200' : ''}` : tab === 'ENT' ? `tms-ent ${filter === tab ? 'ring-2 ring-yellow-200' : ''}` : tab === 'ON HOLD' ? filter === tab ? 'bg-red-600 text-white ring-2 ring-red-300' : 'bg-red-700 hover:bg-red-600 text-white' : tab === 'BOOKED' ? filter === tab ? 'bg-purple-600 text-white ring-2 ring-purple-300' : 'bg-purple-700 hover:bg-purple-600 text-white' : filter === tab ? 'bg-blue-600 text-white' : 'bg-[#1c2541] text-gray-400'}`}
                >
                  {tab === 'BOOKED' ? `BOOKED (${allBookedCount})` : tab}
                </button>
              ))}
            </div>
            {selectedIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 w-full">
                <span className="text-[10px] text-gray-400">Move to:</span>
                {['OPEN', 'ON HOLD', 'ENT'].map(status => (
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
                checked={filteredOrders.length > 0 && filteredOrders.every(o => selectedIds.includes(o.id))}
                className="cursor-pointer accent-blue-600"
              />
              <span className="text-[11px] text-gray-400">{isGlobalSearch ? 'Select All (current customer)' : 'Select All'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={selectedIds.length === 0}
                onClick={() => copyToClipboard(
                  filteredOrders.filter(o => selectedIds.includes(o.id)).map(o => `${o.id} ${o.route || ''}`.trim()).join('\n'),
                  'Selected loads'
                )}
                title="Copy load number and pickup/delivery city/state for every checked load"
                className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold px-2 py-0.5 rounded cursor-pointer"
              >
                📋 Copy Selected ({filteredOrders.filter(o => selectedIds.includes(o.id)).length})
              </button>
              <button
                type="button"
                onClick={handleClearAllFilters}
                disabled={!searchQuery.trim() && !loadFilters.rate && !loadFilters.minMiles && !loadFilters.maxMiles && !loadFilters.pickupState && !loadFilters.deliveryState && !laneSort}
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

          <div className="mt-2 flex gap-1.5">
            <CompactListToggle />
            <button
              type="button"
              onClick={() => setLaneSort(current => current === 'pickup-asc' ? 'pickup-desc' : 'pickup-asc')}
              className={`flex-1 rounded border p-1.5 text-xs font-semibold ${laneSort.startsWith('pickup') ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#0b132b] border-[#1c2541] text-white hover:border-blue-500'}`}
            >
              {laneSort === 'pickup-asc' ? 'Pickup date: earliest first ↑' : laneSort === 'pickup-desc' ? 'Pickup date: latest first ↓' : 'Sort by pickup date'}
            </button>
          </div>
          <div className="mt-1.5">
            <select
              aria-label="Sort loads by city and state"
              value={laneSort.startsWith('pickup') ? '' : laneSort}
              onChange={e => setLaneSort(e.target.value)}
              className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-1.5 text-xs text-white outline-none focus:border-blue-500"
            >
              <option value="">Sort by city/state (default)</option>
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
          <div className="flex items-center gap-1.5 mt-1.5 px-1">
            <span className="text-[11px] text-gray-400">States:</span>
            <select
              aria-label="Filter by pickup state"
              value={loadFilters.pickupState}
              onChange={e => { setLoadFilters(prev => ({ ...prev, pickupState: e.target.value })); setSelectedIds([]); }}
              className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-1 text-xs text-white outline-none focus:border-blue-500"
            >
              <option value="">Pickup state (all)</option>
              {sortedStateCodes.map(state => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
            <span className="text-[11px] text-gray-500">→</span>
            <select
              aria-label="Filter by delivery state"
              value={loadFilters.deliveryState}
              onChange={e => { setLoadFilters(prev => ({ ...prev, deliveryState: e.target.value })); setSelectedIds([]); }}
              className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-1 text-xs text-white outline-none focus:border-blue-500"
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

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {visibleOrderEntries.length === 0 ? (
            <div className="text-center text-gray-500 text-xs py-10">{isGlobalSearch ? 'No matching loads across all customers with the current filters.' : `No loads found for ${selectedBroker}. Click "📂 Import Excel" above!`}</div>
          ) : (
            visibleOrderEntries.map(({ customer, order: ord }) => (
              <div
                key={JSON.stringify([customer, ord.id])}
                id={`load-card-${ord.id}`}
                onClick={() => handleSelectSearchResult(customer, ord)}
                onDoubleClick={(e) => { if (customer === selectedBroker) handleToggleSelect(ord.id, e); }}
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
                  checked={customer === selectedBroker && selectedIds.includes(ord.id)}
                  disabled={customer !== selectedBroker}
                  title={customer !== selectedBroker ? 'Open this load to select its customer first' : 'Select load'}
                  onChange={(e) => handleToggleSelect(ord.id, e)}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="mt-1 cursor-pointer accent-blue-600"
                />
                <div className="flex-1 min-w-0">
                  {isGlobalSearch && <div className="text-[10px] text-teal-200 mb-1">{customer}</div>}
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
      <div className="tms-workspace flex-1 flex flex-col overflow-y-auto p-6">
        <div className="tms-brand">
          <span>Broski Transportation &amp; Logistics</span>
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
          <span className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowInquiries(open => !open)}
              title="Driver inquiries from your load links"
              className={`text-white text-xs px-2.5 py-1 rounded font-medium cursor-pointer normal-case tracking-normal ${unseenInquiryCount ? 'bg-purple-600 hover:bg-purple-500' : 'bg-slate-700 hover:bg-slate-600'}`}
            >
              📨 Inquiries{unseenInquiryCount ? ` (${unseenInquiryCount} new)` : ''}
            </button>
            {showInquiries && (
              <InquiriesPanel
                inquiries={inquiries}
                onOpen={openInquiryLoad}
                onSeen={markInquirySeen}
                onClose={() => setShowInquiries(false)}
              />
            )}
            <BotStatusLight />
            <button
              type="button"
              onClick={openProfileSettings}
              className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2.5 py-1 rounded font-medium cursor-pointer"
            >
              ⚙ My Settings
            </button>
          </span>
        </div>
        {profileDraft && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" role="dialog" aria-label="My Settings">
            <form onSubmit={handleSaveProfile} className="w-96 bg-[#121829] border border-[#1c2541] rounded-lg p-5 space-y-3">
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
                <p className="text-[11px] text-gray-400 mb-2">Exported as a Per Mile surcharge on each load. Update weekly from your fuel surcharge report. Blank regions use the National Average; blank National exports no surcharge.</p>
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
              <div className="w-96 max-h-[80vh] overflow-y-auto bg-[#121829] border border-[#1c2541] rounded-lg p-5 space-y-3">
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
                <button onClick={() => handleStatusChange('ENT')} className="tms-ent px-3 py-1 text-xs font-bold rounded cursor-pointer">ENT</button>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleExportToLandstar} className="bg-purple-600 hover:bg-purple-500 px-3 py-1 text-xs rounded text-white font-medium cursor-pointer">📥 Export to Landstar Bulk Excel & Move to ENT</button>
              </div>
            </div>

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <h2 className="text-xl font-bold tracking-wide">ORDER #{selectedOrder.id}</h2>
                <button
                  onClick={() => copyToClipboard(selectedOrder.id, 'Order #')}
                  className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2.5 py-1 rounded font-medium flex items-center space-x-1 cursor-pointer"
                >
                  <span>📋 Copy Order #</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2.5 py-1 rounded font-semibold ${selectedOrder.tag === 'ENT' ? 'tms-ent' : selectedOrder.tag === 'HOLD' ? 'bg-red-600 text-white' : selectedOrder.tag === 'OPEN' ? 'tms-open' : selectedOrder.tag === 'BOOKED' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white'}`}>{selectedOrder.tag}</span>
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
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">ORDER #</label>
                  <div className="flex gap-1">
                    <input type="text" value={selectedOrder.id} onChange={(e) => handleFieldChange('id', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white outline-none" />
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
                  <input type="text" value={isTeamEquipment(selectedOrder.eCode) ? 'V' : selectedOrder.eCode} onChange={(e) => handleFieldChange('eCode', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white outline-none" />
                  <div className="text-[11px] text-emerald-400 mt-1 font-mono">{getEquipmentDescription(selectedOrder.eCode)}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
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

                <div className="grid grid-cols-3 gap-2 mb-3">
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
                    placeholder={String(selectedBroker || '').includes('965974') ? 'MM/DD/YY 08:00  MM/DD/YY 16:00' : ''}
                    onChange={(e) => handleFieldChange('deliveryTime', e.target.value)}
                    className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono"
                  />
                  {renderSchedulePicker('deliveryTime')}
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  {renderCopyableField('Destination City', 'destCity')}
                  {renderCopyableField('Destination State', 'destSt')}
                  {renderCopyableField('Destination ZIP', 'destZip')}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Miles</label>
                    <div className="flex space-x-2">
                      <input type="text" value={selectedOrder.miles} onChange={(e) => handleFieldChange('miles', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" />
                      <button onClick={() => copyToClipboard(selectedOrder.miles, 'Miles')} className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-xs cursor-pointer">📋 Copy</button>
                    </div>
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
                    <label className="text-xs text-gray-400 block mb-1">Commodity</label>
                    <input
                      type="text"
                      value={getLoadCommodity(selectedOrder)}
                      readOnly
                      className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white"
                    />
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
                  <button
                    type="button"
                    onClick={handleCopyDriverLink}
                    title="Copy a link drivers can open to see this load and send you an inquiry"
                    className="bg-purple-700 hover:bg-purple-600 text-white text-[11px] px-2.5 py-1 rounded font-semibold cursor-pointer"
                  >
                    🔗 Copy driver link
                  </button>
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
                <div className="grid grid-cols-2 gap-4 mb-3">
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
                <div className="grid grid-cols-2 gap-4">
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
                  <label htmlFor="assignment-driver-phone" className="text-xs text-gray-400 block mb-1">Driver Cell Phone</label>
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

              <div className="flex justify-between items-center pt-4 border-t border-[#1c2541]">
                {selectedOrder.status === 'BOOKED' ? (
                  <div className="w-full flex flex-wrap items-center gap-2">
                    <div className="flex-1 min-w-[12rem] text-center bg-purple-900/50 border border-purple-500 text-purple-100 px-4 py-2 rounded text-sm font-semibold" role="status">
                      ✓ Booked{selectedOrder.driver ? ` · ${selectedOrder.driver}` : ''} · edit any field above (rate, dates, driver) and it saves automatically
                    </div>
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
                    className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-2 rounded text-sm font-semibold w-full transition-colors shadow-lg cursor-pointer"
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
