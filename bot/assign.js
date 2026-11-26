// Assigns capacity on Landstar for loads booked in the TMS.
//
// When a load is booked in the TMS, its truck number and exported posting details come
// here (status-server.js -> assign-queue.json). The bot finds the load's posting on the
// board (same match as unpost.js: ZIPs, pickup end, delivery end, weight), opens Landstar's
// Assign Capacity page for it, picks BCO, searches the tractor number, selects a BCO
// with exactly that tractor number and clicks Assign. It uses Landstar's own form, so all of
// Landstar's checks still apply: if Landstar shows a warning or says the truck can't be
// assigned, the bot stops there (nothing is confirmed) and reports it to the TMS.
//
//   node assign.js     <- process the queue once by hand (stop the bot first)

const path = require('path');
const fs = require('fs');
const { createHash } = require('crypto');
const { openBoard, OWN_POSTING_CODES } = require('./rate-check');
const { listPostings, cancelPostings } = require('./dedupe');
const { findMatchingPostings, statesFor } = require('./unpost');
const { isBotPosting, uploadedSignatures } = require('./bot-postings');
const { readAssignQueue, writeAssignQueue, reportAssignResult, setStatus, ASSIGN_QUEUE_FILE } = require('./status-server');

function claimAssignQueue() {
  const file = `${ASSIGN_QUEUE_FILE}.lock`;
  try {
    fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = Number(fs.readFileSync(file, 'utf8'));
    if (!Number.isInteger(owner) || owner <= 0) throw new Error('Invalid assignment lock; manual review required.');
    try { process.kill(owner, 0); } catch (processError) {
      if (processError.code !== 'ESRCH') throw processError;
      // The worker died. If it never reserved an assignment (that happens right before the
      // Assign click), it never clicked Assign, so the lock is safe to take over.
      if (attemptedSince(fs.statSync(file).mtimeMs)) {
        throw new Error('Assignment worker stopped during processing. Check Landstar before manually clearing the assignment lock.');
      }
      fs.unlinkSync(file);
      return claimAssignQueue();
    }
    return null;
  }
  return () => fs.unlinkSync(file);
}

