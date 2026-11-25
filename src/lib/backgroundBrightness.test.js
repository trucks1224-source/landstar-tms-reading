import test from 'node:test';
import assert from 'node:assert/strict';
import { backgroundShade, clampBrightness } from './backgroundBrightness.js';

test('background shade goes from darker to brighter', () => {
  assert.equal(backgroundShade(0), 'rgba(5, 11, 23, 0.300)', 'original look');
  assert.equal(backgroundShade(-100), 'rgba(5, 11, 23, 0.900)');
  assert.equal(backgroundShade(40), 'rgba(5, 11, 23, 0.000)');
  assert.equal(backgroundShade(100), 'rgba(255, 255, 255, 0.350)');
  assert.equal(clampBrightness('250'), 100);
  assert.equal(clampBrightness('abc'), 0);
});
