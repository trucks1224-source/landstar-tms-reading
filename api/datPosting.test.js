import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDatLoadBody, readPostingId, createDatPostingService, DAT_REPOST_MINUTES } from './_lib/datPosting.js';

const posting = {
  customer: 'AMERI 18347- ATZ', referenceId: '5001',
  origin: { city: 'Colony', state: 'WY', zip: '' }, destination: { city: 'Red Bluff', state: 'CA', zip: '96080' },
  equipmentType: 'V', lengthFeet: 53, weightPounds: 42000,
  earliestAvailabilityWhen: '2026-11-30T13:00:00.000Z', latestAvailabilityWhen: '2026-11-30T14:00:00.000Z',
  rateUsd: 0, comments: []
};

// A fake DAT: records calls, hands out posting ids, refuses a second live posting with the
// same referenceId (like DAT staging did), and can fail on demand.
function fakeDat() {
  const calls = [];
  const live = new Map();
  let next = 1;
  const fail = { post: null, delete: null };
  const request = async (method, apiPath, body) => {
    calls.push({ method, apiPath, body });
    if (method === 'POST' && apiPath === '/posting/v2/loads') {
      if (fail.post) return { ok: false, status: fail.post, result: { errors: [{ dataPath: '/lane', message: ': DAT is down' }] } };
      if ([...live.values()].includes(body.referenceId)) {
        return { ok: false, status: 422, result: { errors: [{ dataPath: '/referenceId', message: 'The referenceId is already in use' }] } };
      }
      const id = `XS00${next++}`;
      live.set(id, body.referenceId);
      return { ok: true, status: 201, result: { id } };
    }
    if (method === 'DELETE') {
      if (fail.delete) return { ok: false, status: fail.delete, result: { message: 'try later' } };
      const id = apiPath.split('/').pop();
      return live.delete(id) ? { ok: true, status: 200, result: {} } : { ok: false, status: 404, result: {} };
    }
    return { ok: true, status: 200, result: {} };
  };
  return { calls, request, fail, live };
}

const tempStore = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dat-')), 'dat-postings.json');

test('DAT body: lane, equipment, dates; no rate block when the rate is 0; rate as a non-bookable offer', () => {
  const { body, error } = buildDatLoadBody(posting);
  assert.equal(error, undefined);
  assert.deepEqual(body.lane, { origin: { city: 'Colony', stateProv: 'WY' }, destination: { city: 'Red Bluff', stateProv: 'CA', postalCode: '96080' } });
  assert.deepEqual(body.freight, { equipmentType: 'V', fullPartial: 'FULL', lengthFeet: 53, weightPounds: 42000 });
  assert.deepEqual(body.exposure.audience, { loadBoard: { includesExtendedNetwork: false } });
  assert.equal(body.exposure.earliestAvailabilityWhen, '2026-11-30T13:00:00.000Z');
  assert.equal(body.referenceId, '5001');
  assert.equal(buildDatLoadBody({ ...posting, referenceId: '2274611-ALTA' }).body.referenceId, '2274611A', 'DAT allows 8 characters');
  const priced = buildDatLoadBody({ ...posting, rateUsd: 4800, comments: ['HAZMAT'] }).body;
  assert.deepEqual(priced.exposure.audience.loadBoard.transactionDetails, { loadOfferRateUsd: 4800, transactionType: 'NONBOOKABLE_OFFER_RATE' });
  assert.deepEqual(priced.freight.comments, [{ comment: 'HAZMAT' }]);
  assert.match(buildDatLoadBody({ ...posting, equipmentType: 'D-ST' }).error, /equipment/);
  assert.match(buildDatLoadBody({ ...posting, origin: { city: 'Colony' } }).error, /origin/);
  assert.match(buildDatLoadBody({ ...posting, latestAvailabilityWhen: '2026-11-29T00:00:00Z' }).error, /pickup/);
});

test('DAT posting id comes from the reply or its Location header', () => {
  assert.equal(readPostingId({ id: 'XS1' }), 'XS1');
  assert.equal(readPostingId({ postingId: 'XS2' }), 'XS2');
  assert.equal(readPostingId({}, 'https://freight.api.dat.com/posting/v2/loads/XS3'), 'XS3');
  assert.equal(readPostingId({}, ''), '');
});

