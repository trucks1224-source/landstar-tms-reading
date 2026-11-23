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
    posting(187126714, 100000),
    posting(187184236, 300000),
    posting(187150000, 200000, { TotalRevenue: 2400 })
  ]);
  assert.deepEqual(plan.keep, [187184236]);
  assert.deepEqual(plan.remove.sort(), [187126714, 187150000]);
});

test('different pickup days, lanes, trailers or agencies are different loads', () => {
  const plan = planDuplicateRemoval([
    posting(1, 1000),
    posting(2, 200000, { PickupFromDateForDisplay: '11/09/26 08:00', PickupThruDateForDisplay: '11/09/26 20:00' }),
    posting(3, 300000, { DestinationCityState: 'MANSFIELD, TX' }),
    posting(4, 400000, { TrailerTypes: ['REFR'] }),
    posting(5, 500000, { Agency: 'SNB' })
  ]);
  assert.deepEqual(plan.remove, []);
});

test('a re-export with a shifted pickup start, delivery window or weight replaces the old posting', () => {
  const plan = planDuplicateRemoval([
    posting(1, 1000, { PickupFromDateForDisplay: '11/08/26 00:07', DeliveryFromDateForDisplay: '11/09/26 00:00' }),
    posting(2, 500000, { Weight: 33138 }),
    posting(3, 900000, { PickupFromDateForDisplay: '11/08/26 10:00', Weight: 30000 })
  ]);
  assert.deepEqual(plan.keep, [3]);
  assert.deepEqual(plan.remove.sort(), [1, 2]);
});

test('several loads on one lane and day from the same upload are all kept', () => {
  const plan = planDuplicateRemoval([
    posting(1, 1000), posting(2, 1200),
    posting(3, 900000), posting(4, 900300)
  ]);
  assert.deepEqual(plan.keep.sort(), [3, 4]);
  assert.deepEqual(plan.remove.sort(), [1, 2]);
});

test('the same file uploaded twice 20 seconds apart: the older upload is removed', () => {
  const plan = planDuplicateRemoval([
    posting(1, 100000), posting(2, 101000), posting(3, 102000, { DestinationCityState: 'MANSFIELD, TX' }),
    posting(4, 122000), posting(5, 123000), posting(6, 124000, { DestinationCityState: 'MANSFIELD, TX' })
  ]);
  assert.deepEqual(plan.keep.sort(), [4, 5, 6]);
  assert.deepEqual(plan.remove.sort(), [1, 2, 3]);
});

test('bulk uploads are recognised by loads posted seconds apart; a lone Quick Post is not', () => {
  const { bulkUploadedIds } = require('./dedupe');
  const ids = bulkUploadedIds([posting(1, 1000), posting(2, 1500), posting(3, 2900), posting(9, 600000)]);
  assert.deepEqual([...ids].sort(), ['1', '2', '3']);
});

test('postings made by hand (not bulk uploads) are never removed', () => {
  const plan = planDuplicateRemoval([
    posting(1, 1000, { SourceSystemID: 'AW' }),
    posting(2, 2000)
  ]);
  assert.deepEqual(plan.remove, []);
});

test('same posted time falls back to the higher load number', () => {
  const plan = planDuplicateRemoval([posting(10, 1000), posting(11, 1000), posting(12, 900000)]);
  assert.deepEqual(plan.keep, [12]);
  assert.deepEqual(plan.remove, [11, 10]);
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
