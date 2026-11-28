// Loads whose pickup day has passed are deleted from the TMS (Daniel 2026-11-27: "You can delete
// the loads that the pickup has passed"). Only loads nobody is moving: OPEN, ENT and ON HOLD with
// no truck or carrier on them. Booked loads stay (billing, tracking). A pickup window over
// several days counts by its last day. Tested in pastPickupCleanup.test.js.

const REMOVABLE = new Set(['OPEN', 'ENT', 'ON HOLD']);

export function isPastPickupLoad(load, now = Date.now()) {
  if (!load || !REMOVABLE.has(String(load.status || '').trim().toUpperCase())) return false;
  if (String(load.truck || '').trim() || String(load.carrier || '').trim()) return false;
  const text = String(load.pickupTime || load.puDate || '');
  const match = [...text.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g)].pop();
  if (!match) return false;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const lastDay = new Date(year, Number(match[1]) - 1, Number(match[2]));
  if (Number.isNaN(lastDay.getTime())) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return lastDay.getTime() < today.getTime();
}

// { orders, removed: { customer: count } }; orders is the same object when nothing was removed.
export function removePastPickupLoads(customerOrdersMap, now = Date.now()) {
  const removed = {};
  let changed = false;
  const orders = {};
  for (const [customer, loads] of Object.entries(customerOrdersMap || {})) {
    const kept = (loads || []).filter(load => !isPastPickupLoad(load, now));
    if (kept.length !== (loads || []).length) {
      removed[customer] = (loads || []).length - kept.length;
      changed = true;
      orders[customer] = kept;
    } else {
      orders[customer] = loads;
    }
  }
  return { orders: changed ? orders : customerOrdersMap, removed };
}