test(`DAT loads are reposted every ${DAT_REPOST_MINUTES} minutes: old posting deleted, then posted again`, async () => {
  assert.equal(DAT_REPOST_MINUTES, 5);
  let now = Date.parse('2026-11-30T05:00:00Z');
  const dat = fakeDat();
  const service = createDatPostingService({ request: dat.request, storePath: tempStore(), now: () => now });
  const posted = await service.post(posting);
  assert.equal(posted.postingId, 'XS001');
  assert.equal(service.list()[0].body, undefined, 'the list leaves out the request body');

  now += 4 * 60_000;
  assert.deepEqual(await service.repostDue(), { reposted: 0, removed: 0, failed: [] }, 'not yet 5 minutes');
  now += 60_000;
  assert.deepEqual(await service.repostDue(), { reposted: 1, removed: 0, failed: [] });
  const [del, create] = dat.calls.slice(-2);
  assert.equal(del.method, 'DELETE');
  assert.equal(del.apiPath, '/posting/v2/loads/XS001');
  assert.equal(create.method, 'POST');
  assert.deepEqual(create.body, buildDatLoadBody(posting).body, 'same load details');
  assert.deepEqual([...dat.live.keys()], ['XS002'], 'exactly one live posting on DAT');
  const [live] = service.list();
  assert.equal(live.postingId, 'XS002');
  assert.equal(live.referenceId, '5001');
  assert.equal(live.firstPostedAt, '2026-11-30T05:00:00.000Z');
  assert.equal(live.postedAt, '2026-11-30T05:05:00.000Z');
  assert.equal(service.list().length, 1);

  now += 3 * 60_000;
  assert.equal((await service.repostDue()).reposted, 0, 'counts from the last repost');
  now += 2 * 60_000;
  assert.equal((await service.repostDue()).reposted, 1);
  assert.equal(service.list()[0].postingId, 'XS003');

  now = Date.parse('2026-11-30T14:01:00Z');
  assert.deepEqual(await service.repostDue(), { reposted: 0, removed: 1, failed: [] }, 'pickup window over');
  assert.deepEqual([...dat.live.keys()], []);
  assert.deepEqual(service.list(), []);
});

test('repost failures: old posting kept if DAT will not delete it; a failed new post is retried next pass', async () => {
  let now = Date.parse('2026-11-30T05:00:00Z');
  const dat = fakeDat();
  const service = createDatPostingService({ request: dat.request, storePath: tempStore(), now: () => now });
  await service.post(posting);

  now += 5 * 60_000;
  dat.fail.delete = 500;
  const kept = await service.repostDue();
  assert.equal(kept.reposted, 0);
  assert.deepEqual([...dat.live.keys()], ['XS001'], 'old posting still up');
  assert.equal(dat.calls.filter(call => call.method === 'POST').length, 1, 'no second post');
  assert.equal(service.list()[0].lastError, 'try later');

  dat.fail.delete = null;
  dat.fail.post = 503;
  now += 30_000;
  const off = await service.repostDue();
  assert.match(off.failed[0], /^5001: off DAT, reposting next pass: lane DAT is down$/);
  assert.deepEqual([...dat.live.keys()], []);
  assert.equal(service.list()[0].offBoard, true);

  dat.fail.post = null;
  now += 30_000;
  assert.deepEqual(await service.repostDue(), { reposted: 1, removed: 0, failed: [] }, 'posted again right away');
  assert.deepEqual([...dat.live.keys()], ['XS002']);
  const [record] = service.list();
  assert.equal(record.postingId, 'XS002');
  assert.equal(record.offBoard, undefined);
  assert.equal(record.lastError, undefined);
});

test('posting a load again replaces its DAT posting; each account keeps its own', async () => {
  const dat = fakeDat();
  const service = createDatPostingService({ request: dat.request, storePath: tempStore(), now: () => Date.parse('2026-11-30T05:00:00Z') });
  await service.post(posting);
  const again = await service.post(posting);
  assert.equal(again.postingId, 'XS002');
  assert.ok(dat.calls.some(call => call.method === 'DELETE' && call.apiPath === '/posting/v2/loads/XS001'));
  assert.deepEqual(service.list().map(record => record.postingId), ['XS002']);
  await service.post({ ...posting, customer: 'AMERI 18347- ATZ H', referenceId: '5002' });
  assert.equal(service.list().length, 2, 'another account keeps its own posting');
  assert.equal((await service.remove('XS002')).ok, true);
  assert.deepEqual(service.list().map(record => record.postingId), ['XS003']);
});
