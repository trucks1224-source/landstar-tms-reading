import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as XLSX from 'xlsx';
import * as screenshotTable from './lib/screenshotTable.js';
import * as ntgCards from './lib/ntgCards.js';
import zipcodes from 'zipcodes';

const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');
const { code } = await transform(`${source}
export {
  preservesImportedLoadStatus, getReimportedLoadStatus,
  keepPreviouslyExportedLoadsOpen, markDifferentScheduleLoadsEnt,
  countPreviouslyExportedLoads, createLaneDayKey, replaceImportedCustomerLoads,
  parseScreenshotLines, correctCitiesFromZip, getLandstarCity, toLandstarCity,
  normalizeCanadianPostalCode, getCountryForRegion, lookupCanadianPostalCode,
  createLaneRateKey, getSavedLaneRate, getFixedLaneRate, getEquipmentDescription, normalizeEquipmentCode, isSkippableEquipment,
  getLandstarEquipmentCode, getLandstarEquipment2, getLandstarCommodity, getLandstarCommodityValue, isTeamEquipment, isTeamLoad, getRatePerMile, hasLoadRate, isHazmatLoad, isTankerLoad, getLoadCommodity, voteNtgLoadNumber,
  toExcelDateTime, splitScheduleRange, parseSchedulePickerParts, formatSchedulePickerParts,
  normalizeBrokerList, normalizeCustomerOrders, getLoadSearchEntries, deduplicateDatImports, parseDatRateText,
  parseDatScreenshotLines, correctDatCities, removeExpiredExportedLoads, markLoadsExported,
  getPastedImage, readClipboardImage, getImportedLoadSelection,
  getFuelSurchargeRegion, getFuelSurchargeRate, normalizeFuelSurchargeRates, parseFuelSurchargeEmail,
  writeSyncedKey, initSyncGuardFromStorage, readDataVersions, getChangedSyncedKeys,
  isUnversionedExternalChange, restoreLastSavedKey, markStorageAdopted, classifyChangedSyncedKeys,
  getStatusTag, bookLoad, buildDriverDirectory, findKnownDriver,
  getBookedLoads, getTrackingAlert, logCheckCall, parseScheduleStart, loadMatchesSearch, isBookedLoadComplete, getPaperworkStatus, getDeliveredAt, buildPaperworkEmail, getPaperworkTarget, getLoadedTimeWarning, toUsPhoneE164, getGoogleVoiceUrl, buildDriverText, rememberLaneRate, fetchDatRateForImport,
  buildInquiryDetails, getInquiryUrl, getLandstarExportComment, getExportPlace, addRateHistoryEntries,
  getEarliestPickupSerial, adjustPickupWindow, removeCapacity, formatDriverInfo, formatOrderCopy, describeBotProgress, isNolanCustomer, isParaCustomer, createManualLoad, estimateRoadMilesFromZips, getGoogleRoadMiles, getRoadMilesLaneKey, buildAssignRequest, applyAssignResult, getRxoAtzDatVanDiscount, isRxoSameCityLoad, getParamountWatchList, buildParamountEmail, getDueParamountEmails, markParamountEmail, applyParamountTrackingInfo, greetingNameFrom, isParamountTrackingCustomer, formatParamountTime, getRxoWatchList, findRxoLoadForRequest, buildRxoUpdateEmail, getDueDriverEmails, buildDriverEmail, markDriverEmail, getTrackingWatchList, findDriverEta, buildParamountEtaEmail, getDueMercuryGateStep, applyMercuryGateResult, paramountMaySendItself,
  buildLandstarPosting, excelSerialToBoardTime, findDroppedPostings, getLoadSheetNames, isRxoSkippedVanLoad, isMexicoLoad, getImportedHazmatTanker, describeLoadListSummary, moveCustomer
};`, { loader: 'jsx', format: 'cjs' });
// Test loads are dated October 2026, so "today" inside the TMS code is 10/1/2026:
// those pickups are still ahead, and past-date rules use September dates.
const TEST_NOW = new Date(2026, 9, 1, 12, 0).getTime();
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [TEST_NOW])); }
  static now() { return TEST_NOW; }
}
const context = {
  Date: TestDate,
  module: { exports: {} },
  require(name) {
    if (name === './lib/screenshotTable.js') return screenshotTable;
    if (name === './lib/ntgCards.js') return ntgCards;
    if (['react', 'xlsx', './lib/supabase'].includes(name)) return {};
    throw new Error(`Unexpected dependency: ${name}`);
  }
};
vm.runInNewContext(code, context);
const policy = context.module.exports;
const customers = [
  'Para 1522166 - ATZ',
  'R X O 2429200 - ATZ P',
  'Nolan 965974 - ATZ H'
];
const load = {
  id: '123456',
  status: 'OPEN',
  tag: 'OPEN',
  origCity: 'Chicago',
  origSt: 'IL',
  destCity: 'Dallas',
  destSt: 'TX',
  pickupTime: '10/27/2026 0800 - 1200',
  deliveryTime: '10/28/2026 0800 - 1600'
};

test('pasted screenshots are accepted outside editable fields without intercepting text', () => {
  const image = { type: 'image/png' };
  const clipboardData = { items: [
    { type: 'text/plain', getAsFile: () => null },
    { type: 'image/png', getAsFile: () => image }
  ] };
  assert.equal(policy.getPastedImage({ clipboardData }), image);
  for (const tag of ['input', 'textarea', 'select']) {
    assert.equal(policy.getPastedImage({
      clipboardData, target: { closest: selector => selector.includes(tag) }
    }), null);
  }
  assert.equal(policy.getPastedImage({ clipboardData, target: { isContentEditable: true } }), null);
  assert.equal(policy.getPastedImage({ clipboardData: { items: [{ type: 'text/plain' }] } }), null);
  assert.equal(policy.getPastedImage({}), null);
});

test('clipboard screenshot reading accepts image data and prefers PNG', async () => {
  const image = { type: 'image/png' };
  const clipboard = { read: async () => [
    { types: ['text/plain'] },
    {
      types: ['image/jpeg', 'image/png'],
      getType: async type => {
        assert.equal(type, 'image/png');
        return image;
      }
    }
  ] };
  assert.equal(await policy.readClipboardImage(clipboard), image);
});

test('clipboard import explains missing images, unsupported access, and permission errors', async () => {
  await assert.rejects(policy.readClipboardImage(undefined), /Ctrl\+V/);
  await assert.rejects(policy.readClipboardImage({ read: async () => [] }), /Win\+Shift\+S/);
  await assert.rejects(policy.readClipboardImage({
    read: async () => { throw new Error('Permission denied'); }
  }), /Permission denied/);
});

test('Paste NTG Screenshot reports clipboard problems and re-enables imports', async () => {
  let finishRead;
  let readCount = 0;
  const app = createAppHarness(customers[2], [load], null, {}, {
    navigator: { clipboard: { read: () => {
      readCount += 1;
      return new Promise(resolve => { finishRead = resolve; });
    } } }
  });
  const pasteButton = () => app.find(node => node.type === 'button'
    && node.props.children.includes('Paste NTG Screenshot'));
  const pendingImport = pasteButton().props.onClick();
  app.render();
  assert.equal(pasteButton().props.disabled, true);
  await pasteButton().props.onClick();
  assert.equal(readCount, 1);
  finishRead([]);
  await pendingImport;
  app.render();
  assert.equal(pasteButton().props.disabled, false);
  assert.match(app.alerts[0], /No screenshot is on the clipboard/);
  assert.equal(app.errors.length, 1);
  assert.equal(JSON.parse(app.storage.get('landstar_customerOrdersMap'))[customers[2]][0].id, load.id);
});

test('search finds load numbers, origin/destination cities and states across every customer', () => {
  const first = { ...load, route: '', planningComment: 'Call dispatcher' };
  const second = { ...load, id: '7654321', route: '', origCity: 'Vernon', origSt: 'CA', destCity: 'Reno', destSt: 'NV' };
  const map = { [customers[0]]: [first], [customers[1]]: [second] };
  for (const query of ['7654321', ' verNON ', 'reno', 'nv']) {
    const matches = policy.getLoadSearchEntries(map, customers[0], query);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].customer, customers[1]);
    assert.equal(matches[0].order, second);
  }
  assert.ok(policy.getLoadSearchEntries(map, customers[0], 'ca').some(entry => entry.order === second));
  assert.equal(policy.getLoadSearchEntries(map, customers[1], 'chicago')[0].order, first);
  assert.equal(policy.getLoadSearchEntries(map, customers[1], 'dispatcher')[0].order, first);
  assert.equal(policy.getLoadSearchEntries(map, customers[0], 'missing').length, 0);
  assert.equal(policy.getLoadSearchEntries(map, customers[0], '  ')[0].order, first);
  assert.equal(policy.getLoadSearchEntries(map, customers[0], '').length, 1);
  assert.equal(Object.hasOwn(second, 'customer'), false);
});

test('search forgives small city misspellings and finds driver, truck and freight bill', () => {
  const booked = { ...load, origCity: 'SHEPHERDSVILLE', origSt: 'KY', destCity: 'LOUISVILLE', driver: 'Fred Smith', truck: '427021', paramountTracking: { freightBill: '4642273' } };
  for (const query of ['Shepardsville', 'shepherdsvile', 'fred', '427021', '4642273', 'Lousville']) {
    assert.equal(policy.loadMatchesSearch(booked, query), true, query);
  }
  for (const query of ['Nashville', 'missing', 'shep ky 9']) {
    assert.equal(policy.loadMatchesSearch(booked, query), false, query);
  }
});

test('a delivered load with paperwork received leaves the Booked Loads list', () => {
  assert.equal(policy.isBookedLoadComplete({ trackingStage: 'Delivered', paperworkReceivedAt: '2026-11-06T20:00:00Z' }), true);
  assert.equal(policy.isBookedLoadComplete({ trackingStage: 'Delivered', paperworkReceivedAt: '' }), false);
  assert.equal(policy.isBookedLoadComplete({ trackingStage: 'In Transit', paperworkReceivedAt: '2026-11-06T20:00:00Z' }), false);
});

test('global search retains identical load numbers under separate customers', () => {
  const map = { [customers[0]]: [load], [customers[1]]: [{ ...load }] };
  const matches = policy.getLoadSearchEntries(map, customers[0], load.id);
  assert.equal(matches.length, 2);
  assert.deepEqual(Array.from(matches, entry => entry.customer), customers.slice(0, 2));
});

test('headerless DAT rows do not mistake per-mile mi for Michigan and retain the top row', () => {
  const rows = [
    ['$3,500', '$4.14/mi', '845', 'Shepherdsville,', 'KY', 'Orlando,', 'FL', '10/28'],
    ['$3,400', '$1.68/mi', '2019', 'Hammond,', 'IN', 'Santa Ana,', 'CA', '10/29'],
    ['$3,000', '$4.35/mi', '689', 'Cincinnati,', 'OH', 'Brentwood,', 'NY', '10/29'],
    ['$2,620', '$4.00/mi', '655', 'Erlanger,', 'KY', 'Savannah,', 'GA', '10/29'],
    ['$1,450', '$2.70/mi', '538', 'Sparks,', 'NV', 'Buena Park,', 'CA', '10/27'],
    ['$979', '$3.56/mi', '275', 'Hager City,', 'WI', 'Clinton,', 'IA', '10/29'],
    ['$921', '$1.41/mi', '655', 'Lindon,', 'UT', 'Los Angeles,', 'CA', '10/28'],
    ['$805', '$1.98/mi', '407', 'Freeport,', 'TX', 'Laredo,', 'TX', '10/29']
  ];
  const lines = rows.map((cells, row) => {
    const text = [...cells, 'VZ', '53ft', '40,000lbs'];
    const words = text.map((value, col) => ({
      text: value, bbox: { x0: col * 70, x1: col * 70 + 60, y0: row * 40 + 2, y1: row * 40 + 12 }
    }));
    return { text: text.join(' '), words, bbox: { x0: 0, x1: 813, y0: row * 40 + 2, y1: row * 40 + 12 } };
  });
  const loads = policy.parseDatScreenshotLines(lines, 813, 519, customers[2], {});
  assert.equal(loads.length, rows.length);
  assert.deepEqual(Array.from(loads, order => order.origCity), [
    'SHEPHERDSVILLE', 'HAMMOND', 'CINCINNATI', 'ERLANGER', 'SPARKS', 'HAGER CITY', 'LINDON', 'FREEPORT'
  ]);
  assert.ok(loads.every(order => policy.createLaneDayKey(order)));
  assert.equal(loads[1].destCity, 'SANTA ANA');
});

test('DAT screenshots with two-line rate and pickup cells import all rows correctly', () => {
  const W = 820;
  const cols = { rate: 40, trip: 120, origin: 200, destination: 400, pickup: 580, eq: 640, length: 700, weight: 760 };
  const word = (text, x, y) => ({ text, bbox: { x0: x, x1: x + text.length * 7, y0: y, y1: y + 12 } });
  const header = ['Rate', 'Trip', 'Origin', 'Destination', 'Pick', 'Up', 'EQ', 'Length', 'Weight']
    .map((text, i) => word(text, [cols.rate, cols.trip, cols.origin, cols.destination, cols.pickup, cols.pickup + 30, cols.eq, cols.length, cols.weight][i], 2));
  const lines = [{ text: header.map(w => w.text).join(' '), words: header, bbox: { x0: 0, x1: W, y0: 2, y1: 14 } }];
  [
    ['$5,200', '$2.76*/mi', '1885', 'Three Forks, MT', 'Lesage, WV', '10/29 -', '10/30', 'V', '53 ft', '43,605 lbs'],
    ['$4,500', '$2.20*/mi', '2043', 'Visalia, CA', 'Murray, KY', '10/30', '', 'FH', '40 ft', '14,000 lbs'],
    ['$3,200', '$2.33*/mi', '1374', 'Rifle, CO', 'Cincinnati, OH', '10/29', '', 'V', '53 ft', '44,000 lbs'],
    ['$3,000', '$3.25*/mi', '922', 'Ft Lauderdale, FL', 'Morgan City, LA', '10/30', '', 'RG', '24 ft', '25,000 lbs']
  ].forEach((r, i) => {
    const y = 40 + i * 40;
    const words = [
      word(r[0], cols.rate, y), word(r[1], cols.rate, y + 14),
      word(r[2], cols.trip, y),
      ...r[3].split(' ').map((t, j) => word(t, cols.origin + j * 45, y)),
      ...r[4].split(' ').map((t, j) => word(t, cols.destination + j * 45, y)),
      word(r[5], cols.pickup, y),
      ...(r[6] ? [word(r[6], cols.pickup, y + 14)] : []),
      word(r[7], cols.eq, y), word(r[8], cols.length, y), word(r[9], cols.weight, y)
    ];
    const ordered = [...words.filter(w => w.bbox.y0 === y), ...words.filter(w => w.bbox.y0 !== y)];
    lines.push({ text: ordered.map(w => w.text).join(' '), words, bbox: { x0: 0, x1: W, y0: y, y1: y + 26 } });
  });
  const loads = policy.parseDatScreenshotLines(lines, W, 200, customers[2], {});
  assert.equal(loads.length, 4);
  assert.equal(loads[0].rateInput, '5200');
  assert.equal(loads[0].pickupTime, '10/29/2026 0800 - 10/30/2026 1600');
  assert.equal(loads[1].rateInput, '4500');
  assert.equal(loads[1].eCode, 'FH');
  assert.equal(policy.isHazmatLoad(loads[1]), false);
  assert.equal(policy.getLoadCommodity(loads[1]), 'CGAPP');
  assert.equal(loads[3].origCity, 'FT LAUDERDALE');
  assert.equal(loads[3].eCode, 'RG');
  assert.equal(loads[3].rateInput, '3000');
});

test('FH imports and exports as FH and is not hazmat unless flagged', () => {
  assert.equal(policy.getLandstarCommodity('FH'), 'CGAPP');
  assert.equal(policy.getLandstarEquipmentCode('FH'), 'FH');
  assert.equal(policy.isHazmatLoad({ eCode: 'FH' }), false);
  assert.equal(policy.getLoadCommodity({ eCode: 'FH' }), 'CGAPP');
  assert.equal(policy.getLoadCommodity({ eCode: 'FH', hazmat: 'true' }), 'HAZMAT');
  assert.equal(policy.getLoadCommodity({ eCode: 'F' }), 'CGAPP');
});

test('DAT city correction fixes Long Island region OCR misreads', () => {
  for (const misread of ['LONGLISLAND', 'LONGISLAND', 'LONG SLAND', 'LONG ISLAND']) {
    const loads = [{ origCity: 'AMELIA', origSt: 'OH', destCity: misread, destSt: 'NY', route: '' }];
    policy.correctDatCities(loads, zipcodes);
    assert.equal(loads[0].destCity, 'LONG ISLAND');
    assert.equal(loads[0].route, 'AMELIA, OH → LONG ISLAND, NY');
  }
  const other = [{ origCity: 'VISALIA', origSt: 'CA', destCity: 'MURRAY', destSt: 'KY', route: '' }];
  policy.correctDatCities(other, zipcodes);
  assert.equal(other[0].destCity, 'MURRAY');
});

test('schedule picker parts round-trip pickup and delivery ranges', () => {
  const parts = policy.parseSchedulePickerParts('10/29/2026 0900 - 10/30/2026 1600');
  assert.deepEqual({ ...parts.from }, { date: '2026-10-29', time: '09:00' });
  assert.deepEqual({ ...parts.to }, { date: '2026-10-30', time: '16:00' });
  assert.equal(policy.formatSchedulePickerParts(parts.from, parts.to), '10/29/2026 0900 - 10/30/2026 1600');
  assert.equal(policy.formatSchedulePickerParts({ date: '2026-11-01' }, null), '11/1/2026 0800');
  const sameDay = policy.parseSchedulePickerParts('10/29/2026 0800 - 1600');
  assert.deepEqual({ ...sameDay.from }, { date: '2026-10-29', time: '08:00' });
  assert.equal(sameDay.to, null);
  const empty = policy.parseSchedulePickerParts('');
  assert.equal(empty.from, null);
  assert.equal(empty.to, null);
});

test('Idaho to Florida lane always pays the fixed $11,000 rate', () => {
  const idFl = { ...load, origCity: 'Boise', origSt: 'ID', destCity: 'Miami', destSt: 'FL' };
  assert.equal(policy.getFixedLaneRate(customers[0], idFl), '11000');
  assert.equal(policy.getSavedLaneRate({}, customers[0], idFl), '11000');
  const savedKey = policy.createLaneRateKey(customers[0], idFl);
  assert.equal(policy.getSavedLaneRate({ [savedKey]: '8500' }, customers[0], idFl), '11000');
  assert.equal(policy.getFixedLaneRate(customers[0], { ...idFl, destSt: 'TX' }), '');
  assert.equal(policy.getFixedLaneRate(customers[0], { ...idFl, origSt: 'UT' }), '');
  assert.equal(policy.getSavedLaneRate({}, customers[0], { ...idFl, destSt: 'TX' }), '');
});

test('fixed Idaho-Florida rate corrects misread existing rates but respects manual rates', () => {
  const idFl = { ...load, origCity: 'Boise', origSt: 'ID', destCity: 'Miami', destSt: 'FL' };
  const imported = [{ ...idFl, rateInput: '11000', rateSource: 'user-entered' }];
  const misread = { ...idFl, rateInput: '1100', rateSource: 'dat-screenshot' };
  const corrected = policy.replaceImportedCustomerLoads(customers[0], imported, [misread]).loads[0];
  assert.equal(corrected.rateInput, '11000');
  assert.equal(corrected.rateSource, 'user-entered');
  const manual = { ...idFl, rateInput: '12000', rateSource: 'user-entered' };
  const kept = policy.replaceImportedCustomerLoads(customers[0], imported, [manual]).loads[0];
  assert.equal(kept.rateInput, '12000');
  const unrated = { ...idFl, rateInput: '', rateSource: undefined };
  const filled = policy.replaceImportedCustomerLoads(customers[0], imported, [unrated]).loads[0];
  assert.equal(filled.rateInput, '11000');
});

test('DAT rate text reads posted totals without combining per-mile values or extra digits', () => {
  for (const [text, expected] of [
    ['$10,500\n', 10500], ['$10,000', 10000], ['$5,700', 5700], ['$3,800', 3800],
    ['$10,500\n$3.92/mi', 10500], ['$3.92/mi', 0], ['10 500 2676', 0],
    ['$10500.00', 10500], ['', 0]
  ]) assert.equal(policy.parseDatRateText(text), expected);
});

test('DAT re-import corrects screenshot rates but preserves manual rates and assignments', () => {
  const existing = [{ ...load, id: 'DAT-123-0', rateInput: '1050', rateSource: 'dat-screenshot', driverPhone: '555-1234' }];
  const imported = [{ ...load, id: 'DAT-456-0', rateInput: '10500', rateSource: 'dat-screenshot' }];
  const result = policy.deduplicateDatImports(imported, existing);
  assert.equal(result.loads.length, 1);
  assert.equal(result.loads[0].id, existing[0].id);
  assert.equal(result.loads[0].rateInput, '10500');
  assert.equal(existing[0].driverPhone, '555-1234');
  for (const prior of [
    { ...existing[0], rateSource: 'user-entered' }, { ...existing[0], rateInput: '10500' }
  ]) {
    const rows = policy.deduplicateDatImports(imported, [prior]).loads;
    const merged = policy.replaceImportedCustomerLoads(customers[2], rows, [prior],
      { additive: true, allowGeneratedIds: true }).loads;
    assert.equal(merged.length, 1);
    assert.equal(merged[0].rateInput, prior.rateInput);
    assert.equal(merged[0].driverPhone, prior.driverPhone);
    assert.equal(merged[0].status, 'OPEN');
  }
});

test('typed rates are saved for the lane and beat DAT; DAT rates are never saved for reuse', async () => {
  const storage = new Map();
  let datCalls = 0;
  const ratePolicy = { module: { exports: {} } };
  vm.runInNewContext(code, {
    ...ratePolicy, Date: TestDate, require: context.require, console,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch: async () => { datCalls += 1; return { ok: true, status: 200, json: async () => ({ rate: 1800 }) }; }
  });
  const { rememberLaneRate, fetchDatRateForImport, getSavedLaneRate } = ratePolicy.module.exports;
  const lane = { id: '1', origCity: 'Chicago', origSt: 'IL', destCity: 'Dallas', destSt: 'TX', eCode: 'V' };
  // A DAT rate is not kept as the lane's rate: the next import asks DAT again.
  assert.equal(JSON.stringify(rememberLaneRate({}, customers[0], lane, '1800', 'dat-api')), '{}');
  assert.equal(JSON.stringify(rememberLaneRate({}, customers[0], lane, '1800', 'dat-screenshot')), '{}');
  assert.equal(JSON.stringify(await fetchDatRateForImport(lane, customers[0], {})), JSON.stringify({ rateInput: '1800', rateSource: 'dat-api' }));
  assert.equal(datCalls, 1);
  // Your typed rate is saved, and the same lane on a new load uses it without asking DAT.
  const saved = rememberLaneRate({}, customers[0], lane, '$2,150', 'manual');
  assert.equal(getSavedLaneRate(saved, customers[0], { ...lane, id: '2', origZip: '60601' }), '2150');
  assert.equal(JSON.stringify(await fetchDatRateForImport({ ...lane, id: '2' }, customers[0], saved)), JSON.stringify({ rateInput: '2150', rateSource: 'user-entered' }));
  assert.equal(datCalls, 1);
  // A load already in the TMS with a DAT rate switches to your typed lane rate on re-import.
  const existing = [{ ...load, rateInput: '1800', rateSource: 'dat-api' }];
  const reimported = policy.replaceImportedCustomerLoads(customers[0], [{ ...load, rateInput: '2150', rateSource: 'user-entered' }], existing).loads[0];
  assert.equal(reimported.rateInput, '2150');
  assert.equal(reimported.rateSource, 'user-entered');
  // ...but a rate you typed on that load itself is kept.
  const typed = [{ ...load, rateInput: '1900', rateSource: 'user-entered' }];
  assert.equal(policy.replaceImportedCustomerLoads(customers[0], [{ ...load, rateInput: '2150', rateSource: 'user-entered' }], typed).loads[0].rateInput, '1900');
});

