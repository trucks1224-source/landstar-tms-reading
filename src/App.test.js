import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as XLSX from 'xlsx';
import * as screenshotTable from './lib/screenshotTable.js';
import zipcodes from 'zipcodes';

const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');
const { code } = await transform(`${source}
export {
  preservesImportedLoadStatus, getReimportedLoadStatus,
  keepPreviouslyExportedLoadsOpen, markDifferentScheduleLoadsEnt,
  countPreviouslyExportedLoads, createLaneDayKey, replaceImportedCustomerLoads,
  parseScreenshotLines, correctCitiesFromZip, getLandstarCity,
  createLaneRateKey, getSavedLaneRate, getEquipmentDescription,
  getLandstarEquipmentCode, getLandstarCommodity, getLandstarCommodityValue,
  normalizeBrokerList, normalizeCustomerOrders
};`, { loader: 'jsx', format: 'cjs' });
const context = {
  module: { exports: {} },
  require(name) {
    if (name === './lib/screenshotTable.js') return screenshotTable;
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
  assert.equal(saved.status, 'ENT');
  assert.equal(policy.getLandstarCity(saved.origCity, zipcodes.lookup('90058')), 'VERNON');
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

test('Para red 2279568 is retained as ENT, then reopens when its next screenshot is not red', () => {
  const times = ['10/28/2026 08...', '10/28/2026 1400', '10/29/2026 0...', '10/29/2026 1400'];
  const red = parseScreenshotTimes('2279568', times, customers[0], true);
  assert.equal(red.status, 'ENT');
  const first = policy.replaceImportedCustomerLoads(customers[0], [red, red], [
    { ...red, status: 'OPEN', tag: 'OPEN' }, { ...load, id: '9999999' }
  ]);
  assert.equal(first.loads.length, 1);
  assert.equal(first.loads[0].id, '2279568');
  assert.equal(first.loads[0].status, 'ENT');
  assert.equal(first.loads[0].tag, 'ENT');
  assert.equal(first.removedCount, 1);
  assert.equal(first.usesScreenshotStatus, true);
  assert.equal('screenshotStatus' in first.loads[0], false);
  const plain = parseScreenshotTimes('2279568', times, customers[0], false);
  const second = policy.replaceImportedCustomerLoads(customers[0], [plain], [
    { ...first.loads[0], landstarExportedAt: '2026-10-27T12:00:00.000Z' }
  ]);
  assert.equal(second.loads[0].status, 'OPEN');
  assert.equal(second.loads[0].tag, 'OPEN');
  assert.equal('landstarExportedAt' in second.loads[0], false);
});

test('red screenshot status is Para-only and is not inherited by later non-screenshot imports', () => {
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
  test(`${customer}: full imports delete missing OPEN and ENT loads and deduplicate numbers across dates`, () => {
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
    assert.equal(result.loads.length, 2);
    assert.deepEqual(Array.from(result.loads, order => order.id), ['123456', '444444']);
    assert.equal(result.loads.every(order => order.status === 'OPEN' && order.tag === 'OPEN'), true);
    assert.equal(result.loads[0].pickupTime, imported[0].pickupTime);
    assert.equal(result.loads[0].rateInput, '2100');
    assert.equal(result.loads[0].notes, 'Keep my note');
    assert.equal(result.duplicateCount, 2);
    assert.equal(result.removedCount, 2);
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

test('non-exported OPEN and ON HOLD statuses are preserved', () => {
  for (const status of ['OPEN', 'ON HOLD']) {
    const result = policy.getReimportedLoadStatus({ status, tag: status }, false);
    assert.equal(result.status, status);
    assert.equal(result.tag, status);
  }
});

test('previously exported loads reopen regardless of their existing status', () => {
  const result = policy.getReimportedLoadStatus({ status: 'ON HOLD', tag: 'HOLD' }, true);
  assert.equal(result.status, 'OPEN');
  assert.equal(result.tag, 'OPEN');
});

test('other customers retain automatic schedule-based ENT behavior', () => {
  const customer = 'R X O 2429200 - ATZ';
  assert.equal(policy.preservesImportedLoadStatus(customer), false);
  const [result] = policy.markDifferentScheduleLoadsEnt(
    [load], [{ ...load, pickupTime: '10/27/2026 1400 - 1600' }], customer
  );
  assert.equal(result.status, 'ENT');
  assert.equal(result.tag, 'ENT');
  assert.equal(policy.replaceImportedCustomerLoads(customer, [], [load]), null);
});

test('empty, missing-number and generated-number imports cannot delete existing loads', () => {
  for (const imported of [[], [{ ...load, id: '' }], [{ ...load, id: 'IMG-123456789-0' }]]) {
    assert.throws(() => policy.replaceImportedCustomerLoads(customers[0], imported, [load]), /Existing loads were not deleted/);
  }
});

test('different load numbers on the same lane and day remain separate', () => {
  const result = policy.replaceImportedCustomerLoads(customers[0], [
    load, { ...load, id: '999999' }
  ], []);
  assert.equal(result.loads.length, 2);
});

test('RXO ATZ P keeps one load per lane and pickup day regardless of numbers, ZIPs, or times', () => {
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
  const result = policy.replaceImportedCustomerLoads(customers[1], imported, []);
  assert.deepEqual(Array.from(result.loads, order => order.id), ['100001', '100004', '100005', '100006', '100007']);
  assert.equal(result.laneDayDuplicateCount, 2);
  assert.equal(result.loads[0].rateInput, '2500');
  assert.equal(JSON.stringify(imported), before);
  for (const customer of [customers[0], customers[2]]) {
    assert.equal(policy.replaceImportedCustomerLoads(customer, imported, []).loads.length, 7);
  }
});

test('RXO ATZ P does not collapse loads with unreadable pickup dates', () => {
  const result = policy.replaceImportedCustomerLoads(customers[1], [
    { ...load, id: '100001', pickupTime: '', puDate: '' },
    { ...load, id: '100002', pickupTime: '', puDate: '' }
  ], []);
  assert.equal(result.loads.length, 2);
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

function createAppHarness(customer, existing, supabase = null, savedRates = {}) {
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
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = states.length;
      states.push(typeof initial === 'function' ? initial() : initial);
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
      if (name === 'react') return react;
      if (name === 'xlsx') return XLSX;
      if (name === './lib/supabase') return { supabase };
      throw new Error(`Unexpected dependency: ${name}`);
    }
  };
  vm.runInNewContext(code, appContext);
  const tree = appContext.module.exports.default();
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

test('RXO ATZ P Excel import persists one OPEN load per lane/day and removes older duplicates', async () => {
  const app = createAppHarness(customers[1], [
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
  const saved = JSON.parse(app.storage.get('landstar_customerOrdersMap'))[customers[1]];
  assert.deepEqual(saved.map(order => order.id), ['100001', '100003']);
  assert.equal(saved[0].status, 'OPEN');
  assert.ok(app.alerts.some(message => message.includes('Same-lane/pickup-day duplicates skipped: 1')));
  assert.equal(app.errors.length, 0);
});

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
    assert.deepEqual(saved[customer].map(order => order.id), ['123456', '444444']);
    assert.equal(saved[customer][0].status, 'OPEN');
    assert.equal(saved[customer][0].tag, 'OPEN');
    assert.ok(saved[customer][0].pickupTime.includes('10/28/'));
    assert.equal(saved['Unrelated customer'][0].status, 'ENT');
    assert.ok(app.alerts.some(message => message.includes('missing loads deleted (including ENT): 2')));
    assert.ok(app.alerts.some(message => message.includes('Duplicate load numbers skipped: 1')));
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
    load: { ...load, id: String(100000 + index) }
  }));
  rows.push({ id: 106, customer: customers[1], load: { ...load, id: '555555' } });
  rows.push({ id: 107, customer: customers[0], load: { ...rows[0].load } });
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
  assert.deepEqual(pages, [100, 7]);
  assert.equal(saved[customers[0]].length, 105);
  assert.equal(saved[customers[0]][0].status, 'OPEN');
  assert.equal(saved[customers[0]].some(order => order.id === '999999'), false);
  assert.equal(saved[customers[1]].length, 1);
  assert.equal(saved['Unrelated customer'][0].id, '777777');
  assert.equal(acknowledged.length, 107);
  assert.equal(app.errors.length, 0);
});
