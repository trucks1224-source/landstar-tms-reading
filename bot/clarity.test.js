const test = require('node:test');
const assert = require('node:assert/strict');
const { matchClarityLoad, summarizeClarityLoad, trackingLinkFromToken, tractorsOf, billMatchesWatched } = require('./clarity');

const listItem = (orderId, tractorId, billTo, city, start) => ({
  orderId, tractorId, freight: { billToCustomer: billTo },
  origin: { location: { city }, scheduled: { start } },
  nextStop: { id: `${orderId}-1` },
  eta: { estimate: '2026-11-06T13:00:00Z', status: 'OnTime' }
});

test('finds the Paramount freight bill by truck number', () => {
  const list = [
    listItem('1', '420371', 'R X O Capacity Solutions Llc', 'Kearny', '2026-11-06T13:00:00Z'),
    listItem('2', '420371', 'Paramount Transportation Logistics Svcs', 'Newark', '2026-11-01T13:00:00Z'),
    listItem('3', '0420371', 'PARAMOUNT TRANSPORTATION', 'Kearny', '2026-11-06T13:00:00Z')
  ];
  assert.equal(matchClarityLoad(list, { truck: '420371', pickupCity: 'KEARNY' }).orderId, '3');
  assert.equal(matchClarityLoad(list, { truck: '420371', pickupCity: '' }).orderId, '3', 'newest pickup wins');
  assert.equal(matchClarityLoad(list, { truck: '999' }), null);
  assert.equal(matchClarityLoad(list, { truck: '420371', billTo: 'rxo' }).orderId, '1', 'RXO loads match the RXO bill-to');
});

test('reads pickup ETA, arrival and departure from the freight bill', () => {
  const pickup = {
    id: '9-1', stopTypeCode: 'Pickup', isComplete: false, timezone: 'America/New_York',
    location: { city: 'Kearny', state: { code: 'NJ' } }, scheduled: { start: '2026-11-06T13:00:00Z' },
    operators: [{ displayName: 'David Carter' }],
    statusUpdates: [{ description: 'Estimated Time Of Arrival', mulesoftStatusUpdate: { status: { code: 'ETA' }, statusDateTime: '2026-11-05T10:00:00Z' } }]
  };
  const delivery = { id: '9-2', stopTypeCode: 'Delivery', location: { city: 'Jacksonville', state: { code: 'FL' } }, scheduled: { start: '2026-11-07T14:00:00Z' }, timezone: 'America/New_York' };
  const item = { orderId: '9', nextStop: { id: '9-1' }, eta: { estimate: '2026-11-06T12:55:00Z' } };
  let summary = summarizeClarityLoad({ freightBillNumber: '9', stops: [pickup, delivery] }, item);
  assert.equal(summary.pickupEta, '2026-11-06T12:55:00Z');
  assert.equal(summary.arrivedShipperAt, null, 'an ETA is not an arrival');
  assert.equal(summary.pickupCity, 'Kearny, NJ');
  assert.equal(summary.driver, 'David Carter');

  pickup.statusUpdates.push({ description: 'Arrived at Pickup Location', mulesoftStatusUpdate: { status: { code: 'X3' }, statusDateTime: '2026-11-06T13:02:00Z' } });
  summary = summarizeClarityLoad({ stops: [pickup, delivery] }, item);
  assert.equal(summary.arrivedShipperAt, '2026-11-06T13:02:00Z');
  assert.equal(summary.leftShipperAt, null);

  pickup.statusUpdates.push({ description: 'Departed Pickup Location', mulesoftStatusUpdate: { status: { code: 'AF' }, statusDateTime: '2026-11-06T15:00:00Z' } });
  summary = summarizeClarityLoad({ stops: [pickup, delivery] }, { ...item, nextStop: { id: '9-2' }, eta: { estimate: '2026-11-07T13:30:00Z' } });
  assert.equal(summary.leftShipperAt, '2026-11-06T15:00:00Z');
  assert.equal(summary.deliveryEta, '2026-11-07T13:30:00Z');
  assert.equal(summary.pickupEta, null);
});

test('builds the customer tracking link from Clarity\'s token', () => {
  assert.equal(trackingLinkFromToken('Q8b/x+y='), 'https://clarity.landstaronline.com/customer?token=Q8b%2Fx%2By%3D');
  assert.equal(trackingLinkFromToken(''), '');
});

test('a completed delivery stop means delivered', () => {
  const pickup = { id: 'p', stopTypeCode: 'Pickup', isComplete: true, statusUpdates: [] };
  const delivery = { id: 'd', stopTypeCode: 'Delivery', isComplete: false, statusUpdates: [] };
  assert.equal(summarizeClarityLoad({ stops: [pickup, delivery] }, {}).deliveredAt, null);
  delivery.statusUpdates.push({ description: 'Delivered', mulesoftStatusUpdate: { status: { code: 'D1' }, statusDateTime: '2026-11-09T15:00:00Z' } });
  assert.equal(summarizeClarityLoad({ stops: [pickup, delivery] }, {}).deliveredAt, '2026-11-09T15:00:00Z');
  delivery.statusUpdates = [];
  delivery.isComplete = true;
  assert.equal(summarizeClarityLoad({ stops: [pickup, delivery] }, {}).deliveredAt, 'done');
});

test('any customer matches by truck number alone', () => {
  const list = [{ orderId: '7', tractorId: '583737', freight: { billToCustomer: 'Nolan Transportation Group' }, origin: { location: { city: 'Abilene' } } }];
  assert.equal(matchClarityLoad(list, { truck: '583737', billTo: 'any' }).orderId, '7');
  assert.equal(matchClarityLoad(list, { truck: '583737' }), null, 'default is Paramount only');
});

test('a dispatched freight bill opened directly matches by its tractor and bill-to', () => {
  const detail = { customer: { name: 'Paramount Transportation Logistics Svcs' }, stops: [{ tractors: [{ id: '579800' }] }, { tractors: [{ id: '0579800' }] }] };
  const info = { tractors: tractorsOf(detail), customer: detail.customer.name };
  assert.deepEqual(info.tractors, ['579800']);
  assert.equal(billMatchesWatched(info, { truck: '579800', billTo: 'paramount' }), true);
  assert.equal(billMatchesWatched(info, { truck: '579800', billTo: 'rxo' }), false);
  assert.equal(billMatchesWatched(info, { truck: '420371', billTo: 'paramount' }), false);
});
