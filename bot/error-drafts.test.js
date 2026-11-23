const assert = require('node:assert/strict');
const test = require('node:test');
const { planErrorDraftCleanup, describeDraft, draftReasons, ERROR_DRAFT_MIN_AGE_MS } = require('./error-drafts');

// The Anzac, AB draft Landstar rejected on 2026-11-23 (from the saved review report).
const anzac = {
  batchId: 364787, draftId: 8395943,
  listing: {
    originLocality: 'Anzac', originRegion: 'AB', originCountry: 'CA', originZipCode: 'T0P 1J0  ',
    pickupStartDateTime: '2026-11-30T08:00:00', pickupEndDateTime: '2026-11-30T17:00:00',
    destinationLocality: 'EDMONTON INTERNATI', destinationCountry: 'CA', destinationZipCode: 'T9E 0V6  ',
    deliveryEndDateTime: '2026-12-02T16:00:00', commodityTypes: [{ code: 'HAZMAT' }],
    revenue: 1218, customerNumber: '2429200', customerName: 'R X O CAPACITY SOLUTIONS LLC', weight: 9268
  },
  details: {
    validationErrors: [
      { element: 'DestinationLocality', messages: ['Invalid Destination'] },
      { element: 'Miles', messages: ['TMS load must include calculated Miles'] }
    ]
  }
};
const goodLoad = { batchId: 1, draftId: 2, listing: {}, details: { validationErrors: [] } };

test('Landstar reasons are read from validationErrors', () => {
  assert.deepEqual(draftReasons(anzac.details), ['Invalid Destination', 'TMS load must include calculated Miles']);
  assert.deepEqual(draftReasons(null), []);
});

test('only drafts with a Landstar reason are deleted, and only after 10 minutes', () => {
  const seen = {};
  const start = 1_000_000;
  assert.deepEqual(planErrorDraftCleanup([anzac, goodLoad], seen, start), [], 'just seen: wait');
  assert.deepEqual(Object.keys(seen).sort(), ['2', '8395943']);
  assert.deepEqual(planErrorDraftCleanup([anzac, goodLoad], seen, start + ERROR_DRAFT_MIN_AGE_MS - 1), []);
  const due = planErrorDraftCleanup([anzac, goodLoad], seen, start + ERROR_DRAFT_MIN_AGE_MS);
  assert.deepEqual(due.map(draft => draft.draftId), [8395943], 'a good load still posting is never deleted');
});

test('drafts that are gone are forgotten, so a reused id starts its wait again', () => {
  const seen = { 8395943: 1, 777: 1 };
  planErrorDraftCleanup([goodLoad], seen, 5_000_000);
  assert.deepEqual(Object.keys(seen), ['2']);
});

test('a deleted draft is described for the TMS with the posting it matches loads by', () => {
  assert.deepEqual(describeDraft(anzac), {
    draftId: '8395943', batchId: '364787', customer: 'R X O CAPACITY SOLUTIONS LLC', customerNumber: '2429200',
    lane: 'Anzac, AB -> EDMONTON INTERNATI, CA', pickup: '11/30/26 08:00', revenue: 1218, hazmat: true,
    posting: { originZip: 'T0P 1J0', destZip: 'T9E 0V6', pickupThru: '11/30/26 17:00', deliveryThru: '12/02/26 16:00', weight: 9268 },
    reasons: ['Invalid Destination', 'TMS load must include calculated Miles']
  });
});
