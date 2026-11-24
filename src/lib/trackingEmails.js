// Tracking-email rules shared by the TMS and (later) the email bot: which customer, driver,
// RXO and paperwork emails are due, their text, and how a sent email is recorded on a load.
// Pure functions only: no browser storage, network or timers, so a Node process can use them.
// Moved out of App.jsx unchanged (stage 1 of the email-bot plan).

// Splits a schedule into start/end parts, handling ranges with a full date on both
// sides even when the dash has no spaces (10/29/2026 09:00-10/30/2026 16:00).
export function splitScheduleRange(value) {
  const text = String(value || '').replace(/[–—]/g, '-');
  const spaced = Array.from(
    text.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):?(\d{2})/g)
  ).map(match => `${match[1]}/${match[2]}/${match[3].length === 2 ? `20${match[3]}` : match[3]} ${match[4]}${match[5]}`);
  if (spaced.length >= 2) return spaced;
  const parts = text.split(' - ');
  if (parts.length >= 2) return parts;
  const timeRange = text.match(/^(.*?)-(\d{1,2}:?\d{2}\s*(?:AM|PM)?)$/i);
  return timeRange ? [timeRange[1].trim(), timeRange[2].trim()] : parts;
}

export const rxoCustomerName = 'R X O 2429200 - ATZ';

export const rxoPayerCustomerName = 'R X O 2429200 - ATZ P';

export const ntgCustomerName = 'Nolan 965974 - ATZ H';

export function normalizeCustomerName(name) {
  const normalized = String(name || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized === 'RXO2429200ATZP') {
    return rxoPayerCustomerName;
  }
  if (['NOLAN965974ATZH', 'NTG965974ATZH'].includes(normalized)) {
    return ntgCustomerName;
  }
  if (normalized === 'RXO' || normalized === 'RXL' || normalized === 'RXO2429200ATZ') {
    return rxoCustomerName;
  }
  return String(name || '').trim();
}

export function formatPhone(digits) {
  const value = String(digits || '').replace(/\D/g, '');
  return value.length === 10 ? `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6)}` : value;
}

export const trackingStages = ['Booked', 'Dispatched', 'At Pickup', 'Loaded', 'In Transit', 'At Delivery', 'Delivered'];

// First date/time in a schedule like "11/06/2026 1100 - 1300" as a local timestamp.
export function parseScheduleStart(value) {
  const match = String(splitScheduleRange(value)[0] || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):?(\d{2})/);
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return new Date(year, Number(match[1]) - 1, Number(match[2]), Number(match[4]), Number(match[5])).getTime();
}

export function hasPickupDayStarted(load, now = Date.now()) {
  const pickupAt = parseScheduleStart(load.pickupTime);
  if (!Number.isFinite(pickupAt)) return false;
  const day = new Date(pickupAt);
  day.setHours(0, 0, 0, 0);
  return now >= day.getTime();
}

// Every booked load across all customers, earliest pickup first.
export function getBookedLoads(customerOrdersMap) {
  return Object.entries(customerOrdersMap || {})
    .flatMap(([customer, loads]) => (loads || []).filter(load => load.status === 'BOOKED').map(load => ({ customer, load })))
    .sort((a, b) => {
      return (parseScheduleStart(a.load.pickupTime) ?? Infinity) - (parseScheduleStart(b.load.pickupTime) ?? Infinity);
    });
}

export function formatCheckTime(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' });
}

export const paramountTrackingCustomers = new Set(['PARA1522166ATZ', 'PARA1522166ATZH']);

export const PARAMOUNT_AUTO_SEND_AFTER = 3;

// Arrived at the shipper: always waits for Daniel's Send click (his rule, 2026-11-06).
export const paramountAlwaysAskKinds = new Set(['arrived']);

// Loaded / left the shipper (rule 2026-11-07): sent automatically with the loaded time, unless
// the truck was at the shipper under 15 minutes (or Clarity has no arrival): then Daniel is
// asked whether it really is the loaded time.
export const MIN_LOADING_MINUTES = 15;

export function getLoadedTimeWarning(info = {}) {
  const left = Date.parse(info.leftShipperAt);
  const arrived = Date.parse(info.arrivedShipperAt);
  if (!Number.isFinite(left)) return '';
  if (!Number.isFinite(arrived)) return 'Clarity has no arrival time at the shipper. Is this really the loaded time?';
  const minutes = Math.round((left - arrived) / 60000);
  return minutes < MIN_LOADING_MINUTES
    ? `The truck was at the shipper only ${minutes} min (arrived ${formatParamountTime(info.arrivedShipperAt, info.pickupTimezone)}, left ${formatParamountTime(info.leftShipperAt, info.pickupTimezone)}). Is this really the loaded time?`
    : '';
}

// Check-in / check-out emails (pickup arrived / loaded, delivery arrived / delivered) wait for
// Daniel's Send when the truck's last GPS ping is more than 10 miles from that stop (his rule,
// changed 2026-11-24; it was "under 10 miles" on 2026-11-23). No GPS from Clarity: the usual
// rules apply.
export const NEAR_STOP_HOLD_MILES = 10;

export const checkInOutStops = { arrived: 'pickup', departed: 'pickup', arrivedDelivery: 'delivery', delivered: 'delivery' };

