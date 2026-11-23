const assert = require('node:assert/strict');
const test = require('node:test');
const { planDueEmails, updateReport, COVERED_ID } = require('./email-bot');
const { mergeWorkspace } = require('./workspace');

const PARA = 'Para 1522166 - ATZ';
const now = new Date(2026, 10, 23, 10, 0).getTime();
let lib;
test.before(async () => { lib = await import('../src/lib/trackingEmails.js'); });

const bookedLoad = extra => ({
  id: '2283600', status: 'BOOKED', truck: '583737', pickupTime: '11/23/2026 0800', deliveryTime: '11/25/2026 0900',
  origCity: 'KEARNY', origSt: 'NJ', destCity: 'JACKSONVILLE', destSt: 'FL', ...extra
});

test('plans the same emails, with the same ids, as the TMS', () => {
  const load = bookedLoad({ paramountTracking: { freightBill: '4431900', emails: { initial: { at: 'x' } } }, driverEmails: { dispatch: { at: 'x' } } });
  const info = { ok: true, customer: PARA, loadId: '2283600', trackingLink: 'https://t', leftShipperAt: new Date(now - 3600000).toISOString(),
    arrivedShipperAt: new Date(now - 7200000).toISOString(), freightBill: '4431900' };
  const planned = planDueEmails(lib, { [PARA]: [load] }, [info], now);
  const keys = planned.map(item => item.key);
  assert.ok(keys.includes(`${PARA}|2283600|departed`), 'loaded email to the customer');
  assert.ok(keys.includes(`driver|${PARA}|2283600|pickedUp`) || keys.some(key => key.startsWith('driver|')), 'a driver email');
  const departed = planned.find(item => item.kind === 'departed');
  assert.equal(departed.waitsForSend, false, 'an hour at the shipper, no GPS: sends by itself');
});

test('holds follow the TMS rules (short stop at the shipper waits for Send)', () => {
  const load = bookedLoad({ paramountTracking: { freightBill: '1', emails: { initial: { at: 'x' } } } });
  const info = { ok: true, customer: PARA, loadId: '2283600', trackingLink: 'https://t',
    arrivedShipperAt: new Date(now - 10 * 60000).toISOString(), leftShipperAt: new Date(now - 5 * 60000).toISOString() };
  const departed = planDueEmails(lib, { [PARA]: [load] }, [info], now).find(item => item.kind === 'departed');
  assert.equal(departed.waitsForSend, true);
});

test('loads that are not booked, or results that failed, plan nothing', () => {
  const info = { ok: true, customer: PARA, loadId: '2283600', trackingLink: 'https://t' };
  assert.deepEqual(planDueEmails(lib, { [PARA]: [bookedLoad({ status: 'OPEN' })] }, [info], now), []);
  assert.equal(planDueEmails(lib, { [PARA]: [bookedLoad()] }, [{ ...info, ok: false }], now).filter(item => item.type === 'customer').length, 0);
});

test('the report matches the bot\'s plan against what the TMS really sent', () => {
  const started = now - 3600000;
  const planned = [
    { key: 'A|1|departed', type: 'customer', kind: 'departed', customer: 'A', loadId: '1' },
    { key: 'A|2|arrived', type: 'customer', kind: 'arrived', customer: 'A', loadId: '2' }
  ];
  let report = updateReport({ startedAt: started }, planned, {}, now);
  assert.deepEqual({ ...report.summary }, { matched: 0, waiting: 2, botOnly: 0, tmsOnly: 0 });
  const record = {
    'A|1|departed': { state: 'sent', at: now + 60000 },
    'A|3|arrived': { state: 'sent', at: now + 60000, customer: 'A', loadId: '3', kind: 'arrived' },
    'rxo|msg1': { state: 'sent', at: now + 60000 }
  };
  report = updateReport(report, [], record, now + 31 * 60000);
  assert.equal(report.emails['A|1|departed'].result, 'matched');
  assert.equal(report.emails['A|2|arrived'].result, 'botOnly', 'due 30+ minutes and never sent by the TMS');
  assert.equal(report.emails['A|3|arrived'].result, 'tmsOnly', 'the TMS sent it, the bot never found it due');
  assert.equal(report.emails['rxo|msg1'], undefined, 'RXO replies are not part of the dry run');
});

test('covered email ids', () => {
  assert.ok(COVERED_ID.test('Para 1522166 - ATZ|2283600|departed'));
  assert.ok(COVERED_ID.test('driver|Para 1522166 - ATZ|2283600|podReminder|2026-11-23'));
  assert.ok(COVERED_ID.test('dailyCustomer|Para 1522166 - ATZ|2283600|2026-11-23'));
  assert.ok(!COVERED_ID.test('driver|Para 1522166 - ATZ|2283600|trackingReminder|2'), 'needs Gmail: later stage');
  for (const key of ['rxo|m1', 'customer|m1', 'paperwork|P|1', 'eta|r1', 'driverStatus|P|1|r', 'checkCall|P|1|t', 'mg|P|1|x']) {
    assert.ok(!COVERED_ID.test(key), key);
  }
});

test('workspace: shared customers\' loads join the personal list, shared copy wins', () => {
  const merged = mergeWorkspace(
    { Mine: [{ id: '1' }], Shared: [{ id: '5', status: 'OPEN' }] },
    ['Shared'],
    [{ customer_name: 'Shared', load_id: '5', data: JSON.stringify({ id: '5', status: 'BOOKED' }) }, { customer_name: 'Shared', load_id: '6', data: { id: '6' } }, { customer_name: 'Other', load_id: '9', data: '{}' }]
  );
  assert.deepEqual(merged.Mine, [{ id: '1' }]);
  assert.deepEqual(merged.Shared.map(load => `${load.id}:${load.status || ''}`), ['5:BOOKED', '6:']);
  assert.equal(merged.Other, undefined);
});
