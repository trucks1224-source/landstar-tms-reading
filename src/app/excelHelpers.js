// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { rxoPayerCustomerName, normalizeCustomerName } from '../lib/trackingEmails.js';
import { formatRxoExcelDateTime } from './dates.js';

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

export {
  parseDatRateText,
  formatExcelDateTime,
  formatRxoBusinessHours,
  applyRxoPayerBusinessHours,
  getEarliestPickupSerial,
  loadIdHeaders,
  originCityHeaders,
  phalanxColumns,
  addMissingPhalanxHeader,
  getLoadSheetNames,
  adjustPickupWindow
};
