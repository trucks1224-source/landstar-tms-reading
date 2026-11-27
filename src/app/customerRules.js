// ⚙ Customer rules (Daniel 2026-11-27: "let my team add customer rules to their customer without
// me"). Each person sets them per customer in the TMS (saved in their My Settings, which syncs);
// the Excel import and the Landstar export follow them. Tested in customerRules.test.js.
//
//   importEquipment   which equipment an Excel import keeps: [] = all, or e.g. ['flatbed']
//   equipment2        2nd equipment on Landstar: 'auto' (the TMS decides), 'none', or a code
//   rateSource        'default' | 'customer' (the file's rate) | 'dat' | 'higher' (of the two)
//   laneRates         [{ origCity, origSt, destCity, destSt, rate }]: always wins (city optional)
//   excelColumns      { field: 'Header name in the file' } for files in this customer's layout
//   capacity          'bco' (Landstar BCO trucks only) | 'both' (BCO trucks and outside carriers)
import { getLandstarEquipmentCode } from './equipment.js';

export const EQUIPMENT_FAMILIES = [
  ['van', 'Van'], ['reefer', 'Reefer'], ['flatbed', 'Flatbed'], ['stepdeck', 'Step deck'], ['other', 'Other']
];
export const EQUIPMENT2_CHOICES = [
  ['auto', 'Automatic (the TMS decides)'], ['none', 'None: only the 1st equipment'], ['REFR', 'Reefer'],
  ['VAN', 'Van'], ['STEP', 'Step deck'], ['FLAT', 'Flatbed']
];
export const RATE_SOURCES = [
  ['default', 'As usual (saved lane rate, then the file, then DAT)'], ['customer', "The customer's rate in the file"],
  ['dat', 'DAT rate (ignore the file)'], ['higher', "The higher of the customer's rate and DAT"]
];
export const CAPACITY_CHOICES = [
  ['bco', 'BCO trucks only'], ['both', 'BCO trucks and carriers (carrier name and MC #)']
];
// What the Excel import can read, in the order the column-matching screen asks for it.
export const EXCEL_FIELDS = [
  ['loadId', 'Load / order #'], ['equipment', 'Equipment'], ['origCity', 'Origin city'], ['origSt', 'Origin state'],
  ['origZip', 'Origin ZIP'], ['destCity', 'Destination city'], ['destSt', 'Destination state'], ['destZip', 'Destination ZIP'],
  ['pickup', 'Pickup date / time'], ['pickupLate', 'Pickup late time'], ['delivery', 'Delivery date / time'],
  ['deliveryLate', 'Delivery late time'], ['weight', 'Weight'], ['miles', 'Miles'], ['rate', 'Rate']
];

const EMPTY = { importEquipment: [], equipment2: 'auto', rateSource: 'default', laneRates: [], excelColumns: {}, capacity: 'bco' };
const key = name => String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// The rules for one customer (all rules default to "as usual").
export function getCustomerRules(allRules, customer) {
  const saved = allRules && typeof allRules === 'object'
    ? allRules[customer] || Object.entries(allRules).find(([name]) => key(name) === key(customer))?.[1]
    : null;
  return normalizeCustomerRules(saved);
}

export function normalizeCustomerRules(raw) {
  const rules = raw && typeof raw === 'object' ? raw : {};
  const families = new Set(EQUIPMENT_FAMILIES.map(([id]) => id));
  return {
    importEquipment: Array.isArray(rules.importEquipment) ? rules.importEquipment.filter(id => families.has(id)) : [],
    equipment2: EQUIPMENT2_CHOICES.some(([id]) => id === rules.equipment2) ? rules.equipment2 : 'auto',
    rateSource: RATE_SOURCES.some(([id]) => id === rules.rateSource) ? rules.rateSource : 'default',
    laneRates: (Array.isArray(rules.laneRates) ? rules.laneRates : [])
      .map(lane => ({
        origCity: String(lane?.origCity || '').trim().toUpperCase(), origSt: String(lane?.origSt || '').trim().toUpperCase(),
        destCity: String(lane?.destCity || '').trim().toUpperCase(), destSt: String(lane?.destSt || '').trim().toUpperCase(),
        rate: Number(String(lane?.rate || '').replace(/[$,]/g, '')) || 0
      }))
      .filter(lane => lane.rate > 0 && (lane.origSt || lane.origCity) && (lane.destSt || lane.destCity)),
    excelColumns: Object.fromEntries(Object.entries(rules.excelColumns && typeof rules.excelColumns === 'object' ? rules.excelColumns : {})
      .filter(([field, header]) => EXCEL_FIELDS.some(([id]) => id === field) && String(header || '').trim())
      .map(([field, header]) => [field, String(header).trim()])),
    capacity: CAPACITY_CHOICES.some(([id]) => id === rules.capacity) ? rules.capacity : 'bco'
  };
}