export function milesBetween(a, b) {
  const valid = p => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
  if (!valid(a) || !valid(b)) return null;
  const rad = degrees => (Number(degrees) * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function getNearStopWarning(kind, info = {}) {
  const stop = checkInOutStops[kind];
  if (!stop) return '';
  const miles = milesBetween(info.truckPoint, stop === 'pickup' ? info.pickupPoint : info.deliveryPoint);
  if (miles === null || miles <= NEAR_STOP_HOLD_MILES) return '';
  const place = stop === 'pickup' ? info.pickupCity : info.deliveryCity;
  const asOf = info.lastLocationAt ? ` (as of ${formatParamountTime(info.lastLocationAt, stop === 'pickup' ? info.pickupTimezone : info.deliveryTimezone)})` : '';
  return `The truck's last GPS ping is ${miles.toFixed(1)} mi from the ${stop === 'pickup' ? 'shipper' : 'receiver'}${place ? ` in ${place}` : ''}${asOf}. Is this ${kind === 'arrived' || kind === 'arrivedDelivery' ? 'check-in' : 'check-out'} correct?`;
}

// Every reason a check-in / check-out email must wait for Daniel's Send.
export function getTrackingEmailWarning(kind, info = {}) {
  return [kind === 'departed' ? getLoadedTimeWarning(info) : '', getNearStopWarning(kind, info)].filter(Boolean).join(' ');
}

// Daily location update to the customer while the load is rolling (rule 2026-11-07).
export const LOCATION_EMAIL_HOUR = 9;

// Morning-of-pickup email confirming the driver's ETA to the shipper (rule 2026-11-13).
export const PICKUP_ETA_EMAIL_HOUR = 7;

export const paramountEmailKinds = ['initial', 'arrived', 'departed'];

export const paramountSignatureName = 'Daniel Gomez';

export function isParamountTrackingCustomer(name) {
  return paramountTrackingCustomers.has(normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, ''));
}

// A booked load is tracked in Clarity until it is delivered. Loads booked days ahead of pickup and
// loads still rolling days after booking stay on the list; only a load whose latest date (booked,
// pickup or delivery) is over TRACKING_WATCH_DAYS old drops off, so a load never marked delivered
// doesn't stay forever.
export function isTrackedBookedLoad(load, now = Date.now()) {
  if (load.status !== 'BOOKED' || !String(load.truck || '').trim() || load.trackingStage === 'Delivered') return false;
  const latest = Math.max(...[Date.parse(load.bookedAt), parseScheduleStart(load.pickupTime), parseScheduleStart(load.deliveryTime)]
    .filter(Number.isFinite));
  return !Number.isFinite(latest) || now - latest < TRACKING_WATCH_DAYS * 86400000;
}

// One Clarity watch entry; the freight bill already found lets the bot open it directly when the
// truck no longer shows in Clarity's freight list.
export const trackingWatchEntry = (customer, load, billTo) => ({
  key: `${customer}|${load.id}`, customer, loadId: String(load.id), truck: String(load.truck).trim(),
  pickupCity: load.origCity || '', pickupState: load.origSt || '', billTo,
  ...(load.paramountTracking?.freightBill ? { freightBill: String(load.paramountTracking.freightBill) } : {})
});

// Booked Paramount loads with a truck, not delivered yet.
export function getParamountWatchList(customerOrdersMap, now = Date.now()) {
  return Object.entries(customerOrdersMap || {})
    .filter(([customer]) => isParamountTrackingCustomer(customer))
    .flatMap(([customer, loads]) => (loads || [])
      .filter(load => isTrackedBookedLoad(load, now))
      .map(load => trackingWatchEntry(customer, load, 'paramount')));
}

// "11/06 at 08:00 CST" in the stop's own time zone.
export function formatParamountTime(iso, timeZone) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const options = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' };
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', { ...options, timeZone: timeZone || undefined }).formatToParts(new Date(at));
  } catch {
    parts = new Intl.DateTimeFormat('en-US', options).formatToParts(new Date(at));
  }
  const get = type => parts.find(part => part.type === type)?.value || '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('month')}/${get('day')} at ${hour}:${get('minute')} ${get('timeZoneName')}`.trim();
}

export const titleCase = text => String(text || '').toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase());

export function paramountSignature(phone) {
  return ['Best regards,', paramountSignatureName, 'Landstar', formatPhone(phone) || '484-575-6486'].join('\n');
}

