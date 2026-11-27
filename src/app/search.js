// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { editDistance } from './screenshotParsers.js';

// Search box match: load #, freight bill, cities, states, ZIPs, driver, truck, notes.
// City names forgive small misspellings ("Shepardsville" finds SHEPHERDSVILLE).
function loadMatchesSearch(order, searchQuery) {
  const query = String(searchQuery || '').trim().toLowerCase();
  if (!query) return true;
  // A bare 2-letter query is a state search: match the state code exactly, not the
  // substring "ca" inside "CAnton". Check this before the loose field substring match.
  if (/^[a-z]{2}$/.test(query)) {
    const states = [order.origSt, order.destSt].map(value => String(value || '').toLowerCase());
    return states.includes(query);
  }

  const fields = [
    order.id, order.route, order.origCity, order.origSt, order.origZip,
    order.destCity, order.destSt, order.destZip, order.planningComment,
    order.driver, order.truck, order.trailer,
    order.paramountTracking?.freightBill, order.landstarAssignment?.landstarLoadId
  ].map(value => String(value || '').toLowerCase());
  if (fields.some(value => value.includes(query))) return true;

  // "City ST" / "City, ST" typed together: match the city and state as a pair, since no
  // single field holds the whole string.
  const stateMatch = query.match(/^(.*?)[\s,]+([a-z]{2})$/);
  if (stateMatch) {
    const cityPart = stateMatch[1].trim();
    const statePart = stateMatch[2];
    const pairs = [
      [order.origCity, order.origSt],
      [order.destCity, order.destSt]
    ].map(([city, st]) => [String(city || '').toLowerCase(), String(st || '').toLowerCase()]);
    if (pairs.some(([city, st]) => st === statePart && (!cityPart || city.includes(cityPart)))) return true;
  }

  const letters = query.replace(/[^a-z]/g, '');
  if (letters.length < 6 || letters.length !== query.replace(/\s/g, '').length) return false;
  const allowed = letters.length >= 9 ? 2 : 1;
  return [order.origCity, order.destCity]
    .map(value => String(value || '').toLowerCase().replace(/[^a-z]/g, ''))
    .some(city => city.length >= 5 && Math.abs(city.length - letters.length) <= allowed && editDistance(letters, city) <= allowed);
}

function getLoadSearchEntries(customerOrdersMap, selectedBroker, searchQuery, allCustomers = false) {
  const query = searchQuery.trim().toLowerCase();
  const customers = query || allCustomers ? Object.entries(customerOrdersMap) : [[selectedBroker, customerOrdersMap[selectedBroker] || []]];
  return customers.flatMap(([customer, loads]) => loads
    .filter(order => loadMatchesSearch(order, query))
    .map(order => ({ customer, order })));
}

export {
  loadMatchesSearch,
  getLoadSearchEntries
};
