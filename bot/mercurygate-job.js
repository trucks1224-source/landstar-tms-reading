// One MercuryGate job for a booked Paramount load (see mercurygate.js for the screens):
//   step "booked":    Customer Reference Number, pickup + drop stops from the rate
//                     confirmation, and the special instructions (tracking notice).
//   step "pickedUp":  upload the rate confirmation PDF as a Customer Confirmation Sheet.
// dryRun = practice: every form is filled and photographed, then cancelled.
//
//   node mercurygate-job.js <order#> <freightBill> [booked|pickedUp] [--save]   (stop the bot first)

const { automaticDispatchEnabled: AUTOMATIC_DISPATCH_ENABLED } = require('./automation-policy.json');
const { openMercuryGate, openLoadWindow, closeLeftoverWindow, addCustomerReference, fillStop, addSpecialInstructions, uploadConfirmation } = require('./mercurygate');
const { readRateConfirmation, downloadRateCon } = require('./ratecon');

// Daniel's special instructions for Paramount loads (2026-11-06).
const PARAMOUNT_NOTES = '***Please use the trucker tools link they will send you via text. Customers will charge back $100 '
  + 'if the tracking app is not used. The tracking app must be set to always track. The tracking app must be used on the '
  + 'entire trip. Please let me know if you have any issues. Please don\'t leave the shipper unless you\'re using the tracking '
  + 'tool app. Please let me know immediately if the link was not sent to you. The customer also requires POD within 2 '
  + 'hours of delivery. Thank you!';

// onStepDone(name): a step that saved for real (so a retry doesn't save it twice).
async function runMercuryGateJob(context, job, { dryRun = true, log = console.log, onStepDone = () => {} } = {}) {
  if (!AUTOMATIC_DISPATCH_ENABLED) throw new Error('Automatic dispatch is disabled. Assign capacity on Landstar only; finish dispatch manually.');
  const done = new Set(job.done || []);
  const step = async (name, run) => {
    if (done.has(name)) return { skipped: true, message: `${name}: already saved on an earlier try` };
    const result = await run();
    if (!dryRun && !result.skipped) onStepDone(name);
    return result;
  };
  const order = String(job.loadId);
  const results = [];
  const page = await context.newPage();
  try {
    if (job.step === 'pickedUp') {
      const pdfFile = await downloadRateCon(order);
      await openMercuryGate(page, log);
      const loadPage = await openLoadWindow(context, page, job.freightBill);
      try {
        results.push(await uploadConfirmation(loadPage, pdfFile, { dryRun, shotName: `${order}-upload` }));
      } finally {
        await loadPage.close().catch(() => {});
      }
      return { ok: true, results };
    }
    log(`  MercuryGate: reading the rate confirmation for order ${order}...`);
    const rateCon = await readRateConfirmation(context, order);
    if (rateCon.error) return { ok: false, message: rateCon.error, results };
    await openMercuryGate(page, log);
    const loadPage = await openLoadWindow(context, page, job.freightBill);
    // One step failing (e.g. MercuryGate can't find a stop's ZIP) doesn't stop the others;
    // its window is closed so the next step can click, and the job reports what failed.
    const failed = [];
    const tryStep = async (name, run) => {
      try {
        results.push(await step(name, run));
      } catch (error) {
        if (/not signed in|HTTP 5\d\d|Internal Server Error|JDBC|net::ERR|ECONNRESET|Target (page|closed)/i.test(error.message)) throw error;
        failed.push(`${name}: ${error.message.split('\n')[0]}`);
        results.push({ message: `${name} failed: ${error.message.split('\n')[0]}` });
        await closeLeftoverWindow(loadPage).catch(() => {});
      }
    };
    try {
      await tryStep('reference', () => addCustomerReference(loadPage, order, { dryRun, shotName: `${order}-reference` }));
      await tryStep('pickup', () => fillStop(loadPage, 0, rateCon.pickup, { dryRun, shotName: `${order}-pickup` }));
      await tryStep('drop', () => fillStop(loadPage, 1, rateCon.drop, { dryRun, shotName: `${order}-drop` }));
      await tryStep('notes', () => addSpecialInstructions(loadPage, PARAMOUNT_NOTES, { dryRun, shotName: `${order}-notes` }));
    } finally {
      await loadPage.close().catch(() => {});
    }
    const rateConSummary = { order: rateCon.order, bol: rateCon.bol, reference: rateCon.reference, pickup: rateCon.pickup, drop: rateCon.drop };
    if (failed.length) return { ok: false, message: `Not finished in MercuryGate - ${failed.join('; ')}`, rateCon: rateConSummary, results };
    return { ok: true, rateCon: rateConSummary, results };
  } finally {
    await page.close().catch(() => {});
  }
}