// The email text for one update. info = the bot's Clarity result; greetingName from the thread.
export function buildParamountEmail(kind, load, info = {}, { greetingName = '', phone = '' } = {}) {
  const order = String(load.id);
  const hello = greetingName ? `Hi ${greetingName} and team,` : 'Hello team,';
  const driver = titleCase(info.driver || load.driver || '') || 'our driver';
  const pickupPlace = info.pickupCity || [titleCase(load.origCity), load.origSt].filter(Boolean).join(', ');
  const deliveryPlace = info.deliveryCity || [titleCase(load.destCity), load.destSt].filter(Boolean).join(', ');
  // Pickup ETA: only what Daniel typed in the load's Pickup ETA box, never Clarity's (often wrong).
  const pickupEta = String(load.pickupEta || '').trim();
  const deliveryEta = formatParamountTime(info.deliveryEta || info.deliveryScheduled, info.deliveryTimezone);
  const link = info.trackingLink ? `\n\nHere is the live tracking link for this load, so you can follow the truck at any time:\n${info.trackingLink}` : '';
  const sign = `\n\n${paramountSignature(phone)}`;
  if (kind === 'initial') {
    const pickupTimes = info.leftShipperAt
      ? ` (${info.arrivedShipperAt ? `checked in ${formatParamountTime(info.arrivedShipperAt, info.pickupTimezone)}, ` : ''}loaded and left ${formatParamountTime(info.leftShipperAt, info.pickupTimezone)})`
      : '';
    const status = info.leftShipperAt
      ? `Our driver, ${driver}, has already picked up in ${pickupPlace}${pickupTimes} and is on the way to ${deliveryPlace}${deliveryEta ? `, with an estimated arrival of ${deliveryEta}` : ''}.`
      : `Our driver, ${driver}, is scheduled to pick up in ${pickupPlace}${pickupEta ? `, with an estimated arrival of ${pickupEta}` : ''}.`;
    return `${hello}\n\nThank you so much for trusting us with order ${order}! We truly appreciate the business.${link}\n\n${status}\n\n`
      + 'We will keep you updated right here on this thread when the driver arrives at the shipper and once the truck is loaded and rolling. '
      + 'If you need anything at all, please don\'t hesitate to reach out. We\'re always happy to help.\n\nThank you again, and have a wonderful day!'
      + sign;
  }
  if (kind === 'pickupEta') {
    return `${hello}\n\nGood morning! Quick update on order ${order}: ${driver} is picking up in ${pickupPlace} today`
      + `${pickupEta ? `, with an estimated arrival at the shipper of ${pickupEta}` : ''}. `
      + 'We\'ll confirm as soon as the driver checks in at the shipper.'
      + `${info.trackingLink ? `\n\nLive tracking: ${info.trackingLink}` : ''}\n\nThank you!${sign}`;
  }
  if (kind === 'arrived') {
    return `${hello}\n\nQuick update on order ${order}: ${driver} has arrived at the shipper in ${pickupPlace}`
      + `${info.arrivedShipperAt ? ` (${formatParamountTime(info.arrivedShipperAt, info.pickupTimezone)})` : ''}. `
      + 'We\'ll let you know as soon as the truck is loaded and on the way.'
      + `${info.trackingLink ? `\n\nLive tracking: ${info.trackingLink}` : ''}\n\nThank you!${sign}`;
  }
  if (kind === 'arrivedDelivery') {
    return `${hello}\n\nQuick update on order ${order}: ${driver} has arrived at the receiver in ${deliveryPlace}`
      + `${info.arrivedReceiverAt ? ` (${formatParamountTime(info.arrivedReceiverAt, info.deliveryTimezone)})` : ''}. `
      + 'We\'ll let you know as soon as the truck is unloaded.'
      + `${info.trackingLink ? `\n\nLive tracking: ${info.trackingLink}` : ''}\n\nThank you!${sign}`;
  }
  if (kind === 'delivered') {
    const deliveredAt = formatParamountTime(info.deliveredAt, info.deliveryTimezone);
    return `${hello}\n\nGreat news on order ${order}: the load has been delivered in ${deliveryPlace}`
      + `${deliveredAt ? ` (${deliveredAt})` : ''}. We'll send the signed POD as soon as we have it.`
      + `\n\nThank you so much for working with us, and please reach out if you need anything!${sign}`;
  }
  if (kind === 'location') {
    const where = String(info.lastLocation || '').trim();
    const when = info.lastLocationAt ? ` (as of ${formatParamountTime(info.lastLocationAt, info.deliveryTimezone || info.pickupTimezone)})` : '';
    return `${hello}\n\nDaily update on order ${order}: the truck is in ${where}${when}, on the way to ${deliveryPlace}.`
      + `${deliveryEta ? ` The estimated arrival at delivery is ${deliveryEta}.` : ''}`
      + `${info.trackingLink ? `\n\nLive tracking: ${info.trackingLink}` : ''}\n\nThank you!${sign}`;
  }
  return `${hello}\n\nGreat news on order ${order}: the truck is loaded and has left the shipper in ${pickupPlace}`
    + `${info.leftShipperAt ? ` (${formatParamountTime(info.leftShipperAt, info.pickupTimezone)})` : ''}, heading to ${deliveryPlace}.`
    + `${deliveryEta ? ` The estimated arrival at delivery is ${deliveryEta}.` : ''}`
    + `${info.trackingLink ? `\n\nLive tracking: ${info.trackingLink}` : ''}\n\nThank you for working with us, and please reach out if you need anything!${sign}`;
}

// Which tracking emails are due for a load, given the bot's latest Clarity result.
// The first email needs the tracking link; once the truck has left the shipper, a
// not-yet-sent "arrived" email is skipped (the "left" one covers it).
export function getDueParamountEmails(load, info, now = Date.now()) {
  if (!info?.ok) return [];
  const sent = load.paramountTracking?.emails || {};
  const due = [];
  if (!sent.initial) {
    if (info.trackingLink) due.push('initial');
    return due;
  }
  if (!hasPickupDayStarted(load, now)) return [];
  // Delivered (check-out at the receiver) covers any update not sent yet: Clarity stops
  // reporting once the load is delivered, so it has to be the last email.
  if (info.deliveredAt) return sent.delivered ? [] : ['delivered'];
  if (info.leftShipperAt && !sent.departed) return ['departed'];
  if (info.arrivedReceiverAt && !sent.arrivedDelivery) return ['arrivedDelivery'];
  if (isDailyCustomerUpdateDue(load, info, now)) return ['location'];
  // Morning of pickup: confirm the driver's ETA to the shipper before the truck is there.
  if (!sent.pickupEta && !info.arrivedShipperAt && !info.leftShipperAt) {
    const pickupAt = parseScheduleStart(load.pickupTime);
    if (Number.isFinite(pickupAt) && sameLocalDay(pickupAt, now) && now >= atHourOf(now, PICKUP_ETA_EMAIL_HOUR)) due.push('pickupEta');
  }
  if (info.arrivedShipperAt && !sent.arrived && !info.leftShipperAt) due.push('arrived');
  return due;
}

export function isDailyCustomerUpdateDue(load, tracking, now = Date.now()) {
  if (!hasPickupDayStarted(load, now)) return false;
  if (load.status !== 'BOOKED' || load.trackingStage === 'Delivered' || tracking.deliveredAt) return false;
  if (!tracking.leftShipperAt && !['Loaded', 'In Transit', 'At Delivery'].includes(load.trackingStage)) return false;
  if (!String(tracking.lastLocation || '').replace(/[\s,]/g, '')) return false;
  const checkedAt = Date.parse(tracking.checkedAt);
  if (!Number.isFinite(checkedAt) || now < checkedAt || now - checkedAt > 30 * 60 * 1000) return false;
  const sent = load.paramountTracking?.emails || {};
  // A "left the shipper" email counts as today's update only when the truck actually left
  // today; a late one (bots were off that day) doesn't block today's location email.
  const departedAt = Date.parse(sent.departed?.at);
  const departedCoversToday = Number.isFinite(departedAt) && sameLocalDay(departedAt, now)
    && (!tracking.leftShipperAt || sameLocalDay(Date.parse(tracking.leftShipperAt), departedAt));
  return now >= atHourOf(now, LOCATION_EMAIL_HOUR)
    && !(sent.location?.at && sameLocalDay(Date.parse(sent.location.at), now))
    && !departedCoversToday;
}

