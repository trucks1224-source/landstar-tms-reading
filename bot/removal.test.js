const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'removal-status-'));
process.env.BOT_ROLE = 'removal';
process.env.REMOVAL_STATUS_FILE = path.join(dir, 'status.json');
const { setStatus, readRemovalStatus, removalActive } = require('./status-server');

test('removal worker reports its own heartbeat and stops claiming work when off or stale', () => {
  for (const state of ['starting', 'signing-in', 'logged-in', 'working']) {
    setStatus(state, 'Removal worker');
    assert.equal(readRemovalStatus().state, state);
    assert.equal(readRemovalStatus().pid, process.pid);
    assert.equal(removalActive(), true);
  }
  setStatus('off', 'Stopped');
  assert.equal(removalActive(), false);
  fs.writeFileSync(process.env.REMOVAL_STATUS_FILE, JSON.stringify({ state: 'working', at: Date.now() - 91000 }));
  assert.equal(removalActive(), false);
});

test.after(() => {
  fs.rmSync(process.env.REMOVAL_STATUS_FILE, { force: true });
  fs.rmdirSync(dir);
});
