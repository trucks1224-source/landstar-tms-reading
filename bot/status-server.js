// Local link between the bot and the TMS (only listens on this computer, 127.0.0.1).
//
//   GET  /status  -> { state, message, since }   (the TMS header light)
//   POST /unpost  -> { postings: [...] }          (loads that dropped off a customer's
//                     list; saved to unpost-queue.json and removed from Landstar by
//                     the bot, see unpost.js)
//   POST /assign   -> booked loads to assign on Landstar (assign.js)
//   POST /tracking -> booked Paramount loads to look up in Clarity (clarity.js)
//
// When the bot stops, the address stops answering and the TMS shows the bot as off
// (and keeps any removals waiting in the browser until the bot is back).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { automaticDispatchEnabled } = require('./automation-policy.json');

const PORT = 47615;
// Tests point this at a temporary file.
const QUEUE_FILE = process.env.UNPOST_QUEUE_FILE || path.join(__dirname, 'unpost-queue.json');
const MAX_BODY = 2 * 1024 * 1024;
let status = { state: 'starting', message: 'Bot starting', since: Date.now() };
// Upload progress for the TMS: { uploaded, waiting } files this run.
let progress = null;
let server = null;

function readQueue() {
  try {
    const parsed = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 1));
}

// Adds postings to the queue (one entry per customer + load), returns the queue size.
function enqueue(postings) {
  const queue = readQueue();
  const seen = new Set(queue.map(item => `${item.customer}|${item.loadId}`));
  postings.forEach(item => {
    const posting = item && item.posting;
    if (!posting || !posting.originZip || !posting.destZip || !posting.pickupThru) return;
    const key = `${item.customer}|${item.loadId}`;
    if (seen.has(key)) return;
    seen.add(key);
    queue.push({
      customer: String(item.customer || ''), loadId: String(item.loadId || ''), attempts: 0,
      posting: {
        originZip: String(posting.originZip), destZip: String(posting.destZip),
        pickupThru: String(posting.pickupThru), deliveryThru: String(posting.deliveryThru || ''),
        weight: Number(posting.weight) || 0
      }
    });
  });
  writeQueue(queue);
  return queue.length;
}

// ---------- Assign Capacity queue (loads booked in the TMS) ----------
// POST /assign -> { bookings: [{ customer, loadId, truck, driver, posting }] }. The bot
// finds each load's Landstar posting and assigns the BCO with that tractor number
// (see assign.js). Results are reported back through GET /status (assignResults).
const ASSIGN_QUEUE_FILE = process.env.ASSIGN_QUEUE_FILE || path.join(__dirname, 'assign-queue.json');
// Results are kept in files so the helper bot (helper.js, its own process) and the main bot
// share them: whichever process serves /status reads them fresh.
const RESULTS_FILE = process.env.BOT_RESULTS_FILE || path.join(__dirname, 'bot-results.json');
const HELPER_STATUS_FILE = process.env.HELPER_STATUS_FILE || path.join(__dirname, 'helper-status.json');
const IS_HELPER = process.env.BOT_ROLE === 'helper';
const IS_REMOVAL = process.env.BOT_ROLE === 'removal';
const IS_RATES = process.env.BOT_ROLE === 'rates';
const REMOVAL_STATUS_FILE = process.env.REMOVAL_STATUS_FILE || path.join(__dirname, 'removal-status.json');
const RATES_STATUS_FILE = process.env.RATES_STATUS_FILE || path.join(__dirname, 'rates-status.json');

function readRatesStatus() {
  try {
    const parsed = JSON.parse(fs.readFileSync(RATES_STATUS_FILE, 'utf8'));
    return Date.now() - Number(parsed.at) < 90000 ? parsed : { state: 'off', message: 'Rate worker is not running' };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read rate worker status:', error.message);
    return { state: 'off', message: 'Rate worker is not running' };
  }
}

function readRemovalStatus() {
  try {
    const parsed = JSON.parse(fs.readFileSync(REMOVAL_STATUS_FILE, 'utf8'));
    return Date.now() - Number(parsed.at) < 90000 ? parsed : { state: 'off', message: 'Removal bot is not running' };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read removal bot status:', error.message);
    return { state: 'off', message: 'Removal bot is not running' };
  }
}

function removalActive() {
  return ['logged-in', 'working', 'signing-in', 'starting'].includes(readRemovalStatus().state);
}

