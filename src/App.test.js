import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as XLSX from 'xlsx';
import * as screenshotTable from './lib/screenshotTable.js';
import * as ntgCards from './lib/ntgCards.js';
import * as emailWorker from './lib/emailWorker.js';
import zipcodes from 'zipcodes';
import automationPolicy from '../bot/automation-policy.json' with { type: 'json' };

const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');
test('editing an order number replaces the original load and keeps selection and booking details', () => {
  const original = { id: '25', status: 'BOOKED', truck: '572203', rateInput: '6200' };
  const other = { id: '2285956', status: 'OPEN' };
  let map = { Para: [original, other] };
  let selected;
  let ids = ['25'];
  const alerts = [];
  const handler = source.slice(source.indexOf('  const handleInputChange ='), source.indexOf('  const handleOpenDatRateView ='));
  const edit = vm.runInNewContext(`${handler}; handleInputChange`, {
    selectedOrder: original, selectedBroker: 'Para', orders: map.Para,
    normalizeLoadId: value => String(value).trim(),
    alert: message => alerts.push(message),
    setSelectedOrder: value => { selected = value; },
    setCustomerOrdersMap: update => { map = update(map); },
    setSelectedIds: update => { ids = update(ids); }
  });
  edit('id', '2285956');
  assert.equal(alerts.length, 1);
  assert.equal(map.Para[0], original, 'duplicate number must not overwrite either load');
  edit('id', '2284615');
  assert.equal(map.Para.length, 2);
  assert.equal(map.Para[0].id, '2284615');
  assert.equal(map.Para[0].truck, '572203');
  assert.equal(map.Para[0].status, 'BOOKED');
  assert.equal(map.Para[0].rateInput, '6200');
  assert.equal(map.Para[1], other);
  assert.equal(selected.id, '2284615');
  assert.deepEqual(ids, ['2284615']);
});

