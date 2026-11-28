// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { parseScheduleStart, hasPickupDayStarted, titleCase, PAPERWORK_DUE_HOURS, sameLocalDay, getTrackingAppName } from '../lib/trackingEmails.js';
import { getEquipmentDescription } from './equipment.js';
import { parseWeightPounds, normalizeMilesValue } from './screenshotParsers.js';

// Drivers, trucks and trailers already used on any load, for auto-complete.
// When a driver appears on several loads, the most recently booked one wins
// and any missing phone/truck/trailer is filled from their other loads.
function buildDriverDirectory(customerOrdersMap) {
  const clean = value => String(value || '').trim();
  const drivers = new Map();
  const trucks = new Set();
  const trailers = new Set();
  Object.values(customerOrdersMap || {}).flat().forEach(load => {
    const truck = clean(load?.truck);
    const trailer = clean(load?.trailer);
    if (truck) trucks.add(truck);
    if (trailer) trailers.add(trailer);
    const driver = clean(load?.driver);
    if (!driver) return;
    const key = driver.toUpperCase();
    const entry = { driver, driverPhone: clean(load.driverPhone), truck, trailer, at: Date.parse(load.bookedAt) || 0 };
    const known = drivers.get(key);
    if (!known) { drivers.set(key, entry); return; }
    const [newer, older] = entry.at > known.at ? [entry, known] : [known, entry];
    drivers.set(key, {
      ...newer,
      driverPhone: newer.driverPhone || older.driverPhone,
      truck: newer.truck || older.truck,
      trailer: newer.trailer || older.trailer
    });
  });
  const byText = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  return {
    drivers: Array.from(drivers.values()).sort((a, b) => byText(a.driver, b.driver)),
    trucks: Array.from(trucks).sort(byText),
    trailers: Array.from(trailers).sort(byText)
  };
}

// ---------- Booked Loads page & driver tracking ----------

const checkCallDueMs = 4 * 60 * 60 * 1000;

function getLastCheckCall(load) {
  const calls = Array.isArray(load.checkCalls) ? load.checkCalls : [];
  return calls.length ? calls[calls.length - 1] : null;
}

// What needs attention on a booked load: late (red) beats check call due (amber).
function getTrackingAlert(load, now = Date.now()) {
  if (!hasPickupDayStarted(load, now)) return null;
  const stage = load.trackingStage || 'Booked';
  if (stage === 'Delivered') return null;
  const pickupAt = parseScheduleStart(load.pickupTime);
  if (pickupAt && now > pickupAt && ['Booked', 'Dispatched'].includes(stage)) {
    return { level: 'late', text: 'Pickup time passed, not at pickup yet' };
  }
  const deliveryAt = parseScheduleStart(load.deliveryTime);
  if (deliveryAt && now > deliveryAt && stage !== 'At Delivery') {
    return { level: 'late', text: 'Delivery time passed, not delivered' };
  }
  const pickupDay = new Date(pickupAt);
  pickupDay.setHours(0, 0, 0, 0);
  const lastAt = Math.max(Date.parse(getLastCheckCall(load)?.at) || Date.parse(load.bookedAt) || 0, pickupDay.getTime());
  if (Number.isFinite(lastAt) && now - lastAt > checkCallDueMs) {
    return { level: 'due', text: `Check call due (${Math.floor((now - lastAt) / 3600000)}h since last update)` };
  }
  return null;
}

// A short text for the driver, matching where the load is. Kept SMS-short.
function buildDriverText(load, customer = '', now = Date.now()) {
  const first = titleCase(String(load.driver || '').trim().split(/\s+/)[0] || '');
  const hi = `Hi${first ? ` ${first}` : ''}, this is Daniel with Landstar.`;
  const bill = load.paramountTracking?.freightBill ? `load ${load.paramountTracking.freightBill}` : `load #${load.id}`;
  const pickup = [titleCase(load.origCity), load.origSt].filter(Boolean).join(', ');
  const delivery = [titleCase(load.destCity), load.destSt].filter(Boolean).join(', ');
  const app = getTrackingAppName(customer);
  const tracking = ` Please keep ${app || 'your tracking app'} on for the whole trip.`;
  const stage = load.trackingStage || 'Booked';
  if (stage === 'Delivered') {
    if (load.paperworkReceivedAt) return `${hi} Thank you for delivering ${bill} in ${delivery}!`;
    return `${hi} Please send the signed POD for ${bill} (${delivery}) today, just reply to the BCO email with a photo. `
      + `Paperwork is due within ${PAPERWORK_DUE_HOURS} hours of delivery or the customer can charge back.`;
  }
  if (stage === 'At Delivery') return `${hi} Are you unloaded on ${bill} in ${delivery}? Please send the signed POD as soon as you're done.`;
  if (stage === 'Loaded' || stage === 'In Transit') {
    return `${hi} How is ${bill} going? What's your ETA to ${delivery}${load.deliveryTime ? ` (appt ${load.deliveryTime})` : ''}?${tracking}`;
  }
  if (stage === 'At Pickup') return `${hi} Are you loaded yet on ${bill} in ${pickup}? Please send me the BOL photo when you leave.${tracking}`;
  const pickupAt = parseScheduleStart(load.pickupTime);
  const today = pickupAt && sameLocalDay(pickupAt, now) ? ' today' : '';
  return `${hi} Checking on ${bill}, picking up${today} in ${pickup}${load.pickupTime ? ` (appt ${load.pickupTime})` : ''}. `
    + `What's your ETA to the shipper?${app ? ` Please turn on ${app} now.` : ''}`;
}

// ---------- Driver inquiry links ----------

const inquiryCompanyName = 'Landstar';

// Only what a driver should see: no customer name, notes or internal fields.
function buildInquiryDetails(load, profile = {}) {
  const rate = Number(String(load?.rateInput || '').replace(/[$,]/g, ''));
  const phone = String(profile.phone || '').replace(/\D/g, '');
  const weight = parseWeightPounds(load?.weight);
  const miles = Number(normalizeMilesValue(load?.miles));
  return {
    ref: String(load?.id || ''),
    company: inquiryCompanyName,
    callbackPhone: phone.length === 10 ? `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}` : '',
    origin: `${load?.origCity || ''}, ${load?.origSt || ''}`.replace(/^, |, $/g, ''),
    destination: `${load?.destCity || ''}, ${load?.destSt || ''}`.replace(/^, |, $/g, ''),
    pickup: String(load?.pickupTime || ''),
    delivery: String(load?.deliveryTime || ''),
    equipment: getEquipmentDescription(load?.eCode) || String(load?.eCode || ''),
    weight: weight ? `${weight.toLocaleString('en-US')} lbs` : '',
    miles: miles > 0 ? `${Math.round(miles)} mi` : '',
    rate: rate > 0 ? `$${rate.toLocaleString('en-US')}` : ''
  };
}

export {
  buildDriverDirectory,
  checkCallDueMs,
  getLastCheckCall,
  getTrackingAlert,
  buildDriverText,
  inquiryCompanyName,
  buildInquiryDetails
};
