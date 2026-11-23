const assert = require('node:assert/strict');
const test = require('node:test');
const { planDuplicateRemoval } = require('./dedupe');

const posting = (id, postedMs, overrides = {}) => ({
  LoadId: id,
  Agency: 'ANQ ',
  SourceSystemID: 'PORTAL',
  OrderDate: `/Date(${postedMs})/`,
  OriginCityState: 'TRINITY, AL',
  DestinationCityState: 'BARRY, TX',
  PickupFromDateForDisplay: '11/08/26 08:00',
  PickupThruDateForDisplay: '11/08/26 20:00',
  DeliveryFromDateForDisplay: '11/09/26 08:00',
  DeliveryThruDateForDisplay: '11/09/26 12:00',
  Weight: 42000,
  TrailerTypes: ['VAN '],
  TotalRevenue: 2322,
  ...overrides
});

test('keeps the newest posting of a load and removes the older copies', () => {
  const plan = planDuplicateRemoval([
    posting(187126714, 1000),
    posting(187184236, 3000),
    posting(187150000, 2000, { TotalRevenue: 2400 })
  ]);
  assert.deepEqual(plan.keep, [187184236]);
  assert.deepEqual(plan.remove.sort(), [187126714, 187150000]);
});

test('different pickup windows, lanes, weights or agencies are different loads', () => {
  const plan = planDuplicateRemoval([
    posting(1, 1000),
    posting(2, 2000, { PickupFromDateForDisplay: '11/09/26 08:00' }),
    posting(3, 3000, { DestinationCityState: 'MANSFIELD, TX' }),
    posting(4, 4000, { Weight: 40000 }),
    posting(5, 5000, { Agency: 'SNB' })
  ]);
  assert.deepEqual(plan.remove, []);
});

test('postings made by hand (not bulk uploads) are never removed', () => {
  const plan = planDuplicateRemoval([
    posting(1, 1000, { SourceSystemID: 'AW' }),
    posting(2, 2000)
  ]);
  assert.deepEqual(plan.remove, []);
});

test('same posted time falls back to the higher load number', () => {
  const plan = planDuplicateRemoval([posting(10, 1000), posting(11, 1000)]);
  assert.deepEqual(plan.keep, [11]);
  assert.deepEqual(plan.remove, [10]);
});

test('protected loads are never removed, even by a confirmed remove-all run', () => {
  const { filterRemovable } = require('./dedupe');
  const postings = new Map([
    ['187371843', { LoadId: '187371843', Agency: 'ANQ' }],
    ['200000001', { LoadId: '200000001', Agency: 'ANQ' }],
    ['200000002', { LoadId: '200000002', Agency: 'SNB' }]
  ]);
  const protectedIds = new Set(['187371843']);
  const requested = ['187371843', '200000001', '200000002'];
  assert.deepEqual(filterRemovable(requested, { protectedIds, postings, confirmedAllOwnAvailable: true, ownCodes: ['ANQ'] }),
    ['200000001'], 'confirmed run: protected and other agencies stay up');
  assert.deepEqual(filterRemovable(requested, { protectedIds, postings, ownCodes: ['ANQ'] }),
    ['200000001', '200000002'], 'normal run: protected stays up (bot-upload check comes later)');
  assert.deepEqual(filterRemovable(['200000001'], { protectedIds, postings, isStillProtected: () => true }),
    [], 'a posting the TMS still protects stays up');
});
