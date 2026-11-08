// Removes Landstar postings for loads that dropped off a customer's list.
//
// When a customer's list is imported into the TMS (every customer, Nolan included),
// loads that were posted to Landstar and are no longer
// on the list are sent here (status-server.js -> unpost-queue.json). Landstar postings
// carry no customer load number, so a posting is matched on everything the TMS
// exported: origin ZIP, destination ZIP, pickup end, delivery end and weight. Only
// bulk-uploaded postings (SourceSystemID PORTAL) under your own posting codes are
// removed. A request with no matching posting (already gone, or never posted) is
// retried a few times and then dropped.

const path = require('path');
const zipcodes = require('zipcodes');
const { openBoard, OWN_POSTING_CODES } = require('./rate-check');
const { listPostings, cancelPostings, STATES } = require('./dedupe');
const { readQueue, writeQueue, setStatus } = require('./status-server');

const MAX_ATTEMPTS = 3;

const clean = value => String(value ?? '').trim().toUpperCase();

// Board postings that are the exported posting described by `request`.
function findMatchingPostings(boardPostings, request, ownCodes = OWN_POSTING_CODES) {
  const want = request || {};
  const codes = new Set(ownCodes.map(clean));
  return boardPostings.filter(load =>
    clean(load.SourceSystemID) === 'PORTAL'
    && codes.has(clean(load.Agency))
    && clean(load.OriginZipCode) === clean(want.originZip)
    && clean(load.DestinationZipCode) === clean(want.destZip)
    && String(load.PickupThruDateForDisplay || '').trim() === String(want.pickupThru || '').trim()
    && (!want.deliveryThru || String(load.DeliveryThruDateForDisplay || '').trim() === String(want.deliveryThru).trim())
    && (!want.weight || Number(load.Weight) === Number(want.weight)));
}

// Origin states to search: the states of the queued loads' origin ZIPs (all states if any is unknown).
function statesFor(queue) {
  const states = new Set();
  for (const item of queue) {
    const state = zipcodes.lookup(String(item.posting.originZip || '').slice(0, 5))?.state;
    // Canadian postal codes come back with full province names; search everywhere then.
    if (!state || !STATES.includes(state)) return STATES;
    states.add(state);
  }
  return [...states];
}

// Removes the Landstar postings for every queued request it can match; returns how many were removed.
async function processUnpostQueue(context, { log = console.log } = {}) {
  const queue = readQueue();
  if (!queue.length) return 0;
  setStatus('logged-in', `Removing ${queue.length} dropped load(s) from Landstar`);
  log(`Removing ${queue.length} load(s) that are no longer on the customer list from Landstar...`);

  const boardPage = await openBoard(context, log);
  const boardPostings = await listPostings(boardPage, OWN_POSTING_CODES, log, statesFor(queue));

  const loadIds = new Set();
  const outcome = new Map(); // customer|loadId -> 'matched' | 'missing'
  for (const item of queue) {
    const matches = findMatchingPostings(boardPostings, item.posting);
    matches.forEach(load => loadIds.add(load.LoadId));
    outcome.set(`${item.customer}|${item.loadId}`, matches.length ? 'matched' : 'missing');
    log(`  ${item.customer} #${item.loadId}: ${matches.length ? `${matches.length} posting(s) found` : 'no posting found'}`);
  }

  let removed = 0;
  if (loadIds.size) removed = await cancelPostings(boardPage, [...loadIds], log);

  // Re-read: the TMS may have added more while this ran.
  const remaining = readQueue().flatMap(item => {
    const result = outcome.get(`${item.customer}|${item.loadId}`);
    if (result === 'matched') return [];
    if (result === 'missing') {
      const attempts = (item.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        log(`  ${item.customer} #${item.loadId}: still no posting after ${attempts} tries; dropped from the queue.`);
        return [];
      }
      return [{ ...item, attempts }];
    }
    return [item];
  });
  writeQueue(remaining);
  log(`  Removed ${removed} Landstar posting(s).${remaining.length ? ` ${remaining.length} will be retried.` : ''}`);
  return removed;
}

module.exports = { processUnpostQueue, findMatchingPostings, statesFor };

if (require.main === module) {
  const { chromium } = require('playwright');
  (async () => {
    const context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
    try {
      await processUnpostQueue(context);
    } finally {
      await context.close();
    }
  })().catch(error => { console.error('Removing dropped loads failed:', error.message); process.exit(1); });
}
