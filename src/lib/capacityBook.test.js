import assert from 'node:assert/strict';
import test from 'node:test';
import { lookupTruck, rememberTruck, lookupCarrier, rememberCarrier, fillFromTruck } from './capacityBook.js';

test('a truck saved with its driver comes back by truck number', () => {
  let book = rememberTruck({}, { truck: ' 572203 ', driver: 'Juan Perez', driverPhone: '305-555-0101', trailer: 'T88' }, 1);
  assert.deepEqual(lookupTruck(book, '572203'), { truck: '572203', driver: 'Juan Perez', driverPhone: '305-555-0101', trailer: 'T88', savedAt: 1 });
  assert.equal(rememberTruck(book, { truck: '572203', driver: 'Juan Perez', driverPhone: '305-555-0101', trailer: 'T88' }, 2), book, 'unchanged: same book');
  book = rememberTruck(book, { truck: '572203', driver: 'Juan Perez', trailer: 'T90' }, 3);
  assert.equal(lookupTruck(book, '572203').driverPhone, '305-555-0101', 'a missing phone keeps the saved one');
  assert.equal(lookupTruck(book, '572203').trailer, 'T90');
  assert.equal(rememberTruck(book, { truck: '9', driver: '' }), book, 'no driver: nothing saved');
  assert.equal(lookupTruck(book, 'nope'), null);
});

test('only empty boxes are filled from a saved truck', () => {
  const saved = { driver: 'Juan Perez', driverPhone: '305-555-0101', trailer: 'T88' };
  const { load, filled } = fillFromTruck({ id: 1, truck: '572203', trailer: 'MINE' }, saved);
  assert.deepEqual(load, { id: 1, truck: '572203', driver: 'Juan Perez', driverPhone: '305-555-0101', trailer: 'MINE' });
  assert.deepEqual(filled, ['driver', 'driverPhone']);
});

test('carriers are saved and found by MC number', () => {
  const book = rememberCarrier({}, { carrierMc: 'MC-547847', carrierName: 'Blue Line Freight' }, 5);
  assert.deepEqual(lookupCarrier(book, '547847'), { mc: '547847', name: 'Blue Line Freight', savedAt: 5 });
  assert.equal(rememberCarrier(book, { carrierMc: '547847', carrierName: 'Blue Line Freight' }), book);
  assert.equal(lookupCarrier(book, ''), null);
});
