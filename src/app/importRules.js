// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { accountKey } from '../lib/accountAliases.js';
import { rxoCustomerName, normalizeCustomerName } from '../lib/trackingEmails.js';
import { getLandstarEquipmentCode } from './equipment.js';
import { getFixedLaneRate } from './laneRates.js';
import { isRxoCustomer, holdsRedScreenshotLoads, isCh593772Customer } from './customers.js';
import { stateCodes } from './screenshotParsers.js';

const exportedLoadRetentionMs = 30 * 24 * 60 * 60 * 1000;

// A load someone is actively working: a truck or driver on it, an offer out, a Landstar
// truck assignment, or tracking under way. Imports never delete these and never take their
// postings off Landstar, even when the customer's new list no longer shows them (safety
// net, 2026-11-13: a load dispatched in Landstar but not yet BOOKED here must not vanish).
function isLoadBeingWorked(load) {
  return Boolean(String(load.truck || '').trim() || String(load.driver || '').trim()
    || load.status === 'OFFER' || load.landstarAssignment
    || load.paramountTracking?.freightBill
    || ['At Pickup', 'Loaded', 'In Transit', 'At Delivery', 'Delivered'].includes(load.trackingStage));
}

// Loads that were posted to Landstar and are missing from a customer's new list. This
// includes Nolan: any posted Nolan load not in the new screenshots is removed too.
function findDroppedPostings(customer, importedLoads, existingLoads, equipmentScope = null) {
  const importedIds = new Set(importedLoads.map(load => normalizeLoadId(getBaseLoadId(load))).filter(Boolean));
  if (!importedIds.size) return [];
  // Loads added by hand are never taken off Landstar for being missing from the list.
  // With an equipment scope (RXO's separate van/flatbed/reefer/hazmat lists), only postings in
  // the uploaded categories are candidates; the other lists' postings stay up.
  return existingLoads.filter(load => load.landstarPosting && !load.manualEntry
    && !String(load.needsCapacity || '').trim() && load.status !== 'BOOKED'
    && !isLoadBeingWorked(load)
    && (!equipmentScope || equipmentScope.has(getRxoEquipmentListCategory(load)))
    && !importedIds.has(normalizeLoadId(getBaseLoadId(load))));
}

// Team vans (VM/VT) are shown as a plain V; the Team flag carries the team part.
// Equipment we don't haul: oversized/specialized trailers, and intermodal ("INT" in the
// equipment box). These loads are never imported or exported, for every customer.
function isSkippableEquipment(value) {
  return /OVER\s*DIMENSIONAL|OVER\s*SIZE|OVERSIZE|REMOVABLE\s*GOOSE\s*NECK|GOOSE\s*NECK|\bRGN\b|LOW\s*BOY|DOUBLE\s*DROP|\bINT\b|INTER\s*MODAL/i.test(String(value || ''));
}

// Equipment bucket for scoping RXO list imports: the van, flatbed and reefer lists are
// uploaded separately, so an import only replaces existing loads in the buckets it contains.
function getEquipmentListCategory(eCode) {
  const code = getLandstarEquipmentCode(eCode);
  if (code === 'REFR') return 'reefer';
  if (['FLAT', 'FH', 'STEP', 'FLCS'].includes(code)) return 'flatbed';
  if (code === 'VAN' || /^\d{2}VN$/.test(code)) return 'van';
  return 'other';
}

// RXO imports default blank equipment to VAN:VAN, so scope lookups do the same.
// Hazmat is its own list: a hazmat upload never replaces van/reefer/flatbed loads,
// and a van upload never replaces hazmat loads (VZ/RZ would otherwise count as van/reefer).
function getRxoEquipmentListCategory(load) {
  if (isHazmatLoad(load)) return 'hazmat';
  const eCode = String(load?.eCode || '').trim();
  return getEquipmentListCategory(eCode || 'VAN:VAN');
}

function getLandstarCommodity(value) {
  const equipmentCode = String(value || '').trim().toUpperCase().split(':')[0];
  // FH (flatbed hotshot) is not hazmat by itself; hazmat loads carry hazmat: 'true'.
  // FV (flatbed/stepdeck hazmat) is hazmat by itself, like VZ/RZ.
  if (['VZ', 'RZ', 'FV'].includes(equipmentCode)) {
    return 'HAZMAT';
  }
  if (equipmentCode === 'VE') {
    return 'CHEM';
  }
  return 'CGAPP';
}

