import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHotLanes, describeHotLane, getHotLane, hotLaneKey, hotLaneRate, normalizeLaneCity } from './hotLanes.js';

const row = (origin, oSt, dest, dSt, extra = {}) => ({
  'Origin - City': origin, 'Origin - State': oSt, 'Destination - City': dest, 'Destination - State': dSt,
  'Carrier Name': 'LANDSTAR RANGER INC (AUSTIN TAYLOR)', 'Carrier Line Haul Pay Current': '2,000', 'Pickup Time': '11/20/26 13:00', ...extra
});

test('city names match across spellings', () => {
  assert.equal(normalizeLaneCity('N. Las Vegas'), 'NORTH LAS VEGAS');
  assert.equal(normalizeLaneCity('St Louis'), normalizeLaneCity('Saint Louis'));
  assert.equal(normalizeLaneCity('Ft Worth'), 'FORT WORTH');
  assert.equal(hotLaneKey('Mcdonough', 'ga', 'MIAMI', 'FL'), 'MCDONOUGH, GA>MIAMI, FL');
  assert.equal(hotLaneKey('', 'GA', 'MIAMI', 'FL'), '', 'incomplete lane');
});

test('builds lanes from the export and matches our loads', () => {
  const hot = buildHotLanes([
    row('McDonough', 'GA', 'Miami', 'FL'),
    row('MCDONOUGH', 'GA', 'MIAMI', 'FL', { 'Carrier Name': 'LANDSTAR RANGER INC (SWP AGENCY)', 'Carrier Line Haul Pay Current': '3000', 'Pickup Time': '11/22/26 08:00' }),
    row('Bridgeport', 'TX', 'Houston', 'TX'),
    row('', 'TX', 'Houston', 'TX')
  ]);
  assert.equal(hot.rows, 3);
  const lane = hot.lanes['MCDONOUGH, GA>MIAMI, FL'];
  assert.equal(lane.count, 2);
  assert.deepEqual(lane.agents, ['AUSTIN TAYLOR', 'SWP AGENCY']);
  assert.equal(lane.avgPay, 2500);
  assert.equal(new Date(lane.lastPickup).getDate(), 22);
  assert.equal(getHotLane({ origCity: 'MCDONOUGH', origSt: 'GA', destCity: 'MIAMI', destSt: 'FL' }, hot), lane);
  assert.equal(getHotLane({ origCity: 'MCDONOUGH', origSt: 'GA', destCity: 'ORLANDO', destSt: 'FL' }, hot), null);
  assert.equal(getHotLane({ origCity: 'X' }, null), null);
  assert.equal(lane.minPay, 2000);
  assert.equal(lane.maxPay, 3000);
  assert.equal(lane.lastPay, 3000, 'rate of the newest pickup');
  assert.equal(hotLaneRate(lane), '$2,500');
  assert.equal(hotLaneRate({ avgPay: 0 }), '');
  assert.match(describeHotLane(lane), /McDonough, GA → Miami, FL: booked 2× by other agents \(AUSTIN TAYLOR, SWP AGENCY\)\. Booked at avg \$2,500 \(range \$2,000–\$3,000\)\. Last pickup 11\/22\/2026 at \$3,000/);
});