test('DAT imports accept temporary IDs and deduplicate lane/day without changing existing loads', () => {
  const existing = [{ ...load, driverPhone: '555-1234', status: 'ENT', tag: 'ENT' }];
  const before = JSON.stringify(existing);
  const imported = [
    { ...load, id: 'DAT-123-0', pickupTime: '10/27/2026 1800' },
    { ...load, id: 'DAT-123-1', destCity: 'Hialeah' },
    { ...load, id: 'DAT-123-2', destCity: 'Hialeah', pickupTime: '10/27/2026 1400', eCode: 'RZ' },
    { ...load, id: 'DAT-123-3', pickupTime: '10/28/2026 0800' }
  ];
  const result = policy.deduplicateDatImports(imported, existing);
  assert.deepEqual(Array.from(result.loads, order => order.id), [load.id, 'DAT-123-1', 'DAT-123-3']);
  assert.equal(result.skippedDuplicateCount, 1);
  assert.equal(JSON.stringify(existing), before);
  assert.equal(policy.deduplicateDatImports(imported, [...existing, ...result.loads]).loads.length, 3);
  assert.throws(() => policy.deduplicateDatImports([{ ...load, pickupTime: '', puDate: '' }], existing), /No DAT rows had a readable lane and pickup date/);
  const partial = policy.deduplicateDatImports([
    { ...load, pickupTime: '', puDate: '' },
    { ...load, id: 'DAT-123-4', pickupTime: '10/29/2026 0800' }
  ], existing);
  assert.equal(partial.loads.length, 1);
  assert.equal(partial.unreadableRows.length, 1);
  assert.match(partial.unreadableRows[0], /Row 1/);
  assert.equal(JSON.stringify(existing), before);
});

test('NTG/Nolan is restored from older customer lists and remains after reload', () => {
  for (const saved of [null, [], [customers[0]], [customers[0], customers[1]]]) {
    const restored = policy.normalizeBrokerList(saved);
    assert.equal(restored.filter(name => name === customers[2]).length, 1);
    const reloaded = policy.normalizeBrokerList(JSON.parse(JSON.stringify(restored)));
    assert.equal(reloaded.filter(name => name === customers[2]).length, 1);
  }
});

test('NTG aliases resolve to Nolan without duplicating customers or losing saved loads', () => {
  const restored = policy.normalizeBrokerList(['NTG 965974 - ATZ H', customers[2]]);
  assert.equal(restored.filter(name => name === customers[2]).length, 1);
  const orders = policy.normalizeCustomerOrders({ 'NTG 965974 - ATZ H': [load] });
  assert.equal(orders[customers[2]][0].id, load.id);
});

test('all VE loads use VAN equipment and CHEM commodity without losing the source code', () => {
  for (const code of ['VE', 've', ' VE ']) {
    assert.equal(policy.getEquipmentDescription(code), 'VAN:VAN');
    assert.equal(policy.getLandstarEquipmentCode(code), 'VAN');
    assert.equal(policy.getLandstarCommodity(code), 'CHEM');
    assert.equal(policy.getLandstarCommodityValue(policy.getLandstarCommodity(code)), 'CHEM-CHEMICALS (NON-HAZ/REGULATED)');
  }
  const parsed = parseScreenshotTimes('2279123', [
    '10/28/2026 10...', '10/28/2026 1000', '10/29/2026 0...', '10/29/2026 1400'
  ]);
  assert.equal(parsed.eCode, 'VE');
  assert.equal(policy.getLandstarEquipmentCode(parsed.eCode), 'VAN');
  assert.equal(policy.getLandstarCommodity(parsed.eCode), 'CHEM');
  assert.equal(policy.getLandstarCommodity('VZ'), 'HAZMAT');
  assert.equal(policy.getLandstarCommodity('VAN'), 'CGAPP');
});

test('saved rates match the same city/state lane and equipment despite different ZIP codes', () => {
  const original = { ...load, origZip: '60601', destZip: '75201', eCode: 'VZ' };
  const future = { ...original, id: '7654321', origZip: '60602', destZip: '' };
  const rates = { [policy.createLaneRateKey(customers[0], original)]: '2500' };
  assert.equal(policy.getSavedLaneRate(rates, customers[0], future), '2500');
  for (const changed of [
    { ...future, eCode: 'VE' }, { ...future, origSt: 'IN' },
    { ...future, destCity: 'Houston' },
    { ...future, origCity: 'Dallas', origSt: 'TX', destCity: 'Chicago', destSt: 'IL' }
  ]) {
    assert.equal(policy.getSavedLaneRate(rates, customers[0], changed), '');
  }
  assert.equal(policy.getSavedLaneRate(rates, customers[1], future), '');
});

test('legacy ZIP-specific saved rates remain reusable and latest lane-wide rate takes precedence', () => {
  const original = { ...load, origZip: '60601', destZip: '75201', eCode: 'VZ' };
  const oldKey = JSON.stringify([customers[0], 'CHICAGO', 'IL', '60601', 'DALLAS', 'TX', '75201', 'VZ']);
  const rates = { [oldKey]: '2100' };
  assert.equal(policy.getSavedLaneRate(rates, customers[0], original), '2100');
  assert.equal(policy.getSavedLaneRate(rates, customers[0], { ...original, origZip: '' }), '2100');
  rates[policy.createLaneRateKey(customers[0], original)] = '2600';
  assert.equal(policy.getSavedLaneRate(rates, customers[0], original), '2600');
});

test('2279568 preserves VERNON rather than the preferred postal city for ZIP 90058', () => {
  const imported = {
    ...load, id: '2279568', origCity: 'VERNON', origSt: 'CA', origZip: '90058',
    destCity: 'SALTLAKECITY', destSt: 'UT', destZip: '84104', screenshotStatus: 'ENT'
  };
  assert.equal(zipcodes.lookup('90058').city, 'Los Angeles');
  policy.correctCitiesFromZip([imported], zipcodes);
  assert.equal(imported.origCity, 'VERNON');
  assert.equal(imported.destCity, 'SALT LAKE CITY');
  assert.equal(imported.route, 'VERNON, CA → SALT LAKE CITY, UT');
  const saved = policy.replaceImportedCustomerLoads(customers[0], [imported], [
    { ...imported, origCity: 'LOS ANGELES' }
  ]).loads[0];
  assert.equal(saved.origCity, 'VERNON');
  assert.equal(saved.status, 'OPEN');
  assert.equal(policy.getLandstarCity(saved.origCity, zipcodes.lookup('90058')), 'VERNON');
  assert.equal(policy.getLandstarCity('EAST ST LOUIS', { city: 'East Saint Louis' }), 'East Saint Louis');
  assert.equal(policy.getLandstarCity('MT. VERNON', { city: 'Mount Vernon' }), 'Mount Vernon');
});

test('Landstar city names are capped at 18 characters with known abbreviations', () => {
  assert.equal(policy.toLandstarCity('Washington Court House'), 'Washington CH');
  assert.equal(policy.toLandstarCity('WASHINGTON COURT HOUSE'), 'Washington CH');
  assert.equal(policy.toLandstarCity('Houston'), 'Houston');
  assert.equal(policy.toLandstarCity('A Very Long City Name Here').length, 18);
  assert.equal(policy.toLandstarCity(''), '');
});

test('ZIP city verification still fills missing cities and fixes close OCR errors', () => {
  const imported = {
    ...load, origCity: '', origSt: 'CA', origZip: '90058',
    destCity: 'SALT LAKE CTY', destSt: 'UT', destZip: '84104'
  };
  policy.correctCitiesFromZip([imported], zipcodes);
  assert.equal(imported.origCity, 'LOS ANGELES');
  assert.equal(imported.destCity, 'SALT LAKE CITY');
});

test('gridded customer screenshots detect all 27 rows, excluding the header', () => {
  const width = 1202;
  const height = 497;
  const columns = [6, 34, 103, 214, 334, 437, 557, 674, 712, 758, 850, 888, 942, 999, 1049];
  const horizontal = [14, 34, ...Array.from({ length: 27 }, (_, index) => 51 + index * 16)];
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const setGray = (x, y) => {
    const offset = (y * width + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = 128;
  };
  columns.forEach(x => {
    for (let y = 14; y <= 467; y += 1) setGray(x, y);
  });
  horizontal.forEach(y => {
    for (let x = 6; x < width; x += 1) setGray(x, y);
  });
  const canvas = { width, height, getContext: () => ({ getImageData: () => ({ data }) }) };
  const grid = screenshotTable.detectScreenshotGrid(canvas);
  assert.equal(grid.rows.length, 27);
  assert.equal(grid.rows[0].top, 34);
  assert.equal(grid.rows[26].bottom, 467);
  assert.deepEqual(grid.columns, [...columns, width]);
  data.fill(255);
  assert.equal(screenshotTable.detectScreenshotGrid(canvas), null);
});

test('verified screenshot load numbers and grid boundaries override unreliable OCR columns', () => {
  const columns = [0, 0.03, 0.09, 0.18, 0.28, 0.36, 0.46, 0.56, 0.59, 0.63, 0.7, 0.74, 0.78, 0.83, 0.87, 1];
  const values = ['VZ', 'unreadable', '10/27/2026 0800', '10/27/2026 1600',
    '10/29/2026 0800', '10/29/2026 1600', 'BATAVIA', 'OH', '45103', 'SPARKS',
    'NV', '89434', '2196.0', '41000', 'BATTERIES'];
  const words = values.map((text, index) => ({
    text,
    bbox: { x0: columns[index] * 1200 + 1, x1: columns[index + 1] * 1200 - 1, y0: 40, y1: 50 }
  }));
  const [parsed] = policy.parseScreenshotLines([{
    words, text: values.join(' '), bbox: { y0: 40, y1: 50 },
    verifiedOrderId: '2275526', screenshotColumns: columns
  }], 1200, 497, customers[0]);
  assert.equal(parsed.id, '2275526');
  assert.equal(parsed.origCity, 'BATAVIA');
  assert.equal(parsed.destCity, 'SPARKS');
  assert.equal(parsed.origZip, '45103');
  assert.equal(parsed.destZip, '89434');
});

function parseScreenshotTimes(id, times, customer = customers[0], highlighted, equipmentText = 'VE', verifiedEquipmentCode) {
  const columns = [0, 0.03, 0.09, 0.18, 0.28, 0.36, 0.46, 0.56, 0.59, 0.63, 0.7, 0.74, 0.78, 0.83, 0.87, 1];
  const values = [equipmentText, id, ...times, 'CHATTANOOGA', 'TN', '37406',
    'MILLEDGEVILLE', 'GA', '31061', '220.0', '42120', 'TANKER'];
  const words = values.map((text, index) => ({
    text,
    bbox: { x0: columns[index] * 1200 + 1, x1: columns[index + 1] * 1200 - 1, y0: 40, y1: 50 }
  }));
  return policy.parseScreenshotLines([{
    words, text: values.join(' '), bbox: { y0: 40, y1: 50 },
    verifiedOrderId: id, screenshotColumns: columns, orderNumberHighlighted: highlighted,
    verifiedEquipmentCode
  }], 1200, 497, customer)[0];
}

test('2279123 verified VE overrides whole-row OCR VZ and corrects saved equipment/commodity', () => {
  const parsed = parseScreenshotTimes('2279123', [
    '10/28/2026 10...', '10/28/2026 1000', '10/29/2026 0...', '10/29/2026 1400'
  ], customers[0], false, 'VZ', 'VE');
  const saved = policy.replaceImportedCustomerLoads(customers[0], [parsed], [
    { ...parsed, eCode: 'VZ' }
  ]).loads[0];
  assert.equal(saved.eCode, 'VE');
  assert.equal(policy.getEquipmentDescription(saved.eCode), 'VAN:VAN');
  assert.equal(policy.getLandstarEquipmentCode(saved.eCode), 'VAN');
  assert.equal(policy.getLandstarCommodity(saved.eCode), 'CHEM');
});

test('V53 screenshot equipment imports as van', () => {
  const parsed = parseScreenshotTimes('2280197', [
    '10/28/2026 07...', '10/28/2026 1500', '10/30/2026 0...', '10/30/2026 1300'
  ], customers[0], false, 'V53');
  assert.equal(parsed.eCode, 'V');
  assert.equal(policy.getEquipmentDescription(parsed.eCode), 'VAN:VAN, VAN:53VN');
  assert.equal(policy.getLandstarEquipmentCode(parsed.eCode), 'VAN');
  assert.equal(policy.isTeamEquipment(parsed.eCode), false);
  assert.equal(policy.isTeamLoad(parsed), false);
});

test('VM screenshot equipment imports as team van', () => {
  const parsed = parseScreenshotTimes('2280274', [
    '10/28/2026 08...', '10/28/2026 1500', '10/30/2026 0...', '10/30/2026 1500'
  ], customers[0], false, 'VM');
  assert.equal(parsed.eCode, 'V');
  assert.equal(parsed.team, 'true');
  assert.equal(policy.getLandstarEquipmentCode(parsed.eCode), 'VAN');
  assert.equal(policy.isTeamLoad(parsed), true);
  assert.equal(policy.getLandstarEquipmentCode('VM'), 'VAN');
  assert.equal(policy.getEquipmentDescription('VM'), 'VAN:VAN, VAN:53VN');
  assert.equal(policy.isTeamEquipment(' vm '), true);
  assert.equal(policy.isTeamEquipment('V'), false);
});

test('Canadian postal codes are normalized and provinces export as Canada', () => {
  assert.equal(policy.normalizeCanadianPostalCode('t4v4l7'), 'T4V 4L7');
  assert.equal(policy.normalizeCanadianPostalCode('T4V 4L7'), 'T4V 4L7');
  assert.equal(policy.normalizeCanadianPostalCode('T4V-4L7'), 'T4V 4L7');
  assert.equal(policy.normalizeCanadianPostalCode('12345'), '');
  assert.equal(policy.normalizeCanadianPostalCode('T4I 4L7'), '');
  for (const province of ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']) {
    assert.equal(policy.getCountryForRegion(province), 'CA', province);
  }
  assert.equal(policy.getCountryForRegion('WY'), 'US');
});

test('Canadian postal codes autofill for known cities and stay blank otherwise', () => {
  assert.equal(policy.lookupCanadianPostalCode('ST JN S RICHELIEU', 'QC'), 'J3B 1A1');
  assert.equal(policy.lookupCanadianPostalCode('St Jn S Richelieu', 'qc'), 'J3B 1A1');
  assert.equal(policy.lookupCanadianPostalCode('TORONTO', 'ON'), 'M1A 0A1');
  assert.equal(policy.lookupCanadianPostalCode('VANCOUVER', 'BC'), 'V5K 0A1');
  assert.equal(policy.lookupCanadianPostalCode('NOWHERE', 'QC'), '');
  assert.equal(policy.lookupCanadianPostalCode('', 'QC'), '');
  assert.equal(policy.lookupCanadianPostalCode('TORONTO', ''), '');
});

test('screenshot equipment OCR restores the letter whitelist after reading load digits', async () => {
  const parameters = [];
  const recognized = await screenshotTable.recognizeScreenshotEquipment({
    async setParameters(value) { parameters.push(value); },
    async recognize() { return { data: { text: 'VM' } }; }
  }, {});
  assert.equal(recognized, 'VM');
  assert.deepEqual(parameters, [{
    tessedit_pageseg_mode: '8',
    tessedit_char_whitelist: 'VEZRFSADNMT53'
  }]);
});

test('equipment OCR retries unreadable cells in high contrast without guessing a van', async () => {
  const source = await readFile(new URL('./lib/screenshotTable.js', import.meta.url), 'utf8');
  const { code: equipmentCode } = await transform(source, { format: 'cjs' });
  const original = { width: 2, height: 1 };
  const monochrome = {};
  const writes = [];
  monochrome.getContext = () => ({
    drawImage(canvas) { assert.equal(canvas, original); },
    getImageData() { return { data: new Uint8ClampedArray([80, 90, 100, 255, 240, 240, 240, 255]) }; },
    putImageData(pixels) { writes.push(Array.from(pixels.data)); }
  });
  const context = {
    module: { exports: {} },
    document: { createElement: () => monochrome }
  };
  vm.runInNewContext(equipmentCode, context);
  const recognize = context.module.exports.recognizeScreenshotEquipment;
  let attempts = 0;
  const worker = {
    async setParameters() {},
    async recognize(canvas) {
      attempts += 1;
      assert.equal(canvas, attempts === 1 ? original : monochrome);
      return { data: { text: attempts === 1 ? '' : 'V M\n' } };
    }
  };
  assert.equal(await recognize(worker, original), 'VM');
  assert.equal(attempts, 2);
  assert.deepEqual(writes[0], [0, 0, 0, 255, 255, 255, 255, 255]);
  attempts = 0;
  worker.recognize = async () => {
    attempts += 1;
    return { data: { text: 'UNKNOWN' } };
  };
  assert.equal(await recognize(worker, original), '');
  assert.equal(attempts, 3);
});

test('Para red screenshot numbers import ON HOLD and reopen when no longer red', () => {
  const times = ['10/28/2026 08...', '10/28/2026 1400', '10/29/2026 0...', '10/29/2026 1400'];
  const red = parseScreenshotTimes('2279568', times, customers[0], true);
  assert.equal(red.status, 'ON HOLD');
  assert.equal(red.tag, 'HOLD');
  const first = policy.replaceImportedCustomerLoads(customers[0], [red, red], [
    { ...red, status: 'OPEN', tag: 'OPEN' }, { ...load, id: '9999999' }
  ]);
  assert.equal(first.loads.length, 1);
  assert.equal(first.loads[0].id, '2279568');
  assert.equal(first.loads[0].status, 'ON HOLD');
  assert.equal(first.loads[0].tag, 'HOLD');
  assert.equal(first.removedCount, 1);
  assert.equal(first.usesScreenshotStatus, true);
  assert.equal('screenshotStatus' in first.loads[0], false);
  for (const existing of [[], [{
    ...load, id: red.id, status: 'ENT', tag: 'ENT',
    driverPhone: '555-1234', landstarExportedAt: '2026-10-27T12:00:00.000Z'
  }]]) {
    const held = policy.replaceImportedCustomerLoads(customers[0], [red], existing).loads[0];
    assert.equal(held.status, 'ON HOLD');
    assert.equal(held.tag, 'HOLD');
    assert.equal('landstarExportedAt' in held, false);
    if (existing.length) assert.equal(held.driverPhone, '555-1234');
  }
  const plain = parseScreenshotTimes('2279568', times, customers[0], false);
  const second = policy.replaceImportedCustomerLoads(customers[0], [plain], [
    { ...first.loads[0], landstarExportedAt: '2026-10-27T12:00:00.000Z' }
  ]);
  assert.equal(second.loads[0].status, 'OPEN');
  assert.equal(second.loads[0].tag, 'OPEN');
  assert.equal('landstarExportedAt' in second.loads[0], false);
});

test('red screenshot holds are Para-only and do not persist into a later spreadsheet import', () => {
  const times = ['10/28/2026 0800', '10/28/2026 1400', '10/29/2026 0800', '10/29/2026 1400'];
  for (const customer of customers.slice(1)) {
    const parsed = parseScreenshotTimes('2279568', times, customer, true);
    assert.equal(parsed.status, 'OPEN');
    assert.equal('screenshotStatus' in parsed, false);
  }
  const red = parseScreenshotTimes('2279568', times, customers[0], true);
  const first = policy.replaceImportedCustomerLoads(customers[0], [red], []).loads;
  const second = policy.replaceImportedCustomerLoads(customers[0], [{ ...load, id: '2279568' }], first);
  assert.equal(second.loads[0].status, 'OPEN');
});

test('Para 2275526 imports clipped 08 pickup as 0800 with full dates on both ends', () => {
  const parsed = parseScreenshotTimes('2275526', [
    '10/27/2026 08...', '10/27/2026 1600',
    '10/29/2026 0...', '10/29/2026 1600'
  ]);
  assert.equal(parsed.pickupTime, '10/27/2026 0800 - 10/27/2026 1600');
  assert.equal(parsed.deliveryTime, '10/29/2026 0800 - 10/29/2026 1600');
  assert.equal(parsed.puDate, 'PU: 10/27 0800');
});

test('Para 2279123 imports clipped 10 as 1000 and lone zero as 0800', () => {
  const parsed = parseScreenshotTimes('2279123', [
    '10/28/2026 10...', '10/28/2026 1000',
    '10/29/2026 0...', '10/29/2026 1400'
  ]);
  assert.equal(parsed.pickupTime, '10/28/2026 1000 - 10/28/2026 1000');
  assert.equal(parsed.deliveryTime, '10/29/2026 0800 - 10/29/2026 1400');
  const replacement = policy.replaceImportedCustomerLoads(customers[0], [parsed], [
    { ...parsed, pickupTime: '10/28/2026 0010 - 10/28/2026 1000', status: 'ENT', tag: 'ENT' }
  ]);
  assert.equal(replacement.loads[0].pickupTime, parsed.pickupTime);
  assert.equal(replacement.loads[0].deliveryTime, parsed.deliveryTime);
  assert.equal(replacement.loads[0].status, 'OPEN');
});

test('Para supports ellipses and hour-only values without changing fully visible times', () => {
  for (const [input, expected] of [
    ['08…', '0800'], ['10', '1000'], ['14...', '1400'], ['0', '0800'],
    ['0000', '0000'], ['0010', '0010'], ['0008', '0008'],
    ['1034', '1034'], ['08:30', '0830'], ['8 AM', '0800'], ['2 PM', '1400']
  ]) {
    const parsed = parseScreenshotTimes('2279123', [
      `10/28/2026 ${input}`, '10/28/2026 1600',
      '10/29/2026 0800', '10/29/2026 1400'
    ]);
    assert.equal(parsed.pickupTime, `10/28/2026 ${expected} - 10/28/2026 1600`, input);
  }
});

test('Para short-hour rule does not change other customer screenshot times', () => {
  const parsed = parseScreenshotTimes('2279123', [
    '10/28/2026 10...', '10/28/2026 1000',
    '10/29/2026 0...', '10/29/2026 1400'
  ], customers[2]);
  assert.equal(parsed.pickupTime, '10/28/2026 0010 - 10/28/2026 1000');
  assert.equal(parsed.deliveryTime, '10/29/2026 0000 - 10/29/2026 1400');
});

for (const customer of customers) {
  test(`${customer}: full imports remove missing unarchived loads but retain different pickup days`, () => {
    const existing = [
      { ...load, status: 'ENT', tag: 'ENT', rateInput: '2100', notes: 'Keep my note' },
      { ...load, id: `${load.id}-ALTA`, sourceLoadId: load.id },
      { ...load, id: '222222' },
      { ...load, id: '333333', status: 'ENT', tag: 'ENT' }
    ];
    const imported = [
      { ...load, id: '#123456', pickupTime: '10/28/2026 0800 - 1200', rateInput: '', notes: '' },
      { ...load, id: load.id, pickupTime: '10/29/2026 0800 - 1200' },
      { ...load, id: '444444', destCity: 'Austin', pickupTime: '09/27/2026 0800 - 1200', status: 'ENT', tag: 'ENT' },
      { ...load, id: '444444', destCity: 'Austin', pickupTime: '09/27/2026 0800 - 1200' }
    ];
    const snapshot = JSON.stringify(existing);
    const result = policy.replaceImportedCustomerLoads(customer, imported, existing);
    assert.equal(result.loads.length, 3);
    assert.deepEqual(Array.from(result.loads, order => order.id), ['123456', '123456-ALTA', '444444']);
    // Upcoming pickups (10/2026) reopen; the past-dated pickup (09/27) imports as ENT.
    assert.equal(result.loads[0].status, 'OPEN');
    assert.equal(result.loads[1].status, 'OPEN');
    assert.equal(result.loads[2].status, 'ENT');
    assert.equal(result.loads[0].pickupTime, imported[0].pickupTime);
    assert.equal(result.loads[0].rateInput, '2100');
    assert.equal(result.loads[0].notes, 'Keep my note');
    assert.equal(result.duplicateCount, 1);
    assert.equal(result.removedCount, 4);
    assert.equal(JSON.stringify(existing), snapshot);
  });

  test(`${customer}: re-importing 19 ENT loads reopens all 19, even without export history`, () => {
    assert.equal(policy.preservesImportedLoadStatus(customer), true);
    const existing = Array.from({ length: 19 }, (_, index) => ({
      ...load, id: String(100000 + index), status: 'ENT', tag: 'ENT'
    }));
    const reopened = existing.map(order => ({
      ...order, ...policy.getReimportedLoadStatus(order, false)
    }));
    assert.equal(reopened.filter(order => order.status === 'OPEN' && order.tag === 'OPEN').length, 19);
    assert.equal(existing.every(order => order.status === 'ENT'), true);
  });

  test(`${customer}: exported imports stay OPEN and schedule changes do not mark ENT`, () => {
    const records = { ids: [load.id], laneDays: [policy.createLaneDayKey(load)] };
    const { exportedLoadIds } = policy.countPreviouslyExportedLoads([load], records);
    const scheduled = policy.markDifferentScheduleLoadsEnt(
      [load], [{ ...load, pickupTime: '10/27/2026 1400 - 1600' }], customer
    );
    const [reimported] = policy.keepPreviouslyExportedLoadsOpen(
      scheduled, exportedLoadIds, customer
    );
    assert.equal(reimported.status, 'OPEN');
    assert.equal(reimported.tag, 'OPEN');
    const [archivedImport] = policy.keepPreviouslyExportedLoadsOpen(
      [{ ...load, status: 'ENT', tag: 'ENT' }], exportedLoadIds, customer
    );
    assert.equal(archivedImport.status, 'OPEN');
    assert.equal(archivedImport.tag, 'OPEN');
  });
}

test('re-imported loads become OPEN even when previously ON HOLD', () => {
  for (const status of ['OPEN', 'ON HOLD']) {
    const result = policy.getReimportedLoadStatus({ status, tag: status }, false);
    assert.equal(result.status, 'OPEN');
    assert.equal(result.tag, 'OPEN');
  }
});

test('previously exported loads reopen regardless of their existing status', () => {
  const result = policy.getReimportedLoadStatus({ status: 'ON HOLD', tag: 'HOLD' }, true);
  assert.equal(result.status, 'OPEN');
  assert.equal(result.tag, 'OPEN');
});

test('other customers also import OPEN instead of automatically marking schedule changes ENT', () => {
  const customer = 'Other customer';
  assert.equal(policy.preservesImportedLoadStatus(customer), false);
  const [result] = policy.markDifferentScheduleLoadsEnt(
    [load], [{ ...load, pickupTime: '10/27/2026 1400 - 1600' }], customer
  );
  assert.equal(result.status, 'OPEN');
  assert.equal(result.tag, 'OPEN');
  assert.throws(() => policy.replaceImportedCustomerLoads(customer, [], [load]), /empty/);
});

test('empty, missing-number and generated-number imports cannot delete existing loads', () => {
  for (const imported of [[], [{ ...load, id: '' }], [{ ...load, id: 'IMG-123456789-0' }]]) {
    assert.throws(() => policy.replaceImportedCustomerLoads(customers[0], imported, [load]), /Existing loads were not deleted/);
  }
});

test('different load numbers on the same lane and day collapse for Nolan too', () => {
  const result = policy.replaceImportedCustomerLoads(customers[2], [
    load, { ...load, id: '999999' }
  ], []);
  assert.equal(result.loads.length, 1);
});

for (const customer of [...customers, 'Other customer']) {
test(`${customer} keeps one load per lane and pickup day regardless of numbers, ZIPs, or times`, () => {
  const imported = [
    { ...load, id: '100001', rateInput: '2500' },
    { ...load, id: '100002', pickupTime: '10/27/2026 1400 - 1600', deliveryTime: '10/29/2026 1000', origZip: '60602' },
    { ...load, id: '100003', pickupTime: '2026-10-27 18:00' },
    { ...load, id: '100004', pickupTime: '10/28/2026 0800 - 1200' },
    { ...load, id: '100005', destCity: 'Austin' },
    { ...load, id: '100006', destSt: 'AR' },
    { ...load, id: '100007', origCity: 'Dallas', origSt: 'TX', destCity: 'Chicago', destSt: 'IL' }
  ];
  const before = JSON.stringify(imported);
  const result = policy.replaceImportedCustomerLoads(customer, imported, []);
  assert.deepEqual(Array.from(result.loads, order => order.id), ['100001', '100004', '100005', '100006', '100007']);
  assert.equal(result.laneDayDuplicateCount, 2);
  assert.equal(result.loads[0].rateInput, '2500');
  assert.equal(JSON.stringify(imported), before);
  assert.equal(policy.replaceImportedCustomerLoads(customers[2], imported, []).loads.length, 5);
});

test(`${customer} does not collapse loads with unreadable pickup dates`, () => {
  const result = policy.replaceImportedCustomerLoads(customer, [
    { ...load, id: '100001', pickupTime: '', puDate: '' },
    { ...load, id: '100002', pickupTime: '', puDate: '' }
  ], []);
  assert.equal(result.loads.length, 2);
});
}

test('Para keeps one Richmond to Arion load per pickup day and applies red screenshot holds', () => {
  const imported = ['2279675', '2279674', '2279673'].map(id => ({
    ...load, id, origCity: 'RICHMOND', origSt: 'UT', destCity: 'ARION', destSt: 'IA',
    pickupTime: '10/28/2026 0800', screenshotStatus: 'OPEN'
  }));
  const result = policy.replaceImportedCustomerLoads(customers[0], imported, []);
  assert.deepEqual(Array.from(result.loads, order => order.id), ['2279675']);
  assert.equal(result.laneDayDuplicateCount, 2);
  // Upcoming pickup imports as OPEN.
  assert.equal(result.loads[0].status, 'OPEN');
  const red = policy.replaceImportedCustomerLoads(customers[0], imported.map(order => ({
    ...order, screenshotStatus: 'ON HOLD'
  })), result.loads);
  assert.equal(red.loads.length, 1);
  assert.equal(red.loads[0].status, 'ON HOLD');
  assert.equal(red.loads[0].tag, 'HOLD');
});

test('imported loads whose pickup date already passed stay on ENT, new or re-imported', () => {
  for (const customer of customers) {
    const existing = [
      { ...load, id: '500001', pickupTime: '09/28/2026 0800 - 1200', status: 'OPEN', tag: 'OPEN' },
      { ...load, id: '500002', destCity: 'Austin', pickupTime: '09/28/2026 0800 - 1200', status: 'ENT', tag: 'ENT' },
      { ...load, id: '500003', destCity: 'Reno', pickupTime: '09/28/2026 0800 - 1200', status: 'BOOKED', tag: 'BOOKED', driver: 'Alex' }
    ];
    const imported = [
      ...existing.map(order => ({ ...order, status: undefined, tag: undefined })),
      { ...load, id: '500004', destCity: 'Tulsa', pickupTime: '09/29/2026 0800' },
      { ...load, id: '500005', destCity: 'Omaha', pickupTime: '09/30/2026 0800 - 10/02/2026 1600' },
      { ...load, id: '500006', destCity: 'Boise', pickupTime: '10/01/2026 0800' }
    ];
    const result = policy.replaceImportedCustomerLoads(customer, imported, existing);
    const status = id => result.loads.find(order => order.id === id)?.status;
    assert.equal(status('500001'), 'ENT', customer);
    assert.equal(status('500002'), 'ENT', customer);
    assert.equal(status('500003'), 'BOOKED', customer);
    assert.equal(status('500004'), 'ENT', customer);
    // A pickup window that runs through today or later is still open.
    assert.equal(status('500005'), 'OPEN', customer);
    assert.equal(status('500006'), 'OPEN', customer);
  }
});

test('repeating a full-list import is idempotent and reopens existing ON HOLD numbers', () => {
  const first = policy.replaceImportedCustomerLoads(customers[0], [load], [
    { ...load, status: 'ON HOLD', tag: 'HOLD' }
  ]);
  const second = policy.replaceImportedCustomerLoads(customers[0], [load, load], first.loads);
  assert.equal(first.loads[0].status, 'OPEN');
  assert.equal(second.loads.length, 1);
  assert.equal(second.loads[0].status, 'OPEN');
});

function createAppHarness(customer, existing, supabase = null, savedRates = {}, extraContext = {}) {
  const storage = new Map([
    ['landstar_brokers', JSON.stringify([customer])],
    ['landstar_laneRates', JSON.stringify(savedRates)],
    ['landstar_customerOrdersMap', JSON.stringify({
      [customer]: existing,
      'Unrelated customer': [{ ...load, id: '777777', status: 'ENT', tag: 'ENT' }]
    })]
  ]);
  const states = [];
  const effects = [];
  const alerts = [];
  const errors = [];
  let stateCursor = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = stateCursor++;
      if (index === states.length) states.push(typeof initial === 'function' ? initial() : initial);
      return [states[index], value => {
        states[index] = typeof value === 'function' ? value(states[index]) : value;
      }];
    },
    useEffect(effect) { effects.push(effect); }
  };
  const appContext = {
    Date: TestDate,
    module: { exports: {} },
    console: { ...console, error: (...args) => errors.push(args) },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    },
    alert: message => alerts.push(message),
    fetch: async url => {
      if (url === '/api/road-miles') return { ok: true, json: async () => ({ miles: 500 }) };
      assert.equal(url, '/api/dat-rate');
      return { json: async () => ({ rate: 2000 }) };
    },
    require(name) {
      if (name === './lib/screenshotTable.js') return screenshotTable;
      if (name === './lib/ntgCards.js') return ntgCards;
      if (name === 'react') return react;
      if (name === 'xlsx') return XLSX;
      if (name === './lib/supabase') return { supabase };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    ...extraContext
  };
  vm.runInNewContext(code, appContext);
  let tree = appContext.module.exports.default();
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of (node.props?.children || []).flat(Infinity)) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  }
  function findExcelInput(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'input' && node.props.accept === '.xlsx, .xls, .csv') return node;
    for (const child of (node.props?.children || []).flat(Infinity)) {
      const found = findExcelInput(child);
      if (found) return found;
    }
    return null;
  }
  function findRateInput(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'input' && node.props.placeholder === 'Enter DAT quote') return node;
    for (const child of (node.props?.children || []).flat(Infinity)) {
      const found = findRateInput(child);
      if (found) return found;
    }
    return null;
  }
  return {
    effects, states, alerts, errors, storage,
    find: predicate => find(tree, predicate),
    render() {
      stateCursor = 0;
      effects.length = 0;
      tree = appContext.module.exports.default();
    },
    enterRate(value) {
      const input = findRateInput(tree);
      assert.ok(input);
      input.props.onChange({ target: { value } });
    },
    async importExcel(rows) {
      await this.importExcelFiles([rows]);
    },
    // Several files picked together in the file dialog (one list per file).
    async importExcelFiles(fileRows) {
      const files = fileRows.map((rows, index) => {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Loads');
        const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
        return { name: `loads-${index + 1}.xlsx`, arrayBuffer: async () => buffer };
      });
      const input = findExcelInput(tree);
      assert.ok(input, 'Excel import control exists');
      await input.props.onChange({ target: { files } });
    }
  };
}

