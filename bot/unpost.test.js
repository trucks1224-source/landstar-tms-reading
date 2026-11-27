const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

// Never touch the real queue file.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unpost-'));
process.env.UNPOST_QUEUE_FILE = path.join(tempDir, 'queue.json');
// The tests' own posting code, so this PC's bot/agent-config.json (ANQ, SNB, QNX since
// 2026-11-23) never changes what counts as "mine" here.
process.env.AGENT_CONFIG_FILE = path.join(tempDir, 'agent-config.json');
fs.writeFileSync(process.env.AGENT_CONFIG_FILE, JSON.stringify({ postingCodes: ['ANQ'] }));
const { enqueue, readQueue } = require('./status-server');
const { findMatchingPostings, statesFor, claimUnpostQueue, processUnpostQueue } = require('./unpost');

const request = { originZip: '60007', destZip: '76063', pickupThru: '11/06/26 13:00', deliveryThru: '11/08/26 07:00', weight: 42000 };
const board = (id, overrides = {}) => ({
  LoadId: id, Agency: 'ANQ ', SourceSystemID: 'PORTAL', OriginZipCode: '60007', DestinationZipCode: '76063',
  PickupThruDateForDisplay: '11/06/26 13:00', DeliveryThruDateForDisplay: '11/08/26 07:00', Weight: 42000, ...overrides
});

test('only one worker can process removals at a time', () => {
  const release = claimUnpostQueue();
  assert.equal(typeof release, 'function');
  assert.equal(claimUnpostQueue(), null);
  release();
  const next = claimUnpostQueue();
  assert.equal(typeof next, 'function');
  next();
});

test('an empty queue releases its processing lock without opening a browser', async () => {
  assert.equal(await processUnpostQueue(null), 0);
  const release = claimUnpostQueue();
  assert.equal(typeof release, 'function');
  release();
});

test('matches the exported posting on ZIPs, pickup/delivery end and weight', () => {
  const matches = findMatchingPostings([
    board(1),
    board(2, { PickupThruDateForDisplay: '11/07/26 13:00' }),
    board(3, { Weight: 40000 }),
    board(4, { DestinationZipCode: '76064' }),
    board(5, { Agency: 'JDV' }),
    board(6, { SourceSystemID: 'AW' }),
    board(7, { Agency: 'SNB' })
  ], request);
  assert.deepEqual(matches.map(load => load.LoadId), [1], 'only your own code (ANQ here); JDV and SNB are other agents');
});

test('every one of your posting codes counts as yours (ANQ, SNB and QNX on Daniel\'s PC)', () => {
  const postings = [board(1), board(5, { Agency: 'JDV' }), board(6, { Agency: 'SNB', SourceSystemID: 'AW' }), board(7, { Agency: 'SNB' }), board(8, { Agency: 'QNX' })];
  assert.deepEqual(findMatchingPostings(postings, request, ['ANQ', 'SNB', 'QNX']).map(load => load.LoadId), [1, 7, 8],
    'SNB and QNX postings match; another agent (JDV) and SNB postings from the AW system never do');
});

test('searches only the origin states of the queued loads', () => {
  assert.deepEqual(statesFor([{ posting: { originZip: '60007' } }, { posting: { originZip: '76063' } }]).sort(), ['IL', 'TX']);
  assert.ok(statesFor([{ posting: { originZip: 'H3B 1A1' } }]).length > 50, 'unknown ZIP falls back to every state');
});

test('the queue keeps one entry per customer load and ignores incomplete requests', () => {
  assert.equal(enqueue([
    { customer: 'Para 1522166 - ATZ', loadId: '2282508', posting: request },
    { customer: 'Para 1522166 - ATZ', loadId: '2282508', posting: request },
    { customer: 'Para 1522166 - ATZ', loadId: '9', posting: { originZip: '60007' } }
  ]), 1);
  assert.equal(readQueue()[0].attempts, 0);
  assert.equal(readQueue()[0].posting.weight, 42000);
});

function removalHarness(afterCancellation) {
  let queue = [{ customer: 'Para', loadId: '1', posting: request }];
  let scans = 0;
  const cancellations = [];
  const reports = [];
  const module = { exports: {} };
  const realRequire = require;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'unpost.js'), 'utf8'), {
    module, exports: module.exports, console, process,
    require: name => {
      if (name === './rate-check') return { openBoard: async () => ({}), OWN_POSTING_CODES: ['ANQ'] };
      if (name === './status-server') return {
        readQueue: () => queue, writeQueue: next => { queue = next; }, setStatus: () => {},
        reportRemovalResults: results => reports.push(...results),
        QUEUE_FILE: `${process.env.UNPOST_QUEUE_FILE}.mock`
      };
      if (name === './dedupe') return {
        STATES: ['IL'],
        listPostings: async () => ++scans === 1 ? [board(101), board(102)] : afterCancellation,
        cancelPostings: async (_page, ids) => { cancellations.push(Array.from(ids)); return ids.length; }
      };
      return realRequire(name);
    }
  });
  return { run: () => module.exports.processUnpostQueue(null, { log: () => {} }), cancellations, queue: () => queue, reports, setQueue: next => { queue = next; } };
}

test('removals cancel individually and clear requests only after board verification', async () => {
  const worker = removalHarness([]);
  assert.equal(await worker.run(), 2);
  assert.deepEqual(worker.cancellations, [[101], [102]]);
  assert.equal(worker.queue().length, 0);
  assert.equal(JSON.stringify(worker.reports.map(item => [item.loadId, item.state])), JSON.stringify([['1', 'removed']]), 'the TMS hears the load was removed');
});

test('accepted cancellations still on the board stay queued and report a retry', async () => {
  const worker = removalHarness([board(102)]);
  await assert.rejects(worker.run(), /still on Landstar/);
  assert.equal(worker.queue().length, 1);
  assert.equal(worker.queue()[0].loadId, '1');
  assert.equal(worker.queue()[0].attempts, 1);
});

test('a posting still on Landstar after the last try is dropped and reported as failed', async () => {
  const worker = removalHarness([board(102)]);
  worker.setQueue([{ customer: 'Para', loadId: '1', posting: request, attempts: 2 }]);
  await assert.rejects(worker.run(), /still on Landstar/);
  assert.equal(worker.queue().length, 0);
  assert.equal(worker.reports[0].state, 'failed');
});
