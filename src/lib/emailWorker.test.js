import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmailWorker, describeEmailWorker } from './emailWorker.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function lockManager() {
  let owned = false;
  return {
    async request(name, options, run) {
      assert.equal(name, 'landstar-driver-broker-email-worker');
      assert.equal(options.ifAvailable, true);
      if (owned) return run(null);
      owned = true;
      try { return await run({ name }); } finally { owned = false; }
    }
  };
}
function harness(tasks, locks = lockManager()) {
  let clock = 1000;
  let sequence = 0;
  const timers = new Map();
  const statuses = [];
  const worker = createEmailWorker({
    tasks, locks,
    now: () => clock,
    setTimer(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, at: clock + delay });
      return id;
    },
    clearTimer: id => timers.delete(id),
    onStatus: status => statuses.push(status)
  });
  return {
    worker, statuses,
    async next() {
      const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] || [];
      assert.ok(timer, 'a next check is scheduled');
      timers.delete(id);
      clock = timer.at;
      timer.callback();
      await flush();
    },
    get pending() { return timers.size; }
  };
}

test('slow email jobs never overlap and repeated requests coalesce', async () => {
  const gate = deferred();
  const calls = [];
  const app = harness([
    { id: 'driver', label: 'Driver replies', every: 120000, run: async () => { calls.push('driver'); await gate.promise; } },
    { id: 'broker', label: 'Broker requests', every: 120000, run: async () => { calls.push('broker'); } }
  ]);
  try {
    app.worker.start();
    await app.next();
    app.worker.request('broker');
    app.worker.request('broker');
    assert.deepEqual(calls, ['driver']);
    assert.equal(app.pending, 0, 'no second timer races a running job');
    gate.resolve();
    await flush();
    await app.next();
    assert.deepEqual(calls, ['driver', 'broker']);
    await app.next();
    assert.equal(app.statuses.at(-1).state, 'idle');
    assert.equal(app.statuses.at(-1).lastCheckedAt, 1000);
  } finally { gate.resolve(); app.worker.stop(); await flush(); }
});

test('a failed job stays visible, does not stop another job, and clears only after its own successful retry', async () => {
  let failing = true;
  let otherRuns = 0;
  const app = harness([
    { id: 'driver', label: 'Driver replies', every: 120000, run: async () => { if (failing) throw new Error('Gmail connection failed'); } },
    { id: 'broker', label: 'Broker requests', every: 120000, run: async () => { otherRuns++; } }
  ]);
  try {
    app.worker.start();
    await app.next();
    await app.next();
    assert.equal(otherRuns, 1);
    await app.next();
    assert.equal(app.statuses.at(-1).state, 'blocked');
    assert.match(app.statuses.at(-1).issues[0].message, /Gmail connection/);
    failing = false;
    await app.next();
    assert.equal(app.statuses.at(-1).issues.length, 0);
  } finally { app.worker.stop(); await flush(); }
});

test('caught per-load errors still make a completed check need attention', async () => {
  let app;
  app = harness([{ id: 'rxo', label: 'RXO requests', every: 120000, run: async () => {
    app.worker.reportIssue('Order has no matching booked load');
  } }]);
  try {
    app.worker.start();
    await app.next();
    await app.next();
    assert.equal(app.statuses.at(-1).state, 'blocked');
    assert.match(app.statuses.at(-1).issues[0].message, /no matching booked/);
  } finally { app.worker.stop(); await flush(); }
});

test('Gmail quota errors pause all checks for a minute rather than hammering other loads', async () => {
  const calls = [];
  const app = harness([
    { id: 'driver', label: 'Drivers', every: 120000, run: async () => { calls.push('driver'); throw new Error('Gmail quota limit reached'); } },
    { id: 'broker', label: 'Brokers', every: 120000, run: async () => { calls.push('broker'); } }
  ]);
  try {
    app.worker.start();
    await app.next();
    await app.next();
    assert.deepEqual(calls, ['driver']);
    assert.equal(app.statuses.at(-1).state, 'blocked');
    assert.match(app.statuses.at(-1).message, /paused until/);
    await app.next();
    assert.deepEqual(calls, ['driver', 'broker']);
    await app.next();
    assert.equal(app.statuses.at(-1).lastCheckedAt, 61000);
  } finally { app.worker.stop(); await flush(); }
});

test('only one tab owns checks, and closing it hands ownership to standby', async () => {
  const locks = lockManager();
  const calls = [];
  const first = harness([{ id: 'driver', label: 'Drivers', every: 120000, run: async () => { calls.push('first'); } }], locks);
  const second = harness([{ id: 'driver', label: 'Drivers', every: 120000, run: async () => { calls.push('second'); } }], locks);
  try {
    first.worker.start();
    second.worker.start();
    await flush();
    assert.equal(first.worker.isOwner(), true);
    assert.equal(second.worker.isOwner(), false);
    assert.equal(second.statuses.at(-1).state, 'standby');
    await first.next();
    first.worker.stop();
    await flush();
    await second.next();
    await second.next();
    assert.deepEqual(calls, ['first', 'second']);
  } finally { first.worker.stop(); second.worker.stop(); await flush(); }
});

test('cleanup retains ownership until an in-flight send settles', async () => {
  const locks = lockManager();
  const gate = deferred();
  let secondRuns = 0;
  const first = harness([{ id: 'send', label: 'Sending', every: 120000, run: () => gate.promise }], locks);
  const second = harness([{ id: 'send', label: 'Sending', every: 120000, run: async () => { secondRuns++; } }], locks);
  try {
    first.worker.start();
    await first.next();
    first.worker.stop();
    const statusCount = first.statuses.length;
    second.worker.start();
    await flush();
    assert.equal(second.worker.isOwner(), false);
    assert.equal(secondRuns, 0);
    gate.resolve();
    await flush();
    assert.equal(first.statuses.length, statusCount, 'no updates after unmount');
    await second.next();
    await second.next();
    assert.equal(secondRuns, 1);
  } finally { gate.resolve(); first.worker.stop(); second.worker.stop(); await flush(); }
});

test('unavailable browser coordination fails closed with a visible error', () => {
  let ran = false;
  const app = harness([{ id: 'send', label: 'Sending', every: 120000, run: () => { ran = true; } }], {});
  app.worker.start();
  assert.equal(app.statuses.at(-1).state, 'blocked');
  assert.match(app.statuses.at(-1).message, /Web Locks/);
  assert.equal(app.pending, 0);
  assert.equal(ran, false);
  app.worker.stop();
});

test('header distinguishes actual work, blocked sends, approvals and standby', () => {
  assert.equal(describeEmailWorker({ state: 'idle', issues: [] }), 'Email worker: on');
  assert.equal(describeEmailWorker({ state: 'working', message: 'Checking driver replies', issues: [] }),
    'Email worker: Checking driver replies');
  assert.equal(describeEmailWorker({ state: 'idle', issues: [] }, [{ id: 'a' }, { id: 'b', sending: true }]),
    'Email worker: 1 awaiting approval');
  assert.equal(describeEmailWorker({ state: 'idle', issues: [] }, [{ error: 'Gmail failed' }]),
    'Email worker: needs attention');
  assert.equal(describeEmailWorker({ state: 'idle', issues: [{ message: 'Missing load' }] }),
    'Email worker: needs attention');
  assert.equal(describeEmailWorker({ state: 'standby', message: 'Another tab owns checks' }, [{ id: 'a' }]),
    'Another tab owns checks');
});