// Runs the module in a fresh context sharing one storage map, simulating two tabs.
function createSyncContext(storage) {
  const ctx = {
    module: { exports: {} },
    console,
    localStorage: {
      getItem: key => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value))
    },
    require(name) {
      if (name === './lib/screenshotTable.js') return screenshotTable;
      if (name === './lib/ntgCards.js') return ntgCards;
      if (['react', 'xlsx', './lib/supabase'].includes(name)) return {};
      throw new Error(`Unexpected dependency: ${name}`);
    }
  };
  vm.runInNewContext(code, ctx);
  return ctx.module.exports;
}

test('a stale tab cannot overwrite newer data saved from another tab', () => {
  const storage = new Map();
  const tabA = createSyncContext(storage);
  const tabB = createSyncContext(storage);
  assert.equal(tabA.writeSyncedKey('landstar_customerOrdersMap', '{"rxo":[1]}'), true);
  tabB.initSyncGuardFromStorage();
  // Tab A imports and saves a newer list.
  assert.equal(tabA.writeSyncedKey('landstar_customerOrdersMap', '{"rxo":[1,2]}'), true);
  // Tab B's state is now stale; its save must be refused so the import survives.
  assert.equal(tabB.writeSyncedKey('landstar_customerOrdersMap', '{"rxo":[9]}'), false);
  assert.equal(storage.get('landstar_customerOrdersMap'), '{"rxo":[1,2]}');
  // After tab B adopts the newer data, it may write again.
  tabB.markStorageAdopted({ landstar_customerOrdersMap: storage.get('landstar_customerOrdersMap') });
  assert.equal(tabB.writeSyncedKey('landstar_customerOrdersMap', '{"rxo":[1,2,3]}'), true);
  assert.equal(storage.get('landstar_customerOrdersMap'), '{"rxo":[1,2,3]}');
});

test('unversioned load-list changes are detected and reverted to the last known good', () => {
  const storage = new Map();
  const tabA = createSyncContext(storage);
  tabA.writeSyncedKey('landstar_customerOrdersMap', '{"rxo":[1,2]}');
  // An outdated app version writes without bumping the version.
  storage.set('landstar_customerOrdersMap', '{"rxo":[]}');
  assert.equal(tabA.isUnversionedExternalChange('landstar_customerOrdersMap'), true);
  assert.equal(tabA.restoreLastSavedKey('landstar_customerOrdersMap'), true);
  assert.equal(storage.get('landstar_customerOrdersMap'), '{"rxo":[1,2]}');
  // A versioned change from another up-to-date tab is adopted, not reverted.
  const tabB = createSyncContext(storage);
  tabB.initSyncGuardFromStorage();
  assert.equal(tabB.writeSyncedKey('landstar_customerOrdersMap', '{"rxo":[5]}'), true);
  assert.equal(tabA.isUnversionedExternalChange('landstar_customerOrdersMap'), false);
  assert.deepEqual([...tabA.getChangedSyncedKeys({
    landstar_customerOrdersMap: storage.get('landstar_customerOrdersMap')
  })], ['landstar_customerOrdersMap']);
});

test('load-list changes from the cloud are adopted, never reverted, even without a version bump', () => {
  const storage = new Map();
  const deviceB = createSyncContext(storage);
  deviceB.writeSyncedKey('landstar_customerOrdersMap', '{"rxo":[1]}');
  // Another signed-in device imports; its list reaches this browser before (or without)
  // the matching version row.
  storage.set('landstar_customerOrdersMap', '{"rxo":[1,2,3]}');
  const versions = deviceB.readDataVersions();
  const changed = [...deviceB.getChangedSyncedKeys({ landstar_customerOrdersMap: storage.get('landstar_customerOrdersMap') })];
  const fromCloud = deviceB.classifyChangedSyncedKeys(changed, versions, true);
  assert.deepEqual([...fromCloud.adopt], ['landstar_customerOrdersMap']);
  assert.equal(fromCloud.heal, false);
  // The same unversioned change from a stale tab in this browser is still reverted.
  const fromTab = deviceB.classifyChangedSyncedKeys(changed, versions, false);
  assert.deepEqual([...fromTab.adopt], []);
  assert.equal(fromTab.heal, true);
});


test('version bumps for unrelated keys do not mark the load list as externally changed', () => {
  const storage = new Map();
  const tabA = createSyncContext(storage);
  tabA.writeSyncedKey('landstar_customerOrdersMap', '{"rxo":[1]}');
  tabA.writeSyncedKey('landstar_laneRates', '{"lane":2200}');
  // Only the rates key reports a change after the orders value is re-read.
  assert.deepEqual([...tabA.getChangedSyncedKeys({
    landstar_customerOrdersMap: storage.get('landstar_customerOrdersMap'),
    landstar_laneRates: storage.get('landstar_laneRates')
  })], []);
  assert.equal(tabA.isUnversionedExternalChange('landstar_customerOrdersMap'), false);
});

test('VM and VT vans display Team true while ordinary vans display false', () => {
  for (const [extra, expected] of [[{ eCode: 'VM' }, 'true'], [{ eCode: 'VT' }, 'true'], [{ eCode: 'V', team: 'true' }, 'true'], [{ eCode: 'V' }, 'false'], [{ eCode: 'VZ' }, 'false']]) {
    const app = createAppHarness(customers[0], [{ ...load, ...extra }]);
    const team = app.find(node => node.props?.id === 'load-team');
    assert.ok(team);
    assert.equal(team.props.value, expected, JSON.stringify(extra));
  }
});

test('load cards show their rates and zero for loads without a rate', () => {
  const cases = [
    [undefined, '0'], [null, '0'], ['', '0'], [0, '0'], ['0', '0'],
    ['1500', '1,500'], ['$2,200.50', '2,200.5']
  ];
  const app = createAppHarness(customers[0], cases.map(([rateInput], index) => ({
    ...load, id: String(index), rateInput
  })));
  cases.forEach(([, expected], index) => {
    const rate = app.find(node => node.props?.['aria-label'] === `Rate for load ${index}`);
    assert.ok(rate);
    assert.equal(rate.props.children.join('').trim(), `Rate: $${expected}`);
  });
  app.enterRate('1800');
  app.render();
  const updated = app.find(node => node.props?.['aria-label'] === 'Rate for load 0');
  assert.equal(updated.props.children.join('').trim(), 'Rate: $1,800');
});

test('Copy Selected button counts checked loads', () => {
  const app = createAppHarness(customers[0], [{ ...load, id: '1' }, { ...load, id: '2' }]);
  const copyButton = () => app.find(node => node.type === 'button'
    && String([node.props.children].flat(Infinity).join('')).startsWith('📋 Copy Selected'));
  assert.equal(copyButton().props.disabled, true);
  app.find(node => node.type === 'input' && node.props.type === 'checkbox' && node.props.title === undefined
    && typeof node.props.onChange === 'function' && !node.props.disabled).props.onChange();
  app.render();
  assert.equal(copyButton().props.disabled, false);
  assert.match([copyButton().props.children].flat(Infinity).join(''), /\(2\)/);
});

test('Select All then Move to ENT moves every selected load to ENT', () => {
  const app = createAppHarness(customers[0], [
    { ...load, id: '1', status: 'OPEN', tag: 'OPEN' },
    { ...load, id: '2', status: 'OPEN', tag: 'OPEN' },
    { ...load, id: '3', status: 'ON HOLD', tag: 'HOLD' }
  ]);
  app.find(node => node.type === 'input' && node.props.type === 'checkbox' && node.props.title === undefined
    && typeof node.props.onChange === 'function' && !node.props.disabled).props.onChange();
  app.render();
  const moveButton = app.find(node => node.type === 'button' && node.props.title?.startsWith('Move ') && node.props.title?.endsWith(' to ENT'));
  assert.ok(moveButton, 'Move to ENT button exists');
  moveButton.props.onClick();
  app.render();
  app.effects[1]();
  const saved = JSON.parse(app.storage.get('landstar_customerOrdersMap'))[customers[0]];
  for (const order of saved) {
    assert.equal(order.status, 'ENT', order.id);
    assert.equal(order.tag, 'ENT', order.id);
  }
  assert.equal(app.errors.length, 0);
});

test('double-clicking a load card selects and unselects it', () => {
  const app = createAppHarness(customers[0], [{ ...load, id: '1' }, { ...load, id: '2' }]);
  const card = () => app.find(node => node.props?.id === 'load-card-2');
  const checkbox = () => app.find(node => node.type === 'input' && node.props.type === 'checkbox'
    && node.props.title === 'Select load' && node.props.checked !== undefined
    && card().props.children.flat(Infinity).includes(node));
  const event = { stopPropagation() {} };
  card().props.onDoubleClick(event);
  app.render();
  assert.equal(checkbox().props.checked, true);
  card().props.onDoubleClick(event);
  app.render();
  assert.equal(checkbox().props.checked, false);
});

test('typing a detail on a load stays on that load', () => {
  const app = createAppHarness(customers[0], [{ ...load, id: '1' }, { ...load, id: '2' }]);
  const driver = () => app.find(node => node.props?.id === 'assignment-driver');
  driver().props.onChange({ target: { value: 'Alex' } });
  app.render();
  assert.equal(driver().props.value, 'Alex');
  assert.equal(app.find(node => node.props?.id === 'load-card-1').props.className.includes('ring-yellow-300'), true);
  assert.equal(app.find(node => node.props?.id === 'load-card-2').props.className.includes('ring-yellow-300'), false);
});

test('Para screenshot import keeps loads moved to ENT by hand', () => {
  const existing = [
    { ...load, id: '2270001', status: 'ENT', tag: 'ENT' },
    { ...load, id: '2270002', status: 'OPEN', tag: 'OPEN' }
  ];
  const imported = [{ ...load, id: '2280389', origCity: 'ATLANTA', origSt: 'GA', destCity: 'WADDELL', destSt: 'AZ' }];
  const result = policy.replaceImportedCustomerLoads('Para 1522166 - ATZ', imported, existing, { keepManualEnt: true });
  const ids = result.loads.map(order => String(order.id));
  assert.ok(ids.includes('2270001'), 'ENT load kept');
  assert.ok(ids.includes('2280389'), 'new load added');
  assert.ok(!ids.includes('2270002'), 'OPEN load missing from screenshot is replaced');
});

test('With rate and No rate buttons show only those loads', () => {
  const app = createAppHarness(customers[0], [
    { ...load, id: '1', rateInput: '1500', rateSource: 'user-entered' },
    { ...load, id: '2', rateInput: '' },
    { ...load, id: '3', rateInput: '0' }
  ]);
  const shownIds = () => ['1', '2', '3'].filter(id => app.find(node => node.props?.['aria-label'] === `Rate for load ${id}`));
  const clickButton = prefix => app.find(node => node.type === 'button'
    && String([node.props.children].flat(Infinity).join('')).startsWith(prefix)).props.onClick();
  assert.deepEqual(shownIds(), ['1', '2', '3']);
  clickButton('With rate (1)');
  app.render();
  assert.deepEqual(shownIds(), ['1']);
  clickButton('No rate (2)');
  app.render();
  assert.deepEqual(shownIds(), ['2', '3']);
  clickButton('All (3)');
  app.render();
  assert.deepEqual(shownIds(), ['1', '2', '3']);
});