// True when an assignment reservation was written at or after `sinceMs` (a 2 s margin
// covers coarse file timestamps).
function attemptedSince(sinceMs) {
  const directory = `${ASSIGN_QUEUE_FILE}.attempts`;
  let names = [];
  try { names = fs.readdirSync(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return names.some(name => fs.statSync(path.join(directory, name)).mtimeMs >= sinceMs - 2000);
}

// Never clear automatically: a timeout or crash after Assign may still create a freight bill.
function reserveAssignment(landstarLoadId, truck, loadId) {
  if (!/^\d+$/.test(String(landstarLoadId))) throw new Error('Invalid Landstar posting number.');
  const directory = `${ASSIGN_QUEUE_FILE}.attempts`;
  fs.mkdirSync(directory, { recursive: true });
  try {
    const record = JSON.stringify({ landstarLoadId, truck, loadId, at: new Date().toISOString() });
    if (loadId) {
      const key = createHash('sha256').update(String(loadId).trim()).digest('hex');
      fs.writeFileSync(path.join(directory, `order-${key}.json`), record, { flag: 'wx' });
    }
    fs.writeFileSync(path.join(directory, `${landstarLoadId}.json`), record, { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return false;
  }
}

const ASSIGN_URL = (loadId, scac = 'LRGR') => `https://portal.landstaronline.com/agent/assign-capacity/PORTAL/${loadId}/${scac}`;
const MAX_ATTEMPTS = 3;
// Landstar dialogs that need a person: not qualified, or tractor/trailer warnings.
const STOP_DIALOGS = 'agent-assign-capacity-disqualified-dlg, agent-tractor-assign-warning-dialog, agent-trailer-assign-warning-dialog';

const postedAt = load => Number(String(load.OrderDate || '').match(/-?\d+/)?.[0] || 0);

// The newest posting of the load (older copies are removed after the assignment).
function pickPosting(matches) {
  return [...matches].sort((a, b) => postedAt(b) - postedAt(a) || Number(b.LoadId) - Number(a.LoadId))[0] || null;
}

// The BCO search's options look like "420371 - LDWY / Rocway Xpress LLC": only an option
// whose tractor number is exactly the truck counts.
function isTractorOption(optionText, truck) {
  const first = String(optionText || '').trim().split(/\s*\n\s*|\s{2,}/)[0];
  const number = first.split(/\s+-\s+/)[0].trim();
  return number.replace(/^0+/, '') === String(truck || '').trim().replace(/^0+/, '');
}

function findTractorOption(texts, truck) {
  return texts.findIndex(text => isTractorOption(text, truck));
}

const clean = text => String(text || '').replace(/\s+/g, ' ').trim();

// After an Assign click Landstar did not confirm: read the posting's portal record and decide.
// Never clicks anything. Returns { state: 'assigned' | 'probably' | 'available' | 'unknown', detail }.
//  - 'assigned': the record names this tractor in an assignment/capacity field
//  - 'probably': the record is gone (404) or its status is no longer Available
//  - 'available': the record still says Available (Landstar did not take it)
function judgeAssignCheck(check, truck) {
  if (!check) return { state: 'unknown', detail: 'no answer from Landstar' };
  if (check.httpStatus === 404 || check.httpStatus === 410) return { state: 'probably', detail: 'the posting is no longer on the board' };
  if (check.httpStatus >= 400 || !check.httpStatus) return { state: 'unknown', detail: 'Landstar returned HTTP ' + check.httpStatus };
  let record;
  try { record = JSON.parse(check.body); } catch { return { state: 'unknown', detail: 'unreadable answer from Landstar' }; }
  const want = String(truck || '').trim().replace(/^0+/, '');
  const statuses = [];
  let tractorFound = false;
  (function walk(value, key) {
    if (Array.isArray(value)) return value.forEach(item => walk(item, key));
    if (value && typeof value === 'object') return Object.entries(value).forEach(([k, v]) => walk(v, k));
    if (typeof value !== 'string' && typeof value !== 'number') return;
    const text = String(value).trim();
    if (/status/i.test(key || '') && typeof value === 'string' && text) statuses.push(text);
    if (want && /tractor|bco|truck/i.test(key || '') && text.split(/[\s\-\/]+/)[0].replace(/^0+/, '') === want) tractorFound = true;
  })(record, '');
  if (tractorFound) return { state: 'assigned', detail: 'Landstar lists tractor ' + truck + ' on it' };
  if (statuses.some(s => /^avail/i.test(s))) return { state: 'available', detail: 'Landstar still lists it as Available' };
  if (statuses.length) return { state: 'probably', detail: 'its Landstar status is now "' + statuses[0] + '"' };
  return { state: 'unknown', detail: 'no status in the Landstar record' };
}

// Reads the posting's portal record from the (signed-in) assign page and saves it to logs/.
async function readPostingRecord(page, landstarLoadId) {
  const check = await page.evaluate(async id => {
    let token = null;
    for (const store of [sessionStorage, localStorage]) {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (/oidc\.user/i.test(key)) { try { token = JSON.parse(store.getItem(key)).access_token || token; } catch { /* next */ } }
      }
    }
    if (!token) return null;
    const r = await fetch('/loadboards/v1/availableLoad/agent/PORTAL/' + id, { headers: { Authorization: 'Bearer ' + token } });
    return { httpStatus: r.status, body: await r.text() };
  }, String(landstarLoadId)).catch(() => null);
  try {
    fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'logs', 'assign-check-' + landstarLoadId + '.json'), JSON.stringify(check, null, 1));
  } catch { /* the check still counts */ }
  return check;
}

// Turns an unconfirmed Assign into a result after checking Landstar (never retries the click).
async function checkUnconfirmedAssign(page, landstarLoadId, truck, choice, log, fallbackMessage, wait = 20000) {
  await page.waitForTimeout(wait).catch(() => {});
  const verdict = judgeAssignCheck(await readPostingRecord(page, landstarLoadId), truck);
  log('  Assign not confirmed by Landstar; checked load #' + landstarLoadId + ': ' + verdict.detail);
  if (verdict.state === 'assigned') {
    return { ok: true, message: 'Assigned ' + (choice || 'truck ' + truck) + ' to Landstar load #' + landstarLoadId + ' (confirmed on the board)' };
  }
  if (verdict.state === 'probably') {
    return { ok: false, retry: false, unconfirmed: true, message: 'Truck ' + truck + ' was probably assigned to Landstar load #' + landstarLoadId + ': ' + verdict.detail + '. Check its freight bill; do not assign it again' };
  }
  if (verdict.state === 'available') {
    return { ok: false, retry: false, unconfirmed: true, message: 'Landstar did not take the assignment of truck ' + truck + ' to load #' + landstarLoadId + ' (' + verdict.detail + '). Check that load on Landstar, then assign it by hand' };
  }
  return { ok: false, retry: false, unconfirmed: true, message: fallbackMessage + ' (' + verdict.detail + ')' };
}

// Fills Landstar's Assign Capacity form for one posting. Returns { ok, message, retry }.
async function assignOnLandstar(context, landstarLoadId, truck, log, loadId) {
  const page = await context.newPage();
  // Once Assign is clicked, Landstar may have assigned the truck even if it never confirms:
  // from then on the bot never retries (a retry would assign the truck to another copy of the
  // same load - this happened on 11/06 and put one driver on three copies).
  let clicked = false;
  try {
    await page.goto(ASSIGN_URL(landstarLoadId), { waitUntil: 'domcontentloaded' });
    const search = page.locator('agent-tractor-typeahead input, input[placeholder*="Tractor Number"]').first();
    await search.waitFor({ state: 'visible', timeout: 60000 });
    // BCO is the first capacity type (and the default).
    const bco = page.locator('input[formcontrolname="capacityType"]').first();
    if (!(await bco.isChecked().catch(() => false))) await bco.check();
    await search.click();
    await search.fill('');
    const searched = page.waitForResponse(r => /\/bco-search/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 }).catch(() => null);
    await search.pressSequentially(String(truck), { delay: 80 });
    await searched;
    const options = page.locator('[role="option"]');
    await options.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const texts = await options.allInnerTexts();
    const index = findTractorOption(texts, truck);
    if (index < 0) {
      return { ok: false, retry: false, message: `no BCO found with tractor ${truck}` };
    }
    const choice = clean(texts[index]);
    await options.nth(index).click();
    const assign = page.locator('button.agp-assgn-cap-assign');
    await page.waitForFunction(() => {
      const button = document.querySelector('button.agp-assgn-cap-assign');
      return button && !button.disabled;
    }, null, { timeout: 15000 });

    if (!reserveAssignment(landstarLoadId, truck, loadId)) {
      return { ok: false, retry: false, unconfirmed: true, message: `An assignment was already attempted for Landstar load #${landstarLoadId}. Check its freight bill before any manual retry.` };
    }
    const assigned = page.waitForResponse(r => /assign-capacity(\?|$)/.test(r.url()) && r.request().method() === 'POST', { timeout: 45000 })
      .then(r => ({ kind: 'response', status: r.status(), body: r.text().catch(() => '') }));
    const stopped = page.locator(STOP_DIALOGS).first().waitFor({ state: 'visible', timeout: 45000 })
      .then(() => ({ kind: 'dialog' }));
    clicked = true;
    await assign.click();
    const outcome = await Promise.race([assigned, stopped]).catch(error => ({ kind: 'timeout', error }));

    if (outcome.kind === 'dialog') {
      const text = clean(await page.locator(STOP_DIALOGS).first().innerText().catch(() => ''));
      return { ok: false, retry: false, message: `Landstar stopped the assignment: ${text.slice(0, 300) || 'warning dialog'}` };
    }
    if (outcome.kind !== 'response') {
      return await checkUnconfirmedAssign(page, landstarLoadId, truck, choice, log,
        `Landstar did not confirm the assignment of truck ${truck} to load #${landstarLoadId}. It may have gone through: check that load on Landstar before assigning it again`);
    }
    if (outcome.status >= 400) {
      const body = clean(await outcome.body);
      return { ok: false, retry: false, message: `Landstar refused the assignment (HTTP ${outcome.status}): ${body.slice(0, 300)}` };
    }
    await page.waitForTimeout(3000);
    log(`  Assigned ${choice} to Landstar load #${landstarLoadId}`);
    return { ok: true, message: `Assigned ${choice} to Landstar load #${landstarLoadId}` };
  } catch (error) {
    if (clicked) {
      return await checkUnconfirmedAssign(page, landstarLoadId, truck, '', log,
        `Something went wrong after clicking Assign for truck ${truck} on load #${landstarLoadId} (${error.message}). Check that load on Landstar before assigning it again`)
        .catch(() => ({ ok: false, retry: false, unconfirmed: true, message: `Something went wrong after clicking Assign for truck ${truck} on load #${landstarLoadId} (${error.message}). Check that load on Landstar before assigning it again` }));
    }
    return { ok: false, retry: true, message: error.message };
  } finally {
    await page.close().catch(() => {});
  }
}

