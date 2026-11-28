import test from 'node:test';
import assert from 'node:assert/strict';
import { getTeamAutoExportAccounts, getLoadsToAutoExport, isPickupPast } from './teamAutoExport.js';

const DANIEL = 'daniel-id';
const IVAN = 'ivan-id';
const sharedCustomers = {
  'R X O 2429200 - SNB': { ownerId: DANIEL, isOwner: false },
  'R X O 2429200 - VAN': { ownerId: DANIEL, isOwner: false },
  'Ivan Shares This': { ownerId: IVAN, isOwner: true },
  'Other Teammate Customer': { ownerId: 'someone-else', isOwner: false }
};
const brokers = ['R X O 2429200 - SNB', 'R X O 2429200 - VAN', 'Ivan Shares This', 'Other Teammate Customer', 'Ivan Own'];

test("a teammate's TMS exports Daniel's shared accounts and the teammate's own accounts", () => {
  const accounts = getTeamAutoExportAccounts({
    userId: IVAN, ownerId: DANIEL, sharedCustomers, brokers,
    ownerExports: name => name === 'R X O 2429200 - VAN'
  });
  assert.deepEqual(accounts, [
    { account: 'R X O 2429200 - SNB', own: false },
    { account: 'Ivan Shares This', own: true },
    { account: 'Ivan Own', own: true }
  ], "not Daniel's own auto-export account, not another teammate's account");
});

test("Daniel's TMS never exports this way", () => {
  assert.deepEqual(getTeamAutoExportAccounts({ userId: DANIEL, ownerId: DANIEL, sharedCustomers, brokers }), []);
  assert.deepEqual(getTeamAutoExportAccounts({ userId: '', ownerId: DANIEL, sharedCustomers, brokers }), [], 'not signed in');
});

test('a pickup window is past only when its last day is before today', () => {
  const now = new Date(2026, 10, 27, 21, 0).getTime();
  assert.equal(isPickupPast({ pickupTime: '11/26/2026 0800 - 1500' }, now), true);
  assert.equal(isPickupPast({ pickupTime: '11/26/2026 0800 - 11/27/2026 1500' }, now), false);
  assert.equal(isPickupPast({ pickupTime: '11/27/26 0800' }, now), false);
  assert.equal(isPickupPast({ pickupTime: '' }, now), false);
});

test('new open loads that were never posted are exported once', () => {
  const now = new Date(2026, 10, 27, 21, 0).getTime();
  const orders = [
    { id: '1', status: 'OPEN', pickupTime: '12/01/2026 0800 - 1500' },
    { id: '2', status: 'OPEN', landstarExportedAt: '2026-11-27T21:00:00Z' },
    { id: '3', status: 'BOOKED' },
    { id: '4', status: 'ENT' },
    { id: '5', status: 'ON HOLD' },
    { id: '6', status: 'OPEN', landstarRemoval: { state: 'queued' } },
    { id: '7', status: 'OPEN' },
    { id: '8', status: 'OPEN', manualEntry: true },
    { id: '9', status: 'OPEN', pickupTime: '11/20/2026 0800 - 1500' }
  ];
  assert.deepEqual(getLoadsToAutoExport(orders, new Set(), { now }).map(load => load.id), ['1', '7', '8']);
  assert.deepEqual(getLoadsToAutoExport(orders, new Set(['1']), { skipHandAdded: true, now }).map(load => load.id), ['7'],
    'a load already tried is not retried; hand-added loads in their own accounts stay manual');
  assert.deepEqual(getLoadsToAutoExport(undefined), []);
});