test('min and max miles filter the load list', () => {
  const app = createAppHarness(customers[0], [
    { ...load, id: '1', miles: '150' },
    { ...load, id: '2', miles: '450' },
    { ...load, id: '3', miles: '900' }
  ]);
  const shownIds = () => ['1', '2', '3'].filter(id => app.find(node => node.props?.id === `load-card-${id}`));
  const setMiles = (label, value) => app.find(node => node.props?.['aria-label'] === label)
    .props.onChange({ target: { value } });
  assert.deepEqual(shownIds(), ['1', '2', '3']);
  setMiles('Minimum miles', '200');
  app.render();
  assert.deepEqual(shownIds(), ['2', '3']);
  setMiles('Maximum miles', '500');
  app.render();
  assert.deepEqual(shownIds(), ['2']);
  setMiles('Minimum miles', '');
  app.render();
  assert.deepEqual(shownIds(), ['1', '2']);
  setMiles('Maximum miles', '');
  app.render();
  assert.deepEqual(shownIds(), ['1', '2', '3']);
});

test('loads with and without rates are told apart for bulk selection', () => {
  assert.equal(policy.hasLoadRate({ rateInput: '$1,500' }), true);
  for (const rateInput of [undefined, '', '0', 0, '$0']) {
    assert.equal(policy.hasLoadRate({ rateInput }), false, String(rateInput));
  }
});

test('hazmat equipment codes are flagged as hazmat loads', () => {
  assert.equal(policy.isHazmatLoad({ eCode: 'VZ' }), true);
  assert.equal(policy.isHazmatLoad({ eCode: 'RZ' }), true);
  assert.equal(policy.isHazmatLoad({ eCode: 'V' }), false);
  assert.equal(policy.isHazmatLoad({}), false);
});

test('hazmat and tanker tags carry through to commodity and flags', () => {
  assert.equal(policy.isHazmatLoad({ eCode: 'F,SD', hazmat: 'true' }), true);
  assert.equal(policy.getLoadCommodity({ eCode: 'F,SD', hazmat: 'true' }), 'HAZMAT');
  assert.equal(policy.isTankerLoad({ tanker: 'true' }), true);
  assert.equal(policy.isTankerLoad({ planningComment: 'Tanker (N) Endorsement' }), true);
  assert.equal(policy.isTankerLoad({}), false);
});

test('flatbed loads map to F and export as FLAT', () => {
  assert.equal(policy.getLandstarEquipmentCode('F'), 'FLAT');
  assert.equal(policy.getLandstarEquipmentCode('F,SD'), 'FLAT');
  assert.equal(policy.getLandstarEquipmentCode('FH'), 'FH');
  assert.equal(policy.getLandstarEquipmentCode('D-LG'), 'D-LG');
  assert.equal(policy.getLandstarEquipmentCode('FLCS'), 'FLCS');
  assert.equal(policy.getEquipmentDescription('FLCS'), 'FLCS');
  assert.equal(policy.isHazmatLoad({ eCode: 'FH' }), false);
  assert.equal(policy.getLoadCommodity({ eCode: 'FH' }), 'CGAPP');
  assert.match(policy.getEquipmentDescription('F'), /53FL/);
});

test('Excel equipment text normalizes to TMS equipment codes', () => {
  assert.equal(policy.normalizeEquipmentCode('Reefer - 53'), 'R');
  assert.equal(policy.normalizeEquipmentCode('Reefer'), 'R');
  assert.equal(policy.normalizeEquipmentCode('Van - 53'), 'V');
  assert.equal(policy.normalizeEquipmentCode('Flatbed'), 'F');
  assert.equal(policy.normalizeEquipmentCode('Flatbed - 48'), 'F');
  assert.equal(policy.normalizeEquipmentCode('Flatbed - 53'), 'F');
  assert.equal(policy.normalizeEquipmentCode('Flatbed w/Tarps'), 'F');
  assert.equal(policy.normalizeEquipmentCode('Flatbed or Step Deck'), 'SD');
  assert.equal(policy.normalizeEquipmentCode('Flatbed or Conestoga'), 'FLCS');
  assert.equal(policy.normalizeEquipmentCode('Straight Truck - Large'), 'D-LG,D-ST');
  assert.equal(policy.normalizeEquipmentCode('Conestoga'), 'FLCS');
  assert.equal(policy.normalizeEquipmentCode('Step Deck'), 'SD');
  assert.equal(policy.normalizeEquipmentCode('Stepdeck'), 'SD');
  assert.equal(policy.normalizeEquipmentCode('FH'), 'FH');
  assert.equal(policy.normalizeEquipmentCode(''), '');
  assert.equal(policy.getLandstarEquipmentCode(policy.normalizeEquipmentCode('Reefer - 53')), 'REFR');
  assert.equal(policy.getLandstarEquipmentCode(policy.normalizeEquipmentCode('Flatbed - 53')), 'FLAT');
  assert.equal(policy.getLandstarEquipmentCode(policy.normalizeEquipmentCode('Conestoga')), 'FLCS');
  assert.equal(policy.getLandstarEquipmentCode(policy.normalizeEquipmentCode('Step Deck')), 'STEP');
});

test('oversized and specialized equipment is flagged to skip on import', () => {
  assert.equal(policy.isSkippableEquipment('Over Dimensional'), true);
  assert.equal(policy.isSkippableEquipment('Removable GooseNeck'), true);
  assert.equal(policy.isSkippableEquipment('RGN Extendable'), true);
  assert.equal(policy.isSkippableEquipment('RGN'), true);
  assert.equal(policy.isSkippableEquipment('Lowboy'), true);
  assert.equal(policy.isSkippableEquipment('Flatbed'), false);
  assert.equal(policy.isSkippableEquipment('Step Deck'), false);
  assert.equal(policy.isSkippableEquipment('Conestoga'), false);
  assert.equal(policy.isSkippableEquipment('Van'), false);
  assert.equal(policy.isSkippableEquipment(''), false);
});

test('RXO Excel import maps reefer equipment to REFR instead of VAN', async () => {
  const app = createAppHarness(customers[1], []);
  await app.importExcel([
    ['Order Number', 'Equipment Type', '', '', '', '', 'Origin City', 'Origin State', 'Origin Zip',
      '', '', 'Destination City', 'Destination State', 'Destination Zip', 'Weight', '',
      'Pickup Time', 'Delivery Time', 'Miles'],
    ['900001', 'Reefer - 53', '', '', '', '', 'Chicago', 'IL', '60601', '', '', 'Dallas', 'TX',
      '75201', '42000', '', '10/27/2026 0800 - 1600', '10/30/2026 0800 - 1600', '900'],
    ['900002', 'Van', '', '', '', '', 'Chicago', 'IL', '60601', '', '', 'Austin', 'TX',
      '78701', '42000', '', '10/27/2026 0800 - 1600', '10/30/2026 0800 - 1600', '900']
  ]);
  const saved = JSON.parse(app.storage.get('landstar_customerOrdersMap'))[customers[1]];
  const reefer = saved.find(order => order.id === '900001');
  const van = saved.find(order => order.id === '900002');
  assert.equal(reefer.eCode, 'R');
  assert.equal(policy.getLandstarEquipmentCode(reefer.eCode), 'REFR');
  assert.equal(van.eCode, 'VAN:VAN');
  assert.equal(policy.getLandstarEquipmentCode(van.eCode), 'VAN');
  assert.equal(app.errors.length, 0);
});

test('Van or Reefer equipment imports as V,R and exports as VAN with REFR alternate', async () => {
  assert.equal(policy.normalizeEquipmentCode('Van or Reefer - 53'), 'V,R');
  assert.equal(policy.normalizeEquipmentCode('Van or Reefer'), 'V,R');
  assert.equal(policy.getLandstarEquipmentCode('V,R'), 'VAN');
  assert.equal(policy.getLandstarEquipment2({ eCode: 'V,R' }), 'REFR');
  assert.equal(policy.getLandstarCommodity('V,R'), 'CGAPP');

  const app = createAppHarness(customers[1], []);
  await app.importExcel([
    ['Order Number', 'Equipment Type', '', '', '', '', 'Origin City', 'Origin State', 'Origin Zip',
      '', '', 'Destination City', 'Destination State', 'Destination Zip', 'Weight', '',
      'Pickup Time', 'Delivery Time', 'Miles'],
    ['900003', 'Van or Reefer - 53', '', '', '', '', 'Chicago', 'IL', '60601', '', '', 'Dallas', 'TX',
      '75201', '42000', '', '10/27/2026 0800 - 1600', '10/30/2026 0800 - 1600', '900']
  ]);
  const saved = JSON.parse(app.storage.get('landstar_customerOrdersMap'))[customers[1]];
  assert.equal(saved.find(order => order.id === '900003').eCode, 'V,R');
  assert.equal(app.errors.length, 0);
});

test('Excel import replaces spreadsheet miles with Google driving miles', async () => {
  const app = createAppHarness(customers[1], []);
  await app.importExcel([
    ['Order Number', 'Equipment Type', '', '', '', '', 'Origin City', 'Origin State', 'Origin Zip',
      '', '', 'Destination City', 'Destination State', 'Destination Zip', 'Weight', '',
      'Pickup Time', 'Delivery Time', 'Loaded Miles'],
    ['900010', 'Reefer - 53', '', '', '', '', 'Chicago', 'IL', '60601', '', '', 'Dallas', 'TX',
      '75201', '42000', '', '10/27/2026 0800 - 1600', '10/30/2026 0800 - 1600', '396.3 miles'],
    ['900011', 'Van', '', '', '', '', 'Chicago', 'IL', '60601', '', '', 'Austin', 'TX',
      '78701', '42000', '', '10/27/2026 0800 - 1600', '10/30/2026 0800 - 1600', '1,532 miles']
  ]);
  const saved = JSON.parse(app.storage.get('landstar_customerOrdersMap'))[customers[1]];
  assert.equal(saved.find(order => order.id === '900010').miles, '500');
  assert.equal(saved.find(order => order.id === '900011').miles, '500');
  assert.equal(policy.getRatePerMile('2000', saved.find(order => order.id === '900010').miles), '4.00');
  assert.equal(app.errors.length, 0);
});

test('RXO allLoadsSearch export imports pickup and delivery times from its own columns', async () => {
  const app = createAppHarness(customers[1], []);
  await app.importExcel([
    ['Order Number', 'Equipment Type', 'Origin - City', 'Origin - State', 'Origin - Zip',
      'Pickup Time', 'Destination - City', 'Destination - State', 'Destination - Zip',
      'Delivery Time', 'Weight', 'Commodity', 'Loaded Miles'],
    ['24553376', 'Van - 53 Feet', 'Spartanburg', 'SC', '29303', 46331.833333333336,
      'Fayetteville', 'NC', '28306', 46332.541666666664, '44000lbs', 'SOLAR PANELS', '214.2 miles']
  ]);
  const saved = JSON.parse(app.storage.get('landstar_customerOrdersMap'))[customers[1]];
  const imported = saved.find(order => order.id === '24553376');
  assert.equal(imported.origCity, 'SPARTANBURG');
  assert.equal(imported.destCity, 'FAYETTEVILLE');
  // RXO payer imports widen the times to business hours on the same dates.
  assert.equal(imported.pickupTime, '11/05/2026 0800 - 2000');
  assert.equal(imported.deliveryTime, '11/06/2026 0800 - 1200');
  assert.equal(imported.miles, '500');
  assert.equal(app.errors.length, 0);
});

test('straight trucks import as D-LG,D-ST and export to Landstar as D-LG with D-ST alternate', () => {
  for (const code of ['D-LG', 'D-LG,D-ST']) {
    assert.equal(policy.getLandstarEquipmentCode(code), 'D-LG', code);
    assert.equal(policy.getLandstarEquipment2({ eCode: code }), 'D-ST', code);
  }
  assert.equal(policy.getLandstarEquipment2({ eCode: 'V' }), '');
  assert.equal(policy.getLandstarEquipment2({ eCode: 'F,SD' }), 'STEP');
  assert.equal(policy.getLandstarEquipment2({ eCode: 'VM' }), '53VN');
});

test('pickup windows spanning two days parse for Landstar export', () => {
  const twoDay = [...policy.splitScheduleRange('10/29/2026 09:00-10/30/2026 16:00')];
  assert.deepEqual(twoDay, ['10/29/2026 0900', '10/30/2026 1600']);
  const pickupFrom = policy.toExcelDateTime(twoDay[0]);
  const pickupThru = policy.toExcelDateTime(twoDay[1], twoDay[0]);
  assert.notEqual(pickupFrom, null);
  assert.notEqual(pickupThru, null);
  assert.ok(pickupThru > pickupFrom);

  const spaced = [...policy.splitScheduleRange('10/29/2026 0700 - 10/30/2026 16:00')];
  assert.deepEqual(spaced, ['10/29/2026 0700', '10/30/2026 1600']);

  const sameDay = [...policy.splitScheduleRange('10/27/2026 0800 - 1200')];
  assert.deepEqual(sameDay, ['10/27/2026 0800', '1200']);
  assert.notEqual(policy.toExcelDateTime(sameDay[1], sameDay[0]), null);

  const tightSameDay = [...policy.splitScheduleRange('10/27/2026 0800-1200')];
  assert.deepEqual(tightSameDay, ['10/27/2026 0800', '1200']);

  const enDash = [...policy.splitScheduleRange('10/29/2026 0700 – 10/30/2026 16:00')];
  assert.deepEqual(enDash, ['10/29/2026 0700', '10/30/2026 1600']);

  assert.notEqual(policy.toExcelDateTime('11/2/26 8:00'), null);
});

test('NTG load number readings are majority voted digit by digit', () => {
  assert.deepEqual({ ...policy.voteNtgLoadNumber(['9779123', '9779423', '9779123']) }, { value: '9779123', unanimous: false });
  assert.deepEqual({ ...policy.voteNtgLoadNumber(['9548267', '9548267']) }, { value: '9548267', unanimous: true });
  assert.equal(policy.voteNtgLoadNumber(['0760122']).value, '9760122');
  assert.equal(policy.voteNtgLoadNumber(['77912', 'abc']), null);
});

test('NTG card regions are found between grey gaps', () => {
  const w = 100, h = 120, data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    if (y < 5 || (y >= 55 && y < 62) || y >= 112) {
      for (let x = 0; x < w; x++) data.fill(220, (y * w + x) * 4, (y * w + x) * 4 + 3);
    }
  }
  const regions = ntgCards.findNtgCardRegions(data, w, h);
  assert.deepEqual(regions.map(r => [r.y0, r.y1]), [[5, 55], [62, 112]]);
});

test('rate per mile is calculated from rate and miles', () => {
  assert.equal(policy.getRatePerMile('6200', '1841.0'), '3.37');
  assert.equal(policy.getRatePerMile('$1,500', '500'), '3.00');
  assert.equal(policy.getRatePerMile('2000', '396.3 miles'), '5.05');
  assert.equal(policy.getRatePerMile('1500', '1,532 miles'), '0.98');
  assert.equal(policy.getRatePerMile('', '500'), '');
  assert.equal(policy.getRatePerMile('1500', ''), '');
  assert.equal(policy.getRatePerMile('1500', '0'), '');
});

test('fuel surcharge region follows the pickup state (the weekly email\'s four regions)', () => {
  for (const state of ['CT', 'ME', 'MA', 'NH', 'RI', 'VT', 'vt']) assert.equal(policy.getFuelSurchargeRegion(state), 'newEngland', state);
  for (const state of ['NY', 'NJ', 'PA', 'MD', 'VA', 'NC', 'SC', 'GA', 'FL']) assert.equal(policy.getFuelSurchargeRegion(state), 'east', state);
  for (const state of ['OH', 'IL', 'MI', 'TN', 'OK', 'TX', 'LA', 'AR', 'MS', 'AL', 'NM']) assert.equal(policy.getFuelSurchargeRegion(state), 'midwest', state);
  for (const state of ['CO', 'UT', 'AZ', 'CA', 'WA', 'NV']) assert.equal(policy.getFuelSurchargeRegion(state), 'west', state);
  for (const state of ['ON', '', undefined]) assert.equal(policy.getFuelSurchargeRegion(state), 'midwest', String(state));
});

test('fuel surcharge rate resolves per mile by region with Midwest fallback', () => {
  const rates = { east: '0.86', midwest: '0.88', west: '1.03', newEngland: '0.89' };
  assert.equal(policy.getFuelSurchargeRate(rates, 'PA'), 0.86);
  assert.equal(policy.getFuelSurchargeRate(rates, 'TX'), 0.88);
  assert.equal(policy.getFuelSurchargeRate(rates, 'MA'), 0.89);
  assert.equal(policy.getFuelSurchargeRate(rates, 'CA'), 1.03);
  assert.equal(policy.getFuelSurchargeRate({ ...rates, west: '' }, 'CA'), 0.88);
  assert.equal(policy.getFuelSurchargeRate({ east: '', midwest: '', west: '', newEngland: '' }, 'IL'), null);
  assert.equal(policy.getFuelSurchargeRate(undefined, 'IL'), null);
  assert.equal(policy.getFuelSurchargeRate({ midwest: '$0.88' }, 'tx'), 0.88);
});

test('fuel surcharge rates normalize to cents per mile, keep blanks, and move old settings over', () => {
  const normalized = value => JSON.parse(JSON.stringify(policy.normalizeFuelSurchargeRates(value)));
  assert.deepEqual(normalized(undefined), { east: '0.86', midwest: '0.88', west: '1.03', newEngland: '0.89' });
  assert.deepEqual(normalized({ east: '$0.875', west: '1.04' }), { east: '0.88', midwest: '', west: '1.04', newEngland: '' });
  assert.deepEqual(normalized({ national: '0.87', newEngland: '0.89', rockyMountain: '0.90', westCoast: '1.04' }),
    { east: '0.87', midwest: '0.87', west: '1.04', newEngland: '0.89' });
});

test('the weekly fuel email updates the rates', () => {
  const parsed = policy.parseFuelSurchargeEmail('Fw: 11/3/2026   East .86  Midwest .88   West 1.03 New England .89');
  assert.equal(parsed.date, '11/3/2026');
  assert.deepEqual({ ...parsed.rates }, { east: '0.86', midwest: '0.88', west: '1.03', newEngland: '0.89' });
  const body = policy.parseFuelSurchargeEmail('Good morning everyone please use the updated fuel rates below\n\n11/3/2026\nEast .86\nMidwest .88\nWest 1.03\nNew England .89');
  assert.equal(body.rates.west, '1.03');
  assert.equal(policy.parseFuelSurchargeEmail('East .86 Midwest .88 West 1.03'), null, 'all four needed');
  assert.equal(policy.parseFuelSurchargeEmail('East 86 Midwest .88 West 1.03 New England .89'), null, 'not a $/mile number');
});

test('load cards have a copy button for the pickup and delivery city/state', () => {
  const app = createAppHarness(customers[0], [{ ...load, id: '77', route: 'COMMERCE, CA → CALEXICO, CA' }]);
  const button = app.find(node => node.props?.['aria-label'] === 'Copy route for load 77');
  assert.ok(button);
  let stopped = false;
  button.props.onClick({ stopPropagation: () => { stopped = true; } });
  assert.ok(stopped);
});

test('sort controls order loads independently by pickup/delivery city or state in both directions', () => {
  const app = createAppHarness(customers[0], [
    { ...load, id: '1', origCity: 'Atlanta', origSt: 'GA', destCity: 'Seattle', destSt: 'WA' },
    { ...load, id: '2', origCity: 'Denver', origSt: 'CO', destCity: 'Austin', destSt: 'TX' },
    { ...load, id: '3', origCity: 'Chicago', origSt: 'IL', destCity: 'Miami', destSt: 'FL' }
  ]);
  const expected = {
    origin: ['1', '3', '2'],
    destination: ['2', '3', '1'],
    'origin-state': ['2', '1', '3'],
    'destination-state': ['3', '2', '1']
  };
  for (const [field, ids] of Object.entries(expected)) {
    for (const direction of ['asc', 'desc']) {
      const value = `${field}-${direction}`;
      const select = app.find(node => node.props?.['aria-label'] === 'Sort loads by city and state');
      assert.ok(select.props.children.flat(Infinity).some(node => node?.props?.value === value));
      select.props.onChange({ target: { value } });
      app.render();
      const list = app.find(node => node.props?.children.flat(Infinity)
        .some(child => child?.props?.className?.includes('tms-load-card')));
      const cards = list.props.children.flat(Infinity)
        .filter(node => node?.props?.className?.includes('tms-load-card'));
      const actual = cards.map(card => {
        card.props.onClick();
        return app.states[6].id;
      });
      assert.deepEqual(actual, direction === 'asc' ? ids : [...ids].reverse(), value);
    }
  }
});

test('Nolan spreadsheet re-import saves matching ENT loads as OPEN and retains assignments', async () => {
  const ids = ['2279616', '2272252', '2220754', '2277742', '2279424'];
  const app = createAppHarness(customers[2], ids.map(id => ({
    ...load, id, status: 'ENT', tag: 'ENT', driver: 'Alex Driver', truck: 'T-102'
  })));
  await app.importExcel([
    ['Load ID', 'Equipment', 'Origin City', 'Origin State', 'Origin Zip', 'Destination City', 'Destination State', 'Destination Zip'],
    ...ids.map(id => [id, 'VE', 'Fairfield', 'OH', '45014', 'Lafayette', 'IN', '47905'])
  ]);
  const saved = JSON.parse(app.storage.get('landstar_customerOrdersMap'));
  assert.equal(saved[customers[2]].length, 1);
  for (const order of saved[customers[2]]) {
    assert.equal(order.status, 'OPEN', order.id);
    assert.equal(order.tag, 'OPEN', order.id);
    assert.equal(order.driver, 'Alex Driver');
    assert.equal(order.truck, 'T-102');
  }
  assert.equal(saved['Unrelated customer'][0].status, 'ENT');
  assert.equal(app.errors.length, 0);
});

test('Nolan import selection uses processed load IDs and supports the NTG alias', () => {
  const processed = [{ id: 'imported' }, { id: 'imported-ALTA' }, { id: 'imported' }];
  for (const customer of [customers[2], 'NTG 965974 - ATZ H']) {
    assert.deepEqual(Array.from(policy.getImportedLoadSelection(customer, processed)), ['imported', 'imported-ALTA']);
  }
  assert.deepEqual(Array.from(policy.getImportedLoadSelection(customers[0], processed)), []);
  assert.deepEqual(Array.from(policy.getImportedLoadSelection(customers[2], [])), []);
});

test('Nolan Excel imports check only imported loads while other customers keep manual selection', async () => {
  const futureLoad = { ...load, pickupTime: '10/27/2099 0800 - 1200', deliveryTime: '10/28/2099 0800 - 1600' };
  for (const customer of [customers[2], customers[0]]) {
    const app = createAppHarness(customer, [
      futureLoad,
      { ...load, id: '999999', destCity: 'Boston', status: 'ENT', tag: 'ENT',
        landstarExportedAt: new Date().toISOString() }
    ]);
    await app.importExcel([
      ['Load ID', 'Equipment', 'Origin City', 'Origin State', 'Origin Zip', 'Destination City', 'Destination State', 'Destination Zip', 'Pickup Date (From)', 'Delivery Date (From)'],
      [load.id, 'V', 'Chicago', 'IL', '60601', 'Dallas', 'TX', '75201', '10/27/2099 0800', '10/28/2099 0800'],
      ['222222', 'V', 'Chicago', 'IL', '60601', 'Austin', 'TX', '78701', '10/27/2099 0800', '10/28/2099 0800']
    ]);
    app.render();
    // The exported ENT load 999999 is not on the list: deleted.
    assert.equal(JSON.parse(app.storage.get('landstar_customerOrdersMap'))[customer].length, 2);
    for (const id of [load.id, '222222']) {
      const card = app.find(node => node.props?.id === `load-card-${id}`);
      const checkbox = card.props.children.flat(Infinity).find(node => node?.type === 'input'
        && node.props.type === 'checkbox');
      assert.equal(checkbox.props.checked, customer === customers[2], `${customer}: ${id}`);
    }
    const copyButton = app.find(node => node.type === 'button'
      && String(node.props.children.flat(Infinity).join('')).startsWith('📋 Copy Selected'));
    assert.equal(copyButton.props.disabled, customer !== customers[2]);
    if (customer === customers[2]) assert.match(copyButton.props.children.flat(Infinity).join(''), /\(2\)/);
    assert.equal(app.errors.length, 0);
  }
});

