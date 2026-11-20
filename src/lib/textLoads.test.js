import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTextLoadList } from './textLoads.js';

// Ryan Murray's Square 2570577 list (Google Chat, 2026-11-20), as it pastes.
const ryan = `New Customer and would need truck in hand to send option for coverage. They do not supply rates;

Charlotte, NC 28273 → Cincinnati, OH 45246
HAZMAT · UN2796 SULFURIC ACID · Van · Tanker endorsement · 43,504 lbs · 491 mi · Ref
31474-08698 · PU 06:00–14:00 · DEL Tue 11/24

Jamestown, NC 27282 → Stanley, NC 28164
HAZMAT · UN3082 ENVIRONMENTALL HAZARDOUS SUBSTANCES · Van · Tanker
endorsement · 28,879 lbs · 99 mi · Ref 31434-62505 · DEL Tue 11/24

Charlotte, NC 28273 → Cincinnati, OH 45246
HAZMAT · UN2796 SULFURIC ACID · Van · Tanker endorsement · 39,879 lbs · 491 mi · Ref
31401-76930 · PU 06:00–14:00 · DEL Wed 11/25

Charlotte, NC 28273 → Salisbury, NC 28147
UN2672 AMMONIA SOLUTION · Van · 8,917 lbs · 56 mi · Ref 31468-61510 · PU 06:00–08:00
· DEL Wed 11/25 · 08:00–13:00

Charlotte, NC 28269 → Morganton, NC 28655
HAZMAT · NON-REGULATED MATERIAL, UN1993 FLAMMABLE LIQUIDS · Van · 5,003 lbs ·
79 mi · Ref 31452-93999 · PU APPT 09:00 · DEL Tue 12/1 · 07:00–15:00

Waterloo, IA 50703 → Spartanburg, SC 29302
HAZMAT · UN2693 BISULFITES · Van · Tanker endorsement · 39,858 lbs · 990 mi · Ref
31496-50163 · PU APPT 12:00 · DEL Thu 12/3 · APPT 07:00`;

const now = new Date(2026, 10, 20, 15, 0).getTime();

test('reads all six Square loads from Ryan\'s chat message', () => {
  const { loads, problems } = parseTextLoadList(ryan, { now });
  assert.deepEqual(problems, []);
  assert.deepEqual(loads.map(load => load.id), ['31474-08698', '31434-62505', '31401-76930', '31468-61510', '31452-93999', '31496-50163']);
  const [first, jamestown, , salisbury, morganton, waterloo] = loads;
  assert.equal(first.origZip, '28273');
  assert.equal(first.destCity, 'CINCINNATI');
  assert.equal(first.weight, '43,504 lbs');
  assert.equal(first.miles, '491');
  assert.equal(first.eCode, 'VZ');
  assert.equal(first.pickupTime, '11/23/2026 0600 - 1400', '491 mi: picks up the day before');
  assert.equal(first.deliveryTime, '11/24/2026 0800 - 1600');
  assert.match(first.notes, /TANKER endorsement/);
  assert.match(first.notes, /Pickup day estimated/);
  assert.equal(first.planningComment, 'UN2796 SULFURIC ACID');
  assert.equal(jamestown.pickupTime, '11/24/2026 0600 - 1000', 'short haul, no PU time: same-day morning');
  assert.equal(jamestown.deliveryTime, '11/24/2026 1300 - 1700');
  assert.equal(salisbury.eCode, 'VZ', 'a UN number is hazmat even without the HAZMAT word');
  assert.equal(salisbury.pickupTime, '11/25/2026 0600 - 0800');
  assert.equal(salisbury.deliveryTime, '11/25/2026 0800 - 1300');
  assert.equal(morganton.pickupTime, '12/01/2026 0900 - 0900');
  assert.equal(morganton.deliveryTime, '12/01/2026 0700 - 1500');
  assert.equal(waterloo.pickupTime, '12/01/2026 1200 - 1200', '990 mi: two days before');
  assert.equal(waterloo.deliveryTime, '12/03/2026 0700 - 0700');
});

test('delivery always ends after pickup on same-day loads (Landstar rejects it otherwise)', () => {
  const { loads } = parseTextLoadList('A, NC 28273 → B, NC 28147\nVan · 1,000 lbs · 20 mi · Ref 1-2 · PU 08:00–16:00 · DEL Wed 11/25 · 09:00–12:00', { now });
  assert.equal(loads[0].pickupTime, '11/25/2026 0800 - 1100');
  assert.equal(loads[0].deliveryTime, '11/25/2026 0900 - 1200');
});

test('rows missing what Landstar needs are reported, not guessed; never picks up in the past', () => {
  const { loads, problems } = parseTextLoadList([
    'A, NC 28273 → B, OH 45246', 'Van · 491 mi · Ref 9-9 · DEL Tue 11/24',
    'C, NC 28273 → D, OH 45246', 'Van · 1,000 lbs · 900 mi · Ref 7-7 · DEL Fri 11/20'
  ].join('\n'), { now });
  assert.deepEqual(problems, ['A, NC → B, OH: no weight']);
  assert.match(loads[0].pickupTime, /^11\/20\/2026 /, 'not before today');
});
