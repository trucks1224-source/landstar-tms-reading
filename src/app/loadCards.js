// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { rxoCustomerName, normalizeCustomerName } from '../lib/trackingEmails.js';
import { isTeamEquipment, getLandstarEquipmentCode } from './equipment.js';
import { isAmeriCustomer } from './laneRates.js';
import { isHazmatLoad, isTankerLoad, vanEquipmentCodes } from './importRules.js';

// What a load card shows on the left. Loads added by hand start with no route and the
// "PU: Today" / "DFL: Upcoming" placeholders, so the card builds them from the cities and
// pickup/delivery times typed on the load. Imported loads keep their own route and dates.
function getLoadCardRoute(load) {
  if (String(load?.route || '').trim()) return load.route;
  const place = (city, state) => [String(city || '').trim(), String(state || '').trim().toUpperCase()].filter(Boolean).join(', ');
  const origin = place(load?.origCity, load?.origSt);
  const destination = place(load?.destCity, load?.destSt);
  return origin || destination ? `${origin || '?'} → ${destination || '?'}` : '';
}

function getLoadCardDates(load) {
  const dateOf = value => String(value || '').match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/)?.[0] || '';
  const pickup = !load?.puDate || load.puDate === 'PU: Today' ? (dateOf(load?.pickupTime) ? `PU: ${dateOf(load.pickupTime)}` : load?.puDate || '') : load.puDate;
  const delivery = !load?.delDate || load.delDate === 'DFL: Upcoming' ? (dateOf(load?.deliveryTime) ? `DFL: ${dateOf(load.deliveryTime)}` : load?.delDate || '') : load.delDate;
  return `${pickup} ${delivery}`.trim();
}

function hasLoadRate(load) {
  return Number(String(load?.rateInput || '').replace(/[$,]/g, '')) > 0;
}