test('Nolan customer screenshot reopens existing ENT numbers even when their cells are red', () => {
  const times = ['10/28/2026 0800', '10/28/2026 1400', '10/29/2026 0800', '10/29/2026 1400'];
  const ids = ['2279616', '2272252', '2220754', '2277742', '2279424'];
  const imported = ids.map(id => parseScreenshotTimes(id, times, customers[2], true));
  const existing = ids.map(id => ({ ...load, id, status: 'ENT', tag: 'ENT' }));
  const result = policy.replaceImportedCustomerLoads(customers[2], imported, existing);
  assert.equal(result.loads.length, 1);
  for (const order of result.loads) {
    assert.equal(order.status, 'OPEN', order.id);
    assert.equal(order.tag, 'OPEN', order.id);
  }
  assert.equal(result.usesScreenshotStatus, false);
});

test('DAT re-import reopens unchanged and manually priced ENT lanes while retaining other archives', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const existing = [
    { ...load, id: 'DAT-123-0', status: 'ENT', tag: 'ENT', rateInput: '2500',
      rateSource: 'user-entered', driverPhone: '555-1234', landstarExportedAt: '2026-10-27T12:00:00Z' },
    { ...load, id: 'archive', destCity: 'Austin', status: 'ENT', tag: 'ENT',
      landstarExportedAt: '2026-10-27T12:00:00Z' }
  ];
  const rows = [
    { ...load, id: 'DAT-456-0', rateInput: '3000', rateSource: 'dat-screenshot' },
    { ...load, id: 'DAT-456-1' },
    { ...load, id: 'DAT-456-2', pickupTime: '09/28/2026 0800' }
  ];
  const deduplicated = policy.deduplicateDatImports(rows, existing);
  assert.equal(deduplicated.skippedDuplicateCount, 1);
  const result = policy.replaceImportedCustomerLoads(customers[2], deduplicated.loads, existing,
    { additive: true, allowGeneratedIds: true, now });
  assert.equal(result.loads.length, 3);
  assert.deepEqual(Array.from(result.loads, order => order.id), ['DAT-123-0', 'DAT-456-2', 'archive']);
  const reopened = result.loads.find(order => order.id === 'DAT-123-0');
  assert.equal(reopened.status, 'OPEN');
  assert.equal(reopened.tag, 'OPEN');
  assert.equal(reopened.rateInput, '2500');
  assert.equal(reopened.driverPhone, '555-1234');
  assert.equal(Object.hasOwn(reopened, 'landstarExportedAt'), false);
  assert.equal(result.loads.find(order => order.id === 'DAT-456-2').status, 'ENT');
  assert.equal(result.loads.find(order => order.id === 'archive').status, 'ENT');
});

test('full lists delete missing exported ENT loads; other customers keep them 30 days; re-imports reopen', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  for (const customer of [...customers, 'Other customer']) {
    const recent = { ...load, id: 'recent', status: 'ENT', tag: 'ENT',
      landstarExportedAt: new Date(now - 30 * day + 1).toISOString() };
    const expired = { ...load, id: 'expired', destCity: 'Austin', status: 'ENT', tag: 'ENT',
      landstarExportedAt: new Date(now - 30 * day).toISOString() };
    const incoming = { ...load, id: 'new', destCity: 'Reno' };
    const existing = [recent, expired];
    const result = policy.replaceImportedCustomerLoads(customer, [incoming], existing, { now });
    if (customer === 'Other customer') assert.equal(result.loads.find(order => order.id === 'recent').status, 'ENT', customer);
    else assert.equal(result.loads.some(order => order.id === 'recent'), false, customer);
    assert.equal(result.loads.some(order => order.id === 'expired'), false, customer);
    const reopened = policy.replaceImportedCustomerLoads(customer, [load], [recent], { now }).loads[0];
    // The pickup is still ahead, so the import lands as OPEN for every customer.
    assert.equal(reopened.status, 'OPEN', customer);
    assert.equal(Object.hasOwn(reopened, 'landstarExportedAt'), false);
    const cleaned = policy.removeExpiredExportedLoads({ [customer]: [recent, expired] }, now);
    assert.deepEqual(Array.from(cleaned[customer], order => order.id), ['recent']);
    assert.equal(policy.removeExpiredExportedLoads(cleaned, now + 1)[customer].length, 0);
    const open = { ...expired, status: 'OPEN', tag: 'OPEN' };
    assert.equal(policy.removeExpiredExportedLoads({ [customer]: [open] }, now)[customer].length, 1);
  }
});

test('same load number on different pickup days: a full list keeps only the days on it', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const archive = { ...load, status: 'ENT', tag: 'ENT', landstarExportedAt: '2026-10-27T12:00:00Z' };
  const rows = [
    { ...load, pickupTime: '10/28/2026 0800' },
    { ...load, pickupTime: '10/29/2026 0800' }
  ];
  const result = policy.replaceImportedCustomerLoads(customers[2], rows, [archive], { now });
  assert.equal(result.loads.length, 2);
  assert.equal(new Set(result.loads.map(order => order.id)).size, 2);
  assert.equal(result.loads.filter(order => order.status === 'OPEN').length, 2);
  assert.equal(new Set(result.loads.map(policy.createLaneDayKey)).size, 2);
});

test('export marks only the exported pickup-day variant ENT, starts retention and persists through reload', () => {
  const exportedAt = '2026-10-28T12:00:00Z';
  const orders = [
    { ...load },
    { ...load, id: `${load.id}-ALTA`, sourceLoadId: load.id, pickupTime: '10/28/2026 0800' }
  ];
  const exported = policy.markLoadsExported(orders, new Set([orders[1].id]), exportedAt);
  assert.equal(exported[0].status, 'OPEN');
  assert.equal(Object.hasOwn(exported[0], 'landstarExportedAt'), false);
  assert.equal(exported[1].status, 'ENT');
  assert.equal(exported[1].tag, 'ENT');
  assert.equal(exported[1].landstarExportedAt, exportedAt);
  assert.equal(orders[1].status, 'OPEN');
  const reloaded = createAppHarness(customers[2], JSON.parse(JSON.stringify(exported)));
  const saved = JSON.parse(reloaded.storage.get('landstar_customerOrdersMap'))[customers[2]];
  assert.equal(saved[1].status, 'ENT');
  assert.equal(saved[1].landstarExportedAt, exportedAt);
  const reopened = policy.replaceImportedCustomerLoads(customers[2], [orders[1]], saved).processedLoads[0];
  assert.equal(reopened.status, 'OPEN');
  assert.equal(Object.hasOwn(reopened, 'landstarExportedAt'), false);
});

test('assignment fields save with the load and survive reload and re-import', () => {
  const app = createAppHarness(customers[0], [load]);
  assert.equal(app.find(node => node.props?.placeholder === 'Enter carrier name'), null);
  const fields = {
    driver: ['assignment-driver', 'Alex Driver'],
    driverPhone: ['assignment-driver-phone', '+1 (555) 123-4567'],
    truck: ['assignment-truck', 'T-102'],
    trailer: ['assignment-trailer', 'TR-208'],
    pickupEta: ['assignment-pickup-eta', '10/28/2026 09:30'],
    emptyLocation: ['assignment-empty-location', 'Toledo, OH']
  };
  for (const [field, [id, value]] of Object.entries(fields)) {
    const input = app.find(node => node.props?.id === id);
    assert.ok(input);
    input.props.onChange({ target: { value } });
    app.render();
    assert.equal(app.states[2][customers[0]][0][field], value);
  }
  app.effects[1]();
  const saved = JSON.parse(app.storage.get('landstar_customerOrdersMap'))[customers[0]];
  const reloaded = createAppHarness(customers[0], saved);
  const replaced = policy.replaceImportedCustomerLoads(customers[0], [
    { ...load, pickupEta: 'Imported ETA', emptyLocation: '', driver: '', driverPhone: '', truck: '', trailer: '' }
  ], saved).loads[0];
  for (const [field, [id, value]] of Object.entries(fields)) {
    assert.equal(reloaded.find(node => node.props?.id === id).props.value, value);
    assert.equal(replaced[field], value);
  }
  assert.equal(replaced.pickupTime, load.pickupTime);
});

test('global search opens the owning customer and keeps bulk selection customer-scoped', () => {
  const app = createAppHarness(customers[0], [load]);
  const foreign = { ...load, id: load.id, origCity: 'Vernon', origSt: 'CA', route: '' };
  app.states[2][customers[1]] = [foreign];
  app.find(node => node.props?.['aria-label'] === 'Search loads across all customers')
    .props.onChange({ target: { value: 'vernon' } });
  app.render();
  const card = app.find(node => node.props?.className?.includes('tms-load-card'));
  assert.ok(card);
  const checkbox = app.find(node => node.type === 'input' && node.props.title === 'Open this load to select its customer first');
  assert.equal(checkbox.props.disabled, true);
  const selectAll = () => app.find(node => node.type === 'input' && node.props.className === 'cursor-pointer accent-blue-600');
  selectAll().props.onChange();
  assert.equal(app.states[18].length, 0);
  card.props.onClick();
  app.render();
  assert.equal(app.states[1], customers[1]);
  assert.equal(app.states[6], foreign);
  assert.equal(app.find(node => node.type === 'input' && node.props.title === 'Select load').props.disabled, false);
  selectAll().props.onChange();
  assert.deepEqual(Array.from(app.states[18]), [foreign.id]);
});

test('manual rate persists and auto-fills a future Excel load with different ZIPs after reload', async () => {
  const original = { ...load, origZip: '60601', destZip: '75201', eCode: 'VZ' };
  const app = createAppHarness(customers[0], [original]);
  app.enterRate('$2,500');
  const savedRates = JSON.parse(app.storage.get('landstar_laneRates'));
  assert.equal(savedRates[policy.createLaneRateKey(customers[0], original)], '2500');
  const reloaded = createAppHarness(customers[0], [], null, savedRates);
  await reloaded.importExcel([
    ['Load ID', 'Equipment', 'Origin City', 'Origin State', 'Origin Zip', 'Destination City', 'Destination State', 'Destination Zip'],
    ['7654321', 'VZ', 'Chicago', 'IL', '60602', 'Dallas', 'TX', '75202']
  ]);
  const saved = JSON.parse(reloaded.storage.get('landstar_customerOrdersMap'));
  assert.equal(saved[customers[0]][0].rateInput, '2500');
  assert.equal(saved[customers[0]][0].rateSource, 'user-entered');
  assert.equal(reloaded.errors.length, 0);
});

test('an Excel import clears a leftover search and leaves Booked Loads so the new loads show', async () => {
  const app = createAppHarness(customers[0], [
    { ...load, id: '2', status: 'BOOKED', tag: 'BOOKED', driver: 'Alex Driver' }
  ]);
  const search = () => app.find(node => node.type === 'input' && node.props['aria-label'] === 'Search loads across all customers');
  search().props.onChange({ target: { value: 'Shepardsville' } });
  app.render();
  app.find(node => node.type === 'button' && textOf(node) === 'BOOKED (1)').props.onClick();
  app.render();
  const bookedPage = () => app.find(node => typeof node.type === 'function' && node.type.name === 'BookedLoadsPage');
  assert.ok(bookedPage());
  await app.importExcel([
    ['Load ID', 'Equipment', 'Origin City', 'Origin State', 'Origin Zip', 'Destination City', 'Destination State', 'Destination Zip'],
    ['7654321', 'VZ', 'Chicago', 'IL', '60601', 'Dallas', 'TX', '75201']
  ]);
  app.render();
  assert.equal(bookedPage(), null);
  assert.equal(search().props.value, '');
});

test('a typed lane rate is reused on the next import; a DAT rate is not saved as yours', async () => {
  const app = createAppHarness(customers[0], []);
  await app.importExcel([
    ['Load ID', 'Equipment', 'Origin City', 'Origin State', 'Origin Zip', 'Destination City', 'Destination State', 'Destination Zip'],
    ['7654321', 'VZ', 'Chicago', 'IL', '60601', 'Dallas', 'TX', '75201']
  ]);
  const first = JSON.parse(app.storage.get('landstar_customerOrdersMap'))[customers[0]][0];
  assert.equal(first.rateInput, '2000');
  assert.equal(first.rateSource, 'dat-api');
  const savedRates = JSON.parse(app.storage.get('landstar_laneRates') || '{}');
  assert.equal(savedRates[policy.createLaneRateKey(customers[0], first)], undefined);

  const row = ['7659999', 'VZ', 'Chicago', 'IL', '60602', 'Dallas', 'TX', '75202'];
  const header = ['Load ID', 'Equipment', 'Origin City', 'Origin State', 'Origin Zip', 'Destination City', 'Destination State', 'Destination Zip'];
  let datCalls = 0;
  const datFetch = async url => {
    if (url === '/api/road-miles') return { ok: true, json: async () => ({ miles: 500 }) };
    if (url === '/api/dat-rate') { datCalls += 1; return { json: async () => ({ rate: 9999 }) }; }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  // No typed rate for the lane: the next import gets a fresh DAT rate.
  const fresh = createAppHarness(customers[0], [], null, savedRates, { fetch: datFetch });
  await fresh.importExcel([header, row]);
  const second = JSON.parse(fresh.storage.get('landstar_customerOrdersMap'))[customers[0]][0];
  assert.equal(second.rateInput, '9999');
  assert.equal(second.rateSource, 'dat-api');
  assert.equal(datCalls, 1);

  // You typed 2150 for this lane: the next import uses it and does not ask DAT.
  const typedRates = { [policy.createLaneRateKey(customers[0], first)]: '2150' };
  const reloaded = createAppHarness(customers[0], [], null, typedRates, { fetch: datFetch });
  await reloaded.importExcel([header, row]);
  const third = JSON.parse(reloaded.storage.get('landstar_customerOrdersMap'))[customers[0]][0];
  assert.equal(third.rateInput, '2150');
  assert.equal(third.rateSource, 'user-entered');
  assert.equal(datCalls, 1);
});

for (const customer of [customers[0], customers[1]]) {
test(`${customer} Excel import persists one OPEN load per lane/day and removes older duplicates`, async () => {
  const app = createAppHarness(customer, [
    { ...load, id: '100001', status: 'ENT', tag: 'ENT' },
    { ...load, id: '100002', status: 'OPEN', tag: 'OPEN' }
  ]);
  await app.importExcel([
    ['Load ID', 'Equipment', '', '', '', '', 'Origin City', 'Origin State', 'Origin Zip',
      '', '', 'Destination City', 'Destination State', 'Destination Zip', 'Weight', '',
      'Pickup Time', 'Delivery Time', 'Miles'],
    ...['100001', '100002', '100003'].map((id, index) => [
      id, 'VZ', '', '', '', '', 'Chicago', 'IL', '60601', '', '', 'Dallas', 'TX',
      '75201', '42000', '', `10/${index === 2 ? '28' : '27'}/2026 ${index === 1 ? '1400' : '0800'} - 1600`,
      '10/30/2026 0800 - 1600', '900'
    ])
  ]);
  const saved = JSON.parse(app.storage.get('landstar_customerOrdersMap'))[customer];
  assert.deepEqual(saved.map(order => order.id), ['100001', '100003']);
  assert.equal(saved[0].status, 'OPEN');
  assert.ok(app.alerts.some(message => message.includes('Same-lane/pickup-day duplicates skipped: 1')));
  assert.equal(app.errors.length, 0);
});
}

for (const customer of customers) {
  test(`${customer}: Excel import persists exactly the current unique load list`, async () => {
    const app = createAppHarness(customer, [
      { ...load, status: 'ENT', tag: 'ENT' },
      { ...load, id: '222222', status: 'ENT', tag: 'ENT' },
      { ...load, id: '333333' }
    ]);
    await app.importExcel([
      ['Load ID', 'Equipment', '', '', '', '', 'Origin City', 'Origin State', 'Origin Zip',
        '', '', 'Destination City', 'Destination State', 'Destination Zip', 'Weight', '',
        'Pickup Time', 'Delivery Time', 'Miles'],
      ...[load.id, load.id, '444444'].map((id, index) => [
        id, 'VZ', '', '', '', '', 'Chicago', 'IL', '60601', '', '', id === '444444' ? 'Austin' : 'Dallas', 'TX',
        '75201', '42000', '', `10/${index === 1 ? '29' : '28'}/2026 0800 - 1200`,
        '10/30/2026 0800 - 1600', '900'
      ])
    ]);
    const saved = JSON.parse(app.storage.get('landstar_customerOrdersMap'));
    assert.deepEqual(saved[customer].map(order => order.id), ['123456', '123456-ALTA', '444444']);
    assert.equal(saved[customer][0].status, 'OPEN');
    assert.equal(saved[customer][0].tag, 'OPEN');
    assert.ok(saved[customer][0].pickupTime.includes('10/28/'));
    assert.equal(saved['Unrelated customer'][0].status, 'ENT');
    assert.ok(app.alerts.some(message => message.includes('removed loads: 3')));
    assert.ok(app.alerts.some(message => message.includes('Duplicate load/day rows skipped: 0')));
    assert.equal(app.errors.length, 0);
  });
}

test('Excel rows without load numbers report an error and do not persist a replacement', async () => {
  const app = createAppHarness(customers[0], [load]);
  const before = app.storage.get('landstar_customerOrdersMap');
  await app.importExcel([
    ['Load ID', 'Origin City', 'Destination City'],
    ['', 'Chicago', 'Dallas']
  ]);
  assert.equal(app.storage.get('landstar_customerOrdersMap'), before);
  assert.ok(app.alerts.some(message => message.includes('Existing loads were not deleted')));
  assert.equal(app.errors.length, 1);
});

test('automated email imports replace per-customer lists only after loading every page', async () => {
  const rows = Array.from({ length: 105 }, (_, index) => ({
    id: index + 1,
    customer: customers[0],
    load: { ...load, id: String(100000 + index), destCity: `Destination ${index}` }
  }));
  rows.push({ id: 106, customer: customers[1], load: { ...load, id: '555555' } });
  rows.push({ id: 107, customer: customers[0], load: { ...rows[0].load } });
  rows.push({ id: 108, customer: customers[0], load: { ...rows[0].load, id: '888888' } });
  const pages = [];
  const acknowledged = [];
  const supabase = {
    from() {
      let after = 0;
      const query = {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        limit() { return this; },
        gt(field, value) { after = value; return this; },
        then(resolve) {
          const data = rows.filter(row => row.id > after).slice(0, 100);
          pages.push(data.length);
          return Promise.resolve({ data, error: null }).then(resolve);
        },
        update() {
          return { in(field, ids) {
            acknowledged.push(...ids);
            return Promise.resolve({ error: null });
          } };
        }
      };
      return query;
    },
    channel() {
      return { on() { return this; }, subscribe() { return this; } };
    }
  };
  const app = createAppHarness(customers[0], [
    { ...load, id: '100000', status: 'ENT', tag: 'ENT' },
    { ...load, id: '999999', status: 'ENT', tag: 'ENT' }
  ], supabase);
  app.effects[2]();
  await new Promise(resolve => setImmediate(resolve));
  const saved = app.states[2];
  assert.deepEqual(pages, [100, 8]);
  assert.equal(saved[customers[0]].length, 105);
  assert.equal(saved[customers[0]][0].status, 'OPEN');
  assert.equal(saved[customers[0]].some(order => order.id === '999999'), false);
  assert.equal(saved[customers[0]].some(order => order.id === '888888'), false);
  assert.equal(saved[customers[1]].length, 1);
  assert.equal(saved['Unrelated customer'][0].id, '777777');
  assert.equal(acknowledged.length, 108);
  assert.equal(app.errors.length, 0);
});

const textOf = node => (node?.props?.children || []).flat(Infinity)
  .map(child => (typeof child === 'string' || typeof child === 'number' ? String(child) : textOf(child))).join('');

test('booking needs a driver and moves the load to BOOKED', () => {
  assert.throws(() => policy.bookLoad({ ...load, driver: '  ' }), /driver name/);
  const booked = policy.bookLoad({ ...load, driver: 'Alex Driver' }, '2026-11-03T12:00:00.000Z');
  assert.equal(booked.status, 'BOOKED');
  assert.equal(booked.tag, 'BOOKED');
  assert.equal(booked.bookedAt, '2026-11-03T12:00:00.000Z');
  assert.equal(policy.getStatusTag('BOOKED'), 'BOOKED');
  assert.equal(policy.getStatusTag('ON HOLD'), 'HOLD');
});

test('driver directory lists known drivers, trucks and trailers across customers', () => {
  const directory = policy.buildDriverDirectory({
    A: [
      { ...load, id: '1', driver: 'Alex Driver', driverPhone: '555-1111', truck: 'T-100', trailer: '', bookedAt: '2026-11-01T00:00:00Z' },
      { ...load, id: '2', driver: 'alex driver', truck: 'T-102', trailer: 'TR-208', bookedAt: '2026-11-02T00:00:00Z' }
    ],
    B: [{ ...load, id: '3', driver: 'Bea Smith', truck: 'T-9', trailer: 'TR-1' }, { ...load, id: '4' }]
  });
  assert.deepEqual(Array.from(directory.drivers, d => d.driver), ['alex driver', 'Bea Smith']);
  // Newest booking wins; missing phone is filled from the driver's older load.
  assert.deepEqual({ ...policy.findKnownDriver(directory, 'ALEX DRIVER') },
    { driver: 'alex driver', driverPhone: '555-1111', truck: 'T-102', trailer: 'TR-208', at: Date.parse('2026-11-02T00:00:00Z') });
  assert.deepEqual(Array.from(directory.trucks), ['T-9', 'T-100', 'T-102']);
  assert.deepEqual(Array.from(directory.trailers), ['TR-1', 'TR-208']);
  assert.equal(policy.findKnownDriver(directory, 'Nobody'), null);
});

test('picking a known driver fills phone, truck and trailer; Book Load moves the load to Booked Loads', () => {
  const app = createAppHarness(customers[0], [
    { ...load, id: '1', status: 'BOOKED', tag: 'BOOKED', driver: 'Alex Driver', driverPhone: '555-1111', truck: 'T-102', trailer: 'TR-208' },
    { ...load, id: '2', origCity: 'Denver', origSt: 'CO' }
  ]);
  app.find(node => node.props?.id === 'load-card-2').props.onClick();
  app.render();
  assert.equal(app.states[6].id, '2');
  const driverInput = app.find(node => node.props?.id === 'assignment-driver');
  assert.equal(driverInput.props.list, 'known-drivers');
  const options = app.find(node => node.type === 'datalist' && node.props.id === 'known-drivers');
  assert.deepEqual(options.props.children.flat(Infinity).map(o => o.props.value), ['Alex Driver']);

  driverInput.props.onChange({ target: { value: 'alex driver' } });
  app.render();
  assert.equal(app.states[6].driverPhone, '555-1111');
  assert.equal(app.states[6].truck, 'T-102');
  assert.equal(app.states[6].trailer, 'TR-208');

  const bookButton = app.find(node => node.type === 'button' && textOf(node).includes('Book Load'));
  assert.ok(bookButton, 'Book Load button replaces Save Changes');
  assert.equal(app.find(node => node.type === 'button' && textOf(node).includes('Save Changes')), null);
  bookButton.props.onClick();
  app.render();
  app.effects[1]();
  const saved = JSON.parse(app.storage.get('landstar_customerOrdersMap'))[customers[0]];
  assert.equal(saved.find(o => o.id === '2').status, 'BOOKED');
  assert.ok(app.find(node => node.props?.role === 'status' && textOf(node).includes('Booked')));

  const bookedTab = app.find(node => node.type === 'button' && textOf(node) === 'BOOKED (2)');
  assert.ok(bookedTab, 'Booked Loads tab shows the count');
  assert.equal(app.alerts.length, 0);
});

test('Book Load without a driver warns and keeps the load open', () => {
  const app = createAppHarness(customers[0], [{ ...load, id: '1' }]);
  app.find(node => node.type === 'button' && textOf(node).includes('Book Load')).props.onClick();
  app.render();
  assert.match(app.alerts[0], /driver name/);
  assert.equal(app.states[6].status, 'OPEN');
});

test('re-imports keep booked loads booked, even when the customer list drops them', () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  const existing = [
    { ...load, id: '111111', status: 'BOOKED', tag: 'BOOKED', driver: 'Alex Driver', bookedAt: '2026-10-19T00:00:00Z' },
    { ...load, id: '222222', origCity: 'Denver', origSt: 'CO', status: 'BOOKED', tag: 'BOOKED', driver: 'Bea Smith' },
    { ...load, id: '333333', origCity: 'Austin', origSt: 'TX' }
  ];
  const { loads } = policy.replaceImportedCustomerLoads(customers[0], [
    { ...load, id: '111111' },
    { ...load, id: '444444', origCity: 'Reno', origSt: 'NV', pickupTime: '12/01/2099 0800 - 1200', deliveryTime: '12/02/2099 0800 - 1600' }
  ], existing, { now });
  const byId = Object.fromEntries(loads.map(l => [l.id, l]));
  assert.equal(byId['111111'].status, 'BOOKED');
  assert.equal(byId['111111'].driver, 'Alex Driver');
  assert.equal(byId['222222'].status, 'BOOKED', 'booked load missing from the new list is kept');
  assert.equal(byId['333333'], undefined, 'unbooked missing load is still removed');
  assert.equal(byId['444444'].status, 'OPEN');
});

