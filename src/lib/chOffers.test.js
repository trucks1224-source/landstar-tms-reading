import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNavisphereLoads, chOfferAmount, chEquipmentCode, chLaneKey, CH_OFFER_OVER_DAT } from './chOffers.js';

// Copied from Navisphere's Find Loads page (Ctrl+A, Ctrl+C), 2026-11-25.
const page = `Find Loads
1-50 (of 250) results
Results per page
Sort By
Sort in order ofDescending
Refresh
Origin Information:
San Diego, CA, US
Deadhead Distance from Pickup139.0 mi
Pickup Date
12/01/2026
12:00 PM
Destination Information:
Fresno, CA, US
Drop Off Date
12/02/2026
09:00 AM
Distance352 mi
1 pick, 1 drop
Weight43,703 lbs
Equipment TypeVan
Equipment Size53
Rate
1,560.00 USD
Book or Offer
Origin Information:
Irwindale, CA, US
Deadhead Distance from Pickup22.4 mi
Pickup Date
12/03/2026
03:00 PM
Destination Information:
Laredo, TX, US
Drop Off Date
12/07/2026
09:00 AM
Distance1,381 mi
1 pick, 1 drop
Weight43,911 lbs
Equipment TypeVan
Equipment Size53
Make Offer
Online only
Origin Information:
Tulare, CA, US
Deadhead Distance from Pickup176.6 mi
Pickup Date
11/27/2026
07:00 AM - 12:00 PM
Destination Information:
Mira Loma, CA, US
Drop Off Date
11/28/2026
12:00 AM
Distance220 mi
2 picks, 1 drop
Weight41,600 lbs
EndorsementSTF
Equipment TypeReefer
Equipment Size53
Rate
1,230.00 USD
Book or Offer
Online only
Origin Information:
Torrance, CA, US
Deadhead Distance from Pickup18.4 mi
Pickup Date
12/01/2026
07:00 AM - 02:00 PM
Destination Information:
Fernley, NV, US
Drop Off Date
12/02/2026
09:00 AM
Distance478 mi
1 pick, 1 drop
Weight43,500 lbs
EndorsementTanker
Equipment TypeVan
Equipment Size53
Rate
1,560.00 USD
Book or Offer
Origin Information:
Rancho Cucamonga, CA, US
Deadhead Distance from Pickup43.4 mi
Pickup Date
12/03/2026
03:00 PM
Destination Information:
Santa Maria, CA, US
Drop Off Date
12/04/2026
10:00 AM
Distance210 mi
1 pick, 1 drop
Weight39,848 lbs
Equipment TypeVan
Equipment Size53x102x110
Rate
1,160.00 USD
Book or Offer
Online only
Page 1 of 5
Results per page
`;

test('Navisphere Find Loads text becomes loads (rates, Make Offer, endorsements, time ranges)', () => {
  const { loads, skipped } = parseNavisphereLoads(page);
  assert.equal(skipped, 0);
  assert.equal(loads.length, 5);
  assert.deepEqual(loads[0], {
    loadNumber: '',
    origin: { city: 'San Diego', state: 'CA', country: 'US' },
    destination: { city: 'Fresno', state: 'CA', country: 'US' },
    deadheadMiles: 139, pickupDate: '12/01/2026', pickupTime: '12:00 PM', dropDate: '12/02/2026', dropTime: '09:00 AM',
    miles: 352, stops: '1 pick, 1 drop', weight: 43703, endorsement: '', equipment: 'Van', size: '53',
    chRate: 1560, makeOfferOnly: false, onlineOnly: false, status: '', equipmentCode: 'V',
    key: 'San Diego|CA|Fresno|CA|12/01/2026|12:00 PM|Van|43703'
  });
  assert.equal(loads[1].chRate, null, 'Make Offer: no posted rate');
  assert.equal(loads[1].makeOfferOnly, true);
  assert.equal(loads[1].onlineOnly, false, '"Online only" after a load belongs to the next one');
  assert.equal(loads[2].onlineOnly, true);
  assert.equal(loads[1].miles, 1381);
  assert.equal(loads[2].pickupTime, '07:00 AM - 12:00 PM');
  assert.equal(loads[2].stops, '2 picks, 1 drop');
  assert.equal(loads[2].endorsement, 'STF');
  assert.equal(loads[2].equipmentCode, 'R');
  assert.equal(loads[3].endorsement, 'Tanker');
  assert.equal(loads[4].size, '53x102x110');
  assert.equal(loads[4].origin.city, 'Rancho Cucamonga');
});

