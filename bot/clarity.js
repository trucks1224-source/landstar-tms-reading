// Paramount tracking: reads Landstar Clarity (read-only) for loads booked in the TMS.
//
// The TMS sends the booked Paramount loads it is tracking (status-server.js POST /tracking
// -> tracking-watch.json): { key, customer, loadId, truck, pickupCity, pickupState }.
// Every few minutes the bot opens Clarity's freight list, finds each load's freight bill
// (same tractor number, bill-to customer Paramount), opens the freight bill page and
// reports back through GET /status (trackingResults): the customer tracking link from the
// page's "Share Tracking" box, the pickup ETA, and when the truck arrived at / left the
// shipper. Nothing in Clarity is clicked or changed.
//
//   node clarity.js     <- check once by hand (stop the bot first)

const CLARITY = 'https://clarity.landstaronline.com';

const digits = value => String(value || '').replace(/\D/g, '').replace(/^0+/, '');
const lower = value => String(value || '').toLowerCase().replace(/[^a-z]/g, '');

// Bill-to customer names in Clarity for the customers the TMS tracks.
// "any": every other customer (driver emails), matched by truck number alone.
const BILL_TO = { paramount: /paramount/i, rxo: /\br\s*x\s*o\b/i, any: /[\s\S]*/ };

// The freight bill in Clarity's list for a booked TMS load: same tractor number and the
// customer's bill-to (Paramount unless the TMS says RXO or any). With several, the one
// picking up in the load's pickup city wins.
function matchClarityLoad(list, watched) {
  const truck = digits(watched.truck);
  if (!truck) return null;
  const billTo = BILL_TO[watched.billTo] || BILL_TO.paramount;
  const candidates = (list || []).filter(item => digits(item.tractorId) === truck
    && billTo.test(item.freight?.billToCustomer || ''));
  if (candidates.length <= 1) return candidates[0] || null;
  const city = lower(watched.pickupCity);
  const sameCity = candidates.filter(item => city && lower(item.origin?.location?.city) === city);
  const pool = sameCity.length ? sameCity : candidates;
  // Newest pickup first: an old finished load with the same truck shouldn't win.
  return [...pool].sort((a, b) => Date.parse(b.origin?.scheduled?.start || 0) - Date.parse(a.origin?.scheduled?.start || 0))[0];
}

const ARRIVED_CODES = new Set(['X3', 'AA']);
const DEPARTED_CODES = new Set(['AF', 'CP', 'X6']);

function statusTime(update) {
  return update?.mulesoftStatusUpdate?.statusDateTime || update?.timestamp || null;
}