// Records a sent (or skipped) email on the load, with a line in its notes.
export function markParamountEmail(load, kind, { at = new Date().toISOString(), skipped = false } = {}) {
  const tracking = load.paramountTracking || {};
  const emails = { ...(tracking.emails || {}), [kind]: { at, ...(skipped ? { skipped: true } : {}) } };
  // Sending "left the shipper" also settles the "arrived" email.
  if (kind === 'departed' && !emails.arrived) emails.arrived = { at, skipped: true };
  // Delivered settles every earlier pickup / delivery update.
  if (kind === 'delivered') {
    for (const earlier of ['arrived', 'departed', 'arrivedDelivery']) emails[earlier] = emails[earlier] || { at, skipped: true };
  }
  if (kind === 'initial' && !skipped && tracking.leftShipperAt) {
    emails.arrived = emails.arrived || { at, skipped: true };
    emails.departed = emails.departed || { at, skipped: true };
  }
  const label = { initial: 'tracking link + pickup ETA', pickupEta: 'morning pickup ETA', arrived: 'arrived at shipper', departed: 'left shipper + delivery ETA', arrivedDelivery: 'arrived at receiver', delivered: 'delivered', location: 'daily location update' }[kind];
  const line = `Paramount email ${skipped ? 'skipped' : 'sent'}: ${label}`;
  return { ...load, paramountTracking: { ...tracking, emails }, notes: load.notes ? `${load.notes}\n${line}` : line };
}

// Saves the bot's Clarity result on the load and moves its tracking stage forward.
export function applyParamountTrackingInfo(load, info) {
  if (!info?.ok) return load;
  const { key, customer, loadId, ok, at, ...rest } = info;
  const next = { ...load, paramountTracking: { ...(load.paramountTracking || {}), ...rest, checkedAt: at || Date.now() } };
  const order = trackingStages.indexOf(load.trackingStage || 'Booked');
  const target = info.deliveredAt ? 'Delivered' : info.arrivedReceiverAt ? 'At Delivery' : info.leftShipperAt ? 'Loaded' : info.arrivedShipperAt ? 'At Pickup' : null;
  if (target && trackingStages.indexOf(target) > order) next.trackingStage = target;
  return next;
}

export const DRIVER_EMAIL_HOUR = 7;

export const TRACKING_WATCH_DAYS = 10;

export const driverEmailLabels = {
  dispatch: 'Driver follow-up: tracking + confirmation + ETA',
  pickupMorning: 'Pickup day: good to go + ETA',
  pickedUp: 'Picked up: delivery ETA',
  deliveryMorning: 'Delivery day: good to go + ETA',
  pod: 'Delivered: send the POD',
  podReminder: 'Paperwork reminder (due within 48 hours)',
  trackingReminder: 'Reminder: start Trucker Tools tracking'
};

export const PAPERWORK_DUE_HOURS = 48;

export const PAPERWORK_REMINDER_DAYS = 7;
// When the load delivered: Clarity's delivery time, else when the stage was set to Delivered.
export function getDeliveredAt(load, tracking = load?.paramountTracking || {}) {
  const fromClarity = Date.parse(tracking.deliveredAt);
  if (Number.isFinite(fromClarity)) return fromClarity;
  // Clarity sometimes reports a finished delivery with no time (deliveredAt: 'done').
  if (!tracking.deliveredAt && (load?.trackingStage || '') !== 'Delivered') return null;
  const call = [...(Array.isArray(load?.checkCalls) ? load.checkCalls : [])].reverse().find(item => item.stage === 'Delivered');
  const at = Date.parse(call?.at);
  if (Number.isFinite(at)) return at;
  // Delivered without any recorded time: when the TMS asked for the POD, else the
  // scheduled delivery - so the paperwork check still picks the load up.
  const podAt = Date.parse(load?.driverEmails?.pod?.at);
  if (Number.isFinite(podAt)) return podAt;
  const scheduled = parseScheduleStart(load?.deliveryTime);
  return Number.isFinite(scheduled) ? scheduled : null;
}

// The customer email thread a driver's POD is forwarded to (Paramount or RXO), or ''.
export function getPaperworkTarget(customer) {
  if (isParamountTrackingCustomer(customer)) return 'paramount';
  if (isRxoTrackingCustomer(customer)) return 'rxo';
  return '';
}

export function getPaperworkSince(load, tracking = load.paramountTracking || {}) {
  const times = [getDeliveredAt(load, tracking), parseScheduleStart(load.deliveryTime), Date.parse(load.bookedAt)]
    .filter(time => Number.isFinite(time) && time > 0);
  return load.paperworkSince || new Date((times.length ? Math.min(...times) : Date.now()) - 86400000).toISOString();
}

// Every booked load with a truck for the bot to find in Clarity (Paramount, RXO, all others).
export function getTrackingWatchList(customerOrdersMap, now = Date.now()) {
  const entries = Object.entries(customerOrdersMap || {})
    .filter(([customer]) => !isParamountTrackingCustomer(customer) && !isRxoTrackingCustomer(customer))
    .flatMap(([customer, loads]) => (loads || [])
      .filter(load => isTrackedBookedLoad(load, now))
      .map(load => trackingWatchEntry(customer, load, 'any')));
  return [...getParamountWatchList(customerOrdersMap, now), ...getRxoWatchList(customerOrdersMap, now), ...entries].slice(0, 50);
}

export const atHourOf = (time, hour) => {
  const date = new Date(time);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
};

export const sameLocalDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