test('tracking alerts flag late pickups and overdue check calls', () => {
  const pickupAt = policy.parseScheduleStart('11/06/2026 1100 - 1300');
  assert.equal(pickupAt, new Date(2026, 10, 6, 11, 0).getTime());
  const booked = {
    ...load, status: 'BOOKED', pickupTime: '11/06/2026 1100 - 1300', deliveryTime: '11/08/2026 0700',
    bookedAt: new Date(2026, 10, 6, 8, 0).toISOString()
  };
  assert.equal(policy.getTrackingAlert(booked, new Date(2026, 10, 6, 9, 0).getTime()), null);
  assert.equal(policy.getTrackingAlert(booked, new Date(2026, 10, 6, 10, 30).getTime()), null);
  assert.equal(policy.getTrackingAlert(booked, new Date(2026, 10, 6, 11, 30).getTime()).level, 'late');
  const loaded = policy.logCheckCall(booked, { stage: 'Loaded', note: 'Loaded, rolling' }, new Date(2026, 10, 6, 12, 0).toISOString());
  assert.equal(policy.getTrackingAlert(loaded, new Date(2026, 10, 6, 13, 0).getTime()), null);
  assert.match(policy.getTrackingAlert(loaded, new Date(2026, 10, 6, 17, 0).getTime()).text, /Check call due \(5h/);
  assert.equal(policy.getTrackingAlert(loaded, new Date(2026, 10, 8, 8, 0).getTime()).level, 'late');
  const delivered = policy.logCheckCall(loaded, { stage: 'Delivered' });
  assert.equal(policy.getTrackingAlert(delivered, new Date(2026, 11, 1).getTime()), null);
});

test('check calls record stage and note and keep the last 20', () => {
  let tracked = { ...load, status: 'BOOKED' };
  for (let i = 0; i < 25; i += 1) tracked = policy.logCheckCall(tracked, { stage: 'In Transit', note: ` call ${i} ` }, `2026-11-06T0${i % 10}:00:00.000Z`);
  assert.equal(tracked.trackingStage, 'In Transit');
  assert.equal(tracked.checkCalls.length, 20);
  assert.equal(tracked.checkCalls[19].note, 'call 24');
  assert.equal(policy.logCheckCall(tracked, { stage: 'Nonsense' }).trackingStage, 'In Transit');
});

test('booked loads from every customer are listed by pickup, delivered last', () => {
  const entries = policy.getBookedLoads({
    A: [
      { ...load, id: 'a1', status: 'BOOKED', pickupTime: '11/07/2026 0800' },
      { ...load, id: 'a2', status: 'OPEN' },
      { ...load, id: 'a3', status: 'BOOKED', pickupTime: '11/01/2026 0800', trackingStage: 'Delivered' }
    ],
    B: [{ ...load, id: 'b1', status: 'BOOKED', pickupTime: '11/05/2026 0800' }]
  });
  assert.deepEqual(Array.from(entries, e => `${e.customer}:${e.load.id}`), ['B:b1', 'A:a1', 'A:a3']);
});

test('BOOKED tab opens the Booked Loads page; stage changes save and Open returns to the load', () => {
  const app = createAppHarness(customers[0], [
    { ...load, id: '1', origCity: 'Denver', origSt: 'CO' },
    { ...load, id: '2', status: 'BOOKED', tag: 'BOOKED', driver: 'Alex Driver', driverPhone: '(555) 123-4567', truck: 'T-102', trailer: 'TR-208' }
  ]);
  const pageElement = () => app.find(node => typeof node.type === 'function' && node.type.name === 'BookedLoadsPage');
  assert.equal(pageElement(), null);
  app.find(node => node.type === 'button' && textOf(node) === 'BOOKED (1)').props.onClick();
  app.render();
  const element = pageElement();
  assert.ok(element, 'Booked Loads page is shown');
  assert.deepEqual(Array.from(element.props.entries, e => e.load.id), ['2']);

  const page = element.type(element.props);
  const findIn = (node, predicate) => {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of (node.props?.children || []).flat(Infinity)) {
      const found = findIn(child, predicate);
      if (found) return found;
    }
    return null;
  };
  assert.ok(findIn(page, node => node.type === 'a' && node.props.href === 'tel:5551234567'), 'Call link');
  const textButton = findIn(page, node => node.type === 'button' && /Opens Google Voice with this text copied/.test(node.props.title || ''));
  assert.ok(textButton, 'Text button (Google Voice)');
  assert.match(textButton.props.title, /Hi Alex, this is Daniel with Landstar/);
  const stage = findIn(page, node => node.type === 'select' && String(node.props.id).startsWith('stage-'));
  stage.props.onChange({ target: { value: 'Loaded' } });
  app.render();
  app.effects[1]();
  const saved = JSON.parse(app.storage.get('landstar_customerOrdersMap'))[customers[0]].find(o => o.id === '2');
  assert.equal(saved.trackingStage, 'Loaded');
  assert.equal(saved.checkCalls.length, 1);

  pageElement().props.onOpen(customers[0], '2');
  app.render();
  assert.equal(pageElement(), null, 'Open returns to the load view');
  assert.equal(app.states[6].id, '2');
});

test('Landstar comment box saves on the load, suggests Landstar comments, and survives re-import', () => {
  const app = createAppHarness(customers[0], [{ ...load, id: '1' }]);
  const input = app.find(node => node.props?.id === 'landstar-comment');
  assert.ok(input, 'comment box exists');
  assert.equal(input.props.list, 'landstar-comment-options');
  const options = app.find(node => node.type === 'datalist' && node.props.id === 'landstar-comment-options');
  assert.ok(options.props.children.flat(Infinity).some(option => option.props.value === 'Tracking Required'));
  input.props.onChange({ target: { value: 'Load Ready now' } });
  app.render();
  assert.equal(app.states[2][customers[0]][0].landstarComment, 'Load Ready now');

  const { loads } = policy.replaceImportedCustomerLoads(customers[0], [{ ...load, id: '1', landstarComment: '' }],
    [{ ...load, id: '1', landstarComment: 'Load Ready now' }]);
  assert.equal(loads[0].landstarComment, 'Load Ready now');
});

test('driver links share only public load details and always use the live site', () => {
  const details = policy.buildInquiryDetails({
    ...load, id: '24552929', origCity: 'ELK GROVE VILLAGE', origSt: 'IL', destCity: 'MANSFIELD', destSt: 'TX',
    eCode: 'VAN', weight: '42000lbs', miles: '965', rateInput: '3175', planningComment: 'internal', driver: 'Alex'
  }, { phone: '4845756486' });
  assert.deepEqual(Object.keys(details).sort(),
    ['callbackPhone', 'company', 'delivery', 'destination', 'equipment', 'miles', 'origin', 'pickup', 'rate', 'ref', 'weight']);
  assert.equal(details.origin, 'ELK GROVE VILLAGE, IL');
  assert.equal(details.rate, '$3,175');
  assert.equal(details.weight, '42,000 lbs');
  assert.equal(details.miles, '965 mi');
  assert.equal(details.callbackPhone, '(484) 575-6486');
  assert.ok(!JSON.stringify(details).includes('internal'));

  assert.equal(policy.getInquiryUrl('abcDEF1234567890abcdef', 'https://tms.example.com/'), 'https://tms.example.com/i/abcDEF1234567890abcdef');
  // Never a localhost link, even when the TMS runs on this computer.
  assert.equal(policy.getInquiryUrl('abcDEF1234567890abcdef'), 'https://landstar-tms-reading-cffe.vercel.app/i/abcDEF1234567890abcdef');
  // Column AA is a Landstar comment CODE: only standard comments go out, spelled Landstar's way.
  assert.equal(policy.getLandstarExportComment({ landstarComment: ' load ready NOW ' }), 'Load Ready now');
  assert.equal(policy.getLandstarExportComment({ landstarComment: 'Test comment' }), '');
  assert.equal(policy.getLandstarExportComment({ landstarComment: 'Load Ready now · Inquire: https://x/i/T' }), '');
  assert.equal(policy.getLandstarExportComment({}), '');
});

test('export uses the city and state of the entered ZIP, which is always correct', () => {
  const commerce = policy.getExportPlace('CITY OF COMMER...', 'CA', zipcodes.lookup('90040'));
  assert.deepEqual({ ...commerce }, { city: 'Los Angeles', state: 'CA', fromZip: true });
  const neville = policy.getExportPlace('NEVILLE ISLAND', 'PA', zipcodes.lookup('15225'));
  assert.deepEqual({ ...neville }, { city: 'Pittsburgh', state: 'PA', fromZip: true });
  const wrongState = policy.getExportPlace('Mansfield', 'OK', zipcodes.lookup('76063'));
  assert.equal(wrongState.state, 'TX');
  const noZip = policy.getExportPlace('Elk Grove Village', 'IL', null);
  assert.deepEqual({ ...noZip }, { city: 'Elk Grove Village', state: 'IL', fromZip: false });
});

test('comment box warns when a comment is not a Landstar comment code', () => {
  const app = createAppHarness(customers[0], [{ ...load, id: '1', landstarComment: 'Test comment' }]);
  assert.ok(app.find(node => node.props?.id === 'landstar-comment-warning'), 'free text is flagged');
  const standard = createAppHarness(customers[0], [{ ...load, id: '1', landstarComment: 'load ready now' }]);
  assert.equal(standard.find(node => node.props?.id === 'landstar-comment-warning'), null);
});

test('long military base names are shortened the way Landstar lists them', () => {
  assert.equal(policy.toLandstarCity('March Air Reserve Base'), 'March ARB');
  assert.equal(policy.toLandstarCity('Little Rock Air Force Base'), 'Little Rock AFB');
  assert.equal(policy.toLandstarCity('Washington Court House'), 'Washington CH');
  assert.equal(policy.toLandstarCity('Air Force Base'), 'Air Force Base');
  // Spellings Landstar rejected, mapped to the names on its board.
  assert.equal(policy.toLandstarCity('Hot Springs National Park'), 'Hot Sprs');
  assert.equal(policy.toLandstarCity('Feasterville Trevose'), 'Fstrvl Trvose');
  assert.equal(policy.toLandstarCity('Mc Cordsville'), 'McCordsville');
  assert.equal(policy.toLandstarCity('Elk Grove Village'), 'Elk Grove Village');
});

test('exported rates become past rates for the lane, one entry per distinct rate', () => {
  const lane = { ...load, origCity: 'Elk Grove Village', origSt: 'IL', destCity: 'Mansfield', destSt: 'TX', eCode: 'VAN' };
  let history = policy.addRateHistoryEntries([], customers[1], [
    { order: { ...lane, id: '1' }, rate: '3175' },
    { order: { ...lane, id: '2' }, rate: '$3,525' },
    { order: { ...lane, id: '3' }, rate: '' }
  ], 'exported', '2026-11-04T12:00:00.000Z');
  assert.deepEqual(Array.from(history, entry => `${entry.rate}|${entry.source}`), ['3175|exported', '3525|exported']);
  history = policy.addRateHistoryEntries(history, customers[1], [{ order: lane, rate: '3175' }], 'exported', '2026-11-05T12:00:00.000Z');
  assert.equal(history.length, 2, 'same lane and rate refreshes instead of duplicating');
  assert.equal(history.find(entry => entry.rate === '3175').savedAt, '2026-11-05T12:00:00.000Z');
});

test('a pickup window that already started is posted from now; an ended window is not posted', () => {
  // 11/04/2026 08:22 local + 30 min lead -> 08:52, rounded up to 09:00.
  const earliest = policy.getEarliestPickupSerial(new Date(2026, 10, 4, 8, 22));
  assert.equal(earliest, policy.toExcelDateTime('11/04/2026 0900'));
  // Exactly on a quarter hour stays put: 08:30 + 30 = 09:00.
  assert.equal(policy.getEarliestPickupSerial(new Date(2026, 10, 4, 8, 30)), policy.toExcelDateTime('11/04/2026 0900'));

  const started = policy.adjustPickupWindow(policy.toExcelDateTime('11/03/2026 0700'), policy.toExcelDateTime('11/04/2026 1000'), earliest);
  assert.deepEqual({ ...started }, { from: earliest, ended: false, moved: true }, 'Carthage -> Houston case');

  const future = policy.toExcelDateTime('11/10/2026 1900');
  assert.deepEqual({ ...policy.adjustPickupWindow(future, future, earliest) }, { from: future, ended: false, moved: false });

  const over = policy.adjustPickupWindow(policy.toExcelDateTime('11/03/2026 0700'), policy.toExcelDateTime('11/04/2026 0830'), earliest);
  assert.equal(over.ended, true);
});

test('removing capacity clears the truck and tracking, keeps the rate, and moves the load back to OPEN', () => {
  const booked = {
    ...load, id: '7', status: 'BOOKED', tag: 'BOOKED', rateInput: '3175', landstarComment: 'Load Ready now',
    driver: 'Alex Driver', driverPhone: '555-1111', truck: 'T-102', trailer: 'TR-208', pickupEta: '11/06 10:00', emptyLocation: 'Toledo, OH',
    bookedAt: '2026-11-04T12:00:00Z', trackingStage: 'Loaded', checkCalls: [{ at: 'x', stage: 'Loaded', note: '' }]
  };
  const open = policy.removeCapacity(booked);
  assert.equal(open.status, 'OPEN');
  assert.equal(open.tag, 'OPEN');
  for (const field of ['driver', 'driverPhone', 'truck', 'trailer', 'pickupEta', 'emptyLocation']) assert.equal(open[field], '', field);
  for (const field of ['bookedAt', 'trackingStage', 'checkCalls']) assert.equal(field in open, false, field);
  assert.equal(open.rateInput, '3175');
  assert.equal(open.landstarComment, 'Load Ready now');
});

test('a booked load shows Remove capacity, keeps its rate editable, and goes back to OPEN after confirming', () => {
  const app = createAppHarness(customers[0], [
    { ...load, id: '1', status: 'BOOKED', tag: 'BOOKED', driver: 'Alex Driver', truck: 'T-102', rateInput: '3175' }
  ], null, {}, { window: { confirm: () => true, location: { origin: 'http://localhost:5173' } } });
  app.enterRate('3300');
  app.render();
  assert.equal(app.states[6].rateInput, '3300', 'rate can be changed on a booked load');
  const button = app.find(node => node.type === 'button' && textOf(node).includes('Remove capacity'));
  assert.ok(button, 'Remove capacity button on booked loads');
  button.props.onClick();
  app.render();
  assert.equal(app.states[6].status, 'OPEN');
  assert.equal(app.states[6].driver, '');
  assert.equal(app.states[6].rateInput, '3300');
  assert.equal(app.find(node => node.type === 'button' && textOf(node).includes('Remove capacity')), null);
});

test('exported posting details use the Landstar board time format', () => {
  assert.equal(policy.excelSerialToBoardTime(policy.toExcelDateTime('11/06/2026 1300')), '11/06/26 13:00');
  assert.deepEqual({ ...policy.buildLandstarPosting({
    'Origin Zipcode(Required)': '60007', 'Destination Zipcode(Required)': '76063',
    'Pickup Date (Thru)(Required)': policy.toExcelDateTime('11/06/2026 1300'),
    'Delivery Date (Thru)(Required)': policy.toExcelDateTime('11/08/2026 0700'),
    'Weight(Required)': 42000
  }) }, { originZip: '60007', destZip: '76063', pickupThru: '11/06/26 13:00', deliveryThru: '11/08/26 07:00', weight: 42000 });
});

test('posted loads missing from a list are handed to the bot once, Nolan included; DAT screenshots never are', () => {
  const posting = { originZip: '60007', destZip: '76063', pickupThru: '11/06/26 13:00', deliveryThru: '11/08/26 07:00', weight: 42000 };
  const existing = [
    { ...load, id: '111111', status: 'ENT', tag: 'ENT', landstarExportedAt: new Date().toISOString(), landstarPosting: posting },
    { ...load, id: '222222', origCity: 'Denver', origSt: 'CO', status: 'ENT', tag: 'ENT', landstarExportedAt: new Date().toISOString(), landstarPosting: { ...posting, originZip: '80202' } },
    { ...load, id: '333333', origCity: 'Austin', origSt: 'TX' }
  ];
  const imported = [{ ...load, id: '111111' }];

  const result = policy.replaceImportedCustomerLoads(customers[0], imported, existing);
  assert.deepEqual(Array.from(result.droppedPostings, item => item.loadId), ['222222']);
  assert.equal(result.droppedPostings[0].posting.originZip, '80202');
  assert.equal(result.droppedPostings[0].customer, customers[0]);
  assert.equal(result.loads.some(item => item.id === '222222'), false, 'the dropped load is deleted from the TMS');
  assert.ok(result.loads.find(item => item.id === '111111').landstarPosting, 'loads still on the list keep their posting');

  assert.deepEqual(Array.from(policy.replaceImportedCustomerLoads(customers[2], imported, existing).droppedPostings, item => item.loadId), ['222222'], 'Nolan removals are automatic too');
  assert.equal(policy.replaceImportedCustomerLoads(customers[0], imported, existing, { reportDroppedPostings: false }).droppedPostings.length, 0);
  assert.equal(policy.findDroppedPostings(customers[1], [], existing).length, 0, 'an empty list never drops everything');
});

test('RXO ATZ van loads picking up in WI, IN, OH, MI, MN, SD, ND, UT or ID are skipped; nothing else is', () => {
  const rxo = 'R X O 2429200 - ATZ';
  const van = (origSt, eCode = 'V') => ({ ...load, origSt, eCode });
  for (const state of ['WI', 'IN', 'OH', 'MI', 'MN', 'SD', 'ND', 'UT', 'ID']) {
    assert.equal(policy.isRxoSkippedVanLoad(rxo, van(state)), true, state);
  }
  for (const eCode of ['V', 'VAN', 'VR', 'VT', '53 FT VAN']) assert.equal(policy.isRxoSkippedVanLoad(rxo, van('OH', eCode)), true, eCode);
  // Hazmat and tanker freight is never skipped.
  assert.equal(policy.isRxoSkippedVanLoad(rxo, van('OH', 'VZ')), false, 'VZ is a hazmat van');
  assert.equal(policy.isRxoSkippedVanLoad(rxo, { ...van('OH', 'VAN:VAN'), hazmat: 'true' }), false, 'hazmat');
  assert.equal(policy.isRxoSkippedVanLoad(rxo, { ...van('OH', 'VAN:VAN'), tanker: 'true' }), false, 'tanker');
  assert.equal(policy.isRxoSkippedVanLoad(rxo, van('OH', 'R')), false, 'reefer is not skipped');
  assert.equal(policy.isRxoSkippedVanLoad(rxo, van('OH', 'F')), false, 'flatbed is not skipped');
  assert.equal(policy.isRxoSkippedVanLoad(rxo, { ...van('IL'), destSt: 'OH' }), false, 'only the pickup state counts');
  assert.equal(policy.isRxoSkippedVanLoad('R X O 2429200 - ATZ P', van('OH')), false, 'ATZ P is not affected');
  assert.equal(policy.isRxoSkippedVanLoad(customers[0], van('OH')), false, 'other customers are not affected');
});

test('RXO ATZ imports leave out skipped-state van loads and clear older ones', () => {
  const rxo = 'R X O 2429200 - ATZ';
  const result = policy.replaceImportedCustomerLoads(rxo, [
    { ...load, id: '24590001', origCity: 'Columbus', origSt: 'OH', eCode: 'V' },
    { ...load, id: '24590002', origCity: 'Columbus', origSt: 'OH', eCode: 'R' },
    { ...load, id: '24590003', origCity: 'Atlanta', origSt: 'GA', eCode: 'V' },
    { ...load, id: '24590004', origCity: 'Columbus', origSt: 'OH', destCity: 'Memphis', destSt: 'TN', destZip: '38118', eCode: 'VAN:VAN', hazmat: 'true' }
  ], [
    { ...load, id: '24580000', origCity: 'Detroit', origSt: 'MI', eCode: 'V' },
    { ...load, id: '24580001', origCity: 'Detroit', origSt: 'MI', eCode: 'V', status: 'BOOKED', tag: 'BOOKED', driver: 'Alex' }
  ]);
  const ids = Array.from(result.loads, l => l.id).sort();
  assert.deepEqual(ids, ['24580001', '24590002', '24590003', '24590004'], 'OH van skipped, OH reefer and OH hazmat van kept, old MI van cleared, booked kept');
  assert.equal(result.skippedRxoVanCount, 1);
});

test('loads to or from Mexico are recognized by Mexican state or country code', () => {
  for (const [extra, expected] of [
    [{ origSt: 'TX', destSt: 'EM' }, true],
    [{ origSt: 'NX', destSt: 'TX' }, true],
    [{ origSt: 'JA', destSt: 'IL' }, true],
    [{ origSt: 'TX', destSt: 'TX', destCountry: 'MEX' }, true],
    [{ origSt: 'TX', destSt: 'CA' }, false],
    [{ origSt: 'ON', destSt: 'MI' }, false],
    [{ origSt: 'TX', destSt: '' }, false]
  ]) {
    assert.equal(policy.isMexicoLoad({ ...load, ...extra }), expected, JSON.stringify(extra));
  }
});