// What the TMS needs from a freight bill: pickup ETA, arrived / left the shipper, delivery ETA.
function summarizeClarityLoad(detail, listItem = {}) {
  const stops = Array.isArray(detail?.stops) ? detail.stops : [];
  const pickup = stops.find(stop => /pick/i.test(stop.stopTypeCode || '')) || stops[0] || null;
  const delivery = [...stops].reverse().find(stop => /deliver|drop|consign/i.test(stop.stopTypeCode || '')) || stops[stops.length - 1] || null;
  const updates = Array.isArray(pickup?.statusUpdates) ? pickup.statusUpdates : [];
  const codeOf = update => String(update?.mulesoftStatusUpdate?.status?.code || '').toUpperCase();
  const textOf = update => `${update?.description || ''} ${update?.mulesoftStatusUpdate?.status?.description || ''}`;
  const arrived = updates.find(update => ARRIVED_CODES.has(codeOf(update)) || /\barriv/i.test(textOf(update)) && !/estimated/i.test(textOf(update)));
  const departed = updates.find(update => DEPARTED_CODES.has(codeOf(update)) || /depart|picked up|loaded|completed/i.test(textOf(update)) && !/estimated/i.test(textOf(update)));
  const nextStopId = String(listItem.nextStop?.id || detail?.nextStop?.id || '');
  const eta = listItem.eta?.estimate || null;
  const pickupDone = Boolean(pickup?.isComplete) || Boolean(departed);
  // Delivered: the delivery stop is complete, or a "delivered" status (EDI D1 / CD).
  const deliveryUpdates = delivery && delivery !== pickup && Array.isArray(delivery.statusUpdates) ? delivery.statusUpdates : [];
  const delivered = deliveryUpdates.find(update => ['D1', 'CD'].includes(codeOf(update))
    || /delivered|completed unloading/i.test(textOf(update)) && !/estimated/i.test(textOf(update)));
  const deliveryDone = Boolean(delivery && delivery !== pickup && (delivery.isComplete || delivered));
  const location = stop => (stop?.location ? `${stop.location.city || ''}, ${stop.location.state?.code || stop.location.state || ''}`.replace(/^, |, $/g, '') : '');
  const operator = (pickup?.operators || [])[0]?.displayName
    || [listItem.operator?.firstName, listItem.operator?.lastName].filter(Boolean).join(' ');
  return {
    freightBill: String(detail?.freightBillNumber || detail?.id || listItem.orderId || ''),
    driver: operator || '',
    pickupCity: location(pickup),
    deliveryCity: location(delivery),
    pickupTimezone: pickup?.timezone || listItem.origin?.location?.timezone || '',
    deliveryTimezone: delivery?.timezone || listItem.destination?.location?.timezone || '',
    pickupScheduled: pickup?.scheduled?.start || listItem.origin?.scheduled?.start || null,
    deliveryScheduled: delivery?.scheduled?.start || listItem.destination?.scheduled?.start || null,
    // The ETA in the list is for the next stop.
    pickupEta: !pickupDone && pickup && nextStopId === String(pickup.id) ? eta : null,
    deliveryEta: pickupDone && delivery && nextStopId === String(delivery.id) ? eta : null,
    etaStatus: listItem.eta?.status || '',
    arrivedShipperAt: statusTime(arrived) || null,
    // Done with no departure time recorded: 'done' (the TMS shows no time for it).
    leftShipperAt: pickupDone || deliveryDone ? (statusTime(departed) || 'done') : null,
    deliveredAt: deliveryDone ? (statusTime(delivered) || 'done') : null,
    lastLocation: listItem.lastLocation ? `${listItem.lastLocation.city || ''}, ${listItem.lastLocation.state || ''}` : '',
    lastLocationAt: listItem.lastLocation?.actualDate || null
  };
}

function trackingLinkFromToken(token) {
  return token ? `${CLARITY}/customer?token=${encodeURIComponent(token)}` : '';
}

// Opens a Clarity page and returns the JSON of the first response whose URL matches.
async function openAndCapture(page, url, patterns, timeout = 45000) {
  const captured = {};
  const waiters = patterns.map(([name, regex]) => page.waitForResponse(
    response => regex.test(response.url()) && response.request().method() === 'GET' && response.ok(),
    { timeout }
  ).then(async response => { captured[name] = await response.json().catch(() => null); }).catch(() => {}));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await Promise.all(waiters);
  return captured;
}

// Tractor numbers and bill-to of freight bills opened directly (dispatched loads that aren't in
// Clarity's freight list yet), so a bill that belongs to no watched truck isn't opened every time.
const openedBills = new Map();

// Tractor numbers on a freight bill's detail (load level and every stop).
function tractorsOf(detail) {
  const ids = [...(detail?.tractors || []), ...(detail?.stops || []).flatMap(stop => stop.tractors || [])]
    .map(tractor => digits(tractor?.id || tractor?.tractorId || tractor));
  return [...new Set(ids.filter(Boolean))];
}

// A dispatched freight bill opened directly matches a watched load: same truck and bill-to.
function billMatchesWatched(info, watched) {
  const billTo = BILL_TO[watched.billTo] || BILL_TO.paramount;
  return info.tractors.includes(digits(watched.truck)) && billTo.test(info.customer || '');
}

