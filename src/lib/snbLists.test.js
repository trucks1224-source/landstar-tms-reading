import test from 'node:test';
import assert from 'node:assert/strict';
import { snbListOf, replaceSnbList, clearUntaggedSnbLoads } from './snbLists.js';

test("Ivan's chat lists by their label", () => {
  assert.equal(snbListOf('LOWES'), 'lowes');
  assert.equal(snbListOf("Lowe's loads"), 'lowes');
  assert.equal(snbListOf('$$'), 'money');
  assert.equal(snbListOf('big list'), '');
});

test('a list replaces only its own loads from last time', () => {
  const existing = [
    { id: 'L1', status: 'OPEN', snbList: 'lowes' },
    { id: 'L2', status: 'OPEN', snbList: 'lowes' },
    { id: 'L3', status: 'OPEN', snbList: 'lowes', landstarExportedAt: '2026-11-27T15:00:00Z' },
    { id: 'L4', status: 'BOOKED', snbList: 'lowes' },
    { id: 'M1', status: 'OPEN', snbList: 'money' },
    { id: 'B1', status: 'OPEN', snbList: 'big' },
    { id: 'OLD', status: 'OPEN' },
    { id: 'NEW', status: 'OPEN' }
  ];
  const { loads, removed, covered } = replaceSnbList(existing, [{ id: 'L1' }, { id: 'NEW' }], 'lowes', Date.parse('2026-11-28T14:00:00Z'));
  const byId = Object.fromEntries(loads.map(load => [load.id, load]));
  assert.equal(byId.L1.snbList, 'lowes');
  assert.equal(byId.NEW.snbList, 'lowes', 'a new load is tagged with its list');
  assert.equal(byId.L2, undefined, 'dropped from the Lowes list and never posted: deleted');
  assert.equal(byId.L3.status, 'ENT', 'posted and dropped: covered');
  assert.equal(byId.L4.status, 'BOOKED', 'booked loads stay');
  assert.ok(byId.M1 && byId.B1, 'the $$ and van loads are not touched');
  assert.ok(byId.OLD, 'untagged loads wait for the one-time clean-up');
  assert.equal(removed, 1);
  assert.equal(covered, 1);
});

test('-ALT copies match their load', () => {
  const { loads } = replaceSnbList([{ id: '123-ALTA', status: 'OPEN', snbList: 'big' }], [{ id: '123' }], 'big');
  assert.equal(loads.length, 1);
});

test('the one-time clean-up removes only untagged open loads nobody posted or works', () => {
  const { loads, removed } = clearUntaggedSnbLoads([
    { id: '1', status: 'OPEN' },
    { id: '2', status: 'OPEN', snbList: 'money' },
    { id: '3', status: 'OPEN', landstarExportedAt: '2026-11-27T15:00:00Z' },
    { id: '4', status: 'OPEN', manualEntry: true },
    { id: '5', status: 'BOOKED' },
    { id: '6', status: 'ENT' }
  ]);
  assert.deepEqual(loads.map(load => load.id), ['2', '3', '4', '5', '6']);
  assert.equal(removed, 1);
});
