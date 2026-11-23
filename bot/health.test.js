const assert = require('node:assert/strict');
const test = require('node:test');
const { buildHealthReport, SIGN_IN_GRACE_MS } = require('./health');

const now = Date.parse('2026-11-23T13:00:00Z');
const running = { state: 'logged-in', message: 'Waiting' };
const allUp = { now, bootedAt: now - 3 * 86400000, botsEnabled: true, postingEnabled: true, watchdog: { state: 'running' },
  upload: running, helper: running, removal: running, rates: running };
const row = (report, id) => report.rows.find(item => item.id === id);

test('everything running: all good', () => {
  const report = buildHealthReport(allUp);
  assert.equal(report.worst, 'ok');
  assert.deepEqual(report.rows.map(item => item.id), ['tms', 'watchdog', 'upload', 'helper', 'removal', 'rates']);
});

test('a stopped bot is red, with how to bring it back', () => {
  let report = buildHealthReport({ ...allUp, removal: { state: 'off' } });
  assert.equal(report.worst, 'bad');
  assert.match(row(report, 'removal').fix, /watchdog brings it back/);
  report = buildHealthReport({ ...allUp, watchdog: { state: 'off' }, removal: { state: 'off' } });
  assert.match(row(report, 'watchdog').fix, /Start Everything \(watchdog\)/);
  assert.match(row(report, 'removal').fix, /Start Removal Bot/, 'no watchdog: start it by hand');
  assert.equal(row(buildHealthReport({ ...allUp, upload: null }), 'upload').level, 'bad', 'unreachable posting bot');
});

test('paused bots and turned-off posting are not errors', () => {
  const paused = buildHealthReport({ ...allUp, botsEnabled: false, helper: { state: 'off' } });
  assert.equal(row(paused, 'switch').level, 'warn');
  assert.equal(row(paused, 'helper').level, 'warn');
  assert.notEqual(paused.worst, 'bad');
  const noPosting = buildHealthReport({ ...allUp, postingEnabled: false, upload: { state: 'off' } });
  assert.equal(row(noPosting, 'upload').level, 'ok');
  assert.match(row(noPosting, 'upload').detail, /off on purpose/);
});

test('a bot stuck signing in asks for the Landstar sign-in', () => {
  const starting = buildHealthReport({ ...allUp, helper: { state: 'signing-in', signingInSince: now - 30000 } });
  assert.equal(row(starting, 'helper').level, 'info', 'just starting');
  const stuck = buildHealthReport({ ...allUp, helper: { state: 'signing-in', signingInSince: now - SIGN_IN_GRACE_MS - 1000 } });
  assert.equal(row(stuck, 'helper').level, 'warn');
  assert.match(row(stuck, 'helper').fix, /Sign in to Landstar/);
});

test('an overnight PC restart is shown', () => {
  const report = buildHealthReport({ ...allUp, bootedAt: now - 6 * 3600000 });
  assert.equal(row(report, 'restart').level, 'info');
  assert.match(row(report, 'restart').detail, /This PC restarted at/);
  assert.equal(row(buildHealthReport(allUp), 'restart'), undefined, 'an old restart is not shown');
});
