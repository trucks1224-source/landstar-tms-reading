// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { splitScheduleRange } from '../lib/trackingEmails.js';
import { isTeamLoad, getLandstarEquipmentCode } from './equipment.js';
import { isAmeriCustomer } from './laneRates.js';
import { parseWeightPounds } from './screenshotParsers.js';
import { isHazmatLoad } from './importRules.js';
import { toExcelDateTime } from './dates.js';
import { getRxoAtzDatVanDiscount } from './loadCards.js';

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

export {
  datStateTimezones,
  excelSerialToZonedIso,
  getDatEquipment,
  buildDatPosting
};
