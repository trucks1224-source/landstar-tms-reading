const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-record-'));
process.env.EMAIL_RECORD_FILE = path.join(dir, 'email-record.json');
const record = require('./email-record');

const reset = () => fs.rmSync(record.RECORD_FILE, { force: true });
const ok = body => async () => ({ status: 200, body });

test('an email is sent once; a second send of the same key is refused', async () => {
  reset();
  let sends = 0;
  const send = async () => { sends += 1; return { status: 200, body: { sent: true } }; };
  const first = await record.sendOnce('Para|2283600|departed', { kind: 'departed' }, send);
  assert.equal(first.status, 200);
  const second = await record.sendOnce('Para|2283600|departed', { kind: 'departed' }, send);
  assert.equal(second.status, 409);
  assert.match(second.body.error, /Already sent .* Not sent again/);
  assert.equal(sends, 1);
  assert.equal(record.readRecord()['Para|2283600|departed'].state, 'sent');
});

test('two senders at once: only one gets to send', async () => {
  reset();
  let sends = 0;
  let finish;
  const slow = () => { sends += 1; return new Promise(resolve => { finish = () => resolve({ status: 200, body: {} }); }); };
  const first = record.sendOnce('driver|Para|1|pod', {}, slow);
  const second = await record.sendOnce('driver|Para|1|pod', {}, slow, { by: 'email bot' });
  assert.equal(second.status, 409);
  assert.match(second.body.error, /being sent right now/);
  finish();
  assert.equal((await first).status, 200);
  assert.equal(sends, 1);
});

test('a failed send frees the key so it can be tried again', async () => {
  reset();
  const failed = await record.sendOnce('k1', {}, async () => ({ status: 502, body: { error: 'Gmail down' } }));
  assert.equal(failed.status, 502);
  assert.equal(record.readRecord().k1, undefined);
  await assert.rejects(record.sendOnce('k2', {}, async () => { throw new Error('network'); }), /network/);
  assert.equal(record.readRecord().k2, undefined);
  assert.equal((await record.sendOnce('k1', {}, ok({}))).status, 200, 'retry works');
});

test('a send that never finished becomes unknown: never re-sent, Daniel settles it', async () => {
  reset();
  const start = Date.parse('2026-11-23T14:00:00Z');
  assert.equal(record.claimEmail('crashed', { customer: 'Para', loadId: '1', kind: 'arrived' }, { now: start }).ok, true);
  const later = start + record.SENDING_TIMEOUT_MS + 1000;
  const retry = record.claimEmail('crashed', {}, { now: later });
  assert.equal(retry.ok, false);
  assert.equal(retry.state, 'unknown');
  assert.match(retry.message, /may or may not have gone out/);
  assert.deepEqual(record.listUnknownEmails({ now: later }).map(item => item.key), ['crashed']);
  record.settleUnknownEmail('crashed', false, { now: later });
  assert.equal(record.claimEmail('crashed', {}, { now: later }).ok, true, 'not sent: may be sent again');
  record.markEmailSent('crashed');
  assert.equal(record.listUnknownEmails().length, 0);
});

test('"Don\'t send" is remembered; a sent email stays sent', async () => {
  reset();
  record.markEmailSkipped('skip-me', { kind: 'arrived' });
  const attempt = await record.sendOnce('skip-me', {}, ok({}));
  assert.equal(attempt.status, 409);
  assert.match(attempt.body.error, /Don't send/);
  await record.sendOnce('sent-one', {}, ok({}));
  record.markEmailSkipped('sent-one');
  assert.equal(record.readRecord()['sent-one'].state, 'sent');
});

test('a damaged record file blocks sending instead of allowing re-sends', async () => {
  reset();
  fs.writeFileSync(record.RECORD_FILE, '{ not json');
  assert.throws(() => record.claimEmail('any'), /could not be read/);
  reset();
});

test('a lock left by a crashed process does not block forever', async () => {
  reset();
  const lock = `${record.RECORD_FILE}.lock`;
  fs.writeFileSync(lock, '');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lock, old, old);
  assert.equal(record.claimEmail('after-stale-lock').ok, true);
  assert.equal(fs.existsSync(lock), false);
});