// Runs the first queued job (status-server's mercurygate-queue.json) and reports the result.
async function runNextMercuryGateJob(context, log = console.log) {
  if (!AUTOMATIC_DISPATCH_ENABLED) return;
  const { readMercuryGateQueue, writeMercuryGateQueue, reportMercuryGateResult } = require('./status-server');
  // Jobs waiting for a retry (MercuryGate down) are skipped until their time comes.
  const job = readMercuryGateQueue().find(item => !item.nextAt || item.nextAt <= Date.now());
  if (!job) return;
  const key = `${job.loadId}|${job.step}`;
  let outcome;
  try {
    // Remember each saved step on the queued job, so a retry skips it (no duplicate references).
    const onStepDone = name => {
      const queue = readMercuryGateQueue();
      const entry = queue.find(item => `${item.loadId}|${item.step}` === key && item.mode === job.mode);
      if (entry) entry.done = [...new Set([...(entry.done || []), name])];
      job.done = [...new Set([...(job.done || []), name])];
      writeMercuryGateQueue(queue);
    };
    outcome = await runMercuryGateJob(context, job, { dryRun: job.mode !== 'save', log, onStepDone });
  } catch (error) {
    outcome = { ok: false, message: error.message, results: [] };
  }
  const left = readMercuryGateQueue().filter(item => `${item.loadId}|${item.step}` !== key || item.mode !== job.mode);
  // MercuryGate down or not signing in: try again every 10 minutes for about 2 hours.
  // Anything else (e.g. a form that didn't open): one more try right away.
  const attempts = (job.attempts || 0) + 1;
  // Only MercuryGate being down/unreachable is retried for a while; a form problem is not.
  const outage = /not signed in|HTTP 5\d\d|Internal Server Error|JDBC|net::ERR|ECONNRESET/i.test(outcome.message || '');
  if (!outcome.ok && outage && attempts < 12) left.push({ ...job, attempts, nextAt: Date.now() + 10 * 60 * 1000 });
  else if (!outcome.ok && attempts < 2) left.push({ ...job, attempts });
  writeMercuryGateQueue(left);
  reportMercuryGateResult({
    customer: job.customer, loadId: job.loadId, freightBill: job.freightBill, step: job.step, mode: job.mode,
    ok: Boolean(outcome.ok), message: outcome.message || '', rateCon: outcome.rateCon || null,
    retrying: !outcome.ok && left.some(item => `${item.loadId}|${item.step}` === key && item.mode === job.mode),
    results: (outcome.results || []).map(item => ({ message: item.message, skipped: Boolean(item.skipped), shot: item.shot ? require('path').basename(item.shot) : '' }))
  });
  log(`  MercuryGate ${job.mode} for order ${job.loadId}: ${outcome.ok ? 'done' : `failed - ${outcome.message}`}`);
}

// A queued job that is due now (not waiting for a retry).
function hasDueMercuryGateJob() {
  if (!AUTOMATIC_DISPATCH_ENABLED) return false;
  const { readMercuryGateQueue } = require('./status-server');
  return readMercuryGateQueue().some(item => !item.nextAt || item.nextAt <= Date.now());
}

module.exports = { runMercuryGateJob, runNextMercuryGateJob, hasDueMercuryGateJob, PARAMOUNT_NOTES };

if (require.main === module) {
  (async () => {
    if (!AUTOMATIC_DISPATCH_ENABLED) throw new Error('Automatic dispatch is disabled. Finish dispatch manually after Assign Capacity.');
    const path = require('path');
    const { chromium } = require('playwright');
    const [order, freightBill, step = 'booked'] = process.argv.slice(2);
    const dryRun = !process.argv.includes('--save');
    const context = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
    await require('./rate-check').openBoard(context, console.log); // Landstar Online sign-in (MercuryGate rides on it)
    const outcome = await runMercuryGateJob(context, { loadId: order, freightBill, step }, { dryRun }).catch(async error => {
      console.log('  [error]', error.message);
      for (const [i, p] of context.pages().entries()) { console.log('  [page]', i, p.url()); await p.screenshot({ path: `mercurygate-shots/debug-${i}.png` }).catch(() => {}); }
      return { ok: false, message: error.message };
    });
    console.log(JSON.stringify(outcome, null, 1));
    console.log(dryRun ? 'Practice run: nothing was saved in MercuryGate.' : 'Saved in MercuryGate.');
    await context.close();
  })().catch(error => { console.error(error.message); process.exit(1); });
}