test('imports leave out loads to or from Mexico and clear older ones; booked loads stay', () => {
  const result = policy.replaceImportedCustomerLoads('R X O 2429200 - ATZ', [
    { ...load, id: '24590101', origCity: 'Laredo', origSt: 'TX', destCity: 'Monterrey', destSt: 'NX' },
    { ...load, id: '24590102', origCity: 'Laredo', origSt: 'TX', destCity: 'Dallas', destSt: 'TX' }
  ], [
    { ...load, id: '24580100', origCity: 'Toluca', origSt: 'EM', destCity: 'Dallas', destSt: 'TX' },
    { ...load, id: '24580101', origCity: 'Toluca', origSt: 'EM', destCity: 'Dallas', destSt: 'TX', status: 'BOOKED', tag: 'BOOKED', driver: 'Alex' }
  ]);
  assert.deepEqual(Array.from(result.loads, l => l.id).sort(), ['24580101', '24590102']);
  assert.equal(result.skippedMexicoCount, 1);
  assert.throws(() => policy.replaceImportedCustomerLoads('R X O 2429200 - ATZ', [
    { ...load, id: '24590103', origSt: 'TX', destSt: 'JA' }
  ], []), /Mexico/);
});

test('imported equipment and commodity text marks hazmat and tanker loads', () => {
  assert.equal(policy.getImportedHazmatTanker('Van Hazmat', ['HAZMAT CHEMICALS']).hazmat, 'true');
  assert.equal(policy.getImportedHazmatTanker('Van Hazmat', ['NON-HAZMAT CHEMICALS']).hazmat, 'true', 'hazmat equipment wins');
  assert.equal(policy.getImportedHazmatTanker('Van or Reefer - 53', ['HAZMAT CHEMICALS']).hazmat, 'true');
  assert.equal(policy.getImportedHazmatTanker('Van', ['NON-HAZMAT CHEMICALS']).hazmat, undefined);
  assert.equal(policy.getImportedHazmatTanker('Tanker', []).tanker, 'true');
  assert.deepEqual({ ...policy.getImportedHazmatTanker('Van - 53 Feet', ['CONSUMER GOODS']) }, {});
});

test('history copies are described by customer with load and booked counts', () => {
  assert.equal(policy.describeLoadListSummary({
    'Para 1522166 - ATZ': { loads: 27, booked: 0 },
    'R X O 2429200 - ATZ': { loads: 2463, booked: 1 },
    'Nolan 965974 - ATZ H': { loads: 0, booked: 0 }
  }), 'R X O 2429200 - ATZ: 2,463 loads (1 booked) · Para 1522166 - ATZ: 27 loads');
  assert.equal(policy.describeLoadListSummary({ X: { loads: 1, booked: 0 } }), 'X: 1 load');
  assert.equal(policy.describeLoadListSummary({}), 'Empty list');
  assert.equal(policy.describeLoadListSummary(null), 'No details');
});

test('intermodal (INT) loads are never imported, from any source, and older ones are cleared', () => {
  for (const value of ['INT', 'Int', 'Intermodal', 'INTER MODAL', 'Van, INT']) {
    assert.equal(policy.isSkippableEquipment(value), true, value);
  }
  for (const value of ['Van', 'Reefer', 'Flatbed', 'Interstate Van', 'PRINT']) {
    assert.equal(policy.isSkippableEquipment(value), false, value);
  }
  const result = policy.replaceImportedCustomerLoads('Para 1522166 - ATZ', [
    { ...load, id: '2290001', eCode: 'INT' },
    { ...load, id: '2290002', eCode: 'V', destCity: 'Memphis', destSt: 'TN', destZip: '38118' }
  ], [
    { ...load, id: '2280001', eCode: 'INT', origCity: 'Dallas', origSt: 'TX' }
  ]);
  assert.deepEqual(Array.from(result.loads, l => l.id), ['2290002']);
  assert.equal(result.skippedEquipmentCount, 1);
});

test('the Team switch decides team, overriding team equipment codes', () => {
  assert.equal(policy.isTeamLoad({ eCode: 'V', team: 'true' }), true);
  assert.equal(policy.isTeamLoad({ eCode: 'VM', team: 'false' }), false, 'switched off on a team van');
  assert.equal(policy.isTeamLoad({ eCode: 'VM' }), true, 'team equipment defaults to team');
  assert.equal(policy.isTeamLoad({ eCode: 'V' }), false);
  const app = createAppHarness(customers[0], [{ ...load, eCode: 'V' }]);
  const team = app.find(node => node.props?.id === 'load-team');
  assert.equal(team.type, 'select');
  assert.equal(typeof team.props.onChange, 'function');
});

test('dragging a customer onto another moves it to that spot', () => {
  const list = ['A', 'B', 'C', 'D'];
  assert.deepEqual([...policy.moveCustomer(list, 'D', 'B')], ['A', 'D', 'B', 'C']);
  assert.deepEqual([...policy.moveCustomer(list, 'A', 'C')], ['B', 'C', 'A', 'D']);
  assert.equal(policy.moveCustomer(list, 'A', 'A'), list);
  assert.equal(policy.moveCustomer(list, 'X', 'A'), list);
});

test('a customer list split across tabs imports every load tab and skips summary tabs', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Order #', 'Equipment', 'Origin City'], ['111111', 'V', 'Chicago']]), 'Page 1');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Totals'], ['2 loads']]), 'Summary');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Load ID', 'Equipment', 'Origin City'], ['222222', 'V', 'Denver']]), 'Page 2');
  assert.deepEqual(Array.from(policy.getLoadSheetNames(workbook, XLSX)), ['Page 1', 'Page 2']);

  const noHeaders = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(noHeaders, XLSX.utils.aoa_to_sheet([['111111', 'V']]), 'Only');
  assert.deepEqual(Array.from(policy.getLoadSheetNames(noHeaders, XLSX)), ['Only'], 'the first tab is always read, as before');
});

test('importing all of a customer\'s files together removes only postings on none of them', () => {
  const posting = { originZip: '60007', destZip: '76063', pickupThru: '11/06/26 13:00', deliveryThru: '11/08/26 07:00', weight: 42000 };
  const exportedAt = new Date().toISOString();
  const existing = ['111111', '222222', '333333'].map((id, index) => ({
    ...load, id, origCity: ['Chicago', 'Denver', 'Austin'][index], status: 'ENT', tag: 'ENT', landstarExportedAt: exportedAt, landstarPosting: { ...posting, weight: 42000 + index }
  }));
  const fileOne = [{ ...load, id: '111111' }];
  const fileTwo = [{ ...load, id: '222222', origCity: 'Denver' }];

  // One file at a time treats that file as the whole list.
  assert.deepEqual(Array.from(policy.replaceImportedCustomerLoads(customers[0], fileTwo, existing).droppedPostings, item => item.loadId), ['111111', '333333']);
  // Both files together: only the load on neither file is removed.
  assert.deepEqual(Array.from(policy.replaceImportedCustomerLoads(customers[0], [...fileOne, ...fileTwo], existing).droppedPostings, item => item.loadId), ['333333']);
});

test('Excel import of several files at once only queues removal for postings on none of them', async () => {
  const header = ['Order Number', 'Equipment Type', '', '', '', '', 'Origin City', 'Origin State', 'Origin Zip',
    '', '', 'Destination City', 'Destination State', 'Destination Zip', 'Weight', '',
    'Pickup Time', 'Delivery Time', 'Miles'];
  const row = (id, city) => [id, 'Reefer - 53', '', '', '', '', city, 'IL', '60601', '', '', 'Dallas', 'TX',
    '75201', '42000', '', '11/27/2026 0800 - 1600', '11/30/2026 0800 - 1600', '900'];
  const posting = { originZip: '60601', destZip: '75201', pickupThru: '11/27/26 16:00', deliveryThru: '11/30/26 16:00', weight: 42000 };
  const exportedAt = new Date().toISOString();
  const existing = [['910001', 'CHICAGO'], ['910002', 'ELGIN'], ['910003', 'JOLIET']].map(([id, city]) => ({
    ...load, id, eCode: 'R', origCity: city, origSt: 'IL', origZip: '60601', destCity: 'DALLAS', destSt: 'TX', destZip: '75201',
    pickupTime: '11/27/2026 0800 - 1600', deliveryTime: '11/30/2026 0800 - 1600',
    status: 'ENT', tag: 'ENT', landstarExportedAt: exportedAt, landstarPosting: posting
  }));

  const app = createAppHarness(customers[1], existing, null, {}, { AbortController, setTimeout, clearTimeout });
  await app.importExcelFiles([[header, row('910001', 'Chicago')], [header, row('910002', 'Elgin')]]);
  const queue = JSON.parse(app.storage.get('landstar_unpostQueue') || '[]');
  assert.deepEqual(queue.map(item => item.loadId), ['910003']);
  assert.ok(app.alerts.some(message => message.includes('Combined into one list: 2 file(s), 2 tab(s)')));
});

test('Copy driver info puts the driver details in the dispatch-chat format', () => {
  const booked = {
    ...load, id: '24504425', driver: 'David Rickey', driverPhone: '405-637-5233', truck: '583902', trailer: '668004',
    emptyLocation: 'Toledo, OH', pickupEta: '11/06/2026 10:00'
  };
  assert.equal(policy.formatDriverInfo(booked), [
    'Driver 1', 'David Rickey', '405-637-5233',
    'Tractor 1', '583902',
    'Trailer 1', '668004',
    'Previous Empty', 'Toledo, OH',
    'Pickup ETA', '11/06/2026 10:00',
    'load#24504425'
  ].join('\n'));
  assert.equal(policy.formatDriverInfo({ ...load, id: '7', driver: 'Sam', driverPhone: '', truck: '12', trailer: '', emptyLocation: '', pickupEta: '' }),
    'Driver 1\nSam\nTractor 1\n12\nload#7', 'blank sections are left out');
});

test('Copy Order # by the title also copies the previous empty location', () => {
  assert.equal(policy.formatOrderCopy({ ...load, id: '24581209', emptyLocation: 'Toledo, OH' }), '24581209\nToledo, OH');
  assert.equal(policy.formatOrderCopy({ ...load, id: '24581209', emptyLocation: '  ' }), '24581209', 'no empty location: just the order #');
});

test('the bot light shows upload progress and what the bot is working on', () => {
  assert.equal(policy.describeBotProgress({ state: 'uploading', message: 'Uploading R_X_O_2429200___ATZ_9of108', progress: { uploaded: 12, waiting: 94 } }),
    '12 uploaded · 94 waiting · Uploading file 9 of 108');
  assert.equal(policy.describeBotProgress({ state: 'logged-in', message: 'Watching for exports · last upload 10:05 AM', progress: { uploaded: 106, waiting: 0 } }),
    '106 uploaded', 'idle messages are not repeated');
  assert.equal(policy.describeBotProgress({ state: 'logged-in', message: 'Watching for exports' }), '');
});

test('a customer rule only applies to its exact account, not one with the same name and number', () => {
  assert.equal(policy.isNolanCustomer('Nolan 965974 - ATZ H'), true);
  assert.equal(policy.isNolanCustomer('Nolan 965974 - ATZ'), false, 'a different Nolan account');
  assert.equal(policy.isParaCustomer('Para 1522166 - ATZ'), true);
  assert.equal(policy.isParaCustomer('Para 1522166 - ATZ H'), false, 'Para ATZ H is its own account');
  assert.equal(policy.preservesImportedLoadStatus('Para 1522166 - ATZ'), true);
  // Every Para, RXO and Nolan account imports its full list (dropped loads are deleted).
  for (const account of ['Para 1522166 - ATZ H', 'R X O 2429200 - ATZ', 'R X O 2429200 - ATZ P', 'Nolan 965974 - ATZ', 'Nolan 965974 - ATZ H']) {
    assert.equal(policy.preservesImportedLoadStatus(account), true, account);
  }
  assert.equal(policy.preservesImportedLoadStatus('Para 1522166'), false, 'not an account name');
  const vanInOhio = { origSt: 'OH', eCode: 'VAN:VAN' };
  assert.equal(policy.isRxoSkippedVanLoad('R X O 2429200 - ATZ', vanInOhio), true);
  assert.equal(policy.isRxoSkippedVanLoad('R X O 2429200 - ATZ P', vanInOhio), false, 'the RXO van rule is ATZ only');
});

test('RXO ATZ van loads priced from DAT export under the DAT rate, by tier', () => {
  const rxo = 'R X O 2429200 - ATZ';
  const van = { eCode: 'VAN:VAN', rateSource: 'dat-api' };
  const discount = (rate, load = van, customer = rxo) => policy.getRxoAtzDatVanDiscount(customer, load, rate);
  assert.equal(discount(999), 50);
  assert.equal(discount(1000), 100);
  assert.equal(discount(1599), 100);
  assert.equal(discount(1600), 200);
  assert.equal(discount(3500), 200);
  assert.equal(discount(3501), 300);
  assert.equal(discount(1200, { ...van, rateSource: 'dat-screenshot' }), 100, 'DAT screenshot rates count too');
  assert.equal(discount(1200, { ...van, rateSource: 'user-entered' }), 0, 'rates you typed are posted as entered');
  assert.equal(discount(1200, { ...van, eCode: 'R' }), 0, 'van loads only');
  assert.equal(discount(1200, { ...van, hazmat: 'true' }), 0, 'hazmat keeps the full rate');
  assert.equal(discount(1200, van, 'R X O 2429200 - ATZ P'), 0, 'RXO ATZ only, not ATZ P');
});

test('RXO ATZ loads that pick up and deliver in the same city are not exported', () => {
  const load = { origCity: 'Chicago', origSt: 'IL', destCity: 'CHICAGO', destSt: 'IL' };
  assert.equal(policy.isRxoSameCityLoad('R X O 2429200 - ATZ', load), true);
  assert.equal(policy.isRxoSameCityLoad('R X O 2429200 - ATZ', { ...load, destCity: 'Joliet' }), false);
  assert.equal(policy.isRxoSameCityLoad('R X O 2429200 - ATZ', { ...load, destSt: 'IN' }), false, 'same name, other state');
  assert.equal(policy.isRxoSameCityLoad('R X O 2429200 - ATZ P', load), false, 'RXO ATZ only');
});

test('Para ATZ H screenshots put red order numbers on hold too; other customers stay open', () => {
  const red = { ...load, id: '2283633', pickupTime: '11/30/2026 0800', screenshotStatus: 'ON HOLD' };
  const atzH = policy.replaceImportedCustomerLoads('Para 1522166 - ATZ H', [red], []);
  assert.equal(atzH.loads[0].status, 'ON HOLD');
  assert.equal(atzH.loads[0].tag, 'HOLD');
  const rxo = policy.replaceImportedCustomerLoads('R X O 2429200 - ATZ', [red], []);
  assert.equal(rxo.loads[0].status, 'OPEN', 'red holds are only for the Para accounts');
});

test('a load added by hand stays until you delete it', () => {
  const manual = policy.createManualLoad('2283650', {
    origCity: 'GREEN BAY', origSt: 'WI', origZip: '54313', destCity: 'OREGON', destSt: 'OH', destZip: '43616',
    pickupTime: '11/06/2026 0700 - 1430', deliveryTime: '11/09/2026 0800 - 1400',
    status: 'ENT', tag: 'ENT', landstarExportedAt: '2026-09-01T00:00:00Z',
    landstarPosting: { originZip: '54313', destZip: '43616', pickupThru: '11/06/26 14:30' }
  });
  assert.equal(manual.manualEntry, true);
  // Full-list import (Para ATZ replaces its list) without this load: it is kept.
  const other = { ...load, id: '2283633', pickupTime: '11/30/2026 0800' };
  const result = policy.replaceImportedCustomerLoads('Para 1522166 - ATZ', [other], [manual]);
  assert.ok(result.loads.some(order => order.id === '2283650'), 'not removed by the import');
  assert.deepEqual(result.droppedPostings, [], 'its Landstar posting is not sent for removal');
  assert.deepEqual(policy.findDroppedPostings('Para 1522166 - ATZ H', [other], [manual]), []);
  // Exported long ago: still not expired.
  const now = Date.parse('2026-11-05T00:00:00Z');
  assert.equal(policy.removeExpiredExportedLoads({ c: [manual] }, now).c.length, 1);
});

test('miles are estimated from the two ZIPs when Google Routes cannot answer', () => {
  const zipData = zipcodes;
  // Green Bay, WI -> Oregon, OH: about 308 straight-line miles, times 1.2 for roads.
  assert.equal(policy.estimateRoadMilesFromZips(zipData, '54313', '43616'), '370');
  assert.equal(policy.estimateRoadMilesFromZips(zipData, '54313', ''), '', 'needs both ZIPs');
  assert.equal(policy.estimateRoadMilesFromZips(zipData, '54313', '00000'), '', 'unknown ZIP');
});

test('Google miles are looked up once per lane and reused after that', async () => {
  const storage = new Map();
  let lookups = 0;
  const lanePolicy = { module: { exports: {} } };
  vm.runInNewContext(code, {
    ...lanePolicy,
    require: context.require,
    console,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch: async () => {
      lookups += 1;
      return { ok: true, json: async () => ({ miles: 441 }) };
    }
  });
  const { getGoogleRoadMiles, getRoadMilesLaneKey } = lanePolicy.module.exports;
  const greenBay = { id: '1', origCity: 'GREEN BAY', origSt: 'WI', origZip: '54313', destCity: 'OREGON', destSt: 'OH', destZip: '43616' };
  assert.equal(getRoadMilesLaneKey(greenBay), '54313>43616');
  assert.equal(await getGoogleRoadMiles(greenBay), '441');
  assert.equal(await getGoogleRoadMiles({ ...greenBay, id: '2' }), '441');
  assert.equal(lookups, 1, 'the second load on the lane reuses the saved miles');
  await getGoogleRoadMiles({ ...greenBay, destZip: '43604', destCity: 'TOLEDO' });
  assert.equal(lookups, 2, 'a different lane asks Google');
  assert.equal(getRoadMilesLaneKey({ origCity: 'Chicago', origSt: 'IL', destCity: 'Dallas', destSt: 'TX' }), 'CHICAGO,IL>DALLAS,TX', 'no ZIPs: city and state');
});

test('booking sends the truck and the exported posting to the bot for Landstar Assign Capacity', () => {
  const posting = { originZip: '07032', destZip: '32207', pickupThru: '11/06/26 15:00', deliveryThru: '11/09/26 11:00', weight: 38000 };
  const booked = { ...load, id: '2283600', truck: ' 420371 ', driver: 'David Carter', status: 'BOOKED', landstarPosting: posting };
  const { item } = policy.buildAssignRequest('Para 1522166 - ATZ H', booked);
  assert.equal(item.truck, '420371');
  assert.equal(item.loadId, '2283600');
  assert.deepEqual({ ...item.posting }, posting);
  assert.match(policy.buildAssignRequest('Para 1522166 - ATZ H', { ...booked, truck: '' }).reason, /no truck number/);
  assert.match(policy.buildAssignRequest('Para 1522166 - ATZ H', { ...booked, landstarPosting: undefined }).reason, /not posted to Landstar by the bot/);

  const ok = policy.applyAssignResult({ ...booked, notes: 'Call before' }, { ok: true, truck: '420371', landstarLoadId: '187371843', message: 'Assigned 420371 - LDWY Rocway Xpress LLC to Landstar load #187371843', at: 1 });
  assert.equal(ok.landstarAssignment.ok, true);
  assert.equal(ok.notes, 'Call before\nLandstar: Assigned 420371 - LDWY Rocway Xpress LLC to Landstar load #187371843');
  const failed = policy.applyAssignResult(booked, { ok: false, truck: '420371', message: 'no BCO found with tractor 420371', at: 2 });
  assert.match(failed.notes, /NOT assigned - no BCO found/);
});

test('Paramount tracking emails: both Para accounts, the right emails at the right time', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  const booked = { ...load, id: '2283600', status: 'BOOKED', truck: '420371', driver: 'DAVID CARTER', origCity: 'KEARNY', origSt: 'NJ', destCity: 'JACKSONVILLE', destSt: 'FL', bookedAt: '2026-11-06T10:00:00Z', notes: '' };
  const watch = policy.getParamountWatchList({
    'Para 1522166 - ATZ': [booked, { ...booked, id: '1', status: 'OPEN' }, { ...booked, id: '2', truck: '' }],
    'Para 1522166 - ATZ H': [{ ...booked, id: '3' }, { ...booked, id: '4', trackingStage: 'Delivered' }, { ...booked, id: '5', bookedAt: '2026-10-20T10:00:00Z' }],
    'R X O 2429200 - ATZ': [{ ...booked, id: '6' }]
  }, now);
  assert.deepEqual([...watch.map(item => item.key)], ['Para 1522166 - ATZ|2283600', 'Para 1522166 - ATZ H|3']);
  assert.equal(watch[0].truck, '420371');
  assert.equal(policy.isParamountTrackingCustomer('Para 1522166 - ATZ P'), false);

  const info = {
    key: 'Para 1522166 - ATZ|2283600', customer: 'Para 1522166 - ATZ', loadId: '2283600', ok: true, at: 5,
    freightBill: '4431900', trackingLink: 'https://clarity.landstaronline.com/customer?token=abc%2B1', driver: 'David Carter',
    pickupCity: 'Kearny, NJ', deliveryCity: 'Jacksonville, FL', pickupTimezone: 'America/New_York', deliveryTimezone: 'America/New_York',
    pickupEta: '2026-11-06T13:00:00Z', pickupScheduled: '2026-11-06T13:00:00Z', arrivedShipperAt: null, leftShipperAt: null
  };
  assert.deepEqual([...policy.getDueParamountEmails(booked, { ...info, trackingLink: '' })], [], 'no link yet: wait');
  assert.deepEqual([...policy.getDueParamountEmails(booked, info)], ['initial']);
  const first = policy.buildParamountEmail('initial', booked, info, { greetingName: 'Heather', phone: '4845756486' });
  assert.match(first, /^Hi Heather and team,/);
  assert.match(first, /order 2283600/);
  assert.match(first, /customer\?token=abc%2B1/);
  assert.match(first, /scheduled to pick up in Kearny, NJ\./, 'no ETA from Clarity');
  assert.doesNotMatch(first, /estimated arrival/);
  const typed = policy.buildParamountEmail('initial', { ...booked, pickupEta: '11/06/2026 09:30' }, info, { greetingName: 'Heather' });
  assert.match(typed, /pick up in Kearny, NJ, with an estimated arrival of 11\/06\/2026 09:30\./, 'the ETA typed in the TMS');
  assert.match(first, /484-575-6486/);

  const sent = policy.markParamountEmail(policy.applyParamountTrackingInfo(booked, info), 'initial', { at: '2026-11-06T12:01:00Z' });
  assert.equal(sent.paramountTracking.freightBill, '4431900');
  assert.match(sent.notes, /Paramount email sent: tracking link/);
  assert.deepEqual([...policy.getDueParamountEmails(sent, info)], [], 'nothing new');
  const arrived = { ...info, arrivedShipperAt: '2026-11-06T13:05:00Z' };
  assert.deepEqual([...policy.getDueParamountEmails(sent, arrived)], ['arrived']);
  assert.equal(policy.applyParamountTrackingInfo(sent, arrived).trackingStage, 'At Pickup');
  const left = { ...arrived, leftShipperAt: '2026-11-06T15:00:00Z', deliveryEta: '2026-11-07T14:00:00Z' };
  assert.deepEqual([...policy.getDueParamountEmails(sent, left)], ['departed'], 'left before the arrived email went out: one email covers both');
  assert.equal(policy.applyParamountTrackingInfo(sent, left).trackingStage, 'Loaded');
  assert.match(policy.buildParamountEmail('departed', booked, left), /left the shipper in Kearny, NJ .*heading to Jacksonville, FL\. The estimated arrival at delivery is 11\/07 at 09:00 EST/);
  const done = policy.markParamountEmail(sent, 'departed');
  assert.equal(done.paramountTracking.emails.arrived.skipped, true);
  assert.deepEqual([...policy.getDueParamountEmails(done, left)], []);

  assert.equal(policy.greetingNameFrom('Heather Locke <heather.locke@rlglobal.com>'), 'Heather');
  assert.equal(policy.greetingNameFrom('"Locke, Heather" <heather.locke@rlglobal.com>'), 'Heather');
  assert.equal(policy.greetingNameFrom('afterhoursatrltruckload@rlglobal.com'), '');
});

