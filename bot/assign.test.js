const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assign-lock-'));
process.env.ASSIGN_QUEUE_FILE = path.join(dir, 'queue.json');
const { claimAssignQueue, reserveAssignment, processAssignQueue, reconcileAssignQueue } = require('./assign');

test('only one worker can process capacity assignments, even across processes', () => {
  const release = claimAssignQueue();
  try {
    assert.equal(claimAssignQueue(), null);
    const child = spawnSync(process.execPath, ['-e',
      "const a=require('./assign'); if(a.claimAssignQueue()!==null) process.exit(1);"],
    { cwd: __dirname, env: process.env, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
  } finally { release(); }
});

test('an empty queue releases its lock without browser access', async () => {
  assert.equal(await processAssignQueue(null), 0);
  assert.equal(fs.existsSync(`${process.env.ASSIGN_QUEUE_FILE}.lock`), false);
});

test('posting reservations survive a worker restart and block another truck too', () => {
  assert.equal(reserveAssignment('123456789', '111111'), true);
  assert.equal(reserveAssignment('123456789', '222222'), false);
  const child = spawnSync(process.execPath, ['-e',
    "const a=require('./assign'); if(a.reserveAssignment('123456789','111111')) process.exit(1);"],
  { cwd: __dirname, env: process.env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});

test('a different posting for the same order cannot be assigned again', () => {
  assert.equal(reserveAssignment('123456790', '111111', 'order-1'), true);
  assert.equal(reserveAssignment('123456791', '222222', 'order-1'), false);
});

test('new truck requests are not removed or retried as an older request', () => {
  const original = { customer: 'RXO', loadId: '1', truck: '111111', attempts: 0 };
  const changed = { ...original, truck: '222222' };
  for (const state of ['done', 'retry']) {
    const done = new Map([['RXO|1', { request: JSON.stringify(original), state }]]);
    assert.deepEqual(reconcileAssignQueue([changed], done), [changed]);
    assert.deepEqual(reconcileAssignQueue([original], done),
      state === 'done' ? [] : [{ ...original, attempts: 1 }]);
  }
});

test('browser errors release the exclusive lock', async () => {
  fs.writeFileSync(process.env.ASSIGN_QUEUE_FILE, JSON.stringify([{ customer: 'RXO', loadId: '1' }]));
  await assert.rejects(processAssignQueue({ newPage: async () => { throw new Error('test browser unavailable'); } }, { log: () => {} }));
  assert.equal(fs.existsSync(`${process.env.ASSIGN_QUEUE_FILE}.lock`), false);
  fs.unlinkSync(process.env.ASSIGN_QUEUE_FILE);
});

test.after(() => {
  for (const name of fs.readdirSync(`${process.env.ASSIGN_QUEUE_FILE}.attempts`)) {
    fs.unlinkSync(path.join(`${process.env.ASSIGN_QUEUE_FILE}.attempts`, name));
  }
  fs.rmdirSync(`${process.env.ASSIGN_QUEUE_FILE}.attempts`);
  fs.rmdirSync(dir);
});
