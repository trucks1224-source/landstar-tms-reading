// One MercuryGate job for a booked Paramount load (see mercurygate.js for the screens):
//   step "booked":    Customer Reference Number, pickup + drop stops from the rate
//                     confirmation, and the special instructions (tracking notice).
//   step "pickedUp":  upload the rate confirmation PDF as a Customer Confirmation Sheet.
// dryRun = practice: every form is filled and photographed, then cancelled.
//
//   node mercurygate-job.js <order#> <freightBill> [booked|pickedUp] [--save]   (stop the bot first)

const { openMercuryGate, openLoadWindow, addCustomerReference, fillStop, addSpecialInstructions, uploadConfirmation } = require('./mercurygate');
const { readRateConfirmation, downloadRateCon } = require('./ratecon');

// Daniel's special instructions for Paramount loads (2026-11-06).
const PARAMOUNT_NOTES = '***Please use the trucker tools link they will send you via text. Customers will charge back $100 '
  + 'if the tracking app is not used. The tracking app must be set to always track. The tracking app must be used on the '
  + 'entire trip. Please let me know if you have any issues. Please don\'t leave the shipper unless you\'re using the tracking '
  + 'tool app. Please let me know immediately if the link was not sent to you. The customer also requires POD within 2 '
  + 'hours of delivery. Thank you!';

async function runMercuryGateJob(context, job, { dryRun = true, log = console.log } = {}) {
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
    try {
      results.push(await addCustomerReference(loadPage, order, { dryRun, shotName: `${order}-reference` }));
      results.push(await fillStop(loadPage, 0, rateCon.pickup, { dryRun, shotName: `${order}-pickup` }));
      results.push(await fillStop(loadPage, 1, rateCon.drop, { dryRun, shotName: `${order}-drop` }));
      results.push(await addSpecialInstructions(loadPage, PARAMOUNT_NOTES, { dryRun, shotName: `${order}-notes` }));
    } finally {
      await loadPage.close().catch(() => {});
    }
    return { ok: true, rateCon: { order: rateCon.order, bol: rateCon.bol, reference: rateCon.reference, pickup: rateCon.pickup, drop: rateCon.drop }, results };
  } finally {
    await page.close().catch(() => {});
  }
}

// Runs the first queued job (status-server's mercurygate-queue.json) and reports the result.
async function runNextMercuryGateJob(context, log = console.log) {
  const { readMercuryGateQueue, writeMercuryGateQueue, reportMercuryGateResult } = require('./status-server');
  // Jobs waiting for a retry (MercuryGate down) are skipped until their time comes.
  const job = readMercuryGateQueue().find(item => !item.nextAt || item.nextAt <= Date.now());
  if (!job) return;
  const key = `${job.loadId}|${job.step}`;
  let outcome;
  try {
    outcome = await runMercuryGateJob(context, job, { dryRun: job.mode !== 'save', log });
  } catch (error) {
    outcome = { ok: false, message: error.message, results: [] };
  }
  const left = readMercuryGateQueue().filter(item => `${item.loadId}|${item.step}` !== key || item.mode !== job.mode);
  // MercuryGate down or not signing in: try again every 10 minutes for about 2 hours.
  // Anything else (e.g. a form that didn't open): one more try right away.
  const attempts = (job.attempts || 0) + 1;
  const outage = /not signed in|HTTP 5dd|Internal Server Error|timed out|Timeout/i.test(outcome.message || '');
  if (!outcome.ok && outage && attempts < 12) left.push({ ...job, attempts, nextAt: Date.now() + 10 * 60 * 1000 });
  else if (!outcome.ok && attempts < 2) left.push({ ...job, attempts });
  writeMercuryGateQueue(left);
  reportMercuryGateResult({
    customer: job.customer, loadId: job.loadId, freightBill: job.freightBill, step: job.step, mode: job.mode,
    ok: Boolean(outcome.ok), message: outcome.message || '', rateCon: outcome.rateCon || null,
    results: (outcome.results || []).map(item => ({ message: item.message, skipped: Boolean(item.skipped), shot: item.shot ? require('path').basename(item.shot) : '' }))
  });
  log(`  MercuryGate ${job.mode} for order ${job.loadId}: ${outcome.ok ? 'done' : `failed - ${outcome.message}`}`);
}

// A queued job that is due now (not waiting for a retry).
function hasDueMercuryGateJob() {
  const { readMercuryGateQueue } = require('./status-server');
  return readMercuryGateQueue().some(item => !item.nextAt || item.nextAt <= Date.now());
}

module.exports = { runMercuryGateJob, runNextMercuryGateJob, hasDueMercuryGateJob, PARAMOUNT_NOTES };

if (require.main === module) {
  (async () => {
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
