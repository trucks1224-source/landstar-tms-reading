import test from 'node:test';
import assert from 'node:assert/strict';
import { isPastPickupLoad, removePastPickupLoads } from './pastPickupCleanup.js';

const now = new Date(2026, 10, 27, 21, 0).getTime();

test('open, ENT and on-hold loads whose pickup day is gone are removed', () => {
  assert.equal(isPastPickupLoad({ status: 'OPEN', pickupTime: '11/26/2026 0800 - 1500' }, now), true);
  assert.equal(isPastPickupLoad({ status: 'ENT', pickupTime: '11/20/26 0800' }, now), true);
  assert.equal(isPastPickupLoad({ status: 'ON HOLD', puDate: 'PU: 11/25/2026 0800' }, now), true);
});

test('booked loads, loads with a truck, today and multi-day windows stay', () => {
  assert.equal(isPastPickupLoad({ status: 'BOOKED', pickupTime: '11/20/2026 0800' }, now), false);
  assert.equal(isPastPickupLoad({ status: 'OPEN', truck: '427021', pickupTime: '11/20/2026 0800' }, now), false);
  assert.equal(isPastPickupLoad({ status: 'OPEN', pickupTime: '11/27/2026 0800 - 1500' }, now), false);
  assert.equal(isPastPickupLoad({ status: 'OPEN', pickupTime: '11/26/2026 0800 - 11/28/2026 1500' }, now), false);
  assert.equal(isPastPickupLoad({ status: 'OPEN', pickupTime: '' }, now), false, 'no date: kept');
});

test('removing counts per customer and keeps the map when nothing changes', () => {
  const map = {
    A: [{ id: '1', status: 'OPEN', pickupTime: '11/20/2026 0800' }, { id: '2', status: 'OPEN', pickupTime: '12/01/2026 0800' }],
    B: [{ id: '3', status: 'BOOKED', pickupTime: '11/20/2026 0800' }]
  };
  const { orders, removed } = removePastPickupLoads(map, now);
  assert.deepEqual(orders.A.map(load => load.id), ['2']);
  assert.equal(orders.B, map.B);
  assert.deepEqual(removed, { A: 1 });
  const again = removePastPickupLoads(orders, now);
  assert.equal(again.orders, orders);
});