function isHazmatLoad(load) {
  if (['CGAPP', 'HAZMAT', 'CHEM'].includes(load?.commodity)) return load.commodity === 'HAZMAT';
  return getLandstarCommodity(load?.eCode) === 'HAZMAT'
    || String(load?.eCode || '').trim().toUpperCase() === 'FV'
    || String(load?.hazmat || '').toLowerCase() === 'true'
    || /\bhazmat\b/i.test(String(load?.planningComment || ''));
}

function isTankerLoad(load) {
  return String(load?.tanker || '').toLowerCase() === 'true' || /tanker/i.test(String(load?.planningComment || ''));
}

// R X O 2429200 - ATZ only (not ATZ P): van freight picking up in these states is
// skipped on import and never exported. Reefer and other equipment, and hazmat or tanker
// loads, are unaffected. Empty since 2026-11-25 (Daniel: "Remove the skip"; it was WI, IN,
// OH, MI, MN, SD, ND, UT and ID from 11/04), so every RXO van load imports and posts.
const rxoSkippedVanOriginStates = new Set([]);

const vanEquipmentCodes = new Set(['VAN', '24VN', '28VN', '48VN', '53VN']);

function isRxoSkippedVanLoad(customer, load) {
  if (normalizeCustomerName(customer) !== rxoCustomerName) return false;
  // Hazmat and tanker freight is always kept, whatever the pickup state.
  if (isHazmatLoad(load) || isTankerLoad(load)) return false;
  const originState = String(load?.origSt || '').trim().toUpperCase();
  if (!rxoSkippedVanOriginStates.has(originState)) return false;
  // getLandstarEquipmentCode maps V, VZ, VT and Van-or-Reefer (VR) to VAN.
  return vanEquipmentCodes.has(getLandstarEquipmentCode(load?.eCode));
}