const { code } = await transform(`${source}
export {
  preservesImportedLoadStatus, getReimportedLoadStatus, getPendingDriverStatusReply, getEmailPostingCode, getRxoEmailPostingCodes, describeRateWorker, hasPickupDayStarted, getCitySuggestions, applyLocationInput,
  keepPreviouslyExportedLoadsOpen, markDifferentScheduleLoadsEnt,
  countPreviouslyExportedLoads, createLaneDayKey, replaceImportedCustomerLoads,
  parseScreenshotLines, correctCitiesFromZip, getLandstarCity, toLandstarCity,
  normalizeCanadianPostalCode, getCountryForRegion, lookupCanadianPostalCode,
  createLaneRateKey, getSavedLaneRate, getFixedLaneRate, getEquipmentDescription, normalizeEquipmentCode, isSkippableEquipment,
  getLandstarEquipmentCode, getLandstarEquipment2, getLandstarCommodity, getLandstarCommodityValue, isTeamEquipment, isTeamLoad, getRatePerMile, hasLoadRate, isHazmatLoad, isTankerLoad, getLoadCommodity, voteNtgLoadNumber, isFlatbedEquipment,
  toExcelDateTime, splitScheduleRange, parseSchedulePickerParts, formatSchedulePickerParts,
  normalizeBrokerList, normalizeCustomerOrders, getLoadSearchEntries, deduplicateDatImports, parseDatRateText,
  parseDatScreenshotLines, correctDatCities, removeExpiredExportedLoads, markLoadsExported,
  getPastedImage, readClipboardImage, getImportedLoadSelection,
  getFuelSurchargeRegion, getFuelSurchargeRate, normalizeFuelSurchargeRates, parseFuelSurchargeEmail,
  writeSyncedKey, initSyncGuardFromStorage, readDataVersions, getChangedSyncedKeys,
  isUnversionedExternalChange, restoreLastSavedKey, markStorageAdopted, classifyChangedSyncedKeys,
  getStatusTag, bookLoad, buildDriverDirectory, findKnownDriver, getPostingMaintenanceLoads, getPostingRefreshDetails,
  getBookedLoads, getTrackingAlert, logCheckCall, parseScheduleStart, loadMatchesSearch, isBookedLoadComplete, getPaperworkStatus, getDeliveredAt, buildPaperworkEmail, getPaperworkTarget, getPaperworkSince, checkBeforePodRequest, isDailyCustomerUpdateDue, getLoadedTimeWarning, toUsPhoneE164, getGoogleVoiceUrl, buildDriverText, rememberLaneRate, fetchDatRateForImport,
  buildInquiryDetails, getInquiryUrl, getLandstarExportComment, getExportPlace, addRateHistoryEntries,
  getEarliestPickupSerial, adjustPickupWindow, removeCapacity, formatDriverInfo, formatOrderCopy, describeBotProgress, isNolanCustomer, isParaCustomer, createManualLoad, copyLoadDetails, estimateRoadMilesFromZips, getGoogleRoadMiles, getRoadMilesLaneKey, buildAssignRequest, applyAssignResult, getRxoAtzDatVanDiscount, isRxoSameCityLoad, getParamountWatchList, buildParamountEmail, getDueParamountEmails, markParamountEmail, applyParamountTrackingInfo, greetingNameFrom, isParamountTrackingCustomer, formatParamountTime, getRxoWatchList, findRxoLoadForRequest, buildRxoUpdateEmail, getDueDriverEmails, buildDriverEmail, markDriverEmail, findTruckerToolsStart, markTrackingStarted, isTrackingReminderDue, getTruckerToolsStatus, getTrackingWatchList, findDriverEta, buildParamountEtaEmail, getDueMercuryGateStep, applyMercuryGateResult, paramountMaySendItself,
  buildLandstarPosting, excelSerialToBoardTime, findDroppedPostings, getLoadSheetNames, isRxoSkippedVanLoad, isMexicoLoad, getImportedHazmatTanker, describeLoadListSummary, moveCustomer, getEquipmentListCategory
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
    if (name === '../bot/automation-policy.json') return automationPolicy;
    if (name === './lib/screenshotTable.js') return screenshotTable;
    if (name === './lib/ntgCards.js') return ntgCards;
    if (name === './lib/emailWorker.js') return emailWorker;
    if (['react', 'xlsx', './lib/supabase', './Prospects.jsx'].includes(name)) return {};
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

test('driver status updates catch up only the newest recent confirmation, independently of Clarity', () => {
  const now = TEST_NOW;
  const pickup = { pickupTime: '10/01/2026 0800' };
  const arrived = { id: 'arrival', status: 'arrived', at: new Date(now - 3600000).toISOString() };
  const loaded = { id: 'loaded', status: 'loaded', at: new Date(now - 60000).toISOString() };
  const replies = [loaded, { id: 'thanks', status: '', at: new Date(now).toISOString() }, arrived];
  assert.equal(policy.getPendingDriverStatusReply(pickup, replies, now).id, 'loaded');
  assert.equal(policy.getPendingDriverStatusReply({ ...pickup, customerStatusReplyIds: ['loaded'] }, replies, now), null,
    'never send an older arrival after the loaded report has been sent');
  assert.equal(policy.getPendingDriverStatusReply({ ...pickup, driverReplyIds: ['loaded'] }, replies, now).id, 'loaded',
    'previously alerted replies are still forwarded');
  assert.equal(policy.getPendingDriverStatusReply({ customerStatusReportedAt: new Date(now).toISOString() }, replies, now), null,
    'a newer forwarded status prevents an older report from being sent');
  assert.equal(policy.getPendingDriverStatusReply({}, [
    { ...loaded, at: new Date(now - 25 * 3600000).toISOString() }
  ], now), null);
  assert.equal(policy.getPendingDriverStatusReply({}, [
    { ...loaded, at: new Date(now + 60000).toISOString() }
  ], now), null);
});

test('rate-worker status distinguishes login, stopped, blocked and working without inventing success', () => {
  assert.equal(policy.describeRateWorker({ state: 'off' }), 'Rate worker off');
  assert.equal(policy.describeRateWorker({ state: 'logged-in' }), 'Rate worker on');
  assert.equal(policy.describeRateWorker({ state: 'working' }), 'Rate worker: checking');
  assert.match(policy.describeRateWorker({ state: 'signing-in' }), /sign in to Landstar/);
  assert.match(policy.describeRateWorker({ state: 'blocked' }), /needs attention/);
  assert.match(policy.describeRateWorker({ state: 'starting' }), /starting/);
  assert.match(policy.describeRateWorker({ state: 'nonsense' }), /unavailable/);
  assert.match(policy.describeBotProgress({ state: 'logged-in', message: 'Uploads paused: 1 bulk error draft needs review' }), /Uploads paused/);
  assert.match(policy.describeBotProgress({ state: 'logged-in', message: 'Waiting for the rate worker: 3 exports pending' }), /Waiting for the rate worker/);
});
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

test('initial broker tracking links may precede pickup, but follow-ups and check-call alerts start on pickup day', () => {
  const before = new Date(2026, 10, 12, 23, 59).getTime();
  const midnight = new Date(2026, 10, 13, 0, 0).getTime();
  const booked = {
    status: 'BOOKED', pickupTime: '11/13/2026 1300 - 1500',
    deliveryTime: '11/16/2026 0800', bookedAt: new Date(2026, 10, 10, 9).toISOString()
  };
  const tracking = { ok: true, freightBill: '1234567', trackingLink: 'https://example.com/tracking' };
  assert.equal(policy.hasPickupDayStarted(booked, before), false);
  assert.equal(policy.hasPickupDayStarted(booked, midnight), true);
  assert.equal(policy.hasPickupDayStarted({ pickupTime: '' }, midnight), false);
  assert.deepEqual([...policy.getDueParamountEmails(booked, tracking, before)], ['initial']);
  assert.deepEqual([...policy.getDueParamountEmails(booked, { ...tracking, trackingLink: '' }, before)], []);
  const introduced = { ...booked, paramountTracking: { emails: { initial: { at: new Date(before).toISOString() } } } };
  assert.deepEqual([...policy.getDueParamountEmails(introduced, { ...tracking, arrivedShipperAt: 'confirmed' }, before)], []);
  assert.deepEqual([...policy.getDueDriverEmails(booked, tracking, before)], ['dispatch']);
  const confirmed = policy.markDriverEmail(booked, 'dispatch', { at: new Date(before).toISOString() });
  assert.deepEqual([...policy.getDueDriverEmails(confirmed, tracking, before)], [], 'no pre-pickup follow-ups or duplicate confirmation');
  assert.deepEqual([...policy.getDueDriverEmails({ ...booked, trackingStage: 'Loaded' }, tracking, before)], []);
  assert.deepEqual([...policy.getDueDriverEmails(booked, { ...tracking, deliveredAt: 'confirmed' }, before)], []);
  assert.deepEqual([...policy.getDueDriverEmails(booked, tracking, midnight)], ['dispatch']);
  assert.equal(policy.getTrackingAlert(booked, before), null);
  assert.equal(policy.getTrackingAlert(booked, midnight), null, 'booking age does not make pickup midnight overdue');
  assert.equal(policy.getTrackingAlert(booked, midnight + 5 * 3600000).level, 'due');
  assert.equal(policy.getTruckerToolsStatus(booked, 'Para 1522166 - ATZ', before), null);
  assert.equal(policy.getPendingDriverStatusReply(booked, [
    { id: 'report', status: 'loaded', at: new Date(before).toISOString() }
  ], before), null);
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

test('search matches city + state together and bare state codes', () => {
  const order = { ...load, route: '', origCity: 'CITY OF COMMERCE', origSt: 'CA', destCity: 'CALEXICO', destSt: 'CA' };
  assert.equal(policy.loadMatchesSearch(order, 'city of commerce ca'), true);
  assert.equal(policy.loadMatchesSearch(order, 'City of Commerce, CA'), true);
  assert.equal(policy.loadMatchesSearch(order, 'commerce ca'), true);
  assert.equal(policy.loadMatchesSearch(order, 'calexico ca'), true);
  assert.equal(policy.loadMatchesSearch(order, 'CA'), true);
  // A state that is not on the load does not match, and "ca" does not hit "CAlexico" text.
  const other = { ...load, route: '', origCity: 'Canton', origSt: 'OH', destCity: 'Aline', destSt: 'OK' };
  assert.equal(policy.loadMatchesSearch(other, 'ca'), false);
  assert.equal(policy.loadMatchesSearch(other, 'canton oh'), true);
  assert.equal(policy.loadMatchesSearch(other, 'canton ca'), false);
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

test('FV (flatbed/stepdeck hazmat) imports as flatbed hazmat', () => {
  assert.equal(policy.getLandstarEquipmentCode('FV'), 'FLAT');
  assert.equal(policy.getLandstarCommodity('FV'), 'HAZMAT');
  assert.equal(policy.isHazmatLoad({ eCode: 'FV' }), true);
  assert.equal(policy.getLoadCommodity({ eCode: 'FV' }), 'HAZMAT');
  assert.match(policy.getEquipmentDescription('FV'), /53FL/);
  assert.match(policy.getEquipmentDescription('FV'), /STEP:SD/);
  assert.equal(policy.isFlatbedEquipment('FV'), true);
  assert.equal(policy.getLandstarEquipment2({ eCode: 'FV' }), 'STEP');
  assert.equal(policy.getEquipmentListCategory('FV'), 'flatbed');
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

test('pickup and delivery schedule controls have large accessible date and time fields', () => {
  const app = createAppHarness(customers[0], [{ ...load, pickupTime: '11/18/2026 0800 - 2000', deliveryTime: '11/19/2026 0800 - 1200' }]);
  for (const schedule of ['Pickup', 'Delivery']) {
    for (const side of ['from', 'to']) {
      for (const type of ['date', 'time']) {
        const input = app.find(node => node.props?.['aria-label'] === `${schedule} ${side} ${type}`);
        assert.ok(input, `${schedule} ${side} ${type} has an accessible label`);
        assert.match(input.props.className, /min-h-\[48px\]/);
        assert.match(input.props.className, /text-base/);
      }
    }
  }
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

test('FV screenshot equipment imports as flatbed hazmat (load 2284974)', () => {
  const parsed = parseScreenshotTimes('2284974', [
    '11/10/2026 1300', '11/10/2026 1400', '11/11/2026 0800', '11/11/2026 1530'
  ], customers[0], false, 'FV', 'FV');
  assert.equal(parsed.eCode, 'FV');
  assert.equal(policy.getLandstarEquipmentCode(parsed.eCode), 'FLAT');
  assert.equal(policy.isHazmatLoad(parsed), true);
  assert.equal(policy.getLoadCommodity(parsed), 'HAZMAT');
});

test('a screenshot row with a readable order number but unreadable city still imports, flagged to verify', () => {
  const columns = [0, 0.03, 0.09, 0.18, 0.28, 0.36, 0.46, 0.56, 0.59, 0.63, 0.7, 0.74, 0.78, 0.83, 0.87, 1];
  const values = ['VZ', '2284974', '11/10/2026 1300', '11/10/2026 1400',
    '11/11/2026 0800', '11/11/2026 1530', '', 'GA', '30901', 'ATLANTA',
    'GA', '30315', '159.0', '41979', ''];
  const words = values.map((text, index) => ({
    text,
    bbox: { x0: columns[index] * 1200 + 1, x1: columns[index + 1] * 1200 - 1, y0: 40, y1: 50 }
  }));
  const [parsed] = policy.parseScreenshotLines([{
    words, text: values.join(' '), bbox: { y0: 40, y1: 50 },
    verifiedOrderId: '2284974', screenshotColumns: columns
  }], 1200, 497, customers[0]);
  assert.ok(parsed, 'the row is not dropped');
  assert.equal(parsed.id, '2284974');
  assert.equal(parsed.destCity, 'ATLANTA');
  assert.ok(/unreadable/i.test(parsed.notes), 'flagged to verify');
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
    tessedit_char_whitelist: 'VEZRFSADNMT53H'
  }]);
});

test('equipment OCR maps the FV look-alikes (FZ, E) to flatbed hazmat', async () => {
  const recognize = text => screenshotTable.recognizeScreenshotEquipment({
    async setParameters() {},
    async recognize() { return { data: { text } }; }
  }, {});
  assert.equal(await recognize('FV'), 'FV');
  assert.equal(await recognize('FZ'), 'FV');
  assert.equal(await recognize('E'), 'FV');
  assert.equal(await recognize('F'), 'F');
  assert.equal(await recognize('VZ'), 'VZ');
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

test('SNB available updates send known details without invented movement, ETA or placeholders', () => {
  const load = { id: '24596349', status: 'BOOKED' };
  const empty = policy.buildRxoUpdateEmail(load, {}, { availableOnly: true });
  assert.equal(empty.complete, true, 'missing tracking does not block SNB reply');
  assert.match(empty.text, /status has not yet been confirmed/);
  assert.match(empty.text, /Pickup ETA has not yet been confirmed/);
  assert.doesNotMatch(empty.text, /____|empty and heading|on the way/);
  const loaded = policy.buildRxoUpdateEmail({ ...load, trackingStage: 'Loaded' }, {
    lastLocation: 'Shelby, NC', deliveryScheduled: '2026-10-02T09:00:00Z'
  }, { availableOnly: true });
  assert.match(loaded.text, /truck is loaded.*Departure has not been confirmed/);
  assert.match(loaded.text, /Last reported location: Shelby, NC/);
  assert.match(loaded.text, /Delivery ETA has not yet been confirmed/);
  assert.doesNotMatch(loaded.text, /on the way|Reported delivery ETA:/);
  const delivered = policy.buildRxoUpdateEmail({ ...load, trackingStage: 'Delivered' }, {}, { availableOnly: true });
  assert.match(delivered.text, /marked delivered/);
  assert.doesNotMatch(delivered.text, /ETA|heading/);
});

test('email posting codes use load overrides, profile defaults and fail closed for conflicting RXO orders', () => {
  assert.equal(policy.getEmailPostingCode({ postingCode: ' anq ' }, 'SNB'), 'ANQ');
  assert.equal(policy.getEmailPostingCode({}, 'snb'), 'SNB');
  assert.equal(policy.getEmailPostingCode({}), '');
  const codes = policy.getRxoEmailPostingCodes({
    [customers[1]]: [
      { id: '24596349', postingCode: 'SNB' },
      { id: '12345678', postingCode: 'ANQ' },
      { id: '87654321' }
    ],
    'R X O 2429200 - ATZ': [{ id: '24596349', postingCode: 'ANQ' }],
    [customers[0]]: [{ id: '12345678', postingCode: 'SNB' }]
  }, 'SNB');
  assert.equal(codes['24596349'], '', 'conflicting records do not authorize forwarding');
  assert.equal(codes['12345678'], 'ANQ', 'other customers cannot change RXO identity');
  assert.equal(codes['87654321'], 'SNB');
});

test('pickup calendar has a large labeled trigger, keyboard focus and preserves date filtering', () => {
  const harness = createAppHarness(customers[0], [load]);
  const dateInput = () => harness.find(node => node.props.id === 'pickup-date-filter');
  const trigger = harness.find(node => node.props['aria-label'] === 'Open pickup date calendar');
  assert.equal(trigger.type, 'button');
  assert.equal(trigger.props['aria-controls'], dateInput().props.id);
  assert.match(trigger.props.className, /min-h-\[44px\]/);
  assert.match(dateInput().props.className, /focus-visible:ring-2/);
  let focused = 0;
  let opened = 0;
  const input = { focus() { focused++; }, showPicker() { opened++; } };
  const event = { currentTarget: { parentElement: { querySelector: () => input } } };
  trigger.props.onClick(event);
  assert.equal(focused, 1);
  assert.equal(opened, 1);
  dateInput().props.onClick({ currentTarget: input });
  assert.equal(opened, 2, 'the entire date field opens the picker');
  delete input.showPicker;
  trigger.props.onClick(event);
  assert.equal(focused, 2, 'older browsers can still focus and edit the date');
  dateInput().props.onChange({ target: { value: '2026-10-27' } });
  harness.render();
  assert.equal(dateInput().props.value, '2026-10-27');
  const clear = harness.find(node => node.props['aria-label'] === 'Clear pickup date filter');
  clear.props.onClick();
  harness.render();
  assert.equal(dateInput().props.value, '');
  const shortcut = label => harness.find(node => node.type === 'button' && node.props.children.includes(label));
  shortcut('Today').props.onClick();
  harness.render();
  assert.equal(dateInput().props.value, '2026-10-01');
  shortcut('Tomorrow').props.onClick();
  harness.render();
  assert.equal(dateInput().props.value, '2026-10-02');
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
      if (name === './lib/emailWorker.js') return extraContext.emailWorkerModule || emailWorker;
      if (name === '../bot/automation-policy.json') return automationPolicy;
      if (name === 'react') return react;
      if (name === 'xlsx') return XLSX;
      if (name === './lib/supabase') return { supabase };
      if (name === './Prospects.jsx') return { default: () => null };
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

test('tracking events enqueue broker emails in the owning worker instead of sending concurrently', async () => {
  const listeners = new Map();
  const calls = [];
  const requested = [];
  let tasks;
  let owner = true;
  let stopped = false;
  const booked = { ...load, id: '2283600', status: 'BOOKED', truck: '583737', pickupTime: '10/01/2026 0800' };
  const app = createAppHarness(customers[0], [booked], null, {}, {
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    AbortSignal,
    window: {
      location: { hostname: '127.0.0.1' },
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name)
    },
    navigator: { locks: {} },
    emailWorkerModule: {
      ...emailWorker,
      createEmailWorker(options) {
        tasks = options.tasks;
        return {
          start() {},
          stop() { stopped = true; },
          isOwner: () => owner,
          request: id => requested.push(id),
          reportIssue() {}
        };
      }
    },
    fetch: async (url, options) => {
      if (url === 'http://127.0.0.1:47615/posting-maintenance') return { ok: true };
      assert.equal(url, '/api/paramount-email');
      calls.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ to: ['broker@example.com'], cc: [] }) };
    }
  });
  const cleanup = app.effects.at(-1)();
  try {
    const info = {
      customer: customers[0], loadId: booked.id, ok: true, freightBill: '4431900',
      trackingLink: 'https://clarity.example.com/tracking', at: new Date(TEST_NOW).toISOString()
    };
    listeners.get('landstar-tracking-result')({ detail: info });
    assert.deepEqual(calls, [], 'tracking events never bypass the polling queue');
    assert.deepEqual(requested, ['tracking-emails']);
    app.render();
    await tasks.find(task => task.id === 'tracking-emails').run();
    assert.deepEqual(calls.map(call => call.action), ['thread'], 'first-send approval remains required');
    app.render();
    assert.ok(app.find(node => node.type === 'button' && /1 email to send/.test(String(node.props.children))),
      'the event still produces a draft after storing tracking without the transient ok flag');
    owner = false;
    listeners.get('landstar-tracking-result')({ detail: info });
    assert.equal(requested.length, 1, 'standby tabs cannot enqueue automatic emails');
    const status = app.find(node => node.type === 'details' && node.props['aria-label'] === 'Driver-to-broker worker');
    assert.ok(status, 'the worker status is rendered');
  } finally { cleanup(); }
  assert.equal(stopped, true);
  assert.equal(listeners.size, 0);
});

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
      if (name === '../bot/automation-policy.json') return automationPolicy;
      if (name === './lib/screenshotTable.js') return screenshotTable;
      if (name === './lib/ntgCards.js') return ntgCards;
      if (name === './lib/emailWorker.js') return emailWorker;
      if (['react', 'xlsx', './lib/supabase', './Prospects.jsx'].includes(name)) return {};
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
  assert.equal(policy.normalizeEquipmentCode('Straight Truck - Large'), 'D-ST');
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

test('equipment dropdowns save two alternates and allow removing automatic alternates', () => {
  const app = createAppHarness(customers[0], [load]);
  app.find(node => node.props?.id === 'load-equipment-primary').props.onChange({ target: { value: 'D-ST' } });
  app.render();
  assert.equal(app.states[6].eCode, 'D-ST');
  assert.equal(policy.getLandstarEquipment2(app.states[6]), 'D-LG');
  app.find(node => node.props?.id === 'load-equipment2').props.onChange({ target: { value: '' } });
  app.render();
  assert.equal(policy.getLandstarEquipment2(app.states[6]), '');
  app.find(node => node.props?.id === 'load-equipment3').props.onChange({ target: { value: 'VAN' } });
  app.render();
  assert.equal(app.states[6].equipment3, 'VAN');
  assert.equal(policy.copyLoadDetails(app.states[6], 'copy-equipment').equipment3, 'VAN');
  app.find(node => node.props?.id === 'load-equipment-primary').props.onChange({ target: { value: 'D-RF' } });
  app.render();
  assert.equal(app.states[6].eCode, 'D-RF');
  assert.equal(policy.getLandstarEquipmentCode('D-RF'), 'D-RF');
  assert.equal(policy.getLandstarEquipment2(app.states[6]), '', 'reefer straight trucks do not accept dry equipment automatically');
  assert.equal(policy.normalizeEquipmentCode('Straight truck refrigerated'), 'D-RF');
});

test('straight trucks use D-ST with D-LG alternate unless a liftgate is required', () => {
  for (const code of ['D-ST', 'D-ST,D-LG', 'D-LG,D-ST']) {
    assert.equal(policy.getLandstarEquipmentCode(code), 'D-ST', code);
    assert.equal(policy.getLandstarEquipment2({ eCode: code }), 'D-LG', code);
  }
  assert.equal(policy.getLandstarEquipmentCode('D-LG'), 'D-LG');
  assert.equal(policy.getLandstarEquipment2({ eCode: 'D-LG' }), '');
  assert.equal(policy.normalizeEquipmentCode('Straight truck lift gate required'), 'D-LG');
  assert.equal(policy.normalizeEquipmentCode('Straight truck no liftgate'), 'D-ST');
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

test('global search includes all statuses and customers regardless of the pickup calendar', () => {
  const statuses = ['OPEN', 'ON HOLD', 'OFFER', 'ENT', 'BOOKED'];
  const app = createAppHarness(customers[0], []);
  app.states[2][customers[1]] = statuses.map((status, index) => ({
    ...load, id: `search-${index}`, status, origCity: 'SEARCHCITY',
    pickupTime: '11/20/2026 0900', rateInput: '',
    ...(status === 'BOOKED' ? { trackingStage: 'Delivered', paperworkReceivedAt: '2026-11-21', paperworkDone: true } : {})
  }));
  app.render();
  app.find(node => node.type === 'button' && textOf(node) === 'OPEN').props.onClick();
  app.find(node => node.props?.id === 'pickup-date-filter').props.onChange({ target: { value: '2026-12-01' } });
  app.render();
  app.find(node => node.props?.['aria-label'] === 'Search loads across all customers')
    .props.onChange({ target: { value: 'SEARCHCITY' } });
  app.render();
  const cards = [];
  app.find(node => {
    if (node.props?.className?.includes('tms-load-card')) cards.push(node);
    return false;
  });
  assert.equal(cards.length, 5, 'a selected pickup date cannot hide global search matches');
  app.find(node => node.props?.id === 'pickup-date-filter').props.onChange({ target: { value: '2026-11-20' } });
  app.render();
  const matching = [];
  app.find(node => {
    if (node.props?.className?.includes('tms-load-card')) matching.push(node);
    return false;
  });
  assert.equal(matching.length, 5, 'includes completed booked loads, offers, holds and exported loads on the selected day');
});

test('pickup and delivery state filters cannot hide global search across customers and statuses', () => {
  const app = createAppHarness(customers[0], [
    { ...load, id: 'to-nc', origCity: 'FORT SMITH', origSt: 'AR', destSt: 'NC', status: 'OPEN' },
    { ...load, id: 'to-tx', origCity: 'FORT SMITH', origSt: 'AR', destSt: 'TX', status: 'OPEN' }
  ]);
  app.states[2][customers[1]] = [
    { ...load, id: 'foreign-nc', origCity: 'FORT SMITH', origSt: 'AR', destSt: 'NC', status: 'BOOKED' },
    { ...load, id: 'wrong-origin', origCity: 'FORT SMITH', origSt: 'TX', destSt: 'NC', status: 'OFFER' }
  ];
  app.render();
  app.find(node => node.props?.['aria-label'] === 'Search loads across all customers')
    .props.onChange({ target: { value: 'FORT SMITH' } });
  app.render();
  const ids = () => {
    const cards = [];
    app.find(node => {
      if (node.props?.className?.includes('tms-load-card')) cards.push(node);
      return false;
    });
    return cards.map(card => card.props.id).sort();
  };
  assert.equal(ids().length, 4);
  app.find(node => node.props?.['aria-label'] === 'Filter by delivery state')
    .props.onChange({ target: { value: 'NC' } });
  app.render();
  assert.equal(ids().length, 4);
  app.find(node => node.props?.['aria-label'] === 'Filter by pickup state')
    .props.onChange({ target: { value: 'AR' } });
  app.render();
  assert.equal(ids().length, 4);
  app.find(node => node.props?.['aria-label'] === 'Filter by delivery state')
    .props.onChange({ target: { value: '' } });
  app.render();
  assert.equal(ids().length, 4);
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

test('OFFER Select All selects every customer using distinct identities for repeated load numbers', () => {
  const own = { ...load, id: 'offer-1', status: 'OFFER', tag: 'OFFER', rateInput: '1000' };
  const foreign = { ...own, rateInput: '', origCity: 'Vernon', route: 'Vernon, CA to Dallas, TX' };
  const app = createAppHarness(customers[0], [own, { ...load, id: 'open-1', status: 'OPEN' }]);
  app.states[2][customers[1]] = [foreign, { ...load, id: 'booked-1', status: 'BOOKED' }];
  app.render();
  app.find(node => node.type === 'button' && textOf(node) === 'OFFER (2)').props.onClick();
  app.render();
  const cards = () => {
    const matches = [];
    app.find(node => {
      if (node.props?.className?.includes('tms-load-card')) matches.push(node);
      return false;
    });
    return matches;
  };
  assert.equal(cards().length, 2);
  assert.ok(cards().some(card => textOf(card).includes(customers[0])));
  assert.ok(cards().some(card => textOf(card).includes(customers[1])));
  assert.ok(app.find(node => node.type === 'button' && textOf(node) === 'All (2)'));
  assert.ok(app.find(node => node.type === 'button' && textOf(node) === 'With rate (1)'));
  assert.ok(app.find(node => node.type === 'button' && textOf(node) === 'No rate (1)'));
  const selectAll = () => app.find(node => node.type === 'input' && node.props.className === 'cursor-pointer accent-blue-600');
  selectAll().props.onChange();
  app.render();
  assert.deepEqual(Array.from(app.states[18]).sort(), [
    JSON.stringify([customers[0], own.id]), JSON.stringify([customers[1], foreign.id])
  ].sort());
  assert.ok(app.find(node => textOf(node) === 'Select All (all customers)'));
  assert.ok(app.find(node => node.type === 'button' && textOf(node).includes('Copy Selected (2)')));
  const checkboxes = [];
  app.find(node => {
    if (node.type === 'input' && node.props.title === 'Select load') checkboxes.push(node);
    return false;
  });
  assert.equal(checkboxes.length, 2);
  assert.ok(checkboxes.every(node => node.props.checked && !node.props.disabled));
  checkboxes[1].props.onChange({ stopPropagation() {} });
  app.render();
  assert.equal(app.states[18].length, 1, 'one customer can be unchecked without affecting the other');
  selectAll().props.onChange();
  app.render();
  assert.equal(app.states[18].length, 2);
  const foreignCard = cards().find(card => textOf(card).includes(customers[1]));
  foreignCard.props.onClick();
  app.render();
  assert.equal(app.states[1], customers[1]);
  assert.equal(app.states[6], foreign);
  assert.equal(app.states[18].length, 0);
  assert.equal(cards().length, 2, 'opening another customer does not narrow offers');
  app.find(node => node.props?.['aria-label'] === 'Search loads across all customers')
    .props.onChange({ target: { value: 'vernon' } });
  app.render();
  assert.equal(cards().length, 1, 'search still filters all-customer offers');
});

test('OFFER bulk move updates selected loads across customers without touching unselected loads', () => {
  const own = { ...load, id: 'same', status: 'OFFER', tag: 'OFFER' };
  const app = createAppHarness(customers[0], [own, { ...load, id: 'keep', status: 'OPEN' }]);
  app.states[2][customers[1]] = [{ ...own }];
  app.render();
  app.find(node => node.type === 'button' && textOf(node) === 'OFFER (2)').props.onClick();
  app.render();
  app.find(node => node.type === 'input' && node.props.className === 'cursor-pointer accent-blue-600').props.onChange();
  app.render();
  app.find(node => node.type === 'button' && node.props.title === 'Move 2 selected loads to ON HOLD').props.onClick();
  app.render();
  assert.equal(app.states[2][customers[0]][0].status, 'ON HOLD');
  assert.equal(app.states[2][customers[1]][0].status, 'ON HOLD');
  assert.equal(app.states[2][customers[0]][1].status, 'OPEN');
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
      id, 'V', '', '', '', '', 'Chicago', 'IL', '60601', '', '', 'Dallas', 'TX',
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
        id, 'V', '', '', '', '', 'Chicago', 'IL', '60601', '', '', id === '444444' ? 'Austin' : 'Dallas', 'TX',
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
  assert.equal(app.alerts.length, 1);
  assert.match(app.alerts[0], /Booked in the TMS only.*not assigned automatically/);
  assert.ok(app.find(node => node.props?.role === 'alert' && textOf(node).includes('not assigned automatically')));
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

test('booked loads from every customer are listed by pickup date and time, missing dates last', () => {
  const entries = policy.getBookedLoads({
    A: [
      { ...load, id: 'a1', status: 'BOOKED', pickupTime: '11/07/2026 0800' },
      { ...load, id: 'a2', status: 'OPEN' },
      { ...load, id: 'a3', status: 'BOOKED', pickupTime: '11/01/2026 0800', trackingStage: 'Delivered' },
      { ...load, id: 'a4', status: 'BOOKED', pickupTime: '' },
      { ...load, id: 'a5', status: 'BOOKED', pickupTime: '11/05/2026 0700' }
    ],
    B: [{ ...load, id: 'b1', status: 'BOOKED', pickupTime: '11/05/2026 0800' }]
  });
  assert.deepEqual(Array.from(entries, e => `${e.customer}:${e.load.id}`), ['A:a3', 'A:a5', 'B:b1', 'A:a1', 'A:a4']);
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

test('entering a driver phone moves an unbooked load to OFFER without assigning capacity', () => {
  for (const status of ['OPEN', 'ENT', 'ON HOLD']) {
    const app = createAppHarness(customers[0], [{ ...load, id: '1', status, tag: policy.getStatusTag(status) }]);
    app.find(node => node.props?.id === 'assignment-driver-phone').props.onChange({ target: { value: '555-111-2222' } });
    app.render();
    assert.equal(app.states[6].status, 'OFFER');
    assert.equal(app.states[6].tag, 'OFFER');
    assert.equal(app.states[6].driverPhone, '555-111-2222');
    assert.equal(app.states[6].bookedAt, undefined);
    assert.equal(app.storage.has('landstar_assignQueue'), false);
    const tab = app.find(node => node.type === 'button' && textOf(node) === 'OFFER (1)');
    assert.ok(tab);
    tab.props.onClick();
    app.render();
    assert.ok(app.find(node => node.props?.id === 'assignment-driver-phone'), 'offer stays accessible');
  }
});

test('phone edits keep booked loads booked and clearing an offer phone does not reopen it', () => {
  for (const status of ['BOOKED', 'OFFER', 'OPEN']) {
    const app = createAppHarness(customers[0], [{ ...load, id: '1', status, tag: policy.getStatusTag(status) }]);
    for (const value of ['   ', ...(status === 'BOOKED' ? ['555-111-2222'] : [])]) {
      app.find(node => node.props?.id === 'assignment-driver-phone').props.onChange({ target: { value } });
      app.render();
      assert.equal(app.states[6].status, status);
    }
  }
});

test('picking a saved driver with a phone creates an offer, not a booking', () => {
  const app = createAppHarness(customers[0], [
    { ...load, id: '1', status: 'OPEN', tag: 'OPEN', driverPhone: '' },
    { ...load, id: '2', status: 'BOOKED', tag: 'BOOKED', driver: 'Test Driver', driverPhone: '555-111-2222', truck: '123456' }
  ]);
  app.find(node => node.props?.id === 'assignment-driver').props.onChange({ target: { value: 'Test Driver' } });
  app.render();
  assert.equal(app.states[6].status, 'OFFER');
  assert.equal(app.states[6].driverPhone, '555-111-2222');
  assert.equal(app.storage.has('landstar_assignQueue'), false);
});

test('same-day reimports and exports preserve the OFFER folder', () => {
  const offered = { ...load, status: 'OFFER', tag: 'OFFER', driverPhone: '555-111-2222' };
  const merged = policy.replaceImportedCustomerLoads(customers[0], [{ ...load }], [offered]).loads[0];
  assert.equal(merged.status, 'OFFER');
  assert.equal(merged.tag, 'OFFER');
  assert.equal(merged.driverPhone, offered.driverPhone);
  const exported = policy.markLoadsExported([offered], new Set([String(offered.id)]), '2026-10-01T12:00:00Z')[0];
  assert.equal(exported.status, 'OFFER');
  assert.equal(exported.tag, 'OFFER');
  assert.equal(exported.landstarExportedAt, '2026-10-01T12:00:00Z');
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
  assert.equal(open.manualEntry, true, 'reopened load is protected from customer-list replacement');
  assert.equal(open.needsCapacity, 'true', 'reopened load is important and needs replacement capacity');
});

test('posting maintenance protects manual, booked and capacity-needed loads, and refreshes only available important loads', () => {
  const posting = { originZip: '30349', destZip: '92504', pickupThru: '11/12/26 16:00' };
  const make = (id, fields) => ({ ...load, id, landstarPosting: posting, truck: '', ...fields });
  const entries = policy.getPostingMaintenanceLoads({ c: [
    make('manual', { manualEntry: true }), make('booked', { status: 'BOOKED' }),
    make('rework', { needsCapacity: 'true', status: 'OPEN' }),
    make('offer', { needsCapacity: 'true', status: 'OFFER' }),
    make('hold', { needsCapacity: 'true', status: 'ON HOLD' }),
    make('truck', { needsCapacity: 'true', status: 'OPEN', truck: '123456' }),
    make('regular', { status: 'OPEN' })
  ] });
  assert.deepEqual([...entries.map(entry => entry.loadId)], ['manual', 'booked', 'rework', 'offer', 'hold', 'truck']);
  assert.deepEqual([...entries.filter(entry => entry.refresh).map(entry => entry.loadId)], ['rework']);
  const oldDriver = { ...load, status: 'BOOKED', driverEmails: { dispatch: { at: 'old' } },
    paramountTracking: { freightBill: '1234567' }, paperworkDone: true, driverReplyIds: ['old'] };
  const reopened = policy.removeCapacity(oldDriver);
  for (const field of ['driverEmails', 'paramountTracking', 'paperworkDone', 'driverReplyIds']) {
    assert.equal(field in reopened, false, field);
  }
  assert.equal('needsCapacity' in policy.bookLoad({ ...reopened, driver: 'New Driver' }), false);
});

test('a load reopened after removing capacity survives imports and posting cleanup', () => {
  const reopened = policy.removeCapacity({
    ...load, id: '2284615', status: 'BOOKED', driver: 'Driver', rateInput: '6200',
    pickupTime: '11/12/2026 0800', landstarExportedAt: '2026-09-01T00:00:00Z',
    landstarPosting: { originZip: '30349', destZip: '92504', pickupThru: '11/12/26 16:00' }
  });
  const other = { ...load, id: '2285956', pickupTime: '11/30/2026 0900' };
  for (const customer of ['Para 1522166 - ATZ', 'Para 1522166 - ATZ H', 'R X O 2429200 - ATZ V']) {
    const result = policy.replaceImportedCustomerLoads(customer, [other], [reopened]);
    const retained = result.loads.find(order => order.id === reopened.id);
    assert.ok(retained, `${customer}: missing from new list but still available`);
    assert.equal(retained.status, 'OPEN');
    assert.equal(retained.rateInput, '6200');
    assert.deepEqual(result.droppedPostings, []);
    assert.deepEqual(policy.findDroppedPostings(customer, [other], [reopened]), []);
  }
  const exported = { ...reopened, status: 'ENT' };
  assert.equal(policy.removeExpiredExportedLoads({ c: [exported] }, Date.parse('2026-11-12')).c.length, 1);
  const important = { ...exported, manualEntry: false, needsCapacity: 'true' };
  assert.equal(policy.removeExpiredExportedLoads({ c: [important] }, Date.parse('2026-11-12')).c.length, 1);
  assert.deepEqual(policy.findDroppedPostings('Other', [other], [important]), []);
  assert.deepEqual(policy.findDroppedPostings('Other', [other], [{ ...important, needsCapacity: '', status: 'BOOKED' }]), []);
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

test('full customer lists automatically queue missing postings, including Paramount, with large-drop confirmation', () => {
  const queued = [];
  let sends = 0;
  let confirmations = 0;
  const handler = source.slice(source.indexOf('  const queueDroppedPostings ='), source.indexOf('  const unseenInquiryCount ='));
  const queueDropped = vm.runInNewContext(`${handler}; queueDroppedPostings`, {
    LARGE_DROP_MIN: 10,
    addToUnpostQueue: items => queued.push(...items),
    sendUnpostQueueToBot: () => { sends += 1; },
    window: { confirm: () => { confirmations += 1; return false; } }
  });
  const dropped = [{ customer: 'Para 1522166 - ATZ', loadId: '222222', posting: { originZip: '60007' } }];
  assert.equal(queueDropped({ droppedPostings: dropped }, [{ landstarPosting: {} }], { interactive: false }), 1);
  assert.equal(queued.length, 1, 'background full lists queue ordinary Paramount removals too');
  assert.equal(sends, 1);
  assert.equal(confirmations, 0);
  const many = Array.from({ length: 11 }, (_, i) => ({ ...dropped[0], loadId: String(i) }));
  const posted = many.map(() => ({ landstarPosting: {} }));
  assert.equal(queueDropped({ droppedPostings: many }, posted, { interactive: false }), 0);
  assert.equal(confirmations, 0, 'background imports cannot confirm a large drop');
  assert.equal(queueDropped({ droppedPostings: many }, posted), 0);
  assert.equal(confirmations, 1, 'interactive Paramount imports retain the large-drop safeguard');
  assert.equal(queued.length, 1);
});

test('posted loads missing from a list are handed to the bot once, Nolan included; DAT screenshots never are', () => {
  const posting = { originZip: '60007', destZip: '76063', pickupThru: '11/06/26 13:00', deliveryThru: '11/08/26 07:00', weight: 42000 };
  const existing = [
    { ...load, id: '111111', status: 'ENT', tag: 'ENT', landstarExportedAt: new Date().toISOString(), landstarPosting: posting },
    { ...load, id: '222222', origCity: 'Denver', origSt: 'CO', status: 'ENT', tag: 'ENT', landstarExportedAt: new Date().toISOString(), landstarPosting: { ...posting, originZip: '80202' } },
    { ...load, id: '333333', origCity: 'Austin', origSt: 'TX' }
  ];
  const imported = [{ ...load, id: '111111' }];
  existing.push(
    { ...load, id: '444444', manualEntry: true, landstarPosting: posting },
    { ...load, id: '555555', needsCapacity: 'true', landstarPosting: posting },
    { ...load, id: '666666', status: 'BOOKED', landstarPosting: posting }
  );

  const result = policy.replaceImportedCustomerLoads(customers[0], imported, existing);
  assert.deepEqual(Array.from(result.droppedPostings, item => item.loadId), ['222222']);
  assert.equal(result.droppedPostings[0].posting.originZip, '80202');
  assert.equal(result.droppedPostings[0].customer, customers[0]);
  assert.equal(result.loads.some(item => item.id === '222222'), false, 'the dropped load is deleted from the TMS');
  assert.ok(result.loads.find(item => item.id === '111111').landstarPosting, 'loads still on the list keep their posting');
  for (const id of ['444444', '555555', '666666']) {
    assert.ok(result.loads.find(item => item.id === id)?.landstarPosting, `${id} stays protected`);
  }

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

test('RXO van, flatbed and reefer lists upload separately: each import replaces only its equipment', () => {
  const rxo = 'R X O 2429200 - ATZ';
  assert.equal(policy.getEquipmentListCategory('VAN:VAN'), 'van');
  assert.equal(policy.getEquipmentListCategory('V'), 'van');
  assert.equal(policy.getEquipmentListCategory('R'), 'reefer');
  assert.equal(policy.getEquipmentListCategory('RZ'), 'reefer');
  assert.equal(policy.getEquipmentListCategory('F'), 'flatbed');
  assert.equal(policy.getEquipmentListCategory('F,SD'), 'flatbed');
  assert.equal(policy.getEquipmentListCategory('SD'), 'flatbed');
  assert.equal(policy.getEquipmentListCategory('D-LG,D-ST'), 'other');
  const posting = { originZip: '60007', destZip: '76063', pickupThru: '11/06/26 13:00', deliveryThru: '11/08/26 07:00', weight: 42000 };
  const existing = [
    { ...load, id: '24500001', eCode: 'VAN:VAN', status: 'ENT', tag: 'ENT', landstarExportedAt: new Date().toISOString(), landstarPosting: posting },
    { ...load, id: '24500002', eCode: 'F', origCity: 'Denver', origSt: 'CO', status: 'ENT', tag: 'ENT', landstarExportedAt: new Date().toISOString(), landstarPosting: { ...posting, originZip: '80202' } },
    { ...load, id: '24500003', eCode: 'R', origCity: 'Austin', origSt: 'TX', status: 'ENT', tag: 'ENT', landstarExportedAt: new Date().toISOString(), landstarPosting: { ...posting, originZip: '73301' } }
  ];
  // Uploading the van list replaces only van loads; flatbed and reefer stay posted.
  const vanResult = policy.replaceImportedCustomerLoads(rxo, [
    { ...load, id: '24500010', eCode: 'VAN:VAN' }
  ], existing);
  assert.deepEqual(Array.from(vanResult.loads, l => l.id).sort(), ['24500002', '24500003', '24500010']);
  assert.deepEqual(Array.from(vanResult.droppedPostings, item => item.loadId), ['24500001'], 'only the missing van posting drops');
  // Uploading the flatbed list next replaces only flatbed loads; the vans stay.
  const flatResult = policy.replaceImportedCustomerLoads(rxo, [
    { ...load, id: '24500020', eCode: 'F,SD', origCity: 'Denver', origSt: 'CO' }
  ], vanResult.loads);
  assert.deepEqual(Array.from(flatResult.loads, l => l.id).sort(), ['24500003', '24500010', '24500020']);
  assert.deepEqual(Array.from(flatResult.droppedPostings, item => item.loadId), ['24500002'], 'only the missing flatbed posting drops');
  // A combined file with all three equipment types still replaces everything, as before.
  const fullResult = policy.replaceImportedCustomerLoads(rxo, [
    { ...load, id: '24500010', eCode: 'VAN:VAN' },
    { ...load, id: '24500020', eCode: 'F,SD', origCity: 'Denver', origSt: 'CO' },
    { ...load, id: '24500030', eCode: 'R', origCity: 'Austin', origSt: 'TX' }
  ], existing);
  assert.deepEqual(Array.from(fullResult.loads, l => l.id).sort(), ['24500010', '24500020', '24500030']);
  assert.deepEqual(Array.from(fullResult.droppedPostings, item => item.loadId).sort(), ['24500001', '24500002', '24500003']);
});

test('RXO hazmat lists upload separately: hazmat uploads never touch the van list and vice versa', () => {
  const rxo = 'R X O 2429200 - ATZ';
  const posting = { originZip: '60007', destZip: '76063', pickupThru: '11/06/26 13:00', deliveryThru: '11/08/26 07:00', weight: 42000 };
  const existing = [
    { ...load, id: '24510001', eCode: 'VAN:VAN', status: 'ENT', tag: 'ENT', landstarExportedAt: new Date().toISOString(), landstarPosting: posting },
    { ...load, id: '24510002', eCode: 'VZ', status: 'ENT', tag: 'ENT', landstarExportedAt: new Date().toISOString(), landstarPosting: { ...posting, originZip: '07001' } },
    { ...load, id: '24510003', eCode: 'VAN:VAN', hazmat: 'true', origCity: 'Denver', origSt: 'CO', status: 'ENT', tag: 'ENT', landstarExportedAt: new Date().toISOString(), landstarPosting: { ...posting, originZip: '80202' } }
  ];
  // Uploading the hazmat list replaces only hazmat loads; the van list stays posted.
  const hazmatResult = policy.replaceImportedCustomerLoads(rxo, [
    { ...load, id: '24510010', eCode: 'VZ' }
  ], existing);
  assert.deepEqual(Array.from(hazmatResult.loads, l => l.id).sort(), ['24510001', '24510010']);
  assert.deepEqual(Array.from(hazmatResult.droppedPostings, item => item.loadId).sort(), ['24510002', '24510003'], 'only the missing hazmat postings drop');
  // Uploading the van list replaces only van loads; the hazmat loads stay.
  const vanResult = policy.replaceImportedCustomerLoads(rxo, [
    { ...load, id: '24510020', eCode: 'VAN:VAN' }
  ], hazmatResult.loads);
  assert.deepEqual(Array.from(vanResult.loads, l => l.id).sort(), ['24510010', '24510020']);
  assert.deepEqual(Array.from(vanResult.droppedPostings, item => item.loadId), ['24510001'], 'only the missing van posting drops');
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

test('Add Load opens a new manual load without an order-number prompt', () => {
  const app = createAppHarness(customers[0], [load], null, {}, {
    window: { prompt: () => { throw new Error('Must not ask for an order number'); } }
  });
  app.find(node => node.type === 'button' && textOf(node) === '＋ Add Load').props.onClick();
  app.render();
  const added = app.states[6];
  assert.match(added.id, /^MANUAL-/);
  assert.equal(added.manualEntry, true);
  assert.equal(added.status, 'OPEN');
  assert.equal(added.miles, '');
  assert.equal(app.states[2][customers[0]].length, 2);
  assert.ok(app.states[2][customers[0]].some(order => order.id === load.id));
  assert.ok(app.find(node => node.type === 'input' && node.props.placeholder === 'Optional order number' && node.props.value === ''));
  assert.notEqual(policy.createManualLoad().id, policy.createManualLoad().id);
});

test('Add Load clears search and calendar filters and leaves Offers to show the new load', () => {
  const app = createAppHarness(customers[0], [{ ...load, status: 'OFFER' }]);
  app.find(node => node.props?.['aria-label'] === 'Search loads across all customers')
    .props.onChange({ target: { value: 'no-match-for-new-load' } });
  app.render();
  app.find(node => node.props?.id === 'pickup-date-filter')
    .props.onChange({ target: { value: '2026-12-01' } });
  app.render();
  app.find(node => node.type === 'button' && textOf(node) === '＋ Add Load').props.onClick();
  app.render();
  assert.equal(app.find(node => node.props?.id === 'pickup-date-filter').props.value, '');
  assert.equal(app.find(node => node.props?.['aria-label'] === 'Search loads across all customers').props.value, '');
  assert.ok(app.find(node => node.props?.className?.includes('tms-load-card') && textOf(node).includes(app.states[6].id)));
  assert.ok(app.find(node => node.type === 'input' && node.props.placeholder === 'Optional order number'));
});

test('commodity choices control hazmat classification and survive copies and reimports', () => {
  const manual = { ...load, id: 'commodity-test', eCode: 'VZ', commodity: 'CHEM' };
  assert.equal(policy.getLoadCommodity(manual), 'CHEM');
  assert.equal(policy.isHazmatLoad(manual), false);
  assert.equal(policy.getLoadCommodity({ ...manual, commodity: '' }), 'HAZMAT');
  assert.equal(policy.isHazmatLoad({ ...manual, eCode: 'VAN:VAN', commodity: 'HAZMAT' }), true);
  assert.equal(policy.copyLoadDetails(manual, 'commodity-copy').commodity, 'CHEM');
  const imported = policy.replaceImportedCustomerLoads('Other', [{ ...load, id: manual.id }], [manual]);
  assert.equal(imported.loads.find(order => order.id === manual.id).commodity, 'CHEM');
  const app = createAppHarness(customers[0], [manual]);
  app.find(node => node.props?.id === 'load-commodity').props.onChange({ target: { value: 'CGAPP' } });
  app.render();
  assert.equal(app.states[6].commodity, 'CGAPP');
});

test('city suggestions distinguish states and selecting a location fills its representative ZIP', () => {
  const suggestions = policy.getCitySuggestions(zipcodes, 'Athens');
  assert.ok(suggestions.some(place => place.state === 'TX'));
  assert.ok(suggestions.some(place => place.state === 'GA'));
  assert.equal(new Set(suggestions.map(place => `${place.city}|${place.state}`)).size, suggestions.length);
  assert.equal(policy.getCitySuggestions(zipcodes, 'A').length, 0);
  const manual = policy.createManualLoad();
  const pickup = policy.applyLocationInput(manual, 'origCity', 'ATHENS, TX', zipcodes);
  assert.equal(pickup.origCity, 'ATHENS');
  assert.equal(pickup.origSt, 'TX');
  assert.equal(zipcodes.lookup(pickup.origZip).city, 'Athens');
  assert.equal(zipcodes.lookup(pickup.origZip).state, 'TX');
  const delivery = policy.applyLocationInput(pickup, 'destCity', 'HARLINGEN, TX', zipcodes);
  assert.equal(delivery.destCity, 'HARLINGEN');
  assert.equal(zipcodes.lookup(delivery.destZip).city, 'Harlingen');
  assert.equal(delivery.origZip, pickup.origZip);
  const typed = policy.applyLocationInput({ ...manual, origCity: 'ATHENS' }, 'origSt', 'TX', zipcodes);
  assert.equal(typed.origZip, pickup.origZip);
  const zip = policy.applyLocationInput(manual, 'origZip', '75751', zipcodes);
  assert.equal(zip.origCity, 'ATHENS');
  assert.equal(zip.origSt, 'TX');
});

test('changing a location invalidates automatic miles but preserves a manual override', () => {
  const auto = {
    ...load, origCity: 'ATHENS', origSt: 'TX', origZip: '75751', miles: '522', milesSource: 'google'
  };
  const changed = policy.applyLocationInput(auto, 'origCity', 'DALLAS, TX', zipcodes);
  assert.equal(changed.origCity, 'DALLAS');
  assert.equal(changed.miles, '');
  const manual = policy.applyLocationInput({ ...auto, milesSource: 'manual' }, 'origCity', 'DALLAS, TX', zipcodes);
  assert.equal(manual.miles, '522');
  const typing = policy.applyLocationInput(auto, 'origCity', 'DALL', zipcodes);
  assert.equal(typing.origZip, '', 'do not calculate from the previous city ZIP while typing');
});

test('automatic mileage requests city and state without ZIPs and preserves later manual edits', async () => {
  const start = source.indexOf('  // Calculate city-to-city driving miles');
  const effect = source.slice(start, source.indexOf('  // ＋ Add Load:', start));
  for (const zip of ['', '75751']) {
    const original = {
      id: 'manual-city', origCity: 'Athens', origSt: 'TX', destCity: 'Harlingen', destSt: 'TX',
      origZip: zip, destZip: zip ? '78552' : '', miles: ''
    };
    let timer;
    let selected = original;
    let map = { Para: [original] };
    let requested;
    vm.runInNewContext(effect, {
      selectedOrder: original, selectedBroker: 'Para',
      normalizeMilesValue: value => value,
      getRoadMilesLaneKey: policy.getRoadMilesLaneKey,
      getGoogleRoadMiles: async order => { requested = order; return '522'; },
      useEffect: callback => callback(),
      setTimeout: callback => { timer = callback; return 1; }, clearTimeout: () => {},
      setCustomerOrdersMap: update => { map = update(map); },
      setSelectedOrder: update => { selected = update(selected); },
      pushNotice: message => { throw new Error(message); }
    });
    await timer();
    assert.equal(requested.origZip, '');
    assert.equal(requested.destZip, '');
    assert.equal(requested.origCity, 'Athens');
    assert.equal(requested.destSt, 'TX');
    assert.equal(map.Para[0].miles, '522');
    assert.equal(selected.milesSource, 'google');
    map.Para[0] = { ...original, miles: '600', milesSource: 'manual' };
    selected = map.Para[0];
    await timer();
    assert.equal(map.Para[0].miles, '600');
  }
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

test('Copy Load carries the details but starts OPEN with no driver or tracking', () => {
  const booked = {
    ...load,
    id: '2283650', status: 'BOOKED', tag: 'BOOKED', bookedAt: '2026-10-01T00:00:00Z',
    eCode: 'V', route: 'Chicago, IL → Dallas, TX', origZip: '60601', destZip: '75201',
    weight: '42000', miles: '967', rateInput: '2500', rateSource: 'DAT', brokerable: 'true',
    postingCode: 'ABC', landstarComment: 'Drop trailer', planningComment: 'Hazmat load',
    notes: 'Call ahead', team: 'true', hazmat: 'true', tanker: 'true',
    driver: 'John', driverPhone: '555-1234', truck: 'T1', trailer: 'TR9',
    pickupEta: '10/27/2026 07:00', emptyLocation: 'Toledo, OH',
    trackingStartedAt: '2026-10-02T00:00:00Z', landstarExportedAt: '2026-10-01T00:00:00Z'
  };
  const copy = policy.copyLoadDetails(booked, '2283651');
  assert.equal(copy.id, '2283651');
  assert.equal(copy.manualEntry, true, 'kept by imports like a load added by hand');
  assert.equal(copy.status, 'OPEN');
  assert.equal(copy.tag, 'OPEN');
  for (const field of ['eCode', 'route', 'origCity', 'origSt', 'origZip', 'destCity', 'destSt', 'destZip',
    'pickupTime', 'deliveryTime', 'weight', 'miles', 'rateInput', 'rateSource', 'brokerable',
    'postingCode', 'landstarComment', 'planningComment', 'notes', 'team', 'hazmat', 'tanker']) {
    assert.equal(copy[field], booked[field], `${field} is copied`);
  }
  for (const field of ['driver', 'driverPhone', 'truck', 'trailer', 'pickupEta', 'emptyLocation', 'carrier']) {
    assert.equal(copy[field] || '', '', `${field} is not copied`);
  }
  assert.equal(copy.bookedAt, undefined);
  assert.equal(copy.trackingStartedAt, undefined);
  assert.equal(copy.landstarExportedAt, undefined);
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
  const missingPosting = policy.buildAssignRequest('Para 1522166 - ATZ H', { ...booked, origZip: '', landstarPosting: undefined });
  assert.match(missingPosting.reason, /required to safely recover/);
  assert.equal(missingPosting.item, undefined, 'missing metadata must not queue an unsafe truck assignment');
  const recovered = policy.buildAssignRequest('RXO', {
    ...booked, landstarPosting: undefined, origZip: '07032', destZip: '32207', weight: '38,000',
    pickupTime: '11/06/2026 1400 - 1500', deliveryTime: '11/09/2026 1000 - 1100'
  });
  assert.equal(recovered.item.recoverPosting, true);
  assert.deepEqual({ ...recovered.item.posting }, posting);
  const singleTime = policy.buildAssignRequest('RXO', {
    ...booked, landstarPosting: undefined, origZip: '07032', destZip: '32207', weight: '38,000',
    pickupTime: '11/06/2026 1400', deliveryTime: '11/09/2026 1000'
  });
  assert.deepEqual({ ...singleTime.item.posting }, posting, 'single-time windows match the export widening rules');
  assert.deepEqual({ ...policy.applyAssignResult(booked, { ok: true, posting }).landstarPosting }, posting);

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
  assert.deepEqual([...policy.getDueParamountEmails(booked, info, now)], ['initial']);
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
  assert.deepEqual([...policy.getDueParamountEmails(sent, arrived, now)], ['arrived']);
  assert.equal(policy.applyParamountTrackingInfo(sent, arrived).trackingStage, 'At Pickup');
  const left = { ...arrived, leftShipperAt: '2026-11-06T15:00:00Z', deliveryEta: '2026-11-07T14:00:00Z' };
  assert.deepEqual([...policy.getDueParamountEmails(sent, left, now)], ['departed'], 'left before the arrived email went out: one email covers both');
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

test('RXO ATZ V booked loads participate in tracking, exact-order replies and recipient routing', () => {
  const customer = 'R X O 2429200 - ATZ V';
  const booked = { ...load, id: '24466147', status: 'BOOKED', truck: '583737', postingCode: 'SNB' };
  const map = { [customer]: [booked, { ...booked, id: '24466148', status: 'OPEN' }] };
  assert.deepEqual([...policy.getRxoWatchList(map).map(item => `${item.customer}|${item.loadId}|${item.billTo}`)],
    [`${customer}|24466147|rxo`]);
  assert.equal(policy.findRxoLoadForRequest(map, '24466147').customer, customer);
  assert.equal(policy.findRxoLoadForRequest(map, '24466148'), null);
  assert.equal(policy.findRxoLoadForRequest(map, '2446614'), null);
  assert.equal(policy.getRxoEmailPostingCodes(map, 'ANQ')['24466147'], 'SNB');
  assert.equal(policy.getPaperworkTarget(customer), 'rxo');
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

test('received paperwork suppresses the initial POD request even if no request was recorded', () => {
  const delivered = { ...load, status: 'BOOKED', trackingStage: 'Delivered', paperworkReceivedAt: '2026-11-11T15:27:00Z' };
  assert.deepEqual(Array.from(policy.getDueDriverEmails(delivered, { freightBill: '4764212' })), []);
});

test('POD requests check earlier driver attachments before sending and fail closed on Gmail errors', async () => {
  const delivered = {
    ...load, status: 'BOOKED', trackingStage: 'Delivered',
    bookedAt: '2026-11-09T14:00:00Z', deliveryTime: '11/11/2026 1200'
  };
  const tracking = { freightBill: '4764212', deliveredAt: '2026-11-11T16:00:00Z' };
  const files = [{ filename: 'POD.jpg', at: '2026-11-11T15:27:00Z' }];
  const result = await policy.checkBeforePodRequest(delivered, tracking, async request => {
    assert.equal(request.action, 'driverPaperwork');
    assert.equal(request.freightBill, '4764212');
    assert.ok(Date.parse(request.since) < Date.parse(files[0].at), 'includes POD sent before delivery was recorded');
    return { files };
  });
  assert.equal(result.received, true);
  assert.equal(result.files, files);
  assert.equal((await policy.checkBeforePodRequest(delivered, tracking, async () => ({ files: [] }))).received, false);
  await assert.rejects(policy.checkBeforePodRequest(delivered, tracking, async () => {
    throw new Error('Gmail unavailable');
  }), /Gmail unavailable/);
  await assert.rejects(policy.checkBeforePodRequest(delivered, tracking, async () => ({})), /invalid attachment response/);
  assert.equal((await policy.checkBeforePodRequest({ ...delivered, paperworkReceivedAt: files[0].at }, tracking, async () => {
    assert.fail('known received paperwork must not require another Gmail lookup');
  })).received, true);
});

test('paperwork status, completed only once it is in and handled, and the customer email', () => {
  const at = (day, hour) => new Date(2026, 10, day, hour).getTime();
  const delivered = { ...load, trackingStage: 'Delivered', paramountTracking: { deliveredAt: new Date(at(9, 10)).toISOString() } };
  assert.equal(policy.getDeliveredAt(delivered), at(9, 10));
  assert.equal(policy.getDeliveredAt({ ...load, trackingStage: 'Delivered', checkCalls: [{ at: new Date(at(9, 12)).toISOString(), stage: 'Delivered' }] }), at(9, 12));
  // Clarity's "delivered, no time recorded" (deliveredAt: 'done'): fall back to the POD
  // request time, then the scheduled delivery, so the paperwork check still runs.
  const doneNoTime = { ...load, deliveryTime: '11/09/2026 0800 - 1600', paramountTracking: { deliveredAt: 'done' } };
  assert.equal(policy.getDeliveredAt({ ...doneNoTime, driverEmails: { pod: { at: new Date(at(9, 9)).toISOString() } } }), at(9, 9));
  assert.equal(policy.getDeliveredAt(doneNoTime), policy.parseScheduleStart('11/09/2026 0800 - 1600'));
  assert.equal(policy.getDeliveredAt({ ...load, deliveryTime: '', paramountTracking: {} }), null);
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
  assert.equal(automationPolicy.automaticDispatchEnabled, false);
  assert.deepEqual(due(booked, tracking, at(5, 20)), ['dispatch'], 'initial paperwork confirmation may precede pickup day');
  assert.deepEqual(due(booked, tracking, at(6, 7)), ['dispatch'], 'driver follow-up begins on pickup day, independently of manual dispatch');
  assert.deepEqual(due({ ...booked, status: 'OFFER' }, tracking, at(5, 20)), [], 'an offer is not an accepted load');
  const dispatchText = policy.buildDriverEmail('dispatch', booked, tracking, { customer: 'Para 1522166 - ATZ H' });
  assert.match(dispatchText, /^Hi David,\n\n\*\*\* IMPORTANT: PLEASE TURN ON THE TRUCKER TOOLS TRACKING APP ON THE DAY OF PICKUP \*\*\*/);
  assert.match(dispatchText, /Thank you for taking load 4574648! Pickup is in Kearny, NJ \(appointment 11\/06\/2026 0800 - 1500\) and delivery is in Jacksonville, FL/);
  assert.match(dispatchText, /confirm you received the load details/);
  assert.match(dispatchText, /attached documents, and that you will use Trucker Tools from pickup day through delivery/);
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
  assert.match(rxo, /^Good morning Ismael!\n\n\*\*\* IMPORTANT: PLEASE TURN ON THE MACROPOINT TRACKING APP ON THE DAY OF PICKUP \*\*\*\nKeep MacroPoint on and tracking for the ENTIRE trip/);
  const para = policy.buildDriverEmail('pickedUp', booked, tracking, { customer: 'Para 1522166 - ATZ H' });
  assert.match(para, /^Hi Ismael,\n\n\*\*\* IMPORTANT: PLEASE TURN ON THE TRUCKER TOOLS TRACKING APP ON THE DAY OF PICKUP \*\*\*/);
  assert.match(policy.buildDriverEmail('deliveryMorning', booked, tracking, { customer: 'Para 1522166 - ATZ' }), /TRUCKER TOOLS/);
  assert.match(policy.buildDriverEmail('pickupMorning', booked, tracking, { customer: 'Nolan 965974' }), /PLEASE TURN ON YOUR TRACKING APP ON THE DAY OF PICKUP/);
  for (const customer of ['R X O 2429200 - ATZ P', 'Para 1522166 - ATZ H', 'Other customer']) {
    const text = policy.buildDriverEmail('dispatch', booked, tracking, { customer });
    assert.match(text, /ON THE DAY OF PICKUP/);
    assert.doesNotMatch(text, /\bNOW\b/);
    assert.match(text, /from pickup to delivery/);
  }
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

test('MercuryGate dispatch and PDF uploads stay manual after booking and pickup', () => {
  const booked = { ...load, id: '2283700', status: 'BOOKED', bookedAt: '2026-11-06T17:30:00Z', notes: '' };
  const tracking = { freightBill: '4600001' };
  assert.equal(policy.getDueMercuryGateStep(booked, {}), '', 'no freight bill yet');
  assert.equal(policy.getDueMercuryGateStep({ ...booked, bookedAt: '2026-11-05T17:30:00Z' }, tracking), '', 'booked before: entered by hand');
  assert.equal(policy.getDueMercuryGateStep(booked, tracking), '');
  const queued = { ...booked, mercurygate: { booked: '2026-11-06T17:31:00Z' } };
  assert.equal(policy.getDueMercuryGateStep(queued, tracking), '');
  assert.equal(policy.getDueMercuryGateStep(queued, { ...tracking, leftShipperAt: 'done' }), '');
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

test('successful Assign Capacity never starts MercuryGate dispatch', () => {
  const booked = { ...load, id: '2282514', status: 'BOOKED', bookedAt: '2026-11-06T17:53:16Z', landstarAssignment: { ok: true, landstarLoadId: '187603287' } };
  assert.equal(policy.getDueMercuryGateStep(booked, {}), '', 'assignment stops before dispatch');
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
  const withEmails = emails => ({ ...load, status: 'BOOKED', id: '2282980', paramountTracking: { emails } });
  const departed = withEmails({ initial: { at: 'x' }, departed: { at: new Date(at(7, 14)).toISOString() } });
  const due = (l, i, now) => [...policy.getDueParamountEmails(l, { ...i, checkedAt: new Date(now).toISOString() }, now)];
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

test('daily customer updates require booked in-transit loads and fresh tracking, not initial email approval', () => {
  const now = new Date(2026, 10, 11, 9).getTime();
  const booked = { ...load, status: 'BOOKED', trackingStage: 'In Transit' };
  const tracking = { lastLocation: 'Dallas, TX', checkedAt: new Date(now).toISOString() };
  const due = (l = booked, t = tracking, time = now) => policy.isDailyCustomerUpdateDue(l, t, time);
  assert.equal(due(), true);
  assert.equal(due({ ...booked, status: 'OFFER' }), false);
  assert.equal(due({ ...booked, trackingStage: 'Booked' }), false);
  assert.equal(due({ ...booked, trackingStage: 'Delivered' }), false);
  assert.equal(due(booked, { ...tracking, deliveredAt: 'done' }), false);
  assert.equal(due(booked, { ...tracking, checkedAt: new Date(now - 31 * 60000).toISOString() }), false);
  assert.equal(due(booked, { ...tracking, lastLocation: '' }), false);
  assert.equal(due(booked, { ...tracking, checkedAt: '' }), false);
  assert.equal(due(booked, tracking, now - 1), false);
  assert.equal(due({ ...booked, paramountTracking: { emails: { location: { at: new Date(now).toISOString() } } } }), false);
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

test('Trucker Tools: the "tracking started" email marks the load, reminders until then (daytime, near pickup, max 6)', () => {
  const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
  const iso = time => new Date(time).toISOString();
  const para = 'Para 1522166 - ATZ';
  const booked = {
    ...load, id: '2282980', status: 'BOOKED', truck: '579800', driver: 'JOHN SMITH', origCity: 'KEARNY', origSt: 'NJ',
    destCity: 'KNIGHTDALE', destSt: 'NC', pickupTime: '11/07/2026 0800 - 1500', deliveryTime: '11/09/2026 0800 - 1500',
    bookedAt: iso(at(6, 15)), notes: ''
  };
  const tracking = { freightBill: '4574700' };
  const due = (l, now, customer = para, t = tracking) => policy.isTrackingReminderDue(l, customer, t, now);
  assert.equal(due(booked, at(6, 18)), false, 'no driver email sent yet');
  const dispatched = policy.markDriverEmail(booked, 'dispatch', { at: iso(at(6, 17)) });
  assert.equal(due(dispatched, at(6, 17, 30)), false, 'too soon after the first email');
  assert.equal(due(dispatched, at(6, 17, 45)), false, 'even legacy early emails cannot start reminders before pickup day');
  assert.equal(due(dispatched, at(6, 17, 45), 'R X O 2429200 - ATZ'), false, 'Paramount only');
  assert.equal(due(dispatched, at(7, 7), 'Para 1522166 - ATZ H'), true, 'hazmat account too, on pickup day');
  assert.equal(due(dispatched, at(6, 21, 30)), false, 'never overnight');
  assert.equal(due(dispatched, at(7, 6, 30)), false, 'not before 7 AM');
  assert.equal(due(dispatched, at(7, 7)), true);
  assert.equal(due({ ...dispatched, pickupTime: '11/10/2026 0800 - 1500' }, at(6, 18)), false, 'pickup more than a day away');
  assert.equal(due({ ...dispatched, trackingStage: 'Delivered' }, at(7, 9)), false, 'delivered');
  assert.equal(due(dispatched, at(7, 9), para, {}), false, 'no BCO thread to reply in');

  let reminded = policy.markDriverEmail(dispatched, 'trackingReminder', { at: iso(at(6, 17, 46)) });
  assert.equal(reminded.driverEmails.trackingReminder.count, 1);
  assert.equal(due(reminded, at(6, 19)), false, 'next one 90 minutes later');
  assert.equal(due(reminded, at(6, 19, 16)), false);
  assert.equal(policy.getTruckerToolsStatus(reminded, para, at(6, 19, 16)), null);
  assert.match(policy.getTruckerToolsStatus(reminded, para, at(7, 7)).text, /^Waiting for Trucker Tools tracking · reminder 1 sent/);
  for (let i = 0; i < 5; i += 1) reminded = policy.markDriverEmail(reminded, 'trackingReminder', { at: iso(at(7, 8 + i * 2)) });
  assert.equal(reminded.driverEmails.trackingReminder.count, 6);
  assert.equal(due(reminded, at(7, 20)), false, 'stops after 6 reminders');
  assert.equal(policy.getTruckerToolsStatus(reminded, para, at(7, 20)).level, 'late');
  assert.match(policy.getTruckerToolsStatus(reminded, para, at(7, 20)).text, /call the driver/);

  const text = policy.buildDriverEmail('trackingReminder', dispatched, tracking, { customer: para });
  assert.match(text, /^Hi John,\n\n\*\*\* IMPORTANT: PLEASE TURN ON THE TRUCKER TOOLS TRACKING APP ON THE DAY OF PICKUP \*\*\*/);
  assert.doesNotMatch(text, /\bnow\b/i);
  assert.match(text, /Trucker Tools has not confirmed tracking for load 4574700 yet \(customer load #2282980\)/);

  const starts = [{ loadNumber: '2282980', at: '2026-11-06T23:51:00.000Z' }, { loadNumber: '2283600', at: '2026-11-06T20:00:00.000Z' }];
  assert.equal(policy.findTruckerToolsStart(dispatched, starts), '2026-11-06T23:51:00.000Z');
  assert.equal(policy.findTruckerToolsStart({ ...dispatched, id: '228298' }, starts), '', 'exact load number only');
  const started = policy.markTrackingStarted(dispatched, '2026-11-06T23:51:00.000Z');
  assert.equal(due(started, at(7, 9)), false, 'tracking started: no more reminders');
  const status = policy.getTruckerToolsStatus(started, para, at(7, 9));
  assert.equal(status.level, 'ok');
  assert.match(status.text, /^Tracking started 11\/06, \d{1,2}:51 [AP]M$/);
  assert.match(started.notes, /Trucker Tools tracking started/);
  assert.match(policy.getTruckerToolsStatus(policy.markTrackingStarted(dispatched, iso(at(7, 9)), { byHand: true }), para, at(7, 9)).text, /marked by hand/);
  assert.equal(policy.getTruckerToolsStatus(dispatched, 'R X O 2429200 - ATZ'), null);
});
