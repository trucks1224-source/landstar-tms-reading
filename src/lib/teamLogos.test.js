import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTeamLogo, normalizeTeamLogo, nflTeams, teamLogoName, teamLogoSrc } from './teamLogos.js';

test('team logo choices', () => {
  assert.equal(nflTeams.length, 32);
  assert.equal(teamLogoSrc(''), defaultTeamLogo, 'original Eagles artwork');
  assert.equal(teamLogoName(''), 'Eagles artwork');
  assert.match(teamLogoSrc('dal'), /teamlogos\/nfl\/500\/dal\.png/);
  assert.equal(teamLogoName('dal'), 'Dallas Cowboys logo');
  const upload = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(teamLogoSrc(upload), upload);
  assert.equal(normalizeTeamLogo('javascript:alert(1)'), '');
  assert.equal(normalizeTeamLogo('xyz'), '');
  assert.equal(normalizeTeamLogo(`data:image/png;base64,${'A'.repeat(400000)}`), '', 'too big');
});
