const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rates-status-'));
process.env.RATES_STATUS_FILE = path.join(root, 'status.json');
process.env.BOT_ROLE = 'rates';
const { readRatesStatus, setStatus } = require('./status-server');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
test('rate status has its own persistent heartbeat and reports real work instead of a ready light', () => {
  assert.equal(readRatesStatus().state, 'off');
  setStatus('signing-in', 'Sign in to Landstar');
  assert.equal(readRatesStatus().state, 'signing-in');
  assert.equal(readRatesStatus().pid, process.pid);
  setStatus('logged-in', 'Rate-checking test export');
  assert.equal(readRatesStatus().state, 'working');
  setStatus('blocked', 'Board unavailable');
  assert.equal(readRatesStatus().message, 'Board unavailable');
  setStatus('logged-in', 'Waiting for exports');
  assert.equal(readRatesStatus().state, 'logged-in');
  setStatus('off', 'Stopped');
  assert.equal(readRatesStatus().state, 'off');
});

test('old heartbeats do not claim a stopped worker is still running', () => {
  fs.writeFileSync(process.env.RATES_STATUS_FILE, JSON.stringify({
    state: 'working', message: 'Old job', at: Date.now() - 120000, pid: process.pid
  }));
  assert.equal(readRatesStatus().state, 'off');
});