test('RXO update requests: reply with status, location, typed pickup ETA and tracking link', () => {
  const booked = { ...load, id: '24474092', status: 'BOOKED', truck: '583737', origCity: 'COEYMANS', origSt: 'NY', destCity: 'PITTSTON', destSt: 'PA', notes: '' };
  const map = {
    'R X O 2429200 - ATZ': [booked, { ...booked, id: '24474085', status: 'OPEN' }],
    'R X O 2429200 - ATZ P': [{ ...booked, id: '24544189' }],
    'R X O 2429200 - ATZ H': [{ ...booked, id: '1' }]
  };
  assert.deepEqual([...policy.getRxoWatchList(map).map(item => `${item.customer}|${item.loadId}|${item.billTo}`)],
    ['R X O 2429200 - ATZ|24474092|rxo', 'R X O 2429200 - ATZ P|24544189|rxo']);
  assert.equal(policy.findRxoLoadForRequest(map, '24544189').customer, 'R X O 2429200 - ATZ P');
  assert.equal(policy.findRxoLoadForRequest(map, '24474085'), null, 'not booked');
  assert.equal(policy.findRxoLoadForRequest(map, '99999999'), null, 'not your load');

  const tracking = {
    freightBill: '4431900', trackingLink: 'https://clarity.landstaronline.com/customer?token=t', pickupCity: 'Coeymans, NY',
    deliveryCity: 'Pittston, PA', lastLocation: 'Albany, NY', lastLocationAt: '2026-11-06T12:30:00Z', pickupTimezone: 'America/New_York',
    pickupEta: '2026-11-06T13:00:00Z'
  };
  let email = policy.buildRxoUpdateEmail(booked, tracking);
  assert.match(email.text, /order 24474092/);
  assert.match(email.text, /empty and heading to the shipper in Coeymans, NY/);
  assert.match(email.text, /Current location: Albany, NY \(as of 11\/06 at 07:30 EST\)/);
  assert.match(email.text, /Pickup ETA: ____/, 'never Clarity\'s pickup ETA');
  assert.match(email.text, /Live tracking: https:\/\/clarity/);
  assert.equal(email.complete, false, 'missing pickup ETA: never sent on its own');
  email = policy.buildRxoUpdateEmail({ ...booked, pickupEta: '11/06/2026 09:00' }, tracking);
  assert.match(email.text, /Pickup ETA: 11\/06\/2026 09:00/);
  assert.equal(email.complete, true);
  email = policy.buildRxoUpdateEmail(booked, { ...tracking, leftShipperAt: 'done', deliveryEta: '2026-11-06T18:00:00Z', deliveryTimezone: 'America/New_York' });
  assert.match(email.text, /loaded and on the way to Pittston, PA/);
  assert.match(email.text, /Delivery ETA: 11\/06 at 13:00 EST/);
  assert.doesNotMatch(email.text, /Pickup ETA/);
  assert.equal(email.complete, true);
  assert.equal(policy.buildRxoUpdateEmail(booked, {}).complete, false, 'not found in Clarity yet');
});

test('no paperwork yet: the driver gets one reminder each morning for a week, about the 48-hour chargeback', () => {
  const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
  const tracking = { freightBill: '4574648', deliveredAt: new Date(at(9, 10)).toISOString(), deliveryCity: 'Jacksonville, FL' };
  const delivered = policy.markDriverEmail({ ...load, id: '2283600', status: 'BOOKED', driver: 'DAVID CARTER', trackingStage: 'Delivered', notes: '' },
    'pod', { at: new Date(at(9, 10, 5)).toISOString() });
  const due = (l, now) => [...policy.getDueDriverEmails(l, tracking, now)];
  assert.deepEqual(due(delivered, at(9, 18)), [], 'the POD email already went out today');
  assert.deepEqual(due(delivered, at(10, 6, 59)), [], 'before 7 AM');
  assert.deepEqual(due(delivered, at(10, 7)), ['podReminder']);
  const reminded = policy.markDriverEmail(delivered, 'podReminder', { at: new Date(at(10, 7)).toISOString() });
  assert.deepEqual(due(reminded, at(10, 15)), [], 'one reminder a day');
  assert.deepEqual(due(reminded, at(11, 7, 2)), ['podReminder'], 'next morning again');
  assert.deepEqual(due(reminded, at(17, 8)), [], 'stops a week after delivery');
  assert.deepEqual(due({ ...reminded, paperworkReceivedAt: new Date(at(10, 9)).toISOString() }, at(11, 8)), [], 'paperwork in: no more reminders');
  const text = policy.buildDriverEmail('podReminder', delivered, tracking);
  assert.match(text, /^Hi David,\n\nReminder: I still need the signed POD \/ paperwork for load 4574648 delivered in Jacksonville, FL\./);
  assert.match(text, /within 48 hours of delivery, or the customer can charge back/);
  assert.doesNotMatch(text, /TRACKING APP/);
  assert.match(policy.buildDriverEmail('pod', delivered, tracking), /within 48 hours of delivery/);
});

test('paperwork status, completed only once it is in and handled, and the customer email', () => {
  const at = (day, hour) => new Date(2026, 10, day, hour).getTime();
  const delivered = { ...load, trackingStage: 'Delivered', paramountTracking: { deliveredAt: new Date(at(9, 10)).toISOString() } };
  assert.equal(policy.getDeliveredAt(delivered), at(9, 10));
  assert.equal(policy.getDeliveredAt({ ...load, trackingStage: 'Delivered', checkCalls: [{ at: new Date(at(9, 12)).toISOString(), stage: 'Delivered' }] }), at(9, 12));
  assert.match(policy.getPaperworkStatus(delivered, at(9, 15)).text, /delivered 5h ago · due in 43h/);
  assert.equal(policy.getPaperworkStatus(delivered, at(10, 11)).level, 'due');
  assert.equal(policy.getPaperworkStatus(delivered, at(11, 11)).level, 'late');
  const received = { ...delivered, paperworkReceivedAt: new Date(at(10, 9)).toISOString(), paperworkDone: false };
  assert.match(policy.getPaperworkStatus(received).text, /waiting for you to send it to the customer/);
  assert.equal(policy.isBookedLoadComplete(received), false, 'the forward to the customer is still waiting');
  assert.equal(policy.isBookedLoadComplete({ ...received, paperworkDone: true, paperworkSentAt: 'x' }), true);
  assert.equal(policy.getPaperworkTarget('Para 1522166 - ATZ H'), 'paramount');
  assert.equal(policy.getPaperworkTarget('R X O 2429200 - ATZ'), 'rxo');
  assert.equal(policy.getPaperworkTarget('Other customer'), '');
  const email = policy.buildPaperworkEmail({ ...load, id: '2282980' }, { deliveryCity: 'Knightdale, NC' }, { greetingName: 'Heather' });
  assert.match(email, /^Hi Heather,\n\nAttached is the signed POD \/ paperwork for order #2282980, delivered in Knightdale, NC\./);
});

test('driver emails: 7 AM on pickup day, after pickup, 7 AM on delivery day, POD after delivery', () => {
  const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
  const booked = {
    ...load, id: '2283600', status: 'BOOKED', truck: '420371', driver: 'DAVID CARTER', origCity: 'KEARNY', origSt: 'NJ',
    destCity: 'JACKSONVILLE', destSt: 'FL', pickupTime: '11/06/2026 0800 - 1500', deliveryTime: '11/09/2026 0000 - 1100',
    bookedAt: new Date(at(5, 16)).toISOString(), notes: ''
  };
  const tracking = { freightBill: '4574648', pickupCity: 'Kearny, NJ', deliveryCity: 'Jacksonville, FL' };
  const due = (l, t, now) => [...policy.getDueDriverEmails(l, t, now)];
  assert.deepEqual(due(booked, {}, at(6, 8)), [], 'no freight bill from Clarity yet: no BCO thread to reply in');
  assert.deepEqual(due(booked, tracking, at(5, 20)), ['dispatch'], 'right after dispatch');
  const dispatchText = policy.buildDriverEmail('dispatch', booked, tracking, { customer: 'Para 1522166 - ATZ H' });
  assert.match(dispatchText, /^Hi David,\n\n\*\*\* IMPORTANT: PLEASE TURN ON THE TRUCKER TOOLS TRACKING APP NOW \*\*\*/);
  assert.match(dispatchText, /Thank you for taking load 4574648! Pickup is in Kearny, NJ \(appointment 11\/06\/2026 0800 - 1500\) and delivery is in Jacksonville, FL/);
  assert.match(dispatchText, /confirm you received the load details/);
  const dispatched = policy.markDriverEmail(booked, 'dispatch', { at: new Date(at(5, 20)).toISOString() });
  assert.deepEqual(due(dispatched, tracking, at(5, 21)), [], 'day before pickup');
  assert.deepEqual(due(dispatched, tracking, at(6, 6, 59)), [], 'before 7 AM');
  assert.deepEqual(due(dispatched, tracking, at(6, 7)), ['pickupMorning']);
  const dispatchedThisMorning = policy.markDriverEmail(booked, 'dispatch', { at: new Date(at(6, 8)).toISOString() });
  assert.deepEqual(due(dispatchedThisMorning, tracking, at(6, 9)), [], 'dispatch email went out this morning: no morning check too');
  assert.deepEqual(due(policy.markDriverEmail(booked, 'pickupMorning'), tracking, at(6, 9)), [], 'morning check already sent: no dispatch email');
  const morningText = policy.buildDriverEmail('pickupMorning', booked, tracking);
  assert.match(morningText, /^Good morning David!/);
  assert.match(morningText, /load 4574648, picking up today in Kearny, NJ \(appointment 11\/06\/2026 0800 - 1500\)/);
  assert.match(morningText, /ETA to the shipper/);
  assert.match(morningText, /Daniel Gomez\nLandstar/);

  let sent = policy.markDriverEmail(booked, 'pickupMorning', { at: new Date(at(6, 7)).toISOString() });
  assert.deepEqual(due(sent, tracking, at(6, 9)), []);
  const loaded = { ...tracking, leftShipperAt: '2026-11-06T15:00:00Z' };
  assert.deepEqual(due(sent, loaded, at(6, 11)), ['pickedUp']);
  assert.match(policy.buildDriverEmail('pickedUp', booked, loaded), /ETA for delivery in Jacksonville, FL/);
  sent = policy.markDriverEmail(sent, 'pickedUp', { at: new Date(at(6, 11)).toISOString() });
  assert.deepEqual(due(sent, loaded, at(8, 9)), [], 'day before delivery');
  assert.deepEqual(due(sent, loaded, at(9, 7, 5)), ['deliveryMorning']);
  assert.match(policy.buildDriverEmail('deliveryMorning', booked, loaded), /Load 4574648 delivers today in Jacksonville, FL/);
  sent = policy.markDriverEmail(sent, 'deliveryMorning');
  assert.deepEqual(due(sent, loaded, at(9, 9)), []);
  assert.deepEqual(due(sent, { ...loaded, deliveredAt: 'done' }, at(9, 12)), ['pod']);
  assert.deepEqual(due({ ...sent, trackingStage: 'Delivered' }, loaded, at(9, 12)), ['pod'], 'marked delivered by hand');
  assert.match(policy.buildDriverEmail('pod', booked, loaded), /send the signed POD/);
  sent = policy.markDriverEmail(sent, 'pod');
  assert.deepEqual(due(sent, { ...loaded, deliveredAt: 'done' }, at(9, 13)), []);
  assert.match(sent.notes, /Driver email sent: Delivered: send the POD/);

  const sameDay = { ...booked, deliveryTime: '11/06/2026 1700 - 1800' };
  const pickedToday = policy.markDriverEmail(sameDay, 'pickedUp', { at: new Date(at(6, 12)).toISOString() });
  assert.deepEqual(due(pickedToday, loaded, at(6, 13)), [], 'same-day delivery: the picked-up email already asked for the ETA');

  const watch = policy.getTrackingWatchList({
    'Para 1522166 - ATZ': [booked], 'R X O 2429200 - ATZ': [{ ...booked, id: '2' }], 'Nolan 965974': [{ ...booked, id: '3' }, { ...booked, id: '4', status: 'OPEN' }]
  }, at(6, 8));
  assert.deepEqual([...watch.map(item => `${item.loadId}|${item.billTo}`)], ['2283600|paramount', '2|rxo', '3|any']);
  assert.equal(policy.applyParamountTrackingInfo(booked, { ok: true, deliveredAt: 'done', leftShipperAt: 'done' }).trackingStage, 'Delivered');
});

test('driver emails tell the driver to turn on the customer\'s tracking app, at the top', () => {
  const booked = { ...load, id: '24466147', status: 'BOOKED', driver: 'ISMAEL BAILON', origCity: 'ABILENE', origSt: 'TX', destCity: 'SAN ANTONIO', destSt: 'TX', pickupTime: '11/10/2026 1300' };
  const tracking = { freightBill: '4532973' };
  const rxo = policy.buildDriverEmail('pickupMorning', booked, tracking, { customer: 'R X O 2429200 - ATZ P' });
  assert.match(rxo, /^Good morning Ismael!\n\n\*\*\* IMPORTANT: PLEASE TURN ON THE MACROPOINT TRACKING APP NOW \*\*\*\nKeep MacroPoint on and tracking for the ENTIRE trip/);
  const para = policy.buildDriverEmail('pickedUp', booked, tracking, { customer: 'Para 1522166 - ATZ H' });
  assert.match(para, /^Hi Ismael,\n\n\*\*\* IMPORTANT: PLEASE TURN ON THE TRUCKER TOOLS TRACKING APP NOW \*\*\*/);
  assert.match(policy.buildDriverEmail('deliveryMorning', booked, tracking, { customer: 'Para 1522166 - ATZ' }), /TRUCKER TOOLS/);
  assert.match(policy.buildDriverEmail('pickupMorning', booked, tracking, { customer: 'Nolan 965974' }), /PLEASE TURN ON YOUR TRACKING APP NOW/);
  assert.doesNotMatch(policy.buildDriverEmail('pod', booked, tracking, { customer: 'R X O 2429200 - ATZ' }), /IMPORTANT/, 'not after delivery');
});

test('a driver ETA reply becomes an update on Paramount\'s email thread', () => {
  const reply = '11:00 to 11:30 am Get Outlook for iOS From: Daniel Urdaneta-Gomez <trucks1224@gmail.com> Sent: Friday, 06 November 2026 09:10:32 To: rocwayxpress@hotmail.com';
  assert.equal(policy.findDriverEta(reply), '11:00 to 11:30 AM');
  assert.equal(policy.findDriverEta('Yes sir, ETA 1130'), '11:30');
  assert.equal(policy.findDriverEta('be there around 2pm'), '2:00 PM');
  assert.equal(policy.findDriverEta('10:30am-11 am'), '10:30 to 11:00 AM');
  assert.equal(policy.findDriverEta('Got it thanks On Fri, Nov 6, 2026 Daniel wrote: pickup 11/06/2026 0800 - 1500 ETA 9am'), '', 'nothing from the quoted email');
  assert.equal(policy.findDriverEta('Received, thank you'), '');
  const booked = { ...load, id: '2283600', origCity: 'KEARNY', origSt: 'NJ', destCity: 'JACKSONVILLE', destSt: 'FL' };
  const text = policy.buildParamountEtaEmail(booked, { trackingLink: 'https://clarity.landstaronline.com/customer?token=t', pickupCity: 'Kearny, NJ' }, '11:00 to 11:30 AM', { greetingName: 'Heather' });
  assert.match(text, /^Hi Heather and team,\n\nQuick update on order 2283600: our driver confirmed an ETA of 11:00 to 11:30 AM to the shipper in Kearny, NJ\./);
  assert.match(text, /Live tracking: https:\/\/clarity/);
  assert.match(policy.buildParamountEtaEmail({ ...booked, trackingStage: 'Loaded' }, {}, '3:00 PM'), /ETA of 3:00 PM to the receiver in Jacksonville, FL/);
});

test('MercuryGate: new Paramount bookings are filled in once, the PDF after pickup', () => {
  const booked = { ...load, id: '2283700', status: 'BOOKED', bookedAt: '2026-11-06T17:30:00Z', notes: '' };
  const tracking = { freightBill: '4600001' };
  assert.equal(policy.getDueMercuryGateStep(booked, {}), '', 'no freight bill yet');
  assert.equal(policy.getDueMercuryGateStep({ ...booked, bookedAt: '2026-11-05T17:30:00Z' }, tracking), '', 'booked before: entered by hand');
  assert.equal(policy.getDueMercuryGateStep(booked, tracking), 'booked');
  const queued = { ...booked, mercurygate: { booked: '2026-11-06T17:31:00Z' } };
  assert.equal(policy.getDueMercuryGateStep(queued, tracking), '');
  assert.equal(policy.getDueMercuryGateStep(queued, { ...tracking, leftShipperAt: 'done' }), 'pickedUp');
  assert.equal(policy.getDueMercuryGateStep({ ...queued, mercurygate: { ...queued.mercurygate, pickedUp: 'x' } }, { ...tracking, leftShipperAt: 'done' }), '');
  const done = policy.applyMercuryGateResult(booked, { step: 'booked', ok: true, at: 1, results: [{ message: 'Added Customer Reference Number 2283700' }, { message: 'Saved pickup: X' }] });
  assert.match(done.notes, /MercuryGate: Added Customer Reference Number 2283700\nMercuryGate: Saved pickup: X/);
  const failed = policy.applyMercuryGateResult(booked, { step: 'booked', ok: false, message: 'Could not read the pickup', at: 2, results: [] });
  assert.match(failed.notes, /NOT finished - Could not read the pickup\. Finish it by hand\./);
});

test('arrived / left-shipper emails to Paramount always wait for Daniel, even after 3 approvals', () => {
  assert.equal(policy.paramountMaySendItself('arrived'), false);
  assert.equal(policy.paramountMaySendItself('departed'), false);
});

test('MercuryGate starts right after Assign Capacity, by the Landstar load number', () => {
  const booked = { ...load, id: '2282514', status: 'BOOKED', bookedAt: '2026-11-06T17:53:16Z', landstarAssignment: { ok: true, landstarLoadId: '187603287' } };
  assert.equal(policy.getDueMercuryGateStep(booked, {}), 'booked', 'no freight bill needed');
  assert.equal(policy.getDueMercuryGateStep({ ...booked, landstarAssignment: { ok: false, landstarLoadId: '' } }, {}), '');
});

test('loaded email: automatic unless the truck was at the shipper under 15 minutes', () => {
  const info = { arrivedShipperAt: '2026-11-07T18:33:00Z', leftShipperAt: '2026-11-07T18:39:00Z', pickupTimezone: 'America/New_York' };
  assert.match(policy.getLoadedTimeWarning(info), /only 6 min \(arrived 11\/07 at 13:33 EST, left 11\/07 at 13:39 EST\)\. Is this really the loaded time\?/);
  assert.equal(policy.getLoadedTimeWarning({ ...info, leftShipperAt: '2026-11-07T18:48:00Z' }), '', '15 minutes is a real load');
  assert.match(policy.getLoadedTimeWarning({ leftShipperAt: info.leftShipperAt }), /no arrival time/);
  assert.equal(policy.getLoadedTimeWarning({ arrivedShipperAt: info.arrivedShipperAt }), '', 'not loaded yet');
});

test('rolling loads get one customer location email a day from 9 AM', () => {
  const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
  const info = { ok: true, trackingLink: 'https://t', leftShipperAt: new Date(at(7, 13, 39)).toISOString(), lastLocation: 'Ashland, VA',
    lastLocationAt: new Date(at(8, 8, 50)).toISOString(), deliveryCity: 'Knightdale, NC' };
  const withEmails = emails => ({ ...load, id: '2282980', paramountTracking: { emails } });
  const departed = withEmails({ initial: { at: 'x' }, departed: { at: new Date(at(7, 14)).toISOString() } });
  const due = (l, i, now) => [...policy.getDueParamountEmails(l, i, now)];
  assert.deepEqual(due(withEmails({ initial: { at: 'x' } }), info, at(7, 14)), ['departed']);
  assert.deepEqual(due(departed, info, at(7, 18)), [], 'the loaded email went out today');
  assert.deepEqual(due(departed, info, at(8, 8, 59)), [], 'before 9 AM');
  assert.deepEqual(due(departed, info, at(8, 9)), ['location']);
  const updated = policy.markParamountEmail(departed, 'location', { at: new Date(at(8, 9)).toISOString() });
  assert.deepEqual(due(updated, info, at(8, 16)), [], 'once a day');
  assert.deepEqual(due(updated, info, at(9, 9, 5)), ['location'], 'next day again');
  assert.deepEqual(due(updated, { ...info, deliveredAt: 'x' }, at(9, 10)), [], 'delivered: no more location emails');
  assert.deepEqual(due(updated, { ...info, lastLocation: ', ' }, at(9, 10)), [], 'no location from Clarity');
  const text = policy.buildParamountEmail('location', { ...load, id: '2282980' }, info, { greetingName: 'Heather' });
  assert.match(text, /^Hi Heather and team,\n\nDaily update on order 2282980: the truck is in Ashland, VA \(as of .*\), on the way to Knightdale, NC\./);
  assert.match(text, /Live tracking: https:\/\/t/);
});

test('driver texts: Google Voice link for the number and a short message for the stage', () => {
  assert.equal(policy.toUsPhoneE164('(943) 210-3342'), '+19432103342');
  assert.equal(policy.toUsPhoneE164('1-901-843-5001'), '+19018435001');
  assert.equal(policy.toUsPhoneE164('12345'), '');
  assert.equal(policy.getGoogleVoiceUrl('943-210-3342'), 'https://voice.google.com/u/0/messages?itemId=t.%2B19432103342');
  assert.equal(policy.getGoogleVoiceUrl(''), 'https://voice.google.com/u/0/messages');
  const base = { ...load, id: '2282980', driver: 'NICKY SMITH', origCity: 'MARTINSBURG', origSt: 'WV', destCity: 'KNIGHTDALE', destSt: 'NC',
    pickupTime: '11/07/2026 1400 - 2345', deliveryTime: '11/09/2026 0000 - 2359', paramountTracking: { freightBill: '4590295' } };
  const para = 'Para 1522166 - ATZ H';
  const booked = policy.buildDriverText(base, para, new Date(2026, 10, 7, 9).getTime());
  assert.match(booked, /^Hi Nicky, this is Daniel with Landstar\. Checking on load 4590295, picking up today in Martinsburg, WV \(appt 11\/07\/2026 1400 - 2345\)\. What's your ETA to the shipper\? Please turn on Trucker Tools now\.$/);
  assert.match(policy.buildDriverText({ ...base, trackingStage: 'Loaded' }, para), /What's your ETA to Knightdale, NC \(appt 11\/09\/2026 0000 - 2359\)\? Please keep Trucker Tools on/);
  assert.match(policy.buildDriverText({ ...base, trackingStage: 'At Pickup' }, para), /Are you loaded yet on load 4590295 in Martinsburg, WV\?/);
  const pod = policy.buildDriverText({ ...base, trackingStage: 'Delivered' }, para);
  assert.match(pod, /Please send the signed POD for load 4590295 \(Knightdale, NC\) today.*within 48 hours.*charge back/);
  assert.ok(pod.length < 320, 'short enough for a text');
  assert.match(policy.buildDriverText({ ...base, trackingStage: 'Delivered', paperworkReceivedAt: 'x' }, para), /Thank you for delivering/);
});