// Which driver email is due now (at most one), given the load and the bot's Clarity data.
export function getDueDriverEmails(load, tracking = {}, now = Date.now()) {
  if (load.status !== 'BOOKED' || !tracking.freightBill) return [];
  const sent = load.driverEmails || {};
  const stage = load.trackingStage || 'Booked';
  const delivered = Boolean(tracking.deliveredAt) || stage === 'Delivered';
  const pickedUp = Boolean(tracking.leftShipperAt) || ['Loaded', 'In Transit', 'At Delivery'].includes(stage);
  if (!delivered && !pickedUp && !sent.dispatch && !sent.pickupMorning) return ['dispatch'];
  if (!hasPickupDayStarted(load, now)) return [];
  if (delivered) {
    if (load.paperworkReceivedAt) return [];
    if (!sent.pod) return ['pod'];
    // No paperwork yet: one reminder each morning (not on the day the POD email went out),
    // for up to a week after delivery.
    const deliveredAt = getDeliveredAt(load, tracking) || Date.parse(sent.pod.at);
    if (now - deliveredAt > PAPERWORK_REMINDER_DAYS * 86400000) return [];
    const remindedToday = [sent.pod.at, sent.podReminder?.at].some(at => at && sameLocalDay(Date.parse(at), now));
    return now >= atHourOf(now, DRIVER_EMAIL_HOUR) && !remindedToday ? ['podReminder'] : [];
  }
  const morning = atHourOf(now, DRIVER_EMAIL_HOUR);
  if (pickedUp) {
    if (!sent.pickedUp) return ['pickedUp'];
    const deliveryAt = parseScheduleStart(load.deliveryTime);
    const askedToday = Date.parse(sent.pickedUp.at) >= morning;
    if (deliveryAt && sameLocalDay(deliveryAt, now) && now >= morning && !sent.deliveryMorning && !askedToday) return ['deliveryMorning'];
    return [];
  }
  const pickupAt = parseScheduleStart(load.pickupTime);
  // Booked after 7 AM on pickup day, or the dispatch email went out this morning: no morning check.
  const bookedBefore = !Date.parse(load.bookedAt) || Date.parse(load.bookedAt) < morning;
  const dispatchedToday = sent.dispatch && Date.parse(sent.dispatch.at) >= morning;
  if (pickupAt && sameLocalDay(pickupAt, now) && now >= morning && !sent.pickupMorning && bookedBefore && !dispatchedToday) return ['pickupMorning'];
  return [];
}

// The tracking app each customer uses: RXO = MacroPoint, Paramount = Trucker Tools.
export function getTrackingAppName(customer) {
  if (isRxoTrackingCustomer(customer)) return 'MacroPoint';
  if (isParamountTrackingCustomer(customer)) return 'Trucker Tools';
  return '';
}

// Very visible at the top of every driver email until delivery.
export function trackingAppNotice(customer) {
  const app = getTrackingAppName(customer);
  const name = app ? `the ${app.toUpperCase()} tracking app` : 'your tracking app';
  return `*** IMPORTANT: PLEASE TURN ON ${name.toUpperCase()} ON THE DAY OF PICKUP ***\n`
    + `Keep ${app || 'it'} on and tracking for the ENTIRE trip, from pickup to delivery. The customer charges back if tracking is not used.\n\n`;
}

export function buildDriverEmail(kind, load, tracking = {}, { phone = '', customer = '' } = {}) {
  const first = titleCase(String(load.driver || '').trim().split(/\s+/)[0] || '');
  const notice = kind === 'pod' || kind === 'podReminder' ? '' : trackingAppNotice(customer);
  const hello = `${first ? `Hi ${first},` : 'Hi,'}\n\n${notice}`.trimEnd();
  const bill = tracking.freightBill ? `load ${tracking.freightBill}` : `load #${load.id}`;
  const pickupPlace = tracking.pickupCity || [titleCase(load.origCity), load.origSt].filter(Boolean).join(', ');
  const deliveryPlace = tracking.deliveryCity || [titleCase(load.destCity), load.destSt].filter(Boolean).join(', ');
  const appt = value => (String(value || '').trim() ? ` (appointment ${String(value).trim()})` : '');
  const sign = `\n\nThank you!\n\n${paramountSignature(phone)}`;
  if (kind === 'dispatch') {
    return `${hello}\n\nThank you for taking ${bill}! Pickup is in ${pickupPlace}${appt(load.pickupTime)} and delivery is in ${deliveryPlace}${appt(load.deliveryTime)}.\n\n`
      + `Please reply to confirm you received the load details and attached documents, and that you will use ${getTrackingAppName(customer) || 'your tracking app'} from pickup day through delivery. Let me know your ETA to the shipper.` + sign;
  }
  if (kind === 'pickupMorning') {
    return `Good morning ${first || ''}`.trim() + `!\n\n${notice}Just checking in on ${bill}, picking up today in ${pickupPlace}${appt(load.pickupTime)}. `
      + 'Are you good to go for pickup? What is your ETA to the shipper?' + sign;
  }
  if (kind === 'trackingReminder') {
    return `${hello}\n\nReminder: Trucker Tools has not confirmed tracking for ${bill} yet (customer load #${load.id}). `
      + 'Please open the Trucker Tools app and start tracking for this load on the day of pickup. '
      + 'If you did not get the Trucker Tools link, or the app is giving you trouble, please reply and let me know right away.' + sign;
  }
  if (kind === 'pickedUp') {
    return `${hello}\n\nThank you for picking up ${bill} in ${pickupPlace}! What is your ETA for delivery in ${deliveryPlace}${appt(load.deliveryTime)}?` + sign;
  }
  if (kind === 'deliveryMorning') {
    return `Good morning ${first || ''}`.trim() + `!\n\n${notice}${bill.charAt(0).toUpperCase()}${bill.slice(1)} delivers today in ${deliveryPlace}${appt(load.deliveryTime)}. `
      + 'Are you good for delivery? What is your ETA?' + sign;
  }
  const chargeBack = `The paperwork must be sent within ${PAPERWORK_DUE_HOURS} hours of delivery, or the customer can charge back.`;
  if (kind === 'podReminder') {
    return `${hello}\n\nReminder: I still need the signed POD / paperwork for ${bill} delivered in ${deliveryPlace}. ${chargeBack} `
      + 'Please reply to this email today with a clear photo or scan of it.' + sign;
  }
  return `${hello}\n\nThank you for delivering ${bill} in ${deliveryPlace}! Please send the signed POD as soon as you can. `
    + `Just reply to this email with a clear photo or scan of it. ${chargeBack}` + sign;
}