// Loads picking up in or delivering to Mexico are never imported or exported, for every
// customer. Customer lists mark Mexico with a MX/MEX country code or a Mexican state code
// (EM, JA, GJ, BJ, NX, CH, CU, ...): any two-letter region that is not a US state or a
// Canadian province counts.
function isMexicoPlace(state, country) {
  const countryCode = String(country || '').trim().toUpperCase();
  if (countryCode === 'MX' || countryCode === 'MEX' || countryCode === 'MEXICO') return true;
  const region = String(state || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(region) && !stateCodes.has(region);
}

function isMexicoLoad(load) {
  return isMexicoPlace(load?.origSt, load?.origCountry) || isMexicoPlace(load?.destSt, load?.destCountry);
}

// Accounts whose imports are the customer's full list: a re-import replaces the list, so
// loads that dropped off it are deleted (and their Landstar postings taken down).
const importStatusPreservationCustomers = new Set([
  'PARA1522166ATZ',
  'PARA1522166ATZH',
  'RXO2429200ATZ',
  'RXO2429200ATZP',
  'NOLAN965974ATZ',
  'NOLAN965974ATZH'
]);

function preservesImportedLoadStatus(name) {
  const normalized = accountKey(normalizeCustomerName(name));
  return importStatusPreservationCustomers.has(normalized);
}

function normalizeLoadId(value) {
  const text = String(value || '').trim().replace(/-ALT[A-Z]+$/i, '');
  const digits = text.replace(/\D/g, '');
  return digits || text.toUpperCase();
}

function createLaneDayKey(order) {
  const normalize = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const origin = normalize(order.origCity);
  const destination = normalize(order.destCity);
  const originState = normalize(order.origSt);
  const destinationState = normalize(order.destSt);
  const dateText = String(order.pickupTime || order.puDate || '');
  const usDate = dateText.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  const isoDate = dateText.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (!origin || !destination || !usDate && !isoDate) return '';

  const pickupDate = usDate
    ? `${usDate[3].length === 2 ? `20${usDate[3]}` : usDate[3]}-${usDate[1].padStart(2, '0')}-${usDate[2].padStart(2, '0')}`
    : `${isoDate[1]}-${isoDate[2].padStart(2, '0')}-${isoDate[3].padStart(2, '0')}`;
  return JSON.stringify([origin, originState, destination, destinationState, pickupDate]);
}

function getImportedLoadKey(load) {
  const baseId = getBaseLoadId(load);
  const key = normalizeLoadId(baseId);
  if (!key || /^(?:IMG|IMP|NTG|DAT)-\d+-\d+$/i.test(baseId)) {
    throw new Error('An imported load has no readable load number. Use a list with load numbers. Existing loads were not deleted.');
  }
  return key;
}

function replaceImportedCustomerLoads(customer, importedLoads, existingLoads, {
  additive = !preservesImportedLoadStatus(customer), allowGeneratedIds = additive, now = Date.now(), keepManualEnt = false,
  // false for partial lists (DAT rate screenshots, screenshots with unreadable rows)
  reportDroppedPostings = true
} = {}) {
  if (!importedLoads.length) {
    throw new Error('The imported load list is empty. Existing loads were not deleted.');
  }
  // RXO ATZ van loads picking up in skipped states are not imported (see isRxoSkippedVanLoad).
  const skippedRxoVanCount = importedLoads.filter(load => isRxoSkippedVanLoad(customer, load)).length;
  importedLoads = importedLoads.filter(load => !isRxoSkippedVanLoad(customer, load));
  // Loads to or from Mexico are never imported.
  const skippedMexicoCount = importedLoads.filter(isMexicoLoad).length;
  importedLoads = importedLoads.filter(load => !isMexicoLoad(load));
  // Intermodal ("INT") and oversized equipment is never imported, from any source.
  const skippedEquipmentCount = importedLoads.filter(load => isSkippableEquipment(load.eCode)).length;
  importedLoads = importedLoads.filter(load => !isSkippableEquipment(load.eCode));
  if (!importedLoads.length) {
    throw new Error('Every load in this list goes to or from Mexico or uses equipment we skip (INT/oversized), so nothing was imported. Existing loads were not deleted.');
  }
  // RXO's van, flatbed, reefer and hazmat lists are uploaded separately: a full-list import only
  // replaces existing loads in the equipment categories the file contains. Loads of other
  // equipment stay, and their Landstar postings are never dropped.
  const equipmentScope = !additive && isRxoCustomer(customer)
    ? new Set(importedLoads.map(load => getRxoEquipmentListCategory(load)))
    : null;
  const loadKey = load => normalizeLoadId(getBaseLoadId(load));
  const importedById = new Map();
  let duplicateCount = 0;
  importedLoads.forEach(load => {
    const id = allowGeneratedIds ? getBaseLoadId(load) : getImportedLoadKey(load);
    if (!id) throw new Error('An imported load has no readable load number. Existing loads were not deleted.');
    const key = JSON.stringify([id, createLaneDayKey(load)]);
    if (importedById.has(key)) {
      duplicateCount += 1;
      return;
    }
    importedById.set(key, { ...load, id, sourceLoadId: id });
  });
  const importedLaneDays = new Set();
  const matchedIds = new Set();
  const mergedLoads = [];
  let laneDayDuplicateCount = 0;
  for (const load of importedById.values()) {
    const laneDay = createLaneDayKey(load);
    if (laneDay && importedLaneDays.has(laneDay)) {
      laneDayDuplicateCount += 1;
      console.warn(`[import] skipped same-lane/pickup-day duplicate #${getBaseLoadId(load)}: ${load.origCity}, ${load.origSt} → ${load.destCity}, ${load.destSt} pickup ${load.pickupTime || load.puDate || ''}`);
      continue;
    }
    if (laneDay) importedLaneDays.add(laneDay);
    const existing = existingLoads.find(order => loadKey(order) === loadKey(load) && !isNewDayForExistingLoad(order, load))
      || (allowGeneratedIds && existingLoads.find(order => laneDay && createLaneDayKey(order) === laneDay))
      || existingLoads.find(order => loadKey(order) === loadKey(load));
    const populatedFields = Object.fromEntries(Object.entries(load).filter(([, value]) =>
      value !== undefined && value !== null && String(value).trim() !== ''
    ));
    const merged = { ...existing, ...populatedFields, status: 'OPEN', tag: 'OPEN' };
    if (existing) {
      ['rateInput', 'rateSource', 'carrier', 'driver', 'driverPhone', 'truck', 'trailer', 'pickupEta', 'emptyLocation', 'notes', 'landstarComment', 'needsCapacity', 'commodity'].forEach(field => {
        if (String(existing[field] || '').trim()) merged[field] = existing[field];
      });
      // The load still carries a DAT rate but you have typed a rate for this lane since: use yours.
      if (load.rateSource === 'user-entered' && Number(load.rateInput) > 0 && isDatRateSource(existing.rateSource)) {
        merged.rateInput = load.rateInput;
        merged.rateSource = 'user-entered';
      }
      if (allowGeneratedIds && load.rateSource === 'dat-screenshot' && existing.rateSource !== 'user-entered'
        && Number(load.rateInput) > 0) {
        merged.rateInput = load.rateInput;
        merged.rateSource = load.rateSource;
      }
      if (!isNewDayForExistingLoad(existing, load)) {
        merged.id = existing.id;
        merged.sourceLoadId = existing.sourceLoadId || getBaseLoadId(existing);
        matchedIds.add(String(existing.id));
      }
    }
    const fixedLaneRate = getFixedLaneRate(customer, merged);
    if (fixedLaneRate && (!existing || existing.rateSource !== 'user-entered')) {
      merged.rateInput = fixedLaneRate;
      merged.rateSource = 'user-entered';
    }
    if (isCh593772Customer(customer) && load.rateSource === 'customer-bin') {
      merged.rateInput = load.rateInput;
      merged.rateSource = load.rateSource;
    }
    delete merged.landstarExportedAt;
    if (holdsRedScreenshotLoads(customer) && load.screenshotStatus === 'ON HOLD') {
      merged.status = 'ON HOLD';
      merged.tag = 'HOLD';
    }
    delete merged.screenshotStatus;
    // Pickup date already passed: the load goes (or stays) on ENT, new or re-imported.
    if (hasPastPickupDate(merged)) {
      merged.status = 'ENT';
      merged.tag = 'ENT';
    }
    if (existing?.status === 'OFFER' && !isNewDayForExistingLoad(existing, load)) {
      merged.status = 'OFFER';
      merged.tag = 'OFFER';
    }
    // A booked load stays booked when the customer's list is imported again.
    if (existing?.status === 'BOOKED' && !isNewDayForExistingLoad(existing, load)) {
      merged.status = 'BOOKED';
      merged.tag = 'BOOKED';
      merged.bookedAt = existing.bookedAt;
    }
    const reservedLoads = existingLoads.filter(order => additive || (order.status === 'ENT'
      && Number.isFinite(Date.parse(order.landstarExportedAt))
      && now - Date.parse(order.landstarExportedAt) < exportedLoadRetentionMs));
    mergedLoads.push(assignImportedLoadIdentity(merged, reservedLoads, mergedLoads));
  }
  const rawImportedIds = new Set(importedLoads.map(load => normalizeLoadId(getBaseLoadId(load))).filter(Boolean));
  const retained = existingLoads.filter(load => {
    if (matchedIds.has(String(load.id))) return false;
    // Booked loads are covered; keep them even when the customer drops them from the list.
    if (load.status === 'BOOKED') return true;
    // A load being worked (truck, driver, offer, assignment or tracking) that is genuinely
    // missing from the new list is kept too: it may be dispatched in Landstar before anyone
    // marks it BOOKED here. Same-lane duplicates of imported rows still consolidate.
    if (isLoadBeingWorked(load) && !rawImportedIds.has(normalizeLoadId(getBaseLoadId(load)))) return true;
    // Loads added by hand stay until you delete them.
    if (load.manualEntry || String(load.needsCapacity || '').trim()) return true;
    // Loads from before the RXO van state rule was added are cleared out on the next import.
    if (isRxoSkippedVanLoad(customer, load)) return false;
    // Same for loads to or from Mexico imported before that rule.
    if (isMexicoLoad(load)) return false;
    if (isSkippableEquipment(load.eCode)) return false;
    // RXO separate lists: equipment categories not in this file are left alone.
    if (equipmentScope && !equipmentScope.has(getRxoEquipmentListCategory(load))) return true;
    const exportedAt = Date.parse(load.landstarExportedAt);
    // A full customer list is the truth: anything not on it is deleted (exported ENT loads
    // too; their rates stay in the rate history). Booked and hand-added loads stay (above),
    // and screenshot imports keep loads you moved to ENT by hand (never exported).
    if (!additive) return load.status === 'ENT' && !Number.isFinite(exportedAt) && keepManualEnt;
    // Screenshot imports also keep loads moved to ENT by hand (no export date).
    const retainedArchive = load.status === 'ENT' && (Number.isFinite(exportedAt)
      ? now - exportedAt < exportedLoadRetentionMs
      : keepManualEnt);
    if (retainedArchive) return true;
    if (importedLaneDays.has(createLaneDayKey(load))) return false;
    return retainedArchive || (additive && !(load.status === 'ENT' && Number.isFinite(exportedAt)
      && now - exportedAt >= exportedLoadRetentionMs));
  });
  // Posted loads missing from this (full) list: the upload bot removes their Landstar
  // postings. Each is handed over once, so its saved posting details are cleared here.
  const dropped = reportDroppedPostings ? findDroppedPostings(customer, importedLoads, existingLoads, equipmentScope) : [];
  const droppedIds = new Set(dropped.map(load => String(load.id)));
  const droppedPostings = dropped.map(load => ({ customer, loadId: String(load.id), posting: load.landstarPosting }));
  const loads = [...mergedLoads, ...retained].map(load => {
    if (!droppedIds.has(String(load.id))) return load;
    const { landstarPosting, ...rest } = load;
    return rest;
  });
  return {
    loads, additive, processedLoads: mergedLoads, droppedPostings, skippedRxoVanCount, skippedMexicoCount, skippedEquipmentCount,
    laneDayDuplicateCount, equipmentScope,
    usesScreenshotStatus: holdsRedScreenshotLoads(customer)
      && importedLoads.some(load => ['ON HOLD', 'OPEN'].includes(load.screenshotStatus)),
    duplicateCount,
    removedCount: existingLoads.filter(load => !matchedIds.has(String(load.id)) && !retained.includes(load)).length
  };
}

function isNewDayForExistingLoad(existingLoad, importedLoad) {
  const existingKey = createLaneDayKey(existingLoad);
  const importedKey = createLaneDayKey(importedLoad);
  return Boolean(existingKey && importedKey && existingKey !== importedKey);
}

function toAlphabeticalSuffix(index) {
  let value = Number(index);
  let suffix = '';
  while (value >= 0) {
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26) - 1;
  }
  return suffix;
}

