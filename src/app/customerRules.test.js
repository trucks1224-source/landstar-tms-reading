import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCustomerRules, normalizeCustomerRules, hasCustomerRules, equipmentFamily, filterByImportEquipment,
  ruleEquipment2, ruleLaneRate, startingRate, higherRate
} from './customerRules.js';

test('no rules: everything as usual', () => {
  const rules = getCustomerRules({}, 'Anything');
  assert.deepEqual(rules, { importEquipment: [], equipment2: 'auto', rateSource: 'default', laneRates: [], excelColumns: {}, capacity: 'bco', screenshotInstructions: '' });
  assert.equal(hasCustomerRules(rules), false);
  assert.equal(ruleEquipment2(rules), undefined);
  assert.deepEqual(filterByImportEquipment([{ eCode: 'R' }], rules), { kept: [{ eCode: 'R' }], skipped: 0 });
});

test('rules are found by customer name, spelled loosely, and bad values are dropped', () => {
  const all = { 'Phal 123 - AAQ': { importEquipment: ['flatbed', 'nonsense'], equipment2: 'none', rateSource: 'whatever' } };
  const rules = getCustomerRules(all, 'PHAL 123- AAQ');
  assert.deepEqual(rules.importEquipment, ['flatbed']);
  assert.equal(rules.equipment2, 'none');
  assert.equal(rules.rateSource, 'default');
  assert.equal(hasCustomerRules(rules), true);
});

test('equipment families and the import filter', () => {
  assert.equal(equipmentFamily('V'), 'van');
  assert.equal(equipmentFamily('53VN'), 'van');
  assert.equal(equipmentFamily('R'), 'reefer');
  assert.equal(equipmentFamily('F'), 'flatbed');
  assert.equal(equipmentFamily('SD'), 'stepdeck');
  const loads = [{ id: 1, eCode: 'F' }, { id: 2, eCode: 'V' }, { id: 3, eCode: 'R' }, { id: 4, eCode: 'FLAT' }];
  const { kept, skipped } = filterByImportEquipment(loads, { importEquipment: ['flatbed'] });
  assert.deepEqual(kept.map(load => load.id), [1, 4]);
  assert.equal(skipped, 2);
});

test('2nd equipment on Landstar', () => {
  assert.equal(ruleEquipment2({ equipment2: 'none' }), '');
  assert.equal(ruleEquipment2({ equipment2: 'REFR' }), 'REFR');
  assert.equal(ruleEquipment2({ equipment2: 'auto' }), undefined);
});

test('fixed lane rates: by state, or by city and state', () => {
  const rules = normalizeCustomerRules({ laneRates: [
    { origCity: 'Wayne', origSt: 'nj', destCity: '', destSt: 'TX', rate: '$3,300' },
    { origSt: 'IL', destSt: 'GA', rate: 2400 },
    { origSt: 'IL', destSt: 'GA', rate: 0 }
  ] });
  assert.equal(rules.laneRates.length, 2, 'a lane with no rate is dropped');
  assert.equal(ruleLaneRate(rules, { origCity: 'WAYNE', origSt: 'NJ', destCity: 'PASADENA', destSt: 'TX' }), '3300');
  assert.equal(ruleLaneRate(rules, { origCity: 'NEWARK', origSt: 'NJ', destCity: 'PASADENA', destSt: 'TX' }), '', 'other origin city');
  assert.equal(ruleLaneRate(rules, { origCity: 'CHICAGO', origSt: 'IL', destCity: 'ATLANTA', destSt: 'GA' }), '2400');
});

test('rate source: the rate a load starts with, and the higher of two', () => {
  assert.deepEqual(startingRate({}, { fileRate: 1500, savedRate: '1800' }), { rate: '1800', waitForDat: false }, 'as usual: your saved lane rate first');
  assert.deepEqual(startingRate({}, { fileRate: 1500 }), { rate: '1500', waitForDat: false });
  assert.deepEqual(startingRate({ rateSource: 'customer' }, { fileRate: 1500, savedRate: '1800' }), { rate: '1500', waitForDat: false });
  assert.deepEqual(startingRate({ rateSource: 'dat' }, { fileRate: 1500 }), { rate: '', waitForDat: false }, 'blank: DAT fills it');
  assert.deepEqual(startingRate({ rateSource: 'higher' }, { fileRate: 1500 }), { rate: '', waitForDat: true });
  assert.equal(higherRate(1820.4, 1500), '1820');
  assert.equal(higherRate(0, 1500), '1500');
  assert.equal(higherRate(0, 0), '');
});

test('Excel columns: only known fields with a header name are kept', () => {
  const rules = normalizeCustomerRules({ excelColumns: { loadId: 'Ref #', origCity: ' Ship From City ', bogus: 'x', rate: '' } });
  assert.deepEqual(rules.excelColumns, { loadId: 'Ref #', origCity: 'Ship From City' });
});

test('capacity: BCO trucks only, or BCO trucks and carriers', () => {
  assert.equal(normalizeCustomerRules({}).capacity, 'bco');
  assert.equal(normalizeCustomerRules({ capacity: 'both' }).capacity, 'both');
  assert.equal(normalizeCustomerRules({ capacity: 'x' }).capacity, 'bco');
  assert.equal(hasCustomerRules({ capacity: 'both' }), true);
});

test('screenshot instructions: kept as written (trimmed, at most 3000 characters)', () => {
  assert.equal(normalizeCustomerRules({ screenshotInstructions: '  Red load # = on hold.  ' }).screenshotInstructions, 'Red load # = on hold.');
  assert.equal(normalizeCustomerRules({ screenshotInstructions: 'x'.repeat(4000) }).screenshotInstructions.length, 3000);
  assert.equal(hasCustomerRules({ screenshotInstructions: 'Rate is the last column' }), true);
});
