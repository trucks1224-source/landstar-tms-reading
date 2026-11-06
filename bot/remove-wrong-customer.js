// Removes your postings on the given lanes whose Landstar customer is the given number
// (e.g. Paramount loads that went out under RXO). Stop the bot first.
//   node remove-wrong-customer.js <targets.json> <customerNumber> [--apply]
// targets.json: [{ originZip, destZip, lane }]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { listPostings, cancelPostings } = require('./dedupe');
const { openBoard, OWN_POSTING_CODES } = require('./rate-check');

const zip5 = value => String(value || '').trim().slice(0, 5).padStart(5, '0');

(async () => {
  const [targetsFile, customerNumber] = process.argv.slice(2);
  const apply = process.argv.includes('--apply');
  const targets = JSON.parse(fs.readFileSync(targetsFile, 'utf8'));
  const lanes = new Set(targets.map(t => `${zip5(t.originZip)}>${zip5(t.destZip)}`));
  const browser = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
  const board = await openBoard(browser, console.log);
  const postings = await listPostings(board, OWN_POSTING_CODES, console.log);
  const candidates = postings.filter(p => p.SourceSystemID === 'PORTAL'
    && lanes.has(`${zip5(p.OriginZipCode)}>${zip5(p.DestinationZipCode)}`));
  console.log(`${postings.length} postings; ${candidates.length} on those lanes`);

  const portal = await browser.newPage();
  await portal.goto('https://portal.landstaronline.com/agent', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await portal.waitForURL(/portal\.landstaronline\.com\/agent/, { timeout: 60000 }).catch(() => {});
  await portal.waitForTimeout(6000);
  const details = await portal.evaluate(async ids => {
    let token = null;
    for (const store of [sessionStorage, localStorage]) {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (/oidc\.user/i.test(key)) { try { token = JSON.parse(store.getItem(key)).access_token; } catch { /* next */ } }
      }
    }
    const out = [];
    for (const id of ids) {
      const r = await fetch(`/loadboards/v1/availableLoad/agent/PORTAL/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await r.json().catch(() => ({}));
      out.push({ id, customerNumber: body?.data?.customerNumber, customerName: body?.data?.customerName });
    }
    return out;
  }, candidates.map(p => p.LoadId));

  const wrong = details.filter(d => String(d.customerNumber) === String(customerNumber));
  for (const p of candidates) {
    const d = details.find(x => x.id === p.LoadId);
    const mark = wrong.includes(d) ? 'REMOVE' : 'keep';
    console.log(`  ${mark} #${p.LoadId} ${p.OriginCityStateForDisplay} -> ${p.DestinationCityStateForDisplay} ${p.PickupFromDateForDisplay} $${p.TotalRevenue} (${d?.customerName || '?'})`);
  }
  if (apply && wrong.length) {
    const removed = await cancelPostings(portal, wrong.map(d => d.id), console.log);
    console.log(`Removed ${removed} of ${wrong.length}.`);
  } else {
    console.log(`${wrong.length} posting(s) to remove${apply ? '' : ' (report only)'}.`);
  }
  await browser.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