function getBaseLoadId(order) {
  return String(order?.sourceLoadId || order?.id || '').trim().replace(/-ALT[A-Z]+$/i, '');
}

// Returns true when the load's pickup date is before today (past-dated imports become ENT).
// A pickup window over several days counts by its last day, so it stays open until then.
function hasPastPickupDate(load) {
  const text = String(load?.pickupTime || load?.puDate || '');
  const match = [...text.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g)].pop();
  if (!match) return false;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const pickup = new Date(year, Number(match[1]) - 1, Number(match[2]));
  if (Number.isNaN(pickup.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return pickup < today;
}

function assignImportedLoadIdentity(importedLoad, existingLoads, stagedLoads) {
  const fallbackId = String(importedLoad?.id || '').trim();
  const baseId = getBaseLoadId(importedLoad) || fallbackId;
  if (!baseId) return importedLoad;

  const normalizedLoad = {
    ...importedLoad,
    sourceLoadId: baseId
  };
  const relatedLoads = [...existingLoads, ...stagedLoads].filter(load => getBaseLoadId(load) === baseId);
  const sameLaneDayLoad = relatedLoads.find(load => !isNewDayForExistingLoad(load, normalizedLoad));
  if (sameLaneDayLoad) {
    return { ...normalizedLoad, id: String(sameLaneDayLoad.id) };
  }

  const usedIds = new Set([...existingLoads, ...stagedLoads].map(load => String(load.id)));
  if (!usedIds.has(baseId)) return { ...normalizedLoad, id: baseId };

  let variantIndex = 0;
  let variantId = `${baseId}-ALT${toAlphabeticalSuffix(variantIndex)}`;
  while (usedIds.has(variantId)) {
    variantIndex += 1;
    variantId = `${baseId}-ALT${toAlphabeticalSuffix(variantIndex)}`;
  }
  return { ...normalizedLoad, id: variantId };
}

const isDatRateSource = source => /^dat/i.test(String(source || ''));

export {
  exportedLoadRetentionMs,
  isLoadBeingWorked,
  findDroppedPostings,
  isSkippableEquipment,
  getEquipmentListCategory,
  getRxoEquipmentListCategory,
  getLandstarCommodity,
  isHazmatLoad,
  isTankerLoad,
  rxoSkippedVanOriginStates,
  vanEquipmentCodes,
  isRxoSkippedVanLoad,
  isMexicoPlace,
  isMexicoLoad,
  importStatusPreservationCustomers,
  preservesImportedLoadStatus,
  normalizeLoadId,
  createLaneDayKey,
  getImportedLoadKey,
  replaceImportedCustomerLoads,
  isNewDayForExistingLoad,
  toAlphabeticalSuffix,
  getBaseLoadId,
  hasPastPickupDate,
  assignImportedLoadIdentity,
  isDatRateSource
};
