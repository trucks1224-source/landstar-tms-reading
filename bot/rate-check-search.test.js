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

test('rate check: a nearby-town posting of the same load is matched; different loads are not', () => {
  const { isSameLoadNearby } = require('./rate-check');
  const ours = { originZip: '43443', originCity: 'Luckey', originState: 'OH', destZip: '71671', destCity: 'Warren', destState: 'AR', weight: 42000 };
  const huc = { OriginZipCode: '43551', OriginCity: 'PERRYSBURG', OriginState: 'OH', DestinationZipCode: '71654', DestinationCity: 'MCGEHEE', DestinationState: 'AR', Weight: 42000 };
  assert.equal(isSameLoadNearby(ours, huc), false, 'McGehee is ~39 mi from Warren: over the 25-mile limit');
  assert.equal(isSameLoadNearby(ours, { ...huc, DestinationZipCode: '71655', DestinationCity: 'MONTICELLO' }), true, 'Perrysburg 9 mi, Monticello within 25 mi');
  assert.equal(isSameLoadNearby(ours, { ...huc, DestinationZipCode: '', DestinationCity: 'MCGEHEE' }), false, 'unknown place: not guessed');
  const near = { ...huc, DestinationZipCode: '71655', DestinationCity: 'MONTICELLO' };
  assert.equal(isSameLoadNearby(ours, { ...near, Weight: 30000 }), false);
  assert.equal(isSameLoadNearby({ ...ours, weight: 0 }, near), false, 'no weight: not guessed');
  assert.equal(isSameLoadNearby(ours, { ...huc, OriginZipCode: '45202', OriginCity: 'CINCINNATI' }), false, 'origin 180 mi away');
});
