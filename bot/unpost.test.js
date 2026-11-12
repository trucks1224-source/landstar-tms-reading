const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

// Never touch the real queue file.
process.env.UNPOST_QUEUE_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'unpost-')), 'queue.json');
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
  assert.deepEqual(matches.map(load => load.LoadId), [1]);
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
  const module = { exports: {} };
  const realRequire = require;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'unpost.js'), 'utf8'), {
    module, exports: module.exports, console, process,
    require: name => {
      if (name === './rate-check') return { openBoard: async () => ({}), OWN_POSTING_CODES: ['ANQ'] };
      if (name === './status-server') return {
        readQueue: () => queue, writeQueue: next => { queue = next; }, setStatus: () => {},
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
  return { run: () => module.exports.processUnpostQueue(null, { log: () => {} }), cancellations, queue: () => queue };
}

test('removals cancel individually and clear requests only after board verification', async () => {
  const worker = removalHarness([]);
  assert.equal(await worker.run(), 2);
  assert.deepEqual(worker.cancellations, [[101], [102]]);
  assert.equal(worker.queue().length, 0);
});

test('accepted cancellations still on the board stay queued and report a retry', async () => {
  const worker = removalHarness([board(102)]);
  await assert.rejects(worker.run(), /still on Landstar/);
  assert.equal(worker.queue().length, 1);
  assert.equal(worker.queue()[0].loadId, '1');
});
