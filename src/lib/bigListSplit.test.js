import assert from 'node:assert/strict';
import test from 'node:test';
import { isDanielsBigListLoad, splitBigList, addToSnbList, isPriorityBigListLane } from './bigListSplit.js';

test('Texas pickups and anything over 500 miles stay; the rest goes to SNB', () => {
  assert.equal(isDanielsBigListLoad({ origSt: 'TX', miles: '120' }), true, 'Texas at any distance');
  assert.equal(isDanielsBigListLoad({ origSt: 'tx', miles: '' }), true);
  assert.equal(isDanielsBigListLoad({ origSt: 'NV', miles: '501' }), true, 'over 500 miles');
  assert.equal(isDanielsBigListLoad({ origSt: 'NV', miles: '1,240 miles' }), true);
  assert.equal(isDanielsBigListLoad({ origSt: 'NV', miles: '500' }), false, '500 exactly goes to SNB');
  assert.equal(isDanielsBigListLoad({ origSt: 'CA', miles: '229.3' }), false);
  assert.equal(isDanielsBigListLoad({ origSt: 'CA', miles: '' }), true, 'unknown miles stay with Daniel');
  const { mine, snb } = splitBigList([{ id: 1, origSt: 'TX', miles: 80 }, { id: 2, origSt: 'GA', miles: 300 }, { id: 3, origSt: 'GA', miles: 900 }]);
  assert.deepEqual(mine.map(load => load.id), [1, 3]);
  assert.deepEqual(snb.map(load => load.id), [2]);
});

test('loads already in SNB are not added twice', () => {
  const { list, added } = addToSnbList([{ id: '24842607', note: 'old' }], [{ id: '24842607' }, { id: '24842608' }]);
  assert.equal(added, 1);
  assert.deepEqual(list.map(load => load.id), ['24842608', '24842607']);
  assert.equal(list[1].note, 'old');
});

test('priority lanes: into Texas, into Florida, out of Texas', () => {
  assert.equal(isPriorityBigListLane({ origSt: 'GA', destSt: 'TX' }), true);
  assert.equal(isPriorityBigListLane({ origSt: 'GA', destSt: 'fl' }), true);
  assert.equal(isPriorityBigListLane({ origSt: 'TX', destSt: 'OK' }), true);
  assert.equal(isPriorityBigListLane({ origSt: 'FL', destSt: 'GA' }), false, 'out of Florida is not a priority');
});