// True when a customer has no rule set (everything as usual).
export function hasCustomerRules(rules) {
  const normal = normalizeCustomerRules(rules);
  return Boolean(normal.importEquipment.length || normal.equipment2 !== EMPTY.equipment2 || normal.rateSource !== EMPTY.rateSource
    || normal.laneRates.length || Object.keys(normal.excelColumns).length || normal.capacity !== EMPTY.capacity);
}

// van / reefer / flatbed / stepdeck / other, from a TMS equipment code.
export function equipmentFamily(eCode) {
  const code = getLandstarEquipmentCode(eCode);
  if (code === 'VAN' || /^\d{2}VN$/.test(code)) return 'van';
  if (code === 'REFR') return 'reefer';
  if (['FLAT', '48FL', '53FL', 'FH'].includes(code)) return 'flatbed';
  if (['STEP', '53SD', 'SD'].includes(code)) return 'stepdeck';
  return 'other';
}

// Keeps only the loads whose equipment the rules allow. { kept, skipped }.
export function filterByImportEquipment(loads, rules) {
  const allowed = normalizeCustomerRules(rules).importEquipment;
  if (!allowed.length) return { kept: loads || [], skipped: 0 };
  const kept = (loads || []).filter(load => allowed.includes(equipmentFamily(load?.eCode)));
  return { kept, skipped: (loads || []).length - kept.length };
}

// The 2nd equipment the rules set for Landstar: undefined = as usual, '' = none, or a code.
export function ruleEquipment2(rules) {
  const choice = normalizeCustomerRules(rules).equipment2;
  if (choice === 'auto') return undefined;
  return choice === 'none' ? '' : choice;
}

// A fixed lane rate from the rules ('' when no lane matches). City names compare without spaces.
export function ruleLaneRate(rules, order) {
  const text = value => String(value || '').trim().toUpperCase();
  const city = value => text(value).replace(/^MT\.?\s+/, 'MOUNT ').replace(/^ST\.?\s+/, 'SAINT ').replace(/[^A-Z0-9]/g, '');
  const lane = normalizeCustomerRules(rules).laneRates.find(item =>
    (!item.origSt || item.origSt === text(order?.origSt)) && (!item.destSt || item.destSt === text(order?.destSt))
    && (!item.origCity || city(item.origCity) === city(order?.origCity)) && (!item.destCity || city(item.destCity) === city(order?.destCity)));
  return lane ? String(Math.round(lane.rate)) : '';
}

// The rate a load starts with on import, before any DAT lookup: { rate, waitForDat }.
// fileRate = the customer's rate in the file (0 when none); savedRate = your saved lane rate.
export function startingRate(rules, { fileRate = 0, savedRate = '' } = {}) {
  const source = normalizeCustomerRules(rules).rateSource;
  const file = Number(fileRate) > 0 ? String(Math.round(fileRate)) : '';
  if (source === 'customer') return { rate: file || savedRate || '', waitForDat: false };
  if (source === 'dat') return { rate: savedRate || '', waitForDat: false };
  if (source === 'higher') return { rate: '', waitForDat: true };
  return { rate: savedRate || file || '', waitForDat: false };
}

// "Higher of the two" once the DAT rate is in: the bigger of DAT and the customer's rate.
export function higherRate(datRate, fileRate) {
  const best = Math.max(Number(datRate) || 0, Number(fileRate) || 0);
  return best > 0 ? String(Math.round(best)) : '';
}
