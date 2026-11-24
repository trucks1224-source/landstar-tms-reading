import test from 'node:test';
import assert from 'node:assert/strict';
import { createSendSpacer, isGmailQuotaError, withGmailQuotaRetry } from './gmailRetry.js';

const quota = () => new Error("Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'");

test('recognizes Gmail quota errors only', () => {
  assert.equal(isGmailQuotaError(quota()), true);
  assert.equal(isGmailQuotaError(new Error('Gmail quota limit reached. Email checks are paused briefly and will retry on the next poll.')), true);
  assert.equal(isGmailQuotaError(new Error('Tracking emails start on pickup day. This email was not sent.')), false);
  assert.equal(isGmailQuotaError(new Error('Rate confirmation not found')), false);
});

test('retries a quota error after waiting, then succeeds', async () => {
  let calls = 0;
  const waits = [];
  const result = await withGmailQuotaRetry(async () => {
    calls++;
    if (calls < 3) throw quota();
    return 'sent';
  }, { sleep: async ms => { waits.push(ms); }, waitMs: 65000 });
  assert.equal(result, 'sent');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [65000, 65000]);
});

test('gives up after the retries and does not retry other errors', async () => {
  let calls = 0;
  await assert.rejects(withGmailQuotaRetry(async () => { calls++; throw quota(); }, { retries: 2, sleep: async () => {} }), /Quota exceeded/);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(withGmailQuotaRetry(async () => { calls++; throw new Error('Load changed'); }, { sleep: async () => {} }), /Load changed/);
  assert.equal(calls, 1);
});

test('spaces sends apart, even after a failed send', async () => {
  let clock = 0;
  const sleeps = [];
  const spaced = createSendSpacer({ gapMs: 3000, now: () => clock, sleep: async ms => { sleeps.push(ms); clock += ms; } });
  const order = [];
  const a = spaced(async () => { order.push('a'); });
  const b = spaced(async () => { order.push('b'); throw new Error('boom'); });
  const c = spaced(async () => { order.push('c'); });
  await a;
  await assert.rejects(b, /boom/);
  await c;
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.deepEqual(sleeps, [3000, 3000]);
});
