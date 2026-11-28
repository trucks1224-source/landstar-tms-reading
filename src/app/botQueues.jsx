// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { splitScheduleRange } from '../lib/trackingEmails.js';
import { parseWeightPounds } from './screenshotParsers.js';
import { toExcelDateTime } from './dates.js';

// Excel serial (local clock) -> "MM/DD/YY HH:MM", the way the Landstar board shows times.
function excelSerialToBoardTime(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial)) return '';
  const date = new Date(Math.round(serial * 86400000) + Date.UTC(1899, 11, 30));
  const pad = value => String(value).padStart(2, '0');
  return `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${pad(date.getUTCFullYear() % 100)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

// What identifies a load's posting on Landstar (Landstar postings carry no customer
// load number): both ZIPs, pickup and delivery END times, and weight, exactly as exported.
// End times are used because the export may move a past pickup START up to now.
// US ZIPs that lost their leading zeros as numbers (NJ 07036 -> 7036) get them back, so they
// match Landstar's posting. Canadian postal codes (letters) are left as they are.
const postingZip = value => {
  const zip = String(value || '').trim().toUpperCase();
  return /^\d{3,4}$/.test(zip) ? zip.padStart(5, '0') : zip;
};

function buildLandstarPosting(record) {
  return {
    originZip: postingZip(record['Origin Zipcode(Required)']),
    destZip: postingZip(record['Destination Zipcode(Required)']),
    pickupThru: excelSerialToBoardTime(record['Pickup Date (Thru)(Required)']),
    deliveryThru: excelSerialToBoardTime(record['Delivery Date (Thru)(Required)']),
    weight: Number(record['Weight(Required)']) || 0
  };
}

const BOT_UNPOST_URL = 'http://127.0.0.1:47615/unpost';

// Postings waiting to be removed from Landstar by the upload bot (loads that dropped
// off a customer's list). Kept in this browser until the bot confirms it has them.
const unpostQueueKey = 'landstar_unpostQueue';

function readUnpostQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(unpostQueueKey));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUnpostQueue(queue) {
  try {
    localStorage.setItem(unpostQueueKey, JSON.stringify(queue));
  } catch (error) {
    console.error('Could not save the Landstar removal queue:', error);
  }
}

// Loads booked in the TMS: the bot assigns the truck (BCO tractor number) to the load's
// Landstar posting. Kept in this browser until the bot confirms it has them.
const BOT_ASSIGN_URL = 'http://127.0.0.1:47615/assign';

const assignQueueKey = 'landstar_assignQueue';

// What the bot needs to assign a booked load on Landstar, or why it can't.
function buildAssignRequest(customer, load) {
  const truck = String(load?.truck || '').trim();
  // An approved carrier's MC number (AMERI 18347- ATZ) books a carrier instead of a BCO truck.
  const carrierMc = getCarrierMc(load);
  if (!truck && !carrierMc) return { reason: 'There is no truck number or carrier MC # on this load.' };
  let posting = load?.landstarPosting;
  const recoverPosting = !posting?.originZip;
  if (recoverPosting) {
    const pickup = splitScheduleRange(load.pickupTime);
    const delivery = splitScheduleRange(load.deliveryTime);
    const from = toExcelDateTime(pickup[0]);
    let thru = toExcelDateTime(pickup[1] || pickup[0], pickup[0]);
    const deliveryFrom = toExcelDateTime(delivery[0]);
    let deliveryThru = toExcelDateTime(delivery[1] || delivery[0], delivery[0]);
    if (from !== null && thru !== null && thru <= from) thru = from + 1 / 24;
    if (deliveryFrom !== null && deliveryThru !== null && deliveryThru <= deliveryFrom) deliveryThru = deliveryFrom + 1 / 24;
    if (!load.origZip || !load.destZip || thru === null || deliveryThru === null || !(parseWeightPounds(load.weight) > 0)) {
      return { reason: 'Saved posting details are missing, and ZIPs, pickup/delivery times and weight are required to safely recover the bot-uploaded posting.' };
    }
    posting = buildLandstarPosting({
      'Origin Zipcode(Required)': load.origZip, 'Destination Zipcode(Required)': load.destZip,
      'Pickup Date (Thru)(Required)': thru, 'Delivery Date (Thru)(Required)': deliveryThru,
      'Weight(Required)': parseWeightPounds(load.weight)
    });
  }
  return {
    item: {
      customer, loadId: String(load.id), truck: carrierMc ? '' : truck,
      ...(carrierMc ? { carrierMc } : {}),
      driver: String(load.driver || '').trim(), posting, recoverPosting
    }
  };
}

// The approved carrier's MC number typed on the load (digits only; "MC-547847" -> "547847").
function getCarrierMc(load) {
  return String(load?.carrierMc || '').replace(/\D/g, '');
}

function readAssignQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(assignQueueKey));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Hands booked loads to the bot; returns how many it accepted (0 if the bot is off).
async function sendAssignQueueToBot() {
  const queue = readAssignQueue();
  if (!queue.length) return 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(BOT_ASSIGN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookings: queue }),
      signal: controller.signal
    });
    if (!response.ok) return 0;
    const sent = new Set(queue.map(item => `${item.customer}|${item.loadId}|${item.truck}`));
    const left = readAssignQueue().filter(item => !sent.has(`${item.customer}|${item.loadId}|${item.truck}`));
    localStorage.setItem(assignQueueKey, JSON.stringify(left));
    return queue.length;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

// Hands the queue to the bot; returns how many it accepted (0 if the bot is off).
async function sendUnpostQueueToBot() {
  const queue = readUnpostQueue();
  if (!queue.length) return 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(BOT_UNPOST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postings: queue }),
      signal: controller.signal
    });
    if (!response.ok) return 0;
    const sent = new Set(queue.map(item => `${item.customer}|${item.loadId}`));
    writeUnpostQueue(readUnpostQueue().filter(item => !sent.has(`${item.customer}|${item.loadId}`)));
    return queue.length;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

export {
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
};
