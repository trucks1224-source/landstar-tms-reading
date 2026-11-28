import assert from 'node:assert/strict';
import test from 'node:test';
import { aiRowToLoad } from './aiScreenshot.js';

const row = {
  loadId: 'A-7781', equipment: 'Reefer', origCity: 'Fort Worth', origState: 'tx', origZip: '76102', destCity: 'Mobile', destState: 'AL', destZip: '',
  pickupFrom: '12/02/2026 0800', pickupTo: '12/02/2026 1400', deliveryFrom: '12/03/2026 0600', deliveryTo: '',
  weight: '42,500 lbs', miles: '612', rate: '$2,150', onHold: true, hazmat: false, notes: 'Produce'
};

test('a row Claude read becomes a TMS load', () => {
  const load = aiRowToLoad(row, { now: 1 });
  assert.equal(load.id, 'A-7781');
  assert.equal(load.origCity, 'FORT WORTH');
  assert.equal(load.origSt, 'TX');
  assert.equal(load.route, 'FORT WORTH, TX → MOBILE, AL');
  assert.equal(load.pickupTime, '12/02/2026 0800 - 12/02/2026 1400');
  assert.equal(load.deliveryTime, '12/03/2026 0600');
  assert.equal(load.weight, '42500 lbs');
  assert.equal(load.miles, '612');
  assert.equal(load.rateInput, '2150');
  assert.equal(load.status, 'ON HOLD');
  assert.equal(load.planningComment, 'Produce');
  assert.equal(load.notes, '');
});

test('missing pieces are flagged and on-hold can be ignored', () => {
  const load = aiRowToLoad({ ...row, loadId: '', destState: '' }, { now: 5, index: 2, holdsOnHold: false });
  assert.equal(load.id, 'IMG-5-2');
  assert.equal(load.status, 'OPEN');
  assert.match(load.notes, /please check/);
});
