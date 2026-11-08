const test = require('node:test');
const assert = require('node:assert/strict');

// A pretend Landstar board: page.evaluate gets the search body and returns matching postings.
function fakePage(postings, calls) {
  return {
    evaluate: async (_fn, { body }) => {
      calls.push(`${body.Origin.states[0]}>${body.Destination.states[0] || '*'}`);
      return postings.filter(p => p.OriginState === body.Origin.states[0]
        && (!body.Destination.states.length || p.DestinationState === body.Destination.states[0]));
    }
  };
}

const posting = (id, origin, dest) => ({ LoadId: id, OriginState: origin, DestinationState: dest, PickupFromDateForDisplay: '11/07/26 08:00' });
const load = (origin, dest) => ({ originState: origin, destState: dest, pickupDate: '11/07/2026' });

test('one board search per pickup state and date, checked once against the narrow search', async () => {
  delete require.cache[require.resolve('./rate-check')];
  const { boardForLoad } = require('./rate-check');
  const calls = [];
  const page = fakePage([posting(1, 'TX', 'GA'), posting(2, 'TX', 'FL'), posting(3, 'IL', 'GA')], calls);
  const first = await boardForLoad(page, load('TX', 'GA'));
  assert.ok(first.some(p => p.LoadId === 1));
  await boardForLoad(page, load('TX', 'FL'));
  await boardForLoad(page, load('TX', 'OH'));
  await boardForLoad(page, load('IL', 'GA'));
  assert.deepEqual(calls, ['TX>*', 'TX>GA', 'IL>*'], 'TX searched once wide (+1 check), IL once; the rest remembered');
});

test('falls back to one search per lane when the wide search does not match', async () => {
  delete require.cache[require.resolve('./rate-check')];
  const { boardForLoad } = require('./rate-check');
  const calls = [];
  // A board that ignores "any delivery state" and returns nothing for it.
  const page = {
    evaluate: async (_fn, { body }) => {
      calls.push(`${body.Origin.states[0]}>${body.Destination.states[0] || '*'}`);
      return body.Destination.states.length ? [posting(1, 'TX', 'GA')] : [];
    }
  };
  const result = await boardForLoad(page, load('TX', 'GA'));
  assert.deepEqual(result.map(p => p.LoadId), [1]);
  await boardForLoad(page, load('TX', 'FL'));
  assert.deepEqual(calls, ['TX>*', 'TX>GA', 'TX>FL']);
});
