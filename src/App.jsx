import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from './lib/supabase';
import { isTmsOwner } from './lib/teamAdmin.js';
import { detectScreenshotGrid, readScreenshotGrid } from './lib/screenshotTable.js';
import { findNtgCardRegions } from './lib/ntgCards.js';
import { parseTextLoadList } from './lib/textLoads.js';
import { createEmailWorker, describeEmailWorker } from './lib/emailWorker.js';
import { createSendSpacer, withGmailQuotaRetry } from './lib/gmailRetry.js';
import { buildHotLanes, describeHotLane, getHotLane, hotLaneRate, hotLanesKey } from './lib/hotLanes.js';
import { applyBackgroundBrightness, readBackgroundBrightness } from './lib/backgroundBrightness.js';
import { isUploadedLogo, nflTeams, normalizeTeamLogo, teamLogoName, teamLogoSrc } from './lib/teamLogos.js';
import { getTeamRateRaise, newerHotLanes, teamHotLanesKey } from './lib/teamData.js';
import {
  splitScheduleRange, rxoCustomerName, rxoPayerCustomerName, ntgCustomerName, normalizeCustomerName, formatPhone, trackingStages, parseScheduleStart, hasPickupDayStarted, getBookedLoads, formatCheckTime, paramountTrackingCustomers, PARAMOUNT_AUTO_SEND_AFTER, paramountAlwaysAskKinds, MIN_LOADING_MINUTES, getLoadedTimeWarning, NEAR_STOP_HOLD_MILES, checkInOutStops, milesBetween, getNearStopWarning, getTrackingEmailWarning, LOCATION_EMAIL_HOUR, PICKUP_ETA_EMAIL_HOUR, paramountEmailKinds, paramountSignatureName, isParamountTrackingCustomer, isTrackedBookedLoad, trackingWatchEntry, getParamountWatchList, formatParamountTime, titleCase, paramountSignature, buildParamountEmail, getDueParamountEmails, isDailyCustomerUpdateDue, markParamountEmail, applyParamountTrackingInfo, DRIVER_EMAIL_HOUR, TRACKING_WATCH_DAYS, driverEmailLabels, PAPERWORK_DUE_HOURS, PAPERWORK_REMINDER_DAYS, getDeliveredAt, getPaperworkTarget, getPaperworkSince, getTrackingWatchList, atHourOf, sameLocalDay, getDueDriverEmails, getTrackingAppName, trackingAppNotice, buildDriverEmail, buildPaperworkEmail, markDriverEmail, TRACKING_REMINDER_FIRST_MINUTES, TRACKING_REMINDER_EVERY_MINUTES, TRACKING_REMINDER_START_HOUR, TRACKING_REMINDER_END_HOUR, TRACKING_REMINDER_MAX, findTruckerToolsStart, markTrackingStarted, isTrackingReminderDue, getTruckerToolsStatus, getPendingDriverStatusReply, findDriverEta, buildParamountEtaEmail, rxoTrackingCustomers, RXO_ETA_BLANK, isRxoTrackingCustomer, isRxoAccount, getTrackingEmailBroker, getRxoWatchList, getEmailPostingCode, getRxoEmailPostingCodes, findRxoLoadForRequest, buildRxoUpdateEmail, getCustomerRequestOrders, greetingNameFrom,
  trackingEmailId, driverEmailId, dailyCustomerEmailId, manualUpdateKinds, buildManualUpdateEmail
} from './lib/trackingEmails.js';
import Prospects from './Prospects.jsx';
import ChOffers from './ChOffers.jsx';
import { ProblemBanner, TodayPanel } from './TodayPanel.jsx';
import { findBigListChanges, describeListChange, restoredPostedLoads } from './lib/undo.js';
import LoadTable from './LoadTable.jsx';
import { getCustomerRules, hasCustomerRules, filterByImportEquipment, ruleEquipment2, ruleLaneRate, startingRate, higherRate } from './app/customerRules.js';
import CustomerRulesPanel from './app/CustomerRulesPanel.jsx';
import { groupCustomers, moveCustomers, splitCustomerName, shortAccountName, accountTagKind } from './app/customerGroups.js';
import { accountKey, findListedAccount } from './lib/accountAliases.js';
import { lookupTruck, rememberTruck, lookupCarrier, rememberCarrier, fillFromTruck, truckKey } from './lib/capacityBook.js';
import { splitBigList, addToSnbList, BIG_LIST_MILES, isPriorityBigListLane } from './lib/bigListSplit.js';
import { aiRowToLoad, imageForAi } from './lib/aiScreenshot.js';
import { chOfferToTmsLoad, getTodaysExportedLanes, CH_TMS_ACCOUNT } from './lib/chOffers.js';
import { parseChatLoadMessage, chatLoadAccount, chatLoadToTmsLoad } from './lib/chatLoads.js';
import automationPolicy from '../bot/automation-policy.json';
import {
  getEquipmentDescription,
  isTeamEquipment,
  isTeamLoad,
  normalizeEquipmentCode,
  getLandstarEquipment2,
  getLandstarEquipmentCode,
  isFlatbedEquipment
} from './app/equipment.js';
import {
  canadianPostalDatabase,
  findCanadianPlace,
  lookupCanadianPostalCode,
  normalizeCanadianPostalCode
} from './app/canada.js';
import {
  ameriCustomerKey,
  isAmeriCustomer,
  ameriColonyRates,
  ameriYorkRates,
  fixedLaneRates,
  ameriMenardsStops,
  ameriPickupHours,
  AMERI_MENARDS_WEIGHT,
  AMERI_WEIGHT,
  ameriPlaceKey,
  isAmeriMenardsLoad,
  applyAmeriLoadDefaults,
  normalizeFixedLaneCity,
  getFixedLaneRate,
  createLaneRateKey,
  getSavedLaneRate
} from './app/laneRates.js';
import {
  isNolanCustomer,
  isRxoCustomer,
  redHoldScreenshotCustomers,
  holdsRedScreenshotLoads,
  isCh593772Customer
} from './app/customers.js';
import {
  screenshotColumns,
  stateCodes,
  clusterPositions,
  detectColumnsFromData,
  detectScreenshotColumns,
  detectColumnsFromHeader,
  parseWeightPounds,
  parseScreenshotLines,
  findNtgCards,
  parseNtgScreenshotLines,
  editDistance,
  parseDatScreenshotLines,
  findChHeaders,
  getChColumnBounds,
  parseChWeight,
  parseChScreenshotLines,
  normalizeMilesValue
} from './app/screenshotParsers.js';
import {
  isCityGridScreenshot,
  ocrStateLookalikes,
  readCityGridDates,
  parseCityGridScreenshotText
} from './app/cityGrid.js';
import {
  zipDatabase,
  autoFillLoadZipCodes,
  parseGmailLoadEmail
} from './app/gmailLoads.js';
import {
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
} from './app/importRules.js';
import {
  datRegionCityAliases,
  correctDatCities,
  correctCitiesFromZip
} from './app/cityFixes.js';
import {
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
} from './app/bookings.js';
import {
  loadMatchesSearch,
  getLoadSearchEntries
} from './app/search.js';
import {
  bookingLogKey,
  BookingsReportPage
} from './app/BookingsReportPage.jsx';
import {
  SYSTEM_CHECK_URL,
  systemCheckShownKey,
  systemCheckColors,
  systemCheckRank,
  emailCheckRow,
  mergeSystemCheck,
  SystemCheck
} from './app/SystemCheck.jsx';
import {
  loadListHistoryReasons,
  describeLoadListSummary,
  LoadListHistory
} from './app/LoadListHistory.jsx';
import {
  TeamInvite
} from './app/TeamInvite.jsx';
import {
  toolsPinnedKey,
  isPhoneScreen,
  readToolsPinned,
  ToolsDrawer
} from './app/ToolsDrawer.jsx';
import {
  formatRxoExcelDateTime,
  toExcelDateTime,
  parseSchedulePickerParts,
  formatSchedulePickerParts
} from './app/dates.js';
import {
  truckLights,
  truckStacks,
  smokePuffs,
  truckFlashMs,
  TruckLights,
  canStartBotHere,
  LocalBotsSwitch,
  describeRateWorker,
  RateWorkerLight,
  HelperBotLight,
  EmailWorkerStatus
} from './app/BotLights.jsx';
import {
  InquiriesPanel,
  LoadEmailBox,
  paramountApprovedKey,
  driverApprovedKey,
  paperworkApprovedKey,
  rxoApprovedKey,
  readApprovedCount
} from './app/LoadEmailBox.jsx';
import {
  readCanvasStrip,
  voteNtgLoadNumber,
  fillMissingNtgCardDetails,
  readNtgScreenshotCards,
  readChScreenshot
} from './app/screenshotReading.jsx';
import {
  buildDriverDirectory,
  checkCallDueMs,
  getLastCheckCall,
  getTrackingAlert,
  buildDriverText,
  inquiryCompanyName,
  buildInquiryDetails
} from './app/driverInfo.js';
import {
  playExportSound,
  WELCOME_LINES,
  speakWelcomeGreeting
} from './app/sounds.jsx';
import {
  excelSerialToBoardTime,
  postingZip,
  buildLandstarPosting,
  BOT_UNPOST_URL,
  unpostQueueKey,
  readUnpostQueue,
  writeUnpostQueue,
  BOT_ASSIGN_URL,
  assignQueueKey,
  buildAssignRequest,
  getCarrierMc,
  readAssignQueue,
  sendAssignQueueToBot,
  sendUnpostQueueToBot
} from './app/botQueues.jsx';

// Landstar's bulk upload accepts at most 25 loads per spreadsheet.
const landstarExportChunkSize = 25;

// A load added by hand (＋ Add Load). It stays in the TMS until you delete it: imports of
// the customer's list never remove it, it never expires, and its Landstar posting is never
// sent to the bot for removal.
function createManualLoad(id, fields = {}) {
  return {
    id: String(id || '').trim() || `MANUAL-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    eCode: 'VZ', status: 'OPEN', tag: 'OPEN', route: '', puDate: 'PU: Today', delDate: 'DFL: Upcoming',
    pickupTime: '', origCity: '', origSt: '', origZip: '', weight: '', deliveryTime: '',
    destCity: '', destSt: '', destZip: '', miles: '', planningComment: 'Added by hand',
    carrier: '', driver: '', truck: '', trailer: '', rateInput: '', brokerable: 'false', notes: '',
    ...fields,
    manualEntry: true
  };
}

function getCitySuggestions(zipData, query, state = '') {
  const text = String(query || '').trim().toUpperCase();
  if (text.length < 2) return [];
  const seen = new Set();
  return Object.values(zipData?.codes || {}).filter(place => {
    const key = `${place.city.toUpperCase()}, ${place.state}`;
    if (seen.has(key) || (state && place.state !== state.toUpperCase())
      || !key.startsWith(text)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.city.localeCompare(b.city) || a.state.localeCompare(b.state)).slice(0, 30);
}

function applyLocationInput(load, field, value, zipData) {
  const next = { ...load, [field]: value };
  const prefix = field.startsWith('orig') ? 'orig' : 'dest';
  const cityField = `${prefix}City`;
  const stateField = `${prefix}St`;
  const zipField = `${prefix}Zip`;
  if (field === zipField) {
    const place = zipData?.codes?.[String(value).trim()];
    if (place) Object.assign(next, { [cityField]: place.city.toUpperCase(), [stateField]: place.state });
  } else {
    if (field === cityField && value !== load[field]) next[zipField] = '';
    const label = String(next[cityField] || '').match(/^(.+),\s*([A-Z]{2})$/i);
    const city = String(label?.[1] || next[cityField] || '').trim();
    const state = String(label?.[2] || next[stateField] || '').trim().toUpperCase();
    const matches = (zipData?.lookupByName?.(city, state) || [])
      .filter(place => place.city.toUpperCase() === city.toUpperCase() && place.state === state)
      .sort((a, b) => a.zip.localeCompare(b.zip));
    if (matches.length) Object.assign(next, {
      [cityField]: matches[0].city.toUpperCase(), [stateField]: matches[0].state,
      [zipField]: matches.some(place => place.zip === next[zipField]) ? next[zipField] : matches[0].zip
    });
    else if (field === stateField && value !== load[field]) next[zipField] = '';
  }
  if (['google', 'estimated'].includes(load.milesSource)
    && [cityField, stateField, zipField].some(key => next[key] !== load[key])) {
    next.miles = '';
    delete next.milesSource;
  }
  return next;
}

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

// "📄 Copy Load" in the order editor: a new load in the same customer carrying the route,
// schedule, weight, miles, equipment, rate and comments of an existing one, so a repeat
// load only needs a new order # and whatever differs. The copy starts OPEN with no driver,
// truck or tracking, and imports keep it like any load added by hand.
const LOAD_COPY_FIELDS = [
  'eCode', 'route', 'puDate', 'delDate', 'pickupTime', 'origCity', 'origSt', 'origZip',
  'weight', 'deliveryTime', 'destCity', 'destSt', 'destZip', 'miles', 'rateInput',
  'rateSource', 'brokerable', 'postingCode', 'landstarComment', 'planningComment',
  'notes', 'team', 'hazmat', 'tanker', 'commodity', 'equipment2', 'equipment3'
];
function copyLoadDetails(load, newId) {
  const fields = {};
  LOAD_COPY_FIELDS.forEach(field => {
    if (load?.[field] !== undefined && load?.[field] !== '') fields[field] = load[field];
  });
  return createManualLoad(newId, fields);
}

function removeExpiredExportedLoads(customerOrders, now = Date.now()) {
  let changed = false;
  const nextOrders = {};
  Object.entries(customerOrders).forEach(([customer, loads]) => {
    nextOrders[customer] = loads.filter(load => {
      if (load.manualEntry || String(load.needsCapacity || '').trim()) return true;
      if (load.status !== 'ENT' || !load.landstarExportedAt) return true;
      const exportedAt = Date.parse(load.coveredAt || load.landstarExportedAt);
      const keep = !Number.isFinite(exportedAt) || now - exportedAt < exportedLoadRetentionMs;
      if (!keep) changed = true;
      return keep;
    });
  });
  return changed ? nextOrders : customerOrders;
}

// Standard comments from the "Comments" tab of Landstar's bulk template (column AA).
const landstarCommentOptions = [
  'All inclusive rate', 'Animals prohibited at facility', 'Driver Assist', 'Includes FSC', 'Load Ready now',
  'No Facial hair allowed', 'No touch', 'Round Trip', 'Tarping Required', 'Tracking Required',
  'Truck may be subject to security inspection onsite'
];

// The ZIP is the source of truth on export: when a valid US ZIP was entered, Landstar gets
// that ZIP's postal city and state, whatever city/state is typed on the load.
function getExportPlace(typedCity, typedState, zipLocation) {
  if (zipLocation?.city) {
    return { city: zipLocation.city, state: String(zipLocation.state || typedState || '').toUpperCase(), fromZip: true };
  }
  return { city: typedCity, state: typedState, fromZip: false };
}

function getStatusTag(status) {
  if (status === 'ENT') return 'ENT';
  if (status === 'ON HOLD') return 'HOLD';
  if (status === 'OFFER') return 'OFFER';
  if (status === 'BOOKED') return 'BOOKED';
  return 'OPEN';
}

function moveToOfferWithDriverPhone(load) {
  return load.status !== 'BOOKED' && /\d/.test(String(load.driverPhone || ''))
    ? { ...load, status: 'OFFER', tag: 'OFFER' }
    : load;
}

// Booking a load needs a driver; the load moves to the Booked Loads folder.
function bookLoad(load, bookedAt = new Date().toISOString()) {
  // An approved carrier (MC #) can be booked before its driver is known.
  if (!String(load?.driver || '').trim() && !String(load?.carrierMc || '').replace(/\D/g, '')) {
    throw new Error('Enter the driver name (or the approved carrier MC #) before booking this load.');
  }
  // Booking covers the capacity need, so the ⭐ flag clears itself.
  const { needsCapacity, ...rest } = load;
  return { ...rest, status: 'BOOKED', tag: 'BOOKED', bookedAt: load.bookedAt || bookedAt };
}

// Takes the truck off a booked load: clears the driver, equipment, pickup ETA, previous
// empty location and tracking, and puts the load back in OPEN so it can be re-booked or
// exported. The rate and every other load detail are kept.
// The driver's details as one text block for chats and emails:
//   Driver 1 / name / phone / Tractor 1 / truck / Trailer 1 / trailer /
//   Previous Empty / location / Pickup ETA / eta / load#123
// A section with nothing filled in is left out.
function formatDriverInfo(load) {
  const value = field => String(load?.[field] || '').trim();
  const lines = [];
  if (value('driver') || value('driverPhone')) lines.push('Driver 1', ...[value('driver'), value('driverPhone')].filter(Boolean));
  if (value('truck')) lines.push('Tractor 1', value('truck'));
  if (value('trailer')) lines.push('Trailer 1', value('trailer'));
  if (value('emptyLocation')) lines.push('Previous Empty', value('emptyLocation'));
  if (value('pickupEta')) lines.push('Pickup ETA', value('pickupEta'));
  lines.push(`load#${value('id')}`);
  return lines.join('\n');
}

// "Copy Order #" by the order title: the order number, plus the previous empty
// location on the next line when one is entered.
function formatOrderCopy(load) {
  const emptyLocation = String(load?.emptyLocation || '').trim();
  return [String(load?.id || '').trim(), emptyLocation].filter(Boolean).join('\n');
}

function removeCapacity(load) {
  const { bookedAt, trackingStage, checkCalls, paramountTracking, driverEmails, trackingStartedAt,
    trackingStartedByHand, paperworkReceivedAt, paperworkFiles, paperworkSince, paperworkDone,
    paperworkSentAt, driverReplyIds, driverRepliesSeenAt, etaReplyIds, customerStatusReplyIds,
    customerStatusReportedAt, ...rest } = load || {};
  return { ...rest, manualEntry: true, needsCapacity: 'true', status: 'OPEN', tag: 'OPEN', driver: '', driverPhone: '', truck: '', trailer: '', pickupEta: '', emptyLocation: '' };
}

function getPostingRefreshDetails(load) {
  return ['origCity', 'origSt', 'origZip', 'destCity', 'destSt', 'destZip', 'pickupTime',
    'deliveryTime', 'weight', 'eCode', 'rateInput', 'rateSource', 'landstarComment',
    'planningComment', 'team', 'brokerable', 'commodity', 'equipment2', 'equipment3']
    .map(field => String(load[field] || '').trim());
}

function getPostingMaintenanceLoads(customerOrders) {
  return Object.entries(customerOrders).flatMap(([customer, loads]) => loads
    .filter(load => load.landstarPosting && (load.manualEntry || String(load.needsCapacity || '').trim() || load.status === 'BOOKED'))
    .map(load => ({
      customer, loadId: String(load.id), posting: load.landstarPosting,
      revision: getPostingRefreshDetails(load),
      refresh: Boolean(String(load.needsCapacity || '').trim()) && ['OPEN', 'ENT'].includes(load.status) && !String(load.truck || '').trim(),
      status: load.status, truck: load.truck || '',
      pickupTime: load.pickupTime || '', deliveryTime: load.deliveryTime || '',
      origCity: load.origCity || '', origSt: load.origSt || '',
      destCity: load.destCity || '', destSt: load.destSt || '',
      weight: load.weight || '', eCode: load.eCode || ''
    })));
}

function findKnownDriver(directory, name) {
  const key = String(name || '').trim().toUpperCase();
  return key ? directory.drivers.find(entry => entry.driver.toUpperCase() === key) || null : null;
}

// Exported loads stay in their folder (OPEN stays OPEN, Daniel 2026-11-27) and remember when they
// were posted; they move to ENT only when a new list no longer has them (covered).
function markLoadsExported(loads, exportedIds, exportedAt) {
  return loads.map(load => {
    if (!exportedIds.has(String(load.id))) return load;
    const { exportError, landstarConfirmedAt, ...rest } = load;
    return { ...rest, landstarExportedAt: exportedAt };
  });
}

const canadianProvinceCodes = new Set('AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' '));

canadianProvinceCodes.forEach(code => stateCodes.add(code));
const sortedStateCodes = Array.from(stateCodes).sort();

function getCountryForRegion(region) {
  return canadianProvinceCodes.has(String(region || '').trim().toUpperCase()) ? 'CA' : 'US';
}

function parseDatRateText(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (/\/\s*mi\b/i.test(line)) continue;
    const match = line.match(/^\$?\s*(\d{1,3}(?:,\d{3})+|\d{3,5})(?:\.00)?\s*$/);
    if (match) {
      const rate = Number(match[1].replace(/,/g, ''));
      if (rate >= 100 && rate < 100000) return rate;
    }
  }
  return 0;
}

function formatExcelDateTime(val) {
  if (val == null || val === '') return '10/18/2026 0800 - 1200';
  if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
    return formatRxoExcelDateTime(val);
  }
  const str = String(val).trim();
  if (/^\d+(?:\.\d+)?$/.test(str) && Number(str) >= 10000) {
    return formatRxoExcelDateTime(Number(str));
  }
  return str;
}

function formatRxoBusinessHours(dateTime, endTime) {
  const dateMatch = String(dateTime || '').match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (!dateMatch) return dateTime;
  const [, month, day, yearText] = dateMatch;
  const year = yearText.length === 2 ? `20${yearText}` : yearText;
  const date = `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`;
  return `${date} 0800 - ${endTime}`;
}

function applyRxoPayerBusinessHours(loads, customer) {
  if (normalizeCustomerName(customer) !== rxoPayerCustomerName) return loads;
  return loads.map(load => ({
    ...load,
    pickupTime: formatRxoBusinessHours(load.pickupTime || load.puDate, '2000'),
    deliveryTime: formatRxoBusinessHours(load.deliveryTime || load.delDate, '1200')
  }));
}

function decodeGmailBody(data) {
  const base64 = String(data || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function getGmailMessageText(payload, selectedBroker) {
  const plainParts = [];
  const htmlParts = [];
  const collectParts = part => {
    if (part.body?.data) {
      if (part.mimeType === 'text/plain') plainParts.push(decodeGmailBody(part.body.data));
      if (part.mimeType === 'text/html') htmlParts.push(decodeGmailBody(part.body.data));
    }
    (part.parts || []).forEach(collectParts);
  };
  collectParts(payload);
  if (isCh593772Customer(selectedBroker) && htmlParts.length) {
    const document = new DOMParser().parseFromString(
      htmlParts.join('\n').replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])\s*>/gi, '\n'), 'text/html'
    );
    const rows = [...document.querySelectorAll('tr')];
    if (rows.some(row => [...row.cells].some(cell => /^bin\b/i.test(cell.textContent.trim())))) {
      rows.forEach(row => row.replaceWith(document.createTextNode(`\n${[...row.cells]
        .map(cell => cell.textContent.replace(/\s+/g, ' ').trim()).join('\t')}\n`)));
      return document.body.textContent || '';
    }
  }
  if (plainParts.length) return plainParts.join('\n');
  if (!htmlParts.length) return '';

  const htmlAsText = htmlParts.join('\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:tr|p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, '\n');
  const document = new DOMParser().parseFromString(htmlAsText, 'text/html');
  return (document.body.textContent || '').replace(/[ \t]+\n/g, '\n');
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) resolve();
      else reject(new Error('Google authorization did not initialize.'));
    };
    script.onerror = () => reject(new Error('Could not load Google authorization. Check your internet connection.'));
    document.head.appendChild(script);
  });
}

async function getGmailApiError(response, action) {
  let details = '';
  try {
    const body = await response.json();
    const apiError = body.error;
    details = apiError?.message || apiError?.errors?.[0]?.reason || '';
  } catch (error) {
    console.error(`Could not read Gmail ${action} error details:`, error);
  }
  return new Error(`Gmail ${action} failed (${response.status})${details ? `: ${details}` : '.'}`);
}

// Earliest pickup start Landstar will accept, as an Excel serial on the local clock:
// now plus a lead time (for the upload bot's rate check and upload), rounded up to
// the next quarter hour. Landstar rejects "Pickup Start Date cannot be in the past".
function getEarliestPickupSerial(now = new Date(), leadMinutes = 30) {
  const quarterHour = 15 * 60 * 1000;
  const wallClock = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + leadMinutes);
  return (Math.ceil(wallClock / quarterHour) * quarterHour - Date.UTC(1899, 11, 30)) / 86400000;
}

// Tabs of an Excel workbook that hold loads: the first tab always (as before), plus any
// other tab whose header row names a load number and an origin city column, so a
// customer's list split across tabs imports as one list and summary tabs are ignored.
const loadIdHeaders = ['order #', 'load id', 'order number', 'load posting code'];
const originCityHeaders = ['origin city', 'orig city', 'origin', 'origin - city'];
// The Phalanx list's columns (Pha 882255 - ATZ, 2026-11-25), from "Load ID" to "Rate".
const phalanxColumns = ['Load ID', 'Brokerage status', 'Equip type', 'Stops', 'Order type', 'Origin city', 'Origin state',
  'Early P/U dt', 'Late P/U dt', 'Dest city', 'Dest state', 'Early del dt', 'Late del dt', 'Commodity', 'Weight', 'Distance', 'Rate'];

// A Phalanx list copied without its header row ("Phalanx Flatbed.ods", agent AAQ, 2026-11-27):
// the first row is already a load, often with a row number in front:
//   [9, 170159, 'AVAIL', 'F', 0, 'FTL', 'GRAND PRAIRIE', 'TX', '11/30/2026 0730', ...]
// Found by "FTL"/"LTL" with the origin and a pickup date and time after it; the Phalanx column
// names are put on top so the rate and every other column are read from the right place and
// the first load is kept. Other sheets are returned as they are.
function addMissingPhalanxHeader(rows) {
  const first = rows?.[0] || [];
  if (first.some(cell => /^(load id|order #|origin city|early p\/u dt|rate)$/i.test(String(cell ?? '').trim()))) return rows;
  const orderTypeAt = first.findIndex(cell => /^(FTL|LTL)$/i.test(String(cell ?? '').trim()));
  const loadIdAt = orderTypeAt - 4;
  if (loadIdAt < 0
    || !/^[A-Z]{2}$/i.test(String(first[orderTypeAt + 2] ?? '').trim())
    || !/^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{3,4}$/.test(String(first[orderTypeAt + 3] ?? '').trim())
    || !/^\d{4,}$/.test(String(first[loadIdAt] ?? '').trim())) return rows;
  const width = Math.max(...rows.map(row => row.length), loadIdAt + phalanxColumns.length);
  const header = Array.from({ length: width }, (_, index) => {
    const name = phalanxColumns[index - loadIdAt];
    return index < loadIdAt ? `#${index + 1}` : name || '';
  });
  return [header, ...rows];
}

function getLoadSheetNames(workbook, xlsx) {
  const names = workbook?.SheetNames || [];
  return names.filter((name, index) => {
    if (index === 0) return true;
    const header = (xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1 })[0] || [])
      .map(cell => String(cell || '').trim().toLowerCase());
    return header.some(cell => loadIdHeaders.includes(cell)) && header.some(cell => originCityHeaders.includes(cell));
  });
}

// A pickup window that already started but is still open is posted from the earliest
// allowed start (its end stays the same); a window that is over can't be posted.
function adjustPickupWindow(pickupFrom, pickupThru, earliestStart) {
  if (pickupFrom === null || pickupThru === null) return { from: pickupFrom, ended: false, moved: false };
  if (pickupThru < earliestStart) return { from: pickupFrom, ended: true, moved: false };
  if (pickupFrom < earliestStart) return { from: earliestStart, ended: false, moved: true };
  return { from: pickupFrom, ended: false, moved: false };
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

const defaultFuelSurchargeRates = { east: '0.86', midwest: '0.88', west: '1.03', newEngland: '0.89' };

function normalizeFuelSurchargeRates(value) {
  const rates = { ...defaultFuelSurchargeRates };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return rates;
  // Settings saved before the four email regions: National -> East and Midwest, West Coast -> West.
  if (!['east', 'midwest', 'west'].some(key => key in value) && ('national' in value || 'westCoast' in value)) {
    value = { east: value.national, midwest: value.national, west: value.westCoast, newEngland: value.newEngland };
  }
  Object.keys(rates).forEach(key => {
    const parsed = Number(String(value[key] ?? '').replace(/[$,]/g, ''));
    rates[key] = parsed > 0 ? String(Math.round(parsed * 100) / 100) : '';
  });
  return rates;
}

// The weekly fuel email: "11/3/2026   East .86  Midwest .88   West 1.03 New England .89".
// Returns { date, rates } or null (all four rates must be there and look like $/mile).
function parseFuelSurchargeEmail(text) {
  const value = String(text || '');
  const rate = name => {
    const match = value.match(new RegExp(`${name}\\s*[:=]?\\s*\\$?(\\d*\\.\\d+|\\d+(?:\\.\\d+)?)`, 'i'));
    const number = match ? Number(match[1]) : NaN;
    return number >= 0.3 && number <= 2.5 ? String(Math.round(number * 100) / 100) : '';
  };
  const rates = { east: rate('(?<!north)east'), midwest: rate('midwest'), west: rate('(?<!mid)west'), newEngland: rate('new\\s*england') };
  if (Object.values(rates).some(item => !item)) return null;
  const date = value.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/)?.[1] || '';
  return { date, rates };
}

function getDisplayEquipmentCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (code === 'VE') return 'VAN';
  return isTeamEquipment(code) ? 'V' : value;
}

// AMERI 18347- ATZ (exact account; Daniel 2026-11-27): one posting offers both trailers,
// Equipment 1 VAN and Equipment 2 REFR, at the same contract rate. A REFR or other
// alternate picked by hand on the load (equipment2) still wins.
function getLandstarExportEquipment2(customer, ord, postingCode = '', rules = null) {
  // ⚙ This customer's rules win (a 2nd equipment picked by hand on the load still wins over them).
  if (ord?.equipment2 === undefined) {
    const fromRules = ruleEquipment2(rules);
    if (fromRules !== undefined) return fromRules;
  }
  if (isAmeriCustomer(customer) && ord?.equipment2 === undefined
    && getLandstarEquipmentCode(ord?.eCode) === 'VAN') return 'REFR';
  // Agent AAQ's Phalanx loads post as flatbed only: no Step Deck alternate.
  if (isFlatbedOnlyPhalanx(customer, postingCode) && ord?.equipment2 === undefined) return '';
  return getLandstarEquipment2(ord);
}

// Agent AAQ's PHAL account (Daniel 2026-11-27): imports only the F (flatbed) loads of a list and
// posts them as FLAT with no Step Deck alternate. Known by its name starting with "Phal" (PHAL /
// Phalanx), whatever posting code the TMS has, or by any "Pha" account in a TMS whose posting
// code is AAQ. Daniel's "Pha 882255 - ATZ" (posted under ANQ) stays as it is.
const FLATBED_ONLY_PHALANX_CODES = new Set(['AAQ']);
function isFlatbedOnlyPhalanx(customer, postingCode) {
  const name = normalizeCustomerName(customer);
  if (/^\s*phal/i.test(name)) return true;
  return FLATBED_ONLY_PHALANX_CODES.has(String(postingCode || '').trim().toUpperCase()) && /^\s*pha\b/i.test(name);
}

// Is this load a flatbed (F, FLAT, 48/53 ft flatbed)? Step deck and conestoga are not.
function isFlatbedLoad(load) {
  return ['FLAT', '48FL', '53FL'].includes(getLandstarEquipmentCode(load?.eCode));
}

const equipmentOptions = [
  ['V', 'Van'], ['VZ', 'Van - hazmat'], ['VE', 'Van - non-hazardous chemicals'],
  ['R', 'Reefer'], ['RZ', 'Reefer - hazmat'], ['F', 'Flatbed'],
  ['FV', 'Flatbed - hazmat'], ['SD', 'Step deck'], ['FH', 'Flatbed hotshot'],
  ['FLCS', 'Conestoga'], ['D-ST', 'Straight truck'], ['D-LG', 'Straight truck - liftgate required'],
  ['D-RF', 'Straight truck - reefer'],
  ['24VN', '24-foot van'], ['28VN', '28-foot van'], ['48VN', '48-foot van'], ['53VN', '53-foot van'],
  ['48FL', '48-foot flatbed'], ['53FL', '53-foot flatbed'], ['53SD', '53-foot step deck']
];

// Customer lists mark hazmat and tanker freight in the equipment type ("Van Hazmat",
// "Tanker") or the commodity ("HAZMAT CHEMICALS"). "NON-HAZMAT ..." is not hazmat.
function getImportedHazmatTanker(equipment, commodities = []) {
  const flags = {};
  const text = [equipment, ...commodities].map(value => String(value || '')).join(' | ');
  if (/(?<!NON[-\s]?)\bHAZ\s*MAT\b/i.test(text)) flags.hazmat = 'true';
  if (/\bTANK(ER)?\b/i.test(String(equipment || ''))) flags.tanker = 'true';
  return flags;
}

function getLoadCommodity(load) {
  if (['CGAPP', 'HAZMAT', 'CHEM'].includes(load?.commodity)) return load.commodity;
  return isHazmatLoad(load) ? 'HAZMAT' : getLandstarCommodity(load?.eCode);
}

function getLandstarCommodityValue(code) {
  const commodityValues = {
    CGAPP: 'CGAPP-CONSUMER GOODS OR APPLIANCES',
    HAZMAT: 'HAZMAT-HAZMAT NON-HIGH RISK OR AA&E BRP',
    CHEM: 'CHEM-CHEMICALS (NON-HAZ/REGULATED)'
  };
  return commodityValues[code] || '';
}

function getLandstarCity(value, location) {
  const city = String(value || '').trim();
  const postalCity = String(location?.city || '').trim();
  const normalize = name => name.toUpperCase()
    .replace(/\bST\b\.?/g, 'SAINT').replace(/\bMT\b\.?/g, 'MOUNT').replace(/\bFT\b\.?/g, 'FORT')
    .replace(/[^A-Z0-9]/g, '');
  return postalCity && normalize(city) === normalize(postalCity) ? postalCity : city;
}

// Landstar caps city fields at 18 characters; shorten known long names, then hard-truncate.
// ZIP city names Landstar rejects as "Invalid Origin/Destination", mapped to the
// spelling its city list uses (the Post Office's short name, as shown on the board).
const landstarCityAbbreviations = {
  'WASHINGTON COURT HOUSE': 'Washington CH',
  'HOT SPRINGS NATIONAL PARK': 'Hot Sprs', // ZIP 71901/71913
  'FEASTERVILLE TREVOSE': 'Fstrvl Trvose', // ZIP 19053
  'MC CORDSVILLE': 'McCordsville' // ZIP 46055
};
// Landstar shortens military-base names (e.g. its city list has "MARCH ARB, CA" for
// ZIP 92518 "March Air Reserve Base"); cutting them at 18 characters instead gives a
// name Landstar rejects as "Invalid Origin".
const landstarCityPhrases = [
  [/\bAir Reserve Base\b/i, 'ARB'],
  [/\bAir Force Base\b/i, 'AFB'],
  [/\bNaval Air Station\b/i, 'NAS'],
  [/\bMarine Corps Air Station\b/i, 'MCAS']
];
function toLandstarCity(value) {
  const city = String(value || '').trim();
  let abbreviated = landstarCityAbbreviations[city.toUpperCase()] || city;
  if (abbreviated.length > 18) {
    landstarCityPhrases.forEach(([phrase, short]) => { abbreviated = abbreviated.replace(phrase, short); });
  }
  return abbreviated.length > 18 ? abbreviated.slice(0, 18).trim() : abbreviated;
}

function getImportedLoadSelection(customer, importedLoads) {
  return isNolanCustomer(customer)
    ? Array.from(new Set(importedLoads.map(load => load.id)))
    : [];
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

// R X O 2429200 - ATZ only: a load that picks up and delivers in the same city is never exported.
function isRxoSameCityLoad(customer, load) {
  if (normalizeCustomerName(customer) !== rxoCustomerName) return false;
  const place = (city, state) => `${String(city || '').toUpperCase().replace(/[^A-Z]/g, '')}|${String(state || '').trim().toUpperCase()}`;
  const origin = place(load?.origCity, load?.origSt);
  return origin !== '|' && !origin.startsWith('|') && origin === place(load?.destCity, load?.destSt);
}

function isParaCustomer(name) {
  return accountKey(normalizeCustomerName(name)) === 'PARA1522166ATZ';
}

// When Google Routes can't answer, driving miles are estimated from the two ZIP codes:
// straight-line miles between them times 1.2 (roads are about 20% longer than a straight line).
const zipRoadMilesFactor = 1.2;

function estimateRoadMilesFromZips(zipData, originZip, destZip) {
  const zip5 = value => String(value || '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(zip5(originZip)) || !/^\d{5}$/.test(zip5(destZip))) return '';
  if (!zipData?.lookup?.(zip5(originZip)) || !zipData?.lookup?.(zip5(destZip))) return '';
  const straightMiles = Number(zipData.distance(zip5(originZip), zip5(destZip)));
  return straightMiles > 0 ? String(Math.round(straightMiles * zipRoadMilesFactor)) : '';
}

// Google Routes charges per lookup, so the driving miles for each lane are saved the first
// time Google answers and reused after that (roads don't move). A lane is its origin and
// destination ZIPs, or city + state when a ZIP is missing. Saved in this browser only.
const roadMilesCacheKey = 'landstar_roadMilesCache';

function getRoadMilesLaneKey(order) {
  const zip5 = value => String(value || '').trim().slice(0, 5);
  if (/^\d{5}$/.test(zip5(order?.origZip)) && /^\d{5}$/.test(zip5(order?.destZip))) {
    return `${zip5(order.origZip)}>${zip5(order.destZip)}`;
  }
  const place = (city, state) => {
    const cityKey = String(city || '').toUpperCase().replace(/[^A-Z]/g, '');
    const stateKey = String(state || '').trim().toUpperCase();
    return cityKey && stateKey ? `${cityKey},${stateKey}` : '';
  };
  const origin = place(order?.origCity, order?.origSt);
  const destination = place(order?.destCity, order?.destSt);
  return origin && destination ? `${origin}>${destination}` : '';
}

function readRoadMilesCache() {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(roadMilesCacheKey) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function saveRoadMiles(laneKey, miles) {
  if (!laneKey) return;
  try {
    const cache = readRoadMilesCache();
    cache[laneKey] = miles;
    globalThis.localStorage?.setItem(roadMilesCacheKey, JSON.stringify(cache));
  } catch (error) {
    console.error('Could not save the lane miles:', error);
  }
}

async function getGoogleRoadMiles(order) {
  const laneKey = getRoadMilesLaneKey(order);
  const savedMiles = laneKey ? readRoadMilesCache()[laneKey] : undefined;
  if (Number(savedMiles) > 0) return String(savedMiles);
  const response = await fetch('/api/road-miles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origin: { city: order.origCity, state: order.origSt, zip: order.origZip },
      destination: { city: order.destCity, state: order.destSt, zip: order.destZip }
    })
  });
  let result;
  try {
    result = await response.json();
  } catch (error) {
    console.error('Could not read Google Routes road-mile response:', error);
    throw new Error(`Google Routes returned an invalid response for load ${order.id}.`);
  }
  if (!response.ok || !Number.isFinite(result?.miles) || result.miles <= 0) {
    throw new Error(`Could not calculate driving miles for load ${order.id}: ${result?.error || 'Google Routes returned no valid mileage.'}`);
  }
  saveRoadMiles(laneKey, String(result.miles));
  return String(result.miles);
}

// Import policy: every imported load uses Google Routes driving miles instead of
// the miles printed on the import, for every customer. Lookups run a few at a time
// so big imports do not wait on one request after another.
const importLookupConcurrency = 5;

async function applyGoogleRoadMiles(loads, onProgress, sourceLabel) {
  const eligible = loads.filter(load => load.origCity && load.origSt && load.destCity && load.destSt);
  let mileageError = '';
  let done = 0;
  let failed = false;
  for (let start = 0; start < eligible.length; start += importLookupConcurrency) {
    const batch = eligible.slice(start, start + importLookupConcurrency);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(batch.map(async load => {
      if (failed) return;
      try {
        load.miles = await getGoogleRoadMiles(load);
        const note = 'driving miles calculated by Google Routes';
        load.planningComment = load.planningComment ? `${load.planningComment}; ${note}` : `${sourceLabel}; ${note}`;
      } catch (error) {
        console.error('Google Routes could not calculate imported load miles:', error);
        if (!mileageError) mileageError = error.message || 'Google Routes could not calculate the driving miles.';
        failed = true;
      } finally {
        done += 1;
        if (onProgress) onProgress(`Calculating driving miles ${Math.min(done, eligible.length)} of ${eligible.length}...`);
      }
    }));
    if (failed) {
      for (let remaining = start; remaining < eligible.length; remaining += 1) {
        const remainingLoad = eligible[remaining];
        if (remainingLoad.planningComment?.includes('driving miles calculated by Google Routes')) continue;
        const note = Number(remainingLoad.miles) > 0
          ? 'Google Routes unavailable; miles kept from the import'
          : 'driving miles need to be entered manually';
        remainingLoad.planningComment = remainingLoad.planningComment
          ? `${remainingLoad.planningComment}; ${note}`
          : `${sourceLabel}; ${note}`;
      }
      break;
    }
  }
  return { mileageError };
}

// ==========================================
// DAT RATECAST API AUTO-FETCH HELPER
// ==========================================
async function fetchDatRateForImport(order, selectedBroker, laneRates) {
  // 1. Check local saved rates first
  const savedLaneRate = getSavedLaneRate(laneRates, selectedBroker, order);
  if (savedLaneRate) {
    return { rateInput: savedLaneRate, rateSource: 'user-entered' };
  }

  // 2. Fetch live rate automatically via backend DAT Ratecast API
  try {
    const response = await fetch('/api/dat-rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { city: order.origCity, state: order.origSt, zip: order.origZip },
        destination: { city: order.destCity, state: order.destSt, zip: order.destZip },
        equipment: order.eCode
      })
    });
    
    const data = await response.json();
    if (data && data.rate) {
      return { rateInput: String(data.rate), rateSource: 'dat-api' };
    }
    return { rateInput: '', rateSource: undefined, error: data?.error || `DAT rate request failed (${response.status}).` };
  } catch (error) {
    console.error(`Could not auto-fetch DAT rate for order ${order.id}:`, error);
    return { rateInput: '', rateSource: undefined, error: error.message || 'Could not reach the DAT rate service.' };
  }
}

// Fetches DAT rates for every load missing one, a few at a time so big imports do
// not wait on one request after another. Fills rateInput/rateSource in place and
// remembers each rate in the lane list. Returns the first error, if any.
async function applyDatRatesForImport(loads, selectedBroker, laneRates, setLaneRates, shouldFetch = () => true) {
  let rateError = '';
  const targets = loads.filter(load => !(isCh593772Customer(selectedBroker) && load.rateSource === 'customer-bin')
    && !(Number(load.rateInput) > 0) && shouldFetch(load));
  for (let start = 0; start < targets.length; start += importLookupConcurrency) {
    const batch = targets.slice(start, start + importLookupConcurrency);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(batch.map(async load => {
      const datRateInfo = await fetchDatRateForImport(load, selectedBroker, laneRates);
      if (datRateInfo.rateInput) {
        load.rateInput = datRateInfo.rateInput;
        load.rateSource = datRateInfo.rateSource;
        setLaneRates(prev => rememberLaneRate(prev, selectedBroker, load, load.rateInput, load.rateSource));
      } else if (!rateError && datRateInfo.error) {
        rateError = datRateInfo.error;
      }
    }));
  }
  return rateError;
}

function getExportedRecordsForCustomer(registry, customer) {
  const customerKey = normalizeCustomerName(customer).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const matchingEntries = Object.entries(registry || {}).filter(([key]) =>
    normalizeCustomerName(key).toUpperCase().replace(/[^A-Z0-9]/g, '') === customerKey
  );
  return matchingEntries.reduce((records, [, value]) => ({
    ids: [...records.ids, ...(Array.isArray(value?.ids) ? value.ids : []).map(normalizeLoadId)],
    laneDays: [...records.laneDays, ...(Array.isArray(value?.laneDays) ? value.laneDays : [])]
  }), { ids: [], laneDays: [] });
}

// Earliest pickup first; loads without a readable pickup date go last.
function getPickupDay(order) {
  const value = getPickupSortValue(order);
  return value === Number.MAX_SAFE_INTEGER ? '' : new Date(value).toISOString().slice(0, 10);
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

function removeDuplicateLoadImports(loads) {
  const seenLoadSchedules = new Set();
  let duplicateCount = 0;
  const uniqueLoads = loads.filter(load => {
    const loadId = normalizeLoadId(load.sourceLoadId || load.id);
    const scheduleKey = createLaneScheduleKey(load);
    if (!loadId || !scheduleKey) return true;
    const key = JSON.stringify([loadId, scheduleKey]);
    if (seenLoadSchedules.has(key)) {
      duplicateCount += 1;
      return false;
    }
    seenLoadSchedules.add(key);
    return true;
  });
  return { loads: uniqueLoads, duplicateCount };
}

function countPreviouslyExportedLoads(loads, records, { idOnly = false } = {}) {
  const ids = new Set(records.ids || []);
  const laneDays = new Set(records.laneDays || []);
  let exportedCount = 0;
  const exportedLoadIds = new Set();
  loads.forEach(load => {
    const key = createLaneDayKey(load);
    const worked = (ids.has(normalizeLoadId(load.id)) && (!key || laneDays.has(key)))
      || (!idOnly && Boolean(key) && laneDays.has(key));
    if (worked) {
      exportedCount += 1;
      exportedLoadIds.add(normalizeLoadId(load.id));
    }
  });
  return { exportedCount, exportedLoadIds };
}

function keepPreviouslyExportedLoadsOpen(loads, exportedLoadIds, customer) {
  return loads.map(load => exportedLoadIds.has(normalizeLoadId(load.id))
    ? { ...load, status: 'OPEN', tag: 'OPEN' }
    : load);
}

function getReimportedLoadStatus(existingLoad, wasPreviouslyExported) {
  if (existingLoad?.status === 'OFFER') return { status: 'OFFER', tag: 'OFFER' };
  return { status: 'OPEN', tag: 'OPEN' };
}

function deduplicateDatImports(importedLoads, existingLoads) {
  const existingByLaneDay = new Map(existingLoads.map(load => [createLaneDayKey(load), load]).filter(([key]) => key));
  const seenLaneDays = new Set();
  const unreadableRows = [];
  let skippedDuplicateCount = 0;
  const loads = importedLoads.flatMap((load, index) => {
    const key = createLaneDayKey(load);
    if (!key) {
      unreadableRows.push(`Row ${index + 1}: ${load.route || `${load.origCity || '?'} → ${load.destCity || '?'}`} (pickup: ${load.pickupTime || load.puDate || 'unreadable'})`);
      return [];
    }
    if (seenLaneDays.has(key)) {
      skippedDuplicateCount += 1;
      return [];
    }
    seenLaneDays.add(key);
    const existing = existingByLaneDay.get(key);
    if (existing) {
      return [{ ...load, id: existing.id, sourceLoadId: existing.sourceLoadId || existing.id }];
    }
    return [load];
  });
  if (unreadableRows.length === importedLoads.length && unreadableRows.length) {
    throw new Error(`No DAT rows had a readable lane and pickup date. Existing loads were not changed.\n${unreadableRows.join('\n')}`);
  }
  return { loads, skippedDuplicateCount, unreadableRows };
}

function getImportReplacementMessage(replacement) {
  const scopeLabel = replacement?.equipmentScope ? [...replacement.equipmentScope].join('/') : '';
  return replacement
    ? `• ${replacement.additive ? 'Imported list merged' : scopeLabel ? `${scopeLabel} list replaced` : 'Full list replaced'}; removed loads: ${replacement.removedCount}. ${replacement.additive ? 'Exported ENT loads retained for 30 days unless re-imported.' : scopeLabel ? `Loads missing from the file were deleted from the ${scopeLabel} list(s) only; other equipment, booked and hand-added loads kept.` : 'Loads not on the list were deleted (booked and hand-added loads kept).'}\n` +
      `• Duplicate load/day rows skipped: ${replacement.duplicateCount}; ${replacement.usesScreenshotStatus ? 'Para screenshot: red = ON HOLD, non-red = OPEN' : 'imported loads set to OPEN'}.\n`
      + (replacement.laneDayDuplicateCount ? `• Same-lane/pickup-day duplicates skipped: ${replacement.laneDayDuplicateCount} (first load kept).\n` : '')
      + (replacement.skippedRxoVanCount ? `• Skipped ${replacement.skippedRxoVanCount} RXO van load(s) picking up in WI, IN, OH, MI, MN, SD, ND, UT or ID.\n` : '')
      + (replacement.skippedMexicoCount ? `• Skipped ${replacement.skippedMexicoCount} load(s) to or from Mexico.\n` : '')
      + (replacement.skippedEquipmentCount ? `• Skipped ${replacement.skippedEquipmentCount} intermodal (INT) or oversized load(s).\n` : '')
      + (replacement.coveredCount ? `• Covered (posted, not on the new list): ${replacement.coveredCount} moved to ENT${replacement.droppedPostings?.length ? `; the upload bot removes ${replacement.droppedPostings.length} from Landstar` : ''}.\n` : '')
    : '';
}

function normalizeScheduleValue(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return '';

  const usDate = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  const isoDate = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  const date = usDate
    ? `${usDate[3].length === 2 ? `20${usDate[3]}` : usDate[3]}-${usDate[1].padStart(2, '0')}-${usDate[2].padStart(2, '0')}`
    : isoDate
      ? `${isoDate[1]}-${isoDate[2].padStart(2, '0')}-${isoDate[3].padStart(2, '0')}`
      : '';
  const timeText = text
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' ')
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, ' ');
  const times = Array.from(timeText.matchAll(/\b(\d{1,2}):?(\d{2})\s*(AM|PM)?\b/g))
    .map(([, hourText, minuteText, meridiem]) => {
      let hour = Number(hourText);
      const minute = Number(minuteText);
      if (meridiem) hour = hour % 12 + (meridiem === 'PM' ? 12 : 0);
      return hour <= 23 && minute <= 59
        ? `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`
        : '';
    })
    .filter(Boolean);

  return JSON.stringify([date, times.length ? times : timeText.replace(/\s+/g, ' ').trim()]);
}

function createLaneScheduleKey(order) {
  const laneDayKey = createLaneDayKey(order);
  if (!laneDayKey) return '';
  return JSON.stringify([
    laneDayKey,
    normalizeScheduleValue(order.pickupTime || order.puDate),
    normalizeScheduleValue(order.deliveryTime || order.delDate)
  ]);
}

function markDifferentScheduleLoadsEnt(loads, existingLoads = [], customer) {
  return loads.map(load => ({ ...load, status: 'OPEN', tag: 'OPEN' }));
}

// Past-dated pickups import as ENT, new loads and re-imported ones alike
// (booked loads stay booked: replaceImportedCustomerLoads checks that last).
function applyPastPickupEntStatus(importedLoad, existingLoads) {
  if (!hasPastPickupDate(importedLoad)) return importedLoad;
  return { ...importedLoad, status: 'ENT', tag: 'ENT' };
}

// Landstar export columns that depend on the account. AMERI 18347- ATZ loads are brokerable
// with no Carrier Amt (the Rate column keeps the rate). Landstar validated but refused to post
// Brokerable Y + Carrier Amt 0 ("postingErrors":1, five uploads, 2026-11-25); Brokerable N + 0
// posted. Testing Brokerable Y with the Carrier Amt cell left blank instead of 0.
const AMERI_BROKERABLE = 'Y';

function getLandstarBrokerable(customer, ord) {
  if (isAmeriCustomer(customer)) return AMERI_BROKERABLE;
  return ['true', 'y'].includes(String(ord?.brokerable || '').trim().toLowerCase()) ? 'Y' : 'N';
}

// undefined leaves the spreadsheet cell empty (not 0).
function getLandstarCarrierAmount(customer, rate) {
  return isAmeriCustomer(customer) ? undefined : rate;
}

// Brokerable with no Carrier Amt posts only with Carrier Load Alerts off (Daniel, Landstar's
// Edit Posting form, 2026-11-25); a blank cell left a validation error, so AMERI sends N.
function getLandstarCarrierLoadAlerts(customer) {
  return isAmeriCustomer(customer) ? 'N' : '';
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

// ==========================================
// DAT LOAD BOARD POSTING
// ==========================================
// The local TMS server posts to DAT and reposts every load every 5 minutes (new posting,
// then the old one deleted, so its age starts over)
// (api/_lib/datPosting.js). Pickup times on the list are the shipper's local time; the
// state picks the time zone (most of a state's area; Eastern when not listed).
const datStateTimezones = {
  AL: 'America/Chicago', AR: 'America/Chicago', IA: 'America/Chicago', IL: 'America/Chicago', KS: 'America/Chicago',
  LA: 'America/Chicago', MN: 'America/Chicago', MO: 'America/Chicago', MS: 'America/Chicago', ND: 'America/Chicago',
  NE: 'America/Chicago', OK: 'America/Chicago', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  WI: 'America/Chicago', MB: 'America/Winnipeg',
  CO: 'America/Denver', MT: 'America/Denver', NM: 'America/Denver', UT: 'America/Denver', WY: 'America/Denver',
  ID: 'America/Boise', AB: 'America/Edmonton', AZ: 'America/Phoenix',
  CA: 'America/Los_Angeles', NV: 'America/Los_Angeles', OR: 'America/Los_Angeles', WA: 'America/Los_Angeles',
  BC: 'America/Vancouver'
};

// Excel serial date (wall-clock time) in an IANA time zone -> ISO instant.
function excelSerialToZonedIso(serial, timeZone) {
  const wall = Math.round(serial * 86400000) + Date.UTC(1899, 11, 30);
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date(wall)).map(part => [part.type, part.value]));
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
    return new Date(wall - (shown - wall)).toISOString();
  } catch {
    return new Date(wall).toISOString();
  }
}

// TMS equipment -> DAT equipment type and trailer length. Straight trucks and other
// equipment DAT has no plain type for are not posted.
function getDatEquipment(eCode) {
  const raw = String(eCode || '').trim().toUpperCase().replace(/\s/g, '');
  if (raw === 'VR' || raw === 'V,R') return { equipmentType: 'VR', lengthFeet: 53 };
  const code = getLandstarEquipmentCode(eCode);
  const length = Number(code.match(/^(\d{2})/)?.[1]) || 0;
  if (['VAN', '24VN', '28VN', '48VN', '53VN'].includes(code)) return { equipmentType: 'V', lengthFeet: length || 53 };
  if (code === 'REFR') return { equipmentType: 'R', lengthFeet: 53 };
  if (['FLAT', '48FL', '53FL', 'FH', 'FLCS'].includes(code)) return { equipmentType: 'F', lengthFeet: length || 48 };
  if (['STEP', '53SD', 'SD'].includes(code)) return { equipmentType: 'SD', lengthFeet: length || 48 };
  return null;
}

// Builds what the local server sends to DAT for one load: { posting } or { error }.
// The posted rate is the load's rate (like the Landstar Carrier Amt); AMERI 18347- ATZ
// posts with no rate, the same as its $0 Carrier Amt.
function buildDatPosting(customer, ord) {
  const equipment = getDatEquipment(ord.eCode);
  if (!equipment) return { error: `DAT posting needs van, reefer, flatbed or step deck equipment (this load is "${ord.eCode || 'blank'}")` };
  const puParts = splitScheduleRange(ord.pickupTime);
  const from = toExcelDateTime(puParts[0]);
  const thru = toExcelDateTime(puParts[1] || puParts[0], puParts[0]);
  if (from === null || thru === null) return { error: 'pickup date/time' };
  const timeZone = datStateTimezones[String(ord.origSt || '').trim().toUpperCase()] || 'America/New_York';
  const quotedRate = Number(String(ord.rateInput || '').replace(/[$,]/g, ''));
  const rate = quotedRate - getRxoAtzDatVanDiscount(customer, ord, quotedRate);
  const comments = [isHazmatLoad(ord) && 'HAZMAT', isTeamLoad(ord) && 'TEAM REQUIRED'].filter(Boolean);
  return { posting: {
    customer: String(customer || ''),
    referenceId: String(ord.id || ''),
    origin: { city: ord.origCity, state: ord.origSt, zip: ord.origZip },
    destination: { city: ord.destCity, state: ord.destSt, zip: ord.destZip },
    ...equipment,
    weightPounds: parseWeightPounds(ord.weight) || 0,
    earliestAvailabilityWhen: excelSerialToZonedIso(from, timeZone),
    latestAvailabilityWhen: excelSerialToZonedIso(Math.max(thru, from), timeZone),
    rateUsd: isAmeriCustomer(customer) || !(rate > 0) ? 0 : Math.round(rate),
    comments: comments.length ? [comments.join(' - ')] : []
  } };
}

// ==========================================
// MULTI-TAB / MULTI-DEVICE WRITE GUARD
// ==========================================
// Every saved write carries a per-key version number. A tab may only write a key when
// its state is based on the latest saved version; otherwise an older tab's save would
// wipe newer data (e.g. freshly imported loads) saved from another tab or device.
const dataVersionKey = 'landstar_dataVersion';
const syncedDataKeys = [
  'landstar_brokers',
  'landstar_customerOrdersMap',
  'landstar_laneRates',
  'landstar_rateHistory',
  'landstar_exportedLoads',
  'landstar_profile'
];
let syncGuardReady = false;
const lastSavedValues = {};
const lastSavedVersions = {};
let reloadSavedDataFn = null;
let loadListHealTimer = null;

function readDataVersions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(dataVersionKey));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function initSyncGuardFromStorage() {
  if (syncGuardReady) return;
  syncGuardReady = true;
  const versions = readDataVersions();
  syncedDataKeys.forEach(key => {
    try {
      lastSavedValues[key] = localStorage.getItem(key);
    } catch (error) {
      lastSavedValues[key] = null;
    }
    lastSavedVersions[key] = versions[key] || 0;
  });
}

function getLastSavedValue(key) {
  return key in lastSavedValues ? lastSavedValues[key] : undefined;
}

// Writes one synced key and bumps its version. Returns false without writing when
// storage already holds a newer version from another tab/device; the caller should
// adopt that newer data instead of overwriting it.
function writeSyncedKey(key, value) {
  initSyncGuardFromStorage();
  const versions = readDataVersions();
  if ((versions[key] || 0) > (lastSavedVersions[key] || 0)) return false;
  localStorage.setItem(key, value);
  const nextVersions = { ...versions, [key]: (versions[key] || 0) + 1 };
  localStorage.setItem(dataVersionKey, JSON.stringify(nextVersions));
  lastSavedValues[key] = value;
  lastSavedVersions[key] = nextVersions[key];
  return true;
}

// Records values this tab loaded from storage so later change detection only reacts
// to writes made elsewhere. Keys whose content is unchanged simply track the latest
// version so unrelated version bumps do not mark them as externally changed.
function markStorageAdopted(values) {
  const versions = readDataVersions();
  syncedDataKeys.forEach(key => {
    if (key in values) {
      lastSavedValues[key] = values[key];
      lastSavedVersions[key] = versions[key] || 0;
    } else {
      try {
        if (localStorage.getItem(key) === lastSavedValues[key]) lastSavedVersions[key] = versions[key] || 0;
      } catch (error) {
        // Keep the previous stamp when storage cannot be read.
      }
    }
  });
}

// Synced keys whose stored string differs from what this tab last saved or adopted.
function getChangedSyncedKeys(values) {
  initSyncGuardFromStorage();
  return Object.entries(values)
    .filter(([key, value]) => lastSavedValues[key] !== value)
    .map(([key]) => key);
}

// True when a key changed without its version advancing, i.e. it was written by an
// outdated app version or a stale tab that does not version its writes.
function isUnversionedExternalChange(key) {
  initSyncGuardFromStorage();
  if (!(key in lastSavedValues)) return false;
  let current;
  try {
    current = localStorage.getItem(key);
  } catch (error) {
    return false;
  }
  if (current === lastSavedValues[key]) return false;
  const versions = readDataVersions();
  return (versions[key] || 0) <= (lastSavedVersions[key] || 0);
}

// Restores the last known-good value over an unversioned external write. The write
// goes through the normal path so it also syncs back to the cloud and other tabs.
function restoreLastSavedKey(key) {
  const value = getLastSavedValue(key);
  if (value === undefined || value === null) return false;
  if (!isUnversionedExternalChange(key)) return false;
  return writeSyncedKey(key, value);
}

// Splits changed synced keys into ones to adopt and a load-list change to treat as a
// regression. Only same-browser writes (the storage event) can be regressions: data
// that arrived from the cloud was saved by one of the user's own signed-in browsers,
// and its version row can be held back or arrive separately, so reverting it would
// push this browser's older list back over a fresh import on the other device.
function classifyChangedSyncedKeys(changedKeys, versions, fromCloud) {
  const adopt = [];
  let heal = false;
  changedKeys.forEach(key => {
    const versioned = (versions[key] || 0) > (lastSavedVersions[key] || 0);
    if (key === 'landstar_customerOrdersMap' && !versioned && !fromCloud) heal = true;
    else adopt.push(key);
  });
  return { adopt, heal };
}

// Gives a version bump a short window to arrive before treating a load-list change as
// a regression from an outdated app version; realtime echoes of the data and its
// version can arrive in either order.
function scheduleUnversionedLoadListHeal() {
  if (loadListHealTimer !== null || typeof setTimeout === 'undefined') return;
  loadListHealTimer = setTimeout(() => {
    loadListHealTimer = null;
    if (restoreLastSavedKey('landstar_customerOrdersMap')) {
      console.warn('Ignored a load-list change from an outdated app version or stale tab; kept the newer load list.');
    }
  }, 2500);
}

// Persist a rate for a lane so the next load in the same lane reuses it.
// Only rates you type are saved for reuse: DAT rates go to the rate history but never
// into laneRates, so a saved lane rate always means your own rate and beats DAT.
// Returns the updated laneRates map (or the original if the rate/key is invalid).
function rememberLaneRate(laneRates, customer, order, rate, source = 'manual') {
  const numericRate = Number(String(rate || '').replace(/[$,]/g, ''));
  const key = createLaneRateKey(customer, order);
  if (!key || !(numericRate > 0) || !Number.isFinite(numericRate)) return laneRates;
  recordRateHistory(customer, order, numericRate, source);
  if (isDatRateSource(source)) return laneRates;
  if (laneRates[key] === String(numericRate)) return laneRates;
  const next = { ...laneRates, [key]: String(numericRate) };
  try {
    writeSyncedKey('landstar_laneRates', JSON.stringify(next));
  } catch (error) {
    console.error('Could not save lane rate:', error);
  }
  return next;
}

// ==========================================
// HISTORICAL RATE LOOKUP
// ==========================================
// Every saved lane rate is also kept in a per-user history so the app can suggest
// past rates for an identical lane as soon as origin and destination are known.
// One row per distinct rate per lane; reusing a rate refreshes its timestamp.
const rateHistoryKey = 'landstar_rateHistory';
const rateHistoryLimit = 1000;

function readRateHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(rateHistoryKey));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Could not load rate history:', error);
    return [];
  }
}

// Lane match ignoring customer and equipment, e.g. CITYOFINDUSTRY, CA -> CALEXICO, CA.
function createLaneLookupKey(order) {
  const normalize = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const origin = normalize(order.origCity);
  const destination = normalize(order.destCity);
  if (!origin || !destination) return '';
  return JSON.stringify([origin, normalize(order.origSt), destination, normalize(order.destSt)]);
}

// Adds (or refreshes) one rate per item in a history list; pure, no saving.
function addRateHistoryEntries(history, customer, items, source, now = new Date().toISOString()) {
  let next = history.slice();
  items.forEach(({ order, rate }) => {
    const numericRate = Number(String(rate || '').replace(/[$,]/g, ''));
    const key = createLaneRateKey(customer, order);
    const lane = createLaneLookupKey(order);
    if (!key || !lane || !(numericRate > 0) || !Number.isFinite(numericRate)) return;
    const existingIndex = next.findIndex(entry => entry && entry.key === key && entry.rate === String(numericRate));
    if (existingIndex >= 0) {
      next[existingIndex] = { ...next[existingIndex], source, savedAt: now };
    } else {
      next.push({
        key,
        lane,
        customer: normalizeCustomerName(customer),
        origCity: String(order.origCity || '').trim().toUpperCase(),
        origSt: String(order.origSt || '').trim().toUpperCase(),
        destCity: String(order.destCity || '').trim().toUpperCase(),
        destSt: String(order.destSt || '').trim().toUpperCase(),
        eCode: String(order.eCode || '').trim().toUpperCase(),
        rate: String(numericRate),
        source,
        savedAt: now
      });
    }
  });
  if (next.length > rateHistoryLimit) {
    next = next.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt))).slice(0, rateHistoryLimit);
  }
  return next;
}

function saveRateHistory(next) {
  try {
    writeSyncedKey(rateHistoryKey, JSON.stringify(next));
  } catch (error) {
    console.error('Could not save rate history:', error);
  }
  return next;
}

function recordRateHistory(customer, order, rate, source = 'manual') {
  const history = readRateHistory();
  const next = addRateHistoryEntries(history, customer, [{ order, rate }], source);
  return next.length === history.length && next.every((entry, i) => entry === history[i]) ? history : saveRateHistory(next);
}

// Every load exported to Landstar becomes a past rate for its lane, so the rate
// outlives the ENT load (ENT loads are removed 30 days after export).
function recordExportedRates(customer, exportedLoads) {
  const items = exportedLoads.map(order => ({ order, rate: order.rateInput }));
  return saveRateHistory(addRateHistoryEntries(readRateHistory(), customer, items, 'exported'));
}

// One-time seed: lanes that already have a saved rate predate the history log.
// They appear as undated "saved" suggestions until a fresh rate is recorded.
function seedRateHistoryFromLaneRates(laneRates) {
  const seeded = [];
  Object.entries(laneRates || {}).forEach(([key, rate]) => {
    let parts;
    try {
      parts = JSON.parse(key);
    } catch (error) {
      return;
    }
    const numericRate = Number(String(rate || '').replace(/[$,]/g, ''));
    if (!Array.isArray(parts) || parts.length !== 8 || !(numericRate > 0)) return;
    const entry = {
      key,
      customer: parts[0],
      origCity: parts[1],
      origSt: parts[2],
      destCity: parts[4],
      destSt: parts[5],
      eCode: parts[7],
      rate: String(numericRate),
      source: 'saved',
      savedAt: ''
    };
    entry.lane = createLaneLookupKey(entry);
    if (entry.lane) seeded.push(entry);
  });
  return seeded;
}

// Past rates for the order's lane: exact customer/equipment matches first, then
// the same city pair under other customers or equipment. Newest first.
function getLaneRateHistory(history, customer, order) {
  const key = createLaneRateKey(customer, order);
  const lane = createLaneLookupKey(order);
  if (!lane) return [];
  const newestFirst = (a, b) => String(b.savedAt).localeCompare(String(a.savedAt));
  const exact = [];
  const similar = [];
  history.forEach(entry => {
    if (!entry) return;
    const entryLane = entry.lane || createLaneLookupKey(entry);
    if (entryLane !== lane) return;
    (key && entry.key === key ? exact : similar).push(entry);
  });
  return [...exact.sort(newestFirst), ...similar.sort(newestFirst)];
}

// Moves a customer to where another one sits (drag-and-drop in the customer list).
function moveCustomer(list, name, targetName) {
  const from = list.indexOf(name);
  const to = list.indexOf(targetName);
  if (from < 0 || to < 0 || from === to) return list;
  const next = list.filter(item => item !== name);
  next.splice(to, 0, name);
  return next;
}

const customerDragType = 'text/x-tms-customer';
const accountTabDragType = 'text/x-tms-account-tab';

// Sort choices for the load list ('' = pickup date, earliest first).
const LANE_SORT_CHOICES = [
  ['', 'Pickup date, earliest first'], ['pickup-desc', 'Pickup date, latest first'],
  ['origin-asc', 'Pickup city A–Z'], ['origin-desc', 'Pickup city Z–A'],
  ['destination-asc', 'Delivery city A–Z'], ['destination-desc', 'Delivery city Z–A'],
  ['origin-state-asc', 'Pickup state A–Z'], ['origin-state-desc', 'Pickup state Z–A'],
  ['destination-state-asc', 'Delivery state A–Z'], ['destination-state-desc', 'Delivery state Z–A']
];

// Today (0), tomorrow (1)... as YYYY-MM-DD in local time.
function pickupDayFromToday(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizeBrokerList(value) {
  const brokerList = Array.isArray(value) ? value : ['Para 1522166 - ATZ', rxoCustomerName];
  const normalizedBrokers = Array.from(new Set(brokerList.map(normalizeCustomerName).filter(Boolean)));
  if (normalizedBrokers.some(isRxoCustomer)) {
    [rxoCustomerName, rxoPayerCustomerName].forEach(name => {
      if (!normalizedBrokers.includes(name)) normalizedBrokers.push(name);
    });
  }
  if (!normalizedBrokers.includes(ntgCustomerName)) normalizedBrokers.push(ntgCustomerName);
  return normalizedBrokers;
}

// Every customer that still has loads stays in the customer list. Deleting a customer
// deletes its loads too, so this only brings back names a stale or broken save dropped
// (11/23: another browser saved a 4-name list and 8 customers vanished from the sidebar).
function addCustomersWithLoads(brokerList, ordersMap) {
  const missing = Object.entries(ordersMap || {})
    .filter(([name, loads]) => Array.isArray(loads) && loads.length && !brokerList.includes(name))
    .map(([name]) => name);
  return missing.length ? [...brokerList, ...missing] : brokerList;
}

function normalizeCustomerOrders(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : defaultCustomerDatasets;
  const normalized = {};
  Object.entries(source).forEach(([name, loads]) => {
    const normalizedName = normalizeCustomerName(name);
    if (!Array.isArray(loads)) return;
    const merged = new Map((normalized[normalizedName] || []).map(load => [load.id, load]));
    loads.forEach(load => {
      if (!load || load.id == null) return;
      // Visibility group and the default posting code come from each user's My Settings
      // at export time, so shared loads never carry one teammate's codes to another.
      const { visibilityGroup, ...rest } = load;
      const normalizedLoad = { brokerable: 'false', ...rest };
      const postingCode = String(normalizedLoad.postingCode || '').trim().toUpperCase();
      if (!postingCode || postingCode === 'ANQ') delete normalizedLoad.postingCode;
      merged.set(load.id, normalizedLoad);
    });
    normalized[normalizedName] = Array.from(merged.values());
  });
  return normalized;
}

const horizontalFlag = (...colors) => `linear-gradient(to bottom, ${colors.map((color, index) => `${color} ${(index * 100) / colors.length}% ${((index + 1) * 100) / colors.length}%`).join(', ')})`;
const verticalFlag = (...colors) => horizontalFlag(...colors).replace('to bottom', 'to right');

// Simplified flags (no emblems) drawn with CSS, since Windows does not show emoji flags.
const countryFlags = {
  CO: { name: 'Colombia', background: 'linear-gradient(to bottom, #fcd116 0% 50%, #003893 50% 75%, #ce1126 75% 100%)' },
  US: { name: 'United States', background: 'linear-gradient(#3c3b6e, #3c3b6e) 0 0 / 40% 54% no-repeat, repeating-linear-gradient(to bottom, #b22234 0 7.69%, #fff 7.69% 15.38%)' },
  MX: { name: 'Mexico', background: verticalFlag('#006847', '#fff', '#ce1126') },
  VE: { name: 'Venezuela', background: horizontalFlag('#ffcc00', '#00247d', '#cf142b') },
  EC: { name: 'Ecuador', background: 'linear-gradient(to bottom, #ffdd00 0% 50%, #034ea2 50% 75%, #ed1c24 75% 100%)' },
  PE: { name: 'Peru', background: verticalFlag('#d91023', '#fff', '#d91023') },
  AR: { name: 'Argentina', background: horizontalFlag('#74acdf', '#fff', '#74acdf') },
  GT: { name: 'Guatemala', background: verticalFlag('#4997d0', '#fff', '#4997d0') },
  HN: { name: 'Honduras', background: horizontalFlag('#0073cf', '#fff', '#0073cf') },
  SV: { name: 'El Salvador', background: horizontalFlag('#0047ab', '#fff', '#0047ab') },
  NI: { name: 'Nicaragua', background: horizontalFlag('#0067c6', '#fff', '#0067c6') },
  CU: { name: 'Cuba', background: 'linear-gradient(to bottom right, #cf142b 0 25%, transparent 25%) 0 0 / 80% 100% no-repeat, repeating-linear-gradient(to bottom, #002a8f 0 20%, #fff 20% 40%)' },
  HT: { name: 'Haiti', background: horizontalFlag('#00209f', '#d21034') },
  PR: { name: 'Puerto Rico', background: 'linear-gradient(to bottom right, #0050f0 0 25%, transparent 25%) 0 0 / 80% 100% no-repeat, repeating-linear-gradient(to bottom, #ed0000 0 20%, #fff 20% 40%)' },
  UA: { name: 'Ukraine', background: horizontalFlag('#0057b7', '#ffd700') },
  PL: { name: 'Poland', background: horizontalFlag('#fff', '#dc143c') },
  RU: { name: 'Russia', background: horizontalFlag('#fff', '#0039a6', '#d52b1e') },
  IN: { name: 'India', background: horizontalFlag('#ff9933', '#fff', '#138808') },
  NG: { name: 'Nigeria', background: verticalFlag('#008751', '#fff', '#008751') },
  IT: { name: 'Italy', background: verticalFlag('#009246', '#fff', '#ce2b37') },
  FR: { name: 'France', background: verticalFlag('#0055a4', '#fff', '#ef4135') },
  DE: { name: 'Germany', background: horizontalFlag('#000', '#dd0000', '#ffce00') },
  // Green 2/5, red 3/5, with a gold dot for the armillary sphere on the line between them.
  PT: { name: 'Portugal', background: 'radial-gradient(circle at 40% 50%, #ffe000 0 18%, transparent 19%), linear-gradient(to right, #006600 0 40%, #ff0000 40% 100%)' }
};

const isValidPostingCode = value => {
  const code = String(value || '').trim();
  return code.length > 0 && code.length <= 10;
};
const emptyProfile = { phone: '', postingCode: '', visibilityGroup: '', flag: 'CO', teamLogo: '', fuelSurcharge: { ...defaultFuelSurchargeRates } };

function getUserProfile() {
  if (typeof localStorage === 'undefined') return { ...emptyProfile };
  try {
    const saved = JSON.parse(localStorage.getItem('landstar_profile'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...emptyProfile };
    return {
      phone: String(saved.phone || ''),
      postingCode: String(saved.postingCode || ''),
      visibilityGroup: String(saved.visibilityGroup || ''),
      flag: saved.flag === 'NONE' || countryFlags[saved.flag] ? saved.flag : 'CO',
      teamLogo: normalizeTeamLogo(saved.teamLogo),
      fuelSurcharge: normalizeFuelSurchargeRates(saved.fuelSurcharge),
      // ⚙ Customer rules and the Google Chat list-name answers are kept too (both were lost on
      // every reload before, 2026-11-27).
      customerRules: saved.customerRules && typeof saved.customerRules === 'object' && !Array.isArray(saved.customerRules) ? saved.customerRules : {},
      chatSheetAccounts: saved.chatSheetAccounts && typeof saved.chatSheetAccounts === 'object' && !Array.isArray(saved.chatSheetAccounts) ? saved.chatSheetAccounts : {},
      truckBook: saved.truckBook && typeof saved.truckBook === 'object' && !Array.isArray(saved.truckBook) ? saved.truckBook : {},
      carrierBook: saved.carrierBook && typeof saved.carrierBook === 'object' && !Array.isArray(saved.carrierBook) ? saved.carrierBook : {}
    };
  } catch (error) {
    console.error('Could not load My Settings:', error);
    return { ...emptyProfile };
  }
}

const defaultCustomerDatasets = {
  'Para 1522166 - ATZ': [
    { id: '2274611', visibilityGroup: 'ANQ', eCode: 'VZ', status: 'ENT', tag: 'ENT', route: 'NORFOLK, VA → CHARLOTTE, NC', puDate: 'PU: 10/15 0500', delDate: 'DFL: 10/16 0900', pickupTime: '10/15/2026 0500 - 1500', origCity: 'NORFOLK', origSt: 'VA', origZip: '23502', weight: '42,852 lbs', deliveryTime: '10/16/2026 0000 - 1500', destCity: 'CHARLOTTE', destSt: 'NC', destZip: '29217', miles: '327', planningComment: 'Standard Dry Van Load', carrier: '', driver: '', truck: '', trailer: '', rateInput: '', brokerable: 'false', notes: '' }
  ],
  [rxoCustomerName]: [
    { id: '24424438', visibilityGroup: 'RXO', eCode: 'VAN:VAN', status: 'OPEN', tag: 'OPEN', route: 'BOLINGBROOK, IL → SCOTTSVILLE, KY', puDate: 'PU: Today', delDate: 'DFL: Upcoming', pickupTime: '10/18/2026 0800 - 1200', origCity: 'BOLINGBROOK', origSt: 'IL', origZip: '60440', weight: '20000 lbs', deliveryTime: '10/20/2026 0800 - 1700', destCity: 'SCOTTSVILLE', destSt: 'KY', destZip: '42164', miles: '431', planningComment: 'Imported from Excel', carrier: '', driver: '', truck: '', trailer: '', rateInput: '', brokerable: 'false', notes: '' }
  ]
};

function getPastedImage(event) {
  if (event.target?.isContentEditable || event.target?.closest?.('input, textarea, select')) return null;
  const item = Array.from(event.clipboardData?.items || [])
    .find(item => item.type.startsWith('image/'));
  return item?.getAsFile() || null;
}

async function readClipboardImage(clipboard) {
  if (typeof clipboard?.read !== 'function') {
    throw new Error('Clipboard access is unavailable. Click the app background and press Ctrl+V, or use Import NTG Loads to choose a saved screenshot.');
  }
  const items = await clipboard.read();
  for (const item of items) {
    const type = item.types.find(type => type === 'image/png') || item.types.find(type => type.startsWith('image/'));
    if (type) return item.getType(type);
  }
  throw new Error('No screenshot is on the clipboard. Take a snip with Win+Shift+S, then return here and paste it.');
}

// Records a check call (and the stage it reports) on the load; keeps the last 20.
function logCheckCall(load, { stage, note = '' }, at = new Date().toISOString()) {
  const nextStage = trackingStages.includes(stage) ? stage : (load.trackingStage || 'Booked');
  const calls = Array.isArray(load.checkCalls) ? load.checkCalls : [];
  return {
    ...load,
    trackingStage: nextStage,
    checkCalls: [...calls, { at, stage: nextStage, note: String(note).trim() }].slice(-20)
  };
}

// ---------- Driver texts through Google Voice (free; Daniel presses send) ----------
// A US phone number as +1XXXXXXXXXX, or '' if it isn't one.
function toUsPhoneE164(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

// Opens (or starts) the text conversation with that number in Google Voice on the web.
function getGoogleVoiceUrl(phone) {
  const number = toUsPhoneE164(phone);
  return number ? `https://voice.google.com/u/0/messages?itemId=t.${encodeURIComponent(number)}` : 'https://voice.google.com/u/0/messages';
}

// Text button: copy the message, open the Google Voice conversation; Daniel pastes and sends.
async function openDriverText(event, load, customer) {
  const button = event?.currentTarget;
  const text = buildDriverText(load, customer);
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch { /* shown below */ }
  window.open(getGoogleVoiceUrl(load.driverPhone), 'google-voice');
  if (!copied) { window.prompt('Copy this text, then paste it in Google Voice:', text); return; }
  if (button) {
    const label = button.textContent;
    button.textContent = '✅ Copied: paste in Google Voice (Ctrl+V, Enter)';
    setTimeout(() => { button.textContent = label; }, 6000);
  }
}

// Delivered, the paperwork is in, and it went to the customer (or didn't need to): the load
// leaves the main Booked Loads list. Older loads marked by hand count as done.
const isBookedLoadComplete = load => load.trackingStage === 'Delivered' && Boolean(load.paperworkReceivedAt)
  && load.paperworkDone !== false;

// The paperwork line on a delivered load's card.
function getPaperworkStatus(load, now = Date.now()) {
  if (load.paperworkReceivedAt) {
    return { level: 'ok', text: `Paperwork received ${formatCheckTime(load.paperworkReceivedAt)}${load.paperworkSentAt ? ' · sent to the customer' : load.paperworkDone ? '' : ' · waiting for you to send it to the customer'}` };
  }
  const deliveredAt = getDeliveredAt(load);
  if (!deliveredAt) return { level: 'waiting', text: 'Waiting on paperwork from the driver' };
  const hours = Math.floor((now - deliveredAt) / 3600000);
  const left = PAPERWORK_DUE_HOURS - hours;
  return left > 0
    ? { level: hours >= 24 ? 'due' : 'waiting', text: `Waiting on paperwork · delivered ${hours}h ago · due in ${left}h` }
    : { level: 'late', text: `Paperwork LATE · delivered ${hours}h ago (due within ${PAPERWORK_DUE_HOURS}h, customer can charge back)` };
}

function BookedLoadsPage({ entries: allEntries, now, onBack, onOpen, onUpdate, onRemoveCapacity, emails = null, searchQuery = '', onSearch = null }) {
  const query = String(searchQuery || '').trim();
  const isMatch = load => Boolean(query) && loadMatchesSearch(load, query);
  const completed = allEntries.filter(({ load }) => isBookedLoadComplete(load));
  const completedMatches = completed.filter(({ load }) => isMatch(load));
  // Search matches go to the top, so the load you are looking for is the first card.
  const entries = allEntries.filter(({ load }) => !isBookedLoadComplete(load))
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => Number(isMatch(b.entry.load)) - Number(isMatch(a.entry.load)) || a.index - b.index)
    .map(({ entry }) => entry);
  const matchCount = entries.filter(({ load }) => isMatch(load)).length + completedMatches.length;
  const activeCount = entries.filter(({ load }) => load.trackingStage !== 'Delivered').length;
  const alertCount = entries.filter(({ load }) => getTrackingAlert(load, now)).length;
  const phoneDigits = value => String(value || '').replace(/[^\d+]/g, '');
  // Phone: this page sits under the load list, so jump down to it once when it opens.
  const jumpToPageOnPhone = node => {
    if (!node || node.dataset.jumped || !isPhoneScreen()) return;
    node.dataset.jumped = 'true';
    node.scrollIntoView?.({ block: 'start' });
  };
  return (
    <div ref={jumpToPageOnPhone} className="flex flex-col gap-4" aria-label="Booked Loads">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#161f36] px-3 sm:px-4 py-3 rounded-lg border border-purple-500/60">
        <div>
          <h2 className="text-lg font-bold text-purple-200">📦 Booked Loads</h2>
          <p className="text-xs text-gray-300">
            {activeCount} active · {entries.length - activeCount} delivered · {alertCount} need attention · {completed.length} completed · all customers · earliest pickup first
          </p>
        </div>
        {onSearch && (
          <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
            <input
              type="text"
              value={searchQuery}
              onChange={event => onSearch(event.target.value)}
              placeholder="🔍 Find a booked load: load #, city, driver, truck..."
              aria-label="Find a booked load"
              className="w-full bg-[#0b132b] border-2 border-yellow-400/70 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-400 outline-none focus:border-yellow-300"
            />
            {query && (
              <button type="button" onClick={() => onSearch('')} title="Clear the search" className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2 py-1.5 rounded cursor-pointer">✕</button>
            )}
          </div>
        )}
        <button type="button" onClick={onBack} className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-3 py-1.5 rounded font-semibold cursor-pointer">
          ← Back to loads
        </button>
      </div>
      {emails && emails.replies.some(reply => !reply.loadId) && (
        <div className="rounded-lg border border-sky-500 p-3 bg-[#121829]">
          <p className="text-sm font-bold text-sky-200">💬 Driver replies on loads not booked in the TMS</p>
          {emails.replies.filter(reply => !reply.loadId).map(reply => (
            <p key={`fb-${reply.id}`} className="text-xs text-gray-300 mt-1">Freight bill {reply.freightBill}</p>
          ))}
          <LoadEmailBox drafts={[]} replies={emails.replies.filter(reply => !reply.loadId)} onDismissReply={emails.onDismissReply} />
        </div>
      )}
      {query && (
        <p role="status" className={`text-sm font-semibold rounded-lg px-4 py-2 border ${matchCount ? 'bg-yellow-400/15 border-yellow-400 text-yellow-200' : 'bg-red-900/30 border-red-500 text-red-200'}`}>
          {matchCount
            ? `🔎 ${matchCount} booked load${matchCount === 1 ? '' : 's'} match "${query}" (highlighted in yellow, shown first)`
            : `No booked load matches "${query}". Check the spelling, or try the load #, driver or truck.`}
        </p>
      )}
      {entries.length === 0 && (
        <p className="text-sm text-gray-300 bg-[#121829] border border-[#1c2541] rounded-lg p-6 text-center">
          No booked loads yet. Open a load, enter the driver, and click 📦 Book Load.
        </p>
      )}
      {entries.map(({ customer, load }) => {
        const stage = load.trackingStage || 'Booked';
        const alert = getTrackingAlert(load, now);
        const lastCall = getLastCheckCall(load);
        const delivered = stage === 'Delivered';
        const phone = phoneDigits(load.driverPhone);
        const matched = isMatch(load);
        return (
          <div
            key={`${customer}|${load.id}`}
            data-booked-load={load.id}
            data-search-match={matched ? 'true' : undefined}
            className={`tms-booked-card rounded-lg border p-3 sm:p-4 bg-[#121829] ${matched ? 'border-yellow-300 ring-4 ring-yellow-300/80 shadow-[0_0_24px_rgba(253,224,71,0.45)]' : alert?.level === 'late' ? 'border-red-500' : alert?.level === 'due' ? 'border-amber-400' : delivered ? 'border-[#1c2541] opacity-60' : 'border-purple-500/50'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] text-gray-400">
                  {matched && <span className="mr-2 bg-yellow-300 text-black font-bold px-1.5 py-0.5 rounded">🔎 Match</span>}
                  {customer}
                </p>
                <button type="button" onClick={() => onOpen(customer, load.id)} title="Open this load" className="text-white font-bold text-sm hover:underline cursor-pointer">
                  #{load.id}
                </button>
                <p className="text-sm text-white">{load.origCity}, {load.origSt} → {load.destCity}, {load.destSt}</p>
                <p className="text-[11px] text-gray-300">PU {load.pickupTime || '—'} · DEL {load.deliveryTime || '—'}{load.rateInput ? ` · $${load.rateInput}` : ''}</p>
              </div>
              <div className="text-sm text-white">
                <p className="font-semibold">🚚 {load.driver || 'No driver'}</p>
                <p className="text-[11px] text-gray-300">Truck {load.truck || '—'} · Trailer {load.trailer || '—'}{load.pickupEta ? ` · PU ETA ${load.pickupEta}` : ''}{load.emptyLocation ? ` · Empty ${load.emptyLocation}` : ''}</p>
                {phone ? (
                  <p className="tms-booked-actions flex flex-wrap gap-2 mt-1">
                    <a href={`tel:${phone}`} className="bg-emerald-700 hover:bg-emerald-600 text-white text-[11px] px-2 py-0.5 rounded font-semibold">📞 Call {load.driverPhone}</a>
                    <button
                      type="button"
                      onClick={event => { void openDriverText(event, load, customer); }}
                      title={`Opens Google Voice with this text copied:\n\n${buildDriverText(load, customer, now)}`}
                      className="bg-sky-700 hover:bg-sky-600 text-white text-[11px] px-2 py-0.5 rounded font-semibold cursor-pointer"
                    >
                      💬 Text (Google Voice)
                    </button>
                  </p>
                ) : <p className="text-[11px] text-amber-300 mt-1">No driver phone on file</p>}
              </div>
              <div className="tms-booked-side flex flex-col items-start sm:items-end gap-1 w-full sm:w-auto">
                <label className="text-[11px] text-gray-400" htmlFor={`stage-${customer}-${load.id}`}>Stage</label>
                <select
                  id={`stage-${customer}-${load.id}`}
                  value={stage}
                  onChange={event => onUpdate(customer, load.id, logCheckCall(load, { stage: event.target.value, note: `Stage: ${event.target.value}` }))}
                  className="bg-[#0b132b] border border-[#1c2541] rounded p-1 text-xs text-white"
                >
                  {trackingStages.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
                {alert && (
                  <span role="alert" className={`text-[11px] px-2 py-0.5 rounded font-bold ${alert.level === 'late' ? 'bg-red-600 text-white' : 'bg-amber-400 text-black'}`}>
                    {alert.level === 'late' ? '⚠ ' : '⏰ '}{alert.text}
                  </span>
                )}
                {(() => {
                  const tracking = getTruckerToolsStatus(load, customer);
                  if (!tracking) return null;
                  const tone = tracking.level === 'ok' ? 'bg-emerald-700 text-white' : tracking.level === 'late' ? 'bg-red-600 text-white' : 'bg-amber-400 text-black';
                  return (
                    <>
                      <span data-tracking-status={tracking.level} className={`text-[11px] px-2 py-0.5 rounded font-bold mt-1 max-w-[320px] text-right ${tone}`}>
                        {tracking.level === 'ok' ? '✅ ' : tracking.level === 'late' ? '⚠ ' : '⏳ '}{tracking.text}
                      </span>
                      {!load.trackingStartedAt && (
                        <button
                          type="button"
                          onClick={() => onUpdate(customer, load.id, markTrackingStarted(load, new Date().toISOString(), { byHand: true }))}
                          title="The driver is tracking but no Trucker Tools email came: stop the reminder emails. Nothing is emailed."
                          className="bg-slate-700 hover:bg-slate-600 text-white text-[11px] px-2 py-0.5 rounded font-semibold cursor-pointer"
                        >
                          Mark tracking started
                        </button>
                      )}
                    </>
                  );
                })()}
                {delivered && (() => {
                  const paperwork = getPaperworkStatus(load, now);
                  const tone = paperwork.level === 'ok' ? 'bg-emerald-700 text-white' : paperwork.level === 'late' ? 'bg-red-600 text-white' : paperwork.level === 'due' ? 'bg-amber-400 text-black' : 'bg-slate-600 text-white';
                  return (
                    <>
                      <span className={`text-[11px] px-2 py-0.5 rounded font-bold mt-1 max-w-[320px] text-right ${tone}`}>
                        {paperwork.level === 'ok' ? '✅ ' : '📄 '}{paperwork.text}
                      </span>
                      {!load.paperworkReceivedAt && (
                        <button
                          type="button"
                          onClick={() => onUpdate(customer, load.id, {
                            ...load, paperworkReceivedAt: new Date().toISOString(), paperworkDone: true,
                            notes: [load.notes, 'Paperwork marked received by hand'].filter(Boolean).join('\n')
                          })}
                          title="You got the POD another way (text, fax): stop the daily reminders and move this load to Completed. Nothing is emailed."
                          className="bg-slate-700 hover:bg-slate-600 text-white text-[11px] px-2 py-0.5 rounded font-semibold cursor-pointer"
                        >
                          Mark paperwork received
                        </button>
                      )}
                    </>
                  );
                })()}
                <div className="flex flex-wrap gap-1 mt-1">
                  <button type="button" onClick={() => onOpen(customer, load.id)} title="Open this load to change the rate, dates or driver" className="bg-slate-700 hover:bg-slate-600 text-white text-[11px] px-2 py-0.5 rounded font-semibold cursor-pointer">
                    ✏️ Edit load
                  </button>
                  {onRemoveCapacity && (
                    <button type="button" onClick={() => onRemoveCapacity(customer, load.id)} title="Clear the driver, truck and trailer and move this load back to OPEN" className="bg-amber-600 hover:bg-amber-500 text-white text-[11px] px-2 py-0.5 rounded font-semibold cursor-pointer">
                      ↩ Remove capacity
                    </button>
                  )}
                  {emails?.onCompose && (
                    <button type="button" onClick={() => emails.onCompose(customer, load)} title="Write your own update to the customer (with the real time) and send it reply-all on their email thread" className="bg-sky-700 hover:bg-sky-600 text-white text-[11px] px-2 py-0.5 rounded font-semibold cursor-pointer">
                      ✉ Customer update
                    </button>
                  )}
                </div>
              </div>
            </div>
            {emails && (
              <LoadEmailBox
                drafts={emails.drafts.filter(draft => draft.customer === customer && String(draft.loadId) === String(load.id))}
                replies={emails.replies.filter(reply => reply.customer === customer && String(reply.loadId) === String(load.id))}
                onChangeText={emails.onChangeText}
                onChangeManual={emails.onChangeManual}
                onSend={emails.onSend}
                onSkip={emails.onSkip}
                onDismissReply={emails.onDismissReply}
              />
            )}
            <form
              className="tms-checkcall flex gap-2 mt-3"
              onSubmit={event => {
                event.preventDefault();
                const form = event.currentTarget;
                const note = String(form.elements.note.value || '').trim();
                if (!note) return;
                const updated = logCheckCall(load, { stage, note });
                updated.checkCalls[updated.checkCalls.length - 1].customerEmailPending = true;
                onUpdate(customer, load.id, updated);
                form.reset();
              }}
            >
              <input name="note" type="text" placeholder="Check call note (location, ETA, issues)…" className="min-w-0 flex-1 bg-[#0b132b] border border-[#1c2541] rounded p-1.5 text-xs text-white" />
              <button type="submit" className="bg-purple-600 hover:bg-purple-500 text-white text-xs px-3 rounded font-semibold cursor-pointer">Log check call</button>
            </form>
            <p className="text-[11px] text-gray-300 mt-2">
              {lastCall
                ? `Last update ${formatCheckTime(lastCall.at)} · ${lastCall.stage}${lastCall.note ? ` · ${lastCall.note}` : ''}`
                : `Booked ${formatCheckTime(load.bookedAt) || ''} · no check calls yet`}
            </p>
          </div>
        );
      })}
      {completed.length > 0 && (
        <details
          key={completedMatches.length ? 'completed-open' : 'completed'}
          open={completedMatches.length > 0}
          className="rounded-lg border border-emerald-700/60 bg-[#0f1a24] p-3"
          aria-label="Completed loads"
        >
          <summary className="cursor-pointer text-sm font-bold text-emerald-200">
            ✅ Completed: delivered, paperwork received ({completed.length})
          </summary>
          <div className="flex flex-col gap-1 mt-2">
            {completed.map(({ customer, load }) => {
              const matched = isMatch(load);
              return (
                <div
                  key={`done-${customer}|${load.id}`}
                  data-booked-load={load.id}
                  data-search-match={matched ? 'true' : undefined}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded px-3 py-2 text-xs border ${matched ? 'border-yellow-300 ring-2 ring-yellow-300/80 bg-yellow-400/10' : 'border-[#1c2541] bg-[#121829]'}`}
                >
                  <span className="text-gray-200">
                    {matched && <span className="mr-2 bg-yellow-300 text-black font-bold px-1.5 py-0.5 rounded">🔎 Match</span>}
                    <span className="text-gray-400">{customer}</span>{' · '}
                    <button type="button" onClick={() => onOpen(customer, load.id)} className="font-bold text-white hover:underline cursor-pointer">#{load.id}</button>
                    {' · '}{load.origCity}, {load.origSt} → {load.destCity}, {load.destSt}
                    {' · '}🚚 {load.driver || 'No driver'}{load.truck ? ` (${load.truck})` : ''}
                    {' · '}paperwork {formatCheckTime(load.paperworkReceivedAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdate(customer, load.id, { ...load, paperworkReceivedAt: '', paperworkDone: false })}
                    title="Paperwork not in after all: put this load back on the Booked Loads list"
                    className="bg-slate-700 hover:bg-slate-600 text-white text-[11px] px-2 py-0.5 rounded font-semibold cursor-pointer"
                  >
                    ↩ Back to booked
                  </button>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

// Long random code for a load's public driver link (not guessable).
function createInquiryToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Driver links always point at the live site, even when the TMS runs on this
// computer (a localhost link only works on your own PC). Override with
// VITE_PUBLIC_SITE_URL if the site address ever changes.
const publicSiteUrl = String(
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PUBLIC_SITE_URL) || 'https://landstar-tms-reading-cffe.vercel.app'
).replace(/\/+$/, '');

function getInquiryUrl(token, siteUrl = publicSiteUrl) {
  return `${String(siteUrl).replace(/\/+$/, '')}/i/${token}`;
}

// What goes in Landstar column AA. The bulk upload treats it as a comment CODE: anything
// that is not exactly one of Landstar's standard comments fails the whole posting
// ("Comment Code Not Found"). So only a standard comment is sent, spelled the way
// Landstar has it; free text and links are left out.
function getLandstarExportComment(load) {
  const comment = String(load?.landstarComment || '').trim().toLowerCase();
  return landstarCommentOptions.find(option => option.toLowerCase() === comment) || '';
}

// Full-height list: hides everything above the load list (logo, tools, customers,
// filters) so the loads fill the whole sidebar. Remembered per browser.
const listFocusKey = 'landstar_listFocus';

// ▦ Table / ▤ Cards switch for the load list (Daniel 2026-11-27). Remembered in this browser;
// table view widens the list column (body.tms-table-view in global.css).
const listViewKey = 'landstar_listView';
function readListView() {
  try { return localStorage.getItem(listViewKey) === 'table' ? 'table' : 'cards'; } catch { return 'cards'; }
}

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

function ListFocusToggle() {
  const [focus, setFocus] = useState(() => {
    try { return localStorage.getItem(listFocusKey) === 'true'; } catch { return false; }
  });
  useEffect(() => {
    if (typeof document !== 'undefined') document.body.classList.toggle('tms-list-focus', focus);
    try { localStorage.setItem(listFocusKey, String(focus)); } catch { /* storage unavailable */ }
  }, [focus]);
  return (
    <button
      type="button"
      onClick={() => setFocus(on => !on)}
      aria-pressed={focus}
      title={focus ? 'Show the tools, customers and filters again' : 'Hide everything above the list so the loads fill the sidebar'}
      className="tms-list-bar-button"
    >
      {focus ? '⤡ Show controls' : '⤢ Full-height list'}
    </button>
  );
}

// The Landstar upload bot (bot/status-server.js) reports its login status on
// this computer while it runs. No answer means the bot is not running.
const BOT_STATUS_URL = 'http://127.0.0.1:47615/status';

// More removals than this from one import, and over half the customer's posted loads, needs a yes.
const LARGE_DROP_MIN = 10;

function addToUnpostQueue(droppedPostings) {
  const queue = readUnpostQueue();
  const seen = new Set(queue.map(item => `${item.customer}|${item.loadId}`));
  droppedPostings.forEach(item => {
    if (item?.posting && !seen.has(`${item.customer}|${item.loadId}`)) {
      queue.push({ ...item, queuedAt: new Date().toISOString() });
      seen.add(`${item.customer}|${item.loadId}`);
    }
  });
  writeUnpostQueue(queue);
  return queue.length;
}

const assignSeenKey = 'landstar_assignSeenAt';

// ---------- Rate raises from the bot's board-rate watch (bot/hazmat-watch.js) ----------
const rateRaiseSeenKey = 'landstar_rateRaiseSeenAt';
// One export at a time (see handleExportToLandstar). Outside the App so it never shifts App state.
const exportGuard = { running: false, finishedAt: 0 };
const EXPORT_REPEAT_MS = 15 * 1000;
const sameZip = (a, b) => String(a || '').trim().padStart(5, '0') === String(b || '').trim().padStart(5, '0');
// The TMS load a raise belongs to: its saved Landstar posting has the same origin ZIP,
// destination ZIP, pickup end and weight as the raised posting.
function loadMatchesRateRaise(load, raise) {
  const mine = load?.landstarPosting;
  const theirs = raise?.posting;
  if (!mine || !theirs) return false;
  return sameZip(mine.originZip, theirs.originZip) && sameZip(mine.destZip, theirs.destZip)
    && String(mine.pickupThru || '').trim() === String(theirs.pickupThru || '').trim()
    && (!theirs.weight || !mine.weight || Number(mine.weight) === Number(theirs.weight));
}
// The load after the bot raised it on Landstar: its rate is the new board rate and it remembers
// the raise (the ⬆ RAISED badge). It counts as a set rate ('user-entered'): the rate box and the
// export only accept user-entered/DAT rates, a re-export then posts this exact rate with no RXO
// DAT discount, and re-imports and DAT refreshes keep it. It is not saved as a lane rate.
function applyRateRaise(load, raise) {
  return {
    ...load,
    rateInput: String(raise.to),
    rateSource: 'user-entered',
    rateRaise: {
      from: Number(raise.from) || 0, to: Number(raise.to) || 0,
      competitor: raise.competitor || '', competitorRate: Number(raise.competitorRate) || 0,
      landstarLoadId: raise.landstarLoadId || '', at: Number(raise.at) || Date.now()
    }
  };
}
function takeNewRateRaises(raises) {
  if (!Array.isArray(raises) || !raises.length) return [];
  let seenAt = 0;
  try { seenAt = Number(localStorage.getItem(rateRaiseSeenKey)) || 0; } catch { /* first time */ }
  const fresh = raises.filter(raise => Number(raise?.at) > seenAt);
  if (fresh.length) {
    try { localStorage.setItem(rateRaiseSeenKey, String(Math.max(...fresh.map(raise => Number(raise.at))))); } catch { /* shown again next time */ }
  }
  return fresh;
}
const formatRaiseMoney = value => `$${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

// ---------- Bulk Postings error drafts the bot deleted (bot/error-drafts.js) ----------
const errorDraftSeenKey = 'landstar_errorDraftSeenAt';
function takeNewErrorDrafts(drafts) {
  if (!Array.isArray(drafts) || !drafts.length) return [];
  let seenAt = 0;
  try { seenAt = Number(localStorage.getItem(errorDraftSeenKey)) || 0; } catch { /* first time */ }
  const fresh = drafts.filter(draft => Number(draft?.at) > seenAt);
  if (fresh.length) {
    try { localStorage.setItem(errorDraftSeenKey, String(Math.max(...fresh.map(draft => Number(draft.at))))); } catch { /* shown again next time */ }
  }
  return fresh;
}
// The load after Landstar rejected its posting and the bot deleted the error draft.
function applyLandstarError(load, draft) {
  return { ...load, landstarError: { reasons: draft.reasons || [], draftId: draft.draftId || '', at: Number(draft.at) || Date.now() } };
}
// The LANDSTAR ERROR badge shows until the load is exported again after the error.
// Where a load stands on Landstar (Daniel 2026-11-27: posted loads now stay OPEN, so which ones
// have errors and which were never posted must show at a glance): 'error' (Landstar rejected
// it, or the export failed and it has not exported since), 'posted', 'unposted', or '' (booked).
// Posted only once the bot confirms Landstar took the upload (Daniel 2026-11-27): until then
// 'sent' (with the bot), and 'error' when no confirmation comes within 3 hours. Only the TMS
// on the bot computer gets confirmations; elsewhere (or with an older bot) exported = posted.
const POSTING_CONFIRM_LIMIT_MS = 3 * 60 * 60 * 1000;
const postedConfirmations = { supported: true, since: 0, keys: new Map() };
const usesPostingConfirmations = () => canStartBotHere() && postedConfirmations.supported;

// The bot's ledger key for a posting: origin ZIP | destination ZIP | pickup thru | weight.
function landstarPostingKey(posting) {
  const zip = value => {
    const text = String(value ?? '').trim().toUpperCase();
    return /^\d{1,5}$/.test(text) ? text.padStart(5, '0') : text;
  };
  return [zip(posting?.originZip), zip(posting?.destZip), String(posting?.pickupThru || '').trim(), Number(posting?.weight) || 0].join('|');
}

function getPostingState(load, now = Date.now()) {
  if (!load || load.status === 'BOOKED' || load.coveredAt) return '';
  const exportedAt = Date.parse(load.landstarExportedAt || '');
  const exportErrorOpen = load.exportError && !(Number.isFinite(exportedAt) && exportedAt > Date.parse(load.exportError.at));
  if (hasOpenLandstarError(load) || exportErrorOpen) return 'error';
  if (!Number.isFinite(exportedAt)) return 'unposted';
  if (load.landstarConfirmedAt || !usesPostingConfirmations()) return 'posted';
  return now - exportedAt > POSTING_CONFIRM_LIMIT_MS ? 'error' : 'sent';
}

function getPostingErrorText(load) {
  if (hasOpenLandstarError(load)) return `Landstar rejected this posting: ${(load.landstarError.reasons || []).join('; ') || 'no reason given'}. Fix the load and export it again.`;
  if (load?.exportError) return `Not exported: ${load.exportError.message}`;
  if (load?.landstarExportedAt && !load.landstarConfirmedAt) return `Sent to the bot ${new Date(load.landstarExportedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}, but Landstar never confirmed it. Check Bulk Postings, or export it again.`;
  return '';
}

function hasOpenLandstarError(load) {
  const error = load?.landstarError;
  if (!error) return false;
  const exportedAt = Date.parse(load.landstarExportedAt || '');
  return !(Number.isFinite(exportedAt) && exportedAt > Number(error.at));
}

// ---------- Landstar removals (bot/unpost.js) ----------
// A load sent to the removal bot shows "⏳ SENT TO REMOVAL BOT"; when the bot reports back it
// shows RMOV (removed, or no longer on the board) or "NOT REMOVED" (remove it by hand).
const removalSeenKey = 'landstar_removalSeenAt';
function readRemovalSeenAt() {
  try { return Number(localStorage.getItem(removalSeenKey)) || 0; } catch { return 0; }
}
function takeNewRemovalResults(results) {
  if (!Array.isArray(results) || !results.length) return [];
  const seenAt = readRemovalSeenAt();
  const fresh = results.filter(result => Number(result?.at) > seenAt);
  if (fresh.length) {
    try { localStorage.setItem(removalSeenKey, String(Math.max(...fresh.map(result => Number(result.at))))); } catch { /* shown again next time */ }
  }
  return fresh;
}
function markRemovalQueued(load, reason = '') {
  return { ...load, landstarRemoval: { state: 'queued', at: new Date().toISOString(), ...(reason ? { reason } : {}) } };
}
function applyRemovalResult(load, result) {
  return { ...load, landstarRemoval: { ...(load.landstarRemoval || {}), state: result.state, at: new Date(Number(result.at) || Date.now()).toISOString() } };
}
// Badge text, style and tooltip for a load's removal state (null when it has none).
function getRemovalBadge(load) {
  const removal = load?.landstarRemoval;
  if (!removal?.state) return null;
  const when = formatCheckTime(removal.at) || '';
  if (removal.state === 'queued') return { text: '⏳ SENT TO REMOVAL BOT', className: 'bg-amber-500 text-black', title: `Sent to the removal bot ${when}. It takes the posting off the Landstar board.` };
  if (removal.state === 'removed') return { text: 'RMOV', className: 'bg-slate-500 text-white', title: `Removed from Landstar ${when}.` };
  if (removal.state === 'gone') return { text: 'RMOV', className: 'bg-slate-500 text-white', title: `No longer on the Landstar board (checked ${when}).` };
  return { text: '⚠ NOT REMOVED', className: 'bg-red-600 text-white', title: `Still on Landstar after 3 tries (${when}): posted by hand or Landstar refused. Remove it on LandstarOnline.` };
}

function addToAssignQueue(item) {
  const key = `${item.customer}|${item.loadId}`;
  const queue = readAssignQueue().filter(existing => `${existing.customer}|${existing.loadId}` !== key);
  try {
    localStorage.setItem(assignQueueKey, JSON.stringify([...queue, { ...item, queuedAt: new Date().toISOString() }]));
  } catch (error) {
    console.error('Could not save the Landstar assign queue:', error);
  }
}

// Results the bot reports that this browser hasn't shown yet.
function takeNewAssignResults(results) {
  if (!Array.isArray(results) || !results.length) return [];
  let seenAt = 0;
  try { seenAt = Number(localStorage.getItem(assignSeenKey)) || 0; } catch { /* first time */ }
  const fresh = results.filter(result => Number(result?.at) > seenAt);
  if (fresh.length) {
    try { localStorage.setItem(assignSeenKey, String(Math.max(...fresh.map(result => Number(result.at))))); } catch { /* shown again next time */ }
  }
  return fresh;
}
// The load's note after the bot's assignment: "Landstar: Assigned 420371 - LDWY ..." or why not.
function applyAssignResult(load, result) {
  const capacity = result.carrierMc ? `carrier MC ${result.carrierMc}` : `truck ${result.truck}`;
  const line = result.ok
    ? `Landstar: ${result.message}`
    : result.unconfirmed
      ? `Landstar: ${capacity} NOT CONFIRMED - check Landstar before assigning again. ${result.message}`
      : `Landstar: ${capacity} NOT assigned - ${result.message}. Assign it by hand.`;
  return {
    ...load,
    ...(result.ok && result.posting ? { landstarPosting: result.posting } : {}),
    landstarAssignment: { ok: Boolean(result.ok), truck: result.truck, ...(result.carrierMc ? { carrierMc: result.carrierMc } : {}), landstarLoadId: result.landstarLoadId || '', message: result.message, at: result.at },
    notes: load.notes ? `${load.notes}\n${line}` : line
  };
}

// ---------- Paramount tracking emails ----------
// Booked Paramount loads (Para 1522166 - ATZ and - ATZ H): the bot reads Clarity for the
// tracking link, pickup ETA and shipper arrival/departure (bot/clarity.js); the TMS replies
// all on Paramount's "Rate Confirmation for order: <order#>" email with them
// (/api/paramount-email), and flags replies from Paramount. The first few emails wait for
// a Send click; after that they go out on their own.
const BOT_TRACKING_URL = 'http://127.0.0.1:47615/tracking';
const PARAMOUNT_EMAIL_URL = '/api/paramount-email';

const paramountMaySendItself = kind => !paramountAlwaysAskKinds.has(kind) && readParamountApprovedCount() >= PARAMOUNT_AUTO_SEND_AFTER;
// The App's latest loads/profile for the email timers, and drafts already being handled.
const paramountLatest = {};
const paramountBusy = new Set();
// Clarity results already handed to the App (the bot repeats them on every status check).
const paramountResultSeen = new Map();
// Duplicated freight bills already shown as a banner (the helper repeats them while they exist).
const duplicateBillSeen = new Map();
const refreshIssueSeen = new Map();
// The fuel surcharge email last applied (Gmail message id).
const fuelEmailSeenKey = 'landstar_fuelEmailSeen';
// Freight bills from recent BCO Load Detail emails (refreshed every few minutes).
const bcoBillsCache = { at: 0, bills: [] };
const truckerToolsCache = { at: 0, okAt: 0, starts: [] };
// Daniel's VIP customers (2026-11-09): a gold banner + Windows notification the moment one
// of them emails, on any thread. Heather books the Paramount loads - never miss her.
const VIP_CONTACTS = [
  { email: 'heather.locke@rlglobal.com', name: 'Heather Locke (Paramount)' }
];
const vipSeenKey = 'landstar_vipSeen';
// Driver replies must be seen right away: a Windows notification (even when the TMS tab is in the
// background), a sound, and a blinking tab title until the TMS is looked at.
function alertDriverReply(title, body, gmailThreadId, tabTitle = '💬 DRIVER REPLIED') {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const note = new Notification(title, { body, requireInteraction: true, tag: `driver-${gmailThreadId || title}` });
      note.onclick = () => {
        window.focus();
        if (gmailThreadId) window.open(`https://mail.google.com/mail/u/0/#all/${gmailThreadId}`, '_blank');
        note.close();
      };
    }
  } catch { /* the banner still shows */ }
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audio = new AudioContext();
    [0, 0.25, 0.5].forEach(start => {
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.frequency.value = 880;
      gain.gain.value = 0.25;
      tone.connect(gain).connect(audio.destination);
      tone.start(audio.currentTime + start);
      tone.stop(audio.currentTime + start + 0.15);
    });
  } catch { /* no sound */ }
  if (!blinkTimer) {
    const original = document.title;
    let on = false;
    blinkTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        clearInterval(blinkTimer);
        blinkTimer = null;
        document.title = original;
        return;
      }
      on = !on;
      document.title = on ? tabTitle : original;
    }, 1000);
  }
}
let blinkTimer = null;

// Driver replies already shown for loads that aren't booked in the TMS.
const driverReplySeenKey = 'landstar_driverReplySeenIds';
function readSeenDriverReplies() {
  try { const parsed = JSON.parse(localStorage.getItem(driverReplySeenKey)); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
function markSeenDriverReplies(ids) {
  try { localStorage.setItem(driverReplySeenKey, JSON.stringify([...readSeenDriverReplies(), ...ids].slice(-300))); } catch { /* shown again next time */ }
}

function readParamountApprovedCount() {
  try { return Number(localStorage.getItem(paramountApprovedKey)) || 0; } catch { return 0; }
}

async function callParamountEmail(body) {
  const response = await fetch(PARAMOUNT_EMAIL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || `Email request failed (HTTP ${response.status}).`);
    // Refused by the email record (bot/email-record.js): 'sent', 'skipped', 'sending' or 'unknown'.
    if (result.emailRecord) error.emailRecord = result.emailRecord;
    throw error;
  }
  return result;
}

// Outgoing tracking emails go a few seconds apart so a batch doesn't hit Gmail's per-minute limit.
const spacedEmailSend = createSendSpacer();

// Tells the email record that Daniel chose "Don't send", so no sender sends it later.
function recordSkippedEmail(draft) {
  if (!canStartBotHere()) return;
  void fetch('/api/email-record', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'skip', key: draft.id, meta: emailRecordMeta(draft) })
  }).catch(() => { /* the load itself still records the skip */ });
}

// What the email record keeps about a draft, for the system check.
function emailRecordMeta(draft) {
  return { customer: draft.customer, loadId: draft.loadId, kind: draft.kind === 'driver' ? `driver ${draft.driverKind}` : draft.kind };
}

 

async function checkBeforePodRequest(load, tracking, readPaperwork = callParamountEmail) {
  if (load.paperworkReceivedAt) return { received: true, files: [] };
  const result = await readPaperwork({
    action: 'driverPaperwork', freightBill: tracking.freightBill, since: getPaperworkSince(load, tracking)
  });
  if (!Array.isArray(result.files)) throw new Error('Could not verify driver paperwork: invalid attachment response.');
  return { received: result.files.length > 0, files: result.files };
}

// Ctrl+V of a picture: which list it is. Para lists come from Heather in Google Chat:
// the account ending in H is hazmat, the other one non-hazmat.
const pasteImportChoices = [
  { label: 'Para 1522166 - ATZ · non-hazmat list', customer: 'Para 1522166 - ATZ', className: 'bg-sky-700 hover:bg-sky-600' },
  { label: 'Para 1522166 - ATZ H · hazmat list', customer: 'Para 1522166 - ATZ H', className: 'bg-red-700 hover:bg-red-600' },
  { label: 'NTG load cards', customer: '', className: 'bg-slate-700 hover:bg-slate-600' }
];

// ---------- Notices (instead of alert() pop-ups) ----------
const NOTICE_INFO_MS = 45 * 1000;
const UNDO_OFFER_MS = 10 * 60 * 1000;
// A message about something that went wrong or needs input stays until closed (warn); news
// and confirmations clear themselves (info).
function noticeLevel(message) {
  return /could not|couldn'?t|failed|failure|error|not saved|missing|^enter |\benter (the|a|your)\b|^select |\bselect a\b|no loads|nothing to|cannot|can'?t|isn'?t|is not|not exported|warning|⚠|refus|reject|invalid|already exists|skipped/i
    .test(String(message || '')) ? 'warn' : 'info';
}

// ---------- Google Chat inbox (bot/chat-bot.js) ----------
// The Chat bot saves new pictures and spreadsheets from Daniel's Google Chat groups (Para
// lists; RXO's LANDJA.18, which sends Excel load lists). The TMS checks the inbox
// (GET /api/chat-inbox) and asks which account each one is for, like a Ctrl+V paste.
// A spreadsheet's account is remembered by its LIST LABEL, the message posted just above the
// file in the chat ("big list", "fbs", "reefer"). RXO's files are all named
// "allLoadsSearch_Export - <date>.xlsx", so the file name tells nothing (Daniel 2026-11-27:
// "Each list has a name on top of it"). The first time a label comes in the TMS asks which
// account; after that that label imports into that account by itself. Rules live in My
// Settings (profile.chatSheetAccounts), so they sync to the new laptop.
const chatInboxPollMs = 30 * 1000;
// Labels Daniel told us (2026-11-27); a label he picks in the TMS is saved on top of these.
const defaultChatSheetAccounts = {
  'big list': 'R X O 2429200 - ATZ V',
  fbs: 'R X O 2429200 - ATZ F', fb: 'R X O 2429200 - ATZ F', flatbed: 'R X O 2429200 - ATZ F', flatbeds: 'R X O 2429200 - ATZ F',
  reefer: 'R X O 2429200 - ATZ R', reefers: 'R X O 2429200 - ATZ R',
  haz: 'R X O 2429200 - ATZ H', hazmat: 'R X O 2429200 - ATZ H',
  // Solar panels: Tyler labels this list "panels" or "solar".
  panels: 'R X O 2429200 - ATZ P', panel: 'R X O 2429200 - ATZ P',
  solar: 'R X O 2429200 - ATZ P', 'solar panels': 'R X O 2429200 - ATZ P', 'solar panel': 'R X O 2429200 - ATZ P'
};

// Accounts whose Google Chat lists export to Landstar by themselves right after the import
// (Daniel 2026-11-27: "only RXO"). Never R X O 2429200 - SNB: those are Ivan's loads and must
// post under his own code, from his TMS.
const chatAutoExportAccounts = new Set([
  'R X O 2429200 - ATZ V', 'R X O 2429200 - ATZ F', 'R X O 2429200 - ATZ R',
  'R X O 2429200 - ATZ H', 'R X O 2429200 - ATZ P'
].map(name => name.toUpperCase().replace(/[^A-Z0-9]/g, '')));
function isChatAutoExportAccount(customer) {
  return chatAutoExportAccounts.has(accountKey(normalizeCustomerName(customer)));
}

// Lists in LANDJA18 for agent SNB (Ivan): "LOWES" and the one marked "$$" import into
// R X O 2429200 - SNB, an account Daniel shares with Ivan, so they show up in Ivan's TMS and
// post under Ivan's own code (Daniel 2026-11-27). "$$" has no letters, so it is matched here.
const SNB_CHAT_ACCOUNT = 'R X O 2429200 - SNB';
function getSnbChatSheetAccount(label) {
  const text = String(label || '');
  return /lowe'?s/i.test(text) || /\$\s*\$/.test(text) ? SNB_CHAT_ACCOUNT : '';
}

// A list label without what changes from day to day: case, numbers/dates, punctuation.
// "Big List 11/27!" -> "big list".
function getChatSheetKey(label) {
  return String(label || '').toLowerCase()
    .replace(/\d+/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

function getChatSheetAccount(rules, label) {
  const snb = getSnbChatSheetAccount(label);
  if (snb) return snb;
  const key = getChatSheetKey(label);
  if (!key) return '';
  const saved = rules && typeof rules === 'object' ? rules[key] : '';
  return String(saved || defaultChatSheetAccounts[key] || '');
}

function rememberChatSheetAccount(rules, label, customer) {
  const key = getChatSheetKey(label);
  if (!key || !customer) return { ...(rules || {}) };
  return { ...(rules || {}), [key]: customer };
}

// The accounts offered for a chat item: RXO's chat offers the RXO accounts, Para's chat
// the Para accounts and NTG cards (pictures only: NTG cards are never spreadsheets).
function getChatInboxChoices(item, brokers = []) {
  const colors = ['bg-sky-700 hover:bg-sky-600', 'bg-red-700 hover:bg-red-600', 'bg-amber-700 hover:bg-amber-600', 'bg-emerald-700 hover:bg-emerald-600', 'bg-indigo-700 hover:bg-indigo-600'];
  const isSheet = item?.type === 'spreadsheet';
  if (item?.kind === 'rxo') {
    // Every RXO account (R X O 2429200 - ATZ, ATZ H, ATZ P, ATZ R...), not just the main one.
    return brokers.filter(name => /^\s*R\s*X\s*O\b/i.test(normalizeCustomerName(name)))
      .map((customer, index) => ({ label: customer, customer, className: colors[index % colors.length] }));
  }
  const choices = getPasteImportChoices(brokers);
  return isSheet ? choices.filter(choice => choice.customer) : choices;
}

// The Para choices under the names in the customer list ("Para 1522166 - N HAZ" for the old
// "Para 1522166 - ATZ"), so a renamed account still gets its pictures.
function getPasteImportChoices(brokers = []) {
  return pasteImportChoices.map(choice => {
    const customer = choice.customer ? findListedAccount(choice.customer, brokers) || choice.customer : '';
    return customer === choice.customer ? choice : { ...choice, customer, label: `${customer} Â· ${choice.label.split(' Â· ').pop()}` };
  });
}

// ---------- MercuryGate (Landstar's TMS) for booked Paramount loads ----------
// The helper bot fills MercuryGate the way Daniel does by hand (bot/mercurygate-job.js):
// "booked": Customer Reference Number, pickup + drop from the rate confirmation PDF, special
// instructions; "pickedUp": upload the PDF as a Customer Confirmation Sheet. Loads booked before
// the bot started doing this (MERCURYGATE_FROM) were entered by hand and are left alone.
const BOT_MERCURYGATE_URL = 'http://127.0.0.1:47615/mercurygate';
const MERCURYGATE_FROM = Date.parse('2026-11-06T16:55:00Z');
const mercurygateSeenKey = 'landstar_mercurygateSeenAt';

// The MercuryGate step due for a booked Paramount load, or ''.
// The number MercuryGate is searched by: the Landstar freight bill (from Clarity / the BCO email)
// or, right after booking, the Landstar load number from Assign Capacity (also a reference there).
function getMercuryGateSearchNumber(load, tracking = {}) {
  return String(tracking.freightBill || (load.landstarAssignment?.ok ? load.landstarAssignment.landstarLoadId : '') || '');
}

function getDueMercuryGateStep(load, tracking = {}) {
  if (!automationPolicy.automaticDispatchEnabled) return '';
  if (load.status !== 'BOOKED' || !getMercuryGateSearchNumber(load, tracking)) return '';
  if (!(Date.parse(load.bookedAt) >= MERCURYGATE_FROM)) return '';
  const done = load.mercurygate || {};
  if (!done.booked) return 'booked';
  if (tracking.leftShipperAt && !done.pickedUp) return 'pickedUp';
  return '';
}

// The load's notes after the bot's MercuryGate run.
function applyMercuryGateResult(load, result) {
  const lines = (result.results || []).map(item => `MercuryGate: ${item.message}`);
  if (!result.ok && result.retrying) lines.push(`MercuryGate: not finished yet, trying again - ${String(result.message || '').split('\n')[0]}`);
  else if (!result.ok) lines.push(`MercuryGate: NOT finished - ${String(result.message || '').split('\n')[0]}. Finish it by hand.`);
  return {
    ...load,
    mercurygate: { ...(load.mercurygate || {}), [`${result.step}Result`]: { ok: Boolean(result.ok), at: result.at } },
    notes: [load.notes, ...lines].filter(Boolean).join('\n')
  };
}

const rxoHandledKey = 'landstar_rxoHandledRequests';

function readRxoHandled() {
  try {
    const parsed = JSON.parse(localStorage.getItem(rxoHandledKey));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function markRxoHandled(messageId) {
  try { localStorage.setItem(rxoHandledKey, JSON.stringify([...readRxoHandled(), messageId].slice(-300))); } catch { /* asked again next time */ }
}

// Any customer's "update?" email about a booked load (answered or skipped once, by message id).
const customerHandledKey = 'landstar_customerHandledRequests';
function readCustomerHandled() {
  try {
    const parsed = JSON.parse(localStorage.getItem(customerHandledKey));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function markCustomerHandled(messageId) {
  try { localStorage.setItem(customerHandledKey, JSON.stringify([...readCustomerHandled(), messageId].slice(-500))); } catch { /* asked again next time */ }
}

const botStatusStyles = {
  'logged-in': { label: 'Bot logged in', dot: '#22c55e', glow: '0 0 8px #22c55e' },
  uploading: { label: 'Bot uploading', dot: '#22c55e', glow: '0 0 8px #22c55e' },
  'signing-in': { label: 'Bot signing in…', dot: '#facc15', glow: '0 0 8px #facc15' },
  starting: { label: 'Bot starting…', dot: '#facc15', glow: '0 0 8px #facc15' },
  off: { label: 'Bot off', dot: '#64748b', glow: 'none' }
};

// The local TMS (npm run dev) can start the bot; the live site can only show its status.
const BOT_START_URL = '/api/bot/start';
const BOT_START_GRACE_MS = 45_000;

export function BotStatusLight() {
  const [status, setStatus] = useState({ state: 'off', message: 'Upload bot is not running' });
  const startRequestedAt = useRef(0);
  const offStatus = () => (Date.now() - startRequestedAt.current < BOT_START_GRACE_MS
    ? { state: 'starting', message: 'Opening the bot window…' }
    : { state: 'off', message: 'Upload bot is not running' });
  useEffect(() => {
    // On the shared website the light shows the bot running on THIS person's computer (the bot
    // answers 127.0.0.1 with CORS); it only reads its status there, never hands it any work.
    const showOnly = !canStartBotHere();
    let cancelled = false;
    const check = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch(`${BOT_STATUS_URL}?removalsSince=${readRemovalSeenAt()}`, { cache: 'no-store', signal: controller.signal });
        const next = await response.json();
        if (!cancelled) setStatus(botStatusStyles[next.state] ? next : offStatus());
        if (showOnly) return;
        // Assign Capacity results for booked loads: the TMS adds them to the load's notes.
        takeNewAssignResults(next.assignResults).forEach(result => {
          window.dispatchEvent(new CustomEvent('landstar-assign-result', { detail: result }));
        });
        // Removal results -> RMOV / NOT REMOVED on the loads.
        const removals = takeNewRemovalResults(next.removalResults);
        if (removals.length) window.dispatchEvent(new CustomEvent('landstar-removal-results', { detail: removals }));
        // Rates the bot raised on Landstar -> the load's rate and a warning (one event per batch).
        const raises = takeNewRateRaises(next.rateRaises);
        if (raises.length) window.dispatchEvent(new CustomEvent('landstar-rate-raises', { detail: raises }));
        // Bulk Postings error drafts the bot deleted -> a banner and a badge on the load.
        const errorDrafts = takeNewErrorDrafts(next.errorDrafts);
        if (errorDrafts.length) window.dispatchEvent(new CustomEvent('landstar-error-drafts', { detail: errorDrafts }));
        // MercuryGate results (helper bot) -> load notes.
        let mgSeen = 0;
        try { mgSeen = Number(localStorage.getItem(mercurygateSeenKey)) || 0; } catch { /* first time */ }
        const mgFresh = (Array.isArray(next.mercurygateResults) ? next.mercurygateResults : []).filter(result => Number(result.at) > mgSeen && result.mode === 'save');
        if (mgFresh.length) {
          try { localStorage.setItem(mercurygateSeenKey, String(Math.max(...mgFresh.map(result => Number(result.at))))); } catch { /* shown again */ }
          mgFresh.forEach(result => window.dispatchEvent(new CustomEvent('landstar-mercurygate-result', { detail: result })));
        }
        // Clarity results for booked Paramount loads (tracking emails).
        (Array.isArray(next.trackingResults) ? next.trackingResults : []).forEach(result => {
          if (paramountResultSeen.get(result.key) === result.at) return;
          paramountResultSeen.set(result.key, result.at);
          window.dispatchEvent(new CustomEvent('landstar-tracking-result', { detail: result }));
        });
        // Freight bills the helper found duplicated in MercuryGate -> a warning banner.
        (Array.isArray(next.duplicateBills) ? next.duplicateBills : []).forEach(duplicate => {
          if (duplicateBillSeen.get(duplicate.bill) === duplicate.at) return;
          duplicateBillSeen.set(duplicate.bill, duplicate.at);
          window.dispatchEvent(new CustomEvent('landstar-duplicate-bill', { detail: duplicate }));
        });
        // Each important-load refresh problem is shown once (Daniel 2026-11-27: the same three
        // warnings came back every 3 seconds after ✕).
        (Array.isArray(next.postingRefresh) ? next.postingRefresh : []).forEach(issue => {
          if (refreshIssueSeen.get(issue.key) === issue.at) return;
          refreshIssueSeen.set(issue.key, issue.at);
          window.dispatchEvent(new CustomEvent('landstar-refresh-issue', { detail: issue }));
        });
      } catch {
        if (!cancelled) setStatus(offStatus());
      } finally {
        clearTimeout(timer);
      }
    };
    check();
    const interval = setInterval(check, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);
  const startBot = async () => {
    startRequestedAt.current = Date.now();
    setStatus({ state: 'starting', message: 'Opening the bot window…' });
    try {
      const response = await fetch(BOT_START_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'The bot could not be started.');
    } catch (error) {
      startRequestedAt.current = 0;
      setStatus({ state: 'off', message: 'Upload bot is not running' });
      alert(`${error.message || 'The bot could not be started.'}\n\nYou can also double-click "Start Landstar Bot.bat" in the bot folder.`);
    }
  };
  const style = botStatusStyles[status.state] || botStatusStyles.off;
  if (!canStartBotHere()) {
    // Website: this computer's own bot, read-only. Off = not installed or not started here.
    if (status.state === 'off') {
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-xs normal-case tracking-normal" role="status">
          <span className="rounded border border-amber-600 bg-slate-800 px-2.5 py-1 text-amber-200"
            title="No Landstar bot is answering on this computer. Install it with the team setup file, then double-click Start Landstar Bot on the desktop.">
            Bot off on this computer
          </span>
          <span className="text-slate-300">Double-click "Start Landstar Bot" on your desktop.</span>
        </span>
      );
    }
    const detail = describeBotProgress(status);
    return (
      <span
        className="inline-flex items-center gap-1.5 bg-slate-800 text-white text-xs px-2.5 py-1 rounded font-medium normal-case tracking-normal max-w-full"
        title={[style.label, detail, 'Your Landstar bot on this computer'].filter(Boolean).join(' · ')}
        role="status"
        aria-live="polite"
      >
        <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: style.dot, boxShadow: style.glow, display: 'inline-block' }} />
        {style.label}
        {detail && <span className="text-slate-300 font-normal truncate max-w-[22rem]">· {detail}</span>}
      </span>
    );
  }
  const clickable = status.state === 'off' && canStartBotHere();
  const dot = (
    <span
      aria-hidden="true"
      style={{ width: 10, height: 10, borderRadius: '50%', background: style.dot, boxShadow: style.glow, display: 'inline-block' }}
    />
  );
  if (clickable) {
    return (
      <span className="inline-flex items-center gap-1.5 max-w-full">
      <LocalBotsSwitch />
      <button
        type="button"
        onClick={startBot}
        className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs px-2.5 py-1 rounded font-medium normal-case tracking-normal cursor-pointer border border-slate-600"
        title="The upload bot is off. Click to start it (a bot window opens; log in to Landstar if asked)."
      >
        {dot}
        Bot off · Start bot
      </button>
      <RateWorkerLight />
      </span>
    );
  }
  const detail = status.state === 'off' ? '' : describeBotProgress(status);
  return (
    <span className="inline-flex items-center gap-1.5 max-w-full">
      <LocalBotsSwitch />
      <span
        className="inline-flex items-center gap-1.5 bg-slate-800 text-white text-xs px-2.5 py-1 rounded font-medium normal-case tracking-normal max-w-full"
        title={[style.label, detail].filter(Boolean).join(' · ') || status.message}
        role="status"
        aria-live="polite"
      >
        {dot}
        {style.label}
        {detail && <span className="text-slate-300 font-normal truncate max-w-[22rem]">· {detail}</span>}
      </span>
      {status.helper && <HelperBotLight helper={status.helper} />}
      <RateWorkerLight />
      {status.removal && (
        <span
          role="status"
          title={status.removal.message}
          className="inline-flex items-center bg-slate-800 text-white text-xs px-2.5 py-1 rounded"
        >
          Removals: {status.removal.state === 'off' ? 'off' : status.removal.message}
        </span>
      )}
    </span>
  );
}

// The bot light's progress line: files uploaded / still waiting, and what the bot is on.
// "Rate-checking R_X_O_2429200___ATZ_9of108" -> "12 uploaded · 94 waiting · Rate-checking file 9 of 108"
function describeBotProgress(status) {
  const parts = [];
  const progress = status?.progress;
  if (progress && (progress.uploaded > 0 || progress.waiting > 0)) {
    parts.push(`${progress.uploaded} uploaded`);
    if (progress.waiting > 0) parts.push(`${progress.waiting} waiting`);
  }
  // Export file names end in "_26of108": show that as "file 26 of 108".
  const message = String(status?.message || '').trim().replace(/\S*?(\d+)of(\d+)\b/, 'file $1 of $2');
  if (/^(Rate-checking|Uploading|Removing|Checking|Waiting for the rate worker|Uploads paused)/i.test(message)) parts.push(message);
  return parts.join(' · ');
}

// A value that changes often, kept outside a component's state. Only components that
// subscribe redraw, and an unchanged value notifies no one.
function createStatusStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set: next => {
      if (JSON.stringify(next) === JSON.stringify(value)) return;
      value = next;
      listeners.forEach(listener => listener(value));
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

// Load cards drawn at a time in the load list (more appear as you scroll).
const LOAD_LIST_PAGE = 100;

// ⚙ My Settings → Background brightness, saved on this computer.
applyBackgroundBrightness(readBackgroundBrightness());

export default function App({ sharing = null, userId = null } = {}) {
  const [brokers, setBrokers] = useState(() => {
    try {
      return normalizeBrokerList(JSON.parse(localStorage.getItem('landstar_brokers')));
    } catch (error) {
      console.error('Could not load saved customer names:', error);
      return normalizeBrokerList(null);
    }
  });
  
  const [selectedBroker, setSelectedBroker] = useState(() => {
    try {
      const savedBrokers = JSON.parse(localStorage.getItem('landstar_brokers'));
      return normalizeBrokerList(savedBrokers)[0] || 'Para 1522166 - ATZ';
    } catch (error) {
      console.error('Could not load the selected customer:', error);
      return 'Para 1522166 - ATZ';
    }
  });
  
  const [customerOrdersMap, setCustomerOrdersMap] = useState(() => {
    try {
      return removeExpiredExportedLoads(
        normalizeCustomerOrders(JSON.parse(localStorage.getItem('landstar_customerOrdersMap')))
      );
    } catch (error) {
      console.error('Could not load saved customer loads:', error);
      return defaultCustomerDatasets;
    }
  });
  const [laneRates, setLaneRates] = useState(() => {
    try {
      const savedRates = JSON.parse(localStorage.getItem('landstar_laneRates'));
      return savedRates && typeof savedRates === 'object' && !Array.isArray(savedRates) ? savedRates : {};
    } catch (error) {
      console.error('Could not load saved lane rates:', error);
      return {};
    }
  });
  const [rateHistory, setRateHistory] = useState(() => readRateHistory());

  // One-time seed: pre-existing saved lane rates become undated history entries.
  useEffect(() => {
    if (rateHistory.length || localStorage.getItem(rateHistoryKey)) return;
    const seeded = seedRateHistoryFromLaneRates(laneRates);
    if (!seeded.length) return;
    try {
      writeSyncedKey(rateHistoryKey, JSON.stringify(seeded));
    } catch (error) {
      console.error('Could not save rate history:', error);
    }
    setRateHistory(seeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [exportedLoadRegistry, setExportedLoadRegistry] = useState(() => {
    try {
      const savedRegistry = JSON.parse(localStorage.getItem('landstar_exportedLoads'));
      return savedRegistry && typeof savedRegistry === 'object' && !Array.isArray(savedRegistry)
        ? savedRegistry
        : {};
    } catch (error) {
      console.error('Could not load previously exported load records:', error);
      return {};
    }
  });
  
  const orders = customerOrdersMap[selectedBroker] || [];
  const [selectedOrder, setSelectedOrder] = useState(() => orders[0] || null);

  const [filter, setFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadFilters, setLoadFilters] = useState({ rate: '', minMiles: '', maxMiles: '', pickupState: '', deliveryState: '', pickupDate: '', posting: '' });
  const [laneSort, setLaneSort] = useState('');
  // An RXO order export (loads other agents booked: it has the carrier's line haul pay) is not a
  // load list. 📂 Import Excel sends it here and it becomes the 🔥 hot lanes instead.
  const readOrderExportRows = async file => {
    const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: false });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { raw: false, defval: '' });
    const columns = rows[0] || {};
    return ['Origin - City', 'Destination - City', 'Carrier Line Haul Pay Current'].every(name => name in columns) ? rows : null;
  };
  // Reports as a TMS notice (also for Google Chat copies, LANDJA18 "this is whats been booked
  // this week", 2026-11-27).
  const importHotLanes = (rows, file) => {
    try {
      const built = buildHotLanes(rows);
      const laneCount = Object.keys(built.lanes).length;
      if (!laneCount) {
        notify('No lanes found in this file.');
        return;
      }
      const saved = { ...built, file: file.name, importedAt: new Date().toISOString() };
      localStorage.setItem(hotLanesKey, JSON.stringify(saved));
      setHotLanes(saved);
      const loads = Object.values(customerOrdersMap || {}).flat().filter(load => getHotLane(load, saved));
      notify(`🔥 ${laneCount} hot lanes saved from ${built.rows} loads booked by other agents.\n\n`
        + `${loads.length} of your loads are on a hot lane right now. They show a 🔥 HOT LANE badge and sit at the top of the list (under ⭐ IMPORTANT loads).\n\n`
        + 'Importing a newer export with 📂 Import Excel replaces these lanes.');
    } catch (error) {
      notify(`Could not read the hot lanes file: ${error.message}`);
    }
  };
  const [showTools, setShowTools] = useState(true);
  const [showCustomers, setShowCustomers] = useState(true);
  const [showHeader, setShowHeader] = useState(true);
 
  const [isAddingBroker, setIsAddingBroker] = useState(false);
  const [newBrokerInput, setNewBrokerInput] = useState('');
 
  const [editingBroker, setEditingBroker] = useState(null);
  const [editBrokerInput, setEditBrokerInput] = useState('');

  const [selectedIds, setSelectedIds] = useState([]);
  // 🔥 Hot lanes: lanes other agents are booking (from an RXO order export). Synced across computers.
  // Your own import or the team's (shared by the owner, src/lib/teamData.js), whichever is newer.
  const readHotLanes = () => {
    const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
    return newerHotLanes(read(hotLanesKey), read(teamHotLanesKey));
  };
  const [hotLanes, setHotLanes] = useState(readHotLanes);
  const [exportErrorIds, setExportErrorIds] = useState([]);
  const [isImportingScreenshot, setIsImportingScreenshot] = useState(false);
  const [screenshotImportMode, setScreenshotImportMode] = useState('');
  const [screenshotImportProgress, setScreenshotImportProgress] = useState('');
  const [isGmailImportOpen, setIsGmailImportOpen] = useState(false);
  // Paste Text List box: null = closed, else the pasted text.
  const [textImport, setTextImport] = useState(null);
  const [gmailClientId, setGmailClientId] = useState(() => {
    try {
      return localStorage.getItem('landstar_gmailClientId') || '';
    } catch (error) {
      console.error('Could not load the saved Google client ID:', error);
      return '';
    }
  });
  const [gmailQuery, setGmailQuery] = useState('');
  const [gmailAuthReady, setGmailAuthReady] = useState(false);
  const [gmailImportProgress, setGmailImportProgress] = useState('');
  const [storageError, setStorageError] = useState('');
  const [profile, setProfile] = useState(getUserProfile);
  const [profileDraft, setProfileDraft] = useState(null);
  const [sharedCustomers, setSharedCustomers] = useState(() => sharing?.getSharedCustomers() || {});
  const [shareCustomerName, setShareCustomerName] = useState(null);
  const [teammates, setTeammates] = useState([]);
  const [shareSelection, setShareSelection] = useState([]);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  // Keep these last: tests address earlier state hooks by position.
  const [view, setView] = useState('loads');
  const [clock, setClock] = useState(() => Date.now());
  const [inquiries, setInquiries] = useState([]);
  const [showInquiries, setShowInquiries] = useState(false);
  const [locationData, setLocationData] = useState(null);

  const getLatestExportedRegistry = () => {
    try {
      const storedRegistry = JSON.parse(localStorage.getItem('landstar_exportedLoads'));
      return storedRegistry && typeof storedRegistry === 'object' && !Array.isArray(storedRegistry)
        ? storedRegistry
        : exportedLoadRegistry;
    } catch (error) {
      console.error('Could not read the latest exported-load history:', error);
      return exportedLoadRegistry;
    }
  };

  const persistAppData = (nextBrokers = brokers, nextOrders = customerOrdersMap) => {
    try {
      initSyncGuardFromStorage();
      const versions = readDataVersions();
      const brokersStale = (versions.landstar_brokers || 0) > (lastSavedVersions.landstar_brokers || 0);
      const ordersStale = (versions.landstar_customerOrdersMap || 0) > (lastSavedVersions.landstar_customerOrdersMap || 0);
      if (brokersStale || ordersStale) {
        // Another tab or device saved newer data since this tab's state was last synced.
        // Adopt it instead of overwriting it with this tab's older state.
        setStorageError('Newer data was saved from another tab or device, so the list was refreshed.');
        if (reloadSavedDataFn) reloadSavedDataFn();
        return true;
      }
      const brokersValue = JSON.stringify(nextBrokers);
      const ordersValue = JSON.stringify(nextOrders);
      localStorage.setItem('landstar_brokers', brokersValue);
      localStorage.setItem('landstar_customerOrdersMap', ordersValue);
      const nextVersions = {
        ...versions,
        landstar_brokers: (versions.landstar_brokers || 0) + 1,
        landstar_customerOrdersMap: (versions.landstar_customerOrdersMap || 0) + 1
      };
      localStorage.setItem(dataVersionKey, JSON.stringify(nextVersions));
      lastSavedValues.landstar_brokers = brokersValue;
      lastSavedValues.landstar_customerOrdersMap = ordersValue;
      lastSavedVersions.landstar_brokers = nextVersions.landstar_brokers;
      lastSavedVersions.landstar_customerOrdersMap = nextVersions.landstar_customerOrdersMap;
      setStorageError('');
      return true;
    } catch (error) {
      console.error('Could not save customer loads in this browser:', error);
      setStorageError('Could not save changes in this browser. Keep this page open and check available storage.');
      return false;
    }
  };

  useEffect(() => {
    persistAppData();
  }, [brokers, customerOrdersMap]);

  useEffect(() => {
    if (!supabase) return undefined;
    let cancelled = false;
    let applying = false;
    let applyAgain = false;
    const applyEmailLoads = async () => {
      if (applying) {
        applyAgain = true;
        return;
      }
      applying = true;
      try {
        const rows = [];
        let lastId = null;
        while (!cancelled) {
          let query = supabase.from('email_loads').select('id, customer, load')
            .eq('status', 'pending').order('id').limit(100);
          if (lastId !== null) query = query.gt('id', lastId);
          const { data, error } = await query;
          if (error) throw error;
          rows.push(...(data || []));
          if (!data || data.length < 100) break;
          lastId = data[data.length - 1].id;
        }
        if (cancelled || !rows.length) return;
        const latestRates = JSON.parse(localStorage.getItem('landstar_laneRates') || '{}');
        rows.forEach(row => {
          if (!row.load?.id) return;
          const savedRate = getSavedLaneRate(latestRates, row.customer, row.load);
          if (savedRate && (!(Number(row.load.rateInput) > 0) || isDatRateSource(row.load.rateSource))) {
            row.load = { ...row.load, rateInput: savedRate, rateSource: 'user-entered' };
          }
        });
        const emailImportLoads = [];
        rows.forEach(row => {
          if (normalizeCustomerName(row.customer) && row.load?.id) emailImportLoads.push(row.load);
        });
        await applyGoogleRoadMiles(emailImportLoads, null, 'Imported from email');
        if (cancelled) return;
        const fullLists = new Map();
        rows.forEach(row => {
          const customer = normalizeCustomerName(row.customer);
          if (!customer || !row.load?.id) return;
          getImportedLoadKey(row.load);
          const loads = fullLists.get(customer) || [];
          loads.push(row.load);
          fullLists.set(customer, loads);
        });
        setCustomerOrdersMap(current => {
          const next = { ...current };
          fullLists.forEach((loads, customer) => {
            const replacement = replaceImportedCustomerLoads(customer, loads, current[customer] || []);
            next[customer] = replacement.loads;
            // Background import: never asks, so an unusually large drop is skipped instead.
            queueDroppedPostings(replacement, current[customer] || [], { interactive: false });
          });
          return next;
        });
        const validIds = rows.filter(row => normalizeCustomerName(row.customer) && row.load?.id).map(row => row.id);
        if (validIds.length) {
          const { error } = await supabase.from('email_loads').update({ status: 'applied' }).in('id', validIds);
          if (error) throw error;
        }
      } catch (error) {
        console.error('Automatic email load import failed:', error);
        if (!cancelled) setStorageError(`Automatic email import failed: ${error.message || 'Could not update the load list.'}`);
      } finally {
        applying = false;
        if (applyAgain && !cancelled) {
          applyAgain = false;
          applyEmailLoads();
        }
      }
    };
    applyEmailLoads();
    const channel = supabase.channel('email-loads-apply')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'email_loads' }, applyEmailLoads)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  // App only mounts after sign-in (or in local mode), so this greets each agent on login.
  useEffect(() => {
    speakWelcomeGreeting(getUserProfile().postingCode);
  }, []);

  useEffect(() => {
    const cleanupExpiredLoads = () => {
      setCustomerOrdersMap(current => removeExpiredExportedLoads(current));
    };
    const interval = window.setInterval(cleanupExpiredLoads, 60 * 60 * 1000);
    window.addEventListener('focus', cleanupExpiredLoads);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', cleanupExpiredLoads);
    };
  }, []);

  useEffect(() => {
    if (!isGmailImportOpen) return undefined;
    let active = true;
    setGmailAuthReady(false);
    setGmailImportProgress('Loading Google authorization...');
    loadGoogleIdentityScript()
      .then(() => {
        if (active) {
          setGmailAuthReady(true);
          setGmailImportProgress('');
        }
      })
      .catch(error => {
        console.error('Could not initialize Google authorization:', error);
        if (active) setGmailImportProgress(error.message);
      });
    return () => {
      active = false;
    };
  }, [isGmailImportOpen]);

  useEffect(() => {
    if (orders.length > 0) {
      if (!selectedOrder || !orders.some(o => o.id === selectedOrder.id)) {
        setSelectedOrder(orders[0]);
      }
    } else {
      setSelectedOrder(null);
    }
  }, [selectedBroker, customerOrdersMap]);

  const handleSelectBroker = (brokerName) => {
    setSelectedBroker(brokerName);
    const brokerLoads = customerOrdersMap[brokerName] || [];
    if (brokerLoads.length > 0) {
      setSelectedOrder(brokerLoads[0]);
    } else {
      setSelectedOrder(null);
    }
    setSelectedIds([]);
  };

  const handleInputChange = (field, value) => {
    if (!selectedOrder) return;
    if (field === 'id' && orders.some(order => order.id !== selectedOrder.id
      && normalizeLoadId(order.id) === normalizeLoadId(value))) {
      notify(`Load #${value} already exists in ${selectedBroker}. The order number was not changed.`);
      return;
    }
    let updatedOrder = { ...selectedOrder, [field]: value };
    if (['origCity', 'origSt', 'origZip', 'destCity', 'destSt', 'destZip'].includes(field)) {
      updatedOrder = applyLocationInput(selectedOrder, field, value, locationData);
    }
    if (field === 'miles') updatedOrder.milesSource = 'manual';
    if (field === 'driverPhone') updatedOrder = moveToOfferWithDriverPhone(updatedOrder);
    if (field === 'eCode' && isTeamEquipment(selectedOrder.eCode)) {
      updatedOrder.team = 'true';
    }
    if (field === 'rateInput') {
      if (String(value).trim()) {
        updatedOrder.rateSource = 'user-entered';
      } else {
        delete updatedOrder.rateSource;
      }
      const laneRateKey = createLaneRateKey(selectedBroker, updatedOrder);
      const numericRate = Number(String(value).replace(/[$,]/g, ''));
      if (laneRateKey && numericRate > 0 && Number.isFinite(numericRate)) {
        const nextLaneRates = { ...laneRates, [laneRateKey]: String(numericRate) };
        setLaneRates(nextLaneRates);
        setRateHistory(recordRateHistory(selectedBroker, updatedOrder, numericRate, 'manual'));
        try {
          writeSyncedKey('landstar_laneRates', JSON.stringify(nextLaneRates));
        } catch (error) {
          console.error('Could not save lane rate:', error);
          setStorageError('Could not save lane rates in this browser. Check available storage.');
        }
      }
      if (numericRate > 0 && Number.isFinite(numericRate)) {
        setSelectedIds(previousIds => (
          previousIds.includes(updatedOrder.id) ? previousIds : [...previousIds, updatedOrder.id]
        ));
      }
    } else if (['origCity', 'origSt', 'origZip', 'destCity', 'destSt', 'destZip', 'eCode'].includes(field)) {
      const savedRate = getSavedLaneRate(laneRates, selectedBroker, updatedOrder);
      if (savedRate) {
        updatedOrder.rateInput = savedRate;
        updatedOrder.rateSource = 'user-entered';
      } else {
        updatedOrder.rateInput = '';
        delete updatedOrder.rateSource;
      }
    }
    // A rate changed by hand (or by a lane change) is no longer the bot's raise: drop the badge.
    if (updatedOrder.rateInput !== selectedOrder.rateInput) delete updatedOrder.rateRaise;

    setSelectedOrder(updatedOrder);
    setCustomerOrdersMap(prev => ({
      ...prev,
      [selectedBroker]: (prev[selectedBroker] || []).map(o => o.id === selectedOrder.id ? updatedOrder : o)
    }));
    if (field === 'id') {
      setSelectedIds(ids => ids.map(id => id === selectedOrder.id ? updatedOrder.id : id));
    }
  };

  const handleOpenDatRateView = async () => {
    if (!selectedOrder) return;
    const origin = [selectedOrder.origCity, selectedOrder.origSt, selectedOrder.origZip].filter(Boolean).join(', ');
    const destination = [selectedOrder.destCity, selectedOrder.destSt, selectedOrder.destZip].filter(Boolean).join(', ');
    const equipment = getEquipmentDescription(selectedOrder.eCode) || selectedOrder.eCode || 'Not specified';
    const laneDetails = [
      `Customer: ${selectedBroker}`,
      `Origin: ${origin || 'Not specified'}`,
      `Destination: ${destination || 'Not specified'}`,
      `Equipment: ${equipment}`,
      `Pickup: ${selectedOrder.pickupTime || selectedOrder.puDate || 'Not specified'}`,
      `Weight: ${selectedOrder.weight || 'Not specified'}`,
      `Order #: ${selectedOrder.id || 'Not specified'}`
    ].join('\n');

    window.open('https://iq.dat.com/rateview', '_blank', 'noopener,noreferrer');

    try {
      await navigator.clipboard.writeText(laneDetails);
    } catch (error) {
      console.error('Could not copy the RateView lane details to the clipboard:', error);
    }
  };

  const handleOpenLandstarLoads = async () => {
    if (!selectedOrder) return;
    window.open('https://www.landstaronline.com/loads/', '_blank', 'noopener,noreferrer');

    const laneDetails = [
      `Origin: ${[selectedOrder.origCity, selectedOrder.origSt, selectedOrder.origZip].filter(Boolean).join(', ')}`,
      `Destination: ${[selectedOrder.destCity, selectedOrder.destSt, selectedOrder.destZip].filter(Boolean).join(', ')}`
    ].join('\n');

    try {
      await navigator.clipboard.writeText(laneDetails);
      notify('Landstar Loads opened. Origin and destination details are copied; paste them into the matching fields.');
    } catch (error) {
      console.error('Could not copy the Landstar origin and destination details:', error);
      notify('Landstar Loads opened, but the lane details could not be copied. Check clipboard permissions and try again.');
    }
  };

  const saveLoad = updatedOrder => {
    setSelectedOrder(updatedOrder);
    setCustomerOrdersMap(prev => ({
      ...prev,
      [selectedBroker]: (prev[selectedBroker] || []).map(o => o.id === updatedOrder.id ? updatedOrder : o)
    }));
  };

  const confirmRemoveCapacity = load => window.confirm(
    `Remove ${String(load.driver || '').trim() || 'the truck'} from load #${load.id} and move it back to OPEN?\n\n`
    + 'The driver, phone, truck, trailer, pickup ETA and tracking are cleared. The rate and load details stay. This load is marked IMPORTANT / NEEDS CAPACITY and protected from missing-list removal. The local posting bot will attempt a refresh every 15 minutes while it is available and the pickup window is still open.'
  );

  const handleRemoveCapacity = () => {
    if (!selectedOrder || !confirmRemoveCapacity(selectedOrder)) return;
    dropBookingLogEntry(selectedBroker, selectedOrder.id);
    saveLoad(removeCapacity(selectedOrder));
  };

  // The booking fell through: it comes off the 📊 Bookings report too.
  const dropBookingLogEntry = (customer, loadId) => {
    try {
      const log = JSON.parse(localStorage.getItem(bookingLogKey) || '[]');
      localStorage.setItem(bookingLogKey, JSON.stringify(removeBookingEntry(log, customer, loadId)));
    } catch (error) {
      console.error('Could not update the booking log:', error);
    }
  };

  // ⭐ Needs capacity: flags a pre-booked load that still needs a truck. The star shows on
  // the load card until you turn it off (or book the load). Imports keep the flag.
  const handleToggleNeedsCapacity = () => {
    if (!selectedOrder) return;
    const next = { ...selectedOrder };
    if (String(next.needsCapacity || '').trim()) delete next.needsCapacity;
    else next.needsCapacity = 'true';
    saveLoad(next);
  };

  // Booking also sends the truck to the bot, which assigns it on Landstar (Assign Capacity).
  const handleBookLoad = () => {
    if (!selectedOrder) return;
    let booked;
    try {
      booked = bookLoad(selectedOrder);
    } catch (error) {
      notify(error.message);
      return;
    }
    rememberCapacity(booked);
    const request = buildAssignRequest(selectedBroker, booked);
    if (request.item) {
      saveLoad(booked);
      addToAssignQueue(request.item);
      void sendAssignQueueToBot();
    } else {
      const line = `Landstar: not assigned automatically - ${request.reason} Assign it by hand.`;
      saveLoad({ ...booked, notes: booked.notes ? `${booked.notes}\n${line}` : line });
      notify(`Booked in the TMS only. ${line}`);
    }
  };

  // Typing or picking a known driver fills in their phone, truck and trailer
  // (only into boxes that are still empty).
  const handleDriverChange = value => {
    if (!selectedOrder) return;
    const known = findKnownDriver(driverDirectory, value);
    let updatedOrder = { ...selectedOrder, driver: value };
    if (known) {
      ['driverPhone', 'truck', 'trailer'].forEach(field => {
        if (!String(selectedOrder[field] || '').trim() && known[field]) updatedOrder[field] = known[field];
      });
      if (updatedOrder.driverPhone !== selectedOrder.driverPhone) {
        updatedOrder = moveToOfferWithDriverPhone(updatedOrder);
      }
    }
    saveLoad(updatedOrder);
  };

  // Truck # (Daniel 2026-11-27): a truck saved with its driver fills the empty driver boxes.
  const handleTruckChange = value => {
    if (!selectedOrder) return;
    const saved = lookupTruck(profile.truckBook, value)
      || driverDirectory.drivers.find(entry => entry.truck && truckKey(entry.truck) === truckKey(value)) || null;
    let { load: next } = fillFromTruck({ ...selectedOrder, truck: value }, saved);
    if (next.driverPhone !== selectedOrder.driverPhone) next = moveToOfferWithDriverPhone(next);
    saveLoad(next);
  };

  // Carrier loads: who hauls it (BCO truck or an outside carrier), the carrier's name and MC #.
  // Back to BCO clears the MC # (with an MC # the bot assigns the load to that carrier).
  const setCapacityType = type => {
    if (!selectedOrder) return;
    saveLoad(type === 'carrier'
      ? { ...selectedOrder, capacityType: 'carrier' }
      : { ...selectedOrder, capacityType: 'bco', carrierMc: '' });
  };
  const handleCarrierMcChange = value => {
    if (!selectedOrder) return;
    const saved = lookupCarrier(profile.carrierBook, value);
    saveLoad({ ...selectedOrder, carrierMc: value, ...(saved && !String(selectedOrder.carrierName || '').trim() ? { carrierName: saved.name } : {}) });
  };
  const handleCarrierNameChange = value => {
    if (!selectedOrder) return;
    const saved = Object.values(profile.carrierBook || {}).find(entry => entry.name.toUpperCase() === String(value).trim().toUpperCase());
    saveLoad({ ...selectedOrder, carrierName: value, ...(saved && !getCarrierMc(selectedOrder) ? { carrierMc: saved.mc } : {}) });
  };

  // Calculate city-to-city driving miles after location editing stops.
  useEffect(() => {
    const order = selectedOrder;
    if (!order || Number(normalizeMilesValue(order.miles)) > 0) return undefined;
    const originZip = String(order.origZip || '').trim();
    const destZip = String(order.destZip || '').trim();
    if (![order.origCity, order.origSt, order.destCity, order.destSt].every(value => String(value || '').trim())) return undefined;
    const routeOrder = { ...order, origZip: '', destZip: '' };
    const laneKey = getRoadMilesLaneKey(routeOrder);
    const customer = selectedBroker;
    let cancelled = false;
    const timer = setTimeout(async () => {
      let miles = '';
      let note = '';
      try {
        miles = await getGoogleRoadMiles(routeOrder);
        note = 'city-to-city driving miles calculated by Google Routes';
      } catch (error) {
        try {
          const zipModule = await import('zipcodes');
          miles = estimateRoadMilesFromZips(zipModule.default || zipModule, originZip, destZip);
          note = 'miles estimated from the ZIPs (Google Routes unavailable); check before posting';
        } catch (zipError) {
          console.error('Could not estimate miles from the ZIPs:', zipError);
        }
      }
      if (cancelled) return;
      if (!miles) {
        pushNotice(`Could not calculate miles for load ${order.id}. Verify the cities and states or enter miles manually.`);
        return;
      }
      const fill = load => (String(load.id) === String(order.id)
        && !(Number(normalizeMilesValue(load.miles)) > 0)
        && getRoadMilesLaneKey({ ...load, origZip: '', destZip: '' }) === laneKey
        && String(load.origZip || '').trim() === originZip && String(load.destZip || '').trim() === destZip)
        ? { ...load, miles, milesSource: note.startsWith('city-to-city') ? 'google' : 'estimated', planningComment: load.planningComment ? `${load.planningComment}; ${note}` : note }
        : load;
      setCustomerOrdersMap(prev => ({ ...prev, [customer]: (prev[customer] || []).map(fill) }));
      setSelectedOrder(current => (current ? fill(current) : current));
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectedOrder?.id, selectedOrder?.origCity, selectedOrder?.origSt, selectedOrder?.destCity, selectedOrder?.destSt, selectedOrder?.origZip, selectedOrder?.destZip, selectedOrder?.miles, selectedBroker]);

  // ＋ Add Load: a blank load in the selected customer, filled in with the order editor.
  const handleAddManualLoad = () => {
    if (!selectedBroker) {
      notify('Select a customer before adding a load.');
      return;
    }
    const load = createManualLoad();
    handleClearAllFilters();
    setFilter('ALL');
    setSelectedIds([]);
    setView('loads');
    setCustomerOrdersMap(prev => ({ ...prev, [selectedBroker]: [load, ...(prev[selectedBroker] || [])] }));
    setSelectedOrder(load);
  };

  // 📄 Copy Load: a new load in the same customer with this load's details, so a repeat
  // load only needs a new order # and whatever differs.
  const handleCopyLoad = () => {
    if (!selectedOrder || !selectedBroker) return;
    const id = String(window.prompt(`Order # of the new load, copied from #${selectedOrder.id} in ${selectedBroker}:`) || '').trim();
    if (!id) return;
    const existing = orders.find(o => normalizeLoadId(o.id) === normalizeLoadId(id));
    if (existing) {
      notify(`Load #${id} is already in ${selectedBroker}. Pick a different order #.`);
      return;
    }
    const load = copyLoadDetails(selectedOrder, id);
    setCustomerOrdersMap(prev => ({ ...prev, [selectedBroker]: [load, ...(prev[selectedBroker] || [])] }));
    setSelectedOrder(load);
  };

  // 💲 CH Offers (Daniel 2026-11-27): loads checked in the bid list go into CH 593772- ATZ H as
  // loads added by hand (list imports never delete them), so they export to Landstar.
  const chOffersAccount = brokers.find(name => isCh593772Customer(name)
    && normalizeCustomerName(name).toUpperCase().replace(/[^A-Z0-9]/g, '') === CH_TMS_ACCOUNT.toUpperCase().replace(/[^A-Z0-9]/g, '')) || CH_TMS_ACCOUNT;
  const chOffersLoads = customerOrdersMap[chOffersAccount] || [];
  const handleAddChOffersToTms = offers => {
    const existingIds = new Set(chOffersLoads.map(load => normalizeLoadId(load.id)));
    const newLoads = [];
    let already = 0;
    for (const offer of offers) {
      const fields = chOfferToTmsLoad(offer);
      if (existingIds.has(normalizeLoadId(fields.id))) { already += 1; continue; }
      existingIds.add(normalizeLoadId(fields.id));
      newLoads.push(createManualLoad(fields.id, fields));
    }
    if (newLoads.length) {
      if (!brokers.includes(chOffersAccount)) setBrokers(prev => (prev.includes(chOffersAccount) ? prev : [...prev, chOffersAccount]));
      setCustomerOrdersMap(prev => ({ ...prev, [chOffersAccount]: [...newLoads, ...(prev[chOffersAccount] || [])] }));
    }
    return { added: newLoads.length, already };
  };
  const chOffersNewLanes = getTodaysExportedLanes(chOffersLoads);
  const chOffersInTmsKeys = new Set(chOffersLoads.flatMap(load => [load.chOfferKey, String(load.id)]).filter(Boolean));
  const openChOffersLoad = load => {
    handleSelectBroker(chOffersAccount);
    setView('loads');
    setSelectedOrder(load);
  };

  // Every load with a booking date lands in the booking log (and stays there even after
  // the load delivers, drops off a list or is deleted), feeding the 📊 Bookings report.
  // A booking comes off only when you remove capacity or move the load out of BOOKED
  // (dropBookingLogEntry), never because a load here has no booking date: the log syncs
  // across browsers, and one with an older load list would take fresh bookings off.
  useEffect(() => {
    try {
      let log = JSON.parse(localStorage.getItem(bookingLogKey) || '[]');
      let changed = false;
      for (const [customer, loads] of Object.entries(customerOrdersMap || {})) {
        for (const order of loads || []) {
          if (order.bookedAt) {
            const next = addBookingEntry(log, customer, order);
            if (next !== log) {
              log = next;
              changed = true;
            }
          }
        }
      }
      if (changed) localStorage.setItem(bookingLogKey, JSON.stringify(log));
    } catch (error) {
      console.error('Could not update the booking log:', error);
    }
  }, [customerOrdersMap]);

  const handleDelete = () => {
    if (!selectedOrder) return;
    const remaining = orders.filter(o => o.id !== selectedOrder.id);
    setCustomerOrdersMap(prev => ({ ...prev, [selectedBroker]: remaining }));
    if (remaining.length > 0) setSelectedOrder(remaining[0]);
    else setSelectedOrder(null);
  };

  // 🚫 Covered: the customer gave this load away (a driver called, you checked, it's gone).
  // One click queues its Landstar posting for removal by the local bot (same path as loads
  // that drop off an imported list) and deletes the load from the TMS so nothing re-posts it.
  const handleCoveredRemove = () => {
    if (!selectedOrder || !selectedBroker) return;
    const posting = selectedOrder.landstarPosting;
    if (!posting) {
      notify('This load has no saved Landstar posting, so there is nothing to take off the board. If it was posted by hand, remove it on LandstarOnline.');
      return;
    }
    const route = `${selectedOrder.origCity}, ${selectedOrder.origSt} → ${selectedOrder.destCity}, ${selectedOrder.destSt}`;
    const ok = window.confirm(
      `COVERED — load #${selectedOrder.id} (${route})\n\n`
      + 'Its posting comes off the Landstar board (the local bot removes it). The load stays here marked '
      + '⏳ SENT TO REMOVAL BOT, then RMOV once it is off Landstar, and it is never exported again.\n\nRemove it?'
    );
    if (!ok) return;
    addToUnpostQueue([{ customer: selectedBroker, loadId: String(selectedOrder.id), posting }]);
    void sendUnpostQueueToBot();
    saveLoad(markRemovalQueued(selectedOrder, 'covered'));
  };

  const selectionKey = (customer, id) => filter === 'OFFER' ? JSON.stringify([customer, String(id)]) : id;

  const handleToggleSelect = (id, e, customer = selectedBroker) => {
    e.stopPropagation();
    const key = selectionKey(customer, id);
    if (selectedIds.includes(key)) {
      setSelectedIds(selectedIds.filter(item => item !== key));
    } else {
      setSelectedIds([...selectedIds, key]);
    }
  };

  const handleSelectAll = (filteredOrders) => {
    const filteredIds = filter === 'OFFER'
      ? visibleOrderEntries.map(({ customer, order }) => selectionKey(customer, order.id))
      : filteredOrders.map(o => o.id);
    const allSelected = filteredIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(selectedIds.filter(id => !filteredIds.includes(id)));
    } else {
      const combined = Array.from(new Set([...selectedIds, ...filteredIds]));
      setSelectedIds(combined);
    }
  };

  const handleClearAllFilters = () => {
    setSearchQuery('');
    setLoadFilters({ rate: '', minMiles: '', maxMiles: '', pickupState: '', deliveryState: '', pickupDate: '', posting: '' });
    setLaneSort('');
  };

  // After an import: show the imported list itself, not a leftover search, filter or the
  // Booked Loads page (those made fresh imports look like they never arrived).
  const showImportedList = () => {
    handleClearAllFilters();
    setView('loads');
    // The import is done: close the Tools & Customers drawer (even when kept open) so the
    // imported loads are right there (Daniel 2026-11-27).
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof Event === 'function') {
      window.dispatchEvent(new Event('tms-close-drawer'));
    }
  };

  // Paste Text List: a load list written as text (Ryan's Square 2570577 messages) into the
  // selected customer, through the same merge as every other import (src/lib/textLoads.js).
  const handleTextImport = () => {
    if (!selectedBroker) {
      notify('Pick the customer on the left first (for example Square 2570577), then import.');
      return;
    }
    const { loads, problems } = parseTextLoadList(textImport || '', { source: `${selectedBroker} text list` });
    const problemText = problems.length ? `\n\nNot imported (fix and paste again):\n• ${problems.join('\n• ')}` : '';
    if (!loads.length) {
      notify(`No loads found. Each load needs a "City, ST ZIP → City, ST ZIP" line, then its weight, Ref # and DEL date.${problemText}`);
      return;
    }
    try {
      const existingOrders = customerOrdersMap[selectedBroker] || [];
      const replacement = replaceImportedCustomerLoads(selectedBroker, loads, existingOrders);
      queueDroppedPostings(replacement, existingOrders);
      const nextOrders = { ...customerOrdersMap, [selectedBroker]: replacement.loads };
      const saved = persistAppData(brokers, nextOrders);
      setCustomerOrdersMap(nextOrders);
      setSelectedIds(getImportedLoadSelection(selectedBroker, replacement.processedLoads));
      showImportedList();
      setFilter('OPEN');
      setTextImport(null);
      notify(
        `📋 Text list imported into ${selectedBroker}:\n`
        + `• Loads read: ${loads.length}\n`
        + `• Total in list: ${replacement.loads.length}\n`
        + getImportReplacementMessage(replacement)
        + '• Pickup days are estimated from the delivery date and miles (see each load\'s notes): confirm them before exporting.\n'
        + '• No rates were in the list: add yours before exporting.'
        + problemText
        + (saved ? '' : '\n\nWarning: saving failed, check browser storage.')
      );
    } catch (error) {
      notify(`Text import failed: ${error.message}`);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    if (window.confirm(`Are you sure you want to delete ${selectedIds.length} selected loads?`)) {
      const remaining = orders.filter(o => !selectedIds.includes(selectionKey(selectedBroker, o.id)));
      setCustomerOrdersMap(prev => Object.fromEntries(Object.entries(prev).map(([customer, loads]) => [
        customer, filter === 'OFFER' || customer === selectedBroker
          ? loads.filter(o => !selectedIds.includes(selectionKey(customer, o.id))) : loads
      ])));
      setSelectedIds([]);
      if (remaining.length > 0) setSelectedOrder(remaining[0]);
      else setSelectedOrder(null);
    }
  };

  const handleStatusChange = (newStatus) => {
    if (!selectedOrder) return;
    const updatedOrder = {
      ...selectedOrder,
      status: newStatus,
      tag: getStatusTag(newStatus)
    };
    if (newStatus !== 'BOOKED') {
      if (selectedOrder.bookedAt) dropBookingLogEntry(selectedBroker, selectedOrder.id);
      delete updatedOrder.bookedAt;
    }
    setSelectedOrder(updatedOrder);
    setCustomerOrdersMap(prev => ({
      ...prev,
      [selectedBroker]: prev[selectedBroker].map(o => o.id === updatedOrder.id ? updatedOrder : o)
    }));
  };

  const handleMoveSelected = (newStatus) => {
    if (selectedIds.length === 0) return;
    const tag = getStatusTag(newStatus);
    setCustomerOrdersMap(prev => Object.fromEntries(Object.entries(prev).map(([customer, loads]) => [
      customer, filter === 'OFFER' || customer === selectedBroker
        ? loads.map(o => selectedIds.includes(selectionKey(customer, o.id)) ? { ...o, status: newStatus, tag } : o)
        : loads
    ])));
    setSelectedOrder(current => (
      current && selectedIds.includes(selectionKey(selectedBroker, current.id)) ? { ...current, status: newStatus, tag } : current
    ));
  };

  const copyToClipboard = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error(`Could not copy ${label} to the clipboard:`, error);
    }
  };

  useEffect(() => {
    const complete = addCustomersWithLoads(brokers, customerOrdersMap);
    if (complete !== brokers) setBrokers(complete);
  }, [brokers, customerOrdersMap]);

  // Picks up changes saved from another browser or by teammates on shared customers.
  // Only keys whose stored value actually changed are adopted, so an unrelated sync
  // event (e.g. a lane-rate update) never replaces the load list being worked on.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const reloadSavedData = event => {
      const fromCloud = event?.type === 'landstar-data-changed';
      // 🔥 Hot lanes imported on another computer arrive with the cloud sync too.
      if (fromCloud) setHotLanes(readHotLanes());
      let values;
      try {
        values = {
          landstar_brokers: localStorage.getItem('landstar_brokers'),
          landstar_customerOrdersMap: localStorage.getItem('landstar_customerOrdersMap'),
          landstar_laneRates: localStorage.getItem('landstar_laneRates'),
          landstar_rateHistory: localStorage.getItem('landstar_rateHistory'),
          landstar_exportedLoads: localStorage.getItem('landstar_exportedLoads'),
          landstar_profile: localStorage.getItem('landstar_profile')
        };
      } catch (error) {
        console.error('Could not load the latest saved data:', error);
        return;
      }
      initSyncGuardFromStorage();
      const versions = readDataVersions();
      const changedKeys = getChangedSyncedKeys(values);
      const adopted = {};
      const { adopt, heal } = classifyChangedSyncedKeys(changedKeys, versions, fromCloud);
      // A same-browser load-list change without a version bump came from an outdated
      // app version or a stale tab; keep this tab's newer list and restore it instead.
      if (heal) scheduleUnversionedLoadListHeal();
      // A missing value is never adopted: an empty slot would otherwise load the
      // sample loads over the real list.
      adopt.forEach(key => { if (values[key] !== null) adopted[key] = values[key]; });
      // Track version bumps that arrived without content changes.
      markStorageAdopted({});
      if (!Object.keys(adopted).length) return;
      let nextBrokers;
      let nextOrders;
      let nextRates;
      let nextRateHistory;
      let nextRegistry;
      let brokerList;
      let ordersMap;
      try {
        if ('landstar_brokers' in adopted) {
          nextBrokers = normalizeBrokerList(JSON.parse(adopted.landstar_brokers));
        }
        if ('landstar_customerOrdersMap' in adopted) {
          nextOrders = removeExpiredExportedLoads(normalizeCustomerOrders(JSON.parse(adopted.landstar_customerOrdersMap)));
        }
        if ('landstar_laneRates' in adopted) {
          const savedRates = JSON.parse(adopted.landstar_laneRates);
          nextRates = savedRates && typeof savedRates === 'object' && !Array.isArray(savedRates) ? savedRates : {};
        }
        if ('landstar_rateHistory' in adopted) {
          const savedHistory = JSON.parse(adopted.landstar_rateHistory);
          nextRateHistory = Array.isArray(savedHistory) ? savedHistory : [];
        }
        if ('landstar_exportedLoads' in adopted) {
          const savedRegistry = JSON.parse(adopted.landstar_exportedLoads);
          nextRegistry = savedRegistry && typeof savedRegistry === 'object' && !Array.isArray(savedRegistry) ? savedRegistry : {};
        }
        if (nextBrokers || nextOrders) {
          brokerList = nextBrokers || normalizeBrokerList(JSON.parse(values.landstar_brokers));
          ordersMap = nextOrders || removeExpiredExportedLoads(normalizeCustomerOrders(JSON.parse(values.landstar_customerOrdersMap)));
        }
      } catch (error) {
        console.error('Could not load the latest saved data:', error);
        return;
      }
      markStorageAdopted(adopted);
      if (nextBrokers) setBrokers(nextBrokers);
      if (nextOrders) setCustomerOrdersMap(nextOrders);
      if (nextRates) setLaneRates(nextRates);
      if (nextRateHistory) setRateHistory(nextRateHistory);
      if (nextRegistry) setExportedLoadRegistry(nextRegistry);
      setProfile(getUserProfile());
      if (nextBrokers || nextOrders) {
        const nextSelected = brokerList.includes(selectedBroker) ? selectedBroker : brokerList[0];
        setSelectedBroker(nextSelected);
        setSelectedOrder(current => {
          const loads = ordersMap[nextSelected] || [];
          return (current && loads.find(load => String(load.id) === String(current.id))) || loads[0] || null;
        });
      }
    };
    reloadSavedDataFn = reloadSavedData;
    window.addEventListener('landstar-data-changed', reloadSavedData);
    window.addEventListener('storage', reloadSavedData);
    return () => {
      if (reloadSavedDataFn === reloadSavedData) reloadSavedDataFn = null;
      window.removeEventListener('landstar-data-changed', reloadSavedData);
      window.removeEventListener('storage', reloadSavedData);
    };
  }, [selectedBroker]);

  useEffect(() => (sharing ? sharing.onSharedCustomersChange(setSharedCustomers) : undefined), [sharing]);

  const openProfileSettings = () => setProfileDraft({ ...profile, phone: formatPhone(profile.phone) });
  // The signed-in account bar (bottom right, next to Sign out) opens My Settings through this.
  if (typeof window !== 'undefined') window.__tmsOpenSettings = openProfileSettings;

  const handleSaveProfile = (e) => {
    e.preventDefault();
    const nextProfile = {
      // Kept as they are: ⚙ customer rules and Google Chat list-name answers (set elsewhere).
      customerRules: profile.customerRules || {},
      chatSheetAccounts: profile.chatSheetAccounts || {},
      truckBook: profile.truckBook || {},
      carrierBook: profile.carrierBook || {},
      phone: profileDraft.phone.replace(/\D/g, ''),
      postingCode: profileDraft.postingCode.trim().toUpperCase(),
      visibilityGroup: profileDraft.visibilityGroup.trim().toUpperCase(),
      flag: profileDraft.flag,
      teamLogo: normalizeTeamLogo(profileDraft.teamLogo),
      fuelSurcharge: normalizeFuelSurchargeRates(profileDraft.fuelSurcharge)
    };
    const invalidFuelSurcharge = Object.entries(profileDraft.fuelSurcharge || {})
      .some(([, value]) => String(value ?? '').trim() !== '' && !(Number(String(value).replace(/[$,]/g, '')) > 0));
    if (invalidFuelSurcharge) {
      notify('Fuel surcharge rates must be a positive $/mile number, or blank to skip a region.');
      return;
    }
    if (nextProfile.phone.length !== 10) {
      notify('Enter a 10-digit phone number.');
      return;
    }
    if (!nextProfile.postingCode || !nextProfile.visibilityGroup) {
      notify('Enter your posting code and visibility group.');
      return;
    }
    if (!isValidPostingCode(nextProfile.postingCode)) {
      notify('Posting code must be 10 characters or fewer.');
      return;
    }
    try {
      writeSyncedKey('landstar_profile', JSON.stringify(nextProfile));
    } catch (error) {
      console.error('Could not save My Settings:', error);
      notify('Could not save My Settings. Check available browser storage and try again.');
      return;
    }
    setProfile(nextProfile);
    setProfileDraft(null);
  };

  const openShareDialog = async (customer) => {
    setShareCustomerName(customer);
    setShareSelection([]);
    setShareMessage('Loading teammates…');
    try {
      setTeammates(await sharing.listTeammates());
      setShareMessage('');
    } catch (error) {
      console.error('Could not load teammates:', error);
      setShareMessage(error.message || 'Could not load teammates.');
    }
  };

  const runShareAction = async (action, successMessage) => {
    setShareBusy(true);
    setShareMessage('');
    try {
      await action();
      setShareSelection([]);
      setShareMessage(successMessage);
      return true;
    } catch (error) {
      console.error('Customer sharing failed:', error);
      setShareMessage(error.message || 'Something went wrong. Try again.');
      return false;
    } finally {
      setShareBusy(false);
    }
  };

  const teammateEmail = (userId) => teammates.find(person => person.id === userId)?.email || 'a teammate';

  const toggleShareSelection = (userId) => {
    setShareSelection(current => current.includes(userId)
      ? current.filter(id => id !== userId)
      : [...current, userId]);
  };

  const renderSchedulePicker = field => {
    const parts = parseSchedulePickerParts(selectedOrder?.[field]);
    const update = (side, key, inputValue) => {
      const current = parseSchedulePickerParts(selectedOrder?.[field]);
      const next = { from: current.from || {}, to: current.to || {} };
      next[side] = { ...next[side], [key]: inputValue };
      if (key === 'time' && inputValue && !next[side].date) {
        const other = side === 'from' ? next.to : next.from;
        next[side].date = other.date || new Date().toISOString().slice(0, 10);
      }
      if (!next[side].date && !next[side].time) next[side] = null;
      handleFieldChange(field, formatSchedulePickerParts(next.from, next.to));
    };
    const pickerClass = 'w-full min-w-0 min-h-[48px] bg-[#0b132b] border border-[#1c2541] rounded-lg px-3 py-2 text-base text-white [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-blue-400';
    const scheduleLabel = field === 'pickupTime' ? 'Pickup' : 'Delivery';
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
        {['from', 'to'].map(side => (
          <div key={side} className="min-w-0">
            <span className="block text-sm font-semibold text-gray-300 mb-1">{side === 'from' ? 'From' : 'To'}</span>
            <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-2">
              <input aria-label={`${scheduleLabel} ${side} date`} type="date" value={parts[side]?.date || ''} onChange={e => update(side, 'date', e.target.value)} className={pickerClass} />
              <input aria-label={`${scheduleLabel} ${side} time`} type="time" value={parts[side]?.time || ''} onChange={e => update(side, 'time', e.target.value)} className={pickerClass} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderCopyableField = (label, field) => (
    <div className="min-w-0">
      <button type="button" onClick={() => copyToClipboard(selectedOrder[field] || '', label)} aria-label={`Copy ${label}`} title={`Click to copy the ${label.toLowerCase()}`} className="tms-copy-label">{label}<span aria-hidden="true">⧉</span></button>
      <div className="flex gap-1">
        <input
          type="text"
          aria-label={label}
          list={field === 'origCity' || field === 'destCity' ? `${field}-suggestions` : undefined}
          onFocus={() => {
            if (!locationData) void import('zipcodes').then(module => setLocationData(module.default || module))
              .catch(error => { console.error('Could not load city suggestions:', error); pushNotice('City suggestions could not load. Enter the city, state and ZIP by hand.'); });
          }}
          value={selectedOrder[field] || ''}
          onChange={(e) => handleFieldChange(field, e.target.value)}
          className="min-w-0 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white"
        />
        {(field === 'origCity' || field === 'destCity') && (
          <datalist id={`${field}-suggestions`}>
            {getCitySuggestions(locationData, selectedOrder[field]).map(place => (
              <option key={`${place.city}|${place.state}`} value={`${place.city.toUpperCase()}, ${place.state}`} label={`ZIP ${place.zip}`} />
            ))}
          </datalist>
        )}
      </div>
    </div>
  );

  const handleAddBroker = (e) => {
    e.preventDefault();
    const name = normalizeCustomerName(newBrokerInput);
    if (name && !brokers.includes(name)) {
      const updatedBrokers = [...brokers, name];
      setBrokers(updatedBrokers);
      setCustomerOrdersMap(prev => ({ ...prev, [name]: [] }));
      handleSelectBroker(name);
      setNewBrokerInput('');
      setIsAddingBroker(false);
    }
  };

  const handleSaveEditBroker = (oldName, e) => {
    e.preventDefault();
    if (sharedCustomers[oldName]) {
      notify('This customer is shared, so its name cannot be changed. Use 🤝 Share to stop sharing first.');
      return;
    }
    const newName = normalizeCustomerName(editBrokerInput);
    if (newName && !brokers.includes(newName)) {
      const updatedBrokers = brokers.map(b => b === oldName ? newName : b);
      setBrokers(updatedBrokers);
      
      setCustomerOrdersMap(prev => {
        const copy = { ...prev };
        copy[newName] = copy[oldName];
        delete copy[oldName];
        return copy;
      });

      if (selectedBroker === oldName) {
        setSelectedBroker(newName);
      }
      setEditingBroker(null);
      setEditBrokerInput('');
    }
  };

  const handleDeleteBroker = (brokerToDelete, e) => {
    e.stopPropagation();
    if (sharedCustomers[brokerToDelete]) {
      notify(sharedCustomers[brokerToDelete].isOwner
        ? 'This customer is shared. Use 🤝 Share → Stop sharing before deleting it.'
        : 'This customer is shared with you. Use 🤝 Share → Leave to remove it from your list.');
      return;
    }
    if (brokers.length <= 1) {
      notify("You must keep at least one customer/broker.");
      return;
    }
    if (window.confirm(`Delete customer "${brokerToDelete}"?`)) {
      const updatedBrokers = brokers.filter(b => b !== brokerToDelete);
      setBrokers(updatedBrokers);
      
      setCustomerOrdersMap(prev => {
        const copy = { ...prev };
        delete copy[brokerToDelete];
        return copy;
      });

      if (selectedBroker === brokerToDelete) {
        handleSelectBroker(updatedBrokers[0]);
      }
    }
  };

  const handleGmailImport = async () => {
    if (!gmailAuthReady || !window.google?.accounts?.oauth2) {
      notify(gmailImportProgress || 'Google authorization is still loading. Wait a moment and try again.');
      return;
    }
    if (!gmailClientId.trim()) {
      notify('Enter a Google OAuth Web client ID first. The Gmail setup instructions are shown above the search box.');
      return;
    }
    if (!gmailQuery.trim()) {
      notify('Enter a Gmail search query, such as newer_than:7d or from:loads@example.com.');
      return;
    }

    let accessToken;
    try {
      localStorage.setItem('landstar_gmailClientId', gmailClientId.trim());
      accessToken = await new Promise((resolve, reject) => {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: gmailClientId.trim(),
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          callback: response => {
            if (response.error || !response.access_token) {
              reject(new Error(response.error_description || response.error || 'Google did not grant Gmail read-only access.'));
              return;
            }
            resolve(response.access_token);
          },
          error_callback: error => reject(new Error(error.message || 'Google authorization was cancelled or blocked.'))
        });
        tokenClient.requestAccessToken({ prompt: 'consent' });
      });

      setGmailImportProgress('Searching Gmail...');
      const apiHeaders = { Authorization: `Bearer ${accessToken}` };
      const searchResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(gmailQuery.trim())}&maxResults=1`,
        { headers: apiHeaders }
      );
      if (!searchResponse.ok) {
        throw await getGmailApiError(searchResponse, 'search');
      }
      const searchResult = await searchResponse.json();
      const messages = searchResult.messages || [];
      if (!messages.length) {
        notify('Gmail search found no matching messages.');
        return;
      }

      const parsedLoads = [];
      for (let index = 0; index < messages.length; index += 1) {
        setGmailImportProgress('Reading newest matching email...');
        const messageResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messages[index].id)}?format=full`,
          { headers: apiHeaders }
        );
        if (!messageResponse.ok) {
          throw await getGmailApiError(messageResponse, `message read for ${messages[index].id}`);
        }
        const message = await messageResponse.json();
        const text = getGmailMessageText(message.payload || {}, selectedBroker);
        parsedLoads.push(...parseGmailLoadEmail(text, selectedBroker, laneRates));
      }

      if (!parsedLoads.length) {
        notify('The newest matching email was read, but no load rows could be recognized. Check that the email contains load numbers, origin/destination, weight, and pickup-date headings.');
        return;
      }

      const payerLoads = applyRxoPayerBusinessHours(parsedLoads, selectedBroker);
      const latestRegistry = getLatestExportedRegistry();
      const exportedRecords = getExportedRecordsForCustomer(latestRegistry, selectedBroker);
      const { exportedCount, exportedLoadIds } = countPreviouslyExportedLoads(payerLoads, exportedRecords);
      const { loads: deduplicatedLoads, duplicateCount } = isRxoCustomer(selectedBroker)
        ? removeDuplicateLoadImports(payerLoads)
        : { loads: payerLoads, duplicateCount: 0 };
      const existingOrders = customerOrdersMap[selectedBroker] || [];
      const uniqueLoads = keepPreviouslyExportedLoadsOpen(
        markDifferentScheduleLoadsEnt(deduplicatedLoads, existingOrders, selectedBroker),
        exportedLoadIds,
        selectedBroker
      );
      if (!uniqueLoads.length) {
        notify(`Found ${parsedLoads.length} loads, but they were all duplicates.`);
        return;
      }

      // Auto-fetch DAT rates for Gmail imported loads if missing
      const gmailDatRateError = await applyDatRatesForImport(uniqueLoads, selectedBroker, laneRates, setLaneRates);
      setRateHistory(readRateHistory());

      const { mileageError: mileageCalculationError } = await applyGoogleRoadMiles(
        deduplicatedLoads,
        setGmailImportProgress,
        'Imported from Gmail'
      );

      const resolvedLoads = [];
      uniqueLoads.forEach(load => {
        resolvedLoads.push(assignImportedLoadIdentity(applyPastPickupEntStatus(load, existingOrders), existingOrders, resolvedLoads));
      });
      const merged = new Map(existingOrders.map(load => [String(load.id), load]));
      resolvedLoads.forEach(load => {
        const existingLoad = merged.get(String(load.id));
        const keepsEnt = existingLoad && existingLoad.status === 'ENT' && !isNewDayForExistingLoad(existingLoad, load);
        const wasPreviouslyExported = exportedLoadIds.has(normalizeLoadId(load.id));
        const preserveStatus = preservesImportedLoadStatus(selectedBroker);
        merged.set(String(load.id), existingLoad
          ? {
            ...existingLoad,
            ...load,
            ...(preserveStatus
              ? getReimportedLoadStatus(existingLoad, wasPreviouslyExported)
              : {}),
            ...(!preserveStatus && existingLoad.status !== 'OFFER' && wasPreviouslyExported
              ? { status: 'OPEN', tag: 'OPEN' }
              : !preserveStatus && keepsEnt ? { status: 'ENT', tag: 'ENT' } : {}),
            ...(existingLoad.status === 'OFFER' && !isNewDayForExistingLoad(existingLoad, load)
              ? { status: 'OFFER', tag: 'OFFER' } : {}),
            ...(isNewDayForExistingLoad(existingLoad, load) ? { landstarExportedAt: undefined } : {}),
            miles: load.miles || existingLoad.miles,
            rateInput: load.rateSource === 'customer-bin' ? load.rateInput : existingLoad.rateInput || load.rateInput,
            rateSource: load.rateSource === 'customer-bin' ? load.rateSource : existingLoad.rateSource || load.rateSource
          }
          : load);
      });
      const mergedList = Array.from(merged.values());
      const { loads: mergedFinalLoads, duplicateCount: existingDuplicates } = isRxoCustomer(selectedBroker)
        ? removeDuplicateLoadImports(mergedList)
        : { loads: mergedList, duplicateCount: 0 };
      const replacement = replaceImportedCustomerLoads(selectedBroker, payerLoads, existingOrders);
      queueDroppedPostings(replacement, existingOrders);
      const finalLoads = replacement ? replacement.loads : mergedFinalLoads;
      const nextOrders = { ...customerOrdersMap, [selectedBroker]: finalLoads };
      const saved = persistAppData(brokers, nextOrders);
      setCustomerOrdersMap(nextOrders);
      setSelectedOrder(finalLoads.find(load => load.id === resolvedLoads[0].id) || finalLoads[0]);
      setSelectedIds(getImportedLoadSelection(selectedBroker, replacement?.processedLoads || resolvedLoads));
      showImportedList();
      setFilter('OPEN');
      
      notify(
        `✉️ Gmail Import Complete for ${selectedBroker}:\n` +
        `• Recognized loads: ${parsedLoads.length}\n` +
        `• Unique loads imported: ${replacement ? finalLoads.length : uniqueLoads.length}\n` +
        `• Total in list: ${finalLoads.length}\n` +
        getImportReplacementMessage(replacement) +
        (exportedCount > 0
          ? preservesImportedLoadStatus(selectedBroker)
            ? `• Previously exported; moved to OPEN: ${exportedCount}\n`
            : `• Previously exported; kept OPEN: ${exportedCount}\n`
          : '') +
        (gmailDatRateError ? `• DAT rates could not be fetched; enter rates manually. DAT reported: ${gmailDatRateError}\n` : '') +
        (saved ? '• Status: Saved successfully in browser storage.' : '• Warning: Save failed, check browser storage.')
      );

      if (!saved || mileageCalculationError) notify(`${saved ? '' : 'Saving failed; keep this page open and check browser storage. '}${mileageCalculationError ? `Driving miles were not calculated and remain blank where no prior miles were saved. You can still enter miles manually. Google Routes reported: ${mileageCalculationError}` : ''}`.trim());
    } catch (error) {
      console.error('Gmail load import failed:', error);
      notify(`Gmail import failed: ${error.message || 'Check your Google OAuth client ID, Gmail API setup, and search query.'}`);
    } finally {
      setGmailImportProgress('');
    }
  };

  // One customer's list often comes as several Excel files (or tabs). Pick them all at
  // once: they are combined into one list first, so a Landstar posting is only removed
  // when its load is on none of them. Importing them one at a time treats each file as
  // the whole list and removes the other files' postings. RXO is the exception: its van,
  // flatbed and reefer lists can be uploaded one at a time — an import only replaces the
  // equipment categories in the file (see replaceImportedCustomerLoads).
  // options.quiet: the "Import Complete" summary shows as a TMS notice, not a pop-up (Google
  // Chat imports). Resolves true once the loads are imported and selected.
  const handleExcelImport = (e, options = {}) => {
    let files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;

    const runImport = async () => {
      try {
        // 🔥 Order exports of other agents' bookings become hot lanes, not loads.
        const loadFiles = [];
        for (const file of files) {
          const orderRows = await readOrderExportRows(file);
          if (orderRows) importHotLanes(orderRows, file);
          else loadFiles.push(file);
        }
        if (!loadFiles.length) return;
        files = loadFiles;
        // ⚙ This customer's rules (src/app/customerRules.js): column names, equipment, rates.
        const importRules = getCustomerRules(profile.customerRules, selectedBroker);
        const ruleColumns = importRules.excelColumns;
        const isRxoPayerImport = normalizeCustomerName(selectedBroker) === rxoPayerCustomerName;
        const isRxoImport = isRxoCustomer(selectedBroker);
        // Every data row of every load tab, with that tab's column positions.
        const sheetRows = [];
        let anyRxoDateTimeFormat = false;
        let sheetCount = 0;
        for (const file of files) {
          const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: false });
          for (const sheetName of getLoadSheetNames(workbook, XLSX)) {
            const worksheet = workbook.Sheets[sheetName];
            const rawRows = addMissingPhalanxHeader(XLSX.utils.sheet_to_json(worksheet, { header: 1 }));
            if (rawRows.length <= 1) continue;
            sheetCount += 1;

            const headerRow = rawRows[0] || [];
            const findColIndex = (possibleNames, defaultIdx) => {
              for (let name of possibleNames) {
                const idx = headerRow.findIndex(h => String(h || '').trim().toLowerCase() === name.toLowerCase());
                if (idx !== -1) return idx;
              }
              return defaultIdx;
            };
            // "Early P/U dt" / "Late P/U dt" / "Early del dt" / "Late del dt": the Phalanx list
            // (Pha 882255 - ATZ, Daniel 2026-11-25), dates like "11/30/2026 1200".
            // A column matched in this customer's ⚙ Rules wins over the usual names.
            const ruleCol = (field, names, defaultIdx) => (ruleColumns[field] ? findColIndex([ruleColumns[field]], defaultIdx) : findColIndex(names, defaultIdx));
            const pickupTimeCol = ruleCol('pickup', ['Pickup Date (From)', 'Pickup Time', 'PU Time', 'Early P/U dt'], -1);
            const deliveryTimeCol = ruleCol('delivery', ['Delivery Date (From)', 'Delivery Time', 'Del Time', 'Early del dt'], -1);
            const pickupLateCol = ruleCol('pickupLate', ['Late P/U dt'], -1);
            const deliveryLateCol = ruleCol('deliveryLate', ['Late del dt'], -1);
            const hasRxoTimeColumns = pickupTimeCol >= 0 && deliveryTimeCol >= 0;
            // A list with named city columns but no ZIP columns has no ZIPs: don't read whatever
            // sits in the usual ZIP position (Phalanx has pickup and commodity there).
            const hasNamedCities = Boolean(ruleColumns.origCity) || findColIndex(['Origin City', 'Orig City', 'Origin - City'], -1) >= 0;
            const rateCol = ruleColumns.rate ? findColIndex([ruleColumns.rate], -1)
              : findColIndex(['Early P/U dt'], -1) >= 0 ? findColIndex(['Rate'], -1) : -1;
            const columns = {
              colA: ruleCol('loadId', ['Order #', 'Load ID', 'Order Number', 'Load Posting Code'], 0),
              colB: ruleCol('equipment', ['Equipment', 'Equipment Type', 'Equipment 1', 'Equip', 'Equip type'], 1),
              colG: ruleCol('origCity', ['Origin City', 'Orig City', 'Origin', 'Origin - City'], 6),
              colH: ruleCol('origSt', ['Origin State', 'Origin St', 'Orig State', 'Origin - State'], 7),
              colI: ruleCol('origZip', ['Origin Zipcode', 'Origin Zip', 'Orig Zip', 'Origin - Zip'], hasNamedCities ? -1 : 8),
              colL: ruleCol('destCity', ['Destination City', 'Dest City', 'Destination', 'Destination - City'], 11),
              colM: ruleCol('destSt', ['Destination State', 'Destination St', 'Dest State', 'Destination - State'], 12),
              colN: ruleCol('destZip', ['Destination Zipcode', 'Destination Zip', 'Dest Zip', 'Destination - Zip'], hasNamedCities ? -1 : 13),
              colO: ruleCol('weight', ['Weight', 'Wgt', 'Weight (lbs)'], 14),
              useRxoDateTimeFormat: isRxoImport || hasRxoTimeColumns || Boolean(ruleColumns.pickup),
              colQ: ruleColumns.pickup && pickupTimeCol >= 0 ? pickupTimeCol : isRxoImport && !hasRxoTimeColumns ? 16 : pickupTimeCol >= 0 ? pickupTimeCol : 16,
              colR: ruleColumns.delivery && deliveryTimeCol >= 0 ? deliveryTimeCol : isRxoImport && !hasRxoTimeColumns ? 17 : deliveryTimeCol >= 0 ? deliveryTimeCol : 17,
              colS: ruleCol('miles', ['Bill as Miles', 'Miles', 'Distance', 'Loaded Miles'], 18),
              pickupLateCol,
              deliveryLateCol,
              rateCol,
              // Only real column names here (no position fallback): other files put weight or
              // dates where an RXO list has its commodity.
              commodityCols: ['Commodity', 'Commodity Description']
                .map(name => findColIndex([name], -1))
                .filter(index => index >= 0)
            };
            if (columns.useRxoDateTimeFormat) anyRxoDateTimeFormat = true;
            rawRows.slice(1).forEach((row, rowIndex) => {
              const getRxoDateTime = colIndex => {
                const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex + 1, c: colIndex })];
                return formatRxoExcelDateTime(cell ? XLSX.utils.format_cell(cell) : row[colIndex]);
              };
              sheetRows.push({ ...columns, row, getRxoDateTime });
            });
          }
        }

        if (!sheetCount) {
          notify(files.length > 1
            ? 'The selected Excel files are empty or only contain headers!'
            : 'The uploaded Excel sheet is empty or only contains headers!');
          return;
        }

        let datRateError = '';
        let skippedEquipmentCount = 0;
        let importedRows = [];
        for (let idx = 0; idx < sheetRows.length; idx++) {
          const {
            row, colA, colB, colG, colH, colI, colL, colM, colN, colO, colQ, colR, colS,
            commodityCols, useRxoDateTimeFormat, getRxoDateTime, pickupLateCol = -1, deliveryLateCol = -1, rateCol = -1
          } = sheetRows[idx];
          if (!row || row.length === 0) continue;

          // Skip oversized/specialized equipment we don't haul (Over Dimensional, RGN, etc.).
          if (isSkippableEquipment(row[colB])) {
          skippedEquipmentCount += 1;
          continue;
          }

          const loadId = String(row[colA] || `IMP-${Date.now()}-${idx}`).trim();
          const origC = String(row[colG] || 'UNKNOWN').toUpperCase().trim();
          const origS = String(row[colH] || '').toUpperCase().trim();
          const origZ = String(row[colI] || '00000').trim();
          const destC = String(row[colL] || 'UNKNOWN').toUpperCase().trim();
          const destS = String(row[colM] || '').toUpperCase().trim();
          const destZ = String(row[colN] || '00000').trim();
          // "40000.0 LB" -> "40000 lbs"
          const rawWeight = String(row[colO] || '').trim();
          const weightVal = isRxoPayerImport ? '42000 lbs'
            : /^[\d,.]+\s*(?:LB|LBS)?$/i.test(rawWeight) && rawWeight
              ? `${Math.round(Number(rawWeight.replace(/[^\d.]/g, '')))} lbs`
              : rawWeight || '40000 lbs';

          // Early and late times on the same day become one window ("11/30/2026 0800 - 1500").
          const withLateTime = (early, lateCol) => {
            if (lateCol < 0 || !early) return early;
            const late = getRxoDateTime(lateCol);
            const [earlyDate, earlyTime] = early.split(' ');
            const [lateDate, lateTime] = String(late || '').split(' ');
            return earlyDate === lateDate && /^\d{4}$/.test(earlyTime || '') && /^\d{4}$/.test(lateTime || '') && lateTime !== earlyTime
              ? `${earlyDate} ${earlyTime} - ${lateTime}` : early;
          };
          const puTimeVal = useRxoDateTimeFormat
            ? withLateTime(getRxoDateTime(colQ), pickupLateCol)
            : formatExcelDateTime(row[colQ]);
          const delTimeVal = useRxoDateTimeFormat
            ? withLateTime(getRxoDateTime(colR), deliveryLateCol)
            : formatExcelDateTime(row[colR]);
          // Broker exports append a unit to miles, e.g. '396.3 miles'; store the number only.
          const milesVal = String(row[colS] || '500').replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0] || '500';

          const laneKey = `${origC}${origS ? ', ' + origS : ''} → ${destC}${destS ? ', ' + destS : ''}`;
          
          const rawEquip = row[colB];
          const normalizedEquip = normalizeEquipmentCode(rawEquip);
          // RXO defaults to VAN:VAN, but reefer/flatbed/etc. equipment text wins.
          const eCodeVal = isRxoCustomer(selectedBroker)
            ? (normalizedEquip && normalizedEquip !== 'V' ? normalizedEquip : 'VAN:VAN')
            : normalizedEquip || 'VZ';
          
          const tempOrder = {
            origCity: origC, origSt: origS, origZip: origZ,
            destCity: destC, destSt: destS, destZip: destZ,
            eCode: eCodeVal
          };

          // The Phalanx list carries its own rate; a rate you saved for the lane still wins.
          const listRate = rateCol >= 0 ? Number(String(row[rateCol] ?? '').replace(/[$,]/g, '')) : 0;
          // ⚙ Rules: a fixed lane rate always wins; then the rate source (as usual: your saved
          // lane rate, then the file's rate; DAT fills anything left blank below).
          const ruleRate = ruleLaneRate(importRules, tempOrder);
          const starting = startingRate(importRules, { fileRate: listRate, savedRate: getSavedLaneRate(laneRates, selectedBroker, tempOrder) });
          const rateVal = ruleRate || starting.rate;
          const rateSrc = rateVal ? 'user-entered' : undefined;
          const waitForHigher = !ruleRate && starting.waitForDat;

          const hazmatTanker = getImportedHazmatTanker(rawEquip, commodityCols.map(index => row[index]));
          importedRows.push({
            id: loadId,
            eCode: eCodeVal,
            ...hazmatTanker,
            // "Higher of the customer's rate and DAT": the file's rate, compared once DAT is in.
            ...(waitForHigher ? { ruleFileRate: listRate } : {}),
            status: 'OPEN',
            tag: 'OPEN',
            route: laneKey,
            puDate: useRxoDateTimeFormat && puTimeVal ? `PU: ${puTimeVal.split(' ')[0]}` : 'PU: Today',
            delDate: useRxoDateTimeFormat && delTimeVal ? `DFL: ${delTimeVal.split(' ')[0]}` : 'DFL: Upcoming',
            pickupTime: puTimeVal,
            origCity: origC,
            origSt: origS,
            origZip: origZ,
            weight: weightVal,
            deliveryTime: delTimeVal,
            destCity: destC,
            destSt: destS,
            destZip: destZ,
            miles: milesVal,
            planningComment: 'Imported from Excel',
            carrier: '',
            driver: '',
            truck: '',
            trailer: '',
            rateInput: rateVal,
            ...(rateSrc ? { rateSource: rateSrc } : {}),
            brokerable: 'false',
            notes: ''
          });
        }

        // Agent AAQ's Phalanx account takes only the list's F (flatbed) loads.
        let skippedNotFlatbed = 0;
        if (isFlatbedOnlyPhalanx(selectedBroker, profile.postingCode)) {
          const flatbeds = importedRows.filter(isFlatbedLoad);
          skippedNotFlatbed = importedRows.length - flatbeds.length;
          importedRows = flatbeds;
        }
        // ⚙ Rules: only the equipment this customer's rules allow.
        const equipmentRule = filterByImportEquipment(importedRows, importRules);
        importedRows = equipmentRule.kept;
        const skippedByRules = equipmentRule.skipped;
        // Run ZIP code auto-fill on Excel import rows
        importedRows = autoFillLoadZipCodes(importedRows);
        importedRows = applyRxoPayerBusinessHours(importedRows, selectedBroker);
        // Auto-fetch DAT rates for rows with no saved lane rate (a few at a time).
        // Logged in the rate history only; your typed rates are what get reused.
        const excelDatRateError = await applyDatRatesForImport(importedRows, selectedBroker, laneRates, setLaneRates);
        if (excelDatRateError && !datRateError) datRateError = excelDatRateError;
        // ⚙ Rules, "higher of the two": the bigger of DAT and the customer's rate in the file.
        importedRows.forEach(load => {
          if (load.ruleFileRate === undefined) return;
          const best = higherRate(load.rateInput, load.ruleFileRate);
          if (best && best !== load.rateInput) { load.rateInput = best; load.rateSource = 'user-entered'; }
          delete load.ruleFileRate;
        });
        const { mileageError: excelMileageError } = await applyGoogleRoadMiles(importedRows, null, 'Imported from Excel');
        // RXO's big list is shared with Ivan (Daniel 2026-11-27): Texas pickups and loads over 500
        // miles stay here; the rest goes to R X O 2429200 - SNB (Ivan's, never auto-exported).
        const snbAccount = accountKey(selectedBroker) === 'RXO2429200ATZV' ? findListedAccount('R X O 2429200 - SNB', brokers) : '';
        let sentToSnb = 0;
        let snbOrders = null;
        if (snbAccount) {
          const split = splitBigList(importedRows);
          if (split.snb.length) {
            const { list, added } = addToSnbList(customerOrdersMap[snbAccount] || [], split.snb);
            snbOrders = list;
            sentToSnb = added;
            importedRows = split.mine;
          }
        }
        if (!importedRows.length && snbOrders) {
          const nextOrders = { ...customerOrdersMap, [snbAccount]: snbOrders };
          persistAppData(brokers, nextOrders);
          setCustomerOrdersMap(nextOrders);
          notify(`📂 Big list: every load was for ${snbAccount} (outside Texas, ${BIG_LIST_MILES} miles or less). Added there: ${sentToSnb}.`);
          return true;
        }

        const latestRegistry = getLatestExportedRegistry();
        const exportedRecords = getExportedRecordsForCustomer(latestRegistry, selectedBroker);
        const { exportedCount, exportedLoadIds } = countPreviouslyExportedLoads(importedRows, exportedRecords);
        const { loads: deduplicatedLoads, duplicateCount: duplicateImportCount } = isRxoImport
          ? removeDuplicateLoadImports(importedRows)
          : { loads: importedRows, duplicateCount: 0 };
        const existingLoads = customerOrdersMap[selectedBroker] || [];
        const importedLoads = keepPreviouslyExportedLoadsOpen(
          markDifferentScheduleLoadsEnt(deduplicatedLoads, existingLoads, selectedBroker),
          exportedLoadIds,
          selectedBroker
        );

        if (importedLoads.length === 0) {
          notify("No valid loads found in the spreadsheet rows.");
          return;
        }

        const resolvedImportedLoads = [];
        importedLoads.forEach(load => {
          resolvedImportedLoads.push(assignImportedLoadIdentity(applyPastPickupEntStatus(load, existingLoads), existingLoads, resolvedImportedLoads));
        });
        const mergedLoads = new Map(existingLoads.map(load => [load.id, load]));
        resolvedImportedLoads.forEach(load => {
          const existingLoad = mergedLoads.get(load.id);
          const wasPreviouslyExported = exportedLoadIds.has(normalizeLoadId(load.id));
          const preserveStatus = preservesImportedLoadStatus(selectedBroker);
          if (existingLoad && preserveStatus && !isNewDayForExistingLoad(existingLoad, load)) {
            mergedLoads.set(load.id, {
              ...existingLoad,
              ...getReimportedLoadStatus(existingLoad, wasPreviouslyExported)
            });
          }
          if (!existingLoad || isNewDayForExistingLoad(existingLoad, load)) {
            mergedLoads.set(load.id, existingLoad ? { ...load, rateInput: load.rateInput || existingLoad.rateInput } : load);
          } else if (existingLoad.status === 'OFFER') {
            mergedLoads.set(load.id, { ...existingLoad, status: 'OFFER', tag: 'OFFER' });
          } else if (wasPreviouslyExported && !preserveStatus) {
            mergedLoads.set(load.id, { ...existingLoad, status: 'OPEN', tag: 'OPEN' });
          } else if (load.status === 'ENT' && existingLoad.status !== 'ENT' && !preserveStatus) {
            mergedLoads.set(load.id, { ...existingLoad, status: 'ENT', tag: 'ENT' });
          } else if (anyRxoDateTimeFormat) {
            mergedLoads.set(load.id, {
              ...mergedLoads.get(load.id),
              pickupTime: load.pickupTime || existingLoad.pickupTime,
              deliveryTime: load.deliveryTime || existingLoad.deliveryTime,
              rateInput: existingLoad.rateInput || load.rateInput,
              rateSource: existingLoad.rateSource || load.rateSource,
              puDate: load.puDate,
              delDate: load.delDate
            });
          }
        });
        const mergedLoadList = Array.from(mergedLoads.values());
        const { loads: mergedFinalLoads, duplicateCount: duplicateExistingCount } = isRxoImport
          ? removeDuplicateLoadImports(mergedLoadList)
          : { loads: mergedLoadList, duplicateCount: 0 };
        const replacement = replaceImportedCustomerLoads(selectedBroker, importedRows, existingLoads);
        queueDroppedPostings(replacement, existingLoads);
        const finalLoads = replacement ? replacement.loads : mergedFinalLoads;
        const nextOrders = { ...customerOrdersMap, [selectedBroker]: finalLoads, ...(snbOrders ? { [snbAccount]: snbOrders } : {}) };
        const saved = persistAppData(brokers, nextOrders);
        setCustomerOrdersMap(nextOrders);
        setSelectedOrder(finalLoads.find(load => load.id === resolvedImportedLoads[0].id) || finalLoads[0]);
        setSelectedIds(getImportedLoadSelection(selectedBroker, replacement?.processedLoads || resolvedImportedLoads));
        showImportedList();
        setFilter('OPEN');

        const duplicatesRemoved = replacement ? 0 : duplicateImportCount + duplicateExistingCount;

        (options.quiet ? message => pushNotice(message.replace(/\s*\n+\s*/g, ' '), 'info') : notify)(
          `📂 Excel Import Complete for ${selectedBroker}:\n` +
          (files.length > 1 || sheetCount > 1
            ? `• Combined into one list: ${files.length} file(s), ${sheetCount} tab(s)\n`
            : '') +
          `• Added/Processed: ${replacement ? finalLoads.length : importedLoads.length} loads\n` +
          `• Total in list: ${finalLoads.length} loads\n` +
          getImportReplacementMessage(replacement) +
          (exportedCount > 0
            ? preservesImportedLoadStatus(selectedBroker)
              ? `• Previously exported; moved to OPEN: ${exportedCount}\n`
              : `• Previously exported; kept OPEN: ${exportedCount}\n`
            : '') +
          (duplicatesRemoved > 0 ? `• Skipped duplicates: ${duplicatesRemoved}\n` : '') +
          (skippedEquipmentCount > 0 ? `• Skipped oversized/specialized equipment: ${skippedEquipmentCount}\n` : '') +
          (skippedNotFlatbed > 0 ? `• Not imported (not F / flatbed; this Phalanx account takes flatbeds only): ${skippedNotFlatbed}\n` : '') +
          (skippedByRules > 0 ? `• Not imported (equipment this customer's ⚙ Rules leave out): ${skippedByRules}\n` : '') +
          (snbOrders ? `• Sent to ${snbAccount} (outside Texas, ${BIG_LIST_MILES} miles or less): ${sentToSnb} new\n` : '') +
          (datRateError ? `• DAT rates could not be fetched; enter rates manually. DAT reported: ${datRateError}\n` : '') +
          (excelMileageError ? `• Driving miles could not be calculated for some loads; enter them manually. Google Routes reported: ${excelMileageError}\n` : '') +
          (saved ? '• Status: Saved successfully in browser storage.' : '• Warning: Save failed, check browser storage.')
        );

        if (!saved) notify('Saving failed; keep this page open and check browser storage.');
        return saved;
      } catch (err) {
        console.error(err);
        notify(`Excel import failed: ${err.message || "Please make sure it's a valid .xlsx, .xls or OpenOffice .ods file."}`);
      }
      return false;
    };
    return runImport();
  };

  // ✨ Customer Screenshot takes several pictures at once (Daniel, 2026-11-25): they are read
  // one by one and imported together as one list, so a later picture never replaces the
  // loads read from an earlier one. Other screenshot imports take one picture.
  const handleScreenshotImport = async (event, importMode = 'ai') => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (isImportingScreenshot) return;
    await importScreenshotFile(importMode === 'ai' ? files : files[0], importMode);
  };

  const importScreenshotFile = async (fileInput, importMode, customerOverride = '') => {
    const files = (Array.isArray(fileInput) ? fileInput : [fileInput]).filter(Boolean);
    if (!files.length) return;
    const brokerName = customerOverride || selectedBroker;
    let worker;
    let imageUrl;

    setScreenshotImportMode(importMode);
    setIsImportingScreenshot(true);
    setScreenshotImportProgress(importMode === 'dat' ? 'Preparing DAT screenshot...' : importMode === 'ntg' ? 'Preparing NTG screenshot...' : importMode === 'ch' ? 'Preparing CH screenshot...' : 'Preparing customer screenshot...');
    try {
      if (files.some(file => !String(file.type || '').startsWith('image/'))) {
        throw new Error(files.length > 1 ? 'Please choose only image files.' : 'Please choose an image file.');
      }

      // ⚙ Rules say how to read this customer's screenshots: read by AI, no OCR engine needed.
      const aiInstructions = importMode === 'ai' ? getCustomerRules(profile.customerRules, brokerName).screenshotInstructions : '';
      let createWorker = null;
      if (!aiInstructions) {
        setScreenshotImportProgress('Loading OCR module...');
        const tesseractModule = await import('tesseract.js');
        createWorker = tesseractModule.createWorker || tesseractModule.default?.createWorker;
        if (typeof createWorker !== 'function') {
          throw new Error('The OCR engine could not be loaded.');
        }
      }
      // Reads one picture into load rows; the import below runs once on all of them.
      const readScreenshotImage = async (file, label = '') => {
      setScreenshotImportProgress(label ? `${label}: opening...` : 'Opening screenshot...');
      const image = new Image();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = URL.createObjectURL(file);
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('The selected image could not be opened.'));
        image.src = imageUrl;
      });
      setScreenshotImportProgress('Loading OCR engine...');

      const scale = Math.min(3, 5000 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not prepare the image for text recognition.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      if (!worker) worker = await createWorker('eng', 1, {
        logger: message => {
          if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
            setScreenshotImportProgress(`Recognizing ${Math.round(message.progress * 100)}%`);
          } else if (message.status) {
            setScreenshotImportProgress(message.status);
          }
        }
      });
      setScreenshotImportProgress('Recognizing text...');
      await worker.setParameters({
        tessedit_pageseg_mode: importMode === 'dat' || importMode === 'ntg' ? '3' : '6',
        // An earlier picture may have left the digits-only setting on.
        tessedit_char_whitelist: ''
      });
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      let lines = (data.blocks || []).flatMap(block =>
        block.paragraphs.flatMap(paragraph => paragraph.lines)
      );
      // Shipper-portal lists with Origin city / state / Dest city / Dest st columns and no load
      // numbers (AMERI 18347- ATZ) have their own reader; rows it cannot read are listed, not guessed.
      // AMERI only: Paramount's list also has "Origin City" and "Dest" columns (2026-11-25).
      if (importMode === 'ai' && isAmeriCustomer(brokerName) && isCityGridScreenshot(lines.map(line => line.text))) {
        setScreenshotImportProgress('Reading cities and dates...');
        const zipModule = await import('zipcodes');
        const cityGrid = parseCityGridScreenshotText(lines.map(line => line.text), zipModule.default || zipModule, brokerName);
        if (!cityGrid.loads.length) {
          throw new Error(`No rows could be read from this list. Existing loads were not changed.${cityGrid.skippedRows.length ? `\n${cityGrid.skippedRows.slice(0, 10).join('\n')}` : ''}`);
        }
        return { recognizedLoads: cityGrid.loads, gridSkippedRows: cityGrid.skippedRows, chSkipNote: '', canvas };
      }
      const tableGrid = importMode === 'ai' ? detectScreenshotGrid(canvas) : null;
      let gridSkippedRows = [];
      if (tableGrid) {
        lines = await readScreenshotGrid(worker, canvas, tableGrid, setScreenshotImportProgress, image);
        gridSkippedRows = lines.skippedRows || [];
        if (!lines.length) {
          throw new Error(`No screenshot rows could be read. Existing loads were not deleted.\n${gridSkippedRows.join('\n')}`);
        }
      }
      const dataLines = lines
        .filter(line => line.bbox.y0 >= canvas.height * 0.035)
        .sort((a, b) => a.bbox.y0 - b.bbox.y0);
      const centers = dataLines.map(line => (line.bbox.y0 + line.bbox.y1) / 2);
      const spacings = centers.slice(1)
        .map((center, index) => center - centers[index])
        .filter(spacing => spacing > 0 && spacing < canvas.height * 0.08)
        .sort((a, b) => a - b);
      const rowSpacing = spacings[Math.floor(spacings.length / 2)];

      if (!tableGrid && rowSpacing && importMode !== 'ntg' && importMode !== 'ch') {
        for (let index = 1; index < dataLines.length; index += 1) {
          const previousCenter = centers[index - 1];
          const nextCenter = centers[index];
          const missingCount = Math.max(0, Math.round((nextCenter - previousCenter) / rowSpacing) - 1);

          for (let missingIndex = 0; missingIndex < missingCount; missingIndex += 1) {
            const expectedCenter = previousCenter + rowSpacing * (missingIndex + 1);
            const cropTop = Math.max(0, Math.round(expectedCenter - rowSpacing * 1.5));
            const cropHeight = Math.min(Math.round(rowSpacing * 1.9), canvas.height - cropTop);
            const rowCanvas = document.createElement('canvas');
            rowCanvas.width = canvas.width;
            rowCanvas.height = cropHeight;
            const rowContext = rowCanvas.getContext('2d');
            if (!rowContext) throw new Error('Could not isolate a missed screenshot row.');
            rowContext.drawImage(canvas, 0, cropTop, canvas.width, cropHeight, 0, 0, canvas.width, cropHeight);

            const { data: rowData } = await worker.recognize(rowCanvas, {}, { blocks: true });
            const croppedLines = (rowData.blocks || []).flatMap(block =>
              block.paragraphs.flatMap(paragraph => paragraph.lines)
            );
            const targetCenter = expectedCenter - cropTop;
            const missedLine = croppedLines
              .map(line => ({
                line,
                distance: Math.abs((line.bbox.y0 + line.bbox.y1) / 2 - targetCenter)
              }))
              .filter(candidate => candidate.distance < rowSpacing * 0.6)
              .sort((a, b) => a.distance - b.distance)[0]?.line;

            if (missedLine) {
              lines.push({
                ...missedLine,
                bbox: {
                  ...missedLine.bbox,
                  y0: missedLine.bbox.y0 + cropTop,
                  y1: missedLine.bbox.y1 + cropTop
                }
              });
            }
          }
        }
      }

      if (importMode === 'ai' && !tableGrid) {
        await worker.setParameters({
          tessedit_pageseg_mode: '7',
          tessedit_char_whitelist: '0123456789'
        });
        const detectedColumns = detectScreenshotColumns(lines, canvas.width);
        const orderCellX = Math.round(canvas.width * detectedColumns[1]);
        const orderCellWidth = Math.round(canvas.width * (detectedColumns[2] + 0.016 - detectedColumns[1]));
        const orderCellHeight = Math.max(1, Math.round(rowSpacing * 0.9));
        for (const line of lines) {
          if (line.bbox.y0 < canvas.height * 0.035) continue;
          const centerY = (line.bbox.y0 + line.bbox.y1) / 2;
          const sourceY = Math.max(0, Math.min(
            canvas.height - orderCellHeight,
            Math.round(centerY - orderCellHeight / 2)
          ));
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = orderCellWidth * 3;
          cropCanvas.height = orderCellHeight * 3;
          const cropContext = cropCanvas.getContext('2d', { willReadFrequently: true });
          if (!cropContext) throw new Error('Could not isolate an order number for recognition.');
          cropContext.drawImage(
            canvas,
            orderCellX,
            sourceY,
            orderCellWidth,
            orderCellHeight,
            0,
            0,
            cropCanvas.width,
            cropCanvas.height
          );

          const imageData = cropContext.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
          let redPixels = 0;
          for (let offset = 0; offset < imageData.data.length; offset += 4) {
            if (imageData.data[offset] > 180 && imageData.data[offset + 1] < 100 && imageData.data[offset + 2] < 100) {
              redPixels += 1;
            }
          }
          line.orderNumberHighlighted = redPixels > cropCanvas.width * cropCanvas.height * 0.2;
          let backgroundLuminance = 0;
          let edgeSamples = 0;
          for (let x = 0; x < cropCanvas.width; x += 4) {
            for (const y of [0, cropCanvas.height - 1]) {
              const offset = (y * cropCanvas.width + x) * 4;
              backgroundLuminance += imageData.data[offset] * 0.299
                + imageData.data[offset + 1] * 0.587
                + imageData.data[offset + 2] * 0.114;
              edgeSamples += 1;
            }
          }
          const isHighlighted = backgroundLuminance / edgeSamples < 150;
          const threshold = isHighlighted ? 130 : 170;
          for (let offset = 0; offset < imageData.data.length; offset += 4) {
            const luminance = imageData.data[offset] * 0.299
              + imageData.data[offset + 1] * 0.587
              + imageData.data[offset + 2] * 0.114;
            const pixel = isHighlighted
              ? (luminance < threshold ? 255 : 0)
              : (luminance < threshold ? 0 : 255);
            imageData.data[offset] = pixel;
            imageData.data[offset + 1] = pixel;
            imageData.data[offset + 2] = pixel;
            imageData.data[offset + 3] = 255;
          }
          cropContext.putImageData(imageData, 0, 0);
          const { data: orderData } = await worker.recognize(cropCanvas);
          line.verifiedOrderId = orderData.text.replace(/\D/g, '').match(/22\d{5}/)?.[0] || '';
        }
      }

      const isDatImport = importMode === 'dat';
      const isNtgImport = importMode === 'ntg';
      const isChImport = importMode === 'ch';
      let chSkipNote = '';
      let ntgCardLoads = [];
      if (isNtgImport) {
        ntgCardLoads = await readNtgScreenshotCards(worker, image, setScreenshotImportProgress);
      }
      if (isNtgImport && !ntgCardLoads.length) {
        const { cards: ntgCards, spacing: ntgSpacing } = findNtgCards(lines, canvas.width, canvas.height);
        const readStrip = (x0, y0, x1, y1, pattern) => readCanvasStrip(worker, canvas, x0, y0, x1, y1, pattern);
        const cardNeedsId = card => !card.words.some(word => word.x0 < 0.2 && /^\d{7}$/.test(word.text));
        const cardNeedsWeight = card => !card.words.some(word =>
          word.cx > 0.6 && /^(\d{1,3}(,\d{3})+|\d{4,6})(\.\d+)?$/.test(word.text)
        );
        if (ntgCards.some(card => cardNeedsId(card) || cardNeedsWeight(card))) {
          setScreenshotImportProgress('Reading missed load details...');
          await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789,.' });
          for (const card of ntgCards) {
            if (cardNeedsId(card)) {
              const idWordSize = card.words.find(word => /^total$/i.test(word.text))?.h || canvas.height * 0.06;
              const loadNumber = (await readStrip(
                canvas.width * 0.01, card.cy - idWordSize, canvas.width * 0.1, card.cy + idWordSize * 2.4, /\d{7}/
              )).slice(0, 7);
              if (loadNumber) {
                lines.push({
                  bbox: { x0: 0, y0: card.cy - 5, x1: canvas.width * 0.08, y1: card.cy + 5 },
                  text: loadNumber,
                  words: [{ text: loadNumber, bbox: { x0: canvas.width * 0.03, y0: card.cy - 5, x1: canvas.width * 0.08, y1: card.cy + 5 } }]
                });
              }
            }
            const totalWord = card.words.find(word => /^total$/i.test(word.text));
            if (cardNeedsWeight(card) && totalWord) {
              const weightText = await readStrip(
                canvas.width * 0.69, totalWord.cy + totalWord.h * 1.5,
                totalWord.x0 * canvas.width - 8, totalWord.cy + totalWord.h * 4.2,
                /\d{1,3}(,\d{3})+(\.\d+)?|\d{4,6}(\.\d+)?/
              );
              if (weightText) {
                const y = totalWord.cy + totalWord.h * 2.7;
                lines.push({
                  bbox: { x0: canvas.width * 0.74, y0: y - 5, x1: canvas.width * 0.8, y1: y + 5 },
                  text: weightText,
                  words: [{ text: weightText, bbox: { x0: canvas.width * 0.74, y0: y - 5, x1: canvas.width * 0.8, y1: y + 5 } }]
                });
              }
            }
          }
        }
        const cardHasHazmat = card => card.words.some(word => /^haz/i.test(word.text));
        if (ntgCards.some(card => !cardHasHazmat(card))) {
          setScreenshotImportProgress('Checking cards for Hazmat tags...');
          await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' });
          for (const card of ntgCards) {
            if (cardHasHazmat(card)) continue;
            const tagText = await readStrip(
              canvas.width * 0.005, card.cy + ntgSpacing * 0.3, canvas.width * 0.3, card.cy + ntgSpacing * 0.78, /haz\w*/i
            );
            if (tagText) {
              const y = card.cy + ntgSpacing * 0.5;
              lines.push({
                bbox: { x0: 0, y0: y - 5, x1: canvas.width * 0.1, y1: y + 5 },
                text: 'Hazmat',
                words: [{ text: 'Hazmat', bbox: { x0: 0, y0: y - 5, x1: canvas.width * 0.1, y1: y + 5 } }]
              });
            }
          }
        }
      }
      let recognizedLoads;
      if (isChImport) {
        setScreenshotImportProgress('Reading states and rates...');
        const chResult = await readChScreenshot(worker, canvas, lines, brokerName, laneRates, scale);
        recognizedLoads = chResult.loads;
        chSkipNote = (chResult.skippedLtl ? `• Skipped LTL rows: ${chResult.skippedLtl}\n` : '')
          + (chResult.skippedNoDate ? `• Skipped rows with no date heading above them: ${chResult.skippedNoDate}\n` : '');
      } else {
        recognizedLoads = isDatImport
          ? parseDatScreenshotLines(lines, canvas.width, canvas.height, brokerName, laneRates)
          : isNtgImport
            ? (ntgCardLoads.length ? ntgCardLoads : parseNtgScreenshotLines(lines, canvas.width, canvas.height))
            : parseScreenshotLines(lines, canvas.width, canvas.height, brokerName);
      }
      if (tableGrid && recognizedLoads.length !== tableGrid.rows.length - gridSkippedRows.length) {
        throw new Error(`Read ${recognizedLoads.length} of ${tableGrid.rows.length - gridSkippedRows.length} screenshot load rows. Existing loads were not deleted. Use a clearer image with every origin and destination visible.`);
      }
      return { recognizedLoads, gridSkippedRows, chSkipNote, canvas };
      };

      let recognizedLoads = [];
      const gridSkippedRows = [];
      let chSkipNote = '';
      let canvas;
      // Claude reads them (the TMS server's /api/read-screenshot) instead of the built-in reader.
      if (aiInstructions) {
        setScreenshotImportProgress(files.length > 1 ? `Reading ${files.length} pictures with AI...` : 'Reading the picture with AI...');
        const images = await Promise.all(files.map(imageForAi));
        const response = await fetch('/api/read-screenshot', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images, instructions: aiInstructions, customer: brokerName })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`${result.error || `The AI reader answered HTTP ${response.status}.`} Nothing was imported.`);
        if (!Array.isArray(result.loads) || !result.loads.length) throw new Error('The AI found no loads in the picture. Nothing was imported.');
        const now = Date.now();
        recognizedLoads = result.loads.map((row, index) => aiRowToLoad(row, { index, now, holdsOnHold: true }));
        if (result.unreadable) gridSkippedRows.push(`AI could not read: ${result.unreadable}`);
      }
      for (const [fileIndex, file] of (aiInstructions ? [] : files).entries()) {
        const label = files.length > 1 ? `Picture ${fileIndex + 1} of ${files.length}` : '';
        let picture;
        try {
          picture = await readScreenshotImage(file, label);
        } catch (error) {
          if (label) error.message = `${label} (${file.name}): ${error.message} Nothing was imported.`;
          throw error;
        }
        recognizedLoads.push(...picture.recognizedLoads);
        gridSkippedRows.push(...picture.gridSkippedRows.map(row => label ? `${label}: ${row}` : row));
        chSkipNote += picture.chSkipNote;
        canvas = picture.canvas;
      }
      const isDatImport = importMode === 'dat';
      const isNtgImport = importMode === 'ntg';
      const isChImport = importMode === 'ch';
      
      // Run ZIP Code Auto-fill on Screenshot loads
      recognizedLoads = autoFillLoadZipCodes(recognizedLoads);

      if (!isDatImport && !isNtgImport && recognizedLoads.length > 0) {
        try {
          const zipModule = await import('zipcodes');
          correctCitiesFromZip(recognizedLoads, zipModule.default || zipModule);
        } catch (error) {
          console.error('Could not use ZIP data to verify screenshot cities:', error);
        }
      }
      const applyDatCityFix = async () => {
        if (!(isDatImport || isChImport) || recognizedLoads.length === 0) return;
        try {
          const zipModule = await import('zipcodes');
          correctDatCities(recognizedLoads, zipModule.default || zipModule);
        } catch (error) {
          console.error('Could not verify DAT cities:', error);
        }
      };
      if (isDatImport && recognizedLoads.length === 0) {
        for (const pageSegMode of ['6', '11']) {
          setScreenshotImportProgress('Trying another DAT table recognition mode...');
          await worker.setParameters({ tessedit_pageseg_mode: pageSegMode });
          const { data: retryData } = await worker.recognize(canvas, {}, { blocks: true });
          const retryLines = (retryData.blocks || []).flatMap(block =>
            block.paragraphs.flatMap(paragraph => paragraph.lines)
          );
          let retryLoads = parseDatScreenshotLines(
            retryLines,
            canvas.width,
            canvas.height,
            brokerName,
            laneRates
          );
          retryLoads = autoFillLoadZipCodes(retryLoads);
          if (retryLoads.length > recognizedLoads.length) recognizedLoads = retryLoads;
          if (recognizedLoads.length > 0) break;
        }
      }

      if (isDatImport && recognizedLoads.length > 0) {
        setScreenshotImportProgress('Reading DAT rates...');
        await worker.setParameters({
          tessedit_pageseg_mode: '7',
          tessedit_char_whitelist: '0123456789,$./mi'
        });
        for (const load of recognizedLoads) {
          const crop = load.rateCrop;
          if (!crop || crop.x1 <= crop.x0) continue;
          // Lanes with your own saved rate keep it; the DAT rate is not read.
          if (load.rateSource === 'user-entered') continue;
          const miles = Number(load.miles) || 0;
          const isPlausible = value => value >= 100 && value < 100000
            && (!(miles > 0) || (value / miles >= 0.4 && value / miles <= 25));
          const variants = [
            [-0.34, 0.1, 140], [-0.34, 0.1, 110], [-0.34, 0.1, 170],
            [-0.45, 0.02, 140], [-0.3, 0.2, 140], [-0.5, 0.15, 125]
          ];
          let found = 0;
          const candidates = new Map();
          for (const [top, bottom, threshold] of variants) {
            const y0 = Math.max(0, Math.round(crop.centerY + crop.rowHeight * top));
            const y1 = Math.min(canvas.height, Math.round(crop.centerY + crop.rowHeight * bottom));
            if (y1 <= y0) continue;
            const scale = 4;
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = (crop.x1 - crop.x0) * scale + 32;
            cropCanvas.height = (y1 - y0) * scale + 32;
            const cropContext = cropCanvas.getContext('2d', { willReadFrequently: true });
            if (!cropContext) break;
            cropContext.imageSmoothingQuality = 'high';
            cropContext.fillStyle = '#fff';
            cropContext.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
            cropContext.drawImage(canvas, crop.x0, y0, crop.x1 - crop.x0, y1 - y0, 16, 16, cropCanvas.width - 32, cropCanvas.height - 32);
            const cropData = cropContext.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
            for (let offset = 0; offset < cropData.data.length; offset += 4) {
              const luminance = cropData.data[offset] * 0.299 + cropData.data[offset + 1] * 0.587 + cropData.data[offset + 2] * 0.114;
              const pixel = luminance < threshold ? 0 : 255;
              cropData.data[offset] = pixel;
              cropData.data[offset + 1] = pixel;
              cropData.data[offset + 2] = pixel;
              cropData.data[offset + 3] = 255;
            }
            cropContext.putImageData(cropData, 0, 0);
            const { data: rateData } = await worker.recognize(cropCanvas);
            const rateValue = parseDatRateText(rateData.text);
            if (isPlausible(rateValue)) {
              candidates.set(rateValue, (candidates.get(rateValue) || 0) + 1);
            }
          }
          const ranked = [...candidates].sort((a, b) => b[1] - a[1]);
          if (ranked[0]?.[1] >= 2 && (!ranked[1] || ranked[0][1] > ranked[1][1])) found = ranked[0][0];
          if (found) {
            load.rateInput = String(found);
            load.rateSource = 'dat-screenshot';
          } else if (load.rateInput && !isPlausible(Number(load.rateInput))) {
            load.rateInput = '';
            delete load.rateSource;
          }
        }
      }
      await applyDatCityFix();
      recognizedLoads.forEach(load => { delete load.rateCrop; });

      // DAT screenshots must retain posted rates rather than substitute market estimates.
      // Nolan posts at the load board's own rate: never a DAT rate (Daniel, 2026-11-06).
      if (!isDatImport && !isNolanCustomer(brokerName)) {
        await applyDatRatesForImport(recognizedLoads, brokerName, laneRates, setLaneRates);
      }

      if (recognizedLoads.length === 0) {
        throw new Error(isChImport
          ? `No CH loads were recognized.${chSkipNote ? ` Skipped rows:\n${chSkipNote}` : ' Capture the board straight-on with the Load #, Origin, OST, Destination, DST, Pickup Hours, Mode, Weight and Bin columns and a date heading visible.'}`
          : isDatImport
          ? 'No DAT load rows were recognized. Capture the DAT results table straight-on with the Origin, Destination, Pick Up, EQ, and Weight columns visible.'
          : isNtgImport
            ? 'No NTG loads were recognized. The text in the screenshot is probably too small to read: set the browser zoom to 100% (Ctrl+0), then capture about 4-5 load cards at a time with the Load #, cities, miles, weight and Total Rate visible.'
          : 'No load rows could be read. Try a clearer, straight-on screenshot that includes the full table.');
      }

      recognizedLoads = applyRxoPayerBusinessHours(recognizedLoads, brokerName);
      const { mileageError } = await applyGoogleRoadMiles(
        recognizedLoads,
        setScreenshotImportProgress,
        `Imported from ${isDatImport ? 'DAT' : isNtgImport ? 'NTG' : isChImport ? 'CH' : 'customer'} screenshot`
      );
      const existingOrders = customerOrdersMap[brokerName] || [];
      const latestRegistry = getLatestExportedRegistry();
      const exportedRecords = getExportedRecordsForCustomer(latestRegistry, brokerName);
      const { exportedCount, exportedLoadIds } = countPreviouslyExportedLoads(
        recognizedLoads,
        exportedRecords,
        { idOnly: isNtgImport || isChImport }
      );
      let importedLoads = recognizedLoads;
      let skippedDuplicateCount = 0;
      let datUnreadableRows = [];
      if (isDatImport) {
        const deduplicated = deduplicateDatImports(importedLoads, existingOrders);
        importedLoads = deduplicated.loads;
        skippedDuplicateCount = deduplicated.skippedDuplicateCount;
        datUnreadableRows = deduplicated.unreadableRows;
      }
      importedLoads = keepPreviouslyExportedLoadsOpen(
        markDifferentScheduleLoadsEnt(importedLoads, existingOrders, brokerName),
        exportedLoadIds,
        brokerName
      );

      if (importedLoads.length === 0) {
        const exportedMessage = !isDatImport && exportedCount
          ? preservesImportedLoadStatus(brokerName)
            ? ` ${exportedCount} previously exported loads moved to OPEN.`
            : ` ${exportedCount} previously exported loads remain in OPEN.`
          : '';
        notify(`Read ${recognizedLoads.length} load rows, but none were added for ${brokerName}.${exportedMessage}${skippedDuplicateCount ? ' They duplicated a lane and pickup date already imported.' : ''}${datUnreadableRows.length ? `\nSkipped unreadable rows:\n${datUnreadableRows.join('\n')}` : ''}`);
        return;
      }

      const resolvedImportedLoads = [];
      importedLoads.forEach(load => {
        resolvedImportedLoads.push(assignImportedLoadIdentity(applyPastPickupEntStatus(load, existingOrders), existingOrders, resolvedImportedLoads));
      });

      const existingIds = new Set(existingOrders.map(order => order.id));
      const mergeableFields = [
        'pickupTime', 'origCity', 'origSt', 'origZip', 'weight',
        'deliveryTime', 'destCity', 'destSt', 'destZip', 'miles',
        'planningComment', 'rateInput', 'rateSource'
      ];
      const mergedImportedLoads = resolvedImportedLoads.map(importedLoad => {
        const existingLoad = existingOrders.find(order => order.id === importedLoad.id);
        if (!existingLoad) return importedLoad;
        const wasPreviouslyExported = exportedLoadIds.has(normalizeLoadId(importedLoad.id));
        if (isNewDayForExistingLoad(existingLoad, importedLoad)) {
          const { landstarExportedAt, ...rest } = existingLoad;
          return { ...rest, ...importedLoad, rateInput: importedLoad.rateInput || existingLoad.rateInput };
        }
        const mergedLoad = { ...importedLoad, ...existingLoad };
        if (isDatImport && importedLoad.rateSource === 'dat-screenshot'
          && existingLoad.rateSource !== 'user-entered' && Number(importedLoad.rateInput) > 0) {
          mergedLoad.rateInput = importedLoad.rateInput;
          mergedLoad.rateSource = 'dat-screenshot';
        }
        const fixedLaneRate = getFixedLaneRate(brokerName, mergedLoad);
        if (fixedLaneRate && existingLoad.rateSource !== 'user-entered') {
          mergedLoad.rateInput = fixedLaneRate;
          mergedLoad.rateSource = 'user-entered';
        }
        const preserveStatus = preservesImportedLoadStatus(brokerName);
        if (existingLoad.status === 'OFFER') {
          mergedLoad.status = 'OFFER';
          mergedLoad.tag = 'OFFER';
        } else if (preserveStatus) {
          Object.assign(mergedLoad, getReimportedLoadStatus(existingLoad, wasPreviouslyExported));
        } else if (wasPreviouslyExported) {
          mergedLoad.status = 'OPEN';
          mergedLoad.tag = 'OPEN';
        } else if (importedLoad.status === 'ENT' && !preserveStatus) {
          mergedLoad.status = 'ENT';
          mergedLoad.tag = 'ENT';
        }
        if (!isDatImport) {
          [
            'eCode', 'route', 'puDate', 'delDate', 'pickupTime', 'origCity', 'origSt', 'origZip',
            'weight', 'deliveryTime', 'destCity', 'destSt', 'destZip', 'miles'
          ].forEach(field => {
            if (String(importedLoad[field] || '').trim()) mergedLoad[field] = importedLoad[field];
          });
        }
        mergeableFields.forEach(field => {
          if (!String(existingLoad[field] || '').trim() && String(importedLoad[field] || '').trim()) {
            mergedLoad[field] = importedLoad[field];
          }
        });
        return mergedLoad;
      });
      const newLoads = mergedImportedLoads.filter(order => !existingIds.has(order.id));
      const mergedOrders = new Map(existingOrders.map(order => [order.id, order]));
      mergedImportedLoads.forEach(order => mergedOrders.set(order.id, order));
      const replacement = replaceImportedCustomerLoads(brokerName, isDatImport ? importedLoads : recognizedLoads, existingOrders,
        isDatImport ? { additive: true, allowGeneratedIds: true, reportDroppedPostings: false }
          : gridSkippedRows.length
            ? { additive: true, allowGeneratedIds: !preservesImportedLoadStatus(brokerName), reportDroppedPostings: false }
            : { keepManualEnt: true });
      queueDroppedPostings(replacement, existingOrders);
      const finalLoads = replacement ? replacement.loads : Array.from(mergedOrders.values());
      const nextOrders = {
        ...customerOrdersMap,
        [brokerName]: finalLoads
      };
      const saved = persistAppData(brokers, nextOrders);
      setCustomerOrdersMap(nextOrders);
      setSelectedOrder(replacement.processedLoads[0]);
      setSelectedIds(getImportedLoadSelection(brokerName, replacement.processedLoads));
      showImportedList();
      setFilter(replacement.usesScreenshotStatus ? 'ALL' : 'OPEN');

      const unreadableIds = isChImport ? 0 : importedLoads.filter(order => order.notes).length;
      const unreadableWeights = importedLoads.filter(order => !order.weight).length;
      const unreadablePickups = importedLoads.filter(order => !order.pickupTime).length;
      const unreadableRates = isDatImport || isChImport ? importedLoads.filter(order => !(Number(order.rateInput) > 0)).length : 0;
      const missingChStates = isChImport ? importedLoads.filter(order => !order.origSt || !order.destSt).length : 0;
      const missingChMiles = isChImport ? importedLoads.filter(order => order.status !== 'ENT' && !(Number(order.miles) > 0)).length : 0;
      const newLoadCount = replacement.processedLoads.filter(load => !existingIds.has(load.id)).length;
      const updatedLoads = replacement.processedLoads.length - newLoadCount;

      notify(
        `📸 ${isDatImport ? 'DAT' : isNtgImport ? 'NTG' : isChImport ? 'CH' : 'Customer'} Screenshot Import Complete for ${brokerName}:\n` +
        (files.length > 1 ? `• Pictures read: ${files.length}\n` : '') +
        `• Recognized rows: ${recognizedLoads.length}\n` +
        `• New loads added: ${newLoadCount}\n` +
        `• Existing loads updated: ${updatedLoads}\n` +
        getImportReplacementMessage(replacement) +
        (isDatImport && skippedDuplicateCount ? `• Duplicate lane/pickup-day rows skipped: ${skippedDuplicateCount}\n` : '') +
        (datUnreadableRows.length ? `• Skipped unreadable rows (not imported):\n${datUnreadableRows.join('\n')}\n` : '') +
        (gridSkippedRows.length ? `• Skipped rows (not imported; existing loads kept). Add these by hand or widen the column and re-import:\n${gridSkippedRows.join('\n')}\n` : '') +
        (exportedCount > 0
          ? replacement?.usesScreenshotStatus
            ? `• Previously exported; status taken from screenshot color: ${exportedCount}\n`
          : preservesImportedLoadStatus(brokerName)
            ? `• Previously exported; moved to OPEN: ${exportedCount}\n`
            : `• Previously exported; kept OPEN: ${exportedCount}\n`
          : '') +
        chSkipNote +
        (unreadableWeights > 0 ? `• Missing weights: ${unreadableWeights}\n` : '') +
        (unreadablePickups > 0 ? `• Missing pickup times: ${unreadablePickups}\n` : '') +
        (isChImport && unreadableRates > 0 ? `• No rate on the board (enter manually): ${unreadableRates}\n` : '') +
        (missingChStates > 0 ? `• State not read: ${missingChStates}\n` : '') +
        (missingChMiles > 0 ? `• Driving miles missing: ${missingChMiles}${mileageError ? ` (${mileageError})` : ''}\n` : '') +
        (!isChImport && mileageError ? `• Google driving miles unavailable; miles kept from the import where present. Google Routes reported: ${mileageError}\n` : '') +
        (saved ? '• Status: Saved successfully.' : '• Warning: Save failed.')
      );

      const importWarnings = `${saved ? '' : ' Saving failed; keep this page open and check browser storage.'}${unreadableIds ? ` ${unreadableIds} order number${unreadableIds === 1 ? ' was' : 's were'} unreadable.` : ''}${unreadablePickups ? ` ${unreadablePickups} pickup date/time${unreadablePickups === 1 ? ' was' : 's were'} not recognized; please check those loads.` : ''}${unreadableWeights ? ` ${unreadableWeights} weight${unreadableWeights === 1 ? ' was' : 's were'} not recognized; please check those loads.` : ''}${unreadableRates ? ` ${unreadableRates} DAT rate${unreadableRates === 1 ? ' was' : 's were'} not recognized; enter them manually.` : ''}`.trim();
      if (importWarnings && !saved) notify(importWarnings);
    } catch (error) {
      const source = importMode === 'ntg' ? 'NTG screenshot' : importMode === 'dat' ? 'DAT screenshot' : 'Customer screenshot';
      console.error(`${source} import failed:`, error);
      notify(`${source} import failed: ${error.message || 'Could not read the image.'}`);
    } finally {
      if (worker) await worker.terminate();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      setIsImportingScreenshot(false);
      setScreenshotImportMode('');
      setScreenshotImportProgress('');
    }
  };

  const handlePasteScreenshot = async (importMode) => {
    if (isImportingScreenshot) return;
    setIsImportingScreenshot(true);
    setScreenshotImportMode(importMode);
    setScreenshotImportProgress('Reading clipboard...');
    try {
      const image = await readClipboardImage(navigator.clipboard);
      await importScreenshotFile(image, importMode);
    } catch (error) {
      console.error(`Could not read the ${importMode.toUpperCase()} screenshot from the clipboard:`, error);
      notify(`Could not paste the ${importMode.toUpperCase()} screenshot: ${error.message}\n\nIf clipboard access was blocked, click the app background and press Ctrl+V instead.`);
    } finally {
      setIsImportingScreenshot(false);
      setScreenshotImportMode('');
      setScreenshotImportProgress('');
    }
  };

  const handlePasteNtgScreenshot = () => handlePasteScreenshot('ntg');

  useEffect(() => {
    const handlePaste = event => {
      const image = getPastedImage(event);
      if (!image) return;
      event.preventDefault();
      if (isImportingScreenshot) return;
      // Para lists come from Heather in Google Chat: ask which account (or NTG cards).
      setPastedImage(image);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isImportingScreenshot, importScreenshotFile]);

  // Refreshes Booked Loads alerts (check call due / late) every minute.
  // Keep this the last effect: tests address earlier effects by position.
  useEffect(() => {
    if (view !== 'booked') return undefined;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, [view]);

  const updateCustomerLoad = (customer, id, updatedLoad) => {
    setCustomerOrdersMap(prev => ({
      ...prev,
      [customer]: (prev[customer] || []).map(o => (String(o.id) === String(id) ? updatedLoad : o))
    }));
    setSelectedOrder(current => (current && customer === selectedBroker && String(current.id) === String(id) ? updatedLoad : current));
  };

  const openBookedLoad = (customer, id) => {
    const target = (customerOrdersMap[customer] || []).find(o => String(o.id) === String(id));
    if (!target) return;
    if (customer !== selectedBroker) handleSelectBroker(customer);
    setFilter('BOOKED');
    setSelectedOrder(target);
    setView('loads');
  };

  // Driver inquiries: checked when the app opens and every minute after.
  // Keep this the last effect: tests address earlier effects by position.
  useEffect(() => {
    if (!supabase) return undefined;
    let cancelled = false;
    const loadInquiries = async () => {
      const { data, error } = await supabase
        .from('load_inquiries')
        .select('id, customer, load_id, driver_name, driver_phone, mc_or_truck, message, notify_error, seen, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) {
        // Table not created yet (run supabase/load-inquiries.sql) or signed out: stay quiet.
        if (!/does not exist|schema cache/i.test(error.message || '')) console.error('Could not load driver inquiries:', error);
        return;
      }
      // Unchanged list (the usual case): keep the old one so the TMS isn't redrawn every minute.
      if (!cancelled) setInquiries(current => (JSON.stringify(current) === JSON.stringify(data || []) ? current : data || []));
    };
    loadInquiries();
    const timer = setInterval(loadInquiries, 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Hands loads that dropped off a customer's list to the upload bot, which removes
  // their Landstar postings. Retries every 30 seconds while the bot is off.
  // Keep this the last effect: tests address earlier effects by position.
  // Also hands booked loads to the bot for Landstar Assign Capacity (every 5 seconds while
  // any are waiting) and writes the bot's results onto the loads.
  useEffect(() => {
    const timer = setInterval(() => { void sendUnpostQueueToBot(); }, 30 * 1000);
    const assignTimer = setInterval(() => { void sendAssignQueueToBot(); }, 5 * 1000);
    const onAssignResult = event => {
      const result = event.detail || {};
      setCustomerOrdersMap(prev => {
        const loads = prev[result.customer];
        if (!Array.isArray(loads) || !loads.some(load => String(load.id) === String(result.loadId))) return prev;
        return { ...prev, [result.customer]: loads.map(load => (String(load.id) === String(result.loadId) ? applyAssignResult(load, result) : load)) };
      });
      setSelectedOrder(current => (current && String(current.id) === String(result.loadId)
        ? applyAssignResult(current, result) : current));
      const capacity = result.carrierMc ? `carrier MC ${result.carrierMc}` : `truck ${result.truck}`;
      if (!result.ok && result.unconfirmed) {
        pushNotice(`Landstar Assign Capacity: load #${result.loadId} (${capacity}) - Landstar did not confirm. ${result.message} It may already be assigned: check the load on Landstar before assigning it again.`);
      } else if (!result.ok) {
        pushNotice(`Landstar Assign Capacity: load #${result.loadId} (${capacity}) was NOT assigned. ${result.message} Assign it by hand on Landstar.`);
      }
      if (!result.ok) {
        alertDriverReply(`Capacity assignment needs attention - load #${result.loadId}`,
          `${result.carrierMc ? `Carrier MC ${result.carrierMc}` : `Truck ${result.truck}`}: ${result.message}. ${result.unconfirmed
            ? 'Check Landstar before retrying; the assignment may already exist.'
            : result.carrierMc ? 'Verify the MC number and finish the assignment on Landstar.' : 'Verify the tractor number and finish the assignment on Landstar.'}`,
          undefined, 'CAPACITY ASSIGNMENT FAILED');
      }
    };
    window.addEventListener('landstar-assign-result', onAssignResult);
    // The bot raised these postings on Landstar because another agency paid the same or more.
    const onRateRaises = event => {
      const raises = Array.isArray(event.detail) ? event.detail : [];
      const found = [];
      setCustomerOrdersMap(prev => {
        let changed = false;
        const next = { ...prev };
        Object.entries(prev).forEach(([customer, loads]) => {
          if (!Array.isArray(loads)) return;
          let customerChanged = false;
          const updated = loads.map(load => {
            const raise = raises.find(item => loadMatchesRateRaise(load, item));
            if (!raise) return load;
            customerChanged = true;
            found.push({ customer, load, raise });
            return applyRateRaise(load, raise);
          });
          if (customerChanged) { next[customer] = updated; changed = true; }
        });
        return changed ? next : prev;
      });
      setSelectedOrder(current => {
        const raise = current && raises.find(item => loadMatchesRateRaise(current, item));
        return raise ? applyRateRaise(current, raise) : current;
      });
      // No pop-up (Daniel, 2026-11-23): the ⬆ RAISED badge and the note by the rate box show it.
    };
    window.addEventListener('landstar-rate-raises', onRateRaises);
    // Landstar rejected these postings; the bot deleted the error drafts from Bulk Postings.
    const onErrorDrafts = event => {
      const drafts = Array.isArray(event.detail) ? event.detail : [];
      const found = [];
      setCustomerOrdersMap(prev => {
        let changed = false;
        const next = { ...prev };
        Object.entries(prev).forEach(([customer, loads]) => {
          if (!Array.isArray(loads)) return;
          let customerChanged = false;
          const updated = loads.map(load => {
            const draft = drafts.find(item => loadMatchesRateRaise(load, item));
            if (!draft) return load;
            customerChanged = true;
            found.push({ load, draft });
            return applyLandstarError(load, draft);
          });
          if (customerChanged) { next[customer] = updated; changed = true; }
        });
        return changed ? next : prev;
      });
      setSelectedOrder(current => {
        const draft = current && drafts.find(item => loadMatchesRateRaise(current, item));
        return draft ? applyLandstarError(current, draft) : current;
      });
      const lines = drafts.map(draft => {
        const match = found.find(item => item.draft === draft);
        return `${draft.hazmat ? '☢ ' : ''}${match ? `#${match.load.id}` : draft.customer} ${draft.lane} (pickup ${draft.pickup}): ${(draft.reasons || []).join('; ')}`;
      });
      pushNotice(`🗑 Landstar rejected ${drafts.length} posting${drafts.length === 1 ? '' : 's'}; the bot deleted ${drafts.length === 1 ? 'it' : 'them'} from Bulk Postings: `
        + `${lines.slice(0, 5).join(' · ')}${lines.length > 5 ? ` · …and ${lines.length - 5} more (look for ⚠ LANDSTAR ERROR on the loads)` : ''}`);
    };
    window.addEventListener('landstar-error-drafts', onErrorDrafts);
    const onRemovalResults = event => {
      const results = new Map((Array.isArray(event.detail) ? event.detail : []).map(result => [`${result.customer}|${result.loadId}`, result]));
      if (!results.size) return;
      setCustomerOrdersMap(prev => {
        let changed = false;
        const next = { ...prev };
        Object.entries(prev).forEach(([customer, loads]) => {
          if (!Array.isArray(loads) || !loads.some(load => results.has(`${customer}|${load.id}`))) return;
          next[customer] = loads.map(load => {
            const result = results.get(`${customer}|${load.id}`);
            return result ? applyRemovalResult(load, result) : load;
          });
          changed = true;
        });
        return changed ? next : prev;
      });
      setSelectedOrder(current => {
        const result = current && [...results.values()].find(item => String(item.loadId) === String(current.id));
        return result ? applyRemovalResult(current, result) : current;
      });
    };
    window.addEventListener('landstar-removal-results', onRemovalResults);
    return () => {
      window.removeEventListener('landstar-error-drafts', onErrorDrafts);
      window.removeEventListener('landstar-removal-results', onRemovalResults);
      clearInterval(timer);
      clearInterval(assignTimer);
      window.removeEventListener('landstar-assign-result', onAssignResult);
      window.removeEventListener('landstar-rate-raises', onRateRaises);
    };
  }, []);

  // ---------- Paramount tracking emails ----------
  const [paramountDrafts, setParamountDrafts] = useState([]);
  const [paramountReplies, setParamountReplies] = useState([]);
  // The email worker reports its status several times a minute. It is kept outside the App's
  // state so those reports redraw only the small status chip, not the whole TMS.
  const [emailWorkerStatusStore] = useState(() => createStatusStore({ state: 'starting', message: 'Starting scheduled checks', issues: [] }));
  // Background warnings (bot results, fuel updates): banners instead of notify() pop-ups,
  // because an open alert freezes the whole tab and stops the email timers.
  const [notices, setNotices] = useState([]);
  // Info notices clear themselves after 45 seconds, Undo offers after 10 minutes; warnings stay
  // until closed (✕). action = { label, run } draws a button (↩ Undo).
  const pushNotice = (text, level = 'warn', action = null) => {
    // Plain news is not shown (Daniel 2026-11-27: no corner notices); problems and Undo are.
    if (level === 'info') return;
    const id = `${Date.now()}-${Math.random()}`;
    // 'auto': what the bots did by themselves (chat list imported, auto-export), shown so you
    // can tell it happened (Daniel 2026-11-27: "I can't tell"); clears itself.
    setNotices(current => [
      ...current.filter(item => item.text !== text),
      { id, text, level, action, at: new Date().toISOString() }
    ].slice(-6));
    const clearAfter = level === 'info' || level === 'auto' ? NOTICE_INFO_MS : level === 'undo' ? UNDO_OFFER_MS : 0;
    if (clearAfter) setTimeout(() => setNotices(current => current.filter(item => item.id !== id)), clearAfter);
  };
  // Every message that used to be an notify() pop-up (Daniel 2026-11-27: "fewer pop-ups"): a
  // notice in the corner instead, so nothing waits for an OK click. "Are you sure?" questions
  // (confirm) stay pop-ups: those are decisions. Tests read the messages through
  // __tmsNoticeHook (the TMS itself never sets it).
  function notify(message, level = noticeLevel(message)) {
    const text = String(message ?? '');
    if (typeof __tmsNoticeHook === 'function') __tmsNoticeHook(text);
    pushNotice(text, level);
  }

  // ↩ Undo (src/lib/undo.js): every change to the load lists is compared with the one before;
  // an account that lost 3+ loads, gained 5+ or was deleted gets a notice with Undo, which puts
  // that account back exactly as it was. Undo itself is not offered again.
  const previousOrdersRef = useRef(null);
  const skipUndoRef = useRef(false);
  useEffect(() => {
    const previous = previousOrdersRef.current;
    previousOrdersRef.current = customerOrdersMap;
    if (!previous || skipUndoRef.current) {
      skipUndoRef.current = false;
      return;
    }
    for (const change of findBigListChanges(previous, customerOrdersMap)) {
      pushNotice(`↩ ${describeListChange(change)}`, 'undo', { label: 'Undo', run: () => undoListChange(change) });
    }
  }, [customerOrdersMap]);
  const undoListChange = change => {
    const current = customerOrdersMap[change.customer] || [];
    const reposted = restoredPostedLoads(change, current);
    // Removals this change queued for the Landstar removal bot and not yet sent: drop them.
    const restoredIds = new Set((change.before || []).map(load => String(load.id)));
    writeUnpostQueue(readUnpostQueue().filter(item => !(item.customer === change.customer && restoredIds.has(String(item.loadId)))));
    skipUndoRef.current = true;
    setCustomerOrdersMap(prev => {
      const next = { ...prev };
      if (change.created) delete next[change.customer];
      else next[change.customer] = change.before;
      return next;
    });
    if (change.deleted) setBrokers(prev => (prev.includes(change.customer) ? prev : [...prev, change.customer]));
    if (change.customer === selectedBroker) setSelectedOrder((change.created ? [] : change.before)[0] || null);
    notify(`↩ Undone: ${change.customer} is back as it was (${(change.before || []).length} loads).`
      + (reposted.length ? ` ${reposted.length} of them had Landstar postings that this change may have sent for removal: check the board and re-export any that are gone.` : ''),
      reposted.length ? 'warn' : 'info');
  };
  // New emails from VIP customers (Heather), shown until dismissed.
  const [vipMessages, setVipMessages] = useState([]);
  const [pastedImage, setPastedImage] = useState(null);
  paramountLatest.profile = profile;
  // Applies the weekly fuel email's rates to My Settings (once per email).
  const applyFuelSurchargeEmail = found => {
    const parsed = parseFuelSurchargeEmail(found?.subject) || parseFuelSurchargeEmail(found?.text);
    if (!parsed || !found.messageId) return;
    let seen = '';
    try { seen = localStorage.getItem(fuelEmailSeenKey) || ''; } catch { /* first time */ }
    if (seen === found.messageId) return;
    const current = paramountLatest.profile || getUserProfile();
    const nextRates = normalizeFuelSurchargeRates(parsed.rates);
    const changed = JSON.stringify(normalizeFuelSurchargeRates(current.fuelSurcharge)) !== JSON.stringify(nextRates);
    try { localStorage.setItem(fuelEmailSeenKey, found.messageId); } catch { /* applied again next time */ }
    if (!changed) return;
    const nextProfile = { ...current, fuelSurcharge: nextRates };
    try {
      writeSyncedKey('landstar_profile', JSON.stringify(nextProfile));
    } catch (error) {
      console.error('Could not save the new fuel surcharge:', error);
      return;
    }
    setProfile(nextProfile);
    pushNotice(`⛽ Fuel surcharge updated from the ${parsed.date || 'latest'} fuel email: East ${nextRates.east} · Midwest ${nextRates.midwest} · West ${nextRates.west} · New England ${nextRates.newEngland}`, 'info');
  };
  // The Google Chat item on screen (a picture shown in the paste window, or a spreadsheet
  // waiting for its account), and a spreadsheet to import once its account is selected.
  const [chatItem, setChatItem] = useState(null);
  const [chatSheet, setChatSheet] = useState(null);
  const [pendingChatSheet, setPendingChatSheet] = useState(null);
  const finishChatItem = name => {
    if (!name) return;
    fetch('/api/chat-inbox/done', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      .catch(error => console.error('Could not clear the chat inbox item:', error));
  };
  const importPastedImage = (customer) => {
    const image = pastedImage;
    setPastedImage(null);
    if (chatItem) {
      finishChatItem(chatItem.name);
      setChatItem(null);
    }
    if (!image) return;
    if (!customer) {
      void importScreenshotFile(image, 'ntg');
      return;
    }
    if (customer !== selectedBroker) handleSelectBroker(customer);
    void importScreenshotFile(image, 'ai', customer);
  };
  const cancelPastedImage = () => {
    setPastedImage(null);
    if (chatItem) {
      finishChatItem(chatItem.name);
      setChatItem(null);
    }
  };
  // Imports a chat spreadsheet into an account (switches to it first: the Excel import
  // reads the selected account). remember = save "this file name goes to this account".
  const importChatSheet = (customer, { remember = false } = {}) => {
    const sheet = chatSheet;
    setChatSheet(null);
    if (!sheet) return;
    finishChatItem(sheet.item.name);
    if (!customer) return;
    if (remember) {
      const nextProfile = { ...profile, chatSheetAccounts: rememberChatSheetAccount(profile.chatSheetAccounts, sheet.item.label, customer) };
      try {
        if (writeSyncedKey('landstar_profile', JSON.stringify(nextProfile))) setProfile(nextProfile);
      } catch (error) {
        console.error('Could not save the spreadsheet account:', error);
      }
    }
    if (customer !== selectedBroker) handleSelectBroker(customer);
    setPendingChatSheet({ file: sheet.file, customer });
  };
  // 🚨 / 📅 What the bots did today and what needs Daniel (GET /api/today, bot/today.js),
  // checked every 30 seconds on the bot PC only (the website has no bots to ask).
  const [today, setToday] = useState(null);
  useEffect(() => {
    if (!canStartBotHere()) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/today');
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setToday(data);
      } catch { /* try again next time */ }
    };
    void load();
    const timer = setInterval(load, 30 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // After a chat list for an auto-export account is imported (and its loads selected), the
  // next render exports them; set to the account name until then.
  const [autoExportFor, setAutoExportFor] = useState('');
  // A single load Tyler posted as a message in LANDJA18 (src/lib/chatLoads.js): into the RXO
  // account for its equipment, at the higher of his price and the DAT rate, then exported to
  // Landstar by itself. A load already in that account is left as it is (one copy).
  const addChatSingleLoad = async (text, item) => {
    const load = parseChatLoadMessage(text);
    if (!load) {
      pushNotice(`💬 A load message from Google Chat${item.chat ? ` (${item.chat})` : ''} could not be read; add it by hand.`, 'info');
      return;
    }
    const account = findListedAccount(chatLoadAccount(load), brokers);
    if (!account) {
      pushNotice(`💬 Load ${load.loadNumber} from Google Chat goes to ${chatLoadAccount(load)}, which is not in your customer list. Add that customer, then add the load by hand.`, 'info');
      return;
    }
    const existing = (customerOrdersMap[account] || []).find(order => normalizeLoadId(order.id) === normalizeLoadId(load.loadNumber));
    if (existing) {
      pushNotice(`💬 Load ${load.loadNumber} from Google Chat is already in ${account}; left as it is.`, 'info');
      return;
    }
    let datRate = 0;
    try {
      const response = await fetch('/api/dat-rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { city: load.origin.city, state: load.origin.state, zip: load.origin.zip },
          destination: { city: load.destination.city, state: load.destination.state, zip: load.destination.zip },
          equipment: load.equipmentCode
        })
      });
      datRate = Number((await response.json().catch(() => ({})))?.rate) || 0;
    } catch { /* his price alone */ }
    const order = createManualLoad(load.loadNumber, chatLoadToTmsLoad(load, datRate));
    setCustomerOrdersMap(prev => ({ ...prev, [account]: [order, ...(prev[account] || [])] }));
    handleSelectBroker(account);
    setSelectedOrder(order);
    pushNotice(`💬 Load ${load.loadNumber} (${load.origin.city}, ${load.origin.state} → ${load.destination.city}, ${load.destination.state}) from Google Chat added to ${account} at $${order.rateInput || '?'} (RXO $${load.price || 'n/a'}, DAT $${Math.round(datRate) || 'n/a'}).`, 'info');
    if (!(Number(order.rateInput) > 0)) return;
    setSelectedIds([selectionKey(account, order.id)]);
    setAutoExportFor(account);
  };
  useEffect(() => {
    if (!pendingChatSheet || pendingChatSheet.customer !== selectedBroker) return;
    const { file, customer } = pendingChatSheet;
    const autoExport = isChatAutoExportAccount(customer);
    setPendingChatSheet(null);
    Promise.resolve(handleExcelImport({ target: { files: [file], value: '' } }, { quiet: autoExport }))
      .then(imported => { if (autoExport && imported) setAutoExportFor(customer); })
      .catch(error => console.error('Chat list import failed:', error));
  }, [pendingChatSheet, selectedBroker]);
  // Starts once the imported list is on screen (Daniel 2026-11-27: it waited for checked loads,
  // but a list import checks none, so RXO lists never exported by themselves). With nothing
  // checked it exports the open list, like the Export button; a single chat load is checked.
  useEffect(() => {
    if (!autoExportFor) return;
    if (autoExportFor !== selectedBroker) return;
    setAutoExportFor('');
    pushNotice(`🚀 Exporting the new ${autoExportFor} list to Landstar automatically${selectedIds.length ? ` (${selectedIds.length} load${selectedIds.length === 1 ? '' : 's'})` : ''}...`, 'auto');
    void handleAutoExport();
  }, [autoExportFor, selectedBroker, selectedIds, customerOrdersMap]);
  // Checks the Google Chat inbox every 30 seconds. A file that needs you (a picture, a list with
  // a new name) opens a question; while one is open, files that run by themselves keep going
  // (single loads, lists with a known name, other agents' booking exports) and the others wait
  // (Daniel 2026-11-27: "known lists keep importing" while he is away).
  useEffect(() => {
    if (pendingChatSheet || isImportingScreenshot) return undefined;
    const asking = Boolean(pastedImage || chatItem || chatSheet);
    let cancelled = false;
    const knownAccount = item => {
      const account = findListedAccount(getChatSheetAccount(paramountLatest.profile?.chatSheetAccounts, item.label), brokers);
      return account && brokers.includes(account) ? account : '';
    };
    const openName = chatItem?.name || chatSheet?.item?.name || '';
    const check = async () => {
      try {
        const response = await fetch('/api/chat-inbox');
        if (!response.ok) return;
        const { items = [] } = await response.json();
        if (cancelled) return;
        // Files that need an answer from you, besides the one on screen.
        setChatWaitingCount(items.filter(item => item.name !== openName
          && (item.type === 'picture' || item.type === 'image' || (item.type === 'spreadsheet' && !knownAccount(item)))
          && item.type !== 'load').length);
        for (const item of items) {
          if (cancelled || item.name === openName) continue;
          const needsYou = item.type !== 'load' && item.type !== 'spreadsheet';
          if (asking && needsYou) continue;
          const known = item.type === 'spreadsheet' ? knownAccount(item) : '';
          const fileResponse = await fetch(`/api/chat-inbox/file?name=${encodeURIComponent(item.name)}`);
          if (!fileResponse.ok || cancelled) return;
          const blob = await fileResponse.blob();
          const file = new File([blob], item.fileName || item.name, { type: blob.type });
          const from = [item.chat, item.sender].filter(Boolean).join(' · ');
          if (item.type === 'load') {
            finishChatItem(item.name);
            await addChatSingleLoad(await blob.text(), item);
            return;
          }
          if (item.type === 'spreadsheet' && !known && await readOrderExportRows(file).catch(() => null)) {
            // Other agents' bookings (an order export): hot lanes, never loads, no account to pick.
            finishChatItem(item.name);
            importHotLanes(await readOrderExportRows(file), file);
            return;
          }
          if (item.type === 'spreadsheet' && known) {
            finishChatItem(item.name);
            pushNotice(`💬 "${item.label}" list from Google Chat${item.chat ? ` (${item.chat})` : ''} imported into ${known}.`, 'auto');
            if (known !== selectedBroker) handleSelectBroker(known);
            setPendingChatSheet({ file, customer: known });
            return;
          }
          // Needs you: ask, unless a question is already open (then it waits its turn).
          if (asking) continue;
          if (item.type === 'spreadsheet') setChatSheet({ item: { ...item, from }, file });
          else {
            setChatItem({ ...item, from });
            setPastedImage(file);
          }
          return;
        }
      } catch {
        // The TMS server has no chat inbox (or it is not reachable): try again later.
      }
    };
    void check();
    const timer = setInterval(check, chatInboxPollMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pastedImage, chatItem, chatSheet, pendingChatSheet, isImportingScreenshot, brokers, selectedBroker]);
  paramountLatest.map = customerOrdersMap;
  paramountLatest.phone = profile.phone;
  paramountLatest.postingCode = profile.postingCode;
  paramountLatest.selectedBroker = selectedBroker;

  const patchParamountLoad = (customer, id, change) => {
    setCustomerOrdersMap(prev => {
      const loads = prev[customer];
      if (!Array.isArray(loads) || !loads.some(load => String(load.id) === String(id))) return prev;
      return { ...prev, [customer]: loads.map(load => (String(load.id) === String(id) ? change(load) : load)) };
    });
    setSelectedOrder(current => (current && paramountLatest.selectedBroker === customer && String(current.id) === String(id)
      ? change(current) : current));
  };

  const findParamountLoad = (customer, id) => (paramountLatest.map?.[customer] || []).find(load => String(load.id) === String(id));

  const recordDriverPaperwork = (customer, load, files) => {
    if (files.length) {
      patchParamountLoad(customer, load.id, current => ({
        ...current,
        paperworkReceivedAt: current.paperworkReceivedAt || files[files.length - 1].at,
        paperworkFiles: files.map(file => file.filename),
        paperworkSince: getPaperworkSince(current),
        paperworkDone: current.paperworkDone || !getPaperworkTarget(customer)
      }));
    }
    setParamountDrafts(current => current.filter(item => !(item.kind === 'driver'
      && ['pod', 'podReminder'].includes(item.driverKind)
      && item.customer === customer && item.loadId === String(load.id))));
  };

  // Sends one draft (reply-all on the rate confirmation thread) and records it on the load.
  const sendParamountDraft = async (draft, { auto = false } = {}) => {
    setParamountDrafts(current => current.map(item => (item.id === draft.id ? { ...item, sending: true, error: '', retryNote: '' } : item)));
    // Every send carries its draft id: the email record (bot/email-record.js) refuses an
    // email that was already sent, skipped, or is being sent by another sender.
    // Gmail's per-minute limit: wait a minute and try again (shown on the card) instead of failing.
    const showGmailWait = seconds => {
      const retryNote = `Gmail busy (too many requests this minute) — retrying in ${seconds} s`;
      setParamountDrafts(current => (current.some(item => item.id === draft.id)
        ? current.map(item => (item.id === draft.id ? { ...item, sending: true, error: '', retryNote } : item))
        : [...current, { ...draft, sending: true, error: '', retryNote }]));
    };
    const sendEmail = body => withGmailQuotaRetry(
      () => spacedEmailSend(() => callParamountEmail({ ...body, emailKey: draft.id, emailMeta: emailRecordMeta(draft) })),
      { onWait: showGmailWait }
    );
    const isRxo = draft.kind === 'rxo';
    const isDriver = draft.kind === 'driver';
    const isPaperwork = draft.kind === 'paperwork';
    try {
      const currentLoad = findParamountLoad(draft.customer, draft.loadId);
      const initialDriverConfirmation = isDriver && draft.driverKind === 'dispatch';
      if (initialDriverConfirmation && (!currentLoad
        || String(currentLoad.paramountTracking?.freightBill) !== String(draft.freightBill)
        || !getDueDriverEmails(currentLoad, currentLoad.paramountTracking || {}).includes('dispatch'))) {
        throw new Error('The load, freight bill, or initial confirmation changed. Driver email was not sent.');
      }
      if (!['initial', 'paperwork', 'customerUpdate', 'manualUpdate'].includes(draft.kind) && !initialDriverConfirmation && (!currentLoad || !hasPickupDayStarted(currentLoad))) {
        throw new Error('Tracking emails start on pickup day. This email was not sent.');
      }
      const postingCode = draft.kind === 'rxoForward'
        ? getRxoEmailPostingCodes(paramountLatest.map, paramountLatest.postingCode)[draft.loadId] || ''
        : currentLoad ? getEmailPostingCode(currentLoad, paramountLatest.postingCode) : '';
      if (draft.kind === 'rxoForward' && postingCode !== 'SNB') {
        throw new Error('This load is not confirmed as SNB. Nothing forwarded to Ivan.');
      }
      if (isPaperwork) {
        const sent = await sendEmail({
          action: 'sendPaperwork', freightBill: draft.freightBill, since: draft.since,
          orderNumber: draft.loadId, target: draft.target, text: draft.text, postingCode
        });
        patchParamountLoad(draft.customer, draft.loadId, load => ({
          ...load, paperworkDone: true, paperworkSentAt: new Date().toISOString(),
          notes: [load.notes, `Paperwork sent to ${draft.target === 'rxo' ? 'RXO' : 'Paramount'}: ${(sent.files || draft.files || []).join(', ')}`].filter(Boolean).join('\n')
        }));
      } else if (draft.kind === 'driverStatus') {
        const load = findParamountLoad(draft.customer, draft.loadId);
        if (!load || String(load.paramountTracking?.freightBill) !== draft.freightBill) {
          throw new Error('The load or assigned freight bill changed. Driver update was not sent.');
        }
        if (Date.parse(draft.reportedAt) < Date.parse(load.customerStatusReportedAt)) {
          throw new Error('A newer driver status has already been sent. This older update was not sent.');
        }
        await sendEmail({
          action: 'driverStatusSend', customer: draft.customer, orderNumber: draft.loadId,
          freightBill: draft.freightBill, messageId: draft.messageId, since: draft.since, postingCode
        });
        patchParamountLoad(draft.customer, draft.loadId, current => ({
          ...current,
          customerStatusReplyIds: [...new Set([...(current.customerStatusReplyIds || []), draft.messageId])].slice(-100),
          customerStatusReportedAt: draft.reportedAt,
          notes: [current.notes, `Customer emailed driver report: ${draft.status} (${draft.reportedAt})`].filter(Boolean).join('\n')
        }));
      } else if (draft.kind === 'dailyCustomer') {
        const load = findParamountLoad(draft.customer, draft.loadId);
        if (!load || !isDailyCustomerUpdateDue(load, load.paramountTracking || {})) {
          setParamountDrafts(current => current.filter(item => item.id !== draft.id));
          return;
        }
        await sendEmail({
          action: 'dailyCustomerSend', customer: draft.customer, orderNumber: draft.loadId,
          day: draft.day, text: draft.text, postingCode
        });
        patchParamountLoad(draft.customer, draft.loadId, load => markParamountEmail(load, 'location'));
      } else if (draft.kind === 'manualUpdate') {
        // Same customer-thread send as a check call (Paramount rate con, RXO threads, or the
        // customer's own chain); a fresh time makes each update its own email.
        await sendEmail({
          action: 'checkCallSend', customer: draft.customer, orderNumber: draft.loadId,
          checkCallAt: new Date(Number(draft.id.split('|').pop()) || Date.now()).toISOString(), text: draft.text, postingCode
        });
        const label = (manualUpdateKinds.find(([value]) => value === draft.updateKind) || [])[1] || 'Update';
        patchParamountLoad(draft.customer, draft.loadId, load => {
          const noted = { ...load, notes: [load.notes, `Customer update sent by hand: ${label}${draft.updateTime ? ` (${draft.updateTime})` : ''}`].filter(Boolean).join('\n') };
          // Sent by hand: the automatic email for the same step doesn't go out again.
          return ['arrived', 'departed', 'arrivedDelivery', 'delivered'].includes(draft.updateKind) && getTrackingEmailBroker(draft.customer)
            ? markParamountEmail(noted, draft.updateKind) : noted;
        });
      } else if (draft.kind === 'checkCall') {
        await sendEmail({
          action: 'checkCallSend', customer: draft.customer, orderNumber: draft.loadId,
          checkCallAt: draft.checkCallAt, text: draft.text, postingCode
        });
        patchParamountLoad(draft.customer, draft.loadId, load => ({
          ...load, checkCalls: (load.checkCalls || []).map(call => call.at === draft.checkCallAt
            ? { ...call, customerEmailPending: false, customerEmailedAt: new Date().toISOString() } : call)
        }));
      } else if (isDriver) {
        if (['pod', 'podReminder'].includes(draft.driverKind)) {
          const load = findParamountLoad(draft.customer, draft.loadId);
          if (!load) throw new Error('Load no longer available. POD request was not sent.');
          const paperwork = await checkBeforePodRequest(load, { ...load.paramountTracking, freightBill: draft.freightBill });
          if (paperwork.received) {
            recordDriverPaperwork(draft.customer, load, paperwork.files);
            return;
          }
        }
        const text = draft.text
          .replace(/(\*\*\* IMPORTANT: PLEASE TURN ON [^\r\n]*?) NOW \*\*\*/g, '$1 ON THE DAY OF PICKUP ***')
          .replace('Please open the Trucker Tools app and start tracking for this load now.',
            'Please open the Trucker Tools app and start tracking for this load on the day of pickup.');
        await sendEmail({ action: 'driverSend', freightBill: draft.freightBill, text, postingCode });
        patchParamountLoad(draft.customer, draft.loadId, load => markDriverEmail(load, draft.driverKind));
      } else if (draft.kind === 'rxoForward') {
        throw new Error('Separate forwards to Ivan are disabled. Use reply-all on the customer request.');
      } else if (draft.kind === 'customerUpdate') {
        await sendEmail({
          action: 'customerSend', threadId: draft.threadId, messageId: draft.messageId,
          orderNumber: draft.loadId, text: draft.text, postingCode
        });
        markCustomerHandled(draft.messageId);
        patchParamountLoad(draft.customer, draft.loadId, load => ({ ...load, notes: [load.notes, 'Customer update request answered'].filter(Boolean).join('\n') }));
      } else if (isRxo) {
        const text = auto && postingCode === 'SNB' && currentLoad
          ? buildRxoUpdateEmail(currentLoad, currentLoad.paramountTracking || {}, { phone: paramountLatest.phone, availableOnly: true }).text
          : draft.text;
        await sendEmail({ action: 'rxoSend', threadId: draft.threadId, text, postingCode });
        markRxoHandled(draft.messageId);
        patchParamountLoad(draft.customer, draft.loadId, load => ({ ...load, notes: [load.notes, 'RXO update request answered'].filter(Boolean).join('\n') }));
      } else if (draft.kind === 'driverEta') {
        await sendEmail({ action: 'send', orderNumber: draft.loadId, text: draft.text, postingCode });
        patchParamountLoad(draft.customer, draft.loadId, load => ({ ...load, notes: [load.notes, 'Paramount email sent: driver ETA'].filter(Boolean).join('\n') }));
      } else {
        await sendEmail({
          action: 'send', orderNumber: draft.loadId, text: draft.text, postingCode,
          ...(getTrackingEmailBroker(draft.customer) === 'rxo' ? { broker: 'rxo' } : {})
        });
        patchParamountLoad(draft.customer, draft.loadId, load => markParamountEmail(load, draft.kind));
      }
      if (!auto && draft.kind !== 'manualUpdate') {
        const key = isPaperwork ? paperworkApprovedKey : isDriver ? driverApprovedKey : isRxo || draft.kind === 'customerUpdate' ? rxoApprovedKey : paramountApprovedKey;
        try { localStorage.setItem(key, String(readApprovedCount(key) + 1)); } catch { /* counts again next time */ }
      }
      setParamountDrafts(current => current.filter(item => item.id !== draft.id));
    } catch (error) {
      // The email record says this email already went out (or Daniel chose "Don't send"):
      // settle the draft on the load so it isn't drafted again, and say why in the notes.
      if (error.emailRecord === 'sent' || error.emailRecord === 'skipped') {
        settleDraftOnLoad(draft);
        patchParamountLoad(draft.customer, draft.loadId, load => ({ ...load, notes: [load.notes, error.message].filter(Boolean).join('\n') }));
        return;
      }
      // Shown in the panel so nothing goes missing silently.
      setParamountDrafts(current => (current.some(item => item.id === draft.id)
        ? current.map(item => (item.id === draft.id ? { ...item, sending: false, retryNote: '', error: error.message } : item))
        : [...current, { ...draft, sending: false, retryNote: '', error: error.message }]));
      if (auto) throw error;
    }
  };

  // "✉ Customer update" on a booked load: an email Daniel writes himself (with the real time),
  // sent reply-all on the customer's thread. Only one open at a time per load.
  const composeCustomerUpdate = (customer, load) => {
    setParamountDrafts(current => {
      if (current.some(item => item.kind === 'manualUpdate' && item.customer === customer && item.loadId === String(load.id))) return current;
      const updateKind = 'departed';
      return [...current, {
        id: `manual|${customer}|${load.id}|${Date.now()}`, kind: 'manualUpdate', customer, loadId: String(load.id),
        updateKind, updateTime: '', text: buildManualUpdateEmail(updateKind, load, { phone: paramountLatest.phone })
      }];
    });
  };

  const skipParamountDraft = draft => {
    if (draft.kind === 'manualUpdate') {
      setParamountDrafts(current => current.filter(item => item.id !== draft.id));
      return;
    }
    recordSkippedEmail(draft);
    settleDraftOnLoad(draft);
  };

  // Marks a draft as handled on its load (not sent) and removes it from the list.
  const settleDraftOnLoad = draft => {
    if (draft.kind === 'rxo') markRxoHandled(draft.messageId);
    else if (draft.kind === 'customerUpdate') markCustomerHandled(draft.messageId);
    else if (draft.kind === 'checkCall') patchParamountLoad(draft.customer, draft.loadId, load => ({
      ...load, checkCalls: (load.checkCalls || []).map(call => call.at === draft.checkCallAt
        ? { ...call, customerEmailPending: false, customerEmailSkipped: true } : call)
    }));
    else if (draft.kind === 'driverEta' || draft.kind === 'driverStatus' || draft.kind === 'rxoForward') { /* nothing to record */ }
    else if (draft.kind === 'paperwork') patchParamountLoad(draft.customer, draft.loadId, load => ({ ...load, paperworkDone: true, notes: [load.notes, 'Paperwork not sent to the customer (skipped)'].filter(Boolean).join('\n') }));
    else if (draft.kind === 'driver') patchParamountLoad(draft.customer, draft.loadId, load => markDriverEmail(load, draft.driverKind, { skipped: true }));
    else patchParamountLoad(draft.customer, draft.loadId, load => markParamountEmail(load, draft.kind, { skipped: true }));
    setParamountDrafts(current => current.filter(item => item.id !== draft.id));
  };

  // Booked Loads: bring the first card matching the search into view.
  useEffect(() => {
    if (view !== 'booked' || !searchQuery.trim() || typeof document === 'undefined') return undefined;
    const timer = setTimeout(() => {
      document.querySelector('[data-search-match="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => clearTimeout(timer);
  }, [view, searchQuery]);

  // Paramount tracking emails: tells the bot which booked Paramount loads to read in
  // Clarity, turns its results into emails (approved by hand for the first few, then sent
  // automatically) and checks the email threads for Paramount's replies.
  // Keep this the last effect: tests address earlier effects by position.
  useEffect(() => {
    let cancelled = false;
    let emailWorker;
    let maintenanceError = '';
    let maintenanceFailures = 0;
    const syncPostingMaintenance = async () => {
      if (!canStartBotHere()) return;
      try {
        const response = await fetch('http://127.0.0.1:47615/posting-maintenance', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loads: getPostingMaintenanceLoads(paramountLatest.map) }),
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error(`posting bot returned HTTP ${response.status}; restart it to load the posting protections and refresh worker`);
        maintenanceError = '';
        maintenanceFailures = 0;
      } catch (error) {
        // One slow answer while the bot is busy uploading is normal (Daniel 2026-11-27: "signal
        // timed out" while lists imported): warn only after 3 failures in a row (30 seconds).
        maintenanceFailures += 1;
        if (maintenanceFailures < 3) return;
        const message = `Posting protection / important-load refresh is not connected: ${error.message}`;
        if (!cancelled && message !== maintenanceError) pushNotice(message);
        maintenanceError = message;
        console.error(message);
      }
    };
    void syncPostingMaintenance();
    const maintenanceTimer = setInterval(syncPostingMaintenance, 10000);
    // Uploads Landstar confirmed (the bot's upload ledger): loads sent to the bot turn Posted.
    const syncPostedConfirmations = async () => {
      if (!canStartBotHere()) return;
      try {
        const response = await fetch(`http://127.0.0.1:47615/posted?since=${postedConfirmations.since}`, { signal: AbortSignal.timeout(15000) });
        if (response.status === 404) { postedConfirmations.supported = false; return; }
        if (!response.ok) return;
        const { signatures = [] } = await response.json();
        postedConfirmations.supported = true;
        for (const [key, at] of signatures) {
          postedConfirmations.keys.set(key, at);
          if (Number(at) > postedConfirmations.since) postedConfirmations.since = Number(at);
        }
        const confirmedAt = new Date().toISOString();
        for (const [customer, loads] of Object.entries(paramountLatest.map || {})) {
          for (const load of loads || []) {
            if (!load.landstarExportedAt || load.landstarConfirmedAt || !load.landstarPosting) continue;
            if (postedConfirmations.keys.has(landstarPostingKey(load.landstarPosting))) {
              patchParamountLoad(customer, load.id, current => (current.landstarConfirmedAt ? current : { ...current, landstarConfirmedAt: confirmedAt }));
            }
          }
        }
      } catch {
        // The bot is not answering: try again next time.
      }
    };
    // Loads still NOT CONFIRMED 3+ hours after export go to the bot, so the alert email can tell
    // Daniel (bot/alerts.js; Daniel 2026-11-27). Sent every few minutes, an empty list included.
    let unconfirmedSentAt = 0;
    const reportUnconfirmed = async () => {
      if (!canStartBotHere() || !postedConfirmations.supported || Date.now() - unconfirmedSentAt < 3 * 60 * 1000) return;
      unconfirmedSentAt = Date.now();
      const loads = [];
      for (const [customer, list] of Object.entries(paramountLatest.map || {})) {
        for (const load of list || []) {
          if (getPostingState(load) === 'error' && load.landstarExportedAt && !load.landstarConfirmedAt
            && !hasOpenLandstarError(load) && !load.exportError) {
            loads.push({ customer, id: String(load.id), exportedAt: load.landstarExportedAt, route: [`${load.origCity || ''}, ${load.origSt || ''}`, `${load.destCity || ''}, ${load.destSt || ''}`].join(' -> ') });
          }
        }
      }
      try {
        await fetch('http://127.0.0.1:47615/unconfirmed', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loads }), signal: AbortSignal.timeout(10000)
        });
      } catch {
        // The bot is not answering: try again next time.
      }
    };
    const syncAndReport = async () => { await syncPostedConfirmations(); await reportUnconfirmed(); };
    void syncAndReport();
    const confirmationsTimer = setInterval(syncAndReport, 20000);
    const onRefreshIssue = event => {
      if (event.detail?.message) pushNotice(event.detail.message);
    };
    window.addEventListener('landstar-refresh-issue', onRefreshIssue);
    const pendingTrackingEmails = new Map();
    const emailIssue = (message, error) => {
      const detail = error ? `${message}: ${error.message}` : message;
      console.warn(detail);
      if (emailWorker?.reportIssue(detail)) throw new Error(detail);
    };
    const pushWatchList = async () => {
      if (!canStartBotHere()) return;
      // Freight bills from the BCO Load Detail emails, read again every 5 minutes: the bot opens
      // them in Clarity when a booked truck isn't in Clarity's freight list yet.
      if (Date.now() - bcoBillsCache.at > 5 * 60 * 1000) {
        try {
          bcoBillsCache.bills = (await callParamountEmail({ action: 'bcoBills' })).bills || [];
          bcoBillsCache.at = Date.now();
        } catch (error) {
          emailIssue('Could not refresh BCO freight bills', error);
        }
      }
      try {
        const response = await fetch(BOT_TRACKING_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loads: getTrackingWatchList(paramountLatest.map), candidateBills: bcoBillsCache.bills }),
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error(`Tracking worker returned HTTP ${response.status}`);
      } catch (error) {
        emailIssue('Tracking feed unavailable; driver-reply checks still run', error);
      }
    };
    const prepare = async (customer, load, kind, info) => {
      // The daily location email has one id per day, so tomorrow's isn't blocked by today's.
      const id = trackingEmailId(customer, load.id, kind);
      if (paramountBusy.has(id)) return;
      paramountBusy.add(id);
      try {
        const thread = await callParamountEmail({
          action: 'thread', orderNumber: String(load.id),
          ...(getTrackingEmailBroker(customer) === 'rxo' ? { broker: 'rxo', postingCode: getEmailPostingCode(load, paramountLatest.postingCode) } : {})
        });
        if (cancelled) return;
        const text = buildParamountEmail(kind, load, info, { greetingName: greetingNameFrom(thread.to?.[0]), phone: paramountLatest.phone });
        // Loaded: automatic, except a short stop at the shipper. Any check-in / check-out with
        // the truck more than 10 miles from the stop waits for Daniel's Send too.
        const warning = getTrackingEmailWarning(kind, info);
        const draft = { id, customer, loadId: String(load.id), kind, text, to: thread.to || [], cc: thread.cc || [], ...(warning ? { warning } : {}) };
        if (!warning && (kind === 'departed' || paramountMaySendItself(kind))) {
          await sendParamountDraft(draft, { auto: true });
        } else {
          setParamountDrafts(current => (current.some(item => item.id === id) ? current : [...current, draft]));
        }
      } catch (error) {
        // Usually the rate confirmation email isn't in Gmail yet: try again with the next result.
        emailIssue(`Broker email for order ${load.id} not ready`, error);
        paramountBusy.delete(id);
      }
    };
    const onTrackingResult = event => {
      const info = event.detail || {};
      const load = findParamountLoad(info.customer, info.loadId);
      if (!load || !info.ok) return;
      const updated = applyParamountTrackingInfo(load, info);
      const { checkedAt: oldChecked, ...before } = load.paramountTracking || {};
      const { checkedAt: newChecked, ...after } = updated.paramountTracking || {};
      if (JSON.stringify(before) !== JSON.stringify(after) || updated.trackingStage !== load.trackingStage) {
        patchParamountLoad(info.customer, info.loadId, current => applyParamountTrackingInfo(current, info));
      }
      if (!getTrackingEmailBroker(info.customer)) return; // Paramount and RXO send tracking emails
      pendingTrackingEmails.set(`${info.customer}|${info.loadId}`, info);
      if (!emailWorker?.isOwner()) return;
      // MercuryGate: once the freight bill is known (and again after pickup for the PDF).
      queueMercuryGateJobs();
      emailWorker.request('tracking-emails');
    };
    const checkTrackingEmails = async () => {
      for (const [key, info] of pendingTrackingEmails) {
        if (cancelled) return;
        pendingTrackingEmails.delete(key);
        const load = findParamountLoad(info.customer, info.loadId);
        if (!load || load.status !== 'BOOKED') continue;
        const updated = applyParamountTrackingInfo(load, info);
        for (const kind of getDueParamountEmails(updated, info).filter(kind => kind !== 'location')) {
          if (cancelled) return;
          await prepare(info.customer, updated, kind, info);
        }
      }
    };
    // MercuryGate jobs for booked Paramount loads: as soon as the truck is assigned on Landstar
    // (or the freight bill is known), and the PDF upload after pickup. Checked every minute.
    const queueMercuryGateJobs = () => {
      if (!automationPolicy.automaticDispatchEnabled) return;
      if (!canStartBotHere()) return;
      for (const { customer, load } of getBookedLoads(paramountLatest.map)) {
        if (!isParamountTrackingCustomer(customer)) continue;
        const tracking = load.paramountTracking || {};
        const step = getDueMercuryGateStep(load, tracking);
        if (!step) continue;
        const id = `mg|${customer}|${load.id}|${step}`;
        if (paramountBusy.has(id)) continue;
        paramountBusy.add(id);
        fetch(BOT_MERCURYGATE_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobs: [{ customer, loadId: String(load.id), freightBill: getMercuryGateSearchNumber(load, tracking), step, mode: 'save' }] })
        }).then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          patchParamountLoad(customer, load.id, current => ({ ...current, mercurygate: { ...(current.mercurygate || {}), [step]: new Date().toISOString() } }));
        }).catch(() => paramountBusy.delete(id));
      }
    };
    const checkReplies = async () => {
      if (!canStartBotHere()) return;
      for (const entry of getParamountWatchList(paramountLatest.map)) {
        const load = findParamountLoad(entry.customer, entry.loadId);
        const tracking = load?.paramountTracking;
        const firstSent = Object.values(tracking?.emails || {}).filter(item => !item.skipped).map(item => item.at).sort()[0];
        if (!firstSent) continue;
        try {
          const result = await callParamountEmail({ action: 'thread', orderNumber: entry.loadId, since: tracking.repliesSeenAt || firstSent });
          const replies = (result.replies || []).filter(reply => !(tracking.replyIds || []).includes(reply.id));
          if (cancelled || !replies.length) continue;
          setParamountReplies(current => [...current, ...replies
            .filter(reply => !current.some(item => item.id === reply.id))
            .map(reply => ({ ...reply, customer: entry.customer, loadId: entry.loadId, threadId: result.threadId }))]);
          patchParamountLoad(entry.customer, entry.loadId, current => {
            const lines = replies.map(reply => `Paramount reply from ${reply.from.replace(/<[^>]*>/, '').trim()}: ${reply.snippet}`);
            const seen = current.paramountTracking || {};
            return {
              ...current,
              paramountTracking: {
                ...seen,
                repliesSeenAt: replies.map(reply => reply.at).sort().pop(),
                replyIds: [...(seen.replyIds || []), ...replies.map(reply => reply.id)].slice(-30)
              },
              notes: [current.notes, ...lines].filter(Boolean).join('\n')
            };
          });
        } catch (error) {
          emailIssue(`Could not check broker replies for order ${entry.loadId}`, error);
        }
      }
    };
    // RXO "Update Request - Order #" emails about booked RXO loads: draft (or send) a reply.
    const checkRxoRequests = async () => {
      if (!canStartBotHere()) return;
      let requests = [];
      try {
        const result = await callParamountEmail({
          action: 'rxoRequests', postingCodes: getRxoEmailPostingCodes(paramountLatest.map, paramountLatest.postingCode)
        });
        requests = result.requests || [];
      } catch (error) {
        emailIssue('Could not check RXO update requests', error);
        return;
      }
      const handled = new Set(readRxoHandled());
      for (const request of requests) {
        const id = `rxo|${request.messageId}`;
        if (cancelled || handled.has(request.messageId) || paramountBusy.has(id)) continue;
        const match = findRxoLoadForRequest(paramountLatest.map, request.orderNumber);
        if (!match) {
          emailIssue(`RXO order ${request.orderNumber}: no matching booked load; broker update was not sent.`);
          const warningId = `rxoMissing|${request.messageId}`;
          if (!paramountBusy.has(warningId)) {
            paramountBusy.add(warningId);
            pushNotice(`RXO order ${request.orderNumber}: no matching booked load in this TMS. Customer update was not sent. Only confirmed SNB loads are copied to Ivan.`);
          }
          continue;
        }
        if (!hasPickupDayStarted(match.load)) continue;
        paramountBusy.add(id);
        const snb = getEmailPostingCode(match.load, paramountLatest.postingCode) === 'SNB';
        const { text, complete } = buildRxoUpdateEmail(match.load, match.load.paramountTracking || {}, {
          phone: paramountLatest.phone, availableOnly: snb
        });
        const draft = {
          id, kind: 'rxo', customer: match.customer, loadId: String(match.load.id), threadId: request.threadId,
          messageId: request.messageId, request: request.snippet, text, complete, to: request.to || [], cc: request.cc || []
        };
        if (snb || (complete && readApprovedCount(rxoApprovedKey) >= PARAMOUNT_AUTO_SEND_AFTER)) {
          await sendParamountDraft(draft, { auto: true });
        } else {
          setParamountDrafts(current => (current.some(item => item.id === id) ? current : [...current, draft]));
        }
      }
    };
    // Any customer emailing about a booked load number asking for an update gets the Clarity
    // update on that thread (Daniel's rule, 2026-11-20). Sent automatically once the RXO update
    // replies have been approved 3 times and nothing in the update is blank; else it waits as a draft.
    const checkCustomerRequests = async () => {
      if (!canStartBotHere()) return;
      const postingCodes = getCustomerRequestOrders(paramountLatest.map, paramountLatest.postingCode);
      if (!Object.keys(postingCodes).length) return;
      let requests = [];
      try {
        requests = (await callParamountEmail({ action: 'customerRequests', postingCodes })).requests || [];
      } catch (error) {
        emailIssue('Could not check customer update requests', error);
        return;
      }
      const handled = new Set(readCustomerHandled());
      for (const request of requests) {
        const id = `customer|${request.messageId}`;
        if (cancelled || handled.has(request.messageId) || paramountBusy.has(id)) continue;
        const match = getBookedLoads(paramountLatest.map).find(({ load }) => String(load.id) === request.orderNumber);
        if (!match) continue;
        paramountBusy.add(id);
        const snb = getEmailPostingCode(match.load, paramountLatest.postingCode) === 'SNB';
        const { text, complete } = buildRxoUpdateEmail(match.load, match.load.paramountTracking || {}, {
          phone: paramountLatest.phone, availableOnly: snb
        });
        const draft = {
          id, kind: 'customerUpdate', customer: match.customer, loadId: String(match.load.id), threadId: request.threadId,
          messageId: request.messageId, request: request.snippet, text, complete, to: request.to || [], cc: request.cc || []
        };
        try {
          if (complete && hasPickupDayStarted(match.load) && readApprovedCount(rxoApprovedKey) >= PARAMOUNT_AUTO_SEND_AFTER) {
            await sendParamountDraft(draft, { auto: true });
          } else {
            setParamountDrafts(current => (current.some(item => item.id === id) ? current : [...current, draft]));
          }
        } catch (error) {
          emailIssue(`Could not answer the update request for load ${match.load.id}`, error);
        }
      }
    };
    // Driver emails for every booked load the bot found in Clarity (morning checks, picked up,
    // delivered). Runs every few minutes, so a 7:00 AM email goes out on the first check after 7.
    const checkDriverEmails = async () => {
      if (!canStartBotHere()) return;
      const now = Date.now();
      // Paramount loads still waiting on the Trucker Tools "tracking started" email: look in Gmail
      // (every 5 minutes) and mark the ones that started, so their reminders stop.
      const waitingTracking = getBookedLoads(paramountLatest.map)
        .filter(({ customer, load }) => isParamountTrackingCustomer(customer) && !load.trackingStartedAt && load.trackingStage !== 'Delivered');
      if (waitingTracking.length && now - truckerToolsCache.at > 5 * 60 * 1000) {
        truckerToolsCache.at = now;
        try {
          truckerToolsCache.starts = (await callParamountEmail({ action: 'truckerToolsStarts' })).starts || [];
          truckerToolsCache.okAt = Date.now();
        } catch (error) {
          emailIssue('Could not check the Trucker Tools emails', error);
        }
      }
      const startedNow = new Set();
      for (const { customer, load } of waitingTracking) {
        const startedAt = findTruckerToolsStart(load, truckerToolsCache.starts);
        if (!startedAt) continue;
        startedNow.add(`${customer}|${load.id}`);
        patchParamountLoad(customer, load.id, current => (current.trackingStartedAt ? current : markTrackingStarted(current, startedAt)));
        setParamountDrafts(current => current.filter(item => !(item.driverKind === 'trackingReminder' && item.customer === customer && item.loadId === String(load.id))));
      }
      // Reminders only go out when the Gmail check worked lately (never on a stale "not started").
      const trackingCheckFresh = Date.now() - (truckerToolsCache.okAt || 0) < 15 * 60 * 1000;
      for (const { customer, load } of getBookedLoads(paramountLatest.map)) {
        const tracking = load.paramountTracking || {};
        let dueKinds = getDueDriverEmails(load, tracking, now);
        if (!dueKinds.length && trackingCheckFresh && !startedNow.has(`${customer}|${load.id}`) && isTrackingReminderDue(load, customer, tracking, now)) {
          dueKinds = ['trackingReminder'];
        }
        for (const driverKind of dueKinds) {
          // One id per real email: tracking reminders are numbered, POD reminders dated.
          const id = driverEmailId(customer, load, driverKind, now);
          if (cancelled || paramountBusy.has(id)) continue;
          paramountBusy.add(id);
          try {
            if (['pod', 'podReminder'].includes(driverKind)) {
              const paperwork = await checkBeforePodRequest(load, tracking);
              if (cancelled) return;
              if (paperwork.received) {
                recordDriverPaperwork(customer, load, paperwork.files);
                paramountBusy.delete(id);
                continue;
              }
            }
            const thread = await callParamountEmail({ action: 'driverThread', freightBill: tracking.freightBill });
            const draft = {
              id, kind: 'driver', driverKind, customer, loadId: String(load.id), freightBill: tracking.freightBill,
              text: buildDriverEmail(driverKind, load, tracking, { phone: paramountLatest.phone, customer }),
              to: thread.to || [], cc: thread.cc || []
            };
            if (readApprovedCount(driverApprovedKey) >= PARAMOUNT_AUTO_SEND_AFTER) {
              await sendParamountDraft(draft, { auto: true });
            } else {
              setParamountDrafts(current => (current.some(item => item.id === id) ? current : [...current, draft]));
            }
          } catch (error) {
            // Usually no BCO Load Detail email for that freight bill: try again next time.
            emailIssue(`Driver email for load ${load.id} not ready`, error);
            paramountBusy.delete(id);
          }
        }
      }
    };
    // Delivered loads still waiting on paperwork: when the driver's reply has the POD attached,
    // the load is marked "paperwork received" and (Paramount / RXO) the files are forwarded on
    // the existing customer's tracking email thread automatically.
    const checkPaperwork = async () => {
      if (!canStartBotHere()) return;
      for (const { customer, load } of getBookedLoads(paramountLatest.map)) {
        const tracking = load.paramountTracking || {};
        const deliveredAt = getDeliveredAt(load, tracking);
        // Already sent to the customer once: never again (even if the load is put back on the list).
        if (!deliveredAt || load.paperworkDone || load.paperworkSentAt || !tracking.freightBill) continue;
        if (Date.now() - deliveredAt > (PAPERWORK_REMINDER_DAYS + 3) * 86400000) continue;
        const id = `paperwork|${customer}|${load.id}`;
        if (cancelled || paramountBusy.has(id)) continue;
        paramountBusy.add(id);
        try {
          // From a day before delivery (scheduled or actual, whichever is earlier): drivers often send
          // the POD before the load is marked delivered.
          const since = getPaperworkSince(load, tracking);
          let names = Array.isArray(load.paperworkFiles) ? load.paperworkFiles : [];
          const target = getPaperworkTarget(customer);
          // Received but not sent yet (e.g. the tab reloaded before the Send click):
          // skip straight to rebuilding the waiting email below.
          if (!load.paperworkReceivedAt) {
            const { files = [] } = await callParamountEmail({ action: 'driverPaperwork', freightBill: tracking.freightBill, since });
            if (cancelled || !files.length) { paramountBusy.delete(id); continue; }
            const receivedAt = files[files.length - 1].at;
            names = files.map(file => file.filename);
            patchParamountLoad(customer, load.id, current => ({
              ...current,
              paperworkReceivedAt: receivedAt,
              paperworkFiles: names,
              paperworkSince: since,
              paperworkDone: !target,
              notes: [current.notes, `Paperwork received from the driver: ${names.join(', ')}${target ? '' : ' (no customer tracking email to send it to)'}`].filter(Boolean).join('\n')
            }));
            recordDriverPaperwork(customer, load, files);
            alertDriverReply(`Paperwork received · load #${load.id}`, `${names.join(', ')}${target ? ' · ready to send to the customer' : ''}`);
          }
          if (!target || cancelled) continue;
          let greetingName = '';
          if (target === 'paramount') {
            const thread = await callParamountEmail({ action: 'thread', orderNumber: String(load.id) }).catch(() => ({}));
            greetingName = greetingNameFrom(thread.to?.[0]);
          }
          const draft = {
            id, kind: 'paperwork', target, customer, loadId: String(load.id), freightBill: tracking.freightBill, since,
            files: names, text: buildPaperworkEmail(load, tracking, { greetingName, phone: paramountLatest.phone })
          };
          await sendParamountDraft(draft, { auto: true });
        } catch (error) {
          emailIssue(`Paperwork check for load ${load.id}`, error);
          paramountBusy.delete(id);
        }
      }
    };
    // Driver replies in the BCO Load Detail threads: badge on the load, a note, and a pop-up.
    let checkingDriverReplies = false;
    const checkDriverReplies = async () => {
      if (!canStartBotHere() || checkingDriverReplies) return;
      checkingDriverReplies = true;
      try {
      for (const { customer, load } of getBookedLoads(paramountLatest.map)) {
        if (cancelled) return;
        if (!hasPickupDayStarted(load)) continue;
        const freightBill = load.paramountTracking?.freightBill;
        // From the first driver email the TMS sent, or from booking when Daniel emails the driver himself.
        const firstSent = Object.values(load.driverEmails || {}).filter(item => !item.skipped).map(item => item.at).sort()[0] || load.bookedAt;
        if (!freightBill || !firstSent) continue;
        try {
          const result = await callParamountEmail({ action: 'driverThread', freightBill, since: firstSent });
          if (cancelled) continue;
          const statusReply = getPendingDriverStatusReply(load, result.replies);
          if (statusReply) {
            const id = `driverStatus|${customer}|${load.id}|${statusReply.id}`;
            if (!paramountBusy.has(id)) {
              paramountBusy.add(id);
              try {
                await sendParamountDraft({
                  id, kind: 'driverStatus', customer, loadId: String(load.id), freightBill: String(freightBill),
                  messageId: statusReply.id, since: firstSent, status: statusReply.status, reportedAt: statusReply.at,
                  text: `Driver reports ${statusReply.status} for order ${load.id}. Received ${statusReply.at}.`,
                  request: statusReply.snippet
                }, { auto: true });
              } finally {
                paramountBusy.delete(id);
              }
            }
          }
          const replies = (result.replies || []).filter(reply => !(load.driverReplyIds || []).includes(reply.id));
          // ETAs: every driver reply not used yet (also ones already shown before this was added).
          const etaReplies = (result.replies || []).filter(reply => !(load.etaReplyIds || []).includes(reply.id));
          if (replies.length) {
          setParamountReplies(current => [...current, ...replies
            .filter(reply => !current.some(item => item.id === reply.id))
            .map(reply => ({ ...reply, customer, loadId: String(load.id), threadId: result.threadId, driver: true }))]);
          patchParamountLoad(customer, load.id, current => ({
            ...current,
            driverRepliesSeenAt: replies.map(reply => reply.at).sort().pop(),
            driverReplyIds: [...(current.driverReplyIds || []), ...replies.map(reply => reply.id)].slice(-30),
            notes: [current.notes, ...replies.map(reply => `Driver reply from ${reply.from.replace(/<[^>]*>/, '').trim()}: ${reply.snippet}`)].filter(Boolean).join('\n')
          }));
          replies.forEach(reply => alertDriverReply(`Driver replied · load #${load.id}`, `${reply.from.replace(/<[^>]*>/, '').trim()}: ${reply.snippet}`, result.threadId));
          }
          // An ETA in the driver's reply on a Paramount load goes to Paramount's email thread.
          if (isParamountTrackingCustomer(customer)) {
            for (const reply of etaReplies) {
              const eta = findDriverEta(reply.snippet);
              if (!eta) continue;
              const id = `eta|${reply.id}`;
              if (paramountBusy.has(id)) continue;
              paramountBusy.add(id);
              patchParamountLoad(customer, load.id, current => ({ ...current, etaReplyIds: [...(current.etaReplyIds || []), reply.id].slice(-30) }));
              try {
                const thread = await callParamountEmail({ action: 'thread', orderNumber: String(load.id) });
                const draft = {
                  id, kind: 'driverEta', customer, loadId: String(load.id), request: reply.snippet,
                  text: buildParamountEtaEmail(load, load.paramountTracking || {}, eta, { greetingName: greetingNameFrom(thread.to?.[0]), phone: paramountLatest.phone }),
                  to: thread.to || [], cc: thread.cc || []
                };
                if (readParamountApprovedCount() >= PARAMOUNT_AUTO_SEND_AFTER) await sendParamountDraft(draft, { auto: true });
                else setParamountDrafts(current => (current.some(item => item.id === id) ? current : [...current, draft]));
              } catch (error) {
                emailIssue(`Could not prepare the ETA email for order ${load.id}`, error);
                paramountBusy.delete(id);
              }
            }
          }
        } catch (error) {
          emailIssue(`Could not check driver replies for load ${load.id}`, error);
        }
      }
      } finally {
        checkingDriverReplies = false;
      }
    };
    // Driver replies on every BCO Load Detail email Daniel sent lately, also for loads that aren't
    // booked in the TMS (no load card): one pop-up, and a list at the top of Booked Loads.
    const checkOtherDriverReplies = async () => {
      if (!canStartBotHere()) return;
      if (!bcoBillsCache.bills.length) {
        try {
          bcoBillsCache.bills = (await callParamountEmail({ action: 'bcoBills' })).bills || [];
          bcoBillsCache.at = Date.now();
        } catch (error) {
          emailIssue('Could not list the BCO Load Detail emails', error);
          return;
        }
      }
      const bookedBills = new Set(getBookedLoads(paramountLatest.map).map(({ load }) => String(load.paramountTracking?.freightBill || '')).filter(Boolean));
      const seen = new Set(readSeenDriverReplies());
      const fresh = [];
      for (const bill of bcoBillsCache.bills.filter(item => !bookedBills.has(String(item)))) {
        try {
          const result = await callParamountEmail({ action: 'driverThread', freightBill: bill, since: new Date(Date.now() - 36 * 3600000).toISOString() });
          (result.replies || []).filter(reply => !seen.has(reply.id)).forEach(reply => fresh.push({ ...reply, freightBill: String(bill), threadId: result.threadId }));
        } catch (error) {
          emailIssue(`Could not check driver replies on freight bill ${bill}`, error);
        }
        if (cancelled) return;
      }
      if (!fresh.length) return;
      markSeenDriverReplies(fresh.map(reply => reply.id));
      setParamountReplies(current => [...current, ...fresh
        .filter(reply => !current.some(item => item.id === reply.id))
        .map(reply => ({ ...reply, customer: '', loadId: '', driver: true }))]);
      fresh.forEach(reply => alertDriverReply(`Driver replied · freight bill ${reply.freightBill}`, `${reply.from.replace(/<[^>]*>/, '').trim()}: ${reply.snippet}`, reply.threadId));
    };
    // The weekly fuel surcharge email: checked shortly after opening and every hour.
    const checkFuelEmail = async () => {
      if (!canStartBotHere()) return;
      try {
        const found = await callParamountEmail({ action: 'fuelRates' });
        if (!cancelled) applyFuelSurchargeEmail(found);
      } catch (error) {
        emailIssue('Could not check the fuel surcharge email', error);
      }
    };
    const checkDailyCustomerUpdates = async () => {
      if (!canStartBotHere()) return;
      const now = Date.now();
      const date = new Date(now);
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      for (const { customer, load } of getBookedLoads(paramountLatest.map)) {
        if (cancelled) return;
        const tracking = load.paramountTracking || {};
        if (!isDailyCustomerUpdateDue(load, tracking, now)) continue;
        const id = dailyCustomerEmailId(customer, load.id, now);
        if (paramountBusy.has(id)) continue;
        paramountBusy.add(id);
        try {
          await sendParamountDraft({
            id, kind: 'dailyCustomer', customer, loadId: String(load.id), day,
            text: buildParamountEmail('location', load, tracking, { phone: paramountLatest.phone })
          }, { auto: true });
        } finally {
          paramountBusy.delete(id);
        }
      }
    };
    const checkCallEmails = async () => {
      if (!canStartBotHere()) return;
      for (const { customer, load } of getBookedLoads(paramountLatest.map)) {
        for (const call of load.checkCalls || []) {
          if (cancelled) return;
          if (!call.customerEmailPending || !hasPickupDayStarted(load)) continue;
          const id = `checkCall|${customer}|${load.id}|${call.at}`;
          if (paramountBusy.has(id)) continue;
          paramountBusy.add(id);
          try {
            await sendParamountDraft({
              id, kind: 'checkCall', customer, loadId: String(load.id), checkCallAt: call.at,
              text: `Hello team,\n\nCheck call update for order #${load.id}:\n\n${call.note}\n\nReported stage: ${call.stage}\nCheck call logged: ${formatCheckTime(call.at)}.\n\nThank you!\n\n${paramountSignature(paramountLatest.phone)}`
            }, { auto: true });
          } finally {
            paramountBusy.delete(id);
          }
        }
      }
    };
    // VIP customers (Heather): any new email from them, on any thread, right away.
    const checkVipMessages = async () => {
      if (!canStartBotHere()) return;
      try {
        const seen = JSON.parse(localStorage.getItem(vipSeenKey) || '{}');
        // First run: only mail from the last 2 hours (not the whole history).
        const fallback = Date.now() - 2 * 60 * 60 * 1000;
        const since = new Date(Math.min(...VIP_CONTACTS.map(vip => Date.parse(seen[vip.email]) || fallback))).toISOString();
        const { replies } = await callParamountEmail({ action: 'prospectReplies', addresses: VIP_CONTACTS.map(vip => vip.email), since });
        if (cancelled) return;
        for (const reply of replies || []) {
          const contact = VIP_CONTACTS.find(vip => vip.email === reply.from);
          if (!contact || Date.parse(reply.at) <= (Date.parse(seen[reply.from]) || fallback)) continue;
          seen[reply.from] = reply.at;
          try { localStorage.setItem(vipSeenKey, JSON.stringify(seen)); } catch { /* shown again next time */ }
          setVipMessages(current => (current.some(item => item.id === reply.id) ? current : [...current, { ...reply, name: contact.name }]));
          alertDriverReply(`⭐ ${contact.name} emailed you`, reply.snippet, reply.threadId);
        }
      } catch (error) {
        emailIssue('Could not check VIP emails', error);
      }
    };
    if (canStartBotHere()) {
      emailWorker = createEmailWorker({
        locks: navigator.locks,
        onStatus: emailWorkerStatusStore.set,
        tasks: [
          { id: 'driver-replies', label: 'Checking driver replies', delay: 15000, every: 120000, run: checkDriverReplies },
          { id: 'rxo-requests', label: 'Checking RXO broker requests', delay: 20000, every: 120000, run: checkRxoRequests },
          { id: 'customer-requests', label: 'Checking customer update requests', delay: 30000, every: 180000, run: checkCustomerRequests },
          { id: 'tracking-feed', label: 'Updating tracking watch list', every: 60000, run: async () => { await pushWatchList(); queueMercuryGateJobs(); } },
          { id: 'tracking-emails', label: 'Preparing tracking updates', delay: 15000, every: 120000, run: checkTrackingEmails },
          { id: 'check-call-emails', label: 'Sending logged check calls to customers', delay: 5000, every: 15000, run: checkCallEmails },
          { id: 'daily-updates', label: 'Checking daily broker updates', delay: 30000, every: 300000, run: checkDailyCustomerUpdates },
          { id: 'driver-emails', label: 'Checking driver follow-ups', delay: 15000, every: 120000, run: checkDriverEmails },
          { id: 'broker-replies', label: 'Checking broker replies', delay: 15000, every: 120000, run: checkReplies },
          { id: 'other-drivers', label: 'Checking other BCO replies', delay: 15000, every: 120000, run: checkOtherDriverReplies },
          { id: 'paperwork', label: 'Checking driver paperwork', delay: 15000, every: 120000, run: checkPaperwork },
          { id: 'vip', label: 'Checking priority broker emails', delay: 25000, every: 120000, run: checkVipMessages },
          { id: 'fuel', label: 'Checking fuel surcharge email', delay: 15000, every: 3600000, run: checkFuelEmail }
        ]
      });
      emailWorker.start();
    } else {
      emailWorkerStatusStore.set({ state: 'view-only', message: 'Email worker: local TMS only', issues: [] });
    }
    window.addEventListener('landstar-tracking-result', onTrackingResult);
    const onMercuryGateResult = event => {
      const result = event.detail || {};
      patchParamountLoad(result.customer, result.loadId, current => applyMercuryGateResult(current, result));
      // Only when the bot has given up (no pop-up for each retry while MercuryGate is down).
      if (!result.ok && !result.retrying) pushNotice(`MercuryGate: order #${result.loadId} was NOT fully filled in. ${String(result.message || '').split('\n')[0]} Please finish it by hand in MercuryGate.`);
    };
    window.addEventListener('landstar-mercurygate-result', onMercuryGateResult);
    const onDuplicateBill = event => {
      const duplicate = event.detail || {};
      pushNotice(`MercuryGate has ${duplicate.routes} routes for freight bill ${duplicate.bill}. Delete the extra route so the BCO is not tendered twice.`);
    };
    window.addEventListener('landstar-duplicate-bill', onDuplicateBill);
    return () => {
      window.removeEventListener('landstar-duplicate-bill', onDuplicateBill);
      window.removeEventListener('landstar-mercurygate-result', onMercuryGateResult);
      cancelled = true;
      emailWorker?.stop();
      clearInterval(maintenanceTimer);
      clearInterval(confirmationsTimer);
      window.removeEventListener('landstar-refresh-issue', onRefreshIssue);
      window.removeEventListener('landstar-tracking-result', onTrackingResult);
    };
  }, []);

  // Queues a full-list import's dropped loads for removal from Landstar. If an import
  // would drop more than half of a customer's posted loads, ask first: the file may be
  // cut off or misread.
  const queueDroppedPostings = (replacement, existingLoads, { interactive = true } = {}) => {
    const dropped = replacement?.droppedPostings || [];
    if (!dropped.length) return 0;
    const posted = (existingLoads || []).filter(load => load.landstarPosting).length;
    // Full customer lists queue missing postings automatically, with a large-drop safeguard.
    if (dropped.length > LARGE_DROP_MIN && dropped.length > posted / 2) {
      const ok = interactive && window.confirm(
        `This import would remove ${dropped.length} of ${posted} ${dropped[0].customer} loads posted on Landstar `
        + '(they are not on the new list).\n\nThat is unusually many. The file may be cut off or the wrong list.\n\n'
        + 'Remove them from Landstar? Choose Cancel to leave them posted.'
      );
      if (!ok) return 0;
    }
    addToUnpostQueue(dropped);
    void sendUnpostQueueToBot();
    return dropped.length;
  };

  const unseenInquiryCount = inquiries.filter(inquiry => !inquiry.seen).length;

  const markInquirySeen = async inquiry => {
    setInquiries(current => current.map(item => (item.id === inquiry.id ? { ...item, seen: true } : item)));
    if (!supabase) return;
    const { error } = await supabase.from('load_inquiries').update({ seen: true }).eq('id', inquiry.id);
    if (error) console.error('Could not mark the inquiry as seen:', error);
  };

  const openInquiryLoad = inquiry => {
    const loads = customerOrdersMap[inquiry.customer] || [];
    const target = loads.find(o => String(o.id) === String(inquiry.load_id));
    if (!target) {
      notify(`Load #${inquiry.load_id} is no longer in ${inquiry.customer}.`);
      return;
    }
    if (inquiry.customer !== selectedBroker) handleSelectBroker(inquiry.customer);
    setFilter('ALL');
    setSelectedOrder(target);
    setView('loads');
    setShowInquiries(false);
    if (!inquiry.seen) void markInquirySeen(inquiry);
  };

  // Creates or refreshes the public driver links for these loads (one per load,
  // reused across exports) and returns Map(loadId -> token). Throws if unavailable.
  const ensureInquiryLinks = async (customer, loads) => {
    if (!supabase) throw new Error('Driver links need the cloud account. Sign in to the TMS with cloud sync turned on.');
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) throw new Error('Sign in again to create driver links.');
    const loadIds = loads.map(load => String(load.id));
    const { data: existing, error: findError } = await supabase
      .from('load_inquiry_links').select('token, load_id')
      .eq('owner_id', user.id).eq('customer', customer).in('load_id', loadIds);
    if (findError) throw findError;
    const tokens = new Map((existing || []).map(row => [String(row.load_id), row.token]));
    const now = new Date().toISOString();
    const rows = loads.map(load => {
      const loadId = String(load.id);
      if (!tokens.has(loadId)) tokens.set(loadId, createInquiryToken());
      return {
        token: tokens.get(loadId), owner_id: user.id, owner_email: user.email || null, customer, load_id: loadId,
        details: buildInquiryDetails(load, profile), active: true, updated_at: now
      };
    });
    const { error: saveError } = await supabase.from('load_inquiry_links').upsert(rows, { onConflict: 'token' });
    if (saveError) throw saveError;
    return tokens;
  };

  const describeLinkError = error => (/does not exist|schema cache/i.test(error?.message || '')
    ? 'Driver links are not set up yet: run supabase/load-inquiries.sql in Supabase first.'
    : error?.message || 'Try again.');

  // Creates (or refreshes) this load's driver link, shows it under the comment box, and copies it.
  const handleCopyDriverLink = async () => {
    if (!selectedOrder) return;
    try {
      const token = (await ensureInquiryLinks(selectedBroker, [selectedOrder])).get(String(selectedOrder.id));
      if (selectedOrder.inquiryToken !== token) saveLoad({ ...selectedOrder, inquiryToken: token });
      const url = getInquiryUrl(token);
      await copyToClipboard(url, 'Driver link');
      notify(`Driver link copied for load #${selectedOrder.id}:\n${url}\n\nPaste it into the load's BCO Posting Comments on Landstar, or text it to drivers. You'll get an email when a driver inquires.`);
    } catch (error) {
      console.error('Could not create the driver link:', error);
      notify(`Could not create the driver link: ${describeLinkError(error)}`);
    }
  };

  // DAT load board: the local server keeps the list of live DAT postings and reposts them
  // (api/_lib/datPosting.js). The TMS reads that list every minute and takes a posting down
  // when its load is booked, covered (🚫) or no longer on the customer's list.
  const [datPostings, setDatPostings] = useState([]);
  const [datAvailable, setDatAvailable] = useState(true);
  const [datBusy, setDatBusy] = useState(false);
  const datPostingFor = (customer, load) => datPostings.find(posting =>
    posting.customer === String(customer || '') && posting.referenceId === String(load?.id || ''));
  const callDat = async body => {
    const response = await fetch('/api/dat-post', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `DAT request failed (${response.status})`);
    return result.results || [];
  };
  const loadDatPostings = async () => {
    try {
      const response = await fetch('/api/dat-post', { cache: 'no-store' });
      if (!response.ok) { setDatAvailable(false); return null; }
      const result = await response.json();
      const postings = Array.isArray(result.postings) ? result.postings : [];
      setDatAvailable(true);
      setDatPostings(postings);
      return postings;
    } catch {
      setDatAvailable(false);
      return null;
    }
  };
  const customerOrdersMapRef = useRef(customerOrdersMap);
  customerOrdersMapRef.current = customerOrdersMap;
  useEffect(() => {
    let stopped = false;
    const sync = async () => {
      const postings = await loadDatPostings();
      if (stopped || !postings?.length) return;
      const ordersMap = customerOrdersMapRef.current || {};
      const stale = postings.filter(posting => {
        const list = ordersMap[posting.customer];
        // An account that isn't loaded here is left alone.
        if (!Array.isArray(list) || !list.length) return false;
        const load = list.find(order => String(order.id) === posting.referenceId);
        return !load || load.status === 'BOOKED' || Boolean(load.landstarRemoval);
      });
      if (!stale.length) return;
      try {
        await callDat({ action: 'remove', postingIds: stale.map(posting => posting.postingId) });
      } catch (error) {
        console.error('Could not take booked or dropped loads off DAT:', error);
      }
      if (!stopped) await loadDatPostings();
    };
    sync();
    const timer = setInterval(sync, 60_000);
    return () => { stopped = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const postLoadsToDat = async loads => {
    if (datBusy) return;
    const built = loads.map(load => ({ load, ...buildDatPosting(selectedBroker, load) }));
    const problems = built.filter(entry => entry.error).map(entry => `${entry.load.id}: ${entry.error}`);
    const postings = built.filter(entry => entry.posting).map(entry => entry.posting);
    if (!postings.length) {
      notify(`Nothing was posted to DAT.\n\n${problems.slice(0, 10).join('\n')}`);
      return;
    }
    setDatBusy(true);
    try {
      const results = await callDat({ action: 'post', postings });
      results.filter(result => !result.ok).forEach(result => problems.push(`${result.referenceId}: ${result.error}`));
      const posted = results.filter(result => result.ok).length;
      notify(`📡 Posted ${posted} load${posted === 1 ? '' : 's'} to DAT. They are reposted every 5 minutes while the TMS server runs.${problems.length ? `\n\nNot posted (${problems.length}):\n${problems.slice(0, 10).join('\n')}${problems.length > 10 ? `\n…and ${problems.length - 10} more` : ''}` : ''}`);
    } catch (error) {
      notify(`Could not post to DAT: ${error.message}`);
    } finally {
      setDatBusy(false);
      loadDatPostings();
    }
  };

  // Same loads the Landstar export would take: selected (or shown), not booked, not covered,
  // not Mexico, not intermodal/oversized.
  const handlePostToDat = () => {
    const candidates = (selectedIds.length > 0
      ? orders.filter(o => selectedIds.includes(selectionKey(selectedBroker, o.id)))
      : filteredOrders)
      .filter(o => !o.landstarRemoval && o.status !== 'BOOKED' && !isMexicoLoad(o) && !isSkippableEquipment(o.eCode));
    if (!candidates.length) { notify('No loads to post to DAT.'); return; }
    if (!window.confirm(`Post ${candidates.length} load${candidates.length === 1 ? '' : 's'} from ${selectedBroker} to the DAT load board?`)) return;
    postLoadsToDat(candidates);
  };

  const handleRemoveFromDat = async load => {
    const posting = datPostingFor(selectedBroker, load);
    if (!posting || datBusy) return;
    setDatBusy(true);
    try {
      const [result] = await callDat({ action: 'remove', postingIds: [posting.postingId] });
      if (result && !result.ok) notify(`DAT would not remove load ${load.id}: ${result.error}`);
    } catch (error) {
      notify(`Could not remove from DAT: ${error.message}`);
    } finally {
      setDatBusy(false);
      loadDatPostings();
    }
  };

  // Export button: a second click while an export is running is ignored, and another export
  // within 15 seconds asks first (2026-11-23: a double click exported RXO ATZ V twice, 34+34 files).
  const handleExportToLandstar = async () => {
    if (exportGuard.running) return;
    if (Date.now() - exportGuard.finishedAt < EXPORT_REPEAT_MS
      && !window.confirm('You just exported. Export again? The bot would post these loads a second time.')) return;
    exportGuard.running = true;
    try {
      await runExportToLandstar();
    } finally {
      exportGuard.running = false;
      exportGuard.finishedAt = Date.now();
    }
  };

  // A Google Chat list for an auto-export account was just imported: export its loads (the
  // import selected them). No "export again?" question and no pop-ups; the upload bot then
  // posts them with its usual checks (ATZ already posted, rates on the board).
  const handleAutoExport = async () => {
    if (exportGuard.running) return false;
    exportGuard.running = true;
    try {
      await runExportToLandstar({ quiet: true });
      return true;
    } finally {
      exportGuard.running = false;
      exportGuard.finishedAt = Date.now();
    }
  };

  // options.quiet (automatic exports of Google Chat lists, Daniel 2026-11-27): messages show as
  // TMS notices instead of pop-ups, so the export never waits for a click.
  const runExportToLandstar = async (options = {}) => {
    const say = message => (options.quiet ? pushNotice(`🚀 Auto-export: ${String(message).replace(/\s*\n+\s*/g, ' ')}`, noticeLevel(message) === 'warn' ? 'warn' : 'auto') : notify(message));
    setExportErrorIds([]);
    const exportPhone = profile.phone.replace(/\D/g, '');
    const exportVisibilityGroup = profile.visibilityGroup.trim().toUpperCase();
    if (exportPhone.length !== 10 || !profile.postingCode.trim() || !exportVisibilityGroup) {
      say('Open ⚙ My Settings and enter your 10-digit phone number, posting code and visibility group before exporting.');
      openProfileSettings();
      return;
    }
    // Export everything on the current list, including loads already exported
    // (ENT) — re-posting the same loads to Landstar is allowed. Loads not on
    // the list are untouched; exported loads are (re)marked ENT below.
    // Loads taken off Landstar (🚫 Covered) are never posted again.
    // Posted loads now stay OPEN (Daniel 2026-11-27), so with nothing checked only loads not
    // posted yet go out; checked loads export even when already posted (a deliberate repost).
    const candidateLoads = (selectedIds.length > 0
      ? orders.filter(o => selectedIds.includes(selectionKey(selectedBroker, o.id)))
      : filteredOrders.filter(o => !o.landstarExportedAt)).filter(o => !o.landstarRemoval);
    // Booked loads already have a truck; never post them to the Landstar board.
    const unbookedLoads = candidateLoads.filter(o => o.status !== 'BOOKED');
    const skippedBookedCount = candidateLoads.length - unbookedLoads.length;
    // RXO ATZ van loads picking up in skipped states are never posted.
    const notRxoSkipped = unbookedLoads.filter(o => !isRxoSkippedVanLoad(selectedBroker, o));
    const skippedRxoVanCount = unbookedLoads.length - notRxoSkipped.length;
    // RXO ATZ loads that pick up and deliver in the same city are never posted.
    const notSameCity = notRxoSkipped.filter(o => !isRxoSameCityLoad(selectedBroker, o));
    const skippedSameCityCount = notRxoSkipped.length - notSameCity.length;
    // Loads to or from Mexico are never posted.
    const notMexico = notSameCity.filter(o => !isMexicoLoad(o));
    const skippedMexicoCount = notSameCity.length - notMexico.length;
    // Intermodal ("INT") and oversized equipment is never posted.
    const loadsToExport = notMexico.filter(o => !isSkippableEquipment(o.eCode));
    const skippedEquipmentExportCount = notMexico.length - loadsToExport.length;

    if (loadsToExport.length === 0 && selectedIds.length === 0 && filteredOrders.some(o => o.landstarExportedAt)) {
      pushNotice('Nothing new to export: every open load on this list is already posted on Landstar. Check loads to post them again.', 'auto');
      return;
    }
    if (loadsToExport.length === 0) {
      say(skippedBookedCount || skippedRxoVanCount || skippedSameCityCount || skippedMexicoCount || skippedEquipmentExportCount
        ? `Nothing to export: ${[
          skippedBookedCount && `${skippedBookedCount} booked load(s)`,
          skippedRxoVanCount && `${skippedRxoVanCount} RXO van load(s) picking up in WI, IN, OH, MI, MN, SD, ND, UT or ID`,
          skippedSameCityCount && `${skippedSameCityCount} RXO load(s) picking up and delivering in the same city`,
          skippedMexicoCount && `${skippedMexicoCount} load(s) to or from Mexico`,
          skippedEquipmentExportCount && `${skippedEquipmentExportCount} intermodal (INT) or oversized load(s)`
        ].filter(Boolean).join(' and ')} are not exported to Landstar.`
        : 'No loads selected for export!');
      return;
    }

    // Make sure each exported load has a driver inquiry link (shown under its comment box,
    // for texting or pasting into BCO Posting Comments). It is NOT sent in column AA:
    // Landstar rejects any non-standard comment there. A failure never blocks the export.
    let inquiryTokens = new Map();
    let inquiryLinkError = '';
    try {
      inquiryTokens = await ensureInquiryLinks(selectedBroker, loadsToExport);
    } catch (error) {
      console.error('Could not create driver links for the export:', error);
      inquiryLinkError = describeLinkError(error);
    }
    const reExportCount = loadsToExport.filter(o => o.status === 'ENT').length;

    const normalizedBroker = normalizeCustomerName(selectedBroker).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const customerIdVal = normalizedBroker.includes('593772')
      ? '593772'
      : normalizedBroker.includes('1522166')
        ? '1522166'
        : isRxoCustomer(selectedBroker)
          ? '2429200'
          : (String(selectedBroker).match(/\b\d{5,8}\b/)?.[0] || '9999999');
    const isChCustomer = isCh593772Customer(selectedBroker);
    const allowMissingMiles = isChCustomer;
    let zipModule = null;
    try {
      zipModule = await import('zipcodes');
    } catch (error) {
      console.error('Could not load offline ZIP location data for the Landstar export:', error);
      say('Could not load the offline ZIP location data needed for the Landstar export.');
      return;
    }
    const zipData = zipModule.default || zipModule;
    const lookupZip = zip => zipData.codes?.[zip] || null;
    const lookupCityState = (city, state) => {
      const extraCities = {
        'HAMBERG|ND': { zip: '58145', city: 'Hamberg', state: 'ND' },
        'ROSEMONT|IL': { zip: '60018', city: 'Rosemont', state: 'IL' },
        'MALTA|NY': { zip: '12020', city: 'Malta', state: 'NY' },
        // Delanco's ZIP is filed under neighboring Riverside in the offline data.
        'DELANCO|NJ': { zip: '08075', city: 'Delanco', state: 'NJ' },
        // Pembroke's ZIP 03275 is filed under Suncook (a village in Pembroke) in the offline data.
        'PEMBROKE|NH': { zip: '03275', city: 'Pembroke', state: 'NH' },
        // Broker lists abbreviate North Smithfield; the offline data only has the full name.
        'N SMITHFIELD|RI': { zip: '02896', city: 'North Smithfield', state: 'RI' },
        // Logan Township's ZIPs are filed under Swedesboro/Bridgeport in the offline data.
        'LOGAN TOWNSHIP|NJ': { zip: '08085', city: 'Logan Township', state: 'NJ' },
        // Woolwich Township's ZIP 08085 is also filed under Swedesboro in the offline data.
        'WOOLWICH TOWNSHIP|NJ': { zip: '08085', city: 'Woolwich Township', state: 'NJ' },
        // Trappe's ZIP 19426 is filed under Collegeville in the offline data.
        'TRAPPE|PA': { zip: '19426', city: 'Trappe', state: 'PA' },
        // Westampton's ZIP 08060 is filed under Mount Holly in the offline data.
        'WESTAMPTON|NJ': { zip: '08060', city: 'Westampton', state: 'NJ' },
        // East Windsor's ZIP 08520 is filed under Hightstown in the offline data.
        'EAST WINDSOR|NJ': { zip: '08520', city: 'East Windsor', state: 'NJ' },
        // Brentwood's ZIPs outside NY/MD/TN/CA are filed under neighboring cities in the offline data.
        'BRENTWOOD|MO': { zip: '63144', city: 'Brentwood', state: 'MO' },
        'BRENTWOOD|PA': { zip: '15227', city: 'Brentwood', state: 'PA' },
        'BRENTWOOD|NH': { zip: '03833', city: 'Brentwood', state: 'NH' },
        // Colony, WY (AMERI's bentonite plants) shares ZIP 82710 with Aladdin. Landstar never
        // finished a "Colony, WY 82710" upload (2026-11-25), so the posting goes out as the
        // ZIP's own post office, Aladdin, WY 82710; the TMS still shows Colony.
        'COLONY|WY': { zip: '82710', city: 'Aladdin', state: 'WY' },
        // More AMERI stops whose ZIPs belong to a neighboring post office: posted as that post
        // office (like Colony above) so Landstar's city/ZIP check matches.
        'HOLIDAY CITY|OH': { zip: '43543', city: 'Montpelier', state: 'OH' },
        'FIFE|WA': { zip: '98424', city: 'Tacoma', state: 'WA' },
        // McKenzie, ND (the town in Burleigh County) shares Sterling's ZIP.
        'MCKENZIE|ND': { zip: '58572', city: 'Sterling', state: 'ND' }
      };
      const extraKey = `${String(city || '').trim().toUpperCase()}|${String(state || '').trim().toUpperCase()}`;
      if (extraCities[extraKey]) return extraCities[extraKey];
      const rawCity = String(city || '').trim();
      const cityName = rawCity
        .replace(/\bMT\.?\s+/gi, 'Mount ').replace(/\bST\.?\s+/gi, 'Saint ').replace(/\bFT\.?\s+/gi, 'Fort ');
      // Broker lists often abbreviate directions (N/S/E/W) or add suffixes the postal data omits.
      const expandedCity = cityName
        .replace(/^N\.?\s+/i, 'North ').replace(/^S\.?\s+/i, 'South ')
        .replace(/^E\.?\s+/i, 'East ').replace(/^W\.?\s+/i, 'West ');
      const strippedCity = expandedCity
        .replace(/\s+(Township|Twp|Borough|Boro|Village|City)$/i, '');
      const stateCode = String(state || '').trim();
      const exactMatches = [cityName, rawCity, rawCity.replace(/\./g, ''), expandedCity, strippedCity]
        .map(name => zipData.lookupByName?.(name, stateCode) || [])
        .find(matches => matches.length) || [];
      const prefixCounts = exactMatches.reduce((counts, location) => {
        const prefix = location.zip.slice(0, 3);
        counts[prefix] = (counts[prefix] || 0) + 1;
        return counts;
      }, {});
      const exactMatch = exactMatches.length > 1
        ? exactMatches.find(location => prefixCounts[location.zip.slice(0, 3)] > 1 && !location.zip.endsWith('00')) || exactMatches[0]
        : exactMatches[0];
      if (exactMatch) return exactMatch;

      const normalizeCity = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const normalizedCity = normalizeCity(cityName);
      if (normalizedCity.length < 5) return null;

      const prefixMatches = (zipData.lookupByState?.(stateCode) || [])
        .filter(location => normalizeCity(location.city).startsWith(normalizedCity));
      const matchingCities = Array.from(new Set(prefixMatches.map(location => normalizeCity(location.city))));
      return matchingCities.length === 1 ? prefixMatches[0] || null : null;
    };
    let representativeZipCount = 0;
    const representativeZipExamples = [];

    const validationErrors = [];
    const exportEntries = [];
    const earliestPickupSerial = getEarliestPickupSerial();
    const movedPickupStarts = [];
    loadsToExport.forEach(ord => {
      const rowErrors = [];
      const originState = String(ord.origSt || '').trim().toUpperCase();
      const destinationState = String(ord.destSt || '').trim().toUpperCase();
      const fuelSurchargeRate = getFuelSurchargeRate(profile.fuelSurcharge, originState);
      const originCountry = getCountryForRegion(originState);
      const destinationCountry = getCountryForRegion(destinationState);
      const enteredOriginZip = originCountry === 'CA'
        ? normalizeCanadianPostalCode(ord.origZip)
        : String(ord.origZip || '').replace(/\D/g, '').slice(0, 5);
      const enteredDestinationZip = destinationCountry === 'CA'
        ? normalizeCanadianPostalCode(ord.destZip)
        : String(ord.destZip || '').replace(/\D/g, '').slice(0, 5);
      const enteredOriginLocation = originCountry === 'US' && enteredOriginZip.length === 5
        ? lookupZip(enteredOriginZip)
        : null;
      const enteredDestinationLocation = destinationCountry === 'US' && enteredDestinationZip.length === 5
        ? lookupZip(enteredDestinationZip)
        : null;
      const originLocation = enteredOriginLocation || (originCountry === 'US' ? lookupCityState(ord.origCity, originState) : null);
      const destinationLocation = enteredDestinationLocation || (destinationCountry === 'US' ? lookupCityState(ord.destCity, destinationState) : null);
      const originZip = originCountry === 'CA'
        ? enteredOriginZip || lookupCanadianPostalCode(ord.origCity, originState)
        : originLocation?.zip || (enteredOriginLocation ? enteredOriginZip : '');
      const destinationZip = destinationCountry === 'CA'
        ? enteredDestinationZip || lookupCanadianPostalCode(ord.destCity, destinationState)
        : destinationLocation?.zip || (enteredDestinationLocation ? enteredDestinationZip : '');
      // A ZIP found from the city name means the postal spelling matched, so send that spelling to Landstar.
      // When a ZIP was entered directly, still correct the city to the ZIP's postal spelling when it is
      // clearly the same place (spacing/punctuation only, e.g. "McCordsville" -> "Mc Cordsville");
      // otherwise flag the mismatch below so Landstar's city/ZIP lookup does not reject the posting.
      const normalizeCityName = name => String(name || '').toUpperCase()
        .replace(/\bST\b\.?/g, 'SAINT').replace(/\bMT\b\.?/g, 'MOUNT').replace(/\bFT\b\.?/g, 'FORT')
        .replace(/[^A-Z0-9]/g, '');
      const cityMatchesPostalCity = (city, location) =>
        Boolean(location?.city) && normalizeCityName(city) === normalizeCityName(location.city);
      // An entered ZIP always wins: export its postal city and state (see getExportPlace).
      const originPlace = getExportPlace(ord.origCity, originState, enteredOriginLocation);
      const destinationPlace = getExportPlace(ord.destCity, destinationState, enteredDestinationLocation);
      // Canada: the full city name the postal lookup matched ("BURLINGT" -> "BURLINGTON").
      const originCanadaCity = originCountry === 'CA' && !enteredOriginZip ? findCanadianPlace(ord.origCity, originState)?.city : '';
      const destinationCanadaCity = destinationCountry === 'CA' && !enteredDestinationZip ? findCanadianPlace(ord.destCity, destinationState)?.city : '';
      const originCity = toLandstarCity(
        originCanadaCity || (originPlace.fromZip
          ? originPlace.city
          : originLocation?.city || cityMatchesPostalCity(ord.origCity, originLocation)
            ? originLocation.city
            : getLandstarCity(ord.origCity, originLocation))
      );
      const destinationCity = toLandstarCity(
        destinationCanadaCity || (destinationPlace.fromZip
          ? destinationPlace.city
          : destinationLocation?.city || cityMatchesPostalCity(ord.destCity, destinationLocation)
            ? destinationLocation.city
            : getLandstarCity(ord.destCity, destinationLocation))
      );
      const originStateMatchesZip = originPlace.fromZip || !ord.origSt || !originLocation || originState === originLocation.state;
      const destinationStateMatchesZip = destinationPlace.fromZip || !ord.destSt || !destinationLocation || destinationState === destinationLocation.state;
      const originZipWasResolved = !enteredOriginLocation && Boolean(originLocation);
      const destinationZipWasResolved = !enteredDestinationLocation && Boolean(destinationLocation);
      if (originZipWasResolved) representativeZipCount += 1;
      if (destinationZipWasResolved) representativeZipCount += 1;
      if ((originZipWasResolved || destinationZipWasResolved) && representativeZipExamples.length < 5) {
        representativeZipExamples.push(
          `${ord.id}: ${originZipWasResolved ? `${originCity}, ${originState} ${originZip}` : ''}${originZipWasResolved && destinationZipWasResolved ? ' → ' : ''}${destinationZipWasResolved ? `${destinationCity}, ${destinationState} ${destinationZip}` : ''}`
        );
      }
      const puParts = splitScheduleRange(ord.pickupTime);
      const delParts = splitScheduleRange(ord.deliveryTime);
      let pickupThru = toExcelDateTime(puParts[1] || puParts[0], puParts[0]);
      const pickupWindow = adjustPickupWindow(toExcelDateTime(puParts[0]), pickupThru, earliestPickupSerial);
      const pickupFrom = pickupWindow.from;
      // A single pickup time (no range) makes start == end, a zero-width window Landstar
      // rejects. Widen it to one hour so the posting is accepted.
      if (pickupFrom !== null && pickupThru !== null && pickupThru <= pickupFrom) {
        pickupThru = pickupFrom + (1 / 24);
      }
      if (pickupWindow.moved) movedPickupStarts.push(ord.id);
      const deliveryFrom = toExcelDateTime(delParts[0]);
      let deliveryThru = toExcelDateTime(delParts[1] || delParts[0], delParts[0]);
      // Same zero-width guard on the delivery side.
      if (deliveryFrom !== null && deliveryThru !== null && deliveryThru <= deliveryFrom) {
        deliveryThru = deliveryFrom + (1 / 24);
      }
      const equipment = getLandstarEquipmentCode(ord.eCode);
      const commodity = getLoadCommodity(ord);
      const miles = Number(normalizeMilesValue(ord.miles));
      const weight = parseWeightPounds(ord.weight);
      const quotedRate = Number(String(ord.rateInput || '').replace(/[$,]/g, ''));
      // RXO ATZ van loads priced from DAT post under the DAT rate (see getRxoAtzDatVanDiscount).
      const rate = quotedRate - getRxoAtzDatVanDiscount(selectedBroker, ord, quotedRate);
      const postingCode = String(ord.postingCode || profile.postingCode).trim().toUpperCase();
      const visibilityCode = exportVisibilityGroup;
      const brokerable = getLandstarBrokerable(selectedBroker, ord);
      const today = new Date();
      const todaySerial = (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(1899, 11, 30)) / 86400000;

      if (!isValidPostingCode(postingCode)) rowErrors.push('posting code must be 1 to 10 characters (check this load or My Settings)');
      if (!ord.origCity && !originPlace.fromZip) rowErrors.push('origin city');
      if (!originPlace.fromZip && (!originState || !stateCodes.has(originState))) rowErrors.push('origin state/province');
      if (originCountry === 'CA' && !originZip) rowErrors.push('valid Canadian origin postal code');
      if (!originStateMatchesZip) rowErrors.push(`origin state must match ZIP ${originZip} (${originLocation.state})`);
      if (!ord.destCity && !destinationPlace.fromZip) rowErrors.push('destination city');
      if (!destinationPlace.fromZip && (!destinationState || !stateCodes.has(destinationState))) rowErrors.push('destination state/province');
      if (destinationCountry === 'CA' && !destinationZip) rowErrors.push('valid Canadian destination postal code');
      if (!destinationStateMatchesZip) rowErrors.push(`destination state must match ZIP ${destinationZip} (${destinationLocation.state})`);
      if (pickupFrom === null || pickupThru === null) {
        rowErrors.push(`pickup date/time (current value "${ord.pickupTime || ''}" — use MM/DD/YYYY HHMM - HHMM)`);
      }
      else if (pickupWindow.ended) rowErrors.push('pickup window has already ended (Landstar only accepts a pickup that is still open)');
      else if (pickupThru < pickupFrom) rowErrors.push('pickup end must be after pickup start');
      if (deliveryFrom === null || deliveryThru === null) rowErrors.push('delivery date and time');
      else if (deliveryThru < todaySerial) rowErrors.push('delivery end date cannot be in the past');
      else if (deliveryThru < deliveryFrom) rowErrors.push('delivery end must be after delivery start');
      if (pickupFrom !== null && deliveryFrom !== null && deliveryFrom <= pickupFrom) {
        rowErrors.push('delivery start must be later than pickup start');
      }
      if (!equipment) rowErrors.push('valid equipment');
      const equipment2 = getLandstarExportEquipment2(selectedBroker, ord, profile.postingCode, getCustomerRules(profile.customerRules, selectedBroker));
      const equipmentChoices = [equipment, equipment2, ord.equipment3].filter(Boolean);
      if (new Set(equipmentChoices).size !== equipmentChoices.length) rowErrors.push('distinct equipment choices (remove duplicate alternates)');
      if (equipment === 'D-LG' && equipmentChoices.includes('D-ST')) rowErrors.push('liftgate-required loads cannot offer D-ST as an alternate');
      if (!['CGAPP', 'HAZMAT', 'CHEM'].includes(commodity)) rowErrors.push('valid commodity');
      if (!allowMissingMiles && !(miles > 0)) rowErrors.push('miles');
      if (weight === null || weight > 999999) {
        rowErrors.push('weight (enter whole pounds from 1 to 999,999)');
      }
      const isChBinRate = isChCustomer && ord.rateSource === 'customer-bin'
        && String(ord.rateInput ?? '').trim() !== '' && Number.isFinite(rate) && rate >= 0;
      if (!isChBinRate && (!(rate > 0) || !['user-entered', 'dat-screenshot', 'dat-api'].includes(ord.rateSource))) {
        rowErrors.push('rate (enter a current DAT quote or import one via DAT API/screenshot)');
      }

      if (rowErrors.length) {
        validationErrors.push(`Order ${ord.id}: ${rowErrors.join(', ')}`);
        return;
      }

      exportEntries.push({ ord, record: {
        "Customer ID(Required)": customerIdVal,
        "Posting Call Back 10 Digits Phone Number": exportPhone,
        "Origin City": originCity,
        "Origin Zipcode(Required)": originZip,
        "Origin State": originPlace.state,
        "Origin Country(Required)": originCountry,
        "Destination City": destinationCity,
        "Destination Zipcode(Required)": destinationZip,
        "Destination State": destinationPlace.state,
        "Destination Country(Required)": destinationCountry,
        "Pickup Date (From)(Required)": pickupFrom,
        "Pickup Date (Thru)(Required)": pickupThru,
        "Delivery Date (From)(Required)": deliveryFrom,
        "Delivery Date (Thru)(Required)": deliveryThru,
        "Load Posting Code": postingCode,
        "Visibility Code": visibilityCode,
        "Bill as Miles": allowMissingMiles && !(miles > 0) ? '' : miles,
        "Equipment 1(Required)": equipment,
        "Equipment 2": equipment2,
        "Equipment 3": ord.equipment3 || "",
        "Weight(Required)": weight ?? '',
        "Rate Type(Required)": "Flat Rate",
        "Rate(Required)": rate,
        "Commodity": getLandstarCommodityValue(commodity),
        "Brokerable": brokerable,
        "Carrier Amt": getLandstarCarrierAmount(selectedBroker, rate),
        "Carrier Load Alerts": getLandstarCarrierLoadAlerts(selectedBroker),
        // The Landstar template has no Team column; team is set through this attribute.
        "Load Attributes": [isHazmatLoad(ord) && 'Hazmat', isTeamLoad(ord) && 'Team Required'].filter(Boolean).join(', '),
        "Comments": getLandstarExportComment(ord),
        // FSC columns stay blank; the fuel surcharge is already removed from the linehaul rate.
        "Fuel Surcharge Rate Type": "",
        "Fuel Surcharge": "",
        "Team": isTeamLoad(ord) ? 'true' : 'false'
      } });
    });

    const failedIds = validationErrors
      .map(error => error.match(/^Order\s+([^:]+):/)?.[1])
      .filter(Boolean);
    if (failedIds.length) {
      setExportErrorIds(failedIds);
      const firstFailedOrder = loadsToExport.find(order => failedIds.includes(String(order.id)));
      if (firstFailedOrder) setSelectedOrder(firstFailedOrder);
    }

    const hasAllZips = record => Boolean(record['Origin Zipcode(Required)'] && record['Destination Zipcode(Required)']);
    const missingZipEntries = exportEntries.filter(({ record }) => !hasAllZips(record));
    const readyEntries = exportEntries.filter(({ record }) => hasAllZips(record));
    // Export errors stay on the load until it exports (they used to vanish on reload).
    const exportErrorsById = new Map();
    validationErrors.forEach(error => {
      const id = error.match(/^Order\s+([^:]+):/)?.[1];
      if (id) exportErrorsById.set(String(id).trim(), error.replace(/^Order\s+[^:]+:\s*/, ''));
    });
    missingZipEntries.forEach(({ ord }) => exportErrorsById.set(String(ord.id), 'No ZIP code found. Enter the origin or destination ZIP.'));
    const exportErrorAt = new Date().toISOString();
    const withExportErrors = loads => loads.map(load => (exportErrorsById.has(String(load.id))
      ? { ...load, exportError: { message: exportErrorsById.get(String(load.id)), at: exportErrorAt } }
      : load));

    if (!readyEntries.length) {
      const problems = [];
      if (validationErrors.length) {
        const visibleErrors = validationErrors.slice(0, 10).join('\n');
        const additionalCount = validationErrors.length - 10;
        problems.push(`Landstar-required load data needs correction:\n\n${visibleErrors}${additionalCount > 0 ? `\n…and ${additionalCount} more load(s).` : ''}`);
      }
      if (missingZipEntries.length) {
        problems.push(`No ZIP code could be found for ${missingZipEntries.length} load${missingZipEntries.length === 1 ? '' : 's'}, and Landstar needs a ZIP to fill in the state. Enter the ZIP in the load's Origin or Destination ZIP field, then export again:\n\n${missingZipEntries.slice(0, 10).map(({ record }) => `${record['Origin City'] || ''} → ${record['Destination City'] || ''}`).join('\n')}`);
      }
      say(`No loads could be exported.\n\n${problems.join('\n\n')}`);
      if (exportErrorsById.size) {
        const withErrors = { ...customerOrdersMap, [selectedBroker]: withExportErrors(orders) };
        persistAppData(brokers, withErrors);
        setCustomerOrdersMap(withErrors);
      }
      return;
    }

    const exportData = readyEntries.map(({ record }) => record);
    const exportedIds = new Set(readyEntries.map(({ ord }) => String(ord.id)));
    const exportBlobs = [];
    try {
      const templateResponse = await fetch(`${import.meta.env.BASE_URL}landstar-bulk-template.xlsx`);
      if (!templateResponse.ok) {
        throw new Error(`Template download returned HTTP ${templateResponse.status}.`);
      }
      const templateBytes = await templateResponse.arrayBuffer();
      for (let chunkStart = 0; chunkStart < exportData.length; chunkStart += landstarExportChunkSize) {
      const chunkData = exportData.slice(chunkStart, chunkStart + landstarExportChunkSize);
      const workbook = XLSX.read(templateBytes, { type: 'array' });
      const worksheet = workbook.Sheets.Loads;
      if (!worksheet) throw new Error('The Landstar template does not contain its required Loads sheet.');

      const range = XLSX.utils.decode_range(worksheet['!ref']);
      const headers = Array.from({ length: range.e.c + 1 }, (_, column) =>
        worksheet[XLSX.utils.encode_cell({ r: 0, c: column })]?.v
      );
      const normalizeHeader = header => String(header || '').replace(/[\r\n]/g, '').trim().toLowerCase();
      ['Origin State', 'Destination State'].forEach(header => {
        if (!headers.some(existing => normalizeHeader(existing) === normalizeHeader(header))) {
          headers.push(header);
        }
      });
      if (!headers.some(existing => normalizeHeader(existing) === 'team')) {
        headers.push('Team');
      }
      range.e.c = headers.length - 1;
      const headerIndexes = new Map(headers.map((header, index) => [normalizeHeader(header), index]));
      const requiredHeaders = ['Customer ID(Required)', 'Origin City', 'Load Posting Code', 'Commodity'];
      const missingHeaders = requiredHeaders.filter(header => !headerIndexes.has(normalizeHeader(header)));
      if (missingHeaders.length) {
        throw new Error(`The supplied Landstar template is missing required columns: ${missingHeaders.join(', ')}.`);
      }

      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(templateBytes);
      const mainNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
      const documentRelationshipsNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
      const packageRelationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
      const parser = new DOMParser();
      const serializer = new XMLSerializer();
      const parseXml = (xml, partName) => {
        const document = parser.parseFromString(xml, 'application/xml');
        if (document.getElementsByTagName('parsererror').length) {
          throw new Error(`The Landstar template contains invalid XML in ${partName}.`);
        }
        return document;
      };
      const workbookDocument = parseXml(
        await zip.file('xl/workbook.xml').async('string'),
        'xl/workbook.xml'
      );
      const relationshipsDocument = parseXml(
        await zip.file('xl/_rels/workbook.xml.rels').async('string'),
        'xl/_rels/workbook.xml.rels'
      );
      const loadsSheet = Array.from(workbookDocument.getElementsByTagNameNS(mainNamespace, 'sheet'))
        .find(sheet => sheet.getAttribute('name') === 'Loads');
      const relationshipId = loadsSheet?.getAttributeNS(documentRelationshipsNamespace, 'id');
      const loadsRelationship = Array.from(
        relationshipsDocument.getElementsByTagNameNS(packageRelationshipsNamespace, 'Relationship')
      ).find(relationship => relationship.getAttribute('Id') === relationshipId);
      if (!loadsRelationship) throw new Error('Could not locate the Loads worksheet in the Landstar template.');

      const worksheetTarget = loadsRelationship.getAttribute('Target');
      const worksheetPath = worksheetTarget.startsWith('/')
        ? worksheetTarget.slice(1)
        : `xl/${worksheetTarget}`;
      const worksheetFile = zip.file(worksheetPath);
      const sharedStringsFile = zip.file('xl/sharedStrings.xml');
      if (!worksheetFile || !sharedStringsFile) {
        throw new Error('The Landstar template is missing its Loads worksheet or shared-string table.');
      }

      const worksheetDocument = parseXml(await worksheetFile.async('string'), worksheetPath);
      const sharedStringsDocument = parseXml(
        await sharedStringsFile.async('string'),
        'xl/sharedStrings.xml'
      );
      const sheetData = worksheetDocument.getElementsByTagNameNS(mainNamespace, 'sheetData')[0];
      const sharedStrings = sharedStringsDocument.getElementsByTagNameNS(mainNamespace, 'sst')[0];
      if (!sheetData || !sharedStrings) {
        throw new Error('The Landstar template has an invalid Loads worksheet or shared-string table.');
      }

      const sharedItems = () => Array.from(sharedStrings.getElementsByTagNameNS(mainNamespace, 'si'));
      const getSharedStringText = item =>
        Array.from(item.getElementsByTagNameNS(mainNamespace, 't'))
          .map(text => text.textContent || '')
          .join('');
      const sharedStringIndexes = new Map(sharedItems().map((item, index) => [getSharedStringText(item), index]));
      let sharedStringReferenceDelta = 0;
      const getSharedStringIndex = value => {
        if (sharedStringIndexes.has(value)) return sharedStringIndexes.get(value);
        const item = sharedStringsDocument.createElementNS(mainNamespace, 'si');
        const text = sharedStringsDocument.createElementNS(mainNamespace, 't');
        if (value !== value.trim()) {
          text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        }
        text.textContent = value;
        item.appendChild(text);
        const index = sharedItems().length;
        sharedStrings.appendChild(item);
        sharedStringIndexes.set(value, index);
        return index;
      };

      const rows = Array.from(sheetData.getElementsByTagNameNS(mainNamespace, 'row'));
      const rowByNumber = new Map(rows.map(row => [Number(row.getAttribute('r')), row]));
      const templateRow = rowByNumber.get(2);
      if (!templateRow) throw new Error('The Landstar template does not include its first load row.');
      const getOrCreateRow = rowNumber => {
        if (rowByNumber.has(rowNumber)) return rowByNumber.get(rowNumber);
        const newRow = templateRow.cloneNode(true);
        newRow.setAttribute('r', String(rowNumber));
        Array.from(newRow.getElementsByTagNameNS(mainNamespace, 'c')).forEach(cell => {
          cell.setAttribute('r', cell.getAttribute('r').replace(/\d+$/, String(rowNumber)));
        });
        const nextRow = Array.from(sheetData.getElementsByTagNameNS(mainNamespace, 'row'))
          .find(row => Number(row.getAttribute('r')) > rowNumber);
        sheetData.insertBefore(newRow, nextRow || null);
        rowByNumber.set(rowNumber, newRow);
        return newRow;
      };
      const getOrCreateCell = (row, rowNumber, column) => {
        const address = XLSX.utils.encode_cell({ r: rowNumber - 1, c: column });
        const existingCell = Array.from(row.getElementsByTagNameNS(mainNamespace, 'c'))
          .find(cell => cell.getAttribute('r') === address);
        if (existingCell) return existingCell;

        const cell = worksheetDocument.createElementNS(mainNamespace, 'c');
        cell.setAttribute('r', address);
        const nextCell = Array.from(row.getElementsByTagNameNS(mainNamespace, 'c'))
          .find(candidate => XLSX.utils.decode_cell(candidate.getAttribute('r')).c > column);
        row.insertBefore(cell, nextCell || null);
        return cell;
      };
      const setCellValue = (cell, value) => {
        const previousType = cell.getAttribute('t');
        if (previousType === 's') sharedStringReferenceDelta -= 1;
        Array.from(cell.children)
          .filter(child => ['f', 'v', 'is'].includes(child.localName))
          .forEach(child => cell.removeChild(child));

        if (value === '' || value == null) {
          cell.removeAttribute('t');
          return;
        }

        const valueElement = worksheetDocument.createElementNS(mainNamespace, 'v');
        if (typeof value === 'number') {
          cell.removeAttribute('t');
          valueElement.textContent = String(value);
        } else {
          cell.setAttribute('t', 's');
          valueElement.textContent = String(getSharedStringIndex(String(value)));
          sharedStringReferenceDelta += 1;
        }
        cell.appendChild(valueElement);
      };

      const headerRow = getOrCreateRow(1);
      headers.forEach((header, column) => {
        setCellValue(getOrCreateCell(headerRow, 1, column), header);
      });

      for (let rowNumber = 2; rowNumber <= range.e.r + 1; rowNumber += 1) {
        const row = rowByNumber.get(rowNumber);
        if (!row) continue;
        Array.from(row.getElementsByTagNameNS(mainNamespace, 'c'))
          .forEach(cell => setCellValue(cell, ''));
      }

      chunkData.forEach((record, recordIndex) => {
        const rowNumber = recordIndex + 2;
        const row = getOrCreateRow(rowNumber);
        const recordValues = new Map(
          Object.entries(record).map(([header, value]) => [normalizeHeader(header), value])
        );
        headers.forEach((header, column) => {
          const value = recordValues.get(normalizeHeader(header)) ?? '';
          setCellValue(getOrCreateCell(row, rowNumber, column), value);
        });
      });

      const lastDataRow = chunkData.length + 1;
      const dimensions = worksheetDocument.getElementsByTagNameNS(mainNamespace, 'dimension');
      if (dimensions.length) {
        dimensions[0].setAttribute(
          'ref',
          `A1:${XLSX.utils.encode_col(range.e.c)}${Math.max(lastDataRow, range.e.r + 1)}`
        );
      }
      if (lastDataRow > 26) {
        Array.from(worksheetDocument.getElementsByTagNameNS(mainNamespace, 'dataValidation'))
          .forEach(validation => {
            validation.setAttribute(
              'sqref',
              validation.getAttribute('sqref').replace(/T2:T26/g, `T2:T${lastDataRow}`)
            );
          });
      }

      const sharedStringCount = Number(sharedStrings.getAttribute('count'));
      sharedStrings.setAttribute(
        'count',
        String((Number.isFinite(sharedStringCount) ? sharedStringCount : 0) + sharedStringReferenceDelta)
      );
      sharedStrings.setAttribute('uniqueCount', String(sharedItems().length));
      zip.file(worksheetPath, serializer.serializeToString(worksheetDocument));
      zip.file('xl/sharedStrings.xml', serializer.serializeToString(sharedStringsDocument));
      exportBlobs.push(await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      }));
      }
    } catch (error) {
      console.error('Could not prepare the official Landstar bulk template:', error);
      say(`Could not create a spreadsheet from the official Landstar template: ${error.message || 'Please try again.'}`);
      return;
    }

    try {
      const brokerSlug = selectedBroker.replace(/[^a-zA-Z0-9]/g, '_');
      for (let index = 0; index < exportBlobs.length; index += 1) {
        const downloadUrl = URL.createObjectURL(exportBlobs[index]);
        const downloadLink = document.createElement('a');
        downloadLink.href = downloadUrl;
        downloadLink.download = exportBlobs.length > 1
          ? `Landstar_Bulk_${brokerSlug}_${index + 1}of${exportBlobs.length}.xlsx`
          : `Landstar_Bulk_${brokerSlug}.xlsx`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
        // Browsers may drop rapid consecutive downloads; space them out slightly.
        if (index < exportBlobs.length - 1) await new Promise(resolve => setTimeout(resolve, 400));
      }
      playExportSound();
      if (exportBlobs.length > 1) {
        say(`${exportBlobs.length} spreadsheets were created (up to ${landstarExportChunkSize} loads each). If your browser asks, allow multiple downloads for this site.`);
      }
      if (skippedBookedCount) {
        say(`${skippedBookedCount} booked load${skippedBookedCount === 1 ? ' was' : 's were'} left out of the Landstar export.`);
      }
      if (inquiryLinkError) console.error(`Driver links were not created: ${inquiryLinkError}`);
    } catch (error) {
      console.error('Could not create the Landstar bulk spreadsheet:', error);
      say('The Landstar bulk spreadsheet could not be created. Please try again.');
      return;
    }

    const exportedAt = new Date().toISOString();
    const registryKey = normalizeCustomerName(selectedBroker);
    const latestRegistry = getLatestExportedRegistry();
    const previousRecords = getExportedRecordsForCustomer(latestRegistry, selectedBroker);
    const nextExportedRecords = {
      ids: Array.from(new Set([
        ...previousRecords.ids,
        ...readyEntries.map(({ ord }) => normalizeLoadId(ord.id))
      ])),
      laneDays: Array.from(new Set([
        ...(previousRecords.laneDays || []),
        ...readyEntries.map(({ ord }) => createLaneDayKey(ord)).filter(Boolean)
      ]))
    };
    const nextExportedRegistry = { ...latestRegistry, [registryKey]: nextExportedRecords };
    let exportedRegistrySaved = true;
    try {
      writeSyncedKey('landstar_exportedLoads', JSON.stringify(nextExportedRegistry));
      setExportedLoadRegistry(nextExportedRegistry);
    } catch (error) {
      exportedRegistrySaved = false;
      console.error('Could not save exported load records:', error);
    }
    // Remember exactly what was posted, so the bot can find and remove the posting
    // later if the load drops off the customer's list.
    const postingsById = new Map(readyEntries.map(({ ord, record }) => [String(ord.id), buildLandstarPosting(record)]));
    const nextOrders = {
      ...customerOrdersMap,
      [selectedBroker]: withExportErrors(markLoadsExported(orders, exportedIds, exportedAt)).map(load => {
        const posting = postingsById.get(String(load.id));
        const withPosting = posting ? {
          ...load, landstarPosting: { ...posting, refreshDetails: getPostingRefreshDetails(load) }
        } : load;
        return inquiryTokens.has(String(load.id)) ? { ...withPosting, inquiryToken: inquiryTokens.get(String(load.id)) } : withPosting;
      })
    };
    const saved = persistAppData(brokers, nextOrders);
    setRateHistory(recordExportedRates(selectedBroker, readyEntries.map(({ ord }) => ord)));
    setExportErrorIds(failedIds);
    setCustomerOrdersMap(nextOrders);
    setSelectedIds(prev => prev.filter(id => !exportedIds.has(String(id))));
    setSelectedOrder(
      selectedOrder && exportedIds.has(String(selectedOrder.id))
        ? nextOrders[selectedBroker].find(order => String(order.id) === String(selectedOrder.id)) || selectedOrder
        : selectedOrder || nextOrders[selectedBroker][0] || null
    );

    const skippedNotes = [];
    if (skippedRxoVanCount) {
      skippedNotes.push(`Left out ${skippedRxoVanCount} RXO van load(s) picking up in WI, IN, OH, MI, MN, SD, ND, UT or ID (not posted for RXO).`);
    }
    if (skippedSameCityCount) {
      skippedNotes.push(`Left out ${skippedSameCityCount} RXO load(s) picking up and delivering in the same city (not posted for RXO).`);
    }
    if (skippedMexicoCount) {
      skippedNotes.push(`Left out ${skippedMexicoCount} load(s) to or from Mexico (never posted).`);
    }
    if (skippedEquipmentExportCount) {
      skippedNotes.push(`Left out ${skippedEquipmentExportCount} intermodal (INT) or oversized load(s) (never posted).`);
    }
    if (movedPickupStarts.length) {
      skippedNotes.push(`Moved the pickup start to now for ${movedPickupStarts.length} load(s) whose pickup window had already started (Landstar rejects a past pickup start). The pickup end time is unchanged.`);
    }
    if (reExportCount > 0) {
      skippedNotes.push(`Re-exported ${reExportCount} load(s) that were already posted to Landstar (ENT). They stay ENT.`);
    }
    if (validationErrors.length) {
      const visibleErrors = validationErrors.slice(0, 10).join('\n');
      const additionalCount = validationErrors.length - 10;
      skippedNotes.push(`Skipped ${validationErrors.length} load(s) that need correction (they stay open and selected):\n\n${visibleErrors}${additionalCount > 0 ? `\n…and ${additionalCount} more load(s).` : ''}`);
    }
    if (missingZipEntries.length) {
      skippedNotes.push(`Skipped ${missingZipEntries.length} load(s) with no ZIP code (enter the Origin/Destination ZIP and export again):\n\n${missingZipEntries.slice(0, 10).map(({ record }) => `${record['Origin City'] || ''} → ${record['Destination City'] || ''}`).join('\n')}`);
    }
    const exportWarnings = [
      ...skippedNotes,
      saved ? '' : 'Browser storage could not be updated, so the archive may not persist after refresh.',
      exportedRegistrySaved ? '' : 'Warning: exported-load history could not be saved, so duplicate imports may occur after refresh.'
    ].filter(Boolean).join('\n\n');
    if (exportWarnings) say(exportWarnings);
  };

  const isGlobalSearch = Boolean(searchQuery.trim());
  const isAllCustomersView = isGlobalSearch || filter === 'OFFER';
  const handleGlobalSearch = value => {
    setSearchQuery(value);
    if (value.trim()) setView('loads');
  };
  // The load list is filtered and sorted only when the loads or the filters change, not on
  // every screen update (bot status, timers, typing in other boxes).
  const { rateCountOrders, withRateCount, noRateCount, visibleOrderEntries, postingCounts } = useMemo(() => {
  const statusOrderEntries = getLoadSearchEntries(customerOrdersMap, selectedBroker, searchQuery, filter === 'OFFER')
    .filter(({ order: ord }) => isGlobalSearch || filter === 'ALL' || ord.status === filter);
  const rateCountOrders = statusOrderEntries.filter(({ customer }) => isAllCustomersView || customer === selectedBroker).map(({ order }) => order);
  const withRateCount = rateCountOrders.filter(hasLoadRate).length;
  const noRateCount = rateCountOrders.length - withRateCount;
  const minMilesFilter = Number(loadFilters.minMiles);
  const maxMilesFilter = Number(loadFilters.maxMiles);
  const hasMinMiles = loadFilters.minMiles !== '' && Number.isFinite(minMilesFilter);
  const hasMaxMiles = loadFilters.maxMiles !== '' && Number.isFinite(maxMilesFilter);
  const visibleOrderEntries = statusOrderEntries.filter(({ order: ord }) => {
    if (loadFilters.pickupDate && getPickupDay(ord) !== loadFilters.pickupDate) return false;
    if (loadFilters.posting && getPostingState(ord) !== loadFilters.posting) return false;
    // Searching all customers still honors the state, rate and miles filters (Daniel 2026-11-27:
    // "searching Chicago, the Texas drop-down doesn't work").
    if (loadFilters.pickupState && String(ord.origSt || '').trim().toUpperCase() !== loadFilters.pickupState) return false;
    if (loadFilters.deliveryState && String(ord.destSt || '').trim().toUpperCase() !== loadFilters.deliveryState) return false;
    if (loadFilters.rate === 'with' && !hasLoadRate(ord)) return false;
    if (loadFilters.rate === 'without' && hasLoadRate(ord)) return false;
    if (hasMinMiles || hasMaxMiles) {
      const miles = Number(normalizeMilesValue(ord.miles));
      if (hasMinMiles && !(miles >= minMilesFilter)) return false;
      if (hasMaxMiles && !(miles <= maxMilesFilter)) return false;
    }
    return true;
  }).sort(({ order: left, customer: leftCustomer }, { order: right, customer: rightCustomer }) => {
    const priority = Number(Boolean(String(right.needsCapacity || '').trim()))
      - Number(Boolean(String(left.needsCapacity || '').trim()));
    if (priority) return priority;
    // 🔥 Hot lanes (other agents booking them) come next, so we stay on top of them.
    const hot = Number(Boolean(getHotLane(right, hotLanes))) - Number(Boolean(getHotLane(left, hotLanes)));
    if (hot) return hot;
    // RXO VAN (the big list): into Texas, into Florida and out of Texas first (Daniel 2026-11-27).
    const laneFirst = (customer, load) => Number(accountKey(customer) === 'RXO2429200ATZV' && isPriorityBigListLane(load));
    const lane = laneFirst(rightCustomer, right) - laneFirst(leftCustomer, left);
    if (lane) return lane;
    if (!laneSort || laneSort === 'pickup-asc' || laneSort === 'pickup-desc') {
      const difference = getPickupSortValue(left) - getPickupSortValue(right);
      return (laneSort === 'pickup-desc' ? -difference : difference)
        || String(left.id).localeCompare(String(right.id), undefined, { numeric: true });
    }
    const descending = laneSort.endsWith('-desc');
    const sortKey = laneSort.replace(/-asc$|-desc$/, '');
    const isOrigin = sortKey.startsWith('origin');
    const [leftCity, leftState] = isOrigin
      ? [left.origCity, left.origSt]
      : [left.destCity, left.destSt];
    const [rightCity, rightState] = isOrigin
      ? [right.origCity, right.origSt]
      : [right.destCity, right.destSt];
    const stateFirst = sortKey.endsWith('-state');
    const leftLocation = stateFirst ? [leftState, leftCity] : [leftCity, leftState];
    const rightLocation = stateFirst ? [rightState, rightCity] : [rightCity, rightState];
    const comparison = leftLocation.map(value => String(value || '').trim()).join(', ').localeCompare(
      rightLocation.map(value => String(value || '').trim()).join(', '),
      undefined,
      { sensitivity: 'base', numeric: true }
    );
    return (descending ? -comparison : comparison) || String(left.id).localeCompare(String(right.id));
  });
  const postingCounts = { posted: 0, sent: 0, unposted: 0, error: 0 };
  rateCountOrders.forEach(order => { const state = getPostingState(order); if (state) postingCounts[state] += 1; });
  return { rateCountOrders, withRateCount, noRateCount, visibleOrderEntries, postingCounts };
  }, [customerOrdersMap, selectedBroker, searchQuery, filter, loadFilters, laneSort, isGlobalSearch, hotLanes]);
  // Load cards are drawn a page at a time; more appear as you scroll to the bottom.
  const [listLimit, setListLimit] = useState(LOAD_LIST_PAGE);
  const listEndRef = useRef(null);
  useEffect(() => { setListLimit(LOAD_LIST_PAGE); }, [selectedBroker, searchQuery, filter, loadFilters, laneSort]);
  // The filters that are on, as tags under the day row (tap one to turn it off).
  const activeFilterTags = [
    loadFilters.pickupDate && { key: 'date', label: `Pickup ${loadFilters.pickupDate.slice(5).replace('-', '/')}`, clear: () => setLoadFilters(prev => ({ ...prev, pickupDate: '' })) },
    (loadFilters.pickupState || loadFilters.deliveryState) && { key: 'states', label: `${loadFilters.pickupState || 'Any'} → ${loadFilters.deliveryState || 'Any'}`, clear: () => setLoadFilters(prev => ({ ...prev, pickupState: '', deliveryState: '' })) },
    loadFilters.rate && { key: 'rate', label: loadFilters.rate === 'with' ? 'With rate' : 'No rate', clear: () => setLoadFilters(prev => ({ ...prev, rate: '' })) },
    (loadFilters.minMiles || loadFilters.maxMiles) && { key: 'miles', label: `${loadFilters.minMiles || 0}–${loadFilters.maxMiles || '∞'} mi`, clear: () => setLoadFilters(prev => ({ ...prev, minMiles: '', maxMiles: '' })) },
    loadFilters.posting && { key: 'posting', label: { posted: 'Posted', sent: 'Sent to bot', unposted: 'Not posted', error: 'Errors' }[loadFilters.posting], clear: () => setLoadFilters(prev => ({ ...prev, posting: '' })) },
    laneSort && laneSort !== 'pickup-asc' && { key: 'sort', label: (LANE_SORT_CHOICES.find(([value]) => value === laneSort) || [, 'Sorted'])[1], clear: () => setLaneSort('') }
  ].filter(Boolean);
  const selectedCardIndex = selectedOrder
    ? visibleOrderEntries.findIndex(({ customer, order }) => customer === selectedBroker && order.id === selectedOrder.id)
    : -1;
  // The selected load is always drawn, even if it is further down the list.
  const shownOrderEntries = visibleOrderEntries.slice(0, Math.max(listLimit, selectedCardIndex + 1));
  const hiddenLoadCount = visibleOrderEntries.length - shownOrderEntries.length;
  useEffect(() => {
    const end = listEndRef.current;
    if (!end || hiddenLoadCount <= 0 || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setListLimit(limit => limit + LOAD_LIST_PAGE);
    }, { rootMargin: '600px' });
    observer.observe(end);
    return () => observer.disconnect();
  }, [hiddenLoadCount, shownOrderEntries.length]);
  const filteredOrders = visibleOrderEntries
    .filter(({ customer }) => customer === selectedBroker)
    .map(({ order }) => order);

  const handleSelectSearchResult = (customer, order) => {
    if (customer !== selectedBroker) {
      setSelectedBroker(customer);
      setSelectedIds([]);
      setExportErrorIds([]);
    }
    setSelectedOrder(order);
    // From Billing (Booked loads / Bookings report): clicking a load opens it (Daniel 2026-11-27).
    if (view !== 'loads') setView('loads');
    // Phone: the load details sit under the list, so jump down to them.
    if (isPhoneScreen()) {
      setTimeout(() => document.querySelector('.tms-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  };

  // ⚙ Rules for the open customer (src/app/CustomerRulesPanel.jsx), saved in My Settings.
  const [showRules, setShowRules] = useState(false);
  // Saves this load's truck (with its driver) and carrier in My Settings, so typing the truck #
  // or MC # again brings them back (Daniel 2026-11-27).
  const rememberCapacity = load => {
    if (!load) return;
    const truckBook = rememberTruck(profile.truckBook, load);
    const carrierBook = rememberCarrier(profile.carrierBook, load);
    if (JSON.stringify(truckBook) === JSON.stringify(profile.truckBook || {})
      && JSON.stringify(carrierBook) === JSON.stringify(profile.carrierBook || {})) return;
    const nextProfile = { ...profile, truckBook, carrierBook };
    try {
      if (writeSyncedKey('landstar_profile', JSON.stringify(nextProfile))) setProfile(nextProfile);
    } catch (error) {
      console.error('Could not save the truck or carrier:', error);
    }
  };

  const saveCustomerRules = rules => {
    const nextRules = { ...(profile.customerRules || {}) };
    if (hasCustomerRules(rules)) nextRules[selectedBroker] = rules;
    else delete nextRules[selectedBroker];
    const nextProfile = { ...profile, customerRules: nextRules };
    try {
      if (writeSyncedKey('landstar_profile', JSON.stringify(nextProfile))) setProfile(nextProfile);
      else notify('Your settings were changed on another device; open ⚙ Rules again and save once more.');
    } catch (error) {
      notify(`Could not save the rules: ${error.message}`);
      return;
    }
    setShowRules(false);
  };

  const [listView, setListView] = useState(readListView);
  useEffect(() => {
    if (typeof document !== 'undefined') document.body.classList.toggle('tms-table-view', listView === 'table');
    try { localStorage.setItem(listViewKey, listView); } catch { /* remembered for this visit */ }
  }, [listView]);

  // ⌨ Keyboard shortcuts (Daniel 2026-11-27). Ignored while typing in a box or with a window
  // open; the two that send something to Landstar need Shift so a stray key never does.
  const [showShortcuts, setShowShortcuts] = useState(false);
  // ⋯ menu on a customer row, and the Import list (kept last: tests read state by position).
  const [customerMenu, setCustomerMenu] = useState(null);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showDataMenu, setShowDataMenu] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showPostingDetails, setShowPostingDetails] = useState(false);
  const [openSchedulePickers, setOpenSchedulePickers] = useState({});
  const [chatWaitingCount, setChatWaitingCount] = useState(0);
  const shortcutActions = useRef({});
  shortcutActions.current = {
    move(step) {
      if (!visibleOrderEntries.length) return;
      const from = selectedCardIndex < 0 ? (step > 0 ? -1 : visibleOrderEntries.length) : selectedCardIndex;
      const next = visibleOrderEntries[Math.min(visibleOrderEntries.length - 1, Math.max(0, from + step))];
      if (!next) return;
      handleSelectSearchResult(next.customer, next.order);
      setTimeout(() => document.getElementById(`load-card-${next.order.id}`)?.scrollIntoView({ block: 'nearest' }), 30);
    },
    toggle() {
      if (selectedOrder) handleToggleSelect(selectedOrder.id, { stopPropagation() {} }, selectedBroker);
    },
    copy() {
      if (!selectedOrder) return;
      void copyToClipboard(`${selectedOrder.id} ${getLoadCardRoute(selectedOrder)}`.trim(), 'Load number and route');
      notify(`📋 Copied ${selectedOrder.id} ${getLoadCardRoute(selectedOrder)}`, 'info');
    },
    search() {
      const box = document.querySelector('input[aria-label="Search loads across all customers"]');
      box?.focus();
      box?.select?.();
    },
    exportLoads() { void handleExportToLandstar(); },
    book() { if (selectedOrder) handleBookLoad(); }
  };
  useEffect(() => {
    const onKey = event => {
      const target = event.target;
      const typing = target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || '');
      if (event.key === 'Escape') { setShowShortcuts(false); return; }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === '?') { event.preventDefault(); setShowShortcuts(open => !open); return; }
      // Another window (an import question, CH Offers, Today...) is open: leave its keys alone.
      if (document.querySelector('[role="dialog"]')) return;
      const act = shortcutActions.current;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const run = action => { event.preventDefault(); action(); };
      if (key === 'ArrowDown' || (key === 'j' && !event.shiftKey)) run(() => act.move(1));
      else if (key === 'ArrowUp' || (key === 'k' && !event.shiftKey)) run(() => act.move(-1));
      else if (key === 'x' && !event.shiftKey) run(act.toggle);
      else if (key === 'c' && !event.shiftKey) run(act.copy);
      else if (key === '/') run(act.search);
      else if (key === 'e' && event.shiftKey) run(act.exportLoads);
      else if (key === 'b' && event.shiftKey) run(act.book);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleFieldChange = (field, value) => {
    handleInputChange(field, value);
  };

  const handleRateKeyDown = event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const rate = Number(String(selectedOrder?.rateInput || '').replace(/[$,]/g, ''));
    if (!(rate > 0) || !Number.isFinite(rate)) return;

    const currentIndex = filteredOrders.findIndex(order => order.id === selectedOrder.id);
    const nextOrder = currentIndex >= 0 ? filteredOrders[currentIndex + 1] : null;
    if (nextOrder) setSelectedOrder(nextOrder);
  };

  const entCount = orders.filter(o => o.status === 'ENT').length;
  const bookedCount = orders.filter(o => o.status === 'BOOKED').length;
  const offerCount = Object.values(customerOrdersMap || {}).flat().filter(o => o?.status === 'OFFER').length;
  const allBookedCount = Object.values(customerOrdersMap || {}).flat().filter(o => o?.status === 'BOOKED').length;
  const driverDirectory = buildDriverDirectory(customerOrdersMap);

  const handleBackupExport = () => {
    const data = {};
    Object.keys(localStorage)
      .filter(key => key.startsWith('landstar_') && key !== 'landstar_gmailClientId')
      .forEach(key => { data[key] = localStorage.getItem(key); });
    const blob = new Blob([JSON.stringify({ app: 'landstar-tms-reader', savedAt: new Date().toISOString(), data })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `landstar-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Replaces the whole load list with a saved copy from History; customers in the copy
  // are added back to the customer list. Returns false when it could not be saved.
  const restoreLoadListSnapshot = snapshotValue => {
    let parsed;
    try {
      parsed = JSON.parse(snapshotValue);
    } catch (error) {
      return false;
    }
    // Never fall back to the sample loads for a damaged copy.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const nextOrders = removeExpiredExportedLoads(normalizeCustomerOrders(parsed));
    const nextBrokers = normalizeBrokerList([...brokers, ...Object.keys(nextOrders)]);
    const saved = persistAppData(nextBrokers, nextOrders);
    if (!saved) return false;
    setBrokers(nextBrokers);
    setCustomerOrdersMap(nextOrders);
    setSelectedOrder((nextOrders[selectedBroker] || [])[0] || null);
    return true;
  };

  const handleBackupImport = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const entries = Object.entries(backup?.data || {})
        .filter(([key, value]) => key.startsWith('landstar_') && typeof value === 'string');
      if (backup?.app !== 'landstar-tms-reader' || entries.length === 0) {
        throw new Error('This is not a Landstar TMS backup file.');
      }
      if (!window.confirm(`Restore this backup (${new Date(backup.savedAt).toLocaleString()})? It will replace the customers, loads, rates and exported-load history in this browser.`)) return;
      entries.forEach(([key, value]) => localStorage.setItem(key, value));
      // Bump restored keys so other tabs and devices adopt the backup instead of
      // treating it as a regression from an outdated app version.
      const versions = readDataVersions();
      entries.forEach(([key]) => {
        if (syncedDataKeys.includes(key)) versions[key] = (versions[key] || 0) + 1;
      });
      localStorage.setItem(dataVersionKey, JSON.stringify(versions));
      window.location.reload();
    } catch (error) {
      notify(`Could not restore the backup: ${error.message}`);
    }
  };

  return (
    <div className="tms-shell flex flex-col md:flex-row min-h-screen md:h-screen text-white overflow-x-hidden md:overflow-hidden font-sans">
      <ProblemBanner problems={today?.problems || []} />
      {showRules && selectedBroker && (
        <CustomerRulesPanel
          customer={selectedBroker}
          rules={getCustomerRules(profile.customerRules, selectedBroker)}
          onSave={saveCustomerRules}
          onClose={() => setShowRules(false)}
        />
      )}
      <TruckLights />
      {/* Left Sidebar - Order List */}
      <div className="tms-sidebar w-full md:w-96 border-b md:border-b-0 md:border-r border-[#1c2541] flex flex-col">
        <div className="tms-sidebar-header p-3 border-b border-[#1c2541]">
          <ToolsDrawer selected={selectedBroker} count={brokers.length}>
          <div className="tms-top-controls flex flex-col items-start gap-2 mb-2">
            <button
              type="button"
              onClick={() => setShowTools(open => !open)}
              aria-expanded={showTools}
              className="text-[10px] font-bold text-gray-300 hover:text-white self-start"
            >
              {showTools ? '▾ Hide tools' : '▸ Show tools'}
            </button>
            {showTools && (
            <div className="tms-toolbox">
              {/* Import and Data: two menus side by side (Daniel 2026-11-27: slim, professional). The
                  choices stay on the page while closed (only hidden), so a file picked from the list
                  is still read and a Data window that is open stays open. */}
              <div className="tms-menu-pair">
                <button
                  type="button"
                  onClick={() => { setShowImportMenu(open => !open); setShowDataMenu(false); }}
                  aria-expanded={showImportMenu}
                  className="tms-slim-btn tms-menu-toggle"
                  data-active={showImportMenu}
                  data-tone="emerald"
                >
                  <span>{isImportingScreenshot ? (screenshotImportProgress || 'Importing…') : 'Import'}</span>
                  <span className="tms-caret" aria-hidden="true">▾</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setShowDataMenu(open => !open); setShowImportMenu(false); }}
                  aria-expanded={showDataMenu}
                  className="tms-slim-btn tms-menu-toggle"
                  data-active={showDataMenu}
                  data-tone="violet"
                >
                  <span>Data</span>
                  <span className="tms-caret" aria-hidden="true">▾</span>
                </button>
              </div>
                <div
                  className={`tms-import-menu${showImportMenu ? '' : ' hidden'}`}
                  onClick={event => { if (event.target?.closest?.('button, label')) setShowImportMenu(false); }}
                >
                  <button
                    type="button"
                    onClick={handleAddManualLoad}
                    className="tms-tool"
                    data-accent="emerald"
                    title="Add one load by hand to the selected customer and fill it in. It stays until you delete it: importing the customer's list never removes it."
                  >
                    ＋ Add Load
                  </button>
                  <label className={`tms-tool cursor-pointer ${isImportingScreenshot ? 'opacity-60 cursor-wait' : ''}`} data-accent="emerald" title="Import the customer's list from one or more screenshots. Pick several pictures at once (Ctrl+click) when the list is longer than one screen; they are imported together as one list.">
                    <span>{isImportingScreenshot && screenshotImportMode === 'ai' ? screenshotImportProgress : 'Customer Screenshot'}</span>
                    <input type="file" accept="image/*" multiple onChange={handleScreenshotImport} className="hidden" disabled={isImportingScreenshot} />
                  </label>
                  <button
                    type="button"
                    onClick={handlePasteNtgScreenshot}
                    disabled={isImportingScreenshot}
                    className="tms-tool"
                    data-accent="amber"
                    title="Take a snip with Win+Shift+S, then paste it here without saving a file. You can also click the app background and press Ctrl+V. Imports into the selected customer."
                  >
                    Paste NTG Screenshot
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePasteScreenshot('dat')}
                    disabled={isImportingScreenshot}
                    className="tms-tool"
                    data-accent="indigo"
                    title="Take a snip of the DAT load board with Win+Shift+S, then paste it here without saving a file. Imports into the selected customer."
                  >
                    {isImportingScreenshot && screenshotImportMode === 'dat' ? screenshotImportProgress : 'Paste DAT Screenshot'}
                  </button>
                  <label
                    className="tms-tool cursor-pointer"
                    data-accent="sky"
                    title={`Import an Excel or OpenOffice (.ods) spreadsheet. An RXO order export (orderSearch_Export) of loads other agents booked becomes 🔥 hot lanes instead${hotLanes?.lanes ? ` (now ${Object.keys(hotLanes.lanes).length} from ${hotLanes.file || 'an order export'}, ${new Date(hotLanes.importedAt).toLocaleDateString('en-US')})` : ''}.`}
                  >
                    <span>Import Excel</span>
                    <input type="file" accept=".xlsx, .xls, .ods, .csv" multiple onChange={handleExcelImport} className="hidden" />
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsGmailImportOpen(open => !open)}
                    className="tms-tool"
                    data-accent="rose"
                    title="Search Gmail for loads"
                  >
                    Import Gmail
                  </button>
                  <button
                    type="button"
                    onClick={() => setTextImport(current => (current === null ? '' : null))}
                    className="tms-tool"
                    data-accent="rose"
                    title="Paste a load list written as text (like Ryan's Square list in Google Chat): City, ST ZIP → City, ST ZIP, then the details"
                  >
                    Paste Text List
                  </button>
                </div>
                <div
                  className={`tms-data-menu${showDataMenu ? '' : ' is-closed'}`}
                  onClick={event => { if (!event.target?.closest?.('[role="dialog"]') && event.target?.closest?.('button, label')) setShowDataMenu(false); }}
                >
                  <button
                    type="button"
                    onClick={handleBackupExport}
                    className="tms-tool"
                    data-accent="slate"
                    title="Download all customers, loads and rates as a backup file"
                  >
                    Backup
                  </button>
                  <label className="tms-tool cursor-pointer" data-accent="slate" title="Restore customers, loads and rates from a backup file">
                    <span>Restore</span>
                    <input type="file" accept=".json,application/json" onChange={handleBackupImport} className="hidden" />
                  </label>
                  <LoadListHistory onRestore={restoreLoadListSnapshot} />
                  <Prospects />
                  <ChOffers onAddToTms={handleAddChOffersToTms} newLanes={chOffersNewLanes} inTmsKeys={chOffersInTmsKeys} onOpenLoad={openChOffersLoad} />
                </div>
            </div>
            )}
          </div>

          {textImport !== null && (
            <div className="mb-3 rounded border border-rose-700/60 bg-[#0b132b] p-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-white">Paste Text List → {selectedBroker || 'pick a customer first'}</span>
                <button type="button" onClick={() => setTextImport(null)} className="text-gray-400 hover:text-white text-xs cursor-pointer" aria-label="Close text import">✕</button>
              </div>
              <p className="text-[10px] text-gray-400 mb-1">
                Copy the whole message (each load starts with "City, ST ZIP → City, ST ZIP") and paste it here. The pickup day is estimated from the delivery date and miles; it's written in each load's notes so you can confirm it.
              </p>
              <textarea
                value={textImport}
                onChange={event => setTextImport(event.target.value)}
                rows={8}
                placeholder={'Charlotte, NC 28273 → Cincinnati, OH 45246\nHAZMAT · UN2796 SULFURIC ACID · Van · 43,504 lbs · 491 mi · Ref 31474-08698 · PU 06:00–14:00 · DEL Tue 11/24'}
                className="w-full bg-[#161f36] border border-[#1c2541] rounded p-1.5 text-xs text-white placeholder-gray-500 mb-2 font-mono"
              />
              <button
                type="button"
                disabled={!selectedBroker || !textImport.trim()}
                onClick={handleTextImport}
                className="bg-rose-700 hover:bg-rose-600 disabled:opacity-50 px-3 py-1 text-xs font-bold rounded text-white cursor-pointer"
              >
                Import into {selectedBroker || '…'}
              </button>
            </div>
          )}
          {isGmailImportOpen && (
            <div className="mb-3 rounded border border-red-700/60 bg-[#0b132b] p-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-white">Gmail Load Import</span>
                <button
                  type="button"
                  onClick={() => setIsGmailImportOpen(false)}
                  className="text-xs text-gray-400 hover:text-white"
                  aria-label="Close Gmail import"
                >
                  Close
                </button>
              </div>
              <p className="text-[10px] leading-relaxed text-gray-400 mb-2">
                Setup required once: in Google Cloud Console, create a project, enable Gmail API, configure the OAuth consent screen and create an OAuth Client ID for a Web application. Add this app’s origin (localhost:5173 and your deployed origin) to Authorized JavaScript origins. Do not enter a client secret here.
              </p>
              <label className="block text-[10px] text-gray-400 mb-1" htmlFor="gmail-client-id">Google OAuth Web client ID</label>
              <input
                id="gmail-client-id"
                type="text"
                value={gmailClientId}
                onChange={event => setGmailClientId(event.target.value)}
                placeholder="...apps.googleusercontent.com"
                className="w-full bg-[#161f36] border border-[#1c2541] rounded p-1.5 text-xs text-white placeholder-gray-500 mb-2"
              />
              <label className="block text-[10px] text-gray-400 mb-1" htmlFor="gmail-search-query">Gmail search query</label>
              <input
                id="gmail-search-query"
                type="text"
                value={gmailQuery}
                onChange={event => setGmailQuery(event.target.value)}
                placeholder="newer_than:7d or from:sender@example.com"
                className="w-full bg-[#161f36] border border-[#1c2541] rounded p-1.5 text-xs text-white placeholder-gray-500 mb-2"
              />
              <p className="text-[10px] text-gray-500 mb-2">
                Imports only the newest email matching this query. Only requests Gmail read-only access after you authorize Google. Pickup date comes from date headings; delivery dates are left blank if absent.
              </p>
              <p className="text-[10px] text-amber-300 mb-2">
                Every import calculates driving miles with Google Routes for all customers, replacing the miles on the import. Enable the Routes API and configure GOOGLE_MAPS_API_KEY on the server (or in your local .env file); never put the key in browser code.
              </p>
              {gmailImportProgress && <p role="status" className="text-[10px] text-amber-300 mb-2">{gmailImportProgress}</p>}
              <button
                type="button"
                onClick={handleGmailImport}
                disabled={!gmailAuthReady || gmailImportProgress.startsWith('Searching') || gmailImportProgress.startsWith('Reading') || gmailImportProgress.startsWith('Calculating')}
                className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-wait px-2 py-1.5 text-xs font-bold rounded text-white"
              >
                {gmailImportProgress && gmailImportProgress.startsWith('Reading')
                  ? gmailImportProgress
                  : gmailAuthReady ? 'Authorize Gmail & Import Matching Loads' : 'Loading Google Authorization...'}
              </button>
            </div>
          )}

          {/* Customer / Broker Buttons */}
          <div className="tms-customers-section flex flex-col gap-1.5 my-2">
            <button
              type="button"
              onClick={() => setShowCustomers(open => !open)}
              aria-expanded={showCustomers}
              className="text-[11px] text-gray-400 font-bold uppercase tracking-wider hover:text-white text-left"
            >
              {showCustomers ? '▾' : '▸'} Customers / Brokers ({brokers.length})
            </button>
            {showCustomers && groupCustomers(brokers).map(row => {
              // One line per account (Daniel 2026-11-27): the short name, a tab per account
              // (VAN, REEFER, ...), and ⋯ for Share / Edit / Delete.
              const names = row.members.map(member => member.name);
              const isGroup = names.length > 1;
              const menuOpen = customerMenu === row.key;
              const editing = names.includes(editingBroker) ? editingBroker : null;
              const single = splitCustomerName(names[0]);
              return (
                <div
                  key={row.key}
                  draggable={!editing}
                  title="Drag to change the order"
                  onDragStart={event => {
                    event.dataTransfer.setData(customerDragType, JSON.stringify(names));
                    event.dataTransfer.effectAllowed = 'move';
                    event.currentTarget.classList.add('is-dragging');
                  }}
                  onDragEnd={event => event.currentTarget.classList.remove('is-dragging')}
                  onDragOver={event => {
                    if (![...event.dataTransfer.types].includes(customerDragType)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    event.currentTarget.classList.add('is-drop-target');
                  }}
                  onDragLeave={event => event.currentTarget.classList.remove('is-drop-target')}
                  onDrop={event => {
                    event.preventDefault();
                    event.currentTarget.classList.remove('is-drop-target');
                    const raw = event.dataTransfer.getData(customerDragType);
                    let dragged;
                    try { dragged = JSON.parse(raw); } catch { dragged = [raw]; }
                    if (!Array.isArray(dragged)) dragged = [raw];
                    setBrokers(current => moveCustomers(current, dragged, names[0]));
                  }}
                  className="tms-account-row"
                  data-selected={names.includes(selectedBroker)}
                >
                  <div className="tms-account-line">
                    <span className="tms-drag-handle" aria-hidden="true">⠿</span>
                    {isGroup ? (
                      <>
                        <span className="tms-account-name" title={row.base}>{shortAccountName(row.base)}</span>
                        <span className="tms-account-tabs">
                          {row.members.map(member => (
                            <button
                              key={member.name}
                              type="button"
                              data-close-drawer
                              onClick={() => handleSelectBroker(member.name)}
                              aria-pressed={selectedBroker === member.name}
                              title={sharedCustomers[member.name] ? `${member.name} (shared with teammates)` : member.name}
                              className="tms-account-tab"
                              data-kind={accountTagKind(member.tag)}
                              // Drag a tab onto another tab in the same row to change their order
                              // (Daniel 2026-11-27: "make it organizable").
                              draggable
                              onDragStart={event => {
                                event.stopPropagation();
                                event.dataTransfer.setData(accountTabDragType, member.name);
                                event.dataTransfer.effectAllowed = 'move';
                                event.currentTarget.classList.add('is-dragging');
                              }}
                              onDragEnd={event => event.currentTarget.classList.remove('is-dragging')}
                              onDragOver={event => {
                                if (![...event.dataTransfer.types].includes(accountTabDragType)) return;
                                event.preventDefault();
                                event.stopPropagation();
                                event.currentTarget.classList.add('is-drop-target');
                              }}
                              onDragLeave={event => event.currentTarget.classList.remove('is-drop-target')}
                              onDrop={event => {
                                if (![...event.dataTransfer.types].includes(accountTabDragType)) return;
                                event.preventDefault();
                                event.stopPropagation();
                                event.currentTarget.classList.remove('is-drop-target');
                                const dragged = event.dataTransfer.getData(accountTabDragType);
                                if (dragged && dragged !== member.name && names.includes(dragged)) {
                                  setBrokers(current => moveCustomer(current, dragged, member.name));
                                }
                              }}
                            >
                              {member.tag}{sharedCustomers[member.name] && <span className="tms-shared-dot" aria-label="shared" />}
                            </button>
                          ))}
                        </span>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="tms-account-single"
                        data-close-drawer
                        aria-pressed={selectedBroker === names[0]}
                        onClick={() => handleSelectBroker(names[0])}
                        title={sharedCustomers[names[0]] ? `${names[0]} (shared with teammates)` : names[0]}
                      >
                        <span className="truncate">{single.tag ? single.base : names[0]}</span>
                        {single.tag && <span className="tms-account-tag">{single.tag}</span>}
                        {sharedCustomers[names[0]] && <span className="tms-shared-dot" aria-label="shared" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setCustomerMenu(menuOpen ? null : row.key)}
                      aria-expanded={menuOpen}
                      aria-label={`Share, edit or delete ${row.base}`}
                      title="Share, edit or delete"
                      className="tms-account-more"
                    >
                      ⋯
                    </button>
                  </div>
                  {menuOpen && (
                    <div className="tms-account-menu">
                      {row.members.map(member => (
                        <div key={member.name} className="tms-account-menu-line">
                          <span className="tms-account-menu-name">{member.name}</span>
                          {sharing && (
                            <button type="button" onClick={() => { setCustomerMenu(null); openShareDialog(member.name); }} title="Share this customer with teammates" className="tms-slim-btn" data-tone="emerald">
                              Share
                            </button>
                          )}
                          <button type="button" onClick={() => { setCustomerMenu(null); setEditingBroker(member.name); setEditBrokerInput(member.name); }} title="Edit Customer" className="tms-slim-btn" data-tone="blue">
                            Rename
                          </button>
                          <button type="button" onClick={event => { setCustomerMenu(null); handleDeleteBroker(member.name, event); }} title="Delete Customer" className="tms-slim-btn tms-danger" data-tone="red">
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {editing && (
                    <form onSubmit={event => handleSaveEditBroker(editing, event)} className="tms-account-menu-line mt-2">
                      <input
                        type="text"
                        value={editBrokerInput}
                        onChange={event => setEditBrokerInput(event.target.value)}
                        autoFocus
                        aria-label="Customer name"
                        className="tms-slim-input flex-1 min-w-[10rem]"
                      />
                      <button type="submit" className="tms-slim-btn tms-primary">Save</button>
                      <button type="button" onClick={() => setEditingBroker(null)} className="tms-slim-btn">Cancel</button>
                    </form>
                  )}
                </div>
              );
            })}

            {showCustomers && (isAddingBroker ? (
              <form onSubmit={handleAddBroker} className="flex items-center space-x-1 mt-1 w-full">
                <input
                  type="text"
                  placeholder="Customer ID / Name..."
                  value={newBrokerInput}
                  onChange={(e) => setNewBrokerInput(e.target.value)}
                  autoFocus
                  className="tms-slim-input flex-1"
                />
                <button type="submit" className="tms-slim-btn tms-primary">Add</button>
                <button type="button" onClick={() => setIsAddingBroker(false)} className="tms-slim-btn">Cancel</button>
              </form>
            ) : (
              <button
                onClick={() => setIsAddingBroker(true)}
                className="tms-slim-btn tms-add-customer"
              >
                + Add Customer
              </button>
            ))}
          </div>

          </ToolsDrawer>

          <div className="relative mb-2">
            <input
              type="text"
              placeholder="🔍 Search all customers: load #, city, state..."
              aria-label="Search loads across all customers"
              value={searchQuery}
              onChange={(e) => handleGlobalSearch(e.target.value)}
              className="w-full bg-[#0b132b] border-2 border-blue-500/60 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-400 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/40"
            />
          </div>
          {isGlobalSearch && (
            <p className="mb-2 text-[10px] text-gray-400">
              All customers · All folders and load statuses · Filters narrow the search too. Click a result to open its customer.
              Bulk selection and export apply to the selected customer only.
            </p>
          )}

          <div className="flex items-center justify-between text-[11px] text-gray-400 mb-2">
            <span>{isAllCustomersView ? `${visibleOrderEntries.length} ${isGlobalSearch ? 'matches' : 'offers'} · All customers` : `${filteredOrders.length} shown · ${orders.length} loads · ${entCount} ENT · ${bookedCount} booked`}</span>
            <span className={storageError ? 'text-amber-400' : 'text-emerald-400'} title={storageError || 'Loads are saved in this browser.'}>
              {storageError || '🔒 Saved in this browser'}
            </span>
          </div>

          {/* Slim filter area (Daniel 2026-11-27: "futuristic and classic ... professional"): one
              status bar, one day row with a Filters button, the active filters as tags. */}
          <div className="tms-status-bar" role="group" aria-label="Load status">
            {['ALL', 'OPEN', 'ON HOLD', 'OFFER', 'ENT', 'BOOKED'].map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  // BOOKED opens its page; OFFER filters this list across all customers.
                  if (tab === 'BOOKED') {
                    setView('booked');
                  } else {
                    setFilter(tab);
                    setView('loads');
                  }
                }}
                title={tab === 'BOOKED' ? 'Billing: booked loads (every load with a driver, all customers) and the bookings report' : tab === 'OFFER' ? 'Show offers across all customers' : undefined}
                aria-pressed={tab === 'BOOKED' ? view === 'booked' || view === 'report' : view === 'loads' && filter === tab}
                data-status={tab.replace(' ', '-')}
                className="tms-status-tab"
              >
                {tab === 'BOOKED' ? `BOOKED (${allBookedCount})` : tab === 'OFFER' ? `OFFER (${offerCount})` : tab}
              </button>
            ))}
          </div>

          <div className="tms-day-row" role="group" aria-label="Quick pickup dates">
            <button
              type="button"
              onClick={() => { setLoadFilters(prev => ({ ...prev, pickupDate: '' })); setSelectedIds([]); }}
              aria-label="Clear pickup date filter"
              data-tone="slate"
              aria-pressed={!loadFilters.pickupDate}
              className="tms-slim-btn tms-toggle"
            >
              All days
            </button>
            {[['Today', 0], ['Tomorrow', 1]].map(([label, offset]) => (
              <button
                key={label}
                type="button"
                data-tone={offset ? 'sky' : 'emerald'}
                aria-pressed={loadFilters.pickupDate === pickupDayFromToday(offset)}
                onClick={() => {
                  setLoadFilters(prev => ({ ...prev, pickupDate: pickupDayFromToday(offset) }));
                  setSelectedIds([]);
                }}
                className="tms-slim-btn tms-toggle"
              >
                {label}
              </button>
            ))}
            <span className="tms-date-pick">
              <input
                id="pickup-date-filter"
                type="date"
                value={loadFilters.pickupDate}
                onClick={event => {
                  if (typeof event.currentTarget.showPicker === 'function') event.currentTarget.showPicker();
                }}
                onChange={e => { setLoadFilters(prev => ({ ...prev, pickupDate: e.target.value })); setSelectedIds([]); }}
                className="tms-date-input focus-visible:ring-2"
                title="Show only loads picking up on this day"
                tabIndex={-1}
              />
              <button
                type="button"
                aria-label="Open pickup date calendar"
                data-tone="violet"
                aria-controls="pickup-date-filter"
                aria-pressed={Boolean(loadFilters.pickupDate) && ![0, 1].some(offset => pickupDayFromToday(offset) === loadFilters.pickupDate)}
                title="Pick a pickup day"
                onClick={event => {
                  const input = event.currentTarget.parentElement.querySelector('input');
                  input.focus();
                  if (typeof input.showPicker === 'function') input.showPicker();
                }}
                className="tms-slim-btn tms-toggle"
              >
                Date
              </button>
            </span>
            <button
              type="button"
              onClick={() => setShowFilters(open => !open)}
              aria-expanded={showFilters}
              className="tms-slim-btn tms-filters-toggle"
              data-tone="cyan"
              data-active={showFilters || activeFilterTags.length > 0}
            >
              Filters{activeFilterTags.length ? ` · ${activeFilterTags.length}` : ''}
              <span className="tms-caret" aria-hidden="true">▾</span>
            </button>
          </div>

          {/* Landstar posting (Daniel 2026-11-27): posted, not posted yet, and errors. */}
          <div className="tms-day-row" role="group" aria-label="Landstar posting">
            <span className="tms-filter-label">Landstar</span>
            {[
              ['', 'All', 'slate'],
              ['posted', `Posted (${postingCounts.posted})`, 'emerald'],
              ...(postingCounts.sent ? [['sent', `Sent to bot (${postingCounts.sent})`, 'violet']] : []),
              ['unposted', `Not posted (${postingCounts.unposted})`, 'blue'],
              ['error', `Errors (${postingCounts.error})`, 'red']
            ].map(([value, label, tone]) => (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={(loadFilters.posting || '') === value}
                onClick={() => { setLoadFilters(prev => ({ ...prev, posting: value })); setSelectedIds([]); }}
                className="tms-slim-btn"
                data-tone={tone}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={`tms-filter-panel${showFilters ? '' : ' hidden'}`}>
            <div className="tms-filter-line">
              <span className="tms-filter-label">Rate</span>
              {[
                ['', `All (${rateCountOrders.length})`],
                ['with', `With rate (${withRateCount})`],
                ['without', `No rate (${noRateCount})`]
              ].map(([value, label]) => (
                <button
                  key={value || 'all'}
                  type="button"
                  data-tone={value === 'with' ? 'emerald' : value === 'without' ? 'amber' : 'blue'}
                  aria-pressed={loadFilters.rate === value}
                  onClick={() => { setLoadFilters(prev => ({ ...prev, rate: value })); setSelectedIds([]); }}
                  className="tms-slim-btn tms-toggle"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="tms-filter-line">
              <span className="tms-filter-label">States</span>
              <select
                aria-label="Filter by pickup state"
                value={loadFilters.pickupState}
                onChange={e => { setLoadFilters(prev => ({ ...prev, pickupState: e.target.value })); setSelectedIds([]); }}
                className="tms-slim-input flex-1 min-w-[6rem]"
              >
                <option value="">Pickup: any</option>
                {sortedStateCodes.map(state => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
              <span className="tms-filter-arrow" aria-hidden="true">→</span>
              <select
                aria-label="Filter by delivery state"
                value={loadFilters.deliveryState}
                onChange={e => { setLoadFilters(prev => ({ ...prev, deliveryState: e.target.value })); setSelectedIds([]); }}
                className="tms-slim-input flex-1 min-w-[6rem]"
              >
                <option value="">Delivery: any</option>
                {sortedStateCodes.map(state => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </div>
            <div className="tms-filter-line">
              <span className="tms-filter-label">Miles</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="Min"
                aria-label="Minimum miles"
                value={loadFilters.minMiles}
                onChange={e => { setLoadFilters(prev => ({ ...prev, minMiles: e.target.value.replace(/[^\d]/g, '') })); setSelectedIds([]); }}
                className="tms-slim-input w-24"
              />
              <span className="tms-filter-arrow" aria-hidden="true">–</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="Max"
                aria-label="Maximum miles"
                value={loadFilters.maxMiles}
                onChange={e => { setLoadFilters(prev => ({ ...prev, maxMiles: e.target.value.replace(/[^\d]/g, '') })); setSelectedIds([]); }}
                className="tms-slim-input w-24"
              />
            </div>
            <div className="tms-filter-line">
              <span className="tms-filter-label">Sort</span>
              <select
                aria-label="Sort loads by city and state"
                value={laneSort === 'pickup-asc' ? '' : laneSort}
                onChange={e => setLaneSort(e.target.value)}
                className="tms-slim-input flex-1"
              >
                {LANE_SORT_CHOICES.map(([value, label]) => <option key={value || 'default'} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="tms-filter-line tms-filter-actions">
              <button
                type="button"
                onClick={handleClearAllFilters}
                disabled={!searchQuery.trim() && !loadFilters.rate && !loadFilters.minMiles && !loadFilters.maxMiles && !loadFilters.pickupState && !loadFilters.deliveryState && !loadFilters.pickupDate && !loadFilters.posting && !laneSort}
                title="Clear the search box and all lane filters and sorting"
                className="tms-slim-btn"
                data-tone="amber"
              >
                Clear All Filters
              </button>
            </div>
          </div>

          {activeFilterTags.length > 0 && (
            <div className="tms-tag-row">
              {activeFilterTags.map(tag => (
                <button key={tag.key} type="button" onClick={() => { tag.clear(); setSelectedIds([]); }} aria-label={`Remove filter ${tag.label}`} className="tms-filter-tag">
                  {tag.label}<span aria-hidden="true">✕</span>
                </button>
              ))}
            </div>
          )}

          <div className="tms-select-row">
            <label className="tms-select-all">
              <input
                type="checkbox"
                onChange={() => handleSelectAll(filteredOrders)}
                checked={filter === 'OFFER'
                  ? visibleOrderEntries.length > 0 && visibleOrderEntries.every(({ customer, order }) => selectedIds.includes(selectionKey(customer, order.id)))
                  : filteredOrders.length > 0 && filteredOrders.every(o => selectedIds.includes(o.id))}
                className="w-6 h-6 cursor-pointer accent-blue-600"
              />
              <span>{filter === 'OFFER' ? 'Select All (all customers)' : isAllCustomersView ? 'Select All (current customer)' : 'Select All'}</span>
            </label>
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={() => copyToClipboard(
                visibleOrderEntries.filter(({ customer, order }) => (filter === 'OFFER' || customer === selectedBroker) && selectedIds.includes(selectionKey(customer, order.id)))
                  .map(({ order }) => `${order.id} ${order.route || ''}`.trim()).join('\n'),
                'Selected loads'
              )}
              title="Copy load number and pickup/delivery city/state for every checked load"
              className="tms-slim-btn"
              data-tone="blue"
            >
              Copy Selected ({visibleOrderEntries.filter(({ customer, order }) => (filter === 'OFFER' || customer === selectedBroker) && selectedIds.includes(selectionKey(customer, order.id))).length})
            </button>
          </div>
          {selectedIds.length > 0 && (
            <div className="tms-select-row">
              <span className="tms-filter-label">Move to</span>
              {['OPEN', 'ON HOLD', 'OFFER', 'ENT'].map(status => (
                <button
                  key={status}
                  onClick={() => handleMoveSelected(status)}
                  title={`Move ${selectedIds.length} selected load${selectedIds.length === 1 ? '' : 's'} to ${status}`}
                  data-status={status.replace(' ', '-')}
                  className="tms-slim-btn tms-move-btn"
                >
                  {status}
                </button>
              ))}
              <button
                onClick={handleDeleteSelected}
                className="tms-slim-btn tms-danger"
                data-tone="red"
              >
                Delete Selected ({selectedIds.length})
              </button>
            </div>
          )}
        </div>

        <div className="tms-list-bar">
          <span className="tms-list-bar-title" title={selectedBroker}>{selectedBroker}</span>
          <button
            type="button"
            onClick={() => setListView(view => (view === 'table' ? 'cards' : 'table'))}
            aria-pressed={listView === 'table'}
            title={listView === 'table' ? 'Show the loads as cards' : 'Show the loads as a table: one row per load, sort by any column'}
            className="tms-list-bar-button"
          >
            {listView === 'table' ? '▤ Cards' : '▦ Table'}
          </button>
          {selectedBroker && (
            <button
              type="button"
              onClick={() => setShowRules(true)}
              title={`Rules for ${selectedBroker}: equipment, rates, lane rates, Excel columns`}
              className={`tms-list-bar-button${hasCustomerRules(getCustomerRules(profile.customerRules, selectedBroker)) ? ' !text-emerald-300' : ''}`}
            >
              ⚙ Rules
            </button>
          )}
          <ListFocusToggle />
        </div>
        <div className="tms-load-list flex-1 overflow-y-auto p-2 space-y-2">
          {visibleOrderEntries.length === 0 ? (
            <div className="text-center text-gray-500 text-xs py-10">{isAllCustomersView ? 'No matching loads across all customers with the current filters.' : `No loads found for ${selectedBroker}. Click "📂 Import Excel" above!`}</div>
          ) : listView === 'table' ? (
            <LoadTable
              rows={visibleOrderEntries.map(({ customer, order }) => buildLoadTableRow(customer, order, {
                checked: (filter === 'OFFER' || customer === selectedBroker) && selectedIds.includes(selectionKey(customer, order.id)),
                checkDisabled: filter !== 'OFFER' && customer !== selectedBroker,
                isHotLane: Boolean(getHotLane(order, hotLanes))
              }))}
              selectedKey={selectedOrder ? JSON.stringify([selectedBroker, selectedOrder.id]) : ''}
              showCustomer={isAllCustomersView}
              allChecked={filteredOrders.length > 0 && filteredOrders.every(order => selectedIds.includes(selectionKey(selectedBroker, order.id)))}
              onToggleAll={() => handleSelectAll(filteredOrders)}
              onToggle={(row, event) => handleToggleSelect(row.order.id, event, row.customer)}
              onOpen={row => handleSelectSearchResult(row.customer, row.order)}
            />
          ) : (
            shownOrderEntries.map(({ customer, order: ord }) => (
              <div
                key={JSON.stringify([customer, ord.id])}
                id={`load-card-${ord.id}`}
                onClick={() => handleSelectSearchResult(customer, ord)}
                onDoubleClick={(e) => { if (filter === 'OFFER' || customer === selectedBroker) handleToggleSelect(ord.id, e, customer); }}
                title="Double-click to select or unselect"
                className={`tms-load-card p-3 rounded-lg cursor-pointer select-none border transition-all flex items-start space-x-2.5 ${
                  customer === selectedBroker && exportErrorIds.includes(String(ord.id))
                    ? 'bg-red-950/50 border-red-500 shadow-md'
                    : customer === selectedBroker && selectedOrder?.id === ord.id
                      ? `bg-[#2b3d73] border-yellow-300 border-2 ${isHazmatLoad(ord) ? 'border-l-8 border-l-orange-400' : ''} ring-4 ring-yellow-300/70 shadow-lg shadow-yellow-400/30`
                      : isHazmatLoad(ord)
                        ? 'bg-orange-950/40 border-orange-500/70 border-l-4 hover:bg-orange-900/40'
                        : 'bg-[#161f36]/60 border-transparent hover:bg-[#1c2541]/50'
                }${{
                  // Urgency color (getLoadUrgency): the left edge, over the hazmat orange edge.
                  past: ' border-l-4 !border-l-red-500',
                  today: ' border-l-4 !border-l-amber-400',
                  unsent: customer === selectedBroker && selectedOrder?.id === ord.id ? '' : ' border-dashed !border-slate-500/60'
                }[getLoadUrgency(ord)] || ''}`}
              >
                <input
                  type="checkbox"
                  checked={(filter === 'OFFER' || customer === selectedBroker) && selectedIds.includes(selectionKey(customer, ord.id))}
                  disabled={filter !== 'OFFER' && customer !== selectedBroker}
                  title={filter !== 'OFFER' && customer !== selectedBroker ? 'Open this load to select its customer first' : 'Select load'}
                  onChange={(e) => handleToggleSelect(ord.id, e, customer)}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="mt-1 cursor-pointer accent-blue-600"
                />
                <div className="flex-1 min-w-0">
                  {isAllCustomersView && <div className="text-[10px] text-teal-200 mb-1">{customer}</div>}
                  {(() => {
                    const facts = getLoadCardFacts(ord);
                    const raise = ord.rateRaise || getTeamRateRaise(ord.id);
                    const hotLane = getHotLane(ord, hotLanes);
                    const pay = getTruckPay(customer, ord);
                    const statusClass = status => (status === 'ENT' ? 'tms-ent' : status === 'ON HOLD' || status === 'HOLD' ? 'bg-red-900/60 text-red-300' : status === 'OPEN' ? 'tms-open' : status === 'BOOKED' ? 'bg-purple-900/60 text-purple-200' : 'bg-blue-900/60 text-blue-300');
                    const badge = 'text-[9px] px-1 py-px rounded font-extrabold whitespace-nowrap';
                    return (
                      <>
                        {/* Line 1: the lane, big, and the rate, big (Daniel 2026-11-27: clearer cards). */}
                        <div className="tms-card-top flex items-center gap-1.5 min-w-0">
                          <div className="flex-1 min-w-0 text-[13px] font-bold text-white truncate" title={getLoadCardRoute(ord)}>{getLoadCardRoute(ord) || <span className="text-gray-500 font-normal">No cities yet</span>}</div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); copyToClipboard(`${ord.id} ${getLoadCardRoute(ord)}`.trim(), 'Load number and route'); }}
                            title="Copy load number and pickup/delivery city/state"
                            aria-label={`Copy route for load ${ord.id}`}
                            className="shrink-0 bg-slate-700 hover:bg-slate-600 text-white px-1 py-px rounded text-[10px] cursor-pointer"
                          >📋</button>
                          <div aria-label={`Rate for load ${ord.id}`} className={`tms-card-rate shrink-0 text-[13px] font-extrabold ${facts.rateText ? 'text-emerald-300' : 'text-amber-300 text-[11px] font-semibold'}`}>
                            {facts.rateText || 'no rate'}
                          </div>
                        </div>
                        {/* Line 2: dates, miles, $/mile, and the status. */}
                        <div className="tms-card-sub flex items-center gap-1.5 min-w-0 text-[11px] text-gray-400">
                          <span className="tms-card-dates flex-1 min-w-0 truncate">
                            {[getLoadCardDates(ord), facts.milesText, facts.perMileText].filter(Boolean).join(' · ')}
                          </span>
                          {getLoadUrgency(ord) === 'past' && (
                            <span title="The pickup day has passed and the load is not booked" className="shrink-0 bg-red-600 text-white text-[9px] px-1 py-px rounded font-extrabold whitespace-nowrap">PU PASSED</span>
                          )}
                          {getLoadUrgency(ord) === 'today' && (
                            <span title="Picks up today and is not booked yet" className="shrink-0 bg-amber-400 text-black text-[9px] px-1 py-px rounded font-extrabold whitespace-nowrap">PU TODAY</span>
                          )}
                          <span className={`shrink-0 text-[10px] px-1.5 py-px rounded font-semibold ${statusClass(ord.status)}`}>{ord.status}</span>
                          {ord.tag && ord.tag !== ord.status && (
                            <span className={`shrink-0 text-[10px] px-1.5 py-px rounded font-bold ${ord.tag === 'HOLD' ? 'bg-red-600 text-white' : statusClass(ord.tag)}`}>{ord.tag}</span>
                          )}
                        </div>
                        {/* Line 3: the order number and small badges. */}
                        <div className="tms-card-badges flex items-center gap-1 flex-wrap mt-0.5 min-w-0">
                          <span className="font-mono text-[10px] text-blue-300" title="Order number">#{ord.id}</span>
                          <span className="bg-blue-900/60 text-blue-300 text-[9px] px-1 py-px rounded font-mono" title={getEquipmentDescription(ord.eCode)}>{getDisplayEquipmentCode(ord.eCode)}</span>
                          {(getPostingState(ord) === 'error' || (customer === selectedBroker && exportErrorIds.includes(String(ord.id)))) && (
                            <span title={getPostingErrorText(ord) || 'This load could not be exported. Open it to see what to fix.'} className="tms-post-badge" data-state="error">
                              ⚠ {hasOpenLandstarError(ord) ? 'LANDSTAR ERROR' : ord.exportError ? 'EXPORT ERROR' : 'NOT CONFIRMED'}
                            </span>
                          )}
                          {getRemovalBadge(ord) && (
                            <span title={getRemovalBadge(ord).title} className={`${getRemovalBadge(ord).className} ${badge}`}>{getRemovalBadge(ord).text}</span>
                          )}
                          {isHazmatLoad(ord) && (
                            <span aria-label={`Hazmat load ${ord.id}`} title="Hazmat load" className={`bg-orange-500 text-black ${badge}`}>☢ HAZ</span>
                          )}
                          {isTankerLoad(ord) && (
                            <span aria-label={`Tanker endorsement load ${ord.id}`} title="Tanker (N) Endorsement required" className={`bg-yellow-400 text-black ${badge}`}>🛢 TANKER</span>
                          )}
                          {String(ord.needsCapacity || '').trim() && (
                            <span aria-label={`Load ${ord.id} needs capacity`} title="Important: protected from missing-list removal; refresh requested every 15 minutes" className={`bg-amber-400 text-black ${badge}`}>⭐ IMPORTANT</span>
                          )}
                          {hotLane && (
                            <span aria-label={`Load ${ord.id} is on a hot lane`} title={describeHotLane(hotLane)} className={`bg-red-600 text-white ${badge}`}>🔥 HOT ×{hotLane.count}{hotLaneRate(hotLane) ? ` · ${hotLaneRate(hotLane)}` : ''}</span>
                          )}
                          {raise && (
                            <span
                              title={`${ord.rateRaise ? 'The bot' : "The team's bot"} raised this load on Landstar from ${formatRaiseMoney(raise.from)} to ${formatRaiseMoney(raise.to)}${raise.competitor ? ` because ${raise.competitor} was paying ${formatRaiseMoney(raise.competitorRate)}` : ''}`}
                              className={`bg-amber-400 text-black ${badge}`}
                            >⬆ RAISED {formatRaiseMoney(raise.to)}</span>
                          )}
                          {getPostingState(ord) === 'posted' && (
                            <span title={`Posted on Landstar ${new Date(ord.landstarExportedAt).toLocaleString()}`} className="tms-post-badge" data-state="posted">✓ Posted{facts.exported ? ` ${facts.exported}` : ''}</span>
                          )}
                          {getPostingState(ord) === 'sent' && (
                            <span title="Exported: the bot is uploading it. It turns ✓ Posted when Landstar confirms." className="tms-post-badge" data-state="sent">⏳ Sent to bot</span>
                          )}
                          {getPostingState(ord) === 'unposted' && ord.status === 'OPEN' && (
                            <span title="Not on Landstar yet: Export sends it" className="tms-post-badge" data-state="unposted">Not posted</span>
                          )}
                          {pay && (
                            <span aria-label={`Truck pay for load ${ord.id}`} title="Landstar driver (BCO) gets the full posted rate; an approved carrier gets 78%–85% of it" className="tms-card-pay text-[9px] text-sky-300 font-semibold whitespace-nowrap">
                              BCO {formatDollars(pay.posted)} · Carrier {formatDollars(pay.carrierLow)}–{formatDollars(pay.carrierHigh)}
                            </span>
                          )}
                        </div>
                      </>
                    );
                  })()}
                  {ord.planningComment && <div className="tms-card-comment mt-1 text-[11px] text-amber-300 font-semibold truncate">{ord.planningComment}</div>}
                </div>
              </div>
            ))
          )}
          {hiddenLoadCount > 0 && (
            <div ref={listEndRef} className="text-center py-3">
              <button
                type="button"
                onClick={() => setListLimit(limit => limit + LOAD_LIST_PAGE)}
                className="text-xs text-blue-300 hover:text-blue-200 underline cursor-pointer"
              >
                Showing {shownOrderEntries.length} of {visibleOrderEntries.length} loads · show more
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="tms-workspace flex-1 flex flex-col overflow-y-auto p-3 md:p-6">
        <div className="tms-brand">
          <div className="tms-brand-logos">
              <div className="tms-landstar-mark" role="img" aria-label="Landstar">
                <span className="tms-landstar-word">Landstar</span>
                <svg className="tms-landstar-star" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 1.8l3.05 6.55 7.15.86-5.27 4.93 1.38 7.1L12 17.75l-6.31 3.49 1.38-7.1L1.8 9.21l7.15-.86z" />
                </svg>
              </div>
              <img className="tms-eagles-logo" src={teamLogoSrc(profile.teamLogo)} alt={teamLogoName(profile.teamLogo)} width="474" height="475" onError={(e) => { if (!e.currentTarget.src.endsWith('/eagles-sidebar.png')) e.currentTarget.src = '/eagles-sidebar.png'; }} />
          </div>
          <div className="tms-brand-name">
          <span className="tms-brand-title">Broski Transportation &amp; Logistics</span>
          {profile.phone ? (
            <a className="tms-brand-phone" href={`tel:+1${profile.phone}`}>
              {countryFlags[profile.flag] && (
                <span
                  className="tms-colombia-flag"
                  role="img"
                  aria-label={`${countryFlags[profile.flag].name} flag`}
                  style={{ background: countryFlags[profile.flag].background }}
                />
              )}
              <span>{formatPhone(profile.phone)}</span>
            </a>
          ) : (
            <span className="text-xs text-amber-400">Add your phone in ⚙ My Settings</span>
          )}
          </div>
          <span className="tms-brand-actions inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowInquiries(open => !open)}
              title="Driver inquiries from your load links"
              className={`text-white text-xs px-2.5 py-1 rounded font-medium cursor-pointer normal-case tracking-normal ${unseenInquiryCount ? 'bg-purple-600 hover:bg-purple-500' : 'bg-slate-700 hover:bg-slate-600'}`}
            >
              📨 Inquiries{unseenInquiryCount ? ` (${unseenInquiryCount} new)` : ''}
            </button>
            <button
              type="button"
              onClick={handleExportToLandstar}
              className="tms-export-button"
              title="Export the selected (or shown) loads to a Landstar bulk file and move them to ENT; the bot uploads it"
            >
              🚀 Export to Landstar
            </button>
            {datAvailable && (
              <button
                type="button"
                onClick={handlePostToDat}
                disabled={datBusy}
                title="Post the selected (or shown) loads to the DAT load board. The TMS server reposts them every 5 minutes and takes them down when booked, covered or past pickup."
                className="bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white text-xs px-2.5 py-1 rounded font-medium cursor-pointer normal-case tracking-normal"
              >
                📡 {datBusy ? 'Posting…' : 'Post to DAT'}{datPostings.length ? ` (${datPostings.length} live)` : ''}
              </button>
            )}
            {pastedImage && (
              <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 normal-case tracking-normal text-left" role="dialog" aria-label="Which list is this?">
                <div className="bg-[#121829] border border-purple-500 rounded-lg shadow-2xl p-4 w-[24rem] max-w-full">
                  <h2 className="text-sm font-bold text-purple-200 mb-1">{chatItem ? '💬 New list picture from Google Chat' : '📋 Which list did you paste?'}</h2>
                  {chatItem?.from && <p className="text-xs text-purple-200 mb-1">From {chatItem.from}</p>}
                  {chatItem && chatWaitingCount > 0 && <p className="text-xs text-amber-200 mb-1">{chatWaitingCount} more waiting for you after this one. Lists with a known name keep importing meanwhile.</p>}
                  <p className="text-xs text-gray-300 mb-3">The picture is imported into the account you pick.</p>
                  <div className="flex flex-col gap-2">
                    {(chatItem ? getChatInboxChoices(chatItem, brokers) : getPasteImportChoices(brokers)).map(choice => (
                      <button
                        key={choice.label}
                        type="button"
                        onClick={() => importPastedImage(choice.customer)}
                        className={`${choice.className} text-white text-sm px-3 py-2 rounded font-semibold cursor-pointer text-left`}
                      >
                        {choice.label}
                      </button>
                    ))}
                    <button type="button" onClick={cancelPastedImage} className="text-gray-300 hover:text-white text-xs mt-1 cursor-pointer">{chatItem ? 'Skip this picture' : 'Cancel'}</button>
                  </div>
                </div>
              </div>
            )}
            {chatSheet && !pastedImage && (
              <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 normal-case tracking-normal text-left" role="dialog" aria-label="Which account is this spreadsheet for?">
                <div className="bg-[#121829] border border-emerald-500 rounded-lg shadow-2xl p-4 w-[26rem] max-w-full">
                  <h2 className="text-sm font-bold text-emerald-200 mb-1">💬 New spreadsheet from Google Chat</h2>
                  <p className="text-sm text-white font-bold mb-1">{chatSheet.item.label ? `"${chatSheet.item.label}"` : 'No list name above the file'}</p>
                  <p className="text-[11px] text-gray-400 font-mono break-all mb-1">{chatSheet.item.fileName || chatSheet.item.name}</p>
                  {chatSheet.item.from && <p className="text-xs text-emerald-200 mb-1">From {chatSheet.item.from}</p>}
                  {chatWaitingCount > 0 && <p className="text-xs text-amber-200 mb-1">{chatWaitingCount} more waiting for you after this one. Lists with a known name keep importing meanwhile.</p>}
                  {getSnbChatSheetAccount(chatSheet.item.label) && (
                    <p className="text-xs text-amber-300 mb-1">This is Ivan's list: it goes to {SNB_CHAT_ACCOUNT}, which is not in your customer list yet. Add that customer and share it with Ivan; after that these lists import there by themselves.</p>
                  )}
                  <p className="text-xs text-gray-300 mb-3">{chatSheet.item.label
                    ? `Which account does the "${chatSheet.item.label}" list go to? The TMS remembers: next time a "${chatSheet.item.label}" list comes in, it goes there by itself.`
                    : 'Which account does it go to? (With no list name above it, the TMS asks every time.)'}</p>
                  <div className="flex flex-col gap-2">
                    {getChatInboxChoices(chatSheet.item, brokers).map(choice => (
                      <button
                        key={choice.label}
                        type="button"
                        onClick={() => importChatSheet(choice.customer, { remember: true })}
                        className={`${choice.className} text-white text-sm px-3 py-2 rounded font-semibold cursor-pointer text-left`}
                      >
                        {choice.label}
                      </button>
                    ))}
                    {!getChatInboxChoices(chatSheet.item, brokers).length && (
                      <p className="text-xs text-amber-300">No matching accounts in your customer list yet. Add the account first, then it shows here.</p>
                    )}
                    <button type="button" onClick={() => importChatSheet('')} className="text-gray-300 hover:text-white text-xs mt-1 cursor-pointer">Skip this spreadsheet</button>
                  </div>
                </div>
              </div>
            )}
            {paramountReplies.some(reply => reply.driver) && (
              <div className="fixed left-1/2 -translate-x-1/2 top-2 z-50 w-[46rem] max-w-[calc(100vw-1rem)] bg-red-600 text-white rounded-lg shadow-2xl border-2 border-red-300 p-3 normal-case tracking-normal text-left" role="alert">
                <p className="font-bold text-base">💬 Driver replied - answer right away</p>
                {paramountReplies.filter(reply => reply.driver).map(reply => (
                  <div key={`banner-${reply.id}`} className="mt-2 bg-red-700/60 rounded p-2 text-sm">
                    <p className="font-semibold">{reply.loadId ? `Load #${reply.loadId}` : `Freight bill ${reply.freightBill}`} · {String(reply.from || '').replace(/<[^>]*>/, '').trim()} · {formatCheckTime(reply.at)}</p>
                    <p className="mt-0.5">“{reply.snippet}”</p>
                    <div className="flex gap-2 mt-1">
                      <a href={`https://mail.google.com/mail/u/0/#all/${reply.threadId}`} target="_blank" rel="noreferrer" className="bg-white text-red-700 px-3 py-0.5 rounded font-bold">Open in Gmail</a>
                      <button type="button" onClick={() => setParamountReplies(current => current.filter(item => item.id !== reply.id))} className="bg-red-900 hover:bg-red-950 px-3 py-0.5 rounded font-semibold cursor-pointer">Got it</button>
                    </div>
                  </div>
                ))}
                {typeof Notification !== 'undefined' && Notification.permission === 'default' && (
                  <button type="button" onClick={() => Notification.requestPermission()} className="mt-2 bg-yellow-300 text-black px-3 py-1 rounded font-bold cursor-pointer">Turn on Windows notifications for driver replies</button>
                )}
              </div>
            )}
            {vipMessages.length > 0 && (
              <div className="fixed left-1/2 -translate-x-1/2 top-14 z-50 w-[46rem] max-w-[calc(100vw-1rem)] bg-yellow-400 text-black rounded-lg shadow-2xl border-2 border-yellow-200 p-3 normal-case tracking-normal text-left" role="alert">
                <p className="font-bold text-base">⭐ VIP customer emailed you</p>
                {vipMessages.map(message => (
                  <div key={`vip-${message.id}`} className="mt-2 bg-yellow-300/80 rounded p-2 text-sm">
                    <p className="font-semibold">{message.name} · {formatCheckTime(message.at)}{message.subject ? ` · ${message.subject}` : ''}</p>
                    <p className="mt-0.5">“{message.snippet}”</p>
                    <div className="flex gap-2 mt-1">
                      <a href={`https://mail.google.com/mail/u/0/#all/${message.threadId}`} target="_blank" rel="noreferrer" className="bg-black text-yellow-300 px-3 py-0.5 rounded font-bold">Open in Gmail</a>
                      <button type="button" onClick={() => setVipMessages(current => current.filter(item => item.id !== message.id))} className="bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-0.5 rounded font-semibold cursor-pointer">Got it</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* No notices in the bottom-right corner (Daniel 2026-11-27): only problems (⚠) and Undo
                offers show, in a slim strip at the top center; plain news is not shown at all. */}
            {notices.length > 0 && (
              <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[61] w-[40rem] max-w-[calc(100vw-1rem)] space-y-1 normal-case tracking-normal text-left">
                {notices.map(notice => (
                  <div key={notice.id} role="alert" className={`rounded-md shadow-2xl border px-2.5 py-1.5 text-xs flex items-start gap-2 ${notice.level === 'undo' ? 'bg-slate-900/95 border-slate-400 text-slate-100' : notice.level === 'auto' ? 'bg-emerald-950/95 border-emerald-400 text-emerald-100' : 'bg-amber-950/95 border-amber-400 text-amber-100'}`}>
                    <p className="flex-1 whitespace-pre-wrap">{notice.level === 'undo' || notice.level === 'auto' ? '' : '⚠ '}{notice.text}</p>
                    {notice.action && (
                      <button
                        type="button"
                        onClick={() => { setNotices(current => current.filter(item => item.id !== notice.id)); notice.action.run(); }}
                        className="shrink-0 bg-white text-slate-900 hover:bg-slate-200 font-bold px-2 py-0.5 rounded cursor-pointer"
                      >
                        {notice.action.label}
                      </button>
                    )}
                    <button type="button" onClick={() => setNotices(current => current.filter(item => item.id !== notice.id))} className="text-white/70 hover:text-white font-bold px-1 cursor-pointer" aria-label="Dismiss notice">✕</button>
                  </div>
                ))}
              </div>
            )}
            {(paramountDrafts.length > 0 || paramountReplies.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  setView('booked');
                  // Already on Booked Loads (or right after the switch): jump to the first waiting email.
                  setTimeout(() => document.querySelector('[data-email-draft]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
                }}
                title={[
                  paramountDrafts.length ? 'Tracking emails (check calls, ETAs) are ready for you to send.' : '',
                  paramountReplies.length ? `New replies to your tracking emails: ${paramountReplies.map(reply => `${reply.driver ? 'driver on ' : ''}${reply.customer || ''} #${reply.loadId || ''}`.trim()).join(', ')}.` : '',
                  'Click to open them on Booked loads.'
                ].filter(Boolean).join(' ')}
                className="bg-amber-400 hover:bg-amber-300 text-black text-xs px-2.5 py-1 rounded font-bold cursor-pointer normal-case tracking-normal"
              >
                {/* Daniel 2026-11-27: "⚠ 1 reply" did not say what it was. */}
                {[
                  paramountDrafts.length ? `✉ ${paramountDrafts.length} tracking email${paramountDrafts.length === 1 ? '' : 's'} to send` : '',
                  paramountReplies.length ? `💬 ${paramountReplies.length} ${paramountReplies.every(reply => reply.driver) ? 'driver' : paramountReplies.some(reply => reply.driver) ? '' : 'customer'} repl${paramountReplies.length === 1 ? 'y' : 'ies'} to read`.replace('  ', ' ') : ''
                ].filter(Boolean).join(' · ')}
              </button>
            )}
            {showInquiries && (
              <InquiriesPanel
                inquiries={inquiries}
                onOpen={openInquiryLoad}
                onSeen={markInquirySeen}
                onClose={() => setShowInquiries(false)}
              />
            )}
            {/* Signed in, the bot light and My Settings sit next to Sign out (bottom right);
                local mode keeps them here. */}
            {!sharing && <BotStatusLight />}
            <EmailWorkerStatus store={emailWorkerStatusStore} drafts={paramountDrafts} />
            {/* Signed in or not: only the TMS on this PC has bots to check. */}
            <button
              type="button"
              onClick={() => setShowShortcuts(true)}
              title="Keyboard shortcuts (press ? anywhere)"
              aria-label="Keyboard shortcuts"
              className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2 py-1 rounded font-semibold cursor-pointer normal-case tracking-normal"
            >
              ⌨
            </button>
            {showShortcuts && (
              <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-label="Keyboard shortcuts" onClick={() => setShowShortcuts(false)}>
                <div className="w-[26rem] max-w-full bg-[#121829] border border-slate-500 rounded-lg shadow-2xl p-4 normal-case tracking-normal text-left" onClick={event => event.stopPropagation()}>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-bold text-white">⌨ Keyboard shortcuts</h2>
                    <button type="button" onClick={() => setShowShortcuts(false)} className="text-gray-300 hover:text-white text-sm px-2 cursor-pointer" aria-label="Close shortcuts">✕</button>
                  </div>
                  <table className="w-full text-xs text-gray-200">
                    <tbody>
                      {[
                        ['↓ or J', 'Next load'],
                        ['↑ or K', 'Previous load'],
                        ['X', 'Check / uncheck the open load (for export)'],
                        ['C', 'Copy the load number and route'],
                        ['/', 'Search loads'],
                        ['Shift + E', 'Export to Landstar (checked loads, or the list shown)'],
                        ['Shift + B', 'Book the open load'],
                        ['?', 'Show or hide this card'],
                        ['Esc', 'Close this card']
                      ].map(([keys, action]) => (
                        <tr key={keys} className="border-b border-slate-800">
                          <td className="py-1 pr-3 whitespace-nowrap"><kbd className="bg-slate-700 border border-slate-500 rounded px-1.5 py-0.5 font-mono text-[11px] text-white">{keys}</kbd></td>
                          <td className="py-1">{action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[11px] text-gray-400 mt-2">Shortcuts don't work while you type in a box or while another window is open. Export and Book need Shift so a stray key never sends anything.</p>
                </div>
              </div>
            )}
            <TodayPanel
              today={today}
              ordersMap={customerOrdersMap}
              isHotLane={load => Boolean(getHotLane(load, hotLanes))}
              onOpenAccount={name => { handleSelectBroker(name); setView('loads'); }}
            />
            {canStartBotHere() && <SystemCheck emailStore={emailWorkerStatusStore} />}
            {!sharing && (
            <button
              type="button"
              onClick={openProfileSettings}
              className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2.5 py-1 rounded font-medium cursor-pointer"
            >
              ⚙ My Settings
            </button>
            )}
          </span>
        </div>
        {profileDraft && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" role="dialog" aria-label="My Settings">
            <form onSubmit={handleSaveProfile} className="w-96 max-w-full bg-[#121829] border border-[#1c2541] rounded-lg p-5 space-y-3">
              <h2 className="text-sm font-bold text-gray-100">⚙ My Settings</h2>
              <p className="text-[11px] text-gray-400">Used on your exports. Each teammate has their own.</p>
              {[
                ['phone', 'Call back phone (10 digits)', '484-555-1234'],
                ['postingCode', 'Posting code', 'ANQ'],
                ['visibilityGroup', 'Visibility group', 'ANQ']
              ].map(([field, label, example]) => (
                <label key={field} className="block text-xs text-gray-400">
                  {label}
                  <input
                    type="text"
                    value={profileDraft[field]}
                    onChange={(e) => setProfileDraft(current => ({ ...current, [field]: e.target.value }))}
                    placeholder={example}
                    className="mt-1 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono"
                  />
                </label>
              ))}
              {/* Changes right away and is saved on this computer (not part of Save). */}
              <div className="block text-xs text-gray-400">
                Background brightness
                <div className="mt-1 flex items-center gap-2">
                  <span aria-hidden="true">🌑 Darker</span>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="5"
                    defaultValue={readBackgroundBrightness()}
                    onChange={(e) => applyBackgroundBrightness(e.target.value, true)}
                    aria-label="Background brightness"
                    className="flex-1 accent-cyan-400"
                  />
                  <span aria-hidden="true">Brighter ☀</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      const slider = e.currentTarget.parentElement.querySelector('input[type="range"]');
                      if (slider) slider.value = '0';
                      applyBackgroundBrightness(0, true);
                    }}
                    className="px-2 py-0.5 rounded border border-[#1c2541] text-gray-300 hover:text-white"
                    title="Back to the original background"
                  >
                    Reset
                  </button>
                </div>
              </div>
              {/* Top-bar team logo: Eagles artwork, any NFL team, or an uploaded picture of any team. */}
              <div className="block text-xs text-gray-400">
                Team logo (top bar)
                <div className="mt-1 flex items-center gap-2">
                  <select
                    value={isUploadedLogo(profileDraft.teamLogo) ? 'upload' : normalizeTeamLogo(profileDraft.teamLogo)}
                    onChange={(e) => {
                      if (e.target.value !== 'upload') setProfileDraft(current => ({ ...current, teamLogo: e.target.value }));
                    }}
                    aria-label="Team logo"
                    className="flex-1 min-w-0 bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white"
                  >
                    <option value="">Eagles artwork (original)</option>
                    {nflTeams.map(team => <option key={team.code} value={team.code}>{team.name}</option>)}
                    {isUploadedLogo(profileDraft.teamLogo) && <option value="upload">My uploaded logo</option>}
                  </select>
                  <img src={teamLogoSrc(profileDraft.teamLogo)} alt="" className="w-9 h-9 object-contain rounded" />
                </div>
                <label className="mt-1 inline-block cursor-pointer text-cyan-300 hover:text-cyan-200" title="Any team: college, soccer, high school. Pick a PNG or JPG picture of the logo.">
                  ⬆ Upload another team's logo
                  <input
                    type="file"
                    accept="image/png, image/jpeg, image/webp, image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      const url = URL.createObjectURL(file);
                      const picture = new Image();
                      picture.onload = () => {
                        // Shrink to 160px so the logo stays small enough to sync with My Settings.
                        const scale = Math.min(1, 160 / Math.max(picture.width, picture.height));
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.max(1, Math.round(picture.width * scale));
                        canvas.height = Math.max(1, Math.round(picture.height * scale));
                        canvas.getContext('2d').drawImage(picture, 0, 0, canvas.width, canvas.height);
                        URL.revokeObjectURL(url);
                        const logo = canvas.toDataURL('image/png');
                        if (!isUploadedLogo(logo)) { notify('That picture could not be used as a logo. Try a smaller PNG or JPG.'); return; }
                        setProfileDraft(current => ({ ...current, teamLogo: logo }));
                      };
                      picture.onerror = () => { URL.revokeObjectURL(url); notify('That file is not a picture the TMS can read. Try a PNG or JPG.'); };
                      picture.src = url;
                    }}
                  />
                </label>
              </div>
              <label className="block text-xs text-gray-400">
                Flag next to your phone
                <div className="mt-1 flex items-center gap-2">
                  <select
                    value={profileDraft.flag}
                    onChange={(e) => setProfileDraft(current => ({ ...current, flag: e.target.value }))}
                    className="flex-1 bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white"
                  >
                    {Object.entries(countryFlags)
                      .sort(([, a], [, b]) => a.name.localeCompare(b.name))
                      .map(([code, flag]) => <option key={code} value={code}>{flag.name}</option>)}
                    <option value="NONE">No flag</option>
                  </select>
                  {countryFlags[profileDraft.flag] && (
                    <span className="tms-colombia-flag" aria-hidden="true" style={{ background: countryFlags[profileDraft.flag].background }} />
                  )}
                </div>
              </label>
              <fieldset className="border border-[#1c2541] rounded p-3">
                <legend className="text-xs text-gray-300 px-1">⛽ Fuel surcharge ($/mile, by pickup region)</legend>
                <p className="text-[11px] text-gray-400 mb-2">Exported as a Per Mile surcharge on each load. Updated automatically from the weekly fuel email (East / Midwest / West / New England). Blank regions use the Midwest rate; blank Midwest exports no surcharge.</p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(fuelSurchargeRegions).map(([key, region]) => (
                    <label key={key} className="block text-xs text-gray-400">
                      {region.label}
                      <input
                        type="text"
                        inputMode="decimal"
                        value={profileDraft.fuelSurcharge?.[key] ?? ''}
                        onChange={(e) => setProfileDraft(current => ({
                          ...current,
                          fuelSurcharge: { ...current.fuelSurcharge, [key]: e.target.value }
                        }))}
                        placeholder="0.00"
                        className="mt-1 w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono"
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
              {/* Only the TMS owner (Daniel) sees Add teammate; the server refuses anyone else too. */}
              {sharing && isTmsOwner(userId) && <TeamInvite sharing={sharing} />}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setProfileDraft(null)} className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-1.5 text-xs rounded">Cancel</button>
                <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-xs rounded font-bold">Save</button>
              </div>
            </form>
          </div>
        )}
        {shareCustomerName && (() => {
          const shareInfo = sharedCustomers[shareCustomerName];
          const memberIds = shareInfo?.memberIds || [];
          const choices = teammates.filter(person => person.id !== shareInfo?.ownerId && !memberIds.includes(person.id));
          const closeShareDialog = () => {
            setShareCustomerName(null);
            setShareMessage('');
          };
          const renderChoices = (buttonLabel, onSubmit) => (
            <>
              {choices.length ? choices.map(person => (
                <label key={person.id} className="flex items-center gap-2 text-xs text-gray-200">
                  <input type="checkbox" checked={shareSelection.includes(person.id)} onChange={() => toggleShareSelection(person.id)} />
                  {person.email}
                </label>
              )) : <p className="text-[11px] text-gray-500">No other teammates to add.</p>}
              <button
                type="button"
                disabled={shareBusy || !shareSelection.length}
                onClick={onSubmit}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 text-xs rounded font-bold"
              >
                {buttonLabel}
              </button>
            </>
          );
          return (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" role="dialog" aria-label="Share customer">
              <div className="w-96 max-w-full max-h-[80vh] overflow-y-auto bg-[#121829] border border-[#1c2541] rounded-lg p-5 space-y-3">
                <h2 className="text-sm font-bold text-gray-100">🤝 Share “{shareCustomerName}”</h2>
                {!shareInfo && (
                  <>
                    <p className="text-[11px] text-gray-400">
                      Teammates you pick will see and edit this customer’s loads and lane rates live, together with you.
                      Everyone keeps their own phone, posting code and visibility group.
                    </p>
                    {renderChoices('Share', () => runShareAction(
                      () => sharing.shareCustomer(shareCustomerName, shareSelection),
                      'Shared. Your teammates will see this customer the next time their page updates.'
                    ))}
                  </>
                )}
                {shareInfo && (
                  <>
                    <p className="text-[11px] text-gray-400">
                      {shareInfo.isOwner ? 'You shared this customer.' : `Shared with you by ${teammateEmail(shareInfo.ownerId)}.`}
                    </p>
                    <div className="space-y-1">
                      <span className="text-[11px] font-bold text-gray-300">Shared with:</span>
                      {memberIds.length ? memberIds.map(memberId => (
                        <div key={memberId} className="flex items-center justify-between text-xs text-gray-200">
                          <span>{teammateEmail(memberId)}</span>
                          {shareInfo.isOwner && (
                            <button
                              type="button"
                              disabled={shareBusy}
                              onClick={() => runShareAction(() => sharing.removeSharedMember(shareCustomerName, memberId), 'Teammate removed.')}
                              className="bg-slate-700 hover:bg-red-600 text-white px-1.5 py-0.5 rounded text-[10px]"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      )) : <p className="text-[11px] text-gray-500">Nobody yet.</p>}
                    </div>
                    {shareInfo.isOwner ? (
                      <>
                        <span className="block text-[11px] font-bold text-gray-300">Add teammates:</span>
                        {renderChoices('Add', () => runShareAction(
                          () => sharing.addSharedMembers(shareCustomerName, shareSelection),
                          'Teammates added.'
                        ))}
                        <button
                          type="button"
                          disabled={shareBusy}
                          onClick={async () => {
                            if (!window.confirm(`Stop sharing "${shareCustomerName}"? Teammates lose access. You keep all its loads and lane rates.`)) return;
                            if (await runShareAction(() => sharing.stopSharingCustomer(shareCustomerName), '')) closeShareDialog();
                          }}
                          className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-3 py-1.5 text-xs rounded font-bold"
                        >
                          Stop sharing
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={shareBusy}
                        onClick={async () => {
                          if (!window.confirm(`Leave "${shareCustomerName}"? It will be removed from your list. The other teammates keep it.`)) return;
                          if (await runShareAction(() => sharing.leaveSharedCustomer(shareCustomerName), '')) closeShareDialog();
                        }}
                        className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-3 py-1.5 text-xs rounded font-bold"
                      >
                        Leave this customer
                      </button>
                    )}
                  </>
                )}
                {shareMessage && <p role="status" className="text-[11px] text-amber-300">{shareMessage}</p>}
                <button type="button" onClick={closeShareDialog} className="w-full bg-gray-600 hover:bg-gray-500 text-white px-3 py-1.5 text-xs rounded">
                  Close
                </button>
              </div>
            </div>
          );
        })()}
        {/* Billing in one place (Daniel 2026-11-27: "integrate the booked button and the bookings
            report"): BOOKED opens these two tabs. */}
        {(view === 'booked' || view === 'report') && (
          <div className="tms-billing-tabs" role="tablist" aria-label="Billing">
            <span className="tms-filter-label">Billing</span>
            <button type="button" role="tab" aria-selected={view === 'booked'} aria-pressed={view === 'booked'} onClick={() => setView('booked')} className="tms-slim-btn" data-tone="violet">
              Booked loads ({allBookedCount})
            </button>
            <button type="button" role="tab" aria-selected={view === 'report'} aria-pressed={view === 'report'} onClick={() => setView('report')} className="tms-slim-btn" data-tone="sky">
              Bookings report
            </button>
          </div>
        )}
        {view === 'report' ? (
          <BookingsReportPage onBack={() => setView('loads')} fuelRates={profile.fuelSurcharge} />
        ) : view === 'booked' ? (
          <BookedLoadsPage
            entries={getBookedLoads(customerOrdersMap)}
            now={clock}
            onBack={() => setView('loads')}
            onOpen={openBookedLoad}
            onUpdate={updateCustomerLoad}
            searchQuery={searchQuery}
            onSearch={handleGlobalSearch}
            emails={{
              drafts: paramountDrafts,
              replies: paramountReplies,
              onChangeText: (draft, text) => setParamountDrafts(current => current.map(item => (item.id === draft.id ? { ...item, text } : item))),
              onCompose: composeCustomerUpdate,
              onChangeManual: (draft, change) => setParamountDrafts(current => current.map(item => {
                if (item.id !== draft.id) return item;
                const next = { ...item, ...change, error: '' };
                const load = findParamountLoad(item.customer, item.loadId) || { id: item.loadId };
                return { ...next, text: buildManualUpdateEmail(next.updateKind, load, { time: next.updateTime, phone: paramountLatest.phone }) };
              })),
              onSend: draft => { void sendParamountDraft(draft); },
              onSkip: skipParamountDraft,
              onDismissReply: reply => setParamountReplies(current => current.filter(item => item.id !== reply.id))
            }}
            onRemoveCapacity={(customer, id) => {
              const load = (customerOrdersMap[customer] || []).find(o => String(o.id) === String(id));
              if (load && confirmRemoveCapacity(load)) {
                dropBookingLogEntry(customer, id);
                updateCustomerLoad(customer, id, removeCapacity(load));
              }
            }}
          />
        ) : selectedOrder ? (
          <div>
            <div className="tms-action-bar flex items-center justify-between bg-[#161f36] px-4 py-3 rounded-lg mb-6 border border-[#1c2541]">
              <div className="flex items-center space-x-3">
                <span className="text-xs font-bold text-gray-400">MOVE TO:</span>
                <button onClick={() => handleStatusChange('OPEN')} className="tms-open px-3 py-1 text-xs font-bold rounded cursor-pointer">OPEN</button>
                <button onClick={() => handleStatusChange('ON HOLD')} className="bg-red-600 hover:bg-red-500 px-3 py-1 text-xs font-bold rounded text-white cursor-pointer">ON HOLD</button>
                <button onClick={() => handleStatusChange('OFFER')} className="bg-blue-600 hover:bg-blue-500 px-3 py-1 text-xs font-bold rounded text-white cursor-pointer">OFFER</button>
                <button onClick={() => handleStatusChange('ENT')} className="tms-ent px-3 py-1 text-xs font-bold rounded cursor-pointer">ENT</button>
              </div>
            </div>

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <h2 className="text-xl font-bold tracking-wide">{String(selectedOrder.id).startsWith('MANUAL-') ? 'NEW LOAD · ORDER # OPTIONAL' : `ORDER #${selectedOrder.id}`}</h2>
                <button
                  onClick={() => copyToClipboard(formatOrderCopy(selectedOrder), 'Order #')}
                  title={String(selectedOrder.emptyLocation || '').trim() ? 'Copy the order # and previous empty location' : 'Copy the order #'}
                  className="tms-head-btn bg-slate-700 hover:bg-slate-600 text-white cursor-pointer"
                >
                  <span>Copy Order #</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                {String(selectedOrder.needsCapacity || '').trim() && (
                  <span className="bg-amber-400 text-black text-xs px-2 py-1 rounded font-bold" title="Protected from missing-list removal; local posting refresh requested every 15 minutes">IMPORTANT / NEEDS CAPACITY</span>
                )}
                {getRemovalBadge(selectedOrder) && (
                  <span title={getRemovalBadge(selectedOrder).title} className={`${getRemovalBadge(selectedOrder).className} text-xs px-2.5 py-1 rounded font-extrabold`}>{getRemovalBadge(selectedOrder).text}</span>
                )}
                <span className={`text-xs px-2.5 py-1 rounded font-semibold ${selectedOrder.tag === 'ENT' ? 'tms-ent' : selectedOrder.tag === 'HOLD' ? 'bg-red-600 text-white' : selectedOrder.tag === 'OPEN' ? 'tms-open' : selectedOrder.tag === 'BOOKED' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white'}`}>{selectedOrder.tag}</span>
                <button
                  type="button"
                  onClick={handleCopyLoad}
                  title="Create a new load with this load's details (route, schedule, weight, miles, rate, comments). The copy starts OPEN with no driver."
                  className="tms-head-btn bg-slate-700 hover:bg-slate-600 text-white cursor-pointer"
                >
                  Copy Load
                </button>
                {selectedOrder.landstarPosting && (
                  <button
                    type="button"
                    onClick={handleCoveredRemove}
                    title="The customer covered this load. The local bot takes its posting off the Landstar board and the load is deleted from the TMS so it is not posted again."
                    className="tms-head-btn bg-orange-600 hover:bg-orange-500 text-white cursor-pointer"
                  >
                    🚫 Covered — Remove from Landstar
                  </button>
                )}
                {datAvailable && (() => {
                  const datPosting = datPostingFor(selectedBroker, selectedOrder);
                  const time = value => value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
                  return datPosting ? (
                    <button
                      type="button"
                      onClick={() => handleRemoveFromDat(selectedOrder)}
                      disabled={datBusy}
                      title={`On DAT since ${time(datPosting.firstPostedAt || datPosting.postedAt)}, last reposted ${time(datPosting.postedAt)}${datPosting.lastError ? `. Last repost failed: ${datPosting.lastError}` : ''}. Click to take it off DAT.`}
                      className={`${datPosting.lastError ? 'bg-amber-600 hover:bg-amber-500' : 'bg-sky-700 hover:bg-sky-600'} disabled:opacity-50 text-white cursor-pointer tms-head-btn`}
                    >
                      📡 On DAT · reposted {time(datPosting.postedAt)} — Remove
                    </button>
                  ) : selectedOrder.status !== 'BOOKED' && (
                    <button
                      type="button"
                      onClick={() => postLoadsToDat([selectedOrder])}
                      disabled={datBusy}
                      title="Post this load to the DAT load board; the TMS server reposts it every 5 minutes."
                      className="tms-head-btn bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white cursor-pointer"
                    >
                      Post to DAT
                    </button>
                  );
                })()}
                <button
                  type="button"
                  onClick={handleDelete}
                  className="tms-head-btn tms-head-delete bg-red-600 hover:bg-red-500 text-white cursor-pointer"
                >
                  Delete Load
                </button>
              </div>
            </div>

            <div className="tms-load-details space-y-3 bg-[#161f36]/40 p-4 rounded-xl border border-[#1c2541]">
              {/* Load at a glance (Daniel 2026-11-27: "more efficient for my work"): the lane, day,
                  equipment and the money on one line, so most loads need no scrolling. */}
              {(() => {
                const rate = Number(String(selectedOrder.rateInput || '').replace(/[$,]/g, '')) || 0;
                const rpm = getRatePerMile(rate || '', selectedOrder.miles);
                const fscRate = getFuelSurchargeRate(profile.fuelSurcharge, selectedOrder.origSt);
                const miles = Number(String(selectedOrder.miles || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0]) || 0;
                const fsc = fscRate && miles ? fscRate * miles : 0;
                const place = (city, st) => [city, st].filter(Boolean).join(', ') || '—';
                return (
                  <div className="tms-load-summary" aria-label="Load summary">
                    <div className="tms-summary-lane">
                      <span>{place(selectedOrder.origCity, selectedOrder.origSt)}</span>
                      <span className="tms-summary-arrow" aria-hidden="true">→</span>
                      <span>{place(selectedOrder.destCity, selectedOrder.destSt)}</span>
                    </div>
                    <div className="tms-summary-facts">
                      {selectedOrder.miles && <span>{selectedOrder.miles} mi</span>}
                      {selectedOrder.pickupTime && <span>PU {selectedOrder.pickupTime}</span>}
                      {selectedOrder.eCode && <span>{getEquipmentDescription(selectedOrder.eCode) || selectedOrder.eCode}</span>}
                      {selectedOrder.weight && <span>{selectedOrder.weight}</span>}
                    </div>
                    <div className="tms-summary-money">
                      <span className="tms-summary-rate">{rate ? formatDollars(rate) : 'No rate'}</span>
                      {rpm && <span>${rpm}/mi</span>}
                      {rate > 0 && fsc > 0 && <span>Linehaul {formatDollars(rate - fsc)}</span>}
                      {fsc > 0 && <span>Fuel {formatDollars(fsc)}</span>}
                    </div>
                  </div>
                );
              })()}

              {/* Rarely changed posting settings, folded into one line (open it to edit). */}
              <div className="tms-posting-row">
                <button
                  type="button"
                  onClick={() => setShowPostingDetails(open => !open)}
                  aria-expanded={showPostingDetails || String(selectedOrder.id).startsWith('MANUAL-')}
                  className="tms-posting-toggle"
                >
                  <span className="tms-detail-label">Posting</span>
                  <span className="tms-posting-facts">
                    {String(selectedOrder.id).startsWith('MANUAL-') ? 'Order # not set' : `Order ${selectedOrder.id}`}
                    {' · '}Code {selectedOrder.postingCode || profile.postingCode || '—'}
                    {' · '}Group {profile.visibilityGroup || '—'}
                    {' · '}{getLandstarBrokerable(selectedBroker, selectedOrder) === 'Y' ? 'Brokerable' : 'Not brokerable'}
                    {' · '}Alt equipment {[getLandstarExportEquipment2(selectedBroker, selectedOrder, profile.postingCode, getCustomerRules(profile.customerRules, selectedBroker)), selectedOrder.equipment3].filter(Boolean).join(', ') || 'none'}
                  </span>
                  <span className="tms-caret" aria-hidden="true">▾</span>
                </button>
                <div className={showPostingDetails || String(selectedOrder.id).startsWith('MANUAL-') ? 'tms-posting-fields' : 'hidden'}>
                  <div>
                    <button type="button" onClick={() => copyToClipboard(selectedOrder.id, 'Order #')} title="Click to copy the order #" className="tms-copy-label">Order #<span aria-hidden="true">⧉</span></button>
                    <input type="text" value={String(selectedOrder.id).startsWith('MANUAL-') ? '' : selectedOrder.id} placeholder="Optional order number" onChange={(e) => handleFieldChange('id', e.target.value || selectedOrder.id)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white outline-none" />
                  </div>
                  <div>
                    <label className="tms-detail-label">Visibility group</label>
                    <input type="text" value={profile.visibilityGroup} placeholder="Set in ⚙ My Settings" readOnly title="Change in ⚙ My Settings" className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono placeholder-amber-400" />
                  </div>
                  <div>
                    <label className="tms-detail-label">Posting code</label>
                  <input
                    type="text"
                    value={selectedOrder.postingCode || profile.postingCode}
                    placeholder="Set in ⚙ My Settings"
                    onChange={(e) => handleFieldChange('postingCode', e.target.value)}
                    className="w-full bg-[#0b132b] border border-emerald-500/60 rounded p-2 text-sm text-white font-mono"
                  />
                  </div>
                  <div>
                    <span className="tms-detail-label">Brokerable</span>
                    {isAmeriCustomer(selectedBroker) ? (
                      <span className="tms-switch" data-on={AMERI_BROKERABLE === 'Y'} title={`AMERI 18347- ATZ loads always export with Brokerable ${AMERI_BROKERABLE} and no Carrier Amt`}>
                        {AMERI_BROKERABLE === 'Y' ? 'Yes (always for AMERI)' : 'No (always for AMERI)'}
                      </span>
                    ) : (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={String(selectedOrder.brokerable || 'false').trim().toLowerCase() === 'true'}
                        onClick={() => handleFieldChange('brokerable', String(selectedOrder.brokerable || 'false').trim().toLowerCase() === 'true' ? 'false' : 'true')}
                        className="tms-switch"
                        data-on={String(selectedOrder.brokerable || 'false').trim().toLowerCase() === 'true'}
                      >
                        <span className="tms-switch-knob" aria-hidden="true" />
                        {String(selectedOrder.brokerable || 'false').trim().toLowerCase() === 'true' ? 'Yes' : 'No'}
                      </button>
                    )}
                  </div>
                  <div className="tms-posting-alts">
                  {[2, 3].map(slot => {
                    const field = `equipment${slot}`;
                    const value = slot === 2 ? getLandstarExportEquipment2(selectedBroker, selectedOrder, profile.postingCode, getCustomerRules(profile.customerRules, selectedBroker)) : selectedOrder.equipment3 || '';
                    const choices = [...new Map(equipmentOptions.map(([code, label]) => [getLandstarEquipmentCode(code), label])).entries()];
                    return (
                      <div key={field} className="mt-2">
                        <label htmlFor={`load-${field}`} className="text-xs text-gray-400 block mb-1">Alternate equipment {slot - 1}</label>
                        <select id={`load-${field}`} value={value}
                          onChange={event => handleFieldChange(field, event.target.value)}
                          className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white">
                          <option value="">None</option>
                          {value && !choices.some(([code]) => code === value) && <option value={value}>{value}</option>}
                          {choices.filter(([code]) => code && code !== getLandstarEquipmentCode(selectedOrder.eCode)
                            && !(getLandstarEquipmentCode(selectedOrder.eCode) === 'D-LG' && code === 'D-ST')
                            && (slot === 2 || code !== getLandstarExportEquipment2(selectedBroker, selectedOrder, profile.postingCode, getCustomerRules(profile.customerRules, selectedBroker))))
                            .map(([code, label]) => <option key={code} value={code}>{code} - {label}</option>)}
                        </select>
                      </div>
                    );
                  })}
                  </div>
                </div>
              </div>

              {/* Pickup, delivery, and rate and equipment side by side */}
              <div className="tms-detail-columns">
                <div className="tms-detail-card" data-kind="pickup">
                  <h3 className="tms-detail-title"><span aria-hidden="true" />Pickup</h3>
                  <div className="tms-stop-time">
                    <label className="tms-detail-label">Pickup time (early - late)</label>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        aria-label="Pickup time (early - late)"
                        value={selectedOrder.pickupTime || ''}
                        onChange={(e) => handleFieldChange('pickupTime', e.target.value)}
                        className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setOpenSchedulePickers(current => ({ ...current, pickupTime: !current.pickupTime }))}
                        aria-expanded={Boolean(openSchedulePickers.pickupTime)}
                        title="Pick the dates and times on a calendar"
                        className="tms-slim-btn shrink-0"
                        data-tone="violet"
                      >
                        Calendar
                      </button>
                    </div>
                    <div className={openSchedulePickers.pickupTime ? '' : 'hidden'}>{renderSchedulePicker('pickupTime')}</div>
                  </div>
                  <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2">
                    {renderCopyableField('Origin City', 'origCity')}
                    {renderCopyableField('Origin State', 'origSt')}
                    {renderCopyableField('Origin ZIP', 'origZip')}
                  </div>
                  <div>
                    <button type="button" onClick={() => copyToClipboard(selectedOrder.weight, 'Weight')} title="Click to copy the weight" className="tms-copy-label">Weight<span aria-hidden="true">⧉</span></button>
                    <input type="text" value={selectedOrder.weight} onChange={(e) => handleFieldChange('weight', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" />
                  </div>
                </div>

                <div className="tms-detail-card" data-kind="delivery">
                  <h3 className="tms-detail-title"><span aria-hidden="true" />Delivery</h3>
                  <div className="tms-stop-time">
                    <label className="tms-detail-label">Delivery time (early - late)</label>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        aria-label="Delivery time (early - late)"
                        value={selectedOrder.deliveryTime || ''}
                      placeholder={isNolanCustomer(selectedBroker) ? 'MM/DD/YY 08:00  MM/DD/YY 16:00' : ''}
                        onChange={(e) => handleFieldChange('deliveryTime', e.target.value)}
                        className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setOpenSchedulePickers(current => ({ ...current, deliveryTime: !current.deliveryTime }))}
                        aria-expanded={Boolean(openSchedulePickers.deliveryTime)}
                        title="Pick the dates and times on a calendar"
                        className="tms-slim-btn shrink-0"
                        data-tone="violet"
                      >
                        Calendar
                      </button>
                    </div>
                    <div className={openSchedulePickers.deliveryTime ? '' : 'hidden'}>{renderSchedulePicker('deliveryTime')}</div>
                  </div>
                  <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2">
                    {renderCopyableField('Destination City', 'destCity')}
                    {renderCopyableField('Destination State', 'destSt')}
                    {renderCopyableField('Destination ZIP', 'destZip')}
                  </div>
                  <div>
                    <button type="button" onClick={() => copyToClipboard(selectedOrder.miles, 'Miles')} title="Click to copy the miles" className="tms-copy-label">Miles<span aria-hidden="true">⧉</span></button>
                    <input type="text" value={selectedOrder.miles} onChange={(e) => handleFieldChange('miles', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" />
                    <p className="text-[10px] text-gray-500 mt-1">Driving miles fill in from the cities; you can type over them.</p>
                  </div>
                  <div>
                    <label htmlFor="landstar-comment" className="text-xs text-gray-400 block mb-1">
                      Landstar Comment <span className="text-[10px] text-gray-500">(exports to column AA)</span>
                    </label>
                    <input
                      id="landstar-comment"
                      type="text"
                      list="landstar-comment-options"
                      autoComplete="off"
                      maxLength={250}
                      value={selectedOrder.landstarComment || ''}
                      onChange={(e) => handleFieldChange('landstarComment', e.target.value)}
                      placeholder="Type a comment or pick a Landstar comment"
                      className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white"
                    />
                    <datalist id="landstar-comment-options">
                      {landstarCommentOptions.map(option => <option key={option} value={option} />)}
                    </datalist>
                    {String(selectedOrder.landstarComment || '').trim() && !getLandstarExportComment(selectedOrder) && (
                      <p className="text-[11px] text-amber-300 mt-1" id="landstar-comment-warning">
                        ⚠ Not a Landstar comment code, so it will not be exported (Landstar rejects the whole posting otherwise). Pick one from the list.
                      </p>
                    )}
                    <p className="text-[11px] text-gray-300 mt-1 break-all" id="landstar-comment-link">
                      {selectedOrder.inquiryToken
                        ? <>🔗 Driver link (paste into BCO Posting Comments or text it): <a href={getInquiryUrl(selectedOrder.inquiryToken)} target="_blank" rel="noreferrer" className="text-purple-300 underline">{getInquiryUrl(selectedOrder.inquiryToken)}</a></>
                        : '🔗 Driver link: created when you export, or use “Copy driver link” above.'}
                    </p>
                  </div>
                </div>

                <div className="tms-detail-card" data-kind="rate">
                  <h3 className="tms-detail-title"><span aria-hidden="true" />Rate and equipment <span className="tms-detail-note">Flat rate</span></h3>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <button type="button" onClick={() => copyToClipboard(selectedOrder.rateInput || '', 'Rate')} title="Click to copy the rate" className="tms-copy-label text-emerald-400">{selectedOrder.rateSource === 'customer-bin' ? 'Rate ($) - BIN' : 'Rate ($) - DAT quote'}<span aria-hidden="true">⧉</span></button>
                      <span className="text-[10px] bg-emerald-950 text-emerald-300 px-1 py-0.2 rounded font-mono border border-emerald-600/40">
                        {selectedOrder.rateSource === 'customer-bin' ? 'From BIN' : selectedOrder.rateSource === 'dat-screenshot' ? 'From screenshot' : selectedOrder.rateSource === 'dat-api' ? 'From DAT API' : 'Manual'}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={['user-entered', 'dat-screenshot', 'dat-api'].includes(selectedOrder.rateSource) ? selectedOrder.rateInput || '' : ''}
                        onChange={(e) => handleFieldChange('rateInput', e.target.value)}
                        onKeyDown={handleRateKeyDown}
                        placeholder="Enter DAT quote"
                        title="Saved automatically for future loads with this customer, lane (city and state) and equipment; the latest rate is reused. After you stop editing for about 5 seconds (or press Enter) it moves to the next load."
                        className="flex-1 basis-0 min-w-0 h-12 bg-[#0b132b] border-2 border-emerald-500 rounded px-3 text-xl text-white font-mono font-extrabold"
                      />
                      {(() => {
                        const shownRate = ['user-entered', 'dat-screenshot', 'dat-api'].includes(selectedOrder.rateSource) ? selectedOrder.rateInput : '';
                        const rpm = getRatePerMile(shownRate, selectedOrder.miles);
                        return (
                          <div aria-label="Rate per mile" title="Rate ÷ miles" className="flex-1 basis-0 min-w-0 h-12 flex items-center justify-center bg-emerald-950 border-2 border-emerald-500 text-emerald-300 px-3 rounded text-xl font-mono font-extrabold whitespace-nowrap">
                            {rpm ? `$${rpm}/mi` : '$/mi'}
                          </div>
                        );
                      })()}
                    </div>
                    {(() => {
                      const pay = getTruckPay(selectedBroker, selectedOrder);
                      if (!pay) return null;
                      return (
                        <div aria-label="Truck pay" className="mt-2">
                          <div className="bg-violet-950/60 border border-violet-500/50 rounded px-2 py-1" title="Approved carriers get 78% to 85% of the posted rate">
                            <div className="text-[10px] text-violet-300 font-bold uppercase">🤝 Approved carrier (78–85%)</div>
                            <div className="text-sm text-white font-mono font-extrabold">{formatDollars(pay.carrierLow)} – {formatDollars(pay.carrierHigh)}</div>
                          </div>
                        </div>
                      );
                    })()}
                    {(() => {
                      const laneHistory = getLaneRateHistory(rateHistory, selectedBroker, selectedOrder);
                      if (!laneHistory.length) return null;
                      const currentRate = String(Number(String(selectedOrder.rateInput || '').replace(/[$,]/g, '')) || '');
                      const exactKey = createLaneRateKey(selectedBroker, selectedOrder);
                      return (
                        <div className="mt-2" aria-label="Past rates for this lane">
                          <div className="text-[10px] text-gray-500 mb-1">
                            📈 Past rates: {selectedOrder.origCity}, {selectedOrder.origSt} → {selectedOrder.destCity}, {selectedOrder.destSt}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {laneHistory.slice(0, 6).map(entry => {
                              const isCurrent = entry.rate === currentRate;
                              const isExact = Boolean(exactKey) && entry.key === exactKey;
                              const savedDate = entry.savedAt ? new Date(entry.savedAt) : null;
                              const dateLabel = savedDate && !Number.isNaN(savedDate.getTime())
                                ? savedDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
                                : 'saved';
                              const titleParts = [
                                entry.customer,
                                entry.eCode || 'Any equipment',
                                entry.source === 'manual' ? 'Entered' : entry.source === 'saved' ? 'Saved rate' : entry.source === 'exported' ? 'Exported to Landstar' : entry.source,
                                savedDate && !Number.isNaN(savedDate.getTime()) ? savedDate.toLocaleString() : ''
                              ].filter(Boolean);
                              if (!isExact) titleParts.push('different customer/equipment');
                              return (
                                <button
                                  key={`${entry.key}|${entry.rate}`}
                                  type="button"
                                  onClick={() => handleFieldChange('rateInput', entry.rate)}
                                  title={titleParts.join(' • ')}
                                  className={`px-2 py-1 rounded text-xs font-mono font-bold border cursor-pointer ${isCurrent
                                    ? 'bg-emerald-600 border-emerald-400 text-white'
                                    : 'bg-[#0b132b] border-emerald-700/50 text-emerald-300 hover:bg-emerald-950'}`}
                                >
                                  ${Number(entry.rate).toLocaleString('en-US')} · {dateLabel}{isExact ? '' : ` · ${String(entry.customer || '').split(' ')[0]}`}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                    {hasOpenLandstarError(selectedOrder) && (
                      <div role="alert" className="mt-2 rounded border-2 border-red-500 bg-red-950/60 px-3 py-2 text-xs text-red-200">
                        <span className="font-extrabold text-red-300">⚠ Landstar rejected this posting (the bot deleted it from Bulk Postings): </span>
                        {selectedOrder.landstarError.reasons.join('; ') || 'no reason given'}. Fix the load and export it again.
                      </div>
                    )}
                    {(() => {
                      const raise = selectedOrder.rateRaise || getTeamRateRaise(selectedOrder.id);
                      if (!raise) return null;
                      return (
                        <div role="status" className="mt-2 rounded border-2 border-amber-400 bg-amber-950/60 px-3 py-2 text-xs text-amber-200">
                          <span className="font-extrabold text-amber-300">⬆ Rate raised by {selectedOrder.rateRaise ? 'the bot' : "the team's bot"} on Landstar: </span>
                          {formatRaiseMoney(raise.from)} → <span className="font-extrabold text-white">{formatRaiseMoney(raise.to)}</span>
                          {raise.competitor ? ` because ${raise.competitor} was paying ${formatRaiseMoney(raise.competitorRate)}` : ''}
                          {raise.at ? ` · ${new Date(raise.at).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
                        </div>
                      );
                    })()}
                    {(() => {
                      const fscRate = getFuelSurchargeRate(profile.fuelSurcharge, selectedOrder.origSt);
                      if (!fscRate) return null;
                      const region = fuelSurchargeRegions[getFuelSurchargeRegion(selectedOrder.origSt)];
                      const fscMiles = Number(String(selectedOrder.miles || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0]);
                      const fscTotal = fscMiles > 0 ? fscRate * fscMiles : null;
                      const shownRate = ['user-entered', 'dat-screenshot', 'dat-api'].includes(selectedOrder.rateSource)
                        ? Number(String(selectedOrder.rateInput || '').replace(/[$,]/g, ''))
                        : 0;
                      const linehaul = shownRate > 0 && fscTotal !== null ? shownRate - fscTotal : null;
                      return (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div
                            aria-label="Linehaul"
                            title="Linehaul = customer rate − fuel surcharge"
                            className="h-12 flex items-center justify-between gap-2 bg-sky-950 border-2 border-sky-500 text-sky-300 px-3 rounded"
                          >
                            <span className="text-xl font-mono font-extrabold whitespace-nowrap">
                              🚛 {linehaul !== null ? `$${linehaul.toFixed(2)}` : 'Linehaul'}
                            </span>
                            <span className="text-[11px] text-sky-400/90 text-right leading-tight">
                              {linehaul !== null && fscMiles > 0 ? `$${(linehaul / fscMiles).toFixed(2)}/mi` : 'rate − FSC'}
                            </span>
                          </div>
                          <div
                            aria-label="Fuel surcharge"
                            title={`Fuel surcharge on export (${region.label}). Update weekly in ⚙ My Settings.`}
                            className="h-12 flex items-center justify-between gap-2 bg-amber-950 border-2 border-amber-500 text-amber-300 px-3 rounded"
                          >
                            <span className="text-xl font-mono font-extrabold whitespace-nowrap">
                              ⛽ {fscTotal !== null ? `$${fscTotal.toFixed(2)}` : 'FSC'}
                            </span>
                            <span className="text-[11px] text-amber-400/90 text-right leading-tight">
                              ${fscRate.toFixed(2)}/mi • {region.label}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <div>
                  {String(selectedOrder.eCode || '').trim().toUpperCase() === 'VE' && (
                    <>
                      <input type="text" value="VAN" readOnly aria-label="Mapped equipment" className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                      <label className="text-xs text-gray-400 block mt-2 mb-1">SOURCE EQUIPMENT CODE (VE = VAN / CHEM)</label>
                    </>
                  )}
                  <label htmlFor="load-equipment-primary" className="text-xs text-gray-400 block mb-1">Primary equipment</label>
                  <select id="load-equipment-primary" value={selectedOrder.eCode || ''}
                    onChange={event => {
                      saveLoad({ ...selectedOrder, eCode: event.target.value, equipment2: undefined, equipment3: '' });
                    }}
                    className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white">
                    <option value="">Select equipment</option>
                    {selectedOrder.eCode && !equipmentOptions.some(([code]) => code === selectedOrder.eCode) && (
                      <option value={selectedOrder.eCode}>{selectedOrder.eCode} - {getEquipmentDescription(selectedOrder.eCode)}</option>
                    )}
                    {equipmentOptions.map(([code, label]) => <option key={code} value={code}>{code} - {label}</option>)}
                  </select>
                  <div className="text-[11px] text-emerald-400 mt-1 font-mono">{getEquipmentDescription(selectedOrder.eCode)}</div>
                  </div>
                <div className="mt-3 grid grid-cols-[1fr_8rem] gap-4">
                  <div>
                    <label htmlFor="load-commodity" className="text-xs text-gray-400 block mb-1">Commodity</label>
                    <select
                      id="load-commodity"
                      value={selectedOrder.commodity || ''}
                      onChange={event => {
                        const commodity = event.target.value;
                        if (isHazmatLoad(selectedOrder) && commodity && commodity !== 'HAZMAT'
                          && !window.confirm('Confirm this freight is NOT hazardous. This changes the hazmat classification and Landstar export attributes.')) return;
                        handleFieldChange('commodity', commodity);
                      }}
                      className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white"
                    >
                      <option value="">Automatic ({getLoadCommodity({ ...selectedOrder, commodity: '' })})</option>
                      <option value="CGAPP">CGAPP - Consumer goods / appliances</option>
                      <option value="HAZMAT">HAZMAT - Hazardous materials</option>
                      <option value="CHEM">CHEM - Non-hazardous chemicals</option>
                    </select>
                    {isTankerLoad(selectedOrder) && (
                      <p className="text-xs text-yellow-300 font-bold mt-1">🛢 Tanker (N) Endorsement required</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="load-team" className="text-xs text-gray-400 block mb-1">Team</label>
                    <select
                      id="load-team"
                      value={isTeamLoad(selectedOrder) ? 'true' : 'false'}
                      onChange={event => handleFieldChange('team', event.target.value)}
                      className={`w-full border rounded p-2 text-sm font-bold cursor-pointer ${isTeamLoad(selectedOrder) ? 'bg-emerald-900/60 border-emerald-500 text-emerald-200' : 'bg-[#0b132b] border-[#1c2541] text-white'}`}
                    >
                      <option value="false">false</option>
                      <option value="true">true</option>
                    </select>
                  </div>
                </div>
                </div>
              </div>

              {/* Driver and equipment (Daniel 2026-11-27): the truck # comes first and brings back the
                  saved driver; loads hauled by an outside carrier get its name and MC #. */}
              {(() => {
                const carrierAllowed = isAmeriCustomer(selectedBroker) || getCustomerRules(profile.customerRules, selectedBroker).capacity === 'both';
                const isCarrierLoad = carrierAllowed && (selectedOrder.capacityType === 'carrier' || Boolean(getCarrierMc(selectedOrder)));
                const savedTruck = lookupTruck(profile.truckBook, selectedOrder.truck);
                return (
              <div className="tms-detail-card" data-kind="driver">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="tms-detail-title"><span aria-hidden="true" />Driver and equipment</h3>
                  {carrierAllowed && (
                    <div className="tms-capacity-switch" role="group" aria-label="Who hauls this load">
                      <button type="button" aria-pressed={!isCarrierLoad} onClick={() => setCapacityType('bco')} className="tms-slim-btn" data-tone="violet">BCO truck</button>
                      <button type="button" aria-pressed={isCarrierLoad} onClick={() => setCapacityType('carrier')} className="tms-slim-btn" data-tone="amber">Carrier</button>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5 ml-auto">
                    <button
                      type="button"
                      onClick={async (event) => {
                        const button = event.currentTarget;
                        await copyToClipboard(formatDriverInfo(selectedOrder), 'Driver info');
                        button.textContent = '✓ Copied';
                        setTimeout(() => { button.textContent = '📋 Copy driver info'; }, 1500);
                      }}
                      title="Copy the driver's name, phone, truck, trailer, previous empty location, pickup ETA and load number"
                      className="tms-slim-btn" data-tone="blue"
                    >
                      📋 Copy driver info
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyDriverLink}
                      title="Copy a link drivers can open to see this load and send you an inquiry"
                      className="tms-slim-btn"
                      data-tone="violet"
                    >
                      🔗 Copy driver link
                    </button>
                  </div>
                </div>
                {(() => {
                  const loadInquiries = inquiries.filter(inquiry => inquiry.customer === selectedBroker && String(inquiry.load_id) === String(selectedOrder.id));
                  if (!loadInquiries.length) return null;
                  return (
                    <div className="mb-3 border border-purple-500/50 rounded p-2 bg-purple-950/20">
                      <p className="text-[11px] font-bold text-purple-200 mb-1">📨 {loadInquiries.length} driver inquir{loadInquiries.length === 1 ? 'y' : 'ies'} on this load</p>
                      {loadInquiries.map(inquiry => (
                        <p key={inquiry.id} className="text-xs text-white">
                          {formatCheckTime(inquiry.created_at)} · <span className="font-semibold">{inquiry.driver_name}</span> ·{' '}
                          <a href={`tel:${String(inquiry.driver_phone).replace(/[^\d+]/g, '')}`} className="text-emerald-300 underline">{inquiry.driver_phone}</a>
                          {inquiry.mc_or_truck ? ` · ${inquiry.mc_or_truck}` : ''}
                          {inquiry.message ? ` · “${inquiry.message}”` : ''}
                        </p>
                      ))}
                    </div>
                  );
                })()}
                <datalist id="known-drivers">
                  {driverDirectory.drivers.map(entry => (
                    <option key={entry.driver} value={entry.driver} label={[entry.truck && `Truck ${entry.truck}`, entry.trailer && `Trailer ${entry.trailer}`, entry.driverPhone].filter(Boolean).join(' · ')} />
                  ))}
                </datalist>
                <datalist id="known-trucks">
                  {driverDirectory.trucks.map(truck => <option key={truck} value={truck} />)}
                </datalist>
                <datalist id="known-trailers">
                  {driverDirectory.trailers.map(trailer => <option key={trailer} value={trailer} />)}
                </datalist>
                <datalist id="known-driver-phones">
                  {driverDirectory.drivers.filter(entry => entry.driverPhone).map(entry => (
                    <option key={entry.driver} value={entry.driverPhone} label={entry.driver} />
                  ))}
                </datalist>
                <datalist id="known-carriers">
                  {Object.values(profile.carrierBook || {}).map(entry => <option key={entry.mc} value={entry.name} label={`MC ${entry.mc}`} />)}
                </datalist>
                {isCarrierLoad && (
                  <div className="tms-field-grid" data-kind="carrier">
                    <div>
                      <button type="button" onClick={() => copyToClipboard(selectedOrder.carrierName || '', 'Carrier name')} title="Click to copy the carrier name" className="tms-copy-label">Carrier name<span aria-hidden="true">⧉</span></button>
                      <input id="assignment-carrier-name" type="text" list="known-carriers" autoComplete="off" value={selectedOrder.carrierName || ''} onChange={(e) => handleCarrierNameChange(e.target.value)} onBlur={() => rememberCapacity(selectedOrder)} placeholder="Carrier company name" className="tms-slim-input w-full" />
                    </div>
                    <div>
                      <button type="button" onClick={() => copyToClipboard(selectedOrder.carrierMc || '', 'MC #')} title="Click to copy the mc #" className="tms-copy-label">MC #<span aria-hidden="true">⧉</span></button>
                      <input id="assignment-carrier-mc" type="text" inputMode="numeric" autoComplete="off" value={selectedOrder.carrierMc || ''} onChange={(e) => handleCarrierMcChange(e.target.value)} onBlur={() => rememberCapacity(selectedOrder)} placeholder="MC number, e.g. 547847" className="tms-slim-input w-full" />
                    </div>
                    {getCarrierMc(selectedOrder) && (
                      <p className="tms-field-note">Book Load assigns this carrier on Landstar (Capacity type: Carrier) instead of a BCO truck, only when the MC search finds exactly one Qualified carrier.</p>
                    )}
                  </div>
                )}
                <div className="tms-field-grid">
                  <div>
                    <button type="button" onClick={() => copyToClipboard(selectedOrder.truck || '', 'Truck #')} title="Click to copy the truck #" className="tms-copy-label">Truck #<span aria-hidden="true">⧉</span></button>
                    <input id="assignment-truck" type="text" list="known-trucks" autoComplete="off" value={selectedOrder.truck || ''} onChange={(e) => handleTruckChange(e.target.value)} onBlur={() => rememberCapacity(selectedOrder)} placeholder="Truck # brings back its driver" className="tms-slim-input w-full" />
                    {savedTruck && <p className="tms-field-note">Saved: {savedTruck.driver}{savedTruck.driverPhone ? ` · ${savedTruck.driverPhone}` : ''}</p>}
                  </div>
                  <div>
                    <button type="button" onClick={() => copyToClipboard(selectedOrder.driver || '', 'Driver name')} title="Click to copy the driver name" className="tms-copy-label">Driver name<span aria-hidden="true">⧉</span></button>
                    <input id="assignment-driver" type="text" list="known-drivers" autoComplete="off" value={selectedOrder.driver || ''} onChange={(e) => handleDriverChange(e.target.value)} onBlur={() => rememberCapacity(selectedOrder)} placeholder="Type or pick a driver" className="tms-slim-input w-full" />
                  </div>
                  <div>
                    <button type="button" onClick={() => copyToClipboard(selectedOrder.driverPhone || '', 'Driver cell')} title="Click to copy the driver cell" className="tms-copy-label">Driver cell<span aria-hidden="true">⧉</span></button>
                    <input id="assignment-driver-phone" type="tel" list="known-driver-phones" autoComplete="off" value={selectedOrder.driverPhone || ''} onChange={(e) => handleFieldChange('driverPhone', e.target.value)} onBlur={() => rememberCapacity(selectedOrder)} placeholder="Cell phone" title="Entering a phone number moves an unbooked load to OFFER. Book Load separately when accepted." className="tms-slim-input w-full" />
                  </div>
                </div>
                <div className="tms-field-grid">
                  <div>
                    <button type="button" onClick={() => copyToClipboard(selectedOrder.trailer || '', 'Trailer #')} title="Click to copy the trailer #" className="tms-copy-label">Trailer #<span aria-hidden="true">⧉</span></button>
                    <input id="assignment-trailer" type="text" list="known-trailers" autoComplete="off" value={selectedOrder.trailer || ''} onChange={(e) => handleFieldChange('trailer', e.target.value)} onBlur={() => rememberCapacity(selectedOrder)} placeholder="Trailer number" className="tms-slim-input w-full" />
                  </div>
                  <div>
                    <label htmlFor="assignment-pickup-eta" className="tms-detail-label">Pickup ETA</label>
                    <input id="assignment-pickup-eta" type="text" value={selectedOrder.pickupEta || ''} onChange={(e) => handleFieldChange('pickupEta', e.target.value)} placeholder="MM/DD/YYYY HH:mm (local)" className="tms-slim-input w-full" />
                  </div>
                  <div>
                    <button type="button" onClick={() => copyToClipboard(selectedOrder.emptyLocation || '', 'Previous empty')} title="Click to copy the previous empty" className="tms-copy-label">Previous empty<span aria-hidden="true">⧉</span></button>
                    <input id="assignment-empty-location" type="text" autoComplete="off" value={selectedOrder.emptyLocation || ''} onChange={(e) => handleFieldChange('emptyLocation', e.target.value)} placeholder="City, ST it empties before this load" className="tms-slim-input w-full" />
                  </div>
                </div>
              </div>
                );
              })()}

                <div className="tms-detail-card" data-kind="notes">
                  <h3 className="tms-detail-title"><span aria-hidden="true" />Planning comment</h3>
                  <input
                    type="text"
                    aria-label="Planning comment"
                    value={selectedOrder.planningComment}
                    onChange={(e) => handleFieldChange('planningComment', e.target.value)}
                    className="tms-slim-input w-full"
                  />
                </div>
              <div className="flex justify-between items-center gap-2 pt-4 border-t border-[#1c2541]">
                <button
                  type="button"
                  onClick={handleToggleNeedsCapacity}
                  title="Flag this pre-booked load as needing capacity soon. A ⭐ NEEDS CAPACITY badge shows on the load until you turn it off."
                  className={`px-4 py-2 rounded text-sm font-semibold cursor-pointer whitespace-nowrap ${String(selectedOrder.needsCapacity || '').trim() ? 'bg-amber-400 text-black' : 'bg-slate-700 hover:bg-slate-600 text-slate-100'}`}
                >
                  {String(selectedOrder.needsCapacity || '').trim() ? '⭐ Needs capacity' : '☆ Mark needs capacity'}
                </button>
                {selectedOrder.status === 'BOOKED' ? (
                  <div className="w-full flex flex-wrap items-center gap-2">
                    <div className="flex-1 min-w-[12rem] text-center bg-purple-900/50 border border-purple-500 text-purple-100 px-4 py-2 rounded text-sm font-semibold" role="status">
                      ✓ Booked in TMS{selectedOrder.driver ? ` · ${selectedOrder.driver}` : ''} · Landstar assignment is separate · edits save automatically
                    </div>
                    {String(selectedOrder.notes || '').includes('Landstar: not assigned automatically - ') && (
                      <div className="w-full text-amber-200 text-sm" role="alert">
                        {String(selectedOrder.notes).split('\n').filter(line => line.startsWith('Landstar: not assigned automatically - ')).join(' ')}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleRemoveCapacity}
                      title="Clear the driver, truck and trailer and move this load back to OPEN"
                      className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded text-sm font-semibold cursor-pointer"
                    >
                      ↩ Remove capacity
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleBookLoad}
                    title={String(selectedOrder.driver || '').trim() ? 'Book this load and move it to Booked Loads' : 'Enter the driver name to book this load'}
                    className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-2 rounded text-sm font-semibold flex-1 transition-colors shadow-lg cursor-pointer"
                  >
                    📦 Book Load
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <p>No loads available for this customer. Click "📂 Import Excel" at the top left to load your spreadsheet!</p>
          </div>
        )}
      </div>
    </div>
  );
}
