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
  parseScreenshotLines, correctCitiesFromZip, getLandstarCity,
  normalizeCanadianPostalCode, getCountryForRegion,
  createLaneRateKey, getSavedLaneRate, getFixedLaneRate, getEquipmentDescription,
  getLandstarEquipmentCode, getLandstarCommodity, getLandstarCommodityValue, isTeamEquipment, isTeamLoad, getRatePerMile, hasLoadRate, isHazmatLoad, isTankerLoad, getLoadCommodity, voteNtgLoadNumber,
  normalizeBrokerList, normalizeCustomerOrders, getLoadSearchEntries, deduplicateDatImports, parseDatRateText,
  parseDatScreenshotLines, removeExpiredExportedLoads, markLoadsExported
};`, { loader: 'jsx', format: 'cjs' });
const context = {
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
      { ...load, id: '444444', destCity: 'Austin', status: 'ENT', tag: 'ENT' },
      { ...load, id: '444444', destCity: 'Austin' }
    ];
    const snapshot = JSON.stringify(existing);
    const result = policy.replaceImportedCustomerLoads(customer, imported, existing);
    assert.equal(result.loads.length, 3);
    assert.deepEqual(Array.from(result.loads, order => order.id), ['123456', '123456-ALTA', '444444']);
    assert.equal(result.loads.every(order => order.status === 'OPEN' && order.tag === 'OPEN'), true);
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
  const customer = 'R X O 2429200 - ATZ';
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
  assert.equal(result.loads[0].status, 'OPEN');
  const red = policy.replaceImportedCustomerLoads(customers[0], imported.map(order => ({
    ...order, screenshotStatus: 'ON HOLD'
  })), result.loads);
  assert.equal(red.loads.length, 1);
  assert.equal(red.loads[0].status, 'ON HOLD');
  assert.equal(red.loads[0].tag, 'HOLD');
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
  let pendingRead;
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
    module: { exports: {} },
    console: { ...console, error: (...args) => errors.push(args) },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    },
    alert: message => alerts.push(message),
    FileReader: class {
      readAsArrayBuffer(buffer) {
        pendingRead = this.onload({ target: { result: buffer } });
      }
    },
    fetch: async url => {
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
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Loads');
      const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
      const input = findExcelInput(tree);
      assert.ok(input, 'Excel import control exists');
      input.props.onChange({ target: { files: [buffer] } });
      await pendingRead;
    }
  };
}

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

test('typing any detail on a load moves to the next load after a pause', () => {
  let pending = null;
  const timers = { setTimeout: fn => { pending = fn; return 1; }, clearTimeout: () => { pending = null; } };
  const app = createAppHarness(customers[0], [{ ...load, id: '1' }, { ...load, id: '2' }], null, {}, timers);
  const driver = () => app.find(node => node.props?.id === 'assignment-driver');
  driver().props.onChange({ target: { value: 'Alex' } });
  app.render();
  assert.equal(driver().props.value, 'Alex');
  assert.equal(typeof pending, 'function');
  pending();
  app.render();
  assert.equal(driver().props.value, '');
  assert.equal(app.find(node => node.props?.id === 'load-card-2').props.className.includes('ring-yellow-300'), true);
  driver().props.onChange({ target: { value: '' } });
  assert.equal(pending, null);
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

test('flatbed loads map to F,SD and export as FLAT', () => {
  assert.equal(policy.getLandstarEquipmentCode('F,SD'), 'FLAT');
  assert.equal(policy.getLandstarEquipmentCode('FH'), 'FLAT');
  assert.equal(policy.getLandstarEquipmentCode('D-LG'), 'D-LG');
  assert.equal(policy.isHazmatLoad({ eCode: 'FH' }), true);
  assert.equal(policy.getLoadCommodity({ eCode: 'FH' }), 'HAZMAT');
  assert.match(policy.getEquipmentDescription('F,SD'), /STEP/);
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
  assert.equal(policy.getRatePerMile('', '500'), '');
  assert.equal(policy.getRatePerMile('1500', ''), '');
  assert.equal(policy.getRatePerMile('1500', '0'), '');
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
        return app.states[5].id;
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
    { ...load, id: 'DAT-456-2', pickupTime: '10/28/2026 0800' }
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
  assert.equal(result.loads.find(order => order.id === 'DAT-456-2').status, 'OPEN');
  assert.equal(result.loads.find(order => order.id === 'archive').status, 'ENT');
});

test('all customers retain missing exported ENT loads for exactly 30 days, but re-imports reopen', () => {
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
    assert.equal(result.loads.find(order => order.id === 'recent').status, 'ENT', customer);
    assert.equal(result.loads.some(order => order.id === 'expired'), false, customer);
    const reopened = policy.replaceImportedCustomerLoads(customer, [load], [recent], { now }).loads[0];
    assert.equal(reopened.status, 'OPEN');
    assert.equal(Object.hasOwn(reopened, 'landstarExportedAt'), false);
    const cleaned = policy.removeExpiredExportedLoads({ [customer]: [recent, expired] }, now);
    assert.deepEqual(Array.from(cleaned[customer], order => order.id), ['recent']);
    assert.equal(policy.removeExpiredExportedLoads(cleaned, now + 1)[customer].length, 0);
    const open = { ...expired, status: 'OPEN', tag: 'OPEN' };
    assert.equal(policy.removeExpiredExportedLoads({ [customer]: [open] }, now)[customer].length, 1);
  }
});

test('same load number on different pickup days survives beside a retained exported ENT record', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const archive = { ...load, status: 'ENT', tag: 'ENT', landstarExportedAt: '2026-10-27T12:00:00Z' };
  const rows = [
    { ...load, pickupTime: '10/28/2026 0800' },
    { ...load, pickupTime: '10/29/2026 0800' }
  ];
  const result = policy.replaceImportedCustomerLoads(customers[2], rows, [archive], { now });
  assert.equal(result.loads.length, 3);
  assert.equal(new Set(result.loads.map(order => order.id)).size, 3);
  assert.equal(result.loads.filter(order => order.status === 'OPEN').length, 2);
  assert.equal(result.loads.find(order => order.id === load.id).status, 'ENT');
  assert.equal(new Set(result.loads.map(policy.createLaneDayKey)).size, 3);
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
    pickupEta: ['assignment-pickup-eta', '10/28/2026 09:30']
  };
  for (const [field, [id, value]] of Object.entries(fields)) {
    const input = app.find(node => node.props?.id === id);
    assert.ok(input);
    input.props.onChange({ target: { value } });
    app.render();
    assert.equal(app.states[2][customers[0]][0][field], value);
  }
  app.effects[0]();
  const saved = JSON.parse(app.storage.get('landstar_customerOrdersMap'))[customers[0]];
  const reloaded = createAppHarness(customers[0], saved);
  const replaced = policy.replaceImportedCustomerLoads(customers[0], [
    { ...load, pickupEta: 'Imported ETA', driver: '', driverPhone: '', truck: '', trailer: '' }
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
  app.find(node => node.type === 'button' && node.props.children.includes('Select First 25')).props.onClick();
  assert.equal(app.states[14].length, 0);
  card.props.onClick();
  app.render();
  assert.equal(app.states[1], customers[1]);
  assert.equal(app.states[5], foreign);
  assert.equal(app.find(node => node.type === 'input' && node.props.title === 'Select load').props.disabled, false);
  app.find(node => node.type === 'button' && node.props.children.includes('Select First 25')).props.onClick();
  assert.deepEqual(Array.from(app.states[14]), [foreign.id]);
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
  app.effects[1]();
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
