const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assign-lock-'));
process.env.ASSIGN_QUEUE_FILE = path.join(dir, 'queue.json');
const { claimAssignQueue, reserveAssignment, processAssignQueue, reconcileAssignQueue, findTractorOption, judgeAssignCheck, checkUnconfirmedAssign } = require('./assign');

test('team trucks select the first exact tractor match, not a different tractor', () => {
  const options = ['5818301 - LRGR\nOther truck', '581830 - LRGR\nDriver one', '581830 - LRGR\nDriver two'];
  assert.equal(findTractorOption(options, '581830'), 1);
  assert.equal(findTractorOption(options, '999999'), -1);
});

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

test('a lock left by a stopped worker that never reached Assign is taken over', () => {
  const lock = `${process.env.ASSIGN_QUEUE_FILE}.lock`;
  const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim();
  fs.rmSync(`${process.env.ASSIGN_QUEUE_FILE}.attempts`, { recursive: true, force: true });
  fs.writeFileSync(lock, dead);
  const release = claimAssignQueue();
  assert.equal(typeof release, 'function');
  assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid));
  release();
});

test('a lock left by a stopped worker after an Assign attempt still needs a person', () => {
  const lock = `${process.env.ASSIGN_QUEUE_FILE}.lock`;
  const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(lock, dead);
  assert.equal(reserveAssignment('555000111', '333333'), true);
  assert.throws(() => claimAssignQueue(), /stopped during processing/);
  fs.unlinkSync(lock);
  fs.rmSync(`${process.env.ASSIGN_QUEUE_FILE}.attempts`, { recursive: true, force: true });
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

test('an unconfirmed Assign is judged from the Landstar record, never guessed', () => {
  const rec = obj => ({ httpStatus: 200, body: JSON.stringify(obj) });
  assert.equal(judgeAssignCheck(rec({ status: 'Covered', capacity: { tractorNumber: '540514' } }), '540514').state, 'assigned');
  assert.equal(judgeAssignCheck(rec({ loadStatus: 'Assigned', tractor: '999999' }), '540514').state, 'probably');
  assert.equal(judgeAssignCheck(rec({ loadStatus: 'Available' }), '540514').state, 'available');
  assert.equal(judgeAssignCheck(rec({ weight: 540514 }), '540514').state, 'unknown');
  assert.equal(judgeAssignCheck({ httpStatus: 404, body: '' }, '540514').state, 'probably');
  assert.equal(judgeAssignCheck({ httpStatus: 401, body: '' }, '540514').state, 'unknown');
  assert.equal(judgeAssignCheck(null, '540514').state, 'unknown');
  assert.equal(judgeAssignCheck({ httpStatus: 200, body: '<html>' }, '540514').state, 'unknown');
});

test('only a record naming the truck turns an unconfirmed Assign into assigned', async () => {
  const pageWith = answer => ({ waitForTimeout: async () => {}, evaluate: async () => answer });
  const logs = [];
  const yes = await checkUnconfirmedAssign(pageWith({ httpStatus: 200, body: JSON.stringify({ status: 'Covered', bcoTractor: '540514 - LRGR' }) }),
    '190318597', '540514', '540514 - LRGR / Carrier', m => logs.push(m), 'fallback', 0);
  assert.equal(yes.ok, true);
  assert.match(yes.message, /confirmed on the board/);
  const maybe = await checkUnconfirmedAssign(pageWith({ httpStatus: 404, body: '' }), '190318597', '540514', '', () => {}, 'fallback', 0);
  assert.equal(maybe.ok, false);
  assert.equal(maybe.retry, false);
  assert.equal(maybe.unconfirmed, true);
  assert.match(maybe.message, /probably assigned/);
  const unknown = await checkUnconfirmedAssign(pageWith(null), '190318597', '540514', '', () => {}, 'fallback', 0);
  assert.equal(unknown.retry, false);
  assert.match(unknown.message, /^fallback/);
  fs.rmSync(path.join(__dirname, 'logs', 'assign-check-190318597.json'), { force: true });
});

test('approved carrier (MC #): only one Qualified carrier in the search is ever picked', () => {
  const { pickCarrierOption } = require('./assign');
  assert.equal(pickCarrierOption(['CP*6022 - Toast, NC\nDude Smith Trucking LLC - Qualified']).index, 0);
  assert.match(pickCarrierOption([]).reason, /no carrier found/);
  assert.match(pickCarrierOption(['CP*1 - A - Qualified', 'CP*2 - B - Qualified']).reason, /2 carriers matched.*by hand/);
  assert.match(pickCarrierOption(['CP*1 - X, NC\nY LLC - Not Qualified']).reason, /not Qualified/);
  assert.match(pickCarrierOption(['CP*1 - X, NC\nY LLC']).reason, /not Qualified/, 'no Qualified label');
});
