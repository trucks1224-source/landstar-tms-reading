import assert from 'node:assert/strict';
import test from 'node:test';
import { splitCustomerName, groupCustomers, moveCustomers } from './customerGroups.js';

test('customer names split into account and tag', () => {
  assert.deepEqual(splitCustomerName('R X O 2429200 - ATZ V'), { base: 'R X O 2429200', tag: 'ATZ V' });
  assert.deepEqual(splitCustomerName('AMERI 18347- ATZ'), { base: 'AMERI 18347', tag: 'ATZ' });
  assert.deepEqual(splitCustomerName('Prospect list'), { base: 'Prospect list', tag: '' });
});

test('accounts with the same name and number share one row, in list order', () => {
  const rows = groupCustomers([
    'Para 1522166 - ATZ H', 'R X O 2429200 - ATZ V', 'R X O 2429200 - ATZ P', 'Para 1522166 - ATZ',
    'AMERI 18347- ATZ', 'R X O 2429200 - snb', 'Plain'
  ]);
  assert.deepEqual(rows.map(row => [row.base, row.members.map(member => member.tag || member.name)]), [
    ['Para 1522166', ['ATZ H', 'ATZ']],
    ['R X O 2429200', ['ATZ V', 'ATZ P', 'snb']],
    ['AMERI 18347- ATZ', ['AMERI 18347- ATZ']],
    ['Plain', ['Plain']]
  ]);
});

test('dragging a row moves all its accounts', () => {
  const list = ['A 1 - X', 'B 2 - X', 'A 1 - Y', 'C 3 - X'];
  assert.deepEqual(moveCustomers(list, ['A 1 - X', 'A 1 - Y'], 'C 3 - X'), ['B 2 - X', 'C 3 - X', 'A 1 - X', 'A 1 - Y']);
  assert.deepEqual(moveCustomers(list, ['C 3 - X'], 'A 1 - X'), ['C 3 - X', 'A 1 - X', 'B 2 - X', 'A 1 - Y']);
  assert.equal(moveCustomers(list, ['A 1 - X'], 'A 1 - X'), list);
});

test('short row names', async () => {
  const { shortAccountName } = await import('./customerGroups.js');
  assert.equal(shortAccountName('R X O 2429200'), 'RXO');
  assert.equal(shortAccountName('Para 1522166'), 'Para');
  assert.equal(shortAccountName('Nolan 965974'), 'Nolan');
  assert.equal(shortAccountName('12345'), '12345');
});

test('tab colors by account kind', async () => {
  const { accountTagKind } = await import('./customerGroups.js');
  assert.deepEqual(['VAN', 'ATZ V', 'REEFER', 'Flat', 'HAZ', 'N HAZ', 'ATZ H', 'Panels', 'ATZ P', 'snb', 'ATZ'].map(accountTagKind),
    ['van', 'van', 'reefer', 'flat', 'haz', 'van', 'haz', 'panels', 'panels', 'snb', 'plain']);
});
