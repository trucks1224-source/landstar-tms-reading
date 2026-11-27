import assert from 'node:assert/strict';
import test from 'node:test';
import { accountKey, isSameAccount, findListedAccount } from './accountAliases.js';

test('new account names count as the old ones', () => {
  assert.equal(accountKey('R X O 2429200 - VAN'), 'RXO2429200ATZV');
  assert.equal(accountKey('R X O 2429200 - Flat'), 'RXO2429200ATZF');
  assert.equal(accountKey('Para 1522166 - N HAZ'), 'PARA1522166ATZ');
  assert.equal(accountKey('Para 1522166 - HAZ'), 'PARA1522166ATZH');
  assert.ok(isSameAccount('R X O 2429200 - REEFER', 'R X O 2429200 - ATZ R'));
  assert.ok(!isSameAccount('Para 1522166 - HAZ', 'Para 1522166 - N HAZ'), 'hazmat and non-hazmat stay apart');
  assert.ok(!isSameAccount('R X O 2429200 - ATZ', 'R X O 2429200 - ATZ V'));
});

test('the customer list spelling is used, the new name first', () => {
  const brokers = ['R X O 2429200 - VAN', 'R X O 2429200 - Panels', 'R X O 2429200 - ATZ P', 'R X O 2429200 - snb'];
  assert.equal(findListedAccount('R X O 2429200 - ATZ V', brokers), 'R X O 2429200 - VAN');
  assert.equal(findListedAccount('R X O 2429200 - ATZ P', brokers), 'R X O 2429200 - Panels');
  assert.equal(findListedAccount('R X O 2429200 - SNB', brokers), 'R X O 2429200 - snb');
  assert.equal(findListedAccount('R X O 2429200 - ATZ R', brokers), '');
});