// The numbers on a load card (Daniel 2026-11-27, clearer cards): the rate as "$9,351" (or no
// rate), miles, $/mile, and when it went to Landstar ("↑ 10:42 AM" today, "↑ 11/26" before).
function getLoadCardFacts(load, now = new Date()) {
  const rate = Number(String(load?.rateInput || '').replace(/[$,]/g, '')) || 0;
  const miles = Number(String(load?.miles || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0]) || 0;
  const perMile = getRatePerMile(rate, miles);
  const exportedAt = Date.parse(load?.landstarExportedAt || '');
  let exported = '';
  if (Number.isFinite(exportedAt)) {
    const when = new Date(exportedAt);
    exported = when.toDateString() === now.toDateString()
      ? when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : `${when.getMonth() + 1}/${when.getDate()}`;
  }
  return {
    rateText: rate > 0 ? `$${rate.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '',
    milesText: miles > 0 ? `${Math.round(miles).toLocaleString('en-US')} mi` : '',
    perMileText: perMile ? `$${perMile}/mi` : '',
    exported
  };
}

// How urgent a load is, for its color (Daniel 2026-11-27): 'past' = pickup day already gone,
// 'today' = picks up today, 'unsent' = open and never exported to Landstar, '' = nothing.
// Booked loads are never colored (past pickup just means the truck is on the road).
function getLoadUrgency(load, now = new Date()) {
  if (!load || load.status === 'BOOKED') return '';
  const pickup = getPickupSortValue(load);
  if (pickup !== Number.MAX_SAFE_INTEGER) {
    const day = new Date(pickup);
    const pickupDay = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    if (pickupDay < today) return 'past';
    if (pickupDay === today) return 'today';
  }
  if (load.status === 'OPEN' && !load.landstarExportedAt) return 'unsent';
  return '';
}

function getRatePerMile(rate, miles) {
  const rateValue = Number(String(rate || '').replace(/[$,]/g, ''));
  // Miles can arrive with a unit suffix from broker exports, e.g. '396.3 miles'.
  const mileValue = Number(String(miles || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0]);
  if (!(rateValue > 0) || !(mileValue > 0)) return '';
  return (rateValue / mileValue).toFixed(2);
}

function getDisplayEquipmentCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (code === 'VE') return 'VAN';
  return isTeamEquipment(code) ? 'V' : value;
}

// R X O 2429200 - ATZ only (not ATZ P): van loads priced from DAT post under the DAT rate.
// Under $1,000: $50 less; $1,000 to under $1,600: $100 less; $1,600 to $3,500: $200 less;
// over $3,500: $300 less. Hazmat and tanker loads keep the full rate (hazmat must stay highest).
// When another agent has the load on the board, the bot posts their rate + $25 instead.
function getRxoAtzDatVanDiscount(customer, load, rate) {
  if (normalizeCustomerName(customer) !== rxoCustomerName) return 0;
  if (!['dat-api', 'dat-screenshot'].includes(load?.rateSource)) return 0;
  if (!vanEquipmentCodes.has(getLandstarEquipmentCode(load?.eCode))) return 0;
  if (isHazmatLoad(load) || isTankerLoad(load)) return 0;
  if (!(rate > 0)) return 0;
  if (rate < 1000) return 50;
  if (rate < 1600) return 100;
  if (rate <= 3500) return 200;
  return 300;
}

function getPickupSortValue(order) {
  const text = String(order.pickupTime || order.puDate || '');
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b(?:\s+(\d{2})(\d{2}))?/);
  if (us) {
    const year = us[3].length === 2 ? Number(`20${us[3]}`) : Number(us[3]);
    return Date.UTC(year, Number(us[1]) - 1, Number(us[2]), Number(us[4] || 0), Number(us[5] || 0));
  }
  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  return iso ? Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : Number.MAX_SAFE_INTEGER;
}

// What a truck gets paid on a load (Daniel, 2026-11-25): a Landstar driver (BCO) gets the full
// posted rate; an approved carrier gets 78% to 85% of it. The posted rate is the rate the
// Landstar export sends (the RXO ATZ DAT van discount already taken off).
// Shown for AMERI 18347- ATZ loads only (Daniel, 2026-11-25).
const CARRIER_PAY_LOW = 0.78;

const CARRIER_PAY_HIGH = 0.85;

function getTruckPay(customer, load) {
  if (!isAmeriCustomer(customer)) return null;
  const quoted = Number(String(load?.rateInput || '').replace(/[$,]/g, ''));
  if (!(quoted > 0)) return null;
  const posted = quoted - getRxoAtzDatVanDiscount(customer, load, quoted);
  return {
    posted,
    carrierLow: Math.round(posted * CARRIER_PAY_LOW),
    carrierHigh: Math.round(posted * CARRIER_PAY_HIGH)
  };
}

const formatDollars = value => `$${Math.round(value).toLocaleString('en-US')}`;

// One table row per load (src/LoadTable.jsx).
function buildLoadTableRow(customer, order, { checked, checkDisabled, isHotLane }) {
  const facts = getLoadCardFacts(order);
  const place = (city, state) => [String(city || '').trim(), String(state || '').trim().toUpperCase()].filter(Boolean).join(', ');
  const dateOf = value => String(value || '').match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?:\s+\d{4})?/)?.[0] || '';
  const raise = order.rateRaise;
  const exportedAt = Date.parse(order.landstarExportedAt || '');
  return {
    key: JSON.stringify([customer, order.id]),
    customer, order, id: String(order.id),
    pickupAt: getPickupSortValue(order) === Number.MAX_SAFE_INTEGER ? 0 : getPickupSortValue(order),
    pickup: dateOf(order.pickupTime) || String(order.puDate || '').replace(/^PU:\s*/, ''),
    origin: place(order.origCity, order.origSt),
    destination: place(order.destCity, order.destSt),
    delivery: dateOf(order.deliveryTime) || String(order.delDate || '').replace(/^DFL:\s*/, ''),
    equipment: getDisplayEquipmentCode(order.eCode),
    miles: Number(String(order.miles || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0]) || 0,
    rate: Number(String(order.rateInput || '').replace(/[$,]/g, '')) || 0,
    perMile: Number(facts.perMileText.replace(/[^\d.]/g, '')) || 0,
    status: order.status,
    hazmat: isHazmatLoad(order),
    exportedAt: Number.isFinite(exportedAt) ? exportedAt : 0,
    exported: facts.exported,
    urgency: getLoadUrgency(order),
    checked, checkDisabled,
    flags: [
      isHazmatLoad(order) && '☢',
      isTankerLoad(order) && '🛢',
      String(order.needsCapacity || '').trim() && '⭐',
      isHotLane && '🔥',
      raise && '⬆',
      hasOpenLandstarError(order) && '⚠'
    ].filter(Boolean)
  };
}

function hasOpenLandstarError(load) {
  const error = load?.landstarError;
  if (!error) return false;
  const exportedAt = Date.parse(load.landstarExportedAt || '');
  return !(Number.isFinite(exportedAt) && exportedAt > Number(error.at));
}

export {
  getLoadCardRoute,
  getLoadCardDates,
  hasLoadRate,
  getLoadCardFacts,
  getLoadUrgency,
  getRatePerMile,
  getDisplayEquipmentCode,
  getRxoAtzDatVanDiscount,
  getPickupSortValue,
  CARRIER_PAY_LOW,
  CARRIER_PAY_HIGH,
  getTruckPay,
  formatDollars,
  buildLoadTableRow,
  hasOpenLandstarError
};
