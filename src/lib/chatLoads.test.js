import assert from 'node:assert/strict';
import test from 'node:test';
import { parseChatLoadMessage, chatLoadAccount, chatLoadRate, chatLoadToTmsLoad, chatLoadEquipmentCode } from './chatLoads.js';

// As Tyler Cook posted it in LANDJA18, 2026-11-27.
const message = `need a solid driver for this one -
Load Number: 24837921
Load Date: 11/30/2026
Pickup: Charlotte NC, 28208 USA
Pickup: 11/30/2026 10:00 - 13:00
Delivery: Cincinnati OH, 45238 USA
Delivery: 12/01/2026 08:00
Distance: 478 mi
Equipment: Van - 53 Feet
Expected Weight: 20000 lbs

$1500`;

test('reads a single-load message from LANDJA18', () => {
  const load = parseChatLoadMessage(message);
  assert.equal(load.loadNumber, '24837921');
  assert.deepEqual({ ...load.origin }, { city: 'CHARLOTTE', state: 'NC', zip: '28208' });
  assert.deepEqual({ ...load.destination }, { city: 'CINCINNATI', state: 'OH', zip: '45238' });
  assert.equal(load.pickupTime, '11/30/2026 1000 - 1300');
  assert.equal(load.deliveryTime, '12/01/2026 0800 - 0800');
  assert.equal(load.miles, 478);
  assert.equal(load.weight, 20000);
  assert.equal(load.equipmentCode, 'V');
  assert.equal(load.price, 1500);
});

test('chat talk is not a load', () => {
  assert.equal(parseChatLoadMessage('pick tom ?'), null);
  assert.equal(parseChatLoadMessage('24806609 I have a driver at 4000'), null);
  assert.equal(parseChatLoadMessage('Load Number: 123456\nPickup: somewhere'), null, 'needs both places and a date');
});

test('account by equipment; price is the higher of Tyler\'s and DAT', () => {
  const load = parseChatLoadMessage(message);
  assert.equal(chatLoadAccount(load), 'R X O 2429200 - ATZ V');
  assert.equal(chatLoadAccount({ equipmentCode: 'R' }), 'R X O 2429200 - ATZ R');
  assert.equal(chatLoadAccount({ equipmentCode: 'F' }), 'R X O 2429200 - ATZ F');
  assert.equal(chatLoadAccount({ equipmentCode: 'SD' }), 'R X O 2429200 - ATZ F');
  assert.equal(chatLoadAccount({ equipmentCode: 'VZ' }), 'R X O 2429200 - ATZ H');
  assert.equal(chatLoadEquipmentCode('Reefer - 53 Feet'), 'R');
  assert.equal(chatLoadEquipmentCode('Van - 53 Feet', 'HAZMAT load'), 'VZ');
  assert.equal(chatLoadEquipmentCode('Flatbed'), 'F');
  assert.equal(chatLoadRate(1500, 1820), 1820);
  assert.equal(chatLoadRate(1500, 1200), 1500);
  assert.equal(chatLoadRate(1500, 0), 1500, 'no DAT rate: his price');
  const tms = chatLoadToTmsLoad(load, 1820.4);
  assert.equal(tms.id, '24837921');
  assert.equal(tms.rateInput, '1820');
  assert.equal(tms.rateSource, 'user-entered');
  assert.equal(tms.origZip, '28208');
  assert.equal(tms.miles, '478');
  assert.equal(tms.weight, '20000 lbs');
});