// Approved carrier (AMERI 18347- ATZ, Daniel 2026-11-25): Capacity type Carrier, "Find a Carrier"
// searched by the MC number. Landstar's results show the carrier's code, city and name, not the MC
// ("CP*6022 - Toast, NC / Dude Smith Trucking LLC - Qualified"), so the bot only picks a result when
// the search returns exactly one carrier and it is Qualified. Carrier Mode stays TL; Pay Capacity
// (optional) is left blank.
function pickCarrierOption(texts) {
  const options = texts.map(clean).filter(Boolean);
  if (options.length === 0) return { index: -1, reason: 'no carrier found' };
  if (options.length > 1) return { index: -1, reason: `${options.length} carriers matched (${options.slice(0, 3).join(' | ')}); assign it by hand` };
  if (!/\bqualified\b/i.test(options[0]) || /\b(not|un|dis)\s*-?qualified\b/i.test(options[0])) {
    return { index: -1, reason: `the carrier is not Qualified on Landstar (${options[0]})` };
  }
  return { index: 0, reason: '' };
}

async function assignCarrierOnLandstar(context, landstarLoadId, mc, log, loadId) {
  const page = await context.newPage();
  const label = `carrier MC ${mc}`;
  let clicked = false;
  try {
    await page.goto(ASSIGN_URL(landstarLoadId), { waitUntil: 'domcontentloaded' });
    const radios = page.locator('input[formcontrolname="capacityType"]');
    await radios.first().waitFor({ state: 'attached', timeout: 60000 });
    // Carrier is the second capacity type (BCO first).
    const carrier = radios.nth(1);
    if (!(await carrier.isChecked().catch(() => false))) await carrier.check({ force: true });
    const search = page.locator('input[placeholder*="Carrier Name"], input[placeholder*="Carrier Number"]').first();
    await search.waitFor({ state: 'visible', timeout: 30000 });
    await search.click();
    await search.fill('');
    await search.pressSequentially(String(mc), { delay: 80 });
    const options = page.locator('[role="option"]');
    await options.first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500); // let the result list settle
    const texts = await options.allInnerTexts();
    const pick = pickCarrierOption(texts);
    if (pick.index < 0) return { ok: false, retry: false, message: `MC ${mc}: ${pick.reason}` };
    const choice = clean(texts[pick.index]);
    await options.nth(pick.index).click();
    const assign = page.locator('button.agp-assgn-cap-assign');
    await page.waitForFunction(() => {
      const button = document.querySelector('button.agp-assgn-cap-assign');
      return button && !button.disabled;
    }, null, { timeout: 15000 });

    if (!reserveAssignment(landstarLoadId, `MC ${mc}`, loadId)) {
      return { ok: false, retry: false, unconfirmed: true, message: `An assignment was already attempted for Landstar load #${landstarLoadId}. Check its freight bill before any manual retry.` };
    }
    const assigned = page.waitForResponse(r => /assign-capacity(\?|$)/.test(r.url()) && r.request().method() === 'POST', { timeout: 45000 })
      .then(r => ({ kind: 'response', status: r.status(), body: r.text().catch(() => '') }));
    const stopped = page.locator(STOP_DIALOGS).first().waitFor({ state: 'visible', timeout: 45000 })
      .then(() => ({ kind: 'dialog' }));
    clicked = true;
    await assign.click();
    const outcome = await Promise.race([assigned, stopped]).catch(error => ({ kind: 'timeout', error }));
    if (outcome.kind === 'dialog') {
      const text = clean(await page.locator(STOP_DIALOGS).first().innerText().catch(() => ''));
      return { ok: false, retry: false, message: `Landstar stopped the assignment: ${text.slice(0, 300) || 'warning dialog'}` };
    }
    if (outcome.kind !== 'response') {
      return await checkUnconfirmedAssign(page, landstarLoadId, `MC ${mc}`, choice, log,
        `Landstar did not confirm the assignment of ${label} to load #${landstarLoadId}. It may have gone through: check that load on Landstar before assigning it again`);
    }
    if (outcome.status >= 400) {
      const body = clean(await outcome.body);
      return { ok: false, retry: false, message: `Landstar refused the assignment (HTTP ${outcome.status}): ${body.slice(0, 300)}` };
    }
    await page.waitForTimeout(3000);
    log(`  Assigned ${choice} (MC ${mc}) to Landstar load #${landstarLoadId}`);
    return { ok: true, message: `Assigned ${choice} (MC ${mc}) to Landstar load #${landstarLoadId}` };
  } catch (error) {
    if (clicked) {
      return { ok: false, retry: false, unconfirmed: true, message: `Something went wrong after clicking Assign for ${label} on load #${landstarLoadId} (${error.message}). Check that load on Landstar before assigning it again` };
    }
    return { ok: false, retry: true, message: error.message };
  } finally {
    await page.close().catch(() => {});
  }
}