// The customer email that goes with the driver's POD files (reply-all on their tracking thread).
export function buildPaperworkEmail(load, tracking = {}, { greetingName = '', phone = '' } = {}) {
  const hello = greetingName ? `Hi ${greetingName},` : 'Hi,';
  const place = tracking.deliveryCity || [titleCase(load.destCity), load.destSt].filter(Boolean).join(', ');
  return `${hello}\n\nAttached is the signed POD / paperwork for order #${load.id}${place ? `, delivered in ${place}` : ''}. `
    + `Please let me know if you need anything else.\n\nThank you!\n\n${paramountSignature(phone)}`;
}

// Records a sent (or skipped) driver email on the load, with a line in its notes.
export function markDriverEmail(load, kind, { at = new Date().toISOString(), skipped = false } = {}) {
  const line = `Driver email ${skipped ? 'skipped' : 'sent'}: ${driverEmailLabels[kind] || kind}`;
  return {
    ...load,
    driverEmails: {
      ...(load.driverEmails || {}),
      [kind]: {
        at, ...(skipped ? { skipped: true } : {}),
        // Tracking reminders repeat: count every one (sent or skipped) so they stay spaced out.
        ...(kind === 'trackingReminder' ? { count: (load.driverEmails?.trackingReminder?.count || 0) + 1 } : {})
      }
    },
    notes: load.notes ? `${load.notes}\n${line}` : line
  };
}

// ---------- Trucker Tools tracking confirmation (Paramount) ----------
// noreply@truckertools.com emails "Load Track has been started - Load Number: <order #>" once
// the driver starts tracking. Until it comes, the driver gets a reminder in the BCO thread:
// the first one 45 minutes after the first driver email, then every 90 minutes, only between
// 7 AM and 9 PM, only from 24 hours before pickup until delivery, at most 6 reminders.
export const TRACKING_REMINDER_FIRST_MINUTES = 45;

export const TRACKING_REMINDER_EVERY_MINUTES = 90;

export const TRACKING_REMINDER_START_HOUR = 7;

export const TRACKING_REMINDER_END_HOUR = 21;

export const TRACKING_REMINDER_MAX = 6;

// The time of the Trucker Tools "tracking started" email for this load (same load number), or ''.
export function findTruckerToolsStart(load, starts) {
  const id = String(load?.id || '').trim();
  if (!id) return '';
  return (starts || []).filter(item => String(item.loadNumber) === id).map(item => item.at).sort()[0] || '';
}

export function markTrackingStarted(load, at, { byHand = false } = {}) {
  const line = byHand ? 'Trucker Tools tracking marked started by hand' : `Trucker Tools tracking started ${formatCheckTime(at)} (email from Trucker Tools)`;
  return { ...load, trackingStartedAt: at, ...(byHand ? { trackingStartedByHand: true } : {}), notes: load.notes ? `${load.notes}\n${line}` : line };
}

// True when a "please start Trucker Tools" reminder should go to the driver now.
export function isTrackingReminderDue(load, customer, tracking = {}, now = Date.now()) {
  if (!hasPickupDayStarted(load, now)) return false;
  if (!isParamountTrackingCustomer(customer) || load.status !== 'BOOKED' || !tracking.freightBill || load.trackingStartedAt) return false;
  if (tracking.deliveredAt || load.trackingStage === 'Delivered') return false;
  const sent = load.driverEmails || {};
  // Waits for the first driver email (the one that asks to turn the app on).
  const first = Object.entries(sent)
    .filter(([kind, item]) => kind !== 'trackingReminder' && !item?.skipped && Date.parse(item?.at))
    .map(([, item]) => Date.parse(item.at)).sort((a, b) => a - b)[0];
  if (!first) return false;
  const hour = new Date(now).getHours();
  if (hour < TRACKING_REMINDER_START_HOUR || hour >= TRACKING_REMINDER_END_HOUR) return false;
  const pickupAt = parseScheduleStart(load.pickupTime);
  if (pickupAt && now < atHourOf(pickupAt, 0)) return false;
  const reminder = sent.trackingReminder;
  if ((reminder?.count || 0) >= TRACKING_REMINDER_MAX) return false;
  const last = Math.max(first, Date.parse(reminder?.at) || 0);
  const wait = reminder ? TRACKING_REMINDER_EVERY_MINUTES : TRACKING_REMINDER_FIRST_MINUTES;
  return now - last >= wait * 60000;
}

// The tracking line on a Paramount load's card, or null for other customers.
export function getTruckerToolsStatus(load, customer, now = Date.now()) {
  if (!isParamountTrackingCustomer(customer)) return null;
  if (!hasPickupDayStarted(load, now)) return null;
  if (load.trackingStartedAt) {
    return { level: 'ok', text: `Tracking started ${formatCheckTime(load.trackingStartedAt)}${load.trackingStartedByHand ? ' (marked by hand)' : ''}` };
  }
  if (load.trackingStage === 'Delivered') return null;
  const count = load.driverEmails?.trackingReminder?.count || 0;
  if (count >= TRACKING_REMINDER_MAX) return { level: 'late', text: `No Trucker Tools tracking yet · ${count} reminders sent · call the driver` };
  return { level: 'waiting', text: `Waiting for Trucker Tools tracking${count ? ` · reminder ${count} sent ${formatCheckTime(load.driverEmails.trackingReminder.at)}` : ''}` };
}

// ---------- Driver ETA -> Paramount ----------
export function getPendingDriverStatusReply(load, replies, now = Date.now()) {
  if (!hasPickupDayStarted(load, now)) return null;
  const latest = (replies || []).filter(reply => ['arrived', 'loaded', 'departed', 'delivered'].includes(reply.status)
    && Date.parse(reply.at) <= now && now - Date.parse(reply.at) <= 24 * 3600000)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (!latest || (load.customerStatusReplyIds || []).includes(latest.id)) return null;
  if (Date.parse(latest.at) <= Date.parse(load.customerStatusReportedAt)) return null;
  return latest;
}

