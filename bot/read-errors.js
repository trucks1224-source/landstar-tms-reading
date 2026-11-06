// Read-only: opens Bulk Postings and saves every bulkUpload API response the page loads
// (the error drafts and their reasons) to a folder. Stop the bot first.
//   node read-errors.js <output-folder>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { openBoard } = require('./rate-check');

(async () => {
  const out = process.argv[2];
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launchPersistentContext(path.join(__dirname, 'browser-profile'), { headless: false, viewport: null });
  await openBoard(browser, console.log); // signs in
  const page = await browser.newPage();
  let n = 0;
  page.on('response', async response => {
    const url = response.url();
    if (!/bulkUpload/i.test(url)) return;
    try {
      const body = await response.text();
      n += 1;
      const req = response.request();
      fs.writeFileSync(path.join(out, `r${String(n).padStart(3, '0')}.json`), JSON.stringify({
        url, method: req.method(), requestBody: req.postData(), status: response.status(), body
      }));
    } catch { /* body unavailable */ }
  });
  await page.goto('https://portal.landstaronline.com/agent/bulk-postings', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(15000);
  // Open the first error row so the page loads its details too.
  const row = page.locator('text=/^#\\d{6,}/').first();
  if (await row.count()) { await row.click().catch(() => {}); await page.waitForTimeout(5000); }
  fs.writeFileSync(path.join(out, 'page.txt'), await page.locator('body').innerText().catch(() => ''));
  console.log(`Saved ${n} responses.`);
  await browser.close();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
