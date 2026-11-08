// Read-only: lists your hazmat postings and saves the portal's full record for them.
// Stop the bot first.
//   node inspect-posting.js <output.json>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { listPostings } = require('./dedupe');
const { openBoard, OWN_POSTING_CODES } = require('./rate-check');

(async () => {
  const out = process.argv[2];
  const browser = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
  const board = await openBoard(browser, console.log);
  const postings = await listPostings(board, OWN_POSTING_CODES, console.log);
  const hazmat = postings.filter(p => p.SourceSystemID === 'PORTAL' && /HAZMAT/i.test(p.CommodityCode || ''));
  console.log(`${postings.length} postings, ${hazmat.length} hazmat`);
  const page = await browser.newPage();
  await page.goto('https://portal.landstaronline.com/agent', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForURL(/portal\.landstaronline\.com\/agent/, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const details = await page.evaluate(async ids => {
    let token = null;
    for (const store of [sessionStorage, localStorage]) {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (/oidc\.user/i.test(key)) { try { token = JSON.parse(store.getItem(key)).access_token; } catch { /* next */ } }
      }
    }
    const result = [];
    for (const id of ids) {
      const r = await fetch(`/loadboards/v1/availableLoad/agent/PORTAL/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      result.push({ id, status: r.status, body: await r.text() });
    }
    return result;
  }, hazmat.slice(0, 40).map(p => p.LoadId));
  fs.writeFileSync(out, JSON.stringify({ hazmat, details }, null, 1));
  console.log(`Saved ${details.length} records.`);
  await browser.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
