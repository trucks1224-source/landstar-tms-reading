// Assigns capacity on Landstar for loads booked in the TMS.
//
// When a load is booked in the TMS, its truck number and exported posting details come
// here (status-server.js -> assign-queue.json). The bot finds the load's posting on the
// board (same match as unpost.js: ZIPs, pickup end, delivery end, weight), opens Landstar's
// Assign Capacity page for it, picks BCO, searches the tractor number, selects the one BCO
// with exactly that tractor number and clicks Assign. It uses Landstar's own form, so all of
// Landstar's checks still apply: if Landstar shows a warning or says the truck can't be
// assigned, the bot stops there (nothing is confirmed) and reports it to the TMS.
//
//   node assign.js     <- process the queue once by hand (stop the bot first)

const path = require('path');
const { openBoard, OWN_POSTING_CODES } = require('./rate-check');
const { listPostings, cancelPostings } = require('./dedupe');
const { findMatchingPostings, statesFor } = require('./unpost');
const { readAssignQueue, writeAssignQueue, reportAssignResult, setStatus } = require('./status-server');

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

const clean = text => String(text || '').replace(/\s+/g, ' ').trim();

// Fills Landstar's Assign Capacity form for one posting. Returns { ok, message, retry }.
async function assignOnLandstar(context, landstarLoadId, truck, log) {
  const page = await context.newPage();
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
    const exact = texts.map((text, index) => ({ text, index })).filter(o => isTractorOption(o.text, truck));
    if (exact.length !== 1) {
      return { ok: false, retry: false, message: exact.length ? `${exact.length} BCOs have tractor ${truck}; assign it by hand` : `no BCO found with tractor ${truck}` };
    }
    const choice = clean(texts[exact[0].index]);
    await options.nth(exact[0].index).click();
    const assign = page.locator('button.agp-assgn-cap-assign');
    await page.waitForFunction(() => {
      const button = document.querySelector('button.agp-assgn-cap-assign');
      return button && !button.disabled;
    }, null, { timeout: 15000 });

    const assigned = page.waitForResponse(r => /assign-capacity(\?|$)/.test(r.url()) && r.request().method() === 'POST', { timeout: 45000 })
      .then(r => ({ kind: 'response', status: r.status(), body: r.text().catch(() => '') }));
    const stopped = page.locator(STOP_DIALOGS).first().waitFor({ state: 'visible', timeout: 45000 })
      .then(() => ({ kind: 'dialog' }));
    await assign.click();
    const outcome = await Promise.race([assigned, stopped]).catch(error => ({ kind: 'timeout', error }));

    if (outcome.kind === 'dialog') {
      const text = clean(await page.locator(STOP_DIALOGS).first().innerText().catch(() => ''));
      return { ok: false, retry: false, message: `Landstar stopped the assignment: ${text.slice(0, 300) || 'warning dialog'}` };
    }
    if (outcome.kind !== 'response') return { ok: false, retry: true, message: 'Landstar did not answer the assignment' };
    if (outcome.status >= 400) {
      const body = clean(await outcome.body);
      return { ok: false, retry: false, message: `Landstar refused the assignment (HTTP ${outcome.status}): ${body.slice(0, 300)}` };
    }
    await page.waitForTimeout(3000);
    log(`  Assigned ${choice} to Landstar load #${landstarLoadId}`);
    return { ok: true, message: `Assigned ${choice} to Landstar load #${landstarLoadId}` };
  } catch (error) {
    return { ok: false, retry: true, message: error.message };
  } finally {
    await page.close().catch(() => {});
  }
}

// Assigns every queued booking it can; returns how many were assigned.
async function processAssignQueue(context, { log = console.log } = {}) {
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
    const matches = findMatchingPostings(postings, item.posting);
    const posting = pickPosting(matches);
    let result;
    if (!posting) {
      result = { ok: false, retry: true, message: 'its Landstar posting was not found on the board' };
    } else {
      setStatus('logged-in', `Assigning truck ${item.truck} to load ${item.loadId}`);
      result = await assignOnLandstar(context, posting.LoadId, item.truck, log);
      if (result.ok) {
        assignedCount += 1;
        // Other copies of the same load would stay posted for a covered load: remove them.
        const others = matches.filter(m => m.LoadId !== posting.LoadId).map(m => m.LoadId);
        if (others.length) await cancelPostings(boardPage, others, log).catch(error => log(`  ! Could not remove ${others.length} older copies: ${error.message}`));
      }
    }
    const attempts = (item.attempts || 0) + 1;
    const finished = result.ok || !result.retry || attempts >= MAX_ATTEMPTS;
    done.set(key, finished ? 'done' : 'retry');
    log(`  ${item.customer} #${item.loadId} (truck ${item.truck}): ${result.ok ? 'assigned' : `NOT assigned - ${result.message}`}${!finished ? ' (will retry)' : ''}`);
    if (finished) {
      reportAssignResult({
        customer: item.customer, loadId: item.loadId, truck: item.truck, ok: result.ok,
        landstarLoadId: posting?.LoadId ? String(posting.LoadId) : '', message: result.message
      });
    }
  }

  // Re-read: the TMS may have added more while this ran.
  const remaining = readAssignQueue().flatMap(item => {
    const state = done.get(`${item.customer}|${item.loadId}`);
    if (state === 'done') return [];
    if (state === 'retry') return [{ ...item, attempts: (item.attempts || 0) + 1 }];
    return [item];
  });
  writeAssignQueue(remaining);
  return assignedCount;
}

module.exports = { processAssignQueue, assignOnLandstar, isTractorOption, pickPosting };

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
