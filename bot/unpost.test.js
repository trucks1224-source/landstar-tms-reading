const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Never touch the real queue file.
process.env.UNPOST_QUEUE_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'unpost-')), 'queue.json');
const { enqueue, readQueue } = require('./status-server');
const { findMatchingPostings, statesFor } = require('./unpost');

const request = { originZip: '60007', destZip: '76063', pickupThru: '11/06/26 13:00', deliveryThru: '11/08/26 07:00', weight: 42000 };
const board = (id, overrides = {}) => ({
  LoadId: id, Agency: 'ANQ ', SourceSystemID: 'PORTAL', OriginZipCode: '60007', DestinationZipCode: '76063',
  PickupThruDateForDisplay: '11/06/26 13:00', DeliveryThruDateForDisplay: '11/08/26 07:00', Weight: 42000, ...overrides
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
