import assert from 'node:assert/strict';
import test from 'node:test';
import { findBigListChanges, describeListChange, restoredPostedLoads } from './undo.js';

const loads = (...list) => list.map(id => ({ id: String(id) }));

test('big changes: 3+ removed, 5+ added, an account deleted or a new full account', () => {
  const before = { A: loads(1, 2, 3, 4), B: loads(1, 2), C: loads(9) };
  assert.deepEqual(findBigListChanges(before, before), [], 'nothing changed');
  assert.deepEqual(findBigListChanges(before, { ...before, A: loads(1, 2, 3) }), [], 'one load removed is not big');
  assert.deepEqual(findBigListChanges(before, { ...before, B: loads(1, 2, 3, 4, 5) }), [], '3 added is not big');

  const removed = findBigListChanges(before, { ...before, A: loads(4) });
  assert.deepEqual(removed.map(change => [change.customer, change.removed, change.added]), [['A', 3, 0]]);
  assert.equal(removed[0].before, before.A, 'Undo gets the exact list back');

  const imported = findBigListChanges(before, { ...before, B: loads(1, 2, 10, 11, 12, 13, 14) });
  assert.deepEqual(imported.map(change => [change.customer, change.added]), [['B', 5]]);

  const deleted = findBigListChanges(before, { A: before.A, B: before.B });
  assert.deepEqual(deleted.map(change => [change.customer, change.deleted, change.removed]), [['C', true, 1]]);

  const created = findBigListChanges(before, { ...before, D: loads(1, 2, 3, 4, 5) });
  assert.deepEqual(created.map(change => [change.customer, change.created, change.before.length]), [['D', true, 0]]);
});

test('Undo notices say what changed and which posted loads to re-export', () => {
  assert.equal(describeListChange({ customer: 'RXO ATZ V', added: 183, removed: 12 }), 'RXO ATZ V: 183 loads added, 12 removed');
  assert.equal(describeListChange({ customer: 'Para', deleted: true, removed: 27 }), 'Para deleted (27 loads)');
  const change = { before: [{ id: '1', landstarPosting: {} }, { id: '2' }, { id: '3', landstarPosting: {} }] };
  assert.deepEqual(restoredPostedLoads(change, loads(3)).map(load => load.id), ['1'], 'only posted loads that were gone');
});
