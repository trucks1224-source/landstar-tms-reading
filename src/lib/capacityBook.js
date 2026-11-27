// Saved trucks and carriers (Daniel 2026-11-27: "save the truck number, that way when I re-enter
// it it brings up the driver's information" and "a spot to save the carrier's name and MC
// number"). Kept in My Settings, so they sync and outlive the loads they came from.
//
//   truckBook   { 'TRUCK#': { truck, driver, driverPhone, trailer, savedAt } }
//   carrierBook { 'MC digits': { mc, name, savedAt } }
// Tested in capacityBook.test.js.

const clean = value => String(value ?? '').trim();
export const truckKey = truck => clean(truck).toUpperCase().replace(/\s+/g, '');
export const mcKey = mc => clean(mc).replace(/\D/g, '');

// The driver saved for this truck number, or null.
export function lookupTruck(book, truck) {
  const key = truckKey(truck);
  return key && book && typeof book === 'object' ? book[key] || null : null;
}

// The book with this load's truck and driver saved (the same book when nothing changed or the
// load has no truck + driver).
export function rememberTruck(book, load, now = Date.now()) {
  const key = truckKey(load?.truck);
  const driver = clean(load?.driver);
  const current = book && typeof book === 'object' ? book : {};
  if (!key || !driver) return current;
  const entry = {
    truck: clean(load.truck),
    driver,
    driverPhone: clean(load.driverPhone) || (current[key]?.driver === driver ? current[key].driverPhone || '' : ''),
    trailer: clean(load.trailer) || (current[key]?.driver === driver ? current[key].trailer || '' : '')
  };
  const old = current[key];
  if (old && old.driver === entry.driver && old.driverPhone === entry.driverPhone && old.trailer === entry.trailer && old.truck === entry.truck) return current;
  return { ...current, [key]: { ...entry, savedAt: now } };
}

// The carrier saved under this MC number, or null.
export function lookupCarrier(book, mc) {
  const key = mcKey(mc);
  return key && book && typeof book === 'object' ? book[key] || null : null;
}

export function rememberCarrier(book, load, now = Date.now()) {
  const key = mcKey(load?.carrierMc);
  const name = clean(load?.carrierName);
  const current = book && typeof book === 'object' ? book : {};
  if (!key || !name) return current;
  if (current[key]?.name === name) return current;
  return { ...current, [key]: { mc: key, name, savedAt: now } };
}

// Fills the empty driver boxes from a saved truck: { load, filled } (filled = what was filled).
export function fillFromTruck(load, saved) {
  if (!saved) return { load, filled: [] };
  const next = { ...load };
  const filled = [];
  for (const field of ['driver', 'driverPhone', 'trailer']) {
    if (!clean(load?.[field]) && clean(saved[field])) { next[field] = saved[field]; filled.push(field); }
  }
  return { load: next, filled };
}
