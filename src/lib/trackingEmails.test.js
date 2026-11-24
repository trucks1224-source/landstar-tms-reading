import assert from 'node:assert/strict';
import test from 'node:test';
import { trackingEmailId, driverEmailId, dailyCustomerEmailId, buildManualUpdateEmail, manualUpdateKinds } from './trackingEmails.js';

const customer = 'Para 1522166 - ATZ';
const monday = new Date(2026, 10, 23, 8, 0).getTime();
const tuesday = new Date(2026, 10, 24, 8, 0).getTime();

test('email ids: one per real email, repeats tell themselves apart', () => {
  assert.equal(trackingEmailId(customer, '2283600', 'departed', monday), `${customer}|2283600|departed`);
  assert.notEqual(trackingEmailId(customer, '1', 'location', monday), trackingEmailId(customer, '1', 'location', tuesday), 'daily location: one per day');
  const load = { id: '2283600', driverEmails: {} };
  assert.equal(driverEmailId(customer, load, 'pod', monday), `driver|${customer}|2283600|pod`);
  assert.notEqual(driverEmailId(customer, load, 'podReminder', monday), driverEmailId(customer, load, 'podReminder', tuesday),
    'a POD reminder each morning: each day is its own email');
  assert.equal(driverEmailId(customer, load, 'podReminder', monday), `driver|${customer}|2283600|podReminder|2026-11-23`);
  assert.equal(driverEmailId(customer, load, 'trackingReminder', monday), `driver|${customer}|2283600|trackingReminder|1`);
  assert.equal(driverEmailId(customer, { ...load, driverEmails: { trackingReminder: { count: 2 } } }, 'trackingReminder', monday),
    `driver|${customer}|2283600|trackingReminder|3`);
  assert.equal(dailyCustomerEmailId(customer, '2283600', monday), `dailyCustomer|${customer}|2283600|2026-11-23`);
});

test('customer update written by hand uses the typed time', () => {
  const load = { id: '2287775', driver: 'JARMAL KENNEDY', origCity: 'LAFAYETTE', origSt: 'TN', destCity: 'BENTONVILLE', destSt: 'AR' };
  const loaded = buildManualUpdateEmail('departed', load, { time: '11/24 14:30 CST' });
  assert.match(loaded, /^Hello team,/);
  assert.match(loaded, /order 2287775: the truck is loaded and has left the shipper in Lafayette, TN \(11\/24 14:30 CST\), heading to Bentonville, AR\./);
  assert.match(loaded, /Daniel Gomez/);
  assert.match(buildManualUpdateEmail('correction', load, { time: '4 PM' }),
    /Correction on order 2287775: please disregard our earlier update\. Jarmal Kennedy has not loaded yet at the shipper in Lafayette, TN and is expected to be loaded by 4 PM\./);
  assert.doesNotMatch(buildManualUpdateEmail('arrived', load), /\(\)/, 'no empty time');
  assert.match(buildManualUpdateEmail('delivered', load, { time: '11/25 09:10' }), /delivered in Bentonville, AR \(11\/25 09:10\)/);
  assert.match(buildManualUpdateEmail('custom', load), /Quick update on order 2287775: \n/);
  assert.deepEqual(manualUpdateKinds.map(([kind]) => kind), ['departed', 'arrived', 'arrivedDelivery', 'delivered', 'correction', 'custom']);
});