// Checks every watched load once. Returns [{ key, ok, ...summary, trackingLink } | { key, ok:false, message }].
// candidateBills: freight bills from Daniel's "BCO Load Detail" emails, opened directly when a
// watched truck isn't in Clarity's freight list (a load dispatched before pickup can be missing).
async function checkTracking(context, watchList, { log = console.log, candidateBills = [] } = {}) {
  if (!watchList.length) return [];
  const page = await context.newPage();
  const results = [];
  const openFreightBill = async freightBill => {
    const captured = await openAndCapture(page, `${CLARITY}/freight/${freightBill}`, [
      ['detail', new RegExp(`/api/load/${freightBill}(\\?|$)`)],
      ['share', /\/api\/viewonly\/generate/]
    ]);
    let link = trackingLinkFromToken(captured.share?.token);
    if (!link) {
      // Read the Share Tracking box as the page shows it.
      link = await page.locator('input[value*="/customer?token="], a[href*="/customer?token="]').first()
        .evaluate(el => el.value || el.href).catch(() => '');
    }
    if (captured.detail) {
      openedBills.set(String(freightBill), { tractors: tractorsOf(captured.detail), customer: captured.detail.customer?.name || '', at: Date.now() });
    }
    return { detail: captured.detail, link };
  };
  try {
    // Ask the list page for more rows than its default 25, so every active load is there.
    await page.route(/clarity\.landstaronline\.com\/api\/load\?/, route => {
      const url = route.request().url().replace(/pageSize=\d+/, 'pageSize=200');
      route.continue({ url });
    });
    const { list } = await openAndCapture(page, `${CLARITY}/freight/list`, [['list', /\/api\/load\?/]], 90000);
    if (!list) throw new Error('Clarity did not load the freight list (signed out?)');
    const rows = Array.isArray(list.data) ? list.data : [];
    log(`  Clarity: ${rows.length} freight bill(s) listed.`);
    const listed = new Set(rows.map(row => String(row.orderId)));
    for (const watched of watchList) {
      const match = matchClarityLoad(rows, watched);
      let freightBill = match ? String(match.orderId) : '';
      let opened = null;
      if (!match) {
        // Not in the list: try the freight bills Daniel just dispatched (BCO Load Detail emails).
        for (const bill of candidateBills.map(String).filter(item => /^\d{5,}$/.test(item) && !listed.has(item))) {
          const known = openedBills.get(bill);
          // Re-read a non-matching bill after 30 minutes (the truck may be assigned since).
          if (known && Date.now() - known.at < 30 * 60 * 1000 && !billMatchesWatched(known, watched)) continue;
          const result = await openFreightBill(bill);
          const info = openedBills.get(bill);
          if (result.detail && info && billMatchesWatched(info, watched)) {
            freightBill = bill;
            opened = result;
            break;
          }
        }
      }
      if (!freightBill) {
        results.push({ key: watched.key, customer: watched.customer, loadId: watched.loadId, ok: false, message: `No ${watched.billTo === 'rxo' ? 'RXO ' : watched.billTo === 'any' ? '' : 'Paramount '}freight bill with truck ${watched.truck} in Clarity yet.` });
        continue;
      }
      const { detail, link } = opened || await openFreightBill(freightBill);
      if (!detail) {
        results.push({ key: watched.key, customer: watched.customer, loadId: watched.loadId, ok: false, message: `Could not read freight bill ${freightBill} in Clarity.` });
        continue;
      }
      const captured = { detail };
      const summary = summarizeClarityLoad(captured.detail, match || {});
      log(`  ${watched.customer} #${watched.loadId}: freight bill ${freightBill}${summary.leftShipperAt ? ', left shipper' : summary.arrivedShipperAt ? ', at shipper' : ''}.`);
      results.push({ key: watched.key, customer: watched.customer, loadId: watched.loadId, ok: true, trackingLink: link, ...summary, freightBill });
    }
  } finally {
    await page.close().catch(() => {});
  }
  return results;
}

module.exports = { matchClarityLoad, summarizeClarityLoad, trackingLinkFromToken, checkTracking, tractorsOf, billMatchesWatched };

if (require.main === module) {
  (async () => {
    const path = require('path');
    const { chromium } = require('playwright');
    const { openBoard } = require('./rate-check');
    const { readTrackingWatch } = require('./status-server');
    const context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
    await openBoard(context, console.log);
    const results = await checkTracking(context, readTrackingWatch());
    console.log(JSON.stringify(results, null, 1));
    await context.close();
  })().catch(error => { console.error(error.message); process.exit(1); });
}