// Assigns every queued booking it can; returns how many were assigned.
async function processAssignQueue(context, { log = console.log } = {}) {
  const release = claimAssignQueue();
  if (!release) return 0;
  try {
    return await processClaimedAssignQueue(context, { log });
  } finally {
    release();
  }
}

async function processClaimedAssignQueue(context, { log }) {
  const queue = readAssignQueue();
  if (!queue.length) return 0;
  setStatus('logged-in', `Assigning capacity on ${queue.length} booked load(s)`);
  log(`Assigning capacity on Landstar for ${queue.length} booked load(s)...`);
  const boardPage = await openBoard(context, log);
  const postings = await listPostings(boardPage, OWN_POSTING_CODES, log, statesFor(queue));

  let assignedCount = 0;
  const done = new Map(); // customer|loadId -> 'done' | 'retry'
  for (const item of queue) {
    const key = `${item.customer}|${item.loadId}`;
    const candidates = findMatchingPostings(postings, item.posting);
    const signatures = item.recoverPosting ? uploadedSignatures() : null;
    const matches = item.recoverPosting ? candidates.filter(load => isBotPosting(load, signatures)) : candidates;
    const posting = pickPosting(matches);
    let result;
    if (!posting) {
      result = { ok: false, retry: true, message: item.recoverPosting
        ? 'no matching bot-uploaded posting was verified using ZIPs, pickup/delivery times and weight'
        : 'its Landstar posting was not found on the board' };
    } else {
      const capacity = item.carrierMc ? `carrier MC ${item.carrierMc}` : `truck ${item.truck}`;
      setStatus('logged-in', `Assigning ${capacity} to load ${item.loadId}`);
      result = item.carrierMc
        ? await assignCarrierOnLandstar(context, posting.LoadId, item.carrierMc, log, item.loadId)
        : await assignOnLandstar(context, posting.LoadId, item.truck, log, item.loadId);
      if (result.ok) {
        assignedCount += 1;
        // Other copies of the same load would stay posted for a covered load: remove them.
        const others = matches.filter(m => m.LoadId !== posting.LoadId).map(m => m.LoadId);
        if (others.length) await cancelPostings(boardPage, others, log).catch(error => log(`  ! Could not remove ${others.length} older copies: ${error.message}`));
      }
    }
    const attempts = (item.attempts || 0) + 1;
    const finished = result.ok || !result.retry || attempts >= MAX_ATTEMPTS;
    done.set(key, { request: JSON.stringify(item), state: finished ? 'done' : 'retry' });
    log(`  ${item.customer} #${item.loadId} (${item.carrierMc ? `carrier MC ${item.carrierMc}` : `truck ${item.truck}`}): ${result.ok ? 'assigned' : `NOT assigned - ${result.message}`}${!finished ? ' (will retry)' : ''}`);
    if (finished) {
      reportAssignResult({
        customer: item.customer, loadId: item.loadId, truck: item.truck || '', ...(item.carrierMc ? { carrierMc: item.carrierMc } : {}), ok: result.ok,
        ...(result.ok ? { posting: item.posting } : {}),
        landstarLoadId: posting?.LoadId ? String(posting.LoadId) : '', message: result.message, unconfirmed: Boolean(result.unconfirmed)
      });
    }
  }

  // Re-read: the TMS may have added more while this ran.
  const remaining = reconcileAssignQueue(readAssignQueue(), done);
  writeAssignQueue(remaining);
  return assignedCount;
}

function reconcileAssignQueue(queue, done) {
  return queue.flatMap(item => {
    const processed = done.get(`${item.customer}|${item.loadId}`);
    if (!processed || processed.request !== JSON.stringify(item)) return [item];
    if (processed.state === 'done') return [];
    return [{ ...item, attempts: (item.attempts || 0) + 1 }];
  });
}

module.exports = { processAssignQueue, assignOnLandstar, assignCarrierOnLandstar, pickCarrierOption, isTractorOption, findTractorOption, pickPosting, claimAssignQueue, reserveAssignment, reconcileAssignQueue, judgeAssignCheck, checkUnconfirmedAssign };

if (require.main === module) {
  const { chromium } = require('playwright');
  (async () => {
    const context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
    try {
      await processAssignQueue(context);
    } finally {
      await context.close();
    }
  })().catch(error => { console.error('Assigning capacity failed:', error.message); process.exit(1); });
}