// A driver's reply like "ETA 11 to 11:30 AM" or "I'll be there at 1130": the ETA, or ''.
// Only the driver's own words count (the quoted email below "On ... wrote:" is cut off), and a
// time needs AM/PM or the word ETA next to it, so dates and appointment windows aren't taken.
export function findDriverEta(text) {
  const own = String(text || '').split(/\bOn\b[^\n]{0,120}\bwrote:|-{2,}\s*Original Message|\bFrom:\s|Sent from my|Get Outlook for/i)[0];
  const ampm = value => String(value || '').toUpperCase().replace(/\./g, '');
  const time = (hour, minute) => `${Number(hour)}:${minute || '00'}`;
  const range = own.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|to|and)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i);
  if (range && Number(range[1]) <= 12 && Number(range[4]) <= 12) {
    const first = `${time(range[1], range[2])}${range[3] && ampm(range[3]) !== ampm(range[6]) ? ` ${ampm(range[3])}` : ''}`;
    return `${first} to ${time(range[4], range[5])} ${ampm(range[6])}`;
  }
  const single = own.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i);
  if (single && Number(single[1]) <= 12) return `${time(single[1], single[2])} ${ampm(single[3])}`;
  const military = own.match(/\beta\b[^\d\n]{0,15}(\d{1,2}):?(\d{2})\b/i);
  if (military && Number(military[1]) <= 23 && Number(military[2]) <= 59) return `${String(military[1]).padStart(2, '0')}:${military[2]}`;
  return '';
}

// The email to Paramount's thread with the ETA the driver gave (pickup, or delivery once loaded).
export function buildParamountEtaEmail(load, tracking = {}, eta, { greetingName = '', phone = '' } = {}) {
  const hello = greetingName ? `Hi ${greetingName} and team,` : 'Hello team,';
  const loaded = Boolean(tracking.leftShipperAt) || ['Loaded', 'In Transit', 'At Delivery'].includes(load.trackingStage);
  const place = loaded
    ? tracking.deliveryCity || [titleCase(load.destCity), load.destSt].filter(Boolean).join(', ')
    : tracking.pickupCity || [titleCase(load.origCity), load.origSt].filter(Boolean).join(', ');
  const link = tracking.trackingLink ? `\n\nLive tracking: ${tracking.trackingLink}` : '';
  return `${hello}\n\nQuick update on order ${load.id}: our driver confirmed an ETA of ${eta} to the ${loaded ? 'receiver' : 'shipper'} in ${place}.`
    + `${link}\n\nWe'll keep you posted. Thank you!\n\n${paramountSignature(phone)}`;
}

// ---------- RXO update requests ----------
// RXO tracking emails "Update Request - Order # <order#>" or "Order # <order#>" asking where
// the truck is. For booked loads of R X O 2429200 - ATZ, - ATZ P and - ATZ V, the TMS drafts a
// reply-all with the status and location from Clarity, the pickup ETA Daniel typed (never
// Clarity's), the delivery ETA once loaded, and the tracking link. The first few wait for
// a Send click; after that a reply goes out on its own only when nothing is missing.
export const rxoTrackingCustomers = new Set(['RXO2429200ATZ', 'RXO2429200ATZP', 'RXO2429200ATZV']);

export const RXO_ETA_BLANK = '____';

export function isRxoTrackingCustomer(name) {
  return rxoTrackingCustomers.has(normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, ''));
}

// Every RXO account (R X O 2429200 - ATZ, ATZ H, ATZ P, ATZ V, ATZ F, ATZ R...): their booked loads
// get the same tracking emails as Paramount, on RXO's "RXO - Rate Confirmation - Load <#>" email
// (Daniel's rule, 2026-11-20).
export function isRxoAccount(name) {
  return normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, '').startsWith('RXO2429200');
}

// Which customer tracking-email thread a booked load uses: Paramount's or RXO's rate confirmation.
export function getTrackingEmailBroker(customer) {
  if (isParamountTrackingCustomer(customer)) return 'paramount';
  return isRxoAccount(customer) ? 'rxo' : '';
}

// Booked RXO loads with a truck, for the bot to find in Clarity.
export function getRxoWatchList(customerOrdersMap, now = Date.now()) {
  return Object.entries(customerOrdersMap || {})
    .filter(([customer]) => isRxoTrackingCustomer(customer))
    .flatMap(([customer, loads]) => (loads || [])
      .filter(load => isTrackedBookedLoad(load, now))
      .map(load => trackingWatchEntry(customer, load, 'rxo')));
}

// The booked RXO load an update request is about (same order number), or null.
export function getEmailPostingCode(load, profilePostingCode = '') {
  return String(load?.postingCode || profilePostingCode || '').trim().toUpperCase();
}

export function getRxoEmailPostingCodes(map, profilePostingCode = '') {
  const codes = {};
  for (const [customer, loads] of Object.entries(map || {})) {
    if (!isRxoTrackingCustomer(customer)) continue;
    for (const load of loads || []) {
      const order = String(load.id).trim();
      const code = getEmailPostingCode(load, profilePostingCode);
      codes[order] = Object.prototype.hasOwnProperty.call(codes, order) && codes[order] !== code ? '' : code;
    }
  }
  return codes;
}

export function findRxoLoadForRequest(customerOrdersMap, orderNumber) {
  const order = String(orderNumber || '').trim();
  for (const [customer, loads] of Object.entries(customerOrdersMap || {})) {
    if (!isRxoTrackingCustomer(customer)) continue;
    const load = (loads || []).find(item => String(item.id).trim() === order && item.status === 'BOOKED');
    if (load) return { customer, load };
  }
  return null;
}

