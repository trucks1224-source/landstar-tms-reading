import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRateRaises, getTeamRateRaise, newerHotLanes, teamRateRaisesKey } from './teamData.js';

test('collects the raised loads from a load list', () => {
  const raise = { from: 5941, to: 6235, at: 1 };
  assert.deepEqual(collectRateRaises({
    'R X O': [{ id: '24797030', rateRaise: raise }, { id: '24663631' }],
    Bad: 'not a list'
  }), { 24797030: raise });
  assert.deepEqual(collectRateRaises(null), {});
});

test('newest hot lane import wins', () => {
  const old = { lanes: { a: {} }, importedAt: '2026-11-24T10:00:00Z' };
  const fresh = { lanes: { b: {} }, importedAt: '2026-11-25T10:00:00Z' };
  assert.equal(newerHotLanes(old, fresh), fresh);
  assert.equal(newerHotLanes(fresh, old), fresh);
  assert.equal(newerHotLanes(null, old), old);
  assert.equal(newerHotLanes(null, null), null);
});

test('reads the team raise for a load', () => {
  const values = { [teamRateRaisesKey]: JSON.stringify({ 24742229: { to: 7525 } }) };
  const storage = { getItem: key => values[key] ?? null };
  assert.deepEqual(getTeamRateRaise('24742229', storage), { to: 7525 });
  assert.equal(getTeamRateRaise('111', storage), null);
});
