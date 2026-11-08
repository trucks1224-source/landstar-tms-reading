// Read-only: saves the board row and the portal's full record for every posting under your
// own codes, so hand-posted loads can be told apart from bulk uploads. Removes nothing.
// Stop the bot first: this uses its browser profile.
//   node compare-postings.js <output.json>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { listPostings } = require('./dedupe');
const { openBoard, OWN_POSTING_CODES } = require('./rate-check');

(async () => {
  const out = process.argv[2];
  if (!out) throw new Error('Usage: node compare-postings.js <output.json>');
  const browser = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
  const board = await openBoard(browser, console.log);
  const postings = await listPostings(board, OWN_POSTING_CODES, console.log);
  console.log(`${postings.length} postings. Reading full records...`);
  const page = await browser.newPage();
  await page.goto('https://portal.landstaronline.com/agent', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForURL(/portal\.landstaronline\.com\/agent/, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const details = await page.evaluate(async rows => {
    let token = null;
    for (const store of [sessionStorage, localStorage]) {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (/oidc\.user/i.test(key)) { try { token = JSON.parse(store.getItem(key)).access_token; } catch { /* next */ } }
      }
    }
    const result = [];
    for (const { id, source } of rows) {
      const r = await fetch(`/loadboards/v1/availableLoad/agent/${source || 'PORTAL'}/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      result.push({ id, status: r.status, body: await r.json().catch(() => null) });
    }
    return result;
  }, postings.map(p => ({ id: p.LoadId, source: p.SourceSystemID })));
  fs.writeFileSync(out, JSON.stringify({ postings, details }, null, 1));
  console.log(`Saved ${details.length} records to ${out}.`);
  await browser.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
