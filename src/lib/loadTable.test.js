import assert from 'node:assert/strict';
import test from 'node:test';
import { sortLoadRows, nextLoadTableSort } from './loadTable.js';

const rows = [
  { id: '3', rate: 1500, origin: 'WAYNE, NJ', pickupAt: 30 },
  { id: '1', rate: 0, origin: 'austin, TX', pickupAt: 10 },
  { id: '10', rate: 9351, origin: 'BLOOMINGTON, IL', pickupAt: 20 },
  { id: '2', rate: 2600, origin: '', pickupAt: 0 }
];

test('sorts by money high to low, empty values last', () => {
  assert.deepEqual(sortLoadRows(rows, 'rate', true).map(row => row.id), ['10', '2', '3', '1']);
  assert.deepEqual(sortLoadRows(rows, 'rate', false).map(row => row.id), ['3', '2', '10', '1'], 'no rate stays last either way');
});

test('sorts text A to Z ignoring case, and load numbers as numbers', () => {
  assert.deepEqual(sortLoadRows(rows, 'origin').map(row => row.id), ['1', '10', '3', '2']);
  assert.deepEqual(sortLoadRows(rows, 'id').map(row => row.id), ['1', '2', '3', '10']);
  assert.deepEqual(sortLoadRows(rows, 'pickupAt').map(row => row.id), ['1', '10', '3', '2']);
  assert.deepEqual(sortLoadRows(rows, 'nope').map(row => row.id), ['3', '1', '10', '2'], 'unknown column: as given');
});

test('first click on money sorts high to low, a second click flips it', () => {
  assert.deepEqual(nextLoadTableSort(null, 'rate'), { key: 'rate', descending: true });
  assert.deepEqual(nextLoadTableSort({ key: 'rate', descending: true }, 'rate'), { key: 'rate', descending: false });
  assert.deepEqual(nextLoadTableSort({ key: 'rate', descending: true }, 'origin'), { key: 'origin', descending: false });
});