function readResults() {
  try {
    const parsed = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    return { assign: parsed.assign || [], tracking: parsed.tracking || {}, mercurygate: parsed.mercurygate || [] };
  } catch {
    return { assign: [], tracking: {}, mercurygate: [] };
  }
}

function updateResults(change) {
  const next = change(readResults());
  const temp = `${RESULTS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next));
  fs.renameSync(temp, RESULTS_FILE);
}

// The helper bot's light: { state, message, at } written by helper.js every few seconds.
function readHelperStatus() {
  try {
    const parsed = JSON.parse(fs.readFileSync(HELPER_STATUS_FILE, 'utf8'));
    return Date.now() - Number(parsed.at) < 90000 ? parsed : { state: 'off', message: 'Helper bot is not running' };
  } catch {
    return { state: 'off', message: 'Helper bot is not running' };
  }
}

// The helper takes Assign Capacity, Clarity and MercuryGate off the main bot while it runs.
function helperActive() {
  const helper = readHelperStatus();
  return helper.state === 'logged-in' || helper.state === 'working';
}

function readAssignQueue() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ASSIGN_QUEUE_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAssignQueue(queue) {
  fs.writeFileSync(ASSIGN_QUEUE_FILE, JSON.stringify(queue, null, 1));
}

// One entry per customer + load; a newer request for the same load (another truck) replaces it.
function enqueueAssign(bookings) {
  const queue = readAssignQueue();
  bookings.forEach(item => {
    const posting = item && item.posting;
    const truck = String(item?.truck || '').trim();
    if (!truck || !posting || !posting.originZip || !posting.destZip || !posting.pickupThru) return;
    const key = `${item.customer}|${item.loadId}`;
    const entry = {
      customer: String(item.customer || ''), loadId: String(item.loadId || ''), truck,
      driver: String(item.driver || ''), attempts: 0, recoverPosting: item.recoverPosting === true,
      posting: {
        originZip: String(posting.originZip), destZip: String(posting.destZip),
        pickupThru: String(posting.pickupThru), deliveryThru: String(posting.deliveryThru || ''),
        weight: Number(posting.weight) || 0
      }
    };
    const index = queue.findIndex(existing => `${existing.customer}|${existing.loadId}` === key);
    if (index >= 0) queue[index] = entry; else queue.push(entry);
  });
  writeAssignQueue(queue);
  return queue.length;
}

// Finished assignments for the TMS to show: { customer, loadId, truck, ok, message, at }.
function reportAssignResult(result) {
  start();
  updateResults(results => ({ ...results, assign: [...results.assign, { ...result, at: Date.now() }].slice(-50) }));
}

// ---------- Paramount tracking (Clarity) ----------
// POST /tracking -> { loads: [{ key, customer, loadId, truck, pickupCity, pickupState }] }
// replaces the list of booked loads the bot looks up in Clarity (see clarity.js); the
// results come back through GET /status (trackingResults, newest per load).
const TRACKING_WATCH_FILE = process.env.TRACKING_WATCH_FILE || path.join(__dirname, 'tracking-watch.json');

// Freight bills from Daniel's recent "BCO Load Detail" emails (the TMS reads them from Gmail).
const TRACKING_BILLS_FILE = process.env.TRACKING_BILLS_FILE || path.join(__dirname, 'tracking-bills.json');

function readTrackingBills() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TRACKING_BILLS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed.map(String).filter(bill => /^\d{5,}$/.test(bill)).slice(0, 30) : [];
  } catch {
    return [];
  }
}

// Freight bills the helper found more than one MercuryGate route for (duplicates).
// The TMS shows a banner for each until the extra route is deleted.
const DUPLICATE_BILLS_FILE = process.env.DUPLICATE_BILLS_FILE || path.join(__dirname, 'duplicate-bills.json');

function readDuplicateBills() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DUPLICATE_BILLS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function reportDuplicateBills(bills) {
  try { fs.writeFileSync(DUPLICATE_BILLS_FILE, JSON.stringify(bills || [], null, 1)); } catch { /* reported next round */ }
}

function readTrackingWatch() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TRACKING_WATCH_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setTrackingWatch(loads) {
  const list = (loads || [])
    .filter(item => item && String(item.truck || '').trim() && String(item.loadId || '').trim())
    .slice(0, 50)
    .map(item => ({
      key: String(item.key || `${item.customer}|${item.loadId}`), customer: String(item.customer || ''),
      loadId: String(item.loadId), truck: String(item.truck).trim(),
      pickupCity: String(item.pickupCity || ''), pickupState: String(item.pickupState || ''),
      billTo: ['rxo', 'any'].includes(item.billTo) ? item.billTo : 'paramount'
    }));
  fs.writeFileSync(TRACKING_WATCH_FILE, JSON.stringify(list, null, 1));
  const keys = new Set(list.map(item => item.key));
  updateResults(results => ({ ...results, tracking: Object.fromEntries(Object.entries(results.tracking).filter(([key]) => keys.has(key))) }));
  return list.length;
}

function reportTrackingResults(list) {
  start();
  updateResults(results => {
    const tracking = { ...results.tracking };
    (list || []).forEach(result => { tracking[result.key] = { ...result, at: Date.now() }; });
    return { ...results, tracking };
  });
}

// ---------- MercuryGate jobs (booked Paramount loads) ----------
// POST /mercurygate -> { jobs: [{ customer, loadId, freightBill, step: 'booked'|'pickedUp', mode: 'practice'|'save' }] }
// queued in mercurygate-queue.json; the bot runs them (mercurygate-job.js) and reports through
// GET /status (mercurygateResults). GET /shots/<name>.png serves the bot's screenshots of them.
const MG_QUEUE_FILE = process.env.MG_QUEUE_FILE || path.join(__dirname, 'mercurygate-queue.json');
const SHOTS_DIR = path.join(__dirname, 'mercurygate-shots');


function readMercuryGateQueue() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MG_QUEUE_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeMercuryGateQueue(queue) {
  fs.writeFileSync(MG_QUEUE_FILE, JSON.stringify(queue, null, 1));
}

// One entry per load + step; a newer request (e.g. practice -> save) replaces it.
function enqueueMercuryGate(jobs) {
  if (!automaticDispatchEnabled) throw new Error('Automatic dispatch is disabled. Finish dispatch manually after Assign Capacity.');
  const queue = readMercuryGateQueue();
  (jobs || []).forEach(job => {
    const loadId = String(job?.loadId || '').trim();
    const freightBill = String(job?.freightBill || '').trim();
    if (!/^\d{5,}$/.test(loadId) || !/^\d{5,}$/.test(freightBill)) return;
    const step = job.step === 'pickedUp' ? 'pickedUp' : 'booked';
    const entry = { customer: String(job.customer || ''), loadId, freightBill, step, mode: job.mode === 'save' ? 'save' : 'practice', attempts: 0 };
    const index = queue.findIndex(item => item.loadId === loadId && item.step === step);
    if (index >= 0) queue[index] = entry; else queue.push(entry);
  });
  writeMercuryGateQueue(queue);
  return queue.length;
}

function reportMercuryGateResult(result) {
  start();
  updateResults(results => ({ ...results, mercurygate: [...results.mercurygate, { ...result, at: Date.now() }].slice(-30) }));
}

function start() {
  // Test scripts set BOT_NO_STATUS=1 so they never show up as the bot in the TMS.
  if (server || process.env.BOT_NO_STATUS === '1' || IS_HELPER || IS_REMOVAL || IS_RATES) return;
  server = http.createServer((req, res) => {
    // The TMS page (localhost or its live site) calls this; the Private-Network
    // header lets Chrome allow a web page to reach this local address.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Cache-Control', 'no-store');
    const route = req.url.split('?')[0];
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'GET' && route === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const shared = readResults();
      const duplicates = readDuplicateBills();
      res.end(JSON.stringify({ ...status, ...(progress ? { progress } : {}), helper: readHelperStatus(), removal: readRemovalStatus(), rates: readRatesStatus(),
        postingRefresh: require('./refresh').readRefreshStatus(),
        coordination: { dedicatedRates: process.argv.includes('--dedicated-rates') },
        ...(shared.assign.length ? { assignResults: shared.assign } : {}),
        ...(Object.keys(shared.tracking).length ? { trackingResults: Object.values(shared.tracking) } : {}),
        ...(shared.mercurygate.length ? { mercurygateResults: shared.mercurygate } : {}),
        ...(duplicates.length ? { duplicateBills: duplicates } : {}) }));
      return;
    }
    if (req.method === 'GET' && route.startsWith('/shots/')) {
      const name = path.basename(decodeURIComponent(route.slice('/shots/'.length)));
      const file = path.join(SHOTS_DIR, name);
      if (!/^[\w.-]+\.png$/.test(name) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (req.method === 'POST' && route === '/mercurygate') {
      if (!automaticDispatchEnabled) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Automatic dispatch is disabled. Finish dispatch manually after Assign Capacity.' }));
        return;
      }
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > MAX_BODY) req.destroy();
      });
      req.on('end', () => {
        try {
          const jobs = (JSON.parse(body || '{}').jobs) || [];
          if (!Array.isArray(jobs)) throw new Error('jobs must be a list');
          const queued = enqueueMercuryGate(jobs);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, queued }));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
      return;
    }
    if (req.method === 'POST' && route === '/tracking') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > MAX_BODY) req.destroy();
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const loads = parsed.loads || [];
          if (!Array.isArray(loads)) throw new Error('loads must be a list');
          const watching = setTrackingWatch(loads);
          if (Array.isArray(parsed.candidateBills)) {
            fs.writeFileSync(TRACKING_BILLS_FILE, JSON.stringify(parsed.candidateBills.map(String).filter(bill => /^\d{5,}$/.test(bill)).slice(0, 30)));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, watching }));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
      return;
    }
    if (req.method === 'POST' && route === '/assign') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > MAX_BODY) req.destroy();
      });
      req.on('end', () => {
        try {
          const bookings = (JSON.parse(body || '{}').bookings) || [];
          if (!Array.isArray(bookings)) throw new Error('bookings must be a list');
          const queued = enqueueAssign(bookings);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, received: bookings.length, queued }));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
      return;
    }
    if (req.method === 'POST' && route === '/posting-maintenance') {
      const origin = req.headers.origin;
      if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Only the local TMS can update posting protection.' }));
        return;
      }
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > MAX_BODY) req.destroy();
      });
      req.on('end', () => {
        try {
          const count = require('./posting-maintenance').saveSnapshot(JSON.parse(body || '{}').loads);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, protected: count }));
        } catch (error) {
          console.error('Posting protection update failed:', error.message);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }
    if (req.method === 'POST' && route === '/unpost') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > MAX_BODY) req.destroy();
      });
      req.on('end', () => {
        try {
          const postings = (JSON.parse(body || '{}').postings) || [];
          if (!Array.isArray(postings)) throw new Error('postings must be a list');
          const queued = enqueue(postings);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, received: postings.length, queued }));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  // Another bot window already serving this address is fine; just skip.
  server.on('error', () => { server = null; });
  server.listen(PORT, '127.0.0.1');
  server.unref(); // never keeps the bot running by itself
}

function setStatus(state, message = '') {
  if (IS_RATES) {
    const rateState = state === 'logged-in' && /^(Rate-checking|Checking)/i.test(message) ? 'working' : state;
    const temp = `${RATES_STATUS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ state: rateState, message, at: Date.now(), pid: process.pid }));
    fs.renameSync(temp, RATES_STATUS_FILE);
    return;
  }
  if (IS_REMOVAL) {
    fs.writeFileSync(REMOVAL_STATUS_FILE, JSON.stringify({ state, message, at: Date.now(), pid: process.pid }));
    return;
  }
  if (IS_HELPER) {
    // openBoard() etc. report "signing-in"/"logged-in": that is the helper's own light.
    try { fs.writeFileSync(HELPER_STATUS_FILE, JSON.stringify({
      state, message, at: Date.now(), pid: process.pid, dedicatedRates: process.argv.includes('--dedicated-rates')
    })); } catch { /* next time */ }
    return;
  }
  start();
  if (status.state !== state || status.message !== message) status = { state, message, since: Date.now() };
}

function setProgress(next) {
  start();
  progress = next ? { uploaded: Number(next.uploaded) || 0, waiting: Number(next.waiting) || 0 } : null;
}

module.exports = {
  readRatesStatus, RATES_STATUS_FILE,
  readRemovalStatus, removalActive, REMOVAL_STATUS_FILE,
  readHelperStatus, helperActive, HELPER_STATUS_FILE, readResults,
  setStatus, setProgress, PORT, readQueue, writeQueue, enqueue, QUEUE_FILE,
  readAssignQueue, writeAssignQueue, enqueueAssign, reportAssignResult, ASSIGN_QUEUE_FILE,
  readTrackingWatch, setTrackingWatch, reportTrackingResults, TRACKING_WATCH_FILE, readTrackingBills,
  readDuplicateBills, reportDuplicateBills,
  readMercuryGateQueue, writeMercuryGateQueue, enqueueMercuryGate, reportMercuryGateResult
};