// The reply to an RXO update request. complete = nothing left to fill in (may send on its own).
export function buildRxoUpdateEmail(load, tracking = {}, { phone = '', availableOnly = false } = {}) {
  if (availableOnly) {
    const lines = [];
    const delivered = Boolean(load.deliveredAt) || load.trackingStage === 'Delivered';
    const departed = Boolean(tracking.leftShipperAt) || ['In Transit', 'At Delivery'].includes(load.trackingStage);
    if (delivered) lines.push('The load is marked delivered.');
    else if (load.trackingStage === 'At Delivery') lines.push('The driver is at the receiver.');
    else if (departed) lines.push('The driver has left the shipper and is in transit.');
    else if (load.trackingStage === 'Loaded') lines.push('The truck is loaded. Departure has not been confirmed.');
    else if (tracking.arrivedShipperAt || load.trackingStage === 'At Pickup') lines.push('The driver is at the shipper.');
    else lines.push('Current shipment status has not yet been confirmed.');
    if (tracking.lastLocation) {
      const asOf = formatParamountTime(tracking.lastLocationAt || tracking.checkedAt, tracking.pickupTimezone);
      lines.push(`Last reported location: ${tracking.lastLocation}${asOf ? ` (as of ${asOf})` : ''}.`);
    }
    if (!delivered) {
      if (departed || load.trackingStage === 'Loaded') {
        const eta = formatParamountTime(tracking.deliveryEta, tracking.deliveryTimezone);
        lines.push(eta ? `Reported delivery ETA: ${eta}.` : 'Delivery ETA has not yet been confirmed.');
      } else {
        lines.push(String(load.pickupEta || '').trim()
          ? `Reported pickup ETA: ${String(load.pickupEta).trim()}.` : 'Pickup ETA has not yet been confirmed.');
      }
    }
    if (tracking.trackingLink) lines.push(`Live tracking: ${tracking.trackingLink}`);
    return {
      text: `Hello team,\n\nLatest available update for order ${load.id}:\n\n${lines.join('\n')}\n\n${paramountSignature(phone)}`,
      complete: true
    };
  }
  const order = String(load.id);
  const known = Boolean(tracking.freightBill);
  const pickupPlace = tracking.pickupCity || [titleCase(load.origCity), load.origSt].filter(Boolean).join(', ');
  const deliveryPlace = tracking.deliveryCity || [titleCase(load.destCity), load.destSt].filter(Boolean).join(', ');
  const loaded = Boolean(tracking.leftShipperAt) || ['Loaded', 'In Transit', 'At Delivery'].includes(load.trackingStage);
  const atShipper = !loaded && (Boolean(tracking.arrivedShipperAt) || load.trackingStage === 'At Pickup');
  const typedEta = String(load.pickupEta || '').trim();
  const lines = [];
  if (loaded) lines.push(`The truck is loaded and on the way to ${deliveryPlace}.`);
  else if (atShipper) lines.push(`The driver is at the shipper in ${pickupPlace}.`);
  else lines.push(`The driver is empty and heading to the shipper in ${pickupPlace}.`);
  if (tracking.lastLocation) {
    const asOf = formatParamountTime(tracking.lastLocationAt, tracking.pickupTimezone);
    lines.push(`Current location: ${tracking.lastLocation}${asOf ? ` (as of ${asOf})` : ''}`);
  }
  if (!loaded && !atShipper) lines.push(`Pickup ETA: ${typedEta || RXO_ETA_BLANK}`);
  if (loaded) {
    const deliveryEta = formatParamountTime(tracking.deliveryEta || tracking.deliveryScheduled, tracking.deliveryTimezone);
    if (deliveryEta) lines.push(`Delivery ETA: ${deliveryEta}`);
  }
  if (tracking.trackingLink) lines.push(`Live tracking: ${tracking.trackingLink}`);
  const text = `Hello team,\n\nThank you for checking in on order ${order}.\n\n${lines.join('\n')}\n\n`
    + `Please let us know if you need anything else.\n\n${paramountSignature(phone)}`;
  const complete = known && Boolean(tracking.trackingLink) && Boolean(tracking.lastLocation)
    && (loaded || atShipper || Boolean(typedEta));
  return { text, complete };
}

// Booked, not yet delivered loads a customer may ask about: { [load number]: posting code }.
export function getCustomerRequestOrders(customerOrdersMap, profilePostingCode = '') {
  return Object.fromEntries(getBookedLoads(customerOrdersMap)
    .filter(({ load }) => load.trackingStage !== 'Delivered' && /^\d{4,}$/.test(String(load.id)))
    .map(({ load }) => [String(load.id), getEmailPostingCode(load, profilePostingCode)]));
}

// "Heather Locke <heather.locke@rlglobal.com>" -> "Heather"
export function greetingNameFrom(address) {
  const name = String(address || '').replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  const first = name.includes(',') ? name.split(',')[1]?.trim().split(/\s+/)[0] : name.split(/\s+/)[0];
  return /^[A-Za-z][A-Za-z'-]+$/.test(first || '') && !/@/.test(name) ? titleCase(first) : '';
}

// ---------- Email ids (the email record key) ----------
// One id per real email, built the same way by the TMS and the email bot, so the email record
// (bot/email-record.js) recognizes an email whoever sends it. An email that repeats carries what
// makes each one different: the day (daily location, daily customer update, POD reminder) or
// the reminder number (Trucker Tools reminders).
const localDay = now => {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export function trackingEmailId(customer, loadId, kind, now = Date.now()) {
  return `${customer}|${loadId}|${kind}${kind === 'location' ? `|${new Date(now).toDateString()}` : ''}`;
}

export function driverEmailId(customer, load, driverKind, now = Date.now()) {
  const repeat = driverKind === 'trackingReminder' ? `|${(load.driverEmails?.trackingReminder?.count || 0) + 1}`
    : driverKind === 'podReminder' ? `|${localDay(now)}` : '';
  return `driver|${customer}|${load.id}|${driverKind}${repeat}`;
}

export function dailyCustomerEmailId(customer, loadId, now = Date.now()) {
  return `dailyCustomer|${customer}|${loadId}|${localDay(now)}`;
}