test('offer is DAT rate + $500, rounded up to a $25 step ending in 5; nothing without a DAT rate', () => {
  assert.equal(CH_OFFER_OVER_DAT, 500);
  // Rounded up to the next $25 step ending in 5 (..25 or ..75), never under DAT + $500.
  assert.equal(chOfferAmount(1900), 2425);
  assert.equal(chOfferAmount('1899.6'), 2425);
  assert.equal(chOfferAmount(1557), 2075);
  assert.equal(chOfferAmount(1525), 2025, 'already on a step');
  assert.equal(chOfferAmount(1575.01), 2125);
  assert.equal(chOfferAmount(4807), 5325);
  assert.ok([1, 333, 1557, 4999.99, 8750].every(rate => chOfferAmount(rate) % 50 === 25 && chOfferAmount(rate) >= rate + 500 && chOfferAmount(rate) < rate + 550));
  assert.equal(chOfferAmount(0), 0);
  assert.equal(chOfferAmount(undefined), 0);
});

test('equipment codes and shared lane keys', () => {
  assert.equal(chEquipmentCode('Van'), 'V');
  assert.equal(chEquipmentCode('Reefer'), 'R');
  assert.equal(chEquipmentCode('Flatbed'), 'F');
  assert.equal(chEquipmentCode('Step Deck'), 'SD');
  const { loads } = parseNavisphereLoads(page);
  assert.equal(chLaneKey(loads[0]), 'SAN DIEGO|CA|FRESNO|CA|V');
  assert.equal(parseNavisphereLoads('no loads here').loads.length, 0);
});

// The Copy CH loads bookmark (load numbers; labels and values on separate lines), 2026-11-25.
const bookmark = `Load #574648046
Origin Information:
Fresno, CA, US
Deadhead Distance from Pickup
218.9 mi
Pickup Date
12/09/2026
08:00 AM - 12:00 PM
Destination Information:
Charlestown, MA, US
Deadhead Distance to Drop Off
350.9 mi
Drop Off Date
12/14/2026
08:00 AM
Distance
3,064 mi
1 pick, 1 drop
Weight
15,000 lbs
Equipment Type
Van
Equipment Size
53
Make Offer
Load #576222069
Online only
Origin Information:
Fullerton, CA, US
Deadhead Distance from Pickup
23.9 mi
Pickup Date
12/04/2026
07:00 AM - 12:00 PM
Destination Information:
Bohemia, NY, US
Deadhead Distance to Drop Off
213.5 mi
Drop Off Date
12/09/2026
09:00 AM
Distance
2,774 mi
1 pick, 1 drop
Weight
39,682 lbs
Equipment Type
Van
Equipment Size
53
Status
Countered Offer
Rate
8,750.00 USD
04h 08m Book
Load #576195702
Origin Information:
Fullerton, CA, US
Deadhead Distance from Pickup
23.9 mi
Pickup Date
12/02/2026
08:00 AM - 02:00 PM
Destination Information:
Bohemia, NY, US
Deadhead Distance to Drop Off
213.5 mi
Drop Off Date
12/07/2026
09:00 AM
Distance
2,774 mi
1 pick, 1 drop
Weight
41,260 lbs
Equipment Type
Van
Equipment Size
53
Rate
8,400.00 USD
Book or Offer`;

test('the Copy CH loads bookmark text gives load numbers, Online only and offer status per load', () => {
  const { loads, skipped } = parseNavisphereLoads(bookmark);
  assert.equal(skipped, 0);
  assert.deepEqual(Array.from(loads, load => [load.loadNumber, load.origin.city, load.destination.city, load.chRate, load.onlineOnly, load.status, load.miles, load.weight, load.deadheadMiles]), [
    ['574648046', 'Fresno', 'Charlestown', null, false, '', 3064, 15000, 218.9],
    ['576222069', 'Fullerton', 'Bohemia', 8750, true, 'Countered Offer', 2774, 39682, 23.9],
    ['576195702', 'Fullerton', 'Bohemia', 8400, false, '', 2774, 41260, 23.9]
  ]);
  assert.equal(loads[0].equipment, 'Van');
  assert.equal(loads[0].pickupTime, '08:00 AM - 12:00 PM');
  assert.equal(loads[1].key, '576222069', 'the load number identifies the load');
});
