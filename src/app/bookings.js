// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { normalizeMilesValue } from './screenshotParsers.js';
import { splitCustomerName } from './customerGroups.js';

// The amount at the start of the rate box; words typed after it ("5500 killing it today")
// don't zero the line haul.
function parseLineHaul(load) {
  const match = String(load?.rateInput || '').replace(/[$,]/g, '').match(/^\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

// Adds (or refreshes) one booked load in the log, keyed by customer + load number.
function addBookingEntry(log, customer, load) {
  const entries = Array.isArray(log) ? log : [];
  const key = `${customer}|${load.id}`;
  const existing = entries.find(entry => `${entry.customer}|${entry.loadId}` === key);
  const lineHaul = parseLineHaul(load);
  const miles = Number(normalizeMilesValue(load.miles)) || 0;
  const origSt = String(load.origSt || '').trim().toUpperCase();
  // A removed booking (capacity fell off) stays removed until the load is booked again
  // (a re-booking gets a fresh bookedAt, which no longer matches the removed entry's).
  // Only removals you made (Remove capacity / status change) carry removedAt. An older TMS
  // marked bookings removed by itself when its load list was out of date: those come back
  // while the load is still booked with the same booking date.
  // A recovered load keeps its original booking week (Daniel's rule, 2026-11-24), so the
  // entry's `at` can be older than the load's bookedAt: `bookedAt` remembers the booking it
  // came from, so a stale copy of that same booking can't undo a later removal.
  const entryBookedAt = existing?.bookedAt || existing?.at;
  const autoRemoved = existing?.removed && !existing.removedAt && load.bookedAt && load.bookedAt === entryBookedAt
    && String(load.status || '').toUpperCase() === 'BOOKED';
  if (existing?.removed && !autoRemoved && (!load.bookedAt || load.bookedAt === entryBookedAt)) return entries;
  // Capacity was removed and the load is booked again (recovered): it counts in the week it
  // was first booked, not the week it was recovered.
  const recovered = existing?.removed && existing.removedAt && existing.at && load.bookedAt;
  const refresh = !existing || existing.removed
    || (lineHaul > 0 && existing.lineHaul !== lineHaul)
    || (miles > 0 && !(Number(existing.miles) > 0))
    || (origSt && !existing.origSt);
  if (!refresh) return entries;
  return [...entries.filter(entry => entry !== existing), {
    customer, loadId: String(load.id),
    at: recovered || (existing?.recoveredAt && !existing.removed) ? existing.at : load.bookedAt || (existing?.removed && !autoRemoved ? '' : existing?.at) || new Date().toISOString(),
    ...(recovered || existing?.bookedAt ? { bookedAt: load.bookedAt || existing.bookedAt } : {}),
    ...(recovered ? { recoveredAt: load.bookedAt } : existing?.recoveredAt ? { recoveredAt: existing.recoveredAt } : {}),
    lineHaul: lineHaul || Number(existing?.lineHaul) || 0, miles, origSt,
    eCode: String(load.eCode || '').trim().toUpperCase(),
    origin: [load.origCity, load.origSt].filter(Boolean).join(', '),
    destination: [load.destCity, load.destSt].filter(Boolean).join(', ')
  }];
}

// Straight trucks (D-ST / D-LG / D-RF) pay 11%; every other load pays 5%.
function getBookingPotential(entry) {
  const straight = /^D-(ST|LG|RF)/.test(String(entry?.eCode || '').trim().toUpperCase());
  return (Number(entry?.lineHaul) || 0) * (straight ? 0.11 : 0.05);
}

// One report row per customer: the sub-accounts (R X O 2429200 - VAN / Haz / Panels / ATZ V...,
// Para 1522166 - HAZ / N HAZ / ATZ H...) roll up into one line each, whatever they are named.
// Ivan's bookings (agent SNB, in the shared R X O 2429200 - SNB) count in the totals but show on
// their own line, so Daniel sees how much Ivan books (2026-11-27).
const SNB_GROUP = 'Ivan (SNB)';
function isSnbBooking(name) {
  return /\bSNB\b/i.test(splitCustomerName(String(name || '')).tag);
}

function getBookingCustomerGroup(name) {
  const text = String(name || '').trim();
  if (isSnbBooking(text)) return SNB_GROUP;
  const { base, tag } = splitCustomerName(text);
  return (tag ? base : text.replace(/\s*-\s*ATZ\b.*$/i, '').trim()) || 'Unknown';
}

// One entry per booked load. Renaming an account (2026-11-27: ATZ V -> VAN, ATZ H -> Haz...)
// logged its booked loads again under the new name, so they counted twice. The same load
// number in the same customer (any sub-account name) is one booking: the newest entry wins
// (so a removal made after the rename still takes it off).
function dedupeBookingEntries(log) {
  const newest = entry => Math.max(Date.parse(entry.removedAt || '') || 0, Date.parse(entry.bookedAt || entry.at || '') || 0);
  const byLoad = new Map();
  for (const entry of Array.isArray(log) ? log : []) {
    const key = `${getBookingCustomerGroup(entry.customer).toUpperCase().replace(/[^A-Z0-9]/g, '')}|${String(entry.loadId).trim()}`;
    const kept = byLoad.get(key);
    if (!kept || newest(entry) >= newest(kept)) byLoad.set(key, entry);
  }
  return [...byLoad.values()];
}

// The booking fell through (capacity removed): the entry is kept but marked removed, so a
// stale load list on another synced computer cannot quietly put it back in the totals.
function removeBookingEntry(log, customer, loadId) {
  const entries = Array.isArray(log) ? log : [];
  return entries.map(entry => (entry.customer === customer && String(entry.loadId) === String(loadId))
    ? { ...entry, removed: true, removedAt: new Date().toISOString() } : entry);
}

// Midnight on the Monday of that date's week.
function getBookingWeekStart(at) {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

// Weekly totals (newest first, with a per-customer breakdown) and monthly totals.
// The full booked amount per load is line haul + miles × the pickup region's fuel
// surcharge rate (from ⚙ My Settings / the weekly fuel email).
function summarizeBookings(log, fuelRates = null) {
  const weeks = new Map();
  const months = new Map();
  for (const entry of dedupeBookingEntries(log)) {
    if (entry.removed) continue;
    const at = Date.parse(entry.at);
    if (!Number.isFinite(at)) continue;
    const lineHaul = Number(entry.lineHaul) || 0;
    const potential = getBookingPotential(entry);
    const origSt = entry.origSt || String(entry.origin || '').split(',').pop();
    const fscRate = getFuelSurchargeRate(fuelRates, origSt);
    const total = lineHaul + (Number(entry.miles) || 0) * (fscRate || 0);
    const weekStart = getBookingWeekStart(at);
    const week = weeks.get(weekStart) || { start: weekStart, loads: 0, lineHaul: 0, total: 0, potential: 0, customers: new Map(), snb: { loads: 0, lineHaul: 0, total: 0, potential: 0 } };
    week.loads += 1;
    week.lineHaul += lineHaul;
    week.total += total;
    week.potential += potential;
    const snb = isSnbBooking(entry.customer);
    if (snb) {
      week.snb.loads += 1;
      week.snb.lineHaul += lineHaul;
      week.snb.total += total;
      week.snb.potential += potential;
    }
    const name = getBookingCustomerGroup(entry.customer);
    const customer = week.customers.get(name) || { loads: 0, lineHaul: 0, total: 0, potential: 0 };
    customer.loads += 1;
    customer.lineHaul += lineHaul;
    customer.total += total;
    customer.potential += potential;
    week.customers.set(name, customer);
    weeks.set(weekStart, week);
    const date = new Date(at);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const month = months.get(monthKey) || { month: monthKey, loads: 0, lineHaul: 0, total: 0, potential: 0, snb: { loads: 0, lineHaul: 0, total: 0, potential: 0 } };
    month.loads += 1;
    month.lineHaul += lineHaul;
    month.total += total;
    month.potential += potential;
    if (snb) {
      month.snb.loads += 1;
      month.snb.lineHaul += lineHaul;
      month.snb.total += total;
      month.snb.potential += potential;
    }
    months.set(monthKey, month);
  }
  return {
    weeks: [...weeks.values()].sort((a, b) => b.start - a.start).map(week => ({
      ...week,
      customers: [...week.customers.entries()]
        .map(([name, totals]) => ({ customer: name, ...totals, ...(name === SNB_GROUP ? { snb: true } : {}) }))
        .sort((a, b) => Number(Boolean(a.snb)) - Number(Boolean(b.snb)) || b.loads - a.loads || b.lineHaul - a.lineHaul)
    })),
    months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month))
  };
}

// Weekly fuel surcharge ($/mile) by pickup region, the same four regions as the weekly
// fuel email ("East .86 Midwest .88 West 1.03 New England .89"). The Gulf states use the
// Midwest rate; anything not listed (Canada, blank) uses Midwest too.
const fuelSurchargeRegions = {
  east: { label: 'East', states: ['NY', 'NJ', 'PA', 'DE', 'MD', 'DC', 'VA', 'WV', 'NC', 'SC', 'GA', 'FL'] },
  midwest: { label: 'Midwest (and Gulf: TX LA AR MS AL NM)', states: ['OH', 'MI', 'IN', 'IL', 'WI', 'MN', 'IA', 'MO', 'KY', 'TN', 'KS', 'NE', 'SD', 'ND', 'OK', 'TX', 'LA', 'AR', 'MS', 'AL', 'NM'] },
  west: { label: 'West', states: ['CO', 'ID', 'MT', 'UT', 'WY', 'AZ', 'NV', 'CA', 'OR', 'WA', 'AK', 'HI'] },
  newEngland: { label: 'New England', states: ['CT', 'ME', 'MA', 'NH', 'RI', 'VT'] }
};

function getFuelSurchargeRegion(state) {
  const code = String(state || '').trim().toUpperCase();
  const match = Object.entries(fuelSurchargeRegions)
    .find(([, info]) => info.states.includes(code));
  return match ? match[0] : 'midwest';
}

// $/mile for a pickup state; a blank regional rate falls back to the Midwest rate.
function getFuelSurchargeRate(rates, state) {
  if (!rates || typeof rates !== 'object') return null;
  const parse = value => Number(String(value || '').replace(/[$,]/g, ''));
  const regional = parse(rates[getFuelSurchargeRegion(state)]);
  const rate = regional > 0 ? regional : parse(rates.midwest);
  return rate > 0 ? rate : null;
}

export {
  parseLineHaul,
  addBookingEntry,
  getBookingPotential,
  getBookingCustomerGroup,
  removeBookingEntry,
  getBookingWeekStart,
  summarizeBookings,
  fuelSurchargeRegions,
  getFuelSurchargeRegion,
  getFuelSurchargeRate
};
